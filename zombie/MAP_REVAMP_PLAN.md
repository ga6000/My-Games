# Zombie — the map revamp

**A design proposal. Nothing here is built.** Supersedes and expands §8 of
`INTENSIFY_PASS_PLAN.md`, which was the first sketch; this is the specific version, written
2026-09-19 after "I'd like to get more specific and intentional with the design. there can be
multiple features [per sector] and shape / proportion of each sector can be more distinct /
standout."

Read `CLAUDE.md` → "Map", "Zones have identity" and "Pathfinding" first. Three live systems
constrain every idea below and they are listed in §1 before any of it.

---

## 0. The decision this all hangs on

**The map should stop being fully procedural.**

Right now every sector is a 1600×900 rectangle with a template shuffled into it, and that is the
root cause of the thing the brief is asking to fix. You cannot remember a place whose shape,
position and contents are all re-rolled. The sniper zone is the one sector anybody can describe,
and it is the one sector with a rule attached to it.

So: **fixed skeleton, seeded interior.**

| | Fixed, every run | Seeded, per run |
|---|---|---|
| Sector shape, size and position | ✅ | |
| Sector name and landmark | ✅ | |
| Which gun / perk lives where | ✅ (the 2026-09-19 template binding, now positional) | |
| The perimeter and its edge conditions | ✅ | |
| Sluice, escape, keep | ✅ (already fixed) | |
| Buildings, cover and crates inside a sector | | ✅ |
| Barrel and trap placement | | ✅ |
| Which two sectors get the funnel halls | | ✅ |
| Boundary door and window positions along a shared edge | | ✅ |

That keeps `MP.random()` doing real work and every client still builds the world from one seed —
the hard constraint is untouched. What changes is that **the skeleton is learnable**: "the crane"
and "the pipes" mean the same place in every run, the way "the sluice" already does.

It also deletes a whole class of bug. The 2026-09-18 pass found walls inside the funnel room on
239 of 300 seeds and a gate plate walled off on 68, purely because a fixed landmark was competing
with procedural geometry for the same ground. A fixed skeleton removes that competition entirely.

**This is the call to make first.** Everything below assumes it. If the answer is no — if the map
must stay fully procedural — then most of §3 is unbuildable and the honest fallback is just §5's
landmark pass.

---

## 1. What the current grid is actually buying

Three systems depend on the 3×3, and only one of them depends on it being *rectangles*:

1. **`zoneHotUntil[9]`** — spawn placement is "which sectors are cold, nearest first". It needs a
   partition of the map into nine nameable regions and an O(1) point→region lookup. **It does not
   need rectangles.**
2. **Every boundary carries a door and a boarded window.** That pairing is the whole segmentation
   design: there is no sector the horde cannot follow you into, so "start small" can never become
   "hide in a box". It needs every pair of neighbouring regions to share a wall run long enough to
   hold both (≈ 320px: a 124–159px door, a 112–151px window, and a post between them).
3. **Off-map spawning** is the fallback when nothing is cold, and `z.entered` is a one-way leash.
   It needs edges zombies can walk in through. **This is the one the perimeter proposal can
   break**, and §4 is mostly about not breaking it.

Plus the hard floor from `CLAUDE.md` rule 3: **no opening narrower than `2*NAV_CELL + 2*NAV_PAD`
= 78px**, or the flow field stops routing large zombies through it. Every corridor, pipe, pen
gate and culvert below is sized against that number.

---

## 2. The mechanism: a region paint grid

The thing that makes varied shapes cheap. **A coarse grid of 12 × 9 cells at 400 × 300 px**, each
cell painted with a region id 0–8. 108 cells over the existing 4800 × 2700 world.

```js
// zoneOf() becomes one array read instead of two divisions.
const ZONE_COLS_FINE = 12, ZONE_ROWS_FINE = 9;
const ZONE_CELL_W = 400, ZONE_CELL_H = 300;
const ZONE_PAINT = [ /* 108 ids, the table in §3 */ ];

function zoneOf(x, y) {
    const c = clamp(Math.floor(x / ZONE_CELL_W), 0, ZONE_COLS_FINE - 1);
    const r = clamp(Math.floor(y / ZONE_CELL_H), 0, ZONE_ROWS_FINE - 1);
    return ZONE_PAINT[r * ZONE_COLS_FINE + c];
}
```

What this buys, and why it is the right shape of solution:

- **Arbitrary rectilinear regions** — L-shapes, long ribbons, stepped edges, pockets — with no
  polygon test anywhere and no change to the cost of `zoneOf`, which runs per zombie per frame.
