// ===================================================
//   Desert Code Racer — the VECTOR cabinet renderer
// ===================================================
// Anchor: Major Havoc (Atari, 1983) colour vector. Pure black, stroked
// geometry, no fill except black (the mothership's underside, which is
// black on black and only occludes), phosphor persistence instead of a
// clear, beam overdraw on the strong lines, and NO scanlines
// (AESTHETIC_GUIDE §1, §3.3, §4).
//
// The road is the classic pseudo-3D road: every segment's start point is
// projected once a frame into dcProj[], with the bend accumulated as an
// x offset; everything that sits on the road is placed by interpolating
// between two projected segment points (dcScreenAt).
"use strict";

let dcCv = null, dcCtx = null, dcW = 800, dcH = 600, dcDpr = 1;
let dcHy = 260;                     // horizon line
let dcK = 256;                      // x scale of the projection
let dcVy = 300;                     // y scale of the projection
let dcSkyOff = 0;
const dcCam = { x: 0, z: 0, h: DC_CAM_H };
const dcProj = [];
let dcProjBase = 0;
let dcProjN = 0;
const dcRidgeFar = [], dcRidgeNear = [];

function dcRenderInit() {
    dcCv = document.getElementById("dcCanvas");
    dcCtx = dcCv.getContext("2d");
    for (let i = 0; i <= DC_DRAW + 2; i++) dcProj.push({ x: 0, y: 0, w: 0, s: 0, cx: 0 });
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
    dcDpr = Math.min(2, window.devicePixelRatio || 1);
    dcW = Math.max(320, Math.floor(window.innerWidth - pw));
    dcH = Math.max(240, Math.floor(window.innerHeight));
    dcCv.style.width = dcW + "px";
    dcCv.style.height = dcH + "px";
    dcCv.width = Math.floor(dcW * dcDpr);
    dcCv.height = Math.floor(dcH * dcDpr);
    dcHy = Math.round(dcH * 0.43);
    dcK = dcW * 0.32;
    dcVy = dcH * 0.42;
}

// ---------------------------------------------------
//   PROJECTION
// ---------------------------------------------------
function dcProjectRoad(focus) {
    const t = dc.track;
    dcCam.z = focus.z - DC_CAM_BACK;
    dcCam.x = focus.x * DC_ROAD_W;
    const base = Math.floor(dcCam.z / DC_SEG);
    const frac = (dcCam.z / DC_SEG) - base;
    dcProjBase = base;
    const s0 = t.segs[dcClamp(base, 0, t.segs.length - 1)];
    let x = 0, dx = -(s0.curve * frac);
    let n = 0;
    for (; n <= DC_DRAW + 1; n++) {
        const si = base + n;
        if (si >= t.segs.length) break;
        const z = si * DC_SEG - dcCam.z;
        const p = dcProj[n];
        if (z <= 1) { p.s = 0; continue; }
        const s = DC_CAM_DEPTH / z;
        p.s = s;
        p.cx = x;
        p.x = dcW / 2 + s * (x - dcCam.x) * dcK;
        p.y = dcHy + s * dcCam.h * (dcVy);
        p.w = s * DC_ROAD_W * dcK;
        x += dx;
        dx += t.segs[si].curve;
    }
    dcProjN = n;
}

// Screen point for world (z, x) on the road, x in road units. y is the
// height above the road in world units.
const dcSP = { x: 0, y: 0, w: 0, s: 0 };
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
    return dcSP;
}

function dcBikeScreen() {
    const f = dcFocus();
    if (!f) return null;
    const p = dcScreenAt(f.z, f.x, 0);
    return p ? { x: p.x, y: p.y } : null;
}

function dcFocus() { return dc.me; }

// ---------------------------------------------------
//   THE FRAME
// ---------------------------------------------------
function dcRender() {
    const ctx = dcCtx;
    if (!ctx || !dc.track || !dc.me) return;
    ctx.setTransform(dcDpr, 0, 0, dcDpr, 0, 0);
    if (typeof RETRO !== "undefined") RETRO.persist(ctx, dcW, dcH, DC_REDUCED ? 1 : 0.42);
    else { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, dcW, dcH); }

    const f = dcFocus();
    dcSkyOff += (dcSegAt(f.z).curve * (f.v / DC_CRUISE)) * 0.0016;
    dcProjectRoad(f);

    ctx.save();
    if (dcShakeAmt > 0) ctx.translate((Math.random() - 0.5) * dcShakeAmt, (Math.random() - 0.5) * dcShakeAmt);
    dcDrawSky(ctx);
    dcDrawGround(ctx);
    dcDrawRoad(ctx);
    dcDrawScenery(ctx);
    dcDrawHazards(ctx);
    dcDrawBeacons(ctx);
    dcDrawCase(ctx);
    dcDrawFx(ctx, false);
    dcDrawRiders(ctx);
    dcDrawBeams(ctx);
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
    if (wide) { ctx.globalAlpha = 0.2; ctx.strokeStyle = col; ctx.lineWidth = wide; ctx.stroke(); }
    ctx.globalAlpha = 1; ctx.strokeStyle = col; ctx.lineWidth = core || 1.4; ctx.stroke();
}

function dcBloom(ctx, x, y, r) {
    ctx.fillStyle = DC_COL.hot;
    ctx.fillRect(x - r, y - r, r * 2, r * 2);
}

