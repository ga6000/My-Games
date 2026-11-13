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
let lastActs = null;
let lastDense = null;

function applyGridShape() {
    // How many acts sit side by side. All five on a wide screen; three on a
    // narrow landscape one; two on a phone held upright.
    const w = window.innerWidth, h = window.innerHeight;
    const fit = w >= h ? (w >= 1000 ? 5 : 3) : 2;

    // Only act when something actually changed. This runs from a
    // ResizeObserver, and an unconditional re-render on every observation
    // is how you get an observer that re-triggers itself.
    if (fit !== lastActs) {
        lastActs = fit;
        actsPerPage = fit;
        currentPage = Math.min(currentPage, pageCount() - 1);
        renderTiles();
        renderPageDots();
        return;
    }

    // Measured, not guessed: whether a description fits depends on the
    // height each tile actually got.
    requestAnimationFrame(() => {
        const first = tileGrid.querySelector(".tile");
        if (!first) return;
        const dense = first.getBoundingClientRect().height < 96;
        if (dense !== lastDense) {
            lastDense = dense;
            tileGrid.classList.toggle("dense", dense);
        }
        renderPaths();
        repositionRemoteCursors();
    });
}



// ===================================================
//   THE SELECTOR (keyboard)
// ===================================================
// Arrow keys walk a cursor over the board the way a level select does:
// up and down inside an act, left and right between acts (and onto the next
// page of acts at the edge). Enter picks. The mouse needs none of this; the
// cursor only appears once an arrow key has been used.
let cursorGameId = null;

function cursorApply() {
    tileGrid.querySelectorAll(".tile.is-cursor").forEach(el => el.classList.remove("is-cursor"));
    if (!cursorGameId) return;
    const el = tileGrid.querySelector('.tile[data-game-id="' + cursorGameId + '"]');
    if (el) el.classList.add("is-cursor");
}

function cursorMove(dx, dy) {
    const acts = actsOnPage(currentPage);
    const cur = cursorGameId ? gameById(cursorGameId) : null;

    if (!cur || !acts.some(a => a.n === cur.act)) {
        // First press: start on your pick, the leader, or the first open tile.
        const start = myChoice() || effectiveLeader();
        const open = GAMES.find(g => acts.some(a => a.n === g.act) && !partyLockReason(g));
        const startGame = start ? gameById(start) : null;
        cursorGameId = (startGame && acts.some(a => a.n === startGame.act)) ? start
            : (open ? open.id : gamesInAct(acts[0].n)[0].id);
        cursorApply();
        return;
    }

    const col = gamesInAct(cur.act);
    const row = col.indexOf(cur);

    if (dy) {
        cursorGameId = col[(row + dy + col.length) % col.length].id;
    } else {
        const actIndex = ACTS.findIndex(a => a.n === cur.act) + dx;
        if (actIndex < 0 || actIndex >= ACTS.length) return;
        const next = gamesInAct(ACTS[actIndex].n);
        // Keep roughly the same height in the new column.
        const at = Math.round(row * (next.length - 1) / Math.max(1, col.length - 1));
        cursorGameId = next[Math.min(next.length - 1, at)].id;
        const page = Math.floor(actIndex / actsPerPage);
        if (page !== currentPage) { setPage(page); return; }
    }
    cursorApply();
}
