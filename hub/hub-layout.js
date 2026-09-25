// ===================================================
//   Hub — the winning game, board sizing
// ===================================================
// Split out of index.html's inline script 2026-09-04 (Pass A of
// hub/HUB_PASS_PLAN.md). The lines below were MOVED VERBATIM -- Pass A
// deliberately changed no behaviour, so that any regression could be
// attributed to the skin pass that followed rather than to the split.
//
// Classic scripts, one shared global scope, no modules (the file://
// constraint). Declarations only. applyGridShape() is load-bearing -- see HUB_LOBBY_PLAN.md 1.
"use strict";

// ===================================================
//   THE WINNING GAME
// ===================================================
// Strict plurality: the one game with MORE votes than any other. A tie
// means no winner, so the group breaks it rather than the page picking
// for them. Only the server computes it (computeLeader() in server.js),
// so no two clients can disagree about whether a spread is a tie.
//
// The lobby counts as up only once the server has answered with its
// state. An open socket isn't enough, and neither is one that was open a
// moment ago -- connectAndJoin() resets serverHasLobby on every attempt.
function lobbyOnline() {
    return !!socket && socket.readyState === WebSocket.OPEN && serverHasLobby;
}

// Without the lobby there is no group choice to show, so the "winner" is
// your own local pick and Continue becomes a solo launch. This used to be
// a local copy of the plurality rule (computeLocalLeader) that labelled a
// visibly-disabled button; HUB_LOBBY_PLAN.md §9c replaced both, because
// once tiles stopped being links that button was the only way out.
function effectiveLeader() {
    return lobbyOnline() ? serverLeaderGameId : offlinePick;
}

// The tile that is YOURS: your server-confirmed vote while the lobby is
// up, your local pick while it isn't.
function myChoice() {
    if (!lobbyOnline()) return offlinePick;
    for (const [gameId, voters] of votesByGame) {
        if (voters.has(myName)) return gameId;
    }
    return null;
}

// Who in the room still hasn't voted. Continue waits for them
// (HUB_LOBBY_PLAN.md §9e, decided 2026-09-24): the leader rule alone let
// one fast clicker reveal Continue while nobody else had said anything,
// and a Continue click is consent to THAT game -- so a room could launch
// with most of it never having expressed a preference.
//
// Keyed by name, exactly as the server keys votes and ready. People who
// are inside a GAME (presenceList) are deliberately not counted: they
// can't vote from in there, and counting them would stall every launch,
// which is the whole reason the hub has its own namespace (§3).
function pendingVoters() {
    const voted = new Set();
    votesByGame.forEach(voters => voters.forEach((color, name) => voted.add(name)));
    return Object.keys(roomMembers).filter(name => !voted.has(name));
}



// ===================================================
//   LAYOUT
// ===================================================
// Same games per page on every device -- only the SHAPE of the grid
// changes. "Page 2" therefore means the same thing to everyone in the
// room, which matters when you're telling a friend where to look. A
// per-device tile count would have put two people on genuinely different
// pages under the same page number.
let lastCols = null;
let lastDense = null;

function applyGridShape() {
    const cols = window.innerWidth >= window.innerHeight ? 3 : 2;

    // Only write when something actually changed. This runs from a
    // ResizeObserver, and an unconditional style write on every
    // observation is how you get an observer that re-triggers itself.
    if (cols !== lastCols) {
        lastCols = cols;
        tileGrid.style.setProperty("--cols", String(cols));
        tileGrid.style.setProperty("--rows", String(PAGE_SIZE / cols));
    }

    // Measured, not guessed: whether a description fits depends on the
    // height each tile actually got, which depends on the window, the
    // grid shape and the buffers all at once.
    requestAnimationFrame(() => {
        const first = tileGrid.querySelector(".tile");
        if (!first) return;
        const dense = first.getBoundingClientRect().height < 118;
        if (dense !== lastDense) {
            lastDense = dense;
            tileGrid.classList.toggle("dense", dense);
        }
        repositionRemoteCursors();
    });
}


