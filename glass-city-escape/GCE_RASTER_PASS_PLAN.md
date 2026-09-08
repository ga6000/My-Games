# Glass City Escape — the Raster pass (2026-09-06)

Fifteen changes. Written before any edit, per root `CLAUDE.md`. Follows `GCE_STEPWELL_PASS_PLAN.md`
(same day) and supersedes its health, collectible and progression numbers.

**This is the biggest single change to the game since it was written.** The previous two passes
changed how the city was built and how it hurt you; this one changes **what you are doing in it**
(fetch-and-deposit, not collect-and-leave), **how it looks** (VECTOR → RASTER), and **how a run
starts** (a flat one-drone tutorial, not a full city).

---

## 1. The loop is now fetch-and-deposit

The single biggest change, and every other change hangs off it.

| Before | After |
|---|---|
| Walk over N glowing cubes → exit opens | Carry **cores** one at a time to **pedestals** ringing the stepwell → exit opens |
| One collectible type | **Cores** (the objective) and **blips** (points) |
| Score = stage reached | Score = **points**, from cores, blips, level clears and surviving hearts |

**Carry capacity is one.** That is what makes it a loop rather than a shopping list: each core is a
round trip you have to survive, and you cannot bank four of them and walk home once. A carried core
orbits the player so the state is never ambiguous.

**Pedestals ring the stepwell**, evenly spaced on the plaza lip, `PEDESTAL_COUNT = cores`. This
makes the well the hub of the whole level instead of a place you visit once at the end — it is
where you keep returning under increasing pressure, which is the beat the old loop only had once.

**Points:** `PTS_CORE` 250, `PTS_BLIP` 25, `PTS_LEVEL` 500, `PTS_PER_HEART` 100 banked at level end.

> **The leaderboard changes meaning, and this is a deliberate call.** It has posted
> `currentStage` since 2026-09-04, for the documented reason that `leaderboard.html` does
> `orderBy("score","desc")` and can only express "higher is better". Points satisfy that just as
> well *and* still encode depth (deeper levels pay more, and hearts only bank if you survive), so
> the ordering argument is untouched while the number stops throwing away everything the player
> did inside a level. Old stage-based entries stay comparable in direction, not magnitude.

## 2. The level curve — level 1 is a tutorial, not a city

The user's spec, taken literally:

| Stage | Buildings | Drones | Cores / pedestals | Notes |
|---|---|---|---|---|
| 1 | 0 (flat) | 1 | 1 | one drone, one core, one pedestal, the exit |
| 2 | 0 (flat) | 3 | 2 | |
| 3 | 1, a few storeys | 6 | 3 | cores on the ground **and one up on the building** |
| n | `n − 2`, capped | `3(n−1)` | `n`, capped 8 | |

**The arena grows with the stage.** `ARENA_HALF_BASE = 14`, `+2` per stage, capped at 27 — a 29×29
cell box at stage 1 opening to 55×55. Bounded by a **wall ring**, because a 58×58 map holding one
drone and one core is not a tutorial, it is a hike; and because with the map mostly empty the
player needs a told edge rather than an invisible clamp.

The stepwell stays 13×13 at the centre at every stage. At stage 1 that leaves an 8-cell ring of
open ground around it, which is the whole playable area — exactly the shape a first level wants.

Buildings are chosen from the same lattice as before, restricted to the arena, plaza lots excluded,
**seeded-shuffled** and the first N taken. Same lattice means the 3-4 cell alley rule and the dash
still hold the moment buildings appear.

## 3. Health: 9 hearts, flat falls

`maxHealth` 20 → **9**. Falls cost a flat `FALL_DAMAGE = 3` regardless of height (was
`floor(fallDist) * 3`). Rows of hearts are gone — nine fit one row.

> **Melee stays at 4 and that is now 44% of the bar**, up from 20%. Three melee hits kill; three
> falls kill; nine beams kill. This is a real difficulty increase that follows from the two numbers
> the user set, and it is flagged rather than silently rebalanced — the run log is what should
> settle it. Regen becomes correspondingly more valuable, which §4 is about.

## 4. Regen you can actually notice

Currently +1 HP per 60 stationary frames with no feedback of any kind — the player cannot tell
whether standing still is doing anything. Now:

- a **pulsing ring** builds around the player as the regen timer fills, so the *progress* is visible
  and not just the result;
- a rising two-note chime on each heart restored;
- the restored heart **flashes** on the bar.

Plus a **low-health heartbeat** below `LOW_HEALTH_AT = 3`, pulsing faster the lower it goes.

## 5. RASTER cabinet — a documented reassignment

