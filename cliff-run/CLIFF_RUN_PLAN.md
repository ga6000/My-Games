# Cliff Run — build plan

**Which game?** `cliff-run/` — a new game, the repo's sixth active one. Not Hub ZOMBIE, not the
long game.

**Which finish-line item does this close?** **None.** `HUB_RETROSPECTIVE.md` §5 is a five-card
board plus Zombie v1, and a new game is not on that list. This is built **off-board on purpose**:
`SCOPE_RULES.md` rule 8 makes promotion one-in-one-out, and which card it would displace is the
user's call, not this plan's. So `cliff-run/` lands at the repo root (active, not
`under-development/`) and `hub/hub-core.js`'s `GAMES` array is **left untouched**. Requested by
the user 2026-10-16.

---

## 1. What it is

A 4-player free-for-all side-scrolling platformer down a cliff face. Ten levels. Forced scroll —
slow on level 1, fast by level 10 — with a rock avalanche filling the left 5% of the screen that
kills anyone it catches. Players 2–4 are bots for now.

**Session length.** `SCOPE_RULES.md` rule 0: 2–5 minutes. Ten levels inside that window means
~20–30s a level, which is what sets the level lengths in §4. This is the constraint that decides
the content budget, so it is stated first.

**Cabinet: RASTER.** `AESTHETIC_GUIDE.md` §1 makes the assignment mechanical — "what does the game
already draw?" — and the answer is chunky filled blocks on a tile grid with blocky sprites. So:
pure black ground, filled blocks snapped to a virtual pixel grid, scanlines permitted
(`data-cabinet="raster"` on `<body>` is what gates them), tight palette.

**World hue: `#6F8FA8` basalt steel.** A deliberate departure from §2.5's table, which is all
neon, and the reason is in the game: the cliff is the single biggest thing on screen, four player
identity colours are drawn on top of it, and the Signal Three have to stay legible against it. A
saturated terrain hue would fight all three. Rock reads as rock in three tones of basalt and the
hue budget goes to the entities — which is §2.2's own discipline ("most information was conveyed
by *brightness*, not hue"). Steel is also the one region of the hue table nobody has claimed: not
ice `#7DF9FF`, not glass `#00B4FF`, not rust `#C46A2F`.

---

## 2. Files

```
cliff-run/cliff-run.html   shell: cabinet panel, scanlines, menu, script order
cliff-run/cr-core.js       constants, state, teardown plumbing, identity, helpers
cliff-run/cr-audio.js      OWN AudioContext: one-shots + the sustained voices
cliff-run/cr-level.js      seeded level build + the guaranteed route
cliff-run/cr-entities.js   bodies, blocks, items, bombs, wind, branches, coins
cliff-run/cr-physics.js    integration, tile collision, wall skills, player-vs-player
cliff-run/cr-bots.js       route-following controller for players 2-4
cliff-run/cr-render.js     the raster draw
cliff-run/cr-panel.js      cabinet panel writers
cliff-run/cr-boot.js       window.GameInstance, menu, match flow, the loop  (LAST but one)
cliff-run/cr-dev.js        DEVTOOLS registration  (LAST)
```

Classic `<script>` tags, one shared global scope, no modules — the `file://` hard constraint.
Every top-level name is `cr`/`CR_`-prefixed; `scripts/check-global-collisions.js` enforces it.
`"use strict"` in **every** file (`GAME_PROTOTYPE_INSTRUCTIONS.md` §2: the directive is per-file,
and omitting it silently drops every file but the first into sloppy mode).

Load order: `identity.js` → `mp-core.js` → `retro.js` → `leaderboard.js` → `devtools.js` → this
game's files → `cr-dev.js`.

**Audio owns its own `AudioContext`, not `shared/sfx.js`.** Same call Glass City made and for the
same reason: `SFX` is a one-shot vocabulary with no sustained-voice primitive, and this game's two
most important sounds are sustained — the wind tunnels and the avalanche rumble. Loading `SFX` as
well would put a second `AudioContext` on the page. **The two shared jingles are reproduced
note-for-note** (`pickup` = rising triad 523.25/659.25/783.99, `death` = descending
392/329.63/261.63/196) so that the sounds `shared/sfx.js` says "should sound IDENTICAL everywhere"
still do.

---

## 3. Geometry and physics

Virtual framebuffer **480 × 288** (16:9, 30 × 18 tiles at `TILE = 16`), integer-scaled with
`image-rendering: pixelated` and letterboxed into the window-minus-panel. Players are 10 × 14 —
"somewhat small on screen", as asked.

`RETRO.snap()` at the draw call only. **Quantize rendering, never physics** (§4.4) — the sim never
sees a snapped value, because quantized physics produces collision bugs that read as gameplay
bugs.

