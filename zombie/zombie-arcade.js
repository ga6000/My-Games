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
const ARC_ESCAPE_REACH = 170;     // how far around the gate counts as "at the gate"

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
function arcadeExitZone() {
    if (!escapeRect) return null;
    const r = ARC_ESCAPE_REACH;
    return { x: escapeRect.x - r, y: escapeRect.y - r * 1.6, w: escapeRect.w + r * 2, h: escapeRect.h + r * 1.6 };
}

function arcadeUpdateEscape() {
    if (won || !escapeOpen() || escapeChainFrac() < 0.5) return;
    const zone = arcadeExitZone();
    if (!zone) return;
    const all = allTargets();
    const standing = all.filter(function (t) { return !t.downed; });
    if (!standing.length) return;
    for (let i = 0; i < standing.length; i++) {
        const t = standing[i];
        if (!rectIntersect(t.x, t.y, t.size || 16, t.size || 16, zone.x, zone.y, zone.w, zone.h)) return;
    }
    wonAboard = standing.map(function (t) { return t.id; });
    triggerWin();
}

// How many standing players are at the gate, for the HUD line.
function arcadeAtGate() {
    const zone = arcadeExitZone();
    let at = 0, of = 0;
    const all = allTargets();
    for (let i = 0; i < all.length; i++) {
        if (all[i].downed) continue;
        of++;
        if (zone && rectIntersect(all[i].x, all[i].y, all[i].size || 16, all[i].size || 16,
                                  zone.x, zone.y, zone.w, zone.h)) at++;
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
const DROP_MAX_LIVE = 6;
const DROP_CHANCE = 0.06;
const DROP_PITY_KILLS = 25;       // never longer than this between drops
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
// Offsets from the arena's centre, which is where players start.
const ARENA_FUNNELS = [[-650, -250], [650, -400], [450, 350]];
const ARENA_GATE_DX = -500;       // the exit, in the south wall
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
        silos[k] = { x: Math.round(fx + ARENA_FUNNEL_R + 44), y: Math.round(fy - SILO_H / 2),
                     w: SILO_W, h: SILO_H, zone: zoneOf(fx, fy) };
        siloPipes[k] = pipeBetween(funnels[k], silos[k]);
    }
    const wallY = A.y + A.h - WALL_T;
    const gx = cx + ARENA_GATE_DX;
    escapeRect = { x: Math.round(gx - 90), y: wallY - 54, w: 180, h: 66 };

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
    const x0 = escapeRect.x - 16, x1 = escapeRect.x + escapeRect.w + 16;
    keepWalls.push(
        { x: A.x, y: A.y, w: A.w, h: T, perim: true },
        { x: A.x, y: A.y, w: T, h: A.h, perim: true },
        { x: A.x + A.w - T, y: A.y, w: T, h: A.h, perim: true },
        { x: A.x, y: wallY, w: x0 - A.x, h: T, perim: true },
        { x: x1, y: wallY, w: A.x + A.w - x1, h: T, perim: true },
        { x: Math.round(x0 - ESCAPE_JAMB), y: wallY - 14, w: ESCAPE_JAMB, h: T + 28, column: true },
        { x: Math.round(x1), y: wallY - 14, w: ESCAPE_JAMB, h: T + 28, column: true }
    );
    walls = keepWalls;
    escapeOpening = { x: Math.round(x0), y: wallY - 14, w: Math.round(x1 - x0), h: T + 28 };
    plantArenaTerrain(fits);

    if (typeof zfKeepPatches === "function") {
        zfKeepPatches(function (p) {
            if (p.kind !== "hardstand") return false;
            for (let i = 0; i < landmarks.length; i++) if (rectsOverlap(p, landmarks[i])) return true;
            return false;
        });
    }
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
             label: escapeOpen() ? "EXIT — EVERYONE IN"
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
        if (wl.perim || wl.column) continue;
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
    const want = Math.max(120, (bar ? bar.clientWidth : 240) - 24);
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
const TREE_TRUNK = 26;
const TREE_CANOPY = 56;
const TREE_GAP = 110;             // trunk to trunk, edge to edge-ish
const ARENA_PATCHES = 6;
let arenaBushes = [];             // {x, y, r, shade} -- drawn only
let arenaTrees = [];              // the same rects as the tree walls, for drawing

function plantArenaTerrain(fits) {
    arenaBushes = [];
    arenaTrees = [];
    const A = ARENA;
    const tryTree = function (x, y) {
        const r = { x: Math.round(x - TREE_TRUNK / 2), y: Math.round(y - TREE_TRUNK / 2), w: TREE_TRUNK, h: TREE_TRUNK };
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
        for (let i = 0; i < 9; i++) {
            const a = MP.random() * Math.PI * 2, d = 40 + MP.random() * 190;
            tryTree(px + Math.cos(a) * d, py + Math.sin(a) * d);
        }
        for (let i = 0; i < 12; i++) {
            const a = MP.random() * Math.PI * 2, d = MP.random() * 240;
            addBush(px + Math.cos(a) * d, py + Math.sin(a) * d, 7 + MP.random() * 8);
        }
    }
    // The sparse scatter between them.
    for (let i = 0; i < 34; i++) {
        tryTree(A.x + 80 + MP.random() * (A.w - 160), A.y + 80 + MP.random() * (A.h - 160));
    }
    for (let i = 0; i < 46; i++) {
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

function arcadeDrawTrees(inView) {
    const h = TREE_CANOPY / 2;
    for (let i = 0; i < arenaTrees.length; i++) {
        const t = arenaTrees[i];
        const cx = t.x + t.w / 2, cy = t.y + t.h / 2;
        if (!inView(cx - h - 8, cy - h - 8, TREE_CANOPY + 16, TREE_CANOPY + 16)) continue;
        // A cast shadow, then a stepped canopy in two flat tones -- the same
        // two-fill height trick the landmarks use.
        ctx.fillStyle = "rgba(0,0,0,0.4)";
        ctx.fillRect(cx - h + 8, cy - h + 8, TREE_CANOPY, TREE_CANOPY);
        ctx.fillStyle = TREE_SHADES[Math.floor(t.shade * TREE_SHADES.length) % TREE_SHADES.length];
        ctx.fillRect(cx - h, cy - h * 0.7, TREE_CANOPY, TREE_CANOPY * 0.7);
        ctx.fillRect(cx - h * 0.7, cy - h, TREE_CANOPY * 0.7, TREE_CANOPY);
        ctx.fillStyle = "#35602A";
        ctx.fillRect(cx - h * 0.55, cy - h * 0.75, TREE_CANOPY * 0.45, TREE_CANOPY * 0.3);
    }
}
