// ===================================================
//   Space Tracer — mouse, start-screen flow, audio and GUI toggles
// ===================================================
// Split out of space-tracer.html's inline script 2026-09-04 (Pass A of
// gyro-space/ST_PASS_PLAN.md). Lines were MOVED VERBATIM and IN SOURCE ORDER --
// nothing was reordered, because this game's load-time statements are scattered
// through its sections rather than gathered at the end. Keeping the order is
// what makes the split safe.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). Registers listeners at load; kept in its original position so that ordering is unchanged.
"use strict";

// ===================================================
//       MOUSE DOWN/UP FOR CHARGED BEAM
// ===================================================
canvas.addEventListener("mousedown", (e) => {
    if (e.target !== canvas || !gameStarted) return;

    // Dead players don't shoot. Gating the press (rather than only the
    // release) also means no charge ring or charge audio starts up while
    // waiting out the 2s respawn.
    if (!ship.isAlive) return;

    // Can only start charging if cooldown is complete
    const now = Date.now();
    if (now < beamCooldownEnd) {
        return;
    }
    
    isChargingBeam = true;
    beamChargeStartTime = Date.now();
});

canvas.addEventListener("mouseup", (e) => {
    if (e.target !== canvas || !gameStarted) return;

    const holdTime = Date.now() - beamChargeStartTime;
    cancelBeamCharge();

    // Died mid-hold (or the press itself was rejected while dead): the
    // charge is already cancelled above, so just swallow the release
    // rather than letting it fire a shot from a dead ship.
    if (!ship.isAlive) return;

    // Only fire if held long enough
    const shotType = holdTime >= 3000 ? "beam" : "standard";
    
    // Check cooldown (should not happen if we prevented charging, but safety check)
    if (shotType === "beam" && Date.now() < beamCooldownEnd) {
        return;
    }

    fireLaser(ship.x, ship.y, ship.angle, ship.color, shotType, myPlayerId);
    playLocalSound(shotType); // Plays thwop on release of beam

    // IMPORTANT: Queue shot for network broadcast
    pendingShot = {
        x: Number(ship.x.toFixed(1)),
        y: Number(ship.y.toFixed(1)),
        angle: Number(ship.angle.toFixed(2)),
        type: shotType
    };
    
    console.log("Shot fired:", pendingShot);

    if (shotType === "beam") {
        beamCooldownEnd = Date.now() + 5000;
    }
});

// ===================================================
//              START SCREEN SYSTEM
// ===================================================
const startScreenContainer = document.getElementById("startScreenContainer");
// The flow is: title -> (name/room, only if you didn't come from the hub)
// -> press to enter -> game.
//
// The mode-select screen that used to sit between title and name was
// deleted 2026-09-04 with the rest of mobile support -- it only ever asked
// MOBILE or COMPUTER.
//
// Removing it exposed a latent bug worth recording. #screen1-title WAS
// still in the DOM (an older note here claimed it had been cut -- it had
// not), but nothing ever listened for a click on it. It "worked" purely
// because the mode screen was drawn on top of it and took the click. Delete
// the mode screen and the title becomes an opaque dead end. So the title now
// carries the click handler that advances the flow, which is what it always
// looked like it did.
const screenTitle = document.getElementById("screen1-title");
const screenName = document.getElementById("screen3-name");
const screenEnter = document.getElementById("screen4-enter");

// Initialize screen display states
screenTitle.style.display = "flex";
screenName.style.display = "none";
screenEnter.style.display = "none";

const playerNameInput = document.getElementById("playerNameInput");
const roomCodeInput = document.getElementById("roomCodeInput");
const nameSubmitBtn = document.getElementById("screen3-submit");
const enterGameBtn = document.getElementById("screen4-enter-btn");

// What the hub already recorded: URL params first, then localStorage.
// Read through MP so the lookup order lives in exactly one place.
const hubIdentity = MP.identity();
const cameFromHub = !!hubIdentity.name;

let playerName = hubIdentity.name || "";
let roomCode = hubIdentity.room || "";

