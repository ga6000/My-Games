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
const ARC_RESPAWN_MS = 15000;
const ARC_GATE_W = 212;           // the tunnel's inside width; the gate spans all of it
const ARC_GATE_H = 66;
const ARC_OUT_PAST = 100;         // px down the tunnel past the gate that counts as OUT

let arcSpawnDebt = 0;             // HOST: fractional spawns owed
let arcDiedAt = 0;                // this client: when its player bled out

function arcadeElapsedS(now) {
    return startTime ? Math.max(0, (now - startTime) / 1000) : 0;
}

function arcadeLevel(now) {
    return 1 + Math.floor(arcadeElapsedS(now) / ARC_LEVEL_S);
}

function arcadeSpawnRate(t) {
    return ARC_RATE0 * Math.pow(2, t / ARC_DOUBLE_S) * (0.6 + 0.4 * teamSize());
}

function arcadeAliveCap() {
    return ARC_CAP_BASE + ARC_CAP_PER * teamSize();
}

// HOST, from startGame(): the chain begins where the arcade begins.
function arcadeStart(now) {
    arcSpawnDebt = 0;
    arcDiedAt = 0;
    arcDropSeq = 0;
    // The run's clock starts when the intro ends (arcadeBeginIntro).
    startTime = now + ARC_INTRO_MS;
    arcKillsSinceDrop = 0;
    generatorOn = true;
    genTripped = false;
    gateStage = GATE_STAGES;
    funnelActive[0] = true;
    if (sluiceGate) sluiceGate.open = true;
    rebuildSolidIndex();
    round = 1;
    roundPhase = "active";
}

// HOST. Replaces the round flow in update(): no budget, no breather.
function updateArcadeWave(now, dt) {
    if (now < startTime) { roundPhase = "active"; return; }   // the intro
    const t = arcadeElapsedS(now);
    const level = arcadeLevel(now);
    if (level !== round) {
        round = level;
        // Only the special waves get a card; a plain level change every 12s
        // would put a banner on screen for a third of the run.
        if (isHordeRound(level) || isBruteRound(level) || isBlackoutRound(level)) {
            roundCardUntil = now + 1800;
        }
    }
    roundPhase = "active";

    const cap = arcadeAliveCap();
    arcSpawnDebt = Math.min(arcSpawnDebt + arcadeSpawnRate(t) * dt / 1000, 30);
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
    if (won || !escapeOpen() || escapeChainFrac() < 1) return;
    const standing = allTargets().filter(function (t) { return !t.downed; });
    if (!standing.length) return;
    for (let i = 0; i < standing.length; i++) if (!isOut(standing[i])) return;
    wonAboard = standing.map(function (t) { return t.id; });
    triggerWin();
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
const DROP_LIFE_MS = 25000;
const DROP_BLINK_MS = 5000;       // blinks for its last 5s
const DROP_MAX_LIVE = 8;
const DROP_CHANCE = 0.075;        // +25% (2026-10-04), was 0.06
const DROP_PITY_KILLS = 20;       // never longer than this between drops (was 25)
const DROP_FUEL = 4;              // FUEL: kills added to the live tank
const SHOCK_RADIUS = 300;
const OVERCLOCK_MS = 6000;

// Weighted. FUEL only rolls while a tank is filling.
const DROP_WEIGHTS = [
    ["gun", 30], ["perk", 24], ["ammo", 18], ["overclock", 8],
    ["rally", 7], ["fuel", 7], ["shock", 6]
];
// The perks that still mean something here. CONDUCTOR made traps cheaper
// and SCAVENGER made scrap; there are no traps, and nothing to spend.
const DROP_PERKS = ["overdrive", "ricochet", "decoy", "spite", "arc", "blastcap",
                    "skewer", "laststand", "salvage"];
// By level: an early drop is a step up from the pistol, a late one is the
// heavy kit. [minLevel, key, weight].
const DROP_GUNS = [
    [1, "rifle", 4], [1, "shotgun", 4], [1, "smg", 3],
    [5, "sniper", 2], [7, "flamer", 2], [9, "rocket", 2]
];
const DROP_TEAM = { ammo: true, overclock: true, rally: true, fuel: true, shock: true };
const DROP_NAME = { ammo: "AMMO — WHOLE TEAM", overclock: "OVERCLOCK — WHOLE TEAM",
                    rally: "RALLY — WHOLE TEAM UP", fuel: "FUEL +" + DROP_FUEL,
                    shock: "SHOCKWAVE" };

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
function arcadeMaybeDrop(x, y, now) {
    arcKillsSinceDrop++;
    if (pickups.length >= DROP_MAX_LIVE) return;
    if (arcKillsSinceDrop < DROP_PITY_KILLS && Math.random() > DROP_CHANCE) return;
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
        id: ++arcDropSeq,
        x: Math.round(clamp(x - DROP_SIZE / 2, ARENA.x + 30, ARENA.x + ARENA.w - DROP_SIZE - 30)),
        y: Math.round(clamp(y - DROP_SIZE / 2, ARENA.y + 30, ARENA.y + ARENA.h - DROP_SIZE - 30)),
        size: DROP_SIZE, type: type, item: item, until: now + DROP_LIFE_MS
    });
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
    if (lvl >= CARD_MAX_STACK) return "MAXED — LEAVE IT FOR A TEAMMATE";
    if (lvl === 0 && distinctCardCount(cards) >= CARD_SLOTS) return "PERK SLOTS FULL — CALL IT OUT";
    return "";
}

