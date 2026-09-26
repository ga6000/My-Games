// ===================================================
//   Zombie Alt — THE EVACUATION TRAIN (2026-09-25)
// ===================================================
// The design and the reasoning are in zombie/TRAIN_RAIL_PLAN.md. The short
// version, because it is the thing that makes this file small:
//
//   A TRAIN ON RAILS HAS ONE DEGREE OF FREEDOM.
//
// It is not 2-D rigid-body physics. Each car is a SCALAR -- arc length `s`
// along one polyline -- plus a velocity. Collisions are 1-D. Coupling is
// "merge two bodies and sum the mass". Everything visible (the rect, the
// angle, what it covers, where a rider is dragged to) is DERIVED from `s`.
//
// Four consequences, each of which is why something below looks the way it
// does:
//
// 1. NOTHING HERE TOUCHES THE NAV GRID. The cars are not in `walls[]` and
//    not in either solid grid: the deck is walkable for players and zombies
//    alike (TRAIN_RAIL_PLAN.md 2.5, option N2 taken to its flat-deck
//    conclusion). So `rebuildNavGrid`, `refreshNavRegion` and `navDirty` are
//    never involved, a moving car cannot wedge a zombie against geometry,
//    and a moving car cannot crush a player into a wall. The only physical
//    interaction is the cowcatcher (trainShoveZombies), which THROWS rather
//    than blocks.
//
//    **Do not "fix" this by pushing cars into `walls[]`.** `rebuildSolidIndex()`
//    rebuilds BOTH solid grids from scratch, and a mover would pay that 60
//    times a second; worse, `markNavDirty()` triggers a FULL nav rebuild
//    (~17ms) plus up to three BFS fields, every frame.
//
// 2. POSITION IS DERIVED FROM ONE BROADCAST SCALAR PER CAR, never
//    interpolated. Same discipline as escapeGateFrac(): a guest computes the
//    car's rect from `s`, so every screen agrees to the pixel. That is a hard
//    requirement, not tidiness -- a rider adds the car's own delta to its own
//    position (see trainCarryDelta), and two clients disagreeing about the
//    car by a pixel would drag two players to different places.
//
// 3. RIDERS ARE CARRIED, NOT RE-PATHED. There is no second flow field and no
//    local grid: a body whose centre is on a deck gets that deck's delta for
//    the frame. Players apply it CLIENT-SIDE to their own player only,
//    because each client owns its own position and the host cannot move a
//    guest. Zombies get it host-side.
//
// 4. SHUNTING IS SPEED-CAPPED at TRAIN_SHUNT_MAX. The flow field refreshes
//    every NAV_REFRESH_MS (220ms), so a car that travels further than one
//    nav cell (20px) in that window is one zombies steer at where it WAS.
//    20px / 220ms is ~90px/s, and that is the cap. It lifts only once the
//    locomotive is under power, at which point being outrun is the point.
"use strict";

// --- the line ------------------------------------------------------
// One polyline, arc-length parameterised, chosen as the longest railPath.
// THE SIDINGS ARE NOT JOINED TO IT and that is a known limit, not an
// oversight: measured over 10 seeds, a map has one main line plus 3.0
// sidings and ZERO of the sidings touch the line, so a rail GRAPH with
// junctions is real work and it belongs with authored geometry
// (LEVEL_BUILDER_PLAN.md phase 4). Until then the train lives on the
// through line and the Kennels' cars stay scenery.
let trainLine = null;     // { pts, cum, len }
let trainCars = [];       // [{ kind, s, v, len, wid, coupled, cx, cy, pcx, pcy, ang }]
let trainRunning = false; // locomotive under power
let trainStartedAt = 0;   // host clock; crosses as a remaining-style duration
let trainLost = false;

const TRAIN_LOCO_LEN = 220;
const TRAIN_CAR_LEN = 190;
const TRAIN_WID = 56;          // matches the existing railcar art
const TRAIN_COUPLE_GAP = 8;    // drawn gap between coupled cars
const TRAIN_COUPLE_DIST = 16;  // how close a car must get to couple

