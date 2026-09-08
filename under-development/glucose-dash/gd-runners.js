// ===================================================
//   Glucose Dash -- runners and physics
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 971-1290 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, nothing was reindented.
//
// EVERY FILE CARRIES ITS OWN "use strict". The original script had one at the
// top, covering all 2,363 lines; a classic-script split gives each file its own
// scope for that directive, so omitting it would silently drop files 2-12 into
// sloppy mode. That is a semantic change, not a cosmetic one.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). This game lives under under-development/, so its shared paths
// are ../../shared/, not ../shared/.
"use strict";

/* ===================================================
     RUNNERS & PHYSICS
   ===================================================
   One step function drives the player and every NPC. Whatever's true
   of the player's handling is true of theirs -- an NPC that cheats
   physics is the fastest way to make a race feel unfair.

   Heading 0 points down the course (+y). Direction is
   (sin h, cos h); the right-hand normal is (cos h, -sin h).

   Velocity is kept as a vector and only *pulled* toward the heading at
   TUNE.grip, rather than being locked to it. That's the difference
   between "car-style" and "tank-style": turn hard at speed and you
   carry momentum sideways for a moment, which is exactly what makes
   diving into a storefront bay for cake cost you something. */

var RUNNER_COLORS = ["#ff8fa3", "#6ce7a8", "#ffd166", "#7bc5ff", "#c9a7ff", "#ff9f6b"];

/* Glucose drives TOP SPEED, not just survival.

   This is the half of the concept that closes the loop -- "more
   rewarding food -> speed up AND maintained blood glucose." Without it,
   food is purely defensive, ignoring the storefronts entirely is the
   fastest line through the mall, and the whole premise collapses into
   "don't hit zero."

   Below 70 you're bonking and it shows: top speed falls away to
   TUNE.bonkFloor at zero, so the desaturating screen is a symptom of
   something you can also feel in the controls. Above 90 you get a small
   bonus that tops out at +8%.

   Note what this does to cake: the spike genuinely makes you fast for
   about three seconds, and then the crash makes you slow for nine.
   That trade is the game. */
function glucoseSpeedMult(g) {
    if (g < TUNE.hypo) {
        return TUNE.bonkFloor + (1 - TUNE.bonkFloor) * Math.pow(g / TUNE.hypo, TUNE.bonkCurve);
    }
    /* The bonus tops out around 195 rather than 200+, so it is reachable
       by food that HOLDS you there -- which is only ever low-GI. A cake
       spike touches the cap for three seconds; an oat bowl parks you on
       it for half a minute. That is the difference the top floor is
       selling, and before this it was too small to pay for the climb. */
    return 1 + Math.min(TUNE.rangeBonus, Math.max(0, (g - 90) / 900));
}

function makeRunner(name, color, isPlayer) {
    return {
        name: name, color: color, isPlayer: !!isPlayer,
        x: 0, y: 0, z: 0, floor: 0,
        heading: 0, vx: 0, vy: 0, speed: 0,
        onRamp: null, rampT: 0, fall: null, stun: 0,
        inventory: [], eating: null, eatT: 0,
        boluses: [], glucose: TUNE.glucoseStart, glucoseRate: 0,
        sprintT: 0, sprintCd: 0,
        finished: false, dnf: false, finishMs: null,
        timeInRange: 0, timeTotal: 0,
        lean: 0, stride: 0,
        think: 0, target: null, wantsUp: false, aggression: 1
    };
}

