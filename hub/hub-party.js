// ===================================================
//   Hub — the party session
// ===================================================
// Added 2026-11-13 (HUB_1_0_PLAN.md Phase 7). A party session is X games in
// a row for one room, a standings readout between them, and one winner at
// the end. The SERVER keeps it (gyro-space-server "PARTY SESSION"), because
// the hub page is gone while a game is being played. This file is the hub's
// view of it: starting one, which tiles are open, the bar, and the readouts.
//
// Classic script in the hub's shared global scope; loads after hub-render.js
// and before hub-net.js. Every top-level name is unique across hub/*.js
// (scripts/check-global-collisions.js).
"use strict";

// ---------------------------------------------------
//   THE STORY PATH
// ---------------------------------------------------
// In a STORY session the board is a gated flow chart: the group starts on
// one of the three stacked starting games and from there can only move
// forward through the hub's chronology, so a session plays as rising action
// and never goes backwards in time. FREE PLAY opens every party game.
//
// The order is the story's (acts I to V). Only games carrying `party: true`
// in GAMES can be voted in a session; the others are drawn on the path so
// the shape of the whole story is visible, and open up as they are wired.
//
//   STORY_START   where a story begins (ACT I)
//   STORY_PATHS   game -> the games it may lead to (forward only)
//
// The board itself is the flow chart (2026-11-13, Ry): hub-render.js draws
// one column per act from GAMES[].act and a line for every STORY_PATHS edge.
// An edge joins neighbours: two games in the same act that sit one above
// the other, or games in adjacent acts.
//
// TO ADD A GAME: give it an `act` in GAMES (hub-core.js), a STORY_PATHS
// entry, and list it in whatever leads to it. Nothing else reads the story.
const STORY_START = ["alien-outpost", "scuba-shooter"];

const STORY_PATHS = {
    "alien-outpost":     ["scuba-shooter", "zombie"],
    "scuba-shooter":     ["zombie", "glass-city-escape"],
    "zombie":            ["glass-city-escape", "hurl-strike"],
    "glass-city-escape": ["four-d-pong", "rd-arena"],
    "four-d-pong":       ["hurl-strike", "rd-arena"],
    "hurl-strike":       ["rd-arena"],
    "rd-arena":          ["code-racer"],
    "code-racer":        ["cliff-run"],
    "cliff-run":         ["text-editor-wars"],
    "text-editor-wars":  ["space-tracer"],
    "space-tracer":      ["gyro-fleet"],
    "gyro-fleet":        []
};

const PARTY_LENGTHS = [3, 5, 7];

function partyActive() {
    return !!partySession && !partySession.done;
}

function partyStory() {
    return partyActive() && partySession.mode === "story";
}

function partyGame(id) {
    const g = gameById(id);
    return !!g && !!g.party;
}

// The last game this session played, or null before the first.
function partyLastGameId() {
    if (!partySession || partySession.rounds.length === 0) return null;
    return partySession.rounds[partySession.rounds.length - 1].gameId;
}

function partyPlayedCount(id) {
    if (!partySession) return 0;
    return partySession.rounds.filter(r => r.gameId === id).length;
}

// The act the story has reached, for the column marker; null outside one.
function partyActAt() {
    if (!partyStory()) return null;
    const g = gameById(partyLastGameId());
    return g ? g.act : null;
}

// The party games among `ids`. When NONE of them is wired for party play
// yet, the games they lead to stand in, so the path never dead-ends on a
// chapter that cannot be played. (Only then: a playable chapter is never
// skipped past just because its neighbour is not ready.)
function storyOpenFrom(ids, seen) {
    const ready = ids.filter(partyGame);
    if (ready.length) return ready;
    const out = [];
    ids.forEach(id => {
        if (seen.has(id)) return;
        seen.add(id);
        storyOpenFrom(STORY_PATHS[id] || [], seen).forEach(x => { if (!out.includes(x)) out.push(x); });
    });
    return out;
}

// The ids open for a vote in a STORY session, or null when the story is
// not what gates the board (no session, or free play).
function partyOpenIds() {
    if (!partyStory()) return null;
    const last = partyLastGameId();
    if (!last) return new Set(storyOpenFrom(STORY_START, new Set()));

    // Forward, or the same chapter again. Never back.
    const open = new Set(storyOpenFrom(STORY_PATHS[last] || [], new Set([last])));
    open.add(last);
    return open;
}

