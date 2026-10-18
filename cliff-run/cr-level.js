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

// Playable rows of the 16 the 24px grid gives us. Row 15 is deliberately void:
// it is what makes falling off the bottom of the cliff possible. On levels 1-2
// crSafeFloor fills it, so the void does not exist yet (see crLevelSpec).
var CR_ROW_MIN = 1;
var CR_ROW_MAX = 14;

// The four lane stand-rows, top to bottom. This order IS the spawn order the
// spec asks for: P1 top-left, P2 upper-middle, P3 lower-middle, P4 lower-left.
// THREE ROWS APART, not four: with crThicken filling the space between them,
// that leaves one-row corridors separated by two rows of rock, which is where
// "claustrophobic" comes from.
var CR_LANE_ROWS = [3, 6, 9, 12];

/* The near tower is narrow and the far one is wide, and the asymmetry is on
   purpose. The start is a door you leave through, so it should cost as little
   of a 20-tile screen as possible -- at 8 columns it ate a third of the view
   on the one level where you are still working out the controls. The finish is
   a destination four people park on, so its catwalk has to be long enough to
   hold all four without the first arrival blocking the door (crFinishBody). */
var CR_START_COLS = 6;       // the near outpost
var CR_END_COLS = 11;        // the far outpost
var CR_THICK = 3;            // how far a solid tile grows downward; see crThicken

function crStandY(row) { return row * CR_TILE - CR_PH; }

// ===================================================
//   REACHABILITY — DERIVED, NOT PICKED
// ===================================================
/*
 * How far a body travels horizontally before it is back level with a landing
 * `dRow` rows from where it launched. Solved from CR_PHYS rather than written
 * down, so changing a jump number re-derives every cap in this file instead of
 * silently invalidating them.
 *
 *     rise(t) = v*t - g*t^2/2 , want rise(t) = -dRow*TILE , take the LATER root
 *     reach   = moveSpeed * t
 *
 * WHY THIS EXISTS. The first version used one flat cap: "gaps <= 3 tiles,
 * step-ups <= 2 rows, against a 4.2-tile jump range". Both halves are true and
 * the combination is not -- the 4.2 tiles is the range at the SAME height, and
 * a jump that also has to end two rows higher only has 2.97 tiles of it. The
 * generator was emitting 3-tile gaps with a 2-row rise, which needs 48px of
 * travel inside a window that closes at 47.5px. Half a pixel short, every
 * time, on a route the bots were told was walkable.
 *
 * CR_REACH_SAFETY keeps the cap well inside the arc. The margin is not
 * politeness: a bot jumps on a tile boundary rather than on a frame, the
 * avalanche-panic layer may dash mid-arc, a crosswind may be blowing, and
 * another player may shove you at the apex. 0.72 is what survives all four.
 */
var CR_REACH_SAFETY = 0.72;

function crReach(launchVel, dRow, speed) {
    var g = CR_PHYS.gravity;
    var v = -launchVel;                 // upward speed, positive
    var h = -dRow * CR_TILE;            // positive when the landing is higher
    var disc = v * v - 2 * g * h;
    if (disc < 0) return 0;             // that height is not reachable at all
    var t = (v + Math.sqrt(disc)) / g;
    // `speed` because a branch throws you forward at CR_PHYS.springVx, not at
    // walking pace -- sizing its landing against moveSpeed puts the platform
    // where the body no longer is.
    return (speed || CR_PHYS.moveSpeed) * t;
}

// The apex of a launch, in whole rows. Used to ask whether the airspace a
// branch needs belongs to anybody else.
function crApexRows(launchVel) {
    var v = -launchVel;
    return Math.ceil((v * v / (2 * CR_PHYS.gravity)) / CR_TILE);
}

// The widest gap, in tiles, that a launch of `launchVel` clears to a landing
// dRow rows away. Never returns 0: a 1-tile gap is a step, not a jump.
function crMaxGap(launchVel, dRow, speed) {
    var px = crReach(launchVel, dRow, speed) * CR_REACH_SAFETY;
    return Math.max(1, Math.floor(px / CR_TILE));
}

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
//   CORRIDORS — WHY FOUR ROUTES IN ONE GRID NEED THEM
// ===================================================
/*
 * All four routes are stamped into the SAME tile array, which is what makes an
 * overlap a genuinely shared platform and is the whole mechanism behind "lanes
 * become intermixed fully by 33%". It also means a later route can write a
 * solid tile straight through an earlier one's path, and the earlier route was
 * already declared walkable by then.
 *
 * The lethal shapes, all three seen in the traces:
 *   - a chimney's wall column (4-6 tiles tall) crossing a horizontal corridor,
 *     so a bot runs into a wall it has no waypoint for and hops at it until the
 *     avalanche arrives;
 *   - a bomb wall's 3-tile column doing the same;
 *   - an ordinary platform laid ONE row above another route's platform, which
 *     is a ceiling at head height: the body is 14px tall and the tile above its
 *     feet is 16px up, so it simply cannot pass.
 *
 * So each route, as it is built, reserves the three rows above its standing row
 * as CORRIDOR, and every later route checks two things before it commits to a
 * row: that its own platform would not land inside somebody's corridor, and
 * that its own corridor is not already full of somebody's platform. Three rows
 * because CR_PHYS.jumpVel clears 2.37 of them -- a corridor that only protects
 * walking makes every jump a gamble on what the next lane built.
 */
/*
 * HOW MUCH AIR A ROUTE RESERVES DEPENDS ON WHAT IT IS DOING THERE.
 *
 * One row is the floor and it is non-negotiable: a 14px body on a 16px grid
 * occupies exactly ONE row -- the row above its platform -- so a tile there is
 * not a "ceiling", it is where the player IS, and it is the only cell that
 * makes a corridor truly impassable.
 *
 * A uniform depth was tried both ways and both were wrong:
 *
 *     3 rows everywhere -> 57% of bots finish, and the levels came out as five
 *                          unbroken shelves spanning the screen. Four lanes
 *                          claiming platform + 3 want 16 of the 15 playable
 *                          rows, so crRowUsable rejected nearly every segment
 *                          that changed row and crEmitRun was all that fitted.
 *                          The metric went up because the game got boring.
 *     1 row everywhere  -> varied levels, 36% finish. Jumps clipped other
 *                          lanes' platforms at the apex and the fall count per
 *                          level roughly doubled.
 *
 * So the depth travels with the segment. A flat run needs the one row it
 * stands in. A jump needs the arc it passes through, which is why CR_HEADROOM
 * is sized from CR_PHYS.jumpVel's 2.37-row apex. A branch needs its own,
 * taller arc. A chimney needs a box, which crMarkBox handles separately.
 *
 * This is the same discipline as crMaxGap: ask the physics what the segment
 * costs instead of picking a number that covers the worst case everywhere.
 */
var CR_CORRIDOR_ROWS = 1;                               // the body's own row
var CR_HEADROOM = 3;                                    // a jump arc: 2.37 rows, rounded up

/*
 * A reservation is stamped with WHOSE it is (lane + 1), not with a flag, and
 * that detail is the whole difference between this working and flattening every
 * route into a straight line. A route marks the three rows above its own
 * platform; if it then had to respect its own marks it could never step UP,
 * because the row it wants to climb to is by definition inside the corridor it
 * just reserved. So a route ignores its own id and respects everyone else's.
 *
 * level.buildLane carries the owner rather than threading a `lane` argument
 * through nine emitters that have no other use for it.
 */
function crMarkCorridor(level, c0, c1, row, rows) {
    var mine = (level.buildLane | 0) + 1;
    var lo = Math.max(0, row - (rows || CR_CORRIDOR_ROWS));
    for (var c = Math.max(0, c0); c <= c1 && c < level.cols; c++) {
        for (var r = lo; r <= row - 1; r++) {
            var k = crIdx(level, c, r);
            if (!level.clear[k]) level.clear[k] = mine;
        }
    }
}

/*
 * CR_SHARED is the owner id for ground EVERY route is meant to stand on -- the
 * bottlenecks. Without it the reservation does exactly the wrong thing at a
 * gate: lane 0 arrives, claims the corridor, and lanes 1-3 then read it as
 * somebody else's and route around the one place they were supposed to meet.
 */
var CR_SHARED = 255;

