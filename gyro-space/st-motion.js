// ===================================================
//   Space Tracer — ship movement, trail, charged beam
// ===================================================
// Split out of space-tracer.html's inline script 2026-09-04 (Pass A of
// gyro-space/ST_PASS_PLAN.md). Lines were MOVED VERBATIM and IN SOURCE ORDER --
// nothing was reordered, because this game's load-time statements are scattered
// through its sections rather than gathered at the end. Keeping the order is
// what makes the split safe.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). camera.x/y hard-follow the ship here -- which is why §4.1 persistence CANNOT replace the trail. See ST_PASS_PLAN.md.
"use strict";

// ===================================================
//                  SHIP MOVEMENT
// ===================================================
function updateShip(dt){
    // Handle respawn
    if (!ship.isAlive) {
        const now = Date.now();
        const timeSinceDeath = now - ship.deathTime;
        
        if (timeSinceDeath >= 2000) {
            // Respawn at origin
            ship.x = 0;
            ship.y = 0;
            ship.angle = 0;
            ship.isAlive = true;
            trail = []; // Clear trail on respawn
            lifeStartTime = Date.now(); // Score clock for this life starts now
            lifeStartX = ship.x;
            lifeStartY = ship.y;

            // Broadcast respawn to other players
            pendingShot = null; // Clear any pending shots
        } else {
            // Dead, don't move
            return;
        }
    }
    
    let desiredAngle;

    // The gyroscope branch that used to sit here (tilt to steer, dash from the
    // on-screen button) was deleted 2026-09-04. controlMode is pinned to
    // "computer", so this is the only branch now -- kept as a conditional
    // rather than flattened, so the shape is still here if mobile returns.
    if(controlMode === "computer"){
        desiredAngle = Math.atan2(mouse.y-centerY, mouse.x-centerX);
        let difference = wrapAngle(desiredAngle-ship.angle);
        ship.angle += difference*0.06;

        if (spaceHeld && !isDashing) {
            dashChargeDuration = Math.min(10, (performance.now() - spaceHoldStartTime) / 1000);
            ship.speed = ship.baseSpeed * 0.6;
        } else if (!isDashing) {
            ship.speed = ship.baseSpeed;
        }

        if (isDashing) {
            dashTimeRemaining -= dt;
            if (dashTimeRemaining <= 0) {
                dashTimeRemaining = 0;
                isDashing = false;
                ship.speed = ship.baseSpeed;
            }
        }
    }

    updateDashMeter();

    if(!paused){
        const prevScoreX = ship.x;
        const prevScoreY = ship.y;
        ship.x += Math.cos(ship.angle) * ship.speed;
        ship.y += Math.sin(ship.angle) * ship.speed;

        // Distance actually moved this frame. Only accrues while alive
        // (this whole block is unreachable while dead -- see the early
        // return in the respawn branch above) and only while unpaused,
        // which is what keeps sitting still or being paused from earning
        // free score, without needing a separate solo-play rule for it.
        if (ship.isAlive) {
            const distThisFrame = Math.hypot(ship.x - prevScoreX, ship.y - prevScoreY);
            accumulateLiveScore(dt, distThisFrame);
            updateScoreDisplay();
        }
    }

    // Check border collision - bounce back and explode if hitting border
    if (isOutOfBounds(ship.x, ship.y) && !isInSafeZone(ship.x, ship.y)) {
        // Only explode if we just crossed the border
        const prevX = ship.x - Math.cos(ship.angle) * ship.speed;
        const prevY = ship.y - Math.sin(ship.angle) * ship.speed;
        
        if (!isOutOfBounds(prevX, prevY)) {
            // Just hit the border - kill player
            createExplosion(ship.x, ship.y, 15);
            onLocalDeath();
        } else {
            // Clamp position to bounds
            const clamped = clampToBounds(ship.x, ship.y);
            ship.x = clamped.x;
            ship.y = clamped.y;
        }
    }

    // Check asteroid collision - kills the player on physical impact
    // (previously asteroids only responded to being shot; this adds the
    // ship-vs-asteroid pair). Respects the safe zone the same way border
    // and bullet death already do. The asteroid is destroyed on impact
    // too -- both die together, matching the visual/mechanical read of
    // "collision," and meaning the same asteroid can't sit there killing
    // multiple players in a row. No score is credited for this,
    // deliberately: crediting points for the same event that just
    // killed you would reward dying, which isn't the intent -- whatever
    // score was already earned this life is still submitted normally via
    // reportLifeEnded() below, same as any other death.
    if (ship.isAlive && !isInSafeZone(ship.x, ship.y)) {
        for (let k = asteroids.length - 1; k >= 0; k--) {
            const a = asteroids[k];
            const dist = Math.hypot(ship.x - a.x, ship.y - a.y);
            if (dist < ship.size + a.size) {
                createExplosion(ship.x, ship.y, 15);
                createExplosion(a.x, a.y, 10, ASTEROID_COLOR);
                asteroids.splice(k, 1);
                spawnAsteroid(); // 1-for-1 respawn, same as destroyAsteroid()
                onLocalDeath();
                break; // Ship can only die once per frame; stop checking further asteroids
            }
        }
    }

    camera.x = ship.x;
    camera.y = ship.y;
}

