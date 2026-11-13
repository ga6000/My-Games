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

    /*
     * THE SCORE STRIP (added 2026-11-13). For a game with no cabinet panel
     * yet: one line at the top centre, the way every cabinet printed it.
     *
     *     1UP 001200      HI-SCORE 025000      STORY PARTY · GAME 2 OF 5
     *
     * Call it as often as you like (once a frame is fine): it only touches
     * the DOM when something changed. Zero-padded to six, and the number
     * steps, it never tweens (AESTHETIC_GUIDE.md §3.4).
     *   state.game   id, the key the best score is kept under (localStorage)
     *   state.score  this player's score now
     *   state.label  optional third field (the session label, a clock)
     *   state.color  optional: this player's identity colour for "1UP"
     * A game that has the panel (§4.11a) shows these there and never calls this.
     */
    var hudEl = null;
    var hudShown = "";
    var hudBest = {};

    function pad6(n) {
        var s = String(Math.max(0, Math.round(Number(n) || 0)));
        while (s.length < 6) s = "0" + s;
        return s;
    }

    function best(game, score) {
        if (!(game in hudBest)) {
            var stored = 0;
            try { stored = Number(global.localStorage.getItem("hubscore_best_" + game)) || 0; } catch (e) { /* no storage */ }
            hudBest[game] = stored;
        }
        if (score > hudBest[game]) {
            hudBest[game] = score;
            try { global.localStorage.setItem("hubscore_best_" + game, String(score)); } catch (e) { /* not kept */ }
        }
        return hudBest[game];
    }

    function hud(state) {
        if (!global.document || !document.body) return;
        ensureLayer();
        if (!hudEl || !hudEl.isConnected) {
            var css = document.createElement("style");
            css.setAttribute("data-hubscore-hud", "");
            css.textContent =
                "#hubscoreHud{position:fixed;top:0;left:50%;transform:translateX(-50%);z-index:890;pointer-events:none;" +
                "display:flex;gap:22px;align-items:baseline;padding:7px 14px 6px;background:#000;" +
                "border:2px solid #2E3A34;border-top:0;white-space:nowrap;" +
                "font-family:'Press Start 2P','VT323',monospace;font-size:11px;line-height:1;color:#E8FFF4}" +
                "#hubscoreHud i{font-style:normal;color:#FF3344;margin-right:8px}" +
                "#hubscoreHud .hs-label{color:#FFB000}" +
                "@media (max-width:640px){#hubscoreHud{font-size:8px;gap:12px}}";
            document.head.appendChild(css);
            hudEl = document.createElement("div");
            hudEl.id = "hubscoreHud";
            hudEl.setAttribute("aria-hidden", "true");
            document.body.appendChild(hudEl);
            hudShown = "";
        }
        var score = Math.max(0, Math.round(Number(state.score) || 0));
        var hi = best(state.game || "game", score);
        var key = score + "|" + hi + "|" + (state.label || "") + "|" + (state.color || "");
        if (key === hudShown) return;
        hudShown = key;
        hudEl.innerHTML =
            "<span><i" + (state.color ? " style='color:" + String(state.color).replace(/[^#(),.%a-zA-Z0-9 ]/g, "") + "'" : "") + ">1UP</i>" + pad6(score) + "</span>" +
            "<span><i>HI-SCORE</i>" + pad6(hi) + "</span>" +
            (state.label ? "<span class='hs-label'>" + String(state.label).replace(/[<>&]/g, "") + "</span>" : "");
    }

    function hudHide() {
        if (hudEl && hudEl.parentNode) hudEl.parentNode.removeChild(hudEl);
        hudEl = null;
        hudShown = "";
    }

    function destroy() {
        live = [];
        hudHide();
        if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
        layer = null;
    }

    global.HUBSCORE = {
        TIER: TIER,
        PAR: PAR,
        format: format,
        pad6: pad6,
        best: best,
        hud: hud,
        hudHide: hudHide,
        snap: snap,
        toast: toast,
        liveCount: function () { return live.length; },
        destroy: destroy
    };
})(window);
