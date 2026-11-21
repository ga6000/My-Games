// ===================================================
//   Takeoff — tendril gates and the boss gate
// ===================================================
// Design brief, "Phase 2: Tendril gates":
//   - Tendrils reach down from the sky and become a WALL that blocks the
//     light from one direction (each gate has its own lighting).
//   - The same tendrils GRIP the mothership and hold it back while the camera
//     keeps panning, so it slides toward the bottom edge. Its position on
//     screen is the timer.
//   - The wall rides with the held ship, so players trapped below it slide
//     with it. Touching the wall CATCHES you.
//   - Focus fire and WEAK SPOTS snap it. Weak spots are hard to see (they
//     flare now and then; Soren will mark them in a later pass).
//   - Failed gate: the held ship hits the bottom edge, the tendrils break in
//     an explosion, the hull loses about a third, anyone in the blast goes to
//     the respawn timer, and the climb goes on. Never a wipe.
//   - The final gate is a BOSS GATE: a wall that blacks out the whole sky,
//     The Tide's silhouette flashing behind it in lightning, more weak spots,
//     the Bellwether below it. Snapping it lets gravity go: orbit.
// Rescue shot (a teammate shoots a caught player free) needs a second
// player. Solo stand-in: tap SPACE to wriggle out (costs meter), or slip free
// after a few seconds.
"use strict";

const TO_GATE = {
    reach: 2.6,         // seconds for the wall to come down and grab
    above: 70,          // the wall line sits this far above the mothership's nose
    band: 18,           // half-thickness of the wall's lower edge
    spotR: 16,
    wallDmg: 0.25, spotDmg: 1.5, spotBonus: 30,
    normal: { spots: 3, spotHp: 20, pool: 115, slide: 11 },
    boss:   { spots: 5, spotHp: 24, pool: 240, slide: 7 },
    blastR: 170,
    lights: ["left", "right", "top"]
};
let toG = null;

function toGateStart(n, boss) {
    const D = boss ? TO_GATE.boss : TO_GATE.normal;
    toG = { n: n, boss: boss, light: boss ? "all" : TO_GATE.lights[(n - 1) % 3], state: "reach", t: 0,
            pool: D.pool, poolMax: D.pool, baseSlide: D.slide, slide: 0, spots: [], strands: [], bolt: 0, boltT: 2 };
    const PW = toCam.PW;
    for (let i = 0; i < D.spots; i++) {
        const u = (i + 0.5) / D.spots;
        toG.spots.push({ dx: -PW * 0.8 + u * PW * 1.6 + toRand(-30, 30), dy: toRand(-2, 10), hp: D.spotHp, max: D.spotHp, dead: false,
                         ph: Math.random(), flash: 0 });
    }
    const nS = boss ? 40 : 26;
    for (let i = 0; i < nS; i++) toG.strands.push({ u: i / (nS - 1), w: toRand(10, 26) * (boss ? 1.5 : 1), seed: Math.random() * 10 });
    // The gate's aircrab comes down with it.
    const crab = toFoe("crab", toCam.x + (Math.random() < 0.5 ? -1 : 1) * PW * 0.6, toTopY() + 60);
    crab.vy = toCam.vy - 40;
    if (boss) {
        toBell = toFoe("bell", toCam.x, toTopY() + 80);
        toSfx("lightning");
    }
    toSfx("grip");
    toMusicMood("gate");
}

// The wall's lower edge, in world y.
function toGateWallY() {
    if (!toG) return Infinity;
    const hold = toMotherTop() + TO_GATE.above;
    if (toG.state === "reach") {
        const k = Math.min(1, toG.t / TO_GATE.reach), e = 1 - Math.pow(1 - k, 3);
        return toLerp(toTopY() + 80, hold, e);
    }
    if (toG.state === "snap" || toG.state === "burst") return hold + Math.pow(toG.t, 2) * 900;
    return hold;
}

