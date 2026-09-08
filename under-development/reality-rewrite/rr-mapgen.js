// ===================================================
//   Reality Rewrite -- map generation
// ===================================================
// Split out of reality-rewrite.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md ~2.1). This is the 6-file split that
// reality-rewrite/CLAUDE.md has described as PLANNED since before
// 2026-09-02 -- it now exists.
//
// Lines 906-1038 were MOVED VERBATIM and IN SOURCE ORDER. Nothing was
// reordered: resize() is CALLED at load time, canvas/ctx resolve DOM at
// load time, and `mouse` reads the `width` that resize() set. Preserving
// the sequence is what makes the cut safe without hoisting anything.
//
// Classic scripts, one shared global scope, no modules (the file://
// hard constraint).
"use strict";

// -----------------------------------------------------------
// SETUP & LOGIC
// -----------------------------------------------------------

// Rotates a centered rect offset (dx,dy,w,h) by 90-degree increments.
function rotateOffset(dx, dy, w, h, rot) {
    rot = ((rot % 4) + 4) % 4;
    for (let i = 0; i < rot; i++) {
        [dx, dy, w, h] = [-dy, dx, h, w];
    }
    return [dx, dy, w, h];
}

// Builds one piece (1-2 rects) centered at (mx,my), scaled to unit size u:
// a pillar, a round pillar, a straight bar, an L-corner, or a T-junction.
function makePieceRects(mx, my, u) {
    const kinds = ['pillar','pillar','pillar','round','round','bar','bar','L','L','T','T'];
    let kind = kinds[Math.floor(Math.random()*kinds.length)];
    let rot = Math.floor(Math.random()*4);
    let shape = 'rect';
    let rects;
    if (kind === 'pillar') rects = [[0,0,u,u]];
    else if (kind === 'round') { rects = [[0,0,u,u]]; shape = 'circle'; }
    else if (kind === 'bar') { rects = [[0,0,u*2.6,u*0.7]]; rot = rot % 2; }
    else if (kind === 'L') rects = [[u*0.75,u*0.2,u*1.5,u*0.55], [u*0.2,u*0.75,u*0.55,u*1.5]];
    else rects = [[0,0,u*2.3,u*0.55], [0,-u*0.85,u*0.55,u*1.5]];

    return rects.map(([dx,dy,w,h]) => {
        let [rdx,rdy,rw,rh] = rotateOffset(dx,dy,w,h,rot);
        return { x: mx+rdx-rw/2, y: my+rdy-rh/2, w: rw, h: rh, shape };
    });
}

// Recursively quarters the region down to `depth`, placing one piece at each
// leaf cell's midpoint (skipping the pool and a random 12% for breathing room).
function subdivideForPieces(x0, y0, x1, y1, depth, u, out) {
    let mx = (x0+x1)/2, my = (y0+y1)/2;
    if (depth === 0) {
        if (dist({x:mx,y:my}, waterFeature) > POOL_EXCLUSION_RADIUS && Math.random() > 0.12) {
            out.push(...makePieceRects(mx, my, u));
        }
        return;
    }
    subdivideForPieces(x0, y0, mx, my, depth-1, u, out);
    subdivideForPieces(mx, y0, x1, my, depth-1, u, out);
    subdivideForPieces(x0, my, mx, y1, depth-1, u, out);
    subdivideForPieces(mx, my, x1, y1, depth-1, u, out);
}

