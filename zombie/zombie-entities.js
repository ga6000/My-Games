// ===================================================
//   Zombie — entities: players, zombies, bullets, pickups
// ===================================================
"use strict";

// ONE player per screen. Couch co-op (up to three people sharing a
// keyboard, on mouse / WASD / arrows) was removed 2026-09-01 after
// playtesting: the split schemes were too hard for a standard player to
// control, and two of the three couldn't aim independently of their
// movement.
//
// Still an ARRAY of 0 or 1, deliberately. Every consumer -- AI targeting,
// camera, broadcast, draw, pickups, revive -- iterates it, and collapsing
// it to a bare object would have meant touching all of them for no gain.
let players = [];

let zombies = [];
let bullets = [];
let pickups = [];
let scrapPool = 0;          // shared team currency (idea 3), host-authoritative

// ---------------------------------------------------
//   WEAPONS (idea 21)
// ---------------------------------------------------
// Distinct ROLES, not just damage numbers -- the point is that four
// players carrying four of these cover for each other, which is what
// makes a team feel like a team instead of four identical squares.
//
// `shake` is the recoil kick in SCREEN PIXELS (see addShake). It's the
// main thing that makes each gun FEEL different from the others: the
// sniper nearly punches the camera, the SMG barely ticks. Every weapon
// has some -- a gun with zero kick reads as a toy.
//
// The pistol is deliberately infinite. Idea 22 wants ammo to be scarce
// enough that sharing means something, but a team that runs completely
// dry has no way back into the game; a weak always-there fallback keeps
// scarcity meaningful without ever being unwinnable.
const WEAPONS = {
    pistol:  { name: "PISTOL",  cooldown: 380, dmg: 2,  pellets: 1, spread: 0,    speed: 14, pierce: 0, range: 780,  infinite: true,  shake: 1.8 },
    rifle:   { name: "RIFLE",   cooldown: 190, dmg: 3,  pellets: 1, spread: 0.03, speed: 18, pierce: 0, range: 1000, capacity: 240,   shake: 2.6 },
    shotgun: { name: "SHOTGUN", cooldown: 680, dmg: 3,  pellets: 6, spread: 0.40, speed: 15, pierce: 0, range: 430,  capacity: 60,    shake: 8 },
    smg:     { name: "SMG",     cooldown: 85,  dmg: 2,  pellets: 1, spread: 0.13, speed: 16, pierce: 0, range: 720,  capacity: 420,   shake: 1.3 },
    sniper:  { name: "SNIPER",  cooldown: 900, dmg: 14, pellets: 1, spread: 0,    speed: 30, pierce: 4, range: 1200, capacity: 50,    shake: 10 }
};

// ---------------------------------------------------
//   ZOMBIE ARCHETYPES (ideas 11, 12, 13)
// ---------------------------------------------------
// v1 had two kinds that differed only in size and HP, so every fight
// read the same. Each of these exists to force a different response:
// runners punish wandering off alone, screamers must be called out and
// focused, splitters punish point-blank shotgunning.
const ZOMBIE_TYPES = {
    walker:    { size: 16, hp: 1, speed: 1.00, color: COLOR_ZOMBIE,   score: 1, scrap: 60,  dmgToBarricade: 12 },
    runner:    { size: 12, hp: 1, speed: 2.05, color: COLOR_RUNNER,   score: 2, scrap: 75,  dmgToBarricade: 8 },
    brute:     { size: 26, hp: 8, speed: 1.28, color: COLOR_POWERFUL, score: 5, scrap: 150, dmgToBarricade: 34 },
    screamer:  { size: 20, hp: 4, speed: 0.78, color: COLOR_SCREAMER, score: 4, scrap: 200, dmgToBarricade: 6 },
    splitter:  { size: 24, hp: 4, speed: 1.05, color: COLOR_SPLITTER, score: 3, scrap: 150, dmgToBarricade: 14 },
    spawnling: { size: 9,  hp: 1, speed: 2.35, color: COLOR_SPLITTER, score: 1, scrap: 25,  dmgToBarricade: 4 }
};

