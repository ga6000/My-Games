// ===================================================
//   Zombie — audio (idea 37 / 39 / 41 / 43)
// ===================================================
// Procedural Web Audio, no sample files. Three reasons this is the right
// call here rather than mp3s:
//
//   - Zero binary assets, so the file:// hard constraint stays untouched.
//   - Square and triangle waves ARE the DOS PC-speaker palette the game
//     is drawn in.
//   - The repo's one sampled-audio game (Gyro Space) has the open mobile
//     audio-freeze bug at the top of PROJECT_MEMORY.md.
//
// The tone()/gesture-gate shape is lifted from glucose-dash.html, which
// is the established pattern in this repo. Every call is wrapped: audio
// is never worth breaking a frame over.
"use strict";

let audioCtx = null;
let audioMaster = null;
let audioMuted = false;
let audioVolume = 0.7;
let audioReady = false;

// Sustained sources keyed by a STABLE id (barricade index). One-shots
// don't need identity -- see the event queue in zombie-net.js.
let audioLoops = {};

const AUDIO_MUTE_KEY = "zombie_muted";
const AUDIO_VOL_KEY = "zombie_volume";

// ---------------------------------------------------
//   SETUP
// ---------------------------------------------------
// Mobile browsers refuse to start a context without a user gesture, so
// nothing is created until the first click or keypress. initAudio() is
// safe to call on every input event.
function initAudio() {
    if (audioCtx) {
        // Chrome can park a context in "suspended" after a tab switch.
        if (audioCtx.state === "suspended") {
            try { audioCtx.resume(); } catch (e) { /* nothing to do */ }
        }
        return;
    }
    try {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
        audioMaster = audioCtx.createGain();
        audioMaster.gain.value = audioMuted ? 0 : audioVolume;
        audioMaster.connect(audioCtx.destination);
        audioReady = true;
    } catch (e) {
        audioCtx = null;
        audioReady = false;
    }
}

function loadAudioPrefs() {
    try {
        audioMuted = localStorage.getItem(AUDIO_MUTE_KEY) === "1";
        const v = parseFloat(localStorage.getItem(AUDIO_VOL_KEY));
        if (!isNaN(v)) audioVolume = Math.max(0, Math.min(1, v));
    } catch (e) { /* private mode; defaults are fine */ }
}

function saveAudioPrefs() {
    try {
        localStorage.setItem(AUDIO_MUTE_KEY, audioMuted ? "1" : "0");
        localStorage.setItem(AUDIO_VOL_KEY, String(audioVolume));
    } catch (e) { /* ignore */ }
}

function toggleMute() {
    audioMuted = !audioMuted;
    if (audioMaster) audioMaster.gain.value = audioMuted ? 0 : audioVolume;
    if (audioMuted) stopAllLoops();
    saveAudioPrefs();
    return audioMuted;
}

function setVolume(v) {
    audioVolume = Math.max(0, Math.min(1, v));
    if (audioMaster && !audioMuted) audioMaster.gain.value = audioVolume;
    saveAudioPrefs();
}

// ---------------------------------------------------
//   POSITIONAL MIX (idea 39)
// ---------------------------------------------------
// Non-negotiable on a 4800x2700 map showing a 960x540 window: without
// falloff every event anywhere on the map is equally loud and the mix is
// just noise. Returns null past the cut-off so the caller can skip the
// work entirely.
const AUDIO_FULL_DIST = 420;    // no attenuation inside this
const AUDIO_CUT_DIST = 1500;    // silent beyond this (~1.5 screen widths)

function audioPlacement(x, y, rangeMul) {
    const me = players[0];
    if (!me) return { gain: 1, pan: 0 };
    const cx = me.x + me.size / 2;
    const cy = me.y + me.size / 2;
    const dx = x - cx;
    const d = Math.hypot(dx, y - cy);
    const full = AUDIO_FULL_DIST * (rangeMul || 1);
    const cut = AUDIO_CUT_DIST * (rangeMul || 1);
    if (d > cut) return null;

    let gain = 1;
    if (d > full) {
        gain = 1 - (d - full) / (cut - full);
        gain = Math.max(0, gain * gain);   // squared: falls off like it means it
    }
    // Pan by horizontal offset only; vertical panning has nowhere to go.
    const pan = Math.max(-1, Math.min(1, dx / (VIEW_W * 0.75)));
    return { gain: gain, pan: pan };
}

