// ===================================================
//   RD Arena -- round/spawn state and the organ BIOhack loop
// ===================================================
// Split out of RDArena.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 3). Lines 1575-1762 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, so every load-time statement
// still runs in the sequence it did as one file. The only change is that the
// four-space indent the whole script carried inside <script> was removed;
// there are no multi-line template literals, so that is whitespace-only.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint).
"use strict";

// ============================================================
// Round & spawn state
// ============================================================
let player = new Entity(worldWidth / 2, worldHeight / 2, 'player');
let enemies = [];
let bullets = [];
let crawlers = [];
let bioCarriers = [];

let frameCount = 0;
let kills = 0;
let deaths = 0;
let round = 1;
let roundPhase = 'active';     // 'active' | 'intermission'
let roundBudget = 0;           // enemies still owed by this round
let breatherTimer = 0;
let spawnTimer = 0;
let spawnPity = 0;
const ROUND_BREAK = 300;       // 5s breather between rounds
let pendingBiohacks = 0;
let activeBake = null;
let bannerText = '';
let bannerTimer = 0;

const MAX_ENEMIES = 40;
const BIO_THRESHOLDS = [10, 50, 125, 250, 500, 875];
let bioIdx = 0;

function nextBioThreshold() {
    if (bioIdx < BIO_THRESHOLDS.length) return BIO_THRESHOLDS[bioIdx];
    return BIO_THRESHOLDS[BIO_THRESHOLDS.length - 1] + 500 * (bioIdx - BIO_THRESHOLDS.length + 1);
}

function registerKill(enemy) {
    kills++;
    if (build.splatter.healOnKill > 0 && Math.random() < build.splatter.healOnKill && player.hp < player.maxHp) {
        player.hp++;
        floatText(player.x, player.y - 20, '+1', '#7ee787');
    }
    if (kills >= nextBioThreshold()) {
        bioIdx++;
        pendingBiohacks++;
        banner('BIOHACK EARNED - REACH AN ORGAN');
    }
}

function banner(text) {
    bannerText = text;
    bannerTimer = 180;
}

clearRadius(worldWidth / 2, worldHeight / 2, 80);

// Heavies were far too common early. None at all in round 1, then they
// ease in: 1-in-16 at round 2 down to a 1-in-7 floor by round 7.
function heavyEvery() { return Math.max(7, 20 - round * 2); }

// At 4800x4800 a uniform spawn is a 30-60s walk at grunt speed, which now
// stalls the whole round because a round only ends on a clear field. zombie
// hit this exact wall at 4800x2700 and solved it the same way: spawn on a
// ring around the player rather than anywhere on the map.
function findSpawnPoint(minD, maxD, requireReachable) {
    for (let t = 0; t < 50; t++) {
        const a = Math.random() * Math.PI * 2;
        const d = minD + Math.random() * (maxD - minD);
        const x = player.x + Math.cos(a) * d;
        const y = player.y + Math.sin(a) * d;
        if (x < 60 || y < 60 || x > worldWidth - 60 || y > worldHeight - 60) continue;
        if (isSolid(x, y) || inSanctuary(x, y)) continue;
        if (requireReachable && !flowReachable(x, y)) continue;
        return { x: x, y: y };
    }
    return null;
}

function spawnEnemy() {
    if (enemies.length >= MAX_ENEMIES) return false;
    // Close ring and reachable first; widen, then drop the reachability
    // requirement rather than skip the spawn (the unstick ladder covers it).
    const spot = findSpawnPoint(700, 1300, true)
              || findSpawnPoint(700, 1900, true)
              || findSpawnPoint(700, 1900, false);
    if (!spot) return false;
    const x = spot.x, y = spot.y;

    spawnPity++;
    const kind = (round >= 2 && spawnPity % heavyEvery() === 0) ? 'heavy' : 'grunt';
    clearRadius(x, y, KIND[kind].radius * 2.5 + 16);
    enemies.push(new Entity(x, y, kind));
    return true;
}

// Wave-based, mirroring zombie: a fixed budget per round, and the round
// only ends once the budget is spent AND the field is clear.
function budgetForRound(r) { return Math.floor(6 * Math.pow(1.16, r - 1)) + r; }
function spawnGapForRound(r) { return Math.max(14, 90 - r * 5); }

function startRound(r) {
    round = r;
    roundBudget = budgetForRound(r);
    roundPhase = 'active';
    spawnTimer = 0;
    banner('ROUND ' + r);
}

function endRound() {
    roundPhase = 'intermission';
    breatherTimer = ROUND_BREAK;
    banner('ROUND ' + round + ' CLEARED');
}

function updateRounds() {
    if (roundPhase === 'intermission') {
        breatherTimer--;
        if (breatherTimer <= 0) startRound(round + 1);
        return;
    }
    if (roundBudget > 0) {
        spawnTimer--;
        if (spawnTimer <= 0) {
            spawnTimer = spawnGapForRound(round);
            if (spawnEnemy()) roundBudget--;
        }
    } else if (enemies.length === 0) {
        endRound();
    }
}

// ============================================================
// Organ / BIOhack loop
// ============================================================
function updateOrgans() {
    for (const o of organs) {
        o.pulse += 0.05;

        if (o.state === 'baking') {
            o.bake--;
            if (o.bake <= 0) {
                o.state = 'idle';
                activeBake = null;
                bioCarriers.push({ x: o.x, y: o.y, tree: o.tree, organ: o, wobble: 0 });
                banner(o.name + ' HAS BAKED - IT IS COMING TO YOU');
            }
            continue;
        }

        if (pendingBiohacks <= 0 || activeBake) { o.connect = 0; o.state = 'idle'; continue; }

        let d = Math.hypot(player.x - o.x, player.y - o.y);
        if (d < 62 && keys.f && !player.dead && build[o.tree].tier < TIER_CAP) {
            o.state = 'connecting';
            o.connect++;
            if (o.connect >= CONNECT_FRAMES) {
                o.connect = 0;
                o.state = 'baking';
                o.bake = BAKE_FRAMES;
                activeBake = o;
                pendingBiohacks--;
                banner('BIO-TUBE SEATED - ' + o.name + ' IS BAKING');
            }
        } else {
            o.state = 'idle';
            o.connect = Math.max(0, o.connect - 3);
        }
    }
}

function updateBioCarriers() {
    for (let i = bioCarriers.length - 1; i >= 0; i--) {
        const c = bioCarriers[i];
        c.wobble += 0.2;
        // Reuses the grunt flow field -- it is already a path to the player.
        let step = flowDir(c.x, c.y);
        let a = step ? Math.atan2(step.y, step.x) : Math.atan2(player.y - c.y, player.x - c.x);
        let nx = c.x + Math.cos(a) * 2.6;
        let ny = c.y + Math.sin(a) * 2.6;
        if (!isSolid(nx, ny)) { c.x = nx; c.y = ny; }
        else clearRadius(nx, ny, 12);

        if (!player.dead && Math.hypot(player.x - c.x, player.y - c.y) < 22) {
            const offer = offerCardsFor(c.tree);
            bioCarriers.splice(i, 1);
            if (offer) { cardOffer = offer; cardOfferTree = c.tree; }
            else banner(c.organ.name + ' IS SATED - NOTHING LEFT TO GIVE');
        }
    }
}

