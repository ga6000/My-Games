// ===================================================
//   Desert Code Racer — the RASTER cabinet renderer: the world
// ===================================================
// Reassigned from VECTOR to RASTER on Ry's call (2026-11-23: "transitioning
// to a raster cabinet would be strongly preferred"), as a package
// (AESTHETIC_GUIDE §6.8 "a reassignment is a package, not a switch"):
//   - the canvas IS the virtual screen: about DC_VROWS rows, its CSS size an
//     integer multiple with image-rendering: pixelated, so one unit here is
//     one fat pixel and every shape lands on the grid (§4.4);
//   - flat fills and hard edges; no phosphor persistence, no beam overdraw,
//     no vertex bloom (those are vector-hardware artifacts);
//   - light steps in flat bands (§4.9): the sky glow, the ground, tunnels;
//   - scanlines on, gated on data-cabinet="raster" in the markup (§4.6).
// Anchor: Pole Position (Namco, 1982), the raster pseudo-3D road.
//
// The road is the classic pseudo-3D road with hills: every segment's start
// is projected once a frame into dcProj[] (bend accumulated as an x offset,
// height from the segment's y). Then the world is drawn FAR TO NEAR, one
// segment at a time: its road lines, its canyon walls or tunnel frame, then
// everything standing on it (scenery, set pieces, riders, ground effects).
// The black fills of nearer things cover farther ones, which is all the
// occlusion a vector cabinet needs; a hill crest hides the road behind it
// with the classic "lowest y so far" clip (p.clip).
//
// Riders, krill, beams, the attacks, effects and the HUD: dc-actors.js.
"use strict";

let dcCv = null, dcCtx = null, dcW = 800, dcH = 600, dcDpr = 1;
const DC_VROWS = 216;               // virtual screen height in rows (Pole Position ran 224)
let dcPixel = 3;                    // CSS pixels per virtual pixel (an integer)
let dcHy = 260;                     // horizon line
let dcK = 256;                      // x scale of the projection
let dcVy = 300;                     // y scale of the projection
let dcSkyOff = 0;                   // dcSkyPx / dcW (the mothership's sway reads it)
let dcSkyPx = 0;

// Ry 2026-11-24: "the parallax of the mountains needs fixed". They used to
// slide a fixed step every drawn frame through a bend: too far on a fast
// screen, too little on a slow one, and never in step with the road. Now
// they sit at infinity: their screen shift is exactly how far the road has
// turned under the camera (the track's heading), in the projection's own
// pixels per unit of slope, so they turn with the road at any frame rate.
function dcSkyAt(z) {
    const t = dc.track;
    if (!t) return 0;
    const f = z / DC_SEG;
    const i = dcClamp(Math.floor(f), 0, t.segs.length - 1);
    const sg = t.segs[i];
    const hd = sg.hd + sg.curve * dcClamp(f - i, 0, 1) / DC_SEG;
    return DC_CAM_DEPTH * dcK * hd;
}
const dcCam = { x: 0, z: 0, y: DC_CAM_H, inside: false, dark: 0 };
const dcProj = [];
let dcProjBase = 0;
let dcProjN = 0;
const dcRidgeFar = [], dcRidgeNear = [];
const dcBuckets = [];               // per projected segment: things standing on it

function dcRenderInit() {
    dcCv = document.getElementById("dcCanvas");
    dcCtx = dcCv.getContext("2d");
    for (let i = 0; i <= DC_DRAW + 2; i++) { dcProj.push({ x: 0, y: 0, w: 0, s: 0, cx: 0, clip: 0, vis: false }); dcBuckets.push([]); }
    // Two ridgelines, generated once, tiled around the horizon.
    const r = dcMulberry(4242);
    let h = 0.5;
    for (let i = 0; i <= 64; i++) {
        h = dcClamp(h + (r() - 0.5) * 0.7, 0.15, 1);
        dcRidgeFar.push(i % 2 ? h : h * 0.55);
    }
    h = 0.4;
    for (let i = 0; i <= 40; i++) {
        h = dcClamp(h + (r() - 0.5) * 0.9, 0.1, 1);
        dcRidgeNear.push(i % 2 ? h : h * 0.35);
    }
    dcResize();
    dcOn(window, "resize", dcResize);
}

function dcResize() {
    const panel = document.getElementById("dcPanel");
    const pw = panel ? panel.getBoundingClientRect().width : 0;
    // The virtual screen: about DC_VROWS rows, square pixels, an integer scale.
    const aw = Math.max(160, Math.floor(window.innerWidth - pw)), ah = Math.max(120, Math.floor(window.innerHeight));
    dcDpr = 1;
    dcPixel = Math.max(1, Math.round(ah / DC_VROWS));
    dcW = Math.floor(aw / dcPixel);
    dcH = Math.floor(ah / dcPixel);
    dcCv.width = dcW;
    dcCv.height = dcH;
    dcCv.style.width = dcW * dcPixel + "px";
    dcCv.style.height = dcH * dcPixel + "px";
    const scan = document.getElementById("dcScan");
    if (scan) { scan.style.width = dcW * dcPixel + "px"; scan.style.height = dcH * dcPixel + "px"; scan.style.backgroundSize = "100% " + dcPixel + "px"; }
    dcHy = Math.round(dcH * 0.43);
    dcK = dcW * 0.32;
    dcVy = dcH * 0.42;
}

// ---------------------------------------------------
//   PROJECTION
// ---------------------------------------------------
function dcProjectRoad(focus) {
    const t = dc.track;
    // In the lab after the finish the camera parks, so the room stays in view.
    const fz = Math.min(focus.z, (t.finish + 22) * DC_SEG);
    dcCam.z = fz - DC_CAM_BACK;
    dcCam.x = focus.x * DC_ROAD_W;
    // Over a crest the camera follows the flight down only partway, so the
    // ground visibly drops away under the bike.
    const flyY = focus.fly ? dcRoadY(fz) + 0.3 * Math.min(1600, Math.max(0, focus.fy - dcRoadY(fz))) : -Infinity;
    dcCam.y = Math.max(dcRoadY(dcCam.z), dcRoadY(fz), flyY) + DC_CAM_H;
    const camSeg = dcSegAt(dcCam.z);
    dcCam.inside = camSeg.zone === "tunnel" || camSeg.zone === "lab";
    dcCam.dark = dcSegAt(fz).dark;
    const base = Math.floor(dcCam.z / DC_SEG);
    const frac = (dcCam.z / DC_SEG) - base;
    dcProjBase = base;
    const s0 = t.segs[dcClamp(base, 0, t.segs.length - 1)];
    let x = 0, dx = -(s0.curve * frac);
    let n = 0, maxy = dcH * 2;
    for (; n <= DC_DRAW + 1; n++) {
        const si = base + n;
        if (si >= t.segs.length) break;
        const z = si * DC_SEG - dcCam.z;
        const p = dcProj[n];
        dcBuckets[n].length = 0;
        if (z <= 1) { p.s = 0; p.vis = false; continue; }
        const sg = t.segs[si];
        const s = DC_CAM_DEPTH / z;
        p.s = s;
        p.cx = x;
        p.x = dcW / 2 + s * (x - dcCam.x) * dcK;
        p.y = dcHy + s * (dcCam.y - sg.y) * dcVy;
        p.w = s * DC_ROAD_W * dcK;
        p.clip = maxy;
        p.vis = p.y < maxy;
        if (p.vis) maxy = p.y;
        x += dx;
        dx += sg.curve;
    }
    dcProjN = n;
}

// Screen point for world (z, x) on the road, x in road units. y is the
// height above the road in world units. clip: hidden below this y (a crest).
const dcSP = { x: 0, y: 0, w: 0, s: 0, clip: 0, n: 0 };
function dcScreenAt(z, x, y) {
    const f = z / DC_SEG - dcProjBase;
    const n = Math.floor(f);
    if (n < 0 || n + 1 >= dcProjN) return null;
    const a = dcProj[n], b = dcProj[n + 1];
    if (!a.s || !b.s) return null;
    const t = f - n;
    const s = dcLerp(a.s, b.s, t);
    const w = dcLerp(a.w, b.w, t);
    dcSP.x = dcLerp(a.x, b.x, t) + x * w;
    dcSP.y = dcLerp(a.y, b.y, t) - (y || 0) * s * dcVy;
    dcSP.w = w;
    dcSP.s = s;
    dcSP.clip = a.clip;
    dcSP.n = n;
    return dcSP;
}

