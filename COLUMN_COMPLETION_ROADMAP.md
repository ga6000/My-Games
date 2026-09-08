# Turning the remaining `No`s into `Yes`es

Companion to `SCOPE_PULLBACK_PLAN.md` (2026-09-04), which is what made this list finite.
Before the pullback this was 18 games × 8 columns. It is now **7 rows × 5 columns, and
24 actual `No` cells.**

Scope is the active set only — the 5 games on the hub board, the hub itself, and Glucose
Dash. The 12 games in `under-development/` are deliberately out of scope; bringing one back
adds a column of `No`s and that is the cost of promoting it.

---

## Where it stands

`On Github?` is already `Yes` on every row — that column is done and is not mentioned again.

| | Server | Firebase / LB | Scripts split | Audio | Aesthetic |
|---|---|---|---|---|---|
| **Hub** `index.html` | ✅ | ✅ links | ✅ | ✅ | ✅ |
| **Zombie** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Space Tracer** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **Glass City Escape** | ✅ | ✅ | ✅ | ✅ | ✅ |
| **RD Arena** | ❌ *(design session)* | ❌ | ✅ | ✅ | ✅ |
| ~~**Reality Rewrite**~~ *(shelved 2026-09-06)* | ❌ ident. only | ❌ *(decision)* | ✅ | ✅ | ✅ |
| **4D Pong** *(promoted 2026-09-06)* | ✅ **host-authoritative, 2026-09-06 evening** | ❌ *(no number to submit)* | ✅ | ✅ | ✅ |
| **Glucose Dash** *(now `under-development/`)* | ⚠️ partial | ❌ | ✅ | ✅ | ✅ |
| **to fix** | **3** | **3** | **0** | **0** | **0** |

**Updated 2026-09-05.** `Scripts Segmented?`, `Audio Design?` and `Aesthetic Unified?` are now
`Yes` on every row — the three columns this plan was written to close are closed. What is left in
`Server` and `Firebase / Leaderboard` is not work of this kind: see *The two that are not just
work* below, both deferred by the user on 2026-09-05.

**Glucose Dash moved to `under-development/` on 2026-09-05** at the user's instruction. It had
never had a hub card (the tracker carried it under *"Built, not hub-linked"* since 2026-08-29),
so this made a de-facto status official. It still received its full pass the same day — a
recorded exception to that folder's own no-speculative-work rule.

---

## The one decision that shapes everything: batch by file, not by column

The obvious plan is column-by-column — "do all the script splits, then all the audio."
**Don't.** Under a token budget the dominant cost is *reading a 2,400-line inline script into
context*, not editing it. RD Arena's file costs the same to open whether you fix one cell or
four. Column-by-column pays that cost five times per game; game-by-game pays it once.

So: **one foundation pass, then one session per game that closes every cell that game still
has open.** The matrix gets filled in vertical stripes, not horizontal ones.

The exception is `Aesthetic Unified?`, which is the only column that is a property of the
*set* rather than of a row. It cannot honestly be marked `Yes` anywhere until it is `Yes`
everywhere, so it flips as one move at the end.

---

## Phase 0 — the shared layer — ✅ **DONE 2026-09-04**

> Shipped: `shared/retro.css`, `shared/retro.js`, `shared/sfx.js`, `shared/leaderboard.js`,
> plus `scripts/embed-fonts.js` and `shared/selftest.html`. 22 assertions pass in a real
> browser. Two things came out differently from the plan below — read those before Phase 1:
>
> - **`shared/` was already inside `check-doc-sync.js`'s repo-wide scope**, so only
>   `AESTHETIC_GUIDE.md` actually needed adding. It is now tracked, which matters more than it
>   sounds: it is the doc that describes what the code *should* look like, so it is the one
>   most able to drift without anything noticing.
> - ~~**The font embedding is built but not populated.**~~ **Populated 2026-09-04** — both latin
>   subsets are embedded, 39.6 KB of base64, licences in `shared/fonts/OFL.txt`. The type is
>   period-correct everywhere from here on. Note the real faces are much wider than the Courier
>   fallback: anything positioned against a proportional face may need a nudge, as the hub's
>   stamp did.
>
> One finding worth carrying into every later session: the self-test measured the **current**
> identity palette at **ΔE 17.1** from `--sig-amber` (and 18.3/18.4 from magenta/cyan),
> against the guide's ≥26 target. §2.3's "a signal colour must never be assignable to a
> player" is violated *today*, by all three signals. That is not fixable inside a game
> session — see the migration note at the end of this file.

