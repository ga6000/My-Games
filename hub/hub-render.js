// ===================================================
//   Hub — board, roster, cursors, screens
// ===================================================
// Split out of index.html's inline script 2026-09-04 (Pass A of
// hub/HUB_PASS_PLAN.md). The lines below were MOVED VERBATIM -- Pass A
// deliberately changed no behaviour, so that any regression could be
// attributed to the skin pass that followed rather than to the split.
//
// Classic scripts, one shared global scope, no modules (the file://
// constraint). Declarations only.
"use strict";

// ===================================================
//   RENDERING
// ===================================================
function gameHref(game) {
    // Carries identity forward into every game launched from here (the
    // countdown and the solo button), so the game knows who you are
    // without you re-entering it. Built by hand rather than via URL(),
    // which mangles relative paths under file://.
    if (!myName) return game.href;
    return game.href
        + "?name=" + encodeURIComponent(myName)
        + "&room=" + encodeURIComponent(myRoom);
}

// Rebuilding the whole page of tiles on every vote would tear down the
// DOM under the player's cursor mid-hover, and momentarily orphan every
// remote cursor anchored to a tile. Only the winning tile's highlight
// depends on the tally, so rebuild just when the winner moves; otherwise
// repaint the checkmarks in place.
let renderedLeader = null;

function syncBoard() {
    const leader = effectiveLeader();
    hubSoundLeader(leader);
    if (leader !== renderedLeader) {
        renderTiles();
        // renderTiles() rebuilds the grid and throws the attract highlight
        // away with it; re-apply rather than leaving a gap until the next step.
        attractRepaint();
    } else {
        renderAllVoteChecks();
    }
}

function renderTiles() {
    const leader = effectiveLeader();
    renderedLeader = leader;
    const games = gamesOnPage(currentPage);
    const parts = [];

    // A tile is a VOTE, not a link (HUB_LOBBY_PLAN.md §9). It used to be
    // <a href> straight into the game, so the obvious click -- "I pick
    // this one" -- skipped the vote, Continue and the ready-check
    // entirely. The only ways into a game from here are now the launch
    // countdown and the bottom bar's solo button.
    games.forEach(g => {
        parts.push(`
            <div class="tile${g.id === leader ? " is-leader" : ""}" data-game-id="${escapeAttr(g.id)}">
                <button class="vote-check" data-game-id="${escapeAttr(g.id)}" title="Vote for this game" aria-label="Vote for ${escapeAttr(g.title)}"></button>
                ${g.isNew ? '<div class="new-badge">NEW</div>' : ""}
                ${g.stamp ? `<div class="tile-stamp${g.broken ? " blocked" : ""}">${escapeHtml(g.stamp)}</div>` : ""}
                <div class="tile-icon">${g.icon}</div>
                <div class="tile-title">${escapeHtml(g.title)}</div>
                <div class="tile-desc">${escapeHtml(g.desc)}</div>
            </div>
        `);
    });

    // Empty slots keep every page's tiles the same size. Without them a
    // 5-tile last page would stretch its tiles to fill an 8-slot grid and
    // look like a different screen.
    for (let i = games.length; i < PAGE_SIZE; i++) {
        parts.push('<div class="tile tile-empty"></div>');
    }

    tileGrid.innerHTML = parts.join("");
    renderAllVoteChecks();
    applyGridShape();
}

function renderPageDots() {
    const total = pageCount();
    pageDots.innerHTML = Array.from({ length: total }, (_, i) =>
        `<button class="page-dot${i === currentPage ? " active" : ""}" data-page="${i}" aria-label="Page ${i + 1}"></button>`
    ).join("");

    pagePrev.disabled = currentPage === 0;
    pageNext.disabled = currentPage >= total - 1;
}

function setPage(page) {
    const total = pageCount();
    currentPage = Math.max(0, Math.min(total - 1, page));
    renderTiles();
    renderPageDots();
    repositionRemoteCursors();
}

