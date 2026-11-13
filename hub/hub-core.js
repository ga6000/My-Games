// ===================================================
//   Hub — manifest, teardown, identity, elements, state
// ===================================================
// Split out of index.html's inline script 2026-09-04 (Pass A of
// hub/HUB_PASS_PLAN.md). The lines below were MOVED VERBATIM -- Pass A
// deliberately changed no behaviour, so that any regression could be
// attributed to the skin pass that followed rather than to the split.
//
// Classic scripts, one shared global scope, no modules (the file://
// constraint). Loads FIRST: everything else reads the state declared here.
"use strict";

// ===================================================
//   GAME MANIFEST
// ===================================================
// The tiles used to be 14 hardcoded <a> blocks. Paging can't work
// against hardcoded markup -- which page a game lands on has to be
// computed -- so the list is data now and the markup is generated.
// Order is unchanged from the old grid, so anyone used to where a game
// sat still finds it in the same place, just possibly on page 2.

// mp:true     -- plays together over the server today (no stamp)
// broken:true -- PROJECT_MEMORY marks it not-functioning
// Everything else works, but only on your own screen.
//
// Scope pullback 2026-09-04: this list was 17 games and is now 5. Twelve
// were not developed enough to hand to anyone and moved to
// under-development/ -- boids, javelin-battle, fruit-dropper, four-d-pong,
// desert-robot-blaster, voice-runner, infected-labyrinth, kula-world,
// particle-simulation, wasteland-train-sim, ps1-racer, hex-grid. They are
// still in the repo, just not reachable from the board. Re-add an entry
// here (and move the folder back up) when one is ready. See
// SCOPE_PULLBACK_PLAN.md.
//
// SWAP 2026-09-06, at the user's request: Reality Rewrite went DOWN to
// under-development/ and 4D Pong came UP, in its slot. The board stays at
// five. Reality Rewrite is shelved, not deleted -- it keeps its six-file
// split, its GameInstance, its audio and its skin, and every one of them
// still works; it simply has no card. 4D Pong was rebuilt on the way up
// (1-4 players, the dual-barbell tug-of-war, and all three filters); see
// four-d-pong/FOUR_D_PONG_PLAN.md. It went ONLINE the same evening
// (four-d-pong/ONLINE_PLAN.md) and so carries `mp: true`, not `couch: true`.
//
// Nothing carries broken:true any more -- every card left opens something
// that runs -- but the flag and its "COMING SOON" stamp are kept, since
// that is exactly the state a game returning from under-development/ will
// be in.
//
// Order: the ones you can actually play together come first, then the
// rest. Boids used to be the fourth and went to the shelf with the others.
//
// 2026-09-08: RD Arena took `mp: true` (rd-arena/MP_BUILD_NOTES.md), so ALL
// FIVE board games now play together and nothing on the board carries the
// MULTIPLAYER SOON stamp any more. The stamp machinery below stays wired up --
// it is what the shelf will come back through.
// All 6 fit on one page at PAGE_SIZE = 6 (Scuba Shooter made six on
// 2026-11-02), so paging is still a no-op; a seventh card starts page 2.
const GAMES = [
    // 2026-11-13 (Ry): the board is the STORY, drawn as a level select. Every
    // entry carries the `act` it belongs to, and the order here is the order
    // inside its act's column, top to bottom. `soon: true` is a chapter that
    // is planned but has nothing to open yet: it is drawn on the path, dark,
    // and cannot be voted. `party: true` is a game that reports a score to a
    // session (shared/party.js).
    //
    // ACT I · LANDFALL
    { id: "alien-outpost",        act: 1, title: "Alien Outpost",        desc: "The Meatball Comes Down",        soon: true },
    // 2026-11-02: Scuba Shooter joined on Ry's call (solo, so the SOLO stamp).
    { id: "scuba-shooter",        act: 1, title: "Scuba Shooter",        desc: "Oil-Rig Dive Shooter",           href: "scuba-shooter/scuba-shooter.html", solo: true },
    // ACT II · SPREAD
    // ONE Zombie again, 2026-09-26 (`zombie-alt/` was merged back; the
    // pre-merge Zombie is `ae0f19d` if it is ever wanted).
    { id: "zombie",               act: 2, title: "Zombie",               desc: "The Inspired At The Gate",       href: "zombie/Zombie.html", mp: true, party: true },
    { id: "glass-city-escape",    act: 2, title: "Glass City Escape",    desc: "Rooftop Run Above The Swarm",    href: "glass-city-escape/glass_city_escape.html", mp: true },
    { id: "four-d-pong",          act: 2, title: "4D Pong",              desc: "Bat The Tendrils Back",          href: "four-d-pong/four-d-pong.html", mp: true, party: true },
    // ACT III · ESCALATION
    { id: "hurl-strike",          act: 3, title: "Hurl Strike",          desc: "Orbital Rail Shooter",           soon: true },
    { id: "rd-arena",             act: 3, title: "RD Arena",             desc: "Belly Of The Beast",             href: "rd-arena/RDArena.html", mp: true },
    // ACT IV · LAUNCH
    { id: "code-racer",           act: 4, title: "Desert Code Racer",    desc: "Carry The Launch Codes",         soon: true },
    { id: "cliff-run",            act: 4, title: "Cliff Run",            desc: "Up The Mountain Base",           soon: true },
    { id: "text-editor-wars",     act: 4, title: "Text Editor Wars",     desc: "The Inspired Hack The Launch",   soon: true },
    // ACT V · COUNTERATTACK
    { id: "space-tracer",         act: 5, title: "Space Tracer",         desc: "First Fights In Orbit",          href: "gyro-space/space-tracer.html", mp: true, party: true },
    { id: "gyro-fleet",           act: 5, title: "Gyro Fleet",           desc: "Out To The Tide",                soon: true }
];

