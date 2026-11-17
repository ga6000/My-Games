// ===================================================
//   Gyro Fleet — the six crew: ships, weapons, abilities, and the dev menu
// ===================================================
// Pass 5 (2026-11-16). Ry: "flesh out other character ships and mechanics",
// six at rough quality, K = each crew member's siphon ability (Maren keeps
// the mend), wing bots fire a weaker copy of their leader's weapon, and
// "a dev menu with l+g keys pressed to allow switching characters".
//
//   crew     hull  primary (hold click)                       K (siphon)
//   GREER    gold  twin blaster, the fastest fire             OVERCHARGE  5 s: faster, double damage, no ricochets
//   MAREN    green siphon beam: short, never ricochets,       MEND        dump the charge into your hull and the wing's
//                  drains what it can wound and feeds the capacitor
//   ELODIE   orange drone mines: drift, arm, burst on contact SENTRY      a gun that holds a spot for 14 s
//   SOREN    white needle rail: slow, long, pierces soft      SLIP        3.5 s: much faster, tendrils cannot hold you
//                  bodies, MARKS armour (double damage)
//   BEX      lime  scatter cannon: six pellets, short reach   RAM         a dash that kills soft bodies and lights armoured ones
//   BOOKE    blue  flak: bursts at the cursor, pops swarms    SHIELD      5 s bubble: nothing hurts or holds what is inside
//
// Every ship keeps the shared SEEKER on right click. Class colours avoid the
// creature hues (pink, violet, red) and the system cyan. All numbers are
// first guesses. The hex bay will choose the crew later; for now it is the
// dev menu (hold L and G together), and the choice is remembered.
"use strict";

const GF_CREW = {
    greer:  { name: "GREER",  role: "GUNNER",   col: "#FFC83D", dark: "#3A2A05", hull: 100, speed: 1.0,  weapon: "twin",    abil: "OVERCHG", cost: 40 },
    maren:  { name: "MAREN",  role: "MEDIC",    col: "#7DFF9C", dark: "#0C3318", hull: 90,  speed: 1.0,  weapon: "beam",    abil: "MEND",    cost: 5 },
    elodie: { name: "ELODIE", role: "ENGINEER", col: "#FF8A3D", dark: "#3A1A05", hull: 100, speed: 0.95, weapon: "mines",   abil: "SENTRY",  cost: 40 },
    soren:  { name: "SOREN",  role: "SCOUT",    col: "#EAF2FF", dark: "#1E2836", hull: 75,  speed: 1.18, weapon: "needle",  abil: "SLIP",    cost: 30 },
    bex:    { name: "BEX",    role: "BUTCHER",  col: "#C8FF3D", dark: "#263305", hull: 120, speed: 1.05, weapon: "scatter", abil: "RAM",     cost: 40 },
    booke:  { name: "BOOKE",  role: "BULWARK",  col: "#5B8CFF", dark: "#0A1840", hull: 150, speed: 0.88, weapon: "flak",    abil: "SHIELD",  cost: 35 }
};
const GF_CREW_ORDER = ["greer", "maren", "elodie", "soren", "bex", "booke"];
const GF_CREW_N = {
    overT: 5, slipT: 3.5, slipMul: 1.7, shieldT: 5, shieldR: 10, ramT: 0.7, ramMul: 3.2, ramSafe: 1.0,
    beamR: 30, beamDps: 5, beamFeed: 3, mineMax: 4, mineStock: 4, mineRefill: 2.4, mineR: 10, mineTrig: 5, sentryT: 14, sentryR: 55, flakR: 8, flakMax: 60
};

// Allied crew ships for playtesting (dev menu, Shift+1..6): another crew
// member flying alongside with a wing-strength copy of their weapon, fired
// about twice as often as a bot's, and their own habits.
//   hunt    break off and work round behind a target at `standoff`
//   guard   hold formation, fire only at what can be wounded
//   screen  hold between you and the nearest threat
const GF_ALLY = {
    greer:  { mode: "hunt",   speed: 1.0,  standoff: 14, range: 55 },   // the flanker
    maren:  { mode: "guard",  speed: 1.0,  standoff: 10, range: 26 },   // stays on your wing, mends you
    elodie: { mode: "guard",  speed: 0.9,  standoff: 12, range: 40 },   // mines what closes on you
    soren:  { mode: "hunt",   speed: 1.45, standoff: 42, range: 90 },   // fast, wide, marks from range
    bex:    { mode: "hunt",   speed: 1.15, standoff: 4,  range: 26 },   // goes in close
    booke:  { mode: "screen", speed: 0.9,  standoff: 10, range: 50 }    // puts itself in the way
};
function gfAllySpawn(id) {
    const cw = GF_CREW[id], b = gfMakeBot(glShip.x, glShip.y);
    b.ally = true; b.crew = id; b.maxHp = cw.hull * 0.7; b.gfHp = b.maxHp;
    b.warp = { t: -0.7, a: Math.atan2(glShip.y - gfHome.y, glShip.x - gfHome.x), ticks: 0 };
    gfWing.push(b);
}
function gfAllyClear() { for (let i = gfWing.length - 1; i >= 0; i--) if (gfWing[i].ally) gfWing.splice(i, 1); }
function gfAllyUpdate(dt) {
    // The medic ally mends the lead ship a little while it is close.
    for (let i = 0; i < gfWing.length; i++) {
        const b = gfWing[i];
        if (!b.ally || !b.isAlive || b.warp || b.crew !== "maren" || !glShip.isAlive) continue;
        if (gfHull < GF.hull && gfHull > 0 && Math.hypot(b.x - glShip.x, b.y - glShip.y) < 24) {
            gfHull = Math.min(GF.hull, gfHull + 3 * dt);
            if (Math.random() < dt * 8) gfCrewSt.beams.push({ x0: b.x, y0: b.y, x1: glShip.x, y1: glShip.y, t: 0.12, bite: true, weak: true });
        }
    }
}

