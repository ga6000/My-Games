# Glucose Dash — v2 revamp plan (light mall + vertical risk)

Written 2026-08-29, before editing. Covers the aesthetic pass AND the one real mechanical
addition it drags in: **falling off the upper floors.**

---

## 1. What was asked

1. Light mall aesthetic — white walls both sides + stairs, white checkered floor, colourful
   storefronts.
2. Characters more rounded, white heads.
3. Upper levels lose railings and have **less walkable floor area at L2, even less at L3**, to
   increase the risk of chasing high-reward food. Test the balance impact.
4. Camera much closer to the character.

Item 3 is not cosmetic. "Lose railings + less floor" only means anything if you can **fall off**.
That's a new mechanic, and it's the thing this plan is really about.

---

## 2. The fall mechanic (new)

Walkable half-width per floor:

| Floor | Corridor half-width | Bay platform reaches | Off the edge? |
|---|---|---|---|
| 1 (ground) | 11.0 | 17.5 | No — solid white walls |
| 2 | 7.5 | 12.5 | **Yes** |
| 3 | 5.0 | 9.0 | **Yes** |

So the good food upstairs sits on a **narrow platform sticking out over a drop**, and between
bays the walkway edge is open on both sides. Getting the oat bowl on L3 means steering a
momentum-carrying runner onto a 4-unit-wide ledge and back.

**Falling:** leave the walkable area on an upper floor and you drop to the floor below.
- ~0.55s of no control while z falls
- land with speed × 0.25, then ~0.7s of stun (no throttle)
- if the landing spot is *also* off the edge, you fall again (L3 → L1 is possible)
- glucose keeps draining the whole time

Total cost ≈ 2–3s plus all your momentum. That's the risk the reward is paid against.

**Ground floor keeps its walls** — nothing to fall off, `laneLimit` clamps as it does today.

**NPCs** get edge awareness: target x is clamped to the safe band unless they're committing to a
bay, plus a steer-back term near the edge. They should still fall occasionally — they're meant to
be easy, not careful.

---

## 3. Geometry changes

- `HALL_HALF` / `BAY_DEPTH` scalars become per-floor arrays `FLOOR_HALF[]` / `BAY_OUT[]`.
  Every call site that assumed one hall width has to take a floor.
- `buildStores` / `buildWalls` / `laneLimit` / `buildItems` all become floor-aware.
- Upper floors have **no corridor walls** — only the shop façade at the outer end of each bay
  platform. That's what makes the drop visible.

---

## 4. Camera

`CAM_BACK 16 → 8`, `CAM_HEIGHT 11.5 → 7.0`, `PITCH 0.42 → 0.48`, `f = min(h*0.55, w*0.33)`.

The camera ends up **below wall height** (walls 8.5), so it sits inside the corridor rather than
floating above a diorama — which is both "much closer" and much more mall-like. Character goes
from ~14×48px to ~29×74px on an 800×450 canvas.

`FAR 300 → 200`, since a closer camera makes far geometry worthless.

---

## 5. Render rewrite

- **Floor:** checkerboard, not transverse bands. Grid of 5×5 unit cells, `(col+row)%2`. Merge
  into plain rows beyond ~90 units of depth — the checker is invisible there and it's 7× the
  quads.
- **Void:** on upper floors, draw the floor below as darkened merged rows first, so the drop
  reads as a drop. Painter order: lower floor entirely, then current floor.
