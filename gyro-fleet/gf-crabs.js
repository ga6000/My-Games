// ===================================================
//   Gyro Fleet — aircrabs, airkrill, the Bellwether, the hive
// ===================================================
// Pass 1 (2026-11-08, GYRO_FLEET_PASS_1_PLAN.md). New code is prefixed gf/GF;
// the engine underneath is Gyro Lab's and keeps its gl/GL names.
//
// THE BREATH RULE (hub canon, 2026-11-08). Every creature breathes on a cycle,
// phase p in [0, 1):
//   inhale    swelling; the OPENING at its rear is open. The only weak spot
//             while it is big. Shots that hit anywhere else bounce off.
//   inflated  big, armoured, slow. Shots bounce. Tendrils come out up close.
//   exhale    shrinking, still armoured.
//   deflated  small, fast, darting. Hit anywhere.
// Airkrill pant (a short cycle: armoured half the time, soft the other half).
// A Bellwether pulls every creature within GF.syncR into ITS breath, delayed
// by distance, so each inhale is a visible wave rolling out from it and a
// whole pod opens up in sequence. Kill it and the pod falls out of step.
//
// Scale is the engine's (1 unit = 1,000 km, the ship ~1 unit) and NOT final:
// planet and creature sizes get settled in a later pass.
"use strict";

const GF = {
    hiveDist: 30000,    // home (beside Earth) to the hive
    hiveR: 140,
    podMax: 4,          // pods alive at once
    podEvery: 40,       // seconds between pod spawns
    firstPods: 2,
    patrolR: 2600,      // pods wander this far round the hive
    aggroR: 900,        // a pod hunts a ship this close to it
    syncR: 480,         // Bellwether breath-sync reach
    waveSpeed: 160,     // units/s the sync wave travels
    hull: 100,          // the flown ship
    fleetHp: 40,        // every other ship
    grabTime: 3,        // seconds held by tendrils before the ship is taken
    grabBreakHits: 3    // hits on the holder that shake it loose
};

const GF_KINDS = {
    crab:  { period: [4.4, 5.6], rBig: 2.4, rSmall: 0.9, hp: 3, slow: 3, fast: 15, turn: 0.5, col: "#FF7A9C", minPx: 3.5 },
    krill: { period: [1.0, 1.4], rBig: 0.75, rSmall: 0.4, hp: 1, slow: 10, fast: 19, turn: 3, col: "#B98CFF", minPx: 2 },
    bell:  { period: [7.5, 7.5], rBig: 5.5, rSmall: 2.6, hp: 8, slow: 2.2, fast: 6, turn: 0.3, col: "#FF3B3B", minPx: 6 }
};
const GF_OPEN_ARC = 0.75;   // radians either side of the rear: the opening

const gfCreatures = [];
const gfPods = [];
const gfWaves = [];
let gfHive = null, gfHome = null;
let gfTime = 0, gfPodTimer = 0, gfPodSeq = 0;
let gfHull = GF.hull, gfWasAlive = true, gfHurtFlash = 0;
const gfKills = { crab: 0, krill: 0, bell: 0 };

function gfRand(a, b) { return a + Math.random() * (b - a); }
function gfFrac(x) { return x - Math.floor(x); }
function gfWrap01(d) { return d - Math.round(d); }   // shortest signed phase difference

// ---------------------------------------------------
//   Breath: radius and vulnerability from the phase
// ---------------------------------------------------
function gfEase(t) { return t * t * (3 - 2 * t); }
function gfBreath(c) {
    const k = GF_KINDS[c.kind], p = c.p;
    if (c.kind === "krill") {
        const big = p < 0.5;
        const r = k.rSmall + (k.rBig - k.rSmall) * (0.5 + 0.5 * Math.cos(p * Math.PI * 2));
        return { r: r, stage: big ? "inflated" : "deflated", open: false, armour: big };
    }
    if (p < 0.18) return { r: k.rSmall + (k.rBig - k.rSmall) * gfEase(p / 0.18), stage: "inhale", open: true, armour: true };
    if (p < 0.72) return { r: k.rBig, stage: "inflated", open: false, armour: true };
    if (p < 0.82) return { r: k.rBig + (k.rSmall - k.rBig) * gfEase((p - 0.72) / 0.1), stage: "exhale", open: false, armour: true };
    return { r: k.rSmall, stage: "deflated", open: false, armour: false };
}