// ===================================================
//                  UPDATE TRAIL
// ===================================================
let trailAccumulator = 0;

function updateTrail(dt){
    if(paused) return;

    trailAccumulator += dt;
    if(trailAccumulator < 0.03) return;
    trailAccumulator = 0;

    trail.push({
        x: ship.x,
        y: ship.y
    });

    if (trail.length > 1000) {
        trail.shift();
    }
}

// ===================================================
//                  DRAW TRAIL
// ===================================================
// §4.2 BEAM OVERDRAW. The beam saturated the phosphor where it lingered, so
// lines glowed: one wide low-alpha pass in the player's colour, then a narrow
// hot core. Two strokes over a path that was already being built, and cheaper
// than the shadowBlur §4.2 warns about.
//
// This stands in for what §6.1 asked for -- "replace the trail with §4.1
// persistence" -- because that instruction does not work in this game. The
// camera HARD-FOLLOWS the ship (camera.x = ship.x, in updateShip), so the ship
// is pinned to screen centre and the WORLD moves around it. Persistence smears
// whatever moves on screen, so it would streak the starfield, asteroids, border
// and every remote ship, while leaving the one thing that never moves -- the
// local ship -- with no trail at all. The trail is a world-space polyline
// precisely because of that.
function drawTrail(){
    if(trail.length < 2) return;

    ctx.beginPath();
    for(let i=0;i<trail.length;i++){
        const p = trail[i];
        const sx = centerX + (p.x-camera.x);
        const sy = centerY + (p.y-camera.y);

        if(i===0) ctx.moveTo(sx,sy);
        else ctx.lineTo(sx,sy);
    }

    const prevAlpha = ctx.globalAlpha;
    ctx.lineJoin = "round";
    ctx.globalAlpha = 0.22;
    ctx.lineWidth = 5;
    ctx.strokeStyle = ship.color;
    ctx.stroke();

    ctx.globalAlpha = 1;
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = ship.color;
    ctx.stroke();
    ctx.globalAlpha = prevAlpha;
}

// ===================================================
//     CHARGED BEAM: SLIGHT HOMING & SINGLE BOUNCE
// ===================================================
// Both behaviours below apply to `beam` bullets only -- the long-press
// shot. Standard tap shots are unchanged: straight line, no bounce.
//
// Every client simulates its own copy of every beam, including remote
// ones, so two clients' copies of the same beam will curve slightly
// differently. That is fine, and is not a new compromise: collision has
// always been victim-authoritative here (only your own client decides
// that a bullet hit you), so the copy that matters for whether you die
// is the one running on your machine. The same reasoning is why the
// asteroid bounce below is gated to local shots -- asteroid fields are
// deliberately not network-synced.
const BEAM_HOMING_RANGE = 500;        // World units. Beyond this the beam flies straight.
const BEAM_HOMING_TURN_RATE = 0.02;   // Radians per frame (~1.1 deg) -- "slight": it curves, it doesn't chase.
const BEAM_HOMING_CONE = Math.PI / 3; // Only targets within 60 deg of travel, so a beam never wheels around.

