// ===================================================
//   RAIL SANDBOX — the rail NETWORK (a graph, 2026-10-16)
// ===================================================
// zombie-train.js was right about the thing that matters:
//
//     A TRAIN ON RAILS HAS ONE DEGREE OF FREEDOM.
//
// This file keeps that whole and fixes the one limit that file documented on
// itself -- "THE SIDINGS ARE NOT JOINED TO IT and that is a known limit, not
// an oversight". A single polyline cannot fork, so it had a main line and
// scenery. The user asked for forks, so the line becomes a GRAPH.
//
// What a graph costs, and the one idea that pays for it:
//
//   ROUTE MEMORY. A body does NOT re-derive where its cars are by consulting
//   switches, because a switch thrown behind a moving train would then
//   teleport its cars onto the other branch. Each body carries the ordered
//   list of edges it occupies -- front-most first -- and car poses are walked
//   along THAT. Switches are consulted only when the HEAD needs track it does
//   not yet have.
//
//   This is not a workaround; it is how a railway behaves. The points behind
//   you do not move your train. It also means the "car standing on a switch"
//   case needs no special geometry: if any body's route contains the switch's
//   node, the lever is refused.
//
// Everything visible is still DERIVED from one scalar per body (the head's
// position) plus that route, which keeps the discipline zombie-train.js note
// 2 insisted on: nothing is interpolated, so two screens cannot disagree
// about where a car is and drag a rider to two different places.
"use strict";

// --- the graph ------------------------------------------------------
// Node:   { id, x, y, edges: [edgeIdx] }
// Edge:   { id, a, b, pts: [{x,y}], cum: [n], len }   pts[0] at node a
// Anchor: { e, s, d }  edge index, arc position on it, travel sense (+1/-1)
let railNodes = [];
let railEdges = [];
let railSwitches = [];     // { node, trunk, branches: [e, e], thrown, x, y, hp }
let railBlockers = [];     // { e, s, kind, ref }  a shut door, a buffer stop, a boulder

const RAIL_JOIN_TOL = 6;   // endpoints this close are the same node

function railNetReset() {
    railNodes = [];
    railEdges = [];
    railSwitches = [];
    railBlockers = [];
}

// Find or make the node at (x, y). Authoring joins tracks by COINCIDENT
// ENDPOINTS rather than by naming a node twice, so a map edit cannot leave a
// switch pointing at a node that no edge reaches.
function railNodeAt(x, y) {
    for (let i = 0; i < railNodes.length; i++) {
        if (rDist(railNodes[i].x, railNodes[i].y, x, y) <= RAIL_JOIN_TOL) return i;
    }
    railNodes.push({ id: railNodes.length, x: x, y: y, edges: [] });
    return railNodes.length - 1;
}

// Add one edge from a polyline. Returns its index.
function railAddEdge(name, pts) {
    if (!pts || pts.length < 2) return -1;
    const cum = [0];
    for (let k = 1; k < pts.length; k++) {
        cum.push(cum[k - 1] + Math.hypot(pts[k].x - pts[k - 1].x, pts[k].y - pts[k - 1].y));
    }
    const a = railNodeAt(pts[0].x, pts[0].y);
    const b = railNodeAt(pts[pts.length - 1].x, pts[pts.length - 1].y);
    const e = {
        id: railEdges.length, name: name || ("e" + railEdges.length),
        a: a, b: b, pts: pts, cum: cum, len: cum[cum.length - 1]
    };
    railEdges.push(e);
    railNodes[a].edges.push(e.id);
    railNodes[b].edges.push(e.id);
    return e.id;
}

function railEdgeByName(name) {
    for (let i = 0; i < railEdges.length; i++) if (railEdges[i].name === name) return i;
    return -1;
}

// --- poses ----------------------------------------------------------
// s -> { x, y, ang } on one edge. Clamped, never extrapolated: unlike the
// arcade's single line, there is nowhere off this network to run to -- a dead
// end has a buffer stop, and the loop closes.
function railPose(e, s) {
    const E = railEdges[e];
    if (!E) return { x: 0, y: 0, ang: 0 };
    const t = rClamp(s, 0, E.len);
    const pts = E.pts, cum = E.cum;
    let seg = 1;
    while (seg < cum.length - 1 && cum[seg] < t) seg++;
    const p = pts[seg - 1], q = pts[seg];
    const segLen = cum[seg] - cum[seg - 1];
    const f = segLen > 0 ? (t - cum[seg - 1]) / segLen : 0;
    return {
        x: p.x + (q.x - p.x) * f,
        y: p.y + (q.y - p.y) * f,
        ang: Math.atan2(q.y - p.y, q.x - p.x)
    };
}