// ---------------------------------------------------
//   SKY: ridges, the mothership, the second ship
// ---------------------------------------------------
function dcDrawSky(ctx) {
    const off = dcSkyOff;
    // Far ridge.
    const fw = dcW * 1.6, step = fw / (dcRidgeFar.length - 1);
    let sx = -((off * dcW * 0.6) % fw);
    if (sx > 0) sx -= fw;
    for (let rep = 0; rep < 3; rep++) {
        const pts = [];
        for (let i = 0; i < dcRidgeFar.length; i++) pts.push(sx + rep * fw + i * step, dcHy - dcRidgeFar[i] * dcH * 0.11);
        dcLine(ctx, pts, "#4B3A8C", 0, 1.2);
    }
    // The mothership, hanging over the horizon (parallax between the ridges).
    dcDrawMothership(ctx, dcHy - dcH * 0.2);
    // Near ridge.
    const nw = dcW * 2.2, nstep = nw / (dcRidgeNear.length - 1);
    let nx = -((off * dcW * 1.4) % nw);
    if (nx > 0) nx -= nw;
    for (let rep = 0; rep < 3; rep++) {
        const pts = [];
        for (let i = 0; i < dcRidgeNear.length; i++) pts.push(nx + rep * nw + i * nstep, dcHy - dcRidgeNear[i] * dcH * 0.07);
        dcLine(ctx, pts, DC_COL.hue, 4, 1.4);
    }
    // Horizon.
    dcLine(ctx, [0, dcHy, dcW, dcHy], "#4B3A8C", 0, 1);
    dcDrawSmallShip(ctx);
}

const dcShip = { x: 0, y: 0, eyeX: 0, eyeY: 0, sx: 0, sy: 0 };

function dcDrawMothership(ctx, cy) {
    // Keep it on screen: it wanders a little with the bends, never off.
    const cx = dcW / 2 + Math.sin(dcSkyOff * 2.1) * dcW * 0.18;
    const w = dcW * 0.46, h = dcH * 0.13;
    const topW = w * 0.34;
    const t = dc.simT;
    dcShip.x = cx; dcShip.y = cy;
    const x0 = cx - w / 2, x1 = cx + w / 2;
    const yTop = cy - h * 0.55, yBot = cy + h * 0.25, yUnder = cy + h * 0.45;
    // Black underside first (occludes the far ridge behind it).
    ctx.fillStyle = "#000";
    ctx.beginPath();
    ctx.moveTo(x0, yBot); ctx.lineTo(cx - topW / 2, yTop); ctx.lineTo(cx + topW / 2, yTop); ctx.lineTo(x1, yBot);
    ctx.lineTo(x1 - w * 0.08, yUnder); ctx.lineTo(x0 + w * 0.08, yUnder); ctx.closePath();
    ctx.fill();
    // Hull: the wedge, hatched like the sketch.
    dcLine(ctx, [x0, yBot, cx - topW / 2, yTop, cx + topW / 2, yTop, x1, yBot], DC_COL.mid, 4, 1.4);
    ctx.beginPath();
    for (let i = 1; i < 22; i++) {
        const u = i / 22;
        const xb = dcLerp(x0, x1, u), xt = dcLerp(cx - topW / 2, cx + topW / 2, u);
        ctx.moveTo(xt, yTop + 2); ctx.lineTo(dcLerp(xt, xb, 0.85), dcLerp(yTop, yBot, 0.85));
    }
    ctx.globalAlpha = 0.45; ctx.strokeStyle = DC_COL.mid; ctx.lineWidth = 1; ctx.stroke(); ctx.globalAlpha = 1;
    // The dome hatch on top.
    ctx.beginPath(); ctx.ellipse(cx, yTop, topW * 0.28, h * 0.12, 0, Math.PI, 0); ctx.strokeStyle = DC_COL.mid; ctx.lineWidth = 1.2; ctx.stroke();
    // The red rim, breathing on one slow clock (the story's breath rule).
    const breath = DC_REDUCED ? 1 : 0.7 + 0.3 * Math.sin(t * 1.4);
    ctx.globalAlpha = breath;
    dcLine(ctx, [x0, yBot, x0 + w * 0.08, yUnder, x1 - w * 0.08, yUnder, x1, yBot], DC_COL.magenta, 6, 2);
    ctx.globalAlpha = 1;
    // The eye under it: where the beams come from.
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
    const x = dcW * 0.09 + Math.sin(t * 0.23) * dcW * 0.04, y = dcH * 0.09 + Math.sin(t * 0.37) * dcH * 0.015;
    const w = dcW * 0.2, h = dcH * 0.035;
    dcShip.sx = x + w * 0.7; dcShip.sy = y + h * 0.6;
    ctx.fillStyle = "#000";
    ctx.beginPath(); ctx.moveTo(x, y + h * 0.6); ctx.lineTo(x + w, y - h * 0.4); ctx.lineTo(x + w, y + h * 0.7); ctx.closePath(); ctx.fill();
    dcLine(ctx, [x, y + h * 0.6, x + w, y - h * 0.4, x + w, y + h * 0.7], DC_COL.mid, 3, 1.2);
    dcLine(ctx, [x + w * 0.04, y + h * 0.66, x + w, y + h * 0.8], DC_COL.magenta, 4, 1.6);
    dcBloom(ctx, x, y + h * 0.6, 1.2);
}

// ---------------------------------------------------
//   GROUND AND ROAD
// ---------------------------------------------------
function dcDrawGround(ctx) {
    // Ground lines rushing past: the speed cue a vector racer has instead of texture.
    ctx.beginPath();
    for (let n = 1; n < dcProjN; n++) {
        const si = dcProjBase + n;
        if (si % 8 !== 0) continue;
        const p = dcProj[n];
        if (!p.s) continue;
        ctx.moveTo(p.x - p.w * 5, p.y); ctx.lineTo(p.x - p.w * 1.1, p.y);
        ctx.moveTo(p.x + p.w * 1.1, p.y); ctx.lineTo(p.x + p.w * 5, p.y);
    }
    ctx.strokeStyle = "#241C44"; ctx.lineWidth = 1; ctx.stroke();
}

