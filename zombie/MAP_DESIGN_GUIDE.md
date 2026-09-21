# Zombie — Map, Sector & Flow Design Guide

Written 2026-09-20 against `zombie-level.js`, `zombie-floors.js` and `zombie-render.js` as they
exist at commit `e786ed5`. Companion to the root `AESTHETIC_GUIDE.md`, which owns *how the game
looks*; this document owns **how the map is shaped, what each sector is for, and what the sectors
do for each other**.

**Everything measured here was measured, not remembered.** Sector areas, adjacency, ring depth,
building density, boundary-run counts and floor-tint separation all come from scripts run against
the real `ZONE_PAINT` and the real tables. Where a number appears, it is reproducible.

Like `AESTHETIC_GUIDE.md`, **this is a design document. Nothing in §4–§6 is implemented.** §1–§3
describe what is there today.

---

## 0. The one-paragraph version

The map's skeleton is sound: nine named sectors, a fixed centre, a fixed escape, one hero
structure each, and a per-sector floor system that is the best visual idea in the game. What is
wrong is **distribution**. The east half of the map holds three guns and four perks; the west half
holds one and one — over *exactly the same 35 cells*. Six of eight outer sectors touch the start
room, so the whole economy has only two door prices. The Yard alone carries two guns, two perks,
the crane and the container maze behind a single 1,250 door. Shape variety is not a matter of
taste: **no sector on the current grid can physically hold an L, S or H** — no bounding box is
5×5 — and that is a property of the 12×9 paint, not of the painter. And the nine floor tints,
which exist to tell sectors apart, span **7.5 points of lightness across the entire map**, with
five adjacent pairs closer than ΔE 12. The fixes are cheap and mostly structural: a finer paint
grid (costs **+2 boundary runs**), one repainted cell that moves the rocket from ring 1 to ring 2,
and a floor palette re-solved for separation instead of mood.

---

## 1. What the map is today (measured)

`WORLD_W × WORLD_H` = **4800 × 2700**. `ZONE_PAINT` is a **12 × 9** grid of 108 cells, each
**400 × 300** world px. Nine sectors. `Z_BLOCKHOUSE` is ring 0 by definition; every other sector's
ring is its BFS distance from it over *doored* boundaries.

| id | sector | cells | area % | bbox | fill % | ring | nbrs | guns | perks | buildings | bld/cell |
|---|---|---|---|---|---|---|---|---|---|---|---|
| 0 | THE SPILLWAY | 18 | 16.7 | 4×7 | 64% | **2** | 3 | sniper | 1 | 3 | 0.17 |
| 1 | COLD STORAGE | 9 | 8.3 | 4×3 | 75% | 1 | 4 | rifle | 1 | 11 | **1.22** |
| 2 | THE KENNELS | 8 | 7.4 | 3×3 | **89%** | 1 | 3 | shotgun | 1 | 2 | 0.25 |
| 3 | THE YARD | **19** | **17.6** | 3×8 | 79% | 1 | 4 | **rocket + smg** | **2** | 3 | 0.16 |
| 4 | THE BLOCKHOUSE | 14 | 13.0 | 6×4 | 58% | 0 | **6** | — | 0 | 3 | 0.21 |
| 5 | TURBINE HALL | 7 | 6.5 | 3×3 | 78% | 1 | 4 | — | 1 | 2 | 0.29 |
| 6 | PUMP HOUSE | **5** | **4.6** | 4×2 | 63% | 1 | 3 | flamer | 0 | 4 | 0.80 |
| 7 | THE SLUICE YARD | 17 | 15.7 | 7×3 | 81% | 1 | 4 | — | **0** | 5 | 0.29 |
| 8 | THE MOTOR POOL | 11 | 10.2 | 5×3 | 73% | **2** | 3 | — | 2 | 7 | 0.64 |

**Boundaries, by shared cell-edges.** 39 merged runs in total:

