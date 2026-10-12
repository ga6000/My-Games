# Zombie Arcade — a second map, then the end of the game (proposal, 2026-10-11)

**Game:** hub ZOMBIE ARCADE. **Finish-line item:** `HUB_RETROSPECTIVE.md` §5 item 2. **Status: DECIDED AND BUILT 2026-10-11.** The user's answers: (1) accept the longer full run for now,
playtesting will say; (3) **map 2's minute 2 is map 1's minute 3**, same trajectory after (a 60s clock
offset, not the 180s start proposed below); (4) a wipe on map 2 is **game over**. Question 2's mix/HP
follows the same clock. See `zombie/CLAUDE.md` "Seventh". The text below is the original proposal, kept. **2026-10-11, later: it grew to four maps** (a 7-tank
map with a divider, then a 10-tank boss); see `zombie/CLAUDE.md` "Ninth".

## The brief (user, 2026-10-11)

After finishing map 1 the team walks out the bottom and **enters a new map at the top**, with **five
silos** in a fixed, non-diamond spread, reusing the existing **hedge, warehouse and forest** silo
sets. It is **level 2 and the end of the game**. They **run onto the map**, get a **light lull**, then
the swarm ramps **as if it were minute 3** of map 1.

## The layout (a "W", fixed, same every run)

Offsets from the world centre, like `ARENA_FUNNELS` today (map 1 is a baseball diamond: start in the
middle, tanks left / top / right, gate south). Level 2 is a **zig-zag the length of the arena**, so it
cannot be read as the same map:

| | Silo set | Offset (dx, dy) | Why there |
|---|---|---|---|
| Entry | tunnel, top-centre | (0, −1395) | you run *south* onto the map; the mirror of map 1's exit |
| 1 | hedge | (−1700, −750) | top-left: first run is a diagonal across open ground |
| 2 | **warehouse** | (−700, +200) | the big set sits low, where its 300px racking bay fits above the south wall |
| 3 | forest | (+250, −650) | high-centre, so the forest is the fight on the way back up |
| 4 | hedge | (+1000, +300) | low-right |
| 5 | forest | (+1900, −700) | top-right: the last tank is the farthest from the gate |
| Gate | south wall | (+1700, +930) | the final sprint is down the right edge, past tank 4 |

Set types are **hedge, warehouse, forest, hedge, forest**: the three existing builders, with only the
warehouse used once (it is the one that needs the room). Every set already reads `funnels[k].r`, so
the larger funnel carries over.

**Measured next, not assumed:** this route is ~8,200px (~34s of pure running) against map 1's ~3,800px
(~16s). That is too long for the hub's session length, so the first pass should pull the offsets in
by ~20% horizontally (~6,100px, ~26s) and re-measure with `scripts/measure-zombie-nav.js`-style
reachability (every tank, switch strip and the gate, 12 seeds, both grids). The headless pathing sim
from the 2026-10-11 pass (`zombie/CLAUDE.md`, "Fifth playtest") is the right tool for the sets.

## The swarm: lull, then "minute 3"

Map 1's rate is `0.8 · 2^(T/50) · (0.6 + 0.4·players)`, so minute 3 is ~9.7/s solo. That is far past the
alive cap (60 + 30/player), so what "minute 3" actually feels like is **a permanently full cap, kill-
limited**. Proposed, on top of the existing tide and lull:

- **0–15s:** ×0.25 (the run-on). No zombies spawn inside the view.
- **15–35s:** ease to ×1.0 (smoothstep), then hold the **T = 180s** curve and keep climbing on it.
- **Type mix and HP:** *rates* are what was asked for. The mix/HP table is keyed to the same clock, so
  jumping T to 180s also brings level-16 brutes and SUPER SPLITTERS. **Open question 2.**

## What carries over, and what ends it

- **Carry over:** guns, perks and the score. Downed players come back through the existing 10s
  respawn, beside a teammate. A reset of kit would make level 2 a different, weaker game.
- **Tank sizes:** `[8, 10, 12, 14, 16]` (60 kills). Map 1 is `[10, 15, 20]`; five of those would
  double the session on their own.
- **A team wipe on level 2 ends the run.** Arcade rules: no continue. (Open question 3.)
- **The win** moves to the end of level 2: "ESCAPED AT m:ss" over the whole run, with a level-1 and a
  level-2 split on the card. Level 1's own win card becomes a 2s "SECTOR 2" beat and a hard cut.

## How it would be built (so the size is honest)

1. **Data-drive the arena.** `ARENA_FUNNELS`, `ARENA_GATE_DX`, the three silo-set builders and
   `SILO_CAPACITY` become a per-level table. **Hard-coded 3s that must go (a grep, so
   "about" and not "exactly"):** about eight loops in `zombie-arcade.js`, three in `zombie-render.js`
   (the goals list, the minimap, the perk hint), one in `zombie-endgame.js`, one in `zombie-game.js`,
   plus the `[false,false,false]` lull latch. The wire
   arrays (`fa`, `sf`, `sp`) are already length-driven.
2. **A level transition.** The host broadcasts `lv`; every client re-runs generation with that level
   (same seed), places the players at the entry, clears zombies/drops/turrets, and keeps `p.cards`,
   `p.owned`, `p.ammo`. The wire has a precedent: `ls` (the level seed) already heals geometry.
3. **A clock offset.** `startTime` is pushed so `T` starts at 180s for the spawn rate.
4. **Leaderboard:** one submission at the end of the run, with `round` carrying the level reached.

Estimate: two sessions, the first being nothing but step 1 (no new content, map 1 must still pass
every check unchanged). That order matters: a refactor that also adds a map cannot be bisected.

## Rules this touches (raise now, not mid-build)

- **`SCOPE_RULES.md` rule 0, a 2–5 minute session.** Map 1 is built for 2–4 minutes. Map 2 adds
  roughly 2–3 more, so a full run is **~4–7 minutes**, over the ceiling on a good run. Options:
  (a) accept a longer "full run" and call map 1 the 2–4 minute arcade run (a bonus stage after the
  credits); (b) keep it to 5 minutes by cutting tank sizes further; (c) keep rule 0 and don't build
  it. This is the user's call, and I would not build before it is made.
- **Rule 5, the playtest gate.** Build 2m (this session's fixes) has not been played by the group.
- **`THE_SPLIT.md`** keeps world/campaign work out of `zombie/`. A fixed second *stage* of the same
  arcade run is not a world or a campaign, but it is the first step toward one; worth saying aloud.

## Gameplay review, in the hub's own terms

Pillar gains are real: **#5 tension and release in 30–90s cycles** (a second act with its own lull)
and **#4 pressure that keeps building** (the ramp restarts). The weak point is **#1/#3 instant
start and instant restart**: a death in level 2 after five minutes is a long way back to the start of
an arcade run. That is the argument for the A-or-B choice under open question 3.

## Questions

1. Rule 0: accept a ~4–7 minute full run, trim it, or leave it as one map?
2. "Minute 3 *spawn rates*": rates only, or the whole minute-3 curve including brutes and SUPER
   SPLITTERS? (I would take rates + the mix of ~minute 2, and test.)
3. A wipe on level 2: **game over**, or **restart at the top of level 2** with the kit you had?
4. Do hazards, the turret and the boomgun stay on in level 2 as they are? (I assume yes.)
