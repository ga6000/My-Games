/**
 * Glass City Escape — input handling and top-down rendering
 *
 * Split out of glass_city_escape.html's inline script 2026-09-04 (Pass A of
 * glass-city-escape/GCE_PASS_PLAN.md). The lines below were MOVED VERBATIM --
 * Pass A deliberately changed no behaviour, so that any regression could be
 * attributed to the skin pass that followed rather than to the split.
 *
 * Classic scripts, one shared global scope, no modules (the file:// hard
 * constraint). Declarations only. Note this renderer is PURE TOP-DOWN -- there is no horizon.
 */
"use strict";

/**
 * Input Handling
 */
function setupKeyboardControls() {
    const keyMap = {
        'ArrowUp': 'up', 'w': 'up', 'ArrowDown': 'down', 's': 'down',
        'ArrowLeft': 'left', 'a': 'left', 'ArrowRight': 'right', 'd': 'right',
        ' ': 'dash', 'b': 'dash', 'Shift': 'dash'
    };
    window.addEventListener('keydown', e => {
        // Typing inside the log's textarea must not also drive the game --
        // without this, selecting the JSON and pressing L rewrites it, and
        // WASD walks the player around behind the panel.
        if (e.target && e.target.tagName === 'TEXTAREA') return;

        // THE RUN LOG MOVED TO L+G, 2026-09-07. It used to open on a bare L
        // from right here. It is now one section of the shared dev panel
        // (shared/devtools.js, registered by gc-dev.js), which owns the L+G
        // combo, the Escape-to-close, and the pause -- gcLogOpen is still the
        // flag, still read by the gameLoop branch below, just set from there.
        //
        // Nothing is left in this handler for it: DEVTOOLS attaches its own
        // window keydown listener BEFORE this one (it loads earlier) and calls
        // stopImmediatePropagation, so a combo press never arrives here at all.

        // M mutes. Not a nicety: the Hunt pass added three CONTINUOUS voices
        // (the proximity drone, the pursuit loop, the sight tone) and a game
        // that hums at you with no way to stop it is a game people close.
        //
        // GATED ON gameRunning, and both halves of that matter. hideMessage()
        // is itself a no-op unless the game is running, so a toast raised on
        // the start menu would never come down -- and one raised over the game
        // over box would overwrite it, taking the Restart button with it
        // (showMessage hides the button for anything not flagged isGameOver).
        // There is also no audio to mute before initGame() builds the context.
        if ((e.key === 'm' || e.key === 'M') && gameRunning) {
            const muted = gcAudioToggleMute();
            showMessage("AUDIO", muted ? "Muted" : "Unmuted");
            setTimeout(hideMessage, 900);
        }
        if(keyMap[e.key] || keyMap[e.key.toLowerCase()]) keys[keyMap[e.key] || keyMap[e.key.toLowerCase()]] = true;
    });
    window.addEventListener('keyup', e => {
        if(keyMap[e.key] || keyMap[e.key.toLowerCase()]) keys[keyMap[e.key] || keyMap[e.key.toLowerCase()]] = false;
    });
}

/**
 * Rendering (Pure Top-Down)
 */
function resize() {
    canvas.width = window.innerWidth;
    canvas.height = window.innerHeight;
}

/**
 * Does this wall cell's face `d` (0=N 1=E 2=S 3=W) look OUT of the building?
 *
 * A face is outward when its neighbour is not part of the same solid mass:
 * void, street or plaza. Two walls that are side by side therefore draw no pane
 * between them, which is what turns a ring of wall cells into one continuous
 * sheet of glass around the floor plate instead of a grid of boxes.
 */
function wallFaceOpen(x, y, z, d) {
    const nx = x + (d === 1 ? 1 : d === 3 ? -1 : 0);
    const ny = y + (d === 2 ? 1 : d === 0 ? -1 : 0);
    if (nx < 0 || ny < 0 || nx >= TOTAL_CELLS || ny >= TOTAL_CELLS) return true;
    const row = mapData[z] && mapData[z][ny];
    const n = row && row[nx];
    if (!n) return true;
    return n.type !== 'wall';
}