```
7  BLOCKHOUSE <-> TURBINE HALL      3  KENNELS <-> YARD
7  YARD <-> MOTOR POOL              3  PUMP HOUSE <-> MOTOR POOL
6  SPILLWAY <-> TURBINE HALL        3  SLUICE YARD <-> MOTOR POOL
5  YARD <-> PUMP HOUSE              2  COLD STORAGE <-> KENNELS
5  SPILLWAY <-> SLUICE YARD         2  COLD STORAGE <-> BLOCKHOUSE
4  SPILLWAY <-> COLD STORAGE        2  COLD STORAGE <-> TURBINE HALL
4  KENNELS <-> BLOCKHOUSE           2  BLOCKHOUSE <-> SLUICE YARD
4  BLOCKHOUSE <-> PUMP HOUSE        1  YARD <-> BLOCKHOUSE      <- one cell
                                    1  TURBINE HALL <-> SLUICE YARD
```

**Door pricing** is `900 + 350 × max(depth)`, so ring 1 = **1,250** and ring 2 = **1,600**.

---

## 2. Critique — function

### C1 · The east is rich and the west is poor, over identical ground ★ the headline

| | cells | % of map | guns | perks |
|---|---|---|---|---|
| **East** — Yard + Pump House + Motor Pool | **35** | 32.4% | **3** | **4** |
| **West/south** — Spillway + Sluice Yard | **35** | 32.4% | **1** | **1** |

Exactly the same area. Three times the guns, four times the perks. Nothing in the fiction explains
it and nothing in the pacing needs it. A player who opens west is playing a materially poorer game
than one who opens east, and the map gives them no way to know that in advance.

### C2 · The Yard is the entire game for 1,250

One ring-1 door buys: the **rocket** (7,500), the **SMG** (3,400), **two** perk stations, the
**gantry crane**, the **container maze**, an outpost, and the largest sector on the map. Nothing
else comes close. This is the single strongest argument in the document, because it is not a
balance opinion — it is a list.

### C3 · There are only two prices in the economy

Six of the eight outer sectors are ring 1. The door formula can express depth, and the map gives
it almost nothing to express: **1,250 or 1,600**, a 28% spread end to end. Ring depth is doing no
work, so "pushing deeper" has no cost curve behind it.

### C4 · Two sectors are 28.7% of the map with no economy at all

**THE SLUICE YARD** is 15.7% of the map with zero guns and zero perks. **THE BLOCKHOUSE** is 13.0%
and is spawn, which excuses it. The Sluice Yard's only draw is the escape gate, which matters in
the last sixty seconds of a run that reaches it. For everything before that it is ground you cross.

### C5 · The Pump House is a vending machine, not a place

5 cells (4.6%, the smallest), zero perks, four buildings crammed in at 0.80/cell, and one very
expensive gun. You go there once, buy the flamethrower, and never return. A sector should be
somewhere you *fight*; this one is a shop.

### C6 · Building density varies 7.6× and not on purpose

Cold Storage runs **1.22 buildings per cell**; the Yard and the Spillway run **0.16–0.17**. Some of
that spread is deliberate and good — the Yard's "buildings" are containers, the Kennels' are rail
cars, and both were deliberately reduced so those features fit. But **the Spillway has no such
excuse**: 18 cells, `corridors: true`, and three buildings. It is the emptiest ground in the game.

### C7 · The rail spur cannot exist ★ a real contradiction

The Motor Pool's flatcars and the Kennels' rail cars **share artwork** so that "the spur visibly
runs between them" (`zombie-level.js`, 2026-09-20). **The two sectors are not adjacent.** Kennels
touches Cold Storage, the Blockhouse and the Yard; the Motor Pool touches the Yard, the Pump House
and the Sluice Yard. The shared art implies one rail line across a gap it never crosses.

### C8 · The water story is split

Three sectors are water: **Spillway**, **Sluice Yard**, **Pump House**. Spillway↔Sluice are
adjacent and read correctly. The Pump House touches the Yard, the Blockhouse and the Motor Pool —
three dry industrial sectors — and touches neither of the other two. The one coherent run that
*does* work is Spillway → Turbine Hall: water feeds the turbines, and they are adjacent.

### C9 · The Motor Pool's one-cell peninsula

