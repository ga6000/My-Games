// ===================================================
//   Reality Rewrite -- match phases and the reality shifts
// ===================================================
// Split out of reality-rewrite.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md ~2.1). This is the 6-file split that
// reality-rewrite/CLAUDE.md has described as PLANNED since before
// 2026-09-02 -- it now exists.
//
// Lines 1039-1186 were MOVED VERBATIM and IN SOURCE ORDER. Nothing was
// reordered: resize() is CALLED at load time, canvas/ctx resolve DOM at
// load time, and `mouse` reads the `width` that resize() set. Preserving
// the sequence is what makes the cut safe without hoisting anything.
//
// Classic scripts, one shared global scope, no modules (the file://
// hard constraint).
"use strict";

function initGame() {
    // The tube goes back to green with the rest of the reset -- the phosphor is
    // a record of how many rules have been rewritten, so a rematch starts clean.
    RRSKIN.setTube(0);
    // Full reset so this is safe to call again for a rematch, not just on first load —
    // otherwise a second start() would inherit the previous match's stability, mapBounds
    // (shrink/duplicate shifts mutate it), active cards, and leftover entities/UI state.
    gameState = STATE.PLAYING;
    gameTimer = 180.0;
    stability = 100.0;
    camera = { x: 0, y: 0, shake: 0 };
    authorTimer = 0;
    activeCards = [];
    hasDuplicated = false;
    hitStop = 0;
    mapBounds = { x: 0, y: 0, w: 3000, h: 3000 };
    bullets = []; particles = []; orbs = []; fields = []; ripples = [];

    ui.cardsContainer.innerHTML = '';
    // CLEARED, not re-stated. reality-rewrite/CLAUDE.md's known pitfall is that
    // this game's render layer has previously "overwritten CSS values on every
    // call (the vignette regression)" -- and re-writing the old smooth gradient
    // here is exactly that bug: it silently beat the quantized one the
    // stylesheet now defines. Clearing the inline value hands the property back
    // to CSS, which is the only place the default is written.
    ui.vignette.style.background = '';
    ui.modal.style.display = 'none';
    ui.overlay.style.display = 'none';
    ui.giantCount.style.display = 'none';
    ui.endRankings.style.display = 'none';

    buildMap();
    players = [];
    let spawn = findSafeSpawn();
    player = new Fighter(spawn.x, spawn.y, false, identity.name, identity.color);
    players.push(player);
    
    for(let i=1; i<=5; i++) {
        let s = findSafeSpawn();
        players.push(new Fighter(s.x, s.y, true, `BOT ${i}`));
    }
}

function hasCard(id, p = null) {
    return activeCards.some(c => c.id === id && (c.owner === p || c.type === 'global' || c.type === 'debuff'));
}

function modifyStability(amount) {
    if(gameState !== STATE.PLAYING) return;
    stability += amount;
    if(stability > 100) stability = 100;
    if(stability <= 0) { stability = 0; startAuthorPhase(); }
}

function startAuthorPhase() {
    gameState = STATE.AUTHOR_PHASE; authorTimer = 5.0;
    // A falling alarm: the arena is about to be rewritten under you.
    SFX.sequence([440.00, 349.23, 277.18], { type: 'square', step: 0.13, dur: 0.11, gain: 0.24 });
    
    let author = players.reduce((prev, curr) => (prev.score > curr.score) ? prev : curr);
    
    // Choose 3 random shifts
    let options = [...SHIFTS].filter(s => !(s.unique && hasDuplicated && s.id === 'duplicate')).sort(() => 0.5 - Math.random()).slice(0, 3);
    
    if (author === player) {
        ui.options.innerHTML = '';
        options.forEach(shift => {
            let btn = document.createElement('div'); btn.className = 'author-option';
            btn.innerHTML = `<h3 style="color:${shift.color}">${shift.name}</h3><span>${shift.desc}</span>`;
            btn.onclick = () => executeShift(shift, player);
            ui.options.appendChild(btn);
        });
        ui.modal.style.display = 'block';
    } else {
        // AI chooses randomly
        executeShift(options[0], author);
    }
}