- **Boundaries fall out for free.** Scan the paint for cell pairs whose ids differ; each contiguous
  run of such edges is a wall segment, already axis-aligned, already a multiple of 300 or 400 px.
  `buildZoneWalls` walks that list instead of the 3×3 lattice, and the door/window pair goes on
  the longest run each region pair shares. **Boundaries stay axis-aligned**, which is what keeps
  the two solid grids, the door art and the window art all working unchanged.
- **`zoneBounds(i)` becomes a bounding box plus a cell list.** Anything that places an object by
  picking a point in the bounds must also test `zoneOf(x, y) === i`, or an L-shaped sector will
  drop crates into its neighbour's ground. That is the one call-site change with teeth:
  `findOpenSpot`, `findOpenSpotSure`, `buildZoneContents`, `placeWallBuys`, `placeCardStations`,
  `buildFunnelHall`.
- **The minimap gets silhouettes.** Draw the paint grid tinted per region and the nine shapes
  become readable at a glance — which is most of what "recognizable features that players
  remember" actually means in play. Today the minimap shows nine identical boxes.

**What it costs.** Region adjacency stops being the tidy 3×3 four-neighbour graph: the centre
ends up bordering seven sectors in the layout below. So `generateLevel` needs a **connectivity
assert** — every region reachable from the centre through door openings — and the door price
curve needs a look, because "ring distance from the centre" is no longer a meaningful number
(§6).

---

## 3. The nine sectors

```
        col 0    1    2    3    4    5    6    7    8    9   10   11
      ┌────────────────────────────────────────────────────────────────
row 0 │  SPL  SPL  CLD  CLD  CLD  KEN  KEN  KEN  YRD  YRD  YRD  YRD
row 1 │  SPL  SPL  CLD  CLD  CLD  KEN  KEN  KEN  YRD  YRD  YRD  YRD
row 2 │  SPL  SPL  CLD  CLD  CLD  KEN  KEN  KEN  YRD  YRD  YRD  YRD
row 3 │  SPL  SPL  TRB  TRB  BLK  BLK  BLK  BLK  YRD  YRD  YRD  YRD
row 4 │  SPL  SPL  TRB  TRB  BLK  BLK  BLK  BLK  PMP  PMP  YRD  YRD
row 5 │  SPL  SPL  TRB  TRB  BLK  BLK  BLK  BLK  PMP  PMP  YRD  YRD
row 6 │  SPL  SPL  TRB  TRB  SLU  SLU  SLU  MTR  MTR  MTR  MTR  MTR
row 7 │  SPL  SPL  SPL  SLU  SLU  SLU  SLU  MTR  MTR  MTR  MTR  MTR
row 8 │  SPL  SPL  SPL  SLU  SLU  SLU  SLU  MTR  MTR  MTR  MTR  MTR
```

| | Sector | Cells | Footprint | Proportion |
|---|---|---|---|---|
| SPL | **THE SPILLWAY** | 20 | 800 × 2100, with a 1200-wide foot | **1 : 2.6** — the longest, thinnest thing on the map |
| CLD | **COLD STORAGE** | 9 | 1200 × 900 | 1.33 : 1 |
| KEN | **THE KENNELS** | 9 | 1200 × 900 | 1.33 : 1 — *deliberately the same box as CLD* |
| YRD | **THE YARD** | 20 | 1600 × 1200 with an 800 × 600 arm | **L** — the only sector that wraps a corner |
| TRB | **TURBINE HALL** | 8 | 800 × 1200 | **1 : 1.5** — a vertical slot |
| BLK | **THE BLOCKHOUSE** | 12 | 1600 × 900 | 1.78 : 1 — the start |
| PMP | **PUMP HOUSE** | 4 | 800 × 600 | **the smallest**, crossable in ~4s |
| SLU | **THE SLUICE YARD** | 11 | stepped, 1600 × 900 → 1200 × 600 | stepped down to the south wall |
| MTR | **THE MOTOR POOL** | 15 | 2000 × 900 | **2.2 : 1** — the widest, shallowest |

**Area spread is 4 cells to 20 — five to one.** That is the point: today all nine are identical.

**CLD and KEN are the same box on purpose.** One matched pair makes the other seven read as
deliberately varied rather than randomly ragged, and it forces those two to be told apart by their
*contents* — which is the sharper design problem and the more interesting answer.