function rampAt(r) {
    for (var i = 0; i < RAMPS.length; i++) {
        var ra = RAMPS[i];
        if (ra.from !== r.floor) continue;
        if (r.y < ra.y0 || r.y > ra.y1) continue;
        if (!ra.full) {
            /* Tight. A 3.5-unit capture band on a floor whose walkable
               half-width is 7.5 meant that diving for a storefront put you
               in the stairwell, and the middle floor kept posting you back
               down to the ground whether you meant to go or not. */
            if (Math.abs(r.x - ra.side * RAMP_X) > RAMP_HALF + 0.2) continue;
            /* You have to be running roughly ALONG the course for a
               staircase to take you. Without this, diving sideways into a
               storefront bay that happens to sit near a stair drags you up
               a floor you never asked for -- which was sending NPCs onto
               the balconies by accident and then off the edge of them. */
            if (!r.onRamp && Math.abs(Math.sin(r.heading)) > 0.55) continue;
        }
        return ra;
    }
    return null;
}

/* Falling off a balcony costs the drop (~0.55s of no control), all your
   momentum, and a stun on landing -- call it 2-3 seconds. Land off the
   edge again and you keep going down, so a bad line on floor 3 can put
   you on floor 1. Glucose drains the whole way. */
function startFall(r) {
    if (r.fall || r.floor <= 0 || r.finished || r.dnf) return;
    var to = r.floor - 1;
    r.fall = { t: 0, dur: 0.55, fromZ: r.z, toZ: to * FLOOR_H, toFloor: to };
    r.onRamp = null;
    if (r.isPlayer) { toast("OFF THE EDGE", "#ff6b6b"); tone(420, 90, "sawtooth", 0.45, 0.07); }
}

function land(r) {
    var f = r.fall.toFloor;
    r.fall = null;
    r.floor = f;
    r.z = f * FLOOR_H;
    r.vx *= 0.25; r.vy *= 0.25;
    r.speed = Math.sqrt(r.vx * r.vx + r.vy * r.vy);
    r.stun = 0.7;
    if (r.isPlayer) { shake(15); tone(160, 60, "square", 0.18, 0.08); }

    var side = r.x < 0 ? -1 : 1;
    var lim = walkLimit(side, f, r.y);
    if (Math.abs(r.x) > lim + EDGE_GRACE) {
        if (f > 0) startFall(r);      // still over the void -- keep going down
        else r.x = side * lim;        // ground floor has walls to stop you
    }
}