- **Walls:** white `#fafafa`, jambs `#e8e6e2`, bright top rim. Ground floor only.
- **Storefronts:** this is where all the colour goes — saturated façade + sign band + floor spill.
- **Stairs:** white treads, white solid side walls (that's "white walls on stairs"), **no rails**.
- **Fog → light.** Distance fades to a bright haze, not to black. Background gradient inverts.
- **Characters:** capsule torso via `roundRect`, white head circle, rounded shadow.

---

## 6. Filter retune (the light scene breaks the old numbers)

The hyper blowout used a white overlay + brightness on a *dark* scene. On an already-white mall
that's an instant total whiteout with no information left. Retune toward saturation and contrast
(colourful storefronts go neon) and cut the white overlay hard.

Hypo is the opposite — dimming a bright scene reads *better* than dimming a dark one, so it can
stay roughly as-is.

---

## 7. Balance risk to test

Narrower upper floors + fall cost may flip the answer to SCOPE.md Q6 from "unknown" to
"upstairs is a trap." That's a legitimate outcome, but it has to be measured, not assumed:

- 10-seed sim, ground-floor-only route vs. a route that climbs for low-GI food
- fall frequency for NPCs (if they fall constantly they'll all DNF and the field collapses)
- no-food run must still DNF; well-played run must still land in the low 60s

Record the numbers in SCOPE.md §4 either way.

---

## 8. OUTCOME (measured 2026-08-29, after implementing)

All four asks shipped. The balance answer is in `SCOPE.md` §4; the short version:

| Route | Avg finish | DNF | Falls / 10 runs |
|---|---|---|---|
| Ignore all food | — | 10/10 | 0 |
| Ground floor only | 63.3s | 3/10 | 0 |
| Climb to Floor 2 | **63.1s** | 0/10 | 0 |
| Climb to Floor 3 | 65.4s | 0/10 | 3 |

NPCs: 27% DNF, 2.6 falls per race, 62.3–86.1s.

**The narrowing worked, but it bought reliability rather than speed.** Floor 2 became the
strongest line (same time as the ground route, never DNFs); the ground route is the same speed
but a 30% gamble. Floor 3 is the safest and the slowest, and is where the falls happen.

**What is NOT yet true:** floor 3's reward doesn't beat floor 2's, so its extra risk isn't
bought. To make the top floor the greedy option rather than the safe one it needs something
floor 2 hasn't got. Left as a design call, flagged as SCOPE.md Q6.

One tuning change was needed to get even this far: `TUNE.rangeBonus` went 0.08 → 0.12 and its
curve now tops out near glucose 195 instead of 200+, so the sustained-high-normal state that only
low-GI food can hold actually converts into speed. At +8% the climb could not pay for itself at
all.

### Three bugs this pass surfaced
1. `BAY_MARGIN` turned the first and last 2.2 units of every upper-floor storefront platform into
   an invisible hole. NPCs fell 3× per race and starved as a result.
2. Stair aprons were symmetric, so leaving a staircase onto a 5-wide balcony gave you 0.48s to
   get back inside the edge. Now 12 in / 28 out.
3. Staircases captured anyone inside their footprint regardless of heading, so diving sideways
   into a storefront near a stair dragged you up a floor you never asked for.

All three are recorded in `SCOPE.md` §5 with how they were found.

---

# v3 plan — graphics pass + curved, doubled course

## Reported issues and root causes

| # | Report | Cause |
|---|---|---|
| 1 | No walls left/right, floor just ends | Same as #3 |
| 3 | **Geometry disappears before leaving the screen** | `quad()` discards the WHOLE polygon if ANY corner is behind the near plane. Near wall segments always have a corner behind the camera, so they vanish entirely. Needs real near-plane polygon clipping. |
| 2 | Store names hover perpendicular to camera | They're camera-facing billboards. Need per-character placement along the wall plane so the baseline runs to the vanishing point. |
| 4 | Render distance +50% | `FAR` 200 → 300 |
| 5 | Floors above only visible from the top of stairs | Only the player's floor (+ the one below) is drawn. Add undersides + edge fascia for every floor above. |
| 6 | Fall edges hard to read | Thin trim stripe. Needs proper hazard striping and a deeper fascia. |

## Curvature + doubled course

`COURSE_LEN` 1650 → 3300, with a `centerX(y)` centreline (sum of two sines, gentle: ~9° max).

**Everything stays in TRACK space.** Physics, collision, `walkLimit`, items and NPC AI are all
unchanged — only `toCam()` adds `centerX(y)` when converting to world, and the camera tracks
`centerX(cam.y)`. This is the classic pseudo-3D road approach and it means curvature costs zero
gameplay risk. The camera still does not rotate, so the locked "fixed to the course axis"
decision holds; the road simply bends within the frame.

Consequence: long quads must be **subdivided along y** or they'll cut the corner of a curve.
Floor rows (4 units) and edge segments (6) are already fine; wall runs, bay platforms and
facade panels need splitting.

New `RAMPS` table laid out for 3300 with the same rhythm, ending in the two full-width banks.

---

## v3 OUTCOME (measured 2026-08-29)

All six graphics items plus the doubled, curved course shipped.

**Balance, 24 samples per route** (NPC timing uses `Math.random()`, so races are not
reproducible — 8-10 samples swing by 20+ points and are not enough to tune on):

| Route | Avg | DNF | Median worst glucose |
|---|---|---|---|
| Ignore all food | — | 100% | 0 |
| Ground floor only | 124.5s | 8% | 84 |
| Climb to top floor | 126.6s | 0% | 96 |

NPCs: 15% DNF, median 127.3s, 1.9 falls/race.

### What doubling the course actually broke
Not what I expected. The course length itself was fine; three *scale-dependent constants* were
not, and each had to be found by instrumenting rather than reasoning:

1. The NPC starvation predictor measured against the whole remaining race — always true at 126s.
2. Food supply was sized for 1650 with four runners sharing it, so only 0-2 items were ever in
   scan range and the slowest runners lost every contest and starved (67% NPC DNF).
3. NPCs ate 59% high-GI (net negative) because their crash weighting was too soft — a death
   spiral that a shorter race never ran long enough to expose.

### Still open
The middle floor is a transit level, not a destination: camping it DNFs 83%. Emergent, arguably
fine, but it reads as a bug to a new player. See SCOPE.md §4.

---

## v5 — perspective renderer removed, rebuilt top-down 2D (2026-08-29)

Called after four revisions in which every graphical defect traced to the projection. Rather than
fix a fifth, the view was rebuilt as a top-down floor plan, which makes the whole failure class
unrepresentable. See `SCOPE.md` §7b.

**Design calls taken (asked, not assumed):** floors below show through every drop; ~105 units of
course visible ahead; falling kept exactly as it was.

**Gameplay is byte-identical in behaviour** — physics, glucose, food curves, inventory, sprint,
NPCs, falls and the curved 3300-unit course are untouched. Measured after the swap: ground route
123.3–130.4s across 12 seeds, no-food 6/6 DNF, NPC DNF 17%. Same numbers as the 3D build.

**Cost: 0.97 ms/frame, down from 6.1.** 1451 frames rendered across a full race with no
exceptions; all three floors and a mid-fall render clean; `destroy()` → `init()` round-trip still
leaves nothing behind (32 timers → 0).

The perspective build is preserved at `glucose-dash-perspective.html.bak`.