let gfCrewId = "greer";
try { const v = localStorage.getItem("gyrofleet-crew"); if (v && GF_CREW[v]) gfCrewId = v; } catch (e) { /* file:// may refuse storage */ }
const gfCrewSt = { over: 0, slip: 0, shield: 0, ram: 0, ramA: 0, safe: 0, impact: 0, god: false,
                   mines: [], sentries: [], shells: [], beams: [], puffs: [], mineStock: 4, mineT: 0 };

function gfCrew() { return GF_CREW[gfCrewId]; }
function gfCrewSet(id) {
    if (!GF_CREW[id]) return;
    const k = gfHull / GF.hull;
    gfCrewId = id;
    GF.hull = GF_CREW[id].hull;
    gfHull = Math.max(1, GF.hull * k);
    gfCrewSt.over = gfCrewSt.slip = gfCrewSt.shield = gfCrewSt.ram = 0;
    gfCrewSt.mines.length = gfCrewSt.sentries.length = gfCrewSt.shells.length = 0;
    gfCrewSt.mineStock = GF_CREW_N.mineStock;
    try { localStorage.setItem("gyrofleet-crew", id); } catch (e) { /* ignore */ }
    gfBanner(GF_CREW[id].name + " · " + GF_CREW[id].role, 2);
}
function gfCrewInit() { GF.hull = gfCrew().hull; gfHull = GF.hull; }

// ---- hooks from gf-crabs.js ----
function gfCrewInShield(s) {
    return gfCrewSt.shield > 0 && glShip.isAlive && Math.hypot(s.x - glShip.x, s.y - glShip.y) < GF_CREW_N.shieldR;
}
// Damage refused? (dev no-damage, the shield, a ram and the moment after it)
function gfCrewBlocks(s) {
    if (gfCrewSt.god) return true;
    if (gfCrewInShield(s)) { if (s === glShip) gfCrewSt.shieldHit = 0.15; return true; }
    return s === glShip && (gfCrewSt.ram > 0 || gfCrewSt.safe > 0);
}
// Tendrils cannot take or keep hold?
function gfCrewSlips(s) {
    if (gfCrewInShield(s)) return true;
    return s === glShip && (gfCrewSt.slip > 0 || gfCrewSt.ram > 0);
}
function gfCrewSpeedMul() { return gfCrew().speed * (gfCrewSt.slip > 0 ? GF_CREW_N.slipMul : 1); }

// ---- a burst: mines, flak. Soft bodies are hurt, krill die, armour takes pressure. ----
function gfCrewBurst(x, y, r, dmg, press, ori, col) {
    for (let i = 0; i < gfCreatures.length; i++) {
        const c = gfCreatures[i];
        if (c.hp <= 0 || c.birthT > 0) continue;
        if (Math.hypot(c.x - x, c.y - y) > r + c.b.r) continue;
        if (c.kind === "krill") c.hp = 0;
        else if (!c.b.armour || c.tumble > 0) { c.hp -= dmg * (c.mark > 0 ? 2 : 1); c.flash = 0.15; }
        else gfPressure(c, press);
    }
    for (let i = 0; i < gfOrifices.length; i++) {
        const o = gfOrifices[i];
        if (o.sealed || o.clamped || o.state === "closed" || !o.site.awake) continue;
        const p = gfOrificePos(o);
        if (Math.hypot(p.x - x, p.y - y) < r + o.site.oriR) gfHurtOrifice(o, ori);
    }
    gfCrewSt.puffs.push({ x: x, y: y, r: r, t: 0, col: col });
    glSpawnBurst(x, y, 10, col);
    gfSfxAt("pop", x, y, 0.5);
}

