// ===================================================
//   Gyro Fleet — aircrabs, airkrill, the Bellwether, The Tide, the round
// ===================================================
// Pass 1 (2026-11-08) made the creatures. The FLOOD pass (2026-11-15,
// GYRO_FLEET_FLOOD_PLAN.md) rebuilt the fight round Ry's playtest notes:
//
//   * the round ENDS. The hive is now THE TIDE, with three ORIFICES on its
//     rim. Each one swells, dilates and births a flood, and can only be hurt
//     while it is swollen or open. Seal all three and everything left alive
//     floods toward you; clear that and you win. You lose on your last ship or
//     when the clock runs out.
//   * creatures swim where they FACE and turn slowly, so a fast ship can get
//     round behind them. The flown ship is about 3x their speed.
//   * shooting an inflated creature is a RISK. Armour still bounces bolts, but
//     every bounce adds PRESSURE, and a creature at full pressure RUPTURES: a
//     blast that hurts everything near it (you, your wing, other creatures),
//     chains through other inflated bodies, and burns its siphon. And the
//     bounced bolt is LIVE: a ricochet hurts any ship it finds, the shooter
//     first of all (it reaches about 30 units). So an inflated body is still
//     the stronger state, as in canon: you cannot wound it, and forcing it
//     costs you. Pop them inside the flood from range; flank the vent for a
//     clean kill.
//
// THE BREATH RULE (hub canon, 2026-11-08). Every creature breathes on a cycle,
// phase p in [0, 1):
//   inhale    swelling; the rear VENT is open. Shots into it wound.
//   inflated  big, armoured, slow. Shots bounce and build pressure. Tendrils.
//   exhale    shrinking, still armoured; the vent is open again (air out).
//   deflated  small, fast, darting. Hit anywhere.
// Airkrill pant (a short cycle: armoured half the time, soft the other half).
// A Bellwether pulls every creature within GF.syncR into ITS breath, delayed
// by distance, so each inhale is a visible wave rolling out from it.
//
// Units: 1 unit = the ship's length, more or less. Creature speeds are in
// units per SECOND; the engine's ship and bolt speeds are per FRAME.
"use strict";

// ?dev in the address brings back the engine's parameter panel, HUD box and dev keys.
const GF_DEV = /[?&]dev\b/.test(location.search);

const GF = {
    hiveDist: 30000,    // home (the mothership) to The Tide
    hiveR: 140,
    huntR: 520,         // a creature hunts a ship this close
    syncR: 110,         // Bellwether breath-sync reach
    waveSpeed: 70,      // units/s the sync wave travels
    hull: 100,          // the flown ship
    fleetHp: 40,        // every wing bot
    grabTime: 3,        // seconds held by tendrils before the ship is taken
    grabBreakHits: 3,   // hits on the holder that shake it loose
    ships: 3,           // lead ships per round
    clock: 420,         // seconds: the round's hard stop
    maxAlive: 60,       // creature cap; an orifice over the cap opens empty
    oriR: 13,           // orifice hit radius
    oriHp: 36,
    oriClosed: 22,      // seconds shut between births
    oriSwell: 2.5,      // the tell
    oriOpen: 5,         // dilated, birthing
    brood: { crab: 3, krill: 8 }
};

// turn = radians per second at full size; deflated bodies turn 1.6x faster.
// press = armour bounces to rupture; blast = rupture radius (0 = never ruptures).
const GF_KINDS = {
    crab:  { period: [3.6, 4.6], rBig: 3.4, rSmall: 1.4, hp: 3, slow: 6,  fast: 21, turn: 0.75, col: "#FF7A9C", minPx: 5, press: 5,  blast: 12, mote: 12 },
    krill: { period: [1.2, 1.6], rBig: 1.0, rSmall: 0.6, hp: 1, slow: 11, fast: 24, turn: 2.2,  col: "#B98CFF", minPx: 3, press: 0,  blast: 0,  mote: 3 },
    bell:  { period: [7, 7],     rBig: 7.5, rSmall: 3.6, hp: 9, slow: 3,  fast: 8,  turn: 0.3,  col: "#FF3B3B", minPx: 9, press: 14, blast: 22, mote: 40 }
};
const GF_OPEN_ARC = 0.8;    // radians either side of the rear: the vent
const GF_BLAST_DMG = 28;
const GF_RICOCHET_DMG = 5;   // a bounced bolt that finds a ship
const GF_RICOCHET_LIFE = 20; // frames a ricochet lives: about 30 units of reach

const gfCreatures = [];
const gfWaves = [];
const gfOrifices = [];
const gfBlasts = [];        // { x, y, r, t } rupture rings, drawn in gf-flesh.js
let gfHive = null, gfHome = null;
let gfTime = 0;
let gfHull = GF.hull, gfWasAlive = true, gfHurtFlash = 0;
const gfKills = { crab: 0, krill: 0, bell: 0, burst: 0 };
// phase: fight (orifices alive) | flood (all sealed, clear what is left) | won | lost
const gfRound = { phase: "fight", t: 0, ships: GF.ships, endMsg: "", endT: 0, banner: "", bannerT: 0 };

function gfRand(a, b) { return a + Math.random() * (b - a); }
function gfFrac(x) { return x - Math.floor(x); }
function gfWrap01(d) { return d - Math.round(d); }   // shortest signed phase difference
function gfRoundOver() { return gfRound.phase === "won" || gfRound.phase === "lost"; }
function gfBanner(msg, secs) { gfRound.banner = msg; gfRound.bannerT = secs || 2.5; }

