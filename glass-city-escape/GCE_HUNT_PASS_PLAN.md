# Glass City Escape — the Hunt pass (2026-09-05)

Seven requested changes, plus the loop critique that was asked for first. Written before any
edit, per root `CLAUDE.md` ("for anything nontrivial, write the plan to a markdown file before
editing; sessions compact, saved plans don't").

Supersedes the balance numbers in `GCE_PASS_PLAN.md` (2026-09-04), which is about the split and
the VECTOR skin and remains accurate on those subjects.

---

## 0. The game loop, critiqued

The loop today is: **spawn on the street → find N glowing cubes scattered uniformly across a
7,200 × 7,200 px city and six floors → walk back to the exact centre → next stage.**

Nine things are wrong with it, roughly in order of how much they cost.

**1. The search has no route decisions in it.** `spawnCollectibles()` picks a uniformly random
`(z, x, y)` and accepts any `floor` or `exterior` tile. Cores therefore land wherever, which
means the player has no reason to prefer any direction — every choice is equally good, so no
choice is interesting. A collect-and-return loop is only a loop if the collecting has a shape.

**2. Going up is all cost and no benefit.** Rooftops are slower to reach (stairs are one tile,
placed randomly inside each building), more dangerous (the drop is instantly fatal at height),
and pay exactly the same as a core sitting in the street. The vertical dimension — the thing the
whole tile model exists for — is a tax, not an opportunity. A game called *Glass City Escape*
that is optimally played entirely at `z = 0` has lost its premise.

**3. The map is far larger than the content in it.** 180 × 180 cells at 40 px is 32,400 cells for
~45 buildings and 5 cores. Most of the play time is transit across empty street, which is where
the "this drags" feeling comes from. (Fixed by §2.)

**4. Standing still is the strongest move.** `regenTimer` gives +1 HP every 60 stationary frames
and resets the moment you touch a key. With 20 max HP, a player who is losing can always win by
walking into a corner and waiting. There is no clock, no starvation, no reason not to. This is
the single biggest structural hole and it is *not* on the change list below — flagged, not fixed.

**5. Detection means nothing.** A robot that sees you chases the *point where you stood*, and
`if (Math.hypot(dx, dy) < 10) this.state = 'patrol'` drops the chase the instant it arrives.
There is no memory, no re-acquisition, no consequence to being seen — walk round a corner and it
is over. (Fixed by §4.)

**6. Damage is untelegraphed and can kill in a third of a second.** Contact costs 5 HP *per frame
of overlap*; four overlapping frames is 20 HP, which is the whole bar. There is no wind-up, no
tell, nothing to react to. Death feels arbitrary because it is. (§4 replaces the primary damage
channel with slow, visible, dodgeable projectiles.)

**7. The dash means nothing.** 15 frames at ×2.2 speed with no cooldown and no traversal power —
you arrive at the same places slightly sooner. It has a booster animation attached to a mechanic
that does not deserve one. (Fixed by §3.)

**8. The tunnel is the only good beat, and it arrives once.** Opening it at a *known* position
(map centre) and forcing a return leg past everything you already stirred up is the one moment
with a clear goal and rising pressure. Everything before it is undirected. The design lesson is
already in the file: this game is better when the player knows where to go and something is in
the way.

**9. The two modes score incompatibly and one of them ends at stage 1.** `netOnline` tracks the
socket, not the player count, so a *lone* player with the server up gets the race path and their
run ends the first time they reach the tunnel. Documented already in `CLAUDE.md`; restated here
because "the loop" for most sessions is one stage long.

### What this pass does about it

The requested changes hit **1, 2, 3, 5, 6 and 7** — a dash that crosses gaps makes the roofs the
fast lane (2), a 10 % map removes the transit padding (3), and an AI that locks on, shoots slowly
and follows you down the stairs turns detection into a real event with a real escape (5, 6).
**4 (regen camping) and 9 (the mode seam) are deliberately left alone** — both are loop-design
changes nobody asked for, and both deserve their own decision. Recommended fixes, for later:
regen only while *moving*, or only at ground level, so the safe floor and the healing floor stop
being the same floor; and a per-stage clock so waiting costs something.

---

## 1. Constants: the city grid replaces the boulevard grid

`MAP_BLOCKS` / `BLOCK_SIZE` / `BLVD_SIZE` are **removed**, not resized. They describe a
9-superblock layout with 10-cell boulevards between blocks, and a 10-cell boulevard is a 2.5×
violation of "no more than 3-4 block distance apart at the building footprint". Keeping the names
while changing what they mean is how a constant starts lying.

| Old | New | Why |
|---|---|---|
| `MAP_BLOCKS 3`, `BLOCK_SIZE 50`, `BLVD_SIZE 10` | *(gone)* | superblocks + boulevards, incompatible with a uniform 3-4 alley |
| `TOTAL_CELLS = 180` (32,400 cells) | `TOTAL_CELLS = 58` (3,364 cells) | **10.4 % of the old area** |
| — | `CITY_MARGIN = 4` | perimeter street; also the spawn ring |
| — | `LOT_MIN 6`, `LOT_MAX 10` | building footprint range |
| — | `ALLEY_MIN 3`, `ALLEY_MAX 4` | **the user's rule, as a hard constant** |
| — | `SPAWN_CELL = 2` | replaces `BLVD_SIZE / 2` at the three spawn sites |

Three spawn sites read `BLVD_SIZE / 2` today (`gc-boot.js` `initGame`, `gc-net.js`
`rebuildWorldFromSeed`, `gc-world.js` `triggerNextStage`). All three become `SPAWN_CELL`.

## 2. World generation: ragged column/row packing

`generateBuildingsInBlock()` (rejection sampling with a `< 50` attempt budget) is replaced by
`layOutCity()`, which packs the whole map as one lot grid:

- walk `x` from `CITY_MARGIN`, take a column width `w ∈ [LOT_MIN, LOT_MAX]`, advance by
  `w + alley` where `alley ∈ [ALLEY_MIN, ALLEY_MAX]`, stop when the remainder is under `LOT_MIN`;
- **per column**, walk `y` the same way with an independently rolled depth.

Every neighbour is therefore 3 or 4 cells away *by construction* rather than by luck, which is
what makes §3's dash a reliable traversal verb rather than a gamble. Columns are ragged in `y`
because each column rolls its own row depths, so the city does not read as graph paper. Building
heights stay `2..5`.

Expected: ~4 columns × ~4 rows ≈ **16-20 buildings**, all hop-reachable from their neighbours.

Still `MP.random()` throughout — every racer must get the same city.

## 3. Dash: a launch, not a speed nudge

| | Now | After |
|---|---|---|
| duration | 15 frames | `DASH_FRAMES` (24) |
| motion | multiplies the input speed | **fixed launch vector**, input ignored mid-dash |
| distance | ~0 net gain | `DASH_CELLS = 10` cells = 400 px |
| over a gap at height | falls | **airborne — the fall test is suspended** |
| ends | timer | timer, a wall at `z = 0`, **or landing on solid tile after crossing void** |
| cooldown | none | `DASH_COOLDOWN_FRAMES` (30) |

"The dash stops when landing inside a building" needs a `dashLeftBuilding` latch: you *start*
standing on a solid tile, so the stop condition is "was over void, is now over solid", not "is
over solid".

At `z = 0` nothing is ever void, so the dash stays a 10-cell ground sprint that a wall stops —
the old behaviour, with reach.

Alleys are 3-4 cells; the dash is 10. Deliberately generous: it also clears a lot you overshoot
into, and the landing latch is what stops the overshoot from mattering.

Stairs are suppressed mid-dash (a floor change mid-air is nonsense); collectibles are not.

## 4. The Surveyor: acquire → sight → fire → pursue → forget

Two states, `patrol` and `hunt`.

**Acquire** — `patrol` → `hunt` when the player is at the same `z`, inside `visionRange`, inside
the ±45° cone, and `checkLOS` is clear. Unchanged from today's test.

**Sight** — while the bot holds line of sight it paints a beam from itself to the player and a
dot on the player, and after `LASER_LOCK_MS` (600 ms of lock before the first shot — the reaction
window today's instant contact damage does not give you) it fires every `LASER_FIRE_MS`.

**Fire** — a projectile at `LASER_SPEED` (3.6 px/frame ≈ 216 px/s, against the player's 360 px/s
walk), so it is dodgeable by moving. `LASER_DAMAGE = 3`. Stops on walls, expires on range.

**Pursue** — the cone stops mattering once hunting; the bot walks the pursuit field (below),
which routes it through doors and up and down stairs. This is "bots continue to pursue via stair
path after the player dashes across to another building".

**Forget** — `hunt` → `patrol` when line of sight has been broken for `HUNT_FORGET_MS = 5000`.
Any frame with LOS resets the clock.

A gap between roofs does **not** break LOS: `checkLOS` only stops on `wall` tiles, and the void
between two roofs is `null`. So dashing to a *same-height* roof keeps you painted and the bot
starts walking the stairs; dashing to a *different* height breaks it at once and starts the five
seconds. That asymmetry is a feature, and it is why the rule is coherent rather than toothless.

### The pursuit field — one BFS, not fifty paths

With ~55 hunters, per-bot pathfinding is the wrong shape. Instead: **one breadth-first flood from
the player's tile across all six floors**, stored as a flat `Int32Array` of
`MAX_Z × TOTAL_CELLS × TOTAL_CELLS` = 20,184 entries. Horizontal neighbours are the four
directions where the tile is bot-walkable; vertical neighbours are `stair_up → (z+1, x, y)` and
`stair_down → (z-1, x, y)`, which land on the same `(x, y)` because `buildGlassCube()` writes the
matching `stair_down` at `prevUpStair`.

Rebuilt only when at least one bot is hunting, and only when the player has changed tile or
`PURSUIT_REBUILD_FRAMES` (12) have passed. A hunting bot then reads the lowest-distance neighbour
of its own cell and steers at it — correct routing through doors and stairwells for the cost of
one flood five times a second.

Bots pursue the player's **live** tile, not a last-known position. That is what "continue to
pursue after the player dashes across" describes, and the 5-second forget rule is the limiter
that keeps it fair.

## 5. Bot count and the balance that has to move with it

`spawnGroundRobots` goes `15 + stage*4` → `45 + stage*12` (**3×**), and roof spawns go from a
~40 % chance per building to one per eligible building plus a second on the taller ones.

Two silent bugs get fixed on the way, both of which the smaller map would have made worse:

- **the ground spawn silently under-delivers.** It rolls a random cell and *skips* if the tile is
  not `exterior`, so the real count has always been well under the nominal one. Now it retries
  against a bounded budget, so 45 means 45.
- **`spawnCollectibles()` can hang the browser.** It loops `while (!placed)` over random
  `(z, x, y)` with `z ∈ 0..MAX_Z-2 = 0..4`, but buildings are only `2..5` tall, so `z = 4` exists
  *only* inside a height-5 building. With ~18 buildings instead of ~45 there is a real chance no
  building is that tall, and then the loop never terminates. Replaced with "collect the candidate
  tiles once, choose from them" — no unbounded loop, and it cannot ask for a floor that does not
  exist.

**Vision is rebalanced, and this is a judgement call, not a request.** `visionRange` was
`250 + stage*15` on a 7,200 px map — 3.5 % of the map width. Unchanged on a 2,320 px map it is
11 %, and at 3× the density every tile is inside somebody's cone, which is a death march rather
than a game. It becomes `210 + stage*8`. Combined with the 600 ms lock delay and the 5-second
escape rule, dense patrols now read as *pressure* instead of *ambush*.

## 6. Audio: five voices, four of them continuous

New file `gc-audio.js`, loaded after `gc-core.js` (which owns `audioCtx`).

**Why not `shared/sfx.js`.** `SFX` is a one-shot vocabulary — `tone()` builds an oscillator,
schedules an envelope, stops it. Four of the five sounds requested here are *sustained and
modulated* (a drone that tracks distance, a sight tone gated on lock, a loop that starts and
stops with the pursuit state), which `SFX` has no primitive for. Loading it anyway would put a
**second `AudioContext` on the page** next to the one `gc-core.js` already creates, and browsers
cap live contexts per page. So: a game-local layer on the existing context. If a sustained-voice
primitive is ever wanted repo-wide, `gcVoice()` here is the shape to lift.

| Sound | Kind | Implementation |
|---|---|---|
| walking | one-shot per step | a step blip on each `legPhase` half-cycle, alternating pitch, suppressed while dashing or falling |
| dash | one-shot | descending sawtooth whoosh + a square accent |
| drone | **sustained, distance-mapped** | detuned saw pair through a lowpass; gain *and* cutoff track the nearest same-floor robot |
| pursuit tune | **sustained loop** | a four-note minor arpeggio, scheduled a bar ahead on the audio clock |
| laser sight | **sustained, gated** | thin high triangle, on whenever any bot holds an active sight lock |

**No JS timers anywhere in it.** The bar scheduler is driven from `gameLoop()` against
`audioCtx.currentTime` — the same reasoning `shared/sfx.js` records for itself: root `CLAUDE.md`
requires every timer to be tracked, and the audio clock is not a JS timer. It is also
sample-accurate rather than subject to frame jitter.

`M` mutes. A game with three continuous voices needs a mute key, and there was not one.

## 7. Files touched

| File | Change |
|---|---|
| `gc-core.js` | constants swap, dash/laser/pursuit/audio tunables, `gcLasers` |
| `gc-audio.js` | **new** — the five voices |
| `gc-entities.js` | dash rework, Surveyor rewrite, laser projectiles |
| `gc-world.js` | `layOutCity()`, bounded core placement, 3× spawns |
| `gc-render.js` | laser + sight drawing, mute key, audio pumped from `gameLoop` |
| `gc-boot.js` | `SPAWN_CELL`, audio start |
| `gc-net.js` | `SPAWN_CELL` |
| `glass_city_escape.html` | `gc-audio.js` script tag, controls text |

All of these load on the same page into **one global scope**, so all eight were read in this
session before any was edited, and `check-global-collisions.js` is the proof that the new
top-level names (`gcLasers`, `gcVoice`, `layOutCity`, `pursuitField`, …) collide with nothing.

## 8. Verification

```
node scripts/check-global-collisions.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
```

Then in a browser: walls still block at `z = 0`; the drop still kills; a dash off a roof clears
the alley and lands; a dash into open void still falls; stairs still work; the tunnel still ends
the stage/race; a bot that sees you paints and fires; walking out of sight for five seconds ends
the hunt; a bot on another roof takes the stairs down and comes after you.
