# gyro-lab — Chunked, procedurally generated 1000× world + two-range mini-map

Written 2026-09-10 before editing, per root `CLAUDE.md`. Follows the feasibility answer given
the same day (world ±40,000 → ±40,000,000; area ×1,000,000).

## Core decision: the global arrays become "what is loaded"

`glHoles`, `glBodies`, `glStarSystems` and `glAsteroids` stay exactly where they are, and
every existing loop keeps reading them — gravity, time dilation, hazards, the escape rule,
the autopilot, lensing, the mini-map. What changes is what they *contain*: the chunk
streamer adds a chunk's content when it loads and takes it out when it unloads. So every
"loop over everything" becomes "loop over the loaded neighbourhood" without rewriting any of
it, and its cost is bounded by how many chunks are loaded, not by the size of the world.

## Chunks

- **Size 60,000.** At least the largest single reach (a 200× hole's influence is ~19,600; a
  star system's outer planet and well ~17,000), so a feature placed with that margin inside
  its own chunk never crosses a border. That means no seams and no neighbour negotiation.
- **One feature per chunk** — 30% a black hole, 20% a star system, 50% empty — at a jittered
  position within the margin, plus 3–7 asteroids.
- **Deterministic:** everything comes from `hash(worldSeed, cx, cy)` through the existing
  mulberry32. A chunk *summary* (kind, position fraction, size, star name, colour) is
  memoised and needs no geometry, which is what lets the max-range map see unloaded space.
- **Home sector:** the four chunks around the origin keep the hand-made content — the
  origin hole, VESPER, HALCYON, the 14-asteroid field. It is pinned (never unloaded) and
  generates nothing procedural, so every earlier measurement still describes something real.
- **Loading:** chunks within a view-dependent radius (1–3) of the focus point, plus a 3×3
  block around every live ship — a fleet ship far away still falls into holes that are
  really there. Unloading waits 5 s after a chunk stops being wanted (hysteresis at the
  borders). Checked every 10 frames.
- **Persistence:** edits to a procedural hole (sliders), and removals, are saved by id on
  unload and re-applied on reload. Planets are analytic in time: a system reloaded later has
  its planets where they would have been, not back at their start angles. Asteroids
  regenerate fresh (not persisted) — they are scenery.

## Things that break at 1000× and how each is handled

| | fix |
|---|---|
| Starfield sits in a fixed ±3,000 parallax patch — gone at 40M | tiles (wraps) with the camera |
| Mini-map at 625,000 units/px shows nothing | two ranges, below |
| Position sliders ±36,000 — touching one would teleport a far hole | the slider window re-centres on the selected hole; the number box sets anything |
| "Generate field" scatters over the whole arena | confined to the home sector |
| Probes seeded round-robin at every hole, including far pinned ones | seeded only at holes near the focus; probes outside the loaded range are culled |
| Hazard list rebuilt per ship per call | cached once per frame |

## Mini-map, two ranges (scroll over the map: down = max, up = close)

- **Close:** 240,000 units around the focus: chunk grid with loaded chunks tinted, holes
  downsampled (disc + rim + influence ring), star systems (orbits, planets, named star),
  ships, view rectangle.
- **Max:** radius `mmMaxRange` (1.5M default): every star as **one point** in its own colour,
  holes as dim single points, not downsampled — straight from the chunk summaries, loaded
  or not. Below the map, a **list of the nearest stars** with name and distance.

## Not in scope, flagged

Travel. At full hyperdrive one chunk takes ~33 s, and the nearest listed stars are minutes
away. The number box lets hyperdrive thrust go past 25 as an immediate workaround; a real
warp/jump mechanic is a design decision for the user.

## Verify

Chunk load/unload while flying (counts, gen ms), same content on revisit, a hole edit
persisting across unload, planets advanced on reload, no seams (no feature within margin of
a border), physics cost vs loaded chunks, both map ranges, wheel toggle. Checkers, doc-sync.

## Status — implemented 2026-09-10, all checks passed

Numbers in `gyro-lab/CLAUDE.md` ("1000× chunked, procedural world + two-range mini-map").
Headlines: 0 of 991 features near a border; streaming pass ≤ 2.8 ms; a hole edit and a
system's planet phase both survive unload/reload; 373 stars on the max-range map.

**One addition the plan did not have: `glNear`, a chunk-local spatial query.** The plan
assumed "only loaded content" would be enough to bound cost. It isn't, once ships spread out
and load many chunks: 10 spread ships gave 99 loaded chunks and a **21.9 ms** simulate step,
because every object still looped over every loaded body. Querying only each point's 3×3 of
chunks brought it to **2.84 ms**, and is exact for gravity, horizons and surfaces (verified
against brute force at 3,000 points). Time dilation is cut at the 3×3 — as the plan's
"void = nothing within N chunks" intended. Brute force had made dilation depend on how many
chunks were loaded, which was the real bug.
