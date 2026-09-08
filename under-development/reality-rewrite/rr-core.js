// ===================================================
//   Reality Rewrite -- core state, input, lifecycle plumbing
// ===================================================
// Split out of reality-rewrite.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md ~2.1). This is the 6-file split that
// reality-rewrite/CLAUDE.md has described as PLANNED since before
// 2026-09-02 -- it now exists.
//
// Lines 211-375 were MOVED VERBATIM and IN SOURCE ORDER. Nothing was
// reordered: resize() is CALLED at load time, canvas/ctx resolve DOM at
// load time, and `mouse` reads the `width` that resize() set. Preserving
// the sequence is what makes the cut safe without hoisting anything.
//
// Classic scripts, one shared global scope, no modules (the file://
// hard constraint).
"use strict";

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

let width, height;
function resize() {
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = width; canvas.height = height;
}
resize();

// -----------------------------------------------------------
// MATH HELPERS (Restored)
// -----------------------------------------------------------
const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
const lerp = (a, b, t) => a + (b - a) * t;

// UI Elements
const ui = {
    timer: document.getElementById('match-timer'),
    stabBar: document.getElementById('stability-bar'),
    sbPlayer: document.getElementById('sb-player'),
    sbBots: document.getElementById('sb-bots'),
    hudHp: document.getElementById('hud-hp'),
    hudAmmo: document.getElementById('hud-ammo'),
    hudOrb: document.getElementById('hud-orb'),
    modal: document.getElementById('author-modal'),
    options: document.getElementById('author-options'),
    countdown: document.getElementById('author-countdown'),
    overlay: document.getElementById('fullscreen-overlay'),
    giantCount: document.getElementById('giant-countdown'),
    endRankings: document.getElementById('end-rankings'),
    cardsContainer: document.getElementById('active-cards'),
    vignette: document.getElementById('vignette')
};

// Game State
const STATE = { PLAYING: 0, AUTHOR_PHASE: 1, ENDING: 2, GAME_OVER: 3 };
let gameState = STATE.PLAYING;
let lastTime = performance.now();
let gameTimer = 180.0; // 3 minutes

// Mechanics
let stability = 100.0;
let camera = { x: 0, y: 0, shake: 0 };
let authorTimer = 0;
let activeCards = [];
let hasDuplicated = false;
let hitStop = 0; // brief dt dampening on player-involved kills, for punch

// Map Size (Starts at 3000x3000, symmetrical museum)
let mapBounds = { x: 0, y: 0, w: 3000, h: 3000 };

// Central pool feature, set by buildMap(). 'lobes' describes the quatrefoil: an
// elongated main body plus two side lobes, all drawn with the same fill so they
// visually fuse into one shape.
let waterFeature = { x: 0, y: 0, radius: 130 };
let poolLobes = [];
const POOL_EXCLUSION_RADIUS = 280;
const SPAWN_SAFE_DIST = 500;

// Card Database
const SHIFTS = [
    { id: 'ricochet', name: 'Ballistics', desc: 'Your bullets bounce.', type: 'buff', color: '#3498db' },
    { id: 'voidgun', name: 'Void Gun', desc: 'R-Click destroys terrain.', type: 'buff', color: '#9b59b6' },
    { id: 'phase', name: 'Phase', desc: 'Walk through cover.', type: 'buff', color: '#1abc9c' },
    { id: 'stasis', name: 'Stasis', desc: 'Enemy bullets are 90% slower.', type: 'debuff', color: '#e67e22' },
    { id: 'blind', name: 'Blind', desc: 'Drastically reduces enemy vision.', type: 'debuff', color: '#34495e' },
    { id: 'shrink', name: 'Shrink', desc: 'Arena walls close in.', type: 'global', color: '#e74c3c' },
    { id: 'growth', name: 'Growth', desc: 'All cover doubles in size.', type: 'global', color: '#2ecc71' },
    { id: 'fragility', name: 'Fragility', desc: 'All cover can be destroyed.', type: 'global', color: '#f1c40f' },
    { id: 'duplicate', name: 'Duplicate', desc: 'Arena quadruples in size.', type: 'global', color: '#ff00ff', unique: true }
];

// Input
const keys = {};
const mouse = { x: width/2, y: height/2, wx: 0, wy: 0, left: false, right: false };

