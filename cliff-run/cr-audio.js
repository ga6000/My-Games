/**
 * Cliff Run — audio
 * ===================================================
 * Declares only. cr-boot.js calls crAudioInit() from its own first input
 * event (browsers will not start a context without a gesture) and
 * crAudioFrame() once per rendered frame.
 *
 * ---------------------------------------------------------------------------
 * WHY THIS OWNS AN AudioContext INSTEAD OF LOADING shared/sfx.js
 * ---------------------------------------------------------------------------
 * The same call glass-city-escape/gc-audio.js made, for the same reason: SFX
 * is a one-shot vocabulary with no sustained-voice primitive, and the two most
 * important sounds in this game are sustained -- the wind tunnels and the
 * avalanche's "constant rumble", both of which the spec asks for by name and
 * both of which have to be modulated per frame by distance. Loading SFX as
 * well would put a SECOND AudioContext on the page, and browsers cap how many
 * a page may have.
 *
 * What that would have cost is paid back explicitly: the two jingles
 * shared/sfx.js says should "sound IDENTICAL everywhere" are reproduced here
 * note for note -- the rising triad for a pickup (523.25 / 659.25 / 783.99)
 * and the descending four-note death (392 / 329.63 / 261.63 / 196). A player
 * who learns in Zombie that a falling four-note figure means "you died" is not
 * asked to relearn it on the cliff.
 *
 * AESTHETIC_GUIDE.md 4.10: square and triangle, hard envelopes, no reverb.
 * Nothing here uses a JS timer -- every sequence is scheduled ahead on the
 * audio clock, which is also why it survives a dropped frame.
 */
"use strict";

var crActx = null;
var crMaster = null;
var crMuted = false;
var crVolume = 0.55;
var crNoiseBuf = null;

// The sustained voices. Created once with crAudioInit and gain-modulated by
// crAudioFrame; they run for the life of the context rather than being
// started and stopped, because a restarted noise source clicks.
var crWind = null;       // { src, filter, gain, pan }
var crRumble = null;     // { src, filter, gain, osc, oscGain }

var CR_SFX_KEY = "cr_sfx_cliff-run";

function crAudioInit() {
    if (crActx) {
        if (crActx.state === "suspended") { try { crActx.resume(); } catch (e) { /* ignore */ } }
        return true;
    }
    var Ctor = (typeof AudioContext !== "undefined") ? AudioContext :
               (typeof webkitAudioContext !== "undefined" ? webkitAudioContext : null);
    if (!Ctor) return false;
    try {
        crActx = new Ctor();
        crMaster = crActx.createGain();
        crMaster.gain.value = crMuted ? 0 : crVolume;
        crMaster.connect(crActx.destination);
        crNoiseBuf = crBuildNoise();
        crBuildWind();
        crBuildRumble();
        crLoadAudioPrefs();
        return true;
    } catch (e) {
        crActx = null;
        return false;
    }
}

function crLoadAudioPrefs() {
    try {
        var raw = localStorage.getItem(CR_SFX_KEY);
        if (!raw) return;
        var o = JSON.parse(raw);
        if (typeof o.muted === "boolean") crMuted = o.muted;
        if (typeof o.volume === "number") crVolume = crClamp(o.volume, 0, 1);
        if (crMaster) crMaster.gain.value = crMuted ? 0 : crVolume;
    } catch (e) { /* file:// with storage blocked; defaults are fine */ }
}

function crSaveAudioPrefs() {
    try {
        localStorage.setItem(CR_SFX_KEY, JSON.stringify({ muted: crMuted, volume: crVolume }));
    } catch (e) { /* ignore */ }
}

function crAudioToggleMute() {
    crMuted = !crMuted;
    if (crMaster) crMaster.gain.value = crMuted ? 0 : crVolume;
    crSaveAudioPrefs();
    return crMuted;
}

function crAudioMuted() { return crMuted; }