function crForeignClear(level, col, row) {
    var v = level.clear[crIdx(level, col, row)];
    return v !== 0 && v !== CR_SHARED && v !== (level.buildLane | 0) + 1;
}

function crMarkShared(level, c0, c1, row, rows) {
    var lo = Math.max(0, row - (rows || CR_CORRIDOR_ROWS));
    for (var c = Math.max(0, c0); c <= c1 && c < level.cols; c++) {
        for (var r = lo; r <= row; r++) level.clear[crIdx(level, c, r)] = CR_SHARED;
    }
}

// Could this route stand on `row` across [c0, c1] without blocking anyone or
// being blocked? Checked BEFORE a segment commits, which is the only moment the
// answer can still change anything.
function crRowUsable(level, c0, c1, row, rows) {
    if (row < CR_ROW_MIN || row > CR_ROW_MAX) return false;
    var lo = Math.max(0, row - (rows || CR_CORRIDOR_ROWS));
    for (var c = Math.max(0, c0); c <= c1 && c < level.cols; c++) {
        if (crForeignClear(level, c, row)) return false;
        for (var r = lo; r <= row - 1; r++) {
            if (crTileSolid(crGet(level, c, r))) return false;
        }
    }
    return true;
}

/*
 * A rectangle this route wants to own outright: the chimney's shaft, or a bomb
 * wall's column. crBoxFree asks whether it is available; crMarkBox takes it.
 *
 * BOTH HALVES ARE NEEDED AND ONLY THE FIRST EXISTED. A chimney was checked for
 * clearance when it was placed and then left unreserved, so a later lane was
 * free to lay a platform inside it -- through the climb, or as a ledge halfway
 * up that the route has no waypoint for. A/B over 10 seeds: removing chimneys
 * and bomb walls outright was worth +18 and +23 points of bot finish rate, and
 * each took the structural flaw count from 47 to 2. They are the two features
 * that put a tall solid column into a shared 18-row grid, which is the most
 * disruptive thing this generator can do.
 */
function crMarkBox(level, c0, c1, r0, r1) {
    var mine = (level.buildLane | 0) + 1;
    for (var c = Math.max(0, c0); c <= c1 && c < level.cols; c++) {
        for (var r = Math.max(0, r0); r <= r1 && r < CR_ROWS; r++) {
            var k = crIdx(level, c, r);
            if (!level.clear[k]) level.clear[k] = mine;
        }
    }
}

function crBoxFree(level, c0, c1, r0, r1) {
    if (r0 < 0 || r1 >= CR_ROWS) return false;
    for (var c = Math.max(0, c0); c <= c1 && c < level.cols; c++) {
        for (var r = r0; r <= r1; r++) {
            if (crGet(level, c, r) !== CR_T.EMPTY) return false;
            if (crForeignClear(level, c, r)) return false;
        }
    }
    return true;
}

// The last resort, used only when no row in the band is usable: take the
// corridor by force. The repair pass in crBuildLevel then re-places anything
// this broke, so a route can never be left with a hole under a waypoint.
function crClearCorridor(level, c0, c1, row, rows) {
    var lo = Math.max(0, row - (rows || CR_CORRIDOR_ROWS));
    for (var c = Math.max(0, c0); c <= c1 && c < level.cols; c++) {
        for (var r = lo; r <= row - 1; r++) {
            if (crGet(level, c, r) === CR_T.CATWALK) continue;
            crSet(level, c, r, CR_T.EMPTY);
        }
    }
}

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
        /* THE CATWALK CLAIMS THE AIR ABOVE IT, and forgetting this buried
           three of the four spawns. crThicken grows every solid tile downward,
           and a catwalk is solid: lane 0's at row 3 filled rows 4 and 5 across
           the whole outpost, and row 5 is where lane 1's body stands. Seats
           2-4 spawned INSIDE rock, were squeezed sideways out of the structure
           by crMoveX, and the avalanche had them before the countdown finished.
           Zero falls, every bot dead to the wall, on every level. */
        level.buildLane = i;
        crMarkCorridor(level, c0 - 1, c1 + 1, row);
        level.catwalks.push({ col0: c0, col1: c1, row: row, lane: i, finish: !isStart });
        // The mast each catwalk hangs off. Decorative, but it is solid, which
        // is what stops a player walking off the back of the structure.
        var mastCol = isStart ? c0 - 1 : c1 + 1;
        crColumn(level, mastCol, row, Math.min(CR_ROW_MAX, row + 1), CR_T.OUTPOST);
    }
    // The spine: the comms tower itself, against the cliff edge.
    var spine = isStart ? 1 : level.cols - 2;
    crColumn(level, spine, CR_ROW_MIN, CR_ROW_MAX, CR_T.OUTPOST);
}

function crIsFinishTile(level, col, row) {
    return crGet(level, col, row) === CR_T.CATWALK && col >= level.finishCol;
}

/*
 * BOTTLENECKS -- the fix for "95% of the game is walking in a straight line".
 *
 * The diagnosis is structural, not cosmetic. The generator built FOUR private
 * routes, one per lane, that only crossed by accident. Four players each in
 * their own corridor is four parallel single-player games sharing a screen:
 * nobody is ever in your way, nothing is ever contested, and the only thing
 * your neighbours affect is the scoreboard. No amount of extra verbs fixes
 * that, because the problem is that there is nothing to have a verb AT.
 *
 * So the run is now punctuated by GATES: short stretches of ground, at one row,
 * that EVERY route is routed through. The four of you converge, squeeze onto
 * the same ledge, bounce off each other (cr-physics.js already makes bodies
 * springy and a stationary one a wall), and come out the other side in a
 * different order than you went in. That is the dogpiling the user asked for,
 * and it arrives from geometry rather than from a scripted event.
 *
 * Between gates each lane is pushed toward a DIFFERENT technique (w.prefer),
 * so the stretch you take to the next bottleneck is a spring run while your
 * neighbour's is a chimney -- "primary paths with slightly different methods
 * of getting through at certain points".
 *
 * The gate rows deliberately move around the cliff, because a bottleneck at
 * the same height every time is just a corridor with a wide bit.
 */
/* FEWER, AND THEREFORE WORTH MORE. At 19 and 22 columns a 64-86 column level
   got three or four bottlenecks, and between the shaft each one cuts and the
   convergence each one forces there was no room left for the stretches they
   were supposed to punctuate -- the level became the gates. At 40 there are
   one or two: enough that the four of you are thrown together at least once a
   level, few enough that the rest of the level is still a level. */
var CR_GATE_SPACING = 40;       // columns between bottlenecks
var CR_GATE_APPROACH = 14;      // columns a walker is given to reach one

function crBuildGates(level, rng, runStart, runEnd) {
    var gates = [];
    var lo = CR_ROW_MIN + 2, hi = CR_ROW_MAX - 1;
    var prev = Math.round((lo + hi) / 2);
    for (var col = runStart + 14; col < runEnd - 12; col += CR_GATE_SPACING) {
        /* EACH GATE IS A SHORT HOP FROM THE LAST, two to four rows, never a
           free pick anywhere on the cliff.
           The first version rolled the row at random over the whole height,
           which reads fine on paper and is a disaster in motion: a walker that
           has to climb eleven rows to the next bottleneck spends the entire
           stretch climbing at two rows a jump, there is no room left for the
           technique the stretch was supposed to be about, and the avalanche
           takes everyone. Measured: bot finish 53% -> 25%, almost all of it
           avalanche deaths.
           Two rows minimum keeps the vertical movement; four maximum keeps it
           affordable. */
        /* A GATE SITS LOW, so every lane reaches it by FALLING INTO IT.
           Climbing to a shared ledge was the first design and it does not
           survive four lanes: each built its own staircase over the same
           fourteen columns at four different heights, so lane 1's step landed
           in lane 0's body row. crVerifyRoutes went from ~13 flaws over eighty
           levels to 512, and "ceiling at head height" means a body literally
           cannot be where its route says it is.
           Dropping needs no geometry of its own, cannot collide with anybody
           else's, and the bots already do it without being told. It also reads
           better: four people falling into the same pit IS the dogpile.

           THE LEDGE SITS MID-CLIFF, not at the bottom. Putting it low makes
           every drop free and every exit enormous: after the bottleneck all
           four lanes had to climb back up ten rows, which is where the pace
           went. Mid-height means a short drop in and a short climb out. */
        var mid = Math.round((lo + hi) / 2);
        var row = crClamp(mid + ((rng() * 3 | 0) - 1), lo, hi);
        if (Math.abs(row - prev) < 2) row = crClamp(row + 2, lo, hi);
        prev = row;
        gates.push({ col: col, row: row, w: 4 + (rng() * 3 | 0) });
    }
    return gates;
}

