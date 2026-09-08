// ===================================================
//   4D Pong -- paddles, ball, blasters, particles, power-up, collision
// ===================================================
// The physics. Everything here works in STAGE coordinates (CSS pixels of the
// #stage box) so that a rect is a rect whether it belongs to a paddle, a
// blaster or the ball, and one AABB test serves all of them.
//
// Field-LOCAL coordinates appear in exactly two places -- a paddle's slide
// position and the corner-bumper test -- because both are naturally expressed
// as "distance along this edge" and converting them at the boundary is
// cheaper than carrying two coordinate systems through the whole file.
//
// NOTHING HERE SNAPS TO THE PIXEL GRID. 4.4 is explicit: quantize rendering
// only, never physics. fp-render.js applies RETRO.snap() at the draw call and
// the simulation never sees it.
"use strict";

// ===================================================
//   PADDLES
// ===================================================
// `pos`   -- centre of the paddle ALONG its edge, in field-local px
// `depth` -- how far it has shuffled off its own wall, field-local px. Only
//            the two-paddle modes can change this; see the note in fp-input.js
//            for why depth is off when all four edges are goals.
function createPaddle(index, kind) {
    return {
        index: index,
        kind: kind,
        pos: 0,               // set by placeSeat()
        depth: 0,
        long: PADDLE_LONG,
        // Goals SCORED by this seat. The tug-of-war does not need it -- the
        // rope position is the whole game state -- but  6.6 asks for an
        // "enormous blocky score" and a rope has no number on it.
        goals: 0,
        stunned: false,
        stunTimer: null,
        canShoot: true,
        blasterFiredAt: 0,
        canFireMachineGun: true,
        machineGunTimer: null,
        desperate: false,
        ai: null              // filled by fp-ai.js for CPU seats
    };
}

// Called on every resize as well as on setup. Positions are held as a
// FRACTION of the edge so a mid-rally resize slides the paddle proportionally
// instead of dumping it in a corner.
function placeSeat(seat) {
    if (!seat || seat.kind === EMPTY) return;
    var span = slideSpan(seat);
    if (seat.frac === undefined) seat.frac = 0.5;
    seat.pos = span.min + (span.max - span.min) * seat.frac;
    seat.depth = clamp(seat.depth, 0, maxDepth(seat.index));
}

// How far a seat may advance off its own wall.
//
// THIS HAD ITS SIGN THE WRONG WAY ROUND, and it silently removed a mechanic.
// The original game let a paddle push PAST the centre line by half the neutral
// zone (`paddle1.x < canvas.width/2 + halfNeutralZone - paddle1.width`), which
// is what let it reach the power-up sitting on that line. Subtracting the half
// zone instead stopped every paddle 50px short of the centre, so the blaster
// recharge was permanently unreachable -- and nothing looked broken, because
// the power-up still spawned and still blinked.
//
// Per-seat, not global: a LEFT/RIGHT paddle advances along X and a TOP/BOTTOM
// one along Y, and those spans are only equal on the square field.
function maxDepth(seatIndex) {
    var span = (SEAT_AXIS[seatIndex] === "y") ? field.w : field.h;
    return Math.max(0, span / 2 + NEUTRAL_ZONE / 2 - PADDLE_THICK);
}

// The paddle's rectangle in stage coordinates.
function seatRect(seat) {
    var half = seat.long / 2;
    switch (seat.index) {
        case LEFT:
            return { x: field.x + seat.depth, y: field.y + seat.pos - half, w: PADDLE_THICK, h: seat.long };
        case RIGHT:
            return { x: field.x + field.w - seat.depth - PADDLE_THICK, y: field.y + seat.pos - half, w: PADDLE_THICK, h: seat.long };
        case TOP:
            return { x: field.x + seat.pos - half, y: field.y + seat.depth, w: seat.long, h: PADDLE_THICK };
        default: // BOTTOM
            return { x: field.x + seat.pos - half, y: field.y + field.h - seat.depth - PADDLE_THICK, w: seat.long, h: PADDLE_THICK };
    }
}

// Move a paddle along its edge. `dir` is -1 / +1 in SCREEN terms: for the
// left and right seats that is up/down, for top and bottom left/right.
function slideSeat(seat, dir, dt) {
    if (seat.stunned) return;
    var span = slideSpan(seat);
    var half = seat.long / 2;
    seat.pos = clamp(seat.pos + dir * PADDLE_SPEED * dt, span.min + half, span.max - half);
    seat.frac = (span.max - span.min) > 0
        ? (seat.pos - span.min) / (span.max - span.min)
        : 0.5;
}

