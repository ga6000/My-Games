/**
 * Cliff Run — the bots in seats 2-4
 * ===================================================
 * Declares only. cr-boot.js calls crBotThink(level, body, dt) once per FIXED
 * step, before crStepBody, and the bot's only output is the same `inp` struct
 * a keyboard writes. There is no path from a bot into a body's position or
 * velocity: a bot that cannot press a key it does not have cannot cheat, and
 * that is worth more here than any amount of tuning.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS IS A ROUTE FOLLOWER AND NOT A PLANNER
 * ---------------------------------------------------------------------------
 * cr-level.js emits a waypoint chain per lane as it builds the geometry, and
 * it only ever places a hazard it has just made passable. So the hard problem
 * -- "can this level be finished" -- was answered at generation time, and what
 * is left here is execution. A planner would have to re-derive the answer every
 * frame from a grid that CHANGES UNDERNEATH IT (blocks collapse, walls get
 * bombed open, three other bodies shove you), and it would be wrong exactly
 * when it mattered.
 *
 * Priority order, highest first. Each layer may write `inp` and return; this
 * ordering is the whole design:
 *
 *   1. AVALANCHE    -- nothing else matters within 50px of the left edge
 *   2. RECOVERY     -- fallen well below the route: bunny-hop right, wall-climb
 *   3. STUCK GUARD  -- no forward progress for 1.5s: hop and dash
 *   4. WAYPOINT     -- the kind of the current node decides the behaviour
 *   5. OPPORTUNIST  -- a coin just overhead, if nothing above wanted the frame
 *
 * WAYPOINT RE-ACQUISITION IS BY X, deliberately, and it is what makes the rest
 * robust. After a fall, a shove or a gust the bot does not need to know it went
 * wrong -- the next re-acquisition picks the node nearest its new x and the
 * recovery layer closes the vertical gap. The index can move backwards, which
 * is what a crosswind that pushes you back up the cliff requires.
 */
"use strict";

var CR_BOT_STUCK_TIME = 1.5;
var CR_BOT_PANIC_DIST = 50;

function crMakeBotBrain(level, seat) {
    // Its own stream, so one bot's luck cannot shift another's and a headless
    // run is reproducible from the level seed alone.
    var rng = crRng((level.spec.seed ^ (seat * 0x9E3779B9)) | 0);
    var t = level.spec.difficulty;
    return {
        lane: seat,
        routeIdx: 0,
        rng: rng,
        // Skill jitter. Scaled by level so the later cliffs are messier, which
        // is what makes them beatable -- the bots are meant to die sometimes.
        launchErr: (rng() - 0.5) * (2 + 6 * t),
        slip: 0.015 + 0.05 * t,
        holdJump: 0,
        dashAfter: -1,
        needDouble: 0,
        wjCool: 0,
        shaftSide: 1,
        bombTimer: 0,
        stuck: 0,
        lastX: 0,
        reacquire: 0
    };
}

// Press and HOLD jump for `secs`. Both halves matter: jumpPressed is the edge
// cr-physics.js buffers, and inp.jump staying true across the rise is what
// stops CR_PHYS.jumpCutMul from clipping the arc. See the note in crBotThink.
function crBotHold(b, secs) {
    b.ai.holdJump = secs;
    b.inp.jump = true;
}

