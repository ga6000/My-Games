// ===================================================
//   Desert Code Racer — sound (every SFX procedural, WebAudio)
// ===================================================
// shared/sfx.js does the short tonal cues it is built for (pickups, blips,
// jingles) and owns the mute preference. It has no continuous voices and no
// noise, so this file keeps one AudioContext of its own for the engine hum,
// the beam charge and every explosion. Square, saw and triangle, hard
// envelopes, no reverb (AESTHETIC_GUIDE §4.10).
//
// MUSIC: none in this pass (Ry will add the loop). dcMusic is the one hook:
// dc-flow.js calls dcMusic.start() when a run goes live and dcMusic.stop()
// when it ends. Put the loop in there.
"use strict";

const dcMusic = {
    playing: false,
    start: function () { this.playing = true; /* the music loop starts here */ },
    stop: function () { this.playing = false; /* and stops here */ }
};

const dcAudio = {
    ctx: null, master: null, noise: null,
    engine: null, lastBeamCharge: 0
};

function dcAudioInit() {
    if (typeof SFX !== "undefined") { try { SFX.init(); } catch (e) { /* silent */ } }
    if (dcAudio.ctx) {
        if (dcAudio.ctx.state === "suspended") { try { dcAudio.ctx.resume(); } catch (e) { /* ignore */ } }
        return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    try {
        const ctx = new Ctor();
        const master = ctx.createGain();
        master.gain.value = dcMuted() ? 0 : 0.55;
        master.connect(ctx.destination);
        const len = ctx.sampleRate;
        const buf = ctx.createBuffer(1, len, ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
        dcAudio.ctx = ctx; dcAudio.master = master; dcAudio.noise = buf;
    } catch (e) { dcAudio.ctx = null; }
}

function dcMuted() {
    return typeof SFX !== "undefined" && SFX.isMuted && SFX.isMuted();
}

function dcToggleMute() {
    if (typeof SFX !== "undefined" && SFX.toggleMute) SFX.toggleMute();
    if (dcAudio.master) dcAudio.master.gain.value = dcMuted() ? 0 : 0.55;
}

function dcAudioReady() { return !!dcAudio.ctx && dcAudio.ctx.state === "running"; }

// One enveloped oscillator. Scheduled on the audio clock, so no JS timers.
function dcTone(o) {
    if (!dcAudioReady()) return;
    try {
        const ctx = dcAudio.ctx, t0 = ctx.currentTime + (o.at || 0);
        const osc = ctx.createOscillator();
        osc.type = o.type || "square";
        osc.frequency.setValueAtTime(o.f, t0);
        if (o.to) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.to), t0 + (o.d || 0.1));
        const g = ctx.createGain();
        const peak = (o.g || 0.2) * (o.vol === undefined ? 1 : o.vol);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + (o.a || 0.004));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + (o.d || 0.1));
        osc.connect(g); g.connect(dcAudio.master);
        osc.start(t0); osc.stop(t0 + (o.d || 0.1) + 0.03);
    } catch (e) { /* audio is never worth a frame */ }
}

// A filtered noise burst: explosions, crashes, scrub, whooshes.
function dcNoise(o) {
    if (!dcAudioReady()) return;
    try {
        const ctx = dcAudio.ctx, t0 = ctx.currentTime + (o.at || 0);
        const src = ctx.createBufferSource();
        src.buffer = dcAudio.noise;
        const f = ctx.createBiquadFilter();
        f.type = o.hp ? "highpass" : "lowpass";
        f.frequency.setValueAtTime(o.f || 1200, t0);
        if (o.to) f.frequency.exponentialRampToValueAtTime(Math.max(30, o.to), t0 + (o.d || 0.3));
        const g = ctx.createGain();
        const peak = (o.g || 0.3) * (o.vol === undefined ? 1 : o.vol);
        g.gain.setValueAtTime(0.0001, t0);
        g.gain.linearRampToValueAtTime(peak, t0 + (o.a || 0.005));
        g.gain.exponentialRampToValueAtTime(0.0001, t0 + (o.d || 0.3));
        src.connect(f); f.connect(g); g.connect(dcAudio.master);
        src.start(t0, Math.random() * 0.5); src.stop(t0 + (o.d || 0.3) + 0.05);
    } catch (e) { /* ignore */ }
}

