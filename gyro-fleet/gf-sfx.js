// ===================================================
//   Gyro Fleet — sound cues
// ===================================================
// Playtest pass (2026-11-15). Ry: "there needs to be more audio cues and audio
// in general for things like the orifices opening, exploding, gearing up to
// explode". Everything is synthesised (WebAudio, no files, file:// safe) on
// gl-audio.js's context and SFX bus. Each cue is rate-limited by name so a
// flood can't stack fifty of the same sound in a frame.
//
//   swell     an orifice starts to swell: a wet, rising groan (the tell)
//   open      it dilates: a low roar opening up
//   birth     one creature squeezes out: a short squelch
//   seal      an orifice is destroyed: a boom under a falling shriek
//   strain    a bolt bounces off armour: a creak that climbs with pressure
//   fuse      a body is about to rupture: a fast rising whine (run)
//   rupture   it bursts: a hard noise crack over a sub drop
//   screech   the flood is frenzied by a rupture
//   ping      a ricochet leaves the armour; zap = it hit a ship
//   pop       a clean kill: a wet pop;  mote = siphon picked up
//   toll      a Bellwether inhales: a low bell, the wave you can hear
//   lash      tendrils take hold: an alarm;  hurt = hull hit
//   order     the wing order changed;  deny = can't do that
//   win / lose
"use strict";

const gfSfxLast = {};
function gfSfxOk(name, gap) {
    const A = glAudio;
    if (!A.ctx || !A.started) return null;
    const t = A.ctx.currentTime;
    if (gfSfxLast[name] !== undefined && t - gfSfxLast[name] < gap) return null;
    gfSfxLast[name] = t;
    return A.ctx;
}
// One oscillator voice: type, start Hz, end Hz, seconds, gain, optional lowpass.
function gfTone(ctx, type, f0, f1, dur, vol, when, lpHz) {
    const t = ctx.currentTime + (when || 0), o = ctx.createOscillator(), g = ctx.createGain();
    o.type = type;
    o.frequency.setValueAtTime(Math.max(20, f0), t);
    o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.02, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    if (lpHz) { const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = lpHz; o.connect(lp); lp.connect(g); }
    else o.connect(g);
    g.connect(glAudio.sfxBus);
    o.start(t); o.stop(t + dur + 0.02);
}
// One filtered noise burst: buffer, filter type, start Hz, end Hz, Q, seconds, gain.
function gfHiss(ctx, brown, ftype, f0, f1, q, dur, vol, when) {
    const t = ctx.currentTime + (when || 0), n = ctx.createBufferSource(), f = ctx.createBiquadFilter(), g = ctx.createGain();
    n.buffer = brown ? glAudio.brown : glAudio.white;
    n.loop = true;
    f.type = ftype; f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(vol, t + Math.min(0.03, dur * 0.2));
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    n.connect(f); f.connect(g); g.connect(glAudio.sfxBus);
    n.start(t, Math.random()); n.stop(t + dur + 0.02);
}

