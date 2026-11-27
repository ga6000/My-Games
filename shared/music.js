// ===================================================
//   shared/music.js -- the PLEURA album, played as seamless loops
// ===================================================
// PLAYTEST (branch claude/music-playtest, 2026-11-27). Hub standard R1 asks
// every game for a music loop; this is the first try at playing generated
// (Suno) tracks instead of procedural scores. Add ?music=old to any page to
// hear the game's previous music for comparison.
//
// TRACKS live in music/<id>.js, written by scripts/build-music.py: a base64 MP3
// assigned into window.PLEURA_TRACKS, because a double-clicked page cannot
// fetch() a sibling file (file:// hard constraint) but CAN load a <script>.
// Each loop carries half a second of pre/post-roll so it stays gapless whatever
// encoder delay the browser's MP3 decoder applies (see the build script).
//
// Its own AudioContext, separate from SFX and the games' own: one more context
// is cheap, and it means no game has to hand its context over. No JS timers:
// fades are scheduled on the audio clock, and games call MUSIC.update() from
// their existing loop (or a tracked interval) for intensity and mute.
//
//   MUSIC.unlockOn(window, signal)     -- resume on the first gesture
//   MUSIC.play("zombie", { sting: "sting-hook" })
//   MUSIC.intensity(0..1)              -- muffled and quieter at 0, open at 1
//   MUSIC.muffle(true|false)           -- menus: a hard low-pass over everything
//   MUSIC.setMuted(bool)               -- follow the game's own mute
//   MUSIC.end()                        -- loop lets go, the end-of-game sting plays
//   MUSIC.stop()                       -- silence, short fade
//   MUSIC.enabled()                    -- false with ?music=old or no tracks loaded
"use strict";

