// ===================================================
//   Desert Code Racer — the motherships (Ry 2026-11-25)
// ===================================================
// Ry: "stay more stationary and monolithic, but rendered as if 3d if it
// rotates to line up an attack. Launching a laser would be stationary ...
// the motherships were wedge shapes with round brain at front."
// Reference: /mnt/project-files/desert-code-racer/ref/mothership-wedge-*.png
// and concepts/desert-code-racer-sketch.jpeg.
//
// THE MODEL. One small flat-shaded mesh, drawn twice (the big ship centre
// sky, the small one top left): an arrowhead slab pointing at the camera with
// a U notch cut from its back, bone ribs down its sides over a violet
// interior, a red glowing rim along the underside, a pink brain dome on top
// at the point, tendrils hanging below. Model units: x right, y up, z toward
// the camera; the point is at z = +1.
//
// THE MOTION. Neither ship moves across the sky. Each holds a yaw: 0 is
// nose-on. While one of its beams is tracking (lining up) it turns slowly
// toward the target; once the beam locks (the laser lands) it holds still;
// with nothing to aim at it drifts back nose-on. The small ship turns toward
// its strafe line the same way and fires the line from where it hangs.
//
// The beam origin is the eye under the point: dcShip.eyeX/eyeY (big) and
// dcShip.sx/sy (small), read by dcDrawBeams in dc-actors.js.
"use strict";

const dcShip = { x: 0, y: 0, eyeX: 0, eyeY: 0, sx: 0, sy: 0, yaw: 0, syaw: 0, lastT: -1 };

const DC_SHIP_TURN = 0.55;          // rad/s: slow, it is a mountain turning
const DC_SHIP_YAW_MAX = 0.75;
const DC_SHIP_PITCH = 0.42;         // nose dipped toward the road: the top and brain show

// Top-down outline from the point (x, z): down the left edge, round the notch, up the right.
const DC_SHIP_OUT = [
    [0, 1.0], [-1.12, -1.0], [-0.52, -1.0], [-0.44, -0.6], [-0.26, -0.34], [0, -0.26],
    [0.26, -0.34], [0.44, -0.6], [0.52, -1.0], [1.12, -1.0]
];
const DC_SHIP_TH = 0.11;            // slab thickness
// Where tendrils hang from (x, z) and how long they are.
const DC_SHIP_TENDRILS = (function () {
    const out = [];
    const r = dcMulberry(0x5EA);
    for (let i = 0; i < 26; i++) {
        const z = -0.9 + r() * 1.7;
        const half = (1 - (z + 1) / 2) * 1.0;        // the wedge's half width at this z
        const x = (r() * 2 - 1) * half * 0.85;
        if (z < -0.3 && Math.abs(x) < 0.3) continue; // the notch
        out.push({ x: x, z: z, len: 0.35 + r() * 0.7, ph: r() * 6.28 });
    }
    return out;
})();

function dcShipShade(col, k) { return dcShade(col, Math.round(dcClamp(k, 0, 1) * 8) / 8); }

// A projector for one ship on screen: model point -> screen point.
function dcShipProj(cx, cy, scale, yaw) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(DC_SHIP_PITCH), sp = Math.sin(DC_SHIP_PITCH);
    const D = 4.2;
    return function (x, y, z) {
        // yaw about y, then pitch about x (nose down toward the camera)
        const x1 = x * cyw + z * syw, z1 = -x * syw + z * cyw;
        const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp;
        const k = scale / (D - z2);
        return { x: cx + x1 * k, y: cy - y2 * k, z: z2, X: x1, Y: y2 };
    };
}

// Light from the upper left, a little in front.
const DC_SHIP_LIGHT = (function () { const v = [-0.45, 0.8, 0.4]; const l = Math.hypot(v[0], v[1], v[2]); return [v[0] / l, v[1] / l, v[2] / l]; })();

function dcShipNormal(yaw, nx, ny, nz) {
    const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(DC_SHIP_PITCH), sp = Math.sin(DC_SHIP_PITCH);
    const x1 = nx * cyw + nz * syw, z1 = -nx * syw + nz * cyw;
    return [x1, ny * cp - z1 * sp, ny * sp + z1 * cp];
}

function dcShipPoly(ctx, pts, fill) {
    ctx.beginPath();
    ctx.moveTo(Math.round(pts[0].x), Math.round(pts[0].y));
    for (let i = 1; i < pts.length; i++) ctx.lineTo(Math.round(pts[i].x), Math.round(pts[i].y));
    ctx.closePath();
    ctx.fillStyle = fill; ctx.fill();
}