function drawTile(x, y, tile, isCurrentLevel, tileZ) {
    let screenX = x * CELL_SIZE;
    let screenY = y * CELL_SIZE; 

    if (screenX + CELL_SIZE < camera.x || screenX > camera.x + canvas.width ||
        screenY + CELL_SIZE < camera.y || screenY > camera.y + canvas.height) {
        return;
    }

    ctx.save();
    ctx.translate(screenX, screenY);
    ctx.globalAlpha = isCurrentLevel ? 1.0 : 0.25; 

    // VECTOR cabinet, anchor Battlezone (§6.8): wireframe solids on a plane.
    //
    // THE ONE DELIBERATE DEVIATION FROM THE SPEC. §6.8 asks for "unfilled
    // wireframe boxes". Taken literally in a TOP-DOWN view, an unfilled box is
    // an outline around empty space -- which reads as a room you can walk into,
    // when a wall is the one thing you cannot. That is the aesthetic breaking
    // the collision model, which §5 forbids. So walls get the wireframe AND a
    // faint interior tint: Battlezone line-work, still unmistakably solid.
    //
    // (§6.8 also asks for a horizon line. There is no horizon: this renderer is
    // pure top-down, so there is no vanishing point to put one on. Skipped
    // deliberately -- see GCE_PASS_PLAN.md.)
    if (tile.type === 'exterior') {
        // Ground level only: this is the street, which is walkable, so it gets
        // the same faint grid a floor gets.
        //
        // The tileZ check is DEFENSIVE, not load-bearing -- measured 2026-09-04:
        // above ground the gaps between roofs are `null`, not `exterior`
        // (level 1 counts 26,221 nulls and zero exterior), and render() skips
        // null tiles entirely, so the drop is already pure black. The guard is
        // here because the fall test in gc-entities.js treats `!tile` and
        // `exterior` as the SAME fatal condition, so anything that ever starts
        // emitting exterior above ground must not have it drawn as walkable
        // ground. Before this pass floor was white and exterior grey; painting
        // both as a dim grid would make a fatal gap look like a room, which is
        // the aesthetic breaking the collision model.
        if (isCurrentLevel && tileZ === 0) {
            ctx.strokeStyle = INK.dim;
            ctx.lineWidth = 1;
            ctx.strokeRect(0.5, 0.5, CELL_SIZE - 1, CELL_SIZE - 1);
        }
    }
    else if (tile.type === 'floor') {
        // RASTER (2026-09-06): a FILLED cell, not a stroked grid. Interior
        // floor is now the thing that reads as solid ground, because the wall
        // around it has become a thin glass line -- if the floor stayed an
        // outline too, a building would be nothing but empty outlines.
        ctx.fillStyle = isCurrentLevel ? 'rgba(0, 229, 255, 0.09)' : 'rgba(0, 229, 255, 0.035)';
        ctx.fillRect(0, 0, CELL_SIZE, CELL_SIZE);
        ctx.fillStyle = isCurrentLevel ? 'rgba(0, 229, 255, 0.16)' : 'rgba(0, 229, 255, 0.06)';
        ctx.fillRect(0, 0, CELL_SIZE, 2);          // hard lit top edge per cell
    }
    else if (tile.type === 'wall') {
        // GLASS IS A FACE, NOT A BLOCK (2026-09-06, GCE_RASTER_PASS_PLAN.md §6).
        //
        // The cell still blocks -- nothing about collision changed. What
        // changed is that it draws a PANE on each of its outward faces (the
        // ones whose neighbour is void, street or plaza) instead of filling
        // itself in. A curtain wall is a sheet of glass on the outside of a
        // floor plate, and now it looks like one.
        //
        // THIS RETIRES THE DEVIATION GCE_PASS_PLAN.md RECORDED IN 2026-09-04.
        // §6.8 asked for "unfilled wireframe boxes" and it was refused, because
        // an outline around empty space reads as a room you can walk into. It
        // reads correctly NOW, because the space inside the outline IS a room
        // you can walk into -- the floor branch above fills it. The objection
        // was right when the interior was black and is wrong now that it is not.
        //
        // Vertex bloom is gone with it: §4.3 is a vector-hardware artifact, and
        // keeping it on a raster cabinet would be the same category error as
        // putting scanlines on a vector one.
        const broken = !!tile.broken;
        const base = broken ? GLASS_BROKEN : GLASS_INTACT;
        ctx.fillStyle = isCurrentLevel ? base : 'rgba(0, 229, 255, 0.18)';

        const t = tile.boundary ? 5 : 3;           // the arena wall is heavier
        for (let d = 0; d < 4; d++) {
            if (!wallFaceOpen(x, y, tileZ, d)) continue;
            if (broken) {
                // A shattered pane: the same edge, drawn as a broken run of
                // teeth rather than a solid bar, so "you came through here"
                // stays legible for the rest of the level.
                for (let k = 0; k < CELL_SIZE; k += 6) {
                    if ((k / 6) % 2) continue;
                    const len = 4;
                    if (d === 0) ctx.fillRect(k, 0, len, t);
                    else if (d === 1) ctx.fillRect(CELL_SIZE - t, k, t, len);
                    else if (d === 2) ctx.fillRect(k, CELL_SIZE - t, len, t);
                    else ctx.fillRect(0, k, t, len);
                }
            } else {
                if (d === 0) ctx.fillRect(0, 0, CELL_SIZE, t);
                else if (d === 1) ctx.fillRect(CELL_SIZE - t, 0, t, CELL_SIZE);
                else if (d === 2) ctx.fillRect(0, CELL_SIZE - t, CELL_SIZE, t);
                else ctx.fillRect(0, 0, t, CELL_SIZE);
            }
        }

        // A faint interior tint so a wall cell is never mistaken for the floor
        // it encloses -- the collision model still has to survive the skin.
        if (isCurrentLevel && !tile.boundary) {
            ctx.fillStyle = 'rgba(0, 229, 255, 0.05)';
            ctx.fillRect(t, t, CELL_SIZE - t * 2, CELL_SIZE - t * 2);
        }
    }
    else if (tile.type === 'stair_up' || tile.type === 'stair_down') {
        // Navigation, not a goal -- deliberately NOT cyan, or stairs and the
        // escape tunnel would read as the same thing.
        ctx.strokeStyle = INK.mid;
        ctx.lineWidth = 1;
        ctx.strokeRect(1.5, 1.5, CELL_SIZE - 3, CELL_SIZE - 3);
        ctx.fillStyle = INK.hot;
        ctx.font = 'bold 24px ' + (getComputedStyle(document.body).getPropertyValue('--font-ui') || 'monospace');
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(tile.type === 'stair_up' ? "▲" : "▼", CELL_SIZE/2, CELL_SIZE/2 + 2);
    }
    else if (tile.type === 'stepwell') {
        // THE STEPWELL (§9). Concentric terraces descending to the tunnel, in
        // the manner of a baoli. Each tile already knows its Chebyshev ring
        // from carveStepwell(), so this is a lookup, not a distance
        // calculation repeated 169 times a frame.
        //
        // Structure colours, NOT cyan: AESTHETIC_GUIDE §2.2 gives cyan to
        // goals, and the goal here is the single tile at the bottom. If the
        // whole plaza were cyan the tunnel would have nothing left to say.
        const r = tile.ring;
        const t = 1 - (r / PLAZA_HALF);               // 0 at the lip, 1 at the floor
        const dx = x - PLAZA_CX, dy = y - PLAZA_CY;

        // Terrace floor: darker at the rim, deepening toward the water.
        ctx.fillStyle = 'rgba(12, 46, 52, ' + (0.20 + t * 0.62).toFixed(3) + ')';
        ctx.fillRect(0, 0, CELL_SIZE, CELL_SIZE);

        // THE STEP LIPS, and this is the whole trick. Only the OUTWARD-facing
        // edges of each ring are stroked -- the edge where that terrace drops
        // away to the one outside it. Stroking whole tiles instead (the first
        // attempt) drew a grid, and a grid reads as flat ground; drawing only
        // the drop edges produces clean concentric squares, which is what a
        // baoli looks like from directly above.
        //
        // The tile knows its ring; which of its edges face out is just the sign
        // test below, so this stays a per-tile decision with no neighbour
        // lookups.
        ctx.strokeStyle = 'rgba(143, 168, 156, ' + (0.30 + t * 0.65).toFixed(3) + ')';
        ctx.lineWidth = 1.5;
        ctx.beginPath();
        if (dx === r)  { ctx.moveTo(CELL_SIZE, 0); ctx.lineTo(CELL_SIZE, CELL_SIZE); }
        if (dx === -r) { ctx.moveTo(0, 0);         ctx.lineTo(0, CELL_SIZE); }
        if (dy === r)  { ctx.moveTo(0, CELL_SIZE); ctx.lineTo(CELL_SIZE, CELL_SIZE); }
        if (dy === -r) { ctx.moveTo(0, 0);         ctx.lineTo(CELL_SIZE, 0); }
        ctx.stroke();

        // The bottom two rings glow BEFORE the tunnel is open, so the well is a
        // landmark from the first second of the run rather than something that
        // only appears once the work is done.
        if (r <= 1) {
            const pulse = Math.sin(performance.now() / (escapeTunnelOpen ? 200 : 700)) * 0.5 + 0.5;
            const a = escapeTunnelOpen ? (0.18 + pulse * 0.45) : (0.06 + pulse * 0.14);
            ctx.fillStyle = 'rgba(0, 229, 255, ' + a.toFixed(3) + ')';
            ctx.fillRect(2, 2, CELL_SIZE - 4, CELL_SIZE - 4);
        }
    }
    else if (tile.type === 'escape_tunnel') {
        // §6.8: "goals go --sig-cyan". Was green, which is not in the signal set.
        let pulse = Math.sin(performance.now() / 200) * 0.5 + 0.5;
        ctx.fillStyle = 'rgba(0, 229, 255, ' + (pulse * 0.45) + ')';
        ctx.fillRect(4, 4, CELL_SIZE-8, CELL_SIZE-8);

        ctx.strokeStyle = INK.cyan;
        ctx.lineWidth = 3;
        ctx.strokeRect(4, 4, CELL_SIZE-8, CELL_SIZE-8);

        if (typeof RETRO !== "undefined") {
            RETRO.vertexBloom(ctx, [
                [4, 4], [CELL_SIZE - 4, 4],
                [CELL_SIZE - 4, CELL_SIZE - 4], [4, CELL_SIZE - 4]
            ], { radius: 2, color: INK.hot });
        }
    }    ctx.restore();
}

