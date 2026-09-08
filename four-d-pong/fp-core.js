// ===================================================
//   4D Pong -- constants, seats, state, geometry, teardown
// ===================================================
// Split out of four-d-pong.html's inline script 2026-09-06, at the same time
// the game was promoted off under-development/ and rebuilt for 1-4 players.
// See four-d-pong/FOUR_D_PONG_PLAN.md for why each of the three filters
// (aesthetic / segmentation / audio) changed what it changed.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). Loads FIRST: every other fp-*.js reads the state declared here.
//
// This file resolves the canvases from the DOM and CALLS resize() at load
// time, which is why the <script> tags sit at the END of <body>.
"use strict";

// ===================================================
//   SEATS
// ===================================================
// A seat is a position on the field, not a person. Every mode fills the same
// four slots with HUMAN / CPU / EMPTY, which is what keeps one set of physics
// and one renderer serving all four modes -- the 4-player game is not a
// separate code path, it is the same code path with two more seats filled.
//
// Order matters: LEFT/RIGHT are the horizontal axis, TOP/BOTTOM the vertical,
// and fp-tug.js indexes the axes by (seat >> 1).
var LEFT = 0, RIGHT = 1, TOP = 2, BOTTOM = 3;

var SEAT_NAMES = ["LEFT", "RIGHT", "TOP", "BOTTOM"];

// Seats 0/1 are vertical-moving paddles on the left and right walls; seats 2/3
// are horizontal-moving paddles on the top and bottom. `sign` is which way the
// seat's goal faces, and is what lets one collision routine serve all four.
var SEAT_AXIS = ["y", "y", "x", "x"];   // the coordinate the paddle SLIDES along
var SEAT_SIGN = [-1, 1, -1, 1];         // -1 = min edge (left/top), +1 = max edge

var HUMAN = "human", CPU = "cpu", EMPTY = "empty";

// ===================================================
//   MODES
// ===================================================
// The brief, as a table:
//   1P  you vs one CPU, difficulty selectable    -- horizontal only
//   2P  "keep as is": the game that already existed
//   3P  three humans plus a CPU in the BOTTOM seat, "which makes it 4"
//   4P  four humans
//
// BOTTOM is the seat the CPU takes at 3P because its cluster (J/L) is the one
// a third person is least likely to have already reached for.
//
// `axes: 1` means only the horizontal axis is live, so top and bottom are
// WALLS the ball bounces off -- that physical fact is what "keep 2 player as
// is" means. `axes: 2` means all four edges are goals.
var MODES = {
    1: { players: 1, axes: 1, seats: [HUMAN, CPU,   EMPTY, EMPTY], aspect: 16 / 9, label: "1P  VS CPU" },
    2: { players: 2, axes: 1, seats: [HUMAN, HUMAN, EMPTY, EMPTY], aspect: 16 / 9, label: "2P  LEFT / RIGHT" },
    3: { players: 3, axes: 2, seats: [HUMAN, HUMAN, HUMAN, CPU],   aspect: 1,      label: "3P  + 1 CPU" },
    4: { players: 4, axes: 2, seats: [HUMAN, HUMAN, HUMAN, HUMAN], aspect: 1,      label: "4P  ALL FOUR SIDES" }
};

// ===================================================
//   TUNING
// ===================================================
// Speeds are per SECOND, not per frame. The file this replaces added
// `ball.speedX` once per requestAnimationFrame with no dt, so it ran 2.4x
// faster on a 144Hz monitor than on a 60Hz one. fp-boot.js now steps a fixed
// 60Hz accumulator and these are the units that go with it.
var STEP_MS = 1000 / 60;
var STEP_S = STEP_MS / 1000;
var MAX_CATCHUP_STEPS = 5;   // a backgrounded tab must not simulate 40 seconds at once

var PADDLE_LONG = 104;       // length ALONG the edge the paddle slides on
var PADDLE_THICK = 14;       // depth into the field
var PADDLE_SPEED = 430;      // px/s

