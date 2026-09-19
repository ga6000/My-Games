# Zombie — aesthetic pass + leaderboard (2026-09-04)

Session 1 of `COLUMN_COMPLETION_ROADMAP.md` Phase 1. Closes Zombie's two remaining `No`
columns: **Aesthetic Unified** and **Firebase / Leaderboard**. `Scripts Segmented`, `Server`
and `On Github` are already `Yes` — Zombie is the only game split into files, which is why the
roadmap puts it first: it is the cheapest session and it proves the Phase 0 shared layer before
five other games depend on it.

Spec: `AESTHETIC_GUIDE.md` §6.3 — **RASTER** cabinet, anchor *Berzerk* (1980).

Written before editing per root `CLAUDE.md`.

---

## What must not change (AESTHETIC_GUIDE §5 + zombie/CLAUDE.md)

- **`ambientDarkness()` stays the single source of truth, and the radius values are untouched.**
  Generator off `0.72`, on `0.22`, blackout `+0.20`, clamped to `0.9`; `LIGHT_RADIUS = 340`,
  `LIGHT_FADE = 1.33`. v2 blacked out at 0.94 with a hard 210px hole and playtested as a
  guaranteed loss. **Quantize the ramp, never the numbers.** Nothing in this pass reads or
  writes a balance constant.
- All timers through `trackTimeout`/`trackInterval`, all listeners through the one
  `AbortController` in `zombie-core.js`. This pass adds neither.
- `MP.random()` for level generation, never `Math.random()`. This pass touches no generation.
- Ten scripts share one global scope. Every new top-level name checked for collisions first:
  `zFrameCount`, `ZOMBIE_DRAW_CAP`, `LIGHT_BANDS`, `zLbSubmitted` — 0 hits each across
  `zombie/` and `shared/`.

## Two errors in `zombie/CLAUDE.md` found while reading it

Fix these in the same pass — the doc is the most-trusted artifact for this game and both are
actively misleading:

1. **The lighting table appears twice with different numbers.** The "Lighting, generator, cards"
   section says generator off `0.55` / on `0.00` / blackout `+0.20`; the later "Lighting" section
   says `0.72` / `0.22` / `+0.20`. The code (`zombie-game.js`) says **0.72 / 0.22 / +0.20** — the
   later one. The first is a pre-2026-09-02 leftover.
2. **"Known gaps" still claims "No audio at all"**, which v3's `zombie-audio.js` made false — the
   same file the load-order table lists at position 4 and a whole section describes.

---

## 1. Quantized lighting (§6.3's core ask) — `zombie-render.js`

`drawLighting()` currently builds one `createRadialGradient` from `inner` to `outer`,
transparent → `dark`. The era had no smooth gradients.

Replace with **four bands from the identical inputs**:

| Band | Radius | Alpha |
|---|---|---|
| lit | `r ≤ inner` | `0` |
| near | `inner → mid` | `dark × 1/3` |
| far | `mid → outer` | `dark × 2/3` |
| ambient | `r > outer` | `dark` |

Implementation: one full-screen fill at `dark`, then three `destination-out` arcs that *remove*
darkness in steps. Removal fractions are chosen so the compounding lands on exact thirds —
`1 - (1-f₁)(1-f₂)…` — rather than three independent alphas that would multiply into the wrong
levels. Band levels come from `RETRO.band(t, 4)` so the shared helper is genuinely used rather
than reimplemented.

`inner`, `outer`, the `downed ? ×0.55` reduction and the `dark ≤ 0.005` early-out are all carried
over unchanged. The no-player branch (flat fill) stays as-is.

Hard-edged light is *more* threatening than soft, so this should read better as well as being
period-correct.

## 2. Blackout → colour-drop to monochrome — `zombie-render.js`

The guide's alternative to "more darkness", explicitly chosen to avoid re-litigating a balance
decision that already failed once at 0.94.

One full-screen `globalCompositeOperation = "saturation"` fill in screen space, after the world
draw and before `drawLighting()`. Cheap — a single `fillRect`, not the per-pixel pass §4.12
forbids. Applies to the canvas only, so the DOM HUD keeps its green; that is fine and arguably
right (the readout is a device, the world is what has lost its colour).

Gated on the existing `isBlackoutRound(round) && roundPhase === "active"` — the same condition
`ambientDarkness()` already uses, so the two can never disagree about whether it is a blackout.

