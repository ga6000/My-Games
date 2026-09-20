// ===================================================
//   Zombie — rounds, simulation, rendering, input
// ===================================================
"use strict";

// ---------------------------------------------------
//   GAME STATE
// ---------------------------------------------------
let gameOver = false;

// Leaderboard submission is once per run. Guarded rather than trusted:
// triggerGameOver() is reachable BOTH locally (everyone died) and from the
// host's "go" flag in zombie-net.js, so without this a client would post
// its run twice. resetGame() clears it so a replay can post again.
let zLbSubmitted = false;
let gameStarted = false;
let startTime = 0;
let kills = 0;
let lastSpawnTime = 0;
let lastFrame = 0;

// Round state (host-authoritative; mirrored onto clients by snapshot)
const ROUND_PHASES = ["idle", "active", "intermission"];
const ROUND_BREAK_MS = 7000;
let round = 0;
let roundBudget = 0;
let roundPhase = "idle";
let roundEndsAt = 0;
let revivesThisRound = 0;
let scoreBoard = {};           // netId -> {kills, revives, assists, score}
let roundCardUntil = 0;

// ---------------------------------------------------
//   DEATH, RESPAWN AND THE TEAM WIPE (2026-09-18)
// ---------------------------------------------------
// Reported: "when both players got downed in a 2 player game it caused
// myself to just respawn at the start, rather than restarting the game".
// Three separate faults produced that:
//
//  1. A GUEST NEVER BLED OUT. The bleed-out check ran only for the host's
//     own local player; nothing tracked a guest's deadline at all, so a
//     downed guest stayed downed forever and "everyone is dead" could never
//     become true while one was in the room.
//  2. A dead player could press any key and walk back in at the keep --
//     spawnPlayer() had no notion of a run in progress.
//  3. "Everyone down" was not an ending. Only "everyone DEAD" was, and 1
//     made that unreachable.
//
// Now: the host tracks every downed guest's deadline (remoteDowned);
// nobody alive in the room -> a 2s grace (a RALLY grab can still save it)
// -> game over, told to the room explicitly rather than on a throttled
// snapshot flag; and a player who bleeds out while a teammate stands is
// dead until the next breather, then back at the keep with a pistol and
// their perks -- DESIGN_IDEAS.md #1's "dead for the round".
let zAwaitRespawn = false;     // this client's player bled out; waiting for the breather
let zDiedRound = 0;
let zKeptCards = [];
let remoteDowned = {};         // HOST: guest id -> {at, bleedAt}
let wipeAt = 0;                // HOST: when an all-down room becomes a game over
const WIPE_GRACE_MS = 2000;

// ---------------------------------------------------
//   GENERATOR TRIP (2026-09-18)
// ---------------------------------------------------
// A Blackout round now trips a running generator, and the round cannot
// clear until someone restarts it: stand at it for GEN_RESTART_MS. Free --
// it was already bought -- and host-tracked from positions the host already
// has, the same way the gate plates and revives work, so it needs no new
// message. While it is down the stations go dark again and stragglers keep
// coming, so waiting it out is not an option.
let genTripped = false;
let genRestart = 0;            // 0..1
const GEN_RESTART_MS = 5000;
const GEN_RESTART_REACH = 40;  // px around the generator that counts
const STRAGGLER_GAP_MS = 2600;
const STRAGGLER_CAP = 6;

// ---------------------------------------------------
//   ULTRA HEAVY (2026-09-18)
// ---------------------------------------------------
// "Larger alternate shaped Ultra heavy enemy after round 15." One is owed
// per round from 16 (spawned once 40% of the budget is out, so it arrives
// into a fight rather than opening it), plus a small random share, capped.
const ULTRA_FROM_ROUND = 16;
let ultraOwed = 0;
let ultraAtBudget = 0;

// ---------------------------------------------------
//   THE SUPER SPLITTER ROUND  (2026-09-20)
// ---------------------------------------------------
// Asked for: "super splitter now gets its own special round where one
// spawns at first, then on higher rounds multiples can spawn & on normal
// rounds too."
//
// So it works like the Horde and Brute rounds: every SUPER_ROUND_EVERY
// rounds from SUPER_FROM_ROUND is a SUPER SPLITTER round, and the number
// that shows up climbs with the round. Outside those, the ordinary spawn
// table can still roll one -- that is the "on normal rounds too" half, and
// it is what stops the special round becoming the only time you meet it.
const SUPER_FROM_ROUND = 16;
const SUPER_ROUND_EVERY = 5;

function isSuperRound(r) {
    return r >= SUPER_FROM_ROUND && ((r - SUPER_FROM_ROUND) % SUPER_ROUND_EVERY) === 0;
}

// One on its first, then another every two special rounds after, capped --
// four of them shedding splitters is already most of a round's budget.
function superRoundCount(r) {
    if (!isSuperRound(r)) return 0;
    return Math.min(4, 1 + Math.floor((r - SUPER_FROM_ROUND) / (SUPER_ROUND_EVERY * 2)));
}

// ---------------------------------------------------
//   PERK STATE
// ---------------------------------------------------
let decoys = [];               // HOST: active lures {x, y, r, until}
let decoyReadyAt = {};         // HOST: id -> when that player's DECOY recharges
let bolts = [];                // ARC bolts, cosmetic and local {x1,y1,x2,y2,born}
let salvageKillsSeen = 0;      // this client's own kill count, last seen

// ---------------------------------------------------
//   AUDIO EVENT QUEUE (idea 38)
// ---------------------------------------------------
// The user asked whether to give every zombie a random 3-digit id,
// broadcast it on death and recycle it. It would work, but one-shot
// sounds do not need identity -- only WHAT and WHERE -- and recycled ids
// are a real hazard: a late or duplicated "427 died" applies to whichever
// zombie now holds 427. So the host drains a small event queue into each
// snapshot instead, and identity is used only where a sound must be
// STARTED AND STOPPED (barricade chewing), which already has a stable
// array index.
//
// The cap matters: without it, one lagged snapshot dumps eighty sounds
// into the mix at once.
let eventQueue = [];
const EVENT_CAP = 10;

// Expanding shockwave rings. Purely cosmetic and purely local -- every
// client spawns its own from the explosion event, so they cost nothing on
// the wire. Barrels used to detonate in complete silence AND complete
// stillness: zombies simply vanished.
let blasts = [];

function addBlast(x, y, radius) {
    blasts.push({ x: x, y: y, r: radius || 190, born: Date.now(), life: 420 });
    if (blasts.length > 24) blasts.shift();
}

// Something the whole room should hear. Host-authoritative.
//
// `owner` (optional) is the player the event belongs to, so THAT client
// skips the echo -- the rocket shooter has already drawn and heard their
// own explosion from their predicted round.
function hostEvent(code, x, y, arg, owner) {
    const gap = EVENT_THROTTLE[code];
    if (gap) {
        const now = Date.now();
        if (now - (lastEventAt[code] || 0) < gap) return;
        lastEventAt[code] = now;
    }
    playEvent(code, x, y, arg);
    if (netOnline && netIsHost && eventQueue.length < EVENT_CAP) {
        eventQueue.push([code, Math.round(x), Math.round(y), arg || 0, owner || 0]);
    }
}

// Something only this client did (its own purchase). No wire traffic.
function localEvent(code, x, y, arg) {
    playEvent(code, x, y, arg);
}

// Broadcast WITHOUT playing locally -- for sounds the actor already
// played for itself. `owner` lets that actor skip its own echo when the
// snapshot comes back.
//
// Throttled per code: gunfire and kills fire far faster than anyone can
// hear them apart, and unthrottled they would fill the 10-slot queue
// every single snapshot and crowd out breaches and downs.
const EVENT_THROTTLE = {};
EVENT_THROTTLE[SND_SHOT] = 90;
EVENT_THROTTLE[SND_KILL] = 70;
EVENT_THROTTLE[SND_ZAP] = 220;
// ARC and BLASTCAP can fire several times in one frame in a dense horde.
// The host draws every bolt; the queue gets the first of each burst, so
// they can never crowd a breach or a down out of a snapshot.
EVENT_THROTTLE[SND_ARC] = 50;
EVENT_THROTTLE[SND_POP] = 70;
let lastEventAt = {};

function queueEvent(code, x, y, arg, owner) {
    if (!netOnline || !netIsHost) return;
    const gap = EVENT_THROTTLE[code];
    if (gap) {
        const now = Date.now();
        if (now - (lastEventAt[code] || 0) < gap) return;
        lastEventAt[code] = now;
    }
    if (eventQueue.length >= EVENT_CAP) return;
    eventQueue.push([code, Math.round(x), Math.round(y), arg || 0, owner || 0]);
}

// ---------------------------------------------------
//   LIGHTING
// ---------------------------------------------------
// One number: how black the map is outside your light.
//
//   generator off  0.72   -- the map starts properly dark; that is the hook
//   generator on   0.22   -- lit, but never flat daylight
//   blackout round +0.20  -- a dip on top of whichever of those applies
//
// v2 blacked out at 0.94 with a hard-edged 210px hole, which playtesting
// found to be an unwinnable round rather than a hard one. Darkened again
// on request 2026-09-02: the generator no longer returns the map to full
// brightness, so the light radius matters at all times.
//
// 2026-09-18, on request after a playtest: blackouts "slightly darker",
// and they now TRIP the generator (genTripped). So a blackout reads 0.9
// (the cap) until someone restarts it, then 0.22 + 0.26 = 0.48 -- was
// 0.42 -- for the rest of the round. The cap is deliberately untouched:
// 0.94 is the number that failed, and the light radius is not reopened.
const AMBIENT_DARK = 0.72;
const AMBIENT_LIT = 0.22;
const AMBIENT_BLACKOUT_ADD = 0.26;

function ambientDarkness() {
    let a = generatorOn ? AMBIENT_LIT : AMBIENT_DARK;
    if (isBlackoutRound(round) && roundPhase === "active") a += AMBIENT_BLACKOUT_ADD;
    return Math.min(0.9, a);
}

// ---------------------------------------------------
//   CARDS
// ---------------------------------------------------
// The host resolves damage and payouts, so it needs to know the SHOOTER's
// cards, not just its own player's. Cards ride in the players payload.
function cardsFor(id) {
    const lp = localPlayerByNetId(id);
    if (lp) return lp.cards || [];
    const r = remotePlayers[id];
    return (r && r.cards) || [];
}

function idHasCard(id, key) {
    return cardsFor(id).indexOf(key) !== -1;
}

function idCardLevel(id, key) {
    const list = cardsFor(id);
    let n = 0;
    for (let i = 0; i < list.length; i++) if (list[i] === key) n++;
    return n;
}

// ---------------------------------------------------
//   CURVES (ideas 7, 10 — and BUG 2)
// ---------------------------------------------------
// BUG 2: v1 scaled difficulty purely off wall-clock time
// (zombieBaseSpeed += 0.0003, zombieSpawnRate -= 0.3), so an eight
// player room got exactly the trickle a solo player did -- more friends
// made the game EASIER. Difficulty is now a function of round number and
// team size, and the time-based drift is gone entirely so nothing scales
// twice.
function teamSize() {
    let n = 0;
    for (let i = 0; i < players.length; i++) n++;
    for (const id in remotePlayers) {
        // Away players do not make the next round bigger.
        if (Object.prototype.hasOwnProperty.call(remotePlayers, id) && !remotePlayers[id].away) n++;
    }
    return Math.max(1, n);
}

function budgetForRound(r) {
    const solo = Math.floor(6 * Math.pow(1.16, r - 1)) + r;
    // 1 player = 1.0x, 2 = 1.4x, 4 = 2.2x, 8 = 3.8x. Sub-linear on
    // purpose: a full room should be dangerous, not instantly overrun.
    return Math.ceil(solo * (0.6 + 0.4 * teamSize()));
}

function zombieHpMultiplier(r) {
    return 1 + Math.floor((r || 1) / 6);
}

function zombieSpeedForRound(r) {
    return Math.min(2.6, 0.9 + r * 0.06);
}

function spawnGapForRound(r) {
    return Math.max(180, 1400 - r * 70);
}

// --- special rounds -------------------------------------------------
// Composition changes instead of numbers just going up.
function isHordeRound(r)    { return r > 0 && r % 5 === 0 && r % 10 !== 0; }
function isBruteRound(r)    { return r > 0 && r % 10 === 0; }
function isBlackoutRound(r) { return r > 0 && r % 7 === 0; }

function roundLabel(r) {
    if (isBruteRound(r)) return "BRUTE ROUND";
    if (isHordeRound(r)) return "HORDE ROUND";
    if (isBlackoutRound(r)) return "BLACKOUT";
    return "ROUND " + r;
}

// Weighted pick of what spawns this round.
function pickZombieType(r) {
    if (isBruteRound(r)) return "brute";
    if (isHordeRound(r)) return "runner";

    // ULTRA HEAVY: a thin random share on top of the one owed each round.
    if (r >= ULTRA_FROM_ROUND && Math.random() < Math.min(0.04, 0.008 * (r - ULTRA_FROM_ROUND + 1))) return "supersplit";

    const roll = Math.random();
    if (r >= 4 && roll < Math.min(0.22, 0.03 * (r - 3))) return "brute";
    if (r >= 6 && roll < 0.30) return "splitter";
    if (r >= 5 && roll < 0.38) return "screamer";
    if (r >= 3 && roll < 0.58) return "runner";
    return "walker";
}