/*
 * The shared ledge itself. Emitted idempotently -- whichever walker reaches it
 * first lays the tiles, the rest simply walk onto them -- and marked CR_SHARED
 * so the reservation lets everyone in.
 */
function crEmitGate(level, w, gate) {
    /* IT BRIDGES ITS OWN APPROACH, and leaving that out put the band-clamp bug
       straight back into the file. The walker is given CR_GATE_APPROACH
       columns to climb to the gate row; if it needed more -- lane 3 starting
       at row 12 with a gate at row 5 needs seven one-row steps, twenty-one
       columns -- it simply arrived at the gate still at the wrong height, and
       `w.row = gate.row` then moved the WALKER without building anything to
       walk on. The route was a waypoint list across a hole, which is the exact
       shape of the first bug this generator ever had. Lane 3 finished 0% of
       the time, on every level.
       So the staircase is finished here, however many columns that takes. The
       approach window only decides whether it looks graceful. */
    /* THE SHAFT. Everything above the ledge, across the gate's columns, is cut
       away and handed to CR_SHARED -- so any lane at any height can walk off
       its own corridor and drop straight in, and no later route may build in
       the space they all fall through. This is the whole approach: there is no
       staircase to collide with because there is no staircase. */
    var sc0 = gate.col - 1, sc1 = gate.col + gate.w + 1;
    // Only as tall as a lane might be dropping from. A shaft to the top of
    // the cliff severs every corridor it passes, which is a lot of geometry to
    // destroy for an entrance nobody uses from that height.
    var sTop = Math.max(CR_ROW_MIN - 1, gate.row - 6);
    for (var sr = sTop; sr < gate.row; sr++) {
        for (var sc = sc0; sc <= sc1; sc++) {
            if (crGet(level, sc, sr) === CR_T.CATWALK) continue;
            crSet(level, sc, sr, CR_T.EMPTY);
        }
    }
    crMarkShared(level, sc0, sc1, gate.row, gate.row);

    // Coming from BELOW is the one case a drop cannot serve, so the walker
    // steps up inside the shared shaft, where nothing of anyone else's is.
    var guard = 0;
    while (w.row > gate.row && guard++ < 16) {
        w.row -= 1;
        crSpan(level, w.col, w.col + 2, w.row, CR_T.STONE);
        w.col += 3;
        crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    }

    var c0 = Math.max(gate.col - 1, w.col);
    var c1 = c0 + gate.w + 1;
    crClearCorridor(level, c0, c1, gate.row, CR_HEADROOM);
    crSpan(level, c0, c1, gate.row, CR_T.STONE);
    crMarkShared(level, c0, c1, gate.row, CR_HEADROOM);

    crWp(w.route, c0 * CR_TILE, gate.row, "walk", { gate: true });
    w.col = c1 + 1;
    w.row = gate.row;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    return gate.w + 2;
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
    w.claimRows = CR_CORRIDOR_ROWS;      // flat ground needs only the body's row
    crSpan(level, w.col, w.col + len - 1, w.row, tile);
    w.col += len;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk",
         tile === CR_T.CRUMBLE ? { noStop: true } : null);
    return len;
}

// A plain jump. The gap is clamped against crMaxGap for THIS dRow, so a caller
// cannot ask for a rise and a width that are each fine and together are not.
/*
 * `allowDj` lets this gap be sized against the DOUBLE jump instead of the plain
 * one, so it cannot be crossed without a charge in hand. That is the late-level
 * risk the brief asks for, and it is also the thing that gives the charge a
 * decision attached to it: you can spend it to climb, or save it for the next
 * gap, and only one of those is right.
 */
