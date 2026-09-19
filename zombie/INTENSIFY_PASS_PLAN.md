# Zombie — the intensify pass

Nine items from the user, 2026-09-19. Written before any edit, because sessions compact and
saved plans don't (root `CLAUDE.md`, "Cross-file changes").

Branch: `zombie-intensify`, off `main` at `56797e9`.

**Read first, every time:** this file is a plan, not a record. When something lands that
contradicts it, mark the passage superseded with a date rather than deleting it.

---

## Where each item lives

| # | Item | Files | Size |
|---|---|---|---|
| 1 | Flamethrower nerf | `zombie-entities.js`, `zombie-level.js` | XS |
| 2 | Field manual leaves you walking | `zombie-render.js` | XS |
| 3 | Shoot through missing planks | `zombie-level.js`, `zombie-game.js`, `zombie-render.js` | S |
| 4 | Silos: label overlap, hall pinch, 12/24/36 | `zombie-endgame.js`, `zombie-level.js`, `zombie-render.js`, `zombie-game.js` | M |
| 5 | The escape gate and the win cinematic | `zombie-endgame.js`, `zombie-render.js`, `zombie-game.js`, `Zombie.html` | L |
| 6 | The intensify switch | all of them, plus `zombie-music.js` | XL |
| 7 | Consistent gun / perk / silo placement | `zombie-level.js` | M |
| 8 | Map revamp — **proposal only** | this file | — |

Items 1–4 are self-contained. 5 and 6 are the session. 7 touches generation, so it lands
**before** 8 is even considered.

---

## 1. Flamethrower — a slight nerf, and SALVAGE is the answer

Today (`zombie-entities.js`, `WEAPONS.flamer`): cost 5,200, capacity 400, cooldown 70ms,
3 pellets x 0.5 dmg, `pierce: 99`, range 280, burn 2,200ms @ 1.6 dps,
`salvage: 1`, `salvageAmt: 5`.

**One ammo is spent per trigger pull, not per pellet** (`shoot()` decrements once before the
pellet loop). So 400 rounds at 70ms is **28 seconds of held trigger**, and because every
flame pierces everything in the cone, damage scales with crowd size: ~21 dps against one
zombie, ~170 dps against eight.

| | before | after | why |
|---|---|---|---|
| wall-buy cost | 5,200 | **5,800** | +11.5%. Still under the rocket's 7,500 |
| `capacity` | 400 | **340** | 28.0s -> 23.8s of held trigger, −15% |
| `salvage` / `salvageAmt` | 1 / 5 | **unchanged** | this is the pairing |

**Do not touch `salvage` or `salvageAmt`.** The brief says the nerf "should pair well with the
salvage perk", and cutting the magazine is what *creates* that pairing: SALVAGE refunds 5
rounds on 30/45/60% of kills, so at x3 against a crowd the flamer is close to self-sustaining
and without it you now feel the 340. Nerfing the refund as well would remove the answer at the
same time as the problem.

Damage, cooldown, pierce and burn all stay. The brief said "very slightly".

## 2. Holding a direction into the field manual keeps you walking

**Confirmed cause, one line.** `openHelp()` calls `releaseHeldKeys()`; **`openCodex()` does
not** (`zombie-render.js:82`). The `keyup` listener returns early while `codexOpen`, so the
release of a key held at the moment F was pressed is never seen, `p.keys.up` stays `true`, and
nothing gates `updatePlayers` on `codexOpen` — so you walk while you read. `closeCodex()`
clears the keys, which is why it stops the instant you close it and why this reads as
"movement during the manual" rather than "movement after it".

Fix: call `releaseHeldKeys()` from `openCodex()`, and have `closeCodex()` call it too instead
of repeating the same five assignments inline.

## 3. Shooting through planks that are already gone

Today a barricade is one rect with `hp`/`maxHp`, and it leaves the **zombie** solid set only at
`hp <= 0` (`solidRectsFor`). Bullets use that set, so a window is total cover until it is
totally destroyed. The brief: you should be able to shoot through the gaps as a zombie chews
through, *keeping the barricade intact*.

The renderer already draws exactly the fiction we need (`drawBarricades`): **4 plank slots**,
`shown = max(1, ceil(4 * hp/maxHp))`, drawn from the low end of the span upward, so the
missing planks are always slots `shown..3` — the far end.

So: one shared helper, used by both the draw and the bullet, and what you see is exactly what
you can shoot through.