// ---------------------------------------------------
//   Spawning
// ---------------------------------------------------
function gfMakeCreature(kind, x, y, pod) {
    const k = GF_KINDS[kind];
    const c = {
        kind: kind, x: x, y: y, vx: 0, vy: 0, face: Math.random() * Math.PI * 2,
        p: Math.random(), period: gfRand(k.period[0], k.period[1]), hp: k.hp,
        pod: pod, slot: 0, flash: 0, hitCd: 0, tendril: 0, tendrilCd: 0,
        grabbing: null, orbitA: Math.random() * Math.PI * 2
    };
    c.ownPeriod = c.period;
    c.b = gfBreath(c);
    gfCreatures.push(c);
    return c;
}

function gfSpawnPod() {
    const a = Math.random() * Math.PI * 2;
    const x = gfHive.x + Math.cos(a) * (GF.hiveR + 60), y = gfHive.y + Math.sin(a) * (GF.hiveR + 60);
    const pod = { id: ++gfPodSeq, bell: null, members: [], wander: null, hunting: false };
    pod.bell = gfMakeCreature("bell", x, y, pod);
    pod.bell.p = 0.3;
    for (let i = 0; i < 5; i++) {
        const c = gfMakeCreature("crab", x + gfRand(-20, 20), y + gfRand(-20, 20), pod);
        c.slot = i;
        pod.members.push(c);
    }
    for (let i = 0; i < 10; i++) pod.members.push(gfMakeCreature("krill", x + gfRand(-15, 15), y + gfRand(-15, 15), pod));
    gfPods.push(pod);
    return pod;
}

// Called once from boot, after the star systems exist and the ship has spawned.
function gfInitBattle() {
    gfHome = { x: glShip.x, y: glShip.y };
    const e = glSolBody("EARTH"), sun = glSolBody("SUN");
    // Away from the Sun, so the trip out never crosses it.
    let ux = 1, uy = 0;
    if (e && sun) { const d = Math.hypot(e.x - sun.x, e.y - sun.y) || 1; ux = (e.x - sun.x) / d; uy = (e.y - sun.y) / d; }
    // Turned 50° off the Sun line so the hive is not hidden behind Earth.
    const ca = Math.cos(0.87), sa = Math.sin(0.87);
    const hx = ux * ca - uy * sa, hy = ux * sa + uy * ca;
    gfHive = { x: gfHome.x + hx * GF.hiveDist, y: gfHome.y + hy * GF.hiveDist, r: GF.hiveR, p: 0, hitCd: 0 };
    for (let i = 0; i < GF.firstPods; i++) gfSpawnPod();
    gfPodTimer = GF.podEvery;
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
    glSpawnBurst(s.x, s.y, 24, "#FF7A9C");
}

function gfDamage(s, n, msg) {
    if (!s.isAlive) return;
    if (s === glShip) {
        gfHull -= n;
        gfHurtFlash = 0.25;
        if (gfHull <= 0) { gfHull = 0; gfKillShip(s, msg); }
    } else {
        if (s.gfHp === undefined) s.gfHp = GF.fleetHp;
        s.gfHp -= n;
        if (s.gfHp <= 0) gfKillShip(s, msg);
    }
}

function gfNearestShip(x, y, range) {
    let best = null, bd = range;
    for (let i = 0; i < glShips.length; i++) {
        const s = glShips[i];
        if (!s.isAlive || s.ultraState === "active") continue;
        const d = Math.hypot(s.x - x, s.y - y);
        if (d < bd) { bd = d; best = s; }
    }
    return best;
}

