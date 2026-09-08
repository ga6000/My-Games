// ===================================================
//   Space Tracer — bullets, music, starfield, remote ships, border, drawScene
// ===================================================
// Split out of space-tracer.html's inline script 2026-09-04 (Pass A of
// gyro-space/ST_PASS_PLAN.md). Lines were MOVED VERBATIM and IN SOURCE ORDER --
// nothing was reordered, because this game's load-time statements are scattered
// through its sections rather than gathered at the end. Keeping the order is
// what makes the split safe.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). drawScene() clears to black every frame. Do not swap that for persistence.
"use strict";

// ===================================================
//            BATCH RENDER BULLETS BY TYPE
// ===================================================
function updateAndDrawBullets() {
    const visibleCells = getVisibleGridCells();
    
    const standardBullets = [];
    const beamBullets = [];

    for (let i = bullets.length - 1; i >= 0; i--) {
        const b = bullets[i];

        // Steer before stepping, so this frame's movement already reflects
        // the turn rather than lagging a frame behind it.
        if (b.type === "beam") {
            applyBeamHoming(b);
        }

        // Pre-step position. The safe-zone bounce needs it to tell an
        // INWARD crossing from a beam that was already inside.
        const prevX = b.x;
        const prevY = b.y;

        b.x += b.vx;
        b.y += b.vy;
        b.life--;

        // Check collision with world border (only if bullet still visible)
        if (isOutOfBounds(b.x, b.y)) {
            if (b.type === "beam" && !b.bounced) {
                // Charged beam gets exactly one ricochet off the border.
                // Pull it back onto the wall first so the reflected beam
                // starts inside the play area instead of outside it.
                let nx = 0, ny = 0;
                if (b.x < WORLD_BOUNDS.min) { nx = 1; b.x = WORLD_BOUNDS.min; }
                else if (b.x > WORLD_BOUNDS.max) { nx = -1; b.x = WORLD_BOUNDS.max; }
                if (b.y < WORLD_BOUNDS.min) { ny = 1; b.y = WORLD_BOUNDS.min; }
                else if (b.y > WORLD_BOUNDS.max) { ny = -1; b.y = WORLD_BOUNDS.max; }

                // Corner hit: both axes are out, so the normal is the
                // diagonal. Normalising it means reflecting about that
                // diagonal (which reverses the beam) rather than applying
                // two full-strength reflections.
                const len = Math.hypot(nx, ny) || 1;
                bounceBeam(b, nx / len, ny / len);
            } else {
                // Everything else -- and a beam that has already spent its
                // bounce -- dies at the border exactly as before.
                // Only explode if bullet hasn't faded out yet
                const distTraveled = Math.hypot(b.x - b.firedAt.x, b.y - b.firedAt.y);
                let opacity = 1.0;
                if (distTraveled > b.maxDistance) {
                    opacity = Math.max(0, 1 - (distTraveled - b.maxDistance) / 100);
                }

                // Only create explosion if bullet is still visible
                if (opacity > 0) {
                    createExplosion(b.x, b.y, 8);
                }

                removeFromGrid(b.gridKey, b);
                bulletPool.push(b);
                bullets.splice(i, 1);
                continue;
            }
        }

        // Safe zone behaves as a solid shell for charged beams: one
        // ricochet off its surface, and after that beams pass through it
        // as they always have (players inside are immune regardless --
        // the ship collision check below exempts them). Gating on an
        // inward crossing means a beam fired from INSIDE the safe zone
        // still leaves normally instead of being bounced back in.
        if (b.type === "beam" && !b.bounced &&
            isInSafeZone(b.x, b.y) && !isInSafeZone(prevX, prevY)) {
            let nx = b.x - SAFE_ZONE.x;
            let ny = b.y - SAFE_ZONE.y;
            const len = Math.hypot(nx, ny) || 1;
            nx /= len;
            ny /= len;

            // Sit it back on the shell before reflecting, so the next
            // frame doesn't start inside the zone.
            b.x = SAFE_ZONE.x + nx * (SAFE_ZONE.radius + 1);
            b.y = SAFE_ZONE.y + ny * (SAFE_ZONE.radius + 1);
            bounceBeam(b, nx, ny);
        }

        // Check collision with player ship (only from remote shots, not in safe zone)
        if (ship.isAlive && !b.isLocalShot && !isInSafeZone(ship.x, ship.y)) {
            const dist = Math.hypot(b.x - ship.x, b.y - ship.y);
            if (dist < ship.size + b.size) {
                // Hit! Create explosion and kill player
                createExplosion(ship.x, ship.y, 15);

                // Tell the server who shot us, so it can relay kill
                // credit to THAT player's client. This only fires when
                // the bullet actually carries an owner (b.ownerId is set
                // for remote shots via fireLaser's ownerId param -- see
                // where remote shots are spawned in updateRemotePlayer).
                // If ownerId is somehow missing, we just skip crediting
                // rather than guessing -- a death should never crash the
                // game over an incomplete kill-credit message.
                if (b.ownerId && hasJoinedRoom) {
                    MP.send({ t: "kill", shooterId: b.ownerId, killType: "player" });
                }

                // Sent BEFORE onLocalDeath() because onLocalDeath ->
                // reportLifeEnded() resets the per-life counters; the kill
                // relay above carries no score, but keeping the ordering
                // explicit here matches the order the two messages should
                // reach the room in.
                onLocalDeath();
                
                removeFromGrid(b.gridKey, b);
                bulletPool.push(b);
                bullets.splice(i, 1);
                continue;
            }
        }

        // Check collision with asteroids. Gated to isLocalShot only --
        // per the design note on the asteroid system above, each
        // client's asteroid field is simulated independently and not
        // network-synced, so a REMOTE player's bullet passing through
        // "my" asteroid shouldn't destroy it or credit anyone on my
        // client; only my own bullets interact with my own asteroid field.
        let bulletConsumedByAsteroid = false;
        if (b.isLocalShot) {
            for (let j = asteroids.length - 1; j >= 0; j--) {
                const a = asteroids[j];
                const dist = Math.hypot(b.x - a.x, b.y - a.y);
                if (dist < a.size + b.size) {
                    // Captured before destroyAsteroid() splices it out of
                    // the array -- the bounce normal is measured from
                    // where the asteroid was at the moment of impact.
                    const impactX = a.x, impactY = a.y, impactSize = a.size;
                    destroyAsteroid(j);

                    if (b.type === "beam" && !b.bounced) {
                        // A charged beam smashes the asteroid AND deflects
                        // off the impact, spending its one bounce, rather
                        // than being consumed by it. Scoring is unchanged:
                        // destroyAsteroid() above already credited the kill
                        // exactly as it does for a standard shot.
                        let nx = b.x - impactX;
                        let ny = b.y - impactY;
                        const len = Math.hypot(nx, ny) || 1;
                        nx /= len;
                        ny /= len;
                        b.x = impactX + nx * (impactSize + b.size + 1);
                        b.y = impactY + ny * (impactSize + b.size + 1);
                        bounceBeam(b, nx, ny);
                        break; // Bullet survives -- stop checking asteroids this frame
                    }

                    removeFromGrid(b.gridKey, b);
                    bulletPool.push(b);
                    bullets.splice(i, 1);
                    bulletConsumedByAsteroid = true;
                    break; // Stop checking other asteroids -- this bullet is now consumed
                }
            }
        }
        if (bulletConsumedByAsteroid) continue;

        if (b.life <= 0) {
            removeFromGrid(b.gridKey, b);
            bulletPool.push(b);
            bullets.splice(i, 1);
            continue;
        }

        const newGridKey = getGridKey(b.x, b.y);
        if (newGridKey !== b.gridKey) {
            removeFromGrid(b.gridKey, b);
            b.gridKey = newGridKey;
            addToGrid(newGridKey, b);
        }

        if (b.type === "beam") {
            beamBullets.push(b);
        } else {
            standardBullets.push(b);
        }
    }

    if (standardBullets.length > 0) {
        renderBulletBatch(standardBullets, false);
    }

    if (beamBullets.length > 0) {
        renderBulletBatch(beamBullets, true);
    }
}

