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
//
// `shape` is how the round is DRAWN (playtest 2026-09-18: every gun fired
// the same 8px square). `bsize` is its collision box, which is why the
// five original guns all stay at 8 -- a shape change must not quietly
// become a balance change. `salvage` scales the SALVAGE perk's refund
// chance, so a piercing sniper round that kills four cannot become
// infinite ammo.
//
// ROCKET and FLAMER (added 2026-09-18) are the only guns with rules of
// their own: a rocket detonates on the first thing it touches (`splash`),
// and flame sets what it touches burning (`burn`). Both are resolved by the
// host like every other hit.
const WEAPONS = {
    pistol:  { name: "PISTOL",  cooldown: 380, dmg: 2,  pellets: 1, spread: 0,    speed: 14, pierce: 0, range: 780,  infinite: true,  shake: 1.8, shape: "round",  bsize: 8, salvage: 0 },
    rifle:   { name: "RIFLE",   cooldown: 190, dmg: 3,  pellets: 1, spread: 0.03, speed: 18, pierce: 0, range: 1000, capacity: 240,   shake: 2.6, shape: "tracer", bsize: 8, salvage: 1 },
    shotgun: { name: "SHOTGUN", cooldown: 680, dmg: 3,  pellets: 6, spread: 0.40, speed: 15, pierce: 0, range: 430,  capacity: 60,    shake: 8,   shape: "pellet", bsize: 8, salvage: 0.7 },
    smg:     { name: "SMG",     cooldown: 85,  dmg: 2,  pellets: 1, spread: 0.13, speed: 16, pierce: 0, range: 720,  capacity: 420,   shake: 1.3, shape: "needle", bsize: 8, salvage: 1 },
    sniper:  { name: "SNIPER",  cooldown: 900, dmg: 14, pellets: 1, spread: 0,    speed: 30, pierce: 4, range: 1200, capacity: 50,    shake: 10,  shape: "streak", bsize: 8, salvage: 0.25 },
    // Slow, few, and every one of them is an event. A crate only half-fills
    // it: a free full reload of the most expensive gun on the map would make
    // the crates the real price of it.
    rocket:  { name: "ROCKET LAUNCHER", short: "ROCKET", cooldown: 1100, dmg: 10, pellets: 1, spread: 0, speed: 10, pierce: 0, range: 1100,
               capacity: 12, crateFrac: 0.5, shake: 12, shape: "rocket", bsize: 10, salvage: 0.12,
               splash: { r: 150, dmg: 18 } },
    // Short, wide and piercing: every flame hits everything in the cone once.
    // Three per shot at 70ms is about the SMG's message rate, which matters
    // because a guest's every shot is a relay message; more flames would be
    // a denser plume but not more messages.
    //
    // NERFED 2026-09-19, on a playtest call of "a bit OP". ONE ammo is spent
    // per trigger pull, not per pellet (see shoot()), so `capacity` is
    // seconds of held trigger: 400 was 28.0s, 340 is 23.8s. Cost 5200 ->
    // 5800. Damage, cooldown, pierce, range and burn are all UNTOUCHED --
    // the brief said "very slightly", and the reason it feels strong is
    // pierce against a crowd (~21 dps on one zombie, ~170 on eight), which
    // is the thing that makes it worth its price at all.
    //
    // `salvage` / `salvageAmt` DELIBERATELY UNCHANGED. The brief asked that
    // it "pair well with the salvage perk", and cutting the magazine is what
    // CREATES that pairing: SALVAGE refunds 5 rounds on 30/45/60% of kills,
    // so at x3 into a crowd the flamer nearly sustains itself and without it
    // you now feel the 340. Nerfing the refund too would delete the answer
    // at the same moment as the problem.
    flamer:  { name: "FLAMETHROWER", short: "FLAMER", cooldown: 70, dmg: 0.5, pellets: 3, spread: 0.36, speed: 7.5, pierce: 99, range: 280,
               capacity: 340, shake: 0.5, shape: "flame", bsize: 14, salvage: 1, salvageAmt: 5,
               burn: { ms: 2200, dps: 1.6 } }
};

