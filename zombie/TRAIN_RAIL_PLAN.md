# Zombie — the train and rail system

**Written 2026-09-25. Status: TABLED. Nothing here is built and nothing here is next.**
The user's call on 2026-09-25 was **map quality and delivery first** — this document exists so the
architecture is settled before anyone writes it, not because it is due.

> **When it is built, it goes on its own branch.** The user's condition. It touches the flow field,
> the collision sets, the wire and the win condition; four of the five systems this game has had a
> silent, session-ending bug in. It should be playtestable and abandonable without touching `main`.

**What it is for.** The rail line is currently scenery (`MAP_VISUAL_AUDIT.md` §1.4). The long-term
intent, recorded 2026-09-25:

- Railcars stand on the main line and on spurs. **The rocket bumps a car or the locomotive along
  the track.** A car that rolls into the locomotive **couples** to it.
- A coupled car is a **fuel car**. Coupled cars are the locomotive's fuel.
- Long term this becomes **an open world connected by rail**: the tank determines how far the group
  can travel before refuelling, and running dry strands them in distant, sparse, sometimes-secret
  ground. Fuel is a second currency **the player only ever touches as railcar fuel** — never a
  number in the HUD to spend.
- **Sector 1 stays at three tanks to escape** for now. One-tank runs being technically possible, and
  a bad idea, is the shape of the later game rather than of this one.

---

## 1. The evaluation asked for: the "Gated Hybrid" approach

The proposal, in three parts, and what the measurements say about each.

**Measured 2026-09-25** through `scripts/zombie-headless.js` (the real generator, seed 22352, nav
grid 240 × 135 = **32,400 cells**). The vm harness runs ~3x slower than the browser — the browser
figure for a full rebuild is the ~17ms already recorded in `CLAUDE.md`, which is 53ms here, so the
right-hand column is that ratio applied:

| | vm | ≈browser |
|---|---|---|
| `rebuildNavGrid()` — full passability rebuild | 53.3 ms | ~17 ms |
| `refreshNavRegion(railcar)` — patch, as written | 0.60 ms | ~0.19 ms |
| — of which rebuilding the spatial hash | 0.40 ms | ~0.13 ms |
| — of which the actual cell loop | 0.20 ms | ~0.06 ms |
| `rebuildSolidIndex()` — both solid grids | 0.92 ms | ~0.30 ms |
| `navFieldFrom()` — one multi-source BFS | 0.83 ms | ~0.27 ms |

> **This corrects `DESIGN_IDEAS_2.md` §3.1 as first written (2026-09-24), which said a moving solid
> costs ~14ms a frame.** That is the cost of a *full* rebuild, which a mover never needs:
> `refreshNavRegion()` has existed since the door-purchase work and patches only the cells around
> one rect. The real per-frame cost of a mover is **under 1ms in the browser**. Pathfinding is not
> the obstacle to a rideable train, and the architecture below is much cheaper than the gated
> proposal because of it.

### 1.1 "Treat train tracks as dynamic gates" — **reject the mechanism, keep the problem**

The proposal: divide the flow field into zones separated by gates, close the gate a car occupies,
and re-run the BFS only for the affected zones.

**Why it does not fit.**

- **It optimises the wrong term.** A portal/hierarchical flow field exists to avoid re-running an
  expensive BFS. This BFS is **0.27ms** over 32,400 cells. The expensive part was never the
  search; it was the *passability rebuild*, and `refreshNavRegion` already reduces that to
  **0.06ms of cell work**. There is nothing here worth a new abstraction.
- **It would be the third zone system on one map.** The game already has `ZONE_PAINT` (nine painted
  sectors, 24 × 18 cells) *and* `zoneNavRebuild()`'s 9 × 9 next-hop table over `zonePassages`, used
  by `zoneStepToward` for sector-scale spawn routing. A fourth-order "flow-field zone separated by
  gates", not aligned to the nine sectors, means two incompatible partitions of the same ground —
  and every future feature has to know which one it means.
- **"Mark the gate unwalkable" is backwards for this game.** A train should be a **magnet**, not an
  obstacle zombies route around. The rail gates are already barricades precisely because the idiom
  here is *"zombies pass, players never do"*. Telling the horde to avoid the train deletes the
  reason to have one.

