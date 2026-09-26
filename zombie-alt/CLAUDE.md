# Zombie Alt — the evacuation train

**Built 2026-09-25/26. A SECOND HUB CARD, beside Zombie, for playtesting.** Same map, same combat,
same economy — a different **ending**: the objective chain finishes in a locomotive you fuel,
couple, start and drive out through a tunnel in the south-east corner.

The design and the architecture are **`zombie/TRAIN_RAIL_PLAN.md`**; the decisions behind it are
`zombie/DESIGN_IDEAS_2.md` §8 and `zombie/DESIGN_IDEAS.md` Part 7 (ideas 59–69).

> **This is a FORK OF `zombie/`, not a refactor of it.** Every file here began as a copy on
> 2026-09-25. That is deliberate: `main`'s Zombie has to stay exactly as it is while this is
> played, and a shared-code split would have meant touching the game the group already plays. The
> cost is real and should be stated — **a fix made in one folder is not a fix in the other.** If
> Alt is kept, the two should be reconciled rather than left to drift.

## What is different from `zombie/`, and nothing else is

| | `zombie/` | `zombie-alt/` |
|---|---|---|
| MP game id | `zombie` | **`zombie-alt`** |
| tab token key | `zombie_tab_token` | **`zombiealt_tab_token`** |
| leaderboard game | `zombie` | **`zombie-alt`** |
| opening the sluice | two plates, held together | **four levers around the map** |
| the way out | a gate at south-CENTRE, walked into | **a tunnel at the SE rail head, driven through** |
| the flood | starts when the third silo fills | **starts when the locomotive does** |
| winning | a player reaches the gate | **the train takes the tunnel above 300px/s** |
| the win card | world fades to black first | **world keeps running behind it** |
| new file | — | **`za-train.js`** |

**The game ids MUST stay different.** Rooms are namespaced by `MP.connect({game})`, and the two
build different worlds from the same seed — a mixed room would desync on the first frame.

## Load order

Identical to `zombie/`, plus **`za-train.js` immediately after `zombie-endgame.js`** (18 local
scripts; the checker reports that). It declares only, and it reads `railPaths` (level) and
`siloFill` (endgame), both of which exist by the time anything calls it.

## `za-train.js` — one degree of freedom

**A train on rails is a scalar.** Each car is `s` (arc length along one polyline) plus a velocity;
collisions are 1-D; coupling merges two bodies and sums the mass. Everything visible — the rect,
the angle, a rider's carried delta — is derived from `s`. There is no physics engine and no second
frame of reference.

Four rules hold it together, and each one is load-bearing:

1. **Nothing here touches the nav grid.** Cars are not in `walls[]` and not in either solid grid;
   the deck is walkable for players and zombies alike. So `rebuildNavGrid`, `refreshNavRegion` and
   `navDirty` are never involved, a car cannot wedge a zombie against geometry, and a car cannot
   crush a player into a wall. **Do not "fix" this by adding cars to `walls[]`:**
   `rebuildSolidIndex()` rebuilds both grids from scratch, and `markNavDirty()` costs a full
   ~17ms nav rebuild plus up to three BFS fields — every frame.
2. **Position is derived from one broadcast scalar per car** (`tw` on the world snapshot), never
   interpolated. Same discipline as `escapeGateFrac()`. It is a hard requirement, not tidiness: a
   rider adds the car's own delta to its own position, and two clients disagreeing about the car
   by a pixel would drag two players to different places.
3. **Riders are carried, not re-pathed.** One rule, shared: if your centre is on a deck you get
   that deck's delta. Players apply it **client-side to their own player only** (each client owns
   its position; the host cannot move a guest); zombies host-side.
4. **Shunting is capped at `TRAIN_SHUNT_MAX` (90px/s).** The flow field refreshes every
   `NAV_REFRESH_MS` (220ms), so a car moving further than one nav cell (20px) in that window is
   one zombies steer at where it *was*. 20/220ms ≈ 90px/s. The cap lifts only once the locomotive
   is rolling, where being outrun is the point.

### The verbs

- **Push:** stand at a car's **end** — proximity, not a keypress, the same shape as
  `updateGeneratorRestart`, so it needs no message and no prediction. Which end decides the
  direction. **ENGINEER pushes 4x harder** (`TRAIN_ENGINEER_MULT`), the settled class-gate shape:
  a *time* gate, never a capability gate, because roles are hashed from `netToken` and a lobby can
  contain no Engineer.
- **Rocket:** `trainRocketKick()` projects the blast onto the track, so a rocket fired **across**
  the rails moves nothing. It is a shot you aim, not a shot you land nearby.
- **Couple:** a car that reaches the consist merges into it, mass-weighted, and the loco takes the
  average velocity — a car slammed into a stationary train nudges it rather than vanishing into it.

### Starting, holding, running

`trainReady()` needs **three cars coupled**, **three tanks full** (the tanks *are* the silos —
no second resource) **and every rail crossing bought open**.