(function (global) {
    const LEVEL = 0.55;              // the whole score against the effects
    const OPEN_HZ = 16000;           // intensity 1
    const CLOSED_HZ = 900;           // intensity 0
    const MENU_HZ = 650;             // muffle(true)
    const STING_LEVEL = 0.8;

    let ctx = null;
    let bus = null;                  // master: mute + level
    let loopGain = null;             // loop only: fades, ducks, intensity level
    let filter = null;
    let src = null;
    let current = "";
    let muted = false;
    let muffled = false;
    let level = 0.5;                 // smoothed intensity
    let target = 0.5;
    const buffers = {};
    const decoding = {};

    function enabled() {
        try {
            if (/[?&]music=old\b/.test(global.location.search)) return false;
        } catch (e) { /* not a page */ }
        return !!global.PLEURA_TRACKS && Object.keys(global.PLEURA_TRACKS).length > 0;
    }

    function ensure() {
        if (ctx) return true;
        const AC = global.AudioContext || global.webkitAudioContext;
        if (!AC) return false;
        try {
            ctx = new AC();
            bus = ctx.createGain();
            bus.gain.value = muted ? 0 : LEVEL;
            bus.connect(ctx.destination);
            filter = ctx.createBiquadFilter();
            filter.type = "lowpass";
            filter.Q.value = 0.7;
            filter.frequency.value = OPEN_HZ;
            loopGain = ctx.createGain();
            loopGain.gain.value = 0;
            loopGain.connect(filter);
            filter.connect(bus);
        } catch (e) { ctx = null; return false; }
        return true;
    }

    function b64ToBuffer(b64) {
        const bin = atob(b64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out.buffer;
    }

    // Promise of the decoded AudioBuffer for a track id (decoded once).
    function load(id) {
        if (buffers[id]) return Promise.resolve(buffers[id]);
        if (decoding[id]) return decoding[id];
        const t = global.PLEURA_TRACKS && global.PLEURA_TRACKS[id];
        if (!t || !ensure()) return Promise.reject(new Error("no track " + id));
        decoding[id] = new Promise(function (resolve, reject) {
            // Callback form too: older Safari's decodeAudioData returns nothing.
            const p = ctx.decodeAudioData(b64ToBuffer(t.mp3),
                function (buf) { buffers[id] = buf; resolve(buf); },
                function (err) { reject(err || new Error("decode " + id)); });
            if (p && p.catch) p.catch(function () { /* handled by the callback */ });
        });
        return decoding[id];
    }

    function freqFor() {
        if (muffled) return MENU_HZ;
        // Exponential, so the middle of the range sounds like the middle.
        return CLOSED_HZ * Math.pow(OPEN_HZ / CLOSED_HZ, level);
    }
    function gainFor() { return muffled ? 0.75 : 0.7 + 0.3 * level; }

    function applyLevels(tau) {
        if (!ctx) return;
        const t = ctx.currentTime;
        try {
            filter.frequency.setTargetAtTime(freqFor(), t, tau);
            if (src) loopGain.gain.setTargetAtTime(gainFor(), t, tau);
        } catch (e) { /* ignore */ }
    }

    function play(id, opts) {
        opts = opts || {};
        if (!enabled() || !ensure()) return;
        if (current === id && src) return;
        stopLoop(0.4);
        current = id;
        // A suspended context (no gesture yet) still decodes and schedules;
        // everything simply starts sounding on the first tap.
        if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) { /* gesture */ } }
        if (opts.sting) sting(opts.sting);
        load(id).then(function (buf) {
            if (current !== id || src) return;
            const meta = global.PLEURA_TRACKS[id];
            const s = ctx.createBufferSource();
            s.buffer = buf;
            s.loop = true;
            if (meta.loopEnd) { s.loopStart = meta.loopStart; s.loopEnd = Math.min(meta.loopEnd, buf.duration); }
            s.connect(loopGain);
            const t = ctx.currentTime;
            // Under a sting, the loop waits for most of it before coming in.
            const wait = opts.sting && buffers[opts.sting] ? Math.max(0, buffers[opts.sting].duration - 2) : 0;
            loopGain.gain.cancelScheduledValues(t);
            loopGain.gain.setValueAtTime(0.0001, t);
            loopGain.gain.setValueAtTime(0.0001, t + wait);
            loopGain.gain.linearRampToValueAtTime(gainFor(), t + wait + (opts.fadeIn || 2.5));
            s.start(t, meta.loopStart || 0);
            src = s;
        }).catch(function () { /* no music is not an error */ });
    }

    function stopLoop(fade) {
        if (!src || !ctx) { src = null; return; }
        const s = src;
        src = null;
        try {
            const t = ctx.currentTime;
            loopGain.gain.cancelScheduledValues(t);
            loopGain.gain.setValueAtTime(loopGain.gain.value, t);
            loopGain.gain.linearRampToValueAtTime(0.0001, t + fade);
            s.stop(t + fade + 0.05);
        } catch (e) { /* ignore */ }
    }

    function sting(id) {
        if (!enabled() || !ensure()) return;
        load(id).then(function (buf) {
            const s = ctx.createBufferSource();
            const g = ctx.createGain();
            g.gain.value = STING_LEVEL;
            s.buffer = buf;
            s.connect(g);
            g.connect(bus);              // past the filter: stings are never muffled
            s.start();
        }).catch(function () { /* ignore */ });
    }

    // Once a frame (or a few times a second) from the game. Smooths intensity.
    function update() {
        if (!ctx) return;
        level += (target - level) * 0.04;
        if (Math.abs(target - level) < 0.002) level = target;
        applyLevels(0.25);
    }

    function intensity(v) { target = Math.max(0, Math.min(1, Number(v) || 0)); }
    function muffle(on) { if (muffled !== !!on) { muffled = !!on; applyLevels(0.35); } }

    function setMuted(m) {
        m = !!m;
        if (m === muted) return;
        muted = m;
        if (!bus) return;
        try {
            const t = ctx.currentTime;
            bus.gain.cancelScheduledValues(t);
            bus.gain.setTargetAtTime(muted ? 0 : LEVEL, t, 0.05);
        } catch (e) { /* ignore */ }
    }

    function end() {
        if (!current && !src) return;
        current = "";
        stopLoop(1.5);
        sting("sting-end");
    }

    function stop() { current = ""; stopLoop(0.3); }

    function unlockOn(target, signal) {
        const go = function () {
            if (!enabled() || !ensure()) return;
            if (ctx.state === "suspended") { try { ctx.resume(); } catch (e) { /* ignore */ } }
            // Decode ahead so the first sting is not late.
            Object.keys(global.PLEURA_TRACKS || {}).forEach(function (id) { load(id).catch(function () {}); });
        };
        const o = signal ? { signal: signal } : undefined;
        target.addEventListener("pointerdown", go, o);
        target.addEventListener("keydown", go, o);
        target.addEventListener("touchend", go, o);
    }

    // A hidden tab goes quiet on the audio clock, then the context sleeps.
    if (global.document) {
        global.document.addEventListener("visibilitychange", function () {
            if (!ctx) return;
            try { if (global.document.hidden) ctx.suspend(); else ctx.resume(); } catch (e) { /* ignore */ }
        });
    }

    function destroy() {
        stop();
        if (ctx) { try { ctx.close(); } catch (e) { /* ignore */ } }
        ctx = null; bus = null; loopGain = null; filter = null; src = null;
    }

    global.MUSIC = {
        enabled: enabled, play: play, sting: sting, update: update,
        intensity: intensity, muffle: muffle, setMuted: setMuted,
        end: end, stop: stop, unlockOn: unlockOn, destroy: destroy,
        current: function () { return current; },
        playing: function () { return !!src; },
        state: function () { return ctx ? ctx.state : "none"; }
    };
})(typeof window !== "undefined" ? window : this);
