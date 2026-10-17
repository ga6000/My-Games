/**
 * Cliff Run — level generation and the guaranteed route
 * ===================================================
 * Declares only. cr-boot.js calls crBuildLevel(index).
 *
 * ---------------------------------------------------------------------------
 * THE ROUTE IS THE SOLVABILITY PROOF, AND THAT IS WHY IT IS IN THIS FILE
 * ---------------------------------------------------------------------------
 * A forced-scroll platformer with crumbling blocks, wind, wall-jump shafts and
 * bombable walls is not something a reactive bot can be trusted to improvise.
 * So the generator never places a hazard it has not just made passable: it
 * walks left to right emitting SEGMENTS, and every segment appends the
 * waypoints that cross it. cr-bots.js follows that chain. The bots are not
 * solving the level -- they are walking a path that was built to be walkable,
 * which is the only honest way to answer "make sure they can actually beat
 * the game".
 *
 * Two consequences worth stating, because they constrain edits here:
 *
 *   1. Every gap and step-up is capped against CR_PHYS in cr-core.js (3 tiles
 *      against a 4.2-tile jump range, 2 rows against a 2.37-tile apex). The
 *      MARGIN is the point. A route that is exactly reachable is a route the
 *      bots fail, because they jump on a tile boundary and not on a frame.
 *   2. The last stretch of every route is a FORCED STAIRCASE onto a catwalk
 *      (crApproach). The convergence pass before it only makes that staircase
 *      short; it is not allowed to be the thing that makes the level finishable.
 *      That is the safety net, and it is deliberate.
 *
 * LANES -> INTERMIX is geometry, not script. Four routes are generated, one
 * per lane, and each route's allowed vertical band WIDENS with progress: own
 * band at 0%, the whole cliff by 33%. They then cross, share platforms and get
 * in each other's way without a single line of code that says "now interact".
 * The band narrows again over the last stretch so the four catwalks at the far
 * outpost are reached from four heights, the way the near one was left.
 */
"use strict";

// Playable rows. Row 17 is deliberately void: it is what makes falling off the
// bottom of the cliff possible, which the spec asks for.
var CR_ROW_MIN = 2;
var CR_ROW_MAX = 16;

// The four lane stand-rows, top to bottom. This order IS the spawn order the
// spec asks for: P1 top-left, P2 upper-middle, P3 lower-middle, P4 lower-left.
var CR_LANE_ROWS = [3, 7, 11, 15];

var CR_START_COLS = 12;      // the near outpost
var CR_END_COLS = 14;        // the far outpost

function crStandY(row) { return row * CR_TILE - CR_PH; }

// ===================================================
//   GRID HELPERS
// ===================================================
function crIdx(level, col, row) { return row * level.cols + col; }

function crGet(level, col, row) {
    if (col < 0 || col >= level.cols || row < 0 || row >= CR_ROWS) return CR_T.EMPTY;
    return level.tiles[crIdx(level, col, row)];
}

function crSet(level, col, row, v) {
    if (col < 0 || col >= level.cols || row < 0 || row >= CR_ROWS) return;
    level.tiles[crIdx(level, col, row)] = v;
}

// Lay a horizontal span. Never overwrites a CATWALK -- the outposts are placed
// first and a route that wanders into one must not be able to erase the finish.
function crSpan(level, c0, c1, row, v) {
    for (var c = c0; c <= c1; c++) {
        if (crGet(level, c, row) === CR_T.CATWALK) continue;
        crSet(level, c, row, v);
    }
}

function crColumn(level, col, r0, r1, v) {
    for (var r = r0; r <= r1; r++) {
        if (crGet(level, col, r) === CR_T.CATWALK) continue;
        crSet(level, col, r, v);
    }
}

// Solid from every side, except BRANCH, which is solid from above only so you
// can spring off it without it being a wall you can run into.
function crTileSolid(code) { return !!CR_SOLID[code]; }

// ===================================================
//   THE LANE BAND
// ===================================================
// progress p in 0..1 across the RUN (not the whole level). 0 -> own lane,
// 1 by p=0.33 -> the whole cliff, and back to own lane by p=1 so the far
// outpost's four catwalks are approached from four heights.
function crLaneBlend(p) {
    if (p < 0.33) return p / 0.33;
    if (p < 0.78) return 1;
    return crClamp(1 - (p - 0.78) / 0.22, 0, 1);
}