function renderRoster() {
    roomCodeEl.textContent = (myRoom || "----").toUpperCase();

    const names = Object.keys(roomMembers);

    // You first, then everyone else -- your own chip shouldn't move
    // around as people come and go.
    names.sort((a, b) => (a === myName ? -1 : b === myName ? 1 : a.localeCompare(b)));

    const lobbyChips = names.map(name => {
        const isYou = name === myName;
        const isReady = readyNames.includes(name);
        return `
            <span class="player-chip${isYou ? " is-you" : ""}${isReady ? " is-ready" : ""}">
                <span class="player-dot" style="background:${escapeAttr(roomMembers[name].color)}"></span>
                <span>${escapeHtml(name)}</span>
                ${isYou ? '<span class="player-you-tag">you</span>' : ""}
            </span>
        `;
    });

    // Someone with the hub open in one tab and a game in another would
    // otherwise appear twice. The lobby entry wins -- that's the one
    // that can actually click Continue.
    const gameChips = presenceList
        .filter(p => !roomMembers[p.name])
        .map(p => {
            const game = gameById(p.game);
            const label = game ? game.title : "in a game";
            return `
                <span class="player-chip in-game" title="${escapeAttr(p.name + " is playing " + label)}">
                    <span class="player-dot" style="background:${escapeAttr(p.color || getColorFromName(p.name))}"></span>
                    <span>${escapeHtml(p.name)}</span>
                    <span class="player-game-tag">${escapeHtml(label)}</span>
                </span>
            `;
        });

    if (lobbyChips.length === 0 && gameChips.length === 0) {
        playerStrip.innerHTML = '<span id="rosterEmpty">Not connected</span>';
        return;
    }

    playerStrip.innerHTML = lobbyChips.join("")
        + (gameChips.length ? '<span class="roster-divider"></span>' + gameChips.join("") : "");
}

// Redraws every vote checkmark on the CURRENT page from votesByGame.
// Cheap enough to redo wholesale: at most 8 buttons, and a vote is a
// person clicking, not a per-frame event.
function renderAllVoteChecks() {
    const mine = myChoice();

    tileGrid.querySelectorAll(".vote-check").forEach(btn => {
        const gameId = btn.dataset.gameId;
        const voters = votesByGame.get(gameId);
        const voterNames = voters ? Array.from(voters.keys()) : [];
        const isMine = gameId === mine;

        btn.classList.toggle("mine", isMine);

        // Marked on the whole tile, not only by your dot in the badge: a
        // tile click has to visibly DO something now that it no longer
        // opens the game, and one 8px dot in a corner didn't read as that.
        const tile = btn.closest(".tile");
        if (tile) tile.classList.toggle("is-mine", isMine);

        if (voterNames.length === 0) {
            btn.innerHTML = '<span class="vote-check-empty-icon">✓</span>';
            btn.title = isMine ? "Your pick — click to take it back" : "Vote for this game";
        } else {
            btn.innerHTML = voterNames
                .map(n => `<span class="vote-check-dot" style="background:${escapeAttr(voters.get(n))}"></span>`)
                .join("");
            btn.title = voterNames.join(", ") + " voted for this"
                + (isMine ? " — click to take your vote back" : "");
        }
    });
}

// "Launch cancelled -- a player joined" is only useful if it survives
// the lobby broadcast that arrives right behind it. Held for a few
// seconds, then the bar goes back to its normal state.
let transientHint = "";
let transientHintUntil = 0;
let transientHintTimer = null;

function flashHint(text) {
    transientHint = text;
    transientHintUntil = Date.now() + 4000;
    if (transientHintTimer) clearTracked(transientHintTimer);
    transientHintTimer = trackTimeout(() => { transientHintUntil = 0; renderBottomBar(); }, 4000);
    renderBottomBar();
}

function renderBottomBar() {
    renderBottomBarInner();
    if (Date.now() < transientHintUntil) continueHint.textContent = transientHint;
}

// What the bar says while the lobby is down. Drawn rather than left
// implicit: before HUB_LOBBY_PLAN.md §9 a dropped socket re-rendered
// nothing, and the board kept showing a Continue button nothing would
// answer.
function connectionHint() {
    if (socket && socket.readyState === WebSocket.OPEN) return "Joining the room…";
    return connectFailures === 0
        ? "Connecting to the game server (it can take a minute to wake up)"
        : "Can't reach the game server, still trying";
}

// Names rather than a count while the list is short: "waiting for Bob"
// tells the room who to nudge, and in a 3-10 person group that is nearly
// always the useful form.
//
// You are "you", and first. Reading your own name in the list of people
// being waited for is a small thing that makes the bar feel like it is
// talking about someone else.
function waitingClause(names) {
    const who = names.slice().sort((a, b) => (a === myName ? -1 : b === myName ? 1 : 0))
                     .map(n => (n === myName ? "you" : n));

    if (who.length === 1) return "waiting for " + who[0] + " to vote";
    if (who.length === 2) return "waiting for " + who[0] + " and " + who[1] + " to vote";
    if (who.length === 3) return "waiting for " + who[0] + ", " + who[1] + " and " + who[2] + " to vote";
    return "waiting for " + who.length + " more players to vote";
}

