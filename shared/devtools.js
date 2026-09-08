/*
 * shared/devtools.js — the L+G dev panel, as one global (`DEVTOOLS`).
 *
 * Classic script, one global, same shape as shared/identity.js and
 * shared/retro.js — see identity.js's header for why modules are banned here.
 *
 *     <script src="../shared/devtools.js"></script>
 *
 * Load it EARLY (with the other shared files, before the game's own scripts)
 * and register from a `<game>-dev.js` loaded LAST. Two reasons for that order:
 * the error capture below only sees throws that happen after it installs, and
 * this file's keydown listener must be attached before the game's so it can
 * stop a combo press from also reaching the game.
 *
 * ---------------------------------------------------------------------------
 * WHY THE ERROR BUFFER IS THE POINT, AND THE BUTTONS ARE THE GARNISH
 * ---------------------------------------------------------------------------
 * scripts/check-undefined-globals.js exists (2026-09-07) because
 * zombie-game.js read SPAWN_RING_MIN / SPAWN_RING_MAX, two constants that
 * existed nowhere in the repo. The ReferenceError came out of the host's
 * update loop, killed broadcastWorld, and froze every other client in the room
 * while the host kept drawing and looked perfectly healthy. Nobody had a
 * console open, because nobody playtests with DevTools up.
 *
 * That checker is the static half of the lesson. This is the runtime half: the
 * last throws, on the machine where the freeze actually happened, one keypress
 * away. Everything else here — the state readout, the buttons — is convenience
 * layered on top of that.
 *
 * ---------------------------------------------------------------------------
 * THE TEARDOWN RULE
 * ---------------------------------------------------------------------------
 * Root CLAUDE.md: every timer through trackTimeout/trackInterval, every
 * listener through one AbortController. This module keeps its OWN of each —
 * one controller for its listeners, one Set for its timers — and
 * DEVTOOLS.destroy() empties both. It deliberately does not borrow the host
 * game's controller: a game's destroy() should not be able to leave the dev
 * panel half-alive, and the panel's teardown should not depend on the game
 * having been written to the GameInstance contract in the first place (RD
 * Arena has not been).
 *
 * Nothing here throws. Every action a game registers is called inside a
 * try/catch: a dev button with a typo in it must not take the game down, which
 * would be a spectacularly ironic way for a debugging tool to fail.
 */