// Two seconds of white noise, generated once. Every wind, rumble, crumble and
// blast in the game is this one buffer through a different filter.
function crBuildNoise() {
    var len = Math.floor(crActx.sampleRate * 2);
    var buf = crActx.createBuffer(1, len, crActx.sampleRate);
    var ch = buf.getChannelData(0);
    for (var i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    return buf;
}

// ===================================================
//   SUSTAINED: THE WIND TUNNELS
// ===================================================
function crBuildWind() {
    var src = crActx.createBufferSource();
    src.buffer = crNoiseBuf;
    src.loop = true;
    var filter = crActx.createBiquadFilter();
    filter.type = "bandpass";
    filter.frequency.value = 760;
    filter.Q.value = 0.8;
    var gain = crActx.createGain();
    gain.gain.value = 0;
    var node = gain;
    var pan = null;
    if (typeof crActx.createStereoPanner === "function") {
        pan = crActx.createStereoPanner();
        gain.connect(pan);
        pan.connect(crMaster);
    } else {
        gain.connect(crMaster);
    }
    src.connect(filter);
    filter.connect(node);
    try { src.start(); } catch (e) { /* ignore */ }
    crWind = { src: src, filter: filter, gain: gain, pan: pan };
}

// ===================================================
//   SUSTAINED: THE AVALANCHE
// ===================================================
// "the last 5% of the left side of the screen which has a constant rumble" --
// so this one is never silent while a level is running, only quieter. Low
// noise plus a sub oscillator, because noise alone reads as hiss and an
// oscillator alone reads as a hum.
function crBuildRumble() {
    var src = crActx.createBufferSource();
    src.buffer = crNoiseBuf;
    src.loop = true;
    var filter = crActx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.value = 190;
    var gain = crActx.createGain();
    gain.gain.value = 0;
    src.connect(filter);
    filter.connect(gain);
    gain.connect(crMaster);
    try { src.start(); } catch (e) { /* ignore */ }

    var osc = crActx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 41;
    var oscGain = crActx.createGain();
    oscGain.gain.value = 0;
    osc.connect(oscGain);
    oscGain.connect(crMaster);
    try { osc.start(); } catch (e) { /* ignore */ }

    crRumble = { src: src, filter: filter, gain: gain, osc: osc, oscGain: oscGain };
}

/*
 * Per frame. Both voices are driven by DISTANCE, not by events:
 *
 *   wind    -- how close the listener is to the nearest gust rect, panned by
 *              which side of the listener it is on, so a vent you are about to
 *              cross announces itself before you can see its gust.
 *   rumble  -- how close the listener is to the avalanche line. Never zero
 *              while a level runs; that is what "constant" means.
 *
 * Ramps are short but not instant (0.08s): a gain stepped per frame on a
 * noise source is audible as a buzz at frame rate.
 */
function crAudioFrame(level, listener) {
    if (!crActx || crActx.state !== "running") return;
    var t = crActx.currentTime;

    var windTarget = 0, windPan = 0, windFreq = 760;
    if (level && listener) {
        var near = crNearestGust(level, listener.x + listener.w / 2, listener.y + listener.h / 2);
        if (near.gust) {
            var falloff = crClamp(1 - near.dist / 150, 0, 1);
            windTarget = 0.30 * falloff * falloff;
            var gcx = near.gust.x + near.gust.w / 2;
            windPan = crClamp((gcx - (listener.x + listener.w / 2)) / 180, -1, 1);
            // An updraft is a higher, thinner whistle than a crosswind.
            windFreq = near.gust.dir === "up" ? 980 : 540;
        }
    }
    crRamp(crWind.gain.gain, windTarget, t);
    crRamp(crWind.filter.frequency, windFreq, t, 0.25);
    if (crWind.pan) crRamp(crWind.pan.pan, windPan, t, 0.2);

    var rumbleTarget = 0, subTarget = 0;
    if (level && listener && crPhase === "play") {
        var d = (listener.x - crAvalancheX);
        var prox = crClamp(1 - d / 260, 0, 1);
        rumbleTarget = 0.06 + 0.34 * prox * prox;
        subTarget = 0.02 + 0.20 * prox * prox * prox;
    }
    crRamp(crRumble.gain.gain, rumbleTarget, t);
    crRamp(crRumble.oscGain.gain, subTarget, t);
}

function crRamp(param, value, t, time) {
    try { param.setTargetAtTime(value, t, time || 0.08); }
    catch (e) { try { param.value = value; } catch (e2) { /* ignore */ } }
}

// ===================================================
//   ONE-SHOTS
// ===================================================
function crTone(o) {
    if (!crActx || crMuted) return;
    try {
        var t0 = crActx.currentTime + (o.at || 0);
        var dur = typeof o.dur === "number" ? o.dur : 0.08;
        var g = typeof o.gain === "number" ? o.gain : 0.22;
        var osc = crActx.createOscillator();
        osc.type = o.type || "square";
        osc.frequency.setValueAtTime(o.freq || 440, t0);
        if (typeof o.slideTo === "number") {
            osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t0 + dur);
        }
        var env = crActx.createGain();
        // Hard envelope: 5ms on, flat, 40ms off. Smooth is what makes
        // synthesised audio read as modern rather than as a cabinet.
        env.gain.setValueAtTime(0.0001, t0);
        env.gain.exponentialRampToValueAtTime(g, t0 + (o.attack || 0.005));
        env.gain.setValueAtTime(g, t0 + dur);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + (o.release || 0.04));
        osc.connect(env);
        env.connect(crMaster);
        osc.start(t0);
        osc.stop(t0 + dur + 0.06);
        // One-shot nodes; without this the graph grows for the life of the page.
        osc.onended = function () { try { osc.disconnect(); env.disconnect(); } catch (e) { /* gone */ } };
    } catch (e) { /* never let a sound break a frame */ }
}