// ---- primary fire. Returns the cooldown in seconds. `weak` = a wing bot's copy. ----
function gfCrewFire(owner, a, weak, tgt, id) {
    const cw = GF_CREW[id || gfCrewId], W = GF_ARMS.blaster, N = GF_CREW_N;
    const x = owner.x, y = owner.y, ivx = weak ? 0 : owner.vx, ivy = weak ? 0 : owner.vy;
    const bolt = function (ang, sp, life, extra) {
        if (glBullets.length >= GL_MAX_BULLETS) return;
        const b = { x: x, y: y, vx: Math.cos(ang) * sp + ivx, vy: Math.sin(ang) * sp + ivy, life: life, size: 2,
                    color: cw.col, gf: "bolt", owner: owner, bot: weak, ccol: cw.col };
        if (extra) for (const key in extra) b[key] = extra[key];
        glBullets.push(b);
    };
    switch (cw.weapon) {
    case "beam": {
        // A tether to the body nearest the aim line. It cannot bounce, so it
        // is the one weapon that is always safe to hold down; it only bites
        // what a bolt could wound, and what it drains feeds the capacitor.
        const R = weak ? N.beamR * 0.75 : N.beamR, cd = weak ? 0.3 : 0.06;
        let best = null, bs = 0.45, bx = x + Math.cos(a) * R, by = y + Math.sin(a) * R, ori = null;
        for (let i = 0; i < gfCreatures.length; i++) {
            const c = gfCreatures[i], d = Math.hypot(c.x - x, c.y - y);
            if (c.hp <= 0 || c.birthT > 0 || d > R + c.b.r) continue;
            const off = Math.abs(glWrapAngle(Math.atan2(c.y - y, c.x - x) - a)) - Math.atan2(c.b.r, Math.max(1, d));
            if (off < bs) { bs = off; best = c; }
        }
        if (!best) for (let i = 0; i < gfOrifices.length; i++) {
            const o = gfOrifices[i];
            if (o.sealed || o.clamped || o.state === "closed" || !o.site.awake) continue;
            const p = gfOrificePos(o), d = Math.hypot(p.x - x, p.y - y);
            if (d < R + o.site.oriR && Math.abs(glWrapAngle(Math.atan2(p.y - y, p.x - x) - a)) < 0.5) { ori = o; bx = p.x; by = p.y; }
        }
        let bite = false;
        if (best) {
            bx = best.x; by = best.y;
            bite = gfCanWound(best, x, y) || best.tumble > 0;
            if (bite) {
                best.hp -= (weak ? 1.2 : N.beamDps) * cd * (best.mark > 0 ? 2 : 1);
                best.flash = Math.max(best.flash, 0.05);
                if (!weak) { gfCap.charge = Math.min(GF_WING.cap, gfCap.charge + N.beamFeed * cd); gfCap.sinceGain = 0; }
            }
        } else if (ori) { bite = true; ori.gfBeam = (ori.gfBeam || 0) + (weak ? 1 : 4) * cd; if (ori.gfBeam >= 1) { ori.gfBeam -= 1; gfHurtOrifice(ori, 1); } }
        gfCrewSt.beams.push({ x0: x, y0: y, x1: bx, y1: by, t: cd + 0.04, bite: bite, weak: weak });
        return cd;
    }
    case "mines": {
        if (weak && !tgt) return 1;
        // A small stock that refills slowly (Ry, 2026-11-16: she "just melts
        // enemies"). Empty, the trigger does nothing: place them, don't spray them.
        if (!weak) { if (gfCrewSt.mineStock < 1) return 0.15; gfCrewSt.mineStock--; }
        const sp = weak ? 14 : 26;
        gfCrewSt.mines.push({ x: x, y: y, vx: Math.cos(a) * sp + ivx * 30, vy: Math.sin(a) * sp + ivy * 30, t: 0, weak: weak });
        while (gfCrewSt.mines.filter(function (q) { return !q.weak; }).length > N.mineMax) gfCrewMineBlow(gfCrewSt.mines.splice(gfCrewSt.mines.findIndex(function (q) { return !q.weak; }), 1)[0]);
        return weak ? 6 : 0.55;
    }
    case "needle":
        bolt(a, 6.5, 40, { pierce: true, noBounce: true, marks: true, dmg: weak ? 2 : 3, needle: true });
        if (!weak) { glAudioShot(); gfMuzzle.t = 0.08; gfMuzzle.a = a; }
        return weak ? 3.5 : 0.7;
    case "scatter": {
        const n = weak ? 3 : 6;
        for (let i = 0; i < n; i++) bolt(a + (i / (n - 1) - 0.5) * 0.6 + (Math.random() - 0.5) * 0.06, 3.2 * (0.9 + Math.random() * 0.2), 12, null);
        if (!weak) { glAudioShot(); gfMuzzle.t = 0.08; gfMuzzle.a = a; }
        return weak ? 2.2 : 0.45;
    }
    case "flak": {
        let dist = N.flakMax;
        if (weak && tgt) dist = Math.hypot(tgt.x - x, tgt.y - y);
        else if (!weak) { const w = gfCursorWorld(); dist = Math.min(N.flakMax, Math.max(8, Math.hypot(w.x - x, w.y - y))); }
        gfCrewSt.shells.push({ x: x, y: y, vx: Math.cos(a) * 130, vy: Math.sin(a) * 130, left: dist, weak: weak });
        if (!weak) { glAudioShot(); gfMuzzle.t = 0.08; gfMuzzle.a = a; }
        return weak ? 2.5 : 0.5;
    }
    default: {   // twin blaster
        const hot = !weak && gfCrewSt.over > 0;
        if (weak) { bolt(a, W.speed, W.life, null); return 1 / GF_WING.fireRate; }
        gfFireBlaster(owner);   // gf-arms.js: the twin barrels, muzzle flash, sound
        const b = glBullets[glBullets.length - 1];
        if (b && b.owner === owner) { b.ccol = cw.col; if (hot) { b.dmg = 2; b.noBounce = true; b.hot = true; } }
        return 1 / W.rate / (hot ? 1.8 : 1);
    }
    }
}
function gfCrewMineBlow(m) { gfCrewBurst(m.x, m.y, GF_CREW_N.mineR * (m.weak ? 0.7 : 1), m.weak ? 1 : 2, 1, m.weak ? 2 : 4, GF_CREW.elodie.col); }