function crEmitGap(level, w, gap, dRow, allowDj) {
    var launchVel = allowDj ? CR_PHYS.jumpVel + CR_PHYS.doubleJumpVel * 0.9 : CR_PHYS.jumpVel;
    gap = Math.min(gap, crMaxGap(launchVel, dRow));
    w.claimRows = CR_HEADROOM;           // the arc passes through here

    var launch = crLaunchX(w.col - 1);
    crWp(w.route, launch, w.row, "jump", { gap: gap, dRow: dRow, needDj: !!allowDj && gap > 2 });
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
/*
 * NEVER CONVERTS SOMEBODY ELSE'S GROUND. crSpan writes unconditionally, so a
 * crumble run laid across another lane's stone platform silently turned their
 * guaranteed footing into blocks that fall -- and if their neighbour got there
 * first and triggered them, into a hole. The corridor reservation does not
 * catch this: it protects the rows ABOVE a platform, and this is the platform
 * row itself.
 *
 * So the collapsing tiles only go into cells that are empty. Where another
 * lane has already built, the two routes simply share that stone.
 */
function crCrumbleSpan(level, c0, c1, row, code) {
    for (var c = c0; c <= c1; c++) {
        if (crGet(level, c, row) !== CR_T.EMPTY) continue;
        crSet(level, c, row, code);
    }
}

function crEmitCrumble(level, w, len, timed) {
    var code = timed ? CR_T.TIMED : CR_T.CRUMBLE;
    w.claimRows = CR_CORRIDOR_ROWS;      // crossed at a run, not jumped
    // A solid tile either side, so the player always has somewhere to take off
    // from and somewhere to arrive. Without the landing tile a late jump off
    // the last crumbling block is an unavoidable death.
    crSpan(level, w.col, w.col, w.row, CR_T.STONE);
    crCrumbleSpan(level, w.col + 1, w.col + len, w.row, code);
    crSpan(level, w.col + len + 1, w.col + len + 3, w.row, CR_T.STONE);
    crWp(w.route, w.col * CR_TILE, w.row, "walk", { noStop: !timed, hazard: true });
    w.col += len + 4;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    return len + 4;
}

/*
 * A ONE-BLOCK-TALL SQUEEZE. "There should be gaps only a single block tall."
 *
 * Floor at w.row, the body's own row (w.row - 1) carved, and ROCK at w.row - 2.
 * A 16px body fits a 24px opening with 8px to spare; a jump does not fit at
 * all, because CR_PHYS.jumpVel wants 1.75 rows and there is one.
 *
 * It is the most strategic thing a corridor can be in a game whose other three
 * players are solid: inside a squeeze you cannot jump, cannot be bounced over,
 * and cannot turn a mistake into a detour. You commit to it before you enter.
 */
function crEmitTunnel(level, w, len) {
    w.claimRows = CR_CORRIDOR_ROWS;
    crSpan(level, w.col, w.col + len - 1, w.row, CR_T.STONE);
    crSpan(level, w.col, w.col + len - 1, w.row - 2, CR_T.STONE);
    // Claim the roof as well as the floor, so no later route plans an arc
    // through the one place in the level that has no headroom.
    crMarkBox(level, w.col, w.col + len - 1, w.row - 2, w.row - 1);
    crWp(w.route, w.col * CR_TILE, w.row, "walk", { squeeze: true });
    w.col += len;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    return len;
}

// A tree branch. Springs you on any contact from above (cr-physics.js), which
// is a trampoline rather than a timed input -- chosen so the bots can use it,
// and it reads better for a person too. Clears up to 5 tiles against a
// 7.4-tile spring range.
/*
 * THE LANDING PLATFORM IS SIZED TO THE ARC, not placed at a chosen gap, and
 * that is the opposite problem from crEmitGap's.
 *
 * A branch is not a jump you aim -- it is a fixed impulse. CR_PHYS.springVel
 * carries a body 7.7 tiles, and 8.75 if the player was holding jump on contact
 * (CR_PHYS.springHeldBonus). The first version placed a 3-to-5-tile platform
 * after a 3-to-5-tile gap, so the arc ended PAST its far edge: the body sailed
 * over the landing and into whatever came next, which on this cliff is usually
 * a hole. The traces showed bots still airborne and two rows high when they
 * reached the following waypoint, unable to jump, falling into the gap after.
 *
 * So the gap is whatever is left after reserving the far end of the arc, and
 * the platform covers the arc's end plus three tiles of slack -- enough for
 * both the held and the unheld case to land on it.
 */
function crEmitBranch(level, w, dRow) {
    var reach = Math.ceil(crReach(CR_PHYS.springVel + CR_PHYS.springHeldBonus, dRow,
                                  CR_PHYS.springVx) / CR_TILE);
    if (reach < 6) return 0;                        // that height is not springable
    var gap = Math.max(3, reach - 4);
    var len = (reach + 3) - gap;

    w.claimRows = crApexRows(CR_PHYS.springVel + CR_PHYS.springHeldBonus) + 1;
    crSet(level, w.col, w.row, CR_T.BRANCH);
    crWp(w.route, crLaunchX(w.col), w.row, "spring", { gap: gap, dRow: dRow });
    w.col += 1 + gap;
    w.row += dRow;
    crSpan(level, w.col, w.col + len - 1, w.row, CR_T.STONE);
    w.col += len;
    crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    return 1 + gap + len;
}

/*
 * A wind tunnel across a gap far too wide to jump. The vent is a lip of rock
 * jutting into the void one row down, so it never blocks the run above it, and
 * the gust is a RECT of constant acceleration -- "constant & directional", so
 * it is deterministic, which is what makes it something a bot can plan through.
 *
 * ay IS -755 AGAINST A GRAVITY OF 760, AND THAT IS THE WHOLE DESIGN: the gust
 * very nearly cancels your weight, so you walk off the edge and KEEP GOING
 * LEVEL, sinking 2px over a second. The first version used -820 (a net lift of
 * 60) and had the bot jump into it. Measured: entering at the jump's -240 with
 * nothing to decay it, a body rose 127px -- eight tiles -- straight past the
 * top of the rect and off the route, every time. A gust that cancels gravity
 * is a floor you cannot see; a gust that beats it is a cannon.
 *
 * The rect is only three rows tall for the same reason: if a player DOES jump
 * in (and a player will), the exit through the top is immediate and the arc
 * resumes normally, instead of coasting upward until the level runs out.
 */
function crEmitVent(level, w, gap) {
    w.claimRows = 2;                     // you cross a gust level, not over it
    var ventCol = w.col;
    var ventRow = Math.min(CR_ROW_MAX, w.row + 1);
    crSet(level, ventCol, ventRow, CR_T.VENT);
    level.vents.push({ col: ventCol, row: ventRow, dir: "up" });

    var gx = (ventCol + 1) * CR_TILE;
    var gw = gap * CR_TILE;
    var gTopRow = Math.max(0, w.row - 2);
    level.gusts.push({
        x: gx, y: gTopRow * CR_TILE,
        w: gw, h: (ventRow + 1 - gTopRow) * CR_TILE,
        /* ay IS -790 AGAINST A GRAVITY OF 760, so the net is a 30 px/s^2 LIFT
           rather than the dead cancel it was. -755 looked right on paper --
           cross the gap exactly level -- and was the worst feature in the game
           by measurement (A/B: removing vents entirely took bot finish from
           33% to 46%). The reason is a one-pixel problem at the far end: the
           body flies at y = row*TILE - CR_PH, so its feet are exactly on the
           landing platform's top surface, and crMoveX's row scan then catches
           the platform's SIDE the moment the body has sagged a single pixel.
           It slams into the edge of its own landing and drops into the gap.
           A 30 px/s^2 lift puts it 5-10px high on arrival -- it clears the lip
           and falls onto the platform, which is what landing is. */
        ax: 80, ay: -790,
        dir: "up", strength: 1
    });

    crWp(w.route, crLaunchX(ventCol), w.row, "gust", { gap: gap, dRow: 0 });
    w.col += 1 + gap;
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
    // The climb belongs to this route now. Without this a later lane may lay a
    // platform inside the chimney -- through the route, or as a ledge halfway
    // up that nothing has a waypoint for.
    crMarkBox(level, col, col + 5, Math.max(0, rTop - 2), w.row);

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
    // Two tiles tall: 48px against a 42px jump apex, so it cannot be hopped --
    // but a double-jump charge CAN clear it, and that alternative is left in
    // rather than patched out.
    crColumn(level, wallCol, w.row - 2, w.row - 1, CR_T.BREAK);
    crSpan(level, wallCol, wallCol, w.row, CR_T.STONE);
    // The wall, plus the two columns either side: you have to be able to walk
    // up to it, set a bomb down and back off, and none of that works if
    // another lane builds into the space while you are standing in it.
    crMarkBox(level, wallCol - 2, wallCol + 2, Math.max(0, w.row - 4), w.row);
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
        // The staircase takes its corridor: it is the guarantee that the level
        // is finishable, so nothing else is allowed to stand in it.
        crClearCorridor(level, w.col, w.col + 1, w.row);
        crSpan(level, w.col, w.col + 1, w.row, CR_T.STONE);
        crMarkCorridor(level, w.col, w.col + 1, w.row);
        w.col += 2;
        crWp(w.route, (w.col - 1) * CR_TILE, w.row, "walk", null);
    }
    // Bridge whatever columns remain, so the catwalk is walked ONTO rather
    // than jumped at. "walk on to them" is how the spec phrases the finish.
    if (w.col < level.finishCol) {
        crClearCorridor(level, w.col, level.finishCol - 1, targetRow);
        crSpan(level, w.col, level.finishCol - 1, targetRow, CR_T.STONE);
        crMarkCorridor(level, w.col, level.finishCol - 1, targetRow);
    }
    crWp(w.route, level.finishCol * CR_TILE + 8, targetRow, "finish", null);
}

// ===================================================
//   ONE LANE'S ROUTE
// ===================================================
/*
 * ALL FOUR ROUTES ARE BUILT IN LOCKSTEP, one segment each, round-robin.
 *
 * They used to be built one lane at a time, start to finish, and that gave the
 * lanes a strict pecking order: lane 0 wrote into an empty cliff and lane 3
 * wrote into whatever was left. Measured over 400 lane-runs it showed up as a
 * clean gradient in how often a bot got out --
 *
 *     lane 0: 61%   lane 1: 42%   lane 2: 34%   lane 3: 25%
 *
 * -- and in how often its route came out structurally flawed (2 / 4 / 11 / 23).
 * That is a build-order artefact, not a design, and it is unfair in the one
 * place the game cannot afford it: lane 3 is a player's seat.
 *
 * Stepping the four walkers together means they compete for the same cliff at
 * the same x, so no lane is systematically last. The reservation logic is
 * unchanged -- level.buildLane just moves between walkers instead of between
 * whole passes.
 */
function crBuildRoutes(level, rng) {
    var spec = level.spec;
    var runStart = CR_START_COLS;
    // The run stops well short of the far outpost, and the slack is sized by
    // the worst case crApproach can be handed: fourteen rows of convergence
    // left to do, at two rows per two-column step -- plus the bridge onto the
    // catwalk. Sizing this by eye is how crApproach runs out of cliff and lays
    // its bridge at a row the staircase never reached. On the 24px grid there
    // are only 11 playable rows, so the worst case is much shorter than it was.
    var runEnd = level.finishCol - 16;
    level.gates = crBuildGates(level, rng, runStart, runEnd);
    var walkers = [];
    var lane, w;

    for (lane = 0; lane < 4; lane++) {
        level.buildLane = lane;
        w = {
            lane: lane, col: runStart, row: CR_LANE_ROWS[lane],
            route: [], rng: rng,
            runStart: runStart, runEnd: runEnd, targetRow: CR_LANE_ROWS[lane],
            bombsPlaced: 0, sinceCharge: 0, done: false,
            // Which bottleneck this walker is heading for, and which technique
            // it is being pushed toward on the way there.
            gateIdx: 0, prefer: lane
        };
        // Off the near catwalk and onto the cliff.
        crSpan(level, runStart - 1, runStart + 2, w.row, CR_T.STONE);
        w.col = runStart + 3;
        crWp(w.route, runStart * CR_TILE, w.row, "walk", null);
        crMarkCorridor(level, runStart - 1, runStart + 3, w.row);
        walkers.push(w);
    }

    // The walker that is FURTHEST BEHIND goes next, rather than simply the
    // next in order: segments differ a lot in length (a branch eats fourteen
    // columns, a step eats three), so plain rotation would let a lane that
    // kept drawing short segments fall a long way back and meet the crowded
    // cliff anyway -- which is the bias this is here to remove.
    var guard = 0;
    while (guard++ < 4000) {
        var next = null;
        for (lane = 0; lane < 4; lane++) {
            w = walkers[lane];
            if (w.done) continue;
            if (w.col >= w.runEnd) { w.done = true; continue; }
            if (!next || w.col < next.col) next = w;
        }
        if (!next) break;
        level.buildLane = next.lane;
        crStepRoute(level, next, rng, spec);
    }

    for (lane = 0; lane < 4; lane++) {
        w = walkers[lane];
        level.buildLane = w.lane;
        crApproach(level, w, w.targetRow);
        level.routes[lane] = w.route;
    }
}

