/**
 * Cliff Run — input, match flow, window.GameInstance, the loop
 * ===================================================
 * Loads LAST but one (cr-dev.js follows it and only registers). This is the
 * ONLY file that executes anything.
 *
 * THE LOOP IS A FIXED-TIMESTEP ACCUMULATOR AT 1/120s, and that is not a
 * preference. four-d-pong/fp-boot.js records what the alternative cost there:
 * a per-rAF constant made the same game run 2.4x faster on a 144Hz monitor, so
 * two people in one match were playing different games. A platformer whose
 * jump arcs are tuned against tile widths (cr-level.js caps every gap against
 * CR_PHYS) is strictly less forgiving of that than Pong was -- a variable step
 * would make the generator's reachability margins a function of the monitor.
 *
 * Every listener goes through ONE AbortController (crListeners) and every timer
 * through crTrackTimeout/crTrackInterval, so destroy() fully tears an instance
 * down. Root CLAUDE.md's hard constraint, done up front rather than retrofitted.
 */
"use strict";

var CR_STEP = 1 / 120;
var CR_MAX_STEPS = 8;           // after a tab switch, drop time rather than spiral

var crRaf = null;
var crLastT = 0;
var crAccum = 0;
var crPaused = false;
var crAttractCtl = null;
var crKeys = Object.create(null);
var crReadyBeeped = -1;

// ===================================================
//   SCREEN
// ===================================================
/*
 * The canvas is 480x288 INTERNALLY and never resized. What changes is its CSS
 * size: an integer multiple, letterboxed inside the window minus the cabinet
 * panel. Integer-only is what keeps a virtual pixel square -- a fractional
 * scale with image-rendering: pixelated gives you rows of 2px pixels next to
 * rows of 3px ones, which is more obviously wrong than a blur would be.
 */
function crResize() {
    if (!crCanvas) return;
    var host = document.getElementById("screen");
    var w = host ? host.clientWidth : window.innerWidth;
    var h = host ? host.clientHeight : window.innerHeight;
    var s = Math.min(w / CR_VW, h / CR_VH);
    // Below 1 there is nothing to round down to, so a very small window gets
    // the fractional scale rather than nothing at all.
    crScale = s >= 1 ? Math.floor(s) : s;
    crCanvas.style.width = Math.round(CR_VW * crScale) + "px";
    crCanvas.style.height = Math.round(CR_VH * crScale) + "px";
}

// ===================================================
//   INPUT
// ===================================================
var CR_KEYMAP = {
    ArrowLeft: "left", KeyA: "left",
    ArrowRight: "right", KeyD: "right",
    ArrowUp: "up", KeyW: "up", Space: "up",
    ArrowDown: "down", KeyS: "down"
};

function crAttachInput(signal) {
    window.addEventListener("keydown", function (e) {
        // The first key is also the audio gesture. Browsers will not start a
        // context without one, so there is no "autoplay on load" path here.
        crAudioInit();

        if (crAttractRunning && !e.repeat) { crExitAttract(); return; }

        var act = CR_KEYMAP[e.code];
        if (act) e.preventDefault();

        if (e.code === "KeyM" && !e.repeat) { crAudioToggleMute(); return; }
        if ((e.code === "Escape" || e.code === "KeyP") && !e.repeat) {
            if (crPhase === "play") crPaused = !crPaused;
            return;
        }
        if (e.code === "Enter" && !e.repeat) {
            if (crPhase === "menu" || crPhase === "over") crStartRun(false);
            return;
        }

        if (!act || e.repeat) {
            if (act) crKeys[act] = true;
            return;
        }
        crKeys[act] = true;

        // THE DASH, exactly as specified: "double tap left or right (or a/d)".
        // Detected on the key EDGE, because a held key repeats and a repeat is
        // not a tap. Shift is an alias for the same action -- the double-tap is
        // the asked-for trigger and this is the same move on one key.
        var me = crPlayers[0];
        if (me && (act === "left" || act === "right")) {
            var dir = act === "left" ? -1 : 1;
            if (me.tapDir === dir && me.tapTime > 0) { me.inp.dash = true; me.tapTime = 0; }
            else { me.tapDir = dir; me.tapTime = CR_PHYS.dashTapWindow; }
        }
        if (me && (e.code === "ShiftLeft" || e.code === "ShiftRight")) me.inp.dash = true;
        if (me && e.code === "KeyE") me.inp.bomb = true;
        if (me && e.code === "KeyQ") crSetCheckpoint(me);
        // The grapple is HELD: F down fires and holds, F up lets go.
        if (me && e.code === "KeyF") me.inp.grapple = true;
        if (me && act === "up") me.inp.jumpPressed = true;
    }, { signal: signal });

    window.addEventListener("keyup", function (e) {
        var act = CR_KEYMAP[e.code];
        if (act) crKeys[act] = false;
        var me = crPlayers[0];
        if (me && e.code === "KeyF") me.inp.grapple = false;
    }, { signal: signal });

    // A window that loses focus with a key held would otherwise keep running.
    window.addEventListener("blur", function () {
        for (var k in crKeys) crKeys[k] = false;
        // A rope still held when the window lost focus would hold forever.
        if (crPlayers[0]) crPlayers[0].inp.grapple = false;
    }, { signal: signal });

    window.addEventListener("resize", crResize, { signal: signal });
}