const TRAIN_FRICTION = 120;    // px/s^2, rolling resistance
const TRAIN_SHUNT_MAX = 90;    // px/s -- see note 4 at the top of this file
const TRAIN_PUSH_ACCEL = 240;  // px/s^2 while a player holds F against a car
const TRAIN_PUSH_REACH = 34;   // how close you must be to push
const TRAIN_ROCKET_KICK = 300; // px/s added by a rocket blast
// 520, not 150. THE RUN IS ONLY 1,369px from where the locomotive stands to
// the tunnel mouth, and v = sqrt(2*a*d): at 150 it arrived at 641px/s, which
// is 2.7x walking rather than the ~5x the departure is supposed to reach. At
// 520 it arrives at about 1,190px/s, having covered the same ground.
const TRAIN_RUN_ACCEL = 520;   // px/s^2 once rolling
const TRAIN_RUN_MAX = 1300;    // px/s -- about 5x walking (a player is ~240)
const TRAIN_BOARD_MAX = 260;   // above this nothing can board, rider or zombie
const TRAIN_WIN_SPEED = 300;   // must be moving at least this to take the tunnel
const TRAIN_SHOVE_SPEED = 200; // above this the head throws what it hits

// ENGINEER does it in a quarter of the time (DESIGN_IDEAS 64, settled
// 2026-09-25: a TIME gate at 4x, never a capability gate, because roles are
// hashed from netToken and a lobby can legitimately contain no Engineer).
const TRAIN_ENGINEER_MULT = 4;

function trainReset() {
    trainCars = [];
    trainRunning = false;
    trainStartedAt = 0;
    trainLost = false;
}

// --- arc length ----------------------------------------------------
function trainBuildLine() {
    trainLine = null;
    if (typeof railPaths === "undefined" || !railPaths.length) return;
    let best = null, bestLen = -1;
    for (let i = 0; i < railPaths.length; i++) {
        const p = railPaths[i];
        if (!p.pts || p.pts.length < 2) continue;
        let L = 0;
        for (let k = 1; k < p.pts.length; k++) {
            L += Math.hypot(p.pts[k].x - p.pts[k - 1].x, p.pts[k].y - p.pts[k - 1].y);
        }
        if (L > bestLen) { bestLen = L; best = p; }
    }
    if (!best) return;
    const cum = [0];
    for (let k = 1; k < best.pts.length; k++) {
        cum.push(cum[k - 1] + Math.hypot(best.pts[k].x - best.pts[k - 1].x,
                                        best.pts[k].y - best.pts[k - 1].y));
    }
    trainLine = { pts: best.pts, cum: cum, len: cum[cum.length - 1] };
}

// s -> { x, y, ang }.
//
// EXTRAPOLATED PAST THE END, not clamped: once the run is won the train has
// to keep going, visibly, off the map and into the tunnel while the score
// types over it. A clamp parks it in the gateway instead, which reads as the
// game having frozen at the exact moment it should feel like leaving.
// Before the end it is clamped as usual -- nothing may run off the back.
function trainPointAt(s) {
    if (!trainLine) return { x: 0, y: 0, ang: 0 };
    const L = trainLine.len;
    const over = s > L ? s - L : 0;
    const t = clamp(s, 0, L);
    const pts = trainLine.pts, cum = trainLine.cum;
    let seg = 1;
    while (seg < cum.length - 1 && cum[seg] < t) seg++;
    const a = pts[seg - 1], b = pts[seg];
    const segLen = cum[seg] - cum[seg - 1];
    const f = segLen > 0 ? (t - cum[seg - 1]) / segLen : 0;
    const ang = Math.atan2(b.y - a.y, b.x - a.x);
    return {
        x: a.x + (b.x - a.x) * f + Math.cos(ang) * over,
        y: a.y + (b.y - a.y) * f + Math.sin(ang) * over,
        ang: ang
    };
}

// --- build ---------------------------------------------------------
// The locomotive sits mid-line with its fuel cars strung out BEHIND it (at
// lower s), so every shunt is a push in one direction -- toward the loco,
// and then toward the tunnel. Coupling from both sides would double the
// collision cases for no gameplay.
function trainBuild() {
    trainReset();
    trainBuildLine();
    if (!trainLine) return;
    const L = trainLine.len;
    trainCars.push({ kind: "loco", s: L * 0.56, v: 0, len: TRAIN_LOCO_LEN, wid: TRAIN_WID + 6, coupled: true });
    const at = [0.17, 0.29, 0.41];
    for (let i = 0; i < at.length; i++) {
        trainCars.push({ kind: "fuel", s: L * at[i], v: 0, len: TRAIN_CAR_LEN, wid: TRAIN_WID, coupled: false });
    }
    for (let i = 0; i < trainCars.length; i++) trainSyncCar(trainCars[i], true);
}

