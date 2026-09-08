# RD Arena v2 — Fleshscape Plan

Written 2026-09-02 before editing. Baseline is the 708-line `RDArena.html`
(single enemy type, one-hit-kills everywhere, no rounds/score/abilities).

---

## 1. Decisions locked with the user

| Question | Decision |
|---|---|
| Arena scale | **4800×4800 world, `cellSize` 6→12, grid stays 400×400.** Zero added RD cost; walls are 2× chunkier. |
| Heavy vs. walls | Heavy does **not** phase or body-tunnel. It bee-lines, and when an obstruction sits between it and the player it **fires its double-shot into the wall to carve through**. Reuses the existing bullet→`clearRadius` behaviour. |
| BIOhack reward | **Organ-typed cards.** The organ you connect to decides the tree; you pick 1 of 3 cards drawn from that tree's factor pool. |
| Health | Player **4 HP**, grunt **1 HP**, heavy **3 HP**. Heart tree carries healing (and the future MP medic/revive line). |
| Card ↔ tier | **One card = +1 tier** in that tree (cap 5). Cards are not generic — **each upgradeable factor is its own card**, named in flesh-language. Pool size = number of factors that mechanic actually has. |
| Organ layout | **Exactly one of each**, far apart. Reusable every time. Choosing which one to run to *is* the build decision. |
| BIOhack pacing | Kill thresholds **10, 50, 125, 250, 500, 875**, then +500 each. |
| Human areas | **Hard no-entry for enemies.** Antibacterial is **anti-flesh only** — it does not hurt enemies, who mass at the doorway. |
| Antibacterial form *(2026-09-02)* | A **sprinkler-like turret** at each doorway that slowly sprays anti-microbial motes which delete flesh and **spread across the growth for a brief time**, replacing the abstract shrinking disc. |
| Card screen *(2026-09-02)* | **No longer pauses.** The world keeps simulating; the choosing player sits in a **protective bubble tinted to the offering organ** (`BUBBLE_R` 48). Built this way for multiplayer: one player choosing must not stop everyone else. |
| Rounds *(2026-09-02)* | **Wave-based**, mirroring `zombie`: fixed budget per round, spawning stops when spent, round ends only when the field is **clear**, then a 5s breather. |
| Gun upgrades *(2026-09-02)* | **Non-organic**, in the four corners of a new **central base**. Fire-rate, bullet spread, bullet size, piercing — each stacking to 3. |
| Blood *(2026-09-02)* | Sprays on **death only**. Taking damage no longer splatters. |
| Splatter *(2026-09-02)* | Stays a **Q cast**, baseline cut ~2.8x. Terrain erosion and kill-behind are **removed from baseline and sold as cards**. Kill-behind is **staged**: `Osmosis` (through cover) must be taken before `Saturation` (whole cone) is offered. |

## 2. Assumptions taken without asking (correct any of these)

- Current enemy becomes the heavy (r12); it no longer spawns at the old size. Grunt (r4.5) is the common type.
- Heavy spawn is a **guaranteed pity counter** — every 10th spawn converts — not a 10% roll.
- Double-shot = two bullets ~10° apart fired on the same frame.
- Grunts share **one flow field** recomputed every 15 frames on a coarse 100×100 grid, with a
  wall-proximity penalty so they hold ~2 coarse cells of clearance. They fire only on clear LOS within 300px.
- Enemy deaths still spray **cosmetic** blood (paints + carves flesh, no lethal wave). Only the
  player's Splatter ability produces a killing shockwave.
- Splatter's tier-2 Shockwave/Aftershock choice is a **permanent fork**.
- Player starts with **gun, machete, dash**. Crawler bullets and Splatter are earned.
- Rounds are 60s with a 5s breather; concurrent enemy cap 40.
- Player regenerates HP while inside a sanctuary.
- Only one BIOhack bakes at a time; extras queue.

## 3. Systems

### 3.1 World / RD
- `worldWidth = worldHeight = 4800`, `gridCols = gridRows = 400`, `cellSize = 12`.
- `noGrow: Uint8Array(gridSize)` — sanctuary interiors. `updateRD` forces `A=1,B=0` there and skips the stencil.
- Antibacterial is **not** a per-cell array (that would be a second 160k loop). **Revised 2026-09-02:**
  it is a **sprinkler turret + mote** system, replacing the original shrinking-disc abstraction.
  Each doorway carries a turret that oscillates across `SPRAY_SWEEP_ARC` (2.5 rad) centred on the
  **outward normal**, so it can never sweep back into the safe room, and lobs a mote every 5 frames.
  A mote erodes flesh where it lands (`MOTE_BITE` 11 travelling, 15 once it takes hold); while it sits
  on living growth it slows, burns life faster, and seeds a child (`MOTE_MAX_GEN` 3) — so the die-off
  **spreads across the fleshscape for a brief time and then burns out**. Motes splash on human
  structure rather than ghosting through it, and never touch enemies. Capped at `MOTE_MAX` 520;
  measured **0.06ms/frame** at ~208 live motes.

