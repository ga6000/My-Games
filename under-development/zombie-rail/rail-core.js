// ===================================================
//   RAIL SANDBOX — core: world, camera, teardown, utils
// ===================================================
// Classic script, loads FIRST. The plan is RAIL_SANDBOX_PLAN.md.
//
// This page loads NONE of the zombie-*.js files, so nothing here can collide
// with them -- check-global-collisions.js works per page. Names are still
// prefixed `rail`/`RAIL`/`r` so that a future merge of the two pages would be
// mechanical rather than a rename.
"use strict";

// ---------------------------------------------------
//   WORLD
// ---------------------------------------------------
// 6400x3600: big enough for a loop with a town at each end and real forest
// between them. The loop is what makes the map a rail sandbox rather than a
// test track -- you can always get back to where you started without a
// reverse move, so a shunting mistake is recoverable.
const RAIL_WORLD_W = 6400;
const RAIL_WORLD_H = 3600;

// How much world is on screen at rest. Same framing as the arcade (960x540):
// everything below is tuned against it, and a train is 200px of car, so a
// four-car consist fills most of the view -- which is the intent.
const RAIL_VIEW_W = 960;
const RAIL_VIEW_H = 540;

const railCanvas = document.getElementById("gameCanvas");
const railCtx = railCanvas.getContext("2d");

// ---------------------------------------------------
//   PALETTE
// ---------------------------------------------------
const RC_BULLET = "#FFFFFF";
const RC_BLOOD = "#8E1420";
const RC_BLOOD_HOT = "#C41E2A";
const RC_STEEL = "#6E6E78";
const RC_RUST = "#7A4A2A";
const RC_SWITCH_MAIN = "#33FF55";
const RC_SWITCH_DIV = "#FFE033";
const RC_ZOMBIE = "#FF5555";

// ---------------------------------------------------
//   TEARDOWN PLUMBING
// ---------------------------------------------------
// Root CLAUDE.md hard constraint: every timer through trackTimeout /
// trackInterval, every listener through one AbortController, so destroy()
// fully tears an instance down. Written up front because it is cheap now and
// expensive to retrofit (GAME_PROTOTYPE_INSTRUCTIONS.md §1).
let railTimers = [];
let railAbort = new AbortController();
let railRaf = 0;

// Fixed-step simulation, same discipline as the arcade's Z_STEP_MS: movement
// below is px PER CALL, so one call per rendered frame would run the sandbox
// 2.4x fast on a 144Hz monitor and stop dead in a background tab.
const RAIL_STEP_MS = 1000 / 60;
const RAIL_MAX_STEPS = 5;
let railSimAcc = 0;

function railTrackTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    railTimers.push(t);
    return t;
}

function railTrackInterval(fn, ms) {
    const t = setInterval(fn, ms);
    railTimers.push(t);
    return t;
}

function railSignal() {
    return railAbort.signal;
}

function railTeardown() {
    for (let i = 0; i < railTimers.length; i++) {
        clearTimeout(railTimers[i]);
        clearInterval(railTimers[i]);
    }
    railTimers = [];
    railAbort.abort();
    if (railRaf) cancelAnimationFrame(railRaf);
    railRaf = 0;
    if (typeof railAudioStopAll === "function") railAudioStopAll();
}

// ---------------------------------------------------
//   CAMERA
// ---------------------------------------------------
const RAIL_CAM_LERP = 0.12;
const RAIL_CAM_SCALE_LERP = 0.06;
// The most the follow camera may travel in one 60Hz frame. An exponential
// lerp moves a fixed FRACTION of the distance, so a 2000px jump (a dev-panel
// teleport between towns) would otherwise open with a 240px whip.
const RAIL_CAM_MAX_STEP = 36;

// Lighting, ported unchanged from the arcade (zombie-core.js). The balance is
// listed as untouchable in AESTHETIC_GUIDE §5 -- 340 and 1.33 are the numbers
// that playtested, and nothing here has a reason to move them.
const RAIL_LIGHT_RADIUS = 340;
const RAIL_LIGHT_FADE = 1.33;
const RAIL_LIGHT_BANDS = 4;

const RAIL_SHAKE_MAX = 17;
const RAIL_SHAKE_DECAY = 0.84;

const railCam = {
    x: RAIL_WORLD_W / 2,
    y: RAIL_WORLD_H / 2,
    scale: 1,
    shake: 0
};

function railResizeCanvas() {
    const side = (typeof railSidebarWidth === "function") ? railSidebarWidth() : 0;
    railCanvas.width = Math.max(320, window.innerWidth - side);
    railCanvas.height = window.innerHeight;
}

function railScreenToWorld(sx, sy) {
    return {
        x: (sx - railCanvas.width / 2) / railCam.scale + railCam.x,
        y: (sy - railCanvas.height / 2) / railCam.scale + railCam.y
    };
}

function railWorldToScreen(wx, wy) {
    return {
        x: (wx - railCam.x) * railCam.scale + railCanvas.width / 2,
        y: (wy - railCam.y) * railCam.scale + railCanvas.height / 2
    };
}

function rClamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

function railViewRect() {
    const halfW = (railCanvas.width / railCam.scale) / 2;
    const halfH = (railCanvas.height / railCam.scale) / 2;
    return { x: railCam.x - halfW, y: railCam.y - halfH, w: halfW * 2, h: halfH * 2 };
}

