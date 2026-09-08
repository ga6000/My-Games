// ===================================================
//   Zombie — level: seeded world geometry
// ===================================================
// EVERYTHING in this file must come from MP.random(), never Math.random().
// Every client generates the level independently from one server-issued
// seed; a single stray Math.random() here and two players collide with
// walls the other cannot see. Cosmetic per-client jitter belongs
// elsewhere. See shared/mp-core.js for why this exists.
"use strict";

let walls = [];        // static solid rects {x,y,w,h}
let doors = [];        // {x,y,w,h,cost,open}   -- closed doors block PLAYERS and zombies
let barricades = [];   // {x,y,w,h,hp,maxHp}    -- windows: zombies break in, players never pass
let wallBuys = [];     // {x,y,w,h,weapon,cost}
let ammoCrates = [];   // {x,y,size,uses}
let barrels = [];      // {x,y,size,alive}
let traps = [];        // {x,y,w,h,cost,armedUntil,readyAt}
let keepRect = null;   // the defensible centre
let levelSeed = null;  // which seed the current geometry was built from
let reservedRects = []; // keep + doorways; scattered buildings must avoid these
let zonePassages = {};  // "a>b" -> {door, window} : how to get between two zones
// How long a zone stays off-limits as a spawn site after anyone was in
// or looking at it. A zone you left a minute ago and cannot see is not
// "ground you just walked through" -- but the one behind you is.
const ZONE_COOLDOWN_MS = 45000;
let zoneHotUntil = [];  // deadline per zone; spawn-eligible once past it

// ---------------------------------------------------
//   ZONES
// ---------------------------------------------------
// The map is segmented into a 3x3 grid of 1600x900 zones. You start
// sealed in the centre one and buy your way outward, so the opening
// rounds are fought in a small, readable space instead of an open plain.
//
// The thing that makes segmentation safe is the barricades: EVERY zone
// boundary carries a door (players, bought) and a boarded window
// (zombies, broken through). So zombies can always reach every zone
// without any pathfinding, and no sealed area can ever become a place
// the horde can't follow you into. That's what stops "start small" from
// turning into "hide in a box".
const ZONE_COLS = 3;
const ZONE_ROWS = 3;
const ZONE_W = WORLD_W / ZONE_COLS;   // 1600
const ZONE_H = WORLD_H / ZONE_ROWS;   // 900
const WALL_T = 20;

// Zombie navigation between zones. Without this they beeline at the
// player, jam against a boundary wall several hundred px from the
// nearest window, and never find their way in -- the classic failure of
// naive chase AI on a segmented map, and the reason the barricades alone
// weren't enough.
function passageKey(a, b) {
    return a < b ? a + ">" + b : b + ">" + a;
}

// One zone step from `fromZone` toward `toZone`, along whichever axis
// has further to go. Corners are handled by re-deciding after each
// crossing rather than planning the whole route.
function zoneStepToward(fromZone, toZone) {
    const fx = fromZone % ZONE_COLS, fy = Math.floor(fromZone / ZONE_COLS);
    const tx = toZone % ZONE_COLS, ty = Math.floor(toZone / ZONE_COLS);
    let dx = Math.sign(tx - fx), dy = Math.sign(ty - fy);
    if (dx && dy) {
        if (Math.abs(tx - fx) >= Math.abs(ty - fy)) dy = 0;
        else dx = 0;
    }
    const nx = fx + dx, ny = fy + dy;
    if (nx < 0 || ny < 0 || nx >= ZONE_COLS || ny >= ZONE_ROWS) return -1;
    return ny * ZONE_COLS + nx;
}

// Where a zombie in `fromZone` should head to make progress toward
// `toZone`. Prefers an already-open door (no chewing needed); otherwise
// the boarded window, which it will break through on arrival.
function zoneWaypoint(fromZone, toZone) {
    const next = zoneStepToward(fromZone, toZone);
    if (next < 0) return null;
    const pas = zonePassages[passageKey(fromZone, next)];
    if (!pas) return null;
    const gate = (pas.door && pas.door.open) ? pas.door : pas.window;
    if (!gate) return null;

    // Aim THROUGH the gate, not at it. Targeting the gate centre meant a
    // zombie arrived, found itself standing on its own goal, and stopped
    // -- still on the far side, because the boundary line runs through
    // the gate's middle. The offset is along the gate's normal only, so
    // the approach stays square to a 90-120px gap instead of angling
    // across it.
    const gx = gate.x + gate.w / 2;
    const gy = gate.y + gate.h / 2;
    const ncx = (next % ZONE_COLS + 0.5) * ZONE_W;
    const ncy = (Math.floor(next / ZONE_COLS) + 0.5) * ZONE_H;
    const through = 80;

    if (gate.w < gate.h) return { x: gx + Math.sign(ncx - gx) * through, y: gy };
    return { x: gx, y: gy + Math.sign(ncy - gy) * through };
}

function zoneOf(x, y) {
    const cx = clamp(Math.floor(x / ZONE_W), 0, ZONE_COLS - 1);
    const cy = clamp(Math.floor(y / ZONE_H), 0, ZONE_ROWS - 1);
    return cy * ZONE_COLS + cx;
}

// 0 = centre, 1 = orthogonal neighbour, 2 = corner.
function zoneRing(cx, cy) {
    return Math.max(Math.abs(cx - 1), Math.abs(cy - 1));
}

// ---------------------------------------------------
//   SPATIAL INDEX  (two of them)
// ---------------------------------------------------
// Players and zombies do NOT see the same walls, so they get separate
// grids:
//
//   player set  = walls + closed doors + ALL barricades
//   zombie set  = walls + closed doors + INTACT barricades only
//
// A broken window is therefore a permanent zombie highway and never a
// shortcut for players -- which is what keeps the door economy meaning
// something after the first window goes down.
// Half the LARGEST zombie (brute, 26px). The nav grid used to pad by 8
// -- half a 16px walker -- so the flow field happily routed brutes,
// splitters and screamers through gaps they physically cannot fit into.
// They wedged, the wall-slide fought them, and they ended up parked
// against geometry, most visibly along the map edge. Measured before the
// fix: walkers 100% reached the player, brutes 38%.
//
// Consequence to respect: the width the field can guarantee is
// 2*NAV_CELL + 2*NAV_PAD, so every opening a zombie is expected to route
// through must be wider than that. (That figure was written as 106px
// when NAV_CELL was 40; at NAV_CELL 20 it is 70px. The narrowest opening
// in the map is the outpost doorway at 112, windows are 112-151 and
// doors 124-159, so all of them clear it comfortably.)
//
// 15, not 13. 13 is EXACTLY half a brute, so a cell the field called
// passable was exactly brute-wide and not one pixel wider -- any float
// error at a corner clipped. The two extra pixels are skin, and cost
// nothing: the guarantee moves 66px -> 70px against a 112px floor.
const NAV_PAD = 15;