```
const BARRICADE_PLANKS = 4;
function barricadePlanksShown(b)      // 0 when hp<=0, else max(1, ceil(4*frac))
function inBarricadeGap(b, x, y, sz)  // the box lies wholly past shown*step
```

- `bulletBlockedAt(x, y, size)` in `zombie-level.js`: `solidsNear(..., true)`, and skip any
  rect that is a barricade whose gap contains the box. Everything else blocks as now.
- `updateBullets` uses it in all four places it currently calls `blockedAt(..., true)` — the
  rocket test, the plain test, and **both** RICOCHET axis probes, or a round will bounce off a
  hole it should have flown through.
- **Entirely past, not merely overlapping** (`lo >= gapStart`): a round clipping the last
  plank is stopped. At a 112px window the slot is 28px against a bullet of 8–14, so this is
  the difference between a clean shot and a lucky one.

**Consequences checked:**
- Zombie pathing, player collision and the two solid grids are **untouched** — bullets are the
  only consumer of the new function.
- A gap needs `frac <= 0.75`, so a quarter of the window must be chewed before anything gets
  through. That is the "as they're breaking through" the brief asks for.
- Host and guest both compute the gap from the same `hp`, which is already broadcast (`bc`),
  so they agree to within one snapshot. No new wire field.
- Barricades still are not damaged by gunfire. Shooting the boards off yourself is a different
  feature and is not in this pass.

## 4. The silos

### 4a. The label is inside the wall

`drawEndgame` writes both silo labels **above** the tank: `si.y - 16` and `si.y - 5`. In a
**horizontal** funnel hall the silo is placed at `y + WALL_T + 8` — hard against the hall's
top wall (`makeFunnelHall`) — so both lines land in the wall. That is the reported bug, and it
is why it does not happen everywhere: the vertical hall puts the silo against the *left* wall
and the sluice's silo against the *east* wall, and both have open floor above them.

Fix at the source, not in the renderer's guesswork: `makeFunnelHall` knows which wall it just
put the silo against, so it sets **`labelBelow: true`** on the horizontal case. `drawEndgame`
honours it, and draws a dark backing plate behind both lines either way — the drain floor is
busy and 9px Courier over it is marginal even where it fits.

### 4b. A door-like pinch at each end of a hall

The brief: "cause pinch point slightly in silo hallways so there is more of a door-like
entrance & exit". A hall is `HALL_WID` 280 outer / **240 inner**, open the full width at both
ends.

Add a stub of wall at each corner of each open end, narrowing 240 to **140**.

**This is the number that needs care.** `CLAUDE.md` rule 3: the flow field can only guarantee
an opening at `2*NAV_CELL + 2*NAV_PAD` = **78px** with `NAV_CELL` 20 and `NAV_PAD` 19. 140
clears it with 62px to spare, and clears the widest body (the ULTRA HEAVY, 34px) four times
over. For reference the rest of the map: outpost doorways 112, windows 112–151, doors 124–159,
the nook hole 90. **140 becomes the narrowest opening in the game** — still a healthy margin
over the guarantee, but update the list in `CLAUDE.md` when this lands.

### 4c. 12 / 24 / 36

`SILO_CAPACITY` is a scalar `12` used in eight places across four files. It becomes
`SILO_CAPACITY = [12, 24, 36]` plus `siloCapacity(i)`, and every site is indexed:

- `zombie-endgame.js` — `endgameObjective`, `creditFunnelKill`, `siloReady`
- `zombie-render.js` — the goal checklist (x2), the funnel label, the silo fill fraction and
  the silo label
- `zombie-game.js` — **`silosFilled()`**, which feeds `runScoreFor`'s 8,000-per-silo term

Total kills on a funnel goes 36 -> 72, which lengthens the endgame considerably. That is the
point of the brief ("increase with each successive one"), and the escalation lands on funnels
2 and 3, which sit in halls with a pinch at each end — i.e. exactly where a longer fight is
the set piece rather than a chore. Re-measure the endgame's length after 6 lands, not before:
intensified rounds change the arrival rate.

## 5. The escape: a heavy gate behind a chainlink gate

Replaces the yellow loading bar over `escapeRect` and the `SEALED`/`ESCAPE` text.

**Geometry.** `escapeRect` is 180x66 at the bottom centre, fixed. Two layers drawn in it:

