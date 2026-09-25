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
| What reveals Continue | **Unique vote leader** — strictly more votes than any other game. A tie shows no button. *(Tightened 2026-09-24 by §9e: a unique leader **and** every player has voted. Still not unanimity — you vote for what you want, then consent to whatever wins.)* | Unanimous vote (deadlocks at 7/8); any-vote (target shifts under people); explicit host pick (second interaction to discover) |
| Board sizing | **Same games per page everywhere, shape reflows** — page 1 is the same 8 games for all players; only rows x cols change per viewport | Pixel-identical scaled board (unreadable on portrait phones); fully adaptive tile count (players literally on different pages) |
| Ready-check transport | **Server-side state + server-run countdown**, mirroring the existing `vote-update` | Generic `relay` (no snapshot for late joiners, per-client timer drift) |
| Countdown cancel rules | **Strict** — every player in the room must be ready; cancels on un-ready, leader change, or a new player joining | Ignore late joiners; force-start escape hatch; majority-start |

**Consequence of "server-side": this needs a Render redeploy of `gyro-space-server` before the
ready-check works in production.** Until then the hub still works (browse, page, vote, cursors)
and the Continue button renders in a visibly disabled state that says why — see §5.
*(**Superseded 2026-09-20 by §9c:** once tiles stopped being links, a disabled button would have
been the only exit. Without the lobby, the button is now a labelled solo launch.)*

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

## 5. Hub changes (~~`index.html`, stays one self-contained file~~)

Kept monolithic to match every other page in this repo, so the collision checker stays a no-op
for the hub. *(**Superseded 2026-09-03:** the hub now loads exactly one external script,
`shared/identity.js`. Staying self-contained meant keeping a second copy of the name→colour
palette, and a duplicated identity scheme is a worse problem than an extra `<script src>`.
The checker is no longer a no-op here — it reports `index.html (1 local script)`.)*

> **Fully superseded 2026-09-04.** The hub is no longer self-contained at all: its 958-line
> inline script was split into **five `hub/*.js` files**, and it now loads nine local scripts
> (`shared/identity.js`, `shared/retro.js`, `shared/sfx.js`, and `hub/hub-core|layout|render|net|
> attract|boot.js`). The monolith argument lost twice for the same reason both times — an extra
> `<script src>` is a smaller problem than the thing keeping it inline was costing.
>
> **The layout below is unchanged and must stay that way.** The split moved lines between files;
> it did not touch the three-band model, `applyGridShape()`, `PAGE_SIZE`, or the sizing maths.
> See `hub/HUB_PASS_PLAN.md`, whose governing rule is *"change the skin, not the layout"* —
> precisely because §1's reason for this structure is still live. Layout is a fixed three-band flex column at `100dvh` with `overflow:hidden`:

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

> **Superseded the same day by §7b:** the live hub is `PAGE_SIZE = 6` with **17** games over
> 3 pages (6/6/5), which made tiles *bigger*, not smaller. The sizing rule itself is unchanged —
> only the constant moved. Verified in `index.html` 2026-09-02.
>
> **Superseded again 2026-09-04 by the scope pullback:** the board is **5 games on a single
> page**. `PAGE_SIZE` is still 6, so paging is currently a no-op — deliberately left wired up
> rather than removed, because the list is expected to grow back as games come off the shelf.
> The short page still renders empty slots, so the one visible consequence is a single blank
> tile. See `SCOPE_PULLBACK_PLAN.md` §2.

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

> **Superseded 2026-09-20 (§9c).** The principle stands, and the mechanism changed. A disabled
> Continue was fine while every tile was also a link into its game: the button was never the
> only exit. Once tiles became votes it would have been. Without a `lobby` message the hub now
> says what the connection is doing, and turns the button into **PLAY \<GAME\> SOLO** for your own
> pick. It still fails loudly; it just no longer fails *shut*. The local plurality copy
> (`computeLocalLeader()`) is deleted. Your own pick replaces it, and the server is now the only
> place a tie is decided.

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
  "Ready-check unavailable — the server needs the lobby update deployed". *(Behaviour replaced
  2026-09-20 by the solo launch; see §9c and §9d.)*
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