// How many may be alive at once: one at 16, a fourth by round 31.
function ultraCap(r) {
    // A SUPER SPLITTER round deliberately lifts the cap to what that round
    // is supposed to deliver; otherwise it is the ordinary trickle limit.
    return Math.max(superRoundCount(r), Math.min(4, 1 + Math.floor((r - ULTRA_FROM_ROUND) / 5)));
}

function countZombies(type) {
    let n = 0;
    for (let i = 0; i < zombies.length; i++) if (zombies[i].type === type) n++;
    return n;
}

// The round loop's spawn call, with the ULTRA's rules folded in.
function spawnRoundZombie(r) {
    let type = pickZombieType(r);
    if (ultraOwed > 0 && roundBudget <= ultraAtBudget) type = "supersplit";
    if (type === "supersplit" && countZombies("supersplit") >= ultraCap(r)) type = "brute";
    const z = spawnZombie(type, r);
    if (z && type === "supersplit") {
        ultraOwed = Math.max(0, ultraOwed - 1);
        hostEvent(SND_ULTRA, z.x, z.y, 0);
    }
    return z;
}

function startRound(r) {
    round = r;
    roundBudget = isHordeRound(r) ? budgetForRound(r) * 3
                : isBruteRound(r) ? Math.ceil(budgetForRound(r) * 0.35)
                : budgetForRound(r);
    roundPhase = "active";
    roundEndsAt = 0;
    revivesThisRound = 0;
    roundCardUntil = Date.now() + 2600;
    // Horde rounds are pure runners; everything else from 16 owes one.
    // A SUPER SPLITTER round owes its whole complement; an ordinary round
    // from 16 owes the usual one.
    ultraOwed = isHordeRound(r) ? 0
              : isSuperRound(r) ? superRoundCount(r)
              : (r >= ULTRA_FROM_ROUND ? 1 : 0);
    ultraAtBudget = Math.floor(roundBudget * 0.6);
    // The round-start sting became a chime in the score (zombie-music.js),
    // which every client times off the round number in the snapshot -- so
    // it no longer needs to ride the event queue.
    if (isBlackoutRound(r) && generatorOn) tripGenerator();
}

// BLACKOUT: the lights go, and they stay gone until someone walks to the
// generator and holds it. Never bought? Then there is nothing to trip, and
// the round is the old kind of blackout -- darker, and it ends on its own.
function tripGenerator() {
    generatorOn = false;
    genTripped = true;
    genRestart = 0;
    const g = generatorRect || { x: WORLD_W / 2, y: WORLD_H / 2, w: 0, h: 0 };
    hostEvent(SND_GEN_TRIP, g.x + g.w / 2, g.y + g.h / 2);
    showToast("THE GENERATOR TRIPPED", 2600);
}

function restoreGenerator() {
    generatorOn = true;
    genTripped = false;
    genRestart = 0;
    const g = generatorRect || { x: WORLD_W / 2, y: WORLD_H / 2, w: 0, h: 0 };
    // Local only: guests already sound the generator on the snapshot's
    // off -> on transition (applyWorldSnapshot), so queueing it too would
    // play it twice for them.
    localEvent(SND_GENERATOR, g.x + g.w / 2, g.y + g.h / 2);
    showToast("POWER RESTORED", 2200);
}

// HOST. Anyone alive standing at a tripped generator winds it back up;
// step away and it runs down, slower than it fills.
function updateGeneratorRestart(dt) {
    if (!genTripped || !generatorRect) return;
    const g = generatorRect;
    const r = GEN_RESTART_REACH;
    let near = false;
    const all = allTargets();
    for (let i = 0; i < all.length && !near; i++) {
        const t = all[i];
        if (t.downed) continue;
        if (rectIntersect(t.x, t.y, t.size || 16, t.size || 16, g.x - r, g.y - r, g.w + r * 2, g.h + r * 2)) near = true;
    }
    if (near) {
        genRestart += dt / GEN_RESTART_MS;
        if (genRestart >= 1) restoreGenerator();
    } else if (genRestart > 0) {
        genRestart = Math.max(0, genRestart - dt / (GEN_RESTART_MS * 2));
    }
}

function endRound(now) {
    roundPhase = "intermission";
    roundEndsAt = now + ROUND_BREAK_MS;
    // One guaranteed pickup per round clear reads as a reward; v1's
    // "every 20 spawns" read as a random trickle.
    const anchor = pickSpawnAnchor();
    spawnPickup(anchor.x, anchor.y);
    // Barricades come back during the breather so the keep is
    // defensible again next round (idea 17).
    //
    // ROLE: ENGINEER -- at 150% while one is in the game (2026-09-18). The
    // trait used to live only on the manual "board" purchase, which needs a
    // DAMAGED window during a breather -- and this loop has just repaired
    // every one of them, so that purchase never came up and the trait could
    // never fire. Found writing the field manual's CLASSES tab.
    const boost = engineerInGame() ? 1.5 : 1;
    for (let i = 0; i < barricades.length; i++) {
        barricades[i].hp = barricades[i].maxHp * boost;
    }
    rebuildSolidIndex();
}

// Anyone in the room -- up or down, local or remote -- dealt ENGINEER.
function engineerInGame() {
    const all = allTargets();
    for (let i = 0; i < all.length; i++) if (idHasRole(all[i].id, "engineer")) return true;
    return false;
}

function reviveMsRequired() {
    // Escalating cost (idea 2): 3s, 4.5s, 6s within a round.
    return Math.min(6000, 3000 * (1 + 0.5 * revivesThisRound));
}

// ---------------------------------------------------
//   LIFECYCLE
// ---------------------------------------------------
function startGame() {
    gameStarted = true;
    uiStart.style.display = 'none';
    startTime = Date.now();
    lastSpawnTime = startTime;
    if (netIsHost) startRound(1);
    // The score opens on chimes, then the organ comes in under them.
    musicStart();
}

// One toast at a time, and a later one is never cut short by an earlier
// one's timer -- each call used to arm its own hide.
let toastUntil = 0;
// ---------------------------------------------------
//   INTENSIFY  (2026-09-19)
// ---------------------------------------------------
// A heavy knife switch in the keep that turns the run into a blitz. Asked
// for as: a switch that "flips down and is heavy", a normal message saying
// who called it, a bomb siren, and then a vibrating red THEY HEAR YOUR CALL
// across the whole screen.
//
// ONE WAY. There is no un-intensifying: it is a decision a team makes
// together and then lives with, which is the only thing that makes it worth
// a set piece. Host-authoritative like every other world flip, and it rides
// the world snapshot as `iz`/`hc` rather than an event, because an event
// queue is capped at ten a snapshot and is the first thing dropped -- the
// one packet carrying "the horde has been called" must not be droppable.
//
// What it changes is in four places, all reading `intensified`:
//   - update()        a round clears on budget alone, not on an empty map
//   - zombieSpeed()   x INTENSIFY_SPEED
//   - runScoreFor()   score per second alive
//   - zombie-music.js the score turns cold
const INTENSIFY_SPEED = 1.28;      // "a fair amount but not overkill"
const INTENSIFY_SIREN_MS = 1200;   // siren -> the screen-filling call
const INTENSIFY_CALL_MS = 2200;    // how long THEY HEAR YOUR CALL holds
const INTENSIFY_LEVER_MS = 450;    // the lever falling

let intensified = false;
let intensifyAt = 0;               // when the switch was thrown (local clock)
let hordeCalledBy = "";
let intensifyCallShown = false;    // the red card has been played once
let aliveMs = 0;                   // this client's own time alive, intensified

// The zombie speed multiplier, read at the point of use rather than written
// into the zombie -- so throwing the switch speeds up everything ALREADY on
// the map, not just what spawns afterwards.
function intensifySpeedMult() {
    return intensified ? INTENSIFY_SPEED : 1;
}

// HOST. Free, but still routed through the buy path, because that is the
// one seam where the host validates a world change a client asked for.
function hostFlipIntensify(msg) {
    if (intensified || !intensifyRect) return;
    intensified = true;
    intensifyAt = Date.now();
    hordeCalledBy = nameForNetId(msg && msg.id) || "SOMEONE";
    beginIntensifyAnnounce();
}

// Every client runs this: the host from hostFlipIntensify, a guest from the
// snapshot's `iz` going 0 -> 1 (zombie-net.js).
function beginIntensifyAnnounce() {
    intensifyCallShown = false;
    showToast((hordeCalledBy || "SOMEONE") + " CALLED THE HORDE", 2600);
    localEvent(SND_SIREN, WORLD_W / 2, WORLD_H / 2);
    addShake(6);
}

// Driven from the loop so it needs no timer of its own and cannot outlive
// a teardown.
function updateIntensifyAnnounce(now) {
    if (!intensified || intensifyCallShown || !intensifyAt) return;
    if (now - intensifyAt >= INTENSIFY_SIREN_MS) {
        intensifyCallShown = true;
        showHordeCall(INTENSIFY_CALL_MS);
    }
}

// The name behind a netId, for the toast. Local player first, then the
// remote records, then the id itself so it can never print "undefined".
function nameForNetId(id) {
    if (!id) return "";
    if (isMyNetId(id)) return MP.selfName || "YOU";
    const r = remotePlayers[id];
    if (r && r.name) return r.name;
    return "";
}

function showToast(text, ms) {
    uiToast.innerText = text;
    uiToast.style.display = 'block';
    toastUntil = Date.now() + ms;
    trackTimeout(function () {
        if (Date.now() >= toastUntil) uiToast.style.display = 'none';
    }, ms + 20);
}

// Bled out. While the run goes on, this is "dead until the next breather",
// never "press a key to come back" -- see the note at the top of this file.
function killLocalPlayer(p) {
    zKeptCards = (p.cards || []).slice();
    players = players.filter(function (pl) { return pl.id !== p.id; });
    if (gameStarted && !gameOver && !won) {
        zAwaitRespawn = true;
        zDiedRound = round;
    }
    checkAllDead();
}

// Offline only. Online, the HOST decides the room is wiped (updateTeamWipe)
// because only the host can see every player at once; a guest deciding for
// itself was how one downed player could end, or fail to end, a run.
function checkAllDead() {
    if (netOnline) return;
    if (players.length === 0) triggerGameOver();
}

// The way out of a hold, offered after NET_LOST_OFFER_MS: carry on alone
// with the world as it stood. The time spent holding is given back to a
// downed player's bleed-out, and if the room answers later the ordinary
// promotion path (onPeerSync + the snapshot's `ls`) folds us back in.
function goSoloAfterLoss() {
    if (!netLost) return;
    const held = Date.now() - netLostAt;
    netLost = false;
    netIsHost = true;
    for (let i = 0; i < players.length; i++) {
        if (players[i].downed && players[i].bleedDeadline) players[i].bleedDeadline += held;
    }
    lastSpawnTime = Date.now();
    showToast("PLAYING ON ALONE", 1800);
}

// Every client: bring this client's player back at the breather that ends
// the round it died in (or any later round, for a player who missed one).
function updateRespawn(now) {
    if (!zAwaitRespawn || !gameStarted || gameOver || won) return;
    if (players.length) { zAwaitRespawn = false; return; }
    const due = (roundPhase === "intermission" && round >= zDiedRound) || round > zDiedRound;
    if (!due) return;
    zAwaitRespawn = false;
    const p = spawnPlayer(zKeptCards);
    if (p) {
        p.invulnUntil = now + 3000;
        showToast("BACK IN", 1800);
    }
}

// HOST: is anyone in the room still on their feet? Away players are not
// here to be on their feet -- see updateTeamWipe for how they still count.
function anyoneAlive() {
    for (let i = 0; i < players.length; i++) if (!players[i].downed) return true;
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        if (!r.downed && !r.away) return true;
    }
    return false;
}

// A teammate who was STANDING when their connection went. The run is not
// ended over their head for a wifi blip: the wipe grace stretches to give
// them a chance to come back and pick the others up.
const WIPE_GRACE_AWAY_MS = 10000;

function standingTeammateAway() {
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        if (r.away && r.awayStanding) return true;
    }
    return false;
}

// HOST. Nobody standing -> a short grace (a downed player crawling onto a
// RALLY can still save it) -> the run is over, for the whole room.
function updateTeamWipe(now) {
    if (!gameStarted || gameOver || won) { wipeAt = 0; return; }
    if (anyoneAlive()) { wipeAt = 0; return; }
    if (!wipeAt) {
        wipeAt = now + (standingTeammateAway() ? WIPE_GRACE_AWAY_MS : WIPE_GRACE_MS);
        return;
    }
    if (now < wipeAt) return;
    wipeAt = 0;
    // Told explicitly. The world snapshot's `go` flag rides a throttled
    // send, and update() stops broadcasting the moment gameOver is set, so
    // the flag alone could be skipped and leave guests playing on.
    if (netOnline) MP.send({ k: "over" });
    triggerGameOver();
}