var BALL_SIZE = 16;          // 6.6: a SQUARE ball, so this is a side, not a radius
var BALL_HALF = BALL_SIZE / 2;
var BALL_START_SPEED = 340;  // px/s
var BALL_SERVE_SPREAD = 0.62; // radians of launch jitter either side of the axis

var BLASTER_SPEED = 620;     // px/s
var BLASTER_LONG = 22;
var BLASTER_THICK = 8;
var STUN_MS = 1000;
var BLASTER_COOLDOWN_MS = 3000;
var MACHINE_GUN_MS = 200;

var POWERUP_SIZE = 14;
var POWERUP_FIRST_MS = 2000;
var POWERUP_RESPAWN_MS = 5000;

var PADDLE_GROWTH = 25;      // px of paddle per goal past the desperation threshold
var PADDLE_LONG_MAX = 260;   // the old file had no cap; at -20 the paddle became the wall

// The middle ground. A paddle may advance until its INNER EDGE reaches
// centre +/- NEUTRAL_ZONE/2 -- i.e. it may cross the centre line by half the
// zone, which is what puts the power-up (which sits on the centre) inside
// everyone's reach. Getting this sign wrong is exactly how the two-paddle game
// lost access to it: see maxDepth() in fp-entities.js.
var NEUTRAL_ZONE = 100;
var CORNER_FRAC = 0.14;      // 2.3 of the plan: corner bumpers, four-paddle modes only

var PLATE_MARGIN = 44;       // stage inset: seat labels, cooldown bars, barbell overhang
var FIELD_MARGIN = 10;       // ...and the inset when there are no barbells to leave room for

// ---------------------------------------------------------------------------
// SERVE SPEED RAMPS WITH MATCH TIME
// ---------------------------------------------------------------------------
// AESTHETIC_GUIDE 7 item 2 calls Space Invaders' speed-up "the era's
// accidental masterpiece" and recommends it repo-wide: a free difficulty curve
// that costs one line. Here it solves a specific problem rather than a general
// one -- two evenly matched players (or four) can rally a tug-of-war to a
// standstill, and a game that cannot end is a worse outcome than a fast one.
//
// It ramps the SERVE, not the rally. The rally already accelerates 5-7% per
// paddle hit and is reset by every goal; what needed to move was the floor that
// each new point starts from.
var SERVE_RAMP_PER_MIN = 0.14;   // +14% of the base serve speed per minute
var SERVE_RAMP_MAX = 0.9;        // ...capped at +90%, which is already frantic

// 4.4 -- the virtual pixel grid. RENDER ONLY. Quantizing physics is how you
// get collision bugs that present as gameplay bugs.
var SNAP = 4;

// ===================================================
//   ELEMENTS
// ===================================================
var backCanvas = document.getElementById("fpBack");
var fieldCanvas = document.getElementById("fpField");
var backCtx = backCanvas.getContext("2d");
var fieldCtx = fieldCanvas.getContext("2d");

var stageEl = document.getElementById("stage");
var menuEl = document.getElementById("menu");
var menuTitleEl = document.getElementById("menuTitle");
var menuKeysEl = document.getElementById("menuKeys");
var modeRowEl = document.getElementById("modeRow");
var diffRowEl = document.getElementById("diffRow");
var diffLabelEl = document.getElementById("diffLabel");
var startBtnEl = document.getElementById("startBtn");
var insertCoinEl = document.getElementById("insertCoin");
var modeLabelEl = document.getElementById("modeLabel");
var netStatusEl = document.getElementById("netStatus");
var hintEl = document.getElementById("hint");

var tugBarEl = document.getElementById("tugBar");
var tugFillEl = document.getElementById("tugFill");
var tugDividerEl = document.getElementById("tugDivider");
var tugNetEl = document.getElementById("tugNet");