/**
 * ===================================================
 *   MINIMAP  (2026-09-06, GCE_STEPWELL_PASS_PLAN.md §8)
 * ===================================================
 * Two jobs. The obvious one is orientation on a 58-cell city. The one that
 * matters more is the VISUAL HALF OF THE CROSS-FLOOR WARNING: drones one floor
 * above or below are drawn hollow and dim, so "there are three things in the
 * room over my head" is answerable before you climb into it. The audio half is
 * gcAudioFrame()'s vertical tone; two channels for one fact, because the fact
 * is "you are about to die for a reason you cannot see".
 *
 * The building silhouette is CACHED, one offscreen canvas per floor, built on
 * demand and dropped when the world is. Re-walking 3,364 cells every frame for
 * a decoration would make the minimap the single most expensive thing in the
 * loop -- more than the pursuit flood, which only runs five times a second.
 */
let minimapCache = null;

function minimapFloor(z) {
    if (!minimapCache) minimapCache = {};
    if (minimapCache[z]) return minimapCache[z];

    const size = TOTAL_CELLS * MINIMAP_CELL;
    const off = document.createElement('canvas');
    off.width = size; off.height = size;
    const c = off.getContext('2d');

    for (let y = 0; y < TOTAL_CELLS; y++) {
        for (let x = 0; x < TOTAL_CELLS; x++) {
            const tile = mapData[z] && mapData[z][y] && mapData[z][y][x];
            if (!tile) continue;
            if (tile.type === 'wall') c.fillStyle = 'rgba(0, 229, 255, 0.55)';
            else if (tile.type === 'floor') c.fillStyle = 'rgba(0, 229, 255, 0.13)';
            else if (tile.type === 'stepwell' || tile.type === 'escape_tunnel') continue; // drawn live
            else continue;                                                                // street stays black
            c.fillRect(x * MINIMAP_CELL, y * MINIMAP_CELL, MINIMAP_CELL, MINIMAP_CELL);
        }
    }
    minimapCache[z] = off;
    return off;
}