// HOST. The bleed-out clock for every downed GUEST. This did not exist
// before 2026-09-18: only the host's own player ever bled out.
function updateRemoteBleed(now) {
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        const rec = remoteDowned[id];
        // AWAY: the clock stops. Bleeding out because your wifi dropped is
        // exactly the penalty the connection pass exists to remove. The time
        // away is added back on to the deadline when they return.
        if (r.away) {
            if (rec && !rec.pausedAt) rec.pausedAt = now;
            continue;
        }
        if (rec && rec.pausedAt) {
            rec.bleedAt += now - rec.pausedAt;
            rec.pausedAt = 0;
        }
        if (r.downed) {
            // A downed guest the host never saw go down -- a promoted host,
            // or one that joined mid-fight -- gets a fresh clock.
            if (!rec) { remoteDowned[id] = { at: now, bleedAt: now + BLEED_OUT_MS }; continue; }
            if (now >= rec.bleedAt) {
                delete remoteDowned[id];
                delete remotePlayers[id];
                sendDeath(id);
            }
        } else if (rec && now - rec.at > 2000) {
            // Reporting "up" long after the down: it got up by a path the
            // host did not run (a RALLY, the dev panel). Trust it.
            delete remoteDowned[id];
        }
    }
}

// The first win state the game has ever had.
// ---------------------------------------------------
//   GETTING OUT  (the win sequence, 2026-09-19)
// ---------------------------------------------------
// Asked for: "exiting the game should pull the player off screen as if
// they've left the area and gameplay in background should fade to black
// allowing the escape message + high score message to appear. sound &
// player input should stop at this time."
//
// So winning is no longer one frame. triggerWin() starts a sequence and the
// CARD comes at the end of it:
//
//   0            -> ESCAPE_PULL_MS   the player walks south out of frame
//   ESCAPE_PULL  -> + ESCAPE_FADE_MS the world fades to black behind them
//   then                             showWinCard(): YOU GOT OUT + the score
//
// `won` is still set on the FIRST frame, not the last, because it is
// host-authoritative state on the wire (`wn`) and it is what stops the
// endgame and the flood. Only the card is delayed.
//
// The sequence is LOCAL and every client in the room plays its own: the run
// is won by the team, so everyone gets the walk-out. The pull is a DRAW
// offset (`winPullPx`), never a write to p.x -- the same discipline as
// RETRO.snap. Moving the simulation would walk the player through the world
// clamp and into collision code on the way out.
const ESCAPE_PULL_MS = 1400;
const ESCAPE_FADE_MS = 1200;

let winSeqAt = 0;        // when the sequence started; 0 = not running
let winPullPx = 0;       // how far the local player is drawn past the gate
let winFade = 0;         // 0..1 black over the world

// True while input and gameplay sound are suppressed.
function winSequenceRunning() {
    return winSeqAt > 0 && !uiWinShown;
}
let uiWinShown = false;

function triggerWin() {
    if (won || gameOver) return;
    won = true;
    winSeqAt = Date.now();
    winPullPx = 0;
    winFade = 0;
    // The gate, and then nothing: stopAllLoops kills the sustained voices
    // and winSequenceRunning() gates every one-shot from here on, so the
    // walk out is silent except for the score's own win cue.
    localEvent(SND_GENERATOR, WORLD_W / 2, WORLD_H - 100);
    stopAllLoops();
    musicEnd("win");
    releaseHeldKeys();
    if (netOnline && netIsHost) MP.send({ k: "won" }, true);
}

function updateWinSequence(now) {
    if (!winSeqAt || uiWinShown) return;
    const t = now - winSeqAt;
    // Constant rate, far enough to clear any screen height.
    winPullPx = Math.min(1, t / ESCAPE_PULL_MS) * 620;
    winFade = clamp((t - ESCAPE_PULL_MS) / ESCAPE_FADE_MS, 0, 1);
    if (t >= ESCAPE_PULL_MS + ESCAPE_FADE_MS) showWinCard();
}

function showWinCard() {
    if (uiWinShown) return;
    uiWinShown = true;
    winFade = 1;
    uiWin.style.display = 'block';
    uiWinRound.innerText = String(round);
    renderRunScore(uiWinScore);
    // A win is a completed run and belongs on the board too -- the same
    // guard stops the later game-over path posting it a second time.
    submitRunToLeaderboard();
}

function triggerGameOver() {
    if (gameOver) return;
    gameOver = true;
    zAwaitRespawn = false;
    const at = players[0] || { x: WORLD_W / 2, y: WORLD_H / 2 };
    localEvent(SND_GAMEOVER, at.x, at.y);
    stopAllLoops();
    musicEnd("over");
    uiGameOver.style.display = 'block';
    uiFinalRound.innerText = String(round);
    renderRunScore(uiOverScore);
    submitRunToLeaderboard();
}

// ---------------------------------------------------
//   RUN SCORE (2026-09-19)
// ---------------------------------------------------
// Until 2026-09-19 the leaderboard score was just the round reached. Now it
// is one number built from five things:
//
//     combat   your own kills (by type), assists and revives -- the live
//              scoreBoard[id].score, credited on the host as they happen
//     rounds   SCORE_ROUND_K * round^2, shared by the whole team
//     silos    SCORE_SILO per silo filled, shared
//     win      SCORE_WIN flat, and then the WHOLE total doubles
//
// The calibration target was the user's: a win is a massive chunk, but a
// team that goes down on round ~35 without winning should out-score an
// ordinary early win, and a win that ALSO gets deep doubles again. Modelled
// from the real spawn tables (budgetForRound, pickZombieType), per player,
// for teams of 2-4 and every kill on the board:
//
//     lose on round 15   ~21k      win on round 15   ~190k
//     lose on round 25   ~77k      win on round 25   ~300k
//     lose on round 35  ~250k      win on round 35   ~650k
//
// so a loss overtakes a round-10-to-20 win somewhere around rounds 33-35.
// Kills grow roughly exponentially with round (the budget is 1.16^r), which
// is what lets deep runs catch the win bonus at all; the round^2 term keeps
// "how far you got" legible even for a player who got few kills.
const SCORE_KILL_MULT = 10;          // x the type's `score`: walker 10 ... ultra 120
const SCORE_ASSIST = 3;
const SCORE_REVIVE_PER_ROUND = 100;  // a revive on round r is worth 100 * r
const SCORE_ROUND_K = 50;
// INTENSIFIED ONLY (2026-09-19): "increased score is earned during time
// alive in addition to other score earners". 40/s is calibrated against the
// terms above -- a five-minute intensified stretch is 12,000, which is
// between one silo (8,000) and the round term at round 16 (12,800). So it
// is a real reason to throw the switch early without ever competing with
// kills, which grow ~1.16^r. Only counted while you are UP: a downed player
// is not surviving, they are being rescued.
const SCORE_ALIVE_PER_SEC = 40;
const SCORE_SILO = 8000;
const SCORE_WIN = 50000;

function silosFilled() {
    let n = 0;
    for (let i = 0; i < siloFill.length; i++) if (siloFill[i] >= siloCapacity(i)) n++;
    return n;
}

// Score for one player's netId right now. Also what the intermission
// scoreboard shows, so the number on the board mid-run is the number that
// would post if the run ended there. A guest reads the snapshot copy of
// scoreBoard, which can trail the host by one snapshot at the very end.
function runScoreFor(id) {
    const row = scoreBoard[id] || { kills: 0, revives: 0, score: 0 };
    const silos = silosFilled();
    const b = {
        kills: row.kills || 0,
        revives: row.revives || 0,
        combat: row.score || 0,
        round: round,
        roundPts: SCORE_ROUND_K * round * round,
        silos: silos,
        siloPts: SCORE_SILO * silos,
        won: won,
        winPts: won ? SCORE_WIN : 0,
        // Per-client, so it is the only term that is not derived from the
        // host's scoreBoard row. A guest counts its own seconds.
        alivePts: Math.round(aliveMs / 1000) * SCORE_ALIVE_PER_SEC
    };
    const sub = b.combat + b.roundPts + b.siloPts + b.winPts + b.alivePts;
    b.total = won ? sub * 2 : sub;
    return b;
}

// Name and room come from MP, the same place every other identity value in
// this game comes from. Under file:// LB is a silent no-op, so a
// double-clicked game is completely unaffected -- that is the whole point of
// how shared/leaderboard.js degrades.
function submitRunToLeaderboard() {
    if (zLbSubmitted) return;
    zLbSubmitted = true;
    if (typeof LB === "undefined") return;
    LB.submit({
        player: (typeof MP !== "undefined" && MP.selfName) || "Anonymous",
        score: runScoreFor(netIdFor(players[0])).total,
        // Its own field since 2026-09-19, so the scores page can show how far
        // the run got next to the score rather than instead of it.
        round: round,
        room: (typeof MP !== "undefined" && MP.room) || ""
    });
}

function resetGame() {
    players = [];
    zombies = [];
    bullets = [];
    remoteBullets = [];
    pickups = [];
    markers = [];
    blasts = [];
    remotePlayers = {};

    kills = 0;
    scrapPool = 0;
    scoreBoard = {};
    eventQueue = [];
    stopAllLoops();
    musicStop(false);
    gameOver = false;
    gameStarted = false;
    zLbSubmitted = false;

    // The win sequence, or a restart clicked during one leaves the world
    // half-faded and the local player drawn 600px south of themselves.
    winSeqAt = 0;
    winPullPx = 0;
    winFade = 0;
    uiWinShown = false;

    intensified = false;
    intensifyAt = 0;
    hordeCalledBy = "";
    intensifyCallShown = false;
    aliveMs = 0;
    hideHordeCall();

    zAwaitRespawn = false;
    zDiedRound = 0;
    zKeptCards = [];
    remoteDowned = {};
    wipeAt = 0;
    decoys = [];
    decoyReadyAt = {};
    bolts = [];
    salvageKillsSeen = 0;
    ultraOwed = 0;
    genTripped = false;
    genRestart = 0;

    resetEndgame();
    uiWin.style.display = 'none';
    stopRunScoreReadout();

    round = 0;
    roundBudget = 0;
    roundPhase = "idle";
    roundEndsAt = 0;
    revivesThisRound = 0;
    roundCardUntil = 0;

    uiGameOver.style.display = 'none';
    uiStart.style.display = 'block';
    uiRoundCard.style.display = 'none';
    uiScores.style.display = 'none';
    hudReset();

    generateLevel();
}

// ---------------------------------------------------
//   ECONOMY (idea 3)
// ---------------------------------------------------
// Spending MUST be host-validated. Two clients pressing buy on the same
// frame would otherwise both pass a local "can we afford it?" check and
// spend the same scrap twice.
function requestBuy(what, index, p) {
    const msg = { k: "buy", what: what, i: index, id: netIdFor(p) };
    if (netIsHost) hostHandleBuy(msg);
    else if (netOnline) MP.send(msg);
}

function hostHandleBuy(msg) {
    const now = Date.now();
    const i = msg.i | 0;

    // Costs nothing and is checked first, so it can never be blocked by an
    // empty scrap pool.
    if (msg.what === "intensify") { hostFlipIntensify(msg); return; }

    if (msg.what === "door") {
        const d = doors[i];
        if (!d || d.open || scrapPool < d.cost) return;
        scrapPool -= d.cost;
        d.open = true;
    } else if (msg.what === "wallbuy") {
        const wb = wallBuys[i];
        if (!wb || scrapPool < wb.cost) return;
        scrapPool -= wb.cost;
    } else if (msg.what === "trap") {
        const t = traps[i];
        if (!t || now < t.readyAt) return;
        // CONDUCTOR: cheaper and longer-lasting traps.
        const cond = idCardLevel(msg.id, "conductor");
        // ROLE: ENGINEER stacks with CONDUCTOR.
        const roleCut = idHasRole(msg.id, "engineer") ? 0.6 : 1;
        const cost = Math.round(t.cost * [1, 0.6, 0.45, 0.3][cond] * roleCut);
        if (scrapPool < cost) return;
        scrapPool -= cost;
        t.armedUntil = now + 8000 * (1 + cond);
        t.readyAt = now + 30000;
    } else if (msg.what === "crate") {
        const c = ammoCrates[i];
        if (!c || c.uses <= 0) return;
        c.uses--;
    } else if (msg.what === "generator") {
        // A TRIPPED generator is restarted by standing at it, not bought
        // twice (updateGeneratorRestart).
        if (!generatorRect || generatorOn || genTripped || scrapPool < generatorRect.cost) return;
        scrapPool -= generatorRect.cost;
        generatorOn = true;
    } else if (msg.what === "card") {
        const st = cardStations[i];
        // Gated on the generator, on purpose: it gives the lights a
        // second reason to matter beyond visibility.
        if (!st || !generatorOn) return;
        const lvl = idCardLevel(msg.id, st.card);
        if (lvl >= CARD_MAX_STACK) return;
        // A NEW card needs a free slot; stacking one you already hold
        // does not.
        if (lvl === 0 && distinctCardCount(cardsFor(msg.id)) >= CARD_SLOTS) return;
        const price = Math.round(st.cost * CARD_STACK_COST[lvl]);
        if (scrapPool < price) return;
        scrapPool -= price;
    } else if (msg.what === "silo") {
        if (!siloReady(i)) return;
        flipSilo(i);
    } else if (msg.what === "board") {
        const b = barricades[i];
        if (!b || b.hp >= b.maxHp) return;
        b.hp = b.maxHp;
    } else {
        return;
    }

    const out = { k: "bought", what: msg.what, i: i, id: msg.id };
    applyPurchase(out, now);
    if (netOnline) MP.send(out);
}

