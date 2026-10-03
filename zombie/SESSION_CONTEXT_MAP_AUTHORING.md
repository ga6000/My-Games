# Context — map authoring, nav and the map editor (sessions of 2026-09-21 → 09-26)

**Which game:** ZOMBIE, the hub game (`THE_SPLIT.md`). Everything here is arcade-side.
**Which finish-line item:** `HUB_RETROSPECTIVE.md` §5 item 2 — "ZOMBIE is at its v1".
**What this file is:** a compaction of one long session's work, written to be read alongside other
session contexts before a phasing plan is made. **It is not a plan and contains no phasing.**

All of it is committed and pushed on `main`: `07bd197`, `c0cc836`, `910ef07`, `322f279`,
`b47d940`, `c6a9811`, `d0d453e`, `70f2f99`, `8f51ad2`, `76c40cb`, `f1e7e56`, `5d81ddd`.

---

## 1. What was built, in one line each

| | |
|---|---|
| **Stamps** | Buildings drawn as text on a 20px grid. `zombie-stamps.js` (format, checks, `ZS.build`), `zombie-stamps-data.js` (the library) |
| **Stamp builder** | `zombie/stamp-builder.html` — paint a building, live checks, preview, playtest, save |
| **Sandbox** | `Zombie.html?sandbox=1&solo=1#stamp=…` (`zombie-sandbox.js`) — drops a drawing into the real map at its door |
| **Map editor** | `zombie/map-editor.html` → `Zombie.html?editor=1&solo=1` (`zombie-mapedit.js`) — whole map, PLAN/DRAWN, side palette, 13 tools |
| **Authored map** | `zombie-map-data.js` (`ZMAP`) — buildings, props, loose cells, sector-paint edits, four mode flags |
| **Nav** | Two grids by body size; flow field seeded from a passable cell |
| **World** | A 400px perimeter band outside the sectors, which keep their exact size and cell grid |
| **Checks** | `scripts/check-map-features.js` + `scripts/zombie-headless.js` (vm harness over the real scripts), `scripts/measure-zombie-nav.js` |

## 2. Why any of it exists

A 40-seed audit (`MAP_VISUAL_AUDIT.md`) found the map was not the map that had been designed:
95% of buildings had an open corner, a quarter of furniture stood on walls, Cold Storage got **0
of 12** buildings, the Spillway **2.5 of 16** pipe segments. Placement skipped silently on a
clash and nothing counted the misses; every existing check (nav reachability, floor ΔE, sightlines)
passed throughout. **The habit this work ends is silent skipping** — every placer now reports what
it could not do, and `check-map-features.js` fails when the map gets worse.

## 3. Measured, 12–24 seeds each

| | before | after |
|---|---|---|
| Buildings a map | 5.0 → 3.1 (after the build-order fix) | **10.0** (= the authored count; the seeded placer is off) |
| Open-corner buildings | 100% | **0%** |
| Furniture on a wall / outside the shell | 29% / 19% | **0% / 0%** |
| Spillway pipe segments (16 designed) | 2.5 | **7.6** |
| Motor Pool bays (~6 designed) | 0.38 | **1.4** |
| Buildings standing on a painted drain | 2.1 | **0** |
| Sectors empty on every seed | centre, cold, kennel, pump, turbine | **pump only** (and it is a to-do, not a defect) |
| Nav unreachable cells, tight grid | 0.0036% | **0.0000%** |
| Nav unreachable cells, wide grid | — | 0.07–0.12% (inside tight-door buildings, by design) |

## 4. The invariants a future change must not break

1. **Everything is on the 20px lattice.** `STAMP_CELL` = `WALL_T` = `NAV_CELL` = 20. Stamps snap
   to it; sector boundary walls sit on it (they used to be centred on the line, 10px off, which
   made hand-painted walls impossible to align); door sizes and offsets snap to it. An 80px door
   11px off the lattice loses its clear column and **seals a building to the flow field** while
   staying walkable to a player.
2. **The nav grid is two grids.** TIGHT (`NAV_TIGHT_PAD` = 0) for bodies ≤20px, WIDE
   (`NAV_PAD` = 19) for brute 26 and the 34px ULTRA/SUPER SPLITTER. The tight pad **must be 0** —
   any padding makes the walls beside a one-cell door overlap its box and the door vanishes.
   A one-cell door is therefore a design tool: walkers swarm, big bodies must come round the front.
   **Anything that writes the grid must write both** (`refreshNavRegion` did not, at first).
3. **A gap is either closed or walkable.** `STAMP_CLEAR` is 90 (over the 78px guarantee), against
   reserves *and* walls. At 40 it took map-wide unreachable cells 0.0010% → 0.3263%.
4. **Authored beats seeded, and goes down first.** `placeAuthoredBuildings()` runs straight after
   the keep and the sluice, ahead of funnel halls and landmarks, so the rest routes around it.
   A blocked placement is reported with its reason and drawn red, never dropped.
5. **`stampBlockedReason()` is the single predicate.** The level places with it; the editor asks it
   under the cursor every frame. An editor with its own idea of what fits starts lying.
6. **Cell→world conversion goes through `zoneX/zoneY/zoneCol/zoneRow`.** A bare `c * ZONE_CELL_W`
   is off by the perimeter band (400px). This has now bitten twice, once in the editor's own
   sector lines.
7. **Sector paint moves one cell at a time.** `repaintRefusal()`: a cell may only join a sector it
   already touches, and a paint that splits a sector or takes its last cell is refused. Islands are
   impossible by construction rather than caught by `assertZoneConnectivity` at the end.

