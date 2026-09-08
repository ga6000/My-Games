// ===================================================
//   Reality Rewrite -- update and draw
// ===================================================
// Split out of reality-rewrite.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md ~2.1). This is the 6-file split that
// reality-rewrite/CLAUDE.md has described as PLANNED since before
// 2026-09-02 -- it now exists.
//
// Lines 1187-1340 were MOVED VERBATIM and IN SOURCE ORDER. Nothing was
// reordered: resize() is CALLED at load time, canvas/ctx resolve DOM at
// load time, and `mouse` reads the `width` that resize() set. Preserving
// the sequence is what makes the cut safe without hoisting anything.
//
// Classic scripts, one shared global scope, no modules (the file://
// hard constraint).
"use strict";

// -----------------------------------------------------------
// UPDATE & DRAW
// -----------------------------------------------------------

function update(dt) {
    if (gameState === STATE.AUTHOR_PHASE) {
        authorTimer -= dt; ui.countdown.innerText = authorTimer.toFixed(1);
        return;
    }
    if (gameState === STATE.ENDING || gameState === STATE.GAME_OVER) return;

    // Timer
    gameTimer -= dt;
    let m = Math.floor(gameTimer / 60);
    let s = Math.floor(gameTimer % 60).toString().padStart(2, '0');
    ui.timer.innerText = `${m}:${s}`;
    
    if (gameTimer <= 3.0 && gameState === STATE.PLAYING) triggerEnding();

    let targetCX = player.x - width/2; let targetCY = player.y - height/2;
    camera.x = lerp(camera.x, targetCX, 10*dt);
    camera.y = lerp(camera.y, targetCY, 10*dt);
    if(camera.shake > 0) camera.shake = lerp(camera.shake, 0, 10*dt);
    
    mouse.wx = mouse.x + camera.x; mouse.wy = mouse.y + camera.y;

    players.forEach(p => p.update(dt));
    orbs.forEach(o => o.update(dt)); orbs = orbs.filter(o => o.life > 0);
    fields.forEach(f => f.update(dt)); fields = fields.filter(f => f.life > 0);
    ripples.forEach(r => r.update(dt)); ripples = ripples.filter(r => r.life > 0);
    bullets.forEach(b => b.update(dt)); bullets = bullets.filter(b => b.life > 0 && !b.dead);
    particles.forEach(p => p.update(dt)); particles = particles.filter(p => p.life > 0);
    blocks.forEach(b => b.update(dt));

    updateUI();
}

function updateUI() {
    ui.stabBar.style.width = `${Math.max(0, stability)}%`;
    ui.stabBar.style.backgroundColor = stability < 20 ? 'var(--critical-color)' : (stability < 50 ? 'var(--warn-color)' : 'var(--stable-color)');
    
    ui.hudHp.innerText = `HP: ${Math.max(0, player.hp)}`;
    ui.hudAmmo.innerText = player.reloadTimer > 0 ? 'RELOADING' : `AMMO: ${player.ammo}`;
    ui.hudOrb.innerText = player.orbCooldown > 0 ? `ORB: ${player.orbCooldown.toFixed(1)}s` : 'ORB [E]: RDY';
    ui.hudOrb.style.color = player.orbCooldown > 0 ? '#999' : '#3498db';
    
    ui.sbPlayer.querySelector('span.name').innerText = player.name;
    ui.sbPlayer.querySelector('span:nth-child(2)').innerText = player.score;
    ui.sbPlayer.querySelector('span:nth-child(3)').innerText = `K ${player.kills}`;
    ui.sbPlayer.querySelector('span:nth-child(4)').innerText = `D ${player.deaths}`;
    
    let botHTML = '';
    let sortedBots = [...players].filter(p => p.isBot).sort((a,b) => b.score - a.score);
    sortedBots.forEach(b => {
        botHTML += `<div class="score-row"><span class="name">${b.name}</span><span>${b.score}</span><span>K ${b.kills}</span><span>D ${b.deaths}</span></div>`;
    });
    ui.sbBots.innerHTML = botHTML;
}

