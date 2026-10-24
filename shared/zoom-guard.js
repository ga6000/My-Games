/*
 * shared/zoom-guard.js — stops accidental browser zoom and warns when it is on.
 *
 * Two jobs, because a page can only do half of the first one:
 *   1. BLOCK the accidental routes: Ctrl/Cmd + wheel (a trackpad pinch arrives
 *      as a ctrl-wheel event too) and Ctrl/Cmd + '+', '-', '0'. The wheel
 *      listener must be { passive: false } or preventDefault is ignored.
 *      Cannot block the browser menu or the address-bar zoom control, and cannot
 *      reset a zoom level the browser already remembers for this site.
 *   2. WARN when the page is zoomed anyway: a banner with a Reset button.
 *      Zoom is read as outerWidth/innerWidth (devicePixelRatio alone cannot tell
 *      zoom from a high-DPI monitor). A docked DevTools pane can trip it; the
 *      banner is dismissible and returns only if the ratio changes again.
 *
 * Own AbortController and own timer set, deliberately NOT the host game's — a
 * game's destroy() must not leave this half-alive (same rule as devtools.js).
 * Classic script, file:// safe. Exposes one global: ZOOMGUARD.
 */
(function (global) {
    "use strict";
    if (global.ZOOMGUARD) return;

    var ac = new AbortController();
    var sig = { signal: ac.signal };
    var timers = [];
    var banner = null;
    var dismissedAt = null;
    var TOL = 0.08;

    function ratio() {
        var o = global.outerWidth, i = global.innerWidth;
        return (o > 0 && i > 0) ? o / i : 1;
    }
    function isZoomed() { return Math.abs(ratio() - 1) > TOL; }

    function onWheel(e) {
        if (e.ctrlKey || e.metaKey) e.preventDefault();
    }
    function onKey(e) {
        if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
        var k = e.key;
        if (k === "+" || k === "=" || k === "-" || k === "_" || k === "0" ||
            k === "Add" || k === "Subtract") e.preventDefault();
    }

    function build() {
        var d = document.createElement("div");
        d.setAttribute("role", "alert");
        d.style.cssText = "position:fixed;left:50%;top:8px;transform:translateX(-50%);" +
            "z-index:2147483647;background:#000;color:#fff;border:2px solid #ff3b3b;" +
            "padding:8px 12px;font:14px/1.3 monospace;display:flex;gap:10px;" +
            "align-items:center;max-width:92vw;";
        var t = document.createElement("span");
        t.className = "zg-text";
        var b1 = document.createElement("button");
        b1.textContent = "Reset: Ctrl+0";
        b1.title = "Press Ctrl+0 (Cmd+0 on Mac) to return the browser to 100% zoom";
        b1.style.cssText = "font:inherit;cursor:pointer;";
        b1.addEventListener("click", function () {
            t.textContent = "Press Ctrl+0 (Cmd+0 on Mac) to reset zoom.";
        }, sig);
        var b2 = document.createElement("button");
        b2.textContent = "Dismiss";
        b2.style.cssText = "font:inherit;cursor:pointer;";
        b2.addEventListener("click", function () {
            dismissedAt = ratio();
            hide();
        }, sig);
        d.appendChild(t); d.appendChild(b1); d.appendChild(b2);
        return d;
    }
    function hide() {
        if (banner && banner.parentNode) banner.parentNode.removeChild(banner);
        banner = null;
    }
    function check() {
        var r = ratio();
        if (!isZoomed()) { dismissedAt = null; hide(); return; }
        if (dismissedAt !== null && Math.abs(r - dismissedAt) < 0.02) return;
        if (!document.body) return;
        if (!banner) { banner = build(); document.body.appendChild(banner); }
        banner.querySelector(".zg-text").textContent =
            "Browser zoom is about " + Math.round(100 / r) + "%. Parts of the screen may be cut off.";
    }

    global.addEventListener("wheel", onWheel, { passive: false, signal: ac.signal });
    global.addEventListener("keydown", onKey, sig);
    global.addEventListener("resize", check, sig);
    timers.push(setInterval(check, 1000));
    if (document.readyState === "loading") {
        document.addEventListener("DOMContentLoaded", check, sig);
    } else check();

    global.ZOOMGUARD = {
        destroy: function () {
            ac.abort();
            timers.forEach(clearInterval);
            timers.length = 0;
            hide();
        }
    };
})(window);
