// ===================================================
//   Zombie — the Blood Silo endgame + roles
// ===================================================
// The first WIN state this game has ever had. Until now a run could only
// ever end in failure, which meant every session finished the same way
// and nothing survived it.
//
// The chain:
//   sluice gate (two players, two stages) -> funnel room -> kill zombies
//   ON the funnel to fill a silo -> flip that silo's switch to open the
//   next funnel -> three silos -> THE FLOOD -> clear it -> the southern
//   escape grinds open -> reach it and you have won.
//
// Since 2026-09-18 each silo stands beside its own funnel with a pipe
// between them (funnel 1 in the sluice room, funnels 2 and 3 in funnel
// halls -- zombie-level.js). The old layout put every silo in a different
// zone from its funnel on purpose, "a journey rather than a button next to
// you"; the playtest found the connection between the two unreadable, and
// asked for them side by side. The journey is now funnel to funnel.
"use strict";

// ---------------------------------------------------
//   ROLES (idea 56, randomly assigned)
// ---------------------------------------------------
// Derived from the client's own id hash rather than dealt out by the
// host: no wire traffic, survives a reconnect, and it matches how colour
// and identity already work everywhere else in this project. Two players
// can roll the same role -- that's fine.
// ("Survives a reconnect" was NOT true until 2026-09-19: the id was the
// socket id, which the server re-rolls on every connection. It is the tab
// token now -- zombie-net.js, netToken.)
//
// Deliberately small. Four players should feel different before anyone
// has bought anything; a role must never decide a run.
//
// `detail` is what the field manual's CLASSES tab prints (2026-09-18). It has
// to say exactly what the code does, so keep it next to the code's numbers:
// medic in updateRevives, engineer in hostHandleBuy/endRound, scout in
// playerSpeed/pingFrom/drawMinimap, gunner in shoot/refillAmmo.
const ROLES = {
    medic:    { name: "MEDIC",    blurb: "REVIVES 40% FASTER, IGNORES ESCALATION",
                detail: "You revive a teammate in 1.8s instead of 3s, and the round's revive escalation " +
                        "(3s, then 4.5s, then 6s) never applies to you." },
    engineer: { name: "ENGINEER", blurb: "TRAPS 40% OFF, REBOARDS 150% STRONGER",
                detail: "Traps cost you 40% less, on top of CONDUCTOR. While you are in the game, every " +
                        "boarded window comes back at 150% strength at each breather between rounds." },
    scout:    { name: "SCOUT",    blurb: "DOUBLE PING, PICKUPS ON MAP, +10% SPEED",
                detail: "Your pings land twice as far out (520px, not 260). Only you see pickups on the " +
                        "minimap. You move 10% faster." },
    gunner:   { name: "GUNNER",   blurb: "+15% DAMAGE, +25% CRATE AMMO",
                detail: "Every round you fire does 15% more damage (a ricochet keeps it; barrels and perk " +
                        "effects do not). Crates fill your guns to 125% of their capacity." }
};
const ROLE_KEYS = ["medic", "engineer", "scout", "gunner"];

// NOT hashToUnit(): that keeps only the low bits of a djb2 hash
// (`% 10000`), and djb2 low bits cluster hard for similar strings. Across
// 400 ids it dealt engineer 270 times, scout 40 and medic ZERO. The
// avalanche finalizer below mixes the whole word before the modulo, so
// adjacent ids land in unrelated buckets.
function roleForId(netId) {
    if (!netId) return "medic";
    let h = 5381;
    for (let i = 0; i < netId.length; i++) h = ((h << 5) + h + netId.charCodeAt(i)) | 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return ROLE_KEYS[(h >>> 0) % ROLE_KEYS.length];
}

function myRole() {
    // The tab token, not the socket id (2026-09-19): the socket id is new on
    // every reconnect, so a wifi drop used to re-deal your class mid-run.
    return roleForId(netToken);
}

function idHasRole(id, key) {
    return roleForId((id || "").split(":")[0]) === key;
}

