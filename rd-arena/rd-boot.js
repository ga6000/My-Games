// ===================================================
//   RD Arena -- the main loop and boot
// ===================================================
// Split out of RDArena.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 3). Lines 2124-2484 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, so every load-time statement
// still runs in the sequence it did as one file. The only change is that the
// four-space indent the whole script carried inside <script> was removed;
// there are no multi-line template literals, so that is whitespace-only.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint).
"use strict";

// ============================================================
// Main loop
// ============================================================
function loop() {
    if (!running) return;
    frameCount++;

    // The world never stops now -- only the choosing player does.
    const selecting = !!cardOffer;

    updateRD();
    updateSprays();

    flowTimer--;
    if (flowTimer <= 0) { flowTimer = 15; rebuildFlowField(); }

    cameraX = player.x - canvas.width / 2;
    cameraY = player.y - canvas.height / 2;
    cameraX = Math.max(0, Math.min(worldWidth - canvas.width, cameraX));
    cameraY = Math.max(0, Math.min(worldHeight - canvas.height, cameraY));

    if (screenShake > 0) {
        cameraX += (Math.random() - 0.5) * screenShake * 2;
        cameraY += (Math.random() - 0.5) * screenShake * 2;
        screenShake *= 0.85;
        if (screenShake < 0.5) screenShake = 0;
    }

    mouse.x = mouse.screenX + cameraX;
    mouse.y = mouse.screenY + cameraY;

    // AESTHETIC_GUIDE.md 2.1 -- pure black, not #050505. A cabinet's black is
    // the absence of beam; there is no backlight to leak.
    ctx.fillStyle = RDSKIN.ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    ctx.save();
    ctx.translate(-cameraX, -cameraY);

    // Squelching pulsing floor
    let time = Date.now() * 0.002;
    let bgSize = 120;
    let startX = Math.max(0, Math.floor(cameraX / bgSize) * bgSize);
    let startY = Math.max(0, Math.floor(cameraY / bgSize) * bgSize);
    for (let x = startX; x < cameraX + canvas.width + bgSize; x += bgSize) {
        for (let y = startY; y < cameraY + canvas.height + bgSize; y += bgSize) {
            // Was an overlapping soft disc. On a RASTER cabinet the same pulse
            // is carried by CELLS: identical maths, the radius term now sizing a
            // square instead of a circle, so the floor still breathes -- it just
            // breathes in pixels. Same move 6.4 endorses for the flesh below.
            let r = (bgSize * 0.5) + Math.sin(x * 0.01 + y * 0.02 + time) * (bgSize * 0.3);
            let col = 10 + Math.sin(time + x * 0.05) * 8;
            ctx.fillStyle = 'rgb(' + col + ',' + col + ',' + (col + 2) + ')';
            ctx.fillRect(x - r, y - r, r * 2, r * 2);
        }
    }

    // Blood layer (half-res, scaled up)
    ctx.drawImage(bloodCanvas, 0, 0, worldWidth, worldHeight);

    // Blood particles carve flesh as they fly
    {
        for (let i = bloodParticles.length - 1; i >= 0; i--) {
            let p = bloodParticles[i];
            p.lastX = p.x; p.lastY = p.y;
            p.x += p.vx; p.y += p.vy;
            p.vx *= p.friction; p.vy *= p.friction;
            p.size *= 0.96;

            // Blood is cosmetic unless the cast bought CORROSION.
            if (p.carve > 0) {
                let r = Math.max(1, Math.ceil(p.carve / cellSize));
                let gx = Math.floor(p.x / cellSize);
                let gy = Math.floor(p.y / cellSize);
                for (let cx = gx - r; cx <= gx + r; cx++) {
                    for (let cy = gy - r; cy <= gy + r; cy++) {
                        if (cx >= 0 && cx < gridCols && cy >= 0 && cy < gridRows) {
                            let idx = cx + cy * gridCols;
                            if (staticMask[idx]) continue;
                            if (gridB[idx] > 0.3) spawnWallExplosion(cx * cellSize, cy * cellSize);
                            gridB[idx] = 0;
                            gridA[idx] = 1;
                        }
                    }
                }
            }

            bloodCtx.strokeStyle = p.color;
            bloodCtx.lineWidth = p.size * 2 * bloodScale;
            bloodCtx.lineCap = 'round';
            bloodCtx.beginPath();
            bloodCtx.moveTo(p.lastX * bloodScale, p.lastY * bloodScale);
            bloodCtx.lineTo(p.x * bloodScale, p.y * bloodScale);
            bloodCtx.stroke();

            if (p.size < 0.5 || Math.hypot(p.vx, p.vy) < 0.5) bloodParticles.splice(i, 1);
        }
    }

    // Flesh. AESTHETIC_GUIDE.md 6.4, and the cheapest win in the repo.
    //
    // This used to draw one arc of radius cellSize * 0.78 per solid cell, so
    // overlapping discs merged into rounded organic edges. It is now one
    // fillRect per cell, which is EXACT PERIOD RENDERING -- the fleshscape
    // becomes a chunky monochrome pixel grid, which is what a 1978 raster
    // cabinet could actually put on a tube -- and it is FASTER, because a rect
    // fill beats an arc path.
    //
    // THE SIMULATION IS UNTOUCHED, and that is the whole point. 5 lists
    // dA/dB/feed/k, the 400x400 grid, the >0.3 threshold, the flow field and the
    // motes as untouchable: this game IS its reaction-diffusion field. Collision,
    // LOS and the flow field still read gridB exactly as before, so nothing a
    // future multiplayer bitmask would have to agree on has moved.
    //
    // The second band (> HOT_BAND) is 6.4's two-tone sprite look. Two passes
    // rather than one loop with a changing fillStyle, so each tone sets the fill
    // once instead of once per cell.
    let gridStartX = Math.max(0, Math.floor(cameraX / cellSize));
    let gridStartY = Math.max(0, Math.floor(cameraY / cellSize));
    let gridEndX = Math.min(gridCols, Math.ceil((cameraX + canvas.width) / cellSize));
    let gridEndY = Math.min(gridRows, Math.ceil((cameraY + canvas.height) / cellSize));

    ctx.fillStyle = RDSKIN.fleshCold;
    for (let x = gridStartX; x < gridEndX; x++) {
        for (let y = gridStartY; y < gridEndY; y++) {
            const b = gridB[x + y * gridCols];
            if (b > 0.3 && b <= RDSKIN.HOT_BAND) ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
    }
    ctx.fillStyle = RDSKIN.fleshHot;
    for (let x = gridStartX; x < gridEndX; x++) {
        for (let y = gridStartY; y < gridEndY; y++) {
            if (gridB[x + y * gridCols] > RDSKIN.HOT_BAND) ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize);
        }
    }

    drawSanctuaries();
    drawOrgans();

    // Shockwaves + their physics
    const allEntities = [player].concat(enemies);
    for (let i = shockwaves.length - 1; i >= 0; i--) {
        let s = shockwaves[i];
        s.radius += s.speed;
        s.alpha = 1 - (s.radius / s.maxRadius);
        if (s.alpha <= 0) { shockwaves.splice(i, 1); continue; }

        if (!s.isDash) {
            for (let ent of allEntities) {
                if (ent.dead || s.hitList.has(ent)) continue;
                if (ent.isPlayer && selecting) continue;   // bubble eats the wave
                let ddx = ent.x - s.x;
                let ddy = ent.y - s.y;
                let dist = Math.hypot(ddx, ddy);
                if (dist <= s.radius) {
                    let angleToEnt = Math.atan2(ddy, ddx);
                    let angleDiff = Math.abs(Math.atan2(Math.sin(angleToEnt - s.angle), Math.cos(angleToEnt - s.angle)));
                    if (angleDiff <= s.spread) {
                        // Cover stops the wave until OSMOSIS. Not added to hitList,
                        // so stepping out of cover still exposes them to it.
                        if (s.needsLOS && !hasLOS(s.x, s.y, ent.x, ent.y)) continue;
                        s.hitList.add(ent);
                        // One body per wave until SATURATION.
                        let lethal = dist < s.maxRadius * s.lethalFrac;
                        if (lethal && s.stopAtFirst && s.killCount >= 1) lethal = false;
                        if (lethal) {
                            let wasEnemy = !ent.isPlayer;
                            ent.hit(99, angleToEnt);
                            if (wasEnemy && ent.dead) {
                                s.killCount++;
                                // Aftershock: the first kill spits the grenade along the shot vector.
                                if (s.fromPlayer && build.splatter.fork === 'aftershock' && !s.grenadeSpent) {
                                    s.grenadeSpent = true;
                                    grenades.push({
                                        x: s.x, y: s.y,
                                        vx: Math.cos(s.angle) * 9, vy: Math.sin(s.angle) * 9,
                                        t: 30, spin: 0
                                    });
                                }
                            }
                        } else {
                            ent.isKnockedBack = true;
                            ent.knockbackDir = angleToEnt;
                        }
                    }
                }
            }
        }

        ctx.beginPath();
        ctx.arc(s.x, s.y, s.radius, s.angle - s.spread, s.angle + s.spread);
        ctx.strokeStyle = 'rgba(0, 191, 255, ' + s.alpha + ')';
        ctx.lineWidth = s.isDash ? 4 : 8;
        ctx.lineCap = 'round';
        ctx.stroke();
    }

    // Grenades (Aftershock)
    for (let i = grenades.length - 1; i >= 0; i--) {
        let g = grenades[i];
        {
            g.x += g.vx; g.y += g.vy;
            g.vx *= 0.94; g.vy *= 0.94;
            g.spin += 0.4;
            g.t--;
            if (g.t <= 0) {
                clearRadius(g.x, g.y, GRENADE_RADIUS);
                screenShake = 30;
                for (let p = 0; p < 40; p++) {
                    explosionParticles.push({
                        x: g.x, y: g.y,
                        vx: (Math.random() - 0.5) * 26, vy: (Math.random() - 0.5) * 26,
                        size: Math.random() * 6 + 3, life: 1.0
                    });
                }
                createBloodSplatter(g.x, g.y, Math.random() * Math.PI * 2, { count: 140, spread: Math.PI * 2 });
                for (let ent of allEntities) {
                    if (ent.dead) continue;
                    let d = Math.hypot(ent.x - g.x, ent.y - g.y);
                    if (d < GRENADE_RADIUS) ent.hit(ent.isPlayer ? 1 : 99, Math.atan2(ent.y - g.y, ent.x - g.x));
                }
                grenades.splice(i, 1);
                continue;
            }
        }
        ctx.save();
        ctx.translate(g.x, g.y);
        ctx.rotate(g.spin);
        ctx.fillStyle = g.t < 10 && Math.floor(frameCount / 3) % 2 === 0 ? '#ffffff' : '#c9304a';
        ctx.fillRect(-7, -5, 14, 10);
        ctx.restore();
        ctx.beginPath();
        ctx.arc(g.x, g.y, GRENADE_RADIUS * (1 - g.t / 30), 0, Math.PI * 2);
        ctx.strokeStyle = 'rgba(201, 48, 74, 0.35)';
        ctx.lineWidth = 2;
        ctx.stroke();
    }

    // Explosion debris
    for (let i = explosionParticles.length - 1; i >= 0; i--) {
        let ep = explosionParticles[i];
        ep.x += ep.vx; ep.y += ep.vy;
        ep.vx *= 0.9; ep.vy *= 0.9;
        ep.life -= 0.05;
        if (ep.life <= 0) { explosionParticles.splice(i, 1); continue; }
        ctx.fillStyle = 'rgba(139, 0, 0, ' + ep.life + ')';
        ctx.beginPath();
        ctx.arc(ep.x, ep.y, ep.size, 0, Math.PI * 2);
        ctx.fill();
    }

    // Logic
    {
        updateRounds();
        updateOrgans();
        updateBioCarriers();
        updateGunTerminals();

        // The choosing player is frozen in the bubble; everything else runs.
        if (!player.dead && !selecting) player.update();

        for (let i = enemies.length - 1; i >= 0; i--) {
            enemies[i].update();
            if (enemies[i].dead) enemies.splice(i, 1);
        }

        for (let i = crawlers.length - 1; i >= 0; i--) {
            crawlers[i].update();
            if (!crawlers[i].active) crawlers.splice(i, 1);
        }

        for (let i = bullets.length - 1; i >= 0; i--) {
            let b = bullets[i];
            b.update();
            if (b.active) {
                if (!b.isPlayerBullet && !player.dead) {
                    // The bubble absorbs incoming fire well before it lands.
                    if (selecting && Math.hypot(player.x - b.x, player.y - b.y) < BUBBLE_R) {
                        b.active = false;
                        for (let k = 0; k < 3; k++) spawnWallExplosion(b.x, b.y);
                    } else if (Math.hypot(player.x - b.x, player.y - b.y) < player.radius + b.radius) {
                        b.active = false;
                        player.hit(1, Math.atan2(b.vy, b.vx));
                    }
                }
                if (b.isPlayerBullet) {
                    for (let en of enemies) {
                        if (en.dead) continue;
                        if (b.hitSet && b.hitSet.has(en)) continue;
                        if (Math.hypot(en.x - b.x, en.y - b.y) < en.radius + b.radius) {
                            if (b.hitSet) b.hitSet.add(en);
                            en.hit(1, Math.atan2(b.vy, b.vx));
                            if (b.pierce <= 0) { b.active = false; break; }
                            b.pierce--;
                        }
                    }
                }
            }
            if (!b.active) bullets.splice(i, 1);
        }

        if (bannerTimer > 0) bannerTimer--;
    }

    // Protective bubble, coloured to the orb that is offering.
    if (selecting && !player.dead) {
        const org = offerOrgan();
        const col = org ? org.color : '#ffffff';
        const pulse = 1 + Math.sin(frameCount * 0.09) * 0.04;
        ctx.save();
        ctx.beginPath();
        ctx.arc(player.x, player.y, BUBBLE_R * pulse, 0, Math.PI * 2);
        ctx.fillStyle = col + '22';
        ctx.fill();
        ctx.strokeStyle = col;
        ctx.lineWidth = 2.5;
        ctx.globalAlpha = 0.85;
        ctx.stroke();
        ctx.globalAlpha = 0.35;
        ctx.beginPath();
        ctx.arc(player.x, player.y, BUBBLE_R * pulse - 7, 0, Math.PI * 2);
        ctx.lineWidth = 1;
        ctx.stroke();
        ctx.restore();
    }

    drawGunTerminals();
    drawBioCarriers();
    for (let en of enemies) en.draw();
    for (let c of crawlers) c.draw();
    if (!player.dead) player.draw();
    for (let b of bullets) b.draw();

    // Floating text
    for (let i = floatTexts.length - 1; i >= 0; i--) {
        const f = floatTexts[i];
        f.y -= 0.6; f.life -= 0.012;
        if (f.life <= 0) { floatTexts.splice(i, 1); continue; }
        ctx.globalAlpha = Math.min(1, f.life * 2);
        ctx.fillStyle = f.color;
        ctx.font = 'bold 12px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(f.text, f.x, f.y);
        ctx.textAlign = 'left';
        ctx.globalAlpha = 1;
    }

    // Prompt to seat the bio-tube.
    if (pendingBiohacks > 0 && !activeBake && !player.dead) {
        for (const o of organs) {
            if (build[o.tree].tier >= TIER_CAP) continue;
            if (Math.hypot(player.x - o.x, player.y - o.y) < 62) {
                ctx.fillStyle = '#ffffff';
                ctx.font = 'bold 12px monospace';
                ctx.textAlign = 'center';
                ctx.fillText('HOLD F - SEAT BIO-TUBE', player.x, player.y - 34);
                ctx.textAlign = 'left';
            }
        }
    }

    if (player.isChargingDash) {
        ctx.fillStyle = '#00bfff';
        ctx.font = '10px monospace';
        ctx.fillText('CHARGING', player.x - 25, player.y + 24);
    }

    ctx.restore();

    drawHUD();
    if (cardOffer) drawCardOffer();

    requestAnimationFrame(loop);
}

rebuildFlowField();     // must precede the first spawn so it can be reachability-checked
startRound(1);
loop();
