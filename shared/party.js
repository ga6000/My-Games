/*
 * shared/party.js — a game's side of the hub party session.
 *
 * Classic script, one global (`PARTY`). Load it after mp-core.js.
 *
 *     <script src="../shared/party.js"></script>
 *     PARTY.live(score);                                // now and then, while playing
 *     if (PARTY.finish({ score: 18400, cleared: true })) return;   // the round is over
 *
 * WHAT A PARTY SESSION IS
 * X games in a row for one room code, a standings table between them, one
 * winner at the end (HUB_1_0_PLAN.md Phase 7). The hub starts it; the server
 * keeps it (gyro-space-server "PARTY SESSION"), because every game is its own
 * page and something has to remember the standings across the navigation.
 *
 * A GAME'S WHOLE JOB is to report this player's own score for the round.
 * The server ranks the reports and pays placement points (10 / 7 / 5 / 3,
 * plus 2 each when anyone reports `cleared`). All hub games are co-op
 * against the game, so this is how one victor comes out of a PvE session:
 * you clear it together and race each other for score inside it.
 *
 * OUTSIDE A SESSION EVERYTHING HERE IS A NO-OP. active() is false, live()
 * sends nothing and finish() returns false, so a game's own game-over screen
 * and restart flow are untouched. That is also the file:// and solo path.
 *
 * AFTER finish() this file owns the screen: a result card (waiting for the
 * others, then the round's placements and the session standings), then back
 * to the hub. The game should stop taking input and not restart.
 */
