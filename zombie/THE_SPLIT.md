# Zombie is two games — the split (2026-09-27)

**Status: the separation is the user's decision (2026-09-27). The fork mechanics in §4 are a
proposal and nothing in §4 is done yet.** Open questions are listed in §5.

Read this before starting any Zombie work. The first question for every Zombie change is now
**which of the two games it belongs to**.

---

## 1. The two games

| | **ZOMBIE** (the hub game) | **The long game** (working title TBD) |
|---|---|---|
| What it is | A co-op arcade survival run: one map, rounds, perks, wall-buys, and the generator → silos → train chain ending in a departure | A growing world connected by rail, with a campaign checklist, survival-sim systems and roguelite runs |
| Who it's for | The friend group, drop-in, 1–4 players, from the hub board | Eventually more people than the group. Solo has to be viable |
| Session | **One sitting.** Proposed target: a winning run ends inside ~30 min (to be measured, not assumed) | Many sessions, with persistence between them |
| Look | The hub's arcade cabinet system (`AESTHETIC_GUIDE.md` §6.3). **Arcade is the right identity here**, because it is an arcade cabinet in an arcade hub | Its own art direction. The FAITH-style black/white/red proposal (`MAP_VISUAL_AUDIT.md` §4.1) belongs here |
| Maps | The current sector map, tidied with the map editor and stamps | Organic, authored level design. **Needs a level representation the arcade map doesn't have** (see §3) |
| Constraints | Every hub hard constraint: `file://`, classic scripts in one global scope, `GameInstance`, host-authoritative over `relay` | **Free to break them**: a build step, modules, a different engine. Being able to break them is part of why it's a separate game |
| Done means | A finite v1 that then freezes (see `HUB_RETROSPECTIVE.md` §5) | Open-ended. This is where the ambition goes |

The long game has an ancestor already: `under-development/wasteland-train-sim/` ("Train Zombie
Game"), which `PROJECT_MEMORY.md` has listed as a **long-term Unity candidate** since August. The
train-and-world idea was there before Zombie grew toward it.

---

## 2. Why separate, and why now

- **One codebase was trying to be both.** Every visual pass since 2026-09-20 has "barely moved
  the needle" (user, 2026-09-21), because each one polished an arcade game toward an indie look.
  If the arcade stays an arcade, its current look is close to right. If the indie game starts
  fresh, it isn't trying to escape the arcade's grid.
- **The hub's constraints are the ones a world game will need to break.** Examples: one global
  scope across 21 script files, no build step, a 20 px cell grid that the flow field and the
  sector paint depend on, and a free-tier relay server.
- **The pull is measurable.** 32 of the 42 commits since 2026-09-18 are Zombie. `zombie/` holds
  18 plan and design docs, and `zombie/CLAUDE.md` is 2,242 lines. `DESIGN_IDEAS_2.md` §2 already
  said *"take the causal hierarchy, be very careful about taking the campaign"*. That tension was
  really about the two games.
- **The rectilinear feel is structural, not cosmetic.** Sectors are painted on a cell grid, walls
  sit on that grid (commit "put the sector walls on the cell grid", 2026-09-26), and navigation is
  a grid flow field. Better art on the same grid gives the same chunky walls. Organic level
  design needs a different foundation, and building that foundation inside the hub game would
  rebuild the hub game.

---

## 3. What goes where

### Stays in ZOMBIE (hub)

Everything already built through the train:

- the generator, sluice, silos, flood and train departure as the win
- perks, weapons, the SUPER SPLITTER and the horde switch
- score and leaderboard
- the map editor and stamps, as tools for tidying **this one map**

From `PLAYTEST_2_PLAN.md`, only the items that make the **existing** train work correctly: the
push-model deletion (§0.1) and the car parked in a closed door (§0.2). The same rule applies to
any other item there: fix what's built, don't extend it.

### Goes to the long game

- `DESIGN_IDEAS.md` Part 7 §III: 65 (Sector 01 → 02) and 66 (carry-over)
- `DESIGN_IDEAS_2.md` §8.6: the open world by rail, fuel range, stranding, and fuel as a gauge currency
- cross-sector persistence and any roguelite meta-progression
- survival-sim systems
- the FAITH art direction
- the organic level-design rework and the CoD-Origins-scale map ambitions
- classes as a *campaign* system

### Undecided (settle one at a time, never by default)

- **Objective verbs** (`DESIGN_IDEAS_2.md` §3.8). Small and self-contained. This is the arcade's
  only if it fits one sitting without a new system.
- **A second arcade map.** Maybe someday, but it's a new game on the board, not a Zombie feature.

**The routing rule.** An idea too big for one ~30-minute arcade sitting isn't cut. It's routed to
the long game, which makes saying no to the hub game cheap. Route it with one line in
`../IDEAS_INBOX.md`, not a plan file.

---

## 4. Fork mechanics — PROPOSED, not done

1. **Finish the arcade-side playtest-2 fixes** (§3). Another session is working on
   `PLAYTEST_2_PLAN.md` right now, so don't touch it from here.
2. **Tag the fork point**, for example `git tag zombie-fork-2026-09`. The long game starts from a
   known snapshot, and the arcade is free to be trimmed afterwards.
3. **Start the long game outside this repo** (recommended). A separate repo or a sibling folder
   isn't bound by `My Games-main`'s constraints, its checkers or its doc-sync scope. What carries
   over is mostly **knowledge**: the flow field, the host-authority model, reconnect/seed lessons
   and the perk economy, all written up in `CLAUDE.md` and `PROJECT_MEMORY.md`. The code should be
   treated as reference, not as a base to keep extending. **Its first job is not a feature but a
   level representation**: how a non-rectilinear map is authored, collided and navigated.
4. **Stop prototyping long-game features in `zombie/`.** A long-game experiment inside the arcade
   is how the arcade grew to what it is now.
5. **Give the arcade a finish line**: `HUB_RETROSPECTIVE.md` §5's Zombie line, then freeze to
   fixes and balance only.

---

## 5. Open questions

1. **Working title** for the long game (a name, or keep "the long game").
2. **Where it lives**: a separate repo (recommended) or a folder beside `My Games-main/`.
3. **The arcade's target run length.** It is proposed at ~30 min, but nobody has timed a winning
   run with the group yet. Measure one, then pick a number.
4. **Does the FAITH direction apply to the arcade at all?** The recommendation is no: the arcade
   keeps its cabinet look, and FAITH goes to the long game. If that's accepted, the hold in the
   `zombie-art-direction-pending` memory lifts for the arcade.
