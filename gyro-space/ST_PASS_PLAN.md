# Space Tracer — split + VECTOR skin (2026-09-04)

Session 4 of `COLUMN_COMPLETION_ROADMAP.md` Phase 1. Closes **Scripts Segmented** and
**Aesthetic Unified**. `On Github`, `Server`, `Firebase / Leaderboard` and `Audio` (6 `.mp3`
files) are already `Yes`.

Spec: `AESTHETIC_GUIDE.md` §6.1 — **VECTOR**, anchor *Asteroids* (1979), world hue `#7DF9FF` ice.

---

## §6.1 asks for four things. Two are right, two are not — read this first.

The guide calls this **Effort: S** and "the closest game in the repo to the target". The first
half is true. The second half rests on two assumptions this file does not hold.

### ✅ Ships → unfilled stroked triangles, vertex bloom on hulls

Correct and cheap. `drawShip()` is literally headed `DRAW SHIP (SOLID)`. This is the change §4.3
calls "the detail nobody implements", and it is what makes a wireframe stop looking like CAD.

### ❌ "Replace manual trail drawing with §4.1 persistence — this is a net *deletion* of code"

**This would delete the trail, not reimplement it.**

`updateShip()` ends with `camera.x = ship.x; camera.y = ship.y;` — the camera **hard-follows**
the ship, so the ship is pinned to the exact centre of the screen forever and the *world* moves
around it. Phosphor persistence smears whatever moves **on screen**. So it would:

- smear the starfield, asteroids, world border, safe zone and every remote ship into comet trails
- leave the local ship, which never moves a pixel, with **no trail at all**

That is the precise inverse of the intent. The trail is a world-space polyline
(`sx = centerX + (p.x - camera.x)`) *because* the ship does not move on screen — it is the one
thing that cannot be replaced by not clearing the canvas.

**Kept as-is, and upgraded instead:** the trail gets §4.2 **beam overdraw** — a wide low-alpha
stroke under a narrow hot one. That is the actual Asteroids look, it is cheaper than the
`shadowBlur` the guide warns about elsewhere, and it costs one extra `stroke()` on a path that is
already being built.

### ❌ "Add wrap-around. It is a handful of lines"

**It is not a handful of lines, and it is a gameplay redesign rather than a skin change.**

This is not an unbounded field. It is a bounded 2000×2000 arena, and the boundary is load-bearing
in four separate places:

| | |
|---|---|
| `isOutOfBounds` + `onLocalDeath()` | crossing the border **kills you** (`space-tracer` ~1760) |
| `clampToBounds` | holds you at the edge if you are already outside |
| bullets | **bounce** off the bounds (~1982) rather than passing through |
| `drawWorldBorder` / `SAFE_ZONE` | both are drawn, and the safe zone is where you respawn |

Wrapping means deleting a kill condition, the border, the bullet bounce, and re-deciding what the
safe zone means when there are no corners to retreat from. Asteroids **already** wrap
(`asteroids` ~779) — so the arena is deliberately inconsistent: hazards wrap, players are caged.

**Not done.** Flagged to the user as a design decision rather than taken unilaterally. It is also
outside the column being closed: `Aesthetic Unified?` is a skin column, and every earlier session
in this phase changed no gameplay.

### And one hard constraint

`AESTHETIC_GUIDE.md` §5: **server-authoritative `MP.selfColor` — "never regress it."** Retro-fitted
2026-08-28 to fix session-ID colouring. Remote ships keep drawing in the colour the server gave
them; nothing in this pass computes a colour.

---

## Pass A — the split

2,218 lines (`space-tracer.html` 233–2449) across 39 commented sections. Unlike the hub and Glass
City, **load-time statements are scattered throughout** — pool fills, `preload` flags, listener
registrations, the starfield build, the rAF boot.

**So the cut is made in STRICT SOURCE ORDER and nothing is reordered.** Every load-time statement
then executes in exactly the sequence it does today, which makes the split safe without hoisting
anything into a boot file. (The hub and Glass City needed hoisting only because their groupings
moved sections past each other.)

| # | File | Lines | Holds |
|---|---|---|---|
| 1 | `st-core.js` | 233–486 | globals, game state, ship, dash, camera, spatial grid, beam state, projectiles |
| 2 | `st-audio.js` | 487–574 | the sample-based audio system |
| 3 | `st-world.js` | 575–977 | input, starfield, trail state, world bounds, explosions, asteroids |
| 4 | `st-game.js` | 978–1360 | scoring, multipliers, helpers |
| 5 | `st-render.js` | 1361–1480 | coordinate transform, draw ship, rings, dev overlay |
| 6 | `st-ui.js` | 1481–1682 | mouse, the start-screen flow, audio/GUI toggles |
| 7 | `st-motion.js` | 1683–1948 | ship movement, trail update/draw, charged beam |
| 8 | `st-draw.js` | 1949–2346 | bullets, music, starfield, remote ships, border, `drawScene` |
| 9 | `st-boot.js` | 2347–2449 | keyboard dash, the main loop, initial setup |

The `<script type="module">` Firebase block in `<head>` is untouched — it is the one accepted
module exception in this repo, and it already degrades on `file://`.

## Pass B — the skin

- **Ships**: unfilled stroked triangles, `--phos-hot` core over the player's identity colour,
  `RETRO.vertexBloom` on the three hull vertices. Remote ships identical, in *their* colour.
- **Trail**: §4.2 beam overdraw, two passes over the existing path.
- **Tokens**: `shared/retro.css`, `data-game="space-tracer"` (`--world-hue: #7DF9FF` ice),
  `data-cabinet="vector"` (which is what keeps the raster-only scanlines off).
- Starfield → `--phos-mid`; world border → `--sig-magenta` (it kills you: danger); safe zone →
  `--sig-cyan` (safe/navigable — literally the token's meaning); dev overlay and HUD onto tokens.

**Audio is not touched at all**, per §6.1 and because the mobile freeze bug is unrelated and
still open.

## Verification

All three checkers, then over `http://127.0.0.1` — never the preview pane. Title → name/room →
enter, ship flies, SPACE dash still charges at 0.6× and releases at 3×, firing works, remote
ship colours still come from the server.