function crBandFor(lane, p) {
    var own = CR_LANE_ROWS[lane];
    var blend = crLaneBlend(p);
    // +/-1 at blend 0 leaves a clear row of air between the four lanes, which
    // is what makes the opening read as lanes at a glance.
    var lo = crLerp(own - 1, CR_ROW_MIN, blend);
    var hi = crLerp(own + 1, CR_ROW_MAX, blend);
    return { lo: Math.round(crClamp(lo, CR_ROW_MIN, CR_ROW_MAX)),
             hi: Math.round(crClamp(hi, CR_ROW_MIN, CR_ROW_MAX)) };
}

// ===================================================
//   THE OUTPOSTS
// ===================================================
// "start and end of each map should be a cliff mounted Comms outpost base with
// 4 cat-walk platforms that count as a finish". Both ends get the same
// structure; only the FAR one finishes you, which crIsFinishTile decides by
// column rather than by tile code -- one tile, one look, two meanings.
function crBuildOutpost(level, side) {
    var isStart = (side === "start");
    var c0 = isStart ? 2 : level.finishCol;
    var c1 = isStart ? (CR_START_COLS - 2) : (level.cols - 3);

    for (var i = 0; i < 4; i++) {
        var row = CR_LANE_ROWS[i];
        crSpan(level, c0, c1, row, CR_T.CATWALK);
        level.catwalks.push({ col0: c0, col1: c1, row: row, lane: i, finish: !isStart });
        // The mast each catwalk hangs off. Decorative, but it is solid, which
        // is what stops a player walking off the back of the structure.
        var mastCol = isStart ? c0 - 1 : c1 + 1;
        crColumn(level, mastCol, row, Math.min(CR_ROW_MAX, row + 2), CR_T.OUTPOST);
    }
    // The spine: the comms tower itself, against the cliff edge.
    var spine = isStart ? 1 : level.cols - 2;
    crColumn(level, spine, CR_ROW_MIN, CR_ROW_MAX, CR_T.OUTPOST);
}

function crIsFinishTile(level, col, row) {
    return crGet(level, col, row) === CR_T.CATWALK && col >= level.finishCol;
}

// ===================================================
//   SEGMENT EMITTERS
// ===================================================
// Each takes the walker { col, row } and mutates it, pushing waypoints onto
// `route`. Each returns the number of columns consumed, so the caller can
// refuse a segment that would overrun the run.

// A waypoint. x is where the bot should BE when it acts; for a jump that is the
// launch edge, right-aligned to the last solid tile so the full 4.2-tile range
// is available (jumping from the left edge of the tile would spend 16px of it).
function crWp(route, x, row, kind, data) {
    route.push({ x: x, y: crStandY(row), row: row, kind: kind, data: data || null });
}

function crLaunchX(col) { return (col + 1) * CR_TILE - CR_PW; }

function crEmitRun(level, w, len, kind) {
    var tile = kind || CR_T.STONE;
    crSpan(level, w.col, w.col + len - 1, w.row, tile);
    w.col += len;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk",
         tile === CR_T.CRUMBLE ? { noStop: true } : null);
    return len;
}

// A plain jump. gap <= 3 tiles, drop/rise <= 2 rows: both inside CR_PHYS with
// room to spare, which is what the header means by margin.
function crEmitGap(level, w, gap, dRow) {
    var launch = crLaunchX(w.col - 1);
    crWp(w.route, launch, w.row, "jump", { gap: gap, dRow: dRow });
    w.col += gap;
    w.row += dRow;
    var len = 3 + (w.rng() * 3 | 0);
    crSpan(level, w.col, w.col + len - 1, w.row, CR_T.STONE);
    w.col += len;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    return gap + len;
}

// A run of blocks that will not hold. The INSTANT kind (CR_T.CRUMBLE) detaches
// 0.22s after the first touch, which at 108 px/s is a tile and a half -- so it
// is crossable at a run and lethal to anyone who stops, which is what
// "fall immediately after touching" has to mean to still be a platform. The
// TIMED kind gives CR_TIMED_FUSE seconds, so you may stand but not loiter.
function crEmitCrumble(level, w, len, timed) {
    var code = timed ? CR_T.TIMED : CR_T.CRUMBLE;
    // A solid tile either side, so the player always has somewhere to take off
    // from and somewhere to arrive. Without the landing tile a late jump off
    // the last crumbling block is an unavoidable death.
    crSpan(level, w.col, w.col, w.row, CR_T.STONE);
    crSpan(level, w.col + 1, w.col + len, w.row, code);
    crSpan(level, w.col + len + 1, w.col + len + 3, w.row, CR_T.STONE);
    crWp(w.route, w.col * CR_TILE, w.row, "walk", { noStop: !timed, hazard: true });
    w.col += len + 4;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    return len + 4;
}

