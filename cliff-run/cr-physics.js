/**
 * Cliff Run — integration, tile collision, wall skills, player-vs-player
 * ===================================================
 * Declares only. cr-boot.js's fixed step calls crStepBody then crResolvePairs.
 *
 * FIXED TIMESTEP, always. cr-boot.js runs this at a fixed 1/120s from an
 * accumulator and never hands it a raw frame delta. four-d-pong/fp-boot.js's
 * header records what the alternative cost: a per-rAF constant meant the same
 * game ran 2.4x faster on a 144Hz monitor, so two people in one match were
 * playing different games. A platformer with jump arcs tuned to the pixel is
 * strictly less forgiving of that than Pong was.
 *
 * Axis-separated collision: move x, resolve x, move y, resolve y. The order
 * matters and x goes first -- resolving y first lets a body moving diagonally
 * into a corner get pushed up onto a ledge it should have hit the side of,
 * which reads as the floor randomly grabbing you.
 */
"use strict";

// ===================================================
//   TILE QUERIES
// ===================================================
// BRANCH is solid from ABOVE ONLY: you spring off it, you do not run into it.
// Keeping that asymmetry here rather than in CR_SOLID is why CR_SOLID can stay
// a plain lookup.
/*
 * HOW FORGIVING THE CONTROLS ARE, THIS LEVEL. CR_PHYS.coyote and .jumpBuffer
 * are the strictest (level 10) values; crLevelSpec's `forgiveness` scales them
 * up to 1.8x on level 1.
 *
 * This is the part of "early levels should allow for imprecise input" that
 * geometry cannot do. On level 1 a jump pressed a sixth of a second after you
 * walked off a ledge still fires, and one pressed a sixth of a second before
 * you land is still waiting when you do. By level 10 neither is true, and
 * nothing on screen ever says so -- it is felt, which is the point.
 */
function crForgive() {
    return (crLevel && crLevel.spec && crLevel.spec.forgiveness) || 1;
}
function crCoyote() { return CR_PHYS.coyote * crForgive(); }
function crBuffer() { return CR_PHYS.jumpBuffer * crForgive(); }

function crSolidForX(code) {
    return code !== CR_T.EMPTY && code !== CR_T.BRANCH && crTileSolid(code);
}

function crSolidForDown(code) {
    return code === CR_T.BRANCH || crTileSolid(code);
}

function crSolidForUp(code) {
    return code !== CR_T.BRANCH && crTileSolid(code);
}

// ===================================================
//   HORIZONTAL
// ===================================================
function crMoveX(level, b, dx) {
    if (dx === 0) return;
    b.x += dx;
    if (b.x < 0) { b.x = 0; b.vx = 0; }

    var c0 = Math.floor(b.x / CR_TILE);
    var c1 = Math.floor((b.x + b.w - 1) / CR_TILE);
    var r0 = Math.floor(b.y / CR_TILE);
    var r1 = Math.floor((b.y + b.h - 1) / CR_TILE);

    for (var r = r0; r <= r1; r++) {
        for (var c = c0; c <= c1; c++) {
            if (!crSolidForX(crGet(level, c, r))) continue;
            if (dx > 0) { b.x = c * CR_TILE - b.w; }
            else { b.x = (c + 1) * CR_TILE; }
            b.vx = 0;
            if (b.dashTime > 0) b.dashTime = 0;   // a dash into rock ends there
            return;
        }
    }
}

