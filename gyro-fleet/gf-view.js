// ===================================================
//   Gyro Fleet — readability: backdrop, speed dust, markers, trails, camera
// ===================================================
// Flight pass 2 (2026-11-14). Ry's playtest: "hard to read how quickly
// enemies are moving", "no sense of how quickly I'm moving", and arriving
// straight into tendrils with no moment to orient. This file is all view:
//
//   backdrop     three parallax layers behind the world. FAR: a nebula tile,
//                Earth at home and the hive's flesh glow (both drift slowly,
//                so they say which way home and the hive lie). MID: sparse
//                rocks/debris at partial parallax, the main motion cue.
//                Zoom-independent: px per world unit, not world space.
//   speed dust   world-anchored specks near the ship that streak with speed.
//   trails       a short tail behind every creature, length = its speed.
//   reach rings  a faint ring at tendril reach round big armoured creatures.
//   edge markers off-screen creatures within GF_VIEW.markR, pinned to the edge.
//   camera       near a fight, the zoom frames the nearest creature (pulled
//                right back on a drop-out) and eases in as you close. The game
//                owns the zoom in Q; the wheel doesn't zoom there.
"use strict";

const GF_VIEW = {
    farPx: 0.04,        // far layer: screen px per world unit of camera travel
    midPx: 1.4,         // mid layer (35 u/s -> ~50 px/s)
    midCell: 150,       // px; one rock per cell at most
    midChance: 0.28,
    dustN: 70,
    markR: 2600,        // edge markers for creatures this close
    camNear: 5000,      // auto camera works this close to a creature or the hive
    viewMin: 110,       // closest framing (world units, half the short side)
    viewMax: 1700,
    viewTravel: 220,    // travel view (no fight near)
    viewJump: 600       // during a jump
};

let gfViewDropBoost = 0;   // > 0 for a moment after a drop-out: frame wider
let gfViewPrevCam = null, gfViewCamV = { x: 0, y: 0 };
const gfDust = [];
let gfNebula = null;