## 5. The world, and what is authored vs seeded

World is **5600×3500**; the nine sectors still occupy **4800×2700** at 200×150 cells, origin
(400,400). `ZONE_CELL_W` derives from `MAP_INNER_W`, not `WORLD_W` — that is what lets the world
grow without stretching a sector. The band holds the forest, the hard wall and its culverts, and
can be built on.

`ZMAP` flags, current values:

| flag | now | meaning |
|---|---|---|
| `authoredOnly` | **true** | buildings are the 10 in the file and nothing else, identical every seed |
| `authoredPerimeter` | false | forest and culverts still seeded. `F` in the editor freezes them into editable props |
| `authoredLoose` | false | crates and barrels still seeded (and chokepoint barrels with them) |
| `paint` | empty | no sector edits yet |

Still seeded regardless: sector shapes (until painted), floors, boundary doors and their prices,
funnel halls, the sluice, the container maze, the Kennels' rolling stock, the Spillway's runs,
wall-buys and perk stations (positions can be authored; **what they sell stays a sector decision**).

## 6. Decisions taken with the user

- **FAITH-style black/white/red art direction: declined for now** and, per `THE_SPLIT.md`, now
  belongs to the long game. `AESTHETIC_GUIDE.md` untouched; the proposal is `MAP_VISUAL_AUDIT.md` §4.1.
- **Hand-authoring over generation**: "seeded level building generation adds little at this point".
- **Blocks/cells allowed**, and stamps can be **exploded** into cells so a building joins the base map.
- **Rooms for exploded buildings: not needed.**
- **Hub stays players-only** — the editor is not a hub tile.
- **Export writes the file directly** (dev-server POST) with a confirmation, rather than a paste.

## 7. Open — asked for and NOT built

1. **Rail tiles and trains.** Straights, 90° elbows, elbow+straight connectors as placeable tiles
   that assemble into `railPaths` (the renderer already draws sleepers, rails and stepped curves
   from those), plus placing trains. Open question from the last exchange: tiles vs a
   waypoint "draw a rail line" tool; hand-placed vs automatic trains. **This is the one unfinished
   user request.**
2. **A Pump House stamp** — the user is drawing it. Nothing in the library fits what is left of
   that sector once its doorways are clear, so it gets 0 buildings.

## 8. Known defects, written down rather than hidden

- **Freeze (`F`) adds one crate per press.** Barrels, trees, culverts and landmarks are stable over
  three consecutive freezes; one live crate comes from a source that is neither the seeded scatter
  nor a stamp loot slot (those are tagged `fromStamp`). Freeze once.
- **One Sluice Yard placement is blocked on ~1 map in 30** — the sluice room is still seeded and
  lands across it. A smaller stamp in the same spot fails on the same seeds, so it is the ground.
  The baseline tolerates 0.1 missing a map for this reason.
- **The editor writes the repo.** Any experiment can become a commit: **check `git status` after an
  editor session.** I shipped 2,136 test cells once; the feature check caught it.
- **Cells are verbose** — ten buildings exploded to 1,364 `ZMAP.cell(...)` lines. Run-length
  encoding was offered and not yet decided.

## 9. Traps that cost real time here

- **A check written in world coordinates measures the origin.** The pipe-segment count read
  8.0 → 1.75 the moment the band landed; nothing was wrong with the map.
- **A 200 response is not a write.** The first export reported SAVED while an old dev server
  answered POST by serving the file back.
- **Validating on the seed family the checker uses is tuning on the test set.** Starter placements
  looked clean on 12 seeds and failed on 6 of 30 unseen ones.
- **Searching a finished map for authored spots asks the wrong question** — authored buildings are
  placed before halls and landmarks, so those move. Cold Storage reported zero legal spots for
  every stamp in the library while being half empty. Propose liberally, let the real generator decide.
- **`git checkout <file>` discards another session's uncommitted work.** It wiped two stamps the
  user had drawn; they were restored from context, but one grid (`cold-chiller-b`) could not be
  verified.

## 10. How to run and verify

```
node scripts/check-global-collisions.js      # the four standing checkers
node scripts/check-undefined-globals.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
node scripts/check-map-features.js           # map features vs recorded baselines (in the hook)
node scripts/measure-zombie-nav.js           # both nav grids; run when geometry moves
```

- **Editor:** double-click `zombie/map-editor.html`. SPACE flips PLAN/DRAWN; `T` cycles tools;
  `X`/`shift-X` explodes; `F` freezes; `A`/`P`/`L` the mode flags; `E` exports to the file.
- **Builder:** `zombie/stamp-builder.html`. The two pages link to each other.
- **Headless:** `scripts/zombie-headless.js` runs the page's own scripts in a vm —
  `h.generate(seed)` then `h.evaluate(sandbox, expr)`. Reads must be expressions evaluated *inside*
  the context (`let` globals are not sandbox properties).
- **Looking at the map:** render layers to a canvas and POST a dataURL to a local sink
  (`zombie-map-capture` memory). Pane screenshots are too small to judge map art.

## 11. Doc pointers

`MAP_VISUAL_AUDIT.md` (findings, art-direction proposal), `LEVEL_BUILDER_PLAN.md` (the authoring
how-to and phases 1–3 as built), `zombie/CLAUDE.md` (file-by-file, the nav rules, the world/sector
split, authored-map behaviour). `zombie/CLAUDE.md` is doc-sync stamped against the code as of
`5d81ddd`; another session has since added an uncommitted header pointing at `THE_SPLIT.md`.