// Seat 0's held state, read once per fixed step. Edges (jumpPressed, dash,
// bomb) are written by the keydown handler and cleared by cr-physics.js, so
// they are deliberately not touched here.
function crReadKeyboard(b) {
    b.inp.left = !!crKeys.left;
    b.inp.right = !!crKeys.right;
    b.inp.up = !!crKeys.up;
    b.inp.down = !!crKeys.down;
    b.inp.jump = !!crKeys.up;
}

// ===================================================
//   RUN AND LEVEL FLOW
// ===================================================
function crStartRun(attract) {
    crAttractRunning = !!attract;
    crLevelIndex = 0;
    crScoreTotal = 0;
    crRunTime = 0;
    crLastDeath = "";
    crWinnerName = "";
    crFinishOrder.length = 0;

    var name = (typeof MP !== "undefined" && MP.selfName) ? MP.selfName : "P1";
    crPlayers = [];
    for (var i = 0; i < 4; i++) {
        // Seats 1-3 are bots "for now" (the spec's words). Seat 0 is a bot
        // only in attract mode, and it is the SAME body and the SAME physics
        // either way -- which is what makes the attract demo the real game.
        var pname = i === 0 ? name : ("BOT " + i);
        var b = crMakeBody(i, pname, i > 0 || !!attract);
        crPlayers.push(b);
    }
    crStartLevel(0);
}

function crStartLevel(index) {
    crLevelIndex = index;
    crLevel = crBuildLevel(index);
    crLevelTime = 0;
    crFinishOrder.length = 0;
    crClearTouched();
    crSpawnLevelItems(crLevel);

    // "players that fall to death don't continue on subsequent levels" -- so
    // the body list for this level is exactly the survivors, and a dead seat
    // simply is not here.
    crBodies = [];
    for (var i = 0; i < crPlayers.length; i++) {
        var p = crPlayers[i];
        if (!p.alive) continue;
        crResetBodyForLevel(p, crLevel.spawns[i]);
        p.ai = null;                 // a fresh brain per level: new route, new jitter
        crBodies.push(p);
    }

    crCam.x = 0; crCam.y = 0; crCam.shake = 0;
    /* THE WALL STARTS OFF-SCREEN. With a camera that no longer waits for
       anyone, the avalanche is at the screen's left edge from the first frame
       -- and the spawn catwalk is two columns in, so CONDITION read YELLOW
       before the countdown had finished. A sixth of a screen of head start is
       about four seconds of grace at level 1's scroll speed: enough to look at
       the cliff before it starts taking the cliff away. */
    crAvalancheX = -CR_VW * 0.16;
    crReadyLeft = 3;
    crReadyBeeped = -1;
    crPhase = "ready";
}

function crAliveCount() {
    var n = 0;
    for (var i = 0; i < crPlayers.length; i++) if (crPlayers[i].alive) n++;
    return n;
}

function crLevelSettled() {
    for (var i = 0; i < crBodies.length; i++) {
        var b = crBodies[i];
        if (b.alive && !b.finished) return false;
    }
    return true;
}

/*
 * Who won. Ranked on levels cleared first and score second, because this is a
 * race down ten levels and the person who got furthest beat the person who
 * collected more coins on the way to dying earlier.
 */
