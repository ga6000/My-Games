/*
 * shared/retro.js — AESTHETIC_GUIDE.md §4's technique library, as one global.
 *
 * Only the techniques used by MORE THAN ONE game live here. A trick that
 * belongs to a single game belongs in that game's folder; pulling it up here
 * would just make this file the next thing that rots.
 *
 * Classic script, one global (`RETRO`), same shape as shared/identity.js —
 * see that file's header for why modules are banned.
 *
 *     <script src="../shared/retro.js"></script>
 *
 * ---------------------------------------------------------------------------
 * THE TEARDOWN RULE, WHICH THIS FILE IS THE MOST LIKELY THING TO BREAK
 * ---------------------------------------------------------------------------
 * Root CLAUDE.md: every timer through trackTimeout/trackInterval, every
 * listener through one AbortController, so destroy() fully tears an instance
 * down. AESTHETIC_GUIDE §5 restates it for exactly this file: "a shared RETRO
 * layer must not open a second teardown path."
 *
 * So:
 *   - NOTHING here calls setTimeout, setInterval or requestAnimationFrame.
 *     Not once. Every drawing helper is a pure function of what you pass it.
 *   - attract() is the one stateful thing, and it (a) takes the caller's
 *     AbortSignal for its listeners and (b) is driven by the caller's existing
 *     render loop via tick(), so it opens no timer at all.
 *   - attract() with no signal REFUSES to attach anything and warns. Attaching
 *     listeners the caller cannot abort is precisely the leak the rule exists
 *     to stop, and failing loudly beats leaking quietly.
 *
 * Nothing here throws. A game must never crash because a visual flourish was
 * handed a bad argument mid-frame.
 */