### What was built (reference for Phase 1)

| File | Global | Use |
|---|---|---|
| `shared/retro.css` | — | Tokens: `--ground`, the Signal Three, three phosphor whites, `--world-hue` per `data-game`. Utility classes for gel / scanlines / cabinet / INSERT COIN. |
| `shared/retro.js` | `RETRO` | `persist` `beam` `vertexBloom` `snap` `band` `flicker` `padScore` `attract` |
| `shared/sfx.js` | `SFX` | `configure` `init` `unlockOn` `tone` `sequence` `pickup` `death` `blip` `hit` `shoot` `setVolume` `toggleMute` `destroy` |
| `shared/leaderboard.js` | `LB` | `configure` `preload` `submit` `available` `status` `debug` `destroy` |

Wiring a game is four tags and three calls:

```html
<link rel="stylesheet" href="../shared/retro.css">
<body data-game="glass-city-escape" data-cabinet="vector">
<script src="../shared/retro.js"></script>
<script src="../shared/sfx.js"></script>
<script src="../shared/leaderboard.js"></script>
```
```javascript
SFX.configure({ game: "glass-city-escape" });
SFX.unlockOn(window, listenerController.signal);   // needs YOUR AbortSignal
LB.configure({ game: "glass-city-escape" });
LB.submit({ player: name, score: 1250, room: roomCode });
```

**The one rule that is enforced rather than documented:** `RETRO.attract()` and
`SFX.unlockOn()` both *refuse* to attach listeners if you do not hand them the game's
`AbortSignal`. They warn and no-op. Attaching a listener a game's `destroy()` cannot abort is
the exact leak the root `CLAUDE.md` teardown rule exists to stop, so the shared layer will not
do it quietly. Nothing in the layer opens a timer at all — `attract` runs off your render loop
via `tick()`, and `SFX` schedules on the AudioContext clock.

<details>
<summary>The original Phase 0 plan, kept for the reasoning</summary>

## Phase 0 — the shared layer (do this first, it is what makes the rest cheap)

Nothing here is visible to a player. It exists so that each per-game session is an
*application* of something already decided rather than a fresh invention. Skipping it means
re-deriving the same audio envelope and the same palette six times, which is how the repo
got four copies of the name→colour function.

Four new files in `shared/`, all classic scripts (the `file://` constraint rules out modules):

| File | What it holds | Closes |
|---|---|---|
| `shared/retro.css` | `AESTHETIC_GUIDE.md` §2 as CSS custom properties — the Signal Three, the three phosphor whites, `--world-hue` per game | Aesthetic |
| `shared/retro.js` | The §4 techniques used by more than one game: phosphor persistence, vertex bloom, quantized light, attract mode. **Must route its timers through the caller's `trackTimeout`/`trackInterval`, never open its own** — the guide calls this out at §5 and it is a hard constraint | Aesthetic |
| `shared/sfx.js` | A tiny procedural kit: oscillator + envelope + the "browsers refuse audio before a user gesture" guard. Three games already hand-roll this | Audio |
| `shared/leaderboard.js` | The `submitScoreToFirebase` pattern that today only Space Tracer has, wrapped so the rest get it in three lines | Firebase / LB |

Three things to get right in Phase 0, because they are cheap now and expensive later:

1. **`shared/leaderboard.js` must degrade silently under `file://`.** `firebase-config.js`
   needs `http(s)`; a double-clicked game has no Firebase and must still play. Fail soft, log
   once, never block the game loop. This is the same shape as the `IDENTITY.colorFromName()`
   fallback and should follow it deliberately.
2. **Each new file declares exactly one global** (`RETRO`, `SFX`, `LB`). Run
   `node scripts/check-global-collisions.js` — with six games about to load four shared files
   each, this checker stops being a formality.
3. **Add `AESTHETIC_GUIDE.md` and `shared/` to `check-doc-sync.js`'s tracked list.** The guide
   flags this gap itself (§ near line 661): it is the most consequential doc in the repo right
   now and nothing marks it dirty when the code moves.

**Estimate: one full session.** It is the highest-leverage session on this list.

</details>

---

## Phase 1 — one session per game

