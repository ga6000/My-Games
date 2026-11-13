/*
 * shared/hubscore.js — the hub point scale and the floating score toast.
 *
 * Classic script, one global (`HUBSCORE`).
 *
 *     <script src="../shared/hubscore.js"></script>
 *     HUBSCORE.toast(screenX, screenY, HUBSCORE.TIER.ELITE, { color: MP.selfColor });
 *     HUBSCORE.format(1200)   // "1,200"
 *
 * WHY ONE SCALE
 * A party session (shared/party.js) pays placement points, so a session is
 * fair even when two games score differently. The scale is for the FEEL:
 * every cabinet in an '80s arcade paid 100 for a grunt and 5,000 for a boss,
 * and a number that floats off a kill should mean the same thing in every
 * game on the board. AESTHETIC_GUIDE.md §4.13 is the standard; this file is
 * its one implementation.
 *
 *   A solid 3 minute round lands near PAR (25,000). 100,000 is a great one.
 *   Every value ends in 0. Nothing pays less than 10.
 *
 * THE TOAST IS DOM, NOT CANVAS
 * Three games, three renderers (two 2D canvases with different cameras, one
 * DOM-heavy). A fixed-position element over the page needs nothing from any
 * of them except a screen coordinate. Capped at MAX_LIVE so a chain kill
 * cannot build a few hundred nodes; past the cap the oldest is reused.
 *
 * NO TIMERS: a toast removes itself on `animationend`, and destroy() drops
 * the layer. Nothing here needs tracking under the teardown rule.
 */
(function (global) {
    "use strict";

    var TIER = {
        CHIP: 10,           // a tick of time, distance or assist
        GRUNT: 100,         // the common enemy
        TOUGH: 200,         // takes more than one hit
        ELITE: 500,         // a named threat
        OBJECTIVE: 1000,    // a goal, a checkpoint, a tank filled
        BOSS: 5000,         // the big one, or winning the round
        CLEAR: 10000        // the group beat the game
    };

    var PAR = 25000;
    var MAX_LIVE = 24;

    var layer = null;
    var live = [];
    var styled = false;

    function format(n) {
        n = Math.round(Number(n) || 0);
        var s = String(Math.abs(n));
        var out = "";
        while (s.length > 3) {
            out = "," + s.slice(-3) + out;
            s = s.slice(0, -3);
        }
        return (n < 0 ? "-" : "") + s + out;
    }

    // Round to the scale: nearest 10, never below 10 for anything earned.
    function snap(n) {
        n = Number(n) || 0;
        if (n <= 0) return 0;
        return Math.max(10, Math.round(n / 10) * 10);
    }

    function ensureLayer() {
        if (layer && layer.isConnected) return layer;
        if (!global.document || !document.body) return null;
        if (!styled) {
            styled = true;
            var css = document.createElement("style");
            css.setAttribute("data-hubscore", "");
            css.textContent =
                "#hubscoreLayer{position:fixed;left:0;top:0;width:0;height:0;z-index:900;pointer-events:none}" +
                ".hubscore-toast{position:fixed;transform:translate(-50%,-50%);white-space:nowrap;" +
                "font-family:'Press Start 2P','VT323',monospace;font-size:12px;line-height:1;color:#FFB000;" +
                "text-shadow:2px 2px 0 #000,-1px -1px 0 #000,0 0 6px currentColor;" +
                "animation:hubscoreRise .85s steps(12,end) forwards;will-change:transform,opacity}" +
                ".hubscore-toast.big{font-size:18px;animation-duration:1.25s}" +
                "@keyframes hubscoreRise{0%{transform:translate(-50%,-50%) scale(1.5);opacity:1}" +
                "15%{transform:translate(-50%,-90%) scale(1);opacity:1}" +
                "70%{opacity:1}100%{transform:translate(-50%,-320%) scale(1);opacity:0}}" +
                "@media (prefers-reduced-motion:reduce){.hubscore-toast{animation-timing-function:linear}}";
            document.head.appendChild(css);
        }
        layer = document.createElement("div");
        layer.id = "hubscoreLayer";
        layer.setAttribute("aria-hidden", "true");
        document.body.appendChild(layer);
        return layer;
    }

    function retire(el) {
        var i = live.indexOf(el);
        if (i >= 0) live.splice(i, 1);
        if (el.parentNode) el.parentNode.removeChild(el);
    }

    /*
     * x, y are CLIENT pixels (the same space as a mouse event), so a canvas
     * game converts once: canvasRect.left + worldToScreenX(...).
     *   opts.color  the earner's identity colour (default amber)
     *   opts.big    a larger, slower toast for OBJECTIVE and up; defaults
     *               to on from 1,000
     *   opts.text   replaces the number ("CLEAR  10,000")
     */
    function toast(x, y, points, opts) {
        opts = opts || {};
        points = Math.round(Number(points) || 0);
        if (!opts.text && points <= 0) return null;
        var host = ensureLayer();
        if (!host) return null;

        while (live.length >= MAX_LIVE) retire(live[0]);

        var el = document.createElement("div");
        var big = opts.big !== undefined ? !!opts.big : points >= TIER.OBJECTIVE;
        el.className = "hubscore-toast" + (big ? " big" : "");
        el.textContent = opts.text || format(points);
        el.style.left = Math.round(x) + "px";
        el.style.top = Math.round(y) + "px";
        if (opts.color) el.style.color = opts.color;
        el.addEventListener("animationend", function () { retire(el); });
        host.appendChild(el);
        live.push(el);
        return el;
    }

    function destroy() {
        live = [];
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
        layer = null;
    }

    global.HUBSCORE = {
        TIER: TIER,
        PAR: PAR,
        format: format,
        snap: snap,
        toast: toast,
        liveCount: function () { return live.length; },
        destroy: destroy
    };
})(window);
