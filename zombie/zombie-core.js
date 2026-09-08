// ===================================================
//   Zombie — core: world, camera, teardown, utils
// ===================================================
// Classic script. Loads FIRST; everything else assumes these names exist.
// All files on this page share one global scope, so every top-level name
// here is effectively public -- see scripts/check-global-collisions.js.
"use strict";

// ---------------------------------------------------
//   WORLD
// ---------------------------------------------------
// v1 was a fixed 1600x900 arena that exactly filled the letterbox, so
// "the world" and "what you can see" were the same rectangle. v2 is 3x
// on each axis -- 9x the area -- which means the camera now has to pan
// and most of the world is off-screen at any moment. That single change
// is what forces the minimap, the off-screen teammate markers, the draw
// culling, and player-relative zombie spawning: at this size, spawning
// at a world edge would mean a 30-second walk to reach anybody.
const WORLD_W = 4800;
const WORLD_H = 2700;

// How much world a player sees at rest, in world units. Tightened from
// 1600x900 to 960x540 (2.8x less area on screen) -- at the old framing
// the player was a 16px speck and a fight had no intimacy. Everything
// downstream is tuned against this number: zombie spawn distance has to
// sit just outside it, and screen shake is measured in screen pixels so
// it doesn't scale with the zoom.
const VIEW_W = 960;
const VIEW_H = 540;

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ---------------------------------------------------
//   DOS PALETTE
// ---------------------------------------------------
const COLOR_BG = "#000000";
const COLOR_ZOMBIE = "#FF5555";
const COLOR_POWERFUL = "#AA00AA";
const COLOR_RUNNER = "#FF9955";
const COLOR_SCREAMER = "#FFFF55";
const COLOR_SPLITTER = "#55AAFF";
const COLOR_WALL = "#AAAAAA";
const COLOR_WALL_LIT = "#FFFFFF";
const COLOR_BULLET = "#FFFFFF";
const COLOR_PICKUP = "#FFAA00";
const COLOR_SCRAP = "#FFCC55";
const COLOR_DOOR = "#8888FF";
const COLOR_BUY = "#55FF55";
const COLOR_WINDOW = "#AA7733";
const COLOR_BARREL = "#FF7700";
const COLOR_TRAP = "#5599FF";
const COLOR_DOWNED = "#FF5555";
const P_COLORS = ["#55FFFF", "#FFFF55", "#FF55FF"];

// ---------------------------------------------------
//   TEARDOWN PLUMBING
// ---------------------------------------------------
// Root CLAUDE.md hard constraint: every timer through trackTimeout /
// trackInterval, every listener through one AbortController, so an
// instance can be fully disposed. v1 honoured neither -- it used raw
// addEventListener and bare setTimeout. Nothing embeds this game today
// (GAME_PROTOTYPE_INSTRUCTIONS.md §2 is explicit that window.GameInstance
// is NOT the current target), but the plumbing is cheap now and
// expensive to retrofit later.
let zTimers = [];
let zAbort = new AbortController();
let zRafHandle = 0;

function trackTimeout(fn, ms) {
    const t = setTimeout(fn, ms);
    zTimers.push(t);
    return t;
}

function trackInterval(fn, ms) {
    const t = setInterval(fn, ms);
    zTimers.push(t);
    return t;
}

function zSignal() {
    return zAbort.signal;
}

function zDestroy() {
    for (let i = 0; i < zTimers.length; i++) {
        clearTimeout(zTimers[i]);
        clearInterval(zTimers[i]);
    }
    zTimers = [];
    zAbort.abort();
    if (zRafHandle) cancelAnimationFrame(zRafHandle);
    zRafHandle = 0;
    if (window.MP && typeof MP.destroy === "function") MP.destroy();
}

// ---------------------------------------------------
//   CAMERA
// ---------------------------------------------------
// Follows this client's own player. It used to zoom out to frame up to
// three couch co-op players; with one player per screen that's gone, so
// the view is a fixed window that only pans. Remote players are
// deliberately NOT framed -- they have their own screen, and chasing
// them would yank the view across the map.
const CAM_LERP = 0.12;        // position smoothing per frame
const CAM_SCALE_LERP = 0.06;  // zoom smoothing; only moves on window resize now

// Punchy, not woozy: a low cap with a fast falloff reads as impact,
// while a high cap with slow decay reads as motion sickness.
// Lighting. The lit pocket is fully clear out to LIGHT_RADIUS, then
// fades to the ambient level over an extra 33% (idea: blackout was a
// guaranteed loss at 210px hard-edged).
const LIGHT_RADIUS = 340;
const LIGHT_FADE = 1.33;

const SHAKE_MAX = 17;
const SHAKE_DECAY = 0.84;

const camera = {
    x: WORLD_W / 2,
    y: WORLD_H / 2,
    scale: 1,
    shake: 0
};

function resizeCanvas() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

// Screen px -> world units, THROUGH the camera. Every mouse-aimed shot
// depends on this; get it wrong and aiming is silently off by the
// camera offset, which reads as "the gun is broken" rather than "the
// transform is wrong".
function screenToWorld(sx, sy) {
    return {
        x: (sx - canvas.width / 2) / camera.scale + camera.x,
        y: (sy - canvas.height / 2) / camera.scale + camera.y
    };
}