function trainLoco() {
    return trainCars.length ? trainCars[0] : null;
}

// Derived geometry. `prime` seeds the previous centre so the first frame
// reports a zero delta rather than a jump.
function trainSyncCar(c, prime) {
    const p = trainPointAt(c.s - c.len / 2);
    c.pcx = prime ? p.x : c.cx;
    c.pcy = prime ? p.y : c.cy;
    c.cx = p.x;
    c.cy = p.y;
    c.ang = p.ang;
}

// The deck, as an axis-aligned box. The line is rectilinear (one east leg,
// one south leg, a drawn fillet at the corner), so an AABB is the honest
// shape here rather than a simplification -- and it keeps the rider test one
// rectIntersect instead of a rotation per body per frame.
function trainCarRect(c) {
    const along = Math.abs(Math.cos(c.ang)) > 0.5;
    const w = along ? c.len : c.wid;
    const h = along ? c.wid : c.len;
    return { x: c.cx - w / 2, y: c.cy - h / 2, w: w, h: h };
}

// --- fuel ----------------------------------------------------------
// The tanks ARE the silos. No second resource: DESIGN_IDEAS 62 -- "call the
// silo count fuel and move on". Tank i is coupled car i's, in coupling order.
function trainTankFrac(i) {
    if (typeof siloFill === "undefined") return 0;
    const cap = siloCapacity(i);
    return cap > 0 ? clamp(siloFill[i] / cap, 0, 1) : 0;
}

function trainTanksFull() {
    for (let i = 0; i < 3; i++) if (trainTankFrac(i) < 1) return false;
    return true;
}

function trainCoupledCount() {
    let n = 0;
    for (let i = 1; i < trainCars.length; i++) if (trainCars[i].coupled) n++;
    return n;
}

// EVERY RAIL CROSSING ON THE LINE MUST BE BOUGHT OPEN.
//
// Found in the browser, and it is the rule that makes the whole rail-door
// idea land: the cars are not in `walls[]`, so the train drives straight
// through a shut door -- but a RIDER is solid, and they were left 476px
// behind, scraped off against a door the locomotive ignored.
//
// Fixing it by exempting riders from collision would have been the wrong
// repair. The right one is the user's own design: "the door also opens up
// the rail pathway and brings to attention that just by consequence of
// exploring the map you are also opening up the rail pathway at the expense
// of your currency." So a shut crossing is a shut line, and buying it is
// what clears the road out.
function trainPathBlockedBy() {
    if (typeof doors === "undefined") return null;
    for (let i = 0; i < doors.length; i++) {
        if (doors[i].rail && !doors[i].open) return doors[i];
    }
    return null;
}

function trainReady() {
    return trainCars.length > 0 && trainCoupledCount() >= 3 && trainTanksFull() &&
           !trainPathBlockedBy();
}

// --- bodies --------------------------------------------------------
// A BODY is the locomotive plus everything coupled to it, or one loose car.
// Coupled cars have no independent `s`: theirs is derived from the loco's,
// which is what makes a consist one degree of freedom rather than four.
function trainConsistTailS() {
    const loco = trainLoco();
    if (!loco) return 0;
    let s = loco.s - loco.len;
    for (let i = 1; i < trainCars.length; i++) {
        if (!trainCars[i].coupled) continue;
        s -= TRAIN_COUPLE_GAP + trainCars[i].len;
    }
    return s;
}

function trainPlaceCoupled() {
    const loco = trainLoco();
    if (!loco) return;
    let s = loco.s - loco.len - TRAIN_COUPLE_GAP;
    for (let i = 1; i < trainCars.length; i++) {
        const c = trainCars[i];
        if (!c.coupled) continue;
        c.s = s;
        c.v = loco.v;
        s -= c.len + TRAIN_COUPLE_GAP;
    }
}