> **2026-09-08: nothing on the board carries this stamp any longer.** RD Arena was the last of
> the 5 without `mp: true` and got it when its netcode landed. The derivation below is unchanged
> and stays wired up — it is what a game promoted back off `under-development/` will come
> through, and it is still one fact per entry rather than two that can drift.
- **COMING SOON** (3 games: `ps1-racer`, `voice-runner`, `hex-grid`) - doesn't actually run,
  per PROJECT_MEMORY. Rendered a shade heavier (`.tile-stamp.blocked`).

A single "COMING SOON" across all 13 would have put it over Fruit Dropper, which is stable and
is the only game that behaves on a phone. That reads as broken when it isn't.

Stamps are **cosmetic**: `pointer-events: none`, tiles stay clickable, votable and launchable.
A group can still agree to all open the same solo game.
*(**2026-09-20: no longer "launchable."** That word was the bug §9 fixes: a click on a tile
opened the game and skipped the vote. A tile click is now a vote. Stamps are still cosmetic,
and a stamped game can still win the vote and be launched by the ready-check.)*

> **Not a game, no card needed (2026-09-03):** `rd-arena-bench/rd-bench.html` is a developer
> harness for profiling the reaction-diffusion field, not something anyone plays. It is
> deliberately absent from the hub board, so the "every game in the repo with code" counts below
> still refer to games only. Do not add a tile for it.
>
> **Same ruling for `gyro-lab/gravity-lab.html` (2026-09-08):** a slider bench for choosing a
> gravity model and a lensing method for Gyro Space, not something anyone plays. It is
> local-only — no room code, no `mp-core`, no score — so none of the three card stamps
> (`MULTIPLAYER SOON` / `COUCH 2-4P` / `COMING SOON`) describes it. **No tile.** The board is
> still 5. See `gyro-lab/CLAUDE.md`. This is now twice that a top-level folder has been added
> that is deliberately not a game, so treat "top-level folder" and "hub candidate" as
> genuinely separate things when reading the counts in this file.

### 7b. Four more cards - the board is now 17 games

> **Mostly undone 2026-09-04.** Three of the four cards added here (`boids`, `hex-grid`,
> `reality-rewrite` — only `rd-arena` survives) went to `under-development/` in the scope
> pullback, along with nine others. The board is 5 games. The reasoning below is still the
> reasoning for *how* cards are added, and the `Hex Grid.html` filename-space note still
> applies to anyone promoting that game back; only the count and the ordering claim are dead.
>
> **`reality-rewrite` outlasted that note by two days and is now gone too (2026-09-06)** — traded
> for `four-d-pong`, which came the other way off the shelf. So of the four cards §7b added, only
> `rd-arena` is still on the board, and the board is still 5.
>
> **One thing about card *data* did change that day, and it belongs in this file rather than in
> the historical note above.** The manifest derived exactly two stamp states from one flag:
>
> ```js
> GAMES.forEach(g => { if (g.mp) return; g.stamp = g.broken ? "COMING SOON" : "MULTIPLAYER SOON"; });
> ```
>
> `mp` means "plays together **over the server**". 4D Pong does not and never will — it is four
> people at one keyboard — so that rule would have stamped `MULTIPLAYER SOON` on a game whose
> headline feature is multiplayer that already works. An entry may now declare `couch: true` and
> gets `COUCH 2-4P`. Three states, because there were always three kinds of game and the board
> had only ever been able to say two of them.

Added `boids` (server-integrated and shipped, but somehow never linked from the hub),
`rd-arena`, `hex-grid` and `reality-rewrite`. That is every game in the repo with code.
`Hex Grid.html` genuinely has a space in the filename, pre-encoded in the manifest because
`gameHref()` appends its query string to that string directly.