function stepRunner(r, inp, dt) {
    if (r.fall) {
        r.fall.t += dt;
        var u = Math.min(1, r.fall.t / r.fall.dur);
        r.z = r.fall.fromZ + (r.fall.toZ - r.fall.fromZ) * (u * u);   // accelerating
        r.x += r.vx * dt * 0.45;
        r.y += r.vy * dt * 0.45;
        r.vx *= 0.94; r.vy *= 0.94;
        r.speed = Math.sqrt(r.vx * r.vx + r.vy * r.vy);
        stepGlucose(r, dt);
        if (u >= 1) land(r);
        return;
    }

    if (r.stun > 0) {
        r.stun -= dt;
        // picking yourself up: you can still steer, you just cannot drive
        inp = { throttle: false, brake: false, steer: (inp.steer || 0) * 0.5, sprint: false, eat: inp.eat };
    }

    if (r.finished || r.dnf) {
        r.speed *= 0.90;
        r.x += r.vx * dt; r.y += r.vy * dt;
        r.vx *= 0.90; r.vy *= 0.90;
        return;
    }

    /* --- sprint timers --- */
    if (r.sprintT > 0) { r.sprintT -= dt; if (r.sprintT <= 0) r.sprintCd = TUNE.sprintCd; }
    else if (r.sprintCd > 0) r.sprintCd -= dt;

    if (inp.sprint && r.sprintT <= 0 && r.sprintCd <= 0 && !r.eating && r.speed > 4) {
        r.sprintT = TUNE.sprintDur;
    }

    /* --- eating: throttle cap drops, steering is untouched, and there
           is no cancel. The committed window IS the mechanic. --- */
    if (r.eating) {
        r.eatT += dt;
        if (r.eatT >= FOODS[r.eating].eat) {
            r.boluses.push(makeBolus(r.eating));
            if (r.isPlayer) toast("ATE " + FOODS[r.eating].name.toUpperCase(), GI_COLOR[FOODS[r.eating].gi]);
            r.eating = null; r.eatT = 0;
        }
    } else if (inp.eat && r.inventory.length) {
        r.eating = r.inventory.shift();       // FIFO, per the concept decision
        r.eatT = 0;
    }

    /* --- speed cap for the situation --- */
    var cap = TUNE.maxSpeed * glucoseSpeedMult(r.glucose);
    var accel = TUNE.accel;
    if (r.sprintT > 0) { cap *= TUNE.sprintMult; accel *= TUNE.sprintAccel; }
    if (r.eating) cap *= TUNE.eatSpeedMult;

    r.onRamp = rampAt(r);
    if (r.onRamp) {
        cap *= (r.onRamp.to > r.onRamp.from) ? TUNE.rampUpMult : TUNE.rampDownMult;
    }
    if (!r.isPlayer) cap *= r.npcSpeed || 1;

    /* --- longitudinal --- */
    var dir = { x: Math.sin(r.heading), y: Math.cos(r.heading) };
    var rgt = { x: Math.cos(r.heading), y: -Math.sin(r.heading) };
    var fwd = r.vx * dir.x + r.vy * dir.y;
    var lat = r.vx * rgt.x + r.vy * rgt.y;

    if (inp.throttle) {
        if (fwd < cap) fwd += accel * dt;
    }
    if (inp.brake) {
        fwd -= TUNE.brake * dt;
        if (fwd < -TUNE.reverseMax) fwd = -TUNE.reverseMax;
    }
    if (fwd > cap) fwd -= (fwd - cap) * Math.min(1, 3.2 * dt);   // ease down off sprint

    fwd *= Math.max(0, 1 - TUNE.drag * dt);
    lat *= Math.exp(-TUNE.grip * dt);

    /* --- steering: proportional to speed, so you cannot pivot in
           place. This is the car-style handling the concept asked for
           and it is what makes the bays a real cost. --- */
    var sp = Math.abs(fwd);
    if (inp.steer) {
        var authority = Math.min(1, sp / TUNE.turnSpeedRef);
        r.heading += inp.steer * TUNE.turnRate * dt * authority * (fwd < 0 ? -1 : 1);
    }
    r.lean += (((inp.steer || 0) * Math.min(1, sp / TUNE.turnSpeedRef)) - r.lean) * Math.min(1, 8 * dt);

    dir = { x: Math.sin(r.heading), y: Math.cos(r.heading) };
    rgt = { x: Math.cos(r.heading), y: -Math.sin(r.heading) };
    r.vx = dir.x * fwd + rgt.x * lat;
    r.vy = dir.y * fwd + rgt.y * lat;
    r.speed = Math.sqrt(r.vx * r.vx + r.vy * r.vy);

    r.x += r.vx * dt;
    r.y += r.vy * dt;
    r.stride += r.speed * dt * 0.55;

    /* --- ramp: soft auto-align, so a car-style turning radius never
           has to negotiate a narrow staircase --- */
    if (r.onRamp) {
        // A full-width bank doesn't need to grab your line -- there's
        // nowhere else to be. A narrow staircase does.
        if (!r.onRamp.full) {
            var tx = r.onRamp.side * RAMP_X;
            r.x += (tx - r.x) * Math.min(1, TUNE.rampAlign * dt);
        } else if (Math.abs(r.x) > hallHalf(r.onRamp.from)) {
            r.x = (r.x < 0 ? -1 : 1) * hallHalf(r.onRamp.from);
        }
        var wrapped = Math.atan2(Math.sin(-r.heading), Math.cos(-r.heading));
        r.heading += wrapped * Math.min(1, TUNE.rampAlign * 0.55 * dt);

        var t = (r.y - r.onRamp.y0) / (r.onRamp.y1 - r.onRamp.y0);
        t = Math.max(0, Math.min(1, t));
        r.rampT = t;
        r.z = (r.onRamp.from + (r.onRamp.to - r.onRamp.from) * t) * FLOOR_H;

        if (r.y > r.onRamp.y1) { r.floor = r.onRamp.to; r.onRamp = null; }
        else if (r.y < r.onRamp.y0) { r.floor = r.onRamp.from; r.onRamp = null; }
    } else {
        r.z = r.floor * FLOOR_H;

        /* --- the edge ---
           Ground floor: a wall, you scrape it. Upstairs: nothing, you
           fall. Same test, completely different consequence, and that
           difference is the entire reason to think twice about the oat
           bowl on floor 3. */
        var side = r.x < 0 ? -1 : 1;
        var lim = walkLimit(side, r.floor, r.y);
        if (Math.abs(r.x) > lim + EDGE_GRACE && r.floor > 0) {
            startFall(r);
        } else if (Math.abs(r.x) > lim && r.floor === 0) {
            r.x = side * lim;
            var outward = r.vx * side;
            if (outward > 0) {
                // The wall absorbs the normal component -- it's a wall,
                // not a trampoline.
                r.vx -= outward * side;

                /* Tangential friction has to scale with HOW HARD you hit
                   it. A flat per-frame fraction compounds sixty times a
                   second, so anything that so much as leans on a wall
                   gets pinned to a standstill -- which is exactly what
                   was happening to the NPCs (one of them spent half a
                   race scraping the storefronts at 17 u/s). Now a
                   glancing scrape costs a few percent and a head-on
                   costs half your speed. */
                var fric = Math.min(0.55, (outward / TUNE.maxSpeed) * TUNE.wallLoss * 3.2);
                r.vy *= (1 - fric);
                r.speed = Math.sqrt(r.vx * r.vx + r.vy * r.vy);
                if (r.isPlayer && outward > 8) shake(Math.min(9, outward * 0.5));
            }
        }
        if (r.y < 0) { r.y = 0; if (r.vy < 0) r.vy = 0; }
        // Backstop only. The full-width banks above are what actually
        // stop anyone reaching this.
        if (r.y > MALL_END) { r.y = MALL_END; if (r.vy > 0) r.vy = 0; }
    }

    stepGlucose(r, dt);
    tryPickup(r);

    if (!r.finished && !r.dnf && r.floor === 0 && r.y >= COURSE_LEN) finishRunner(r);
}