function crDecideWinner() {
    // Ranked in this order, and BEING ALIVE has to be in it: with the run
    // ending the moment the human dies, everyone is usually on zero levels
    // cleared, and ranking on that alone crowned the corpse -- the first
    // game-over screen read "RUN OVER / THE AVALANCHE TOOK YOU / WINNER P1".
    // Distance is the last tie-break because on a cliff this shape, further
    // right is simply further on.
    function better(p, q) {
        if (p.levelsCleared !== q.levelsCleared) return p.levelsCleared > q.levelsCleared;
        if (p.alive !== q.alive) return p.alive;
        if (p.score !== q.score) return p.score > q.score;
        return p.x > q.x;
    }
    var best = null;
    for (var i = 0; i < crPlayers.length; i++) {
        if (!best || better(crPlayers[i], best)) best = crPlayers[i];
    }
    return best;
}

function crEndRun(reason) {
    if (crPhase === "over") return;
    crPhase = "over";
    var winner = crDecideWinner();
    crWinnerName = winner ? winner.name : "NOBODY";

    var me = crPlayers[0];
    var total = crScoreTotal + (me ? me.score : 0);
    if (total > crHiScore) crHiScore = total;

    if (reason === "cleared") crSfxRunWin(); else crSfxRunOver();

    // Firestore, through the shared writer. It silently no-ops on file://
    // (dynamic import of a module), which is expected and not a bug --
    // GAME_PROTOTYPE_INSTRUCTIONS.md 5.
    if (!crAttractRunning && typeof LB !== "undefined" && me) {
        LB.submit({ player: me.name, score: total, round: me.levelsCleared });
    }
}

// ===================================================
//   THE STEP
// ===================================================
function crStep(dt) {
    crRunTime += dt;

    if (crPhase === "ready") {
        crReadyLeft -= dt;
        var n = Math.ceil(crReadyLeft);
        if (n !== crReadyBeeped && n >= 0) { crReadyBeeped = n; crSfxCountdown(n); }
        if (crReadyLeft <= 0) {
            crPhase = "play";
            crSfxLevelStart();
        }
        return;
    }

    if (crPhase === "between") {
        crBetweenLeft -= dt;
        if (crBetweenLeft <= 0) {
            if (crLevelIndex + 1 >= CR_LEVEL_COUNT) crEndRun("cleared");
            else crStartLevel(crLevelIndex + 1);
        }
        return;
    }

    if (crPhase !== "play") return;
    if (crPaused) return;

    crLevelTime += dt;
    if (crCam.shake > 0) crCam.shake = Math.max(0, crCam.shake - dt * 16);

    // ---- camera. The level's scroll speed is the FLOOR on pace; a leader past
    // 70% of the screen drags it forward, so a fast player is never held back
    // by the slow early levels and a slow one is never safe on the fast ones.
    /* THE CAMERA RUNS AT A FIXED RATE AND NOTHING SPEEDS IT UP.
     *
     * The user's call (2026-10-17): "the entire four-player game should slide
     * at a fixed rate, with the avalanche moving at a consistent speed the
     * whole time, all the way to the end", and players cannot pass the right
     * edge.
     *
     * It used to advance at the scroll speed AND be dragged forward whenever
     * someone got ahead -- first by the leader, then by second place. Both are
     * worse than this, and not only because the brief says so:
     *
     *   - a camera one player can drag is a camera that kills the other three,
     *     and on a 20-tile screen there is only ~13 tiles of slack to lose;
     *   - a pace you can change by running is a pace you have to think about,
     *     and the whole point of a wall chasing four people is that the clock
     *     is the same for everybody;
     *   - with a hard right edge the level's length and its scroll speed now
     *     fix its DURATION exactly (worldW / scroll), so a level's pacing is a
     *     thing the generator decides rather than an emergent property of how
     *     fast the fastest bot happens to be.
     *
     * crLevelTime drives it rather than accumulating, so a dropped frame or a
     * slow step cannot leave the camera behind where the avalanche thinks it is.
     */
    crCam.x = crClamp(crLevelTime * crLevel.spec.scroll, 0,
                      Math.max(0, crLevel.worldW - CR_VW));

    /* The avalanche is pinned to the camera -- a constant speed, the whole way
     * -- and keeps creeping once the camera clamps at the far outpost, because
     * something has to end a level where a body is wedged. A finished player is
     * exempt (crCheckFate returns early), so the creep cannot reach anyone
     * already standing on the catwalk.
     */
    crAvalancheX = Math.max(crAvalancheX, crCam.x + CR_VW * 0.05);
    if (crCam.x >= crLevel.worldW - CR_VW - 1) {
        crAvalancheX += crLevel.spec.scroll * dt;
    }

    // ---- world
    crUpdateTouched(crLevel, dt);
    crUpdateFalling(dt);
    crUpdateBombs(crLevel, dt);
    crUpdatePads(dt);
    crUpdateParticles(dt);

    // ---- controllers, then bodies, then contacts. Order matters: every body
    // integrates against the same tile state, and pairs are resolved after
    // all of them have moved, so a resolution cannot be undone by a body that
    // had not stepped yet.
    for (var i = 0; i < crBodies.length; i++) {
        var p = crBodies[i];
        if (p.bot) crBotThink(crLevel, p, dt);
        else crReadKeyboard(p);
    }
    for (i = 0; i < crBodies.length; i++) crStepBody(crLevel, crBodies[i], dt);
    crResolvePairs(crLevel);
    for (i = 0; i < crBodies.length; i++) crCheckFate(crLevel, crBodies[i]);

    // ---- end conditions
    // "if at any point there are only bots alive the game should end and the
    // player character winner is announced". The human being PARKED on a
    // catwalk is not that -- they are alive and waiting, which is what the
    // finish is for. Only their death ends it.
    var me = crPlayers[0];
    if (!me.alive) {
        for (i = 0; i < crBodies.length; i++) {
            if (crBodies[i].alive && !crBodies[i].finished) crBodies[i].levelsCleared += 0;
        }
        crEndRun("dead");
        return;
    }

    if (crLevelSettled()) {
        for (i = 0; i < crBodies.length; i++) {
            var s = crBodies[i];
            if (s.alive && s.finished) s.levelsCleared++;
        }
        crScoreTotal += me.score;
        me.score = 0;
        crPhase = "between";
        crBetweenLeft = 2.0;
        crSfxLevelEnd();
    }
}