(function (global) {
    "use strict";

    // ===================================================
    //   TEARDOWN
    // ===================================================
    var abortCtl = new AbortController();
    var listenOpts = { signal: abortCtl.signal };
    var timeoutIds = new Set();
    var intervalIds = new Set();

    function trackTimeout(fn, ms) {
        var id = setTimeout(function () { timeoutIds.delete(id); fn(); }, ms);
        timeoutIds.add(id);
        return id;
    }
    function trackInterval(fn, ms) {
        var id = setInterval(fn, ms);
        intervalIds.add(id);
        return id;
    }
    function clearTracked(id) {
        clearTimeout(id); timeoutIds.delete(id);
        clearInterval(id); intervalIds.delete(id);
    }

    // ===================================================
    //   ERROR CAPTURE  — installed at LOAD, not at init()
    // ===================================================
    // A ring, not a list: a game that throws once per frame would otherwise
    // eat the tab's memory while you were still reading the first one.
    var ERROR_MAX = 40;
    var errors = [];

    function pushError(kind, text) {
        var last = errors[errors.length - 1];
        // Per-frame throws collapse into one line with a counter. Forty
        // identical ReferenceErrors tell you nothing the first one didn't, and
        // they push the interesting earlier ones out of the ring.
        if (last && last.kind === kind && last.text === text) {
            last.count++;
            last.at = Date.now();
            return;
        }
        errors.push({ kind: kind, text: text, at: Date.now(), count: 1 });
        while (errors.length > ERROR_MAX) errors.shift();
    }

    function stringifyArgs(args) {
        var out = [];
        for (var i = 0; i < args.length; i++) {
            var a = args[i];
            try {
                if (a instanceof Error) {
                    var head = a.message;
                    var stack = a.stack ? String(a.stack).split("\n").slice(1, 3).join("\n  ") : "";
                    out.push(stack ? head + "\n  " + stack : head);
                } else if (typeof a === "object" && a !== null) {
                    out.push(JSON.stringify(a));
                } else {
                    out.push(String(a));
                }
            } catch (e) {
                out.push("[unstringifiable]");
            }
        }
        return out.join(" ");
    }

    // Wrapping rather than replacing: the real console still gets everything,
    // so nothing about opening the browser's own DevTools changes.
    function wrapConsole(name, kind) {
        var orig = global.console && global.console[name];
        if (typeof orig !== "function") return;
        global.console[name] = function () {
            try { pushError(kind, stringifyArgs(arguments)); } catch (e) { /* never break console */ }
            return orig.apply(global.console, arguments);
        };
    }
    wrapConsole("error", "error");
    wrapConsole("warn", "warn");

    global.addEventListener("error", function (e) {
        var where = e.filename ? (String(e.filename).split("/").pop() + ":" + e.lineno) : "";
        pushError("throw", (e.message || "error") + (where ? "  (" + where + ")" : ""));
    }, listenOpts);

    global.addEventListener("unhandledrejection", function (e) {
        var r = e && e.reason;
        pushError("reject", (r && r.message) ? r.message : String(r));
    }, listenOpts);

    // ===================================================
    //   ACTIVITY LOG  — what the panel itself did
    // ===================================================
    var NOTE_MAX = 40;
    var notes = [];

    function note(text) {
        notes.push({ text: String(text), at: Date.now() });
        while (notes.length > NOTE_MAX) notes.shift();
        if (isOpen) render();
    }

    function clockOf(ms) {
        var d = new Date(ms);
        function p(n) { return (n < 10 ? "0" : "") + n; }
        return p(d.getHours()) + ":" + p(d.getMinutes()) + ":" + p(d.getSeconds());
    }

    // ===================================================
    //   REGISTRATION
    // ===================================================
    var cfg = {
        game: "",
        armedWhen: null,
        onOpen: null,
        onClose: null,
        report: null,
        payload: null,
        actions: []
    };
    var registered = false;

    function init(options) {
        options = options || {};
        cfg.game = options.game || (document.body && document.body.getAttribute("data-game")) || "game";
        cfg.armedWhen = typeof options.armedWhen === "function" ? options.armedWhen : null;
        cfg.onOpen = typeof options.onOpen === "function" ? options.onOpen : null;
        cfg.onClose = typeof options.onClose === "function" ? options.onClose : null;
        cfg.report = typeof options.report === "function" ? options.report : null;
        cfg.payload = typeof options.payload === "function" ? options.payload : null;
        cfg.actions = Array.isArray(options.actions) ? options.actions : [];
        registered = true;
        if (panel) buildActions();
        return DEVTOOLS;
    }

    // Every registered action runs in here. A dev button that throws must not
    // take the game with it — and the throw itself is worth keeping, so it
    // goes straight into the same buffer the panel is already showing.
    function runAction(action) {
        if (!action || typeof action.fn !== "function") return;
        var label = action.label || "action";
        try {
            var result = action.fn();
            note(label + (typeof result === "string" ? " — " + result : ""));
        } catch (e) {
            pushError("action", label + ": " + (e && e.message ? e.message : String(e)));
            note(label + " — FAILED (see errors)");
        }
        render();
    }

    // ===================================================
    //   PANEL
    // ===================================================
    var panel = null;
    var actionsEl = null;
    var stateEl = null;
    var errorsEl = null;
    var notesEl = null;
    var jsonEl = null;
    var copyBtn = null;
    var isOpen = false;
    var refreshTimer = null;

    var CSS = [
        "#dev-panel{position:fixed;top:50%;left:50%;transform:translate(-50%,-50%);",
        "z-index:99999;display:none;width:min(880px,94vw);max-height:92vh;overflow-y:auto;",
        "background:rgba(0,0,0,0.97);border:2px solid var(--sig-cyan,#00E5FF);border-radius:10px;",
        "padding:14px 18px 16px;box-shadow:0 0 34px rgba(0,229,255,0.28);",
        "font-family:var(--font-ui,'Courier New'),monospace;font-size:14px;",
        "color:var(--phos-mid,#8FA89C);letter-spacing:0;text-align:left;line-height:1.5;}",
        "#dev-panel.dv-open{display:block;}",
        "#dev-panel .dv-head{display:flex;align-items:center;gap:12px;margin-bottom:4px;}",
        "#dev-panel .dv-title{font-family:var(--font-display,'Courier New'),monospace;",
        "font-size:12px;letter-spacing:2px;color:var(--sig-cyan,#00E5FF);}",
        "#dev-panel .dv-hint{margin-left:auto;font-size:12px;color:var(--phos-dim,#2E3A34);}",
        "#dev-panel .dv-x{cursor:pointer;color:var(--sig-magenta,#FF2E88);font-size:13px;",
        "background:none;border:none;font-family:inherit;padding:2px 4px;}",
        "#dev-panel h4{margin:14px 0 6px;font-size:11px;letter-spacing:2px;font-weight:normal;",
        "color:var(--phos-dim,#2E3A34);text-transform:uppercase;}",
        "#dev-panel .dv-acts{display:flex;flex-wrap:wrap;gap:6px;}",
        "#dev-panel .dv-btn{font-family:inherit;font-size:13px;letter-spacing:1px;cursor:pointer;",
        "background:transparent;color:var(--sig-cyan,#00E5FF);",
        "border:1px solid var(--sig-cyan,#00E5FF);padding:5px 11px;border-radius:4px;",
        "line-height:1.25;text-align:left;}",
        "#dev-panel .dv-btn:hover{background:rgba(0,229,255,0.16);}",
        "#dev-panel .dv-btn.dv-danger{color:var(--sig-magenta,#FF2E88);",
        "border-color:var(--sig-magenta,#FF2E88);}",
        "#dev-panel .dv-btn.dv-danger:hover{background:rgba(255,46,136,0.16);}",
        "#dev-panel .dv-btn .dv-sub{display:block;font-size:10px;",
        "color:var(--phos-dim,#2E3A34);letter-spacing:0;}",
        "#dev-panel pre{margin:0;font-family:var(--font-ui,'Courier New'),monospace;",
        "font-size:13px;white-space:pre-wrap;word-break:break-word;color:var(--phos-hot,#E8FFF4);}",
        "#dev-panel pre.dv-err{color:var(--sig-magenta,#FF2E88);max-height:170px;overflow-y:auto;}",
        "#dev-panel pre.dv-note{color:var(--sig-amber,#FFB000);max-height:120px;overflow-y:auto;}",
        // pre.dv-quiet, not .dv-quiet: it has to out-specify pre.dv-err, or a
        // clean error pane reads as an alarming wall of magenta saying
        // nothing is wrong.
        "#dev-panel .dv-quiet,#dev-panel pre.dv-quiet{color:var(--phos-dim,#2E3A34);}",
        "#dev-panel textarea{width:100%;height:80px;box-sizing:border-box;background:#000;",
        "color:var(--phos-mid,#8FA89C);border:1px solid var(--phos-dim,#2E3A34);border-radius:5px;",
        "font-family:monospace;font-size:11px;padding:7px;resize:vertical;}",
        "#dev-panel .dv-foot{display:flex;gap:9px;align-items:center;margin-top:9px;}"
    ].join("");

    function heading(text) {
        var h = document.createElement("h4");
        h.textContent = text;
        return h;
    }

    function mkButton(label, fn, sub, danger) {
        var b = document.createElement("button");
        b.className = "dv-btn" + (danger ? " dv-danger" : "");
        b.appendChild(document.createTextNode(label));
        if (sub) {
            var s = document.createElement("span");
            s.className = "dv-sub";
            s.textContent = sub;
            b.appendChild(s);
        }
        b.addEventListener("click", fn, listenOpts);
        return b;
    }

    function buildPanel() {
        if (panel) return;

        var style = document.createElement("style");
        style.id = "dev-panel-style";
        style.textContent = CSS;
        document.head.appendChild(style);

        panel = document.createElement("div");
        panel.id = "dev-panel";

        var head = document.createElement("div");
        head.className = "dv-head";
        var title = document.createElement("span");
        title.className = "dv-title";
        title.textContent = "DEV TOOLS — " + String(cfg.game).toUpperCase();
        var hint = document.createElement("span");
        hint.className = "dv-hint";
        hint.textContent = "L+G or ESC to close";
        var x = document.createElement("button");
        x.className = "dv-x";
        x.textContent = "[X]";
        x.addEventListener("click", close, listenOpts);
        head.appendChild(title);
        head.appendChild(hint);
        head.appendChild(x);
        panel.appendChild(head);

        actionsEl = document.createElement("div");
        actionsEl.className = "dv-acts";
        panel.appendChild(heading("Actions"));
        panel.appendChild(actionsEl);

        stateEl = document.createElement("pre");
        panel.appendChild(heading("State"));
        panel.appendChild(stateEl);

        errorsEl = document.createElement("pre");
        errorsEl.className = "dv-err";
        panel.appendChild(heading("Errors & warnings"));
        panel.appendChild(errorsEl);

        notesEl = document.createElement("pre");
        notesEl.className = "dv-note";
        panel.appendChild(heading("Activity"));
        panel.appendChild(notesEl);

        jsonEl = document.createElement("textarea");
        jsonEl.readOnly = true;
        jsonEl.spellcheck = false;
        panel.appendChild(heading("Payload"));
        panel.appendChild(jsonEl);

        var foot = document.createElement("div");
        foot.className = "dv-foot";
        copyBtn = mkButton("COPY", copy);
        foot.appendChild(copyBtn);
        foot.appendChild(mkButton("CLEAR LOG", function () {
            errors.length = 0;
            notes.length = 0;
            render();
        }));
        var tip = document.createElement("span");
        tip.className = "dv-quiet";
        tip.style.fontSize = "12px";
        tip.textContent = "paste this into the chat";
        foot.appendChild(tip);
        panel.appendChild(foot);

        document.body.appendChild(panel);
        buildActions();
    }

    function buildActions() {
        if (!actionsEl) return;
        actionsEl.innerHTML = "";
        if (!cfg.actions.length) {
            var none = document.createElement("span");
            none.className = "dv-quiet";
            none.textContent = "no actions registered";
            actionsEl.appendChild(none);
            return;
        }
        cfg.actions.forEach(function (action) {
            actionsEl.appendChild(mkButton(
                action.label || "?",
                function () { runAction(action); },
                action.hint,
                !!action.danger
            ));
        });
    }

    // ===================================================
    //   RENDER
    // ===================================================
    function reportRows() {
        if (!cfg.report) return [];
        try {
            var r = cfg.report();
            if (typeof r === "string") return [["", r]];
            return Array.isArray(r) ? r : [];
        } catch (e) {
            pushError("report", e && e.message ? e.message : String(e));
            return [["report", "THREW — see errors"]];
        }
    }

    function pad(s, n) {
        s = String(s);
        while (s.length < n) s += " ";
        return s;
    }

    function stateText(rows) {
        if (!rows.length) return "(this game registered no report)";
        var wide = 0;
        for (var i = 0; i < rows.length; i++) wide = Math.max(wide, String(rows[i][0]).length);
        return rows.map(function (r) {
            return pad(r[0], wide) + "  " + String(r[1]);
        }).join("\n");
    }

    function errorText() {
        if (!errors.length) return "clean — nothing thrown or warned since load";
        return errors.map(function (e) {
            return clockOf(e.at) + " [" + e.kind + "] " + e.text +
                   (e.count > 1 ? "  (x" + e.count + ")" : "");
        }).join("\n");
    }

    function noteText() {
        if (!notes.length) return "nothing yet";
        return notes.map(function (n) { return clockOf(n.at) + "  " + n.text; }).join("\n");
    }

    function render() {
        if (!panel) return;
        var rows = reportRows();
        stateEl.textContent = stateText(rows);
        errorsEl.textContent = errorText();
        errorsEl.className = "dv-err" + (errors.length ? "" : " dv-quiet");
        notesEl.textContent = noteText();

        var extra = null;
        if (cfg.payload) {
            try { extra = cfg.payload(); }
            catch (e) { extra = { payloadError: e && e.message ? e.message : String(e) }; }
        }
        var flat = {};
        rows.forEach(function (r) { if (r[0]) flat[String(r[0])] = r[1]; });

        // The textarea is the transfer mechanism, for the same reason Glass
        // City's run log used one: a page opened by double-click cannot POST
        // anywhere, so select-all-and-copy is what actually works everywhere.
        try {
            jsonEl.value = JSON.stringify({
                game: cfg.game,
                at: new Date().toISOString(),
                url: location.href,
                state: flat,
                errors: errors,
                activity: notes,
                extra: extra
            });
        } catch (e) {
            jsonEl.value = '{"error":"payload would not serialise"}';
        }
    }

    function copy() {
        if (!jsonEl) return;
        try { jsonEl.focus(); jsonEl.select(); } catch (e) { /* ignore */ }
        try {
            if (global.navigator && navigator.clipboard && navigator.clipboard.writeText) {
                navigator.clipboard.writeText(jsonEl.value);
                copyBtn.firstChild.nodeValue = "COPIED";
                trackTimeout(function () { copyBtn.firstChild.nodeValue = "COPY"; }, 1400);
                return;
            }
        } catch (e) { /* fall through to execCommand */ }
        try {
            document.execCommand("copy");
            copyBtn.firstChild.nodeValue = "COPIED";
            trackTimeout(function () { copyBtn.firstChild.nodeValue = "COPY"; }, 1400);
        } catch (e) {
            copyBtn.firstChild.nodeValue = "CTRL+C";
        }
    }

    // ===================================================
    //   OPEN / CLOSE
    // ===================================================
    function open() {
        if (isOpen) return;
        buildPanel();
        isOpen = true;
        panel.classList.add("dv-open");
        // The game must let go of whatever was held when the panel came up.
        // Without this a player who was walking east opens the panel and comes
        // back to a character that has been walking into a wall the whole
        // time — which is why every onOpen below clears the game's key state.
        held.clear();
        if (cfg.onOpen) {
            try { cfg.onOpen(); }
            catch (e) { pushError("onOpen", String((e && e.message) || e)); }
        }
        render();
        // A value that moves while you read it should be visibly moving; a
        // frozen readout is how you talk yourself into believing a live bug
        // is fixed.
        refreshTimer = trackInterval(function () { if (isOpen) render(); }, 500);
    }

    function close() {
        if (!isOpen) return;
        isOpen = false;
        if (panel) panel.classList.remove("dv-open");
        if (refreshTimer) { clearTracked(refreshTimer); refreshTimer = null; }
        if (cfg.onClose) {
            try { cfg.onClose(); }
            catch (e) { pushError("onClose", String((e && e.message) || e)); }
        }
    }

    function toggle() { if (isOpen) close(); else open(); }

    // ===================================================
    //   THE L+G GATE
    // ===================================================
    // Both keys down at once, which is a gesture no game in this repo asks for
    // by accident — with ONE exception, and it is why armedWhen exists at all.
    // 4D Pong's SEAT_KEYS give KeyG to the TOP seat's in-out and KeyL to the
    // BOTTOM seat's move, so in 3P and 4P two different people at one desk
    // hold exactly these two keys as ordinary play. A dwell timer does not fix
    // that (those keys are held for seconds at a time), so that game supplies
    // a predicate instead and the combo simply is not armed while both of
    // those seats are live humans mid-rally. See DEV_TOOLS_PLAN.md.
    var held = new Set();

    function keyId(e) {
        if (e.code === "KeyL" || e.code === "KeyG") return e.code;
        var k = (e.key || "").toLowerCase();
        if (k === "l") return "KeyL";
        if (k === "g") return "KeyG";
        return null;
    }

    function armed() {
        if (!registered) return false;
        if (!cfg.armedWhen) return true;
        try { return !!cfg.armedWhen(); }
        catch (e) { pushError("armedWhen", String((e && e.message) || e)); return false; }
    }

    // The nodeType test is not paranoia. Node.contains() THROWS a TypeError on
    // anything that is not a Node, and an event dispatched at `window` (which
    // is what any synthetic dispatch or a test harness produces) has
    // e.target === window. Since this is the first line of the keydown
    // handler, that throw took the whole handler with it: the panel stopped
    // swallowing keys and stopped closing on Escape, while still LOOKING open.
    // Caught 2026-09-07 by driving the panel from the browser rather than
    // reading the code and believing it.
    function inPanel(target) {
        if (!panel || !target || typeof target.nodeType !== "number") return false;
        return panel.contains(target);
    }

    global.addEventListener("keydown", function (e) {
        // Typing inside the payload textarea must not also drive the game --
        // without this, selecting the JSON and pressing L rewrites it, and
        // WASD walks the player around behind the panel. Swallowed rather than
        // merely ignored: the game's own listener is on window too, so
        // returning early here would still let every keystroke through to it.
        if (inPanel(e.target)) {
            if (e.key === "Escape") close();
            e.stopImmediatePropagation();
            return;
        }

        if (e.repeat) {
            // A repeat still has to be swallowed while the panel is up, or a
            // held key walks the player around behind the overlay.
            if (isOpen) e.stopImmediatePropagation();
            return;
        }

        var id = keyId(e);
        if (id) {
            held.add(id);
            if (held.has("KeyL") && held.has("KeyG") && (isOpen || armed())) {
                e.preventDefault();
                e.stopImmediatePropagation();
                toggle();
                return;
            }
        }

        if (!isOpen) return;

        if (e.key === "Escape") { close(); e.preventDefault(); }
        // Everything else is swallowed while the panel is up: it is a modal,
        // and a modal that lets WASD through is a modal you cannot read.
        e.stopImmediatePropagation();
    }, listenOpts);

    // keyup is DELIBERATELY never swallowed, even while the panel is open.
    // Swallowing it is how a key gets stuck down: the game saw the keydown
    // before the panel opened and would then never see the matching release.
    global.addEventListener("keyup", function (e) {
        var id = keyId(e);
        if (id) held.delete(id);
    }, listenOpts);

    // A held key with the window unfocused would otherwise stay in the set
    // forever, and the next single press of the other key opens the panel.
    global.addEventListener("blur", function () { held.clear(); }, listenOpts);

    // ===================================================
    //   PUBLIC
    // ===================================================
    var DEVTOOLS = {
        init: init,
        note: note,
        open: open,
        close: close,
        toggle: toggle,
        isOpen: function () { return isOpen; },
        refresh: function () { if (isOpen) render(); },
        // So a game can put something in the same buffer the panel shows
        // without having to route it through console.error.
        record: function (text) { pushError("game", String(text)); if (isOpen) render(); },
        destroy: function () {
            close();
            abortCtl.abort();
            timeoutIds.forEach(clearTimeout); timeoutIds.clear();
            intervalIds.forEach(clearInterval); intervalIds.clear();
            if (panel && panel.parentNode) panel.parentNode.removeChild(panel);
            panel = null;
        }
    };

    global.DEVTOOLS = DEVTOOLS;
})(typeof window !== "undefined" ? window : this);
