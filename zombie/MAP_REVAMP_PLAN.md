# Zombie — the map revamp

Supersedes §8 of `INTENSIFY_PASS_PLAN.md`. **Revision 2, 2026-09-19**, after the user read
revision 1 and asked for: irregular shapes rather than varied rectangles (L, S, H and the like),
weapon density varying by sector, more on the memorable structures and **how they are actually
executed**, the maze rebranded as a **shipping container maze in the top-right sector**, and a
**floor treatment split into interior / exterior / unique structure**.

Build order agreed: **sequence steps 1–4**, then step 5 on a follow-up.
**All five are now built** — see `zombie/CLAUDE.md` for what actually shipped and where it
differs from this plan (the maze lane is 140, not 160, and THE YARD gained a paint cell).

Read `CLAUDE.md` → "Map", "Zones have identity" and "Pathfinding" first. Three live systems
constrain all of this and they are in §1.

---

## 0. The decision this hangs on

**The map stops being fully procedural.** Fixed skeleton, seeded interior.

| | Fixed, every run | Seeded, per run |
|---|---|---|
| Sector shape, size, position | ✅ | |
| Sector name, landmark, floor treatment | ✅ | |
| Which gun / perk lives where, and how many | ✅ | |
| The perimeter and its edge conditions | ✅ | |
| Sluice, escape, keep | ✅ (already fixed) | |
| Buildings, cover, crates, barrels | | ✅ |
| Where inside a sector its structures sit | | ✅ |
| Which two sectors get the funnel halls | | ✅ |
| Door and window positions along a shared edge | | ✅ |

`MP.random()` still does real work and every client still builds from one seed — the hard
constraint is untouched. What changes is that **the skeleton is learnable**.

It also deletes a class of bug: the 2026-09-18 pass found walls inside the funnel room on 239 of
300 seeds, purely because a fixed landmark competed with procedural geometry for the same ground.

---

## 1. What the current grid is buying

1. **`zoneHotUntil[9]`** — spawn placement is "which sectors are cold, nearest first". Needs a
   partition into nine nameable regions and an O(1) point→region lookup. **Not rectangles.**
2. **Every boundary carries a door and a boarded window.** Needs every neighbouring pair to share
   a wall run long enough for both (≈320px: a door, a window, and a post between).
3. **Off-map spawning** is the fallback when nothing is cold. Needs edges zombies walk in through.
   **This is the one the perimeter can break** — §5.

Hard floor: **no opening narrower than `2*NAV_CELL + 2*NAV_PAD` = 78px**, or the flow field stops
routing large zombies through it. Every corridor, pipe, gate and culvert below is sized against it.

---

## 2. The mechanism: a region paint grid

**12 × 9 cells at 400 × 300px**, each painted with a region id 0–8. 108 cells over the existing
4800 × 2700 world.

```js
function zoneOf(x, y) {
    const c = clamp(Math.floor(x / ZONE_CELL_W), 0, ZONE_COLS_FINE - 1);
    const r = clamp(Math.floor(y / ZONE_CELL_H), 0, ZONE_ROWS_FINE - 1);
    return ZONE_PAINT[r * ZONE_COLS_FINE + c];
}
```

- **Arbitrary rectilinear regions** — crosses, brackets, tongues, stepped ribbons — with no polygon
  test and no change to the cost of `zoneOf`, which runs per zombie per frame.
- **Boundaries fall out for free.** Scan for cell pairs whose ids differ; each contiguous run is a
  wall segment, already axis-aligned, already a multiple of 300 or 400px. The door/window pair goes
  on the longest run each region pair shares. **Axis-aligned boundaries** is what keeps both solid
  grids and the existing door/window art working unchanged.
- **`zoneBounds(i)` becomes a bounding box plus a cell list.** Anything placing an object by
  picking a point in the bounds must also test `zoneOf(x, y) === i`, or an irregular sector drops
  crates into its neighbour. Six call sites: `findOpenSpot`, `findOpenSpotSure`,
  `buildZoneContents`, `placeWallBuys`, `placeCardStations`, `buildFunnelHall`.
- **The minimap gets silhouettes.** Draw the paint grid tinted per sector and the nine shapes
  become readable at a glance — which is most of what "features players remember" means in play.

