// ===================================================
//   Takeoff — the creatures and the falling debris
// ===================================================
// Design brief, "Enemy roster":
//   AIRKRILL     the main body of the clusters. Dive at you, or latch onto
//                the mothership and crawl over it doing chip damage.
//   AIR PLANKTON new: tiny motes in drifting clouds that pulse together.
//                Hard to hit, so spraying at them burns the meter.
//                (Placeholder look until the bestiary entry is written.)
//   AIRCRAB      one per gate. Pass 1 guess at its job: it clamps onto the
//                mothership beside the grip and drags it down faster (the
//                ship slides quicker while it lives) and chews the hull.
//   BELLWETHER   one per game, at the boss gate (brief's suggested slot).
//                Its breath pulls the whole horde into one rhythm, rolling
//                out from it as a visible wave, and it spits at you.
// All of them follow the BREATH RULE: armoured while inflated (shots bounce
// off), soft on the inhale and while deflated.
"use strict";

const TO_KINDS = {
    krill: { rBig: 6, rSmall: 4.2, hp: 1, period: [1.2, 1.6], pant: true, pts: 100, soft: 150, armd: 75, chip: 0.15, touch: 6 },
    plank: { rBig: 3.0, rSmall: 2.4, hp: 1, period: [2.2, 2.2], pant: false, pts: 10, chip: 0.6, touch: 3 },
    crab:  { rBig: 22, rSmall: 14, hp: 12, period: [4.5, 5.5], pant: false, pts: 500, soft: 120, armd: 60, chip: 0.6, touch: 15, drag: 5 },
    bell:  { rBig: 34, rSmall: 22, hp: 40, period: [6, 6], pant: false, pts: 500, soft: 50, armd: 30, chip: 0, touch: 20, drag: 3 }
};
const toFoes = [];
const toDebris = [];
const toSpit = [];
let toBell = null;

function toFoe(kind, x, y, opts) {
    const k = TO_KINDS[kind];
    const f = { kind: kind, x: x, y: y, vx: 0, vy: 0, hp: k.hp, seed: Math.random() * 10, flash: 0, press: 0,
                p: Math.random(), period: toRand(k.period[0], k.period[1]), face: -Math.PI / 2,
                latch: null, target: null, orbitA: Math.random() * 6.28, spitT: 2 + Math.random() * 2,
                b: { stage: "deflated", armour: false, swell: 0, open: false, r: k.rSmall } };
    Object.assign(f, opts || {});
    toFoes.push(f);
    return f;
}

// A cluster arriving from above (or from a side for krill now and then).
function toSpawnCluster(kind, n, opts) {
    opts = opts || {};
    const PW = toCam.PW, top = toTopY() + 40;
    const cx = opts.x !== undefined ? opts.x : toCam.x + toRand(-PW * 0.7, PW * 0.7);
    const phase = Math.random();
    for (let i = 0; i < n; i++) {
        const spread = kind === "plank" ? 70 : 50;
        const f = toFoe(kind, cx + toRand(-spread, spread), top + toRand(0, spread), opts.extra);
        if (kind === "plank") { f.p = phase + i * 0.01; f.vy = toCam.vy - 40; }
        if (kind === "krill") {
            f.target = Math.random() < 0.55 ? "mother" : "player";
            f.vy = toCam.vy - 30;
        }
    }
}

function toSpawnDebris(n) {
    for (let i = 0; i < n; i++) {
        toDebris.push({ x: toCam.x + toRand(-toCam.PW, toCam.PW), y: toTopY() + 30 + toRand(0, 260), vx: toRand(-20, 20), vy: toRand(-170, -120),
                        r: toRand(8, 19), rot: Math.random() * 6, vr: toRand(-2, 2), seed: Math.random() * 10 });
    }
}

