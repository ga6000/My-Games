// ===================================================
//   Space Tracer — coordinate transform, ship, rings, dev overlay
// ===================================================
// Split out of space-tracer.html's inline script 2026-09-04 (Pass A of
// gyro-space/ST_PASS_PLAN.md). Lines were MOVED VERBATIM and IN SOURCE ORDER --
// nothing was reordered, because this game's load-time statements are scattered
// through its sections rather than gathered at the end. Keeping the order is
// what makes the split safe.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). drawShip() is the VECTOR conversion -- unfilled stroked triangle plus vertex bloom.
"use strict";

// ===================================================
//           COORDINATE TRANSFORMATION
// ===================================================
function worldToScreen(worldX, worldY) {
    const relX = worldX - camera.x;
    const relY = worldY - camera.y;
    return {
        x: centerX + (relX * camera.zoom),
        y: centerY + (relY * camera.zoom)
    };
}

// ===================================================
//              DRAW SHIP (VECTOR)
// ===================================================
// Was a filled silhouette; §6.1 makes it a stroked outline with vertex bloom.
// The hull points are unchanged, so the shape a player recognises is identical
// -- only fill became stroke. The geometry now lives in SHIP_HULL (st-core.js),
// shared with the remote ships, which used to carry their own copy of it.
function drawShip(){
    if (!ship.isAlive) return; // Don't draw if dead

    ctx.save();
    ctx.translate(centerX, centerY);
    ctx.scale(camera.zoom, camera.zoom);
    ctx.rotate(ship.angle);
    strokeHull(ship.size, ship.color);
    ctx.restore();

    // Draw player name above ship
    if (ship.name) {
        ctx.save();
        ctx.fillStyle = ship.color;
        ctx.font = "12px " + INK.uiFont;
        ctx.textAlign = "center";
        ctx.fillText(ship.name, centerX, centerY - 35);
        ctx.restore();
    }
}

// ===================================================
//   DRAW CHARGE-UP & BEAM COOLDOWN RINGS
// ===================================================
function drawCooldownRing() {
    const now = Date.now();
    
    // 1. Draw Charge-Up Animation (Inverse white expanding arc)
    // Only show if held for at least MIN_CHARGE_TIME and cooldown is complete
    if (isChargingBeam && now >= beamCooldownEnd) {
        const chargeTime = Math.max(0, now - beamChargeStartTime - MIN_CHARGE_TIME);
        const maxChargeTime = 3000 - MIN_CHARGE_TIME;
        const chargeProgress = Math.min(1, chargeTime / maxChargeTime);
        
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.strokeStyle = `rgba(255, 255, 255, ${0.3 + chargeProgress * 0.7})`;
        ctx.lineWidth = 2 + chargeProgress * 3;
        ctx.beginPath();
        // Inverse animation: expands from center outward
        const startAngle = -Math.PI / 2 - Math.PI * chargeProgress;
        const endAngle = -Math.PI / 2 + Math.PI * chargeProgress;
        ctx.arc(0, 0, 25 + chargeProgress * 20, startAngle, endAngle);
        ctx.stroke();
        ctx.restore();
    }

    // 2. Cooldown Ring After Beam Shot (red, fills clockwise)
    if (now < beamCooldownEnd) {
        const remainingMs = beamCooldownEnd - now;
        const progress = 1 - (remainingMs / 5000);
        
        ctx.save();
        ctx.translate(centerX, centerY);
        ctx.scale(camera.zoom, camera.zoom);
        ctx.strokeStyle = "rgba(255, 100, 100, 0.6)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, 0, 35, -Math.PI / 2, -Math.PI / 2 + (Math.PI * 2 * progress));
        ctx.stroke();
        ctx.restore();
    }
}

// ===================================================
//              DRAW DEBUG INFORMATION
// ===================================================
function updateOverlay(){
    const now = Date.now();
    const beamCooldownRemaining = Math.max(0, Math.ceil((beamCooldownEnd - now) / 1000));
    
    let dashInfo;
    if (isDashing) {
        dashInfo = `Dash ACTIVE: ${dashTimeRemaining.toFixed(1)}s (3x Speed)`;
    } else if (spaceHeld) {
        dashInfo = `Dash Charging: ${dashChargeDuration.toFixed(1)}s (-40% Speed Penalty)`;
    } else {
        dashInfo = `Dash Ready (Hold SPACE)`;
    }
    
    statusText.innerHTML =
`PLAYER: ${ship.name || "Anonymous"}<br>
ROOM: ${currentRoomCode || "(not joined)"}<br>
SCORE: ${Math.round(lifeScore)} | BEST: ${bestLifeScore}<br>
STREAK: ${lifeKillStreak} (${currentMultiplier().toFixed(1)}x)<br>
FPS: ${fps.toFixed(0)} | ${frameTime.toFixed(1)}ms<br>
Pos: X: ${Math.round(ship.x)} | Y: ${Math.round(ship.y)}<br>
${dashInfo}<br>
Bullets: ${bullets.length}/${MAX_BULLETS}<br>
Pool: ${bulletPool.length}<br>
Grid Cells: ${Object.keys(grid).length}<br>
Beam Cooldown: ${beamCooldownRemaining}s<br>
Players Online: ${Object.keys(remotePlayers).length + 1}`;
}

let pendingShot = null;

