# Glass City Escape — file-by-file

Building-hopping race across a seeded city. Split into classic-script files 2026-09-04; before
that it was one 1,178-line inline block. **This game had no per-game doc until now** — the repo's
own audit found per-game docs to be its most reliable artifacts, and this was the gap.

## Load order (matters)

Classic `<script>` tags, no modules — the `file://` hard constraint. **All files share one global
scope**, so every top-level name across them must be unique. Run
`node scripts/check-global-collisions.js` from the repo root after any change here; it reports
`glass-city-escape\glass_city_escape.html (14 local scripts)` — was 12 before the dev-tools pass
added `../shared/devtools.js` and `gc-dev.js` (2026-09-07).

| # | File | Owns |
|---|---|---|
| 1 | `../shared/identity.js` | `IDENTITY` — name→colour fallback. **Must precede mp-core** |
| 2 | `../shared/mp-core.js` | `MP` — transport, room seed, identity |
| 3 | `../shared/retro.js` | `RETRO` — **no longer used for drawing**; vertex bloom went with the RASTER reassignment (§4.3 is a vector artifact). Kept loaded so `RETRO` stays available |
| 4 | `../shared/leaderboard.js` | `LB` — score submission |
| 4a | `../shared/devtools.js` | `DEVTOOLS` — the L+G dev panel. **Must precede this game's files**: its keydown listener has to be attached before `setupKeyboardControls()`'s so a combo press can be stopped from also walking the player |
| 5 | `gc-core.js` | One-shot audio, config/globals, `INK`, `showMessage`, **points**, leaderboard submit |
| 6 | `gc-audio.js` | **The sustained voices** — drone, vertical warning, pursuit loop, laser sight. Uses gc-core's `audioCtx` |
| 7 | `gc-telemetry.js` | **The run log** — localStorage aggregates and `gcLogSummaryLines()`. It no longer draws a panel; see below |
| 8 | `gc-net.js` | Ghosts, seed, race finish. **Declares only** |
| 9 | `gc-entities.js` | Player, Robot Surveyor, laser bolts, **raster sprite/core/pedestal/shard drawing** |
| 10 | `gc-world.js` | World generation, **the arena + level curve**, the stepwell, **cores/pedestals/blips/drones**, the pursuit field |
| 11 | `gc-render.js` | Input, top-down rendering, **the minimap** |
| 12 | `gc-boot.js` | `initGame`, **the `MP.connect()` call**, `window.startGame` — the only file that executes anything |
| 13 | `gc-dev.js` | Dev-panel registration, and `gcDevGod`, which `gc-entities.js` reads at its three damage sites. **Last** |

**`MP.connect()` lives in `gc-boot.js`, not in `gc-net.js` where its handlers are.** It runs at
load and its `onReady` can fire synchronously on the solo/`file://` path, reaching
`rebuildWorldFromSeed()` and `gameRunning` in other files. Running it after every declaration
removes the ordering hazard rather than reasoning about whether it happens to hold.

## The tile types ARE the collision model

Do not restyle these without checking what each one means:

| Tile | Rule |
|---|---|
| `wall` | solid — blocks player and robots |
| `floor` | walkable interior |
| `exterior` | walkable at `z = 0` (the street). **Above ground it is a fatal drop** |
| `stair_up` / `stair_down` | walkable, changes floor |
| `stepwell` | walkable at `z = 0`, carries its terrace `ring` — the plaza |
| `escape_tunnel` | the goal, at the bottom of the well |

Wall tiles also carry `broken` and `boundary`. **`broken` makes a pane a hole in every sense** —
walkable, transparent to sight and to the drawn cone, pathable by drones, and passable by bolts —
via the single `solidWall()` predicate in `gc-core.js`. Panes break when dashed through (any floor)
or landed in. `boundary` marks the arena ring, which is unbreakable and drawn heavier.

**Measured 2026-09-04:** above ground the gaps between roofs are `null`, **not** `exterior` —
level 1 counts 26,221 nulls and zero exterior tiles. `render()` skips null tiles, so the drop is
already pure black. The fall test in `gc-entities.js` nonetheless treats `!tile` **and**
`exterior` as the same fatal condition, so the renderer's `tileZ === 0` guard on `exterior` is
kept as a defensive measure: anything that ever starts emitting `exterior` above ground must not
have it drawn as walkable ground.

## The Hunt pass (2026-09-05) — what the game now IS