(function (global) {
    "use strict";

    var LIVE_EVERY_MS = 2000;
    var RETURN_AFTER_S = 12;        // the result card's countdown to the hub
    var GIVE_UP_MS = 25000;         // no result from the server: offer the hub anyway

    var session = null;
    var baseline = -1;              // rounds already finished when this game began
    var finished = false;
    var sentFinal = null;
    var resultShown = false;
    var card = null;
    var styled = false;
    var timers = [];
    var listeners = [];
    var hubHref = null;

    function now() { return (typeof performance !== "undefined" ? performance.now() : Date.now()); }

    function track(id) { timers.push(id); return id; }
    function clearTimers() {
        for (var i = 0; i < timers.length; i++) { clearTimeout(timers[i]); clearInterval(timers[i]); }
        timers = [];
    }

    // The hub is one folder up from shared/, wherever the game itself lives.
    function hubUrl() {
        if (hubHref) return hubHref;
        var base = "../index.html";
        try {
            var scripts = document.getElementsByTagName("script");
            for (var i = 0; i < scripts.length; i++) {
                var src = scripts[i].src || "";
                if (/shared\/party\.js(\?|$)/.test(src)) { base = src.replace(/shared\/party\.js.*$/, "index.html"); break; }
            }
            // Keep a ?server= override, so a local test stays on its server.
            var sv = new URLSearchParams(global.location.search).get("server");
            if (sv) base += "?server=" + encodeURIComponent(sv);
        } catch (e) { /* the relative default is right for every game folder */ }
        hubHref = base;
        return base;
    }

    function active() {
        return !!(session && !finished && session.current);
    }

    function inSession() {
        return finished || (!!session && !!session.current);
    }

    // Opened from the hub board (the hub adds hub=1 to every link). Such a
    // game always ends by going back to the board, session or not.
    function fromHub() {
        try { return new URLSearchParams(global.location.search).get("hub") === "1"; }
        catch (e) { return false; }
    }

    // Should the game end its round through finish()? True in a session's
    // round, and for any game the hub opened.
    function wanted() {
        return !finished && (active() || fromHub());
    }

    // From the URL, so a game can decide before the socket is even open
    // (the hub adds party=1 to the link when a session is running).
    function expected() {
        try { return new URLSearchParams(global.location.search).get("party") === "1"; }
        catch (e) { return false; }
    }

    function onSession(s) {
        var had = session;
        session = s || null;
        if (session && baseline < 0 && session.current) baseline = session.rounds.length;
        if (!session && finished) { showGiveUp("THE PARTY WAS ENDED"); return; }
        if (finished && session && baseline >= 0 && session.rounds.length > baseline && !resultShown) {
            showResult();
        } else if (finished && !resultShown) {
            renderWaiting();
        }
        if (!had && session) notify();
    }

    function notify() {
        for (var i = 0; i < listeners.length; i++) {
            try { listeners[i](session); } catch (e) { console.error("PARTY listener", e); }
        }
    }

    function send(score, cleared, final) {
        if (typeof MP === "undefined" || !MP.sendServer) return false;
        return MP.sendServer({
            type: "session-report",
            score: Math.max(0, Math.round(Number(score) || 0)),
            cleared: !!cleared,
            final: !!final
        });
    }

    function label() {
        if (!session || baseline < 0) return "";
        return session.mode === "story"
            ? "STORY PARTY · GAME " + (baseline + 1) + " OF " + session.total
            : "FREE PLAY · GAME " + (baseline + 1);
    }

    function live(score) {
        if (!active()) return false;
        if (typeof MP !== "undefined" && MP.canSend && !MP.canSend("party-live", LIVE_EVERY_MS)) return false;
        return send(score, false, false);
    }

    function finish(result) {
        if (finished) return true;
        result = result || {};
        if (!active()) {
            // No round to report to (offline, a game that does not score,
            // or no session at all). Opened from the hub it still ends the
            // same way: the score, then back to the board.
            if (!fromHub()) return false;
            finished = true;
            sentFinal = { score: Math.max(0, Math.round(Number(result.score) || 0)), cleared: !!result.cleared };
            showLocal(result.game);
            return true;
        }
        finished = true;
        sentFinal = { score: Math.max(0, Math.round(Number(result.score) || 0)), cleared: !!result.cleared };
        send(sentFinal.score, sentFinal.cleared, true);
        // A socket that dropped at the wrong moment: keep offering the score
        // until the result comes back. The server ignores repeats.
        track(setInterval(function () {
            if (!resultShown && sentFinal) send(sentFinal.score, sentFinal.cleared, true);
        }, 3000));
        track(setTimeout(function () {
            if (!resultShown) showGiveUp("NO ANSWER FROM THE GAME SERVER");
        }, GIVE_UP_MS));
        renderWaiting();
        return true;
    }

    // ---- the round clock, for games with no natural end ----
    // Measured from the server's launch, so every client and a late joiner
    // agree on when the round stops. Returns ms left, or null outside a session.
    var localStartAt = 0;
    function timeLeft(roundMs, graceMs) {
        if (!session || !session.current || typeof MP === "undefined") {
            // Opened from the hub with no round on the server: the same
            // clock, kept locally from the first time the game asks.
            if (!fromHub() || finished) return null;
            if (!localStartAt) localStartAt = now();
            return Math.max(0, roundMs - (now() - localStartAt));
        }
        var elapsed = session.current.elapsedMs + (now() - (MP.sessionAt || now()));
        return Math.max(0, roundMs + (graceMs || 0) - elapsed);
    }

    // ---- the card ----
    function ensureCard() {
        if (card && card.isConnected) return card;
        if (!styled) {
            styled = true;
            var css = document.createElement("style");
            css.setAttribute("data-party", "");
            css.textContent =
                "#partyCard{position:fixed;inset:0;z-index:5000;display:flex;align-items:center;justify-content:center;" +
                "background:rgba(0,0,0,.88);font-family:'VT323','Courier New',monospace;color:#E8FFF4;text-transform:uppercase}" +
                "#partyCard .pc-box{border:4px solid #00E5FF;box-shadow:0 0 0 4px #000,0 0 0 6px #2E3A34;background:#000;" +
                "padding:20px 26px;width:min(600px,94vw);max-height:94vh;overflow-y:auto;text-align:center}" +
                "#partyCard .pc-kick{font-size:18px;letter-spacing:4px;color:#00E5FF;margin-bottom:8px}" +
                "#partyCard h2{font-family:'Press Start 2P','VT323',monospace;font-size:18px;margin:0 0 10px;color:#FFB000;letter-spacing:1px;font-weight:normal}" +
                "#partyCard .pc-sub{font-size:19px;letter-spacing:2px;color:#8FA89C;margin-bottom:12px}" +
                "#partyCard .pc-score{font-family:'Press Start 2P','VT323',monospace;font-size:clamp(22px,6vmin,40px);color:#E8FFF4;" +
                "text-shadow:4px 4px 0 #6E1F35;margin:6px 0 4px}" +
                "#partyCard .pc-best{font-size:20px;letter-spacing:2px;color:#8FA89C;margin-bottom:16px}" +
                "#partyCard .pc-best b{font-weight:normal;color:#FFB000}" +
                "#partyCard .pc-new{color:#FFB000;animation:partyBlink .5s steps(2,start) infinite}" +
                "#partyCard table{width:100%;border-collapse:collapse;font-size:22px;margin:0 0 14px}" +
                "#partyCard td,#partyCard th{padding:3px 6px;text-align:left;white-space:nowrap}" +
                "#partyCard th{color:#00E5FF;font-weight:normal;font-size:16px;letter-spacing:2px;border-bottom:2px solid #00E5FF}" +
                "#partyCard td.n,#partyCard th.n{text-align:right}" +
                "#partyCard tr.me td{background:rgba(0,229,255,.16)}" +
                "#partyCard tr.pc-rev{visibility:hidden;animation:partyRev .01s linear forwards;animation-delay:calc(var(--i)*.28s + .3s)}" +
                "@keyframes partyRev{to{visibility:visible}}" +
                "#partyCard .pc-dot{display:inline-block;width:10px;height:10px;margin-right:8px;vertical-align:middle}" +
                "#partyCard .pc-meter{display:inline-block;vertical-align:middle;width:clamp(36px,12vw,110px);height:8px;margin-left:10px;background:#2E3A34}" +
                "#partyCard .pc-meter span{display:block;height:100%}" +
                "#partyCard .pc-gain{color:#FFB000;font-family:'Press Start 2P','VT323',monospace;font-size:13px}" +
                "#partyCard .pc-row{display:flex;gap:10px;justify-content:center;flex-wrap:wrap}" +
                "#partyCard button{font-family:'Press Start 2P','VT323',monospace;font-size:11px;color:#000;background:#FFB000;border:2px solid #FFB000;" +
                "padding:11px 16px;cursor:pointer;box-shadow:4px 4px 0 #2E3A34;text-transform:uppercase}" +
                "#partyCard button.pc-quiet{background:transparent;color:#00E5FF;border-color:#00E5FF;box-shadow:none}" +
                "#partyCard button:hover,#partyCard button:focus{background:#E8FFF4;border-color:#E8FFF4;color:#000;outline:0}" +
                "#partyCard .pc-wait{font-size:20px;letter-spacing:2px;line-height:1.5;color:#E8FFF4}" +
                "#partyCard .pc-blink{animation:partyBlink 1s steps(2,start) infinite}" +
                "@keyframes partyBlink{to{visibility:hidden}}" +
                "@media (prefers-reduced-motion:reduce){#partyCard tr.pc-rev{visibility:visible;animation:none}}";
            document.head.appendChild(css);
        }
        card = document.createElement("div");
        card.id = "partyCard";
        card.setAttribute("role", "dialog");
        card.setAttribute("aria-live", "polite");
        document.body.appendChild(card);
        return card;
    }

    function esc(s) {
        return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
            return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
        });
    }

    function fmt(n) {
        return (global.HUBSCORE && HUBSCORE.format) ? HUBSCORE.format(n) : String(Math.round(n));
    }

    function ordinal(n) { return n === 1 ? "1ST" : n === 2 ? "2ND" : n === 3 ? "3RD" : n + "TH"; }

    function myName() { return (typeof MP !== "undefined" && MP.selfName) || ""; }

    function pad6(n) {
        return (global.HUBSCORE && HUBSCORE.pad6) ? HUBSCORE.pad6(n) : fmt(n);
    }

    // The big number counts up in steps, the way a cabinet tallies a bonus.
    function tally(id, to) {
        var el = document.getElementById(id);
        if (!el) return;
        var steps = to > 0 ? 14 : 0, i = 0;
        el.textContent = pad6(0);
        if (!steps) return;
        var t = track(setInterval(function () {
            i += 1;
            var node = document.getElementById(id);
            if (!node) { clearInterval(t); return; }
            node.textContent = pad6(i >= steps ? to : Math.floor(to * i / steps / 10) * 10);
            if (global.SFX && global.SFX.blip) { try { global.SFX.blip(520 + i * 40); } catch (e) { /* silent */ } }
            if (i >= steps) clearInterval(t);
        }, 70));
    }

    function renderWaiting() {
        if (resultShown) return;
        var el = ensureCard();
        var who = (session && session.current && session.current.reported) || [];
        var fresh = !document.getElementById("pcWaitScore");
        el.innerHTML =
            "<div class='pc-box'><div class='pc-kick'>" + esc(label() || "ROUND OVER") + "</div><h2>ROUND OVER</h2>" +
            "<div class='pc-sub'>YOUR SCORE</div>" +
            "<div class='pc-score' id='pcWaitScore'>" + pad6(sentFinal ? sentFinal.score : 0) + "</div>" +
            "<div class='pc-wait'><span class='pc-blink'>WAITING FOR THE OTHERS</span><br>" +
            (who.length ? "IN: " + who.map(esc).join(", ") : "&nbsp;") + "</div></div>";
        if (fresh && sentFinal) tally("pcWaitScore", sentFinal.score);
    }

    function goHub() {
        clearTimers();
        global.location.href = hubUrl();
    }

    function hubButton(text) {
        return "<button type='button' id='partyHubBtn'>" + text + "</button>";
    }

    function wireButton() {
        var b = document.getElementById("partyHubBtn");
        if (!b) return;
        b.addEventListener("click", goHub);
        try { b.focus(); } catch (e) { /* not focusable yet */ }
    }

    function countdownToHub(seconds) {
        var left = seconds;
        track(setInterval(function () {
            left -= 1;
            var c = document.getElementById("partyCount");
            if (c) c.textContent = Math.max(0, left);
            if (left <= 0) goHub();
        }, 1000));
    }

    function showGiveUp(why) {
        if (resultShown) return;
        resultShown = true;
        ensureCard().innerHTML =
            "<div class='pc-box'><h2>ROUND OVER</h2><div class='pc-sub'>" + esc(why) + "</div>" +
            "<div class='pc-score'>" + pad6(sentFinal ? sentFinal.score : 0) + "</div>" +
            "<div class='pc-row'>" + hubButton("GAME SELECT") + "</div></div>";
        wireButton();
    }

    // No session round behind this game: the score, the best on this
    // machine, and the way back to the board.
    function showLocal(game) {
        resultShown = true;
        var score = sentFinal ? sentFinal.score : 0;
        var key = game || gameFromPath();
        var before = 0, bestNow = score;
        try { before = Number(global.localStorage.getItem("hubscore_best_" + key)) || 0; } catch (e) { /* no storage */ }
        if (global.HUBSCORE && HUBSCORE.best) bestNow = HUBSCORE.best(key, score);
        var isNew = score > 0 && score >= bestNow && score > before;
        ensureCard().innerHTML =
            "<div class='pc-box'><div class='pc-kick'>" + (sentFinal && sentFinal.cleared ? "CLEARED" : "GAME OVER") + "</div>" +
            "<h2>YOUR SCORE</h2>" +
            "<div class='pc-score' id='pcLocalScore'>" + pad6(score) + "</div>" +
            "<div class='pc-best'>" + (isNew ? "<span class='pc-new'>NEW BEST</span>" : "BEST <b>" + pad6(Math.max(before, bestNow)) + "</b>") + "</div>" +
            "<div class='pc-row'>" + hubButton("GAME SELECT <span id='partyCount'>" + RETURN_AFTER_S + "</span>") +
            "<button type='button' class='pc-quiet' id='partyAgainBtn'>PLAY AGAIN</button></div></div>";
        wireButton();
        var again = document.getElementById("partyAgainBtn");
        if (again) again.addEventListener("click", function () { clearTimers(); global.location.reload(); });
        tally("pcLocalScore", score);
        countdownToHub(RETURN_AFTER_S);
    }

    function gameFromPath() {
        try {
            var parts = global.location.pathname.split("/").filter(Boolean);
            return parts.length > 1 ? parts[parts.length - 2] : "game";
        } catch (e) { return "game"; }
    }

    function showResult() {
        resultShown = true;
        var round = session.rounds[baseline];
        var me = myName();
        var rows = round.results.map(function (r, i) {
            return "<tr class='pc-rev" + (r.name === me ? " me" : "") + "' style='--i:" + i + "'><td>" + ordinal(r.place) + "</td>" +
                "<td><span class='pc-dot' style='background:" + esc(r.color) + "'></span>" + esc(r.name) + "</td>" +
                "<td class='n'>" + fmt(r.score) + "</td>" +
                "<td class='n pc-gain'>+" + (r.points + r.bonus) + "</td></tr>";
        }).join("");
        var top = Math.max(1, session.standings.length ? session.standings[0].points : 1);
        var stand = session.standings.map(function (r, i) {
            return "<tr class='pc-rev" + (r.name === me ? " me" : "") + "' style='--i:" + (i + round.results.length + 1) + "'><td>" + ordinal(r.place) + "</td>" +
                "<td><span class='pc-dot' style='background:" + esc(r.color) + "'></span>" + esc(r.name) +
                "<span class='pc-meter'><span style='width:" + Math.round(100 * r.points / top) + "%;background:" + esc(r.color) + "'></span></span></td>" +
                "<td class='n'>" + r.points + " PTS</td></tr>";
        }).join("");
        var n = baseline + 1;
        var head = session.done ? "FINAL GAME" : "GAME " + n + (session.total ? " OF " + session.total : "");
        ensureCard().innerHTML =
            "<div class='pc-box'><div class='pc-kick'>" + (session.mode === "story" ? "STORY PARTY" : "FREE PLAY") + "</div>" +
            "<h2>" + head + "</h2>" +
            "<div class='pc-sub'>" + (round.cleared ? "CLEARED TOGETHER · +" + session.clearBonus + " EACH" : "PLACEMENT POINTS 10 / 7 / 5 / 3") + "</div>" +
            "<table><tr><th></th><th>PLAYER</th><th class='n'>SCORE</th><th class='n'>PARTY</th></tr>" + rows + "</table>" +
            "<table><tr><th></th><th>STANDINGS</th><th class='n'></th></tr>" + stand + "</table>" +
            "<div class='pc-row'>" + hubButton((session.done ? "SEE THE WINNER" : "GAME SELECT") + " <span id='partyCount'>" + RETURN_AFTER_S + "</span>") + "</div>" +
            "</div>";
        wireButton();
        countdownToHub(RETURN_AFTER_S);
    }

    function destroy() {
        clearTimers();
        if (card && card.parentNode) card.parentNode.removeChild(card);
        card = null;
        session = null;
        baseline = -1;
        finished = false;
        sentFinal = null;
        resultShown = false;
        localStartAt = 0;
        listeners = [];
    }

    // mp-core may have received the snapshot before this file loaded.
    if (typeof MP !== "undefined" && MP.session) onSession(MP.session);

    global.PARTY = {
        active: active,
        inSession: inSession,
        expected: expected,
        finished: function () { return finished; },
        session: function () { return session; },
        label: label,
        fromHub: fromHub,
        wanted: wanted,
        live: live,
        finish: finish,
        timeLeft: timeLeft,
        onChange: function (fn) { if (typeof fn === "function") listeners.push(fn); },
        onSession: onSession,       // called by mp-core
        hubUrl: hubUrl,
        destroy: destroy
    };
})(window);