// ---- K: the crew member's siphon ability ----
function gfCrewAbilityReady() {
    const cw = gfCrew();
    if (!glShip.isAlive || gfCap.charge < cw.cost) return false;
    if (gfCrewId === "maren") return gfHull < GF.hull || gfWing.some(function (b) { return b.isAlive && b.gfHp < GF.fleetHp; });
    if (gfCrewId === "greer") return gfCrewSt.over <= 0;
    if (gfCrewId === "soren") return gfCrewSt.slip <= 0;
    if (gfCrewId === "bex") return gfCrewSt.ram <= 0;
    if (gfCrewId === "booke") return gfCrewSt.shield <= 0;
    return true;
}
function gfCrewAbility() {
    const cw = gfCrew(), st = gfCrewSt, s = glShip;
    if (!s.isAlive || gfFlight.jump === "burst") return;
    if (!gfCrewAbilityReady()) { gfCap.deny = 0.4; gfSfx("deny"); return; }
    gfCap.flash = 0.5;
    if (gfCrewId === "maren") {
        // The whole charge, into your hull first and what is left into the wing.
        let pool = gfCap.charge * GF_WING.mendPer;
        const own = Math.min(pool, GF.hull - gfHull);
        gfHull += own; pool -= own;
        const hurt = gfWing.filter(function (b) { return b.isAlive && !b.warp && b.gfHp < GF.fleetHp; });
        hurt.forEach(function (b) { const h = Math.min(GF.fleetHp - b.gfHp, pool * 2 / hurt.length); b.gfHp += h; glSpawnBurst(b.x, b.y, 6, cw.col); });
        gfCap.charge = 0;
        gfSfx("mend"); glSpawnBurst(s.x, s.y, 14, cw.col);
        gfCrewSt.puffs.push({ x: s.x, y: s.y, r: 22, t: 0, col: cw.col });
        return;
    }
    gfCap.charge -= cw.cost;
    gfSfx("order", 1);
    if (gfCrewId === "greer") st.over = GF_CREW_N.overT;
    else if (gfCrewId === "elodie") { st.sentries.push({ x: s.x, y: s.y, t: GF_CREW_N.sentryT, cd: 0, a: s.angle }); if (st.sentries.length > 2) st.sentries.shift(); }
    else if (gfCrewId === "soren") st.slip = GF_CREW_N.slipT;
    else if (gfCrewId === "booke") st.shield = GF_CREW_N.shieldT;
    else if (gfCrewId === "bex") { st.ram = GF_CREW_N.ramT; st.ramA = gfAimAngle(); st.ramHit = []; glUltraShakeKick = Math.max(glUltraShakeKick, 0.3); gfSfx("drop"); }
}
// The ram overrides the ship's velocity (from gfFlightVelocity).
function gfCrewRamVel(s) {
    if (gfCrewSt.ram <= 0) return null;
    const v = s.baseSpeed * GF_FLIGHT.boostMul * GF_CREW_N.ramMul;
    return { vx: Math.cos(gfCrewSt.ramA) * v, vy: Math.sin(gfCrewSt.ramA) * v, a: 0.6 };
}