// ---------------------------------------------------
//   POWERUP CARDS
// ---------------------------------------------------
// Three slots, bought at card stations around the map. Expensive, and
// inert until the generator is running.
//
// OVERDRIVE (fire rate) was requested directly. The rest deliberately
// avoid Perk-a-Cola equivalents -- no health, no reload speed, no revive
// speed, no sprint, no extra weapon slot -- and lean on systems this
// game has that CoD does not: the scrap economy, the ping, the trap
// network, and going down as a thing that can COST the horde something.
const CARD_SLOTS = 3;
const CARDS = {
    overdrive: { name: "OVERDRIVE", blurb: "+35% FIRE RATE" },
    scavenger: { name: "SCAVENGER", blurb: "+60% SCRAP" },
    ricochet:  { name: "RICOCHET",  blurb: "SHOTS BOUNCE ONCE" },
    beacon:    { name: "BEACON",    blurb: "PINGS REVEAL ZOMBIES" },
    spite:     { name: "SPITE",     blurb: "GOING DOWN DETONATES" },
    conductor: { name: "CONDUCTOR", blurb: "TRAPS 2x, 40% CHEAPER" }
};
const CARD_KEYS = ["overdrive", "scavenger", "ricochet", "beacon", "spite", "conductor"];

// Cards STACK. `p.cards` stays a flat array of keys and the stack level is
// simply how many times a key appears -- which keeps the wire format
// (an array of strings) and hasCard() unchanged, and costs nothing.
//
// Three distinct cards (slots), each stackable to three. Cost climbs
// steeply per stack so late-round scrap has somewhere to go without the
// first stack being unaffordable.
const CARD_MAX_STACK = 3;
const CARD_STACK_COST = [1, 2.2, 4.0];

function hasCard(p, key) {
    return !!p && p.cards && p.cards.indexOf(key) !== -1;
}

function cardLevel(p, key) {
    if (!p || !p.cards) return 0;
    let n = 0;
    for (let i = 0; i < p.cards.length; i++) if (p.cards[i] === key) n++;
    return n;
}

function distinctCardCount(list) {
    const seen = {};
    let n = 0;
    for (let i = 0; i < list.length; i++) {
        if (!seen[list[i]]) { seen[list[i]] = 1; n++; }
    }
    return n;
}

// Cards are per-player and bought by that player, so a client can answer
// this for its own player without asking the host.
function anyLocalCard(key) {
    for (let i = 0; i < players.length; i++) if (hasCard(players[i], key)) return true;
    return false;
}

const PLAYER_SPEED = 4;
const CRAWL_SPEED = 1.25;
const BLEED_OUT_MS = 25000;
const REVIVE_RANGE = 46;

// ---------------------------------------------------
//   PLAYERS
// ---------------------------------------------------
function spawnPlayer() {
    if (players.length) return players[0];

    // Online, the player wears this client's server-assigned name-hash
    // colour so they match the hub roster and every other game. The local
    // palette is only the offline fallback now that there's never a
    // second local player to distinguish.
    const useNetColor = netOnline && MP.selfColor;

    // Start inside the keep -- it's the defensible centre, so it's also
    // the natural place to begin. The hash spreads each CLIENT around the
    // centre so a room doesn't stack everyone on one pixel.
    const angle = hashToUnit(netPrefix) * Math.PI * 2;

    const p = {
        id: 0,
        color: useNetColor ? MP.selfColor : P_COLORS[0],
        x: WORLD_W / 2 + Math.cos(angle) * 60,
        y: WORLD_H / 2 + Math.sin(angle) * 60,
        size: 16,
        facingX: 1,
        facingY: 0,
        lastShotTime: 0,

        weapon: "pistol",
        ammo: { rifle: 0, shotgun: 0, smg: 0, sniper: 0 },

        downed: false,
        bleedDeadline: 0,
        reviveProgress: 0,

        overclockUntil: 0,
        invulnUntil: 0,
        cards: [],

        kills: 0,
        revives: 0,
        score: 0,

        keys: { up: false, down: false, left: false, right: false, shoot: false }
    };

    players.push(p);
    if (!gameStarted) startGame();
    return p;
}

function playerSpeed(p, now) {
    if (p.downed) return CRAWL_SPEED;
    // ROLE: SCOUT moves a little faster.
    return PLAYER_SPEED * (myRole() === "scout" ? 1.1 : 1);
}

// What the camera follows: this client's own player, downed included.
// Returns an array because updateCamera still takes one -- with couch
// co-op gone it will only ever hold a single point.
function cameraTargets() {
    return players.map(function (p) {
        return { x: p.x + p.size / 2, y: p.y + p.size / 2 };
    });
}

