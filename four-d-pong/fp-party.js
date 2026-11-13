// ===================================================
//   4D Pong — hub party session, score toasts, boot flow
// ===================================================
// Added 2026-11-13 (HUB_1_0_PLAN.md Phase 7). Everything this game does for
// the three shared modules is here, so the nine files in CLAUDE.md's map
// stay what they were:
//
//   shared/hubscore.js  a goal floats "1,000" off the scorer's paddle
//   shared/party.js     the round's score is reported at match end
//   shared/bootflow.js  LOAD / TITLE, the READY border, the ready check
//
// THE HUB SCALE. This game has no score of its own (the tug IS the score),
// so the party score is built from what already happens: 1,000 a goal
// (HUBSCORE.TIER.OBJECTIVE) and 5,000 for winning the match (TIER.BOSS).
// Nothing about the tug, the win condition or the AI changes.
//
// LATE JOINERS. Someone who arrives mid-match takes a seat at once: a CPU
// seat if there is one, and a third player turns a two-way match into a
// four-way one (which restarts it, as it always has). They inherit the
// seat's goals so far. Seats are sticky as of this pass (fp-net.js
// assignSeats), so a join no longer moves anyone already playing.
"use strict";

var PONG_GOAL_PTS = 1000;
var PONG_WIN_PTS = 5000;

var pongIntroDone = false;
var pongReadyHoldUntil = 0;     // a ready check has just fired: do not reopen it

function pongSeatScore(i) {
    var s = seats[i];
    if (!s || i < 0) return 0;
    return (s.goals || 0) * PONG_GOAL_PTS + (winnerSeat === i ? PONG_WIN_PTS : 0);
}

// The seat this screen is playing: its online seat, or locally the first
// human one.
function pongMySeat() {
    if (net.on) return net.mySeat;
    for (var i = 0; i < seats.length; i++) if (seats[i] && seats[i].kind === HUMAN) return i;
    return -1;
}

function pongGoalToast(scorer) {
    if (typeof HUBSCORE === "undefined" || attractRunning) return;
    var s = seats[scorer];
    if (!s) return;
    var r = seatRect(s);
    var stage = stageEl.getBoundingClientRect();
    var owner = net.on ? net.ownerOf[scorer] : null;
    HUBSCORE.toast(stage.left + r.x + r.w / 2, stage.top + r.y + r.h / 2, PONG_GOAL_PTS, {
        color: owner ? net.colorOf[owner] : (s.kind === HUMAN ? identity.color : undefined)
    });
}

function pongReadyPlayers() {
    var out = [];
    var me = (typeof MP !== "undefined" && MP.selfId) || "solo";
    if (net.on) {
        for (var i = 0; i < 4; i++) {
            var id = net.ownerOf[i];
            if (!id) continue;
            out.push({ id: id, name: net.nameOf[id] || "PLAYER", color: net.colorOf[id], self: id === me });
        }
    }
    if (!out.length) out.push({ id: me, name: identity.name || "YOU", color: identity.color, self: true });
    return out;
}

// The ready check replaces the START button whenever the match is shared
// (online with two or more seated) or part of a party session. A lone
// local player keeps the menu, with the border round it.
function pongWantsReady() {
    if (!pongIntroDone || phase !== "menu") return false;
    if (performance.now() < pongReadyHoldUntil) return false;
    return net.on || (typeof PARTY !== "undefined" && (PARTY.expected() || PARTY.active()));
}

function pongReadyGate() {
    return typeof BOOTFLOW !== "undefined" && BOOTFLOW.readyOpen();
}

// Once a frame, from loop().
function pongPartyTick() {
    if (typeof BOOTFLOW === "undefined") return;

    var want = pongWantsReady();
    if (want && !BOOTFLOW.readyOpen()) {
        exitAttract();
        BOOTFLOW.ready({
            players: pongReadyPlayers,
            send: function (msg) { if (typeof MP !== "undefined") MP.send(msg); },
            onUnlock: initAudio,
            onStart: function () {
                pongReadyHoldUntil = performance.now() + 4000;
                // The host owns the match; a guest's screen follows its snapshot.
                if (!net.on || net.host) startMatch();
            }
        });
    } else if (!want && BOOTFLOW.readyOpen()) {
        BOOTFLOW.endReady();
    }

    if (!BOOTFLOW.readyOpen()) {
        // Menu and countdown are not live play; the demo is labelled as one.
        if (phase === "menu" && pongIntroDone) BOOTFLOW.border(true, attractRunning ? "DEMO · NOT LIVE" : "NOT LIVE · SELECT PLAYERS");
        else if (phase === "count") BOOTFLOW.border(true, "GET READY");
        else BOOTFLOW.border(false);
    }
    menuEl.hidden = (phase !== "menu") || BOOTFLOW.readyOpen() || !pongIntroDone;

    // The score strip (this game has no cabinet panel yet): points on the
    // hub scale, which the big goal digits on the field do not show.
    if (typeof HUBSCORE !== "undefined" && HUBSCORE.hud) {
        if (phase === "play" || phase === "count" || phase === "over") {
            HUBSCORE.hud({ game: "four-d-pong", score: pongSeatScore(pongMySeat()),
                           label: typeof PARTY !== "undefined" ? PARTY.label() : "" });
        } else HUBSCORE.hudHide();
    }

    if (typeof PARTY === "undefined") return;
    if (PARTY.active() && phase === "play") PARTY.live(pongSeatScore(pongMySeat()));
    // A match that ended: this seat's score is the round. PvP, so nobody
    // "clears" it. A spectator reports zero and takes last place. Outside a
    // session a match opened from the hub ends the same way (party.js).
    if (phase === "over" && PARTY.wanted()) PARTY.finish({ score: pongSeatScore(pongMySeat()), cleared: false, game: "four-d-pong" });
}

function pongInSession() {
    return typeof PARTY !== "undefined" && PARTY.inSession();
}

function pongBootIntro() {
    if (typeof BOOTFLOW === "undefined") { pongIntroDone = true; return; }
    BOOTFLOW.intro({
        title: "4D PONG",
        chapter: "ACT II · SPREAD",
        tagline: "FOUR WALLS. ONE BALL. PULL THE ROPE YOUR WAY."
    }, function (how) {
        pongIntroDone = true;
        if (how === "idle" && !net.on) enterAttract();
    });
}