function toGateUpdate(dt) {
    const G = toG;
    if (!G) return;
    G.t += dt;
    const wy = toGateWallY();
    for (let i = 0; i < G.spots.length; i++) G.spots[i].flash = Math.max(0, G.spots[i].flash - dt);
    if (G.state === "reach") {
        // The wall sweeps down: anyone above it is pushed down with it.
        if (!toP.dead && toP.y > wy - 30) { toP.y = wy - 30; toP.vy = Math.min(toP.vy, toCam.vy - 60); }
        if (G.t >= TO_GATE.reach) { G.state = "hold"; G.t = 0; toM.held = true; toCam.shake = 6; }
    } else if (G.state === "hold") {
        // How hard the ship is dragged back: the gate, plus its clamped aircrab, plus the Bellwether.
        let s = G.baseSlide;
        for (let i = 0; i < toFoes.length; i++) {
            const f = toFoes[i];
            if (f.kind === "crab" && f.latch) s += TO_KINDS.crab.drag;
        }
        if (toBell) s += TO_KINDS.bell.drag;
        G.slide = s;
        // Touching the wall catches you.
        if (!toP.dead && !toP.caught && !toP.onPad && toP.y + TO_SHIP.r > wy - TO_GATE.band && toP.inv <= 0) {
            toP.caught = { x: toP.x }; toP.caughtT = 0; toP.wrig = 0; toSfx("caught");
        }
        if (!toP.dead && toP.y > wy - 30 && !toP.caught) toP.y = wy - 30;
        const gap = toMotherBottom() - toCam.y;
        if (gap < 90) toSfx("alarm");
        if (gap <= 6) toGateFail();
        // Boss gate: lightning.
        if (G.boss) {
            G.boltT -= dt; G.bolt = Math.max(0, G.bolt - dt);
            if (G.boltT <= 0) { G.bolt = 0.35; G.boltT = toRand(1.6, 3.4); toSfx("lightning"); }
        }
    } else if (G.t > 1.4) {
        // Snapped or burst: the wall is gone.
        const was = G;
        toG = null;
        toM.held = false;
        toGateDone(was);
    }
}

function toGateBoltHit(b) {
    const G = toG;
    if (G.state !== "hold" && G.state !== "reach") return false;
    const wy = toGateWallY();
    if (b.y < wy - TO_GATE.band) return false;
    // Weak spots first.
    for (let i = 0; i < G.spots.length; i++) {
        const s = G.spots[i];
        if (s.dead) continue;
        if (toDist(b.x, b.y, toCam.x + s.dx, wy + s.dy) < TO_GATE.spotR + 4) {
            const d = TO_GATE.spotDmg * TO_SHIP.wallMul;
            s.hp -= d; s.flash = 0.15; G.pool -= d; toSfx("spot");
            toSpark(b.x, b.y, 4, "#FFE45C", 90, 0.3);
            if (s.hp <= 0) {
                s.dead = true; G.pool -= TO_GATE.spotBonus;
                toSfx("spotdie"); toSpark(toCam.x + s.dx, wy + s.dy, 30, "#FF8AA8", 200, 0.8); toRing(toCam.x + s.dx, wy + s.dy, 50, "#FFE45C", 0.5);
                toAddScore(200, toCam.x + s.dx, wy + s.dy);
                toCam.shake = Math.max(toCam.shake, 4);
            }
            if (G.pool <= 0) toGateSnap();
            return true;
        }
    }
    G.pool -= TO_GATE.wallDmg * TO_SHIP.wallMul;
    toSfx("wall"); toSpark(b.x, wy - TO_GATE.band + 4, 2, "#C24A6E", 60, 0.25);
    if (G.pool <= 0) toGateSnap();
    return true;
}

function toGateSnap() {
    const G = toG;
    if (!G || G.state === "snap" || G.state === "burst") return;
    G.state = "snap"; G.t = 0; toM.held = false;
    toSfx("snap"); toCam.shake = 10;
    if (toP.caught) toShipFree();
    const wy = toGateWallY();
    for (let i = 0; i < 8; i++) toSpark(toCam.x + toRand(-toCam.PW, toCam.PW), wy, 8, "#FF8AA8", 220, 0.8);
    toTally.gates++;
    if (G.boss) { toTally.boss++; toAddScore(5000, toM.x, toMotherTop() + 40, "#FFE45C"); }
    else toAddScore(1000, toM.x, toMotherTop() + 40, "#FFE45C");
}

function toGateFail() {
    const G = toG;
    if (!G || G.state !== "hold") return;
    G.state = "burst"; G.t = 0; toM.held = false;
    const bx = toM.x, by = toMotherTop() + 20;
    toSpark(bx, by, 80, "#FF8A3D", 320, 1.1); toSpark(bx, by, 50, "#FF2E88", 260, 0.9);
    toRing(bx, by, TO_GATE.blastR, "#FF2E88", 0.7); toRing(bx, by, TO_GATE.blastR * 0.6, "#FFB000", 0.5);
    toSfx("boom", 1); toCam.shake = 16;
    if (toP.caught || (!toP.dead && toDist(toP.x, toP.y, bx, by) < TO_GATE.blastR)) toShipKill("caught in the gate blast");
    toTally.failed++;
    toHullHit(TO.gateHit, bx, by, "gate");
}