> **Session 4 (Space Tracer) landed 2026-09-04 — and turned up a live bug bigger than the
> session.** The **deployed Render server is still serving the pre-2026-09-03 colour palette**:
> measured over five names, 0/5 agree with `shared/identity.js` and 0/5 of the server's answers
> exist in the current palette at all. Players are one colour on the hub and another in every
> game. `check-identity-parity.js` was green throughout and *correctly so* — it compares two
> local files and never speaks to the running server. **Only a push to the separate
> gyro-space-server repo plus a Render redeploy closes this.** Blind spot now documented at the
> top of the checker.
>
> On the work itself: **§6.1 was wrong for this file in two of its four instructions**, the first
> time the guide has been actively unsafe rather than just unimplemented. Persistence cannot
> replace the trail (the camera hard-follows the ship, so the ship never moves on screen), and
> wrap-around is a gameplay redesign rather than "a handful of lines" — the border kills, bullets
> bounce off it, and asteroids already wrap while players are caged. **Read §6 against the code
> before trusting its effort estimate.**
>
> Also: the split had to be made in **strict source order** here, because this game's load-time
> statements are scattered through its sections rather than gathered at the end.
>
> **Session 3 (Glass City Escape) landed 2026-09-04.** All three cells closed, and it produced
> the first case where **the guide had to be deviated from twice, deliberately**:
>
> - §6.8 asks for *"unfilled wireframe boxes"*. In a top-down view an unfilled box reads as a
>   room you can walk into — and a wall is the one thing you cannot. Walls kept a faint interior
>   tint. **When the aesthetic and the collision model disagree, the collision model wins** (§5).
> - §6.8 also asks for a horizon line. There is no horizon: the renderer is pure top-down. The
>   guide was written assuming a perspective view this game does not have.
>
> Both are recorded in `glass-city-escape/CLAUDE.md` rather than left as silent divergence.
> **Expect more of this** — §6 was written against the games as imagined, and the later entries
> (RD Arena, Glucose Dash) describe renderers that have since been rebuilt.
>
> Also worth carrying: **the plan's score choice turned out to rest on a false premise.** It said
> "solo only", but mp-core's `solo` means *the server is unreachable*, not *playing alone* — so
> the hook would almost never have fired. Check what a flag actually means before scoping
> behaviour to it.
>
> **Session 2 (Hub) landed 2026-09-04.** All three of its cells closed. The technique that made
> it safe, and which the remaining five sessions should copy:
>
> - **Split first, skin second, as two separate passes.** Pass A moved 958 lines into five
>   `hub/*.js` files with *zero* behaviour change and was verified working before a single colour
>   moved. A regression then has one obvious owner. Doing both at once makes it a bisection
>   problem across 958 lines of script and 630 of CSS.
> - **Only the last file may execute anything.** Top-level `const`/`let` in a classic script live
>   in the shared global lexical environment, so a later file referencing one at *load* time is a
>   TDZ error. `hub-core.js` declares all state, the middle files declare only functions, and
>   `hub-boot.js` holds every listener and the `init()` IIFE. Same shape `zombie/` already used.
> - **Anchor CSS edits to line numbers, not to the literal.** `#2a2a2a` was ink, border *and*
>   fill in different rules; a blanket find/replace gets all three wrong. 77 declarations were
>   remapped individually against their selectors.
>
> **Session 1 (Zombie) landed 2026-09-04.** Both its open cells are closed. Three things worth
> carrying into session 2, because they will recur:
>
> - **The shared layer held up.** `RETRO.snap`/`RETRO.flicker` and `LB.submit` did what Phase 0
>   promised, and the four-tag wiring in the Phase 0 block above is exactly what was used.
> - **`destination-out` is a trap for the lighting work.** The obvious way to punch a light
>   pocket out of a darkness layer erases the *world* underneath it, not just the darkness.
>   Caught by sampling canvas pixels, not by looking. Draw disjoint regions instead. RD Arena and
>   Glucose Dash both have gradient lighting and will meet this.
> - **Verify by measuring the canvas, not by screenshotting it.** The pane runs pages hidden, so
>   `requestAnimationFrame` never fires and `window.innerWidth` is 0 — the game renders nothing
>   and looks broken when it is fine. Force a viewport with `resize_window`, then drive
>   `update()`/`draw()` by hand and read pixels back.

Ordered cheapest-first, so if the budget runs out the expensive unfinished work is the work
that was always going to need its own session anyway.

Each session: split the inline script into classic `<script src>` files, and while the file is
already open, apply that game's `AESTHETIC_GUIDE.md` §6 treatment, wire `SFX` if audio is
open, and wire `LB` if the leaderboard is open. Then run all three checkers.