Everything fixed today still lands where it lands: the keep (620 × 420 at 2090–2710, 1140–1560)
sits well inside BLK; the sluice (2170–2630, 2170–2490), both gate plates and the escape
(2310–2490, 2626–2692) all sit inside SLU. Worth an assert at generation rather than a comment.

### 3.1 THE SPILLWAY — the pipes

*A 2100px-tall ribbon down the west edge, 800px wide, widening to 1200 at the foot.*

1. **Three parallel stormwater runs, north–south, drawn as actual pipe** — ribbed barrel walls
   curving away above and below, a painted invert line down the centre of each, and a **graded
   mouth** at each end: a vertical gradient plus a foreshortened opening, so the floor reads as
   sloping down into the pipe. The grade is drawn, never simulated — movement is untouched, the
   same render/sim split `AESTHETIC_GUIDE.md` §6.4 already relies on. Runs are 160px clear
   (2× the 78px guarantee, and wide enough for two players to pass).
2. **Grate shafts.** Every ~500px a square of pale light falls from an overhead grate, with the
   grate's bars drawn as shadow across the floor. Pools of light in an otherwise unlit tube, which
   is also where you choose to stand and fight.
3. **The silt trap**, at the foot: a wide sump chamber where the three runs converge, the one open
   room in the sector, with a low weir wall across it as cover.

**Holds the SNIPER**, as it does today — the runs are the longest uninterrupted sightlines in the
game, and you can watch something come at you for 2000px. **The feel is commitment**: once you are
in a run you go forward or back and there is no third option.

### 3.2 COLD STORAGE — the freezer rooms

*A compact 1200 × 900 block, the most regular geometry on the map.*

1. **A grid of freezer rooms** off a central spine corridor — small, square, hard-walled, most
   standing open and a few shut. The one sector built out of right angles and repetition.
2. **The frost floor**, which `zombie-floors.js` already draws, carried onto the *walls* as a pale
   rime line at floor level, so the sector reads cold from any angle.
3. **Strip curtains** at each room mouth: hanging vertical plastic strips, drawn only. **Not
   sight-blocking** — see §7 for why that temptation is a trap.

**Holds the RIFLE and RICOCHET.** Flat parallel hard walls everywhere is exactly the geometry
where a bouncing round is worth a perk slot, and that is the kind of pairing the brief is after:
the place explains the thing found there.

### 3.3 THE KENNELS — the warren

*The same 1200 × 900 box as COLD STORAGE, and nothing else about it is the same.*

1. **Rows of pens** — the densest cover on the map, many small enclosures with 112px gates. It is
   the sector where you cannot see more than one row ahead.
2. **The run**: one long open lane straight down the middle, wall to wall. The only place you can
   retreat in a straight line, and therefore the whole tactical shape of the sector — you fight in
   the pens and you leave by the run.
3. **Chain fencing rather than masonry** on the pen walls, drawn as mesh, so the sector's
   silhouette on the minimap is dotted where everything else is solid.

**Holds the SHOTGUN.**

### 3.4 THE YARD — the crane

*The largest sector and the only L: 1600 × 1200 across the north-east, with an 800 × 600 arm
reaching south.*

1. **The gantry crane.** THE landmark. Drawn tall enough to be visible from two sectors away —
   over the boundary walls, above the sector — so "meet at the crane" works from across the map.
   This is the single feature that most directly answers the brief.
2. **A rail spur with flatcars**: long, low, parallel solids forming lanes that run at a different
   angle from everything else on the map.
3. **Container stacks** filling the arm, in a layout that is seeded — the one sector whose interior
   changes noticeably between runs, which is also what stops the biggest sector becoming rote.

**Holds SCAVENGER.**

### 3.5 TURBINE HALL — the slot

*800 × 1200. A vertical slot between the pipes and the keep.*

1. **The generator**, as today, on a raised plinth in the middle of the hall.
2. **Two turbine housings** flanking it, long and low, dividing the slot into three lanes — so the
   room you must defend during a Blackout restart has exactly three approaches and you can say out
   loud which one you are watching.
3. **Cable runs** overhead and underfoot, drawn as the sector's floor motif, all converging on the
   plinth.

Its job is inherited from the Blackout mechanic: from 2026-09-18 a Blackout trips the generator
and the round cannot clear until someone stands here for 5s. **That is a defend-the-point fight,
and this sector should be shaped for it** — which the current random placement of the generator
inside a generic zone does not do at all.

### 3.6 THE BLOCKHOUSE — the start

