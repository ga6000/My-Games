// ===================================================
//   Desert Code Racer — core: constants, state, timers, params
// ===================================================
// Script #1 of the game. Every top-level name in this game starts with
// `dc` or `DC_` so it cannot collide with the shared modules (MP, PARTY,
// BOOTFLOW, HUBSCORE, CREW, SFX, RETRO, IDENTITY) on the same page
// (scripts/check-global-collisions.js).
//
// UNITS. The road is the classic pseudo-3D road: the track is a list of
// segments DC_SEG world units long; x is lateral in ROAD units, where
// -1..1 is the tarmac and the edge sits at |x| = 1. Speeds are world units
// a second; the readout is v / 30 MPH, so cruise (9,000) reads 300 MPH.
"use strict";

const DC_GAME = "desert-code-racer";
const DC_SEG = 200;
const DC_ROAD_W = 2000;             // world units from centre line to edge
const DC_DRAW = 240;                // segments drawn ahead
const DC_CAM_H = 1100;
const DC_CAM_DEPTH = 1 / Math.tan((96 / 2) * Math.PI / 180);
const DC_CAM_BACK = DC_CAM_H * DC_CAM_DEPTH;   // camera sits this far behind the bike

const DC_CRUISE = 9000;             // 300 MPH
const DC_BOOST = 12600;             // 420 MPH
const DC_BRAKE = 3600;              // 120 MPH
const DC_OFFROAD = 5400;
const DC_MPH = 1 / 30;

// The run: three legs, each a fixed COUNT of set pieces (SCOPE_RULES rule 0:
// the loop sets the length, there is no clock).
const DC_START_SEGS = 40;
const DC_LEG_SEGS = [2300, 2600, 2900];
const DC_LEG_PIECES = [10, 13, 16];
const DC_END_SEGS = 90;
const DC_LEG_NAMES = ["DOME BASE", "CHECKPOINT ALPHA", "CHECKPOINT BRAVO", "MOUNTAIN BASE"];

// Signal colours (AESTHETIC_GUIDE §2.2) and the world hue (§2.5).
const DC_COL = {
    amber: "#FFB000",
    cyan: "#00E5FF",
    magenta: "#FF2E88",
    hot: "#E8FFF4",
    mid: "#8FA89C",
    dim: "#2E3A34",
    hue: "#8A6BFF",                 // desert dusk violet: road, mountains, scrub
    label: "#FF3344"
};

// ---- params ----
function dcParam(name) {
    try { return new URLSearchParams(window.location.search).get(name); }
    catch (e) { return null; }
}
function dcFlag(name) {
    const v = dcParam(name);
    return v !== null && v !== "0" && String(v).toLowerCase() !== "false";
}

// Difficulty (Ry 2026-11-16: a casual/hardcore switch at session start for
// every game). PARTY does not expose one yet, so this reads it if PARTY ever
// does, then ?difficulty=, and defaults to HARDCORE.
function dcReadDifficulty() {
    let d = "";
    try {
        if (typeof PARTY !== "undefined" && typeof PARTY.difficulty === "function") d = PARTY.difficulty() || "";
    } catch (e) { d = ""; }
    if (!d) d = dcParam("difficulty") || "";
    return String(d).toLowerCase() === "casual" ? "casual" : "hardcore";
}
const DC_DIFF = dcReadDifficulty();
const DC_TUNE = DC_DIFF === "casual" ? {
    pips: 6, respawn: 1.8, track: 2.2, lock: 1.0, beamEvery: [7.5, 6.0, 4.8],
    krillEvery: [20, 15, 12], steal: 4.5, airT: 0.8
} : {
    pips: 4, respawn: 3.0, track: 1.6, lock: 0.75, beamEvery: [5.2, 4.0, 3.1],
    krillEvery: [15, 11, 8.5], steal: 3.0, airT: 0.7
};

// Tests only: ?timescale=4 runs the simulation four times as fast in fixed
// sub-steps (solo only; a room ignores it).
const DC_TIMESCALE = Math.max(1, Math.min(8, Number(dcParam("timescale")) || 1));
const DC_REDUCED = (function () {
    try { return window.matchMedia("(prefers-reduced-motion: reduce)").matches; }
    catch (e) { return false; }
})();

// ---- timers and listeners: one list, one AbortController (GAME_PROTOTYPE_INSTRUCTIONS §1) ----
let dcTimers = [];
const dcAbort = new AbortController();
function trackTimeout(fn, ms) { const t = setTimeout(fn, ms); dcTimers.push(t); return t; }
function trackInterval(fn, ms) { const t = setInterval(fn, ms); dcTimers.push(t); return t; }
function dcClearTimers() {
    for (let i = 0; i < dcTimers.length; i++) { clearTimeout(dcTimers[i]); clearInterval(dcTimers[i]); }
    dcTimers = [];
}
function dcOn(target, type, fn, opts) {
    const o = Object.assign({ signal: dcAbort.signal }, opts || {});
    target.addEventListener(type, fn, o);
}

// ---- small maths ----
function dcClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function dcLerp(a, b, t) { return a + (b - a) * t; }
function dcNow() { return performance.now(); }

// ---- the game state (one object, so tests can read it) ----
const dc = {
    mode: "boot",           // boot | crawl | ready | play | aftermath | result
    demo: false,            // the attract run behind the ready check
    simT: 0,                // seconds of simulation since the run began
    track: null,            // built by dc-track.js
    hazards: [],            // static set pieces of the whole run
    me: null,               // the local rider
    riders: {},             // id -> rider (me included)
    beams: [],
    krill: [],
    beacons: [],
    shields: {},            // rider id -> until (simT)
    rams: {},               // rider id -> until (simT)
    fx: [],                 // particles, bursts, scorches
    texts: [],              // floating stroke texts
    caseS: null,            // { holder, z, x, pips, lying, v }
    leg: 0,                 // 0..2, the leg the case is on
    team: 0,                // team bonus points (checkpoints, clear)
    result: null,
    hostT: { beam: 0, krill: 0 },
    crashLog: [],
    pipLog: [],                 // why the case lost pips (host; tests read it)               // why the local bike went down (tests read it)
    nextId: 1
};

function dcSelfId() {
    return (typeof MP !== "undefined" && MP.status() === "online" && MP.selfId) ? MP.selfId : "solo";
}
function dcOnline() {
    return typeof MP !== "undefined" && MP.status() === "online";
}
function dcIsHost() {
    if (dc.demo) return true;           // the attract run is its own host
    return typeof MP === "undefined" ? true : MP.isHost();
}
