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
function hostEvent(code, x, y, arg) {
    const gap = EVENT_THROTTLE[code];
    if (gap) {
        const now = Date.now();
        if (now - (lastEventAt[code] || 0) < gap) return;
        lastEventAt[code] = now;
    }
    playEvent(code, x, y, arg);
    if (netOnline && netIsHost && eventQueue.length < EVENT_CAP) {
        eventQueue.push([code, Math.round(x), Math.round(y), arg || 0, 0]);
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
const AMBIENT_DARK = 0.72;
const AMBIENT_LIT = 0.22;
const AMBIENT_BLACKOUT_ADD = 0.20;

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
        if (Object.prototype.hasOwnProperty.call(remotePlayers, id)) n++;
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

    const roll = Math.random();
    if (r >= 4 && roll < Math.min(0.22, 0.03 * (r - 3))) return "brute";
    if (r >= 6 && roll < 0.30) return "splitter";
    if (r >= 5 && roll < 0.38) return "screamer";
    if (r >= 3 && roll < 0.58) return "runner";
    return "walker";
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
    const at = players[0] || { x: WORLD_W / 2, y: WORLD_H / 2 };
    hostEvent(SND_ROUND_START, at.x, at.y);
}

function endRound(now) {
    roundPhase = "intermission";
    roundEndsAt = now + ROUND_BREAK_MS;
    const at = players[0] || { x: WORLD_W / 2, y: WORLD_H / 2 };
    hostEvent(SND_ROUND_CLEAR, at.x, at.y);
    // One guaranteed pickup per round clear reads as a reward; v1's
    // "every 20 spawns" read as a random trickle.
    const anchor = pickSpawnAnchor();
    spawnPickup(anchor.x, anchor.y);
    // Barricades come back during the breather so the keep is
    // defensible again next round (idea 17).
    for (let i = 0; i < barricades.length; i++) {
        barricades[i].hp = barricades[i].maxHp;
    }
    rebuildSolidIndex();
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
}

function killLocalPlayer(p) {
    players = players.filter(function (pl) { return pl.id !== p.id; });
    checkAllDead();
}

function checkAllDead() {
    // Online, "everyone died" means every player in the ROOM.
    const remoteAlive = Object.keys(remotePlayers).length > 0;
    if (players.length === 0 && (!netOnline || !remoteAlive)) triggerGameOver();
}

// The first win state the game has ever had.
function triggerWin() {
    if (won || gameOver) return;
    won = true;
    localEvent(SND_GENERATOR, WORLD_W / 2, WORLD_H - 100);
    stopAllLoops();
    uiWin.style.display = 'block';
    uiWinRound.innerText = String(round);
    // A win is a completed run and belongs on the board too -- the same
    // guard stops the later game-over path posting it a second time.
    submitRunToLeaderboard();
    if (netOnline && netIsHost) MP.send({ k: "won" }, true);
}

function triggerGameOver() {
    if (gameOver) return;
    gameOver = true;
    const at = players[0] || { x: WORLD_W / 2, y: WORLD_H / 2 };
    localEvent(SND_GAMEOVER, at.x, at.y);
    stopAllLoops();
    uiGameOver.style.display = 'block';
    uiFinalRound.innerText = String(round);
    submitRunToLeaderboard();
}

// THE SCORE IS THE ROUND REACHED. scoreBoard[id].score exists, but it is
// per-player kill credit inside one run and it is host-owned -- the number a
// survival game's leaderboard wants is how far you got, which is also the
// number the game already shows you on the game-over card.
//
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
        score: round,
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
    gameOver = false;
    gameStarted = false;
    zLbSubmitted = false;

    resetEndgame();
    uiWin.style.display = 'none';

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
        if (!generatorRect || generatorOn || scrapPool < generatorRect.cost) return;
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
            p.weapon = wb.weapon;
            p.ammo[wb.weapon] = WEAPONS[wb.weapon].capacity;
        }
        if (wb) localEvent(SND_BUY, wb.x, wb.y);
    } else if (msg.what === "generator") {
        generatorOn = true;
        if (generatorRect) {
            // No markNavDirty(): the generator changes light, not geometry.
            localEvent(SND_GENERATOR, generatorRect.x, generatorRect.y);
            uiToast.innerText = "LIGHTS ON";
            uiToast.style.display = 'block';
            trackTimeout(function () { uiToast.style.display = 'none'; }, 2200);
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

function refillAmmo(p) {
    for (const key in p.ammo) {
        if (!Object.prototype.hasOwnProperty.call(p.ammo, key)) continue;
        if (p.ammo[key] > 0) p.ammo[key] = WEAPONS[key].capacity;
    }
    if (p.weapon !== "pistol") p.ammo[p.weapon] = WEAPONS[p.weapon].capacity;
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
    uiToast.innerText = PICKUP_NAME[type] || "";
    uiToast.style.display = 'block';
    trackTimeout(function () { uiToast.style.display = 'none'; }, 1800);
    if (isHostOrigin && netOnline) MP.send({ k: "pickup", t: type, ms: ms });
}

// ---------------------------------------------------
//   UPDATE
// ---------------------------------------------------
function update(now, dt) {
    if (!gameStarted || gameOver) return;

    // ---- ROUND FLOW (host only) ----
    if (netIsHost) {
        updateEndgame(now, dt);
    }
    if (netIsHost && !floodActive) {
        if (roundPhase === "intermission" && now >= roundEndsAt) startRound(round + 1);

        if (roundPhase === "active") {
            if (roundBudget > 0 && now - lastSpawnTime > spawnGapForRound(round)) {
                const z = spawnZombie(pickZombieType(round), round);
                if (z) {
                    roundBudget--;
                    lastSpawnTime = now;
                }
            }
            // Clears only when the budget is spent AND the map is empty.
            if (roundBudget === 0 && zombies.length === 0) endRound(now);
        }
    }

    // Any zone a player is standing in OR looking into goes hot, and
    // stays hot for 45s after they leave. That is what stops zombies
    // appearing in ground the team just walked through, without
    // permanently retiring half the map as a spawn source.
    markHotZones();

    updatePlayers(now, dt);
    updateBullets(now);

    if (netIsHost) {
        updateZombies(now, dt);
        updateRevives(now, dt);
        updateTraps(now);
    }

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
        for (let z = 0; z < ZONE_COLS * ZONE_ROWS; z++) {
            if (rectsOverlap(box, zoneBounds(z))) zoneHotUntil[z] = until;
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

        if (p.downed) {
            if (netIsHost && p.bleedDeadline && now >= p.bleedDeadline) {
                sendDeath(netIdFor(p));
                killLocalPlayer(p);
            }
            continue;   // downed players cannot shoot or interact
        }

        // Shooting
        const w = WEAPONS[currentWeaponKey(p)];
        let cooldown = (now < p.overclockUntil) ? Math.max(60, w.cooldown * 0.2) : w.cooldown;
        // CARD: OVERDRIVE, per stack.
        const od = cardLevel(p, "overdrive");
        if (od) cooldown *= [1, 0.65, 0.5, 0.4][od];
        if (p.keys.shoot && now - p.lastShotTime > cooldown) {
            shoot(p, now);
            p.lastShotTime = now;
        }
    }
}

function updateBullets(now) {
    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];
        b.x += b.vx;
        b.y += b.vy;
        b.travelled += Math.hypot(b.vx, b.vy);

        if (b.travelled > b.range || b.x < 0 || b.x > WORLD_W || b.y < 0 || b.y > WORLD_H) {
            bullets.splice(i, 1);
            continue;
        }
        // Bullets use the ZOMBIE solid set: a broken window stops being
        // cover for either side, so shooting through one you've let open
        // is a real consequence of losing it.
        if (blockedAt(b.x, b.y, b.size, true)) {
            // CARD: RICOCHET. Step back out of the wall, then reflect off
            // whichever axis actually blocked us.
            if (b.bounces > 0) {
                b.x -= b.vx;
                b.y -= b.vy;
                const hitX = blockedAt(b.x + b.vx, b.y, b.size, true);
                const hitY = blockedAt(b.x, b.y + b.vy, b.size, true);
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
            bullets.splice(i, 1);
            continue;
        }

        // Damage is HOST ONLY. A client runs bullets purely as a visual
        // prediction of its own shots; letting it also decide what died
        // would have two clients disagreeing within seconds.
        if (!netIsHost) continue;

        let consumed = false;
        for (let j = zombies.length - 1; j >= 0; j--) {
            const z = zombies[j];
            if (b.hitIds.indexOf(j) !== -1) continue;
            if (!rectIntersect(b.x, b.y, b.size, b.size, z.x, z.y, z.size, z.size)) continue;

            damageZombie(j, b.dmg, b.owner, now);

            if (b.pierce > 0) {
                b.pierce--;
                b.hitIds.push(j);
            } else {
                consumed = true;
            }
            break;
        }
        if (consumed) bullets.splice(i, 1);
    }
}

function damageZombie(index, dmg, ownerId, now) {
    const z = zombies[index];
    if (!z) return;
    z.hp -= dmg;
    if (!z.damagers) z.damagers = [];
    if (ownerId && z.damagers.indexOf(ownerId) === -1) z.damagers.push(ownerId);

    if (z.hp > 0) {
        z.flashUntil = now + 50;
        return;
    }

    const spec = ZOMBIE_TYPES[z.type];
    zombies.splice(index, 1);
    kills++;
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
    creditScore(ownerId, "kills", 1, Math.round(spec.score * 100 * bonus));

    // Assists to anyone who damaged it but didn't land the kill.
    for (let i = 0; i < z.damagers.length; i++) {
        if (z.damagers[i] !== ownerId) creditScore(z.damagers[i], "assists", 1, 25);
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
    addShake(14);
    addBlast(br.x + br.size / 2, br.y + br.size / 2, 190);
    hostEvent(SND_EXPLODE, br.x, br.y);
    hostEvent(SND_EXPLODE, br.x, br.y);

    for (let i = zombies.length - 1; i >= 0; i--) {
        const z = zombies[i];
        if (dist(br.x, br.y, z.x, z.y) < 190) damageZombie(i, 12, ownerId, now);
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
let navFieldAt = 0;
const NAV_REFRESH_MS = 220;

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
    const baseSpeed = zombieSpeedForRound(round);

    if (!navFieldAll || now - navFieldAt > NAV_REFRESH_MS || navDirty) {
        navFieldAll = navFieldFrom(targets.map(function (t) {
            return { x: t.x + (t.size || 16) / 2, y: t.y + (t.size || 16) / 2 };
        }));
        navFieldIsolated = isolated
            ? navFieldFrom([{ x: isolated.x + (isolated.size || 16) / 2, y: isolated.y + (isolated.size || 16) / 2 }])
            : null;
        navFieldAt = now;
    }

    for (let i = zombies.length - 1; i >= 0; i--) {
        const z = zombies[i];
        const spec = ZOMBIE_TYPES[z.type];

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
        const field = (z.isolationSeeker && navFieldIsolated) ? navFieldIsolated : navFieldAll;
        const zcx = z.x + z.size / 2;
        const zcy = z.y + z.size / 2;
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
        const goalX = step ? step.x : target.x + (target.size || 16) / 2;
        const goalY = step ? step.y : target.y + (target.size || 16) / 2;

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
            const tcx = target.x + (target.size || 16) / 2;
            const tcy = target.y + (target.size || 16) / 2;
            const onTarget = Math.hypot(tcx - (z.x + z.size / 2),
                                        tcy - (z.y + z.size / 2))
                             <= (z.size + (target.size || 16));

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
                damageZombie(i, 6 * (dt / 1000) * 6, null, now);
                break;
            }
        }
        if (!zombies[i]) continue;

        // Contact still tests the PLAYER, never the waypoint.
        if (rectIntersect(target.x, target.y, target.size, target.size, z.x, z.y, z.size, z.size)) {
            if (!target.downed) downPlayer(target, now);
        }
    }
}

function downPlayer(target, now) {
    if (target.local) {
        const p = target.ref;
        if (p.downed || now < p.invulnUntil) return;
        p.downed = true;
        p.bleedDeadline = now + BLEED_OUT_MS;
        p.reviveProgress = 0;
    } else {
        if (target.ref.downed) return;
        target.ref.downed = true;
    }
    addShake(9);
    hostEvent(SND_DOWN, target.x, target.y);

    // CARD: SPITE. Going down costs the horde something.
    const spite = idCardLevel(target.id, "spite");
    if (spite) {
        const radius = 200 + spite * 45;
        addBlast(target.x, target.y, radius);
        for (let i = zombies.length - 1; i >= 0; i--) {
            if (dist(target.x, target.y, zombies[i].x, zombies[i].y) < radius) {
                damageZombie(i, 10 * spite, target.id, now);
            }
        }
        addShake(11);
        hostEvent(SND_EXPLODE, target.x, target.y);
    }

    if (netOnline) MP.send({ k: "down", id: target.id, ms: BLEED_OUT_MS });
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

        let reviver = null;
        for (let j = 0; j < targets.length; j++) {
            if (i === j || targets[j].downed) continue;
            if (dist(t.x, t.y, targets[j].x, targets[j].y) < REVIVE_RANGE) { reviver = targets[j]; break; }
        }

        const ref = t.ref;
        if (reviver) {
            // ROLE: MEDIC revives faster and ignores the escalation the
            // rest of the team pays.
            const medic = idHasRole(reviver.id, "medic");
            const useNeed = medic ? 3000 * 0.6 : need;
            ref.reviveProgress = (ref.reviveProgress || 0) + (dt / useNeed);
            if (ref.reviveProgress >= 1) {
                ref.reviveProgress = 0;
                revivesThisRound++;
                creditScore(reviver.id, "revives", 1, 300);
                if (t.local) {
                    ref.downed = false;
                    ref.bleedDeadline = 0;
                    ref.invulnUntil = now + 1500;
                } else {
                    ref.downed = false;
                }
                hostEvent(SND_REVIVED, t.x, t.y);
                if (netOnline) MP.send({ k: "up", id: t.id }, true);
                continue;
            }
        } else if (ref.reviveProgress > 0) {
            ref.reviveProgress = Math.max(0, ref.reviveProgress - (dt / need) * 0.5);
        }
        downedProgress.push([t.id, +(ref.reviveProgress || 0).toFixed(2)]);
    }

    if (netOnline && downedProgress.length && MP.canSend("rvs", 150)) {
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
    if (generatorRect && !generatorOn && rectsOverlap(box, generatorRect)) {
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

    for (let i = 0; i < silos.length; i++) {
        if (!silos[i] || !rectsOverlap(box, silos[i])) continue;
        if (siloFlipped[i]) return "SILO " + (i + 1) + " — SPENT";
        if (siloReady(i)) return "THROW SILO " + (i + 1) + " SWITCH";
        return "SILO " + (i + 1) + " — " + siloFill[i] + "/" + SILO_CAPACITY;
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
            const disc = Math.round(traps[i].cost * [1, 0.6, 0.45, 0.3][cardLevel(p, "conductor")]);
            return "ARM TRAP — " + disc;
        }
    }
    if (generatorRect && !generatorOn && rectsOverlap(box, generatorRect)) {
        return "START GENERATOR — " + generatorRect.cost;
    }
    for (let i = 0; i < cardStations.length; i++) {
        const st = cardStations[i];
        if (!rectsOverlap(box, st)) continue;
        const c = CARDS[st.card];
        if (!generatorOn) return c.name + " — NEEDS THE GENERATOR";
        const lvl = cardLevel(p, st.card);
        if (lvl >= CARD_MAX_STACK) return c.name + " — MAXED (x" + CARD_MAX_STACK + ")";
        if (lvl === 0 && distinctCardCount(p.cards) >= CARD_SLOTS) {
            return "ALL " + CARD_SLOTS + " CARD SLOTS FULL";
        }
        const price = Math.round(st.cost * CARD_STACK_COST[lvl]);
        const label = lvl === 0 ? c.name : c.name + " x" + (lvl + 1);
        return label + " — " + price + "  (" + c.blurb + ")";
    }
    if (roundPhase === "intermission") {
        for (let i = 0; i < barricades.length; i++) {
            const b = barricades[i];
            if (b.hp < b.maxHp && rectsOverlap(box, b)) return "REBOARD WINDOW — FREE";
        }
    }
    return "";
}