function waitingHint(names) {
    // Nobody left but you: the ask is yours, so say the ask rather than
    // "waiting for you", which reads like the room is stuck on itself.
    if (names.length === 1 && names[0] === myName) {
        return "Click a game to vote — everyone votes, then Continue";
    }
    const s = waitingClause(names);
    return s.charAt(0).toUpperCase() + s.slice(1);
}

// Shown when nothing is winning. With votes on the board and everyone in,
// that means a tie -- said out loud, or Continue vanishing the moment a
// second person votes looks like a bug. Someone still to vote is the more
// useful thing to say, so it wins.
function idleHint() {
    if (!myName) return "";
    if (!lobbyOnline()) return connectionHint();

    let anyVotes = false;
    votesByGame.forEach(voters => { if (voters.size > 0) anyVotes = true; });
    if (!anyVotes) return "Click a game to vote — everyone votes, then Continue";

    const waiting = pendingVoters();
    return waiting.length > 0
        ? waitingHint(waiting)
        : "It's a tie — someone needs to switch their vote";
}

// For a second click on the tile you already chose. It keeps the vote
// (see the tile handler in hub-boot.js), so say what happens next instead.
function ownChoiceHint(gameId) {
    const game = gameById(gameId);
    const title = game ? game.title : "That game";
    if (!lobbyOnline()) return title + " is already your pick — the button below plays it solo";

    const waiting = pendingVoters();
    if (waiting.length > 0) return title + " is already your vote — " + waitingClause(waiting);

    return effectiveLeader() === gameId
        ? title + " is already your vote — click Continue below when you're ready"
        : title + " is already your vote — it needs the most votes to unlock Continue";
}

function renderBottomBarInner() {
    const leader = effectiveLeader();
    const game = leader ? gameById(leader) : null;

    // Blank buffer when the room hasn't settled on anything. The space
    // stays reserved either way so the board doesn't resize under people
    // the moment a vote lands.
    if (!game) {
        continueBtn.hidden = true;
        continueHint.textContent = idleHint();
        return;
    }

    continueBtn.hidden = false;
    continueBtn.classList.toggle("is-launching", isLaunching);

    // No lobby, so nobody to wait for: the button launches this player
    // alone, straight to the link the tile itself used to be. Replaces the
    // visibly-disabled "ready-check unavailable" button (HUB_LOBBY_PLAN.md
    // §9c) -- with tiles as votes, that button would be the only exit.
    if (!lobbyOnline() && !isLaunching) {
        continueBtn.classList.remove("iam-ready");
        continueDots.hidden = true;
        continueLabel.textContent = "PLAY " + game.title.toUpperCase() + " SOLO";
        continueBtn.title = "Opens the game just for you";
        continueHint.textContent = connectionHint() + " • play solo now, or wait and your pick becomes your vote";
        return;
    }

    const total = Object.keys(roomMembers).length;
    const iAmReady = readyNames.includes(myName);

    // Everyone votes before anyone can start (§9e). A countdown that is
    // already running is left alone -- by then the room has voted, and a
    // vote withdrawn mid-count is the server's business, not a reason to
    // disable the button someone may be reaching for to cancel.
    const waiting = isLaunching ? [] : pendingVoters();

    continueDots.hidden = false;
    continueBtn.disabled = waiting.length > 0;
    continueBtn.classList.toggle("iam-ready", iAmReady && !isLaunching);

    continueLabel.textContent = isLaunching
        ? "STARTING " + game.title.toUpperCase()
        : (iAmReady ? "READY — " + game.title.toUpperCase() : "CONTINUE → " + game.title.toUpperCase());

    continueDots.innerHTML = readyNames.length === 0
        ? '<span class="vote-check-empty-icon" style="color:rgba(0,229,255,0.6)">✓</span>'
        : readyNames.map(n =>
            `<span class="vote-check-dot" style="background:${escapeAttr((roomMembers[n] && roomMembers[n].color) || getColorFromName(n))}"></span>`
        ).join("");

    if (waiting.length > 0) {
        continueBtn.title = "Everyone in the room votes before it can start";
        continueHint.textContent = waitingHint(waiting);
        return;
    }

    continueBtn.title = "";
    continueHint.textContent = isLaunching
        ? "Everyone's ready — click again to cancel"
        : `${readyNames.length}/${total} ready • everyone must click Continue`;
}