1. **The heavy inner gate** — a slab that grinds upward over the full `ESCAPE_OPEN_MS`
   (90,000ms). Its open fraction is the same `1 - (escapeAt - now) / ESCAPE_OPEN_MS` the bar
   used, so no new state and no new wire field: `esc` already crosses as a remaining duration.
   Drawn as a heavy plate with a ribbed top edge, rising to reveal black beyond, with the
   rails it runs in either side.
2. **The chainlink gate** — a lighter diamond-mesh gate in front, shut, spanning the opening.
   It stays shut for the whole 90s. When the heavy gate finishes, it **flies open**: a short
   swing (~700ms, eased) about its hinge, and then it is open for the rest of the run.

So the read is: something massive is slowly lifting behind a fence you can see through, and the
fence is the last thing between you and out.

**The win.** `updateEscape` calls `triggerWin()` the frame a player touches the rect. That
becomes a sequence, and `triggerWin()` fires at the **end** of it:

| phase | ms | what |
|---|---|---|
| `escaping` | 0–1400 | the player is pulled south, off screen, at a constant rate. Input is dead. |
| `fade` | 1400–2600 | the world fades to black under the player |
| `card` | 2600+ | `triggerWin()` — the WIN card and the typed score readout |

- **Input and sound stop at the start**, as asked: a `winSeq` flag that `updatePlayers`, the
  key handlers and the mouse handlers all check, and `musicEnd("win")` moves to the start of
  the sequence so the organ's D-major cue rings under the fade rather than after it. Effect
  sounds are gated on the same flag.
- **The pull is a render-side offset, not a write to `p.x`.** The same discipline as
  `RETRO.snap`: writing the simulation would send the player through the world boundary and
  into the collision code. The camera holds still and the player sprite walks out of frame.
- `won` is already on the wire (`wn`), and `triggerWin` is already idempotent via
  `zLbSubmitted`. The sequence is **local**: each client that escapes plays its own. A guest
  learning `wn: 1` from the snapshot without having touched the rect gets the card directly,
  as now — it did not escape, it was told the run was won.

## 6. The intensify switch

The largest item. A switch in the starting room that turns the run into a blitz.

### 6a. The object

`intensifyRect`, built in `buildKeep()` beside the existing `codexRect` (which is at
`kx + KEEP_W/2 - 30, ky + 54`). Put it on the opposite side of the keep's crate so the two
`F` targets are never ambiguous — `interactWith` tests rects in order and the manual is first.

Drawn as a heavy knife switch: a plate, a pivot, and a lever that is **up** before and **down**
after, with the lever animating down over ~450ms on the flip. Before it is thrown it is the
only thing in the keep drawn in `--sig-amber`; after, it is dead metal.

### 6b. The moment

Host-authoritative (like every other world-state flip), broadcast, and it is one way — there is
no un-intensifying.

1. `hordeCalledBy = <player name>` and `intensified = true` on the host.
2. **A normal toast**: `"<NAME> CALLED THE HORDE"` — `showToast`, the existing device.
3. **A siren** — a new procedural sound in `zombie-audio.js`. An air-raid/bomb siren: a slow
   sawtooth-ish pitch sweep up and back down, two cycles, ~3.5s, low-passed. It is the one
   sound in the game that is **not positional** — it is coming from everywhere.
4. **~1.2s after the siren starts**, full screen: **THEY HEAR YOUR CALL**, crude red, vibrating.
   A DOM overlay in `Zombie.html` (not canvas) so it can use the existing retro font stack and
   sit above the HUD. The vibration is a per-frame integer jitter of a few pixels on
   `transform: translate()`, snapped — no smooth sub-pixel drift, which would read as modern.
   Holds ~2.2s, then cuts (not fades — it is not a gentle thing).

All three beats are driven off one broadcast flag with local timers, so a guest sees the same
sequence from the snapshot rather than needing three events.

### 6c. What intensified changes

| | normal | intensified |
|---|---|---|
| round clears when | `roundBudget === 0` **and** `zombies.length === 0` | `roundBudget === 0` alone |
| zombie speed | `spec.speed` | **x1.28** — "a fair amount, not overkill" |
| score while alive | none | `SCORE_ALIVE_PER_SEC` per second alive, per player |
| music | the organ | cold drumming, sparse notes |
| round cue | `round` (a rising call) | `roundHard` — percussive, and it rises per round |