*1600 × 900 at the centre. The keep, the field manual, the horde switch, the first crate.*

Unchanged in substance. Two notes:

1. **It borders seven sectors** in this layout, against three or four today. That is deliberate —
   "which door do we buy first?" becomes a real opening decision with seven answers instead of
   two — but it is also the reason the door price curve needs rethinking (§6).
2. **The horde switch and the manual sit on opposite walls**, as they now do, and the keep should
   stay the one place on the map with no ambiguity about what each object is.

### 3.7 PUMP HOUSE — the pocket

*800 × 600. Four cells. The smallest sector by a factor of five.*

1. **One machine hall.** Not a region you traverse — a *room* you are in. Four pump housings on a
   diamond-plate floor, and that is the whole sector.
2. **A mezzanine walkway** around two sides, drawn above with solid plant beneath, so the space
   reads as taller than it is wide.
3. **Standing water** across the floor with the pumps' discharge running through it, which is the
   visual link to THE SPILLWAY on the far side of the map.

**Holds the FLAMETHROWER and CONDUCTOR.** A tiny hard-walled room is where a short-range cone and
a trap network are both at their best, and where the flamethrower's new 340-round magazine is
least punishing.

**Deliberately the one sector that is a single space.** Nine regions that are all "an area with
stuff in it" is the current failure; one of them being a room is what makes the others read as
areas.

### 3.8 THE SLUICE YARD — the south wall

*Stepped: 1600 × 900 across the top, dropping to 1200 × 600 against the south perimeter.*

1. **The sluice, the two gate plates and funnel 1**, all at their existing fixed coordinates.
2. **The south perimeter wall itself** — a real concrete wall, not an invisible world edge — with
   **the escape gate set into it**. This is worth more than it sounds: the heavy gate and
   chainlink gate built on 2026-09-19 currently sit in a wall that does not exist, at the bottom
   of a map that simply stops. Putting them in a wall makes the whole endgame legible.
3. **A flood channel** running east–west along the base of the wall, dry until THE FLOOD, then
   running — a visual payoff for the one moment the map is supposed to feel overwhelmed.

### 3.9 THE MOTOR POOL — the long hall

*2000 × 900. The widest, shallowest sector: a horizontal hall you read left to right.*

1. **Service bays in a row**, each a three-walled pocket off the main run — cover you duck into,
   with one way out, which is the opposite of the pens in THE KENNELS.
2. **The fuel island** in the middle, carrying most of the map's barrels, as its template already
   does.
3. **A wrecked bus** across the eastern end: a landmark, a long piece of cover, and the thing that
   breaks the sector's one long sightline into two.

**Holds the ROCKET and SALVAGE.**

---

## 4. The perimeter — and the spawner problem

Today `buildZoneWalls` emits no perimeter at all. The map's edge is invisible, and zombies spawn
past it and walk in.

**Proposed: two edge conditions.**

- **North and west — deep forest.** A 240px band of scattered trunk solids at low density, inside
  the map, with no wall. Sightlines break up, movement stays free, and it is visibly a different
  kind of ground. It touches THE SPILLWAY, COLD STORAGE, THE KENNELS and THE YARD.
- **South and east — a hard concrete perimeter wall.** The escape gate is set into the southern
  one; THE YARD and THE MOTOR POOL back onto the eastern one.

### The thing that will break if this is done carelessly

Off-map spawning is the fallback when no sector is cold. **Walling two sides removes half the
map's spawn frontier**, and a team camped in THE MOTOR POOL — the far south-east corner, ~3,900px
from the nearest forest — would face a contact time far worse than anything measured today. That
is the same trap the zone-cooldown system already hit once: `CLAUDE.md` records a permanent
"visited" flag doubling contact time to 25.6s exactly when rounds should be hardest, which also
made opening the map *easier*, backwards.

**Two mitigations, and both are needed:**

1. **The forest is a spawn reservoir, not an off-map region.** Because it is *inside* the map,
   `pickSpawnPoint` gets a real source with real cover instead of "somewhere past the edge", and
   `z.entered` has less work to do. Forest cells count as cold unless a player is in or beside
   them, like any other ground.
2. **Culverts in the hard wall.** Grated mouths at intervals along the south and east perimeter —
   sized at or above the 78px guarantee, drawn as pipe ends to rhyme with THE SPILLWAY — that
   zombies come out of. The wall stays a wall and stays readable as one, and the spawn frontier
   stays wrapped all the way around the map. Culverts are also a far better *telegraph* than the
   map edge: you can see the thing you are about to be flanked from.

