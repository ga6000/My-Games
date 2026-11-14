/**
 * Glass City Escape — the hub session (added 2026-11-13).
 *
 * The game already keeps a score (gcScore: cores, blips, hearts banked at
 * the exit). This file only reports it. A run ends on a death, as always;
 * in a session it also ends at GC_ROUND_MS so one strong runner cannot
 * keep the room waiting, and reaching that mark alive counts as cleared.
 *
 * The score is NOT yet on the hub scale (AESTHETIC_GUIDE.md 4.13): a good
 * run here is a few thousand, not 25,000. Placement points make a session
 * fair anyway; rescaling means a fresh leaderboard id and is left for a
 * tuning pass.
 *
 * Classic script in the game's shared global scope. Declarations only.
 */
"use strict";

const GC_ROUND_MS = 300000;
let gcPartyDone = false;

// A run just ended. True when the hub's card has taken over the screen.
function gcPartyEnd(cleared) {
    if (gcPartyDone) return true;
    if (typeof PARTY === "undefined" || !PARTY.wanted()) return false;
    gcPartyDone = !!PARTY.finish({
        score: typeof HUBSCORE !== "undefined" ? HUBSCORE.snap(gcScore) : gcScore,
        cleared: !!cleared,
        game: "glass-city-escape"
    });
    if (gcPartyDone) {
        const box = document.getElementById("message-box");
        if (box) box.style.display = "none";
        if (typeof HUBSCORE !== "undefined") HUBSCORE.hudHide();
    }
    return gcPartyDone;
}

// Once a frame, from gameLoop().
function gcPartyTick() {
    if (gcPartyDone || typeof PARTY === "undefined" || !PARTY.active()) return;
    PARTY.live(gcScore);
    const left = PARTY.timeLeft(GC_ROUND_MS);
    if (left === null) return;
    // The last half minute is counted down where everyone can see it.
    if (left <= 30000 && typeof HUBSCORE !== "undefined") {
        HUBSCORE.hud({ game: "glass-city-escape", score: gcScore, label: "0:" + String(Math.ceil(left / 1000)).padStart(2, "0") });
    }
    if (left <= 0) {
        gameRunning = false;
        gcAudioSilence();
        submitRunToLeaderboard();
        gcPartyEnd(true);
    }
}