// A tree branch. Springs you on any contact from above (cr-physics.js), which
// is a trampoline rather than a timed input -- chosen so the bots can use it,
// and it reads better for a person too. Clears up to 5 tiles against a
// 7.4-tile spring range.
function crEmitBranch(level, w, gap, dRow) {
    crSet(level, w.col, w.row, CR_T.BRANCH);
    crWp(w.route, crLaunchX(w.col), w.row, "spring", { gap: gap, dRow: dRow });
    w.col += 1 + gap;
    w.row += dRow;
    var len = 3 + (w.rng() * 3 | 0);
    crSpan(level, w.col, w.col + len - 1, w.row, CR_T.STONE);
    w.col += len;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    return 1 + gap + len;
}

// A wind tunnel across a gap too wide to jump. The vent is a lip of rock
// jutting into the void one row down, so it never blocks the run above it, and
// the gust is a RECT of constant acceleration -- "constant & directional", so
// it is deterministic, which is what makes it something a bot can plan through.
function crEmitVent(level, w, gap, dRow) {
    var ventCol = w.col;
    var ventRow = Math.min(CR_ROW_MAX, w.row + 1);
    crSet(level, ventCol, ventRow, CR_T.VENT);
    level.vents.push({ col: ventCol, row: ventRow, dir: "up" });

    var gx = (ventCol + 1) * CR_TILE;
    var gw = gap * CR_TILE;
    var gTopRow = Math.max(0, w.row - 4);
    level.gusts.push({
        x: gx, y: gTopRow * CR_TILE,
        w: gw, h: (ventRow - gTopRow) * CR_TILE,
        ax: 110, ay: -820,     // net lift of 60 against gravity: you float across
        dir: "up", strength: 1
    });

    crWp(w.route, crLaunchX(ventCol), w.row, "gust", { gap: gap, dRow: dRow });
    w.col += 1 + gap;
    w.row += dRow;
    var len = 3 + (w.rng() * 3 | 0);
    crSpan(level, w.col, w.col + len - 1, w.row, CR_T.STONE);
    w.col += len;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    return 1 + gap + len;
}

/*
 * A wall-jump chimney. The Celeste skill the spec asks for, which needs two
 * faces close enough to bounce between.
 *
 * Shape, and every part of it is load-bearing:
 *
 *        col        col+4
 *         |           |
 *   rTop  #           #      <- both walls; standing on col+4's top is the exit
 *         #           #
 *         #           #
 *         .           #      <- col's wall STOPS two rows above the floor...
 *   row-1 .           #         ...so the player can WALK IN from the left
 *   row   ###########         <- the floor, which is also the retry net
 *
 * The left wall's two-row doorway is why this is enterable at all; a chimney
 * walled on both sides to the floor can only be dropped into. The floor is why
 * a bot that mistimes a jump loses two seconds instead of its run.
 */
function crEmitShaft(level, w, h) {
    var col = w.col;
    var rTop = Math.max(CR_ROW_MIN, w.row - h);
    h = w.row - rTop;
    if (h < 3) return 0;

    crSpan(level, col, col + 4, w.row, CR_T.STONE);
    crColumn(level, col + 4, rTop, w.row - 1, CR_T.STONE);
    crColumn(level, col, rTop, w.row - 3, CR_T.STONE);

    crWp(w.route, (col + 1) * CR_TILE, w.row, "walljump", {
        leftX: (col + 1) * CR_TILE,
        rightX: (col + 4) * CR_TILE - CR_PW,
        topRow: rTop,
        topY: crStandY(rTop)
    });

    w.col = col + 5;
    w.row = rTop;
    var len = 3 + (w.rng() * 3 | 0);
    crSpan(level, w.col, w.col + len - 1, w.row, CR_T.STONE);
    w.col += len;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    return 5 + len;
}