// Everything a creature can hunt: the flown ship and the wing (gf-wing.js).
function gfTargets() {
    const out = [];
    if (glShip.isAlive && gfFlight.jump !== "burst") out.push(glShip);
    for (let i = 0; i < gfWing.length; i++) if (gfWing[i].isAlive && !gfWing[i].warp) out.push(gfWing[i]);
    return out;
}

// ---------------------------------------------------
//   Breath: radius and vulnerability from the phase
// ---------------------------------------------------
function gfEase(t) { return t * t * (3 - 2 * t); }
function gfBreath(c) {
    const k = GF_KINDS[c.kind], p = c.p;
    let b;
    if (c.kind === "krill") {
        const big = p < 0.5;
        const r = k.rSmall + (k.rBig - k.rSmall) * (0.5 + 0.5 * Math.cos(p * Math.PI * 2));
        b = { r: r, stage: big ? "inflated" : "deflated", open: false, armour: big, swell: big ? 1 : 0 };
    } else if (p < 0.18) { const e = gfEase(p / 0.18); b = { r: k.rSmall + (k.rBig - k.rSmall) * e, stage: "inhale", open: true, armour: true, swell: e }; }
    else if (p < 0.6) b = { r: k.rBig, stage: "inflated", open: false, armour: true, swell: 1 };
    else if (p < 0.74) { const e = gfEase((p - 0.6) / 0.14); b = { r: k.rBig + (k.rSmall - k.rBig) * e, stage: "exhale", open: true, armour: true, swell: 1 - e }; }
    else b = { r: k.rSmall, stage: "deflated", open: false, armour: false, swell: 0 };
    // Pressure over-swells it: the warning you can read.
    b.r *= 1 + 0.22 * (c.press || 0);
    return b;
}

// ---------------------------------------------------
//   Spawning: everything comes out of an orifice
// ---------------------------------------------------
function gfMakeCreature(kind, x, y, ori) {
    const k = GF_KINDS[kind];
    const c = {
        kind: kind, x: x, y: y, vx: 0, vy: 0, face: Math.random() * Math.PI * 2,
        p: Math.random(), period: gfRand(k.period[0], k.period[1]), hp: k.hp,
        ori: ori, flash: 0, hitCd: 0, tendril: 0, tendrilCd: 0, tendrilTarget: null,
        grabbing: null, orbitA: Math.random() * Math.PI * 2, press: 0, ruptT: 0, burst: false,
        birthT: 0, seed: Math.random() * 1000, synced: false
    };
    c.ownPeriod = c.period;
    c.b = gfBreath(c);
    gfCreatures.push(c);
    return c;
}

function gfOrificePos(o) {
    return { x: gfHive.x + Math.cos(o.a) * (gfHive.r - 3), y: gfHive.y + Math.sin(o.a) * (gfHive.r - 3) };
}

// One creature squeezes out: starts small and slimed at the mouth, pushed outward.
function gfBirth(o, kind) {
    const p = gfOrificePos(o), a = o.a + gfRand(-0.5, 0.5);
    const c = gfMakeCreature(kind, p.x + Math.cos(a) * 2, p.y + Math.sin(a) * 2, o);
    const push = kind === "bell" ? 14 : gfRand(22, 40);
    c.vx = Math.cos(a) * push; c.vy = Math.sin(a) * push;
    c.face = a;
    c.birthT = 0.9;
    if (kind !== "krill") c.p = 0.8;   // born deflated
    return c;
}

// Called once from boot, after the star systems exist and the ship has spawned.
function gfInitBattle() {
    gfHome = { x: glShip.x, y: glShip.y };
    const e = glSolBody("EARTH"), sun = glSolBody("SUN");
    // Away from the Sun, so the trip out never crosses it.
    let ux = 1, uy = 0;
    if (e && sun) { const d = Math.hypot(e.x - sun.x, e.y - sun.y) || 1; ux = (e.x - sun.x) / d; uy = (e.y - sun.y) / d; }
    // Turned 50 degrees off the Sun line so The Tide is not hidden behind Earth.
    const ca = Math.cos(0.87), sa = Math.sin(0.87);
    const hx = ux * ca - uy * sa, hy = ux * sa + uy * ca;
    gfHive = { x: gfHome.x + hx * GF.hiveDist, y: gfHome.y + hy * GF.hiveDist, r: GF.hiveR, p: 0, dead: false, deadT: 0 };
    // Three orifices on the side that faces home, so you arrive looking at them.
    const toHome = Math.atan2(-hy, -hx);
    for (let i = 0; i < 3; i++) {
        const o = { a: toHome + (i - 1) * 0.95, hp: GF.oriHp, state: "closed", t: 5 + i * 7, births: 0, queue: [], birthCd: 0, flash: 0, sealed: false, id: i };
        gfOrifices.push(o);
        // A first brood is already out, loitering at the mouth.
        const p = gfOrificePos(o);
        for (let j = 0; j < 2; j++) gfMakeCreature("crab", p.x + Math.cos(o.a) * gfRand(20, 60) + gfRand(-15, 15), p.y + Math.sin(o.a) * gfRand(20, 60) + gfRand(-15, 15), o);
        for (let j = 0; j < 5; j++) gfMakeCreature("krill", p.x + Math.cos(o.a) * gfRand(15, 50) + gfRand(-15, 15), p.y + Math.sin(o.a) * gfRand(15, 50) + gfRand(-15, 15), o);
    }
    gfWingInit();   // gf-wing.js: the starting bots, the capacitor
    gfBanner("AIM AT THE TIDE (red arrow) AND HOLD SPACE TO JUMP", 8);
}