// Hide the part of a standing thing that is behind a crest (call, draw, restore).
function dcClipBegin(ctx, clipY) {
    ctx.save();
    if (clipY < dcH * 2) { ctx.beginPath(); ctx.rect(-50, -50, dcW + 100, clipY + 50); ctx.clip(); }
}

function dcBikeScreen() {
    const f = dcFocus();
    if (!f) return null;
    const p = dcScreenAt(f.z, f.x, 0);
    return p ? { x: p.x, y: p.y } : null;
}

function dcFocus() { return dc.me; }

// Things standing on the road go into their segment's bucket; they are drawn
// when the far-to-near pass reaches it. order: lower first within a segment.
function dcBucket(z, order, fn, a, b) {
    const n = Math.floor(z / DC_SEG - dcProjBase);
    if (n < 1 || n >= dcProjN - 1) return;
    dcBuckets[n].push({ o: order, z: z, fn: fn, a: a, b: b });
}

// ---------------------------------------------------
//   THE FRAME
// ---------------------------------------------------
function dcRender() {
    const ctx = dcCtx;
    if (!ctx || !dc.track || !dc.me) return;
    ctx.setTransform(dcDpr, 0, 0, dcDpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, dcW, dcH);

    const f = dcFocus();
    dcProjectRoad(f);
    dcSkyPx = dcSkyAt(dcCam.z);
    dcSkyOff = dcSkyPx / Math.max(1, dcW);

    ctx.save();
    if (dcShakeAmt > 0) ctx.translate((Math.random() - 0.5) * dcShakeAmt, (Math.random() - 0.5) * dcShakeAmt);
    ctx.lineCap = "butt"; ctx.lineJoin = "miter";
    if (!dcCam.inside) dcDrawSky(ctx);
    dcFillBuckets();
    dcDrawWorld(ctx);
    dcDrawBeams(ctx);
    dcDrawAttacksTop(ctx);
    dcDrawFx(ctx, true);
    ctx.restore();
    dcDrawHud(ctx);
    dcDrawTexts(ctx);
}

function dcLine(ctx, pts, col, wide, core) {
    if (pts.length < 2) return;
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    // Raster: one hard line, at least a pixel wide. No beam overdraw (wide is ignored).
    void wide;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, Math.round(core || 1)); ctx.stroke();
}

// A closed shape: a flat fill in a dark shade of its colour, then a one-pixel
// edge in the colour itself (the raster way to give a block a lit rim).
function dcSolid(ctx, pts, col, wide, core) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    ctx.closePath();
    ctx.fillStyle = dcShade(col, 0.32); ctx.fill();
    void wide;
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, Math.round(core || 1)); ctx.stroke();
}

// A colour scaled toward black (k = 0..1), cached.
const dcShadeCache = {};
function dcShade(col, k) {
    const key = col + k;
    if (dcShadeCache[key]) return dcShadeCache[key];
    let r = 0, g = 0, b = 0;
    if (col[0] === "#") { const n = parseInt(col.length === 4 ? col[1] + col[1] + col[2] + col[2] + col[3] + col[3] : col.slice(1, 7), 16); r = n >> 16 & 255; g = n >> 8 & 255; b = n & 255; }
    else { const m = col.match(/[\d.]+/g); if (m && col.indexOf("hsl") === 0) { const c = dcHslRgb(+m[0], +m[1] / 100, +m[2] / 100); r = c[0]; g = c[1]; b = c[2]; } else if (m) { r = +m[0]; g = +m[1]; b = +m[2]; } }
    return (dcShadeCache[key] = "rgb(" + Math.round(r * k) + "," + Math.round(g * k) + "," + Math.round(b * k) + ")");
}
function dcHslRgb(h, s, l) {
    const a = s * Math.min(l, 1 - l);
    const f = function (n) { const k = (n + h / 30) % 12; return 255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))); };
    return [f(0), f(8), f(4)];
}

// Vertex bloom is a vector-hardware artifact: off on a raster cabinet.
function dcBloom() {}

// How bright a thing is by its distance down the road: far things are dim
// and thin, near things bright (Ry, pass 2: "more readable in their depth").
function dcDepthAlpha(z) {
    const d = (z - dc.me.z) / DC_SEG;
    return dcClamp(1.25 - d / 170, 0.22, 1);
}

// ---------------------------------------------------
//   SKY: ridges, the mothership, the second ship
// ---------------------------------------------------
// Night sky (raster): black above, a glow over the horizon in four flat
// bands of the world hue, two filled ridgelines, the ships.
function dcDrawSky(ctx) {
    const off = dcSkyOff;
    const dim = 1 - 0.85 * dcCam.dark;          // a canyon is darker: the sky barely shows
    const bands = [[0.22, 0.05], [0.14, 0.09], [0.09, 0.14], [0.05, 0.2]];
    for (let i = 0; i < bands.length; i++) {
        const h = Math.round(dcH * bands[i][0]);
        ctx.fillStyle = dcShade(DC_COL.hue, bands[i][1] * dim);
        ctx.fillRect(0, dcHy - h, dcW, h);
    }
    // Ground under everything below the horizon (the far road fills over it).
    ctx.fillStyle = dcShade(DC_RAS.sand[1], 0.5);
    ctx.fillRect(0, dcHy, dcW, dcH - dcHy);
    // Both ranges sit at infinity, so they turn with the road the same; the
    // nearer one also slides a little as the bike moves across the road (the
    // parallax), the far one barely.
    void off;
    const lat = dcCam.x / DC_ROAD_W;
    const ridge = function (data, wmul, slide, hmul, fill, edge) {
        const fw = dcW * wmul, step = fw / (data.length - 1);
        let sx = -(((dcSkyPx + lat * dcW * slide) % fw + fw) % fw);
        if (sx > 0) sx -= fw;
        for (let rep = 0; rep < 3; rep++) {
            ctx.beginPath(); ctx.moveTo(Math.round(sx + rep * fw), dcHy + 1);
            for (let i = 0; i < data.length; i++) ctx.lineTo(Math.round(sx + rep * fw + i * step), Math.round(dcHy - data[i] * dcH * hmul));
            ctx.lineTo(Math.round(sx + rep * fw + fw), dcHy + 1); ctx.closePath();
            ctx.fillStyle = fill; ctx.fill();
            ctx.strokeStyle = edge; ctx.lineWidth = 1; ctx.stroke();
        }
    };
    ridge(dcRidgeFar, 1.6, 0.012, 0.11, dcShade("#4B3A8C", 0.42 * dim), dcShade("#4B3A8C", dim));
    dcDrawMothership(ctx, dcHy - dcH * 0.2);
    ridge(dcRidgeNear, 2.2, 0.05, 0.07, dcShade(DC_COL.hue, 0.3 * dim), dcShade(DC_COL.hue, 0.8 * dim));
    dcDrawSmallShip(ctx);
}

const dcShip = { x: 0, y: 0, eyeX: 0, eyeY: 0, sx: 0, sy: 0 };