function attachInputListeners(signal) {
    window.addEventListener('resize', resize, { signal });
    window.addEventListener('keydown', e => { 
        keys[e.key.toLowerCase()] = true; 
        if(e.key.toLowerCase()==='r' && player) player.forceReload(); 
        if(e.key.toLowerCase()==='e' && player) player.fireOrb();
    }, { signal });
    window.addEventListener('keyup', e => keys[e.key.toLowerCase()] = false, { signal });
    window.addEventListener('mousemove', e => { mouse.x = e.clientX; mouse.y = e.clientY; }, { signal });
    window.addEventListener('mousedown', e => { if(e.button === 0) mouse.left = true; if(e.button === 2) mouse.right = true; }, { signal });
    window.addEventListener('mouseup', e => { if(e.button === 0) mouse.left = false; if(e.button === 2) mouse.right = false; }, { signal });
}

const COSTS = { shoot: -0.5, barrier: -1.5, kill: -5, orb: -3 };
const RELOAD_TIME = 4.5;

// ---- Hub shell: lifecycle state + identity ----
let animFrameId = null;
let isPaused = false;
let listenerController = null;
let pendingTimers = [];
let identity = { name: 'YOU', color: '#3498db', room: 'public' };

// setTimeout/setInterval wrappers so destroy() can cancel anything still pending
// (respawn timers, the end-of-match countdown) instead of leaking callbacks.
function trackTimeout(fn, ms) {
    let id = setTimeout(() => { pendingTimers = pendingTimers.filter(t => t !== id); fn(); }, ms);
    pendingTimers.push(id);
    return id;
}
function trackInterval(fn, ms) {
    let id = setInterval(fn, ms);
    pendingTimers.push(id);
    return id;
}

// The local `nameHash()` that used to live here was REMOVED 2026-09-03.
// It hashed the same way as the hub but mapped the result onto a 360-hue wheel
// instead of the shared palette, so it produced a different colour for the same
// player -- 0 agreement across a 10-name sample. Colour now comes from the
// server (MP.selfColor), falling back to the one shared client implementation,
// `IDENTITY.colorFromName()` in shared/identity.js. Don't add a hash back here.

// Darkens a #rrggbb color for the arm shade. Anything else (hsl(), named colors)
// is returned unchanged, so it degrades gracefully rather than throwing.
function darken(hex, amt) {
    let m = /^#([0-9a-f]{6})$/i.exec(hex || '');
    if (!m) return hex;
    let num = parseInt(m[1], 16);
    let r = Math.max(0, Math.floor(((num >> 16) & 0xff) * (1 - amt)));
    let g = Math.max(0, Math.floor(((num >> 8) & 0xff) * (1 - amt)));
    let b = Math.max(0, Math.floor((num & 0xff) * (1 - amt)));
    return '#' + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
}

// Identity comes from (in order): an explicit config object passed to
// GameInstance.init(), then URL query params (?name=&color=&room=), then a
// standalone-testing default. Color prefers whatever the hub hands us — that's
// the hub's own name-hash, computed once and shared consistently across every
// game and screen — and only falls back to a local hash if we're opened directly.
function resolveIdentity(config) {
    const params = new URLSearchParams(window.location.search);
    const name = (config && config.name) || params.get('name') || 'YOU';
    // Precedence: explicit config -> ?color= -> the server's answer (if the
    // socket is already up) -> the shared client fallback. The hub does not
    // pass ?color=, so in practice this is MP.selfColor or IDENTITY.
    let color = (config && config.color) || params.get('color') ||
        (typeof MP !== 'undefined' && MP.selfColor) ||
        IDENTITY.colorFromName(name);
    const room = (config && config.room) || params.get('room') || 'public';
    return { name, color, room };
}

// True once MP.connect has been called; connect() is safe to call only once
// per page, and init() may run more than once (the lifecycle contract allows it).
let mpConnected = false;

// Entities Lists
let blocks = [];
let bullets = [];
let particles = [];
let players = [];
let orbs = [];
let fields = [];
let ripples = [];
let player;


