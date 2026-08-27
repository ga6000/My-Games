# Project Memory

Living record of what's actually shipped, what's broken, and where this is headed. Update this
whenever a game's status changes, a recurring bug gets solved, or a roadmap decision is made.
This replaces an earlier version of this file that described an unrelated project (wrong repo
path, wrong database, wrong folder layout) — everything below reflects the real repo.

---

## Project overview

**Vision:** A small hub of browser-playable game prototypes for a ~3-10 person friend group,
served as static files from GitHub Pages, with an increasing share supporting shared
multiplayer rooms.

**Real stack (not the generic template stack):**
- Frontend: vanilla JavaScript + HTML5 Canvas, one self-contained `.html` file per game
- Multiplayer: raw `ws` WebSocket server (`gyro-space-server-main/server.js`), **not** Socket.IO
- Persistence: **Firestore** (not Realtime Database) via `firebase-config.js`, shared by
  `leaderboard.html` and `gyro-space/space-tracer.html`
- Hosting: GitHub Pages (repo `ga6000/My-Games`) for the games; Render (free tier) for the
  WebSocket server, deployed from the separate `gyro-space-server` repo
- No build step, no bundler, no npm runtime deps in the browser — `package.json` here is
  dev-only tooling (the collision checker), never shipped to the client

**Folder layout (as of the 2026-08-24 restructure):** each game lives in its own top-level
folder at the repo root (`gyro-space/`, `javelin-battle/`, etc.) with its original filename
kept. `index.html`, `leaderboard.html`, and `firebase-config.js` stay at the repo root as
shared hub-level infrastructure. There is no `games/`, `docs/`, `src/`, or `archive/`
subfolder structure — that was an artifact of docs generated against a different project.

---

## Games — current status

Source of truth: `Game dev tracking.xlsx` (outside this repo, in the local working folder).
Pull the latest numbers from there before trusting this table if it's been a while.

| Game | Multiplayer goal | Stable | Stable on mobile | Server-integrated | Firestore-integrated |
|---|---|---|---|---|---|
| `gyro-space/space-tracer.html` (Gyro Space) | Yes | Yes | Mostly — **known audio-freezing bug** | Yes | Yes |
| `javelin-battle/javelin-battle.html` | Yes | Yes | No | No | No |
| `four-d-pong/four-d-pong.html` | Yes | Yes | No | No | No |
| `zombie/Zombie.html` | Yes | Yes | No | **Yes** (2026-08-24) | No |
| `boids/boids_1.html` | Yes | Yes | No | **Yes** (2026-08-25) | No |
| `rd-arena/RDArena.html` | Yes | Yes | No | No | No |
| `hex-grid/Hex Grid.html` | Yes | No | No | No | No |
| `reality-rewrite/reality-rewrite.html` | Yes | Yes (tracker) / open task per its own CLAUDE.md — verify | No | No | No |
| `desert-robot-blaster/desert-robot-blaster.html` | Not sure — **long-term Unity candidate, not a near-term web priority** | Yes | No | No | No |
| `fruit-dropper/fruit-dropper.html` | **No** (not a multiplayer target) | Yes | Yes | No | No |
| `ps1-racer/ps1racer.html` | — | **Not functioning / underdeveloped — but now linked from the hub** | No | No | No |
| `voice-runner/voice-runner.html` | — | **Not functioning / underdeveloped — but now linked from the hub** | No | No | No |
| `glass-city-escape/glass_city_escape.html` (City Grid Escape / building-hopping) | — | Unverified — not yet played through by Claude | Unverified | **Yes** (2026-08-25, race mode) | No |
| `particle-simulation/particle_simulation_game.html` (Particle experiment) | — | Unverified | Unverified | No | No |
| `infected-labyrinth/infected-labyrinth.html` (zombie maze — "maybe similar to Zombie") | — | Unverified | Unverified | No | No |
| `wasteland-train-sim/wasteland_train_sim.html` (Train Zombie Game) | Not sure — **long-term Unity candidate, not a near-term web priority** | Unverified | Unverified | No | No |
| `kula-world/kula_world_fixed.html` (Kula World — Three.js rolling-cube puzzle) | — | Unverified | Unverified | No | No |

Added 2026-08-24: these five were dropped as loose HTML into `z. Unfinished Concepts/` (four
matching the backlog concepts below, plus Kula World as a new addition not previously in
`Game dev tracking.xlsx`), then promoted into the repo, each in its own folder, once confirmed.
None have local asset dependencies (Kula World pulls Three.js from a CDN; the rest are fully
self-contained) — the folder moves were pure relocations, nothing needed a path fix.
`Game dev tracking.xlsx` has been updated to reflect their new folder paths and reorganized
out of the old "(Html Only)" section into the main Games List.