// Distance falloff for a sound at world z relative to the local bike.
function dcVolAt(z) {
    if (!dc.me) return 1;
    const d = Math.abs(z - dc.me.z) / DC_SEG;
    return dcClamp(1 - d / 140, 0.08, 1);
}

// ---- the engine: a continuous voice tied to speed ----
function dcEngineUpdate(r) {
    if (!dcAudioReady()) return;
    const ctx = dcAudio.ctx;
    if (!dcAudio.engine) {
        try {
            const a = ctx.createOscillator(), b = ctx.createOscillator(), c = ctx.createOscillator();
            a.type = "sawtooth"; b.type = "square"; c.type = "triangle";
            const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600;
            const g = ctx.createGain(); g.gain.value = 0;
            const ng = ctx.createGain(); ng.gain.value = 0;
            const ns = ctx.createBufferSource(); ns.buffer = dcAudio.noise; ns.loop = true;
            const nf = ctx.createBiquadFilter(); nf.type = "bandpass"; nf.frequency.value = 400;
            a.connect(lp); b.connect(lp); c.connect(lp); lp.connect(g); g.connect(dcAudio.master);
            ns.connect(nf); nf.connect(ng); ng.connect(dcAudio.master);
            a.start(); b.start(); c.start(); ns.start();
            dcAudio.engine = { a: a, b: b, c: c, lp: lp, g: g, ng: ng };
        } catch (e) { return; }
    }
    const e = dcAudio.engine, t = ctx.currentTime;
    const live = r && !r.down && (dc.mode === "play" || dc.mode === "aftermath");
    const sp = r ? dcClamp(r.v / DC_BOOST, 0, 1.2) : 0;
    const base = 38 + sp * 120 + (r && r.boosting ? 18 : 0);
    e.a.frequency.setTargetAtTime(base, t, 0.08);
    e.b.frequency.setTargetAtTime(base * 0.5, t, 0.08);
    e.c.frequency.setTargetAtTime(base * (r && r.boosting ? 3.02 : 2.01), t, 0.08);
    e.lp.frequency.setTargetAtTime(300 + sp * 1500, t, 0.1);
    e.g.gain.setTargetAtTime(live ? 0.05 + sp * 0.06 : 0, t, 0.1);
    const off = live && r && dc.track && (!dcOnRoad(r.x, dcSegAt(r.z)) || r.dustT > 0 || r.scrape > 0);
    e.ng.gain.setTargetAtTime(off ? 0.12 : (live ? 0.015 + sp * 0.02 : 0), t, 0.1);
}

function dcEngineStop() {
    if (!dcAudio.engine || !dcAudio.ctx) return;
    const t = dcAudio.ctx.currentTime;
    dcAudio.engine.g.gain.setTargetAtTime(0, t, 0.2);
    dcAudio.engine.ng.gain.setTargetAtTime(0, t, 0.2);
}