const GRID_CELL = 300;
let solidGridPlayer = {};
let solidGridZombie = {};

function gridKey(cx, cy) {
    return cx + "," + cy;
}

function solidRectsFor(forZombie) {
    const out = walls.slice();
    for (let i = 0; i < doors.length; i++) if (!doors[i].open) out.push(doors[i]);
    for (let i = 0; i < barricades.length; i++) {
        if (!forZombie || barricades[i].hp > 0) out.push(barricades[i]);
    }
    return out;
}

// Kept for callers that just want "what is solid right now" for the
// player, e.g. tests and the old single-set call sites.
function solidRects() {
    return solidRectsFor(false);
}

function buildGrid(rects) {
    const grid = {};
    for (let i = 0; i < rects.length; i++) {
        const r = rects[i];
        const x0 = Math.floor(r.x / GRID_CELL);
        const y0 = Math.floor(r.y / GRID_CELL);
        const x1 = Math.floor((r.x + r.w) / GRID_CELL);
        const y1 = Math.floor((r.y + r.h) / GRID_CELL);
        for (let cx = x0; cx <= x1; cx++) {
            for (let cy = y0; cy <= y1; cy++) {
                const k = gridKey(cx, cy);
                if (!grid[k]) grid[k] = [];
                grid[k].push(r);
            }
        }
    }
    return grid;
}

// Call after ANY change to doors or barricades, or collision goes stale.
function rebuildSolidIndex() {
    solidGridPlayer = buildGrid(solidRectsFor(false));
    solidGridZombie = buildGrid(solidRectsFor(true));

    const sig = doorSignature();
    if (sig !== navDoorSig) {
        // A door changes passability only AROUND ITSELF, so recompute
        // that patch rather than all 32,400 cells. The full rebuild costs
        // ~17ms -- a dropped frame at the exact instant of a purchase,
        // which is the worst possible moment for a stutter.
        if (navDoorSig && navPassable && navDoorSig.length === sig.length) {
            for (let i = 0; i < sig.length; i++) {
                if (sig[i] !== navDoorSig[i]) refreshNavRegion(doors[i]);
            }
        } else {
            markNavDirty();   // different level entirely
        }
        navDoorSig = sig;
    }
}

// Recompute nav passability for just the cells overlapping one rect.
function refreshNavRegion(r) {
    if (!navPassable || !r) return;

    const rects = walls.slice();
    for (let i = 0; i < doors.length; i++) if (!doors[i].open) rects.push(doors[i]);
    const grid = buildGrid(rects);

    const pad = NAV_PAD;
    const margin = NAV_CELL * 2;
    const cx0 = Math.max(0, Math.floor((r.x - margin) / NAV_CELL));
    const cy0 = Math.max(0, Math.floor((r.y - margin) / NAV_CELL));
    const cx1 = Math.min(navW - 1, Math.floor((r.x + r.w + margin) / NAV_CELL));
    const cy1 = Math.min(navH - 1, Math.floor((r.y + r.h + margin) / NAV_CELL));

    for (let cy = cy0; cy <= cy1; cy++) {
        for (let cx = cx0; cx <= cx1; cx++) {
            const x = cx * NAV_CELL - pad;
            const y = cy * NAV_CELL - pad;
            const w = NAV_CELL + pad * 2;
            const h = NAV_CELL + pad * 2;

            let blocked = false;
            const gx0 = Math.floor(x / GRID_CELL);
            const gy0 = Math.floor(y / GRID_CELL);
            const gx1 = Math.floor((x + w) / GRID_CELL);
            const gy1 = Math.floor((y + h) / GRID_CELL);
            for (let g = gx0; g <= gx1 && !blocked; g++) {
                for (let k = gy0; k <= gy1 && !blocked; k++) {
                    const bucket = grid[gridKey(g, k)];
                    if (!bucket) continue;
                    for (let i = 0; i < bucket.length; i++) {
                        const rr = bucket[i];
                        if (rectIntersect(x, y, w, h, rr.x, rr.y, rr.w, rr.h)) { blocked = true; break; }
                    }
                }
            }
            navPassable[cy * navW + cx] = blocked ? 0 : 1;
        }
    }
}

function solidsNear(x, y, w, h, forZombie) {
    const grid = forZombie ? solidGridZombie : solidGridPlayer;
    const seen = [];
    const x0 = Math.floor(x / GRID_CELL);
    const y0 = Math.floor(y / GRID_CELL);
    const x1 = Math.floor((x + w) / GRID_CELL);
    const y1 = Math.floor((y + h) / GRID_CELL);
    for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
            const bucket = grid[gridKey(cx, cy)];
            if (!bucket) continue;
            for (let i = 0; i < bucket.length; i++) {
                if (seen.indexOf(bucket[i]) === -1) seen.push(bucket[i]);
            }
        }
    }
    return seen;
}

function blockedAt(x, y, size, forZombie) {
    const near = solidsNear(x, y, size, size, forZombie);
    for (let i = 0; i < near.length; i++) {
        const r = near[i];
        if (rectIntersect(x, y, size, size, r.x, r.y, r.w, r.h)) return true;
    }
    return false;
}

// Axis-separated so sliding along a wall works instead of sticking.
// `clampToWorld` is false for a zombie until it has been fully inside the
// map once -- they spawn off the edge and walk in, but must not be able
// to walk back out (see the leash in updateZombies).
//
// Resolution is by the SIGN of the delta, which is right for the normal
// case: an entity that was clear before the step and is overlapping after
// it gets pushed back the way it came. It is wrong for an entity that was
// ALREADY overlapping, where the sign says nothing about which face it
// should leave by -- a 26px brute standing in a 20px wall could be shoved
// straight through to the far side. And with a delta of exactly 0 the old
// code did not resolve at all, so an embedded entity moving on one axis
// only stayed embedded forever.
//
// The two cases separate exactly: a legitimate step needs a correction no
// larger than |delta|. Anything bigger means the overlap predates the
// step, so eject to the NEARER face instead.
function moveWithCollisions(entity, dx, dy, clampToWorld, forZombie) {
    entity.x += dx;
    let near = solidsNear(entity.x, entity.y, entity.size, entity.size, forZombie);
    for (let i = 0; i < near.length; i++) {
        const w = near[i];
        if (rectIntersect(entity.x, entity.y, entity.size, entity.size, w.x, w.y, w.w, w.h)) {
            const back = (dx > 0) ? (w.x - entity.size) : (w.x + w.w);
            if (dx !== 0 && Math.abs(back - entity.x) <= Math.abs(dx) + 1) {
                entity.x = back;
            } else {
                const outLeft = w.x - entity.size;
                const outRight = w.x + w.w;
                entity.x = (Math.abs(outLeft - entity.x) <= Math.abs(outRight - entity.x))
                    ? outLeft : outRight;
            }
        }
    }

    entity.y += dy;
    near = solidsNear(entity.x, entity.y, entity.size, entity.size, forZombie);
    for (let i = 0; i < near.length; i++) {
        const w = near[i];
        if (rectIntersect(entity.x, entity.y, entity.size, entity.size, w.x, w.y, w.w, w.h)) {
            const back = (dy > 0) ? (w.y - entity.size) : (w.y + w.h);
            if (dy !== 0 && Math.abs(back - entity.y) <= Math.abs(dy) + 1) {
                entity.y = back;
            } else {
                const outUp = w.y - entity.size;
                const outDown = w.y + w.h;
                entity.y = (Math.abs(outUp - entity.y) <= Math.abs(outDown - entity.y))
                    ? outUp : outDown;
            }
        }
    }

    if (clampToWorld) {
        entity.x = clamp(entity.x, 0, WORLD_W - entity.size);
        entity.y = clamp(entity.y, 0, WORLD_H - entity.size);
    }
}