**Now linked from `index.html`'s hub grid** (added 2026-08-24, at the user's request) —
**unlike the `ps1-racer`/`voice-runner` precedent, these were added without a playtest pass
first.** None of the five have been verified stable/playable by Claude; treat their hub cards
as provisional until someone actually plays through each one.

**Idea only:** Depth Diver — name only, no spec yet.

---

## Active priorities (updated 2026-08-25)

0. ⚠️ **The server changes are not deployed yet.** `gyro-space-server` has been rewritten
   (multi-game rooms, generic relay, host election, room seeds, server-side colour) but needs a
   Render redeploy before any of the new multiplayer works against the live URL. Until then
   Zombie / Glass City / boids fall back to solo. The user is handling the redeploy.
1. **Fix the Gyro Space audio-freezing bug.** Still open.
2. **Finish `ps1racer.html` and `voice-runner.html`.** Both are marked not-functioning and both
   are linked from the hub, so a friend clicking either card today hits a known-broken game.
3. ✅ **DONE** — colour/identity hash is now server-authoritative.
4. **Multiplayer rollout** — see `MULTIPLAYER_PLAN.md` for the full architecture and per-game
   sync models.
   - ✅ Zombie (host-authoritative co-op), Glass City Escape (race), boids (competitive)
   - ⬜ **RDArena** — the hard one, deserves its own session (160k-cell reaction-diffusion field)
   - ⬜ Still untouched: javelin-battle, four-d-pong, hex-grid, reality-rewrite
5. Unity migration (`desert-robot-blaster`, Train Zombie Game) is a someday/maybe note only —
   don't let it shape current web-prototype architecture decisions.

### Multiplayer architecture in one line
One shared server, rooms namespaced `game:code`, a **generic `relay` message** so new games need
zero server changes, plus server-issued **room seeds** (the thing that makes every client build
the same world) and **host election** for games that actually have shared state. Client side is
one shared file, `shared/mp-core.js`, exposing a single global `MP`.

---

## Technical debt

### ✅ RESOLVED 2026-08-24 — Color/identity hash is now server-side

The server computes colour from the player name (same djb2 + palette the clients were using, so
existing clients see no behavioural change) and sends it back as authoritative. Clients use what
they're given. `mp-core.js` exposes it as `MP.selfColor`. The original problem statement is kept
below for context.

### (Historical) Color/identity hash was client-side, not server-side

Root `CLAUDE.md`'s hard constraints say color/identity assignment is "server-side, name-hash
based." **The actual implementation is client-side**: both `index.html` and
`gyro-space/space-tracer.html` independently run the same djb2-style hash in JS and send the
resulting color to the server in the `join-room` message; `server.js` just does
`if (data.color) player.color = data.color;` — it trusts whatever it's given, it doesn't
compute anything itself.

**Why this matters for the rollout:** every new game that joins a room needs this same
palette + hash function. Right now that logic is duplicated (and could silently drift) between
two files. Before wiring up the pilot game, decide:
- **Option A — make it actually server-side:** server computes color from `name` on join,
  ignores/discards any client-sent color. Matches the documented constraint exactly; one
  source of truth; no per-game duplication possible.
- **Option B — keep it client-side but centralize it:** extract `COLOR_PALETTE` +
  `hashStringToIndex` + `getColorFromName` into one shared script (e.g. `identity.js` at repo
  root) that every game's HTML includes via a classic `<script src="../identity.js">` tag, and
  update root `CLAUDE.md`'s hard constraint to describe reality instead of the aspiration.

Not decided yet — flagging for the next planning pass, before the pilot game starts.

### `firebase-config.js` needs http(s), which conflicts with the file:// hard constraint

Root `CLAUDE.md` requires games to run via double-click (`file://`, no server). But
`space-tracer.html` and `leaderboard.html` load `firebase-config.js` via
`<script type="module">`, which browsers refuse to load over `file://`. In practice this means:
opened locally by double-click, Gyro Space and the leaderboard still load and mostly work, but
the Firestore score-submission piece silently fails (no console-visible crash, just no score
saved) until the page is served over http(s) (GitHub Pages, or a local `python -m http.server`).
This is an accepted, working tradeoff today — noting it here so it's not "discovered" again as
a surprise bug during the multiplayer rollout, since every newly-integrated game will hit the
same constraint if it also wants Firestore leaderboard support.

### `reality-rewrite.html` status conflict

The tracking spreadsheet marks it "Stable: Yes," but `reality-rewrite/CLAUDE.md` (its own
file-map doc) lists an open task: "`init()`/`getState()` need verifying against
[the GameInstance contract] ... before marking a phase complete." Worth reconciling before this
game is picked as the multiplayer pilot.

---

### Three hub features were dead in production (fixed 2026-08-24)