// Is this box on screen? One closure built per frame, handed to every draw
// pass, so culling is a call rather than four comparisons repeated.
function railInViewFn() {
    const vr = railViewRect();
    return function (x, y, w, h) {
        return x < vr.x + vr.w && x + w > vr.x && y < vr.y + vr.h && y + h > vr.y;
    };
}

function railUpdateCamera(target) {
    let cx = railCam.x, cy = railCam.y;
    if (target) { cx = target.x; cy = target.y; }

    let needW = RAIL_VIEW_W, needH = RAIL_VIEW_H;
    // Match the canvas aspect by growing the SHORT axis. Shrinking the long
    // one would show less than the nominal view on that axis, handing a
    // player on a tall window a smaller sightline than everyone else.
    const aspect = railCanvas.width / Math.max(1, railCanvas.height);
    if (needW / needH < aspect) needW = needH * aspect; else needH = needW / aspect;
    needW = Math.min(needW, RAIL_WORLD_W);
    needH = Math.min(needH, RAIL_WORLD_H);

    const wantScale = Math.min(railCanvas.width / needW, railCanvas.height / needH);
    railCam.scale += (wantScale - railCam.scale) * RAIL_CAM_SCALE_LERP;

    const halfW = (railCanvas.width / railCam.scale) / 2;
    const halfH = (railCanvas.height / railCam.scale) / 2;
    const wx = (halfW * 2 >= RAIL_WORLD_W) ? RAIL_WORLD_W / 2 : rClamp(cx, halfW, RAIL_WORLD_W - halfW);
    const wy = (halfH * 2 >= RAIL_WORLD_H) ? RAIL_WORLD_H / 2 : rClamp(cy, halfH, RAIL_WORLD_H - halfH);

    let dx = (wx - railCam.x) * RAIL_CAM_LERP;
    let dy = (wy - railCam.y) * RAIL_CAM_LERP;
    const step = Math.sqrt(dx * dx + dy * dy);
    if (step > RAIL_CAM_MAX_STEP) { dx *= RAIL_CAM_MAX_STEP / step; dy *= RAIL_CAM_MAX_STEP / step; }
    railCam.x += dx;
    railCam.y += dy;

    if (railCam.shake > 0) railCam.shake *= RAIL_SHAKE_DECAY;
    if (railCam.shake < 0.35) railCam.shake = 0;
}

function railApplyCamera() {
    // Shake is in SCREEN px; divide by scale on the way out so the visible
    // amplitude does not change with the zoom or the window size.
    const amp = railCam.shake ? railCam.shake / railCam.scale : 0;
    const sx = amp ? (Math.random() - 0.5) * amp : 0;
    const sy = amp ? (Math.random() - 0.5) * amp : 0;
    railCtx.setTransform(
        railCam.scale, 0, 0, railCam.scale,
        railCanvas.width / 2 - (railCam.x + sx) * railCam.scale,
        railCanvas.height / 2 - (railCam.y + sy) * railCam.scale
    );
}

function railShake(amount) {
    railCam.shake = Math.min(RAIL_SHAKE_MAX, railCam.shake + amount);
}

// ---------------------------------------------------
//   GEOMETRY
// ---------------------------------------------------
function rRectIntersect(ax, ay, aw, ah, bx, by, bw, bh) {
    return ax < bx + bw && ax + aw > bx && ay < by + bh && ay + ah > by;
}

function rRectsOverlap(a, b) {
    return rRectIntersect(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h);
}

// A point against an ORIENTED rect, by rotating the point into the rect's own
// frame. zombie-train.js could honestly use an AABB because its line was
// rectilinear (one east leg, one south leg); this map's loop has arcs, so a
// car on a curve is genuinely diagonal and an AABB would be a lie -- it
// over-reports by up to 40% of the car's length at 45 degrees, which is the
// difference between standing beside a car and standing on it.
function rPointInOriented(px, py, cx, cy, len, wid, ang) {
    const dx = px - cx, dy = py - cy;
    const co = Math.cos(-ang), si = Math.sin(-ang);
    const lx = dx * co - dy * si;
    const ly = dx * si + dy * co;
    return Math.abs(lx) <= len / 2 && Math.abs(ly) <= wid / 2;
}

// The same, reporting WHERE in the car's frame -- which end, how far across.
// The pilot seat, the coupler ends and the cowcatcher all need the position,
// not just the hit.
function rLocalInOriented(px, py, cx, cy, ang) {
    const dx = px - cx, dy = py - cy;
    const co = Math.cos(-ang), si = Math.sin(-ang);
    return { lx: dx * co - dy * si, ly: dx * si + dy * co };
}

function rDist(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay);
}

// A deterministic 0..1 stream from a seed. Used for every piece of scenery
// (tree shades, crate layouts, grass tufts) so the map looks identical on
// every reload -- you are comparing the layout, not the roll.
function railRng(seed) {
    let s = seed >>> 0;
    return function () {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 4294967296;
    };
}

// Stable integer hash of two ints, for per-cell scenery decisions.
function railHash2(a, b) {
    return ((a * 73856093) ^ (b * 19349663)) >>> 0;
}