// Nearest steerable target for this beam, or null. Ships only --
// asteroids are obstacles to bounce off, not things to home toward.
// Players inside the safe zone are skipped since they can't be hit
// anyway (see the ship collision check below), and homing at someone
// invulnerable would just look broken.
function findBeamHomingTarget(b) {
    const travelAngle = Math.atan2(b.vy, b.vx);
    let bestX = 0, bestY = 0, bestDist = Infinity, found = false;

    function consider(tx, ty) {
        const dx = tx - b.x;
        const dy = ty - b.y;
        const dist = Math.hypot(dx, dy);
        if (dist > BEAM_HOMING_RANGE || dist < 1) return;
        if (Math.abs(wrapAngle(Math.atan2(dy, dx) - travelAngle)) > BEAM_HOMING_CONE) return;
        if (dist < bestDist) {
            bestDist = dist;
            bestX = tx;
            bestY = ty;
            found = true;
        }
    }

    // Our own ship is a candidate only for beams somebody ELSE fired.
    // isLocalShot is the right test rather than comparing ownerId to
    // myPlayerId, since it's set at fire time and doesn't depend on the
    // network handshake having completed.
    if (!b.isLocalShot && ship.isAlive && !isInSafeZone(ship.x, ship.y)) {
        consider(ship.x, ship.y);
    }

    for (const id in remotePlayers) {
        const p = remotePlayers[id];
        if (!p || !p.isAlive) continue;
        if (b.ownerId && id === b.ownerId) continue; // Never home back onto the shooter
        if (isInSafeZone(p.x, p.y)) continue;
        consider(p.x, p.y);
    }

    return found ? { x: bestX, y: bestY } : null;
}

// Steers direction only -- speed is untouched, so homing never turns
// into acceleration.
function applyBeamHoming(b) {
    const target = findBeamHomingTarget(b);
    if (!target) return;

    const speed = Math.hypot(b.vx, b.vy);
    const travelAngle = Math.atan2(b.vy, b.vx);
    const desiredAngle = Math.atan2(target.y - b.y, target.x - b.x);
    const difference = wrapAngle(desiredAngle - travelAngle);
    const turn = Math.max(-BEAM_HOMING_TURN_RATE, Math.min(BEAM_HOMING_TURN_RATE, difference));

    const newAngle = travelAngle + turn;
    b.vx = Math.cos(newAngle) * speed;
    b.vy = Math.sin(newAngle) * speed;
}

// Reflects the beam about a unit normal and spends its single bounce.
function bounceBeam(b, nx, ny) {
    const dot = b.vx * nx + b.vy * ny;
    b.vx -= 2 * dot * nx;
    b.vy -= 2 * dot * ny;
    b.bounced = true;

    // firedAt/maxDistance drive the fade-out, and they measure a STRAIGHT
    // LINE from the fire point -- which stops meaning anything the moment
    // the beam changes direction (a beam heading back toward its origin
    // would see distTraveled shrink and visibly un-fade). Re-base both at
    // the bounce point carrying only the remaining budget, so the beam's
    // total travel distance is preserved rather than reset or inverted.
    const travelled = Math.hypot(b.x - b.firedAt.x, b.y - b.firedAt.y);
    b.maxDistance = Math.max(0, b.maxDistance - travelled);
    b.firedAt.x = b.x;
    b.firedAt.y = b.y;

    createExplosion(b.x, b.y, 5, b.color); // Small spark so the ricochet reads as an impact
}

// ===================================================