/**
 * THE TRAPDOOR OPENING (§8). Two halves slide apart over EXIT_OPEN_MS and light
 * shafts out in expanding rings. World space, so it sits on the well.
 */
const EXIT_OPEN_MS = 1400;

function exitOpenProgress() {
    if (!exitOpenedAt) return 1;
    return Math.min(1, (performance.now() - exitOpenedAt) / EXIT_OPEN_MS);
}

function drawExitBurst() {
    if (!escapeTunnelOpen || !exitOpenedAt) return;
    const t = exitOpenProgress();
    const wx = PLAZA_CX * CELL_SIZE + CELL_SIZE / 2;
    const wy = PLAZA_CY * CELL_SIZE + CELL_SIZE / 2;

    ctx.save();
    ctx.translate(wx, wy);

    // The two door halves sliding apart, drawn as blocks over the tunnel.
    const slide = t * CELL_SIZE * 0.55;
    ctx.fillStyle = '#0a1a1e';
    ctx.fillRect(-CELL_SIZE / 2, -CELL_SIZE / 2 - slide, CELL_SIZE, CELL_SIZE / 2);
    ctx.fillRect(-CELL_SIZE / 2, slide, CELL_SIZE, CELL_SIZE / 2);
    ctx.fillStyle = INK.cyan;
    ctx.fillRect(-CELL_SIZE / 2, -2 - slide, CELL_SIZE, 2);
    ctx.fillRect(-CELL_SIZE / 2, slide, CELL_SIZE, 2);

    // Light shafting out: expanding rings for the first pass, then a steady
    // beacon so the well keeps saying "here" for the rest of the level.
    if (t < 1) {
        for (let k = 0; k < 3; k++) {
            const p = Math.min(1, t * 1.6 - k * 0.22);
            if (p <= 0) continue;
            ctx.strokeStyle = 'rgba(0, 229, 255, ' + (0.9 * (1 - p)).toFixed(3) + ')';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(0, 0, p * PLAZA_HALF * CELL_SIZE, 0, Math.PI * 2);
            ctx.stroke();
        }
    }
    ctx.restore();
}

/**
 * The screen wash. ONLY WHEN THE WELL IS ON SCREEN -- washing the whole frame
 * for something the player cannot see reads as a rendering glitch, not as an
 * event. Drawn outside the camera transform, in screen space.
 */