function dcDrawRoad(ctx) {
    const L = [], R = [];
    for (let n = 1; n < dcProjN; n++) {
        const p = dcProj[n];
        if (!p.s) continue;
        L.push(p.x - p.w, p.y); R.push(p.x + p.w, p.y);
    }
    dcLine(ctx, L, DC_COL.hue, 5, 1.6);
    dcLine(ctx, R, DC_COL.hue, 5, 1.6);
    // Centre dashes and edge ticks.
    ctx.beginPath();
    for (let n = 1; n + 1 < dcProjN; n++) {
        const si = dcProjBase + n;
        const a = dcProj[n], b = dcProj[n + 1];
        if (!a.s || !b.s) continue;
        if (Math.floor(si / 3) % 2 === 0) { ctx.moveTo(a.x, a.y); ctx.lineTo(b.x, b.y); }
        if (si % 6 === 0) {
            ctx.moveTo(a.x - a.w, a.y); ctx.lineTo(a.x - a.w * 1.1, a.y);
            ctx.moveTo(a.x + a.w, a.y); ctx.lineTo(a.x + a.w * 1.1, a.y);
        }
    }
    ctx.strokeStyle = DC_COL.mid; ctx.lineWidth = 1.2; ctx.stroke();
    // Checkpoint gantries and the bases.
    const t = dc.track;
    for (let L2 = 0; L2 < 3; L2++) dcDrawGantry(ctx, t.cpSeg[L2], L2 === 2 ? "MOUNTAIN BASE" : DC_LEG_NAMES[L2 + 1].split(" ")[1]);
    dcDrawDome(ctx, 22, -2.6);
    dcDrawBunker(ctx, t.finish + 30);
}

function dcDrawGantry(ctx, seg, label) {
    const p = dcScreenAt(seg * DC_SEG, 0, 0);
    if (!p) return;
    const w = p.w * 1.15, h = p.s * 2600 * dcVy;
    const pts = [p.x - w, p.y, p.x - w, p.y - h, p.x + w, p.y - h, p.x + w, p.y];
    dcLine(ctx, pts, DC_COL.cyan, 5, 1.8);
    dcBloom(ctx, p.x - w, p.y - h, 1.5); dcBloom(ctx, p.x + w, p.y - h, 1.5);
    const size = Math.max(4, Math.min(30, h * 0.16));
    dcText(ctx, label, p.x, p.y - h + size * 0.5, size, DC_COL.cyan, "center");
}

function dcDrawDome(ctx, seg, x) {
    const p = dcScreenAt(seg * DC_SEG, x, 0);
    if (!p) return;
    const r = p.s * 2400 * dcK;
    // A geodesic dome: a half circle and its struts.
    ctx.beginPath();
    ctx.arc(p.x, p.y, r, Math.PI, 0);
    for (let i = 1; i < 6; i++) {
        const a = Math.PI + i * Math.PI / 6;
        ctx.moveTo(p.x, p.y - r); ctx.lineTo(p.x + Math.cos(a) * r, p.y + Math.sin(a) * r);
    }
    ctx.moveTo(p.x - r * 0.87, p.y - r * 0.5); ctx.lineTo(p.x + r * 0.87, p.y - r * 0.5);
    ctx.strokeStyle = DC_COL.cyan; ctx.lineWidth = 1.4; ctx.stroke();
}

function dcDrawBunker(ctx, seg) {
    const p = dcScreenAt(seg * DC_SEG, 0, 0);
    if (!p) return;
    const w = p.w * 1.6, h = p.s * 5200 * dcVy;
    // The mountain base: a mountain with a door cut into it.
    const pts = [p.x - w * 3, p.y, p.x - w * 1.2, p.y - h * 1.3, p.x - w * 0.4, p.y - h * 0.9, p.x + w * 0.5, p.y - h * 1.7, p.x + w * 3, p.y];
    dcLine(ctx, pts, DC_COL.hue, 5, 1.6);
    dcLine(ctx, [p.x - w * 0.5, p.y, p.x - w * 0.5, p.y - h * 0.55, p.x + w * 0.5, p.y - h * 0.55, p.x + w * 0.5, p.y], DC_COL.cyan, 5, 1.8);
}

// ---------------------------------------------------
//   SCENERY: cacti, scrub, rocks
// ---------------------------------------------------
function dcDrawScenery(ctx) {
    ctx.lineCap = "round";
    for (let n = dcProjN - 2; n >= 1; n--) {
        const sg = dc.track.segs[dcProjBase + n];
        if (!sg || !sg.scene.length) continue;
        for (let k = 0; k < sg.scene.length; k++) {
            const o = sg.scene[k];
            const p = dcScreenAt((dcProjBase + n) * DC_SEG, o.x, 0);
            if (!p || p.x < -100 || p.x > dcW + 100) continue;
            const u = p.s * dcVy;          // px per world unit, vertically
            if (o.kind === "cactus") dcDrawCactus(ctx, p.x, p.y, u * 1100 * o.h);
            else if (o.kind === "scrub") dcDrawScrub(ctx, p.x, p.y, u * 380 * o.h);
            else dcDrawRock(ctx, p.x, p.y, u * 420 * o.h);
        }
    }
}

function dcDrawCactus(ctx, x, y, h) {
    if (h < 1.5) return;
    const w = h * 0.12;
    ctx.beginPath();
    ctx.moveTo(x, y); ctx.lineTo(x, y - h);
    ctx.moveTo(x, y - h * 0.45); ctx.lineTo(x - w * 2.2, y - h * 0.45); ctx.lineTo(x - w * 2.2, y - h * 0.75);
    ctx.moveTo(x, y - h * 0.6); ctx.lineTo(x + w * 1.9, y - h * 0.6); ctx.lineTo(x + w * 1.9, y - h * 0.85);
    ctx.globalAlpha = 0.25; ctx.strokeStyle = "#39C46A"; ctx.lineWidth = Math.max(1, w * 1.4); ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = Math.max(1, w * 0.35); ctx.stroke();
}