function trainCouple(i) {
    const c = trainCars[i];
    if (!c || c.coupled) return;
    c.coupled = true;
    const loco = trainLoco();
    // Inelastic: the consist takes the mass-weighted velocity. A car slammed
    // into a stationary train should nudge it, not vanish into it.
    const n = trainCoupledCount();
    if (loco) loco.v = (loco.v * n + c.v) / (n + 1);
    trainPlaceCoupled();
    if (typeof hostEvent === "function") hostEvent(SND_DOOR, c.cx, c.cy);
    if (typeof showToast === "function") {
        showToast("FUEL CAR COUPLED — " + trainCoupledCount() + "/3", 1800);
    }
}

// STARTED is not ROLLING.
//
// Starting the locomotive powers it up, sounds the horn, calls the horde and
// begins grinding the tunnel open -- but the train HOLDS at the platform for
// the whole ESCAPE_OPEN_MS. That 90 seconds is the fight, and it only works
// as a fight if the train is still here to defend: an earlier version let it
// roll immediately, so it sat at a shut tunnel mouth with the throttle open
// and won the instant the gate finished. Hold, then run.
function trainRolling() {
    return trainRunning && (typeof escapeOpen !== "function" || escapeOpen());
}

// --- the host update ----------------------------------------------
function trainUpdate(now, dt) {
    if (!trainLine || !trainCars.length) return;
    const sec = dt / 1000;
    const loco = trainLoco();

    // Rolling: accelerate, and never mind the shunt cap.
    if (trainRolling() && loco) {
        loco.v = Math.min(TRAIN_RUN_MAX, loco.v + TRAIN_RUN_ACCEL * sec);
    }

    // Integrate every independent body.
    for (let i = 0; i < trainCars.length; i++) {
        const c = trainCars[i];
        if (c.coupled && i > 0) continue;        // carried by the loco
        if (i === 0 && trainRolling()) {
            // no friction under power
        } else if (c.v !== 0) {
            const drop = TRAIN_FRICTION * sec;
            c.v = c.v > 0 ? Math.max(0, c.v - drop) : Math.min(0, c.v + drop);
        }
        if (!trainRolling()) c.v = clamp(c.v, -TRAIN_SHUNT_MAX, TRAIN_SHUNT_MAX);
        c.s += c.v * sec;
    }

    // Clamp to the line. The consist is clamped by its TAIL so a long train
    // cannot reverse its last car off the start of the track.
    if (loco) {
        const tail = trainConsistTailS();
        if (tail < 0) { loco.s -= tail; if (loco.v < 0) loco.v = 0; }
        // Held at the mouth until the run is won; afterwards it drives out.
        if (!won && loco.s > trainLine.len) { loco.s = trainLine.len; }
    }
    for (let i = 1; i < trainCars.length; i++) {
        const c = trainCars[i];
        if (c.coupled) continue;
        if (c.s - c.len < 0) { c.s = c.len; if (c.v < 0) c.v = 0; }
        if (c.s > trainLine.len) { c.s = trainLine.len; if (c.v > 0) c.v = 0; }
    }

    trainPushFromPlayers(dt);
    trainPlaceCoupled();
    trainResolveContacts();
    trainPlaceCoupled();

    for (let i = 0; i < trainCars.length; i++) trainSyncCar(trainCars[i], false);

    trainShoveZombies();
    trainCarryZombies();
    trainCheckTunnel(now);
}

// 1-D contacts, lowest s first. Only two outcomes exist: couple (if the
// other body is the consist) or exchange momentum (car into car), which is
// what lets one shunted car drive a second one home.
function trainResolveContacts() {
    const loose = [];
    for (let i = 1; i < trainCars.length; i++) if (!trainCars[i].coupled) loose.push(i);
    loose.sort(function (a, b) { return trainCars[a].s - trainCars[b].s; });

    const consistTail = trainConsistTailS();

    for (let k = loose.length - 1; k >= 0; k--) {
        const i = loose[k];
        const c = trainCars[i];
        // Into the back of the train?
        if (c.s + TRAIN_COUPLE_DIST >= consistTail && c.s - c.len < consistTail) {
            trainCouple(i);
            continue;
        }
        // Into the car ahead of it?
        if (k + 1 < loose.length) {
            const j = loose[k + 1];
            const o = trainCars[j];
            if (!o.coupled && c.s + TRAIN_COUPLE_GAP >= o.s - o.len) {
                const vv = (c.v + o.v) / 2;
                c.v = vv; o.v = vv;
                c.s = o.s - o.len - TRAIN_COUPLE_GAP;
            }
        }
    }
}