| # | Game | Cells closed | Notes |
|---|---|---|---|
| 1 | ✅ **Zombie** — DONE 2026-09-04 | Aesthetic, Firebase | Cheapest by far — **already split into 8 files**, so there is no split to do. Guide §6.3, anchor *Berzerk*. Score for the leaderboard is wave/kills, which already exists. Do it first: it is the one session that proves the Phase 0 layer works before five other games depend on it. |
| 2 | ✅ **Hub** `index.html` — DONE 2026-09-04 | Split, Audio, Aesthetic | Guide §6.0 calls this "the largest single change in the repo" — but it is **skin, not layout**. The three-band no-scroll paging model is load-bearing (it exists because a sidebar once made joining a room on a phone a dead end) and must not be touched. Audio = attract-mode bleeps + card select, which §4.8 wants anyway. |
| 3 | ✅ **Glass City Escape** — DONE 2026-09-04 | Split, Aesthetic, Firebase | 1,178-line script, the smallest game split. Guide §6.8, **VECTOR**, anchor *Battlezone* — the game is already wireframe buildings, so this is close to free. Leaderboard score = race time. |
| 4 | ✅ **Space Tracer** — DONE 2026-09-04 | Split, Aesthetic | 2,219 lines. Guide §6.1, **VECTOR**, anchor *Asteroids*. Firebase is already `Yes`. **Do not regress server-authoritative `MP.selfColor`** (§5). Just had its mobile path removed (2026-09-04), so the file is ~250 lines lighter and fresher in memory than it will be later — worth doing sooner rather than later. |
| 5 | ✅ **Glucose Dash** — DONE 2026-09-05 (and shelved to `under-development/` the same day) | Split, Aesthetic | 2,365 lines. Guide §6.5, **GEL**. Server = ghosts on the wire; `MULTIPLAYER_PLAN.md` already calls this the cheapest remaining multiplayer win, and seed + identity are done. Preserve `pathWalkable(f)` as the single source of floor geometry and colour-reserved-for-storefronts (§5) — violating the first previously caused invisible holes in every upper storefront. |
| 6 | ✅ **Reality Rewrite** — DONE 2026-09-05 | Split, Audio, Aesthetic | 1,215 lines and a **6-file split already designed** in `reality-rewrite/CLAUDE.md` — planned, never built. Two things need a decision, not code: whether this game even *has* a score to put on a leaderboard, and whether "on mp-core for identity only" should count as `Server: Yes` or whether the rule-rewrite state goes on the wire. **Ask before building.** Keep `IDENTITY.colorFromName()` as the only name→colour path (§5). |
| 7 | ✅ **RD Arena** — DONE 2026-09-05 | Split, Audio, Aesthetic | The hard one, and correctly last. 2,440 lines, already flagged "best split candidate". Guide §6.4, **RASTER**, anchor *Space Invaders* — and the guide notes the reaction-diffusion field is *already* era-native, so the aesthetic pass is mostly restraint. Audio: decide whether to wire the orphaned `glide.mp3` or go procedural. **Server needs its own plan file** — see below. |

---

## The two that are not just work

Everything above is execution. These two are open questions, and pretending otherwise is how
a "few days" becomes a fortnight.

**RD Arena multiplayer.** `MULTIPLAYER_PLAN.md` deferred this deliberately, and the reason
still holds: a 400×400 Gray-Scott field cannot go on the wire, and it is the game — §5 lists
`dA/dB/feed/k`, the grid, the `>0.3` threshold, the flow field and the motes as untouchable.
The only shapes that work are deterministic-seed-plus-input-lock (every client simulates the
same field from the same seed and only inputs are synced) or host-authoritative-summary (host
simulates, ships enemy/HP state, clients render their own field cosmetically). That is a
design session with its own plan file, not a cell to tick.

**The identity palette re-solve.** Measured 2026-09-04: the current palette sits ΔE 17.1 from
`--sig-amber`, 18.3 from magenta and 18.4 from cyan, all below the ≥26 the guide targets — so a
player can be issued a colour that reads as a signal. It is not a game-session task, because
`COLOR_PALETTE.length` goes 16 → 13, `hash % length` moves, and every player's colour
reshuffles once. It must land in `shared/identity.js` **and** the separate `gyro-space-server`
repo in one sitting, pass `check-identity-parity.js`, and end in a Render redeploy. Until then
`shared/selftest.html` reports it as KNOWN and flips to PASS on its own once it clears.