function dcDrawScrub(ctx, x, y, h) {
    if (h < 1) return;
    ctx.beginPath();
    for (let i = -2; i <= 2; i++) { ctx.moveTo(x + i * h * 0.15, y); ctx.lineTo(x + i * h * 0.45, y - h * (1 - Math.abs(i) * 0.2)); }
    ctx.strokeStyle = "#7A6A3A"; ctx.lineWidth = 1; ctx.stroke();
}

function dcDrawRock(ctx, x, y, h) {
    if (h < 1) return;
    dcLine(ctx, [x - h, y, x - h * 0.6, y - h * 0.7, x + h * 0.2, y - h, x + h, y], "#5B4E8C", 0, 1);
}

// ---------------------------------------------------
//   HAZARDS
// ---------------------------------------------------
function dcDrawHazards(ctx) {
    const s0 = dcProjBase + 1, s1 = dcProjBase + dcProjN - 2;
    const list = dcHazardsIn(s0, s1);
    for (let i = list.length - 1; i >= 0; i--) {
        const h = list[i];
        if (h.type === "crater") dcDrawCrater(ctx, h);
        else if (h.type === "barricade") dcDrawBarricade(ctx, h);
        else dcDrawDust(ctx, h);
    }
}

function dcEllipseOnRoad(ctx, z, x, r, len) {
    const a = dcScreenAt(z, x, 0);
    if (!a) return null;
    const ax = a.x, ay = a.y, aw = a.w;
    const b = dcScreenAt(z + len * DC_SEG, x, 0);
    const ry = b ? Math.max(1, (ay - b.y) / 2) : 2;
    const cy = b ? (ay + b.y) / 2 : ay;
    const cx = b ? (ax + b.x) / 2 : ax;
    return { x: cx, y: cy, rx: r * aw, ry: ry };
}

function dcDrawCrater(ctx, h) {
    const e = dcEllipseOnRoad(ctx, h.seg * DC_SEG, h.x, h.r, h.len);
    if (!e) return;
    const col = h.st === "ramp" ? DC_COL.cyan : DC_COL.magenta;
    ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx, e.ry, 0, 0, Math.PI * 2);
    ctx.globalAlpha = 0.25; ctx.strokeStyle = col; ctx.lineWidth = 5; ctx.stroke();
    ctx.globalAlpha = 1; ctx.lineWidth = 1.6; ctx.stroke();
    ctx.beginPath(); ctx.ellipse(e.x, e.y, e.rx * 0.7, e.ry * 0.6, 0, 0, Math.PI * 2);
    ctx.moveTo(e.x - e.rx * 0.5, e.y + e.ry * 0.9); ctx.lineTo(e.x + e.rx * 0.4, e.y - e.ry * 1.1);
    ctx.lineWidth = 1; ctx.stroke();
    if (h.st === "ramp") dcDrawRamp(ctx, h.seg - 3, h.x, h.r * 1.2);
}

function dcDrawRamp(ctx, seg, x, half) {
    const a = dcScreenAt(seg * DC_SEG, x, 0), b0 = a ? { x: a.x, y: a.y, w: a.w, s: a.s } : null;
    const b = dcScreenAt((seg + 3) * DC_SEG, x, 500);
    if (!b0 || !b) return;
    const w0 = half * b0.w, w1 = half * b.w;
    dcLine(ctx, [b0.x - w0, b0.y, b.x - w1, b.y, b.x + w1, b.y, b0.x + w0, b0.y], DC_COL.cyan, 5, 1.6);
    ctx.beginPath();
    for (let i = 1; i < 4; i++) { const u = i / 4; ctx.moveTo(dcLerp(b0.x - w0, b.x - w1, u), dcLerp(b0.y, b.y, u)); ctx.lineTo(dcLerp(b0.x + w0, b.x + w1, u), dcLerp(b0.y, b.y, u)); }
    ctx.strokeStyle = DC_COL.cyan; ctx.lineWidth = 1; ctx.stroke();
}

function dcDrawBarricade(ctx, h) {
    const z = h.seg * DC_SEG;
    if (h.st === "gone") {
        const p = dcScreenAt(z, h.gapX, 0);
        if (!p) return;
        ctx.beginPath();
        for (let i = 0; i < 9; i++) { const xx = p.x + (i - 4) * p.w * 0.2, yy = p.y + ((i * 37) % 7 - 3) * 0.6; ctx.moveTo(xx, yy); ctx.lineTo(xx + p.w * 0.06, yy - 1); }
        ctx.strokeStyle = DC_COL.dim; ctx.lineWidth = 1.2; ctx.stroke();
        return;
    }
    const gw = h.st === "open" ? 1.15 : h.gapW;
    const gl = h.gapX - gw / 2, gr = h.gapX + gw / 2;
    const p = dcScreenAt(z, 0, 0);
    if (!p) return;
    const px = p.x, py = p.y, pw = p.w, u = p.s * dcVy;
    const ht = 520 * u;
    function zig(x0, x1) {
        if (x1 - x0 < 0.02) return;
        const pts = [];
        const n = Math.max(2, Math.round((x1 - x0) * 7));
        for (let i = 0; i <= n; i++) {
            const xx = px + dcLerp(x0, x1, i / n) * pw;
            pts.push(xx, py - (i % 2 ? ht : ht * 0.35));
        }
        dcLine(ctx, pts, DC_COL.hot, 4, 1.4);
        dcLine(ctx, [px + x0 * pw, py, px + x1 * pw, py], DC_COL.magenta, 0, 1.2);
    }
    zig(-1.15, Math.max(-1.15, gl));
    zig(Math.min(1.15, gr), 1.15);
    // The gap, marked navigable (cyan posts).
    ctx.beginPath();
    ctx.moveTo(px + gl * pw, py); ctx.lineTo(px + gl * pw, py - ht * 1.2);
    ctx.moveTo(px + gr * pw, py); ctx.lineTo(px + gr * pw, py - ht * 1.2);
    ctx.strokeStyle = DC_COL.cyan; ctx.lineWidth = 1.6; ctx.stroke();
    if (h.st === "ramp") dcDrawRamp(ctx, h.seg - 3, 0, 1.1);
}