// ---------------------------------------------------
//   Per-frame update (called at the end of glSimulate)
// ---------------------------------------------------
function gfUpdate(dt) {
    if (!gfHive) return;
    gfTime += dt;
    gfHurtFlash = Math.max(0, gfHurtFlash - dt);

    // A fresh ship after a respawn gets a fresh hull.
    if (glShip.isAlive && !gfWasAlive) { gfHull = GF.hull; glShip.gfGrab = null; glShip.deathMsg = ""; }
    gfWasAlive = glShip.isAlive;

    // Hive: breathes, spawns pods, and is solid.
    gfHive.p = gfFrac(gfHive.p + dt / 10);
    gfHive.r = GF.hiveR * (1 + 0.07 * Math.sin(gfHive.p * Math.PI * 2));
    gfHive.hitCd = Math.max(0, gfHive.hitCd - dt);
    gfPodTimer -= dt;
    if (gfPodTimer <= 0) { gfPodTimer = GF.podEvery; if (gfPods.length < GF.podMax) gfSpawnPod(); }
    for (let i = 0; i < glShips.length; i++) {
        const s = glShips[i];
        if (!s.isAlive) continue;
        const dx = s.x - gfHive.x, dy = s.y - gfHive.y, d = Math.hypot(dx, dy);
        if (d < gfHive.r + 1) {
            const ux = dx / (d || 1), uy = dy / (d || 1);
            s.x = gfHive.x + ux * (gfHive.r + 1.5); s.y = gfHive.y + uy * (gfHive.r + 1.5);
            s.vx = ux * Math.abs(s.speed) * 1.5; s.vy = uy * Math.abs(s.speed) * 1.5;
            gfDamage(s, 20, "rammed the hive");
        }
    }

    gfUpdatePods(dt);
    for (let i = 0; i < gfCreatures.length; i++) gfUpdateCreature(gfCreatures[i], dt);
    gfUpdateGrabs(dt);
    gfUpdateBulletHits();

    // Remove the dead.
    for (let i = gfCreatures.length - 1; i >= 0; i--) {
        const c = gfCreatures[i];
        if (c.hp > 0) continue;
        gfKills[c.kind]++;
        glSpawnBurst(c.x, c.y, c.kind === "bell" ? 60 : (c.kind === "crab" ? 26 : 8), GF_KINDS[c.kind].col);
        if (c.grabbing) { c.grabbing.gfGrab = null; c.grabbing = null; }
        const pod = c.pod;
        if (pod) {
            if (pod.bell === c) {
                // Sync breaks: everyone drops back to their own breathing.
                pod.bell = null;
                pod.members.forEach(function (m) { m.period = m.ownPeriod; m.p = gfFrac(m.p + Math.random() * 0.5); });
            }
            const j = pod.members.indexOf(c);
            if (j !== -1) pod.members.splice(j, 1);
        }
        gfCreatures.splice(i, 1);
        if (typeof glAudioShot === "function") { /* no dedicated kill sound yet: pass 2 */ }
    }
    for (let i = gfPods.length - 1; i >= 0; i--) if (!gfPods[i].bell && !gfPods[i].members.length) gfPods.splice(i, 1);
    for (let i = gfWaves.length - 1; i >= 0; i--) if ((gfTime - gfWaves[i].t0) * GF.waveSpeed > GF.syncR * 1.25) gfWaves.splice(i, 1);
}

function gfUpdatePods(dt) {
    for (let i = 0; i < gfPods.length; i++) {
        const pod = gfPods[i];
        const lead = pod.bell || pod.members[0];
        if (!lead) continue;
        const prey = gfNearestShip(lead.x, lead.y, GF.aggroR);
        pod.hunting = !!prey;
        pod.prey = prey;
        if (!pod.wander || Math.hypot(pod.wander.x - lead.x, pod.wander.y - lead.y) < 60) {
            const a = Math.random() * Math.PI * 2, r = GF.hiveR + 300 + Math.random() * (GF.patrolR - 300);
            pod.wander = { x: gfHive.x + Math.cos(a) * r, y: gfHive.y + Math.sin(a) * r };
        }
    }
}

