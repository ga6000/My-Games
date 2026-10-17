// ===================================================
//   RAIL SANDBOX — the map (2026-10-16)
// ===================================================
// "a large loop with two connected towns with a thick forest between."
//
// NO GENERATOR AND NO LEVELS. Every number below is authored, because the
// point of the map is to exercise the rail mechanics and a generated layout
// cannot be reasoned about when a shunting move goes wrong. It is also why
// there is no seed: reload and the map is identical, so you are comparing
// your move and not the roll.
//
// WHY THIS PARTICULAR LAYOUT. A through track plus a passing loop plus a
// dead-end spur, in each town, is the SMALLEST geometry in which cars can be
// genuinely rearranged rather than merely moved: to reverse the order of two
// cars you need somewhere to put one while the other goes past. The big loop
// then means no mistake is terminal -- you can always drive round rather than
// having to reverse the whole consist back out.
"use strict";

// --- the authored geometry ------------------------------------------
const RM_LOOP_W_X = 1100;        // the loop's west leg
const RM_LOOP_E_X = 5300;        // its east leg
const RM_LOOP_N_Y = 760;         // its north leg, through the forest
const RM_LOOP_S_Y = 2840;        // its south leg, through the forest
const RM_FILLET = 300;           // corner radius on the loop

const RM_TOWN_W = { x: 1100, y: 1830, name: "WESTHOLLOW" };
const RM_TOWN_E = { x: 5300, y: 1830, name: "EAST SIDING" };
const RM_FOREST = { x0: 2080, x1: 4320 };    // the thick band between them

const RM_TRACK_CLEAR = 104;      // nothing scenic within this of a rail centreline

let railWalls = [];              // solid rects: block players, zombies, bullets
let railDoors = [];              // buyable; a shut one on the rail is a blocker
let railSilos = [];              // { x, y, w, h, fill, pump: {e, s}, name }
let railTrees = [];              // { x, y, w, h, cw, shade }
let railProps = [];              // drawn-and-solid scenery (sheds, platforms, crates)
let railBoulders = [];           // rail obstructions, for the bounce
let railSpawnPoint = { x: 0, y: 0 };

// --- polyline helpers -----------------------------------------------
// Waypoints -> a dense polyline with circular fillets at the interior
// corners. The loop's corners have to be real curves, not two rects meeting:
// a car's pose is walked along this polyline, so a hard corner would snap a
// 220px locomotive through 90 degrees in one step.
function railFillet(way, radius, step) {
    const pts = [];
    const push = function (x, y) {
        const n = pts.length;
        if (n && Math.hypot(pts[n - 1].x - x, pts[n - 1].y - y) < 0.5) return;
        pts.push({ x: x, y: y });
    };
    const seg = step || 14;
    push(way[0][0], way[0][1]);
    for (let i = 1; i < way.length - 1; i++) {
        const p = way[i - 1], c = way[i], q = way[i + 1];
        const a1 = Math.atan2(c[1] - p[1], c[0] - p[0]);
        const a2 = Math.atan2(q[1] - c[1], q[0] - c[0]);
        let turn = a2 - a1;
        while (turn > Math.PI) turn -= Math.PI * 2;
        while (turn < -Math.PI) turn += Math.PI * 2;
        if (Math.abs(turn) < 0.02) { push(c[0], c[1]); continue; }
        // How far back from the corner the arc starts, capped so two close
        // corners cannot overrun each other.
        const half = Math.abs(turn) / 2;
        let back = radius * Math.tan(Math.min(half, 1.45));
        back = Math.min(back, Math.hypot(c[0] - p[0], c[1] - p[1]) * 0.5,
                              Math.hypot(q[0] - c[0], q[1] - c[1]) * 0.5);
        const r = back / Math.tan(Math.min(half, 1.45));
        const sx = c[0] - Math.cos(a1) * back, sy = c[1] - Math.sin(a1) * back;
        const ex = c[0] + Math.cos(a2) * back, ey = c[1] + Math.sin(a2) * back;
        push(sx, sy);
        // Arc centre: perpendicular to the incoming leg, on the side the turn
        // goes. Check it against a case rather than trusting the algebra --
        // heading east (a1 = 0) and turning to head south (a2 = +PI/2, since
        // y is down) is turn > 0, and that arc's centre is directly SOUTH of
        // the tangent point, i.e. P + (-sin a1, cos a1) * r = (sx, sy + r).
        // Both signs were inverted here until 2026-10-17, which mirrored every
        // arc into a cusp: the loop's corners measured a 9px radius instead of
        // 300, and a locomotive crossing one snapped through 90 degrees.
        const sign = turn > 0 ? 1 : -1;
        const cx = sx - Math.sin(a1) * r * sign;
        const cy = sy + Math.cos(a1) * r * sign;
        const t0 = Math.atan2(sy - cy, sx - cx);
        const t1 = Math.atan2(ey - cy, ex - cx);
        let sweep = t1 - t0;
        while (sweep > Math.PI) sweep -= Math.PI * 2;
        while (sweep < -Math.PI) sweep += Math.PI * 2;
        const n = Math.max(2, Math.ceil(Math.abs(sweep) * r / seg));
        for (let k = 1; k <= n; k++) {
            const t = t0 + sweep * (k / n);
            push(cx + Math.cos(t) * r, cy + Math.sin(t) * r);
        }
        push(ex, ey);
    }
    push(way[way.length - 1][0], way[way.length - 1][1]);
    return pts;
}

