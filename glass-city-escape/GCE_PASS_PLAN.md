# Glass City Escape — split, VECTOR skin, leaderboard (2026-09-04)

Session 3 of `COLUMN_COMPLETION_ROADMAP.md` Phase 1. Closes **Scripts Segmented**,
**Aesthetic Unified** and **Firebase / Leaderboard**. `On Github`, `Server` (race mode, 2026-08-25)
and `Audio` (procedural, already) are `Yes`.

Spec: `AESTHETIC_GUIDE.md` §6.8 — **VECTOR** cabinet, anchor *Battlezone* (1980).

Same two-pass shape as the hub: **split first with zero behaviour change, skin second.**

---

## Where the spec meets the actual code

§6.8 was written against an assumption this file does not hold, and it is worth stating before
following it:

> "Buildings → unfilled wireframe boxes, **horizon line**, vertex bloom on every corner."

**There is no horizon, because there is no horizon to draw.** The renderer is labelled
*"Rendering (Pure Top-Down)"* and is a 2D tile grid — the same shape Glucose Dash landed on after
its perspective renderer was removed. A horizon line is a property of a view with a vanishing
point. Skipped deliberately, recorded here so it does not read as an oversight.

Everything else in §6.8 does apply, and two parts are **already done**:

- *"Race mode's ghosts use the identity palette"* — they already do; `broadcastPosition()` sends
  `c: MP.selfColor`, which is the server's authoritative colour.
- The page chrome is already dark with cyan (`#0ff` menus, `#111` ground), so the CSS is a
  token swap rather than a reversal. This is the "highest ratio of payoff to effort" the guide
  claims, but mostly because it started closest.

## The legibility constraint that outranks the spec

Tiles are not decoration — they are the collision model:

| Tile | Rule |
|---|---|
| `wall` | solid, blocks the player and robots |
| `floor` | walkable interior |
| `exterior` | walkable at `z = 0` (the street); **at `z > 0` it is the drop you fall through** |
| `stair_up` / `stair_down` | walkable, changes floor |
| `escape_tunnel` | the goal |

Taken literally, *"unfilled wireframe boxes"* makes a wall an outline around empty space — which
in a top-down view reads as **a room you can walk into**. That is the aesthetic breaking the
mechanic, which §5 forbids. So walls get a wireframe outline **plus a faint interior tint**: it
reads as mass, keeps the Battlezone line-work, and cannot be mistaken for floor. Deviation from
the letter of §6.8, deliberate, recorded.

The reverse case is free and correct: `exterior` at height becomes plain black, so the drop looks
like a drop.

## Pass A — the split

1,178 lines (`glass_city_escape.html` 146–1323) in eight commented sections. Only two things run
at load: the `MP.connect({...})` call and `window.startGame = initGame`.

| # | File | Sections |
|---|---|---|
| 1 | `gc-core.js` | 8-Bit Audio, Game Configuration & Globals, UI Message Logic |
| 2 | `gc-net.js` | Multiplayer — **minus** the `MP.connect()` call |
| 3 | `gc-entities.js` | Player Entity, Robot Surveyor Entity |
| 4 | `gc-world.js` | World Generation & Stage Management |
| 5 | `gc-render.js` | Input Handling, Rendering |
| 6 | `gc-boot.js` | Initialization, the `MP.connect()` call, `window.startGame` — **the only file that executes** |

**`MP.connect()` moves to the boot file.** It currently sits mid-section and runs at load; its
`onReady` can fire synchronously on the solo/`file://` path, which would reach functions declared
in files further down. Moving it after every declaration removes that ordering hazard rather than
reasoning about it.

## Pass B — the skin

| Tile | Now | Becomes |
|---|---|---|
| `wall` | filled light blue | `--sig-cyan` outline + faint tint + vertex bloom on all four corners |
| `floor` | filled white | black with a `--phos-dim` grid |
| `exterior` | filled `#555` | plain `--ground` — the void reads as void |
| stairs | white with grey bands | `--phos-mid` frame, `--phos-hot` arrow |
| `escape_tunnel` | pulsing green | pulsing `--sig-cyan` (§6.8: "goals go `--sig-cyan`") |

Vertex bloom is `RETRO.vertexBloom` from the Phase 0 layer — §4.3 calls it the change that makes
a wireframe stop looking like CAD output. Applied to wall corners only, and **only for the
current floor**, so the dimmed floors below stay cheap.

CSS: `--dark-bg: #111` → `--ground`, `#0ff` → `--sig-cyan`, `#ff3333` → `--sig-magenta` (health,
which is damage), `#ffcc00` → `--sig-amber` (cores, which are value), `#00ffff` → `--sig-cyan`,
fonts onto `--font-display` / `--font-ui`.

## Pass B — leaderboard

**Score is the stage reached, submitted from solo play only** (user's call, 2026-09-04).

The two modes score incompatibly: online is a race where **lower time is better**, solo is endless
stages where **higher is better**. `leaderboard.html` does `orderBy("score", "desc")` and keeps
each player's maximum — so it can only express "higher is better", and posting a race time in ms
would rank the *slowest* player first. Online standings already exist in-game (`standingsText()`
shows placings and times), so nothing is lost by leaving the race off the global board.

Submitted on death and on stage clear, behind a "best posted this run" guard so a long run posts
once per new best rather than once per stage.

## Verification

All three checkers, then over `http://127.0.0.1` (never the preview pane — it runs pages hidden
with a 0-width viewport). Walls must still block, the drop must still kill, stairs must still
work, and the escape tunnel must still finish the stage.
