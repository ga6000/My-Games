// ===================================================
//   RAIL SANDBOX — cars, bodies, coupling, 1-D physics
// ===================================================
// A BODY is one or more coupled cars sharing one velocity and one route:
// ONE DEGREE OF FREEDOM, exactly as zombie-train.js established. Coupled cars
// have no independent position -- theirs is an offset behind the body's head,
// which is what makes a consist one scalar rather than four.
//
// THE PHYSICS THE USER ASKED FOR FALLS OUT OF SUMMING MASS. "Multiple rail
// cars attached are not pushed as easily" needs no special case: a rocket is
// an IMPULSE, so dv = J / totalMass. One flatbed takes a big shove; the same
// rocket into a four-car set moves it a quarter as much. Acceleration and
// braking are divided by the same mass, so a long train is also slow to stop
// -- which is where "learn when to cut power" comes from.
"use strict";

// --- the four kinds -------------------------------------------------
// len/wid in px; mass is relative, with a flatbed as 1.
const RAIL_KINDS = {
    loco:      { len: 220, wid: 62, mass: 4.0, label: "LOCOMOTIVE" },
    flatbed:   { len: 190, wid: 56, mass: 1.0, label: "FLAT BED" },
    boxcar:    { len: 190, wid: 60, mass: 1.4, label: "BOX CAR" },
    passenger: { len: 200, wid: 58, mass: 1.3, label: "PASSENGER CAR" }
};
const RAIL_KIND_ORDER = ["loco", "flatbed", "boxcar", "passenger"];

const RAIL_COUPLE_GAP = 10;     // drawn gap between coupled cars
const RAIL_COUPLE_DIST = 20;    // how close two ends must be to couple
const RAIL_NOSE_PAD = 2;        // how far short of a blocker a car stops

// Rolling resistance. LOW on purpose: momentum is the mechanic, and at the
// arcade's 120 px/s^2 a coasting car stopped in under two seconds, which read
// as "the brakes are always on" rather than as a heavy thing rolling.
const RAIL_FRICTION = 34;       // px/s^2
const RAIL_BOUNCE = 0.35;       // restitution off a blocker

// A rocket's impulse, in px/s of velocity for a mass of 1.
const RAIL_ROCKET_J = 420;
// A player leaning on a car with F. Much smaller than a rocket, and it is how
// a player with no rocket still assembles a train.
const RAIL_PUSH_ACCEL = 190;    // px/s^2 for a mass of 1
const RAIL_PUSH_REACH = 38;

// TWO DIFFERENT CAPS, and conflating them cost the rocket its punch.
//
// RAIL_SHUNT_MAX is how fast a PLAYER LEANING ON A CAR can get it going. It
// is a pace cap, so hand-shunting stays a deliberate, walking-speed job.
//
// RAIL_LOOSE_MAX is the ceiling on a loose body however it was set moving,
// and it has to clear a rocket's full impulse on the lightest car
// (RAIL_ROCKET_J / 1.0 = 420) or the mass physics disappears at the top end:
// with one cap at 150, a flatbed and a two-car set both clamped to 150 and
// the rocket felt identical whatever it hit. zombie-train.js had the same
// split for the same reason -- its kick clamped to six times its shunt cap.
const RAIL_SHUNT_MAX = 150;     // px/s, the hand-push pace cap
const RAIL_LOOSE_MAX = 460;     // px/s, a loose car's outright ceiling

let railCars = [];              // every car, by index; a car names its body
let railBodies = [];            // [{ cars: [carIdx], route: [{e,d}], headS, v, notch, dir }]

function railCarsReset() {
    railCars = [];
    railBodies = [];
}