**Costs.** Adjacency stops being the 3×3 four-neighbour graph (the centre borders six sectors
here), so generation needs a **connectivity assert**, and door pricing needs replacing (§7).

---

## 3. The nine sectors — shapes

```
        col 0    1    2    3    4    5    6    7    8    9   10   11
      ┌──────────────────────────────────────────────────────────────
row 0 │  SPL  SPL  CLD  CLD  CLD  CLD  KEN  KEN  KEN  YRD  YRD  YRD
row 1 │  SPL  SPL  SPL  CLD  CLD  CLD  KEN  KEN  KEN  YRD  YRD  YRD
row 2 │  SPL  SPL  SPL  CLD  CLD  BLK  BLK  KEN  KEN  KEN  YRD  YRD
row 3 │  SPL  SPL  TRB  TRB  TRB  BLK  BLK  BLK  BLK  YRD  YRD  YRD
row 4 │  SPL  SPL  TRB  BLK  BLK  BLK  BLK  BLK  BLK  PMP  PMP  YRD
row 5 │  SPL  SPL  TRB  TRB  TRB  BLK  BLK  PMP  PMP  PMP  YRD  YRD
row 6 │  SPL  SPL  SPL  SPL  SLU  SLU  SLU  MTR  MTR  MTR  YRD  YRD
row 7 │  SLU  SLU  SLU  SLU  SLU  SLU  SLU  MTR  MTR  YRD  YRD  MTR
row 8 │  SLU  SLU  SLU  SLU  SLU  SLU  SLU  MTR  MTR  MTR  MTR  MTR
```

| Sector | Cells | Shape | bbox fill | Borders |
|---|---|---|---|---|
| **THE SPILLWAY** | 18 | **stepped ribbon** — a two-cell spine with a shelf at the shoulder and a four-cell foot | 64% | 3 |
| **COLD STORAGE** | 9 | **descending staircase** — 4 wide, then 3, then 2 | 75% | 4 |
| **THE KENNELS** | 9 | **S-step** — a 3×2 block with its bottom row shifted one east | 75% | 3 |
| **THE YARD** | 18 | **hourglass with a tongue** — a big north-east block, a one-cell waist, then a spur reaching west *between the Motor Pool's bays* | 75% | 4 |
| **TURBINE HALL** | 7 | **bracket, opening east** — two arms and a spine, wrapped around the Blockhouse's west arm | 78% | 4 |
| **THE BLOCKHOUSE** | 14 | **cross** — the most irregular thing on the map | **58%** | 6 |
| **PUMP HOUSE** | 5 | **boot** — the smallest sector, an L on its side | 62% | 3 |
| **THE SLUICE YARD** | 17 | **tee** — a wide base along the south wall, a stem rising to the gate plates | 81% | 4 |
| **THE MOTOR POOL** | 11 | **bracket with a bite** — the Yard's rail spur runs straight through its middle | 73% | 3 |

Area spread **5 cells to 18 — 3.6 to 1**. Bbox fill **58% to 81%**: not one of these is a
rectangle, and the two most distinctive (the cross and the boot) are the ones you spend the most
and least time in.

**Verified before it was written down** (`shapes.py`, in the scratchpad): all nine contiguous
4-connected, all nine border at least three others, all reachable from the Blockhouse, 108 of 108
cells claimed, and every fixed feature lands in the right sector — the keep in BLK, the sluice,
both gate plates and the escape in SLU.

### Two interlocks worth keeping

- **TURBINE HALL's bracket wraps THE BLOCKHOUSE's west arm.** The generator hall hugs the keep,
  which is the fiction you want: your power comes from next door, and defending it during a
  Blackout means holding a bracket with one mouth.
- **THE YARD's tongue runs between THE MOTOR POOL's bays**, and it is a **rail spur** — the same
  spur that is one of the Yard's structures. One sector physically reaching into another, with a
  reason. This is the single clearest "not a grid" signal on the minimap.

---

## 4. The nine sectors — structures, and how to draw them

The brief: *"talk about the memorable structures more and discuss execution."* So: what each one
is, and **how a top-down 2D renderer makes it read as a structure rather than a wall**.