// ---------------------------------------------------
//   NAVIGATION FLOW FIELD
// ---------------------------------------------------
// Segmenting the map broke naive chase AI: a zombie beelining at the
// player jams on a building corner or on the wall beside a window and
// never arrives. Wall-following heuristics got most of the horde through
// but reliably stranded a few, which on a segmented map means "the round
// never ends".
//
// So zombies path on a coarse BFS flow field instead. Multi-source BFS
// from every player gives each zombie the nearest player BY PATH, not by
// straight line, and the gradient is always locally correct -- there is
// no stuck state to escape from.
//
// Crucially, BARRICADES ARE PASSABLE HERE. Boarded windows are the way
// in, so the field routes zombies through them; the chewing happens when
// they arrive. Closed doors are NOT passable, which is what keeps
// players' scrap meaningful.
// 20, not 40. A gap is only GUARANTEED to contain a nav cell at
// 2*NAV_CELL + 16 px (cell size, plus half-a-zombie padding on each
// side, plus up to a whole cell lost to grid alignment). At 40 that
// threshold was 96px, which silently made nook openings, outpost
// doorways and narrow windows invisible to the pathfinder -- physically
// walkable, but sealed as far as the flow field was concerned. At 20 the
// threshold is 56px, which every opening in the map clears.
const NAV_CELL = 20;
let navW = 0;
let navH = 0;
let navPassable = null;
let navDirty = true;
let navDoorSig = null;   // nav passability depends on doors ONLY

// Barricades are passable in the field whether boarded or not, so a
// window breaking cannot change nav passability -- only a door can.
// Rebuilding on every barricade hit cost a ~14ms hitch mid-fight, which
// is most of a frame at 60fps.
function doorSignature() {
    let sig = "";
    for (let i = 0; i < doors.length; i++) sig += doors[i].open ? "1" : "0";
    return sig;
}

function markNavDirty() {
    navDirty = true;
}

function rebuildNavGrid() {
    navW = Math.ceil(WORLD_W / NAV_CELL);
    navH = Math.ceil(WORLD_H / NAV_CELL);
    navPassable = new Uint8Array(navW * navH);

    const rects = walls.slice();
    for (let i = 0; i < doors.length; i++) if (!doors[i].open) rects.push(doors[i]);
    const grid = buildGrid(rects);

    // A cell is passable only if NOTHING solid touches it, padded by half
    // a zombie. Testing a small box at the cell CENTRE instead is the
    // obvious version and it is badly wrong: a 20px wall falls in the gap
    // between two adjacent cell centres, so every wall in the map was
    // invisible to the BFS and the field flowed straight through solid
    // geometry -- which sent zombies walking confidently into walls and
    // stopping there. Whole-cell testing is conservative (it slightly
    // over-blocks near corners) but it can never invent a path.
    const pad = NAV_PAD;
    for (let cy = 0; cy < navH; cy++) {
        for (let cx = 0; cx < navW; cx++) {
            const x = cx * NAV_CELL - pad;
            const y = cy * NAV_CELL - pad;
            const w = NAV_CELL + pad * 2;
            const h = NAV_CELL + pad * 2;

            let blocked = false;
            const gx0 = Math.floor(x / GRID_CELL);
            const gy0 = Math.floor(y / GRID_CELL);
            const gx1 = Math.floor((x + w) / GRID_CELL);
            const gy1 = Math.floor((y + h) / GRID_CELL);
            for (let g = gx0; g <= gx1 && !blocked; g++) {
                for (let k = gy0; k <= gy1 && !blocked; k++) {
                    const bucket = grid[gridKey(g, k)];
                    if (!bucket) continue;
                    for (let i = 0; i < bucket.length; i++) {
                        const r = bucket[i];
                        if (rectIntersect(x, y, w, h, r.x, r.y, r.w, r.h)) { blocked = true; break; }
                    }
                }
            }
            navPassable[cy * navW + cx] = blocked ? 0 : 1;
        }
    }
    navDoorSig = doorSignature();
    navDirty = false;
}

// Multi-source BFS. Returns step distance per cell, -1 where unreachable.
function navFieldFrom(points) {
    if (navDirty || !navPassable) rebuildNavGrid();
    const dist = new Int32Array(navW * navH).fill(-1);
    const q = new Int32Array(navW * navH);
    let tail = 0;

    for (let i = 0; i < points.length; i++) {
        const cx = clamp(Math.floor(points[i].x / NAV_CELL), 0, navW - 1);
        const cy = clamp(Math.floor(points[i].y / NAV_CELL), 0, navH - 1);
        const idx = cy * navW + cx;
        if (dist[idx] === -1) {
            dist[idx] = 0;
            q[tail++] = idx;
        }
    }

    let head = 0;
    while (head < tail) {
        const idx = q[head++];
        const cx = idx % navW;
        const cy = (idx / navW) | 0;
        const nd = dist[idx] + 1;
        for (let k = 0; k < 4; k++) {
            const ax = cx + (k === 0 ? 1 : k === 1 ? -1 : 0);
            const ay = cy + (k === 2 ? 1 : k === 3 ? -1 : 0);
            if (ax < 0 || ay < 0 || ax >= navW || ay >= navH) continue;
            const ai = ay * navW + ax;
            if (dist[ai] !== -1 || !navPassable[ai]) continue;
            dist[ai] = nd;
            q[tail++] = ai;
        }
    }
    return dist;
}

// Is the straight line from (x0,y0) to (x1,y1) walkable by a zombie?
// Samples finely enough to catch a 20px door. The first few px are
// skipped because the caller is typically already overlapping the wall
// it's pressed against, which would fail every candidate.
function navClearLine(x0, y0, x1, y1) {
    const dist = Math.hypot(x1 - x0, y1 - y0);
    if (dist < 1) return true;
    const steps = Math.ceil(dist / 6);
    for (let i = 1; i <= steps; i++) {
        const t = i / steps;
        if (dist * t < 12) continue;
        if (blockedAt(x0 + (x1 - x0) * t - 8, y0 + (y1 - y0) * t - 8, 16, true)) return false;
    }
    return true;
}