/*
 * A bolted wall and the bomb that opens it. Three tiles tall on purpose: 48px
 * against a 37.9px jump apex, so it cannot be hopped -- but a player holding a
 * double-jump charge CAN clear it, and that is left in as the alternative
 * solution rather than patched out.
 *
 * The bomb pickup is placed on the approach, far enough back that you meet it
 * before you meet the wall.
 */
function crEmitBreakable(level, w) {
    var runLen = 7 + (w.rng() * 3 | 0);
    crSpan(level, w.col, w.col + runLen - 1, w.row, CR_T.STONE);
    level.pickups.push({
        kind: "bomb",
        x: (w.col + 2) * CR_TILE + 4, y: w.row * CR_TILE - 12
    });
    crWp(w.route, (w.col + 2) * CR_TILE, w.row, "walk", { grab: "bomb" });

    var wallCol = w.col + runLen;
    crColumn(level, wallCol, w.row - 3, w.row - 1, CR_T.BREAK);
    crSpan(level, wallCol, wallCol, w.row, CR_T.STONE);
    crWp(w.route, (wallCol - 2) * CR_TILE, w.row, "bomb", { wallCol: wallCol });

    var len = 4 + (w.rng() * 3 | 0);
    crSpan(level, wallCol + 1, wallCol + len, w.row, CR_T.STONE);
    w.col = wallCol + len + 1;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    return runLen + len + 2;
}

// ===================================================
//   THE FORCED APPROACH
// ===================================================
// The safety net named in this file's header. A staircase of 1-column steps of
// at most 2 rows from wherever the walker ended up onto the lane's catwalk.
// Nothing about level completion is allowed to depend on the convergence pass
// having worked -- that pass only makes this staircase short.
function crApproach(level, w, targetRow) {
    var guard = 0;
    while (w.row !== targetRow && w.col < level.finishCol - 1 && guard++ < 64) {
        var step = crClamp(targetRow - w.row, -2, 3);   // climbing is the capped direction
        if (step < 0) step = Math.max(step, -2);
        w.row += step;
        crSpan(level, w.col, w.col + 1, w.row, CR_T.STONE);
        w.col += 2;
        crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    }
    // Bridge whatever columns remain, so the catwalk is walked ONTO rather
    // than jumped at. "walk on to them" is how the spec phrases the finish.
    if (w.col < level.finishCol) {
        crSpan(level, w.col, level.finishCol - 1, targetRow, CR_T.STONE);
    }
    crWp(w.route, level.finishCol * CR_TILE + 8, targetRow, "finish", null);
}

// ===================================================
//   ONE LANE'S ROUTE
// ===================================================
function crBuildRoute(level, lane, rng) {
    var spec = level.spec;
    var runStart = CR_START_COLS;
    var runEnd = level.finishCol - 4;
    var targetRow = CR_LANE_ROWS[lane];

    var w = {
        col: runStart, row: CR_LANE_ROWS[lane],
        route: [], rng: rng
    };

    // Off the near catwalk and onto the cliff.
    crSpan(level, runStart - 1, runStart + 2, w.row, CR_T.STONE);
    w.col = runStart + 3;
    crWp(w.route, runStart * CR_TILE, w.row, "walk", null);

    var bombsPlaced = 0;
    var sinceCharge = 0;
    var guard = 0;

    while (w.col < runEnd - 10 && guard++ < 400) {
        var p = (w.col - runStart) / Math.max(1, runEnd - runStart);
        var band = crBandFor(lane, p);
        var t = spec.difficulty;
        var converging = p > 0.78;

        // A double-jump charge every so often, and always one before the
        // first wide feature. "collectables that allow for a 2nd jump".
        if (sinceCharge > 16 + (rng() * 10 | 0)) {
            level.pickups.push({
                kind: "dj",
                x: (w.col + 1) * CR_TILE + 3, y: w.row * CR_TILE - 13
            });
            sinceCharge = 0;
        }

        // Coins. Points, and a reason to leave the route.
        if (rng() < 0.55) {
            var cn = 1 + (rng() * 3 | 0);
            for (var ci = 0; ci < cn; ci++) {
                level.coins.push({
                    x: (w.col + ci) * CR_TILE + 5,
                    y: w.row * CR_TILE - 11 - (rng() < 0.3 ? 14 : 0)
                });
            }
        }

        var before = w.col;
        var used = 0;

        if (converging) {
            // Close on the lane row, so the far outpost is reached from the
            // same four heights the near one was left from.
            var d = targetRow - w.row;
            if (d < -2) used = crEmitGap(level, w, 1 + (rng() * 2 | 0), -2);
            else if (d > 2) used = crEmitGap(level, w, 1 + (rng() * 2 | 0), Math.min(3, d));
            else if (d !== 0) used = crEmitGap(level, w, 1 + (rng() * 2 | 0), crClamp(d, -2, 3));
            else used = crEmitRun(level, w, 4 + (rng() * 3 | 0));
        } else {
            used = crEmitWeighted(level, w, rng, spec, band, t, {
                bombsPlaced: bombsPlaced,
                allowBomb: spec.bombs && bombsPlaced < 1 && p > 0.35 && p < 0.7
            });
            if (used < 0) { bombsPlaced++; used = -used; }
        }

        if (used <= 0) used = crEmitRun(level, w, 4);
        sinceCharge += (w.col - before);

        // The band is the lane rule, and it is enforced AFTER the segment so a
        // segment never has to know about it. A route pushed out of its band
        // is pulled back by the next one.
        if (w.row < band.lo) w.row = band.lo;
        if (w.row > band.hi) w.row = band.hi;
    }

    crApproach(level, w, targetRow);
    return w.route;
}