- **The round no longer waiting for the last zombie is the blitz.** Note the Blackout
  interaction: a Blackout round currently cannot clear until the generator is restarted
  (`&& !genTripped`). **Keep that** — it is a deliberate 2026-09-18 mechanic and the one thing
  that should still be able to hold a round open. Intensify drops the *empty-map* condition,
  not the generator one.
- **x1.28 on speed**, applied where `spec.speed` is read, not written into the zombie — so it
  applies to everything already on the map the moment the switch is thrown, and a runner goes
  2.05 -> 2.62 rather than something unplayable.
- **Score for time alive** rides the run-score system that landed 2026-09-19
  (`runScoreFor` in `zombie-game.js`). A new `aliveMs` term, accumulated per client while
  intensified and not downed, at a rate calibrated against that function's existing terms:
  `50 * round^2` for rounds and 8,000 a silo. Start at **40/sec** and check it against a
  modelled round-25 run before committing — it must be a real incentive to flip the switch
  without dwarfing kills.

### 6d. The score turns cold

`zombie-music.js` is beat-scheduled at 66 BPM off the audio clock, which is what makes this
tractable: the drum is another voice in `musScheduleBeat`, gated on `intensified`.

- **Drums**: a dry kick on 1 and 3, a hard rim/click on the off-beats. Noise burst plus a
  fast pitch-dropped sine, no reverb tail. "Cold" = short envelopes and no room.
- **The organ recedes**: `musOrganBus` drops well down and the soprano is cut entirely. What
  is left of the harmony is **sparse** — one chord tone per bar on the bell voice, from the
  same `MUS_PROG`, so the key does not change and the end cues still land in D.
- **`roundHard`**, replacing the `round` cue while intensified: percussive, and it **rises with
  the round** — the cue's notes transpose up by a semitone per round over the base, capped, so
  the escalation is audible over a long run. "A harsher more percussive raising note each time"
  is exactly this.

### 6e. Wire

Two new fields on the world snapshot, both tiny, riding the generic relay as everything here
does: `iz` (0/1) and `hc` (the name that called it, a short string, sent only while the
announce window is live). `intensified` must also survive `resetGame()` — it is cleared there.

## 7. Placements that make sense, and stay put

Today there are **two** layers of randomness: templates are shuffled into zone slots
(`assignZones`), and then guns and perks are shuffled across zone *indices*
(`placeWallBuys`, `placeCardStations`). So the sniper is in a corridor zone by design, and
everything else is a coin flip — the same map twice running puts the shotgun in two unrelated
places.

**Bind the gun and the perk to the TEMPLATE, not to the zone index.** The zone still moves
around the map, but THE KENNELS always has the shotgun, wherever the kennels are — which is
what makes a place memorable, and it is the same reasoning that gave the sniper its corridor.

| Gun | Home | Why |
|---|---|---|
| SNIPER | any `corridors` template (SPILLWAY, THE LAUNDRY) | already the rule; now guaranteed |
| SHOTGUN | THE KENNELS | 17 buildings, the tightest ground on the map |
| FLAMER | PUMP HOUSE | fuel and pumps |
| ROCKET | SLAG HEAP | 12 barrels; the most explosive zone there is |
| SMG | MOTOR POOL | |
| RIFLE | COLD STORAGE | |

**Guns use an ordered preference list and always place.** Only 8 of the 11 outer templates are
on any given map, so a gun's home is often absent; it falls to its second choice, and finally
to any free outer zone. Losing the rifle — the cheap first upgrade off the pistol — to a map
roll would be a real balance regression, so no gun is ever dropped.

**Perks may genuinely be absent**, which the brief allows outright, and which the game already
handles: 11 perks against 8 stations means three are missing every run, `absentCardKeys`
already names them in the field manual and announces them when the generator first runs.
OVERDRIVE stays guaranteed (`CARD_ALWAYS`), and goes to TURBINE HALL — the one template that
is always placed, and thematically the power. SALVAGE to SLAG HEAP, CONDUCTOR to PUMP HOUSE,
LAST STAND to an `outpost` template.

**Silos are already deterministic** relative to their funnels (beside, piped) and silo 1 is at
fixed world coordinates in the sluice. What is *not* deterministic is which zones the two
funnel halls land in (`planFunnelHalls` shuffles). Same treatment: prefer named templates,
fall back in a fixed order.

---

## 8. PROPOSAL — the map after the 3x3

**Not being built in this pass.** The brief asked for a proposal and this is it; nothing below
is implemented, and none of it should be started before items 1–7 have been played.

### What the 9-rectangle grid is actually buying