// The pose in a body's TRAVEL frame: the tangent flips with `d`, so a car
// running backwards along an edge still draws and pushes the right way round.
function railPoseDir(e, s, d) {
    const p = railPose(e, s);
    if (d < 0) p.ang += Math.PI;
    return p;
}

// Which end of edge `e` does travel sense `d` exit by?
function railExitNode(e, d) {
    return d > 0 ? railEdges[e].b : railEdges[e].a;
}

function railEntryNode(e, d) {
    return d > 0 ? railEdges[e].a : railEdges[e].b;
}

// The arc position of the entry / exit end of `e` for sense `d`.
function railEntryS(e, d) { return d > 0 ? 0 : railEdges[e].len; }
function railExitS(e, d) { return d > 0 ? railEdges[e].len : 0; }

// --- queries --------------------------------------------------------
// The arc position on edge `e` nearest a world point. Pump stops, doors and
// boulders are all authored as "beside THIS thing" and converted to an
// (edge, s) once, at build time -- so nothing searches the network at
// runtime, and a map edit that moves a silo moves its pump with it.
function railNearestOnEdge(e, x, y) {
    const E = railEdges[e];
    if (!E) return { s: 0, d: Infinity };
    let bestS = 0, bestD = Infinity;
    for (let k = 1; k < E.pts.length; k++) {
        const a = E.pts[k - 1], b = E.pts[k];
        const dx = b.x - a.x, dy = b.y - a.y;
        const L2 = dx * dx + dy * dy;
        let t = L2 > 0 ? ((x - a.x) * dx + (y - a.y) * dy) / L2 : 0;
        t = rClamp(t, 0, 1);
        const px = a.x + dx * t, py = a.y + dy * t;
        const d = Math.hypot(x - px, y - py);
        if (d < bestD) { bestD = d; bestS = E.cum[k - 1] + Math.hypot(dx, dy) * t; }
    }
    return { s: bestS, d: bestD };
}

// The nearest point on the WHOLE network: { e, s, d }.
function railNearestOnNet(x, y) {
    let best = { e: -1, s: 0, d: Infinity };
    for (let i = 0; i < railEdges.length; i++) {
        const r = railNearestOnEdge(i, x, y);
        if (r.d < best.d) best = { e: i, s: r.s, d: r.d };
    }
    return best;
}

// --- switches -------------------------------------------------------
function railSwitchAtNode(n) {
    for (let i = 0; i < railSwitches.length; i++) if (railSwitches[i].node === n) return railSwitches[i];
    return null;
}

function railAddSwitch(nodeIdx, trunkEdge, branchA, branchB) {
    const n = railNodes[nodeIdx];
    railSwitches.push({
        id: railSwitches.length, node: nodeIdx,
        trunk: trunkEdge, branches: [branchA, branchB], thrown: 0,
        // The lever stands clear of the track, so you can reach it and shoot
        // it without standing in front of a car.
        x: n.x, y: n.y, lx: n.x, ly: n.y,
        hp: 1, litUntil: 0
    });
    return railSwitches.length - 1;
}

// Where the lever stands: RAIL_LEVER_OFF px to one side of the trunk, on the
// outside of the fork. Computed once the geometry exists, because it depends
// on which way the branches leave.
const RAIL_LEVER_OFF = 54;