// ===================================================
//   VERTICAL
// ===================================================
/*
 * THE EPSILON ON THE BOTTOM EDGE IS THE MOST LOAD-BEARING NUMBER IN THIS FILE.
 *
 * It was `b.y + b.h - 1`, a one-pixel inset, which is the normal idiom for the
 * LAST pixel inside an AABB and is right for the horizontal scan above. For a
 * body resting on a platform it is catastrophic. crLand snaps the feet to
 * exactly r*TILE -- touching, not overlapping -- so the next step's descent is
 * gravity for one frame: 0.05px. With a 1px inset the scan then looks at the
 * row ABOVE the platform, finds nothing, falls through to `onGround = false`,
 * and the body spends about nineteen frames sinking before it penetrates far
 * enough to be caught.
 *
 * So `onGround` was FALSE for most of every frame of ordinary walking, and
 * everything keyed off it quietly stopped working: the bots' jumps need
 * `onGround || coyote`, so they ran off ledges without jumping; crWallProbe
 * only runs when airborne, so a bot walking past a wall could wall-jump
 * instead of jumping; and the collapsing blocks are armed from the ground
 * check, so they often did not arm at all.
 *
 * Measured before and after, 8 seeds x 10 levels x 4 bots: 18% of attempts
 * finished a level, and 1238 route departures happened at plain `walk`
 * waypoints -- bots walking calmly off the cliff. See cliff-run/CLAUDE.md.
 *
 * The horizontal scan keeps its 1px inset on purpose: there it is what stops a
 * body standing on a floor from catching that floor tile's SIDE as it walks.
 */
var CR_EPS = 0.0001;

function crMoveY(level, b, dy) {
    if (dy === 0) return;
    var prevBottom = b.y + b.h;
    b.y += dy;

    var c0 = Math.floor(b.x / CR_TILE);
    var c1 = Math.floor((b.x + b.w - 1) / CR_TILE);
    var r0 = Math.floor(b.y / CR_TILE);
    var r1 = Math.floor((b.y + b.h - (dy > 0 ? CR_EPS : 1)) / CR_TILE);

    // Falling resolves against the LOWEST row the body now overlaps (the one
    // the feet are in), rising against the highest. Scanning the other way
    // would snap a body to a tile its head is in while its feet land.
    var step = dy > 0 ? -1 : 1;
    var from = dy > 0 ? r1 : r0;
    var to = dy > 0 ? r0 : r1;

    for (var r = from; dy > 0 ? r >= to : r <= to; r += step) {
        for (var c = c0; c <= c1; c++) {
            var code = crGet(level, c, r);
            if (code === CR_T.EMPTY) continue;

            if (dy > 0) {
                if (!crSolidForDown(code)) continue;
                // A branch (and only a branch) is passed through from below:
                // the previous frame's feet must already have been above it.
                if (code === CR_T.BRANCH && prevBottom > r * CR_TILE + 2) continue;
                b.y = r * CR_TILE - b.h;
                crLand(level, b, code, c, r);
                return;
            }
            if (!crSolidForUp(code)) continue;
            b.y = (r + 1) * CR_TILE;
            b.vy = 0;
            return;
        }
    }
}

/*
 * The ground under the feet, probed 1px down, independently of whether a
 * collision happened this frame. This is what keeps `onGround` honest between
 * collisions instead of inferring it from one -- the inference is what the note
 * above is about.
 *
 * BRANCH is excluded: you never REST on a branch, you are thrown off it, and
 * crLand owns that. Reporting it as ground would re-fire the spring every frame
 * the body sat in it.
 */
function crGroundUnder(level, b) {
    var r = Math.floor((b.y + b.h + 1) / CR_TILE);
    var c0 = Math.floor(b.x / CR_TILE);
    var c1 = Math.floor((b.x + b.w - 1) / CR_TILE);
    for (var c = c0; c <= c1; c++) {
        var code = crGet(level, c, r);
        if (code === CR_T.BRANCH) continue;
        if (crSolidForDown(code)) return { code: code, col: c, row: r };
    }
    return null;
}

/*
 * Touchdown. Everything that happens because of WHAT you landed on lives here,
 * so there is exactly one place where a tile code turns into a consequence.
 */
