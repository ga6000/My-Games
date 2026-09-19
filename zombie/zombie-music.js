// ===================================================
//   Zombie — the score (2026-09-18)
// ===================================================
// Asked for after the playtest, replacing the intensity drone:
//
//   "an eerie low organ sound track that starts with chimes at the
//    beginning of a game, intensifies as the numbers of zombies increase
//    (up to a limit), with a second harmonizing higher soprano track that
//    starts to ease in as players have a significant number of zombies in
//    vicinity; chimes in sync with the music, in tempo, at events like a
//    round change (its own tune), and unlocking the sluice gate (its own
//    building tune that eases in on top of the background music)."
//
// Procedural Web Audio like everything else here (zombie-audio.js says why:
// file://, the DOS palette, Gyro Space's mobile freeze). Non-positional --
// this is score, not sound in the world -- and routed through audioMaster,
// so N (mute) and the volume setting cover it for free.
//
// ONE TEMPO GRID. Every note, including every cue, is placed on it, which
// is what "in sync, in tempo" means: a round change waits for the next
// beat rather than firing the instant the round flips. Scheduling runs
// from the game's own rAF loop (musicUpdate), a lookahead window ahead of
// the audio clock -- so the score opens NO timer of its own, and the
// teardown rule (root CLAUDE.md) needs nothing new. The one long-lived node
// is the tremolo LFO; musicStop() ends it, and zDestroy() calls that.
//
// Every cue is driven by STATE the client already has (round number and
// phase, the gate, the generator), not by the event queue. Events are
// capped at ten a snapshot and are the first thing to get dropped; a round
// change seen in the snapshot is never missed.
"use strict";

const MUS_BPM = 66;
const MUS_BEAT = 60 / MUS_BPM;          // seconds
const MUS_LOOKAHEAD = 0.4;              // schedule this far ahead of the audio clock
const MUS_LEVEL = 0.62;                 // the whole score, relative to the effects
const MUS_NEAR_RADIUS = 1000;           // what counts as "in your vicinity"
const MUS_FULL_ZOMBIES = 30;            // intensity stops climbing here -- "up to a limit"
const MUS_SOPRANO_FROM = 12;            // the soprano starts to ease in...
const MUS_SOPRANO_FULL = 26;            // ...and is fully in here
const MUS_CHIME_VOL = 0.2;

// Eight bars of D minor, leaning Phrygian where it can: i, VI, iv, V, i,
// the Neapolitan bII (the eeriest chord in the set), vii-dim, V7. Chords
// voiced low (octave 3), a pedal an octave under, and the soprano's two
// notes per bar are always chord tones -- that is what keeps it
// harmonizing with the organ whatever the intensity is doing.
const MUS_PROG = [
    { bass: 38, chord: [50, 53, 57, 62], sop: [74, 77] },   // Dm
    { bass: 46, chord: [50, 53, 58, 62], sop: [77, 74] },   // Bb
    { bass: 43, chord: [50, 55, 58, 62], sop: [74, 70] },   // Gm
    { bass: 45, chord: [49, 52, 57, 61], sop: [73, 76] },   // A
    { bass: 38, chord: [50, 53, 57, 62], sop: [77, 81] },   // Dm
    { bass: 39, chord: [51, 55, 58, 63], sop: [79, 75] },   // Eb
    { bass: 47, chord: [50, 53, 59, 62], sop: [74, 77] },   // B dim
    { bass: 45, chord: [49, 52, 55, 57], sop: [73, 69] }    // A7
];