// The depth shuffle -- movement on the seat's SECOND axis, toward the middle
// ground and back.
//
// This used to be two-paddle-only, on the reasoning that "with goals on all
// four sides a paddle that can leave its edge stops being a paddle". That was
// my call and the user overruled it: four-way play wants both axes, and the
// trade-off is the point -- a paddle in the middle has abandoned its own goal
// to contest the power-up, which is a decision rather than a mistake.
//
// PADDLES DO NOT COLLIDE WITH EACH OTHER, deliberately, so two seats can occupy
// the same middle ground. Only the ball collides with paddles. There is no
// paddle-paddle test anywhere in this file and there should not be one.
function shuffleSeat(seat, dir, dt) {
    if (seat.stunned) return;
    seat.depth = clamp(seat.depth + dir * PADDLE_SPEED * dt, 0, maxDepth(seat.index));
}

function stunSeat(seat) {
    if (!seat || seat.kind === EMPTY) return;
    seat.stunned = true;
    if (seat.stunTimer) clearTracked(seat.stunTimer);
    seat.stunTimer = trackTimeout(function () {
        seat.stunned = false;
        seat.stunTimer = null;
    }, STUN_MS);
    sfxStun();
}

function buildSeats(cfg) {
    var out = [];
    for (var i = 0; i < 4; i++) {
        var p = createPaddle(i, cfg.seats[i]);
        p.frac = 0.5;
        out.push(p);
    }
    return out;
}

// ===================================================
//   BALL  -- exactly one, in every mode
// ===================================================
// The brief is explicit that a single ball is shared by the whole game, and
// that is what makes the four-paddle mode one game rather than two games side
// by side: a rally can run left -> top -> right -> bottom without a reset.
function createBall() {
    return { x: field.x + field.w / 2, y: field.y + field.h / 2, vx: 0, vy: 0 };
}

// Served TOWARD the seat that just conceded, which is the convention every
// Pong since 1972 has used: the ball comes back at the player who let it past.
// The serve speed the CURRENT match has reached. See the note on
// SERVE_RAMP_PER_MIN in fp-core.js: the rally already accelerates per hit and
// resets on every goal, so what ramps here is the floor each new point starts
// from -- which is what stops two evenly matched players rallying a tug-of-war
// to a standstill.
function serveSpeed() {
    if (!matchStartAt) return BALL_START_SPEED;
    var mins = (performance.now() - matchStartAt) / 60000;
    return BALL_START_SPEED * (1 + Math.min(SERVE_RAMP_MAX, Math.max(0, mins) * SERVE_RAMP_PER_MIN));
}

function serveBall(towardSeat) {
    ball = ball || createBall();
    ball.x = field.x + field.w / 2;
    ball.y = field.y + field.h / 2;
    rallyHits = 0;

    var jitter = (Math.random() * 2 - 1) * BALL_SERVE_SPREAD;
    var s = serveSpeed();

    // EVERY SERVE ON A FOUR-GOAL FIELD IS A UNIFORM HEADING FROM THE FULL CIRCLE.
    //
    // Pong's convention is to serve the ball back at whoever just conceded, and
    // on a two-paddle field that is right -- there is only one axis, so it only
    // decides who receives. On a four-goal field it quietly locks play onto one
    // pair: measured over a 10-second run, four goals in a row all landed on the
    // horizontal axis, because each goal there sent the ball straight back at
    // the same two players. The vertical pair were spectators in their own game.
    //
    // So the conceding seat is ignored here and the heading is drawn from the
    // whole circle, which is what the brief asked for -- "direction should be
    // totally random". The two-paddle game keeps the classic convention below.
    if (mode.axes === 2) {
        var a = Math.random() * Math.PI * 2;
        ball.vx = Math.cos(a) * s;
        ball.vy = Math.sin(a) * s;
        return;
    }

    var seat = (towardSeat === undefined || towardSeat < 0)
        ? (Math.random() < 0.5 ? LEFT : RIGHT)
        : towardSeat;

    if (SEAT_AXIS[seat] === "y") {          // left / right: travel mainly on X
        var dx = SEAT_SIGN[seat];
        ball.vx = dx * s * Math.cos(jitter);
        ball.vy = s * Math.sin(jitter);
    } else {                                 // top / bottom: travel mainly on Y
        var dy = SEAT_SIGN[seat];
        ball.vy = dy * s * Math.cos(jitter);
        ball.vx = s * Math.sin(jitter);
    }
}

