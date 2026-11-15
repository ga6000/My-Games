// ===================================================
//   Gyro Fleet — arms and the flown ship's look
// ===================================================
// Pass 3 (2026-11-14). Ry: shots should be "more intentionally designed
// rather than just shooting circles", an alternate homing weapon, a fleshed-out
// ship, and the ship must be easy to see at the game's zoom.
//
//   BLASTER (hold left)   twin barrels firing alternately: shaped bolts
//                         (hot core, amber glow, length along the motion),
//                         muzzle flash, slight jitter. Breath rule applies:
//                         armour bounces it, the open vent or a deflated body
//                         takes it.
//   SEEKER (right click)  homing missile at the creature nearest the cursor
//                         (lock brackets show it). 3 charges, one back every
//                         GF_ARMS.seeker.recharge s. It BURROWS: ignores
//                         armour (the one breath-rule exception, paid for by
//                         the charges).
//   THE SHIP              drawn at a fixed minimum size (the engine's real
//                         size is a pixel or two), with swept wings, canopy,
//                         twin engines whose flames follow speed, and a turret.
//
// Weapons are data (GF_ARMS) so each crew class can bring its own in the
// classes pass. Today the flown ship carries blaster + seeker.
"use strict";

const GF_ARMS = {
    blaster: { rate: 8, speed: 1.0, life: 95, jitter: 0.035, barrel: 4, col: "#FFB000", core: "#FFF6D8" },
    seeker:  { charges: 3, recharge: 5, speed0: 0.5, speedMax: 1.2, accel: 0.025, turn: 0.09, life: 260, dmg: 3,
               lockR: 320, col: "#FF5BD1" }
};

const gfMissiles = [];
const gfMuzzle = { t: 0, a: 0, side: 1 };
const gfFx = [];   // impact rings: { x, y, t, col, r }
let gfSeekerCharges = GF_ARMS.seeker.charges, gfSeekerT = 0;

function gfCursorWorld() {
    return { x: glCamera.x + (glMouse.x - glCX) / glCamera.zoom, y: glCamera.y + (glMouse.y - glCY) / glCamera.zoom };
}

// ---- blaster ----
function gfFireBlaster(s) {
    const W = GF_ARMS.blaster;
    const a = gfAimAngle() + (Math.random() - 0.5) * 2 * W.jitter;
    gfMuzzle.side = -gfMuzzle.side;
    // Barrel offset in SCREEN px, so the twin pattern reads at any zoom.
    const off = W.barrel / glCamera.zoom * gfMuzzle.side;
    const px = s.x + Math.cos(a + Math.PI / 2) * off, py = s.y + Math.sin(a + Math.PI / 2) * off;
    if (glBullets.length >= GL_MAX_BULLETS) return;
    glBullets.push({ x: px, y: py, vx: Math.cos(a) * W.speed + s.vx, vy: Math.sin(a) * W.speed + s.vy,
                     life: W.life, size: 2, color: W.col, gf: "bolt" });
    glAudioShot();
    gfMuzzle.t = 0.06; gfMuzzle.a = a;
}

// ---- seeker ----
function gfSeekerTarget() {
    const w = gfCursorWorld();
    let best = null, bd = GF_ARMS.seeker.lockR / Math.max(0.5, glCamera.zoom / 3);
    for (let i = 0; i < gfCreatures.length; i++) {
        const c = gfCreatures[i];
        const d = Math.hypot(c.x - w.x, c.y - w.y);
        if (d < bd) { bd = d; best = c; }
    }
    return best;
}
function gfFireSeeker() {
    const s = glShip;
    if (!s.isAlive || gfFlight.jump === "burst" || gfSeekerCharges < 1) return;
    const W = GF_ARMS.seeker, a = gfAimAngle();
    gfSeekerCharges--;
    gfMissiles.push({ x: s.x, y: s.y, vx: s.vx + Math.cos(a) * W.speed0, vy: s.vy + Math.sin(a) * W.speed0,
                      a: a, sp: W.speed0, life: W.life, target: gfSeekerTarget(), trail: [] });
    glAudioShot();
}