function audioDest(pan) {
    if (!audioCtx) return null;
    if (typeof audioCtx.createStereoPanner !== "function") return audioMaster;
    try {
        const p = audioCtx.createStereoPanner();
        p.pan.value = pan || 0;
        p.connect(audioMaster);
        return p;
    } catch (e) {
        return audioMaster;
    }
}

// ---------------------------------------------------
//   PRIMITIVES
// ---------------------------------------------------
function tone(f0, f1, type, dur, vol, pan) {
    if (!audioCtx || audioMuted || vol <= 0) return;
    try {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        const dest = audioDest(pan);
        o.type = type;
        o.connect(g);
        g.connect(dest);
        const t = audioCtx.currentTime;
        o.frequency.setValueAtTime(f0, t);
        o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
        g.gain.setValueAtTime(vol, t);
        g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
        o.start(t);
        o.stop(t + dur + 0.02);
    } catch (e) { /* audio is never worth breaking a frame over */ }
}

// Filtered white noise -- splintering wood, breaches, shockwaves.
function noise(dur, vol, freq, q, pan) {
    if (!audioCtx || audioMuted || vol <= 0) return;
    try {
        const n = Math.floor(audioCtx.sampleRate * dur);
        const buf = audioCtx.createBuffer(1, n, audioCtx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < n; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / n);
        const src = audioCtx.createBufferSource();
        src.buffer = buf;
        const bp = audioCtx.createBiquadFilter();
        bp.type = "bandpass";
        bp.frequency.value = freq;
        bp.Q.value = q || 1;
        const g = audioCtx.createGain();
        g.gain.value = vol;
        src.connect(bp);
        bp.connect(g);
        g.connect(audioDest(pan));
        src.start();
        src.stop(audioCtx.currentTime + dur + 0.02);
    } catch (e) { /* ignore */ }
}

// ---------------------------------------------------
//   SUSTAINED SOURCES
// ---------------------------------------------------
// Only things that must start AND stop get an id. Barricade indices are
// stable (the array is never spliced), which is exactly why they can key
// a loop and one-shot kills cannot.
function startLoop(id, freq, vol) {
    if (!audioCtx || audioMuted || audioLoops[id]) return;
    try {
        const o = audioCtx.createOscillator();
        const g = audioCtx.createGain();
        o.type = "sawtooth";
        o.frequency.value = freq;
        g.gain.value = vol;
        o.connect(g);
        g.connect(audioMaster);
        o.start();
        audioLoops[id] = { osc: o, gain: g };
    } catch (e) { /* ignore */ }
}

function updateLoop(id, freq, vol) {
    const l = audioLoops[id];
    if (!l || !audioCtx) return;
    try {
        l.osc.frequency.setTargetAtTime(freq, audioCtx.currentTime, 0.05);
        l.gain.gain.setTargetAtTime(vol, audioCtx.currentTime, 0.05);
    } catch (e) { /* ignore */ }
}

function stopLoop(id) {
    const l = audioLoops[id];
    if (!l) return;
    try {
        l.gain.gain.setTargetAtTime(0, audioCtx.currentTime, 0.04);
        l.osc.stop(audioCtx.currentTime + 0.2);
    } catch (e) { /* ignore */ }
    delete audioLoops[id];
}

function stopAllLoops() {
    for (const id in audioLoops) {
        if (Object.prototype.hasOwnProperty.call(audioLoops, id)) stopLoop(id);
    }
    audioLoops = {};
}

// ---------------------------------------------------
//   THE GAME'S VOICES
// ---------------------------------------------------
// Event codes shared with zombie-net.js. Numbers, not strings: they ride
// in every snapshot.
const SND_BREACH = 1;
const SND_DOWN = 2;
const SND_REVIVED = 3;
const SND_BUY = 4;
const SND_GENERATOR = 5;
const SND_EXPLODE = 6;
const SND_CARD = 7;
const SND_SHOT = 8;          // arg = weapon index
const SND_KILL = 9;          // arg = zombie type index
const SND_PICKUP = 10;
const SND_DOOR = 11;
const SND_CRATE = 12;
const SND_TRAP = 13;
const SND_ZAP = 14;
const SND_ROUND_START = 15;
const SND_ROUND_CLEAR = 16;
const SND_SCREAM = 17;
const SND_SPLIT = 18;
const SND_GAMEOVER = 19;
// 2026-09-18
const SND_ULTRA = 20;        // arg 0 = it arrives, 1 = it falls
const SND_ARC = 21;          // arg = packed bolt offset, see arcFrom()
const SND_POP = 22;          // BLASTCAP burst; arg = radius
const SND_GEN_TRIP = 23;     // a Blackout takes the generator down
const SND_DECOY = 24;        // a ping became a lure

