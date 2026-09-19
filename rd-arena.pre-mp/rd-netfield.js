// ===================================================
//   RD Arena -- the network field (render-only, no wire yet)
// ===================================================
// New 2026-09-07. See NET_FIELD_NOTES.md. This is the downsample + quantise +
// morph pipeline chosen in rd-arena-bench/rd-curves.html, running against the
// LOCAL sim so the visual consequence can be judged before MP_ROLLOUT.md's
// steps 1-4 put an actual socket under it.
//
// Nothing in here is authoritative. isSolid/isFlesh/hasLOS and the flow field
// still read raw 400^2 gridB; this array is only ever drawn.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). Everything lives on the single RDNET global for that reason.
"use strict";

const RDNET = {
    // --- the wire parameters, straight off the lab ---
    RES: 133,            // cells per side. 36.09 world px each, vs the sim's 12.
    BITS: 2,             // 4 levels. 1 bit would leave nothing to lerp between.
    INTERVAL_MS: 1000,   // packet cadence; the morph duration is locked to it.

    // Render-only. Warp is off (see NET_FIELD_NOTES.md) but the constants stay
    // so it can be dialled back in without re-deriving them.
    THRESH: 0.30,        // same iso the sim has always used
    BREATH: 0.002,       // threshold breathing amplitude
    WARP_AMP: 0.0,
    WARP_FREQ: 0.006,
    WARP_SPEED: 0.10,

    enabled: true,       // F9. false == today's game, reading gridB direct.

    cell: 0,
    prev: null,
    next: null,
    lastPacketAt: 0,
    t: 1,                // eased morph position, for the dev readout

    init: function () {
        this.cell = worldWidth / this.RES;
        this.prev = new Float32Array(this.RES * this.RES);
        this.next = new Float32Array(this.RES * this.RES);
        this.lastPacketAt = 0;
    },

    // Box-filter gridB down to RES^2, then quantise to the wire depth. This is
    // exactly what a host would do before packing bytes -- kept in one function
    // so the eventual rd-net.js sends what the client is already drawing rather
    // than a second, subtly different reduction.
    pack: function (out) {
        const res = this.RES;
        const levels = (1 << this.BITS) - 1;
        const ratio = gridCols / res;
        for (let y = 0; y < res; y++) {
            const y0 = Math.floor(y * ratio);
            const y1 = Math.min(gridRows, Math.floor((y + 1) * ratio));
            for (let x = 0; x < res; x++) {
                const x0 = Math.floor(x * ratio);
                const x1 = Math.min(gridCols, Math.floor((x + 1) * ratio));
                let sum = 0, n = 0;
                for (let sy = y0; sy < y1; sy++)
                    for (let sx = x0; sx < x1; sx++) { sum += gridB[sx + sy * gridCols]; n++; }
                out[x + y * res] = n ? Math.round((sum / n) * levels) / levels : 0;
            }
        }
    },

    // Call once per frame from loop(). Emits a "packet" on the interval.
    tick: function (now) {
        if (!this.enabled) return;
        if (this.lastPacketAt === 0) {
            // First frame: pack both, so nothing morphs up out of an empty field.
            this.pack(this.next);
            this.prev.set(this.next);
            this.lastPacketAt = now;
            this.t = 1;
            return;
        }
        if (now - this.lastPacketAt >= this.INTERVAL_MS) {
            this.prev.set(this.next);
            this.pack(this.next);
            this.lastPacketAt = now;
        }
        let raw = (now - this.lastPacketAt) / this.INTERVAL_MS;
        this.t = this.ease(raw < 0 ? 0 : raw > 1 ? 1 : raw);
    },

    // Overshoot, from the lab's "squelchy" easing: the surface flops slightly
    // past its target and settles. Values can leave [prev,next] -- harmless,
    // because this is only ever compared against a draw threshold.
    ease: function (t) {
        const s = 1.70158 * 0.6;
        const u = t - 1;
        return u * u * ((s + 1) * u + s) + 1;
    },

    // Field-space lerp. Topology changes (a wall splitting, a hole closing) come
    // out as values crossing the threshold, which is why this is done on the
    // field and not on extracted geometry.
    sample: function (i) {
        const a = this.prev[i], b = this.next[i];
        return a + (b - a) * this.t;
    },

    // Breathing iso. Render-only, so clients need not agree on it.
    threshold: function (now) {
        return this.THRESH + Math.sin(now * 0.0016) * this.BREATH;
    }
};

RDNET.init();

// F9 is the A/B, per MP_ROLLOUT.md 1: feel judgements need the same field
// seconds apart, not two reloads. Not in this game's keys map, and not the dev
// panel's L+G, so it is always safe to press.
window.addEventListener('keydown', function (e) {
    if (e.code === 'F9') {
        e.preventDefault();
        RDNET.enabled = !RDNET.enabled;
        if (RDNET.enabled) RDNET.lastPacketAt = 0;
        floatText(player.x, player.y - 40,
            RDNET.enabled ? 'NET FIELD 133\u00b2 2-BIT' : 'RAW FIELD 400\u00b2',
            RDNET.enabled ? RDSKIN.cyan : RDSKIN.amber);
    }
}, listenOpts);
