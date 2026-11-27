// ===================================================
//   Desert Code Racer — the motherships (Ry 2026-11-25, 2026-11-26)
// ===================================================
// Ry: "stay more stationary and monolithic, but rendered as if 3d if it
// rotates to line up an attack. Launching a laser would be stationary ...
// the motherships were wedge shapes with round brain at front."
// Ry 2026-11-26: "they should appear to be fixed in place, along with the
// mountains" (their aim and hits unchanged, only the shots' path on screen
// differs); brains "a little bit more organic", the straight edges "more
// organic"; the centre ship shows "the underside of the ship rather than the
// top".
// Reference: /mnt/project-files/desert-code-racer/ref/mothership-wedge-*.png
// and concepts/desert-code-racer-sketch.jpeg.
//
// THE MODEL. One small flat-shaded mesh, drawn twice: an arrowhead slab
// pointing at the camera with a U notch cut from its back, its outline
// knobbled and its thickness uneven (a grown thing, not a machined one), bone
// ribs at every knob down violet sides, a red glowing rim along the
// underside with drips, a lobed pink brain bulging over the point, tendrils
// hanging. Model units: x right, y up, z toward the camera; point at z = +1.
// The big ship is seen from a little below (its fleshy, veined underside and
// the eye show); the small one from a little above (deck and brain show).
//
// IN THE SKY. Both sit at infinity with the ridgelines and turn with them
// (`dcSkyTurn`: one shared number for the whole sky). So a long bend does not
// lose them for good, the sky's bearing follows the road's heading very
// slowly (`DC_SHIP_SETTLE` s), and it snaps back on a new run or a round
// restart. Beams and strafe bolts still leave from the eye wherever it is,
// on screen or off it; what they hit is decided on the road as before.
//
// THE MOTION. Each ship holds a yaw: 0 is nose-on. While one of its beams is
// tracking (lining up) it turns slowly toward the target; once the beam
// locks (the laser lands) it holds still; with nothing to aim at it drifts
// back to a slight resting turn. The small ship turns toward its strafe line the same way.
//
// The beam origin is the eye under the point: dcShip.eyeX/eyeY (big) and
// dcShip.sx/sy (small), read by dcDrawBeams in dc-actors.js.
"use strict";

const dcShip = { x: 0, y: 0, eyeX: 0, eyeY: 0, sx: 0, sy: 0, yaw: 0, syaw: 0, lastT: -1, dt: 0, anchor: null };

const DC_SHIP_TURN = 0.55;          // rad/s: slow, it is a mountain turning
const DC_SHIP_YAW_MAX = 0.75;
const DC_SHIP_PITCH_BIG = -0.22;    // nose raised: we look up at the underside
const DC_SHIP_PITCH_SMALL = 0.42;   // nose dipped: deck and brain show
const DC_SHIP_SETTLE = 14;          // s for the bearing to follow the road's heading
const DC_SHIP_TH = 0.11;            // slab thickness at the point

// The outline, top-down (x, z), from the point down the left edge, round the
// notch and up the right. Each straight run is broken into knobs a little in
// or out of the line; corners stay put. Same every run (fixed seed).
const DC_SHIP_OUT = (function () {
    const base = [
        [0, 1.0], [-1.12, -1.0], [-0.52, -1.0], [-0.46, -0.66], [-0.36, -0.44], [-0.2, -0.3], [0, -0.26],
        [0.2, -0.3], [0.36, -0.44], [0.46, -0.66], [0.52, -1.0], [1.12, -1.0]
    ];
    const r = dcMulberry(0xB0E5);
    const out = [];
    for (let i = 0; i < base.length; i++) {
        const a = base[i], b = base[(i + 1) % base.length];
        const ex = b[0] - a[0], ez = b[1] - a[1], L = Math.hypot(ex, ez);
        const k = Math.max(1, Math.round(L / 0.075));
        for (let s = 0; s < k; s++) {
            const u = s / k;
            // outward is (ez, -ex) for this winding; knobs push out more than in
            const j = s === 0 ? 0 : (r() * 1.3 - 0.45) * 0.045;
            out.push({ x: a[0] + ex * u + ez / L * j, z: a[1] + ez * u - ex / L * j,
                       th: 0.8 + r() * 0.4, rib: r() < 0.82 });
        }
    }
    return out;
})();