`PAGE_SIZE` dropped 8 -> 6 (3x2 landscape, 2x3 portrait), giving 3 pages of 6/6/5 instead of
8/8/1. Tiles got **bigger**, not smaller: 154x220 on a 400x860 phone, against 149x160 before.

**Ordering changed:** the four games you can actually play together are first, so page 1 is the
group-play page. Move them back down the manifest if you'd rather have the original order.
*(2026-09-04: three, not four — `boids` was the fourth and is now shelved. With 5 cards on one
page the ordering no longer decides what a room sees first, only the reading order.)*

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


## 8. Deliberately NOT done

*(This was §7 in the first round — renumbered 2026-09-02, because round two below was also
written as §7 and the two contradicted each other.)*

- ~~**`boids` is server-integrated and shipped but has no hub card at all** (nor do `rd-arena`,
  `hex-grid`, `reality-rewrite`).~~ — **DONE later the same day; see §7b.** All four were added,
  the board went to 17 games, and `PAGE_SIZE` dropped 8 → 6. This bullet is kept only so the
  original "flagged, not done" reasoning isn't lost.
- No change to how games themselves read identity; the launch is a plain navigation with
  `?name=&room=`, exactly what the cards already do. **Still true.**

### Still not done (as of 2026-09-04)

- ~~**`glucose-dash` has no hub card — and as of 2026-09-04 this is a decision, not an
  oversight.**~~ **Closed 2026-09-05: it went to `under-development/`.** §7b added every game in
  the repo with code, but Glucose Dash was created on 2026-08-29, after that pass, and was never
  added; the scope pullback left it unlisted, which put it neither on the board nor on the shelf.
  The user resolved that on 2026-09-05 by shelving it, so the one-row *"Built, not hub-linked"*
  section in `Game dev tracking.xlsx` is gone and the game sits in the same folder as the other
  twelve. **The hub manifest is unaffected** — this game never had an entry to remove, which is
  the whole reason the anomaly existed.
- **Twelve cards were removed 2026-09-04**, which is the inverse of the problem this file spent
  two rounds solving. Worth stating plainly so it does not read as regression: §7b's goal was
  "every game with code is reachable," and that turned out to be the wrong goal. Reachable and
  *worth reaching* are different, and a board of 17 where 12 are unfinished is a worse hub than
  a board of 5. See `SCOPE_PULLBACK_PLAN.md`.
- ~~**The server redeploy in §2 may still be outstanding.**~~ — **resolved 2026-09-02.** The
  user confirmed the Render server is redeployed after each edit, overridden from GitHub, so the
  ready-check has been live since it shipped. The visible-disabled Continue button (§5) remains
  as the degradation path, but should not normally be seen. *(2026-09-20: that button is gone;
  the degradation path is now the solo launch in §9c. Re-confirmed the same day that the live
  server runs the lobby protocol, by probing it directly; see §9a.)*

---

## 9. Round three: the tile is the vote (2026-09-20)

Written before editing, per root `CLAUDE.md`. Implemented and verified the same day; see §9d.

### 9a. The bug

Reported by the user: *after typing a name and room, selecting a game just launches it — no
vote, no waiting for everyone, no Continue.*

Every tile was `<a class="tile" href="zombie/Zombie.html?name=…&room=…">`, a link straight into
the game. The only vote control was the 26px `.vote-check` badge in the tile's top-left corner.
Clicking anywhere else on the tile — the obvious way to "select a game" — navigated at once, so
the group never voted, nobody saw Continue, and the ready-check never ran.

**Nothing was broken on the wire.** Probed the live server 2026-09-20 from Node in a throwaway
`_hub:ZZPROBE…` room: `vote-update` came back as a `lobby` naming the leader, `ready-update`
came back as `launch` with `delayMs: 3000`, all inside 0.2 s. The feature worked. The board sent
the obvious click around it. (§7a says tiles *"stay clickable, votable and launchable"* — that
"launchable" is the bug.)