/* Pickup. Third item is BLOCKED, not swapped -- the item stays on the
   floor. Concept decision; SCOPE.md Q2 flags the failure case where
   you're at 60 holding two oat bowls and run over the soda that would
   have saved you. */
var fullWarnAt = -1e9;
function tryPickup(r) {
    if (r.dnf || r.finished) return;
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.taken || it.floor !== r.floor) continue;
        if (Math.abs(it.y - r.y) > TUNE.pickupR + 1) continue;
        var dx = it.x - r.x, dy = it.y - r.y;
        if (dx * dx + dy * dy > TUNE.pickupR * TUNE.pickupR) continue;

        if (r.inventory.length >= TUNE.invSize) {
            if (r.isPlayer && raceTime - fullWarnAt > 1.4) {
                fullWarnAt = raceTime;
                toast("HANDS FULL", "#ff6b6b");
            }
            continue;
        }
        it.taken = true;
        r.inventory.push(it.food);
        if (r.isPlayer) {
            toast("+ " + FOODS[it.food].name.toUpperCase(), GI_COLOR[FOODS[it.food].gi]);
            beep(it.food);
        }
        return;
    }
}

function finishRunner(r) {
    r.finished = true;
    r.finishMs = raceTime * 1000;
    finishOrder.push({ name: r.name, color: r.color, ms: r.finishMs, self: !!r.isPlayer, dnf: false });
    if (r.isPlayer) endRace("finish");
}


