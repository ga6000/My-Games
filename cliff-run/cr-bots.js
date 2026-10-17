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

function crBotThink(level, b, dt) {
    if (!b.alive || b.finished) return;
    if (!b.ai) b.ai = crMakeBotBrain(level, b.seat);
    var d = b.ai;
    var inp = b.inp;

    // A fresh frame of intent every step. Edges (jumpPressed / dash / bomb)
    // are cleared by cr-physics.js when it consumes them, so only the held
    // directions need resetting here.
    inp.left = false; inp.right = false; inp.up = false; inp.down = false;

    if (d.wjCool > 0) d.wjCool -= dt;
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

    // ---- re-acquire (every 1/6s; between times the index only moves forward)
    d.reacquire -= dt;
    if (d.reacquire <= 0) { d.reacquire = 0.16; crBotReacquire(b, route); }
    var wp = route[Math.min(d.routeIdx, route.length - 1)];

    // ---- 1. AVALANCHE
    if (b.x - crAvalancheX < CR_BOT_PANIC_DIST) {
        inp.right = true;
        inp.jump = true;
        if (b.onGround && crBotBlockedAhead(level, b)) inp.jumpPressed = true;
        if (b.dashCool <= 0 && b.onGround) inp.dash = true;
        crBotTrackStuck(b, dt);
        return;
    }

    // ---- 2. RECOVERY
    // 2.2 tiles below the route is past the point where the next waypoint is
    // reachable by walking, so stop pretending to follow it and climb.
    if (b.y > wp.y + CR_TILE * 2.2) {
        inp.right = true;
        inp.jump = true;
        if (b.onGround) {
            inp.jumpPressed = true;
            d.holdJump = 0.3;
        } else if (b.wallDir !== 0 && d.wjCool <= 0) {
            inp.jumpPressed = true;
            d.wjCool = 0.2;
            d.holdJump = 0.3;
        } else if (b.djCharges > 0 && b.vy > 40 && crBotNothingBelow(level, b)) {
            inp.jumpPressed = true;     // spend a charge rather than die
        }
        crBotTrackStuck(b, dt);
        return;
    }

    // ---- 3. STUCK GUARD
    crBotTrackStuck(b, dt);
    if (d.stuck > CR_BOT_STUCK_TIME) {
        inp.right = true;
        inp.jump = true;
        if (b.onGround) { inp.jumpPressed = true; d.holdJump = 0.3; }
        if (b.dashCool <= 0) inp.dash = true;
        d.stuck = 0;
        return;
    }

    // ---- 4. WAYPOINT
    switch (wp.kind) {
        case "walljump": crBotShaft(level, b, wp, dt); return;
        case "bomb":     crBotBomb(level, b, wp, dt); return;
        case "jump":     crBotJump(level, b, wp, "jump"); return;
        case "gust":     crBotJump(level, b, wp, "gust"); return;
        case "spring":   crBotSpring(level, b, wp); return;
        default:         crBotWalk(level, b, wp); return;
    }
}

// ===================================================
//   RE-ACQUISITION
// ===================================================
function crBotReacquire(b, route) {
    var i = b.ai.routeIdx;
    while (i < route.length - 1 && route[i].x < b.x - 6) i++;
    while (i > 0 && route[i - 1].x > b.x + 4) i--;
    b.ai.routeIdx = i;
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
function crBotWalk(level, b, wp) {
    var inp = b.inp;
    if (b.x < wp.x - 2) inp.right = true;
    else if (b.x > wp.x + CR_TILE) inp.left = true;
    else inp.right = true;

    // A step in the way, or the next node is above us: hop.
    if (b.onGround && (crBotBlockedAhead(level, b) || wp.y < b.y - 6)) {
        inp.jumpPressed = true;
        b.ai.holdJump = wp.y < b.y - 20 ? 0.3 : 0.14;
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
        d.holdJump = dRow <= 0 ? 0.34 : 0.1;
        var gap = (wp.data && wp.data.gap) || 0;
        if (mode === "jump" && gap >= 3) d.dashAfter = 0.08;
        if (dRow <= -2 && b.djCharges > 0) d.needDouble = 0.3;
        return;
    }
    // Airborne over the gap: a gust segment wants the direction held, which is
    // all "riding" one amounts to -- the lift is the level's job, not the bot's.
    if (!b.onGround) {
        inp.jump = true;
        if (mode === "gust") inp.right = true;
    }
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
            d.holdJump = 0.34;
            d.wjCool = 0.14;        // let the ground jump get clear of the floor first
        }
        return;
    }

    inp.jump = true;
    if (b.wallDir !== 0 && d.wjCool <= 0) {
        inp.jumpPressed = true;
        d.wjCool = 0.18;
        d.shaftSide = -b.wallDir;
        d.holdJump = 0.3;
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
            d.holdJump = 0.34;
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
        b.ai.holdJump = 0.2;
        return;
    }
}