Worth stating before proposing to break it, because three systems depend on the grid and not
merely on the look:

1. **`zoneHotUntil[9]`** — spawn placement is "which zones are cold", nearest first. It needs
   a partition of the map into nameable regions, and it needs to be cheap. It does not need
   them to be *rectangles*.
2. **Every boundary carries a door and a boarded window.** That pairing is the whole
   segmentation design (`CLAUDE.md`, "Map"): there is no zone the horde cannot follow you
   into. It needs each pair of neighbouring regions to share a wall segment long enough to
   hold both.
3. **Off-map spawning** is the fallback when nothing is cold, and `z.entered` is a one-way
   leash. It needs edges zombies can walk in through.

A revamp keeps 1 and 2 and **must** think hard about 3.

### The proposal

**Keep nine regions. Stop making them rectangles, and stop making the perimeter one.**

- **A ragged perimeter with two edge conditions.** North and west go to **deep forest** —
  a soft, permeable edge: trunks as scattered solids, no wall, zombies walk in through it, and
  it is where the off-map spawns come from. South and east go to **hard boundary** — a real
  concrete wall with the sluice and the escape set into the south. This immediately makes "we
  are on the east side" mean something, and it fixes an existing oddity: `buildZoneWalls`
  emits no perimeter at all today, so the map's edge is currently invisible.

  **The catch, and it is the important one:** off-map spawning must then be restricted to the
  forest edges. If the team camps the south-east, the fallback spawner has to walk zombies in
  from much further away, and contact time goes up exactly where the map is hardest. Measure
  it before committing — this is the same trap the 45s zone cooldown already had to solve, and
  `CLAUDE.md` records what happened when a permanent "visited" flag doubled contact time to
  25.6s.
- **Linear sectors are fine; interchangeable ones are not.** Keep the sectors roughly banded,
  but give each a silhouette a player can name from the minimap. The sniper zone already
  proves the model — it is unique, functional, and *paired with the gun found there*. That
  pairing is the thing to replicate, and item 7 above is the first step toward it.
- **The stormwater tunnels.** The strongest idea in the brief. The generic wall blocks that
  form corridors today become **actual storm drain**: long uninterrupted pipe runs drawn as
  pipe — ribbed barrels, a graded floor sloping down into the mouth, a painted invert line,
  grate light from above. The grade is drawn, not simulated: a vertical gradient and a
  foreshortened mouth read as "down" without touching movement. Pairs naturally with SPILLWAY
  and PUMP HOUSE, and gives the sniper's long sightline a reason to exist in fiction.
  `zombie-floors.js` already does per-zone floor texture, so the machinery is there.
- **The hedge maze.** Good, with one warning: a maze of soft cover is a **pathfinding and
  visibility** change, not a decoration. Hedges that block sight but not movement need a third
  solid set (the game has two), and hedges that block both make a maze of 78px-minimum
  corridors that the flow field will route the ULTRA HEAVY into. If it is built, build it as
  **sight-blocking, movement-blocking, and generously wide** — 160px lanes, not 90 — and
  expect to re-run the traversal measurement.
- **One landmark per sector, drawn big.** A water tower, a crane, a collapsed gantry, a rail
  spur. Visible from outside the sector and on the minimap. This is what makes "meet me at the
  crane" work, which is the actual goal behind "recognizable features that players remember".

### Sequencing, if it goes ahead

1. Perimeter and edge conditions first, with the off-map spawn measurement. It is the only
   part that can break the spawner.
2. Then per-sector silhouette and the one landmark each — pure generation plus draw, no new
   systems.
3. Stormwater tunnels as a template replacement for `corridors`, reusing `zombie-floors.js`.
4. The hedge maze last, and only with the traversal harness re-run.

Item 7 is a prerequisite for all of it: a memorable sector is one where a known thing lives.

---

## Verify before calling any phase done

From the repo root:

```
node scripts/check-global-collisions.js
node scripts/check-undefined-globals.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
```

Then read what doc-sync flags and fix it before `--update`.

Game-specific, because none of the four can see any of it:

- `zombie/CLAUDE.md` — the load order table, the narrowest-opening list (4b changes it), the
  endgame chain (4c, 5), the controls (6a), "Zones have identity" (7).
- Two clients through the local relay for anything host-authoritative: **6** especially, since
  `intensified` is a new broadcast flag and a guest must see all three announce beats.
- `file://` double-click, every time. It is the hard constraint.