// Where tendrils hang from (x, z) and how long they are.
const DC_SHIP_TENDRILS = (function () {
    const out = [];
    const r = dcMulberry(0x5EA);
    for (let i = 0; i < 30; i++) {
        const z = -0.9 + r() * 1.7;
        const half = (1 - (z + 1) / 2) * 1.0;        // the wedge's half width at this z
        const x = (r() * 2 - 1) * half * 0.85;
        if (z < -0.3 && Math.abs(x) < 0.3) continue; // the notch
        out.push({ x: x, z: z, len: 0.35 + r() * 0.75, ph: r() * 6.28 });
    }
    return out;
})();

// Veins on the underside: from the eye back toward the arms, wandering.
const DC_SHIP_VEINS = (function () {
    const out = [];
    const r = dcMulberry(0x7E1);
    for (let v = 0; v < 9; v++) {
        const side = v % 2 ? 1 : -1, spread = 0.15 + r() * 0.85;
        const pts = [];
        for (let s = 0; s <= 6; s++) {
            const u = s / 6;
            const z = 0.85 - u * 1.75;
            const half = (1 - (z + 1) / 2);
            pts.push([side * half * spread * u * 1.1 + (r() - 0.5) * 0.07, z]);
        }
        out.push(pts);
    }
    return out;
})();

function dcShipShade(col, k) { return dcShade(col, Math.round(dcClamp(k, 0, 1) * 8) / 8); }

// A projector for one ship on screen: model point -> screen point.
function dcShipProj(cx, cy, scale, yaw, pitch) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const D = 4.2;
    return function (x, y, z) {
        // yaw about y, then pitch about x (positive: nose down toward the camera)
        const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        const k = scale / (D - z2);
        return { x: cx + x1 * k, y: cy - y2 * k, z: z2, X: x1, Y: y2 };
    };
}

// Light from the upper left, a little in front.
const DC_SHIP_LIGHT = (function () { const v = [-0.45, 0.8, 0.4]; const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();

function dcShipNormal(yaw, pitch, nx, ny, nz) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch);
    const x1 = nx * cyw + nz * syw, z1 = -nx * syw + nz * cyw;
    return [x1, ny * cp - z1 * sp, ny * sp + z1 * cp];
}
function dcShipLit(nm) { return Math.max(0, nm[0] * DC_SHIP_LIGHT[0] + nm[1] * DC_SHIP_LIGHT[1] + nm[2] * DC_SHIP_LIGHT[2]); }
function dcShipFacing(nm, p) { return nm[0] * -p.X + nm[1] * -p.Y + nm[2] * (4.2 - p.z) > 0; }

