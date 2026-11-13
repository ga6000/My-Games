// ===================================================
//   Zombie — hub party session, score toasts, boot flow
// ===================================================
// Added 2026-11-13 (../HUB_1_0_PLAN.md Phase 7). This game's side of the
// three shared modules, in one file. Script #26, after zombie-lobby.js.
//
//   shared/hubscore.js  points float off the player as they are earned
//   shared/party.js     the run's score is the round, reported at its end
//   shared/bootflow.js  LOAD / TITLE in front, and the READY border round
//                       the attract run and ready screen this game already
//                       had (zombie-lobby.js is the model the shared ready
//                       check was copied from, so it is kept as it is)
//
// THE HUB SCALE. Kills were already on it (10 a walker to 120 an ultra: the
// horde is hundreds deep, so one kill is a CHIP, not a GRUNT). What changed
// is the big terms in zombie-game.js, which dwarfed everything: a tank is
// 1,000 (was 8,000), getting out is 10,000 (was 50,000), the round term is
// 20 x round^2 (was 50), time alive is 10 a second (was 40). Escaping still
// doubles the lot. Calibrated from one bot run; expect to tune it after a
// real session.
//
// LATE JOINERS. Unchanged: someone who arrives while a run is under way
// gets CLICK TO JOIN and drops into it. In a session they are ranked on what
// they score from there.
//
// A PARTY ROUND IS ONE RUN. The click-to-restart on the win and game-over
// cards is off inside a session; the result card takes the group back.
"use strict";

let zIntroDone = false;
let zIntroDoneAt = 0;
let zPartyLastScore = -1;       // my combat score at the last look, for the toast
let zPartyLastSilos = -1;
let zPartyLiveAt = 0;
let zPartyWinToasted = false;

function zPartyOn() {
    return typeof PARTY !== "undefined" && typeof LOBBY_ON !== "undefined" && LOBBY_ON;
}

function zPartyInSession() {
    return zPartyOn() && PARTY.inSession();
}

// The press that dismissed the title card must not also tick the ready
// square underneath it.
function zIntroBlocks() {
    return !zIntroDone || Date.now() - zIntroDoneAt < 400;
}

function zPartyMyId() {
    return players[0] ? netIdFor(players[0]) : null;
}

function zPartyToastAtPlayer(points, opts) {
    if (typeof HUBSCORE === "undefined" || !players[0]) return;
    const p = players[0];
    const s = worldToScreen(p.x + p.size / 2, p.y);
    const r = canvas.getBoundingClientRect();
    HUBSCORE.toast(
        r.left + s.x * (r.width / canvas.width) + (Math.random() - 0.5) * 40,
        r.top + s.y * (r.height / canvas.height) - 26,
        points, opts);
}

// Called when a run ends, win or lose (submitRunToLeaderboard, once a run).
function zPartyFinish() {
    if (!zPartyOn() || zDemo) return;
    const id = zPartyMyId();
    const total = id ? runScoreFor(id).total : 0;
    PARTY.finish({
        score: typeof HUBSCORE !== "undefined" ? HUBSCORE.snap(total) : total,
        cleared: !!won,
        game: "zombie"
    });
}

// Once a frame, from gameLoop().
function zPartyTick(now) {
    if (typeof BOOTFLOW !== "undefined" && typeof LOBBY_ON !== "undefined" && LOBBY_ON) {
        // Before a run nothing is live: the attract run, the ready squares.
        if (zIntroDone && lobbyBlocks()) BOOTFLOW.border(true, zDemo ? "DEMO · NOT LIVE · WAITING FOR PLAYERS" : "NOT LIVE");
        else BOOTFLOW.border(false);
    }

    if (zDemo || !gameStarted) { zPartyLastScore = -1; zPartyLastSilos = -1; zPartyWinToasted = false; return; }

    const id = zPartyMyId();
    if (!id) return;
    const row = scoreBoard[id];
    const combat = row ? (row.score || 0) : 0;
    if (zPartyLastScore >= 0 && combat > zPartyLastScore) {
        zPartyToastAtPlayer(combat - zPartyLastScore, { color: players[0].color });
    }
    zPartyLastScore = combat;

    const silos = silosFilled();
    if (zPartyLastSilos >= 0 && silos > zPartyLastSilos) {
        zPartyToastAtPlayer(SCORE_SILO * (silos - zPartyLastSilos), { big: true });
    }
    zPartyLastSilos = silos;

    if (won && !zPartyWinToasted && wonOnTrain(id)) {
        zPartyWinToasted = true;
        zPartyToastAtPlayer(SCORE_WIN, { big: true });
    }

    if (zPartyOn() && PARTY.active() && !gameOver && !won && now - zPartyLiveAt > 2000) {
        zPartyLiveAt = now;
        PARTY.live(runScoreFor(id).total);
    }
}

function zBootIntro() {
    if (typeof BOOTFLOW === "undefined" || typeof LOBBY_ON === "undefined" || !LOBBY_ON) {
        zIntroDone = true;
        return;
    }
    BOOTFLOW.intro({
        title: "ZOMBIE",
        chapter: "ACT II · SPREAD",
        tagline: "THE INSPIRED ARE AT THE GATE. FILL THE TANKS. GET OUT."
    }, function () {
        zIntroDone = true;
        zIntroDoneAt = Date.now();
    });
}

// For scripts/party-session-playtest.js: end the run now, through the real
// game-over path, the way a team wipe does.
function zPartyTestEnd() {
    triggerGameOver();
    // What updateTeamWipe sends when the host calls the room wiped.
    if (netOnline && netIsHost) MP.send({ k: "over" });
}

zBootIntro();