function dcDrawMothership(ctx, cy) {
    const cx = dcW / 2 + Math.sin(dcSkyOff * 2.1) * dcW * 0.18;
    const w = dcW * 0.46, h = dcH * 0.13;
    const topW = w * 0.34;
    const t = dc.simT;
    const a0 = ctx.globalAlpha;
    dcShip.x = cx; dcShip.y = cy;
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const yTop = cy - h * 0.55, yBot = cy + h * 0.25, yUnder = cy + h * 0.45;
    ctx.fillStyle = "#1A1824";
    ctx.beginPath();
    ctx.moveTo(x0, yBot); ctx.lineTo(cx - topW / 2, yTop); ctx.lineTo(cx + topW / 2, yTop); ctx.lineTo(x1, yBot);
    ctx.lineTo(x1 - w * 0.08, yUnder); ctx.lineTo(x0 + w * 0.08, yUnder); ctx.closePath();
    ctx.fill();
    dcLine(ctx, [x0, yBot, cx - topW / 2, yTop, cx + topW / 2, yTop, x1, yBot], DC_COL.mid, 4, 1.4);
    ctx.beginPath();
    for (let i = 1; i < 22; i++) {
        const u = i / 22;
        const xb = dcLerp(x0, x1, u), xt = dcLerp(cx - topW / 2, cx + topW / 2, u);
        ctx.moveTo(xt, yTop + 2); ctx.lineTo(dcLerp(xt, xb, 0.85), dcLerp(yTop, yBot, 0.85));
    }
    ctx.globalAlpha = a0 * 0.45; ctx.strokeStyle = DC_COL.mid; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = a0;
    ctx.beginPath(); ctx.ellipse(cx, yTop, topW * 0.28, h * 0.12, 0, Math.PI, 0); ctx.strokeStyle = DC_COL.mid; ctx.lineWidth = 1.2; ctx.stroke();
    const breath = DC_REDUCED ? 1 : 0.7 + 0.3 * Math.sin(t * 1.4);
    ctx.globalAlpha = a0 * breath;
    dcLine(ctx, [x0, yBot, x0 + w * 0.08, yUnder, x1 - w * 0.08, yUnder, x1, yBot], DC_COL.magenta, 6, 2);
    ctx.globalAlpha = a0;
    const charging = dc.beams.some(function (b) { return b.phase === "track" && b.src === 0; });
    dcShip.eyeX = cx; dcShip.eyeY = yUnder + h * 0.12;
    ctx.beginPath(); ctx.ellipse(cx, dcShip.eyeY, w * 0.035, h * 0.1, 0, 0, Math.PI * 2);
    ctx.strokeStyle = charging ? DC_COL.magenta : DC_COL.mid; ctx.lineWidth = charging ? 2.4 : 1.2; ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, dcShip.eyeY, Math.max(1.5, h * 0.035 * (charging ? 1.6 : 1)), 0, Math.PI * 2);
    ctx.fillStyle = charging ? DC_COL.magenta : DC_COL.mid; ctx.fill();
    dcBloom(ctx, x0, yBot, 1.4); dcBloom(ctx, x1, yBot, 1.4); dcBloom(ctx, cx - topW / 2, yTop, 1.2); dcBloom(ctx, cx + topW / 2, yTop, 1.2);
}

function dcDrawSmallShip(ctx) {
    const t = dc.simT;
    const st = dcStrafeShip();                 // a strafing run pulls it down over the road
    let x = dcW * 0.09 + Math.sin(t * 0.23) * dcW * 0.04, y = dcH * 0.09 + Math.sin(t * 0.37) * dcH * 0.015;
    if (st) { x = dcLerp(x, st.x - dcW * 0.1, st.k); y = dcLerp(y, st.y, st.k); }
    const w = dcW * 0.2, h = dcH * 0.035;
    dcShip.sx = x + w * 0.7; dcShip.sy = y + h * 0.6;
    ctx.fillStyle = "#1A1824";
    ctx.beginPath(); ctx.moveTo(x, y + h * 0.6); ctx.lineTo(x + w, y - h * 0.4); ctx.lineTo(x + w, y + h * 0.7); ctx.closePath(); ctx.fill();
    dcLine(ctx, [x, y + h * 0.6, x + w, y - h * 0.4, x + w, y + h * 0.7], DC_COL.mid, 3, 1.2);
    dcLine(ctx, [x + w * 0.04, y + h * 0.66, x + w, y + h * 0.8], DC_COL.magenta, 4, st ? 2.4 : 1.6);
    dcBloom(ctx, x, y + h * 0.6, 1.2);
}

// ---------------------------------------------------
//   BUCKETS: what stands on which segment
// ---------------------------------------------------
function dcFillBuckets() {
    const t = dc.track;
    const s0 = dcProjBase + 1, s1 = dcProjBase + dcProjN - 2;
    // Scenery.
    for (let n = 1; n < dcProjN - 1; n++) {
        const sg = t.segs[dcProjBase + n];
        if (!sg) continue;
        for (let k = 0; k < sg.scene.length; k++) dcBucket((dcProjBase + n) * DC_SEG, 1, dcDrawSceneObj, sg.scene[k], (dcProjBase + n) * DC_SEG);
    }
    // Set pieces: ground marks at their far end, standing parts at their row.
    const list = dcHazardsIn(s0 - 2, s1);
    for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (h.type === "crater") dcBucket((h.seg + h.len) * DC_SEG, 0, dcDrawCrater, h);
        else if (h.type === "dust") dcDrawDustBuckets(h);
        else if (h.type === "barricade") dcBarricadeBuckets(h);
        else if (h.type === "pad") dcBucket((h.seg + h.len) * DC_SEG, 0, dcDrawPad, h);
        else if (h.type === "chips") {
            for (let c = 0; c < h.chips.length; c++) {
                if (dc.me.passed[h.id + "c" + c]) continue;
                dcBucket(h.chips[c].seg * DC_SEG, 3, dcDrawChip, h.chips[c], c);
            }
        }
    }
    // Barricade approach marks on the road (a depth cue).
    for (let i = 0; i < list.length; i++) {
        const h = list[i];
        if (h.type !== "barricade" || h.st === "gone" || h.fork !== undefined) continue;
        for (let k = 1; k <= 3; k++) dcBucket((h.seg - k * 14) * DC_SEG, 0, dcDrawApproach, h, k);
    }
    // Gantries, the dome, the lab's back wall.
    for (let L = 0; L < 2; L++) dcBucket(t.cpSeg[L] * DC_SEG, 2, dcDrawGantry, t.cpSeg[L], DC_LEG_NAMES[L + 1].split(" ")[1]);
    dcBucket(22 * DC_SEG, 2, dcDrawDome, -2.6);
    dcBucket((t.finish + DC_LAB_DEPTH) * DC_SEG, -1, dcDrawLabWall);
    dcBucket(t.finish * DC_SEG, 2, dcDrawFinishLine);
    // Beacons, the case, riders, the finale's friendly, ground effects.
    for (let i = 0; i < dc.beacons.length; i++) dcBucket(dc.beacons[i].z, 4, dcDrawBeacon, dc.beacons[i]);
    const c = dc.caseS;
    if (c && !c.holder && !c.over) dcBucket(c.z, 4, dcDrawCaseOnRoad, c);
    for (const id in dc.riders) { const r = dc.riders[id]; dcBucket(r.z, 6, dcDrawRiderAt, r); }
    dcFinaleBuckets();
    dcAttacksBuckets();
    for (let i = 0; i < dc.fx.length; i++) {
        const fx = dc.fx[i];
        if (fx.delay > 0 || fx.y > 50 || fx.kind === "tracer" || fx.kind === "seeker") continue;
        dcBucket(fx.kind === "pulse" ? fx.z + (fx.t / fx.life) * fx.len * DC_SEG : fx.z, 5, dcDrawFxOne, fx);
    }
}

// ---------------------------------------------------
//   THE WORLD, FAR TO NEAR
// ---------------------------------------------------
function dcDrawWorld(ctx) {
    const t = dc.track;
    for (let n = dcProjN - 2; n >= 1; n--) {
        const a = dcProj[n], b = dcProj[n + 1];
        const si = dcProjBase + n;
        const sg = t.segs[si];
        if (!sg || !a.s || !b.s) continue;
        const zone = sg.zone;
        if (a.vis) dcDrawRoadSeg(ctx, n, si, sg, a, b);
        if (zone === "tunnel" || zone === "lab") dcDrawTunnelSeg(ctx, n, si, sg);
        if (zone === "valley") dcDrawWallSeg(ctx, n, si, sg, a, b);
        const bk = dcBuckets[n];
        if (bk.length) {
            if (bk.length > 1) bk.sort(dcBucketOrder);
            for (let k = 0; k < bk.length; k++) {
                const it = bk[k];
                it.fn(ctx, it.a, it.b);
                ctx.globalAlpha = 1;
            }
        }
    }
}

function dcBucketOrder(p, q) { return (p.o - q.o) || (q.z - p.z); }