// Only ever seen on the direct-open path, but prefill anyway so a
// returning player isn't retyping something already stored.
playerNameInput.value = playerName;
roomCodeInput.value = roomCode === "PUBLIC" ? "" : roomCode;

// Screen 3 asked for a name and room code that the hub collected one
// click earlier. Being asked twice was the most visible symptom of this
// game running its own separate identity system, so it's skipped when
// the answer is already known.
function afterTitle() {
    screenTitle.style.display = "none";

    if (cameFromHub) {
        // Straight to press-to-enter. That button stays either way: it is
        // the user gesture browsers require before audio will play, so it
        // is load-bearing rather than ceremony. (That was written as a
        // mobile constraint; desktop autoplay policy needs a gesture too,
        // which is why it survived mobile support being switched off.)
        screenEnter.style.display = "flex";
    } else {
        screenName.style.display = "flex";
    }
}

// Screen: title. "CLICK TO START" now actually does.
screenTitle.addEventListener("click", afterTitle);

// Screen: Enter name + room code
nameSubmitBtn.addEventListener("click", () => {
    playerName = playerNameInput.value.trim();
    // Room code is normalized to uppercase so "abcd" and "ABCD" are the
    // same room -- matches how the room code is displayed everywhere else.
    roomCode = roomCodeInput.value.trim().toUpperCase();
    screenName.style.display = "none";
    screenEnter.style.display = "flex";
});

// Allow Enter key to submit from either field
playerNameInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") nameSubmitBtn.click();
});
roomCodeInput.addEventListener("keypress", (e) => {
    if (e.key === "Enter") nameSubmitBtn.click();
});

// Screen: Enter game
enterGameBtn.addEventListener("click", () => {
    gameStarted = true;
    ship.name = playerName; // Set player name on ship
    startScreenContainer.style.display = "none";
    overlay.style.display = "block"; // Show dev overlay during game

    // Now that the player has chosen a name/room, join the room on the
    // server. Nothing before this point sends "update" -- the server
    // ignores update messages until join-room arrives, so this ordering
    // matters, not just style.
    joinRoom(roomCode, playerName);
    lifeStartTime = Date.now(); // First life's clock starts now, not at page load
    lifeStartX = ship.x;
    lifeStartY = ship.y;
    if (scoreDisplayEl) scoreDisplayEl.style.display = "block";
    updateScoreDisplay();
    updateScoreboardDisplay(); // Show the panel now -- don't wait on another player's score-update to arrive first, or a solo player never sees it
    seedAsteroidField(); // One-time, here rather than on page load -- asteroids shouldn't drift/exist while sitting on the start screens
    const dashMeterContainerEl = document.getElementById("dashMeterContainer");
    if (dashMeterContainerEl) dashMeterContainerEl.style.display = "block";

    camera.zoom = ZOOM_SETTINGS.desktop;
});
// Three things used to sit here and went with mobile support on 2026-09-04:
// the mobile branch of this zoom switch, the #menuOverlay hide (that overlay
// was already dead code -- nothing ever showed it), and the mobile dash
// button.s two touch handlers. Dash is [SPACE], handled by the keydown/keyup
// pair further down.

// ===================================================
//            AUDIO TOGGLE HANDLER
// ===================================================
audioToggleBtn.addEventListener("click", () => {
    audioEnabled = !audioEnabled;
    if (audioEnabled) {
        bgMusic.play().catch(() => {});
        audioToggleBtn.textContent = "Audio: ALL ON";
    } else {
        bgMusic.pause();
        stopBeamChargeAudio();
        audioToggleBtn.textContent = "Audio: ALL OFF";
    }
});

// ===================================================
//            GUI TOGGLE HANDLER
// ===================================================
guiToggleBtn.addEventListener("click", () => {
    guiVisible = !guiVisible;
    if (guiVisible) {
        overlay.style.display = "block";
        guiToggleBtn.style.opacity = "1";
    } else {
        overlay.style.display = "none";
        guiToggleBtn.style.opacity = "0.3";
    }
});