// ---- per-frame (from gfUpdate) ----
function gfCrewUpdate(dt) {
    const st = gfCrewSt, N = GF_CREW_N, s = glShip;
    gfAllyUpdate(dt);
    st.over = Math.max(0, st.over - dt); st.slip = Math.max(0, st.slip - dt); st.shield = Math.max(0, st.shield - dt);
    st.safe = Math.max(0, st.safe - dt); st.impact = Math.max(0, st.impact - dt); st.shieldHit = Math.max(0, (st.shieldHit || 0) - dt);
    if (st.mineStock < N.mineStock) { st.mineT += dt; if (st.mineT >= N.mineRefill) { st.mineT = 0; st.mineStock++; } } else st.mineT = 0;
    for (let i = st.beams.length - 1; i >= 0; i--) { st.beams[i].t -= dt; if (st.beams[i].t <= 0) st.beams.splice(i, 1); }
    for (let i = st.puffs.length - 1; i >= 0; i--) { st.puffs[i].t += dt; if (st.puffs[i].t > 0.4) st.puffs.splice(i, 1); }

    // The ram: everything in the way.
    if (st.ram > 0) {
        st.ram -= dt;
        if (!s.isAlive) st.ram = 0;
        s.angle = st.ramA;
        for (let i = 0; i < gfCreatures.length; i++) {
            const c = gfCreatures[i];
            if (c.hp <= 0 || c.birthT > 0 || st.ramHit.indexOf(c) !== -1) continue;
            if (Math.hypot(c.x - s.x, c.y - s.y) > c.b.r + 2.5) continue;
            st.ramHit.push(c);
            st.impact = 0.12; glUltraShakeKick = Math.max(glUltraShakeKick, 0.7); gfSfx("rupture", 0.5);
            if (c.kind === "krill" || !c.b.armour || c.tumble > 0) c.hp = 0;          // a clean kill: it leaves its siphon
            else {
                // Armoured: lit and thrown aside. You are clear before it goes.
                gfPressure(c, GF_KINDS[c.kind].press);
                const side = Math.sign(Math.sin(Math.atan2(c.y - s.y, c.x - s.x) - st.ramA)) || 1;
                c.vx = Math.cos(st.ramA + side * 0.9) * 50; c.vy = Math.sin(st.ramA + side * 0.9) * 50;
                c.tumble = GF_TUMBLE; c.spin = side * 6;
            }
        }
        for (let i = 0; i < gfOrifices.length; i++) {
            const o = gfOrifices[i];
            if (o.sealed || o.clamped || o.state === "closed" || !o.site.awake || st.ramHit.indexOf(o) !== -1) continue;
            const p = gfOrificePos(o);
            if (Math.hypot(p.x - s.x, p.y - s.y) < o.site.oriR + 3) { st.ramHit.push(o); gfHurtOrifice(o, 15); st.impact = 0.12; glUltraShakeKick = 0.8; }
        }
        if (st.ram <= 0) { st.ram = 0; st.safe = N.ramSafe; }
    }

    // Mines: drift, slow, arm, and burst on anything that comes close.
    for (let i = st.mines.length - 1; i >= 0; i--) {
        const m = st.mines[i];
        m.t += dt; m.x += m.vx * dt; m.y += m.vy * dt;
        m.vx *= 1 - Math.min(1, dt * 1.6); m.vy *= 1 - Math.min(1, dt * 1.6);
        let go = m.t > 25;
        if (m.t > 0.45 && !go) {
            for (let j = 0; j < gfCreatures.length && !go; j++) {
                const c = gfCreatures[j];
                if (c.hp > 0 && c.birthT <= 0 && Math.hypot(c.x - m.x, c.y - m.y) < N.mineTrig + c.b.r) go = true;
            }
            for (let j = 0; j < gfOrifices.length && !go; j++) {
                const o = gfOrifices[j];
                if (o.sealed || o.clamped || o.state === "closed" || !o.site.awake) continue;
                const p = gfOrificePos(o);
                if (Math.hypot(p.x - m.x, p.y - m.y) < N.mineTrig + o.site.oriR) go = true;
            }
        }
        if (go) { st.mines.splice(i, 1); gfCrewMineBlow(m); }
    }
    // Flak shells: out to the cursor's range, or the first body they meet.
    for (let i = st.shells.length - 1; i >= 0; i--) {
        const f = st.shells[i], step = Math.hypot(f.vx, f.vy) * dt;
        f.x += f.vx * dt; f.y += f.vy * dt; f.left -= step;
        let go = f.left <= 0;
        for (let j = 0; j < gfCreatures.length && !go; j++) {
            const c = gfCreatures[j];
            if (c.hp > 0 && c.birthT <= 0 && Math.hypot(c.x - f.x, c.y - f.y) < c.b.r + 1.5) go = true;
        }
        for (let j = 0; j < gfSites.length && !go; j++) if (Math.hypot(gfSites[j].x - f.x, gfSites[j].y - f.y) < gfSites[j].r + 1) go = true;
        if (go) { st.shells.splice(i, 1); gfCrewBurst(f.x, f.y, N.flakR * (f.weak ? 0.75 : 1), f.weak ? 1 : 2, 1, f.weak ? 1 : 3, GF_CREW.booke.col); }
    }
    // Sentries: fire only at what they can wound, like a wing on FOLLOW.
    for (let i = st.sentries.length - 1; i >= 0; i--) {
        const g = st.sentries[i];
        g.t -= dt; g.cd -= dt;
        if (g.t <= 0) { glSpawnBurst(g.x, g.y, 10, GF_CREW.elodie.col); st.sentries.splice(i, 1); continue; }
        let tgt = null, td = N.sentryR;
        for (let j = 0; j < gfCreatures.length; j++) {
            const c = gfCreatures[j], d = Math.hypot(c.x - g.x, c.y - g.y);
            if (c.hp > 0 && d < td && (gfCanWound(c, g.x, g.y) || c.tumble > 0)) { td = d; tgt = c; }
        }
        if (tgt) {
            const W = GF_ARMS.blaster, tt = td / (W.speed * 60);
            g.a = Math.atan2(tgt.y + tgt.vy * tt - g.y, tgt.x + tgt.vx * tt - g.x);
            if (g.cd <= 0 && glBullets.length < GL_MAX_BULLETS) {
                glBullets.push({ x: g.x, y: g.y, vx: Math.cos(g.a) * W.speed, vy: Math.sin(g.a) * W.speed, life: W.life, size: 2,
                                 color: GF_CREW.elodie.col, gf: "bolt", bot: true, owner: g, ccol: GF_CREW.elodie.col });
                g.cd = 0.25;
            }
        }
    }
}