Constants (virtual px, seconds), chosen so the generator in §4 can prove reachability:

| | value | consequence |
|---|---|---|
| `GRAVITY` | 760 | |
| `MOVE_SPEED` | 108 | |
| `JUMP_VEL` | −240 | apex 37.9px ≈ **2.4 tiles**, airtime 0.63s, range **68px ≈ 4.2 tiles** |
| double jump | −216 | second jump, only with a charge |
| `DASH_VEL` | 260 for 0.18s, 0.6s cooldown | ≈ +47px of reach |
| branch spring | −420 | apex 116px ≈ 7.2 tiles, range ≈ **7.4 tiles** |
| wall slide | `vy` capped at 46 | |
| wall jump | `vy` −230, `vx` ±140, 0.12s steer lockout | short enough to press back into the same wall — the Celeste back-and-forth |
| coyote / buffer | 0.09 / 0.10 | |

**Generated gaps are capped at 3 tiles** (48px) for a plain jump against a 4.2-tile range, and
**step-ups at 2 rows** against a 2.4-tile apex. Everything bigger needs a branch, a vent or a
double-jump charge, and the generator only emits those when it has placed the thing that pays for
them. The margin is the point: a route that is exactly reachable is a route the bots fail.

### Player-vs-player, the bouncy part

AABB overlap, resolved on the axis of least penetration.

- **Stationary is a wall.** `speed < 12 && onGround` → immovable; the mover takes the full
  reflection at restitution 0.8 and the wall does not move. This is also what makes a **finished**
  player on the catwalk a wall, which is the spec's own consequence ("remains stationary until
  other players finish or die") and is left in deliberately.
- **Landing on a head** (vertical axis, upper body falling): upper gets `vy = −190` and a jump
  refresh, lower gets `vy = +60` and a horizontal shove.
- **Both moving** → equal-mass elastic exchange along the normal at restitution 0.75, penetration
  split half each.

### Death

- `y` past the level floor → **death by falling**.
- left of the avalanche line (camera + 5% of screen width) → **death by avalanche**.
- A dead player **does not appear on later levels**. Level *n*+1 starts with exactly the survivors.
- **No human alive → the run ends immediately** and the leader is announced. With MP this is where
  the surviving-player winner is announced; see `SERVER_NOTES.md`.

---

## 4. Levels, lanes, and the guaranteed route

Ten levels, seeded (`levelSeed = CR_BASE_SEED + index * 7919`) so a level is reproducible and so
the room seed can replace the base seed later without touching the generator.

Length 150 → 190 tiles; scroll 46 → 96 px/s across the ten. The camera also pushes forward when
the leader passes 70% of the screen, so a fast player is never held back by the floor speed.

**Lanes → intermix, the mechanical version.** Four routes are generated, one per lane, top to
bottom — which is also the spawn order the spec asks for (P1 top-left, P2 upper-middle, P3
lower-middle, P4 lower-left). Each route's **allowed vertical range widens with progress**:

```
laneBlend = clamp(progress / 0.33, 0, 1)
band(lane, p) = lerp(thatLane'sBand, theWholeHeight, laneBlend)
```

At `p = 0` the four routes cannot leave their own band, so the map reads as four horizontal lanes.
By `p = 0.33` every route may use the full height, so they cross, share platforms and put players
in each other's way — which is the "actions of other players directly influence you by this point"
the spec asks for, arrived at by geometry rather than by a scripted event.

All four routes are stamped into **one** shared tile grid, so an overlap is a genuinely shared
platform.

**The route is the solvability proof.** Each route is emitted as a waypoint chain
`{x, y, kind}` with `kind ∈ walk | jump | spring | walljump | bomb | gust | wait`, and the
generator only emits a segment it has just made reachable. That is what lets §6 claim the bots can
finish: they are not solving the level, they are following a path that was built to be followable.
The human player ignores it entirely.

Segment vocabulary, weighted by level index: `run`, `gap`, `up`, `down`, `shaft` (wall-jump,
levels 4+), `branch`, `vent`, `crumble`, `breakable` (bomb, levels 6+).

### Tiles

| code | tile | look (must be unique — the spec asks for it twice) |
|---|---|---|
| 0 | empty | |
| 1 | stone | solid 3-tone basalt block |
| 2 | **crumble-instant** | hollow, hairline-cracked, **no top highlight** — reads as "not really there" |
| 3 | **crumble-timed** | solid but **scored across in red**, and it visibly ticks once touched |
| 4 | breakable | bolted plate, four rivets |
| 5 | branch | stroked limb, not a block |
| 6 | catwalk | steel grating, cyan edge — the finish |
| 7 | outpost | the comms structure at both ends |
| 8 | vent | a dark opening in the rock with its gust field attached |