function applyPurchase(msg, now) {
    const i = msg.i | 0;

    if (msg.what === "door") {
        if (doors[i]) {
            doors[i].open = true;
            localEvent(SND_DOOR, doors[i].x, doors[i].y);
        }
        rebuildSolidIndex();
    } else if (msg.what === "trap") {
        if (traps[i]) localEvent(SND_TRAP, traps[i].x, traps[i].y);
        if (traps[i]) {
            // Must mirror hostHandleBuy's CONDUCTOR duration, not a flat
            // 8000 -- this runs after it and was silently overwriting the
            // doubled timer, so the card charged 60% and gave nothing.
            traps[i].armedUntil = now + 8000 * (1 + idCardLevel(msg.id, "conductor"));
            traps[i].readyAt = now + 30000;
        }
    } else if (msg.what === "board") {
        // ROLE: ENGINEER reboards come back stronger.
        if (barricades[i]) {
            barricades[i].hp = barricades[i].maxHp * (idHasRole(msg.id, "engineer") ? 1.5 : 1);
        }
        rebuildSolidIndex();
    } else if (msg.what === "crate") {
        if (ammoCrates[i] && !netIsHost) ammoCrates[i].uses--;
        const p = localPlayerByNetId(msg.id);
        if (p) refillAmmo(p);
        if (ammoCrates[i]) localEvent(SND_CRATE, ammoCrates[i].x, ammoCrates[i].y);
    } else if (msg.what === "wallbuy") {
        const wb = wallBuys[i];
        const p = localPlayerByNetId(msg.id);
        if (wb && p) {
            if (!p.owned) p.owned = {};
            p.owned[wb.weapon] = true;
            p.weapon = wb.weapon;
            p.ammo[wb.weapon] = WEAPONS[wb.weapon].capacity;
        }
        if (wb) localEvent(SND_BUY, wb.x, wb.y);
    } else if (msg.what === "generator") {
        generatorOn = true;
        genTripped = false;
        if (generatorRect) {
            // No markNavDirty(): the generator changes light, not geometry.
            localEvent(SND_GENERATOR, generatorRect.x, generatorRect.y);
            showToast("LIGHTS ON", 2200);
        }
    } else if (msg.what === "silo") {
        // Host already applied it; clients mirror the flag so their
        // prompts and rendering agree.
        siloFlipped[i] = true;
        if (i + 1 < funnels.length) funnelActive[i + 1] = true;
        if (silos[i]) localEvent(SND_GENERATOR, silos[i].x, silos[i].y);
    } else if (msg.what === "card") {
        const st = cardStations[i];
        const p = localPlayerByNetId(msg.id);
        if (st && p) {
            const lvl = cardLevel(p, st.card);
            if (lvl < CARD_MAX_STACK && (lvl > 0 || distinctCardCount(p.cards) < CARD_SLOTS)) {
                p.cards.push(st.card);
            }
        }
        if (st) localEvent(SND_CARD, st.x, st.y);
    }
}

// A crate tops up every gun you OWN -- including one that has run dry,
// which the old "has ammo left" test could not see once switching existed.
// The rocket launcher only comes back to half (`crateFrac`), and never
// loses rounds to a crate.
//
// ROLE: GUNNER, +25% crate ammo. Its blurb has promised this since the
// roles landed (2026-09-02) and nothing applied it until now.
function refillAmmo(p) {
    const extra = myRole() === "gunner" ? 1.25 : 1;
    for (let i = 0; i < WEAPON_KEYS.length; i++) {
        const key = WEAPON_KEYS[i];
        const w = WEAPONS[key];
        if (w.infinite) continue;
        if (!ownsWeapon(p, key) && !(p.ammo[key] > 0) && p.weapon !== key) continue;
        const full = Math.round(w.capacity * (w.crateFrac || 1) * extra);
        p.ammo[key] = Math.max(p.ammo[key] || 0, full);
    }
}

function creditScore(ownerId, field, amount, points) {
    if (!ownerId) return;
    if (!scoreBoard[ownerId]) scoreBoard[ownerId] = { kills: 0, revives: 0, assists: 0, score: 0 };
    scoreBoard[ownerId][field] += amount;
    scoreBoard[ownerId].score += points;
}

// ---------------------------------------------------
//   TEAM PICKUPS (idea 4)
// ---------------------------------------------------
function applyTeamPickup(type, ms, now, isHostOrigin) {
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (type === "overclock") p.overclockUntil = now + ms;
        else if (type === "rally") {
            if (p.downed) {
                p.downed = false;
                p.bleedDeadline = 0;
                p.reviveProgress = 0;
            }
            p.invulnUntil = now + 2500;
        }
    }
    // RALLY stands everyone up, so every guest bleed clock the host holds
    // is void -- and a room that was about to be called wiped is not.
    if (type === "rally" && netIsHost) {
        remoteDowned = {};
        wipeAt = 0;
    }
    showToast(PICKUP_NAME[type] || "", 1800);
    if (isHostOrigin && netOnline) MP.send({ k: "pickup", t: type, ms: ms });
}

// ---------------------------------------------------
//   UPDATE
// ---------------------------------------------------
function update(now, dt) {
    if (!gameStarted || gameOver) return;
    // Lost a shared room mid-run: HOLD (2026-09-19). This client used to
    // turn itself into a solo host and run its own fork of the world, where
    // its own zombies could down or kill it -- a wifi penalty, and a local
    // game over whose "restart" click then reset the whole room once the
    // connection came back. Nothing moves here until the room answers again,
    // or the player chooses to carry on alone (goSoloAfterLoss).
    if (netLost) return;

    // ---- ROUND FLOW (host only) ----
    if (netIsHost) {
        updateEndgame(now, dt);
        updateGeneratorRestart(dt);
    }
    if (netIsHost && !floodActive) {
        if (roundPhase === "intermission" && now >= roundEndsAt) startRound(round + 1);

        if (roundPhase === "active") {
            if (roundBudget > 0 && now - lastSpawnTime > spawnGapForRound(round)) {
                const z = spawnRoundZombie(round);
                if (z) {
                    roundBudget--;
                    lastSpawnTime = now;
                }
            } else if (roundBudget === 0 && genTripped &&
                       now - lastSpawnTime > STRAGGLER_GAP_MS && zombies.length < STRAGGLER_CAP) {
                // The dark keeps sending them until the lights are back.
                if (spawnZombie(Math.random() < 0.5 ? "runner" : "walker", round)) lastSpawnTime = now;
            }
            // Clears only when the budget is spent AND the map is empty --
            // and, on a Blackout, only once the generator is running again.
            //
            // INTENSIFIED (2026-09-19): the empty-map condition is dropped,
            // so rounds roll on over the top of whatever is still chasing
            // you. That is the blitz. The GENERATOR condition deliberately
            // stays: a Blackout holding a round open until someone restarts
            // it is the 2026-09-18 mechanic, and it is the one thing that
            // should still be able to stop the clock.
            const mapClear = intensified || zombies.length === 0;
            if (roundBudget === 0 && mapClear && !genTripped) endRound(now);
        }
    }

    // INTENSIFIED: bank the time you stay on your feet (2026-09-19). Per
    // client, because it is the one score term the host does not own -- a
    // guest counts its own seconds and posts them with its own run.
    if (intensified) {
        const me = players[0];
        if (me && !me.downed) aliveMs += dt;
    }

    // Any zone a player is standing in OR looking into goes hot, and
    // stays hot for 45s after they leave. That is what stops zombies
    // appearing in ground the team just walked through, without
    // permanently retiring half the map as a spawn source.
    markHotZones();

    updatePlayers(now, dt);
    updateBullets(now);
    advanceRemoteBullets();

    if (netIsHost) {
        updateZombies(now, dt);
        updateRevives(now, dt);
        updateTraps(now);
        updateRemoteBleed(now);
        updateTeamWipe(now);
    }
    updateSalvage();
    updateRespawn(now);

    interpolateRemotes();
    pruneRemotePlayers();
    broadcastPlayers();
    broadcastWorld();

    for (let i = markers.length - 1; i >= 0; i--) {
        if (now > markers[i].until) markers.splice(i, 1);
    }
    for (let i = blasts.length - 1; i >= 0; i--) {
        if (now - blasts[i].born > blasts[i].life) blasts.splice(i, 1);
    }
    for (let i = bolts.length - 1; i >= 0; i--) {
        if (now - bolts[i].born > 220) bolts.splice(i, 1);
    }
}

// Marks the zone each player is IN, plus any zone they are standing
// close to. Deliberately NOT the whole view box: that is 1824x1026
// against 1600x900 zones, so from the middle of the map it marked all
// nine and nothing was ever spawnable again.
//
// The two checks divide the work cleanly:
//   - this cooldown covers "ground the team is in or beside"
//   - visibleToAnyone() rejects individual points currently on screen
// so a zone you can see a sliver of stays usable, minus the sliver.
const ZONE_NEAR = 300;

function markHotZones() {
    const until = Date.now() + ZONE_COOLDOWN_MS;
    const here = [];
    for (let i = 0; i < players.length; i++) here.push(players[i]);
    for (const id in remotePlayers) {
        if (Object.prototype.hasOwnProperty.call(remotePlayers, id)) here.push(remotePlayers[id]);
    }

    for (let i = 0; i < here.length; i++) {
        const box = {
            x: here[i].x - ZONE_NEAR,
            y: here[i].y - ZONE_NEAR,
            w: ZONE_NEAR * 2,
            h: ZONE_NEAR * 2
        };
        // rectTouchesZone, not rectsOverlap(zoneBounds): a bbox test would
        // mark the Blockhouse's entire 2400x1200 box from anywhere inside
        // it, and the cross only occupies 58% of that.
        for (let z = 0; z < ZONE_COUNT; z++) {
            if (rectTouchesZone(box, z)) zoneHotUntil[z] = until;
        }
    }
}

function updatePlayers(now, dt) {
    for (let i = players.length - 1; i >= 0; i--) {
        const p = players[i];
        let vx = 0;
        let vy = 0;
        const speed = playerSpeed(p, now);

        // ONE scheme: WASD moves, the mouse aims. Movement and aim are
        // now independent vectors, so strafing -- backing away from a
        // horde while still firing into it -- is native.
        //
        // This is also what retired idea 23. The hold-position modifier
        // existed only because the old mouse-follow scheme made your
        // movement vector and your aim vector the same thing; decoupling
        // them removes the problem rather than working around it.
        const dx = mouseX - (p.x + p.size / 2);
        const dy = mouseY - (p.y + p.size / 2);
        const aim = Math.hypot(dx, dy);
        if (aim > 0) {
            p.facingX = dx / aim;
            p.facingY = dy / aim;
        }

        if (p.keys.up) vy -= speed;
        if (p.keys.down) vy += speed;
        if (p.keys.left) vx -= speed;
        if (p.keys.right) vx += speed;
        if (vx !== 0 && vy !== 0) {
            const len = Math.hypot(vx, vy);
            vx = (vx / len) * speed;
            vy = (vy / len) * speed;
        }

        moveWithCollisions(p, vx, vy, true, false);

        // Pickups are team-wide, so collection is worth broadcasting.
        for (let j = pickups.length - 1; j >= 0; j--) {
            const pu = pickups[j];
            if (!rectIntersect(p.x, p.y, p.size, p.size, pu.x, pu.y, pu.size, pu.size)) continue;
            pickups.splice(j, 1);
            localEvent(SND_PICKUP, pu.x, pu.y);
            const ms = pu.type === "overclock" ? 6000 : 0;
            applyTeamPickup(pu.type, ms, now, true);
        }

        // Downed players cannot interact, and cannot shoot -- unless they
        // hold LAST STAND, which is the whole of that perk.
        let fireKey = currentWeaponKey(p);
        if (p.downed) {
            if (netIsHost && p.bleedDeadline && now >= p.bleedDeadline) {
                sendDeath(netIdFor(p));
                killLocalPlayer(p);
                continue;
            }
            fireKey = downedWeaponKey(p);
            if (!fireKey) continue;
        }

        // Shooting
        const w = WEAPONS[fireKey];
        let cooldown = (now < p.overclockUntil) ? Math.max(60, w.cooldown * 0.2) : w.cooldown;
        // CARD: OVERDRIVE, per stack.
        const od = cardLevel(p, "overdrive");
        if (od) cooldown *= [1, 0.65, 0.5, 0.4][od];
        if (p.keys.shoot && now - p.lastShotTime > cooldown) {
            shoot(p, now, fireKey);
            p.lastShotTime = now;
        }
    }
}

