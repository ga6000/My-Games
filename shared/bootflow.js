/*
 * shared/bootflow.js — the screens every hub game boots through.
 *
 * Classic script, one global (`BOOTFLOW`).
 *
 *     LOAD -> TITLE -> ATTRACT -> READY (the border) -> PLAY
 *
 * AESTHETIC_GUIDE.md §4.8 is the standard. This file is the three pieces of
 * it that are the same in every game:
 *
 *   BOOTFLOW.intro(opts, done)   LOAD then TITLE, as a full-screen card.
 *                                `done()` runs when the player presses
 *                                through, or the title times out into the
 *                                game's own attract run.
 *   BOOTFLOW.border(on, label)   the READY border: a thick colour-cycling
 *                                frame round the whole screen with a label,
 *                                in the manner of Robotron and Defender. It
 *                                means one thing: THIS IS NOT LIVE YET.
 *   BOOTFLOW.ready(opts)         the party ready check Zombie introduced:
 *                                a square per player, tick yours, everyone
 *                                starts together.
 *
 * The ATTRACT run itself is the game's (only the game can play itself), and
 * so is PLAY.
 *
 * INSIDE A PARTY SESSION the intro is skipped (`?party=1`, set by the hub):
 * the group has just seen the hub, and turnover between games is the point.
 * `?nointro=1` skips it for tests and for anyone who has seen it enough.
 *
 * Teardown: every timer is tracked and every listener hangs off one
 * AbortController; destroy() drops all of it.
 */