// --- pushing (the F verb) -----------------------------------------
// Returns the index of a car this player may push, or -1. Pushing is how a
// team with no rocket still assembles the train; the rocket is a much bigger
// shove, not the only one.
function trainPushableAt(x, y, size) {
    if (!trainCars.length) return -1;
    const box = { x: x - TRAIN_PUSH_REACH, y: y - TRAIN_PUSH_REACH,
                  w: (size || 16) + TRAIN_PUSH_REACH * 2, h: (size || 16) + TRAIN_PUSH_REACH * 2 };
    for (let i = 1; i < trainCars.length; i++) {
        if (trainCars[i].coupled) continue;
        if (rectsOverlap(box, trainCarRect(trainCars[i]))) return i;
    }
    return -1;
}

// HOST. PUSHING IS PROXIMITY, NOT A KEYPRESS -- the same shape as
// updateGeneratorRestart: the host already has every position, so this needs
// no message, no prediction and nothing on the wire. Mashing F sixteen times
// would also have been a worse mechanic than leaning on a car.
//
// You push from a car's END, not its side, so standing beside one on your way
// past does not shove it: which end you stand at decides which way it rolls.
function trainPushFromPlayers(dt) {
    if (trainRunning || !trainCars.length) return;
    const all = (typeof allTargets === "function") ? allTargets() : players;
    for (let i = 1; i < trainCars.length; i++) {
        const c = trainCars[i];
        if (c.coupled) continue;
        let push = 0, mult = 1;
        for (let k = 0; k < all.length; k++) {
            const t = all[k];
            if (t.downed) continue;
            const sz = t.size || 16;
            const tx = t.x + sz / 2, ty = t.y + sz / 2;
            // Project the player onto the rail, relative to this car's centre.
            const along = (tx - c.cx) * Math.cos(c.ang) + (ty - c.cy) * Math.sin(c.ang);
            const across = Math.abs(-(tx - c.cx) * Math.sin(c.ang) + (ty - c.cy) * Math.cos(c.ang));
            if (across > c.wid / 2 + TRAIN_PUSH_REACH) continue;
            const half = c.len / 2;
            if (along < -half + 6 && along > -half - TRAIN_PUSH_REACH) push = 1;        // behind: push forward
            else if (along > half - 6 && along < half + TRAIN_PUSH_REACH) push = -1;    // ahead: push back
            else continue;
            if (typeof idHasRole === "function" && idHasRole(netIdFor(t), "engineer")) {
                mult = TRAIN_ENGINEER_MULT;
            }
        }
        if (!push) continue;
        c.v = clamp(c.v + push * TRAIN_PUSH_ACCEL * mult * (dt / 1000),
                    -TRAIN_SHUNT_MAX, TRAIN_SHUNT_MAX);
    }
}

// HOST. A rocket blast shunts whatever it caught, in the direction the
// rocket was travelling, projected onto the rail. This is the moment the
// system exists for.
function trainRocketKick(x, y, vx, vy, radius) {
    if (!trainCars.length || trainRunning) return false;
    let hit = false;
    for (let i = 1; i < trainCars.length; i++) {
        const c = trainCars[i];
        if (c.coupled) continue;
        if (Math.hypot(x - c.cx, y - c.cy) > (radius || 150) + c.len / 2) continue;
        // Project the blast onto the track direction. A rocket fired across
        // the rails moves nothing, which is correct and is also the reason
        // the shot has to be aimed rather than merely near.
        const dirx = Math.cos(c.ang), diry = Math.sin(c.ang);
        let along = (vx || 0) * dirx + (vy || 0) * diry;
        if (Math.abs(along) < 0.001) along = (x < c.cx ? 1 : -1);
        const sign = along > 0 ? 1 : -1;
        c.v = clamp(c.v + sign * TRAIN_ROCKET_KICK, -TRAIN_SHUNT_MAX * 6, TRAIN_SHUNT_MAX * 6);
        hit = true;
    }
    return hit;
}