// One segment for one walker. This is the body of the old per-lane loop, with
// the state it used to keep in closures moved onto `w` so four of them can be
// in flight at once.
function crStepRoute(level, w, rng, spec) {
    var p = (w.col - w.runStart) / Math.max(1, w.runEnd - w.runStart);
    var band = crBandFor(w.lane, p);
    var t = spec.difficulty;
    var converging = p > 0.78;
    var rowBefore = w.row;
    var before = w.col;

    /* IF THE CURRENT ROW IS NO LONGER USABLE, MOVE BEFORE BUILDING.
       Another lane may have built across this row since this walker's last
       segment, and continuing would lay a platform inside its corridor. The
       search is over the WHOLE playable cliff, not the lane band: the band is
       a style rule about where a lane should prefer to be, and being passable
       beats being tidy. Up is capped at 2 rows (the jump apex) and down at 3
       (falling is free). */
    if (!crRowUsable(level, w.col, w.col + 8, w.row, CR_HEADROOM)) {
        var moved = false;
        for (var off = 1; off <= 10 && !moved; off++) {
            var up = w.row - off, down = w.row + off;
            if (off <= 2 && up >= CR_ROW_MIN && crRowUsable(level, w.col, w.col + 8, up, CR_HEADROOM)) {
                crEmitGap(level, w, 1, -off); moved = true;
            } else if (off <= 3 && down <= CR_ROW_MAX && crRowUsable(level, w.col, w.col + 8, down, CR_HEADROOM)) {
                crEmitGap(level, w, 1, off); moved = true;
            }
        }
        if (moved) {
            crMarkCorridor(level, w.col - 10, w.col - 1, w.row);
            w.sinceCharge += 10;
            return;
        }
        crClearCorridor(level, w.col, w.col + 10, w.row);
    }

    // A double-jump charge every so often. "collectables that allow for a 2nd
    // jump".
    if (w.sinceCharge > 16 + (rng() * 10 | 0)) {
        level.pickups.push({
            kind: "dj",
            x: (w.col + 1) * CR_TILE + 3, y: w.row * CR_TILE - 13
        });
        w.sinceCharge = 0;
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

    /* ---- the next bottleneck comes before anything else.
       Reaching the gate is not optional and not negotiable, so this branch
       TAKES whatever corridor it needs; crRepairRoutes cleans up after it, the
       same bargain crApproach makes at the far outpost. */
    var gate = level.gates[w.gateIdx];
    if (gate && !converging) {
        var toGate = gate.col - w.col;
        // Inside the approach window nothing BUT the gate branch may build,
        // or an ordinary segment lays geometry the shaft is about to cut.
        if (toGate > 0 && toGate <= 2 && w.row < gate.row) {
            crEmitRun(level, w, toGate);
            crMarkCorridor(level, before, w.col - 1, w.row, CR_HEADROOM);
            return;
        }
        if (toGate <= 0) {
            var usedG = crEmitGate(level, w, gate);
            w.gateIdx++;
            // A different technique on the way to the next one, rotated so no
            // two lanes are doing the same thing in the same stretch.
            w.prefer = (w.lane + w.gateIdx) % 5;
            crMarkCorridor(level, before, w.col - 1, w.row, CR_HEADROOM);
            void usedG;
            return;
        }
        // Scaled to the climb: three columns a row, plus a little slack.
        var need = 4 + Math.abs(gate.row - w.row) * 3;
        if (toGate <= CR_GATE_APPROACH && w.row < gate.row) {
            /* Above the gate: run to its EDGE at this height and walk off. The
               shaft crEmitGate cuts is what you fall down.
               The run is clamped so it cannot overshoot into the shaft's
               columns, and that clamp is the whole fix: an approach run that
               spanned the gate laid ground inside the shaft, crEmitGate then
               cut the shaft through it, and crRepairRoutes -- seeing a walk
               waypoint there with nothing under it -- put the ground back.
               The three passes undid each other every level and left every
               level structurally broken. */
            crEmitRun(level, w, Math.max(1, Math.min(5, toGate)));
            crMarkCorridor(level, before, w.col - 1, w.row, CR_HEADROOM);
            return;
        }
    }

    var used = 0;

    if (converging) {
        // Close on the lane row, so the far outpost is reached from the same
        // four heights the near one was left from. This branch TAKES the
        // corridor rather than checking for it: it is a forced march to a
        // fixed row, and crRepairRoutes re-places whatever it breaks.
        var d = w.targetRow - w.row;
        var step = crClamp(d, -2, 3);
        if (!crRowUsable(level, w.col, w.col + 6, w.row + step)) {
            crClearCorridor(level, w.col, w.col + 6, w.row + step);
        }
        if (d !== 0) used = crEmitGap(level, w, 1 + (rng() * 2 | 0), step);
        else used = crEmitRun(level, w, 4 + (rng() * 3 | 0));
    } else {
        used = crEmitWeighted(level, w, rng, spec, band, t, {
            bombsPlaced: w.bombsPlaced,
            allowBomb: spec.bombs && w.bombsPlaced < 1 && p > 0.35 && p < 0.7
        });
        if (used < 0) { w.bombsPlaced++; used = -used; }
    }

    if (used <= 0) {
        // Nothing fitted even at this row: the cliff here belongs to other
        // lanes in every direction. Take four columns of it and let the repair
        // pass put back whatever that cost them -- a route with a hole in it is
        // worse than a route that crowds somebody.
        crClearCorridor(level, w.col, w.col + 4, w.row);
        used = crEmitRun(level, w, 4);
    }
    w.sinceCharge += (w.col - before);

    // Claim what this segment just used, at both of its rows -- a segment that
    // changed row owns the corridor above where it started AND where it ended.
    var claim = w.claimRows || CR_CORRIDOR_ROWS;
    crMarkCorridor(level, before, w.col - 1, rowBefore, claim);
    if (w.row !== rowBefore) crMarkCorridor(level, before, w.col - 1, w.row, claim);

    /* THERE IS DELIBERATELY NO BAND CLAMP HERE, and the first version of this
       file had one. It read:
           if (w.row < band.lo) w.row = band.lo;
       ...which moved the WALKER without building anything at the new row, so
       the next segment's platform appeared up to fourteen rows from the last
       landing with nothing in between. The route was then a list of waypoints
       across a hole. Measured effect: 3% of bot attempts finished a level.

       The band is enforced where it can be honestly enforced instead -- inside
       crEmitWeighted, which only offers a segment whose dRow fits the
       head/room it was handed. Geometry and route stay in step because the
       same call makes both. */
    void band;
}

// Segment choice. Returns columns consumed, or the NEGATIVE of that when it
// placed a bomb wall (so the caller can count them) -- cheaper than a second
// return value in a file where every name is global.
/*
 * THE DIFFICULTY RAMP LIVES IN THESE WEIGHTS, and it is the only thing in the
 * game that gets harder with the level number besides the scroll speed.
 * Isolated by A/B over 10 seeds x 10 levels x 4 bots:
 *
 *     the scroll ramp (40 -> 68 px/s) costs NOTHING   (57% either way)
 *     the bots' own skill jitter costs NOTHING        (48% vs 47%)
 *     the hazard-weight ramp costs 7 points           (48% -> 55% flat)
 *
 * So the curve the player feels is here, the scroll ramp the brief asked for
 * is free, and the jitter is doing its job -- making the bots imperfect
 * without making them fail. The coefficients below are the original ones
 * roughly halved, because the late levels were letting no bot out at all on
 * more than half the seeds, and a level four bots cannot finish is not a
 * difficulty curve.
 */
function crEmitWeighted(level, w, rng, spec, band, t, ctl) {
    var room = band.hi - w.row;        // how far down there is space
    var head = w.row - band.lo;        // how far up there is space

    var opts = [];
    function opt(weight, fn) { if (weight > 0) opts.push({ wgt: weight, fn: fn }); }

    /* HOW MUCH CLIFF IS UNDERNEATH DECIDES HOW MANY HOLES ARE ALLOWED.
     *
     * crThicken makes a fall from an upper lane land on the lane below -- you
     * lose height and position, and cr-bots.js's recovery layer re-acquires
     * whichever route is nearest. A fall from the LOWEST lane has nothing
     * under it and is simply death. Same mistake, two different prices, purely
     * because of where you spawned.
     *
     * Measured: finish rate by lane ran 100 / 75 / 25 / 13 %, monotonic, with
     * the bottom two lanes dying to falls and then to the wall while they
     * tried to climb back. Lockstep building had already removed the other
     * cause of a gradient like that (build order), so what was left was height.
     *
     * So the floor of the cliff is mostly solid ground: within two rows of the
     * bottom, gaps get a third of their weight and plain running gets double.
     * The bottom lane is still the dangerous one to be in -- that is the
     * geometry, and P1 spawning at the top is the compensation -- but it is no
     * longer a route made of things that kill you.
     */
    var exposure = CR_ROW_MAX - w.row;
    var gapW = exposure <= 2 ? 0.35 : 1;
    var runW = exposure <= 2 ? 2 : 1;

    /* WHAT THIS LANE IS BEING PUSHED TOWARD on this stretch. Rotated after
       every bottleneck, so the four of you take four different kinds of route
       to the same place and arrive having done different things -- the
       "slightly different methods of getting through" the user asked for.
       A preference is a 3.5x weight, not a rule: the gates still have to be
       reachable, so a technique that will not fit here is simply not used. */
    function pref(kind) { return w.prefer === kind ? 3.5 : 1; }

    /* EVERY OPTION IS GATED ON THE ROW IT WOULD LAND ON, and the dRow is
       therefore decided HERE rather than inside the closure. The first version
       rolled the dRow inside the emitter, which meant the gate could only be
       applied to the one segment type that never changes row -- and the
       verifier found head-height ceilings in 105 of 120 generated levels.
       A false negative here costs one duller segment; a false positive costs a
       route another lane has already made impassable. */
    function fits(dRow, span, rows) {
        return crRowUsable(level, w.col, w.col + (span || 10), w.row + dRow, rows);
    }

    // ---- flat run
    opt(fits(0, 9, CR_CORRIDOR_ROWS) ? (2.0 - 0.6 * t) * runW : 0, function () {
        return crEmitRun(level, w, 4 + (rng() * 4 | 0));
    });

    /* ---- the ordinary jump.
       THE GAP WIDTH IS THE DIFFICULTY RAMP THE USER ASKED FOR: "the gaps get
       bigger, larger, and more risky later on, requiring a double jump to pass
       at some places". One tile on levels 1-2, two from level 3, and from
       level 8 crEmitGap is allowed to size against the double-jump reach --
       which crMaxGap works out from CR_PHYS rather than being told. One dRow
       is rolled and then checked rather than re-rolled until something fits; a
       biased re-roll turns every crowded stretch into the same segment. */
    var wide = spec.index <= 1 ? 1 : (spec.djGaps && rng() < 0.4 ? 3 : 2);
    var gapRow = 0;
    var roll = rng();
    if (roll < 0.33 && head >= 2) gapRow = -1;
    else if (roll < 0.66 && room >= 2) gapRow = 1 + (rng() * 2 | 0);
    opt(fits(gapRow, 9, CR_HEADROOM) ? (1.6 + 0.9 * t) * gapW * pref(4) : 0, function () {
        return crEmitGap(level, w, wide, gapRow, spec.djGaps);
    });

    // ---- a step up, and a drop
    var upRow = -(1 + (rng() * 2 | 0));
    opt((head >= 2 && fits(upRow, 7, CR_HEADROOM)) ? 0.9 * (exposure <= 2 ? 1.8 : 1) : 0, function () {
        return crEmitGap(level, w, 1, upRow);
    });
    var downRow = 2 + (rng() * 2 | 0);
    opt((room >= 3 && fits(downRow, 7, CR_HEADROOM)) ? 1.0 * gapW : 0, function () {
        return crEmitGap(level, w, 1 + (rng() * 2 | 0), downRow);
    });

    // ---- the one-block squeeze. Needs two rows of rock overhead to cut into.
    if (spec.tunnels) {
        /* A SQUEEZE BUILDS A CEILING, so it has to own the cell it builds it
           in. Gated on the body row alone, it could drop its roof straight
           into another lane's reserved jump headroom -- and a bot that needs
           to jump under a roof cannot: it hops, bonks, lands and hops again
           until the wall arrives. Measured: 168 of 168 dead bots had been
           wedged somewhere for more than three seconds. */
        var tunLen = 3 + (rng() * 3 | 0);
        var tunOk = fits(0, 7, CR_CORRIDOR_ROWS) && w.row - 2 >= 0 &&
                    crBoxFree(level, w.col, w.col + tunLen - 1, w.row - 2, w.row - 2);
        opt(tunOk ? (0.5 + 0.5 * t) * pref(3) : 0, function () {
            return crEmitTunnel(level, w, tunLen);
        });
    }

    // ---- the collapsing blocks.
    if (spec.crumble) {
        opt(fits(0, 9, CR_CORRIDOR_ROWS) ? 0.45 + 0.65 * t : 0, function () {
            return crEmitCrumble(level, w, 2 + (rng() * 2 | 0), rng() < 0.45);
        });
    }

    // ---- the branches.
    if (spec.branches) {
        /* A branch needs AIRSPACE, not just a landing row. The arc is ~10
           tiles long and rises CR_PHYS.springVel's apex above the launch, and
           a platform of somebody else's anywhere in that box is a ceiling that
           kills the spring halfway. Checking the landing row alone is what let
           branches cost 13 points of bot finish rate (A/B, 2026-10-17). */
        var brRow = head >= 3 && rng() < 0.5 ? -2 : (room >= 2 ? 1 : 0);
        var brReach = Math.ceil(crReach(CR_PHYS.springVel + CR_PHYS.springHeldBonus, brRow,
                                        CR_PHYS.springVx) / CR_TILE);
        var brApex = crApexRows(CR_PHYS.springVel + CR_PHYS.springHeldBonus);
        var brOk = fits(brRow, brReach + 4, 2) &&
                   crBoxFree(level, w.col, w.col + brReach + 2,
                             Math.max(0, w.row - brApex - 1), w.row - 1);
        opt(brOk ? (0.35 + 0.4 * t) * pref(0) : 0, function () {
            return crEmitBranch(level, w, brRow);
        });
    }

    // ---- the wind tunnels. The gap is past the plain jump range on purpose:
    // a vent gap you could have jumped is not a mechanic, it is decoration
    // with a sound effect.
    if (spec.vents) {
        opt(fits(0, 10, 2) ? (0.3 + 0.45 * t) * pref(1) : 0, function () {
            return crEmitVent(level, w, 4 + (rng() * 2 | 0));
        });
    }

    // ---- the chimneys. A shaft is a BOX, not a row: five columns and h+1
    // rows of cliff that have to belong to nobody else, or its walls cut
    // across whoever was already there.
    if (spec.shafts && head >= 4) {
        var h = 3;
        var rTop = w.row - h;
        opt((crBoxFree(level, w.col, w.col + 5, rTop - 1, w.row - 1) &&
             crRowUsable(level, w.col + 5, w.col + 10, rTop)) ? (0.5 * t + 0.15) * pref(2) : 0,
            function () { return crEmitShaft(level, w, h); });
    }

    // ---- the bomb walls, at most one per route.
    if (ctl.allowBomb && head >= 3) {
        opt((fits(0, 20, CR_CORRIDOR_ROWS) && crBoxFree(level, w.col + 7, w.col + 10, w.row - 3, w.row - 1))
            ? 1.4 : 0,
            function () { return -crEmitBreakable(level, w); });
    }

    var total = 0, i;
    for (i = 0; i < opts.length; i++) total += opts[i].wgt;
    if (total <= 0) return 0;              // nothing fits; the caller relocates
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
        var col = CR_START_COLS + 14 + (rng() * (level.finishCol - CR_START_COLS - 46) | 0);
        var row = CR_ROW_MIN + (rng() * (CR_ROW_MAX - CR_ROW_MIN) | 0);
        // Only hang a vent off something solid -- it is an opening IN the
        // cliff, so it needs cliff to be an opening in.
        var anchor = -1;
        for (var r = row; r <= CR_ROW_MAX; r++) {
            if (crTileSolid(crGet(level, col, r))) { anchor = r; break; }
        }
        if (anchor < 0) continue;

        /* IT MUST BLOW ACROSS GROUND, NOT ACROSS A GAP. A crosswind laid over
           a route jump turns a cleared gap into an unavoidable death with no
           tell, which is the one unfair thing a platformer can do: the player
           was already airborne when the rule changed. So the six columns the
           rect covers all have to be walkable at the anchor row, and a vent
           that cannot find that much ground simply is not placed. */
        var clear = true;
        for (var c = col - 5; c <= col; c++) {
            if (!crTileSolid(crGet(level, c, anchor))) { clear = false; break; }
        }
        if (!clear) continue;

        crSet(level, col, anchor, CR_T.VENT);
        level.vents.push({ col: col, row: anchor, dir: "left" });
        level.gusts.push({
            // -150, not -300. At CR_PHYS.moveSpeed 108 this is a shove you
            // fight rather than a wall you cannot pass, and cr-physics.js
            // already applies it at 35% while you are braced on the ground.
            x: (col - 5) * CR_TILE, y: (anchor - 4) * CR_TILE,
            w: 6 * CR_TILE, h: 4 * CR_TILE,
            ax: -150, ay: 0, dir: "left", strength: 1
        });
    }
}

