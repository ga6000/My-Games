// ===================================================
//   Space Tracer — globals, state, ship, dash, camera, grid, projectiles
// ===================================================
// Split out of space-tracer.html's inline script 2026-09-04 (Pass A of
// gyro-space/ST_PASS_PLAN.md). Lines were MOVED VERBATIM and IN SOURCE ORDER --
// nothing was reordered, because this game's load-time statements are scattered
// through its sections rather than gathered at the end. Keeping the order is
// what makes the split safe.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). Loads FIRST: everything else reads the state declared here.
"use strict";

// ===================================================
//                 GLOBAL VARIABLES
// ===================================================
const canvas = document.getElementById("game");
const ctx = canvas.getContext("2d");

const statusText = document.getElementById("status");
const audioToggleBtn = document.getElementById("audioToggleBtn");
const guiToggleBtn = document.getElementById("guiToggle");
const overlay = document.getElementById("overlay");

let width = 0;
let height = 0;
let centerX = 0;
let centerY = 0;

function resize(){
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    centerX = width/2;
    centerY = height/2;
}

window.addEventListener("resize",resize);
resize();

// ===================================================
//                  GAME STATE
// ===================================================
let paused = false;
let lastFrame = performance.now();
let frameTime = 0;
let fps = 0;
let gameStarted = false;
// Mobile support was switched off 2026-09-04 -- the friend group plays on
// desktop, and the gyroscope/touch path was the most involved thing in this
// file. `controlMode` is deliberately KEPT rather than ripped out: the
// steering branch and the two SPACE keydown/keyup guards below all test it,
// and pinning it to "computer" is a far smaller diff through the game loop
// than unpicking those. If mobile ever comes back, it comes back here.
// See SCOPE_PULLBACK_PLAN.md.
let controlMode = "computer";
let guiVisible = true;
let audioEnabled = true;

// The local COLOR_PALETTE that used to sit here was REMOVED 2026-09-03. It was
// a fifth copy of the idea and a third distinct palette (10 entries, all at
// 100%/60%), but only element [0] was ever read -- as a placeholder default, so
// every unknown player rendered RED rather than their real colour. Colour comes
// from the server; `shared/identity.js` is the one client-side fallback.
//
// Seeded from the player's own name so the ship is already the RIGHT colour
// before the socket answers, instead of flicking red -> correct on connect.
/**
 * Tokens for canvas use, read out of retro.css once at boot rather than retyped
 * as literals -- retro.css stays the single source of truth. The values here are
 * only the fallback for a stylesheet that failed to load.
 */
const INK = {
    ground: "#000000", cyan: "#00E5FF", amber: "#FFB000", magenta: "#FF2E88",
    hot: "#E8FFF4", mid: "#8FA89C", dim: "#2E3A34", world: "#7DF9FF",
    uiFont: "monospace"
};

function loadInkFromCss() {
    try {
        const cs = getComputedStyle(document.documentElement);
        const bs = getComputedStyle(document.body);
        const pick = (s, name, fb) => (s.getPropertyValue(name) || "").trim() || fb;
        INK.ground  = pick(cs, "--ground", INK.ground);
        INK.cyan    = pick(cs, "--sig-cyan", INK.cyan);
        INK.amber   = pick(cs, "--sig-amber", INK.amber);
        INK.magenta = pick(cs, "--sig-magenta", INK.magenta);
        INK.hot     = pick(cs, "--phos-hot", INK.hot);
        INK.mid     = pick(cs, "--phos-mid", INK.mid);
        INK.dim     = pick(cs, "--phos-dim", INK.dim);
        INK.world   = pick(bs, "--world-hue", INK.world);
        INK.uiFont  = pick(cs, "--font-ui", INK.uiFont);
    } catch (e) { /* fallbacks already in place */ }
}

/**
 * The hull, as unit coordinates scaled by ship.size at draw time. Shared by the
 * local ship and every remote one so the two can never drift apart -- they were
 * two copies of the same four points before this pass.
 */
const SHIP_HULL = [[1, 0], [-0.8, -0.6], [-0.35, 0], [-0.8, 0.6]];