// The five acts of the story (names accepted by Ry 2026-11-08). One column
// each on the board, in this order, with a break between them.
const ACTS = [
    { n: 1, numeral: "I",   name: "LANDFALL" },
    { n: 2, numeral: "II",  name: "SPREAD" },
    { n: 3, numeral: "III", name: "ESCALATION" },
    { n: 4, numeral: "IV",  name: "LAUNCH" },
    { n: 5, numeral: "V",   name: "COUNTERATTACK" }
];

// Derived once rather than written per game, so "does this play
// together" stays one fact per entry instead of two that can drift.
//
// `couch: true` was added 2026-09-06 with 4D Pong, which was then couch-only:
// `mp` means "plays together OVER THE SERVER", and stamping MULTIPLAYER SOON on
// a game whose headline feature is four people at one keyboard would have been
// actively false.
//
// **4D Pong graduated to `mp: true` later the same day** -- it now plays online,
// host-authoritative, 2-4 players -- so this clause currently has no user. It
// stays because the state it describes is real and will come back: javelin-battle
// on the shelf is couch-only two-player, and the board should be able to say so
// rather than promising it multiplayer that is not coming.
GAMES.forEach(g => {
    if (g.soon) { g.stamp = "IN DEVELOPMENT"; return; }
    if (g.mp) return;
    if (g.couch) { g.stamp = "COUCH 2-4P"; return; }
    if (g.solo) { g.stamp = "SOLO"; return; }   // single-player by design, no multiplayer promised
    g.stamp = g.broken ? "COMING SOON" : "MULTIPLAYER SOON";
});


function gameById(id) {
    return GAMES.find(g => g.id === id) || null;
}



// ===================================================
//   TEARDOWN PLUMBING
// ===================================================
// Root CLAUDE.md's hard constraint: every timer through
// trackTimeout/trackInterval, every listener through one
// AbortController. The hub isn't a GameInstance and isn't embedded
// anywhere today, but it now owns a countdown, a reconnect timer and a
// pile of listeners, and the constraint is cheap to honour up front and
// expensive to retrofit.
const hubAbort = new AbortController();
const hubSignal = hubAbort.signal;
const timeouts = new Set();
const intervals = new Set();

function trackTimeout(fn, ms) {
    const id = setTimeout(() => { timeouts.delete(id); fn(); }, ms);
    timeouts.add(id);
    return id;
}

function trackInterval(fn, ms) {
    const id = setInterval(fn, ms);
    intervals.add(id);
    return id;
}

function clearTracked(id) {
    clearTimeout(id);
    clearInterval(id);
    timeouts.delete(id);
    intervals.delete(id);
}

function destroy() {
    timeouts.forEach(clearTimeout);
    intervals.forEach(clearInterval);
    timeouts.clear();
    intervals.clear();
    hubAbort.abort();
    if (socket) { socket.onclose = null; socket.close(); }
}



// ===================================================
//   IDENTITY
// ===================================================
// The server computes color from the name and hands it back as
// authoritative (see server.js). Every use below is a FALLBACK only --
// for a player we've heard about but have no color for yet.
//
// The palette + hash USED to be copied into this file. They now live in
// `shared/identity.js`, the single client-side implementation, because
// three copies had drifted: this one, the server's, and reality-rewrite's
// (which used a different scheme entirely and agreed with the server 0
// times out of 10). Don't reintroduce a local copy -- call IDENTITY.
// `node scripts/check-identity-parity.js` proves it still matches the server.
// ?server=ws://localhost:8123 points the hub at a local server, the same
// override shared/mp-core.js has had since the start. gameHref() carries it
// into the game, so a local test stays on one server end to end.
const SERVER_OVERRIDE = (function () {
    try { return new URLSearchParams(window.location.search).get("server") || ""; }
    catch (e) { return ""; }
})();
const SERVER_URL = SERVER_OVERRIDE || "wss://my-games-faxi.onrender.com";