// RASTER road (Pole Position): every segment is a strip of flat fills,
// nearest drawn last. Sand across the whole width, rumble strips, asphalt,
// a centre dash, all alternating in 3-segment bands (the speed cue). Distance
// darkens in three flat steps, never a ramp (§4.9).
const DC_RAS = {
    sand: ["#2E2140", "#261B36"], sandValley: ["#1A1328", "#150F21"],
    asph: ["#3A3546", "#322E3D"], asphTun: ["#2A2833", "#24222C"], asphLit: ["#5A4E3E", "#524736"],
    rumble: ["#8A6BFF", "#D8D0E8"], dash: "#D8D0E8",
    lab: ["#0E2A30", "#0B2328"], labLine: "#1F6A76", alt: ["#3E3628", "#363022"]
};
function dcFog(n) { return n < DC_DRAW * 0.28 ? 1 : (n < DC_DRAW * 0.55 ? 0.72 : 0.5); }
function dcQuad(ctx, x1, y1, w1, x2, y2, w2, col) {
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(Math.round(x1 - w1), Math.round(y1)); ctx.lineTo(Math.round(x2 - w2), Math.round(y2));
    ctx.lineTo(Math.round(x2 + w2), Math.round(y2)); ctx.lineTo(Math.round(x1 + w1), Math.round(y1));
    ctx.closePath(); ctx.fill();
}
function dcDrawRoadSeg(ctx, n, si, sg, a, b) {
    const band = Math.floor(si / 3) % 2;
    const k = dcFog(n);
    const lab = sg.zone === "lab", tun = sg.zone === "tunnel";
    const y0 = Math.round(b.y), y1 = Math.round(a.y) + 1;
    if (y1 <= y0) return;
    const sh = function (c) { return k === 1 ? c : dcShade(c, k); };
    // Sand (or the lab floor) across the whole width.
    let ground = sg.zone === "valley" ? DC_RAS.sandValley[band] : DC_RAS.sand[band];
    if (lab) ground = DC_RAS.lab[band];
    else if (tun) ground = "#120E1A";
    ctx.fillStyle = sh(ground);
    ctx.fillRect(0, y0, dcW, y1 - y0);
    if (lab) {
        dcQuad(ctx, a.x, a.y, a.w * 1.7, b.x, b.y, b.w * 1.7, sh(DC_RAS.lab[band ^ 1]));
        if (si % 4 === 0) { ctx.fillStyle = sh(DC_RAS.labLine); ctx.fillRect(Math.round(a.x - a.w * 1.7), Math.round(a.y), Math.round(a.w * 3.4), 1); }
        return;
    }
    // A side road first, so the main road paints over where they share tarmac.
    const nx = dc.track.segs[si + 1];
    if (sg.alt && nx && nx.alt) {
        dcQuad(ctx, a.x + sg.alt.off * a.w, a.y, sg.alt.w * a.w, b.x + nx.alt.off * b.w, b.y, nx.alt.w * b.w, sh(DC_RAS.alt[band]));
        for (let e = -1; e <= 1; e += 2) {
            const xa = sg.alt.off + e * sg.alt.w, xb = nx.alt.off + e * nx.alt.w;
            if (Math.abs(xa) <= 1.02 && Math.abs(xb) <= 1.02) continue;
            dcQuad(ctx, a.x + xa * a.w, a.y, Math.max(0.5, a.w * 0.05), b.x + xb * b.w, b.y, Math.max(0.5, b.w * 0.05), sh(band ? DC_COL.amber : "#7A5A10"));
        }
    }
    // Rumble strips, then the asphalt over their inner half.
    if (!tun) dcQuad(ctx, a.x, a.y, a.w * 1.12, b.x, b.y, b.w * 1.12, sh(DC_RAS.rumble[band]));
    // Tunnel lamps throw pools of light on the road: the lit segments are one flat step brighter.
    const lit = tun && Math.abs((si % 10) - 5) <= 1;
    dcQuad(ctx, a.x, a.y, a.w, b.x, b.y, b.w, sh(lit ? DC_RAS.asphLit[band] : (tun ? DC_RAS.asphTun[band] : DC_RAS.asph[band])));
    if (band === 0) dcQuad(ctx, a.x, a.y, Math.max(0.5, a.w * 0.025), b.x, b.y, Math.max(0.5, b.w * 0.025), sh(DC_RAS.dash));
}

// Canyon walls: black faces rising either side, a jagged rim, strata.
function dcDrawWallSeg(ctx, n, si, sg, a, b) {
    const nx = dc.track.segs[si + 1];
    if (!nx || nx.zone !== "valley") return;
    // Mesa rims: a height per 9-segment block, sloped between blocks.
    const blk = function (b, side) { const h = Math.sin(b * 12.9898 + side * 78.233) * 43758.5453; return 2300 + 1500 * (h - Math.floor(h)); };
    const hgt = function (i, side) { const b = Math.floor(i / 9), f = (i % 9) / 9; return dcLerp(blk(b, side), blk(b + 1, side), f < 0.7 ? 0 : (f - 0.7) / 0.3); };
    const fade = dcClamp(1.3 - n / (DC_DRAW * 0.9), 0.2, 1);
    for (let side = -1; side <= 1; side += 2) {
        const xw = side * 1.45;
        const ha = hgt(si, side) * sg.dark, hb = hgt(si + 1, side) * nx.dark;
        if (ha < 50 && hb < 50) continue;
        const ax = a.x + xw * a.w, bx = b.x + xw * b.w;
        const aT = a.y - ha * a.s * dcVy, bT = b.y - hb * b.s * dcVy;
        // The face runs outward to the screen edge so nothing beyond shows.
        const far = side < 0 ? -dcW : dcW * 2;
        ctx.globalAlpha = 1;
        ctx.beginPath();
        ctx.moveTo(ax, a.y); ctx.lineTo(bx, b.y); ctx.lineTo(bx, bT); ctx.lineTo(far, bT); ctx.lineTo(far, a.y + 4); ctx.closePath();
        ctx.fillStyle = dcShade(Math.floor(si / 5) % 2 ? "#2A2142" : "#241C3A", dcFog(n)); ctx.fill();
        ctx.beginPath();
        ctx.moveTo(ax, aT); ctx.lineTo(bx, bT); ctx.lineTo(far, bT);
        ctx.globalAlpha = fade * 0.9;
        dcLine(ctx, [ax, aT, bx, bT], "#5B4E8C", 3, 1.2);
        dcLine(ctx, [ax, a.y, bx, b.y], "#3A2E66", 0, 1);
        if (si % 5 === 0) {
            ctx.globalAlpha = fade * 0.5;
            dcLine(ctx, [ax, a.y, ax, aT], "#3A2E66", 0, 1);
            dcLine(ctx, [ax, dcLerp(a.y, aT, 0.4), ax + side * a.w * 0.6, dcLerp(a.y, aT, 0.45)], "#3A2E66", 0, 1);
        }
    }
    ctx.globalAlpha = 1;
}

// A tunnel (or the lab) at one segment: the mountain round the opening is
// filled black, so nearer frames hide everything outside the bore; ribs every
// few segments; down lights; the portal face at the entrance.
function dcDrawTunnelSeg(ctx, n, si, sg) {
    const p = dcProj[n];
    const lab = sg.zone === "lab";
    const prev = dc.track.segs[si - 1];
    const entrance = prev && prev.zone !== "tunnel" && prev.zone !== "lab";
    const labDoor = lab && prev && prev.zone === "tunnel";
    const halfW = (lab ? 1.7 : 1.15) * p.w;
    const hgt = (lab ? 3400 : 2300) * p.s * dcVy;
    const x0 = p.x - halfW, x1 = p.x + halfW, yb = p.y, yt = p.y - hgt;
    const arch = lab ? 0 : Math.min(halfW * 0.5, hgt * 0.35);
    function bore() {
        ctx.moveTo(x0, yb); ctx.lineTo(x0, yt + arch);
        ctx.quadraticCurveTo(x0, yt, x0 + arch, yt);
        ctx.lineTo(x1 - arch, yt);
        ctx.quadraticCurveTo(x1, yt, x1, yt + arch);
        ctx.lineTo(x1, yb);
    }
    // The mountain: huge for the finale, a ridge for a pass-through tunnel.
    const finale = si >= dc.track.finish - DC_FINALE_SEGS - 2;
    const mw = (finale ? 16 : 7) * p.w, mh = (finale ? 15000 : 6500) * p.s * dcVy;
    ctx.beginPath();
    ctx.moveTo(p.x - mw, yb + 2);
    ctx.lineTo(p.x - mw * 0.55, yb - mh * 0.55); ctx.lineTo(p.x - mw * 0.25, yb - mh * 0.8);
    ctx.lineTo(p.x + mw * 0.05, yb - mh); ctx.lineTo(p.x + mw * 0.4, yb - mh * 0.7); ctx.lineTo(p.x + mw * 0.7, yb - mh * 0.45);
    ctx.lineTo(p.x + mw, yb + 2);
    ctx.lineTo(x1, yb + 2); ctx.lineTo(x1, yb);
    // ...minus the bore (traced the other way round).
    ctx.lineTo(x1, yt + arch); ctx.quadraticCurveTo(x1, yt, x1 - arch, yt); ctx.lineTo(x0 + arch, yt); ctx.quadraticCurveTo(x0, yt, x0, yt + arch);
    ctx.lineTo(x0, yb + 2);
    ctx.closePath();
    ctx.fillStyle = lab ? "#0A1E22" : (si % 10 < 5 ? "#1E1830" : "#1A1529"); ctx.fill();
    // Below the road line, the floor: keep it black too so nothing shows under a crest.
    if (entrance) {
        dcLine(ctx, [p.x - mw, yb, p.x - mw * 0.55, yb - mh * 0.55, p.x - mw * 0.25, yb - mh * 0.8, p.x + mw * 0.05, yb - mh, p.x + mw * 0.4, yb - mh * 0.7, p.x + mw * 0.7, yb - mh * 0.45, p.x + mw, yb], DC_COL.hue, 5, 1.6);
        ctx.beginPath(); bore();
        ctx.strokeStyle = finale ? DC_COL.cyan : DC_COL.mid; ctx.lineWidth = finale ? 2.2 : 1.6; ctx.stroke();
        if (finale) {
            const size = Math.max(5, Math.min(30, hgt * 0.13));
            dcText(ctx, "MOUNTAIN BASE", p.x, yt - size * 1.6, size, DC_COL.cyan, "center");
            for (let k = 0; k <= 8; k++) {
                const u = k / 8;
                const blink = DC_REDUCED || Math.floor(dc.simT * 3 + k) % 2 === 0;
                if (blink) dcBloom(ctx, dcLerp(x0 + arch, x1 - arch, u), yt - 3, Math.max(1, p.w * 0.01));
            }
        }
        return;
    }
    if (labDoor) {
        ctx.beginPath(); bore(); ctx.strokeStyle = DC_COL.cyan; ctx.lineWidth = 2; ctx.stroke();
        return;
    }
    // Ribs and lights.
    const ribEvery = lab ? 4 : 5;
    if (si % ribEvery === 0) {
        const fade = dcClamp(1.25 - n / 150, 0.2, 1);
        ctx.globalAlpha = fade;
        ctx.beginPath(); bore();
        ctx.strokeStyle = lab ? "#1F5A66" : "#4B3A8C"; ctx.lineWidth = 1.2; ctx.stroke();
        ctx.globalAlpha = 1;
    }
    if (!lab && si % 10 === 5) dcDrawLamp(ctx, p, yt, sg.lit, n);
    if (lab && si % 8 === 2) dcDrawRacks(ctx, p, x0, x1, yb, hgt, si);
}