function executeShift(shift, author) {
    ui.modal.style.display = 'none';
    
    let card = { ...shift, owner: author };
    activeCards.push(card);
    renderCards();
    
    // Instant Global Effects
    if (shift.id === 'growth') {
        blocks.forEach(b => { if(b.type === 'perm') { b.target.w *= 2; b.target.h *= 2; } });
    } else if (shift.id === 'shrink') {
        let shrinkW = mapBounds.w * 0.25; let shrinkH = mapBounds.h * 0.25;
        mapBounds.x += shrinkW/2; mapBounds.y += shrinkH/2;
        mapBounds.w -= shrinkW; mapBounds.h -= shrinkH;
    } else if (shift.id === 'duplicate') {
        hasDuplicated = true;
        let oldW = mapBounds.w, oldH = mapBounds.h;
        mapBounds.w *= 2; mapBounds.h *= 2;
        
        let oldBlocks = [...blocks];
        oldBlocks.forEach(b => {
            blocks.push(new Block(b.x + oldW, b.y, b.w, b.h, b.type));
            blocks.push(new Block(b.x, b.y + oldH, b.w, b.h, b.type));
            blocks.push(new Block(b.x + oldW, b.y + oldH, b.w, b.h, b.type));
        });
    }

    if(author === player) player.score += 200;

    // §6.12 -- each rule change SHIFTS THE MONITOR'S PHOSPHOR. That is the
    // whole reason shared/retro.css deliberately leaves --world-hue unset for
    // this game: the hue is not a property of the game, it is a property of how
    // many times reality has been rewritten. RRSKIN.setTube() writes both the
    // CSS custom property and the JS-side value, so DOM chrome and canvas
    // geometry can never disagree about which tube is in the cabinet.
    RRSKIN.nextTube();

    // The tube swap, as a rising sweep. This is the game's signature moment and
    // deliberately shares its sound with nothing else.
    SFX.sequence([196.00, 261.63, 392.00, 523.25], { type: 'triangle', step: 0.09, dur: 0.09, gain: 0.28 });

    camera.shake = 25;
    stability = 100.0;
    gameState = STATE.PLAYING;
}

function renderCards() {
    ui.cardsContainer.innerHTML = '';
    activeCards.forEach(c => {
        let el = document.createElement('div'); el.className = 'card';
        el.style.borderLeftColor = c.color;
        el.innerText = `${c.name} ${c.owner === player ? '(YOU)' : '(ENEMY)'}`;
        ui.cardsContainer.appendChild(el);
    });
    
    // Update Vignette specifically
    // Same rule as initGame(): BLIND is a state script owns, so script states
    // it (quantized to hard steps -- a vector tube has no soft falloff); the
    // default is CSS's and is restored by clearing, never by re-typing it here.
    if (hasCard('blind')) {
        ui.vignette.style.background =
            'radial-gradient(circle at center, transparent 0 10%, rgba(0,0,0,0.6) 10% 30%, rgba(0,0,0,0.97) 30% 100%)';
    } else {
        ui.vignette.style.background = '';
    }
}

function triggerEnding() {
    gameState = STATE.ENDING;
    ui.overlay.style.display = 'flex';
    ui.giantCount.style.display = 'block';
    ui.endRankings.style.display = 'none';
    
    let cnt = 3; ui.giantCount.innerText = cnt;
    let intv = trackInterval(() => {
        cnt--;
        if(cnt > 0) ui.giantCount.innerText = cnt;
        else {
            clearInterval(intv);
            showRankings();
        }
    }, 1000);
}

function showRankings() {
    gameState = STATE.GAME_OVER;
    ui.giantCount.style.display = 'none';
    ui.endRankings.style.display = 'block';
    
    let sorted = [...players].sort((a,b) => b.score - a.score);
    let html = `<h1>FINAL STANDINGS</h1>`;
    sorted.forEach((p, i) => {
        html += `<div class="rank-row" style="color: ${p===player?'#3498db':'#333'}">
            #${i+1} ${p.name} - ${p.score} PTS (${p.kills} K / ${p.deaths} D)
        </div>`;
    });
    ui.endRankings.innerHTML = html;
}