**The real problem inside it, which is worth keeping.** The proposal's stated goal — *"reroute
before they ever touch the train"* — is not about cost, it is about **staleness**. The field
refreshes every `NAV_REFRESH_MS` = **220ms**, so for up to a fifth of a second zombies steer at
cells the train now occupies. Two things fix that without any new structure:

1. **A speed cap that falls out of the engine.** For the train never to move more than one nav cell
   (20px) between field refreshes: 20px / 220ms ≈ **90px/s**. A player walks ~240px/s, so the train
   is about a third of walking pace — which is exactly idea 58's "slow, loud, and a spawn magnet".
   The constraint and the design agree.
2. **Refresh on cell-boundary crossing, not per frame.** `refreshNavRegion` the vacated and the
   occupied rect and force one field recompute, only when a car's rect changes which nav cells it
   covers. At 90px/s that is roughly the same cadence as the 220ms refresh anyway.

### 1.2 "Local attached flow fields for the train cars" — **reject; this is parenting, not pathing**

The proposal: give each car its own mini grid, and transition a boarding zombie from the global
field to the car's local field so it does not slide off when the train moves.

**Why it does not fit.**

- **The stated problem is real; the tool is wrong.** "Sliding off when the train moves" is a
  **coordinate** problem. The fix is one field on the zombie — a carrier reference — and adding the
  car's per-frame delta to the zombie's position *before* it steers. That is a few lines and no
  second field. See §2.4; the same rule carries players, which is the point.
- **The grid would be absurd.** A 190 × 54 car at `NAV_CELL` 20 is **9 × 2 cells**. A BFS over
  eighteen cells, to steer at a player standing 40px away, when `navStepToward` already has a
  straight-line fallback for exactly that range.
- **The global field already solves the goal side.** It is reseeded from the players' *current*
  positions every 220ms, so a rider chasing a rider is handled. The only artifact is 220ms of
  staleness — 20px at the capped speed.

### 1.3 "Raycast proximity braking" — **right intent, and it is already built**

The proposal: a forward raycast on each zombie; on detecting the train, disable flow-field tracking
for a moment and apply a physics pushback.

**Two corrections and then it is exactly right.**

- **Don't raycast from the zombies.** The train knows where it is and where it is going. **Sweep the
  lead car's rect along its own motion for the frame** and test the handful of zombies inside the
  swept box. That is O(zombies near the train) instead of one raycast per zombie per frame, and the
  spatial index (`solidsNear`) is already there.
- **"Disable pathing for a moment and throw the body" already exists, under another name.** It is
  the SUPER SPLITTER's fan: `updateZombieLaunch()` is a **launch phase checked first in
  `updateZombies` that `continue`s past pathing, chewing and screaming**, is **exempt from the stuck
  watchdog** for the same reason chewing is, and rides three appended wire fields (`launchUntil`,
  `lvx`, `lvy`) as remaining durations so a guest draws flight rather than a teleport.

  A cowcatcher is that, with the launch vector taken from the train's heading. **Zero new systems**,
  and it is already verified (20 bodies, staggered landings over ~1s, 104–194px of travel).
- There is no ragdoll in this game and it does not need one. The fan already reads as bodies thrown.

### 1.4 Verdict

The proposal is a sound design for a large map with an expensive field rebuild. This map is 32,400
cells with a 0.27ms search, and the incremental-patch path it is trying to invent is already in the
code. **Two of its three parts add abstractions to solve costs measured at 0.06–0.30ms.** Each part
does contain a real problem, and all three of those problems have cheaper answers:

| Part | Real problem underneath | Cheaper answer |
|---|---|---|
| 1. dynamic gates | field **staleness**, not cost | the 90px/s cap + refresh on cell-boundary crossing |
| 2. local fields | **carriage** of riders | one carrier field, shared by players and zombies |
| 3. raycast braking | the train **hitting** things | sweep the lead car; reuse `updateZombieLaunch` |

---

## 2. The suggested approach: one degree of freedom

**The whole design follows from one observation: a train on rails has a single degree of freedom.**
It is not 2-D rigid-body physics. Each car is a scalar — distance along a path — plus a velocity.
Collisions are 1-D. Coupling is "merge two bodies and sum the mass". That is deterministic, tiny,
and it gives the user's "quasi-physics" for free.

