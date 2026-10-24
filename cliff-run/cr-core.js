/**
 * Cliff Run — constants, state, teardown plumbing
 * ===================================================
 * Loads FIRST. Declares the state every other file reads; executes nothing.
 *
 * Classic script, one shared global scope, no modules (the file:// hard
 * constraint). Every top-level name here is cr/CR_-prefixed so that
 * scripts/check-global-collisions.js has nothing to say about this page.
 *
 * THE NUMBERS IN CR_PHYS ARE LOAD-BEARING. cr-level.js caps its generated gaps
 * and step-ups against them (3 tiles against a 4.2-tile jump range, 2 rows
 * against a 2.4-tile apex), which is the whole reason the bots in cr-bots.js
 * can finish a level: they follow a route that was built to be followable
 * rather than solving the level from scratch. Change a jump number and the
 * generator's margins change with it -- rerun scripts/cliff-run-playtest.js.
 */
"use strict";

// ===================================================
//   THE VIRTUAL SCREEN
// ===================================================
/*
 * 480x384 is 20x16 tiles at CR_TILE 24, which is also 5:4 -- the aspect the
 * raster cabinets of 1978-82 actually shipped with, so the frame is period
 * before anything is drawn in it.
 *
 * It was 20x14 for one build and the bottom lane sat on the last playable row
 * with nothing under it and nowhere to route: it finished 13% of the time
 * against lane 0's 100%. Two more rows is two more rows of cliff beneath the
 * lowest spawn. Integer-scaled and letterboxed by
 * crResize(), with image-rendering: pixelated -- a raster cabinet drawing on a
 * coarse grid (AESTHETIC_GUIDE.md 1), not a high-res game with a filter over it.
 *
 * IT WAS 16px TILES ON A 30x18 SCREEN. The user asked for bigger blocks, a
 * smaller player inside them, and a more compact, claustrophobic, strategic
 * level (2026-10-17). Twenty tiles of sight line instead of thirty is most of
 * "compact" on its own: you can see about two thirds as far ahead, so a route
 * has to be read rather than scanned.
 */
var CR_VW = 480;
var CR_VH = 384;
var CR_TILE = 24;
var CR_COLS_ON_SCREEN = CR_VW / CR_TILE;   // 20
var CR_ROWS = CR_VH / CR_TILE;             // 16

/*
 * THE PLAYER IS A ZOMBIE PLAYER: a 16x16 filled square in the identity colour
 * with a 4x4 white facing pip, which is exactly what zombie-render.js's
 * drawPlayerBody draws (p.size is 16 there). The user asked for the character
 * to look the same across the two games, and it answers the other half of the
 * same request for free -- a 16px square inside a 24px tile IS "a slightly
 * smaller block within that space".
 *
 * Square, not 10x14: a 16-tall body on a 24 grid still occupies exactly ONE
 * row, so everything the corridor reservation in cr-level.js means is
 * unchanged, and a one-block-tall opening passes it with 8px to spare.
 */
var CR_PW = 16;
var CR_PH = 16;

// ===================================================
//   PHYSICS
// ===================================================
// Virtual px and seconds. Derived consequences are in the comments because the
// generator reads them as hard limits and a bare number cannot say that.
/*
 * Virtual px and seconds, retuned for the 24px grid (2026-10-17).
 *
 * THE ONE FACT EVERYTHING ELSE IS CHOSEN TO MAKE TRUE:
 *
 *     a plain jump clears a TWO-TILE GAP but not a TWO-TILE CLIMB.
 *
 * That is where the strategy the user asked for comes from. A jump that can do
 * both solves the level by itself and there is nothing to decide; a jump that
 * can do neither is just a slower walk. Splitting them means a 2-tile climb and
 * a 3-tile gap are double-jump-only, which turns the `dj` pickup from a bonus
 * into a key and makes WHERE YOU SPEND IT the decision of the level.
 *
 * The derived numbers, for the generator (crMaxGap reads them, it does not
 * assume them):
 *
 *     apex     = 290^2 / (2*1000) = 42px = 1.75 tiles   -> one tile up, never two
 *     airtime  = 2*290/1000       = 0.58s
 *     range    = 0.58 * 120       = 70px  = 2.9 tiles   -> crMaxGap 2
 *     with dj  ~ 4.4 tiles                              -> crMaxGap 3
 *
 * moveSpeed is 5 tiles/s where it used to be 6.75: slower in the units that
 * matter, which is "more slow-moving" as asked.
 */