// Short labels for tight spots (the wall-buy plate, the owned-gun strip).
function weaponShortName(key) {
    const w = WEAPONS[key];
    return w ? (w.short || w.name) : "";
}

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
    spawnling: { size: 9,  hp: 1, speed: 2.35, color: COLOR_SPLITTER, score: 1, scrap: 25,  dmgToBarricade: 4 },
    // ULTRA HEAVY (playtest 2026-09-18), from round 16. The largest body in
    // the game, and the reason NAV_PAD is 19 rather than 15: the nav grid is
    // padded for the biggest zombie, or the flow field routes it through
    // gaps it cannot fit and it wedges (zombie/CLAUDE.md, "Pathfinding").
    // `armored`: a round stops in it instead of piercing on through. Drawn
    // as an octagon with shoulder plates, not a square -- see drawUltra().
    ultra:     { size: 34, hp: 30, speed: 0.82, color: COLOR_ULTRA,  score: 12, scrap: 500, dmgToBarricade: 70, armored: true }
};

// Display names where the key is not the name players use.
const ZOMBIE_NAMES = { ultra: "ULTRA HEAVY" };

function zombieDisplayName(key) {
    return ZOMBIE_NAMES[key] || key.toUpperCase();
}

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
//
// PLAYTEST 2026-09-18. Players call these PERKS, so the UI does too; the
// code keeps `cards` (and the wire keeps `cd`) because renaming internals
// buys nothing. BEACON is gone -- lighting zombies on the minimap for five
// seconds was never worth a slot -- and DECOY takes its place as the ping
// perk. ARC, BLASTCAP, SKEWER, LAST STAND and SALVAGE were added because
// the ask was for perks that change how a FIGHT feels, not the economy.
//
// `cost` is per perk, not per station slot as it used to be, so a perk
// costs the same on every map and a price is something you can learn.
// Bases 9,000-12,500 keep the measured economy (zombie/CLAUDE.md, "Card
// economy") where it was: first stacks around rounds 12-18.
//
// `blurb` is the manual's one-liner and `detail` the per-stack numbers. The
// station prompt no longer prints either -- the playtest found a sentence
// on a world prompt hard to read mid-fight -- so each perk carries an
// ICON instead (zombie-icons.js), and the words live in the field manual.
const CARD_SLOTS = 3;
const CARDS = {
    overdrive: { name: "OVERDRIVE",  cost: 11000, blurb: "FIRE RATE UP",
                 detail: "Shot cooldown x0.65 / x0.5 / x0.4 — roughly +55% / +100% / +150% fire rate." },
    scavenger: { name: "SCAVENGER",  cost: 9000,  blurb: "+60% SCRAP PER KILL",
                 detail: "+60% scrap from your kills, per stack." },
    ricochet:  { name: "RICOCHET",   cost: 9500,  blurb: "SHOTS BOUNCE OFF WALLS",
                 detail: "Each round bounces once per stack before it dies. Not rockets or flame." },
    decoy:     { name: "DECOY",      cost: 10000, blurb: "YOUR PING LURES ZOMBIES",
                 detail: "Zombies within 320 / 400 / 480 px of your ping go to it for 4 / 5 / 6 s. Recharges in 12 / 10 / 8 s." },
    spite:     { name: "SPITE",      cost: 9000,  blurb: "GOING DOWN DETONATES",
                 detail: "A shockwave where you fall: radius 245 / 290 / 335, damage 10 / 20 / 30." },
    conductor: { name: "CONDUCTOR",  cost: 9000,  blurb: "TRAPS LAST LONGER, COST LESS",
                 detail: "Traps cost x0.6 / x0.45 / x0.3 and stay armed 2x / 3x / 4x as long." },
    arc:       { name: "ARC",        cost: 12000, blurb: "KILLS CHAIN LIGHTNING",
                 detail: "Each kill jumps a bolt to 1 / 2 / 3 zombies within 180 px. Bolt damage grows with the round." },
    blastcap:  { name: "BLASTCAP",   cost: 12500, blurb: "KILLS MAY DETONATE",
                 detail: "18% / 28% / 38% of your kills burst, hurting everything within 95 px. Bursts never chain." },
    skewer:    { name: "SKEWER",     cost: 10500, blurb: "ROUNDS PIERCE",
                 detail: "+1 / +2 / +3 zombies pierced by every round. The ULTRA HEAVY still stops them." },
    laststand: { name: "LAST STAND", cost: 9500,  blurb: "SHOOT WHILE DOWNED",
                 detail: "x1: fire the pistol while down. x2: fire any gun. x3: crawl 60% faster and bleed out 50% slower." },
    salvage:   { name: "SALVAGE",    cost: 10000, blurb: "KILLS REFUND AMMO",
                 detail: "30% / 45% / 60% of kills refund a round to the gun in your hands. Less for the sniper and rockets." }
};
const CARD_KEYS = ["overdrive", "scavenger", "ricochet", "decoy", "spite", "conductor",
                   "arc", "blastcap", "skewer", "laststand", "salvage"];

