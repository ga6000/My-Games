/**
 * Glass City Escape — the sustained voices (2026-09-05)
 *
 * Added by the Hunt pass, GCE_HUNT_PASS_PLAN.md §6. Five sounds were asked
 * for: footsteps, dash, a drone that gets louder with closeness, a pursuit
 * tune, and a laser-sight tone. Four of the five are CONTINUOUS, which is why
 * they are not in gc-core.js next to the one-shot playTone() jingles.
 *
 * ---------------------------------------------------------------------------
 * WHY NOT shared/sfx.js
 * ---------------------------------------------------------------------------
 * SFX is a one-shot vocabulary: SFX.tone() creates an oscillator, schedules a
 * hard envelope and stops it. There is no primitive for a voice that stays up
 * and is modulated frame by frame -- a drone whose gain tracks the distance to
 * the nearest robot, a sight tone gated on lock, a loop that starts and stops
 * with the pursuit state. Loading sfx.js anyway would also put a SECOND
 * AudioContext on this page, next to the one gc-core.js already creates in
 * initAudio(), and browsers cap live contexts per page.
 *
 * So this is a game-local layer on the EXISTING context. gcVoice() below is
 * the shape to lift into shared/ if a sustained-voice primitive is ever wanted
 * repo-wide; nothing here is specific to this game except the frequencies.
 *
 * ---------------------------------------------------------------------------
 * NO JS TIMERS, DELIBERATELY
 * ---------------------------------------------------------------------------
 * Root CLAUDE.md requires every timer to go through trackTimeout/trackInterval.
 * Nothing here needs one. The pursuit loop is scheduled a bar ahead against
 * audioCtx.currentTime and pumped from gameLoop(), which already runs every
 * frame -- the audio clock is not a JS timer, needs no tracking, and is
 * sample-accurate rather than subject to frame jitter. Same reasoning
 * shared/sfx.js records for itself.
 *
 * Classic script, one shared global scope. Declarations only; gc-boot.js calls
 * gcAudioStart(). Every entry point is wrapped -- audio is never worth
 * breaking a frame over.
 */
"use strict";

let gcAudioMaster = null;
let gcAudioMuted = false;

// The three sustained voices. Each is {osc, gain, ...} or null until started.
let gcDroneVoice = null;
let gcSightVoice = null;
let gcVerticalVoice = null;   // "something is on the floor above/below you"
let gcVerticalPhase = 0;

// Pursuit-tune scheduler state, all on the AudioContext clock.
let gcPursuitOn = false;
let gcPursuitNextBar = 0;

const GC_DRONE_RANGE = 700;       // px at which a Surveyor stops being audible
const GC_PURSUIT_STEP = 0.155;    // seconds per note
const GC_PURSUIT_NOTES = [146.83, 220.00, 174.61, 220.00]; // D3 A3 F3 A3, minor and driving

/**
 * One sustained voice: an oscillator that is started once and never stopped,
 * with a gain node the game ramps. Starting and stopping oscillators per event
 * is what one-shots do; a drone that clicked on and off every time a robot
 * crossed GC_DRONE_RANGE would be unlistenable.
 *
 * The optional lowpass is what makes the drone read as DISTANCE rather than
 * just volume -- a far-off machine is muffled as well as quiet, and the ear
 * reads the cutoff sweep as approach more strongly than it reads the gain.
 */
function gcVoice(type, freq, opts) {
    if (!audioCtx || !gcAudioMaster) return null;
    const o = opts || {};
    try {
        const osc = audioCtx.createOscillator();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, audioCtx.currentTime);
        if (typeof o.detune === "number") osc.detune.setValueAtTime(o.detune, audioCtx.currentTime);

        const gain = audioCtx.createGain();
        gain.gain.setValueAtTime(0, audioCtx.currentTime);

        let filter = null;
        if (o.lowpass) {
            filter = audioCtx.createBiquadFilter();
            filter.type = "lowpass";
            filter.frequency.setValueAtTime(o.lowpass, audioCtx.currentTime);
            osc.connect(filter);
            filter.connect(gain);
        } else {
            osc.connect(gain);
        }

        gain.connect(gcAudioMaster);
        osc.start();
        return { osc: osc, gain: gain, filter: filter };
    } catch (e) {
        return null;
    }
}

