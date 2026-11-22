// ===================================================
//   Takeoff — sound: synthesised sfx, the music loop, the countdown voice
// ===================================================
// Everything is made in Web Audio at run time (no asset files), in the same
// voices as Gyro Fleet's gf-sfx.js (one oscillator tone, one filtered hiss).
//
// THE VOICE (Ry, 2026-11-21: "a countdown with a JavaScript library to
// render voice"). It is the browser's own Web Speech API (speechSynthesis):
// built into Chrome, Edge, Safari and Firefox, works over file://, needs no
// library or download. A low, slightly slow voice reads the count. If the
// browser has no voices, the count falls back to beeps and on-screen digits.
"use strict";

const toAudio = { ctx: null, master: null, sfx: null, music: null, white: null, brown: null, boost: null, rumble: null, started: false };

function toAudioStart() {
    if (toAudio.started) { if (toAudio.ctx && toAudio.ctx.state === "suspended") toAudio.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    const c = new AC();
    toAudio.ctx = c;
    toAudio.master = c.createGain(); toAudio.master.gain.value = 0.7; toAudio.master.connect(c.destination);
    toAudio.sfx = c.createGain(); toAudio.sfx.gain.value = 0.55; toAudio.sfx.connect(toAudio.master);
    toAudio.music = c.createGain(); toAudio.music.gain.value = 0.32; toAudio.music.connect(toAudio.master);
    const len = c.sampleRate * 2;
    const w = c.createBuffer(1, len, c.sampleRate), b = c.createBuffer(1, len, c.sampleRate);
    const wd = w.getChannelData(0), bd = b.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) { const r = Math.random() * 2 - 1; wd[i] = r; last = (last + 0.02 * r) / 1.02; bd[i] = last * 3.5; }
    toAudio.white = w; toAudio.brown = b;
    // Two held noises whose gain the game turns: the booster and the launch rumble.
    toAudio.boost = toLoopNoise(c, true, "lowpass", 900, 0);
    toAudio.rumble = toLoopNoise(c, true, "lowpass", 220, 0);
    toAudio.started = true;
    toMusicStart();
}
function toLoopNoise(c, brown, ftype, hz, vol) {
    const n = c.createBufferSource(), f = c.createBiquadFilter(), g = c.createGain();
    n.buffer = brown ? toAudio.brown : toAudio.white; n.loop = true;
    f.type = ftype; f.frequency.value = hz; g.gain.value = vol;
    n.connect(f); f.connect(g); g.connect(toAudio.sfx); n.start();
    return { g: g, f: f };
}
function toHold(h, vol, hz) {
    if (!h || !toAudio.ctx) return;
    const t = toAudio.ctx.currentTime;
    h.g.gain.setTargetAtTime(vol, t, 0.06);
    if (hz) h.f.frequency.setTargetAtTime(hz, t, 0.1);
}