// SALVAGE, on every client for its own player. Kills are resolved by the
// host, so a guest learns its count from the scoreboard in the snapshot
// (`sb`) and a host reads its own live -- either way the delta since the
// last look is how many kills to roll for.
function updateSalvage() {
    const me = players[0];
    const row = scoreBoard[netIdFor(me)];
    const seen = row ? row.kills : 0;
    if (seen < salvageKillsSeen) salvageKillsSeen = seen;       // a reset
    const fresh = seen - salvageKillsSeen;
    salvageKillsSeen = seen;
    if (!me || fresh <= 0) return;
    const lvl = cardLevel(me, "salvage");
    if (!lvl) return;
    const key = currentWeaponKey(me);
    const w = WEAPONS[key];
    if (w.infinite) return;
    const chance = [0, 0.3, 0.45, 0.6][lvl] * (w.salvage || 0);
    for (let i = 0; i < fresh; i++) {
        if (Math.random() < chance) me.ammo[key] = (me.ammo[key] || 0) + (w.salvageAmt || 1);
    }
}

// Remote bullets arrive at 15Hz. Carrying them along their velocity in
// between is what stops a teammate's flame or rocket crossing the screen in
// visible jumps; each snapshot replaces the list, so the drift never grows.
function advanceRemoteBullets() {
    for (let i = 0; i < remoteBullets.length; i++) {
        const b = remoteBullets[i];
        b.x += b.vx;
        b.y += b.vy;
        if (b.kind === "flamer") b.travelled = (b.travelled || 0) + Math.hypot(b.vx, b.vy);
    }
}

function updateBullets(now) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        const kind = b.kind || "pistol";
        b.x += b.vx;
        b.y += b.vy;
        b.travelled += Math.hypot(b.vx, b.vy);

        if (b.travelled > b.range || b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) {
            // A rocket at the end of its run goes off where it is.
            if (kind === "rocket") rocketBurst(b, now);
            bullets.splice(i, 1);
            continue;
        }
        // Bullets use the ZOMBIE solid set: a broken window stops being
        // cover for either side, so shooting through one you've let open
        // is a real consequence of losing it.
        //
        // bulletBlockedAt, not blockedAt (2026-09-19): that set minus the
        // planks a barricade has already lost, so you can shoot into the
        // gap a zombie is chewing without having to lose the whole window
        // first. See zombie-level.js. ALL FOUR tests below use it -- the
        // two ricochet probes included, or a round would bounce off a hole
        // it should have flown straight through.
        if (bulletBlockedAt(b.x, b.y, b.size) && kind === "rocket") {
            // Back out of the wall first, so the blast is on the near side.
            b.x -= b.vx;
            b.y -= b.vy;
            rocketBurst(b, now);
            bullets.splice(i, 1);
            continue;
        }
        if (bulletBlockedAt(b.x, b.y, b.size)) {
            // CARD: RICOCHET. Step back out of the wall, then reflect off
            // whichever axis actually blocked us.
            if (b.bounces > 0) {
                b.x -= b.vx;
                b.y -= b.vy;
                const hitX = bulletBlockedAt(b.x + b.vx, b.y, b.size);
                const hitY = bulletBlockedAt(b.x, b.y + b.vy, b.size);
                if (hitX) b.vx = -b.vx;
                if (hitY) b.vy = -b.vy;
                if (!hitX && !hitY) { b.vx = -b.vx; b.vy = -b.vy; }
                b.bounces--;
            } else {
                bullets.splice(i, 1);
                continue;
            }
        }

        // Barrels are hit by anyone -- the explosion itself is
        // host-resolved, so a client just loses the bullet.
        let hitBarrel = false;
        for (let j = 0; j < barrels.length; j++) {
            const br = barrels[j];
            if (!br.alive) continue;
            if (rectIntersect(b.x, b.y, b.size, b.size, br.x, br.y, br.size, br.size)) {
                if (netIsHost) explodeBarrel(j, b.owner, now);
                hitBarrel = true;
                break;
            }
        }
        if (hitBarrel) {
            if (kind === "rocket") rocketBurst(b, now);
            bullets.splice(i, 1);
            continue;
        }

        // Damage is HOST ONLY. A client runs bullets purely as a visual
        // prediction of its own shots; letting it also decide what died
        // would have two clients disagreeing within seconds.
        //
        // What a client CAN do is stop its round where it visibly hit
        // (2026-09-18): a guest's shots used to sail straight through the
        // zombie they struck and die on the wall behind it. A rocket also
        // goes off right there, locally, and the host's blast event carries
        // this client as its owner so it is not drawn a second time.
        if (!netIsHost) {
            if (kind === "flamer") continue;           // flame pierces everything anyway
            for (let j = 0; j < zombies.length; j++) {
                const z = zombies[j];
                if (!rectIntersect(b.x, b.y, b.size, b.size, z.x, z.y, z.size, z.size)) continue;
                if (kind === "rocket") rocketBurst(b, now);
                if (kind === "rocket" || b.pierce <= 0 || ZOMBIE_TYPES[z.type].armored) bullets.splice(i, 1);
                break;
            }
            continue;
        }

        // hitZ holds zombie OBJECTS, not indices. It held indices, which
        // shift whenever anything dies -- harmless for a sniper's four,
        // not for a flame that pierces everything in the cone.
        if (!b.hitZ) b.hitZ = [];
        let consumed = false;
        for (let j = zombies.length - 1; j >= 0; j--) {
            const z = zombies[j];
            if (!z || b.hitZ.indexOf(z) !== -1) continue;
            if (!rectIntersect(b.x, b.y, b.size, b.size, z.x, z.y, z.size, z.size)) continue;
            b.hitZ.push(z);

            if (kind === "flamer") {
                // Every zombie in the cone, once per flame, and it burns.
                const burn = WEAPONS.flamer.burn;
                z.burnUntil = now + burn.ms;
                z.burnBy = b.owner;
                damageZombie(j, b.dmg, b.owner, now, "flame", b.vx, b.vy);
                continue;
            }

            damageZombie(j, b.dmg, b.owner, now, kind === "rocket" ? "rocket" : "shot", b.vx, b.vy);

            if (kind === "rocket") {
                rocketBurst(b, now);
                consumed = true;
            } else if (b.pierce > 0 && !ZOMBIE_TYPES[z.type].armored) {
                // The ULTRA HEAVY is `armored`: nothing pierces THROUGH it.
                b.pierce--;
            } else {
                consumed = true;
            }
            break;
        }
        if (consumed) bullets.splice(i, 1);
    }
}

// A rocket goes off. On the host that is the real explosion; on a guest
// it is the shooter's own prediction -- drawn and heard at once, with the
// host's copy of the event skipped as an echo (it carries this client's id).
function rocketBurst(b, now) {
    const cx = b.x + b.size / 2;
    const cy = b.y + b.size / 2;
    const sp = WEAPONS.rocket.splash;
    if (netIsHost) {
        explodeAt(cx, cy, sp.r, sp.dmg, b.owner, now, "rocket");
    } else {
        addBlast(cx, cy, sp.r);
        playEvent(SND_EXPLODE, cx, cy, sp.r);
        shakeNear(cx, cy, 12);
    }
}

// Screen shake for something that happened at (x, y): full within a
// screen, nothing past two. A blast across the map used to shake you too.
function shakeNear(x, y, amount) {
    const me = players[0];
    if (!me) { addShake(amount * 0.5); return; }
    const d = Math.hypot(x - me.x, y - me.y);
    if (d < 520) addShake(amount);
    else if (d < 1040) addShake(amount * (1 - (d - 520) / 520));
}

// HOST. One explosion with falloff (full at the centre, half at the rim),
// and anything else that can blow up inside it does. Used by rockets.
function explodeAt(x, y, radius, dmg, ownerId, now, src) {
    addBlast(x, y, radius);
    shakeNear(x, y, 12);
    hostEvent(SND_EXPLODE, x, y, radius, ownerId);
    const hit = [];
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        const d = Math.hypot(z.x + z.size / 2 - x, z.y + z.size / 2 - y);
        if (d < radius) hit.push({ z: z, dmg: dmg * (1 - 0.5 * d / radius) });
    }
    for (let k = 0; k < hit.length; k++) {
        const idx = zombies.indexOf(hit[k].z);
        if (idx !== -1) damageZombie(idx, hit[k].dmg, ownerId, now, src);
    }
    for (let j = 0; j < barrels.length; j++) {
        const br = barrels[j];
        if (!br.alive) continue;
        if (Math.hypot(br.x + br.size / 2 - x, br.y + br.size / 2 - y) < radius) {
            const bj = j;
            trackTimeout(function () { explodeBarrel(bj, ownerId, Date.now()); }, 90);
        }
    }
}

// `src` says what did the damage, because two things depend on it:
//   - FLASH: burn and flame do not flash the zombie white. They tick every
//     frame, and a burning zombie read as permanently white.
//   - PROCS: only a kill by a WEAPON (shot, rocket, flame, burn) can set
//     off ARC or BLASTCAP. A kill by an arc, a burst, a barrel, a trap or
//     SPITE cannot, so one kill cannot cascade through a whole horde.
const PROC_SOURCES = { shot: true, rocket: true, flame: true, burn: true };

// ---------------------------------------------------
//   THE SUPER SPLITTER  (2026-09-20)
// ---------------------------------------------------
// It replaced the ULTRA HEAVY, and where that was a wall of HP this is a
// thing that comes apart in your hands. Three behaviours, all host-side
// because the host owns every zombie:
//
//   shedFromSuper   every damaging shot -> a spawnling; every
//                   SUPER_SPLIT_STEP of cumulative damage -> a splitter
//   superBurst      death -> SUPER_BURST ultra spawnlings in a FAN, aimed
//                   along the killing shot
//   updateZombieLaunch  those spawnlings FLY, land, and only then chase
//
// The fan is the only thing on this map that is not pathing the moment it
// exists, which is why it needs its own update and its own wire field.

// A shot landed and it survived. Shed.
//
// BOTH RATES ARE SCALED, and measured rather than guessed. The first
// version shed one spawnling per shot and one splitter per 8 raw damage,
// which at round 16 -- where zombieHpMultiplier puts this thing at 90 HP --
// produced 29 spawnlings and 11 splitters from a single kill. That is not
// a fight, it is a screen wipe.
//
//   - THE SPLITTER STEP SCALES WITH THE HP MULTIPLIER, so it is always
//     about three splitters on the way down whatever the round is. The
//     round already makes it take longer to kill; it should not also
//     multiply what killing it costs you.
//   - THE SPAWNLING IS THROTTLED. "A spawnling on each shot of damage" is
//     the brief, and it holds for every gun a player aims -- but an SMG at
//     an 85ms cooldown would shed twelve a second, and flame ticks faster
//     still. SUPER_SHED_MS is slower than every gun except the SMG and the
//     flamethrower, which are exactly the two that would fountain.
const SUPER_SHED_MS = 150;

function shedFromSuper(z, now) {
    // The throttle widens with the HP multiplier, at half its rate. Without
    // that, a thing that takes 50 shots at round 26 sheds 49 spawnlings
    // where the same fight at round 16 shed 29 -- the swarm would grow with
    // the round on top of everything else that already does. Measured
    // across rifle / SMG / sniper at rounds 16 and 26, this holds it at
    // 15-16 whatever you are shooting it with.
    //
    // 15-16 IS THE NUMBER TO TUNE BY FEEL. It is high enough that emptying
    // a magazine into this thing is visibly a bad idea, which is the point
    // of it, and low enough not to be a screen wipe.
    const hpMult = zombieHpMultiplier(round);
    const throttle = SUPER_SHED_MS * (1 + (hpMult - 1) * 0.5);
    if (!z.lastShed || now - z.lastShed >= throttle) {
        z.lastShed = now;
        const sl = spawnZombie("spawnling", round);
        if (sl) placeShed(sl, z, 46);
    }

    // Cumulative damage, not per-shot: a sniper doing 14 in one hit should
    // drop as much as two rifle rounds doing 7 each.
    z.shedAt = (z.shedAt || 0);
    const spec = ZOMBIE_TYPES.supersplit;
    const mult = zombieHpMultiplier(round);
    const step = SUPER_SPLIT_STEP * mult;
    const taken = (spec.hp * mult) - z.hp;
    while (taken - z.shedAt >= step) {
        z.shedAt += step;
        const sp = spawnZombie("splitter", round);
        if (sp) placeShed(sp, z, 70);
        hostEvent(SND_SPLIT, z.x, z.y);
    }
}

// Put a shed piece beside the parent, on ground it can actually stand on.
function placeShed(child, parent, spread) {
    for (let tries = 0; tries < 10; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = parent.size * 0.6 + Math.random() * spread;
        const x = clamp(parent.x + Math.cos(a) * r, 0, WORLD_W - child.size);
        const y = clamp(parent.y + Math.sin(a) * r, 0, WORLD_H - child.size);
        if (blockedAt(x, y, child.size, true)) continue;
        child.x = x;
        child.y = y;
        return;
    }
    child.x = parent.x;
    child.y = parent.y;
}