// Ramp a voice toward a level. The 0.08s glide is deliberate: stepping a gain
// value per frame produces zipper noise, which is the giveaway that a sound is
// being driven by a game loop rather than played.
function gcVoiceLevel(voice, level, timeConstant) {
    if (!voice) return;
    try {
        const t = audioCtx.currentTime;
        voice.gain.gain.cancelScheduledValues(t);
        // The default 0.08 is the anti-zipper smoothing. A caller driving an
        // audible RHYTHM has to pass something shorter, or the ramp averages
        // the pulse away and the rhythm never reaches the speaker -- which is
        // what happened to the vertical warning tone on the first attempt.
        voice.gain.gain.setTargetAtTime(Math.max(0, level), t,
                                        typeof timeConstant === "number" ? timeConstant : 0.08);
    } catch (e) { /* ignore */ }
}

/**
 * Called from initGame(), after initAudio() has built the context. Safe to
 * call twice.
 */
function gcAudioStart() {
    if (!audioCtx || gcAudioMaster) return;
    try {
        gcAudioMaster = audioCtx.createGain();
        gcAudioMaster.gain.value = gcAudioMuted ? 0 : 1;
        gcAudioMaster.connect(audioCtx.destination);

        // Two saws a few cents apart beat against each other, which is what
        // makes a drone sound like machinery instead of a test tone.
        gcDroneVoice = gcVoice("sawtooth", 41.2, { lowpass: 240, detune: 11 });
        gcSightVoice = gcVoice("triangle", 1720, {});
        // Deliberately a DIFFERENT timbre from the drone, not just a different
        // level: a square an octave and a half up, pulsed. If "above you" were
        // the same hum louder, it would be indistinguishable from "closer on
        // this floor" -- which is the exact confusion it exists to prevent.
        gcVerticalVoice = gcVoice("square", 392, { lowpass: 1400 });
    } catch (e) { /* the game is still perfectly playable silent */ }
}

function gcAudioToggleMute() {
    gcAudioMuted = !gcAudioMuted;
    try {
        if (gcAudioMaster) {
            gcAudioMaster.gain.setTargetAtTime(gcAudioMuted ? 0 : 1, audioCtx.currentTime, 0.02);
        }
    } catch (e) { /* ignore */ }
    return gcAudioMuted;
}

/**
 * Drop every sustained voice to silence at once.
 *
 * gameLoop() is what pumps them, and it returns the moment gameRunning goes
 * false -- so a death would otherwise freeze the drone and the pursuit tune at
 * whatever level they held on the last frame, forever. Called from
 * showMessage(..., isGameOver = true), the single choke point where a run ends.
 */
function gcAudioSilence() {
    gcVoiceLevel(gcDroneVoice, 0);
    gcVoiceLevel(gcSightVoice, 0);
    gcVoiceLevel(gcVerticalVoice, 0);
    gcPursuitOn = false;
}

/* ------------------------------------------------------------------ *
 *  One-shots
 * ------------------------------------------------------------------ */

/**
 * Footstep. Alternating pitch so a walk cycle reads as left-right rather than
 * as a metronome; called from Player.update() on each half-cycle of legPhase,
 * so the step rate follows the actual animation and speeds up in a dash
 * without any separate timing.
 */
let gcStepFlip = false;
function gcStepSound() {
    if (!audioCtx || gcAudioMuted) return;
    gcStepFlip = !gcStepFlip;
    try {
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "triangle";
        osc.frequency.setValueAtTime(gcStepFlip ? 132 : 108, t);
        osc.frequency.exponentialRampToValueAtTime(62, t + 0.05);
        gain.gain.setValueAtTime(0.055, t);
        gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.06);
        osc.connect(gain);
        gain.connect(gcAudioMaster || audioCtx.destination);
        osc.start(t);
        osc.stop(t + 0.07);
        osc.onended = function () { try { osc.disconnect(); gain.disconnect(); } catch (e) {} };
    } catch (e) { /* ignore */ }
}