function crBotThink(level, b, dt) {
    if (!b.alive || b.finished) return;
    if (!b.ai) b.ai = crMakeBotBrain(level, b.seat);
    var d = b.ai;
    var inp = b.inp;

    // A fresh frame of intent every step. Edges (jumpPressed / dash / bomb)
    // are cleared by cr-physics.js when it consumes them, so only the held
    // directions need resetting here.
    inp.left = false; inp.right = false; inp.up = false; inp.down = false;

    /* BOTS SET CHECKPOINTS TOO, every few tiles of real progress. It is not a
       cheat -- it is the same key the player has, used the way a player would
       -- and without it the bots are playing a strictly harder game than the
       human, which makes them a bad measurement of whether the game is
       finishable. */
    if (b.onGround && (!b.checkpoint || b.x - b.checkpoint.x > CR_TILE * 5)) {
        crSetCheckpoint(b);
    }

    if (d.wjCool > 0) d.wjCool -= dt;
    /* THE HOLD IS DECIDED HERE AND RE-ASSERTED BY crBotHold, which is not
       cosmetic. cr-physics.js clips a rising jump the moment `inp.jump` goes
       false (CR_PHYS.jumpCutMul, the variable-height rule a human needs).
       This line runs BEFORE the behaviour layers, so a layer that only set
       d.holdJump was pressing jump from the NEXT frame onward -- and the frame
       it skipped was the one the jump fired on, so every bot jump was cut to
       45% on its first frame. Apex went from 37.9px to 7.7px: half a tile, on
       a cliff whose smallest step is one. Measured before the fix: 12% of bot
       attempts finished a level. Every assignment to d.holdJump now goes
       through crBotHold, which sets both. */
    if (d.holdJump > 0) { d.holdJump -= dt; inp.jump = true; } else { inp.jump = false; }
    if (d.needDouble > 0) {
        d.needDouble -= dt;
        if (!b.onGround && b.vy > -90 && b.djCharges > 0) { inp.jumpPressed = true; d.needDouble = 0; }
    }
    if (d.dashAfter >= 0) {
        d.dashAfter -= dt;
        if (d.dashAfter <= 0) { inp.dash = true; d.dashAfter = -1; }
    }

    var route = level.routes[d.lane] || level.routes[0];

    /* RE-ACQUIRE EVERY STEP. It was every 1/6s, which sounds harmless and is
       not: at CR_PHYS.moveSpeed the bot covers 18px in that window -- more
       than a tile -- so it could run straight past a jump waypoint's launch
       edge while the previous `walk` node was still current, and walk off the
       cliff instead of jumping. CR_PHYS.coyote buys 0.09s, which is 10px, and
       does not cover it. The scan itself is two comparisons against a sorted
       list, so the throttle was saving nothing.

       EXCEPT AT A BLOCKING WAYPOINT, which is the other half of the same
       lesson. A chimney and a bomb wall are VERTICAL and STATEFUL: x barely
       changes while you climb one or wait for the other, so an x-keyed scan
       walks straight off them. The traces were explicit -- a bot entered a
       chimney, rose two rows, and re-acquired a `walk` node on the far side of
       the wall it was standing inside. It then hopped against that wall until
       the avalanche arrived, because "go right" is a perfectly good plan for
       every waypoint kind except the two that mean "go up" and "wait". */
    var cur = route[Math.min(d.routeIdx, route.length - 1)];
    var blocking = crBotBlockingWp(cur);
    if (!blocking || crBotWpDone(level, b, cur)) crBotReacquire(b, route);
    var wp = route[Math.min(d.routeIdx, route.length - 1)];
    blocking = crBotBlockingWp(wp) && !crBotWpDone(level, b, wp);

    // ---- 1. AVALANCHE
    // Skipped inside a chimney or at a bomb wall: "run right and dash" is not
    // an escape from either, and abandoning the climb to sprint into a wall is
    // strictly worse than finishing it. The stuck guard below still applies.
    if (!blocking && b.x - crAvalancheX < CR_BOT_PANIC_DIST) {
        inp.right = true;
        inp.jump = true;
        if (b.onGround && crBotBlockedAhead(level, b)) inp.jumpPressed = true;
        if (b.dashCool <= 0 && b.onGround) inp.dash = true;
        crBotTrackStuck(b, dt);
        return;
    }

    // ---- 2. RECOVERY
    // 2.2 tiles off the route is past the point where the next waypoint is
    // reachable by walking, so stop pretending to follow it. Not inside a
    // blocking waypoint: being four rows below the top of a chimney you are
    // climbing is the normal state of climbing a chimney, and both features
    // have a floor to land on and retry from.
    if (!blocking && Math.abs(b.y - wp.y) > CR_TILE * 2.2) {
        /* FIRST, TRY A DIFFERENT LANE. All four routes are walkable paths
           through the same cliff, and past 33% of the level they interleave
           (cr-level.js's band widening), so a bot that has fallen out of lane 1
           is very often standing ON lane 2's route. Switching to the nearest
           one turns the commonest failure -- off-route and climbing forever --
           into a lane change.

           Before this, recovery was climb-only, and the traces were
           unambiguous: a bot six rows below its own route bunny-hopped right
           along perfectly good ground belonging to the lane below until it
           ran out of cliff. Lanes 2-4 finished almost nothing. */
        var swap = crBotNearestLane(level, b);
        if (swap >= 0 && swap !== d.lane) {
            d.lane = swap;
            d.routeIdx = 0;
            crBotReacquire(b, level.routes[swap]);
            crBotTrackStuck(b, dt);
            return;
        }

        inp.right = true;
        inp.jump = true;
        if (b.y > wp.y) {
            // Below the route: climb. Hop, wall-jump off anything adjacent,
            // and spend a charge rather than run out of cliff.
            if (b.onGround) {
                inp.jumpPressed = true;
                crBotHold(b, 0.32);
            } else if (b.wallDir !== 0 && d.wjCool <= 0) {
                inp.jumpPressed = true;
                d.wjCool = 0.2;
                crBotHold(b, 0.32);
            } else if (b.djCharges > 0 && b.vy > 20) {
                inp.jumpPressed = true;     // a charge is worth less than the run
            }
        }
        crBotTrackStuck(b, dt);
        return;
    }

    // ---- 3. STUCK GUARD
    crBotTrackStuck(b, dt);
    if (d.stuck > CR_BOT_STUCK_TIME) {
        inp.right = true;
        inp.jump = true;
        if (b.onGround) { inp.jumpPressed = true; crBotHold(b, 0.3); }
        if (b.dashCool <= 0) inp.dash = true;
        d.stuck = 0;
        return;
    }

    // ---- 4. WAYPOINT
    switch (wp.kind) {
        case "walljump": crBotShaft(level, b, wp, dt); return;
        case "bomb":     crBotBomb(level, b, wp, dt); return;
        case "jump":     crBotJump(level, b, wp, "jump"); return;
        case "gust":     crBotGust(level, b, wp); return;
        case "spring":   crBotSpring(level, b, wp); return;
        default:         crBotWalk(level, b, wp); return;
    }
}