// A turnout's S-curve: smoothstep across, linear along, so the tangent is
// parallel to the main line at BOTH ends. That is what makes a siding join
// the running line instead of meeting it at an angle.
//
// ITS CURVATURE IS THE CONSTRAINT, and it is sharper than it looks. For a
// lateral offset L over a run H the tightest radius is H^2 / (6L), at the two
// ENDS where the lateral speed is zero -- not in the middle. The first cut of
// this map used L=320 over H=250 and got a 42px radius, which bunched a
// three-car consist by 43px because arc length and straight-line distance
// stop agreeing on a curve that tight. L=150 over H=430 gives 205px, and a
// 190px car then loses about 10px of apparent spacing, which does not read.
// Keep H^2 >= 1200*L for anything a train runs through.
function railSCurve(x0, y0, x1, y1, vertical, steps) {
    // Sampled by LENGTH, not by a fixed count. At a fixed 22 steps a 500px
    // transition facets every 23px, and a facet is a corner -- measured, the
    // polyline's own faceting read as a 173px radius on a curve whose true
    // radius is 278. The track is only ever as smooth as its point spacing.
    const n = steps || Math.max(24, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 11));
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        const sm = t * t * (3 - 2 * t);
        if (vertical) pts.push({ x: x0 + (x1 - x0) * sm, y: y0 + (y1 - y0) * t });
        else pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * sm });
    }
    return pts;
}

function railJoin() {
    // Concatenate point lists, dropping the duplicated seams.
    const out = [];
    for (let i = 0; i < arguments.length; i++) {
        const a = arguments[i];
        for (let k = 0; k < a.length; k++) {
            const n = out.length;
            if (n && Math.hypot(out[n - 1].x - a[k].x, out[n - 1].y - a[k].y) < 0.5) continue;
            out.push({ x: a[k].x, y: a[k].y });
        }
    }
    return out;
}

function railStraight(x0, y0, x1, y1, steps) {
    const n = steps || Math.max(2, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / 40));
    const pts = [];
    for (let i = 0; i <= n; i++) {
        const t = i / n;
        pts.push({ x: x0 + (x1 - x0) * t, y: y0 + (y1 - y0) * t });
    }
    return pts;
}

// --- the network ----------------------------------------------------
// Node coordinates, named so the switch table below reads as a track plan.
// The siding sits RM_SIDE_OFF from the through track, on the far side from
// the loop's interior, and the transition is spread over RM_SIDE_RUN -- see
// the curvature note on railSCurve for why those two numbers are not free.
const RM_SIDE_OFF = 150;
const RM_SIDE_RUN = 430;