Plan and the full loop critique: `GCE_HUNT_PASS_PLAN.md`. The short version of what changed and
why it hangs together:

**The city is a lattice, not a scatter.** `MAP_BLOCKS` / `BLOCK_SIZE` / `BLVD_SIZE` are **gone**;
`TOTAL_CELLS` is a flat `58` (10.4 % of the old 180 × 180 area). `layOutCity()` packs column
widths across `x` and row depths down `y`, each separated by `ALLEY_MIN..ALLEY_MAX` = **3-4
cells**, and puts a building on every intersection.

> **It has to be a lattice, and this was learned the hard way.** The first version rolled each
> column's rows independently, for raggedness. Measured, straight runs reached **16 cells at
> stage 1 and 25 at stage 2** — where one column's alley lined up with a neighbour's building, a
> line across the map crossed alley + whole column + alley. Every building still *had* a
> neighbour 3-4 away, so the rule held by the letter while the map stayed full of gaps a 10-cell
> dash cannot clear. Shared row bands are what make the rule mean what it was for. Variety comes
> from column widths (6-10), row depths (6-10) and heights (2-5) — none of which touch the gaps.

**The dash is a launch.** `DASH_CELLS` 10, at a fixed vector set on the press; input is ignored
mid-dash. Above ground it **suspends the fall test**, so crossing an alley is what it is for. It
ends on the timer, on a wall at `z = 0`, or on landing — and "landing" needs the
`dashLeftBuilding` latch, because you *start* on solid ground, so the condition is "was over the
void, now over solid", never "is over solid". Running out of dash over open air still drops you;
a jump you cannot miss is not a jump.

**Surveyors acquire, paint, fire, pursue, and forget.** The cone acquires; after that only *line
of sight* keeps the hunt alive, and it survives `HUNT_FORGET_MS` (5 s) of being broken.

> **A gap between roofs does not break sight.** `checkLOS()` stops only on `wall` tiles and the
> void between roofs is `null` — so dashing to a **same-height** roof leaves you painted and
> starts a bot down the stairs after you, while dashing to a **different** height breaks sight at
> once and starts the five seconds. That asymmetry is what gives the rule teeth; without it the
> forget rule would be unreachable and the stair pursuit pointless.

**One BFS, not fifty paths.** `rebuildPursuitField()` in `gc-world.js` floods outward from the
player across all six floors into a flat `Int32Array`; a hunter reads the steepest-descent
neighbour of its own cell. Vertical links work because `buildGlassCube()` writes the matching
`stair_down` at exactly `prevUpStair`, so a `stair_up` at `(z, x, y)` always partners `(z+1, x,
y)`. Stair edges cost 3, not 1, so the flood prefers a same-floor route where one exists.

> **The non-uniform cost in a FIFO queue is not shortest-path, and does not need to be.** The only
> property the follower relies on is that every reached cell has a neighbour with a *strictly*
> smaller value — true by construction, since each cell is written as `parent + cost` with
> `cost > 0` and its parent is a neighbour. Steepest descent therefore always terminates at the
> player. Measured: 2.2 ms per flood, 1.4 ms per frame with all 94 entities hunting.

**Hunters take stairs only when the field says to** (`step.changesFloor`); the generic stair block
is `patrol`-only. A hunter running both would be flipped a floor by any stairwell its route
crossed, which is how a pursuit becomes a bot bouncing up one staircase forever.

**Contact damage is rate-limited to once per 500 ms.** It was 5 HP on *every frame* of overlap —
four frames emptied the whole bar with no tell. The laser is the primary damage channel now
because a laser can be dodged: `LASER_SPEED` 3.6 px/frame against a 6.0 px/frame walk, after
`LASER_LOCK_MS` (600 ms) of visible warning.

**Two bugs fixed on the way, both of which the smaller map would have made worse:**

- **`spawnCollectibles()` could hang the tab.** It retried random `(z, x, y)` inside
  `while (!placed)` with no budget, over `z ∈ 0..4` — but buildings are 2-5 storeys, so `z = 4`
  exists *only* in a height-5 building. With ~16 buildings instead of ~45 there is a real chance
  none is that tall, and then it spins forever. Now it enumerates candidates once and chooses
  from them: it cannot ask for a floor that does not exist.
- **`spawnGroundRobots()` silently under-delivered.** It rolled a cell and *skipped* when the tile
  was not `exterior`, so the nominal count was never the real one. Now it retries against a
  bounded budget.

