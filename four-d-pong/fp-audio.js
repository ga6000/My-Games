// ===================================================
//   4D Pong -- audio
// ===================================================
// WHAT THIS FILE REPLACED
// The old file loaded Tone.js from cdnjs and built four Tone synths on
// window.onload. That is a CDN <script>, so on a double-clicked page it does
// not exist -- and the audio was not the only casualty: `Tone.start()` was
// called from the keydown that begins the game, so the reference throwing took
// the START handler down with it. A file:// player got a silent game that
// would not start. This repo's FIRST hard constraint, broken since 2026-08-24.
//
// shared/sfx.js owns everything general: the AudioContext, the gesture unlock,
// the hard-envelope tone shape ( 4.10: square and triangle, no reverb), the
// mute preference and the two jingles that should sound identical in every
// game. This file owns only what is specific to 4D Pong.
//
// NO JS TIMERS. Multi-note figures schedule on the AudioContext's own clock
// through SFX.tone's `at`, which is sample-accurate and needs no tracking --
// the same reason shared/sfx.js has none either.
//
// Every entry point is a no-op when SFX is missing or muted, because a game
// must never fail to run because a sound could not play.
"use strict";

function initAudio() {
    if (typeof SFX === "undefined") return;
    // configure() NAMESPACES the stored mute preference. Without it every game
    // on this origin shares one key, which is how muting Zombie silently mutes
    // this game and presents as broken audio rather than as a shared setting.
    SFX.configure({ game: "four-d-pong", volume: 0.7 });
    muted = SFX.isMuted();
    if (listeners) SFX.unlockOn(window, listeners.signal);
}

function toggleMute() {
    if (typeof SFX === "undefined") return false;
    muted = SFX.toggleMute();
    return muted;
}

// ===================================================
//   THE RALLY IS AUDIBLE
// ===================================================
// Pitch climbs with the rally and resets on a goal, so how long a point has
// been going is something you HEAR rather than something you have to have been
// watching. This is the one piece of audio design here that is genuinely this
// game's own -- everything else is a named event.
//
// Capped at 24 steps: an unbounded climb walks straight out of the audible
// range mid-rally and the paddle simply goes quiet, which reads as a bug.
var RALLY_BASE = 392;      // G4
var RALLY_STEP = 1.045;    // a little under a semitone per hit
var RALLY_CAP = 24;

function sfxPaddle(hits) {
    if (typeof SFX === "undefined") return;
    var n = Math.min(hits || 1, RALLY_CAP);
    SFX.tone({
        freq: RALLY_BASE * Math.pow(RALLY_STEP, n),
        dur: 0.035, type: "square", gain: 0.22, release: 0.03
    });
}

// A wall must never sound like a paddle, or a player learns nothing from it.
// Lower, shorter, triangle rather than square.
function sfxWall() {
    if (typeof SFX === "undefined") return;
    SFX.tone({ freq: 174, dur: 0.03, type: "triangle", gain: 0.18, release: 0.03 });
}

// ===================================================
//   GOALS -- the first note names the AXIS
// ===================================================
// With four goals live, "somebody scored" is not enough information: you need
// to know which rope just moved without looking away from the ball. A vertical
// goal opens a fifth higher than a horizontal one, so the axis is legible from
// the sound alone.
function sfxGoal(scoringSeat) {
    if (typeof SFX === "undefined") return;
    var vertical = axisOf(scoringSeat) === 1;
    var head = vertical ? 587.33 : 392.00;      // D5 vs G4
    SFX.sequence(
        [{ freq: head }, { freq: head * 0.63 }],
        { type: "triangle", step: 0.1, dur: 0.09, gain: 0.26 }
    );
    sfxTugCreak();
}

// The rope creaking under the barbell as it slides. This game's signature
// sound: a low triangle that sags in pitch, under the goal tone rather than
// after it, so a goal and its consequence arrive as one event.
function sfxTugCreak() {
    if (typeof SFX === "undefined") return;
    SFX.tone({ freq: 98, slideTo: 62, dur: 0.34, type: "triangle", gain: 0.2, attack: 0.02, release: 0.12 });
}

// ===================================================
//   ABILITIES
// ===================================================
// SFX.shoot / hit / pickup are the shared vocabulary -- 4.10's reasoning is
// the same as 2.2's for the Signal Three: a player who has learnt that a
// rising triad means "you got it" should not have to relearn it per game.
function sfxBlaster(hot) {
    if (typeof SFX === "undefined") return;
    if (hot) {
        // The desperation machine gun. Thinner and higher, so a comeback is
        // audible from across the room.
        SFX.tone({ freq: 1500, slideTo: 620, dur: 0.05, type: "sawtooth", gain: 0.14 });
    } else {
        SFX.shoot();
    }
}

function sfxStun() { if (typeof SFX !== "undefined") SFX.hit(); }
function sfxPowerup() { if (typeof SFX !== "undefined") SFX.pickup(); }

// ===================================================
//   COUNTDOWN AND RESULT
// ===================================================
function sfxCountdown(n) {
    if (typeof SFX === "undefined") return;
    if (n > 0) SFX.tone({ freq: 523.25, dur: 0.07, type: "square", gain: 0.2 });
    else SFX.tone({ freq: 783.99, dur: 0.16, type: "square", gain: 0.24 });
}

// The winner gets a rising triad; everyone else gets shared/sfx.js's death
// jingle. Both are scheduled in one call each -- no timers.
function sfxWin() {
    if (typeof SFX === "undefined") return;
    SFX.sequence([392.00, 523.25, 659.25, 783.99], { type: "square", step: 0.11, dur: 0.1, gain: 0.26 });
}

function sfxLose() { if (typeof SFX !== "undefined") SFX.death(); }

// Menu movement. Quiet on purpose: a UI blip that competes with the game is a
// UI blip people turn the volume down for.
function sfxUi() {
    if (typeof SFX === "undefined") return;
    SFX.blip(660);
}
