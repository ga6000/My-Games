/**
 * Cliff Run — the sandbox
 * ===================================================
 * Declares only. cr-boot.js calls crBuildSandbox() and crSandboxStep().
 *
 * WHY THIS EXISTS. The user's call (2026-10-17): the real game is on hold while
 * its level design is worked out, so switch off the bots and the pan and drop
 * one player into a big hand-built map to experiment in -- "4x current map
 * height, 2x length", filled with a variety of rings and gaps. The point of it
 * is to find out, by playing, what the level generator should be producing: the
 * verdict on the generated levels was "75% of this map is flat".
 *
 * IT IS NOT GENERATED. Everything here is placed by hand at known sizes, so a
 * gap that is "too wide" is a gap you can walk back to and measure. There is no
 * route, no waypoint and no bot -- crVerifyRoutes has nothing to say about it.
 *
 *   world     176 x 64 tiles (the game: ~86 x 16)  -- 4224 x 1536 px
 *   camera    follows the player on both axes; nothing scrolls on its own
 *   avalanche none (crAvalancheX is parked at -1e9)
 *   death     none: a fall lands on the net; a kill respawns you
 *
 * THE MAP IS FOUR PASSES, SERPENTINE, joined at their ends by a vertical
 * feature, because one line of stations would not fit in 176 columns:
 *
 *   pass 1  rows ~56  ->  right   gap ladder, step ladder, springs, crumble,
 *                                 tunnel, vent crossing        -> chimney up
 *   pass 2  rows ~38  <-  left    ring gaps, ring staircase, springs, pads,
 *                                 vent, elevator               -> ring tower up
 *   pass 3  rows ~22  ->  right   dash gaps, chimney + drop, brachiation,
 *                                 crumble stairs               -> pad column up
 *   pass 4  rows ~8   <-  left    the summit: widest gaps, springs, downdraft
 *
 * Keys 1-4 teleport to the start of each pass; R goes back to the spawn.
 *
 * Every placement is in LOCAL OFFSETS from a cursor that knows which way it is
 * facing (P.d), so one function builds the same station going either way.
 */
"use strict";

var CR_SB_COLS = 176;
var CR_SB_ROWS = 64;
var CR_SB_NET = 61;             // first row of the floor under everything

// ---- cursor helpers. P = { c, r, d }: next free column, standing row, +1/-1.
function crSbCol(P, k) { return P.c + P.d * k; }

function crSbTile(L, P, k, row, v) { crSet(L, crSbCol(P, k), row, v); }

function crSbSpan(L, P, k0, k1, row, v) {
    var a = crSbCol(P, k0), b = crSbCol(P, k1);
    crSpan(L, Math.min(a, b), Math.max(a, b), row, v);
}

function crSbRing(L, c, r) {
    if (crGet(L, c, r) !== CR_T.EMPTY) return;
    crSet(L, c, r, CR_T.ANCHOR);
    L.anchors.push({ col: c, row: r });
}

function crSbPad(L, P, k, row) {
    L.pickups.push({ kind: "dj", x: crSbCol(P, k) * CR_TILE + CR_TILE / 2, y: row * CR_TILE - 13 });
}

// A run of ground, two rows thick so it reads as a ledge rather than a line.
function crSbRun(L, P, len, thick) {
    var t = thick === undefined ? 2 : thick;
    for (var i = 0; i < t; i++) crSbSpan(L, P, 0, len - 1, P.r + i, CR_T.STONE);
    P.c += P.d * len;
}

// An empty stretch. `rings` places that many rings over it at P.r - up, spread
// evenly, which is what makes a gap "ring-assisted".
function crSbGap(L, P, n, rings, up) {
    for (var i = 0; i < (rings || 0); i++) {
        var k = Math.round((i + 0.5) * n / rings - 0.5);
        crSbRing(L, crSbCol(P, k), P.r - (up || 4));
    }
    P.c += P.d * n;
}