// ===================================================
//   THE LOOP
// ===================================================
function crLoop(now) {
    crRaf = requestAnimationFrame(crLoop);
    var dt = (now - crLastT) / 1000;
    crLastT = now;
    if (!isFinite(dt) || dt < 0) dt = 0;

    crAccum += dt;
    var steps = 0;
    while (crAccum >= CR_STEP && steps < CR_MAX_STEPS) {
        crStep(CR_STEP);
        crAccum -= CR_STEP;
        steps++;
    }
    if (steps >= CR_MAX_STEPS) crAccum = 0;

    crFrame++;
    crRender();
    crPanelFrame();
    crAudioFrame(crLevel, crPlayers[0] && crPlayers[0].alive ? crPlayers[0] : (crBodies[0] || null));
}

// ===================================================
//   ATTRACT MODE
// ===================================================
// 4.8, "the most era-defining behaviour in the document", and here it costs a
// boolean: the bots already drive three seats, so the demo is the real game
// with a fourth bot writing seat 0's input.
function crEnterAttract() {
    if (crPhase === "play" || crPhase === "ready" || crPhase === "between") return;
    crStartRun(true);
}

function crExitAttract() {
    if (!crAttractRunning) return;
    crAttractRunning = false;
    crPhase = "menu";
    crShowMenu(true);
}

function crShowMenu(show) {
    var m = document.getElementById("menu");
    if (m) m.hidden = !show;
}