const RM_WN = [RM_LOOP_W_X, 1330];
const RM_WS = [RM_LOOP_W_X, 2330];
const RM_EN = [RM_LOOP_E_X, 1330];
const RM_ES = [RM_LOOP_E_X, 2330];
const RM_WY = [RM_LOOP_W_X - RM_SIDE_OFF, 1830];   // mid west siding
const RM_WD = [RM_LOOP_W_X - RM_SIDE_OFF, 2480];   // west dead end
const RM_EY = [RM_LOOP_E_X + RM_SIDE_OFF, 1830];
const RM_ED = [RM_LOOP_E_X + RM_SIDE_OFF, 2480];

function railBuildNetwork() {
    railNetReset();

    // THE LOOP, as two long edges. Split at the town nodes rather than at the
    // corners, so a switch always sits on straight track -- a turnout on a
    // 300px radius curve would be unreadable at this zoom.
    const loopN = railAddEdge("loopN", railFillet([
        RM_EN, [RM_LOOP_E_X, RM_LOOP_N_Y + RM_FILLET], [RM_LOOP_E_X - RM_FILLET, RM_LOOP_N_Y],
        [RM_LOOP_W_X + RM_FILLET, RM_LOOP_N_Y], [RM_LOOP_W_X, RM_LOOP_N_Y + RM_FILLET], RM_WN
    ], RM_FILLET));
    const loopS = railAddEdge("loopS", railFillet([
        RM_WS, [RM_LOOP_W_X, RM_LOOP_S_Y - RM_FILLET], [RM_LOOP_W_X + RM_FILLET, RM_LOOP_S_Y],
        [RM_LOOP_E_X - RM_FILLET, RM_LOOP_S_Y], [RM_LOOP_E_X, RM_LOOP_S_Y - RM_FILLET], RM_ES
    ], RM_FILLET));

    // WEST TOWN: through track, a passing siding, a dead-end spur.
    const wMain = railAddEdge("wMain", railStraight(RM_WN[0], RM_WN[1], RM_WS[0], RM_WS[1]));
    const wSidA = railAddEdge("wSidA", railJoin(
        railSCurve(RM_WN[0], RM_WN[1], RM_WY[0], RM_WN[1] + RM_SIDE_RUN, true),
        railStraight(RM_WY[0], RM_WN[1] + RM_SIDE_RUN, RM_WY[0], RM_WY[1])));
    // AT WY THE SPUR IS THE STRAIGHT AND THE SIDING CURVES BACK, which is the
    // ordinary way a yard throat is laid out and the only arrangement that
    // keeps both branches gentle. Making the spur the one that curved away
    // needed a radius under 90px at the node, because it would have had to
    // turn through 90 degrees inside the length of one car.
    //
    // Both branches leave WY tangent to each other -- smoothstep's derivative
    // is zero at t=0 -- so they separate gradually, which is exactly what a
    // turnout looks like from above.
    const wSidB = railAddEdge("wSidB", railSCurve(RM_WY[0], RM_WY[1], RM_WS[0], RM_WS[1], true));
    const wSpur = railAddEdge("wSpur", railStraight(RM_WY[0], RM_WY[1], RM_WD[0], RM_WD[1]));

    // EAST TOWN, mirrored.
    const eMain = railAddEdge("eMain", railStraight(RM_EN[0], RM_EN[1], RM_ES[0], RM_ES[1]));
    const eSidA = railAddEdge("eSidA", railJoin(
        railSCurve(RM_EN[0], RM_EN[1], RM_EY[0], RM_EN[1] + RM_SIDE_RUN, true),
        railStraight(RM_EY[0], RM_EN[1] + RM_SIDE_RUN, RM_EY[0], RM_EY[1])));
    const eSidB = railAddEdge("eSidB", railSCurve(RM_EY[0], RM_EY[1], RM_ES[0], RM_ES[1], true));
    const eSpur = railAddEdge("eSpur", railStraight(RM_EY[0], RM_EY[1], RM_ED[0], RM_ED[1]));

    // Labels for the points prompt, so a lever says where it sends you.
    railEdges[wMain].label = "WEST MAIN";
    railEdges[wSidA].label = "WEST SIDING";
    railEdges[wSidB].label = "WEST SIDING";
    railEdges[wSpur].label = "WEST SPUR";
    railEdges[eMain].label = "EAST MAIN";
    railEdges[eSidA].label = "EAST SIDING";
    railEdges[eSidB].label = "EAST SIDING";
    railEdges[eSpur].label = "EAST SPUR";
    railEdges[loopN].label = "NORTH LOOP";
    railEdges[loopS].label = "SOUTH LOOP";

    // SIX SWITCHES. The trunk is the side a facing move arrives on, and
    // branches[thrown] is the only choice the player makes.
    railAddSwitch(railNodeAt(RM_WN[0], RM_WN[1]), loopN, wMain, wSidA);
    railAddSwitch(railNodeAt(RM_WS[0], RM_WS[1]), loopS, wMain, wSidB);
    railAddSwitch(railNodeAt(RM_WY[0], RM_WY[1]), wSidA, wSidB, wSpur);
    railAddSwitch(railNodeAt(RM_EN[0], RM_EN[1]), loopN, eMain, eSidA);
    railAddSwitch(railNodeAt(RM_ES[0], RM_ES[1]), loopS, eMain, eSidB);
    railAddSwitch(railNodeAt(RM_EY[0], RM_EY[1]), eSidA, eSidB, eSpur);
    railPlaceLevers();

    // BUFFER STOPS at both dead ends. Without them a car reversing off the
    // spur would reach railNextEdge's null and stop dead with no sound and
    // nothing drawn -- which looks like a bug rather than a buffer.
    railAddBlocker(wSpur, railEdges[wSpur].len - 14, "buffer");
    railAddBlocker(eSpur, railEdges[eSpur].len - 14, "buffer");

    return { loopN: loopN, loopS: loopS, wMain: wMain, wSidA: wSidA, wSidB: wSidB,
             wSpur: wSpur, eMain: eMain, eSidA: eSidA, eSidB: eSidB, eSpur: eSpur };
}