> **Board swap 2026-09-06.** Reality Rewrite went to `under-development/`, 4D Pong came up in
> its place, and 4D Pong arrived with the three target columns already `Yes` — it was split into
> eight `fp-*.js`, given the RASTER skin and given procedural audio in the same session it was
> promoted. So the swap **did not reopen any of the three columns this roadmap exists to close**.
>
> ~~Its two `❌` cells are both closed-by-design rather than pending. `Server` is `couch`: four
> people at one keyboard, on `mp-core` for identity and presence only, with nothing on the wire —
> the hub says so with a new `COUCH 2-4P` stamp.~~ **`Server` flipped to ✅ the same evening** —
> the user asked for online play for a session that night and it shipped host-authoritative, with
> no server change (see `four-d-pong/ONLINE_PLAN.md`); the hub entry is `mp: true` now and the
> couch stamp is gone. **`Firebase` is the one real remaining `❌`**, and it is
> the same shape as Reality Rewrite's open question below: **a tug-of-war produces no number.**
> "Won by 7" is the entire result. A leaderboard would need a designed metric — longest rally?
> win streak? — which is a design call, not a wiring job.

**Reality Rewrite's score.** A leaderboard needs a number. If the game does not produce one,
`Firebase / Leaderboard Integrated?` is the wrong question for that row and the honest answer
is `N/A`, not `Yes`. Worth settling before the session rather than inventing a score to fill
a cell.

> **Answered 2026-09-05: it has a number.** `getState()` already returns `player.score` and
> `player.kills`. So the honest answer is not `N/A` — the cell is a real question with a real
> candidate. What is still open is the *design* call: whether a 3-minute deathmatch score belongs
> on a shared leaderboard alongside Zombie's round-reached and Glass City's stage-reached. That is
> the user's to make, and it was deliberately not made during the aesthetic pass. The cell stays
> `No`, not `N/A`.

---

## Where it actually landed (2026-09-05)

**Eight sessions was the estimate; it took seven, and the last three ran as one.** Phase 0 plus
Zombie, the Hub, Glass City and Space Tracer were sessions 1–4. Glucose Dash, Reality Rewrite and
RD Arena all landed on 2026-09-05, in that plan's reverse order — active games first, because
Glucose Dash was shelved at the start of the session and it made no sense to put the shelved one
ahead of the two still on the board.

**The `batch by file, not by column` decision held.** Each game was opened once and every cell it
had open was closed in that sitting. The three splits — 12 files for Glucose Dash, 9 for RD Arena,
6 for Reality Rewrite — all used the strict-source-order rule that came out of the Space Tracer
session, and none of the three needed hoisting.

**What each game cost, against §6's estimate:**

| Game | §6 said | Actual |
|---|---|---|
| RD Arena (§6.4) | **S** for the render | Right. `arc` → `fillRect` was the whole change. |
| Reality Rewrite (§6.12) | **M**, "one CSS custom property" | The idea shipped; the premise was wrong (`--stable-color` is the health bar) and the Signal Three turned out to be unavailable as a world hue. |
| Glucose Dash (§6.5) | **S** for option (a) | Right, plus one thing it did not anticipate — sheet order matters, pink-on-red kills storefront separation. |

**Three bugs were found and fixed in passing**, none of them in the games' own logic: the
vignette-clobbering regression `reality-rewrite/CLAUDE.md` had warned about for months (and which
this pass walked straight into), `RDSKIN.read()` reading `documentElement` instead of `<body>` and
so painting the whole fleshscape `--phos-mid` grey-green, and a per-frame `getComputedStyle` in
Reality Rewrite's `draw()`.

## Realistic shape

**Eight sessions, not "a few days"** — Phase 0, seven games, plus a design session if RD Arena
multiplayer goes ahead. **Phase 0, Zombie, the Hub, Glass City and Space Tracer are done, so three remain.** Sessions 1–4 are mostly mechanical. The last three carry the open
questions.

Session 4 was the natural stopping point and has now passed; sessions 5-7 (Glucose Dash, Reality Rewrite, RD Arena) all carry open questions rather than just work. That leaves `Scripts Segmented?` and
`Aesthetic Unified?` at 4/7 — and the honest move then is to say so in the tracker rather
than mark the column done. A column is `Yes` when every row is, and the entire value of that
sheet is that it does not lie.

Update `Game dev tracking.xlsx` at the end of each session, not in one pass at the end.