// --- construction ---------------------------------------------------
function railMakeCar(kind) {
    const k = RAIL_KINDS[kind] || RAIL_KINDS.flatbed;
    const c = {
        id: railCars.length, kind: kind,
        len: k.len, wid: k.wid, mass: k.mass,
        body: -1,
        // Derived every frame from the body's route; `p*` is last frame's
        // centre, which is what a rider's carry delta is measured from.
        cx: 0, cy: 0, pcx: 0, pcy: 0, ang: 0,
        crates: [],
        seed: railCars.length * 7919 + 13
    };
    // Only a locomotive has a tank. Started at a quarter so the sandbox opens
    // with enough blood to move but not enough to ignore the pumps.
    if (kind === "loco") c.fuel = 0.25;
    if (kind === "boxcar") {
        // "sometimes boxes inside" -- deterministic per car, so a reload
        // shows the same wagon loaded the same way.
        const rnd = railRng(c.seed);
        if (rnd() < 0.6) {
            const n = 2 + Math.floor(rnd() * 4);
            for (let i = 0; i < n; i++) {
                c.crates.push({
                    o: (rnd() - 0.5) * (k.len - 70),
                    a: (rnd() - 0.5) * (k.wid - 34),
                    s: 18 + Math.floor(rnd() * 12),
                    t: rnd()
                });
            }
        }
    }
    railCars.push(c);
    return c;
}

// Put a new body on the network at an anchor. `kinds` is front to back.
function railSpawnBody(kinds, e, s, d) {
    const body = {
        id: railBodies.length,
        cars: [],
        route: [{ e: e, d: d }],
        headS: s,
        v: 0,
        notch: 0,          // locomotive power notch, -2..4
        dir: 1,            // which way the locomotive is set to drive
        pumpAt: -1,        // index of the silo it is latched to, or -1
        lastBlock: 0
    };
    for (let i = 0; i < kinds.length; i++) {
        const c = railMakeCar(kinds[i]);
        c.body = body.id;
        body.cars.push(c.id);
    }
    railBodies.push(body);
    railEnsureRouteBehind(body, railBodyLength(body) + 40);
    railSyncBody(body, true);
    return body;
}

// --- derived quantities ---------------------------------------------
function railBodyLength(b) {
    let t = 0;
    for (let i = 0; i < b.cars.length; i++) t += railCars[b.cars[i]].len;
    return t + RAIL_COUPLE_GAP * Math.max(0, b.cars.length - 1);
}

function railBodyMass(b) {
    let m = 0;
    for (let i = 0; i < b.cars.length; i++) m += railCars[b.cars[i]].mass;
    return m || 1;
}

// Distance from the body's front face to car i's centre.
function railCarOffset(b, i) {
    let off = 0;
    for (let k = 0; k < i; k++) off += railCars[b.cars[k]].len + RAIL_COUPLE_GAP;
    return off + railCars[b.cars[i]].len / 2;
}

function railBodyOf(carIdx) {
    const c = railCars[carIdx];
    return c ? railBodies[c.body] : null;
}

function railBodyLoco(b) {
    // A locomotive is always cars[0] -- see the coupling rule below, which is
    // what keeps that true rather than merely hoping for it.
    if (!b || !b.cars.length) return null;
    const c = railCars[b.cars[0]];
    return c && c.kind === "loco" ? c : null;
}

function railHasLoco(b) {
    return !!railBodyLoco(b);
}

// The two ends, in world space and on the network.
function railBodyFront(b) {
    return railWalkBack(b.route, b.headS, 0);
}

function railBodyBack(b) {
    return railWalkBack(b.route, b.headS, railBodyLength(b));
}

// Re-derive every car's pose from the route. `prime` seeds the previous
// centre so the first frame reports a zero carry delta rather than a jump --
// the same fix zombie-train.js needed in trainSyncCar.
function railSyncBody(b, prime) {
    for (let i = 0; i < b.cars.length; i++) {
        const c = railCars[b.cars[i]];
        const p = railWalkBack(b.route, b.headS, railCarOffset(b, i));
        c.pcx = prime ? p.x : c.cx;
        c.pcy = prime ? p.y : c.cy;
        c.cx = p.x; c.cy = p.y; c.ang = p.ang;
    }
}

