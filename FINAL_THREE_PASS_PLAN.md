# The final three — Split + Audio + Aesthetic (2026-09-05)

Sessions 5–7 of `COLUMN_COMPLETION_ROADMAP.md` Phase 1, run as one pass. Closes
`Scripts Segmented?`, `Audio Design?` and `Aesthetic Unified?` on the last three games that
still carry `No` cells: **Reality Rewrite**, **RD Arena**, **Glucose Dash**.

**Explicitly deferred by the user this session** — both are open questions, not work:
- RD Arena `Server Integrated?` (the Gray-Scott field cannot go on the wire — needs its own
  design session and plan file).
- The Gyro Space live-palette bug (deployed Render server still serves the pre-2026-09-03
  palette; only a push to the separate `gyro-space-server` repo plus a redeploy closes it).

---

## 0. Glucose Dash is now shelved — done first, because it changes the target

Moved `glucose-dash/` → `under-development/glucose-dash/` on 2026-09-05 at the user's
instruction, and its two shared script paths re-pointed `../shared/` → `../../shared/`
(`identity.js`, `mp-core.js` — the only two relative paths the file had; it has no
back-to-hub link and nothing in the repo referenced it).

**It was never on the hub board anyway** — the tracker had it under *"Built, not hub-linked"*,
an open gap since 2026-08-29. So the move makes a de-facto status official rather than removing
a card. `On the hub?` for Glucose Dash is **No**, deliberately.

### The consequence that matters

`Aesthetic Unified?` is a property of the **set**, not the row. Shelving Glucose Dash means the
active set is now **Reality Rewrite + RD Arena** (plus the four already done). Finishing those
two flips the column to `Yes` for everything on the board — Glucose Dash then carries its own
row under `under-development/`, held to the same standard but not gating the column.

Glucose Dash is still getting its full pass this session (the user asked for all three), which is
a **deliberate exception** to `under-development/README.md`'s "don't do speculative work on
shelved games" rule: the work was already scoped and the file is already understood. Recorded
here so it does not read as precedent.

---

## 1. §6 has now been wrong three sessions running — check it before trusting it

Space Tracer (§6.1) found two of four instructions unsafe. Glass City (§6.8) found two. This
session found a third, before writing any code:

> **§6.12 says the phosphor shift "costs approximately one CSS custom property because the game
> already funnels colour through `var(--stable-color)`."** It does not. `--stable-color` is used
> in exactly two places — the stability meter's fill (`#stability-bar`, CSS line 118) and the
> threshold swap in `updateUI()` (line 1226). It is the **health bar**, not the monitor. The
> world ground is `--bg-color` (`#f4f6f8`), read per-frame inside `draw()`.

Also worth knowing: **12 of §6's 19 entries point at paths that are now under
`under-development/`.** Only §6.0, 6.1, 6.3, 6.4, 6.5, 6.8 and 6.12 describe live games.

---

## 2. Reality Rewrite — `reality-rewrite/` · VECTOR · anchor: Tempest's colour states

1,422-line file; inline script is **206–1420**. Cells closed: Split, Audio, Aesthetic.
(`Firebase / Leaderboard` is a separate decision — see §2.4.)

### 2.1 Pass A — the split

`reality-rewrite/CLAUDE.md` has carried a **planned** 6-file split since before 2026-09-02 that
was never built. The section boundaries in the file line up with it almost exactly, so the plan
is honoured with two documented name changes: the `rr-` prefix (every other split game in the
repo uses one — `st-*`, `gc-*`, `zombie-*`), and `game.js` → `rr-boot.js` for the same reason.

**Cut in strict source order, nothing reordered** — the rule that made the Space Tracer split
safe. This file needs it: `resize()` is *called* at line 220, `const canvas`/`ctx` resolve DOM at
211–212, and `mouse` at 287 reads `width`, which `resize()` set.

| # | File | Lines | Holds |
|---|---|---|---|
| 1 | `rr-core.js` | 211–374 | canvas/ctx, `resize()` + its call, math helpers, `ui` refs, `STATE`, game vars, map bounds, `SHIFTS`, input + `attachInputListeners`, `COSTS`, lifecycle vars, `trackTimeout`/`trackInterval`, `darken`, `resolveIdentity`, entity arrays |
| 2 | `rr-entities.js` | 376–905 | `Block`, `Bullet`, `SlowOrb`, `SlowField`, `Ripple`, `Particle`, `Fighter` |
| 3 | `rr-mapgen.js` | 906–1038 | `rotateOffset`, `makePieceRects`, `subdivideForPieces`, `buildBorder`, `buildMap`, `findSafeSpawn` |
| 4 | `rr-phases.js` | 1039–1186 | `initGame`, `hasCard`, `modifyStability`, `startAuthorPhase`, `executeShift`, `renderCards`, `triggerEnding`, `showRankings` |
| 5 | `rr-render.js` | 1187–1340 | the whole UPDATE & DRAW section — `update`, `updateUI`, `draw`, `loop` |
| 6 | `rr-boot.js` | 1341–1419 | `window.GameInstance` + the two bottom `init()`/`start()` calls |