function ballSpeed() { return Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy); }

function ballMaxSpeed() { return mode.axes === 2 ? 780 : 900; }
function ballGain() { return mode.axes === 2 ? 1.05 : 1.07; }

function ballRect() {
    return { x: ball.x - BALL_HALF, y: ball.y - BALL_HALF, w: BALL_SIZE, h: BALL_SIZE };
}

// ===================================================
//   BLASTERS
// ===================================================
// Fired along the seat's own axis, toward the far side. Whoever it reaches
// first is stunned -- including, in the four-paddle modes, someone who was not
// the intended target. That is a feature: a bolt across a live field is a
// gamble, not a guaranteed hit.
function fireBlaster(seat, hot) {
    var r = seatRect(seat);
    var b = { hot: !!hot, from: seat.index, active: true };

    if (SEAT_AXIS[seat.index] === "y") {
        b.w = BLASTER_LONG; b.h = BLASTER_THICK;
        b.y = r.y + r.h / 2 - BLASTER_THICK / 2;
        b.x = (seat.index === LEFT) ? r.x + r.w : r.x - BLASTER_LONG;
        // -SEAT_SIGN is "away from this seat's own wall", the same idiom
        // bounceOffSeat() uses for the ball.
        b.vx = -SEAT_SIGN[seat.index] * BLASTER_SPEED;
        b.vy = 0;
    } else {
        b.w = BLASTER_THICK; b.h = BLASTER_LONG;
        b.x = r.x + r.w / 2 - BLASTER_THICK / 2;
        b.y = (seat.index === TOP) ? r.y + r.h : r.y - BLASTER_LONG;
        b.vy = -SEAT_SIGN[seat.index] * BLASTER_SPEED;
        b.vx = 0;
    }
    blasters.push(b);
    sfxBlaster(hot);
}

function tryFire(seat) {
    if (seat.stunned || seat.kind === EMPTY) return;

    // Desperation turns the blaster into a 200ms-repeat machine gun. Kept from
    // the original: it is the comeback mechanic, and a tug-of-war that cannot
    // be pulled back is just a countdown to a result everyone already knows.
    if (seat.desperate) {
        if (!seat.canFireMachineGun) return;
        fireBlaster(seat, true);
        seat.canFireMachineGun = false;
        seat.machineGunTimer = trackTimeout(function () {
            seat.canFireMachineGun = true;
            seat.machineGunTimer = null;
        }, MACHINE_GUN_MS);
        return;
    }

    if (!seat.canShoot) return;
    fireBlaster(seat, false);
    seat.canShoot = false;
    seat.blasterFiredAt = performance.now();
    trackTimeout(function () { seat.canShoot = true; }, BLASTER_COOLDOWN_MS);
}

function cooldownFraction(seat) {
    if (seat.canShoot) return 1;
    var elapsed = performance.now() - seat.blasterFiredAt;
    return clamp(elapsed / BLASTER_COOLDOWN_MS, 0, 1);
}

function updateBlasters(dt) {
    for (var i = blasters.length - 1; i >= 0; i--) {
        var b = blasters[i];
        b.x += b.vx * dt;
        b.y += b.vy * dt;

        var live = activeSeats();
        for (var s = 0; s < live.length; s++) {
            var seat = live[s];
            if (seat.index === b.from || seat.stunned) continue;
            if (rectsOverlap(b, seatRect(seat))) {
                stunSeat(seat);
                b.active = false;
                break;
            }
        }

        if (b.x + b.w < field.x || b.x > field.x + field.w ||
            b.y + b.h < field.y || b.y > field.y + field.h) b.active = false;

        if (!b.active) blasters.splice(i, 1);
    }
}

// ===================================================
//   PARTICLES
// ===================================================
// Square, not round: 6.6's whole instruction is blocky. Colour comes from the
// Signal Three rather than the old file's random hue ramp -- 2.2 makes those
// three semantic, and a desperation spray IS danger.
function spawnParticle(x, y, color) {
    particles.push({
        x: x, y: y,
        size: Math.random() * 4 + 3,
        vx: (Math.random() - 0.5) * 90,
        vy: (Math.random() * -140) - 40,
        color: color || "var-magenta",
        life: 1
    });
}

function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
        var p = particles[i];
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        p.life -= dt * 1.2;
        if (p.life <= 0) particles.splice(i, 1);
    }
}