**Rendering fixes made in passing:** the player's and robot's shadows ran
`ctx.setTransform(1,0,0,1,0,0)` before translating, discarding the camera transform — so they drew
at *screen* coordinates using *world* values and were simply never on screen at 7,200 px. And the
sight reticle is drawn by `drawSightReticle()` **after** `player.draw()`; as a dot inside
`Robot.draw()` it landed underneath the player sprite, which is the one place the mark saying
"you are being aimed at" must not be.

**Vision was rebalanced and this was a judgement call, not a request:** `250 + stage*15` covered
3.5 % of the old map's width and would cover 11 % of this one, which at 3× density leaves no tile
outside a cone. It is `210 + stage*8`.

## The Broken Glass pass (2026-09-07)

Plan: `GCE_GLASS_PASS_PLAN.md`.

### A broken pane is a hole, in every sense

`solidWall(tile)` in `gc-core.js` is the single predicate for "does this wall still stop things",
and **six consumers** share it: the player's and the robot's collision, `checkLOS`, `castRay` (the
drawn cone), `botWalkable` (the pursuit field), and the laser bolts.

> They are written down together **because the last time two of them disagreed about what "opaque"
> meant, the drawn vision cone spent a whole pass telling the player something `checkLOS` did not
> enforce.** Anything less than all six would give a hole you can see through but not walk into, or
> walk into but not see through — and either reads as a bug.

Glass breaks on **two** events: **dashed through** (at any floor now, including `z = 0`) and
**landed in**. Breaking drops that floor's minimap cache and the pursuit field, so drones route and
sight through the new hole immediately rather than up to 200 ms later.

**Ordering, which is the whole thing for the ground-level case:** at `z = 0` the break must happen
*before* the collision test. Above ground it never mattered, because walls do not block the player
up there — but at ground level the dash would stop at the pane, `blocked` would be true, `endDash()`
would return, and the break line would never run.

### The stuck bug

> *"when dashing onto other rooftop, you can fall inside wall of floor below and get stuck"*

`land()` is called with a hardcoded `0`, so a fall drops the player to ground level **wherever they
happen to be** — which can be inside a building's ground-floor wall cell. At `z = 0` a wall blocks,
and a 6 px step never leaves the 40 px cell you are standing in, so **every direction is blocked
forever**. The only way out was a reload. It is reached exactly as reported: dash at a roof that
turns out to be shorter than the one you launched from.

Two answers, because one is not enough:

1. **break the pane you landed in** — the user's own fix, and the reason ground-floor glass is
   breakable at all;
2. **`shoveOutOfWall()`** if it cannot break — the arena boundary ring is deliberately unbreakable
   (a hole in it would read as a way out of the level), and a dash over the edge at height drops
   straight into it. Searches outward in rings rather than picking a direction, because the player
   can land in a corner where three of four neighbours are also wall.

(2) is the belt to (1)'s braces: **a fall that ends inside geometry must never trap the player,
whatever route got them there.**

### The Stalker — a third kind, from stage 6

| | melee | lancer | **stalker** |
|---|---|---|---|
| forget | 5 s | 5 s | **15 s** (`forgetMs`, per drone) |
| chase | 1.0× | 1.0× | **1.25×** |
| shoots | no | yes | no |
| colour | red | `#2F6BFF` | `#4CFF9E` |
| shape | square | square + barrel + ring | **triangle + wake** |

`HUNT_FORGET_MS` is now only the *default*; the rule reads `this.forgetMs`.

> **Ordering hazard:** `assignDroneKind()` runs *after* `applyStageDifficulty()` at both spawn
> sites, and the 1.25× multiplies the already-stage-scaled `chaseSpeed`. Reverse them and the
> multiplier is silently overwritten. The Stalker's share is taken out of the **melee** population,
> so its arrival does not quietly halve the number of things that shoot.

Same colour caveat as the Lancer, same answer: the identity palette contains greens, so the read is
**shape first** — a forward-pointing wedge against everything else's square.

### `(WELL OPEN)` replaces the dialogue box

`openEscapeTunnel()` no longer raises a modal. `drawWellIndicator()` shows **`(WELL OPEN)`** with an
**arrow on the bearing to the well** and a distance in cells, under the minimap, for as long as it
is open — it is the objective for the back half of a level, not a four-second announcement. It
fades out within two cells of the well, where it would be describing what you are standing on.