(function (global) {
    "use strict";

    var LOAD_MS = 900;
    var TITLE_IDLE_MS = 7000;       // then on into the attract run
    var RESEND_MS = 1500;
    var GO_DELAY_MS = 650;          // the last tick is seen before it starts

    var styled = false;
    var timers = [];
    var abort = null;
    var introEl = null;
    var borderEl = null;
    var readyState = null;

    function signal() {
        if (!abort) abort = new AbortController();
        return abort.signal;
    }
    function later(fn, ms) { var id = setTimeout(fn, ms); timers.push(id); return id; }
    function every(fn, ms) { var id = setInterval(fn, ms); timers.push(id); return id; }
    function stop(id) { clearTimeout(id); clearInterval(id); }

    function param(name) {
        try { return new URLSearchParams(global.location.search).get(name); }
        catch (e) { return null; }
    }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function style() {
        if (styled) return;
        styled = true;
        var css = document.createElement("style");
        css.setAttribute("data-bootflow", "");
        css.textContent =
            ".bf-font{font-family:'Press Start 2P','VT323',monospace}" +
            "#bfIntro{position:fixed;inset:0;z-index:4000;background:#000;color:#E8E8E8;display:flex;flex-direction:column;" +
            "align-items:center;justify-content:center;text-align:center;cursor:pointer;padding:24px}" +
            "#bfIntro .bf-chapter{font-size:10px;color:#00E5FF;letter-spacing:2px;margin-bottom:18px}" +
            "#bfIntro .bf-title{font-size:clamp(22px,6vw,54px);color:#FFB000;line-height:1.25;" +
            "text-shadow:4px 4px 0 #FF2E88,-2px -2px 0 #00E5FF}" +
            "#bfIntro .bf-tag{font-size:10px;margin-top:18px;line-height:1.8;max-width:640px}" +
            "#bfIntro .bf-press{font-size:11px;margin-top:34px;color:#00E5FF;animation:bfBlink 1s steps(2,start) infinite}" +
            "#bfIntro .bf-bar{width:min(360px,70vw);height:14px;border:3px solid #00E5FF;margin-top:22px}" +
            "#bfIntro .bf-fill{height:100%;width:0;background:#FFB000;animation:bfLoad " + LOAD_MS + "ms steps(12,end) forwards}" +
            "@keyframes bfLoad{to{width:100%}}" +
            "@keyframes bfBlink{to{visibility:hidden}}" +
            "#bfBorder{position:fixed;inset:0;z-index:3500;pointer-events:none;border:14px solid #FF2E88;" +
            "animation:bfCycle 1.2s steps(1,end) infinite;box-shadow:inset 0 0 0 4px #000}" +
            "#bfBorder .bf-label{position:absolute;left:50%;top:-14px;transform:translateX(-50%);background:#000;color:#FFB000;" +
            "font-size:9px;padding:3px 10px;white-space:nowrap;letter-spacing:1px}" +
            "@keyframes bfCycle{0%{border-color:#FF2E88}17%{border-color:#FFB000}34%{border-color:#00E5FF}" +
            "51%{border-color:#39FF14}68%{border-color:#FFFFFF}85%{border-color:#7B4DFF}}" +
            "#bfReady{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);z-index:3600;background:rgba(0,0,0,.86);" +
            "border:3px solid #00E5FF;padding:18px 22px;text-align:center;color:#E8E8E8;min-width:min(420px,88vw);cursor:pointer}" +
            "#bfReady .bf-head{font-size:10px;color:#00E5FF;margin-bottom:6px;letter-spacing:1px}" +
            "#bfReady .bf-party{font-size:8px;color:#FFB000;margin-bottom:12px}" +
            "#bfReady .bf-row{display:flex;gap:16px;justify-content:center;flex-wrap:wrap;margin:10px 0 14px}" +
            "#bfReady .bf-box{width:38px;height:38px;border:3px solid var(--pc,#00E5FF);margin:0 auto 6px;position:relative}" +
            "#bfReady .bf-box.ready{background:var(--pc,#00E5FF)}" +
            "#bfReady .bf-box.ready::after{content:'';position:absolute;left:11px;top:4px;width:9px;height:18px;" +
            "border:solid #000;border-width:0 5px 5px 0;transform:rotate(45deg)}" +
            "#bfReady .bf-name{font-size:8px}" +
            "#bfReady .bf-hint{font-size:10px;color:#FFB000}" +
            "#bfReady .bf-hint.blink{animation:bfBlink 1s steps(2,start) infinite}" +
            "@media (prefers-reduced-motion:reduce){#bfBorder{animation:none}}";
        document.head.appendChild(css);
    }

    // ---------------------------------------------------------------
    //   LOAD -> TITLE
    // ---------------------------------------------------------------
    // opts: { title, chapter, tagline, loadReady: fn -> bool }
    // done(how): how is "press" (the player pressed through) or "idle"
    // (the title timed out, so the game should show its attract run), or
    // "skip" (a party session, or ?nointro=1).
    function introSkipped() {
        return param("party") === "1" || param("nointro") === "1" ||
            /node/i.test((global.navigator && navigator.userAgent) || "");
    }

    function intro(opts, done) {
        opts = opts || {};
        var finished = false;
        function end(how) {
            if (finished) return;
            finished = true;
            if (introEl && introEl.parentNode) introEl.parentNode.removeChild(introEl);
            introEl = null;
            if (typeof done === "function") done(how);
        }
        if (introSkipped()) { end("skip"); return; }

        style();
        introEl = document.createElement("div");
        introEl.id = "bfIntro";
        introEl.className = "bf-font";
        introEl.innerHTML =
            "<div class='bf-chapter'>" + esc(opts.chapter || "") + "</div>" +
            "<div class='bf-title'>" + esc(opts.title || "") + "</div>" +
            "<div class='bf-tag' id='bfTag'>LOADING</div>" +
            "<div class='bf-bar' id='bfBar'><div class='bf-fill'></div></div>";
        document.body.appendChild(introEl);

        var started = Date.now();
        var poll = every(function () {
            var ready = typeof opts.loadReady === "function" ? !!opts.loadReady() : true;
            if (Date.now() - started < LOAD_MS || !ready) return;
            stop(poll);
            if (!introEl) return;
            var bar = document.getElementById("bfBar");
            if (bar) bar.parentNode.removeChild(bar);
            var tag = document.getElementById("bfTag");
            if (tag) tag.textContent = opts.tagline || "";
            var press = document.createElement("div");
            press.className = "bf-press";
            press.textContent = "PRESS ANY KEY";
            introEl.appendChild(press);
            var local = new AbortController();
            var sig = local.signal;
            signal().addEventListener("abort", function () { local.abort(); });
            function go(e) {
                if (e && e.type === "keydown" && (e.ctrlKey || e.metaKey || e.altKey)) return;
                local.abort();
                end("press");
            }
            // Released first: the key that got the player here (Enter on the
            // hub's Continue) must not also press through the title.
            later(function () {
                global.addEventListener("keydown", go, { signal: sig });
                if (introEl) introEl.addEventListener("pointerdown", go, { signal: sig });
            }, 250);
            later(function () { local.abort(); end("idle"); }, TITLE_IDLE_MS);
        }, 100);
    }

    // ---------------------------------------------------------------
    //   THE BORDER
    // ---------------------------------------------------------------
    function border(on, label) {
        if (!on) {
            if (borderEl && borderEl.parentNode) borderEl.parentNode.removeChild(borderEl);
            borderEl = null;
            return;
        }
        style();
        if (!borderEl || !borderEl.isConnected) {
            borderEl = document.createElement("div");
            borderEl.id = "bfBorder";
            borderEl.className = "bf-font";
            borderEl.innerHTML = "<div class='bf-label'></div>";
            document.body.appendChild(borderEl);
        }
        var text = label || "NOT LIVE · WAITING FOR PLAYERS";
        var lab = borderEl.firstChild;
        if (lab.textContent !== text) lab.textContent = text;
    }

    // ---------------------------------------------------------------
    //   THE READY CHECK
    // ---------------------------------------------------------------
    // opts:
    //   players()   -> [{ id, name, color, self }]   everyone in the room
    //   send(msg)   relay `msg` to the room (MP.send)
    //   onStart()   everyone is ticked: begin the round
    //   label       optional border label
    //   joinLive()  -> bool: a round is already running, so this player
    //               joins it at once on their own tick (a late joiner)
    // The game passes relay payloads through BOOTFLOW.onMessage(payload, from);
    // it returns true when the payload was this file's.
    function ready(opts) {
        endReady();
        style();
        var st = readyState = {
            opts: opts || {},
            ticks: {},
            goAt: 0,
            sig: "",
            el: document.createElement("div"),
            local: new AbortController(),
            loop: 0,
            lastSend: 0,
            done: false
        };
        st.el.id = "bfReady";
        st.el.className = "bf-font";
        document.body.appendChild(st.el);
        border(true, st.opts.label);

        function selfId() {
            var list = st.opts.players() || [];
            for (var i = 0; i < list.length; i++) if (list[i].self) return list[i].id;
            return "solo";
        }
        function tick(e) {
            if (st.done) return;
            if (e && e.type === "keydown" && e.code !== "Enter" && e.code !== "Space") return;
            if (e && e.type === "keydown") e.preventDefault();
            if (typeof st.opts.onUnlock === "function") st.opts.onUnlock();   // the browser's audio unlock
            if (typeof st.opts.joinLive === "function" && st.opts.joinLive()) { begin(); return; }
            var me = selfId();
            if (!st.ticks[me]) {
                st.ticks[me] = true;
                st.sig = "";
                if (st.opts.send) st.opts.send({ k: "bf-ready" });
                st.lastSend = Date.now();
            }
        }
        function begin() {
            if (st.done) return;
            st.done = true;
            var start = st.opts.onStart;
            endReady();
            if (typeof start === "function") start();
        }
        st.begin = begin;

        later(function () {
            if (st.done) return;
            global.addEventListener("keydown", tick, { signal: st.local.signal });
            st.el.addEventListener("pointerdown", tick, { signal: st.local.signal });
        }, 250);

        st.loop = every(function () {
            if (st.done) return;
            var list = st.opts.players() || [];
            var live = typeof st.opts.joinLive === "function" && st.opts.joinLive();
            // Drop ticks from players who have gone.
            var keep = {};
            var n = 0;
            for (var i = 0; i < list.length; i++) if (st.ticks[list[i].id]) { keep[list[i].id] = true; n++; }
            st.ticks = keep;
            var me = selfId();
            var all = !live && list.length > 0 && n === list.length;

            var sig = list.map(function (m) { return m.id + m.name + (st.ticks[m.id] ? 1 : 0); }).join("|") + "#" + live + all;
            if (sig !== st.sig) {
                st.sig = sig;
                var party = (global.PARTY && PARTY.label && PARTY.label()) || "";
                var html = "<div class='bf-head'>" + (live ? "A ROUND IS UNDER WAY" : "PLAYERS IN PARTY") + "</div>" +
                    (party ? "<div class='bf-party'>" + esc(party) + "</div>" : "");
                if (!live) {
                    html += "<div class='bf-row'>";
                    for (var j = 0; j < list.length; j++) {
                        var m = list[j];
                        html += "<div><div class='bf-box" + (st.ticks[m.id] ? " ready" : "") + "' style='--pc:" + esc(m.color || "#00E5FF") +
                            "'></div><div class='bf-name'>" + esc(String(m.name || "PLAYER").toUpperCase().slice(0, 10)) +
                            (m.self ? " (YOU)" : "") + "</div></div>";
                    }
                    html += "</div>";
                }
                html += "<div class='bf-hint" + ((live || !st.ticks[me]) ? " blink" : "") + "'>" +
                    (live ? "PRESS TO JOIN" : all ? "STARTING" : st.ticks[me] ? "WAITING FOR PLAYERS  " + n + "/" + list.length : "PRESS TO READY") +
                    "</div>";
                st.el.innerHTML = html;
            }

            // Re-sent, so a tick made before a friend's page was listening
            // is not lost.
            if (st.ticks[me] && st.opts.send && Date.now() - st.lastSend > RESEND_MS) {
                st.lastSend = Date.now();
                st.opts.send({ k: "bf-ready" });
            }

            if (all) {
                if (!st.goAt) st.goAt = Date.now() + GO_DELAY_MS;
                else if (Date.now() >= st.goAt) begin();
            } else {
                st.goAt = 0;
            }
        }, 100);
    }

    function endReady() {
        var st = readyState;
        if (!st) return;
        readyState = null;
        st.done = true;
        stop(st.loop);
        st.local.abort();
        if (st.el.parentNode) st.el.parentNode.removeChild(st.el);
        border(false);
    }

    function onMessage(payload, from) {
        if (!payload || payload.k !== "bf-ready") return false;
        if (readyState && from) { readyState.ticks[from] = true; readyState.sig = ""; }
        return true;
    }

    function destroy() {
        endReady();
        for (var i = 0; i < timers.length; i++) stop(timers[i]);
        timers = [];
        if (abort) { abort.abort(); abort = null; }
        if (introEl && introEl.parentNode) introEl.parentNode.removeChild(introEl);
        introEl = null;
        border(false);
    }

    global.BOOTFLOW = {
        intro: intro,
        introSkipped: introSkipped,
        border: border,
        ready: ready,
        readyOpen: function () { return !!readyState; },
        // Everyone is past the check on another screen (the host started):
        // close ours too.
        forceStart: function () { if (readyState) readyState.begin(); },
        endReady: endReady,
        onMessage: onMessage,
        destroy: destroy
    };
})(window);