// ---- per-frame (from gfUpdate) ----
function gfArmsUpdate(dt) {
    const W = GF_ARMS.seeker;
    if (gfSeekerCharges < W.charges) {
        gfSeekerT += dt;
        if (gfSeekerT >= W.recharge) { gfSeekerT = 0; gfSeekerCharges++; }
    } else gfSeekerT = 0;
    gfMuzzle.t = Math.max(0, gfMuzzle.t - dt);
    for (let i = gfFx.length - 1; i >= 0; i--) { gfFx[i].t -= dt; if (gfFx[i].t <= 0) gfFx.splice(i, 1); }

    for (let i = gfMissiles.length - 1; i >= 0; i--) {
        const m = gfMissiles[i];
        if (m.target && (m.target.hp <= 0 || gfCreatures.indexOf(m.target) === -1)) m.target = null;
        if (!m.target) {   // re-acquire the nearest creature ahead
            let bd = 600;
            for (let j = 0; j < gfCreatures.length; j++) {
                const c = gfCreatures[j], d = Math.hypot(c.x - m.x, c.y - m.y);
                if (d < bd) { bd = d; m.target = c; }
            }
        }
        if (m.target) {
            const want = Math.atan2(m.target.y - m.y, m.target.x - m.x);
            const da = glWrapAngle(want - m.a);
            m.a += Math.max(-W.turn, Math.min(W.turn, da));
        }
        m.sp = Math.min(W.speedMax, m.sp + W.accel);
        m.vx = glLerp(m.vx, Math.cos(m.a) * m.sp, 0.2);
        m.vy = glLerp(m.vy, Math.sin(m.a) * m.sp, 0.2);
        m.trail.push({ x: m.x, y: m.y });
        if (m.trail.length > 14) m.trail.shift();
        m.x += m.vx; m.y += m.vy;
        m.life--;
        let hit = null;
        for (let j = 0; j < gfCreatures.length; j++) {
            const c = gfCreatures[j];
            if (Math.hypot(c.x - m.x, c.y - m.y) < c.b.r + 0.6) { hit = c; break; }
        }
        if (hit) {
            hit.hp -= W.dmg; hit.flash = 0.25;
            if (hit.grabbing) { hit.grabbing.gfGrab = null; hit.grabbing = null; hit.tendrilCd = 3; }
            glSpawnBurst(m.x, m.y, 16, W.col);
            gfFx.push({ x: m.x, y: m.y, t: 0.35, col: W.col, r: 26 });
        }
        if (hit || m.life <= 0) { if (!hit) glSpawnBurst(m.x, m.y, 6, "#8FA3A8"); gfMissiles.splice(i, 1); }
    }
}

// Called from gfUpdateBulletHits when a bolt wounds (true) or bounces (false).
function gfBoltImpact(x, y, wound) {
    gfFx.push({ x: x, y: y, t: wound ? 0.22 : 0.12, col: wound ? "#FFE45C" : "#cfe9e6", r: wound ? 12 : 6 });
}

