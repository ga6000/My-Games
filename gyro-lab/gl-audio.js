// ===================================================
//   Gravity Lab — sound: ambient, engine by gear, gear shifts, autopilot lock
// ===================================================
// Added 2026-09-12 (AUDIO_LOCKS_PLAN.md). Owns the ONE AudioContext; the
// ultradrive's voices (gl-ultra.js) plug into it. Everything is synthesised
// with WebAudio — no files, so file:// is unaffected. A browser allows sound
// only after a user gesture, so nothing starts until the first key or click
// (glAudioUnlock, called from gl-boot.js). Paused = suspended.
//
// Graph: voices → ambient / engine / sfx buses (their volume sliders) →
// master (Master volume, Sound on) → speakers. The ultradrive has its own
// gain (Ultradrive → Volume) into master.
"use strict";

const glAudio = {
    ctx: null, master: null, ambBus: null, engBus: null, sfxBus: null, white: null, brown: null,
    amb: null, eng: null, started: false, pausedByUs: false, prevLock: false, prevRing: 0, tick: 0
};

function glAudioShipLocked() {
    const s = glShip;
    return !!(s && s.isAlive && s.autoOrbit && s.autoLock);
}

// Created lazily. Two seconds each of white and brown noise, shared by every
// noise voice. No AudioContext in this browser → silent, nothing breaks.
function glAudioCtx() {
    const A = glAudio;
    if (A.ctx) return A.ctx;
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    try {
        const ctx = new AC(), sr = ctx.sampleRate, len = sr * 2;
        A.master = ctx.createGain();
        A.master.gain.value = GLP.v.audioOn ? GLP.v.masterVolume : 0;
        A.master.connect(ctx.destination);
        const bus = function (v) { const g = ctx.createGain(); g.gain.value = v; g.connect(A.master); return g; };
        A.ambBus = bus(GLP.v.ambientVolume);
        A.engBus = bus(GLP.v.engineVolume);
        A.sfxBus = bus(GLP.v.sfxVolume);
        A.white = ctx.createBuffer(1, len, sr);
        A.brown = ctx.createBuffer(1, len, sr);
        const w = A.white.getChannelData(0), b = A.brown.getChannelData(0);
        let last = 0;
        for (let i = 0; i < len; i++) {
            w[i] = Math.random() * 2 - 1;
            last = (last + 0.02 * w[i]) / 1.02;
            b[i] = last * 3.5;
        }
        A.ctx = ctx;
        // What is already true when sound starts is not an event: the flown
        // ship boots on auto-orbit, and that must not chime on the first click.
        A.prevLock = glAudioShipLocked();
        A.prevRing = glRingSeq;
        return ctx;
    } catch (e) {
        return null;
    }
}

function glAudioNoise(buf) {
    const s = glAudio.ctx.createBufferSource();
    s.buffer = buf;
    s.loop = true;
    return s;
}

// From any key or click: builds the context, resumes it, starts the beds.
function glAudioUnlock() {
    const ctx = glAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended" && !glPaused) ctx.resume();
    if (!glAudio.started) {
        glAudio.started = true;
        glAudioStartAmbient();
        glAudioStartEngine();
    }
}

// ===================================================
//                  AMBIENT
// ===================================================
// A low brown-noise drone, a slow three-note pad (A1, E2, A2) with tremolo,
// and a faint high hiss. It follows WHERE you are: deep in a well the pad
// sinks in pitch with your clock (time dilation, audible), and in the galactic
// void it darkens and the hiss opens up.
const GL_AMB_PAD = [55, 82.41, 110.3];