function crLand(level, b, code, col, row) {
    if (code === CR_T.BRANCH) {
        // Auto-spring, not a timed input. CLIFF_RUN_PLAN.md 6: this is a
        // trampoline so that the bots can use branches at all, and it happens
        // to read better for a person than a one-frame window would.
        //
        // FORWARD as well as up -- see the note on CR_PHYS.springVel. The
        // throw keeps whichever way the body was already going, so a branch
        // never reverses you into the avalanche.
        b.vy = CR_PHYS.springVel + (b.inp.jump ? CR_PHYS.springHeldBonus : 0);
        var dir = Math.abs(b.vx) > 8 ? crSign(b.vx) : b.face;
        b.vx = dir * CR_PHYS.springVx;
        b.onGround = false;
        b.jumpsUsed = 1;
        b.springFlash = 0.25;
        crSfxSpring();
        return;
    }

    var wasAir = !b.onGround;
    b.vy = 0;
    b.onGround = true;
    b.groundCode = code;
    b.jumpsUsed = 0;
    b.airJumps = 1;             // the baseline air jump comes back on contact
    b.coyote = crCoyote();
    if (wasAir) crSfxLand();

    if (code === CR_T.CRUMBLE || code === CR_T.TIMED) crTouchTile(level, col, row);
}

// ===================================================
//   WALL PROBE
// ===================================================
// A wall is adjacent if a solid tile sits 2px to the side at any row the body
// occupies. 2px rather than 1 is the grace that makes a cling survive the
// single frame where x resolution has already pushed the body clear.
function crWallProbe(level, b) {
    var r0 = Math.floor((b.y + 2) / CR_TILE);
    var r1 = Math.floor((b.y + b.h - 3) / CR_TILE);
    var cl = Math.floor((b.x - 2) / CR_TILE);
    var cr = Math.floor((b.x + b.w + 1) / CR_TILE);
    var left = false, right = false;
    for (var r = r0; r <= r1; r++) {
        if (crSolidForX(crGet(level, cl, r))) left = true;
        if (crSolidForX(crGet(level, cr, r))) right = true;
    }
    if (left && right) return b.face;      // inside a chimney: nearest is whichever you face
    if (left) return -1;
    if (right) return 1;
    return 0;
}