// ---------------------------------------------------
//   Damage to ships
// ---------------------------------------------------
function gfKillShip(s, msg) {
    if (!s.isAlive) return;
    s.isAlive = false;
    s.deathTime = Date.now();
    s.selected = false;
    s.deathMsg = msg;
    glSpawnBurst(s.x, s.y, 24, s === glShip ? "#7DF9FF" : "#C9FFE9");
    if (s === glShip) {
        gfRound.ships--;
        if (gfRound.ships <= 0) gfEndRound("lost", "LAST SHIP LOST: " + msg.toUpperCase());
        else gfBanner("SHIP LOST · " + gfRound.ships + " LEFT · relaunching from the mothership", 4);
    }
}

function gfDamage(s, n, msg) {
    if (!s.isAlive || gfRoundOver()) return;
    if (s === glShip) {
        gfHull -= n;
        gfHurtFlash = 0.25;
        if (gfHull <= 0) { gfHull = 0; gfKillShip(s, msg); }
    } else {
        s.gfHp -= n;
        s.flash = 0.2;
        if (s.gfHp <= 0) gfKillShip(s, msg);
    }
}

function gfNearestShip(x, y, range) {
    const ts = gfTargets();
    let best = null, bd = range;
    for (let i = 0; i < ts.length; i++) {
        const d = Math.hypot(ts[i].x - x, ts[i].y - y);
        if (d < bd) { bd = d; best = ts[i]; }
    }
    return best;
}

function gfEndRound(phase, msg) {
    if (gfRoundOver()) return;
    gfRound.phase = phase;
    gfRound.endMsg = msg;
    gfRound.endT = 0;
    gfFireSet(false);
}

// ---------------------------------------------------
//   Per-frame update (called at the end of glSimulate)
// ---------------------------------------------------
function gfUpdate(dt) {
    if (!gfHive) return;
    gfTime += dt;
    gfHurtFlash = Math.max(0, gfHurtFlash - dt);
    gfRound.bannerT = Math.max(0, gfRound.bannerT - dt);
    for (let i = gfBlasts.length - 1; i >= 0; i--) { gfBlasts[i].t += dt; if (gfBlasts[i].t > 0.6) gfBlasts.splice(i, 1); }
    if (gfRoundOver()) { gfRound.endT += dt; return; }
    gfRound.t += dt;
    if (gfRound.t >= GF.clock) { gfEndRound("lost", "OUT OF TIME: THE TIDE BREATHES ON"); return; }

    gfArmsUpdate(dt);   // gf-arms.js: seekers, recharge, impact rings

    // A fresh ship after a respawn gets a fresh hull.
    if (glShip.isAlive && !gfWasAlive) { gfHull = GF.hull; glShip.gfGrab = null; glShip.deathMsg = ""; }
    gfWasAlive = glShip.isAlive;

    // The Tide: breathes, births, and is solid.
    gfHive.p = gfFrac(gfHive.p + dt / 10);
    gfHive.r = GF.hiveR * (1 + (gfHive.dead ? 0 : 0.035 * Math.sin(gfHive.p * Math.PI * 2)));
    if (gfHive.dead) gfHive.deadT += dt;
    for (let i = 0; i < gfOrifices.length; i++) gfUpdateOrifice(gfOrifices[i], dt);
    const s = glShip;
    if (s.isAlive) {
        const dx = s.x - gfHive.x, dy = s.y - gfHive.y, d = Math.hypot(dx, dy);
        if (d < gfHive.r + 1) {
            const ux = dx / (d || 1), uy = dy / (d || 1);
            s.x = gfHive.x + ux * (gfHive.r + 1.5); s.y = gfHive.y + uy * (gfHive.r + 1.5);
            s.vx = ux * Math.abs(s.speed) * 1.5; s.vy = uy * Math.abs(s.speed) * 1.5;
            gfDamage(s, 12, "flew into The Tide");
        }
    }

    // Bellwethers this frame (for the sync).
    const bells = [];
    for (let i = 0; i < gfCreatures.length; i++) if (gfCreatures[i].kind === "bell" && gfCreatures[i].hp > 0) bells.push(gfCreatures[i]);
    const targets = gfTargets();
    for (let i = 0; i < gfCreatures.length; i++) gfUpdateCreature(gfCreatures[i], dt, bells, targets);
    gfUpdateGrabs(dt);
    gfUpdateBulletHits();
    gfWingUpdate(dt);   // gf-wing.js: bots, motes, the capacitor

    // Remove the dead.
    for (let i = gfCreatures.length - 1; i >= 0; i--) {
        const c = gfCreatures[i];
        if (c.hp > 0) continue;
        if (c.burst) gfKills.burst++; else gfKills[c.kind]++;
        glSpawnBurst(c.x, c.y, c.kind === "bell" ? 60 : (c.kind === "crab" ? 26 : 8), GF_KINDS[c.kind].col);
        if (c.grabbing) { c.grabbing.gfGrab = null; c.grabbing = null; }
        if (!c.burst) gfDropMotes(c.x, c.y, GF_KINDS[c.kind].mote);   // a clean kill gives up its siphon
        if (c.kind === "bell") {
            // Sync breaks: everyone it held drops back to their own breathing.
            gfCreatures.forEach(function (m) { if (m.synced) { m.period = m.ownPeriod; m.p = gfFrac(m.p + Math.random() * 0.5); } });
        }
        gfCreatures.splice(i, 1);
    }
    for (let i = gfWaves.length - 1; i >= 0; i--) if ((gfTime - gfWaves[i].t0) * GF.waveSpeed > GF.syncR * 1.25) gfWaves.splice(i, 1);

    if (gfRound.phase === "flood" && gfCreatures.length === 0) gfEndRound("won", "THE TIDE IS SEALED");
}