/**
 * §6.1: Asteroids' ships are UNFILLED stroked outlines, not silhouettes.
 * §4.3's vertex bloom -- a hot dot at each hull corner, because on real XY
 * hardware the beam decelerated at every vertex and burned the phosphor
 * brighter there -- is the part that stops a wireframe reading as CAD output.
 *
 * Call inside a translate/rotate; draws at the origin.
 */
function strokeHull(size, color) {
    const pts = SHIP_HULL.map(function (p) { return [p[0] * size, p[1] * size]; });

    ctx.beginPath();
    ctx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
    ctx.closePath();

    // Two passes: a wide low-alpha glow in the player's colour, then a narrow
    // hot core. Cheaper than shadowBlur, which §4.2 warns is a canvas
    // performance trap when applied per entity.
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.35;
    ctx.lineWidth = 4;
    ctx.strokeStyle = color;
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = color;
    ctx.stroke();

    if (typeof RETRO !== "undefined") RETRO.vertexBloom(ctx, pts, { radius: 1.5, color: INK.hot });
}

// The ONE name->colour path. shared/identity.js is the only client
// implementation, and the SERVER overrides this at runtime through
// MP.selfColor (st-world.js). §5 lists server-authoritative MP.selfColor as
// untouchable for this game -- never compute a colour anywhere else.
let myColor = IDENTITY.colorFromName(MP.identity().name);
let myPlayerId = null;

// ===================================================
//                     SHIP
// ===================================================
const ship = {
    x: 0,
    y: 0,
    angle: 0,
    baseSpeed: 3,
    speed: 3,
    size: 18,
    color: myColor,
    isAlive: true,
    deathTime: 0,
    name: ""  // Will be set from start screen
};

// ===================================================
//               DASH MECHANICS (SPACE)
// ===================================================
let spaceHeld = false;
let spaceHoldStartTime = 0;
let dashChargeDuration = 0;
let dashTimeRemaining = 0;
let isDashing = false;

// Note: the "10" (max charge seconds) and "5" (max dash seconds) below
// are the same literal values already hardcoded at every dashChargeDuration
// / dashTimeRemaining assignment elsewhere in this file (both the mobile
// and computer control branches). Deliberately not introducing new named
// constants here that only this function would use -- that would create
// a second source of truth that could silently drift from the literals
// the actual dash logic uses. If those literals ever change, this needs
// updating to match, same as any other place they're referenced.
const dashMeterFillEl = document.getElementById("dashMeterFill");
const dashMeterLabelEl = document.getElementById("dashMeterLabel");

function updateDashMeter() {
    if (!dashMeterFillEl) return;

    if (isDashing) {
        // Draining: dashTimeRemaining counts down from up to 5s to 0.
        const pct = (dashTimeRemaining / 5) * 100;
        dashMeterFillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        dashMeterFillEl.style.background = "#ffaa00"; // Orange while actively dashing -- visually distinct from the charging color
        if (dashMeterLabelEl) dashMeterLabelEl.textContent = "DASHING";
    } else if (spaceHeld) {
        // Charging: dashChargeDuration counts up from 0 to a 10s cap.
        const pct = (dashChargeDuration / 10) * 100;
        dashMeterFillEl.style.width = `${Math.max(0, Math.min(100, pct))}%`;
        dashMeterFillEl.style.background = "#64c8ff"; // Same blue as the rest of this game's UI accent color
        if (dashMeterLabelEl) dashMeterLabelEl.textContent = "CHARGING";
    } else {
        // Neither charging nor dashing: empty bar, ready state.
        dashMeterFillEl.style.width = "0%";
        dashMeterFillEl.style.background = "#64c8ff";
        if (dashMeterLabelEl) dashMeterLabelEl.textContent = "DASH";
    }
}

// ===================================================
//               CAMERA / WORLD POSITION
// ===================================================
const camera = {
    x: 0,
    y: 0,
    zoom: 1.0  // 1.0 = normal, <1.0 = zoomed out
};