function draw() {
    // Was getComputedStyle(...).getPropertyValue('--bg-color') on EVERY FRAME,
    // which forces a style recalc per frame. RRSKIN reads the tokens once at
    // load (rr-core.js) and the shift updates them, so this is now a lookup.
    ctx.fillStyle = RRSKIN.ground;
    ctx.fillRect(0, 0, width, height);

    if (gameState === STATE.GAME_OVER) return; // Keep clear screen for ranking

    ctx.save();
    let sx = (Math.random()-0.5)*camera.shake, sy = (Math.random()-0.5)*camera.shake;
    ctx.translate(-camera.x + sx, -camera.y + sy);

    // Floor Grid
    // World structure carries the tube colour at low alpha (rr-core.js RRSKIN).
    ctx.strokeStyle = RRSKIN.structure(0.10); ctx.lineWidth = 1;
    let step = 100;
    let startX = Math.floor(camera.x / step) * step, startY = Math.floor(camera.y / step) * step;
    ctx.beginPath();
    for(let x = startX; x < camera.x + width + step; x += step) { ctx.moveTo(x, camera.y - step); ctx.lineTo(x, camera.y + height + step); }
    for(let y = startY; y < camera.y + height + step; y += step) { ctx.moveTo(camera.x - step, y); ctx.lineTo(camera.x + width + step, y); }
    ctx.stroke();

    // Map bounds
    // §2.2: the closing wall is a hazard, so it is --sig-magenta and not the
    // tube colour. A shrinking arena can kill you; the ordinary bound cannot.
    ctx.strokeStyle = hasCard('shrink') ? RRSKIN.magenta : RRSKIN.structure(0.45);
    ctx.lineWidth = hasCard('shrink') ? 8 : 4;
    ctx.strokeRect(mapBounds.x, mapBounds.y, mapBounds.w, mapBounds.h);

    // Courtyard: quatrefoil pool — white curb + water lobes fused by matching solid fills
    // (per-lobe strokes are skipped so the seams between lobes don't show)
    let shimmer = 0.5 + 0.5 * Math.sin(performance.now() / 600);
    const curbPad = 14;

    ctx.fillStyle = RRSKIN.structure(0.35);
    poolLobes.forEach(l => {
        ctx.beginPath();
        ctx.ellipse(l.x, l.y, l.rx + curbPad, l.ry + curbPad, 0, 0, Math.PI*2);
        ctx.fill();
    });

    // The shimmer survives the conversion -- it just rides the tube's alpha now
    // instead of interpolating two hardcoded blues, so the water changes colour
    // with the monitor like everything else in the world does.
    ctx.fillStyle = RRSKIN.structure(0.14 + 0.10 * shimmer);
    poolLobes.forEach(l => {
        ctx.beginPath();
        ctx.ellipse(l.x, l.y, l.rx, l.ry, 0, 0, Math.PI*2);
        ctx.fill();
    });

    // Baluster details flanking the pool
    ctx.fillStyle = RRSKIN.structure(0.5);
    for (let side of [-1, 1]) {
        let bx = waterFeature.x + side * 175;
        for (let i = -1; i <= 1; i++) {
            ctx.beginPath();
            ctx.arc(bx, waterFeature.y + i*22, 4, 0, Math.PI*2);
            ctx.fill();
        }
    }

    fields.forEach(f => f.draw(ctx));
    ripples.forEach(r => r.draw(ctx));
    blocks.forEach(b => b.draw(ctx));
    particles.forEach(p => p.draw(ctx));
    
    let sortedPlayers = [...players].sort((a,b) => a.y - b.y);
    sortedPlayers.forEach(p => p.draw(ctx));
    
    bullets.forEach(b => b.draw(ctx));
    orbs.forEach(o => o.draw(ctx));

    // Custom crosshair
    // §2.2 -- the crosshair is system chrome, so --sig-cyan.
    ctx.strokeStyle = RRSKIN.cyan; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(mouse.wx, mouse.wy, 8, 0, Math.PI*2);
    ctx.moveTo(mouse.wx - 12, mouse.wy); ctx.lineTo(mouse.wx + 12, mouse.wy);
    ctx.moveTo(mouse.wx, mouse.wy - 12); ctx.lineTo(mouse.wx, mouse.wy + 12);
    ctx.stroke();

    ctx.restore();

    if (gameState === STATE.AUTHOR_PHASE) {
        // Was a white wash, which only worked on the old paper ground. On black
        // it has to be a tint rather than a fade: magenta, because REALITY
        // COLLAPSE is the danger state (§2.2).
        ctx.fillStyle = 'rgba(255, 46, 136, 0.12)';
        ctx.fillRect(0, 0, width, height);
    }
}

function loop(time) {
    let dt = (time - lastTime) / 1000;
    lastTime = time;
    if (dt > 0.1) dt = 0.1;

    if (hitStop > 0) {
        hitStop -= dt;
        dt *= 0.05;
    }

    update(dt); draw();
    animFrameId = requestAnimationFrame(loop);
}

