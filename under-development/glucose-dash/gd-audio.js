// ===================================================
//   Glucose Dash -- audio -- tiny, gesture-gated, procedural
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 2219-2254 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, nothing was reindented.
//
// EVERY FILE CARRIES ITS OWN "use strict". The original script had one at the
// top, covering all 2,363 lines; a classic-script split gives each file its own
// scope for that directive, so omitting it would silently drop files 2-12 into
// sloppy mode. That is a semantic change, not a cosmetic one.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). This game lives under under-development/, so its shared paths
// are ../../shared/, not ../shared/.
"use strict";

/* ===================================================
     AUDIO — tiny, gesture-gated
   ===================================================
   Mobile browsers refuse audio without a user gesture, and
   PROJECT_MEMORY records a still-open mobile audio-freeze bug in Gyro
   Space. So: context created on the Start click, nothing autoplays,
   every call is wrapped. */
var audioCtx = null;

function initAudio() {
    if (audioCtx) return;
    try { audioCtx = new (window.AudioContext || window.webkitAudioContext)(); }
    catch (e) { audioCtx = null; }
}

function tone(f0, f1, type, dur, vol) {
    if (!audioCtx) return;
    try {
        var o = audioCtx.createOscillator(), g = audioCtx.createGain();
        o.type = type; o.connect(g); g.connect(audioCtx.destination);
        o.frequency.setValueAtTime(f0, audioCtx.currentTime);
        o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), audioCtx.currentTime + dur);
        g.gain.setValueAtTime(vol, audioCtx.currentTime);
        g.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + dur);
        o.start(); o.stop(audioCtx.currentTime + dur);
    } catch (e) { /* audio is never worth breaking a frame over */ }
}

function beep(foodKey) {
    var gi = FOODS[foodKey].gi;
    if (gi === "high") tone(680, 1180, "square", 0.10, 0.05);
    else if (gi === "med") tone(520, 760, "triangle", 0.12, 0.05);
    else tone(380, 620, "sine", 0.16, 0.06);
}