(function (global) {
    "use strict";

    /*
     * §4.1 PHOSPHOR PERSISTENCE  ★ highest value in the guide
     *
     * Vector monitors had real phosphor decay: bright objects smeared behind
     * themselves. Instead of clearing, paint translucent black over the frame.
     * This is CHEAPER than clearing and hand-drawing trail arrays, which is
     * what Gyro Space and Boids both do today — so adopting it deletes code
     * rather than adding it.
     *
     * alpha is the decay rate: lower = longer smear.
     *   Vector 0.18-0.30 | Raster 0.55+ or a real clear | Gel ~0.45
     */
    var PERSIST = { vector: 0.24, raster: 0.6, gel: 0.45 };

    function persist(ctx, w, h, alpha) {
        if (!ctx) return;
        var a = typeof alpha === "number" ? alpha : PERSIST.vector;
        // Persistence is a composite over what is already there, so a game
        // that left globalAlpha or a blend mode set would silently change the
        // decay rate. Pin both, restore both.
        var prevAlpha = ctx.globalAlpha;
        var prevOp = ctx.globalCompositeOperation;
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = "source-over";
        ctx.fillStyle = "rgba(0,0,0," + a + ")";
        ctx.fillRect(0, 0, w, h);
        ctx.globalAlpha = prevAlpha;
        ctx.globalCompositeOperation = prevOp;
    }

    /*
     * §4.2 BEAM OVERDRAW
     *
     * The beam saturated the phosphor where it lingered, so lines glowed. Two
     * passes over the same path: a wide low-alpha stroke in the hue, then a
     * narrow hot one.
     *
     * Deliberately cheaper than ctx.shadowBlur, which Boids uses at 15 — a
     * known canvas performance trap when applied per entity.
     *
     * `drawPath` is a function that issues the path commands (moveTo/lineTo/
     * arc/...) WITHOUT stroking. It gets called twice, so keep it cheap and
     * keep it free of side effects.
     */
    function beam(ctx, drawPath, opts) {
        if (!ctx || typeof drawPath !== "function") return;
        var o = opts || {};
        var hue = o.color || "#00E5FF";
        var core = o.core || "#E8FFF4";
        var wide = o.wide || 6;
        var narrow = o.narrow || 1.5;
        var glow = typeof o.glow === "number" ? o.glow : 0.18;

        var prevAlpha = ctx.globalAlpha;
        var prevWidth = ctx.lineWidth;
        var prevStroke = ctx.strokeStyle;
        var prevCap = ctx.lineJoin;

        ctx.lineJoin = "round";

        ctx.beginPath();
        drawPath(ctx);
        ctx.lineWidth = wide;
        ctx.globalAlpha = glow;
        ctx.strokeStyle = hue;
        ctx.stroke();

        ctx.beginPath();
        drawPath(ctx);
        ctx.lineWidth = narrow;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = core;
        ctx.stroke();

        ctx.globalAlpha = prevAlpha;
        ctx.lineWidth = prevWidth;
        ctx.strokeStyle = prevStroke;
        ctx.lineJoin = prevCap;
    }

    /*
     * §4.3 VERTEX BLOOM  ★ "the detail nobody implements"
     *
     * On real XY hardware the beam DECELERATED at every path vertex, dwelling
     * fractionally longer and burning the phosphor brighter — corners on an
     * Asteroids ship are visibly hotter than its edges. Five lines, and it is
     * the single change that makes a wireframe stop looking like CAD output.
     *
     * Accepts [{x,y}, ...] or [[x,y], ...] so it can be handed a game's
     * existing point array without a map().
     */
    function vertexBloom(ctx, points, opts) {
        if (!ctx || !points || !points.length) return;
        var o = opts || {};
        var r = o.radius || 1.5;
        var color = o.color || "#E8FFF4";
        var alpha = typeof o.alpha === "number" ? o.alpha : 1;

        var prevAlpha = ctx.globalAlpha;
        var prevFill = ctx.fillStyle;
        ctx.globalAlpha = alpha;
        ctx.fillStyle = color;

        for (var i = 0; i < points.length; i++) {
            var p = points[i];
            if (!p) continue;
            var x = p.x !== undefined ? p.x : p[0];
            var y = p.y !== undefined ? p.y : p[1];
            if (typeof x !== "number" || typeof y !== "number") continue;
            ctx.beginPath();
            ctx.arc(x, y, r, 0, Math.PI * 2);
            ctx.fill();
        }

        ctx.globalAlpha = prevAlpha;
        ctx.fillStyle = prevFill;
    }

    /*
     * §4.4 RENDER-SPACE GRID QUANTIZATION
     *
     * Snap drawing to a virtual 4px or 8px grid — sub-pixel motion destroys
     * the illusion instantly.
     *
     * QUANTIZE RENDERING ONLY, NEVER PHYSICS. The repo already has the right
     * idiom: Glucose Dash keeps physics in flat track space and applies its
     * curve exclusively inside SX(). Same discipline here — one snap() at the
     * draw call, and the simulation never sees it. Quantizing physics would
     * produce collision bugs that present as gameplay bugs, which is a much
     * worse afternoon than a slightly soft sprite.
     */
    function snap(v, grid) {
        var g = grid || 4;
        return Math.round(v / g) * g;
    }

    /*
     * §4.9 QUANTIZED LIGHT
     *
     * The era had no smooth gradients. But several games here use gradient
     * lighting as a MECHANIC rather than decoration — Zombie's darkness,
     * Glucose Dash's floors. Do not remove those; band them into 3-4 discrete
     * steps. The mechanic survives intact and the rendering becomes correct.
     *
     * Zombie's ambientDarkness() is balance-tested (§5 lists it as untouchable
     * and v2's blackout at 0.94 playtested as a guaranteed loss), so band what
     * it RETURNS at the draw call. Never round the values it works from.
     */
    function band(v, bands) {
        var n = bands || 4;
        if (n < 1) n = 1;
        var c = v < 0 ? 0 : (v > 1 ? 1 : v);
        return Math.round(c * (n - 1)) / (n - 1);
    }

    /*
     * §4.7 FLICKER AS A BUDGET, NOT A BUG
     *
     * Era hardware flickered when too many sprites shared a scanline — the
     * machine physically could not draw them all. Do NOT simulate a glitch;
     * adopt the vocabulary. Past a per-frame cap, render the overflow on
     * alternating frames.
     *
     * The rare aesthetic choice that pays for itself: it is authentic AND it
     * halves the draw cost of the overflow. Zombie's late hordes and RD
     * Arena's 40-enemy cap are the natural homes.
     *
     *     for (var i = 0; i < enemies.length; i++) {
     *         if (!RETRO.flicker(i, 40, frameCount)) continue;
     *         draw(enemies[i]);
     *     }
     */
    function flicker(index, cap, frame) {
        if (index < cap) return true;               // inside budget: always drawn
        return ((index + frame) & 1) === 0;         // overflow: every other frame
    }

    /*
     * §3.4 — scores are zero-padded to 6 digits: 001250, never 1250.
     * Negative and non-finite values are clamped rather than producing a
     * "00-125"-shaped string in a HUD mid-game.
     */
    function padScore(n, digits) {
        var d = digits || 6;
        var v = Math.floor(Number(n));
        if (!isFinite(v) || v < 0) v = 0;
        var s = String(v);
        while (s.length < d) s = "0" + s;
        return s;
    }

    /*
     * §4.8 ATTRACT MODE  ★ "the most era-defining behaviour in the document"
     *
     * Every cabinet, left alone, played itself. Nothing in modern web games
     * does this, and it costs almost nothing because every game here already
     * owns a render loop.
     *
     * HOW THIS AVOIDS OPENING A TEARDOWN PATH (see the file header):
     *   - no timer: you call tick() from the loop you already have
     *   - no listener the caller cannot kill: `signal` is REQUIRED and is
     *     passed straight to addEventListener
     *
     *     var attract = RETRO.attract({
     *         idleMs: 20000,
     *         signal: listenerController.signal,
     *         onEnter: function () { demoMode = true;  insertCoin.hidden = false; },
     *         onExit:  function () { demoMode = false; insertCoin.hidden = true;  }
     *     });
     *     // ...in the render loop:
     *     attract.tick();
     *
     * onEnter/onExit fire once per transition, not per frame.
     */
    function attract(opts) {
        var o = opts || {};
        var idleMs = typeof o.idleMs === "number" ? o.idleMs : 20000;
        var onEnter = typeof o.onEnter === "function" ? o.onEnter : null;
        var onExit = typeof o.onExit === "function" ? o.onExit : null;
        var target = o.target || global;
        var active = false;
        var last = now();

        var inert = {
            tick: function () {},
            poke: function () {},
            isActive: function () { return false; },
            destroy: function () {}
        };

        // Refuse rather than leak. A listener the game's destroy() cannot
        // abort is the exact failure the hard constraint exists to prevent,
        // so this warns and does nothing instead of half-working.
        if (!o.signal) {
            if (global.console && console.warn) {
                console.warn("RETRO.attract: needs { signal } from the game's AbortController. " +
                             "Refusing to attach listeners it cannot tear down. Attract mode is off.");
            }
            return inert;
        }
        if (!target || typeof target.addEventListener !== "function") return inert;

        function poke() {
            last = now();
            if (active) {
                active = false;
                if (onExit) { try { onExit(); } catch (e) { logOnce(e); } }
            }
        }

        // pointermove is included because a player nudging the mouse is not
        // idle; it is also the noisiest of these, and all it does is write a
        // timestamp, so the cost is a store per event.
        var EVENTS = ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"];
        for (var i = 0; i < EVENTS.length; i++) {
            try {
                target.addEventListener(EVENTS[i], poke, { passive: true, signal: o.signal });
            } catch (e) { /* an unsupported event name must not take the rest down */ }
        }

        return {
            tick: function () {
                if (active) return;
                if (now() - last < idleMs) return;
                active = true;
                if (onEnter) { try { onEnter(); } catch (e) { logOnce(e); } }
            },
            poke: poke,
            isActive: function () { return active; },
            // Present for symmetry with the rest of the repo's lifecycles. The
            // caller's AbortController already removes the listeners, so this
            // only settles the state flag.
            destroy: function () { active = false; }
        };
    }

    function now() {
        return (global.performance && global.performance.now)
            ? global.performance.now()
            : Date.now();
    }

    // A callback that throws every frame would otherwise produce thousands of
    // identical console lines and hide whatever the real problem was.
    var loggedOnce = false;
    function logOnce(err) {
        if (loggedOnce) return;
        loggedOnce = true;
        if (global.console && console.error) {
            console.error("RETRO: a callback threw (further identical errors suppressed):", err);
        }
    }

    global.RETRO = {
        PERSIST: PERSIST,
        persist: persist,
        beam: beam,
        vertexBloom: vertexBloom,
        snap: snap,
        band: band,
        flicker: flicker,
        padScore: padScore,
        attract: attract
    };

    /*
     * DELIBERATELY NOT HERE
     *
     * §3.3's Hershey stroke font. It is the right call for in-canvas text on a
     * Vector cabinet — vector games had no fonts, their letterforms were line
     * segments drawn by the same beam, so stroked text inherits persistence
     * and vertex bloom for free. It is left out because it is a data table,
     * not a technique, and only the Vector cabinets want it. It belongs in its
     * own shared/hershey.js the first time a second game needs it.
     *
     * §4.12's forbidden list is worth repeating where someone might reach for
     * it: no barrel/CRT-curvature shader, no decorative dithering, no
     * chromatic aberration, no forced 30fps or fake input lag. Those read as
     * "bad", not as "era".
     */
})(typeof window !== "undefined" ? window : this);