// --- silos, doors, walls --------------------------------------------
// A BLOOD SILO and its PUMP STOP. The stop is a point on an edge with a
// tolerance window: bring the locomotive inside it slowly enough and it
// latches. Authored as "beside this silo" and resolved to (edge, s) once.
function railAddSilo(name, x, y, edge) {
    const w = 132, h = 150;
    const near = railNearestOnEdge(edge, x + w / 2, y + h / 2);
    railSilos.push({
        name: name, x: x, y: y, w: w, h: h,
        fill: 0, cap: 1,
        pump: { e: edge, s: near.s },
        pumpOn: false, lastNoise: 0
    });
    return railSilos.length - 1;
}

// A wall with a gap in it, and a buyable door filling the gap. `vertical`
// means the wall slab runs north-south (so it crosses an east-west track).
const RM_WALL_T = 34;

function railAddWalledDoor(vertical, fixed, from, to, gapAt, gapSize, cost, railEdge) {
    const segs = [];
    if (vertical) {
        segs.push({ x: fixed, y: from, w: RM_WALL_T, h: gapAt - from });
        segs.push({ x: fixed, y: gapAt + gapSize, w: RM_WALL_T, h: to - (gapAt + gapSize) });
    } else {
        segs.push({ x: from, y: fixed, w: gapAt - from, h: RM_WALL_T });
        segs.push({ x: gapAt + gapSize, y: fixed, w: to - (gapAt + gapSize), h: RM_WALL_T });
    }
    for (let i = 0; i < segs.length; i++) if (segs[i].w > 0 && segs[i].h > 0) railWalls.push(segs[i]);

    const d = vertical
        ? { x: fixed, y: gapAt, w: RM_WALL_T, h: gapSize }
        : { x: gapAt, y: fixed, w: gapSize, h: RM_WALL_T };
    d.open = false;
    d.cost = cost;
    d.rail = railEdge !== undefined && railEdge >= 0;
    railDoors.push(d);

    // EVERY RAIL CROSSING MUST BE BOUGHT OPEN, and here that is literal: the
    // door blocks the CAR, not just the rider. zombie-train.js found the
    // other way round in the browser -- the train drove through a shut door
    // and left its passenger scraped off against it 476px back. The user's
    // own design is the fix: "the door also opens up the rail pathway".
    if (d.rail) {
        const cx = d.x + d.w / 2, cy = d.y + d.h / 2;
        const near = railNearestOnEdge(railEdge, cx, cy);
        railAddBlocker(railEdge, near.s, "door", d);
    }
    return d;
}

