"use strict";
// ===================================================
//   Zombie — ARCADE RULES (2026-10-04)
// ===================================================
// The hub's goal is a 2-5 minute session (SCOPE_RULES.md rule 0), and the
// user's brief for this game: a swarm that "escalates way too quickly",
// overwhelming around the 4 MINUTE mark, so a run is a race to finish the
// chain and get out before then. Plan: HUB_1_0_PLAN.md Phase 2d.
//
// Everything arcade-specific lives here, switched by ZOMBIE_ARCADE
// (zombie-core.js), so the trimming that follows has one place to look.
// The other files carry one-line hooks into these functions and nothing
// else. Declares only; runs nothing at load.
//
//   THE CLOCK     one continuous wave on elapsed time T, not rounds
//   THE CHAIN     power on, no levers, tanks 8/12/16, a 30s gate
//   THE WIN       every player still standing must be AT the gate
//   DROPS         guns, perks and team drops fall from kills -- and each one
//                 goes to ONE player, decided by the host
//   RESPAWN       15s after bleeding out, beside a standing teammate
//   SEPARATION    a soft push-apart, so a swarm occupies space

// ---------------------------------------------------
//   THE CLOCK
// ---------------------------------------------------
// Spawn rate doubles every ARC_DOUBLE_S: 0.8/s at 0:00, ~2/s at 1:00,
// ~4.6/s at 2:00, ~10.5/s at 3:00, ~22/s at 4:00. Past ~3:30 that outruns
// any loadout, which is the point -- the overwhelm is the clock, not a
// scripted event. The ALIVE CAP is what keeps 22/s from being 22/s forever.
const ARC_RATE0 = 0.8;            // spawns per second at T = 0, solo
const ARC_DOUBLE_S = 50;          // seconds per doubling
const ARC_LEVEL_S = 12;           // seconds per "level" (the old round curves)
const ARC_CAP_BASE = 60;
const ARC_CAP_PER = 30;           // per player: solo 90, four players 180
const ARC_RING_MIN = 640;         // spawn ring around a living player, just
const ARC_RING_MAX = 900;         // past the edge of a 960x540 view
const ARC_SEEN_HALF_W = VIEW_W * 0.62;
const ARC_SEEN_HALF_H = VIEW_H * 0.62;
const ARC_RESPAWN_MS = 10000;     // 15s until 2026-10-11 ("shorten respawn after death to 10 seconds")
const ARC_GATE_W = 212;           // the tunnel's inside width; the gate spans all of it
const ARC_GATE_H = 66;
const ARC_OUT_PAST = 100;         // px down the tunnel past the gate that counts as OUT
// THE WAY IN (2026-10-12: "a 'Previous level: tunnel' that has the player enter
// into the arena with an open gate, but then the gate closes behind them").
// Every map after the first has a tunnel stub in its NORTH fence, the one the
// previous map's exit leads to. You start inside it, walk in through the open
// gate as the flythrough ends, and a slab drops behind you.
const ARC_ENTRY_SPAWN_BACK = 120; // px north of the fence that you start, inside the tunnel
const ARC_ENTRY_CLOSE_MS = 600;   // the slab's drop
let entryRect = null;             // the gate's rect (null on map 1); its bottom edge is the fence's inside face
let arcEntryState = "";           // "" no entry | "open" | "closed"
let arcEntryCloseAt = 0;          // when it is due to close (the flythrough's end)
let arcEntryClosedAt = 0;         // when it actually did (0: built closed)

let arcSpawnDebt = 0;             // HOST: fractional spawns owed
let arcDiedAt = 0;                // this client: when its player bled out

// Seconds PLAYED on this map (zero until its intro ends).
function arcadePlayS(now) {
    // The run's clock STOPS where the run ended (2026-10-12: "stop timer on game
    // loss"): a lost run at runEndAt, a won one at winSeqAt. Everything that
    // reads played time (the HUD, both cards, the cabinet) goes through here.
    if (gameOver && runEndAt) now = Math.min(now, runEndAt);
    else if (won && winSeqAt) now = Math.min(now, winSeqAt);
    return startTime ? Math.max(0, (now - startTime) / 1000) : 0;
}

// How fast the curve's clock runs against the played clock on THIS map
// (2026-10-11). 1 on maps 1 and 2, so they are untouched. On the hard maps it
// is the row's `pace` times the difficulty: the bot sweep found maps 3 and 4
// are bound by the TIMELINE (a bot dies at ~3 minutes whatever the tanks cost,
// when the wave level's HP and brutes catch up), so how slowly the curve
// advances once you are IN the map is what makes them winnable, more than
// where they start.
function arcPace() {
    const L = ARENA_LAYOUTS[arcLevelNo];
    if (!L || !L.pace || !arcHardMap()) return 1;
    return Math.max(0.2, L.pace * arcDifficulty);
}

// The curve's clock, T: seconds played plus this map's head start. The head
// start is read LIVE from the difficulty (arcClockOffsetS), which is what lets
// the dev panel's slider move the spawn and level curve mid-run.
function arcadeElapsedS(now) {
    return startTime ? arcadePlayS(now) * arcPace() + arcClockOffsetS() : 0;
}

// "3:12": the one way a run's time is written, on the win card, the down
// card and the readout (2026-10-08: "getting downed should also read out
// time similar to end game").
// The run's time across BOTH maps: map 1's seconds plus map 2's, without the
// 60s head start its clock is offset by (that offset sets the swarm, not the
// run time). Cards and the cabinet read this; the wave reads arcadeElapsedS.
function arcadeRunSeconds(now) {
    return arcLevelNo >= 2 ? arcL1Seconds + arcadePlayS(now) : arcadePlayS(now);
}

function arcadeClock(now) {
    const t = Math.floor(arcadeRunSeconds(now));
    return Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0");
}

function arcadeLevel(now) {
    return 1 + Math.floor(arcadeElapsedS(now) / ARC_LEVEL_S);
}

// BREATHING ROOM WITHOUT ROUNDS (2026-10-11, all three accepted):
//   TIDE  the rate swells and ebbs +-35% on a 28s cycle over the exponential,
//         so the overwhelm still lands at ~4:00 with air inside it.
//   LULL  x0.4 for 8s after a tank fills and when the gate starts opening.
//   EASE  a fast clear (5 kills in 3s) pushes the spawn debt negative, so a
//         good clear buys a gap rather than the same pressure.
const ARC_TIDE_AMP = 0.35;
const ARC_TIDE_S = 28;
const ARC_LULL_MS = 8000;
const ARC_LULL_MULT = 0.4;
const ARC_EASE_KILLS = 5;
const ARC_EASE_WINDOW_MS = 3000;
const ARC_EASE_DEBT = 3;
let arcLullUntil = 0;             // HOST
let arcKillTimes = [];            // HOST: recent kill times
let arcEaseAt = 0;                // HOST: last ease, so it cannot chain
let arcWasFull = [false, false, false];

// THE BOSS WAVE (map 4). No tide, no lull, no ease: a CONSTANT horde of
// walkers and runners (BOSS_HORDE_RATE a second, solo, scaled by team size,
// held at the alive cap) and a SUPER SPLITTER every BOSS_SPLIT_EVERY_MS up to
// BOSS_SPLIT_MAX alive (+1 per extra player). Nothing else spawns. HP and
// speed still read the clock (map 4's head start is 240s). Its arrival lull
// is the same one every map gets.
const BOSS_HORDE_RATE = 6.5;
const BOSS_SPLIT_EVERY_MS = 7000;
const BOSS_SPLIT_MAX = 3;
const BOSS_HAZARD_CHANCE = 0.1;   // x3.3 the normal 3%: "increased negative drops"
const BOSS_HAZARD_MAX = 8;
const BOSS_SPAWNLING_MULT = 2;    // spawnlings come at this many times the RUNNER rate
let arcBossDebt = 0;
let arcBossSpawnDebt = 0;
let arcBossSplitAt = 0;

function arcadeBossWave(now, dt, cap, level) {
    const ramp = arcadeL2Ramp(now);
    arcBossDebt = Math.min(arcBossDebt + BOSS_HORDE_RATE * (0.6 + 0.4 * teamSize()) * ramp * arcDiffRate() * dt / 1000, 30);
    while (arcBossDebt >= 1) {
        if (zombies.length >= cap) { arcBossDebt = Math.min(arcBossDebt, 1); break; }
        arcBossDebt -= 1;
        const type = Math.random() < 0.3 ? "runner" : "walker";
        const at = arcadeSpawnPoint(ZOMBIE_TYPES[type].size);
        spawnZombieAt(type, level, at.x, at.y);
    }
    // SPAWNLINGS, straight from the horde (2026-10-12: "allow for spawning
    // spawns which spawn at 2x the runner rate"). Runners are 30% of the
    // horde, so this is 60% of its rate again, as its own stream: the
    // walkers and runners above are untouched. Same cap, same ramp.
    arcBossSpawnDebt = Math.min(arcBossSpawnDebt + BOSS_HORDE_RATE * 0.3 * BOSS_SPAWNLING_MULT *
                                (0.6 + 0.4 * teamSize()) * ramp * arcDiffRate() * dt / 1000, 30);
    while (arcBossSpawnDebt >= 1) {
        if (zombies.length >= cap) { arcBossSpawnDebt = Math.min(arcBossSpawnDebt, 1); break; }
        arcBossSpawnDebt -= 1;
        const at = arcadeSpawnPoint(ZOMBIE_TYPES.spawnling.size);
        spawnZombieAt("spawnling", level, at.x, at.y);
    }
    if (now >= arcBossSplitAt &&
        countZombies("supersplit") < BOSS_SPLIT_MAX + teamSize() - 1 + Math.round((arcDifficulty - 1) * 2)) {
        arcBossSplitAt = now + BOSS_SPLIT_EVERY_MS / arcDifficulty;
        const at = arcadeSpawnPoint(ZOMBIE_TYPES.supersplit.size);
        const z = spawnZombieAt("supersplit", level, at.x, at.y);
        if (z) hostEvent(SND_ULTRA, z.x, z.y, 0);
    }
}

// Every map after the first: a light lull on arrival, then an ease up onto the curve.
function arcadeL2Ramp(now) {
    if (arcLevelNo < 2 || !arcL2StartAt) return 1;
    const since = now - arcL2StartAt;
    if (since < L2_LULL_MS) return L2_LULL_MULT;
    const k = Math.min(1, (since - L2_LULL_MS) / L2_RAMP_MS);
    return L2_LULL_MULT + (1 - L2_LULL_MULT) * k * k * (3 - 2 * k);
}

function arcadeSpawnRate(t, now) {
    const tide = 1 + ARC_TIDE_AMP * Math.sin(2 * Math.PI * t / ARC_TIDE_S);
    const lull = now < arcLullUntil ? ARC_LULL_MULT : 1;
    return ARC_RATE0 * Math.pow(2, t / ARC_DOUBLE_S) * (0.6 + 0.4 * teamSize()) * tide * lull * arcadeL2Ramp(now) * arcDiffRate();
}

function arcadeAliveCap() {
    return Math.round((ARC_CAP_BASE + ARC_CAP_PER * teamSize()) * arcDiffCap());
}

// ---------------------------------------------------
//   BLACKOUT (2026-10-13)
// ---------------------------------------------------
// Back in the arcade ("add power outage sound, a growing power surge right
// before it, all lights die except flashlight, ambient drops to 10%").
// CADENCE (2026-10-13): one or two outages a run, at random. The marks are
// run-seconds (summed across maps), drawn at the start of the run: the first
// 25-90s in, a second (50%) 60-150s after it. Each lasts BO_OUT_MS.
//
//   SURGE   BO_SURGE_MS: the lights brighten and stutter, the surge sound grows
//   OUTAGE  BO_OUT_MS: every lamp, sun shaft, drop glow and the exit flood is
//           dead; the ambient is BO_AMBIENT (10%) light; flashlights stay
//   RESTORE BO_RESTORE_MS: the power stutters back on, with a power-up sound
//
// The HOST schedules it and sends `bo: [id, ms to outage, ms to end]` (remaining
// durations, never timestamps); every client derives the phase from its own
// clock and plays the two sounds itself, once each per id.
const BO_SURGE_MS = 1800;
const BO_OUT_MS = 15000;
const BO_RESTORE_MS = 900;
const BO_AMBIENT = 0.10;
let boId = 0, boOutAt = 0, boEndAt = 0;
let boMarks = [];                 // HOST: run-seconds still to come
let boSurgePlayed = false, boOutPlayed = false, boUpPlayed = false;

// Clears an event under way (a map change, a restart); the run's marks stay.
function arcadeBlackoutReset() {
    boOutAt = boEndAt = 0;
    boSurgePlayed = boOutPlayed = boUpPlayed = false;
}

// HOST, from arcadeStart: draw this run's outages.
function arcadeBlackoutPlan() {
    boMarks = [25 + Math.random() * 65];
    if (Math.random() < 0.5) boMarks.push(boMarks[0] + 60 + Math.random() * 90);
}

// HOST, from updateArcadeWave (after the intro).
function arcadeBlackoutSchedule(now) {
    if (typeof zDemo !== "undefined" && zDemo) { boOutAt = boEndAt = 0; return; }   // no outages in the attract run
    if (!boMarks.length || boEndAt > now || arcadeRunSeconds(now) < boMarks[0]) return;
    boMarks.shift();
    boId++;
    boSurgePlayed = boOutPlayed = boUpPlayed = false;
    boOutAt = now + BO_SURGE_MS;
    boEndAt = boOutAt + BO_OUT_MS;
}

// Guest, from a world snapshot.
function arcadeBlackoutApply(bo, now) {
    if (!Array.isArray(bo) || bo.length < 3) return;
    if (bo[0] !== boId) { boId = bo[0]; boSurgePlayed = boOutPlayed = boUpPlayed = false; }
    boOutAt = now + bo[1];
    boEndAt = now + bo[2];
}

function arcadeBlackoutWire(now) {
    return (boEndAt > now) ? [boId, Math.round(boOutAt - now), Math.round(boEndAt - now)] : 0;
}

// 0 none, 1 surge, 2 outage, 3 restoring.
function arcadeBlackoutPhase(now) {
    if (typeof zDemo !== "undefined" && zDemo) return 0;
    if (!boEndAt || now >= boEndAt) return 0;
    if (now < boOutAt - BO_SURGE_MS) return 0;
    if (now < boOutAt) return 1;
    if (now < boEndAt - BO_RESTORE_MS) return 2;
    return 3;
}

// Every client, every frame from the lighting pass: the two sounds, once.
// A client that arrives mid-event does not get a late surge or a late click.
function arcadeBlackoutSounds(now) {
    if (typeof zDemo !== "undefined" && zDemo) { boOutAt = boEndAt = 0; return; }   // no outages in the attract run
    if (!boEndAt) return;
    const surgeAt = boOutAt - BO_SURGE_MS;
    if (!boSurgePlayed && now >= surgeAt) {
        boSurgePlayed = true;
        if (now - surgeAt < 500 && typeof sndPowerSurge === "function") sndPowerSurge(BO_SURGE_MS);
    }
    if (!boOutPlayed && now >= boOutAt) {
        boOutPlayed = true;
        if (now - boOutAt < 500 && typeof sndPowerOut === "function") sndPowerOut();
    }
    const upAt = boEndAt - BO_RESTORE_MS;
    if (!boUpPlayed && now >= upAt) {
        boUpPlayed = true;
        if (now - upAt < 500 && typeof sndPowerUp === "function") sndPowerUp(BO_RESTORE_MS);
    }
}

// HOST, from startGame(): the chain begins where the arcade begins.
function arcadeStart(now) {
    arcadeBlackoutReset();
    arcadeBlackoutPlan();
    arcTrays = [];
    arcSpawnDebt = 0;
    arcDiedAt = 0;
    arcDropSeq = 0;
    arcHitState = {};
    // The run's clock starts when the intro ends (arcadeBeginIntro).
    startTime = now + arcIntroMs();
    arcKillsSinceDrop = 0;
    arcLullUntil = 0;
    arcKillTimes = [];
    arcEaseAt = 0;
    arcWasFull = [false, false, false];
    arcTurrets = [];
    freezeZone = null;
    boomBolts = [];
    boomLocal = [];
    generatorOn = true;
    genTripped = false;
    gateStage = GATE_STAGES;
    funnelActive[0] = true;
    if (sluiceGate) sluiceGate.open = true;
    rebuildSolidIndex();
    round = 1;
    roundPhase = "active";
    if (arcLevelNo <= 1) arcadePlaceTrays(now);
}

// HOST. Replaces the round flow in update(): no budget, no breather.
function updateArcadeWave(now, dt) {
    if (now < startTime || arcadeIntroActive(now)) { roundPhase = "active"; return; }   // the intro
    const t = arcadeElapsedS(now);
    const level = arcadeLevel(now);
    if (level !== round) {
        round = level;
        // Only the special waves get a card; a plain level change every 12s
        // would put a banner on screen for a third of the run.
        if (isHordeRound(level) || isBruteRound(level)) {
            roundCardUntil = now + 1800;
        }
    }
    roundPhase = "active";
    arcadeBlackoutSchedule(now);

    const cap = arcadeAliveCap();
    if (arcLevelNo >= ARC_MAX_LEVEL) { arcadeBossWave(now, dt, cap, level); return; }
    for (let i = 0; i < funnels.length; i++) {
        const full = siloFill[i] >= siloCapacity(i);
        if (full && !arcWasFull[i]) arcLullUntil = now + ARC_LULL_MS;     // a tank filled
        arcWasFull[i] = full;
    }
    arcSpawnDebt = Math.min(arcSpawnDebt + arcadeSpawnRate(t, now) * dt / 1000, 30);
    while (arcSpawnDebt >= 1) {
        if (zombies.length >= cap) { arcSpawnDebt = Math.min(arcSpawnDebt, 1); break; }
        arcSpawnDebt -= 1;
        let type = pickZombieType(level);
        if (type === "supersplit" && countZombies("supersplit") >= ultraCap(level)) type = "brute";
        const spec = ZOMBIE_TYPES[type] || ZOMBIE_TYPES.walker;
        const at = arcadeSpawnPoint(spec.size);
        const z = spawnZombieAt(type, level, at.x, at.y);
        if (z && type === "supersplit") hostEvent(SND_ULTRA, z.x, z.y, 0);
    }
}

// On a ring just off-screen around a random living player. The walled map
// spawned in COLD sectors so nothing appeared behind you in ground you had
// just looked at; an open arena swarm wants the opposite -- pressure from
// every side, all the time. Falls back to the old placement.
function arcadeSpawnPoint(size) {
    const targets = livingTargets();
    if (!targets.length) return { x: ARENA.x + 40, y: ARENA.y + 40 };
    const anchor = targets[Math.floor(Math.random() * targets.length)];
    // THE GRASS: some of the swarm walks in out of the tall grass at the east
    // and west edges, level with the target they are heading for.
    if (Math.random() < BAND_SPAWN_CHANCE) {
        const e = arcadeBandEdges();
        const west = Math.random() < 0.5;
        const depth = 40 + Math.random() * 280;
        const x = west ? e.west - depth - size : e.east + depth;
        const y = clamp(anchor.y + (Math.random() - 0.5) * 900, ARENA.y + 60, ARENA.y + ARENA.h - 60 - size);
        if (x > 20 && x + size < WORLD_W - 20 && !blockedAt(x, y, size, true)) return { x: x, y: y };
    }
    for (let tries = 0; tries < 14; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = ARC_RING_MIN + Math.random() * (ARC_RING_MAX - ARC_RING_MIN);
        const x = anchor.x + Math.cos(a) * r;
        const y = anchor.y + Math.sin(a) * r;
        if (!inArena(x, y, size)) continue;
        let seen = false;
        for (let i = 0; i < targets.length && !seen; i++) {
            if (Math.abs(x - targets[i].x) < ARC_SEEN_HALF_W &&
                Math.abs(y - targets[i].y) < ARC_SEEN_HALF_H) seen = true;
        }
        if (seen || blockedAt(x, y, size, true)) continue;
        return { x: x, y: y };
    }
    // Nowhere on the ring: somewhere unseen inside the fence, then anywhere
    // inside it. Never the old sector spawner -- it places outside the arena.
    for (let tries = 0; tries < 30; tries++) {
        const x = ARENA.x + 40 + Math.random() * (ARENA.w - 80 - size);
        const y = ARENA.y + 40 + Math.random() * (ARENA.h - 80 - size);
        if (blockedAt(x, y, size, true)) continue;
        let seen = false;
        for (let i = 0; i < targets.length && !seen; i++) {
            if (Math.abs(x - targets[i].x) < ARC_SEEN_HALF_W &&
                Math.abs(y - targets[i].y) < ARC_SEEN_HALF_H) seen = true;
        }
        if (!seen || tries > 20) return { x: x, y: y };
    }
    return { x: ARENA.x + 40, y: ARENA.y + 40 };
}

// ---------------------------------------------------
//   THE WIN: EVERYONE STANDING, AT THE GATE
// ---------------------------------------------------
// The co-op rule the brief asked for ("the game NEEDS to reward cooperative
// play"). One player reaching the gate used to win for the room; now the run
// ends when every player still on their feet is there. A downed teammate is
// a choice -- revive them, or leave them -- and whoever is left behind gets
// no escape bonus (wonAboard, the train's own rule, reused).
// WALK OUT TO WIN (2026-10-04, fourth playtest note: "the win state should
// end with walking out through the bottom after the gate is fully open and
// you are pulled off screen. not just 'you win' as soon as you survive the
// end horde"). Past `arcOutY`, a player is OUT: their own client takes the
// controls and walks them down the tunnel (arcadeExitControl), the camera
// stays inside the arena, and they leave the screen. The run is won when
// every player still on their feet is out -- a downed teammate must be
// revived or left behind (`wonAboard`).
let arcOutY = 0;

function isOut(t) {
    return arcOutY > 0 && t.y > arcOutY;
}

function arcadeUpdateEscape() {
    // A map change is already under way: the screen is going to black, and
    // the swap lands when it gets there.
    if (arcLeaveAt) { arcadeLeaveTick(Date.now()); return; }
    if (won || !escapeOpen() || escapeChainFrac() < 1) return;
    const standing = allTargets().filter(function (t) { return !t.downed; });
    if (!standing.length) return;
    for (let i = 0; i < standing.length; i++) if (!isOut(standing[i])) return;
    wonAboard = standing.map(function (t) { return t.id; });
    // Each exit leads to the next map; the last one's ends the game.
    if (ARENA_LAYOUTS[arcLevelNo + 1]) { arcadeBeginNextLevel(Date.now()); return; }
    triggerWin();
}

// HOST. Everyone is out of the map: the next one starts for everyone.
// (2026-10-12) It used to swap the world in this very frame, which cut from
// the tunnel to the new arena with the camera teleported to its north fence.
// Now it is two steps: LEAVE (the screen goes to black over the last
// ARC_LEAVE_FADE_MS of ARC_LEAVE_MS, the walk-out still playing) and then the
// swap, which lands under full black and fades back in on the new map's
// establishing shot.
function arcadeBeginNextLevel(now) {
    if (!ARENA_LAYOUTS[arcLevelNo + 1] || arcLeaveAt) return;
    arcLeaveAt = now;
    arcLeaveEndAt = now + ARC_LEAVE_MS;
}

// HOST, from arcadeUpdateEscape: the black has arrived, so swap.
function arcadeLeaveTick(now) {
    if (now < arcLeaveEndAt) return;
    arcLeaveAt = 0;
    // Playing seconds so far (this map's clock without its head start), and
    // every tank filled so far.
    const base = arcL1Seconds + arcadePlayS(now);
    // silosFilled() already adds the tanks carried in from earlier maps.
    arcadeEnterLevel(arcLevelNo + 1, now, [base, silosFilled()]);
}

// EVERY client, from the host's call or from a snapshot whose `lv` is ahead
// of this client's. Same seed, so generateLevel() builds the same world with
// the arena for `level`; nothing about the seed has to move.
function arcadeEnterLevel(level, now, l1) {
    arcL1Seconds = (l1 && l1[0]) || 0;
    arcL1Silos = (l1 && l1[1]) || 0;
    // A client that SAW the screen go to black (the host always did) plays the
    // flythrough; one that is only catching up (joined mid-map, missed the
    // leave) just comes up on the map in a short fade, not 7s of no controls
    // in the middle of a fight.
    const cinematic = netIsHost || !netOnline || arcLeaveEndAt > 0;
    arcLeaveAt = 0;
    arcLeaveEndAt = 0;
    arcLevelNo = level;
    arcadeBlackoutReset();
    arcTrays = [];
    generateLevel();
    const intro2 = cinematic ? arcIntroMs() : 0;
    // The chain is given, as at the start of map 1.
    generatorOn = true;
    genTripped = false;
    gateStage = GATE_STAGES;
    funnelActive[0] = true;
    if (sluiceGate) sluiceGate.open = true;
    rebuildSolidIndex();
    // A clean field.
    zombies = [];
    bullets = [];
    remoteBullets = [];
    pickups = [];
    blasts = [];
    decoys = [];
    arcTurrets = [];
    freezeZone = null;
    boomBolts = [];
    boomLocal = [];
    arcHitState = {};
    arcWasFull = new Array(funnels.length).fill(false);
    if (netIsHost || !netOnline) {
        arcSpawnDebt = 0;
        arcKillsSinceDrop = 0;
        arcLullUntil = 0;
        arcKillTimes = [];
        arcL2StartAt = now + intro2;
        // Elapsed reads L2_CLOCK_OFFSET_S when the run-on ends.
        startTime = now + intro2;             // played seconds; the head start is read live
        arcBossDebt = 0;
        arcBossSpawnDebt = 0;
        arcBossSplitAt = now + intro2 + L2_LULL_MS;
        round = 1;
        roundPhase = "active";
    }
    // Your own player: back on its feet at the north fence, kit kept.
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        p.x = WORLD_W / 2 - 8 + (Math.random() - 0.5) * 120;
        // In the tunnel behind the (open) gate for the arrival; just inside the
        // fence if this client is only catching up.
        p.y = (cinematic && entryRect) ? ARENA.y - ARC_ENTRY_SPAWN_BACK : ARENA.y + WALL_T + 30;
        p.facingX = 0;
        p.facingY = 1;
        p.downed = false;
        p.bleedDeadline = 0;
        p.reviveProgress = 0;
        p.exited = false;
        p.keys = { up: false, down: false, left: false, right: false, shoot: false };
        arcadeBoomCarry(p, now);          // the Boomgun's fuel crosses the map change
        p.invulnUntil = now + intro2 + 3000;
    }
    if (cinematic) {
        // The flythrough's first frame is the camera's to place; the screen is
        // black (the leave) and fades up from it, so nothing is seen to move.
        arcadeBeginIntro(now, intro2, ARC_FADE_IN_MS);
        arcadeEntryOpen(arcIntroAt + arcIntroLen);
    } else {
        arcIntroAt = 0;
        const me = players[0] ? { x: players[0].x + 8, y: players[0].y + 8 }
                              : { x: WORLD_W / 2, y: ARENA.y + 300 };
        const s = arcadeNormalScale();
        const c = clampCameraCentre(me.x, me.y, s);
        camera.x = c.x; camera.y = c.y; camera.scale = s; camera.shake = 0;
        arcadeFadeIn(now, ARC_FADE_IN_MS);
        if (typeof showToast === "function") {
            showToast((level >= ARC_MAX_LEVEL ? "FINAL SECTOR" : "SECTOR " + level) + " — " + funnels.length + " TANKS", 2400);
        }
    }
}

// Your players run south onto the map while the intro holds the controls.
// Only the LAST ARC_RUNON_MS of a map's flythrough: the camera is busy
// showing the tanks until then, and you arrive as it comes back to you.
function arcadeRunOn(now) {
    if (arcLevelNo < 2) return;
    const left = arcIntroAt + arcIntroLen - (now || Date.now());
    if (left > ARC_RUNON_MS) return;
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        p.facingX = 0;
        p.facingY = 1;
        moveWithCollisions(p, 0, PLAYER_SPEED, true, false);
    }
}

// Every client, for its own player, from updatePlayers: once out, keep
// walking -- down the middle of the tunnel and off the bottom of the screen.
function arcadeExitControl(p, now) {
    if (!p.exited && isOut(p) && escapeOpen()) p.exited = true;
    if (!p.exited) return false;
    const mid = escapeRect ? escapeRect.x + escapeRect.w / 2 - p.size / 2 : p.x;
    p.keys = { up: false, down: true, left: p.x > mid + 3, right: p.x < mid - 3, shoot: false };
    p.invulnUntil = now + 60000;
    return true;
}

// How many standing players are out, for the HUD line.
function arcadeAtGate() {
    let at = 0, of = 0;
    const all = allTargets();
    for (let i = 0; i < all.length; i++) {
        if (all[i].downed) continue;
        of++;
        if (isOut(all[i])) at++;
    }
    return { at: at, of: of };
}

// The third tank: no train, no flood -- the wave is already a flood.
function arcadeOpenGate() {
    escapeAt = Date.now() + ESCAPE_OPEN_MS;
    arcLullUntil = Date.now() + ARC_LULL_MS;
    hostEvent(SND_SIREN, escapeRect ? escapeRect.x : WORLD_W / 2, escapeRect ? escapeRect.y : WORLD_H);
    if (typeof showToast === "function") {
        showToast("THE GATE IS OPENING — " + Math.round(ESCAPE_OPEN_MS / 1000) + "s — EVERYONE GETS OUT TOGETHER", 3600);
    }
}

// ---------------------------------------------------
//   RESPAWN
// ---------------------------------------------------
// There is no breather any more for the old "back at the end of the round"
// rule to wait for. 15s, then beside whoever is standing -- a teammate who
// keeps you alive brings you back into the fight, not to the far side of
// the map.
function arcadeRespawnDue(now) {
    if (!arcDiedAt) arcDiedAt = now;
    return now - arcDiedAt >= ARC_RESPAWN_MS;
}

function arcadeRespawnLeftS(now) {
    return arcDiedAt ? Math.max(0, Math.ceil((ARC_RESPAWN_MS - (now - arcDiedAt)) / 1000)) : 0;
}

function arcadePlaceRespawn(p, now) {
    arcDiedAt = 0;
    const buddy = standingTeammate();
    if (!buddy) return;
    const spot = spotBeside(buddy);
    if (spot) { p.x = spot.x; p.y = spot.y; }
    p.invulnUntil = now + 3000;
}

// ---------------------------------------------------
//   DROPS
// ---------------------------------------------------
// Replaces wall-buys, perk stations, ammo crates and traps. Everything is
// the same size -- 24px, 1.5x a player; the wall-buys were 110x28, "awkwardly
// large at 4x+ the player's size".
//
// ONE PICKUP IN TOTAL. A drop goes to whoever takes it, and only them. That
// is what makes a drop a callout ("shotgun by the silo -- who wants it?")
// instead of a race, so it is decided by the HOST through the same seam a
// purchase uses: two players on the same frame produce one taker.
//
// AUTO-PICKUP (2026-10-04, second playtest note: "auto-pick up to make
// things easier in this rushed gameplay"). Everything is taken by walking
// over it -- the F press for guns and perks is gone. What keeps it a team
// decision is still the ONE taker: run over it and it is yours, so call it
// before you do. A perk you have no slot for is NOT taken; it stays on the
// ground for someone who can use it.
const DROP_SIZE = 24;
// PERKS ARE BIGGER (2026-10-13, "increase perk pick up size so they are more
// discernable"): the 24px frame fits the icon at 2x; 40px fits it at 3x.
const PERK_DROP_SIZE = 30;      // 40 until 2026-10-13 later ("25% smaller")
function dropSizeFor(type) { return type === "perk" ? PERK_DROP_SIZE : DROP_SIZE; }
const DROP_LIFE_MS = 25000;
const DROP_BLINK_MS = 5000;       // blinks for its last 5s
const DROP_MAX_LIVE = 10;
const DROP_CHANCE = 0.094;        // +25% twice (2026-10-04, 2026-10-07): 0.06 -> 0.075 -> 0.094
const DROP_PITY_KILLS = 16;       // never longer than this between drops (25 -> 20 -> 16)
// ATTRACT (2026-10-07), reworked 2026-10-17: "show these as having an
// acceleration towards the player based on the level of stacks, so that the
// perks are only picked up when they actually collide with the player."
// A drop inside your pull slides toward you, faster the closer it gets and
// the more stacks you hold, and is taken only when it touches you.
// ~~ATTRACT_REACH (take from 50..220px away)~~ is gone.
// 2026-10-17: "about 25% too powerful" -- range and speed both x0.8.
const ATTRACT_PULL = [0, 96, 136, 172, 204, 232, 256];   // pull radius per stack, to x6
const ATTRACT_V0 = 48, ATTRACT_V_STACK = 24;             // px/s at the edge of the pull
const ATTRACT_SURGE = 3;                                 // x(1 + 3) by the time it reaches you
const DROP_FUEL = 4;              // FUEL: kills added to the live tank
const SHOCK_RADIUS = 300;
const OVERCLOCK_MS = 6000;

// Weighted. FUEL only rolls while a tank is filling.
const DROP_WEIGHTS = [
    ["gun", 30], ["perk", 24], ["ammo", 18], ["overclock", 8],
    ["rally", 7], ["fuel", 7], ["shock", 6], ["freeze", 6], ["turret", 6], ["boomgun", 4]
];
// The perks that still mean something here. CONDUCTOR made traps cheaper
// and SCAVENGER made scrap; there are no traps, and nothing to spend.
// DECOY is out with the ping it hung off (2026-10-07); ATTRACT is in.
const DROP_PERKS = ["overdrive", "ricochet", "attract", "spite", "arc", "blastcap",
                    "skewer", "laststand", "salvage", "seeker"];
// By level: an early drop is a step up from the pistol, a late one is the
// heavy kit. [minLevel, key, weight].
const DROP_GUNS = [
    [1, "rifle", 4], [1, "shotgun", 4], [1, "smg", 3],
    [5, "sniper", 2], [7, "flamer", 2], [9, "rocket", 2]
];
// NEGATIVE DROPS (2026-10-11, "add negative drops to not pick up, like slowing
// or other things"). They ride the same drop rows and the same one-taker
// path as the good ones; what differs is that nobody wants them. Rolled
// SEPARATELY from the good drops, so "drop rates are good" is untouched: a
// hazard is extra clutter on the floor, not a share taken from a gun or perk.
//   MUD   the taker is slowed
//   FLARE the taker is the bait: a ring of zombies lands round them
//   JAM   the taker's gun will not fire
// ATTRACT never pulls them in: you have to actually step on one.
const HAZARD_CHANCE = 0.03;       // per kill: about one every 33 kills
const HAZARD_MAX_LIVE = 3;
const HAZARD_LIFE_MS = 20000;
const MUD_MS = 5000;
const MUD_SPEED = 0.5;
const JAM_MS = 2500;
const FLARE_COUNT = 7;
const DROP_HAZARD = { mud: true, flare: true, jam: true };
const HAZARD_KINDS = ["mud", "flare", "jam"];
const DROP_TEAM = { ammo: true, overclock: true, rally: true, fuel: true, shock: true, freeze: true };
const DROP_NAME = { ammo: "AMMO — WHOLE TEAM", overclock: "OVERCLOCK — WHOLE TEAM",
                    rally: "RALLY — WHOLE TEAM UP", fuel: "FUEL +" + DROP_FUEL,
                    shock: "SHOCKWAVE", freeze: "FREEZE — WHOLE TEAM", turret: "TURRET — CLICK TO PLACE", boomgun: "BOOMGUN — 15s",
                    mud: "MUD — DON'T STEP", flare: "FLARE — DON'T STEP", jam: "JAM — DON'T STEP" };

let arcDropSeq = 0;
let arcKillsSinceDrop = 0;
let arcTakeAskedAt = {};          // this client: drop id -> when it last asked

function pickWeighted(rows, w) {
    let total = 0;
    for (let i = 0; i < rows.length; i++) total += rows[i][w];
    let r = Math.random() * total;
    for (let i = 0; i < rows.length; i++) {
        r -= rows[i][w];
        if (r <= 0) return rows[i];
    }
    return rows[rows.length - 1];
}

function fillingTank() {
    for (let i = 0; i < funnelActive.length; i++) {
        if (funnelActive[i] && siloFill[i] < siloCapacity(i)) return i;
    }
    return -1;
}

// HOST, from damageZombie on every kill.
function hazardsLive() {
    let n = 0;
    for (let i = 0; i < pickups.length; i++) if (DROP_HAZARD[pickups[i].type]) n++;
    return n;
}

// DROPS DO NOT OVERLAP (2026-10-12: "they become hard to read and sometimes
// bad drops are under good drops"). A drop lands at the nearest spot, walking
// outward in rings, that keeps DROP_APART from every drop already standing;
// when the ground round it is full there is no drop.
const DROP_APART = 52;            // centre to centre: a 24px drop and a gap you can read
function arcadeDropSpot(x, y) {
    const lo = [ARENA.x + 30, ARENA.y + 30];
    const hi = [ARENA.x + ARENA.w - DROP_SIZE - 30, ARENA.y + ARENA.h - DROP_SIZE - 30];
    for (let ring = 0; ring <= 6; ring++) {
        const n = ring ? ring * 6 : 1;
        for (let k = 0; k < n; k++) {
            const a = (k / n) * Math.PI * 2 + ring * 0.7;
            const px = clamp(x - DROP_SIZE / 2 + Math.cos(a) * ring * DROP_APART, lo[0], hi[0]);
            const py = clamp(y - DROP_SIZE / 2 + Math.sin(a) * ring * DROP_APART, lo[1], hi[1]);
            let free = true;
            for (let i = 0; i < pickups.length && free; i++) {
                if (Math.hypot(pickups[i].x - px, pickups[i].y - py) < DROP_APART) free = false;
            }
            if (free) return { x: Math.round(px), y: Math.round(py) };
        }
    }
    return null;
}

function arcadeMaybeDrop(x, y, now) {
    arcKillsSinceDrop++;
    // EASE: a fast clear buys a gap.
    arcKillTimes.push(now);
    while (arcKillTimes.length && now - arcKillTimes[0] > ARC_EASE_WINDOW_MS) arcKillTimes.shift();
    if (arcKillTimes.length >= ARC_EASE_KILLS && now - arcEaseAt > ARC_EASE_WINDOW_MS) {
        arcEaseAt = now;
        arcKillTimes.length = 0;
        arcSpawnDebt -= ARC_EASE_DEBT;
    }
    const boss = arcLevelNo >= ARC_MAX_LEVEL;
    if (hazardsLive() < (boss ? BOSS_HAZARD_MAX : HAZARD_MAX_LIVE) &&
        Math.random() < (boss ? BOSS_HAZARD_CHANCE : HAZARD_CHANCE)) {
        const hs = arcadeDropSpot(x, y);
        if (hs) {
            pickups.push({
                id: ++arcDropSeq, x: hs.x, y: hs.y,
                size: DROP_SIZE, type: HAZARD_KINDS[Math.floor(Math.random() * HAZARD_KINDS.length)],
                item: "", until: now + HAZARD_LIFE_MS
            });
        }
    }
    // Hazards do not count against the cap on the good ones.
    if (pickups.length - hazardsLive() >= DROP_MAX_LIVE) return;
    if (arcKillsSinceDrop < DROP_PITY_KILLS && Math.random() > DROP_CHANCE) return;
    const spot = arcadeDropSpot(x, y);
    if (!spot) return;                 // no room: the pity counter keeps its count, so the next kill tries again
    arcKillsSinceDrop = 0;

    const rows = DROP_WEIGHTS.filter(function (r) { return r[0] !== "fuel" || fillingTank() >= 0; });
    const type = pickWeighted(rows, 1)[0];
    let item = "";
    if (type === "gun") {
        const lvl = arcadeLevel(now);
        item = pickWeighted(DROP_GUNS.filter(function (g) { return lvl >= g[0]; }), 2)[1];
    } else if (type === "perk") {
        item = DROP_PERKS[Math.floor(Math.random() * DROP_PERKS.length)];
    }
    pickups.push({
        id: ++arcDropSeq, x: spot.x, y: spot.y,
        size: dropSizeFor(type), type: type, item: item, until: now + DROP_LIFE_MS
    });
}

// ---------------------------------------------------
//   THE START TRAYS (2026-10-13)
// ---------------------------------------------------
// "At beginning of game drop 1 perk per player below players on concrete trays
// at the start of the road that are shaped for the perks." A row of concrete
// trays just south of the spawn, one per player, each carrying a different
// perk that does not expire (until 0) and each with a recess shaped like its
// perk, so an emptied tray still says what stood there. The HOST picks them
// and sends `tr` [x, y, CARD_KEYS index]; the perk itself is an ordinary drop,
// so the one-taker path and the 4-slot refusal apply unchanged.
const TRAY_SIZE = 56;
const TRAY_GAP = 72;
const TRAY_SLOTS = 8;             // the pedestal has room for eight players
let arcTrays = [];                // [{x, y, item}] centres (occupied slots only)

// THE START (2026-10-13): map 1 opens on a pedestal flush under the warehouse,
// eight perk trays below it, a spawn strip below those, and a fountain south of
// that with the road looping round it as a roundabout. All of it is a fixed
// offset from the world centre (the warehouse stands at the same place on
// every seed), so every client agrees without any message.
const START_PED_TOP = -190;       // pedestal top, from the world centre's y (the warehouse's south face is at -230)
const START_PED_FP = 40;          // its footprint depth; 20 more is drawn lift
const START_PED_LIFT = 20;
const START_PED_HALF_W = 312;
const START_SPAWN_DY = START_PED_TOP + 12;   // players appear ON the pedestal
const FOUNTAIN_DY = 170;          // fountain centre, below the world centre
const FOUNTAIN_HALF = 48;         // its solid body is 96px square
const ROUNDABOUT_R = 110;         // road centre line round it
function arcadeHasStart() { return ZOMBIE_ARCADE && arcLevelNo <= 1; }
function arcadeStartTrayY() { return WORLD_H / 2 + START_PED_TOP + START_PED_FP + START_PED_LIFT + 46; }
function arcadeTraySlot(i) { return { x: Math.round(WORLD_W / 2 + (i - (TRAY_SLOTS - 1) / 2) * TRAY_GAP), y: Math.round(arcadeStartTrayY()) }; }
function arcadeRoundaboutPts(cx, fy) {
    const pts = [];
    for (let k = 0; k <= 48; k++) {
        const a = Math.PI / 2 + (k / 48) * Math.PI * 2;      // from the south, all the way round
        pts.push([Math.round(cx + Math.cos(a) * ROUNDABOUT_R), Math.round(fy + Math.sin(a) * ROUNDABOUT_R)]);
    }
    return pts;
}

// HOST, from arcadeStart on map 1.
function arcadePlaceTrays(now) {
    arcTrays = [];
    const n = Math.max(1, Math.min(TRAY_SLOTS, teamSize()));
    const pool = DROP_PERKS.slice();
    const first = Math.floor((TRAY_SLOTS - n) / 2);          // centred on the pedestal
    for (let i = 0; i < n && pool.length; i++) {
        const item = pool.splice(Math.floor(Math.random() * pool.length), 1)[0];
        const slot = arcadeTraySlot(first + i), x = slot.x, y = slot.y;
        arcTrays.push({ x: x, y: y, item: item });
        pickups.push({ id: ++arcDropSeq, x: x - PERK_DROP_SIZE / 2, y: y - PERK_DROP_SIZE / 2,
                       size: PERK_DROP_SIZE, type: "perk", item: item, until: 0 });
    }
}

// HOST, every step: drops that nobody took go away.
function arcadeExpireDrops(now) {
    for (let i = pickups.length - 1; i >= 0; i--) {
        if (pickups[i].until && now >= pickups[i].until) pickups.splice(i, 1);
    }
}

function dropById(id) {
    for (let i = 0; i < pickups.length; i++) if (pickups[i].id === id) return pickups[i];
    return null;
}

function dropTouching(p, pad) {
    for (let i = 0; i < pickups.length; i++) {
        const d = pickups[i];
        if (rectIntersect(p.x - pad, p.y - pad, p.size + pad * 2, p.size + pad * 2, d.x, d.y, d.size, d.size)) return d;
    }
    return null;
}

// Why THIS player cannot take THIS drop, or "" if they can. One answer for
// the host's check and the prompt, so the prompt never promises what the
// host will refuse.
function dropRefusal(cards, d) {
    if (d.type !== "perk") return "";
    const lvl = cards.filter(function (k) { return k === d.item; }).length;
    if (lvl >= CARD_MAX_STACK) return "MAXED";
    if (lvl === 0 && distinctCardCount(cards) >= CARD_SLOTS) return "SLOTS FULL";
    return "";
}

// EVERY client, every step: ATTRACT pulls drops toward whoever holds it.
// The speed is a function of distance and stacks only -- no velocity is
// stored -- so the host (whose positions ride the snapshot) and a guest
// (predicting between snapshots) move a drop the same way. It accelerates
// as it closes: v = (V0 + V_STACK * stacks) * (1 + SURGE * closeness^2).
// A drop only moves toward someone who could take it, and never a hazard.
function arcadeMagnetDrops(dt) {
    const pulls = [];
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        const lv = p && !p.downed ? cardLevel(p, "attract") : 0;
        if (lv) pulls.push({ x: p.x + p.size / 2, y: p.y + p.size / 2, lv: lv, cards: p.cards || [], turret: !!p.turretHeld });
    }
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        if (!r || r.away || r.downed || !r.cards) continue;
        const lv = r.cards.filter(function (k) { return k === "attract"; }).length;
        if (lv) pulls.push({ x: r.x + (r.size || 16) / 2, y: r.y + (r.size || 16) / 2, lv: lv, cards: r.cards, turret: false });
    }
    if (!pulls.length) return;
    const s = Math.min(0.05, dt / 1000);
    for (let i = 0; i < pickups.length; i++) {
        const d = pickups[i];
        if (!d.id || DROP_HAZARD[d.type]) continue;
        const cx = d.x + d.size / 2, cy = d.y + d.size / 2;
        let best = null, bd = Infinity;
        for (let k = 0; k < pulls.length; k++) {
            const a = pulls[k], dist = Math.hypot(a.x - cx, a.y - cy), reach = ATTRACT_PULL[a.lv] || 0;
            if (dist > reach || dist >= bd) continue;
            if (dropRefusal(a.cards, d) || (d.type === "turret" && a.turret)) continue;
            best = a; bd = dist;
        }
        if (!best || bd < 2) continue;
        const close = 1 - bd / (ATTRACT_PULL[best.lv] || 1);
        const v = (ATTRACT_V0 + ATTRACT_V_STACK * best.lv) * (1 + ATTRACT_SURGE * close * close);
        const step = Math.min(bd, v * s);
        d.x += (best.x - cx) / bd * step;
        d.y += (best.y - cy) / bd * step;
    }
}

// Every client, for its own player: a drop is taken when it TOUCHES you
// (ATTRACT brings it to you; it no longer reaches out for it).
function arcadeWalkOverDrops(p, now) {
    if (p.downed) return;
    const d = dropTouching(p, 0);
    if (!d || dropRefusal(p.cards || [], d)) return;
    // One turret in hand at a time; a second stays for a teammate.
    if (d.type === "turret" && p.turretHeld) return;
    if (arcTakeAskedAt[d.id] && now - arcTakeAskedAt[d.id] < 400) return;
    arcTakeAskedAt[d.id] = now;
    requestBuy("drop", d.id, p);
}

function dropLabel(d) {
    if (d.type === "gun") return (WEAPONS[d.item] ? WEAPONS[d.item].name : "GUN");
    if (d.type === "perk") return (CARDS[d.item] ? CARDS[d.item].name : "PERK");
    return DROP_NAME[d.type] || d.type.toUpperCase();
}

// Only one thing left to say: a drop you are standing on and cannot take.
function arcadeDropPrompt(p) {
    const d = dropTouching(p, 14);
    if (!d) return "";
    const no = dropRefusal(p.cards || [], d) || (d.type === "turret" && p.turretHeld ? "TURRET HELD" : "");
    return no ? dropLabel(d) + " — " + no : "";
}

// HOST, from hostHandleBuy. Returns false to refuse.
function arcadeHostTake(msg) {
    const d = dropById(msg.i);
    if (!d) return false;
    if (dropRefusal(cardsFor(msg.id) || [], d)) return false;
    pickups.splice(pickups.indexOf(d), 1);
    msg.t = d.type;
    msg.it = d.item;
    msg.x = d.x;
    msg.y = d.y;
    // The world-changing team drops are decided here, once, by the host.
    if (d.type === "fuel") {
        const i = fillingTank();
        if (i >= 0) {
            for (let k = 0; k < DROP_FUEL && siloFill[i] < siloCapacity(i); k++) {
                creditFunnelKill(funnels[i].x, funnels[i].y);
            }
        }
    } else if (d.type === "shock") {
        const taker = allTargets().filter(function (t) { return t.id === msg.id; })[0];
        if (taker) arcadeShockwave(taker.x + taker.size / 2, taker.y + taker.size / 2, Date.now());
    } else if (d.type === "freeze") {
        const taker = allTargets().filter(function (t) { return t.id === msg.id; })[0];
        if (taker) arcadeFreeze(taker.x + taker.size / 2, taker.y + taker.size / 2, Date.now());
    } else if (d.type === "flare") {
        const taker = allTargets().filter(function (t) { return t.id === msg.id; })[0];
        if (taker) arcadeFlare(taker.x + taker.size / 2, taker.y + taker.size / 2, Date.now());
    }
    return true;
}

// ---------------------------------------------------
//   FREEZE, THE TANK PULSE, TURRETS (2026-10-11)
// ---------------------------------------------------
// FREEZE (a team drop): everything within FREEZE_R of the taker is held for
// FREEZE_MS -- no pathing, no contact. It is crowd control that buys a
// reload and a reposition rather than a kill, and it can still be shot.
// One zone at a time (a new one replaces the old); it rides the snapshot as
// `frz` so guests can draw the ring and tint the held zombies.
const FREEZE_R = 560;
const FREEZE_MS = 4000;
let freezeZone = null;            // {x, y, r, until}

function arcadeFreeze(cx, cy, now) {
    freezeZone = { x: cx, y: cy, r: FREEZE_R, until: now + FREEZE_MS };
    hostEvent(SND_ZAP, cx, cy);
}

function arcadeFrozen(z, now) {
    if (!freezeZone || now >= freezeZone.until) return false;
    return Math.hypot(z.x + z.size / 2 - freezeZone.x, z.y + z.size / 2 - freezeZone.y) <= freezeZone.r;
}

// THE TANK PULSE: throwing a full tank's switch (F at its base) wipes the
// area round it. Removed outright rather than damaged: a SUPER SPLITTER
// would otherwise throw its 20 spawnlings into the very crowd this clears.
const PULSE_R = 620;

function arcadeSiloPulse(i) {
    const s = silos[i];
    if (!s) return;
    arcadePulseAt(s.x + s.w / 2, s.y + s.h, "TANK " + (i + 1) + " PULSE");
}

// The pulse itself: everything within PULSE_R of (cx, cy) removed, with the
// blast and the toast. A tank's switch throws it, and so does a stored RALLY.
function arcadePulseAt(cx, cy, label) {
    for (let k = zombies.length - 1; k >= 0; k--) {
        const z = zombies[k];
        if (Math.hypot(z.x + z.size / 2 - cx, z.y + z.size / 2 - cy) <= PULSE_R) {
            zombies.splice(k, 1);
            kills++;
        }
    }
    hostEvent(SND_EXPLODE, cx, cy, PULSE_R);
    addBlast(cx, cy, PULSE_R);
    addShake(14);
    if (typeof showToast === "function") showToast(label, 2000);
}

// A STORED RALLY (2026-10-12: "allow on single player to 'Store' one rally so
// when fully downed/died you send out a shockwave similar to silo shockwave,
// but you need to grab a new rally to gain this back"). Alone, a RALLY has
// nobody to stand up, so it is kept instead: one slot, `p.rallyStored`. The
// moment you would go down with nobody else on their feet it is spent -- you
// are stood back up with a few seconds untouchable and the swarm round you is
// thrown off the map by the same pulse a full tank gives. Grab another rally
// to have it again.
// Returns true when it caught the fall (the caller does not down the player).
function arcadeStoredRally(target, now) {
    if (!ZOMBIE_ARCADE || !target.local) return false;
    const p = target.ref;
    if (!p || !p.rallyStored) return false;
    const others = allTargets();
    for (let i = 0; i < others.length; i++) {
        if (others[i].id !== target.id && !others[i].downed) return false;
    }
    p.rallyStored = false;
    p.downed = false;
    p.bleedDeadline = 0;
    p.reviveProgress = 0;
    p.invulnUntil = Math.max(p.invulnUntil || 0, now + STORED_RALLY_SAFE_MS);
    p.hurtAt = 0;
    arcadePulseAt(p.x + (p.size || 16) / 2, p.y + (p.size || 16) / 2, "RALLY");
    rallySkulls.push({ x: p.x + (p.size || 16) / 2, y: p.y, born: Date.now() });
    return true;
}
// Pixel skulls rising off a spent stored RALLY (drawn by drawRallySkulls).
var rallySkulls = [];
const STORED_RALLY_SAFE_MS = 3000;

// THE BOOMGUN (2026-10-11): a temporary personal powerup. Taken from a drop,
// it replaces your gun for BOOM_MS: a cannon held out in front of you that
// needs a 1s spin up, never runs dry, and fires faster the longer the trigger
// is held (up to a limit). Each shot is two things: a small shockwave that
// throws close zombies back, and a BOLT -- a long, thick, glowing orange line
// that travels like a bullet, stops at walls, and WIPES a wide strip round its
// path as it goes, whether or not it touches anything head-on. It kicks the
// screen.
//
// (Until 2026-10-11 later the shot was an instant beam. The user asked for
// "a long line of glowing orange thick that behaves as a bullet".)
//
// The HOST owns the bolts (a guest sends `boom`), so kills are credited and
// the ARC / BLASTCAP procs work. They ride the snapshot as `bb`, and guests
// dead-reckon them between snapshots; a guest draws its OWN shot from a local
// prediction and skips the host's copy.
const BOOM_MS = 15000;
const BOOM_SPIN_MS = 1000;        // trigger held this long before the first shot
const BOOM_RAMP_MS = 5000;        // ...and this much longer to reach full rate
const BOOM_CD_MAX = 520;          // ms between shots just after spin-up
const BOOM_CD_MIN = 130;          // ...and at full spin
const BOOM_RANGE = 980;
const BOOM_SPEED = 28;            // px a step: ~1,700px/s, so a screen in under half a second
const BOOM_HALF_W = 30;           // the wipe strip, either side of the bolt's path
const BOOM_DMG = 120;
const BOOM_PUSH_R = 150;
const BOOM_MUZZLE = 46;           // where the bolt starts: out past the cannon's tip (it ends at ~43)
// The drawn bolt is 1/5 of what it was (user, 2026-10-11: "about 1/5 the current
// boomgun bullet size"): 112px long and 34/20/9 thick became ~24 and 7/4/2.
const BOOM_DRAW_LEN = 24;         // the glowing line, along the heading, at full length
let boomBolts = [];               // {id, x, y, vx, vy, owner, travelled, hit?} -- host sim / guest dead-reckoned
let boomLocal = [];               // a guest's own predicted bolts (drawn, never damaging)
let boomBoltSeq = 0;

function boomActive(p, now) {
    return !!p && !p.downed && now < (p.boomUntil || 0);
}

// THE BOOMGUN IS A GUN YOU CARRY, AND ITS AMMO IS ITS TIME (2026-10-13: "allow
// for boomgun to be 'unequipped' by switching to another gun. boom gun's ammo
// in effect is its duration. this can stack. ammo should carry across levels").
// Two numbers on the player, both ms of fuel:
//   boomUntil   when it is IN HAND: the deadline (what the renderer, the wire
//               `bm` and boomActive() already read), draining in real time
//   boomStore   what is banked while it is NOT in hand: it does not drain
// Picking one up ADDS BOOM_MS (stacks, up to BOOM_MAX_MS) and equips it.
// Switching to another gun (keys 1-7, the wheel) banks what is left; B or 8
// takes it back out. A map change and a down bank it too, and a map change
// puts it back in your hand when the flythrough ends (boomResume).
const BOOM_MAX_MS = 90000;

function boomFuelMs(p, now) {
    return Math.max(0, (p.boomUntil || 0) - now) + (p.boomStore || 0);
}

function arcadeBoomGrant(p, now) {
    const total = Math.min(BOOM_MAX_MS, boomFuelMs(p, now) + BOOM_MS);
    p.boomStore = 0;
    p.boomUntil = now + total;
    p.boomHeld = 0;
    p.turretArmed = false;
    return total;
}

// Bank what is left and put it away.
function arcadeBoomUnequip(p, now) {
    if (!p) return;
    const left = Math.max(0, (p.boomUntil || 0) - now);
    if (left > 0) p.boomStore = Math.min(BOOM_MAX_MS, (p.boomStore || 0) + left);
    p.boomUntil = 0;
    p.boomHeld = 0;
}

function arcadeBoomEquip(p, now) {
    if (!p || p.downed || !(p.boomStore > 0)) return false;
    p.boomUntil = now + p.boomStore;
    p.boomStore = 0;
    p.boomHeld = 0;
    p.turretArmed = false;
    return true;
}

// B or 8: take it out, or put it away.
function arcadeBoomToggle(p, now) {
    if (!p || p.downed) return;
    if (boomActive(p, now)) arcadeBoomUnequip(p, now);
    else if (arcadeBoomEquip(p, now)) showToast("BOOMGUN — " + Math.ceil(p.boomUntil / 1000 - now / 1000) + "s", 1400);
}

// A map change: bank it now (the flythrough is not fuel), and hand it back
// when the controls come back.
function arcadeBoomCarry(p, now) {
    if (boomActive(p, now)) p.boomResume = true;
    arcadeBoomUnequip(p, now);
}

// Every step, own players only, from updatePlayers.
function arcadeBoomResume(p, now) {
    if (!p.boomResume || arcadeIntroActive(now) || now < arcIntroAt + arcIntroLen) return;
    p.boomResume = false;
    arcadeBoomEquip(p, now);
}

// One step of a bolt. Returns false when it is over (a wall, or its range).
function boomStep(b) {
    b.x += b.vx;
    b.y += b.vy;
    b.travelled += Math.hypot(b.vx, b.vy);
    if (b.travelled >= BOOM_RANGE) return false;
    return !bulletBlockedAt(b.x - 5, b.y - 5, 10);
}

// HOST, every step: advance each bolt and wipe what its path swept.
function arcadeUpdateBoomBolts(now) {
    for (let i = boomBolts.length - 1; i >= 0; i--) {
        const b = boomBolts[i];
        const x0 = b.x, y0 = b.y;
        const alive = boomStep(b);
        const sx = b.x - x0, sy = b.y - y0;
        const sl2 = sx * sx + sy * sy || 1;
        // Everything within BOOM_HALF_W of the segment it just crossed, once.
        // COLLECT FIRST, then damage by object: a kill can take OTHER zombies
        // with it (ARC, BLASTCAP, SPITE), so indices shift under a loop that
        // damages as it goes. (Found by the bot playtest: zombies[k] was
        // undefined and the throw would have frozen a live room.)
        const victims = [];
        for (let k = 0; k < zombies.length; k++) {
            const z = zombies[k];
            if (b.hit.indexOf(z) !== -1) continue;
            const zx = z.x + z.size / 2, zy = z.y + z.size / 2;
            const t = Math.max(0, Math.min(1, ((zx - x0) * sx + (zy - y0) * sy) / sl2));
            if (Math.hypot(zx - (x0 + sx * t), zy - (y0 + sy * t)) > BOOM_HALF_W + z.size / 2) continue;
            victims.push(z);
        }
        for (let v = 0; v < victims.length; v++) {
            b.hit.push(victims[v]);
            const k = zombies.indexOf(victims[v]);
            if (k !== -1) damageZombie(k, BOOM_DMG, b.owner, now, "shot", b.vx, b.vy);
        }
        if (!alive) boomBolts.splice(i, 1);
    }
}

// GUESTS, every step: dead-reckon the host's bolts between snapshots, and run
// this client's own predicted ones.
function arcadeAdvanceBoomBolts() {
    for (let i = boomBolts.length - 1; i >= 0; i--) if (!boomStep(boomBolts[i])) boomBolts.splice(i, 1);
    for (let i = boomLocal.length - 1; i >= 0; i--) if (!boomStep(boomLocal[i])) boomLocal.splice(i, 1);
}

// The cannon's own kick and flash, on every client, when a shot is heard.
function boomKick(x, y) {
    shakeNear(x, y, 9);
}

// HOST. Throws the close ones back, launches the bolt, tells everyone.
function arcadeBoomResolve(owner, ox, oy, dx, dy, now) {
    const dl = Math.hypot(dx, dy) || 1;
    dx /= dl; dy /= dl;
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        const zx = z.x + z.size / 2 - ox, zy = z.y + z.size / 2 - oy;
        const d = Math.hypot(zx, zy);
        if (d >= BOOM_PUSH_R) continue;
        const sp = 8 * (1 - d / BOOM_PUSH_R) + 3;
        z.launchUntil = now + 260;
        z.lvx = (zx / (d || 1)) * sp;
        z.lvy = (zy / (d || 1)) * sp;
    }
    boomBolts.push({ id: ++boomBoltSeq, x: ox + dx * BOOM_MUZZLE, y: oy + dy * BOOM_MUZZLE,
                     vx: dx * BOOM_SPEED, vy: dy * BOOM_SPEED, owner: owner, travelled: 0, hit: [] });
    if (boomBolts.length > 24) boomBolts.shift();
    boomKick(ox, oy);
    hostEvent(SND_BOOM, ox, oy, 0, owner);
}

// Every client, for its own player, every step. Spin-up and ramp live in
// `boomHeld` (ms the trigger has been down): it climbs while held and drains
// fast when released, so a brief let-go keeps most of the spin.
function arcadeBoomTick(p, now, dt) {
    const want = !!p.keys.shoot && !(now < (p.jamUntil || 0)) && !(p.turretHeld && p.turretArmed);
    const full = BOOM_SPIN_MS + BOOM_RAMP_MS;
    if (want) p.boomHeld = Math.min((p.boomHeld || 0) + dt, full);
    else p.boomHeld = Math.max(0, (p.boomHeld || 0) - dt * 2.5);
    if (!want || p.boomHeld < BOOM_SPIN_MS) return;
    const k = Math.min(1, (p.boomHeld - BOOM_SPIN_MS) / BOOM_RAMP_MS);
    const cd = (BOOM_CD_MAX - (BOOM_CD_MAX - BOOM_CD_MIN) * k) * (now < (p.overclockUntil || 0) ? OVERCLOCK_MACHINE : 1);
    if (now - (p.boomLast || 0) < cd) return;
    p.boomLast = now;
    p.lastShotTime = now;
    addShake(9 + 5 * k);
    const ox = p.x + p.size / 2, oy = p.y + p.size / 2;
    if (netIsHost || !netOnline) {
        arcadeBoomResolve(netIdFor(p), ox, oy, p.facingX, p.facingY, now);
    } else {
        // Predicted locally the instant it fires; the host resolves the kills
        // and its copy of this bolt is skipped when it arrives.
        const dl = Math.hypot(p.facingX, p.facingY) || 1;
        const dx = p.facingX / dl, dy = p.facingY / dl;
        boomLocal.push({ id: -1, x: ox + dx * BOOM_MUZZLE, y: oy + dy * BOOM_MUZZLE,
                         vx: dx * BOOM_SPEED, vy: dy * BOOM_SPEED, owner: netIdFor(p), travelled: 0 });
        if (boomLocal.length > 12) boomLocal.shift();
        localEvent(SND_BOOM, ox, oy, 0);
        MP.send({ k: "boom", id: netIdFor(p), x: Math.round(ox), y: Math.round(oy), dx: +dx.toFixed(3), dy: +dy.toFixed(3) });
    }
}

// TURRETS. Carried like a gun (`p.turretHeld`), ARMED on pickup so the next
// click places it ("picked up like gun, placed on click"), T re-arms it and a
// gun key disarms it. It lands at the cursor but never further than
// TURRET_REACH from you, so putting it somewhere specific means going there
// -- into the swarm -- and standing still while you do. It deploys for
// TURRET_DEPLOY_MS, fires at the nearest zombie in sight for TURRET_LIFE_MS,
// and zombies on top of it chew it down. Once placed, you can carry another.
// The host owns the list; bullets are ordinary bullets owned by the placer,
// so kills credit them and every client draws them with no new wire.
const TURRET_REACH = 110;
const TURRET_MIN = 38;
const TURRET_DEPLOY_MS = 700;
const TURRET_LIFE_MS = 15000;
const TURRET_HP = 140;
const TURRET_RATE_MS = 100;
const TURRET_DMG = 2.5;
const TURRET_RANGE = 460;
const TURRET_MAX = 4;
let arcTurrets = [];              // {id, x, y, owner, color, until, liveAt, hp, aim, lastShot, eng}
let arcTurretSeq = 0;

// OVERCLOCK AUGMENTS THE MACHINES (2026-10-17: "picking up a overclock when
// turrets or boomgun are active should augment those as well"). The team
// drop sets this on every client (applyTeamPickup); turrets fire twice as
// fast under it, and so does the Boomgun.
let arcOverclockUntil = 0;
const OVERCLOCK_MACHINE = 0.5;    // cooldown multiplier for turrets and the Boomgun

// THE ENGINEER'S TURRETS CARRY THE ENGINEER'S PERKS (2026-10-17). A turret
// placed by an ENGINEER (`eng`, decided by the host from the placer's id)
// reads its owner's perks live:
//   OVERDRIVE            fires faster, the same table as a gun
//   RICOCHET/SKEWER/SEEKER  its rounds bounce, pierce, curve
//   ARC, BLASTCAP        proc on its kills (src "shot")
//   SALVAGE              a kill may put time back on its bar
//   SPITE                it goes off when it expires or is chewed down
//   ATTRACT, LAST STAND  nothing -- a turret neither picks up nor goes down
// Anyone else's turret is a plain turret: its rounds are src "turret", which
// is not a PROC_SOURCE, so ARC and BLASTCAP no longer fire off it.
const TURRET_OD = [1, 0.65, 0.5, 0.4, 0.33, 0.28, 0.24];
const TURRET_SALVAGE = [0, 0.3, 0.45, 0.6, 0.7, 0.78, 0.85];   // chance per kill, as the gun perk
const TURRET_SALVAGE_MS = 1500;   // time back on the bar per salvaged kill

// HOST, from updateBullets: a turret's round killed something.
function arcadeTurretKill(turretId, now) {
    for (let i = 0; i < arcTurrets.length; i++) {
        const t = arcTurrets[i];
        if (t.id !== turretId || !t.eng) continue;
        const lv = idCardLevel(t.owner, "salvage");
        if (lv && Math.random() < TURRET_SALVAGE[lv]) {
            t.until = Math.min(now + TURRET_LIFE_MS, t.until + TURRET_SALVAGE_MS);
        }
        return;
    }
}

// HOST: an engineer's turret with SPITE goes off as it dies, like its owner would.
function arcadeTurretSpite(t, now) {
    const spite = t.eng ? idCardLevel(t.owner, "spite") : 0;
    if (!spite) return;
    const radius = 200 + spite * 45;
    addBlast(t.x, t.y, radius);
    for (let i = zombies.length - 1; i >= 0; i--) {
        const z = zombies[i];
        if (z && dist(t.x, t.y, z.x, z.y) < radius) damageZombie(i, 10 * spite, t.owner, now, "spite");
    }
    shakeNear(t.x, t.y, 11);
    hostEvent(SND_EXPLODE, t.x, t.y, radius);
}

// Every client, for its own player, on click.
function arcadePlaceTurret(p) {
    const cx = p.x + p.size / 2, cy = p.y + p.size / 2;
    let dx = mouseX - cx, dy = mouseY - cy;
    let d = Math.hypot(dx, dy);
    if (d < 1) { dx = p.facingX; dy = p.facingY; d = 1; }
    const r = Math.max(TURRET_MIN, Math.min(TURRET_REACH, d));
    const x = Math.round(cx + dx / d * r), y = Math.round(cy + dy / d * r);
    if (!inArena(x - 11, y - 11, 22) || blockedAtStatic(x - 11, y - 11, 22)) {
        showToast("NO ROOM THERE", 900);
        return false;
    }
    p.turretHeld = false;
    p.turretArmed = false;
    if (netIsHost || !netOnline) arcadeHostPlaceTurret(netIdFor(p), p.color, x, y);
    else MP.send({ k: "turret", id: netIdFor(p), c: p.color, x: x, y: y });
    localEvent(SND_BUY, x, y);
    return true;
}

// HOST.
function arcadeHostPlaceTurret(ownerId, color, x, y) {
    if (!inArena(x - 11, y - 11, 22) || blockedAtStatic(x - 11, y - 11, 22)) return;
    const now = Date.now();
    while (arcTurrets.length >= TURRET_MAX) arcTurrets.shift();
    arcTurrets.push({ id: ++arcTurretSeq, x: x, y: y, owner: ownerId, color: color || "#55FFFF",
                      until: now + TURRET_DEPLOY_MS + TURRET_LIFE_MS, liveAt: now + TURRET_DEPLOY_MS,
                      hp: TURRET_HP, aim: 0, lastShot: 0, eng: idHasRole(ownerId, "engineer") });
}

// HOST, every step.
function arcadeUpdateTurrets(now, dt) {
    for (let i = arcTurrets.length - 1; i >= 0; i--) {
        const t = arcTurrets[i];
        if (now >= t.until || t.hp <= 0) {
            arcTurrets.splice(i, 1);
            hostEvent(SND_POP, t.x, t.y, 40);
            arcadeTurretSpite(t, now);
            continue;
        }
        if (now < t.liveAt) continue;
        let best = null, bestD = TURRET_RANGE * TURRET_RANGE;
        for (let k = 0; k < zombies.length; k++) {
            const z = zombies[k];
            const zx = z.x + z.size / 2 - t.x, zy = z.y + z.size / 2 - t.y;
            const d2 = zx * zx + zy * zy;
            // A zombie on the turret chews it.
            if (d2 < (z.size / 2 + 14) * (z.size / 2 + 14) && !arcadeFrozen(z, now)) t.hp -= 0.6 * (dt / 16.7);
            if (d2 < bestD) {
                // In sight: the turret does not shoot through walls and trees.
                if (!navClearLine(t.x, t.y, z.x + z.size / 2, z.y + z.size / 2)) continue;
                best = z; bestD = d2;
            }
        }
        let rate = TURRET_RATE_MS;
        if (t.eng) rate *= TURRET_OD[idCardLevel(t.owner, "overdrive")] || 1;
        if (now < arcOverclockUntil) rate *= OVERCLOCK_MACHINE;
        if (!best || now - t.lastShot < rate) continue;
        t.lastShot = now;
        const zx = best.x + best.size / 2 - t.x, zy = best.y + best.size / 2 - t.y;
        const dd = Math.hypot(zx, zy) || 1;
        t.aim = Math.atan2(zy, zx);
        const sp = WEAPONS.smg.speed;
        bullets.push({
            x: t.x - 4, y: t.y - 4, vx: zx / dd * sp, vy: zy / dd * sp, size: 8,
            dmg: TURRET_DMG, hitZ: [], travelled: 0,
            pierce: t.eng ? idCardLevel(t.owner, "skewer") : 0,
            bounces: t.eng ? idCardLevel(t.owner, "ricochet") : 0,
            homing: t.eng ? idCardLevel(t.owner, "seeker") : 0,
            src: t.eng ? "shot" : "turret", turretId: t.id,
            range: TURRET_RANGE + 80, kind: "smg", ownerColor: t.color, owner: t.owner
        });
        hostEvent(SND_SHOT, t.x, t.y, WEAPON_KEYS.indexOf("smg"));
    }
}

// HOST. FLARE: a ring of fast bodies lands 240-340px round the taker. Spawned
// directly (not through the spawn ring) because the point is that it is
// close, and the ring deliberately refuses anywhere near a player.
function arcadeFlare(cx, cy, now) {
    const lvl = arcadeLevel(now);
    let made = 0;
    for (let tries = 0; tries < FLARE_COUNT * 6 && made < FLARE_COUNT; tries++) {
        const a = Math.random() * Math.PI * 2, r = 240 + Math.random() * 100;
        const x = cx + Math.cos(a) * r - 8, y = cy + Math.sin(a) * r - 8;
        if (!inArena(x, y, 20) || blockedAtStatic(x, y, 20)) continue;
        const z = spawnZombieAt(made % 3 === 0 ? "runner" : "walker", lvl, x, y);
        if (z) { z.entered = true; made++; }
    }
    hostEvent(SND_SCREAM, cx, cy);
}

// Throws everything near the taker outward, using the SUPER SPLITTER's own
// launch phase -- so it is already on the wire and already exempt from the
// stuck watchdog.
function arcadeShockwave(cx, cy, now) {
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        const dx = z.x + z.size / 2 - cx, dy = z.y + z.size / 2 - cy;
        const d = Math.hypot(dx, dy);
        if (d > SHOCK_RADIUS || d < 1) continue;
        const push = 9 * (1 - d / SHOCK_RADIUS) + 3;      // px per step
        z.launchUntil = now + 450;
        z.lvx = (dx / d) * push;
        z.lvy = (dy / d) * push;
    }
    addBlast(cx, cy, SHOCK_RADIUS);
    hostEvent(SND_EXPLODE, cx, cy);
}

// EVERY client, from applyPurchase: the drop is gone, and its effect lands.
function arcadeApplyTake(msg, now) {
    const d = dropById(msg.i);
    if (d) pickups.splice(pickups.indexOf(d), 1);
    const x = msg.x || 0, y = msg.y || 0;
    const p = localPlayerByNetId(msg.id);
    const who = nameForNetId(msg.id);
    if (msg.t === "gun") {
        if (p && WEAPONS[msg.it]) {
            if (!p.owned) p.owned = {};
            p.owned[msg.it] = true;
            p.weapon = msg.it;
            p.ammo[msg.it] = WEAPONS[msg.it].capacity;
        }
        localEvent(SND_BUY, x, y);
        showToast((p ? "YOU" : (who || "SOMEONE")) + " TOOK THE " + dropLabel({ type: "gun", item: msg.it }), 1600);
    } else if (msg.t === "boomgun") {
        if (p) {
            const total = arcadeBoomGrant(p, now);
            showToast(total > BOOM_MS ? "BOOMGUN +" + (BOOM_MS / 1000) + "s — " + Math.round(total / 1000) + "s" : "BOOMGUN — HOLD TO SPIN UP", 2200);
        } else {
            showToast((who || "SOMEONE") + " HAS THE BOOMGUN", 1600);
        }
        localEvent(SND_BUY, x, y);
    } else if (msg.t === "turret") {
        if (p) {
            p.turretHeld = true;
            p.turretArmed = true;
            showToast("TURRET — CLICK TO PLACE", 1800);
        } else {
            showToast((who || "SOMEONE") + " TOOK THE TURRET", 1400);
        }
        localEvent(SND_BUY, x, y);
    } else if (msg.t === "perk") {
        if (p && CARDS[msg.it] && !dropRefusal(p.cards, { type: "perk", item: msg.it })) p.cards.push(msg.it);
        localEvent(SND_CARD, x, y);
        showToast((p ? "YOU" : (who || "SOMEONE")) + " TOOK " + dropLabel({ type: "perk", item: msg.it }), 1600);
    } else {
        localEvent(SND_PICKUP, x, y);
        if (msg.t === "ammo") {
            for (let i = 0; i < players.length; i++) refillAmmo(players[i]);
            showToast("AMMO — " + (who || "SOMEONE") + " RESUPPLIED THE TEAM", 1800);
        } else if (msg.t === "rally" && p && !p.rallyStored && soloRun()) {
            // Alone it has nobody to stand up: keep it for yourself.
            p.rallyStored = true;
            showToast("RALLY STORED — IT BRINGS YOU BACK ONCE", 2400);
        } else if (msg.t === "overclock" || msg.t === "rally") {
            applyTeamPickup(msg.t, msg.t === "overclock" ? OVERCLOCK_MS : 0, now, false);
        } else if (msg.t === "fuel") {
            showToast("FUEL — THE TANK TOOK " + DROP_FUEL, 1600);
        } else if (msg.t === "shock") {
            addShake(10);
            showToast("SHOCKWAVE", 1200);
        } else if (msg.t === "freeze") {
            showToast("FREEZE — " + (FREEZE_MS / 1000) + "s", 1400);
        } else if (msg.t === "mud") {
            if (p) { p.slowUntil = now + MUD_MS; showToast("MUD — SLOWED", 1600); }
            else showToast((who || "SOMEONE") + " STEPPED IN MUD", 1400);
        } else if (msg.t === "jam") {
            if (p) { p.jamUntil = now + JAM_MS; showToast("JAMMED — GUN LOCKED", 1800); }
            else showToast((who || "SOMEONE") + " JAMMED THEIR GUN", 1400);
        } else if (msg.t === "flare") {
            addShake(6);
            showToast((p ? "YOU" : (who || "SOMEONE")) + " LIT A FLARE — THEY SEE US", 1800);
        }
    }
}

// ---------------------------------------------------
//   SEPARATION
// ---------------------------------------------------
// "100+ zombies can be within the same square." A soft push-apart, after
// steering, on a uniform grid -- never O(n^2); the cap is 180. Capped well
// under a step, so it BIASES the path the flow field gave rather than
// overriding it: this game's pathfinding history is a list of fixes for
// zombies pushed off their path. Exempt: anything flying or chewing
// (`z.holding`, set in updateZombies), though it still pushes others off
// itself. ON TARGET IS DELIBERATELY NOT EXEMPT, unlike the progress
// watchdog: measured with it exempt, the whole 90-zombie cap stood in ONE
// 20px cell on the player. A crowd at its target is exactly the crowd that
// should spread out round it.
const SEP_CELL = 32;
const SEP_MAX_PUSH = 1.4;         // px per step

function separateZombies() {
    const n = zombies.length;
    if (n < 2) return;
    const grid = new Map();
    for (let i = 0; i < n; i++) {
        const z = zombies[i];
        const k = Math.floor((z.x + z.size / 2) / SEP_CELL) * 4096 + Math.floor((z.y + z.size / 2) / SEP_CELL);
        let cell = grid.get(k);
        if (!cell) { cell = []; grid.set(k, cell); }
        cell.push(i);
    }
    for (let i = 0; i < n; i++) {
        const a = zombies[i];
        if (a.holding || (a.launchUntil && Date.now() < a.launchUntil)) continue;
        const ax = a.x + a.size / 2, ay = a.y + a.size / 2;
        const gx = Math.floor(ax / SEP_CELL), gy = Math.floor(ay / SEP_CELL);
        let px = 0, py = 0;
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                const cell = grid.get((gx + ox) * 4096 + (gy + oy));
                if (!cell) continue;
                for (let c = 0; c < cell.length; c++) {
                    const j = cell[c];
                    if (j === i) continue;
                    const b = zombies[j];
                    const dx = ax - (b.x + b.size / 2), dy = ay - (b.y + b.size / 2);
                    const min = (a.size + b.size) * 0.5;
                    const d2 = dx * dx + dy * dy;
                    if (d2 >= min * min) continue;
                    const d = Math.sqrt(d2) || 0.01;
                    const over = (min - d) / min;            // 0..1
                    px += (d2 ? dx / d : (i < j ? 1 : -1)) * over;
                    py += (d2 ? dy / d : 0) * over;
                }
            }
        }
        if (!px && !py) continue;
        const len = Math.hypot(px, py);
        let m = Math.min(SEP_MAX_PUSH, len * SEP_MAX_PUSH);
        // Never past the hard speed cap: a zombie that walked at the cap this
        // step has no room left to be shoved forward.
        if (a.mx0 !== undefined) {
            const moved = Math.hypot(a.x - a.mx0, a.y - a.my0);
            m = Math.min(m, Math.max(0, PLAYER_SPEED - moved));
        }
        moveWithCollisions(a, (px / len) * m, (py / len) * m, !!a.entered, true);
    }
}

// ---------------------------------------------------
//   THE ARENA (2026-10-04, second playtest note)
// ---------------------------------------------------
// "The whole map should be compressed quite a bit so there's less running
// between silos." Shrinking the WORLD would mean moving every placer that
// assumes a 4800x2700 sector grid; instead the arcade fences an ARENA (in
// zombie-core.js) round the middle of it, and puts the chain on a fixed
// triangle inside: start -> 1 -> 2 -> 3 -> gate is ~3,800px (~16s of
// running) against the ~7,850px (~33s) the scattered silos cost. Fixed
// positions also mean everyone learns the layout in one run, which is what
// makes "tank two!" a callout.
//
// Called at the end of openTheArena(). The rail goes here too --
// "immediately after playtesting" was the user's plan for it, and the arena
// has no room for it anyway.
// 150 from 2026-10-11 ("silo funnels should be larger"); it was 110. The sets,
// the lamps, the clear rects and the draw all read funnels[k].r, so this is
// the one number. Funnel 2 moves up 80px with it so its warehouse (which
// stands 300px below the funnel) keeps clear of the start point.
const ARENA_FUNNEL_R = 150;
// Offsets from the arena's centre, which is where players start. Laid out
// like a BASEBALL FIELD (user, 2026-10-04): first at centre-left, second at
// top-middle, third at centre-right, and the gate is home plate, south.
const ARENA_FUNNELS = [[-1150, 0], [0, -680], [1100, 0]];   // pushed apart with the 33% bigger arena (2026-10-07)
const ARENA_GATE_DX = 0;          // the exit, in the south wall

// ---------------------------------------------------
//   THE TWO MAPS (2026-10-11, LEVEL_2_PROPOSAL.md; user: "level 2 and then
//   the end of the game")
// ---------------------------------------------------
// Map 1 is the baseball diamond. Map 2 is a fixed "W" of FIVE tanks, entered
// at the TOP of the arena (you run in from the north fence) with the gate
// in the south wall, off to the east. The set types reuse the three
// builders: hedge, warehouse, forest. Offsets are from the world centre, as
// ARENA_FUNNELS always was, pulled in ~20% from the proposal's table
// because the first measurement put the route at ~8,200px against map 1's
// ~3,800 (a "session length" problem; see the proposal).
//
// The wave on map 2 reads the clock offset by L2_CLOCK_OFFSET_S, so map 2's
// minute 2 is map 1's minute 3 and it follows the same curve after that
// (user, 2026-10-11).
// MAP 3 (7 tanks): a long concrete DIVIDER down the middle (a reservoir wall,
// 480 x 1370, a 285px lane over its top and a ~490px pass under its foot, which
// is also where tank 4 stands). Left half: forest, hedge, warehouse. Right
// half: hedge, forest, hedge, and the gate in the south-east corner.
// MAP 4, THE BOSS (10 tanks): an open map, no sets and no trees in the core,
// ten tanks stacked tight in two rows of five, and a different wave
// (arcadeBossWave): only SUPER SPLITTERS and a constant horde, with the
// negative drops turned up. Beating it is the win.
const ARENA_LAYOUTS = {
    1: { funnels: ARENA_FUNNELS, gateDx: ARENA_GATE_DX, caps: [10, 15, 20], clock: 0,
         sets: ["hedge", "warehouse", "forest"] },
    2: { funnels: [[-1360, -750], [-560, 200], [200, -650], [800, 300], [1520, -700]], gateDx: 1360,
         caps: [8, 10, 12, 14, 16], clock: 60,
         sets: ["hedge", "warehouse", "forest", "hedge", "forest"] },
    3: { funnels: [[-2000, -900], [-1100, -450], [-1500, 430], [120, 640], [1100, 380], [2000, -250], [1100, -700]],
         // clock 120 -> 60 on 2026-10-11 ("scale back the map-starting time for 3 & 4"):
         // the bot sweep survived 62-230s at 60 against 63-86s at 120.
         // Tanks 8..16 -> 7..14 (-15%) and the curve at 0.5x inside the map, from
         // the bot sweep: map 3 is bound by the timeline, so what helps is how
         // slowly the wave level climbs once you are in it.
         gateDx: 2000, caps: [7, 8, 10, 10, 12, 12, 14], clock: 60, pace: 0.5,
         sets: ["forest", "hedge", "warehouse", "forest", "hedge", "forest", "hedge"],
         divider: { x: -240, y: -950, w: 480, h: 1370 } },
    // 2026-10-12: the rows moved apart (-250/+170 -> -470/+400) to make room for
    // ONE GIANT SILO between them (`giant`): the ten funnels still fill at
    // their own quotas, but they all feed it, and its ten bays are the
    // switches. Columns are unchanged.
    4: { funnels: [[-1200, -470], [-600, -470], [0, -470], [600, -470], [1200, -470],
                   [1200, 400], [600, 400], [0, 400], [-600, 400], [-1200, 400]],
         // clock 240 -> 100 on 2026-10-11, same reason.
         gateDx: -1200, caps: [6, 6, 6, 6, 7, 7, 7, 7, 8, 8], clock: 100, pace: 0.6,
         sets: [], open: true, boss: true, giant: true }
};
const ARC_MAX_LEVEL = 4;
const L2_CLOCK_OFFSET_S = 60;     // kept: ARENA_LAYOUTS[2].clock; every map has its own now
// A map after the first opens with a flythrough of its own (2026-10-12; it was
// a 2.6s run-on). Its length depends on the tank layout: arcIntroMs().
const ARC_RUNON_MS = 1000;        // the last of it: you walk in through the gate as the camera lands on you (240px: tunnel, gate, in)
// MAPS AFTER THE FIRST FLY MAP 1'S FLYTHROUGH (2026-10-12, third pass). The
// user: "the zoom in and out, time at each silo, and speed of camera, and zoom
// level at each for level 1 is great, can we make the other levels match?"
// So these maps use map 1's own shot grammar (arcadeShotCamera) and its
// numbers, read off its shot list: a wide hold, a 1.5s zoom in, then a move
// and a captioned hold at every tank, the exit, and home to you.
const ARC_INTRO_SPEED = 1450;    // world px/s a move averages: map 1's moves run 1,100 to 1,670
const ARC_INTRO_MOVE_MIN = 550;  // the shortest move: a 600px hop at map 1's speed would peak over its fastest pan
const ARC_INTRO_MOVE_MAX = 1500; // the longest, so a 2,000px move still averages ~1,450px/s
const ARC_INTRO_HOLD_MS = 600;   // on each tank after the first: map 1's TANK 2 and TANK 3
const ARC_INTRO_ZOOMIN_SPEED = 1000; // world px/s of the pan that rides along with the zoom into tank 1
const ARC_INTRO_ZOOMIN_MIN_MS = 2000;   // long enough that the zoom's own acceleration stays gentle (a 1.5s one peaked at 1.7 screen widths/s^2)
const ARC_INTRO_ZOOMIN_MAX_MS = 2600;
const ARC_INTRO_WIDE_MS = 1500;   // the whole map and its job: long enough to read "10 SILOS TO FILL"
// Screen fades. Stepped, not smooth (checklist item 9: nothing ramps): each
// step is 1/ARC_FADE_STEPS of black, ~100ms apart, like a palette fade on the
// real boards. 0 gives a smooth ramp.
const ARC_FADE_STEPS = 8;
const ARC_FADE_IN_MS = 700;       // out of black, onto a new map
const ARC_LEAVE_MS = 1100;        // map change: how long until the swap lands...
const ARC_LEAVE_FADE_MS = 800;    // ...and how much of that is the fade to black
const L2_LULL_MS = 15000;         // a light lull on arrival...
const L2_RAMP_MS = 20000;         // ...then it eases up to the curve
const L2_LULL_MULT = 0.25;
let arcLevelNo = 1;
// What the finished maps left behind, for the run's time and score. (Named for
// map 1; it has meant "every map before this one" since map 3.)
let arcL1Seconds = 0;
let arcL1Silos = 0;
let arcL2StartAt = 0;             // HOST: when this map's intro ends
let arcLeaveAt = 0;               // HOST: a map change is under way (when it began)
let arcLeaveEndAt = 0;            // EVERY client: when the swap lands (a guest is told as `lq`)
let arcFadeInAt = 0;              // a fade up from black began here...
let arcFadeInMs = 0;              // ...and takes this long

// ---------------------------------------------------
//   DIFFICULTY (2026-10-11, user: "a difficulty slider ... keeps 1 & 2 the
//   near same but plays more with the difficulty of 3 & 4")
// ---------------------------------------------------
// One number, ARC_DIFF_DEFAULT (1.0) at the tick the game ships on. Maps 1 and
// 2 barely move with it (the head start of map 2 by +-20% of the slider's
// distance from default, the rate by +-10%); maps 3 and 4 take it whole: their
// head start on the curve, the spawn rate, how many may be alive, and on the
// boss how hard the horde and the super splitters come. Everything reads it
// LIVE, so the slider in the dev panel reshapes the curve mid-run. It rides
// the snapshot (`df`) so guests' clocks agree, and persists per browser.
const ARC_DIFF_MIN = 0.5;
const ARC_DIFF_MAX = 1.5;
const ARC_DIFF_DEFAULT = 1.0;
let arcDifficulty = (function () {
    try {
        const v = parseFloat(localStorage.getItem("zombie_arcade_difficulty"));
        if (v >= ARC_DIFF_MIN && v <= ARC_DIFF_MAX) return v;
    } catch (e) { /* private window: fine */ }
    return ARC_DIFF_DEFAULT;
})();

function arcadeSetDifficulty(v) {
    arcDifficulty = Math.max(ARC_DIFF_MIN, Math.min(ARC_DIFF_MAX, v));
    try { localStorage.setItem("zombie_arcade_difficulty", String(arcDifficulty)); } catch (e) { /* ignore */ }
    return arcDifficulty;
}

// Map 1 and 2 (the "near the same" half) versus maps 3 and 4 (the half the
// slider is for).
function arcHardMap() { return arcLevelNo >= 3; }
function arcDiffRate() { return arcHardMap() ? arcDifficulty : 1 + 0.1 * (arcDifficulty - 1); }
function arcDiffCap() { return arcHardMap() ? 0.7 + 0.3 * arcDifficulty : 1; }

// This map's clock head start: map 2's minute 2 is map 1's minute 3 (user,
// 2026-10-11), and each map after starts further up the same curve (the
// `clock` of its layout row, scaled by the difficulty).
function arcClockOffsetS() {
    const L = ARENA_LAYOUTS[arcLevelNo];
    if (!L || !L.clock) return 0;
    return L.clock * (arcHardMap() ? arcDifficulty : 1 + 0.2 * (arcDifficulty - 1));
}
const ARENA_SILO_W = 70;          // the tank's FOOTPRINT, solid on every side
const ARENA_SILO_H = 56;
const ARENA_PIPE_RUN = 110;       // funnel rim to tank: room for the pipes to read
const ARENA_CLEAR = 150;          // nothing solid this close to the chain

function buildArcadeArena() {
    const A = ARENA;
    // The chain hangs off the WORLD centre (the spawn), not the arena's
    // centre: the arena grew asymmetrically (a top buffer) on 2026-10-07 and
    // nothing in it was to move.
    const cx = WORLD_W / 2, cy = WORLD_H / 2;

    // The chain first: everything else is tested against it.
    funnelHalls = [];
    sluiceRoom = null;
    const LAY = ARENA_LAYOUTS[arcLevelNo] || ARENA_LAYOUTS[1];
    const nT = LAY.funnels.length;
    funnels.length = nT;
    silos.length = nT;
    siloPipes.length = nT;
    // The chain's state arrays are as long as the tanks (they were [x, x, x]).
    funnelActive = new Array(nT).fill(false);
    siloFill = new Array(nT).fill(0);
    arcadeResetBlood(nT);
    siloFlipped = new Array(nT).fill(false);
    giantSilo = null;
    arcLeverAt = [];
    // THE ROAD COMES FIRST: planned from the way in to the exit, and the
    // structures that stand too close are nudged off it (see ROADS). The exit
    // is placed here for it, ahead of the tanks.
    const wallY = A.y + A.h - WALL_T;
    const gx = cx + LAY.gateDx;
    escapeRect = { x: Math.round(gx - ARC_GATE_W / 2), y: wallY, w: ARC_GATE_W, h: ARC_GATE_H };
    const plan = arcadePlanRoads(LAY, cx, cy);
    arenaRoads = plan.roads;
    arenaDividerOff = plan.div;
    for (let k = 0; k < nT; k++) {
        const fx = cx + plan.offs[k][0], fy = cy + plan.offs[k][1];
        funnels[k] = { x: fx, y: fy, r: ARENA_FUNNEL_R, zone: zoneOf(fx, fy) };
        if (LAY.giant) continue;
        silos[k] = { x: Math.round(fx + ARENA_FUNNEL_R + ARENA_PIPE_RUN), y: Math.round(fy - ARENA_SILO_H / 2),
                     w: ARENA_SILO_W, h: ARENA_SILO_H, zone: zoneOf(fx, fy) };
        siloPipes[k] = arcadePipeRoute(funnels[k], silos[k]);     // THE BLOOD RUN
    }
    if (LAY.giant) buildGiantSilo(cx, cy, nT);
    // FLUSH WITH THE SOUTH WALL and as wide as the tunnel behind it (2026-10-04:
    // "inset lower ... so that it's flush with south wall"; "extend the
    // sealed fence to the full width ... there are visually gaps").

    // Where you start: the middle on map 1, the north fence on map 2.
    const startRect = arcLevelNo >= 2 ? { x: cx - 160, y: A.y, w: 320, h: 380 }
                                       : { x: cx - 340, y: cy + START_PED_TOP - 10, w: 680, h: -START_PED_TOP + FOUNTAIN_DY + ROUNDABOUT_R + 90 };
    const clear = [startRect,
                   { x: escapeRect.x - ARENA_CLEAR, y: escapeRect.y - ARENA_CLEAR,
                     w: escapeRect.w + ARENA_CLEAR * 2, h: escapeRect.h + ARENA_CLEAR }];
    for (let k = 0; k < nT; k++) {
        const f = funnels[k], s = silos[k];
        if (giantSilo) clear.push({ x: f.x - f.r - 40, y: f.y - f.r - 40, w: f.r * 2 + 80, h: f.r * 2 + 80 });
        else clear.push({ x: f.x - f.r - 40, y: f.y - f.r - 40, w: (s.x + s.w + 40) - (f.x - f.r - 40), h: f.r * 2 + 80 });
    }
    if (giantSilo) clear.push(grow({ x: giantSilo.x, y: giantSilo.y - giantSilo.lift, w: giantSilo.w, h: giantSilo.h + giantSilo.lift }, 60));
    arcadeReserveRoads(arenaRoads, clear);
    const fits = function (r) {
        if (r.x < A.x + WALL_T || r.y < A.y + WALL_T ||
            r.x + r.w > A.x + A.w - WALL_T || r.y + r.h > A.y + A.h - WALL_T) return false;
        for (let i = 0; i < clear.length; i++) if (rectsOverlap(r, clear[i])) return false;
        return true;
    };

    // Landmarks inside, clear of the chain, stay: the only cover there is.
    landmarks = landmarks.filter(fits);
    const keepWalls = walls.filter(function (w) { return w.landmark && fits(w); });
    barrels = barrels.filter(function (b) { return fits({ x: b.x, y: b.y, w: b.size, h: b.size }); });
    generatorRect = null;             // power is on from the start
    codexRect = null;                 // the field manual: removed on request
    intensifyRect = null;             // the horde switch: removed on request
    forestRects = [];
    culverts = [];

    // The rail, gone.
    railPaths = [];
    railcars = [];
    if (typeof trainReset === "function") trainReset();

    // The fence: four walls, the gate cut into the south one between two
    // columns -- the shape buildEscapeOpening() cuts into the world's.
    const T = WALL_T;
    const x0 = escapeRect.x, x1 = escapeRect.x + escapeRect.w;
    // THE WAY IN, on every map after the first: an opening in the NORTH fence
    // between two columns, a tunnel stub behind it to the top of the world, and
    // a gate that is built shut (arcadeEnterLevel opens it for the arrival).
    const north = [];
    if (arcLevelNo >= 2) {
        const ex0 = Math.round(cx - ARC_GATE_W / 2), ex1 = ex0 + ARC_GATE_W;
        entryRect = { x: ex0, y: A.y + T - ARC_GATE_H, w: ARC_GATE_W, h: ARC_GATE_H };
        north.push(
            { x: A.x, y: A.y, w: ex0 - A.x, h: T, perim: true },
            { x: ex1, y: A.y, w: A.x + A.w - ex1, h: T, perim: true },
            { x: ex0 - ESCAPE_JAMB, y: A.y - 14, w: ESCAPE_JAMB, h: T + 28, column: true },
            { x: ex1, y: A.y - 14, w: ESCAPE_JAMB, h: T + 28, column: true },
            { x: ex0 - T, y: 0, w: T, h: A.y, perim: true },
            { x: ex1, y: 0, w: T, h: A.y, perim: true },
            { x: ex0 - T, y: 0, w: ARC_GATE_W + T * 2, h: T, perim: true },
            { x: ex0, y: entryRect.y, w: ARC_GATE_W, h: ARC_GATE_H, entryBar: true }
        );
        arcEntryState = "closed";
    } else {
        entryRect = null;
        arcEntryState = "";
        north.push({ x: A.x, y: A.y, w: A.w, h: T, perim: true });
    }
    arcEntryCloseAt = 0;
    arcEntryClosedAt = 0;
    keepWalls.push.apply(keepWalls, north);
    keepWalls.push(
        // The HARD BOUNDARY, where the fence always stood: players stop here
        // (zombies pass). The tall grass lies INSIDE it and tapers away.
        { x: A.x, y: A.y, w: T, h: A.h, perim: true, zpass: true },
        { x: A.x + A.w - T, y: A.y, w: T, h: A.h, perim: true, zpass: true },
        { x: A.x, y: wallY, w: x0 - A.x, h: T, perim: true },
        { x: x1, y: wallY, w: A.x + A.w - x1, h: T, perim: true },
        { x: Math.round(x0 - ESCAPE_JAMB), y: wallY - 14, w: ESCAPE_JAMB, h: T + 28, column: true },
        { x: Math.round(x1), y: wallY - 14, w: ESCAPE_JAMB, h: T + 28, column: true },
        // THE GATE IS SOLID OVER EVERYTHING IT DRAWS until it is fully open
        // ("make the fence non-mountable, it should collide at all points").
        { x: Math.round(x0), y: wallY, w: Math.round(x1 - x0), h: ARC_GATE_H, gateBar: true },
        // ONE CONTINUOUS TUNNEL behind it, to the bottom of the world.
        { x: Math.round(x0 - T), y: wallY, w: T, h: WORLD_H - wallY, perim: true },
        { x: Math.round(x1), y: wallY, w: T, h: WORLD_H - wallY, perim: true }
    );
    arcOutY = wallY + ARC_GATE_H + ARC_OUT_PAST;
    // THE TANKS ARE SOLID OVER THEIR WHOLE DRAWN SHAPE (2026-10-04: "I
    // shouldn't be able to walk on top of the silos themselves at all") --
    // the footprint plus everything extruded above it.
    if (giantSilo) {
        keepWalls.push({ x: giantSilo.x, y: giantSilo.y - giantSilo.lift, w: giantSilo.w, h: giantSilo.h + giantSilo.lift, silo: true });
    } else {
        for (let k = 0; k < nT; k++) {
            const s = silos[k];
            keepWalls.push({ x: s.x, y: s.y - SILO_LIFT, w: s.w, h: s.h + SILO_LIFT, silo: true });
        }
    }
    walls = keepWalls;
    escapeOpening = { x: Math.round(x0), y: wallY, w: Math.round(x1 - x0), h: ARC_GATE_H };
    // The silo sets first (they claim their ground), then the open terrain.
    arenaTrees = [];
    arenaBushes = [];
    buildSiloSets(clear);
    if (arcLevelNo <= 1) {
        // The pedestal, flush under the warehouse; and the fountain, south of it.
        pushProp("fountain", cx - FOUNTAIN_HALF, cy + FOUNTAIN_DY + FOUNTAIN_HALF, FOUNTAIN_HALF * 2, FOUNTAIN_HALF * 2, 0);
    }
    plantArenaTerrain(fits, !!LAY.open);

    if (typeof zfKeepPatches === "function") {
        zfKeepPatches(function (p) {
            if (p.kind !== "hardstand") return false;
            for (let i = 0; i < landmarks.length; i++) if (rectsOverlap(p, landmarks[i])) return true;
            return false;
        });
    }
}

// The only place a tank's switch can be thrown from: a strip along its base
// (2026-10-04: "hitting F on the silo should be at the bottom of the silo
// only"). The tank itself is solid all the way up, so this is the face you
// can actually stand at.
function siloUseRect(s) {
    if (s.use) return s.use;          // the giant silo: any bay's switch is thrown from anywhere along its base
    return { x: s.x - 8, y: s.y + s.h - 6, w: s.w + 16, h: 40 };
}

// A box wholly inside the arena's fence.
function inArena(x, y, size) {
    const A = ARENA, m = WALL_T + 6;
    return x >= A.x + m && y >= A.y + m && x + size <= A.x + A.w - m && y + size <= A.y + A.h - m;
}

// ---------------------------------------------------
//   THE GIANT SILO (2026-10-12, map 4)
// ---------------------------------------------------
// "Modify the last level to be filling one giant center blood silo instead of
// 10 separate ones, but keep the silos as needing to be filled at their
// normal quantities." So the ten funnels and their quotas are unchanged and
// every funnel is piped into ONE tank between the two rows. The tank has ten
// bays side by side, each its own gauge; `silos[k]` is bay k, so everything
// that already reads silos[k] (the beacon, the pulse, the prompts, the
// sidebar) keeps working. Only one solid is built for the whole tank, and
// its switch can be thrown from anywhere along its base (`use`): only one
// funnel is ever full and unflipped at a time.
// THE SWITCH ON EVERY TANK (2026-10-12: "a heavy-looking red handle switch at
// the base of each silo that does a heavy thunk when you hit F ... it should
// start in an up position & flip down when pressed ... at each blood
// reservoir section, so 10 total"). One per entry in silos[], so the giant
// tank carries ten. The state is `siloFlipped[i]`, which already rides the
// snapshot; the fall is timed from SND_THUNK (the host's event, arg = tank
// index) so it lands with the sound on every client, and a client that joins
// with a tank already pumped sees it down, not falling.
const LEVER_MS = 420;
let arcLeverAt = [];              // tank index -> when it was thrown (this client's clock)

function arcadeLeverThrown(i) { arcLeverAt[i] = Date.now(); }

// 0 up .. 1 down, with a little overshoot and a settle: that is what "heavy"
// looks like (the horde switch's lever did the same).
function arcadeLeverFrac(i, now) {
    if (!siloFlipped[i]) return 0;
    const t0 = arcLeverAt[i];
    if (!t0) return 1;
    const k = clamp((now - t0) / LEVER_MS, 0, 1);
    return k < 0.78 ? Math.pow(k / 0.78, 2) * 1.07 : 1.07 - 0.07 * ((k - 0.78) / 0.22);
}

// A back plate on the tank's face with a slot for the travel, a bolt for a
// pivot, and a fat red handle with a grip. Flat fills only.
function drawLeverSwitch(cx, base, frac, ready, now) {
    const px = Math.round(cx), top = base - 44;
    ctx.fillStyle = "#101012";
    ctx.fillRect(px - 17, top, 34, 40);
    ctx.fillStyle = "#505056";
    ctx.fillRect(px - 15, top + 2, 30, 36);
    ctx.fillStyle = "#26262A";
    ctx.fillRect(px - 4, top + 5, 8, 30);              // the slot it travels in
    ctx.fillStyle = "#9A9AA0";
    ctx.fillRect(px - 13, top + 4, 3, 3); ctx.fillRect(px + 10, top + 4, 3, 3);
    ctx.fillRect(px - 13, top + 33, 3, 3); ctx.fillRect(px + 10, top + 33, 3, 3);
    // The lamp: amber and flashing when the tank is full and waiting.
    ctx.fillStyle = siloFlippedLamp(frac, ready, now);
    ctx.fillRect(px + 7, top + 10, 5, 5);
    const pvx = px, pvy = top + 20;
    const ang = (-82 + 164 * frac) * Math.PI / 180;     // up .. down
    ctx.save();
    ctx.translate(pvx, pvy);
    ctx.rotate(ang);
    ctx.fillStyle = "rgba(0,0,0,0.55)";                // its shadow on the plate
    ctx.fillRect(1, -2, 24, 9);
    ctx.fillStyle = "#7A0C0C";
    ctx.fillRect(0, -5, 18, 10);                       // the arm
    ctx.fillStyle = "#C41818";
    ctx.fillRect(0, -5, 18, 7);
    ctx.fillStyle = "#FF5A48";
    ctx.fillRect(2, -4, 14, 2);                        // lit edge
    ctx.fillStyle = "#8A1010";
    ctx.fillRect(14, -8, 12, 16);                      // the grip
    ctx.fillStyle = "#E02A22";
    ctx.fillRect(14, -8, 12, 11);
    ctx.fillStyle = "#FF8A78";
    ctx.fillRect(16, -6, 8, 2);
    ctx.restore();
    ctx.fillStyle = "#BEBEC4";
    ctx.fillRect(pvx - 3, pvy - 3, 7, 7);              // the pivot bolt
    ctx.fillStyle = "#3A3A40";
    ctx.fillRect(pvx - 1, pvy - 1, 3, 3);
}

function siloFlippedLamp(frac, ready, now) {
    if (frac >= 1) return "#33FF55";
    if (ready) return now % 500 < 250 ? "#FFD23A" : "#7A5A10";
    return "#3A1A1A";
}

const GIANT_BAY_W = 80;
const GIANT_H = 120;              // footprint depth
const GIANT_LIFT = 130;           // how far up the screen it stands
let giantSilo = null;             // {x, y, w, h, lift} or null

function buildGiantSilo(cx, cy, nT) {
    const W = nT * GIANT_BAY_W;
    const x0 = Math.round(cx - W / 2), y0 = Math.round(cy - 60);
    giantSilo = { x: x0, y: y0, w: W, h: GIANT_H, lift: GIANT_LIFT };
    const use = { x: x0 - 8, y: y0 + GIANT_H - 6, w: W + 16, h: 40 };
    const z = zoneOf(cx, cy);
    const half = nT / 2;
    for (let k = 0; k < nT; k++) {
        silos[k] = { x: x0 + k * GIANT_BAY_W, y: y0, w: GIANT_BAY_W, h: GIANT_H, zone: z, giant: true, use: use };
        // Each funnel feeds the tank at its own point on the near edge: the top
        // row into the back of the lid, the bottom row into the base. The
        // bottom row runs right to left, so its column is mirrored: no
        // pipe crosses another.
        const f = funnels[k];
        const top = f.y < cy;
        const col = top ? k : (nT - 1 - k);
        // 2026-10-16: the riser stands in the GAP between two bays (the
        // seams sit at odd multiples of a bay from the tank's left edge),
        // clear of the sight-glasses and the switches.
        const px = cx + (col - (half - 1) / 2) * 160 - 2;
        siloPipes[k] = arcadePipeRoute(f, silos[k], px, top ? y0 : y0 + GIANT_H, top ? -1 : 1);
    }
}

function drawGiantSilo(now) {
    const g = giantSilo;
    if (!g) return;
    const lift = g.lift, n = silos.length;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(g.x + 14, g.y + 10, g.w, g.h);
    const faceY = g.y + g.h - lift;
    ctx.fillStyle = "#3A1A1E";
    ctx.fillRect(g.x, faceY, g.w, lift);
    let total = 0, cap = 0;
    ctx.font = "bold 12px Courier";
    ctx.textAlign = "center";
    for (let k = 0; k < n; k++) {
        const s = silos[k];
        const frac = Math.min(1, arcadeShownFill(k) / siloCapacity(k));    // lags the kills: THE BLOOD RUN
        total += siloFill[k]; cap += siloCapacity(k);
        const done = siloFlipped[k], ready = siloReady(k);
        // This bay's sight-glass, filling bottom-up.
        const gx = s.x + 8, gw = 22, gh = lift - 38;
        ctx.fillStyle = "#140608";
        ctx.fillRect(gx, faceY + 12, gw, gh);
        const fh = Math.round(gh * frac);
        ctx.fillStyle = done ? "#3C6A3C" : ready ? COLOR_BUY : "#C0182C";
        ctx.fillRect(gx, faceY + 12 + gh - fh, gw, fh);
        // The seam to the next bay.
        ctx.fillStyle = "#24100F";
        ctx.fillRect(s.x, faceY, 3, lift);
    }
    ctx.fillStyle = "#5A2A30";
    for (let h = 1; h <= 3; h++) ctx.fillRect(g.x, faceY + Math.round(lift * h / 4) - 12, g.w, 3);
    // One switch per bay, at its base: ten in all.
    for (let k = 0; k < n; k++) {
        const s = silos[k];
        drawLeverSwitch(s.x + 52, g.y + g.h - 4, arcadeLeverFrac(k, now), siloReady(k) && !siloFlipped[k], now);
    }
    // The lid, tinted per bay: spent green, ready flashing.
    for (let k = 0; k < n; k++) {
        const s = silos[k];
        ctx.fillStyle = siloFlipped[k] ? "#2C4A2C" : siloReady(k) ? (now % 500 < 250 ? COLOR_BUY : "#2E8A2E") : "#6A3238";
        ctx.fillRect(s.x, g.y - lift, s.w, g.h);
    }
    // Each bay's number, on its lid.
    ctx.font = "bold 14px Courier";
    for (let k = 0; k < n; k++) {
        const s = silos[k];
        ctx.fillStyle = siloFlipped[k] ? "#5A8A5A" : siloReady(k) ? COLOR_BUY : "#FFFFFF";
        ctx.fillText(String(k + 1), s.x + s.w / 2, g.y - lift + 24);
    }
    ctx.fillStyle = "#8A4A50";
    ctx.fillRect(g.x + 6, g.y - lift + 6, g.w - 12, 4);
    ctx.strokeStyle = "#995560";
    ctx.lineWidth = 2;
    ctx.strokeRect(g.x, g.y - lift, g.w, g.h + lift);
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 24px Courier";
    ctx.fillText("BLOOD RESERVOIR", g.x + g.w / 2, g.y - lift + g.h / 2 - 2);
    ctx.font = "bold 14px Courier";
    ctx.fillStyle = "#FFAAAA";
    ctx.fillText(total + " / " + cap, g.x + g.w / 2, g.y - lift + g.h / 2 + 20);
    // Which bay wants its switch thrown.
    for (let k = 0; k < n; k++) {
        if (!siloReady(k) || siloFlipped[k]) continue;
        ctx.fillStyle = COLOR_BUY;
        ctx.font = "bold 12px Courier";
        ctx.fillText("TANK " + (k + 1) + " FULL [F] SWITCH", g.x + g.w / 2, g.y + g.h + 16);
    }
    ctx.textAlign = "left";
}

// ---------------------------------------------------
//   ROADS (2026-10-12; reworked the same day: "limited to 45 degree angles and
//   0/90/180/270", "the road should look like it came before the things")
// ---------------------------------------------------
// The road is planned FIRST, before the tanks and their sets exist:
//
//   1. An A* over a 20px grid whose only moves are the eight compass
//      directions and whose bends cost a lot, so it prefers a straight line
//      from the way in (or the spawn) to the exit and bends only to slip
//      between the structures. Every segment is therefore 0, 45, 90, 135...
//      degrees, and a 90 degree change is two 45s with a diagonal between.
//      The structures it has to go round are the sets' footprints (the hedge
//      rings, the warehouse, the divider), taken from the layout; a forest is
//      soft (it costs more but may be crossed: its trees keep off the road).
//   2. The structures that still stand too close are NUDGED away from it, by
//      a few tens of px along one axis (`arcadeNudgeSets`): the tank's
//      position in the layout moves, so the funnel, tank and set all move.
//   3. The corridor goes into `clear` before anything is built, so trees,
//      containers and landmarks keep off it as well.
//
// Map 4 is hand-laid (a fixed layout): a stem, a split round both sides of the
// block and a rejoin, with its 90 degree corners chamfered at 45.
// Purely visual: nobody is slowed by it. Every client builds the same one
// (no randomness, same layout).
const ROAD_W = 112;
const ROAD_CELL = 40;
const ROAD_CLEAR = 92;            // half the road, and the trees' stand-off
const ROAD_EDGE = ROAD_W / 2 + 14; // planning: a structure's box this far from the centre line
const ROAD_NEED = ROAD_W / 2 + 44; // after the nudge: centre line to the nearest structure
const ROAD_TURN = 10;             // cost of a 45 degree bend, in cells
const SET_APART = 90;             // structures keep this between them: a gap is closed or walkable (78px for a brute)
const ROAD_NUDGE_MAX = 420;       // the most one structure is moved, in total, to make room
const ROAD_PLAN_SHRINK = 150;     // the plan may graze a structure's outer 150px: the nudge pays for it
const ROAD_OX = ARENA.x - ROAD_CELL / 2;   // the grid's cell CENTRES sit on x = ARENA.x + n * 20,
const ROAD_OY = ARENA.y - ROAD_CELL / 2;   // which puts the arena's centre line (and the exit's) on one
const ROAD_DIRS = [[0, 1], [1, 1], [1, 0], [1, -1], [0, -1], [-1, -1], [-1, 0], [-1, 1]];
let arenaRoads = [];              // [{ pts: [[x, y], ...] }]
let arenaDividerOff = null;       // map 3's divider, after the nudge: {x, y, w, h} relative to the centre

// What the road must go round for one tank, from where it is in the layout.
// `hard` boxes it will not enter; `soft` ones it may cross at a cost.
function arcadeSetBox(kind, fx, fy) {
    const r = ARENA_FUNNEL_R;
    const sx = fx + r + ARENA_PIPE_RUN, sy = fy - ARENA_SILO_H / 2;
    const x0 = fx - r, x1 = sx + ARENA_SILO_W;
    const y0 = Math.min(fy - r, sy - SILO_LIFT), y1 = Math.max(fy + r, sy + ARENA_SILO_H + 40);
    const c = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    // `core` is the funnel, the pipe and the tank: never crossed. `hard` is the
    // set's outline (the plan may graze its outer part; the nudge pays for it).
    const core = grow(c, 40);
    if (kind === "warehouse") return { core: core, hard: { x: c.x - WH_SIDE, y: c.y - WH_TOP, w: c.w + WH_SIDE * 2, h: c.h + WH_TOP + WH_BOTTOM } };
    if (kind === "forest") return { core: core, soft: { x: c.x - 500, y: c.y - 360, w: c.w + 800, h: c.h + 720 }, hard: core };
    return { core: core, hard: grow(c, 100 + HEDGE_T + 200) };  // hedge: the outer ring (see buildHedgeSet)
}

// Distance from a point to a box; NEGATIVE inside it (how deep), so a road that
// runs through a structure still has a slope to climb away down.
function arcadeRectDist(px, py, b) {
    const dx = Math.max(b.x - px, px - (b.x + b.w)), dy = Math.max(b.y - py, py - (b.y + b.h));
    if (dx > 0 || dy > 0) return Math.hypot(Math.max(dx, 0), Math.max(dy, 0));
    return Math.max(dx, dy);
}

// Octilinear A*: state = cell x heading. `hard` and `soft` are masks.
function arcadeRoadAStar(hard, soft, graze, cols, rows, s, e) {
    const A = ARENA, C = ROAD_CELL;
    const cellOf = function (p) {
        return Math.max(0, Math.min(rows - 1, Math.floor((p[1] - ROAD_OY) / C))) * cols +
               Math.max(0, Math.min(cols - 1, Math.floor((p[0] - ROAD_OX) / C)));
    };
    const si = cellOf(s), ei = cellOf(e);
    const ex = ei % cols, ey = Math.floor(ei / cols);
    const N = cols * rows * 8;
    const gs = new Float32Array(N).fill(Infinity);
    const from = new Int32Array(N).fill(-1);
    const closed = new Uint8Array(N);
    const heap = [];
    const push = function (f, i) {
        heap.push([f, i]);
        let k = heap.length - 1;
        while (k > 0) {
            const p = (k - 1) >> 1;
            if (heap[p][0] <= heap[k][0]) break;
            const t = heap[p]; heap[p] = heap[k]; heap[k] = t; k = p;
        }
    };
    const pop = function () {
        const top = heap[0], last = heap.pop();
        if (heap.length) {
            heap[0] = last;
            let k = 0;
            for (;;) {
                const l = k * 2 + 1, r = l + 1;
                let m = k;
                if (l < heap.length && heap[l][0] < heap[m][0]) m = l;
                if (r < heap.length && heap[r][0] < heap[m][0]) m = r;
                if (m === k) break;
                const t = heap[m]; heap[m] = heap[k]; heap[k] = t; k = m;
            }
        }
        return top;
    };
    const h = function (cell) {
        const dx = Math.abs((cell % cols) - ex), dy = Math.abs(Math.floor(cell / cols) - ey);
        return Math.max(dx, dy) + 0.4142 * Math.min(dx, dy);
    };
    const start = si * 8;                      // heading south: out of the tunnel
    gs[start] = 0;
    push(h(si), start);
    let end = -1;
    while (heap.length) {
        const cur = pop()[1];
        if (closed[cur]) continue;
        closed[cur] = 1;
        const cell = cur >> 3, d = cur & 7;
        if (cell === ei && d === 0) { end = cur; break; }      // and it comes in heading south, into the gate
        const cx = cell % cols, cy = Math.floor(cell / cols);
        for (let t = -1; t <= 1; t++) {
            const nd = (d + t + 8) & 7;
            const dx = ROAD_DIRS[nd][0], dy = ROAD_DIRS[nd][1];
            const nx = cx + dx, ny = cy + dy;
            if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
            const nc = ny * cols + nx;
            if (hard[nc]) continue;
            if (dx && dy && (hard[cy * cols + nx] || hard[ny * cols + cx])) continue;   // no corner cutting
            const ns = nc * 8 + nd;
            if (closed[ns]) continue;
            const cost = gs[cur] + (dx && dy ? 1.4142 : 1) * (1 + (soft[nc] ? 0.7 : 0) + (graze[nc] ? 3 : 0)) + (t ? ROAD_TURN : 0);
            if (cost < gs[ns]) { gs[ns] = cost; from[ns] = cur; push(cost + h(nc), ns); }
        }
    }
    if (end < 0) return null;
    // Cells -> corner points only (drop the collinear ones).
    const cells = [];
    for (let i = end; i >= 0; i = from[i]) { cells.push(i); if (i === start) break; }
    cells.reverse();
    const pts = [[s[0], s[1]]];
    for (let i = 1; i < cells.length; i++) {
        const c = cells[i] >> 3, nd = cells[i] & 7;
        // A corner is where the heading changes: the run ends at this cell.
        if (i === cells.length - 1 || (cells[i + 1] & 7) !== nd) {
            pts.push([ARENA.x + (c % cols) * C, ARENA.y + Math.floor(c / cols) * C]);
        }
    }
    pts[pts.length - 1] = [e[0], e[1]];
    return pts;
}

function arcadeRoadMask(rects, margin, cols, rows, ends) {
    const A = ARENA, C = ROAD_CELL;
    const m = new Uint8Array(cols * rows);
    const mark = function (x0, y0, x1, y1) {
        const c0 = Math.max(0, Math.floor((x0 - ROAD_OX) / C)), c1 = Math.min(cols - 1, Math.floor((x1 - ROAD_OX) / C));
        const r0 = Math.max(0, Math.floor((y0 - ROAD_OY) / C)), r1 = Math.min(rows - 1, Math.floor((y1 - ROAD_OY) / C));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) m[r * cols + c] = 1;
    };
    for (let i = 0; i < rects.length; i++) {
        const b = rects[i];
        mark(b.x - margin, b.y - margin, b.x + b.w + margin, b.y + b.h + margin);
    }
    return { m: m, mark: mark };
}

// Route, make room, and return { roads, offs, div }. `offs[k]` is tank k's
// [dx, dy] from the world centre after the nudge.
function arcadePlanRoads(LAY, cx, cy) {
    const A = ARENA;
    const nT = LAY.funnels.length;
    const div0 = LAY.divider ? { x: LAY.divider.x, y: LAY.divider.y, w: LAY.divider.w, h: LAY.divider.h } : null;
    const gx = escapeRect.x + escapeRect.w / 2, wallY = escapeRect.y;
    const lead = arcLevelNo >= 2 ? [[cx, 40]] : [];
    const tail = [[gx, WORLD_H - 40]];

    if (LAY.boss) {
        // Fixed: down from the way in, split north of the block, one half down
        // each side, both rejoin south of it on the way to the exit; every
        // 90 degree corner cut at 45.
        const ys = cy - 790, yn = cy + 740, xo = 1540;
        return {
            offs: LAY.funnels.map(function (o) { return [o[0], o[1]]; }), div: div0,
            roads: [
                { pts: [[cx, 40], [cx, ys]] },
                { pts: arcadeChamfer([[cx, ys], [cx - xo, ys], [cx - xo, yn], [gx, yn]], 200) },
                { pts: arcadeChamfer([[cx, ys], [cx + xo, ys], [cx + xo, yn], [gx, yn]], 200) },
                { pts: [[gx, yn], [gx, WORLD_H - 40]] }
            ]
        };
    }

    const C = ROAD_CELL;
    const cols = Math.ceil(A.w / C) + 1, rows = Math.ceil(A.h / C) + 1;
    // On the lattice (see ROAD_OX), so a vertical leg is exactly vertical.
    const start = arcLevelNo >= 2 ? [cx, A.y + 80] : [cx, cy + FOUNTAIN_DY + ROUNDABOUT_R];
    const goal = [gx, wallY - 105];
    const inside = function (b) {
        return b.x >= A.x + WALL_T + 8 && b.y >= A.y + WALL_T + 8 && b.x + b.w <= A.x + A.w - WALL_T - 8 && b.y + b.h <= A.y + A.h - WALL_T - 8;
    };
    const shrunk = function (b) {
        const m = Math.min(ROAD_PLAN_SHRINK, (b.w - 40) / 2, (b.h - 40) / 2);
        return { x: b.x + m, y: b.y + m, w: b.w - m * 2, h: b.h - m * 2 };
    };
    const prio = function (it) { return it.kind === "forest" ? 0 : it.kind === "hedge" ? 1 : 2; };   // who gives way to whom

    // One whole attempt: items at their layout positions, a road, then room
    // made for it. `graze` is how far from a structure's outline the plan
    // prefers to stay (the dear zone); the structures that cannot be made to
    // fit are counted, so the better attempt can be chosen.
    const attempt = function (graze) {
        const offs = LAY.funnels.map(function (o) { return [o[0], o[1]]; });
        const div = div0 ? { x: div0.x, y: div0.y, w: div0.w, h: div0.h } : null;
        const items = [];       // { k | -1, kind, hard, core, soft }
        for (let k = 0; k < nT; k++) {
            const b = arcadeSetBox(LAY.sets[k], cx + offs[k][0], cy + offs[k][1]);
            items.push({ k: k, kind: LAY.sets[k], hard: b.hard, core: b.core, soft: b.soft || null, moved: 0 });
        }
        if (div) items.push({ k: -1, kind: "divider", hard: { x: cx + div.x, y: cy + div.y, w: div.w, h: div.h }, core: null, soft: null, moved: 0 });

        let mid = null;
        // The road over the structures where they stand NOW.
        const route = function () {
            const planBoxes = [];
            items.forEach(function (it) {
                planBoxes.push(shrunk(it.hard));
                if (it.core) planBoxes.push(it.core);      // the funnel, pipe and tank: never grazed
            });
            const hardM = arcadeRoadMask(planBoxes, ROAD_EDGE, cols, rows);
            const softM = arcadeRoadMask(items.filter(function (it) { return it.soft; }).map(function (it) { return it.soft; }), 0, cols, rows);
            const e = WALL_T + ROAD_EDGE;                       // the fence
            hardM.mark(A.x, A.y, A.x + A.w, A.y + e);
            hardM.mark(A.x, A.y + A.h - e, A.x + A.w, A.y + A.h);
            hardM.mark(A.x, A.y, A.x + e, A.y + A.h);
            hardM.mark(A.x + A.w - e, A.y, A.x + A.w, A.y + A.h);
            // The two ends are free by definition: a little patch round each.
            [start, goal].forEach(function (p) {
                for (let r = Math.floor((p[1] - 60 - ROAD_OY) / C); r <= Math.floor((p[1] + 60 - ROAD_OY) / C); r++) {
                    for (let c = Math.floor((p[0] - 60 - ROAD_OX) / C); c <= Math.floor((p[0] + 60 - ROAD_OX) / C); c++) {
                        if (r >= 0 && c >= 0 && r < rows && c < cols) hardM.m[r * cols + c] = 0;
                    }
                }
            });
            // Inside a structure's real outline is allowed but dear: the road
            // goes round wherever it can, and only grazes where it has no other
            // way, which is exactly what the nudge then makes room for.
            const grazeM = arcadeRoadMask(items.map(function (it) { return it.hard; }), graze, cols, rows);
            let m = arcadeRoadAStar(hardM.m, softM.m, grazeM.m, cols, rows, start, goal);
            if (!m) {
                // Boxed in: a plain Z, 45 degrees across.
                const dx = goal[0] - start[0], ya = Math.max(start[1] + 60, goal[1] - 100 - Math.abs(dx));
                m = [start, [start[0], ya], [goal[0], ya + Math.abs(dx)], goal];
            }
            return m;
        };
        // How far the centre line is from a box (20px samples).
        const dist = function (b) {
            let best = Infinity;
            for (let i = 1; i < mid.length; i++) {
                const a = mid[i - 1], q = mid[i];
                const n = Math.max(1, Math.ceil(Math.hypot(q[0] - a[0], q[1] - a[1]) / 20));
                for (let t = 0; t <= n; t++) {
                    const d = arcadeRectDist(a[0] + (q[0] - a[0]) * t / n, a[1] + (q[1] - a[1]) * t / n, b);
                    if (d < best) best = d;
                }
            }
            return best;
        };
        const shift = function (it, sx, sy) {
            it.hard = { x: it.hard.x + sx, y: it.hard.y + sy, w: it.hard.w, h: it.hard.h };
            if (it.core) it.core = { x: it.core.x + sx, y: it.core.y + sy, w: it.core.w, h: it.core.h };
            if (it.soft) it.soft = { x: it.soft.x + sx, y: it.soft.y + sy, w: it.soft.w, h: it.soft.h };
            if (it.k >= 0) { offs[it.k][0] += sx; offs[it.k][1] += sy; }
            else { div.x += sx; div.y += sy; }
            it.moved += Math.hypot(sx, sy);
        };
        const DIRS8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];
        // Make room: a structure too near the road climbs away from it, 20px
        // at a time in whichever of the eight directions helps most (a road
        // that wraps a corner needs it moved across both axes); whatever it
        // is then pushed onto, the lesser of the two gives way. Bounded.
        const relax = function () {
            for (let pass = 0; pass < 6; pass++) {
                let changed = false;
                for (let i = 0; i < items.length; i++) {
                    const it = items[i];
                    let d = dist(it.hard);
                    for (let step = 0; step < 20 && d < ROAD_NEED && it.moved < ROAD_NUDGE_MAX; step++) {
                        let bestD = d, bestDir = null;
                        for (let q = 0; q < 8; q++) {
                            const nb = { x: it.hard.x + DIRS8[q][0] * 20, y: it.hard.y + DIRS8[q][1] * 20, w: it.hard.w, h: it.hard.h };
                            if (!inside(nb)) continue;
                            const nd = dist(nb);
                            if (nd > bestD + 0.5) { bestD = nd; bestDir = DIRS8[q]; }
                        }
                        if (!bestDir) break;
                        shift(it, bestDir[0] * 20, bestDir[1] * 20);
                        d = bestD;
                        changed = true;
                    }
                }
                for (let i = 0; i < items.length; i++) {
                    for (let j = i + 1; j < items.length; j++) {
                        const A1 = items[i], B1 = items[j];
                        if (!rectsOverlap(grow(A1.hard, SET_APART), B1.hard)) continue;
                        const mover = prio(A1) <= prio(B1) ? A1 : B1, stay = mover === A1 ? B1 : A1;
                        const mb = mover.hard, sb = stay.hard, g = SET_APART;
                        const opts = [[(sb.x - g) - (mb.x + mb.w), 0], [(sb.x + sb.w + g) - mb.x, 0],
                                      [0, (sb.y - g) - (mb.y + mb.h)], [0, (sb.y + sb.h + g) - mb.y]].sort(function (u, v) {
                            return Math.hypot(u[0], u[1]) - Math.hypot(v[0], v[1]);
                        });
                        for (let o = 0; o < opts.length; o++) {
                            const nb = { x: mb.x + opts[o][0], y: mb.y + opts[o][1], w: mb.w, h: mb.h };
                            if (!inside(nb)) continue;
                            shift(mover, Math.round(opts[o][0] / 20) * 20, Math.round(opts[o][1] / 20) * 20);
                            changed = true;
                            break;
                        }
                    }
                }
                if (!changed) break;
            }
        };
        // Plan, make room, and plan again where things now stand: the second
        // plan is usually straighter, because the first one bent round what
        // had to move. The last plan is the road; the last relaxation made
        // room for IT.
        for (let iter = 0; iter < 2; iter++) {
            mid = route();
            relax();
        }
        let bad = 0, moved = 0, len = 0;
        for (let i = 0; i < items.length; i++) {
            if (dist(items[i].hard) < ROAD_NEED - 12) bad += 1;
            for (let j = i + 1; j < items.length; j++) if (rectsOverlap(grow(items[i].hard, SET_APART - 12), items[j].hard)) bad += 1;
            moved += items[i].moved;
        }
        for (let i = 1; i < mid.length; i++) len += Math.hypot(mid[i][0] - mid[i - 1][0], mid[i][1] - mid[i - 1][1]);
        return { mid: mid, offs: offs, div: div, score: bad * 100000 + moved * 3 + len };
    };

    // Two readings of "keep clear": hug close (the nudge makes up the rest) or
    // keep a full margin where there is room. The better result wins.
    const a = attempt(ROAD_EDGE), b = attempt(ROAD_NEED);
    const best = b.score < a.score ? b : a;
    const roads = [{ pts: lead.concat(best.mid, tail) }];
    if (arcLevelNo <= 1) {
        // The road turns into a roundabout round the fountain.
        const fy = cy + FOUNTAIN_DY;
        roads.push({ pts: arcadeRoundaboutPts(cx, fy) });   // a closed loop: nothing leads north
    }
    return { offs: best.offs, div: best.div, roads: roads };
}

// Cut every 90 degree corner of an axis-aligned polyline with a 45 degree
// diagonal, `c` px back along each edge at most (never more than half an edge).
function arcadeChamfer(pts, c) {
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
        const a = pts[i - 1], b = pts[i], n = pts[i + 1];
        const l1 = Math.hypot(a[0] - b[0], a[1] - b[1]) || 1, l2 = Math.hypot(n[0] - b[0], n[1] - b[1]) || 1;
        const d = Math.min(c, l1 / 2, l2 / 2);
        out.push([b[0] + (a[0] - b[0]) * d / l1, b[1] + (a[1] - b[1]) * d / l1]);
        out.push([b[0] + (n[0] - b[0]) * d / l2, b[1] + (n[1] - b[1]) * d / l2]);
    }
    out.push(pts[pts.length - 1]);
    return out;
}

// Keep trees, bushes, containers and landmarks off it: a box every ~50px.
function arcadeReserveRoads(roads, clear) {
    for (let i = 0; i < roads.length; i++) {
        const pts = roads[i].pts;
        for (let k = 1; k < pts.length; k++) {
            const a = pts[k - 1], b = pts[k];
            const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 50));
            for (let t = 0; t <= n; t++) {
                const x = a[0] + (b[0] - a[0]) * t / n, y = a[1] + (b[1] - a[1]) * t / n;
                clear.push({ x: x - ROAD_CLEAR, y: y - ROAD_CLEAR, w: ROAD_CLEAR * 2, h: ROAD_CLEAR * 2 });
            }
        }
    }
}

// Flat fills only: a dark kerb, the asphalt, and a dashed centre line.
function arcadeDrawRoads() {
    if (!arenaRoads.length) return;
    ctx.save();
    ctx.lineJoin = "round";
    ctx.lineCap = "butt";
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < arenaRoads.length; i++) {
            const pts = arenaRoads[i].pts;
            if (pts.length < 2) continue;
            ctx.beginPath();
            ctx.moveTo(pts[0][0], pts[0][1]);
            for (let k = 1; k < pts.length; k++) ctx.lineTo(pts[k][0], pts[k][1]);
            if (pass === 0) { ctx.strokeStyle = "#161616"; ctx.lineWidth = ROAD_W + 12; ctx.setLineDash([]); }
            else if (pass === 1) { ctx.strokeStyle = "#3B3B3D"; ctx.lineWidth = ROAD_W; ctx.setLineDash([]); }
            else { ctx.strokeStyle = "#A8943A"; ctx.lineWidth = 4; ctx.setLineDash([30, 28]); }
            ctx.stroke();
        }
    }
    ctx.setLineDash([]);
    ctx.restore();
}

// The same, clipped to a rect: the entry tunnel's floor is drawn after the
// ground and would otherwise cover its stretch of road.
function arcadeDrawRoadsIn(x, y, w, h) {
    if (!arenaRoads.length) return;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x, y, w, h);
    ctx.clip();
    arcadeDrawRoads();
    ctx.restore();
}

// Map 4's cover (2026-10-12: "add some walls & shipping containers in an
// almost symmetrical arrangement on this level so it's not quite so open").
// Right-hand pieces are listed; the left is their mirror with two small
// differences, so it is "almost". Gaps are >= 122px clear of every funnel
// ring, and nothing stands in the road, the giant silo's base or the exit.
function arcadeBuildBossCover(clear) {
    const cx = WORLD_W / 2, cy = WORLD_H / 2;
    const cont = function (x, foot, w, fh, levels, vertical, hue) {
        pushProp("container", cx + x, cy + foot, w, fh, SET_CONTAINER_LIFT * levels,
                 { levels: levels, hue: SET_CONTAINER_HUES[hue % SET_CONTAINER_HUES.length], vertical: vertical });
        clear.push(grow({ x: cx + x, y: cy + foot - fh - SET_CONTAINER_LIFT * levels, w: w, h: fh + SET_CONTAINER_LIFT * levels }, 40));
    };
    const wall = function (x, foot, w, fh) {
        pushProp("divider", cx + x, cy + foot, w, fh, 44);
        clear.push(grow({ x: cx + x, y: cy + foot - fh - 44, w: w, h: fh + 44 }, 40));
    };
    // [kind, x, footY, w, fh, levels, vertical, hue, left-hand nudge]
    const P = [
        // the band between the rows
        ["c", 560, 20, 150, 56, 2, false, 0, 0],
        ["w", 880, 150, 40, 180, 0, true, 0, 0],
        ["c", 1040, 60, 56, 150, 1, true, 1, 40],
        ["c", 1220, 150, 150, 56, 1, false, 2, 0],
        // the north row: a container and a wall in the gaps between funnels
        ["c", 872, -395, 56, 150, 2, true, 3, 0],
        ["w", 280, -370, 40, 200, 0, true, 0, 0],
        // the south row, the same
        ["c", 872, 475, 56, 150, 2, true, 3, 0],
        ["w", 280, 500, 40, 200, 0, true, 0, -40]
    ];
    for (let i = 0; i < P.length; i++) {
        const p = P[i];
        for (let side = 0; side < 2; side++) {
            const x = side === 0 ? p[1] : -p[1] - p[3] + (p[8] || 0);
            if (p[0] === "c") cont(x, p[2], p[3], p[4], p[5], p[6], p[7] + side);
            else wall(x, p[2], p[3], p[4]);
        }
    }
}

// ---------------------------------------------------
//   WHERE TO GO NEXT
// ---------------------------------------------------
// "It needs to be very visually clear where the silos are." One target at a
// time, shared by the in-world beacon, the edge-of-screen arrow and the
// sidebar map, so all three always agree.
function arcadeObjectiveTarget() {
    if (won) return null;
    for (let k = 0; k < funnels.length; k++) {
        if (siloFlipped[k]) continue;
        if (siloReady(k)) {
            // On the switch itself (the plate at the tank's base, drawLeverSwitch),
            // not the middle of the tank: on the giant reservoir the middle of a
            // bay is a long way up the face from where F works.
            const s = silos[k];
            const sw = s.giant ? 52 : 48;
            return { x: s.x + sw, y: s.y + s.h - 26, r: 46, k: k, kind: "silo",
                     label: "TANK " + (k + 1) + "  [F]" };
        }
        const f = funnels[k];
        if (!f) return null;
        return { x: f.x, y: f.y, r: f.r, k: k, kind: "funnel",
                 label: "TANK " + (k + 1) + "  " + siloFill[k] + "/" + siloCapacity(k) };
    }
    if (!escapeRect) return null;
    return { x: escapeRect.x + escapeRect.w / 2, y: escapeRect.y + escapeRect.h / 2, r: 110, kind: "gate",
             label: escapeOpen() ? "EXIT" : "EXIT  " + Math.max(0, Math.ceil((escapeAt - Date.now()) / 1000)) + "s" };
}

// Screen space, after the lighting, so the dark never hides it.
function arcadeDrawBeacon(now) {
    const t = arcadeObjectiveTarget();
    if (!t) return;
    const s = worldToScreen(t.x, t.y);
    const r = Math.max(18, t.r * camera.scale);
    const pulse = 0.5 + 0.5 * Math.sin(now / 180);
    const col = t.kind === "gate" ? ICON_CYAN : t.kind === "silo" ? COLOR_BUY : COLOR_PICKUP;
    ctx.save();
    ctx.strokeStyle = col;
    ctx.globalAlpha = 0.45 + 0.45 * pulse;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(Math.round(s.x), Math.round(s.y), r + 6 + pulse * 8, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.font = "bold 15px Courier";
    ctx.textAlign = "center";
    const ty = Math.round(s.y - r - 22);
    const w = ctx.measureText(t.label).width + 14;
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fillRect(Math.round(s.x - w / 2), ty - 15, Math.round(w), 21);
    ctx.fillStyle = col;
    ctx.fillText(t.label, Math.round(s.x), ty);
    ctx.restore();

    // Off screen: an arrow on the edge, in the objective's colour.
    const margin = 58;
    if (s.x > margin && s.x < canvas.width - margin && s.y > margin && s.y < canvas.height - margin) return;
    const ccx = canvas.width / 2, ccy = canvas.height / 2;
    const ang = Math.atan2(s.y - ccy, s.x - ccx);
    const k = Math.min(Math.abs((ccx - margin) / Math.cos(ang)) || Infinity,
                       Math.abs((ccy - margin) / Math.sin(ang)) || Infinity);
    const ex = ccx + Math.cos(ang) * k, ey = ccy + Math.sin(ang) * k;
    ctx.save();
    ctx.translate(ex, ey);
    ctx.rotate(ang);
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(22, 0); ctx.lineTo(-12, -15); ctx.lineTo(-4, 0); ctx.lineTo(-12, 15);
    ctx.closePath();
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = col;
    ctx.font = "bold 12px Courier";
    ctx.textAlign = "center";
    const short = t.kind === "gate" ? "EXIT" : "TANK " + (t.k + 1);
    ctx.fillText(short, Math.round(ex - Math.cos(ang) * 30), Math.round(ey - Math.sin(ang) * 30) + 4);
    ctx.textAlign = "left";
}

// ---------------------------------------------------
//   THE SIDEBAR
// ---------------------------------------------------
// "A permanent minimap ... on a right sidebar ... the whole map ... the
// rest of the UI is pushed onto there ... it's OK not to reflect zombies."
// The panel is #sidebar in Zombie.html. The stats, the loadout and the
// objective line are MOVED into it at boot (arcadeMountSidebar), not
// duplicated, so every existing HUD writer keeps working unchanged.
let sideCanvas = null, sideCtx = null, sideStatic = null, sideStaticKey = "";
let sideGoalsSig = "";

function sidebarWidth() {
    const el = document.getElementById("sidebar");
    return el ? el.offsetWidth : 0;
}

function arcadeMountSidebar() {
    const bar = document.getElementById("sidebar");
    if (!bar) return;
    document.body.classList.add("arcade");
    const slot = document.getElementById("sideHud");
    const ui = document.getElementById("ui");
    const lo = document.getElementById("loadout");
    const obj = document.getElementById("objective");
    if (slot && ui) slot.appendChild(ui);
    if (slot && lo) slot.appendChild(lo);
    const next = document.getElementById("sideNext");
    if (next && obj) next.appendChild(obj);
    sideCanvas = document.getElementById("sidemap");
    sideCtx = sideCanvas ? sideCanvas.getContext("2d") : null;
}

// The ground, the fence and the landmarks: drawn once a level.
function buildSideStatic() {
    const w = sideCanvas.width, h = sideCanvas.height;
    const c = document.createElement("canvas");
    c.width = w; c.height = h;
    const g = c.getContext("2d");
    const k = w / ARENA.w;
    g.fillStyle = "#26381C";
    g.fillRect(0, 0, w, h);
    g.strokeStyle = "#4A4A4C";
    g.lineWidth = Math.max(2, ROAD_W * k * 0.8);
    g.lineJoin = "round";
    for (let r = 0; r < arenaRoads.length; r++) {
        const pts = arenaRoads[r].pts;
        if (pts.length < 2) continue;
        g.beginPath();
        g.moveTo((pts[0][0] - ARENA.x) * k, (pts[0][1] - ARENA.y) * k);
        for (let i = 1; i < pts.length; i++) g.lineTo((pts[i][0] - ARENA.x) * k, (pts[i][1] - ARENA.y) * k);
        g.stroke();
    }
    for (let i = 0; i < walls.length; i++) {
        const wl = walls[i];
        if (wl.perim || wl.column || wl.gateBar || wl.entryBar) continue;
        if (wl.silo && !giantSilo) continue;
        g.fillStyle = (wl.tree || wl.kind === "hedge") ? "#2E5A22"
                    : wl.kind === "container" ? wl.hue[0] : wl.kind === "pallet" ? "#7A5A30"
                    : wl.kind === "rack" ? "#C8641E" : "#4A4A4A";
        const m = wl.tree ? 3 : 0;
        g.fillRect((wl.x - ARENA.x) * k - m, (wl.y - ARENA.y) * k - m, Math.max(2, wl.w * k) + m * 2, Math.max(2, wl.h * k) + m * 2);
    }
    g.strokeStyle = "#8A8A8A";
    g.lineWidth = 2;
    g.strokeRect(1, 1, w - 2, h - 2);
    return c;
}

function arcadeDrawSidebar(now) {
    if (!sideCtx) return;
    if (typeof inputHidesRadar === "function" && inputHidesRadar()) return;   // phone: the radar is hidden
    const bar = document.getElementById("sidebar");
    const want = Math.max(120, (bar ? bar.clientWidth : 240) - 24 - 12);   // the radar frame
    const wantH = Math.round(want * ARENA.h / ARENA.w);
    if (sideCanvas.width !== want || sideCanvas.height !== wantH) {
        sideCanvas.width = want;
        sideCanvas.height = wantH;
        sideStaticKey = "";
    }
    const key = levelSeed + ":" + arcLevelNo + ":" + want;
    if (key !== sideStaticKey) { sideStatic = buildSideStatic(); sideStaticKey = key; }

    const g = sideCtx, k = want / ARENA.w;
    const X = function (x) { return (x - ARENA.x) * k; };
    const Y = function (y) { return (y - ARENA.y) * k; };
    g.drawImage(sideStatic, 0, 0);
    // Nothing throbs on the start card: the blinks and the objective ring hold
    // still until a run begins.
    const blink = gameStarted && (now % 600) < 300;
    const target = arcadeObjectiveTarget();

    // The gate, in the south wall.
    if (escapeRect) {
        const open = escapeOpen();
        g.fillStyle = open ? (blink ? "#FFFFFF" : ICON_CYAN) : escapeAt ? ICON_CYAN : "#2A5560";
        g.fillRect(X(escapeRect.x), Y(escapeRect.y + escapeRect.h - 14) - 3, escapeRect.w * k, 7);
        g.font = "bold 10px Courier";
        g.textAlign = "center";
        g.fillText("EXIT", X(escapeRect.x + escapeRect.w / 2), Y(escapeRect.y) - 6);
    }

    // The chain: funnel ring + numbered tank, coloured by what it wants.
    for (let i = 0; i < funnels.length; i++) {
        const f = funnels[i], s = silos[i];
        if (!f || !s) continue;
        const done = siloFlipped[i];
        const ready = siloReady(i);
        const live = funnelActive[i] && !ready;
        const col = done ? "#3C6A3C" : ready ? COLOR_BUY : live ? COLOR_PICKUP : "#555555";
        g.strokeStyle = col;
        g.lineWidth = (live || ready) && blink ? 3 : 2;
        g.beginPath();
        g.arc(X(f.x), Y(f.y), Math.max(5, f.r * k), 0, Math.PI * 2);
        g.stroke();
        // The tank, filling bottom-up.
        const sx = X(s.x), sy = Y(s.y), sw = Math.max(8, s.w * k), sh = Math.max(10, s.h * k);
        g.fillStyle = "#111111";
        g.fillRect(sx, sy, sw, sh);
        const frac = Math.min(1, siloFill[i] / siloCapacity(i));
        g.fillStyle = col;
        g.fillRect(sx, sy + sh * (1 - frac), sw, sh * frac);
        g.strokeStyle = col;
        g.lineWidth = 1;
        g.strokeRect(sx + 0.5, sy + 0.5, sw - 1, sh - 1);
        g.fillStyle = done ? "#5A8A5A" : "#FFFFFF";
        g.font = "bold 13px Courier";
        g.textAlign = "center";
        g.fillText(String(i + 1), X(f.x), Y(f.y) + 5);
    }

    // The current objective, ringed.
    if (target) {
        g.strokeStyle = target.kind === "gate" ? ICON_CYAN : target.kind === "silo" ? COLOR_BUY : COLOR_PICKUP;
        g.globalAlpha = gameStarted ? 0.5 + 0.5 * Math.sin(now / 180) : 0.8;
        g.lineWidth = 2;
        g.beginPath();
        g.arc(X(target.x), Y(target.y), Math.max(9, target.r * k) + 5, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
    }

    // Drops, so a callout has somewhere to point. No zombies, on request.
    for (let i = 0; i < pickups.length; i++) {
        const d = pickups[i];
        g.fillStyle = DROP_HAZARD[d.type] ? "#FF2233" : d.type === "gun" ? ICON_CYAN : d.type === "perk" ? ICON_WORLD_HUE : COLOR_PICKUP;
        g.fillRect(X(d.x) - 2, Y(d.y) - 2, 4, 4);
    }

    g.fillStyle = ICON_CYAN;
    for (let i = 0; i < arcTurrets.length; i++) g.fillRect(X(arcTurrets[i].x) - 2, Y(arcTurrets[i].y) - 2, 5, 5);

    // Teammates, then you on top.
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        g.fillStyle = r.away ? "#3A4A44" : (r.downed ? (blink ? "#FFFFFF" : COLOR_DOWNED) : (r.color || "#55FFFF"));
        g.fillRect(X(r.x) - 3, Y(r.y) - 3, 7, 7);
    }
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        g.fillStyle = "#FFFFFF";
        g.fillRect(X(p.x) - 5, Y(p.y) - 5, 11, 11);
        g.fillStyle = p.downed ? COLOR_DOWNED : (p.color || "#55FFFF");
        g.fillRect(X(p.x) - 3, Y(p.y) - 3, 7, 7);
    }
    g.textAlign = "left";

    arcadeRenderSideGoals();
    arcadeUpdateCabinet();
}

// The checklist under the map, rewritten only when it changes.
function arcadeRenderSideGoals() {
    const el = document.getElementById("sideGoals");
    if (!el) return;
    const goals = mapGoals();
    const next = nextGoal(goals);
    let html = "";
    let sig = "";
    for (let i = 0; i < goals.length; i++) {
        const g = goals[i];
        const state = g.done ? "done" : (g === next ? "now" : "todo");
        sig += state + g.progress + "|";
        html += "<li class='" + state + "'><span class='box'></span><span class='gt'>" + g.short +
                "</span><span class='gp'>" + (g.progress || "") + "</span></li>";
    }
    if (sig === sideGoalsSig) return;
    sideGoalsSig = sig;
    el.innerHTML = html;
}

// ---------------------------------------------------
//   TERRAIN (2026-10-04, second playtest note)
// ---------------------------------------------------
// "More interspersed terrain would help break up some of the monotony like
// sparse trees & bushes with denser patches & grass throughout, rather than
// the alternate floor tiles." So: one grass ground for the whole arena, a few
// dense patches (trees and bushes clumped round a centre) and a sparse
// scatter between them.
//
// TREES ARE SOLID (a trunk in walls[], tagged `tree`, so they block shots and
// bodies and the nav grid routes round them). BUSHES ARE NOT -- they are
// ground cover, drawn only, so a patch reads as dense without walling anyone
// in. Trunks keep TREE_GAP apart, over the 78px every brute needs, so no
// patch can seal a pocket.
//
// MP.random(), never Math.random(): every client must grow the same forest.
const TREE_TRUNK = 40;           // the whole footprint is solid, not just a trunk
const TREE_CANOPY = 64;
const TREE_GAP = 90;              // edge to edge between whole trees; over the 78px a brute needs
const ARENA_PATCHES = 20;          // 6 -> 8 ("more patches") -> 11 (+33%) -> 20 (the buffer: same density)
let arenaBushes = [];             // {x, y, r, shade} -- drawn only
let arenaTrees = [];              // the same rects as the tree walls, for drawing

// A TREE IS SOLID OVER ITS WHOLE DRAWN SHAPE -- trunk, canopy and all --
// so nothing can stand "behind" one and be hidden by it (2026-10-04:
// "silos and trees should be FULLY collidable, this way zombies can't hide
// behind trees"). (x, y) is the footprint's centre on the ground. Shared by
// the general terrain and the silo sets (buildSiloSets).
function arenaPlaceTree(x, y, fits, canopy, gap) {
    {
        const cw = canopy || TREE_CANOPY;
        const minGap = gap || TREE_GAP;
        const bottom = Math.round(y + TREE_TRUNK / 2);
        const tall = treeFullHeight(cw);
        const r = { x: Math.round(x - cw / 2), y: bottom - tall, w: cw, h: tall };
        const pad = { x: r.x - 30, y: r.y - 30, w: r.w + 60, h: r.h + 60 };
        if (!fits(pad)) return false;
        for (let i = 0; i < walls.length; i++) {
            const w = walls[i];
            if (w.perim || w.column) continue;
            const dx = Math.max(0, Math.max(w.x - (r.x + r.w), r.x - (w.x + w.w)));
            const dy = Math.max(0, Math.max(w.y - (r.y + r.h), r.y - (w.y + w.h)));
            if (Math.hypot(dx, dy) < minGap) return false;
        }
        const t = { x: r.x, y: r.y, w: r.w, h: r.h, trunk: true, tree: true, cw: cw, shade: MP.random() };
        walls.push(t);
        arenaTrees.push(t);
        return true;
    }
}

function arenaAddBush(x, y, rad, fits) {
    if (!fits({ x: x - rad, y: y - rad, w: rad * 2, h: rad * 2 })) return;
    arenaBushes.push({ x: Math.round(x), y: Math.round(y), r: Math.round(rad), shade: MP.random() });
}

// The open patches and the scatter. arenaTrees / arenaBushes are reset by
// buildArcadeArena, because the silo sets plant first.
function plantArenaTerrain(fits, open) {
    const A = ARENA;
    const tryTree = function (x, y) { return arenaPlaceTree(x, y, fits); };
    const addBush = function (x, y, rad) { arenaAddBush(x, y, rad, fits); };

    // The boss map is OPEN: no patches and no scatter in the core (the edge
    // forest below still stands, and the undergrowth).
    for (let p = 0; p < (open ? 0 : ARENA_PATCHES); p++) {
        const px = A.x + 220 + MP.random() * (A.w - 440);
        const py = A.y + 200 + MP.random() * (A.h - 400);
        if (!fits({ x: px - 90, y: py - 90, w: 180, h: 180 })) continue;
        for (let i = 0; i < 10; i++) {
            const a = MP.random() * Math.PI * 2, d = 40 + MP.random() * 190;
            tryTree(px + Math.cos(a) * d, py + Math.sin(a) * d);
        }
        for (let i = 0; i < 13; i++) {
            const a = MP.random() * Math.PI * 2, d = MP.random() * 240;
            addBush(px + Math.cos(a) * d, py + Math.sin(a) * d, 7 + MP.random() * 8);
        }
    }
    // The sparse scatter between them.
    for (let i = 0; i < (open ? 0 : 94); i++) {          // +10% (2026-10-04), scaled with the arena twice (2026-10-07)
        tryTree(A.x + 80 + MP.random() * (A.w - 160), A.y + 80 + MP.random() * (A.h - 160));
    }
    for (let i = 0; i < 128; i++) {         // +10%, then scaled with the arena twice
        addBush(A.x + 60 + MP.random() * (A.w - 120), A.y + 60 + MP.random() * (A.h - 120), 5 + MP.random() * 7);
    }
    plantBufferForest(fits);
}

// THE OUTER BUFFER IS FOREST (2026-10-08: "make that extra 25% of the map on
// the edges thicker with forest to discourage exploration in those
// directions"). Dense, small trees BUFFER_GAP apart -- passable, because a
// gap is either closed or walkable, but slow and blind going, so the game's
// real ground is the core.
// 92, not the core forest's 80: at 80, three trees in a triangle sealed small
// pockets off from the WIDE nav grid on 2 seeds in 12 (0.2% of cells) --
// 80 clears the 78px guarantee only on paper once the grid's alignment
// takes its share.
const BUFFER_GAP = 92;

function plantBufferForest(fits) {
    const A = ARENA;
    const zones = [
        { x: A.x + 30, y: A.y + 30, w: ARENA_BUFFER_X - 30, h: A.h - 60 },                      // west
        { x: A.x + A.w - ARENA_BUFFER_X, y: A.y + 30, w: ARENA_BUFFER_X - 30, h: A.h - 60 },     // east
        { x: A.x + ARENA_BUFFER_X, y: A.y + 30, w: A.w - ARENA_BUFFER_X * 2, h: ARENA_BUFFER_TOP - 30 } // north
    ];
    for (let z = 0; z < zones.length; z++) {
        const Z = zones[z];
        const tries = Math.round(Z.w * Z.h / 4200);
        for (let i = 0; i < tries; i++) {
            arenaPlaceTree(Z.x + MP.random() * Z.w, Z.y + MP.random() * Z.h, fits, 58, BUFFER_GAP);
        }
        // Undergrowth, thick: it is drawn only, so it makes the forest READ
        // dense without closing a single gap.
        for (let i = 0; i < Math.round(tries * 0.9); i++) {
            arenaAddBush(Z.x + MP.random() * Z.w, Z.y + MP.random() * Z.h, 8 + MP.random() * 10, fits);
        }
    }
}

// --- drawing ---------------------------------------------------------------
// Flat raster colours, no gradients (AESTHETIC_GUIDE 6.3): the grass is one
// tile of tufts on a base, made once from a fixed seed (never MP.random --
// it would shift the level stream -- and never Math.random, so every screen
// shows the same tufts).
let arenaGrassPattern = null;

function arenaGrassTile() {
    const S = 96;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d");
    // Lighter since 2026-10-08 ("more visual clarity between grass & trees"):
    // the canopies are the dark greens now, the ground the light ones.
    g.fillStyle = "#34502A";
    g.fillRect(0, 0, S, S);
    const rnd = zfRng(4242);
    const shades = ["#3E5C30", "#4A6A36", "#2C4422", "#56783C"];
    for (let i = 0; i < 70; i++) {
        const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
        g.fillStyle = shades[Math.floor(rnd() * shades.length)];
        g.fillRect(x, y, 2, 4);                 // a blade
        if (rnd() < 0.5) g.fillRect(x + 2, y + 1, 2, 3);
    }
    for (let i = 0; i < 6; i++) {               // a few bare patches
        g.fillStyle = "#4A4A30";
        g.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), 6, 4);
    }
    return c;
}

function arcadeDrawGround(vr) {
    ctx.fillStyle = "#050505";                  // outside the fence
    ctx.fillRect(vr.x, vr.y, vr.w, vr.h);
    if (!arenaGrassPattern) {
        const tile = arenaGrassTile();
        arenaGrassPattern = ctx.createPattern(tile, "repeat");
    }
    ctx.save();
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = arenaGrassPattern;
    ctx.fillRect(ARENA.x, ARENA.y, ARENA.w, ARENA.h);
    ctx.restore();
    // Grass first, and under everything laid on it (2026-10-16: it was drawn over
    // the set floors and the roads on the later maps): floors, concrete, roads.
    arcadeDrawBands(vr);
    arcadeDrawLowGrass(vr);
    arcadeDrawSetFloors();
    arcadeDrawConcrete(vr);
    arcadeDrawRoads();
    if (arcadeHasStart()) arcadeDrawPedestal();
}

// THE PEDESTAL: walkable ground, a raised-looking slab. Not a collision.
function arcadeDrawPedestal() {
    const x = WORLD_W / 2 - START_PED_HALF_W, y = WORLD_H / 2 + START_PED_TOP, w = START_PED_HALF_W * 2;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(x + 6, y + 8, w, START_PED_FP + START_PED_LIFT);
    ctx.fillStyle = "#5A5A5E";                                   // front face
    ctx.fillRect(x, y + START_PED_FP, w, START_PED_LIFT);
    ctx.fillStyle = "#8C8C90";                                   // top
    ctx.fillRect(x, y, w, START_PED_FP);
    ctx.fillStyle = "#6A6A6E";                                   // a notch above each tray
    for (let i = 0; i < TRAY_SLOTS; i++) ctx.fillRect(arcadeTraySlot(i).x - 20, y + 6, 40, START_PED_FP - 12);
    ctx.fillStyle = "#C8641E";
    ctx.fillRect(x, y, w, 3);
}

// ---------------------------------------------------
//   THE TALL-GRASS BANDS (2026-10-13)
// ---------------------------------------------------
// East and west of the fence is tall grass, not a wall: players are stopped at
// the fence line (the "player-collision edge"), zombies are not (`zpass`), and
// the band is where some of them spawn, so they walk in out of the grass. The
// north and south walls are drawn across the bands as one continuous wall.
// Outward from the fence the grass goes dark in stepped bands: a hard step at
// the edge, then a slow fade to black at the world's edge.
const BAND_FADE_STEPS = 24;
const BAND_SPAWN_CHANCE = 0.4;
// The boundary is HARD, where the fence always stood: players cannot pass it.
// The grass is full at and beyond it and tapers away INWARD over about seven
// trees' width (BAND_TAPER), its reach varied by large-scale noise so no edge
// shows. A zombie shows 30% of its height at the boundary and all of it where
// the grass ends, on a straight line between (arcadeBandVisible).
const BAND_TAPER = 420;
const BAND_CELL = 22;
function arcadeBandEdges() {
    return { west: ARENA.x + WALL_T, east: ARENA.x + ARENA.w - WALL_T };
}

// Smooth value noise on a coarse lattice (hash corners, smoothstep between).
function arcadeNoise2(x, y, scale) {
    const gx = x / scale, gy = y / scale;
    const ix = Math.floor(gx), iy = Math.floor(gy);
    const fx = gx - ix, fy = gy - iy;
    const h = function (i, j) { return (((i * 374761393) ^ (j * 668265263)) >>> 0) % 1000 / 1000; };
    const sx = fx * fx * (3 - 2 * fx), sy = fy * fy * (3 - 2 * fy);
    const top = h(ix, iy) * (1 - sx) + h(ix + 1, iy) * sx;
    const bot = h(ix, iy + 1) * (1 - sx) + h(ix + 1, iy + 1) * sx;
    return top * (1 - sy) + bot * sy;
}

// How far inside the boundary a point is (0 at or beyond it).
function arcadeBandInward(x) {
    const e = arcadeBandEdges();
    if (x <= e.west || x >= e.east) return 0;
    return Math.min(x - e.west, e.east - x);
}

// 0..1 grass density at a world point: full at and beyond the boundary,
// tapering to nothing BAND_TAPER inside it, the reach varied by noise.
function arcadeBandDensity(x, y) {
    const d = arcadeBandInward(x);
    if (d >= BAND_TAPER) return 0;
    const t = 1 - d / BAND_TAPER;
    const base = t * t * (3 - 2 * t);
    const n = arcadeNoise2(x + 5000, y, 300) * 0.65 + arcadeNoise2(x, y + 9000, 110) * 0.35;
    return Math.max(0, Math.min(1, base * 1.15 + (n - 0.5) * 0.95 * Math.min(1, base * 2.5)));
}

// How much of a zombie standing at x shows: 30% at the boundary (and
// beyond), a steady line up to 100% where the grass ends BAND_TAPER inside.
const BAND_VIS_EDGE = 0.30;
function arcadeBandVisible(x) {
    const d = arcadeBandInward(x);
    return BAND_VIS_EDGE + (1 - BAND_VIS_EDGE) * Math.min(1, d / BAND_TAPER);
}

// 0.3..1: how tall the blades stand at x. Full height at the boundary, down
// to a third of it where the grass ends.
function arcadeBandTall(x) {
    return 0.3 + 0.7 * Math.max(0, 1 - arcadeBandInward(x) / BAND_TAPER);
}

// ---------------------------------------------------
//   THE GROUND GRID: what grass must stay off, and where concrete is (2026-10-16)
// ---------------------------------------------------
// One 20px grid over the world, built lazily per level, with a bit per cell:
//   1 STRUCT  a funnel, tank, pipe, warehouse, prop ... (grass is masked)
//   2 ROAD    the road itself (grass masked, concrete never)
//   4 NEAR    within ROAD_NEAR of a road (the last map's low grass keeps off it)
//   8 CONC    concrete
//  16 TREE    under a tree (concrete keeps off)
//  32 ROADIN  the road's inner core: concrete may run up to it and UNDER the road's edge, so a join is flush, not pointy
const GG = 20;
const GB_STRUCT = 1, GB_ROAD = 2, GB_NEAR = 4, GB_CONC = 8, GB_TREE = 16, GB_ROADIN = 32;
const ROAD_NEAR = 170;
const CONC_PAD = 70;              // how far concrete spreads round a tank cluster
const CONC_LINK_W = 1;            // link strips are 2*W+1 cells wide
const CONC_LINK_MAX = 900;
let ggBits = null, ggKey = "", ggCols = 0, ggRows = 0;
let arenaConcreteRects = [];      // explicit pads (the long warehouse's aprons)
let arenaLongHouse = null;        // map 3's ultra-long warehouse {x, y, w, h}

function arcadeGrassGrid() {
    const key = levelSeed + ":" + arcLevelNo + ":" + arenaProps.length + ":" + arenaTrees.length + ":" + arenaRoads.length + ":" + funnels.length;
    if (ggBits && key === ggKey) return ggBits;
    ggKey = key;
    ggCols = Math.ceil(WORLD_W / GG);
    ggRows = Math.ceil(WORLD_H / GG);
    const bits = new Uint8Array(ggCols * ggRows);
    const rect = function (x0, y0, x1, y1, bit, skip) {
        const c0 = Math.max(0, Math.floor(x0 / GG)), c1 = Math.min(ggCols - 1, Math.floor((x1 - 1) / GG));
        const r0 = Math.max(0, Math.floor(y0 / GG)), r1 = Math.min(ggRows - 1, Math.floor((y1 - 1) / GG));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            const i = r * ggCols + c;
            if (skip && (bits[i] & skip)) continue;
            bits[i] |= bit;
        }
    };
    const circle = function (cx, cy, rad, bit, skip) {
        const c0 = Math.max(0, Math.floor((cx - rad) / GG)), c1 = Math.min(ggCols - 1, Math.floor((cx + rad) / GG));
        const r0 = Math.max(0, Math.floor((cy - rad) / GG)), r1 = Math.min(ggRows - 1, Math.floor((cy + rad) / GG));
        for (let r = r0; r <= r1; r++) for (let c = c0; c <= c1; c++) {
            if (Math.hypot(c * GG + GG / 2 - cx, r * GG + GG / 2 - cy) > rad) continue;
            const i = r * ggCols + c;
            if (skip && (bits[i] & skip)) continue;
            bits[i] |= bit;
        }
    };
    // Structures.
    for (let k = 0; k < funnels.length; k++) {
        const f = funnels[k];
        if (f) circle(f.x, f.y, f.r + 26, GB_STRUCT);
        const sl = silos[k];
        if (sl && !giantSilo) rect(sl.x - 26, sl.y - SILO_LIFT - 26, sl.x + sl.w + 26, sl.y + sl.h + 26, GB_STRUCT);
        const p = siloPipes[k];
        if (p) rect(Math.min(p.x1, p.x2) - 34, Math.min(p.y1, p.y2) - 34, Math.max(p.x1, p.x2) + 34, Math.max(p.y1, p.y2) + 34, GB_STRUCT);
    }
    if (giantSilo) rect(giantSilo.x - 40, giantSilo.y - giantSilo.lift - 40, giantSilo.x + giantSilo.w + 40, giantSilo.y + giantSilo.h + 40, GB_STRUCT);
    if (arenaWarehouse) rect(arenaWarehouse.x - 14, arenaWarehouse.y - 14, arenaWarehouse.x + arenaWarehouse.w + 14, arenaWarehouse.y + arenaWarehouse.h + 14, GB_STRUCT);
    if (arenaLongHouse) rect(arenaLongHouse.x - 14, arenaLongHouse.y - 14, arenaLongHouse.x + arenaLongHouse.w + 14, arenaLongHouse.y + arenaLongHouse.h + 14, GB_STRUCT);
    for (let i = 0; i < arenaProps.length; i++) {
        const r = arenaProps[i];
        rect(r.x - 6, r.y - 6, r.x + r.w + 6, r.y + r.h + 6, GB_STRUCT);
    }
    for (let i = 0; i < arenaTrees.length; i++) {
        const t = arenaTrees[i];
        rect(t.x - 4, t.y - 4, t.x + t.w + 4, t.y + t.h + 4, GB_TREE);
    }
    // Roads: a corridor (the road and a kerb) and a wider "near" ring.
    const samples = [];
    for (let i = 0; i < arenaRoads.length; i++) {
        const pts = arenaRoads[i].pts;
        for (let k = 1; k < pts.length; k++) {
            const a = pts[k - 1], b = pts[k];
            const n = Math.max(1, Math.ceil(Math.hypot(b[0] - a[0], b[1] - a[1]) / 10));
            for (let t = 0; t <= n; t++) {
                const x = a[0] + (b[0] - a[0]) * t / n, y = a[1] + (b[1] - a[1]) * t / n;
                circle(x, y, ROAD_W / 2 + 8, GB_ROAD);
                circle(x, y, ROAD_W / 2 - 14, GB_ROADIN);
                if (t % 2 === 0) circle(x, y, ROAD_NEAR, GB_NEAR);
                if (t % 2 === 0 && (k + t) % 2 === 0) samples.push([x, y]);
            }
        }
    }
    // Concrete (maps 3 and 4 and the long warehouse's aprons).
    const conc = function (x0, y0, x1, y1) { rect(x0, y0, x1, y1, GB_CONC, GB_ROADIN | GB_TREE); };
    const concCircle = function (cx, cy, rad) { circle(cx, cy, rad, GB_CONC, GB_ROADIN | GB_TREE); };
    for (let i = 0; i < arenaConcreteRects.length; i++) {
        const r = arenaConcreteRects[i];
        conc(r.x, r.y, r.x + r.w, r.y + r.h);
    }
    const anchors = [];
    if (arcLevelNo >= 3) {
        for (let k = 0; k < funnels.length; k++) {
            const f = funnels[k];
            if (!f) continue;
            concCircle(f.x, f.y, f.r + CONC_PAD);
            const sl = silos[k], p = siloPipes[k];
            if (sl && !giantSilo) conc(sl.x - 50, sl.y - SILO_LIFT - 20, sl.x + sl.w + 50, sl.y + sl.h + 50);
            if (p) conc(Math.min(p.x1, p.x2) - 48, Math.min(p.y1, p.y2) - 48, Math.max(p.x1, p.x2) + 48, Math.max(p.y1, p.y2) + 48);
            anchors.push([f.x, f.y]);
        }
        if (giantSilo) {
            conc(giantSilo.x - 90, giantSilo.y - giantSilo.lift - 40, giantSilo.x + giantSilo.w + 90, giantSilo.y + giantSilo.h + 90);
            anchors.push([giantSilo.x + giantSilo.w / 2, giantSilo.y + giantSilo.h / 2]);
        }
        if (arenaWarehouse) {
            const W = arenaWarehouse, m = 80;
            // an apron round it, never inside (its own floor is drawn there)
            const before = bits.slice();
            conc(W.x - m, W.y - m, W.x + W.w + m, W.y + W.h + m);
            for (let r = Math.floor(W.y / GG); r <= Math.floor((W.y + W.h - 1) / GG); r++) {
                for (let c = Math.floor(W.x / GG); c <= Math.floor((W.x + W.w - 1) / GG); c++) {
                    if (r >= 0 && c >= 0 && r < ggRows && c < ggCols) bits[r * ggCols + c] = (bits[r * ggCols + c] & ~GB_CONC) | (before[r * ggCols + c] & GB_CONC);
                }
            }
            anchors.push([W.x + W.w / 2, W.y + W.h]);
        }
        if (arenaLongHouse) anchors.push([arenaLongHouse.x - 90, arenaLongHouse.y + arenaLongHouse.h / 2], [arenaLongHouse.x + arenaLongHouse.w + 90, arenaLongHouse.y + arenaLongHouse.h / 2]);
        // The boss map's cover: a pad under each container and wall group.
        for (let i = 0; i < arenaProps.length; i++) {
            const r = arenaProps[i];
            if (r.kind === "container" || (r.kind === "divider" && arcLevelNo >= ARC_MAX_LEVEL)) conc(r.x - 54, r.y - 54, r.x + r.w + 54, r.y + r.h + 54);
        }
        // Every pad is tied to the nearest road by a link strip (stopping at the
        // road's edge), so no concrete stands isolated.
        const tree = function (x, y) {
            const c = Math.floor(x / GG), r = Math.floor(y / GG);
            return c < 0 || r < 0 || c >= ggCols || r >= ggRows || (bits[r * ggCols + c] & GB_TREE);
        };
        for (let a = 0; a < anchors.length; a++) {
            const [ax, ay] = anchors[a];
            let best = null, bd = Infinity;
            for (let i = 0; i < samples.length; i++) {
                const d = Math.hypot(samples[i][0] - ax, samples[i][1] - ay);
                if (d < bd) { bd = d; best = samples[i]; }
            }
            if (!best || bd > CONC_LINK_MAX) continue;
            // Two L routes; the one with fewer trees in the way.
            const routes = [[[ax, ay], [best[0], ay], [best[0], best[1]]], [[ax, ay], [ax, best[1]], [best[0], best[1]]]];
            let pick = routes[0], pc = Infinity;
            routes.forEach(function (rt) {
                let n = 0;
                for (let q = 1; q < rt.length; q++) {
                    const u = rt[q - 1], v = rt[q], steps = Math.ceil(Math.hypot(v[0] - u[0], v[1] - u[1]) / GG);
                    for (let t = 0; t <= steps; t++) if (tree(u[0] + (v[0] - u[0]) * t / Math.max(1, steps), u[1] + (v[1] - u[1]) * t / Math.max(1, steps))) n++;
                }
                if (n < pc) { pc = n; pick = rt; }
            });
            let stop = false;
            for (let q = 1; q < pick.length && !stop; q++) {
                const u = pick[q - 1], v = pick[q], steps = Math.ceil(Math.hypot(v[0] - u[0], v[1] - u[1]) / GG);
                for (let t = 0; t <= steps && !stop; t++) {
                    const x = u[0] + (v[0] - u[0]) * t / Math.max(1, steps), y = u[1] + (v[1] - u[1]) * t / Math.max(1, steps);
                    const c = Math.floor(x / GG), r = Math.floor(y / GG);
                    if (c < 0 || r < 0 || c >= ggCols || r >= ggRows) { stop = true; break; }
                    if (bits[r * ggCols + c] & GB_ROADIN) { stop = true; break; }     // the road's core: the strip runs UNDER its edge, so the join is flush
                    for (let dr = -CONC_LINK_W; dr <= CONC_LINK_W; dr++) for (let dc = -CONC_LINK_W; dc <= CONC_LINK_W; dc++) {
                        const cc = c + dc, rr = r + dr;
                        if (cc < 0 || rr < 0 || cc >= ggCols || rr >= ggRows) continue;
                        const i = rr * ggCols + cc;
                        if (bits[i] & (GB_ROADIN | GB_TREE)) continue;
                        bits[i] |= GB_CONC;
                    }
                }
            }
        }
    }
    // INSIDE A WAREHOUSE THE FLOOR IS THE WAREHOUSE'S OWN (2026-10-16): no slab
    // from a tank pad or a link strip under either building.
    [arenaWarehouse, arenaLongHouse].forEach(function (W) {
        if (!W) return;
        const c0 = Math.floor(W.x / GG), c1 = Math.floor((W.x + W.w - 1) / GG);
        const r0 = Math.floor(W.y / GG), r1 = Math.floor((W.y + W.h - 1) / GG);
        for (let r = Math.max(0, r0); r <= Math.min(ggRows - 1, r1); r++) for (let c = Math.max(0, c0); c <= Math.min(ggCols - 1, c1); c++) bits[r * ggCols + c] &= ~GB_CONC;
    });
    ggBits = bits;
    return bits;
}

// Is (x, y) somewhere grass must not be drawn (a structure, the road, concrete)?
function arcadeGrassMasked(bits, x, y) {
    const c = Math.floor(x / GG), r = Math.floor(y / GG);
    if (c < 0 || r < 0 || c >= ggCols || r >= ggRows) return false;
    return (bits[r * ggCols + c] & (GB_STRUCT | GB_ROAD | GB_CONC)) !== 0;
}

// CONCRETE: flat slabs on the 20px grid, a hard dark edge where it ends,
// joints every four cells. Drawn under the roads, so it never shows on one.
function arcadeDrawConcrete(vr) {
    if (arcLevelNo < 3 && !arenaConcreteRects.length) return;
    const bits = arcadeGrassGrid();
    const c0 = Math.max(0, Math.floor(vr.x / GG)), c1 = Math.min(ggCols - 1, Math.floor((vr.x + vr.w) / GG));
    const r0 = Math.max(0, Math.floor(vr.y / GG)), r1 = Math.min(ggRows - 1, Math.floor((vr.y + vr.h) / GG));
    const has = function (c, r) { return c >= 0 && r >= 0 && c < ggCols && r < ggRows && (bits[r * ggCols + c] & GB_CONC); };
    const SH = ["#5E5E62", "#58585C", "#64646A", "#5B5B60"];
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            if (!has(c, r)) continue;
            const x = c * GG, y = r * GG, h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
            ctx.fillStyle = SH[h & 3];
            ctx.fillRect(x, y, GG, GG);
            if (c % 4 === 0) { ctx.fillStyle = "#47474B"; ctx.fillRect(x, y, 2, GG); }
            if (r % 4 === 0) { ctx.fillStyle = "#47474B"; ctx.fillRect(x, y, GG, 2); }
            ctx.fillStyle = "#2E2E32";
            if (!has(c - 1, r)) ctx.fillRect(x, y, 3, GG);
            if (!has(c + 1, r)) ctx.fillRect(x + GG - 3, y, 3, GG);
            if (!has(c, r - 1)) ctx.fillRect(x, y, GG, 3);
            if (!has(c, r + 1)) ctx.fillRect(x, y + GG - 3, GG, 3);
        }
    }
}

// THE LAST MAP'S LOW GRASS: a sparse 5-10% scatter of short blades over the
// open ground, kept ROAD_NEAR off the roads and off every structure and slab.
function arcadeDrawLowGrass(vr) {
    if (arcLevelNo < ARC_MAX_LEVEL) return;
    const bits = arcadeGrassGrid(), A = ARENA;
    const x0 = Math.max(A.x + WALL_T, vr.x), x1 = Math.min(A.x + A.w - WALL_T, vr.x + vr.w);
    const y0 = Math.max(A.y + WALL_T, vr.y), y1 = Math.min(A.y + A.h - WALL_T, vr.y + vr.h);
    if (x1 <= x0 || y1 <= y0) return;
    const SH = ["#4C7C34", "#5B8D3C", "#406C2C", "#6A9A46"];
    const c0 = Math.floor(x0 / BAND_CELL), c1 = Math.floor(x1 / BAND_CELL), r0 = Math.floor(y0 / BAND_CELL), r1 = Math.floor(y1 / BAND_CELL);
    for (let r = r0; r <= r1; r++) {
        for (let c = c0; c <= c1; c++) {
            const b = arcadeBandBlade(c, r);
            const dens = 0.05 + 0.05 * arcadeNoise2(b.x, b.y, 240);
            if (b.p > dens) continue;
            if (b.x < x0 || b.x > x1 || b.y < y0 || b.y > y1) continue;
            const gi = Math.floor(b.y / GG) * ggCols + Math.floor(b.x / GG);
            if (bits[gi] & (GB_STRUCT | GB_ROAD | GB_NEAR | GB_CONC)) continue;
            if (arcadeBandDensity(b.x, b.y) > 0.05) continue;       // the tall grass owns its own band
            const bh = 5 + ((b.h >> 9) % 5);
            ctx.fillStyle = SH[(b.h >> 3) & 3];
            ctx.fillRect(b.x, b.y - bh, 2, bh);
            ctx.fillRect(b.x + 3, b.y - bh * 0.7, 2, bh * 0.7);
        }
    }
}

// Every tank on every map reached so far: the denominator of "SILOS n/m" on the end cards
// (the numerator counts the carried-over tanks too, so it used to read 17/10).
function arcadeTotalSilos() {
    let n = 0;
    for (let L = 1; L <= Math.max(1, arcLevelNo); L++) n += (ARENA_LAYOUTS[L] ? ARENA_LAYOUTS[L].funnels.length : 0);
    return n;
}

function arcadeBandBlade(c, r) {
    const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
    return { h: h, x: c * BAND_CELL + (h % 17), y: r * BAND_CELL + ((h >> 5) % 17), bh: 12 + ((h >> 9) % 14), p: ((h >> 14) % 100) / 100 };
}

function arcadeDrawBands(vr) {
    const A = ARENA, e = arcadeBandEdges();
    const y0 = Math.max(A.y, vr.y), y1 = Math.min(A.y + A.h, vr.y + vr.h);
    if (y1 <= y0) return;
    // The lawn runs out to the world's edge on both sides.
    const lawn = [[0, A.x], [A.x + A.w, WORLD_W]];
    for (let s = 0; s < 2; s++) {
        const x0 = Math.max(lawn[s][0], vr.x), x1 = Math.min(lawn[s][1], vr.x + vr.w);
        if (x1 <= x0) continue;
        ctx.save();
        ctx.imageSmoothingEnabled = false;
        ctx.fillStyle = arenaGrassPattern;
        ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        ctx.restore();
    }
    // The tall grass: a flat tint per cell and blades, both by density.
    // A dry golden-green, not the lawn's green and not the trees' dark one.
    const gg = arcadeGrassGrid();
    const SH = ["#8E8A2A", "#B5A93C", "#CDBE52", "#A39A30"];
    const spans = [[0, e.west + BAND_TAPER], [e.east - BAND_TAPER, WORLD_W]];
    for (let s = 0; s < 2; s++) {
        const x0 = Math.max(spans[s][0], vr.x, 0), x1 = Math.min(spans[s][1], vr.x + vr.w, WORLD_W);
        if (x1 <= x0) continue;
        const c0 = Math.floor(x0 / BAND_CELL), c1 = Math.floor(x1 / BAND_CELL);
        const r0 = Math.floor(y0 / BAND_CELL), r1 = Math.floor(y1 / BAND_CELL);
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                const dn = arcadeBandDensity(c * BAND_CELL + BAND_CELL / 2, r * BAND_CELL + BAND_CELL / 2);
                if (dn <= 0.02) continue;
                if (arcadeGrassMasked(gg, c * BAND_CELL + BAND_CELL / 2, r * BAND_CELL + BAND_CELL / 2)) continue;   // a funnel, tank, floor, road or slab stands here
                ctx.fillStyle = "rgba(150,135,30," + (0.34 * dn).toFixed(2) + ")";
                ctx.fillRect(c * BAND_CELL, r * BAND_CELL, BAND_CELL, BAND_CELL);
                const b = arcadeBandBlade(c, r);
                if (b.p > dn) continue;
                const bh = b.bh * arcadeBandTall(b.x);
                ctx.fillStyle = SH[(b.h >> 3) & 3];
                ctx.fillRect(b.x, b.y - bh, 3, bh);
                ctx.fillRect(b.x + 4, b.y - bh * 0.7, 3, bh * 0.7);
            }
        }
    }
    // The north and south walls, continuous across the bands.
    const wy = escapeRect ? escapeRect.y : A.y + A.h - WALL_T;
    const rows = [A.y, wy];
    for (let i = 0; i < rows.length; i++) {
        for (let s = 0; s < 2; s++) {
            const sx0 = s === 0 ? 0 : A.x + A.w, sx1 = s === 0 ? A.x : WORLD_W;
            if (sx1 < vr.x || sx0 > vr.x + vr.w) continue;
            ctx.fillStyle = COLOR_WALL;
            ctx.fillRect(sx0, rows[i], sx1 - sx0, WALL_T);
            ctx.fillStyle = COLOR_WALL_LIT;
            ctx.fillRect(sx0, rows[i], sx1 - sx0, 2);
        }
    }
}

// AFTER the lighting (world space): the blades again as dark silhouettes over
// whatever is lit, so a flashlight beam is broken up by the grass it passes
// through and the light reads as filtering between the blades.
function arcadeDrawBladeShade() {
    if (!canvas.width) return;
    const vr = viewRect(), A = ARENA, e = arcadeBandEdges();
    const y0 = Math.max(A.y, vr.y), y1 = Math.min(A.y + A.h, vr.y + vr.h);
    if (y1 <= y0) return;
    // Anything standing here is NOT under the grass: trees, props, tanks,
    // players and zombies keep their light and their colour.
    const gg = arcadeGrassGrid();
    const occ = [];
    const addOcc = function (x, y, w, h) {
        if (x + w > vr.x && x < vr.x + vr.w && y + h > vr.y - 60 && y < vr.y + vr.h) occ.push([x - 6, y - 24, x + w + 6, y + h + 6]);
    };
    for (let i = 0; i < arenaTrees.length; i++) { const t = arenaTrees[i]; addOcc(t.x - 18, t.y - 40, t.w + 36, t.h + 40); }
    for (let i = 0; i < arenaProps.length; i++) { const r = arenaProps[i]; addOcc(r.x, r.y, r.w, r.h); }
    for (let i = 0; i < silos.length; i++) { const s0 = silos[i]; if (s0) addOcc(s0.x, s0.y - SILO_LIFT, s0.w, s0.h + SILO_LIFT); }
    for (let i = 0; i < zombies.length; i++) addOcc(zombies[i].x, zombies[i].y, zombies[i].size, zombies[i].size);
    for (let i = 0; i < players.length; i++) addOcc(players[i].x, players[i].y, players[i].size, players[i].size);
    for (const id in remotePlayers) {
        if (Object.prototype.hasOwnProperty.call(remotePlayers, id)) addOcc(remotePlayers[id].x, remotePlayers[id].y, 16, 16);
    }
    const covered = function (x, y) {
        for (let i = 0; i < occ.length; i++) {
            const o = occ[i];
            if (x >= o[0] && x <= o[2] && y >= o[1] && y <= o[3]) return true;
        }
        return false;
    };
    ctx.save();
    applyCameraTransform();
    const spans = [[0, e.west + BAND_TAPER], [e.east - BAND_TAPER, WORLD_W]];
    for (let s = 0; s < 2; s++) {
        const x0 = Math.max(spans[s][0], vr.x, 0), x1 = Math.min(spans[s][1], vr.x + vr.w, WORLD_W);
        if (x1 <= x0) continue;
        const c0 = Math.floor(x0 / BAND_CELL), c1 = Math.floor(x1 / BAND_CELL);
        const r0 = Math.floor(y0 / BAND_CELL), r1 = Math.floor(y1 / BAND_CELL);
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                const dn = arcadeBandDensity(c * BAND_CELL + BAND_CELL / 2, r * BAND_CELL + BAND_CELL / 2);
                if (dn <= 0.05) continue;
                const b = arcadeBandBlade(c, r);
                if (b.p > dn) continue;
                const bh = b.bh * arcadeBandTall(b.x);
                if (arcadeGrassMasked(gg, b.x + 2, b.y)) continue;
                if (covered(b.x + 2, b.y - bh / 2)) continue;
                // A little denser than the ground blades: it is what the beam must get through.
                ctx.fillStyle = "rgba(0,10,0," + (0.35 + 0.35 * dn).toFixed(2) + ")";
                ctx.fillRect(b.x - 1, b.y - bh - 2, 5, bh + 2);
                ctx.fillRect(b.x + 4, b.y - bh * 0.7 - 2, 4, bh * 0.7 + 2);
            }
        }
    }
    ctx.restore();
}

// IN FRONT OF THE ZOMBIES (world space): individual blades whose roots are
// below a zombie's feet are drawn over it, so it walks BETWEEN the blades --
// the ones behind it were already drawn with the ground. Blade height follows
// the grass: tall at the boundary, short where it thins out.
const BAND_FRONT_CELL = 8;
function arcadeDrawBandFront(inView) {
    const gg = arcadeGrassGrid();
    const SH = ["#8E8A2A", "#B5A93C", "#CDBE52", "#A39A30"];
    const seen = {};
    const F = BAND_FRONT_CELL;
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        if (!inView(z.x, z.y, z.size, z.size)) continue;
        const cxz = z.x + z.size / 2;
        if (arcadeBandDensity(cxz, z.y + z.size) < 0.04) continue;
        const feet = RETRO.snap(z.y, 4) + z.size, zx = RETRO.snap(z.x, 4);
        const c0 = Math.floor((zx - 10) / F), c1 = Math.floor((zx + z.size + 10) / F);
        const r0 = Math.floor((feet - 3) / F), r1 = Math.floor((feet + 34) / F);
        for (let r = r0; r <= r1; r++) {
            for (let c = c0; c <= c1; c++) {
                const key = c * 100003 + r;
                if (seen[key]) continue;
                seen[key] = 1;
                const h = ((c * 73856093) ^ (r * 19349663)) >>> 0;
                const bx = c * F + (h % 6), by = r * F + ((h >> 4) % 7);
                if (by < feet - 2) continue;                          // behind the zombie: already drawn
                const dn = arcadeBandDensity(bx, by);
                if (((h >> 9) % 100) / 100 > dn * 1.1) continue;
                if (arcadeGrassMasked(gg, bx + 2, by)) continue;       // on a funnel, floor, road or slab: no grass here
                const bh = (16 + ((h >> 13) % 30)) * arcadeBandTall(bx);
                ctx.fillStyle = SH[(h >> 3) & 3];
                ctx.fillRect(bx, by - bh, 4, bh);
                ctx.fillRect(bx + 3, by - bh * 0.75, 3, bh * 0.75);
                ctx.fillStyle = "#6E6A22";                             // a dark root
                ctx.fillRect(bx, by - 3, 6, 3);
            }
        }
    }
}

// Over the world after the zombies: the blades in front of them, then the
// darkness toward the world's edge.
function arcadeDrawBandOver(now, inView) {
    const A = ARENA, e = arcadeBandEdges();
    arcadeDrawBandFront(inView);
    // The darkness: nothing at the fence, rising in fine steps to the world's
    // edge, so there is no step to see where the grass thins out.
    const vr = viewRect();
    const bands = [[0, e.west, -1], [e.east, WORLD_W, 1]];
    for (let b = 0; b < 2; b++) {
        const lo = bands[b][0], hi = bands[b][1], span = hi - lo, step = span / BAND_FADE_STEPS;
        for (let k = 0; k < BAND_FADE_STEPS; k++) {
            // k = 0 is the strip nearest the fence.
            const a0 = bands[b][2] < 0 ? hi - (k + 1) * step : lo + k * step;
            const x0 = Math.max(a0, vr.x), x1 = Math.min(a0 + step, vr.x + vr.w);
            if (x1 <= x0) continue;
            const y0 = Math.max(A.y, vr.y), y1 = Math.min(A.y + A.h, vr.y + vr.h);
            if (y1 <= y0) continue;
            const f = (k + 1) / BAND_FADE_STEPS;
            ctx.fillStyle = "rgba(0,0,0," + (0.97 * f * f).toFixed(3) + ")";
            ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
        }
    }
}

// Lighter and yellower than the canopies, and a third their size, so a
// bush reads as ground cover and never as a tree.
const BUSH_SHADES = ["#3D5A22", "#4A6428", "#34501E"];

function arcadeDrawBushes(inView) {
    for (let i = 0; i < arenaBushes.length; i++) {
        const b = arenaBushes[i];
        if (!inView(b.x - b.r, b.y - b.r, b.r * 2, b.r * 2)) continue;
        // Three offset blocks: a blob without a single curve in it.
        const c = BUSH_SHADES[Math.floor(b.shade * BUSH_SHADES.length) % BUSH_SHADES.length];
        const r = b.r;
        ctx.fillStyle = "rgba(0,0,0,0.35)";
        ctx.fillRect(b.x - r + 4, b.y - r * 0.6 + 4, r * 2, r * 1.3);
        ctx.fillStyle = c;
        ctx.fillRect(b.x - r, b.y - r * 0.6, r * 2, r * 1.2);
        ctx.fillRect(b.x - r * 0.6, b.y - r, r * 1.2, r * 2);
        ctx.fillStyle = "#5E7A30";
        ctx.fillRect(b.x - r * 0.4, b.y - r * 0.7, r * 0.5, r * 0.4);
    }
}

const TREE_SHADES = ["#1F3D17", "#25471A", "#183213"];

// ---------------------------------------------------
//   THE GATE BAR (2026-10-04)
// ---------------------------------------------------
// "I can walk outside of the map if I try to walk out through the exit
// before it's ready." The opening was only ever DRAWN shut. A solid bar
// covering the whole gate fills it until the gate is FULLY open (heavy gate
// up, chainlink swung), and then it comes out. Behind it is one tunnel to the
// bottom of the world -- see "WALK OUT TO WIN".
//
// Every client builds the bar (generateLevel) and every client removes it
// (arcadeUpdateGateBar, from update()), off escapeAt, which rides the
// snapshot -- so the geometry agrees without a message of its own.
function arcadeUpdateGateBar() {
    if (!escapeOpen() || escapeChainFrac() < 1) return;
    let removed = false;
    for (let i = walls.length - 1; i >= 0; i--) {
        if (walls[i].gateBar) { walls.splice(i, 1); removed = true; }
    }
    if (removed) {
        markNavDirty();
        rebuildSolidIndex();
    }
}

// ---------------------------------------------------
//   THE WAY IN (2026-10-12)
// ---------------------------------------------------
// Built shut. A client that SAW the map change opens it for the arrival and
// closes it at the end of the flythrough, once everyone of its own is through;
// a client that is only catching up never opens it. Every client does this off
// its own flythrough, so there is no message and no host involvement: players
// and their collision are client-owned anyway.
function arcadeEntryOpen(closeAt) {
    if (!entryRect) return;
    for (let i = walls.length - 1; i >= 0; i--) if (walls[i].entryBar) walls.splice(i, 1);
    rebuildSolidIndex();                  // not markNavDirty(): nothing walks the tunnel
    arcEntryState = "open";
    arcEntryCloseAt = closeAt;
    arcEntryClosedAt = 0;
}

// Every simulation step, with arcadeUpdateGateBar.
function arcadeEntryTick(now) {
    if (arcEntryState !== "open" || !entryRect || now < arcEntryCloseAt) return;
    // Shut it once none of ours is still in the gate or north of it. (A step or
    // two after the run-on ends is plenty; the 5s is for a stalled client.)
    const southOf = entryRect.y + entryRect.h + 4;
    let behind = false;
    for (let i = 0; i < players.length; i++) if (players[i].y < southOf) behind = true;
    if (behind && now < arcEntryCloseAt + 5000) return;
    for (let i = 0; i < players.length; i++) {
        if (players[i].y < southOf) players[i].y = southOf + 6;     // never shut a body in
    }
    arcEntryState = "closed";
    arcEntryClosedAt = now;
    walls.push({ x: entryRect.x, y: entryRect.y, w: entryRect.w, h: entryRect.h, entryBar: true });
    rebuildSolidIndex();
    if (typeof localEvent === "function") localEvent(SND_DOOR, entryRect.x + entryRect.w / 2, entryRect.y + entryRect.h);
    if (typeof addShake === "function") addShake(5);
}

// 0 open .. 1 shut, for the drawing.
function arcadeEntryFrac(now) {
    if (!entryRect) return 1;
    if (arcEntryState === "open") return 0;
    if (!arcEntryClosedAt) return 1;       // built shut
    return clamp((now - arcEntryClosedAt) / ARC_ENTRY_CLOSE_MS, 0, 1);
}

// ---------------------------------------------------
//   THE INTRO (2026-10-04, third playtest note)
// ---------------------------------------------------
// "Full map zoomed out -> 'Escape' -> zoom in on center where players spawn
// (should show all players [controls off for starting animation]) 'you' ->
// pan over to first silo 'fill the silos' -> pan to other two silos, still on
// each one for a second -> finish pan to exit gate 'initiate gate open,
// Escape'."
//
// Local to every client, driven from gameLoop, and it costs the run nothing:
// the host's clock starts AFTER it (arcadeStart pushes startTime forward by
// arcIntroMs()), so the wave, the drops and the 4:00 curve all begin when the
// camera lands back on you. A guest arriving in a run that is already going
// (`el` > 0 on its first snapshot) skips it -- 11 seconds with no controls in
// the middle of a fight is not an intro.
let arcIntroAt = 0;
let arcIntroLen = 0;

function arcadeBeginIntro(now, len, fadeMs) {
    arcIntroAt = now;
    arcIntroLen = len || arcIntroMs();
    if (fadeMs) arcadeFadeIn(now, fadeMs);
    if (typeof releaseHeldKeys === "function") releaseHeldKeys();
}

// ---------------------------------------------------
//   FADES (2026-10-12: "assure visual transitions are not jumpy/jarring/or
//   teleporting the camera for all")
// ---------------------------------------------------
// The rule: a hard change of world (a restart, a map change, a late joiner
// catching up) happens UNDER BLACK. The screen fades out before it and in
// after it, and the camera is placed where the next shot starts while nothing
// can be seen. Stepped, never smooth: see ARC_FADE_STEPS.
function arcadeFadeIn(now, ms) {
    arcFadeInAt = now;
    arcFadeInMs = ms;
}

// THE WIN: the walk-out plays, then the screen goes to black, then fireworks
// (2026-10-12: "add fireworks screen on final level win after fade to black").
// Only the last map's exit ends the run, so this is only ever the final win.
// Stepped like every other fade here. The card comes up over the fireworks.
const ARC_WIN_FADE_AT_MS = 600;
const ARC_WIN_FADE_MS = 1100;
function arcadeWinFade(sinceMs) {
    const a = clamp((sinceMs - ARC_WIN_FADE_AT_MS) / ARC_WIN_FADE_MS, 0, 1);
    return ARC_FADE_STEPS ? Math.round(a * ARC_FADE_STEPS) / ARC_FADE_STEPS : a;
}

// Cosmetic, per client (Math.random is right here): rockets rise from the
// bottom edge and burst into flat square sparks that fall and fade in steps.
const FW_COLORS = ["#FF3344", "#55FFFF", "#FFE033", "#FFFFFF", "#33FF55", "#FF66CC", "#FF8A1C"];
let fwRockets = [], fwSparks = [], fwNextAt = 0, fwLastT = 0;

function arcadeFireworksReset() { fwRockets = []; fwSparks = []; fwNextAt = 0; fwLastT = 0; }

function arcadeDrawFireworks(now) {
    const W = canvas.width, H = canvas.height;
    const dt = fwLastT ? Math.min(60, now - fwLastT) : 16;
    fwLastT = now;
    if (!fwNextAt) fwNextAt = now + 150;
    while (now >= fwNextAt && fwRockets.length < 6) {
        fwNextAt += 380 + Math.random() * 520;
        const tx = W * (0.12 + Math.random() * 0.76), ty = H * (0.12 + Math.random() * 0.42);
        fwRockets.push({ x: tx + (Math.random() - 0.5) * 90, y: H + 10, tx: tx, ty: ty,
                         col: FW_COLORS[Math.floor(Math.random() * FW_COLORS.length)], big: Math.random() < 0.3 });
    }
    if (now > fwNextAt + 3000) fwNextAt = now;                // a long stall must not fire a volley
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Rockets: a short column of squares climbing to their mark.
    for (let i = fwRockets.length - 1; i >= 0; i--) {
        const r = fwRockets[i];
        const dx = r.tx - r.x, dy = r.ty - r.y, d = Math.hypot(dx, dy);
        const step = 0.62 * dt;
        if (d <= step) {
            // Burst.
            const n = r.big ? 70 : 44;
            for (let k = 0; k < n && fwSparks.length < 700; k++) {
                const a = (k / n) * Math.PI * 2 + Math.random() * 0.2;
                const sp = (r.big ? 0.42 : 0.32) * (0.55 + Math.random() * 0.6);
                fwSparks.push({ x: r.tx, y: r.ty, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, age: 0,
                                life: 1100 + Math.random() * 700, col: Math.random() < 0.22 ? "#FFFFFF" : r.col });
            }
            if (typeof sndFirework === "function") sndFirework();
            fwRockets.splice(i, 1);
            continue;
        }
        r.x += dx / d * step;
        r.y += dy / d * step;
        ctx.fillStyle = "#FFE9A0";
        ctx.fillRect(Math.round(r.x) - 2, Math.round(r.y) - 2, 4, 4);
        ctx.fillStyle = "#FF8A1C";
        ctx.fillRect(Math.round(r.x) - 1, Math.round(r.y) + 4, 3, 3);
        ctx.fillRect(Math.round(r.x), Math.round(r.y) + 10, 2, 2);
    }
    // Sparks: gravity, drag, and a fade in four steps rather than a ramp.
    for (let i = fwSparks.length - 1; i >= 0; i--) {
        const s = fwSparks[i];
        s.age += dt;
        if (s.age >= s.life) { fwSparks.splice(i, 1); continue; }
        s.vy += 0.00028 * dt;
        s.vx *= 0.997;
        s.x += s.vx * dt;
        s.y += s.vy * dt;
        const k = s.age / s.life;
        ctx.globalAlpha = k < 0.5 ? 1 : k < 0.7 ? 0.75 : k < 0.88 ? 0.45 : 0.22;
        ctx.fillStyle = s.col;
        const sz = k < 0.6 ? 6 : 4;
        ctx.fillRect(Math.round(s.x) - 3, Math.round(s.y) - 3, sz, sz);
    }
    ctx.globalAlpha = 1;
    ctx.restore();
}

// 0..1, black over the whole frame (the canvas, and the loadout HUD).
function arcadeFadeAlpha(now) {
    let a = 0;
    if (arcLeaveEndAt > 0) {
        const left = arcLeaveEndAt - now;
        // A guest holds black past the deadline until the host's `lv` lands
        // (a few frames); if it never does, give up rather than stay dark.
        if (left < -5000) arcLeaveEndAt = 0;
        else a = left <= 0 ? 1 : clamp(1 - left / ARC_LEAVE_FADE_MS, 0, 1);
    }
    if (arcFadeInMs > 0) {
        const k = (now - arcFadeInAt) / arcFadeInMs;
        if (k >= 1) arcFadeInMs = 0;
        else a = Math.max(a, 1 - clamp(k, 0, 1));
    }
    if (a <= 0 || !ARC_FADE_STEPS) return a;
    return Math.round(a * ARC_FADE_STEPS) / ARC_FADE_STEPS;
}

// Screen space, drawn last of everything on the canvas.
function arcadeDrawFade(now) {
    const a = arcadeFadeAlpha(now);
    if (a <= 0) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "rgba(0,0,0," + a.toFixed(3) + ")";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
}

// Reset on a restart (resetGame).
function arcadeResetTransition(now) {
    arcadeBlackoutReset();
    arcLeaveAt = 0;
    arcLeaveEndAt = 0;
    arcIntroAt = 0;
    // Back from a lost run onto a freshly generated level: come up from black.
    arcadeFadeIn(now, ARC_FADE_IN_MS);
}

// Before a run (the start card, and after a restart) the camera rests on the
// whole arena -- exactly the flythrough's first frame -- so CLICK TO START has
// nothing to cut from. Snapped every frame, which is safe: it runs only while
// there is no run and no player.
function arcadeIdleCamera() {
    if (gameStarted || players.length || zAwaitRespawn) return false;
    arcadePlaceIntroCamera(ARENA.x + ARENA.w / 2, ARENA.y + ARENA.h / 2, arcadeFitScale());
    return true;
}

function arcadeIntroActive(now) {
    return arcIntroAt > 0 && (now || Date.now()) - arcIntroAt < arcIntroLen;
}

// From applyWorldSnapshot: a run already past its intro skips ours.
function arcadeIntroSync(elapsedMs) {
    // Map 1's intro only: map 2's clock is offset by 60s on purpose.
    if (arcLevelNo === 1 && elapsedMs > 1500 && arcadeIntroActive()) arcIntroAt = 0;
}

// The scale updateCamera() settles on, so the intro hands over without a jump.
function arcadeNormalScale() {
    let needW = VIEW_W, needH = VIEW_H;
    const aspect = canvas.width / Math.max(1, canvas.height);
    if (needW / needH < aspect) needW = needH * aspect;
    else needH = needW / aspect;
    // zombie-input.js: a touch screen is zoomed in a little more.
    const boost = typeof inputZoomBoost === "function" ? inputZoomBoost() : 1;
    return Math.min(canvas.width / needW, canvas.height / needH) * boost;
}

function arcadeFitScale() {
    return Math.min(canvas.width / (ARENA.w + 160), canvas.height / (ARENA.h + 160));
}

// [start ms, end ms, where, zoom ('fit' | 'near'), caption]
// ONE list for every map (2026-10-12, the fourth pass): the whole map with
// "N SILOS TO FILL", then TANK 1, TANK 2 ... in chain order, the exit, home.
function arcadeIntroShots() {
    const c = { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h / 2 };
    const me = players[0] ? { x: players[0].x + 8, y: players[0].y + 8 } : c;
    return arcadeIntroShotList(ARC_INTRO_HOLD_MS, me);
}

function introEase(t) { return t * t * (3 - 2 * t); }

function arcadeLogLerp(a, b, k) { return a * Math.pow(b / a, k); }

// Between the wide shot and the normal one: where a long move pulls back to.
function arcadeMidScale() { return Math.sqrt(arcadeFitScale() * arcadeNormalScale()); }

// Every flythrough frame goes through here: the same clamp the follow camera
// uses, so the picture is never wider than the arena allows and the hand-over
// to following (updateCamera) starts from where it would have been anyway.
let arcIntroClampDelta = 0;      // px the clamp moved the last placed view (a diagnostic: 0 = it never engaged)
function arcadePlaceIntroCamera(x, y, scale) {
    const c = clampCameraCentre(x, y, scale);
    arcIntroClampDelta = Math.hypot(c.x - x, c.y - y);
    camera.x = c.x;
    camera.y = c.y;
    camera.scale = scale;
    camera.shake = 0;
}

// A move that would cross the screen faster than the eye can follow pulls
// back (zooms out) in its middle, then settles. On-screen length of the move
// at its tightest zoom, in px: under SWOOP_FROM nothing changes; over
// SWOOP_FROM + SWOOP_SPAN it dips all the way to the mid scale.
const ARC_SWOOP_FROM_PX = 450;
const ARC_SWOOP_SPAN_PX = 900;
// ...but never by more than this ratio: a deeper pull-back trades a slow pan
// for a fast zoom, which is no better to watch (measured: 3+ e-folds/s).
const ARC_SWOOP_RATIO = 0.6;

// How far along a zoom move one axis of the camera should be, given how far
// the view's width has closed (f). An axis the view does not yet fit inside is
// pinned by the clamp, so it waits and then eases away from that moment.
function arcadeAxisProgress(f, s0, s1, dim, bound) {
    if (s0 === s1) return f;
    const sr = dim / bound;                 // the scale at which the view first fits the bounds on this axis
    if (s0 >= sr) return f;
    const fr = (1 / s0 - 1 / sr) / (1 / s0 - 1 / s1);
    if (fr >= 1) return 0;
    if (f <= fr) return 0;
    return introEase((f - fr) / (1 - fr));
}

// The flythrough camera, every map: the list of shots, each a move from the last shot's
// place to its own over its whole time (so a "hold" is a shot to the same
// place). Eased, and zoomed in LOG space, which is what makes a zoom read as
// even -- a linear scale ramp spends its first half looking twice as fast.
function arcadeShotCamera(t) {
    const shots = arcadeIntroShots();
    const sc = function (mode) { return mode === "fit" ? arcadeFitScale() : arcadeNormalScale(); };
    for (let i = 0; i < shots.length; i++) {
        const s = shots[i];
        if (t < s[0] || t >= s[1]) continue;
        const from = i ? shots[i - 1] : s;
        const k = introEase(clamp((t - s[0]) / Math.max(1, s[1] - s[0]), 0, 1));
        const s0 = sc(from[3]), s1 = sc(s[3]);
        let z = arcadeLogLerp(s0, s1, k);
        const dist = Math.hypot(s[2].x - from[2].x, s[2].y - from[2].y);
        const dip = clamp((dist * Math.max(s0, s1) - ARC_SWOOP_FROM_PX) / ARC_SWOOP_SPAN_PX, 0, 1);
        if (dip > 0 && s0 === s1) {
            const floor = Math.max(arcadeMidScale(), z * ARC_SWOOP_RATIO);
            z = arcadeLogLerp(z, Math.min(z, floor), dip * Math.sin(Math.PI * k));
        }
        // Between the two places the camera can ACTUALLY sit (their clamped
        // views), not the places asked for: lerping toward an unclamped target
        // held the camera pinned by the arena's bounds until the zoom let it go,
        // and it then snapped free (measured 3 to 7 screen widths/s^2 through the
        // first zoom, a jolt). Interpolating between two views that are inside
        // the bounds keeps every view between them inside, so the clamp never
        // engages mid-move.
        const a0 = clampCameraCentre(from[2].x, from[2].y, s0);
        const a1 = clampCameraCentre(s[2].x, s[2].y, s1);
        // A zoom moves the centre by how much of the way the VIEW'S WIDTH has
        // closed (1/scale), not by time: that keeps one world point still on
        // screen, which is what zooming "into" something looks like, and makes
        // the pan on screen come out even instead of a surge at one end.
        const f = (s0 !== s1) ? (1 / s0 - 1 / z) / (1 / s0 - 1 / s1) : k;
        // ...but at the wide zoom the view is TALLER than the arena's camera
        // bounds, so the camera is held at the bounds' middle on that axis until
        // the zoom brings the view inside them. Moving it as if it were free
        // meant it sat still, then was released onto the path (a kink: 3 to 7
        // screen widths/s^2). So each axis starts moving at that moment, eased
        // from rest.
        const fx = arcadeAxisProgress(f, s0, s1, canvas.width, ARENA.w + ARENA_CAM_PAD * 2);
        const fy = arcadeAxisProgress(f, s0, s1, canvas.height, ARENA.h + ARENA_CAM_PAD * 2);
        arcadePlaceIntroCamera(a0.x + (a1.x - a0.x) * fx, a0.y + (a1.y - a0.y) * fy, z);
        return;
    }
}

// Every map's shot list, in the grammar the user approved on map 1: a wide
// hold, a zoom in, then a move and a captioned hold at every tank, the exit,
// and home. Every duration comes from world distances and constants alone
// (never the window, never where you stand), so every client works out the
// same length: the host's clock waits for it. `me` is only where the last shot
// ends up.
function arcadeIntroShotList(hold, me) {
    const c = { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h / 2 };
    const gate = escapeRect ? { x: escapeRect.x + escapeRect.w / 2, y: escapeRect.y - 60 } : c;
    // Where you start, for timing the move home: the north fence on the later
    // maps (arcadeEnterLevel), the middle of the world on the first.
    const home = arcLevelNo >= 2 ? { x: WORLD_W / 2, y: ARENA.y - ARC_ENTRY_SPAWN_BACK + 8 }
                                 : { x: WORLD_W / 2, y: WORLD_H / 2 + (arcLevelNo <= 1 ? START_SPAWN_DY : 60) };
    const tanks = [];
    for (let k = 0; k < funnels.length; k++) if (funnels[k]) tanks.push({ x: funnels[k].x + 60, y: funnels[k].y });
    const shots = [];
    let t = 0, at = c;
    const add = function (ms, pos, zoom, cap, target) {
        shots.push([t, t + ms, target || pos, zoom, cap]);
        t += ms;
        at = pos;
    };
    const move = function (to, lo, hi) {
        const ms = Math.round(Math.hypot(to.x - at.x, to.y - at.y) / ARC_INTRO_SPEED * 1000);
        return clamp(ms, lo || ARC_INTRO_MOVE_MIN, hi || ARC_INTRO_MOVE_MAX);
    };
    // The whole map, and what the job is.
    add(ARC_INTRO_WIDE_MS, c, "fit", tanks.length + " SILOS TO FILL");
    for (let k = 0; k < tanks.length; k++) {
        if (k === 0) {
            // The zoom goes STRAIGHT INTO TANK 1 (2026-10-12: it used to zoom
            // on the middle of the arena first, then pan). One move, one
            // direction: the zoom only ever goes in (arcadeShotCamera does not
            // pull back on a zoom), and it is long enough that panning to the
            // tank at the same time stays at map 1's pace.
            const dz = Math.hypot(tanks[0].x - c.x, tanks[0].y - c.y);
            add(clamp(Math.round(dz / ARC_INTRO_ZOOMIN_SPEED * 1000), ARC_INTRO_ZOOMIN_MIN_MS, ARC_INTRO_ZOOMIN_MAX_MS),
                tanks[0], "near", "");
        } else {
            add(move(tanks[k]), tanks[k], "near", "");
        }
        add(k === 0 ? 1000 : hold, tanks[k], "near", "TANK " + (k + 1));
    }
    add(move(gate, 800), gate, "near", "");
    add(1200, gate, "near", "INITIATE GATE OPEN — ESCAPE");
    // The way home can be the longest move on the map: it gets the time that
    // keeps it at map 1's speed rather than being cut at the usual max.
    add(move(home, 800, 2000), home, "near", "", me || home);
    return shots;
}

// How long a map's flythrough runs.
function arcIntroMs() {
    const shots = arcadeIntroShotList(ARC_INTRO_HOLD_MS, null);
    return shots[shots.length - 1][1];
}

// Drives the camera directly while the intro runs. Returns false when done.
function arcadeIntroCamera(now) {
    if (!arcadeIntroActive(now)) return false;
    const t = now - arcIntroAt;
    arcadeShotCamera(t);
    arcadeIntroSfx(t);
    return true;
}

// The flythrough's sounds (2026-10-12: "dings at each silo when showing it, and
// a dong at the exit gate, and then a whoosh with each zoom/pan"). Fired as a
// shot BEGINS, from the shot list itself, so they cannot drift from the
// picture: a whoosh at the start of every shot that moves or zooms the
// camera, a rising ding on each TANK n hold, a low dong on the gate hold.
let arcIntroSfxFor = 0, arcIntroSfxShot = -1;
function arcadeIntroSfx(t) {
    if (arcIntroSfxFor !== arcIntroAt) { arcIntroSfxFor = arcIntroAt; arcIntroSfxShot = -1; }
    const shots = arcadeIntroShots();
    let i = -1;
    for (let k = 0; k < shots.length; k++) if (t >= shots[k][0] && t < shots[k][1]) { i = k; break; }
    if (i < 0 || i === arcIntroSfxShot) return;
    arcIntroSfxShot = i;
    const s = shots[i], prev = i ? shots[i - 1] : null;
    if (typeof sndIntroWhoosh !== "function") return;
    if (prev && (prev[2].x !== s[2].x || prev[2].y !== s[2].y || prev[3] !== s[3])) sndIntroWhoosh(s[1] - s[0]);
    if (/^TANK \d+$/.test(s[4] || "")) sndIntroDing();
    else if ((s[4] || "").indexOf("GATE") >= 0) sndIntroDong();
}

// Screen space, last thing drawn: the caption, big and blocky.
function arcadeDrawIntroText(now) {
    if (!arcadeIntroActive(now)) return;
    const t = now - arcIntroAt;
    const shots = arcadeIntroShots();
    let cap = "", shot = null;
    for (let i = 0; i < shots.length; i++) if (t >= shots[i][0] && t < shots[i][1]) { cap = shots[i][4]; shot = shots[i]; }
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Letterbox bars: this is a cutscene, and it should look like one. They
    // slide in and out over ARC_BARS_MS; popping off in one frame as the
    // controls come back was the last hard cut of the intro.
    const barK = introEase(clamp(Math.min(t, arcIntroLen - t) / ARC_BARS_MS, 0, 1));
    const bar = Math.round(canvas.height * 0.09 * barK);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, bar);
    ctx.fillRect(0, canvas.height - bar, canvas.width, bar);
    if (cap && shot) {
        const local = (t - shot[0]) / Math.max(1, shot[1] - shot[0]);
        const wide = /SILOS TO FILL$/.test(cap);          // the whole-map caption: the job, big
        const big = wide ? 72 : cap.length > 18 ? 34 : 54;
        ctx.font = "bold " + big + "px Courier";
        ctx.textAlign = "center";
        // A whole-pixel jitter in, like the horde call -- never a smooth fade.
        const jx = local < 0.15 ? Math.round((Math.random() - 0.5) * 6) : 0;
        const y = canvas.height / 2 - canvas.height * 0.18;
        ctx.fillStyle = "#000000";
        ctx.fillText(cap, canvas.width / 2 + 4 + jx, y + 4);
        ctx.fillStyle = wide || cap.indexOf("GATE") >= 0 ? ICON_CYAN : COLOR_PICKUP;
        ctx.fillText(cap, canvas.width / 2 + jx, y);
    }
    if (barK > 0.6) {
        ctx.font = "13px Courier";
        ctx.fillStyle = "#777777";
        ctx.textAlign = "right";
        ctx.fillText("GET READY", canvas.width - 16, canvas.height - bar / 2 + 4);
    }
    ctx.restore();
}

const ARC_BARS_MS = 450;

// ---------------------------------------------------
//   FUNNELS, PIPES, TALL TANKS AND TREES (2026-10-04, third playtest note)
// ---------------------------------------------------
// "Silo funnels should also read more as grey sinking down with pseudo-depth
// & grate at center. More visual pipes running from funnel to silo. Make
// silos taller, 1d iso tall, with collisions all around... make trees
// slightly taller with same 1d isometric effect, with full collisions."
//
// "1D isometric" here is the landmarks' two-fill trick taken further: a
// footprint on the ground that IS the collision box, and the body extruded
// straight UP the screen by `lift`, with a darker front face and a lit top.
// Tall things are drawn after the zombies, sorted by their footprint's
// bottom edge, so a tank hides what stands behind it and not what stands in
// front.
const SILO_LIFT = 96;
const TREE_LIFT = 30;

// Ground to the top of the canopy's crown, as drawTallTree draws it.
function treeFullHeight(cw) {
    return TREE_LIFT + Math.round((cw || TREE_CANOPY) * 0.8) + 8;
}

// A grey bowl: rings stepping darker and slightly DOWN toward the middle (the
// pseudo-depth), the blood it holds, and a grate.
//
// THE POOL (2026-10-17: "the stepping of backfill ... should be smoothed ...
// it's just ticking back and forth between the same few levels"). The host's
// backlog moves in whole kills -- up one per kill, down one per drain -- and
// drawn raw that reads as a flicker between two levels. Each client now
// follows it with a soft SPRING (arcadeFunnelLevel), slightly underdamped,
// so kills and drains blend into one level that ebbs and swells. The pool's
// radius goes as the square root of the level (a bowl widens as it fills),
// and the surface sways a little while blood is moving.
//
// THE OVERFLOW (2026-10-17: "looks a little bit cheap"). At the brim:
//   a PUDDLE on the ground round the funnel, an irregular edge that spreads
//     while it overflows and slowly soaks away after (drawn BEFORE the bowl,
//     so the bowl sits in it);
//   SHEETS of blood over the lip that feed it, with flow lines running out;
//   a swollen MENISCUS over the rim, RIPPLES and BUBBLES on the surface;
//   each overflowing kill's spatter ARCS out over the lip and lands in the
//     puddle.
// Flat fills in a few shades, no gradients, like everything else here.
const POOL_K = 9;                 // spring stiffness (1/s^2)
const POOL_C = 4.6;               // damping (a little under critical: a soft swell)
const PUDDLE_MAX = 58;            // px past the rim
const BLOOD_DARK = "#3E060D", BLOOD = "#6A0C18", BLOOD_MID = "#8A1020", BLOOD_LIT = "#B01428", BLOOD_HOT = "#E0343E";

// This client's smoothed view of funnel i: level 0..1 (spring), overflow
// 0..1 (eased), puddle px. Advanced once per frame here; nothing on the wire.
function arcadeFunnelLevel(i, now) {
    const S = arcFlow.pool || (arcFlow.pool = []);
    let p = S[i];
    const target = Math.min(1, (funnelBacklog[i] || 0) / FUNNEL_HOLD);
    if (!p) p = S[i] = { x: target, v: 0, ov: 0, pud: 0, t: now };
    const dt = Math.min(0.05, Math.max(0, (now - p.t) / 1000));
    p.t = now;
    p.v += ((target - p.x) * POOL_K - p.v * POOL_C) * dt;
    p.x = clamp(p.x + p.v * dt, 0, 1.03);
    const brim = (funnelBacklog[i] || 0) >= FUNNEL_HOLD;
    p.ov = brim ? Math.min(1, p.ov + dt * 1.6) : Math.max(0, p.ov - dt * 0.5);
    p.pud = p.ov > 0.4 ? Math.min(PUDDLE_MAX, p.pud + dt * 7 * p.ov) : Math.max(0, p.pud - dt * 2.2);
    return p;
}

// A fixed, irregular edge per funnel: the same blob every frame, creeping.
function puddleEdge(i, a, now) {
    return 0.62 + 0.18 * Math.sin(a * 3 + i * 1.7) + 0.12 * Math.sin(a * 5 + i * 0.9)
         + 0.08 * Math.sin(a * 7 + i * 2.3 + now / 2400);
}

function arcadeDrawPuddle(f, i, P, now) {
    if (P.pud < 1) return;
    const N = 36;
    const blob = function (scale, col) {
        ctx.fillStyle = col;
        ctx.beginPath();
        for (let n = 0; n <= N; n++) {
            const a = n / N * Math.PI * 2;
            const r = f.r + P.pud * puddleEdge(i, a, now) * scale;
            const x = f.x + Math.cos(a) * r, y = f.y + Math.sin(a) * r * 0.92 + 4;
            if (n) ctx.lineTo(x, y); else ctx.moveTo(x, y);
        }
        ctx.fill();
    };
    blob(1.0, BLOOD_DARK);
    blob(0.8, BLOOD);
    blob(0.45, BLOOD_MID);
    // Glints on the wet ground, toward the light (up-left).
    ctx.fillStyle = BLOOD_LIT;
    for (let k = 0; k < 5; k++) {
        const a = Math.PI * 1.1 + k * 0.32 + i * 0.4;
        const r = f.r + P.pud * puddleEdge(i, a, now) * 0.6;
        ctx.fillRect(Math.round(f.x + Math.cos(a) * r), Math.round(f.y + Math.sin(a) * r * 0.92 + 4), 4 + (k % 2) * 3, 2);
    }
}

function arcadeDrawFunnels(now, inView) {
    for (let i = 0; i < funnels.length; i++) {
        const f = funnels[i];
        if (!f) continue;
        const P = arcadeFunnelLevel(i, now);
        const reach = f.r + PUDDLE_MAX + 20;
        if (!inView(f.x - reach, f.y - reach, reach * 2, reach * 2)) continue;
        const live = funnelActive[i];
        arcadeDrawPuddle(f, i, P, now);
        const steps = ["#5A5A5A", "#4A4A4A", "#3B3B3B", "#2D2D2D", "#202020"];
        for (let s = 0; s < steps.length; s++) {
            const r = f.r * (1 - s * 0.17);
            ctx.fillStyle = steps[s];
            ctx.beginPath();
            ctx.arc(f.x, f.y + s * 3, r, 0, Math.PI * 2);
            ctx.fill();
        }
        // The rim's lit lip.
        ctx.strokeStyle = live ? "#B0B0B0" : "#6E6E6E";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(f.x, f.y, f.r, Math.PI * 1.05, Math.PI * 1.95);
        ctx.stroke();
        // The grate: ROUND and dark (2026-10-04) -- a drain, not a vent.
        const g = Math.round(f.r * 0.26);
        const gcx = f.x, gcy = f.y + 12;
        ctx.fillStyle = "#050505";
        ctx.beginPath();
        ctx.arc(gcx, gcy, g, 0, Math.PI * 2);
        ctx.fill();
        const bars = function () {
            ctx.save();
            ctx.beginPath();
            ctx.arc(gcx, gcy, g - 2, 0, Math.PI * 2);
            ctx.clip();
            ctx.fillStyle = "#2A2A2A";
            for (let b = -g; b <= g; b += 6) ctx.fillRect(Math.round(gcx + b), gcy - g, 2, g * 2);
            ctx.restore();
        };
        bars();
        // The pool: the smoothed backlog, from the grate to the brim
        // (2026-10-16: "allow for funnel to be filled past grate even
        // allowing for it to be completely filled to the brim").
        const L = Math.min(1, P.x);
        let poolR = 0;
        if (L > 0.005) {
            const sway = Math.abs(P.v) * 6 + (live ? 0.6 : 0);
            const rb = Math.min(f.r - 1, f.r * (0.1 + 0.88 * Math.sqrt(L)) + Math.sin(now / 380 + i) * sway);
            const cy = f.y + 12 * (1 - L);
            poolR = rb;
            ctx.fillStyle = BLOOD_DARK;
            ctx.beginPath();
            ctx.arc(f.x, cy, rb, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = BLOOD;
            ctx.beginPath();
            ctx.arc(f.x, cy - 1, rb * 0.88, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = BLOOD_MID;
            ctx.beginPath();
            ctx.arc(f.x - rb * 0.08, cy - rb * 0.1, rb * 0.6, 0, Math.PI * 2);
            ctx.fill();
            // The surface's lit crescent, drifting a little.
            const hx = f.x - rb * 0.5 + Math.sin(now / 900 + i) * rb * 0.06;
            ctx.fillStyle = BLOOD_LIT;
            ctx.fillRect(Math.round(hx), Math.round(cy - rb * 0.66), Math.round(rb * 0.46), Math.max(2, Math.round(rb * 0.07)));
            ctx.fillRect(Math.round(hx + rb * 0.1), Math.round(cy - rb * 0.56), Math.round(rb * 0.22), Math.max(2, Math.round(rb * 0.05)));
            // The grate shows through a shallow pool, and is gone under a deep one.
            if (rb < g * 1.6) {
                ctx.globalAlpha = 0.55 * (1 - Math.max(0, rb - g) / (g * 0.6));
                bars();
                ctx.globalAlpha = 1;
            }
        }
        if (P.ov > 0.02) arcadeDrawOverflow(f, i, P, now);
        // Each kill's blood, from where it fell, drawn into the grate -- or,
        // at the brim, thrown out over the lip in an arc into the puddle.
        for (let k = 0; k < arcFlow.parts.length; k++) {
            const q = arcFlow.parts[k];
            if (q.i !== i || now < q.t0) continue;
            const e = Math.min(1, (now - q.t0) / q.dur), ee = e * e;
            let tx = gcx, ty = gcy, hop = 0;
            if (q.over) {
                const rr = f.r + 10 + (P.pud + 8) * (0.4 + 0.5 * Math.abs(Math.sin(q.a * 3)));
                tx = f.x + Math.cos(q.a) * rr; ty = f.y + Math.sin(q.a) * rr;
                hop = Math.sin(e * Math.PI) * 26;
            }
            const dx = tx - q.sx, dy = ty - q.sy, d = Math.hypot(dx, dy) || 1;
            const ex = q.over ? e : ee;
            const wob = q.over ? 0 : Math.sin(e * Math.PI) * q.wob;
            ctx.fillStyle = q.col;
            ctx.fillRect(Math.round(q.sx + dx * ex - dy / d * wob), Math.round(q.sy + dy * ex + dx / d * wob - hop), q.sz, q.sz);
        }
        if (poolR < g * 1.6) {                           // the grate's rim, until the pool drowns it
            ctx.strokeStyle = "#333333";
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(gcx, gcy, g, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
}

// The brim: a swollen meniscus over the rim, sheets over the lip feeding
// the puddle with flow running out along them, rings and bubbles on top.
function arcadeDrawOverflow(f, i, P, now) {
    const ov = P.ov;
    // The meniscus: blood standing proud of the rim, all the way round.
    ctx.strokeStyle = BLOOD_DARK;
    ctx.lineWidth = 7;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r + 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = BLOOD_MID;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r - 1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = BLOOD_LIT;                    // its lit top edge
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(f.x, f.y, f.r - 2, Math.PI * 1.1, Math.PI * 1.75);
    ctx.stroke();
    // Sheets over the lip: wide at the rim, narrowing out to where the
    // puddle has got to, each with flow marks running outward.
    for (let k = 0; k < 7; k++) {
        const a = k * 0.898 + i * 0.6 + Math.sin(k * 2.1) * 0.25;
        // Ends INSIDE the puddle (a sheet that ran past it would read as a spike).
        const len = (4 + P.pud * puddleEdge(i, a, now) * 0.8) * ov;
        if (len < 3) continue;
        const w0 = 10 + (k % 3) * 3, w1 = 7;
        const ca = Math.cos(a), sa = Math.sin(a), px = -sa, py = ca;
        const bx = f.x + ca * (f.r - 3), by = f.y + sa * (f.r - 3);
        const tx = bx + ca * len, ty = by + sa * len;
        ctx.fillStyle = BLOOD;
        ctx.beginPath();
        ctx.moveTo(bx + px * w0, by + py * w0);
        ctx.lineTo(tx + px * w1, ty + py * w1);
        ctx.lineTo(tx - px * w1, ty - py * w1);
        ctx.lineTo(bx - px * w0, by - py * w0);
        ctx.fill();
        ctx.beginPath();                                 // a round, heavy lobe where it lands
        ctx.arc(tx, ty, w1 + 1, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = BLOOD_MID;
        ctx.beginPath();
        ctx.moveTo(bx + px * w0 * 0.5, by + py * w0 * 0.5);
        ctx.lineTo(tx + px * w1 * 0.4, ty + py * w1 * 0.4);
        ctx.lineTo(tx - px * w1 * 0.4, ty - py * w1 * 0.4);
        ctx.lineTo(bx - px * w0 * 0.5, by - py * w0 * 0.5);
        ctx.fill();
        // Flow: short lit dashes sliding outward along the sheet.
        ctx.fillStyle = BLOOD_LIT;
        const speed = 34;
        for (let d = ((now / 1000) * speed + k * 11) % 14; d < len - 2; d += 14) {
            const t = d / len, w = w0 + (w1 - w0) * t;
            const off = ((k * 7 + Math.floor(d)) % 3 - 1) * w * 0.35;
            ctx.fillRect(Math.round(bx + ca * d + px * off - 1), Math.round(by + sa * d + py * off - 1), 3, 3);
        }
    }
    // Ripples on the full surface: rings opening from the middle and fading
    // out in steps.
    for (let k = 0; k < 3; k++) {
        const ph = ((now / 1500) + k / 3) % 1;
        const rr = f.r * (0.15 + 0.78 * ph);
        ctx.strokeStyle = ph < 0.2 ? BLOOD_HOT : ph < 0.5 ? BLOOD_LIT : ph < 0.8 ? BLOOD_MID : BLOOD;
        ctx.lineWidth = ph < 0.5 ? 3 : 2;
        ctx.globalAlpha = ov;
        ctx.beginPath();
        ctx.arc(f.x, f.y, rr, 0, Math.PI * 2);
        ctx.stroke();
    }
    // Bubbles rising and popping.
    for (let k = 0; k < 6; k++) {
        const ph = ((now / 1100) + k * 0.37) % 1;
        const a = k * 2.4 + Math.floor((now / 1100) + k * 0.37) * 1.3;
        const r = f.r * (0.2 + 0.55 * ((k * 0.61) % 1));
        const x = f.x + Math.cos(a) * r, y = f.y + Math.sin(a) * r;
        const s = ph < 0.8 ? 3 + Math.floor(ph * 4) : 0;
        if (s) {
            ctx.fillStyle = BLOOD_DARK;
            ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), s, s);
            ctx.fillStyle = BLOOD_HOT;
            ctx.fillRect(Math.round(x - s / 2), Math.round(y - s / 2), 1, 1);
        } else {
            ctx.fillStyle = BLOOD_LIT;                  // the pop
            ctx.fillRect(Math.round(x - 3), Math.round(y), 2, 1);
            ctx.fillRect(Math.round(x + 2), Math.round(y), 2, 1);
            ctx.fillRect(Math.round(x), Math.round(y - 3), 1, 2);
        }
    }
    ctx.globalAlpha = 1;
}

// ---------------------------------------------------
//   THE BLOOD RUN (2026-10-16, branch zombie-funnel-pipes)
// ---------------------------------------------------
// "improve the blood funnel to silo pipe visuals ... show an elbow of the
// pipes into the ground & connecting to piping that go up the side of each
// silo & pours blood into the top, there should be a slight delay between
// when zombies are killed on the funnels to when the blood shows as
// ascending, and when the blood level raises in the silo."
// Then, on the questions: the tank must WAIT for the blood; the funnel is a
// BACKLOG that drains steadily into the tank and OVERFLOWS, and kills past
// the tank's capacity still fill it; the pipe runs HORIZONTALLY out of the
// funnel and elbows 90 degrees up the tank; particles start at the real
// kill.
//
// THE MODEL (host-owned, like everything else in the chain):
//   a kill on a funnel      -> funnelBacklog[i]++ (to FUNNEL_HOLD; past it the
//                              funnel overflows and the kill is spilled)
//   every FUNNEL_DRAIN_MS   -> one unit leaves the funnel (funnelDrained[i]++)
//                              while the tank still has room for it
//   the unit's travel time  -> siloFill[i]++ when it ARRIVES. siloFill is
//                              still the one number the switch, READY, the
//                              labels and the score read -- it just moves
//                              when the blood gets there.
// `fb` (backlog) and `fd` (drained, a running count) ride the snapshot. A
// client draws a pulse down the pipe for every rise in fd, so the pipe
// shows exactly what the host has sent. The kill's spatter comes off the
// SND_CRATE event creditFunnelKill already sends, at the kill's own spot.
const FUNNEL_HOLD = 10;           // kills to fill a funnel to the brim
const FUNNEL_DRAIN_MS = 650;      // one kill's blood leaves the funnel this often
const FLOW_GATHER_MS = 450;       // a kill's spatter drawn into the grate
const FLOW_SPEED = 380;           // px/s along the ground pipe
const FLOW_RISE_MS = 550;         // up the riser
const FLOW_POUR_MS = 320;         // over the lid
const RISER_OUT = 9;              // riser's offset from the tank wall
const RISER_NECK = 10;            // how far the gooseneck stands above the lid
const RISER_REACH = 16;           // how far it reaches over the lid

let funnelBacklog = [];           // HOST-owned, on the wire as `fb`
let funnelDrained = [];           // HOST-owned running count, on the wire as `fd`
let arcInFlight = [];             // HOST: per tank, arrival times of blood in the pipe
let arcDrainAt = [];              // HOST: per tank, when the next unit may leave
let arcFlow = { arr: null, seen: [], pulses: [], parts: [] };   // per client, visual

// With siloFill, at every place the chain is built or reset.
function arcadeResetBlood(n) {
    funnelBacklog = new Array(n).fill(0);
    funnelDrained = new Array(n).fill(0);
    arcInFlight = [];
    arcDrainAt = [];
    arcFlow = { arr: null, seen: [], pulses: [], parts: [], pool: [] };
}

// The pipe's route, as built: the rim, horizontally out of the funnel to a
// corner, then to the riser's foot on the ground beside the tank.
//   nx/ny: the side of the tank the riser stands on (its outward normal).
function arcadePipeRoute(f, s, px, py, ny) {
    const sgn = function (v) { return v < 0 ? -1 : 1; };
    let rim, corner, foot, nx = 0;
    if (px !== undefined) {
        // The giant reservoir: the riser's column is given (a gap between bays).
        foot = { x: px, y: py + ny * RISER_OUT };
        if (Math.abs(px - f.x) > f.r + 20) {
            rim = { x: f.x + sgn(px - f.x) * (f.r + 4), y: f.y };
            corner = { x: px, y: f.y };
        } else {
            rim = { x: f.x, y: f.y + sgn(foot.y - f.y) * (f.r + 4) };
            corner = { x: rim.x, y: rim.y };
        }
    } else if (f.x + f.r + 20 < s.x || f.x - f.r - 20 > s.x + s.w) {
        // Beside the tank: out sideways, along, and up its near side.
        nx = f.x < s.x ? -1 : 1;
        const fx = nx < 0 ? s.x - RISER_OUT : s.x + s.w + RISER_OUT;
        const fy = clamp(f.y, s.y + 8, s.y + s.h - 8);
        rim = { x: f.x - nx * (f.r + 4), y: f.y };
        corner = { x: fx, y: f.y };
        foot = { x: fx, y: fy };
        ny = 0;
    } else {
        // Straight above or below it: out of the bowl toward it, then along.
        ny = f.y > s.y + s.h ? 1 : -1;
        const fx = clamp(f.x, s.x + 10, s.x + s.w - 10);
        const fy = ny > 0 ? s.y + s.h + RISER_OUT : s.y - RISER_OUT;
        rim = { x: f.x, y: f.y - ny * (f.r + 4) };
        corner = { x: f.x, y: fy };
        foot = { x: fx, y: fy };
    }
    const r = function (v) { return Math.round(v); };
    // x1..y2 keep their old meaning (an extent the ground masks read).
    return { x1: r(rim.x), y1: r(rim.y), cx: r(corner.x), cy: r(corner.y), x2: r(foot.x), y2: r(foot.y), nx: nx, ny: ny };
}

function arcadeRunPts(p) {
    return [[p.x1, p.y1], [p.cx !== undefined ? p.cx : p.x1, p.cy !== undefined ? p.cy : p.y1], [p.x2, p.y2]];
}

function arcadePipeLen(i) {
    const p = siloPipes[i];
    if (!p) return 0;
    const q = arcadeRunPts(p);
    return Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]) + Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]);
}

// Ground run, riser, pour: how long a unit takes from funnel to tank.
function arcadeTravelMs(i) {
    return arcadePipeLen(i) / FLOW_SPEED * 1000 + FLOW_RISE_MS + FLOW_POUR_MS;
}

// Is this funnel taking blood? While it is live, and (so kills past the
// tank's capacity still fill it) while its tank is full and unpumped.
function arcadeFunnelTakes(i) {
    return funnelActive[i] || (siloFill[i] >= siloCapacity(i) && !siloFlipped[i]);
}

// HOST, from creditFunnelKill: a kill on a funnel.
function arcadeCreditFunnelKill(x, y) {
    for (let i = 0; i < funnels.length; i++) {
        const f = funnels[i];
        if (!f || !arcadeFunnelTakes(i) || Math.hypot(x - f.x, y - f.y) > f.r) continue;
        if ((funnelBacklog[i] || 0) < FUNNEL_HOLD) funnelBacklog[i] = (funnelBacklog[i] || 0) + 1;
        hostEvent(SND_CRATE, x, y);   // the sound, and every client's spatter
        return;
    }
}

// HOST, every step: drain the funnels into the pipes, and land what arrives.
function arcadeUpdateBlood(now) {
    for (let i = 0; i < funnels.length; i++) {
        if (!arcInFlight[i]) arcInFlight[i] = [];
        const q = arcInFlight[i], cap = siloCapacity(i);
        // A promoted host never saw the blood already in the pipe: whatever
        // was drained and has not arrived is put back in flight.
        let missing = (funnelDrained[i] || 0) - siloFill[i] - q.length;
        while (missing-- > 0) q.push(now + arcadeTravelMs(i));
        while (q.length && now >= q[0]) {
            q.shift();
            if (siloFill[i] >= cap) continue;
            siloFill[i]++;
            if (siloFill[i] >= cap) {
                // Full: its switch unlocks; the funnel stops being the target.
                funnelActive[i] = false;
                hostEvent(SND_ROUND_CLEAR, silos[i] ? silos[i].x : funnels[i].x, silos[i] ? silos[i].y : funnels[i].y);
            }
        }
        if ((funnelBacklog[i] || 0) > 0 && siloFill[i] + q.length < cap && now >= (arcDrainAt[i] || 0)) {
            funnelBacklog[i]--;
            funnelDrained[i] = (funnelDrained[i] || 0) + 1;
            q.push(now + arcadeTravelMs(i));
            arcDrainAt[i] = now + FUNNEL_DRAIN_MS;
        }
    }
}

// Every client, once a frame: a pulse for every unit the host has drained.
function arcadeFlowSync(now) {
    const F = arcFlow;
    if (F.arr !== funnelDrained) {
        F.arr = funnelDrained;
        F.seen = funnelDrained.slice();
        F.pulses = funnelDrained.map(function () { return []; });
    }
    for (let i = 0; i < funnels.length; i++) {
        if (!F.pulses[i]) F.pulses[i] = [];
        const d = (funnelDrained[i] || 0) - (F.seen[i] || 0);
        if (d < 0 || d > 6) F.pulses[i] = [];                 // a join or a reset: no backfill
        else for (let j = 0; j < d; j++) F.pulses[i].push({ t0: now - j * 60 });
        F.seen[i] = funnelDrained[i] || 0;
        const ps = F.pulses[i], T = arcadeTravelMs(i);
        while (ps.length && now >= ps[0].t0 + T) ps.shift();
    }
    for (let k = F.parts.length - 1; k >= 0; k--) {
        if (now >= F.parts[k].t0 + F.parts[k].dur) F.parts.splice(k, 1);
    }
}

// Every client, off SND_CRATE: the kill's blood, from where it fell, drawn
// into the grate -- or, at the brim, thrown over the lip.
function arcadeFunnelSplash(x, y) {
    if (!ZOMBIE_ARCADE || arcFlow.parts.length > 260) return;
    for (let i = 0; i < funnels.length; i++) {
        const f = funnels[i];
        if (!f || Math.hypot(x - f.x, y - f.y) > f.r + 24) continue;
        const now = Date.now(), over = (funnelBacklog[i] || 0) >= FUNNEL_HOLD;
        for (let n = 0; n < 10; n++) {
            arcFlow.parts.push({ i: i, t0: now + Math.random() * 80, dur: FLOW_GATHER_MS - 60 + Math.random() * 60,
                                 sx: x + (Math.random() - 0.5) * 16, sy: y + (Math.random() - 0.5) * 16,
                                 wob: (Math.random() - 0.5) * 30, over: over, a: Math.random() * Math.PI * 2,
                                 sz: Math.random() < 0.35 ? 3 : 2, col: ["#C0182C", "#8A1020", "#E8303C"][n % 3] });
        }
        return;
    }
}

// The tank's gauge: siloFill, which now moves when the blood arrives.
function arcadeShownFill(i) { return siloFill[i]; }

// The ground run: the rim's ground elbow, out horizontally, an elbow at
// the corner, along to the riser's foot. A dark sight slot down the middle
// shows the blood going by.
function arcadeDrawPipes(now, inView) {
    arcadeFlowSync(now);
    for (let i = 0; i < siloPipes.length; i++) {
        const p = siloPipes[i];
        if (!p) continue;
        const q = arcadeRunPts(p);
        const x0 = Math.min(q[0][0], q[1][0], q[2][0]), y0 = Math.min(q[0][1], q[1][1], q[2][1]);
        const x1 = Math.max(q[0][0], q[1][0], q[2][0]), y1 = Math.max(q[0][1], q[1][1], q[2][1]);
        if (!inView(x0 - 30, y0 - 30, x1 - x0 + 60, y1 - y0 + 60)) continue;
        const live = arcadeFunnelTakes(i) && !siloFlipped[i];
        const L0 = Math.hypot(q[1][0] - q[0][0], q[1][1] - q[0][1]);
        const L1 = Math.hypot(q[2][0] - q[1][0], q[2][1] - q[1][1]);
        const L = L0 + L1;
        // A point at distance d along the run.
        const at = function (d) {
            if (d <= L0) { const t = L0 ? d / L0 : 0; return [q[0][0] + (q[1][0] - q[0][0]) * t, q[0][1] + (q[1][1] - q[0][1]) * t]; }
            const t = L1 ? (d - L0) / L1 : 0;
            return [q[1][0] + (q[2][0] - q[1][0]) * t, q[1][1] + (q[2][1] - q[1][1]) * t];
        };
        const line = function (col, w, dy, d0, d1) {
            ctx.strokeStyle = col;
            ctx.lineWidth = w;
            ctx.beginPath();
            const a = at(d0);
            ctx.moveTo(a[0], a[1] + dy);
            if (d0 < L0 && d1 > L0) ctx.lineTo(q[1][0], q[1][1] + dy);
            const b = at(d1);
            ctx.lineTo(b[0], b[1] + dy);
            ctx.stroke();
        };
        ctx.lineCap = "square";
        line("#1A1A1A", 16, 4, 0, L);                       // shadow on the ground
        line("#555555", 14, 0, 0, L);                       // body
        ctx.lineCap = "butt";
        line("#7C7C7C", 3, -5, 0, L);                       // lit top edge
        line(live ? "#3A0C12" : "#161616", 4, 0, 0, L);     // the sight slot
        // The blood going by.
        const ps = arcFlow.pulses[i] || [], R = L / FLOW_SPEED * 1000;
        for (let k = 0; k < ps.length; k++) {
            const t = now - ps[k].t0;
            if (t < 0 || t >= R) continue;
            const d = L * t / R;
            line("#C0182C", 4, 0, Math.max(0, d - 18), d);
            line("#FF5A5A", 2, 0, Math.max(0, d - 5), d);
        }
        // Flanges, square to the run.
        ctx.fillStyle = "#8A8A8A";
        for (let d = 26; d < L - 12; d += 40) {
            if (Math.abs(d - L0) < 14) continue;            // not on the elbow
            const a = at(d), horiz = d < L0 ? Math.abs(q[1][0] - q[0][0]) >= Math.abs(q[1][1] - q[0][1])
                                            : Math.abs(q[2][0] - q[1][0]) >= Math.abs(q[2][1] - q[1][1]);
            if (horiz) ctx.fillRect(Math.round(a[0] - 3), Math.round(a[1] - 10), 6, 20);
            else ctx.fillRect(Math.round(a[0] - 10), Math.round(a[1] - 3), 20, 6);
        }
        // The elbow at the corner: a heavier block where the run turns.
        if (L0 > 2 && L1 > 2) {
            ctx.fillStyle = "#1A1A1A";
            ctx.fillRect(q[1][0] - 9, q[1][1] - 6, 20, 18);
            ctx.fillStyle = "#606060";
            ctx.fillRect(q[1][0] - 10, q[1][1] - 10, 20, 20);
            ctx.fillStyle = "#808080";
            ctx.fillRect(q[1][0] - 10, q[1][1] - 10, 20, 3);
        }
        // THE GROUND ELBOW at the funnel: the bowl drains below grade and the
        // pipe comes up out of the ground at the rim. A dark collar in the
        // ground, the bend in shadow, a flange where it levels off.
        ctx.fillStyle = "#0A0A0A";
        ctx.beginPath();
        ctx.ellipse(q[0][0], q[0][1] + 3, 11, 8, 0, 0, Math.PI * 2);
        ctx.fill();
        line("#333333", 14, 2, 0, Math.min(10, L));
        const fl = at(Math.min(13, L));
        ctx.fillStyle = "#9A9A9A";
        if (Math.abs(q[1][0] - q[0][0]) >= Math.abs(q[1][1] - q[0][1])) ctx.fillRect(Math.round(fl[0] - 3), Math.round(fl[1] - 10), 6, 20);
        else ctx.fillRect(Math.round(fl[0] - 10), Math.round(fl[1] - 3), 20, 6);
    }
}

// Where tank i's riser stands: up from the run's foot, beside the tank.
//   ny < 0 is the BACK of the tank, where the riser is hidden behind it and
//   only its neck shows above the lid.
function arcadeRiser(i) {
    const p = siloPipes[i], s = silos[i];
    if (!p || !s || p.nx === undefined) return null;
    const nx = p.nx, ny = p.ny;
    const lift = s.giant ? GIANT_LIFT : SILO_LIFT;
    const groundY = ny < 0 ? s.y : ny > 0 ? s.y + s.h : p.y2;
    const topY = groundY - lift - RISER_NECK;
    const mx = p.x2 - nx * (RISER_OUT + RISER_REACH);
    const my = ny ? topY - ny * (RISER_OUT + RISER_REACH) : topY;
    return { fx: p.x2, fy: p.y2, nx: nx, ny: ny, topY: topY, mx: mx, my: my, lidY: groundY - lift,
             back: ny < 0, face: ny > 0, w: s.giant ? 12 : 14 };
}

// After tank i is drawn: the riser up its side (a 90-degree elbow off the
// ground run), the gooseneck over the lid, the blood climbing, the pour.
function arcadeDrawRiser(i, now) {
    const R = arcadeRiser(i);
    if (!R) return;
    const x = Math.round(R.fx), w = R.w;
    const bottom = R.back ? R.lidY : R.fy;           // a back riser shows only above the lid
    const vpipe = function (col, ww, x0, y0, y1) {
        ctx.fillStyle = col;
        ctx.fillRect(Math.round(x0 - ww / 2), Math.round(Math.min(y0, y1)), ww, Math.round(Math.abs(y1 - y0)));
    };
    if (!R.face) vpipe("#1A1A1A", w + 2, x + 3, R.topY + 2, bottom + 2);
    vpipe("#555555", w, x, R.topY, bottom);
    vpipe("#7C7C7C", 3, x - w / 2 + 2, R.topY, bottom);
    vpipe("#161616", 4, x, R.topY + 4, bottom - 2);
    // The foot's elbow, where the ground run turns up.
    if (!R.back) {
        ctx.fillStyle = "#606060";
        ctx.fillRect(x - w / 2 - 3, Math.round(R.fy - 8), w + 6, 16);
        ctx.fillStyle = "#808080";
        ctx.fillRect(x - w / 2 - 3, Math.round(R.fy - 8), w + 6, 3);
    }
    // Hoops up the riser.
    ctx.fillStyle = "#8A8A8A";
    for (let y = bottom - 24; y > R.topY + 8; y -= 30) ctx.fillRect(x - w / 2 - 2, Math.round(y), w + 4, 4);
    // The gooseneck: from the riser's top over to the mouth.
    ctx.fillStyle = "#555555";
    if (R.ny === 0) ctx.fillRect(Math.round(Math.min(x, R.mx)) - w / 2, Math.round(R.topY - w / 2), Math.round(Math.abs(R.mx - x)) + w, w);
    else ctx.fillRect(x - w / 2, Math.round(Math.min(R.topY, R.my)) - w / 2, w, Math.round(Math.abs(R.my - R.topY)) + w);
    ctx.fillStyle = "#7C7C7C";
    if (R.ny === 0) ctx.fillRect(Math.round(Math.min(x, R.mx)) - w / 2, Math.round(R.topY - w / 2), Math.round(Math.abs(R.mx - x)) + w, 3);
    else ctx.fillRect(x - w / 2, Math.round(Math.min(R.topY, R.my)) - w / 2, 3, Math.round(Math.abs(R.my - R.topY)) + w);
    ctx.fillStyle = "#0A0A0A";                        // the open mouth
    ctx.fillRect(Math.round(R.mx - 5), Math.round(R.my + 3), 10, 4);
    // Blood: climbing the riser, then pouring from the mouth onto the lid.
    const ps = arcFlow.pulses[i];
    if (!ps) return;
    const run = arcadePipeLen(i) / FLOW_SPEED * 1000;
    for (let k = 0; k < ps.length; k++) {
        const t = now - ps[k].t0 - run;
        if (t < 0) continue;
        if (t < FLOW_RISE_MS) {
            const yy = R.fy + (R.topY - R.fy) * (t / FLOW_RISE_MS);
            if (yy >= bottom) continue;               // still hidden behind the tank
            ctx.fillStyle = "#C0182C";
            ctx.fillRect(x - 2, Math.round(yy), 4, 16);
            ctx.fillStyle = "#FF5A5A";
            ctx.fillRect(x - 1, Math.round(yy), 2, 5);
        } else if (t < FLOW_RISE_MS + FLOW_POUR_MS) {
            const k2 = (t - FLOW_RISE_MS) / FLOW_POUR_MS;
            ctx.fillStyle = "#C0182C";
            ctx.fillRect(Math.round(R.mx - 2), Math.round(R.my + 6), 4, Math.round(4 + 8 * (1 - k2)));
            ctx.fillStyle = "#8A1020";
            ctx.fillRect(Math.round(R.mx - 5 - 3 * k2), Math.round(R.my + 14), Math.round(10 + 6 * k2), 3);
        }
    }
}

function drawTallSilo(i, si, now) {
    const lift = SILO_LIFT;
    const frac = Math.min(1, arcadeShownFill(i) / siloCapacity(i));     // lags the kills: THE BLOOD RUN
    const ready = siloReady(i), done = siloFlipped[i];
    // Ground shadow.
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(si.x + 10, si.y + 8, si.w, si.h);
    // Front face: the tall body, from the top face's lower edge to the ground.
    const faceY = si.y + si.h - lift;
    ctx.fillStyle = "#3A1A1E";
    ctx.fillRect(si.x, faceY, si.w, lift);
    // Blood rising in it, behind a sight-glass strip.
    const gx = si.x + 8, gw = 18;
    ctx.fillStyle = "#140608";
    ctx.fillRect(gx, faceY + 8, gw, lift - 14);
    const fh = Math.round((lift - 14) * frac);
    ctx.fillStyle = "#C0182C";
    ctx.fillRect(gx, faceY + 8 + (lift - 14) - fh, gw, fh);
    // Hoops.
    ctx.fillStyle = "#5A2A30";
    for (let k = 1; k <= 3; k++) ctx.fillRect(si.x, faceY + Math.round(lift * k / 4), si.w, 3);
    // The switch, at the base.
    drawLeverSwitch(si.x + 48, si.y + si.h - 4, arcadeLeverFrac(i, now), ready && !done, now);
    // Top face, lifted.
    ctx.fillStyle = done ? "#2C4A2C" : ready ? (now % 500 < 250 ? COLOR_BUY : "#2E8A2E") : "#6A3238";
    ctx.fillRect(si.x, si.y - lift, si.w, si.h);
    ctx.fillStyle = "#8A4A50";
    ctx.fillRect(si.x + 6, si.y - lift + 6, si.w - 12, 4);
    ctx.strokeStyle = done ? "#335533" : ready ? COLOR_BUY : "#995560";
    ctx.lineWidth = 2;
    ctx.strokeRect(si.x, si.y - lift, si.w, si.h + lift);
    // A big number on the top, so a tank is named from across the arena.
    ctx.fillStyle = "#FFFFFF";
    ctx.font = "bold 22px Courier";
    ctx.textAlign = "center";
    ctx.fillText(String(i + 1), si.x + si.w / 2, si.y - lift + si.h / 2 + 8);
    ctx.font = "bold 10px Courier";
    ctx.fillStyle = done ? "#5A8A5A" : ready ? COLOR_BUY : "#FFAAAA";
    ctx.fillText(done ? "PUMPED" : ready ? "[F] SWITCH" : siloFill[i] + "/" + siloCapacity(i),
                 si.x + si.w / 2, si.y + si.h + 14);
    ctx.textAlign = "left";
}

const TRUNK_W = 12;

function drawTallTree(t) {
    // `t` is the whole solid shape; the footprint is its bottom edge.
    const cx = t.x + t.w / 2;
    const lift = TREE_LIFT;
    const cw = t.cw || TREE_CANOPY, ch = Math.round(cw * 0.8);
    // Shadow on the ground under the footprint.
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(Math.round(cx - TREE_TRUNK / 2) + 6, t.y + t.h - TREE_TRUNK + 6, TREE_TRUNK, TREE_TRUNK);
    // Trunk, standing in the footprint.
    ctx.fillStyle = "#3A2614";
    ctx.fillRect(Math.round(cx - TRUNK_W / 2), t.y + t.h - lift - 6, TRUNK_W, lift + 6);
    // Canopy: a dark lower band (the side) and a lit top, lifted.
    const top = t.y + t.h - lift - ch;
    const shade = TREE_SHADES[Math.floor(t.shade * TREE_SHADES.length) % TREE_SHADES.length];
    ctx.fillStyle = "#132A0F";
    ctx.fillRect(Math.round(cx - cw / 2), top + Math.round(ch * 0.55), cw, Math.round(ch * 0.45));
    ctx.fillStyle = shade;
    ctx.fillRect(Math.round(cx - cw / 2), top, cw, Math.round(ch * 0.6));
    ctx.fillRect(Math.round(cx - cw * 0.35), top - 8, Math.round(cw * 0.7), 10);
    ctx.fillStyle = "#3A6A2C";
    ctx.fillRect(Math.round(cx - cw * 0.3), top - 4, Math.round(cw * 0.35), 7);
}

// After the zombies: every tall thing, back to front.
function arcadeDrawTall(now, inView) {
    const list = [];
    for (let i = 0; i < arenaTrees.length; i++) {
        const t = arenaTrees[i];
        if (inView(t.x - 20, t.y - 20, t.w + 40, t.h + 40)) {
            list.push({ y: t.y + t.h, tree: t });
        }
    }
    if (giantSilo) {
        if (inView(giantSilo.x, giantSilo.y - giantSilo.lift, giantSilo.w, giantSilo.h + giantSilo.lift + 20)) {
            list.push({ y: giantSilo.y + giantSilo.h, giant: true });
        }
    } else {
        for (let i = 0; i < silos.length; i++) {
            const s = silos[i];
            if (s && inView(s.x, s.y - SILO_LIFT, s.w, s.h + SILO_LIFT + 20)) list.push({ y: s.y + s.h, silo: i });
        }
    }
    for (let i = 0; i < arenaProps.length; i++) {
        const r = arenaProps[i];
        if (inView(r.x - 8, r.y - 8, r.w + 16, r.h + 16)) list.push({ y: r.y + r.h, prop: r });
    }
    arcadeDrawWindows();
    list.sort(function (a, b) { return a.y - b.y; });
    for (let i = 0; i < list.length; i++) {
        if (list[i].tree) drawTallTree(list[i].tree);
        else if (list[i].prop) drawSetProp(list[i].prop);
        else if (list[i].giant) { drawGiantSilo(now); for (let k = 0; k < silos.length; k++) arcadeDrawRiser(k, now); }
        else { drawTallSilo(list[i].silo, silos[list[i].silo], now); arcadeDrawRiser(list[i].silo, now); }
    }
}

// ---------------------------------------------------
//   THE CABINET PANEL (2026-10-04, third playtest note)
// ---------------------------------------------------
// "Make [the sidebar] more like an arcade cabinet sidebar UI (think
// Bosconian)", and the user's rule that every hub game gets one
// (AESTHETIC_GUIDE.md, "The cabinet panel"). Bosconian's right panel is
// HI-SCORE and 1UP at the top, the radar in the middle, CONDITION
// GREEN/YELLOW/RED under it, and the round and lives below -- red labels,
// white numbers, black ground. This is that panel, filled with this game's
// numbers.
const CAB_BEST_KEY = "zombie_arcade_best";
let cabSig = "";

function cabBest() {
    try { return parseInt(localStorage.getItem(CAB_BEST_KEY) || "0", 10) || 0; } catch (e) { return 0; }
}

// Whose it is, kept beside the number (2026-10-12: "put name next to world high
// score"). Rows saved before that have no name, and show none.
// Nobody else in the room (an away teammate does not count): a RALLY is yours alone.
function soloRun() {
    for (const id in remotePlayers) {
        if (Object.prototype.hasOwnProperty.call(remotePlayers, id) && !remotePlayers[id].away) return false;
    }
    return true;
}

const CAB_BEST_NAME_KEY = "zombie_arcade_best_name";

// THE WORLD'S HIGH SCORE (2026-10-12: "does the high score (world high score)
// not pull from firebase? It should"). HI-SCORE is the best run anyone has
// posted to the leaderboard, read once per page through LB.top; this browser's
// own best (above) is only the fallback for a page with no Firestore (file://,
// offline), and for a run that has just beaten it, shown at once.
let cabWorld = null;              // { score, name } once read
let cabWorldAsked = false;
function cabWorldAsk() {
    if (cabWorldAsked) return;
    cabWorldAsked = true;
    if (typeof LB === "undefined" || typeof LB.top !== "function") return;
    LB.top("zombie", 50).then(function (r) {
        if (!r) return;
        if (!cabWorld || r.score > cabWorld.score) cabWorld = { score: r.score, name: String(r.player).toUpperCase().slice(0, 12) };
        cabSig = "";
    });
}
function cabBestName() {
    try { return localStorage.getItem(CAB_BEST_NAME_KEY) || ""; } catch (e) { return ""; }
}

// The best run since this tab was opened (2026-10-12: "highest score this
// session"). sessionStorage, so a reload keeps it and a new tab starts again.
// Counted live: the run in progress is part of the session.
const CAB_SESSION_KEY = "zombie_arcade_session_best";
const CAB_SESSION_NAME_KEY = "zombie_arcade_session_best_name";
let cabSessScore = -1, cabSessName = "";
function cabSessionLoad() {
    if (cabSessScore >= 0) return;
    cabSessScore = 0;
    try {
        cabSessScore = parseInt(sessionStorage.getItem(CAB_SESSION_KEY) || "0", 10) || 0;
        cabSessName = sessionStorage.getItem(CAB_SESSION_NAME_KEY) || "";
    } catch (e) { /* private window: this page load only */ }
}
function cabSelfName() {
    return String((typeof MP !== "undefined" && MP.selfName) || "YOU").toUpperCase().slice(0, 12);
}

// GREEN nothing close; YELLOW they are gathering; RED they are on you.
function cabCondition() {
    const me = players[0];
    const cap = arcadeAliveCap();
    let near = 0;
    if (me) {
        for (let i = 0; i < zombies.length; i++) {
            if (Math.hypot(zombies[i].x - me.x, zombies[i].y - me.y) < 260) near++;
        }
    }
    if (near >= 6 || zombies.length >= cap * 0.8 || (me && me.downed) || arcadeWounded(me, Date.now())) return "RED";
    if (near >= 2 || zombies.length >= cap * 0.4) return "YELLOW";
    return "GREEN";
}

function arcadeUpdateCabinet() {
    const me = players[0];
    const score = me && !zDemo ? runScoreFor(netIdFor(me)).total : 0;     // the attract run scores nothing
    cabWorldAsk();
    let best = cabBest();
    let bestName = cabBestName();
    if ((gameOver || won) && score > best) {
        // This browser's best, kept for a page that cannot reach the board.
        best = score;
        bestName = cabSelfName();
        try {
            localStorage.setItem(CAB_BEST_KEY, String(best));
            localStorage.setItem(CAB_BEST_NAME_KEY, bestName);
        } catch (e) { /* private mode */ }
    }
    // The world's board wins when it can be read; a run that has just beaten
    // it shows at once (the submit has gone, and a re-read is not needed).
    if (cabWorld) {
        if ((gameOver || won) && score > cabWorld.score) cabWorld = { score: score, name: cabSelfName() };
        best = cabWorld.score;
        bestName = cabWorld.name;
    }
    cabSessionLoad();
    if (score > cabSessScore) {
        cabSessScore = score;
        cabSessName = cabSelfName();
        try {
            sessionStorage.setItem(CAB_SESSION_KEY, String(cabSessScore));
            sessionStorage.setItem(CAB_SESSION_NAME_KEY, cabSessName);
        } catch (e) { /* ignore */ }
    }
    const cond = gameStarted ? cabCondition() : "GREEN";
    let lives = 0;
    const all = allTargets();
    for (let i = 0; i < all.length; i++) if (!all[i].downed) lives++;
    const stored = !!(me && me.rallyStored);
    const sig = best + "|" + bestName + "|" + cabSessScore + "|" + cabSessName + "|" + score + "|" + cond + "|" + lives + "|" + all.length + "|" + stored;
    if (sig === cabSig) return;
    cabSig = sig;
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
    const rt = document.getElementById("rallyTag");
    if (rt) rt.style.display = stored ? "block" : "none";
    set("cabHi", String(best));
    set("cabHiName", bestName);
    set("cabSess", String(cabSessScore));
    set("cabSessName", cabSessName);
    set("cabScore", String(score));
    const c = document.getElementById("cabCond");
    if (c) { c.textContent = cond; c.className = "cab-cond " + cond.toLowerCase(); }
    const l = document.getElementById("cabLives");
    if (l) {
        let html = "";
        for (let i = 0; i < all.length; i++) html += "<span class='life" + (all[i].downed ? " down" : "") + "'></span>";
        l.innerHTML = html;
    }
}

// ---------------------------------------------------
//   THE HIT BUFFER (2026-10-07, revised the same day)
// ---------------------------------------------------
// First version: one absorbed hit, 0.5s untouchable, then 5s "wounded" with a
// caption. Revised on request: "1 bump to slight red, 2 bumps to 'red' in
// previous sense. Longer invulnerability after hit", and "remove 'wounded
// next hit downs you' -- generally I'd favor more of a learn-through-
// experience type model rather than explaining." So:
//
//   hit 1   bumped back, untouchable 1.2s, the screen's edge goes SLIGHTLY red
//   hit 2   bumped back, untouchable 1.2s, the edge goes RED and pulses
//   hit 3   down
//   every 6s without a hit heals one step (red -> slight red -> clear)
//
// No words. The red is the whole explanation.
//
// THE SWITCH IS ARC_HIT_BUFFER. false puts the old one-touch down back,
// exactly: arcadeAbsorbHit() is the only thing it gates.
//
// HOST-DECIDED, like every down: contact is resolved where the zombies are
// simulated. The host keeps one record per player (arcHitState) and tells a
// guest it was hit (`hit` over relay, with the new level); the BUMP and the
// red are applied by the hit player's own client, because only that client
// moves its player.
const ARC_HIT_BUFFER = true;
const ARC_HIT_STEPS = 2;          // hits absorbed before the next one downs you
const ARC_HIT_INVULN_MS = 1200;
const ARC_HIT_HEAL_MS = 6000;     // per step
const ARC_KNOCK_MS = 160;
const ARC_KNOCK_SPEED = 7;        // px per step while the bump lasts (~110px)
let arcHitState = {};             // HOST: netId -> {lvl, at}

function woundLevel(lvl, at, now) {
    if (!lvl || !at) return 0;
    return Math.max(0, lvl - Math.floor((now - at) / ARC_HIT_HEAL_MS));
}

// HOST, from the contact test in updateZombies. True = absorbed, so do not
// down the player. False = down them as before.
function arcadeAbsorbHit(target, z, now) {
    if (!ARC_HIT_BUFFER) return false;
    const st = arcHitState[target.id];
    if (st && now - st.at < ARC_HIT_INVULN_MS) return true;           // untouchable
    const lvl = st ? woundLevel(st.lvl, st.at, now) : 0;
    if (lvl >= ARC_HIT_STEPS) {                                        // this one counts
        delete arcHitState[target.id];                                 // a fresh buffer next life
        return false;
    }
    arcHitState[target.id] = { lvl: lvl + 1, at: now };
    const dx = (target.x + (target.size || 16) / 2) - (z.x + z.size / 2);
    const dy = (target.y + (target.size || 16) / 2) - (z.y + z.size / 2);
    const d = Math.hypot(dx, dy) || 1;
    if (target.local) arcadeApplyHit(target.ref, dx / d, dy / d, now, lvl + 1);
    else if (netOnline) MP.send({ k: "hit", id: target.id, dx: +(dx / d).toFixed(3), dy: +(dy / d).toFixed(3), l: lvl + 1 });
    shakeNear(target.x, target.y, 6);
    return true;
}

// The hit player's own client: the bump, the red, the untouchable window.
function arcadeApplyHit(p, ux, uy, now, lvl) {
    p.invulnUntil = Math.max(p.invulnUntil || 0, now + ARC_HIT_INVULN_MS);
    p.hurtAt = now;
    p.hurtLvl = lvl || 1;
    p.knockUntil = now + ARC_KNOCK_MS;
    p.kvx = ux * ARC_KNOCK_SPEED;
    p.kvy = uy * ARC_KNOCK_SPEED;
    addShake(lvl >= 2 ? 11 : 7);
    localEvent(SND_DOWN, p.x, p.y);
}

// From updatePlayers, before the player's own movement.
function arcadeKnock(p, now) {
    if (!p.knockUntil || now >= p.knockUntil) return;
    moveWithCollisions(p, p.kvx, p.kvy, true, false);
}

function arcadeWounded(p, now) {
    return !!p && woundLevel(p.hurtLvl, p.hurtAt, now) >= ARC_HIT_STEPS;
}

// Screen space, after the lighting: a short flash on the hit, then a red
// edge -- faint at one step, strong and pulsing at two.
function arcadeDrawHurt(now) {
    const p = players[0];
    if (!p || !p.hurtAt || p.downed) return;
    const lvl = woundLevel(p.hurtLvl, p.hurtAt, now);
    const t = now - p.hurtAt;
    if (!lvl && t > 400) return;
    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (t < 400) {
        ctx.fillStyle = "rgba(255,0,20," + (0.32 * (1 - t / 400)).toFixed(3) + ")";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    if (lvl) {
        const pulse = lvl >= 2 ? 0.5 + 0.5 * Math.sin(now / 160) : 0;
        const a = lvl >= 2 ? 0.26 + 0.18 * pulse : 0.12;
        const b = Math.round(Math.min(canvas.width, canvas.height) * (lvl >= 2 ? 0.08 : 0.05));
        ctx.fillStyle = "rgba(255,0,20," + a.toFixed(3) + ")";
        ctx.fillRect(0, 0, canvas.width, b);
        ctx.fillRect(0, canvas.height - b, canvas.width, b);
        ctx.fillRect(0, b, b, canvas.height - b * 2);
        ctx.fillRect(canvas.width - b, b, b, canvas.height - b * 2);
    }
    ctx.restore();
}

// ---------------------------------------------------
//   LIGHT (2026-10-07, reworked 2026-10-08)
// ---------------------------------------------------
// 2026-10-07: "lighter outside, window openings let in light is actually
// real, and warehouse is actually darker." 2026-10-08: "darken whole map (no
// greytone), and change 'light' around player to be a flashlight in the
// direction of the pointer", and "add orangey light sources to the outside of
// the warehouse between windows as well as at the silos."
//
// The arcade replaces drawLighting() with this: a DARKNESS LAYER on its own
// offscreen canvas -- night outdoors, near-black in the warehouse, tinted a
// deep blue-black rather than grey so the colours under it stay colours --
// with every light source cut OUT of it, then laid over the frame once:
//
//   your flashlight     a cone toward the pointer, in three flat bands
//   a small glow        round you, so you can always see your own feet
//   teammates           the same, along THEIR aim (`facingX/Y` rides `players`)
//   windows, doors      daylight shafts into the warehouse
//   lamps               orange pools at the warehouse and at each tank
//   drops               a faint glow, so a callout has something to point at
//
// destination-out is safe HERE, on the private layer, and only here: the
// note in drawLighting() is about running it on the main canvas, where it
// erases the world itself. On a layer that holds nothing but darkness,
// removing alpha is exactly "letting light in".
// 2026-10-11 (option A): deep blue, not near-black, so what is left in the
// dark is a colour. Was "4,7,20".
const LIGHT_TINT = "6,16,28";
const LIGHT_OUTSIDE = 0.62;      // dusk (was 0.74 until 2026-10-11: "slightly too low")
const LIGHT_INSIDE = 0.80;        // the warehouse, away from the windows (was 0.95: a void, racks vanished)
const TORCH_RANGE = 640;          // flashlight reach
const TORCH_HALF = 0.42;          // half the cone's angle, radians (~48 degrees across)
const SELF_GLOW = 82;
const LAMP_RADIUS = 130;
const SUN_R = 430;                // the dusk sun's reach through a window or door
let sunLights = [];               // rebuilt each frame: {x, y, k, poly}
let lightLayer = null;

// Visibility polygon (2026-10-08: "raycast light across collide-able objects
// so light doesn't pass through them"). Rays go to every corner of every
// solid rect in reach (and a hair either side, so the light slips round a
// corner) plus a ring of fillers so the open edge stays round. Glass lets
// light through; everything else solid stops it.
const VIS_PENETRATION = 24;

function visPoly(x, y, R) {
    const rs = [];
    for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (w.window) continue;
        if (w.x > x + R || w.x + w.w < x - R || w.y > y + R || w.y + w.h < y - R) continue;
        if (x > w.x && x < w.x + w.w && y > w.y && y < w.y + w.h) continue;   // standing inside it: ignore
        rs.push(w);
    }
    const angs = [];
    for (let k = 0; k < 48; k++) angs.push(k / 48 * Math.PI * 2 - Math.PI);
    for (let i = 0; i < rs.length; i++) {
        const w = rs[i];
        const cs = [[w.x, w.y], [w.x + w.w, w.y], [w.x, w.y + w.h], [w.x + w.w, w.y + w.h]];
        for (let c = 0; c < 4; c++) {
            const a = Math.atan2(cs[c][1] - y, cs[c][0] - x);
            angs.push(a - 0.0004, a, a + 0.0004);
        }
    }
    angs.sort(function (p, q) { return p - q; });
    const pts = new Array(angs.length * 2);
    for (let n = 0; n < angs.length; n++) {
        const dx = Math.cos(angs[n]), dy = Math.sin(angs[n]);
        let best = R, exitT = R, hit = false;
        for (let i = 0; i < rs.length; i++) {
            const w = rs[i];
            let t0 = 0, t1 = Infinity;
            if (dx !== 0) {
                let a = (w.x - x) / dx, b = (w.x + w.w - x) / dx;
                if (a > b) { const q = a; a = b; b = q; }
                if (a > t0) t0 = a;
                if (b < t1) t1 = b;
            } else if (x < w.x || x > w.x + w.w) continue;
            if (t0 > t1) continue;
            if (dy !== 0) {
                let a = (w.y - y) / dy, b = (w.y + w.h - y) / dy;
                if (a > b) { const q = a; a = b; b = q; }
                if (a > t0) t0 = a;
                if (b < t1) t1 = b;
            } else if (y < w.y || y > w.y + w.h) continue;
            if (t0 > t1 || t0 < 0) continue;
            if (t0 < best) { best = t0; exitT = t1; hit = true; }
        }
        // LIT FACES (2026-10-11, LIGHTING_PROPOSAL option A): the ray goes on
        // into the blocker by up to VIS_PENETRATION px, so the face of a hedge,
        // rack, tank or tree that FACES the light is inside the lit polygon.
        // Before, the polygon stopped at the near edge and the prop's own
        // body was painted black: "can't see objects that block light".
        const reach = hit ? Math.min(R, best + Math.min(VIS_PENETRATION, exitT - best)) : best;
        pts[n * 2] = x + dx * reach;
        pts[n * 2 + 1] = y + dy * reach;
    }
    return pts;
}

function clipToPoly(g, pts) {
    g.beginPath();
    g.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) g.lineTo(pts[i], pts[i + 1]);
    g.closePath();
    g.clip();
}

// QUANTIZED LIGHT (2026-10-09: "step into bands"; AESTHETIC_GUIDE.md §4.9 --
// the era had no smooth gradients). Every light is still raycast and still
// falls off, but in four flat steps: [outer edge as a fraction of the
// radius, light]. Hard steps are colour stops placed a hair apart. Shared by
// every cut and every additive pool, so all the light in the game steps
// alike.
// 4 -> 7 steps on 2026-10-11 (LIGHTING_PROPOSAL option A): still flat bands, so
// the quantized-light pillar holds, but each step is a third the size.
const ARC_LIGHT_BANDS = [[0.15, 1], [0.3, 0.86], [0.45, 0.7], [0.6, 0.52], [0.75, 0.36], [0.9, 0.2], [1, 0.1]];
function bandGradient(g, x, y, r, rgb, a) {
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    let from = 0;
    for (let i = 0; i < ARC_LIGHT_BANDS.length; i++) {
        const c = "rgba(" + rgb + "," + (ARC_LIGHT_BANDS[i][1] * a).toFixed(3) + ")";
        gr.addColorStop(from, c);
        gr.addColorStop(ARC_LIGHT_BANDS[i][0] - 0.001, c);
        from = ARC_LIGHT_BANDS[i][0];
    }
    gr.addColorStop(1, "rgba(" + rgb + ",0)");
    return gr;
}
function falloffGradient(g, x, y, r, a) { return bandGradient(g, x, y, r, "0,0,0", a); }

// A flashlight: three sectors, each wider than the last, each carrying the
// banded falloff. Their alphas compound under destination-out, so the beam
// steps down sideways as well as along its length: 3 layers in the core,
// 2 at the shoulder, 1 at the rim.
const TORCH_LAYERS = [0.4, 0.7, 1.0, 1.3];   // half-angle, as a multiple of TORCH_HALF (4 from 3, 2026-10-11)
const TORCH_LAYER_A = 0.53;                  // 1 - (1 - 0.53)^4 = 0.95 in the core
function cutTorch(g, cx, cy, fx, fy, range) {
    const a = Math.atan2(fy, fx);
    for (let i = 0; i < TORCH_LAYERS.length; i++) {
        const half = TORCH_HALF * TORCH_LAYERS[i];
        g.fillStyle = falloffGradient(g, cx, cy, range, TORCH_LAYER_A);
        g.beginPath();
        g.moveTo(cx, cy);
        g.arc(cx, cy, range, a - half, a + half);
        g.closePath();
        g.fill();
    }
}

function cutGlow(g, x, y, r, inner) {
    g.fillStyle = falloffGradient(g, x, y, r, inner);
    g.beginPath();
    g.arc(x, y, r, 0, Math.PI * 2);
    g.fill();
}

function arcadeDrawLighting() {
    if (!canvas.width || !canvas.height) return;   // before the first resize
    if (!lightLayer) lightLayer = document.createElement("canvas");
    if (lightLayer.width !== canvas.width || lightLayer.height !== canvas.height) {
        lightLayer.width = canvas.width;
        lightLayer.height = canvas.height;
    }
    const g = lightLayer.getContext("2d");
    const s = camera.scale;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.globalCompositeOperation = "source-over";
    g.clearRect(0, 0, lightLayer.width, lightLayer.height);
    g.setTransform(s, 0, 0, s, canvas.width / 2 - camera.x * s, canvas.height / 2 - camera.y * s);
    const vr = viewRect();

    // BLACKOUT: the ambient and which lights are alive come from the phase.
    const boNow = Date.now();
    arcadeBlackoutSounds(boNow);
    const boPhase = arcadeBlackoutPhase(boNow);
    let dOut = LIGHT_OUTSIDE, dIn = 1 - LIGHT_INSIDE, lightsDead = false;
    if (boPhase === 1) {                      // the surge: brighter and stuttering
        const k = 1 - (boOutAt - boNow) / BO_SURGE_MS;
        const flick = (k > 0.45 && Math.floor(boNow / 55) % 2) ? 0 : 1;
        const m = 1 - 0.55 * k * flick;
        dOut *= m; dIn *= m;
    } else if (boPhase === 2 || boPhase === 3) {
        const t = boPhase === 3 ? (boNow - (boEndAt - BO_RESTORE_MS)) / BO_RESTORE_MS : 0;
        const lit = boPhase === 3 && Math.floor(t * 6) % 2 === 1;
        if (!lit) { dOut = 1 - BO_AMBIENT; dIn = BO_AMBIENT; lightsDead = true; }
    }
    g.fillStyle = "rgba(" + LIGHT_TINT + "," + dOut.toFixed(3) + ")";
    g.fillRect(vr.x, vr.y, vr.w, vr.h);
    const W = arenaWarehouse;
    if (W && !lightsDead) {
        // Topped up to inside: 1 - (1 - out)(1 - extra) = inside light.
        const extra = Math.max(0, 1 - dIn / (1 - dOut));
        g.fillStyle = "rgba(" + LIGHT_TINT + "," + extra.toFixed(3) + ")";
        g.fillRect(W.x, W.y, W.w, W.h);
    }

    g.globalCompositeOperation = "destination-out";
    if (lightsDead) {
        // Everything but flashlights is dead: no sun shafts, lamps, drop glow
        // or exit flood. (Their polys go too, so the additive pass skips them.)
        sunLights = [];
        for (let i = 0; i < arenaLamps.length; i++) arenaLamps[i].poly = null;
    } else if (W) {
        // The dusk sun is a real light, just outside each window and door
        // and low to the west. Raycast, so it only comes in through the
        // openings and falls across the floor as a shaft where the walls and
        // racking let it.
        sunLights = [];
        for (let i = 0; i < W.windows.length; i++) {
            const w = W.windows[i];
            sunLights.push({ x: w.x + w.w / 2 - 150, y: w.dir > 0 ? w.y - 110 : w.y + w.h + 110, k: 0.9 });
        }
        for (let i = 0; i < W.doors.length; i++) {
            const d = W.doors[i];
            sunLights.push({ x: d.dir > 0 ? d.x - 110 : d.x + T_PAD + 110, y: d.y + d.h / 2 - 100, k: 0.8 });
        }
        for (let i = 0; i < sunLights.length; i++) {
            const u = sunLights[i];
            if (u.x < vr.x - SUN_R || u.x > vr.x + vr.w + SUN_R || u.y < vr.y - SUN_R || u.y > vr.y + vr.h + SUN_R) { u.poly = null; continue; }
            g.save();
            g.beginPath();
            g.rect(W.x, W.y, W.w, W.h);
            g.clip();
            u.poly = visPoly(u.x, u.y, SUN_R);
            clipToPoly(g, u.poly);
            cutGlow(g, u.x, u.y, SUN_R, u.k);
            g.restore();
        }
    } else sunLights = [];
    for (let i = 0; i < arenaLamps.length && !lightsDead; i++) {
        const l = arenaLamps[i];
        const LR = l.r || LAMP_RADIUS;
        if (l.x < vr.x - LR || l.x > vr.x + vr.w + LR ||
            l.y < vr.y - LR || l.y > vr.y + vr.h + LR) { l.poly = null; continue; }
        g.save();
        clipToLampSide(g, l, vr);
        l.poly = visPoly(l.x, l.y, LR);
        clipToPoly(g, l.poly);
        cutGlow(g, l.x, l.y, LR, l.cool ? 0.95 : 0.85);
        g.restore();
    }
    for (let i = 0; i < pickups.length && !lightsDead; i++) {
        const d = pickups[i];
        cutGlow(g, d.x + d.size / 2, d.y + d.size / 2, 42, 0.6);
    }
    if (escapeAt && !lightsDead) {
        cutGlow(g, escapeRect.x + escapeRect.w / 2, escapeRect.y + 20, 200, escapeOpen() ? 0.85 : 0.5);
    }
    // Teammates: a glow, and their flashlight along their own aim.
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        if (r.away) continue;
        const rx = r.x + (r.size || 16) / 2, ry = r.y + (r.size || 16) / 2;
        g.save();
        clipToPoly(g, visPoly(rx, ry, TORCH_RANGE * 0.85));
        cutGlow(g, rx, ry, SELF_GLOW * 0.8, 0.7);
        if (!r.downed && (r.facingX || r.facingY)) cutTorch(g, rx, ry, r.facingX || 0, r.facingY || 0, TORCH_RANGE * 0.85);
        g.restore();
    }
    // You: the flashlight toward the pointer, and the glow round your feet.
    const me = players[0];
    const cx = me ? me.x + me.size / 2 : camera.x, cy = me ? me.y + me.size / 2 : camera.y;
    const myRange = TORCH_RANGE * ((me && me.downed) ? 0.45 : 1);
    g.save();
    clipToPoly(g, visPoly(cx, cy, myRange));
    cutGlow(g, cx, cy, SELF_GLOW * ((me && me.downed) ? 0.7 : 1), 0.9);
    if (me) cutTorch(g, cx, cy, me.facingX || 1, me.facingY || 0, myRange);
    g.restore();
    g.globalCompositeOperation = "source-over";

    ctx.save();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.drawImage(lightLayer, 0, 0);
    ctx.restore();
}
const T_PAD = 20;

// A lamp lights only its own side of the warehouse wall: an outside lamp is
// clipped to everything BUT the warehouse, the lamp at tank 2 to the inside.
// (Unclipped, the wall lamps lit the warehouse through its own wall.)
function clipToLampSide(c, l, vr) {
    const W = arenaWarehouse;
    if (!W) return;
    // Outside lamps are not clipped any more: the raycast stops them at the
    // wall and lets them in through the windows (2026-10-08).
    if (!l.inside) return;
    c.beginPath();
    c.rect(W.x, W.y, W.w, W.h);
    c.clip();
}

// The lamps themselves, over the darkness: an orange pool (additive, flat
// rings -- no gradients) and the bulb, which is never in the dark.
function arcadeDrawLamps() {
    if (!arenaLamps.length) return;
    ctx.save();
    applyCameraTransform();
    ctx.globalCompositeOperation = "lighter";
    const vr = viewRect();
    for (let i = 0; i < arenaLamps.length; i++) {
        const l = arenaLamps[i];
        if (!l.poly) continue;
        ctx.save();
        clipToLampSide(ctx, l, vr);
        clipToPoly(ctx, l.poly);
        const LR = l.r || LAMP_RADIUS, rgb = l.cool ? "140,195,255" : "255,145,55", m = l.cool ? 0.75 : 1;
        ctx.fillStyle = bandGradient(ctx, l.x, l.y, LR, rgb, 0.17 * m);
        ctx.beginPath();
        ctx.arc(l.x, l.y, LR, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.globalCompositeOperation = "source-over";
    for (let i = 0; i < arenaLamps.length; i++) {
        const l = arenaLamps[i];
        ctx.fillStyle = "#2A2A2A";
        ctx.fillRect(l.x - 5, l.y - 4, 10, 8);
        ctx.fillStyle = l.cool ? "#9CCBFF" : "#FFB050";
        ctx.fillRect(l.x - 3, l.y - 2, 6, 4);
        ctx.fillStyle = l.cool ? "#F0F8FF" : "#FFF2C0";
        ctx.fillRect(l.x - 1, l.y - 1, 2, 2);
    }
    ctx.restore();
}

// ---------------------------------------------------
//   THE SILO SETS (2026-10-07)
// ---------------------------------------------------
// "Introduce some map details at each silo for more variation":
//   1  "tree hedge paths surrounding in layers create bottlenecks for getting
//      in / out on all sides. shipping containers placed around some in stacks"
//   2  "inside of a large warehouse building with pallets stacked around,
//      windows at top and bottom should show light pouring in with large door
//      openings on the left and right"
//   3  "a denser forested area with less organization, we should have to walk
//      through a bit of forest to get to this last corner of the map"
//
// Every gap a body has to use is at least SET_GAP, over the 78px a brute
// needs, and every solid here is SOLID OVER ITS WHOLE DRAWN SHAPE (the 1D-iso
// rule the tanks and trees follow), so nothing hides behind a hedge or a
// container. All of it is MP.random(): every client builds the same sets.
const SET_GAP = 130;              // a gap a body has to walk through
const SET_CLEAR = 90;             // a freestanding prop's clearance to anything solid
// The warehouse (silo 2): margins round the chain, and the racking.
const WH_SIDE = 420;              // wall to the chain, each side: the racking bays
const WH_TOP = 160;
const WH_BOTTOM = 300;            // room for a row of racks and an aisle below the chain
const RACK_D = 40;                // rack footprint depth
const RACK_LIFT = 60;             // tall steel shelving
const RACK_LEN = 160;             // a horizontal rack's length
const RACK_PITCH = 150;           // column to column: 40 of rack, 110 of aisle
const RACK_COLS = 2;
const HEDGE_T = 24;               // hedge footprint thickness
const HEDGE_LIFT = 18;
const SET_CONTAINER_LIFT = 34;        // per box in a stack
const PALLET = 40;
const PALLET_LIFT = 15;           // per layer
const SET_CONTAINER_HUES = [["#8A3A28", "#5A2418"], ["#2E5E80", "#1C3C54"], ["#6E6E30", "#46461E"], ["#9A7030", "#644818"]];

let arenaProps = [];              // {kind, x, y, w, h (the whole solid), fh, lift, ...} -- drawn tall
let arenaWarehouse = null;        // {x, y, w, h, windows: [{x, y, w, h, dir}]}
let arenaLamps = [];              // {x, y}: orange light sources (arcadeDrawLighting)

function siloCluster(k) {
    const f = funnels[k], s = silos[k];
    const x0 = f.x - f.r, x1 = s.x + s.w;
    const y0 = Math.min(f.y - f.r, s.y - SILO_LIFT), y1 = Math.max(f.y + f.r, s.y + s.h + 40);
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

function grow(r, m) {
    return { x: r.x - m, y: r.y - m, w: r.w + m * 2, h: r.h + m * 2 };
}

// A solid with a footprint `fh` deep at the bottom of rect r and `lift` of
// height drawn above it. `r` is the WHOLE solid, so it goes straight into
// walls[] as the collision box. `footY` is the footprint's BOTTOM edge -- the
// ground line. (It was treated as the footprint's top until 2026-10-07, which
// put every hedge, container, rack and pallet one footprint too low: racks
// stood through the warehouse's south wall.)
function pushProp(kind, x, footY, w, fh, lift, extra) {
    const r = { x: Math.round(x), y: Math.round(footY - fh - lift), w: Math.round(w), h: Math.round(fh + lift),
                setProp: true, fh: fh, lift: lift, kind: kind };
    if (extra) for (const k in extra) r[k] = extra[k];
    walls.push(r);
    arenaProps.push(r);
    return r;
}

// A rectangular hedge ring, with one gap on each side listed in `gaps`
// ({ n, s, e, w }: 0..1 along that side).
function hedgeRing(R, gaps, gapW) {
    const T = HEDGE_T;
    const GW = gapW || SET_GAP;
    const run = function (vertical, fixed, a0, a1, gapAt) {
        const parts = [];
        if (gapAt == null) parts.push([a0, a1]);
        else {
            const g0 = a0 + (a1 - a0) * gapAt - GW / 2, g1 = g0 + GW;
            if (g0 - a0 > 20) parts.push([a0, g0]);
            if (a1 - g1 > 20) parts.push([g1, a1]);
        }
        for (let i = 0; i < parts.length; i++) {
            const p = parts[i];
            // A vertical hedge's lift is drawn above its top end, so the
            // footprint starts that much lower: the gap stays SET_GAP clear.
            if (vertical) pushProp("hedge", fixed, p[1], T, p[1] - p[0] - HEDGE_LIFT, HEDGE_LIFT, { vertical: true });
            else pushProp("hedge", p[0], fixed + T, p[1] - p[0], T, HEDGE_LIFT);
        }
    };
    run(false, R.y, R.x, R.x + R.w, gaps.n);
    run(false, R.y + R.h - T, R.x, R.x + R.w, gaps.s);
    run(true, R.x, R.y + T, R.y + R.h - T, gaps.w);
    run(true, R.x + R.w - T, R.y + T, R.y + R.h - T, gaps.e);
}

function buildSiloSets(clear) {
    arenaProps = [];
    arenaWarehouse = null;
    arenaLongHouse = null;
    arenaConcreteRects = [];
    ggBits = null;
    arenaLamps = [];
    if (funnels.length < 1) return;
    const kindsL = (ARENA_LAYOUTS[arcLevelNo] || ARENA_LAYOUTS[1]).sets;
    // A lamp at every tank, beside its base (2026-10-08: "orangey light
    // sources ... at the silos").
    for (let k = 0; k < funnels.length; k++) {
        const s = silos[k];
        if (s && !giantSilo) arenaLamps.push({ x: s.x + s.w + 30, y: s.y + s.h - 6, inside: kindsL[k] === "warehouse" });
    }
    if (giantSilo) {
        // One tank, so one set of lamps: the ends and the middle of its base,
        // and the corners of its lid.
        // 2026-10-16: "make lighting at end map around blood reservoir all
        // 'cool' colored lighting" -- these, and every funnel lamp on this
        // map (the funnels all feed the reservoir), are cool.
        const g = giantSilo, by = g.y + g.h - 6;
        [g.x - 40, g.x + g.w / 2, g.x + g.w + 40].forEach(function (x) { arenaLamps.push({ x: x, y: by, inside: false, cool: true }); });
        arenaLamps.push({ x: g.x + 40, y: g.y - g.lift - 14, inside: false, cool: true }, { x: g.x + g.w - 40, y: g.y - g.lift - 14, inside: false, cool: true });
    }
    // 2026-10-08: "slightly more light sources around silos 1 and 3, but also
    // at the start point". Lamps are light only: nothing solid is added.
    // (2026-10-08 later: silo 2 too -- inside the warehouse.)
    for (let k = 0; k < funnels.length; k++) {
        const f = funnels[k], s = silos[k], ins = kindsL[k] === "warehouse";
        if (!giantSilo) {
            arenaLamps.push({ x: s.x - 28, y: s.y + s.h - 6, inside: ins });                 // tank, west foot
            arenaLamps.push({ x: s.x + s.w / 2, y: s.y - SILO_LIFT - 14, inside: ins });     // tank, top
        }
        const cool = !!giantSilo;
        arenaLamps.push({ x: f.x, y: f.y - f.r - 34, inside: ins, cool: cool });         // funnel, north
        arenaLamps.push({ x: f.x, y: f.y + f.r + 34, inside: ins, cool: cool });         // funnel, south
        arenaLamps.push({ x: f.x - f.r - 34, y: f.y, inside: ins, cool: cool });         // funnel, west
    }
    // The exit: cool flood lights either side of the gate and one out front.
    if (escapeRect) {
        const gx = escapeRect.x + escapeRect.w / 2, gy = escapeRect.y;
        const fl = function (x, y) { arenaLamps.push({ x: x, y: y, inside: false, cool: true, r: 330 }); };
        fl(gx - escapeRect.w / 2 - 90, gy - 40); fl(gx + escapeRect.w / 2 + 90, gy - 40);
        fl(gx - escapeRect.w / 2 - 90, gy - 190); fl(gx + escapeRect.w / 2 + 90, gy - 190);
        fl(gx, gy - 270);
    }
    // The way in (maps after the first): flood lights either side of the gate
    // inside the fence, and one in the tunnel so it reads.
    if (entryRect) {
        const gx = entryRect.x + entryRect.w / 2, gy = entryRect.y + entryRect.h;
        const fl = function (x, y, r) { arenaLamps.push({ x: x, y: y, inside: false, cool: true, r: r || 330 }); };
        fl(gx - entryRect.w / 2 - 90, gy + 50); fl(gx + entryRect.w / 2 + 90, gy + 50);
        fl(gx, ARENA.y - 70, 260);
    }
    // Where you start: the middle of the map, or (map 2) the north fence.
    const sx = WORLD_W / 2, sy = arcLevelNo >= 2 ? ARENA.y + 220 : WORLD_H / 2;
    if (arcLevelNo <= 1) {
        // Round the fountain, clear of the road ring.
        const fy = WORLD_H / 2 + FOUNTAIN_DY;
        arenaLamps.push({ x: sx - 215, y: fy - 70, inside: false }, { x: sx + 215, y: fy - 70, inside: false },
                        { x: sx - 215, y: fy + 70, inside: false }, { x: sx + 215, y: fy + 70, inside: false });
    } else {
        arenaLamps.push({ x: sx - 130, y: sy - 90, inside: false }, { x: sx + 130, y: sy - 90, inside: false },
                        { x: sx - 130, y: sy + 90, inside: false }, { x: sx + 130, y: sy + 90, inside: false });
    }

    // One builder per set kind, in tank order, so each claims its ground
    // (`clear`) before the next looks for room.
    // The DIVIDER first, so every set routes round it.
    const LAYS = ARENA_LAYOUTS[arcLevelNo] || ARENA_LAYOUTS[1];
    if (LAYS.divider) {
        const D = arenaDividerOff || LAYS.divider;
        const dx0 = WORLD_W / 2 + D.x, dy0 = WORLD_H / 2 + D.y;
        buildLongHouse(dx0, dy0, D.w, D.h);
        clear.push(grow({ x: dx0, y: dy0, w: D.w, h: D.h }, 110));
    }
    // Hedges, then the warehouse, then forests, whatever the tank order: the
    // forests fill whatever ground is left, and a hedge ring planted after a
    // forest would stand in its trees.
    const kinds = LAYS.sets;
    const builders = { hedge: buildHedgeSet, warehouse: buildWarehouseSet, forest: buildForestSet };
    ["hedge", "warehouse", "forest"].forEach(function (kind) {
        for (let k = 0; k < kinds.length; k++) if (kinds[k] === kind) builders[kind](k, clear);
    });
    if (LAYS.boss) arcadeBuildBossCover(clear);
}

// MAP 3's DIVIDER IS AN ULTRA-LONG WAREHOUSE (2026-10-16; it was one solid
// road-like slab). Walls round it, door openings in BOTH long sides at regular
// intervals, and inside, on a grid: columns between the doors and a rack across
// each door row. Every gap inside is >= 80px (the 78px nav guarantee), so a
// brute can cross it. Concrete aprons run down both outside faces.
const LONG_DOOR = 130;            // door opening
const LONG_PITCH = 220;           // about one door every this far
function buildLongHouse(x0, y0, W, H) {
    const T = WALL_T;
    const n = Math.max(2, Math.floor(H / LONG_PITCH));
    const pitch = H / n;
    const wall = function (x, y, w, h) { if (w > 2 && h > 2) walls.push({ x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h), building: true }); };
    wall(x0, y0, W, T);                       // the two ends: closed
    wall(x0, y0 + H - T, W, T);
    const door = [];
    for (let i = 0; i < n; i++) door.push(y0 + pitch * (i + 0.5));
    [x0, x0 + W - T].forEach(function (x) {
        let cur = y0 + T;
        for (let i = 0; i < n; i++) {
            wall(x, cur, T, door[i] - LONG_DOOR / 2 - cur);
            cur = door[i] + LONG_DOOR / 2;
        }
        wall(x, cur, T, y0 + H - T - cur);
    });
    // Columns between the door rows, two to a row, and a rack on each door row.
    const ix = x0 + T;
    for (let i = 1; i < n; i++) {
        const y = y0 + pitch * i;
        pushProp("column", ix + 90, y + 15, 30, 30, 40);
        pushProp("column", ix + 320, y + 15, 30, 30, 40);
    }
    for (let i = 0; i < n; i++) {
        pushProp("rack", ix + 200, door[i] + 80, RACK_D, 100, RACK_LIFT, { vertical: true, fill: MP.random() });
    }
    // A lamp outside every door.
    for (let i = 0; i < n; i++) {
        arenaLamps.push({ x: x0 - 14, y: Math.round(door[i]), inside: false }, { x: x0 + W + 14, y: Math.round(door[i]), inside: false });
    }
    arenaLongHouse = { x: x0, y: y0, w: W, h: H };
    arenaConcreteRects.push({ x: x0 - 90, y: y0 - 20, w: 90, h: H + 40 }, { x: x0 + W, y: y0 - 20, w: 90, h: H + 40 });
}

// A HEDGE set: two rings and container stacks round tank k.
function buildHedgeSet(k, clear) {
    // ---- SILO 1: two TIGHT hedge rings round the tank -- "localize hedges to
    // just immediate vicinity around silo 1 with less sprawl" -- gaps
    // staggered so you zig-zag in, and container stacks just outside.
    const c1 = siloCluster(k);
    // OPENED UP 2026-10-11 ("remove tightness of hedges around the first silo
    // and open up a little bit more"): the inner ring stands 100px off the
    // cluster (was 36), the lanes between rings and every gap are 200 wide
    // (was 130), and the inner ring now has a gap on all four sides.
    const S1_GAP = 200;
    const inner = grow(c1, 100);
    const outer = grow(c1, 100 + HEDGE_T + S1_GAP);
    hedgeRing(inner, { n: 0.72, s: 0.28, e: 0.5, w: 0.5 }, S1_GAP);
    hedgeRing(outer, { n: 0.22, s: 0.78, e: 0.82, w: 0.3 }, S1_GAP);
    const outerGaps = [
        { x: outer.x + outer.w * 0.22, y: outer.y }, { x: outer.x + outer.w * 0.78, y: outer.y + outer.h },
        { x: outer.x + outer.w, y: outer.y + outer.h * 0.82 }, { x: outer.x, y: outer.y + outer.h * 0.3 }
    ];
    // Rows above, below and to the west, far enough out to keep SET_CLEAR.
    const spots = [];
    for (let i = 0; i < 10; i++) spots.push({ x: outer.x - 60 + i * (outer.w - 30) / 9, y: outer.y - 190, v: false });
    for (let i = 0; i < 10; i++) spots.push({ x: outer.x - 60 + i * (outer.w - 30) / 9, y: outer.y + outer.h + 160, v: false });
    for (let i = 0; i < 5; i++) spots.push({ x: outer.x - 200, y: outer.y + 20 + i * (outer.h - 120) / 4, v: true });
    let placed = 0;
    for (let i = 0; i < spots.length && placed < 9; i++) {
        if (MP.random() < 0.2) continue;
        const sp = spots[i];
        const w = sp.v ? 56 : 150, fh = sp.v ? 150 : 56;
        const levels = MP.random() < 0.5 ? 2 : 1;
        const lift = SET_CONTAINER_LIFT * levels;
        const box = { x: sp.x, y: sp.y - lift, w: w, h: fh + lift };
        // A GAP IS EITHER CLOSED OR WALKABLE: a container leaves at least
        // SET_CLEAR to the fence and to every other solid. Hard against the
        // west fence, one sealed a 320px strip off from the flow field.
        if (!inArenaRect(grow(box, SET_CLEAR))) continue;
        let near = false;
        for (let g = 0; g < outerGaps.length; g++) {
            if (Math.hypot(box.x + box.w / 2 - outerGaps[g].x, box.y + box.h / 2 - outerGaps[g].y) < 150) near = true;
        }
        if (near || clashesAnySolid(grow(box, SET_CLEAR), clear)) continue;
        const hue = SET_CONTAINER_HUES[Math.floor(MP.random() * SET_CONTAINER_HUES.length)];
        pushProp("container", box.x, sp.y + fh, w, fh, lift, { levels: levels, hue: hue, vertical: sp.v });
        placed++;
    }
    clear.push(grow(outer, 40));
}

// A WAREHOUSE set: the big building with windows, doors and storage racking.
// There is one warehouse at most on a map (arenaWarehouse is a singleton).
function buildWarehouseSet(k, clear) {
    // ---- SILO 2: a BIG warehouse round the funnel and the tank, "more
    // pallets on a grid, think warehouse storage racking". Tall steel racks
    // stand in the two side bays (in columns, each split by the door band) and
    // in a row below the chain, with aisles a body can use between them.
    const c2 = siloCluster(k);
    const W = { x: c2.x - WH_SIDE, y: c2.y - WH_TOP, w: c2.w + WH_SIDE * 2, h: c2.h + WH_TOP + WH_BOTTOM };
    const T = WALL_T;
    const doorY = Math.round(W.y + W.h / 2), door = 190;
    const windows = [], doors = [];
    // Top and bottom: wall, window, wall ... (windows are glass: solid, but
    // they let the light in -- arcadeDrawLighting).
    const strip = function (y, dir) {
        const pane = 90, pitch = 190;
        let x = W.x;
        for (let px = W.x + 90; px + pane < W.x + W.w - 70; px += pitch) {
            walls.push({ x: x, y: y, w: px - x, h: T, building: true });
            // A lamp on the OUTSIDE face of the wall between two windows
            // ("orangey light sources to the outside of the warehouse").
            if (x > W.x) arenaLamps.push({ x: Math.round(x + (px - x) / 2), y: dir > 0 ? y - 10 : y + T + 10, inside: false });
            walls.push({ x: px, y: y, w: pane, h: T, window: true, building: true });
            windows.push({ x: px, y: y, w: pane, h: T, dir: dir });
            x = px + pane;
        }
        walls.push({ x: x, y: y, w: W.x + W.w - x, h: T, building: true });
    };
    strip(W.y, 1);
    strip(W.y + W.h - T, -1);
    // AN INTENTIONAL OPENING in the south wall, straight above the start
    // (map 1): the walls and any window across it are cut away, and a lamp
    // either side marks it.
    let openX0 = 0, openX1 = 0;
    if (arcLevelNo <= 1) {
        const oy = W.y + W.h - T, ocx = WORLD_W / 2;
        openX0 = ocx - 95; openX1 = ocx + 95;
        for (let i = walls.length - 1; i >= 0; i--) {
            const w = walls[i];
            if (!(w.building && w.y === oy && w.h === T)) continue;
            if (w.x + w.w <= openX0 || w.x >= openX1) continue;
            walls.splice(i, 1);
            if (w.window) {
                for (let q = windows.length - 1; q >= 0; q--) if (windows[q].x === w.x && windows[q].y === w.y) windows.splice(q, 1);
            } else {
                if (w.x < openX0) walls.push({ x: w.x, y: w.y, w: openX0 - w.x, h: T, building: true });
                if (w.x + w.w > openX1) walls.push({ x: openX1, y: w.y, w: w.x + w.w - openX1, h: T, building: true });
            }
        }
        arenaLamps.push({ x: openX0 - 14, y: oy + T + 10, inside: false }, { x: openX1 + 14, y: oy + T + 10, inside: false });
    }
    const side = function (x, dir) {
        walls.push({ x: x, y: W.y + T, w: T, h: doorY - door / 2 - (W.y + T), building: true });
        walls.push({ x: x, y: doorY + door / 2, w: T, h: W.y + W.h - T - (doorY + door / 2), building: true });
        doors.push({ x: x, y: doorY - door / 2, h: door, dir: dir });
    };
    side(W.x, 1);
    side(W.x + W.w - T, -1);
    arenaWarehouse = { x: W.x, y: W.y, w: W.w, h: W.h, windows: windows, doors: doors };

    // Racks in the side bays: vertical, RACK_D deep, columns RACK_PITCH apart,
    // each column split round the door band.
    const bandTop = doorY - door / 2 - 40, bandBot = doorY + door / 2 + 40;
    const bays = [[W.x + T + 60, 1], [W.x + W.w - T - 60 - RACK_D, -1]];
    for (let b = 0; b < bays.length; b++) {
        for (let col = 0; col < RACK_COLS; col++) {
            const x = bays[b][0] + bays[b][1] * col * RACK_PITCH;
            // above the door band
            const top0 = W.y + T + 30, top1 = bandTop;
            if (top1 - top0 > 120) pushProp("rack", x, top1, RACK_D, top1 - top0 - RACK_LIFT, RACK_LIFT, { vertical: true, fill: MP.random() });
            // below it
            const bot0 = bandBot + RACK_LIFT, bot1 = W.y + W.h - T - 30;
            if (bot1 - bot0 > 100) pushProp("rack", x, bot1, RACK_D, bot1 - bot0, RACK_LIFT, { vertical: true, fill: MP.random() });
        }
    }
    // A row of racks below the chain, with gaps to walk through.
    const rowY = c2.y + c2.h + 70 + RACK_LIFT;            // footprint top
    const rowX0 = c2.x - 40, rowX1 = c2.x + c2.w + 40;
    for (let x = rowX0; x + RACK_LEN <= rowX1; x += RACK_LEN + SET_GAP) {
        if (openX1 && x < openX1 + 30 && x + RACK_LEN > openX0 - 30) continue;     // keep the opening's way in clear
        pushProp("rack", x, rowY + RACK_D, RACK_LEN, RACK_D, RACK_LIFT, { vertical: false, fill: MP.random() });
    }
    clear.push(grow(W, 40));
}

// A FOREST set: a dense, untidy forest round tank k.
function buildForestSet(k, clear) {
    // ---- SILO 3: a dense, untidy forest -- "add more, and denser trees" --
    // of small trees, mostly on the side you arrive from, so the last tank is
    // reached THROUGH it. 44px canopies 80px apart: still over the 78px a
    // brute needs.
    const c3 = siloCluster(k);
    const fits = function (r) {
        if (!inArenaRect(r)) return false;
        for (let i = 0; i < clear.length; i++) if (rectsOverlap(r, clear[i])) return false;
        return true;
    };
    const fx0 = c3.x - 700, fx1 = c3.x + c3.w + 300;
    const fy0 = c3.y - 560, fy1 = c3.y + c3.h + 560;
    for (let i = 0; i < 600; i++) {
        const x = fx0 + MP.random() * (fx1 - fx0);
        const y = fy0 + MP.random() * (fy1 - fy0);
        if (rectsOverlap({ x: x - 30, y: y - 30, w: 60, h: 60 }, grow(c3, 50))) continue;
        arenaPlaceTree(x, y, fits, 44, 80);
    }
    for (let i = 0; i < 90; i++) {
        arenaAddBush(fx0 + MP.random() * (fx1 - fx0), fy0 + MP.random() * (fy1 - fy0), 6 + MP.random() * 8, fits);
    }
}

function inArenaRect(r) {
    const A = ARENA, m = WALL_T + 4;
    return r.x >= A.x + m && r.y >= A.y + m && r.x + r.w <= A.x + A.w - m && r.y + r.h <= A.y + A.h - m;
}

function clashesAnySolid(r, clear) {
    for (let i = 0; i < clear.length; i++) if (rectsOverlap(r, clear[i])) return true;
    for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (w.perim || w.column) continue;
        if (rectsOverlap(r, w)) return true;
    }
    return false;
}

// --- drawing the sets -------------------------------------------------------
// A block in the 1D-iso style: footprint at the bottom of r, extruded `lift`
// up the screen -- front face, then a lit top.
function drawBlock(r, top, front, line) {
    const fy = r.y + r.h - r.fh;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.fillRect(r.x + 7, fy + 6, r.w, r.fh);
    ctx.fillStyle = front;
    ctx.fillRect(r.x, fy + r.fh - r.lift, r.w, r.lift);
    ctx.fillStyle = top;
    ctx.fillRect(r.x, fy - r.lift, r.w, r.fh);
    if (line) {
        ctx.strokeStyle = line;
        ctx.lineWidth = 1;
        ctx.strokeRect(r.x + 0.5, fy - r.lift + 0.5, r.w - 1, r.fh + r.lift - 1);
    }
}

// THE FOUNTAIN: a round basin with moving water -- rings spreading from the
// spout and jets arcing out and falling back. Flat squares and strokes only.
function drawFountain(r) {
    const now = Date.now();
    const cx = r.x + r.w / 2, cy = r.y + r.h / 2, R = r.w / 2;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.beginPath(); ctx.arc(cx + 6, cy + 6, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8C8C90";
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#5A5A5E";
    ctx.beginPath(); ctx.arc(cx, cy, R - 6, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#256BAE";
    ctx.beginPath(); ctx.arc(cx, cy, R - 10, 0, Math.PI * 2); ctx.fill();
    // Ripples travelling out from the spout.
    for (let k = 0; k < 3; k++) {
        const t = ((now / 1400) + k / 3) % 1;
        ctx.globalAlpha = (1 - t) * 0.8;
        ctx.strokeStyle = "#8FD3FF";
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(cx, cy, 6 + t * (R - 18), 0, Math.PI * 2); ctx.stroke();
    }
    ctx.globalAlpha = 1;
    // Jets: each droplet climbs and falls on its own arc.
    ctx.fillStyle = "#E8F8FF";
    for (let j = 0; j < 8; j++) {
        const a = j * Math.PI / 4;
        for (let d = 0; d < 3; d++) {
            const t = ((now / 900) + j * 0.11 + d / 3) % 1;
            const out = 6 + t * (R - 16);
            const lift = Math.sin(Math.PI * t) * 20;
            ctx.fillRect(Math.round(cx + Math.cos(a) * out - 1.5), Math.round(cy + Math.sin(a) * out * 0.8 - lift - 1.5), 3, 3);
        }
    }
    // The spout, and its plume going up and breaking.
    ctx.fillStyle = "#B8B8BC";
    ctx.fillRect(cx - 6, cy - 6, 12, 12);
    ctx.fillStyle = "#4C4C50";
    ctx.fillRect(cx - 3, cy - 3, 6, 6);
    for (let d = 0; d < 4; d++) {
        const t = ((now / 600) + d / 4) % 1;
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(Math.round(cx - 2 + Math.sin(d * 2 + now / 300) * 3), Math.round(cy - 6 - t * 26), 3, 4);
    }
}

function drawSetProp(r) {
    const fy = r.y + r.h - r.fh;
    if (r.kind === "fountain") { drawFountain(r); return; }
    if (r.kind === "column") {
        // A concrete column: a pale top, a dark face, a hazard band at the foot.
        drawBlock(r, "#8A8A90", "#55555B", "#26262A");
        ctx.fillStyle = "#C8A21E";
        ctx.fillRect(r.x, r.y + r.h - 6, r.w, 3);
        return;
    }
    if (r.kind === "pedestal") {
        // THE PEDESTAL: a long concrete plinth under the warehouse; a lit top,
        // a dark front face, and a notch above each of the eight trays.
        drawBlock(r, "#8C8C90", "#5A5A5E", "#26262A");
        const top = fy - r.lift;
        ctx.fillStyle = "#6A6A6E";
        for (let i = 0; i < TRAY_SLOTS; i++) {
            const s = arcadeTraySlot(i);
            ctx.fillRect(s.x - 20, top + 6, 40, r.fh - 12);
        }
        ctx.fillStyle = "#C8641E";
        ctx.fillRect(r.x, top, r.w, 3);
        return;
    }
    if (r.kind === "hedge") {
        drawBlock(r, "#2F5A22", "#1A3814", null);
        ctx.fillStyle = "#3E7230";
        for (let x = r.x + 4; x < r.x + r.w - 4; x += 11) {
            for (let y = fy - r.lift + 3; y < fy - r.lift + r.fh - 3; y += 9) ctx.fillRect(x + ((y / 9) % 2) * 4, y, 4, 3);
        }
    } else if (r.kind === "divider") {
        // THE DIVIDER: a concrete reservoir wall, long and tall. A pale top
        // with a dashed centre line, a dark front face with ribs.
        drawBlock(r, "#4A5056", "#25292E", "#0C0E10");
        const top = fy - r.lift;
        ctx.fillStyle = "#6A7178";
        for (let y = top + 14; y < top + r.fh - 14; y += 36) ctx.fillRect(r.x + r.w / 2 - 3, y, 6, 18);
        ctx.fillStyle = "#16191C";
        const faceY = fy + r.fh - r.lift;
        for (let x = r.x + 10; x < r.x + r.w - 6; x += 24) ctx.fillRect(x, faceY + 4, 3, r.lift - 8);
        ctx.fillStyle = "#C8641E";
        ctx.fillRect(r.x, top, r.w, 3);
    } else if (r.kind === "container") {
        drawBlock(r, r.hue[0], r.hue[1], "#000000");
        // Corrugation on the front face, and a seam between stacked boxes.
        ctx.fillStyle = "rgba(0,0,0,0.25)";
        const faceY = fy + r.fh - r.lift;
        for (let x = r.x + 6; x < r.x + r.w - 4; x += 8) ctx.fillRect(x, faceY + 2, 2, r.lift - 4);
        if (r.levels > 1) { ctx.fillStyle = "#000000"; ctx.fillRect(r.x, faceY + SET_CONTAINER_LIFT, r.w, 2); }
        ctx.fillStyle = "rgba(255,255,255,0.12)";
        ctx.fillRect(r.x + 4, fy - r.lift + 4, r.w - 8, 3);
    } else if (r.kind === "rack") {
        drawBlock(r, "#3A3E44", "#24272C", "#111316");
        const faceY = fy + r.fh - r.lift;
        // Uprights on the front face, and the shelf beam halfway up.
        ctx.fillStyle = "#C8641E";
        const step = r.vertical ? r.w : 50;
        for (let x = r.x; x <= r.x + r.w - 4; x += step) ctx.fillRect(x, faceY, 4, r.lift);
        ctx.fillRect(r.x + r.w - 4, faceY, 4, r.lift);
        ctx.fillStyle = "#E07A28";
        ctx.fillRect(r.x, faceY + Math.round(r.lift * 0.5), r.w, 3);
        // Pallets on the top shelf, on a grid along the rack's length. Which
        // bays are empty comes from the rack's own seeded `fill`.
        const len = r.vertical ? r.fh : r.w;
        const n = Math.floor(len / 46);
        for (let i = 0; i < n; i++) {
            if (((i * 7 + Math.floor(r.fill * 13)) % 5) === 0) continue;
            const bx = r.vertical ? r.x + 5 : r.x + 6 + i * 46;
            const by = r.vertical ? fy - r.lift + 6 + i * 46 : fy - r.lift + 5;
            const bw = r.vertical ? r.w - 10 : 38, bh = r.vertical ? 38 : r.fh - 10;
            ctx.fillStyle = "#8A6A3A";
            ctx.fillRect(bx, by, bw, bh);
            ctx.fillStyle = "#A8864E";
            ctx.fillRect(bx + 2, by + 2, bw - 4, 3);
            ctx.fillStyle = "#5A4222";
            ctx.fillRect(bx, by + bh - 3, bw, 3);
        }
        // Pallets showing on the lower shelf through the front face.
        ctx.fillStyle = "#6E5230";
        if (!r.vertical) for (let x = r.x + 8; x < r.x + r.w - 30; x += 46) ctx.fillRect(x, faceY + Math.round(r.lift * 0.5) + 5, 32, Math.round(r.lift * 0.5) - 8);
    } else if (r.kind === "pallet") {
        drawBlock(r, "#8A6A3A", "#5A4222", "#2A1E10");
        ctx.fillStyle = "#3A2A16";
        const faceY = fy + r.fh - r.lift;
        for (let l = 1; l < r.layers; l++) ctx.fillRect(r.x, faceY + l * PALLET_LIFT, r.w, 2);
        ctx.fillStyle = "#A07E48";
        for (let x = r.x + 4; x < r.x + r.w - 4; x += 9) ctx.fillRect(x, fy - r.lift + 3, 5, r.fh - 6);
    }
}

// The warehouse floor, under everything, after the grass.
function arcadeDrawSetFloors() {
    const L = arenaLongHouse;
    if (L) {
        ctx.fillStyle = "#34343A";
        ctx.fillRect(L.x, L.y, L.w, L.h);
        ctx.fillStyle = "#2A2A30";
        for (let y = L.y + 40; y < L.y + L.h; y += 80) ctx.fillRect(L.x, y, L.w, 2);
        for (let x = L.x + 60; x < L.x + L.w; x += 120) ctx.fillRect(x, L.y, 2, L.h);
    }
    const W = arenaWarehouse;
    if (!W) return;
    ctx.fillStyle = "#33332E";
    ctx.fillRect(W.x, W.y, W.w, W.h);
    ctx.fillStyle = "#2A2A26";
    for (let y = W.y + 40; y < W.y + W.h; y += 80) ctx.fillRect(W.x, y, W.w, 2);
    for (let x = W.x + 60; x < W.x + W.w; x += 120) ctx.fillRect(x, W.y, 2, W.h);
}

// Glass, drawn where drawWalls skipped the window segments.
function arcadeDrawWindows() {
    const W = arenaWarehouse;
    if (!W) return;
    for (let i = 0; i < W.windows.length; i++) {
        const w = W.windows[i];
        ctx.fillStyle = "#1C2A34";
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = "#7FB4D0";
        ctx.fillRect(w.x + 3, w.y + 4, w.w - 6, 4);
        ctx.fillStyle = "#9A9A9A";
        ctx.fillRect(w.x + w.w / 2 - 1, w.y, 2, w.h);
    }
}

// The dusk sun, as colour: a warm additive pool for each raycast sun light
// (arcadeDrawLighting builds them), so the shafts the walls leave read as
// light and not only as less dark. No hand-drawn shaft shapes any more.
function arcadeDrawLight() {
    const W = arenaWarehouse;
    if (!W || !sunLights.length) return;
    ctx.save();
    applyCameraTransform();
    ctx.globalCompositeOperation = "lighter";
    ctx.beginPath();
    ctx.rect(W.x, W.y, W.w, W.h);
    ctx.clip();
    for (let i = 0; i < sunLights.length; i++) {
        const u = sunLights[i];
        if (!u.poly) continue;
        ctx.save();
        clipToPoly(ctx, u.poly);
        ctx.fillStyle = bandGradient(ctx, u.x, u.y, SUN_R, "255,195,115", 0.11);
        ctx.beginPath();
        ctx.arc(u.x, u.y, SUN_R, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
    }
    ctx.restore();
}