// ---- breath ----
function toBreath(f, dt) {
    const k = TO_KINDS[f.kind];
    if (toBell && toBell !== f && toBell.hp > 0 && f.kind !== "plank") {
        // The Bellwether's breath rolls out from it: everything takes its phase, late by distance.
        const d = toDist(f.x, f.y, toBell.x, toBell.y);
        const want = toFrac(toBell.p - d / 120 / toBell.period * 0.5);
        f.p = want;
    } else {
        f.p = toFrac(f.p + dt / f.period);
    }
    const p = f.p, b = f.b;
    if (k.pant && f.latch) {
        // Feeding on the hull, airkrill stay deflated: soft, easy to scrape off.
        b.armour = false; b.swell = 0.3; b.stage = "deflated"; b.open = false;
    } else if (k.pant) {
        b.armour = p < 0.5; b.swell = p < 0.5 ? 1 : 0; b.stage = p < 0.5 ? "inflated" : "deflated"; b.open = false;
    } else if (f.kind === "plank") {
        b.armour = p < 0.25; b.swell = p < 0.25 ? 1 : 0.2; b.stage = b.armour ? "inflated" : "deflated"; b.open = false;
    } else if (p < 0.3) { b.stage = "inhale"; b.swell = p / 0.3; b.armour = false; b.open = true; }
    else if (p < 0.55) { b.stage = "inflated"; b.swell = 1; b.armour = true; b.open = false; }
    else if (p < 0.75) { b.stage = "exhale"; b.swell = 1 - (p - 0.55) / 0.2; b.armour = true; b.open = false; }
    else { b.stage = "deflated"; b.swell = 0; b.armour = false; b.open = false; }
    b.r = k.rSmall + (k.rBig - k.rSmall) * b.swell;
}

function toFoesUpdate(dt) {
    for (let i = toFoes.length - 1; i >= 0; i--) {
        const f = toFoes[i], k = TO_KINDS[f.kind];
        f.flash = Math.max(0, f.flash - dt);
        toBreath(f, dt);
        if (f.flee) {
            f.vy -= 200 * dt; f.x += f.vx * dt; f.y += f.vy * dt; f.face = -Math.PI / 2;
            if (f.y < toCam.y - 100) toFoes.splice(i, 1);
            continue;
        }
        if (f.latch) {
            // Crawling over the hull: position rides the mothership, chip damage ticks.
            f.latch.dx += Math.sin(toTime * 1.3 + f.seed) * 6 * dt;
            f.latch.dy += Math.cos(toTime * 0.9 + f.seed) * 6 * dt;
            f.latch.dx = toClamp(f.latch.dx, -toM.w * 0.24, toM.w * 0.24);
            f.latch.dy = toClamp(f.latch.dy, -toM.h * 0.42, toM.h * 0.42);
            f.x = toM.x + f.latch.dx; f.y = toM.y + f.latch.dy;
            f.face = Math.atan2(-f.latch.dy, -f.latch.dx);
            toHullHit(k.chip * dt, f.x, f.y, "eaten by crawlers");
            if (Math.random() < dt * 1.5) toSpark(f.x, f.y, 2, "#8FA89C", 50, 0.3);
        } else if (f.kind === "plank") {
            f.vx = Math.sin(toTime * 1.7 + f.seed) * 18;
            f.vy = toCam.vy - 40;
            f.x += f.vx * dt; f.y += f.vy * dt;
            if (!toP.dead && !toP.onPad && toDist(f.x, f.y, toP.x, toP.y) < TO_SHIP.r + f.b.r) { toShipDamage(k.touch, "plankton"); toFoeDie(i, false); continue; }
            if (toInMother(f.x, f.y, 2)) { toHullHit(k.chip, f.x, f.y, "plankton"); toSpark(f.x, f.y, 3, "#E8FFF4", 40, 0.3); toFoeDie(i, false); continue; }
        } else if (f.kind === "bell") {
            toBellUpdate(f, dt);
        } else {
            toFoeSteer(f, k, dt);
        }
        // Gone off the bottom: dropped quietly.
        if (f.y < toCam.y - 160 || (toPhase === "orbit" && f.x < toCam.x - toCam.VW)) { toFoes.splice(i, 1); continue; }
    }
    // Debris falls.
    for (let i = toDebris.length - 1; i >= 0; i--) {
        const d = toDebris[i];
        d.x += d.vx * dt; d.y += d.vy * dt; d.rot += d.vr * dt;
        if (!toP.dead && !toP.onPad && !toP.caught && toDist(d.x, d.y, toP.x, toP.y) < d.r + TO_SHIP.r) {
            toShipDamage(14, "debris"); toP.vy += d.vy * 0.8; toP.vx += (toP.x - d.x) * 4;
            toSpark(d.x, d.y, 10, "#8FA89C", 120, 0.5); toDebris.splice(i, 1); continue;
        }
        if (toInMother(d.x, d.y, d.r * 0.6)) { toHullHit(3, d.x, d.y, "debris"); toSpark(d.x, d.y, 12, "#FF8A3D", 140, 0.5); toSfx("hit"); toDebris.splice(i, 1); continue; }
        if (d.y < toCam.y - 100) toDebris.splice(i, 1);
    }
    // Spit (enemy fire is magenta).
    for (let i = toSpit.length - 1; i >= 0; i--) {
        const s = toSpit[i];
        s.t += dt; s.x += s.vx * dt; s.y += s.vy * dt;
        let gone = s.t > 4;
        if (!gone && !toP.dead && !toP.caught && toDist(s.x, s.y, toP.x, toP.y) < TO_SHIP.r + 5) { toShipDamage(10, "spit"); gone = true; }
        if (!gone && toInMother(s.x, s.y, 3)) { toHullHit(0.6, s.x, s.y, "spit"); gone = true; }
        if (gone) { toSpark(s.x, s.y, 6, "#FF2E88", 90, 0.35); toSpit.splice(i, 1); }
    }
}