function gfHash(i, j) {
    let h = (i * 374761393 + j * 668265263) | 0;
    h = (h ^ (h >>> 13)) * 1274126177 | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function gfViewOnDropOut(fight) { gfViewDropBoost = 2.5; }

// ---- camera (from glAnimate, after glUpdateCamera) ----
function gfViewFrame(dt) {
    const cam = glCamera;
    if (gfViewPrevCam) { gfViewCamV.x = cam.x - gfViewPrevCam.x; gfViewCamV.y = cam.y - gfViewPrevCam.y; }
    gfViewPrevCam = { x: cam.x, y: cam.y };
    gfViewDropBoost = Math.max(0, gfViewDropBoost - dt);

    const s = glShip;
    // The game owns the zoom in Q (Ry, 2026-11-14). Travel: a fixed view.
    // Near a fight: frame the nearest threat, wider just after a drop-out.
    if (glMode !== "q" || !s.isAlive || !gfHive) return;
    let d = gfNearestCreatureDist(s.x, s.y);
    d = Math.min(d, Math.max(0, Math.hypot(gfHive.x - s.x, gfHive.y - s.y) - gfHive.r));
    let R = d > GF_VIEW.camNear ? GF_VIEW.viewTravel : Math.max(GF_VIEW.viewMin, Math.min(GF_VIEW.viewMax, d * 1.25 + 60));
    if (gfFlight.jump === "burst") R = GF_VIEW.viewJump;
    if (gfViewDropBoost > 0) R = Math.max(R, Math.min(GF_VIEW.viewMax, d * 1.6 + 200));
    const target = Math.min(glW, glH) / 2 / R;
    const rate = gfViewDropBoost > 0 ? 0.12 : 0.04;
    cam.zoom = Math.exp(glLerp(Math.log(cam.zoom), Math.log(target), rate));
}

// ---- backdrop (from glDrawWorld, right after the stars) ----
function gfBuildNebula() {
    const N = 1024, cv = document.createElement("canvas");
    cv.width = cv.height = N;
    const g = cv.getContext("2d");
    const blobs = [
        [0.2, 0.3, 0.35, "rgba(90,40,140,0.22)"], [0.7, 0.2, 0.3, "rgba(30,90,120,0.18)"],
        [0.55, 0.7, 0.4, "rgba(120,30,60,0.16)"], [0.1, 0.85, 0.25, "rgba(40,70,140,0.16)"],
        [0.9, 0.6, 0.28, "rgba(80,30,110,0.18)"]
    ];
    // Drawn 3x3 so the tile wraps without seams.
    for (let ox = -1; ox <= 1; ox++) for (let oy = -1; oy <= 1; oy++) {
        blobs.forEach(function (b) {
            const x = (b[0] + ox) * N, y = (b[1] + oy) * N, r = b[2] * N;
            const gr = g.createRadialGradient(x, y, 0, x, y, r);
            gr.addColorStop(0, b[3]); gr.addColorStop(1, "rgba(0,0,0,0)");
            g.fillStyle = gr; g.fillRect(x - r, y - r, r * 2, r * 2);
        });
    }
    return cv;
}

function gfDrawBackdrop(c) {
    if (!gfHive) return;
    const cam = glCamera;
    c.save();
    // FAR: nebula tile.
    if (!gfNebula) gfNebula = gfBuildNebula();
    const N = gfNebula.width;
    const fx = ((-cam.x * GF_VIEW.farPx) % N + N) % N, fy = ((-cam.y * GF_VIEW.farPx) % N + N) % N;
    for (let x = fx - N; x < glW; x += N) for (let y = fy - N; y < glH; y += N) c.drawImage(gfNebula, x, y);

    // FAR: Earth at home and the hive glow, on the same slow layer.
    function farPos(wx, wy) { return { x: glCX + (wx - cam.x) * GF_VIEW.farPx, y: glCY + (wy - cam.y) * GF_VIEW.farPx }; }
    const e = farPos(gfHome.x, gfHome.y), er = 220;
    if (e.x > -er * 2 && e.x < glW + er * 2 && e.y > -er * 2 && e.y < glH + er * 2) {
        const gr = c.createRadialGradient(e.x - er * 0.3, e.y - er * 0.3, er * 0.1, e.x, e.y, er);
        gr.addColorStop(0, "rgba(60,120,170,0.35)"); gr.addColorStop(0.85, "rgba(20,50,90,0.3)"); gr.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = gr; c.beginPath(); c.arc(e.x, e.y, er, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "rgba(125,249,255,0.25)"; c.lineWidth = 3;
        c.beginPath(); c.arc(e.x, e.y, er * 0.97, Math.PI * 0.9, Math.PI * 1.7); c.stroke();
    }
    const h = farPos(gfHive.x, gfHive.y), hr = 300;
    if (h.x > -hr * 2 && h.x < glW + hr * 2 && h.y > -hr * 2 && h.y < glH + hr * 2) {
        const pulse = 0.8 + 0.2 * Math.sin(gfTime * 0.8);
        const gr = c.createRadialGradient(h.x, h.y, 0, h.x, h.y, hr);
        gr.addColorStop(0, "rgba(194,51,90," + (0.28 * pulse).toFixed(3) + ")"); gr.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = gr; c.fillRect(h.x - hr, h.y - hr, hr * 2, hr * 2);
    }

    // MID: rocks and debris, one per hashed cell.
    const C = GF_VIEW.midCell, ox = cam.x * GF_VIEW.midPx, oy = cam.y * GF_VIEW.midPx;
    const i0 = Math.floor((ox - glCX) / C) - 1, i1 = Math.floor((ox + glW - glCX) / C) + 1;
    const j0 = Math.floor((oy - glCY) / C) - 1, j1 = Math.floor((oy + glH - glCY) / C) + 1;
    c.fillStyle = "rgba(120,110,150,0.55)";
    c.strokeStyle = "rgba(170,160,200,0.35)";
    c.lineWidth = 1;
    for (let i = i0; i <= i1; i++) for (let j = j0; j <= j1; j++) {
        if (gfHash(i, j) > GF_VIEW.midChance) continue;
        const px = glCX + i * C + gfHash(i + 7, j) * C - ox, py = glCY + j * C + gfHash(i, j + 7) * C - oy;
        const r = 1.5 + gfHash(i + 3, j + 5) * 4.5, rot = gfHash(i + 9, j + 1) * 6.28 + gfTime * 0.1 * (gfHash(i, j + 2) - 0.5);
        c.beginPath();
        for (let k = 0; k < 6; k++) {
            const a = rot + k * Math.PI / 3, rr = r * (0.65 + 0.35 * gfHash(i * 7 + k, j * 3 - k));
            if (k === 0) c.moveTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr); else c.lineTo(px + Math.cos(a) * rr, py + Math.sin(a) * rr);
        }
        c.closePath(); c.fill(); c.stroke();
    }
    c.restore();
}

// ---- world layer (from gfDrawWorld, before creatures) ----
function gfDrawViewWorld(c, z) {
    const s = glShip;
    c.save();
    // Speed dust: SCREEN-space specks across the whole view (any zoom), each
    // moved by the camera's on-screen motion and wrapped at the edges. The
    // streak is that motion, capped.
    while (gfDust.length < GF_VIEW.dustN) gfDust.push({ x: Math.random() * glW, y: Math.random() * glH });
    const vx = gfViewCamV.x * z, vy = gfViewCamV.y * z;
    const L = Math.hypot(vx, vy) * 4;
    const k = L > 160 ? 160 / L : 1;
    c.strokeStyle = "rgba(201,255,233,0.35)"; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < gfDust.length; i++) {
        const d = gfDust[i];
        d.x = ((d.x - vx) % glW + glW) % glW;
        d.y = ((d.y - vy) % glH + glH) % glH;
        c.moveTo(d.x, d.y); c.lineTo(d.x - vx * 4 * k + 0.5, d.y - vy * 4 * k + 0.5);
    }
    c.stroke();

    // Creature trails (0.6 s of travel) and tendril reach rings.
    for (let i = 0; i < gfCreatures.length; i++) {
        const cr = gfCreatures[i];
        const p = glWorldToScreenRaw(cr.x, cr.y);
        if (p.x < -200 || p.y < -200 || p.x > glW + 200 || p.y > glH + 200) continue;
        const col = GF_KINDS[cr.kind].col;
        const tx = cr.vx * 0.6 * z, ty = cr.vy * 0.6 * z;
        if (tx * tx + ty * ty > 9) {
            const g = c.createLinearGradient(p.x, p.y, p.x - tx, p.y - ty);
            g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
            c.strokeStyle = g; c.globalAlpha = 0.6; c.lineWidth = Math.max(1, Math.min(4, cr.b.r * z * 0.6));
            c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - tx, p.y - ty); c.stroke();
            c.globalAlpha = 1;
        }
        if (cr.kind !== "krill" && cr.b.armour) {
            const rr = (cr.b.r + 11) * z;
            if (rr > 6) {
                c.strokeStyle = col; c.globalAlpha = cr.tendril > 0 ? 0.55 : 0.14; c.lineWidth = 1;
                c.setLineDash([3, 5]);
                c.beginPath(); c.arc(p.x, p.y, rr, 0, Math.PI * 2); c.stroke();
                c.setLineDash([]); c.globalAlpha = 1;
            }
        }
    }
    c.restore();
}