/*
 * THE CLIFF IS SOLID, AND YOU RUN IN CORRIDORS CUT OUT OF IT.
 *
 * The first build drew thin platforms floating in black, which reads as open
 * air -- the opposite of what the user asked for ("compact and claustrophobic").
 * This grows every solid tile DOWNWARD by up to CR_THICK rows, stopping at any
 * lane's reserved corridor, at CR_ROW_MAX, or at rock already there.
 *
 * Three things fall out of it, all of them wanted:
 *
 *   - the world reads as ROCK WITH PASSAGES CUT THROUGH IT rather than girders
 *     hanging in space;
 *   - the space between two lanes becomes mostly solid, leaving the one-row
 *     corridors that make the place feel tight;
 *   - a hole in an upper lane's floor becomes a SHAFT INTO THE LANE BELOW, so
 *     falling costs you height and position instead of your run, and the four
 *     lanes connect vertically without a line of code that says "now interact".
 *
 * Only the bottom lane has nothing underneath it, so only its holes are lethal.
 * That asymmetry is deliberate: it is the price of the top lane being the
 * easiest spawn, and it is why crSafeFloor exists for the first two levels.
 */
function crThicken(level) {
    for (var c = 0; c < level.cols; c++) {
        for (var r = CR_ROW_MAX; r >= 0; r--) {
            if (crGet(level, c, r) === CR_T.EMPTY) continue;
            if (crGet(level, c, r) === CR_T.BRANCH) continue;   // a limb, not a mass
            for (var k = 1; k <= CR_THICK; k++) {
                var rr = r + k;
                if (rr > CR_ROW_MAX) break;
                if (crGet(level, c, rr) !== CR_T.EMPTY) break;
                if (level.clear[crIdx(level, c, rr)]) break;    // somebody walks there
                crSet(level, c, rr, CR_T.STONE);
            }
        }
    }
}