// --- route maintenance ----------------------------------------------
// THE INVARIANT: the route covers at least the body's length behind the head.
// Extending at the BACK is what reversing into fresh track looks like, and it
// is the only place the route grows backwards.
//
// Note the sign flip on `d`. railNextEdge answers "arriving at n along
// `from`, where next?" and returns the sense for ENTERING the new edge at n.
// A back-extension needs the opposite: the new edge is behind, so travel
// leaves it AT n, which means its exit end is n.
function railEnsureRouteBehind(b, need) {
    let guard = 0;
    while (railRouteSpan(b.route, b.headS) < need && guard++ < 64) {
        const rl = b.route[b.route.length - 1];
        const n = railEntryNode(rl.e, rl.d);
        const nx = railNextEdge(rl.e, n);
        if (!nx) return false;                       // buffer stop behind
        b.route.push({ e: nx.e, d: -nx.d });
    }
    return true;
}

// Drop tail edges the body no longer reaches.
function railTrimRoute(b) {
    const need = railBodyLength(b);
    let guard = 0;
    while (b.route.length > 1 && guard++ < 64) {
        const without = railRouteSpan(b.route.slice(0, b.route.length - 1), b.headS);
        if (without < need) break;
        b.route.pop();
    }
}

// --- the move -------------------------------------------------------
// Signed `dist` in the body's travel frame. Returns the blocker it hit, or
// null. Blockers are tested at the LEADING end only, because a rigid body can
// only newly contact one there -- and at 1300 px/s a 60Hz step is 22px, well
// inside one edge, so nothing tunnels.
function railAdvance(b, dist) {
    if (!dist) return null;

    if (dist > 0) {
        let left = dist, guard = 0;
        while (left > 1e-6 && guard++ < 64) {
            const r = b.route[0];
            const exitS = railExitS(r.e, r.d);
            const gap = Math.abs(exitS - b.headS);
            const step = Math.min(left, gap);
            const target = b.headS + step * r.d;
            const cross = railBlockerCrossed(r.e, b.headS, target);
            if (cross) {
                b.headS = cross.s - r.d * RAIL_NOSE_PAD;
                railTrimRoute(b);
                return cross.bl;
            }
            if (left <= gap) { b.headS = target; break; }
            left -= gap;
            b.headS = exitS;
            const n = railExitNode(r.e, r.d);
            const nx = railNextEdge(r.e, n);
            if (!nx) { railTrimRoute(b); return { kind: "end" }; }
            b.route.unshift({ e: nx.e, d: nx.d });
            b.headS = railEntryS(nx.e, nx.d);
        }
        railEnsureRouteBehind(b, railBodyLength(b) + 40);
        railTrimRoute(b);
        return null;
    }

    // --- reversing: the TAIL leads -----------------------------------
    const amt = -dist;
    const bodyLen = railBodyLength(b);
    // Lay track behind before moving onto it; failing means a buffer stop.
    const ok = railEnsureRouteBehind(b, bodyLen + amt + 40);
    const tailBefore = railBodyBack(b);
    if (!ok) {
        // Only actually blocked if the tail is already at the route's end.
        const span = railRouteSpan(b.route, b.headS);
        if (span - bodyLen < amt) return { kind: "end" };
    }
    // Did the tail cross a blocker on its own edge this step?
    const tTarget = tailBefore.s - amt * tailBefore.d;
    const tCross = railBlockerCrossed(tailBefore.e, tailBefore.s, tTarget);
    if (tCross) {
        // Back the body off so the tail sits just clear of it.
        const over = Math.abs(tailBefore.s - tCross.s);
        const move = Math.max(0, over - RAIL_NOSE_PAD);
        railMoveHeadBack(b, move);
        railTrimRoute(b);
        return tCross.bl;
    }
    railMoveHeadBack(b, amt);
    railTrimRoute(b);
    return null;
}

// Retreat the head by `amt`, shifting route[0] off when it leaves that edge.
function railMoveHeadBack(b, amt) {
    let left = amt, guard = 0;
    while (left > 1e-6 && guard++ < 64) {
        const r = b.route[0];
        const entryS = railEntryS(r.e, r.d);
        const avail = Math.abs(b.headS - entryS);
        if (left <= avail) { b.headS -= left * r.d; break; }
        left -= avail;
        if (b.route.length < 2) { b.headS = entryS; break; }
        b.route.shift();
        const r2 = b.route[0];
        b.headS = railExitS(r2.e, r2.d);
    }
}