// Cues: [beat offset, midi, velocity, ring seconds]. `align` restarts the
// progression on the cue's first beat, so a cue written over D minor
// always lands on D minor.
const MUS_CUES = {
    // The opening: three slow tolls and a shimmer, then the organ comes in.
    start: { align: true, notes: [
        [0, 74, 1.0, 3.2], [2, 69, 0.85, 3.0], [4, 74, 0.9, 3.4], [4, 62, 0.6, 3.4],
        [6, 77, 0.45, 2.2], [6.5, 81, 0.4, 2.2], [7, 86, 0.35, 2.8]
    ] },
    // A new round: a rising call.
    round: { align: true, notes: [
        [0, 74, 0.9, 1.4], [0.5, 77, 0.8, 1.4], [1, 81, 0.85, 1.4], [1.5, 86, 0.9, 2.6],
        [2, 81, 0.5, 2.6], [2, 62, 0.45, 2.6]
    ] },
    // Round cleared: it resolves downward.
    clear: { align: true, notes: [
        [0, 81, 0.85, 1.6], [0.5, 77, 0.75, 1.6], [1, 76, 0.75, 1.6], [1.5, 74, 0.9, 3.2],
        [1.5, 62, 0.5, 3.2]
    ] },
    // The generator trips: a tritone, low, and not resolved. No realign --
    // it is meant to clash with whatever is under it.
    trip: { align: false, notes: [
        [0, 62, 0.9, 3.0], [0, 68, 0.8, 3.0], [1.5, 61, 0.8, 2.6], [3, 50, 1.0, 4.0]
    ] },
    // Power back (or on for the first time): D MAJOR -- the Picardy third,
    // the one bright chord the score ever plays.
    power: { align: true, notes: [
        [0, 74, 0.8, 1.6], [0.5, 78, 0.8, 1.6], [1, 81, 0.8, 1.6], [1.5, 86, 0.9, 3.0],
        [1.5, 66, 0.4, 3.0]
    ] },
    // The sluice opens: the build layer's resolution, a D major cascade.
    unlock: { align: true, notes: [
        [0, 74, 0.8, 1.2], [0.25, 78, 0.8, 1.2], [0.5, 81, 0.8, 1.2], [0.75, 86, 0.85, 1.2],
        [1, 90, 0.85, 1.4], [1.25, 93, 0.9, 1.6], [2, 86, 1.0, 4.0], [2, 78, 0.7, 4.0],
        [2, 62, 0.6, 4.0]
    ] },
    win: { align: true, notes: [
        [0, 74, 0.9, 2.0], [0.5, 78, 0.9, 2.0], [1, 81, 0.9, 2.0], [1.5, 86, 1.0, 2.4],
        [2, 90, 0.9, 2.4], [3, 86, 1.0, 5.0], [3, 74, 0.7, 5.0], [3, 62, 0.6, 5.0]
    ] },
    over: { align: true, notes: [
        [0, 69, 0.9, 3.0], [1, 65, 0.85, 3.0], [2, 62, 0.9, 3.4], [4, 50, 1.0, 5.0]
    ] }
};

// Tubular-bell partials: [ratio, amplitude, decay scale]. Inharmonic on
// purpose -- that is what makes it a bell and not an organ.
const MUS_BELL = [[1, 1.0, 1.0], [2.0, 0.5, 0.6], [2.76, 0.38, 0.42], [5.4, 0.2, 0.24], [8.93, 0.09, 0.14]];

let musRunning = false;
let musEnding = "";             // "over" / "win" while the last cue rings out
let musEndAt = 0;               // audio time the score stops, once ending
let musNextBeat = 0;            // audio time of the next beat to schedule
let musBeat = 0;                // beats since the progression last restarted
let musCues = [];
let musHeld = [];               // sustained voices, so a realign can cut them
let musIntensity = 0;           // smoothed 0..1
let musSoprano = 0;             // smoothed 0..1
let musLevelAt = 0;

// what the score last saw, to spot the moments that earn a cue
let musRound = 0;
let musPhase = "idle";
let musTripped = false;
let musGen = false;
let musGateStage = 0;

// nodes, rebuilt if the audio context ever is
let musCtx = null;
let musBus = null;
let musFilter = null;
let musTrem = null;
let musOrganBus = null;
let musSopBus = null;
let musChimeBus = null;
let musLfo = null;
let musWaves = null;

function musHz(m) {
    return 440 * Math.pow(2, (m - 69) / 12);
}