// IDEA 40: every gun already has its own screen-shake kick; this is the
// matching voice. Indexed by WEAPON_KEYS (zombie-core.js) so it can ride in
// an event as a single number.
function weaponVoice(idx, g, pan) {
    switch (WEAPON_KEYS[idx]) {
        case "rocket":
            // A launch, not a bang: a rising hiss with a low shove under it.
            // The bang is the explosion, which is its own event.
            noise(0.34, 0.30 * g, 900, 0.8, pan);
            tone(90, 210, "sawtooth", 0.30, 0.20 * g, pan);
            break;
        case "flamer":
            // Fires every 70ms, so it is one short low roar per shot that
            // blurs into a continuous one -- and it must stay under the mix.
            noise(0.10, 0.12 * g, 380, 0.5, pan);
            break;
        case "rifle":
            tone(520, 240, "square", 0.055, 0.16 * g, pan);
            noise(0.05, 0.10 * g, 1500, 1.2, pan);
            break;
        case "shotgun":
            // Low, wide, and it takes a moment to finish -- the weight is
            // the point.
            noise(0.22, 0.42 * g, 220, 0.6, pan);
            tone(150, 45, "square", 0.20, 0.24 * g, pan);
            break;
        case "smg":
            // Dry and small. Fires so fast it must not be fatiguing.
            tone(880, 620, "square", 0.028, 0.085 * g, pan);
            break;
        case "sniper":
            // A long descending crack, the loudest thing a player makes.
            noise(0.30, 0.40 * g, 700, 0.8, pan);
            tone(900, 70, "square", 0.34, 0.26 * g, pan);
            break;
        default:
            tone(640, 300, "square", 0.05, 0.13 * g, pan);
            break;
    }
}