const ZOOM_SETTINGS = {
    desktop: 1.0,
    // `mobile: 0.7` removed 2026-09-04 with the rest of mobile support.
    minZoom: 0.5,
    maxZoom: 2.0
};

// ===================================================
//           SPATIAL GRID SYSTEM
// ===================================================
const GRID_SIZE = 500;
const grid = {};

function getGridKey(x, y) {
    const cellX = Math.floor(x / GRID_SIZE);
    const cellY = Math.floor(y / GRID_SIZE);
    return `${cellX},${cellY}`;
}

function getVisibleGridCells() {
    const minCellX = Math.floor(camera.x / GRID_SIZE) - 1;
    const minCellY = Math.floor(camera.y / GRID_SIZE) - 1;
    const maxCellX = Math.floor((camera.x + width) / GRID_SIZE) + 1;
    const maxCellY = Math.floor((camera.y + height) / GRID_SIZE) + 1;
    
    const cells = [];
    for (let x = minCellX; x <= maxCellX; x++) {
        for (let y = minCellY; y <= maxCellY; y++) {
            cells.push(`${x},${y}`);
        }
    }
    return cells;
}

function addToGrid(key, object) {
    if (!grid[key]) {
        grid[key] = [];
    }
    grid[key].push(object);
}

function removeFromGrid(key, object) {
    if (grid[key]) {
        const idx = grid[key].indexOf(object);
        if (idx > -1) {
            grid[key].splice(idx, 1);
        }
    }
}

// ===================================================
//              CHARGED BEAM STATE
// ===================================================
let isChargingBeam = false;
let beamChargeStartTime = 0;
let beamCooldownEnd = 0;
const MIN_CHARGE_TIME = 500; // 0.5 seconds before animation shows

// ===================================================
//                    PROJECTILES
// ===================================================
const bullets = [];
const bulletPool = [];
const MAX_BULLETS = 200;

for (let i = 0; i < MAX_BULLETS; i++) {
    bulletPool.push({
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        life: 0,
        maxLife: 0,
        color: "#fff",
        type: "standard",
        firedAt: { x: 0, y: 0 },
        maxDistance: 500,
        size: 3,
        active: false,
        gridKey: null,
        bounced: false
    });
}

function fireLaser(x, y, angle, color, shotType = "standard", ownerId = null) {
    if (bullets.length >= MAX_BULLETS) {
        return;
    }
    
    const maxDist = shotType === "beam" ? 1500 : 250;  // Standard shot range halved to 250
    const maxLife = shotType === "beam" ? 150 : 60;
    
    let bullet;
    if (bulletPool.length > 0) {
        bullet = bulletPool.pop();
    } else {
        bullet = { firedAt: { x: 0, y: 0 }, gridKey: null };
    }
    
    bullet.x = x;
    bullet.y = y;
    bullet.vx = Math.cos(angle) * 12;
    bullet.vy = Math.sin(angle) * 12;
    bullet.life = maxLife;
    bullet.maxLife = maxLife;
    bullet.color = color;
    bullet.type = shotType;
    bullet.firedAt.x = x;
    bullet.firedAt.y = y;
    bullet.maxDistance = maxDist;
    bullet.size = shotType === "beam" ? 6 : 3; // 2x beam size (3 * 2 = 6)
    bullet.active = true;
    // Reset explicitly, for the same reason ownerId below is: bullets come
    // back out of bulletPool with whatever the last user of that object
    // left on them. A stale `bounced: true` would silently rob a fresh
    // charged beam of its one ricochet.
    bullet.bounced = false;
    bullet.gridKey = getGridKey(x, y);
    bullet.isLocalShot = true; // Mark as our shot (don't collide with us)
    // ownerId is who fired this shot. Explicitly reset every fire (not just
    // when creating a fresh object) because bullets are recycled from
    // bulletPool -- without this, a recycled bullet could carry a stale
    // ownerId from whoever last used that pooled object, misattributing
    // a kill to the wrong player.
    bullet.ownerId = ownerId;
    
    addToGrid(bullet.gridKey, bullet);
    bullets.push(bullet);
}

