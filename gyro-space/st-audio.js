// ===================================================
//   Space Tracer — sample-based audio
// ===================================================
// Split out of space-tracer.html's inline script 2026-09-04 (Pass A of
// gyro-space/ST_PASS_PLAN.md). Lines were MOVED VERBATIM and IN SOURCE ORDER --
// nothing was reordered, because this game's load-time statements are scattered
// through its sections rather than gathered at the end. Keeping the order is
// what makes the split safe.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). NOT touched by the aesthetic pass -- §6.1 says leave audio alone, and the mobile freeze bug is unrelated and still open.
"use strict";

// ===================================================
//                    AUDIO SYSTEM
// ===================================================
const sounds = {
    standardShot: [
        new Audio("pit-pit-pit-1.mp3"),
        new Audio("pit-pit-pit-2.mp3"),
        new Audio("pit-pit-pit-3.mp3")
    ],
    chargedBeam: new Audio("thwop.mp3"),
    chargeSound: new Audio("thwop-charge.mp3")
};

sounds.standardShot.forEach(sound => sound.preload = "auto");
sounds.chargedBeam.preload = "auto";
sounds.chargeSound.preload = "auto";

function getRandomStandardShot() {
    const index = Math.floor(Math.random() * sounds.standardShot.length);
    return sounds.standardShot[index];
}

function playLocalSound(shotType) {
    if (!audioEnabled) return;

    let sound = shotType === "standard" ? getRandomStandardShot() : sounds.chargedBeam;
    sound.currentTime = 0;
    sound.volume = 1.0;
    sound.play().catch(e => {});
}

function playRemoteShotSound(remoteX, remoteY, shotType) {
    if (!audioEnabled) return;

    const dist = Math.hypot(remoteX - ship.x, remoteY - ship.y);
    const maxHearRange = 5000;
    
    if (dist > maxHearRange) return;
    
    let sound = shotType === "standard" ? getRandomStandardShot() : sounds.chargedBeam;
    const volume = Math.max(0.1, 1 - (dist / maxHearRange));
    sound.volume = volume;
    
    sound.currentTime = 0;
    sound.play().catch(e => {});
}

function startBeamChargeAudio() {
    if (!audioEnabled) return;
    sounds.chargeSound.currentTime = 0;
    sounds.chargeSound.volume = 1.0;
    sounds.chargeSound.play().catch(e => {});
}

function updateBeamChargeAudio() {
    if (!audioEnabled || !isChargingBeam) return;
    
    // Check if we should be playing charge sound (only after 0.5s hold)
    const now = Date.now();
    const holdTime = now - beamChargeStartTime;
    
    if (holdTime < MIN_CHARGE_TIME) {
        // Don't play charge sound yet
        return;
    }
    
    // If audio is not currently playing, start it
    if (sounds.chargeSound.paused) {
        sounds.chargeSound.currentTime = 0;
        sounds.chargeSound.volume = 1.0;
        sounds.chargeSound.play().catch(e => {});
    }
    
    // Loop last 0.5s of charge sound continuously
    if (sounds.chargeSound.duration > 0.5) {
        const loopStart = sounds.chargeSound.duration - 0.5;
        // If reached end or near end, reset to loop point
        if (sounds.chargeSound.currentTime >= sounds.chargeSound.duration - 0.1) {
            sounds.chargeSound.currentTime = loopStart;
        }
    }
}

function stopBeamChargeAudio() {
    sounds.chargeSound.pause();
    sounds.chargeSound.currentTime = 0;
}