### 4.1 The five execution techniques

Everything below is built from these, and they are cheap. None needs a new render pass.

| | Technique | What it does | Cost |
|---|---|---|---|
| **T1** | **Cast shadow** — a flat offset quad down-right of the footprint, one constant `rgba` | Instantly reads as height. The single highest value-per-byte trick here | one `fillRect` |
| **T2** | **Offset top face** — draw the top face 6–14px up-left of the base footprint, in a lighter flat colour | A crude axonometric nudge. Taller structure = bigger offset, so offset *encodes* height | 2 `fillRect` |
| **T3** | **Draw over the boundary wall** — landmarks draw at world level, after walls, culled to the view and not to the sector | Makes a structure visible **from the next sector**, which is what "meet at the crane" requires | ordering only |
| **T4** | **Minimap glyph** — a 5–7px distinct mark per landmark, not a dot | Turns the minimap from nine boxes into a map you navigate by | one path each |
| **T5** | **Silhouette on the floor** — the structure's shadow/stain painted into the floor layer, not the entity layer | Survives being off-screen; the ground remembers what stood there | floor pass |

**T1 + T2 together are the whole illusion.** Shadow says "something is above the floor"; the
offset top face says how far above. Applied consistently in one direction (down-right shadow,
up-left top face) across every structure on the map, the whole world gains a height read without a
single new system. `AESTHETIC_GUIDE.md` §6.3 is satisfied because both are **flat fills, no
gradients** — this is exactly how 1980 raster games faked height.

### 4.2 THE SPILLWAY — the three pipes

*Stepped ribbon down the west edge. **Holds the SNIPER.***

1. **Three parallel storm runs, drawn as pipe.** Each run is a 160px clear channel (2× the 78px
   guarantee) between two ribbed walls. Execution: the wall is a flat band with **rib ticks every
   24px** (one `fillRect` each, in a loop already culled to the view), and the **invert line** is a
   single 2px stripe down the centre of the channel in a darker floor tone. The ribs are what make
   it read as pipe rather than corridor, and they cost one small rect each.
2. **Graded mouths.** At each end of a run, a **foreshortened opening**: a trapezoid narrowing into
   darkness, with three flat bands stepping from floor tone to near-black. That is the grade —
   drawn, never simulated. Movement is untouched, per the render/sim split.
3. **Grate shafts** every ~500px: a pale square on the floor with **bar shadows** struck across it
   (T5 — painted into the floor layer, so it is part of the ground). Pools of light in an unlit
   tube, and the natural place to stand and fight.
4. **The silt trap** at the foot: the one open room, with a low weir wall as cover.

### 4.3 COLD STORAGE — the cold room doors

*Descending staircase, north-west. **Holds the RIFLE.***

1. **Heavy insulated doors**, the hero object: a thick slab with a **chrome latch handle** drawn as
   two bright rects, and a **rime halo** on the floor in front of it. Most stand open, a few shut.
   The handle is the recognisable bit — 6px of bright metal that reads at a glance.
2. **A spine corridor** with the rooms off it, the one place on the map built from right angles and
   repetition.
3. **Rime at floor level on the walls** — a pale 3px line along the base of every wall in the
   sector, so it reads cold from any angle without changing the wall art.
4. **Strip curtains** at each room mouth: hanging vertical plastic strips, **drawn only, not
   sight-blocking** (§8).

### 4.4 THE KENNELS — the run

*S-step, north-centre. **Holds the SHOTGUN.***

1. **The run**: one long open lane wall to wall, the only straight retreat in the sector, and the
   whole tactical shape of the place — you fight in the pens and you leave by the run.