// ===================================================
//   ONE BODY, ONE FIXED STEP
// ===================================================
function crStepBody(level, b, dt) {
    if (!b.alive) return;

    var inp = b.inp;

    // A finished player is parked. It still collides -- that is the spec's own
    // consequence of "your character remains stationary until other players
    // finish or die", and it makes the catwalk a contested place to stand.
    if (b.finished) {
        b.vx = 0; b.vy = 0;
        b.onGround = true;
        return;
    }

    // ---- timers
    if (b.coyote > 0) b.coyote -= dt;
    if (b.buffer > 0) b.buffer -= dt;
    if (b.steerLock > 0) b.steerLock -= dt;
    if (b.dashCool > 0) b.dashCool -= dt;
    if (b.wallGrace > 0) b.wallGrace -= dt;
    if (b.tapTime > 0) b.tapTime -= dt;
    if (b.bounceFlash > 0) b.bounceFlash -= dt;
    if (b.springFlash > 0) b.springFlash -= dt;

    // ---- wall state
    /* THE WALL ASKS FOR NOTHING. You touch it, you cling; you press jump, you
       go up and away from it. No direction to hold, no window to hit, nothing
       to release at the right moment.
     *
     * It was Celeste's wall: hold INTO the wall to slide, jump, then press
     * back to return. That is a precision mechanic from a precision game, and
     * the user's verdict is the right one -- "I wouldn't expect a friend group
     * to get it down". A four-player party platformer cannot have a required
     * move that takes an afternoon to learn, because three of the four people
     * at the keyboard have never played it before.
     *
     * So clinging is automatic whenever you are airborne and falling beside a
     * wall, and the steer lock after a wall jump is short enough that you are
     * back in control almost immediately (CR_PHYS.wallSteerLock). The skill
     * that remains is WHEN, which everyone already has.
     */
    var probe = b.onGround ? 0 : crWallProbe(level, b);
    if (probe !== 0) { b.wallDir = probe; b.wallGrace = CR_PHYS.wallStickGrace; }
    else if (b.wallGrace <= 0) b.wallDir = 0;

    var pressingWall = b.wallDir !== 0 && b.vy > 0;

    // ---- dash
    if (inp.dash && b.dashCool <= 0 && b.dashTime <= 0) {
        b.dashDir = inp.left ? -1 : (inp.right ? 1 : b.face);
        b.dashTime = CR_PHYS.dashTime;
        b.dashCool = CR_PHYS.dashCooldown;
        crSfxDash();
    }
    inp.dash = false;
    if (b.dashTime > 0) b.dashTime -= dt;

    // ---- jump, buffered so a press one frame early still counts
    if (inp.jumpPressed) { b.buffer = crBuffer(); inp.jumpPressed = false; }
    if (b.buffer > 0) {
        if (b.onGround || b.coyote > 0) {
            b.vy = CR_PHYS.jumpVel;
            b.onGround = false;
            b.coyote = 0;
            b.buffer = 0;
            b.jumpsUsed = 1;
            crSfxJump();
        } else if (b.wallDir !== 0) {
            // The Celeste move the spec asks for: away from the wall, with a
            // steer lock short enough (0.12s) that you can press BACK into the
            // same wall before it expires. That is what makes back-and-forth
            // in a chimney possible rather than a single escape jump.
            b.vy = CR_PHYS.wallJumpVy;
            b.vx = -b.wallDir * CR_PHYS.wallJumpVx;
            b.face = -b.wallDir;
            b.steerLock = CR_PHYS.wallSteerLock;
            b.wallDir = 0;
            b.wallGrace = 0;
            b.buffer = 0;
            b.jumpsUsed = 1;
            b.airJumps = 1;     // a wall is contact too: leaving one re-arms you
            crSfxWallJump();
        } else if (b.airJumps > 0) {
            /* EVERYBODY HAS ONE AIR JUMP, ALWAYS, and it comes back the moment
               you touch ground or a wall. It used to be a consumable you had
               to find, which meant the answer to "I mistimed that" was usually
               "you die". An always-available second jump is the single
               largest accessibility win available to a platformer: almost
               every mistake becomes recoverable, and the game gets more
               dynamic rather than more forgiving-looking, because people start
               attempting things.
               The pickup still matters -- it grants an EXTRA stored jump on
               top of this one (b.djCharges), so a chevron is "I can try the
               big route" rather than "I am allowed to jump twice". */
            b.airJumps--;
            b.vy = CR_PHYS.doubleJumpVel;
            b.jumpsUsed = 2;
            b.buffer = 0;
            crSfxDoubleJump();
        } else if (b.djCharges > 0) {
            b.djCharges--;
            b.vy = CR_PHYS.doubleJumpVel;
            b.jumpsUsed = 3;
            b.buffer = 0;
            crSfxDoubleJump();
        }
    }
    // Variable height: letting go clips the arc.
    if (!inp.jump && b.vy < CR_PHYS.jumpVel * CR_PHYS.jumpCutMul) {
        b.vy = CR_PHYS.jumpVel * CR_PHYS.jumpCutMul;
    }

    // ---- bomb
    if (inp.bomb) { crPlaceBomb(level, b); inp.bomb = false; }

    // ---- horizontal intent
    var want = 0;
    if (inp.left) want -= 1;
    if (inp.right) want += 1;
    if (want !== 0) b.face = want;

    if (b.dashTime > 0) {
        b.vx = b.dashDir * CR_PHYS.dashVel;
    } else if (b.steerLock > 0) {
        // The wall-jump impulse owns vx for its lockout; intent is ignored but
        // still recorded in `face`, so the sprite turns when the player does.
    } else {
        var accel = b.onGround ? CR_PHYS.groundAccel : CR_PHYS.airAccel;
        var target = want * CR_PHYS.moveSpeed;
        if (want === 0) {
            var fr = CR_PHYS.friction * dt;
            if (Math.abs(b.vx) <= fr) b.vx = 0; else b.vx -= crSign(b.vx) * fr;
        } else {
            /* MOMENTUM. In the AIR, a body already moving faster than
               moveSpeed in the direction it is asking for is not slowed down.
               Without this, air control brakes a branch spring, a dash and a
               wind tunnel back to walking pace within a tenth of a second --
               CR_PHYS.airAccel is 900 -- and every one of those mechanics
               quietly stops carrying you anywhere. Holding the opposite
               direction still brakes, which is what keeps a spring steerable. */
            var carrying = !b.onGround &&
                           Math.abs(b.vx) > CR_PHYS.moveSpeed &&
                           crSign(b.vx) === want;
            if (!carrying) {
                if (b.vx < target) b.vx = Math.min(target, b.vx + accel * dt);
                else if (b.vx > target) b.vx = Math.max(target, b.vx - accel * dt);
            }
        }
    }
    if (b.vx > CR_PHYS.maxSpeedAir) b.vx = CR_PHYS.maxSpeedAir;
    else if (b.vx < -CR_PHYS.maxSpeedAir) b.vx = -CR_PHYS.maxSpeedAir;

    // ---- gusts. Constant and directional, summed, and at 35% on the ground
    // because a braced runner should be pushed around less than a jumper.
    var gust = crGustAt(level, b.x + b.w / 2, b.y + b.h / 2, b.onGround);
    if (gust.ax !== 0) b.vx += gust.ax * dt;

    // ---- gravity
    var gy = CR_PHYS.gravity;
    if (b.dashTime > 0) gy *= 0.15;
    b.vy += (gy + gust.ay) * dt;

    if (pressingWall && b.vy > CR_PHYS.wallSlide) b.vy = CR_PHYS.wallSlide;
    if (b.vy > CR_PHYS.maxFall) b.vy = CR_PHYS.maxFall;

    // ---- integrate
    crMoveX(level, b, b.vx * dt);
    crMoveY(level, b, b.vy * dt);

    /* THE RIGHT EDGE OF THE SCREEN IS A WALL. The user's call: players cannot
       go past it. With a camera that no longer speeds up for anyone, this is
       what makes the four of you one group -- nobody can bank distance and
       leave the rest to the avalanche, and the gap between first and last can
       never exceed one screen. It is also why the bots stopped being strung
       out across half a level. */
    var edge = crCam.x + CR_VW - b.w;
    if (b.x > edge) { b.x = edge; if (b.vx > 0) b.vx = 0; }

    if (b.y < 0) { b.y = 0; if (b.vy < 0) b.vy = 0; }

    /* GROUND IS PROBED, NOT INFERRED. One probe, every step, and it is the
       single writer of onGround/groundCode/coyote for a body that is not
       rising. It also arms the collapsing blocks, because the fuse is about
       CONTACT rather than about movement -- which is what makes the TIMED kind
       a place you must not loiter, and the instant kind survivable only at a
       run. See the note on CR_EPS. */
    if (b.vy >= 0) {
        var g = crGroundUnder(level, b);
        if (g) {
            b.onGround = true;
            b.groundCode = g.code;
            b.airJumps = 1;
            b.coyote = crCoyote();
            if (g.code === CR_T.CRUMBLE || g.code === CR_T.TIMED) crTouchTile(level, g.col, g.row);
        } else {
            b.onGround = false;
            b.groundCode = CR_T.EMPTY;
        }
    }

    crCollectFor(b);
}