// Why a tile cannot be voted, as its stamp; null when it can.
function partyLockReason(game) {
    if (game.soon) return "IN DEVELOPMENT";
    const open = partyOpenIds();
    if (!open || open.has(game.id)) return null;
    if (!game.party) return "FREE PLAY ONLY";
    return storyIsBehind(game.id) ? "EARLIER CHAPTER" : "LATER CHAPTER";
}

// A small label on an OPEN tile: what kind of round it will be.
function partyTileNote(game) {
    if (partyActive() && !game.party) return "UNSCORED";
    if (game.solo) return "SOLO";
    return "";
}

// Everything the story can still reach from `from` (not including it).
function storyReach(from) {
    const seen = new Set();
    const queue = (STORY_PATHS[from] || []).slice();
    while (queue.length) {
        const at = queue.shift();
        if (seen.has(at)) continue;
        seen.add(at);
        (STORY_PATHS[at] || []).forEach(n => queue.push(n));
    }
    return seen;
}

function storyIsBehind(id) {
    const last = partyLastGameId();
    if (!last) return false;
    return id !== last && !storyReach(last).has(id);
}

// How one line of the flow chart is drawn (hub-render.js renderPaths):
//   "done"  the session went along it
//   "open"  it leads from where the session is to a game that is open now
//   "off"   everything else
function partyPathState(from, to) {
    if (!partySession) return "off";
    const r = partySession.rounds;
    for (let i = 1; i < r.length; i++) {
        if (r[i - 1].gameId === from && r[i].gameId === to) return "done";
    }
    const open = partyOpenIds();
    if (!open) return "off";

    // The lit route starts where the session is and may pass through
    // chapters that are not playable yet on its way to one that is.
    const last = partyLastGameId();
    const starts = last ? [last] : STORY_START;
    const through = new Set(starts);
    const queue = starts.slice();
    while (queue.length) {
        const at = queue.shift();
        (STORY_PATHS[at] || []).forEach(n => {
            if (partyGame(n) || through.has(n)) return;
            through.add(n);
            queue.push(n);
        });
    }
    if (!through.has(from)) return "off";
    if (open.has(to) && to !== last) return "open";
    if (!through.has(to)) return "off";
    // A pass-through chapter: lit only if it gets somewhere.
    let leads = false;
    storyReach(to).forEach(n => { if (open.has(n)) leads = true; });
    return leads ? "open" : "off";
}

function partyLockHint(game) {
    const why = partyLockReason(game);
    if (why === "IN DEVELOPMENT") return game.title + " is still being built";
    if (why === "FREE PLAY ONLY") return game.title + " doesn't score in a party yet. It is open in free play";
    if (why === "EARLIER CHAPTER") return game.title + " is an earlier chapter. The story only moves forward";
    return game.title + " comes later in the story. Play one of the lit games first";
}


// ---------------------------------------------------
//   SESSION STATE FROM THE SERVER
// ---------------------------------------------------
// How many finished rounds of THIS session this browser has already shown a
// readout for. Kept in localStorage because the readout appears on the trip
// back from a game, which is a fresh page.
function partySeenKey() {
    return "gamehub_partySeen_" + (partySession ? partySession.id : "");
}

function partySeenRounds() {
    try { return Number(localStorage.getItem(partySeenKey())) || 0; }
    catch (e) { return 0; }
}

function partySeenWant() {
    return partySession.rounds.length + (partySession.done ? 0.5 : 0);
}

function partyMarkSeen() {
    if (!partySession) return;
    try { localStorage.setItem(partySeenKey(), String(partySeenWant())); }
    catch (e) { /* the readout will just show again */ }
}

let partyOverlayMode = "";      // "", "readout", "final"
let partySetupTotal = 3;
let partyModeFocus = "story";   // which card the keyboard is on
let partyPending = null;        // a mode picked before the server answered
let partyLocalMode = false;     // playing without the server, no session

try { partyLocalMode = sessionStorage.getItem("gamehub_localMode") === "1"; } catch (e) { /* asked again */ }

// THE FIRST SCREEN (Ry, 2026-11-13). Until the room has a session, the hub
// asks which kind this is: a story party or free play. Both are sessions
// on the server, so both route every game back here with a readout.
function partyModeScreenUp() {
    if (!myName || !identityOverlay.hidden) return false;
    if (partyOverlayMode) return false;
    if (partyActive()) return false;
    if (partySession && partySession.done && partySeenWant() > partySeenRounds()) return false;
    if (partyLocalMode && !lobbyOnline()) return false;
    return true;
}

