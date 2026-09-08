# Glass City Escape — the Stepwell pass (2026-09-06)

Nine changes, written before any edit per root `CLAUDE.md`. Follows `GCE_HUNT_PASS_PLAN.md`
(2026-09-05) and supersedes its combat numbers; everything else in that document still stands.

The through-line: **the Hunt pass made the city dangerous, this one makes the danger legible.**
Every change below is either a telegraph (you can see or hear it coming), a landmark (you know
where to go), or an instrument (I can see what actually happened to you).

---

## 1. Cores favour building interiors

`spawnCollectibles()` currently pools `floor` and `exterior` tiles and picks uniformly, so roughly
two thirds of cores land in the street — the exact "no reason to go up" problem
`GCE_HUNT_PASS_PLAN.md` §0.2 named and did not fix.

Two pools now, `CORE_INTERIOR_BIAS = 0.72` toward interiors. **Bias, not exclusivity**: street
cores are what stop the opening minute being "find a door", and they are the ones you can grab on
the way back to the well.

Still `MP.random()`, so every racer collects in the same places.

## 2. Chase speed down slightly

`chaseSpeed` `3.5 + stage*0.3` → `3.0 + stage*0.25`. At stage 1 that is 3.25 px/frame against the
player's 6.0 walk, down from 3.8 — a hunter closes distance about 14 % slower. Patrol speed and
vision are untouched.

## 3. Beams come only from blue Lancers

`Robot.kind` is `'melee'` or `'lancer'`, assigned on the seeded stream at spawn,
`LANCER_SHARE = 0.22`. Only Lancers get a laser sight and fire bolts. Everything else — the cone,
the acquire, the 2 s telegraph, the stair pursuit, the melee — is common to both.

> **This collides with `AESTHETIC_GUIDE.md` §2.3 and the collision is deliberate, so it is
> recorded rather than skipped.** The guide's rule is that a *signal* colour must never be
> assignable to a player; blue is not a signal colour, but the identity palette does contain two
> blues (`hsl(206,85%,70%)`, `hsl(227,87%,68%)`), so a blue enemy can be confused with a rival's
> ghost. Mitigations: the Lancer blue is `#2F6BFF`, deeper and more saturated than either; ghosts
> render as translucent circles with a name label above them and Lancers as hard-edged bodies; and
> **the Lancer carries a shape nothing else has** — a barrel stub and a rotating sight ring — so
> the read does not depend on colour alone. Shape first, colour second, is the right answer
> whenever a new colour has to live near the identity palette.

## 4. The spot telegraph — 2 s of "it has seen you"

A third state between `patrol` and `hunt`: **`alert`**, held for `SPOT_TELEGRAPH_MS = 2000`.

On acquiring (cone + range + LOS, unchanged) the drone stops, plays a rising two-note spot sting,
and draws an expanding ring plus a rising exclamation over itself. It cannot attack during this.
At the end it commits to `hunt` **whether or not it can still see you** — it saw you, and the
5 s forget clock is already running from the last frame it had sight.

That is the two seconds to break line, get behind something, or dash to another roof.

## 5. Melee replaces overlap damage entirely

**Deleted:** the contact-damage block. Even rate-limited at 500 ms it was still "damage for being
in the same place", with the drone's own body hiding the moment it happened.

**Added:** a discrete attack. Within `MELEE_RANGE` (34 px) on the same floor and off cooldown, the
drone enters a `MELEE_WINDUP_MS = 350` wind-up — a swelling arc drawn in front of it — then
strikes for `MELEE_DAMAGE = 4`, then waits `MELEE_COOLDOWN_MS = 2000`. Stepping out of range
during the wind-up makes it whiff.

> **The 350 ms wind-up was not requested and is the one liberty taken here.** A 4-heart hit is a
> fifth of the bar; landing that with no frame of warning would rebuild, in a new mechanic, the
> exact problem the whole pass exists to remove. It is short enough that the attack still reads as
> "every 2 seconds" and long enough to be dodged by moving.

## 6. Beams: 1 heart and knockback

`LASER_DAMAGE` 3 → **1**, plus `LASER_KNOCKBACK = 28` px along the bolt's heading, applied through
the same per-axis wall test the player's own movement uses.

Knockback at height can shove you off a roof. Kept: 28 px is 0.7 of a cell, so it only matters when
you are already on the edge, and "do not fight Lancers on a ledge" is a real decision. It is also
why the beam is now worth 1 — the damage moved from the number to the position.

## 7. Cross-floor drone audio

The problem named: you climb a stairwell into a room you could not hear and die to something that
was always there.

The drone hum's distance becomes an **effective** distance:

```
effective = hypot(dx, dy) * (1 + VERT_PENALTY * |dz|)      // VERT_PENALTY = 0.85
```

so a drone one floor up reads at about 1.85× its map distance — present, quieter, not silent. It
is scanned over **every** floor now, not just the player's own.

