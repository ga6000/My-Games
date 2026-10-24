/**
 * Cliff Run — bodies, blocks, items
 * ===================================================
 * Declares only. cr-physics.js moves these; cr-render.js draws them.
 *
 * ONE BODY SHAPE FOR EVERYONE. The human in seat 0 and the bots in seats 1-3
 * are the same struct with the same physics; the only difference is who writes
 * `inp`. That is deliberate and it is what makes the attract-mode demo
 * (RETRO.attract, AESTHETIC_GUIDE.md 4.8) free -- it is the real game with
 * four bot writers instead of three, not a separate code path.
 */
"use strict";

// What a controller -- keyboard or bot -- is allowed to say. Anything not in
// here cannot be expressed, which is what stops a bot from cheating by
// reaching into the body directly.
function crMakeInput() {
    return {
        left: false, right: false, up: false, down: false,
        jump: false,            // held
        jumpPressed: false,     // edge, cleared by the step that consumes it
        grapple: false,         // HELD -- you let go of the key to let go of the rope
        dash: false             // edge
    };
}

function crMakeBody(seat, name, isBot) {
    return {
        seat: seat,
        name: name,
        color: crColorForName(name),
        bot: !!isBot,

        x: 0, y: 0, vx: 0, vy: 0,
        w: CR_PW, h: CR_PH,
        face: 1,

        onGround: false,
        groundCode: CR_T.EMPTY,
        coyote: 0,
        buffer: 0,
        jumpHeld: false,
        jumpsUsed: 0,

        wallDir: 0,             // -1 clinging left wall, +1 right, 0 none
        wallGrace: 0,
        steerLock: 0,

        dashTime: 0,
        dashCool: 0,
        dashDir: 0,
        tapDir: 0,
        tapTime: 0,

        /* NO FREE AIR JUMP. One build gave everybody a second jump that came
           back on contact, which is the standard accessibility move and which
           the user turned down: "I don't think a second jump should stay on."
           Fair -- an always-on double jump makes almost every gap the same
           gap, and this game's gaps are supposed to be the decision. A charge
           now comes only from a jump pad, which is a PLACE, and places can be
           queued for, raced to and taken from under somebody. */
        djCharges: 0,           // air jumps in hand, from a pad
        grapple: null,          // {col, row, x, y, len} while attached
        grappleCool: 0,
        aimAt: null,            // the ring F would take right now; drawn, not simulated
        checkpoint: null,       // {x, y} -- set with Q, respawns you here
        respawnIn: 0,

        coins: 0,
        score: 0,

        alive: true,
        finished: false,
        finishedAt: 0,
        levelsCleared: 0,       // what crDecideWinner ranks on, before score
        deathCause: "",         // "fall" | "avalanche"
        bounceFlash: 0,
        springFlash: 0,

        // Bot scratch. Lives on the body so one bot cannot read another's,
        // and so getState() can show what a bot thinks it is doing.
        ai: null,

        inp: crMakeInput()
    };
}

function crResetBodyForLevel(b, spawn) {
    b.x = spawn.x; b.y = spawn.y;
    b.vx = 0; b.vy = 0;
    b.onGround = false; b.groundCode = CR_T.EMPTY;
    b.coyote = 0; b.buffer = 0; b.jumpHeld = false; b.jumpsUsed = 0;
    b.wallDir = 0; b.wallGrace = 0; b.steerLock = 0;
    b.dashTime = 0; b.dashCool = 0; b.dashDir = 0; b.tapDir = 0; b.tapTime = 0;
    // Charges and bombs do NOT carry between levels. Each level places its own,
    // so carrying them would let a hoarder trivialise a later one.
    b.djCharges = 0;
    b.grapple = null; b.grappleCool = 0; b.aimAt = null;
    b.checkpoint = null; b.respawnIn = 0;
    b.finished = false; b.finishedAt = 0;
    b.bounceFlash = 0; b.springFlash = 0;
    b.face = 1;
    b.inp = crMakeInput();
}

// ===================================================
//   ITEMS
// ===================================================
// Templates live on the level (so a level is reproducible from its seed);
// these are the live copies, rebuilt on every attempt.
function crSpawnLevelItems(level) {
    crCoins.length = 0;
    crPickups.length = 0;
    crFalling.length = 0;
    crParticles.length = 0;

    var i;
    for (i = 0; i < level.coins.length; i++) {
        crCoins.push({ x: level.coins[i].x, y: level.coins[i].y, taken: false, bob: i * 0.7 });
    }
    for (i = 0; i < level.pickups.length; i++) {
        crPickups.push({
            kind: level.pickups[i].kind,
            x: level.pickups[i].x, y: level.pickups[i].y,
            // A bomb is still a one-shot pickup; a jump pad is a fixture that
            // recharges, so `taken` is only ever true for bombs.
            taken: false, ready: true, cool: 0, bob: i * 0.9
        });
    }
}

var CR_COIN_R = 5;
var CR_PICKUP_R = 7;
var CR_COIN_POINTS = 25;

// ===================================================
//   COLLAPSING BLOCKS
// ===================================================
// A touched block becomes an ENTRY HERE and an EMPTY tile in the grid, so the
// collapse is authoritative in one place. Touch state is kept in a Map keyed by
// tile index rather than in the grid, because the grid is a Uint8Array of tile
// CODES and a fuse is not a code.
var crTouched = new Map();      // tileIndex -> seconds remaining on the fuse