// Segment choice. Returns columns consumed, or the NEGATIVE of that when it
// placed a bomb wall (so the caller can count them) -- cheaper than a second
// return value in a file where every name is global.
function crEmitWeighted(level, w, rng, spec, band, t, ctl) {
    var room = band.hi - w.row;        // how far down there is space
    var head = w.row - band.lo;        // how far up there is space

    var opts = [];
    function opt(weight, fn) { if (weight > 0) opts.push({ wgt: weight, fn: fn }); }

    opt(2.0 - t, function () { return crEmitRun(level, w, 4 + (rng() * 4 | 0)); });
    opt(1.6 + 1.2 * t, function () {
        var gap = 2 + (rng() * 2 | 0);                      // 2..3 tiles
        var dRow = 0;
        var roll = rng();
        if (roll < 0.33 && head >= 2) dRow = -(1 + (rng() * 2 | 0));
        else if (roll < 0.66 && room >= 2) dRow = 1 + (rng() * 2 | 0);
        return crEmitGap(level, w, gap, dRow);
    });
    opt(head >= 2 ? 0.9 : 0, function () { return crEmitGap(level, w, 1, -(1 + (rng() * 2 | 0))); });
    opt(room >= 3 ? 1.0 : 0, function () { return crEmitGap(level, w, 1 + (rng() * 2 | 0), 2 + (rng() * 2 | 0)); });

    // Level 2 on: the collapsing blocks.
    if (spec.index >= 1) {
        opt(0.5 + 1.3 * t, function () {
            return crEmitCrumble(level, w, 2 + (rng() * 3 | 0), rng() < 0.45);
        });
        opt(0.4 + 0.7 * t, function () {
            var gap = 3 + (rng() * 3 | 0);                  // 3..5, against 7.4 of spring
            var dRow = head >= 3 && rng() < 0.5 ? -(2 + (rng() * 2 | 0)) : (room >= 2 ? 1 : 0);
            return crEmitBranch(level, w, gap, dRow);
        });
    }
    // Level 3 on: the wind tunnels.
    if (spec.index >= 2) {
        opt(0.35 + 0.8 * t, function () {
            var gap = 3 + (rng() * 3 | 0);
            var dRow = head >= 2 && rng() < 0.5 ? -(1 + (rng() * 2 | 0)) : 0;
            return crEmitVent(level, w, gap, dRow);
        });
    }
    // Level 4 on: the chimneys.
    if (spec.shafts && head >= 4) {
        opt(0.9 * t + 0.2, function () { return crEmitShaft(level, w, 3 + (rng() * 2 | 0)); });
    }
    // Level 6 on: the bomb walls, at most one per route.
    if (ctl.allowBomb && head >= 3) {
        opt(1.4, function () { return -crEmitBreakable(level, w); });
    }

    var total = 0, i;
    for (i = 0; i < opts.length; i++) total += opts[i].wgt;
    var pick = rng() * total;
    for (i = 0; i < opts.length; i++) {
        pick -= opts[i].wgt;
        if (pick <= 0) return opts[i].fn();
    }
    return crEmitRun(level, w, 4);
}