// ===================================================
//   PLAYER VERSUS PLAYER — THE BOUNCY PART
// ===================================================
/*
 * The spec, in its own words: "if I land on top of another player, I should
 * bounce off, If I run into someone same thing. being stationary makes you a
 * wall. if both moving, have physics calc outcome."
 *
 * So there are exactly three cases and they are resolved in that order:
 *
 *   1. HEAD   -- vertical axis, the upper body falling. Upper is launched,
 *                lower is squashed and shoved. Also refreshes the upper
 *                body's jump, which makes a crowded ledge a trampoline and is
 *                left in on purpose.
 *   2. WALL   -- one body is stationary AND grounded (CR_PHYS.stillSpeed).
 *                It does not move. The mover takes the whole reflection.
 *                A FINISHED player on a catwalk is always this case.
 *   3. BOTH   -- equal-mass elastic exchange along the collision normal at
 *                restitution 0.75, penetration split evenly.
 *
 * Resolution is on the axis of LEAST penetration, which is what stops a glancing
 * shoulder-to-shoulder contact from reading as a head-stomp.
 */
function crIsWallBody(b) {
    if (b.finished) return true;
    return b.onGround && Math.abs(b.vx) < CR_PHYS.stillSpeed && Math.abs(b.vy) < CR_PHYS.stillSpeed;
}