**It disappears before the next level by construction, not by timing:** it draws only while
`escapeTunnelOpen`, and `spawnCores()` clears that inside the *synchronous* rebuild, so the gate is
already down on the first frame of the new level. This also removed the last raw `setTimeout` on
the level path.

**Measured at stage 9** (24 drones, three kinds): **2.14 ms/frame at 551×837, 5.86 ms at 1280×720**
— it scales with pixel count, not with this pass. The earlier 2.03 ms figure was taken on the
smaller canvas.

## The Robotron wave transition (2026-09-06)

**There is no message box, no timer and no pause between levels.** `triggerNextStage()` banks the
bonus, increments the level and **rebuilds the whole world synchronously on that frame** (measured
12.7 ms), then arms a colour-cycled rectangle burst that is drawn over the level you are *already
standing in*. The 2-second `setTimeout` and the modal are gone.

| | |
|---|---|
| `WAVE_TRANSITION_MS` | 780 — the burst |
| `WAVE_GRACE_MS` | 520 — how long **drones** are held |
| player | **live from frame one**, never held |

> **The grace is deliberately shorter than the burst, and applies only to drones.** Robotron
> freezes everything for its wave change; freezing the player here would be the same rest wearing a
> better costume, which is the thing being removed. Holding the *drones* is a spawn grace —
> materialising into a new arena with hunters already converging is not an opening, it is an ambush.
> Verified per frame: 31 consecutive frames with no drone moving, first movement at 517 ms against
> a 520 ms constant.

**The colours are the Signal Three plus `--phos-hot`, not an arcade rainbow.** Robotron cycled its
full hardware palette; `AESTHETIC_GUIDE.md` §2.2 gives cyan/amber/magenta fixed meanings that this
game obeys everywhere else, so a rainbow would spend the palette's meaning on a decoration. Four
tokens cycling at ~20 Hz carry the same energy for nothing, because a burst covering the whole
screen for 780 ms cannot be mistaken for a hazard, a pickup or a goal.

**Two layout bugs found by looking at it rather than by reasoning:**

- The title was a fixed `44px` of the display face, chosen against a full-width window. On a
  410 px-wide canvas "LEVEL 2" ran past both edges. It is sized from `canvas.width` and clamped.
- Both lines were first stacked just above centre, and the bonus landed **square on the player** —
  the camera pins the player to the exact centre of the screen every frame, so anything drawn near
  `cy` is drawn on top of them. Title above, bonus below, player in the gap.

`keys = {}` on transition: a held direction would otherwise carry across and walk the new spawn
into whatever is beside it.

## The Raster pass (2026-09-06) — the loop, the look, and the level curve

Plan: `GCE_RASTER_PASS_PLAN.md`. **The biggest change since the game was written.** The previous
passes changed how the city was built and how it hurt you; this one changed *what you are doing in
it*, *how it looks*, and *how a run starts*.

### Fetch-and-deposit, not collect-and-leave

Cores are **carried one at a time** to **pedestals ringing the stepwell**; the exit opens on the
last *pedestal filled*, never on the last core *picked up*. Carry capacity of one is the whole
loop — each core is a round trip you have to survive, and you cannot bank four and walk home once.
A carried core orbits the player so the state is never a HUD question.

The old gold cubes became **blips**: points, no objective weight. Score = `PTS_CORE` 250 +
`PTS_BLIP` 25 + `PTS_LEVEL` 500 + `PTS_PER_HEART` 100 **banked only at the exit**, so running a
level out at 1 HP is worth measurably less than clearing it carefully.

> **The leaderboard now posts points, not the stage reached.** The 2026-09-04 reasoning still
> holds on the constraint — `leaderboard.html` does `orderBy("score","desc")` and can only express
> "higher is better" — and points satisfy it just as well while still encoding depth. What changed
> is that there is finally something worth measuring *inside* a level.

### The level curve

| Stage | Buildings | Drones | Cores = pedestals | Arena |
|---|---|---|---|---|
| 1 | 0 (flat) | 1 | 1 | 29×29 |
| 2 | 0 (flat) | 3 | 2 | 33×33 |
| 3 | 1 | 6 | 3 (one up on the roof) | 37×37 |
| n | `n−2` | `3(n−1)` | `n`, capped 8 | `+2` per stage, capped 55×55 |

The arena is bounded by a **wall ring**, not an invisible clamp: a 58-cell map holding one drone
and one core is a hike, and walking into nothing and stopping reads as the game being broken.