/**
 * Dash. A descending sawtooth whoosh under a short square accent -- the accent
 * is the launch, the whoosh is the travel. Fired on the press, not on landing,
 * because the sound has to arrive with the animation.
 */
function gcDashSound() {
    if (!audioCtx || gcAudioMuted) return;
    try {
        const t = audioCtx.currentTime;
        const dest = gcAudioMaster || audioCtx.destination;

        const whoosh = audioCtx.createOscillator();
        const wg = audioCtx.createGain();
        whoosh.type = "sawtooth";
        whoosh.frequency.setValueAtTime(880, t);
        whoosh.frequency.exponentialRampToValueAtTime(120, t + 0.28);
        wg.gain.setValueAtTime(0.13, t);
        wg.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
        whoosh.connect(wg); wg.connect(dest);
        whoosh.start(t); whoosh.stop(t + 0.32);
        whoosh.onended = function () { try { whoosh.disconnect(); wg.disconnect(); } catch (e) {} };

        const acc = audioCtx.createOscillator();
        const ag = audioCtx.createGain();
        acc.type = "square";
        acc.frequency.setValueAtTime(196, t);
        acc.frequency.exponentialRampToValueAtTime(392, t + 0.07);
        ag.gain.setValueAtTime(0.1, t);
        ag.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
        acc.connect(ag); ag.connect(dest);
        acc.start(t); acc.stop(t + 0.1);
        acc.onended = function () { try { acc.disconnect(); ag.disconnect(); } catch (e) {} };
    } catch (e) { /* ignore */ }
}

// A laser leaving a Surveyor. Short, thin, and quiet -- there can be a dozen
// hunters on screen and this must not become a wall of noise.
function gcLaserShotSound() {
    if (!audioCtx || gcAudioMuted) return;
    try {
        const t = audioCtx.currentTime;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "sawtooth";
        osc.frequency.setValueAtTime(1500, t);
        osc.frequency.exponentialRampToValueAtTime(420, t + 0.11);
        gain.gain.setValueAtTime(0.05, t);
        gain.gain.exponentialRampToValueAtTime(0.0008, t + 0.13);
        osc.connect(gain);
        gain.connect(gcAudioMaster || audioCtx.destination);
        osc.start(t); osc.stop(t + 0.14);
        osc.onended = function () { try { osc.disconnect(); gain.disconnect(); } catch (e) {} };
    } catch (e) { /* ignore */ }
}

/**
 * A short shaped note. The five telegraph stings below all have the same shape
 * and differ only in numbers, so they share one helper rather than five copies
 * of the same oscillator plumbing.
 */
function gcSting(type, from, to, dur, gain, at) {
    if (!audioCtx || gcAudioMuted) return;
    try {
        const t = audioCtx.currentTime + (at || 0);
        const osc = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(from, t);
        osc.frequency.exponentialRampToValueAtTime(Math.max(1, to), t + dur);
        g.gain.setValueAtTime(gain, t);
        g.gain.exponentialRampToValueAtTime(0.0008, t + dur + 0.02);
        osc.connect(g);
        g.connect(gcAudioMaster || audioCtx.destination);
        osc.start(t);
        osc.stop(t + dur + 0.04);
        osc.onended = function () { try { osc.disconnect(); g.disconnect(); } catch (e) {} };
    } catch (e) { /* ignore */ }
}

/**
 * "IT HAS SEEN YOU." Two rising notes, the second a fifth above the first.
 *
 * A RISE, not a fall, and not a buzz: this is the one sound in the game that
 * has to cut through a drone hum, a pursuit loop and footsteps and be
 * understood in well under the two seconds it buys you. Rising intervals read
 * as an alarm across essentially every listener; a descending one would read as
 * something ending, which is the opposite of what just happened.
 */
function gcSpotSound() {
    gcSting("square", 520, 660, 0.09, 0.16, 0);
    gcSting("square", 780, 990, 0.16, 0.14, 0.10);
}