// The next point to walk toward: centre of the lowest-distance neighbour.
// Returns null when already at the goal or off the field, in which case
// the caller falls back to a straight line.
// Walks the gradient DOWNHILL several cells and returns that point, not
// the next cell centre.
//
// Returning the adjacent cell mattered badly for big zombies: a brute is
// 26px and a nav cell is 20px, so its body spans two or three cells. As
// collision pushes it off a wall its centre flips cell, the chosen
// neighbour flips with it, and it oscillates around a boundary forever --
// moving every frame, travelling nowhere. Measured: a brute covering 10px
// in 66 seconds while reporting stuck = 0.
//
// A target ~5 cells out is stable under that jitter, so the direction
// stops flip-flopping.
const NAV_LOOKAHEAD = 5;

function navStepToward(x, y, field) {
    if (!field || !navPassable) return null;
    let cx = clamp(Math.floor(x / NAV_CELL), 0, navW - 1);
    let cy = clamp(Math.floor(y / NAV_CELL), 0, navH - 1);
    const here = field[cy * navW + cx];
    if (here === 0) return null;   // standing on a source

    // here === -1 means this cell was never reached by the BFS, which in
    // practice means the entity is pressed flat against a wall and
    // straddling it. Insisting on a strictly-downhill neighbour then
    // returns nothing, the caller falls back to a straight line, and the
    // zombie walks into the wall it is already touching -- forever. So
    // when we are off the field, drop the downhill requirement and widen
    // the search: any reachable cell nearby is progress.
    if (here < 0) {
        let best = Infinity, bx = -1, by = -1;
        for (let ox = -2; ox <= 2; ox++) {
            for (let oy = -2; oy <= 2; oy++) {
                if (!ox && !oy) continue;
                const ax = cx + ox, ay = cy + oy;
                if (ax < 0 || ay < 0 || ax >= navW || ay >= navH) continue;
                const ai = ay * navW + ax;
                if (!navPassable[ai]) continue;
                const d = field[ai];
                if (d < 0 || d >= best) continue;
                best = d; bx = ax; by = ay;
            }
        }
        if (bx < 0) return null;
        return { x: bx * NAV_CELL + NAV_CELL / 2, y: by * NAV_CELL + NAV_CELL / 2 };
    }

    let curr = here;
    let outX = -1, outY = -1;
    for (let step = 0; step < NAV_LOOKAHEAD; step++) {
        let best = curr, bx = -1, by = -1;
        for (let ox = -1; ox <= 1; ox++) {
            for (let oy = -1; oy <= 1; oy++) {
                if (!ox && !oy) continue;
                const ax = cx + ox, ay = cy + oy;
                if (ax < 0 || ay < 0 || ax >= navW || ay >= navH) continue;
                const ai = ay * navW + ax;
                if (!navPassable[ai]) continue;
                const d = field[ai];
                if (d < 0 || d >= best) continue;
                best = d; bx = ax; by = ay;
            }
        }
        if (bx < 0) break;
        cx = bx; cy = by; curr = best;
        outX = bx; outY = by;
        if (curr === 0) break;      // reached the target cell
    }
    if (outX < 0) return null;
    return { x: outX * NAV_CELL + NAV_CELL / 2, y: outY * NAV_CELL + NAV_CELL / 2 };
}


// ---------------------------------------------------
//   GENERATION
// ---------------------------------------------------
const KEEP_W = 620;
const KEEP_H = 420;

// --- zone identity (ideas 27 + 35) -----------------------------------
// v2 generated all eight outer zones identically: one wall-buy and one
// crate at a random spot. That made the one interesting decision
// segmentation created -- WHICH door do we buy? -- completely arbitrary.
// Each zone now has a layout character and a name you can call out.
const ZONE_TEMPLATES = [
    { key: "cold",    name: "COLD STORAGE", buildings: 15, barrels: 3,  crates: 2, outpost: false, corridors: false },
    { key: "pool",    name: "THE DRY POOL", buildings: 3,  barrels: 10, crates: 1, outpost: true,  corridors: false },
    { key: "motor",   name: "MOTOR POOL",   buildings: 8,  barrels: 5,  crates: 1, outpost: true,  corridors: false },
    { key: "laundry", name: "THE LAUNDRY",  buildings: 4,  barrels: 2,  crates: 1, outpost: false, corridors: true },
    { key: "spill",   name: "SPILLWAY",     buildings: 2,  barrels: 4,  crates: 1, outpost: false, corridors: true },
    { key: "kennel",  name: "THE KENNELS",  buildings: 17, barrels: 2,  crates: 2, outpost: false, corridors: false },
    { key: "letter",  name: "DEAD LETTER",  buildings: 7,  barrels: 2,  crates: 3, outpost: true,  corridors: false },
    { key: "slag",    name: "SLAG HEAP",    buildings: 4,  barrels: 12, crates: 1, outpost: false, corridors: false },
    { key: "ticket",  name: "TICKET HALL",  buildings: 5,  barrels: 4,  crates: 2, outpost: true,  corridors: false },
    { key: "annex",   name: "THE ANNEX",    buildings: 10, barrels: 3,  crates: 1, outpost: true,  corridors: false },
    { key: "pump",    name: "PUMP HOUSE",   buildings: 9,  barrels: 4,  crates: 2, outpost: true,  corridors: false }
];

// Always placed, always exactly one: it holds the generator.
const TURBINE_TEMPLATE =
    { key: "turbine", name: "TURBINE HALL", buildings: 6, barrels: 3, crates: 1, outpost: true, corridors: false, generator: true };

const CENTRE_TEMPLATE =
    { key: "centre", name: "THE BLOCKHOUSE", buildings: 3, barrels: 2, crates: 0, outpost: false, corridors: false };

let zoneInfo = [];        // 9 entries, index = zone number
let generatorRect = null; // {x,y,w,h,cost}
let codexRect = null;     // the field manual terminal, in the keep
let generatorOn = false;
let cardStations = [];    // {x,y,w,h,card,cost}

function zoneName(i) {
    return (zoneInfo[i] && zoneInfo[i].name) || "";
}

// Seeded shuffle -- MP.random so every client lays the map out the same.
function seededShuffle(arr) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
        const j = Math.floor(MP.random() * (i + 1));
        const t = a[i]; a[i] = a[j]; a[j] = t;
    }
    return a;
}

function assignZones() {
    zoneInfo = new Array(ZONE_COLS * ZONE_ROWS);
    zoneInfo[4] = { name: CENTRE_TEMPLATE.name, tpl: CENTRE_TEMPLATE };

    const outer = [];
    for (let i = 0; i < 9; i++) if (i !== 4) outer.push(i);

    const pool = seededShuffle(ZONE_TEMPLATES);
    const turbineAt = outer[Math.floor(MP.random() * outer.length)];

    let p = 0;
    for (let k = 0; k < outer.length; k++) {
        const z = outer[k];
        const tpl = (z === turbineAt) ? TURBINE_TEMPLATE : pool[p++];
        zoneInfo[z] = { name: tpl.name, tpl: tpl };
    }
}