// Change standing row by k (negative = up). Going up, the first column of the
// next run is built as a wall down to the old floor; going down, the last
// column of the previous run is.
function crSbStep(L, P, k) {
    if (k < 0) {
        for (var r = P.r + k; r <= P.r + 1; r++) crSbTile(L, P, 0, r, CR_T.STONE);
    } else {
        for (var r2 = P.r; r2 <= P.r + k + 1; r2++) crSbTile(L, P, -1, r2, CR_T.STONE);
    }
    P.r += k;
}

// A step up that is a CLIMB (needs more than a jump), with a ring over the lip.
function crSbClimb(L, P, k) {
    crSbStep(L, P, -k);
    if (k >= 2) crSbRing(L, crSbCol(P, -1), P.r - 3);
}

function crSbBranch(L, P, dRow) {
    var reach = Math.ceil(crReach(CR_PHYS.springVel + CR_PHYS.springHeldBonus, dRow,
                                  CR_PHYS.springVx) / CR_TILE);
    if (reach < 6) return false;
    var gap = Math.max(3, reach - 4);
    var len = (reach + 3) - gap;
    crSbTile(L, P, 0, P.r, CR_T.BRANCH);
    P.c += P.d * (1 + gap);
    P.r += dRow;
    crSbRun(L, P, len);
    return true;
}

function crSbCrumble(L, P, len, timed) {
    var code = timed ? CR_T.TIMED : CR_T.CRUMBLE;
    crSbSpan(L, P, 0, 0, P.r, CR_T.STONE);
    crSbSpan(L, P, 1, len, P.r, code);
    crSbSpan(L, P, len + 1, len + 3, P.r, CR_T.STONE);
    P.c += P.d * (len + 4);
}

// One-block squeeze: floor, a body-high gap, and rock directly overhead.
function crSbTunnel(L, P, len) {
    crSbSpan(L, P, 0, len - 1, P.r, CR_T.STONE);
    crSbSpan(L, P, 0, len - 1, P.r + 1, CR_T.STONE);
    crSbSpan(L, P, 0, len - 1, P.r - 2, CR_T.STONE);
    crSbSpan(L, P, 0, len - 1, P.r - 3, CR_T.STONE);
    P.c += P.d * len;
}

/* A gust over a gap. The lip is a vent tile one row down, as in the game. The
   lift is set against gravity 1000 (net -10: you cross level). The GENERATOR's
   vents still use ay -790, left over from gravity 760 -- see "Flagged" in
   cliff-run/CLAUDE.md. */
function crSbVent(L, P, gap, landLen) {
    var ventCol = P.c;
    var ventRow = P.r + 1;
    crSet(L, ventCol, ventRow, CR_T.VENT);
    L.vents.push({ col: ventCol, row: ventRow, dir: "up" });
    var a = P.d > 0 ? ventCol + 1 : ventCol - gap;
    var top = P.r - 2;
    L.gusts.push({
        x: a * CR_TILE, y: top * CR_TILE,
        w: gap * CR_TILE, h: (ventRow + 1 - top) * CR_TILE,
        ax: 80 * P.d, ay: -1010, dir: "up", strength: 1
    });
    P.c += P.d * (1 + gap);
    crSbRun(L, P, landLen);
}

/* An updraft shaft: three vent tiles to stand on, a tall gust above them, and a
   ledge either side of the top to step off onto. Lift is net 150 px/s^2, so the
   ride is a second and a half and you leave the top with some speed. */
function crSbElevator(L, P, h) {
    crSbRun(L, P, 3);
    var base = P.r;
    for (var i = 0; i < 3; i++) {
        crSbTile(L, P, i, base, CR_T.VENT);
        L.vents.push({ col: crSbCol(P, i), row: base, dir: "up" });
    }
    var a = Math.min(crSbCol(P, 0), crSbCol(P, 2));
    L.gusts.push({
        x: a * CR_TILE, y: (base - h) * CR_TILE,
        w: 3 * CR_TILE, h: h * CR_TILE,
        ax: 0, ay: -1150, dir: "up", strength: 1
    });
    // a catch ledge on the far side of the top, one row below the shaft's top
    P.c += P.d * 3;
    P.r = base - h + 1;
    crSbRun(L, P, 6);
}