function toFoeSteer(f, k, dt) {
    const soft = !f.b.armour, sp = (soft ? k.soft : k.armd);
    let tx, ty;
    const goMother = f.kind === "crab" || f.target === "mother" || toP.dead || toP.onPad;
    if (goMother) {
        if (!f.aim) f.aim = { dx: toRand(-toM.w * 0.22, toM.w * 0.22), dy: f.kind === "crab" ? toM.h * 0.36 : toRand(-toM.h * 0.4, toM.h * 0.4) };
        tx = toM.x + f.aim.dx; ty = toM.y + f.aim.dy;
        if (toDist(f.x, f.y, tx, ty) < 10 + f.b.r * 0.5 || toInMother(f.x, f.y, 0)) {
            f.latch = { dx: f.x - toM.x, dy: f.y - toM.y };
            f.latch.dx = toClamp(f.latch.dx, -toM.w * 0.24, toM.w * 0.24);
            if (f.kind === "crab") { toSfx("grip"); f.latch.dy = toM.h * 0.36; f.latch.dx = toClamp(f.latch.dx, -18, 18); }
            return;
        }
    } else {
        // Hunting the player: circle while armoured, dive while soft.
        if (soft) { tx = toP.x; ty = toP.y; }
        else { f.orbitA += dt * 1.4; tx = toP.x + Math.cos(f.orbitA) * 70; ty = toP.y + Math.sin(f.orbitA) * 70; }
    }
    const a = Math.atan2(ty - f.y, tx - f.x);
    let d = a - f.face; while (d > Math.PI) d -= Math.PI * 2; while (d < -Math.PI) d += Math.PI * 2;
    f.face += d * Math.min(1, dt * 3);
    const wx = toCam.vx + Math.cos(f.face) * sp, wy = toCam.vy + Math.sin(f.face) * sp;
    f.vx += (wx - f.vx) * Math.min(1, dt * 2.5); f.vy += (wy - f.vy) * Math.min(1, dt * 2.5);
    f.x += f.vx * dt; f.y += f.vy * dt;
    if (!toP.dead && !toP.onPad && !toP.caught && toDist(f.x, f.y, toP.x, toP.y) < TO_SHIP.r + f.b.r) {
        toShipDamage(k.touch, f.kind);
        const n = Math.atan2(f.y - toP.y, f.x - toP.x);
        f.vx = Math.cos(n) * 220; f.vy = Math.sin(n) * 220; f.face = n;
        toP.vx -= Math.cos(n) * 120; toP.vy -= Math.sin(n) * 120;
    }
}

function toBellUpdate(f, dt) {
    // Hovers under the boss wall, drifting side to side, spitting at you.
    const wantY = (toG ? toGateWallY() : toTopY()) - 90 + Math.sin(toTime * 0.7) * 20;
    const wantX = toCam.x + Math.sin(toTime * 0.35 + f.seed) * toCam.PW * 0.6;
    f.vx += ((wantX - f.x) * 0.8 - f.vx) * Math.min(1, dt * 1.5);
    f.vy = toCam.vy + (wantY - f.y) * 1.5;
    f.x += f.vx * dt; f.y += f.vy * dt;
    f.face = Math.atan2(toP.y - f.y, toP.x - f.x);
    const prev = f.lastP || 0;
    if (prev > 0.9 && f.p < 0.1) toRing(f.x, f.y, 140, "rgba(255,138,128,0.8)", 1.2);   // its inhale: the wave goes out
    f.lastP = f.p;
    f.spitT -= dt;
    if (f.spitT <= 0 && !toP.dead) {
        f.spitT = 2.4;
        const a = Math.atan2(toP.y - f.y, toP.x - f.x);
        for (let s = -1; s <= 1; s++) toSpit.push({ x: f.x, y: f.y, vx: Math.cos(a + s * 0.18) * 240 + toCam.vx, vy: Math.sin(a + s * 0.18) * 240 + toCam.vy, t: 0 });
        toSfx("hurt");
    }
}