// Always on the map. It was requested by name, and with the old 4-of-6
// station draw it was missing from a third of maps -- which is exactly what
// the playtest hit. Every other perk rotates.
const CARD_ALWAYS = "overdrive";
// One station per outer zone.
const CARD_STATION_COUNT = 8;

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
const REVIVE_KEEP = REVIVE_RANGE + 18;   // once reviving, you keep it out to here

// ---------------------------------------------------
//   PLAYERS
// ---------------------------------------------------
// `keepCards` is the respawn path (zombie-game.js, respawnLocalPlayer): a
// player who bled out comes back at the next breather with the perks the
// team paid for, and only a pistol.
function spawnPlayer(keepCards) {
    if (players.length) return players[0];
    // DEAD, WAITING FOR THE BREATHER. This is the reported bug from the
    // 2026-09-18 playtest: a player who bled out could press any key and
    // walk straight back in at the keep -- including when the whole team
    // was down, which is when the run should have ENDED. While a run is
    // going, only respawnLocalPlayer() may bring you back.
    if (gameStarted && zAwaitRespawn && !keepCards) return null;

    // Online, the player wears this client's server-assigned name-hash
    // colour so they match the hub roster and every other game. The local
    // palette is only the offline fallback now that there's never a
    // second local player to distinguish.
    const useNetColor = netOnline && MP.selfColor;

    // Start inside the keep -- it's the defensible centre, so it's also
    // the natural place to begin. The hash spreads each CLIENT around the
    // centre so a room doesn't stack everyone on one pixel.
    const angle = hashToUnit(netToken) * Math.PI * 2;

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
        ammo: { rifle: 0, shotgun: 0, smg: 0, sniper: 0, rocket: 0, flamer: 0 },
        // What you have BOUGHT, separately from what has rounds left in it.
        // Before weapon switching existed, `weapon` doubled as the one gun
        // a crate would refill; with seven guns a dry one you own still
        // has to be refillable, so ownership needs its own record.
        owned: {},

        downed: false,
        bleedDeadline: 0,
        reviveProgress: 0,

        overclockUntil: 0,
        invulnUntil: 0,
        cards: keepCards ? keepCards.slice() : [],

        kills: 0,
        revives: 0,
        score: 0,

        keys: { up: false, down: false, left: false, right: false, shoot: false }
    };

    // A FRIEND JOINING A RUN IN PROGRESS (2026-09-19: "welcoming to other
    // friends joining in mid game"). They used to appear at the keep, alone,
    // with a pistol, while the team fought somewhere across the map. Now:
    // beside a teammate who is standing, with a few seconds' protection, and
    // a rifle if the run is already past its opening rounds. Not for a
    // bleed-out respawn (keepCards) -- that one is "back at the keep".
    if (!keepCards && netOnline && !netIsHost && round >= 1) {
        const buddy = standingTeammate();
        if (buddy) {
            const spot = spotBeside(buddy);
            if (spot) { p.x = spot.x; p.y = spot.y; }
            p.invulnUntil = Date.now() + 4000;
        }
        if (round >= 5) {
            p.owned.rifle = true;
            p.ammo.rifle = WEAPONS.rifle.capacity;
            p.weapon = "rifle";
        }
    }

    players.push(p);
    if (!gameStarted) startGame();
    return p;
}