// ---- the cue sheet ----
const dcSnd = {
    beamCharge: function (vol) {         // the mothership picks a rider
        dcTone({ f: 180, to: 900, d: DC_TUNE.track, type: "sawtooth", g: 0.06, vol: vol, a: 0.3 });
        dcTone({ f: 90, to: 450, d: DC_TUNE.track, type: "square", g: 0.035, vol: vol, a: 0.3 });
    },
    beamLock: function (vol) {           // the ring stops following: move now
        dcTone({ f: 1320, d: 0.07, g: 0.14, vol: vol });
        dcTone({ f: 1320, d: 0.07, g: 0.14, vol: vol, at: 0.12 });
        dcTone({ f: 1760, to: 2400, d: DC_TUNE.lock, type: "sawtooth", g: 0.05, vol: vol, at: 0.2 });
    },
    beamImpact: function (vol) {
        dcNoise({ f: 2400, to: 80, d: 0.7, g: 0.5, vol: vol });
        dcTone({ f: 120, to: 30, d: 0.5, type: "sine", g: 0.5, vol: vol });
    },
    beamDowned: function (vol) {         // shot, jammed or soaked: a fizzle
        dcTone({ f: 1800, to: 200, d: 0.25, type: "square", g: 0.12, vol: vol });
        dcNoise({ f: 5000, to: 800, d: 0.2, g: 0.15, vol: vol, hp: true });
    },
    crash: function () {
        dcNoise({ f: 3000, to: 60, d: 1.1, g: 0.6 });
        dcTone({ f: 300, to: 40, d: 0.8, type: "sawtooth", g: 0.25 });
        dcTone({ f: 70, to: 30, d: 0.6, type: "sine", g: 0.5, at: 0.05 });
    },
    stumble: function () {
        dcNoise({ f: 1500, to: 300, d: 0.25, g: 0.25 });
        dcTone({ f: 500, to: 900, d: 0.18, type: "triangle", g: 0.15, at: 0.05 });
    },
    remount: function () { dcTone({ f: 220, to: 660, d: 0.25, type: "square", g: 0.12 }); },
    casePickup: function () {
        if (typeof SFX !== "undefined") SFX.pickup();
        dcTone({ f: 1046, d: 0.12, type: "triangle", g: 0.12, at: 0.18 });
    },
    caseDrop: function () {
        dcTone({ f: 660, to: 330, d: 0.18, type: "square", g: 0.16 });
        dcTone({ f: 440, to: 165, d: 0.25, type: "square", g: 0.16, at: 0.16 });
        dcNoise({ f: 4000, to: 1500, d: 0.08, g: 0.25, at: 0.38, hp: true });   // the clank on the road
    },
    caseTick: function () { dcTone({ f: 880, d: 0.05, type: "square", g: 0.08 }); },
    pipLost: function () {
        dcTone({ f: 220, d: 0.12, type: "sawtooth", g: 0.18 });
        dcTone({ f: 185, d: 0.2, type: "sawtooth", g: 0.18, at: 0.13 });
    },
    jump: function () { dcNoise({ f: 400, to: 3000, d: 0.3, g: 0.18, hp: true }); dcTone({ f: 300, to: 600, d: 0.2, type: "triangle", g: 0.1 }); },
    land: function () { dcNoise({ f: 600, to: 100, d: 0.18, g: 0.3 }); dcTone({ f: 90, to: 50, d: 0.15, type: "sine", g: 0.3 }); },
    ramp: function () { dcTone({ f: 200, to: 1200, d: 0.4, type: "square", g: 0.12 }); dcNoise({ f: 800, to: 4000, d: 0.4, g: 0.15, hp: true }); },
    mine: function (vol) {
        dcTone({ f: 2000, d: 0.04, g: 0.15, vol: vol });
        dcNoise({ f: 1800, to: 70, d: 0.6, g: 0.5, vol: vol, at: 0.05 });
        dcTone({ f: 90, to: 35, d: 0.5, type: "sine", g: 0.45, vol: vol, at: 0.05 });
    },
    minePop: function (vol) {           // set off harmlessly by an ability
        dcTone({ f: 1400, to: 300, d: 0.12, type: "square", g: 0.1, vol: vol });
        dcNoise({ f: 1200, to: 200, d: 0.25, g: 0.2, vol: vol, at: 0.04 });
    },
    smash: function (vol) {
        dcNoise({ f: 2500, to: 200, d: 0.45, g: 0.45, vol: vol });
        for (let i = 0; i < 4; i++) dcTone({ f: 300 + Math.random() * 600, d: 0.05, type: "square", g: 0.1, vol: vol, at: i * 0.05 });
    },
    gap: function () { dcTone({ f: 1500, to: 2200, d: 0.06, type: "triangle", g: 0.06 }); },
    krillIncoming: function (vol) {
        for (let i = 0; i < 6; i++) dcTone({ f: 2200 + Math.random() * 1400, d: 0.03, type: "square", g: 0.05, vol: vol, at: i * 0.06 });
    },
    krillLatch: function () {
        for (let i = 0; i < 8; i++) dcTone({ f: 1600 + Math.random() * 1800, d: 0.025, type: "square", g: 0.08, at: i * 0.04 });
        dcNoise({ f: 3000, to: 1000, d: 0.2, g: 0.15, hp: true });
    },
    krillChitter: function () { dcTone({ f: 2600 + Math.random() * 1600, d: 0.02, type: "square", g: 0.035 }); },
    krillOff: function (vol) {
        dcTone({ f: 2400, to: 400, d: 0.18, type: "square", g: 0.1, vol: vol });
        dcNoise({ f: 6000, to: 2000, d: 0.12, g: 0.12, vol: vol, hp: true });
    },
    // ---- abilities ----
    mend: function () {
        [523, 659, 784, 1046].forEach(function (f, i) { dcTone({ f: f, d: 0.25, type: "sine", g: 0.13, at: i * 0.07 }); });
        dcTone({ f: 1568, d: 0.6, type: "triangle", g: 0.06, at: 0.28 });
    },
    rig: function () {
        dcNoise({ f: 3000, to: 1200, d: 0.08, g: 0.3, hp: true });
        dcNoise({ f: 3000, to: 1200, d: 0.08, g: 0.3, hp: true, at: 0.14 });
        dcTone({ f: 110, d: 0.9, type: "sawtooth", g: 0.07, at: 0.2, a: 0.1 });
        dcTone({ f: 220, to: 330, d: 0.9, type: "square", g: 0.04, at: 0.2, a: 0.1 });
    },
    beaconHum: function (vol) { dcTone({ f: 165, d: 0.3, type: "square", g: 0.03, vol: vol }); },
    scan: function () {
        for (let i = 0; i < 4; i++) dcTone({ f: 1250, d: 0.35, type: "sine", g: 0.18 * Math.pow(0.5, i), at: i * 0.22 });
        dcTone({ f: 400, to: 2400, d: 0.9, type: "triangle", g: 0.05 });
    },
    fire: function () {
        for (let i = 0; i < 7; i++) {
            dcTone({ f: 900, to: 140, d: 0.07, type: "sawtooth", g: 0.16, at: i * 0.055 });
            dcNoise({ f: 5000, to: 900, d: 0.05, g: 0.14, hp: true, at: i * 0.055 });
        }
    },
    ram: function () {
        dcTone({ f: 70, to: 140, d: 1.2, type: "sawtooth", g: 0.2, a: 0.05 });
        dcTone({ f: 105, to: 210, d: 1.2, type: "square", g: 0.1, a: 0.05 });
        dcNoise({ f: 300, to: 2400, d: 1.0, g: 0.25 });
    },
    shield: function () {
        [392, 494, 587, 784].forEach(function (f) { dcTone({ f: f, to: f * 1.5, d: 0.7, type: "triangle", g: 0.08, a: 0.06 }); });
        dcNoise({ f: 6000, d: 0.5, g: 0.06, hp: true });
    },
    soak: function () { dcTone({ f: 880, to: 1760, d: 0.3, type: "triangle", g: 0.18 }); dcNoise({ f: 7000, to: 2500, d: 0.3, g: 0.12, hp: true }); },
    abilityReady: function () { dcTone({ f: 1760, d: 0.05, type: "square", g: 0.06 }); },
    denied: function () { dcTone({ f: 140, d: 0.08, type: "square", g: 0.08 }); },
    // ---- the run ----
    checkpoint: function () {
        [523, 659, 784, 1046].forEach(function (f, i) { dcTone({ f: f, d: 0.14, type: "square", g: 0.14, at: i * 0.1 }); });
        dcTone({ f: 1046, d: 0.5, type: "triangle", g: 0.12, at: 0.4 });
    },
    win: function () {
        const n = [523, 659, 784, 1046, 784, 1046, 1318];
        n.forEach(function (f, i) { dcTone({ f: f, d: 0.16, type: "square", g: 0.14, at: i * 0.12 }); });
        dcTone({ f: 1568, d: 1.0, type: "triangle", g: 0.12, at: n.length * 0.12 });
    },
    lose: function () {
        if (typeof SFX !== "undefined") SFX.death();
        dcNoise({ f: 1500, to: 50, d: 1.6, g: 0.5, at: 0.1 });
    },
    go: function () { dcTone({ f: 1046, d: 0.25, type: "square", g: 0.14 }); dcTone({ f: 1568, d: 0.4, type: "square", g: 0.1, at: 0.08 }); },
    tick: function () { dcTone({ f: 660, d: 0.06, type: "square", g: 0.1 }); },
    // ---- pass 2 ----
    chip: function () { dcTone({ f: 1975, d: 0.05, type: "square", g: 0.07 }); dcTone({ f: 2637, d: 0.07, type: "square", g: 0.06, at: 0.04 }); },
    scrape: function () { dcNoise({ f: 5000, to: 2500, d: 0.12, g: 0.12, hp: true }); },
    gripTick: function (urgent) {        // latched krill: a countdown you can hear
        dcTone({ f: urgent ? 1480 : 990, d: 0.05, type: "square", g: urgent ? 0.13 : 0.08 });
    },
    krillBite: function () {             // the krill drag a rider down
        for (let i = 0; i < 10; i++) dcTone({ f: 1200 + Math.random() * 2400, d: 0.03, type: "sawtooth", g: 0.09, at: i * 0.03 });
        dcNoise({ f: 900, to: 120, d: 0.5, g: 0.35, at: 0.1 });
    },
    homing: function () {                // Greer's seekers leave the gun
        for (let i = 0; i < 5; i++) dcTone({ f: 700 + i * 160, to: 2400, d: 0.18, type: "sawtooth", g: 0.07, at: i * 0.04 });
    },
    seekerHit: function (vol) { dcTone({ f: 2200, to: 500, d: 0.1, type: "square", g: 0.1, vol: vol }); },
    lashWarn: function (vol) {           // a tendril rearing over the road: a rising groan
        dcTone({ f: 55, to: 110, d: 1.0, type: "sawtooth", g: 0.16, vol: vol, a: 0.3 });
        dcNoise({ f: 300, to: 900, d: 1.0, g: 0.12, vol: vol, a: 0.4 });
    },
    lashSweep: function (vol) {
        dcNoise({ f: 400, to: 3000, d: 0.45, g: 0.4, vol: vol });
        dcTone({ f: 160, to: 50, d: 0.5, type: "sawtooth", g: 0.25, vol: vol });
    },
    strafeWarn: function (vol) {         // the small ship lines up a run
        for (let i = 0; i < 3; i++) dcTone({ f: 1100, d: 0.08, type: "square", g: 0.1, vol: vol, at: i * 0.16 });
    },
    strafeShot: function (vol) { dcNoise({ f: 3000, to: 400, d: 0.12, g: 0.22, vol: vol }); dcTone({ f: 400, to: 120, d: 0.1, type: "square", g: 0.08, vol: vol }); },
    tunnelIn: function () { dcNoise({ f: 200, to: 1200, d: 0.5, g: 0.18 }); },
    slide: function () {                 // the sideways skid into the lab
        dcNoise({ f: 6000, to: 1500, d: 1.4, g: 0.3, hp: true });
        dcTone({ f: 300, to: 90, d: 1.3, type: "sawtooth", g: 0.12 });
    },
    toss: function () { dcTone({ f: 600, to: 1200, d: 0.4, type: "triangle", g: 0.12 }); },
    catchIt: function () { dcTone({ f: 1046, d: 0.1, type: "square", g: 0.12 }); dcTone({ f: 1568, d: 0.3, type: "square", g: 0.12, at: 0.1 }); }
};