function glAudioStartAmbient() {
    const A = glAudio, ctx = A.ctx, t = ctx.currentTime;
    const fade = ctx.createGain();
    fade.gain.value = 0;
    fade.gain.setTargetAtTime(1, t, 2.5);
    fade.connect(A.ambBus);
    const drone = glAudioNoise(A.brown), dLp = ctx.createBiquadFilter(), dG = ctx.createGain();
    dLp.type = "lowpass"; dLp.frequency.value = 180; dG.gain.value = 0.35;
    drone.connect(dLp); dLp.connect(dG); dG.connect(fade);
    const pLp = ctx.createBiquadFilter();
    pLp.type = "lowpass"; pLp.frequency.value = 900; pLp.Q.value = 0.5;
    const trem = ctx.createGain(), lfo = ctx.createOscillator(), lfoG = ctx.createGain();
    trem.gain.value = 0.7;
    lfo.frequency.value = 0.07;
    lfoG.gain.value = 0.3;
    lfo.connect(lfoG); lfoG.connect(trem.gain);
    const pads = GL_AMB_PAD.map(function (f, i) {
        const o = ctx.createOscillator(), g = ctx.createGain();
        o.type = i === 1 ? "triangle" : "sine";
        o.frequency.value = f;
        o.detune.value = (i - 1) * 4;
        g.gain.value = [0.07, 0.035, 0.03][i];
        o.connect(g); g.connect(pLp);
        o.start(t);
        return o;
    });
    pLp.connect(trem); trem.connect(fade);
    const hiss = glAudioNoise(A.white), hBp = ctx.createBiquadFilter(), hG = ctx.createGain();
    hBp.type = "bandpass"; hBp.frequency.value = 3200; hBp.Q.value = 6; hG.gain.value = 0.01;
    hiss.connect(hBp); hBp.connect(hG); hG.connect(fade);
    drone.start(t); hiss.start(t); lfo.start(t);
    A.amb = { pads: pads, pLp: pLp, dLp: dLp, hG: hG };
}

function glAudioAmbientUpdate() {
    const A = glAudio, m = A.amb, s = glShip;
    if (!m) return;
    const t = A.ctx.currentTime;
    const tau = Math.min(1, s.tau || 1);
    const v = glGalaxyVoid(s.x, s.y);
    const pitch = 0.5 + 0.5 * Math.sqrt(tau);
    for (let i = 0; i < m.pads.length; i++) m.pads[i].frequency.setTargetAtTime(GL_AMB_PAD[i] * pitch, t, 0.6);
    m.pLp.frequency.setTargetAtTime(1100 - 650 * v, t, 1.0);
    m.dLp.frequency.setTargetAtTime(220 - 90 * v, t, 1.0);
    m.hG.gain.setTargetAtTime(0.008 + 0.022 * v, t, 1.0);
}

// ===================================================
//                  ENGINE (by gear)
// ===================================================
// A turbine WHIR, not a motor (2026-09-12 — the first version, a sawtooth +
// square through a resonant lowpass, "sounded like a car"). Two sines a hair
// over an octave apart (their beat is the spin) and a soft third partial,
// amplitude-modulated by a ROTOR oscillator whose rate climbs with the gear,
// over a band of breathy air. Each gear raises the whine ~3 semitones (180 Hz
// at gear 0, 860 at gear 9) and spins the rotor faster. Bursts lift it a
// little. Silent in the ultradrive (it has its own rumble) and while dead. In
// E it follows the first selected formation's gear.
function glAudioStartEngine() {
    const A = glAudio, ctx = A.ctx, t = ctx.currentTime;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), o3 = ctx.createOscillator();
    const o2g = ctx.createGain(), o3g = ctx.createGain();
    o1.type = "sine"; o2.type = "sine"; o3.type = "triangle";
    o2g.gain.value = 0.5; o3g.gain.value = 0.12;
    const am = ctx.createGain(), rotor = ctx.createOscillator(), depth = ctx.createGain();
    am.gain.value = 0.75;
    rotor.type = "sine"; rotor.frequency.value = 6;
    depth.gain.value = 0.25;
    rotor.connect(depth); depth.connect(am.gain);
    const g = ctx.createGain();
    g.gain.value = 0;
    o1.connect(am); o2.connect(o2g); o2g.connect(am); o3.connect(o3g); o3g.connect(am);
    am.connect(g); g.connect(A.engBus);
    const air = glAudioNoise(A.white), bp = ctx.createBiquadFilter(), wg = ctx.createGain();
    bp.type = "bandpass"; bp.Q.value = 2.5; bp.frequency.value = 700; wg.gain.value = 0;
    air.connect(bp); bp.connect(wg); wg.connect(A.engBus);
    o1.start(t); o2.start(t); o3.start(t); rotor.start(t); air.start(t);
    A.eng = { o1: o1, o2: o2, o3: o3, rotor: rotor, g: g, bp: bp, wg: wg };
}