// ---------------------------------------------------
//   GEOMETRY  (placed by zombie-level.js)
// ---------------------------------------------------
let sluiceRoom = null;    // {x,y,w,h}
let sluiceGate = null;    // {x,y,w,h} -- the door itself
let gatePlates = [];      // ALT: empty. Kept so nothing that reads it throws.
let gateSwitches = [];    // ALT: four levers around the map -- placeGateSwitches()
let funnels = [];         // three {x,y,r,zone}
let silos = [];           // three {x,y,w,h,zone} -- each BESIDE its funnel since 2026-09-18
let funnelHalls = [];     // [1] and [2]: {x,y,w,h,vertical,zone}; funnel 1 is in the sluice instead
let siloPipes = [];       // three {x1,y1,x2,y2}: funnel rim -> silo wall, visual only
let escapeRect = null;    // the southern way out

// ---------------------------------------------------
//   STATE (host-authoritative; mirrored by snapshot)
// ---------------------------------------------------
const GATE_STAGES = 2;
const GATE_HOLD_MS = 4000;        // per stage; the second one is longer
// Kills on the funnel per silo. ONE PER SILO, RISING (2026-09-19, on
// request: "silo fill-ups should increase with each successive one, so maybe
// #1 is 12, #2 is 24, #3 is 36"). It was a flat 12.
//
// Always go through siloCapacity(i) -- there were nine bare reads of the old
// scalar across four files, and a missed one silently reads `undefined` and
// makes a silo that can never fill.
//
// Total kills on funnels goes 36 -> 72. The escalation lands on silos 2 and
// 3, which since 2026-09-18 live in funnel HALLS -- and, since this same
// pass, halls with a door-like pinch at each end. So the longer fight is the
// one that happens in the set piece built for it, rather than in the open.
const SILO_CAPACITY = [12, 24, 36];

function siloCapacity(i) {
    return SILO_CAPACITY[i] !== undefined ? SILO_CAPACITY[i] : SILO_CAPACITY[SILO_CAPACITY.length - 1];
}
const FLOOD_SIZE = 90;            // zombies in the final wave, scaled by team
const ESCAPE_OPEN_MS = 90000;     // "takes a long time to open"

// THE WAY OUT, 2026-09-19. There used to be a yellow loading bar over the
// rect and the word SEALED. Now there are two gates, and the whole point is
// that you can SEE the slow one moving behind the fast one:
//
//   a heavy inner gate grinds up over the full ESCAPE_OPEN_MS, and a
//   smaller chainlink gate stands shut in front of it the entire time.
//   When the heavy gate finishes, the chainlink FLIES open, and that is
//   the frame you may leave.
//
// Neither needs a wire field: both are derived from `escapeAt`, which
// already crosses as a remaining duration (`esc`).
const CHAIN_SWING_MS = 700;       // the chainlink gate flying open

// 0 while sealed, 1 when the heavy gate is fully up.
function escapeGateFrac() {
    if (!escapeAt) return 0;
    return clamp(1 - (escapeAt - Date.now()) / ESCAPE_OPEN_MS, 0, 1);
}

// 0 until the heavy gate is up, then eases to 1 as the fence swings.
// Eased out hard, because a chainlink gate let go under tension does not
// travel at a constant rate.
function escapeChainFrac() {
    if (!escapeAt || !escapeOpen()) return 0;
    const t = clamp((Date.now() - escapeAt) / CHAIN_SWING_MS, 0, 1);
    return 1 - (1 - t) * (1 - t) * (1 - t);
}

let gateStage = 0;
let gateProgress = 0;
// ALT: which levers are down, and how long a team has to finish the set.
let switchOn = [false, false, false, false];
let switchWindowUntil = 0;
let funnelActive = [false, false, false];
let siloFill = [0, 0, 0];
let siloFlipped = [false, false, false];
let floodActive = false;
let floodRemaining = 0;
let escapeAt = 0;                 // when the route finishes opening; 0 = not started
let won = false;

function resetEndgame() {
    gateStage = 0;
    gateProgress = 0;
    switchOn = [false, false, false, false];
    switchWindowUntil = 0;
    funnelActive = [false, false, false];
    siloFill = [0, 0, 0];
    siloFlipped = [false, false, false];
    floodActive = false;
    floodRemaining = 0;
    escapeAt = 0;
    won = false;
}

function endgameStarted() {
    return gateStage >= GATE_STAGES;
}

function escapeOpen() {
    return escapeAt > 0 && Date.now() >= escapeAt;
}