// ---- drawing: world (from gfDrawWorld, after creatures) ----
function gfDrawArmsWorld(c, z) {
    c.save();
    c.lineCap = "round";
    // Bolts: a streak along the bolt's motion RELATIVE to the camera, so a
    // bolt fired while moving still reads as flying away from you.
    const W = GF_ARMS.blaster;
    for (let i = 0; i < glBullets.length; i++) {
        const b = glBullets[i];
        if (b.gf !== "bolt") continue;
        const p = glWorldToScreenRaw(b.x, b.y);
        if (p.x < -30 || p.y < -30 || p.x > glW + 30 || p.y > glH + 30) continue;
        const rvx = b.vx - gfViewCamV.x, rvy = b.vy - gfViewCamV.y;
        const rl = Math.hypot(rvx, rvy) || 1, L = b.gfBounced ? 5 : 11;
        const tx = p.x - rvx / rl * L, ty = p.y - rvy / rl * L;
        const fade = Math.min(1, b.life / 20);
        c.globalAlpha = 0.35 * fade; c.strokeStyle = b.gfBounced ? "#8FA3A8" : W.col; c.lineWidth = 5;
        c.beginPath(); c.moveTo(tx, ty); c.lineTo(p.x, p.y); c.stroke();
        c.globalAlpha = fade; c.strokeStyle = b.gfBounced ? "#cfe9e6" : W.core; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(tx, ty); c.lineTo(p.x, p.y); c.stroke();
    }
    c.globalAlpha = 1;
    // Seekers: smoke trail, body, nose glow.
    const S = GF_ARMS.seeker;
    for (let i = 0; i < gfMissiles.length; i++) {
        const m = gfMissiles[i];
        for (let k = 1; k < m.trail.length; k++) {
            const a = glWorldToScreenRaw(m.trail[k - 1].x, m.trail[k - 1].y), b = glWorldToScreenRaw(m.trail[k].x, m.trail[k].y);
            c.globalAlpha = 0.05 + 0.3 * k / m.trail.length; c.strokeStyle = "#cfc0e0"; c.lineWidth = 1 + 2.5 * k / m.trail.length;
            c.beginPath(); c.moveTo(a.x, a.y); c.lineTo(b.x, b.y); c.stroke();
        }
        c.globalAlpha = 1;
        const p = glWorldToScreenRaw(m.x, m.y);
        c.save(); c.translate(p.x, p.y); c.rotate(m.a);
        c.fillStyle = "#E8DFF5"; c.beginPath(); c.moveTo(6, 0); c.lineTo(-4, 2.2); c.lineTo(-4, -2.2); c.closePath(); c.fill();
        c.fillStyle = S.col; c.beginPath(); c.arc(-5, 0, 2 + Math.random() * 1.5, 0, Math.PI * 2); c.fill();
        c.restore();
    }
    // Impact rings.
    for (let i = 0; i < gfFx.length; i++) {
        const f = gfFx[i], p = glWorldToScreenRaw(f.x, f.y), k = f.t / 0.35;
        c.globalAlpha = Math.min(1, k * 2); c.strokeStyle = f.col; c.lineWidth = 1.5;
        c.beginPath(); c.arc(p.x, p.y, f.r * (1.2 - k), 0, Math.PI * 2); c.stroke();
    }
    c.restore();
}

