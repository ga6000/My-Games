/*
 * shared/sfx.js — the shared waveform vocabulary (AESTHETIC_GUIDE.md §4.10).
 *
 * Classic script, one global (`SFX`).
 *
 *     <script src="../shared/sfx.js"></script>
 *     SFX.configure({ game: "zombie" });
 *     SFX.unlockOn(window, listenerController.signal);
 *     SFX.pickup();
 *
 * WHY PROCEDURAL RATHER THAN .mp3 FILES
 * Lifted wholesale from zombie/zombie-audio.js, which got this right:
 *   - zero binary assets, so the file:// hard constraint stays untouched
 *   - square and triangle ARE the era's palette (§4.10: hard envelopes, no reverb)
 *   - the repo's one sampled-audio game, Gyro Space, has the open mobile
 *     audio-freeze bug that sits at the top of PROJECT_MEMORY.md
 *
 * WHAT THIS REPLACES
 * glucose-dash, zombie and glass-city-escape each hand-roll the same
 * oscillator + envelope + gesture-gate. This is that shape, once. Zombie's own
 * file additionally does POSITIONAL mix (distance falloff and panning against a
 * 4800x2700 map) — that stays in zombie/, because it is a property of that
 * game's camera, not a shared waveform.
 *
 * ---------------------------------------------------------------------------
 * NO JS TIMERS, DELIBERATELY
 * ---------------------------------------------------------------------------
 * Root CLAUDE.md requires every timer to go through trackTimeout/trackInterval.
 * Nothing here needs one: envelopes and multi-note jingles are scheduled on the
 * AudioContext's own clock (ctx.currentTime + t), which is not a JS timer, does
 * not need tracking, and is sample-accurate rather than subject to frame jitter.
 * The only listeners are in unlockOn(), which requires the caller's AbortSignal
 * for exactly the reason RETRO.attract() does.
 *
 * Every public call is wrapped. Audio is never worth breaking a frame over.
 */