function standingTeammate() {
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        if (!r.downed && !r.away) return r;
    }
    return null;
}

// A clear 16px spot 36-72px from someone, or null.
function spotBeside(r) {
    const cx = r.x + (r.size || 16) / 2, cy = r.y + (r.size || 16) / 2;
    for (let ring = 36; ring <= 72; ring += 18) {
        for (let k = 0; k < 8; k++) {
            const a = k * Math.PI / 4;
            const x = cx + Math.cos(a) * ring - 8, y = cy + Math.sin(a) * ring - 8;
            if (x < 0 || y < 0 || x > WORLD_W - 16 || y > WORLD_H - 16) continue;
            if (!blockedAt(x, y, 16, false)) return { x: x, y: y };
        }
    }
    return null;
}

function playerSpeed(p, now) {
    // PERK: LAST STAND x3 crawls faster.
    if (p.downed) return CRAWL_SPEED * (cardLevel(p, "laststand") >= 3 ? 1.6 : 1);
    // ROLE: SCOUT moves a little faster.
    return PLAYER_SPEED * (myRole() === "scout" ? 1.1 : 1);
}

// What the camera follows: this client's own player, downed included.
// Returns an array because updateCamera still takes one -- with couch
// co-op gone it will only ever hold a single point.
//
// Dead and waiting for the breather: follow a teammate who is still up (or
// any teammate), so the wait is spent watching the fight rather than a
// frozen patch of floor.
function cameraTargets() {
    if (!players.length && zAwaitRespawn) {
        let pick = null;
        for (const id in remotePlayers) {
            if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
            const r = remotePlayers[id];
            if (!pick || (pick.downed && !r.downed)) pick = r;
        }
        if (pick) return [{ x: pick.x + (pick.size || 16) / 2, y: pick.y + (pick.size || 16) / 2 }];
    }
    return players.map(function (p) {
        return { x: p.x + p.size / 2, y: p.y + p.size / 2 };
    });
}

// ---------------------------------------------------
//   SHOOTING
// ---------------------------------------------------
// ---------------------------------------------------
//   OWNED GUNS AND SWITCHING (2026-09-18)
// ---------------------------------------------------
// There used to be no switching at all: a wall-buy equipped what you
// bought and a dry gun fell back to the pistol. That was tolerable with
// five guns. With a 12-round rocket launcher it is not -- buying it would
// have thrown your rifle away. So: 1-7 pick a gun, the wheel cycles, and a
// gun that runs dry hands over to the next one you own rather than to the
// pistol.
function ownsWeapon(p, key) {
    if (key === "pistol") return true;
    return !!(p && p.owned && p.owned[key]);
}

function weaponHasAmmo(p, key) {
    const w = WEAPONS[key];
    if (!w) return false;
    return !!w.infinite || (p.ammo[key] || 0) > 0;
}

function weaponUsable(p, key) {
    return ownsWeapon(p, key) && weaponHasAmmo(p, key);
}

function selectWeapon(p, key) {
    if (!p || !weaponUsable(p, key)) return false;
    p.weapon = key;
    return true;
}

// Next usable gun after `from` in WEAPON_KEYS order, wrapping; the pistol
// is always usable, so this always returns something.
function nextUsableWeapon(p, from, dir) {
    const n = WEAPON_KEYS.length;
    let i = WEAPON_KEYS.indexOf(from);
    if (i < 0) i = 0;
    for (let step = 1; step <= n; step++) {
        const k = WEAPON_KEYS[((i + dir * step) % n + n) % n];
        if (k !== from && weaponUsable(p, k)) return k;
    }
    return "pistol";
}

function cycleWeapon(p, dir) {
    if (!p) return false;
    const k = nextUsableWeapon(p, currentWeaponKey(p), dir < 0 ? -1 : 1);
    if (k === currentWeaponKey(p)) return false;
    p.weapon = k;
    return true;
}

function currentWeapon(p) {
    return WEAPONS[currentWeaponKey(p)];
}