2. **Pens** either side: many small enclosures with 112px gates, the densest cover on the map.
3. **Chain fence rather than masonry** on the pen walls. Execution: a 1px mesh stroke (the same
   diamond pattern the escape's chainlink gate already uses) instead of a filled band, so the
   sector's **minimap silhouette is dotted where everything else is solid** — a free identity cue.

### 4.5 THE YARD — the gantry crane

*Hourglass with a tongue, north-east. **Holds the ROCKET and the SMG — the only two-gun sector.***

1. **The gantry crane. The landmark of the map.** Execution, and this is the one worth doing
   properly:
   - Two **leg footprints** ~600px apart, each with a T1 shadow.
   - A **spanning beam** drawn *between and above* them as a long flat band with a T2 offset of
     ~14px — the largest offset on the map, which is what makes it the tallest thing.
   - The beam draws **over the sector boundary wall** (T3), so it is visible from THE KENNELS and
     THE MOTOR POOL. This is the entire point.
   - A **hanging block** on a 2px cable, swinging on a slow sine — the only animated landmark.
   - T4 glyph: a small gantry outline on the minimap.
2. **The rail spur**, running west out of the sector through its tongue and into THE MOTOR POOL:
   two parallel rails with sleeper ticks, drawn into the floor layer (T5), and **flatcars** on it
   as long low solids forming lanes at an angle unlike anything else on the map.
3. **Container stacks**, seeded, in the north block: 40×20-ish solids in flat saturated colours
   (the one place the palette is allowed to be loud), each with a T2 top face. **These are the
   seed of the container maze** (§8) — building them now as ordinary stacks means step 5 is a
   density and layout change, not new art.

### 4.6 TURBINE HALL — the turbine

*Bracket opening east, wrapped around the keep's west arm. **Holds OVERDRIVE.***

1. **The turbine itself**: a large drum, the sector's hero — a wide flat cylinder body with **end
   caps** as two darker bands and a T2 top face. It sits across the bracket's spine so you must go
   around it.
2. **The generator** on a raised plinth in the bracket's mouth, facing THE BLOCKHOUSE. The Blackout
   restart (5s standing, from 2026-09-18) is a defend-the-point fight, and the bracket gives it
   exactly one mouth to watch — which the current random placement in a generic zone does not.
3. **Cable runs** converging on the plinth, painted into the floor (T5): thick dark lines that all
   point at the thing you have to defend. Wayfinding drawn as decoration.

### 4.7 THE BLOCKHOUSE — the keep

*Cross, centre. The start. **No wall-buy, no perk station** — you leave to arm yourself.*

1. The keep, the field manual, the horde switch, the first crate, unchanged.
2. **It borders six sectors.** "Which door first?" becomes a real opening decision with six
   answers. This is also why door pricing must change (§7).
3. **The four arms of the cross are the approaches**, each ending at a boundary — so the shape
   itself teaches the map: the sector you start in points at the ones you can buy into.

### 4.8 PUMP HOUSE — the pump bank

*Boot, the smallest sector. **Holds the FLAMETHROWER.***

1. **One machine hall.** Not a region you traverse — a **room you are in**, crossable in about four
   seconds. Deliberately the one sector that is a single space: nine regions that are all "an area
   with stuff in it" is the current failure, and one of them being a room is what makes the rest
   read as areas.
2. **The pump bank**: four housings in a row, each a body plus a **volute spiral** drawn as three
   nested arcs — the one curved motif on a map of right angles.
3. **Standing water** across the floor with discharge running through it, which is the visual link
   to THE SPILLWAY on the far side of the map.

A tiny hard-walled room is where a short-range cone is at its best and where the flamethrower's
340-round magazine is least punishing.

### 4.9 THE SLUICE YARD — the south wall

*Tee along the southern perimeter. **No gun** — it is the endgame's room.*

1. The sluice, both gate plates and funnel 1, at their existing fixed coordinates, in the stem.
2. **The south perimeter wall**, with **the escape gate set into it**. The heavy gate and chainlink
   gate built on 2026-09-19 currently sit in a wall that does not exist, at the bottom of a map
   that simply stops. Putting them in a wall is most of what makes the endgame legible.
3. **A flood channel** along the base of the wall, dry until THE FLOOD and then running — a payoff
   for the one moment the map is meant to feel overwhelmed.

### 4.10 THE MOTOR POOL — the bays and the bus

*Bracket with the Yard's rail spur through it. **No gun, two perk stations** — the richest sector
for perks and the poorest for guns.*

1. **Service bays in a row**, each a three-walled pocket off the main run: cover you duck into,
   with one way out — the exact opposite of the pens in THE KENNELS.
2. **The wrecked bus** across the eastern end: a landmark, a long piece of cover, and the thing
   that breaks the sector's one long sightline into two. Execution: a 240×60 body, **window band**
   as a row of dark rects, a T1 shadow, and a T2 top face — three fills and a loop.
3. **The fuel island** in the middle, carrying most of the map's barrels as its template already
   does.

---

## 5. Weapon and perk density varies by sector

Asked for: *"some areas can have slightly more weapons etc."* Today it is rigidly one gun in each
of six sectors and one perk station in each of eight. Now it is a **per-sector budget**, so a
sector can be worth travelling to:

| Sector | Guns | Perk stations | Why |
|---|---|---|---|
| THE YARD | **2** — ROCKET, SMG | 2 | Biggest sector, the maze's future home, and the furthest from the keep |
| COLD STORAGE | 1 — RIFLE | 1 | The cheap first upgrade, close to the start |
| THE KENNELS | 1 — SHOTGUN | 1 | |
| THE SPILLWAY | 1 — SNIPER | 1 | |
| PUMP HOUSE | 1 — FLAMETHROWER | 0 | Small, and it already holds a heavy gun |
| THE MOTOR POOL | 0 | **2** | The perk sector. Richest in barrels, poorest in guns |
| TURBINE HALL | 0 | 1 — OVERDRIVE | Always present, thematically the power |
| THE SLUICE YARD | 0 | 0 | The endgame's room; nothing competes with it |
| THE BLOCKHOUSE | 0 | 0 | You leave to arm yourself |
| | **6** | **8** | unchanged totals |

Totals are unchanged, so **no balance number moves** — only where they sit. The distribution is
the point: two sectors are worth a trip, two are deliberately bare.

---

## 6. The perimeter — and the spawner problem

Today `buildZoneWalls` emits no perimeter at all. The map's edge is invisible.

- **North and west — deep forest.** A 240px band of scattered trunk solids at low density, *inside*
  the map, no wall. Touches THE SPILLWAY, COLD STORAGE, THE KENNELS, THE YARD.
- **South and east — a hard concrete perimeter wall.** The escape gate is set into the southern
  one; THE YARD and THE MOTOR POOL back onto the eastern one.

### What will break if this is done carelessly

Off-map spawning is the fallback when no sector is cold. **Walling two sides removes half the
spawn frontier**, and a team camped in THE MOTOR POOL — far south-east, ~3,900px from the nearest
forest — would face a contact time far worse than anything measured. Same trap the zone cooldown
already hit: `CLAUDE.md` records a permanent "visited" flag doubling contact time to 25.6s exactly
when rounds should be hardest, which also made opening the map *easier*, backwards.

**Two mitigations, both needed:**

1. **The forest is a spawn reservoir, not an off-map region.** Being *inside* the map gives
   `pickSpawnPoint` a real source with real cover instead of "somewhere past the edge", and
   `z.entered` has less to do. Forest cells are cold unless a player is in or beside them.
2. **Culverts in the hard wall** — grated mouths at intervals along the south and east perimeter,
   at or above the 78px guarantee, drawn as pipe ends to rhyme with THE SPILLWAY. The wall stays a
   wall and the spawn frontier stays wrapped all the way around. Culverts also **telegraph** far
   better than the map edge: you can see the thing you are about to be flanked from.

**Measure before committing.** Re-run the contact-time benchmark (`CLAUDE.md` → "Pacing,
measured": 11.3s round 1, 12.8s late) from a camp in **every** sector. If MOTOR POOL or THE YARD
measure much worse than 12.8s, add culverts until they do not.

---

## 7. Floors: interior / exterior / unique

Asked for as a side note, and it is the change that will do the most for how the map reads:
*"limit drawing of floor tiles to interior spaces or only where they should apply. There should be
an interior / exterior / unique structure treatment."*

Today `drawZoneFloors` paints a sector's **entire rect** with one tile. So freezer tile runs across
open ground, carpet runs under a rail spur, and every sector is a flat wash of one texture. That is
why the areas still read faintly even after the 2026-09-18 floor pass.

**Three layers, painted in order:**

| Layer | What | Where |
|---|---|---|
| **EXTERIOR** | the sector's open-ground base — dirt, gravel, asphalt apron, concrete slab. Flat, low-contrast, little pattern | everywhere in the sector, first |
| **INTERIOR** | the existing per-template tiles — freezer tile, lino checker, floorboards, carpet, terrazzo | **only inside a room or building footprint** |
| **UNIQUE** | per-structure treatments — pipe invert and rib shadow, drain slab, diamond plate on the pump deck, rail sleepers, crane hardstanding, bay stripes | only under the structure that owns it |

**Mechanism.** The level already claims footprints (`claimFloor`, `keepClearRects`). Add a parallel
**`floorPatches = [{x, y, w, h, kind}]`**, pushed by whatever builds the room or structure, and
have `drawZoneFloors` paint exterior first and then the patches over it, culled to the view like
everything else. The tile *generators* in `zombie-floors.js` do not change at all — only **where**
they are painted, plus the new exterior and unique tiles.

This also fixes something that is a bug today: a building's interior and the ground outside it are
currently the same texture, so a wall is the only thing telling you that you are indoors.

---

## 8. The container maze — held, and why it is containers

Agreed to hold. When it comes, it is **a shipping container maze in THE YARD** (top right), not a
hedge maze — the user's call, and the better one:

- **The Yard already has container stacks** as a §4.5 structure, so the maze is a *density and
  layout* change to something already on the map, not new art and not a new sector.
- **Containers are solid and sight-blocking by being solid**, which sidesteps the whole problem a
  hedge maze has: sight-blocking-but-walkable needs a fourth notion of solidity (there are two
  solid grids, and bullets gained a third *view* on 2026-09-19 with `bulletBlockedAt`).
- Containers are **rectilinear**, so they cost the flow field nothing that walls do not already
  cost, and they can be laid out on the paint grid's own 400×300 rhythm.

**When it is built:** lanes at **160px, not 90** — a maze of minimum-width corridors is exactly the
geometry the flow field is worst at — and re-run the traversal measurement from `CLAUDE.md` →
"Measured again (2026-09-18)" for every type including the ULTRA HEAVY. The Yard holding the ROCKET
and the SMG (§5) is deliberate preparation: one gun for the lanes, one for what comes down them.

The strip curtains in COLD STORAGE (§4.3) are drawn-only for the same reason.

---

## 9. Consequences to work through

- **Door pricing.** `d.cost = 900 + 350 * max(ringA, ringB)` is ring distance in a 3×3. With
  irregular regions and a centre bordering six, "ring" means nothing. Replace with **graph
  distance from THE BLOCKHOUSE through door openings**, computed once at generation — which is
  what ring distance was approximating.
- **Six doors out of the keep** is a wider opening decision than two. Re-measure the round 1–5
  scrap curve.
- **`zoneBounds` callers must test `zoneOf`** — six sites, §2.
- **Funnel halls need 560 × 280 plus clearance.** PUMP HOUSE (5 cells) and TURBINE HALL (7, a
  bracket) cannot hold one. `planFunnelHalls` must exclude sectors that cannot fit a hall rather
  than discovering it through its fallback.
- **A connectivity assert at generation** — every region reachable from the centre through door
  openings. It is the check that would have caught the 2026-09-18 walled-off gate plate.

---

## 10. Sequencing — building 1 to 4

1. **The paint grid and the nine shapes**, existing template contents dropped in unchanged. Proves
   `zoneOf`, the boundary scan, the `zoneBounds` call sites and the connectivity assert. The step
   that can break the most.
2. **The perimeter and the culverts**, with the contact-time benchmark re-run from every sector.
   The only step that can break the spawner.
3. **Landmarks** — one hero structure per sector, using T1–T5, plus the minimap glyphs.
4. **Sector interiors and the three floor layers** — the rest of §4, and §7.
5. ~~The container maze.~~ **Built 2026-09-20.** Braided rather than perfect, 140px lanes, and
   it cost THE YARD one paint cell from THE KENNELS plus a rule that funnel halls stay out of the
   Yard. Details in `zombie/CLAUDE.md` → "The container maze".

Item 7 of the 2026-09-19 pass (guns and perks bound to sectors) is the prerequisite, and it landed.