var CR_PHYS = {
    gravity: 1000,
    moveSpeed: 120,
    airAccel: 1000,         // how fast you reach moveSpeed in the air
    groundAccel: 1700,
    friction: 1500,
    jumpVel: -290,
    doubleJumpVel: -260,
    jumpCutMul: 0.45,       // releasing jump early clips the arc (variable height)
    maxFall: 420,
    dashVel: 280,
    dashTime: 0.18,
    dashCooldown: 0.6,
    dashTapWindow: 0.26,    // double-tap a direction inside this to dash
    springVel: -330,        // apex 54px = 2.3 rows
    springVx: 230,          // forward throw; reach ~6.3 tiles
    springHeldBonus: -40,   // holding jump as you touch a branch springs higher
    maxSpeedAir: 330,       // ceiling on carried momentum (spring, dash, gust)
    wallSlide: 54,          // terminal fall speed while clinging
    wallJumpVy: -270,
    wallJumpVx: 160,
    wallSteerLock: 0.12,    // short on purpose: you can press BACK into the same
                            // wall before the lock expires, which is what makes
                            // the Celeste back-and-forth possible
    wallStickGrace: 0.10,   // keeps a cling alive across a 1-frame gap in the wall
    /*
     * COYOTE AND BUFFER ARE THE *LATE-LEVEL* VALUES. crLevelSpec scales them
     * up for the early levels -- "the game should allow for imprecise input"
     * early on, and a late press or an early one still works there. See
     * crForgiveness and where cr-physics.js reads it.
     */
    coyote: 0.09,
    jumpBuffer: 0.10,
    bounceHead: -220,       // landing on another player's head
    bounceSquash: 70,       // ...and what it does to the one underneath
    bounceShove: 80,
    shoveSpeed: 95,         // how hard a mover pushes a standing body out of a doorway
    respawnDelay: 0.75,     // how long a checkpoint respawn costs you

    /*
     * THE GRAPPLE. One key, and the game does the aiming.
     *
     * This is the SpeedRunners answer to "more dynamic and easy to play", and
     * the two halves of that are not in tension: what makes a grapple feel good
     * is the ARC, and what makes it hard in most games is the AIM. Take the
     * aiming away (crFindAnchor picks for you) and all that is left is when to
     * fire and when to let go -- two decisions, no precision, and a swing that
     * carries you further than any jump in the game.
     *
     * range      how far it will reach for a ring
     * ropeMin    how short the reel-in will pull you; the swing tightens and
     *            speeds up as you rise, which is where the "fling" comes from
     * reel       px/s the rope shortens while you hold on
     * pump       tangential push from left/right, so you can work a swing the
     *            way you work a playground swing
     * release    a small kick on let-go, because an arc that ends in a shrug
     *            does not read as having been worth doing
     */
    grappleRange: 176,
    /* 46, not 34: the ring is bolted to rock, so a rope that reels in to
       under a tile and a half swings you straight up into the ceiling it hangs
       from. Two tiles keeps you clear of it and still tightens the arc. */
    grappleRopeMin: 46,
    grappleReel: 85,
    grapplePump: 560,
    grappleRelease: 1.12,
    grappleCool: 0.18,
    restitutionWall: 0.8,   // a stationary player is immovable; you take it all
    restitutionPair: 0.75,  // both moving: equal-mass elastic along the normal
    stillSpeed: 12          // under this, and on the ground, you ARE a wall
};

/*
 * How much the controls forgive, by level. 1.0 is the CR_PHYS value above
 * (the strictest); level 1 gets nearly double the coyote window and buffer.
 *
 * This is a real mechanic, not a difficulty label: a player who presses jump a
 * sixth of a second after walking off a ledge still jumps on level 1 and does
 * not on level 10, and nothing on screen changes to say so. It is the part of
 * "early levels allow imprecise input" that cannot be done with geometry.
 */
function crForgiveness(index) {
    var t = index / (CR_LEVEL_COUNT - 1);
    return 1.8 - 0.8 * t;                  // 1.8 at level 1, 1.0 at level 10
}

