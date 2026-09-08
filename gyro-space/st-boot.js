// ===================================================
//   Space Tracer — keyboard dash, main loop, initial setup
// ===================================================
// Split out of space-tracer.html's inline script 2026-09-04 (Pass A of
// gyro-space/ST_PASS_PLAN.md). Lines were MOVED VERBATIM and IN SOURCE ORDER --
// nothing was reordered, because this game's load-time statements are scattered
// through its sections rather than gathered at the end. Keeping the order is
// what makes the split safe.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). Loads LAST and starts the animation loop.
"use strict";

// ===================================================
//          KEYBOARD CONTROL FOR COMPUTER DASH
// ===================================================
window.addEventListener("keydown", e => {
    if (e.code === "Space" && controlMode === "computer" && !spaceHeld && !e.repeat && ship.isAlive) {
        spaceHeld = true;
        spaceHoldStartTime = performance.now();
    }
});

// The spaceHeld check here is what makes death safe: resetDashState()
// clears it, so a SPACE release that lands after dying falls straight
// through instead of granting a dash on respawn.
window.addEventListener("keyup", e => {
    if (e.code === "Space" && controlMode === "computer" && spaceHeld && ship.isAlive) {
        spaceHeld = false;
        const holdDurationSec = Math.min(10, (performance.now() - spaceHoldStartTime) / 1000);
        if (holdDurationSec > 0.1) {
            dashTimeRemaining = (holdDurationSec / 10) * 5;
            isDashing = true;
            ship.speed = ship.baseSpeed * 3;
        } else {
            ship.speed = ship.baseSpeed;
        }
        dashChargeDuration = 0;
    }
});

// ===================================================
//               MAIN ANIMATION LOOP
// ===================================================
function animate(now){
    requestAnimationFrame(animate);

    const frameStartTime = performance.now();

    const dt = Math.min((now - lastFrame) / 1000, 0.05);
    lastFrame = now;

    fps = lerp(fps, 1 / Math.max(dt, 0.0001), 0.08);

    if(gameStarted){
        updateShip(dt);
        updateAsteroids(dt);
        updateTrail(dt);
        updateBeamChargeAudio();

        // Throttled flush of the live best-score panel -- see the note on
        // SCOREBOARD_RENDER_INTERVAL.
        if (scoreboardDirty && (frameStartTime - lastScoreboardRender) >= SCOREBOARD_RENDER_INTERVAL) {
            updateScoreboardDisplay();
        }

        if (now - lastSendTime >= SEND_INTERVAL) {
            // hasJoinedRoom guards this: the server silently drops "update"
            // messages sent before "join-room", so this isn't strictly
            // required for correctness -- but sending real position data
            // into the void every 100ms before the player has even chosen
            // a room is wasted work, so we skip it explicitly.
            if (hasJoinedRoom) {
                const payload = {
                    t: "pos",
                    x: Number(ship.x.toFixed(1)),
                    y: Number(ship.y.toFixed(1)),
                    angle: Number(ship.angle.toFixed(2)),
                    color: ship.color,
                    isAlive: ship.isAlive,
                    best: bestLifeScore
                };

                if (pendingShot) {
                    payload.shot = pendingShot;
                    pendingShot = null;
                }

                // The two console.logs that used to sit here fired on
                // every one of these, ten times a second, all session.
                MP.send(payload);
            }
            lastSendTime = now;
        }
    }

    drawScene();
    
    frameTime = performance.now() - frameStartTime;
    updateOverlay();
}

// retro.css has certainly parsed by the time this file runs, so the canvas
// palette is read once here rather than per frame.
loadInkFromCss();

requestAnimationFrame(animate);

// ===================================================
//            INITIAL SHIP/TRAIL SETUP
// ===================================================
trail.push({
    x: ship.x,
    y: ship.y
});

// ===================================================
//              INITIAL OVERLAY TEXT
// ===================================================
updateOverlay();
console.log("Gyro Space - Updated");