// THE DEATH FAN. SUPER_BURST ultra spawnlings thrown along the direction
// the killing shot was travelling, spread over SUPER_FAN radians, each
// flying for SUPER_FLIGHT_MS before it lands and starts chasing.
//
// `z.lastHitVx/Vy` is set by damageZombie from the round that hit it -- a
// fan that always pointed the same way would be a firework, and the whole
// idea is that where you stand when you kill it decides where the pieces
// go.
function superBurst(z, cx, cy, now) {
    let ax = z.lastHitVx || 0;
    let ay = z.lastHitVy || 0;
    if (!ax && !ay) { ax = 0; ay = 1; }                 // killed by burn or a trap
    const base = Math.atan2(ay, ax);

    for (let i = 0; i < SUPER_BURST; i++) {
        const sl = spawnZombieAt("uspawn", round, cx, cy);
        if (!sl) continue;
        // Spread across the fan, with a little jitter so it is not a
        // perfect arc of evenly spaced dots.
        const t = SUPER_BURST > 1 ? (i / (SUPER_BURST - 1)) - 0.5 : 0;
        const a = base + t * SUPER_FAN + (Math.random() - 0.5) * 0.12;
        const speed = 5.4 + Math.random() * 3.2;
        sl.x = clamp(cx - sl.size / 2, 0, WORLD_W - sl.size);
        sl.y = clamp(cy - sl.size / 2, 0, WORLD_H - sl.size);
        sl.lvx = Math.cos(a) * speed;
        sl.lvy = Math.sin(a) * speed;
        // Staggered landings, so they do not all switch to chasing on the
        // same frame and arrive as one wall.
        sl.launchUntil = now + SUPER_FLIGHT_MS * (0.7 + Math.random() * 0.6);
    }
}

// IN FLIGHT. Returns true if this zombie is still flying, in which case
// updateZombies must not path it.
//
// It moves with collision but does NOT clamp to the world, the same as a
// zombie walking in from off-map -- and it stops dead on a wall rather
// than sliding along one, because a thing thrown at a container should hit
// the container.
function updateZombieLaunch(z, now, dt) {
    if (!z.launchUntil) return false;
    if (now >= z.launchUntil) {
        z.launchUntil = 0;
        z.lvx = 0;
        z.lvy = 0;
        return false;
    }
    const step = dt / 16.67;
    const nx = z.x + z.lvx * step;
    const ny = z.y + z.lvy * step;
    if (blockedAt(nx, z.y, z.size, true)) { z.lvx = 0; }
    else z.x = nx;
    if (blockedAt(z.x, ny, z.size, true)) { z.lvy = 0; }
    else z.y = ny;
    // Drag, so it settles rather than stopping like a switch.
    z.lvx *= 0.965;
    z.lvy *= 0.965;
    if (Math.abs(z.lvx) < 0.25 && Math.abs(z.lvy) < 0.25) {
        z.launchUntil = 0;
        z.lvx = 0;
        z.lvy = 0;
        return false;
    }
    return true;
}

function damageZombie(index, dmg, ownerId, now, src, hitVx, hitVy) {
    const z = zombies[index];
    if (!z) return;
    z.hp -= dmg;
    // Which way the shot that hit it was travelling, so superBurst can aim
    // the death fan along it. Set on every hit rather than only the last,
    // because the last hit is the one that kills and that is exactly the
    // one whose direction matters.
    if (hitVx !== undefined) { z.lastHitVx = hitVx; z.lastHitVy = hitVy; }
    if (!z.damagers) z.damagers = [];
    if (ownerId && z.damagers.indexOf(ownerId) === -1) z.damagers.push(ownerId);

    if (z.hp > 0) {
        if (src !== "burn" && src !== "flame") z.flashUntil = now + 50;
        // THE SUPER SPLITTER COMES APART AS YOU SHOOT IT (2026-09-20).
        // Every shot sheds a spawnling, and every SUPER_SPLIT_STEP of
        // damage drops a full splitter. Burn ticks do NOT count as shots --
        // flame does damage many times a second and would turn one
        // flamethrower into an endless spawnling fountain.
        if (z.type === "supersplit" && src !== "burn") {
            shedFromSuper(z, now);
        }
        return;
    }

    const spec = ZOMBIE_TYPES[z.type];
    zombies.splice(index, 1);
    kills++;
    const zcx = z.x + z.size / 2;
    const zcy = z.y + z.size / 2;
    if (z.type === "supersplit") {
        hostEvent(SND_ULTRA, zcx, zcy, 1);
        addBlast(zcx, zcy, 70);
        superBurst(z, zcx, zcy, now);
    }
    // Only kills ON an active funnel drain into a silo. Everything else
    // in the game rewards killing zombies wherever they are; this is the
    // one system that asks you to fight in a chosen place.
    creditFunnelKill(z.x + z.size / 2, z.y + z.size / 2);
    hostEvent(SND_KILL, z.x, z.y, Z_TYPE_KEYS.indexOf(z.type));

    // IDEA 6: kills near a teammate are worth more. A quiet, always-on
    // nudge to fight as a unit instead of drifting to opposite corners.
    const bonus = nearTeammate(z.x, z.y) ? 1.5 : 1;
    // CARD: SCAVENGER, per stack.
    //
    // No round multiplier here, deliberately. Income already scales twice
    // over -- zombie count per round, and the rising share of high-value
    // brutes -- and a third multiplier made round 20 pay 48k against an
    // 87k cost to max every card, so the whole card economy solved itself
    // in a single round.
    // ROLE: GUNNER hits harder -- applied at the damage site rather than
    // on the bullet, so it also covers ricochets and barrel chains.
    const greed = 1 + 0.6 * idCardLevel(ownerId, "scavenger");
    scrapPool += Math.round(spec.scrap * bonus * greed);
    creditScore(ownerId, "kills", 1, Math.round(spec.score * SCORE_KILL_MULT * bonus));

    // Assists to anyone who damaged it but didn't land the kill.
    for (let i = 0; i < z.damagers.length; i++) {
        if (z.damagers[i] !== ownerId) creditScore(z.damagers[i], "assists", 1, SCORE_ASSIST);
    }

    // IDEA 13: splitters burst into fast spawnlings, punishing anyone
    // who killed it at point-blank range with a shotgun.
    if (z.type === "splitter") {
        hostEvent(SND_SPLIT, z.x, z.y);
        for (let s = 0; s < 3; s++) {
            const sl = spawnZombie("spawnling", round);
            if (sl) {
                sl.x = clamp(z.x + (Math.random() - 0.5) * 60, 0, WORLD_W - sl.size);
                sl.y = clamp(z.y + (Math.random() - 0.5) * 60, 0, WORLD_H - sl.size);
            }
        }
    }

    if (ownerId && PROC_SOURCES[src]) {
        // PERK: ARC -- a bolt to the nearest few.
        const arc = idCardLevel(ownerId, "arc");
        if (arc) arcFrom(zcx, zcy, arc, ownerId, now);
        // PERK: BLASTCAP -- sometimes the body goes off.
        const cap = idCardLevel(ownerId, "blastcap");
        if (cap && Math.random() < [0, 0.18, 0.28, 0.38][cap]) {
            burstAt(zcx, zcy, 95, 4 * zombieHpMultiplier(round), ownerId, now);
        }
    }
}

// PERK: ARC. Bolt damage grows with the round the same way zombie HP does,
// so it kills a walker on round 30 as surely as on round 3. Targets are
// gathered first and hit by identity: each hit can kill, and a kill
// shifts every index after it.
const ARC_RANGE = 180;

function arcFrom(x, y, count, ownerId, now) {
    const near = [];
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        const d = Math.hypot(z.x + z.size / 2 - x, z.y + z.size / 2 - y);
        if (d < ARC_RANGE) near.push({ z: z, d: d });
    }
    near.sort(function (a, b) { return a.d - b.d; });
    const dmg = 2.5 * zombieHpMultiplier(round);
    for (let k = 0; k < near.length && k < count; k++) {
        const t = near[k].z;
        const tx = t.x + t.size / 2, ty = t.y + t.size / 2;
        addBolt(x, y, tx, ty);
        // The target rides in `arg`, packed as a 10-bit offset pair, so a
        // client can draw the same bolt from a single event.
        const dx = clamp(Math.round(tx - x), -511, 511) + 512;
        const dy = clamp(Math.round(ty - y), -511, 511) + 512;
        hostEvent(SND_ARC, x, y, dx * 1024 + dy);
        const idx = zombies.indexOf(t);
        if (idx !== -1) damageZombie(idx, dmg, ownerId, now, "arc");
    }
}

function addBolt(x1, y1, x2, y2) {
    bolts.push({ x1: x1, y1: y1, x2: x2, y2: y2, born: Date.now(), seed: (x1 * 7 + y2 * 13) | 0 });
    if (bolts.length > 40) bolts.shift();
}

// PERK: BLASTCAP. A small burst; its kills never set off another.
function burstAt(x, y, radius, dmg, ownerId, now) {
    addBlast(x, y, radius);
    hostEvent(SND_POP, x, y, radius);
    const hit = [];
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        if (Math.hypot(z.x + z.size / 2 - x, z.y + z.size / 2 - y) < radius) hit.push(z);
    }
    for (let k = 0; k < hit.length; k++) {
        const idx = zombies.indexOf(hit[k]);
        if (idx !== -1) damageZombie(idx, dmg, ownerId, now, "blast");
    }
}

function nearTeammate(x, y) {
    let n = 0;
    for (let i = 0; i < players.length; i++) {
        if (dist(x, y, players[i].x, players[i].y) < 150) n++;
    }
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        if (dist(x, y, remotePlayers[id].x, remotePlayers[id].y) < 150) n++;
    }
    return n >= 2;
}

function explodeBarrel(index, ownerId, now) {
    const br = barrels[index];
    if (!br || !br.alive) return;
    br.alive = false;
    shakeNear(br.x, br.y, 14);
    addBlast(br.x + br.size / 2, br.y + br.size / 2, 190);
    hostEvent(SND_EXPLODE, br.x, br.y, 190);
    hostEvent(SND_EXPLODE, br.x, br.y, 190);

    for (let i = zombies.length - 1; i >= 0; i--) {
        const z = zombies[i];
        if (!z) continue;
        if (dist(br.x, br.y, z.x, z.y) < 190) damageZombie(i, 12, ownerId, now, "barrel");
    }
    // Chain reaction.
    for (let i = 0; i < barrels.length; i++) {
        if (i === index || !barrels[i].alive) continue;
        if (dist(br.x, br.y, barrels[i].x, barrels[i].y) < 170) {
            const j = i;
            trackTimeout(function () { explodeBarrel(j, ownerId, Date.now()); }, 120);
        }
    }
}

// ---------------------------------------------------
//   ZOMBIE AI (host only)
// ---------------------------------------------------
function allTargets() {
    const out = [];
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        out.push({ x: p.x, y: p.y, size: p.size, ref: p, local: true, id: netIdFor(p), downed: p.downed });
    }
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        // AWAY (2026-09-19): a teammate whose messages have stopped is not a
        // target. Zombies do not chase or maul the spot they froze on, they
        // cannot revive or be revived, and nothing counts them as present.
        if (r.away) continue;
        out.push({ x: r.x, y: r.y, size: r.size || 16, ref: r, local: false, id: id, downed: !!r.downed });
    }
    return out;
}

// IDEA 14: the most isolated player is the one furthest from any
// teammate. A quarter of zombies hunt them specifically, which is the
// mechanical enforcement of "don't split up".
function mostIsolated(targets) {
    let best = null;
    let bestDist = -1;
    for (let i = 0; i < targets.length; i++) {
        let nearest = Infinity;
        for (let j = 0; j < targets.length; j++) {
            if (i === j) continue;
            const d = dist(targets[i].x, targets[i].y, targets[j].x, targets[j].y);
            if (d < nearest) nearest = d;
        }
        if (nearest === Infinity) nearest = 0;
        if (nearest > bestDist) { bestDist = nearest; best = targets[i]; }
    }
    return best;
}

// Flow fields, refreshed on a timer rather than per frame -- players
// move a few px between rebuilds, and a BFS over 120x68 cells is far too
// cheap to bother caching more cleverly than this.
let navFieldAll = null;
let navFieldIsolated = null;
let navFieldDecoy = null;      // PERK: DECOY -- a field flowing to the live lures
let navFieldAt = 0;
const NAV_REFRESH_MS = 220;

// PERK: DECOY (replaced BEACON 2026-09-18). A ping from a player holding it
// becomes a lure: zombies within its radius path to the marker instead of
// to a player, until it expires. HOST only -- the host alone steers zombies
// -- and it rides the ping message, which now carries the pinger's id.
// Recharge-gated, or holding Q would pin the horde in place for good.
const DECOY_RADIUS = [0, 320, 400, 480];
const DECOY_MS = [0, 4000, 5000, 6000];
const DECOY_RECHARGE_MS = [0, 12000, 10000, 8000];

function registerDecoy(id, x, y, now) {
    const lvl = idCardLevel(id, "decoy");
    if (!lvl || now < (decoyReadyAt[id] || 0)) return false;
    decoys.push({ x: x, y: y, r: DECOY_RADIUS[lvl], until: now + DECOY_MS[lvl] });
    decoyReadyAt[id] = now + DECOY_RECHARGE_MS[lvl];
    hostEvent(SND_DECOY, x, y);
    navFieldAt = 0;            // re-path now, not on the next refresh
    return true;
}