function gfSteer(c, tx, ty, speed, dt, rate) {
    const dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy) || 1;
    const sp = Math.min(speed, d * 2);   // ease in on arrival
    const k = Math.min(1, dt * (rate || 2));
    c.vx += (dx / d * sp - c.vx) * k;
    c.vy += (dy / d * sp - c.vy) * k;
}

function gfTurnToward(c, tx, ty, dt) {
    const want = Math.atan2(ty - c.y, tx - c.x);
    const d = glWrapAngle(want - c.face), max = GF_KINDS[c.kind].turn * dt;
    c.face += Math.max(-max, Math.min(max, d));
}

function gfUpdateCreature(c, dt) {
    const k = GF_KINDS[c.kind], pod = c.pod;
    c.flash = Math.max(0, c.flash - dt);
    c.hitCd = Math.max(0, c.hitCd - dt);
    c.tendrilCd = Math.max(0, c.tendrilCd - dt);

    // ---- Breath, and the Bellwether's sync ----
    const prevP = c.p;
    const bell = pod && pod.bell && pod.bell !== c ? pod.bell : null;
    if (bell) {
        const d = Math.hypot(c.x - bell.x, c.y - bell.y);
        if (d < GF.syncR) {
            const lagged = bell.p - (d / GF.waveSpeed) / bell.period;
            const target = c.kind === "krill" ? gfFrac(lagged * 6) : gfFrac(lagged);
            c.period = c.kind === "krill" ? bell.period / 6 : bell.period;
            c.p = gfFrac(c.p + dt / c.period);
            c.p = gfFrac(c.p + gfWrap01(target - c.p) * Math.min(1, dt * 4));
            c.synced = true;
        } else { c.synced = false; c.period = c.ownPeriod; c.p = gfFrac(c.p + dt / c.period); }
    } else {
        c.synced = false;
        c.p = gfFrac(c.p + dt / c.period);
    }
    if (c.kind === "bell" && c.p < prevP) gfWaves.push({ x: c.x, y: c.y, t0: gfTime, bell: c });
    c.b = gfBreath(c);
    const fastNow = c.b.stage === "deflated";
    const speed = fastNow ? k.fast : k.slow;

    // ---- Where to go ----
    const prey = pod && pod.hunting ? pod.prey : gfNearestShip(c.x, c.y, GF.aggroR * 0.6);
    if (c.kind === "bell") {
        if (prey) { gfSteer(c, prey.x, prey.y, speed, dt, 1); gfTurnToward(c, prey.x, prey.y, dt); }
        else if (pod.wander) { gfSteer(c, pod.wander.x, pod.wander.y, k.slow * 2.5, dt, 0.5); gfTurnToward(c, pod.wander.x, pod.wander.y, dt); }
    } else if (prey) {
        if (c.kind === "crab") {
            // Big: drift in and reach with tendrils. Small: dart straight in.
            const d = Math.hypot(prey.x - c.x, prey.y - c.y);
            if (fastNow || d > 10) gfSteer(c, prey.x, prey.y, speed, dt, fastNow ? 4 : 1.5);
            else gfSteer(c, c.x, c.y, 0, dt, 2);
            gfTurnToward(c, prey.x, prey.y, dt);
        } else {
            // Krill: circle the prey while armoured, dive while soft.
            if (fastNow) gfSteer(c, prey.x, prey.y, speed, dt, 5);
            else {
                c.orbitA += dt * 1.8;
                gfSteer(c, prey.x + Math.cos(c.orbitA) * 14, prey.y + Math.sin(c.orbitA) * 14, speed, dt, 3);
            }
            c.face = Math.atan2(c.vy, c.vx);
        }
    } else {
        // Keep station round the Bellwether, or loiter if it is gone.
        const anchor = (pod && pod.bell) || (pod && pod.members[0]) || c;
        let tx = anchor.x, ty = anchor.y;
        if (c.kind === "crab" && anchor !== c) {
            const a = anchor.face + Math.PI + (c.slot - 2) * 0.6;
            tx += Math.cos(a) * 26; ty += Math.sin(a) * 26;
        } else if (c.kind === "krill") {
            c.orbitA += dt * 1.2;
            tx += Math.cos(c.orbitA) * 16; ty += Math.sin(c.orbitA) * 16;
        } else if (pod && pod.wander) { tx = pod.wander.x; ty = pod.wander.y; }
        gfSteer(c, tx, ty, Math.max(speed, 8), dt, 1.5);
        if (c.kind === "krill") c.face = Math.atan2(c.vy, c.vx); else gfTurnToward(c, tx, ty, dt);
    }

    // Light separation, so a pod doesn't collapse into one blob.
    for (let i = 0; i < gfCreatures.length; i++) {
        const o = gfCreatures[i];
        if (o === c) continue;
        const dx = c.x - o.x, dy = c.y - o.y, d = Math.hypot(dx, dy), min = c.b.r + o.b.r + 1;
        if (d < min && d > 1e-6) { c.vx += dx / d * (min - d) * 2; c.vy += dy / d * (min - d) * 2; }
    }
    c.x += c.vx * dt;
    c.y += c.vy * dt;

    // ---- Tendrils (aircrabs and Bellwethers, while big) ----
    if (c.kind !== "krill" && !c.grabbing && prey && c.b.armour && c.tendrilCd <= 0) {
        const reach = c.b.r + 11;
        const d = Math.hypot(prey.x - c.x, prey.y - c.y);
        if (d < reach + 4) {
            c.tendril += dt;
            c.tendrilTarget = prey;
            if (c.tendril > 0.6) {   // the tell, then the lash
                c.tendril = 0;
                c.tendrilCd = 2.5;
                if (d < reach + 5 && prey.isAlive && !prey.gfGrab) {
                    prey.gfGrab = { by: c, t: 0, hits: 0 };
                    c.grabbing = prey;
                }
            }
        } else c.tendril = Math.max(0, c.tendril - dt * 2);
    } else if (!c.grabbing) c.tendril = Math.max(0, c.tendril - dt * 2);

    // ---- Contact damage while small and fast ----
    if (!c.b.armour && c.hitCd <= 0) {
        for (let i = 0; i < glShips.length; i++) {
            const s = glShips[i];
            if (!s.isAlive) continue;
            const dx = s.x - c.x, dy = s.y - c.y, d = Math.hypot(dx, dy);
            if (d < c.b.r + 0.6) {
                gfDamage(s, c.kind === "krill" ? 4 : (c.kind === "bell" ? 20 : 12), c.kind === "krill" ? "swarmed by airkrill" : "rammed by an aircrab");
                c.vx = -dx / (d || 1) * k.fast; c.vy = -dy / (d || 1) * k.fast;
                c.hitCd = 1;
                break;
            }
        }
    }
}

