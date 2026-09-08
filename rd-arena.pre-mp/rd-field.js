// ===================================================
//   RD Arena -- the Gray-Scott reaction-diffusion field
// ===================================================
// Split out of RDArena.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 3). Lines 103-305 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, so every load-time statement
// still runs in the sequence it did as one file. The only change is that the
// four-space indent the whole script carried inside <script> was removed;
// there are no multi-line template literals, so that is whitespace-only.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint).
"use strict";

// ============================================================
// Reaction-diffusion field
// ============================================================
const gridCols = 400;
const gridRows = 400;
const cellSize = worldWidth / gridCols;
const gridSize = gridCols * gridRows;

let gridA = new Float32Array(gridSize).fill(1);
let gridB = new Float32Array(gridSize).fill(0);
let nextGridA = new Float32Array(gridSize).fill(1);
let nextGridB = new Float32Array(gridSize).fill(0);

// Cells the fleshscape may never grow into (sanctuary footprints, organ aprons).
const noGrow = new Uint8Array(gridSize);
// Human-built structure. Never carved by bullets, blasts, blood or spray.
const staticMask = new Uint8Array(gridSize);

const dA = 1.0;
const dB = 0.5;
const feed = 0.055;
const k = 0.062;

for (let i = 0; i < 200; i++) {
    let cx = Math.floor(Math.random() * gridCols);
    let cy = Math.floor(Math.random() * gridRows);
    for (let x = cx - 3; x <= cx + 3; x++) {
        for (let y = cy - 3; y <= cy + 3; y++) {
            if (x >= 0 && x < gridCols && y >= 0 && y < gridRows) {
                gridB[x + y * gridCols] = 1;
            }
        }
    }
}

function updateRD() {
    for (let x = 1; x < gridCols - 1; x++) {
        for (let y = 1; y < gridRows - 1; y++) {
            let i = x + y * gridCols;

            if (noGrow[i]) { nextGridA[i] = 1; nextGridB[i] = 0; continue; }

            let a = gridA[i];
            let b = gridB[i];

            let laplaceA =
                gridA[i - gridCols] * 0.2 + gridA[i + gridCols] * 0.2 +
                gridA[i - 1] * 0.2 + gridA[i + 1] * 0.2 +
                gridA[i - gridCols - 1] * 0.05 + gridA[i - gridCols + 1] * 0.05 +
                gridA[i + gridCols - 1] * 0.05 + gridA[i + gridCols + 1] * 0.05 -
                a;

            let laplaceB =
                gridB[i - gridCols] * 0.2 + gridB[i + gridCols] * 0.2 +
                gridB[i - 1] * 0.2 + gridB[i + 1] * 0.2 +
                gridB[i - gridCols - 1] * 0.05 + gridB[i - gridCols + 1] * 0.05 +
                gridB[i + gridCols - 1] * 0.05 + gridB[i + gridCols + 1] * 0.05 -
                b;

            nextGridA[i] = Math.max(0, Math.min(1, a + (dA * laplaceA - a * b * b + feed * (1 - a))));
            nextGridB[i] = Math.max(0, Math.min(1, b + (dB * laplaceB + a * b * b - (k + feed) * b)));
        }
    }
    let tempA = gridA; gridA = nextGridA; nextGridA = tempA;
    let tempB = gridB; gridB = nextGridB; nextGridB = tempB;
}

// staticMask folds into the same lookup so LOS rays and bullets stay a single array read.
function isSolid(x, y) {
    let gx = Math.floor(x / cellSize);
    let gy = Math.floor(y / cellSize);
    if (gx < 0 || gx >= gridCols || gy < 0 || gy >= gridRows) return true;
    let i = gx + gy * gridCols;
    return staticMask[i] === 1 || gridB[i] > 0.3;
}

// Living growth only -- human structure is not flesh and cannot be eroded.
function isFlesh(x, y) {
    let gx = Math.floor(x / cellSize);
    let gy = Math.floor(y / cellSize);
    if (gx < 0 || gx >= gridCols || gy < 0 || gy >= gridRows) return false;
    let i = gx + gy * gridCols;
    return staticMask[i] !== 1 && gridB[i] > 0.3;
}

function isStatic(x, y) {
    let gx = Math.floor(x / cellSize);
    let gy = Math.floor(y / cellSize);
    if (gx < 0 || gx >= gridCols || gy < 0 || gy >= gridRows) return false;
    return staticMask[gx + gy * gridCols] === 1;
}