function lureFor(zcx, zcy) {
    for (let i = 0; i < decoys.length; i++) {
        const d = decoys[i];
        if (Math.hypot(zcx - d.x, zcy - d.y) < d.r) return d;
    }
    return null;
}

// Escape hatch for a zombie the local steering cannot free. Re-placed
// exactly where a fresh spawn would go, so the spot is always legal,
// never on screen, and never inside the sealed sluice. If even that
// fails the zombie is removed: a permanently wedged zombie is worse than
// a missing one, because a round only clears when the map is empty and
// one stuck brute stalls the game forever.
//
// 2026-09-07: this used to read SPAWN_RING_MIN / SPAWN_RING_MAX, NEITHER
// OF WHICH EXISTS ANYWHERE IN THE REPO. Every call threw a
// ReferenceError out of updateZombies, which killed the rest of update()
// on the host -- revives, traps, and critically broadcastPlayers and
// broadcastWorld. gameLoop re-arms its rAF first, so the host kept
// drawing and looked alive while every other client froze, and because
// the throw landed before `z.stuck = 0` it repeated every frame forever.
// One wedged brute ended the session for the whole room. Reusing
// pickSpawnPoint removes the phantom constants rather than inventing
// values for them, and inherits the visibility and sluice rules for
// free.
function relocateZombie(z) {
    for (let tries = 0; tries < 8; tries++) {
        const spot = pickSpawnPoint(z.size);
        if (!spot || blockedAt(spot.x, spot.y, z.size, true)) continue;
        z.x = spot.x;
        z.y = spot.y;
        // It may have been dropped back outside the map, which is a legal
        // spawn state -- so the leash has to re-arm, or the clamp would
        // immediately drag it onto the edge it was just freed from.
        z.entered = false;
        z.progAt = 0;
        z.noProgress = 0;
        return true;
    }
    const idx = zombies.indexOf(z);
    if (idx !== -1) zombies.splice(idx, 1);
    return false;
}

// How long a zombie gets to prove it is actually getting somewhere.
const PROGRESS_WINDOW_MS = 800;
// Consecutive dead windows before we stop trying to steer it out and just
// re-place it. ~3.2s of travelling nowhere.
const PROGRESS_FAILS_TO_RELOCATE = 4;

function updateZombies(now, dt) {
    const targets = allTargets();
    if (!targets.length) return;
    const isolated = targets.length > 1 ? mostIsolated(targets) : null;
    // x1.28 while intensified. Applied HERE rather than written into the
    // zombie at spawn, so throwing the switch speeds up everything already
    // on the map at that instant, not only what comes afterwards.
    const baseSpeed = zombieSpeedForRound(round) * intensifySpeedMult();

    for (let d = decoys.length - 1; d >= 0; d--) if (now >= decoys[d].until) decoys.splice(d, 1);

    if (!navFieldAll || now - navFieldAt > NAV_REFRESH_MS || navDirty) {
        navFieldAll = navFieldFrom(targets.map(function (t) {
            return { x: t.x + (t.size || 16) / 2, y: t.y + (t.size || 16) / 2 };
        }));
        navFieldIsolated = isolated
            ? navFieldFrom([{ x: isolated.x + (isolated.size || 16) / 2, y: isolated.y + (isolated.size || 16) / 2 }])
            : null;
        navFieldDecoy = decoys.length ? navFieldFrom(decoys) : null;
        navFieldAt = now;
    }

    for (let i = zombies.length - 1; i >= 0; i--) {
        const z = zombies[i];
        // A kill can now take OTHER zombies with it (ARC, BLASTCAP, a burn
        // death that sets one off), so the slot this loop is about to read
        // may already be gone.
        if (!z) continue;
        const spec = ZOMBIE_TYPES[z.type];

        // IN FLIGHT: an ultra spawnling thrown by a SUPER SPLITTER flies a
        // fan before it chases anything. Checked FIRST and `continue`s --
        // it must not path, chew, scream or be steered while it is in the
        // air, and it is also exempt from the stuck watchdog for the same
        // reason chewing is: travelling nowhere is the point.
        if (updateZombieLaunch(z, now, dt)) {
            z.stuck = 0;
            z.noProgress = 0;
            continue;
        }

        // FLAMETHROWER: burning is damage over time, credited to whoever lit
        // it. Checked by identity afterwards -- it may have died of it.
        if (z.burnUntil && now < z.burnUntil) {
            damageZombie(i, WEAPONS.flamer.burn.dps * (dt / 1000), z.burnBy, now, "burn");
            if (zombies[i] !== z) continue;
        }

        // IDEA 12: screamers summon until killed, making them the
        // priority target the team has to name out loud.
        if (z.type === "screamer" && now > z.nextScream) {
            z.nextScream = now + 4000;
            hostEvent(SND_SCREAM, z.x, z.y);
            if (zombies.length < 320) {
                spawnZombie("walker", round);
                spawnZombie("walker", round);
            }
        }

        let target = null;
        if (z.isolationSeeker && isolated) {
            target = isolated;
        } else {
            let minD = Infinity;
            for (let t = 0; t < targets.length; t++) {
                const d = dist(targets[t].x, targets[t].y, z.x, z.y);
                if (d < minD) { minD = d; target = targets[t]; }
            }
        }
        if (!target) continue;

        // Steer along the flow field rather than straight at the player.
        // The field already routes around buildings and through the
        // boarded windows that link zones, so there is no stuck state to
        // recover from and no zone-waypoint special case.
        const zcx = z.x + z.size / 2;
        const zcy = z.y + z.size / 2;
        // PERK: DECOY. A zombie inside a live lure follows the lure's field
        // instead. `target` stays the player: contact below is still tested
        // against a real player, so a lured zombie walking through you still
        // downs you.
        const lure = navFieldDecoy ? lureFor(zcx, zcy) : null;
        const field = lure ? navFieldDecoy
                    : (z.isolationSeeker && navFieldIsolated) ? navFieldIsolated : navFieldAll;
        const step = navStepToward(zcx, zcy, field);

        // CENTRE SPACE ON BOTH SIDES. navStepToward is handed a centre and
        // returns a nav-cell CENTRE, but this used to subtract z.x -- the
        // TOP-LEFT CORNER -- so every zombie steered with a constant bias
        // of half its own body toward +x/+y. It aimed its corner where its
        // centre should go, and the body rode high and left of the path it
        // had been given.
        //
        // The bias scales exactly with size: brute 13px, splitter 12,
        // screamer 10, against walker 8, runner 6, spawnling 4.5 -- which
        // is why the big three clipped the edge of every window and the
        // small ones never did. For a goal 100px dead right a brute
        // steered 6.6 degrees downward while already sitting 13px off the
        // sampled line, eating ~25px of the 43px of clearance a 112px
        // window gives it. `target` is a player, whose x is also a corner,
        // so the straight-line fallback needed the same treatment.
        const goalX = step ? step.x : (lure ? lure.x : target.x + (target.size || 16) / 2);
        const goalY = step ? step.y : (lure ? lure.y : target.y + (target.size || 16) / 2);

        const dx = goalX - zcx;
        const dy = goalY - zcy;
        const d = Math.hypot(dx, dy);
        if (d > 0) {
            const speed = (baseSpeed + z.speedOffset) * z.speedMult;
            const direct = Math.atan2(dy, dx);

            // CHEWING comes before steering. A boarded window is the way
            // in, not an obstacle to route around, so a zombie pressed
            // against one attacks it instead of sliding along it. Without
            // this ordering the wall-following below happily slides the
            // whole horde straight past every window and nothing is ever
            // breached.
            let chewing = null;
            for (let bi = 0; bi < barricades.length; bi++) {
                const b = barricades[bi];
                if (b.hp <= 0) continue;
                if (!rectIntersect(z.x - 8, z.y - 8, z.size + 16, z.size + 16, b.x, b.y, b.w, b.h)) continue;
                // Only if it's roughly in front -- brushing past a window
                // on the way somewhere else shouldn't stop the zombie.
                const toB = Math.atan2(
                    (b.y + b.h / 2) - (z.y + z.size / 2),
                    (b.x + b.w / 2) - (z.x + z.size / 2)
                );
                const off = Math.abs(((toB - direct + Math.PI * 3) % (Math.PI * 2)) - Math.PI);
                if (off < Math.PI / 2) { chewing = b; break; }
            }

            let ang = direct;
            if (chewing) {
                chewing.hp -= spec.dmgToBarricade * (dt / 1000) * 3;
                // Drives the sustained splintering loop (idea 41). A
                // timestamp rather than a flag, so it decays on its own
                // when the zombie dies or wanders off.
                chewing.chewUntil = now + 300;
                if (chewing.hp <= 0) {
                    chewing.hp = 0;
                    chewing.chewUntil = 0;
                    rebuildSolidIndex();
                    hostEvent(SND_BREACH, chewing.x + chewing.w / 2, chewing.y + chewing.h / 2);
                }
                // Keep pushing straight at it; never slide off a window.
                z.stuck = 0;
                z.slideHold = 0;
            } else if (z.stuck > 240) {
                // LAST RESORT, and it must come BEFORE the slideHold
                // branch -- slideHold re-arms every 30 frames, so checking
                // it first meant this escape was never reachable at all.
                //
                // Wall-following is a heuristic and heuristics have
                // failure cases: measured across 20 layouts, ~6% of
                // zombies crossing the whole map ended up wedged in a
                // corner the slide could not walk out of. That is not
                // cosmetic -- a round only clears when the map is empty,
                // so one pinned walker stalls the game forever.
                //
                // Re-placed on the normal spawn ring rather than nudged a
                // cell: a one-cell hop just drops it back in the same
                // wedge and buys that wedge another four seconds.
                relocateZombie(z);
                z.stuck = 0;
                z.slideDir = 0;
                z.slideHold = 0;
                z.slideAttempts = 0;
            } else if (z.slideHold > 0) {
                // Sliding is COMMITTED for a fixed number of frames.
                // Easing it off the moment the zombie moves again turned
                // it straight back into the obstruction, so it oscillated
                // in place instead of getting round.
                z.slideHold--;
                ang += z.slideDir * (Math.PI / 2);
            } else if (z.stuck > 4) {
                // Caught on a building corner or the wall beside a
                // window. Veer perpendicular and follow it; every fourth
                // failed attempt, try the other way.
                z.slideAttempts = (z.slideAttempts || 0) + 1;
                if (!z.slideDir || z.slideAttempts % 4 === 0) {
                    z.slideDir = z.slideDir ? -z.slideDir : (Math.random() < 0.5 ? 1 : -1);
                }
                z.slideHold = 30;
                ang += z.slideDir * (Math.PI / 2);
            }

            const beforeX = z.x;
            const beforeY = z.y;
            // ONE-WAY LEASH. There is no perimeter wall -- buildZoneWalls
            // only emits the interior boundaries -- and zombies move with
            // clampToWorld false so they can spawn off-map and walk in.
            // Nothing stopped them walking back OUT, and a zombie ejected
            // past the edge is off camera, unshootable, and holds the
            // round open forever, because a round only clears on an empty
            // map. So: free movement until the body is fully inside once,
            // then clamped for the rest of its life.
            if (!z.entered &&
                z.x >= 0 && z.y >= 0 &&
                z.x + z.size <= WORLD_W && z.y + z.size <= WORLD_H) {
                z.entered = true;
            }
            moveWithCollisions(z, Math.cos(ang) * speed, Math.sin(ang) * speed, !!z.entered, true);

            const moved = Math.hypot(z.x - beforeX, z.y - beforeY);
            if (moved >= speed * 0.34) {
                z.stuck = 0;
                if (z.slideHold <= 0) z.slideAttempts = 0;
            } else if (!chewing) {
                z.stuck = (z.stuck || 0) + 1;
            }

            // PROGRESS watchdog, separate from the per-frame stuck count.
            // A zombie oscillating between two nav cells moves every
            // frame -- so `moved` never trips -- while travelling
            // nowhere. Only a position sampled over time catches that.
            // Chewing is exempt: standing still on a barricade is the
            // whole point of chewing.
            // ON TARGET is exempt for the same reason chewing is: a zombie
            // pressed against the player it is mauling makes no progress BY
            // DESIGN, and it is doing exactly what it should. Without this a
            // packed swarm reads as a crowd of stuck zombies and the watchdog
            // teleports them off the player one at a time -- measured at 438
            // relocations in 38 simulated seconds, nearly all of them zombies
            // that had already arrived. Tested against the position AFTER the
            // move, not the pre-move centre used for steering.
            // A lured zombie milling on its lure is "on target" too.
            const tcx = lure ? lure.x : target.x + (target.size || 16) / 2;
            const tcy = lure ? lure.y : target.y + (target.size || 16) / 2;
            const onTarget = Math.hypot(tcx - (z.x + z.size / 2),
                                        tcy - (z.y + z.size / 2))
                             <= (z.size + (lure ? 40 : (target.size || 16)));

            if (chewing || onTarget) {
                z.progX = z.x; z.progY = z.y; z.progAt = now;
                z.noProgress = 0;
            } else if (!z.progAt || now - z.progAt > PROGRESS_WINDOW_MS) {
                if (z.progAt) {
                    const gained = Math.hypot(z.x - z.progX, z.y - z.progY);
                    // expected travel over the window, heavily discounted
                    const expect = speed * (PROGRESS_WINDOW_MS / 16) * 0.22;
                    if (gained < expect) {
                        // Its OWN counter, which the per-frame `moved`
                        // check cannot clear. The watchdog used to raise
                        // z.stuck to 6 and stop there -- but an
                        // oscillating zombie moves every frame, so the
                        // `moved` branch above reset z.stuck to 0 on the
                        // very next one. It ping-ponged 0 <-> 6 and could
                        // never climb to the 240 that triggers
                        // relocation, which made the escape hatch
                        // unreachable for exactly the failure it was
                        // written to catch.
                        z.noProgress = (z.noProgress || 0) + 1;
                        z.stuck = Math.max(z.stuck || 0, 6);
                        if (z.noProgress >= PROGRESS_FAILS_TO_RELOCATE) {
                            relocateZombie(z);
                            z.stuck = 0;
                            z.slideDir = 0;
                            z.slideHold = 0;
                            z.slideAttempts = 0;
                            continue;   // moved or gone; nothing below applies
                        }
                    } else {
                        z.noProgress = 0;
                    }
                }
                z.progX = z.x; z.progY = z.y; z.progAt = now;
            }
        }

        // Armed traps hurt anything standing in them.
        for (let ti = 0; ti < traps.length; ti++) {
            const t = traps[ti];
            if (now >= t.armedUntil) continue;
            if (rectIntersect(z.x, z.y, z.size, z.size, t.x, t.y, t.w, t.h)) {
                hostEvent(SND_ZAP, z.x, z.y);
                damageZombie(i, 6 * (dt / 1000) * 6, null, now, "trap");
                break;
            }
        }
        // By identity: `!zombies[i]` was true only when the dead zombie had
        // been LAST in the array. Otherwise its neighbour slid into slot i
        // and the corpse went on to down a player on the line below.
        if (zombies[i] !== z) continue;

        // Contact still tests the PLAYER, never the waypoint.
        if (rectIntersect(target.x, target.y, target.size, target.size, z.x, z.y, z.size, z.size)) {
            if (!target.downed) downPlayer(target, now);
        }
    }
}

