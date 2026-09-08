// ===================================================
//   Reality Rewrite -- window.GameInstance and boot
// ===================================================
// Split out of reality-rewrite.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md ~2.1). This is the 6-file split that
// reality-rewrite/CLAUDE.md has described as PLANNED since before
// 2026-09-02 -- it now exists.
//
// Lines 1341-1419 were MOVED VERBATIM and IN SOURCE ORDER. Nothing was
// reordered: resize() is CALLED at load time, canvas/ctx resolve DOM at
// load time, and `mouse` reads the `width` that resize() set. Preserving
// the sequence is what makes the cut safe without hoisting anything.
//
// Classic scripts, one shared global scope, no modules (the file://
// hard constraint).
"use strict";

// -----------------------------------------------------------
// HUB SHELL: window.GameInstance
// -----------------------------------------------------------
// Standard init/start/pause/resume/destroy/getState lifecycle per
// GAME_PROTOTYPE_INSTRUCTIONS.md. NOTE: the exact init()/getState() shapes here
// are inferred from that doc's description, not verified against the real file —
// worth truing up against it (or space-tracer.html's implementation) directly.
window.GameInstance = {
    init(config) {
        identity = resolveIdentity(config);
        if (listenerController) listenerController.abort(); // safe to call init() more than once
        listenerController = new AbortController();
        attachInputListeners(listenerController.signal);
        resize();

        // Audio, new 2026-09-05. configure() NAMESPACES THE MUTE PREFERENCE --
        // without it two games on the same origin share one stored key, which is
        // how muting Zombie silently mutes this game and reads as broken audio
        // rather than a shared setting. unlockOn() takes the same AbortSignal
        // everything else here does, so destroy() tears its listeners down too.
        SFX.configure({ game: 'reality-rewrite' });
        SFX.unlockOn(window, listenerController.signal);

        // Joined 2026-09-03 so this game gets the SERVER's colour like every
        // other mp-core game, instead of inventing one. No gameplay is synced
        // here yet -- this is identity only, which is why there is no onMessage.
        // MP.connect is idempotent per page, and degrades to solo on file://.
        if (typeof MP !== 'undefined' && !mpConnected) {
            mpConnected = true;
            MP.connect({
                game: 'reality-rewrite',
                onReady: function () {
                    // The socket resolves AFTER initGame() may already have built
                    // the player, so apply the authoritative colour to both the
                    // identity record and the live fighter.
                    if (!MP.selfColor) return;
                    identity.color = MP.selfColor;
                    if (player) player.color = MP.selfColor;
                }
            });
        }
    },
    start() {
        if (animFrameId !== null) cancelAnimationFrame(animFrameId);
        isPaused = false;
        initGame();
        lastTime = performance.now();
        animFrameId = requestAnimationFrame(loop);
    },
    pause() {
        if (animFrameId !== null) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        isPaused = true;
    },
    resume() {
        if (!isPaused) return;
        isPaused = false;
        lastTime = performance.now();
        animFrameId = requestAnimationFrame(loop);
    },
    destroy() {
        if (animFrameId !== null) { cancelAnimationFrame(animFrameId); animFrameId = null; }
        if (listenerController) { listenerController.abort(); listenerController = null; }
        pendingTimers.forEach(id => { clearTimeout(id); clearInterval(id); });
        pendingTimers = [];
        for (let k in keys) delete keys[k];
        mouse.left = false; mouse.right = false;
        // Browsers cap live AudioContexts per page, so an init/destroy cycle
        // that never closes one eventually fails to create another.
        SFX.destroy();
        if (typeof MP !== 'undefined' && mpConnected) { MP.destroy(); mpConnected = false; }
    },
    getState() {
        return {
            gameState: Object.keys(STATE).find(k => STATE[k] === gameState) || 'UNKNOWN',
            timeRemaining: Math.max(0, gameTimer),
            paused: isPaused,
            player: player ? {
                name: player.name, score: player.score,
                kills: player.kills, deaths: player.deaths,
                hp: Math.max(0, player.hp)
            } : null
        };
    }
};

// Opened directly rather than through the hub — boot immediately so it still
// works standalone (this is how it's been tested all along this conversation).
window.GameInstance.init();
window.GameInstance.start();