// --- impulses -------------------------------------------------------
// THE MOMENT THE SYSTEM EXISTS FOR. A rocket blast shunts whatever it caught,
// in the direction the rocket was travelling, PROJECTED onto the track. A
// rocket fired across the rails moves nothing, which is correct and is also
// why the shot has to be aimed rather than merely near.
function railRocketKick(x, y, vx, vy, radius) {
    let hit = false;
    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        for (let k = 0; k < b.cars.length; k++) {
            const c = railCars[b.cars[k]];
            if (rDist(x, y, c.cx, c.cy) > (radius || 150) + c.len / 2) continue;
            const dirx = Math.cos(c.ang), diry = Math.sin(c.ang);
            let along = (vx || 0) * dirx + (vy || 0) * diry;
            if (Math.abs(along) < 0.001) along = (x < c.cx ? 1 : -1);
            const sign = along > 0 ? 1 : -1;
            // dv = J / m. The whole requested physics, in one line.
            b.v += sign * RAIL_ROCKET_J / railBodyMass(b);
            hit = true;
            break;                       // one kick per body, not per car
        }
    }
    return hit;
}

// A player leaning on a loose car with F. You push from a car's END, not its
// side, so walking past one does not shove it -- and which end you stand at
// decides which way it rolls.
function railPushFromPlayer(p, dt) {
    if (!p) return "";
    let acted = "";
    // THE PLAYER'S CENTRE, not their top-left corner. railUpdatePrompt tests
    // the centre, and the two have to agree or the printed verb is offset
    // from the one F actually runs by half a body -- 8px, which is enough to
    // stand somewhere the prompt says PUSH and have nothing happen.
    const sz = p.size || 16;
    const pcx = p.x + sz / 2, pcy = p.y + sz / 2;
    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        if (railHasLoco(b)) continue;             // you do not hand-shunt a locomotive
        for (let k = 0; k < b.cars.length; k++) {
            const c = railCars[b.cars[k]];
            const L = rLocalInOriented(pcx, pcy, c.cx, c.cy, c.ang);
            if (Math.abs(L.ly) > c.wid / 2 + RAIL_PUSH_REACH) continue;
            const half = c.len / 2;
            let push = 0;
            if (L.lx < -half + 6 && L.lx > -half - RAIL_PUSH_REACH) push = 1;
            else if (L.lx > half - 6 && L.lx < half + RAIL_PUSH_REACH) push = -1;
            if (!push) continue;
            const dv = push * RAIL_PUSH_ACCEL / railBodyMass(b) * (dt / 1000);
            b.v = rClamp(b.v + dv, -RAIL_SHUNT_MAX, RAIL_SHUNT_MAX);
            acted = RAIL_KINDS[c.kind].label;
        }
    }
    return acted;
}