function zoneBounds(i) {
    const cx = i % ZONE_COLS;
    const cy = Math.floor(i / ZONE_COLS);
    return { x: cx * ZONE_W, y: cy * ZONE_H, w: ZONE_W, h: ZONE_H, cx: cx, cy: cy };
}

function generateLevel() {
    // Rewind to the start of the shared stream first, so a mid-session
    // restart regenerates the SAME level rather than continuing a stream
    // each client has advanced a different number of times.
    MP.resetRandom();
    levelSeed = MP.seed();

    walls = [];
    doors = [];
    barricades = [];
    wallBuys = [];
    ammoCrates = [];
    barrels = [];
    traps = [];
    cardStations = [];
    reservedRects = [];
    generatorRect = null;
    codexRect = null;
    generatorOn = false;

    zoneHotUntil = [0, 0, 0, 0, 0, 0, 0, 0, 0];

    resetEndgame();

    assignZones();
    buildZoneWalls();
    buildKeep();
    buildZoneContents();
    placeWallBuys();
    placeCardStations();
    placeChokepointBarrels();
    buildSluice();
    placeFunnelsAndSilos();

    // The whole map is new, so the nav grid MUST be rebuilt. Leaving this
    // to rebuildSolidIndex's door-signature check is not enough: a fresh
    // level has the same all-closed door pattern as the old one, so the
    // signature matches and the grid silently survives from the previous
    // layout -- zombies then path against walls that no longer exist.
    navDoorSig = null;
    markNavDirty();

    rebuildSolidIndex();
}

// --- zone boundaries -------------------------------------------------
// Every boundary carries one door (players, bought) and 1-3 boarded
// windows (zombies, broken through). The windows are what make
// segmentation safe: there is no zone the horde cannot follow you into.
//
// IDEA 29: window count, width and position all vary per boundary. v2
// used a single 90px window at a fixed 150px offset on all twelve, so
// every boundary read identically and there was nothing to learn.
function buildZoneWalls() {
    for (let v = 1; v < ZONE_COLS; v++) {
        const X = v * ZONE_W - WALL_T / 2;
        for (let r = 0; r < ZONE_ROWS; r++) {
            emitBoundary(true, X, r * ZONE_H, ZONE_H,
                r * ZONE_COLS + (v - 1), r * ZONE_COLS + v);
        }
    }
    for (let h = 1; h < ZONE_ROWS; h++) {
        const Y = h * ZONE_H - WALL_T / 2;
        for (let c = 0; c < ZONE_COLS; c++) {
            emitBoundary(false, Y, c * ZONE_W, ZONE_W,
                (h - 1) * ZONE_COLS + c, h * ZONE_COLS + c);
        }
    }
}

// `vertical` says which axis the wall runs along. `fixed` is its position
// on the other axis, `start`/`span` describe the segment it covers.
function emitBoundary(vertical, fixed, start, span, zoneA, zoneB) {
    // Openings are laid out in equal SLOTS rather than placed freely and
    // then de-overlapped. The free-placement version pushed each opening
    // past the previous one's clearance, and on a crowded boundary the
    // last one was shoved beyond the end of the wall entirely -- which
    // silently produced a boundary with no opening at all, sealing a zone
    // and stranding every zombie behind it. Slots cannot collide and
    // cannot overflow, by construction.
    const winCount = 1 + Math.floor(MP.random() * 3);
    const total = 1 + winCount;
    const slot = span / total;
    const doorSlot = Math.floor(MP.random() * total);
    const margin = 30;

    const gaps = [];
    for (let i = 0; i < total; i++) {
        const isDoor = (i === doorSlot);
        // Every opening clears the nav grid's guaranteed-navigable width
        // (2*NAV_CELL + 2*NAV_PAD = 106px). Windows used to start at 72,
        // which a walker could be routed through but a brute could not.
        const size = isDoor
            ? 124 + Math.floor(MP.random() * 36)
            : 112 + Math.floor(MP.random() * 40);
        const free = Math.max(0, slot - size - margin * 2);
        gaps.push({
            at: start + i * slot + margin + MP.random() * free,
            size: size,
            kind: isDoor ? "door" : "window"
        });
    }

    const ringA = zoneRing(zoneA % ZONE_COLS, Math.floor(zoneA / ZONE_COLS));
    const ringB = zoneRing(zoneB % ZONE_COLS, Math.floor(zoneB / ZONE_COLS));
    const pk = passageKey(zoneA, zoneB);
    zonePassages[pk] = zonePassages[pk] || {};

    let at = start;
    for (let i = 0; i < gaps.length; i++) {
        const g = gaps[i];
        if (g.at > at) pushBoundarySeg(vertical, fixed, at, g.at - at);

        if (g.kind === "door") {
            const d = vertical
                ? { x: fixed, y: g.at, w: WALL_T, h: g.size }
                : { x: g.at, y: fixed, w: g.size, h: WALL_T };
            d.open = false;
            d.cost = 900 + 350 * Math.max(ringA, ringB);
            d.ring = Math.min(ringA, ringB);
            doors.push(d);
            zonePassages[pk].door = d;
            reserveAround(d, 150);
            if (d.ring === 0) addDoorTrap(vertical, d);
        } else {
            const b = vertical
                ? { x: fixed, y: g.at, w: WALL_T, h: g.size, hp: 100, maxHp: 100, chewUntil: 0 }
                : { x: g.at, y: fixed, w: g.size, h: WALL_T, hp: 100, maxHp: 100, chewUntil: 0 };
            barricades.push(b);
            if (!zonePassages[pk].window) zonePassages[pk].window = b;
            reserveAround(b, 120);
        }
        at = g.at + g.size;
    }
    if (at < start + span) pushBoundarySeg(vertical, fixed, at, start + span - at);

    // Cover goes on LAST, once every opening on this boundary is known.
    // Emitting it per-opening let one window's spur run straight across
    // the neighbouring window's mouth and seal it.
    for (let i = 0; i < gaps.length; i++) addBoundaryCover(vertical, fixed, gaps[i], gaps, start, span);
}

function pushBoundarySeg(vertical, fixed, at, len) {
    if (len <= 0) return;
    walls.push(vertical
        ? { x: fixed, y: at, w: WALL_T, h: len }
        : { x: at, y: fixed, w: len, h: WALL_T });
}

function reserveAround(r, pad) {
    reservedRects.push({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 });
}