/* Wall-jump chimney, the same shape the game uses: walls at k=0 and k=4, the
   near wall stopping 3 rows short of the floor so you can walk in. */
function crSbChimney(L, P, h) {
    var rTop = P.r - h;
    var wallCol = P.c;
    for (var i = 0; i < 2; i++) crSbSpan(L, P, 0, 4, P.r + i, CR_T.STONE);
    for (var r = rTop; r <= P.r - 1; r++) crSbTile(L, P, 4, r, CR_T.STONE);
    for (var r2 = rTop; r2 <= P.r - 3; r2++) crSbTile(L, P, 0, r2, CR_T.STONE);
    P.c += P.d * 5;
    P.r = rTop;
    crSbRun(L, P, 5);
    return wallCol;
}

/* A vertical chain of rings with a rest ledge every other ring. The only way up
   is to fire, swing, let go, fire again. */
function crSbRingTower(L, P, count, spacing, offset) {
    var c0 = P.c, r0 = P.r;
    crSbRun(L, P, 4);
    for (var i = 0; i < count; i++) {
        var side = (i % 2) ? offset : -offset;
        var row = r0 - 4 - i * spacing;
        crSbRing(L, c0 + 1 + Math.round(side * P.d) + (P.d > 0 ? 0 : 0), row);
        if (i % 2 === 1) {
            // a rest ledge two thirds of the way up each pair
            var lc = c0 + (P.d > 0 ? 6 : -6);
            crSpan(L, Math.min(lc, lc + P.d * 2), Math.max(lc, lc + P.d * 2), row + 2, CR_T.STONE);
        }
    }
    P.r = r0 - 4 - count * spacing + 1;
    // The top ledge sits over the tower, and the cursor leaves from its far end.
    P.c = c0;
    crSbRun(L, P, 6);
    return c0;
}

/* Ledges every 3 rows with a pad on each: one jump plus the pad's air jump per
   storey. Alternating sides, so the climb zigzags. */
function crSbPadColumn(L, P, storeys) {
    crSbRun(L, P, 4);
    crSbPad(L, P, 1, P.r);
    var r0 = P.r;
    for (var i = 1; i <= storeys; i++) {
        var k = (i % 2) ? 4 : 0;
        var row = r0 - i * 3;
        crSbSpan(L, P, k - 3, k, row, CR_T.STONE);
        crSbSpan(L, P, k - 3, k, row + 1, CR_T.STONE);
        crSbPad(L, P, k - 1, row);
    }
    P.r = r0 - storeys * 3;
    var topLeft = P.c;
    crSbSpan(L, P, 0, 5, P.r, CR_T.STONE);
    crSbSpan(L, P, 0, 5, P.r + 1, CR_T.STONE);
    P.c += P.d * 6;
    return topLeft;
}

// A drop: ledges stepping DOWN with a gap between, so you fall in stages.
function crSbDrop(L, P, stages, drop) {
    for (var i = 0; i < stages; i++) {
        crSbRun(L, P, 3);
        P.c += P.d * 2;
        P.r += drop;
    }
    crSbRun(L, P, 3);
}

// Rings scattered through the empty air between the passes. Staggered, and
// only where the neighbourhood is clear, so none sits inside rock.
function crSbForest(L, c0, c1, r0, r1, dc, dr) {
    var row = 0;
    for (var r = r0; r <= r1; r += dr, row++) {
        for (var c = c0 + (row % 2 ? Math.floor(dc / 2) : 0); c <= c1; c += dc) {
            var clear = true;
            for (var y = r - 1; y <= r + 2 && clear; y++) {
                for (var x = c - 2; x <= c + 2; x++) {
                    if (crGet(L, x, y) !== CR_T.EMPTY) { clear = false; break; }
                }
            }
            if (clear) crSbRing(L, c, r);
        }
    }
}