// --- contacts: couple, or push --------------------------------------
// ONE RULE, and it is why a locomotive is always cars[0]:
//
//   Contact at a body's FRONT end whose first car is a locomotive -> PUSH.
//   Every other contact -> COUPLE.
//
// That single line gives the user's whole spec. Driving forward, the loco's
// pilot leads, so it shoves cars along without taking them. Reversing, the
// consist's REAR leads, and the rear is a coupler -- so you back onto a car
// to pick it up. It is how a real locomotive shunts, and it needs no mode,
// no key and no extra state.
function railResolveContacts() {
    for (let i = 0; i < railBodies.length; i++) {
        for (let j = i + 1; j < railBodies.length; j++) {
            const A = railBodies[i], B = railBodies[j];
            if (!A || !B) continue;
            const con = railContact(A, B);
            // OUT OF CONTACT: that is what clears a no-couple mark. See
            // railNoCouple -- a pair has to actually come apart before it may
            // join again.
            if (!con) { railClearNoCouple(A, B); continue; }

            // Are they closing? Compare velocities along A's travel sense,
            // accounting for whether B runs the same way round.
            const sameSense = Math.cos(con.aAng - con.bAng) >= 0;
            const bv = sameSense ? B.v : -B.v;
            const closing = con.aEnd > 0 ? (A.v - bv) > -1 : (bv - A.v) > -1;
            if (!closing) continue;

            const aLocoNose = con.aEnd > 0 && railHasLoco(A);
            const bLocoNose = con.bEnd > 0 && railHasLoco(B);
            if (aLocoNose || bLocoNose) {
                railPushPair(A, B, sameSense);
            } else if (railNoCouple(A, B)) {
                // Just uncoupled and still touching: shove, never re-latch.
                // A locomotive must still be able to push a car it has only
                // this second dropped, so only the COUPLING is suppressed.
                railPushPair(A, B, sameSense);
            } else {
                railCouple(A, B, con, sameSense);
                return;                  // the arrays changed; finish next frame
            }
        }
    }
}

// --- the no-couple mark ---------------------------------------------
// WITHOUT THIS, UNCOUPLING DOES NOT EXIST. railUncouple leaves the two halves
// one RAIL_COUPLE_GAP apart -- 10px, inside RAIL_COUPLE_DIST -- and the
// closing test treats equal velocities as closing (a relative speed of 0 is
// not receding), so the very next frame re-merged them. Measured: split a
// loco from its wagon, step four frames, and it was one body again.
//
// A TIMER WOULD BE THE WRONG FIX. Two cars left standing together would
// simply re-latch when it expired. The condition that matters is physical:
// the pair must actually COME APART before it may join again, so the mark is
// cleared by railContact returning null -- i.e. by a real gap opening.
//
// Marks name CARS, not bodies: body indices are renumbered by
// railRemoveBody, car ids are stable.
function railNoCouple(A, B) {
    if (A.noCouple) { for (let i = 0; i < A.noCouple.length; i++) if (B.cars.indexOf(A.noCouple[i]) >= 0) return true; }
    if (B.noCouple) { for (let i = 0; i < B.noCouple.length; i++) if (A.cars.indexOf(B.noCouple[i]) >= 0) return true; }
    return false;
}

function railClearNoCouple(A, B) {
    if (A.noCouple) A.noCouple = A.noCouple.filter(function (id) { return B.cars.indexOf(id) < 0; });
    if (B.noCouple) B.noCouple = B.noCouple.filter(function (id) { return A.cars.indexOf(id) < 0; });
}

// Nearest pair of ends between two bodies. aEnd/bEnd: +1 front, -1 back.
function railContact(A, B) {
    const af = railBodyFront(A), ab = railBodyBack(A);
    const bf = railBodyFront(B), bb = railBodyBack(B);
    const opts = [
        { a: af, b: bf, aEnd: 1, bEnd: 1 },
        { a: af, b: bb, aEnd: 1, bEnd: -1 },
        { a: ab, b: bf, aEnd: -1, bEnd: 1 },
        { a: ab, b: bb, aEnd: -1, bEnd: -1 }
    ];
    let best = null, bd = Infinity;
    for (let i = 0; i < opts.length; i++) {
        const d = rDist(opts[i].a.x, opts[i].a.y, opts[i].b.x, opts[i].b.y);
        if (d < bd) { bd = d; best = opts[i]; }
    }
    if (bd > RAIL_COUPLE_DIST) return null;
    // Two cars on PARALLEL tracks must never couple: the sidings run 260px
    // from the main line, so distance alone would already rule it out, but a
    // tangent test makes that a stated rule rather than a lucky number.
    if (Math.abs(Math.cos(best.a.ang - best.b.ang)) < 0.6) return null;
    return { aEnd: best.aEnd, bEnd: best.bEnd, aAng: best.a.ang, bAng: best.b.ang, gap: bd };
}

