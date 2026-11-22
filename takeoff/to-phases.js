// ===================================================
//   Takeoff — the round: title, crawl, the launch countdown, the climb
//   schedule, gates, orbit, docking, aftermath, the score card
// ===================================================
// THE LAUNCH (Ry, 2026-11-21): a spoken countdown; the mothership launches
// up through an aperture in the ground just before the players lift off.
//   T-10 .. T-1  the voice counts, digits on screen
//   T-7          the aperture doors slide open
//   T-4          the mothership lights its engines in the silo
//   T-3 .. 0     it rises out through the aperture
//   0            "Liftoff": your ship leaves its pad, the camera starts to climb
//
// THE ROUND (design brief): climb, gate, climb, gate, climb, gate, climb,
// BOSS GATE, orbit (calm), dock. About four and a half minutes when it goes
// well. Lose if the mothership's hull reaches zero.
"use strict";

const TO_PLAN = [
    { k: "climb", dur: 24, lvl: 0 },
    { k: "gate", n: 1 },
    { k: "climb", dur: 20, lvl: 1 },
    { k: "gate", n: 2 },
    { k: "climb", dur: 20, lvl: 2 },
    { k: "gate", n: 3 },
    { k: "climb", dur: 14, lvl: 3 },
    { k: "gate", n: 4, boss: true },
    { k: "orbit", dur: 18 },
    { k: "dock", dur: 25 }
];
const TO_LAUNCH = { count0: 1.0, doors: 4.0, ignite: 7.0, rise: 8.0, liftoff: 11.0, silo: -TO.VH };
const TO_CRAWL = [
    "ACT IV",
    "",
    "THE TIDE HANGS ABOVE THE EARTH.",
    "ITS TENDRILS REACH DOWN THROUGH THE SKY",
    "AND CLOSE ON ANYTHING THAT TRIES TO LEAVE.",
    "",
    "UNDER THE GROUND, THE MOTHERSHIP IS READY.",
    "SIX CREWS STAND ON THE PADS BESIDE IT.",
    "",
    "GET IT TO ORBIT."
];

let toSeg = 0;              // index into TO_PLAN
let toSegT = 0;
let toSpawnT = 0, toSpawnN = 0;
let toCaption = { text: "", t: 0 };
let toCount = -1;           // the digit on screen during the countdown
let toDoors = 0;            // aperture open 0..1
const toDock = { done: false, clean: false, t: 0, rel: 0 };
let toCardRows = [];
let toAfterWhy = "";

function toGravMul() {
    if (toPhase === "orbit") return Math.max(0, 1 - toPhaseT / 3);
    if (toPhase === "dock" || toPhase === "after" && toWin) return 0;
    return 1;
}
function toSay2(text, beepLast) { if (!toSay(text)) toSfx("beep", beepLast ? 1 : 0); }
function toCap(text, t) { toCaption.text = text; toCaption.t = t || 2.2; }

function toSetPhase(p) { toPhase = p; toPhaseT = 0; }

// ---- starting a run ----
function toNewRun() {
    toFoes.length = 0; toDebris.length = 0; toSpit.length = 0; toBolts.length = 0; toFx.length = 0;
    toBell = null; toG = null;
    toScore = 0; for (const k in toTally) toTally[k] = 0;
    toWin = false; toDock.done = false; toDock.clean = false; toDock.t = 0;
    toCam.x = 0; toCam.y = -70; toCam.vx = 0; toCam.vy = 0; toCam.shake = 0;
    toMotherReset();
    toM.y = -toM.h / 2 - 40;
    toShipReset(-190, 12);
    toP.onPad = true; toP.deaths = 0;
    toDoors = 0; toCount = -1; toSeg = 0; toSegT = 0;
    toSetPhase("launch");
    toMusicMood("count");
}