Cell (row 7, col 11) is Motor Pool, surrounded by Yard on two sides and reachable only from below.
It reads as a paint slip rather than a feature. It is either a deliberate alcove — in which case it
should hold something — or it should go.

---

## 3. Critique — shape

### C10 · No sector on this grid can hold an H. This is proven, not asserted.

An H needs a bounding box of at least **5 × 5**: two spines, a gap between them, and a crossbar.
Its two notches must also open onto a *real neighbour*, because a notch enclosed on three sides
would be an island of another sector — which `assertZoneConnectivity` rejects.

| sector | bbox | 5×5? |
|---|---|---|
| SPILLWAY | 4×7 | no |
| COLD STORAGE | 4×3 | no |
| KENNELS | 3×3 | no |
| YARD | 3×8 | no |
| BLOCKHOUSE | 6×4 | no |
| TURBINE HALL | 3×3 | no |
| PUMP HOUSE | 4×2 | no |
| SLUICE YARD | 7×3 | no |
| MOTOR POOL | 5×3 | no |

**Nine of nine fail.** At 108 cells over nine sectors the average sector is 12 cells; a 5×5 box is
25. The grid is simply too coarse. This is why "more L, S and H shapes" has not happened — not for
want of trying, and not a question of taste.

**Edge-locked sectors are further constrained.** A sector against the map border can be a **C**, an
**E** or a **comb**, but never an **S** or a **Z**, because an S needs to bulge *both* ways and one
way is off-map. That rules the Spillway (west edge) and the Sluice Yard (south edge) out of S/Z
permanently, at any grid resolution.

### C11 · Only three sectors are meaningfully irregular

Fill % is the honest measure. Blockhouse 58%, Pump House 63% and Spillway 64% are genuinely
non-rectangular. Kennels at **89%**, Sluice at 81%, Yard at 79% and Turbine at 78% are rectangles
with a nibble taken out.

### C12 · Boundary length varies 7×, and the opening rule doesn't know

`emitBoundary` sets `winCount = clamp(floor(span / 700) + 1, 1, 3)`. A 7-cell boundary and a 1-cell
boundary therefore get very different opening densities — correctly — but the *door* is always
exactly one, placed in a random slot. On the 1-cell Yard↔Blockhouse boundary that door is a
300–400px wall's entire character.

---

## 4. Critique — visuals

### C13 · The floor system is the best idea in the game and it is being wasted ★

`zombie-floors.js` is genuinely excellent: per-zone 64² texel tiles, chunky at 2 world units a
texel, a quantized three-step grime map over the top, and a real interior/exterior/unique split
(`ZONE_INTERIOR`, `ZONE_EXTERIOR`, plus `hardstand` under every landmark). The architecture is
right. **The palette driving it is not.**

Measured in CIELAB (ΔE76) over the nine `ZONE_FLOOR_TINT` values:

| | value |
|---|---|
| **L\* range across the whole map** | **23.3 → 30.7 = 7.5 points** |
| mean ΔE, adjacent sector pairs | 16.9 |
| **min ΔE, adjacent pairs** | **5.5** (Spillway / Cold Storage) |
| **adjacent pairs under ΔE 12** | **5 of 17** |
| min ΔE, any pair | 2.2 (Turbine Hall / Pump House) |

Two conclusions:

1. **Every floor in the game sits inside a 7.5-point lightness band.** The tints are asked to do
   all their work in hue and chroma alone, at very low chroma, in a dark scene lit by a 340px
   pocket. Lightness is the one channel that survives those conditions and it is unused.
2. **The system fails at nearly a third of the boundaries it exists to mark.** Spillway/Cold
   Storage at ΔE 5.5 are the same colour at a glance, and they share a 4-cell border.

Turbine Hall and Pump House at ΔE 2.2 are effectively one tint occupying two of nine slots.

### C14 · The height ladder works — and nothing navigates by it