/* Floating islands with stalactites hanging under them, scattered through the
   empty air. They are what stops the space between the passes being a void:
   something to land on mid-swing, and something to swing under. Placed on a
   jittered grid wherever a 9x6 neighbourhood is empty, so none touches a pass. */
function crSbIslands(L, rng, c0, c1, r0, r1) {
    for (var r = r0; r <= r1; r += 6) {
        for (var c = c0 + ((r / 6 | 0) % 2 ? 5 : 0); c <= c1; c += 11) {
            var cc = c + (rng() * 5 | 0) - 2, rr = r + (rng() * 3 | 0);
            var w = 2 + (rng() * 3 | 0);
            var clear = true;
            for (var y = rr - 3; y <= rr + 6 && clear; y++) {
                for (var x = cc - 3; x <= cc + w + 2; x++) {
                    if (crGet(L, x, y) !== CR_T.EMPTY) { clear = false; break; }
                }
            }
            if (!clear) continue;
            crSpan(L, cc, cc + w - 1, rr, CR_T.STONE);
            crSpan(L, cc, cc + w - 1, rr + 1, CR_T.STONE);
            if (rng() < 0.6) {           // a stalactite
                var tc = cc + (rng() * w | 0);
                var tl = 2 + (rng() * 4 | 0);
                for (var k = 2; k < 2 + tl; k++) crSet(L, tc, rr + k, CR_T.STONE);
            }
        }
    }
}

