// ===================================================
//   4D Pong -- the CPU seats: easy / medium / hard
// ===================================================
// Two jobs:
//   1P  the RIGHT seat, at the difficulty the menu selected
//   3P  the BOTTOM seat, always medium -- it is filling a chair, not setting
//       the challenge, and a hard CPU among three friends is a spoiler
//   attract mode ( 4.8) fills EVERY seat, which is why this file exists
//       before the menu does anything: the cabinet playing itself is the same
//       code as the CPU opponent, so attract cost nothing to add
//
// ---------------------------------------------------------------------------
// WHAT MAKES A PONG CPU FEEL FAIR RATHER THAN CHEAP
// ---------------------------------------------------------------------------
// A paddle that tracks ball.y exactly is unbeatable and joyless, and the usual
// fix -- slow the paddle down -- makes it unbeatable-then-suddenly-useless
// instead. The three knobs that actually produce a difficulty CURVE are:
//
//   speed     how fast it can travel (the crude one, used least)
//   reaction  how long it commits to a stale target before re-aiming. This is
//             what reads as "it got caught out", which is what a human loss
//             looks like from the other side of the table.
//   error     how far off the true intercept it aims, in paddle-lengths. A
//             miss caused by aim reads as a mistake; a miss caused by speed
//             reads as a handicap.
//
// Only HARD predicts the intercept. Easy and medium chase the ball's current
// position, which is exactly the mistake a new player makes, and it is why
// they get beaten by an angled shot rather than by a fast one.
"use strict";

// MEASURED, NOT GUESSED. Every number below comes out of head-to-head runs of
// 240 simulated seconds per pairing, blasters disabled so the paddles alone
// were being compared. GAME_PROTOTYPE_INSTRUCTIONS.md 4 is explicit that
// invented targets are how this repo's old docs went wrong, so here is the
// actual table for hard's aim error, the one knob that decides whether hard is
// difficult or merely impossible:
//
//     hard.error | hard-v-hard | medium-v-hard | hard-v-medium
//        0.55    |   0 / 4min  |     0 : 8     |     8 : 0      shutout again
//        0.62    |   4 / 4min  |     2 : 8     |     8 : 2      <- chosen
//        0.72    |  21 / 4min  |    13 : 7     |     4 : 14     medium now WINS
//        0.85    |  52 / 4min  |    15 : 5     |     7 : 10
//
// 0.62 is the knee. Below it hard cannot concede; above it the aim error
// swamps the prediction advantage and hard drops BELOW medium, which would
// have shipped a difficulty menu whose hardest setting was the second easiest.
// The mirrored pairs (2:8 against 8:2) are also the check that no left/right
// asymmetry crept into the seat code.
//
// For scale, at these settings: easy-v-easy ~26 goals/3min, medium-v-medium ~8.
var AI_LEVELS = {
    easy:   { speed: 0.58, reactMs: 320, error: 0.85, predict: false, fireChance: 0.00, idleDrift: 0.35 },
    medium: { speed: 0.82, reactMs: 155, error: 0.40, predict: false, fireChance: 0.20, idleDrift: 0.20 },
    hard:   { speed: 1.00, reactMs: 95,  error: 0.62, predict: true,  fireChance: 0.55, idleDrift: 0.08 }
};

function attachAI(seat, level) {
    seat.ai = {
        level: AI_LEVELS[level] ? level : "medium",
        target: null,        // field-local position along this seat's edge
        nextThinkAt: 0,
        wobble: Math.random() * Math.PI * 2,
        wasIncoming: false,  // edge-detect, so aim is rolled once per approach
        aimError: 0
    };
}

function aiLevelOf(seat) {
    return AI_LEVELS[(seat.ai && seat.ai.level) || "medium"];
}

// ===================================================
//   PREDICTION  (hard only)
// ===================================================
// Walks the ball forward to the plane of this seat's paddle, reflecting off
// whatever the current mode actually has -- side walls in the two-paddle
// modes, corner bumpers in the four-paddle ones. It is a simulation of the
// same rules the ball obeys rather than a second physics model, which is why
// it cannot silently disagree with the real one.
//
// Bounded by iterations, not by time: a ball travelling almost parallel to the
// paddle's plane takes arbitrarily long to arrive, and an unbounded loop here
// would hang the frame.
function predictIntercept(seat) {
    var alongY = SEAT_AXIS[seat.index] === "y";
    var vTowards = alongY ? ball.vx : ball.vy;
    var away = -SEAT_SIGN[seat.index];

    // Ball is heading away from this seat -- nothing to intercept.
    if (vTowards * away >= 0) return null;

    var x = ball.x, y = ball.y, vx = ball.vx, vy = ball.vy;
    var planeX = (seat.index === LEFT) ? field.x + PADDLE_THICK : field.x + field.w - PADDLE_THICK;
    var planeY = (seat.index === TOP) ? field.y + PADDLE_THICK : field.y + field.h - PADDLE_THICK;

    for (var guard = 0; guard < 24; guard++) {
        // Time to reach this seat's plane.
        var t = alongY ? (planeX - x) / vx : (planeY - y) / vy;
        if (!isFinite(t) || t < 0) return null;

        // Time to the nearest reflection on the OTHER axis, if this mode has
        // one there. Four-paddle fields have no side walls at all, so the ball
        // simply arrives (or leaves through a goal, which is somebody else's
        // problem and not worth modelling).
        var tWall = Infinity;
        if (mode.axes === 1) {
            if (alongY) {
                if (vy > 0) tWall = (field.y + field.h - BALL_HALF - y) / vy;
                else if (vy < 0) tWall = (field.y + BALL_HALF - y) / vy;
            } else {
                if (vx > 0) tWall = (field.x + field.w - BALL_HALF - x) / vx;
                else if (vx < 0) tWall = (field.x + BALL_HALF - x) / vx;
            }
        }

        if (tWall >= t || !isFinite(tWall) || tWall < 0) {
            var hitX = x + vx * t, hitY = y + vy * t;
            return alongY ? (hitY - field.y) : (hitX - field.x);
        }

        // Advance to the wall and reflect.
        x += vx * tWall;
        y += vy * tWall;
        if (alongY) vy = -vy; else vx = -vx;
    }
    return null;
}