**Deviation from the planned split, recorded:** file 5 holds `update()` and `loop()` as well as
`draw()`. Splitting them out would mean interleaving the range (updateUI sits between update and
draw), and reordering is the one thing this cut does not do. They are all function declarations,
so it would in fact be safe — but "contiguous ranges only" is the rule that has kept four splits
bug-free and it is not worth spending here for one 55-line file.

Script tags go at the end of `<body>`, after the markup, because `rr-core.js` resolves DOM at
load time. `identity.js` still loads **before** `mp-core.js` (mp-core falls back to it when solo).

### 2.2 Pass B — the skin

The guide's phosphor-shift idea is right and survives its wrong premise, it just costs a new
variable instead of an existing one:

- `--bg-color: #f4f6f8` → `var(--ground)` (§2.1: pure black — a vector monitor's black is the
  absence of beam). `--text-color` → `--phos-mid`, UI chrome → `--sig-cyan`.
- **New `--phosphor`**, defaulting to the game's world hue, driven by `executeShift()`:
  green → amber → cyan → magenta as each rule lands. That is the §6.12 idea, implemented where
  the colour actually lives. The Signal Three keep their meanings (§2.2) — `--sig-magenta` stays
  danger, so the shift cycles the *world*, not the signals.
- **Cache the ground colour.** `draw()` currently calls
  `getComputedStyle(document.documentElement).getPropertyValue('--bg-color')` **every frame**.
  Read it once on shift and store it; per-frame `getComputedStyle` forces style recalc.
- Vignette: keep, quantized (§6.12 is right that it already exists — lines 1055/1151–1152).
- `data-game="reality-rewrite"` + `data-cabinet="vector"` (which is what keeps §4.6 scanlines off).
- Ships/fighters and cover → stroked with `RETRO.vertexBloom`; blocks stay legible as cover.

**Known pitfall, from `reality-rewrite/CLAUDE.md`:** `render.js` has previously overwritten CSS
values on every call (the vignette regression). This pass both *creates* `rr-render.js` and
*touches the vignette* — exactly the collision the note warns about. `renderCards()` in
`rr-phases.js` owns the vignette background; `rr-render.js` must not write it.

**Hard constraint (§5):** do not add a name→colour function back. `IDENTITY.colorFromName()` is
the only one, and this file is the reason that rule exists.

### 2.3 Pass C — audio

No audio today. Wire `shared/sfx.js`: `SFX.configure({ game: "reality-rewrite" })`,
`SFX.unlockOn(window, listenerController.signal)`, then `shoot`/`hit`/`death`/`pickup` on the
existing events, plus a distinct sequence on `executeShift()` — the rule change is the game's
signature moment and should sound like one.

### 2.4 The open question this pass does NOT settle

`getState()` already returns `player.score` and `player.kills`, so the roadmap's "does this game
even have a score" is answerable: **yes, it has a number.** Whether that number belongs on a
shared leaderboard is still the user's call, so `Firebase / Leaderboard Integrated?` is left
alone rather than filled in.

### 2.5 Open task carried in from `CLAUDE.md`

`init()`/`getState()` are self-documented as *"inferred from that doc's description, not verified
against the real file."* Verify against `GAME_PROTOTYPE_INSTRUCTIONS.md` and Space Tracer while
`rr-boot.js` is being written — it is free at that moment and expensive later.

---

## 3. RD Arena — `rd-arena/` · RASTER · anchor: *Space Invaders* (1978)

2,487 lines. Cells closed: Split, Audio, Aesthetic. **Server stays `No`** (deferred above).

### 3.1 The skin is the cheapest win in the repo

§6.4 is the one entry that has been *right*. The flesh field is already thresholded at
`gridB > 0.3`, already filled flat `#4a0404`, already on a 400×400 grid, drawn as overlapping
`arc()` calls of radius `cellSize * 0.78`. Changing those to
`fillRect(x*cellSize, y*cellSize, cellSize, cellSize)` makes it a chunky monochrome pixel grid —
**exact period rendering, zero simulation change, and faster** (rect fills beat 160k arc paths).