A second sustained voice, `gcVerticalVoice`, carries the specific warning: a slow pulsing tone
that responds **only** to drones on `z ± 1` within `VERT_ALERT_RANGE = 260` px of the player in
x/y. That is exactly the "something is directly above the ceiling you are about to walk through"
case, and it gets its own timbre so it cannot be mistaken for the general hum.

The minimap (§8) shows the same information visually. Two channels for one fact, because the fact
is "you are about to die for a reason you cannot see".

## 8. Minimap

Top-right, `MINIMAP_CELL = 2` px per cell → 116 px plus a frame.

- Building footprints for the **current floor**, cached: one offscreen canvas per floor, rebuilt
  when the world is. Redrawing 3,364 cells every frame for a decoration would be the single most
  expensive thing in the loop.
- Player as a bright dot with a facing tick.
- Drones: current floor solid, **`z ± 1` hollow and dimmer** — the visual half of §7. Hunting
  drones in magenta, Lancers in blue, patrols dim.
- Uncollected cores on the current floor, amber.
- The stepwell, always, at the centre; cyan and pulsing once the tunnel is open.

## 9. The stepwell

> *"make center of map spot to escape more played up, like an indian step well"*

A **13 × 13 plaza** (`PLAZA_HALF = 6`) is reserved at the map centre before `layOutCity()` runs;
any lattice building whose footprint would intersect it is skipped. The plaza is filled with a new
`stepwell` tile carrying its Chebyshev ring index, and rendered as concentric terraces that
brighten as they descend, with the escape tunnel at the exact centre.

**This deliberately breaks the 3-4 cell alley rule, and that is the point.** A plaza is not an
alley. The buildings around it stand 6+ cells back, so the well is a **hole in the skyline** —
from any nearby roof you can see the one place you eventually have to reach, and you cannot dash
across it. The centre stops being a coordinate and becomes a landmark.

`stepwell` is walkable at `z = 0` exactly like `exterior`. Every consumer was checked rather than
assumed: `checkWallCollision` (player and robot) only blocks `wall`; `botWalkable` only excludes
`wall` and above-ground `exterior`; `checkLOS` only stops on `wall`. Cores and ground robots both
test `=== 'exterior'` explicitly, so neither spawns inside the well — which is correct: it is the
destination, not another room.

## 10. Telemetry — `gc-telemetry.js`

The user asked for a log of outcomes to gauge difficulty from real play. Design constraints: it has
to survive `file://`, survive a reload, and produce something small enough to paste into a chat.

- **Aggregates per run, not an event stream.** A 5-minute run at 60 fps is 18,000 frames; nobody is
  pasting that. Each run records: duration, stage reached, floors visited, cores taken of total,
  cause of end, HP low-water mark, damage split by source (`melee` / `beam` / `fall`), times
  spotted, hunts escaped, melee whiffed vs landed, dashes and how many ended in a fall, and time
  spent above ground.
- **`localStorage`, namespaced `gce_telemetry_v1`**, capped at `TELEMETRY_MAX_RUNS = 40` (oldest
  dropped). Every read and write wrapped — private mode must not break the game.
- **`L` opens the log overlay**: a computed summary plus the raw JSON in a `<textarea>`, pre-selected,
  with a Copy button that tries `navigator.clipboard` and falls back to `select()`. `window.gcDumpLog()`
  returns the same object for the console.
- A run is closed by the same choke point everything else uses — `showMessage(..., isGameOver = true)`
  — plus `triggerNextStage()` for a stage clear, so both endings are recorded and neither is
  double-counted.

**What I will read out of it:** whether deaths cluster on melee or beams, whether they cluster at a
floor (which would say the vertical warning is not working), how often a hunt is escaped versus
survived, and whether HP low-water is scraping zero repeatedly (tuned too tight) or never dropping
below half (too loose).

## 11. Files touched

| File | Change |
|---|---|
| `gc-core.js` | Lancer/melee/beam/telegraph/plaza/minimap/core-bias constants |
| `gc-telemetry.js` | **new** — the run log |
| `gc-audio.js` | cross-floor drone mix, vertical voice, spot sting, melee swing/hit |
| `gc-entities.js` | `alert` state, `kind`, melee, beam damage + knockback, overlap damage deleted |
| `gc-world.js` | plaza reservation, stepwell fill, core bias, chase speed, Lancer assignment |
| `gc-render.js` | stepwell tile, minimap, alert animation, `L` key |
| `gc-boot.js` | telemetry start |
| `glass_city_escape.html` | script tag, log overlay markup, controls text |

All load into **one global scope**; every one was read this session before editing, and
`check-global-collisions.js` is the proof the new top-level names collide with nothing.

## 12. Verification

The three checkers, the headless harness extended with cases for the new rules (plaza reserved and
walkable, no building intersects it, cores biased to interiors, Lancers are the only shooters,
melee lands on a 2 s cadence, telegraph holds 2 s, overlap does no damage), then a real browser.