// Thin alias so the call sites below read as they always did.
const getColorFromName = (name) => IDENTITY.colorFromName(name);



// ===================================================
//   ELEMENTS
// ===================================================
const roomCodeEl = document.getElementById("roomCode");
const playerStrip = document.getElementById("playerStrip");
const changeIdentityBtn = document.getElementById("changeIdentityBtn");

const tileGrid = document.getElementById("tileGrid");
const pageDots = document.getElementById("pageDots");
const pagePrev = document.getElementById("pagePrev");
const pageNext = document.getElementById("pageNext");

const continueBtn = document.getElementById("continueBtn");
const continueLabel = document.getElementById("continueLabel");
const continueDots = document.getElementById("continueDots");
const continueHint = document.getElementById("continueHint");

const countdownOverlay = document.getElementById("countdownOverlay");
const countdownNumber = document.getElementById("countdownNumber");
const countdownGame = document.getElementById("countdownGame");

const identityOverlay = document.getElementById("identityOverlay");
const identityNameInput = document.getElementById("identityNameInput");
const identityRoomInput = document.getElementById("identityRoomInput");
const identityJoinBtn = document.getElementById("identityJoinBtn");

const pathLayer = document.getElementById("pathLayer");
const tickerEl = document.getElementById("ticker");
const partyBar = document.getElementById("partyBar");
const partyOverlay = document.getElementById("partyOverlay");



// ===================================================
//   STATE
// ===================================================
let socket = null;
let myName = "";
let myRoom = "";
let reconnectTimer = null;

// name -> {color}. Unlike the old hub this DOES include you: the server's
// player snapshot excludes self (it sends you separately as `you`), and
// the old code never added itself back, so your own dot never appeared.
// It's load-bearing now -- "everyone is ready" can't be counted from a
// roster that's missing a person.
const roomMembers = {};

// gameId -> Map<voterName, color>. Grouped by game because rendering
// always asks "who voted for THIS tile" -- one lookup per tile, rather
// than scanning every voter for each tile.
const votesByGame = new Map();

function voteMapFor(gameId) {
    if (!votesByGame.has(gameId)) votesByGame.set(gameId, new Map());
    return votesByGame.get(gameId);
}

// Players in this room code who are inside a GAME rather than on the
// hub. They show in the roster but are never counted by the ready-check:
// nobody can click Continue from inside Zombie, so counting them would
// stall every launch. See presenceFor() in server.js.
let presenceList = [];

// Lobby state, server-authoritative once a "lobby" message has arrived.
let serverLeaderGameId = null;
let readyNames = [];
let isLaunching = false;

// Whether the server we're actually talking to implements the lobby
// protocol. The hub has shipped code for a protocol the server didn't
// implement once before (votes and cursors did nothing in production for
// weeks) -- so the lobby only counts as up once a "lobby" message has
// actually arrived. Until then the hub says so and offers a clearly
// labelled solo launch instead (HUB_LOBBY_PLAN.md §9c; this used to be a
// visibly disabled Continue button, back when tiles were still links).
let serverHasLobby = false;

// The party session, as the server last described it (hub-party.js), or
// null. `serverHasSessions` goes true on the first "session" message, which
// a server older than 2026-11-13 never sends: the PARTY button stays hidden
// rather than offering something that would silently do nothing.
let partySession = null;
let serverHasSessions = false;

// Connection attempts that have closed since the last one that opened. Zero
// means the first attempt is still pending -- a cold Render start (tens of
// seconds) and a server that is simply down look identical until one fails.
let connectFailures = 0;

// A game picked while the lobby isn't up: still connecting, unreachable, or
// offline. Tiles are votes now, not links (HUB_LOBBY_PLAN.md §9), so without
// this a hub that can't reach the server could open nothing at all. The pick
// drives a PLAY SOLO button, and becomes a real vote once the lobby comes up.
let offlinePick = null;

let currentPage = 0;

// A page is a run of ACT columns. How many fit side by side depends on the
// screen (hub-layout.js sets it): all five on a wide one, fewer on a phone,
// and the arrows walk through the story.
let actsPerPage = 5;

function pageCount() {
    return Math.max(1, Math.ceil(ACTS.length / actsPerPage));
}

function actsOnPage(page) {
    return ACTS.slice(page * actsPerPage, page * actsPerPage + actsPerPage);
}

function gamesInAct(n) {
    return GAMES.filter(g => g.act === n);
}

function pageOfGame(id) {
    const g = gameById(id);
    if (!g) return 0;
    return Math.floor(ACTS.findIndex(a => a.n === g.act) / actsPerPage);
}



// ===================================================
//   HELPERS
// ===================================================
function escapeHtml(s) {
    const div = document.createElement("div");
    div.textContent = String(s == null ? "" : s);
    return div.innerHTML;
}

function escapeAttr(s) {
    return escapeHtml(s).replace(/"/g, "&quot;");
}