// --- scenery --------------------------------------------------------
// Tree placement respects the track above all else: RM_TRACK_CLEAR from any
// centreline. A canopy over the rails would hide the one thing the sandbox
// exists to show.
function railTrackClearOf(x, y, pad) {
    const n = railNearestOnNet(x, y);
    return n.d > (pad || RM_TRACK_CLEAR);
}

function railSpotFree(x, y, w, h, pad) {
    const box = { x: x - (pad || 0), y: y - (pad || 0), w: w + (pad || 0) * 2, h: h + (pad || 0) * 2 };
    for (let i = 0; i < railWalls.length; i++) if (rRectsOverlap(box, railWalls[i])) return false;
    for (let i = 0; i < railDoors.length; i++) if (rRectsOverlap(box, railDoors[i])) return false;
    for (let i = 0; i < railProps.length; i++) if (rRectsOverlap(box, railProps[i])) return false;
    for (let i = 0; i < railSilos.length; i++) if (rRectsOverlap(box, railSilos[i])) return false;
    for (let i = 0; i < railTrees.length; i++) if (rRectsOverlap(box, railTrees[i])) return false;
    return true;
}

const RM_TREE_TRUNK = 40;        // the whole footprint is solid, not just a trunk
const RM_TREE_CANOPY = 64;
const RM_TREE_GAP = 86;

function railPlaceTree(x, y, canopy, rnd) {
    const cw = canopy || RM_TREE_CANOPY;
    const r = { x: Math.round(x - RM_TREE_TRUNK / 2), y: Math.round(y - RM_TREE_TRUNK / 2),
                w: RM_TREE_TRUNK, h: RM_TREE_TRUNK };
    if (r.x < 20 || r.y < 20 || r.x + r.w > RAIL_WORLD_W - 20 || r.y + r.h > RAIL_WORLD_H - 20) return false;
    if (!railTrackClearOf(x, y)) return false;
    if (!railSpotFree(r.x, r.y, r.w, r.h, RM_TREE_GAP - RM_TREE_TRUNK)) return false;
    railTrees.push({ x: r.x, y: r.y, w: r.w, h: r.h, cw: cw, shade: rnd ? rnd() : 0.5 });
    return true;
}

// THE THICK FOREST between the towns. Jittered grid rather than pure random:
// a random scatter at this density leaves bald patches and clumps that seal
// the gaps the loop runs through, and three trees in a triangle is enough to
// make a pocket you cannot walk out of.
function railBuildForest() {
    const rnd = railRng(90210);
    const step = 104;
    for (let y = 60; y < RAIL_WORLD_H - 60; y += step) {
        for (let x = RM_FOREST.x0; x < RM_FOREST.x1; x += step) {
            // Dense in the middle of the band, thinning at its edges, so the
            // forest has a treeline instead of a straight edge.
            const t = Math.min((x - RM_FOREST.x0), (RM_FOREST.x1 - x)) / 420;
            const dens = 0.30 + 0.62 * Math.min(1, t);
            if (rnd() > dens) continue;
            const jx = x + (rnd() - 0.5) * step * 0.7;
            const jy = y + (rnd() - 0.5) * step * 0.7;
            railPlaceTree(jx, jy, 54 + Math.floor(rnd() * 26), rnd);
        }
    }
    // A thinner scatter outside the band, so the towns sit in woodland rather
    // than on a bare plain.
    for (let i = 0; i < 520; i++) {
        const x = 80 + rnd() * (RAIL_WORLD_W - 160);
        const y = 80 + rnd() * (RAIL_WORLD_H - 160);
        if (x > RM_FOREST.x0 - 60 && x < RM_FOREST.x1 + 60) continue;
        if (rnd() < 0.5) continue;
        railPlaceTree(x, y, 52 + Math.floor(rnd() * 22), rnd);
    }
}

