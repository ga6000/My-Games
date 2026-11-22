// ===================================================
//   Takeoff — the flown ship: heavy flight, the booster, the shared meter,
//   Greer's twin blaster, being caught, dying and respawning
// ===================================================
// Pass 1 flies GREER only (Ry, 2026-11-21: "crew kits can come next, let's
// start with greer"). Hull and colours are Gyro Fleet's (gf-crew.js).
//
// Flight: WASD pushes against gravity with a lot of slide (it should feel
// like hauling mass, not a nimble fighter). SPACE fires the rocket booster
// in the WASD direction (straight up if none). Hold left click to fire at
// the cursor. Boosting and firing both draw on ONE meter that refills over
// time (design brief, "Shared resource").
"use strict";

const TO_SHIP = {
    r: 10,              // collision radius
    hp: 100,            // Greer's hull
    thrustUp: 430, thrustSide: 330, thrustDown: 260,
    boost: 540,
    drag: 1.7,          // per second: heavy, slidey
    meterMax: 100, meterRegen: 20,
    boostCost: 40,      // per second
    shotCost: 2.2,      // per bolt: sustained fire roughly matches the refill, so any boost drains it
    rate: 9,            // bolts per second
    boltSpeed: 900, boltLife: 0.9,
    wallMul: 1.5,       // Greer is the strongest against walls and weak spots
    col: "#FFC83D", dark: "#3A2A05", bolt: "#FFB000", core: "#FFF6D8",
    wriggle: 5,         // Space taps to wriggle out of the wall when caught (solo stand-in for the rescue shot)
    caughtMax: 4.5,     // or you slip free on your own after this long
    inv: 2
};

const toP = {
    x: 0, y: 0, vx: 0, vy: 0, ang: Math.PI / 2, hp: TO_SHIP.hp, meter: TO_SHIP.meterMax,
    dead: false, respawnT: 0, inv: 0, caught: null, wrig: 0, caughtT: 0, fireT: 0, side: 1,
    boosting: false, flash: 0, muzzle: 0, onPad: true, deaths: 0
};
const toBolts = [];

function toAimAngle() {
    // world angle from the ship to the cursor
    const wx = toWX(toMouse.sx), wy = toWY(toMouse.sy);
    return Math.atan2(wy - toP.y, wx - toP.x);
}

function toShipReset(x, y) {
    toP.x = x; toP.y = y; toP.vx = 0; toP.vy = 0; toP.ang = Math.PI / 2;
    toP.hp = TO_SHIP.hp; toP.meter = TO_SHIP.meterMax; toP.dead = false; toP.caught = null; toP.inv = 0;
}

function toKeyPressShip(k) {
    if (k === " " && toP.caught && !toP.dead) {
        if (toP.meter >= 4) { toP.meter -= 4; toP.wrig++; toSfx("hurt"); toSpark(toP.x, toP.y + 8, 4, "#FF9FB8", 80, 0.3); }
        if (toP.wrig >= TO_SHIP.wriggle) toShipFree();
    }
}
function toShipFree() {
    if (!toP.caught) return;
    toP.caught = null; toP.wrig = 0; toP.vy = -160; toP.inv = 0.8;
    toSfx("free"); toSpark(toP.x, toP.y, 10, "#FFE0EA", 140, 0.4);
}

function toShipKill(why) {
    if (toP.dead || toGod) return;
    toP.dead = true; toP.respawnT = TO.respawn; toP.caught = null; toP.deaths++;
    toSpark(toP.x, toP.y, 30, TO_SHIP.col, 220, 0.8); toSpark(toP.x, toP.y, 20, "#FF2E88", 160, 0.6);
    toRing(toP.x, toP.y, 40, "#FFC83D", 0.5);
    toSfx("boom", 0.4);
    toP.why = why;
}
function toShipDamage(n, why) {
    if (toP.dead || toP.inv > 0 || toGod) return;
    toP.hp -= n; toP.flash = 0.12; toSfx("hurt");
    if (toP.hp <= 0) toShipKill(why);
}