function crResolvePairs(level) {
    for (var i = 0; i < crBodies.length; i++) {
        var a = crBodies[i];
        if (!a.alive) continue;
        for (var j = i + 1; j < crBodies.length; j++) {
            var b = crBodies[j];
            if (!b.alive) continue;
            if (!crRectsOverlap(a.x, a.y, a.w, a.h, b.x, b.y, b.w, b.h)) continue;
            crResolveOne(level, a, b);
        }
    }
}

function crResolveOne(level, a, b) {
    var ox = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
    var oy = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
    if (ox <= 0 || oy <= 0) return;

    var aWall = crIsWallBody(a), bWall = crIsWallBody(b);
    if (aWall && bWall) {
        // Two parked bodies. Separate them so they do not vibrate, and stop.
        crSeparate(a, b, ox, oy, 0.5);
        return;
    }

    if (oy < ox) {
        var upper = a.y < b.y ? a : b;
        var lower = upper === a ? b : a;

        if (upper.vy > 20 && !upper.finished) {
            // CASE 1: a head.
            upper.y = lower.y - upper.h;
            upper.vy = CR_PHYS.bounceHead;
            upper.onGround = false;
            upper.jumpsUsed = 0;              // the trampoline, kept deliberately
            upper.bounceFlash = 0.25;
            if (!crIsWallBody(lower)) {
                lower.vy = Math.max(lower.vy, CR_PHYS.bounceSquash);
                lower.vx += crSign(lower.x - upper.x || upper.face) * CR_PHYS.bounceShove * 0.5;
                lower.onGround = false;
            }
            lower.bounceFlash = 0.25;
            crBurst(upper.x + upper.w / 2, lower.y, 5, upper.color);
            crSfxBounce();
            return;
        }
        crAxisBounce(a, b, "y", oy, aWall, bWall);
        return;
    }
    crAxisBounce(a, b, "x", ox, aWall, bWall);
}

function crAxisBounce(a, b, axis, overlap, aWall, bWall) {
    var vk = axis === "x" ? "vx" : "vy";
    var pk = axis;
    var size = axis === "x" ? "w" : "h";
    var dir = (a[pk] < b[pk]) ? -1 : 1;          // which way a must go

    if (aWall || bWall) {
        // CASE 2: one of them is a wall. Only the mover moves, and it keeps
        // restitutionWall of its speed, reversed.
        var mover = aWall ? b : a;
        var wall = aWall ? a : b;
        mover[pk] += (mover === a ? dir : -dir) * overlap;
        var toward = (mover === a ? dir : -dir);
        // Reflect only if it was actually travelling into the wall.
        if (crSign(mover[vk]) === -toward || mover[vk] === 0) {
            mover[vk] = -mover[vk] * CR_PHYS.restitutionWall;
        }
        if (axis === "x" && Math.abs(mover[vk]) < 30) mover[vk] = toward * 40;
        mover.bounceFlash = 0.22;
        wall.bounceFlash = 0.12;
        if (mover.dashTime > 0) mover.dashTime = 0;
        crSfxBounce();
        return;
    }

    // CASE 3: both moving. Equal masses, so an elastic exchange along the
    // normal is just a swap, scaled by restitution.
    crSeparate(a, b, axis === "x" ? overlap : 0, axis === "y" ? overlap : 0, 0.5);
    var e = CR_PHYS.restitutionPair;
    var av = a[vk], bv = b[vk];
    a[vk] = bv * e;
    b[vk] = av * e;
    if (axis === "y") {
        if (a.y < b.y) { a.onGround = false; } else { b.onGround = false; }
    }
    a.bounceFlash = 0.22;
    b.bounceFlash = 0.22;
    crSfxBounce();
    void size;
}

