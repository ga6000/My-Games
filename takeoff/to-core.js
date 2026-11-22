// ===================================================
//   Takeoff — core: canvas, camera, input, timers, shared state, helpers
// ===================================================
// Pass 1 (2026-11-21). The crew escort the human mothership from the
// ground to orbit. A lean vertical-scroll loop of its own: it borrows Gyro
// Fleet's look (Greer's hull, the creatures' flesh, the sfx voices) but not
// the gl-* orbit sim. See CLAUDE.md in this folder.
//
// Units: world x runs left to right (0 = the middle of the climb column),
// world y runs UP (altitude). The view is always TO.VH units tall; its
// width follows the window. Speeds are units per second.
"use strict";

const TO_DEV = /[?&]dev\b/.test(location.search);

// Teardown: every listener goes through one AbortController, every timer
// through toTimeout / toInterval (hub rule, GAME_PROTOTYPE_INSTRUCTIONS.md §1).
const toAbort = new AbortController();
const toTimers = new Set();
function toTimeout(fn, ms) { const id = setTimeout(function () { toTimers.delete(id); fn(); }, ms); toTimers.add(id); return id; }
function toInterval(fn, ms) { const id = setInterval(fn, ms); toTimers.add(id); return id; }
function toOn(el, ev, fn, opts) { el.addEventListener(ev, fn, Object.assign({ signal: toAbort.signal }, opts || {})); }

const TO = {
    VH: 700,            // view height in world units
    PWmax: 560,         // half-width of the climb column at most
    scroll: 70,         // climb speed of the camera
    gravity: 240,
    hull: 100,          // the mothership: the team's shared health
    gateHit: 34,        // a failed gate: about a third
    straggleHit: 4,     // the smaller blast when a player falls out of frame
    respawn: 4,         // seconds
    homeFrac: 0.50      // the mothership's resting height on screen (its centre)
};

const toCanvas = document.getElementById("toGame");
const toCtx = toCanvas.getContext("2d");
let toW = 0, toH = 0, toDpr = 1;
const toCam = { x: 0, y: 0, s: 1, VW: 1000, PW: 500, vx: 0, vy: 0, shake: 0 };

function toResize() {
    toDpr = Math.min(2, window.devicePixelRatio || 1);
    toW = window.innerWidth; toH = window.innerHeight;
    toCanvas.width = Math.round(toW * toDpr); toCanvas.height = Math.round(toH * toDpr);
    toCam.s = toH / TO.VH;
    toCam.VW = toW / toCam.s;
    toCam.PW = Math.min(TO.PWmax, toCam.VW / 2 - 10);
}
toOn(window, "resize", toResize);
toResize();

// world -> screen (CSS pixels)
function toSX(x) { return toW / 2 + (x - toCam.x) * toCam.s; }
function toSY(y) { return toH - (y - toCam.y) * toCam.s; }
function toWX(sx) { return toCam.x + (sx - toW / 2) / toCam.s; }
function toWY(sy) { return toCam.y + (toH - sy) / toCam.s; }
function toTopY() { return toCam.y + TO.VH; }

function toFrac(x) { return x - Math.floor(x); }
function toClamp(v, a, b) { return v < a ? a : (v > b ? b : v); }
function toRand(a, b) { return a + Math.random() * (b - a); }
function toDist(ax, ay, bx, by) { return Math.hypot(ax - bx, ay - by); }
function toLerp(a, b, k) { return a + (b - a) * k; }

// ---- input ----
const toKeys = {};
const toMouse = { sx: 0, sy: 0, down: false };
toOn(window, "keydown", function (e) {
    const k = e.key.length === 1 ? e.key.toLowerCase() : e.key;
    if (!toKeys[k]) toKeyPress(k, e);
    toKeys[k] = true;
    if (k === " " || k === "ArrowUp" || k === "ArrowDown") e.preventDefault();
});
toOn(window, "keyup", function (e) { const k = e.key.length === 1 ? e.key.toLowerCase() : e.key; toKeys[k] = false; });
toOn(window, "blur", function () { for (const k in toKeys) toKeys[k] = false; toMouse.down = false; });
toOn(toCanvas, "mousemove", function (e) { toMouse.sx = e.clientX; toMouse.sy = e.clientY; });
toOn(toCanvas, "mousedown", function (e) { toMouse.sx = e.clientX; toMouse.sy = e.clientY; if (e.button === 0) { toMouse.down = true; toClick(); } });
toOn(window, "mouseup", function (e) { if (e.button === 0) toMouse.down = false; });
toOn(toCanvas, "contextmenu", function (e) { e.preventDefault(); });

// ---- shared state (filled by the other files) ----
let toTime = 0;               // seconds of sim time
let toPhase = "title";        // title, crawl, launch, climb, gate, orbit, dock, after, card
let toPhaseT = 0;             // seconds in the current phase
let toScore = 0;
const toTally = { krill: 0, plank: 0, crab: 0, bell: 0, gates: 0, failed: 0, boss: 0, dock: 0, clean: 0, hullBonus: 0 };
let toGod = false;            // dev: no damage
let toWin = false;

function toAddScore(pts, wx, wy, col) {
    toScore += pts;
    if (window.HUBSCORE && wx !== undefined && !toHeadless()) HUBSCORE.toast(toSX(wx), toSY(wy), pts, { color: col || "#FFC83D" });
}
function toHeadless() { return !!window.TO_TEST; }

// Particles, rings and flashes, in world space.
const toFx = [];
function toSpark(x, y, n, col, sp, life) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, v = (sp || 120) * (0.3 + Math.random());
        toFx.push({ k: "p", x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, t: 0, life: (life || 0.6) * (0.6 + Math.random() * 0.6), col: col });
    }
}
function toRing(x, y, r, col, life) { toFx.push({ k: "r", x: x, y: y, r: r, t: 0, life: life || 0.5, col: col }); }
function toFxUpdate(dt) {
    for (let i = toFx.length - 1; i >= 0; i--) {
        const f = toFx[i];
        f.t += dt;
        if (f.k === "p") { f.x += f.vx * dt; f.y += f.vy * dt; f.vx *= 0.96; f.vy *= 0.96; }
        if (f.t >= f.life) toFx.splice(i, 1);
    }
    if (toFx.length > 900) toFx.splice(0, toFx.length - 900);
}
