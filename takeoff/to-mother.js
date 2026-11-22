// ===================================================
//   Takeoff — the human mothership: launch from the silo, the escort climb,
//   held by tendrils, chip damage, the shared hull, the docking ports
// ===================================================
// The mothership's hull is the team's shared health (design brief, "Fail and
// damage rules"). Damage stays for the whole run. Hull 0 ends the run.
//
// Look: Gyro Fleet's mothership (a solid spine hull inside a lattice ring,
// hex bay glowing at its heart, amber running lights), stood on its tail.
// Not to scale: the real one is 5 km.
"use strict";

const toM = {
    x: 0, y: -400, w: 120, h: 250, hull: TO.hull, vy: 0, held: false, flash: 0,
    burn: 0,            // engine plume 0..1
    dead: false, chipT: 0,
    ports: [            // docking collars on the shoulders, one per player (solo uses port 0)
        { dx: -46, dy: 96 }, { dx: 46, dy: 96 }, { dx: -70, dy: 30 }, { dx: 70, dy: 30 }
    ]
};

function toMotherReset() {
    toM.x = 0; toM.y = -toM.h / 2 - 30; toM.vy = 0; toM.hull = TO.hull; toM.held = false; toM.dead = false; toM.burn = 0;
}

function toHullHit(n, x, y, why) {
    if (toGod || toM.dead || toPhase === "after" || toPhase === "card") return;
    toM.hull = Math.max(0, toM.hull - n);
    if (n >= 1) { toM.flash = Math.min(0.3, toM.flash + 0.06 + n * 0.01); toSfx("chip"); }
    else if (Math.random() < 0.02) toM.flash = Math.max(toM.flash, 0.05);
    if (toM.hull <= 0) { toM.dead = true; toLose(why || "hull"); }
}

function toMotherUpdate(dt) {
    toM.flash = Math.max(0, toM.flash - dt);
    if (toM.dead) return;
    const target = toCam.y + TO.homeFrac * TO.VH;
    if (toPhase === "launch") return;   // the launch sequence drives it (to-phases.js)
    if (toM.held && toG) {
        toM.vy = toCam.vy - toG.slide;
        toM.y += toM.vy * dt;
    } else {
        const want = toCam.vy + toClamp((target - toM.y) * 1.2, -60, 90);
        toM.vy += (want - toM.vy) * Math.min(1, dt * 3);
        toM.y += toM.vy * dt;
    }
    // In orbit it rides the pan sideways.
    if (toPhase === "orbit" || toPhase === "dock") {
        const wantX = toCam.x;
        toM.x += (toCam.vx + (wantX - toM.x) * 1.5) * dt;
    } else {
        toM.x += (0 - toM.x) * Math.min(1, dt * 0.8);
    }
    toM.burn = toPhase === "orbit" || toPhase === "dock" ? Math.max(0.15, toM.burn - dt * 0.4) : Math.min(1, toM.burn + dt);
}

function toMotherBottom() { return toM.y - toM.h / 2; }
function toMotherTop() { return toM.y + toM.h / 2; }
// Is a world point inside the hull (a rough capsule)?
function toInMother(x, y, pad) {
    pad = pad || 0;
    const dy = y - toM.y, dx = x - toM.x;
    if (Math.abs(dy) > toM.h / 2 + pad) return false;
    const halfW = (dy > toM.h * 0.3 ? toM.w * 0.18 * (1 - (dy - toM.h * 0.3) / (toM.h * 0.2)) + 6 : toM.w * 0.2) + pad;
    if (Math.abs(dx) < halfW) return true;
    // the lattice ring round the middle
    return Math.hypot(dx, dy) < toM.w * 0.5 + pad && Math.abs(dy) < toM.h * 0.12;
}