// Melee: a low charge that rises through the wind-up, then a hard hit or a
// hollow whiff. Three sounds so the player can tell, without looking, whether
// the thing behind them connected.
function gcMeleeWindupSound() { gcSting("sawtooth", 90, 240, MELEE_WINDUP_MS / 1000, 0.10, 0); }
function gcMeleeHitSound()    { gcSting("square", 300, 60, 0.20, 0.30, 0); }
function gcMeleeWhiffSound()  { gcSting("triangle", 380, 180, 0.10, 0.07, 0); }

// A beam landing. Lighter than melee on purpose: 1 heart, and the knockback is
// the part you are meant to notice.
function gcBeamHitSound() { gcSting("square", 900, 380, 0.09, 0.16, 0); }

/* ------------------------------------------------------------------ *
 *  Per-frame mix — called once from gameLoop()
 * ------------------------------------------------------------------ */

/**
 * The whole continuous mix in one pass over the entities.
 *
 *   nearest drone on ANY floor  -> drone gain and lowpass cutoff
 *   nearest drone on z +/- 1    -> the vertical warning tone
 *   any drone hunting           -> pursuit tune on
 *   any LANCER holding a sight  -> sight tone on
 *
 * One loop rather than four because entities is ~95 long and this runs every
 * frame; the questions are all answered from the same scan.
 *
 * ---------------------------------------------------------------------------
 * CROSS-FLOOR AUDIO (2026-09-06, GCE_STEPWELL_PASS_PLAN.md §7)
 * ---------------------------------------------------------------------------
 * The bug this fixes is a player-facing one, not a code one: you climb a
 * stairwell into a room you had no way to hear, and die to something that was
 * always standing there. The old mix scanned `e.z === player.z` ONLY, so a
 * drone one floor up was not merely quiet -- it was literally silent, and the
 * game gave you nothing at all to go on before you committed to the stairs.
 *
 * Now every drone on every floor is scanned, at an EFFECTIVE distance:
 *
 *     effective = hypot(dx, dy) * (1 + VERT_PENALTY * |dz|)
 *
 * so one floor of separation reads as about 1.85x the map distance -- present,
 * quieter, never absent. Vertical separation costs the same as horizontal
 * distance costs, which is the right relationship: both mean "not yet a
 * problem, but on its way to being one".
 */
function gcAudioFrame() {
    if (!audioCtx || !gcAudioMaster) return;

    let nearestEffective = Infinity;
    let nearestVertical = Infinity;
    let hunting = false;
    let sighted = false;

    for (let i = 0; i < entities.length; i++) {
        const e = entities[i];
        if (e.state === 'hunt') {
            hunting = true;
            // Only a Lancer can actually line up a shot, so only a Lancer
            // sounds the sight tone -- see drawSightReticle() for the same
            // reasoning applied to the reticle.
            if (e.sightActive && e.kind === 'lancer') sighted = true;
        }

        const dz = Math.abs(e.z - player.z);
        const flat = Math.hypot(e.x - player.x, e.y - player.y);
        const effective = flat * (1 + VERT_PENALTY * dz);
        if (effective < nearestEffective) nearestEffective = effective;

        // The dedicated warning is about ADJACENT floors specifically, and
        // measured on FLAT distance, because "directly above me" is a question
        // about x/y only -- the whole point is the ceiling you are about to
        // walk up through.
        if (dz === 1 && flat < nearestVertical) nearestVertical = flat;
    }

    // Closeness, 0 (far or absent) .. 1 (touching). Squared so the drone stays
    // out of the way until something is genuinely near, then rises fast.
    let close = 0;
    if (nearestEffective < GC_DRONE_RANGE) {
        close = 1 - (nearestEffective / GC_DRONE_RANGE);
        close *= close;
    }

    gcVoiceLevel(gcDroneVoice, close * 0.16);
    if (gcDroneVoice && gcDroneVoice.filter) {
        try {
            // 200Hz muffled at distance, ~1kHz and buzzing right on top of you.
            gcDroneVoice.filter.frequency.setTargetAtTime(200 + close * 850, audioCtx.currentTime, 0.1);
        } catch (e) { /* ignore */ }
    }

    // The vertical tone PULSES rather than holding, and pulses faster the
    // closer the thing overhead is. A steady tone would blend into the drone;
    // a rhythm that quickens is read as approach even when it is quiet.
    let vert = 0;
    if (nearestVertical < VERT_ALERT_RANGE) {
        const prox = 1 - (nearestVertical / VERT_ALERT_RANGE);
        gcVerticalPhase += 0.04 + prox * 0.10;
        vert = prox * (0.55 + 0.45 * Math.sin(gcVerticalPhase)) * 0.05;
    } else {
        gcVerticalPhase = 0;
    }
    gcVoiceLevel(gcVerticalVoice, vert, 0.015);

    gcVoiceLevel(gcSightVoice, sighted ? 0.028 : 0);

    gcPursuitOn = hunting;
    gcPursuitSchedule();
    gcHeartbeatFrame();
}

