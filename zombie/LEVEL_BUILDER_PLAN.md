# Zombie — level builder plan (2026-09-21)

**Status: plan only. Nothing here is built.** Written to answer the user's level-builder question.
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

## What already exists

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

### Phase 1 — stamp format + loader · **S–M, about 1 session**
- `zombie-stamps.js`: the parser, rotate/mirror, the checks above, and `placeStamp(stamp, x, y,
  rot)` writing `walls`, `barricades`, `buildingRooms[].decor`, floor patches and reserves. This
  is a new classic script, so run the collision checker.
- `ZOMBIE_STAMPS`: a handful of stamps, hand-typed, replacing `makeBuilding` in **one sector
  only** (Cold Storage, which gets 0 buildings today and so has nothing to lose).
- Deterministic: stamp choice and position still come from `MP.random()`, so every client builds
  the same map.
- **Done means:** rendered crops show closed buildings with furniture inside, and the counts show
  the Cold Storage target actually being met.

### Phase 2 — the builder page · **M, 1–2 sessions**
- `zombie/stamp-builder.html`, in the repo and `file://`-safe. Classic scripts, no server needed.
- A grid you paint and erase: pick a character from a palette, drag to paint, right-drag to
  erase, resize the grid, rotate, mirror.
- The checks run live, with failures outlined in red on the grid.
- It renders the stamp with the game's own draw functions, so what you see is what the map gets.
- **Export:** copy to clipboard, or download a `.txt`. Import by paste.
- *Optional:* **save through the dev server.** A POST endpoint on `scripts/dev-serve.js` that
  writes into `zombie/stamps/`. It's convenient, but it only works under the dev server, so it
  stays optional and clipboard remains the path that always works.

### Phase 3 — sandbox playtest · **S–M, about 1 session**
- `Zombie.html?sandbox=1#stamp=<encoded>` loads a small empty arena holding just that stamp,
  solo (it implies `?solo=1`, so there is no network).
- The existing dev toggles (`zombie-dev.js`: NO ZOMBIES, FREE BUYS, spawn a type) are wired in,
  plus a "zombies from all sides" horde button to see how the building defends.
- A **"playtest" button in the builder** opens it in a new tab. Draw, click, play, back to
  drawing, in seconds.
- The hash, not the query string, carries the stamp, so it never reaches a server log.

### Phase 4 — full sector authoring · **L, 3+ sessions, and it depends on the design talk**
- Sectors are authored as larger stamps, or as a sector layout that places named stamps. This
  covers pipe runs, motor bays and the container maze as well as buildings.
- **The generator shrinks to "pick variants and loot"**: which of N authored variants each sector
  uses, which `$`/`P`/`?` slots are live, door and window prices. It stops placing geometry.
- This is where the CoD Zombies direction lands (`MAP_VISUAL_AUDIT.md` §4.2). Maps you learn over
  many runs *require* fixed geometry.
- It retires most of `buildZoneContents`, `buildSectorInteriors`, `buildKennels` and the maze
  placer. Every measurement in `CLAUDE.md`'s "Measured" sections has to be redone.

**Total to phase 3 (the user building buildings and playtesting them): about 3–4 sessions.**

## Hand-over point

After phase 3 the user can build and refine buildings alone. The builder plus sandbox is the
whole loop. Phase 4 starts when they hand a set of stamps back and the map-design questions from
the CoD Zombies direction have answers.