function downPlayer(target, now) {
    // PERK: LAST STAND x3 bleeds out half as fast again.
    const bleedMs = BLEED_OUT_MS * (idCardLevel(target.id, "laststand") >= 3 ? 1.5 : 1);
    if (target.local) {
        const p = target.ref;
        if (p.downed || now < p.invulnUntil) return;
        p.downed = true;
        p.bleedDeadline = now + bleedMs;
        p.reviveProgress = 0;
    } else {
        // A guest's own "players" message can arrive a frame after this with
        // its pre-down state; the record stops that reading as a second down.
        const rec = remoteDowned[target.id];
        if (target.ref.downed || (rec && now - rec.at < 1500)) return;
        target.ref.downed = true;
        remoteDowned[target.id] = { at: now, bleedAt: now + bleedMs };
    }
    shakeNear(target.x, target.y, 9);
    hostEvent(SND_DOWN, target.x, target.y);

    // CARD: SPITE. Going down costs the horde something.
    const spite = idCardLevel(target.id, "spite");
    if (spite) {
        const radius = 200 + spite * 45;
        addBlast(target.x, target.y, radius);
        for (let i = zombies.length - 1; i >= 0; i--) {
            const z = zombies[i];
            if (!z) continue;
            if (dist(target.x, target.y, z.x, z.y) < radius) {
                damageZombie(i, 10 * spite, target.id, now, "spite");
            }
        }
        shakeNear(target.x, target.y, 11);
        hostEvent(SND_EXPLODE, target.x, target.y, radius);
    }

    if (netOnline) MP.send({ k: "down", id: target.id, ms: Math.round(bleedMs) });
}

function sendDeath(id) {
    if (netOnline) MP.send({ k: "dead", id: id }, true);
}

// IDEA 1: the revive loop. Host-owned because only the host sees every
// player's position; progress is published so the downed player's own
// client can draw the bar.
function updateRevives(now, dt) {
    const targets = allTargets();
    const need = reviveMsRequired();
    const downedProgress = [];

    for (let i = 0; i < targets.length; i++) {
        const t = targets[i];
        if (!t.downed) continue;

        const ref = t.ref;

        // HYSTERESIS (2026-09-19). A teammate already reviving keeps it going
        // out to REVIVE_KEEP, and only a newcomer needs REVIVE_RANGE. At one
        // hard edge, a reviver shuffling on the boundary -- or a remote
        // position arriving at 15Hz and interpolated -- flipped progress
        // between filling and draining every few frames: the other half of
        // the pulsing bar.
        let reviver = null;
        for (let j = 0; j < targets.length; j++) {
            if (i === j || targets[j].downed) continue;
            const reach = (ref.reviveBy === targets[j].id) ? REVIVE_KEEP : REVIVE_RANGE;
            if (dist(t.x, t.y, targets[j].x, targets[j].y) < reach) { reviver = targets[j]; break; }
        }
        ref.reviveBy = reviver ? reviver.id : null;
        if (reviver) {
            // ROLE: MEDIC revives faster and ignores the escalation the
            // rest of the team pays.
            const medic = idHasRole(reviver.id, "medic");
            const useNeed = medic ? 3000 * 0.6 : need;
            ref.reviveProgress = (ref.reviveProgress || 0) + (dt / useNeed);
            if (ref.reviveProgress >= 1) {
                ref.reviveProgress = 0;
                revivesThisRound++;
                // Worth more the deeper the run: a revive on round 30 is
                // a bigger save than one on round 3.
                creditScore(reviver.id, "revives", 1, SCORE_REVIVE_PER_ROUND * Math.max(1, round));
                if (t.local) {
                    ref.downed = false;
                    ref.bleedDeadline = 0;
                    ref.invulnUntil = now + 1500;
                } else {
                    ref.downed = false;
                    // Their "players" messages still say downed until "up"
                    // reaches them; the players handler ignores that for a
                    // moment rather than starting the revive over.
                    ref.revivedAt = now;
                    delete remoteDowned[t.id];
                }
                ref.reviveBy = null;
                hostEvent(SND_REVIVED, t.x, t.y);
                if (netOnline) MP.send({ k: "up", id: t.id }, true);
                continue;
            }
        } else if (ref.reviveProgress > 0) {
            ref.reviveProgress = Math.max(0, ref.reviveProgress - (dt / need) * 0.5);
        }
        downedProgress.push([t.id, +(ref.reviveProgress || 0).toFixed(2)]);
    }

    // 100ms, was 150: the only feed for every other screen's bar now.
    if (netOnline && downedProgress.length && MP.canSend("rvs", 100)) {
        MP.send({ k: "rvs", list: downedProgress });
    }
}

function updateTraps(now) {
    for (let i = 0; i < traps.length; i++) {
        if (traps[i].armedUntil && now > traps[i].armedUntil) traps[i].armedUntil = 0;
    }
}

// ---------------------------------------------------
//   INTERACTION
// ---------------------------------------------------
// Explicit key, never proximity-auto: scrap is a SHARED pool, so an
// accidental purchase spends someone else's money.
function interactWith(p) {
    const now = Date.now();
    const box = { x: p.x - 26, y: p.y - 26, w: p.size + 52, h: p.size + 52 };

    if (codexRect && rectsOverlap(box, codexRect)) { openCodex(); return; }

    // The horde switch. Free, but still a world change, so it goes through
    // the host like every purchase does -- two players hitting it on the
    // same frame must produce ONE call, not two.
    if (intensifyRect && !intensified && rectsOverlap(box, intensifyRect)) {
        requestBuy("intensify", 0, p);
        return;
    }

    for (let i = 0; i < silos.length; i++) {
        if (!silos[i] || !siloReady(i)) continue;
        if (rectsOverlap(box, silos[i])) { requestBuy("silo", i, p); return; }
    }

    for (let i = 0; i < doors.length; i++) {
        if (!doors[i].open && rectsOverlap(box, doors[i])) { requestBuy("door", i, p); return; }
    }
    for (let i = 0; i < wallBuys.length; i++) {
        if (rectsOverlap(box, wallBuys[i])) { requestBuy("wallbuy", i, p); return; }
    }
    for (let i = 0; i < ammoCrates.length; i++) {
        const c = ammoCrates[i];
        if (c.uses > 0 && rectsOverlap(box, { x: c.x, y: c.y, w: c.size, h: c.size })) {
            requestBuy("crate", i, p);
            return;
        }
    }
    for (let i = 0; i < traps.length; i++) {
        const t = traps[i];
        if (now >= t.readyAt && rectsOverlap(box, t)) { requestBuy("trap", i, p); return; }
    }
    if (generatorRect && !generatorOn && !genTripped && rectsOverlap(box, generatorRect)) {
        requestBuy("generator", 0, p);
        return;
    }
    for (let i = 0; i < cardStations.length; i++) {
        if (rectsOverlap(box, cardStations[i])) { requestBuy("card", i, p); return; }
    }
    if (roundPhase === "intermission") {
        for (let i = 0; i < barricades.length; i++) {
            const b = barricades[i];
            if (b.hp < b.maxHp && rectsOverlap(box, b)) { requestBuy("board", i, p); return; }
        }
    }
}

function nearestPrompt(p) {
    const now = Date.now();
    const box = { x: p.x - 26, y: p.y - 26, w: p.size + 52, h: p.size + 52 };

    if (codexRect && rectsOverlap(box, codexRect)) return "FIELD MANUAL — READ";

    // The switch says what it does in as few words as possible, and says it
    // is one-way, because it IS one-way and nothing else in this game is.
    if (intensifyRect && rectsOverlap(box, intensifyRect)) {
        return intensified ? "THE HORDE HAS BEEN CALLED" : "CALL THE HORDE — NO GOING BACK";
    }

    for (let i = 0; i < silos.length; i++) {
        if (!silos[i] || !rectsOverlap(box, silos[i])) continue;
        if (siloFlipped[i]) return "SILO " + (i + 1) + " — SPENT";
        if (siloReady(i)) return "THROW SILO " + (i + 1) + " SWITCH";
        return "SILO " + (i + 1) + " — " + siloFill[i] + "/" + siloCapacity(i);
    }
    for (let i = 0; i < doors.length; i++) {
        if (!doors[i].open && rectsOverlap(box, doors[i])) return "OPEN DOOR — " + doors[i].cost;
    }
    for (let i = 0; i < wallBuys.length; i++) {
        if (rectsOverlap(box, wallBuys[i])) return WEAPONS[wallBuys[i].weapon].name + " — " + wallBuys[i].cost;
    }
    for (let i = 0; i < ammoCrates.length; i++) {
        const c = ammoCrates[i];
        if (c.uses > 0 && rectsOverlap(box, { x: c.x, y: c.y, w: c.size, h: c.size })) {
            return "AMMO CRATE — FREE (" + c.uses + " left)";
        }
    }
    for (let i = 0; i < traps.length; i++) {
        if (now >= traps[i].readyAt && rectsOverlap(box, traps[i])) {
            // Same formula hostHandleBuy charges. The ENGINEER cut used to be
            // charged but not shown, so the prompt quoted the wrong price.
            const roleCut = myRole() === "engineer" ? 0.6 : 1;
            const disc = Math.round(traps[i].cost * [1, 0.6, 0.45, 0.3][cardLevel(p, "conductor")] * roleCut);
            return "ARM TRAP — " + disc;
        }
    }
    if (generatorRect && genTripped) {
        const r = GEN_RESTART_REACH;
        const g = generatorRect;
        if (rectsOverlap(box, { x: g.x - r, y: g.y - r, w: g.w + r * 2, h: g.h + r * 2 })) {
            return "RESTARTING GENERATOR — STAY CLOSE  " + Math.floor(clamp(genRestart, 0, 1) * 100) + "%";
        }
    }
    if (generatorRect && !generatorOn && !genTripped && rectsOverlap(box, generatorRect)) {
        return "START GENERATOR — " + generatorRect.cost;
    }
    // PERKS: name and price only. The playtest found a sentence on a world
    // prompt too much to read mid-fight; the icon on the station says what
    // it is, and the field manual says exactly what it does.
    for (let i = 0; i < cardStations.length; i++) {
        const st = cardStations[i];
        if (!rectsOverlap(box, st)) continue;
        const c = CARDS[st.card];
        if (!generatorOn) return c.name + " — NO POWER";
        const lvl = cardLevel(p, st.card);
        if (lvl >= CARD_MAX_STACK) return c.name + " — MAXED (x" + CARD_MAX_STACK + ")";
        if (lvl === 0 && distinctCardCount(p.cards) >= CARD_SLOTS) {
            return "ALL " + CARD_SLOTS + " PERK SLOTS FULL";
        }
        const price = Math.round(st.cost * CARD_STACK_COST[lvl]);
        const label = lvl === 0 ? c.name : c.name + " x" + (lvl + 1);
        return label + " — " + price;
    }
    if (roundPhase === "intermission") {
        for (let i = 0; i < barricades.length; i++) {
            const b = barricades[i];
            if (b.hp < b.maxHp && rectsOverlap(box, b)) return "REBOARD WINDOW — FREE";
        }
    }
    return "";
}