### 9b. Decisions

- **A tile click is a vote.** It sets your vote to that game; it does not toggle. Someone who
  clicks a second time expecting the old launch would otherwise quietly undo their own vote, so
  clicking the tile you already voted for keeps the vote and flashes a hint pointing at Continue.
- **The ✓ badge stays, and stays a toggle.** It is now the way to withdraw a vote, and it is the
  keyboard path (it is the focusable `<button>`).
- **Tiles become `<div>`, not `<a>`.** Nothing opens a game from a tile any more. The only ways
  into a game from the hub are the ready-check countdown and the solo button in §9c.
- Your own choice is marked on the whole tile (`.is-mine`), not just by one dot in the badge —
  a tile click has to visibly do something.
- **Unchanged:** the rule that reveals Continue (unique leader, §2), the strict ready-check, and
  the server. No server change and no redeploy.

### 9c. The offline fallback this forces

The tile link was also the hub's only way into a game **without the server**, and `file://`
double-click play is a hard constraint. With tiles as votes, a hub that can't reach the lobby
would open nothing at all. So:

- When the lobby isn't up — still connecting (Render cold-starts in tens of seconds),
  unreachable, or talking to a server without the lobby protocol — a tile click makes a **local
  pick**. The bottom button reads **PLAY \<GAME\> SOLO** and navigates with exactly the
  `?name=&room=` link the tile used to be. The hint says why.
- When the lobby comes up, a pending pick is **sent as a real vote**, so clicking a game during a
  cold start is not thrown away.
- **This replaces §5's degradation path** (a visible-but-disabled Continue). That was right while
  tiles were links: a disabled button was never the only exit. With tiles as votes it would be the
  only exit, and shut. `computeLocalLeader()` goes with it; the local pick replaces the local tally.
- Connection state is now drawn. `onclose` used to re-render nothing, so a dropped socket left a
  live-looking Continue button that did nothing when clicked.

**Files:** `hub-core.js` (state), `hub-layout.js` (`lobbyOnline()`, `effectiveLeader()`,
`myChoice()`), `hub-render.js` (tiles, bottom bar), `hub-net.js` (status, pick promotion, solo
launch), `hub-boot.js` (click handlers), `index.html` (tile CSS).