function crClearTouched() { crTouched.clear(); }

/*
 * Called by cr-physics.js the moment a body lands on a collapsing tile.
 *
 * CR_CRUMBLE (the "immediately" kind) gets 0.22s, not 0. Zero is unplayable:
 * at 108 px/s you cover 24px in 0.22s, which is a tile and a half, so the run
 * of blocks is crossable at speed and lethal to anyone who stops -- which is
 * what "falls immediately after touching" has to mean for the thing to still
 * be a platform rather than a hole with a picture of a platform on it.
 */
var CR_CRUMBLE_FUSE = 0.22;

function crTouchTile(level, col, row) {
    var code = crGet(level, col, row);
    if (code !== CR_T.CRUMBLE && code !== CR_T.TIMED) return;
    var key = crIdx(level, col, row);
    if (crTouched.has(key)) return;
    crTouched.set(key, code === CR_T.CRUMBLE ? CR_CRUMBLE_FUSE : CR_TIMED_FUSE);
    if (code === CR_T.TIMED) crSfxTick();
    else crSfxCrumble();
}

function crUpdateTouched(level, dt) {
    if (crTouched.size === 0) return;
    var done = null;
    crTouched.forEach(function (left, key) {
        left -= dt;
        if (left <= 0) {
            if (!done) done = [];
            done.push(key);
        } else {
            crTouched.set(key, left);
        }
    });
    if (!done) return;
    for (var i = 0; i < done.length; i++) {
        var key = done[i];
        var row = Math.floor(key / level.cols);
        var col = key - row * level.cols;
        var code = crGet(level, col, row);
        crTouched.delete(key);
        if (code !== CR_T.CRUMBLE && code !== CR_T.TIMED) continue;
        crSet(level, col, row, CR_T.EMPTY);
        // The block itself falls away off the cliff. Deliberately NOT solid
        // and deliberately harmless: with four players on a cliff of crumbling
        // ledges, blocks dropped by someone above would be unavoidable deaths
        // nobody could read, and the sound plus the hole are already the
        // information the player needs.
        crFalling.push({ x: col * CR_TILE, y: row * CR_TILE, vy: 20, code: code, spin: 0 });
        crSfxCollapse();
    }
}

function crUpdateFalling(dt) {
    for (var i = crFalling.length - 1; i >= 0; i--) {
        var f = crFalling[i];
        f.vy += CR_PHYS.gravity * dt;
        f.y += f.vy * dt;
        f.spin += dt * 4;
        if (f.y > (crLevel ? crLevel.rows * CR_TILE : CR_VH) + 40) crFalling.splice(i, 1);
    }
}

// ===================================================
//   PARTICLES
// ===================================================
// Capped. A raster cabinet draws blocks, and an unbounded particle list is the
// one way a tile game finds a frame budget problem.
var CR_PARTICLE_CAP = 160;

function crBurst(x, y, n, color) {
    for (var i = 0; i < n; i++) {
        if (crParticles.length >= CR_PARTICLE_CAP) return;
        crParticles.push({
            x: x, y: y,
            vx: (Math.random() - 0.5) * 150,
            vy: (Math.random() - 0.7) * 150,
            life: 0.25 + Math.random() * 0.4,
            color: color || CR_INK.mid
        });
    }
}

// Pads coming back. The only thing on the cliff that gets BETTER with time,
// which is what makes waiting at one a real decision against the avalanche.
function crUpdatePads(dt) {
    for (var i = 0; i < crPickups.length; i++) {
        var pk = crPickups[i];
        if (pk.ready || pk.taken) continue;
        pk.cool -= dt;
        if (pk.cool <= 0) { pk.ready = true; crSfxPadReady(); }
    }
}

function crUpdateParticles(dt) {
    for (var i = crParticles.length - 1; i >= 0; i--) {
        var p = crParticles[i];
        p.life -= dt;
        if (p.life <= 0) { crParticles.splice(i, 1); continue; }
        p.vy += CR_PHYS.gravity * 0.5 * dt;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
    }
}

// ===================================================
//   PICKUP / COIN COLLECTION
// ===================================================
function crCollectFor(b) {
    var cx = b.x + b.w / 2, cy = b.y + b.h / 2;
    var i;
    for (i = 0; i < crCoins.length; i++) {
        var c = crCoins[i];
        if (c.taken) continue;
        if (Math.abs(c.x - cx) > CR_COIN_R + b.w / 2) continue;
        if (Math.abs(c.y - cy) > CR_COIN_R + b.h / 2) continue;
        c.taken = true;
        b.coins++;
        b.score += CR_COIN_POINTS;
        crBurst(c.x, c.y, 4, CR_INK.amber);
        crSfxCoin();
    }
    for (i = 0; i < crPickups.length; i++) {
        var pk = crPickups[i];
        if (pk.taken || !pk.ready) continue;
        if (Math.abs(pk.x - cx) > CR_PICKUP_R + b.w / 2) continue;
        if (Math.abs(pk.y - cy) > CR_PICKUP_R + b.h / 2) continue;
        if (pk.kind === "dj") {
            if (b.djCharges >= 2) continue;        // full hands, leave it lit
            b.djCharges++;
            pk.ready = false;                      // the pad goes dark and recharges
            pk.cool = CR_PAD_RECHARGE;
        }
        crBurst(pk.x, pk.y, 6, CR_INK.cyan);
        crSfxPickup();
    }
}