```
  THE STATE OF THE WHOLE TRAIN SYSTEM

  car[i] = { path: <rail graph edge>, s: <arc length along it>, v: <px/s>, mass, coupledTo }

                 s ------->
     ====[car 2]=======[car 1]=====[LOCO]==========================>  the line
             v=0          v=0        v=0

  rocket hits car 2:          car2.v += impulse / car2.mass
  friction:                   v -= FRICTION * dt          (so it rolls and stops)
  car 2 reaches car 1:        1-D inelastic collision, then COUPLE
  coupled set:                one body, one v, summed mass, fixed spacings
```

Everything else is derived from `s`: the car's rect, its rotation, whether it is in a sector, what
it covers on the nav grid. Nothing needs a physics engine and nothing needs a second frame of
reference except riders (§2.4).

### 2.1 The blocker: `railPaths` is render-only, and the sidings go nowhere

`railPaths` (`zombie-level.js`, beside `buildRailSpur`) is a list of `{ pts, w, r }` — a centreline
polyline, a bed width, a fillet radius — built for `drawRailTracks()`. It is pure geometry with no
`MP.random()`, which is exactly the determinism a simulation wants. But it is **a list, not a
graph.** Measured over 10 seeds, 2026-09-25:

| | |
|---|---|
| `railPaths` per map | **4.0** — 1 main line (~3,130px) + **3.0 sidings** |
| sidings that touch the main line | **0.0** |
| railcars per map | 7.0 |
| railcars standing on the main line | **4.0** |

```
   KENNELS                    THE YARD                      MOTOR POOL
   ---[car]---   (siding, floating)
        ==========================================\
   ---[car]---   (siding, floating)                \    leg A -> corner -> leg B
                                                    \
   ---[car]---   (siding, floating)                  |
                                                     |
                                              ...[car][car]...
                                                     |
                                                  (dead end, y 2660)
```

So **three of seven cars a map stand on stubs with no connection to the line.** "Bump a car along
the track" works for four of them and is meaningless for the rest.

**What is needed before any of §2 can be written: a rail *graph*.** Nodes are junctions, edges are
the existing polylines, each edge arc-length parameterised so `s` is in world pixels. Sidings join
the main line at a **point/switch** node. That is the one genuinely new data structure in this plan,
and `LEVEL_BUILDER_PLAN.md` phase 4 (authored sectors) is the natural place for it — a rail graph is
authored geometry, not something a random placer should be producing.

### 2.2 The train is NOT in `walls[]`

Keep the cars in their own list and test them separately in `moveWithCollisions` and the zombie
mover. `rebuildSolidIndex()` rebuilds **both** solid grids from scratch (0.30ms browser); paying
that 60 times a second to move one rect is waste, and it is the kind of waste that only shows up as
a frame-time regression nobody attributes to the train.

### 2.3 Position is DERIVED from one broadcast scalar

The host owns `s` and `v` per car and broadcasts them; every client computes each car's rect from
`s` plus the coupling order. **This is the `escapeGateFrac()` / `escapeChainFrac()` pattern** — both
derived from `escapeAt` alone, so *"nothing new crosses the wire"* and a guest's gate is at the
host's height. Same discipline here, and the reason it matters is §2.4: a rider's carried delta has
to be identical on every screen to the pixel, and an interpolated position will not be.

Wire it as `s` (and `v` only if the client needs to predict), never as a position, and never as a
timestamp — the three rules in `CLAUDE.md` still apply.

### 2.4 Carriage: one rule, for players and zombies both

> If your centre is inside a car's deck, add that car's delta for this frame, before you steer.

- **Players: applied client-side, to your own player only.** Each client owns its own position; the
  host cannot move a guest. This is why §2.3 has to be derived rather than interpolated.
- **Zombies: applied host-side**, before `navStepToward`.
- One helper, called from two places. This replaces the proposal's local flow fields entirely.

**The one discipline to keep:** this is a simulation move and therefore a real write to `x`/`y` —
unlike `winPullPx` and `RETRO.snap`, which are draw offsets precisely because they must *not* touch
the simulation. Do not confuse the two; a carried rider is genuinely somewhere else.

### 2.5 Solid to whom? — two options, and a recommendation

| | **N1 — moving room (recommended)** | **N2 — barricade-like** |
|---|---|---|
| rim | solid to players and zombies, with doorways | solid in *collision*, passable in the *field* |
| boarding | zombies funnel through the doors | zombies reach the side and "climb" (the chew timer) |
| nav grid on move | changes → `refreshNavRegion` + one forced field refresh, ~1.2ms every ~220ms | **never changes — zero pathfinding work** |
| idiom | a boxcar with an open door is a funnel, and this game is built on funnels | reuses the barricade idiom exactly |