// ---------------------------------------------------
//   SHOOTING
// ---------------------------------------------------
function currentWeapon(p) {
    const w = WEAPONS[p.weapon];
    if (!w) return WEAPONS.pistol;
    if (!w.infinite && p.ammo[p.weapon] <= 0) return WEAPONS.pistol;
    return w;
}

function currentWeaponKey(p) {
    const w = WEAPONS[p.weapon];
    if (!w) return "pistol";
    if (!w.infinite && p.ammo[p.weapon] <= 0) return "pistol";
    return p.weapon;
}

function shoot(p, now) {
    const key = currentWeaponKey(p);
    const w = WEAPONS[key];
    if (!w.infinite) {
        if (p.ammo[key] <= 0) return;
        p.ammo[key]--;
    }

    const shots = [];
    for (let i = 0; i < w.pellets; i++) {
        // Spread is cosmetic-per-client ONLY in the sense that it doesn't
        // need to match across screens -- the host is the sole authority
        // on what a bullet hits, so Math.random() is correct here and
        // MP.random() would waste the shared stream.
        const jitter = w.spread ? (Math.random() - 0.5) * w.spread : 0;
        const cos = Math.cos(jitter);
        const sin = Math.sin(jitter);
        const vx = (p.facingX * cos - p.facingY * sin) * w.speed;
        const vy = (p.facingX * sin + p.facingY * cos) * w.speed;

        const b = {
            x: p.x + p.size / 2 - 4,
            y: p.y + p.size / 2 - 4,
            vx: vx,
            vy: vy,
            size: 8,
            // ROLE: GUNNER hits harder.
            dmg: w.dmg * (myRole() === "gunner" ? 1.15 : 1),
            pierce: w.pierce,
            bounces: cardLevel(p, "ricochet"),   // CARD: RICOCHET, one bounce per stack
            hitIds: [],
            travelled: 0,
            range: w.range,
            ownerColor: p.color,
            owner: netIdFor(p)
        };
        bullets.push(b);
        shots.push([Math.round(b.x), Math.round(b.y), +vx.toFixed(2), +vy.toFixed(2)]);
    }

    if (w.shake) addShake(w.shake);

    // IDEA 40. Played locally and immediately -- your own gun must never
    // wait on a round trip. The broadcast copy (so teammates hear it)
    // carries the shooter id so this client skips its own echo.
    const sndIdx = WEAPON_SND_KEYS.indexOf(key);
    playEvent(SND_SHOT, p.x, p.y, sndIdx);
    queueEvent(SND_SHOT, p.x, p.y, sndIdx, netIdFor(p));

    // Always fired locally so your own shot appears on the frame you
    // pressed the trigger. On a non-host this is prediction: the host
    // spawns its own authoritative copies for damage, and filters ours
    // back out of the snapshot so nothing draws twice.
    if (netOnline && !netIsHost) {
        MP.send({
            k: "shoot",
            id: netIdFor(p),
            c: p.color,
            d: w.dmg * (myRole() === "gunner" ? 1.15 : 1),
            pr: w.pierce,
            bo: cardLevel(p, "ricochet"),
            rg: w.range,
            s: shots
        });
    }
}

// ---------------------------------------------------
//   ZOMBIES
// ---------------------------------------------------
// Spawned near a target player rather than at a world edge. At
// 4800x2700 an edge spawn would mean a 30-second walk before the zombie
// was anyone's problem, which is the whole difficulty curve wasted on
// pathing.
// Just outside the tightened view (half-diagonal of 960x540 is ~551),
// so a zombie appears close enough to be a threat within a couple of
// seconds -- the old 1050-1500 ring was tuned for the wide FOV and made
// early rounds a lot of waiting around.
// ---------------------------------------------------
//   WHERE ZOMBIES COME FROM
// ---------------------------------------------------
// v3 spawned on a 620-950px ring around a random living player, which
// put them in that player's OWN zone -- directly behind them, in ground
// they had just walked through. The camera is player-centred, so running
// back the way you came reveals that ground and the zombie reads as
// having materialised in a space you were looking at moments ago.
//
// Spawns are now restricted to:
//   1. zones that are COLD -- nobody has been in or looking at them for
//      ZONE_COOLDOWN_MS (45s). Never-entered zones are cold from the
//      start. Nearest cold zone wins, so pressure stays close.
//   2. fully off the edge of the map, walking in, when nothing is cold.
//
// and in both cases never inside anybody's view.
//
// The cooldown rather than a permanent "visited" flag matters: with a
// permanent flag, a fully explored map left off-map as the only source,
// which doubled time-to-contact exactly when rounds should be hardest --
// and made opening the map *easier*, which is backwards.
const SPAWN_VIS_HALF_W = VIEW_W * 0.95;   // generous: covers very wide monitors
const SPAWN_VIS_HALF_H = VIEW_H * 0.95;
const SPAWN_OFF_MAP_PAD = 130;