### 3.2 Sanctuaries (human areas)
- 4 rectangular rooms placed at world gen, away from the centre spawn.
- Static (non-RD) walls with 1–2 door gaps; `isSolid` consults them, so **nothing** can shoot them open.
- Enemy movement additionally rejects any position inside the interior rect → absolute no-entry.
- One `SprayEmitter` per door gap. Player regen inside: +1 HP / 3s.

### 3.3 Enemies
| | Grunt | Heavy |
|---|---|---|
| radius | 4.5 | 12 |
| hp | 1 | 3 |
| speed | 1.9 | 1.15 |
| spawn share | 9/10 | 1/10 (pity counter) |
| movement | flow field, keeps wall clearance | straight bee-line, blocked by flesh |
| firing | single shot, **requires clear LOS**, <300px | double-shot; fires at the player on LOS, **fires into the wall to carve** when LOS is blocked |
| bullet carve | 20 | 34 (bigger, so it actually opens a path) |

### 3.4 Flow field
One shared field for every grunt (and the delivered BIOhack), rebuilt every 15 frames on a coarse
100x100 grid. Step cost carries a wall-proximity penalty so paths bend into open space rather than
scraping the flesh.

> **Regression fixed 2026-09-02.** Adding the central base broke pathfinding completely. When the
> player stands in a sanctuary their own coarse cell is blocked, so the seed falls back to the nearest
> open cell — but the base is **13 flow cells across**, and the fallback only searched `r <= 6`. The
> seed was dropped, `rebuildFlowField` returned early, and **every cost stayed at INF**: measured
> **0% of open cells reachable**, so every grunt fell back to blind bee-lining into walls. This is what
> "non-heavies getting stuck" actually was. The search now runs to `r <= 24` and seeds **every
> equally-nearest open cell**, so enemies funnel to whichever doorway is closest. Measured after:
> **92.6% of open cells reachable**.

**Getting-unstuck ladder** (all enemies). A round now only ends on a clear field, so anything that can
never reach the player would stall it forever:

| Trigger | Response |
|---|---|
| flow direction blocked at fine scale | probe +/-0.4 .. +/-1.9 rad for a genuinely open lane |
| not moving ~1.5s | shoulder-carve the flesh in front |
| not moving ~4.3s | `relocate()` into the spawn ring |
| budget spent and >1700px away for 4s | `relocate()` |
| **no new closest-distance for 5s** (and not yet arrived) | `relocate()` |

The last one is the one that actually guarantees termination. The flesh regrows, so an enemy can end up
**sealed in a pocket where it still shuffles** — `stuckTimer` never fires, and it can sit well inside
straggler range. Measuring *progress* rather than *motion* catches it however it got trapped. Its guard
is each kind's own hold distance plus margin (grunt 220, heavy 140), not a flat number: a flat 400 left
anything sealed between the hold distance and 400px permanently exempt.

**Ring spawning.** At 4800x4800 a uniform spawn is a 30-60s walk at grunt speed, which stalls the round.
`zombie` hit this at 4800x2700 and solved it the same way. Spawns now ring the player at 700-1300px and
must be flow-reachable (widening, then dropping the requirement, rather than skipping the spawn).
Measured: 10 grunts, 0 arrived in 22s before —> **9 of 10 arrived within 33s** after; round 1 went from
never clearing to clearing in **28.5s**.

### 3.5 Organs & BIOhack loop
Three organs, one each, marked with off-screen arrows when a BIOhack is pending.

1. **Prosiblast** — pulsating green pile of intestines → *Crawler* (slow pathfinding bullets)
2. **Coaxitrib** — twitching banana-shaped heart → *Blood Splatter* + healing
3. **Shahnter** — → mobility (dash, machete, movement)

Loop: threshold crossed → organs light up → walk to one and **hold F ~2s** (bio tube draws player→organ)
→ organ **bakes ~15s** while you keep fighting → the BIOhack detaches and **pathfinds to you** at
**2.6px/f** (was 1.7) using the grunt flow field → on touch you enter a **protective bubble** and pick
**1 of 3 cards from that organ's pool** while the world keeps running.

### 3.6 Card pools (each factor is its own card)

**Prosiblast — Crawler**
| Card | Effect |
|---|---|
| Peristalsis | crawl speed |
| Tropism | turn rate / how tightly it tracks the flow field |
| Clutch | +1 crawler per cast |
| Engorgement | crawler radius + carve radius |
| Ossified Tip | +1 pierce |
| Gestation | cooldown |

**Coaxitrib — Splatter / heart**

**Revised 2026-09-02.** Splatter stays a deliberate Q cast, but the baseline was cut hard and its
two strongest behaviours are now bought, not free. Baseline: `maxRadius` 560 -> **200**, cone
PI/3 -> **PI/4**, 250 -> **90** particles, cd 330 -> **300**, and it **respects cover**, **claims
one body per wave**, and **does not eat terrain**. Lethal zone is `0.33 * 200 = 66px`.