**Open, asked rather than done:** the report says *"requiring all players to vote."* The rule in
§2 is weaker on the vote and stronger on the launch: a unique leader reveals Continue, then
**everyone** must press it. The locked rule is kept. Making Continue also wait until everyone has
voted would be a small client-side gate, and is the user's call.
*(**Answered 2026-09-24: wait for everyone's vote.** Built as §9e.)*

### 9d. Verification (2026-09-20)

Two browser clients, each at its own origin (`localhost` and `127.0.0.1`, so their
`localStorage` could not cross), against a **local** `server.js` on :8131. `WebSocket` was
redirected in the page and `gameHref` given a trailing `&solo=1`, so nothing touched the live
server, including the games the countdown launched. Every click went through the real delegated
handler.

- **Tile click votes, and navigates nowhere.** Alice clicked the Zombie tile's *title*: URL
  unchanged, tile `is-leader is-mine`, button `CONTINUE → ZOMBIE`, hint `0/2 ready`.
- **A second click keeps the vote.** Hint: *"Zombie is already your vote — click Continue
  below…"*.
- **Tie.** Bob voted Space Tracer. On both screens Continue went away and the hint read *"It's a
  tie — someone needs to switch their vote"*. Bob switched to Zombie and Continue came back.
- **Full launch.** Alice pressed Continue (`READY — ZOMBIE`, `1/2 ready`), then Bob. Both got the
  countdown, and both landed on `zombie/Zombie.html?name=<self>&room=TESTV`. The server log read
  `Launching zombie in _hub:TESTV (2 players)`.
- **The badge toggles.** On your own tile it took the vote back. On another tile it voted.
- **Offline.** Pointed at a dead port, the hint read *"Connecting to the game server…"*, then
  *"Can't reach the game server, still trying"*. A tile click made a local pick, and the button
  read `PLAY GLASS CITY ESCAPE SOLO`. The ✓ badge cleared the pick.
- **Pick becomes vote.** Picked RD Arena while offline, then pointed the socket at the local
  server. Within one reconnect (~1 s) the server held `rd-arena: Alice`, and the button read
  `CONTINUE → RD ARENA`.
- **A dropped socket is drawn.** After `socket.close()` the Continue button went away and the hint
  said so. It was back online by itself ~3.2 s later. The vote had gone with the disconnect,
  which is the server's existing leave behaviour and was not changed.
- **Solo launch.** `PLAY ZOMBIE SOLO` navigated to `zombie/Zombie.html?name=Alice&room=TESTO`,
  the same link the tile used to be.
- **Teardown.** `destroy()` left 0 timeouts, 0 intervals, the signal aborted and the socket's
  `onclose` null. A tile click afterwards did nothing.
- **Looked at, not just measured** (1280×720 screenshot): the voted tile shows the amber leader
  ring outside and the hot inner ring inside. Layout unchanged.
- Checkers: collisions OK (`index.html`, 9 local scripts). Undefined-globals OK for the hub, and
  it does cover these files: a deliberately planted typo (`launchSoloX`) was reported, then
  reverted. Its `index.html (inline #1)` parse error is **pre-existing and harmless**: the HTML
  comment above the script tags contains the literal text `<script src>`, which its regex reads
  as an inline script.

### 9e. Everyone votes first (2026-09-24)

The user's answer to the question §9b left open. **Continue now waits for a unique leader *and*
for every player in the room to have voted.**

Not unanimity, which §2 rejected and still rejects: you vote for the game you want, and then
consent to whatever wins. What it closes is the gap where one fast clicker revealed Continue
while nobody else had said anything — and since pressing Continue is consent to *that* game, a
room could launch with most of it never having expressed a preference.

- **Client-side only.** `pendingVoters()` in `hub-layout.js` is names in `roomMembers` with no
  vote. Continue renders **visibly disabled** with the leader still named, because seeing what is
  winning while you wait is the point; the hint says who is missing. No server change: the server
  still holds the one rule that matters (all players ready), so a stale client can't start a room.
- **Who is counted** is unchanged and deliberate: people inside a game (`presenceList`) are shown
  but never counted, or a friend mid-Zombie would block every launch — the reason for §3.
- **You are "you", and first.** Reading your own name in the waiting list makes the bar sound like
  it is talking about someone else. Alone in the list, it becomes the ask instead: *"Click a game
  to vote."*
- **A running countdown is left alone.** By then the room has voted, and the button someone may be
  reaching for to cancel must stay live.
- Withdrawing a vote re-locks it, and so does a player joining — which matches the existing rule
  that a join cancels a countdown.

**Verified** with three clients (three origins: `localhost`, `127.0.0.1`, `[::1]`) on a local
`server.js`. Alice voted alone: Continue disabled, *"Waiting for Bob and Carol to vote"*, and a
click on it readied nobody. Carol's own screen read *"Waiting for you and Bob to vote"*. Bob voted:
*"Waiting for Carol to vote"*. Carol voted Space Tracer — all three in, Zombie leading 2-1,
Continue enabled at `0/3 ready`, and Carol was asked to continue into the game she did not vote
for, which is the design. Un-voting re-locked it; re-voting opened it. All three pressed Continue
and landed in Zombie. Alone in a room, one vote opens it. A second player joining re-locked it on
the first player's screen. Looked at, 1280×720: the dimmed button reads as *waiting*, not broken.

<!-- doc-sync: 0e946089 | 2026-09-25 -->