function livingTargets() {
    const all = [];
    for (let i = 0; i < players.length; i++) {
        if (!players[i].downed) all.push({ x: players[i].x, y: players[i].y });
    }
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        if (!remotePlayers[id].downed) all.push({ x: remotePlayers[id].x, y: remotePlayers[id].y });
    }
    return all;
}

function pickSpawnAnchor() {
    const all = livingTargets();
    if (!all.length) return { x: WORLD_W / 2, y: WORLD_H / 2 };
    return all[Math.floor(Math.random() * all.length)];
}

// Is this point inside anyone's screen? Uses a deliberately generous box
// rather than the real viewRect, because the host cannot know a remote
// player's window size.
function visibleToAnyone(x, y, targets) {
    for (let i = 0; i < targets.length; i++) {
        if (Math.abs(x - targets[i].x) < SPAWN_VIS_HALF_W &&
            Math.abs(y - targets[i].y) < SPAWN_VIS_HALF_H) return true;
    }
    return false;
}

function inSealedSluice(x, y) {
    if (!sluiceRoom || (sluiceGate && sluiceGate.open)) return false;
    return x > sluiceRoom.x && x < sluiceRoom.x + sluiceRoom.w &&
           y > sluiceRoom.y && y < sluiceRoom.y + sluiceRoom.h;
}

function zoneGridDist(a, b) {
    const ax = a % ZONE_COLS, ay = Math.floor(a / ZONE_COLS);
    const bx = b % ZONE_COLS, by = Math.floor(b / ZONE_COLS);
    return Math.abs(ax - bx) + Math.abs(ay - by);
}

// Best open spot inside a zone: unseen, unblocked, and as close to the
// anchor as we can manage -- so they mass just beyond the sealed
// boundary rather than in the far corner of the zone.
// Math.random, not MP.random: the host alone decides where zombies
// appear and broadcasts the result, so this must NOT consume the shared
// world-generation stream that every client replays.
function spotInZone(zone, size, targets, anchor) {
    const b = zoneBounds(zone);
    let best = null;
    let bestD = Infinity;
    for (let tries = 0; tries < 60; tries++) {
        const x = b.x + 90 + Math.random() * (b.w - 180 - size);
        const y = b.y + 90 + Math.random() * (b.h - 180 - size);
        if (blockedAt(x, y, size, true)) continue;
        if (visibleToAnyone(x, y, targets)) continue;
        // Never inside the sealed sluice. Nothing can leave that room
        // until the gate is opened, so a zombie placed in there is stuck
        // for the rest of the run. It happens not to occur today only
        // because the sluice sits at the far south of its zone and this
        // function picks the point nearest the anchor -- which is luck,
        // not a guarantee.
        if (inSealedSluice(x, y)) continue;
        const d = Math.hypot(x - anchor.x, y - anchor.y);
        if (d < bestD) { bestD = d; best = { x: x, y: y }; }
    }
    return best;
}

// Off the edge of the map entirely, on the side nearest the anchor. Used
// once every zone has been explored -- and as the fallback whenever no
// unvisited zone can offer a hidden spot.
function offMapPoint(size, anchor) {
    const left = anchor.x;
    const right = WORLD_W - anchor.x;
    const up = anchor.y;
    const down = WORLD_H - anchor.y;
    const m = Math.min(left, right, up, down);
    const jitter = (Math.random() - 0.5) * VIEW_H;

    if (m === left)  return { x: -SPAWN_OFF_MAP_PAD, y: clamp(anchor.y + jitter, 0, WORLD_H - size) };
    if (m === right) return { x: WORLD_W + SPAWN_OFF_MAP_PAD - size, y: clamp(anchor.y + jitter, 0, WORLD_H - size) };
    if (m === up)    return { x: clamp(anchor.x + jitter, 0, WORLD_W - size), y: -SPAWN_OFF_MAP_PAD };
    return { x: clamp(anchor.x + jitter, 0, WORLD_W - size), y: WORLD_H + SPAWN_OFF_MAP_PAD - size };
}