function toShipUpdate(dt, ctl) {
    const S = TO_SHIP;
    toP.flash = Math.max(0, toP.flash - dt); toP.muzzle = Math.max(0, toP.muzzle - dt); toP.inv = Math.max(0, toP.inv - dt);
    toP.meter = Math.min(S.meterMax, toP.meter + S.meterRegen * dt);
    toP.boosting = false;
    if (toP.dead) {
        toP.respawnT -= dt;
        if (toP.respawnT <= 0 && toPhase !== "after" && toPhase !== "card") toShipRespawn();
        return;
    }
    // Sitting on the pad before liftoff.
    if (toP.onPad) { toP.vx = 0; toP.vy = 0; return; }
    if (toP.caught) {
        // Stuck to the wall: carried with it, no flying, no firing.
        toP.caughtT += dt;
        toP.x = toP.caught.x; toP.y = toGateWallY() - 14;
        toP.vx = 0; toP.vy = 0;
        if (toP.caughtT > S.caughtMax) toShipFree();
        return;
    }
    let ix = 0, iy = 0;
    if (ctl) {
        if (toKeys.a || toKeys.ArrowLeft) ix -= 1;
        if (toKeys.d || toKeys.ArrowRight) ix += 1;
        if (toKeys.w || toKeys.ArrowUp) iy += 1;
        if (toKeys.s || toKeys.ArrowDown) iy -= 1;
    }
    const g = TO.gravity * toGravMul();
    let ax = ix * S.thrustSide, ay = iy > 0 ? S.thrustUp : (iy < 0 ? -S.thrustDown : 0);
    if (ctl && toKeys[" "] && toP.meter > 1) {
        const m = Math.hypot(ix, iy);
        const bx = m ? ix / m : 0, by = m ? iy / m : 1;
        ax += bx * S.boost; ay += by * S.boost;
        toP.meter -= S.boostCost * dt; toP.boosting = true;
    }
    ay -= g;
    toP.vx += (ax - S.drag * toP.vx) * dt;
    toP.vy += (ay - S.drag * toP.vy) * dt;
    toP.x += toP.vx * dt; toP.y += toP.vy * dt;
    // The hull faces where you push (straight up at rest).
    const want = (ix || iy) ? Math.atan2(iy || 0.0001, ix) : Math.PI / 2;
    let d = want - toP.ang; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    toP.ang += d * Math.min(1, dt * 5);
    // Column walls (the column moves with the camera in orbit).
    const L = toCam.x - toCam.PW + S.r, R = toCam.x + toCam.PW - S.r;
    if (toPhase !== "orbit" && toPhase !== "dock") {
        if (toP.x < L) { toP.x = L; toP.vx = Math.abs(toP.vx) * 0.3; }
        if (toP.x > R) { toP.x = R; toP.vx = -Math.abs(toP.vx) * 0.3; }
    } else if (toP.x > R) { toP.x = R; toP.vx = Math.min(toP.vx, toCam.vx); }
    // Top of the frame holds you in.
    const top = toTopY() - S.r - 8;
    if (toP.y > top) { toP.y = top; toP.vy = Math.min(toP.vy, toCam.vy); }
    // Fire.
    toP.fireT -= dt;
    if (ctl && toMouse.down && toP.fireT <= 0 && toP.meter >= S.shotCost) {
        toP.fireT = 1 / S.rate; toP.meter -= S.shotCost;
        const a = toAimAngle() + (Math.random() - 0.5) * 0.05;
        toP.side = -toP.side;
        const ox = Math.cos(a + Math.PI / 2) * 3.5 * toP.side, oy = Math.sin(a + Math.PI / 2) * 3.5 * toP.side;
        toBolts.push({ x: toP.x + ox + Math.cos(a) * 12, y: toP.y + oy + Math.sin(a) * 12, vx: Math.cos(a) * S.boltSpeed + toP.vx * 0.3, vy: Math.sin(a) * S.boltSpeed + toP.vy * 0.3, t: 0, bounced: false });
        toP.muzzle = 0.05; toP.muzzleA = a;
        toSfx("shot");
    }
    // Falling out of the bottom (or the left edge in orbit): straggler.
    const outLeft = (toPhase === "orbit" || toPhase === "dock") && toP.x < toCam.x - toCam.VW / 2 - 30;
    if (toP.y < toCam.y - 40 || outLeft) toStraggle(outLeft);
}