// ===================================================
//   TEARDOWN PLUMBING
// ===================================================
// Root CLAUDE.md's hard constraint: every timer through trackTimeout /
// trackInterval, every listener through one AbortController, so destroy()
// fully tears an instance down.
//
// The file this replaces used seven raw setTimeout/setInterval calls (stun,
// blaster cooldown, machine gun, power-up respawn, countdown) and attached its
// listeners bare to window. Both are fixed here rather than "later": the whole
// point of the rule is that it is cheap up front and expensive to retrofit,
// and this file is the retrofit.
var listeners = null;         // AbortController, rebuilt by GameInstance.init()
var timeouts = new Set();
var intervals = new Set();

function trackTimeout(fn, ms) {
    var id = setTimeout(function () { timeouts.delete(id); fn(); }, ms);
    timeouts.add(id);
    return id;
}

function trackInterval(fn, ms) {
    var id = setInterval(fn, ms);
    intervals.add(id);
    return id;
}

function clearTracked(id) {
    clearTimeout(id);
    clearInterval(id);
    timeouts.delete(id);
    intervals.delete(id);
}

function clearAllTracked() {
    timeouts.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    timeouts.clear();
    intervals.clear();
}

// ===================================================
//   IDENTITY
// ===================================================
// Used for exactly ONE thing: a cap on the LOCAL player's paddle, so the
// person who clicked through from the hub is the same colour here that they
// were on the board. Everything else on this field is phosphor white, which
// 6.6 asks for and which the world hue (#FFFFFF) already says.
//
// There is NO name->colour function in this game and there must never be one.
// The server's answer wins (MP.selfColor); IDENTITY.colorFromName is the
// file:// fallback, and it is the single client-side implementation. Reality
// Rewrite -- the game this one replaced on the board -- once had its own
// scheme that agreed with the server 0 times out of 10.
var identity = { name: "", color: null };
var mpConnected = false;

function resolveIdentity(config) {
    var cfg = config || {};
    var params = null;
    try { params = new URLSearchParams(window.location.search); } catch (e) { params = null; }

    var name = cfg.name || (params && params.get("name")) || "";
    var color = cfg.color || null;
    if (!color) {
        color = (typeof MP !== "undefined" && MP.selfColor)
            ? MP.selfColor
            : (name && typeof IDENTITY !== "undefined" ? IDENTITY.colorFromName(name) : null);
    }
    return { name: name, color: color };
}

// ===================================================
//   STATE
// ===================================================
// PHASES
//   "menu"     mode select is up; the sim may be running as attract mode
//   "count"    3-2-1 before the serve
//   "play"     live
//   "paused"   space, or the tab lost focus
//   "over"     a barbell reached a win line
var phase = "menu";

var modeKey = 2;                 // which MODES entry is selected
var mode = MODES[2];
var difficulty = "medium";       // 1P only; the 3P CPU is always medium
var attractRunning = false;      // 4.8 -- the sim playing itself behind the menu
var attractCtl = null;           // RETRO.attract() handle

var seats = [];                  // four paddle objects, EMPTY seats included
var ball = null;
var blasters = [];
var particles = [];
var powerup = null;
var powerupTimer = null;

var rallyHits = 0;               // drives the audible rally pitch in fp-audio.js
var matchStartAt = 0;            // performance.now() at the last serve-off; drives the ramp
var countdown = 0;
var countdownTimer = null;
var winnerSeat = -1;
var frameCount = 0;              // 4.7 flicker budget wants a frame parity

var muted = false;

// The playfield rectangle inside the stage, in CSS pixels. Everything in the
// simulation is expressed relative to this, so a resize moves the geometry and
// nothing else.
var field = { x: 0, y: 0, w: 0, h: 0 };
var stageW = 0, stageH = 0;