function pickSpawnPoint(size) {
    const targets = livingTargets();
    if (!targets.length) return { x: WORLD_W / 2, y: 0 - SPAWN_OFF_MAP_PAD };

    const anchor = targets[Math.floor(Math.random() * targets.length)];
    const anchorZone = zoneOf(anchor.x, anchor.y);

    // Cold zones, nearest first.
    const now = Date.now();
    const cands = [];
    for (let z = 0; z < ZONE_COLS * ZONE_ROWS; z++) {
        if (now < zoneHotUntil[z]) continue;
        cands.push({ z: z, d: zoneGridDist(z, anchorZone) });
    }
    cands.sort(function (a, b) { return a.d - b.d; });

    for (let i = 0; i < cands.length && i < 5; i++) {
        const spot = spotInZone(cands[i].z, size, targets, anchor);
        if (spot) return spot;
    }

    // Everywhere has been explored (or is in view): come in from outside.
    return offMapPoint(size, anchor);
}

// One place that builds a zombie, so the flood can drop them at explicit
// coordinates without duplicating the entity shape.
function makeZombie(type, spec, roundNo, x, y) {
    return {
        type: type,
        x: x,
        y: y,
        size: spec.size,
        hp: spec.hp * zombieHpMultiplier(roundNo),
        color: spec.color,
        speedMult: spec.speed,
        speedOffset: (Math.random() * 0.3) - 0.15,
        flashUntil: 0,
        nextScream: 0,
        stuck: 0,          // frames making no progress -> triggers wall-sliding
        slideDir: 0,       // which way it decided to slide around the obstruction
        slideHold: 0,      // frames left committed to that slide
        slideAttempts: 0,  // failed slides; every 4th flips direction
        // Consecutive 800ms windows with no real travel. Separate from
        // `stuck` on purpose: `stuck` is cleared every frame the zombie
        // moves, and the failure this catches is one where it moves
        // constantly and goes nowhere.
        noProgress: 0,
        // False until the body has been fully inside the map once. They
        // spawn off the edge and walk in; after that they are clamped, so
        // none can wander back out to somewhere unshootable.
        entered: false,
        progX: 0,          // progress watchdog: where it was...
        progY: 0,
        progAt: 0,         // ...and when, so oscillation can be spotted
        isolationSeeker: Math.random() < 0.25   // idea 14
    };
}

function spawnZombie(type, roundNo) {
    const spec = ZOMBIE_TYPES[type] || ZOMBIE_TYPES.walker;
    const spot = pickSpawnPoint(spec.size);
    if (!spot) return null;
    const z = makeZombie(type, spec, roundNo, spot.x, spot.y);
    zombies.push(z);
    return z;
}

// Used by THE FLOOD, which comes off every map edge at once and so
// deliberately bypasses the zone-cooldown spawn rules.
function spawnZombieAt(type, roundNo, x, y) {
    const spec = ZOMBIE_TYPES[type] || ZOMBIE_TYPES.walker;
    const z = makeZombie(type, spec, roundNo, x, y);
    zombies.push(z);
    return z;
}


// ---------------------------------------------------
//   PICKUPS (idea 4, without the 1:1 CoD set)
// ---------------------------------------------------
// Team-wide by design: the "GRAB IT!" moment only exists if the pickup
// benefits everyone. Deliberately NOT Max Ammo / Instakill / Double
// Points / Nuke -- ammo resupply is a map feature (crates) instead, and
// RALLY is a co-op-specific effect with no CoD equivalent.
// ADRENALINE was removed on request 2026-09-01.
const PICKUP_TYPES = ["overclock", "rally"];
const PICKUP_LABEL = { overclock: "O", rally: "R" };
const PICKUP_NAME = { overclock: "OVERCLOCK", rally: "RALLY" };

function spawnPickup(nearX, nearY) {
    const type = PICKUP_TYPES[Math.floor(Math.random() * PICKUP_TYPES.length)];
    let x = nearX;
    let y = nearY;
    for (let tries = 0; tries < 24; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = 90 + Math.random() * 320;
        const tx = clamp(nearX + Math.cos(a) * r, 40, WORLD_W - 56);
        const ty = clamp(nearY + Math.sin(a) * r, 40, WORLD_H - 56);
        if (!blockedAt(tx, ty, 18, false)) { x = tx; y = ty; break; }
    }
    pickups.push({ x: Math.round(x), y: Math.round(y), size: 18, type: type });
}