// ===================================================
//   RE-ACQUISITION
// ===================================================
// The two waypoint kinds that own the bot until their own behaviour releases
// them. Both are features you go UP or WAIT at rather than past, so an x-keyed
// scan cannot tell when they are finished.
function crBotBlockingWp(wp) {
    return !!wp && (wp.kind === "walljump" || wp.kind === "bomb");
}

function crBotWpDone(level, b, wp) {
    if (!wp) return true;
    if (wp.kind === "walljump") {
        if (b.y <= wp.data.topY + 10) return true;             // out the top
        if (b.y > wp.y + CR_TILE * 3) return true;             // fell clean out
        return false;
    }
    if (wp.kind === "bomb") {
        if (crGet(level, wp.data.wallCol, wp.row - 1) !== CR_T.BREAK) return true;
        if (b.y > wp.y + CR_TILE * 3) return true;
        return false;
    }
    return true;
}

function crBotReacquire(b, route) {
    var i = b.ai.routeIdx;
    while (i < route.length - 1 && route[i].x < b.x - 6) i++;
    // The backward scan needs a WIDER margin than the forward one (a tile,
    // against 6px), or the two fight over a body sitting between two
    // waypoints at nearly the same x and the index flip-flops every frame --
    // which the traces showed happening at every jump landing.
    while (i > 0 && route[i - 1].x > b.x + CR_TILE) i--;
    b.ai.routeIdx = i;
}

/*
 * Which lane's route passes nearest this body right now, by vertical distance
 * at the body's own x. Returns -1 when nothing is meaningfully closer than the
 * lane the bot already has -- a bot that swaps lanes over two pixels swaps
 * them back next frame.
 */
function crBotNearestLane(level, b) {
    var best = -1, bestDy = 1e9;
    for (var lane = 0; lane < level.routes.length; lane++) {
        var route = level.routes[lane];
        // Walk to the node nearest the body's x. The routes are x-sorted, so
        // this is a scan from the front; they are short enough (a few dozen
        // nodes) that this costs less than keeping a per-lane cursor.
        var node = null;
        for (var i = 0; i < route.length; i++) {
            if (route[i].x < b.x - CR_TILE) continue;
            node = route[i];
            break;
        }
        if (!node) continue;
        var dy = Math.abs(node.y - b.y);
        if (dy < bestDy) { bestDy = dy; best = lane; }
    }
    // Only worth switching to a route the bot could actually walk onto.
    if (bestDy > CR_TILE * 2.2) return -1;
    return best;
}