function playEvent(code, x, y, arg) {
    if (!audioCtx || audioMuted) return;
    // "sound & player input should stop at this time" (2026-09-19). The walk
    // out is silent apart from the score's own win cue, which musicEnd()
    // schedules directly and which does not come through here.
    if (winSequenceRunning()) return;
    // The screamer carries much further than anything else -- that is
    // what makes it the target the team calls out (idea 44).
    const place = audioPlacement(x, y, code === SND_SCREAM ? 2.2 : 1);
    if (!place) return;                     // too far away to matter
    const g = place.gain;
    const p = place.pan;

    switch (code) {
        case SND_BREACH:
            // IDEA 41: the boards give way. Loud, low, unmistakable --
            // this is the horde entering your zone.
            noise(0.45, 0.5 * g, 260, 0.7, p);
            tone(200, 60, "square", 0.35, 0.28 * g, p);
            break;
        case SND_DOWN:
            // IDEA 43: an alarm, positional, so you know which way to run.
            tone(440, 180, "square", 0.5, 0.34 * g, p);
            trackTimeout(function () { tone(380, 150, "square", 0.5, 0.3 * g, p); }, 160);
            break;
        case SND_REVIVED:
            tone(420, 900, "triangle", 0.28, 0.3 * g, p);
            break;
        case SND_BUY:
            tone(700, 1150, "square", 0.10, 0.22 * g, p);
            break;
        case SND_CARD:
            tone(520, 780, "triangle", 0.14, 0.26 * g, p);
            trackTimeout(function () { tone(780, 1180, "triangle", 0.16, 0.24 * g, p); }, 110);
            break;
        case SND_GENERATOR:
            // The lights coming on. Long, rising, deliberately a moment.
            tone(70, 300, "sawtooth", 1.4, 0.3 * g, p);
            trackTimeout(function () { tone(300, 620, "triangle", 0.7, 0.22 * g, p); }, 900);
            break;
        case SND_EXPLODE:
            noise(0.6, 0.55 * g, 140, 0.5, p);
            tone(150, 40, "square", 0.45, 0.3 * g, p);
            break;

        case SND_SHOT:
            weaponVoice(arg | 0, g, p);
            break;

        case SND_KILL:
            // Small and dry. Heard a hundred times a round, so it has to
            // sit under everything else.
            tone(300 - (arg | 0) * 12, 120, "square", 0.06, 0.10 * g, p);
            break;

        case SND_SPLIT:
            noise(0.18, 0.26 * g, 900, 1.4, p);
            tone(700, 240, "triangle", 0.16, 0.16 * g, p);
            break;

        case SND_SCREAM:
            // Long, ugly, and audible from across a zone.
            tone(880, 1500, "sawtooth", 0.55, 0.22 * g, p);
            trackTimeout(function () { tone(1400, 500, "sawtooth", 0.45, 0.18 * g, p); }, 380);
            break;

        case SND_PICKUP:
            tone(600, 1250, "triangle", 0.20, 0.26 * g, p);
            break;

        case SND_DOOR:
            noise(0.5, 0.30 * g, 180, 0.5, p);
            tone(120, 320, "square", 0.42, 0.20 * g, p);
            break;

        case SND_CRATE:
            tone(420, 700, "square", 0.09, 0.20 * g, p);
            trackTimeout(function () { tone(700, 980, "square", 0.09, 0.18 * g, p); }, 80);
            break;

        case SND_TRAP:
            tone(200, 700, "sawtooth", 0.28, 0.24 * g, p);
            break;

        case SND_ZAP:
            noise(0.10, 0.24 * g, 2600, 2.5, p);
            break;

        case SND_ROUND_START:
            // Three rising notes. The round structure is the spine of the
            // game and it used to be completely silent.
            tone(300, 330, "square", 0.16, 0.22 * g, 0);
            trackTimeout(function () { tone(400, 440, "square", 0.16, 0.22 * g, 0); }, 170);
            trackTimeout(function () { tone(560, 620, "square", 0.30, 0.24 * g, 0); }, 340);
            break;

        case SND_ROUND_CLEAR:
            tone(700, 660, "triangle", 0.18, 0.22 * g, 0);
            trackTimeout(function () { tone(520, 480, "triangle", 0.18, 0.22 * g, 0); }, 180);
            trackTimeout(function () { tone(360, 300, "triangle", 0.42, 0.24 * g, 0); }, 360);
            break;

        case SND_GAMEOVER:
            tone(300, 60, "sawtooth", 1.3, 0.30 * g, 0);
            break;

        case SND_ULTRA:
            if (arg === 1) {
                // It falls: the heaviest thud in the game.
                noise(0.7, 0.5 * g, 110, 0.5, p);
                tone(80, 28, "square", 0.8, 0.32 * g, p);
            } else {
                // It arrives: a low, long growl you hear before you see it.
                tone(55, 38, "sawtooth", 1.1, 0.30 * g, p);
                noise(0.9, 0.20 * g, 160, 0.7, p);
                trackTimeout(function () { tone(48, 30, "sawtooth", 0.9, 0.24 * g, p); }, 420);
            }
            break;

        case SND_ARC:
            noise(0.07, 0.22 * g, 3200, 3, p);
            tone(1800, 600, "square", 0.06, 0.08 * g, p);
            break;

        case SND_POP:
            noise(0.22, 0.30 * g, 420, 0.8, p);
            tone(220, 70, "square", 0.18, 0.16 * g, p);
            break;

        case SND_GEN_TRIP:
            // Power dying: the generator's start-up, run backwards.
            tone(320, 40, "sawtooth", 1.5, 0.30 * g, p);
            noise(0.4, 0.22 * g, 1400, 2, p);
            break;

        case SND_DECOY:
            tone(520, 260, "triangle", 0.25, 0.20 * g, p);
            trackTimeout(function () { tone(520, 260, "triangle", 0.25, 0.16 * g, p); }, 280);
            break;

        default:
            break;
    }
}

// IDEA 41, sustained half: a rhythmic splintering tick while a barricade
// is under attack, pitch rising as its HP falls. Told without looking:
// which side is failing, and how close it is to going.
function updateBarricadeAudio() {
    if (!audioCtx || audioMuted) {
        if (Object.keys(audioLoops).length) stopAllLoops();
        return;
    }
    for (let i = 0; i < barricades.length; i++) {
        const b = barricades[i];
        const id = "bar" + i;
        const underAttack = b.chewUntil && Date.now() < b.chewUntil && b.hp > 0;
        if (!underAttack) {
            if (audioLoops[id]) stopLoop(id);
            continue;
        }
        const place = audioPlacement(b.x + b.w / 2, b.y + b.h / 2);
        if (!place) {
            if (audioLoops[id]) stopLoop(id);
            continue;
        }
        const frac = b.hp / b.maxHp;
        const freq = 90 + (1 - frac) * 150;      // rises as it fails
        const vol = 0.05 * place.gain;
        if (!audioLoops[id]) startLoop(id, freq, vol);
        else updateLoop(id, freq, vol);
    }
}