// Castellated border ring: one edge's alternating rhythm, rotated/mirrored onto all 4 sides.
function buildBorder() {
    let edge = [];
    const unit = 150;
    let x = 60, toggle = 0;
    while (x < mapBounds.w - 60 - 95) {
        if (toggle % 2 === 0) edge.push([x, 16, 95, 40]);
        else edge.push([x, 72, 60, 36]);
        x += unit; toggle++;
    }
    edge.forEach(([ex,ey,ew,eh]) => {
        blocks.push(new Block(ex, ey, ew, eh, 'perm'));                                  // top
        blocks.push(new Block(ex, mapBounds.h - ey - eh, ew, eh, 'perm'));               // bottom
        blocks.push(new Block(ey, ex, eh, ew, 'perm'));                                  // left
        blocks.push(new Block(mapBounds.w - ey - eh, ex, eh, ew, 'perm'));               // right
    });

    // Stepped corner clusters
    const cSizes = [95, 65, 40];
    cSizes.forEach((s, i) => {
        const off = 20 + i*45;
        [[off,off],[mapBounds.w-off-s,off],[off,mapBounds.h-off-s],[mapBounds.w-off-s,mapBounds.h-off-s]].forEach(([bx,by]) => {
            blocks.push(new Block(bx, by, s, s, 'perm'));
        });
    });
}

function buildMap() {
    blocks = [];
    const cx = mapBounds.w/2, cy = mapBounds.h/2;

    // Pool geometry set first so the recursive scatter can carve around it.
    waterFeature = { x: cx, y: cy, radius: 150 };
    poolLobes = [
        { x: cx, y: cy, rx: 85, ry: 160 },   // main elongated body
        { x: cx - 95, y: cy, rx: 60, ry: 60 }, // left lobe
        { x: cx + 95, y: cy, rx: 60, ry: 60 }  // right lobe
    ];

    buildBorder();

    // Recursive interior scatter: generate one quadrant, mirror into all 4.
    const interiorMargin = 230;
    const depth = 3;
    const cell = (cx - interiorMargin) / Math.pow(2, depth);
    const u = cell * 0.24;

    let quadrantPieces = [];
    subdivideForPieces(interiorMargin, interiorMargin, cx, cy, depth, u, quadrantPieces);
    quadrantPieces.forEach(p => {
        blocks.push(new Block(p.x, p.y, p.w, p.h, 'perm', p.shape));
        blocks.push(new Block(mapBounds.w - p.x - p.w, p.y, p.w, p.h, 'perm', p.shape));
        blocks.push(new Block(p.x, mapBounds.h - p.y - p.h, p.w, p.h, 'perm', p.shape));
        blocks.push(new Block(mapBounds.w - p.x - p.w, mapBounds.h - p.y - p.h, p.w, p.h, 'perm', p.shape));
    });

    // Small solid plinth in the center of the pool
    blocks.push(new Block(cx - 25, cy - 25, 50, 50, 'perm'));
}

// Finds a spawn point at least SPAWN_SAFE_DIST from every living player and clear of blocks.
function findSafeSpawn() {
    const pad = 60;
    for (let attempt = 0; attempt < 60; attempt++) {
        let x = mapBounds.x + pad + Math.random() * (mapBounds.w - pad*2);
        let y = mapBounds.y + pad + Math.random() * (mapBounds.h - pad*2);

        if (players.some(p => p.hp > 0 && dist({x,y}, p) < SPAWN_SAFE_DIST)) continue;
        if (blocks.some(b => x > b.x - pad && x < b.x + b.w + pad && y > b.y - pad && y < b.y + b.h + pad)) continue;

        return { x, y };
    }
    // Fallback if the map is too crowded to satisfy the full constraint: best of a few tries.
    let best = null, bestScore = -Infinity;
    for (let i = 0; i < 20; i++) {
        let x = mapBounds.x + pad + Math.random() * (mapBounds.w - pad*2);
        let y = mapBounds.y + pad + Math.random() * (mapBounds.h - pad*2);
        let living = players.filter(p => p.hp > 0);
        let minToAny = living.length ? Math.min(...living.map(p => dist({x,y}, p))) : Infinity;
        if (minToAny > bestScore) { bestScore = minToAny; best = {x, y}; }
    }
    return best || { x: mapBounds.x + mapBounds.w/2, y: mapBounds.y + mapBounds.h/2 };
}