// Drawbar registrations as PeriodicWaves: one oscillator per pipe instead
// of one per harmonic. Soft, mid, full -- the organ opens up as the horde
// grows.
function musBuildWaves() {
    const regs = [
        [0, 1.0, 0.45, 0.10, 0.18, 0, 0.05, 0, 0.04],
        [0, 1.0, 0.70, 0.35, 0.40, 0.10, 0.18, 0, 0.12],
        [0, 1.0, 0.85, 0.60, 0.65, 0.25, 0.35, 0.10, 0.30, 0, 0.12]
    ];
    return regs.map(function (amps) {
        const real = new Float32Array(amps.length);
        const imag = new Float32Array(amps);
        return audioCtx.createPeriodicWave(real, imag);
    });
}

function musEnsureNodes() {
    if (!audioCtx) return false;
    if (musCtx === audioCtx && musBus) return true;
    try {
        musCtx = audioCtx;
        musWaves = musBuildWaves();
        musBus = audioCtx.createGain();
        musBus.gain.value = MUS_LEVEL;
        musBus.connect(audioMaster);

        musFilter = audioCtx.createBiquadFilter();
        musFilter.type = "lowpass";
        musFilter.frequency.value = 900;
        musFilter.Q.value = 0.7;
        musFilter.connect(musBus);

        // Tremolo on its own node, so the organ's fade-in on musOrganBus
        // can sit at 0 without the LFO swinging it negative.
        musTrem = audioCtx.createGain();
        musTrem.gain.value = 1;
        musTrem.connect(musFilter);
        musOrganBus = audioCtx.createGain();
        musOrganBus.gain.value = 0;
        musOrganBus.connect(musTrem);

        musSopBus = audioCtx.createGain();
        musSopBus.gain.value = 1;
        musSopBus.connect(musBus);
        musChimeBus = audioCtx.createGain();
        musChimeBus.gain.value = 1;
        musChimeBus.connect(musBus);
        return true;
    } catch (e) {
        musBus = null;
        return false;
    }
}

function musStartLfo() {
    if (musLfo || !audioCtx) return;
    try {
        musLfo = audioCtx.createOscillator();
        musLfo.frequency.value = 4.6;
        const depth = audioCtx.createGain();
        depth.gain.value = 0.1;
        musLfo.connect(depth);
        depth.connect(musTrem.gain);
        musLfo.start();
    } catch (e) { musLfo = null; }
}

function musStopLfo() {
    if (!musLfo) return;
    try { musLfo.stop(); } catch (e) { /* already stopped */ }
    musLfo = null;
}

// ---------------------------------------------------
//   VOICES
// ---------------------------------------------------
function musOrgan(midi, t0, dur, vol, reg, hold) {
    try {
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.12);      // pipe speech
        g.gain.setValueAtTime(vol, t0 + Math.max(0.13, dur - 0.05));
        g.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.25);
        g.connect(musOrganBus);
        // Two pipes a few cents apart: the voix celeste, which is most of
        // what makes a held organ chord sound uneasy rather than churchy.
        for (let k = 0; k < 2; k++) {
            const o = audioCtx.createOscillator();
            o.setPeriodicWave(musWaves[reg]);
            o.frequency.value = musHz(midi);
            if (k) o.detune.value = 7;
            const og = audioCtx.createGain();
            og.gain.value = k ? 0.55 : 1;
            o.connect(og);
            og.connect(g);
            o.start(t0);
            o.stop(t0 + dur + 0.3);
        }
        if (hold) musHeld.push({ g: g, until: t0 + dur });
    } catch (e) { /* audio is never worth a frame */ }
}