// ---- drawing ----
function toDrawGateBehind(c) {
    // Boss gate: The Tide's silhouette, seen only in the lightning.
    const G = toG;
    if (!G || !G.boss || G.bolt <= 0) return;
    const k = G.bolt / 0.35, wyS = toSY(toGateWallY());
    c.save();
    c.globalAlpha = 0.85 * k;
    c.fillStyle = "#C9D8FF"; c.fillRect(0, 0, toW, wyS);
    c.fillStyle = "#06060C";
    c.beginPath();
    const cx = toW * 0.5, cy = -toH * 0.15, R = toW * 0.7;
    for (let i = 0; i <= 48; i++) {
        const a = i / 48 * Math.PI * 2, rr = R * (1 + 0.06 * Math.sin(a * 5 + 1) + 0.04 * Math.sin(a * 13));
        const x = cx + Math.cos(a) * rr, y = cy + Math.sin(a) * rr * 0.55;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
    }
    c.closePath(); c.fill();
    // Hanging roots and three orifice rings.
    c.strokeStyle = "#06060C"; c.lineWidth = 9; c.lineCap = "round";
    for (let i = 0; i < 14; i++) {
        const x = cx - R * 0.8 + i * R * 0.12;
        c.beginPath(); c.moveTo(x, cy + R * 0.4); c.quadraticCurveTo(x + 20 * Math.sin(i), cy + R * 0.6, x + 10, wyS); c.stroke();
    }
    c.strokeStyle = "#5A6A8A"; c.lineWidth = 3;
    [-0.35, 0, 0.35].forEach(function (u) { c.beginPath(); c.ellipse(cx + u * R, cy + R * 0.42, R * 0.06, R * 0.03, 0, 0, Math.PI * 2); c.stroke(); });
    c.restore();
}