function toStraggle(left) {
    // The smaller blast at the edge (design brief, "Stragglers and respawn").
    const bx = left ? toCam.x - toCam.VW / 2 + 10 : toP.x, by = left ? toP.y : toCam.y + 6;
    toSpark(bx, by, 26, "#FF8A3D", 200, 0.7); toRing(bx, by, 60, "#FF2E88", 0.6);
    if (toPhase !== "orbit" && toPhase !== "dock") toHullHit(TO.straggleHit, bx, by, "straggle");
    toCam.shake = Math.max(toCam.shake, 4);
    toP.x = bx; toP.y = by;
    toShipKill("fell behind");
}

function toShipRespawn() {
    const m = toM;
    toP.dead = false; toP.hp = TO_SHIP.hp; toP.inv = TO_SHIP.inv; toP.caught = null; toP.wrig = 0;
    toP.x = m.x + (Math.random() < 0.5 ? -1 : 1) * (m.w / 2 + 18); toP.y = m.y + m.h * 0.2;
    if (toPhase === "gate" && toG && toP.y > toGateWallY() - 30) toP.y = toGateWallY() - 40;
    toP.vx = toCam.vx; toP.vy = toCam.vy;
    toSfx("respawn"); toRing(toP.x, toP.y, 30, "#00E5FF", 0.5);
}

// ---- bolts ----
function toBoltsUpdate(dt) {
    for (let i = toBolts.length - 1; i >= 0; i--) {
        const b = toBolts[i];
        b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt;
        let dead = b.t > TO_SHIP.boltLife;
        if (!dead && !b.bounced) dead = toBoltHits(b);
        if (!dead && b.bounced && b.t > 0.5) dead = true;
        if (dead) toBolts.splice(i, 1);
    }
}
// Bounced off armour: the bolt glances away, harmless.
function toBoltBounce(b, nx, ny) {
    const d = b.vx * nx + b.vy * ny;
    b.vx = (b.vx - 2 * d * nx) * 0.5; b.vy = (b.vy - 2 * d * ny) * 0.5;
    b.bounced = true; b.t = 0;
    toSfx("tink");
}