function drawExitWash() {
    if (!escapeTunnelOpen || !exitOpenedAt) return;
    const t = exitOpenProgress();
    if (t >= 1) return;

    const wx = PLAZA_CX * CELL_SIZE + CELL_SIZE / 2;
    const wy = PLAZA_CY * CELL_SIZE + CELL_SIZE / 2;
    const onScreen = wx > camera.x && wx < camera.x + canvas.width &&
                     wy > camera.y && wy < camera.y + canvas.height;
    if (!onScreen) return;

    // Rises fast, falls slow: a flash that fades, not a fade in and out.
    const a = t < 0.25 ? (t / 0.25) * 0.55 : (1 - (t - 0.25) / 0.75) * 0.55;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 229, 255, ' + Math.max(0, a).toFixed(3) + ')';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();
}

/**
 * THE WAVE BURST — Robotron 2084's wave change, in this game's palette.
 *
 * Robotron redraws its playfield border at growing sizes in cycling colours so
 * the rectangle appears to rush past the viewer, then drops you straight into
 * the next wave. Two properties are the whole effect and both are kept: it is
 * RECTANGLES, not circles (it is the arena rushing outward, not an explosion),
 * and the colour changes every frame or two rather than fading.
 *
 * THE COLOURS ARE THE SIGNAL THREE PLUS PHOSPHOR HOT, not an arcade rainbow.
 * Robotron's cycling ran the full hardware palette; AESTHETIC_GUIDE §2.2 gives
 * cyan/amber/magenta fixed meanings and this game already obeys them, so a
 * rainbow here would spend the palette's meaning on a decoration. Four hot
 * tokens cycling at ~20Hz carry the same energy and cost nothing semantically,
 * because a burst that covers the whole screen for 780ms cannot be mistaken for
 * a hazard, a pickup or a goal.
 *
 * Screen space, so it is drawn after the camera transform is restored.
 */
/**
 * (WELL OPEN) with an arrow pointing at it.
 *
 * Replaces the modal that used to announce the same thing for four seconds. It
 * is the objective for the whole back half of a level, so it is a PERSISTENT
 * readout rather than an interruption.
 *
 * IT DISAPPEARS BEFORE THE NEXT LEVEL BY CONSTRUCTION, NOT BY TIMING: it draws
 * only while `escapeTunnelOpen`, and spawnCores() sets that false inside the
 * SYNCHRONOUS rebuild in triggerNextStage(). The flag is already down on the
 * first frame of the new level, so there is no timer that can be left running.
 *
 * Screen space, under the minimap.
 */