function railPlaceLevers() {
    for (let i = 0; i < railSwitches.length; i++) {
        const sw = railSwitches[i];
        const n = railNodes[sw.node];
        // Tangent of the trunk at this node, pointing away from the node.
        const tEdge = railEdges[sw.trunk];
        if (!tEdge) continue;
        const towardTrunk = (tEdge.a === sw.node) ? 1 : -1;
        const p = railPose(sw.trunk, towardTrunk > 0 ? 24 : tEdge.len - 24);
        let ax = Math.atan2(p.y - n.y, p.x - n.x);
        // Put the lever on the side AWAY from the mean of the branches, so it
        // never sits between the two diverging tracks where a car would run
        // over the player reaching for it.
        let bx = 0, by = 0, nb = 0;
        for (let k = 0; k < 2; k++) {
            const be = railEdges[sw.branches[k]];
            if (!be) continue;
            const bt = (be.a === sw.node) ? railPose(sw.branches[k], 40)
                                          : railPose(sw.branches[k], be.len - 40);
            bx += bt.x - n.x; by += bt.y - n.y; nb++;
        }
        let side;
        if (nb) {
            const bAng = Math.atan2(by / nb, bx / nb);
            // Normal to the trunk, chosen opposite the branches' mean.
            const nx = -Math.sin(ax), ny = Math.cos(ax);
            side = (nx * Math.cos(bAng) + ny * Math.sin(bAng)) > 0 ? -1 : 1;
        } else {
            side = 1;
        }
        sw.lx = n.x + (-Math.sin(ax)) * RAIL_LEVER_OFF * side;
        sw.ly = n.y + (Math.cos(ax)) * RAIL_LEVER_OFF * side;
    }
}

// Is any body's route standing on this switch's node? A lever is REFUSED
// rather than derailing anything -- the sandbox is for learning the mechanic,
// and a derailment is a state with no recovery and nothing to teach.
function railSwitchOccupied(sw) {
    if (typeof railBodies === "undefined") return false;
    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        for (let k = 0; k < b.route.length; k++) {
            const e = b.route[k].e;
            if (railEdges[e].a === sw.node || railEdges[e].b === sw.node) {
                // The edge touches the node; does the body actually cover it?
                if (railBodyCoversNode(b, sw.node)) return true;
            }
        }
    }
    return false;
}

// THE ONE PLACE A SWITCH MOVES. Both the F verb and a bullet route here, so
// the two can never drift apart (DEV_TOOLS_PLAN.md's lesson about one input
// path, applied to a game verb).
function railThrowSwitch(sw, why) {
    if (!sw) return false;
    if (railSwitchOccupied(sw)) {
        if (typeof railToast === "function") railToast("POINTS OCCUPIED — CLEAR THE CAR FIRST", 1600);
        return false;
    }
    sw.thrown = sw.thrown ? 0 : 1;
    sw.litUntil = Date.now() + 420;
    if (typeof railSfx === "function") railSfx("switch", sw.lx, sw.ly);
    if (typeof railToast === "function") {
        const to = railEdges[sw.branches[sw.thrown]];
        railToast("POINTS -> " + (to ? to.label || to.name.toUpperCase() : "?") +
                  (why === "shot" ? "  (SHOT)" : ""), 1300);
    }
    return true;
}

// --- traversal ------------------------------------------------------
// Arriving at node `n` along edge `from` with sense `d`: which edge next?
// Returns { e, d } or null for a dead end.
//
// THREE CASES, and the middle one is the design decision:
//
//  - a plain joint (2 edges): the other one.
//  - a FACING move (arriving on the trunk): branches[thrown]. This is the
//    only choice the player manages, and it is the whole mechanic.
//  - a TRAILING move (arriving on a branch): the trunk, AND the switch
//    auto-aligns to the branch you came from. Chosen over blocking because a
//    trailing move has exactly one destination, so refusing it teaches
//    nothing and strands a car in mid-track with no feedback and no verb that
//    would free it.
function railNextEdge(from, n) {
    const node = railNodes[n];
    if (!node) return null;
    const sw = railSwitchAtNode(n);
    if (sw) {
        if (from === sw.trunk) {
            const nx = sw.branches[sw.thrown];
            if (nx === undefined || nx < 0) return null;
            return { e: nx, d: railEdges[nx].a === n ? 1 : -1 };
        }
        const bi = sw.branches.indexOf(from);
        if (bi >= 0) {
            if (sw.thrown !== bi && !railSwitchOccupied(sw)) sw.thrown = bi;   // trailable
            const nx = sw.trunk;
            return { e: nx, d: railEdges[nx].a === n ? 1 : -1 };
        }
        return null;
    }
    // No switch: take the only other edge, if there is exactly one.
    let found = -1, count = 0;
    for (let i = 0; i < node.edges.length; i++) {
        if (node.edges[i] === from) continue;
        found = node.edges[i]; count++;
    }
    if (count !== 1) return null;        // dead end (0), or an unswitched fork (bug in the map)
    return { e: found, d: railEdges[found].a === n ? 1 : -1 };
}