// Town scenery: sheds, a platform beside each through track, loading crates.
function railBuildTown(town, eastSide) {
    const rnd = railRng(eastSide ? 4477 : 1193);
    const sx = eastSide ? -1 : 1;
    const add = function (x, y, w, h, kind) {
        if (!railTrackClearOf(x + w / 2, y + h / 2, 74)) return;
        if (!railSpotFree(x, y, w, h, 16)) return;
        railProps.push({ x: Math.round(x), y: Math.round(y), w: w, h: h, kind: kind,
                         shade: rnd() });
    };
    // A platform alongside the through track, on the side away from the silo.
    add(town.x + sx * 74, town.y - 300, 56, 240, "platform");
    // Sheds set back from the rails.
    add(town.x + sx * 300, town.y - 430, 200, 150, "shed");
    add(town.x + sx * 340, town.y + 160, 170, 190, "shed");
    add(town.x - sx * 420, town.y - 520, 150, 130, "shed");
    add(town.x - sx * 300, town.y + 420, 230, 160, "warehouse");
    // Loose crates near the platform, for scale and cover.
    for (let i = 0; i < 9; i++) {
        const cx = town.x + sx * (150 + rnd() * 320);
        const cy = town.y - 220 + rnd() * 520;
        add(cx, cy, 34 + Math.floor(rnd() * 16), 34 + Math.floor(rnd() * 16), "crate");
    }
    // A water tower, because a town on a railway has one.
    add(town.x + sx * 470, town.y - 90, 90, 90, "tower");
}

// --- the build ------------------------------------------------------
function railMapBuild() {
    railWalls = [];
    railDoors = [];
    railSilos = [];
    railTrees = [];
    railProps = [];
    railBoulders = [];

    const E = railBuildNetwork();

    // FOUR BLOOD SILOS, each beside the track with its own pump stop: one in
    // each town and one on each forest leg, so there is a reason to drive the
    // whole loop rather than shuttle between two stops.
    // Each silo stands on the side of its track AWAY from that town's siding,
    // so the pump stand and its hose never cross a second running line.
    railAddSilo("WESTHOLLOW", RM_LOOP_W_X + 120, 1740, E.wMain);
    railAddSilo("EAST SIDING", RM_LOOP_E_X - 252, 1740, E.eMain);
    railAddSilo("SOUTH CUT", 3040, RM_LOOP_S_Y + 108, E.loopS);
    railAddSilo("NORTH CUT", 3700, RM_LOOP_N_Y - 258, E.loopN);

    // WALLS WITH BUYABLE DOORS, straddling the rail in three places. A shut
    // one is a shut line, which is the whole reason it is interesting: the
    // currency and the route are the same decision.
    //
    // ALL THREE ARE ON THE LOOP, never on a town's own tracks. A fence across
    // the west main would have had to pass within 23px of the siding running
    // parallel to it -- close enough to look like it blocks a track it has no
    // door on. The loop has single-track stretches; the yards do not.
    railAddWalledDoor(true, 2380, 300, 1240, RM_LOOP_N_Y - 66, 132, 750, E.loopN);
    railAddWalledDoor(true, 4120, 2380, 3320, RM_LOOP_S_Y - 66, 132, 750, E.loopS);
    // The west town's gate, on the loop's west leg between the north corner
    // and the yard throat -- the only single-track approach into Westhollow.
    railAddWalledDoor(false, 1180, 880, 1340, RM_LOOP_W_X - 66, 132, 500, E.loopN);

    // ONE BOULDER on the east spur, past its midpoint: an obstruction that is
    // neither a door nor a dead end, so the bounce can be seen on its own.
    // Deliberately NOT on the west spur -- one demonstration is a lesson, two
    // is just less usable track.
    const bs = railEdges[E.eSpur].len * 0.62;
    const bp = railPose(E.eSpur, bs);
    railBoulders.push({ x: bp.x - 30, y: bp.y - 26, w: 60, h: 52 });
    railAddBlocker(E.eSpur, bs, "boulder");

    railBuildTown(RM_TOWN_W, false);
    railBuildTown(RM_TOWN_E, true);
    railBuildForest();

    // The player starts on the west platform, beside the locomotive.
    railSpawnPoint = { x: RM_LOOP_W_X + 150, y: 1960 };

    return E;
}