function crBotTrackStuck(b, dt) {
    var d = b.ai;
    if (b.x - d.lastX > 1.5) { d.stuck = 0; d.lastX = b.x; }
    else d.stuck += dt;
}

// ===================================================
//   PROBES
// ===================================================
// A step or a wall directly ahead at knee height. 4px rather than 1 so the
// hop starts before the body is already pressed against it with vx zeroed.
function crBotBlockedAhead(level, b) {
    var ax = b.x + (b.face >= 0 ? b.w + 4 : -4);
    return crSolidForX(crTileAt(level, ax, b.y + b.h - 5)) ||
           crSolidForX(crTileAt(level, ax, b.y + b.h - 12));
}

function crBotNothingBelow(level, b) {
    for (var dy = b.h; dy < b.h + CR_TILE * 3; dy += 6) {
        if (crSolidForDown(crTileAt(level, b.x + b.w / 2, b.y + dy))) return false;
    }
    return true;
}

// ===================================================
//   WAYPOINT BEHAVIOURS
// ===================================================
// Always rightward. There is deliberately no "walk back to the waypoint"
// branch: left is where the avalanche is, and the only reason a bot is ever
// behind its waypoint is a fall or a shove, both of which the RECOVERY layer
// owns. A bot that backtracks on this cliff dies to the wall while doing it.
function crBotWalk(level, b, wp) {
    var inp = b.inp;
    inp.right = true;

    // A step in the way, or the next node is above us: hop.
    if (b.onGround && (crBotBlockedAhead(level, b) || wp.y < b.y - 6)) {
        inp.jumpPressed = true;
        crBotHold(b, wp.y < b.y - 20 ? 0.32 : 0.16);
    }
    // "noStop": a run of instant-crumble blocks. Keeping the dash ready here
    // is what turns a 0.22s fuse into a crossing rather than a gamble.
    if (wp.data && wp.data.noStop && b.onGround && b.dashCool <= 0) inp.dash = true;
    crBotCoinHop(level, b);
}

function crBotJump(level, b, wp, mode) {
    var inp = b.inp;
    var d = b.ai;
    inp.right = true;

    var launchAt = wp.x + d.launchErr;
    if (b.x >= launchAt && (b.onGround || b.coyote > 0)) {
        if (d.rng() < d.slip) return;      // a missed frame, on purpose
        inp.jumpPressed = true;
        var dRow = (wp.data && wp.data.dRow) || 0;
        // Going up or level wants the whole arc; dropping wants a short hop so
        // the bot does not sail over the landing.
        crBotHold(b, dRow <= 0 ? 0.34 : 0.12);
        /* NO MID-ARC DASH. It was fired here for the widest gaps, and it is
           exactly the wrong tool once crMaxGap caps those gaps well inside the
           reach: CR_PHYS.dashVel adds 27px to a jump that already had 20px of
           margin, so the bot sailed PAST the landing platform into the next
           gap. The dash is kept for the two cases where more speed is
           unambiguously better -- outrunning the avalanche, and crossing a run
           of instant-crumble blocks. */
        if (dRow <= -2 && b.djCharges > 0) d.needDouble = 0.3;
        return;
    }
    if (!b.onGround) inp.jump = true;
}

/*
 * A wind tunnel. The bot WALKS OFF THE EDGE and does nothing else.
 *
 * It must not jump, and that is not a tuning choice. crEmitVent's gust sets
 * ay to -755 against a gravity of 760, so inside the rect there is almost
 * nothing left to decay an upward velocity: a jump's -240 would coast until
 * the body left the top of the rect, which puts it above the far platform and
 * off the route. Walking in at vy ~= 0 is the behaviour the gust was shaped
 * for -- you cross level, and the only input that matters is "keep going".
 */
function crBotGust(level, b, wp) {
    b.inp.right = true;
    b.inp.jump = false;
    void level; void wp;
}

