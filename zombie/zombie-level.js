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
// Floor that must stay clear of PLACED ITEMS -- crates, barrels, wall-buys,
// perk stations. reservedRects keeps buildings away; this keeps a crate from
// landing on a funnel or a gate plate, which findOpenSpot (walls only) could
// not see. The sluice approach and every funnel hall live here.
let keepClearRects = [];
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
// ---------------------------------------------------
//   SECTORS ARE PAINTED, NOT DIVIDED  (2026-09-19)
// ---------------------------------------------------
// The map used to be a 3x3 grid of identical 1600x900 rectangles. Nine
// boxes of the same shape with a template shuffled into each is exactly
// why nowhere was worth remembering -- you cannot learn a place whose
// shape, position AND contents are all re-rolled. Plan:
// `zombie/MAP_REVAMP_PLAN.md`.
//
// So the nine sectors are now PAINTED into a coarse 12x9 grid of 400x300
// cells. That buys arbitrary rectilinear outlines -- crosses, brackets,
// tongues, stepped ribbons -- while `zoneOf()` stays one array read, which
// matters because it runs per zombie per frame.
//
// The skeleton is FIXED and the interiors stay seeded: shape, position,
// name, landmark and which gun lives where never change, and the
// buildings, cover, crates and door positions inside them still come out
// of MP.random(). Every client still builds from one seed.
//
// READ THE PAINT AS A MAP. Each letter is one 400x300 cell:
//
//        SPL SPL CLD CLD CLD CLD KEN KEN KEN YRD YRD YRD
//        SPL SPL SPL CLD CLD CLD KEN KEN KEN YRD YRD YRD
//        SPL SPL SPL CLD CLD BLK BLK KEN KEN YRD YRD YRD
//        SPL SPL TRB TRB TRB BLK BLK BLK BLK YRD YRD YRD
//        SPL SPL TRB BLK BLK BLK BLK BLK BLK PMP PMP YRD
//        SPL SPL TRB TRB TRB BLK BLK PMP PMP PMP YRD YRD
//        SPL SPL SPL SPL SLU SLU SLU MTR MTR MTR YRD YRD
//        SLU SLU SLU SLU SLU SLU SLU MTR MTR YRD YRD MTR
//        SLU SLU SLU SLU SLU SLU SLU MTR MTR MTR MTR MTR
//
// THE YARD owns (col 9, row 2) so that cols 9-11 x rows 0-3 is an unbroken
// 1200x1200 block -- that rectangle is the container maze's ground, and
// without it the maze was five boxes scattered over an hourglass. It costs
// THE KENNELS one cell (9 -> 8) and leaves it an L rather than an S-step.
//
// Two interlocks are deliberate and should survive any edit:
//   - TURBINE HALL is a bracket WRAPPED AROUND the Blockhouse's west arm,
//     so the generator hall hugs the keep and a Blackout restart is a
//     defend-one-mouth fight.
//   - THE YARD pushes a tongue west between the Motor Pool's bays at row 7.
//     That tongue is the RAIL SPUR, and it is the clearest "this is not a
//     grid" signal on the minimap.
//
// Checked before it was written down (and re-checked by the harness):
// all nine contiguous, all border >= 3 others, all reachable from the
// centre, 108 of 108 cells claimed, and the keep, the sluice, both gate
// plates and the escape all land in the sector that owns them.
const ZONE_COUNT = 9;
// 24 x 18 since 2026-09-20 (MAP_DESIGN_GUIDE P1). It was 12 x 9, and that
// was the binding constraint on sector SHAPE, not taste or effort: an H needs
// a bounding box of at least 5 x 5 -- two spines, a gap, a crossbar -- and at
// 108 cells over nine sectors the average sector was twelve cells against the
// twenty-five a 5x5 needs. Measured: NINE of nine bounding boxes failed, the
// largest pairs being 4x7 and 3x8. No painter could have drawn an H here.
//
// The refinement is close to free, which is the part worth knowing.
// zoneBoundaryRuns() merges collinear cells, so shape complexity -- not cell
// count -- is what costs a run: a 2x upsample of the OLD shapes measures
// exactly 39 runs, identical to the old grid, and the shapes actually shipped
// below cost 41. Two runs bought every silhouette on the map.
const ZONE_COLS_FINE = 24;
const ZONE_ROWS_FINE = 18;
const ZONE_CELL_W = WORLD_W / ZONE_COLS_FINE;   // 200
const ZONE_CELL_H = WORLD_H / ZONE_ROWS_FINE;   // 150

// Sector ids. 4 stays the centre and 7 stays the sluice's, because plenty
// of code already reads `i !== 4` and `SLUICE_ZONE`.
const Z_SPILLWAY = 0, Z_COLD = 1, Z_KENNELS = 2, Z_YARD = 3, Z_BLOCKHOUSE = 4,
      Z_TURBINE = 5, Z_PUMP = 6, Z_SLUICE = 7, Z_MOTOR = 8;

const ZONE_PAINT = [
    0,0,0,0,0,0,1,1,1,1,1,1,1,1,2,2,2,2,3,3,3,3,3,3,
    0,0,0,0,0,0,1,1,1,1,1,1,1,1,2,2,2,2,3,3,3,3,3,3,
    0,0,0,0,0,0,1,1,1,1,1,1,1,1,2,2,2,2,3,3,3,3,3,3,
    0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,2,2,3,3,3,3,3,3,
    0,0,0,0,0,0,1,1,1,1,1,1,1,1,2,2,2,2,2,2,3,3,3,3,
    0,0,0,0,0,0,1,1,1,1,1,1,1,1,2,2,2,2,2,2,3,3,3,3,
    0,0,0,0,5,5,5,5,5,5,4,4,4,4,4,4,2,2,3,3,3,3,3,3,
    0,0,0,0,5,5,5,5,4,4,4,4,4,4,4,4,2,2,3,3,3,3,3,3,
    0,0,0,0,5,5,5,5,4,4,4,4,4,4,4,4,6,6,6,6,3,3,3,3,
    0,0,0,0,5,5,5,5,4,4,4,4,4,4,4,4,6,6,6,6,6,6,3,3,
    0,0,0,0,5,5,5,5,5,5,4,4,4,4,4,4,6,6,6,6,6,6,3,3,
    0,0,0,0,0,0,5,5,5,5,5,5,4,4,4,4,6,6,6,6,6,6,3,3,
    0,0,0,0,0,0,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,3,3,
    0,0,0,0,0,0,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,3,3,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8,
    7,7,7,7,7,7,7,7,7,7,7,7,7,7,8,8,8,8,8,8,8,8,8,8
];

// Bounding box + cell list per sector, built once at load. `cells` is what
// makes an irregular sector safe to place things in: the bbox of a cross
// is 58% air that belongs to somebody else.
const zoneCellList = [];
const zoneBoxes = [];
(function buildZoneTables() {
    for (let i = 0; i < ZONE_COUNT; i++) {
        zoneCellList.push([]);
        zoneBoxes.push({ x: WORLD_W, y: WORLD_H, x2: 0, y2: 0 });
    }
    for (let r = 0; r < ZONE_ROWS_FINE; r++) {
        for (let c = 0; c < ZONE_COLS_FINE; c++) {
            const z = ZONE_PAINT[r * ZONE_COLS_FINE + c];
            zoneCellList[z].push(c, r);
            const b = zoneBoxes[z];
            b.x = Math.min(b.x, c * ZONE_CELL_W);
            b.y = Math.min(b.y, r * ZONE_CELL_H);
            b.x2 = Math.max(b.x2, (c + 1) * ZONE_CELL_W);
            b.y2 = Math.max(b.y2, (r + 1) * ZONE_CELL_H);
        }
    }
    for (let i = 0; i < ZONE_COUNT; i++) {
        const b = zoneBoxes[i];
        b.w = b.x2 - b.x;
        b.h = b.y2 - b.y;
    }
})();

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
// Which sector to head into next, on the shortest hop path. This used to be
// grid arithmetic on a 3x3 -- "step along whichever axis has further to go"
// -- which is meaningless once sectors are crosses and brackets and the
// centre borders five of them. It is a precomputed next-hop table now,
// built by zoneNavRebuild() from the passages that actually exist.
//
// 9x9 entries, rebuilt once per level. A zombie reads one array slot.
let zoneNextHop = null;

function zoneNavRebuild() {
    const nb = [];
    for (let i = 0; i < ZONE_COUNT; i++) nb.push([]);
    for (const k in zonePassages) {
        if (!Object.prototype.hasOwnProperty.call(zonePassages, k)) continue;
        const parts = k.split(">");
        const a = +parts[0], b = +parts[1];
        nb[a].push(b);
        nb[b].push(a);
    }
    zoneNextHop = new Int8Array(ZONE_COUNT * ZONE_COUNT).fill(-1);
    // BFS out from every destination; the first hop back is the next hop.
    for (let dest = 0; dest < ZONE_COUNT; dest++) {
        const prev = new Int8Array(ZONE_COUNT).fill(-1);
        const seen = new Uint8Array(ZONE_COUNT);
        seen[dest] = 1;
        let q = [dest];
        while (q.length) {
            const nx = [];
            for (let i = 0; i < q.length; i++) {
                const z = q[i];
                for (let j = 0; j < nb[z].length; j++) {
                    const n = nb[z][j];
                    if (seen[n]) continue;
                    seen[n] = 1;
                    prev[n] = z;                 // one step closer to dest
                    nx.push(n);
                }
            }
            q = nx;
        }
        for (let from = 0; from < ZONE_COUNT; from++) {
            zoneNextHop[from * ZONE_COUNT + dest] = (from === dest) ? from : prev[from];
        }
    }
}

function zoneStepToward(fromZone, toZone) {
    if (!zoneNextHop || fromZone === toZone) return -1;
    const n = zoneNextHop[fromZone * ZONE_COUNT + toZone];
    return (n === undefined || n < 0) ? -1 : n;
}

// Sector centroid, for aiming through a gate toward the far side.
function zoneCentre(i) {
    const cl = zoneCellList[i];
    if (!cl || !cl.length) return { x: WORLD_W / 2, y: WORLD_H / 2 };
    let sx = 0, sy = 0;
    for (let k = 0; k < cl.length; k += 2) {
        sx += (cl[k] + 0.5) * ZONE_CELL_W;
        sy += (cl[k + 1] + 0.5) * ZONE_CELL_H;
    }
    const n = cl.length / 2;
    return { x: sx / n, y: sy / n };
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
    const nc = zoneCentre(next);
    const ncx = nc.x, ncy = nc.y;
    const through = 80;

    if (gate.w < gate.h) return { x: gx + Math.sign(ncx - gx) * through, y: gy };
    return { x: gx, y: gy + Math.sign(ncy - gy) * through };
}

// One array read. Cheap enough to call per zombie per frame, which is
// exactly what it is used for.
function zoneOf(x, y) {
    const c = clamp(Math.floor(x / ZONE_CELL_W), 0, ZONE_COLS_FINE - 1);
    const r = clamp(Math.floor(y / ZONE_CELL_H), 0, ZONE_ROWS_FINE - 1);
    return ZONE_PAINT[r * ZONE_COLS_FINE + c];
}

// THE TEST EVERY PLACEMENT NEEDS. A sector's bounding box is not the
// sector: the Blockhouse is a cross and its bbox is 58% ground belonging
// to somebody else. Anything that picks a point inside zoneBounds() must
// then check it is actually in the sector, or an irregular sector quietly
// drops its crates, stations and wall-buys into its neighbours.
function inZone(x, y, zone) {
    return zoneOf(x, y) === zone;
}

// Does a rect touch any cell of this sector? Used by markHotZones, which
// used to test the bbox and would now mark a cross's whole 2400x1200 box.
function rectTouchesZone(r, zone) {
    const c0 = clamp(Math.floor(r.x / ZONE_CELL_W), 0, ZONE_COLS_FINE - 1);
    const c1 = clamp(Math.floor((r.x + r.w) / ZONE_CELL_W), 0, ZONE_COLS_FINE - 1);
    const r0 = clamp(Math.floor(r.y / ZONE_CELL_H), 0, ZONE_ROWS_FINE - 1);
    const r1 = clamp(Math.floor((r.y + r.h) / ZONE_CELL_H), 0, ZONE_ROWS_FINE - 1);
    for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
            if (ZONE_PAINT[rr * ZONE_COLS_FINE + cc] === zone) return true;
        }
    }
    return false;
}

// Graph distance from the Blockhouse, over DOOR edges only. This replaces
// zoneRing(), which was "how far from the middle of a 3x3" and means
// nothing once the centre borders five sectors and the shapes interlock.
// Filled by buildZoneWalls() once it knows where the doors went.
let zoneDepth = [];

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
//
// 19, not 15 (2026-09-18): the ULTRA HEAVY is 34px, so half of it plus the
// same two pixels of skin. Same rule as before -- pad for the LARGEST body
// -- because the field is shared by every zombie and the failure mode of
// under-padding is exactly the brute wedging fixed on 2026-09-07. The
// guarantee moves 70px -> 78px. Checked against every opening: windows
// 112-151, doors 124-159, outpost doorways 112, keep and sluice 120, funnel
// halls 240 -- and the nook hole, which was 74 and is now 90 for this.
const NAV_PAD = 19;

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

// ---------------------------------------------------
//   SHOOTING THROUGH PLANKS THAT ARE ALREADY GONE
// ---------------------------------------------------
// 2026-09-19, on request: you should be able to shoot a zombie THROUGH the
// gap it is chewing, while the window is still standing. Before this a
// barricade was total cover until hp hit 0 and it left the zombie solid set
// entirely -- so the only way to shoot through a window was to lose it.
//
// The renderer already tells this exact story: N plank slots, filled from
// the low end of the span upward, `shown` of them left. So the missing
// planks are ALWAYS the slots at the far end -- and the hole a player
// can see is the hole a bullet can use. These two helpers are the single
// source of that geometry; drawBarricades() calls the first one so the
// picture and the collision can never drift apart.
// THE COUNT FOLLOWS THE OPENING (2026-09-24). It was a flat 4, and a flat
// count makes the PLANK scale with the hole: a 44px building window got
// 11px boards and a 150px rail gate got 37px ones, from the same art, on
// the same screen. A plank is a plank. So the pitch is fixed instead and
// the count is derived, which keeps every barricade on the map reading at
// one board size.
//
// 32 is the standard boundary window's own pitch -- those run 112-151px and
// were drawn with 4 boards -- so THE COMMON CASE IS UNCHANGED, and only the
// odd sizes (building windows, the cut fragments a rail gate leaves) move.
//
// The floor of 2 is deliberate: at one board the barricade has no damage
// granularity at all, it is either whole or gone.
const BARRICADE_PLANK_PITCH = 32;
const BARRICADE_PLANKS_MIN = 2;
const BARRICADE_PLANKS_MAX = 6;

function barricadePlanks(b) {
    const span = (b.w < b.h ? b.h : b.w);
    const n = Math.round(span / BARRICADE_PLANK_PITCH);
    return Math.max(BARRICADE_PLANKS_MIN, Math.min(BARRICADE_PLANKS_MAX, n));
}

function barricadePlanksShown(b) {
    if (!b || b.hp <= 0) return 0;
    const frac = Math.min(1, b.hp / b.maxHp);
    return Math.max(1, Math.ceil(barricadePlanks(b) * frac));
}

// True when the box lies WHOLLY past the last remaining plank. Wholly, not
// merely overlapping: a round clipping the last board is stopped by it. At a
// 112px window a slot is 28px against a bullet of 8-14, which is the
// difference between a clean shot through the gap and a lucky one.
function inBarricadeGap(b, x, y, size) {
    const planks = barricadePlanks(b);
    const shown = barricadePlanksShown(b);
    if (shown >= planks) return false;                 // still fully boarded
    const vertical = b.w < b.h;
    const span = vertical ? b.h : b.w;
    const gapStart = (vertical ? b.y : b.x) + shown * (span / planks);
    return (vertical ? y : x) >= gapStart;
}