// ===================================================
//   TILES
// ===================================================
// The three collapsing/standing kinds the spec asks for are 1, 2 and 3, and
// each gets its own silhouette in cr-render.js -- "unique look for each" was
// asked for explicitly, so it is a requirement rather than a nicety.
var CR_T = {
    EMPTY: 0,
    STONE: 1,       // stationary
    CRUMBLE: 2,     // falls IMMEDIATELY on touch
    TIMED: 3,       // falls a few seconds after touch
    BREAK: 4,       // RETIRED 2026-10-17 with the bombs; kept so tile values do not shift
    BRANCH: 5,      // springs you on landing
    CATWALK: 6,     // the finish
    OUTPOST: 7,     // the comms structure at both ends
    VENT: 8,        // an opening in the cliff; its gust field is a separate rect
    /* A GRAPPLE RING bolted to an overhang. NOT SOLID -- you pass through it,
       you do not stand on it -- which is why it can live in a cell that would
       otherwise be air and why line-of-sight never has to special-case it. */
    ANCHOR: 9
};

// Which codes stop a body. BRANCH is solid from above only (see crTileSolid).
var CR_SOLID = {};
CR_SOLID[CR_T.STONE] = true;
CR_SOLID[CR_T.CRUMBLE] = true;
CR_SOLID[CR_T.TIMED] = true;
CR_SOLID[CR_T.BREAK] = true;
CR_SOLID[CR_T.CATWALK] = true;
CR_SOLID[CR_T.OUTPOST] = true;
CR_SOLID[CR_T.VENT] = true;

var CR_TIMED_FUSE = 1.4;        // seconds from touch to collapse
var CR_CRUMBLE_SHAKE = 0.08;    // the instant kind still shakes for a frame or two
/*
 * JUMP PADS. The chevron used to be a pickup you consumed; the user's call is
 * a STATION that recharges on a delay -- "kind of like in Rocket Jump, at
 * little pads with a dot". The difference matters: a pickup is a thing you
 * race your neighbours to and then it is gone, while a pad is a place that is
 * contested over and over, which is exactly the sort of thing four people can
 * have a fight about. It also pairs with the bottlenecks: a pad ON a gate is a
 * queue.
 */
var CR_PAD_RECHARGE = 3.2;      // seconds before a pad can be taken again

// ===================================================
//   SANDBOX SWITCH
// ===================================================
/*
 * TRUE = the free-play sandbox (cr-sandbox.js): one player, no bots, no avalanche,
 * a camera that follows you, and a big hand-built map. FALSE = the real game.
 * The user's call 2026-10-17, while the level design is worked out. The real
 * game's code is untouched by this, so flipping it back is the whole change.
 * scripts/cliff-run-playtest.js sets it false before it drives anything.
 */
var CR_SANDBOX = true;

// ===================================================
//   THE RUN
// ===================================================
var CR_LEVEL_COUNT = 10;
var CR_BASE_SEED = 0x5C11FF;    // replaced by the room seed when MP lands; see SERVER_NOTES.md

/*
 * Per-level knobs. Scroll speed is the FLOOR on pace, not the pace: cr-boot.js
 * also pushes the camera forward when the leader passes 70% of the screen, so
 * a good player is never held back by it.
 *
 * SLACK is what the scroll ramp actually controls: moveSpeed / scroll, i.e.
 * how many times longer the camera takes to cross the level than running it
 * flat out does. 120/24 = 5.0 on level 1, 120/46 = 2.6 on level 10. Level 1 is
 * deliberately very slack -- the avalanche is a presence rather than a threat
 * while you are still learning which blocks hold.
 *
 * Levels are SHORT: 60 to 80 tiles, about 20-28 seconds each, ten of them in
 * roughly four minutes. That is SCOPE_RULES.md rule 0's window, and it is also
 * what "compact" has to mean for a level that is only 20 tiles wide on screen.
 *
 * THE FEATURE GATES ARE THE TEACHING ORDER, one new idea every two levels:
 *   1-2   ground and gaps, a floor under the world, nothing that can kill you
 *         except falling behind
 *   3-4   the void opens, collapsing blocks, one-block squeezes
 *   5-6   branches and wind tunnels
 *   7-8   wall-jump chimneys
 *   9-10  gaps only a double jump crosses (bomb walls were scrapped 2026-10-17)
 */