> **The chosen lots must be CONTIGUOUS, and this was measured, not assumed.** The first version
> took the first N of a seeded-shuffled lot list. The lattice guarantees 3-4 cells between
> *adjacent* lots — but when only 2 of 16 are built, the two chosen are not adjacent, and the
> measured gap ran to **39 cells against a dash that reaches 10**. The alley rule held for the
> lattice and meant nothing for the city actually built from it. The set is now *grown*: one seeded
> lot, then repeatedly a lot orthogonally beside the cluster. This is the second time this exact
> class of bug has appeared here — see the ragged-columns note above — and both times only
> measuring every gap on the generated map caught it.

Also: `want <= 0` must be tested **before** the seed lot is picked. Seeding first and checking
after built one building on the flat tutorial levels, which is the one thing they must not have.

### RASTER cabinet — a documented reassignment

`AESTHETIC_GUIDE.md` §6.8 assigned this game to **VECTOR**, and §4.6 makes scanlines raster-only —
the body carried `data-cabinet="vector"` precisely to keep them off. It is now
`data-cabinet="raster"` with a `#screen` wrapper and `.retro-scanlines`, the RD Arena pattern.

> §1 says the assignment is mechanical — *"what does the game already draw?"* — and the honest
> answer changed underneath the original call. This is a tile grid drawing chunky filled cells,
> blocky sprites and a fixed HUD. **Vertex bloom went with the reassignment:** §4.3 is a
> vector-hardware artifact, and keeping it here would be the same category error as scanlines on a
> vector cabinet. Everything snaps to `RASTER_GRID` via `rsnap()` — not decoration: the scanline
> overlay is a 1px-on/2px-off gradient, and an unsnapped sprite beats against it and shimmers.

### Glass is a face, not a block

A wall cell still blocks. What changed is that it draws a **pane on each outward face** — the ones
whose neighbour is void, street or plaza — instead of filling itself. `wallFaceOpen()` is the test,
so two walls side by side draw nothing between them and a ring of cells becomes one continuous
sheet.

> **This retires the deviation `GCE_PASS_PLAN.md` recorded on 2026-09-04.** §6.8 asked for
> "unfilled wireframe boxes" and it was refused, because an outline around empty space reads as a
> room you can walk into. It reads correctly *now*, because the space inside the outline **is** a
> room you can walk into — the floor branch fills it. The objection was right when the interior was
> black and is wrong now that it is not.

**A dash across a gap at height shatters the panes it passes through**, at the building launched
from and the one landed on, with shards. `broken` is per tile and lasts the level. The arena
boundary is exempt — a hole in it would read as an exit.

### The cone stops lying

Vision cones were a filled arc that ignored geometry, so a drone appeared to see through its own
building. `castRay()` now marches `CONE_RAYS` rays and stops each on the same rule `checkLOS()`
uses. It returns **`d - step`, not `d`**: the march samples every third of a cell, so `d` is up to
13 px *inside* the wall, and the drawn cone would poke through a pane — which matters now that a
wall is a thin line with the room behind it visible. Only drones on the player's floor and inside
the viewport are raycast; the rest keep the cheap arc.

### Health and feedback

`MAX_HEALTH` 9 (one row of pixel hearts on their own canvas), `FALL_DAMAGE` a flat 3 at any height.
Regen draws a **filling ring** while it charges, chimes and flashes the restored heart; below
`LOW_HEALTH_AT` a heartbeat quickens as the bar empties.

> **Melee stays at 4, which is now 44% of the bar** rather than 20%. Three melee hits kill, three
> falls kill, nine beams kill. That follows from the two numbers the user set and is flagged rather
> than silently rebalanced — the run log should settle it.

### The bug the points system exposed

`triggerNextStage()` shows a message and rebuilds the world on a 2-second `setTimeout`. The player
is still standing on the tunnel tile for all of it, and `escapeTunnelOpen` is still true, so
`Player.update()` called it again **every frame** — measured: **level 1 → level 4 on one descent,
survival bonus paid three times.** `stageAdvancing` latches it. **Pre-existing, not introduced by
the points**; the points only made it visible, because a stage counter jumping by three looks like
a fast animation and a score jumping by 4,200 does not.

### Removed, not left dangling

`CITY_MARGIN`, `SPAWN_CELL` (both described a fixed margin on a fixed-size map — the arena is a
function of the stage now), and `playFallSound` / `playCollectSound` / `playEscapeSound` (superseded
by `gcFallSound` / `gcCoreFoundSound` / `gcExitOpenSound`). Same rule as `MAP_BLOCKS`: a constant
nothing reads is a constant that will be read again by mistake, and a dead one-shot beside a live
one with a similar name is how the wrong sound gets wired back in.