Found while restructuring the server. `index.html` had been sending `vote-update` and
`cursor-update` since the group-play panel was added, and expected a `votes` snapshot on join —
**the server had no handler for any of them.** The vote checkmarks and live cursors did nothing
in production. Separately, the server's `leave` message omitted `name`, but the hub's leave
handler keys off the name, so departed players were never removed from the roster despite a
code comment claiming they were. All four are now implemented and covered by tests.

The lesson worth keeping: `index.html` carried detailed comments describing behaviour that
could not happen. Comments describing a protocol are not evidence the other side implements it —
check both ends.

## Recurring technical challenges (real, observed in this repo)

### No game generated a deterministic world (partially fixed 2026-08-24)
Every game built its world with unseeded `Math.random()`, including `space-tracer.html` — whose
`seedAsteroidField()` takes no seed, meaning **every player in a Gyro Space room right now is
flying through a different asteroid field.** That's survivable there (asteroids are scenery) but
fatal anywhere the world is the game. Fixed for Zombie via the server-issued room seed +
`MP.random()`; still outstanding for every other game.

### Gyro Space mobile audio freezing
**Symptom:** Audio playback (`Gyro Music.mp3`, the `pit-pit-pit-*` / `thwop*` sound effects)
freezes on mobile during play. **Status:** Open — flagged as the top priority fix.
**Root cause:** not yet diagnosed.

### `render.js` clobbering regression (reality-rewrite)
Per `reality-rewrite/CLAUDE.md`: `render.js` has previously overwritten CSS values on every
call (the "vignette regression"). Relevant if/when reality-rewrite gets its planned 6-file
split or is picked for the multiplayer pilot — check it isn't clobbering state another module
set.

### Games are single monolithic HTML files, not the classic-script split described in root CLAUDE.md
Root `CLAUDE.md` describes a target architecture of classic `<script src>` tags split across
files sharing one global scope (hence the collision checker). **Every current game is still one
`.html` file with inline `<script>`.** The split is explicitly postponed by the user
("long term plan is to segment game scripts into independent files but this can be postponed
based on usage allowance") — not a bug, just not started yet. `reality-rewrite/CLAUDE.md`
documents what its eventual 6-file split should look like, as a reference for whichever game
gets split first.

### The `GameInstance` embed contract doesn't match how the hub actually works
Root `CLAUDE.md` and the (now-rewritten) `GAME_PROTOTYPE_INSTRUCTIONS.md` describe games
exposing `window.GameInstance` with `init(containerId)` — implying games get embedded into a
container div. **Today, the hub (`index.html`) links to each game as a separate full page**
(`<a href="javelin-battle/javelin-battle.html">`), not an embedded div. No current game
implements `window.GameInstance`. Whether embedding is still the intended direction, or whether
the lifecycle contract (`init`/`start`/`pause`/`resume`/`destroy`/`getState`, teardown via
`trackTimeout`/`trackInterval`/`AbortController`) should be reframed for something that doesn't
assume embedding, hasn't been decided — flagging so it isn't silently assumed either way.

---

## Design & aesthetic patterns

Not yet standardized across games — each game currently has its own visual identity (Gyro
Space is a neon-on-dark space aesthetic; others vary). No shared palette or typography system
exists yet. Worth deciding whether the hub wants visual consistency across games or whether
each staying distinct is fine, given they're prototypes for a small friend group rather than a
polished product line.

---

## Deployment checklist (per game, as actually practiced here)

- [ ] Runs via double-click (`file://`) — or, if it needs Firestore, degrades gracefully when
      opened that way (see the `firebase-config.js` note above)
- [ ] If multiplayer: room-join works, identity/color survives reconnect, matches across the
      hub and the game itself
- [ ] `node scripts/check-global-collisions.js` passes, once the game has more than one local
      script file
- [ ] Linked correctly from `index.html`'s game-card grid (if it's meant to be hub-visible —
      note `ps1racer.html` and `voice-runner.html` currently aren't linked there at all)
- [ ] Tracked in `Game dev tracking.xlsx` with current stability/mobile/server/Firestore status

---

## Revision history

| Date | Change |
|---|---|
| 2026-08-24 | Restructured repo into per-game folders; moved tooling into `scripts/`/`.githooks/`. |
| 2026-08-24 | Replaced a generic, non-matching version of this file (wrong repo path, wrong DB, wrong folder layout, phantom git history) with this one, grounded in the actual codebase and `Game dev tracking.xlsx`. Captured real priorities: fix Gyro Space audio bug → finish ps1racer/voice-runner → centralize color hash → pilot multiplayer rollout. |
| 2026-08-24 | Promoted 5 concept games (glass-city-escape, particle-simulation, infected-labyrinth, wasteland-train-sim, and the newly-surfaced kula-world) from `z. Unfinished Concepts/` into their own repo folders. Not yet linked from the hub or verified stable. |