// A short line for the HUD describing what the team should be doing.
function endgameObjective() {
    if (won) return "";
    if (typeof trainRunning !== "undefined" && trainRunning) {
        if (!escapeOpen()) {
            const left = Math.ceil((escapeAt - Date.now()) / 1000);
            return "TUNNEL OPENING — " + left + "s — HOLD THE TRAIN";
        }
        return "TUNNEL OPEN — GET UP TO SPEED";
    }
    if (gateStage >= GATE_STAGES && typeof trainReady === "function" && trainReady()) {
        return "LOCOMOTIVE READY — START IT";
    }
    if (floodActive) return "SURVIVE THE FLOOD — " + zombies.length + " LEFT";
    if (gateStage < GATE_STAGES) {
        // NOT BEFORE THE GENERATOR. Caught in the browser: this line read
        // "THROW THE SLUICE LEVERS" while the NEXT strip two rows below it
        // read "START THE GENERATOR" -- both true statements about the chain,
        // contradicting each other on screen. mapGoals() is the order; this
        // line must not jump ahead of it.
        if (!generatorOn) return "";
        if (gateSwitches.length) {
            const left = gateSwitchWindowLeft();
            return "THROW THE SLUICE LEVERS — " + gateSwitchesDown() + "/" + gateSwitchNeed() +
                   (left > 0 ? "  " + (left / 1000).toFixed(1) + "s" : "");
        }
        return "";
    }
    for (let i = 0; i < 3; i++) {
        if (funnelActive[i] && siloFill[i] < siloCapacity(i)) {
            return "KILL ON FUNNEL " + (i + 1) + " — SILO " + (i + 1) + " " + siloFill[i] + "/" + siloCapacity(i);
        }
        if (siloFill[i] >= siloCapacity(i) && !siloFlipped[i]) {
            return "SILO " + (i + 1) + " FULL — THROW ITS SWITCH";
        }
    }
    return "";
}

// ---------------------------------------------------
//   ALT: THE SLUICE SWITCHES (2026-09-25, replaces idea 57's plates)
// ---------------------------------------------------
// The two standing plates are gone. What replaced them, and why:
//
// The plates were the one mechanic in this game that was STRICTLY IMPOSSIBLE
// ALONE -- and since the only win state sits behind them, a solo player could
// never finish a run. The user's call is to trade that statement for solo
// play existing at all.
//
//   SOLO (one player standing): TWO levers, any order, AND THEY STAY DOWN.
//   A TEAM: one lever per standing player, capped at four, ALL THROWN INSIDE
//   SWITCH_WINDOW_MS -- and if the window lapses they all spring back.
//
// Five things this has to get right, every one of them an existing scar:
//
// 1. THE REQUIRED COUNT IS FIXED WHEN THE FIRST LEVER IS THROWN. teamSize()
//    moves on joins, leaves and AWAY, and a requirement that changes under a
//    team mid-sequence is unplayable. `switchNeed` is latched for the window.
// 2. ONLY STANDING, NON-AWAY PLAYERS COUNT. An AWAY player's last known spot
//    is not a player, which is why allTargets() excludes them -- the plates
//    already had to learn this.
// 3. CAPPED AT FOUR. Eight levers inside a few seconds across 4,800 x 2,700
//    is about five seconds of running before anybody even arrives.
// 4. THE WINDOW IS THE HOST'S CLOCK, MEASURED ON ARRIVAL, because that is
//    the only clock there is (rule 1). 4.5s, not 1s: a guest on 150ms sees
//    its own throw register late. Note this is the OPPOSITE problem to the
//    horde switch, where two players on one frame must produce ONE call --
//    here N distinct calls all have to land.
// 5. IT IS NOT THE HORDE SWITCH. Same lever art, different prompt, and these
//    can spring back -- the horde switch is one-way and dead metal after.
const SWITCH_WINDOW_MS = 4500;
const SWITCH_MAX = 4;
let switchNeed = 0;               // latched on the first throw

function standingPlayerCount() {
    let n = 0;
    for (let i = 0; i < players.length; i++) if (!players[i].downed) n++;
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        if (!r.downed && !r.away) n++;
    }
    return n;
}

// Two at minimum even solo, so the gate is never a single button; four at
// most, so a big room is not asked to sprint the whole map.
function gateSwitchNeed() {
    if (switchNeed > 0) return switchNeed;
    const live = Math.max(1, standingPlayerCount());
    return Math.min(Math.max(2, live), Math.min(SWITCH_MAX, gateSwitches.length || SWITCH_MAX));
}