// What a BULLET collides with. The zombie solid set, minus the part of a
// damaged barricade whose boards have already been torn off.
//
// Deliberately separate from blockedAt(): player collision, zombie
// collision and both nav grids are untouched by this: a gap you can shoot
// through is not a gap anyone can walk through, and the two solid grids that
// make segmentation safe keep meaning exactly what they meant before.
function bulletBlockedAt(x, y, size) {
    const near = solidsNear(x, y, size, size, true);
    for (let i = 0; i < near.length; i++) {
        const r = near[i];
        if (!rectIntersect(x, y, size, size, r.x, r.y, r.w, r.h)) continue;
        // `maxHp` is what marks a rect as a barricade -- walls and doors
        // have no such field.
        if (r.maxHp && inBarricadeGap(r, x, y, size)) continue;
        return true;
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
// (The "+16" above was half a walker. The pad is sized for the largest
// zombie now -- see NAV_PAD -- so the live threshold is 2*20 + 2*19 = 78.)
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
// Each zone got a layout character and a name you could call out.
//
// SUPERSEDED 2026-09-19. ZONE_TEMPLATES (11 templates shuffled into 8
// outer slots, plus TURBINE_TEMPLATE and CENTRE_TEMPLATE) is gone, and
// with it THE DRY POOL, THE LAUNDRY, DEAD LETTER, SLAG HEAP, TICKET HALL
// and THE ANNEX. The templates were the right idea solving half the
// problem: a zone had a character but not a PLACE, because both the shape
// and the position were re-rolled underneath it. `SECTORS` above replaces
// them with nine fixed sectors that own their shape, position, name,
// landmark and stock. The cut names are kept here on purpose -- they are
// a good list to draw on if the map ever grows past nine.

let zoneInfo = [];        // 9 entries, index = zone number
let generatorRect = null; // {x,y,w,h,cost}
let codexRect = null;     // the field manual terminal, in the keep
let intensifyRect = null; // the horde switch, in the keep (2026-09-19)
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

// The sluice sits at fixed coordinates in the bottom-centre zone. Named so
// the rules that avoid it (turbine placement, funnel halls) say why.
const SLUICE_ZONE = 7;

// ---------------------------------------------------
//   THE NINE SECTORS  (fixed, 2026-09-19)
// ---------------------------------------------------
// The identity of a sector no longer moves. THE KENNELS is always the
// S-step in the north-centre, it always sells the shotgun, and the crane
// is always in the north-east -- which is the entire point: "meet me at
// the crane" has to mean somewhere.
//
// Only the INTERIOR is still seeded (buildings, cover, crates, barrels,
// where inside the sector its structures sit, and every door and window
// position along a shared wall), so MP.random() still does real work and
// no two runs lay out the same.
//
// `guns` and `perks` are per-sector BUDGETS, not one-each: the Yard is
// worth the trip and the Motor Pool is the perk sector. Totals are still
// 6 guns and 8 stations, so no balance number moves -- only where they
// sit. See MAP_REVAMP_PLAN.md 5.
//
// `bpc` is BUILDINGS PER CELL, not a flat count (2026-09-20, MAP_DESIGN_GUIDE
// P10). The comment here used to describe a `density` field that scaled
// buildings by sector size -- and no such field ever existed; buildZoneContents
// read a flat `buildings` count. So the same number landed in a 5-cell sector
// and an 18-cell one, and density ranged over 7.6x without anyone choosing it.
//
// Measured on the old grid: COLD STORAGE ran 1.22 buildings a cell and was a
// deliberate warren; THE SPILLWAY ran 0.17 over eighteen cells and was simply
// the emptiest ground in the game. Those two stay far apart on purpose -- what
// changes is that the spread is now stated rather than accidental, and the
// Spillway roughly doubles.
//
// THE YARD and THE KENNELS stay low deliberately: their real buildings are the
// container stacks and the rolling stock, which are placed separately, and
// raising this would crowd them out. That was measured once already at 1.5
// containers placed of 14 attempted.
const SECTORS = [
    { id: Z_SPILLWAY,   key: "spill",   name: "THE SPILLWAY",   guns: ["sniper"],           perks: 1,
      bpc: 0.090, barrels: 4,  crates: 2, outpost: false, corridors: true  },
    { id: Z_COLD,       key: "cold",    name: "COLD STORAGE",   guns: ["rifle"],            perks: 1,
      bpc: 0.275, barrels: 3,  crates: 2, outpost: false, corridors: false },
    { id: Z_KENNELS,    key: "kennel",  name: "THE KENNELS",    guns: ["shotgun"],          perks: 1,
      bpc: 0.095, barrels: 2,  crates: 2, outpost: false, corridors: false },
    // Low bpc on purpose: the CONTAINER STACKS are this sector's buildings
    // (buildContainerMaze), and at a higher figure there was no room left for
    // them -- measured at 1.5 containers placed of 14 attempted, which is not
    // a container yard.
    //
    // THE SMG MOVED OUT to THE SLUICE YARD on 2026-09-20 (P4). One ring-1 door
    // used to buy the rocket, the SMG, two perks, the crane, the maze and an
    // outpost; east/west guns ran 3:1 over identical ground. The rocket is
    // still here and the Yard is ring 2 now, so it is still the sector worth
    // the trip -- it is just no longer the whole game.
    { id: Z_YARD,       key: "yard",    name: "THE YARD",       guns: ["rocket"],           perks: 2,
      bpc: 0.050, barrels: 6,  crates: 3, outpost: true,  corridors: false },
    { id: Z_BLOCKHOUSE, key: "centre",  name: "THE BLOCKHOUSE", guns: [],                   perks: 0,
      bpc: 0.075, barrels: 2,  crates: 0, outpost: false, corridors: false },
    { id: Z_TURBINE,    key: "turbine", name: "TURBINE HALL",   guns: [],                   perks: 1,
      bpc: 0.100, barrels: 3,  crates: 1, outpost: true,  corridors: false, generator: true },
    // A perk at last (P5). It was the only sector selling a gun and carrying
    // no station, which made it a shop with a door charge rather than a place.
    { id: Z_PUMP,       key: "pump",    name: "PUMP HOUSE",     guns: ["flamer"],           perks: 1,
      bpc: 0.180, barrels: 2,  crates: 1, outpost: false, corridors: false },
    // 15.7% of the map with no gun and no perk until 2026-09-20: ground you
    // crossed all game for sixty seconds of endgame. It sells the SMG now, so
    // the escape ground is somewhere you have already learned to fight in
    // before it matters.
    { id: Z_SLUICE,     key: "sluice",  name: "THE SLUICE YARD",guns: ["smg"],              perks: 0,
      bpc: 0.100, barrels: 4,  crates: 2, outpost: false, corridors: false },
    { id: Z_MOTOR,      key: "motor",   name: "THE MOTOR POOL", guns: [],                   perks: 2,
      bpc: 0.125, barrels: 12, crates: 2, outpost: true,  corridors: true  }
];

// Buildings for a sector, from its per-cell rate and its actual area. Floor,
// not round, would give the Yard 3 and the Spillway 7 either way; Math.round
// is used so a rate change reads as intended rather than being eaten.
function sectorBuildingCount(tpl) {
    return Math.max(1, Math.round(zoneCellCount(tpl.id) * (tpl.bpc || 0.08)));
}


// OVERDRIVE is still guaranteed and now has a fixed home: TURBINE HALL,
// the sector that is always placed and thematically the power.
const PERK_SECTOR_HOMES = {
    turbine: ["overdrive"],
    motor:   ["salvage", "scavenger", "conductor"],
    yard:    ["skewer", "blastcap", "arc"],
    cold:    ["ricochet", "laststand"],
    kennel:  ["spite", "skewer"],
    spill:   ["decoy", "arc", "ricochet"],
    // Added with the Pump House's first station (2026-09-20). Fire and blast,
    // beside the flamethrower it sells -- the perk should say what the sector
    // is for.
    pump:    ["blastcap", "spite"]
};

function assignZones() {
    zoneInfo = new Array(ZONE_COUNT);
    for (let i = 0; i < SECTORS.length; i++) {
        const t = SECTORS[i];
        zoneInfo[t.id] = { name: t.name, tpl: t };
    }
}

// The sector's BOUNDING BOX. For an irregular sector this is a superset of
// its ground -- always pair it with inZone() when placing anything.
function zoneBounds(i) {
    const b = zoneBoxes[i] || zoneBoxes[0];
    return { x: b.x, y: b.y, w: b.w, h: b.h };
}

// Area in cells, so callers can tell a 5-cell pocket from an 18-cell sector
// (how many crates, barrels and buildings it should carry).
function zoneCellCount(i) {
    return zoneCellList[i] ? zoneCellList[i].length / 2 : 0;
}

// A point somewhere inside the sector proper, picked from its OWN cells --
// the reliable way to get a start point in a cross or a bracket.
function randomPointInZone(i, pad) {
    const cl = zoneCellList[i];
    if (!cl || !cl.length) return { x: WORLD_W / 2, y: WORLD_H / 2 };
    const k = Math.floor(MP.random() * (cl.length / 2)) * 2;
    const m = pad || 40;
    return {
        x: cl[k] * ZONE_CELL_W + m + MP.random() * Math.max(1, ZONE_CELL_W - m * 2),
        y: cl[k + 1] * ZONE_CELL_H + m + MP.random() * Math.max(1, ZONE_CELL_H - m * 2)
    };
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
    keepClearRects = [];
    zonePassages = {};
    generatorRect = null;
    codexRect = null;
    intensifyRect = null;
    if (typeof zfClearPatches === "function") zfClearPatches();
    generatorOn = false;
    genTripped = false;
    genRestart = 0;

    zoneHotUntil = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    forestRects = [];
    culverts = [];
    escapeOpening = null;
    landmarks = [];
    spillwayRuns = null;
    kennelRun = null;
    railcars = [];
    railPaths = [];
    buildingRooms = [];
    yardSpur = null;
    yardContainers = [];

    resetEndgame();
    funnels = [];
    silos = [];
    funnelHalls = [];
    siloPipes = [];

    assignZones();
    buildZoneWalls();
    // The next-hop table the horde navigates the sectors by. It reads the
    // passages buildZoneWalls() just created, so it cannot run before it.
    zoneNavRebuild();
    buildKeep();
    // THE SLUICE GOES BEFORE THE ZONE CONTENTS (2026-09-18). It used to be
    // built after them, so nothing in its zone knew it was coming: across
    // 300 seeds, 239 had zone walls INSIDE the funnel room and 68 had a
    // gate plate walled off -- a map on which the two-player gate, and so
    // the whole endgame, could not be finished. Building it first puts its
    // reserve in place before anything else asks where it may stand.
    buildSluice();
    planFunnelHalls();
    buildPlannedHalls();
    // Hero structures get first pick of what is left, because a landmark
    // nobody can find is not a landmark: placed after the buildings, the
    // crane failed to fit on 25 maps in 40.
    placeLandmarks();
    // The maze is what THE YARD IS, so it places with the hero structures
    // rather than after the generic buildings -- at the back of the queue
    // only 0.5 containers of ~20 ever went down, which is not a maze.
    //
    // THE KENNELS goes here for exactly the same reason (2026-09-20): its
    // rail cars and containers ARE the sector, and behind the buildings
    // only 0.2 cars a map were getting down. buildKennels appends to
    // yardContainers, so it must follow the maze, which clears that list.
    buildRailSpur();
    buildContainerMaze();
    buildKennels();
    // BEFORE THE GENERIC BUILDINGS (2026-09-24). It used to run after them,
    // and the audit found what that cost: buildings took the ground first,
    // so only 2.5 of 16 Spillway pipe segments and 0.6 of ~6 Motor Pool bays
    // were ever built, while the drain floor was painted under the buildings
    // that had taken their place -- the "buildings standing in the storm
    // drains" the user reported. A sector's SIGNATURE geometry outranks a
    // generic building, the same call already made for the rail spur, the
    // container maze and the Kennels. See zombie/MAP_VISUAL_AUDIT.md 1.3.
    buildSectorInteriors();
    buildZoneContents();
    // AFTER the sluice (the south wall has to know where the escape gate is,
    // so it does not put a culvert beside it) and AFTER the zone contents.
    //
    // Order matters and this is the second time on this map: the forest is
    // made of solids, so planting it first meant THE SPILLWAY -- whose
    // 800px spine has its western 240 in the band -- could no longer fit a
    // funnel hall. Measured at 8 maps in 30 losing a hall; 0 with the
    // perimeter built last. Trunks still avoid everything standing, via
    // clashesReserved and blockedAtStatic.
    buildPerimeter();
    // buildSectorInteriors() is NOT here any more (2026-09-24) -- it is
    // hoisted above, with the other sector geometry. The note that used to
    // live here said it ran late "so a pen row or a pipe run routes around
    // both [landmarks and buildings]". It did route around them, by not
    // being built.
    placeWallBuys();
    placeCardStations();
    placeChokepointBarrels();
    finishFunnelsAndSilos();

    // The whole map is new, so the nav grid MUST be rebuilt. Leaving this
    // to rebuildSolidIndex's door-signature check is not enough: a fresh
    // level has the same all-closed door pattern as the old one, so the
    // signature matches and the grid silently survives from the previous
    // layout -- zombies then path against walls that no longer exist.
    navDoorSig = null;
    // Every opening on the map exists by now, which is what this pass needs.
    paintThresholds();

    markNavDirty();

    rebuildSolidIndex();
    assertZoneConnectivity();
}

// EVERY SECTOR MUST BE REACHABLE. Cheap, and it is exactly the check that
// would have caught the 2026-09-18 walled-off gate plate (68 seeds in 300
// on which the endgame simply could not be finished, and nothing said so).
//
// Two separate questions, because players and zombies do not see the same
// walls: players need a chain of DOORS, zombies need doors or windows. A
// sector unreachable by zombies would be a place you could hide in a box,
// which is the one thing segmentation must never allow.
function assertZoneConnectivity() {
    let unreachablePlayers = 0, unreachableZombies = 0;
    for (let i = 0; i < ZONE_COUNT; i++) {
        if (zoneDepth[i] >= 99) unreachablePlayers++;
        if (zoneStepToward(Z_BLOCKHOUSE, i) < 0 && i !== Z_BLOCKHOUSE) unreachableZombies++;
    }
    if (unreachablePlayers || unreachableZombies) {
        // Not a throw: a broken map is still better than a blank screen, and
        // zDestroy/the dev panel's error capture will surface this.
        console.warn("[zombie] sector connectivity: " + unreachablePlayers +
                     " unreachable by door, " + unreachableZombies + " unreachable at all");
    }
    return !unreachablePlayers && !unreachableZombies;
}

// --- zone boundaries -------------------------------------------------
// Every boundary carries one door (players, bought) and 1-3 boarded
// windows (zombies, broken through). The windows are what make
// segmentation safe: there is no zone the horde cannot follow you into.
//
// IDEA 29: window count, width and position all vary per boundary. v2
// used a single 90px window at a fixed 150px offset on all twelve, so
// every boundary read identically and there was nothing to learn.
// Walk the paint grid for cells whose neighbour belongs to somebody else,
// and merge consecutive ones into RUNS. Every run is axis-aligned and a
// whole number of cells long, which is what keeps both solid grids, the
// door art and the window art working exactly as they did on the 3x3.
//
// 17 sector pairs, 42 runs on the current paint.
function zoneBoundaryRuns() {
    const runs = [];
    // Vertical: between column c and c+1, merged down the rows.
    for (let c = 0; c < ZONE_COLS_FINE - 1; c++) {
        let r = 0;
        while (r < ZONE_ROWS_FINE) {
            const a = ZONE_PAINT[r * ZONE_COLS_FINE + c];
            const b = ZONE_PAINT[r * ZONE_COLS_FINE + c + 1];
            if (a === b) { r++; continue; }
            let n = 0;
            while (r + n < ZONE_ROWS_FINE &&
                   ZONE_PAINT[(r + n) * ZONE_COLS_FINE + c] === a &&
                   ZONE_PAINT[(r + n) * ZONE_COLS_FINE + c + 1] === b) n++;
            runs.push({ vertical: true, fixed: (c + 1) * ZONE_CELL_W - WALL_T / 2,
                        start: r * ZONE_CELL_H, span: n * ZONE_CELL_H, a: a, b: b });
            r += n;
        }
    }
    // Horizontal: between row r and r+1, merged along the columns.
    for (let r = 0; r < ZONE_ROWS_FINE - 1; r++) {
        let c = 0;
        while (c < ZONE_COLS_FINE) {
            const a = ZONE_PAINT[r * ZONE_COLS_FINE + c];
            const b = ZONE_PAINT[(r + 1) * ZONE_COLS_FINE + c];
            if (a === b) { c++; continue; }
            let n = 0;
            while (c + n < ZONE_COLS_FINE &&
                   ZONE_PAINT[r * ZONE_COLS_FINE + c + n] === a &&
                   ZONE_PAINT[(r + 1) * ZONE_COLS_FINE + c + n] === b) n++;
            runs.push({ vertical: false, fixed: (r + 1) * ZONE_CELL_H - WALL_T / 2,
                        start: c * ZONE_CELL_W, span: n * ZONE_CELL_W, a: a, b: b });
            c += n;
        }
    }
    return runs;
}

// A door (124-159) and a window (112-151) plus margins need about this
// much wall between them.
const BOUNDARY_BOTH_MIN = 320;

function buildZoneWalls() {
    const runs = zoneBoundaryRuns();

    // One opening pair PER SECTOR PAIR, on the longest wall they share.
    // The old code put a door and a window on every boundary segment,
    // which was fine when there were 12 of them; there are 42 runs now and
    // that would be 42 doors. Per pair keeps the invariant that matters --
    // no sector the horde cannot follow you into -- at 17 doors.
    const best = {};
    for (let i = 0; i < runs.length; i++) {
        const k = passageKey(runs[i].a, runs[i].b);
        if (!best[k] || runs[i].span > best[k].span) best[k] = runs[i];
    }

    for (let i = 0; i < runs.length; i++) {
        const run = runs[i];
        const k = passageKey(run.a, run.b);
        if (best[k] !== run) {
            // Not this pair's opening: solid wall the whole way.
            pushBoundarySeg(run.vertical, run.fixed, run.start, run.span);
            continue;
        }
        // A run under BOUNDARY_BOTH_MIN gets a WINDOW ONLY, never a door.
        // That is not a compromise -- a window is already "zombies pass,
        // players never do", so such a pair is simply a place the horde
        // gets through and you do not. On the current paint exactly one
        // pair is like this (THE BLOCKHOUSE | THE YARD, a single 300px
        // wall), and the keep having one boarded window onto the yard is
        // a better answer than widening the wall to suit the code.
        emitBoundary(run.vertical, run.fixed, run.start, run.span, run.a, run.b,
                     run.span >= BOUNDARY_BOTH_MIN);
    }

    buildBoundaryPosts();
    computeZoneDepth();
    priceDoors();
}

// A POST AT EVERY BOUNDARY JUNCTION (2026-09-20).
//
// Asked as "do the standard sector-dividing walls need to be aligned along
// their centreline? this leads to a double-overlapping wall condition at the
// corners and the corners are not aligned". They do not, and both halves of
// that are real:
//
//   - A run is centred on its boundary line (`fixed` is the line minus
//     WALL_T/2), so a vertical run and a horizontal run that meet share a
//     10x10 square. Fills are opaque, so that alone would be invisible --
//     except drawWalls paints a 2px highlight along each wall's top and left
//     edge, and the second wall's highlight strikes across the first wall's
//     BODY. That is the "double-overlapping" the eye actually catches.
//   - The opposite 10x10 square is covered by neither run, so the corner has
//     a notch out of it and the two walls visibly fail to meet.
//
// MOVING THE WALLS IS NOT THE FIX: `fixed` is what every door, window and
// reserve on that boundary is positioned against, so shifting it by 10px
// moves the whole opening layout. A post does the job instead -- a full
// WALL_T square centred on the junction, emitted LAST so its own highlight
// is the one that survives. The notch fills, the overlap is hidden inside a
// square that is meant to be there, and the corner reads as a pillar, which
// is what a corner between two walls looks like anyway.
function buildBoundaryPosts() {
    for (let r = 1; r < ZONE_ROWS_FINE; r++) {
        for (let c = 1; c < ZONE_COLS_FINE; c++) {
            // The four cells meeting at this vertex. All the same id means
            // there is no boundary here at all.
            const a = ZONE_PAINT[(r - 1) * ZONE_COLS_FINE + (c - 1)];
            const b = ZONE_PAINT[(r - 1) * ZONE_COLS_FINE + c];
            const d = ZONE_PAINT[r * ZONE_COLS_FINE + (c - 1)];
            const e = ZONE_PAINT[r * ZONE_COLS_FINE + c];
            if (a === b && b === d && d === e) continue;

            const x = c * ZONE_CELL_W - WALL_T / 2;
            const y = r * ZONE_CELL_H - WALL_T / 2;
            // Never across an opening: a post is cosmetic and a door or
            // window it narrows is not.
            if (rectBlockedByOpening({ x: x, y: y, w: WALL_T, h: WALL_T })) continue;
            walls.push({ x: x, y: y, w: WALL_T, h: WALL_T, post: true });
        }
    }
}

// Does this rect touch a door or a barricade? Posts must not.
function rectBlockedByOpening(r) {
    for (let i = 0; i < doors.length; i++) {
        if (rectsOverlap(r, doors[i])) return true;
    }
    for (let i = 0; i < barricades.length; i++) {
        if (rectsOverlap(r, barricades[i])) return true;
    }
    return false;
}

// Breadth-first from the Blockhouse over DOOR edges, so "how deep is this
// sector" is how many doors you have to buy to stand in it. Ring distance
// in a 3x3 was approximating exactly this and stops meaning anything once
// the shapes interlock.
function computeZoneDepth() {
    zoneDepth = [];
    for (let i = 0; i < ZONE_COUNT; i++) zoneDepth.push(99);
    zoneDepth[Z_BLOCKHOUSE] = 0;

    const neighbours = [];
    for (let i = 0; i < ZONE_COUNT; i++) neighbours.push([]);
    for (const k in zonePassages) {
        if (!Object.prototype.hasOwnProperty.call(zonePassages, k)) continue;
        if (!zonePassages[k].door) continue;          // doors only
        const parts = k.split(">");
        const a = +parts[0], b = +parts[1];
        neighbours[a].push(b);
        neighbours[b].push(a);
    }

    let queue = [Z_BLOCKHOUSE];
    while (queue.length) {
        const next = [];
        for (let i = 0; i < queue.length; i++) {
            const z = queue[i];
            for (let j = 0; j < neighbours[z].length; j++) {
                const n = neighbours[z][j];
                if (zoneDepth[n] > zoneDepth[z] + 1) {
                    zoneDepth[n] = zoneDepth[z] + 1;
                    next.push(n);
                }
            }
        }
        queue = next;
    }
}

// Doors are priced by depth, which is only known once every door exists --
// hence the second pass. Same curve as the old ring pricing, so nothing
// about the early economy moves for a sector that was one ring out.
function priceDoors() {
    for (const k in zonePassages) {
        if (!Object.prototype.hasOwnProperty.call(zonePassages, k)) continue;
        const d = zonePassages[k].door;
        if (!d) continue;
        const parts = k.split(">");
        const deep = Math.max(zoneDepth[+parts[0]], zoneDepth[+parts[1]]);
        d.cost = 900 + 350 * Math.max(1, deep);
        d.ring = Math.min(zoneDepth[+parts[0]], zoneDepth[+parts[1]]);
        if (d.ring === 0 && !d.trapped) {
            d.trapped = true;
            addDoorTrap(d.w < d.h, d);
        }
    }
}

// `vertical` says which axis the wall runs along. `fixed` is its position
// on the other axis, `start`/`span` describe the segment it covers.
function emitBoundary(vertical, fixed, start, span, zoneA, zoneB, allowDoor) {
    // Openings are laid out in equal SLOTS rather than placed freely and
    // then de-overlapped. The free-placement version pushed each opening
    // past the previous one's clearance, and on a crowded boundary the
    // last one was shoved beyond the end of the wall entirely -- which
    // silently produced a boundary with no opening at all, sealing a zone
    // and stranding every zombie behind it. Slots cannot collide and
    // cannot overflow, by construction.
    // Window count scales with how long the run is -- a 1600px wall wants
    // more than one way through, a 300px one wants exactly one thing in it.
    const winCount = Math.max(1, Math.min(3, Math.floor(span / 700) + 1));
    const total = (allowDoor ? 1 : 0) + winCount;
    const slot = span / total;
    const doorSlot = allowDoor ? Math.floor(MP.random() * total) : -1;
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

    // Cost and ring are NOT set here any more: they depend on graph depth
    // from the Blockhouse, which is not known until every door exists.
    // priceDoors() does a second pass once buildZoneWalls() is finished.
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
            d.cost = 900;                 // priceDoors() overwrites this
            d.ring = 9;
            doors.push(d);
            zonePassages[pk].door = d;
            reserveAround(d, 150, true);
        } else {
            const b = vertical
                ? { x: fixed, y: g.at, w: WALL_T, h: g.size, hp: 100, maxHp: 100, chewUntil: 0 }
                : { x: g.at, y: fixed, w: g.size, h: WALL_T, hp: 100, maxHp: 100, chewUntil: 0 };
            barricades.push(b);
            if (!zonePassages[pk].window) zonePassages[pk].window = b;
            reserveAround(b, 120, true);
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

// `soft` marks a reservation that exists only to keep the ground around a
// boundary OPENING clear, as opposed to one protecting a structure (the keep,
// a funnel hall, a landmark, the rail spur). The two are not the same
// constraint and conflating them is expensive:
//
// Measured in THE KENNELS, 2026-09-20. 54% of candidate positions passed
// inZone and then clashesReserved rejected 97% OF THOSE -- 1598 down to 54,
// leaving 1.5% of the sector placeable. The reserved rects touching the sector
// totalled 1,731,152 px2 against a sector area of 900,000: overlapping
// reservations covering nearly twice the ground that exists. The 150px inward
// door reserves were almost all of it.
//
// A building must not sit on a doorway. A railcar 100px from one is exactly
// the claustrophobia a tight-quarters sector is supposed to have. So the
// Kennels honours hard reserves and takes its own, smaller clearance from the
// openings themselves -- see kennelSpotOk().
function reserveAround(r, pad, soft) {
    reservedRects.push({ x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2,
                         soft: !!soft });
}

// Structural reservations only. Everything clashesReserved tests except the
// ground held around boundary openings.
function clashesReservedHard(r) {
    for (let j = 0; j < reservedRects.length; j++) {
        if (reservedRects[j].soft) continue;
        if (rectsOverlap(r, reservedRects[j])) return true;
    }
    return false;
}

// The clearance a piece of Kennels stock keeps from any door or window. Well
// over the 78px nav guarantee, so a doorway never becomes unusable, and far
// under the 150px a building takes -- which is the whole point.
const KENNEL_DOOR_CLEAR = 82;

function clearOfOpenings(r, pad) {
    const grown = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
    for (let i = 0; i < doors.length; i++) if (rectsOverlap(grown, doors[i])) return false;
    for (let i = 0; i < barricades.length; i++) if (rectsOverlap(grown, barricades[i])) return false;
    return true;
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

// ---------------------------------------------------
//   SECTOR INTERIORS  (2026-09-19)
// ---------------------------------------------------
// The signature geometry of four sectors, so each one FEELS different to
// move through rather than only looking different. MAP_REVAMP_PLAN.md 4.
//
// Every wall here is laid in short segments and each segment is dropped if
// it clashes with reserved ground -- a boundary opening's approach, the
// sluice, a funnel hall, a landmark. That is what lets these run right
// across a sector without ever sealing a door or a window.
//
// INTERIOR_LANE is the clear width of anything you are meant to walk or
// fight down. 160, comfortably over the 78px nav guarantee and wide enough
// for two players to pass -- the same figure the container maze will want
// when it is built (MAP_REVAMP_PLAN.md 8).
const INTERIOR_LANE = 160;

// The interiors that route AROUND the buildings. THE KENNELS is not one of
// them -- see buildKennels, which is hoisted with the container maze.
function buildSectorInteriors() {
    buildSpillwayPipes();
    buildMotorBays();
    // buildRailSpur() is NOT here any more (2026-09-20). It is hoisted to run
    // before the container maze and the generic buildings -- it crosses three
    // sectors, so it has to claim its ground before anything else does, the
    // same reason the maze and the Kennels were hoisted before it.
}

// A wall in segments, skipping anything that would land on reserved
// ground -- and, every `gapEvery` segments, leaving a DELIBERATE gap.
//
// The gaps are not decoration. Measured 2026-09-19 with the flow field run
// from the keep across 25 seeds: an unbroken 1,380px pipe wall turns each
// run into a tube whose sides can only be reached from its two ends, and
// any reserved rect landing across an end sealed it -- 579 unreachable nav
// cells in THE SPILLWAY alone. A sealed pocket is both a free safe spot
// for a player and a trap for any zombie that wanders in, which is exactly
// the failure the boundary-spur clipping rule already exists to prevent
// (see "Boundary cover spurs" in CLAUDE.md).
//
// They are also better fiction: a cross-drain between two storm runs.
//
// RETURNS an array of `n` booleans, one per segment slot, saying which ones
// actually went down (2026-09-24). The caller needs that to paint the floor
// only where the structure exists: the Spillway used to paint its drain down
// the whole run whether or not a single pipe wall had been laid beside it.
function segmentedWall(x, y, w, h, step, gapEvery) {
    const vertical = h > w;
    const len = vertical ? h : w;
    const n = Math.max(1, Math.round(len / step));
    const each = len / n;
    const every = gapEvery || 3;
    const taken = [];
    for (let i = 0; i < n; i++) taken.push(false);
    for (let i = 0; i < n; i++) {
        // A gap, offset per wall so neighbouring runs do not line theirs up
        // into one long open corridor across the sector.
        if (n > 2 && i % every === (Math.floor(x / 97) + Math.floor(y / 89)) % every) continue;
        const seg = vertical
            ? { x: x, y: Math.round(y + i * each), w: w, h: Math.round(each) }
            : { x: Math.round(x + i * each), y: y, w: Math.round(each), h: h };
        const pad = { x: seg.x - 24, y: seg.y - 24, w: seg.w + 48, h: seg.h + 48 };
        if (clashesReserved(pad)) continue;
        walls.push(seg);
        taken[i] = true;
    }
    return taken;
}

// --- THE SPILLWAY: three storm runs ----------------------------------
// The sector's spine is two cells wide (800px) and its western 240 is
// forest, which leaves 560 -- exactly three 160px runs with a 20px wall
// between and either side. That is not a coincidence; the runs were sized
// to the spine.
function buildSpillwayPipes() {
    const b = zoneBounds(Z_SPILLWAY);
    const x0 = FOREST_BAND;                       // start where the trees stop
    const usable = 800 - FOREST_BAND;             // the spine, minus forest
    const runs = 3;
    const lane = Math.floor((usable - WALL_T * (runs + 1)) / runs);
    const top = 340, bottom = 1720;               // clear of both boundaries

    const taken = [];
    for (let i = 0; i <= runs; i++) {
        const x = x0 + i * (lane + WALL_T);
        taken.push(segmentedWall(x, top, WALL_T, bottom - top, 220));
    }

    // UNIQUE floor: the invert down each run -- BUT ONLY WHERE A PIPE WALL
    // ACTUALLY STANDS BESIDE IT (2026-09-24).
    //
    // It used to paint the full 1,380px of every run unconditionally, while
    // segmentedWall was dropping most of its segments onto reserved ground.
    // So the drain was painted and the pipe was not, and whatever went in
    // afterwards -- usually a building -- stood on a painted storm drain.
    // A floor is a claim about what is there; it has to be made by whatever
    // built the thing.
    //
    // A slot counts if EITHER bounding wall was laid: a run with one side
    // open is still a run. Consecutive slots merge, so this stays a handful
    // of rects rather than one per segment -- clashesReserved is linear.
    const segs = taken[0].length;
    const each = (bottom - top) / segs;
    for (let i = 0; i < runs; i++) {
        const x = x0 + WALL_T + i * (lane + WALL_T);
        let from = -1;
        for (let k = 0; k <= segs; k++) {
            const live = k < segs && (taken[i][k] || taken[i + 1][k]);
            if (live && from < 0) from = k;
            if (!live && from >= 0) {
                const y = Math.round(top + from * each);
                const h = Math.round((k - from) * each);
                if (typeof zfPatch === "function") zfPatch(x, y, lane, h, "invert");
                // AND RESERVED, which is the other half of the fix: the run
                // is a place, so nothing generic may stand in it.
                reservedRects.push({ x: x, y: y, w: lane, h: h });
                from = -1;
            }
        }
    }
    // The silt trap: the one open room, in the sector's foot.
    if (typeof zfPatch === "function") zfPatch(x0, bottom + 40, usable, 220, "wetconcrete");
    spillwayRuns = { x0: x0, lane: lane, runs: runs, top: top, bottom: bottom };
}
let spillwayRuns = null;

// --- THE KENNELS: rail cars and containers ---------------------------
// 2026-09-20, on request: "the rail car shown in motor pool is great
// visually. I'd like to reuse that (along with a vertical version) in the
// kennels space. a mixture of railcars and shipping containers should fill
// this space to create a series of claustrophobic hallways."
//
// So the pens are gone. THE KENNELS is now the tightest ground on the map
// by being FULL rather than by being subdivided: long rolling stock and
// containers laid on a grid, half of them turned across the other half, so
// the lanes between them bend instead of running straight.
//
// THE RUN SURVIVES. It is the sector's one straight retreat and the whole
// reason the place is fightable -- you fight in the gaps and you leave by
// the run -- so it is carved first and nothing is allowed to stand in it.
//
// KENNEL_LANE is 150: over the 78px nav guarantee, and deliberately tighter
// than the container maze's 140-plus-stagger feels, because this sector is
// meant to be the claustrophobic one.
// 136, not 150: still 1.7x the 78px nav guarantee and four times the
// widest body, and THE KENNELS is only ~1200x660 of usable ground once the
// forest band and the boundary reserves are taken off. This is meant to be
// the tight sector.
// 100, not 136 (2026-09-20, on a playtest call that the shotgun sector was
// "not reading as a tight-quarters sector").
//
// This constant IS the hallway: every piece of stock keeps KENNEL_LANE clear
// of every other, so it sets both how wide the gaps are and, through that, how
// many pieces fit at all. At 136 the effective footprint of a railcar was
// 322 x 190 and the sector could hold about nine -- lanes you stroll down.
//
// 90 is deliberately the TIGHTEST LANE ON THE MAP: under the container maze's
// 140 and INTERIOR_LANE's 160, and still 12px over the 78px nav guarantee
// (2*NAV_CELL + 2*NAV_PAD), so a SUPER SPLITTER at 34px still routes through
// it with room to spare. Do not take it below 78 -- see rule 3 in CLAUDE.md.
const KENNEL_LANE = 90;
const RAILCAR_LONG = 186;        // along its length
const RAILCAR_SHORT = 56;        // across it
const KENNEL_SHORT = 104;        // a single-slot container, for packing gaps
// A CONTAINER IS NOT A RAILCAR AND SHOULD NOT BE 56px ACROSS.
//
// This is what was actually making the sector read as open ground. At a 90px
// lane the count is near the packing limit -- about 8 pieces -- so density
// could not come from more of them; the pieces themselves were thin slivers,
// and a 56px sliver reads as an obstacle you walk around, not as a wall that
// makes a corridor. A container at 96 across reads as a block, and the gap
// between two of them reads as a hallway.
//
// Railcars stay narrow, because a railcar IS narrow. The mix is the point.
const KENNEL_CONTAINER_DEEP = 96;
// How close two pieces may sit END TO END. ZERO, so a run of stock forms a
// genuinely continuous wall.
//
// It was 22, and that was the wrong kind of number. A GAP MUST BE EITHER
// CLOSED OR WALKABLE, NEVER IN BETWEEN: at 22 the pieces did not join, but the
// slot between them was far under the 78px nav guarantee, so it held passable
// cells the flow field could never reach. Measured, that took map-wide nav
// reachability from 0.0055% to 0.0531% and 298 OF THE 321 UNREACHABLE CELLS
// WERE IN THIS SECTOR -- a free safe spot for a player and a trap for any
// zombie that wandered in, which is the same failure the boundary-spur
// clipping rule and segmentedWall() both exist to prevent.
//
// At 0 the runs are solid and the only gaps are the lanes across them, which
// are KENNEL_LANE and walkable by construction.
const KENNEL_END_GAP = 0;

let kennelRun = null;     // the sector's one straight retreat
let railcars = [];        // rolling stock, here and on the Yard's spur

function buildKennels() {
    const b = zoneBounds(Z_KENNELS);
    // railcars is NOT reset here (2026-09-20). generateLevel() already clears
    // it, and the rail spur is built BEFORE the Kennels now -- clearing it
    // here silently deleted every piece of rolling stock on the spur, so the
    // only railcars on the map were this sector's own.

    // The run: a full-width lane, kept clear of everything.
    const runY = Math.round(b.y + b.h * 0.56);
    kennelRun = { x: b.x, y: runY, w: b.w, h: KENNEL_LANE };
    reservedRects.push({ x: kennelRun.x, y: kennelRun.y, w: kennelRun.w, h: kennelRun.h });
    // NOT painted as track any more (2026-09-21). It was ballast across the
    // sector's whole BOUNDING BOX, so on 40 maps of 40 it ran under a
    // boundary wall and out the other side -- a railway to nowhere. It is a
    // lane, not a line; the railcars get their own sidings (placeKennelPiece).

    // ADAPTIVE, NOT A GRID (2026-09-20). A fixed pitch was the obvious way
    // to lay rolling stock and it does not survive this sector: THE KENNELS
    // is eight cells, its western column stops at row 2, and every boundary
    // around it reserves 150px inward for a door. A grid then spends whole
    // rows landing on reserved ground -- measured at 7 pieces placed out of
    // 137 attempts across 20 maps.
    //
    // Scattering with a MINIMUM SEPARATION gets the same result -- pieces
    // with lanes between them -- while fitting itself to whatever ground is
    // actually free. The separation IS the hallway: every piece keeps
    // KENNEL_LANE clear of every other, so the gaps cannot close up.
    // `want` is a TARGET, not a guarantee -- the separation rule caps the real
    // number, and on a crowded seed the sector simply fills up. Raised 9 -> 34
    // with the lane cut, because at 136 the count was limited by geometry and
    // asking for more did nothing; at 100 it is limited by `want`.
    const placed = [];
    const want = 72;
    for (let i = 0; i < want; i++) {
        for (let tries = 0; tries < 170; tries++) {
            const vertical = MP.random() < 0.46;
            const isCar = MP.random() < 0.45;
            // Two lengths, not one. A field of identical 186px pieces tiles
            // at one pitch and leaves every remainder unusable; a short piece
            // fits the gaps a long one cannot, which is what turns a row of
            // stock into a warren.
            const long = isCar || MP.random() < 0.45;
            const len = long ? RAILCAR_LONG : KENNEL_SHORT;
            const across = isCar ? RAILCAR_SHORT : KENNEL_CONTAINER_DEEP;
            const w = vertical ? across : len;
            const h = vertical ? len : across;
            const x = Math.round(b.x + 40 + MP.random() * Math.max(1, b.w - 80 - w));
            const y = Math.round(Math.max(b.y + 40, FOREST_BAND + 30) +
                                 MP.random() * Math.max(1, b.h - 80 - h));

            // SEPARATION IS ANISOTROPIC, and this is what makes the sector
            // read as tight quarters rather than as a field of obstacles.
            //
            // A uniform KENNEL_LANE in both axes produces a SCATTER: every
            // piece islanded, gaps everywhere, and the eye reads "things
            // placed about" instead of "corridors". The container maze feels
            // claustrophobic with seven pieces because it is a baffle, not a
            // scatter.
            //
            // So: pieces may sit almost end to end ALONG their length, which
            // lines them up into runs that read as walls, and must keep the
            // full lane ACROSS it, which is the hallway between runs. Same
            // count of pieces, completely different sector.
            const alongX = w >= h;
            const padX = alongX ? KENNEL_END_GAP : KENNEL_LANE;
            const padY = alongX ? KENNEL_LANE : KENNEL_END_GAP;
            let tooClose = false;
            for (let k = 0; k < placed.length && !tooClose; k++) {
                if (rectsOverlap({ x: x - padX, y: y - padY,
                                   w: w + padX * 2, h: h + padY * 2 }, placed[k])) {
                    tooClose = true;
                }
            }
            if (tooClose) continue;

            if (!placeKennelPiece(x, y, w, h, vertical, isCar)) continue;
            placed.push({ x: x, y: y, w: w, h: h });
            break;
        }
    }
}
// Returns whether the piece actually went down, so the caller can retry.
// KENNEL_ELBOW: how much sector ground a piece needs around it.
//
// Not decoration -- this is what stops a piece SEALING a passage. THE KENNELS
// has a one-cell-tall western arm at row 3, and a cell is 150px, so a single
// container laid across it closes the arm completely. Measured on seed 22352:
// one cluster of 44 unreachable cells at x 2440-2820, y 480-540, which is
// exactly that arm. Requiring sector ground all round means a piece can only
// go where the sector is more than one piece deep, so it can narrow a route
// and never close one.
const KENNEL_ELBOW = 70;

function placeKennelPiece(x, y, w, h, vertical, isCar) {
    const ex = KENNEL_ELBOW;
    if (!inZone(x - ex, y - ex, Z_KENNELS) || !inZone(x + w + ex, y - ex, Z_KENNELS) ||
        !inZone(x - ex, y + h + ex, Z_KENNELS) || !inZone(x + w + ex, y + h + ex, Z_KENNELS)) return false;
    if (!inZone(x, y, Z_KENNELS) || !inZone(x + w, y, Z_KENNELS) ||
        !inZone(x, y + h, Z_KENNELS) || !inZone(x + w, y + h, Z_KENNELS)) return false;
    // HARD reserves only, plus a smaller clearance measured from the openings
    // themselves. See reserveAround: the 150px door reserves left 1.5% of this
    // sector placeable, which is why it never read as tight quarters.
    if (clashesReservedHard({ x: x - 10, y: y - 10, w: w + 20, h: h + 20 })) return false;
    if (!clearOfOpenings({ x: x, y: y, w: w, h: h }, KENNEL_DOOR_CLEAR)) return false;
    // Beside the running line, never on it.
    if (onSpurLane({ x: x, y: y, w: w, h: h }, 26)) return false;
    // 2px, not 10: at 10 two pieces meant to abut are held apart by a 10-20px
    // slot, which is the sliver-pocket problem again in a different place.
    if (rectBlockedStatic({ x: x - 2, y: y - 2, w: w + 4, h: h + 4 })) return false;

    walls.push({ x: x, y: y, w: w, h: h });
    if (isCar) {
        railcars.push({ x: x, y: y, w: w, h: h, vertical: vertical });
        // Rolling stock stands on track: a short SIDING in the car's own
        // orientation (2026-09-21), rather than a ballast square under it
        // that the tile's world-grid stripes then ran across at random.
        kennelSiding(x, y, w, h, vertical);
    } else {
        yardContainers.push({ x: x, y: y, w: w, h: h, hue: Math.floor(MP.random() * 5) });
        if (typeof zfPatch === "function") zfPatch(x - 8, y - 8, w + 16, h + 16, "hardstand");
    }
    reservedRects.push({ x: x, y: y, w: w, h: h });
    return true;
}

// --- THE MOTOR POOL: service bays ------------------------------------
// Three-walled pockets off the main run: cover you duck INTO, with one way
// out -- deliberately the opposite of the Kennels' pens, which open onto
// the one lane you can run down.
function buildMotorBays() {
    const b = zoneBounds(Z_MOTOR);
    const bayY = Math.round(b.y + b.h - 300);
    for (let bx = b.x + 140; bx < b.x + b.w - 300; bx += 260) {
        const bw = 210, bh = 190;
        if (!inZone(bx, bayY, Z_MOTOR) || !inZone(bx + bw, bayY + bh, Z_MOTOR)) continue;
        if (clashesReserved({ x: bx - 40, y: bayY - 40, w: bw + 80, h: bh + 80 })) continue;
        walls.push({ x: bx, y: bayY, w: WALL_T, h: bh });
        walls.push({ x: bx + bw - WALL_T, y: bayY, w: WALL_T, h: bh });
        walls.push({ x: bx, y: bayY + bh - WALL_T, w: bw, h: WALL_T });
        // UNIQUE floor: hardstanding with a worn bay line.
        if (typeof zfPatch === "function") zfPatch(bx, bayY, bw, bh, "hardstand");
        reservedRects.push({ x: bx, y: bayY, w: bw, h: bh });
    }
}

// --- THE YARD: the rail spur -----------------------------------------
// The spur runs out of the Yard through its TONGUE and on into the Motor
// Pool between the bays. It is the reason the tongue is shaped like that,
// and it is the clearest "this is not a grid" mark on the minimap.
//
// Flatcars are solid; the track itself is floor. So the spur is a lane
// with cover ON it rather than a wall across the sector.
// --- THE RAIL SPUR: KENNELS -> YARD -> MOTOR POOL (2026-09-20, P6) ----
//
// This fixes a real contradiction rather than adding decoration. THE KENNELS'
// rail cars and THE MOTOR POOL's flatcars were given SHARED ARTWORK on
// 2026-09-20 so that "the spur visibly runs between them" -- and on the old
// paint THE TWO SECTORS WERE NOT ADJACENT. The art implied one rail line
// across a gap it never crossed.
//
// On the 24x18 paint THE YARD sits between them, which is the correct answer
// and not a workaround: a gantry crane exists to move containers between a
// rail head and a stack, so the Yard is the natural middle of the line. The
// spur is now one continuous L -- east out of the Kennels' neck, across the
// Yard under the crane, then south down the Yard's tail into the Motor Pool's
// bays.
//
// WHERE IT CROSSES A BOUNDARY WALL IT IS A BOARDED RAIL GATE, not a hole.
// A plain gap would have handed players a free route between three sectors
// and quietly deleted two door purchases -- the whole "buy outward" economy.
// A barricade is the idiom the map already has for exactly this ("zombies
// pass, players never do"), it needs no new notion of solidity, and a rail
// gate boarded over is what it looks like anyway.
const SPUR_LANE = 120;            // >= the 78px nav guarantee, and window-width
const SPUR_GATE_HP = 140;         // sturdier than a window: it is a gate

// Split every wall this rect crosses, leaving a clean opening. Returns the
// rects that were actually opened, so the caller can board them.
function carveOpening(o) {
    const kept = [];
    const cut = [];
    for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (w.x >= o.x + o.w || w.x + w.w <= o.x ||
            w.y >= o.y + o.h || w.y + w.h <= o.y) { kept.push(w); continue; }
        cut.push({ x: Math.max(w.x, o.x), y: Math.max(w.y, o.y),
                   w: Math.min(w.x + w.w, o.x + o.w) - Math.max(w.x, o.x),
                   h: Math.min(w.y + w.h, o.y + o.h) - Math.max(w.y, o.y) });
        // Keep whatever of the wall lies outside the opening. Rectilinear
        // walls only, so four slabs is exhaustive.
        if (w.y < o.y) kept.push({ x: w.x, y: w.y, w: w.w, h: o.y - w.y });
        if (w.y + w.h > o.y + o.h) kept.push({ x: w.x, y: o.y + o.h, w: w.w, h: w.y + w.h - (o.y + o.h) });
        const ty = Math.max(w.y, o.y), by = Math.min(w.y + w.h, o.y + o.h);
        if (w.x < o.x) kept.push({ x: w.x, y: ty, w: o.x - w.x, h: by - ty });
        if (w.x + w.w > o.x + o.w) kept.push({ x: o.x + o.w, y: ty, w: w.x + w.w - (o.x + o.w), h: by - ty });
    }
    walls = kept;
    return cut;
}

// One leg of the line. Lays ballast, reserves the lane so nothing is placed
// on the track, and boards any boundary it crosses.
function railLeg(x, y, w, h) {
    if (typeof zfPatch === "function") zfPatch(x, y, w, h, "ballast");
    const opened = carveOpening({ x: x, y: y, w: w, h: h });
    for (let i = 0; i < opened.length; i++) {
        const o = opened[i];
        barricades.push({ x: o.x, y: o.y, w: o.w, h: o.h,
                          hp: SPUR_GATE_HP, maxHp: SPUR_GATE_HP, chewUntil: 0 });
    }
    claimFloor(x, y, w, h, 0);
}

// Reserved LAST, after the rolling stock is down. Reserving the lane first
// makes the line clash with itself -- every piece of stock sits on the track
// by definition, so the first version placed exactly zero and the only
// railcars on the map were the Kennels' own.
//
// Reserved, not walled: the track is FLOOR. This only keeps buildings,
// containers, crates and stations off the line.
// The reservation is SOFT and the LANE is recorded separately.
//
// The reservation exists to keep buildings, containers, crates and stations
// off the track -- and those all test clashesReserved, so it still does. But
// THE KENNELS' own rolling stock standing beside the track is not a mistake,
// it is the picture, and the spur crosses a quarter of that sector (1440x160
// of about a million px2). So the Kennels tests clashesReservedHard, which
// skips this, and is held off the running line by spurLanes instead.
let spurLanes = [];

function railReserve(x, y, w, h) {
    reservedRects.push({ x: x - 20, y: y - 20, w: w + 40, h: h + 40, soft: true });
    spurLanes.push({ x: x, y: y, w: w, h: h });
}

function onSpurLane(r, pad) {
    const g = { x: r.x - pad, y: r.y - pad, w: r.w + pad * 2, h: r.h + pad * 2 };
    for (let i = 0; i < spurLanes.length; i++) if (rectsOverlap(g, spurLanes[i])) return true;
    return false;
}

// Rolling stock standing on a leg, spaced along it. Solid -- this is the
// cover that makes the spur a lane with things on it rather than a corridor.
function railStock(x, y, w, h, vertical) {
    const along = vertical ? h : w;
    const step = 300;
    for (let d = 90; d < along - 210; d += step) {
        const cw = vertical ? 54 : 190;
        const ch = vertical ? 190 : 54;
        const cx = Math.round(vertical ? x + (w - cw) / 2 : x + d);
        const cy = Math.round(vertical ? y + d : y + (h - ch) / 2);
        // Never ON a rail gate, or the gate is unusable -- but tested against
        // the gates themselves, not nearZoneBoundary(), whose fixed 150px
        // margin is most of a 200x150 cell and rejected every piece on the
        // southbound leg.
        if (blockedByRailGate(cx, cy, cw, ch)) continue;
        // Reserved ground placed BEFORE the spur -- the crane's legs, the
        // funnel halls, the keep. The spur's own lane is not reserved yet,
        // which is the point of the ordering.
        if (clashesReserved({ x: cx - 24, y: cy - 24, w: cw + 48, h: ch + 48 })) continue;
        walls.push({ x: cx, y: cy, w: cw, h: ch });
        railcars.push({ x: cx, y: cy, w: cw, h: ch, vertical: vertical });
    }
}

// A rail gate has to stay walkable-through for zombies, so nothing parks on
// one. 40px of clearance each side.
function blockedByRailGate(x, y, w, h) {
    for (let i = 0; i < barricades.length; i++) {
        const b = barricades[i];
        if (rectsOverlap({ x: x - 40, y: y - 40, w: w + 80, h: h + 80 }, b)) return true;
    }
    return false;
}

// --- P12: THRESHOLDS ------------------------------------------------
// A worn patch across every door and window, painted in ONE PASS AT THE END,
// because that is the only point at which every opening on the map exists --
// boundary doors, the keep's two barricades, the sluice, the rail gates and
// the funnel halls are created by six different functions.
//
// THRESH_REACH is how far the wear spreads either side of the opening. At
// roughly two thirds of a body it reads as traffic rather than as a doormat.
const THRESH_REACH = 26;

function paintThresholds() {
    if (typeof zfPatch !== "function") return;
    const mark = function (r) {
        const vertical = r.w < r.h;
        if (vertical) zfPatch(r.x - THRESH_REACH, r.y, r.w + THRESH_REACH * 2, r.h, "threshold");
        else zfPatch(r.x, r.y - THRESH_REACH, r.w, r.h + THRESH_REACH * 2, "threshold");
    };
    for (let i = 0; i < doors.length; i++) mark(doors[i]);
    for (let i = 0; i < barricades.length; i++) mark(barricades[i]);
}

// --- TRACK GEOMETRY (2026-09-21) --------------------------------------
// What drawRailTracks() (zombie-render.js) lays sleepers and rails along.
// Each entry is a centreline POLYLINE, a bed width, and a curve radius
// used to fillet every interior vertex -- the spur's corner is a curve,
// not two rectangles meeting.
//
// PURE GEOMETRY, NO MP.random(). It is derived from rects the level has
// already placed, so adding it cannot move one other thing on any seed.
//
// The ballast floor patch is still laid under each leg (railLeg), because
// it is the gravel; the track art used to be baked into that tile, which
// repeats on the WORLD grid, so only a leg that happened to run along the
// tile's stripes read as track.
let railPaths = [];

const SIDING_RUNOUT = 28;         // how far a siding runs past each end of its car
const SIDING_BED = 80;            // across: the car is 56, so 12px of shoulder

function railPath(pts, w, r) {
    railPaths.push({ pts: pts, w: w, r: r || 0 });
}

function kennelSiding(x, y, w, h, vertical) {
    if (vertical) {
        const cx = x + w / 2;
        const y0 = y - SIDING_RUNOUT, y1 = y + h + SIDING_RUNOUT;
        railPath([{ x: cx, y: y0 }, { x: cx, y: y1 }], SIDING_BED, 0);
        if (typeof zfPatch === "function") zfPatch(cx - SIDING_BED / 2, y0, SIDING_BED, y1 - y0, "ballast");
    } else {
        const cy = y + h / 2;
        const x0 = x - SIDING_RUNOUT, x1 = x + w + SIDING_RUNOUT;
        railPath([{ x: x0, y: cy }, { x: x1, y: cy }], SIDING_BED, 0);
        if (typeof zfPatch === "function") zfPatch(x0, cy - SIDING_BED / 2, x1 - x0, SIDING_BED, "ballast");
    }
}

function buildRailSpur() {
    // Leg A runs east along the KENNELS' neck (cols 16-17 at rows 6-7 are the
    // only Kennels cells at this height -- the same tail that severs
    // Yard <-> Blockhouse) and on across THE YARD.
    // ROW 6 ONLY, high in the cell. Every boundary reserves 150px inward for
    // its door, and the Kennels/Pump boundary below row 7 therefore reserves
    // y 1050-1200 -- so a lane straddling rows 6 and 7 sat inside it and most
    // of the rolling stock on this leg was silently dropped.
    const ay = 6 * ZONE_CELL_H + 20;
    const ax0 = 16 * ZONE_CELL_W + 10;            // just inside the Kennels
    const ax1 = 23 * ZONE_CELL_W + 10;

    // Leg B turns south down THE YARD's two-cell tail (cols 22-23) and runs
    // into THE MOTOR POOL.
    // NOT centred in the two-cell tail: the Yard/Pump boundary at x = 4400
    // reserves 150px east of itself, and centring put the lane one pixel
    // inside that, which rejected every piece of stock on the leg. Sit in the
    // band that is actually free, between that reserve and the east
    // perimeter wall.
    const bx = 22 * ZONE_CELL_W + 200;
    // Deep into THE MOTOR POOL, not just over its boundary. At 16 rows the
    // only southbound piece of stock landed within the rail gate's 40px
    // clearance and was dropped, so the Motor Pool -- half the point of the
    // line -- had none of it.
    const by1 = 17 * ZONE_CELL_H + 110;

    railLeg(ax0, ay, ax1 - ax0, SPUR_LANE);
    railLeg(bx, ay, SPUR_LANE, by1 - ay);
    yardSpur = { x: ax0, y: ay, w: ax1 - ax0, h: SPUR_LANE };
    // One line, not two legs: east along A's centre, turning south down
    // B's. The corner vertex is the crossing of the two centrelines; the
    // fillet radius of 90 keeps the bed within ~9px of the lanes' union.
    const half = SPUR_LANE / 2;
    railPath([{ x: ax0, y: ay + half }, { x: bx + half, y: ay + half }, { x: bx + half, y: by1 }],
             SPUR_LANE, 90);

    // Stock first, reservation second -- see railReserve.
    railStock(ax0, ay, ax1 - ax0, SPUR_LANE, false);
    railStock(bx, ay + SPUR_LANE + 60, SPUR_LANE, by1 - ay - SPUR_LANE - 60, true);

    railReserve(ax0, ay, ax1 - ax0, SPUR_LANE);
    railReserve(bx, ay, SPUR_LANE, by1 - ay);
}

// --- THE CONTAINER MAZE (2026-09-19, sequence step 5) ----------------
// A shipping container maze in THE YARD, which is the user's call and the
// better one. A hedge maze would have needed a FOURTH notion of solidity
// -- there are two solid grids and bullets gained a third view on
// 2026-09-19 (bulletBlockedAt) -- because "blocks sight, blocks nothing
// else" is not something this engine has. Containers are sight-blocking
// BY BEING SOLID, they are rectilinear so they cost the flow field nothing
// that walls do not already cost, and the Yard was already stacking them.
//
// IT IS BRAIDED, NOT PERFECT, AND THAT IS THE WHOLE DESIGN.
// A perfect maze -- one route between any two points -- is precisely the
// geometry the flow field is worst at: dead ends that zombies path into
// and stall in, and `relocateZombie` papering over it. So this is a
// STAGGERED BAFFLE layout instead:
//
//   - every horizontal lane runs the full width, uninterrupted
//   - vertical movement happens through the GAPS between containers
//   - consecutive rows are offset, so no two gaps line up
//
// You can always run; you can never see far; and there are no dead ends by
// construction. Which is also what a real container yard is.
//
// MAZE_LANE is 140: 1.8x the 78px nav guarantee, four times the widest
// body (the ULTRA HEAVY, 34px), and wide enough for two players to pass.
// The plan called for 160 and that was the right instinct -- a maze of
// minimum-width corridors is the one thing not to build -- but at a 220
// pitch THE YARD's usable rectangle only holds a 4x6 grid, and after the
// boundary-door reserves and the sector's own irregular west edge that
// came out as FOUR containers a map. Four containers is not a maze.
//
// 140 + 50 is a 190 pitch, which fits 5 x 8 over the same ground. The
// guarantee still clears by 62px, and the traversal measurement below is
// what says that is really true rather than arithmetic that looks true.
const MAZE_LANE = 140;
const MAZE_DEPTH = 50;                       // a container across its short side
const MAZE_PITCH = MAZE_LANE + MAZE_DEPTH;   // 190

function buildContainerMaze() {
    yardContainers = [];
    const b = zoneBounds(Z_YARD);

    // The maze fills the Yard's northern TWO THIRDS -- below the forest
    // band, inside the east perimeter wall, and clear of the western
    // boundary's door and window reserves (which run 150px deep and ate
    // the first column of every row when this started at b.x + 20).
    //
    // 1090 x 1500 at a 220 pitch is a 4 x 6 grid. It was 5 x 4 over the
    // north block alone, which is 8 attempts a map: not a maze, a few
    // crates. The Yard is 18 cells and tall, so the maze uses the height.
    // THE YARD'S SOLID NORTH-EAST RECTANGLE, not the whole sector.
    //
    // Spread across all 18 cells the maze came out as five containers
    // scattered over 1,000 x 1,500 -- measured at 37% of attempts thrown
    // out by inZone, because the sector is an hourglass and its western
    // column belongs to it on only three of eight rows. Five boxes spread
    // that thin is a scatter, not a maze.
    //
    // Cols 10-11 rows 0-3 is 800 x 1,200 of unbroken Yard, and a container
    // yard is a DENSE BLOCK anyway -- that is what one looks like. Same
    // container count in a third of the ground reads as something you have
    // to pick your way through.
    const x0 = b.x + 200;
    const y0 = Math.max(b.y + 20, FOREST_BAND + 40);
    const x1 = b.x + b.w - 30;
    const y1 = Math.min(b.y + b.h - 20, 1200);

    const cols = Math.floor((x1 - x0) / MAZE_PITCH);
    const rows = Math.floor((y1 - y0) / MAZE_PITCH);
    if (cols < 2 || rows < 2) return;

    for (let r = 0; r < rows; r++) {
        // Offset every other row by half a pitch, so a gap in one row never
        // sits above a gap in the next. That is what makes it a maze rather
        // than a grid of pillars you can see straight through.
        const rowShift = (r % 2) * Math.round(MAZE_PITCH / 2);
        const y = Math.round(y0 + r * MAZE_PITCH + MAZE_LANE);

        // Decide the whole row FIRST, then merge neighbours into runs. The
        // first version stepped run-then-gap and so only ever attempted two
        // containers in a four-slot row -- 12 attempts a map, which is a few
        // crates rather than a maze.
        const fill = [];
        for (let i = 0; i < cols; i++) fill.push(MP.random() < 0.66);
        // A row with no gap in it is a wall across the sector. Never.
        let anyGap = false;
        for (let i = 0; i < cols; i++) if (!fill[i]) anyGap = true;
        if (!anyGap) fill[Math.floor(MP.random() * cols)] = false;

        let c = 0;
        while (c < cols) {
            if (!fill[c]) { c++; continue; }
            // Adjacent slots merge into one longer container, capped at
            // three (a 500px box, about a 40ft container at this scale).
            // Capped at TWO, not three. A three-slot run is 430px long and
            // at that length it straddles the sector's edge or a reserved
            // rect and is thrown away whole -- one long container lost takes
            // an entire row of the maze with it. Two is a 240px box, which
            // is a shipping container anyway.
            let run = 0;
            while (c + run < cols && fill[c + run] && run < 2) run++;
            const x = Math.round(x0 + c * MAZE_PITCH + rowShift);
            const w = run * MAZE_PITCH - MAZE_LANE;
            // >= MAZE_DEPTH, not a literal 60. A single-slot container is
            // exactly MAZE_DEPTH wide (pitch minus lane), so when the pitch
            // was retuned from 220/60 to 190/50 the old `w >= 60` silently
            // threw away EVERY single-slot container and only two-slot runs
            // were ever attempted. That is the whole reason the maze kept
            // coming out as one or two boxes.
            if (w >= MAZE_DEPTH && x + w <= x1) placeContainer(x, y, w, MAZE_DEPTH);
            c += run;
        }
    }
}

// One container. Skipped rather than forced: a container that cannot go
// down leaves a wider lane, which is never a problem, whereas one forced
// onto reserved ground can wall off the crane or a wall-buy.
function placeContainer(x, y, w, h) {
    if (!inZone(x, y, Z_YARD) || !inZone(x + w, y, Z_YARD) ||
        !inZone(x, y + h, Z_YARD) || !inZone(x + w, y + h, Z_YARD)) return;
    // The bare footprint, with no margin: the 160px lanes either side ARE
    // the clearance, and a 26px margin on every side quietly adds 52 to the
    // pitch and halves how many containers fit.
    if (clashesReserved({ x: x, y: y, w: w, h: h })) return;
    // rectBlockedStatic, NOT blockedAtStatic: the latter takes a square
    // `size`, so a 440px container was being tested as a 468x468 block and
    // almost nothing placed. Exactly the trap the gantry crane hit.
    if (rectBlockedStatic({ x: x - 14, y: y - 14, w: w + 28, h: h + 28 })) return;

    walls.push({ x: x, y: y, w: w, h: h, container: true });
    yardContainers.push({ x: x, y: y, w: w, h: h, hue: Math.floor(MP.random() * 5) });
    // Only the footprint is reserved, NOT a margin: the lanes between
    // containers are the point, and reserving them would stop the next row
    // going down at all.
    reservedRects.push({ x: x, y: y, w: w, h: h });
    if (typeof zfPatch === "function") zfPatch(x - 10, y - 10, w + 20, h + 20, "hardstand");
}

let yardSpur = null;
let yardContainers = [];

// ---------------------------------------------------
//   LANDMARKS  (2026-09-19)
// ---------------------------------------------------
// One hero structure per sector, so "meet me at the crane" means
// somewhere. This is the payoff of the fixed skeleton: the crane is in
// THE YARD every run, and the Yard is always the north-east.
//
// HOW THEY READ AS STRUCTURES on a top-down 2D map, which is the part
// worth getting right (MAP_REVAMP_PLAN.md 4.1). Two techniques do nearly
// all of it, and both are flat fills -- no gradients, per AESTHETIC_GUIDE
// 6.3, which is how 1980 raster games faked height in the first place:
//
//   T1 CAST SHADOW -- a flat offset quad down-right of the footprint.
//      Says "this is above the floor".
//   T2 OFFSET TOP FACE -- the top drawn up-left of the base, by `lift`.
//      Says HOW FAR above: lift ENCODES height, so the crane's 16 makes
//      it read as the tallest thing on the map next to a bus's 5.
//   T3 DRAWN OVER THE BOUNDARY WALL -- landmarks draw after walls and are
//      culled to the VIEW, not to the sector, so the crane is visible from
//      the sector next door. Without this none of the rest matters.
//
// `solid` says whether the body is collision as well as paint. The crane
// is legs-only (you walk under the beam); the bus is solid.
let landmarks = [];

function placeLandmarks() {
    landmarks = [];
    addLandmark(Z_YARD,      "crane",   420, 150, 16);
    addLandmark(Z_MOTOR,     "bus",     240,  62,  5);
    addLandmark(Z_TURBINE,   "turbine", 190, 120, 10);
    addLandmark(Z_PUMP,      "pumps",   210,  90,  7);
    addLandmark(Z_COLD,      "chiller", 130, 130, 12);
    addLandmark(Z_KENNELS,   "silo",    110, 110, 14);
    addLandmark(Z_SPILLWAY,  "standpipe", 96, 96, 13);
    // THE BLOCKHOUSE's landmark is the keep, and THE SLUICE YARD's is the
    // south wall with the escape gate in it. Both already exist and both
    // are fixed, so neither needs one placed.
}

// --- P9: LANDMARK SIGHTLINES (2026-09-20) ---------------------------
// The height ladder already works -- crane 16, silo 14, standpipe 13, down to
// the bus at 5 -- and landmarks draw after the walls, culled to the VIEW, so
// one is visible from the sector next door. What was missing is that nothing
// guaranteed a landmark could be seen from anywhere USEFUL: placement took any
// spot that fitted. The map had a skyline and no sightlines.
//
// So a spot with clear line of sight from one of the sector's own doorways is
// PREFERRED -- you come through the door, you see the crane, you know which
// way you are facing. It is a preference and not a requirement on purpose: the
// existing rule that a sector without its landmark beats a landmark standing
// on the endgame has already cost one bug, and it still holds below.
// EYE_STEP_IN: the eye is not the middle of the doorway, it is a stride
// INSIDE the sector.
//
// Cast from the doorway's own centre and the result is nearly meaningless: the
// centre lies in the plane of the boundary wall, so every line that is not
// close to perpendicular clips the wall the door is set in, and the test
// degenerates into "is the landmark straight ahead". Measured, that put only
// 13.6% of landmarks 'visible' and reserving the line changed it by 0.3 points
// -- the occluder was the doorway itself, not anything placed later.
//
// A stride in is also what the brief actually describes: you come THROUGH the
// door and see the crane.
const EYE_STEP_IN = 130;

function sectorOpenings(zone) {
    const out = [];
    const push = function (r) {
        const cx = r.x + r.w / 2, cy = r.y + r.h / 2;
        const vertical = r.w < r.h;
        // Step off the wall into THIS sector -- whichever side that is.
        for (let sgn = -1; sgn <= 1; sgn += 2) {
            const ex = vertical ? cx + sgn * EYE_STEP_IN : cx;
            const ey = vertical ? cy : cy + sgn * EYE_STEP_IN;
            if (ex < 0 || ey < 0 || ex >= WORLD_W || ey >= WORLD_H) continue;
            if (zoneOf(ex, ey) === zone) out.push({ x: ex, y: ey });
        }
    };
    for (const k in zonePassages) {
        if (!Object.prototype.hasOwnProperty.call(zonePassages, k)) continue;
        const parts = k.split(">");
        if (+parts[0] !== zone && +parts[1] !== zone) continue;
        const p = zonePassages[k];
        if (p.door) push(p.door);
        if (p.window) push(p.window);
    }
    return out;
}

// Sampled along the line. 18px steps against a 10px probe: fine enough that a
// 20px wall cannot fall between two samples, which is the same mistake the nav
// grid made once when it sampled cell centres and made walls invisible.
// `skip` is the landmark's own footprint. Without it this reports nonsense
// the moment the landmark is solid: the line is cast to the body's CENTRE, so
// its last samples are inside the body and every landmark blocks itself. It
// did not show up at placement time -- the landmark is not a wall yet when its
// spot is chosen -- and showed up as "crane 98%, everything else 0%" when the
// same test was run over a finished map. The crane is the one landmark with no
// collision.
function clearSightStatic(x0, y0, x1, y1, skip) {
    const dx = x1 - x0, dy = y1 - y0;
    const steps = Math.ceil(Math.hypot(dx, dy) / 18);
    for (let i = 1; i < steps; i++) {
        const t = i / steps;
        const px = x0 + dx * t, py = y0 + dy * t;
        if (skip && px >= skip.x - 6 && px <= skip.x + skip.w + 6 &&
                    py >= skip.y - 6 && py <= skip.y + skip.h + 6) break;
        if (rectBlockedStatic({ x: px - 5, y: py - 5, w: 10, h: 10 })) return false;
    }
    return true;
}

// Returns the eye that can see this spot, or null. The EYE is returned rather
// than a boolean because choosing the spot is only half of P9 -- the line has
// to survive everything placed afterwards, and to protect it we need to know
// which line it was.
function landmarkSightline(x, y, w, h, eyes) {
    if (!eyes.length) return null;
    const cx = x + w / 2, cy = y + h / 2;
    const body = { x: x, y: y, w: w, h: h };
    for (let i = 0; i < eyes.length; i++) {
        if (clearSightStatic(eyes[i].x, eyes[i].y, cx, cy, body)) return eyes[i];
    }
    return null;
}

function landmarkSeen(x, y, w, h, eyes) {
    return !eyes.length || !!landmarkSightline(x, y, w, h, eyes);
}

// HOLD THE LINE OPEN. Landmarks are placed early, on purpose -- they get first
// pick of ground -- so at the moment a sightline is chosen the buildings,
// containers, rail stock and pen rows do not exist yet. Measured across 100
// seeds, choosing a clear line and then letting the rest of generation run
// left only 13.6% of landmarks actually visible from a doorway afterwards.
//
// So reserve a few boxes ALONG the line rather than the whole corridor: four
// 70px waypoints over the middle stretch. A continuous corridor would be tens
// of rects per landmark and clashesReserved is linear, and the two ends do not
// need it -- a doorway already reserves 150px and a landmark reserves 80.
const SIGHT_WAYPOINTS = 4;

function reserveSightline(eye, x, y, w, h) {
    if (!eye) return;
    const cx = x + w / 2, cy = y + h / 2;
    for (let i = 0; i < SIGHT_WAYPOINTS; i++) {
        const t = 0.25 + (0.5 * i) / Math.max(1, SIGHT_WAYPOINTS - 1);
        const px = eye.x + (cx - eye.x) * t;
        const py = eye.y + (cy - eye.y) * t;
        reservedRects.push({ x: Math.round(px - 35), y: Math.round(py - 35), w: 70, h: 70 });
    }
}

function addLandmark(zone, kind, w, h, lift) {
    const b = zoneBounds(zone);
    // NOT findOpenSpotSure: that relaxes the reserved-ground rule on its
    // later passes, which is right for a wall-buy (it must exist somewhere)
    // and wrong for a 420px solid -- it put the crane on top of a silo on
    // one seed in 200.
    //
    // Instead, ask for a genuinely clear spot with a shrinking clearance.
    // Note resPad must stay ABOVE ZERO at every step: spotOk skips the
    // reserved test entirely at 0, which would quietly bring the silo
    // problem straight back.
    // hallFits(), not findOpenSpot(): the spot finders take a SQUARE `size`,
    // so a 420x150 crane was being tested as 420x420 and almost never fitted
    // -- 39 maps in 40 had no crane. hallFits tests the real rect, checks
    // reserved ground, standing walls, claimed floor AND sector containment,
    // which is every rule a landmark needs.
    let spot = null;
    let anyFit = null;                       // the old behaviour, kept as the floor
    const pads = [110, 80, 50, 24, 8];
    const eyes = sectorOpenings(zone);       // P9
    for (let i = 0; i < pads.length && !spot; i++) {
        for (let tries = 0; tries < 90 && !spot; tries++) {
            const x = Math.round(b.x + 50 + MP.random() * Math.max(1, b.w - 100 - w));
            const y = Math.round(b.y + 50 + MP.random() * Math.max(1, b.h - 100 - h));
            if (!hallFits(x, y, w, h, pads[i], zone)) continue;
            if (!anyFit) anyFit = { x: x, y: y };
            // PREFER a spot you can see from one of this sector's doorways.
            const eye = landmarkSightline(x, y, w, h, eyes);
            if (eye) spot = { x: x, y: y, eye: eye };
        }
    }
    // No sightline anywhere? Take the spot that merely fits. A landmark you
    // cannot see from the door is still better than no landmark.
    if (!spot) spot = anyFit;
    // A sector without its landmark on a crowded seed is much better than a
    // landmark standing on the endgame.
    if (!spot) return;
    const lm = { x: spot.x, y: spot.y, w: w, h: h, kind: kind, zone: zone, lift: lift };
    landmarks.push(lm);
    reserveSightline(spot.eye, spot.x, spot.y, w, h);

    // Collision. THE CRANE HAS NONE AT ALL (2026-09-20, on request: "make it
    // so you can walk under the gantry crane, it would look more correct
    // visually this way"). It was its two legs; the whole thing is overhead
    // now, which is what it looks like and what a gantry is -- you walk
    // under a gantry, including past its legs, and a 30px block you cannot
    // see the front of was the one part that read as a wall.
    //
    // Nothing else changes: it still reserves ground so other things route
    // around it, and it still draws over the boundary wall.
    if (kind !== "crane") {
        walls.push({ x: lm.x, y: lm.y, w: w, h: h });
    }

    // 130, not 80. A landmark is a solid block, and a solid block parked
    // 80px off a wall boxes the strip between them -- measured as the
    // single biggest source of unreachable nav cells once the landmarks
    // went in (9 -> 105 across 25 seeds). Wider clearance also reads
    // better: a hero structure wants room around it.
    //
    // THE CRANE IS THE EXCEPTION and reserves only its LEGS. A gantry crane
    // spans a container yard -- that is what a gantry crane is for -- so
    // containers belong under its beam, and reserving the whole 420x150
    // span took roughly a third of the maze's ground and left 1.2
    // containers a map. The beam is overhead and you walk under it; only
    // the legs are collision (see addLandmark above).
    if (kind === "crane") {
        reservedRects.push({ x: lm.x - 70, y: lm.y - 70, w: 30 + 140, h: h + 140 });
        reservedRects.push({ x: lm.x + w - 30 - 70, y: lm.y - 70, w: 30 + 140, h: h + 140 });
    } else {
        // 80, not 130. It was widened to 130 on 2026-09-19 to chase nav
        // pockets and the measurement afterwards was IDENTICAL (129 cells
        // before and after), so it bought nothing -- and 130 around a
        // 110x110 silo reserves 370x370, which is most of why THE KENNELS
        // could not fit its rail cars. Re-measured after reverting.
        reservedRects.push({ x: lm.x - 80, y: lm.y - 80, w: w + 160, h: h + 160 });
    }
    claimFloor(lm.x, lm.y, w, h, 40);
    // UNIQUE floor: every landmark stands on hardstanding, which is what
    // stops it looking like it was dropped on dirt.
    if (typeof zfPatch === "function") zfPatch(lm.x - 40, lm.y - 40, w + 80, h + 80, "hardstand");
}

// ---------------------------------------------------
//   THE PERIMETER  (2026-09-19)
// ---------------------------------------------------
// The map used to have NO perimeter at all -- buildZoneWalls emitted only
// the interior boundaries, so the world's edge was invisible and zombies
// spawned past it and walked in. Two edge conditions now:
//
//   NORTH and WEST -- deep forest. A band of scattered trunks INSIDE the
//     map, no wall. Sightlines break up, movement stays free.
//   SOUTH and EAST -- a real concrete wall, with the escape gate set into
//     the southern one (which is most of what makes the endgame legible:
//     the heavy gate and its chainlink used to sit in a wall that did not
//     exist, at the bottom of a map that simply stopped).
//
// THE THING THIS CAN BREAK, and the reason for both halves: walling two
// sides removes half the spawn frontier. A team camped in the far
// south-east is ~3,900px from the nearest forest, and contact time would
// go up exactly where the map is hardest -- the same trap the zone
// cooldown already hit once (CLAUDE.md records a permanent "visited" flag
// doubling contact to 25.6s). So:
//
//   1. THE FOREST IS INSIDE THE MAP, which makes it a spawn RESERVOIR with
//      real cover rather than "somewhere past the edge", and gives
//      z.entered less to do.
//   2. CULVERTS through the hard wall, at PERIM_CULVERT width -- well over
//      the 78px nav guarantee -- so the frontier stays wrapped all the way
//      around. A culvert also telegraphs a flank far better than the map
//      edge ever did: you can see the thing you are about to be hit from.
const FOREST_BAND = 240;          // how deep the forest reaches in
const FOREST_TRUNK = 26;
const PERIM_CULVERT = 120;        // clear width of a culvert mouth
// 1200, not 900 (2026-09-20). Reported as zombies wedging while pathing
// round the south-east hard corner, and the openings there making the area
// undefendable -- both of which are the same thing: too many mouths, too
// close together, in the one corner where two walls meet and a zombie
// coming through one can be pushed into the other.
//
// A wider spacing is one fewer mouth a side. Culverts are not free to
// remove -- they exist because walling two sides halves the spawn frontier
// (see buildPerimeter) -- so the frontier was re-measured afterwards rather
// than assumed.
const PERIM_CULVERT_GAP = 1200;
// No mouth within this of the south-east corner itself, where the two hard
// walls meet. That corner is the one place a zombie emerging from a culvert
// has a second wall immediately beside it.
const PERIM_CORNER_CLEAR = 700;
let forestRects = [];             // trunks, for the draw
let culverts = [];                // {x,y,w,h,side} mouths in the hard wall

function buildPerimeter() {
    forestRects = [];
    culverts = [];

    // --- SOUTH and EAST: a real wall, with culverts ---
    // Laid as segments between the culvert mouths, so the mouths are holes
    // in a wall rather than a wall drawn over holes.
    buildPerimeterWall(false, WORLD_H - WALL_T, 0, WORLD_W, "south");
    buildPerimeterWall(true, WORLD_W - WALL_T, 0, WORLD_H, "east");
    buildEscapeOpening();

    // --- NORTH and WEST: forest ---
    // Trunks are solid, so they break sightlines by being solid -- no third
    // notion of solidity, the same reasoning that keeps the strip curtains
    // in COLD STORAGE decorative and the container maze made of containers.
    plantForest(0, 0, WORLD_W, FOREST_BAND);                    // north
    plantForest(0, FOREST_BAND, FOREST_BAND, WORLD_H - FOREST_BAND); // west
}

function buildPerimeterWall(vertical, fixed, start, span, side) {
    // Mouths first, then the wall between them.
    const mouths = [];
    const n = Math.max(2, Math.round(span / PERIM_CULVERT_GAP));
    const slot = span / n;
    for (let i = 0; i < n; i++) {
        const free = Math.max(0, slot - PERIM_CULVERT - 120);
        const at = start + i * slot + 60 + MP.random() * free;
        // Never across the escape: that gate IS the way out and a culvert
        // beside it would read as a second one.
        if (side === "south" && escapeRect &&
            at < escapeRect.x + escapeRect.w + 120 && at + PERIM_CULVERT > escapeRect.x - 120) continue;
        // Never near the south-east corner (2026-09-20) -- see
        // PERIM_CORNER_CLEAR.
        if (side === "south" && at + PERIM_CULVERT > WORLD_W - PERIM_CORNER_CLEAR) continue;
        if (side === "east" && at + PERIM_CULVERT > WORLD_H - PERIM_CORNER_CLEAR) continue;
        mouths.push(at);
    }

    let at = start;
    for (let i = 0; i < mouths.length; i++) {
        const m = mouths[i];
        if (m > at) pushPerimSeg(vertical, fixed, at, m - at);
        culverts.push(vertical
            ? { x: fixed, y: Math.round(m), w: WALL_T, h: PERIM_CULVERT, side: side }
            : { x: Math.round(m), y: fixed, w: PERIM_CULVERT, h: WALL_T, side: side });
        at = m + PERIM_CULVERT;
    }
    if (at < start + span) pushPerimSeg(vertical, fixed, at, start + span - at);
}

// THE WAY OUT IS A HOLE IN THE WALL (2026-09-20).
//
// Reported as: on the win sequence the player appears to fly OVER the
// perimeter wall. They did -- the south wall ran straight across behind the
// escape gate, and the walk-out is a DRAW offset, so the sprite passed over
// solid masonry on its way off screen.
//
// So the wall genuinely opens below the gate, a little wider than the gate
// itself, with a COLUMN either side of the opening. The columns are what
// stop it reading as a missing chunk of wall: a gap with jambs is a
// gateway, a gap without them is damage.
//
// Gameplay note: this opening is BEHIND the gate, which stays shut for the
// whole run, so it is not a way in for anything. It is scenery that the
// win sequence happens to travel through.
const ESCAPE_JAMB = 26;

function buildEscapeOpening() {
    if (!escapeRect) return;
    const y = WORLD_H - WALL_T;
    const pad = 16;
    const x0 = escapeRect.x - pad;
    const x1 = escapeRect.x + escapeRect.w + pad;

    // Drop any south wall segment overlapping the opening, and re-lay the
    // parts of it that fall outside.
    for (let i = walls.length - 1; i >= 0; i--) {
        const w = walls[i];
        if (w.y !== y || w.h !== WALL_T) continue;
        if (w.x + w.w <= x0 || w.x >= x1) continue;
        const leftLen = x0 - w.x;
        const rightStart = x1;
        const rightLen = (w.x + w.w) - x1;
        walls.splice(i, 1);
        if (leftLen > 4) walls.push({ x: w.x, y: y, w: Math.round(leftLen), h: WALL_T });
        if (rightLen > 4) walls.push({ x: Math.round(rightStart), y: y, w: Math.round(rightLen), h: WALL_T });
    }

    // A column each side, standing proud of the wall line so they read as
    // jambs rather than as more wall.
    walls.push({ x: Math.round(x0 - ESCAPE_JAMB), y: y - 14, w: ESCAPE_JAMB, h: WALL_T + 28, column: true });
    walls.push({ x: Math.round(x1), y: y - 14, w: ESCAPE_JAMB, h: WALL_T + 28, column: true });
    escapeOpening = { x: Math.round(x0), y: y - 14, w: Math.round(x1 - x0), h: WALL_T + 28 };
}
let escapeOpening = null;

function pushPerimSeg(vertical, fixed, at, len) {
    if (len < 4) return;
    walls.push(vertical
        ? { x: fixed, y: Math.round(at), w: WALL_T, h: Math.round(len) }
        : { x: Math.round(at), y: fixed, w: Math.round(len), h: WALL_T });
}

// Scattered trunks at low density. Never near a boundary opening, the
// keep, the sluice or anything already reserved -- the forest is cover,
// not a second maze, and a trunk in a doorway is a nav problem.
function plantForest(x0, y0, w, h) {
    const target = Math.round((w * h) / 26000);
    for (let i = 0; i < target; i++) {
        for (let tries = 0; tries < 8; tries++) {
            const x = Math.round(x0 + 20 + MP.random() * Math.max(1, w - 40 - FOREST_TRUNK));
            const y = Math.round(y0 + 20 + MP.random() * Math.max(1, h - 40 - FOREST_TRUNK));
            const box = { x: x - 70, y: y - 70, w: FOREST_TRUNK + 140, h: FOREST_TRUNK + 140 };
            if (clashesReserved(box)) continue;
            if (blockedAtStatic(x - 40, y - 40, FOREST_TRUNK + 80)) continue;
            const t = { x: x, y: y, w: FOREST_TRUNK, h: FOREST_TRUNK, trunk: true };
            walls.push(t);
            forestRects.push(t);
            // A trunk reserves its own clearance, so the next one cannot
            // land beside it. Without this, clashesReserved never saw the
            // trunks (they are walls, not reserved rects) and they could
            // clump into a short wall -- which against a boundary makes a
            // pocket nothing can path into.
            reservedRects.push({ x: x - 86, y: y - 86, w: FOREST_TRUNK + 172, h: FOREST_TRUNK + 172 });
            break;
        }
    }
}

// True in the forest band, which is where off-map spawning now comes from.
function inForest(x, y) {
    return x < FOREST_BAND || y < FOREST_BAND;
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
    if (typeof zfPatch === "function") zfPatch(kx, ky, KEEP_W, KEEP_H, "centre");
    ammoCrates.push({ x: kx + Math.round(KEEP_W / 2) - 16, y: ky + Math.round(KEEP_H / 2) - 16, size: 32, uses: 4 });

    // The field manual: a terminal in the keep explaining every weapon,
    // card, pickup and enemy. Placed at the centre of the starting area
    // because that is where a new player already is.
    codexRect = { x: kx + Math.round(KEEP_W / 2) - 30, y: ky + 54, w: 60, h: 40 };

    // THE INTENSIFY SWITCH. Moved to the keep's EAST CORNER on request
    // (2026-09-20); it was centred on the south wall. Still the far side of
    // the room from the manual, which is what keeps the two F targets
    // unmistakable -- interactWith tests rects in order and the manual is
    // first -- and a lever in a corner reads more like plant than one
    // centred on a wall like a light switch.
    intensifyRect = { x: kx + KEEP_W - 96, y: ky + KEEP_H - 88, w: 52, h: 44 };

    traps.push({ x: gx, y: ky - 8, w: gap, h: 52, cost: 500, armedUntil: 0, readyAt: 0 });
    traps.push({ x: gx, y: ky + KEEP_H - 44, w: gap, h: 52, cost: 500, armedUntil: 0, readyAt: 0 });
}

// --- per-zone contents -----------------------------------------------
// The funnel hall goes FIRST in its zone: it is the largest thing any zone
// has to fit (560x280 plus clearance), and every piece placed after it --
// corridors, outpost, generator, buildings -- now checks reservedRects, so
// they route around it rather than through it. The first three did not
// check reservedRects at all before 2026-09-18, which is half of how the
// sluice room came to have walls in it.
// The funnel halls go in BEFORE anything else in their sector -- they are
// the largest single thing any sector has to fit (560x280 plus clearance)
// and the endgame does not work without them. Hoisted out of
// buildZoneContents 2026-09-19 so the landmarks can be placed between the
// two: halls first, then hero structures, then the generic buildings that
// route around both.
function buildPlannedHalls() {
    for (let i = 0; i < hallPlan.length; i++) {
        const z = hallPlan[i];
        if (z === undefined || !zoneInfo[z]) continue;
        buildFunnelHall(zoneBounds(z), z, i + 1);
    }
}

function buildZoneContents() {
    for (let z = 0; z < ZONE_COUNT; z++) {
        const info = zoneInfo[z];
        if (!info) continue;
        const tpl = info.tpl;
        const b = zoneBounds(z);

        if (tpl.corridors) buildCorridors(b, z);
        if (tpl.outpost) buildOutpost(b, z);
        if (tpl.generator) buildGenerator(b, z);

        buildZoneBuildings(b, sectorBuildingCount(tpl), z);

        // Every loose item now passes the sector id, so an irregular sector
        // stops donating its crates and barrels to whoever owns the rest of
        // its bounding box.
        for (let i = 0; i < tpl.crates; i++) {
            const spot = findOpenSpot(b, 32, 0, z);
            if (!spot) continue;
            ammoCrates.push({ x: spot.x, y: spot.y, size: 32, uses: 3 });
            claimFloor(spot.x, spot.y, 32, 32, 30);
        }
        for (let i = 0; i < tpl.barrels; i++) {
            const spot = findOpenSpot(b, 24, 0, z);
            if (!spot) continue;
            barrels.push({ x: spot.x, y: spot.y, size: 24, alive: true });
            claimFloor(spot.x, spot.y, 24, 24, 16);
        }
    }
}

function clashesReserved(r) {
    for (let j = 0; j < reservedRects.length; j++) {
        if (rectsOverlap(r, reservedRects[j])) return true;
    }
    return false;
}

// IDEA 36: long straight sightlines, so the sniper has somewhere its
// range is actually visible. Paired with cutting its range to 1200 in
// zombie-entities.js -- 1900px of reach on a 960px-wide view was an
// advantage you could never see.
//
// A lane that would cross reserved ground (the sluice, a funnel hall, a
// doorway approach) is re-rolled, then dropped. Before 2026-09-18 lanes
// were laid blind, and a SPILLWAY or LAUNDRY in the sluice's zone ran a
// wall straight through the funnel room.
function buildCorridors(b, z) {
    const lanes = 2 + Math.floor(MP.random() * 2);
    for (let i = 0; i < lanes; i++) {
        for (let tries = 0; tries < 16; tries++) {
            const y = b.y + 200 + MP.random() * (b.h - 400);
            const len = b.w * (0.5 + MP.random() * 0.3);
            const x = b.x + 120 + MP.random() * Math.max(1, b.w - 240 - len);
            const res = { x: x - 60, y: y - 90, w: len + 120, h: 180 };
            // Both ends inside the sector, or a sightline lane runs out
            // through a neighbour's ground (2026-09-19).
            if (z !== undefined && (!inZone(x, y, z) || !inZone(x + len, y, z))) continue;
            if (clashesReserved(res)) continue;
            walls.push({ x: Math.round(x), y: Math.round(y), w: Math.round(len), h: WALL_T });
            reservedRects.push(res);
            break;
        }
    }
}

// IDEA 31: v2 gave you exactly one defensible structure on the whole map
// (the keep), so every fight collapsed into "retreat to the middle".
// Each outer zone now has a small holdable building of its own -- two
// entrances and a window, the keep's shape at a third the size.
//
// Placed where it fits, or not at all -- see buildCorridors for why.
function buildOutpost(b, z) {
    const ow = 260;
    const oh = 190;
    let ox = 0, oy = 0, found = false;
    for (let tries = 0; tries < 40 && !found; tries++) {
        ox = Math.round(b.x + 200 + MP.random() * (b.w - 400 - ow));
        oy = Math.round(b.y + 160 + MP.random() * (b.h - 320 - oh));
        if (!inZone(ox, oy, z) || !inZone(ox + ow, oy + oh, z)) continue;
        found = !clashesReserved({ x: ox - 90, y: oy - 90, w: ow + 180, h: oh + 180 });
    }
    if (!found) return;
    const gap = 112;              // > 2*NAV_CELL+2*NAV_PAD (78), so even the ULTRA follows you in
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

    if (typeof zfPatch === "function") zfPatch(ox, oy, ow, oh, zfInteriorAt(ox + ow / 2, oy + oh / 2));
    reservedRects.push({ x: ox - 90, y: oy - 90, w: ow + 180, h: oh + 180 });
    zoneInfo[z].outpost = { x: ox, y: oy, w: ow, h: oh };
}

// Every run needs exactly one generator, so it uses the placement that
// cannot come back empty, and it stays out of reserved ground.
function buildGenerator(b, z) {
    const spot = findOpenSpotSure(b, 70, 140, z);
    generatorRect = { x: spot.x, y: spot.y, w: 70, h: 70, cost: 2500 };
    // UNIQUE: the generator's plinth, with the cable runs converging on it
    // drawn over the top by drawGenerator.
    if (typeof zfPatch === "function") zfPatch(spot.x - 60, spot.y - 60, 190, 190, "hardstand");
    reservedRects.push({ x: spot.x - 140, y: spot.y - 140, w: 350, h: 350 });
    claimFloor(spot.x, spot.y, 70, 70, 60);
}

// IDEA 32: every nook gets a small opening in the middle of the wall
// opposite its missing side. Flow-field zombies funnel relentlessly, and
// a sealed three-walled nook had become a place to be cornered and
// killed with no way out.
// Must exceed the nav grid's guaranteed-navigable width (2*NAV_CELL +
// 2*NAV_PAD), or zombies cannot path through the escape hole and the nook
// is a dead end again in everything but appearance. 74 cleared the old 70;
// NAV_PAD 19 makes the guarantee 78, so the hole is 90 (2026-09-18).
const NOOK_HOLE = 90;

// ---------------------------------------------------
//   BUILDINGS THAT READ AS BUILDINGS  (2026-09-20)
// ---------------------------------------------------
// Asked for: "id like buildings to feel more like BUILDINGS instead of just
// blocks with alternate flooring material inside. buildings should
// correspond with use of sector in some instances. they should have stairs
// (graphical top down) and internal geometry that implies this is clearly a
// building. tables, chairs, windows (maybe 1 wide - breakable by zombies),
// entrance & exit are doorway, and geometry is slightly more complex than
// box with symmetrical exit/entrance."
//
// What a building is now:
//
//   - an ASYMMETRIC footprint: a rectangle with a bite out of one corner,
//     so no two walls are the same length and the outline is not a box
//   - a DOORWAY in (BUILD_DOOR wide), and a separate doorway OUT on a
//     different wall -- never the opposite one, so you cannot see through
//   - 1-wide WINDOWS, which are BARRICADES, so zombies break in through
//     them exactly as they do at a sector boundary. This is the part with
//     real gameplay in it: a building is now enterable by the horde.
//   - an INTERNAL WALL splitting it into two rooms, with its own doorway
//   - FURNITURE and STAIRS, drawn only
//
// FURNITURE IS DRAWN, NEVER SOLID, and that is deliberate. A 30px table in
// a room reachable through a 90px door is precisely the geometry that makes
// nav pockets, and this map has already lost 579 cells to unbroken pipe
// walls and 488 to clumped trunks. Chairs you can walk through cost nothing
// and read the same from above.
//
// Every opening clears the 78px nav guarantee (CLAUDE.md rule 3).
const BUILD_DOOR = 92;
const BUILD_WINDOW = 44;         // "1 wide"
let buildingRooms = [];          // {x,y,w,h,kind,decor:[...]} for the draw

// Which kind of building a sector puts up. `corresponds with use of sector`.
const SECTOR_BUILDING = {
    cold:    "store",     // racking and a counter
    kennel:  "office",    // desks
    yard:    "office",
    motor:   "workshop",  // benches
    pump:    "workshop",
    turbine: "workshop",
    spill:   "store",
    sluice:  "store",
    centre:  "office"
};

function buildZoneBuildings(b, count, z) {
    const key = (zoneInfo[z] && zoneInfo[z].tpl) ? zoneInfo[z].tpl.key : "centre";
    const kind = SECTOR_BUILDING[key] || "office";
    let made = 0;
    let attempts = 0;
    while (made < count && attempts < count * 40) {
        attempts++;
        const bw = 190 + MP.random() * 150;
        const bh = 170 + MP.random() * 140;
        const bx = b.x + 110 + MP.random() * Math.max(1, b.w - 220 - bw);
        const by = b.y + 110 + MP.random() * Math.max(1, b.h - 220 - bh);

        // All four corners in the sector. A building is the thing most
        // likely to straddle a painted boundary, and one that does reads as
        // a wall dropped across the edge of two sectors.
        if (z !== undefined && (!inZone(bx, by, z) || !inZone(bx + bw, by, z) ||
                                !inZone(bx, by + bh, z) || !inZone(bx + bw, by + bh, z))) continue;
        if (nearZoneBoundary(bx, by, bw, bh)) continue;
        const box = { x: bx - 95, y: by - 95, w: bw + 190, h: bh + 190 };
        if (clashesReserved(box)) continue;

        makeBuilding(Math.round(bx), Math.round(by), Math.round(bw), Math.round(bh), kind);
        made++;
    }
}

function makeBuilding(bx, by, bw, bh, kind) {
    // THE BITE. One corner is cut back, which is what stops the outline
    // being a box -- and it is cut from the OUTSIDE, so the inside stays a
    // simple shape the flow field is happy with.
    const biteW = Math.round(bw * (0.26 + MP.random() * 0.16));
    const biteH = Math.round(bh * (0.24 + MP.random() * 0.16));
    const biteCorner = Math.floor(MP.random() * 4);   // 0 NW, 1 NE, 2 SE, 3 SW

    // Entrance and exit on DIFFERENT, non-opposite walls.
    const entry = Math.floor(MP.random() * 4);        // 0 N, 1 E, 2 S, 3 W
    const exitWall = (entry + (MP.random() < 0.5 ? 1 : 3)) % 4;

    const room = { x: bx, y: by, w: bw, h: bh, kind: kind, decor: [],
                   bite: { corner: biteCorner, w: biteW, h: biteH } };

    // --- the shell, wall by wall, with its openings punched out ---
    for (let side = 0; side < 4; side++) {
        const isDoor = (side === entry || side === exitWall);
        // The bite removes part of two of the four walls.
        buildBuildingWall(room, side, isDoor);
    }

    // --- the internal wall: two rooms, one doorway between them ---
    const splitVertical = bw > bh;
    const t = 0.38 + MP.random() * 0.24;
    if (splitVertical) {
        const sx = Math.round(bx + bw * t);
        const gapY = Math.round(by + WALL_T + MP.random() * Math.max(1, bh - 2 * WALL_T - BUILD_DOOR));
        pushIfClear({ x: sx, y: by + WALL_T, w: WALL_T, h: gapY - (by + WALL_T) });
        pushIfClear({ x: sx, y: gapY + BUILD_DOOR, w: WALL_T, h: (by + bh - WALL_T) - (gapY + BUILD_DOOR) });
    } else {
        const sy = Math.round(by + bh * t);
        const gapX = Math.round(bx + WALL_T + MP.random() * Math.max(1, bw - 2 * WALL_T - BUILD_DOOR));
        pushIfClear({ x: bx + WALL_T, y: sy, w: gapX - (bx + WALL_T), h: WALL_T });
        pushIfClear({ x: gapX + BUILD_DOOR, y: sy, w: (bx + bw - WALL_T) - (gapX + BUILD_DOOR), h: WALL_T });
    }

    // --- what is inside ---
    addBuildingDecor(room, splitVertical);

    if (typeof zfPatch === "function") zfPatch(bx, by, bw, bh, zfInteriorAt(bx + bw / 2, by + bh / 2));
    reservedRects.push({ x: bx, y: by, w: bw, h: bh });
    buildingRooms.push(room);
}

// One side of the shell: solid, minus a doorway if this side has one, minus
// a 1-wide window or two, minus whatever the bite has taken.
function buildBuildingWall(room, side, isDoor) {
    const bx = room.x, by = room.y, bw = room.w, bh = room.h;
    const horiz = (side === 0 || side === 2);
    const len = horiz ? bw : bh;

    // Openings along this wall, as [offset, size] pairs.
    const cuts = [];
    if (isDoor) {
        const at = Math.round(WALL_T + MP.random() * Math.max(1, len - 2 * WALL_T - BUILD_DOOR));
        cuts.push([at, BUILD_DOOR, "door"]);
    }
    // One or two windows, never overlapping the doorway.
    const wantWindows = 1 + (MP.random() < 0.5 ? 1 : 0);
    for (let i = 0; i < wantWindows; i++) {
        const at = Math.round(26 + MP.random() * Math.max(1, len - 52 - BUILD_WINDOW));
        let clash = false;
        for (let c = 0; c < cuts.length; c++) {
            if (at < cuts[c][0] + cuts[c][1] + 20 && at + BUILD_WINDOW + 20 > cuts[c][0]) clash = true;
        }
        if (!clash) cuts.push([at, BUILD_WINDOW, "window"]);
    }
    cuts.sort(function (a, b) { return a[0] - b[0]; });

    let at = 0;
    for (let i = 0; i < cuts.length; i++) {
        const c = cuts[i];
        if (c[0] > at) pushWallSpan(room, side, at, c[0] - at);
        if (c[2] === "window") pushWindowSpan(room, side, c[0], c[1]);
        at = c[0] + c[1];
    }
    if (at < len) pushWallSpan(room, side, at, len - at);
}

function sideRect(room, side, at, len) {
    const bx = room.x, by = room.y, bw = room.w, bh = room.h;
    if (side === 0) return { x: bx + at, y: by, w: len, h: WALL_T };
    if (side === 2) return { x: bx + at, y: by + bh - WALL_T, w: len, h: WALL_T };
    if (side === 3) return { x: bx, y: by + at, w: WALL_T, h: len };
    return { x: bx + bw - WALL_T, y: by + at, w: WALL_T, h: len };
}

// A span of shell wall, unless the bite has removed it.
function pushWallSpan(room, side, at, len) {
    const r = sideRect(room, side, at, len);
    if (r.w < 3 || r.h < 3) return;
    if (inBuildingBite(room, r)) return;
    walls.push(r);
}

// A WINDOW IS A BARRICADE. Same rules as a boundary window: players never
// pass, zombies chew through, and it re-boards at the breather. That is
// what makes a building enterable by the horde rather than a safe box.
function pushWindowSpan(room, side, at, len) {
    const r = sideRect(room, side, at, len);
    if (r.w < 3 || r.h < 3) return;
    if (inBuildingBite(room, r)) return;
    r.hp = 60;
    r.maxHp = 60;
    r.chewUntil = 0;
    barricades.push(r);
}

function pushIfClear(r) {
    if (r.w > 3 && r.h > 3) walls.push(r);
}

// The cut-back corner, in world coordinates.
function inBuildingBite(room, r) {
    const b = room.bite;
    if (!b) return false;
    const x = b.corner === 1 || b.corner === 2 ? room.x + room.w - b.w : room.x;
    const y = b.corner === 2 || b.corner === 3 ? room.y + room.h - b.h : room.y;
    return rectsOverlap(r, { x: x, y: y, w: b.w, h: b.h });
}

// Stairs, tables, chairs, benches, racking. DRAWN ONLY -- see the header.
function addBuildingDecor(room, splitVertical) {
    const d = room.decor;
    const pad = WALL_T + 14;
    const ix = room.x + pad, iy = room.y + pad;
    const iw = room.w - pad * 2, ih = room.h - pad * 2;
    if (iw < 40 || ih < 40) return;

    // Stairs: every building has one flight, against a wall, drawn as
    // treads from above. It is the single clearest "this has an upstairs".
    const stW = Math.min(46, Math.round(iw * 0.34));
    const stH = Math.min(74, Math.round(ih * 0.44));
    d.push({ type: "stairs", x: Math.round(ix), y: Math.round(iy), w: stW, h: stH,
             down: MP.random() < 0.5 });

    const n = 2 + Math.floor(MP.random() * 3);
    for (let i = 0; i < n; i++) {
        const t = room.kind === "workshop" ? "bench"
                : room.kind === "store" ? "rack" : "desk";
        const w = t === "rack" ? 20 : 46 + Math.round(MP.random() * 22);
        const h = t === "rack" ? 70 + Math.round(MP.random() * 40) : 28;
        const x = Math.round(ix + stW + 10 + MP.random() * Math.max(1, iw - stW - 20 - w));
        const y = Math.round(iy + MP.random() * Math.max(1, ih - h));
        d.push({ type: t, x: x, y: y, w: w, h: h });
        // A desk or a bench gets a chair; racking does not.
        if (t !== "rack" && MP.random() < 0.7) {
            d.push({ type: "chair", x: x + 12 + Math.round(MP.random() * 20),
                     y: y + h + 6, w: 16, h: 16 });
        }
    }
}

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

// True if the rect is within `margin` of ANY sector boundary. It used to
// test the 3x3 lattice lines; with painted sectors the boundaries are
// wherever two different ids meet, so this asks the paint directly: grow
// the rect by the margin and see whether it covers more than one sector.
function nearZoneBoundary(x, y, w, h) {
    const margin = 150;
    const c0 = clamp(Math.floor((x - margin) / ZONE_CELL_W), 0, ZONE_COLS_FINE - 1);
    const c1 = clamp(Math.floor((x + w + margin) / ZONE_CELL_W), 0, ZONE_COLS_FINE - 1);
    const r0 = clamp(Math.floor((y - margin) / ZONE_CELL_H), 0, ZONE_ROWS_FINE - 1);
    const r1 = clamp(Math.floor((y + h + margin) / ZONE_CELL_H), 0, ZONE_ROWS_FINE - 1);
    const first = ZONE_PAINT[r0 * ZONE_COLS_FINE + c0];
    for (let rr = r0; rr <= r1; rr++) {
        for (let cc = c0; cc <= c1; cc++) {
            if (ZONE_PAINT[rr * ZONE_COLS_FINE + cc] !== first) return true;
        }
    }
    return false;
}

// Floor items (crates, barrels, wall-buys, perk stations, the generator)
// claim their footprint plus a margin, so the next one placed does not land
// on top of it. They used to be able to: findOpenSpot only looked at walls,
// so a perk station could sit on a wall-buy and one F press meant two
// different purchases depending on which list was checked first.
function claimFloor(x, y, w, h, pad) {
    keepClearRects.push({ x: x - pad, y: y - pad, w: w + pad * 2, h: h + pad * 2 });
}

function onClearFloor(x, y, w, h) {
    for (let i = 0; i < keepClearRects.length; i++) {
        const r = keepClearRects[i];
        if (rectIntersect(x, y, w, h, r.x, r.y, r.w, r.h)) return false;
    }
    return true;
}

// `resPad` > 0 also keeps the spot that far out of reservedRects -- used by
// the generator, which must not end up in a doorway or on the sluice.
function spotOk(x, y, size, resPad) {
    if (blockedAtStatic(x - 20, y - 20, size + 40)) return false;
    if (!onClearFloor(x, y, size, size)) return false;
    if (resPad > 0 && clashesReserved({ x: x - resPad, y: y - resPad, w: size + resPad * 2, h: size + resPad * 2 })) return false;
    return true;
}

// `zone`, when given, is the sector the spot must actually be IN. The
// bounding box of a painted sector is a superset of its ground -- the
// Blockhouse's box is 58% somebody else's -- so without this a wall-buy
// or a perk station lands in the wrong sector and the map lies about
// where its guns are (2026-09-19).
function findOpenSpot(b, size, resPad, zone) {
    for (let tries = 0; tries < 80; tries++) {
        const x = Math.round(b.x + 120 + MP.random() * (b.w - 240 - size));
        const y = Math.round(b.y + 120 + MP.random() * (b.h - 240 - size));
        if (zone !== undefined && !inZone(x + size / 2, y + size / 2, zone)) continue;
        if (!spotOk(x, y, size, resPad || 0)) continue;
        return { x: x, y: y };
    }
    return null;
}

// For things a run cannot do without -- the generator, every wall-buy,
// every perk station. A null from findOpenSpot used to mean a station was
// silently skipped (placeCardStations: `if (!spot) continue`), which is one
// of the two ways OVERDRIVE could be missing from a map. This tries the
// random draw, then walks the zone on a grid, and only then relaxes: first
// the reserved-ground rule, then the item-overlap rule. It always returns a
// spot that is clear of walls unless the zone is literally solid.
function findOpenSpotSure(b, size, resPad, zone) {
    const r = findOpenSpot(b, size, resPad, zone);
    if (r) return r;
    // The sector is honoured on the first three passes and only dropped on
    // the last one -- a spot in the wrong sector still beats a spot inside
    // a wall, which is what this function exists to prevent.
    const passes = [resPad || 0, 0, -1, -2];
    for (let pass = 0; pass < passes.length; pass++) {
        const wantZone = (pass < 3) ? zone : undefined;
        for (let y = b.y + 130; y <= b.y + b.h - 130 - size; y += 30) {
            for (let x = b.x + 130; x <= b.x + b.w - 130 - size; x += 30) {
                if (wantZone !== undefined && !inZone(x + size / 2, y + size / 2, wantZone)) continue;
                if (passes[pass] >= 0) {
                    if (spotOk(x, y, size, passes[pass])) return { x: x, y: y };
                } else if (!blockedAtStatic(x - 20, y - 20, size + 40)) {
                    return { x: x, y: y };
                }
            }
        }
    }
    // Last resort: the middle of one of the sector's own cells, never the
    // middle of its bounding box (which for a cross is not in it at all).
    const c = randomPointInZone(zone !== undefined ? zone : 0, 80);
    return { x: Math.round(c.x - size / 2), y: Math.round(c.y - size / 2) };
}

// --- WHERE THINGS LIVE (2026-09-19) ----------------------------------
// "Make perk / spawn locations consistent for guns / perks / silos in
// areas that make sense (even if sometimes perks don't spawn)."
//
// There used to be TWO layers of randomness stacked on each other:
// templates were shuffled into zone slots (assignZones), and then guns and
// perks were shuffled across zone INDICES. So the sniper was in a corridor
// zone by design and everything else was a coin flip -- the same map twice
// running put the shotgun in two unrelated places, and no zone was ever
// worth remembering.
//
// Now a gun and a perk belong to a TEMPLATE, not to a zone index. The zone
// still moves around the map, but THE KENNELS always sells the shotgun,
// wherever the kennels turn out to be. That is what makes a place worth
// naming, and it is the same reasoning that gave the sniper its corridor in
// the first place.
//
// Only 8 of the 11 outer templates are on any given map, so each entry is
// an ORDERED PREFERENCE, first one present wins.
const GUN_HOMES = [
    // key,      cost, preferred templates (in order)
    ["sniper",   4200, ["spill", "laundry"]],           // the long sightlines; also the corridors fallback below
    ["shotgun",  2600, ["kennel", "cold", "annex"]],    // 17 buildings: the tightest ground on the map
    ["flamer",   5800, ["pump", "laundry", "spill"]],   // fuel and pumps
    ["rocket",   7500, ["slag", "pool", "motor"]],      // 12 barrels; the most explosive zone there is
    ["smg",      3400, ["motor", "ticket", "letter"]],
    ["rifle",    1500, ["cold", "letter", "ticket"]]
];

// Pick the first zone whose template key is in `prefs` and is still free.
// Returns -1 if none of them is on this map.
function zoneForTemplates(free, prefs) {
    for (let p = 0; p < prefs.length; p++) {
        for (let i = 0; i < free.length; i++) {
            if (zoneInfo[free[i]] && zoneInfo[free[i]].tpl.key === prefs[p]) return free[i];
        }
    }
    return -1;
}

function placeWallBuys() {
    // Straight off the sector table now (2026-09-19). No shuffle, no
    // preference list, no fallback: THE KENNELS sells the shotgun, every
    // run, because a sector is only worth remembering if what is in it is
    // worth remembering. THE YARD carries TWO -- it is the biggest sector
    // and the furthest from the keep -- and three sectors carry none.
    // Totals are still six, so no balance number moved.
    for (let i = 0; i < SECTORS.length; i++) {
        const sec = SECTORS[i];
        for (let g = 0; g < sec.guns.length; g++) {
            addWallBuy(sec.id, sec.guns[g], GUN_COSTS[sec.guns[g]]);
        }
    }
}

const GUN_COSTS = {
    rifle: 1500, shotgun: 2600, smg: 3400, sniper: 4200, flamer: 5800, rocket: 7500
};

function addWallBuy(zone, weapon, cost) {
    const b = zoneBounds(zone);
    // The sure finder: the old `|| { x: b.x + 200, ... }` fallback could put
    // a wall-buy inside a wall.
    const spot = findOpenSpotSure(b, 110, 0, zone);
    wallBuys.push({ x: spot.x, y: spot.y, w: 110, h: 28, weapon: weapon, cost: cost, zone: zone });
    reservedRects.push({ x: spot.x - 70, y: spot.y - 70, w: 250, h: 170 });
    claimFloor(spot.x, spot.y, 110, 28, 40);
}

// --- perk stations ---------------------------------------------------
// Deliberately separate from weapon wall-buys: expensive, and inert until
// the generator is running.
//
// PLAYTEST 2026-09-18: "OVERDRIVE didn't spawn on the play tested maps."
// Two causes, both fixed here. The draw was 4 of 6 perks with no
// guarantee, so any one perk was missing from a third of maps; and a
// station whose findOpenSpot came back null was silently skipped. Now:
// one station in every outer zone (8), OVERDRIVE always among them, the
// other 7 drawn from the remaining 10, and placement that cannot fail. The
// three perks a map leaves out are named in the field manual and announced
// when the generator first comes on (absentCardKeys).
// Same treatment as the guns (2026-09-19): a perk belongs to a TEMPLATE, so
// SALVAGE is at the slag heap on every map that has a slag heap.
//
// The difference from guns: A PERK IS ALLOWED TO BE ABSENT. There are 11
// perks and 8 stations, so three are missing from any map whatever we do --
// and the brief said so outright ("even if sometimes perks don't spawn").
// absentCardKeys() already names them in the field manual and announces them
// when power first comes on, so a missing perk is information rather than a
// mystery. OVERDRIVE is still the one exception (CARD_ALWAYS), and it goes
// to TURBINE HALL, which is the one template that is always placed.
const PERK_HOMES = {
    overdrive: ["turbine"],                 // the power: always on the map
    salvage:   ["slag", "motor", "cold"],   // scrap out of scrap
    conductor: ["pump", "turbine", "spill"],// electrical
    laststand: ["letter", "annex", "pool"], // the outposts -- ground you hold
    arc:       ["turbine", "pump"],
    blastcap:  ["slag", "pool"],
    skewer:    ["kennel", "laundry"],
    ricochet:  ["cold", "ticket"],
    scavenger: ["letter", "ticket", "motor"],
    decoy:     ["ticket", "annex"],
    spite:     ["pool", "kennel", "annex"]
};

function placeCardStations() {
    // Per-sector budget (SECTORS[].perks) rather than one per outer zone.
    // THE MOTOR POOL and THE YARD carry two each, THE PUMP HOUSE, THE
    // SLUICE YARD and THE BLOCKHOUSE carry none. Still eight in total.
    //
    // WHICH perk a sector sells comes from PERK_SECTOR_HOMES, in order, so
    // OVERDRIVE is always TURBINE HALL and SALVAGE is always the motor
    // pool's first slot. The seed only picks among a sector's OWN list and
    // fills any leftover slot from whatever is unplaced -- so a sector's
    // stock is recognisable without being identical every run.
    const placed = {};
    const plan = [];

    for (let i = 0; i < SECTORS.length; i++) {
        const sec = SECTORS[i];
        const home = PERK_SECTOR_HOMES[sec.key] || [];
        let taken = 0;
        for (let h = 0; h < home.length && taken < sec.perks; h++) {
            if (placed[home[h]]) continue;
            placed[home[h]] = true;
            plan.push({ zone: sec.id, card: home[h] });
            taken++;
        }
        // The sector wants more stations than it has named perks.
        for (let t = taken; t < sec.perks; t++) plan.push({ zone: sec.id, card: null });
    }

    // Fill the blanks from everything still unplaced, seeded.
    const spare = seededShuffle(CARD_KEYS.filter(function (k) { return !placed[k]; }));
    let sp = 0;
    for (let i = 0; i < plan.length; i++) {
        if (plan[i].card) continue;
        while (sp < spare.length && placed[spare[sp]]) sp++;
        if (sp >= spare.length) { plan[i].card = null; continue; }
        plan[i].card = spare[sp];
        placed[spare[sp]] = true;
        sp++;
    }

    for (let i = 0; i < plan.length; i++) {
        if (!plan[i].card) continue;
        const spot = findOpenSpotSure(zoneBounds(plan[i].zone), 60, 0, plan[i].zone);
        cardStations.push({
            x: spot.x, y: spot.y, w: 60, h: 44,
            card: plan[i].card,
            cost: CARDS[plan[i].card].cost,
            zone: plan[i].zone
        });
        reservedRects.push({ x: spot.x - 70, y: spot.y - 70, w: 200, h: 184 });
        claimFloor(spot.x, spot.y, 60, 44, 40);
    }
}

// The perks this map does NOT sell, in CARD_KEYS order.
function absentCardKeys() {
    return CARD_KEYS.filter(function (k) {
        for (let i = 0; i < cardStations.length; i++) if (cardStations[i].card === k) return false;
        return true;
    });
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
            if (!onClearFloor(x, y, 24, 24)) continue;
            barrels.push({ x: x, y: y, size: 24, alive: true });
            claimFloor(x, y, 24, 24, 16);
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

    // Funnel 1 fills most of the room's floor, set left of centre so silo 1
    // can stand against the east wall beside it, piped to it (2026-09-18:
    // "funnels should be located adjacent to each silo with piping visually
    // connecting the two"). The silo is floor, not wall, like the generator
    // and every other station, so it cannot narrow the room for anyone.
    funnels[0] = { x: sx + 190, y: sy + SLUICE_H / 2 + 20, r: 118, zone: zoneOf(sx, sy) };
    silos[0] = {
        x: sx + SLUICE_W - WALL_T - 8 - SILO_W,
        y: Math.round(funnels[0].y - SILO_H / 2),
        w: SILO_W, h: SILO_H, zone: zoneOf(sx, sy)
    };
    siloPipes[0] = pipeBetween(funnels[0], silos[0]);

    const res = { x: sx - 220, y: sy - 240, w: SLUICE_W + 440, h: SLUICE_H + 460 };
    reservedRects.push(res);
    keepClearRects.push(res);

    // The way out, dead south of the sluice.
    escapeRect = { x: Math.round(WORLD_W / 2 - 90), y: WORLD_H - 74, w: 180, h: 66 };
    const esc = { x: escapeRect.x - 160, y: escapeRect.y - 160, w: escapeRect.w + 320, h: escapeRect.h + 220 };
    reservedRects.push(esc);
    keepClearRects.push(esc);
}

// --- FUNNEL HALLS (2026-09-18) ---------------------------------------
// Funnels 2 and 3 used to be bare floor rings dropped on open ground, with
// the three silos in three OTHER zones -- "a journey rather than a button
// next to you". The playtest asked for the opposite on both counts:
// funnels in hallways, each silo beside its funnel, a pipe between them.
//
// So each gets a HALL: two long walls, open at both ends, the funnel across
// the floor near one end and its silo against a wall near the other. A
// hallway is also simply a good place to put a funnel -- the horde has to
// come down it, across the ring, which is the whole point of a funnel.
//
// The ends are 240px of open floor, three times the nav grid's 78px
// guarantee, so it can never become a pocket.
const HALL_LEN = 560;          // outer length along the hall
const HALL_WID = 280;          // outer width across it (240 inside)
const HALL_FUNNEL_R = 105;
const SILO_W = 64;
const SILO_H = 78;
let hallPlan = [];             // the zones chosen for funnel 2 and funnel 3

// Chosen before any zone is built, so the hall goes in first and
// everything else routes round it. Never the centre, never the sluice's
// zone. Corridor zones go last: their long sightline walls leave the
// least room for a 560px hall.
// 2026-09-19: the halls prefer named templates too, for the same reason the
// guns do -- a run is easier to talk about when "funnel 2 is in the pump
// house" is true more often than not. SPILLWAY and PUMP HOUSE are the
// water-handling zones, so a drain hall belongs in them; the slag heap and
// the dry pool are the next best industrial ground.
//
// The ordering rules that were already here still apply and still come
// FIRST, because they are about whether a 560px hall physically fits:
// never the centre, never the sluice's zone, and corridor zones last (their
// long sightline walls leave the least room).
const HALL_HOMES = ["spill", "pump", "slag", "pool", "motor", "turbine"];

// A hall is 560x280 plus clearance, so a sector has to be big enough to
// hold one at all. PUMP HOUSE is five cells and TURBINE HALL is a bracket
// around the keep's arm -- neither can, and discovering that through
// buildFunnelHall's fallback path (which drops the hall and leaves a bare
// funnel ring) was how a map ended up with a silo in open ground.
// HALL_MIN_CELLS excludes them up front instead.
// 9, not 10. Excluding THE YARD (it has the maze) left only THE SPILLWAY
// and THE MOTOR POOL eligible -- exactly two candidates for exactly two
// halls, so a single failure cost a hall and the rate fell to 1.88 a map.
// COLD STORAGE at 9 cells is a real third option.
// 36, not 9: a cell is a quarter of the area it was at 12x9 (2026-09-20).
// This is a count of CELLS, so it does not follow the constants and had to be
// moved by hand -- one of exactly three places in the file that did.
const HALL_MIN_CELLS = 36;

function planFunnelHalls() {
    const cands = [];
    for (let i = 0; i < ZONE_COUNT; i++) {
        if (i === Z_BLOCKHOUSE || i === SLUICE_ZONE || !zoneInfo[i]) continue;
        if (zoneCellCount(i) < HALL_MIN_CELLS) continue;
        // NOT THE YARD. Its unbroken 1200x1200 block is the container
        // maze's ground, and a funnel hall reserves 780x500 of it -- which
        // is half the maze, on the two thirds of maps that put a hall
        // there. A sector with a job does not get a second one.
        // finishFunnelsAndSilos can still fall back to the Yard if a hall
        // genuinely cannot go anywhere else.
        if (i === Z_YARD) continue;
        cands.push(i);
    }
    const order = seededShuffle(cands);
    const open = order.filter(function (z) { return !zoneInfo[z].tpl.corridors; });
    const lanes = order.filter(function (z) { return zoneInfo[z].tpl.corridors; });

    // Stable sort of the open zones by how early their template appears in
    // HALL_HOMES; anything unlisted keeps its seeded position behind them.
    const rank = function (z) {
        const i = HALL_HOMES.indexOf(zoneInfo[z].tpl.key);
        return i < 0 ? HALL_HOMES.length : i;
    };
    const preferred = open.slice().sort(function (a, b) { return rank(a) - rank(b); });
    hallPlan = preferred.concat(lanes).slice(0, 2);
}

function rectBlockedStatic(r) {
    const lists = [walls, doors, barricades];
    for (let l = 0; l < lists.length; l++) {
        const list = lists[l];
        for (let i = 0; i < list.length; i++) {
            const w = list[i];
            if (rectIntersect(r.x, r.y, r.w, r.h, w.x, w.y, w.w, w.h)) return true;
        }
    }
    return false;
}

// `zone` is the sector the hall must sit wholly inside. This replaced a
// nearZoneBoundary() test (2026-09-19): on the 3x3 that was a fine proxy
// for "not straddling an edge", but painted sectors are irregular and
// nearZoneBoundary's 150px margin rejected so much of a staircase or a
// bracket that a 560x280 hall almost never fitted -- measured at two halls
// on only 11 of 60 maps, with 10 maps getting NONE.
//
// Containment is the real requirement and it is also more permissive: the
// hall may sit right up against its sector's edge as long as every part of
// it, plus its clearance, is on this sector's ground.
function hallInZone(box, zone) {
    if (zone === undefined) return true;
    const step = 100;
    for (let yy = box.y; yy <= box.y + box.h; yy += step) {
        for (let xx = box.x; xx <= box.x + box.w; xx += step) {
            if (!inZone(xx, yy, zone)) return false;
        }
    }
    // The four corners exactly, in case the step skipped past them.
    return inZone(box.x, box.y, zone) && inZone(box.x + box.w, box.y, zone) &&
           inZone(box.x, box.y + box.h, zone) && inZone(box.x + box.w, box.y + box.h, zone);
}

function hallFits(x, y, w, h, margin, zone) {
    const box = { x: x - margin, y: y - margin, w: w + margin * 2, h: h + margin * 2 };
    if (!hallInZone(box, zone)) return false;
    if (clashesReserved(box)) return false;
    if (rectBlockedStatic(box)) return false;
    if (!onClearFloor(box.x, box.y, box.w, box.h)) return false;
    return true;
}

// Straight run from the funnel's rim to the silo's wall, along the line
// between their centres. Drawn by drawSiloPipes; purely visual.
function pipeBetween(f, s) {
    const cx = s.x + s.w / 2, cy = s.y + s.h / 2;
    const dx = cx - f.x, dy = cy - f.y;
    const d = Math.hypot(dx, dy) || 1;
    const ux = dx / d, uy = dy / d;
    const tx = ux !== 0 ? (s.w / 2) / Math.abs(ux) : Infinity;
    const ty = uy !== 0 ? (s.h / 2) / Math.abs(uy) : Infinity;
    const t = Math.min(tx, ty);
    return {
        x1: Math.round(f.x + ux * (f.r + 4)), y1: Math.round(f.y + uy * (f.r + 4)),
        x2: Math.round(cx - ux * t), y2: Math.round(cy - uy * t)
    };
}

// A door-like pinch at each end of a funnel hall (2026-09-19, on request:
// "cause pinch point slightly in silo hallways so there is more of a
// door-like entrance & exit").
//
// A hall is HALL_WID 280 outer / 240 inner and used to stand open the full
// width at both ends. Four jambs -- one at each corner of each open end --
// take that to HALL_DOOR (140).
//
// HALL_DOOR IS THE NUMBER THAT NEEDS CARE. Rule 3 in zombie/CLAUDE.md: the
// flow field can only GUARANTEE an opening at 2*NAV_CELL + 2*NAV_PAD = 78px.
// 140 clears that by 62px and clears the widest body (the ULTRA HEAVY, 34px)
// four times over. It does make this the narrowest opening on the map --
// outpost doorways are 112, windows 112-151, doors 124-159, the nook hole
// 90 -- so if NAV_CELL or NAV_PAD ever move again, check HERE first.
const HALL_DOOR = 140;
const HALL_JAMB_D = 26;                              // depth along the hall axis

function addHallPinches(x, y, w, h, vertical) {
    // Inner clear span, and how much of it each jamb eats.
    const span = (vertical ? w : h) - WALL_T * 2;    // 240
    const jamb = Math.max(0, Math.round((span - HALL_DOOR) / 2));
    if (jamb <= 0) return;

    if (vertical) {
        // Open ends are NORTH and SOUTH; the jambs run across in x.
        const ends = [y, y + h - HALL_JAMB_D];
        for (let e = 0; e < ends.length; e++) {
            walls.push({ x: x + WALL_T, y: ends[e], w: jamb, h: HALL_JAMB_D });
            walls.push({ x: x + w - WALL_T - jamb, y: ends[e], w: jamb, h: HALL_JAMB_D });
        }
    } else {
        // Open ends are WEST and EAST; the jambs run down in y.
        const ends = [x, x + w - HALL_JAMB_D];
        for (let e = 0; e < ends.length; e++) {
            walls.push({ x: ends[e], y: y + WALL_T, w: HALL_JAMB_D, h: jamb });
            walls.push({ x: ends[e], y: y + h - WALL_T - jamb, w: HALL_JAMB_D, h: jamb });
        }
    }
}

function makeFunnelHall(x, y, vertical, z, k) {
    const w = vertical ? HALL_WID : HALL_LEN;
    const h = vertical ? HALL_LEN : HALL_WID;
    if (vertical) {
        walls.push({ x: x, y: y, w: WALL_T, h: h });
        walls.push({ x: x + w - WALL_T, y: y, w: WALL_T, h: h });
        funnels[k] = { x: x + w / 2, y: y + 190, r: HALL_FUNNEL_R, zone: z };
        // Against the WEST wall, mid-hall: open floor above it, so the label
        // goes above as usual.
        silos[k] = { x: x + WALL_T + 8, y: y + 380, w: SILO_W, h: SILO_H, zone: z };
    } else {
        walls.push({ x: x, y: y, w: w, h: WALL_T });
        walls.push({ x: x, y: y + h - WALL_T, w: w, h: WALL_T });
        funnels[k] = { x: x + 190, y: y + h / 2, r: HALL_FUNNEL_R, zone: z };
        // Against the NORTH wall -- so `labelBelow` (2026-09-19). drawEndgame
        // draws both silo lines ABOVE the tank, which here put them inside
        // the hall wall: the reported "text showing amount full is currently
        // inside of wall above". Decided here, where we know which wall we
        // just parked it against, rather than guessed at draw time.
        silos[k] = { x: x + 380, y: y + WALL_T + 8, w: SILO_W, h: SILO_H, zone: z, labelBelow: true };
    }
    addHallPinches(x, y, w, h, vertical);
    funnelHalls[k] = { x: x, y: y, w: w, h: h, vertical: vertical, zone: z };
    siloPipes[k] = pipeBetween(funnels[k], silos[k]);
    reservedRects.push({ x: x - 110, y: y - 110, w: w + 220, h: h + 220 });
    keepClearRects.push({ x: x - 20, y: y - 20, w: w + 40, h: h + 40 });
}

// Horizontal first (a zone is 1600 wide and only 900 tall), then vertical.
// Both orientations are tried from the start now, alternating, rather than
// horizontal for 90 attempts and vertical for 50. THE SPILLWAY's spine is
// 800px wide and 2100 tall: a vertical hall drops straight into it and a
// horizontal one never will, so spending the first 90 tries on horizontal
// was most of why that sector never got one.
function buildFunnelHall(b, z, k, margin) {
    const m = margin || 70;
    for (let attempt = 0; attempt < 220; attempt++) {
        const vertical = (attempt & 1) === 1;
        const w = vertical ? HALL_WID : HALL_LEN;
        const h = vertical ? HALL_LEN : HALL_WID;
        const x = Math.round(b.x + 40 + MP.random() * Math.max(1, b.w - 80 - w));
        const y = Math.round(b.y + 40 + MP.random() * Math.max(1, b.h - 80 - h));
        if (!hallFits(x, y, w, h, m, z)) continue;
        makeFunnelHall(x, y, vertical, z, k);
        return true;
    }
    return false;
}

// Normally a no-op: both halls were built first thing in their zones. If
// one could not fit, try every other eligible zone -- late, so with a wider
// margin, because buildings are standing by now -- and as a last resort
// fall back to a bare funnel with its silo alongside. Never returns with a
// funnel or silo missing: the chain cannot be finished without all three.
function finishFunnelsAndSilos() {
    for (let k = 1; k <= 2; k++) {
        if (funnels[k]) continue;
        let done = false;
        const cands = [];
        for (let i = 0; i < ZONE_COUNT; i++) {
            if (i === Z_BLOCKHOUSE || i === SLUICE_ZONE || !zoneInfo[i]) continue;
            if (funnelHalls[1] && funnelHalls[1].zone === i) continue;
            if (funnelHalls[2] && funnelHalls[2].zone === i) continue;
            cands.push(i);
        }
        // Biggest sector first -- it has the most room left once the
        // buildings are standing.
        cands.sort(function (a, b) { return zoneCellCount(b) - zoneCellCount(a); });

        // ESCALATING margins, not a single wider one. The old fallback
        // retried at margin 100 where the first pass used 70, which asks for
        // MORE clearance on the attempt that already failed -- backwards, and
        // it is why 5 maps in 300 still ended up with a bare funnel ring
        // instead of a hall after the sectors became irregular.
        const margins = [70, 50, 34];
        for (let m = 0; m < margins.length && !done; m++) {
            for (let c = 0; c < cands.length && !done; c++) {
                done = buildFunnelHall(zoneBounds(cands[c]), cands[c], k, margins[m]);
            }
        }
        if (done) continue;
        const z = cands.length ? cands[0] : 0;
        const spot = findOpenSpotSure(zoneBounds(z), 300, 0, z);
        funnels[k] = { x: spot.x + 110, y: spot.y + 150, r: HALL_FUNNEL_R, zone: z };
        silos[k] = { x: spot.x + 230, y: spot.y + 20, w: SILO_W, h: SILO_H, zone: z };
        siloPipes[k] = pipeBetween(funnels[k], silos[k]);
        claimFloor(spot.x, spot.y, 300, 300, 10);
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