function currentWeaponKey(p) {
    const w = WEAPONS[p.weapon];
    if (!w) return "pistol";
    if (!w.infinite && !(p.ammo[p.weapon] > 0)) return "pistol";
    return p.weapon;
}

// LAST STAND: which gun a DOWNED player may fire, or null for none.
function downedWeaponKey(p) {
    const lvl = cardLevel(p, "laststand");
    if (lvl <= 0) return null;
    return lvl >= 2 ? currentWeaponKey(p) : "pistol";
}

function shoot(p, now, forcedKey) {
    const key = forcedKey || currentWeaponKey(p);
    const w = WEAPONS[key];
    if (!w.infinite) {
        if (!(p.ammo[key] > 0)) return;
        p.ammo[key]--;
        // Dry: hand over to the next gun you own, not to the pistol.
        if (p.ammo[key] <= 0 && p.weapon === key) p.weapon = nextUsableWeapon(p, key, 1);
    }

    // PERKS applied at the muzzle, so a guest's shot message carries them.
    // Rockets detonate on the first thing they touch and flame already
    // pierces everything, so neither takes SKEWER or RICOCHET.
    const special = key === "rocket" || key === "flamer";
    const pierce = w.pierce + (special ? 0 : cardLevel(p, "skewer"));     // PERK: SKEWER
    const bounces = special ? 0 : cardLevel(p, "ricochet");                // PERK: RICOCHET
    // ROLE: GUNNER hits harder.
    const dmg = w.dmg * (myRole() === "gunner" ? 1.15 : 1);
    const half = w.bsize / 2;

    const shots = [];
    for (let i = 0; i < w.pellets; i++) {
        // Spread is cosmetic-per-client ONLY in the sense that it doesn't
        // need to match across screens -- the host is the sole authority
        // on what a bullet hits, so Math.random() is correct here and
        // MP.random() would waste the shared stream.
        const jitter = w.spread ? (Math.random() - 0.5) * w.spread : 0;
        // Flame leaves the nozzle at uneven speeds, which is most of what
        // makes a stream of squares read as fire.
        const pace = key === "flamer" ? w.speed * (0.8 + Math.random() * 0.4) : w.speed;
        const cos = Math.cos(jitter);
        const sin = Math.sin(jitter);
        const vx = (p.facingX * cos - p.facingY * sin) * pace;
        const vy = (p.facingX * sin + p.facingY * cos) * pace;

        const b = {
            x: p.x + p.size / 2 - half,
            y: p.y + p.size / 2 - half,
            vx: vx,
            vy: vy,
            size: w.bsize,
            dmg: dmg,
            pierce: pierce,
            bounces: bounces,
            hitIds: [],
            travelled: 0,
            range: w.range,
            kind: key,
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
    const sndIdx = WEAPON_KEYS.indexOf(key);
    playEvent(SND_SHOT, p.x, p.y, sndIdx);
    queueEvent(SND_SHOT, p.x, p.y, sndIdx, netIdFor(p));

    // Always fired locally so your own shot appears on the frame you
    // pressed the trigger. On a non-host this is prediction: the host
    // spawns its own authoritative copies for damage, and filters ours
    // back out of the snapshot so nothing draws twice.
    //
    // `wk` (2026-09-18) names the gun, so the host's copies know to explode
    // or burn and every client draws them in the right shape. The host reads
    // splash and burn from its own WEAPONS table rather than trusting them
    // off the wire.
    if (netOnline && !netIsHost) {
        MP.send({
            k: "shoot",
            id: netIdFor(p),
            c: p.color,
            d: dmg,
            pr: pierce,
            bo: bounces,
            rg: w.range,
            wk: sndIdx,
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
        // Away players are not anchors: the horde should press on whoever is
        // actually here, not pile up on an empty spot.
        const r = remotePlayers[id];
        if (!r.downed && !r.away) all.push({ x: r.x, y: r.y });
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
        // FLAMETHROWER. A deadline, like flashUntil, and it crosses the
        // wire the same way: as a remaining duration, never a timestamp.
        burnUntil: 0,
        burnBy: null,      // who lit it -- burn kills are credited to them
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