function gateSwitchesDown() {
    let n = 0;
    for (let i = 0; i < gateSwitches.length; i++) if (switchOn[i]) n++;
    return n;
}

// Solo latches; a team is on the clock.
function gateSwitchesLatch() {
    return standingPlayerCount() <= 1;
}

function gateSwitchWindowLeft() {
    if (gateSwitchesLatch() || !switchWindowUntil) return 0;
    return Math.max(0, switchWindowUntil - Date.now());
}

// HOST. Through the buy seam like every other world change.
function hostThrowGateSwitch(i) {
    if (gateStage >= GATE_STAGES) return;
    if (i < 0 || i >= gateSwitches.length || switchOn[i]) return;
    const now = Date.now();

    if (!gateSwitchesLatch()) {
        if (!switchWindowUntil || now >= switchWindowUntil) {
            // A fresh attempt: clear whatever was half-done and latch the
            // requirement for this run of the window.
            for (let k = 0; k < switchOn.length; k++) switchOn[k] = false;
            switchNeed = 0;
            switchNeed = gateSwitchNeed();
            switchWindowUntil = now + SWITCH_WINDOW_MS;
        }
    } else if (switchNeed === 0) {
        switchNeed = gateSwitchNeed();
    }

    switchOn[i] = true;
    const g = gateSwitches[i];
    hostEvent(SND_CARD, g.x, g.y);
    if (typeof showToast === "function") {
        showToast("SLUICE LEVER " + gateSwitchesDown() + "/" + gateSwitchNeed(), 1600);
    }
    if (gateSwitchesDown() >= gateSwitchNeed()) openSluiceFromSwitches();
}

function openSluiceFromSwitches() {
    gateStage = GATE_STAGES;
    gateProgress = 0;
    switchWindowUntil = 0;
    funnelActive[0] = true;
    if (sluiceGate) {
        sluiceGate.open = true;
        rebuildSolidIndex();
    }
    hostEvent(SND_GENERATOR, sluiceGate ? sluiceGate.x : WORLD_W / 2,
                             sluiceGate ? sluiceGate.y : WORLD_H / 2);
    if (typeof showToast === "function") showToast("THE SLUICE IS OPEN", 2600);
}

// The window lapsing is the only thing this has left to do per frame.
function updateGate(dt) {
    if (gateStage >= GATE_STAGES) return;
    if (gateSwitchesLatch() || !switchWindowUntil) return;
    if (Date.now() < switchWindowUntil) return;
    switchWindowUntil = 0;
    switchNeed = 0;
    let any = false;
    for (let k = 0; k < switchOn.length; k++) { if (switchOn[k]) any = true; switchOn[k] = false; }
    if (any && typeof showToast === "function") showToast("THE LEVERS SPRANG BACK", 2000);
}

//   FUNNELS AND SILOS
// ---------------------------------------------------
// Only kills that happen ON an active funnel count. Everything else in
// the game rewards killing zombies wherever they are; this is the one
// system that asks you to fight in a specific place, which is what makes
// the funnel room a set piece rather than another room.
function funnelIndexAt(x, y) {
    for (let i = 0; i < funnels.length; i++) {
        if (!funnelActive[i]) continue;
        const f = funnels[i];
        if (Math.hypot(x - f.x, y - f.y) <= f.r) return i;
    }
    return -1;
}

function creditFunnelKill(x, y) {
    const i = funnelIndexAt(x, y);
    if (i < 0 || siloFill[i] >= siloCapacity(i)) return;
    siloFill[i]++;
    if (siloFill[i] >= siloCapacity(i)) {
        // Silo full: its switch unlocks. The funnel itself goes quiet so
        // there is no ambiguity about where to fight next.
        funnelActive[i] = false;
        hostEvent(SND_ROUND_CLEAR, silos[i] ? silos[i].x : x, silos[i] ? silos[i].y : y);
    } else {
        hostEvent(SND_CRATE, x, y);
    }
}

function siloReady(i) {
    return siloFill[i] >= siloCapacity(i) && !siloFlipped[i];
}