// ---- overlay (from gfDrawOverlay) ----
function gfDrawEdgeMarkers(c) {
    const s = glShip;
    if (glMode !== "q" || !s.isAlive) return;
    c.save();
    const m = 18;
    for (let i = 0; i < gfCreatures.length; i++) {
        const cr = gfCreatures[i];
        const dist = Math.hypot(cr.x - s.x, cr.y - s.y);
        if (dist > GF_VIEW.markR) continue;
        const p = glWorldToScreenRaw(cr.x, cr.y);
        if (p.x > 0 && p.y > 0 && p.x < glW && p.y < glH) continue;
        const dx = p.x - glCX, dy = p.y - glCY;
        const k = Math.min(dx ? (glCX - m) / Math.abs(dx) : Infinity, dy ? (glCY - m) / Math.abs(dy) : Infinity);
        const ax = glCX + dx * k, ay = glCY + dy * k, a = Math.atan2(dy, dx);
        const near = 1 - dist / GF_VIEW.markR, sz = 3 + 5 * near;
        c.globalAlpha = 0.35 + 0.6 * near;
        c.fillStyle = GF_KINDS[cr.kind].col;
        c.beginPath();
        c.moveTo(ax + Math.cos(a) * sz, ay + Math.sin(a) * sz);
        c.lineTo(ax + Math.cos(a + 2.4) * sz, ay + Math.sin(a + 2.4) * sz);
        c.lineTo(ax + Math.cos(a - 2.4) * sz, ay + Math.sin(a - 2.4) * sz);
        c.closePath(); c.fill();
    }
    c.restore();
}