function renderBulletBatch(bulletArray, isBeam) {
    const byColor = {};
    
    for (const b of bulletArray) {
        if (!byColor[b.color]) {
            byColor[b.color] = [];
        }
        byColor[b.color].push(b);
    }

    for (const color in byColor) {
        const bullets = byColor[color];
        ctx.fillStyle = color;

        for (const b of bullets) {
            const distTraveled = Math.hypot(b.x - b.firedAt.x, b.y - b.firedAt.y);
            
            let opacity = 1.0;
            if (distTraveled > b.maxDistance) {
                opacity = Math.max(0, 1 - (distTraveled - b.maxDistance) / 100);
            }

            const sx = centerX + (b.x - camera.x);
            const sy = centerY + (b.y - camera.y);

            if (sx < -50 || sx > width + 50 || sy < -50 || sy > height + 50) {
                continue;
            }

            ctx.globalAlpha = opacity;
            ctx.beginPath();
            ctx.arc(sx, sy, b.size, 0, Math.PI * 2);
            ctx.fill();
        }
    }

    ctx.globalAlpha = 1.0;
}
    
// ===================================================
//             AUTOMATIC BACKGROUND MUSIC
// ===================================================
const bgMusic = new Audio("Gyro Music.mp3");
bgMusic.volume = 0.3;
bgMusic.loop = true;

function startAudio() {
    if (!audioEnabled) return;
    bgMusic.play().then(() => {
        window.removeEventListener("click", startAudio);
    }).catch(() => {});
}

window.addEventListener("click", startAudio);
    
// ===================================================
//                  DRAW STARFIELD
// ===================================================
function drawStars(){
    // Structure, never information -- so the stars take the mid phosphor
    // rather than pure white, which §2.2 reserves for what you should look at.
    ctx.fillStyle=INK.mid;

    for(let i=0; i<STAR_COUNT; i++){
        const star = stars[i];
        const sx = centerX + (star.x - camera.x*0.05);
        const sy = centerY + (star.y - camera.y*0.05);

        if(sx<0 || sy<0 || sx>width || sy>height) continue;

        ctx.beginPath();
        ctx.arc(sx, sy, star.size, 0, Math.PI*2);
        ctx.fill();
    }
}