function toStartSeg(i) {
    toSeg = i; toSegT = 0; toSpawnT = 1.5; toSpawnN = 0;
    const s = TO_PLAN[i];
    if (!s) return;
    if (s.k === "climb") { toSetPhase("climb"); toMusicMood("climb"); }
    else if (s.k === "gate") { toSetPhase("gate"); toGateStart(s.n, !!s.boss); toCap(s.boss ? "" : "", 0); }
    else if (s.k === "orbit") {
        // Calm on purpose: the horde lets go and falls away as gravity does.
        toBell = null; toSpit.length = 0;
        for (let j = 0; j < toFoes.length; j++) { toFoes[j].flee = true; toFoes[j].latch = null; }
        toSetPhase("orbit"); toMusicMood("orbit"); toCap("GRAVITY RELEASED", 3); }
    else if (s.k === "dock") { toSetPhase("dock"); toMusicMood("dock"); toCap("DOCK", 3); toSfx("respawn"); }
}
function toGateDone(G) {
    if (toPhase === "after" || toPhase === "card") return;   // the run already ended under this gate
    toStartSeg(toSeg + 1);
}

// ---- the launch sequence ----
function toLaunchUpdate(dt) {
    const t = toPhaseT, L = TO_LAUNCH;
    // The count: T-10 at count0, one a second.
    const n = 10 - Math.floor(t - L.count0);
    if (t >= L.count0 && n >= 1 && n <= 10 && n !== toCount) {
        toCount = n;
        if (n === 10) toSay2("T minus ten"); else toSay2(String(n), false);
    }
    if (t >= L.doors && t - dt < L.doors) { toSfx("iris"); toCap("APERTURE OPEN", 2.4); }
    toDoors = toClamp((t - L.doors) / 2.4, 0, 1);
    if (t >= L.ignite && t - dt < L.ignite) { toCap("MOTHERSHIP IGNITION", 2.2); }
    if (t >= L.ignite) {
        toM.burn = Math.min(1, (t - L.ignite) / 0.8);
        toHold(toAudio.rumble, Math.min(0.9, (t - L.ignite) * 0.5), 160 + 80 * toM.burn);
        if (Math.random() < dt * 30) toFx.push({ k: "smoke", x: toRand(-90, 90), y: toRand(0, 20), vx: toRand(-60, 60), vy: toRand(20, 60), t: 0, life: toRand(1.5, 3), r: toRand(14, 30) });
        toCam.shake = Math.max(toCam.shake, 1.5 * toM.burn);
    }
    // The mothership rises out through the aperture.
    if (t >= L.rise) {
        const k = (t - L.rise);
        toM.vy = Math.min(140, 30 + k * 45);
        toM.y += toM.vy * dt;
    }
    if (t >= L.liftoff) {
        toCount = 0;
        toSay2("Liftoff", true);
        toCap("LIFTOFF", 1.6);
        toP.onPad = false; toP.vy = 120;
        toStartSeg(0);
    }
}

// ---- the director: clusters during the climb, a trickle during gates ----
function toDirector(dt) {
    const s = TO_PLAN[toSeg];
    if (!s) return;
    toSpawnT -= dt;
    if (toSpawnT > 0) return;
    if (s.k === "climb") {
        const lvl = s.lvl;
        toSpawnT = Math.max(2.6, 4.6 - lvl * 0.55);
        const pick = toSpawnN % 4;
        if (pick === 0 || pick === 2) toSpawnCluster("krill", 6 + lvl * 2 + (Math.random() * 3 | 0));
        else if (pick === 1) toSpawnCluster("plank", 16 + lvl * 5);
        else toSpawnDebris(3 + lvl);
        if (lvl >= 2 && pick === 3) toSpawnCluster("krill", 4 + lvl);
        toSpawnN++;
    } else if (s.k === "gate" && toG && toG.state === "hold") {
        toSpawnT = 6;
        toSpawnCluster("krill", s.boss ? 5 : 4);
        if (s.boss && toSpawnN % 2 === 1) toSpawnCluster("plank", 18);
        toSpawnN++;
    } else toSpawnT = 0.5;
}