**Measured at stage 10** (27 drones, 8 buildings, 20 raycast cones on screen, everything hunting):
**2.03 ms/frame**, against a 16.7 ms budget.

## The Stepwell pass (2026-09-06) — combat became legible

Plan: `GCE_STEPWELL_PASS_PLAN.md`. The through-line: **the Hunt pass made the city dangerous,
this one makes the danger legible.** Nothing damages the player any more without first showing and
sounding an intent they had time to answer.

| Threat | Telegraph | Then |
|---|---|---|
| spotted | `SPOT_TELEGRAPH_MS` (2 s) — drone **frozen**, expanding ring, rising `!`, two-note sting | commits to `hunt` |
| melee | `MELEE_WINDUP_MS` (350 ms) swelling arc | `MELEE_DAMAGE` = 4 hearts, then a 2 s cooldown |
| beam | `LASER_LOCK_MS` (600 ms) dashed sight | 1 heart + `LASER_KNOCKBACK` (28 px) |

**Contact damage is GONE, not reduced.** Even rate-limited to 500 ms it was still "damage for
occupying the same pixels", landed under the drone's own sprite where the player could not see it
happen. Standing inside a drone now does nothing at all; only a committed swing hurts.

**`alert` is a third state, and it commits either way.** Breaking line of sight during the two
seconds does not cancel the hunt — it saw you — but the `HUNT_FORGET_MS` clock is already running
from the last frame it had sight, so the escape starts from there.

**Only blue Lancers shoot** (`kind === 'lancer'`, `LANCER_SHARE` = 0.22, assigned off the *seeded*
stream so every racer faces the same mix). Everything else — cone, telegraph, stair pursuit, melee
— is common to both kinds.

> **The blue is a recorded risk against `AESTHETIC_GUIDE.md` §2.3.** Blue is not a signal colour,
> but the identity palette holds two blues, so a blue enemy can read as a rival's ghost. Mitigated
> by **shape first**: a Lancer has a barrel stub and a rotating dashed sight ring that nothing else
> in the game has, plus hard corners against everything else's rounded ones. Its trim also stays
> blue while hunting rather than going magenta — if it turned magenta on engaging, the one thing
> the colour carries ("this is the one that shoots") would vanish exactly when it starts mattering.
> Whenever a new colour has to live near the identity palette, shape carries the meaning.

**The reticle and the sight tone are Lancer-only.** Melee drones hold sight too — it is what keeps
their hunt alive — but a marker meaning "something has a shot lined up on you" over a drone that
cannot shoot would make the one marker that should mean *move now* mean nothing.

### The stepwell

A 13 × 13 plaza reserved at the map centre *before* `layOutCity()` runs; any lattice lot that would
intersect it is skipped. Filled by `carveStepwell()` with a `stepwell` tile carrying its Chebyshev
`ring`, rendered as concentric terraces descending to the escape tunnel.

**It deliberately breaks the 3-4 cell alley rule**, and the numbers are worth knowing: the skipped
lots leave clearings of **up to ~29 cells** around the well — bigger than the plan's original
"6+ cells back" guess. Measured across stages 1-5, **every** gap over `ALLEY_MAX` is beside the
plaza and **zero** are anywhere else, so the lattice rule still holds everywhere the lattice
exists. The consequence is intended: you cannot roof-hop to the centre, you come down to it.

**The terrace lips are the whole trick.** Stroking whole tiles drew a grid, and a grid reads as
flat ground. Only each ring's **outward-facing** edges are stroked — the edge where that terrace
drops away — which produces clean concentric squares, which is what a baoli looks like from
directly above. The tile knows its ring, so which edges face out is a sign test with no neighbour
lookups. A soft radial `drawWellGlow()` stands over it on **every floor**, so the well is a
landmark from a rooftop three storeys up, not just something you find at the end.

### Hearing what is on the floor above

The failure this fixes: you climb a stairwell into a room you had no way to hear, and die to
something that was always standing there. The old mix scanned `e.z === player.z` **only**, so a
drone one floor up was not merely quiet — it was silent.

Every drone on every floor is now scanned at an **effective** distance:

```
effective = hypot(dx, dy) * (1 + VERT_PENALTY * |dz|)      // VERT_PENALTY = 0.85
```