function gfOrificesLeft() { let n = 0; for (let i = 0; i < gfOrifices.length; i++) if (!gfOrifices[i].sealed) n++; return n; }

function gfUpdateOrifice(o, dt) {
    o.flash = Math.max(0, o.flash - dt);
    if (o.sealed) return;
    o.t -= dt;
    if (o.state === "closed" && o.t <= 0) { o.state = "swell"; o.t = GF.oriSwell; }
    else if (o.state === "swell" && o.t <= 0) {
        o.state = "open"; o.t = GF.oriOpen;
        o.births++;
        o.queue = [];
        if (gfCreatures.length < GF.maxAlive) {
            if (o.births % 2 === 1) o.queue.push("bell");
            for (let i = 0; i < GF.brood.crab; i++) o.queue.push("crab");
            for (let i = 0; i < GF.brood.krill; i++) o.queue.push("krill");
        }
        o.birthCd = 0.3;
    } else if (o.state === "open") {
        o.birthCd -= dt;
        if (o.queue.length && o.birthCd <= 0) { gfBirth(o, o.queue.shift()); o.birthCd = 0.28; }
        if (o.t <= 0) { o.state = "closed"; o.t = GF.oriClosed; o.queue = []; }
    }
}

function gfHurtOrifice(o, n) {
    if (o.sealed) return;
    o.hp -= n;
    o.flash = 0.12;
    if (o.hp > 0) return;
    o.sealed = true; o.state = "sealed"; o.queue = [];
    const p = gfOrificePos(o);
    glSpawnBurst(p.x, p.y, 70, "#FF3B5E");
    gfBlasts.push({ x: p.x, y: p.y, r: 26, t: 0 });
    gfDropMotes(p.x + Math.cos(o.a) * 8, p.y + Math.sin(o.a) * 8, 50);
    const left = gfOrificesLeft();
    if (left > 0) gfBanner("ORIFICE SEALED · " + left + " LEFT", 3);
    else {
        // The Tide is finished. Everything it birthed comes for you.
        gfHive.dead = true;
        gfRound.phase = "flood";
        gfBanner("THE TIDE IS SEALED · SURVIVE THE FLOOD", 4);
    }
}

function gfTurnToward(c, tx, ty, dt, mul) {
    const want = Math.atan2(ty - c.y, tx - c.x);
    const d = glWrapAngle(want - c.face), max = GF_KINDS[c.kind].turn * (mul || 1) * dt;
    c.face += Math.max(-max, Math.min(max, d));
    return Math.abs(d);
}

// Swim: turn (slowly) to face the point, and push along the FACING. A body
// pointed the wrong way slows right down while it comes about, which is the
// gap a fast ship flies into.
function gfSwim(c, tx, ty, speed, dt, grip) {
    const soft = !c.b.armour;
    const err = gfTurnToward(c, tx, ty, dt, soft ? 1.6 : 1);
    const d = Math.hypot(tx - c.x, ty - c.y);
    const sp = Math.min(speed, d * 1.5) * Math.max(0.2, Math.cos(Math.min(err, 1.4)));
    const k = Math.min(1, dt * (grip || 2));
    c.vx += (Math.cos(c.face) * sp - c.vx) * k;
    c.vy += (Math.sin(c.face) * sp - c.vy) * k;
}