// The starting stock. A locomotive on the west main, and loose cars spread
// across both towns' sidings and spurs so there is something to shunt in
// reach of wherever you are.
function railPlaceStock(E) {
    railCarsReset();
    // The locomotive faces SOUTH down the west main (d = +1 along wMain,
    // which runs WN -> WS), so driving forward takes it toward the south loop.
    railSpawnBody(["loco"], E.wMain, 300, 1);
    railSpawnBody(["flatbed"], E.wSpur, railEdges[E.wSpur].len - 160, 1);
    railSpawnBody(["boxcar"], E.wSidB, railEdges[E.wSidB].len * 0.5, 1);
    railSpawnBody(["passenger"], E.eMain, railEdges[E.eMain].len * 0.45, 1);
    railSpawnBody(["flatbed"], E.eSidB, railEdges[E.eSidB].len * 0.45, 1);
    railSpawnBody(["boxcar"], E.loopS, railEdges[E.loopS].len * 0.52, 1);
}

// --- collision queries ----------------------------------------------
// Walls, shut doors, props, boulders and tree trunks are all solid to a
// walking body. Cars deliberately are NOT: a deck is walkable, which is the
// flat-deck conclusion zombie-train.js note 1 reached and the reason a moving
// car can never crush anyone against geometry here either.
function railSolidAt(x, y, w, h) {
    for (let i = 0; i < railWalls.length; i++) if (rRectIntersect(x, y, w, h, railWalls[i].x, railWalls[i].y, railWalls[i].w, railWalls[i].h)) return railWalls[i];
    for (let i = 0; i < railDoors.length; i++) {
        const d = railDoors[i];
        if (!d.open && rRectIntersect(x, y, w, h, d.x, d.y, d.w, d.h)) return d;
    }
    for (let i = 0; i < railProps.length; i++) {
        const p = railProps[i];
        if (p.kind === "platform") continue;              // walkable
        if (rRectIntersect(x, y, w, h, p.x, p.y, p.w, p.h)) return p;
    }
    for (let i = 0; i < railBoulders.length; i++) if (rRectIntersect(x, y, w, h, railBoulders[i].x, railBoulders[i].y, railBoulders[i].w, railBoulders[i].h)) return railBoulders[i];
    for (let i = 0; i < railSilos.length; i++) if (rRectIntersect(x, y, w, h, railSilos[i].x, railSilos[i].y, railSilos[i].w, railSilos[i].h)) return railSilos[i];
    for (let i = 0; i < railTrees.length; i++) if (rRectIntersect(x, y, w, h, railTrees[i].x, railTrees[i].y, railTrees[i].w, railTrees[i].h)) return railTrees[i];
    return null;
}

// Does a bullet stop here? Same set, minus the tree trunks' generosity --
// a shot grazing a canopy should not vanish, so only the trunk blocks.
function railBulletBlocked(x, y) {
    return !!railSolidAt(x - 1, y - 1, 2, 2);
}

function railDoorAt(x, y, w, h) {
    for (let i = 0; i < railDoors.length; i++) {
        const d = railDoors[i];
        if (!d.open && rRectIntersect(x, y, w, h, d.x - 26, d.y - 26, d.w + 52, d.h + 52)) return d;
    }
    return null;
}
