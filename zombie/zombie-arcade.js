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
    if (!targets.length) return pickSpawnPoint(size);
    const anchor = targets[Math.floor(Math.random() * targets.length)];
    for (let tries = 0; tries < 14; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = ARC_RING_MIN + Math.random() * (ARC_RING_MAX - ARC_RING_MIN);
        const x = anchor.x + Math.cos(a) * r;
        const y = anchor.y + Math.sin(a) * r;
        if (x < 0 || y < 0 || x > WORLD_W - size || y > WORLD_H - size) continue;
        let seen = false;
        for (let i = 0; i < targets.length && !seen; i++) {
            if (Math.abs(x - targets[i].x) < ARC_SEEN_HALF_W &&
                Math.abs(y - targets[i].y) < ARC_SEEN_HALF_H) seen = true;
        }
        if (seen || blockedAt(x, y, size, true)) continue;
        return { x: x, y: y };
    }
    return pickSpawnPoint(size);
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
// GUNS and PERKS need F, not a walk-over: in a swarm you would hoover up a
// gun a teammate needed without meaning to. TEAM drops are walked over --
// they help everyone, so there is nothing to be selfish about.
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
        x: Math.round(clamp(x - DROP_SIZE / 2, 20, WORLD_W - DROP_SIZE - 20)),
        y: Math.round(clamp(y - DROP_SIZE / 2, 20, WORLD_H - DROP_SIZE - 20)),
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

// Every client, for its own player: team drops are walked over.
function arcadeWalkOverDrops(p, now) {
    if (p.downed) return;
    const d = dropTouching(p, 0);
    if (!d || !DROP_TEAM[d.type]) return;
    if (arcTakeAskedAt[d.id] && now - arcTakeAskedAt[d.id] < 400) return;
    arcTakeAskedAt[d.id] = now;
    requestBuy("drop", d.id, p);
}

// Every client, from interactWith: F takes a gun or a perk.
function arcadeInteractDrop(p) {
    const d = dropTouching(p, 14);
    if (!d || DROP_TEAM[d.type]) return false;
    if (dropRefusal(p.cards || [], d)) return true;       // swallow the press
    requestBuy("drop", d.id, p);
    return true;
}

function dropLabel(d) {
    if (d.type === "gun") return (WEAPONS[d.item] ? WEAPONS[d.item].name : "GUN");
    if (d.type === "perk") return (CARDS[d.item] ? CARDS[d.item].name : "PERK");
    return DROP_NAME[d.type] || d.type.toUpperCase();
}

function arcadeDropPrompt(p) {
    const d = dropTouching(p, 14);
    if (!d) return "";
    if (DROP_TEAM[d.type]) return dropLabel(d);
    const no = dropRefusal(p.cards || [], d);
    if (no) return dropLabel(d) + " — " + no;
    const lvl = d.type === "perk" ? cardLevel(p, d.item) : 0;
    const what = d.type === "perk" && lvl > 0 ? dropLabel(d) + " x" + (lvl + 1) : dropLabel(d);
    return "F — TAKE " + what + "  (ONLY YOU GET IT)";
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
        if (!p && who) showToast(who + " TOOK THE " + dropLabel({ type: "gun", item: msg.it }), 1600);
    } else if (msg.t === "perk") {
        if (p && CARDS[msg.it] && !dropRefusal(p.cards, { type: "perk", item: msg.it })) p.cards.push(msg.it);
        localEvent(SND_CARD, x, y);
        if (!p && who) showToast(who + " TOOK " + dropLabel({ type: "perk", item: msg.it }), 1600);
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