function dcDrawDust(ctx, h) {
    const z0 = h.seg * DC_SEG;
    const r = dcMulberry(h.id);
    ctx.beginPath();
    for (let i = 0; i < 46; i++) {
        const zz = z0 + r() * h.len * DC_SEG;
        const xx = h.x + (r() - 0.5) * h.w;
        const p = dcScreenAt(zz, xx, 0);
        if (!p) continue;
        const l = Math.max(1, p.w * 0.04);
        ctx.moveTo(p.x - l, p.y); ctx.lineTo(p.x + l, p.y - l * 0.3);
    }
    ctx.strokeStyle = "#9A8A6A"; ctx.lineWidth = 1; ctx.stroke();
    // Mines: hidden unless revealed by a scan, or right on top of you.
    const me = dc.me;
    const revealed = h.reveal && dc.simT - h.reveal < 6;
    for (let m = 0; m < h.mines.length; m++) {
        const mn = h.mines[m];
        const p = dcScreenAt(mn.seg * DC_SEG, mn.x, 0);
        if (!p) continue;
        const sz = Math.max(2, p.w * 0.05);
        if (mn.st === "pop") {
            if (mn.popT !== undefined && dc.simT < mn.popT) { /* the pulse hasn't reached it */ }
            else { ctx.beginPath(); ctx.ellipse(p.x, p.y, sz * 1.6, sz * 0.4, 0, 0, Math.PI * 2); ctx.strokeStyle = DC_COL.dim; ctx.lineWidth = 1; ctx.stroke(); continue; }
        }
        const close = me && (mn.seg * DC_SEG - me.z) / DC_SEG < 7;
        if (!revealed && !close) continue;
        const blink = DC_REDUCED || Math.floor(dc.simT * 6) % 2 === 0;
        ctx.beginPath();
        ctx.moveTo(p.x - sz, p.y - sz * 0.5); ctx.lineTo(p.x + sz, p.y + sz * 0.5);
        ctx.moveTo(p.x + sz, p.y - sz * 0.5); ctx.lineTo(p.x - sz, p.y + sz * 0.5);
        ctx.strokeStyle = DC_COL.magenta; ctx.globalAlpha = revealed ? (blink ? 1 : 0.5) : 0.45;
        ctx.lineWidth = 1.6; ctx.stroke(); ctx.globalAlpha = 1;
    }
}