function crSeparate(a, b, ox, oy, share) {
    if (ox > 0 && (oy === 0 || ox <= oy)) {
        var d = (a.x < b.x) ? -1 : 1;
        a.x += d * ox * share;
        b.x -= d * ox * share;
    } else if (oy > 0) {
        var dy = (a.y < b.y) ? -1 : 1;
        a.y += dy * oy * share;
        b.y -= dy * oy * share;
    }
}

// ===================================================
//   DEATH AND FINISH
// ===================================================
// Two ways out, both in the spec, and each needs its own sound because the
// player needs to know which one got them without reading anything.
function crCheckFate(level, b) {
    if (!b.alive || b.finished) return;

    if (b.y > CR_VH + 8) {
        crKill(b, "fall");
        return;
    }
    if (b.x + b.w < crAvalancheX) {
        crKill(b, "avalanche");
        return;
    }

    // "when you touch these platforms (walk on to them) it counts as your
    // finish" -- so it is the tile under your feet, not a trigger box.
    if (b.onGround) {
        var c = Math.floor((b.x + b.w / 2) / CR_TILE);
        var r = Math.floor((b.y + b.h + 1) / CR_TILE);
        if (crIsFinishTile(level, c, r)) crFinishBody(b);
    }
}

function crKill(b, cause) {
    if (!b.alive) return;
    b.alive = false;
    b.deathCause = cause;
    crBurst(b.x + b.w / 2, b.y + b.h / 2, 14, b.color);
    if (cause === "fall") crSfxDeathFall(); else crSfxDeathAvalanche();
    if (b.seat === 0) crLastDeath = cause;
}

/*
 * Walking onto a catwalk. The body parks and becomes a wall (crIsWallBody),
 * which is the spec's own consequence of "your character remains stationary
 * until other players finish or die".
 *
 * IT PARKS FURTHER DOWN THE CATWALK, NOT WHERE IT LANDED, and that is a
 * deadlock fix rather than a flourish. The approach is one body wide, the
 * catwalk begins at level.finishCol, and a finisher stops the instant its feet
 * touch that first tile -- so it comes to rest in the doorway, as a wall, with
 * everyone still running queued up behind it. Measured: whole levels timed out
 * at 150s with three live bots shoving the first finisher and nobody able to
 * get in.
 *
 * So each arrival steps two columns further along than the last. The catwalk is
 * 27 columns of grating; four bodies at that spacing use eight of them.
 */
function crFinishBody(b) {
    if (b.finished) return;
    b.finished = true;
    b.finishedAt = crLevelTime;
    b.vx = 0; b.vy = 0;
    crFinishOrder.push(b.seat);
    var place = crFinishOrder.length;

    if (crLevel) {
        var parkCol = Math.min(crLevel.cols - 4, crLevel.finishCol + 1 + (place - 1) * 2);
        b.x = parkCol * CR_TILE;
    }

    // Place bonus: first out of the level is worth more than last, and the
    // coins are already counted, so this is the only thing order pays for.
    b.score += Math.max(60, 400 - (place - 1) * 90);
    crSfxFinish(place);
}