// Every client, for its own player: everything is walked over.
function arcadeWalkOverDrops(p, now) {
    if (p.downed) return;
    const d = dropTouching(p, 0);
    if (!d || dropRefusal(p.cards || [], d)) return;
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
    const no = dropRefusal(p.cards || [], d);
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
    }
    return true;
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
    } else if (msg.t === "perk") {
        if (p && CARDS[msg.it] && !dropRefusal(p.cards, { type: "perk", item: msg.it })) p.cards.push(msg.it);
        localEvent(SND_CARD, x, y);
        showToast((p ? "YOU" : (who || "SOMEONE")) + " TOOK " + dropLabel({ type: "perk", item: msg.it }), 1600);
    } else {
        localEvent(SND_PICKUP, x, y);
        if (msg.t === "ammo") {
            for (let i = 0; i < players.length; i++) refillAmmo(players[i]);
            showToast("AMMO — " + (who || "SOMEONE") + " RESUPPLIED THE TEAM", 1800);
        } else if (msg.t === "overclock" || msg.t === "rally") {
            applyTeamPickup(msg.t, msg.t === "overclock" ? OVERCLOCK_MS : 0, now, false);
        } else if (msg.t === "fuel") {
            showToast("FUEL — THE TANK TOOK " + DROP_FUEL, 1600);
        } else if (msg.t === "shock") {
            addShake(10);
            showToast("SHOCKWAVE", 1200);
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
        const m = Math.min(SEP_MAX_PUSH, len * SEP_MAX_PUSH);
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
const ARENA_FUNNEL_R = 110;
// Offsets from the arena's centre, which is where players start. Laid out
// like a BASEBALL FIELD (user, 2026-10-04): first at centre-left, second at
// top-middle, third at centre-right, and the gate is home plate, south.
const ARENA_FUNNELS = [[-750, 0], [0, -430], [750, 0]];
const ARENA_GATE_DX = 0;          // the exit, in the south wall
const ARENA_SILO_W = 70;          // the tank's FOOTPRINT, solid on every side
const ARENA_SILO_H = 56;
const ARENA_PIPE_RUN = 110;       // funnel rim to tank: room for the pipes to read
const ARENA_CLEAR = 150;          // nothing solid this close to the chain

function buildArcadeArena() {
    const A = ARENA;
    const cx = A.x + A.w / 2, cy = A.y + A.h / 2;

    // The chain first: everything else is tested against it.
    funnelHalls = [];
    sluiceRoom = null;
    for (let k = 0; k < 3; k++) {
        const fx = cx + ARENA_FUNNELS[k][0], fy = cy + ARENA_FUNNELS[k][1];
        funnels[k] = { x: fx, y: fy, r: ARENA_FUNNEL_R, zone: zoneOf(fx, fy) };
        silos[k] = { x: Math.round(fx + ARENA_FUNNEL_R + ARENA_PIPE_RUN), y: Math.round(fy - ARENA_SILO_H / 2),
                     w: ARENA_SILO_W, h: ARENA_SILO_H, zone: zoneOf(fx, fy) };
        siloPipes[k] = pipeBetween(funnels[k], silos[k]);
    }
    const wallY = A.y + A.h - WALL_T;
    const gx = cx + ARENA_GATE_DX;
    // FLUSH WITH THE SOUTH WALL and as wide as the tunnel behind it (2026-10-04:
    // "inset lower ... so that it's flush with south wall"; "extend the
    // sealed fence to the full width ... there are visually gaps").
    escapeRect = { x: Math.round(gx - ARC_GATE_W / 2), y: wallY, w: ARC_GATE_W, h: ARC_GATE_H };

    const clear = [{ x: cx - 160, y: cy - 160, w: 320, h: 320 },
                   { x: escapeRect.x - ARENA_CLEAR, y: escapeRect.y - ARENA_CLEAR,
                     w: escapeRect.w + ARENA_CLEAR * 2, h: escapeRect.h + ARENA_CLEAR }];
    for (let k = 0; k < 3; k++) {
        const f = funnels[k], s = silos[k];
        clear.push({ x: f.x - f.r - 40, y: f.y - f.r - 40, w: (s.x + s.w + 40) - (f.x - f.r - 40), h: f.r * 2 + 80 });
    }
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
    keepWalls.push(
        { x: A.x, y: A.y, w: A.w, h: T, perim: true },
        { x: A.x, y: A.y, w: T, h: A.h, perim: true },
        { x: A.x + A.w - T, y: A.y, w: T, h: A.h, perim: true },
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
    for (let k = 0; k < 3; k++) {
        const s = silos[k];
        keepWalls.push({ x: s.x, y: s.y - SILO_LIFT, w: s.w, h: s.h + SILO_LIFT, silo: true });
    }
    walls = keepWalls;
    escapeOpening = { x: Math.round(x0), y: wallY, w: Math.round(x1 - x0), h: ARC_GATE_H };
    plantArenaTerrain(fits);

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
    return { x: s.x - 8, y: s.y + s.h - 6, w: s.w + 16, h: 40 };
}

// A box wholly inside the arena's fence.
function inArena(x, y, size) {
    const A = ARENA, m = WALL_T + 6;
    return x >= A.x + m && y >= A.y + m && x + size <= A.x + A.w - m && y + size <= A.y + A.h - m;
}

// ---------------------------------------------------
//   WHERE TO GO NEXT
// ---------------------------------------------------
// "It needs to be very visually clear where the silos are." One target at a
// time, shared by the in-world beacon, the edge-of-screen arrow and the
// sidebar map, so all three always agree.
function arcadeObjectiveTarget() {
    if (won) return null;
    for (let k = 0; k < 3; k++) {
        if (siloFlipped[k]) continue;
        if (siloReady(k)) {
            const s = silos[k];
            return { x: s.x + s.w / 2, y: s.y + s.h / 2, r: 46, k: k, kind: "silo",
                     label: "TANK " + (k + 1) + " FULL — [F] THROW THE SWITCH" };
        }
        const f = funnels[k];
        if (!f) return null;
        return { x: f.x, y: f.y, r: f.r, k: k, kind: "funnel",
                 label: "TANK " + (k + 1) + " — KILL ON THE FUNNEL  " + siloFill[k] + "/" + siloCapacity(k) };
    }
    if (!escapeRect) return null;
    return { x: escapeRect.x + escapeRect.w / 2, y: escapeRect.y + escapeRect.h / 2, r: 110, kind: "gate",
             label: escapeOpen() ? "EXIT — WALK OUT, EVERYONE"
                                 : "EXIT — OPENING " + Math.max(0, Math.ceil((escapeAt - Date.now()) / 1000)) + "s" };
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
    g.fillStyle = "#16210F";
    g.fillRect(0, 0, w, h);
    for (let i = 0; i < walls.length; i++) {
        const wl = walls[i];
        if (wl.perim || wl.column || wl.silo || wl.gateBar) continue;
        g.fillStyle = wl.tree ? "#2E5A22" : "#4A4A4A";
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
    const bar = document.getElementById("sidebar");
    const want = Math.max(120, (bar ? bar.clientWidth : 240) - 24 - 12);   // the radar frame
    const wantH = Math.round(want * ARENA.h / ARENA.w);
    if (sideCanvas.width !== want || sideCanvas.height !== wantH) {
        sideCanvas.width = want;
        sideCanvas.height = wantH;
        sideStaticKey = "";
    }
    const key = levelSeed + ":" + want;
    if (key !== sideStaticKey) { sideStatic = buildSideStatic(); sideStaticKey = key; }

    const g = sideCtx, k = want / ARENA.w;
    const X = function (x) { return (x - ARENA.x) * k; };
    const Y = function (y) { return (y - ARENA.y) * k; };
    g.drawImage(sideStatic, 0, 0);
    const blink = (now % 600) < 300;
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
        g.globalAlpha = 0.5 + 0.5 * Math.sin(now / 180);
        g.lineWidth = 2;
        g.beginPath();
        g.arc(X(target.x), Y(target.y), Math.max(9, target.r * k) + 5, 0, Math.PI * 2);
        g.stroke();
        g.globalAlpha = 1;
    }

    // Drops, so a callout has somewhere to point. No zombies, on request.
    for (let i = 0; i < pickups.length; i++) {
        const d = pickups[i];
        g.fillStyle = d.type === "gun" ? ICON_CYAN : d.type === "perk" ? ICON_WORLD_HUE : COLOR_PICKUP;
        g.fillRect(X(d.x) - 2, Y(d.y) - 2, 4, 4);
    }

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
const ARENA_PATCHES = 8;           // was 6: "more patches" (2026-10-04)
let arenaBushes = [];             // {x, y, r, shade} -- drawn only
let arenaTrees = [];              // the same rects as the tree walls, for drawing

function plantArenaTerrain(fits) {
    arenaBushes = [];
    arenaTrees = [];
    const A = ARENA;
    // A TREE IS SOLID OVER ITS WHOLE DRAWN SHAPE -- trunk, canopy and all --
    // so nothing can stand "behind" one and be hidden by it (2026-10-04:
    // "silos and trees should be FULLY collidable, this way zombies can't
    // hide behind trees"). (x, y) is the footprint's centre on the ground.
    const tryTree = function (x, y) {
        const bottom = Math.round(y + TREE_TRUNK / 2);
        const tall = treeFullHeight();
        const r = { x: Math.round(x - TREE_CANOPY / 2), y: bottom - tall, w: TREE_CANOPY, h: tall };
        const pad = { x: r.x - 30, y: r.y - 30, w: r.w + 60, h: r.h + 60 };
        if (!fits(pad)) return false;
        for (let i = 0; i < walls.length; i++) {
            const w = walls[i];
            if (w.perim || w.column) continue;
            const dx = Math.max(0, Math.max(w.x - (r.x + r.w), r.x - (w.x + w.w)));
            const dy = Math.max(0, Math.max(w.y - (r.y + r.h), r.y - (w.y + w.h)));
            if (Math.hypot(dx, dy) < TREE_GAP) return false;
        }
        const t = { x: r.x, y: r.y, w: r.w, h: r.h, trunk: true, tree: true, shade: MP.random() };
        walls.push(t);
        arenaTrees.push(t);
        return true;
    };
    const addBush = function (x, y, rad) {
        if (!fits({ x: x - rad, y: y - rad, w: rad * 2, h: rad * 2 })) return;
        arenaBushes.push({ x: Math.round(x), y: Math.round(y), r: Math.round(rad), shade: MP.random() });
    };

    // Dense patches.
    for (let p = 0; p < ARENA_PATCHES; p++) {
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
    for (let i = 0; i < 37; i++) {          // +10% (2026-10-04)
        tryTree(A.x + 80 + MP.random() * (A.w - 160), A.y + 80 + MP.random() * (A.h - 160));
    }
    for (let i = 0; i < 51; i++) {          // +10%
        addBush(A.x + 60 + MP.random() * (A.w - 120), A.y + 60 + MP.random() * (A.h - 120), 5 + MP.random() * 7);
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
    g.fillStyle = "#1E2A16";
    g.fillRect(0, 0, S, S);
    const rnd = zfRng(4242);
    const shades = ["#26361B", "#2E4220", "#172112", "#33491F"];
    for (let i = 0; i < 70; i++) {
        const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
        g.fillStyle = shades[Math.floor(rnd() * shades.length)];
        g.fillRect(x, y, 2, 4);                 // a blade
        if (rnd() < 0.5) g.fillRect(x + 2, y + 1, 2, 3);
    }
    for (let i = 0; i < 6; i++) {               // a few bare patches
        g.fillStyle = "#2A2A1A";
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
// ARC_INTRO_MS), so the wave, the drops and the 4:00 curve all begin when the
// camera lands back on you. A guest arriving in a run that is already going
// (`el` > 0 on its first snapshot) skips it -- 11 seconds with no controls in
// the middle of a fight is not an intro.
const ARC_INTRO_MS = 11400;
let arcIntroAt = 0;

function arcadeBeginIntro(now) {
    arcIntroAt = now;
    if (typeof releaseHeldKeys === "function") releaseHeldKeys();
}

function arcadeIntroActive(now) {
    return arcIntroAt > 0 && (now || Date.now()) - arcIntroAt < ARC_INTRO_MS;
}

// From applyWorldSnapshot: a run already past its intro skips ours.
function arcadeIntroSync(elapsedMs) {
    if (elapsedMs > 1500 && arcadeIntroActive()) arcIntroAt = 0;
}

// The scale updateCamera() settles on, so the intro hands over without a jump.
function arcadeNormalScale() {
    let needW = VIEW_W, needH = VIEW_H;
    const aspect = canvas.width / Math.max(1, canvas.height);
    if (needW / needH < aspect) needW = needH * aspect;
    else needH = needW / aspect;
    return Math.min(canvas.width / needW, canvas.height / needH);
}

function arcadeFitScale() {
    return Math.min(canvas.width / (ARENA.w + 160), canvas.height / (ARENA.h + 160));
}

// [start ms, end ms, where, zoom ('fit' | 'near'), caption]
function arcadeIntroShots() {
    const c = { x: ARENA.x + ARENA.w / 2, y: ARENA.y + ARENA.h / 2 };
    const me = players[0] ? { x: players[0].x + 8, y: players[0].y + 8 } : c;
    const f = function (k) { return funnels[k] ? { x: funnels[k].x + 60, y: funnels[k].y } : c; };
    const gate = escapeRect ? { x: escapeRect.x + escapeRect.w / 2, y: escapeRect.y - 60 } : c;
    return [
        [0, 1800, c, "fit", "ESCAPE"],
        [1800, 2800, me, "near", ""],
        [2800, 3600, me, "near", "YOU"],
        [3600, 4600, f(0), "near", ""],
        [4600, 5600, f(0), "near", "FILL THE SILOS"],
        [5600, 6400, f(1), "near", ""],
        [6400, 7000, f(1), "near", "TANK 2"],
        [7000, 7800, f(2), "near", ""],
        [7800, 8400, f(2), "near", "TANK 3"],
        [8400, 9400, gate, "near", ""],
        [9400, 10600, gate, "near", "INITIATE GATE OPEN — ESCAPE"],
        [10600, ARC_INTRO_MS, me, "near", ""]
    ];
}

function introEase(t) { return t * t * (3 - 2 * t); }

// Drives the camera directly while the intro runs. Returns false when done.
function arcadeIntroCamera(now) {
    if (!arcadeIntroActive(now)) return false;
    const t = now - arcIntroAt;
    const shots = arcadeIntroShots();
    let prev = shots[0];
    for (let i = 0; i < shots.length; i++) {
        const s = shots[i];
        if (t < s[0] || t >= s[1]) { prev = s; continue; }
        const from = i ? shots[i - 1] : s;
        const k = introEase(clamp((t - s[0]) / Math.max(1, s[1] - s[0]), 0, 1));
        const sc = function (mode) { return mode === "fit" ? arcadeFitScale() : arcadeNormalScale(); };
        camera.x = from[2].x + (s[2].x - from[2].x) * k;
        camera.y = from[2].y + (s[2].y - from[2].y) * k;
        camera.scale = sc(from[3]) + (sc(s[3]) - sc(from[3])) * k;
        camera.shake = 0;
        return true;
    }
    return true;
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
    // Letterbox bars: this is a cutscene, and it should look like one.
    const bar = Math.round(canvas.height * 0.09);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, bar);
    ctx.fillRect(0, canvas.height - bar, canvas.width, bar);
    if (cap && shot) {
        const local = (t - shot[0]) / Math.max(1, shot[1] - shot[0]);
        const big = cap === "ESCAPE" ? 96 : cap.length > 18 ? 34 : 54;
        ctx.font = "bold " + big + "px Courier";
        ctx.textAlign = "center";
        // A whole-pixel jitter in, like the horde call -- never a smooth fade.
        const jx = local < 0.15 ? Math.round((Math.random() - 0.5) * 6) : 0;
        const y = cap === "YOU" ? canvas.height / 2 - 70 : canvas.height / 2 - canvas.height * 0.18;
        ctx.fillStyle = "#000000";
        ctx.fillText(cap, canvas.width / 2 + 4 + jx, y + 4);
        ctx.fillStyle = cap === "ESCAPE" || cap.indexOf("GATE") >= 0 ? ICON_CYAN : COLOR_PICKUP;
        ctx.fillText(cap, canvas.width / 2 + jx, y);
        if (cap === "YOU" && players[0]) {
            const s = worldToScreen(players[0].x + 8, players[0].y);
            ctx.fillStyle = COLOR_PICKUP;
            ctx.beginPath();
            ctx.moveTo(s.x, s.y - 14);
            ctx.lineTo(s.x - 12, s.y - 34);
            ctx.lineTo(s.x + 12, s.y - 34);
            ctx.closePath();
            ctx.fill();
        }
    }
    ctx.font = "13px Courier";
    ctx.fillStyle = "#777777";
    ctx.textAlign = "right";
    ctx.fillText("GET READY", canvas.width - 16, canvas.height - bar / 2 + 4);
    ctx.restore();
}

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
function treeFullHeight() {
    return TREE_LIFT + Math.round(TREE_CANOPY * 0.8) + 8;
}

// A grey bowl: rings stepping darker and slightly DOWN toward the middle (the
// pseudo-depth), blood pooling at the bottom as the tank fills, and a grate.
function arcadeDrawFunnels(now, inView) {
    for (let i = 0; i < funnels.length; i++) {
        const f = funnels[i];
        if (!f || !inView(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2)) continue;
        const live = funnelActive[i];
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
        // What has gone down it so far.
        const frac = Math.min(1, siloFill[i] / siloCapacity(i));
        if (frac > 0 && !siloFlipped[i]) {
            ctx.fillStyle = (live && now % 900 < 450) ? "#8A1020" : "#6A0C18";
            ctx.beginPath();
            ctx.arc(f.x, f.y + 12, f.r * 0.32 * (0.4 + 0.6 * frac), 0, Math.PI * 2);
            ctx.fill();
        }
        // The grate.
        // The grate: ROUND and dark (2026-10-04) -- a drain, not a vent.
        const g = Math.round(f.r * 0.26);
        const gcx = f.x, gcy = f.y + 12;
        ctx.fillStyle = "#050505";
        ctx.beginPath();
        ctx.arc(gcx, gcy, g, 0, Math.PI * 2);
        ctx.fill();
        ctx.save();
        ctx.beginPath();
        ctx.arc(gcx, gcy, g - 2, 0, Math.PI * 2);
        ctx.clip();
        ctx.fillStyle = "#2A2A2A";
        for (let b = -g; b <= g; b += 6) ctx.fillRect(Math.round(gcx + b), gcy - g, 2, g * 2);
        ctx.restore();
        ctx.strokeStyle = "#333333";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(gcx, gcy, g, 0, Math.PI * 2);
        ctx.stroke();
    }
}

// Two pipes, side by side, rim to tank, with flanges and blood moving in
// them while their funnel is live.
function arcadeDrawPipes(now, inView) {
    for (let i = 0; i < siloPipes.length; i++) {
        const p = siloPipes[i];
        if (!p) continue;
        const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
        if (len < 1) continue;
        const ux = (p.x2 - p.x1) / len, uy = (p.y2 - p.y1) / len;
        if (!inView(Math.min(p.x1, p.x2) - 20, Math.min(p.y1, p.y2) - 20, Math.abs(p.x2 - p.x1) + 40, Math.abs(p.y2 - p.y1) + 40)) continue;
        const live = funnelActive[i] && !siloFlipped[i];
        for (let side = -1; side <= 1; side += 2) {
            const ox = -uy * 12 * side, oy = ux * 12 * side;
            ctx.lineCap = "butt";
            ctx.strokeStyle = "#202020";
            ctx.lineWidth = 12;
            ctx.beginPath();
            ctx.moveTo(p.x1 + ox, p.y1 + oy + 3);
            ctx.lineTo(p.x2 + ox, p.y2 + oy + 3);
            ctx.stroke();
            ctx.strokeStyle = "#555555";
            ctx.lineWidth = 9;
            ctx.beginPath();
            ctx.moveTo(p.x1 + ox, p.y1 + oy);
            ctx.lineTo(p.x2 + ox, p.y2 + oy);
            ctx.stroke();
            ctx.strokeStyle = "#7C7C7C";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(p.x1 + ox - uy * 2, p.y1 + oy - 3);
            ctx.lineTo(p.x2 + ox - uy * 2, p.y2 + oy - 3);
            ctx.stroke();
            ctx.fillStyle = "#8A8A8A";
            for (let d = 6; d < len - 4; d += 26) {
                ctx.fillRect(Math.round(p.x1 + ox + ux * d - 3), Math.round(p.y1 + oy + uy * d - 7), 6, 14);
            }
            if (live) {
                ctx.fillStyle = "#B01428";
                const off = (now / 12) % 26;
                for (let d = off; d < len - 4; d += 26) {
                    ctx.fillRect(Math.round(p.x1 + ox + ux * d - 2), Math.round(p.y1 + oy + uy * d - 2), 5, 4);
                }
            }
        }
    }
}

function drawTallSilo(i, si, now) {
    const lift = SILO_LIFT;
    const frac = Math.min(1, siloFill[i] / siloCapacity(i));
    const ready = siloReady(i), done = siloFlipped[i];
    // Ground shadow.
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    ctx.fillRect(si.x + 10, si.y + 8, si.w, si.h);
    // Front face: the tall body, from the top face's lower edge to the ground.
    const faceY = si.y + si.h - lift;
    ctx.fillStyle = "#3A1A1E";
    ctx.fillRect(si.x, faceY, si.w, lift);
    // Blood rising in it, behind a sight-glass strip.
    const gx = si.x + Math.round(si.w * 0.38), gw = Math.round(si.w * 0.24);
    ctx.fillStyle = "#140608";
    ctx.fillRect(gx, faceY + 8, gw, lift - 14);
    const fh = Math.round((lift - 14) * frac);
    ctx.fillStyle = "#C0182C";
    ctx.fillRect(gx, faceY + 8 + (lift - 14) - fh, gw, fh);
    // Hoops.
    ctx.fillStyle = "#5A2A30";
    for (let k = 1; k <= 3; k++) ctx.fillRect(si.x, faceY + Math.round(lift * k / 4), si.w, 3);
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
    const cw = TREE_CANOPY, ch = Math.round(TREE_CANOPY * 0.8);
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
        if (inView(t.x - TREE_CANOPY, t.y - TREE_LIFT - TREE_CANOPY, t.w + TREE_CANOPY * 2, t.h + TREE_LIFT + TREE_CANOPY)) {
            list.push({ y: t.y + t.h, tree: t });
        }
    }
    for (let i = 0; i < silos.length; i++) {
        const s = silos[i];
        if (s && inView(s.x, s.y - SILO_LIFT, s.w, s.h + SILO_LIFT + 20)) list.push({ y: s.y + s.h, silo: i });
    }
    list.sort(function (a, b) { return a.y - b.y; });
    for (let i = 0; i < list.length; i++) {
        if (list[i].tree) drawTallTree(list[i].tree);
        else drawTallSilo(list[i].silo, silos[list[i].silo], now);
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
    if (near >= 6 || zombies.length >= cap * 0.8 || (me && me.downed)) return "RED";
    if (near >= 2 || zombies.length >= cap * 0.4) return "YELLOW";
    return "GREEN";
}

function arcadeUpdateCabinet() {
    const me = players[0];
    const score = me ? runScoreFor(netIdFor(me)).total : 0;
    let best = cabBest();
    if ((gameOver || won) && score > best) {
        best = score;
        try { localStorage.setItem(CAB_BEST_KEY, String(best)); } catch (e) { /* private mode */ }
    }
    const cond = gameStarted ? cabCondition() : "GREEN";
    let lives = 0;
    const all = allTargets();
    for (let i = 0; i < all.length; i++) if (!all[i].downed) lives++;
    const sig = best + "|" + score + "|" + cond + "|" + lives + "|" + all.length;
    if (sig === cabSig) return;
    cabSig = sig;
    const set = function (id, v) { const el = document.getElementById(id); if (el) el.textContent = v; };
    set("cabHi", String(best));
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