function glAudioGearNow() {
    if (glMode === "e") {
        const gs = glFleetGroups();
        return gs.length ? (gs[0].gear || 0) : 0;
    }
    return glHyperGear;
}

// Whine frequency for a gear (exposed for tests): 180 Hz × 1.19^gear.
function glAudioEngineHz(gear, burst) { return 180 * Math.pow(1.19, gear) * (1 + 0.06 * (burst ? 1 : 0)); }

function glAudioEngineUpdate() {
    const A = glAudio, m = A.eng, s = glShip;
    if (!m) return;
    const t = A.ctx.currentTime, gear = glAudioGearNow(), top = Math.max(1, GLP.v.hyperGearMax);
    const on = s.isAlive && s.ultraState !== "active";
    const burst = s.hyperActive || s.boost ? 1 : 0;
    const f = glAudioEngineHz(gear, burst);
    m.o1.frequency.setTargetAtTime(f, t, 0.15);
    m.o2.frequency.setTargetAtTime(f * 2.004, t, 0.15);
    m.o3.frequency.setTargetAtTime(f * 3, t, 0.15);
    m.rotor.frequency.setTargetAtTime(5 + 4 * gear + 2 * burst, t, 0.3);
    m.g.gain.setTargetAtTime(on ? 0.1 + 0.015 * gear + 0.03 * burst : 0, t, 0.2);
    m.bp.frequency.setTargetAtTime(f * 4, t, 0.2);
    m.wg.gain.setTargetAtTime(on ? 0.012 + 0.03 * gear / top : 0, t, 0.3);
}

// ===================================================
//                  CUES
// ===================================================
let glAudioCueCount = { gear: 0, lock: 0, ring: 0, shot: 0, traj: 0 };   // for tests

// Gear change (from glShiftGear): a mechanical click plus a chirp that rises
// on an upshift and falls on a downshift, pitched by the new gear. Dropping to
// gear 0 from above gear 1 (SPACE) is a longer power-down sweep instead.
function glAudioGear(from, to) {
    const A = glAudio, ctx = A.ctx;
    if (!ctx || from === to || !A.started) return;
    glAudioCueCount.gear++;
    const t = ctx.currentTime;
    const n = ctx.createBufferSource(), nb = ctx.createBiquadFilter(), ng = ctx.createGain();
    n.buffer = A.white;
    nb.type = "bandpass"; nb.frequency.value = 1800; nb.Q.value = 3;
    ng.gain.setValueAtTime(0.35, t);
    ng.gain.exponentialRampToValueAtTime(0.001, t + 0.05);
    n.connect(nb); nb.connect(ng); ng.connect(A.sfxBus);
    n.start(t, Math.random()); n.stop(t + 0.06);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = "triangle";
    const powerDown = to === 0 && from > 1;
    const f0 = 260 * Math.pow(1.19, to), dur = powerDown ? 0.45 : 0.14;
    if (powerDown) {
        o.frequency.setValueAtTime(260 * Math.pow(1.19, from), t);
        o.frequency.exponentialRampToValueAtTime(70, t + dur);
    } else {
        o.frequency.setValueAtTime(to > from ? f0 * 0.7 : f0 * 1.4, t);
        o.frequency.exponentialRampToValueAtTime(f0, t + dur);
    }
    og.gain.setValueAtTime(0.0001, t);
    og.gain.exponentialRampToValueAtTime(0.22, t + 0.015);
    og.gain.exponentialRampToValueAtTime(0.001, t + dur + 0.05);
    o.connect(og); og.connect(A.sfxBus);
    o.start(t); o.stop(t + dur + 0.08);
}

// Autopilot orbit engaged: a rising two-note "lock-on" — three notes when a
// formation forms a ring — over a soft bell an octave up.
function glAudioOrbitLock(ring) {
    const A = glAudio, ctx = A.ctx;
    if (!ctx || !A.started) return;
    glAudioCueCount[ring ? "ring" : "lock"]++;
    const t = ctx.currentTime, notes = ring ? [660, 880, 1320] : [660, 990];
    notes.forEach(function (f, i) {
        const o = ctx.createOscillator(), g = ctx.createGain(), t0 = t + i * 0.09;
        o.type = "sine"; o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.2, t0 + 0.01);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.08);
        o.connect(g); g.connect(A.sfxBus);
        o.start(t0); o.stop(t0 + 0.1);
    });
    const b = ctx.createOscillator(), bg = ctx.createGain(), tb = t + notes.length * 0.09;
    b.type = "triangle"; b.frequency.value = notes[notes.length - 1] * 2;
    bg.gain.setValueAtTime(0.0001, tb);
    bg.gain.exponentialRampToValueAtTime(0.07, tb + 0.01);
    bg.gain.exponentialRampToValueAtTime(0.001, tb + 0.8);
    b.connect(bg); bg.connect(A.sfxBus);
    b.start(tb); b.stop(tb + 0.85);
}