// Pushing: solve the pair as momentarily rigid. Both take the
// momentum-conserving common velocity for this frame, but stay SEPARATE
// bodies -- so under power the locomotive re-accelerates and shoves again
// next frame, and a heavier set accelerates more slowly.
function railPushPair(A, B, sameSense) {
    const mA = railBodyMass(A), mB = railBodyMass(B);
    const bvA = sameSense ? B.v : -B.v;
    const vc = (mA * A.v + mB * bvA) / (mA + mB);
    A.v = vc;
    B.v = sameSense ? vc : -vc;
}

// Inelastic merge. A car slammed into a stationary train should NUDGE it, not
// vanish into it -- so the consist takes the mass-weighted velocity.
function railCouple(A, B, con, sameSense) {
    // The body whose BACK is in contact keeps its route and leads; the other
    // one's cars hang behind it.
    let front = A, rear = B, frontEnd = con.aEnd, rearSame = sameSense;
    if (con.aEnd > 0 && con.bEnd < 0) { front = B; rear = A; frontEnd = con.bEnd; }
    else if (con.aEnd < 0) { front = A; rear = B; frontEnd = con.aEnd; }
    else {
        // Front-to-front, neither a locomotive nose: whoever is slower leads.
        if (Math.abs(A.v) < Math.abs(B.v)) { front = A; rear = B; } else { front = B; rear = A; }
    }

    const mF = railBodyMass(front), mR = railBodyMass(rear);
    const rv = rearSame ? rear.v : -rear.v;
    const vc = (mF * front.v + mR * rv) / (mF + mR);

    // The rear body's cars join, nearest-first. Its own order is preserved
    // when it runs the same way round, and reversed when it does not -- the
    // car that was touching must end up adjacent to the joint.
    const add = (frontEnd < 0) ? rear.cars.slice() : rear.cars.slice().reverse();
    if (!rearSame) add.reverse();

    // SPLICE THE REAR'S ROUTE ON rather than re-deriving it from switches.
    // Re-deriving could pick the other branch of a fork the rear body is
    // standing on, which would move cars that have not moved.
    for (let i = 0; i < rear.route.length; i++) {
        const r = rear.route[i];
        let have = false;
        for (let k = 0; k < front.route.length; k++) if (front.route[k].e === r.e) { have = true; break; }
        if (!have) front.route.push({ e: r.e, d: rearSame ? r.d : -r.d });
    }

    for (let i = 0; i < add.length; i++) {
        railCars[add[i]].body = front.id;
        front.cars.push(add[i]);
    }
    front.v = vc;
    if (rear.notch) front.notch = front.notch || rear.notch;
    // Carry the rear's no-couple marks across, minus any naming a car that is
    // now inside this very body (a mark against yourself can never fire).
    front.noCouple = (front.noCouple || []).concat(rear.noCouple || [])
        .filter(function (id) { return front.cars.indexOf(id) < 0; });

    railRemoveBody(rear);
    railEnsureRouteBehind(front, railBodyLength(front) + 40);
    railTrimRoute(front);
    // No railSyncBody here: railCarsUpdate's single end-of-step pass does it,
    // and syncing twice would zero this body's carry delta for the frame.
    if (typeof railSfx === "function") {
        const c = railCars[front.cars[front.cars.length - 1]];
        railSfx("couple", c.cx, c.cy);
    }
    if (typeof railToast === "function") {
        railToast("COUPLED — " + front.cars.length + " CARS", 1500);
    }
}

// Bodies are addressed by index in `cars[].body`, so removing one has to
// renumber. Done in one place, because getting it wrong detaches a car from
// its body silently and the car then never moves again.
function railRemoveBody(dead) {
    const at = railBodies.indexOf(dead);
    if (at < 0) return;
    railBodies.splice(at, 1);
    for (let i = 0; i < railBodies.length; i++) {
        railBodies[i].id = i;
        for (let k = 0; k < railBodies[i].cars.length; k++) railCars[railBodies[i].cars[k]].body = i;
    }
}