| Card | Effect |
|---|---|
| Hemorrhage | blast `maxRadius` (+55, rescaled from +130) |
| Arterial Spray | blast arc width |
| Systole | lethal-zone fraction (base 1/3) |
| Clotting | cooldown |
| Transfusion | +1 max HP and heal on kill |
| **Corrosion** | buys terrain erosion back (+9 bite); blood is otherwise cosmetic |
| **Osmosis** *(stage 1, once)* | wave no longer needs line of sight — punches through cover |
| **Saturation** *(stage 2, once)* | wave stops claiming one body and takes the whole cone |
| *(tier 2 only)* **Shockwave** \| **Aftershock** | permanent fork — replaces the normal offer |

`Osmosis` and `Saturation` are a **staged pair**: `Saturation` is gated behind `Osmosis` by an
`avail()` predicate on the card, so it is never offered first. Aftershock's grenade was rescaled
130 -> **95** so a fork payoff cannot out-range the ability that triggers it.

**Shahnter — mobility / machete**
| Card | Effect |
|---|---|
| Tendon | dash cooldown |
| Sinew | dash distance & speed |
| Cartilage | base movement speed |
| Serration | machete arc + carve radius |
| Reflex | machete cooldown |
| Sloughing | i-frames after a dash |

**Aftershock**: a splatter that kills ≥1 enemy launches a grenade along the shot vector; it hangs
0.5s, then detonates — kill radius + `clearRadius`.

### 3.7 Rounds
**Revised 2026-09-02 — wave-based, mirroring `zombie`.** The 60s timer is gone. Each round carries a
fixed budget `budgetForRound(r) = floor(6 * 1.16^(r-1)) + r` (round 1 = **7**), spawns it out at
`spawnGapForRound(r) = max(14f, 90f - 5r)`, and **only ends once the budget is spent AND the field is
clear** — so enemy spawning is capped and you always get a real lull. Then a 5s breather
(`ROUND_BREAK`), then the next round. Concurrent cap 40 still applies as a ceiling.

**Heavies rebalanced:** none at all in round 1, then `heavyEvery(r) = max(7, 20 - 2r)` — 1-in-16 at
round 2 easing to a 1-in-7 floor by round 7. Previously a flat 1-in-10 from the first spawn, which
was far too many early.

### 3.7b Central base & non-organic gun upgrades *(added 2026-09-02)*
A fifth human structure, `BASE` at **2130,2130 540x540**, wrapping the spawn point, with doors on all
four sides. Same sanctuary rules: hard no-entry for enemies, unshootable walls, spray turrets at each
door. Its four inside corners hold **gun terminals** — metal, deliberately outside the organ card system:

| Corner | Upgrade | Per stack |
|---|---|---|
| NW | FIRE-RATE | reload -18f (90 —> 36 at 3) |
| NE | BULLET SPREAD | +1 round per shot |
| SW | BULLET SIZE | +1.1 radius, +8 carve |
| SE | PIERCING | punch through +1 body |

Hold **F** for 45f to claim a stack; **max 3 each**.

> **Pacing call, not requested:** a terminal gives **at most one stack per round**. Ungated, all 12
> stacks are free in round 1, which would overshoot the same request that asked for *fewer* early
> heavies. One line to revert — drop the `t.lastRound === round` check in `updateGunTerminals`.

### 3.7c Presentation *(2026-09-02)*
- **Enemy size doubled** — grunt r4.5 —> **9**, heavy r12 —> **24** (player stays 6). They were too small to
  reliably hit; grunt hit area against a bullet is now **2.86x** larger. Safe because enemy wall collision
  is a **point test on the entity centre**, so a bigger radius does not make them wedge in corridors.
- **Blocky edges smoothed** — solid cells now render as overlapping discs (`r = cellSize * 0.78`, which is
  above the half-diagonal so interiors stay gapless) merged in a single fill, instead of 12px `fillRect`
  stair-steps. **Render-only**: collision, LOS and the flow field still read `gridB` exactly, so nothing a
  future multiplayer bitmask must agree on is affected. Costs **+0.53ms/frame**.
- **Death blood localised** (`power` 1 —> 0.45). Not requested, but it fell out of two earlier changes:
  blood used to carve its own channel through the flesh, so long streaks read as corridors. Now that
  erosion is a card (`Corrosion`) blood only paints, and at the old speed it smeared ~500px of noise over
  intact walls — which buried the edge smoothing above. One value to revert.

### 3.8 Controls
`WASD` move · `LMB` gun · `Space`/`RMB` machete · `E` hold+release dash · `Q` splatter · `R` crawlers · `F` connect bio tube

## 4. Repo constraints honoured
- Stays one self-contained `.html` (repo convention; no game is split yet).
- Runs from `file://`, no build step, no modules.
- All timers via `trackTimeout`/`trackInterval`, all listeners on one `AbortController` — the baseline
  used raw `setTimeout`, which this replaces.
- No identity/colour hashing involved (single-player); multiplayer stays deferred per `MULTIPLAYER_PLAN.md` §4d.
- `node scripts/check-global-collisions.js` from repo root before calling it done.
