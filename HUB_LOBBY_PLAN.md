# Hub Lobby Rework — Plan

Written 2026-08-28 before any code changes, per root `CLAUDE.md` ("for anything nontrivial,
write the plan to a markdown file before editing"). Covers the hub's paged Wii-style board,
the room overlay that replaces the full-screen roster, and the server-side ready-check.

Decisions below were made by the user on 2026-08-28; where a decision closes off an
alternative, the alternative is recorded so a later session doesn't re-open it blind.

---

## 1. The bug being fixed

`#roomRoster` is `position:fixed; right:0; width:240px; height:100vh`, and the `max-width:768px`
media query widens it to `width:100%` while leaving `height:100vh`. `body.roster-active`'s
content padding only applies at `min-width:769px`. So **on any narrow viewport, joining a room
covers the entire games list with an opaque panel whose only control is "Change name / room."**

It is not a missing button. It is a sidebar that eats the viewport. Desktop was unaffected,
which is why it shipped.

Two adjacent defects fixed at the same time:

- The roster never lists **you** — the server's `players` snapshot excludes self
  (`server.js`, `.filter(p => p.player.id !== id)`) and the hub never adds itself back from the
  `you` field it is already sent. `.roster-player-you` is styled but never rendered.
  This becomes load-bearing: "all players have clicked continue" needs a roster including self.
- The Zombie card used the 🚀 icon (copy-paste from the Space Tracer card directly above it).

---

## 2. Decisions (locked)

| Question | Decision | Rejected alternatives |
|---|---|---|
| What reveals Continue | **Unique vote leader** — strictly more votes than any other game. A tie shows no button. | Unanimous vote (deadlocks at 7/8); any-vote (target shifts under people); explicit host pick (second interaction to discover) |
| Board sizing | **Same games per page everywhere, shape reflows** — page 1 is the same 8 games for all players; only rows x cols change per viewport | Pixel-identical scaled board (unreadable on portrait phones); fully adaptive tile count (players literally on different pages) |
| Ready-check transport | **Server-side state + server-run countdown**, mirroring the existing `vote-update` | Generic `relay` (no snapshot for late joiners, per-client timer drift) |
| Countdown cancel rules | **Strict** — every player in the room must be ready; cancels on un-ready, leader change, or a new player joining | Ignore late joiners; force-start escape hatch; majority-start |

**Consequence of "server-side": this needs a Render redeploy of `gyro-space-server` before the
ready-check works in production.** Until then the hub still works (browse, page, vote, cursors)
and the Continue button renders in a visibly disabled state that says why — see §5.

---

## 3. Namespace change: the hub moves off `_legacy`

The hub sends no `game` field on `join-room`, so it lands in `_legacy:CODE`. **So does
`space-tracer.html`** (`server.js`'s `LEGACY_GAME` fallback). A friend already playing Space
Tracer is therefore in the hub's room right now, and under strict unanimity would sit there
un-ready forever and deadlock every launch.

**Fix: the hub joins with `game: "_hub"`.** Room key becomes `_hub:CODE`. The ready-check
population is then exactly "people looking at the hub," which is what the rule means.

Accepted losses, both small:

- Space Tracer players drop out of the hub roster. Zombie / boids / Glass City players already
  weren't in it (they pass their own `game` ids via `mp-core.js`), so this makes the roster
  consistent rather than introducing a new gap.
- During the deploy window, a friend on a cached copy of the old hub is in `_legacy:CODE` while
  a friend on the new hub is in `_hub:CODE`, so they won't see each other. Resolves on reload.

---

## 4. Server changes (`gyro-space-server-main/server.js`)

Room gains `lobby: { leader, ready: Set<voterName>, timer, launching }`.

- `computeLeader(room)` — strict plurality over `room.votes`; `null` on a tie or no votes.
  One implementation, server-side, so no two clients can disagree about a tie.
- **Client → server** `{type:"ready-update", ready:bool, gameId}` — `gameId` must equal the
  current leader or the message is dropped (stale-message guard, same shape as the existing
  un-vote guard).
- **Server → client** `{type:"lobby", leaderGameId, ready:[names]}` — sent on join (snapshot,
  which is the whole reason this is server-side) and on every change.
- **Server → client** `{type:"launch", gameId, delayMs:3000}` — all players ready. Each client
  counts down locally from receipt, so skew is one network hop, not clock difference.
- **Server → client** `{type:"launch-cancel", reason}`.
- Cancel triggers: un-ready, leader change, player join. A player **leaving** re-evaluates
  instead of cancelling — if the only un-ready player disconnects, the rest should launch.
- Ready set clears whenever the leader changes (a ready vote is for a specific game).
- `cursor-update` relays three new optional fields, `anchor` and `ax`/`ay` — see §5.

Ready is keyed by `player.name || id`, matching how votes are already keyed. Two players
sharing a name collide; that is pre-existing in votes and fine for a friend group.

---

## 5. Hub changes (`index.html`, stays one self-contained file)

Kept monolithic to match every other page in this repo, so the collision checker stays a no-op
for the hub. Layout is a fixed three-band flex column at `100dvh` with `overflow:hidden`:

- **Top buffer** — room code in the corner, player chips (dot + name, `(you)` on your own)
  beside it, `change` and `Leaderboards` controls. Leaderboards moves here rather than
  spending a game slot; it was never votable anyway.
- **Board** — `#tileGrid` as a CSS grid sized by `--cols`/`--rows`, filling the band so nothing
  scrolls. Left/right arrows at the vertical edges, disabled at the ends. Page dots beneath.
- **Bottom buffer** — blank until a leader exists, then the Continue button with its own
  colored ready-dot cluster. Countdown renders as a large numeral over the dimmed board.

`PAGE_SIZE = 8`. 13 games → 2 pages (8 + 5); the short page renders empty slots so tile size
stays constant. `cols = viewportW >= viewportH ? 4 : 2`, `rows = 8 / cols` — same 8 games per
page on every device, only the shape differs.

The 14 hardcoded `<a class="game-card">` blocks become a manifest array; paging is not
practical against hardcoded markup. Same `data-game-id` values, same `.vote-check` buttons, so
vote state and link rewriting carry over unchanged. `ps1-racer` and `voice-runner` get a warning
badge — PROJECT_MEMORY marks both non-functioning, and a unanimous launch into a broken game is
a bad group experience.

**Cursors must become anchor-relative.** They are sent as raw viewport percentages today; once
tiles are paginated, a peer on page 2 would appear to hover *your* page 1 tiles — actively
misleading, which is a regression of something that currently works. Clients now send
`anchor` (`"tile:<gameId>"`, `"continue"`, or null) plus a 0..1 offset within that element.
Receivers resolve the anchor against their own layout and fall back to the raw percentage at
reduced opacity when the anchor isn't on screen. Anchors are re-resolved on resize and page
change, not just on the next 10Hz update.

**Degradation before the redeploy:** the client computes the leader locally with the same
strict-plurality rule for the button label, but if no `lobby` message has arrived it renders the
button disabled with "ready-check needs the server update." Server state takes over the moment a
`lobby` message arrives. This is deliberate — PROJECT_MEMORY's standing lesson is that the hub
once shipped comments describing a protocol the server didn't implement, and silently did
nothing. This fails loudly instead.

---

## 6. Verification — results (2026-08-28)

**Server (19/19 integration tests, three ws clients against a local `server.js`):** leader
election including the tie case; ready snapshot for a late joiner; ready for a non-leading game
rejected; all-ready starts a 3000ms countdown; countdown cancelled by un-readying, by the
winning vote changing (which also retires everyone's ready state), and by a player joining
mid-countdown; a **leave re-evaluates** and lets the remaining players launch instead of
stalling on the departed holdout; game rooms receive no `lobby` traffic and ignore
`ready-update`; ready state clears once the countdown has fired.

One test failure during the run was the test's own fault, not the server's — a lobby broadcast
goes to every client in the room, and draining only one of them let the next assertion resolve
on the previous step's message. Worth remembering for the next protocol test in this repo:
**assert on the message you awaited, and only accept messages that arrive after the wait
begins.** The first draft did neither and reported passes on stale evidence.

**Hub (two live browser clients, local server):**
- Full flow: both players joined room TEST, voted, the winner was highlighted, both clicked
  Continue, a 3-2-1 countdown ran, and both landed on
  `/zombie/Zombie.html?name=Alice&room=TEST` and `?name=Bob&room=TEST` respectively.
- A 1-1 tie hid the Continue button on both screens; agreeing again brought it back.
- The Continue button stays enabled during the countdown, so a player can still back out.
- The roster lists you (`Alice YOU`) — the bug that made the ready-check uncountable.
- **The original dead end is gone:** at 390x844 the games are reachable
  (`elementFromPoint` at a tile centre returns that tile), the page does not scroll, and the
  top band is visible.
- Reflow: 4x2 at 1280x720, 2x4 at 390x844, with page 1 holding the **same 8 games** both times.
  Page 2 holds the remaining 5 plus 3 empty slots, and tiles stay exactly 149x160 across both
  pages, so flipping pages doesn't resize anything.
- Cursor anchoring: a peer hovering the Zombie tile while you are on page 2 falls back to raw
  position and dims; flipping to page 1 snaps the cursor onto that tile at the peer's own
  25%/75% offset within it. A malformed anchor from the network is rejected before it reaches
  `querySelector`.
- Degradation: with `serverHasLobby` false the button renders visible-but-disabled reading
  "Ready-check unavailable — the server needs the lobby update deployed".
- `file://`: one inline classic script, no modules, no external references, no `new URL()`,
  and `localStorage` access wrapped in try/catch (which the old hub lacked).
- `node scripts/check-global-collisions.js` passes.

**Not verified here:** the layout was checked through measured geometry rather than screenshots —
the browser pane in this session never composited frames, so no pixel-level look at the board.
Worth a real eyeball pass on a phone and a desktop before calling the visual design done.

## 7. Round two (2026-08-28, same session)

Four further decisions, all taken by the user after the first round shipped.

### 7a. Stamps, with two different words on purpose

Every game that can't be played together carries a diagonal red rubber stamp. The wording
splits, because one word for both would have been misleading:

- **MULTIPLAYER SOON** (10 games) - runs fine, just no shared play yet.
- **COMING SOON** (3 games: `ps1-racer`, `voice-runner`, `hex-grid`) - doesn't actually run,
  per PROJECT_MEMORY. Rendered a shade heavier (`.tile-stamp.blocked`).

A single "COMING SOON" across all 13 would have put it over Fruit Dropper, which is stable and
is the only game that behaves on a phone. That reads as broken when it isn't.

Stamps are **cosmetic**: `pointer-events: none`, tiles stay clickable, votable and launchable.
A group can still agree to all open the same solo game.

### 7b. Four more cards - the board is now 17 games

Added `boids` (server-integrated and shipped, but somehow never linked from the hub),
`rd-arena`, `hex-grid` and `reality-rewrite`. That is every game in the repo with code.
`Hex Grid.html` genuinely has a space in the filename, pre-encoded in the manifest because
`gameHref()` appends its query string to that string directly.

`PAGE_SIZE` dropped 8 -> 6 (3x2 landscape, 2x3 portrait), giving 3 pages of 6/6/5 instead of
8/8/1. Tiles got **bigger**, not smaller: 154x220 on a 400x860 phone, against 149x160 before.

**Ordering changed:** the four games you can actually play together are first, so page 1 is the
group-play page. Move them back down the manifest if you'd rather have the original order.

### 7c. Cross-game presence in the roster

The hub's own namespace (§3) meant a friend who wandered into Zombie vanished from the roster.
The server now computes presence **across namespaces** for one room code and sends it to hub
clients only (`presenceFor()` / `broadcastPresence()`).

The distinction that matters: those players are **visible, not countable**. They appear as muted
dashed chips reading "Bob - Space Tracer", and the ready-check still counts only `_hub:CODE`
members. Counting someone who is mid-game would deadlock every launch, which is the whole reason
the hub got its own namespace in the first place.

### 7d. Space Tracer folded into the shared system

It was the last client running its own everything. Now:

| Was | Is |
|---|---|
| Its own raw `WebSocket` + `join-room` | `MP.connect({game: "space-tracer"})` via `shared/mp-core.js` |
| Legacy `update` / `score-update` / `kill-credit` message types | Generic `relay`, payloads tagged `{t:"pos"}` / `{t:"score"}` / `{t:"kill"}` |
| `_legacy:CODE` namespace, shared with the hub | `space-tracer:CODE`, like every other game |
| Its own name + room screen | Identity from the hub (URL params, then localStorage) |
| **Own ship coloured by `data.id.charCodeAt(0)`** | `MP.selfColor` - the server's name hash |

That colour line was a real bug, not just an inconsistency. Root `CLAUDE.md` forbids session-ID
colouring and PROJECT_MEMORY recorded it "RESOLVED 2026-08-24" - but only for remote ships. Your
own ship was still coloured by session id, so **it changed colour on every reconnect and never
matched your dot on the hub.**

Two things deliberately kept:
- **The press-to-enter button stays**, even when identity is already known. It is the user
  gesture mobile browsers require before audio will play - load-bearing, not ceremony.
- **Kill credit stays victim-reported.** Only the delivery changed: the server used to address
  it to the shooter alone, and a relay goes to the whole room, so the shooter filters for its
  own credit. Same trust model (trivially spoofable, a deliberate call for a friend group).

`MP.identity()` was added to `shared/mp-core.js` so a game can ask "did this player arrive from
the hub?" without re-implementing the URL-then-localStorage precedence and drifting from it.

### 7e. Verification (round two)

**Server, 29/29** across two suites (19 lobby + 10 presence). Presence tests cover: snapshot on
hub join, players appearing and disappearing as they enter and leave games, several games at
once, other room codes staying separate, game clients never receiving presence traffic, and -
the important one - **the hub launching without waiting on someone who is in a game**.

**Live, three clients (hub + Space Tracer + local server):**
- Space Tracer read `{name:"Bob", room:"TEST"}` from the URL, skipped its name/room screen
  entirely, and joined `space-tracer:TEST`.
- Its ship colour came back `hsl(50, 95%, 55%)` - `MP.selfColor`, matching the hub dot.
- The hub roster read `Alice (YOU) | Bob - SPACE TRACER`.
- With Bob in-game, the hub showed **"0/1 ready"** and launched on Alice alone. Visible, not
  countable, exactly as designed.
- Bob leaving Space Tracer emptied presence and removed the chip.
- All three pages verified: 6/6/5 with one empty slot, 13 stamps total, 3 of them the heavier
  broken variant, none on the four group-ready games.

**Still not verified:** nothing has been *looked at*. The browser pane in this session never
composited a frame, which also means neither the `resize` event nor `ResizeObserver` ever fires
there - a probe observer missed a real 712px -> 480px change to the board. The reflow logic is
correct (a dispatched resize flips the grid to 2 columns, and a fresh load at 400x860 gives 2x3
with no scrolling), but **automatic reflow on rotate / URL-bar collapse is unverified**, as is
every pixel of the visual design. Worth a real phone and a real desktop.

---


## 7. Deliberately NOT done

- **`boids` is server-integrated and shipped but has no hub card at all** (nor do `rd-arena`,
  `hex-grid`, `reality-rewrite`). Adding games to the hub grid is a content decision the user
  didn't ask for. Flagged, not done — `boids` is the one most worth adding.
- No change to how games themselves read identity; the launch is a plain navigation with
  `?name=&room=`, exactly what the cards already do.