// Shot (glFire): a short laser "pew" — a square wave swept down, lowpassed.
function glAudioShot() {
    const A = glAudio, ctx = A.ctx;
    if (!ctx || !A.started) return;
    glAudioCueCount.shot++;
    const t = ctx.currentTime;
    const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    o.type = "square";
    o.frequency.setValueAtTime(1500, t);
    o.frequency.exponentialRampToValueAtTime(260, t + 0.11);
    lp.type = "lowpass"; lp.frequency.value = 3500;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.14, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.13);
    o.connect(lp); lp.connect(g); g.connect(A.sfxBus);
    o.start(t); o.stop(t + 0.14);
}

// Trajectory lock (right-click, solo): a low thunk and two clicks stepping
// UP when it clamps; the clicks step DOWN, without the thunk, on release.
function glAudioTrajLock(on) {
    const A = glAudio, ctx = A.ctx;
    if (!ctx || !A.started) return;
    glAudioCueCount.traj++;
    const t = ctx.currentTime, notes = on ? [520, 780] : [780, 460];
    notes.forEach(function (f, i) {
        const o = ctx.createOscillator(), lp = ctx.createBiquadFilter(), g = ctx.createGain(), t0 = t + i * 0.07;
        o.type = "square"; o.frequency.value = f;
        lp.type = "lowpass"; lp.frequency.value = 2400;
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.exponentialRampToValueAtTime(0.16, t0 + 0.004);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + 0.045);
        o.connect(lp); lp.connect(g); g.connect(A.sfxBus);
        o.start(t0); o.stop(t0 + 0.05);
    });
    if (!on) return;
    const k = ctx.createOscillator(), kg = ctx.createGain();
    k.type = "sine";
    k.frequency.setValueAtTime(130, t);
    k.frequency.exponentialRampToValueAtTime(55, t + 0.14);
    kg.gain.setValueAtTime(0.35, t);
    kg.gain.exponentialRampToValueAtTime(0.001, t + 0.18);
    k.connect(kg); kg.connect(A.sfxBus);
    k.start(t); k.stop(t + 0.2);
}

// Once per rendered frame, from the main loop. dt is 0 while paused.
function glAudioFrame(dt, paused) {
    const A = glAudio;
    if (!A.ctx) return;
    // Only resume what WE suspended: a context the browser is holding
    // suspended would otherwise get a rejected resume() every frame.
    if (paused && A.ctx.state === "running") { A.ctx.suspend(); A.pausedByUs = true; }
    else if (!paused && A.pausedByUs) { A.ctx.resume(); A.pausedByUs = false; }
    if (paused) return;
    const t = A.ctx.currentTime;
    A.master.gain.setTargetAtTime(GLP.v.audioOn ? GLP.v.masterVolume : 0, t, 0.05);
    A.ambBus.gain.setTargetAtTime(GLP.v.ambientVolume, t, 0.05);
    A.engBus.gain.setTargetAtTime(GLP.v.engineVolume, t, 0.05);
    A.sfxBus.gain.setTargetAtTime(GLP.v.sfxVolume, t, 0.05);
    // Voice targets ~15 Hz; they glide on setTargetAtTime anyway.
    if (A.tick++ % 4 === 0) { glAudioAmbientUpdate(); glAudioEngineUpdate(); }
    // Autopilot cues are EDGES, not states. A new ring takes precedence, so
    // a flown ship joining a ring chimes once, not twice.
    const lock = glAudioShipLocked();
    const ringNew = glRingSeq !== A.prevRing;
    A.prevRing = glRingSeq;
    if (ringNew) glAudioOrbitLock(true);
    else if (lock && !A.prevLock) glAudioOrbitLock(false);
    A.prevLock = lock;
}