// ===================================================
//   THE MAP
// ===================================================
function crBuildSandbox() {
    var spec = crLevelSpec(0);
    spec.scroll = 0;
    spec.safeFloor = false;
    spec.forgiveness = 1.8;          // level 1's generous input windows

    var L = {
        index: 0,
        spec: spec,
        sandbox: true,
        cols: CR_SB_COLS,
        rows: CR_SB_ROWS,
        tiles: new Uint8Array(CR_SB_COLS * CR_SB_ROWS),
        clear: new Uint8Array(CR_SB_COLS * CR_SB_ROWS),
        finishCol: CR_SB_COLS + 8,   // nothing is a finish tile
        routes: [], catwalks: [], gates: [], anchors: [],
        vents: [], gusts: [], coins: [], pickups: [], spawns: [],
        marks: [],                   // { n, x, y }: the 1-4 teleport targets
        worldW: CR_SB_COLS * CR_TILE,
        objective: "SANDBOX · FREE PLAY"
    };

    var r, c;
    // The net: three rows of floor, so a fall is a long drop and not a death.
    for (r = CR_SB_NET; r < CR_SB_ROWS; r++) crSpan(L, 0, CR_SB_COLS - 1, r, CR_T.STONE);
    // Side walls.
    for (r = 0; r < CR_SB_ROWS; r++) {
        crSpan(L, 0, 1, r, CR_T.STONE);
        crSpan(L, CR_SB_COLS - 2, CR_SB_COLS - 1, r, CR_T.STONE);
    }

    var P, i;
    function mark(n, P0) {
        L.marks.push({ n: n, x: (P0.c - 2 * P0.d) * CR_TILE + 4, y: crStandY(P0.r) });
    }

    // -------------------------------------------------- PASS 1  (right)
    P = { c: 3, r: 56, d: 1 };
    crSbRun(L, P, 8);
    mark(1, P);
    // gap ladder: 1, 2 are plain jumps; 3+ want a ring or a dash
    var gaps = [1, 2, 3, 4, 6];
    for (i = 0; i < gaps.length; i++) {
        crSbGap(L, P, gaps[i], gaps[i] >= 3 ? (gaps[i] >= 6 ? 2 : 1) : 0, 4);
        crSbRun(L, P, 3);
    }
    // step ladder: 1, 1, 2, 2, 3 rows up
    crSbRun(L, P, 2);
    var climbs = [1, 2, 3];
    for (i = 0; i < climbs.length; i++) { crSbClimb(L, P, climbs[i]); crSbRun(L, P, 3); }
    // drop steps back down
    var drops = [2, 2];
    for (i = 0; i < drops.length; i++) { crSbStep(L, P, drops[i]); crSbRun(L, P, 3); }
    // springs: level, a little up, a long way down
    var sp = [0, -1, 3];
    for (i = 0; i < sp.length; i++) { crSbRun(L, P, 2); crSbBranch(L, P, sp[i]); }
    // crumble then timed
    crSbRun(L, P, 2);
    crSbCrumble(L, P, 6, false);
    crSbRun(L, P, 1);
    crSbCrumble(L, P, 6, true);
    // squeeze
    crSbRun(L, P, 2);
    crSbTunnel(L, P, 7);
    crSbRun(L, P, 2);
    // wind
    crSbVent(L, P, 7, 4);
    // connector: chimney 16 rows up
    var p1end = { c: P.c, r: P.r };
    L.dbg = [{ pass: 1, c: P.c, r: P.r }];
    crSbRun(L, P, 1);
    var chCol = crSbChimney(L, P, 16);

    // -------------------------------------------------- PASS 2  (left)
    // The chimney's exit runs RIGHT; step onto the far side and turn around.
    P = { c: chCol - 1, r: P.r, d: -1 };
    crSbRun(L, P, 4);
    mark(2, P);
    var p2start = { c: P.c, r: P.r };
    // wide ring gaps
    var wide = [6, 9, 12];
    for (i = 0; i < wide.length; i++) {
        crSbGap(L, P, wide[i], Math.max(1, Math.round(wide[i] / 5)), 4 + (i % 2));
        crSbRun(L, P, 3);
    }
    // ring staircase: up three rows a step across a three-tile gap
    for (i = 0; i < 3; i++) {
        crSbRun(L, P, 2);
        P.c += P.d * 3;
        crSbStep(L, P, -3);
        crSbRing(L, crSbCol(P, 0) - P.d * 2, P.r - 2);
    }
    crSbRun(L, P, 3);
    // dive back down in stages
    crSbDrop(L, P, 3, 3);
    // (the springs live in passes 1 and 4; pass 2 is the narrowest of the four)
    // pad hops: the second jump is the only way across
    crSbRun(L, P, 1);
    crSbPad(L, P, 1, P.r);
    crSbRun(L, P, 3);
    for (i = 0; i < 3; i++) {
        P.c += P.d * (4 + i);
        crSbRun(L, P, 3);
        crSbPad(L, P, -2, P.r);
    }
    crSbVent(L, P, 8, 3);
    crSbElevator(L, P, 11);
    crSbDrop(L, P, 2, 5);
    // connector: ring tower, 4 rings, 16 rows up. It builds toward +d, so
    // turn the cursor around for it.
    P.d = 1;
    P.c = Math.max(8, P.c + 1);
    L.dbg = (L.dbg || []).concat([{ p2end: P.c }]);
    crSbRingTower(L, P, 4, 4, 3);

    // -------------------------------------------------- PASS 3  (right)
    mark(3, P);
    // dash gaps: 4 and 5 with nothing above them
    crSbRun(L, P, 3);
    var dg = [3, 4, 4, 5];
    for (i = 0; i < dg.length; i++) { crSbGap(L, P, dg[i], 0); crSbRun(L, P, 3); }
    // chimney up, a short walk, then a staged drop back down
    crSbRun(L, P, 2);
    crSbChimney(L, P, 12);
    crSbDrop(L, P, 3, 4);
    // a long horizontal chain of rings: 15 tiles of nothing
    crSbRun(L, P, 2);
    crSbGap(L, P, 15, 3, 4);
    crSbRun(L, P, 3);
    // crumbling stairs going up
    for (i = 0; i < 2; i++) {
        crSbCrumble(L, P, 3, i % 2 === 1);
        crSbStep(L, P, -1);
    }
    crSbRun(L, P, 3);
    crSbVent(L, P, 6, 3);
    var padTop = crSbPadColumn(L, P, 3);

    // -------------------------------------------------- PASS 4  (left, summit)
    P = { c: padTop - 1, r: P.r, d: -1 };
    crSbRun(L, P, 3);
    mark(4, P);
    var big = [9, 11, 13];
    for (i = 0; i < big.length; i++) {
        crSbGap(L, P, big[i], Math.round(big[i] / 4), 4 + (i % 3));
        crSbRun(L, P, 3);
    }
    sp = [0, -1, 0];
    for (i = 0; i < sp.length; i++) { crSbRun(L, P, 2); crSbBranch(L, P, sp[i]); }
    crSbCrumble(L, P, 8, false);
    crSbRun(L, P, 2);
    crSbStep(L, P, 2); crSbRun(L, P, 2);
    crSbStep(L, P, 3); crSbRun(L, P, 2);
    crSbGap(L, P, 7, 2, 5);
    crSbRun(L, P, 5);

    // -------------------------------------------------- THE FOREST
    // Rings in the air between the passes, for swinging practice. Anything the
    // passes already occupy is skipped by the clear-neighbourhood test.
    var irng = crRng(0x5A4D);
    crSbIslands(L, irng, 6, CR_SB_COLS - 12, 43, 50);
    crSbIslands(L, irng, 6, CR_SB_COLS - 12, 26, 33);
    crSbIslands(L, irng, 6, CR_SB_COLS - 12, 10, 16);
    crSbForest(L, 6, CR_SB_COLS - 7, 44, 52, 9, 5);
    crSbForest(L, 6, CR_SB_COLS - 7, 27, 34, 9, 5);
    crSbForest(L, 6, CR_SB_COLS - 7, 11, 18, 9, 5);

    L.spawns.push({ x: 4 * CR_TILE + 4, y: crStandY(56) });
    L.p1end = p1end; L.p2start = p2start;
    return L;
}