function dcShipPoly(ctx, pts, fill) {
    ctx.beginPath();
    ctx.moveTo(Math.round(pts[0].x), Math.round(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(Math.round(pts[i].x), Math.round(pts[i].y));
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
}

// The brain: two lumpy lobes split down the middle, wandering folds, a wet
// highlight. (x, y) centre, rx/ry half sizes, rot the lean of its long axis.
function dcDrawBrain(ctx, x, y, rx, ry, rot, charging, t) {
    const pulse = charging && !DC_REDUCED ? 1 + 0.06 * Math.sin(t * 14) : 1;
    rx *= pulse; ry *= pulse;
    const cr = Math.cos(rot), sr = Math.sin(rot);
    const at = function (u, v) { return [Math.round(x + u * cr - v * sr), Math.round(y + u * sr + v * cr)]; };
    const lobe = function (side) {
        ctx.beginPath();
        for (let i = 0; i <= 28; i++) {
            const a = i / 28 * Math.PI * 2;
            const bump = 1 + 0.1 * Math.sin(a * 7 + side * 1.7) + 0.05 * Math.sin(a * 13 + side);
            const q = at(side * rx * 0.47 + Math.cos(a) * rx * 0.56 * bump, Math.sin(a) * ry * bump);
            if (i === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
        }
        ctx.closePath();
    };
    for (let side = -1; side <= 1; side += 2) {
        lobe(side);
        ctx.fillStyle = charging ? "#FF8AB0" : "#D87890"; ctx.fill();
        ctx.strokeStyle = "#5A1A30"; ctx.lineWidth = 1; ctx.stroke();
    }
    if (rx < 4) return;
    // Folds: short wandering creases across each lobe.
    ctx.strokeStyle = "#8A3048"; ctx.lineWidth = 1;
    ctx.beginPath();
    const rows = rx > 12 ? 4 : 3;
    for (let side = -1; side <= 1; side += 2) {
        for (let f = 0; f < rows; f++) {
            const v0 = (-0.7 + 1.4 * (f + 0.5) / rows) * ry;
            for (let s = 0; s <= 5; s++) {
                const u = side * rx * (0.12 + 0.8 * s / 5);
                const q = at(u, v0 + Math.sin(s * 2.1 + f * 1.3 + side) * ry * 0.16);
                if (s === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
            }
        }
    }
    ctx.stroke();
    // The split down the middle.
    ctx.strokeStyle = "#5A1A30";
    ctx.beginPath();
    for (let s = 0; s <= 6; s++) {
        const q = at(Math.sin(s * 1.9) * rx * 0.04, -ry * 0.95 + ry * 1.9 * s / 6);
        if (s === 0) ctx.moveTo(q[0], q[1]); else ctx.lineTo(q[0], q[1]);
    }
    ctx.stroke();
    // A wet highlight, upper left of each lobe.
    ctx.fillStyle = "#FFC8D8";
    for (let side = -1; side <= 1; side += 2) {
        const q = at(side * rx * 0.47 - rx * 0.2, -ry * 0.5);
        ctx.fillRect(q[0], q[1], Math.max(1, Math.round(rx * 0.12)), 1);
    }
}

// Draws one ship; returns the eye (beam origin) on screen.
function dcDrawWedge(ctx, cx, cy, scale, yaw, pitch, charging, big) {
    const P = dcShipProj(cx, cy, scale, yaw, pitch);
    const t = DC_REDUCED ? 0 : dc.simT;
    const T = DC_SHIP_TH;
    const out = DC_SHIP_OUT;
    const n = out.length;
    const top = [], bot = [];
    for (let i = 0; i < n; i++) {
        // The slab thins toward the arm ends (a blade, not a brick), unevenly.
        const th = T * (0.5 + 0.5 * (out[i].z + 1) / 2) * out[i].th;
        top.push(P(out[i].x, th, out[i].z));
        bot.push(P(out[i].x, 0, out[i].z));
    }
    const mid = P(0, 0, 0);
    const nTop = dcShipNormal(yaw, pitch, 0, 1, 0), nBot = dcShipNormal(yaw, pitch, 0, -1, 0);
    const showTop = dcShipFacing(nTop, P(0, T, 0)), showBot = dcShipFacing(nBot, mid);

    // The brain bulges over the point. Its box on screen, from model points.
    const bz = 0.7, bh = T + 0.16;
    const bxa = P(-0.2, T, bz), bxb = P(0.2, T, bz), bza = P(0, T, bz - 0.3), bzb = P(0, T, bz + 0.3), bup = P(0, bh, bz);
    const brx = Math.max(1.5, Math.hypot(bxb.x - bxa.x, bxb.y - bxa.y) / 2);
    const bry = Math.max(1.2, Math.max(Math.abs(bzb.y - bza.y) / 2, Math.abs(bza.y - bup.y) * 0.6));
    const bseat = P(0, T, bz);
    // Seen from above it lies on the deck; from below it rises out of the slab's front edge.
    const bcx = (bza.x + bzb.x) / 2, bcy = showTop ? Math.min((bza.y + bzb.y) / 2, bup.y + bry * 0.6) : bseat.y - bry * 0.45;
    const brot = Math.atan2(bxb.y - bxa.y, bxb.x - bxa.x);
    const tendrils = function () {
        ctx.strokeStyle = showBot ? "#5A1426" : "#3A0E1E"; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let i = 0; i < DC_SHIP_TENDRILS.length; i++) {
            const td = DC_SHIP_TENDRILS[i];
            let q = P(td.x, 0, td.z);
            ctx.moveTo(Math.round(q.x), Math.round(q.y));
            for (let s = 1; s <= 5; s++) {
                const u = s / 5;
                const sw = Math.sin(t * 0.7 + td.ph + u * 2.2) * 0.06 * u;
                q = P(td.x + sw, -td.len * u, td.z + sw * 0.5);
                ctx.lineTo(Math.round(q.x), Math.round(q.y));
            }
        }
        ctx.stroke();
    };

    // Seen from above, the tendrils hang behind the slab; from below, in front.
    if (!showBot) tendrils();
    // From below the brain shows only where it bulges past the slab: draw it first.
    if (!showTop) dcDrawBrain(ctx, bcx, bcy, brx, bry, brot, charging, t);

    // The underside: dark flesh, red veins from the eye.
    if (showBot) {
        dcShipPoly(ctx, bot, dcShipShade("#6E2A44", 0.7 + 0.3 * dcShipLit(nBot)));
        ctx.globalAlpha = 0.55 + 0.25 * (DC_REDUCED ? 1 : Math.sin(t * 1.4) * 0.5 + 0.5);
        ctx.strokeStyle = "#C0283E"; ctx.lineWidth = 1;
        ctx.beginPath();
        for (let v = 0; v < DC_SHIP_VEINS.length; v++) {
            const pts = DC_SHIP_VEINS[v];
            for (let s = 0; s < pts.length; s++) {
                const q = P(pts[s][0], 0, pts[s][1]);
                if (s === 0) ctx.moveTo(Math.round(q.x), Math.round(q.y)); else ctx.lineTo(Math.round(q.x), Math.round(q.y));
            }
        }
        ctx.stroke();
        ctx.globalAlpha = 1;
    }

    // Side walls: the ones facing the camera, far to near.
    const sides = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ex = out[j].x - out[i].x, ez = out[j].z - out[i].z;
        const L = Math.hypot(ex, ez) || 1;
        const nm = dcShipNormal(yaw, pitch, ez / L, 0, -ex / L);       // outward is (ez, -ex)
        const c = { X: (top[i].X + top[j].X + bot[i].X + bot[j].X) / 4, Y: (top[i].Y + top[j].Y + bot[i].Y + bot[j].Y) / 4, z: (top[i].z + top[j].z) / 2 };
        if (!dcShipFacing(nm, c)) continue;
        sides.push({ i: i, j: j, z: c.z, lit: 0.35 + 0.4 * dcShipLit(nm) });
    }
    sides.sort(function (a, b) { return a.z - b.z; });
    for (let k = 0; k < sides.length; k++) {
        const s = sides[k];
        dcShipPoly(ctx, [bot[s.i], bot[s.j], top[s.j], top[s.i]], dcShipShade("#5B2A6E", s.lit));
    }
    // Bone ribs, one at each knob of the outline (most of them), slightly bowed.
    ctx.lineWidth = 1;
    for (let k = 0; k < sides.length; k++) {
        const s = sides[k];
        if (!out[s.i].rib) continue;
        const a = bot[s.i], b = top[s.i];
        ctx.strokeStyle = dcShipShade("#D8B8A8", 0.45 + s.lit * 0.6);
        ctx.beginPath();
        ctx.moveTo(Math.round(a.x) + 0.5, Math.round(a.y));
        ctx.quadraticCurveTo(Math.round((a.x + b.x) / 2 + (k % 3 - 1)) + 0.5, Math.round((a.y + b.y) / 2), Math.round(b.x) + 0.5, Math.round(b.y));
        ctx.stroke();
    }

    // The deck, when it shows: flat shaded, veins from the point.
    if (showTop) {
        const litTop = 0.45 + 0.4 * dcShipLit(nTop);
        dcShipPoly(ctx, top, dcShipShade("#8A4A62", litTop));
        ctx.strokeStyle = dcShipShade("#C08AA0", litTop); ctx.lineWidth = 1;
        ctx.beginPath();
        const tip = top[0];
        for (let v = -2; v <= 2; v++) {
            if (v === 0) continue;
            const a = P(v * 0.2 + Math.sin(v * 3.1) * 0.04, T * 0.8, 0.1), b = P(v * 0.55, T * 0.6, -0.92);
            ctx.moveTo(Math.round(tip.x), Math.round(tip.y));
            ctx.quadraticCurveTo(Math.round(a.x), Math.round(a.y), Math.round(b.x), Math.round(b.y));
        }
        ctx.stroke();
        ctx.strokeStyle = dcShipShade("#E8C8B8", litTop + 0.15);
        ctx.beginPath();
        for (let k = 0; k < sides.length; k++) {
            const s = sides[k];
            ctx.moveTo(Math.round(top[s.i].x), Math.round(top[s.i].y)); ctx.lineTo(Math.round(top[s.j].x), Math.round(top[s.j].y));
        }
        ctx.stroke();
    }

    // The red rim along the underside, with drips. It breathes.
    const breath = DC_REDUCED ? 1 : 0.75 + 0.25 * Math.sin(t * 1.4);
    ctx.globalAlpha = breath;
    ctx.strokeStyle = "#FF2244"; ctx.lineWidth = big ? 2 : 1;
    ctx.beginPath();
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        if (!showBot && !sides.some(function (s) { return s.i === i; })) continue;
        ctx.moveTo(Math.round(bot[i].x), Math.round(bot[i].y)); ctx.lineTo(Math.round(bot[j].x), Math.round(bot[j].y));
    }
    ctx.stroke();
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let k = 0; k < sides.length; k++) {
        const i = sides[k].i;
        if (i % 3) continue;
        const len = Math.max(1, Math.round(scale * 0.006 * (1 + (i * 7 % 5) * 0.4)));
        ctx.moveTo(Math.round(bot[i].x) + 0.5, Math.round(bot[i].y)); ctx.lineTo(Math.round(bot[i].x) + 0.5, Math.round(bot[i].y) + len);
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (showBot) tendrils();
    if (showTop) dcDrawBrain(ctx, bcx, bcy, brx, bry, brot, charging, t);

    // The eye under the point: where the beams come from.
    const eye = P(0, -0.02, 0.86);
    const er = Math.max(1, Math.round(scale * 0.007)) + (charging ? 1 : 0);
    ctx.fillStyle = charging ? DC_COL.magenta : "#A0203A";
    ctx.beginPath(); ctx.arc(Math.round(eye.x), Math.round(eye.y) + 1, er + 0.5, 0, Math.PI * 2); ctx.fill();
    if (charging && !DC_REDUCED && Math.floor(dc.simT * 10) % 2 === 0) {
        ctx.fillStyle = DC_COL.hot; ctx.fillRect(Math.round(eye.x) - 1, Math.round(eye.y), 2, 2);
    }
    return { x: eye.x, y: eye.y + er };
}

// The yaw a ship wants: toward the aim of its tracking beam (or strafe), or
// held while a beam is locked, or nose-on when idle. Returns null to hold.
function dcShipWant(src, cx) {
    let want = 0, hold = false;
    for (let i = 0; i < dc.beams.length; i++) {
        const b = dc.beams[i];
        if (b.phase === "gone" || (b.src === 1) !== (src === 1)) continue;
        if (b.phase === "lock") { hold = true; continue; }
        if (b.phase !== "track") continue;
        const aim = dcBeamAim(b);
        const p = dcScreenAt(aim.z, aim.x, 0);
        const ex = p ? p.x : dcW / 2 + (aim.x - dcCam.x / DC_ROAD_W) * dcW * 0.3;
        want = dcClamp((ex - cx) / dcW * 2.2, -DC_SHIP_YAW_MAX, DC_SHIP_YAW_MAX);
        return want;
    }
    if (src === 1) {
        const st = dcStrafeShip();
        if (st) return dcClamp((st.x - cx) / dcW * 2.0, -DC_SHIP_YAW_MAX, DC_SHIP_YAW_MAX);
    }
    return hold ? null : want;
}

function dcShipTurn(cur, want, dt) {
    if (want === null) return cur;
    const d = want - cur, m = DC_SHIP_TURN * dt;
    return Math.abs(d) <= m ? want : cur + Math.sign(d) * m;
}

// THE SKY'S TURN (Ry 2026-11-26): once a frame, from dcDrawSky, before the
// ridgelines. Everything in the sky (both ranges and both ships) reads this
// one number, so they stay locked together, and only the road's heading (the
// bike's turning) moves it: not the bike sliding across the road. Returns
// how far the sky has turned, in pixels, scaled down a touch (DC_SKY_TURN);
// each layer then takes its own share (DC_SKY_LAYER): the far range least.
const DC_SKY_TURN = 0.85;
const DC_SKY_LAYER = { far: 0.75, ships: 0.9, near: 1.0 };
function dcSkyTurn() {
    const snap = dcShip.anchor === null || dcShip.lastT < 0 || dc.simT < dcShip.lastT;
    dcShip.dt = snap ? 0 : dcClamp(dc.simT - dcShip.lastT, 0, 0.1);
    dcShip.lastT = dc.simT;
    const cur = dcSkyPx / Math.max(1, dcW);                  // the heading, in screen widths
    if (snap) dcShip.anchor = cur;
    else dcShip.anchor += (cur - dcShip.anchor) * (1 - Math.exp(-dcShip.dt / DC_SHIP_SETTLE));
    dcShip.view = (cur - dcShip.anchor) * dcW * DC_SKY_TURN;
    return dcShip.view;
}

function dcDrawMothership(ctx, cy) {
    const slide = -(dcShip.view || 0) * DC_SKY_LAYER.ships;
    dcShip.slide = slide;
    const cx = Math.round(dcW * 0.5 + slide);
    // Idle it rests a little turned, so it reads as a solid thing, not a cut-out.
    const want = dcShipWant(0, cx);
    dcShip.yaw = dcShipTurn(dcShip.yaw, want === 0 ? 0.22 : want, dcShip.dt);
    dcShip.x = cx; dcShip.y = cy;
    const charging = dc.beams.some(function (b) { return b.phase === "track" && b.src === 0; });
    const scale = Math.min(dcW * 0.85, dcH * 1.5);
    const eye = dcDrawWedge(ctx, cx, cy - dcH * 0.02, scale, dcShip.yaw, DC_SHIP_PITCH_BIG, charging, true);
    dcShip.eyeX = eye.x; dcShip.eyeY = eye.y;
}

function dcDrawSmallShip(ctx) {
    const cx = Math.round(dcW * 0.13 + (dcShip.slide || 0)), cy = Math.round(dcH * 0.1);
    // Idle it sits angled in toward the road, a quarter turn of watchfulness.
    const want = dcShipWant(1, cx);
    dcShip.syaw = dcShipTurn(dcShip.syaw, want === 0 ? 0.3 : (want === null ? null : dcClamp(want, -0.5, 0.5)), dcShip.dt);
    const charging = dc.beams.some(function (b) { return b.phase === "track" && b.src === 1; }) || !!dcStrafeShip();
    const eye = dcDrawWedge(ctx, cx, cy, Math.min(dcW * 0.3, dcH * 0.55), dcShip.syaw, DC_SHIP_PITCH_SMALL, charging, false);
    dcShip.sx = eye.x; dcShip.sy = eye.y;
}

// The strafe line, fired from where the small ship hangs: a short bolt per
// shot from its eye to the road just before the shot lands.
function dcDrawStrafeBolts(ctx) {
    if (dcCam.inside) return;
    for (let i = 0; i < dc.attacks.length; i++) {
        const a = dc.attacks[i];
        if (a.kind !== "strafe" || a.st !== "live") continue;
        for (let s = 0; s < DC_STRAFE_SHOTS; s++) {
            const sh = dcStrafeShot(a, s);
            const age = dc.simT - (sh.t - 0.14);
            if (age < 0 || age > 0.16) continue;
            const p = dcScreenAt(sh.z, sh.x, 0);
            if (!p) continue;
            const u0 = dcClamp(age / 0.14 - 0.35, 0, 1), u1 = dcClamp(age / 0.14, 0, 1);
            const x0 = dcLerp(dcShip.sx, p.x, u0), y0 = dcLerp(dcShip.sy, p.y, u0);
            const x1 = dcLerp(dcShip.sx, p.x, u1), y1 = dcLerp(dcShip.sy, p.y, u1);
            dcLine(ctx, [Math.round(x0), Math.round(y0), Math.round(x1), Math.round(y1)], s % 2 ? DC_COL.magenta : DC_COL.hot, 0, 2);
        }
    }
}