**STARTED IS NOT ROLLING.** Starting powers the loco up, sounds the horn, calls the flood and
begins grinding the tunnel open — and the train **holds at the platform for the whole
`ESCAPE_OPEN_MS` (90s)**. That 90 seconds is the fight, and it only works as a fight if the train
is still there to defend. An earlier version rolled immediately, sat at a shut tunnel mouth with
the throttle open, and won the instant the gate finished.

`TRAIN_RUN_ACCEL` is **520 px/s², sized to the actual run**: it is 1,369px from where the
locomotive stands to the tunnel, and `v = sqrt(2·a·d)`. At the first value (150) it arrived at
641px/s — 2.7x walking, not the ~5x the departure is for. At 520 it arrives at **1,190px/s** over
the same ground. Measured, not estimated.

## Verify

Two harnesses, both running the real page's own scripts through `scripts/zombie-headless.js`:

- **Map features, 47 seeds** — 4 levers a map, 4 cars, 2 rail doors, **no rail door narrower than
  the 120px lane**, **none underpriced** (they carry the graph-depth price, 1,600), **no barricade
  left standing on the running line**, no boundary window trimmed under the 78px nav guarantee,
  every sector still connected, `escapeRect` at the SE rail head (x 4570, was 2310), THE YARD
  still ring 2.
- **The train simulation** — friction stops a rolling car; the shunt cap holds; a rocket out of
  range does nothing and one along the rails shunts; all three cars couple by shunting; the
  consist is ordered nose-to-tail; an unfuelled loco will not start; **a loco with a shut crossing
  ahead of it will not start**; buying the crossings makes it ready; starting it opens the tunnel
  and calls the flood; it **holds** while the tunnel is shut; it reaches the mouth at 1,190px/s.

Plus the repo's own: `check-global-collisions` (18 local scripts, OK), `check-undefined-globals`
(clean — it caught two real ones here, `COLOR_WEAPON` and a `k`/`pk` scope slip).

## Five bugs found by actually playing it, and what each one teaches

1. **The objective line and the NEXT strip contradicted each other on screen** — one read "THROW
   THE SLUICE LEVERS", the other "START THE GENERATOR", two true statements about the same chain.
   `endgameObjective()` now waits for the generator. *Two renderings of one state will disagree
   unless one of them is derived from the other.*
2. **A 33px rail door.** The first version made each piece `carveOpening` cut into its own door;
   where the lane crossed an opening that already existed, only 33px of the 120px lane was still
   wall. It also kept the placeholder cost of 900, because `priceDoors()` walks `zonePassages` and
   a hand-pushed door is not in it. **The door MOVES now** — it is already priced, already
   registered, and full lane width by construction.
3. **A relative shift is the wrong tool for an absolute requirement.** Windows overlapping the
   lane were nudged by a fixed amount and 4 seeds in 12 were still on it by 15px; a later version
   moved one east and the world clamp put it straight back. Now: trim to the lane edge, and if
   that leaves a stub, try **both** sides and check the result. *Never trust a clamp to preserve an
   invariant it does not know about.*
4. **`onTrain` was cleared on any frame the train stood still**, because "am I aboard" and "did it
   move" were one question. The flag is what grants the grace to stay on a car already over
   `TRAIN_BOARD_MAX`, so a player standing on a stationary locomotive was treated as boarding
   afresh the moment it pulled away — and left on the ballast.
5. **A rider on a moving deck cannot be re-tested for overlap.** At 1,300px/s the deck moves 21px
   a frame; one frame of `updatePlayers` clamping you to the world edge and you are off it
   forever. Measured 465px of lag over a run, and 1,289px after the win. The rider is **parented**
   to their car above `TRAIN_BOARD_MAX` and once `won`. 465px → **46px**.

## Known gaps

- **It is a fork.** See the note at the top. Every gap in `zombie/CLAUDE.md` is a gap here too.
- **Nobody has played this with two people yet.** Everything above is solo plus headless
  simulation. The lever set in a *team* (one per player, all within `SWITCH_WINDOW_MS` = 4.5s,
  capped at 4) has never been through a real room, and the latency window is the number most
  likely to need tuning by feel.
- **The rider ends the run ~480px behind the locomotive on screen.** They are parented and moving
  with it; the offset is from the frames before the parent took hold. Cosmetic, on the win card.
- **The win does not require anyone aboard.** If the team is scattered when the train leaves, it
  still counts as a win. A "TRAIN LOST" state is the obvious next thing and is deliberately not
  built — a new fail state on a first playtest is a bad trade.
- **The Kennels' sidings still go nowhere.** 3.0 sidings a map, 0 of them joined to the line
  (measured). A rail *graph* with junctions is `TRAIN_RAIL_PLAN.md` T1 and belongs with authored
  geometry. The train lives on the through line.
- `spurLanes` was never cleared on regenerate — fixed here, still present in `zombie/`.

<!-- doc-sync: 637fb7f0 | 2026-09-26 -->
