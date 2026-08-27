# Game Prototype Instructions

How to spec, build, and integrate a new game in this repo. This replaces an earlier version of
this file that was written against a different, unrelated project — wrong database (Realtime DB
vs. the real Firestore), wrong transport (Socket.IO vs. the real raw `ws`), and a folder layout
(`games/`, `docs/`, `src/`, `archive/`) this repo doesn't use. Everything below matches the
actual codebase; see `PROJECT_MEMORY.md` for current per-game status and open technical debt.

---

## 1. Hard constraints (do not violate)

- **`file://` compatibility is required.** Games must run via double-click, no server, no
  build step. Classic `<script>` tags, not real ES modules — **with one accepted exception**:
  a game that wants Firestore leaderboard integration must load `firebase-config.js` via
  `<script type="module">`, which `file://` refuses to load. The game should still degrade
  gracefully (everything else on the page works; only the score-submission piece silently
  no-ops) when opened locally instead of served over http(s). See `PROJECT_MEMORY.md` →
  Technical Debt for the full note.
- **Color/identity is name-hash based (djb2-style), never session-ID based** — it must survive
  reconnects and match across the hub and every game a player visits. **As of 2026-08-24 this
  is not actually centralized or server-side** (it's duplicated client-side in `index.html` and
  `space-tracer.html`); see `PROJECT_MEMORY.md` for the open decision on fixing that before more
  games adopt the pattern. Whichever way that's resolved, treat it as the one true identity
  source — don't invent a second hashing scheme in a new game.
- **All timers go through `trackTimeout`/`trackInterval`; all listeners through one
  `AbortController`**, so a game's teardown (however it's eventually triggered) can fully clean
  up. No current game is embedded/torn down dynamically yet (see §2), but write new games this
  way regardless — it's cheap to do up front and expensive to retrofit.

---

## 2. How games are actually structured (as of this repo's 2026-08-24 restructure)

- **One game = one top-level folder at the repo root**, folder name matching the game's slug
  (`javelin-battle/`, `gyro-space/`, etc.), containing that game's `.html` file under its
  original filename plus any assets it owns (audio, images). Not `games/<name>/index.html` —
  that's a different project's convention.
- **Every current game is a single self-contained `.html` file** with inline `<style>` and
  `<script>`. No game has been split into multiple classic-script files yet — that's an
  explicitly postponed, not-yet-started effort (see `PROJECT_MEMORY.md`). When a game does get
  split, run `node scripts/check-global-collisions.js` from the repo root before calling it
  done — it flags duplicate top-level identifiers across every script that loads on the same
  page.
- **The hub (`index.html`) links to each game as a separate full page**
  (`<a href="javelin-battle/javelin-battle.html">`), not an embedded `<div>`. **No current game
  implements `window.GameInstance`.** If/when embedding becomes the real target (so a
  `destroy()` teardown contract actually matters), that's a deliberate architecture decision to
  make explicitly — don't assume it's already true.
- **Shared infrastructure lives at the repo root**, not nested under a game: `firebase-config.js`
  (Firestore config, imported by any game wanting leaderboard integration — use `../firebase-config.js`
  from inside a game's own folder), `leaderboard.html`, `index.html`.

---

## 3. Multiplayer (when a game's "Multiplayer goal" is Yes)

Reference implementation: `gyro-space/space-tracer.html` + `gyro-space-server-main/server.js`
(a separate repo, deployed to Render, connected at `wss://my-games-faxi.onrender.com`).

**Pattern:**
- Client connects with `new WebSocket(SERVER_URL)`, sends `{type: "join-room", room, name, color}`
  on open. `room` defaults to `"public"` if the player left it blank.
- Server tracks rooms as `Map<roomCode, Map<playerId, {socket, player}>>`, created on first join
  and deleted when empty. It broadcasts `join`/`leave`/`players`(snapshot) to the room.
- Per-game live state (position, score, etc.) rides on top of that same room connection with
  whatever message types the game needs (`update`, `score-update`, etc. — see `server.js` for
  Gyro Space's actual message set). **Score/kill attribution in Gyro Space is
  victim-reported and trivially spoofable by a modified client** — accepted as fine for a
  3-10 person friend group; don't treat it as a bug to fix, it's a deliberate scope call
  documented in `server.js`'s own comments.
- Final score persistence (if the game wants a leaderboard) goes to Firestore directly from the
  client at game-end — the WebSocket server is for live coordination only, not persistence.

**Before wiring a new game into this pattern:** resolve the color/identity centralization
question in `PROJECT_MEMORY.md` first. Copying the current duplicated-hash approach into a
third file makes the eventual cleanup harder, not easier.

**Concurrency note:** Render's free tier is what this project runs on. It's fine for a
3-10 person friend group; don't design for larger scale than that without discussing it first.

---

## 4. Mobile & performance

No formal performance budget has been measured for any game in this repo — the generic targets
this document used to state (5000 particles desktop, 30fps mobile, etc.) were invented for a
different project, not measured here. If you need a real number, profile the actual game in
DevTools rather than assuming a target.

**What is known and real:**
- Most games in this repo are marked "Stable on mobile: No" in `Game dev tracking.xlsx` — mobile
  is a known weak spot across the roster, not a solved problem to build on top of by default.
- Gyro Space has a known mobile audio-freezing bug (top current priority to fix — see
  `PROJECT_MEMORY.md`).
- Audio playback requires a user gesture on mobile browsers; don't autoplay on load.

---

## 5. Firestore integration (only for games that want leaderboard support)

```javascript
import { firebaseConfig } from "../firebase-config.js"; // adjust ../ depth to the game's folder
```

See `gyro-space/space-tracer.html` and `leaderboard.html` for the real, working import and
usage pattern — copy their approach rather than inventing a new one. Remember: this requires
`<script type="module">`, so it only actually submits scores when the page is served over
http(s) (GitHub Pages in production; a local static server for testing — plain double-click
`file://` won't submit, per the hard-constraints note above).

---

## 6. Testing checklist

- [ ] Opens via double-click (`file://`) and is playable (Firestore submission may no-op — that's expected, not a bug)
- [ ] If multiplayer: join-room works, identity/color matches the hub, survives a reconnect
- [ ] Linked from `index.html`'s game grid, if it's meant to be hub-visible
- [ ] `node scripts/check-global-collisions.js` passes (once the game has more than one local script file)
- [ ] Status recorded in `Game dev tracking.xlsx`

---

## 7. Updating this document

Add to it when:
- A repeated architectural issue shows up across games (record it in `PROJECT_MEMORY.md`'s
  Recurring Technical Challenges section, then summarize the prevention step here)
- The server (`gyro-space-server-main/server.js`) gains a new message type other games should
  reuse
- A real, measured performance number replaces a guess

Track per-game history and decisions in `PROJECT_MEMORY.md`. Use `GAME_POSTMORTEM_TEMPLATE.md`
when a game reaches a stable, shipped state worth writing up.