function crSeq(notes, o) {
    o = o || {};
    var step = typeof o.step === "number" ? o.step : 0.07;
    for (var i = 0; i < notes.length; i++) {
        crTone({
            freq: notes[i], dur: o.dur || 0.06, type: o.type || "square",
            gain: o.gain || 0.2, at: (o.at || 0) + i * step
        });
    }
}

function crNoise(o) {
    if (!crActx || crMuted || !crNoiseBuf) return;
    try {
        var t0 = crActx.currentTime + (o.at || 0);
        var dur = o.dur || 0.12;
        var src = crActx.createBufferSource();
        src.buffer = crNoiseBuf;
        var f = crActx.createBiquadFilter();
        f.type = o.type || "lowpass";
        f.frequency.setValueAtTime(o.freq || 900, t0);
        if (typeof o.slideTo === "number") {
            f.frequency.exponentialRampToValueAtTime(Math.max(40, o.slideTo), t0 + dur);
        }
        var env = crActx.createGain();
        env.gain.setValueAtTime(o.gain || 0.2, t0);
        env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
        src.connect(f); f.connect(env); env.connect(crMaster);
        src.start(t0);
        src.stop(t0 + dur + 0.02);
        src.onended = function () { try { src.disconnect(); f.disconnect(); env.disconnect(); } catch (e) { /* gone */ } };
    } catch (e) { /* ignore */ }
}

// --- movement
function crSfxJump() { crTone({ freq: 420, slideTo: 700, dur: 0.07, type: "square", gain: 0.16 }); }
function crSfxDoubleJump() {
    crTone({ freq: 700, slideTo: 1180, dur: 0.07, type: "square", gain: 0.17 });
    crTone({ freq: 1180, dur: 0.04, type: "triangle", gain: 0.1, at: 0.06 });
}
function crSfxWallJump() { crTone({ freq: 300, slideTo: 540, dur: 0.06, type: "triangle", gain: 0.18 }); }
function crSfxDash() {
    crNoise({ freq: 2600, slideTo: 420, dur: 0.16, type: "bandpass", gain: 0.24 });
    crTone({ freq: 160, slideTo: 90, dur: 0.1, type: "sawtooth", gain: 0.1 });
}
function crSfxLand() { crNoise({ freq: 420, slideTo: 150, dur: 0.05, gain: 0.1 }); }
function crSfxSpring() {
    // A branch loading and releasing: two notes up, fast.
    crTone({ freq: 240, slideTo: 880, dur: 0.12, type: "triangle", gain: 0.22 });
    crTone({ freq: 1320, dur: 0.05, type: "square", gain: 0.1, at: 0.1 });
}
function crSfxBounce() { crTone({ freq: 520, slideTo: 300, dur: 0.06, type: "square", gain: 0.19 }); }