// k is an optional 0..1 strength (pressure, distance).
function gfSfx(name, k) {
    let c;
    k = k === undefined ? 1 : Math.max(0, Math.min(1, k));
    switch (name) {
    case "swell":
        if (!(c = gfSfxOk(name, 0.5))) return;
        gfTone(c, "sawtooth", 48, 150, 2.3, 0.3, 0, 420);
        gfHiss(c, true, "bandpass", 120, 700, 3, 2.3, 0.5);
        gfTone(c, "sine", 300, 620, 0.25, 0.12, 0.0); gfTone(c, "sine", 300, 620, 0.25, 0.12, 0.8); gfTone(c, "sine", 300, 700, 0.25, 0.14, 1.6);
        break;
    case "open":
        if (!(c = gfSfxOk(name, 0.4))) return;
        gfHiss(c, true, "lowpass", 90, 1400, 1, 1.3, 0.9);
        gfTone(c, "sawtooth", 70, 38, 1.2, 0.35, 0, 300);
        gfHiss(c, false, "bandpass", 500, 2600, 6, 0.5, 0.2, 0.15);
        break;
    case "birth":
        if (!(c = gfSfxOk(name, 0.09))) return;
        gfHiss(c, false, "bandpass", 300 + Math.random() * 300, 1500, 7, 0.12, 0.22);
        gfTone(c, "sine", 180, 90, 0.1, 0.12);
        break;
    case "seal":
        if (!(c = gfSfxOk(name, 0.5))) return;
        gfHiss(c, false, "lowpass", 5000, 70, 1, 1.8, 1.0);
        gfTone(c, "sine", 150, 26, 1.5, 0.9);
        gfTone(c, "sawtooth", 1900, 240, 1.4, 0.22, 0.05, 3000);
        gfTone(c, "sawtooth", 1500, 180, 1.6, 0.18, 0.12, 2600);
        break;
    case "strain":
        if (!(c = gfSfxOk(name, 0.05))) return;
        gfTone(c, "triangle", 260 + 900 * k, 200 + 700 * k, 0.09, 0.1 + 0.12 * k);
        gfHiss(c, false, "bandpass", 1800 + 2500 * k, 1200, 9, 0.06, 0.1);
        break;
    case "fuse":
        if (!(c = gfSfxOk(name, 0.12))) return;
        gfTone(c, "sawtooth", 500, 2400, 0.55, 0.26, 0, 5000);
        gfTone(c, "square", 880, 880, 0.05, 0.14, 0.0); gfTone(c, "square", 1100, 1100, 0.05, 0.14, 0.18); gfTone(c, "square", 1400, 1400, 0.05, 0.16, 0.34); gfTone(c, "square", 1760, 1760, 0.05, 0.18, 0.46);
        break;
    case "rupture":
        if (!(c = gfSfxOk(name, 0.06))) return;
        gfHiss(c, false, "lowpass", 7000, 110, 1, 0.75, 0.55 + 0.45 * k);
        gfTone(c, "sine", 190, 30, 0.6, 0.5 + 0.4 * k);
        gfHiss(c, false, "bandpass", 900, 250, 4, 0.35, 0.3, 0.02);
        break;
    case "screech":
        if (!(c = gfSfxOk(name, 0.8))) return;
        gfTone(c, "sawtooth", 700, 1700, 0.35, 0.16, 0.1, 4500);
        gfTone(c, "sawtooth", 760, 1500, 0.5, 0.14, 0.14, 4500);
        gfHiss(c, false, "bandpass", 2400, 3600, 10, 0.5, 0.16, 0.1);
        break;
    case "ping":
        if (!(c = gfSfxOk(name, 0.045))) return;
        gfTone(c, "square", 2600 + Math.random() * 500, 1500, 0.1, 0.09, 0, 6000);
        break;
    case "zap":
        if (!(c = gfSfxOk(name, 0.08))) return;
        gfTone(c, "sawtooth", 1300, 140, 0.2, 0.34, 0, 3500);
        gfHiss(c, false, "highpass", 2500, 2500, 1, 0.12, 0.3);
        break;
    case "pop":
        if (!(c = gfSfxOk(name, 0.04))) return;
        gfTone(c, "sine", 420 - 240 * k, 80, 0.14, 0.2 + 0.2 * k);
        gfHiss(c, false, "bandpass", 900, 300, 3, 0.12, 0.14 + 0.2 * k);
        break;
    case "mote":
        if (!(c = gfSfxOk(name, 0.05))) return;
        gfTone(c, "sine", 880 + 600 * k, 1320 + 700 * k, 0.08, 0.1);
        break;
    case "toll":
        if (!(c = gfSfxOk(name, 1.5))) return;
        gfTone(c, "sine", 98, 96, 2.2, 0.3 * k + 0.05); gfTone(c, "sine", 147.5, 146, 1.6, 0.14 * k + 0.02); gfTone(c, "triangle", 247, 244, 1.0, 0.07 * k + 0.01);
        break;
    case "lash":
        if (!(c = gfSfxOk(name, 0.3))) return;
        gfHiss(c, false, "bandpass", 3000, 500, 5, 0.18, 0.35);
        gfTone(c, "square", 620, 620, 0.09, 0.2, 0.15); gfTone(c, "square", 620, 620, 0.09, 0.2, 0.33); gfTone(c, "square", 620, 620, 0.09, 0.2, 0.51);
        break;
    case "hurt":
        if (!(c = gfSfxOk(name, 0.1))) return;
        gfTone(c, "square", 150, 55, 0.18, 0.3, 0, 900);
        gfHiss(c, false, "lowpass", 1500, 200, 1, 0.14, 0.3);
        break;
    case "order":
        if (!(c = gfSfxOk(name, 0.1))) return;
        gfTone(c, "square", k > 0.5 ? 520 : 780, k > 0.5 ? 780 : 520, 0.09, 0.14, 0, 4000);
        gfTone(c, "square", k > 0.5 ? 780 : 520, k > 0.5 ? 1040 : 390, 0.1, 0.14, 0.1, 4000);
        break;
    case "deny":
        if (!(c = gfSfxOk(name, 0.2))) return;
        gfTone(c, "square", 170, 150, 0.16, 0.2, 0, 1200);
        break;
    case "mend":
        if (!(c = gfSfxOk(name, 0.2))) return;
        gfTone(c, "sine", 440, 880, 0.3, 0.18); gfTone(c, "sine", 660, 1320, 0.3, 0.12, 0.08);
        break;
    case "win":
        if (!(c = gfSfxOk(name, 3))) return;
        [392, 494, 587, 784].forEach(function (f, i) { gfTone(c, "triangle", f, f, 0.5, 0.22, i * 0.16); });
        break;
    case "lose":
        if (!(c = gfSfxOk(name, 3))) return;
        [330, 262, 208, 147].forEach(function (f, i) { gfTone(c, "sawtooth", f, f * 0.97, 0.6, 0.2, i * 0.22, 1400); });
        break;
    }
}

// Loudness by distance from the lead ship: full inside 40 units, gone by 400.
function gfSfxAt(name, x, y, k) {
    const d = Math.hypot(x - glShip.x, y - glShip.y);
    if (d > 400) return;
    gfSfx(name, (k === undefined ? 1 : k) * Math.max(0.15, Math.min(1, 1 - (d - 40) / 360)));
}
