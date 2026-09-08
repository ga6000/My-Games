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
// for them. The server runs this same rule and its answer wins; this
// local copy only labels the button before/without a lobby-capable
// server, and uses identical logic so the two can't disagree.
function computeLocalLeader() {
    let leader = null;
    let best = 0;
    let tied = false;

    votesByGame.forEach((voters, gameId) => {
        const count = voters.size;
        if (count === 0) return;
        if (count > best) { leader = gameId; best = count; tied = false; }
        else if (count === best) { tied = true; }
    });

    return tied ? null : leader;
}

function effectiveLeader() {
    return serverHasLobby ? serverLeaderGameId : computeLocalLeader();
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