// A sung "ah": a sawtooth through three formant band-passes, with vibrato
// that only arrives once the note has settled, as a singer's does.
function musSoprano1(midi, t0, dur, vol) {
    try {
        const o = audioCtx.createOscillator();
        o.type = "sawtooth";
        o.frequency.value = musHz(midi);
        const vib = audioCtx.createOscillator();
        vib.frequency.value = 5.4;
        const vibDepth = audioCtx.createGain();
        vibDepth.gain.setValueAtTime(0, t0);
        vibDepth.gain.linearRampToValueAtTime(14, t0 + 0.6);   // cents
        vib.connect(vibDepth);
        vibDepth.connect(o.detune);

        const env = audioCtx.createGain();
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.linearRampToValueAtTime(vol, t0 + 0.45);
        env.gain.setValueAtTime(vol, t0 + Math.max(0.46, dur - 0.1));
        env.gain.linearRampToValueAtTime(0.0001, t0 + dur + 0.35);
        env.connect(musSopBus);

        const forms = [[800, 6, 1.0], [1150, 7, 0.55], [2900, 9, 0.22]];
        for (let i = 0; i < forms.length; i++) {
            const bp = audioCtx.createBiquadFilter();
            bp.type = "bandpass";
            bp.frequency.value = forms[i][0];
            bp.Q.value = forms[i][1];
            const fg = audioCtx.createGain();
            fg.gain.value = forms[i][2];
            o.connect(bp);
            bp.connect(fg);
            fg.connect(env);
        }
        o.start(t0);
        vib.start(t0);
        o.stop(t0 + dur + 0.4);
        vib.stop(t0 + dur + 0.4);
    } catch (e) { /* ignore */ }
}