// --- starting the locomotive --------------------------------------
function trainHostStart() {
    if (trainRunning || !trainReady()) return;
    trainRunning = true;
    trainStartedAt = Date.now();
    // THE TUNNEL AND THE HORDE ARE THE SAME EVENT (settled 2026-09-25). The
    // 90s gate stops being a wait and becomes the clock on a fight.
    if (typeof escapeAt !== "undefined") escapeAt = trainStartedAt + ESCAPE_OPEN_MS;
    if (typeof floodActive !== "undefined") {
        floodActive = true;
        floodRemaining = Math.round(FLOOD_SIZE * (0.6 + 0.4 * teamSize()));
    }
    if (typeof hostEvent === "function") {
        const l = trainLoco();
        hostEvent(SND_SIREN, l ? l.cx : WORLD_W / 2, l ? l.cy : WORLD_H / 2);
    }
    if (typeof showToast === "function") showToast("THE LOCOMOTIVE IS RUNNING — BOARD IT", 3200);
}

// The run ends when the head of the train takes the tunnel mouth under
// power. A nudge does not count -- TRAIN_WIN_SPEED is what makes the
// acceleration the fight rather than the formality.
function trainCheckTunnel(now) {
    if (!trainRunning || won || !trainLine) return;
    const loco = trainLoco();
    if (!loco) return;
    if (loco.s < trainLine.len - 2) return;
    if (loco.v < TRAIN_WIN_SPEED) return;
    if (typeof escapeOpen === "function" && !escapeOpen()) return;
    if (typeof triggerWin === "function") triggerWin();
}

// --- riders --------------------------------------------------------
// The one carriage rule, shared by players and zombies. Returns the car a
// point is riding, or null. Above TRAIN_BOARD_MAX nothing new gets on --
// which is what makes the acceleration the thing worth defending.
function trainCarUnder(x, y, size) {
    if (!trainCars.length) return null;
    const sz = size || 16;
    for (let i = 0; i < trainCars.length; i++) {
        const c = trainCars[i];
        const r = trainCarRect(c);
        if (rectIntersect(x, y, sz, sz, r.x, r.y, r.w, r.h)) return c;
    }
    return null;
}

// BEING ABOARD AND BEING MOVED ARE TWO DIFFERENT QUESTIONS, and conflating
// them was a real bug, found in the browser: the first version returned null
// when the delta was zero, so every frame the train sat still cleared the
// rider's `onTrain` flag -- and the flag is what grants the grace to STAY on
// a car that is already over TRAIN_BOARD_MAX. A player standing on a
// stationary locomotive was therefore treated as boarding afresh the instant
// it pulled away, and was left standing on the ballast.
function trainRiderCar(x, y, size, alreadyAboard) {
    const c = trainCarUnder(x, y, size);
    if (!c) return null;
    if (!alreadyAboard && Math.abs(c.v) > TRAIN_BOARD_MAX) return null;
    return c;
}

function trainCarryDelta(x, y, size, alreadyAboard) {
    const c = trainRiderCar(x, y, size, alreadyAboard);
    if (!c) return null;
    return { dx: c.cx - c.pcx, dy: c.cy - c.pcy, car: c };
}

// HOST. Zombies on a deck ride it.
function trainCarryZombies() {
    if (typeof zombies === "undefined") return;
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        if (z.launchUntil) continue;
        const c = trainRiderCar(z.x, z.y, z.size, z.onTrain);
        if (!c) { z.onTrain = false; continue; }
        z.onTrain = true;
        z.x += c.cx - c.pcx;
        z.y += c.cy - c.pcy;
    }
}