// ---- docking ----
function toDockUpdate(dt) {
    const p = toM.ports[0], px = toM.x + p.dx, py = toM.y + p.dy;
    if (toDock.done) {
        toP.x = px; toP.y = py + 8; toP.vx = toCam.vx; toP.vy = 0; toP.ang = Math.PI / 2;
        toDock.t += dt;
        if (toDock.t > 1.2) toFinish(true, "docked");
        return;
    }
    if (toP.dead) return;
    const d = toDist(toP.x, toP.y, px, py + 6);
    if (d < 16) {
        const rel = Math.hypot(toP.vx - toCam.vx, toP.vy - toCam.vy);
        toDock.done = true; toDock.rel = rel;
        toDock.clean = rel < 45 && Math.abs(toP.x - px) < 7;
        toSfx("dock"); toRing(px, py, 40, "#FFB000", 0.6);
        toTally.dock = 1;
        toAddScore(10000, px, py + 30, "#FFE45C");
        if (toDock.clean) { toTally.clean = 1; toAddScore(2000, px, py + 60, "#FFE45C"); toCap("CLEAN DOCK", 2.2); }
        else toCap("DOCKED", 2);
    } else if (toPhaseT > TO_PLAN[toSeg].dur) {
        // Too long: the mothership reels you in (no bonus).
        toDock.done = true; toDock.rel = 999; toTally.dock = 1;
        toSfx("dock"); toAddScore(10000, px, py + 30, "#FFE45C"); toCap("TOWED IN", 2);
    }
}

// ---- ends ----
function toLose(why) {
    if (toPhase === "after" || toPhase === "card") return;
    toAfterWhy = why;
    toFinish(false, why);
}
function toFinish(win, why) {
    toWin = win; toAfterWhy = why;
    if (win) {
        const hb = Math.round(toM.hull * 50 / 10) * 10;
        toTally.hullBonus = hb; toScore += hb;
    } else {
        toCap("MOTHERSHIP LOST", 3.5);
        toSfx("boom", 1);
        toCam.shake = 20;
    }
    toHold(toAudio.boost, 0); toHold(toAudio.rumble, 0);
    toMusicMood(win ? "orbit" : "silent");
    toSetPhase("after");
}
function toBuildCard() {
    const r = [];
    const add = function (label, n, each) { if (n) r.push([label + (each ? " x" + n : ""), n * (each || 1)]); };
    add("AIRKRILL", toTally.krill, 100);
    add("AIR PLANKTON", toTally.plank, 10);
    add("AIRCRABS", toTally.crab, 500);
    add("BELLWETHER", toTally.bell, 500);
    add("GATES SNAPPED", toTally.gates - toTally.boss, 1000);
    add("BOSS GATE", toTally.boss, 5000);
    const spots = toScore - r.reduce(function (a, b) { return a + b[1]; }, 0) - (toTally.dock ? 10000 : 0) - (toTally.clean ? 2000 : 0) - toTally.hullBonus;
    if (spots > 0) r.push(["WEAK SPOTS", spots]);
    if (toTally.dock) r.push(["DOCKED", 10000]);
    if (toTally.clean) r.push(["CLEAN DOCK", 2000]);
    if (toTally.hullBonus) r.push(["HULL " + Math.round(toM.hull) + "%", toTally.hullBonus]);
    toCardRows = r;
}