The `lift` values encode a real skyline: crane **16**, silo **14**, standpipe **13**, chiller
**12**, turbine **10**, pumps **7**, bus **5**. Landmarks draw after walls and cull to the *view*,
so the crane is visible from the next sector. That is a genuinely good system (the root guide
already recommends stealing it for other games). But nothing *guarantees* a landmark is visible
from anywhere useful — placement is a random spot with a shrinking clearance. The map has a
skyline and no sightlines.

### C15 · Floors are keyed per sector; walls are not

Nine floor treatments, one wall treatment. The walls are the most-seen surface in a top-down game
with a small light radius — you are usually looking at a corridor — and they carry no sector
identity at all.

---

## 5. Synergy — what the sectors do for each other

The adjacency graph is a design object and is currently accidental. What works, what doesn't:

**Works.** Spillway → Turbine Hall (water feeds power, adjacent). The gantry crane straddling the
container maze in the Yard — that is literally what a gantry crane is for, and it doubles as the
landmark you navigate the maze by. The Blockhouse as a 6-neighbour hub.

**Doesn't.** The Kennels/Motor Pool rail spur that crosses a sector it never touches (C7). The Pump
House stranded among dry sectors (C8). The Sluice Yard as 15.7% of the map with nothing in it until
the endgame (C4).

**The tension worth naming.** Theme wants the three water sectors adjacent. Legibility wants them
apart — three teals sharing borders is exactly what produced the ΔE 5.5 failure. **Resolve it by
material, not hue:** wet concrete, standing water and rusted pipework differ in *value and texture*
at the same hue, and `ZF_PAINTERS` already has the per-zone hooks to express that. Do not solve a
material problem in the tint table.

---

## 6. Proposals — itemized

Effort: **S** = under an hour · **M** = a session · **L** = its own session with a plan file.

### P1 · Refine the paint grid 12×9 → 24×18 ★ the one that unlocks the rest · **M**

432 cells at 200 × 150 px. **Measured cost: +2 merged boundary runs (39 → 41)** for a complete
redesign, because `zoneBoundaryRuns` already merges collinear cells — a 2× upsample of the
*current* shapes produces **exactly 39 runs, unchanged**. The finer grid is free until you spend it.

A validated proposed repaint (connectivity checked, keep containment checked, sluice room and south
gate checked, all clean):

```
      0         1         2
      0123456789012345678901234
  0   SSSSSSCCCCCCCCKKKKYYYYYY
  1   SSSSSSCCCCCCCCKKKKYYYYYY
  2   SSSSSSSSCCCCKKKKKKYYYYYY     <- Cold Storage's west notch
  3   SSSSSSSSCCCCKKKKKKYYYYYY        and east notch: a true H
  4   SSSSSSCCCCCCCCKKKKYYYYYY
  5   SSSSSSCCCCCCCCKKKKYYYYYY
  6   SSSSTTTTTTBBBBBBKKYYYYYY
  7   SSSSTTTTBBBBBBBBKKYYYYYY     <- Kennels' tail breaks Yard<->Blockhouse
  8   SSSSTTTTBBBBBBBBPPPPYYYY
  9   SSSSTTTTBBBBBBBBPPPPPPYY
 10   SSSSTTTTTTBBBBBBPPPPPPYY
 11   SSSSSSTTTTTTBBBBPPPPPPYY
 12   SSSSSSLLLLLLLLMMMMMMMMYY
 13   SSSSSSLLLLLLLLMMMMMMMMYY
 14   LLLLLLLLLLLLLLMMMMMMMMMM
 15   LLLLLLLLLLLLLLMMMMMMMMMM
 16   LLLLLLLLLLLLLLMMMMMMMMMM
 17   LLLLLLLLLLLLLLMMMMMMMMMM
```

| | current | proposed |
|---|---|---|
| sectors able to hold an H/S | **0 of 9** | **8 of 9** |
| merged boundary runs | 39 | 41 |
| largest / smallest sector | 3.8× | 3.5× |
| Yard ring | 1 | **2** |

### P2 · Cold Storage becomes a true H · **S**, once P1 lands