function crLevelSpec(index) {
    var t = index / (CR_LEVEL_COUNT - 1);          // 0..1
    return {
        index: index,
        seed: (CR_BASE_SEED + index * 7919) | 0,
        /* WITH A CAMERA THAT CANNOT BE PUSHED, THESE TWO NUMBERS ARE THE
           LEVEL'S DURATION: worldW / scroll, exactly. 50 tiles at 50 px/s is
           24 seconds; 70 at 72 is 23. Ten of those is about four minutes,
           which is SCOPE_RULES.md rule 0's window, and now it is a property
           the generator sets rather than an emergent result of how fast the
           quickest bot happened to be.
           The SLACK -- moveSpeed / scroll -- is what makes level 1 gentle and
           level 10 tight: 2.4 falling to 1.7. You are never racing the wall on
           level 1, you are learning which blocks hold. */
        /* 60 -> 80 tiles is a MEASURED compromise, not a guess. The level's
           length is now its duration, so it is also how many chances the bots
           get to wedge themselves on something: at 70-95 tiles (24-25s) the
           bot finish rate fell from 63% to 38%, almost all of it avalanche
           deaths, because a longer level is simply more opportunities to
           stall. At 50-70 (11s) the bots did well and ten levels went by in
           two minutes with no room for any of them to be different.
           60 -> 80 is ~19-20s a level, about 3.5 minutes for the ten. The
           stalling is the real bug (cliff-run/CLAUDE.md); this is the length
           that is honest about it in the meantime. */
        cols: Math.round(64 + t * 22),             // 64 -> 86 tiles
        /* 38 -> 56, down a quarter, and the bottlenecks are what paid for it.
           A gate makes every lane climb to a shared ledge, and climbing buys
           no ground: the same levels that ran at 53% before gates ran at 28%
           after, with falls near zero and almost every death the avalanche.
           The structure was right and the clock was wrong.
           Slack (moveSpeed / scroll) is now 3.2 falling to 2.1, and a level is
           about 25 seconds either end -- which is also the "slightly longer
           levels" that was asked for. */
        scroll: 38 + t * 18,                       // 38 -> 56 px/s
        forgiveness: crForgiveness(index),
        // "maybe the first two levels lack the ability to fall off the map and
        // lose" -- so they get a floor, and from level 3 the void is real.
        safeFloor: index <= 1,
        crumble: index >= 2,
        tunnels: index >= 2,
        branches: index >= 4,
        vents: index >= 4,
        shafts: index >= 6,
        // Gaps a plain jump cannot cross, which therefore need the charge.
        djGaps: index >= 7,
        difficulty: t
    };
}

// ===================================================
//   STATE
// ===================================================
// Declared here, written by cr-boot/cr-level. One mutable bag per concern
// rather than forty loose globals, because every name in this file is visible
// to every other file on the page.
var crPhase = "menu";           // menu | ready | play | between | over
var crLevelIndex = 0;
var crLevel = null;             // the object cr-level.js builds
var crPlayers = [];             // all four, alive or not, for the whole run
var crBodies = [];              // the ones in play on THIS level
var crCoins = [];
var crPickups = [];
var crFalling = [];             // blocks that have detached and are in the air
var crParticles = [];
var crCam = { x: 0, y: 0, shake: 0 };
var crAvalancheX = 0;
var crRunTime = 0;
var crLevelTime = 0;
var crReadyLeft = 0;            // the pre-level countdown, in seconds
var crBetweenLeft = 0;          // how long the "level clear" card stays up
var crScoreTotal = 0;           // the human's running total across levels
var crHiScore = 0;
var crFinishOrder = [];
var crWinnerName = "";
var crFrame = 0;
var crLastDeath = "";           // "fall" | "avalanche" | "" -- what the over screen says
var crAttractRunning = false;

var crCanvas = null;
var crCtx = null;
var crScale = 1;

// The four seats. Order IS the spawn order the spec asks for: P1 top-left,
// P2 upper-middle, P3 lower-middle, P4 lower-left.
var CR_SEAT_NAMES = ["P1", "P2", "P3", "P4"];