// A ceiling lamp and the cone it throws down (the finale is lit brighter).
function dcDrawLamp(ctx, p, yt, lit, n) {
    const fade = dcClamp(1.25 - n / 160, 0.2, 1);
    const lw = p.w * 0.18;
    ctx.globalAlpha = fade;
    dcLine(ctx, [p.x - lw, yt + 2, p.x + lw, yt + 2], DC_COL.amber, 4, 1.6);
    const pool = p.w * (lit ? 0.75 : 0.5);
    ctx.globalAlpha = fade * (lit ? 0.32 : 0.16);
    ctx.beginPath();
    ctx.moveTo(p.x - lw, yt + 3); ctx.lineTo(p.x - pool, p.y);
    ctx.moveTo(p.x + lw, yt + 3); ctx.lineTo(p.x + pool, p.y);
    ctx.strokeStyle = DC_COL.amber; ctx.lineWidth = 1; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(p.x, p.y, pool, Math.max(1, pool * 0.12), 0, 0, Math.PI * 2); ctx.stroke();
    ctx.globalAlpha = 1;
}

// The lab's side walls: server racks with blinking lights.
function dcDrawRacks(ctx, p, x0, x1, yb, hgt, si) {
    const rh = hgt * 0.72, rw = p.w * 0.22;
    for (let side = -1; side <= 1; side += 2) {
        const xe = side < 0 ? x0 : x1;
        const xi = xe - side * rw;
        dcSolid(ctx, [xe, yb, xe, yb - rh, xi, yb - rh, xi, yb], "#1F5A66", 0, 1.2);
        for (let k = 0; k < 6; k++) {
            const yy = yb - rh * (0.12 + k * 0.14);
            ctx.globalAlpha = 0.6;
            dcLine(ctx, [xe - side * rw * 0.1, yy, xi + side * rw * 0.1, yy], "#1F5A66", 0, 1);
            const on = DC_REDUCED || Math.floor(dc.simT * 4 + k * 1.7 + si) % 3 !== 0;
            ctx.globalAlpha = 1;
            if (on) { ctx.fillStyle = (k + si) % 3 ? DC_COL.cyan : DC_COL.amber; ctx.fillRect(xi + side * rw * 0.25 - 1, yy - 3, Math.max(1.5, rw * 0.06), Math.max(1.5, rw * 0.06)); }
        }
    }
}

// The lab's back wall: the big screens, the console. The friendly stands
// in front of it (dc-finale.js draws them).
function dcDrawLabWall(ctx) {
    const p = dcScreenAt((dc.track.finish + DC_LAB_DEPTH) * DC_SEG, 0, 0);
    if (!p) return;
    const halfW = 1.7 * p.w, hgt = 3400 * p.s * dcVy;
    const x0 = p.x - halfW, x1 = p.x + halfW, yb = p.y, yt = p.y - hgt;
    dcSolid(ctx, [x0, yb, x0, yt, x1, yt, x1, yb], "#1F5A66", 0, 1.4);
    // Three screens: a world map with the launch arc, code, a countdown.
    const sw = halfW * 0.55, sh = hgt * 0.32, sy = yt + hgt * 0.12;
    for (let k = -1; k <= 1; k++) {
        const cx = p.x + k * halfW * 0.62;
        dcLine(ctx, [cx - sw / 2, sy, cx + sw / 2, sy, cx + sw / 2, sy + sh, cx - sw / 2, sy + sh, cx - sw / 2, sy], DC_COL.cyan, 4, 1.4);
        ctx.save(); ctx.beginPath(); ctx.rect(cx - sw / 2 + 2, sy + 2, sw - 4, sh - 4); ctx.clip();
        if (k === 0) {
            const arm = dc.finale && dc.finale.caught;
            const fit = function (str, max) { return Math.min(max, (sw * 0.86) / Math.max(1, dcTextWidth(str, 10) / 10)); };
            const l1 = arm ? "CODES IN" : "AWAITING", l2 = arm ? "LAUNCH ARMED" : "LAUNCH CODES";
            dcText(ctx, l1, cx, sy + sh * 0.22, Math.max(4, fit(l1, sh * 0.22)), arm ? DC_COL.amber : DC_COL.cyan, "center");
            dcText(ctx, l2, cx, sy + sh * 0.58, Math.max(4, fit(l2, sh * 0.18)), arm ? DC_COL.amber : DC_COL.mid, "center");
        } else if (k < 0) {
            ctx.globalAlpha = 0.7;
            const scroll = DC_REDUCED ? 0 : (dc.simT * 18) % (sh * 0.16);
            for (let i = 0; i < 9; i++) {
                const yy = sy + sh * 0.1 + i * sh * 0.16 - scroll;
                const len = sw * (0.3 + 0.5 * Math.abs(Math.sin(i * 2.7 + Math.floor(dc.simT * 2))));
                dcLine(ctx, [cx - sw * 0.4, yy, cx - sw * 0.4 + len, yy], DC_COL.cyan, 0, 1);
            }
        } else {
            ctx.globalAlpha = 0.8;
            ctx.beginPath(); ctx.ellipse(cx, sy + sh * 0.6, sw * 0.4, sh * 0.35, 0, Math.PI, 0);
            ctx.strokeStyle = DC_COL.cyan; ctx.lineWidth = 1; ctx.stroke();
            const u = DC_REDUCED ? 0.6 : (dc.simT * 0.3) % 1;
            dcBloom(ctx, cx - sw * 0.4 * Math.cos(u * Math.PI), sy + sh * 0.6 - sh * 0.35 * Math.sin(u * Math.PI), 1.5);
        }
        ctx.restore();
        ctx.globalAlpha = 1;
    }
    // The console desk.
    const dy = yb - hgt * 0.16;
    dcSolid(ctx, [p.x - halfW * 0.6, yb, p.x - halfW * 0.55, dy, p.x + halfW * 0.55, dy, p.x + halfW * 0.6, yb], "#1F5A66", 0, 1.3);
}