// ---- drawing: the flown ship, turret and seeker HUD (from gfFlightOverlay) ----
function gfDrawShip(c, s, p) {
    const L = Math.max(13, s.size * glCamera.zoom * 1.2);   // half-length in px
    const k = L / 13;
    const sp = Math.hypot(s.vx, s.vy) / s.baseSpeed;          // in cruise units
    c.save();
    c.translate(p.x, p.y);
    c.rotate(s.angle);
    c.scale(k, k);
    // Engine flames: length follows speed, flicker.
    const fl = (4 + Math.min(sp, 8) * 2.2 + (gfFlight.jump === "burst" ? 18 : 0)) * (0.85 + Math.random() * 0.3);
    [-4, 4].forEach(function (y) {
        const g = c.createLinearGradient(-9, y, -9 - fl, y);
        g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.3, "rgba(125,249,255,0.8)"); g.addColorStop(1, "rgba(125,249,255,0)");
        c.fillStyle = g;
        c.beginPath(); c.moveTo(-9, y - 1.8); c.lineTo(-9 - fl, y); c.lineTo(-9, y + 1.8); c.closePath(); c.fill();
    });
    // Wings (swept), then fuselage, nacelles, canopy, wing-tip lights.
    c.lineJoin = "round";
    c.fillStyle = "#0E2A33"; c.strokeStyle = "#7DF9FF"; c.lineWidth = 1.2 / k;
    c.beginPath();
    c.moveTo(4, 0); c.lineTo(-6, 11); c.lineTo(-10, 11); c.lineTo(-7, 3); c.lineTo(-7, -3); c.lineTo(-10, -11); c.lineTo(-6, -11);
    c.closePath(); c.fill(); c.stroke();
    c.fillStyle = "#16424F";
    c.beginPath(); c.moveTo(14, 0); c.lineTo(4, 3.5); c.lineTo(-9, 3); c.lineTo(-9, -3); c.lineTo(4, -3.5); c.closePath(); c.fill(); c.stroke();
    c.fillStyle = "#0B2028";
    c.fillRect(-10, -5.5, 7, 3); c.strokeRect(-10, -5.5, 7, 3);
    c.fillRect(-10, 2.5, 7, 3); c.strokeRect(-10, 2.5, 7, 3);
    c.fillStyle = "#C9FFE9"; c.globalAlpha = 0.9;
    c.beginPath(); c.ellipse(5, 0, 3.2, 1.6, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
    const blink = (gfTime * 2) % 1 < 0.5;
    c.fillStyle = blink ? "#FF2E88" : "#5a1030"; c.fillRect(-8, -11.5, 2, 2);
    c.fillStyle = blink ? "#7DFF9C" : "#103a20"; c.fillRect(-8, 9.5, 2, 2);
    c.restore();

    // Turret on top: locked to the cursor, with the muzzle flash.
    if (gfFlight.jump !== "burst") {
        const ta = gfAimAngle(), TL = 9 * k;
        c.save(); c.translate(p.x, p.y);
        c.strokeStyle = "#FFB000"; c.lineWidth = 2.6 * Math.min(1.5, k); c.lineCap = "round";
        const ox = Math.cos(ta + Math.PI / 2) * 1.6 * k, oy = Math.sin(ta + Math.PI / 2) * 1.6 * k;
        c.beginPath();
        c.moveTo(ox, oy); c.lineTo(ox + Math.cos(ta) * TL, oy + Math.sin(ta) * TL);
        c.moveTo(-ox, -oy); c.lineTo(-ox + Math.cos(ta) * TL, -oy + Math.sin(ta) * TL);
        c.stroke();
        c.fillStyle = "#3a2a00"; c.strokeStyle = "#FFB000"; c.lineWidth = 1.2;
        c.beginPath(); c.arc(0, 0, 3.2 * Math.min(1.5, k), 0, Math.PI * 2); c.fill(); c.stroke();
        if (gfMuzzle.t > 0) {
            const mx = Math.cos(gfMuzzle.a) * (TL + 3), my = Math.sin(gfMuzzle.a) * (TL + 3);
            c.fillStyle = "rgba(255,246,216,0.9)";
            c.beginPath(); c.arc(mx, my, 3 + Math.random() * 2, 0, Math.PI * 2); c.fill();
        }
        c.restore();
    }

    // Seeker charges: three pips under the ship; lock brackets on the target.
    c.save();
    const S = GF_ARMS.seeker;
    for (let i = 0; i < S.charges; i++) {
        const full = i < gfSeekerCharges;
        const fillK = full ? 1 : (i === gfSeekerCharges ? gfSeekerT / S.recharge : 0);
        const x = p.x - 12 + i * 9, y = p.y + 22 * Math.max(1, k * 0.8);
        c.strokeStyle = S.col; c.globalAlpha = 0.7; c.lineWidth = 1; c.strokeRect(x, y, 6, 3);
        if (fillK > 0) { c.globalAlpha = full ? 0.9 : 0.4; c.fillStyle = S.col; c.fillRect(x, y, 6 * fillK, 3); }
    }
    c.globalAlpha = 1;
    if (gfSeekerCharges > 0 && gfFlight.jump !== "burst") {
        const t = gfSeekerTarget();
        if (t) {
            const tp = glWorldToScreenRaw(t.x, t.y), R = Math.max(8, t.b.r * glCamera.zoom + 5), q = 4;
            c.strokeStyle = S.col; c.lineWidth = 1.2; c.globalAlpha = 0.85;
            c.beginPath();
            [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (d) {
                c.moveTo(tp.x + d[0] * R, tp.y + d[1] * (R - q)); c.lineTo(tp.x + d[0] * R, tp.y + d[1] * R); c.lineTo(tp.x + d[0] * (R - q), tp.y + d[1] * R);
            });
            c.stroke();
        }
    }
    c.restore();
}