// ===================================================
//   TEARDOWN PLUMBING
// ===================================================
// Root CLAUDE.md's hard constraint: every timer through trackTimeout /
// trackInterval, every listener through ONE AbortController, so destroy()
// fully tears an instance down. Written this way from the first line rather
// than retrofitted, which is what four-d-pong/fp-core.js's own header says it
// wishes it had been.
var crListeners = null;         // AbortController, rebuilt by GameInstance.init()
var crTimeouts = new Set();
var crIntervals = new Set();

function crTrackTimeout(fn, ms) {
    var id = setTimeout(function () { crTimeouts.delete(id); fn(); }, ms);
    crTimeouts.add(id);
    return id;
}

function crTrackInterval(fn, ms) {
    var id = setInterval(fn, ms);
    crIntervals.add(id);
    return id;
}

function crClearTracked(id) {
    clearTimeout(id);
    clearInterval(id);
    crTimeouts.delete(id);
    crIntervals.delete(id);
}

function crClearAllTracked() {
    crTimeouts.forEach(clearTimeout);
    crIntervals.forEach(clearInterval);
    crTimeouts.clear();
    crIntervals.clear();
}

// ===================================================
//   INK
// ===================================================
// Read once from retro.css at boot so the tokens stay the single source, with
// literals as the file:// fallback -- getComputedStyle returns "" for a custom
// property the stylesheet never delivered.
var CR_INK = {
    ground: "#000000",
    hot: "#E8FFF4",
    mid: "#8FA89C",
    dim: "#2E3A34",
    amber: "#FFB000",
    cyan: "#00E5FF",
    magenta: "#FF2E88",
    // The world hue and its two darker steps. CLIFF_RUN_PLAN.md 1 explains why
    // this is a desaturated steel rather than one of 2.5's neons: the cliff is
    // the biggest thing on screen and four player colours are drawn on top of
    // it, so the terrain gets brightness and the entities get hue.
    rock: "#6F8FA8",
    rockMid: "#48606F",
    rockLow: "#263440",
    // The outpost is BUILT, so it is not made of the cliff: pale weathered
    // concrete, with moss on every ledge that has held water. Straight off the
    // reference the user attached -- a brutalist tower going green.
    concrete: "#7E8C8A",
    concreteMid: "#55615F",
    concreteLow: "#333C3B",
    moss: "#3E5F3A",
    mossLit: "#5C8450",
    dust: "#9FB0AE"
};

function crLoadInk() {
    if (typeof getComputedStyle !== "function" || typeof document === "undefined") return;
    var s = getComputedStyle(document.documentElement);
    var map = {
        hot: "--phos-hot", mid: "--phos-mid", dim: "--phos-dim",
        amber: "--sig-amber", cyan: "--sig-cyan", magenta: "--sig-magenta"
    };
    for (var k in map) {
        if (!Object.prototype.hasOwnProperty.call(map, k)) continue;
        var v = s.getPropertyValue(map[k]);
        if (v && v.trim()) CR_INK[k] = v.trim();
    }
}

// ===================================================
//   SEEDED RANDOM
// ===================================================
// mulberry32. A level must be reproducible from its seed: that is what makes
// the headless playtest meaningful and what lets the room seed replace
// CR_BASE_SEED later without touching the generator.
function crRng(seed) {
    var a = seed >>> 0;
    return function () {
        a = (a + 0x6D2B79F5) >>> 0;
        var t = a;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// ===================================================
//   SMALL HELPERS
// ===================================================
function crClamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }
function crLerp(a, b, t) { return a + (b - a) * t; }
function crSign(v) { return v < 0 ? -1 : (v > 0 ? 1 : 0); }

function crRectsOverlap(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

// Identity. ONE path, and it is IDENTITY.colorFromName -- there is no
// name->colour function in this game and there must never be one. Reality
// Rewrite wrote its own and it agreed with the server 0 times out of 10
// (AESTHETIC_GUIDE.md 5).
function crColorForName(name) {
    if (typeof IDENTITY !== "undefined" && IDENTITY.colorFromName) {
        return IDENTITY.colorFromName(name);
    }
    return CR_INK.hot;
}