// Split a body at the joint BEHIND car index `at` (0-based within the body).
function railUncouple(b, at) {
    if (!b || at < 0 || at >= b.cars.length - 1) return false;
    const rearCars = b.cars.splice(at + 1);
    const nb = {
        id: railBodies.length,
        cars: rearCars,
        route: b.route.slice(),
        headS: 0,
        v: b.v, notch: 0, dir: 1, pumpAt: -1, lastBlock: 0
    };
    railBodies.push(nb);
    // Each half refuses the other until a real gap opens between them.
    b.noCouple = (b.noCouple || []).concat([rearCars[0]]);
    nb.noCouple = (nb.noCouple || []).concat([b.cars[b.cars.length - 1]]);
    for (let i = 0; i < rearCars.length; i++) railCars[rearCars[i]].body = nb.id;

    // The rear body's head sits one gap behind the front body's new tail.
    const tail = railBodyLength(b) + RAIL_COUPLE_GAP;
    const p = railWalkBack(b.route, b.headS, tail);
    // Rebuild its route starting at that anchor, then let the invariant lay
    // the rest -- it is standing on track the front body just left, so the
    // switches it would consult are the ones it actually came through.
    nb.route = [{ e: p.e, d: p.d }];
    nb.headS = p.s;
    railEnsureRouteBehind(nb, railBodyLength(nb) + 40);
    railTrimRoute(b);
    railSyncBody(b, false);
    railSyncBody(nb, false);
    if (typeof railSfx === "function") railSfx("couple", p.x, p.y);
    if (typeof railToast === "function") railToast("UNCOUPLED", 1400);
    return true;
}

// --- the update -----------------------------------------------------
function railCarsUpdate(now, dt) {
    const sec = dt / 1000;
    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        const m = railBodyMass(b);
        const loco = railBodyLoco(b);

        if (loco && b.notch > 0 && railFuelAvailable(b)) {
            // Power, divided by mass: a long train is slow to get going.
            const a = (b.notch / 4) * RAIL_LOCO_POWER / m;
            b.v += a * b.dir * sec;
            b.v = rClamp(b.v, -RAIL_LOCO_VMAX, RAIL_LOCO_VMAX);
            railBurnFuel(b, sec * (0.3 + 0.7 * b.notch / 4));
        } else if (loco && b.notch < 0) {
            // Braking, also divided by mass -- which is where the whole
            // "learn when to cut power" lesson actually lives.
            const bd = (b.notch === -2 ? RAIL_BRAKE_FULL : RAIL_BRAKE_LIGHT) / m;
            const drop = bd * sec;
            b.v = b.v > 0 ? Math.max(0, b.v - drop) : Math.min(0, b.v + drop);
        } else if (b.v !== 0) {
            const drop = RAIL_FRICTION * sec;
            b.v = b.v > 0 ? Math.max(0, b.v - drop) : Math.min(0, b.v + drop);
        }

        // A loose car has a ceiling; anything with a locomotive does not.
        if (!loco) b.v = rClamp(b.v, -RAIL_LOOSE_MAX, RAIL_LOOSE_MAX);

        const hit = railAdvance(b, b.v * sec);
        if (hit) {
            // BOUNCE off whatever stopped it. A shut door, a buffer stop and
            // a boulder all read the same way: the car rebounds and rings.
            if (Math.abs(b.v) > 14 && now - b.lastBlock > 180) {
                b.lastBlock = now;
                if (typeof railSfx === "function") {
                    const f = railBodyFront(b);
                    railSfx("clang", f.x, f.y);
                }
                railShake(Math.min(8, Math.abs(b.v) / 90));
            }
            b.v = -b.v * RAIL_BOUNCE;
            if (Math.abs(b.v) < 6) b.v = 0;
            if (b.notch > 0) b.notch = 0;      // power is cut by the impact
        }
    }
    // EXACTLY ONE SYNC PER STEP, here at the end, and that is load-bearing.
    //
    // railSyncBody records the previous centre (pcx/pcy) so a rider can be
    // carried by the difference. Calling it twice in a step made the second
    // call record the centre it had just written, so every delta came out as
    // ZERO and nothing ever rode a car -- found by standing a player on a
    // flatbed at 60px/s and measuring that they moved 0px with it.
    //
    // Contacts do not need the sync: railContact and railBodyFront/Back are
    // computed from the route and headS, never from cx/cy.
    railResolveContacts();
    for (let i = 0; i < railBodies.length; i++) railSyncBody(railBodies[i], false);
}