// ---------------------------------------------------
//   STANDING THINGS
// ---------------------------------------------------
function dcDrawGantry(ctx, seg, label) {
    const p = dcScreenAt(seg * DC_SEG, 0, 0);
    if (!p) return;
    dcClipBegin(ctx, p.clip);
    const w = p.w * 1.15, h = p.s * 2600 * dcVy;
    // Raster gantry: two filled posts and a filled sign beam.
    const pw = Math.max(1, Math.round(p.w * 0.05)), bh = Math.max(2, Math.round(h * 0.2));
    const X0 = Math.round(p.x - w), X1 = Math.round(p.x + w), Y = Math.round(p.y), T = Math.round(p.y - h);
    ctx.fillStyle = "#1F5A66"; ctx.fillRect(X0 - pw, T, pw, Y - T); ctx.fillRect(X1, T, pw, Y - T);
    ctx.fillStyle = "#0A1E22"; ctx.fillRect(X0 - pw, T - Math.round(bh * 0.2), X1 - X0 + pw * 2, bh);
    ctx.fillStyle = DC_COL.cyan; ctx.fillRect(X0 - pw, T - Math.round(bh * 0.2), X1 - X0 + pw * 2, 1);
    const size = Math.max(4, Math.min(16, h * 0.16));
    dcText(ctx, label, p.x, p.y - h + size * 0.5, size, DC_COL.cyan, "center");
    ctx.restore();
}

function dcDrawFinishLine(ctx) {
    const p = dcScreenAt(dc.track.finish * DC_SEG, 0, 0);
    if (!p) return;
    const w = p.w * 1.6, hh = Math.max(1, Math.round(p.w * 0.04));
    // A checkered band across the road, two rows of flat squares.
    for (let k = 0; k < 12; k++) for (let r = 0; r < 2; r++) {
        ctx.fillStyle = (k + r) % 2 ? "#000" : DC_COL.amber;
        const xa = Math.round(p.x - w + (2 * w) * k / 12), xb = Math.round(p.x - w + (2 * w) * (k + 1) / 12);
        ctx.fillRect(xa, Math.round(p.y) - hh * (r + 1), xb - xa, hh);
    }
}

function dcDrawDome(ctx, x) {
    const p = dcScreenAt(22 * DC_SEG, x, 0);
    if (!p) return;
    dcClipBegin(ctx, p.clip);
    const r = p.s * 2400 * dcK;
    ctx.beginPath(); ctx.arc(p.x, p.y, r, Math.PI, 0); ctx.closePath();
    ctx.fillStyle = "#0A1E22"; ctx.fill();
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, Math.PI, 0);
    for (let i = 1; i < 6; i++) {
        const a = Math.PI + i * Math.PI / 6;
        ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    }
    ctx.moveTo(p.x - r * 0.87, p.y - r * 0.5); ctx.lineTo(p.x + r * 0.87, p.y - r * 0.5);
    ctx.strokeStyle = DC_COL.cyan; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.restore();
}

function dcDrawSceneObj(ctx, o, z) {
    const p = dcScreenAt(z, o.x, 0);
    if (!p || p.x < -100 || p.x > dcW + 100) return;
    if (p.y > p.clip + 2) return;
    const u = p.s * dcVy;
    ctx.globalAlpha = dcClamp(1.3 - p.n / DC_DRAW, 0.3, 1);
    if (o.kind === "cactus") dcDrawCactus(ctx, p.x, p.y, u * 1100 * o.h);
    else if (o.kind === "scrub") dcDrawScrub(ctx, p.x, p.y, u * 380 * o.h);
    else dcDrawRock(ctx, p.x, p.y, u * 420 * o.h);
    ctx.globalAlpha = 1;
}

// A saguaro as flat blocks: lit left face, shaded right face, two arms.
function dcDrawCactus(ctx, x, y, h) {
    if (h < 2) return;
    const tw = Math.max(1, Math.round(h * 0.14)), aw = Math.max(1, Math.round(tw * 0.8));
    const X = Math.round(x), Y = Math.round(y), H = Math.round(h);
    const block = function (bx, by, bw, bh) {
        ctx.fillStyle = "#2E9C55"; ctx.fillRect(bx, by, bw, bh);
        if (bw >= 3) { ctx.fillStyle = "#1A5E33"; ctx.fillRect(bx + bw - Math.max(1, Math.floor(bw / 3)), by, Math.max(1, Math.floor(bw / 3)), bh); ctx.fillStyle = "#5BE08A"; ctx.fillRect(bx, by, 1, bh); }
    };
    block(X - Math.floor(tw / 2), Y - H, tw, H);
    const lx = X - Math.round(h * 0.26), ly = Math.round(Y - h * 0.47);
    block(lx, ly, X - lx, aw); block(lx, Math.round(Y - h * 0.76), aw, ly - Math.round(Y - h * 0.76) + aw);
    const rx = X + Math.round(h * 0.23), ry = Math.round(Y - h * 0.62);
    block(X, ry, rx - X + aw, aw); block(rx, Math.round(Y - h * 0.86), aw, ry - Math.round(Y - h * 0.86) + aw);
}

function dcDrawScrub(ctx, x, y, h) {
    if (h < 1) return;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) { ctx.moveTo(x + i * h * 0.15, y); ctx.lineTo(x + i * h * 0.45, y - h * (1 - Math.abs(i) * 0.2)); }
    ctx.strokeStyle = "#7A6A3A"; ctx.lineWidth = 1; ctx.stroke();
}

function dcDrawRock(ctx, x, y, h) {
    if (h < 1) return;
    dcSolid(ctx, [x - h, y, x - h * 0.6, y - h * 0.7, x + h * 0.2, y - h, x + h, y], "#5B4E8C", 0, 1);
}

// ---------------------------------------------------
//   SET PIECES
// ---------------------------------------------------
// SCORCH CRATERS are the Tide's: where its earlier beams hit. A jagged black
// pit with a molten amber rim, veined cracks that pulse on the Tide's breath,
// and smoke curling up (Ry, pass 2: unmistakably enemy-made, and nothing like
// the smooth flashing magenta ring a beam paints before it lands).
function dcDrawCrater(ctx, h) {
    const st = h.st;
    dcDrawScorchMark(ctx, h.seg * DC_SEG, h.x, h.r, h.len, h.seed || h.id, st === "ramp" ? 0.5 : 1, dcDepthAlpha(h.seg * DC_SEG));
    if (st === "ramp") dcDrawRamp(ctx, h.seg - 3, h.x, h.r * 1.2);
}