`AESTHETIC_GUIDE.md` §6.8 assigns Glass City to **VECTOR** (anchor *Battlezone*) and §4.6 makes
scanlines **raster-only**. The user has asked for raster with scanlines, like RD Arena.

> **So this is a cabinet reassignment, not a rule violation, and it is recorded as one.** §1 says
> assignment is mechanical — *"what does the game already draw?"* — and the honest answer changed
> underneath the original call: this is a **tile grid**, and after this pass it draws chunky filled
> cells, blocky sprites and a fixed HUD. That is the RASTER description, not the VECTOR one. The
> guide's own test now points the other way, so the assignment follows it.

Concretely: `data-cabinet="raster"` on `<body>`, a `#screen` wrapper with `.retro-scanlines` over
the canvas (the RD Arena pattern), `image-rendering: pixelated`, everything snapped to a
`RASTER_GRID` sub-cell, `roundRect`/`arc` sprites replaced by `fillRect` blocks, and the health bar
moved onto its own canvas as pixel hearts.

**Vertex bloom goes.** §4.3 is a vector-hardware artifact; keeping it on a raster cabinet would be
the same category error as scanlines on a vector one.

## 6. Glass is a face, not a block

Walls keep their collision. What changes is what a wall *draws*: instead of filling its cell, a wall
tile draws a **glass line on each of its outward faces** — the faces whose neighbour is void,
street, or plaza.

> **This retires the deviation `GCE_PASS_PLAN.md` recorded in 2026-09-04.** §6.8 asked for
> "unfilled wireframe boxes"; that was refused because an outline around empty space reads as a
> room you can walk into. It reads correctly *now*, because the space inside the outline **is** a
> room you can walk into — it is drawn as floor. The objection was right when the interior was
> black and is wrong now that it is not.

Each wall tile carries `broken`. **A dash across a gap at height shatters the glass it passes
through**, at the building launched from and the building landed on, with shards and a break sting.
A broken face draws as a jagged gap and stays broken for the level.

## 7. Vision cones become true visibility polygons

The cone is currently a filled arc that ignores geometry, so a drone appears to see through its own
building. It becomes a **ray fan**: `CONE_RAYS` rays across the arc, each marched until it hits a
wall, filled as a polygon. That makes the drawn cone equal to what `checkLOS` actually tests, which
is the point — right now the display and the rule disagree.

Cost control: only drones **on the player's floor** and **within the viewport** get a raycast cone;
everything else keeps a cheap arc. Measured before and after.

## 8. The exit opening

When the last pedestal is filled: the trapdoor slides open over `EXIT_OPEN_MS`, light shafts out in
expanding rings, and **if the well is on screen the whole frame washes** cyan and fades. Off screen,
the wash is suppressed and only the sound plays — washing the screen for something the player cannot
see would read as a glitch.

## 9. Cores look like cores

Two counter-rotating rings with a rotating square inside, drawn in raster blocks. Blips (the old
gold cube) stay small and cheap — they are points, and they must not compete with the objective.

## 10. Sound

| Event | Sound |
|---|---|
| regen tick | rising two-note chime |
| low health | heartbeat, faster as it drops |
| core located | a full rewarding arpeggio, clearly bigger than a blip |
| blip | short blip |
| core deposited | a heavier confirming thunk + rising tail |
| fall damage | impact thud |
| glass break | noise burst |
| exit opens | ascending sweep |
| level advance | a reward jingle |

## 11. Files touched

| File | Change |
|---|---|
| `gc-core.js` | health 9, stage curve, points, pedestal/blip/glass/raster constants |
| `gc-world.js` | arena + wall ring, stage-scaled buildings, cores/pedestals/blips, glass faces |
| `gc-entities.js` | carry/deposit, flat fall damage, glass breaking, raycast cone, raster sprites |
| `gc-render.js` | raster redraw, pedestals, cores/blips, exit animation, pixel health bar, regen ring |
| `gc-audio.js` | eight new sounds |
| `gc-telemetry.js` | points, cores deposited, blips |
| `gc-boot.js` | health canvas, run start |
| `glass_city_escape.html` | `#screen` wrapper, scanlines, `data-cabinet="raster"`, HUD |

## 12. Verification

Three checkers, the headless harness extended (stage curve exact for 1/2/3, pedestal count equals
core count, exit refuses to open until all are filled, carry capacity of one, flat fall damage,
9-heart cap, glass breaks on a roof dash, raycast cone never crosses a wall, points arithmetic),
then a real browser. **Any console-driven test must stub `performance.now()`** — see
`CLAUDE.md`.