const toSfxLast = {};
function toSfxOk(name, gap) {
    const A = toAudio;
    if (!A.ctx || !A.started) return null;
    const t = A.ctx.currentTime;
    if (toSfxLast[name] !== undefined && t - toSfxLast[name] < gap) return null;
    toSfxLast[name] = t;
    return A.ctx;
}
function toTone(ctx, type, f0, f1, dur, vol, when, lpHz, bus) {
    const t = ctx.currentTime + (when || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (lpHz) { const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = lpHz; o.connect(lp); lp.connect(g); }
    else o.connect(g);
    g.connect(bus || toAudio.sfx);
    o.start(t); o.stop(t + dur + 0.02);
}
function toHiss(ctx, brown, ftype, f0, f1, q, dur, vol, when, bus) {
    const t = ctx.currentTime + (when || 0), n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = brown ? toAudio.brown : toAudio.white; n.loop = true;
    f.type = ftype; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(bus || toAudio.sfx);
    n.start(t, Math.random()); n.stop(t + dur + 0.02);
}

function toSfx(name, k) {
    let c;
    k = k === undefined ? 1 : k;
    switch (name) {
    case "shot":
        if (!(c = toSfxOk(name, 0.05))) return;
        toTone(c, "square", 880, 420, 0.06, 0.07, 0, 3000);
        break;
    case "hit":
        if (!(c = toSfxOk(name, 0.04))) return;
        toHiss(c, false, "bandpass", 2400, 900, 3, 0.07, 0.18);
        break;
    case "tink":     // a bolt bouncing off armour
        if (!(c = toSfxOk(name, 0.06))) return;
        toTone(c, "triangle", 2600, 2300, 0.08, 0.08);
        break;
    case "pop":      // a kill: k = size
        if (!(c = toSfxOk(name, 0.03))) return;
        toHiss(c, true, "lowpass", 1400, 200, 1, 0.12 + 0.3 * k, 0.4 + 0.3 * k);
        toTone(c, "sine", 300 - 150 * k, 60, 0.12 + 0.25 * k, 0.25);
        break;
    case "wall":     // a bolt into the tendril wall
        if (!(c = toSfxOk(name, 0.07))) return;
        toHiss(c, true, "lowpass", 600, 200, 1, 0.08, 0.25);
        break;
    case "spot":     // a weak spot taking a hit
        if (!(c = toSfxOk(name, 0.06))) return;
        toTone(c, "sawtooth", 220, 110, 0.1, 0.12, 0, 900);
        toHiss(c, false, "bandpass", 1200, 500, 4, 0.1, 0.2);
        break;
    case "spotdie":
        if (!(c = toSfxOk(name, 0.2))) return;
        toHiss(c, true, "lowpass", 1600, 120, 1, 0.6, 0.6);
        toTone(c, "sawtooth", 180, 40, 0.6, 0.25, 0, 800);
        break;
    case "grip":     // tendrils seizing the mothership: a groan of metal
        if (!(c = toSfxOk(name, 1))) return;
        toTone(c, "sawtooth", 70, 45, 1.6, 0.25, 0, 500);
        toTone(c, "sawtooth", 140, 95, 1.6, 0.12, 0.1, 700);
        toHiss(c, true, "bandpass", 300, 120, 2, 1.6, 0.4);
        break;
    case "snap":     // the gate breaking free
        if (!(c = toSfxOk(name, 0.5))) return;
        toHiss(c, false, "highpass", 4000, 1200, 1, 0.25, 0.5);
        toTone(c, "square", 120, 40, 0.5, 0.3, 0.05, 900);
        toTone(c, "triangle", 660, 990, 0.4, 0.15, 0.2);
        toTone(c, "triangle", 990, 1320, 0.5, 0.12, 0.35);
        break;
    case "boom":     // k = size
        if (!(c = toSfxOk(name, 0.1))) return;
        toHiss(c, true, "lowpass", 900, 60, 1, 0.6 + 1.2 * k, 0.8);
        toTone(c, "sine", 110, 25, 0.6 + 1.2 * k, 0.6);
        break;
    case "hurt":     // the player ship hit
        if (!(c = toSfxOk(name, 0.12))) return;
        toTone(c, "square", 300, 120, 0.15, 0.12, 0, 1400);
        break;
    case "chip":     // the mothership taking a bite
        if (!(c = toSfxOk(name, 0.35))) return;
        toTone(c, "sawtooth", 95, 80, 0.18, 0.08, 0, 600);
        break;
    case "alarm":    // the held ship near the edge
        if (!(c = toSfxOk(name, 0.7))) return;
        toTone(c, "square", 660, 660, 0.18, 0.08, 0, 2000);
        toTone(c, "square", 495, 495, 0.18, 0.08, 0.22, 2000);
        break;
    case "caught":
        if (!(c = toSfxOk(name, 0.3))) return;
        toHiss(c, true, "bandpass", 500, 200, 3, 0.4, 0.4);
        toTone(c, "sine", 200, 90, 0.4, 0.2);
        break;
    case "free":
        if (!(c = toSfxOk(name, 0.3))) return;
        toHiss(c, false, "highpass", 2000, 4000, 1, 0.15, 0.3);
        break;
    case "beep":     // the count: k = 1 for the last
        if (!(c = toSfxOk(name, 0.3))) return;
        toTone(c, "square", k ? 1320 : 880, k ? 1320 : 880, k ? 0.5 : 0.14, 0.1, 0, 2500);
        break;
    case "iris":     // the aperture opening
        if (!(c = toSfxOk(name, 1))) return;
        toTone(c, "sawtooth", 60, 150, 2.4, 0.18, 0, 500);
        toHiss(c, true, "bandpass", 200, 800, 3, 2.4, 0.3);
        toTone(c, "sine", 90, 45, 0.3, 0.5, 2.3);
        break;
    case "dock":
        if (!(c = toSfxOk(name, 1))) return;
        toTone(c, "sine", 90, 50, 0.2, 0.5);
        [523, 659, 784, 1046].forEach(function (f, i) { toTone(c, "triangle", f, f, 0.5, 0.12, 0.15 + i * 0.12); });
        break;
    case "respawn":
        if (!(c = toSfxOk(name, 0.5))) return;
        toTone(c, "sine", 300, 900, 0.35, 0.12);
        break;
    case "lightning":
        if (!(c = toSfxOk(name, 0.4))) return;
        toHiss(c, false, "highpass", 5000, 800, 1, 0.3, 0.4);
        toHiss(c, true, "lowpass", 400, 50, 1, 2.2, 0.6, 0.15);
        break;
    }
}

// ---- the voice ----
let toVoice = null;
function toPickVoice() {
    if (!window.speechSynthesis) return;
    const vs = window.speechSynthesis.getVoices();
    if (!vs || !vs.length) return;
    const pref = [/Google UK English Male/i, /Daniel/i, /Microsoft (David|Guy|Ryan)/i, /en-GB/i, /en-US/i, /^en/i];
    for (let i = 0; i < pref.length; i++) {
        const v = vs.find(function (x) { return pref[i].test(x.name) || pref[i].test(x.lang); });
        if (v) { toVoice = v; return; }
    }
    toVoice = vs[0];
}
if (window.speechSynthesis) { toPickVoice(); try { window.speechSynthesis.addEventListener("voiceschanged", toPickVoice, { signal: toAbort.signal }); } catch (e) { /* old browsers */ } }
// Returns true if a voice will say it (so the caller can skip the beep).
function toSay(text) {
    if (!window.speechSynthesis || toHeadless()) return false;
    if (!toVoice) toPickVoice();
    try {
        const u = new window.SpeechSynthesisUtterance(text);
        if (toVoice) u.voice = toVoice;
        u.rate = 0.92; u.pitch = 0.62; u.volume = 1;
        window.speechSynthesis.speak(u);
        return !!toVoice;
    } catch (e) { return false; }
}
function toSayStop() { try { if (window.speechSynthesis) window.speechSynthesis.cancel(); } catch (e) { /* ignore */ } }

// ---- music ----
// One loop in A minor at 112 bpm, the same instrument family as the other
// Gyro games: a sawtooth bass, a square arpeggio, a sine kick, noise hats.
// The mood follows the phase: the count is a pulse, the climb and gates are
// full, the orbit drops the drums and opens into held pads, the dock resolves.
const toMus = { step: 0, next: 0, mood: "count", on: false };
const TO_CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]];   // Am F C G (midi)
function toMidi(m) { return 440 * Math.pow(2, (m - 69) / 12); }
function toMusicStart() {
    if (toMus.on || !toAudio.ctx) return;
    toMus.on = true; toMus.next = toAudio.ctx.currentTime + 0.1;
    toInterval(toMusicTick, 25);
}
function toMusicMood(m) { toMus.mood = m; }
function toMusicTick() {
    const c = toAudio.ctx;
    if (!c) return;
    const sp = 60 / 112 / 4;
    while (toMus.next < c.currentTime + 0.12) {
        toMusicStep(c, toMus.step, toMus.next - c.currentTime, sp);
        toMus.step++; toMus.next += sp;
    }
}
function toMusicStep(c, s, w, sp) {
    const m = toMus.mood, bus = toAudio.music, bar = Math.floor(s / 16) % 4, st = s % 16, ch = TO_CHORDS[bar];
    if (m === "silent" || m === "title") {
        if (m === "title" && st % 8 === 0) toTone(c, "sine", toMidi(ch[0] - 12), toMidi(ch[0] - 12), sp * 7, 0.12, w, 0, bus);
        return;
    }
    if (m === "count") {
        if (st % 4 === 0) toTone(c, "sine", toMidi(33), toMidi(33), sp * 3, 0.3, w, 0, bus);
        if (st === 0) toTone(c, "triangle", toMidi(ch[0]), toMidi(ch[0]), sp * 14, 0.06, w, 0, bus);
        return;
    }
    if (m === "orbit" || m === "dock") {
        if (st === 0) ch.forEach(function (n, i) { toTone(c, "sine", toMidi(n + 12), toMidi(n + 12), sp * 16, 0.07, w + i * 0.02, 0, bus); });
        if (st % 4 === 2) toTone(c, "triangle", toMidi(ch[(st / 4 | 0) % 3] + 24), toMidi(ch[(st / 4 | 0) % 3] + 24), sp * 3, 0.04, w, 0, bus);
        if (st === 0 || st === 8) toTone(c, "sine", toMidi(ch[0] - 24), toMidi(ch[0] - 24), sp * 8, 0.12, w, 0, bus);
        return;
    }
    const tense = m === "gate";
    // kick
    if (st % 4 === 0) toTone(c, "sine", 140, 40, 0.18, 0.5, w, 0, bus);
    // hats
    if (st % 2 === 1 || tense) toHiss(c, false, "highpass", 7000, 7000, 1, 0.04, tense ? 0.07 : 0.05, w, bus);
    if (tense && st % 8 === 4) toHiss(c, true, "bandpass", 1800, 600, 1, 0.12, 0.2, w, bus);   // snare
    // bass: root on the beat, octave on the off
    const root = ch[0] - 24 - (tense ? 0 : 0);
    if (st % 2 === 0) toTone(c, "sawtooth", toMidi(st % 4 === 0 ? root : root + 12), toMidi(st % 4 === 0 ? root : root + 12), sp * 1.6, 0.13, w, 600, bus);
    // arp
    const ar = [0, 1, 2, 1, 0, 2, 1, 2];
    if (!tense || st % 2 === 0) toTone(c, "square", toMidi(ch[ar[st % 8]] + 12), toMidi(ch[ar[st % 8]] + 12), sp * 0.9, 0.035, w, 2400, bus);
    if (tense && st === 0) toTone(c, "sawtooth", toMidi(ch[0]), toMidi(ch[0] - 1), sp * 15, 0.05, w, 900, bus);
}