// HOST. THE COWCATCHER. Not a raycast from each zombie: the train knows
// where it is going, so the head sweeps its own rect and throws what is
// inside it. The throw reuses the SUPER SPLITTER's launch phase
// (launchUntil / lvx / lvy) -- already exempt from the stuck watchdog,
// already on the wire as a remaining duration, already drawn as flight.
function trainShoveZombies() {
    if (typeof zombies === "undefined") return;
    const loco = trainLoco();
    if (!loco || Math.abs(loco.v) < TRAIN_SHOVE_SPEED) return;
    const r = trainCarRect(loco);
    const dirx = Math.cos(loco.ang) * (loco.v > 0 ? 1 : -1);
    const diry = Math.sin(loco.ang) * (loco.v > 0 ? 1 : -1);
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        if (z.launchUntil) continue;
        if (!rectIntersect(z.x, z.y, z.size, z.size, r.x, r.y, r.w, r.h)) continue;
        // lvx/lvy are px per frame, not px/s -- see updateZombieLaunch.
        const kick = 7 + Math.random() * 5;
        const spread = (Math.random() - 0.5) * 6;
        z.lvx = dirx * kick - diry * spread;
        z.lvy = diry * kick + dirx * spread;
        z.launchUntil = Date.now() + 260 + Math.random() * 220;
        z.onTrain = false;
    }
}

// What to print on the world prompt for a player standing at the train.
// Returns "" when they are not near it.
function trainPromptFor(x, y, size) {
    if (!trainCars.length) return "";
    const sz = size || 16;
    const box = { x: x - TRAIN_PUSH_REACH, y: y - TRAIN_PUSH_REACH,
                  w: sz + TRAIN_PUSH_REACH * 2, h: sz + TRAIN_PUSH_REACH * 2 };
    const loco = trainLoco();
    if (loco && rectsOverlap(box, trainCarRect(loco))) {
        if (trainRunning) return "LOCOMOTIVE RUNNING";
        if (trainReady()) return "START THE LOCOMOTIVE";
        if (trainCoupledCount() < 3) return "LOCOMOTIVE — " + trainCoupledCount() + "/3 CARS COUPLED";
        if (trainTanksFull() && trainPathBlockedBy()) return "THE LINE IS SHUT — BUY THE RAIL CROSSINGS";
        return "LOCOMOTIVE — TANKS " +
               Math.round((trainTankFrac(0) + trainTankFrac(1) + trainTankFrac(2)) / 3 * 100) + "%";
    }
    for (let i = 1; i < trainCars.length; i++) {
        const c = trainCars[i];
        if (!rectsOverlap(box, trainCarRect(c))) continue;
        if (c.coupled) return "FUEL CAR — COUPLED";
        return "FUEL CAR — PUSH FROM EITHER END";
    }
    return "";
}

// --- the HUD line -------------------------------------------------
function trainStatusLine() {
    if (!trainCars.length) return "";
    if (trainRunning) {
        const loco = trainLoco();
        const kph = Math.round(Math.abs(loco ? loco.v : 0));
        return trainRolling() ? "TRAIN RUNNING — " + kph + " px/s"
                              : "UNDER POWER — HOLDING FOR THE TUNNEL";
    }
    if (trainReady()) return "LOCOMOTIVE READY — START IT";
    if (trainCoupledCount() >= 3 && trainTanksFull() && trainPathBlockedBy()) {
        return "THE LINE IS SHUT — BUY THE RAIL CROSSINGS";
    }
    return "TRAIN — " + trainCoupledCount() + "/3 CARS, FUEL " +
           Math.round((trainTankFrac(0) + trainTankFrac(1) + trainTankFrac(2)) / 3 * 100) + "%";
}

// --- wire ----------------------------------------------------------
// One scalar per car plus the coupled flags, exactly as TRAIN_RAIL_PLAN 2.3
// requires: a guest DERIVES every rect from these, so nobody interpolates a
// car and no two clients drag a rider to different places.
function trainWire() {
    const out = { r: trainRunning ? 1 : 0, c: [] };
    for (let i = 0; i < trainCars.length; i++) {
        const c = trainCars[i];
        out.c.push([Math.round(c.s * 10) / 10, Math.round(c.v), c.coupled ? 1 : 0]);
    }
    return out;
}

function trainApplyWire(w) {
    if (!w || !w.c) return;
    trainRunning = !!w.r;
    for (let i = 0; i < trainCars.length && i < w.c.length; i++) {
        const row = w.c[i];
        const c = trainCars[i];
        c.s = row[0];
        c.v = row[1];
        c.coupled = !!row[2];
    }
    trainPlaceCoupled();
    for (let i = 0; i < trainCars.length; i++) trainSyncCar(trainCars[i], false);
}