// ===================================================
//   DECORATION
// ===================================================
// Non-route rock, and the one hazard that is NOT a helper: a crosswind blowing
// back toward the avalanche. The spec asks for constant directional gusts, and
// a gust that only ever helps is not a hazard, so some of them push the wrong
// way. Applied at 35% on the ground (you are braced) and in full in the air,
// which is where it can actually take a jump away from you.
function crDecorate(level, rng) {
    var spec = level.spec;
    if (spec.index < 3) return;
    var count = 1 + (spec.difficulty * 3 | 0);
    for (var i = 0; i < count; i++) {
        var col = CR_START_COLS + 10 + (rng() * (level.finishCol - CR_START_COLS - 30) | 0);
        var row = CR_ROW_MIN + (rng() * (CR_ROW_MAX - CR_ROW_MIN) | 0);
        // Only hang a vent off something solid -- it is an opening IN the
        // cliff, so it needs cliff to be an opening in.
        var anchor = -1;
        for (var r = row; r <= CR_ROW_MAX; r++) {
            if (crTileSolid(crGet(level, col, r))) { anchor = r; break; }
        }
        if (anchor < 0) continue;
        crSet(level, col, anchor, CR_T.VENT);
        level.vents.push({ col: col, row: anchor, dir: "left" });
        level.gusts.push({
            x: (col - 5) * CR_TILE, y: (anchor - 4) * CR_TILE,
            w: 6 * CR_TILE, h: 4 * CR_TILE,
            ax: -300, ay: 0, dir: "left", strength: 1
        });
    }
}

// ===================================================
//   BUILD
// ===================================================
function crBuildLevel(index) {
    var spec = crLevelSpec(index);
    var rng = crRng(spec.seed);

    var level = {
        index: index,
        spec: spec,
        cols: spec.cols,
        rows: CR_ROWS,
        tiles: new Uint8Array(spec.cols * CR_ROWS),
        finishCol: spec.cols - CR_END_COLS,
        routes: [],
        catwalks: [],
        vents: [],
        gusts: [],
        coins: [],
        pickups: [],
        spawns: [],
        worldW: spec.cols * CR_TILE,
        objective: "REACH THE OUTPOST"
    };

    // Outposts FIRST: crSpan refuses to overwrite a catwalk, so placing them
    // up front is what protects the finish from a route that wanders into it.
    crBuildOutpost(level, "start");
    crBuildOutpost(level, "end");

    for (var lane = 0; lane < 4; lane++) {
        level.routes.push(crBuildRoute(level, lane, rng));
        level.spawns.push({
            x: (CR_START_COLS - 6) * CR_TILE,
            y: crStandY(CR_LANE_ROWS[lane])
        });
    }

    crDecorate(level, rng);

    if (spec.bombs) level.objective = "BOMB THROUGH · REACH THE OUTPOST";
    else if (spec.shafts) level.objective = "CLIMB THE CHIMNEYS · REACH THE OUTPOST";
    else if (index >= 2) level.objective = "RIDE THE GUSTS · REACH THE OUTPOST";

    return level;
}

// ===================================================
//   QUERIES THE REST OF THE GAME USES
// ===================================================
function crTileAt(level, px, py) {
    var c = Math.floor(px / CR_TILE);
    var r = Math.floor(py / CR_TILE);
    return crGet(level, c, r);
}

// The gust acceleration at a point, summed -- overlapping vents add up, which
// is the simplest rule and the one a player can predict.
function crGustAt(level, px, py, onGround) {
    var ax = 0, ay = 0;
    for (var i = 0; i < level.gusts.length; i++) {
        var g = level.gusts[i];
        if (px < g.x || px > g.x + g.w || py < g.y || py > g.y + g.h) continue;
        var scale = onGround ? 0.35 : 1;
        ax += g.ax * scale;
        ay += g.ay * scale;
    }
    return { ax: ax, ay: ay };
}

// Distance from a point to the nearest gust rect, for the wind voice's gain.
function crNearestGust(level, px, py) {
    var best = 1e9, bestG = null;
    for (var i = 0; i < level.gusts.length; i++) {
        var g = level.gusts[i];
        var dx = Math.max(g.x - px, 0, px - (g.x + g.w));
        var dy = Math.max(g.y - py, 0, py - (g.y + g.h));
        var d = Math.sqrt(dx * dx + dy * dy);
        if (d < best) { best = d; bestG = g; }
    }
    return { dist: best, gust: bestG };
}