function hasLOS(x1, y1, x2, y2) {
    let d = Math.hypot(x2 - x1, y2 - y1);
    let steps = Math.ceil(d / 8);
    if (steps <= 0) return true;
    let sx = (x2 - x1) / steps, sy = (y2 - y1) / steps;
    let x = x1, y = y1;
    for (let i = 0; i < steps; i++) {
        x += sx; y += sy;
        if (isSolid(x, y)) return false;
    }
    return true;
}

function spawnWallExplosion(x, y) {
    if (Math.random() > 0.4) return;
    explosionParticles.push({
        x: x, y: y,
        vx: (Math.random() - 0.5) * 12,
        vy: (Math.random() - 0.5) * 12,
        size: Math.random() * 4 + 2,
        life: 1.0
    });
}

function clearRadius(cx, cy, radius) {
    let gx = Math.floor(cx / cellSize);
    let gy = Math.floor(cy / cellSize);
    let r = Math.ceil(radius / cellSize);
    for (let x = gx - r; x <= gx + r; x++) {
        for (let y = gy - r; y <= gy + r; y++) {
            if (x >= 0 && x < gridCols && y >= 0 && y < gridRows) {
                let i = x + y * gridCols;
                if (staticMask[i]) continue;
                if (gridB[i] > 0.3) spawnWallExplosion(x * cellSize, y * cellSize);
                gridB[i] = 0;
                gridA[i] = 1;
            }
        }
    }
}

// Same carve without the debris -- the antibacterial spray runs this every frame.
function suppressRadius(cx, cy, radius) {
    let gx = Math.floor(cx / cellSize);
    let gy = Math.floor(cy / cellSize);
    let r = Math.ceil(radius / cellSize);
    let r2 = r * r;
    for (let x = gx - r; x <= gx + r; x++) {
        for (let y = gy - r; y <= gy + r; y++) {
            if (x < 0 || x >= gridCols || y < 0 || y >= gridRows) continue;
            let ox = x - gx, oy = y - gy;
            if (ox * ox + oy * oy > r2) continue;
            let i = x + y * gridCols;
            if (staticMask[i]) continue;
            gridB[i] = 0;
            gridA[i] = 1;
        }
    }
}

function spawnShockwave(x, y, angle, spread, maxRadius, speed, isDash, lethalFrac, fromPlayer, rules) {
    shockwaves.push({
        x: x, y: y, angle: angle, spread: spread,
        radius: 10, maxRadius: maxRadius, speed: speed,
        alpha: 1.0,
        isDash: !!isDash,
        lethalFrac: lethalFrac === undefined ? 1 / 3 : lethalFrac,
        fromPlayer: !!fromPlayer,
        // A wave in flight keeps the rules it was cast under.
        needsLOS: rules ? !!rules.needsLOS : false,
        stopAtFirst: rules ? !!rules.stopAtFirst : false,
        killCount: 0,
        grenadeSpent: false,
        hitList: new Set()
    });
}

// opts.lethal decides whether this spray carries a killing wave.
// Enemy deaths are cosmetic-only; only the player's Splatter ability is lethal.
// opts.carve is the terrain bite: 0 means the blood paints without eating flesh,
// which is the baseline now -- CORROSION cards buy the erosion back.
function createBloodSplatter(x, y, angle, opts) {
    opts = opts || {};
    const particleCount = opts.count || 250;
    const spread = opts.spread !== undefined ? opts.spread : Math.PI / 3;
    const power = opts.power !== undefined ? opts.power : 1;
    const carve = opts.carve || 0;

    if (opts.lethal) {
        spawnShockwave(x, y, angle, spread, opts.maxRadius || 600, 30, false, opts.lethalFrac, true,
            { needsLOS: opts.needsLOS, stopAtFirst: opts.stopAtFirst });
    }

    for (let i = 0; i < particleCount; i++) {
        let pAngle = angle + (Math.random() - 0.5) * spread;
        let speed = (Math.random() * 45 + 15) * power;
        bloodParticles.push({
            x: x, y: y, lastX: x, lastY: y,
            vx: Math.cos(pAngle) * speed, vy: Math.sin(pAngle) * speed,
            size: Math.random() * 5 + 2,
            color: Math.random() > 0.3 ? '#8b0000' : '#c90000',
            friction: Math.random() * 0.04 + 0.88,
            carve: carve
        });
    }
}

function floatText(x, y, text, color) {
    floatTexts.push({ x: x, y: y, text: text, color: color || '#ffffff', life: 1 });
}