/**
 * Schedules the next bar of the pursuit arpeggio if the audio clock is within
 * a lookahead of it. Called every frame; does nothing on most of them.
 *
 * Scheduling a BAR AHEAD rather than a note at a time is what keeps the tune
 * steady while the frame rate is not -- the notes are already on the audio
 * clock before the frame that would have played them ever runs.
 */
function gcPursuitSchedule() {
    if (!gcPursuitOn || gcAudioMuted) return;
    const now = audioCtx.currentTime;
    const bar = GC_PURSUIT_NOTES.length * GC_PURSUIT_STEP;

    // First bar after a quiet spell: start it now rather than waiting out a
    // stale nextBar from the last pursuit.
    if (gcPursuitNextBar < now) gcPursuitNextBar = now + 0.02;
    if (gcPursuitNextBar > now + 0.2) return;   // already scheduled far enough ahead

    const t0 = gcPursuitNextBar;
    for (let i = 0; i < GC_PURSUIT_NOTES.length; i++) {
        gcPursuitNote(GC_PURSUIT_NOTES[i], t0 + i * GC_PURSUIT_STEP, i === 0);
    }
    gcPursuitNextBar = t0 + bar;
}

function gcPursuitNote(freq, when, accent) {
    try {
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = "square";
        osc.frequency.setValueAtTime(freq, when);
        const peak = accent ? 0.075 : 0.05;
        gain.gain.setValueAtTime(0.0001, when);
        gain.gain.exponentialRampToValueAtTime(peak, when + 0.008);
        gain.gain.setValueAtTime(peak, when + 0.07);
        gain.gain.exponentialRampToValueAtTime(0.0001, when + 0.13);
        osc.connect(gain);
        gain.connect(gcAudioMaster || audioCtx.destination);
        osc.start(when);
        osc.stop(when + 0.15);
        osc.onended = function () { try { osc.disconnect(); gain.disconnect(); } catch (e) {} };
    } catch (e) { /* ignore */ }
}

/* ------------------------------------------------------------------ *
 *  THE RASTER PASS SOUNDS (2026-09-06)
 * ------------------------------------------------------------------ */

/**
 * REGEN. A rising minor third per heart restored.
 *
 * Rising, and two notes rather than one, because the event is "you gained
 * something" and a single blip is what this game already uses for "you touched
 * something". The pair is what makes it read as a reward rather than a pickup.
 */
function gcRegenSound() {
    gcSting("triangle", 523.25, 523.25, 0.07, 0.16, 0);
    gcSting("triangle", 659.25, 784.00, 0.13, 0.15, 0.065);
}

/**
 * FINDING A CORE. The biggest sound in the game, deliberately -- it is the
 * objective, and it has to be unmistakable against the blip that is worth a
 * tenth as much. A four-note rising arpeggio with a shimmer on top.
 */
function gcCoreFoundSound() {
    gcSting("square", 392.00, 392.00, 0.07, 0.17, 0);
    gcSting("square", 523.25, 523.25, 0.07, 0.17, 0.07);
    gcSting("square", 659.25, 659.25, 0.07, 0.18, 0.14);
    gcSting("square", 783.99, 1046.50, 0.22, 0.20, 0.21);
    gcSting("triangle", 1567.98, 2093.00, 0.30, 0.06, 0.21);
}

