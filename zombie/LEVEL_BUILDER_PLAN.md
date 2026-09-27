# Zombie — level builder plan (2026-09-21)

> ## THE MAP EDITOR (2026-09-26). Open `Zombie.html?editor=1&solo=1`.
>
> Authoring moved onto the map itself, which is where it belongs: a building is only right or
> wrong in the place it stands.
>
> | | |
> |---|---|
> | **SPACE** | flip between PLAN (schematic: floors, solids, sector edges, the 20px grid) and DRAWN (the game's own renderer, with the light pocket off) |
> | **click** | place the selected stamp, snapped to the cell |
> | **right click** | delete the placement under the cursor |
> | **middle-drag** | pan. **wheel** zooms about the cursor |
> | **`[` `]`** | change stamp. **R** rotate, **M** mirror |
> | **G** | regenerate — every placement goes through the real generator |
> | **A** | authored-only: turn the seeded building placer off |
> | **T** | change tool: **stamp**, crate, barrel, wall-buy spot, perk-station spot, tree, culvert |
> | **A** | authored-only — **ON**: the map's buildings are the ones you placed |
> | **P** | authored-perimeter — with it on, only hand-placed trees and culverts exist |
> | **F** | freeze this seed's forest and culverts into authored props, to edit |
> | **E** | export every placement to the clipboard, to paste into `zombie-map-data.js` |
>
> The ghost under the cursor is **red when the placement would be refused, and says why** — it
> asks `stampBlockedReason()`, the same predicate the level places with.
>
> **The perimeter band is real ground now (2026-09-26).** The world is **5600x3500**, with the
> nine sectors occupying the same 4800x2700 they always did, at the same cell size, starting at
> (400,400). Buildings and props can be placed out there. `ZONE_CELL_W` comes from `MAP_INNER_W`
> rather than `WORLD_W`, which is what stops a bigger world stretching a sector — see
> `zombie/CLAUDE.md`, "THE WORLD IS BIGGER THAN THE SECTORS".
>
> ## THE MAP HAS A STARTING SET OF HAND-WIRED BUILDINGS (2026-09-26)
>
> **The seeded building placer is off** (`ZMAP.authoredOnly = true`), so the map's buildings are
> exactly these, the same on every seed. Sectors with none are a to-do list: the Pump House, plus
> the four that own their middles with their own geometry.
>
> `zombie-map-data.js` holds **ten** authored buildings — Cold Storage 2, the Blockhouse 3,
> Turbine Hall 2, the Sluice Yard 3 — and every one of them builds on every seed, checked by
> running the real generator over eight of them. Open the editor and move them, delete them,
> replace them with your own stamps. The seeded placer still fills the gaps until you press **A**
> (or set `ZMAP.authoredOnly = true`).
>
> What it did to the map, over 12 seeds: buildings **13.8 → 17.5** a map, sectors empty by
> accident **2.0 → 0.83**, TURBINE HALL **0.1 → 2.0** buildings a map, COLD STORAGE **0.8 → 2.4**.
>
> **Four sectors have none on purpose** — the Spillway, the Motor Pool, the Kennels and the Yard
> own their middles with storm runs, service bays, rolling stock and the container maze. A first
> draft that put three in the Spillway and one in the Motor Pool cost service bays (1.17 → 0.83)
> and put buildings back on painted drains, which is the defect the 2026-09-24 build-order fix had
> just removed. **THE PUMP HOUSE has none and that is not on purpose**: nothing in the library
> fits what is left of it. It wants a stamp drawn for it.
>
> ## PHASES 1-3 ARE BUILT (2026-09-26).
>
> **To hand-author a building:**
>
> 1. Open **`zombie/stamp-builder.html`** — double-click it, or serve it. Both work.
> 2. **Draw.** Pick a brush on the right (or press its key), drag on the grid to paint,
>    right-drag to erase. The gold lines are every 5 cells, so a 4-cell door is countable
>    by eye. `+ col/row` and `− col/row` resize; `rotate` and `mirror` turn it.
> 3. **Watch the CHECKS panel.** It is the same code the map runs, so a stamp that says
>    PASSES will build, and one that fails tells you which cell is wrong.
> 4. **Press `play it in the map`.** A tab opens with your drawing dropped into its sector
>    of the real map, solo, with you standing at its door. Walk in, shoot through the
>    window, see whether the doorway is where you want it. Redraw, press it again.
> 5. **Press `copy ZS.add block`** and paste at the end of **`zombie/zombie-stamps-data.js`**.
>    That is the save step; there is no database. Reload the game and it is in rotation.
>
> **What changed on the map the moment this landed** (24 seeds, `check-map-features.js`):
> buildings a map **3.1 → 16.3**, open-corner buildings **100% → 0%**, furniture on a wall
> **29% → 0%**, and the five sectors that got **no building on any seed** — centre, cold,
> kennel, pump, turbine — now all get them. Nav reachability held at 0.0102%.
>
> Phase 4 (whole sectors) is still a plan. The rest of this file is the original plan, kept
> because the reasoning is still what the code does.

**Status when written: plan only.** Written to answer the user's level-builder question.
The findings behind it are in `MAP_VISUAL_AUDIT.md`: the random placer drops most designed
features without saying so, and the buildings it does place are broken.

**What the user wants:** to hand-build and refine buildings first, then hand the rest over. So the
builder has to be usable by a person, not just a data format, and a building has to be playable
within seconds of being drawn.

**Order relative to the art direction.** If the FAITH-style direction (`MAP_VISUAL_AUDIT.md` §4)
is approved, do that restyle **before phase 2**. A stamp is much easier to judge when a wall is a
white block than when it is a per-sector textured surface. Phase 1 doesn't depend on the look.

---

## The stamp format

An ASCII grid on a **20px cell**. That matches `WALL_T` (20) and `NAV_CELL` (20), so one character
is exactly one wall thickness and one nav cell. Nothing gets rounded between what you draw and
what the flow field sees.

```
stamp: cold-store-A
tags: cold, building
rotate: any
size: 16x11
################
#s......#......#
#s......#......#
#.......D......W
#.......D......W
#.......D......#
#..dd...#..rr..#
#..dd...#..rr..#
#.......#......#
#.......#......#
####DDDD########
```

| Char | Meaning | Becomes |
|---|---|---|
| `#` | wall | `walls[]` (runs merged into rects, so a straight wall is one rect, not 16) |
| `D` | door opening | a gap. **Minimum 4 cells = 80px**, over the 78px nav guarantee (`2*NAV_CELL + 2*NAV_PAD`) |
| `W` | window | `barricades[]`, hp 60, same as today |
| `.` | interior floor | interior floor patch; walkable |
| ` ` | outside the stamp | untouched, so a stamp can be L- or U-shaped with no "bite" hack |
| `s` `d` `b` `r` `c` | stairs, desk, bench, racking, chair | `room.decor[]`, drawn only (no collision), exactly as today |
| `$` `P` `?` | wall-buy slot, perk slot, loot/crate slot | **candidate** spots. The generator picks which ones get used |

**One cell is the smallest thing you can draw**, so a stamp can't express a 92px door
(`BUILD_DOOR`) or a 44px window (`BUILD_WINDOW`). Stamps use **80 or 100** for doors and
**40 or 60** for windows (approved 2026-09-24). Before phase 1 ships, confirm that the nav grid
treats a 40px window barricade as passable for zombies the way it treats 44 today. If it doesn't,
windows are a 3-cell minimum.

**The number of boards follows the opening's length, so a board is always the same size**
(the user's condition on those sizes). This is already true in the game as of 2026-09-24:
`barricadePlanks()` in `zombie-level.js` divides the span by a fixed 32px pitch, clamped to 2-6,
instead of the flat 4 it used to draw. A 2-cell stamp window gets 2 boards and a 5-cell rail gate
gets 5, at one board size. The renderer and `bulletBlockedAt` both read that one function, so the
gap you can see stays the gap you can shoot through.

Rotation is done by the loader (90° steps plus mirror), not by drawing four copies.

## Built-in checks (run by the loader, the builder, and a `scripts/check-*` script)

1. **Closed walls.** A flood fill from outside the stamp must not reach any `.` except through a
   `D` or a `W`. This is exactly the test today's bitten buildings fail 95% of the time.
2. **Furniture inside.** Every decor character must be enclosed by the same flood fill. This is
   the check the 26% of furniture on walls and the 23% of stairs outside would fail.
3. **Minimum openings.** Every `D` run is at least 4 cells. Every gap between two walls is either
   0 or at least 4 cells, **never in between**. That is the `KENNEL_END_GAP` rule from `CLAUDE.md`:
   a gap must be closed or walkable.
4. **At least one door**, and no room inside the stamp that you can only reach through a window.
5. **At placement:** the stamp's footprint is fully `inZone` for its sector and clears hard
   reserves. A stamp that fails is **counted and reported**, never silently skipped.

## Built, and where it lives (2026-09-26)

| File | What |
|---|---|
| `zombie/zombie-stamps.js` | the format, the checks, rotate/mirror, and `ZS.build()` — one description of what a stamp becomes, used by both the builder's preview and the level |
| `zombie/zombie-stamps-data.js` | **the library you paste drawings into.** Four starter stamps |
| `zombie/stamp-builder.html` | the editor: paint, live checks, preview, playtest, copy |
| `zombie/zombie-sandbox.js` | `?sandbox=1#stamp=…` — drops a drawing into the real map |
| `placeStampAt()` in `zombie-level.js` | places one, ahead of `makeBuilding`, which stays as the fallback |

**Three things were measured rather than assumed while building it**, and each one is a rule
any future stamp work inherits:

- **Stamps are snapped to the 20px cell.** Unsnapped, an 80px door landing 11px off the nav
  lattice loses its clear column to grid alignment, and the flow field cannot enter the
  building at all: on seed 1137 the whole inside of one hut was sealed to zombies while
  being perfectly walkable to a player.
- **`STAMP_CLEAR` is 90, not 40.** At 40 two stamps could stand 40px apart, which is half the
  78px nav guarantee — a gap that is neither closed nor walkable. Map-wide unreachable cells
  went 0.0010% → 0.3263% until it was raised, and the same clearance had to apply against
  walls as well as reserves.
- **The blanket boundary margin had to go.** `nearZoneBoundary` reserves 150px inward from
  every boundary, which in COLD STORAGE's three-row arms is the whole arm; it was the single
  biggest rejection reason in five of nine sectors (3,012 in cold alone). Stamps measure 90px
  from the **openings themselves** instead, exactly as THE KENNELS already did.

**Rejections are counted, not swallowed:** `stampMisses` records why each attempt failed, per
sector — zone, boundary, reserved or solid. The habit this whole system exists to end is
silent skipping, and a placer that cannot say why it placed nothing has the same defect.

## What already existed before it

`scripts/check-map-features.js` (2026-09-24) generates maps headlessly and counts what actually
got built: open-corner buildings, furniture on walls or outside the shell, buildings a sector,
service bays, buildings standing on a drain, and the landmark/gun/station/door invariants. It
runs over the **real** generation code through `scripts/zombie-headless.js`, a vm harness that
loads the page's own scripts.

It is the check the stamp work has to move: today it records 100% open corners, ~29% of furniture
on a wall and **five sectors that get no building on any seed**. The same script measures whether
stamps fixed them.

## Phases and effort

Estimates are in sessions of this kind of work, including verification by rendered image.

### Phase 1 — stamp format + loader · **BUILT 2026-09-26**
- `zombie-stamps.js`: the parser, rotate/mirror, the checks above, and `placeStamp(stamp, x, y,
  rot)` writing `walls`, `barricades`, `buildingRooms[].decor`, floor patches and reserves. This
  is a new classic script, so run the collision checker.
- Shipped wider than planned: stamps are used in **every** sector that has one, with
  `makeBuilding` as the fallback. Cold Storage was the test case and now averages 1.0 a map
  with its own three stamps; the `any`-tagged hut fills the rest.
- Deterministic: stamp choice and position still come from `MP.random()`, so every client builds
  the same map.
- **Done means:** rendered crops show closed buildings with furniture inside, and the counts show
  the Cold Storage target actually being met.

### Phase 2 — the builder page · **BUILT 2026-09-26**
- `zombie/stamp-builder.html`, in the repo and `file://`-safe. Classic scripts, no server needed.
- A grid you paint and erase: pick a character from a palette, drag to paint, right-drag to
  erase, resize the grid, rotate, mirror.
- The checks run live, with failures outlined in red on the grid.
- It renders the stamp with the game's own draw functions, so what you see is what the map gets.
- **Export:** copy to clipboard, or download a `.txt`. Import by paste.
- *Not built:* saving through the dev server. Clipboard and download cover it, and a save
  path that only works under the dev server is one the group cannot use on `file://`.

### Phase 3 — sandbox playtest · **BUILT 2026-09-26**
- `Zombie.html?sandbox=1&solo=1#stamp=<encoded>` drops the stamp into **the real map**, not an
  empty arena — a building only tells you anything beside the ground it will stand on, its
  sector's doors and real sightlines. It is placed ahead of the generic buildings so it gets
  first pick, and if it is too big for the sector's clear ground it is **placed anyway, with
  the note saying so**: you cannot see what is wrong with a building you cannot look at.
- `&zombies=0` starts with spawning off; L+G's dev panel toggles it back on, along with FREE
  BUYS and the spawn-a-type buttons that were already there. A dedicated horde button was not
  built — the panel's spawn controls already do it.
- A **"playtest" button in the builder** opens it in a new tab. Draw, click, play, back to
  drawing, in seconds.
- The hash, not the query string, carries the stamp, so it never reaches a server log.

### Phase 4 — full sector authoring · **STARTED 2026-09-26**

Buildings are authored map-wide now (`zombie-map-data.js` + the editor above), and
`ZMAP.authoredOnly` already retires the seeded building placer. What is still seeded: sector
shapes, floors, boundary doors and prices, landmarks, the container maze, the Kennels' stock, the
Spillway's runs, crates, barrels, wall-buys, perk stations. The rest of this section is what is
left.

### Phase 4 (original) — **L, 3+ sessions, and it depends on the design talk**
- Sectors are authored as larger stamps, or as a sector layout that places named stamps. This
  covers pipe runs, motor bays and the container maze as well as buildings.
- **The generator shrinks to "pick variants and loot"**: which of N authored variants each sector
  uses, which `$`/`P`/`?` slots are live, door and window prices. It stops placing geometry.
- This is where the CoD Zombies direction lands (`MAP_VISUAL_AUDIT.md` §4.2). Maps you learn over
  many runs *require* fixed geometry.
- It retires most of `buildZoneContents`, `buildSectorInteriors`, `buildKennels` and the maze
  placer. Every measurement in `CLAUDE.md`'s "Measured" sections has to be redone.

**Estimated 3–4 sessions to phase 3; it took one.** The estimate was honest about the work
and wrong about the order: phases 2 and 3 are small once `ZS.build()` exists, because the
builder's preview and the sandbox both read that one description instead of re-implementing
what a stamp means.

## Hand-over point

After phase 3 the user can build and refine buildings alone. The builder plus sandbox is the
whole loop. Phase 4 starts when they hand a set of stamps back and the map-design questions from
the CoD Zombies direction have answers.