// ===================================================
//   HUB SHELL: window.GameInstance
// ===================================================
// GAME_PROTOTYPE_INSTRUCTIONS.md 2: the hub links to each game as a full page
// rather than embedding it, so destroy() is not load-bearing at runtime yet.
// Written to the contract anyway, for the reason that doc gives -- cheap up
// front, expensive to retrofit -- and because a new game has no excuse.
window.GameInstance = {
    init: function (config) {
        crLoadInk();

        crCanvas = document.getElementById("game");
        crCtx = crCanvas ? crCanvas.getContext("2d") : null;
        if (crCtx) {
            crCtx.imageSmoothingEnabled = false;
            crCtx.textAlign = "center";
            crCtx.textBaseline = "middle";
        }

        // Safe to call more than once: the previous controller is aborted
        // rather than leaked.
        if (crListeners) crListeners.abort();
        crListeners = new AbortController();
        crAttachInput(crListeners.signal);

        crPanelInit();
        crResize();

        if (typeof LB !== "undefined") LB.configure({ game: "cliff-run" });

        // RETRO.attract REFUSES to attach listeners without a signal -- it
        // warns and returns an inert handle rather than leaking something
        // destroy() cannot remove.
        if (typeof RETRO !== "undefined" && RETRO.attract) {
            crAttractCtl = RETRO.attract({
                idleMs: 20000,
                signal: crListeners.signal,
                onEnter: crEnterAttract,
                onExit: crExitAttract
            });
        }

        /*
         * IDENTITY ONLY. There is no multiplayer in this pass (see
         * cliff-run/SERVER_NOTES.md for what wiring it would take) -- this
         * call exists so that the colour the player wears on the cliff is the
         * colour they wore on the board, which is the one thing identity has
         * to get right whether or not a server is involved. MP.selfColor is
         * server-authoritative when there IS a server; IDENTITY.colorFromName
         * is the file:// fallback, and it is the only name->colour path in
         * this game.
         */
        if (typeof MP !== "undefined" && MP.connect) {
            MP.connect({
                game: "cliff-run",
                onReady: function () {
                    for (var i = 0; i < crPlayers.length; i++) {
                        if (crPlayers[i].seat !== 0) continue;
                        if (MP.selfName) crPlayers[i].name = MP.selfName;
                        crPlayers[i].color = MP.selfColor || crColorForName(crPlayers[i].name);
                    }
                }
            });
        }

        // A menu-shaped idle state, so attract mode has something to come back
        // to and the first frame is not an empty black screen.
        crPhase = "menu";
        crPlayers = [];
        for (var i = 0; i < 4; i++) crPlayers.push(crMakeBody(i, i === 0 ? "P1" : "BOT " + i, i > 0));
        crLevel = crBuildLevel(0);
        crSpawnLevelItems(crLevel);
        crBodies = [];
        crShowMenu(true);
        void config;
    },

    start: function () {
        if (crRaf !== null) cancelAnimationFrame(crRaf);
        crLastT = performance.now();
        crAccum = 0;
        crRaf = requestAnimationFrame(crLoop);
    },

    pause: function () {
        if (crRaf !== null) { cancelAnimationFrame(crRaf); crRaf = null; }
        crPaused = true;
    },

    resume: function () {
        crPaused = false;
        if (crRaf !== null) return;
        crLastT = performance.now();
        crAccum = 0;
        crRaf = requestAnimationFrame(crLoop);
    },

    destroy: function () {
        if (crRaf !== null) { cancelAnimationFrame(crRaf); crRaf = null; }
        if (crListeners) { crListeners.abort(); crListeners = null; }
        crClearAllTracked();
        if (crAttractCtl) { crAttractCtl.destroy(); crAttractCtl = null; }
        crBodies = [];
        crCoins.length = 0; crPickups.length = 0; crBombs.length = 0;
        crFalling.length = 0; crParticles.length = 0;
        crClearTouched();
        // Browsers cap live AudioContexts per page, so an init/destroy cycle
        // that never closes one eventually fails to create another.
        crAudioDestroy();
    },

    getState: function () {
        return {
            phase: crPhase,
            paused: crPaused,
            attract: crAttractRunning,
            level: crLevelIndex + 1,
            of: CR_LEVEL_COUNT,
            levelTime: Number(crLevelTime.toFixed(2)),
            scroll: crLevel ? Math.round(crLevel.spec.scroll) : 0,
            camX: Math.round(crCam.x),
            avalancheX: Math.round(crAvalancheX),
            winner: crWinnerName,
            lastDeath: crLastDeath,
            players: crPlayers.map(function (p) {
                return {
                    seat: CR_SEAT_NAMES[p.seat],
                    name: p.name,
                    bot: p.bot,
                    alive: p.alive,
                    finished: p.finished,
                    cause: p.deathCause,
                    levels: p.levelsCleared,
                    coins: p.coins,
                    score: p.score,
                    x: Math.round(p.x),
                    y: Math.round(p.y),
                    charges: p.djCharges,
                    bombs: p.bombs,
                    wp: p.ai ? p.ai.routeIdx : -1
                };
            })
        };
    }
};

// The Start button in the markup is a plain onclick, so it needs a global.
window.crBegin = function () {
    crAudioInit();
    crShowMenu(false);
    crStartRun(false);
};

window.GameInstance.init();
window.GameInstance.start();