function gfUpdateCreature(c, dt, bells, targets) {
    const k = GF_KINDS[c.kind];
    c.flash = Math.max(0, c.flash - dt);
    c.hitCd = Math.max(0, c.hitCd - dt);
    c.tendrilCd = Math.max(0, c.tendrilCd - dt);
    c.birthT = Math.max(0, c.birthT - dt);

    // ---- A rupture already lit (chain delay) ----
    if (c.ruptT > 0) { c.ruptT -= dt; if (c.ruptT <= 0) { gfRupture(c); return; } }

    // ---- Breath, and the nearest Bellwether's sync ----
    const prevP = c.p;
    let bell = null, bd = GF.syncR;
    if (c.kind !== "bell") for (let i = 0; i < bells.length; i++) {
        const d = Math.hypot(c.x - bells[i].x, c.y - bells[i].y);
        if (d < bd) { bd = d; bell = bells[i]; }
    }
    if (bell) {
        const lagged = bell.p - (bd / GF.waveSpeed) / bell.period;
        const target = c.kind === "krill" ? gfFrac(lagged * 5) : gfFrac(lagged);
        c.period = c.kind === "krill" ? bell.period / 5 : bell.period;
        c.p = gfFrac(c.p + dt / c.period);
        c.p = gfFrac(c.p + gfWrap01(target - c.p) * Math.min(1, dt * 4));
        c.synced = true;
    } else {
        if (c.synced) c.period = c.ownPeriod;
        c.synced = false;
        c.p = gfFrac(c.p + dt / c.period);
    }
    if (c.kind === "bell" && c.p < prevP) gfWaves.push({ x: c.x, y: c.y, t0: gfTime, bell: c });
    c.b = gfBreath(c);
    // Pressure bleeds off slowly while armoured and is gone once it deflates.
    if (c.b.armour) c.press = Math.max(0, c.press - dt * 0.12); else c.press = 0;
    const fastNow = c.b.stage === "deflated";
    const flood = gfRound.phase === "flood";
    const speed = (fastNow ? k.fast : k.slow) * (flood ? 1.25 : 1);

    // ---- Where to go ----
    let prey = null, pd = flood ? Infinity : GF.huntR;
    for (let i = 0; i < targets.length; i++) {
        const d = Math.hypot(targets[i].x - c.x, targets[i].y - c.y);
        if (d < pd) { pd = d; prey = targets[i]; }
    }
    if (c.birthT > 0) {
        // Still sliding out of the orifice: no steering yet.
        c.vx *= 1 - Math.min(1, dt * 1.5); c.vy *= 1 - Math.min(1, dt * 1.5);
    } else if (prey) {
        if (c.kind === "bell") {
            // Leads from behind its brood: closes to about 30 units and holds.
            if (pd > 30) gfSwim(c, prey.x, prey.y, speed, dt, 1);
            else { gfTurnToward(c, prey.x, prey.y, dt); c.vx *= 1 - Math.min(1, dt); c.vy *= 1 - Math.min(1, dt); }
        } else if (c.kind === "crab") {
            // Big: drift in and reach with tendrils. Small: dart straight in.
            if (fastNow || pd > c.b.r + 6) gfSwim(c, prey.x, prey.y, speed, dt, fastNow ? 4 : 1.5);
            else { gfTurnToward(c, prey.x, prey.y, dt); c.vx *= 1 - Math.min(1, dt * 2); c.vy *= 1 - Math.min(1, dt * 2); }
        } else {
            // Krill: circle the prey while armoured, dive while soft.
            if (fastNow) gfSwim(c, prey.x, prey.y, speed, dt, 5);
            else {
                c.orbitA += dt * 1.1;
                gfSwim(c, prey.x + Math.cos(c.orbitA) * 13, prey.y + Math.sin(c.orbitA) * 13, speed, dt, 3);
            }
        }
    } else {
        // Loiter off the mouth it came from.
        const o = c.ori, base = o ? gfOrificePos(o) : gfHive, oa = o ? o.a : c.orbitA;
        c.orbitA += dt * (c.kind === "krill" ? 0.5 : 0.15);
        const rr = c.kind === "bell" ? 0 : (c.kind === "krill" ? 24 : 34);
        const tx = base.x + Math.cos(oa) * 55 + Math.cos(c.orbitA) * rr, ty = base.y + Math.sin(oa) * 55 + Math.sin(c.orbitA) * rr;
        gfSwim(c, tx, ty, Math.max(speed * 0.6, 5), dt, 1.5);
    }

    // Light separation, so a flood doesn't collapse into one blob.
    for (let i = 0; i < gfCreatures.length; i++) {
        const o = gfCreatures[i];
        if (o === c) continue;
        const dx = c.x - o.x, dy = c.y - o.y;
        const min = c.b.r + o.b.r + 0.6;
        if (Math.abs(dx) > min || Math.abs(dy) > min) continue;
        const d = Math.hypot(dx, dy);
        if (d < min && d > 1e-6) { c.vx += dx / d * (min - d) * 2; c.vy += dy / d * (min - d) * 2; }
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;
    // The Tide is solid to its own brood too (once they are clear of the mouth).
    if (c.birthT <= 0) {
        const dx = c.x - gfHive.x, dy = c.y - gfHive.y, d = Math.hypot(dx, dy), min = gfHive.r + c.b.r;
        if (d < min) { c.x = gfHive.x + dx / (d || 1) * min; c.y = gfHive.y + dy / (d || 1) * min; }
    }

    // ---- Tendrils (aircrabs and Bellwethers, while big) ----
    if (c.kind !== "krill" && !c.grabbing && prey && c.b.armour && c.tendrilCd <= 0 && c.birthT <= 0) {
        const reach = c.b.r + 8;
        if (pd < reach + 3) {
            c.tendril += dt;
            c.tendrilTarget = prey;
            if (c.tendril > 0.7) {   // the tell, then the lash
                c.tendril = 0;
                c.tendrilCd = 2.5;
                if (pd < reach + 4 && prey.isAlive && !prey.gfGrab) {
                    prey.gfGrab = { by: c, t: 0, hits: 0 };
                    c.grabbing = prey;
                }
            }
        } else c.tendril = Math.max(0, c.tendril - dt * 2);
    } else if (!c.grabbing) c.tendril = Math.max(0, c.tendril - dt * 2);

    // ---- Contact damage while small and fast ----
    if (!c.b.armour && c.hitCd <= 0 && c.birthT <= 0) {
        for (let i = 0; i < targets.length; i++) {
            const s = targets[i];
            if (!s.isAlive) continue;
            const dx = s.x - c.x, dy = s.y - c.y, d = Math.hypot(dx, dy);
            if (d < c.b.r + 0.8) {
                gfDamage(s, c.kind === "krill" ? 4 : (c.kind === "bell" ? 20 : 12), c.kind === "krill" ? "swarmed by airkrill" : "rammed by an aircrab");
                c.vx = -dx / (d || 1) * k.fast; c.vy = -dy / (d || 1) * k.fast;
                c.hitCd = 1;
                break;
            }
        }
    }
}

// A creature at full pressure bursts. Everything in the blast pays: ships are
// hurt, soft bodies and krill die, and other armoured bodies take most of a
// rupture's worth of pressure, a beat later, so a packed flood goes off as a
// ripple. Nothing a blast kills leaves siphon.
function gfRupture(c) {
    if (c.hp <= 0) return;
    const k = GF_KINDS[c.kind], R = k.blast;
    c.hp = 0; c.burst = true;
    gfBlasts.push({ x: c.x, y: c.y, r: R, t: 0 });
    glSpawnBurst(c.x, c.y, c.kind === "bell" ? 90 : 40, "#FFB36B");
    if (typeof glAudioShot === "function") glAudioShot();
    const ts = gfTargets();
    for (let i = 0; i < ts.length; i++) {
        const d = Math.hypot(ts[i].x - c.x, ts[i].y - c.y);
        if (d < R) gfDamage(ts[i], GF_BLAST_DMG * (d < R * 0.5 ? 1 : 2 * (1 - d / R)), "caught in a rupture");
    }
    for (let i = 0; i < gfCreatures.length; i++) {
        const o = gfCreatures[i];
        if (o === c || o.hp <= 0) continue;
        const d = Math.hypot(o.x - c.x, o.y - c.y);
        if (d > R + o.b.r) continue;
        if (o.kind === "krill" || !o.b.armour) { o.hp = 0; o.burst = true; }
        else {
            o.press += 0.8;
            o.flash = 0.15;
            if (o.press >= 1 && o.ruptT <= 0) o.ruptT = 0.12 + d * 0.012;
        }
    }
    for (let i = 0; i < gfOrifices.length; i++) {
        const o = gfOrifices[i];
        if (o.sealed || o.state === "closed") continue;
        const p = gfOrificePos(o);
        if (Math.hypot(p.x - c.x, p.y - c.y) < R + GF.oriR) gfHurtOrifice(o, 6);
    }
}

// Add pressure to an armoured body (a bounced bolt = 1 unit of n).
function gfPressure(c, n) {
    const k = GF_KINDS[c.kind];
    if (!k.press || c.ruptT > 0) return;
    c.press += n / k.press;
    c.flash = 0.06;
    if (c.press >= 1) c.ruptT = 0.1;
}

function gfUpdateGrabs(dt) {
    const ts = gfTargets();
    for (let i = 0; i < ts.length; i++) {
        const s = ts[i], g = s.gfGrab;
        if (!g) continue;
        const c = g.by;
        if (!s.isAlive || c.hp <= 0 || gfCreatures.indexOf(c) === -1) { s.gfGrab = null; if (c) c.grabbing = null; continue; }
        g.t += dt;
        // Reeled in: the ship is dragged toward the creature's front.
        const fx = c.x + Math.cos(c.face) * (c.b.r + 3), fy = c.y + Math.sin(c.face) * (c.b.r + 3);
        s.x += (fx - s.x) * Math.min(1, dt * 3);
        s.y += (fy - s.y) * Math.min(1, dt * 3);
        s.vx *= 0.85; s.vy *= 0.85;
        if (s === glShip) gfDamage(s, 6 * dt, "taken by an aircrab");
        if (g.t >= GF.grabTime) {
            gfKillShip(s, "taken by an aircrab");
            s.gfGrab = null; c.grabbing = null;
        }
    }
    // A dead ship lets go.
    for (let i = 0; i < gfCreatures.length; i++) {
        const c = gfCreatures[i];
        if (c.grabbing && !c.grabbing.isAlive) { c.grabbing.gfGrab = null; c.grabbing = null; }
    }
}

// Closest point of the bolt's path THIS FRAME to (cx, cy). Bolts move several
// units a frame now, so a point test would step straight over an airkrill.
function gfSweep(b, cx, cy) {
    const ax = b.x - b.vx, ay = b.y - b.vy;
    const L2 = b.vx * b.vx + b.vy * b.vy;
    let t = L2 > 0 ? ((cx - ax) * b.vx + (cy - ay) * b.vy) / L2 : 1;
    t = Math.max(0, Math.min(1, t));
    const x = ax + b.vx * t, y = ay + b.vy * t;
    return { x: x, y: y, d: Math.hypot(x - cx, y - cy) };
}

// Bolts against The Tide and its creatures.
function gfUpdateBulletHits() {
    for (let i = glBullets.length - 1; i >= 0; i--) {
        const b = glBullets[i];
        if (b.gfSkip) { b.gfSkip = false; continue; }   // the frame it bounced
        // A ricochet is live: it hurts whatever ship it finds, the shooter included.
        if (b.gfBounced) {
            const ts = gfTargets();
            let hitShip = false;
            for (let j = 0; j < ts.length; j++) {
                if (gfSweep(b, ts[j].x, ts[j].y).d < 1.3) {
                    gfDamage(ts[j], GF_RICOCHET_DMG, "cut down by a ricochet");
                    gfBoltImpact(ts[j].x, ts[j].y, false);
                    glBullets.splice(i, 1);
                    hitShip = true;
                    break;
                }
            }
            if (hitShip) continue;
        }
        // Orifices first: a swollen or open one takes the hit.
        let done = false;
        for (let j = 0; j < gfOrifices.length && !done; j++) {
            const o = gfOrifices[j];
            if (o.sealed || o.state === "closed") continue;
            const p = gfOrificePos(o), h = gfSweep(b, p.x, p.y);
            if (h.d < GF.oriR) {
                gfHurtOrifice(o, 1);
                glSpawnBurst(h.x, h.y, 5, "#FFE45C");
                gfBoltImpact(h.x, h.y, true);
                glBullets.splice(i, 1);
                done = true;
            }
        }
        if (done) continue;
        const hh = gfSweep(b, gfHive.x, gfHive.y);
        if (hh.d < gfHive.r) { gfBounce(b, gfHive.x, gfHive.y, gfHive.r, hh); continue; }
        for (let j = 0; j < gfCreatures.length; j++) {
            const c = gfCreatures[j];
            if (c.hp <= 0) continue;
            const h = gfSweep(b, c.x, c.y);
            if (h.d > c.b.r + 0.3) continue;
            // Shooting the thing that holds a ship shakes it loose.
            if (c.grabbing) {
                const g = c.grabbing.gfGrab;
                if (g && ++g.hits >= GF.grabBreakHits) { c.grabbing.gfGrab = null; c.grabbing = null; c.tendrilCd = 3; c.flash = 0.2; }
            }
            let wound = !c.b.armour;
            if (!wound && c.b.open) {
                const rel = glWrapAngle(Math.atan2(h.y - c.y, h.x - c.x) - (c.face + Math.PI));
                wound = Math.abs(rel) < GF_OPEN_ARC;
            }
            if (wound) {
                c.hp -= 1;
                c.flash = 0.15;
                glSpawnBurst(h.x, h.y, 6, "#FFE45C");
                gfBoltImpact(h.x, h.y, true);
                glBullets.splice(i, 1);
            } else {
                gfPressure(c, 1);
                gfBounce(b, c.x, c.y, c.b.r, h);
            }
            break;
        }
    }
}

function gfBounce(b, cx, cy, r, h) {
    if (b.gfBounced) { glBullets.splice(glBullets.indexOf(b), 1); return; }
    const hx = h ? h.x : b.x, hy = h ? h.y : b.y;
    const dx = hx - cx, dy = hy - cy, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
    const dot = b.vx * nx + b.vy * ny;
    b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
    b.vx *= 0.45; b.vy *= 0.45;
    b.color = "#FF8A5C";
    b.x = cx + nx * (r + 0.4); b.y = cy + ny * (r + 0.4);
    b.gfBounced = true;
    b.gfSkip = true;
    b.life = Math.min(b.life, GF_RICOCHET_LIFE);
    glSpawnBurst(b.x, b.y, 3, "#cfe9e6");
    gfBoltImpact(b.x, b.y, false);
}

// ---------------------------------------------------
//   Draw: world (stage 1, lensable). Bodies are in gf-flesh.js.
// ---------------------------------------------------
function gfOnScreen(p, pad) { return p.x > -pad && p.y > -pad && p.x < glW + pad && p.y < glH + pad; }

function gfDrawWorld(c) {
    if (!gfHive) return;
    const z = glCamera.zoom;
    gfDrawHome(c, z);
    gfDrawTide(c, z);        // gf-flesh.js

    // Sync waves.
    for (let i = 0; i < gfWaves.length; i++) {
        const w = gfWaves[i], r = (gfTime - w.t0) * GF.waveSpeed;
        const bx = w.bell && w.bell.hp > 0 ? w.bell.x : w.x, by = w.bell && w.bell.hp > 0 ? w.bell.y : w.y;
        const p = glWorldToScreen(bx, by);
        if (p.h) continue;
        const pr = r * z;
        if (pr < 2 || !gfOnScreen(p, pr + 10)) continue;
        c.globalAlpha = Math.max(0, 0.5 * (1 - r / (GF.syncR * 1.25)));
        c.strokeStyle = "#FFE45C";
        c.lineWidth = 2;
        c.beginPath(); c.arc(p.x, p.y, pr, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 1;
    }

    gfDrawViewWorld(c, z);   // gf-view.js: speed dust, creature trails
    gfDrawMotes(c, z);       // gf-wing.js: siphon motes
    // Small ones first, so the big bodies sit on top of the swarm.
    for (let i = 0; i < gfCreatures.length; i++) if (gfCreatures[i].kind === "krill") gfDrawCreature(c, gfCreatures[i], z);
    for (let i = 0; i < gfCreatures.length; i++) if (gfCreatures[i].kind !== "krill") gfDrawCreature(c, gfCreatures[i], z);
    gfDrawBlasts(c, z);      // gf-flesh.js: rupture rings
    gfDrawWing(c, z);        // gf-wing.js: the bots
    gfDrawArmsWorld(c, z);   // gf-arms.js: bolts, seekers, impact rings
}

function gfDrawHome(c, z) {
    // The human mothership (pass 3): a solid spine hull inside a lattice ring,
    // hex launch bay glowing at its heart. NOT to scale (the real one is 5 km);
    // drawn at least ~70 px so it reads as the place you launch from.
    const p = glWorldToScreen(gfHome.x, gfHome.y);
    if (p.h) return;
    const R = Math.max(36, 22 * z);
    if (!gfOnScreen(p, R * 1.6)) return;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(-0.35);
    // Lattice ring: two rims and a slowly turning truss.
    c.strokeStyle = "rgba(125,249,255,0.45)"; c.lineWidth = 1;
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(0, 0, R * 0.86, 0, Math.PI * 2); c.stroke();
    c.beginPath();
    for (let i = 0; i < 36; i++) {
        const a = i * Math.PI / 18 + gfTime * 0.05, b = a + Math.PI / 36;
        c.moveTo(Math.cos(a) * R, Math.sin(a) * R); c.lineTo(Math.cos(b) * R * 0.86, Math.sin(b) * R * 0.86);
    }
    c.stroke();
    // Spine hull: long solid body crossing the ring.
    c.fillStyle = "#13262C"; c.strokeStyle = "#7DF9FF"; c.lineWidth = 1.4;
    c.beginPath();
    c.moveTo(R * 1.45, 0); c.lineTo(R * 1.1, R * 0.16); c.lineTo(-R * 1.1, R * 0.2); c.lineTo(-R * 1.35, R * 0.1);
    c.lineTo(-R * 1.35, -R * 0.1); c.lineTo(-R * 1.1, -R * 0.2); c.lineTo(R * 1.1, -R * 0.16); c.closePath();
    c.fill(); c.stroke();
    // Spokes from hull to ring.
    c.strokeStyle = "rgba(125,249,255,0.35)";
    c.beginPath();
    [0.5, -0.5, 2.6, -2.6].forEach(function (a) { c.moveTo(Math.cos(a) * R * 0.25, Math.sin(a) * R * 0.18); c.lineTo(Math.cos(a) * R * 0.86, Math.sin(a) * R * 0.86); });
    c.stroke();
    // Hex launch bay.
    const hb = R * 0.22, pulse = 0.6 + 0.4 * Math.sin(gfTime * 3);
    c.fillStyle = "rgba(125,249,255," + (0.25 * pulse).toFixed(3) + ")"; c.strokeStyle = "#C9FFE9";
    c.beginPath();
    for (let i = 0; i < 6; i++) { const a = i * Math.PI / 3; if (i) c.lineTo(Math.cos(a) * hb, Math.sin(a) * hb); else c.moveTo(hb, 0); }
    c.closePath(); c.fill(); c.stroke();
    // Running lights along the spine.
    for (let i = -4; i <= 4; i++) {
        c.fillStyle = (Math.floor(gfTime * 4) + i) % 5 === 0 ? "#FFFFFF" : "rgba(255,176,0,0.6)";
        c.fillRect(i * R * 0.25 - 1, -R * 0.19, 2, 2);
    }
    c.restore();
    c.fillStyle = "rgba(125,249,255,0.7)"; c.font = "11px monospace"; c.textAlign = "center";
    c.fillText("MOTHERSHIP", p.x, p.y + R * 1.25 + 12);
}

// ---------------------------------------------------
//   Draw: overlay (screen space, never lensed)
// ---------------------------------------------------
function gfDrawOverlay(c) {
    gfFlightOverlay(c);   // gf-flight.js: spool aim line, velocity tick, drive cues
    gfDrawEdgeMarkers(c); // gf-view.js: off-screen creatures
    if (!gfHive) return;
    c.save();
    c.font = "11px monospace";
    c.textAlign = "center";
    for (let i = 0; i < gfCreatures.length; i++) {
        const b = gfCreatures[i];
        if (b.kind !== "bell") continue;
        const p = glWorldToScreenRaw(b.x, b.y);
        if (!gfOnScreen(p, 0)) continue;
        c.fillStyle = "#FF3B3B";
        c.fillText("BELLWETHER", p.x, p.y - Math.max(14, b.b.r * glCamera.zoom * 1.5) - 4);
    }
    // Orifice state, said in words above each mouth.
    for (let i = 0; i < gfOrifices.length; i++) {
        const o = gfOrifices[i];
        if (o.sealed) continue;
        const w = gfOrificePos(o), p = glWorldToScreenRaw(w.x + Math.cos(o.a) * 20, w.y + Math.sin(o.a) * 20);
        if (!gfOnScreen(p, 0)) continue;
        const hot = o.state !== "closed";
        c.fillStyle = hot ? "#FFE45C" : "rgba(255,122,156,0.7)";
        c.fillText(o.state === "swell" ? "SWELLING: SHOOT IT" : o.state === "open" ? "OPEN: SHOOT IT" : "shut · opens in " + Math.ceil(o.t) + "s", p.x, p.y);
        if (hot || o.hp < GF.oriHp) {
            c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(p.x - 26, p.y + 5, 52, 5);
            c.fillStyle = "#FF3B5E"; c.fillRect(p.x - 25, p.y + 6, 50 * Math.max(0, o.hp / GF.oriHp), 3);
        }
    }
    // Held by tendrils: the one thing that has to be on screen.
    const g = glShip.gfGrab;
    if (g && glShip.isAlive) {
        c.font = "bold 16px monospace";
        c.fillStyle = "#FF2E88";
        c.fillText("GRABBED - SHOOT IT LOOSE  " + Math.max(0, GF.grabTime - g.t).toFixed(1) + "s  (" + g.hits + "/" + GF.grabBreakHits + ")", glCX, glCY - 60);
    }
    if (gfHurtFlash > 0) {
        c.fillStyle = "rgba(255,46,136," + (gfHurtFlash * 0.6).toFixed(3) + ")";
        c.fillRect(0, 0, glW, 6); c.fillRect(0, glH - 6, glW, 6);
    }
    c.restore();
    gfDrawHud(c);         // gf-wing.js: hull, ships, capacitor, wing, orifices, clock, end card
}

// Nav arrows (glDrawNav, gl-draw.js): The Tide, its live orifices, and home.
function gfNavTargets(s) {
    const out = [];
    if (!gfHive) return out;
    const far = Math.hypot(gfHive.x - s.x, gfHive.y - s.y) > gfHive.r + 600;
    if (far) out.push({ x: gfHive.x, y: gfHive.y, r: gfHive.r, name: "THE TIDE", col: "#C2335A" });
    else for (let i = 0; i < gfOrifices.length; i++) {
        const o = gfOrifices[i];
        if (o.sealed) continue;
        const p = gfOrificePos(o);
        out.push({ x: p.x, y: p.y, r: 0, name: o.state === "closed" ? "ORIFICE" : "ORIFICE OPEN", col: o.state === "closed" ? "#C2335A" : "#FFE45C" });
    }
    if (far || Math.hypot(gfHome.x - s.x, gfHome.y - s.y) < 3000) out.push({ x: gfHome.x, y: gfHome.y, r: 0, name: "HOME", col: "#7DF9FF" });
    return out;
}

// The dev HUD line (the HTML box, shown only with ?dev).
function gfHudLine() {
    if (!gfHive) return "";
    return "HULL " + Math.ceil(gfHull) + " · " + gfCreatures.length + " creatures · phase " + gfRound.phase +
        " · kills " + gfKills.crab + "/" + gfKills.krill + "/" + gfKills.bell + " burst " + gfKills.burst + "<br>";
}