// ===================================================
//            DRAW OTHER MULTIPLAYER SHIPS & TRAILS
// ===================================================
function drawRemotePlayers(){
    for (const id in remotePlayers) {
        const p = remotePlayers[id];

        // Skip dead players
        if (!p.isAlive) {
            continue;
        }

        if (p.targetX !== undefined) {
            p.x = lerp(p.x, p.targetX, 0.2);
            p.y = lerp(p.y, p.targetY, 0.2);
        }

        if (p.trail && p.trail.length > 1) {
            ctx.beginPath();
            for (let i = 0; i < p.trail.length; i++) {
                const pt = p.trail[i];
                const tsx = centerX + (pt.x - camera.x);
                const tsy = centerY + (pt.y - camera.y);
                if (i === 0) ctx.moveTo(tsx, tsy);
                else ctx.lineTo(tsx, tsy);
            }
            const prevA = ctx.globalAlpha;
            ctx.lineJoin = "round";
            ctx.globalAlpha = 0.22; ctx.lineWidth = 5;   ctx.strokeStyle = p.color; ctx.stroke();
            ctx.globalAlpha = 1;    ctx.lineWidth = 1.5; ctx.strokeStyle = p.color; ctx.stroke();
            ctx.globalAlpha = prevA;
        }

        const sx = centerX + (p.x - camera.x);
        const sy = centerY + (p.y - camera.y);

        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(p.angle);

        // p.color is the colour THE SERVER assigned this player. §5 lists
        // server-authoritative MP.selfColor as untouchable for this game, so
        // nothing here recomputes it -- strokeHull only strokes what it is handed.
        strokeHull(ship.size, p.color);
        ctx.restore();
        
        // Draw remote player name above ship
        if (p.name) {
            ctx.save();
            ctx.fillStyle = p.color;
            ctx.font = "12px Arial";
            ctx.textAlign = "center";
            ctx.fillText(p.name, sx, sy - 35);
            ctx.restore();
        }
    }
}

// ===================================================
//          DRAW WORLD BORDER & SAFE ZONE
// ===================================================
function drawWorldBorder() {
    const outerX = centerX + (WORLD_BOUNDS.min - camera.x);
    const outerY = centerY + (WORLD_BOUNDS.min - camera.y);
    const outerSize = (WORLD_BOUNDS.max - WORLD_BOUNDS.min);
    
    // Draw solid white border on OUTSIDE edge (flipped direction)
    const outerMin = WORLD_BOUNDS.min - WORLD_BOUNDS.borderThickness;
    const outerMax = WORLD_BOUNDS.max + WORLD_BOUNDS.borderThickness;
    
    const borderX = centerX + (outerMin - camera.x);
    const borderY = centerY + (outerMin - camera.y);
    const borderSize = outerMax - outerMin;
    
    // The border KILLS you on contact, so it is danger, not chrome (§2.2).
    ctx.fillStyle = INK.magenta;
    
    // Top border (outside)
    ctx.fillRect(borderX, borderY, borderSize, WORLD_BOUNDS.borderThickness);
    
    // Bottom border (outside)
    ctx.fillRect(borderX, borderY + borderSize - WORLD_BOUNDS.borderThickness, borderSize, WORLD_BOUNDS.borderThickness);
    
    // Left border (outside)
    ctx.fillRect(borderX, borderY, WORLD_BOUNDS.borderThickness, borderSize);
    
    // Right border (outside)
    ctx.fillRect(borderX + borderSize - WORLD_BOUNDS.borderThickness, borderY, WORLD_BOUNDS.borderThickness, borderSize);
}

function drawSafeZone() {
    const sx = centerX + (SAFE_ZONE.x - camera.x);
    const sy = centerY + (SAFE_ZONE.y - camera.y);
    
    // Draw safe zone circle with 20% opaque white fill
    // Literally "safe / navigable", which is what --sig-cyan means (§2.2).
    ctx.fillStyle = "rgba(0, 229, 255, 0.16)";
    ctx.beginPath();
    ctx.arc(sx, sy, SAFE_ZONE.radius, 0, Math.PI * 2);
    ctx.fill();
    
    // Draw circle outline
    ctx.strokeStyle = "rgba(0, 229, 255, 0.65)";
    ctx.lineWidth = 2;
    ctx.stroke();
}

// ===================================================
//               DRAW ENTIRE SCENE
// ===================================================
function drawScene(){
    ctx.fillStyle="black";
    ctx.fillRect(0, 0, width, height);

    drawStars();
    drawWorldBorder();     // Draw world border
    drawSafeZone();        // Draw safe zone
    drawAsteroids();       // Background hazard layer, before trails/ships/bullets
    drawTrail();           // Draw trail first (behind)
    drawRemotePlayers();   // Draw remote players on top of trail
    drawCooldownRing();
    drawShip();            // Draw your ship on top
    updateAndDrawBullets();
    updateAndDrawExplosions(); // Draw explosions on top of everything
}