// --- riders ---------------------------------------------------------
// The one carriage rule. Returns the car a point is riding, or null.
//
// MOUNTABLE AT ANY SPEED, as the user asked -- there is deliberately no
// board-speed gate here. zombie-train.js had TRAIN_BOARD_MAX because boarding
// a departing train was the win condition and had to be defensible. Nothing
// here is a win condition, and "I cannot get on a moving car" is exactly the
// thing a sandbox must not do. What a fast car costs you is handled instead
// by the cowcatcher below: the DECK is always safe, the NOSE is not.
function railCarUnder(x, y, size) {
    const sz = size || 16;
    for (let i = 0; i < railCars.length; i++) {
        const c = railCars[i];
        if (rPointInOriented(x + sz / 2, y + sz / 2, c.cx, c.cy, c.len, c.wid, c.ang)) return c;
    }
    return null;
}

function railCarryDelta(x, y, size) {
    const c = railCarUnder(x, y, size);
    if (!c) return null;
    return { dx: c.cx - c.pcx, dy: c.cy - c.pcy, car: c };
}

// THE COWCATCHER. Above RAIL_KILL_SPEED, standing in the locomotive's NOSE
// band is instant death. Not the whole locomotive -- the nose: a 26px strip
// at its leading end. That distinction is the entire reason "mount at any
// speed" and "instant death above x speed" are not contradictory.
const RAIL_KILL_SPEED = 170;
const RAIL_NOSE_BAND = 26;

function railLocoNoseKill(p) {
    if (!p || p.dead) return null;
    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        const loco = railBodyLoco(b);
        if (!loco) continue;
        if (Math.abs(b.v) < RAIL_KILL_SPEED) continue;
        // Which end leads? Forward, the nose; reversing, the rear coupler --
        // and a coupler does not kill, it couples.
        if (b.v < 0) continue;
        const L = rLocalInOriented(p.x + p.size / 2, p.y + p.size / 2, loco.cx, loco.cy, loco.ang);
        if (Math.abs(L.ly) > loco.wid / 2) continue;
        if (L.lx > loco.len / 2 - RAIL_NOSE_BAND && L.lx < loco.len / 2 + 10) return b;
    }
    return null;
}

// --- prompts --------------------------------------------------------
// What to print for a player standing at a car. The pilot seat is the
// locomotive's own leading quarter, on the deck -- so you walk up the train
// to drive it, which is the thing the prompt has to teach.
const RAIL_PILOT_FRAC = 0.30;

function railPilotCarFor(p) {
    if (!p) return null;
    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        const loco = railBodyLoco(b);
        if (!loco) continue;
        const L = rLocalInOriented(p.x + p.size / 2, p.y + p.size / 2, loco.cx, loco.cy, loco.ang);
        if (Math.abs(L.ly) > loco.wid / 2) continue;
        // The cab is BEHIND the nose band: the back 30% of the locomotive.
        if (L.lx < -loco.len / 2 || L.lx > -loco.len / 2 + loco.len * RAIL_PILOT_FRAC) continue;
        return { body: b, loco: loco };
    }
    return null;
}

// Which coupled joint is a player standing at, for the uncouple verb?
function railJointFor(p) {
    if (!p) return null;
    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        if (b.cars.length < 2) continue;
        for (let k = 0; k < b.cars.length - 1; k++) {
            const a = railCars[b.cars[k]], c = railCars[b.cars[k + 1]];
            const jx = (a.cx + c.cx) / 2, jy = (a.cy + c.cy) / 2;
            if (rDist(p.x + p.size / 2, p.y + p.size / 2, jx, jy) < 36) return { body: b, at: k, x: jx, y: jy };
        }
    }
    return null;
}