Rows 0–5, cols 6–13: full width, a 4-cell waist at rows 2–3, full width again. The west notch opens
into the Spillway, the east into the Kennels — both real neighbours, so nothing is islanded. Two
cold halls joined by a loading corridor, which is what a cold store *is*, and the waist is the
claustrophobic pinch the map otherwise only gets from the container maze.

### P3 · Repaint one cell and move the rocket to ring 2 ★ best effort-to-effect on the list · **S**

Today `(row 3, col 8)` is the **only** cell where the Yard touches the Blockhouse. Paint it
`Z_KENNELS` and:

| | now | after |
|---|---|---|
| Yard ring | 1 | **2** |
| cost to own the rocket | 8,750 | **10,350** (+18%) |
| Kennels fill % | 89% (a square) | 75% (a staircase) |
| boundary runs | 39 | 40 |
| anything disconnected | — | **no** |

One cell fixes C2 and C11 at once, and **it works on the current grid today** — it does not wait
for P1.

### P4 · Move the SMG out of the Yard into the Sluice Yard · **S**

Fixes C1 and C4 together. The Sluice Yard gets its own reason to exist before the endgame, and the
player learns the escape ground early instead of arriving there cold on the run that matters.
East/west guns go 3:1 → 2:2.

### P5 · Give the Pump House a perk, or fold it · **S**

At 5 cells it is the only sector with no perk. Either give it one — it is the natural home for a
burn/fuel perk next to the flamethrower — or merge it into the Yard and redistribute. As it stands
it is a shop with a door charge.

### P6 · Run the rail spur Kennels → Yard → Motor Pool · **M**

Fixes C7, and it is the best *visual* idea in the document. The Yard already has containers and a
gantry crane; a gantry crane exists to move containers between a rail head and a stack. Draw the
spur as continuous track across all three sectors and the eastern half of the map gains a spine —
one readable line tying the three industrial sectors into one place instead of three.

### P7 · Re-solve the floor tints for separation · **S** (table change only)

Constraints used: keep each sector's hue family within 32°, chroma ≤ 22, L\* held inside a dark
18–34 band so nothing reads as "lit" in a 340px pocket.

| | current | solved |
|---|---|---|
| min ΔE, adjacent pairs | 5.5 | **23.2** (+322%) |
| mean ΔE, adjacent pairs | 16.9 | **32.1** (+90%) |
| adjacent pairs under ΔE 12 | **5 of 17** | **0 of 17** |
| L\* range | 7.5 | 16.0 |
| min ΔE, any pair | 2.2 | 16.3 |

```
spill: "#2C2C2C", cold: "#004758", kennel: "#614D2E", yard: "#48201B",
centre: "#173217", turbine: "#494E71", pump: "#0B2E4C", sluice: "#145955",
motor: "#342F0D"
```

**Two honest caveats.** The solver greyed the **Spillway** to `#2C2C2C` — at very low chroma the
hue lock stops meaning anything, and the Spillway lost its teal. It is the hardest slot precisely
because it touches both other water sectors (C8, §5). Hand-set it and re-measure. And these are
*tints*, not final pixels: `ZF_PAINTERS` mixes several flat colours per zone on top, so the shipped
contrast will differ — re-measure against rendered tiles, not the table.

Running the solver without the dark band reaches **+436%** min ΔE, but it pushes tints bright
enough to read as lit floor and breaks the mood. The 18–34 band is the recommendation; the 436%
figure is only there to show the headroom is real.

### P8 · Per-sector wall treatment · **M**

Nine floors, one wall. Give each sector a wall palette and capping detail drawn from the same tint
family as its floor — the surface you actually look at down a corridor should tell you where you
are. Cheapest version: tint the existing 2px highlight per sector, which costs one lookup in
`drawWalls`.

### P9 · Guarantee one landmark sightline per sector · **M**

Make `addLandmark` prefer spots with clear line of sight to at least one of the sector's own door
openings. The height ladder (C14) already works; this is what turns it into navigation — you see
the crane through the door and you know which way you are facing.

### P10 · Building density targets, expressed per cell · **S**

Replace the flat `buildings:` count with a per-cell target so the number scales with the sector.
Cold Storage's 1.22/cell is a warren and should stay one; the **Spillway at 0.17 over 18 cells is
the emptiest ground in the game** and should roughly double.

