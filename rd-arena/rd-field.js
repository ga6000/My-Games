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
// 2026-11-16 (Ry): 800x800, was 400x400. The original 2026-08-08 build ran this
// same Gray-Scott field at 400 cells over a 2400 px world (6 px a cell). V2
// doubled the world to 4800 and kept 400 cells, which doubled every cell to
// 12 px and made the tissue read as coarse blocks. 800 cells over 4800 px puts
// the cell, and so the pattern scale, back where the original had it.
const gridCols = 800;
const gridRows = 800;
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

// The 200 starting blobs. Extracted into a function 2026-09-08 so multiplayer
// can re-lay them from the SHARED room seed (MULTIPLAYER_PLAN.md 2 -- the world
// IS the game here, so two players must not start in two different fields).
// Called once at load with Math.random, exactly as before; rd-net.js calls it
// again with MP.random the moment a real seed exists, and never after that
// (MULTIPLAYER_PLAN.md 2's latching rule -- Zombie wiped a ten-round map by
// rebuilding whenever the server's seed moved).
function seedField(rand) {
    gridA.fill(1);
    gridB.fill(0);
    nextGridA.fill(1);
    nextGridB.fill(0);
    // 200 blobs per 400^2 originally; four times the cells keeps the same density.
    const blobs = Math.round(200 * gridSize / (400 * 400));
    for (let i = 0; i < blobs; i++) {
        let cx = Math.floor(rand() * gridCols);
        let cy = Math.floor(rand() * gridRows);
        for (let x = cx - 3; x <= cx + 3; x++) {
            for (let y = cy - 3; y <= cy + 3; y++) {
                if (x >= 0 && x < gridCols && y >= 0 && y < gridRows) {
                    gridB[x + y * gridCols] = 1;
                }
            }
        }
    }
}

seedField(Math.random);

function updateRD() {
    // Same Gray-Scott equation and constants as the original. Walked row by row
    // (y outer, x inner) since 2026-11-16: the old column-major walk jumped a
    // whole row of memory per cell, which was free at 400^2 and cost ~10x at
    // 800^2. Every cell reads only the previous grids, so order cannot change
    // the result (the neighbour sums are grouped, a rounding-level difference).
    const W = gridCols, A = gridA, B = gridB, nA = nextGridA, nB = nextGridB;
    const kf = k + feed;
    for (let y = 1; y < gridRows - 1; y++) {
        let i = y * W;
        for (let x = 1; x < W - 1; x++) {
            i++;
            if (noGrow[i]) { nA[i] = 1; nB[i] = 0; continue; }

            const a = A[i], b = B[i];
            const up = i - W, dn = i + W;
            const laplaceA =
                (A[up] + A[dn] + A[i - 1] + A[i + 1]) * 0.2 +
                (A[up - 1] + A[up + 1] + A[dn - 1] + A[dn + 1]) * 0.05 - a;
            const laplaceB =
                (B[up] + B[dn] + B[i - 1] + B[i + 1]) * 0.2 +
                (B[up - 1] + B[up + 1] + B[dn - 1] + B[dn + 1]) * 0.05 - b;
            const abb = a * b * b;
            let na = a + (dA * laplaceA - abb + feed * (1 - a));
            let nb = b + (dB * laplaceB + abb - kf * b);
            nA[i] = na < 0 ? 0 : na > 1 ? 1 : na;
            nB[i] = nb < 0 ? 0 : nb > 1 ? 1 : nb;
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

// ============================================================
// THE MUTATION CHOKE POINT (MP_ROLLOUT.md 2, step 1 -- 2026-09-08)
// ============================================================
// Every DISCRETE write to gridB in the whole game goes through applyCarve.
// There were three writers and 2 already knew where they were: clearRadius,
// suppressRadius, and the blood-particle loop -- which lived inline in
// rd-boot.js writing gridB by hand, and is now bloodCarve() below, with the
// others, where it can be seen.
//
// CONTINUOUS evolution (updateRD) is deliberately NOT routed through here. It
// is never sent; it is the thing the periodic field resync corrects for.
//
// Step 1 shipped as a verified no-op before any netcode existed, because it is
// the change most likely to introduce a silent bug and the least likely to be
// blamed for one.
//
//   circular: true  -- round bite (the spray); false -- the old square block
//   debris:   true  -- spawn wall-explosion particles for cells that were flesh
function applyCarve(cx, cy, radius, circular, debris) {
    let gx = Math.floor(cx / cellSize);
    let gy = Math.floor(cy / cellSize);
    let r = Math.ceil(radius / cellSize);
    let r2 = r * r;
    for (let x = gx - r; x <= gx + r; x++) {
        for (let y = gy - r; y <= gy + r; y++) {
            if (x < 0 || x >= gridCols || y < 0 || y >= gridRows) continue;
            if (circular) {
                let ox = x - gx, oy = y - gy;
                if (ox * ox + oy * oy > r2) continue;
            }
            let i = x + y * gridCols;
            if (staticMask[i]) continue;
            if (debris && gridB[i] > 0.3) spawnWallExplosion(x * cellSize, y * cellSize);
            gridB[i] = 0;
            gridA[i] = 1;
        }
    }
}

function clearRadius(cx, cy, radius) {
    applyCarve(cx, cy, radius, false, true);
    RDHOOKS.carve(cx, cy, radius, 'clear');
}

// Same carve without the debris -- the antibacterial spray runs this every frame.
// NOT relayed: every mote calls this on every frame, which would be a flood
// rather than a message. The sprays sit on fixed sanctuaries and the 1 s field
// packet corrects whatever they drift by, so the wire never has to hear about
// them. RDHOOKS.carve is still called and rd-net.js is what drops it, so the
// decision lives with the netcode instead of being hidden here as an omission.
function suppressRadius(cx, cy, radius) {
    applyCarve(cx, cy, radius, true, false);
    RDHOOKS.carve(cx, cy, radius, 'spray');
}

// The third writer. Blood particles with a CORROSION bite eat what they land
// on; this used to be an inline gridB loop in rd-boot.js's particle update.
function bloodCarve(cx, cy, radius) {
    applyCarve(cx, cy, radius, false, true);
    RDHOOKS.carve(cx, cy, radius, 'blood');
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