// ---- drawing ----
function toDrawGreerHull(c, flash) {
    const S = TO_SHIP;
    c.lineJoin = "round";
    c.fillStyle = flash ? "#FFFFFF" : S.dark; c.strokeStyle = S.col; c.lineWidth = 1.1;
    const poly = function (pts) {
        c.beginPath();
        for (let i = 0; i < pts.length; i += 2) { if (i === 0) c.moveTo(pts[i], pts[i + 1]); else c.lineTo(pts[i], pts[i + 1]); }
        c.closePath(); c.fill(); c.stroke();
    };
    poly([4, 0, -6, 11, -10, 11, -7, 3, -7, -3, -10, -11, -6, -11]);
    poly([12, 0, 4, 3.5, -9, 3, -9, -3, 4, -3.5]);
    poly([15, -6, 2, -6, 2, -4, 15, -4.6]); poly([15, 6, 2, 6, 2, 4, 15, 4.6]);   // the twin prongs
    c.fillStyle = "#EFFFF8"; c.globalAlpha = 0.9;
    c.beginPath(); c.ellipse(3, 0, 2.6, 1.4, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
}

function toDrawShip(c) {
    if (toP.dead) return;
    const sx = toSX(toP.x), sy = toSY(toP.y), k = 1.15 * toCam.s;
    if (toP.inv > 0 && Math.floor(toTime * 14) % 2 === 0) c.globalAlpha = 0.45;
    c.save(); c.translate(sx, sy); c.rotate(-toP.ang); c.scale(k, k);
    // Main engines, and the booster: a long white-hot plume.
    const thr = toP.onPad ? 0.3 : 1;
    const fl = (toP.boosting ? 26 : 7) * thr * (0.85 + Math.random() * 0.3);
    [-4, 4].forEach(function (y) {
        const g = c.createLinearGradient(-9, y, -9 - fl, y);
        g.addColorStop(0, "rgba(255,255,255,0.95)"); g.addColorStop(0.3, toP.boosting ? "rgba(255,200,90,0.9)" : "rgba(125,249,255,0.8)"); g.addColorStop(1, "rgba(255,120,40,0)");
        c.fillStyle = g;
        c.beginPath(); c.moveTo(-9, y - (toP.boosting ? 2.6 : 1.8)); c.lineTo(-9 - fl, y); c.lineTo(-9, y + (toP.boosting ? 2.6 : 1.8)); c.closePath(); c.fill();
    });
    toDrawGreerHull(c, toP.flash > 0);
    const blink = (toTime * 2) % 1 < 0.5;
    c.fillStyle = blink ? "#FF2E88" : "#5a1030"; c.fillRect(-8, -11.5, 2, 2);
    c.fillStyle = blink ? "#7DFF9C" : "#103a20"; c.fillRect(-8, 9.5, 2, 2);
    c.restore();
    // Turret on top, locked to the cursor.
    if (!toP.onPad && !toP.caught) {
        const ta = -toAimAngle(), TL = 9 * k;
        c.save(); c.translate(sx, sy);
        c.strokeStyle = TO_SHIP.col; c.lineWidth = 2.6; c.lineCap = "round";
        const ox = Math.cos(ta + Math.PI / 2) * 1.6 * k, oy = Math.sin(ta + Math.PI / 2) * 1.6 * k;
        c.beginPath();
        c.moveTo(ox, oy); c.lineTo(ox + Math.cos(ta) * TL, oy + Math.sin(ta) * TL);
        c.moveTo(-ox, -oy); c.lineTo(-ox + Math.cos(ta) * TL, -oy + Math.sin(ta) * TL);
        c.stroke();
        c.fillStyle = TO_SHIP.dark; c.lineWidth = 1.2;
        c.beginPath(); c.arc(0, 0, 3.6, 0, Math.PI * 2); c.fill(); c.stroke();
        if (toP.muzzle > 0) {
            c.fillStyle = "rgba(255,246,216,0.9)";
            c.beginPath(); c.arc(Math.cos(ta) * (TL + 3), Math.sin(ta) * (TL + 3), 3 + Math.random() * 2, 0, Math.PI * 2); c.fill();
        }
        c.restore();
    }
    // Caught: tendril strands wrapped round the hull, and the wriggle count.
    if (toP.caught) {
        c.save(); c.strokeStyle = "#FF2E88"; c.lineWidth = 2.5;
        for (let i = 0; i < 3; i++) {
            const a = toTime * 3 + i * 2.1;
            c.beginPath(); c.moveTo(sx - 16, sy - 6 + i * 6); c.quadraticCurveTo(sx + Math.sin(a) * 10, sy - 20, sx + 16, sy - 6 + i * 6); c.stroke();
        }
        for (let i = 0; i < TO_SHIP.wriggle; i++) {
            c.fillStyle = i < toP.wrig ? "#E8FFF4" : "rgba(232,255,244,0.25)";
            c.fillRect(sx - 14 + i * 6, sy + 22, 4, 4);
        }
        c.restore();
    }
    c.globalAlpha = 1;
    // Hull pips under the ship (only when hurt).
    if (toP.hp < TO_SHIP.hp) {
        const w = 30, f = Math.max(0, toP.hp / TO_SHIP.hp);
        c.fillStyle = "rgba(46,58,52,0.9)"; c.fillRect(sx - w / 2, sy + 19, w, 2);
        c.fillStyle = f < 0.35 ? "#FF2E88" : TO_SHIP.col; c.fillRect(sx - w / 2, sy + 19, w * f, 2);
    }
}

function toDrawBolts(c) {
    c.save(); c.lineCap = "round";
    for (let i = 0; i < toBolts.length; i++) {
        const b = toBolts[i], x = toSX(b.x), y = toSY(b.y);
        const m = Math.hypot(b.vx, b.vy) || 1, L = b.bounced ? 14 : 20;
        const tx = x - b.vx / m * L, ty = y + b.vy / m * L;
        c.globalAlpha = b.bounced ? 0.5 : 0.35; c.strokeStyle = b.bounced ? "#8FA89C" : TO_SHIP.bolt; c.lineWidth = 5;
        c.beginPath(); c.moveTo(tx, ty); c.lineTo(x, y); c.stroke();
        c.globalAlpha = 1; c.strokeStyle = b.bounced ? "#E8FFF4" : TO_SHIP.core; c.lineWidth = 1.6;
        c.beginPath(); c.moveTo(tx, ty); c.lineTo(x, y); c.stroke();
    }
    c.restore();
}