// ===================================================
//   POWER-UP  -- instantly recharges the blaster
// ===================================================
function createPowerup() {
    return { x: 0, y: 0, size: POWERUP_SIZE, active: false };
}

function spawnPowerup() {
    if (!powerup) powerup = createPowerup();
    if (mode.axes === 1) {
        // On the centre line, as it always was.
        powerup.x = field.x + field.w / 2;
        powerup.y = field.y + 24 + Math.random() * Math.max(1, field.h - 48);
    } else {
        // In the middle ground -- the box every seat can advance into. Kept
        // strictly inside NEUTRAL_ZONE so it is reachable from all four edges;
        // scattering it across "the middle fifth" would have put it outside
        // some paddles' reach on a non-square field.
        var half = NEUTRAL_ZONE / 2;
        powerup.x = field.x + field.w / 2 + (Math.random() * 2 - 1) * half * 0.6;
        powerup.y = field.y + field.h / 2 + (Math.random() * 2 - 1) * half * 0.6;
    }
    powerup.active = true;
}

function schedulePowerup(ms) {
    if (powerupTimer) clearTracked(powerupTimer);
    powerupTimer = trackTimeout(function () {
        powerupTimer = null;
        spawnPowerup();
    }, ms);
}

function powerupRect() {
    return { x: powerup.x - POWERUP_SIZE / 2, y: powerup.y - POWERUP_SIZE / 2, w: POWERUP_SIZE, h: POWERUP_SIZE };
}

function updatePowerup() {
    if (!powerup || !powerup.active) return;
    var live = activeSeats();
    var pr = powerupRect();
    for (var i = 0; i < live.length; i++) {
        if (rectsOverlap(pr, seatRect(live[i]))) {
            live[i].canShoot = true;
            live[i].blasterFiredAt = 0;
            powerup.active = false;
            sfxPowerup();
            schedulePowerup(POWERUP_RESPAWN_MS);
            return;
        }
    }
    // The ball can also knock it out, which keeps the middle of a four-goal
    // field from becoming a place people park.
    if (rectsOverlap(pr, ballRect())) {
        powerup.active = false;
        schedulePowerup(POWERUP_RESPAWN_MS);
    }
}

// ===================================================
//   COLLISION
// ===================================================
function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x &&
           a.y < b.y + b.h && a.y + a.h > b.y;
}

// Corner bumpers, four-paddle modes only. See FOUR_D_PONG_PLAN.md 2.3: with
// goals on all four edges, a ball arriving at 45 degrees crosses a point no
// paddle can reach, because each paddle is confined to its own edge. Every
// four-way pong that plays fairly solves it with short diagonals across the
// corners, and it is not obvious the game needs them until you have lost to
// one.
//
// Each bumper is a 45-degree line, so the reflection has a closed form and
// needs no dot product: the top-left and bottom-right diagonals map
// (vx,vy) -> (-vy,-vx), the other two map (vx,vy) -> (vy,vx).
function bounceCorners() {
    if (mode.axes !== 2) return false;
    var c = cornerSize();
    if (c <= 0) return false;

    var bx = ball.x - field.x;
    var by = ball.y - field.y;
    var pad = BALL_HALF * 1.4142;           // the ball's corner reaches the line first
    var hit = false;

    if (bx + by < c + pad) {                                  // top-left
        var t = ball.vx; ball.vx = -ball.vy; ball.vy = -t;
        var push = (c + pad) - (bx + by);
        ball.x += push * 0.5; ball.y += push * 0.5;
        hit = true;
    } else if ((field.w - bx) + by < c + pad) {                // top-right
        var t2 = ball.vx; ball.vx = ball.vy; ball.vy = t2;
        var push2 = (c + pad) - ((field.w - bx) + by);
        ball.x -= push2 * 0.5; ball.y += push2 * 0.5;
        hit = true;
    } else if ((field.w - bx) + (field.h - by) < c + pad) {    // bottom-right
        var t3 = ball.vx; ball.vx = -ball.vy; ball.vy = -t3;
        var push3 = (c + pad) - ((field.w - bx) + (field.h - by));
        ball.x -= push3 * 0.5; ball.y -= push3 * 0.5;
        hit = true;
    } else if (bx + (field.h - by) < c + pad) {                // bottom-left
        var t4 = ball.vx; ball.vx = ball.vy; ball.vy = t4;
        var push4 = (c + pad) - (bx + (field.h - by));
        ball.x += push4 * 0.5; ball.y -= push4 * 0.5;
        hit = true;
    }
    return hit;
}