function renderAll() {
    renderRoster();
    renderTiles();
    renderPageDots();
    renderBottomBar();
}



// ===================================================
//   REMOTE CURSORS
// ===================================================
// One element per remote player, created on their first update and
// reused after that. Recreating per message would restart the CSS
// transition every time and make movement look jumpy rather than
// smoothly interpolated between 10Hz updates.
const remoteCursorElements = {};
const remoteCursorState = {};

function resolveAnchorElement(anchor) {
    if (!anchor) return null;
    if (anchor === "continue") return continueBtn.hidden ? null : continueBtn;
    // Network-supplied, so constrain it to the shape this page emits
    // rather than interpolating arbitrary text into a selector.
    if (/^tile:[A-Za-z0-9_-]+$/.test(anchor)) {
        return tileGrid.querySelector('.tile[data-game-id="' + anchor.slice(5) + '"]');
    }
    return null;
}

function renderRemoteCursor(data) {
    const name = data.name;
    if (!name || name === myName) return;

    remoteCursorState[name] = {
        color: data.color || getColorFromName(name),
        x: data.x,
        y: data.y,
        anchor: data.anchor || null,
        ax: typeof data.ax === "number" ? data.ax : 0.5,
        ay: typeof data.ay === "number" ? data.ay : 0.5
    };

    let el = remoteCursorElements[name];
    if (!el) {
        el = document.createElement("div");
        el.className = "remote-cursor";
        el.innerHTML =
            '<div class="remote-cursor-label">' + escapeHtml(name) + '</div>' +
            '<div class="remote-cursor-dot" style="background:' + escapeAttr(remoteCursorState[name].color) + '"></div>';
        document.body.appendChild(el);
        remoteCursorElements[name] = el;
    }

    positionRemoteCursor(name);
}

function positionRemoteCursor(name) {
    const el = remoteCursorElements[name];
    const st = remoteCursorState[name];
    if (!el || !st) return;

    const anchorEl = resolveAnchorElement(st.anchor);

    if (anchorEl) {
        const r = anchorEl.getBoundingClientRect();
        el.style.left = (r.left + st.ax * r.width) + "px";
        el.style.top = (r.top + st.ay * r.height) + "px";
        el.classList.remove("offscreen");
    } else {
        // No anchor, or an anchor that isn't on this screen (they're on
        // another page). Fall back to raw position and dim it, so it
        // reads as presence rather than as "pointing at this tile."
        if (st.x == null || st.y == null) return;
        el.style.left = (st.x / 100 * window.innerWidth) + "px";
        el.style.top = (st.y / 100 * window.innerHeight) + "px";
        el.classList.toggle("offscreen", st.anchor !== null);
    }
}

function repositionRemoteCursors() {
    Object.keys(remoteCursorElements).forEach(positionRemoteCursor);
}

function removeRemoteCursor(name) {
    const el = remoteCursorElements[name];
    if (el) el.remove();
    delete remoteCursorElements[name];
    delete remoteCursorState[name];
}

// Same 10Hz cadence space-tracer.html uses for its position updates --
// one convention for "how often do we send live position data" across
// the whole project rather than a different number per page.
const CURSOR_SEND_INTERVAL = 1000 / 10;
let lastCursorSendTime = 0;

function anchorUnder(clientX, clientY) {
    const el = document.elementFromPoint(clientX, clientY);
    if (!el) return null;

    const tile = el.closest(".tile[data-game-id]");
    if (tile) return { anchor: "tile:" + tile.dataset.gameId, rect: tile.getBoundingClientRect() };

    if (el.closest("#continueBtn")) return { anchor: "continue", rect: continueBtn.getBoundingClientRect() };

    return null;
}



// ===================================================
//   SCREENS
// ===================================================
function showHub() {
    identityOverlay.hidden = true;
    renderAll();
}

function showIdentityOverlay() {
    identityOverlay.hidden = false;

    // Clear everything scoped to the room being left. Without this,
    // switching from room ASDF to QWER shows ASDF's roster, votes and
    // cursors bleeding into the new room until each stale entry happens
    // to be overwritten individually.
    stopCountdown();
    Object.keys(roomMembers).forEach(k => delete roomMembers[k]);
    votesByGame.clear();
    Object.keys(remoteCursorElements).forEach(removeRemoteCursor);
    presenceList = [];
    serverHasLobby = false;
    serverLeaderGameId = null;
    readyNames = [];
    offlinePick = null;
    connectFailures = 0;
    renderAll();
}


