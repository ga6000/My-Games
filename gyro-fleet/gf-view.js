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
    dustN: 110,
    markR: 2600,        // edge markers for creatures this close
    camNear: 5000,      // auto camera works this close to a creature or the hive
    viewMin: 55,        // closest framing (world units, half the short side)
    viewMax: 700,       // widest framing (pass 3: was 1,700, "too far out")
    earthPx: 0.06,      // Earth's parallax: px per world unit
    earthK: 0.42,       // Earth radius as a share of the home-hive distance on its layer
    viewTravel: 110,    // travel view (no fight near)
    viewJump: 350       // during a jump
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
    if (gfViewDropBoost > 0) R = Math.max(R, Math.min(GF_VIEW.viewMax, d * 1.3 + 120));
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

    function farPos(wx, wy) { return { x: glCX + (wx - cam.x) * GF_VIEW.farPx, y: glCY + (wy - cam.y) * GF_VIEW.farPx }; }
    gfDrawEarth(c);
    const h = farPos(gfHive.x, gfHive.y), hr = 300;
    if (h.x > -hr * 2 && h.x < glW + hr * 2 && h.y > -hr * 2 && h.y < glH + hr * 2) {
        const pulse = 0.8 + 0.2 * Math.sin(gfTime * 0.8);
        const gr = c.createRadialGradient(h.x, h.y, 0, h.x, h.y, hr);
        gr.addColorStop(0, "rgba(194,51,90," + (0.28 * pulse).toFixed(3) + ")"); gr.addColorStop(1, "rgba(0,0,0,0)");
        c.fillStyle = gr; c.fillRect(h.x - hr, h.y - hr, hr * 2, hr * 2);
    }

    // MID: rocks and debris, one per hashed cell.
    c.globalAlpha = 1;
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
    // Three depths (pass 3): far specks move at half the camera's speed, near
    // ones at 1.6x and brighter, so the field has depth instead of a flat sheet.
    // Each speck twinkles a little; streaks only grow with real speed.
    while (gfDust.length < GF_VIEW.dustN) {
        const layer = gfDust.length % 3;
        gfDust.push({ x: Math.random() * glW, y: Math.random() * glH, f: [0.5, 1, 1.6][layer], w: [0.8, 1.2, 1.8][layer],
                      al: [0.18, 0.3, 0.5][layer], ph: Math.random() * 6.28 });
    }
    const cvx = gfViewCamV.x * z, cvy = gfViewCamV.y * z;
    for (let i = 0; i < gfDust.length; i++) {
        const d = gfDust[i];
        const vx = cvx * d.f, vy = cvy * d.f;
        d.x = ((d.x - vx) % glW + glW) % glW;
        d.y = ((d.y - vy) % glH + glH) % glH;
        const L = Math.hypot(vx, vy) * 3, k = L > 140 ? 140 / L : 1;
        c.globalAlpha = d.al * (0.75 + 0.25 * Math.sin(gfTime * 2 + d.ph));
        c.strokeStyle = d.f > 1.2 ? "#E6FFF5" : "#9FC9C0"; c.lineWidth = d.w; c.lineCap = "round";
        c.beginPath(); c.moveTo(d.x, d.y); c.lineTo(d.x - vx * 3 * k + 0.01, d.y - vy * 3 * k + 0.01); c.stroke();
    }
    c.globalAlpha = 1; c.lineCap = "butt";

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