function partySessionChanged(next) {
    partySession = next;

    if (partySession && partyPending) partyPending = null;      // someone else started one
    if (!partySession && partyPending && lobbyOnline()) partyStart(partyPending.mode, partyPending.total);

    // The open tiles depend on the session, so the board is redrawn; and a
    // vote this browser cast for a tile that has just locked is withdrawn.
    const mine = myChoice();
    if (mine && lobbyOnline()) {
        const g = gameById(mine);
        if (g && partyLockReason(g)) sendVote(mine, false);
    }

    if (!partySession) partyOverlayMode = "";
    if (partySession && partySeenWant() > partySeenRounds() && partySession.rounds.length > 0) {
        partyOverlayMode = partySession.done ? "final" : "readout";
        // Come back to the part of the story the session is in.
        const last = partyLastGameId();
        if (last) currentPage = pageOfGame(last);
    }
    renderTiles();
    renderPageDots();
    attractRepaint();
    renderParty();
    renderBottomBar();
}

function partySend(msg) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return false;
    socket.send(JSON.stringify(msg));
    return true;
}

function partyStart(mode, total) {
    partyPending = null;
    partyLocalMode = false;
    try { sessionStorage.removeItem("gamehub_localMode"); } catch (e) { /* nothing stored */ }
    partySend({
        type: "session-start",
        mode: mode,
        total: mode === "story" ? total : 0,
        // The games that report a score. Launching any other is not a round.
        games: GAMES.filter(g => g.party).map(g => g.id)
    });
}

function partyPick(mode) {
    hubSoundVote();
    if (lobbyOnline() && serverHasSessions) { partyStart(mode, partySetupTotal); return; }
    partyPending = { mode: mode, total: partySetupTotal };
    renderParty();
}

function partyPlayLocal() {
    partyPending = null;
    partyLocalMode = true;
    try { sessionStorage.setItem("gamehub_localMode", "1"); } catch (e) { /* asked again next visit */ }
    renderParty();
    renderBottomBar();
}


// ---------------------------------------------------
//   RENDERING
// ---------------------------------------------------
function partyOrdinal(n) {
    return n === 1 ? "1ST" : n === 2 ? "2ND" : n === 3 ? "3RD" : n + "TH";
}

