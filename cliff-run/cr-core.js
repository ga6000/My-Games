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
// 480x288 is 30x18 tiles. Integer-scaled and letterboxed by crResize(), with
// image-rendering: pixelated -- a raster cabinet drawing on a coarse grid
// (AESTHETIC_GUIDE.md 1), not a high-res game with a filter over it.
var CR_VW = 480;
var CR_VH = 288;
var CR_TILE = 16;
var CR_COLS_ON_SCREEN = CR_VW / CR_TILE;   // 30
var CR_ROWS = CR_VH / CR_TILE;             // 18

// Player body. 10x14 at this resolution is the spec's "somewhat small on
// screen" -- a shade under one tile wide, so a 1-tile ledge is a real ledge.
var CR_PW = 10;
var CR_PH = 14;

// ===================================================
//   PHYSICS
// ===================================================
// Virtual px and seconds. Derived consequences are in the comments because the
// generator reads them as hard limits and a bare number cannot say that.
var CR_PHYS = {
    gravity: 760,
    moveSpeed: 108,
    airAccel: 900,          // how fast you reach moveSpeed in the air
    groundAccel: 1500,
    friction: 1200,
    jumpVel: -240,          // apex 37.9px = 2.37 tiles; airtime 0.63s; range 68px = 4.2 tiles
    doubleJumpVel: -216,
    jumpCutMul: 0.45,       // releasing jump early clips the arc (variable height)
    maxFall: 300,
    dashVel: 260,
    dashTime: 0.18,
    dashCooldown: 0.6,
    dashTapWindow: 0.26,    // double-tap a direction inside this to dash
    springVel: -420,        // apex 116px = 7.2 tiles; range ~119px = 7.4 tiles
    springHeldBonus: -60,   // holding jump as you touch a branch springs higher
    wallSlide: 46,          // terminal fall speed while clinging
    wallJumpVy: -230,
    wallJumpVx: 140,
    wallSteerLock: 0.12,    // short on purpose: you can press BACK into the same
                            // wall before the lock expires, which is what makes
                            // the Celeste back-and-forth possible
    wallStickGrace: 0.10,   // keeps a cling alive across a 1-frame gap in the wall
    coyote: 0.09,
    jumpBuffer: 0.10,
    bounceHead: -190,       // landing on another player's head
    bounceSquash: 60,       // ...and what it does to the one underneath
    bounceShove: 70,
    restitutionWall: 0.8,   // a stationary player is immovable; you take it all
    restitutionPair: 0.75,  // both moving: equal-mass elastic along the normal
    stillSpeed: 12          // under this, and on the ground, you ARE a wall
};

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
    BREAK: 4,       // needs a bomb
    BRANCH: 5,      // springs you on landing
    CATWALK: 6,     // the finish
    OUTPOST: 7,     // the comms structure at both ends
    VENT: 8         // an opening in the cliff; its gust field is a separate rect
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
var CR_BOMB_FUSE = 1.6;
var CR_BOMB_RADIUS = 26;        // blast reach, in px, from the bomb's centre

// ===================================================
//   THE RUN
// ===================================================
var CR_LEVEL_COUNT = 10;
var CR_BASE_SEED = 0x5C11FF;    // replaced by the room seed when MP lands; see SERVER_NOTES.md

// Per-level knobs. Scroll speed is the floor on pace, not the pace: crCamera
// also pushes forward when the leader passes 70% of the screen, so a good
// player is never held back by it.
function crLevelSpec(index) {
    var t = index / (CR_LEVEL_COUNT - 1);          // 0..1
    return {
        index: index,
        seed: (CR_BASE_SEED + index * 7919) | 0,
        cols: Math.round(150 + t * 40),            // 150 -> 190 tiles
        scroll: 46 + t * 50,                       // 46 -> 96 px/s
        // Feature gates, so the first levels teach and the later ones combine.
        shafts: index >= 3,
        bombs: index >= 5,
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
var crBombs = [];
var crFalling = [];             // blocks that have detached and are in the air
var crParticles = [];
var crCam = { x: 0, y: 0, shake: 0 };
var crAvalancheX = 0;
var crRunTime = 0;
var crLevelTime = 0;
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
    rockLow: "#263440"
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