function dcDrawScorchMark(ctx, z, x, r, len, seed, heat, alpha) {
    const a = dcScreenAt(z, x, 0);
    if (!a) return;
    const ax = a.x, ay = a.y, aw = a.w, clip = a.clip;
    const b = dcScreenAt(z + len * DC_SEG, x, 0);
    if (!b) return;
    if (ay > clip + 2) return;
    const cx = (ax + b.x) / 2, cy = (ay + b.y) / 2;
    const rx = r * aw, ry = Math.max(1.5, (ay - b.y) / 2 + rx * 0.06);
    const rnd = dcMulberry(Math.floor(seed * 977) | 0);
    const pts = [];
    const N = 11;
    for (let i = 0; i < N; i++) {
        const t = i / N * Math.PI * 2;
        const k = 0.78 + rnd() * 0.36;
        pts.push(cx + Math.cos(t) * rx * k, cy + Math.sin(t) * ry * k);
    }
    ctx.globalAlpha = alpha;
    dcSolid(ctx, pts, DC_COL.amber, 5, 1.6);
    // Inner glow ring and cracks.
    const breath = DC_REDUCED ? 0.7 : 0.55 + 0.45 * Math.sin(dc.simT * 1.4 + seed);
    ctx.globalAlpha = alpha * heat * breath;
    ctx.beginPath(); ctx.ellipse(cx, cy, rx * 0.42, ry * 0.42, 0, 0, Math.PI * 2);
    ctx.strokeStyle = DC_COL.magenta; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.beginPath();
    for (let i = 0; i < 6; i++) {
        const t = rnd() * Math.PI * 2;
        const r0 = 0.45, r1 = 1.05 + rnd() * 0.45;
        ctx.moveTo(cx + Math.cos(t) * rx * r0, cy + Math.sin(t) * ry * r0);
        const mt = t + (rnd() - 0.5) * 0.4;
        ctx.lineTo(cx + Math.cos(mt) * rx * 0.75, cy + Math.sin(mt) * ry * 0.75);
        ctx.lineTo(cx + Math.cos(t) * rx * r1, cy + Math.sin(t) * ry * r1);
    }
    ctx.stroke();
    // Smoke: two curls rising, drifting.
    if (rx > 3) {
        ctx.globalAlpha = alpha * 0.45;
        ctx.beginPath();
        for (let k = 0; k < 2; k++) {
            const ph = (DC_REDUCED ? 0.3 : (dc.simT * 0.6 + k * 0.5 + seed) % 1);
            const sx = cx + (k ? 0.3 : -0.25) * rx;
            const top = rx * (1.2 + ph * 1.6);
            ctx.moveTo(sx, cy);
            for (let j = 1; j <= 5; j++) {
                const u = j / 5;
                ctx.lineTo(sx + Math.sin(u * 5 + dc.simT * 2 + k) * rx * 0.12 * u, cy - top * u);
            }
        }
        ctx.strokeStyle = DC_COL.mid; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

function dcDrawRamp(ctx, seg, x, half) {
    const a = dcScreenAt(seg * DC_SEG, x, 0), b0 = a ? { x: a.x, y: a.y, w: a.w, s: a.s } : null;
    const b = dcScreenAt((seg + 3) * DC_SEG, x, 500);
    if (!b0 || !b) return;
    const w0 = half * b0.w, w1 = half * b.w;
    dcSolid(ctx, [b0.x - w0, b0.y, b.x - w1, b.y, b.x + w1, b.y, b0.x + w0, b0.y], DC_COL.cyan, 5, 1.6);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) { const u = i / 4; ctx.moveTo(dcLerp(b0.x - w0, b.x - w1, u), dcLerp(b0.y, b.y, u)); ctx.lineTo(dcLerp(b0.x + w0, b.x + w1, u), dcLerp(b0.y, b.y, u)); }
    ctx.strokeStyle = DC_COL.cyan; ctx.lineWidth = 1; ctx.stroke();
}

function dcDrawPad(ctx, h) {
    ctx.globalAlpha = dcDepthAlpha(h.seg * DC_SEG);
    dcDrawRamp(ctx, h.seg, h.x, 0.32);
    ctx.globalAlpha = 1;
}

function dcDrawChip(ctx, ch, c) {
    const p = dcScreenAt(ch.seg * DC_SEG, ch.x, 160);
    if (!p || p.y > p.clip + 30) return;
    const r = Math.max(1.5, p.w * 0.05);
    const spin = DC_REDUCED ? 1 : Math.abs(Math.cos(dc.simT * 4 + c));
    ctx.globalAlpha = dcDepthAlpha(ch.seg * DC_SEG);
    dcLine(ctx, [p.x, p.y - r, p.x + r * spin, p.y, p.x, p.y + r, p.x - r * spin, p.y, p.x, p.y - r], DC_COL.amber, 3, 1.3);
    ctx.globalAlpha = 1;
}

// Painted chevrons on the road before a barricade: count down 3, 2, 1.
function dcDrawApproach(ctx, h, k) {
    const z = (h.seg - k * 14) * DC_SEG;
    const p = dcScreenAt(z, 0, 0);
    if (!p || !dcProj[p.n].vis) return;
    const b = dcScreenAt(z + 2 * DC_SEG, 0, 0);
    if (!b) return;
    const ax = p.x, ay = p.y, aw = p.w;
    ctx.globalAlpha = dcDepthAlpha(z) * (0.35 + 0.2 * (4 - k));
    ctx.beginPath();
    for (let e = -1; e <= 1; e += 2) {
        const x0 = ax + e * aw * 0.92, x1 = ax + e * aw * 0.7;
        ctx.moveTo(x0, ay); ctx.lineTo(x1, (ay + b.y) / 2); ctx.lineTo(x0, b.y);
    }
    ctx.strokeStyle = DC_COL.magenta; ctx.lineWidth = Math.max(1, aw * 0.012); ctx.stroke();
    ctx.globalAlpha = 1;
}

function dcBarricadeBuckets(h) {
    if (h.st === "gone") { dcBucket(h.seg * DC_SEG, 0, dcDrawRubble, h); return; }
    for (let i = 0; i < h.walls.length; i++) dcBucket(h.walls[i].seg * DC_SEG, 2, dcDrawWall, h, h.walls[i]);
    if (h.st !== "open") for (let i = 0; i < h.traps.length; i++) dcBucket(h.traps[i].seg * DC_SEG, 2, dcDrawTrap, h, h.traps[i]);
    else if (h.traps.length) dcBucket(h.seg * DC_SEG, 0, dcDrawRubble, h);
    if (h.st === "ramp") dcBucket((h.seg - 3) * DC_SEG, 1, function (ctx) { dcDrawRamp(ctx, h.seg - 3, 0, 1.1); });
}

function dcDrawRubble(ctx, h) {
    const p = dcScreenAt(h.seg * DC_SEG, h.gapX, 0);
    if (!p || p.y > p.clip + 2) return;
    const r = dcMulberry(h.id);
    ctx.beginPath();
    for (let i = 0; i < 9; i++) {
        const xx = p.x + (r() - 0.5) * p.w * 1.2, yy = p.y + (r() - 0.5) * Math.max(2, p.w * 0.04);
        ctx.moveTo(xx, yy); ctx.lineTo(xx + p.w * 0.05, yy - p.w * 0.015);
    }
    ctx.strokeStyle = DC_COL.dim; ctx.lineWidth = 1.2; ctx.stroke();
}

// One row of a barricade: solid panels between the gaps, hatched, with
// cyan posts marking each way through. A pipe is low and amber-striped.
function dcDrawWall(ctx, h, wl) {
    const z = wl.seg * DC_SEG;
    const p = dcScreenAt(z, 0, 0);
    if (!p) return;
    const px = p.x, py = p.y, pw = p.w, u = p.s * dcVy, clip = p.clip;
    const alpha = dcDepthAlpha(z);
    dcClipBegin(ctx, clip);
    ctx.globalAlpha = alpha;
    if (wl.low) {
        if (h.st === "open") { ctx.restore(); return; }
        const y0 = py - 120 * u, y1 = py - 300 * u;
        dcSolid(ctx, [px - 1.15 * pw, y0, px - 1.15 * pw, y1, px + 1.15 * pw, y1, px + 1.15 * pw, y0], DC_COL.hot, 4, 1.4);
        ctx.beginPath();
        for (let k = 0; k < 14; k++) { const xx = px - 1.15 * pw + k * (2.3 * pw / 14); ctx.moveTo(xx, y0); ctx.lineTo(xx + pw * 0.08, y1); }
        ctx.strokeStyle = DC_COL.amber; ctx.lineWidth = 1; ctx.stroke();
        dcLine(ctx, [px - 1.15 * pw, py, px - 1.15 * pw, y1], DC_COL.hot, 0, 1.4);
        dcLine(ctx, [px + 1.15 * pw, py, px + 1.15 * pw, y1], DC_COL.hot, 0, 1.4);
        // A shadow line on the road under it: where to take off.
        dcLine(ctx, [px - 1.1 * pw, py, px + 1.1 * pw, py], DC_COL.magenta, 0, 1.2);
        ctx.restore(); ctx.globalAlpha = 1;
        return;
    }
    const gaps = dcWallGaps(h, wl, []).sort(function (a, b) { return a.x - b.x; });
    const ht = 560 * u;
    let from = -1.15;
    const panels = [];
    for (let i = 0; i < gaps.length; i++) { panels.push([from, gaps[i].x - gaps[i].w / 2]); from = gaps[i].x + gaps[i].w / 2; }
    panels.push([from, 1.15]);
    for (let i = 0; i < panels.length; i++) {
        const x0 = Math.max(-1.15, panels[i][0]), x1 = Math.min(1.15, panels[i][1]);
        if (x1 - x0 < 0.02) continue;
        const X0 = px + x0 * pw, X1 = px + x1 * pw;
        dcSolid(ctx, [X0, py, X0, py - ht, X1, py - ht, X1, py], DC_COL.hot, 4, 1.4);
        // Hazard hatching across the panel.
        ctx.beginPath();
        const nH = Math.max(1, Math.round((x1 - x0) * 6));
        for (let k = 0; k < nH; k++) {
            const xa = dcLerp(X0, X1, k / nH), xb = dcLerp(X0, X1, (k + 1) / nH);
            ctx.moveTo(xa, py - ht * 0.15); ctx.lineTo(xb, py - ht * 0.85);
        }
        ctx.strokeStyle = DC_COL.magenta; ctx.lineWidth = Math.max(1, pw * 0.006); ctx.stroke();
    }
    // Ground line and the posts at each gap.
    dcLine(ctx, [px - 1.15 * pw, py, px + 1.15 * pw, py], DC_COL.magenta, 0, 1);
    ctx.beginPath();
    for (let i = 0; i < gaps.length; i++) {
        const gl = px + (gaps[i].x - gaps[i].w / 2) * pw, gr = px + (gaps[i].x + gaps[i].w / 2) * pw;
        ctx.moveTo(gl, py); ctx.lineTo(gl, py - ht * 1.25);
        ctx.moveTo(gr, py); ctx.lineTo(gr, py - ht * 1.25);
    }
    ctx.strokeStyle = DC_COL.cyan; ctx.lineWidth = Math.max(1.6, pw * 0.008); ctx.stroke();
    // A sliding gate shows which way it is going.
    if (wl.mv && h.st === "") {
        const dir = Math.cos(dc.simT * wl.mv.rate + wl.mv.ph) > 0 ? 1 : -1;
        for (let i = 0; i < gaps.length; i++) {
            const gx = px + gaps[i].x * pw, gy = py - ht * 1.4, s = Math.max(2, pw * 0.05);
            dcLine(ctx, [gx - dir * s, gy - s * 0.6, gx, gy, gx - dir * s, gy + s * 0.6], DC_COL.cyan, 0, 1.4);
        }
    }
    ctx.restore(); ctx.globalAlpha = 1;
}

// A tank trap (Czech hedgehog): three crossed beams.
function dcDrawTrap(ctx, h, tp) {
    const p = dcScreenAt(tp.seg * DC_SEG, tp.x, 0);
    if (!p) return;
    const u = p.s * dcVy, s = Math.max(1.5, 260 * u);
    dcClipBegin(ctx, p.clip);
    ctx.globalAlpha = dcDepthAlpha(tp.seg * DC_SEG);
    const x = p.x, y = p.y;
    dcLine(ctx, [x - s, y, x + s * 0.8, y - s * 1.5], DC_COL.hot, 4, Math.max(1.2, s * 0.08));
    dcLine(ctx, [x + s, y, x - s * 0.8, y - s * 1.5], DC_COL.hot, 4, Math.max(1.2, s * 0.08));
    dcLine(ctx, [x - s * 0.15, y - s * 0.1, x + s * 0.1, y - s * 1.7], DC_COL.hot, 4, Math.max(1.2, s * 0.08));
    dcLine(ctx, [x - s * 1.1, y, x + s * 1.1, y], DC_COL.magenta, 0, 1);
    ctx.restore(); ctx.globalAlpha = 1;
}

// Dust: one defined patch, outlined, its rubble inside it (Ry, pass 2: "more
// localized or defined"). Mines show only when scanned or right on top of you.
function dcDrawDustBuckets(h) {
    dcBucket((h.seg + h.len) * DC_SEG, 0, dcDrawDustPatch, h);
    for (let m = 0; m < h.mines.length; m++) dcBucket(h.mines[m].seg * DC_SEG, 1, dcDrawMine, h, m);
}

function dcDrawDustPatch(ctx, h) {
    const z0 = h.seg * DC_SEG, z1 = (h.seg + h.len) * DC_SEG;
    const pts = [];
    const N = 8;
    for (let i = 0; i <= N; i++) {
        const p = dcScreenAt(dcLerp(z0, z1, i / N), h.x - h.w / 2 + Math.sin(i * 1.7 + h.id) * 0.03, 0);
        if (p) pts.push(p.x, p.y);
    }
    for (let i = N; i >= 0; i--) {
        const p = dcScreenAt(dcLerp(z0, z1, i / N), h.x + h.w / 2 + Math.cos(i * 1.3 + h.id) * 0.03, 0);
        if (p) pts.push(p.x, p.y);
    }
    if (pts.length < 8) return;
    const alpha = dcDepthAlpha(z0);
    ctx.globalAlpha = alpha;
    ctx.save(); ctx.setLineDash([4, 3]);
    pts.push(pts[0], pts[1]);
    dcLine(ctx, pts, "#9A8A6A", 0, 1.2);
    ctx.restore();
    ctx.globalAlpha = alpha;
    const r = dcMulberry(h.id);
    ctx.beginPath();
    for (let i = 0; i < 60; i++) {
        const zz = z0 + (0.05 + r() * 0.9) * h.len * DC_SEG;
        const xx = h.x + (r() - 0.5) * h.w * 0.85;
        const p = dcScreenAt(zz, xx, 0);
        if (!p) continue;
        const l = Math.max(1, p.w * 0.03);
        ctx.moveTo(p.x - l, p.y); ctx.lineTo(p.x + l, p.y - l * 0.4);
    }
    ctx.strokeStyle = "#B8A47A"; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;
}

function dcDrawMine(ctx, h, m) {
    const mn = h.mines[m];
    const p = dcScreenAt(mn.seg * DC_SEG, mn.x, 0);
    if (!p || p.y > p.clip + 2) return;
    const sz = Math.max(2, p.w * 0.05);
    if (mn.st === "pop" && !(mn.popT !== undefined && dc.simT < mn.popT)) {
        ctx.beginPath(); ctx.ellipse(p.x, p.y, sz * 1.6, sz * 0.4, 0, 0, Math.PI * 2); ctx.strokeStyle = DC_COL.dim; ctx.lineWidth = 1; ctx.stroke();
        return;
    }
    const me = dc.me;
    const revealed = h.reveal && dc.simT - h.reveal < 6;
    const close = me && (mn.seg * DC_SEG - me.z) / DC_SEG < 7;
    if (!revealed && !close) return;
    const blink = DC_REDUCED || Math.floor(dc.simT * 6) % 2 === 0;
    ctx.beginPath();
    ctx.moveTo(p.x - sz, p.y - sz * 0.5); ctx.lineTo(p.x + sz, p.y + sz * 0.5);
    ctx.moveTo(p.x + sz, p.y - sz * 0.5); ctx.lineTo(p.x - sz, p.y + sz * 0.5);
    ctx.strokeStyle = DC_COL.magenta; ctx.globalAlpha = revealed ? (blink ? 1 : 0.5) : 0.45;
    ctx.lineWidth = 1.6; ctx.stroke(); ctx.globalAlpha = 1;
}

function dcDrawBeacon(ctx, b) {
    const p = dcScreenAt(b.z, b.x, 0);
    if (!p) return;
    const u = p.s * dcVy, h = 900 * u;
    const live = b.until > dc.simT;
    dcLine(ctx, [p.x - h * 0.2, p.y, p.x, p.y - h, p.x + h * 0.2, p.y], b.color, 4, 1.6);
    dcBloom(ctx, p.x, p.y - h, 2);
    if (live) {
        const ph = DC_REDUCED ? 0.5 : (dc.simT * 1.6) % 1;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, p.w * (0.2 + ph * 0.9), p.w * (0.05 + ph * 0.2), 0, 0, Math.PI * 2);
        ctx.globalAlpha = 1 - ph; ctx.strokeStyle = b.color; ctx.lineWidth = 1.5; ctx.stroke(); ctx.globalAlpha = 1;
    }
}

function dcDrawCaseOnRoad(ctx, c) {
    const p = dcScreenAt(c.z, c.x, 0);
    if (!p) return;
    const u = p.s * dcVy;
    const w = Math.max(3, 220 * u), h = Math.max(2, 140 * u);
    const blink = DC_REDUCED || Math.floor(dc.simT * 4) % 2 === 0;
    dcSolid(ctx, [p.x - w / 2, p.y, p.x - w / 2, p.y - h, p.x + w / 2, p.y - h, p.x + w / 2, p.y], DC_COL.amber, 4, 1.8);
    dcLine(ctx, [p.x - w * 0.15, p.y - h, p.x - w * 0.15, p.y - h * 1.25, p.x + w * 0.15, p.y - h * 1.25, p.x + w * 0.15, p.y - h], DC_COL.amber, 0, 1.2);
    if (blink) {
        ctx.save(); ctx.setLineDash([3, 5]);
        dcLine(ctx, [p.x, p.y - h * 1.3, p.x, Math.max(dcHy * 0.6, p.y - h * 1.3 - dcH * 0.25)], DC_COL.amber, 0, 1.2);
        ctx.restore();
    }
}

function dcDrawRiderAt(ctx, r) { dcDrawRider(ctx, r); }