/*
 * "maybe the first two levels lack the ability to fall off the map and lose".
 * A solid row under the world, so a fall costs height and seconds -- and the
 * avalanche is still coming -- but cannot end the run. From level 3 it is gone
 * and the void is real, which is the single biggest difficulty step in the game
 * and happens exactly once.
 */
function crSafeFloor(level) {
    for (var c = 0; c < level.cols; c++) crSet(level, c, CR_ROW_MAX + 1, CR_T.STONE);
}

/*
 * GRAPPLE RINGS, AND THEY ARE ALWAYS A SHORTCUT, NEVER THE WAY THROUGH.
 *
 * Placed AFTER crThicken, over gaps the routes already cross by other means,
 * so a player who never touches the key finishes exactly as before and a
 * player who does gets there faster and higher. That is the same rule the
 * chimneys should follow and currently do not: a technique that is required is
 * a wall in front of everyone who has not learned it yet.
 *
 * A ring needs rock directly above it to be bolted to, and air below it to
 * swing in -- which is also why it reads instantly as a thing you grab rather
 * than a thing you stand on.
 */
function crPlaceAnchors(level, rng) {
    var placed = 0;
    var want = 5 + (level.spec.difficulty * 6 | 0);

    for (var lane = 0; lane < level.routes.length && placed < want; lane++) {
        var route = level.routes[lane];
        for (var i = 0; i < route.length && placed < want; i++) {
            var wp = route[i];
            if (wp.kind !== "jump" && wp.kind !== "gust" && wp.kind !== "spring") continue;
            if (rng() < 0.25) continue;

            /* OVER THE GAP, NOT BESIDE IT. The first rule asked for a cell with
               rock above and air below, which sounds like a ceiling and in a
               crThicken-ed world is almost nowhere: below any rock mass is the
               one-row corridor, and below THAT is the next floor. It placed
               zero anchors on every level.
               A gap is the one place that genuinely has air under it, which is
               also the only place a swing is worth anything. So: walk the gap's
               own columns, climb until there is something to bolt to, and
               check the drop is deep enough to swing in. */
            var gapCol = Math.floor(wp.x / CR_TILE) + 1;
            for (var dc = 0; dc < 4 && placed < want; dc++) {
                var col = gapCol + dc;
                if (col >= level.cols - 2) break;
                if (crTileSolid(crGet(level, col, wp.row))) continue;    // not actually a gap here

                for (var up = 2; up <= 5; up++) {
                    var row = wp.row - up;
                    if (row < 1) break;
                    if (crGet(level, col, row) !== CR_T.EMPTY) continue;
                    if (!crTileSolid(crGet(level, col, row - 1))) continue;  // nothing to bolt to

                    // Three clear rows under the ring, or there is no arc.
                    var room = true;
                    for (var k = 1; k <= 3; k++) {
                        if (crTileSolid(crGet(level, col, row + k))) { room = false; break; }
                    }
                    if (!room) continue;

                    crSet(level, col, row, CR_T.ANCHOR);
                    level.anchors.push({ col: col, row: row });
                    placed++;
                    break;
                }
                if (placed >= want) break;
            }
        }
    }
}

// ===================================================
//   REPAIR AND VERIFY
// ===================================================
/*
 * Two places in this file take a corridor by force rather than bending around
 * one: the convergence march and crApproach's staircase. Both are correct to do
 * so -- they are the guarantee that the far outpost is reachable -- but either
 * can delete a tile an earlier route was standing on.
 *
 * So after everything is stamped, every route is re-walked and any missing
 * standing tile is put back as STONE. Putting it back cannot re-block the
 * route that cleared it: that route cleared the rows ABOVE its own platform,
 * and what is restored here is a platform row.
 */