// ---- Earth (pass 3): high Earth orbit, the planet fills the backdrop ----
// Placed on its own parallax layer centred between home (the mothership) and
// the hive, so a jump sweeps across the globe: you launch from one side of
// Earth and drop out over the other. Pre-rendered once (procedural land,
// cloud streaks, a few red Hurl wounds), then lit with a terminator and an
// atmosphere rim each frame.
let gfEarthTex = null;
function gfNoise(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
    const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
    const a = gfHash(xi, yi), b = gfHash(xi + 1, yi), c = gfHash(xi, yi + 1), d = gfHash(xi + 1, yi + 1);
    return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function gfBuildEarth() {
    const N = 640, cv = document.createElement("canvas");
    cv.width = cv.height = N;
    const g = cv.getContext("2d"), img = g.createImageData(N, N), px = img.data;
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++) {
        const dx = (x - N / 2) / (N / 2), dy = (y - N / 2) / (N / 2), r2 = dx * dx + dy * dy;
        const o = (y * N + x) * 4;
        if (r2 > 1) { px[o + 3] = 0; continue; }
        // Sphere-ish lookup so features bunch toward the limb.
        const zz = Math.sqrt(1 - r2), sx = dx / (zz + 0.6) * 3.2 + 11, sy = dy / (zz + 0.6) * 3.2 + 5;
        const h = gfNoise(sx, sy) * 0.55 + gfNoise(sx * 2.1, sy * 2.1) * 0.3 + gfNoise(sx * 4.3, sy * 4.3) * 0.15;
        const cl = gfNoise(sx * 1.4 + 40, sy * 5 + 9) * 0.6 + gfNoise(sx * 6, sy * 3 + 2) * 0.4;
        let R, G, B;
        if (h > 0.56) {   // land: scorched browns and dulled greens
            const t = Math.min(1, (h - 0.56) * 4);
            R = 70 + 60 * t; G = 78 + 30 * (1 - t); B = 52;
        } else {          // ocean
            const t = h / 0.56;
            R = 10 + 14 * t; G = 34 + 40 * t; B = 70 + 60 * t;
        }
        if (cl > 0.62) { const k = Math.min(1, (cl - 0.62) * 3.5) * 0.8; R += (225 - R) * k; G += (232 - G) * k; B += (240 - B) * k; }
        px[o] = R; px[o + 1] = G; px[o + 2] = B; px[o + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    // Hurl wounds: a few red glowing pits on the land.
    for (let i = 0; i < 7; i++) {
        const a = gfHash(i, 91) * 6.28, rr = Math.sqrt(gfHash(i, 17)) * N * 0.38;
        const x = N / 2 + Math.cos(a) * rr, y = N / 2 + Math.sin(a) * rr, r = 6 + gfHash(i, 3) * 10;
        const gr = g.createRadialGradient(x, y, 0, x, y, r * 2.2);
        gr.addColorStop(0, "rgba(255,60,80,0.9)"); gr.addColorStop(0.35, "rgba(160,20,50,0.6)"); gr.addColorStop(1, "rgba(80,0,20,0)");
        g.fillStyle = gr; g.beginPath(); g.arc(x, y, r * 2.2, 0, Math.PI * 2); g.fill();
    }
    return cv;
}
function gfEarthPlace() {
    const cam = glCamera, P = GF_VIEW.earthPx;
    const mx = (gfHome.x + gfHive.x) / 2, my = (gfHome.y + gfHive.y) / 2;
    const D = Math.hypot(gfHive.x - gfHome.x, gfHive.y - gfHome.y) * P;
    return { x: glCX + (mx - cam.x) * P, y: glCY + (my - cam.y) * P, r: D * GF_VIEW.earthK };
}
function gfDrawEarth(c) {
    if (!gfEarthTex) gfEarthTex = gfBuildEarth();
    const e = gfEarthPlace(), r = e.r;
    if (e.x + r * 1.2 < 0 || e.x - r * 1.2 > glW || e.y + r * 1.2 < 0 || e.y - r * 1.2 > glH) return;
    c.save();
    // Atmosphere halo.
    const halo = c.createRadialGradient(e.x, e.y, r * 0.96, e.x, e.y, r * 1.12);
    halo.addColorStop(0, "rgba(110,190,255,0.35)"); halo.addColorStop(1, "rgba(110,190,255,0)");
    c.fillStyle = halo; c.beginPath(); c.arc(e.x, e.y, r * 1.12, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 0.85;
    c.drawImage(gfEarthTex, e.x - r, e.y - r, r * 2, r * 2);
    c.globalAlpha = 1;
    // Terminator: the sun is off to the upper left; the far side sinks to night.
    const sh = c.createLinearGradient(e.x - r * 0.6, e.y - r * 0.6, e.x + r * 0.9, e.y + r * 0.9);
    sh.addColorStop(0, "rgba(0,0,0,0)"); sh.addColorStop(0.55, "rgba(0,0,8,0.35)"); sh.addColorStop(1, "rgba(0,0,8,0.88)");
    c.fillStyle = sh; c.beginPath(); c.arc(e.x, e.y, r, 0, Math.PI * 2); c.fill();
    // Bright rim on the lit limb.
    c.strokeStyle = "rgba(170,225,255,0.55)"; c.lineWidth = 2.5;
    c.beginPath(); c.arc(e.x, e.y, r - 1, Math.PI * 0.85, Math.PI * 1.75); c.stroke();
    c.restore();
}