// ---- drawing ----
function toDrawMother(c) {
    const m = toM, sx = toSX(m.x), sy = toSY(m.y), s = toCam.s;
    const H = m.h * s, W = m.w * s;
    if (m.dead && toPhaseT > 3) return;
    c.save(); c.translate(sx, sy);
    // Engine plume under it.
    if (m.burn > 0.01) {
        for (let i = -1.5; i <= 1.5; i += 1) {
            const ex = i * W * 0.11, ey = H * 0.5, len = H * (0.35 + 0.35 * m.burn) * (0.9 + Math.random() * 0.2) * (toPhase === "orbit" || toPhase === "dock" ? 0.4 : 1);
            const g = c.createLinearGradient(ex, ey, ex, ey + len);
            g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.2, "rgba(255,210,120,0.85)"); g.addColorStop(0.6, "rgba(255,120,40,0.45)"); g.addColorStop(1, "rgba(255,80,20,0)");
            c.fillStyle = g;
            c.beginPath(); c.moveTo(ex - W * 0.06, ey); c.lineTo(ex, ey + len); c.lineTo(ex + W * 0.06, ey); c.closePath(); c.fill();
        }
    }
    if (m.flash > 0) { c.shadowColor = "#FF2E88"; c.shadowBlur = 20 * m.flash / 0.3; }
    // Engine bells.
    c.fillStyle = "#0E1A1E"; c.strokeStyle = "#8FA89C"; c.lineWidth = 1.2;
    for (let i = -1.5; i <= 1.5; i += 1) {
        const ex = i * W * 0.11;
        c.beginPath(); c.moveTo(ex - W * 0.04, H * 0.44); c.lineTo(ex - W * 0.065, H * 0.51); c.lineTo(ex + W * 0.065, H * 0.51); c.lineTo(ex + W * 0.04, H * 0.44); c.closePath(); c.fill(); c.stroke();
    }
    // Lattice ring (seen edge-on as a flat ellipse) behind the spine.
    c.strokeStyle = "rgba(125,249,255,0.45)"; c.lineWidth = 1;
    c.beginPath(); c.ellipse(0, 0, W * 0.5, H * 0.07, 0, Math.PI, Math.PI * 2); c.stroke();
    // Spine hull.
    c.fillStyle = m.flash > 0.15 ? "#3A1424" : "#13262C"; c.strokeStyle = "#7DF9FF"; c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(0, -H * 0.5);
    c.lineTo(W * 0.12, -H * 0.36); c.lineTo(W * 0.2, -H * 0.2); c.lineTo(W * 0.2, H * 0.36); c.lineTo(W * 0.16, H * 0.44);
    c.lineTo(-W * 0.16, H * 0.44); c.lineTo(-W * 0.2, H * 0.36); c.lineTo(-W * 0.2, -H * 0.2); c.lineTo(-W * 0.12, -H * 0.36);
    c.closePath(); c.fill(); c.stroke();
    // Panel seams.
    c.strokeStyle = "rgba(125,249,255,0.25)"; c.beginPath();
    for (let i = 0; i < 6; i++) { const y = -H * 0.2 + i * H * 0.1; c.moveTo(-W * 0.2, y); c.lineTo(W * 0.2, y); }
    c.moveTo(0, -H * 0.36); c.lineTo(0, H * 0.44); c.stroke();
    // Lattice ring, front half, and its truss.
    c.strokeStyle = "rgba(125,249,255,0.55)";
    c.beginPath(); c.ellipse(0, 0, W * 0.5, H * 0.07, 0, 0, Math.PI); c.stroke();
    c.beginPath(); c.ellipse(0, 0, W * 0.43, H * 0.055, 0, 0, Math.PI); c.stroke();
    c.beginPath();
    for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI + toTime * 0.1 % (Math.PI / 14), b = a + Math.PI / 28;
        c.moveTo(Math.cos(a) * W * 0.5, Math.sin(a) * H * 0.07); c.lineTo(Math.cos(b) * W * 0.43, Math.sin(b) * H * 0.055);
    }
    c.stroke();
    // Hex bay.
    const hb = W * 0.09, pulse = 0.6 + 0.4 * Math.sin(toTime * 3);
    c.fillStyle = "rgba(125,249,255," + (0.25 * pulse).toFixed(3) + ")"; c.strokeStyle = "#C9FFE9";
    c.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3 + Math.PI / 6, x = Math.cos(a) * hb, y = -H * 0.22 + Math.sin(a) * hb; if (i) c.lineTo(x, y); else c.moveTo(x, y); }
    c.closePath(); c.fill(); c.stroke();
    // Running lights.
    for (let i = -4; i <= 4; i++) {
        c.fillStyle = (Math.floor(toTime * 4) + i) % 5 === 0 ? "#FFFFFF" : "rgba(255,176,0,0.6)";
        c.fillRect(-W * 0.2 - 1, i * H * 0.08 - 1, 2, 2); c.fillRect(W * 0.2 - 1, i * H * 0.08 - 1, 2, 2);
    }
    c.shadowBlur = 0;
    // Docking collars on the shoulders (lit amber once docking opens).
    for (let i = 0; i < m.ports.length; i++) {
        const p = m.ports[i], px = p.dx * s, py = -p.dy * s, live = toPhase === "dock" && i === 0 && !toDock.done;
        c.strokeStyle = live ? "#FFB000" : "rgba(143,168,156,0.7)"; c.lineWidth = live ? 2 : 1;
        c.beginPath(); c.moveTo(Math.sign(p.dx) * W * 0.19, py + 4 * s); c.lineTo(px, py); c.stroke();
        c.fillStyle = live ? "rgba(255,176,0," + (0.35 + 0.35 * Math.sin(toTime * 6)).toFixed(2) + ")" : "#0E1A1E";
        c.beginPath(); c.arc(px, py, 7 * s, 0, Math.PI * 2); c.fill(); c.stroke();
        if (live) { c.beginPath(); c.arc(px, py, (12 + 4 * Math.sin(toTime * 6)) * s, 0, Math.PI * 2); c.stroke(); }
    }
    c.restore();
}