**Measure before committing.** Re-run the existing contact-time benchmark (`CLAUDE.md` →
"Pacing, measured": 11.3s round 1, 12.8s late game) from a camp in every sector, not just the
centre. If MOTOR POOL or THE YARD measure much worse than 12.8s, add culverts until they do not.

---

## 5. If the fixed skeleton is rejected

The one part of this that works on a procedural map, and it is still worth doing on its own:

**One landmark per sector, drawn big, placed by the existing template system.** A water tower, a
crane, a collapsed gantry, a rail spur, a chimney. Tall enough to be visible over boundary walls
and drawn on the minimap. Bound to the template (as guns and perks now are, since 2026-09-19), so
"the crane is in the yard" stays true even though the yard moves.

That gets maybe half the memorability for a tenth of the work, and it is compatible with
everything that exists today.

---

## 6. Consequences to work through before building

- **Door pricing.** `d.cost = 900 + 350 * max(ringA, ringB)` is ring distance from the centre in a
  3×3. With irregular regions and a centre that borders seven of them, "ring" stops meaning
  anything. Replace it with **graph distance from THE BLOCKHOUSE through door openings**, computed
  once at generation — which is what ring distance was approximating anyway.
- **Seven doors out of the keep** is a much wider opening decision than two. Good for choice,
  but the early economy was tuned against a narrower one. Re-measure the round 1–5 scrap curve.
- **`zoneBounds` callers must test `zoneOf`**, or L-shaped sectors leak their contents into
  neighbours. Six call sites, listed in §2.
- **Funnel halls need 560 × 280 plus clearance.** PUMP HOUSE (800 × 600) and TURBINE HALL
  (800 × 1200) cannot hold one. `planFunnelHalls` must exclude sectors that cannot fit a hall
  rather than discovering it through its fallback path.
- **`ZONE_FLOOR_TINT` and `zombie-floors.js`** are per-template and keep working unchanged, but
  with fixed sectors the tint becomes part of each sector's identity rather than a per-run
  accident — which is a gain, and worth picking the nine deliberately as a palette.
- **A connectivity assert at generation.** Every region reachable from the centre through door
  openings. Cheap, and it is the check that would have caught the 2026-09-18 walled-off gate plate.

---

## 7. The hedge maze — why it is not in §3

It was in the brief and it is a good instinct, but it is a **pathfinding and visibility change
wearing a decoration's hat**, and it would be the most expensive item here:

- **Sight-blocking but walkable needs a third solid set.** The game has two
  (`solidGridPlayer`, `solidGridZombie`) and gained a third *view* for bullets on 2026-09-19
  (`bulletBlockedAt`). A fourth concept — blocks line of sight, blocks nothing else — means
  touching `navClearLine`, `visibleToAnyone` and the lighting, and `visibleToAnyone` is what stops
  zombies spawning in shot you are looking at.
- **Solid and walkable is much cheaper** and is just a warren — which THE KENNELS already is, and
  doing it twice would weaken both.
- If it is built anyway, build it **solid, sight-blocking by virtue of being solid, and
  generously wide**: 160px lanes, not 90, and re-run the traversal measurement from
  `CLAUDE.md` → "Measured again (2026-09-18)" for every zombie type including the ULTRA HEAVY.
  A maze of minimum-width corridors is precisely the geometry the flow field is worst at.

The strip curtains in COLD STORAGE (§3.2) are drawn-only for exactly this reason.

---

## 8. Sequencing

Each step is playable on its own, and each one is worth having even if the next never happens.

1. **The paint grid and the nine shapes**, with the existing template contents dropped into them
   unchanged. No new art. This is the step that proves `zoneOf`, the boundary scan, the
   `zoneBounds` call sites and the connectivity assert, and it is the one that can break the most.
   Play it before going further — the shapes alone change how the map feels.
2. **The perimeter and the culverts**, with the contact-time benchmark re-run from a camp in every
   sector. The only step that can break the spawner.
3. **Landmarks** — one per sector, drawn big and on the minimap. Pure generation plus draw.
4. **Sector interiors**, one sector per session, in the order they are most visited: THE
   BLOCKHOUSE's neighbours first, THE SPILLWAY's pipes as the flagship.
5. **The hedge maze**, only if §7's cost is still acceptable after 1–4.

Item 7 of the 2026-09-19 pass (guns and perks bound to templates) is a prerequisite for all of it,
and it has landed. A sector is memorable when a known thing lives there.