### P11 · Decide about the one-cell peninsula · **S**

(row 7, col 11). Either make it an alcove worth finding — a crate, a card station, one perk — or
paint it Yard and let the boundary run straight.

### P12 · Add a fourth floor treatment: **threshold** · **S**

The interior/exterior/unique triad is right and there is an obvious fourth. Every door and window
opening gets a short worn patch — scuffed, grime-heavy, a different tile — across the boundary. It
marks the openings without a HUD, it reads as wear where everything walks, and it is the one place
on the map where two sectors' floors meet and currently just abut.

---

## 7. Flow — the shape of a run

What the map asks of a player, in order:

1. **Spawn in the Blockhouse.** One crate, the field manual, the intensify switch in the east
   corner. Six ways out — more choice than a first round should offer, but the keep's two
   barricades hold the shape.
2. **Open one ring-1 door (1,250).** Six of eight sectors are one door away, so this choice is
   wide and almost unpriced (C3). In practice it is the Yard, because the Yard is everything (C2).
3. **Buy a gun.** Rifle 1,500 in Cold Storage is the real first purchase; everything else is a
   round or three away.
4. **Turbine Hall for the generator**, which gates every perk station on the map.
5. **Ring 2 — Spillway or the Motor Pool.** The only two sectors that cost 1,600, and between them
   they hold one gun.
6. **The Sluice Yard and the south gate.** Crossed all game, meaningful once.

**The shape of that is front-loaded.** The richest, cheapest and largest sector is one door from
spawn, and the two sectors you reach last are the two thinnest. P3 and P4 together invert enough of
that to give the run a direction.

---

## 8. What must survive contact

- **`2*NAV_CELL + 2*NAV_PAD` = 78px minimum opening.** Every proposal here keeps it. A finer paint
  grid (P1) does not change opening widths — `emitBoundary` slots are computed from run length, not
  cell size.
- **Sector identity and position are learned.** "The crane is in the Yard and the Yard is the
  north-east" is the payoff of the fixed skeleton. P1 preserves every sector's position and
  neighbourhood; it only changes silhouettes. **P5's fold and any swap of Turbine/Pump would break
  this and are flagged accordingly.**
- **The keep is at fixed world centre** (620 × 420 at 2400, 1350) and the **sluice room** at
  (2170, 2170)–(2630, 2490) with the escape gate in the south wall. The P1 grid was validated
  against all three; it passes.
- **`MP.random()` for anything that must match across clients**, `Math.random()` only for host-only
  rolls and cosmetics.
- **Furniture has no collision, deliberately** — a 30px table behind a 92px door is exactly the
  geometry that makes nav pockets.

---

## 9. What this guide does not settle

- **Whether the map should be nine sectors at all.** Every measurement here is conditional on nine.
  Twelve smaller sectors on the 24×18 grid would make ring depth mean something without P3, and
  would also dilute the landmark-per-sector rule that currently pays for itself.
- **Whether the Pump House and Turbine Hall should swap.** It fixes the water chain and puts power
  next to the crane and the vehicles — both coherent — at the cost of moving the generator, which
  is learned geography and a core mechanic. Named in §5, not proposed in §6, for that reason.
- **Whether the container maze wants a second instance.** The Kennels is sparse (3–5 pieces) for
  structural reasons — eight cells with a 150px door reserve on every boundary. P1 would relieve it
  without touching the placement code, which is the cheapest test of whether that sparseness was
  ever a density problem or only a geometry one.
- **Nothing here is balance-tested.** P3 raises the cost of the rocket by 18% and P4 moves a gun
  across the map; both change pacing in ways only a playtest settles.

---

**Not tracked by `check-doc-sync.js`.** `AESTHETIC_GUIDE.md` is, and this document is its
counterpart, so registering it is probably right — but that is a change to `scripts/`, and it
should be a deliberate one rather than a side effect of writing the guide. Until then this file
carries no stamp, because a stamp nothing checks is worse than no stamp.