function dcDrawBeacons(ctx) {
    for (let i = 0; i < dc.beacons.length; i++) {
        const b = dc.beacons[i];
        const p = dcScreenAt(b.z, b.x, 0);
        if (!p) continue;
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
}

function dcDrawCase(ctx) {
    const c = dc.caseS;
    if (!c || c.holder || c.over) return;
    const p = dcScreenAt(c.z, c.x, 0);
    if (!p) return;
    const u = p.s * dcVy;
    const w = Math.max(3, 220 * u), h = Math.max(2, 140 * u);
    const blink = DC_REDUCED || Math.floor(dc.simT * 4) % 2 === 0;
    dcLine(ctx, [p.x - w / 2, p.y, p.x - w / 2, p.y - h, p.x + w / 2, p.y - h, p.x + w / 2, p.y, p.x - w / 2, p.y], DC_COL.amber, 4, 1.8);
    dcLine(ctx, [p.x - w * 0.15, p.y - h, p.x - w * 0.15, p.y - h * 1.25, p.x + w * 0.15, p.y - h * 1.25, p.x + w * 0.15, p.y - h], DC_COL.amber, 0, 1.2);
    // A locator line straight up, so the case reads from far down the road.
    if (blink) {
        ctx.save(); ctx.setLineDash([3, 5]);
        dcLine(ctx, [p.x, p.y - h * 1.3, p.x, Math.max(dcHy * 0.6, p.y - h * 1.3 - dcH * 0.25)], DC_COL.amber, 0, 1.2);
        ctx.restore();
    }
}

// ---------------------------------------------------
//   RIDERS
// ---------------------------------------------------
function dcDrawRiders(ctx) {
    const list = [];
    for (const id in dc.riders) list.push(dc.riders[id]);
    list.sort(function (a, b) { return b.z - a.z; });
    for (let i = 0; i < list.length; i++) {
        const r = list[i];
        const p = dcScreenAt(r.z, r.x, 0);
        if (!p) continue;
        const u = p.s * dcVy;
        const lift = r.air > 0 && r.airMax > 0 ? Math.sin(Math.PI * dcClamp(1 - r.air / r.airMax, 0, 1)) * 520 * u : 0;
        dcDrawBike(ctx, p.x, p.y, u, r, lift);
        if (!r.local && u > 0.004) {
            const a = DC_ABILITY[r.role];
            dcText(ctx, a ? a.crew : r.name, p.x, p.y - 520 * u - lift - 12, Math.max(6, Math.min(12, u * 900)), r.color, "center");
        }
    }
}

function dcDrawBike(ctx, x, y, u, r, lift) {
    const s = u * 430;                      // bike height scale, px
    if (s < 1.2) return;
    const col = r.color;
    const t = dc.simT;
    // Shadow under a jump.
    if (lift > 0) { ctx.beginPath(); ctx.ellipse(x, y, s * 0.28, s * 0.05, 0, 0, Math.PI * 2); ctx.strokeStyle = DC_COL.dim; ctx.lineWidth = 1; ctx.stroke(); }
    ctx.save();
    ctx.translate(x, y - lift);
    if (r.down > 0) {
        // Down: the bike on its side, sparks.
        ctx.rotate(1.35);
        dcLine(ctx, [-s * 0.1, 0, -s * 0.1, -s * 0.5, s * 0.1, -s * 0.55, s * 0.12, 0], col, 3, 1.2);
        ctx.restore();
        if (!DC_REDUCED && Math.random() < 0.4) dcBloom(ctx, x + (Math.random() - 0.5) * s * 0.6, y - Math.random() * s * 0.2, 1.2);
        return;
    }
    ctx.rotate(r.lean * 0.32);
    const wob = r.stumble > 0 ? Math.sin(t * 40) * 0.12 : 0;
    if (wob) ctx.rotate(wob);
    // Rear wheel (seen from behind: a tall narrow ellipse).
    ctx.beginPath(); ctx.ellipse(0, -s * 0.2, s * 0.07, s * 0.2, 0, 0, Math.PI * 2);
    ctx.strokeStyle = DC_COL.mid; ctx.lineWidth = Math.max(1, s * 0.02); ctx.stroke();
    // Fairing and tail.
    const body = [-s * 0.22, -s * 0.34, -s * 0.13, -s * 0.58, s * 0.13, -s * 0.58, s * 0.22, -s * 0.34, s * 0.09, -s * 0.24, -s * 0.09, -s * 0.24, -s * 0.22, -s * 0.34];
    dcLine(ctx, body, col, Math.max(2, s * 0.06), Math.max(1.2, s * 0.018));
    // Tail light bar (brighter on a brake... and in a boost, the exhaust flares).
    dcLine(ctx, [-s * 0.12, -s * 0.36, s * 0.12, -s * 0.36], DC_COL.magenta, 0, Math.max(1, s * 0.02));
    if (r.boosting || dcRamming(r.id)) {
        const fl = DC_REDUCED ? 0.18 : 0.12 + Math.random() * 0.12;
        dcLine(ctx, [-s * 0.08, -s * 0.28, 0, -s * (0.28 - fl) + s * 0.25, s * 0.08, -s * 0.28], dcRamming(r.id) ? col : DC_COL.amber, 3, 1.2);
    }
    // Rider: hunched torso, helmet, arms to the bars.
    dcLine(ctx, [-s * 0.15, -s * 0.58, -s * 0.11, -s * 0.86, s * 0.11, -s * 0.86, s * 0.15, -s * 0.58], DC_COL.hot, 0, Math.max(1, s * 0.016));
    ctx.beginPath(); ctx.ellipse(0, -s * 0.96, s * 0.085, s * 0.095, 0, 0, Math.PI * 2);
    ctx.strokeStyle = col; ctx.lineWidth = Math.max(1, s * 0.02); ctx.stroke();
    dcLine(ctx, [-s * 0.11, -s * 0.8, -s * 0.26, -s * 0.66], DC_COL.hot, 0, Math.max(1, s * 0.014));
    dcLine(ctx, [s * 0.11, -s * 0.8, s * 0.26, -s * 0.66], DC_COL.hot, 0, Math.max(1, s * 0.014));
    dcBloom(ctx, -s * 0.22, -s * 0.34, Math.max(0.8, s * 0.008)); dcBloom(ctx, s * 0.22, -s * 0.34, Math.max(0.8, s * 0.008));
    // The case, strapped behind the seat.
    if (dcCarrying(r)) {
        dcLine(ctx, [-s * 0.12, -s * 0.58, -s * 0.12, -s * 0.72, s * 0.12, -s * 0.72, s * 0.12, -s * 0.58, -s * 0.12, -s * 0.58], DC_COL.amber, 3, Math.max(1.2, s * 0.02));
    }
    // Krill, latched and wriggling.
    if (r.krill > 0) {
        for (let k = 0; k < r.krill; k++) {
            const a = k * 2.1 + (DC_REDUCED ? 0 : t * 5);
            const kx = Math.cos(a) * s * 0.22, ky = -s * (0.45 + 0.2 * Math.sin(a * 1.3));
            dcDrawKrillShape(ctx, kx, ky, s * 0.07, a);
        }
    }
    ctx.restore();
    // Status rings drawn upright, after the lean.
    const sh = dcShieldOf(r.id);
    if (sh) {
        const owner = dc.riders[sh.by];
        const c2 = owner ? owner.color : DC_COL.hot;
        ctx.beginPath();
        for (let i = 0; i <= 6; i++) {
            const a = Math.PI + i * Math.PI / 6;
            const px = x + Math.cos(a) * s * 0.5, py = y - lift + Math.sin(a) * s * 1.15 - s * 0.05;
            if (i === 0) ctx.moveTo(px, py); else ctx.lineTo(px, py);
        }
        ctx.globalAlpha = DC_REDUCED ? 0.8 : 0.6 + 0.3 * Math.sin(t * 12);
        ctx.strokeStyle = c2; ctx.lineWidth = 2; ctx.stroke(); ctx.globalAlpha = 1;
    }
    if (r.local ? dcPatched(r) : false) {
        const c3 = (dc.riders[r.patchedBy] || {}).color || DC_COL.hot;
        const cy = y - lift - s * 1.25, k = s * 0.08;
        dcLine(ctx, [x - k, cy, x + k, cy], c3, 3, 1.6);
        dcLine(ctx, [x, cy - k, x, cy + k], c3, 3, 1.6);
    }
    if (r.inv > 0 && r.local && !DC_REDUCED && Math.floor(t * 12) % 2 === 0) {
        ctx.beginPath(); ctx.ellipse(x, y - lift - s * 0.5, s * 0.35, s * 0.6, 0, 0, Math.PI * 2);
        ctx.strokeStyle = DC_COL.dim; ctx.lineWidth = 1; ctx.stroke();
    }
}

function dcDrawKrillShape(ctx, x, y, s, a) {
    // An airkrill: a chevron body and two flicking legs, eyes in danger magenta.
    ctx.beginPath();
    ctx.moveTo(x - s, y - s * 0.5); ctx.lineTo(x, y + s * 0.3); ctx.lineTo(x + s, y - s * 0.5);
    ctx.moveTo(x - s * 0.5, y); ctx.lineTo(x - s * 0.9, y + s * (0.6 + 0.3 * Math.sin(a * 3)));
    ctx.moveTo(x + s * 0.5, y); ctx.lineTo(x + s * 0.9, y + s * (0.6 + 0.3 * Math.cos(a * 3)));
    ctx.strokeStyle = DC_COL.hot; ctx.lineWidth = Math.max(1, s * 0.25); ctx.stroke();
    ctx.fillStyle = DC_COL.magenta;
    ctx.fillRect(x - s * 0.25, y - s * 0.15, Math.max(1, s * 0.18), Math.max(1, s * 0.18));
}

// ---------------------------------------------------
//   BEAMS AND KRILL IN FLIGHT
// ---------------------------------------------------
function dcDrawBeams(ctx) {
    for (let i = 0; i < dc.beams.length; i++) {
        const b = dc.beams[i];
        if (b.phase === "gone") continue;
        const aim = b.phase === "lock" ? { z: b.z, x: b.x } : dcBeamAim(b);
        const p = dcScreenAt(aim.z, aim.x, 0);
        const sx = b.src === 1 ? dcShip.sx : dcShip.eyeX, sy = b.src === 1 ? dcShip.sy : dcShip.eyeY;
        let ex, ey, rr = 0, ry = 0;
        if (p) { ex = p.x; ey = p.y; rr = DC_RING * p.w; ry = Math.max(2, rr * 0.22); }
        else { ex = dcW / 2 + (aim.x - dcCam.x / DC_ROAD_W) * dcW * 0.3; ey = dcH * 0.98; rr = 40; ry = 8; }
        const lock = b.phase === "lock";
        const col = b.safe ? DC_COL.cyan : DC_COL.magenta;
        // The weaving dotted beam (dots flow downward).
        const n = 34;
        const prog = lock ? 1 : dcClamp((dc.simT - b.t) / DC_TUNE.track, 0, 1);
        const flow = DC_REDUCED ? 0 : (dc.simT * 3) % 1;
        ctx.fillStyle = col;
        for (let k = 0; k < n; k++) {
            const u = (k + flow) / n;
            if (u > prog) break;
            const amp = (1 - u) * dcW * 0.05 * (lock ? 0.4 : 1);
            const wx = Math.sin(u * Math.PI * 3 + b.phs + dc.simT * (lock ? 6 : 2)) * amp;
            const xx = dcLerp(sx, ex, u) + wx, yy = dcLerp(sy, ey, u);
            const d = lock ? 2.2 : 1.5;
            ctx.globalAlpha = lock ? 1 : 0.6;
            ctx.fillRect(xx - d / 2, yy - d / 2, d, d);
        }
        ctx.globalAlpha = 1;
        // The ring on the road.
        if (p) {
            const left = lock ? Math.max(0, b.impactAt - dc.simT) : 1;
            const flash = lock && !DC_REDUCED && Math.floor(dc.simT * (left < 0.35 ? 20 : 10)) % 2 === 0;
            ctx.save();
            if (!lock) ctx.setLineDash([4, 4]);
            ctx.beginPath(); ctx.ellipse(ex, ey, rr, ry, 0, 0, Math.PI * 2);
            ctx.globalAlpha = 0.25; ctx.strokeStyle = col; ctx.lineWidth = 6; ctx.stroke();
            ctx.globalAlpha = lock ? (flash ? 1 : 0.7) : 0.7; ctx.lineWidth = lock ? 2.2 : 1.4; ctx.stroke();
            ctx.restore();
            if (lock) {
                dcLine(ctx, [ex - rr * 0.6, ey, ex + rr * 0.6, ey], col, 0, 1);
                dcLine(ctx, [ex - rr * 0.35, ey + ry * 0.9, ex + rr * 0.35, ey - ry * 0.9], col, 0, 1);
            }
        }
    }
    // Krill in flight: a little flock homing in from the horizon.
    for (let i = 0; i < dc.krill.length; i++) {
        const k = dc.krill[i];
        if (k.phase !== "fly") continue;
        const r = dc.riders[k.tg];
        if (!r) continue;
        const u = dcClamp((dc.simT - k.t) / Math.max(0.1, k.arriveAt - k.t), 0, 1);
        const p = dcScreenAt(r.z, r.x, 0);
        if (!p) continue;
        const sx = dcShip.eyeX, sy = dcShip.eyeY;
        const tx = p.x, ty = p.y - p.s * dcVy * 600;
        for (let j = 0; j < 5; j++) {
            const jj = j * 1.7 + k.seed;
            const xx = dcLerp(sx, tx, u) + Math.sin(jj + dc.simT * 7) * 18 * (1 - u * 0.7);
            const yy = dcLerp(sy, ty, u * u) + Math.cos(jj * 1.3 + dc.simT * 6) * 10;
            dcDrawKrillShape(ctx, xx, yy, 3 + 9 * u, jj + dc.simT * 9);
        }
    }
}

// ---------------------------------------------------
//   FX
// ---------------------------------------------------
function dcDrawFx(ctx, top) {
    for (let i = 0; i < dc.fx.length; i++) {
        const f = dc.fx[i];
        if (f.delay > 0) continue;
        const air = f.y > 50 || f.kind === "tracer";
        if (air !== top && f.kind !== "pulse") continue;
        if (f.kind === "pulse" && top) continue;
        const k = f.t / f.life;
        if (f.kind === "pulse") {
            const zz = f.z + k * f.len * DC_SEG;
            const p = dcScreenAt(zz, 0, 0);
            if (!p) continue;
            ctx.globalAlpha = 1 - k * 0.6;
            dcLine(ctx, [p.x - p.w * 1.3, p.y, p.x + p.w * 1.3, p.y], f.col, 6, 2);
            ctx.globalAlpha = 1;
            continue;
        }
        const p = dcScreenAt(f.z, f.x, f.y);
        if (!p) continue;
        if (f.kind === "ring") {
            const r = dcLerp(f.r0, f.r1, k) * p.w;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, r, Math.max(1, r * (f.y > 50 ? 0.9 : 0.24)), 0, 0, Math.PI * 2);
            ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.col; ctx.lineWidth = 1.6; ctx.stroke(); ctx.globalAlpha = 1;
        } else if (f.kind === "star") {
            const len = f.len * p.s * dcVy * (0.4 + k);
            ctx.beginPath();
            for (let j = 0; j < f.n; j++) {
                const a = -Math.PI * (j + 0.5) / f.n;
                ctx.moveTo(p.x + Math.cos(a) * len * 0.35, p.y + Math.sin(a) * len * 0.35);
                ctx.lineTo(p.x + Math.cos(a) * len, p.y + Math.sin(a) * len);
            }
            ctx.globalAlpha = 1 - k; ctx.strokeStyle = f.col; ctx.lineWidth = 1.6; ctx.stroke(); ctx.globalAlpha = 1;
        } else if (f.kind === "spark") {
            const d = Math.max(1.2, p.s * 700);
            ctx.globalAlpha = 1 - k; ctx.fillStyle = f.col; ctx.fillRect(p.x - d / 2, p.y - d / 2, d, d); ctx.globalAlpha = 1;
        } else if (f.kind === "krill") {
            dcDrawKrillShape(ctx, p.x, p.y, Math.max(2, p.s * 3000), f.rot + f.t * 12);
        } else if (f.kind === "chunk") {
            const d = Math.max(2, p.s * 3500);
            const a = f.rot + f.t * 8;
            dcLine(ctx, [p.x - Math.cos(a) * d, p.y - Math.sin(a) * d, p.x + Math.cos(a) * d, p.y + Math.sin(a) * d], f.col, 0, 1.4);
        } else if (f.kind === "tracer") {
            const q = { x: p.x, y: p.y };
            const p2 = dcScreenAt(f.z + 6 * DC_SEG, f.x, f.y);
            if (p2) dcLine(ctx, [q.x, q.y, p2.x, p2.y], f.col, 3, 1.6);
        } else if (f.kind === "scorch") {
            const r = f.r1 * p.w;
            ctx.beginPath(); ctx.ellipse(p.x, p.y, r, Math.max(1, r * 0.2), 0, 0, Math.PI * 2);
            ctx.globalAlpha = (1 - k) * 0.8; ctx.strokeStyle = f.col; ctx.lineWidth = 1.4; ctx.stroke(); ctx.globalAlpha = 1;
        }
    }
}