// IDEA 28: the ground either side of a boundary opening is where you
// actually hold a door, and v2 left it completely empty because
// nearZoneBoundary() pushed all scattered buildings 130px clear. These
// spurs turn each opening into a funnel: the flow field drives zombies
// straight down the throat, and there is something to stand behind.
// The mouth is deliberately wider than the gap, so passage is never
// blocked.
function addBoundaryCover(vertical, fixed, gap, all, segStart, segSpan) {
    const off = 118;          // distance out from the boundary
    const spur = 96;          // spur length
    const mouth = 62;         // clearance either side of the gap

    const ranges = [
        [gap.at - mouth - spur, gap.at - mouth],
        [gap.at + gap.size + mouth, gap.at + gap.size + mouth + spur]
    ];

    for (let r = 0; r < ranges.length; r++) {
        // Clipped to this boundary segment. Unclipped, a spur ran past
        // the end of its own wall and wrapped around the intersection
        // with the perpendicular boundary, boxing in a small corner
        // pocket that nothing could path into -- a free safe spot.
        // 150, not 40. Near a boundary INTERSECTION a spur from this
        // wall and a spur from the perpendicular wall form an L that,
        // with the two boundary walls, encloses a pocket nothing can
        // path into -- and a zombie that wanders in never gets out.
        const lo = Math.max(ranges[r][0], segStart + 150);
        const hi = Math.min(ranges[r][1], segStart + segSpan - 150);
        if (hi - lo < 30) continue;

        // Never lay a spur across another opening's approach.
        let clear = true;
        for (let j = 0; j < all.length; j++) {
            const o = all[j];
            if (o === gap) continue;
            if (lo < o.at + o.size + mouth && hi > o.at - mouth) { clear = false; break; }
        }
        if (!clear) continue;

        for (let side = -1; side <= 1; side += 2) {
            if (vertical) {
                walls.push({ x: fixed + side * off, y: lo, w: WALL_T, h: hi - lo });
            } else {
                walls.push({ x: lo, y: fixed + side * off, w: hi - lo, h: WALL_T });
            }
        }
    }
}

function addDoorTrap(vertical, d) {
    traps.push(vertical
        ? { x: d.x - 30, y: d.y, w: WALL_T + 60, h: d.h, cost: 650, armedUntil: 0, readyAt: 0 }
        : { x: d.x, y: d.y - 30, w: d.w, h: WALL_T + 60, cost: 650, armedUntil: 0, readyAt: 0 });
}

// --- the keep --------------------------------------------------------
function buildKeep() {
    const kx = Math.round(WORLD_W / 2 - KEEP_W / 2);
    const ky = Math.round(WORLD_H / 2 - KEEP_H / 2);
    keepRect = { x: kx, y: ky, w: KEEP_W, h: KEEP_H };
    reservedRects.push(keepRect);

    const gap = 120;
    const gx = Math.round(kx + KEEP_W / 2 - gap / 2);
    const gy = Math.round(ky + KEEP_H / 2 - gap / 2);

    walls.push({ x: kx, y: ky, w: gx - kx, h: WALL_T });
    walls.push({ x: gx + gap, y: ky, w: kx + KEEP_W - (gx + gap), h: WALL_T });
    walls.push({ x: kx, y: ky + KEEP_H - WALL_T, w: gx - kx, h: WALL_T });
    walls.push({ x: gx + gap, y: ky + KEEP_H - WALL_T, w: kx + KEEP_W - (gx + gap), h: WALL_T });

    walls.push({ x: kx, y: ky, w: WALL_T, h: gy - ky });
    walls.push({ x: kx, y: gy + gap, w: WALL_T, h: ky + KEEP_H - (gy + gap) });
    walls.push({ x: kx + KEEP_W - WALL_T, y: ky, w: WALL_T, h: gy - ky });
    walls.push({ x: kx + KEEP_W - WALL_T, y: gy + gap, w: WALL_T, h: ky + KEEP_H - (gy + gap) });

    barricades.push({ x: kx, y: gy, w: WALL_T, h: gap, hp: 100, maxHp: 100, chewUntil: 0 });
    barricades.push({ x: kx + KEEP_W - WALL_T, y: gy, w: WALL_T, h: gap, hp: 100, maxHp: 100, chewUntil: 0 });

    // One crate so round 1 is playable before anything is bought. There
    // is deliberately NO weapon here now -- see placeWallBuys().
    ammoCrates.push({ x: kx + Math.round(KEEP_W / 2) - 16, y: ky + Math.round(KEEP_H / 2) - 16, size: 32, uses: 4 });

    // The field manual: a terminal in the keep explaining every weapon,
    // card, pickup and enemy. Placed at the centre of the starting area
    // because that is where a new player already is.
    codexRect = { x: kx + Math.round(KEEP_W / 2) - 30, y: ky + 54, w: 60, h: 40 };

    traps.push({ x: gx, y: ky - 8, w: gap, h: 52, cost: 500, armedUntil: 0, readyAt: 0 });
    traps.push({ x: gx, y: ky + KEEP_H - 44, w: gap, h: 52, cost: 500, armedUntil: 0, readyAt: 0 });
}

// --- per-zone contents -----------------------------------------------
function buildZoneContents() {
    for (let z = 0; z < 9; z++) {
        const info = zoneInfo[z];
        if (!info) continue;
        const tpl = info.tpl;
        const b = zoneBounds(z);

        if (tpl.corridors) buildCorridors(b);
        if (tpl.outpost) buildOutpost(b, z);
        if (tpl.generator) buildGenerator(b);

        buildZoneBuildings(b, tpl.buildings);

        for (let i = 0; i < tpl.crates; i++) {
            const spot = findOpenSpot(b, 32);
            if (spot) ammoCrates.push({ x: spot.x, y: spot.y, size: 32, uses: 3 });
        }
        for (let i = 0; i < tpl.barrels; i++) {
            const spot = findOpenSpot(b, 24);
            if (spot) barrels.push({ x: spot.x, y: spot.y, size: 24, alive: true });
        }
    }
}

// IDEA 36: long straight sightlines, so the sniper has somewhere its
// range is actually visible. Paired with cutting its range to 1200 in
// zombie-entities.js -- 1900px of reach on a 960px-wide view was an
// advantage you could never see.
function buildCorridors(b) {
    const lanes = 2 + Math.floor(MP.random() * 2);
    for (let i = 0; i < lanes; i++) {
        const y = b.y + 200 + MP.random() * (b.h - 400);
        const len = b.w * (0.5 + MP.random() * 0.3);
        const x = b.x + 120 + MP.random() * Math.max(1, b.w - 240 - len);
        walls.push({ x: Math.round(x), y: Math.round(y), w: Math.round(len), h: WALL_T });
        reservedRects.push({ x: x - 60, y: y - 90, w: len + 120, h: 180 });
    }
}