// Draws one ship; returns the eye (beam origin) on screen.
function dcDrawWedge(ctx, cx, cy, scale, yaw, charging, big) {
    const P = dcShipProj(cx, cy, scale, yaw);
    const t = DC_REDUCED ? 0 : dc.simT;
    const T = DC_SHIP_TH;
    const out = DC_SHIP_OUT;
    const n = out.length;
    const top = [], bot = [];
    for (let i = 0; i < n; i++) {
        // The slab thins toward the arm ends: a blade, not a brick.
        const th = T * (0.55 + 0.45 * (out[i][1] + 1) / 2);
        top.push(P(out[i][0], th, out[i][1]));
        bot.push(P(out[i][0], 0, out[i][1]));
    }

    // Tendrils first, behind everything: dark, hanging, barely swaying.
    if (big || scale > 30) {
        ctx.strokeStyle = "#3A0E1E"; ctx.lineWidth = 1;
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
    }

    // Side walls: the ones facing the camera, far to near.
    const sides = [];
    for (let i = 0; i < n; i++) {
        const j = (i + 1) % n;
        const ex = out[j][0] - out[i][0], ez = out[j][1] - out[i][1];
        // Walking the outline as listed, outward is (ez, -ex).
        const L = Math.hypot(ex, ez) || 1;
        const nm = dcShipNormal(yaw, ez / L, 0, -ex / L);
        const mid = { X: (top[i].X + top[j].X) / 2, Y: (top[i].Y + top[j].Y + bot[i].Y + bot[j].Y) / 4, z: (top[i].z + top[j].z) / 2 };
        const view = [-mid.X, -mid.Y, 4.2 - mid.z];
        if (nm[0] * view[0] + nm[1] * view[1] + nm[2] * view[2] <= 0) continue;
        const lit = 0.35 + 0.4 * Math.max(0, nm[0] * DC_SHIP_LIGHT[0] + nm[1] * DC_SHIP_LIGHT[1] + nm[2] * DC_SHIP_LIGHT[2]);
        sides.push({ i: i, j: j, z: mid.z, lit: lit, len: L });
    }
    sides.sort(function (a, b) { return a.z - b.z; });
    for (let k = 0; k < sides.length; k++) {
        const s = sides[k], i = s.i, j = s.j;
        dcShipPoly(ctx, [bot[i], bot[j], top[j], top[i]], dcShipShade("#5B2A6E", s.lit));
        // Bone ribs, each a one-pixel post from rim to deck.
        const ribs = Math.max(2, Math.round(s.len * (big ? 16 : 7)));
        ctx.strokeStyle = dcShipShade("#D8B8A8", 0.45 + s.lit * 0.6); ctx.lineWidth = 1;
        ctx.beginPath();
        for (let r = 1; r < ribs; r++) {
            const u = r / ribs;
            const xa = dcLerp(bot[i].x, bot[j].x, u), ya = dcLerp(bot[i].y, bot[j].y, u);
            const xb = dcLerp(top[i].x, top[j].x, u), yb = dcLerp(top[i].y, top[j].y, u);
            ctx.moveTo(Math.round(xa) + 0.5, Math.round(ya)); ctx.lineTo(Math.round(xb) + 0.5, Math.round(yb));
        }
        ctx.stroke();
    }

    // The deck: flat shaded, with a few veins from the point back to the arms.
    const nTop = dcShipNormal(yaw, 0, 1, 0);
    const litTop = 0.45 + 0.4 * Math.max(0, nTop[0] * DC_SHIP_LIGHT[0] + nTop[1] * DC_SHIP_LIGHT[1] + nTop[2] * DC_SHIP_LIGHT[2]);
    dcShipPoly(ctx, top, dcShipShade("#8A4A62", litTop));
    ctx.strokeStyle = dcShipShade("#C08AA0", litTop); ctx.lineWidth = 1;
    ctx.beginPath();
    const tip = top[0];
    for (let v = -2; v <= 2; v++) {
        if (v === 0) continue;
        const ax = v * 0.36, az = -0.92;
        const a = P(ax * 0.5, T * 0.8, 0.1), b = P(ax * 1.55, T * 0.6, az);
        ctx.moveTo(Math.round(tip.x), Math.round(tip.y)); ctx.lineTo(Math.round(a.x), Math.round(a.y)); ctx.lineTo(Math.round(b.x), Math.round(b.y));
    }
    ctx.stroke();
    // Deck edge: pale bone along the top rim of the visible sides.
    ctx.strokeStyle = dcShipShade("#E8C8B8", litTop + 0.15);
    ctx.beginPath();
    for (let k = 0; k < sides.length; k++) {
        const s = sides[k];
        ctx.moveTo(Math.round(top[s.i].x), Math.round(top[s.i].y)); ctx.lineTo(Math.round(top[s.j].x), Math.round(top[s.j].y));
    }
    ctx.stroke();

    // The red rim along the underside: it breathes.
    const breath = DC_REDUCED ? 1 : 0.75 + 0.25 * Math.sin(t * 1.4);
    ctx.globalAlpha = breath;
    ctx.strokeStyle = "#FF2244"; ctx.lineWidth = big ? 2 : 1;
    ctx.beginPath();
    for (let k = 0; k < sides.length; k++) {
        const s = sides[k];
        ctx.moveTo(Math.round(bot[s.i].x), Math.round(bot[s.i].y)); ctx.lineTo(Math.round(bot[s.j].x), Math.round(bot[s.j].y));
    }
    ctx.stroke();
    ctx.globalAlpha = 1;

    // The brain: a dome on the deck at the point, folds drawn as short arcs.
    const bc = P(0, T, 0.55), bxa = P(-0.16, T, 0.55), bxb = P(0.16, T, 0.55);
    const bza = P(0, T, 0.36), bzb = P(0, T, 0.74), bup = P(0, T + 0.13, 0.55);
    const rx = Math.max(1.5, Math.hypot(bxb.x - bxa.x, bxb.y - bxa.y) / 2);
    const ry = Math.max(1.2, Math.max(Math.abs(bzb.y - bza.y) / 2, Math.abs(bc.y - bup.y)));
    const ex0 = (bza.x + bzb.x) / 2, ey0 = Math.min(bc.y, (bza.y + bzb.y) / 2) - ry * 0.35;
    const rot = Math.atan2(bxb.y - bxa.y, bxb.x - bxa.x);
    ctx.beginPath(); ctx.ellipse(Math.round(ex0), Math.round(ey0), rx, ry, rot, 0, Math.PI * 2);
    ctx.fillStyle = charging ? "#FF8AB0" : "#D87890"; ctx.fill();
    ctx.strokeStyle = "#6A2238"; ctx.lineWidth = 1; ctx.stroke();
    if (rx > 5) {
        ctx.beginPath();
        // the split down the middle, then a few folds each side
        ctx.moveTo(Math.round(ex0 - Math.sin(rot) * 0), Math.round(ey0 - ry * 0.9));
        ctx.lineTo(Math.round(ex0), Math.round(ey0 + ry * 0.9));
        for (let f = 0; f < 6; f++) {
            const side = f % 2 ? 1 : -1, u = 0.25 + 0.5 * Math.floor(f / 2) / 2;
            const fx = ex0 + side * rx * 0.5, fy = ey0 - ry * 0.7 + u * ry * 1.4;
            ctx.moveTo(Math.round(fx - rx * 0.28), Math.round(fy));
            ctx.quadraticCurveTo(Math.round(fx), Math.round(fy - ry * 0.25), Math.round(fx + rx * 0.28), Math.round(fy));
        }
        ctx.strokeStyle = "#8A3048"; ctx.stroke();
    }

    // The eye under the point: where the beams come from.
    const eye = P(0, -0.02, 0.88);
    const er = Math.max(1, Math.round(scale * 0.007)) + (charging ? 1 : 0);
    ctx.fillStyle = charging ? DC_COL.magenta : "#A0203A";
    ctx.fillRect(Math.round(eye.x) - er, Math.round(eye.y) - er + 1, er * 2, er * 2);
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

function dcDrawMothership(ctx, cy) {
    const dt = dcShip.lastT < 0 ? 0 : dcClamp(dc.simT - dcShip.lastT, 0, 0.1);
    const cx = Math.round(dcW * 0.5);
    dcShip.yaw = dcShipTurn(dcShip.yaw, dcShipWant(0, cx), dt);
    dcShip.x = cx; dcShip.y = cy;
    const charging = dc.beams.some(function (b) { return b.phase === "track" && b.src === 0; });
    const scale = Math.min(dcW * 0.85, dcH * 1.5);
    const eye = dcDrawWedge(ctx, cx, cy - dcH * 0.06, scale, dcShip.yaw, charging, true);
    dcShip.eyeX = eye.x; dcShip.eyeY = eye.y;
}

function dcDrawSmallShip(ctx) {
    const dt = dcShip.lastT < 0 ? 0 : dcClamp(dc.simT - dcShip.lastT, 0, 0.1);
    dcShip.lastT = dc.simT;
    const cx = Math.round(dcW * 0.13), cy = Math.round(dcH * 0.1);
    // Idle it sits angled in toward the road, a quarter turn of watchfulness.
    const want = dcShipWant(1, cx);
    dcShip.syaw = dcShipTurn(dcShip.syaw, want === 0 ? 0.3 : (want === null ? null : dcClamp(want, -0.5, 0.5)), dt);
    const charging = dc.beams.some(function (b) { return b.phase === "track" && b.src === 1; }) || !!dcStrafeShip();
    const eye = dcDrawWedge(ctx, cx, cy, Math.min(dcW * 0.3, dcH * 0.55), dcShip.syaw, charging, false);
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