function toFoeDie(i, scored) {
    const f = toFoes[i], k = TO_KINDS[f.kind];
    toFoes.splice(i, 1);
    if (f === toBell) toBell = null;
    if (!scored) return;
    const big = f.kind === "crab" || f.kind === "bell";
    toSpark(f.x, f.y, big ? 40 : (f.kind === "plank" ? 4 : 12), big ? "#FF8AA8" : "#D9BEFF", big ? 200 : 110, big ? 0.9 : 0.45);
    if (big) toRing(f.x, f.y, f.b.r * 2.4, "#FFB4C6", 0.5);
    toSfx("pop", big ? 1 : (f.kind === "plank" ? 0 : 0.2));
    toTally[f.kind]++;
    toAddScore(k.pts, f.x, f.y);
    if (f.kind === "crab" || f.kind === "bell") toCam.shake = Math.max(toCam.shake, 5);
}

// A bolt against everything solid. Returns true if the bolt is used up.
function toBoltHits(b) {
    for (let i = 0; i < toFoes.length; i++) {
        const f = toFoes[i], r = f.b.r + (f.kind === "plank" ? 1 : 3);
        if (Math.abs(f.x - b.x) > r || Math.abs(f.y - b.y) > r) continue;
        if (toDist(f.x, f.y, b.x, b.y) > r) continue;
        if (f.b.armour) {
            const n = Math.atan2(b.y - f.y, b.x - f.x);
            toBoltBounce(b, Math.cos(n), Math.sin(n));
            toFx.push({ k: "r", x: b.x, y: b.y, r: 6, t: 0, life: 0.2, col: "#E8FFF4" });
            return false;
        }
        f.hp -= 1; f.flash = 0.08; toSfx("hit");
        if (f.hp <= 0) toFoeDie(i, true);
        return true;
    }
    for (let i = 0; i < toDebris.length; i++) {
        const d = toDebris[i];
        if (toDist(d.x, d.y, b.x, b.y) < d.r) { toSpark(b.x, b.y, 3, "#8FA89C", 60, 0.2); return true; }
    }
    if (toG && toGateBoltHit(b)) return true;
    return false;
}

// ---- drawing ----
function toDrawFoes(c) {
    // Plankton and krill first, the big bodies on top.
    for (let pass = 0; pass < 2; pass++) {
        for (let i = 0; i < toFoes.length; i++) {
            const f = toFoes[i], big = f.kind === "crab" || f.kind === "bell";
            if ((pass === 0) === big) continue;
            const x = toSX(f.x), y = toSY(f.y);
            if (x < -80 || x > toW + 80 || y < -80 || y > toH + 80) continue;
            const R = Math.max(f.kind === "plank" ? 2 : 4, f.b.r * toCam.s);
            c.save(); c.translate(x, y); c.rotate(-f.face);
            if (f.kind === "plank") toDrawPlank(c, f, R);
            else if (f.kind === "krill") toDrawKrill(c, f, R);
            else toDrawBody(c, f, R);
            c.restore();
        }
    }
    // Debris: tumbling hot chunks with a re-entry streak above them.
    for (let i = 0; i < toDebris.length; i++) {
        const d = toDebris[i], x = toSX(d.x), y = toSY(d.y), R = d.r * toCam.s;
        if (y < -60 || y > toH + 60) continue;
        const g = c.createLinearGradient(x, y, x, y - R * 5);
        g.addColorStop(0, "rgba(255,140,60,0.45)"); g.addColorStop(1, "rgba(255,140,60,0)");
        c.fillStyle = g; c.beginPath(); c.moveTo(x - R * 0.7, y); c.lineTo(x, y - R * 5); c.lineTo(x + R * 0.7, y); c.closePath(); c.fill();
        c.save(); c.translate(x, y); c.rotate(d.rot);
        c.fillStyle = "#1A1F1D"; c.strokeStyle = "#8FA89C"; c.lineWidth = 1.3;
        c.beginPath();
        for (let j = 0; j < 7; j++) { const a = j / 7 * Math.PI * 2, rr = R * (0.7 + 0.3 * toFrac(Math.sin(d.seed * 9 + j * 3.1) * 999)); if (j) c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr); else c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); }
        c.closePath(); c.fill(); c.stroke();
        c.restore();
    }
    // Spit.
    for (let i = 0; i < toSpit.length; i++) {
        const s = toSpit[i], x = toSX(s.x), y = toSY(s.y);
        c.fillStyle = "rgba(255,46,136,0.35)"; c.beginPath(); c.arc(x, y, 9, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#FF2E88"; c.beginPath(); c.arc(x, y, 4.5, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#FFE0EE"; c.beginPath(); c.arc(x - 1, y - 1, 1.6, 0, Math.PI * 2); c.fill();
    }
}