// --- items. The pickup triad is shared/sfx.js's, note for note (see header).
function crSfxPickup() { crSeq([523.25, 659.25, 783.99], { type: "square", step: 0.06, dur: 0.05, gain: 0.2 }); }
function crSfxCoin() { crTone({ freq: 1046.5, dur: 0.03, type: "square", gain: 0.14 });
                       crTone({ freq: 1568, dur: 0.05, type: "square", gain: 0.12, at: 0.03 }); }

// --- the cliff coming apart
function crSfxCrumble() { crNoise({ freq: 1400, slideTo: 600, dur: 0.1, type: "bandpass", gain: 0.16 }); }
function crSfxTick() { crTone({ freq: 1500, dur: 0.02, type: "square", gain: 0.12 }); }
function crSfxCollapse() {
    crNoise({ freq: 700, slideTo: 90, dur: 0.42, gain: 0.2 });
    crTone({ freq: 90, slideTo: 40, dur: 0.3, type: "triangle", gain: 0.12 });
}
function crSfxBombPlace() { crTone({ freq: 180, dur: 0.05, type: "square", gain: 0.16 });
                            crTone({ freq: 1200, dur: 0.02, type: "square", gain: 0.08, at: 0.05 }); }
function crSfxBombBlast() {
    crNoise({ freq: 1800, slideTo: 60, dur: 0.5, gain: 0.34 });
    crTone({ freq: 70, slideTo: 32, dur: 0.34, type: "sawtooth", gain: 0.2 });
}

// --- the two deaths, which must not sound alike: the player has to know which
//     one got them without reading anything.
function crSfxDeathFall() {
    // shared/sfx.js's descending four-note death, unchanged.
    crSeq([392.00, 329.63, 261.63, 196.00], { type: "triangle", step: 0.11, dur: 0.1, gain: 0.26 });
    crTone({ freq: 600, slideTo: 70, dur: 0.6, type: "sine", gain: 0.12 });
}
function crSfxDeathAvalanche() {
    crNoise({ freq: 900, slideTo: 50, dur: 0.9, gain: 0.4 });
    crTone({ freq: 60, slideTo: 28, dur: 0.7, type: "sawtooth", gain: 0.24 });
    crSeq([196.00, 174.61, 146.83], { type: "triangle", step: 0.13, dur: 0.12, gain: 0.2, at: 0.2 });
}

// --- flow
function crSfxCountdown(n) { crTone({ freq: n > 0 ? 520 : 1040, dur: n > 0 ? 0.07 : 0.16, type: "square", gain: 0.22 }); }
function crSfxLevelStart() {
    crSeq([392, 523.25, 659.25, 783.99], { type: "square", step: 0.075, dur: 0.07, gain: 0.22 });
}
function crSfxFinish(place) {
    var base = place === 1 ? 523.25 : (place === 2 ? 440 : 392);
    crSeq([base, base * 1.26, base * 1.5, base * 2], { type: "square", step: 0.07, dur: 0.08, gain: 0.24 });
}
function crSfxLevelEnd() {
    crSeq([659.25, 783.99, 1046.5], { type: "square", step: 0.1, dur: 0.1, gain: 0.22 });
}
function crSfxRunWin() {
    crSeq([523.25, 659.25, 783.99, 1046.5, 1318.5], { type: "square", step: 0.11, dur: 0.12, gain: 0.26 });
}
function crSfxRunOver() {
    crSeq([261.63, 233.08, 196.00, 164.81], { type: "triangle", step: 0.16, dur: 0.15, gain: 0.26 });
}

// ===================================================
//   TEARDOWN
// ===================================================
// Called from GameInstance.destroy(). Browsers cap live contexts per page, so
// an init/destroy cycle that never closes one eventually fails to make another
// -- which is the whole reason shared/sfx.js grew the same method.
function crAudioDestroy() {
    try {
        if (crWind) { try { crWind.src.stop(); } catch (e) { /* ignore */ } }
        if (crRumble) {
            try { crRumble.src.stop(); } catch (e) { /* ignore */ }
            try { crRumble.osc.stop(); } catch (e) { /* ignore */ }
        }
        if (crActx && typeof crActx.close === "function") crActx.close();
    } catch (e) { /* ignore */ }
    crActx = null; crMaster = null; crWind = null; crRumble = null; crNoiseBuf = null;
}