function drawWellIndicator() {
    if (!escapeTunnelOpen || !gameRunning) return;

    const wx = PLAZA_CX * CELL_SIZE + CELL_SIZE / 2;
    const wy = PLAZA_CY * CELL_SIZE + CELL_SIZE / 2;
    const dist = Math.hypot(wx - player.x, wy - player.y);
    // Standing on it: the arrow would be telling the player what is under
    // their feet, and a spinning arrow at zero distance is just noise.
    if (dist < CELL_SIZE * 2) return;

    const size = TOTAL_CELLS * MINIMAP_CELL;
    const x = canvas.width - size - MINIMAP_PAD;
    const y = MINIMAP_PAD + size + 14;
    const pulse = 0.65 + Math.sin(performance.now() / 260) * 0.35;

    ctx.save();
    ctx.globalAlpha = pulse;
    ctx.fillStyle = INK.cyan;
    ctx.font = 'bold 15px ' + (getComputedStyle(document.body).getPropertyValue('--font-ui') || 'monospace');
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('(WELL OPEN)', x, y + 9);

    // The arrow, bearing from the player to the well. Drawn as a filled wedge
    // rather than a glyph so it belongs to the raster cabinet.
    const ax = x + size - 12, ay = y + 9;
    ctx.globalAlpha = 1;
    ctx.translate(ax, ay);
    ctx.rotate(Math.atan2(wy - player.y, wx - player.x));
    ctx.fillStyle = INK.cyan;
    ctx.beginPath();
    ctx.moveTo(11, 0); ctx.lineTo(-7, -8); ctx.lineTo(-3, 0); ctx.lineTo(-7, 8);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    // Distance in cells, so "which way" comes with "how far".
    ctx.save();
    ctx.globalAlpha = 0.75;
    ctx.fillStyle = INK.mid;
    ctx.font = '11px ' + (getComputedStyle(document.body).getPropertyValue('--font-ui') || 'monospace');
    ctx.textAlign = 'left';
    ctx.fillText(Math.round(dist / CELL_SIZE) + 'm', x, y + 26);
    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

function drawWaveTransition() {
    if (!waveTransitionAt) return;
    const elapsed = performance.now() - waveTransitionAt;
    if (elapsed >= WAVE_TRANSITION_MS) { waveTransitionAt = 0; return; }

    const t = elapsed / WAVE_TRANSITION_MS;
    const cx = canvas.width / 2, cy = canvas.height / 2;
    const maxHalf = Math.hypot(cx, cy);
    const palette = [INK.cyan, INK.amber, INK.magenta, INK.hot];

    ctx.save();

    // A hard flash on the first ~90ms. Robotron's wave change starts as a
    // whiteout, not as a fade-in.
    if (t < 0.12) {
        ctx.fillStyle = 'rgba(232, 255, 244, ' + (0.5 * (1 - t / 0.12)).toFixed(3) + ')';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }

    for (let i = 0; i < WAVE_RINGS; i++) {
        // Each ring is offset in phase, so they leave the centre in a stream
        // rather than all at once. Squared so they ACCELERATE outward -- a
        // linear expansion reads as a ripple, and Robotron's reads as a rush.
        let p = t * 1.35 - i * 0.085;
        if (p <= 0 || p >= 1) continue;
        p = p * p;

        const hw = p * maxHalf * 1.25;
        const hh = hw * (canvas.height / canvas.width);

        ctx.strokeStyle = palette[(i + Math.floor(elapsed / 45)) % palette.length];
        ctx.globalAlpha = Math.max(0, 1 - p) * 0.95;
        ctx.lineWidth = 2 + p * 10;
        ctx.strokeRect(cx - hw, cy - hh, hw * 2, hh * 2);
    }

    // WAVE n and the bonus, colour-cycling with the rings and gone before they
    // become something to read. This is what replaces the modal box: the same
    // two facts, on the canvas, costing no time.
    //
    // SIZED FROM THE CANVAS, not fixed. A hard 44px was chosen against a
    // full-width window and swallowed a 410px-wide one whole -- the display
    // face is very wide, so "LEVEL 2" alone ran past both edges. Clamped so it
    // stays legible on a small canvas and does not become a billboard on a big
    // one.
    const titleSize = Math.max(18, Math.min(52, canvas.width * 0.052));
    const bonusSize = Math.max(11, titleSize * 0.42);
    // ONE LINE ABOVE, ONE BELOW, with the player in the gap. The camera pins
    // the player to the exact centre of the screen every frame, so anything
    // drawn near cy is drawn on top of them -- the first attempt stacked both
    // lines just above centre and the bonus landed square on the sprite.
    const gap = Math.max(46, canvas.height * 0.11);

    ctx.globalAlpha = t < 0.75 ? 1 : Math.max(0, (1 - t) / 0.25);
    ctx.fillStyle = palette[Math.floor(elapsed / 60) % palette.length];
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = 'bold ' + Math.round(titleSize) + 'px ' +
               (getComputedStyle(document.body).getPropertyValue('--font-display') || 'monospace');
    ctx.fillText('LEVEL ' + currentStage, cx, cy - gap);
    ctx.font = 'bold ' + Math.round(bonusSize) + 'px ' +
               (getComputedStyle(document.body).getPropertyValue('--font-ui') || 'monospace');
    ctx.fillStyle = INK.hot;
    ctx.fillText('+' + waveBonus, cx, cy + gap);

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

// Are the drones held for the spawn grace? See WAVE_GRACE_MS in gc-core.js.
function waveGraceActive() {
    return waveTransitionAt !== 0 &&
           (performance.now() - waveTransitionAt) < WAVE_GRACE_MS;
}

function drawMinimap() {
    const size = TOTAL_CELLS * MINIMAP_CELL;
    const ox = canvas.width - size - MINIMAP_PAD;
    const oy = MINIMAP_PAD;
    const s = MINIMAP_CELL / CELL_SIZE;        // world px -> minimap px

    ctx.save();
    ctx.globalAlpha = 0.9;
    ctx.fillStyle = 'rgba(0,0,0,0.72)';
    ctx.fillRect(ox - 2, oy - 2, size + 4, size + 4);
    ctx.strokeStyle = INK.dim;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox - 2.5, oy - 2.5, size + 5, size + 5);

    ctx.translate(ox, oy);
    try { ctx.drawImage(minimapFloor(player.z), 0, 0); } catch (e) { /* mid-rebuild */ }

    // The stepwell, always, whatever floor you are on -- it is the one fixed
    // landmark and the thing you eventually have to walk to.
    const wellPx = (PLAZA_HALF * 2 + 1) * MINIMAP_CELL;
    const wellX = (PLAZA_CX - PLAZA_HALF) * MINIMAP_CELL;
    const wellY = (PLAZA_CY - PLAZA_HALF) * MINIMAP_CELL;
    const wellPulse = Math.sin(performance.now() / (escapeTunnelOpen ? 200 : 800)) * 0.5 + 0.5;
    ctx.strokeStyle = 'rgba(0, 229, 255, ' + (escapeTunnelOpen ? 0.5 + wellPulse * 0.5 : 0.35).toFixed(3) + ')';
    ctx.lineWidth = 1;
    ctx.strokeRect(wellX, wellY, wellPx, wellPx);
    ctx.fillStyle = 'rgba(0, 229, 255, ' + (escapeTunnelOpen ? 0.35 + wellPulse * 0.45 : 0.18).toFixed(3) + ')';
    ctx.fillRect(PLAZA_CX * MINIMAP_CELL - 1, PLAZA_CY * MINIMAP_CELL - 1, 3, 3);

    // Pedestals: hollow when they still want a core, solid when filled. This
    // is the level's progress bar, readable at a glance without the HUD.
    for (let i = 0; i < pedestals.length; i++) {
        const p = pedestals[i];
        ctx.fillStyle = p.filled ? INK.amber : 'rgba(0, 229, 255, 0.8)';
        if (p.filled) ctx.fillRect(p.x * s - 2, p.y * s - 2, 4, 4);
        else { ctx.strokeStyle = 'rgba(0,229,255,0.8)'; ctx.lineWidth = 1;
               ctx.strokeRect(p.x * s - 2, p.y * s - 2, 4, 4); }
    }

    // Cores still out there on this floor. Blips are deliberately NOT shown --
    // they are the reward for exploring, and a map that lists them turns
    // exploring into ticking off a list.
    ctx.fillStyle = INK.amber;
    for (let i = 0; i < collectibles.length; i++) {
        const c = collectibles[i];
        if (c.collected || c.delivered || c.z !== player.z) continue;
        ctx.fillRect(c.x * s - 1.5, c.y * s - 1.5, 4, 4);
    }

    // Drones. Current floor solid; one floor away hollow and dim -- the whole
    // point of the panel.
    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        const dz = e.z - player.z;
        if (Math.abs(dz) > 1) continue;

        const engaged = (e.state === 'hunt' || e.state === 'alert');
        const col = engaged ? INK.magenta
                  : e.kind === 'lancer' ? LANCER_BLUE
                  : e.kind === 'stalker' ? STALKER_GREEN
                  : '#7a2b2b';
        const ex = e.x * s, ey = e.y * s;

        if (dz === 0) {
            ctx.fillStyle = col;
            ctx.fillRect(ex - 1, ey - 1, engaged ? 3 : 2, engaged ? 3 : 2);
        } else {
            // Hollow ring = "not on your floor". Shape carries the difference,
            // so it survives the colour already being spoken for by state.
            ctx.strokeStyle = col;
            ctx.globalAlpha = 0.55;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.arc(ex, ey, 2.2, 0, Math.PI * 2);
            ctx.stroke();
            ctx.globalAlpha = 0.9;
        }
    }

    // The player, last and brightest, with a facing tick.
    const px = player.x * s, py = player.y * s;
    ctx.strokeStyle = INK.hot;
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(px + Math.cos(player.dir) * 6, py + Math.sin(player.dir) * 6);
    ctx.stroke();
    ctx.fillStyle = INK.hot;
    ctx.fillRect(px - 1.5, py - 1.5, 3, 3);

    ctx.restore();
}

