// ===================================================
//   RD Arena -- the flow field
// ===================================================
// Split out of RDArena.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 3). Lines 595-787 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, so every load-time statement
// still runs in the sequence it did as one file. The only change is that the
// four-space indent the whole script carried inside <script> was removed;
// there are no multi-line template literals, so that is whitespace-only.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint).
"use strict";

// ============================================================
// Flow field
// One shared field for every grunt (and for the delivered BIOhack),
// rebuilt every 15 frames on a coarse 100x100 grid. Step cost carries
// a wall-proximity penalty so paths bend into open space rather than
// scraping along the flesh.
// ============================================================
const fCols = 100, fRows = 100;
const fStep = gridCols / fCols;          // 4 RD cells per flow cell
const fCell = worldWidth / fCols;        // 48 world px per flow cell
const fSize = fCols * fRows;

const fBlocked = new Uint8Array(fSize);
const fClear = new Uint8Array(fSize);
const fCost = new Int32Array(fSize);
const bfsQueue = new Int32Array(fSize);

const HEAP_CAP = 160000;
const heapIdx = new Int32Array(HEAP_CAP);
const heapCost = new Int32Array(HEAP_CAP);
let heapLen = 0;

function heapPush(idx, cost) {
    if (heapLen >= HEAP_CAP) return;
    let n = heapLen++;
    heapIdx[n] = idx; heapCost[n] = cost;
    while (n > 0) {
        let p = (n - 1) >> 1;
        if (heapCost[p] <= heapCost[n]) break;
        let ti = heapIdx[p]; heapIdx[p] = heapIdx[n]; heapIdx[n] = ti;
        let tc = heapCost[p]; heapCost[p] = heapCost[n]; heapCost[n] = tc;
        n = p;
    }
}

let heapTopIdx = 0, heapTopCost = 0;
function heapPop() {
    heapTopIdx = heapIdx[0]; heapTopCost = heapCost[0];
    heapLen--;
    if (heapLen > 0) {
        heapIdx[0] = heapIdx[heapLen]; heapCost[0] = heapCost[heapLen];
        let n = 0;
        for (;;) {
            let l = n * 2 + 1, r = l + 1, sm = n;
            if (l < heapLen && heapCost[l] < heapCost[sm]) sm = l;
            if (r < heapLen && heapCost[r] < heapCost[sm]) sm = r;
            if (sm === n) break;
            let ti = heapIdx[sm]; heapIdx[sm] = heapIdx[n]; heapIdx[n] = ti;
            let tc = heapCost[sm]; heapCost[sm] = heapCost[n]; heapCost[n] = tc;
            n = sm;
        }
    }
}

const CLEAR_PENALTY = [0, 6, 2, 0];   // indexed by clearance 0..3
const FLOW_INF = 0x3fffffff;
let flowTimer = 0;