One floor of separation reads as ~1.85× the map distance: present, quieter, never absent. A second
sustained voice (`gcVerticalVoice`) carries the specific warning — a **pulsing square**, not the
drone's saw, responding only to drones on `z ± 1` within `VERT_ALERT_RANGE` in x/y. A steady tone
would blend into the hum; a rhythm that quickens is read as approach. The minimap draws the same
fact: current floor solid, `z ± 1` **hollow**. Two channels for one fact, because the fact is "you
are about to die for a reason you cannot see".

### The run log

`gc-telemetry.js`, opened with **`L`+`G`** (which **pauses** the sim — reading a difficulty report
while the city hunts you would corrupt the run the report is about). **Aggregates per run, never an
event stream**: a five-minute run is ~18,000 frames and the output has to be small enough to paste
into a chat. Capped at `TELEMETRY_MAX_RUNS`, written once per run at the `showMessage(...,
isGameOver = true)` choke point, and `gcRun = null` afterwards so a bolt and a fall landing on the
same frame cannot record the run twice. `gcTelemetryClear()` wipes it.

**It stopped drawing its own panel on 2026-09-07.** It used to own a `#log-panel` overlay opened
with a bare `L`, built by `gcShowLog()`/`gcHideLog()`/`gcCopyLog()` with markup and CSS in
`glass_city_escape.html`. All of that is gone. The numbers are not: the run log is now one section
of the shared `L`+`G` dev panel (`shared/devtools.js`, registered by `gc-dev.js`), which shows the
same summary, carries the same copyable payload — `gcDumpLog()` is unchanged and still the console
entry point — and adds the playtest buttons. What is left in `gc-telemetry.js` is the part that was
actually about telemetry: `gcLogSummaryLines()`, which decides which numbers are worth a line.