function musBellNote(midi, t0, vol, ring, partials) {
    try {
        const f = musHz(midi);
        const nyq = audioCtx.sampleRate / 2 - 1000;
        const n = Math.min(partials || MUS_BELL.length, MUS_BELL.length);
        for (let i = 0; i < n; i++) {
            const p = MUS_BELL[i];
            if (f * p[0] >= nyq) break;         // a partial past Nyquist aliases
            const o = audioCtx.createOscillator();
            o.frequency.value = f * p[0];
            const g = audioCtx.createGain();
            const end = t0 + Math.max(0.2, ring * p[2]);
            g.gain.setValueAtTime(0.0001, t0);
            g.gain.linearRampToValueAtTime(vol * p[1], t0 + 0.004);
            g.gain.exponentialRampToValueAtTime(0.0001, end);
            o.connect(g);
            g.connect(musChimeBus);
            o.start(t0);
            o.stop(end + 0.05);
        }
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------
//   SCHEDULING
// ---------------------------------------------------
function musCue(name) {
    if (!musRunning || musEnding) return;
    if (musCues.indexOf(name) === -1 && musCues.length < 4) musCues.push(name);
}

// A realign starts a new bar mid-bar, so whatever chord was holding would
// clash with the D minor under the cue. Let it go, quickly.
function musCutHeld(t) {
    for (let i = 0; i < musHeld.length; i++) {
        const h = musHeld[i];
        if (h.until <= t) continue;
        try {
            h.g.gain.cancelScheduledValues(t);
            h.g.gain.setValueAtTime(h.g.gain.value || 0.0001, t);
            h.g.gain.linearRampToValueAtTime(0.0001, t + 0.18);
        } catch (e) { /* ignore */ }
    }
    musHeld = [];
}

function musPlayCue(name, t) {
    const cue = MUS_CUES[name];
    if (!cue) return;
    for (let i = 0; i < cue.notes.length; i++) {
        const n = cue.notes[i];
        musBellNote(n[1], t + n[0] * MUS_BEAT, n[2] * MUS_CHIME_VOL, n[3]);
    }
}

function musScheduleBeat(t) {
    if (musCues.length) {
        const name = musCues.shift();
        if (MUS_CUES[name] && MUS_CUES[name].align) {
            musCutHeld(t);
            musBeat = 0;
        }
        musPlayCue(name, t);
    }
    if (musEnding) return;       // the last cue rings; nothing new under it

    const inBar = musBeat % 4;
    const P = MUS_PROG[Math.floor(musBeat / 4) % MUS_PROG.length];
    const I = musIntensity;
    const reg = I < 0.35 ? 0 : I < 0.7 ? 1 : 2;
    const bar = MUS_BEAT * 4;

    // The bed: always there, just quiet when the map is.
    if (inBar === 0) {
        // Forget voices that have already finished, or this list grows by
        // five a bar for as long as the run lasts.
        musHeld = musHeld.filter(function (h) { return h.until > t; });
        for (let i = 0; i < P.chord.length; i++) musOrgan(P.chord[i], t, bar, 0.045 + 0.045 * I, reg, true);
        musOrgan(P.bass, t, bar, 0.06 + 0.05 * I, 2, true);
    }
    // A pulse under it once there is a crowd.
    if (I >= 0.25 && inBar === 2) musOrgan(P.bass, t, MUS_BEAT * 0.6, 0.05 + 0.07 * I, 2, false);
    // And an ostinato over it when it gets bad.
    if (I >= 0.55) {
        for (let k = 0; k < 2; k++) {
            const m = P.chord[(inBar * 2 + k) % P.chord.length] + 12;
            musOrgan(m, t + k * MUS_BEAT / 2, MUS_BEAT * 0.3, 0.02 + 0.035 * I, 1, false);
        }
    }
    // The soprano: two held notes a bar, only as loud as the count earns.
    if (musSoprano > 0.03 && (inBar === 0 || inBar === 2)) {
        musSoprano1(P.sop[inBar / 2], t, MUS_BEAT * 2 + 0.15, 0.08 * musSoprano);
    }
    // THE SLUICE BUILD LAYER. While the two plates are held, chimes climb
    // the current chord, denser and louder as the lock fills, and denser
    // again on the second (longer) lock. It is the only layer that tracks
    // the gate, so it is the gate's own tune, eased in over the score.
    if (gateStage < GATE_STAGES && gateProgress > 0.02) {
        const prog = clamp(gateProgress, 0, 1);
        const step = (prog < 0.34 ? 1 : prog < 0.67 ? 2 : 4) * (gateStage >= 1 ? 2 : 1);
        const per = Math.min(4, step);
        const vol = (0.3 + 0.7 * prog) * MUS_CHIME_VOL * 0.6;
        for (let k = 0; k < per; k++) {
            const idx = (musBeat * per + k) % P.chord.length;
            const m = P.chord[idx] + 24 + (prog > 0.66 ? 12 : 0);
            musBellNote(m, t + k * MUS_BEAT / per, vol, 0.9, 4);
        }
    }
}

// Smoothed toward a target with a time constant (seconds), so it behaves
// the same at 20fps and 144fps.
function musEase(v, target, dt, riseTau, fallTau) {
    const tau = target > v ? riseTau : fallTau;
    return v + (target - v) * (1 - Math.exp(-(dt / 1000) / tau));
}

function musListener() {
    const me = players[0];
    if (me) return { x: me.x + me.size / 2, y: me.y + me.size / 2 };
    return { x: camera.x, y: camera.y };     // dead and watching: hear what you see
}

function musTrack(dt) {
    const at = musListener();
    let near = 0;
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        if (Math.abs(z.x - at.x) > MUS_NEAR_RADIUS || Math.abs(z.y - at.y) > MUS_NEAR_RADIUS) continue;
        if (Math.hypot(z.x - at.x, z.y - at.y) < MUS_NEAR_RADIUS) near++;
    }
    const iTarget = clamp((near - 2) / (MUS_FULL_ZOMBIES - 2), 0, 1);
    const sTarget = clamp((near - MUS_SOPRANO_FROM) / (MUS_SOPRANO_FULL - MUS_SOPRANO_FROM), 0, 1);
    musIntensity = musEase(musIntensity, iTarget, dt, 1.2, 5);
    musSoprano = musEase(musSoprano, sTarget, dt, 2.5, 6);

    // The moments that earn a cue. Round 1's call is folded into the
    // opening chimes rather than stacked on top of them.
    if (round !== musRound) {
        if (round > musRound && roundPhase === "active" && musRound > 0) musCue("round");
        musRound = round;
    }
    if (roundPhase !== musPhase) {
        if (roundPhase === "intermission" && musPhase === "active") musCue("clear");
        musPhase = roundPhase;
    }
    if (genTripped && !musTripped) musCue("trip");
    musTripped = genTripped;
    if (generatorOn && !musGen) musCue("power");
    musGen = generatorOn;
    if (gateStage >= GATE_STAGES && musGateStage < GATE_STAGES) musCue("unlock");
    musGateStage = gateStage;
}

// Levels follow the smoothed intensity. setTargetAtTime a few times a
// second rather than every frame: the params glide between updates anyway.
function musApplyLevels(now) {
    if (now - musLevelAt < 120) return;
    musLevelAt = now;
    try {
        const t = audioCtx.currentTime;
        musFilter.frequency.setTargetAtTime(900 + 2400 * musIntensity, t, 0.4);
        musSopBus.gain.setTargetAtTime(0.4 + 0.6 * musSoprano, t, 0.6);
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------
//   PUBLIC
// ---------------------------------------------------
// Called from startGame(). The opening cue, then the organ swells in under
// it from the second bar.
function musicStart() {
    musRunning = true;
    musEnding = "";
    musEndAt = 0;
    musNextBeat = 0;
    musBeat = 0;
    musHeld = [];
    musCues = ["start"];
    musIntensity = 0;
    musSoprano = 0;
    musRound = round;
    musPhase = roundPhase;
    musTripped = genTripped;
    musGen = generatorOn;
    musGateStage = gateStage;
    if (!musEnsureNodes()) return;           // no audio yet: musicUpdate retries
    musStartLfo();
    try {
        const t = audioCtx.currentTime;
        musBus.gain.cancelScheduledValues(t);
        musBus.gain.setValueAtTime(MUS_LEVEL, t);
        musOrganBus.gain.cancelScheduledValues(t);
        musOrganBus.gain.setValueAtTime(0, t);
        musOrganBus.gain.setValueAtTime(0, t + MUS_BEAT * 4);
        musOrganBus.gain.linearRampToValueAtTime(1, t + MUS_BEAT * 12);
    } catch (e) { /* ignore */ }
}

// Every frame, from gameLoop.
function musicUpdate(now, dt) {
    if (!musRunning) return;
    if (!audioCtx || audioMuted) { musNextBeat = 0; return; }
    if (!musEnsureNodes()) return;
    musStartLfo();
    musTrack(dt);

    const ct = audioCtx.currentTime;
    // First beat, or back from a hidden tab / a mute: resync to now rather
    // than trying to play every beat that went by.
    if (!musNextBeat || musNextBeat < ct - 0.2) musNextBeat = ct + 0.06;
    while (musNextBeat < ct + MUS_LOOKAHEAD) {
        musScheduleBeat(musNextBeat);
        musNextBeat += MUS_BEAT;
        musBeat++;
    }
    musApplyLevels(now);

    if (musEnding && musEndAt && ct >= musEndAt) musicStop(false);
}

// The run is over one way or the other: its last cue, then the score
// lets go over two bars.
function musicEnd(kind) {
    if (!musRunning || musEnding) return;
    musCues = [kind === "win" ? "win" : "over"];
    musEnding = kind || "over";
    if (!audioCtx || !musBus) { musRunning = false; return; }
    try {
        const t = audioCtx.currentTime;
        musOrganBus.gain.cancelScheduledValues(t);
        musOrganBus.gain.setValueAtTime(musOrganBus.gain.value, t);
        musOrganBus.gain.linearRampToValueAtTime(0.0001, t + MUS_BEAT * 4);
        musSopBus.gain.cancelScheduledValues(t);
        musSopBus.gain.setValueAtTime(musSopBus.gain.value, t);
        musSopBus.gain.linearRampToValueAtTime(0.0001, t + MUS_BEAT * 2);
        musEndAt = t + MUS_BEAT * 10;
    } catch (e) { musRunning = false; }
}

// Silence now. `hard` also drops the nodes (teardown); otherwise they are
// kept for the next run on the same audio context.
function musicStop(hard) {
    musRunning = false;
    musEnding = "";
    musCues = [];
    musHeld = [];
    musNextBeat = 0;
    if (audioCtx && musBus) {
        try {
            const t = audioCtx.currentTime;
            musBus.gain.cancelScheduledValues(t);
            musBus.gain.setValueAtTime(musBus.gain.value, t);
            musBus.gain.linearRampToValueAtTime(0.0001, t + 0.3);
        } catch (e) { /* ignore */ }
    }
    musStopLfo();
    if (hard) {
        try { if (musBus) musBus.disconnect(); } catch (e) { /* ignore */ }
        musBus = null;
        musCtx = null;
    }
}