// ===================================================
//   THE STEP (one player, one camera that follows)
// ===================================================
function crSandboxStep(dt) {
    crRunTime += dt;
    if (crPaused) return;
    crLevelTime += dt;
    if (crCam.shake > 0) crCam.shake = Math.max(0, crCam.shake - dt * 16);

    crUpdateTouched(crLevel, dt);
    crUpdateFalling(dt);
    crUpdatePads(dt);
    crUpdateParticles(dt);

    var me = crPlayers[0];
    crReadKeyboard(me);
    crStepBody(crLevel, me, dt);
    crCheckFate(crLevel, me);

    /* The camera eases toward the player rather than snapping, and sits a
       little above centre: on a map this tall you care more about what is over
       your head. Exponential, so it is the same at any step rate. */
    var k = 1 - Math.exp(-7 * dt);
    var tx = me.x + me.w / 2 - CR_VW / 2;
    var ty = me.y + me.h / 2 - CR_VH * 0.55;
    crCam.x += (crClamp(tx, 0, crLevel.worldW - CR_VW) - crCam.x) * k;
    crCam.y += (crClamp(ty, 0, crLevel.rows * CR_TILE - CR_VH) - crCam.y) * k;
}

// 1-4 teleport to a pass start, R to the spawn. A test aid, not a game rule.
function crSandboxTeleport(me, n) {
    var L = crLevel;
    var spot = n === 0 ? L.spawns[0] : null;
    for (var i = 0; !spot && i < L.marks.length; i++) if (L.marks[i].n === n) spot = L.marks[i];
    if (!spot || !me) return;
    me.x = spot.x; me.y = spot.y;
    me.vx = 0; me.vy = 0;
    if (me.grapple) { me.grapple = null; me.grappleCool = 0; }
    crCam.x = crClamp(me.x - CR_VW / 2, 0, L.worldW - CR_VW);
    crCam.y = crClamp(me.y - CR_VH * 0.55, 0, L.rows * CR_TILE - CR_VH);
}