// ---- drawing: world (from gfDrawWorld) ----
function gfCrewDrawWorld(c, z) {
    const st = gfCrewSt, N = GF_CREW_N;
    c.save();
    c.lineCap = "round";
    for (let i = 0; i < st.beams.length; i++) {
        const b = st.beams[i], a = glWorldToScreenRaw(b.x0, b.y0), e = glWorldToScreenRaw(b.x1, b.y1);
        const mx = (a.x + e.x) / 2 + Math.sin(gfTime * 30 + i) * 4, my = (a.y + e.y) / 2 + Math.cos(gfTime * 26 + i) * 4;
        c.strokeStyle = b.bite ? "rgba(125,255,156,0.35)" : "rgba(125,255,156,0.12)"; c.lineWidth = b.weak ? 4 : 8;
        c.beginPath(); c.moveTo(a.x, a.y); c.quadraticCurveTo(mx, my, e.x, e.y); c.stroke();
        c.strokeStyle = b.bite ? "#E8FFF0" : "rgba(200,255,220,0.4)"; c.lineWidth = b.weak ? 1 : 2;
        c.beginPath(); c.moveTo(a.x, a.y); c.quadraticCurveTo(mx, my, e.x, e.y); c.stroke();
    }
    for (let i = 0; i < st.mines.length; i++) {
        const m = st.mines[i], p = glWorldToScreenRaw(m.x, m.y), armed = m.t > 0.45, R = m.weak ? 4 : 6;
        if (!gfOnScreen(p, 20)) continue;
        c.fillStyle = "#2A1404"; c.strokeStyle = GF_CREW.elodie.col; c.lineWidth = 1.5;
        c.beginPath();
        for (let k = 0; k < 6; k++) { const a = k * Math.PI / 3 + m.t; c.lineTo(p.x + Math.cos(a) * R, p.y + Math.sin(a) * R); }
        c.closePath(); c.fill(); c.stroke();
        if (armed) { c.fillStyle = Math.floor(gfTime * 4 + i) % 2 ? "#FFFFFF" : GF_CREW.elodie.col; c.fillRect(p.x - 1.5, p.y - 1.5, 3, 3); }
    }
    for (let i = 0; i < st.shells.length; i++) {
        const f = st.shells[i], p = glWorldToScreenRaw(f.x, f.y);
        c.fillStyle = "#DCE8FF"; c.beginPath(); c.arc(p.x, p.y, f.weak ? 2 : 3, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "rgba(91,140,255,0.6)"; c.lineWidth = 2;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x - f.vx * 0.05 * z, p.y - f.vy * 0.05 * z); c.stroke();
    }
    for (let i = 0; i < st.sentries.length; i++) {
        const g = st.sentries[i], p = glWorldToScreenRaw(g.x, g.y);
        if (!gfOnScreen(p, 30)) continue;
        c.save(); c.translate(p.x, p.y);
        c.strokeStyle = GF_CREW.elodie.col; c.fillStyle = "#2A1404"; c.lineWidth = 1.5;
        c.strokeRect(-7, -7, 14, 14); c.fillRect(-5, -5, 10, 10);
        c.rotate(g.a); c.lineWidth = 3; c.beginPath(); c.moveTo(0, 0); c.lineTo(13, 0); c.stroke();
        c.restore();
        c.strokeStyle = "rgba(255,138,61,0.5)"; c.lineWidth = 2;
        c.beginPath(); c.arc(p.x, p.y, 12, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * g.t / N.sentryT); c.stroke();
    }
    for (let i = 0; i < st.puffs.length; i++) {
        const f = st.puffs[i], p = glWorldToScreenRaw(f.x, f.y), k = f.t / 0.4;
        c.globalAlpha = 1 - k; c.strokeStyle = f.col; c.lineWidth = 3 * (1 - k) + 1;
        c.beginPath(); c.arc(p.x, p.y, f.r * z * Math.min(1, 0.3 + k * 1.4), 0, Math.PI * 2); c.stroke();
        c.globalAlpha = 0.25 * (1 - k); c.fillStyle = f.col; c.fill();
    }
    c.globalAlpha = 1;
    // The shield: a hex-celled bubble round the ship.
    if (st.shield > 0 && glShip.isAlive) {
        const p = glWorldToScreenRaw(glShip.x, glShip.y), R = N.shieldR * z, end = Math.min(1, st.shield);
        c.strokeStyle = st.shieldHit > 0 ? "#FFFFFF" : "rgba(91,140,255," + (0.85 * end).toFixed(2) + ")"; c.lineWidth = st.shieldHit > 0 ? 4 : 2;
        c.fillStyle = "rgba(91,140,255," + (0.1 * end).toFixed(2) + ")";
        c.beginPath(); c.arc(p.x, p.y, R, 0, Math.PI * 2); c.fill(); c.stroke();
        c.lineWidth = 1; c.setLineDash([4, 8]);
        c.beginPath(); c.arc(p.x, p.y, R * 0.8, gfTime, gfTime + Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    c.restore();
}

// ---- drawing: a hull, in ship units (nose toward +x, about 14 long) ----
// Each silhouette has to read in one colour and at wing-bot size: gold twin
// prongs, a green round hull with a cross, an orange box with a tow arm, a
// white needle with long fins, a lime ram prow, a blue shield crescent.
function gfCrewHull(c, id, lw, flash) {
    const cw = GF_CREW[id];
    c.lineJoin = "round";
    c.fillStyle = flash ? "#FFFFFF" : cw.dark; c.strokeStyle = cw.col; c.lineWidth = lw;
    const poly = function (pts) {
        c.beginPath();
        for (let i = 0; i < pts.length; i += 2) { if (i === 0) c.moveTo(pts[i], pts[i + 1]); else c.lineTo(pts[i], pts[i + 1]); }
        c.closePath(); c.fill(); c.stroke();
    };
    switch (id) {
    case "maren":
        c.beginPath(); c.ellipse(0, 0, 11, 7.5, 0, 0, Math.PI * 2); c.fill(); c.stroke();
        poly([-11, -3, -14, -3, -14, 3, -11, 3]);
        c.fillStyle = cw.col; c.fillRect(-6, -1.4, 13, 2.8); c.fillRect(-1, -5.5, 3, 11);
        break;
    case "elodie":
        poly([8, -7, -9, -7, -11, -4, -11, 4, -9, 7, 8, 7, 11, 3, 11, -3]);
        poly([8, 7, 14, 10, 15, 8, 10, 4]);                       // the tow arm
        c.beginPath(); c.moveTo(-6, -7); c.lineTo(-6, 7); c.moveTo(1, -7); c.lineTo(1, 7); c.stroke();
        break;
    case "soren":
        poly([-2, 0, -12, -12, -14, -11, -9, -2, -9, 2, -14, 11, -12, 12]);   // long swept fins
        poly([17, 0, 2, -2.4, -11, -1.8, -11, 1.8, 2, 2.4]);                   // the needle
        break;
    case "bex":
        poly([-4, -9, -11, -8, -9, -3, -9, 3, -11, 8, -4, 9]);
        poly([13, -3, 9, -9, -4, -8, -6, 0, -4, 8, 9, 9, 13, 3]);              // the prow
        c.fillStyle = cw.col; c.beginPath(); c.moveTo(15, -3.5); c.lineTo(11, -8); c.lineTo(11, 8); c.lineTo(15, 3.5); c.closePath(); c.fill();
        break;
    case "booke":
        poly([-3, 0, -11, -6, -11, 6]);
        c.beginPath(); c.arc(-4, 0, 14, -1.15, 1.15); c.arc(-9, 0, 13, 0.95, -0.95, true); c.closePath(); c.fill(); c.stroke();   // the plate
        c.beginPath(); c.arc(-4, 0, 11.5, -0.7, 0.7); c.stroke();
        break;
    default:   // greer
        poly([4, 0, -6, 11, -10, 11, -7, 3, -7, -3, -10, -11, -6, -11]);
        poly([12, 0, 4, 3.5, -9, 3, -9, -3, 4, -3.5]);
        poly([15, -6, 2, -6, 2, -4, 15, -4.6]); poly([15, 6, 2, 6, 2, 4, 15, 4.6]);   // the twin prongs
    }
    // Canopy.
    c.fillStyle = "#EFFFF8"; c.globalAlpha = 0.9;
    c.beginPath(); c.ellipse(id === "booke" ? -5 : 3, 0, 2.6, 1.4, 0, 0, Math.PI * 2); c.fill();
    c.globalAlpha = 1;
}

// ---- overlay bits (from gfDrawHud) ----
function gfCrewOverlay(c) {
    const st = gfCrewSt;
    // The ram's impact frame: two frames of hard inverted white, then speed lines.
    if (st.impact > 0) {
        const W = glW - GF_SIDE_W;
        if (st.impact > 0.08) { c.save(); c.globalCompositeOperation = "difference"; c.fillStyle = "#FFFFFF"; c.fillRect(0, 0, W, glH); c.restore(); }
        else {
            c.save(); c.strokeStyle = "rgba(255,255,255,0.7)"; c.lineWidth = 2;
            for (let i = 0; i < 26; i++) {
                const a = i / 26 * Math.PI * 2 + gfHash(i, 9), r0 = 120 + gfHash(i, 3) * 160;
                c.beginPath(); c.moveTo(glCX + Math.cos(a) * r0, glCY + Math.sin(a) * r0); c.lineTo(glCX + Math.cos(a) * (r0 + 260), glCY + Math.sin(a) * (r0 + 260)); c.stroke();
            }
            c.restore();
        }
    }
    // Elodie's mine stock: pips over the ship, the next one filling.
    if (gfCrewId === "elodie" && glShip.isAlive) {
        for (let i = 0; i < GF_CREW_N.mineStock; i++) {
            const full = i < st.mineStock, x = glCX - 17 + i * 9, y = glCY - 30;
            c.strokeStyle = GF_CREW.elodie.col; c.lineWidth = 1; c.globalAlpha = 0.8; c.strokeRect(x, y, 6, 4);
            c.fillStyle = GF_CREW.elodie.col; c.globalAlpha = full ? 0.95 : 0.4;
            if (full) c.fillRect(x, y, 6, 4); else if (i === st.mineStock) c.fillRect(x, y, 6 * st.mineT / GF_CREW_N.mineRefill, 4);
        }
        c.globalAlpha = 1;
    }
    // A timed ability running: a thin arc round the ship in the crew colour.
    const run = st.over > 0 ? st.over / GF_CREW_N.overT : (st.slip > 0 ? st.slip / GF_CREW_N.slipT : (st.shield > 0 ? st.shield / GF_CREW_N.shieldT : 0));
    if (run > 0 && glShip.isAlive) {
        c.strokeStyle = gfCrew().col; c.lineWidth = 2;
        c.beginPath(); c.arc(glCX, glCY, 34, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * run); c.stroke();
    }
}

// ---------------------------------------------------
//   Dev menu: hold L and G together
// ---------------------------------------------------
let gfDevEl = null;
const gfDevKeys = { l: false, g: false, armed: true };
function gfDevSite(i) {
    const st = gfSites[i]; if (!st) return;
    const o = st.orifices.filter(function (q) { return !q.sealed; })[0] || st.orifices[0], p = gfOrificePos(o);
    if (gfFlight.jump !== "idle") gfFlightReset();
    glShip.x = p.x + Math.cos(o.a) * 90; glShip.y = p.y + Math.sin(o.a) * 90; glShip.vx = glShip.vy = 0;
    gfWing.forEach(function (b, k) { b.x = glShip.x - 6 - k * 3; b.y = glShip.y + (k % 2 ? 5 : -5); b.warp = null; });
}
function gfDevAct(key) {
    const n = parseInt(key, 10);
    if (n >= 1 && n <= 6) gfCrewSet(GF_CREW_ORDER[n - 1]);
    else if (n >= 7 && n <= 9) gfDevSite(n - 7);
    else if (key === "0") { gfCap.charge = GF_WING.cap; gfCap.sinceGain = 0; }
    else if (key === "-") gfCrewSt.god = !gfCrewSt.god;
    else if (key === "=") { gfHull = GF.hull; gfWingReinforce(1); }
    else if (/^a[1-6]$/.test(key)) gfAllySpawn(GF_CREW_ORDER[parseInt(key[1], 10) - 1]);
    else if (key === "x") gfAllyClear();
    gfDevRender();
}
function gfDevRender() {
    if (!gfDevEl) return;
    const row = function (key, label, on, col) {
        return "<div data-k='" + key + "' style='cursor:pointer;padding:3px 8px;margin:2px 0;border:1px solid " + (on ? (col || "#7DF9FF") : "#2a3c3a") +
            ";color:" + (on ? "#000" : (col || "#cfe9e6")) + ";background:" + (on ? (col || "#7DF9FF") : "transparent") + "'><b>" + key + "</b>&nbsp; " + label + "</div>";
    };
    let h = "<div style='color:#6d8582;margin-bottom:6px'>DEV · L+G to close</div>";
    GF_CREW_ORDER.forEach(function (id, i) { const cw = GF_CREW[id]; h += row(String(i + 1), cw.name + " · " + cw.role + " · " + cw.weapon + " / " + cw.abil, id === gfCrewId, cw.col); });
    h += "<div style='height:6px'></div><div style='color:#6d8582'>allies (Shift+1..6 adds one, Backspace clears)</div><div style='display:flex;flex-wrap:wrap;gap:3px'>";
    GF_CREW_ORDER.forEach(function (id, i) {
        const n = gfWing.filter(function (b) { return b.ally && b.crew === id && b.isAlive; }).length;
        h += "<div data-k='a" + (i + 1) + "' style='cursor:pointer;padding:3px 6px;border:1px solid " + GF_CREW[id].col + ";color:" + GF_CREW[id].col + "'>+" + GF_CREW[id].name + (n ? " " + n : "") + "</div>";
    });
    h += "<div data-k='x' style='cursor:pointer;padding:3px 6px;border:1px solid #2a3c3a'>clear</div></div><div style='height:6px'></div>";
    gfSites.forEach(function (st, i) { h += row(String(7 + i), "go to " + st.name, false); });
    h += "<div style='height:6px'></div>" + row("0", "fill siphon", false) + row("-", "no damage", gfCrewSt.god, "#FFB000") + row("=", "full hull + one bot", false);
    gfDevEl.innerHTML = h;
}
function gfDevToggle() {
    if (!gfDevEl) {
        gfDevEl = document.createElement("div");
        gfDevEl.style.cssText = "position:fixed;left:16px;top:16px;z-index:50;background:rgba(4,10,12,0.92);border:1px solid #7DF9FF;padding:10px 12px;font:13px monospace;color:#cfe9e6;min-width:300px;display:none";
        gfDevEl.addEventListener("mousedown", function (e) {
            let t = e.target; while (t && t !== gfDevEl && !t.getAttribute("data-k")) t = t.parentNode;
            if (t && t !== gfDevEl) gfDevAct(t.getAttribute("data-k"));
            e.stopPropagation(); e.preventDefault();
        });
        document.body.appendChild(gfDevEl);
    }
    const open = gfDevEl.style.display === "none";
    gfDevEl.style.display = open ? "block" : "none";
    if (open) gfDevRender();
}
function gfDevOpen() { return !!gfDevEl && gfDevEl.style.display !== "none"; }
window.addEventListener("keydown", function (e) {
    if (e.code === "KeyL") gfDevKeys.l = true;
    if (e.code === "KeyG") gfDevKeys.g = true;
    if (gfDevKeys.l && gfDevKeys.g && gfDevKeys.armed) { gfDevKeys.armed = false; gfDevToggle(); }
    if (gfDevOpen() && !e.repeat) {
        const m = { Minus: "-", Equal: "=", Backspace: "x" };
        let k = /^Digit\d$/.test(e.code) ? e.code.slice(5) : m[e.code];
        if (e.shiftKey && /^Digit[1-6]$/.test(e.code)) k = "a" + e.code.slice(5);
        if (k) { gfDevAct(k); e.stopImmediatePropagation(); e.preventDefault(); }
    }
}, true);
window.addEventListener("keyup", function (e) {
    if (e.code === "KeyL") gfDevKeys.l = false;
    if (e.code === "KeyG") gfDevKeys.g = false;
    if (!gfDevKeys.l || !gfDevKeys.g) gfDevKeys.armed = true;
}, true);
window.addEventListener("blur", function () { gfDevKeys.l = gfDevKeys.g = false; gfDevKeys.armed = true; });