/**
 * A soft column of light standing over the stepwell, in world space so it moves
 * with the camera. Culled when the well is off screen, so it costs nothing for
 * most of a run.
 *
 * Brighter and faster once the tunnel is open: the same landmark then doubles
 * as "and now you can leave", which is the only moment in the loop where the
 * player has a single unambiguous objective.
 */
function drawWellGlow() {
    const wx = PLAZA_CX * CELL_SIZE + CELL_SIZE / 2;
    const wy = PLAZA_CY * CELL_SIZE + CELL_SIZE / 2;
    const radius = (PLAZA_HALF + 5) * CELL_SIZE;

    if (wx + radius < camera.x || wx - radius > camera.x + canvas.width ||
        wy + radius < camera.y || wy - radius > camera.y + canvas.height) return;

    const pulse = Math.sin(performance.now() / (escapeTunnelOpen ? 320 : 1100)) * 0.5 + 0.5;
    const peak = escapeTunnelOpen ? (0.10 + pulse * 0.13) : (0.030 + pulse * 0.035);

    const grad = ctx.createRadialGradient(wx, wy, CELL_SIZE * 0.5, wx, wy, radius);
    grad.addColorStop(0, 'rgba(0, 229, 255, ' + peak.toFixed(3) + ')');
    grad.addColorStop(0.45, 'rgba(0, 229, 255, ' + (peak * 0.35).toFixed(3) + ')');
    grad.addColorStop(1, 'rgba(0, 229, 255, 0)');
    ctx.fillStyle = grad;
    ctx.fillRect(wx - radius, wy - radius, radius * 2, radius * 2);
}