function toDrawGate(c) {
    const G = toG;
    if (!G) return;
    const wy = toGateWallY(), wyS = toSY(wy), s = toCam.s;
    const gone = G.state === "snap" || G.state === "burst" ? Math.min(1, G.t / 1.2) : 0;
    c.save();
    c.globalAlpha = 1 - gone;
    // The membrane: everything above the wall line, dark wet flesh.
    const top = Math.min(wyS, toH);
    if (top > 0) {
        const g = c.createLinearGradient(0, 0, 0, top);
        g.addColorStop(0, G.boss ? "#050003" : "#12030A"); g.addColorStop(1, "#3A0A1C");
        c.fillStyle = g;
        c.globalAlpha = (1 - gone) * (G.boss ? (G.bolt > 0 ? 0.55 : 0.97) : 0.88);
        c.beginPath(); c.moveTo(0, 0); c.lineTo(toW, 0);
        for (let i = 0; i <= 40; i++) {
            const x = toW - i / 40 * toW;
            c.lineTo(x, wyS + Math.sin(i * 1.7 + toTime * 2) * 5 * s);
        }
        c.closePath(); c.fill();
        c.globalAlpha = 1 - gone;
    }
    // Tendrils: thick ropes down from the sky into the wall, swaying.
    c.lineCap = "round";
    for (let i = 0; i < G.strands.length; i++) {
        const st = G.strands[i], x = toSX(toCam.x - toCam.PW - 20 + st.u * (toCam.PW * 2 + 40));
        const sway = Math.sin(toTime * 1.3 + st.seed) * 12 * s;
        c.strokeStyle = G.boss ? (G.bolt > 0 ? "rgba(20,10,30,0.98)" : "rgba(42,6,20,0.98)") : "rgba(110,18,52,0.95)"; c.lineWidth = st.w * s;
        c.beginPath(); c.moveTo(x + sway * 0.3, -20); c.quadraticCurveTo(x - sway, wyS * 0.5, x + sway * 0.5, wyS + 4); c.stroke();
        c.strokeStyle = "rgba(255,150,180,0.35)"; c.lineWidth = Math.max(1, st.w * s * 0.18);
        c.beginPath(); c.moveTo(x + sway * 0.3 - st.w * 0.2 * s, -20); c.quadraticCurveTo(x - sway - st.w * 0.2 * s, wyS * 0.5, x + sway * 0.5, wyS + 4); c.stroke();
    }
    // The grip: tendrils from the wall wrapped round the mothership's nose.
    if (G.state === "hold" || G.state === "reach") {
        const mx = toSX(toM.x), my = toSY(toMotherTop() - 18), k = G.state === "reach" ? Math.min(1, G.t / TO_GATE.reach) : 1;
        c.strokeStyle = "#7A1C3C"; c.lineWidth = 7 * s;
        [-46, -22, 22, 46].forEach(function (dx, j) {
            const x0 = mx + dx * 1.8 * s, ex = mx + dx * 0.35 * s, ey = toLerp(wyS, my + Math.abs(dx) * 0.6 * s, k);
            c.beginPath(); c.moveTo(x0, wyS); c.bezierCurveTo(x0, wyS + 20 * s, ex + Math.sin(toTime * 4 + j) * 6, ey - 20 * s, ex, ey); c.stroke();
        });
        c.strokeStyle = "rgba(255,46,136,0.7)"; c.lineWidth = 1.5;
        [-46, -22, 22, 46].forEach(function (dx) { const ex = mx + dx * 0.35 * s, ey = toLerp(wyS, my + Math.abs(dx) * 0.6 * s, k); c.beginPath(); c.arc(ex, ey, 5 * s, 0, Math.PI * 2); c.stroke(); });
    }
    // Weak spots: puckered nodes in the wall's edge. Hard to see: dim most of
    // the time, flaring bright for a moment every couple of seconds.
    for (let i = 0; i < G.spots.length; i++) {
        const sp = G.spots[i];
        if (sp.dead) continue;
        const x = toSX(toCam.x + sp.dx), y = toSY(wy + sp.dy), R = TO_GATE.spotR * s;
        const pulse = Math.pow(Math.max(0, Math.sin((toTime / 2.4 + sp.ph) * Math.PI * 2)), 10);
        const vis = Math.min(1, 0.16 + 0.84 * pulse + sp.flash * 5);
        c.globalAlpha = (1 - gone) * vis;
        const g = c.createRadialGradient(x, y, 0, x, y, R * 1.8);
        g.addColorStop(0, "rgba(255,240,150,0.95)"); g.addColorStop(0.45, "rgba(255,170,60,0.5)"); g.addColorStop(1, "rgba(255,170,60,0)");
        c.fillStyle = g; c.beginPath(); c.arc(x, y, R * 1.8, 0, Math.PI * 2); c.fill();
        c.fillStyle = sp.flash > 0 ? "#FFFFFF" : "#FFE45C"; c.beginPath(); c.arc(x, y, R * 0.55 * (0.6 + 0.4 * sp.hp / sp.max), 0, Math.PI * 2); c.fill();
        c.strokeStyle = "#5A1030"; c.lineWidth = 1.2;
        for (let j = 0; j < 8; j++) { const a = j * Math.PI / 4; c.beginPath(); c.moveTo(x + Math.cos(a) * R * 0.6, y + Math.sin(a) * R * 0.6); c.lineTo(x + Math.cos(a) * R, y + Math.sin(a) * R); c.stroke(); }
    }
    c.restore();
}

// The light the wall blocks: shadow from the blocked side.
function toDrawGateLight(c) {
    const G = toG;
    if (!G) return;
    const k = (G.state === "reach" ? Math.min(1, G.t / TO_GATE.reach) : (G.state === "hold" ? 1 : Math.max(0, 1 - G.t / 1.2))) * (G.boss ? 0.35 : 0.55);
    if (k <= 0) return;
    let g;
    if (G.light === "left") g = c.createLinearGradient(0, 0, toW * 0.75, 0);
    else if (G.light === "right") g = c.createLinearGradient(toW, 0, toW * 0.25, 0);
    else g = c.createLinearGradient(0, 0, 0, toH * 0.8);
    g.addColorStop(0, "rgba(0,0,0," + k.toFixed(3) + ")"); g.addColorStop(1, "rgba(0,0,0,0)");
    c.fillStyle = g; c.fillRect(0, 0, toW, toH);
    if (G.boss) { c.fillStyle = "rgba(0,0,0," + k.toFixed(3) + ")"; c.fillRect(0, 0, toW, toH); }
}