// -----------------------------------------------------------
// THE SKIN — tokens read once, and the monitor's phosphor
// -----------------------------------------------------------
// AESTHETIC_GUIDE.md §6.12 wants each rule change to shift the monitor's
// phosphor (green -> amber -> cyan -> magenta), which is period-plausible
// (swapping a tube or taping a gel over it) and makes the core mechanic legible
// from across the room.
//
// THE GUIDE'S STATED PREMISE IS WRONG FOR THIS FILE. §6.12 says it "costs
// approximately one CSS custom property because the game already funnels colour
// through var(--stable-color)". It does not: --stable-color is the STABILITY
// METER's fill and nothing else. What the game funnels through a variable is
// nothing at all -- draw() read --bg-color out of getComputedStyle on EVERY
// FRAME, which is a forced style recalc per frame and the thing this block
// replaces. shared/retro.css already anticipated the shift and deliberately
// leaves --world-hue unset for this game so script can drive it.
//
// AND THE SIGNAL THREE ARE NOT AVAILABLE AS A WORLD HUE. §2.2 gives amber,
// cyan and magenta fixed meanings (value / system / danger). Three of the four
// tube colours §6.12 asks for ARE those tokens, so painting the whole world in
// one would make its signal stop reading. Resolved by role, not by picking
// different colours: the tube colour is applied only to WORLD STRUCTURE (the
// floor grid, the arena bounds, cover outlines) at low alpha, where it reads as
// a tinted tube. Signals stay small, hot and fully saturated, so they still
// carry meaning against any of the four.
const RRSKIN = {
    // Filled by read(), below. Defaults match shared/retro.css so the game is
    // still drawable if the stylesheet fails to load (file:// with the CSS
    // moved, say) rather than painting everything transparent-black.
    ground:  "#000000",
    phosHot: "#E8FFF4",
    phosMid: "#8FA89C",
    phosDim: "#2E3A34",
    amber:   "#FFB000",
    cyan:    "#00E5FF",
    magenta: "#FF2E88",

    // §6.12's four tube colours, in the order it names them.
    TUBES: ["#33FF33", "#FFB000", "#00E5FF", "#FF2E88"],
    tube: 0,
    hue: "#33FF33",

    read: function () {
        var cs = getComputedStyle(document.documentElement);
        function tok(name, fallback) {
            var v = cs.getPropertyValue(name);
            v = v ? v.trim() : "";
            return v || fallback;
        }
        this.ground  = tok("--ground",       this.ground);
        this.phosHot = tok("--phos-hot",     this.phosHot);
        this.phosMid = tok("--phos-mid",     this.phosMid);
        this.phosDim = tok("--phos-dim",     this.phosDim);
        this.amber   = tok("--sig-amber",    this.amber);
        this.cyan    = tok("--sig-cyan",     this.cyan);
        this.magenta = tok("--sig-magenta",  this.magenta);
        this.setTube(0);
    },

    // Sets both the JS-side hue used by canvas draws and the CSS custom
    // property, so DOM chrome and canvas geometry never disagree about which
    // tube is in the cabinet.
    setTube: function (i) {
        this.tube = ((i % this.TUBES.length) + this.TUBES.length) % this.TUBES.length;
        this.hue = this.TUBES[this.tube];
        document.documentElement.style.setProperty("--world-hue", this.hue);
    },

    // Called once per reality shift, from executeShift() in rr-phases.js.
    nextTube: function () { this.setTube(this.tube + 1); },

    // Structure is drawn in the tube colour at low alpha (see the note above).
    // Kept as a helper rather than inlined so there is one place that decides
    // how loud world geometry is allowed to be.
    structure: function (alpha) {
        var h = this.hue;
        var r = parseInt(h.slice(1, 3), 16);
        var g = parseInt(h.slice(3, 5), 16);
        var b = parseInt(h.slice(5, 7), 16);
        return "rgba(" + r + "," + g + "," + b + "," + alpha + ")";
    }
};

RRSKIN.read();

// -----------------------------------------------------------
// AUDIO — shared/sfx.js, gated by earshot
// -----------------------------------------------------------
// This game had no audio at all before 2026-09-05. It is procedural via
// shared/sfx.js rather than sample files, for the reason that file's own header
// gives: zero binary assets keeps the file:// hard constraint untouched, and
// square/triangle IS the era's palette (§4.10).
//
// WHY THE EARSHOT GATE. Up to six bots fire on a 0.12s cooldown. Playing every
// one of those unconditionally is not "arcade", it is a wall of noise that
// buries the shot that is about to kill you. Nearby shots are the ones that
// carry information, so distance decides -- there is no positional pan here
// (that lives in zombie/, because it is a property of that game's camera).
const EARSHOT = 1100;
function audible(x, y) {
    if (!player || player.hp <= 0) return true;   // spectating: hear everything
    return dist({ x: x, y: y }, player) < EARSHOT;
}