// Throwing a full silo's switch opens the NEXT funnel -- or, on the
// third, starts the flood.
function flipSilo(i) {
    if (!siloReady(i)) return false;
    siloFlipped[i] = true;
    if (i + 1 < funnels.length) {
        funnelActive[i + 1] = true;
        hostEvent(SND_GENERATOR, funnels[i + 1].x, funnels[i + 1].y);
    } else {
        // ALT, 2026-09-25: THE THIRD TANK DOES NOT START THE FLOOD.
        // The flood and the tunnel are now one event, and the locomotive
        // starts it -- trainHostStart(). Filling the tanks is preparation;
        // the team chooses when the fight begins, which is the same shape as
        // the horde switch and the better one.
        hostEvent(SND_ROUND_CLEAR, silos[i] ? silos[i].x : WORLD_W / 2,
                                   silos[i] ? silos[i].y : WORLD_H / 2);
        if (typeof showToast === "function") showToast("ALL TANKS FUELLED — COUPLE THE CARS", 3000);
    }
    return true;
}

// ---------------------------------------------------
//   THE FLOOD
// ---------------------------------------------------
// The one moment where zombies appearing from everywhere at once is the
// intent rather than a bug, so it ignores the zone-cooldown spawn rules
// entirely and comes in off every edge of the map.
function startFlood() {
    floodActive = true;
    floodRemaining = Math.ceil(FLOOD_SIZE * (0.6 + 0.4 * teamSize()));
    hostEvent(SND_SCREAM, WORLD_W / 2, WORLD_H / 2);
    addShake(16);
}

function floodSpawnPoint(size) {
    const side = Math.floor(Math.random() * 4);
    const pad = 120;
    if (side === 0) return { x: -pad, y: Math.random() * (WORLD_H - size) };
    if (side === 1) return { x: WORLD_W + pad - size, y: Math.random() * (WORLD_H - size) };
    if (side === 2) return { x: Math.random() * (WORLD_W - size), y: -pad };
    return { x: Math.random() * (WORLD_W - size), y: WORLD_H + pad - size };
}

function updateFlood(now) {
    if (!floodActive) return;

    if (floodRemaining > 0 && now - lastSpawnTime > 90) {
        const type = Math.random() < 0.22 ? "brute" : (Math.random() < 0.5 ? "runner" : "walker");
        const spec = ZOMBIE_TYPES[type];
        const at = floodSpawnPoint(spec.size);
        const z = spawnZombieAt(type, round, at.x, at.y);
        if (z) {
            floodRemaining--;
            lastSpawnTime = now;
        }
    }

    // ALT: the tunnel is already opening -- trainHostStart set escapeAt at
    // the same instant it lit the flood. Clearing the flood is no longer a
    // gate on anything; it just stops the extra spawns.
    if (floodRemaining === 0 && zombies.length === 0) {
        floodActive = false;
        hostEvent(SND_ROUND_CLEAR, WORLD_W / 2, WORLD_H / 2);
    }
}

// ---------------------------------------------------
//   ESCAPE
// ---------------------------------------------------
// ANY player reaching the gate wins the run for the room.
//
// It used to loop `players` -- the LOCAL array -- while updateEndgame is
// called host-only, so in a networked game only the HOST could ever end the
// run: a guest could stand in the open gate indefinitely and nothing
// happened. Found 2026-09-19 while rebuilding the gate. `allTargets()` is
// the same list the gate plates, the flood and zombie targeting already use,
// and it excludes AWAY players for the same reason they do.
//
// The chainlink gate also has to be actually open, not merely swinging:
// you cannot walk out through a fence that is still on its way.
// ALT, 2026-09-25: NOBODY WINS BY WALKING INTO THE GATE.
// The run is won when the LOCOMOTIVE takes the tunnel mouth under power --
// trainCheckTunnel(), in za-train.js. A player on foot at the gate is a
// player who missed the train.
function updateEscape() {
    return;
}

function updateEndgame(now, dt) {
    // THE TRAIN KEEPS RUNNING AFTER THE WIN, and that is the whole point of
    // the ending: "readout should appear with game continuing in background
    // with players on rail behind score readout." The old `if (won) return`
    // at the top froze it mid-shot. The gate and the flood do stop -- there
    // is nothing left for either to decide.
    if (typeof trainUpdate === "function") trainUpdate(now, dt);
    if (won) return;
    updateGate(dt);
    updateFlood(now);
}