function rebuildFlowField() {
    // 1. Coarse solidity.
    for (let fy = 0; fy < fRows; fy++) {
        let gy0 = fy * fStep;
        for (let fx = 0; fx < fCols; fx++) {
            let gx0 = fx * fStep;
            let solid = 0;
            for (let dy = 0; dy < fStep; dy++) {
                let row = (gy0 + dy) * gridCols;
                for (let dx = 0; dx < fStep; dx++) {
                    let i = gx0 + dx + row;
                    if (staticMask[i] === 1 || gridB[i] > 0.3) solid++;
                }
            }
            fBlocked[fx + fy * fCols] = solid >= 6 ? 1 : 0;
        }
    }
    // Sanctuary interiors are hard no-entry for anything that uses this field.
    for (const s of sanctuaries) {
        let fx0 = Math.max(0, Math.floor((s.x - 8) / fCell));
        let fy0 = Math.max(0, Math.floor((s.y - 8) / fCell));
        let fx1 = Math.min(fCols - 1, Math.ceil((s.x + s.w + 8) / fCell));
        let fy1 = Math.min(fRows - 1, Math.ceil((s.y + s.h + 8) / fCell));
        for (let fx = fx0; fx <= fx1; fx++) {
            for (let fy = fy0; fy <= fy1; fy++) fBlocked[fx + fy * fCols] = 1;
        }
    }

    // 2. Clearance: multi-source BFS out from blocked cells, capped at 3.
    let qHead = 0, qTail = 0;
    for (let i = 0; i < fSize; i++) {
        if (fBlocked[i]) { fClear[i] = 0; bfsQueue[qTail++] = i; }
        else fClear[i] = 255;
    }
    while (qHead < qTail) {
        let i = bfsQueue[qHead++];
        let d = fClear[i];
        if (d >= 3) continue;
        let cx = i % fCols, cy = (i / fCols) | 0;
        for (let n = 0; n < 4; n++) {
            let nx = cx + (n === 0 ? 1 : n === 1 ? -1 : 0);
            let ny = cy + (n === 2 ? 1 : n === 3 ? -1 : 0);
            if (nx < 0 || nx >= fCols || ny < 0 || ny >= fRows) continue;
            let ni = nx + ny * fCols;
            if (fClear[ni] === 255) {
                fClear[ni] = d + 1;
                if (qTail < fSize) bfsQueue[qTail++] = ni;
            }
        }
    }
    for (let i = 0; i < fSize; i++) if (fClear[i] === 255) fClear[i] = 3;

    // 3. Dijkstra outward from the player.
    for (let i = 0; i < fSize; i++) fCost[i] = FLOW_INF;
    heapLen = 0;

    let px = Math.min(fCols - 1, Math.max(0, Math.floor(player.x / fCell)));
    let py = Math.min(fRows - 1, Math.max(0, Math.floor(player.y / fCell)));
    let start = px + py * fCols;
    if (fBlocked[start]) {
        // The player is inside a sanctuary. The central base is 13 flow cells
        // across, so a short radial search can never escape it -- when that
        // happened the seed was dropped and EVERY cost stayed at INF, killing
        // pathfinding outright. Search far enough to clear the largest room,
        // and seed from every equally-nearest open cell so enemies funnel to
        // whichever doorway is closest to you.
        const seeds = [];
        for (let r = 1; r <= 24 && seeds.length === 0; r++) {
            for (let oy = -r; oy <= r; oy++) {
                for (let ox = -r; ox <= r; ox++) {
                    if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
                    const nx = px + ox, ny = py + oy;
                    if (nx < 0 || nx >= fCols || ny < 0 || ny >= fRows) continue;
                    const ni = nx + ny * fCols;
                    if (!fBlocked[ni]) seeds.push(ni);
                }
            }
        }
        if (seeds.length === 0) return;
        for (let i = 0; i < seeds.length; i++) {
            fCost[seeds[i]] = 0;
            heapPush(seeds[i], 0);
        }
    } else {
        fCost[start] = 0;
        heapPush(start, 0);
    }

    while (heapLen > 0) {
        heapPop();
        let i = heapTopIdx, c = heapTopCost;
        if (c > fCost[i]) continue;
        let cx = i % fCols, cy = (i / fCols) | 0;
        for (let n = 0; n < 8; n++) {
            let ox = (n === 0 || n === 4 || n === 7) ? 1 : (n === 1 || n === 5 || n === 6) ? -1 : 0;
            let oy = (n === 2 || n === 4 || n === 6) ? 1 : (n === 3 || n === 5 || n === 7) ? -1 : 0;
            let nx = cx + ox, ny = cy + oy;
            if (nx < 0 || nx >= fCols || ny < 0 || ny >= fRows) continue;
            let ni = nx + ny * fCols;
            if (fBlocked[ni]) continue;
            let step = (ox !== 0 && oy !== 0) ? 3 : 2;
            let nc = c + step + CLEAR_PENALTY[fClear[ni]];
            if (nc < fCost[ni]) { fCost[ni] = nc; heapPush(ni, nc); }
        }
    }
}

// Can anything at this position actually path to the player?
function flowReachable(x, y) {
    const cx = Math.floor(x / fCell), cy = Math.floor(y / fCell);
    if (cx < 0 || cx >= fCols || cy < 0 || cy >= fRows) return false;
    return fCost[cx + cy * fCols] < FLOW_INF;
}

// Returns a unit step toward the cheapest neighbouring flow cell, or null.
function flowDir(x, y) {
    let cx = Math.floor(x / fCell), cy = Math.floor(y / fCell);
    if (cx < 0 || cx >= fCols || cy < 0 || cy >= fRows) return null;
    let here = fCost[cx + cy * fCols];
    let bestCost = here, bx = 0, by = 0;
    for (let oy = -1; oy <= 1; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
            if (ox === 0 && oy === 0) continue;
            let nx = cx + ox, ny = cy + oy;
            if (nx < 0 || nx >= fCols || ny < 0 || ny >= fRows) continue;
            let ni = nx + ny * fCols;
            if (fBlocked[ni]) continue;
            if (fCost[ni] < bestCost) { bestCost = fCost[ni]; bx = ox; by = oy; }
        }
    }
    if (bx === 0 && by === 0) return null;
    let m = Math.hypot(bx, by);
    return { x: bx / m, y: by / m };
}