Start **and** end of every level is a cliff-mounted Comms outpost with **4 catwalk platforms**.
Any player may take any catwalk; walking onto one finishes you and parks you there. The level ends
when every surviving player has finished or died, which is also why the finish re-separates into
four heights after the mid-level intermix.

---

## 5. Audio

One-shots: jump, double-jump, dash, land, coin, pickup, bomb-place, bomb-blast, crumble-tick,
crumble-collapse, block-impact, branch-spring, player-bounce, finish, level-start,
level-transition, run-over, death-by-fall, death-by-avalanche, countdown.

Sustained voices, gain-modulated per frame: **wind tunnel** (filtered noise, panned and gained by
proximity to the nearest vent), **avalanche rumble** (sub oscillator + low noise, gained by how
close the left edge is — the spec's "constant rumble"), and a thin altitude wind bed.

§4.10: square and triangle, hard envelopes, no reverb.

---

## 6. Bots, and how "they can actually beat the game" gets proved

Players 2–4 follow their own lane's route (§4). Controller, in priority order: avalanche panic
(sprint + dash when within 40px of the line) → hazard (a crumble already triggered is waited out
or jumped) → bomb (place, back off a tile, wait for the blast) → shaft (alternate wall, jump,
steer back) → waypoint seek (move toward target x; jump inside a launch window sized from the
physics in §3) → opportunist (coins and charges within a short detour).

Branches **auto-spring on landing** — a trampoline, not a timed input. That is a design choice
made for the bots' sake and it also feels better for the human.

A **stuck guard** (no forward progress for 1.5s while on the ground) fires a hop + dash, so one
bad frame cannot end a bot's run.

Per-bot skill jitter (reaction delay, timing error) scales with level index, so they are competent
but beatable. They are *meant* to die sometimes — that is the game.

**Verification is a headless harness, not a claim.** `scripts/cliff-run-playtest.js` runs the real
game files under `vm` with a stub canvas and no rAF, many seeds × all ten levels, and reports
per-level bot finish rates. The target is stated before the tuning, so the tuning cannot move it:
**a bot reaches and clears level 10 in the clear majority of runs.** Numbers land in
`cliff-run/CLAUDE.md` when they are real.

---

## 7. Cabinet panel — required

`AESTHETIC_GUIDE.md` §4.11a, modelled on Zombie's `#sidebar` (`clamp(240px, 18vw, 380px)`, ground
`#050505`, 2px `--phos-dim` inner rule, red labels / white values).

1. **HI-SCORE** + **1UP**
2. **The radar** — the whole level in a 3px light frame: terrain silhouette, the four players, the
   four catwalks, the avalanche line, vents and breakables. The things you navigate by.
3. **CONDITION** GREEN / YELLOW / RED by distance to the avalanche, RED blinking. Beside it, four
   **lives** blocks — one per player, red when dead, dim when finished.
4. **NEXT** — the objective ("REACH THE OUTPOST", "BOMB THE WALL", "RIDE THE GUST").
5. **Readouts** — LEVEL *n*/10, TIME, COINS, SPEED, and the loadout (double-jump charge, bombs) at
   the bottom.

**Nothing in the panel is also drawn on the play field.** No corner minimap, no duplicate HUD.

---

## 8. Lifecycle

`window.GameInstance` with `init` / `start` / `pause` / `resume` / `destroy` / `getState`, per
`GAME_PROTOTYPE_INSTRUCTIONS.md` §2. Every timer through `trackTimeout` / `trackInterval`, every
listener through **one** `AbortController`, `cr-audio`'s context closed in `destroy()` — browsers
cap live contexts per page and an init/destroy cycle that never closes one eventually fails to
make another.

Attract mode (§4.8) via `RETRO.attract`, idle 20s: the sim runs itself with four bots and
`INSERT COIN` pulses in `--sig-amber`. Cheap here, because the bots already exist.

---

## 9. Deliberately not in this pass

- **Multiplayer.** Considerations written to `cliff-run/SERVER_NOTES.md`, nothing wired. No
  `MP.connect` beyond identity, no message types, no host election.
- **Firebase.** `leaderboard.js` is loaded and `LB.submit` is called at run end, which is the
  existing pattern and no-ops on `file://`. No new Firestore work.
- **The hub board.** `GAMES` untouched; see the header.
- **Mobile.** Desktop keyboard only, like the rest of the board since `SCOPE_PULLBACK_PLAN.md`.

## 10. Checks before this is called done

```
node scripts/check-global-collisions.js
node scripts/check-undefined-globals.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
node scripts/cliff-run-playtest.js
```

Plus the game served over `http` in the browser pane (a `file://` page renders as a static
snapshot with scripts disabled, so it cannot show that the game *runs*) and opened by double-click
once, to prove the `file://` constraint holds.