function crRepairRoutes(level) {
    var lane, i, wp, col, route;

    /* Pass 1: every standing cell any route needs.
     *
     * THE SPAN BETWEEN TWO WALK WAYPOINTS COUNTS, NOT JUST THE WAYPOINTS. It
     * checked only the waypoint columns, which is most of a route's length
     * missing: a `run` segment emits one waypoint at its far end, so the eight
     * tiles you actually walk over were unchecked. Another lane's gap, emitted
     * at the same row and the same columns, then punched a hole in the middle
     * of somebody's floor and nothing noticed -- 523 of the bots' route
     * departures were "walking, then suddenly below the route", and on the two
     * lower lanes, where a fall has nothing under it, that is a death.
     *
     * Two consecutive walk nodes at the SAME row mean "I walk from here to
     * there", so every column between them has to hold. A jump between them
     * does not, and is skipped, because its gap is the point.
     */
    var standing = Object.create(null);
    function claim(c, r) {
        if (c < 0 || c >= level.cols || r < 0 || r >= CR_ROWS) return;
        standing[crIdx(level, c, r)] = true;
        if (crGet(level, c, r) === CR_T.EMPTY) crSet(level, c, r, CR_T.STONE);
    }
    for (lane = 0; lane < level.routes.length; lane++) {
        route = level.routes[lane];
        for (i = 0; i < route.length; i++) {
            wp = route[i];
            if (wp.kind !== "walk" && wp.kind !== "finish") continue;
            col = Math.floor(wp.x / CR_TILE);
            claim(col, wp.row);

            // Back-fill to the previous walk node at the same row.
            var prev = route[i - 1];
            if (!prev || prev.kind !== "walk" || prev.row !== wp.row) continue;
            var pcol = Math.floor(prev.x / CR_TILE);
            for (var cc = Math.min(pcol, col); cc <= Math.max(pcol, col); cc++) {
                claim(cc, wp.row);
            }
        }
    }

    /* Pass 2: a tile in the row a body OCCUPIES (row - 1) is impassable, not a
     * ceiling -- a 14px body on a 16px grid lives entirely in that row. Remove
     * it, but ONLY when it is not something another route stands on. That
     * condition is what stops the two passes fighting: without it, deleting
     * lane 1's blocker removes lane 2's platform, pass 1 of the next build puts
     * it back, and the two routes trade a hole for a wall forever. */
    for (lane = 0; lane < level.routes.length; lane++) {
        route = level.routes[lane];
        for (i = 0; i < route.length; i++) {
            wp = route[i];
            if (wp.kind !== "walk" && wp.kind !== "finish") continue;
            col = Math.floor(wp.x / CR_TILE);
            if (col < 0 || col >= level.cols) continue;
            var above = crIdx(level, col, wp.row - 1);
            if (wp.row - 1 < 0 || standing[above]) continue;
            if (crGet(level, col, wp.row - 1) === CR_T.CATWALK) continue;
            if (crTileSolid(crGet(level, col, wp.row - 1))) {
                crSet(level, col, wp.row - 1, CR_T.EMPTY);
            }
        }
    }
}

/*
 * The structural check, which exists so that a bot failing and a LEVEL being
 * broken are two different findings rather than one number going down.
 * scripts/cliff-run-playtest.js asserts on it, and it is the thing that would
 * have caught the corridor problem on the first run instead of the tenth.
 *
 * Returns an array of human-readable problems; empty means the route's
 * standing tiles all exist and its corridor is passable.
 */
function crVerifyRoutes(level) {
    var problems = [];
    for (var lane = 0; lane < level.routes.length; lane++) {
        var route = level.routes[lane];
        for (var i = 0; i < route.length; i++) {
            var wp = route[i];

            /* A JUMP NEEDS ITS ARC, and a roof over one is the failure that is
               invisible from the tiles alone: the ground is fine, the landing
               is fine, and the body simply cannot get up there. CR_PHYS.jumpVel
               clears 1.75 rows, so the two rows above the launch have to be
               air. */
            /* KNOWN AND UNRESOLVED (2026-10-17): this fires on most levels,
               and the obvious fixes both made the game WORSE, so it is left
               reported rather than silenced.
               The cause is real -- crLaunchX right-aligns the body to the last
               solid tile, so a jump's arc starts over a column the PREVIOUS
               segment reserved, and a plain run reserves one row where an arc
               needs three; crThicken then grows the lane above into it.
               Claiming that column for CR_HEADROOM (locally, or by widening
               every segment's claim) fixed the roofs and took the bot finish
               rate from 50% to 44%: it over-reserves a cliff that is already
               nearly full, so the generator falls back on forcing corridors,
               which costs more than the roofs do. The right fix is probably to
               give the generator more room -- taller levels, or lanes that do
               not all need headroom at once -- not a bigger reservation. */
            if (wp.kind === "jump") {
                var jc = Math.floor(wp.x / CR_TILE);
                if (crTileSolid(crGet(level, jc, wp.row - 2))) {
                    problems.push("L" + (level.index + 1) + " lane" + lane +
                                  " roof over a jump at col" + jc + " row" + (wp.row - 2));
                }
            }

            if (wp.kind !== "walk" && wp.kind !== "finish") continue;
            var col = Math.floor(wp.x / CR_TILE);
            if (col < 0 || col >= level.cols) continue;

            if (!crSolidForDown(crGet(level, col, wp.row))) {
                problems.push("L" + (level.index + 1) + " lane" + lane +
                              " wp" + i + " nothing to stand on at col" + col + " row" + wp.row);
            }
            // The walked span, not just the node -- see crRepairRoutes.
            var prevW = route[i - 1];
            if (prevW && prevW.kind === "walk" && prevW.row === wp.row) {
                var pc = Math.floor(prevW.x / CR_TILE);
                for (var cx = Math.min(pc, col); cx <= Math.max(pc, col); cx++) {
                    if (cx < 0 || cx >= level.cols) continue;
                    if (!crSolidForDown(crGet(level, cx, wp.row))) {
                        problems.push("L" + (level.index + 1) + " lane" + lane +
                                      " hole in the walked span at col" + cx + " row" + wp.row);
                        break;
                    }
                }
            }
            // Head height: a tile one row above the feet is impassable, since
            // the body is 16px and the tile starts 24px up.
            if (crTileSolid(crGet(level, col, wp.row - 1))) {
                problems.push("L" + (level.index + 1) + " lane" + lane +
                              " wp" + i + " ceiling at head height, col" + col + " row" + (wp.row - 1));
            }
        }
    }
    return problems;
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
        // The corridor reservation. One byte per cell; see crMarkCorridor.
        clear: new Uint8Array(spec.cols * CR_ROWS),
        finishCol: spec.cols - CR_END_COLS,
        routes: [],
        catwalks: [],
        gates: [],
        anchors: [],
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

    /* EACH LANE'S FINAL APPROACH IS RESERVED BEFORE ANYTHING IS BUILT.
     *
     * The convergence march and crApproach's staircase are the two places that
     * TAKE a corridor instead of bending around one -- they have to, because
     * they are what guarantees a catwalk is reachable. The cost was that lane 3
     * could clear a corridor lane 0 was already standing in, and the repair
     * pass can restore a missing platform but cannot un-place a ceiling
     * without breaking whoever owns it.
     *
     * Reserving it up front removes the conflict rather than resolving it. The
     * four catwalk rows are known from the start and are distinct, so the four
     * reservations cannot collide with each other, and no route can lay a
     * platform in somebody's run-in to the outpost.
     */
    var convergeFrom = CR_START_COLS + Math.floor((level.finishCol - 28 - CR_START_COLS) * 0.78);
    for (var pre = 0; pre < 4; pre++) {
        level.buildLane = pre;
        crMarkCorridor(level, convergeFrom, level.cols - 1, CR_LANE_ROWS[pre]);
    }

    crBuildRoutes(level, rng);
    for (var lane = 0; lane < 4; lane++) {
        level.spawns.push({
            // Column 2, on the catwalk, stated rather than derived from
            // CR_START_COLS -- which is a width, and tying a spawn to a width
            // is how narrowing the tower put everyone inside the wall.
            x: 2 * CR_TILE + 4,
            y: crStandY(CR_LANE_ROWS[lane])
        });
    }

    crDecorate(level, rng);
    crRepairRoutes(level);
    // Thicken AFTER the repair pass, so it grows from the finished geometry and
    // cannot fill a hole the repair was about to punch.
    crThicken(level);
    if (spec.safeFloor) crSafeFloor(level);
    crPlaceAnchors(level, rng);

    if (spec.bombs) level.objective = "BOMB THROUGH · REACH THE OUTPOST";
    else if (spec.shafts) level.objective = "CLIMB THE CHIMNEYS";
    else if (spec.vents) level.objective = "RIDE THE GUSTS";
    else if (spec.tunnels) level.objective = "SQUEEZE THROUGH · MIND THE BLOCKS";
    else level.objective = "REACH THE OUTPOST";
    if (spec.safeFloor) level.objective += " · NOTHING TO FALL INTO YET";

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