// ---- the main update ----
function toUpdate(dt) {
    toTime += dt; toPhaseT += dt;
    if (toCaption.t > 0) toCaption.t -= dt;
    toFxUpdate(dt);
    if (toPhase === "title" || toPhase === "crawl" || toPhase === "card") return;
    // Smoke drifts.
    for (let i = 0; i < toFx.length; i++) if (toFx[i].k === "smoke") { const f = toFx[i]; f.x += f.vx * dt; f.y += f.vy * dt; f.r += dt * 20; }

    // Camera.
    let wantVy = 0, wantVx = 0;
    if (toPhase === "climb" || toPhase === "gate") {
        wantVy = TO.scroll;
        if (!toP.dead && toP.y < toMotherBottom()) wantVy *= 0.8;   // stragglers below the ship slow it a little
    } else if (toPhase === "orbit") {
        wantVy = 0;
        wantVx = 160 * toClamp((toPhaseT - 2) / 10, 0, 1);
    } else if (toPhase === "dock") { wantVx = 160; }
    else if (toPhase === "after") { wantVy = toCam.vy * 0.98; wantVx = toCam.vx; }
    toCam.vy += (wantVy - toCam.vy) * Math.min(1, dt * (toPhase === "orbit" ? 0.8 : 0.9));
    toCam.vx += (wantVx - toCam.vx) * Math.min(1, dt * 2);
    toCam.y += toCam.vy * dt; toCam.x += toCam.vx * dt;
    toCam.shake = Math.max(0, toCam.shake - dt * 12);

    if (toPhase === "launch") toLaunchUpdate(dt);
    else if (toPhase !== "after") toHold(toAudio.rumble, toPhase === "climb" || toPhase === "gate" ? 0.12 : 0.03, 200);

    const ctl = toPhase !== "after";
    toShipUpdate(dt, ctl);
    toHold(toAudio.boost, toP.boosting ? 0.5 : 0, toP.boosting ? 1200 : 600);
    toMotherUpdate(dt);
    toBoltsUpdate(dt);
    toFoesUpdate(dt);
    toGateUpdate(dt);

    const s = TO_PLAN[toSeg];
    if (toPhase === "climb") {
        toSegT += dt;
        toDirector(dt);
        if (toSegT >= s.dur) toStartSeg(toSeg + 1);
    } else if (toPhase === "gate") {
        toDirector(dt);
    } else if (toPhase === "orbit") {
        toDebris.length = 0;
        if (toPhaseT >= s.dur) toStartSeg(toSeg + 1);
    } else if (toPhase === "dock") {
        toDockUpdate(dt);
    } else if (toPhase === "after") {
        if (toWin && toDock.done) { const p = toM.ports[0]; toP.x = toM.x + p.dx; toP.y = toM.y + p.dy + 8; toP.vx = toCam.vx; toP.vy = 0; toP.ang = Math.PI / 2; }
        if (!toWin) {
            // The mothership comes apart.
            if (Math.random() < dt * 14 && toPhaseT < 2.5) { const x = toM.x + toRand(-50, 50), y = toM.y + toRand(-120, 120); toSpark(x, y, 18, Math.random() < 0.5 ? "#FF8A3D" : "#FF2E88", 220, 0.8); toSfx("boom", 0.5); }
        }
        if (toPhaseT > 3.5) { toBuildCard(); toSetPhase("card"); }
    }
    if (window.HUBSCORE && !toHeadless()) HUBSCORE.hud({ score: toScore, game: "takeoff", color: TO_SHIP.col });
}

// ---- input hooks (to-core.js calls these) ----
function toKeyPress(k, e) {
    if (toKeys.l && toKeys.g && TO_DEV_KEYS[k]) { TO_DEV_KEYS[k](); return; }
    if (toPhase === "crawl" && (k === " " || k === "Enter" || k === "Escape")) { toNewRun(); return; }
    if (toPhase === "title" && (k === " " || k === "Enter")) { toBegin(); return; }
    if (toPhase === "card" && (k === " " || k === "Enter")) { toNewRun(); return; }
    toKeyPressShip(k);
}
function toClick() {
    toAudioStart();
    if (toPhase === "title") toBegin();
    else if (toPhase === "crawl" && toPhaseT > 0.4) toNewRun();
    else if (toPhase === "card" && toPhaseT > 1) toNewRun();
}
function toBegin() { toAudioStart(); toSetPhase("crawl"); toMusicMood("title"); }

// Dev menu: hold L and G, then a key (same chord as Gyro Fleet).
function toDevJump(i) {
    if (toPhase === "title" || toPhase === "crawl" || toPhase === "card") toNewRun();
    toSayStop();
    toP.onPad = false; toM.burn = 1; toDoors = 1; toCount = 0;
    toG = null; toBell = null; toM.held = false; toFoes.length = 0;
    toM.y = toCam.y + TO.homeFrac * TO.VH; toM.vy = TO.scroll; toCam.vy = TO.scroll;
    if (toP.dead || toP.y < toCam.y) toShipRespawn();
    toStartSeg(i);
}
const TO_DEV_KEYS = {
    "1": function () { toDevJump(0); }, "2": function () { toDevJump(1); }, "3": function () { toDevJump(3); },
    "4": function () { toDevJump(5); }, "5": function () { toDevJump(7); }, "6": function () { toDevJump(8); },
    "7": function () { toDevJump(9); },
    "-": function () { toGod = !toGod; toCap(toGod ? "DEV: NO DAMAGE" : "DEV: DAMAGE ON", 1.5); },
    "=": function () { toM.hull = TO.hull; toP.hp = TO_SHIP.hp; toP.meter = TO_SHIP.meterMax; toCap("DEV: REFILLED", 1.2); }
};

// The scene behind the title: night, the pads, the closed aperture.
function toTitleSetup() {
    toCam.x = 0; toCam.y = -70;
    toMotherReset(); toM.y = -toM.h / 2 - 40;
    toShipReset(-190, 12); toP.onPad = true;
    toMusicMood("title");
}
toTitleSetup();