// A blip. Small on purpose -- it must not compete with a core.
function gcBlipSound() { gcSting("square", 1046.50, 1318.51, 0.05, 0.10, 0); }

/**
 * DEPOSITING a core. A heavy thunk with a rising tail: the thunk is the core
 * landing in the plinth, the tail is the level getting closer to open. Lower
 * than the pickup, because pickup is a promise and this is the payment.
 */
function gcDepositSound() {
    gcSting("sawtooth", 220.00, 110.00, 0.14, 0.24, 0);
    gcSting("square", 329.63, 493.88, 0.20, 0.14, 0.09);
}

// Landing badly. A dull impact, no pitch rise -- nothing about this is good.
function gcFallSound() {
    gcSting("sawtooth", 180, 40, 0.26, 0.28, 0);
    gcSting("square", 90, 30, 0.18, 0.16, 0.02);
}

// Glass. A short bright cluster of detuned highs, which is as close to a noise
// burst as oscillators get without a buffer source.
function gcGlassBreakSound() {
    for (let i = 0; i < 5; i++) {
        gcSting("square", 2200 + Math.random() * 2600, 600 + Math.random() * 900,
                0.06 + Math.random() * 0.07, 0.06, Math.random() * 0.05);
    }
}

// The trapdoor. A long ascending sweep -- the one sound in the game that says
// "go there now".
function gcExitOpenSound() {
    gcSting("sawtooth", 160, 900, 0.55, 0.16, 0);
    gcSting("square", 320, 1320, 0.55, 0.10, 0.05);
    gcSting("triangle", 1320, 1320, 0.40, 0.08, 0.45);
}

// Level cleared. The reward jingle, and the only place a major triad resolves.
function gcLevelClearSound() {
    gcSting("square", 523.25, 523.25, 0.09, 0.18, 0);
    gcSting("square", 659.25, 659.25, 0.09, 0.18, 0.10);
    gcSting("square", 783.99, 783.99, 0.09, 0.18, 0.20);
    gcSting("square", 1046.50, 1046.50, 0.34, 0.22, 0.30);
    gcSting("triangle", 1567.98, 1567.98, 0.34, 0.08, 0.30);
}

/**
 * LOW HEALTH. A two-thump heartbeat that quickens as the bar empties.
 *
 * Driven from gcAudioFrame() against the AUDIO clock, not a JS timer, for the
 * reason at the top of this file. It is scheduled rather than looped because
 * the interval changes with the player's health, and a sustained voice cannot
 * change its own rhythm.
 */
let gcHeartNextMs = 0;

function gcHeartbeatFrame() {
    if (!audioCtx || gcAudioMuted || !gameRunning) return;
    if (!player || player.health > LOW_HEALTH_AT || player.health <= 0) return;

    const now = audioCtx.currentTime;
    if (gcHeartNextMs > now) return;

    // 1 heart -> ~0.52s between beats, 3 hearts -> ~0.95s.
    const gap = 0.38 + (player.health / LOW_HEALTH_AT) * 0.6;
    gcSting("sine", 62, 44, 0.10, 0.30, 0);
    gcSting("sine", 58, 40, 0.09, 0.22, 0.17);
    gcHeartNextMs = now + gap;
}

// The moment you go over the edge, as distinct from gcFallSound() which is the
// landing. A long descending tone: the drop, not the impact.
function gcFallStartSound() { gcSting("sawtooth", 700, 60, 0.55, 0.16, 0); }

/**
 * The wave change. A fast rising sweep under the level-clear jingle -- Robotron
 * announces a new wave with a rush, not with a chord, and the two together are
 * what make the transition feel like an event rather than a screen wipe.
 */
function gcWaveSweepSound() {
    gcSting("sawtooth", 110, 1400, 0.42, 0.13, 0);
    gcSting("square", 220, 2800, 0.42, 0.07, 0.03);
}
