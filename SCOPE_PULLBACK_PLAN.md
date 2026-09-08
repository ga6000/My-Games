# Scope pullback — 2026-09-04

**Why:** the tracking sheet had grown two columns the friend group will never cash in
(mobile stability, and a "goal for multigame" that `Server Integrated?` already answers),
and the hub board was carrying twelve games that are not developed enough to hand to
anyone. Narrowing the board to what is actually playable, and narrowing the sheet to the
columns that still drive work, is what makes the remaining `No`s a finite list instead of
an ever-growing one.

Written before editing per root `CLAUDE.md` ("for anything nontrivial, write the plan to a
markdown file before editing; sessions compact, saved plans don't").

**There is no git in this tree** (`Active Github Repos/My Games-main/` is not a working
copy locally — verified 2026-09-04). Every move below is a real filesystem move with no
`git mv` to undo it. Folders are moved whole, never copied-then-deleted, and the checkers
are run after each phase.

---

## 1. Mobile support: switched off, not deleted-with-prejudice

The friend group is not on mobile. Two games carry real mobile control schemes; every
other game carries nothing but a `<meta name="viewport">` tag.

### 1a. Space Tracer (`gyro-space/space-tracer.html`) — the big one

This is the game that was *built* mobile-first (the folder is called `gyro-space` because
the ship was steered by tilting the phone). Removing it touches the start-screen flow, so
it is the riskiest edit in this pass.

| Piece | Action |
|---|---|
| Screen 2 "SELECT CONTROL MODE" (MOBILE / COMPUTER) | **Delete the screen.** It becomes an unconditional `controlMode = "computer"` and the flow goes screen 1 → name/room → enter. One fewer click for everybody. |
| `#mobileDashButton` (element, CSS, 2 touch handlers) | Delete. Dash is `SPACE`, which already exists and is the only path now. |
| Gyroscope: `enableGyroscope`, `onOrientation`, `beta`/`gamma`/`neutralGamma`, `gyroSupported`/`gyroEnabled`, the `DeviceOrientationEvent` auto-detect, `#gyroButton`, `#recalibrateButton` | Delete. |
| `canvas` `touchstart`/`touchend` (charged beam) | Delete — `mousedown`/`mouseup` already do this on desktop. |
| `document.body` `touchmove` (scroll block) + `touchend` (double-tap-zoom block) | Delete. Both exist only to stop mobile browser gestures. |
| `window.addEventListener("touchstart", startAudio)` | Delete; the paired `click` listener is the one that fires on desktop. |
| `ZOOM_SETTINGS.mobile` (0.7) | Delete the key. `desktop: 1.0` is the only zoom now. |
| `#menuOverlay` (MOBILE CLASS / COMPUTER CLASS) | Delete — **already dead code**, an in-file comment at ~line 1929 records that nothing shows it. Its `#switchModeButton` handler is the only thing that could, and mode-switching is what we're removing. |
| Dev-overlay `Gyro Enabled: …` / `Mode: …` lines | Drop the gyro line; keep dash state. |

**The one thing that must survive:** the screen-4 press-to-enter button. An in-file
comment calls it out as load-bearing for the audio user-gesture requirement. It is, but
not only on mobile — desktop Chrome autoplay policy needs a gesture too. It stays.

`controlMode` is kept as a variable rather than ripped out, initialised to `"computer"`.
The `else if (controlMode === "computer")` steering branch and the two `keydown`/`keyup`
SPACE guards then keep working untouched, which is the smallest possible diff through the
game loop.

### 1b. Glass City Escape (`glass-city-escape/glass_city_escape.html`)

Much simpler: keyboard controls are already set up unconditionally
(`setupKeyboardControls()` runs on every platform). The on-screen D-pad is purely
additive and gated behind a touch-capability sniff.

- Delete `#mobile-controls` markup (d-pad, 5 `.d-btn`s, `#btn-b` DASH).
- Delete the `#mobile-controls` / `.ghost-btn` / `#d-pad` / `.d-btn` / `#btn-*` CSS.
- Delete `setupTouchControls()` and the touch-capability branch in `initGame()`.
- `setupKeyboardControls()` is untouched — arrows/WASD to move, Space/B/Shift to dash.

### 1c. Sweep of everything else

Grepped every `.html`/`.js` outside `node_modules` for touch, device-orientation,
`maxTouchPoints`, `orientationchange` and `isMobile`. Result: **no other game that stays
in the hub has a mobile control path.** Specifically —

- `zombie/`, `rd-arena/`, `reality-rewrite/`, `glucose-dash/`, `leaderboard.html`: the
  only hit is `<meta name="viewport">`. **Left alone** — it is standard responsive
  boilerplate, it changes nothing on a desktop browser, and removing it would be churn.
- `index.html` (hub): one `orientationchange` listener feeding `applyGridShape()`.
  **Left alone** — that is responsive board layout, not a mobile control scheme, and it
  shares a code path with the `resize` + `ResizeObserver` handlers that desktop needs.
- The remaining hits (`wasteland-train-sim` 17, `boids` 4, `particle-simulation` 3,
  `fruit-dropper` 2, …) are all in games being pulled to `under-development/` in §2.
  **Not touched** — they are off the board, and doing mobile surgery on a shelved game is
  work spent on something nobody can reach. Recorded here so it is not mistaken for an
  oversight later.

---

## 2. Twelve games pulled from the hub

Moved whole into `under-development/`, keeping their folder names and filenames. They stay
in the repo (and on GitHub) — they are just not reachable from the board.

```
under-development/
  boids/                 desert-robot-blaster/  four-d-pong/
  fruit-dropper/         hex-grid/              infected-labyrinth/
  javelin-battle/        kula-world/            particle-simulation/
  ps1-racer/             voice-runner/          wasteland-train-sim/
```

`hex-grid/` was **not** on the original list — added 2026-09-04 on the user's call. It was
the last remaining hub card flagged `broken: true`, so pulling it means every card left on
the board opens something that actually runs.

### Relative paths that break on the way down

Only two files reference anything outside their own folder. Both are one directory deeper
now:

- `boids/boids_1.html` → `../shared/identity.js`, `../shared/mp-core.js` become `../../…`
- `voice-runner/voice-runner.html` → `../index.html` back-link becomes `../../index.html`

Every other mover is a single self-contained `.html` with no local `src`/`href` at all
(verified by grep, not assumed).

### Hub edit

Twelve entries deleted from the `GAMES` array in `index.html`. Checked first: the game
`id` strings appear **nowhere else** in `index.html` — no presence map, no vote tally, no
`gameById()` call site hardcodes one — so deleting the entries is the whole change.

What is left on the board (5 cards, one page, `PAGE_SIZE = 6`):

| | plays together today |
|---|---|
| Zombie | yes |
| Space Tracer | yes |
| Glass City Escape | yes |
| RD Arena | not yet |
| ~~Reality Rewrite~~ → **4D Pong** | couch, 2-4 players at one keyboard |

> **Superseded 2026-09-06.** Reality Rewrite went to `under-development/` and 4D Pong came up
> into its slot, at the user's request. The board is still 5 cards on one page. This is the first
> time a game has travelled *up* out of that folder, so it is also the first real test of the
> "Bringing one back" checklist in `under-development/README.md` — which held, with one gap: the
> checklist did not say to add the returning game to `shared/retro.css`'s per-game hue table, and
> did not need to, because the hue for every shelved game was decided in advance. That
> forethought is what made the promotion cheap.
>
> 4D Pong is also why the hub manifest now has a **third** stamp state. `mp` means "plays
> together over the server"; 4D Pong does not, but stamping `MULTIPLAYER SOON` on a game whose
> headline feature is four people at one keyboard would have been actively false, so an entry can
> now declare `couch: true` and gets `COUCH 2-4P` instead.

Boids was the fourth `mp: true` game and it is being pulled, so the "four you can play
together" ordering comment above the array is now wrong by one and gets corrected.

**Glucose Dash stays unlisted** (user's call, 2026-09-04). It is solo-complete and
implements `GameInstance`, but it has never had a hub card — `PROJECT_MEMORY.md` §6 has
tracked that as an open gap since 2026-08-29. It is neither on the board nor shelved, and
the tracker says exactly that rather than filing it under one heading or the other.

### Knock-on effect on the checkers

`scripts/check-doc-sync.js` builds its game list from directories *directly* under the
repo root that contain `.html`/`.js` files. `under-development/` holds only subdirectories,
so it drops out of `gameDirs()` entirely. Consequences, both intended:

- Shelved games no longer contribute to the repo-wide fingerprint, so editing one will not
  mark `PROJECT_MEMORY` / `MULTIPLAYER_PLAN` / `HUB_LOBBY_PLAN` dirty.
- The repo-wide hash moves **once** on this restructure. Re-stamp after reconciling the
  docs, not before.

`scripts/check-global-collisions.js` walks `.html` recursively and will still scan the
shelved games. Nothing to change.

---

## 3–4. Tracking sheet: three columns out

`Game dev tracking.xlsx`, `Sheet1`. Removing columns C, D and E:

- **`Goal for MultiGame?`** — redundant with `Server Integrated?`, which is the same
  question answered by the code instead of by intent.
- **`Stable? (Y/N)`** — superseded by the shelf. A game on the board is stable enough to
  hand someone; a game in `under-development/` is not. The folder *is* the column.
- **`Stable on Mobile? (Y/N)`** — a future aspiration, not current work (§1).

Surviving columns: `Games List`, `On Github?`, `Server Integrated?`,
`Firebase / Leaderboard Integrated?`, `Scripts Segmented?`, `Audio Design?`,
`Aesthetic Unified?`

**One thing to be careful about.** Columns C and D are not only Y/N cells — the
`Website Bones` and `Unfinished Concepts` sections use them as free-text description
columns ("Concept document only — no code exists", "Art assets only (dated 2022) — no
code"). Deleting the columns outright would silently bin that prose. A `Notes` column is
appended at the far right and that text is carried into it, so nothing purely descriptive
is lost. This is a small addition beyond what was asked; it is here rather than in a
silent diff.

The `Games List` block is split under two headers mirroring the filesystem — **`In the hub`**
and **`Under development`** — and shelved rows get their new `under-development/…` paths.

---

## 5. Roadmap for the remaining `No`s

Separate document: `COLUMN_COMPLETION_ROADMAP.md`. It only has to cover 6 games ×
5 columns now instead of 18 × 8, which is the entire point of this pass.

---

## Verification (all three, from repo root)

```
node scripts/check-global-collisions.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
```

All three were clean *before* this work started (verified 2026-09-04) — so any failure
afterwards is this change's fault and not pre-existing. Then reconcile the docs the
checker flags and `--update` to re-stamp.

Manual, because no checker covers it: open `index.html` from `file://`, confirm 5 cards
and no dead links; open Space Tracer and confirm it goes title → name/room → enter with no
mode screen; open Glass City and confirm keyboard movement and dash.