// The paddle bounce. `collidePoint` is where along the paddle the ball landed,
// -1 at one end and +1 at the other, and it becomes the exit angle -- this is
// the mechanic that makes Pong a game of aim rather than a game of reflexes,
// and it is carried over unchanged from the file this replaces.
function bounceOffSeat(seat) {
    var r = seatRect(seat);
    var speed = Math.min(ballMaxSpeed(), ballSpeed() * ballGain());
    var alongY = SEAT_AXIS[seat.index] === "y";

    var centre = alongY ? (r.y + r.h / 2) : (r.x + r.w / 2);
    var halfLen = alongY ? (r.h / 2) : (r.w / 2);
    var offset = (alongY ? ball.y : ball.x) - centre;
    var collidePoint = clamp(halfLen === 0 ? 0 : offset / halfLen, -1, 1);
    var angle = collidePoint * (Math.PI / 4);

    // -SEAT_SIGN is "away from this seat's wall".
    var away = -SEAT_SIGN[seat.index];
    if (alongY) {
        ball.vx = away * speed * Math.cos(angle);
        ball.vy = speed * Math.sin(angle);
        // Lift the ball clear so it cannot register a second hit next step.
        ball.x = (seat.index === LEFT) ? r.x + r.w + BALL_HALF + 0.5
                                       : r.x - BALL_HALF - 0.5;
    } else {
        ball.vy = away * speed * Math.cos(angle);
        ball.vx = speed * Math.sin(angle);
        ball.y = (seat.index === TOP) ? r.y + r.h + BALL_HALF + 0.5
                                      : r.y - BALL_HALF - 0.5;
    }

    rallyHits++;
    sfxPaddle(rallyHits);
}

// Walls: only on an axis that is NOT in play. Two-paddle modes have walls top
// and bottom, which is exactly what "keep 2 player as is" means physically.
function bounceWalls() {
    if (mode.axes === 2) return false;
    var hit = false;
    if (ball.y - BALL_HALF < field.y && ball.vy < 0) {
        ball.y = field.y + BALL_HALF;
        ball.vy = -ball.vy;
        hit = true;
    } else if (ball.y + BALL_HALF > field.y + field.h && ball.vy > 0) {
        ball.y = field.y + field.h - BALL_HALF;
        ball.vy = -ball.vy;
        hit = true;
    }
    return hit;
}

// Which goal, if any, the ball has left through. Returns the seat index whose
// edge it crossed, or -1.
function goalCrossed() {
    if (ball.x + BALL_HALF < field.x) return LEFT;
    if (ball.x - BALL_HALF > field.x + field.w) return RIGHT;
    if (mode.axes === 2) {
        if (ball.y + BALL_HALF < field.y) return TOP;
        if (ball.y - BALL_HALF > field.y + field.h) return BOTTOM;
    }
    return -1;
}

// ===================================================
//   BALL STEP
// ===================================================
// Sub-stepped, because at the speed cap the ball moves 15px per 60Hz tick and
// a paddle is 14px thick -- a single-step test would let a fast ball pass
// straight through one. Splitting the move into <=6px slices is cheaper than a
// swept-AABB solve and, for a field made of axis-aligned rectangles, exactly
// as correct.
function stepBall(dt) {
    var dist = ballSpeed() * dt;
    var slices = Math.max(1, Math.ceil(dist / 6));
    var sub = dt / slices;

    for (var i = 0; i < slices; i++) {
        ball.x += ball.vx * sub;
        ball.y += ball.vy * sub;

        if (bounceWalls()) sfxWall();
        if (bounceCorners()) sfxWall();

        var live = activeSeats();
        for (var s = 0; s < live.length; s++) {
            var seat = live[s];
            // Only test the seat the ball is actually heading toward. Without
            // this a ball skimming a paddle from behind reflects off its back
            // face, which reads as the ball teleporting.
            var closing = (SEAT_AXIS[seat.index] === "y")
                ? (SEAT_SIGN[seat.index] < 0 ? ball.vx < 0 : ball.vx > 0)
                : (SEAT_SIGN[seat.index] < 0 ? ball.vy < 0 : ball.vy > 0);
            if (!closing) continue;
            if (rectsOverlap(ballRect(), seatRect(seat))) {
                bounceOffSeat(seat);
                break;
            }
        }

        var goal = goalCrossed();
        if (goal >= 0) return goal;
    }
    return -1;
}