// IDEA 31: v2 gave you exactly one defensible structure on the whole map
// (the keep), so every fight collapsed into "retreat to the middle".
// Each outer zone now has a small holdable building of its own -- two
// entrances and a window, the keep's shape at a third the size.
function buildOutpost(b, z) {
    const ow = 260;
    const oh = 190;
    const ox = Math.round(b.x + 200 + MP.random() * (b.w - 400 - ow));
    const oy = Math.round(b.y + 160 + MP.random() * (b.h - 320 - oh));
    const gap = 112;              // > 2*NAV_CELL+2*NAV_PAD (70), so even brutes follow you in
    const gx = Math.round(ox + ow / 2 - gap / 2);
    const gy = Math.round(oy + oh / 2 - gap / 2);

    walls.push({ x: ox, y: oy, w: gx - ox, h: WALL_T });
    walls.push({ x: gx + gap, y: oy, w: ox + ow - (gx + gap), h: WALL_T });
    walls.push({ x: ox, y: oy + oh - WALL_T, w: gx - ox, h: WALL_T });
    walls.push({ x: gx + gap, y: oy + oh - WALL_T, w: ox + ow - (gx + gap), h: WALL_T });
    walls.push({ x: ox, y: oy, w: WALL_T, h: oh });
    walls.push({ x: ox + ow - WALL_T, y: oy, w: WALL_T, h: gy - oy });
    walls.push({ x: ox + ow - WALL_T, y: gy + gap, w: WALL_T, h: oy + oh - (gy + gap) });
    barricades.push({ x: ox + ow - WALL_T, y: gy, w: WALL_T, h: gap, hp: 80, maxHp: 80, chewUntil: 0 });

    reservedRects.push({ x: ox - 90, y: oy - 90, w: ow + 180, h: oh + 180 });
    zoneInfo[z].outpost = { x: ox, y: oy, w: ow, h: oh };
}

function buildGenerator(b) {
    const spot = findOpenSpot(b, 70) || { x: b.x + b.w / 2, y: b.y + b.h / 2 };
    generatorRect = { x: spot.x, y: spot.y, w: 70, h: 70, cost: 2500 };
    reservedRects.push({ x: spot.x - 140, y: spot.y - 140, w: 350, h: 350 });
}

// IDEA 32: every nook gets a small opening in the middle of the wall
// opposite its missing side. Flow-field zombies funnel relentlessly, and
// a sealed three-walled nook had become a place to be cornered and
// killed with no way out.
// Must exceed the nav grid's guaranteed-navigable width (2*NAV_CELL+16
// = 56), or zombies cannot path through the escape hole and the nook is
// a dead end again in everything but appearance.
const NOOK_HOLE = 74;

function buildZoneBuildings(b, count) {
    let made = 0;
    let attempts = 0;
    while (made < count && attempts < count * 40) {
        attempts++;
        const bw = 120 + MP.random() * 170;
        const bh = 120 + MP.random() * 170;
        const bx = b.x + 110 + MP.random() * Math.max(1, b.w - 220 - bw);
        const by = b.y + 110 + MP.random() * Math.max(1, b.h - 220 - bh);

        if (nearZoneBoundary(bx, by, bw, bh)) continue;
        const box = { x: bx - 95, y: by - 95, w: bw + 190, h: bh + 190 };
        let clash = false;
        for (let j = 0; j < reservedRects.length; j++) {
            if (rectsOverlap(box, reservedRects[j])) { clash = true; break; }
        }
        if (clash) continue;

        const top = { x: bx, y: by, w: bw, h: WALL_T };
        const bottom = { x: bx, y: by + bh - WALL_T, w: bw, h: WALL_T };
        const left = { x: bx, y: by, w: WALL_T, h: bh };
        const right = { x: bx + bw - WALL_T, y: by, w: WALL_T, h: bh };
        const sides = [top, bottom, left, right];

        if (MP.random() < 0.62) {
            const missing = Math.floor(MP.random() * 4);
            sides.splice(missing, 1);
            // The wall facing the missing one gets the escape hole.
            const opposite = missing === 0 ? 0 : missing === 1 ? 0 : missing === 2 ? 1 : 1;
            pierceWall(sides, opposite);
        } else if (MP.random() < 0.5) {
            sides.splice(0, 2);
        } else {
            sides.splice(2, 2);
        }

        for (let k = 0; k < sides.length; k++) if (sides[k]) walls.push(sides[k]);
        reservedRects.push({ x: bx, y: by, w: bw, h: bh });
        made++;
    }
}

// Splits one wall in a list into two segments with a gap in the middle,
// replacing it in place.
function pierceWall(sides, index) {
    const w = sides[index];
    if (!w) return;
    if (w.w >= w.h) {
        const half = (w.w - NOOK_HOLE) / 2;
        if (half < 12) return;
        sides[index] = { x: w.x, y: w.y, w: half, h: w.h };
        sides.push({ x: w.x + half + NOOK_HOLE, y: w.y, w: half, h: w.h });
    } else {
        const half = (w.h - NOOK_HOLE) / 2;
        if (half < 12) return;
        sides[index] = { x: w.x, y: w.y, w: w.w, h: half };
        sides.push({ x: w.x, y: w.y + half + NOOK_HOLE, w: w.w, h: half });
    }
}

function nearZoneBoundary(x, y, w, h) {
    const margin = 150;
    for (let v = 1; v < ZONE_COLS; v++) {
        const X = v * ZONE_W;
        if (x - margin < X && x + w + margin > X) return true;
    }
    for (let r = 1; r < ZONE_ROWS; r++) {
        const Y = r * ZONE_H;
        if (y - margin < Y && y + h + margin > Y) return true;
    }
    return false;
}

function findOpenSpot(b, size) {
    for (let tries = 0; tries < 60; tries++) {
        const x = Math.round(b.x + 120 + MP.random() * (b.w - 240 - size));
        const y = Math.round(b.y + 120 + MP.random() * (b.h - 240 - size));
        if (blockedAtStatic(x - 20, y - 20, size + 40)) continue;
        return { x: x, y: y };
    }
    return null;
}

// --- the three weapons on the map ------------------------------------
// Exactly one shotgun, one sniper and one SMG for the WHOLE map, each in
// a different zone. v2 had nine wall-buys, which made every zone
// interchangeable and every weapon a formality. The sniper is placed in
// a long-sightline zone when the seed produced one.
function placeWallBuys() {
    const outer = [];
    for (let i = 0; i < 9; i++) if (i !== 4 && zoneInfo[i]) outer.push(i);

    const sightZones = outer.filter(function (z) { return zoneInfo[z].tpl.corridors; });
    const order = seededShuffle(outer);
    const used = {};

    const sniperZone = sightZones.length ? sightZones[Math.floor(MP.random() * sightZones.length)] : order[0];
    used[sniperZone] = true;
    addWallBuy(sniperZone, "sniper", 4200);

    // !== undefined, NOT truthiness: zone 0 is a perfectly good zone and
    // a falsy check silently dropped a weapon from the map whenever it
    // came up first (7 seeds in 40).
    const rest = order.filter(function (z) { return !used[z]; });
    if (rest[0] !== undefined) { addWallBuy(rest[0], "shotgun", 2600); used[rest[0]] = true; }
    if (rest[1] !== undefined) { addWallBuy(rest[1], "smg", 3400); used[rest[1]] = true; }
    // The rifle is back: cheapest of the four, the natural first upgrade
    // off the pistol.
    if (rest[2] !== undefined) { addWallBuy(rest[2], "rifle", 1500); used[rest[2]] = true; }
}