**N1**, because the cost is trivial and a door on a moving box is better gameplay than a swarm
climbing every side at once. **N2 is the zero-cost fallback**, and is the right answer for a
**flatcar** — a flat deck is climbable from anywhere, and "climbing on" is the chew timer with a
different name. A mixed consist (solid boxcars, climbable flatcars) is legitimate and costs nothing
extra.

### 2.6 Two speed regimes, because the win condition needs one of them uncapped

Per the 2026-09-25 decision, the run is won by **the train reaching about 5x walking speed
(~1,200px/s) and fleeing the sector** through a slowly-opening tunnel gate, under a concurrent
horde.

```
  SHUNTING            <= 90 px/s    normal play: rocket bumps, coupling, repositioning.
                                    The cap exists so the flow field stays within one nav cell.

  DEPARTURE           uncapped      the scripted climax. Nothing can path meaningfully at
                                    1,200px/s, and that is the point -- the horde is being
                                    outrun by design.
```

**This is a better climax than a traversal, and it is self-limiting.** The win is a *speed*
threshold, not a distance, so the fight happens during **acceleration** — the threat is what is
already aboard or boarding at low speed, and boarding gets harder as the train speeds up. Make that
explicit: above some speed, nothing can board. The departure then needs very little track, which is
just as well, because the line is 3,130px long.

### 2.7 What the departure does to the geometry

The current south gate is *a hole in the perimeter wall behind a slab* (`buildEscapeOpening`, added
because the win walk-out was flying over solid masonry). If the train drives out, that opening has
to become a **rail-sized tunnel mouth** in the south-east corner, not a person-width gap — and the
corner it lands in is the one `PERIM_CORNER_CLEAR` (700px) deliberately sealed on 2026-09-20 after
wedging reports. A gate that opens once is not a culvert, so this is acceptable, but it must be
entered knowingly: the climax fight is in the one corner the map was closed because fights there
went badly.

---

## 3. Sequencing

**Phase 0 — not this. Map quality and delivery first** (`LEVEL_BUILDER_PLAN.md`, the art-direction
decision, `MAP_VISUAL_AUDIT.md` §3). The user's call, 2026-09-25: *"these are the bones of
everything future."*

Then, on a branch:

| | | effort |
|---|---|---|
| T1 | **The rail graph** (§2.1). Junctions, arc-length edges, sidings joined by points. Authored, not placed. | M |
| T2 | **1-D car simulation** (§2.0): `s`, `v`, friction, 1-D collision, coupling. Host-owned, one scalar per car on the wire. No rendering change — the cars already draw. | M |
| T3 | **The rocket bumps a car.** The rocket already applies splash and sets off barrels; this is one more impulse target. First playable moment of the whole system. | S |
| T4 | **Solidity and carriage** (§2.2, §2.4, §2.5): cars out of `walls[]`, the carry rule, N1 rims with doorways. | M |
| T5 | **The cowcatcher** — sweep the lead car, reuse `updateZombieLaunch`. | S |
| T6 | **Departure**: the two regimes, the tunnel mouth, the horde, the speed win condition. | M |

T1–T3 are the interesting slice and are playable on their own: a rocket that shunts a railcar into
another railcar and couples them is a complete toy, and it proves the whole 1-D model before
anything touches the flow field or the wire's player payload.

---

## 4. Open questions

1. **Does the rail graph get authored by hand, in the level builder** (`LEVEL_BUILDER_PLAN.md`
   phase 4), or does it stay derived from `buildRailSpur`'s cell literals with junctions added?
   → *"authored" or "derived".*
2. **Mixed consist, or all one kind of car?** N1 boxcars funnel the horde through a door; N2
   flatcars let them climb from anywhere. Both are cheap; picking both is also fine.
   → *"boxcars", "flatcars", or "mixed".*
3. **Above what speed can nothing board?** Needs a number to design the acceleration fight around.
   → *a px/s figure, or "pick one and show me".*
4. **Does a coupled car's fuel drain during the departure**, so a one-tank escape is visibly
   marginal even in Sector 1 — or is fuel purely a gate on *reaching* departure for now?
   → *"drains" or "gate only".*