(function (global) {
    "use strict";

    var ctx = null;
    var master = null;
    var muted = false;
    var volume = 0.7;
    var gameKey = "shared";

    function keyFor(what) { return "sfx_" + gameKey + "_" + what; }

    /*
     * configure() namespaces the stored prefs. Without it two games on the same
     * origin share one mute setting, which is how muting Zombie silently mutes
     * Glucose Dash — a bug that looks like broken audio rather than a shared key.
     */
    function configure(opts) {
        var o = opts || {};
        if (o.game) gameKey = String(o.game);
        loadPrefs();
        if (typeof o.volume === "number") setVolume(o.volume);
    }

    function loadPrefs() {
        try {
            muted = global.localStorage.getItem(keyFor("muted")) === "1";
            var v = parseFloat(global.localStorage.getItem(keyFor("volume")));
            if (!isNaN(v)) volume = clamp01(v);
        } catch (e) { /* private mode / disabled storage; the defaults are fine */ }
    }

    function savePrefs() {
        try {
            global.localStorage.setItem(keyFor("muted"), muted ? "1" : "0");
            global.localStorage.setItem(keyFor("volume"), String(volume));
        } catch (e) { /* ignore */ }
    }

    /*
     * Browsers refuse to start an AudioContext without a user gesture, so
     * nothing is created until the first input. Safe to call on every input
     * event — the early return makes repeat calls free.
     *
     * The suspended-state check is not defensive padding: Chrome parks a
     * context in "suspended" after a tab switch, and without the resume the
     * game comes back silent with no error anywhere.
     */
    function init() {
        if (ctx) {
            if (ctx.state === "suspended") {
                try { ctx.resume(); } catch (e) { /* nothing useful to do */ }
            }
            return !!ctx;
        }
        try {
            var Ctor = global.AudioContext || global.webkitAudioContext;
            if (!Ctor) return false;
            ctx = new Ctor();
            master = ctx.createGain();
            master.gain.value = muted ? 0 : volume;
            master.connect(ctx.destination);
            return true;
        } catch (e) {
            ctx = null;
            master = null;
            return false;
        }
    }

    /*
     * Wires the gesture-unlock listeners through the CALLER's AbortController,
     * so destroy() removes them. Same refusal as RETRO.attract(): attaching
     * listeners the game cannot abort is the leak the hard constraint exists
     * to prevent.
     */
    function unlockOn(target, signal) {
        var t = target || global;
        if (!signal) {
            if (global.console && console.warn) {
                console.warn("SFX.unlockOn: needs the game's AbortSignal. Refusing to attach " +
                             "listeners it cannot tear down. Call SFX.init() from your own input handler instead.");
            }
            return;
        }
        if (!t || typeof t.addEventListener !== "function") return;
        var EVENTS = ["pointerdown", "keydown", "touchstart"];
        for (var i = 0; i < EVENTS.length; i++) {
            try {
                t.addEventListener(EVENTS[i], init, { passive: true, signal: signal });
            } catch (e) { /* one unsupported name must not take the rest down */ }
        }
    }

    function clamp01(v) { return v < 0 ? 0 : (v > 1 ? 1 : v); }

    function setVolume(v) {
        volume = clamp01(v);
        if (master && !muted) master.gain.value = volume;
        savePrefs();
        return volume;
    }

    function toggleMute() {
        muted = !muted;
        if (master) master.gain.value = muted ? 0 : volume;
        savePrefs();
        return muted;
    }

    function isMuted() { return muted; }
    function ready() { return !!ctx && ctx.state === "running"; }

    /*
     * One note. §4.10's "hard envelopes, no reverb" is the whole shape: a very
     * short attack, a flat body, a short release. Nothing here is smooth,
     * because smooth is what makes synthesised audio read as modern.
     *
     *   freq    Hz
     *   dur     seconds of body (not counting release)
     *   type    "square" | "triangle" | "sawtooth" | "sine"
     *   gain    0..1, relative to master
     *   at      seconds from now — how jingles sequence without a JS timer
     *   pan     -1..1, omitted where StereoPannerNode is unavailable
     */
    function tone(opts) {
        if (!init()) return;
        if (muted) return;
        var o = opts || {};
        try {
            var freq = o.freq || 440;
            var dur = typeof o.dur === "number" ? o.dur : 0.08;
            var type = o.type || "square";
            var g = typeof o.gain === "number" ? o.gain : 0.25;
            var attack = typeof o.attack === "number" ? o.attack : 0.005;
            var release = typeof o.release === "number" ? o.release : 0.04;
            var t0 = ctx.currentTime + (o.at || 0);

            var osc = ctx.createOscillator();
            osc.type = type;
            osc.frequency.setValueAtTime(freq, t0);
            // A glide is the one non-hard envelope worth having: it is how a
            // laser reads as a laser rather than as a beep.
            if (typeof o.slideTo === "number") {
                osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.slideTo), t0 + dur);
            }

            var env = ctx.createGain();
            env.gain.setValueAtTime(0.0001, t0);
            env.gain.exponentialRampToValueAtTime(Math.max(0.0001, g), t0 + attack);
            env.gain.setValueAtTime(Math.max(0.0001, g), t0 + dur);
            env.gain.exponentialRampToValueAtTime(0.0001, t0 + dur + release);

            var dest = master;
            if (typeof o.pan === "number" && typeof ctx.createStereoPanner === "function") {
                var panner = ctx.createStereoPanner();
                panner.pan.value = Math.max(-1, Math.min(1, o.pan));
                panner.connect(master);
                dest = panner;
            }

            osc.connect(env);
            env.connect(dest);
            osc.start(t0);
            osc.stop(t0 + dur + release + 0.01);
            // Oscillators are one-shot nodes; without this the graph grows for
            // the life of the page.
            osc.onended = function () {
                try { osc.disconnect(); env.disconnect(); } catch (e) { /* already gone */ }
            };
        } catch (e) { /* never let a sound break a frame */ }
    }

    // A sequence of notes, scheduled ahead on the audio clock in one call.
    function sequence(notes, opts) {
        if (!notes || !notes.length) return;
        var o = opts || {};
        var step = typeof o.step === "number" ? o.step : 0.07;
        var at = o.at || 0;
        for (var i = 0; i < notes.length; i++) {
            var n = notes[i];
            var spec = (typeof n === "number") ? { freq: n } : n;
            tone({
                freq: spec.freq,
                dur: spec.dur || o.dur || 0.06,
                type: spec.type || o.type || "square",
                gain: spec.gain || o.gain || 0.22,
                pan: o.pan,
                at: at + i * step
            });
        }
    }

    /*
     * The two jingles §4.10 names explicitly. They are here rather than in each
     * game because they are the part that should sound IDENTICAL everywhere —
     * same reasoning as the Signal Three in §2.2. A player who learns that a
     * rising triad means "you got it" should not have to relearn it per game.
     */
    function pickup() { sequence([523.25, 659.25, 783.99], { type: "square", step: 0.06, dur: 0.05 }); }
    function death() { sequence([392.00, 329.63, 261.63, 196.00], { type: "triangle", step: 0.11, dur: 0.1, gain: 0.26 }); }

    // Common enough across games to be worth naming, rather than every game
    // picking its own frequency for the same event.
    function blip(freq) { tone({ freq: freq || 880, dur: 0.03, type: "square", gain: 0.18 }); }
    function hit() { tone({ freq: 220, slideTo: 60, dur: 0.12, type: "square", gain: 0.3 }); }
    function shoot() { tone({ freq: 1200, slideTo: 300, dur: 0.09, type: "sawtooth", gain: 0.2 }); }

    /*
     * Closes the AudioContext. Call from the game's destroy(). Browsers cap the
     * number of live contexts per page, so a game that is init/destroyed
     * repeatedly (which is what the GameInstance contract is for) will
     * eventually fail to create one without this.
     */
    function destroy() {
        try { if (ctx && typeof ctx.close === "function") ctx.close(); } catch (e) { /* ignore */ }
        ctx = null;
        master = null;
    }

    global.SFX = {
        configure: configure,
        init: init,
        unlockOn: unlockOn,
        ready: ready,
        tone: tone,
        sequence: sequence,
        pickup: pickup,
        death: death,
        blip: blip,
        hit: hit,
        shoot: shoot,
        setVolume: setVolume,
        toggleMute: toggleMute,
        isMuted: isMuted,
        destroy: destroy
    };
})(typeof window !== "undefined" ? window : this);