// ===================================================
//   THINK
// ===================================================
function aiThink(seat, nowMs) {
    var lv = aiLevelOf(seat);
    var ai = seat.ai;
    if (nowMs < ai.nextThinkAt) return;
    ai.nextThinkAt = nowMs + lv.reactMs;

    var alongY = SEAT_AXIS[seat.index] === "y";
    var along = alongY ? field.h : field.w;
    var ballAlong = alongY ? (ball.y - field.y) : (ball.x - field.x);

    // Is the ball even coming this way? On a four-goal field it usually is
    // not, and a CPU that tracks a ball heading elsewhere is a CPU that is out
    // of position when it turns around.
    var vTowards = alongY ? ball.vx : ball.vy;
    var incoming = vTowards * (-SEAT_SIGN[seat.index]) < 0;

    var target;
    if (!incoming) {
        ai.wasIncoming = false;
        // Drift back toward the middle, by an amount the level decides. Easy
        // barely recentres, which is most of why it gets caught out.
        ai.wobble += 0.7;
        target = along / 2 + Math.sin(ai.wobble) * along * 0.5 * lv.idleDrift;
    } else {
        // ---------------------------------------------------------------
        // THE AIM ERROR IS ROLLED ONCE PER APPROACH AND THEN COMMITTED TO
        // ---------------------------------------------------------------
        // It used to be re-rolled every think, and MEASURED OVER 180 SIMULATED
        // SECONDS that made hard literally unable to concede -- hard vs hard
        // finished 0:0 at every error value from 0.26 up to 0.62 paddle-lengths.
        //
        // The reason is that a fresh sample each think is NOISE AROUND THE
        // TRUTH, and the ball's flight allows a dozen thinks: the samples
        // average out and the paddle converges on the exact intercept. Turning
        // the knob up did nothing because the knob was never connected.
        //
        // Rolled once, on the frame the ball turns toward this seat, it is a
        // misjudgement the CPU has to live with for the whole approach -- which
        // is what a human error actually is, and what makes beating hard feel
        // like beating somebody rather than waiting for a coin flip.
        if (!ai.wasIncoming) {
            ai.wasIncoming = true;
            ai.aimError = (Math.random() * 2 - 1) * lv.error * seat.long;
        }
        if (lv.predict) {
            var p = predictIntercept(seat);
            target = (p === null) ? ballAlong : p;
        } else {
            target = ballAlong;
        }
        target += ai.aimError;
    }

    // A little live jitter on top, so a paddle never sits perfectly still.
    // Small enough to average out, which is exactly why it is NOT the error.
    target += (Math.random() * 2 - 1) * 0.06 * seat.long;

    var span = slideSpan(seat);
    ai.target = clamp(target, span.min + seat.long / 2, span.max - seat.long / 2);
}

function aiAct(seat, dt, nowMs) {
    if (seat.kind !== CPU || seat.stunned) return;
    if (!seat.ai) attachAI(seat, "medium");

    aiThink(seat, nowMs);
    if (seat.ai.target === null) return;

    var lv = aiLevelOf(seat);
    var gap = seat.ai.target - seat.pos;

    // A deadband the width of the paddle's own travel-per-step, or the paddle
    // jitters on the spot forever trying to land exactly on a float.
    var step = PADDLE_SPEED * lv.speed * dt;
    if (Math.abs(gap) <= step) {
        // Re-clamp rather than trusting the target: desperation can have grown
        // the paddle since aiThink() last ran, which moves the legal range.
        var span0 = slideSpan(seat);
        seat.pos = clamp(seat.ai.target, span0.min + seat.long / 2, span0.max - seat.long / 2);
        seat.frac = (span0.max - span0.min) > 0 ? (seat.pos - span0.min) / (span0.max - span0.min) : 0.5;
        return;
    }

    // Reuse the human movement path so a CPU is bound by exactly the same
    // clamps a player is. Scaling dt is how the level's speed is applied
    // without a second copy of slideSeat().
    slideSeat(seat, gap > 0 ? 1 : -1, dt * lv.speed);

    // Blaster. Only when the ball is NOT the more urgent problem: a CPU that
    // fires while a shot is incoming is a CPU that concedes.
    if (lv.fireChance > 0 && seat.canShoot && !incomingSoon(seat)) {
        if (Math.random() < lv.fireChance * dt) tryFire(seat);
    }
}

// True when the ball reaches this seat's plane within ~0.6s.
function incomingSoon(seat) {
    var alongY = SEAT_AXIS[seat.index] === "y";
    var v = alongY ? ball.vx : ball.vy;
    var away = -SEAT_SIGN[seat.index];
    if (v * away >= 0) return false;
    var dist = alongY
        ? Math.abs(ball.x - (seat.index === LEFT ? field.x : field.x + field.w))
        : Math.abs(ball.y - (seat.index === TOP ? field.y : field.y + field.h));
    return dist / Math.max(1, Math.abs(v)) < 0.6;
}