`saturation` blend support is verified in-browser during this pass; if the browser ignores it the
frame simply renders in colour, which is a cosmetic no-op rather than a failure.

## 3. Blocky zombies + flicker budget — `zombie-render.js`

- **≤3 colours, blocky.** Body rect in `z.color`, a darker lower band, white for the existing
  `flashUntil` hit-flash. Positions snapped with `RETRO.snap(v, 4)` — **render only**, per §4.4
  and the `SX()` precedent in Glucose Dash. `z.x/z.y` are never written.
- **Flicker budget (§4.7).** Past `ZOMBIE_DRAW_CAP` on-screen zombies, render the overflow on
  alternating frames via `RETRO.flicker(drawn, cap, zFrameCount)`. Authentic *and* a real
  optimization on late-round hordes — the rare aesthetic choice that pays for itself.
  Counted against **zombies actually drawn**, not the array index, or culling would make the
  budget depend on where the camera is pointing.
- Screamers are **exempt from the flicker budget**. They are the callout target and their white
  outline is how you find them in a crowd; a screamer that renders every other frame is a
  gameplay regression dressed as an aesthetic.

> **Superseded 2026-09-18 — the flicker budget is removed.** A friends playtest found it
> distracting and hard to read when the screen was full of zombies, which is exactly when reading
> it matters. Every on-screen zombie is drawn every frame now (`zombie/PLAYTEST_PASS_PLAN.md`,
> item 1). The blocky ≤3-colour sprites and render-only snapping above still stand.
- `zFrameCount` increments in `gameLoop`.

## 4. Muzzle flash — one white frame

`p.lastShotTime` already exists and is set on every shot in `zombie-game.js`, so this needs
**no new state**: draw a white block at the muzzle while `now - p.lastShotTime < 60`. Reuses
`p.facingX/facingY`, which already position the existing aim pip.

## 5. Tokens + cabinet — `Zombie.html`

- `<link rel="stylesheet" href="../shared/retro.css">`, `<body data-game="zombie"
  data-cabinet="raster">` — gives the page `--world-hue: #FF4A1C` (ember) and the Signal Three.
- HUD recoloured onto tokens. The current `#55FF55` is a DOS P1 green and close to
  `--phos-mid`; the win/game-over/prompt chrome moves to `--sig-amber` / `--sig-magenta` /
  `--sig-cyan` by meaning, not by taste.
- **Scanlines** (§4.6) — permitted here because this is a Raster cabinet, and the CSS is already
  gated behind `[data-cabinet="raster"]` so it cannot be applied to a Vector game by mistake.
- The canvas already has `image-rendering: pixelated` and a `#000` ground, so both are already
  correct.

**Not doing:** the font swap. `retro.css` resolves to Courier New until the `.woff2` binaries
land, and Zombie is already Courier — so this is a no-op today and becomes correct for free the
moment `scripts/embed-fonts.js` is run.

## 6. Leaderboard — `Zombie.html` + `zombie-game.js`

`<script src="../shared/leaderboard.js">`, then `LB.configure({ game: "zombie" })`.

**The score is the round reached**, which is what `uiFinalRound` already displays and what the
game is actually about. `scoreBoard[id].score` exists but is per-player kill credit within a
run, and is host-owned — round is the number a survival game's leaderboard wants.

Submitted from `triggerGameOver()` **and** `triggerWin()`, guarded by a `zLbSubmitted` flag reset
in `resetGame()` so a reset-and-replay does not double-post and a client receiving the host's
`go` message does not post a second copy of its own run.

Name and room come from `MP.selfName` / `MP.room`, which is where every other identity value in
this game already comes from. Under `file://` `LB` degrades to a silent no-op, so a
double-clicked game is unaffected — that is the whole point of the Phase 0 design.

---

## Verification

```
node scripts/check-global-collisions.js     # 10 scripts share one scope
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
```

Then in a browser over `http://127.0.0.1` (NOT the preview pane — it serves local files as
`data:` URLs, so `../shared/*.js` cannot resolve and the game dies silently; this has now cost
two sessions):

- four discrete light bands, no visible gradient
- blackout round renders monochrome
- muzzle flash on fire
- `LB.status()` reaches `ready`; a game over posts exactly one score
- the game still plays — movement, shooting, round start