function gfUpdateGrabs(dt) {
    for (let i = 0; i < glShips.length; i++) {
        const s = glShips[i], g = s.gfGrab;
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
}

// Bullets against creatures. A hit on armour BOUNCES the bullet; a hit on the
// open rear vent during an inhale, or anywhere on a deflated body, wounds.
function gfUpdateBulletHits() {
    for (let i = glBullets.length - 1; i >= 0; i--) {
        const b = glBullets[i];
        // The hive: always armoured in pass 1.
        const hd = Math.hypot(b.x - gfHive.x, b.y - gfHive.y);
        if (hd < gfHive.r) { gfBounce(b, gfHive.x, gfHive.y, gfHive.r); continue; }
        for (let j = 0; j < gfCreatures.length; j++) {
            const c = gfCreatures[j];
            const dx = b.x - c.x, dy = b.y - c.y, d = Math.hypot(dx, dy);
            if (d > c.b.r + 0.25) continue;
            // Shooting the thing that holds you shakes it loose.
            if (c.grabbing) {
                const g = c.grabbing.gfGrab;
                if (g && ++g.hits >= GF.grabBreakHits) { c.grabbing.gfGrab = null; c.grabbing = null; c.tendrilCd = 3; c.flash = 0.2; }
            }
            let wound = !c.b.armour;
            if (!wound && c.b.open) {
                const rel = glWrapAngle(Math.atan2(dy, dx) - (c.face + Math.PI));
                wound = Math.abs(rel) < GF_OPEN_ARC;
            }
            if (wound) {
                c.hp -= 1;
                c.flash = 0.15;
                glSpawnBurst(b.x, b.y, 6, "#FFE45C");
                glBullets.splice(i, 1);
            } else {
                gfBounce(b, c.x, c.y, c.b.r);
            }
            break;
        }
    }
}

function gfBounce(b, cx, cy, r) {
    if (b.gfBounced) { glBullets.splice(glBullets.indexOf(b), 1); return; }
    const dx = b.x - cx, dy = b.y - cy, d = Math.hypot(dx, dy) || 1, nx = dx / d, ny = dy / d;
    const dot = b.vx * nx + b.vy * ny;
    b.vx -= 2 * dot * nx; b.vy -= 2 * dot * ny;
    b.x = cx + nx * (r + 0.3); b.y = cy + ny * (r + 0.3);
    b.gfBounced = true;
    b.color = "#8FA3A8";
    b.life = Math.min(b.life, 40);
    glSpawnBurst(b.x, b.y, 3, "#cfe9e6");
}

// ---------------------------------------------------
//   Draw: world (stage 1, lensable)
// ---------------------------------------------------
function gfOnScreen(p, pad) { return p.x > -pad && p.y > -pad && p.x < glW + pad && p.y < glH + pad; }

function gfDrawWorld(c) {
    if (!gfHive) return;
    const z = glCamera.zoom;
    gfDrawHome(c, z);
    gfDrawHive(c, z);

    // Sync waves.
    for (let i = 0; i < gfWaves.length; i++) {
        const w = gfWaves[i], r = (gfTime - w.t0) * GF.waveSpeed;
        const bx = w.bell && w.bell.hp > 0 ? w.bell.x : w.x, by = w.bell && w.bell.hp > 0 ? w.bell.y : w.y;
        const p = glWorldToScreen(bx, by);
        if (p.h) continue;
        const pr = r * z;
        if (pr < 2 || !gfOnScreen(p, pr + 10)) continue;
        c.globalAlpha = Math.max(0, 0.55 * (1 - r / (GF.syncR * 1.25)));
        c.strokeStyle = "#FFE45C";
        c.lineWidth = 2;
        c.beginPath(); c.arc(p.x, p.y, pr, 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 1;
    }

    for (let i = 0; i < gfCreatures.length; i++) gfDrawCreature(c, gfCreatures[i], z);
}

function gfDrawHome(c, z) {
    // Placeholder for the human mothership: a lattice ring. NOT to scale
    // (the real one is 5 km; here it is drawn big enough to find).
    const p = glWorldToScreen(gfHome.x, gfHome.y);
    if (p.h) return;
    const R = Math.max(8, 9 * z);
    if (!gfOnScreen(p, R + 10)) return;
    c.strokeStyle = "rgba(125,249,255,0.55)";
    c.lineWidth = 1.2;
    c.beginPath(); c.arc(p.x, p.y, R, 0, Math.PI * 2); c.stroke();
    c.beginPath(); c.arc(p.x, p.y, R * 0.6, 0, Math.PI * 2); c.stroke();
    c.beginPath();
    for (let i = 0; i < 6; i++) {
        const a = i * Math.PI / 3 + gfTime * 0.1;
        c.moveTo(p.x + Math.cos(a) * R * 0.6, p.y + Math.sin(a) * R * 0.6);
        c.lineTo(p.x + Math.cos(a) * R, p.y + Math.sin(a) * R);
    }
    c.stroke();
}

function gfBlob(c, x, y, R, face, wob, t) {
    // A lumpy outline: the base of every creature body.
    c.beginPath();
    const n = 18;
    for (let i = 0; i <= n; i++) {
        const a = face + i / n * Math.PI * 2;
        const rr = R * (1 + wob * Math.sin(a * 3 + t) * 0.5 + wob * Math.sin(a * 5 - t * 1.3) * 0.5);
        const px = x + Math.cos(a) * rr, py = y + Math.sin(a) * rr;
        i === 0 ? c.moveTo(px, py) : c.lineTo(px, py);
    }
    c.closePath();
}

function gfDrawHive(c, z) {
    const p = glWorldToScreen(gfHive.x, gfHive.y);
    if (p.h) return;
    const R = Math.max(10, gfHive.r * z);
    if (!gfOnScreen(p, R * 1.3)) return;
    c.fillStyle = "rgba(120,20,40,0.35)";
    c.strokeStyle = "#C2335A";
    c.lineWidth = 2;
    gfBlob(c, p.x, p.y, R, 0, 0.12, gfTime * 0.4);
    c.fill(); c.stroke();
    // Inner lobes, breathing out of step with the shell.
    c.strokeStyle = "rgba(255,122,156,0.5)";
    for (let i = 0; i < 5; i++) {
        const a = i * 1.256 + gfTime * 0.05;
        const rr = R * (0.32 + 0.05 * Math.sin(gfTime * 0.8 + i));
        gfBlob(c, p.x + Math.cos(a) * R * 0.45, p.y + Math.sin(a) * R * 0.45, rr, a, 0.15, gfTime + i);
        c.stroke();
    }
}

function gfDrawCreature(c, cr, z) {
    const k = GF_KINDS[cr.kind];
    const p = glWorldToScreen(cr.x, cr.y);
    if (p.h) return;
    const R = Math.max(k.minPx, cr.b.r * z);
    if (!gfOnScreen(p, R * 3 + 40)) return;
    const col = cr.flash > 0 ? "#FFFFFF" : k.col;
    const soft = !cr.b.armour;

    if (cr.kind === "krill") {
        c.fillStyle = col;
        c.strokeStyle = col;
        c.globalAlpha = soft ? 1 : 0.7;
        gfBlob(c, p.x, p.y, R, cr.face, soft ? 0.25 : 0.05, gfTime * 6);
        soft ? c.fill() : c.stroke();
        c.globalAlpha = 1;
        return;
    }

    // Two lung lobes either side of the facing.
    const px = -Math.sin(cr.face), py = Math.cos(cr.face);
    c.lineWidth = cr.b.armour ? 2.4 : 1.2;
    c.strokeStyle = col;
    c.fillStyle = soft ? "rgba(255,122,156,0.45)" : "rgba(255,122,156,0.16)";
    for (let s = -1; s <= 1; s += 2) {
        gfBlob(c, p.x + px * R * 0.42 * s, p.y + py * R * 0.42 * s, R * 0.68, cr.face, soft ? 0.22 : 0.06, gfTime * 2 + s);
        c.fill(); c.stroke();
    }
    if (cr.kind === "bell") {
        // Crown of spines: the one that leads.
        c.beginPath();
        for (let i = 0; i < 9; i++) {
            const a = cr.face + Math.PI / 2 + (i - 4) * 0.28;
            c.moveTo(p.x + Math.cos(a) * R * 0.9, p.y + Math.sin(a) * R * 0.9);
            c.lineTo(p.x + Math.cos(a) * R * 1.35, p.y + Math.sin(a) * R * 1.35);
        }
        c.stroke();
    }
    // The rear vent: blazing while it inhales, a dark slit otherwise.
    const vx = p.x - Math.cos(cr.face) * R * 0.95, vy = p.y - Math.sin(cr.face) * R * 0.95;
    if (cr.b.open) {
        c.fillStyle = "#FFE45C";
        c.globalAlpha = 0.35;
        c.beginPath(); c.arc(vx, vy, R * 0.6, 0, Math.PI * 2); c.fill();
        c.globalAlpha = 1;
        c.beginPath(); c.arc(vx, vy, Math.max(2, R * 0.28), 0, Math.PI * 2); c.fill();
    } else {
        c.strokeStyle = "rgba(40,0,10,0.9)";
        c.lineWidth = 2;
        c.beginPath();
        c.moveTo(vx + px * R * 0.2, vy + py * R * 0.2);
        c.lineTo(vx - px * R * 0.2, vy - py * R * 0.2);
        c.stroke();
    }
    // Tendrils: the tell, the reach, the hold.
    const tgt = cr.grabbing || (cr.tendril > 0 ? cr.tendrilTarget : null);
    if (tgt) {
        const tp = glWorldToScreen(tgt.x, tgt.y);
        const reach = cr.grabbing ? 1 : cr.tendril / 0.6;
        c.strokeStyle = cr.grabbing ? "#FF2E88" : "rgba(255,122,156,0.8)";
        c.lineWidth = cr.grabbing ? 2 : 1.3;
        for (let i = -1; i <= 1; i++) {
            const fx = p.x + Math.cos(cr.face + i * 0.4) * R * 0.8, fy = p.y + Math.sin(cr.face + i * 0.4) * R * 0.8;
            const ex = fx + (tp.x - fx) * reach, ey = fy + (tp.y - fy) * reach;
            const mx = (fx + ex) / 2 + Math.sin(gfTime * 9 + i) * R * 0.5, my = (fy + ey) / 2 + Math.cos(gfTime * 7 + i) * R * 0.5;
            c.beginPath(); c.moveTo(fx, fy); c.quadraticCurveTo(mx, my, ex, ey); c.stroke();
        }
    }
}

// ---------------------------------------------------
//   Draw: overlay (screen space, never lensed)
// ---------------------------------------------------
function gfDrawOverlay(c) {
    if (!gfHive) return;
    c.save();
    c.font = "11px monospace";
    c.textAlign = "center";
    for (let i = 0; i < gfPods.length; i++) {
        const b = gfPods[i].bell;
        if (!b) continue;
        const p = glWorldToScreenRaw(b.x, b.y);
        if (!gfOnScreen(p, 0)) continue;
        c.fillStyle = "#FF3B3B";
        c.fillText("BELLWETHER", p.x, p.y - Math.max(14, b.b.r * glCamera.zoom * 1.5) - 4);
    }
    const hp = glWorldToScreenRaw(gfHive.x, gfHive.y);
    if (gfOnScreen(hp, 0)) { c.fillStyle = "#C2335A"; c.fillText("THE HIVE", hp.x, hp.y - Math.max(16, gfHive.r * glCamera.zoom) - 6); }
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
}

// Nav arrows (glDrawNav, gl-draw.js): the hive and the nearest pod.
function gfNavTargets(s) {
    const out = [];
    if (!gfHive) return out;
    out.push({ x: gfHive.x, y: gfHive.y, r: gfHive.r, name: "HIVE", col: "#C2335A" });
    let best = null, bd = Infinity;
    for (let i = 0; i < gfPods.length; i++) {
        const lead = gfPods[i].bell || gfPods[i].members[0];
        if (!lead) continue;
        const d = Math.hypot(lead.x - s.x, lead.y - s.y);
        if (d < bd) { bd = d; best = lead; }
    }
    if (best) out.push({ x: best.x, y: best.y, r: 0, name: "POD", col: "#FF3B3B" });
    out.push({ x: gfHome.x, y: gfHome.y, r: 0, name: "HOME", col: "#7DF9FF" });
    return out;
}

function gfHudLine() {
    if (!gfHive) return "";
    const s = glShip;
    const hcol = gfHull > 60 ? "#7DF9FF" : (gfHull > 25 ? "#FFB000" : "#FF2E88");
    let synced = 0, total = 0;
    gfCreatures.forEach(function (c) { if (c.kind !== "bell") { total++; if (c.synced) synced++; } });
    return "<b style='color:" + hcol + "'>HULL " + Math.ceil(gfHull) + "</b> &nbsp; kills: " +
        gfKills.crab + " aircrab · " + gfKills.krill + " airkrill · " + gfKills.bell + " bellwether<br>" +
        gfPods.length + " pods · " + gfCreatures.length + " creatures (" + synced + "/" + total + " breathing in sync) · next pod " +
        (gfPods.length >= GF.podMax ? "-" : Math.ceil(gfPodTimer) + "s") + " · hive " +
        glFmtAstro(Math.max(0, Math.hypot(gfHive.x - s.x, gfHive.y - s.y) - gfHive.r)) + "<br>";
}