function clamp(v, lo, hi) {
    return v < lo ? lo : (v > hi ? hi : v);
}

// The world rectangle currently on screen. Draw culling and
// "spawn outside the view" both read this.
function viewRect() {
    const halfW = (canvas.width / camera.scale) / 2;
    const halfH = (canvas.height / camera.scale) / 2;
    return {
        x: camera.x - halfW,
        y: camera.y - halfH,
        w: halfW * 2,
        h: halfH * 2
    };
}

function updateCamera(targets) {
    let cx = camera.x;
    let cy = camera.y;
    let needW = VIEW_W;
    let needH = VIEW_H;

    if (targets && targets.length) {
        cx = targets[0].x;
        cy = targets[0].y;
    }

    // Match the canvas aspect by growing the short axis -- shrinking the
    // long one would show LESS than the nominal view on that axis, which
    // would hand players on tall windows a smaller sightline than
    // everyone else.
    const aspect = canvas.width / Math.max(1, canvas.height);
    if (needW / needH < aspect) needW = needH * aspect;
    else needH = needW / aspect;

    needW = Math.min(needW, WORLD_W);
    needH = Math.min(needH, WORLD_H);

    const wantScale = Math.min(canvas.width / needW, canvas.height / needH);
    camera.scale += (wantScale - camera.scale) * CAM_SCALE_LERP;

    const halfW = (canvas.width / camera.scale) / 2;
    const halfH = (canvas.height / camera.scale) / 2;

    // Don't show the void outside the world. If the view is wider than
    // the world itself, centre instead of clamping (clamp() would get a
    // lo > hi range and pin to the wrong edge).
    const wantX = (halfW * 2 >= WORLD_W) ? WORLD_W / 2 : clamp(cx, halfW, WORLD_W - halfW);
    const wantY = (halfH * 2 >= WORLD_H) ? WORLD_H / 2 : clamp(cy, halfH, WORLD_H - halfH);

    camera.x += (wantX - camera.x) * CAM_LERP;
    camera.y += (wantY - camera.y) * CAM_LERP;

    if (camera.shake > 0) camera.shake *= SHAKE_DECAY;
    if (camera.shake < 0.35) camera.shake = 0;
}

function applyCameraTransform() {
    // camera.shake is screen px -> convert to world units for the
    // transform, so the on-screen amplitude is zoom-independent.
    const amp = camera.shake ? camera.shake / camera.scale : 0;
    const sx = amp ? (Math.random() - 0.5) * amp : 0;
    const sy = amp ? (Math.random() - 0.5) * amp : 0;
    ctx.setTransform(
        camera.scale, 0, 0, camera.scale,
        canvas.width / 2 - (camera.x + sx) * camera.scale,
        canvas.height / 2 - (camera.y + sy) * camera.scale
    );
}

// Shake is in SCREEN pixels, not world units. applyCameraTransform
// divides by camera.scale on the way out, so a shotgun kicks the same
// visible amount whatever the zoom or window size -- otherwise the
// tighter FOV would have silently multiplied every shake by ~1.7.
function addShake(amount) {
    camera.shake = Math.min(SHAKE_MAX, camera.shake + amount);
}

// ---------------------------------------------------
//   GEOMETRY
// ---------------------------------------------------
function rectIntersect(r1x, r1y, r1w, r1h, r2x, r2y, r2w, r2h) {
    return r1x < r2x + r2w && r1x + r1w > r2x && r1y < r2y + r2h && r1y + r1h > r2y;
}

function rectsOverlap(a, b) {
    return rectIntersect(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h);
}

function dist(ax, ay, bx, by) {
    return Math.hypot(bx - ax, by - ay);
}

// Stable 0..1 from a string. Used for per-client spawn angles so the
// server doesn't have to hand out positions. Same djb2 shape the rest
// of the project uses for identity -- do not invent a second scheme.
function hashToUnit(str) {
    let h = 5381;
    for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
    return (Math.abs(h) % 10000) / 10000;
}

// ---------------------------------------------------
//   WIRE-SAFE TIME
// ---------------------------------------------------
// BUG 1 (see DESIGN_IDEAS.md Part 4). v1 sent absolute Date.now()
// timestamps across the wire -- z.flashTime and p.minigunTimer -- and
// compared them against the RECEIVING client's clock. Those clocks are
// not synchronised, so a host running a few seconds fast made every
// zombie render permanently white on every other screen.
//
// Everything time-shaped now crosses the wire as a REMAINING DURATION
// in ms, and is rebased onto the local clock on arrival. These two
// helpers are the only sanctioned way to do it; nothing should put a
// raw timestamp in a payload.
function msLeft(absoluteDeadline, now) {
    if (!absoluteDeadline) return 0;
    const d = absoluteDeadline - now;
    return d > 0 ? Math.round(d) : 0;
}

function deadlineFrom(remainingMs, now) {
    return remainingMs > 0 ? now + remainingMs : 0;
}