`gcLogOpen` **kept its name**, and `gameLoop`'s pause branch still reads it. Only who sets it
changed (the panel's `onOpen`/`onClose`), and the meaning did not: something modal is up, do not
advance the world.

**God mode costs three lines in `gc-entities.js`.** This game has no central damage function — the
fall, melee and beam sites each subtract from `player.health` and check for death inline — so
`gcDevGod` guards all three. Each guard skips the **telemetry as well as the damage**, on purpose:
a run log that counts hits you were immune to lies about the difficulty curve, which is the one
thing it exists to measure.

> **Anything driving this game from a console must stub `performance.now()`.** Every telegraph,
> cooldown and forget rule is keyed to wall-clock ms, so a hand-driven frame loop — which runs
> ~100× faster than real time — leaves them frozen: drones enter `alert` and never commit, and
> nothing ever attacks. Measured with a virtual clock instead: standing still in the open is dead
> in **7 s**; moving survives 40 s at 5/20; moving and dashing survives at 20/20.

## Aesthetic — VECTOR cabinet, anchor *Battlezone* (2026-09-04)

`AESTHETIC_GUIDE.md` §6.8. Plan: `GCE_PASS_PLAN.md`.

| Tile | Before | Now |
|---|---|---|
| `wall` | filled light blue | `--sig-cyan` outline + faint tint + **vertex bloom on all four corners** |
| `floor` | filled white | black with a `--phos-dim` grid |
| `exterior` | filled `#555` | `--phos-dim` grid at ground level, nothing above |
| stairs | white, grey bands | `--phos-mid` frame, `--phos-hot` arrow |
| `escape_tunnel` | pulsing green | pulsing `--sig-cyan` (§6.8: "goals go `--sig-cyan`") |

**Two deliberate deviations from §6.8, both recorded rather than silent:**

1. **Walls are not "unfilled".** The spec says *"buildings → unfilled wireframe boxes"*. In a
   top-down view an unfilled box is an outline around empty space, which reads as a room you can
   walk into — when a wall is the one thing you cannot. Walls therefore get the wireframe **and**
   a faint interior tint. Battlezone line-work, still unmistakably solid.
2. **No horizon line.** The spec asks for one. This renderer is *"Pure Top-Down"* — there is no
   vanishing point to put a horizon on. Skipped.

Stairs are deliberately **not** cyan: cyan is the goal colour here, and stairs and the escape
tunnel must not read as the same thing.

`INK` in `gc-core.js` holds the tokens for canvas use, populated once by `loadInkFromCss()` from
`gc-boot.js`. The canvas cannot read CSS custom properties, so this is how `shared/retro.css`
stays the single source of truth; the literals in `INK` are only the fallback for a stylesheet
that failed to load.

**Ghosts already used the identity palette** before this pass — `broadcastPosition()` sends
`c: MP.selfColor`. §6.8 asked for it; it was already true.

## Audio — one context, one-shots in gc-core, sustained voices in gc-audio

`gc-core.js` keeps the original `audioCtx` and its one-shot jingles. `gc-audio.js` adds the five
sounds the Hunt pass asked for, four of them continuous: a footstep per half-cycle of `legPhase`,
a dash whoosh, a **proximity drone** whose gain *and* lowpass cutoff track the nearest same-floor
Surveyor, a **pursuit arpeggio** that runs while anything is hunting, and a **sight tone** gated on
any active lock. `M` mutes.

**Why not `shared/sfx.js`.** `SFX` is a one-shot vocabulary — `tone()` builds an oscillator,
schedules a hard envelope, stops it. There is no primitive for a voice that stays up and is
modulated per frame. Loading it anyway would put a **second `AudioContext`** on the page next to
the one `initAudio()` already creates, and browsers cap live contexts per page. `gcVoice()` in
`gc-audio.js` is the shape to lift into `shared/` if a sustained-voice primitive is ever wanted
repo-wide.

**No JS timers in it.** The pursuit loop is scheduled a bar ahead against `audioCtx.currentTime`
and pumped from `gameLoop()` — the audio clock is not a JS timer, needs no tracking, and is
sample-accurate rather than subject to frame jitter. Same reasoning `shared/sfx.js` records for
itself.

`gcAudioSilence()` is called from `showMessage(..., isGameOver = true)`. `gameLoop()` is what pumps
the sustained voices and it returns the instant `gameRunning` goes false, so without that call the
drone would hang at its last level forever under the game-over box.

## Leaderboard — the score is the STAGE REACHED

Posted from `showMessage(..., isGameOver = true)`, which is the single choke point where a run
ends: it is what sets `gameRunning = false`, and it is reached by both deaths (a fall, a
Surveyor) and by finishing a race. `gcPostedStage` guards it so a long run posts once per new
best rather than once per stage.

**Why not the race time.** `leaderboard.html` does `orderBy("score", "desc")` and keeps each
player's maximum, so it can only express "higher is better" — a finish time in ms would rank the
*slowest* player first. Race placings and times already exist in-game via `standingsText()`.

**Why not solo-only**, which is what was originally planned: **mp-core's "solo" means the server
is unreachable, not "playing by yourself"**. `info.solo` is false the moment the socket opens,
even alone in a room — so a solo-only hook would almost never fire, and would fire mainly on
`file://` where `LB` cannot submit anyway.

## Two modes, and the seam between them

```js
if (racingOthers() && !raceFinished) finishRace();
else triggerNextStage();
```

> **FIXED 2026-09-07, and it was a real bug, not the "surprising behaviour" this section used to
> call it.** The test was `netOnline`, which is true **the moment the socket opens** — it means
> "the server answered", not "someone else is here". So every solo player, which is everyone
> because the server is up, took the RACE branch at the end of level 1 and got a game-over box
> with a Restart button. **Levels 2 and up were unreachable in normal play**; the entire level
> curve could only be seen by killing the server first.
>
> It was written up twice as a known oddity and deferred twice as "a loop-design change nobody
> asked for". That was the wrong call both times. It is not a design decision — it is a mode check
> asking the wrong question, and the answer is that **a race needs rivals, not a socket**.
> `racingOthers()` in `gc-net.js` asks `MP.peers()` (the server's room roster) and falls back to
> `ghosts` for the window before mp-core reports a join.
>
> The `else` is unconditional now. `else if (!netOnline)` left a silent third state where online
> **and** already finished did nothing at all.

**With rivals in the room**, reaching the escape tunnel ends the race and your placing is the
order everyone got out in. **Alone** — including alone with the server up, which is the normal
case — it is a stage gate into the endless level curve.

## Multiplayer — the lightest sync model in the repo

Everyone runs the **same seeded city** from one server seed; only positions cross the wire
(~15Hz), interpolated between updates. Nothing can desync because nothing is shared beyond the
layout. Robots start identically on every client and then diverge, which is accepted: they are
hazards, not synchronised entities.

**Level generation uses `MP.random()`, never `Math.random()`** — a stray `Math.random()` in
`gc-world.js` means two players race different cities.

<!-- doc-sync: 06580fba | 2026-09-20 -->