Recolour to `#8B0A2E` (already the game's `--world-hue` token), add a second hotter band above
~0.6 for the two-tone sprite look. Sanctuaries → `--sig-cyan`, sprinkler motes → `--sig-amber`,
both free from §2.2.

### 3.2 The gameplay suggestion — flagged, not taken silently

§6.4 wants the Space Invaders speed-up: as the flesh field shrinks, raise RD steps per frame.
It is a good idea and roughly one line. It is also **a difficulty-curve change to a game whose
balance nobody has re-measured since the V2 rebuild**, and every earlier session in this phase
changed no gameplay. Same call as Space Tracer's wrap-around: **implement nothing, flag it.**

### 3.3 Untouchable (§5)

`dA`/`dB`/`feed`/`k`, the 400×400 grid, the `>0.3` threshold, the flow field, the motes. The
simulation is the game. The render change above touches none of it.

### 3.4 Audio

`glide.mp3` is present in the folder and **unreferenced anywhere in `RDArena.html`** (verified).
Decision: **go procedural via `shared/sfx.js`**, and leave the orphan file in place rather than
delete it. Rationale — it keeps the `file://` constraint clean (no binary asset to fail to load),
it matches what Zombie and Glass City already do, and the repo's one sampled-audio game is the
one with the open freeze bug.

---

## 4. Glucose Dash — `under-development/glucose-dash/` · GEL · anchor: *Space Invaders*' gel

2,656 lines. Cells closed: Split, Aesthetic. Audio is already `Yes` (procedural oscillator).
Runs **last**, because it is the shelved one.

### 4.1 The fork §6.5 leaves open — taking (a)

§6.5 offers **(a) gel band per storey, keep the white mall** or **(b) invert to black ground**,
and says explicitly that (b) "overturns a deliberate call, so it is the user's decision, not a
silent change." The user has not made that call. **Take (a).** It is the option that preserves
the documented intent — *"all the colour saved for the storefronts so the thing you're steering
toward is the only saturated object on screen"* — and it is `Effort: S` rather than `M`.

Three hard-edged coloured gel bands (§4.5), one per storey, so the floors read as three
physically different strips of plastic. Storefronts keep the only saturation. Checkerboard
quantized to the pixel grid.

### 4.2 The three rules that must survive, verbatim from `glucose-dash/CLAUDE.md`

1. **`pathWalkable(f)` is the single source of floor geometry** — the fill, the checkerboard
   clip and the wall/hazard stroke all come off that one path. §6.5 says *"do not touch
   `pathWalkable(f)`"* and it is right. When the drawn floor and the walkable floor disagreed,
   **every upper storefront had an invisible hole at each end**.
2. **`SX(tx, ty)` takes a y as well as an x** — the centreline curve is added there and nowhere
   else. Physics, collision and AI never see the curve.
3. **Draw order is source order.** No depth, no sorting, no bias.

The aesthetic pass touches the renderer, which is exactly where rule 1's regression lives. The
gel is an **overlay pass after the floor**, not a change to how the floor is built.

### 4.3 Do not touch

`TUNE.baseDecay` ↔ food density is **one dial**. `COURSE_LEN = 3300` scales the NPC horizon,
food density and scan ranges. `COURSE_SEED` (world layout, identical for everyone) and
`MP.random()` (which slots are stocked) are two different randomnesses and confusing them is a
real bug. None of this is aesthetic work — it is listed so it stays untouched.

---

## 5. Verification — every game, every time

```
node scripts/check-global-collisions.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
```

Plus, per game, the file-local check `check-global-collisions.js` cannot do:

```
grep -oE '^function [A-Za-z_$][A-Za-z0-9_$]*' <game>/<file>.html | sort | uniq -d
```

Glucose Dash additionally has a console-driving harness in its `CLAUDE.md` (serve the repo root,
`startRace(); phase="racing";` then step `update(1/60)`) — **rAF is throttled in a background
pane, so watching it is a bad way to check anything.** Every bug in its `SCOPE.md` §5 was found
that way and none was visible from play.

---

## 6. Docs to reconcile at the end

`check-doc-sync.js` already reports the four repo-wide docs stale from the Glucose Dash move
alone. Expect to update: `PROJECT_MEMORY.md` (session entry + the shelving),
`COLUMN_COMPLETION_ROADMAP.md` (sessions 5–7), `AESTHETIC_GUIDE.md` (the §6.12 correction and
the 12 moved paths), `under-development/README.md` (thirteen games now, and Glucose Dash's
`../../shared/` paths join boids and voice-runner on the "has relative paths" list), each game's
own `CLAUDE.md`, and `Game dev tracking.xlsx`.

**Also flagged, out of scope:** `GAME_PROTOTYPE_INSTRUCTIONS.md` is **not tracked by
`check-doc-sync.js`** and has gone stale unnoticed — it still says "no game has been split into
multiple classic-script files yet", "no current game implements `window.GameInstance`", and that
identity "is not actually centralized or server-side". All three were true on 2026-08-24 and are
false now. It is the doc root `CLAUDE.md` tells every session to read *in full, first*.
