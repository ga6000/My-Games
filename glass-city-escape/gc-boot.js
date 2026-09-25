/**
 * Glass City Escape — initialisation and connect
 *
 * Split out of glass_city_escape.html's inline script 2026-09-04 (Pass A of
 * glass-city-escape/GCE_PASS_PLAN.md). The lines below were MOVED VERBATIM --
 * Pass A deliberately changed no behaviour, so that any regression could be
 * attributed to the skin pass that followed rather than to the split.
 *
 * Classic scripts, one shared global scope, no modules (the file:// hard
 * constraint). Loads LAST and is the ONLY file that executes anything.
 */
"use strict";

/**
 * Initialization
 */
let player = new Player(0,0); // Dummy init

function initGame() {
    initAudio();
    // The sustained voices (gc-audio.js) hang off the context initAudio() just
    // built, so this has to follow it. Safe to call twice.
    gcAudioStart();
    document.getElementById('start-menu').style.display = 'none';
    
    // An on-screen D-pad used to be switched on here behind a
    // ('ontouchstart' in window || navigator.maxTouchPoints > 0) sniff. It was
    // removed 2026-09-04 -- the friend group plays on desktop. Keyboard was
    // always set up unconditionally, so it is now simply the only input path.
    // See SCOPE_PULLBACK_PLAN.md.
    setupKeyboardControls();
    
    resize();
    window.addEventListener('resize', resize);

    generateWorld();
    spawnLevelContents();

    const sp = spawnPoint();
    player.x = sp.x; player.y = sp.y; player.z = 0;

    updateHealthUI();
    updateFloorUI(0);
    document.getElementById('stage-counter').innerText = 'STAGE: ' + currentStage;
    
    // After spawnCollectibles, so the run records the core target it was
    // actually given rather than the previous stage's.
    gcTelemetryStartRun();

    gameRunning = true;
    lastTime = performance.now();
    requestAnimationFrame(gameLoop);
}

function updateFloorUI(z) { document.getElementById('level-counter').innerText = 'FLOOR: ' + z; }
function updateCollectUI() {
    // Reads DEPOSITED, not picked up -- the number that gates the exit is the
    // one on the pedestals. What you are carrying is shown on the player.
    document.getElementById('collect-counter').innerText =
        `CORES: ${coresDeposited} / ${totalCollectibles}` + (player.carrying ? '  [+1 HELD]' : '');
}

/**
 * PIXEL HEARTS, drawn on their own canvas (2026-09-06).
 *
 * Was 20 emoji glyphs in a flex-wrap that ran to three rows and covered a
 * quarter of the play area. Nine hearts fit one row, and drawing them as
 * fillRect blocks is what makes the bar belong to the same raster cabinet as
 * everything else -- an emoji ❤️ is a full-colour vector glyph rendered by the
 * OS, which is the single least raster thing that could be on the screen.
 *
 * HEART is a bitmap, so the shape is data rather than a sequence of drawing
 * calls nobody can picture.
 */
const HEART_PIXELS = [
    "0110110",
    "1111111",
    "1111111",
    "0111110",
    "0011100",
    "0001000"
];
const HEART_PX = 3;                 // screen px per heart pixel
const HEART_GAP = 5;

// Set when a heart is restored, so the bar can flash the one that came back.
let healthFlashAt = 0;
let healthFlashIndex = -1;

function updateHealthUI() {
    const cv = document.getElementById('health-canvas');
    if (!cv) return;
    const w = HEART_PIXELS[0].length * HEART_PX;
    const h = HEART_PIXELS.length * HEART_PX;
    cv.width = (w + HEART_GAP) * player.maxHealth;
    cv.height = h + 2;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);

    const now = performance.now();
    const flashing = (now - healthFlashAt) < 420;

    for (let i = 0; i < player.maxHealth; i++) {
        const full = i < player.health;
        let fill;
        if (!full) fill = 'rgba(255,46,136,0.18)';
        else if (flashing && i === healthFlashIndex) {
            // The restored heart flashes hot, so regen is visible on the BAR
            // and not only as a number that silently changed.
            fill = (Math.floor(now / 70) % 2) ? INK.hot : INK.magenta;
        } else if (player.health <= LOW_HEALTH_AT) {
            // Low health pulses the whole bar in time with the heartbeat.
            const p = 0.55 + 0.45 * Math.sin(now / 160);
            fill = 'rgba(255,46,136,' + p.toFixed(2) + ')';
        } else fill = INK.magenta;

        c.fillStyle = fill;
        const ox = i * (w + HEART_GAP);
        for (let ry = 0; ry < HEART_PIXELS.length; ry++) {
            const row = HEART_PIXELS[ry];
            for (let rx = 0; rx < row.length; rx++) {
                if (row[rx] === '1') c.fillRect(ox + rx * HEART_PX, 1 + ry * HEART_PX, HEART_PX, HEART_PX);
            }
        }
    }
}


/**
 * MP.connect() moved here from the multiplayer section 2026-09-04.
 *
 * It runs at LOAD, and its onReady can fire synchronously on the solo /
 * file:// path -- where it reaches rebuildWorldFromSeed() and gameRunning,
 * declared in other files. Running it after every declaration removes that
 * ordering hazard outright rather than reasoning about whether it holds.
 */
// Tokens are read once, here, because gc-boot is the only file that executes
// and by now retro.css has certainly parsed.
loadInkFromCss();
if (typeof LB !== "undefined") LB.configure({ game: "glass-city-escape" });

MP.connect({
    game: "glass-city-escape",
    onReady: function (info) {
        mpReady = true;
        netOnline = !info.solo;
        baseSeed = info.seed;
        // If the player hit Start before the seed arrived, the city they
        // got was built from a throwaway local seed. Rebuild it now so
        // they're racing the same course as everyone else.
        if (gameRunning) rebuildWorldFromSeed();
    },
    onStatus: function (s) { netOnline = (s === "online"); },
    onPeerLeave: function (peer) { if (peer) delete ghosts[peer.id]; },
    onMessage: function (msg, fromId, fromName) {
        if (!msg || !msg.k) return;

        if (msg.k === "pos") {
            // The ghost update moved into gc-net.js (2026-09-20): it reads the
            // sender's level now, and a level going up is a clear for the feed.
            receiveGhostPos(msg, fromId, fromName);
            return;
        }

        // "finish" is no longer handled (2026-09-20). It ended the run at the
        // tunnel whenever anyone else was in the room; the level in `pos`
        // carries the race now. A cached old client that still sends one is
        // ignored, which is all it needs.
    }
});

// Exposed for the Start button in the markup, which is plain onclick.
window.startGame = initGame;