function addWallBuy(zone, weapon, cost) {
    const b = zoneBounds(zone);
    const spot = findOpenSpot(b, 110) || { x: b.x + 200, y: b.y + 200 };
    wallBuys.push({ x: spot.x, y: spot.y, w: 110, h: 28, weapon: weapon, cost: cost, zone: zone });
    reservedRects.push({ x: spot.x - 70, y: spot.y - 70, w: 250, h: 170 });
}

// --- card stations ---------------------------------------------------
// Deliberately separate from weapon wall-buys: expensive, and inert until
// the generator is running.
function placeCardStations() {
    const outer = [];
    for (let i = 0; i < 9; i++) if (i !== 4 && zoneInfo[i]) outer.push(i);
    const order = seededShuffle(outer);
    const cards = seededShuffle(CARD_KEYS);

    const n = Math.min(4, order.length, cards.length);
    for (let i = 0; i < n; i++) {
        const b = zoneBounds(order[i]);
        const spot = findOpenSpot(b, 60);
        if (!spot) continue;
        cardStations.push({
            x: spot.x, y: spot.y, w: 60, h: 44,
            card: cards[i],
            cost: 9000 + i * 1500,
            zone: order[i]
        });
        reservedRects.push({ x: spot.x - 70, y: spot.y - 70, w: 200, h: 184 });
    }
}

// IDEA 30: a share of barrels seeded at the boundary openings and
// outpost mouths, where a shot into one actually swings a defence. v2
// scattered them uniformly, so most exploded where nobody was fighting.
function placeChokepointBarrels() {
    const spots = [];
    for (let i = 0; i < doors.length; i++) spots.push(doors[i]);
    for (let i = 0; i < barricades.length; i++) spots.push(barricades[i]);

    const picked = seededShuffle(spots).slice(0, Math.min(14, spots.length));
    for (let i = 0; i < picked.length; i++) {
        const s = picked[i];
        for (let tries = 0; tries < 20; tries++) {
            const a = MP.random() * Math.PI * 2;
            const r = 70 + MP.random() * 90;
            const x = Math.round(clamp(s.x + s.w / 2 + Math.cos(a) * r, 60, WORLD_W - 90));
            const y = Math.round(clamp(s.y + s.h / 2 + Math.sin(a) * r, 60, WORLD_H - 90));
            if (blockedAtStatic(x - 6, y - 6, 36)) continue;
            barrels.push({ x: x, y: y, size: 24, alive: true });
            break;
        }
    }
}

// --- THE SLUICE -----------------------------------------------------
// Fixed world coordinates, not seeded: this is the one landmark every
// run shares, and "meet at the sluice" has to mean the same place every
// time. South-centre, so it sits on the way to the escape.
const SLUICE_W = 460;
const SLUICE_H = 320;

function buildSluice() {
    const sx = Math.round(WORLD_W / 2 - SLUICE_W / 2);
    const sy = Math.round(WORLD_H - SLUICE_H - 210);
    sluiceRoom = { x: sx, y: sy, w: SLUICE_W, h: SLUICE_H };

    const gap = 120;
    const gx = Math.round(sx + SLUICE_W / 2 - gap / 2);

    // Sealed box with exactly one way in, and that way is the gate.
    walls.push({ x: sx, y: sy, w: gx - sx, h: WALL_T });
    walls.push({ x: gx + gap, y: sy, w: sx + SLUICE_W - (gx + gap), h: WALL_T });
    walls.push({ x: sx, y: sy + SLUICE_H - WALL_T, w: SLUICE_W, h: WALL_T });
    walls.push({ x: sx, y: sy, w: WALL_T, h: SLUICE_H });
    walls.push({ x: sx + SLUICE_W - WALL_T, y: sy, w: WALL_T, h: SLUICE_H });

    sluiceGate = { x: gx, y: sy, w: gap, h: WALL_T, open: false, sluice: true };
    doors.push(sluiceGate);

    // Two plates, 300px apart. One player cannot cover both -- that is
    // the entire point (idea 57).
    const py = sy - 150;
    gatePlates = [
        { x: gx - 190, y: py, w: 64, h: 64 },
        { x: gx + gap + 126, y: py, w: 64, h: 64 }
    ];

    // Funnel 1 fills most of the room's floor.
    funnels[0] = { x: sx + SLUICE_W / 2, y: sy + SLUICE_H / 2 + 20, r: 118, zone: zoneOf(sx, sy) };

    reservedRects.push({ x: sx - 220, y: sy - 240, w: SLUICE_W + 440, h: SLUICE_H + 460 });

    // The way out, dead south of the sluice.
    escapeRect = { x: Math.round(WORLD_W / 2 - 90), y: WORLD_H - 74, w: 180, h: 66 };
    reservedRects.push({ x: escapeRect.x - 160, y: escapeRect.y - 160, w: escapeRect.w + 320, h: escapeRect.h + 220 });
}

// Funnels 2 and 3 are floor funnels out in the map; the three silos sit
// elsewhere again, so filling one and then throwing its switch is a
// journey rather than a button next to you.
function placeFunnelsAndSilos() {
    const outer = [];
    for (let i = 0; i < 9; i++) if (i !== 4 && zoneInfo[i]) outer.push(i);
    const order = seededShuffle(outer);

    for (let k = 1; k <= 2; k++) {
        const z = order[k - 1];
        const b = zoneBounds(z);
        const spot = findOpenSpot(b, 150) || { x: b.x + 300, y: b.y + 300 };
        funnels[k] = { x: spot.x + 75, y: spot.y + 75, r: 105, zone: z };
        reservedRects.push({ x: spot.x - 120, y: spot.y - 120, w: 390, h: 390 });
    }

    for (let i = 0; i < 3; i++) {
        const z = order[(i + 3) % order.length];
        const b = zoneBounds(z);
        const spot = findOpenSpot(b, 70) || { x: b.x + 500, y: b.y + 400 };
        silos[i] = { x: spot.x, y: spot.y, w: 64, h: 78, zone: z };
        reservedRects.push({ x: spot.x - 110, y: spot.y - 110, w: 284, h: 298 });
    }
}

// Placement happens before the grids are built, so this tests directly.
function blockedAtStatic(x, y, size) {
    for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (rectIntersect(x, y, size, size, w.x, w.y, w.w, w.h)) return true;
    }
    for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        if (rectIntersect(x, y, size, size, d.x, d.y, d.w, d.h)) return true;
    }
    for (let i = 0; i < barricades.length; i++) {
        const b = barricades[i];
        if (rectIntersect(x, y, size, size, b.x, b.y, b.w, b.h)) return true;
    }
    return false;
}