function partyNumber(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

function partyDot(color) {
    return `<span class="player-dot" style="background:${escapeAttr(color)}"></span>`;
}

function partyHeadline() {
    if (!partySession) return partyLocalMode ? "FREE PLAY · OFFLINE · NO SESSION" : "NO SESSION";
    if (partySession.done) return "SESSION OVER";
    const n = partySession.rounds.length + 1;
    return partySession.mode === "story"
        ? "STORY PARTY · GAME " + Math.min(n, partySession.total) + " OF " + partySession.total
        : "FREE PLAY · GAME " + n;
}

function renderPartyBar() {
    if (!myName) { partyBar.hidden = true; partyBar.innerHTML = ""; return; }

    const stand = partySession ? partySession.standings.map(r =>
        `<span class="party-stand${r.place === 1 && r.points > 0 ? " is-lead" : ""}">${partyDot(r.color)}${escapeHtml(r.name)} <b>${r.points}</b></span>`
    ).join("") : "";

    // Someone on the hub while a round is being played is a late joiner (or
    // came back early): say where the group is.
    const inPlay = partySession && partySession.current ? gameById(partySession.current.gameId) : null;
    const late = inPlay
        ? `<span class="party-tag is-alert">IN PLAY: ${escapeHtml(inPlay.title).toUpperCase()} · VOTE IT TO JOIN</span>`
        : "";

    const canCall = partyActive() && partySession.mode !== "story" && partySession.rounds.length > 0 && !partySession.current;

    partyBar.hidden = false;
    partyBar.innerHTML =
        `<span class="party-tag">${partyHeadline()}</span>` + late + stand +
        '<span class="party-spacer"></span>' +
        (partySession && partySession.rounds.length ? '<button class="top-btn" data-party="standings">Standings</button>' : "") +
        (canCall ? '<button class="top-btn" data-party="finish" title="End free play here and name the winner">Call it</button>' : "") +
        `<button class="top-btn" data-party="end" title="Back to the first screen: story party or free play">Change mode</button>`;
}

function partyStandingsTable() {
    const top = Math.max(1, partySession.standings.length ? partySession.standings[0].points : 1);
    return '<table class="party-table"><tr><th></th><th>STANDINGS</th><th class="n">1STS</th><th class="n">PARTY</th></tr>' +
        partySession.standings.map((r, i) =>
            `<tr class="party-reveal${r.name === myName ? " is-you" : ""}" style="--i:${i + 4}"><td>${partyOrdinal(r.place)}</td>` +
            `<td>${partyDot(r.color)}${escapeHtml(r.name)}` +
            `<span class="party-meter"><span style="width:${Math.round(100 * r.points / top)}%;background:${escapeAttr(r.color)}"></span></span></td>` +
            `<td class="n">${r.firsts}</td>` +
            `<td class="n">${r.points} PTS</td></tr>`
        ).join("") + "</table>";
}

function partyRoundTable(round) {
    return '<table class="party-table"><tr><th></th><th>PLAYER</th><th class="n">SCORE</th><th class="n">PARTY</th></tr>' +
        round.results.map((r, i) =>
            `<tr class="party-reveal${r.name === myName ? " is-you" : ""}" style="--i:${i}"><td>${partyOrdinal(r.place)}</td>` +
            `<td>${partyDot(r.color)}${escapeHtml(r.name)}</td><td class="n">${partyNumber(r.score)}</td>` +
            `<td class="n party-gain">+${r.points + r.bonus}</td></tr>`
        ).join("") + "</table>";
}

function renderModeScreen() {
    const online = lobbyOnline() && serverHasSessions;
    const count = Object.keys(roomMembers).length;
    const foot = partyPending
        ? `<span class="mode-blink">CONNECTING TO THE GAME SERVER. ${partyPending.mode === "story" ? "STORY PARTY" : "FREE PLAY"} STARTS WHEN IT ANSWERS</span>` +
          '<button class="top-btn" data-party="local">Play solo without it</button>'
        : online
            ? `ROOM ${escapeHtml(myRoom)} · ${count} PLAYER${count === 1 ? "" : "S"} HERE · ANYONE CAN PICK, EVERYONE GETS IT`
            : escapeHtml(connectionHint()).toUpperCase() +
              ' <button class="top-btn" data-party="local">Play solo without it</button>';

    const card = (mode, title, lines, extra) =>
        `<div class="mode-card${partyModeFocus === mode ? " is-focus" : ""}${partyPending && partyPending.mode === mode ? " is-picked" : ""}" role="button" tabindex="0" data-mode-pick="${mode}">` +
        `<canvas class="mode-art" width="${ART_W}" height="${ART_H}" data-art="mode-${mode}"></canvas>` +
        `<h3>${title}</h3>` + lines.map(l => `<p>${l}</p>`).join("") + (extra || "") +
        '<span class="mode-go">START</span></div>';

    return '<div class="mode-screen">' +
        '<div class="mode-kicker">PLAYER SELECT COMPLETE</div>' +
        "<h2>CHOOSE YOUR SESSION</h2>" +
        '<div class="mode-cards">' +
        card("story", "STORY PARTY",
            ["FOLLOW THE INVASION ACT BY ACT. THE PATH ONLY GOES FORWARD.",
             "EACH GAME PAYS 10 / 7 / 5 / 3 BY SCORE. ONE WINNER AT THE END."],
            '<div class="mode-len">' + PARTY_LENGTHS.map(n =>
                `<button class="party-opt" data-party-total="${n}" aria-pressed="${n === partySetupTotal}">${n}</button>`).join("") +
            "<span>GAMES</span></div>") +
        card("free", "FREE PLAY",
            ["ANY GAME, ANY ORDER.",
             "A RUNNING SCORE AFTER EVERY GAME. CALL IT WHEN YOU HAVE HAD ENOUGH."]) +
        "</div>" +
        `<div class="mode-foot">${foot}</div>` +
        "</div>";
}

function renderPartyOverlay() {
    const modeUp = partyModeScreenUp();
    if (!modeUp && (!partyOverlayMode || !partySession)) {
        partyOverlay.hidden = true;
        partyOverlay.className = "";
        partyOverlay.innerHTML = "";
        return;
    }

    let html = "";

    if (modeUp) {
        partyOverlay.hidden = false;
        partyOverlay.className = "is-mode";
        partyOverlay.innerHTML = renderModeScreen();
        artRepaint();
        return;
    }

    if (partyOverlayMode === "final") {
        const winners = partySession.winners || [];
        html =
            '<div class="party-kicker">SESSION OVER</div>' +
            `<h2>${partySession.rounds.length} GAME${partySession.rounds.length === 1 ? "" : "S"} PLAYED</h2>` +
            `<div class="party-winner">${escapeHtml(winners.join(" & ")).toUpperCase() || "NOBODY"}<br>${winners.length > 1 ? "SHARE THE WIN" : "WINS"}</div>` +
            partyStandingsTable() +
            '<div class="party-row"><button class="party-go" data-party="dismiss">NEW SESSION</button></div>';

    } else {
        const round = partySession.rounds[partySession.rounds.length - 1];
        const g = round ? gameById(round.gameId) : null;
        const of = partySession.total ? " OF " + partySession.total : "";
        html =
            `<div class="party-kicker">${escapeHtml(g ? g.title : "").toUpperCase()}</div>` +
            `<h2>AFTER GAME ${partySession.rounds.length}${of}</h2>` +
            `<div class="party-sub">${round && round.cleared ? "CLEARED TOGETHER · +" + partySession.clearBonus + " EACH" : "PLACEMENT POINTS 10 / 7 / 5 / 3"}</div>` +
            (round ? partyRoundTable(round) : "") +
            partyStandingsTable() +
            '<div class="party-row"><button class="party-go" data-party="dismiss">' +
            (partySession.done ? "CLOSE" : "PICK THE NEXT GAME") + "</button></div>";
    }

    partyOverlay.hidden = false;
    partyOverlay.className = "";
    partyOverlay.innerHTML = '<div class="party-card">' + html + "</div>";
    const focus = partyOverlay.querySelector(".party-go");
    if (focus) { try { focus.focus(); } catch (e) { /* not focusable yet */ } }
}

function renderParty() {
    renderPartyBar();
    renderPartyOverlay();
}


// ---------------------------------------------------
//   INPUT
// ---------------------------------------------------
function partyClick(e) {
    const total = e.target.closest("[data-party-total]");
    if (total) {
        partySetupTotal = Number(total.dataset.partyTotal);
        partyModeFocus = "story";
        hubSoundVote();
        renderPartyOverlay();
        return;
    }

    const btn = e.target.closest("[data-party]");
    if (btn) {
        const act = btn.dataset.party;
        hubSoundVote();

        if (act === "local") {
            partyPlayLocal();
            return;
        } else if (act === "end") {
            // Back to the first screen. With a live session that ends it
            // for the room, which is what choosing again means.
            partyMarkSeen();
            partyOverlayMode = "";
            partyLocalMode = false;
            try { sessionStorage.removeItem("gamehub_localMode"); } catch (e2) { /* nothing stored */ }
            if (partySession) partySend({ type: "session-end" });
        } else if (act === "finish") {
            partySend({ type: "session-finish" });
        } else if (act === "standings") {
            partyOverlayMode = partySession && partySession.done ? "final" : "readout";
        } else if (act === "dismiss") {
            partyMarkSeen();
            partyOverlayMode = "";
        }
        renderParty();
        renderBottomBar();
        return;
    }

    const pick = e.target.closest("[data-mode-pick]");
    if (pick) partyPick(pick.dataset.modePick);
}

// Arrow keys and Enter on the first screen. True when the key was used.
function partyKey(e) {
    if (!partyModeScreenUp()) {
        if (partyOverlayMode && e.key === "Enter") {
            const go = partyOverlay.querySelector(".party-go");
            if (go) { go.click(); return true; }
        }
        return !!partyOverlayMode;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        partyModeFocus = partyModeFocus === "story" ? "free" : "story";
        hubSoundVote();
        renderPartyOverlay();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        const i = PARTY_LENGTHS.indexOf(partySetupTotal) + (e.key === "ArrowUp" ? 1 : -1);
        partySetupTotal = PARTY_LENGTHS[Math.max(0, Math.min(PARTY_LENGTHS.length - 1, i))];
        renderPartyOverlay();
    } else if (e.key === "Enter" || e.key === " ") {
        partyPick(partyModeFocus);
    }
    return true;
}

partyBar.addEventListener("click", partyClick, { signal: hubSignal });
partyOverlay.addEventListener("click", partyClick, { signal: hubSignal });