// ===================================================
//   GEOMETRY
// ===================================================
// Both canvases cover the whole stage; the FIELD is a rect inside it. That gap
// is not decoration -- it is where the barbell plates live, which is how they
// end up visibly behind and around the play area rather than under it.
function resize() {
    var rect = stageEl.getBoundingClientRect();
    stageW = Math.max(1, Math.floor(rect.width));
    stageH = Math.max(1, Math.floor(rect.height));

    // Cap the device pixel ratio. A 3x phone would quadruple the fill cost of
    // the persistence pass for no visible gain on a game made of squares.
    var dpr = Math.min(window.devicePixelRatio || 1, 2);

    [backCanvas, fieldCanvas].forEach(function (c) {
        c.width = Math.round(stageW * dpr);
        c.height = Math.round(stageH * dpr);
    });
    // setTransform, not scale: resize() runs repeatedly and scale() compounds.
    backCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    fieldCtx.setTransform(dpr, 0, 0, dpr, 0, 0);

    var m = mode.axes === 2 ? PLATE_MARGIN : FIELD_MARGIN;
    var availW = Math.max(80, stageW - m * 2);
    var availH = Math.max(80, stageH - m * 2);

    var w = availW;
    var h = w / mode.aspect;
    if (h > availH) { h = availH; w = h * mode.aspect; }

    field.w = Math.floor(w);
    field.h = Math.floor(h);
    field.x = Math.floor((stageW - field.w) / 2);
    field.y = Math.floor((stageH - field.h) / 2);

    // Paddles are positioned as a fraction of the edge they slide on, so they
    // survive a resize mid-rally instead of jumping to a corner.
    for (var i = 0; i < seats.length; i++) placeSeat(seats[i]);

    if (typeof drawBarbells === "function") drawBarbells();
}

// The span a paddle may slide within, in field-local coordinates. In the
// four-paddle modes the corner bumpers eat both ends of it -- a paddle that
// could reach into a corner would be standing where the bumper already is.
function slideSpan(seat) {
    var along = (SEAT_AXIS[seat.index] === "y") ? field.h : field.w;
    var inset = (mode.axes === 2) ? cornerSize() : 0;
    return { min: inset, max: along - inset };
}

function cornerSize() {
    return Math.round(Math.min(field.w, field.h) * CORNER_FRAC);
}

// ===================================================
//   PALETTE
// ===================================================
// Canvas cannot read a CSS custom property, so the Signal Three and the
// phosphor whites have to be resolved to strings once and cached. Resolved
// rather than copied: shared/retro.css stays the single owner of the values
// ( 2.2), and a game that pasted "#FFB000" into a canvas call would be the
// start of the same drift that put four copies of the identity palette in
// this repo.
//
// Cached for the life of the page, which is correct HERE and would not be for
// every game: this cabinet's world hue is a constant (#FFFFFF). A game that
// shifts a token from script -- Reality Rewrite does -- must not copy this.
var paletteCache = {};

function tokenColor(name) {
    if (paletteCache[name]) return paletteCache[name];
    var v = "";
    try {
        // FROM <body>, NOT documentElement. The per-game world hue is set by
        // [data-game="four-d-pong"] in shared/retro.css, and that attribute is on
        // <body> -- reading :root returns the generic --phos-mid default instead,
        // which is a valid colour, so the walls simply drew grey-green and nothing
        // anywhere reported a problem.
        v = getComputedStyle(document.body).getPropertyValue(name).trim();
    } catch (e) { v = ""; }
    // The fallbacks are only reached if retro.css failed to load at all, in
    // which case a playable grey game beats an invisible one.
    if (!v) v = { "--phos-hot": "#E8FFF4", "--phos-mid": "#8FA89C", "--phos-dim": "#2E3A34",
                  "--sig-amber": "#FFB000", "--sig-cyan": "#00E5FF", "--sig-magenta": "#FF2E88",
                  "--world-hue": "#FFFFFF", "--ground": "#000000" }[name] || "#8FA89C";
    paletteCache[name] = v;
    return v;
}

// ===================================================
//   MISC
// ===================================================
function clamp(v, lo, hi) { return v < lo ? lo : (v > hi ? hi : v); }

function axisOf(seatIndex) { return seatIndex >> 1; }   // 0 = horizontal, 1 = vertical

function activeSeats() {
    var out = [];
    for (var i = 0; i < seats.length; i++) {
        if (seats[i] && seats[i].kind !== EMPTY) out.push(seats[i]);
    }
    return out;
}

resize();
