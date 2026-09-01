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
| `gyro-space/space-tracer.html` (Gyro Space) | Yes | Yes | Mostly — **known audio-freezing bug** | **Yes — on `mp-core` + `relay` since 2026-08-28** | Yes |
| `javelin-battle/javelin-battle.html` | Yes | Yes | No | No | No |
| `four-d-pong/four-d-pong.html` | Yes | Yes | No | No | No |
| `zombie/Zombie.html` | Yes | Yes | No | **Yes** (2026-08-24) | No |
| `boids/boids_1.html` | Yes | Yes | No | **Yes** (2026-08-25) | No |
| `rd-arena/RDArena.html` | Yes | Yes | No | No | No |  <!-- hub-linked 2026-08-28 -->
| `hex-grid/Hex Grid.html` | Yes | No | No | No | No |
| `glucose-dash/glucose-dash.html` (Glucose Dash) | Yes | Yes (solo) — **not yet playtested by a human** | No | Seed/identity only — **no ghosts on the wire yet** | No |
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

## Active priorities (updated 2026-08-28)

0. ⚠️ **The server needs another Render redeploy** — the hub lobby (leader election,
   ready-check, launch countdown, `_hub` namespace) was added to `server.js` on 2026-08-28 and
   is inert against the live URL until it ships. The hub degrades visibly rather than silently:
   the Continue button renders disabled and says the server needs the update.
   The *previous* rewrite (multi-game rooms, generic relay, host election, room seeds,
   server-side colour) does appear to be live — the hub's live cursors work in production,
   and only the rewritten server handles `cursor-update` at all.

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
no score is saved until the page is served over http(s) (GitHub Pages, or a local
`python -m http.server`).