// ---------------------------------------------------
//   HUD: the driving cluster, bottom left (speed, capacitor, ability)
// ---------------------------------------------------
function dcDrawHud(ctx) {
    const r = dc.me;
    if (!r || dc.mode === "result") return;
    const big = Math.max(16, Math.min(34, dcH * 0.045));
    const x = Math.max(16, dcW * 0.03), y = dcH - big * 3.4;
    const mph = Math.round(r.v * DC_MPH);
    dcText(ctx, mph + " MPH", x, y, big, DC_COL.hot, "left");
    // Capacitor (boost and jump share it).
    const bw = Math.max(120, big * 5.2), bh = Math.max(7, big * 0.26), by = y + big * 1.35;
    const segs = 12, filled = Math.floor(r.cap * segs + 0.0001);
    ctx.strokeStyle = DC_COL.mid; ctx.lineWidth = 1.2; ctx.strokeRect(x, by, bw, bh);
    for (let i = 0; i < filled; i++) {
        ctx.fillStyle = i < 3 ? DC_COL.mid : DC_COL.hot;
        ctx.fillRect(x + 2 + i * (bw - 4) / segs, by + 2, (bw - 4) / segs - 2, bh - 4);
    }
    // Ability.
    const a = DC_ABILITY[r.role];
    if (a) {
        const ay = by + bh + big * 0.45, sz = Math.max(9, big * 0.42);
        const ready = r.cd <= 0;
        dcText(ctx, a.name, x, ay, sz, ready ? r.color : DC_COL.dim, "left");
        const tw = dcTextWidth(a.name, sz) + sz;
        const cw = bw - tw;
        ctx.strokeStyle = DC_COL.dim; ctx.strokeRect(x + tw, ay + 1, cw, sz - 2);
        const frac = ready ? 1 : 1 - r.cd / a.cd;
        ctx.fillStyle = ready ? r.color : DC_COL.mid;
        ctx.fillRect(x + tw + 2, ay + 3, Math.max(0, (cw - 4) * frac), sz - 6);
    }
    if (r.krill > 0) dcText(ctx, "KRILL " + r.krill, x, y - big * 0.9, Math.max(9, big * 0.45), DC_COL.magenta, "left");
    if (r.down > 0) dcText(ctx, "DOWN", dcW / 2, dcH * 0.62, Math.max(14, big * 0.8), DC_COL.magenta, "center");
}

function dcDrawTexts(ctx) {
    for (let i = 0; i < dc.texts.length; i++) {
        const t = dc.texts[i];
        const k = t.t / t.life;
        const a = k > 0.75 ? (1 - k) * 4 : 1;
        if (t.kind === "banner") {
            const size = Math.max(14, Math.min(34, dcW * 0.032));
            dcText(ctx, t.s, dcW / 2, dcH * 0.27, size, t.col, "center", a);
        } else {
            const p = dcScreenAt(t.z, t.x, 900 + k * 900);
            if (p) dcText(ctx, t.s, p.x, p.y, Math.max(7, Math.min(16, p.w * 0.08)), t.col, "center", a);
        }
    }
}