function crBotSpring(level, b, wp) {
    var inp = b.inp;
    inp.right = true;
    // Holding jump as the branch is touched is worth CR_PHYS.springHeldBonus,
    // and holding it early costs nothing because the bot is on the ground.
    inp.jump = true;
    if (b.onGround && crBotBlockedAhead(level, b)) inp.jumpPressed = true;
}

/*
 * The chimney. Ground-jump into the tall right wall, then alternate: whenever
 * a wall is adjacent and the cooldown has expired, jump off it and hold
 * toward the OTHER one. cr-physics.js's wallSteerLock (0.12s) owns vx for the
 * first moment of each jump, so the held direction only starts to matter once
 * the body is clear of the wall it left -- which is exactly when it should.
 *
 * The chimney floor is the retry net: a bot that mistimes this falls back onto
 * it and starts again, losing a second or two rather than its run.
 */
function crBotShaft(level, b, wp, dt) {
    var inp = b.inp;
    var d = b.ai;
    var data = wp.data;

    // Out of the top: stop climbing and go right, onto the wall top or the
    // platform that continues from it.
    if (b.y <= data.topY + 10) {
        inp.right = true;
        if (b.onGround) d.routeIdx = Math.min(d.routeIdx + 1, level.routes[d.lane].length - 1);
        return;
    }

    if (b.onGround) {
        d.shaftSide = 1;
        inp.right = true;
        inp.jump = true;
        if (b.x >= data.rightX - 4) {
            inp.jumpPressed = true;
            crBotHold(b, 0.34);
            d.wjCool = 0.14;        // let the ground jump get clear of the floor first
        }
        return;
    }

    inp.jump = true;
    if (b.wallDir !== 0 && d.wjCool <= 0) {
        inp.jumpPressed = true;
        d.wjCool = 0.18;
        d.shaftSide = -b.wallDir;
        crBotHold(b, 0.3);
    }
    if (d.shaftSide < 0) inp.left = true; else inp.right = true;
    void dt;
}

/*
 * The bomb wall. Four cases and they are tried in this order:
 *   gone      -> walk through
 *   armed     -> walk up to it, set the bomb down, back off while it burns
 *   charged   -> no bomb, but a double-jump charge clears 3 tiles, so take
 *                the alternative solution rather than stalling
 *   neither   -> push right and let the stuck guard hop; last resort
 */
function crBotBomb(level, b, wp, dt) {
    var inp = b.inp;
    var d = b.ai;
    var wallCol = wp.data.wallCol;
    var wallX = wallCol * CR_TILE;
    var gone = crGet(level, wallCol, wp.row - 1) !== CR_T.BREAK;

    if (gone) {
        inp.right = true;
        if (b.onGround && crBotBlockedAhead(level, b)) inp.jumpPressed = true;
        return;
    }

    if (d.bombTimer > 0) {
        d.bombTimer -= dt;
        inp.left = true;            // clear of the blast shove
        return;
    }

    if (b.bombs > 0) {
        if (b.x + b.w < wallX - 3) { inp.right = true; return; }
        inp.bomb = true;
        d.bombTimer = CR_BOMB_FUSE + 0.25;
        return;
    }

    if (b.djCharges > 0) {
        inp.right = true;
        inp.jump = true;
        if (b.onGround && b.x + b.w >= wallX - 26) {
            inp.jumpPressed = true;
            crBotHold(b, 0.34);
            d.needDouble = 0.34;
        }
        return;
    }

    inp.right = true;
}

// ===================================================
//   5. OPPORTUNIST
// ===================================================
// A coin within a short hop. Only reached when no higher layer wanted the
// frame, so a bot never trades its run for 25 points.
function crBotCoinHop(level, b) {
    if (!b.onGround) return;
    for (var i = 0; i < crCoins.length; i++) {
        var c = crCoins[i];
        if (c.taken) continue;
        var dx = c.x - (b.x + b.w / 2);
        if (dx < 0 || dx > 26) continue;
        var dy = (b.y + b.h / 2) - c.y;
        if (dy < 12 || dy > 34) continue;
        b.inp.jumpPressed = true;
        crBotHold(b, 0.22);
        return;
    }
}