function render() {
    camera.x = player.x - canvas.width / 2;
    camera.y = player.y - canvas.height / 2;

    // §2.1: pure black. Not #111 -- a vector monitor's black is the absence of
    // beam, and the near-blacks in this repo were a modern dark-theme habit.
    ctx.fillStyle = INK.ground;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    
    ctx.save();
    ctx.translate(-camera.x, -camera.y);

    let viewZ = player.z;

    // THE LIGHT SHAFT over the well. Drawn under everything, on every floor --
    // that is the point of it. The well is a hole in the skyline, so from three
    // storeys up you should still see where the city drains to, and the glow is
    // what carries that when the terraces themselves are hidden under the
    // roofs you are standing on. One gradient fill per frame.
    drawWellGlow();

    for (let z = 0; z <= viewZ; z++) {
        let isCurrent = (z === viewZ);
        
        for (let y = 0; y < TOTAL_CELLS; y++) {
            for (let x = 0; x < TOTAL_CELLS; x++) {
                let tile = mapData[z][y][x];
                if (tile) drawTile(x, y, tile, isCurrent, z);
            }
        }
        
        // PEDESTALS -- ground floor only, under everything else on it.
        if (z === 0) {
            ctx.globalAlpha = isCurrent ? 1.0 : 0.2;
            for (let i = 0; i < pedestals.length; i++) drawPedestal(ctx, pedestals[i]);
            ctx.globalAlpha = 1.0;
        }

        // CORES still out in the world (not carried, not delivered).
        ctx.globalAlpha = isCurrent ? 1.0 : 0.2;
        for (let i = 0; i < collectibles.length; i++) {
            const c = collectibles[i];
            if (c.collected || c.delivered || c.z !== z) continue;
            c.spin += 0.045;
            drawCoreGlyph(ctx, c.x, c.y + Math.sin(c.spin) * 3, 11, c.spin);
        }

        // BLIPS.
        for (let i = 0; i < blips.length; i++) {
            const b = blips[i];
            if (b.collected || b.z !== z) continue;
            b.phase += 0.09;
            drawBlipGlyph(ctx, b.x, b.y, b.phase);
        }
        ctx.globalAlpha = 1.0;
        
        entities.forEach(e => {
            if (e.z === z) {
                ctx.globalAlpha = isCurrent ? 1.0 : 0.2;
                e.draw(ctx);
                ctx.globalAlpha = 1.0;
            }
        });

        // Bolts after the robots that fired them, so a shot leaving a Surveyor
        // is not drawn underneath it.
        drawLasers(z, isCurrent);
        drawShards(z, isCurrent);

        // Rival racers on this floor, drawn with the world so they sit
        // behind the local player rather than over the top of them.
        drawGhosts(z, isCurrent);
    }

    player.draw(ctx);
    // Last, so the "you are being aimed at" mark is not buried under the very
    // sprite it is marking -- see drawSightReticle() in gc-entities.js.
    drawSightReticle();
    drawExitBurst();
    ctx.restore();

    // AFTER the camera restore: these are screen furniture, not world geometry,
    // so they must not be translated by camera.x/y.
    drawExitWash();
    drawMinimap();
    drawWellIndicator();
    // Under the minimap: every racer's level, and the clears feed. Draws the
    // board only with company; the feed only has lines when there is a race.
    drawRaceBoard();
    // Last of all: the wave burst covers everything, including the HUD-side
    // furniture, which is what makes it read as the screen changing rather than
    // as an effect inside the game world.
    drawWaveTransition();
}

function gameLoop(timestamp) {
    if (!gameRunning) return;

    // PAUSED while the run log is open: keep drawing so the page does not look
    // dead behind the panel, but advance nothing. lastTime is refreshed so the
    // frame after the panel closes is not handed the whole pause as its dt.
    if (gcLogOpen) {
        lastTime = timestamp;
        render();
        requestAnimationFrame(gameLoop);
        return;
    }

    let dt = timestamp - lastTime;
    lastTime = timestamp;

    player.update(dt);

    // BEFORE the robots move, not after: the field they steer by has to reflect
    // where the player is THIS frame, or every hunter is chasing a one-frame-old
    // position and the whole flood is off by a step. It is also a no-op unless
    // somebody is actually hunting.
    updatePursuitField();

    // THE SPAWN GRACE. Drones are held for the first WAVE_GRACE_MS of the wave
    // burst; the player is not. Materialising into a new arena with hunters
    // already walking at you is not an opening, it is an ambush -- and the
    // whole point of removing the between-level rest is that the PLAYER never
    // stops, not that nothing does.
    if (!waveGraceActive()) entities.forEach(e => e.update(dt, player));
    updateLasers();
    updateShards();

    // The health bar animates (regen flash, low-health pulse), so it has to be
    // redrawn while either is running. Outside those it is redrawn on change
    // only -- 9 hearts is ~380 fillRects and there is no reason to pay that on
    // a frame where nothing about it moved.
    if (player.health <= LOW_HEALTH_AT || performance.now() - healthFlashAt < 420) updateHealthUI();

    // The continuous mix -- drone level, pursuit loop, sight tone -- is pumped
    // from here rather than from a JS timer. See the note at the top of
    // gc-audio.js: the audio clock is what schedules; this just tells it what
    // the world currently sounds like.
    gcAudioFrame();

    gcTelemetryFrame();

    updateGhosts();
    broadcastPosition();

    render();
    requestAnimationFrame(gameLoop);
}