// IDEA 45's intensity drone lived here -- one sawtooth pitched to the
// nearby horde. Cut on request after the 2026-09-18 playtest ("has to go").
// Its job, telling you how bad it is getting without looking, moved to the
// score in zombie-music.js: the organ swells and a soprano line comes in as
// the count near you climbs.

// A rising tone while a revive is in progress (idea 43). Driven from the
// local player's own progress, so it needs no wire traffic at all.
let revToneAt = 0;
function updateReviveAudio() {
    if (!audioCtx || audioMuted) return;
    const now = Date.now();
    if (now - revToneAt < 220) return;
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (!p.downed || !p.reviveProgress) continue;
        revToneAt = now;
        tone(300 + p.reviveProgress * 500, 340 + p.reviveProgress * 540, "sine", 0.12, 0.16, 0);
        return;
    }
}

// ---------------------------------------------------
//   END-CARD READOUT (2026-09-19)
// ---------------------------------------------------
// The voices for the score readout typed out on the end cards (the
// sequencing lives with the card, in zombie-render.js). Everything is in D
// so it sits on top of the organ's own end cue, which is still ringing
// out when the readout starts: D minor pentatonic on a death, D major
// on an escape. Each line lands one step higher than the last.
const READOUT_STEPS_OVER = [587.33, 698.46, 783.99, 880.00, 1046.50, 1174.66];  // D F G A C D
const READOUT_STEPS_WIN  = [587.33, 659.25, 739.99, 880.00, 987.77, 1174.66];   // D E F# A B D

let readoutHum = null;             // { oscs, gain } while the final hum rings

// One printer key. Quiet and slightly varied, or thirty a second of the
// same click turns into a buzz.
function sndReadoutKey() {
    const f = 1700 + Math.random() * 400;
    tone(f, f * 0.8, "square", 0.018, 0.03, 0);
}

// A line's number has landed.
function sndReadoutLine(i, won) {
    const steps = won ? READOUT_STEPS_WIN : READOUT_STEPS_OVER;
    const f = steps[Math.min(i, steps.length - 1)];
    tone(f, f, "square", 0.14, 0.09, 0);
    tone(f * 2, f * 2, "triangle", 0.3, 0.05, 0);
}

// The total has landed: a chord, and under it a hum that swells in and then
// takes ~8s to die away. Low D, two detuned saws beating against each other
// plus an octave sine, through a lowpass so it reads as a hum rather than
// a buzz. Stops itself; stopReadoutHum() is only for cutting it short.
function sndReadoutFinal(won) {
    if (!audioCtx || audioMuted) return;
    const chord = won ? [146.83, 185.00, 220.00, 293.66, 440.00]   // D major, open
                      : [146.83, 174.61, 220.00, 293.66];          // D minor
    for (let i = 0; i < chord.length; i++) {
        tone(chord[i], chord[i], i % 2 ? "triangle" : "square", 2.4, 0.07, 0);
    }

    stopReadoutHum();
    try {
        const t = audioCtx.currentTime;
        const lp = audioCtx.createBiquadFilter();
        lp.type = "lowpass";
        lp.frequency.value = 420;
        const g = audioCtx.createGain();
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.16, t + 0.35);   // swell in
        g.gain.setValueAtTime(0.16, t + 1.6);                  // hold
        g.gain.exponentialRampToValueAtTime(0.0001, t + 9.5);  // the long drag out
        lp.connect(g);
        g.connect(audioMaster);

        const voices = [[73.42, "sawtooth"], [73.42 * 1.006, "sawtooth"], [146.83, "sine"]];
        const oscs = [];
        for (let i = 0; i < voices.length; i++) {
            const o = audioCtx.createOscillator();
            o.type = voices[i][1];
            o.frequency.value = voices[i][0];
            o.connect(lp);
            o.start(t);
            o.stop(t + 9.6);
            oscs.push(o);
        }
        readoutHum = { oscs: oscs, gain: g, endsAt: t + 9.6 };
    } catch (e) { readoutHum = null; }
}

// Restart, fold-back into a live room, or teardown while the hum rings.
function stopReadoutHum() {
    const h = readoutHum;
    readoutHum = null;
    if (!h || !audioCtx) return;
    try {
        const t = audioCtx.currentTime;
        if (t >= h.endsAt) return;
        h.gain.gain.cancelScheduledValues(t);
        h.gain.gain.setValueAtTime(Math.max(0.0001, h.gain.gain.value), t);
        h.gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2);
        for (let i = 0; i < h.oscs.length; i++) h.oscs[i].stop(t + 0.25);
    } catch (e) { /* already stopped */ }
}

loadAudioPrefs();
