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
//   STORY_START   the three stacked starting games
//   STORY_PATHS   game -> the games it may lead to (forward only)
//   STORY_STAGES  how the path is drawn: one column per stage
//
// TO ADD A GAME: give it a STORY_PATHS entry, list it in whatever leads to
// it, and put it in a STORY_STAGES column. Nothing else reads the story.
const STORY_START = ["scuba-shooter", "zombie", "glass-city-escape"];

const STORY_PATHS = {
    "scuba-shooter":     ["zombie", "glass-city-escape"],
    "zombie":            ["glass-city-escape", "four-d-pong", "rd-arena"],
    "glass-city-escape": ["four-d-pong", "rd-arena"],
    "four-d-pong":       ["rd-arena", "space-tracer"],
    "rd-arena":          ["space-tracer"],
    "space-tracer":      []
};

const STORY_STAGES = [
    { label: "START",            games: STORY_START },
    { label: "II SPREAD",        games: ["four-d-pong"] },
    { label: "III ESCALATION",   games: ["rd-arena"] },
    { label: "V COUNTERATTACK",  games: ["space-tracer"] }
];

const PARTY_LENGTHS = [3, 5, 7];

function partyActive() {
    return !!partySession && !partySession.done;
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

// The ids open for a vote right now, or null when there is no session
// (everything is open, as it always was).
function partyOpenIds() {
    if (!partyActive()) return null;
    if (partySession.mode !== "story") {
        return new Set(GAMES.filter(g => g.party).map(g => g.id));
    }
    const last = partyLastGameId();
    if (!last) return new Set(storyOpenFrom(STORY_START, new Set()));

    // Forward, or the same chapter again. Never back.
    const open = new Set(storyOpenFrom(STORY_PATHS[last] || [], new Set([last])));
    open.add(last);
    return open;
}

// Why a tile is locked, as its stamp; null when it is open.
function partyLockReason(game) {
    const open = partyOpenIds();
    if (!open || open.has(game.id)) return null;
    if (!game.party) return "NOT IN PARTY YET";
    if (partySession.mode !== "story") return null;
    return storyIsBehind(game.id) ? "EARLIER CHAPTER" : "LATER CHAPTER";
}

// Can `id` still be reached from where the session is? If not, it is behind.
function storyIsBehind(id) {
    const last = partyLastGameId();
    if (!last) return false;
    const seen = new Set();
    const queue = [last];
    while (queue.length) {
        const at = queue.shift();
        if (seen.has(at)) continue;
        seen.add(at);
        (STORY_PATHS[at] || []).forEach(n => queue.push(n));
    }
    return !seen.has(id);
}

function partyLockHint(game) {
    const why = partyLockReason(game);
    if (why === "NOT IN PARTY YET") return game.title + " isn't set up for party sessions yet";
    if (why === "EARLIER CHAPTER") return game.title + " is an earlier chapter — the story only moves forward";
    return game.title + " comes later in the story — play one of the lit games first";
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

function partyMarkSeen() {
    if (!partySession) return;
    try { localStorage.setItem(partySeenKey(), String(partySession.rounds.length + (partySession.done ? 0.5 : 0))); }
    catch (e) { /* the readout will just show again */ }
}

let partyOverlayMode = "";      // "", "setup", "readout", "final"
let partySetupMode = "story";
let partySetupTotal = 3;

function partySessionChanged(next) {
    const hadId = partySession ? partySession.id : null;
    partySession = next;

    // The open tiles depend on the session, so the board is redrawn; and a
    // vote this browser cast for a tile that has just locked is withdrawn.
    renderTiles();
    attractRepaint();
    const mine = myChoice();
    if (mine && lobbyOnline()) {
        const g = gameById(mine);
        if (g && partyLockReason(g)) sendVote(mine, false);
    }

    if (partyOverlayMode === "setup" && partySession && partySession.id !== hadId) partyOverlayMode = "";
    if (!partySession && partyOverlayMode !== "setup") partyOverlayMode = "";

    if (partySession) {
        const shown = partySeenRounds();
        const want = partySession.rounds.length + (partySession.done ? 0.5 : 0);
        if (want > shown && partySession.rounds.length > 0) {
            partyOverlayMode = partySession.done ? "final" : "readout";
        }
    }
    renderParty();
    renderBottomBar();
}

function partySend(msg) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify(msg));
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

function renderStoryPath() {
    const open = partyOpenIds() || new Set();
    const played = new Map();
    partySession.rounds.forEach((r, i) => { if (!played.has(r.gameId)) played.set(r.gameId, i + 1); });

    return '<span class="story-path">' + STORY_STAGES.map(stage => {
        const chips = stage.games.map(id => {
            const g = gameById(id);
            if (!g) return "";
            const cls = played.has(id) ? " is-played" : open.has(id) ? " is-open" : !g.party ? " is-off" : "";
            const mark = played.has(id) ? "✓ " : "";
            return `<span class="story-chip${cls}" title="${escapeAttr(g.title)}">${mark}${escapeHtml(g.title)}</span>`;
        }).join("");
        return `<span class="story-col"><span class="story-col-label">${escapeHtml(stage.label)}</span>${chips}</span>`;
    }).join('<span class="story-arrow">&#9654;</span>') + "</span>";
}

function renderPartyBar() {
    partyBtn.hidden = !(serverHasSessions && lobbyOnline()) || !!partySession;

    if (!partySession) {
        partyBar.hidden = true;
        partyBar.innerHTML = "";
        return;
    }

    const n = Math.min(partySession.total, partySession.rounds.length + 1);
    const head = partySession.done
        ? "PARTY OVER"
        : "PARTY · " + (partySession.mode === "story" ? "STORY" : "FREE PLAY") + " · GAME " + n + " OF " + partySession.total;

    const stand = partySession.standings.map(r =>
        `<span class="party-stand${r.place === 1 && r.points > 0 ? " is-lead" : ""}">${partyDot(r.color)}${escapeHtml(r.name)} ${r.points}</span>`
    ).join("");

    // Someone on the hub while a round is being played is a late joiner (or
    // came back early): say where the group is.
    const inPlay = partySession.current ? gameById(partySession.current.gameId) : null;
    const late = inPlay
        ? `<span class="party-tag">IN PLAY: ${escapeHtml(inPlay.title).toUpperCase()} · VOTE IT TO JOIN</span>`
        : "";

    partyBar.hidden = false;
    partyBar.innerHTML =
        `<span class="party-tag">${head}</span>` + late + stand +
        (partySession.mode === "story" && !partySession.done ? renderStoryPath() : "") +
        '<span class="party-spacer"></span>' +
        (partySession.rounds.length ? '<button class="top-btn" data-party="standings">Standings</button>' : "") +
        `<button class="top-btn" data-party="end">${partySession.done ? "Close" : "End party"}</button>`;
}

function partyStandingsTable() {
    return '<table><tr><th></th><th>STANDINGS</th><th class="n">1STS</th><th class="n">PARTY</th></tr>' +
        partySession.standings.map(r =>
            `<tr class="${r.name === myName ? "is-you" : ""}"><td>${partyOrdinal(r.place)}</td>` +
            `<td>${partyDot(r.color)}${escapeHtml(r.name)}</td><td class="n">${r.firsts}</td>` +
            `<td class="n">${r.points} PTS</td></tr>`
        ).join("") + "</table>";
}

function partyRoundTable(round) {
    return '<table><tr><th></th><th>PLAYER</th><th class="n">SCORE</th><th class="n">PARTY</th></tr>' +
        round.results.map(r =>
            `<tr class="${r.name === myName ? "is-you" : ""}"><td>${partyOrdinal(r.place)}</td>` +
            `<td>${partyDot(r.color)}${escapeHtml(r.name)}</td><td class="n">${partyNumber(r.score)}</td>` +
            `<td class="n party-gain">+${r.points + r.bonus}</td></tr>`
        ).join("") + "</table>";
}

function renderPartyOverlay() {
    if (!partyOverlayMode || (partyOverlayMode !== "setup" && !partySession)) {
        partyOverlay.hidden = true;
        partyOverlay.innerHTML = "";
        return;
    }

    let html = "";

    if (partyOverlayMode === "setup") {
        html =
            "<h2>START A PARTY</h2>" +
            '<div class="party-sub">SEVERAL GAMES IN A ROW · ONE WINNER</div>' +
            '<div class="party-row"><span class="party-label">HOW MANY GAMES</span>' +
            PARTY_LENGTHS.map(n =>
                `<button class="party-opt" data-party-total="${n}" aria-pressed="${n === partySetupTotal}">${n}</button>`).join("") +
            "</div>" +
            '<div class="party-row"><span class="party-label">WHICH GAMES</span>' +
            `<button class="party-opt" data-party-mode="story" aria-pressed="${partySetupMode === "story"}">STORY PATH</button>` +
            `<button class="party-opt" data-party-mode="free" aria-pressed="${partySetupMode === "free"}">FREE PLAY</button>` +
            "</div>" +
            '<div class="party-note">' + (partySetupMode === "story"
                ? "STORY PATH: START ON AN EARLY CHAPTER AND ONLY MOVE FORWARD THROUGH THE STORY."
                : "FREE PLAY: VOTE FOR ANY PARTY GAME, IN ANY ORDER.") +
            "<br>EACH GAME PAYS 10 / 7 / 5 / 3 BY SCORE, +2 EACH IF YOU BEAT IT TOGETHER.</div>" +
            '<div class="party-row"><button class="party-go" data-party="start">START</button>' +
            '<button class="party-go is-quiet" data-party="dismiss">CANCEL</button></div>';

    } else if (partyOverlayMode === "final") {
        const winners = partySession.winners || [];
        html =
            "<h2>PARTY OVER</h2>" +
            `<div class="party-sub">${partySession.rounds.length} GAMES PLAYED</div>` +
            `<div class="party-winner">${escapeHtml(winners.join(" & ")).toUpperCase() || "NOBODY"}<br>${winners.length > 1 ? "SHARE THE WIN" : "WINS"}</div>` +
            partyStandingsTable() +
            '<div class="party-row"><button class="party-go" data-party="again">NEW PARTY</button>' +
            '<button class="party-go is-quiet" data-party="dismiss">CLOSE</button></div>';

    } else {
        const round = partySession.rounds[partySession.rounds.length - 1];
        const g = round ? gameById(round.gameId) : null;
        html =
            `<h2>AFTER GAME ${partySession.rounds.length} OF ${partySession.total}</h2>` +
            `<div class="party-sub">${escapeHtml(g ? g.title : "").toUpperCase()}${round && round.cleared ? " · CLEARED TOGETHER +" + partySession.clearBonus + " EACH" : ""}</div>` +
            (round ? partyRoundTable(round) : "") +
            partyStandingsTable() +
            '<div class="party-row"><button class="party-go" data-party="dismiss">' +
            (partySession.done ? "CLOSE" : "PICK THE NEXT GAME") + "</button></div>";
    }

    partyOverlay.hidden = false;
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
    if (total) { partySetupTotal = Number(total.dataset.partyTotal); hubSoundVote(); renderPartyOverlay(); return; }

    const mode = e.target.closest("[data-party-mode]");
    if (mode) { partySetupMode = mode.dataset.partyMode; hubSoundVote(); renderPartyOverlay(); return; }

    const btn = e.target.closest("[data-party]");
    if (!btn) return;
    const act = btn.dataset.party;
    hubSoundVote();

    if (act === "start") {
        partySend({ type: "session-start", mode: partySetupMode, total: partySetupTotal });
        partyOverlayMode = "";
    } else if (act === "again") {
        partyMarkSeen();
        partyOverlayMode = "setup";
    } else if (act === "end") {
        partyMarkSeen();
        partySend({ type: "session-end" });
        partyOverlayMode = "";
    } else if (act === "standings") {
        partyOverlayMode = partySession && partySession.done ? "final" : "readout";
    } else if (act === "dismiss") {
        partyMarkSeen();
        partyOverlayMode = "";
    }
    renderParty();
}

partyBtn.addEventListener("click", () => {
    hubSoundVote();
    partyOverlayMode = "setup";
    renderParty();
}, { signal: hubSignal });

partyBar.addEventListener("click", partyClick, { signal: hubSignal });
partyOverlay.addEventListener("click", partyClick, { signal: hubSignal });