// --- blockers -------------------------------------------------------
// A point on an edge that a car may not pass. The arcade's rule, which
// zombie-train.js found in the browser and got right, is kept: a shut
// crossing is a SHUT LINE. Here it is literal -- the door blocks the car
// itself, not just the rider who was being scraped off against it.
function railAddBlocker(e, s, kind, ref) {
    railBlockers.push({ e: e, s: s, kind: kind, ref: ref || null });
    return railBlockers.length - 1;
}

function railBlockerLive(bl) {
    if (!bl) return false;
    if (bl.kind === "door") return bl.ref && !bl.ref.open;
    return true;                          // buffer stops and boulders never clear
}

// Did a point travelling from s0 to s1 along edge `e` cross a live blocker?
// Returns the blocker and the s it was stopped at, or null.
function railBlockerCrossed(e, s0, s1) {
    let hit = null, hitS = 0;
    const lo = Math.min(s0, s1), hi = Math.max(s0, s1);
    for (let i = 0; i < railBlockers.length; i++) {
        const bl = railBlockers[i];
        if (bl.e !== e || !railBlockerLive(bl)) continue;
        if (bl.s < lo || bl.s > hi) continue;
        // The nearest one to where the move started wins, or a fast car
        // would tunnel past the first of two blockers on one edge.
        if (!hit || Math.abs(bl.s - s0) < Math.abs(hitS - s0)) { hit = bl; hitS = bl.s; }
    }
    return hit ? { bl: hit, s: hitS } : null;
}

// --- route walking --------------------------------------------------
// A ROUTE is [{ e, d }, ...], front-most first. `headS` is the arc position
// of the body's front point on route[0].
//
// Distance from the head back to route[0]'s entry end -- i.e. how much of the
// body route[0] can still hold.
function railSpanBehind(route, i, headS) {
    const r = route[i];
    if (i === 0) return r.d > 0 ? headS : railEdges[r.e].len - headS;
    return railEdges[r.e].len;
}

// Total track behind the head that the stored route covers.
function railRouteSpan(route, headS) {
    let t = 0;
    for (let i = 0; i < route.length; i++) t += railSpanBehind(route, i, headS);
    return t;
}

// `back` px behind the head -> { e, s, d, x, y, ang }. THE ONE function every
// car's pose comes from, so a car straddling a junction bends with the track
// instead of being drawn along a chord.
function railWalkBack(route, headS, back) {
    let i = 0;
    let s = headS;
    let remaining = Math.max(0, back);
    for (;;) {
        const r = route[i];
        // How much track is left between `s` and this edge's ENTRY end. One
        // expression covers every i, because on entering a further-back edge
        // `s` is set to that edge's exit end -- so this reads `len` there,
        // whichever way round the edge is traversed.
        const avail = r.d > 0 ? s : railEdges[r.e].len - s;
        if (remaining <= avail || i === route.length - 1) {
            const ns = rClamp(s - remaining * r.d, 0, railEdges[r.e].len);
            const p = railPoseDir(r.e, ns, r.d);
            return { e: r.e, s: ns, d: r.d, x: p.x, y: p.y, ang: p.ang };
        }
        remaining -= avail;
        i++;
        // Entering the next edge back at ITS exit end.
        s = railExitS(route[i].e, route[i].d);
    }
}

// Does the body cover `node`? Used to refuse a lever under a car.
function railBodyCoversNode(b, node) {
    const total = railBodyLength(b);
    // Walk the route from the head; a node is covered when it lies strictly
    // inside the occupied span.
    let acc = 0;
    for (let i = 0; i < b.route.length; i++) {
        const r = b.route[i];
        const span = (i === 0) ? (r.d > 0 ? b.headS : railEdges[r.e].len - b.headS) : railEdges[r.e].len;
        acc += span;
        if (acc >= total) {
            // The body ends inside this edge: the node at its far end is clear.
            return false;
        }
        // The body continues past this edge's entry end -- that node is covered.
        if (railEntryNode(r.e, r.d) === node) return true;
    }
    return false;
}