**Corrected 2026-08-31:** this entry used to say the failure was silent ("no console-visible
crash, just no score saved"). It wasn't. `reportLifeEnded()` called the global
`submitScoreToFirebase(...)` bare, and over `file://` that global never exists, so **every
death threw a `ReferenceError` out of the middle of that function** — skipping the live score
relay to the room and the per-life counter resets that follow the call. Now guarded with
`typeof submitScoreToFirebase === "function"`. Worth generalising: a `window.x = ...` set from
a `type="module"` block is not a safe bare call from a classic script, because the two have
completely different load-failure modes — `typeof` is the only check that survives the
identifier never being declared at all.
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

### The room roster was a dead end on every phone (fixed 2026-08-28)

`#roomRoster` was a fixed-position sidebar: `right:0; width:240px; height:100vh`, widened to
`width:100%` under 768px while keeping `height:100vh`, with the content-offset padding applied
only at `min-width:769px`. On any narrow viewport, **joining a room covered the entire games
list with an opaque panel whose only control was "Change name / room."** There was no way
forward to the games at all. Desktop was unaffected, which is why it shipped.

Two related defects went with it: the roster never listed *you* (the server's `players`
snapshot excludes self and sends it separately as `you`; the hub never added itself back, and
the `.roster-player-you` style was dead), and the Zombie card carried Space Tracer's rocket icon.

Worth generalising: **a fixed-position panel that goes full-bleed at a breakpoint needs a way
out at that breakpoint.** The replacement is a top band, which can't cover anything.

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

### ✅ RESOLVED 2026-08-28 — Space Tracer was still colouring itself by session ID

PROJECT_MEMORY recorded the colour/identity debt as resolved on 2026-08-24, and for remote ships
it was: `space-tracer.html` renders other players with the colour the server sends. **Its own
ship was still `COLOR_PALETTE[data.id.charCodeAt(0) % len]`** — the session id. So your ship
changed colour every reconnect and never matched your own dot on the hub, while everyone else's
was correct. Now `MP.selfColor`.

The lesson: "identity is server-side now" was verified by looking at what the server sends, not
at what every client does with it. A resolved-debt note is worth re-checking per client.

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
| 2026-08-28 | Space Tracer migrated onto `shared/mp-core.js`: own namespace (`space-tracer:CODE`), generic `relay` instead of the legacy `update`/`score-update`/`kill-credit` types, hub identity instead of its own name/room screen, and server name-hash colour instead of session-ID colour. Added `MP.identity()`. |
| 2026-08-28 | Hub board grew to all 17 games with code (added `boids`, `rd-arena`, `hex-grid`, `reality-rewrite`); 6 per page; diagonal red stamps marking what can't be played together yet; cross-game presence so in-game players show in the hub roster without counting toward the ready-check. |
| 2026-08-28 | Hub reworked into a Wii-style paged board: fixed top/bottom buffers, 8 tiles per page, left/right paging, tiles sized from available space (no scrolling on any screen). Fixed the full-screen-roster dead end. Added a server-backed ready-check + 3s launch countdown, and moved the hub to its own `_hub` room namespace. See `HUB_LOBBY_PLAN.md`. |
| 2026-08-29 | Glucose Dash **v5**: perspective renderer removed, view rebuilt as a top-down 2D floor plan. Rationale worth generalising: across four revisions every graphical defect in this game traced to the projection (near-plane clipping, cross-category depth sorting, billboarded wall text, white-on-white silhouettes, a shadowing duplicate `quad()`), and 2D makes that whole class *unrepresentable* rather than fixed — no projection, no depth, draw order is source order. Upper floors read by drawing every level below first and covering it, so the visible drop and the fall test share one geometry source (`pathWalkable`, built from `walkLimit`). Gameplay untouched and re-measured identical (ground 123–130s, no-food 100% DNF, NPC 17%). 0.97ms/frame, down from 6.1. Old build kept at `glucose-dash-perspective.html.bak`. |
| 2026-08-29 | Glucose Dash **v4**: replaced fixed category draw order with a depth-sorted painter (one queue keyed by centroid depth + a tie-break bias, sprites included), fixing "stairs drawing behind shops" and upper-floor layering. **Also corrected a v3 claim:** the near-plane clipping added in v3 had been dead code — an older immediate-mode `quad()` survived the refactor 76 lines further down the same file and shadowed it, since a later function declaration wins. Worth generalising: `check-global-collisions.js` only compares identifiers ACROSS files, so duplicate definitions *within* a single-file game are exactly what it cannot see. |
| 2026-08-29 | Glucose Dash **v3**: graphics pass + course rework. Fixed the renderer's biggest defect — `quad()` discarded any polygon with a corner behind the near plane, so corridor walls were deleted a frame before you reached them (read as "the floor just ends"); now real Sutherland-Hodgman near-plane clipping. Store names painted onto the wall plane per-character in perspective instead of billboarded; all floors above always visible; draw distance +50%; hazard-striped fall edges. Course doubled to 3300 and **curved** via a `centerX(y)` centreline applied only in `toCam()` — physics/AI stay in flat track space, so curvature carried zero gameplay risk. Doubling exposed three constants silently scaled to the old length (NPC starvation horizon, food supply, NPC crash weighting). Final: no-food 100% DNF, ground 8% @124.5s, top floor 0% @126.6s, NPCs 15% DNF. |
| 2026-08-29 | Glucose Dash **v2**: light mall aesthetic (white walls, white checkered floor, colourful storefronts), close camera inside the corridor, rounded runners with white heads. Mechanically, the upper floors narrowed (half-widths 11 / 7.5 / 5) and lost their railings, so **you can now fall off them** — ~2.5s and all your momentum, cascading. Measured: climbing to floor 2 is the strongest line (63.1s, 0/10 DNF) vs a ground-only route at the same speed but a 3/10 DNF gamble; floor 3 is the safest and slowest. Three fairness bugs found and fixed — see `glucose-dash/SCOPE.md` §5. |
| 2026-08-29 | New game: **Glucose Dash** (`glucose-dash/`) — overhead mall footrace where the resource is blood glucose. Solo-complete, not hub-linked. First game in the repo to implement `window.GameInstance` (teardown round-trip verified). Balance was driven headlessly rather than played: 10-seed sim shows a food-free run DNFs 10/10, well-played runs land 62–66s, NPCs 62–84s. Two bugs that found: wall friction compounding 60x/sec (also hit the player — brushing a wall nearly stopped you), and no exit from the upper floors past the finish. See `glucose-dash/SCOPE.md`. |
| 2026-08-31 | Space Tracer gameplay pass. **Death** now goes through one `onLocalDeath()` instead of the same four lines copy-pasted at all three death sites — which is precisely why *no* site reset dash or beam charge: you could shoot from a dead ship, and a dash charged while dead fired on respawn. Firing and dash inputs now gate on `ship.isAlive`. **Best score is live** — it used to move only inside `reportLifeEnded()`, so a record-setting life showed nothing until it ended; it now promotes as it passes, rides the existing 10Hz `pos` payload as `best` so other players' bests climb live too, and both consumers keep the max (a bad life used to overwrite a good one on everyone's board). Panel render is throttled to 5Hz off a dirty flag. **Charged beam** gained slight homing (rate-limited turn, forward cone, ships only) and one ricochet off border / safe-zone shell / asteroids; `firedAt` and `maxDistance` re-base at the bounce point so the fade still measures total travel after a direction change. Also fixed the `file://` Firebase `ReferenceError` above. Verified with a headless harness (stubbed DOM, 38 assertions) — see `gyro-space/SPACE_TRACER_CLEANUP_PLAN.md`. |
| 2026-08-24 | Promoted 5 concept games (glass-city-escape, particle-simulation, infected-labyrinth, wasteland-train-sim, and the newly-surfaced kula-world) from `z. Unfinished Concepts/` into their own repo folders. Not yet linked from the hub or verified stable. |
