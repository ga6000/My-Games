# Zombie — file-by-file

Co-op survival. **The first game in this repo split into classic-script files** rather than one
monolithic HTML — the structure `GAME_PROTOTYPE_INSTRUCTIONS.md` §2 describes but no game had
adopted. Rebuilt 2026-09-01 from a 1040-line single file.

## Load order (matters)

Classic `<script>` tags, no modules — the `file://` hard constraint. **All files share one global
scope**, so every top-level name across them must be unique. Run
`node scripts/check-global-collisions.js` from the repo root after any change here; it reports
`zombie\Zombie.html (10 local scripts)`.

**Updated 2026-09-07.** The dev-tools pass added `../shared/devtools.js` and `zombie-dev.js`, so
the checker now reports **14** local scripts. (2026-09-04: two shared files were added by the
aesthetic pass, taking it to 12.) (The 2026-09-02 revision of this table fixed an earlier count of 7
that omitted `zombie-audio.js` and `zombie-endgame.js`.) Full load order as it actually appears
in `Zombie.html`:

| # | File | Owns |
|---|---|---|
| 1 | `../shared/identity.js` | `window.IDENTITY` — the one name→colour fallback. **Must precede mp-core** |
| 2 | `../shared/mp-core.js` | `window.MP` — transport, room seed, identity |
| 2a | `../shared/retro.js` | `window.RETRO` — `snap`/`flicker`, used by `zombie-render.js` |
| 2b | `../shared/leaderboard.js` | `window.LB` — score submission, used by `zombie-game.js` |
| 2c | `../shared/devtools.js` | `window.DEVTOOLS` — the L+G dev panel. **Must precede this game's files**: its error capture only sees throws after it installs, and its keydown listener has to be attached before `zombie-render.js`'s so a combo press can be stopped from also reaching the player |
| 3 | `zombie-core.js` | World size, camera, teardown plumbing, geometry + wire-time helpers |
| 4 | `zombie-audio.js` | Procedural Web Audio, positional mix, `M` mute, event playback |
| 5 | `zombie-level.js` | Seeded geometry, the solid spatial index, `moveWithCollisions` |
| 6 | `zombie-entities.js` | Players, weapons, zombie archetypes, bullets, pickups |
| 7 | `zombie-endgame.js` | Roles, sluice gate, funnels, silos, the flood, the escape |
| 8 | `zombie-game.js` | Round curves, simulation, economy, revive loop |
| 9 | `zombie-net.js` | MP wiring, snapshots, broadcast |
| 10 | `zombie-render.js` | Draw, HUD, minimap, input, **boots the loop** |
| 11 | `zombie-dev.js` | Dev-panel registration: the state readout and the playtest buttons. **Last** — it reads names every file above declares, and registers only |

*(A duplicate `zombie-endgame.js` tag on line 258 was removed 2026-09-02. It threw
`SyntaxError: Identifier 'ROLES' has already been declared` on every load without breaking play.
`check-global-collisions.js` was silently deduping the src list and so could not see it; it now
flags any page listing the same `src` twice. See `PROJECT_MEMORY.md` → Technical debt.*
*Three **identical duplicate CSS rules** were also removed 2026-09-03 — `#ui .role`, `#objective`
and `#win` were each declared twice, byte for byte (51 rules → 48). Purely cosmetic: a repeated
identical rule changes nothing at render time. The two remaining `#startprompt` duplicates are
**deliberate** — they are `@media (max-width: 620px), (max-height: 560px)` overrides with
different bodies, so don't "clean" those up. A repo-wide scan found no other file affected.)*

`zombie-net.js` runs `MP.connect()` at load, and `zombie-render.js` starts the RAF loop at load.
Everything else only declares. That's why render goes last — `zombie-dev.js` sits after it because
registration is inert, not because it needs the loop running.

## Lighting, generator, cards

The map is **dim until the generator runs**. `ambientDarkness()` is the single source of truth.

> **Corrected 2026-09-04.** This table used to read 0.55 / 0.00 / +0.20, which contradicted both
> the "Lighting" section further down *and* `zombie-game.js`. Those are pre-2026-09-02 numbers —
> the generator has not returned the map to full daylight since. The live values are below and in
> one place only.

| State | ambient | constant |
|---|---|---|
| Generator off (default) | 0.72 | `AMBIENT_DARK` |
| Generator on | 0.22 — lit, never full daylight | `AMBIENT_LIT` |
| Blackout round | **+0.20 on top of whichever applies** | `AMBIENT_BLACKOUT_ADD` |

Clamped to 0.9. **Do not add a second copy of these numbers anywhere** — that is exactly how the
two tables came to disagree.

Your light is a radial gradient: fully clear to `LIGHT_RADIUS` (340), fading to ambient over an
extra 33% (to ~452). A canvas radial gradient paints its last stop everywhere beyond the outer
circle, so one fill does the pocket, the falloff and the flat ambient together.

v2 blacked out at **0.94 with a hard-edged 210px hole**, which playtested as a guaranteed loss.
Blackout after the generator is now a 0.20 dip with 2.6x the fully-lit area.

**Powerup cards**: 3 slots, each **stackable to x3**, bought at card stations and **inert until
the generator runs**. `OVERDRIVE` (fire rate, requested) plus `SCAVENGER`, `RICOCHET`, `BEACON`,
`SPITE`, `CONDUCTOR` — deliberately not Perk-a-Cola equivalents. Every effect scales with stack.

`p.cards` is a **flat array with repeats**; the stack level is just how many times a key appears
(`cardLevel()`). That keeps the wire format an array of strings and leaves `hasCard()` unchanged.
Slots cap *distinct* keys at 3 — stacking one you already hold never needs a free slot. Cards ride
in the players payload (`cd`) because the **host** resolves damage and payouts and therefore needs
the *shooter's* cards, not its own.

**Four weapon wall-buys exist on the whole map** — one rifle, one shotgun, one SMG, one sniper, in
four different zones, the sniper preferring a long-sightline zone.

### Card economy — the balance that matters

Scrap income already scales **twice**: zombie count per round, and the rising share of high-value
brutes. An added round multiplier made it scale a third time, and round 20 alone paid 48,000
against an 87,000 cost to max every card — the entire card economy solved itself in one round.
So: no round multiplier, brute payout cut 250 -> 150, stack cost curve `1 / 2.2 / 4.0`, station
bases 9,000–13,500.

Measured cumulative income (solo, playing straight through): ~41k by round 15, ~182k by round 25,
against 64,800 to max one card and ~227,000 to max all three. First stacks land around round
12–18; maxing everything is a long-run goal. ### Pacing, measured

| | first visible | reaches you |
|---|---|---|
| Round 1, sealed in the centre | 4.6s | 11.3s (2 windows chewed) |
| Late game, whole map explored | — | 12.8s |

Early rounds are unchanged in pace but now *telegraphed* — you watch them mass beyond the boundary
and chew in. The 45s cooldown is what keeps late rounds at pace. With a permanent "visited" flag
instead, a fully explored map left off-map as the only source and contact time doubled to 25.6s
exactly when rounds should be hardest — which also made opening the map *easier*, backwards.

**Re-measure this if you touch zombie `scrap` values,
`budgetForRound`, or the brute share.**

## Audio

`zombie-audio.js`. Procedural Web Audio, zero sample files — see the header for why (file://,
the DOS palette, and Gyro Space's open mobile audio-freeze bug). Gesture-gated: `initAudio()` runs
on every input, nothing before. `M` mutes; the preference persists in `localStorage`.

The **intensity drone** (idea 45) tracks the live zombie count within 1000px and pitches a low
oscillator to it — silent below 4 zombies, full at 28. It exists because the tightened FOV took
away the player's ability to *see* how bad it is getting.

Sounds now cover: **per-weapon fire** (idea 40 — pistol blip, rifle crack, shotgun burst, dry SMG
tick, long sniper crack), kills, splitter bursts, the **screamer** (idea 44, carrying 2.2x further
than anything else, which is what makes it the callout target), barricade chewing and breaches,
downs and revives, pickups, doors, crates, traps and zaps, **round start/clear stings** (idea 42),
and game over.

**One-shot sounds are events, not state.** A client never receives "a zombie died", only a shorter
array — so the host drains an `eventQueue` into each snapshot as `ev`, capped at 10 per send so a
lagged packet can't dump eighty sounds at once. Per-entity ids are used *only* for sustained
sounds that must start and stop (barricade chewing), which key off stable array indices.
Everything is positional: pan by x-offset, squared distance falloff, hard cut past ~1500px.

Three rules for adding a sound:
- **Your own actions play locally and immediately** (`playEvent`) — a gun must never wait on a
  round trip. Broadcast the copy with `queueEvent`, which carries the actor id so that client
  skips its own echo. Without that the shooter hears every shot twice.
- **Gunfire and kills are throttled** (90ms / 70ms) or they fill the 10-slot queue every snapshot
  and crowd out breaches and downs.
- `hostEvent` = host-resolved, plays locally *and* broadcasts. `localEvent` = this client only.

## The three rules that break things quietly

1. **Never put an absolute `Date.now()` in a payload.** Clients' clocks are not synchronised.
   Everything time-shaped crosses the wire as a *remaining duration* via `msLeft()` and is rebased
   on arrival with `deadlineFrom()`. v1 shipped this bug: `flashTime` went over as a host
   timestamp, so a host running fast made every zombie render permanently white on every client.
2. **Level generation uses `MP.random()`, never `Math.random()`.** Every client builds the world
   independently from one server-issued seed. A stray `Math.random()` in `zombie-level.js` means
   two players collide with walls the other cannot see. `Math.random()` is correct for
   host-only rolls (zombie spawn placement, weapon spread) and per-client cosmetics.
3. **Nav resolution must exceed the smallest opening.** A gap is only *guaranteed* to contain a
   nav cell at `2*NAV_CELL + 2*NAV_PAD` px — cell size, plus the padding on each side, plus up to
   a whole cell lost to grid alignment. At `NAV_CELL = 40` that threshold was 106px, which silently
   made nook holes, outpost doorways and narrow windows **invisible to the pathfinder**: walkable
   in fact, sealed as far as the flow field was concerned. **Check this before shrinking any
   opening.**

   *Corrected 2026-09-07.* This used to give the formula as `2*NAV_CELL + 16` and the current
   threshold as 56. The `16` was half a **walker**, but the pad has been sized for a **brute**
   since the 106px note two paragraphs down in `zombie-level.js` — the two halves of the same
   invariant disagreed about which zombie they were protecting. With `NAV_CELL = 20` and
   `NAV_PAD = 15` the real threshold is **70px**. The narrowest opening in the map is the outpost
   doorway at 112, windows are 112–151, doors 124–159, so everything clears it.
4. **Opening a door refreshes only its own patch of the nav grid.** A full rebuild is 32,400
   cells and cost ~17ms — a dropped frame at the exact instant of a purchase, which is the worst
   possible moment for a stutter. `rebuildSolidIndex` diffs the door signature and calls
   `refreshNavRegion()` on just the doors that changed (1.3ms, and bit-identical to a full
   rebuild). A full rebuild is still used when the level itself is regenerated.
5. **The nav grid must be invalidated whenever geometry changes.** `generateLevel()` calls
   `markNavDirty()` explicitly, and it has to: `rebuildSolidIndex()` only re-checks the *door*
   pattern, and a freshly generated level has the same all-closed pattern as the old one — so
   without the explicit call the grid silently survives from the previous layout and zombies path
   against walls that no longer exist. Barricades deliberately do NOT dirty it (they're passable
   in the field either way), which is what keeps a window breaking from costing a ~14ms hitch.

## Authority

Host-authoritative world, client-owned players. The host alone runs zombie AI, resolves damage,
owns the round clock and the scrap pool, and decides who goes down. Clients own their own
movement and predict their own shots (the host filters those copies back out of the snapshot).

**The WebSocket server is a separate repo and cannot be changed**, so every mechanic here rides
mp-core's generic `relay`. Message kinds in use: `players`, `world`, `shoot`, `down`, `up`,
`dead`, `rvs`, `pickup`, `buy`, `bought`, `ping`, `reset`.

**Spending must stay host-validated** (`hostHandleBuy`). Scrap is a shared pool; two clients
pressing buy on the same frame would both pass a local affordability check and spend it twice.

### The host owns the GEOMETRY SEED too (2026-09-07)

Added after the reported "the map regenerates entirely, mid-game, ten rounds in — every door shut
again and a new layout".

`onPeerSync` used to end with an unguarded `if (MP.seed() !== levelSeed) generateLevel();`. **That
hook is not a one-shot.** mp-core fires it from *every* `players` message the server sends — join,
leave, and the rejoin handshake — and the line immediately before it in `mp-core.handle()` is
`if (typeof data.seed === "number") setSeed(data.seed)`. So any time the server came back with a
different seed, `generateLevel()` ran and cleared `walls`, `doors`, `barricades`, `wallBuys`,
`ammoCrates`, `barrels`, `traps`, `zoneHotUntil` and the entire endgame chain, mid-fight.

The server hands back a different seed when the room was garbage-collected while everyone was
briefly disconnected and then recreated on rejoin. mp-core reconnects on a 3s timer after every
`onclose`, so a sleeping free-tier instance — or a sleeping laptop, which is what local testing
hits — produces this routinely rather than rarely.

The hook's original purpose is still real: a client that missed mp-core's 6s connect timeout got a
throwaway clock seed and genuinely does need to rebuild once the room seed lands. It simply cannot
be told apart from "the seed moved ten rounds in" *by looking at the seed*. Two changes fix it:

1. **`onPeerSync` only regenerates while `gameStarted === false`.** Once the game is running the
   level is in play. A seed change then re-pins MP's stream to the geometry on screen
   (`MP.reseed(levelSeed)`) and leaves the world alone.
2. **The host publishes `ls: levelSeed` on the world snapshot**, and a client whose level does not
   match adopts the host's and rebuilds *once*. One integer on a packet that already ships 15×/s,
   riding the generic `relay` — nothing is asked of the server, which is just as well. It is
   applied at the **top** of `applyWorldSnapshot` so the door/barricade/crate rows in the same
   packet land on the corrected geometry, and it converges in a single step because
   `generateLevel()` sets `levelSeed = MP.seed()`.

That makes the host authoritative over the geometry the same way it already is over the doors and
barricades indexed against it, and hands a mid-game joiner the host's map rather than the server's
newest seed.

`generateLevel()` is therefore called from exactly four places, and only two of them are reachable
once a run is under way: page load, `resetGame()`, `onReady`, and the snapshot's `ls` heal.

## Zones have identity

Nine 1600×900 zones, each with a seeded template and a name you can call out (`zoneName(i)`):
`COLD STORAGE`, `THE DRY POOL`, `SPILLWAY`, `THE KENNELS`, `DEAD LETTER`, `SLAG HEAP`,
`TICKET HALL`, `THE ANNEX`, `PUMP HOUSE`, `MOTOR POOL`, `THE LAUNDRY`, plus `TURBINE HALL`
(always exactly one — it holds the generator) and `THE BLOCKHOUSE` at the centre.

Templates differ in building density, barrel and crate counts, whether they have a holdable
outpost, and whether they have long sightline corridors. That is what makes "which door do we
buy?" a real decision rather than a coin flip.

**Boundary cover spurs must be clipped 150px clear of a boundary intersection.** Unclipped, a spur
from one wall and a spur from the perpendicular wall formed an L that boxed in a corner pocket
nothing could path into — a free safe spot, and a trap for any zombie that wandered in.

## Map — 3×3 segmented zones

4800×2700 — 9× the old arena — split into nine 1600×900 zones, with a panning camera showing a
**960×540** window (tightened from 1600×900 on 2026-09-01; 2.78× less world on screen).

You start sealed in the centre zone and buy outward. **Every zone boundary carries both a door
and a boarded window**, and that pairing is the whole design:

| | Players | Zombies |
|---|---|---|
| Closed door | blocked (buy to open) | blocked |
| Boarded window | blocked, always | break through it |
| Breached window | **still blocked** | free passage |

That asymmetry is why segmentation is safe: there is no zone the horde cannot follow you into, so
"start small" can never become "hide in a box". It is enforced by **two separate collision
grids** — `solidGridPlayer` counts every barricade, `solidGridZombie` only intact ones. Bullets
use the zombie set, so a window you've lost stops being cover.

Other consequences worth knowing:

- **Zombies path on a BFS flow field**, not a beeline (`navFieldFrom` / `navStepToward`). Naive
  chase does not survive segmentation — see the pathfinding section below.
- **Zombies never spawn in ground the team is in or beside.** Spawn sites are limited to zones
  that are COLD -- nobody has been in or next to them for `ZONE_COOLDOWN_MS` (45s) -- nearest
  first, placed as close to the shared boundary as they can get. Never-entered zones are cold from
  the start. If nothing is cold they come in from off the edge of the map instead. Nothing is ever
  placed inside anyone's view.

  **Two checks divide the work and both are needed.** The zone cooldown covers "ground the team is
  in or beside"; `visibleToAnyone()` rejects individual points currently on screen. So a zone you
  can see a sliver of stays usable, minus the sliver. Marking whole zones from the player's *view
  box* instead does not work: that box is 1824x1026 against 1600x900 zones, so from the middle of
  the map it marks all nine and nothing is ever spawnable again.

  The ring-around-the-player placement this replaced put zombies in the player's *own* zone,
  directly behind them. Because the camera is player-centred, walking back the way you came
  revealed that ground and the zombie read as having materialised in a space you were looking at
  moments ago.

  `zoneHotUntil[]` is host-owned and broadcast as nine **remaining durations** (`vz`, never
  timestamps), so a promoted host doesn't immediately spawn in ground someone is standing in.
- Solids live in a uniform grid (`rebuildSolidIndex`). **Call it whenever a door opens or a
  barricade breaks or reboards**, or collision goes stale.
- Draw is culled to the view rect. The minimap and off-screen teammate arrows are not optional
  decoration — without them you cannot find anyone.

## Pathfinding — why it's a flow field

Segmenting the map broke naive chase AI completely, and it broke it in ways that each looked like
a different bug. Recorded because every one of these is easy to reintroduce:

1. **Beelining** walks a zombie into a boundary wall a few hundred px from the nearest window,
   where it stays forever. Wall-following heuristics got most of the horde through and reliably
   stranded the rest — "the round never ends" is worse than a slow round.
2. **Cell-centre passability sampling was the big one.** Testing a 16px box at each nav cell's
   centre makes a 20px wall *invisible*, because it falls in the gap between two adjacent cell
   centres. The field then flowed straight through solid geometry and confidently steered zombies
   into walls. `rebuildNavGrid` now tests the **whole cell**, padded by half a zombie.
3. **Off-field recovery needs line-of-sight.** A zombie pressed flat against a wall sits in a cell
   the BFS never reached; the recovery search then picked the lowest-distance cell nearby — which
   could be on the *far side of a closed door*, 20px away. `navClearLine` prevents that.

4. **Diagonal corner-cutting caused oscillation that no stuck-detector could see.** `navStepToward`
   would pick a diagonal neighbour that was open while the wall corner between them was not. The
   zombie walked at a target it could not reach, slid off, re-entered the cell it came from, and
   repeated forever — *moving every frame*, so the stuck counter never accumulated and none of the
   unstick paths ever ran. This was the real cause of "zombies that never arrive", and it survived
   three earlier rounds of heuristic fixes. A diagonal is now only considered when **both**
   orthogonal neighbours are passable.
5. **Steering compared a centre-space goal against a corner-space position** (found 2026-09-07,
   the cause of the reported "brutes, screamers and splitters wedge on corners at broken
   barriers"). `navStepToward` is handed a centre and returns a nav-cell **centre**, but
   `updateZombies` subtracted `z.x` — the **top-left corner** — so every zombie steered with a
   constant bias of half its own body toward +x/+y. It aimed its corner where its centre should
   go, and the body rode off the path it had been handed.

   The bias scales exactly with size: brute 13px, splitter 12, screamer 10, against walker 8,
   runner 6, spawnling 4.5 — which is why only the big three showed it. For a goal 100px dead
   right a brute steered 6.6° downward while already sitting 13px off the sampled line, eating
   ~25px of the 43px of clearance a 112px window gives it. The straight-line fallback needed the
   same fix: `target` is a player, whose `x` is also a corner.

   **Both sides of that subtraction are now centres.** This is the single highest-value fix of
   the four — see the measurements below.

Barricades are passable in the field (they're the way in); the chewing happens on arrival, and
**chew is checked before steering** so a zombie at a window attacks it instead of sliding past.
A zombie that stops making progress is re-placed by `relocateZombie` — not cosmetic, because a
round only clears when the map is empty and one pinned brute stalls the game forever. It uses
`pickSpawnPoint(z.size)`, so the destination obeys the same visibility and sealed-sluice rules a
fresh spawn does; if no legal spot is found in 8 tries the zombie is **despawned**, which is
strictly better than leaving it wedged.

> **`relocateZombie` never actually ran before 2026-09-07.** It read `SPAWN_RING_MIN` and
> `SPAWN_RING_MAX`, *neither of which existed anywhere in the repo* — so every call threw a
> `ReferenceError` straight out of `updateZombies`, taking the rest of `update()` with it:
> `updateRevives`, `updateTraps`, `interpolateRemotes`, `pruneRemotePlayers`, `broadcastPlayers`
> and **`broadcastWorld`**. `gameLoop` re-arms its rAF first (deliberately), so the host kept
> drawing and looked perfectly healthy while every other client in the room froze solid. And
> because the throw landed before `z.stuck = 0`, it repeated every frame forever. **One wedged
> brute silently ended the session for everyone.** `scripts/check-undefined-globals.js` now exists
> to catch exactly this, and is in the pre-commit hook.

**Two triggers reach it, and they catch different failures:**

- `z.stuck > 240` — ~4s of a zombie that genuinely cannot move at all.
- `z.noProgress >= PROGRESS_FAILS_TO_RELOCATE` (4 windows of 800ms, ~3.2s) — a zombie that
  *moves every frame and travels nowhere*. This needed its own counter: the per-frame check sets
  `z.stuck = 0` on any frame with movement, so the old watchdog's `z.stuck = Math.max(z.stuck, 6)`
  ping-ponged 0 ↔ 6 and **could never climb to 240**. The escape hatch was unreachable for
  precisely the failure it was written to catch.

**Chewing and being ON TARGET are both exempt** from the progress watchdog, for the same reason:
a zombie standing on a barricade or mauling a player is making no progress *by design*. Without
the on-target exemption a packed swarm reads as a crowd of stuck zombies and the watchdog
teleports them off the player one at a time — measured at 438 spurious relocations in 38 simulated
seconds before the exemption, **0** after.

**Zombies cannot leave the map.** There is no perimeter wall (`buildZoneWalls` only emits the
interior boundaries) and zombies move with `clampToWorld = false` so they can spawn off the edge
and walk in — but nothing stopped them walking back *out*, and a zombie past the edge is off
camera, unshootable, and holds the round open forever. `z.entered` is a **one-way leash**: free
movement until the body is fully inside once, clamped for the rest of its life.

### Measured (2026-09-07)

Headless traversal, 24 seeded layouts × 24 runs per type, every door open and **every barricade
already broken** — the exact reported failure condition:

| | walker (16) | runner (12) | screamer (20) | splitter (24) | brute (26) |
|---|---|---|---|---|---|
| before | 99.8% | 100% | 99.1% | 97.0% | **95.1%** |
| after | 100% | 100% | 100% | 100% | **99.8%** |

The failure rate tracked body size exactly, which is what identified the centre-space bug as the
cause. In the live game, 160 zombies weighted to the big three (growing to 320 as screamers
summoned) crossed a ~2000px average with 0 relocations, 0 despawns, 0 escapes off-map and no
errors; brutes and splitters 100%.

## Controls — ONE player per screen

WASD moves, the mouse aims, left click fires. `F` uses/buys, `Q` or middle-click pings.
**`L`+`G` together opens the dev panel** (2026-09-07, `zombie-dev.js` + `shared/devtools.js`) —
neither key is bound to anything else here.

### The dev panel does NOT pause this game

Deliberate, and the same call the field manual already makes for itself ("The round does not pause
while you read this"). The host simulates for the whole room; pausing it locally would freeze
everybody else. `onOpen` only releases the local player's held keys, so nobody walks into a wall
behind the overlay.

**Round state, `zombies` and `scrapPool` are host-authoritative, so those buttons are host-gated**
and say so — a guest writing to them locally gets one frame of a lie before the next broadcast
overwrites it. `OPEN SLUICE` is the one worth knowing about: the two-plate gate is the only
mechanic in the game that is *strictly impossible alone*, so without that button a solo playtester
can never see anything past it.

Every weapon has a **screen-shake kick** (`WEAPONS[].shake`, in *screen pixels*): pistol 1.8, SMG
1.3, rifle 2.6, shotgun 8, sniper 10. `applyCameraTransform` divides by `camera.scale`, so the
felt amplitude is identical at any zoom or window size — measuring shake in world units would
have silently scaled every kick when the FOV tightened. Cap 17, decay 0.84: punch, not wobble.

**Couch co-op was removed 2026-09-01** after playtesting: three schemes on one keyboard
(mouse-follow / WASD / arrows) was too much for a standard player to control. `players` is still
an *array* of 0 or 1 — every consumer iterates it, and collapsing it to a bare object would have
meant touching all of them for nothing. Networked multiplayer is untouched; only local
splitscreen is gone.

Two things fell out of that removal:

- **Idea 23 is retired, not implemented.** The right-click hold-position modifier existed only
  because the old mouse-follow scheme made your movement vector and your aim vector the same
  thing. WASD-move + mouse-aim decouples them, so strafing is native and the workaround has
  nothing left to fix.
- **The camera no longer zooms.** Zoom-to-fit existed to frame multiple couch players; it now
  just pans a fixed 1600×900 window.

## Deliberate deviations from `DESIGN_IDEAS.md`

- **Doors gate rewards, not passage.** They seal the four compounds (which hold the better
  wall-buys and crates). The open map is always traversable, so a group can never lock itself out
  of anywhere it needs to go.
- **The pistol is infinite.** Ammo scarcity only means something if you can be generous with it,
  but a team that runs completely dry has no way back into the game.
- **Darkness is Blackout-round only** (every 7th), not permanent — a user call.
- **Pickups are `OVERCLOCK` / `ADRENALINE` / `RALLY`**, deliberately not the 1:1 CoD set — a user
  call. Ammo resupply is a map feature (crates) instead, which is what keeps it from being Max
  Ammo renamed.

## Reading the map at a glance

Doors and barricades were being mistaken for each other, so they now share **no** visual language:

| | Door | Boarded window |
|---|---|---|
| Colour | cool blue | warm timber brown |
| Shape | flat slab, hard frame, a post at each end | individual planks with nail heads |
| Shut | price plate + keyhole | plank count falls as it is chewed |
| Open | dark threshold, blue posts remain, chevrons through it | flashing red frame, broken stubs, **BREACH** |
| Who passes | players and zombies, once bought | zombies only, ever |

Keep that split if you touch either. The whole point is that a *bought door* and a *broken window*
are both holes in a wall, and the player must be able to tell them apart instantly.

## Lighting

`ambientDarkness()` is the single number. Generator off **0.72**, generator on **0.22** — the
lights never restore full daylight — and a Blackout round adds **+0.20** on top of whichever
applies. The player's light radius therefore matters at all times, not only on Blackout rounds.

### The ramp is quantized into four bands (2026-09-04)

`AESTHETIC_GUIDE.md` §6.3: the era had no smooth gradients. `drawLighting()` was one radial
gradient and is now four flat steps — lit / near / far / ambient — computed from **the identical
inputs**:

| Band | Radius | Alpha |
|---|---|---|
| lit | ≤ `LIGHT_RADIUS` | 0 |
| near | → midpoint | `dark × 1/3` |
| far | → `LIGHT_RADIUS × LIGHT_FADE` | `dark × 2/3` |
| ambient | beyond | `dark` |

**No balance number moved.** 0.72 / 0.22 / +0.20, `LIGHT_RADIUS` 340, `LIGHT_FADE` 1.33 and the
downed player's ×0.55 are all untouched — §5 lists this game's lighting as untouchable because
v2's 0.94 blackout playtested as a guaranteed loss, and quantizing the *ramp* is explicitly the
change that does not re-open that. Measured after the change: 255 / 194 / 133 / 71 on a white
field at `dark = 0.72`, with the steps landing at 342 / 399 / 453 px.

**The trap, if you ever rewrite this:** the obvious implementation is a flat ambient fill plus
`globalCompositeOperation = "destination-out"` to punch the light back out. That is wrong, and it
looks right until you check. `destination-out` removes alpha from **everything already on the
canvas**, not just from the darkness layer — so it erases the world inside the light pocket and
leaves a transparent hole precisely where the player is supposed to see. It was written that way
first and caught by sampling the canvas. The shipped version draws **disjoint annuli** with the
`evenodd` fill rule: source-over only, nothing is removed, and non-overlapping regions cannot
compound into the wrong alphas either.

**Blackout rounds now drop colour instead of adding darkness.** One
`globalCompositeOperation = "saturation"` fill over the canvas, gated on the same
`isBlackoutRound(round) && roundPhase === "active"` condition `ambientDarkness()` uses, so the
two can never disagree. Scarier than more black, and it avoids re-litigating a balance decision
that already failed once. The DOM HUD keeps its colour — the readout is a device, the world is
what has lost its colour.

## Aesthetic pass and the leaderboard (2026-09-04)

`AESTHETIC_GUIDE.md` §6.3 — **RASTER** cabinet, anchor *Berzerk* (1980). Session 1 of
`COLUMN_COMPLETION_ROADMAP.md` Phase 1; the plan is `zombie/AESTHETIC_PASS_PLAN.md`.

Zombie now loads two of the shared Phase-0 files, so the page is **12 scripts, not 10**:

| # | File | Added |
|---|---|---|
| 3 | `../shared/retro.js` | `RETRO` — `snap` and `flicker` in `zombie-render.js` |
| 4 | `../shared/leaderboard.js` | `LB` — `LB.submit` in `zombie-game.js` |

Plus `<link rel="stylesheet" href="../shared/retro.css">` and
`<body data-game="zombie" data-cabinet="raster">`, which is what selects this game's world hue
(`#FF4A1C` ember) and permits the scanline overlay — the scanline CSS is gated on
`data-cabinet` so it cannot be applied to a Vector game by reaching for a class name.

**Rendering changes, all in `zombie-render.js`:**

- Lighting quantized to four bands, and blackout rounds drop colour — see the Lighting section.
- **Zombies are blocky, ≤3 colours**: body, a flat shadow band (a constant `rgba`, not a computed
  shade — this runs for every zombie on screen every frame), white for the existing hit flash.
- **Positions are snapped with `RETRO.snap(v, 4)` at the DRAW CALL ONLY.** `z.x`/`z.y` are never
  written. Same discipline as Glucose Dash keeping its curve inside `SX()`: quantizing the
  simulation would produce collision bugs that present as gameplay bugs.
- **Flicker budget (§4.7)**: past `ZOMBIE_DRAW_CAP` (40) zombies *on screen*, the overflow renders
  on alternating frames. Measured with a synthetic 100-zombie horde: 40 drawn every frame, the
  other 60 split 30/30 across two frames — 70 draws per frame instead of 100. Counted against
  zombies actually **on screen**, not the array index, or the budget would depend on where the
  camera is pointing. **Screamers are exempt** — the white outline is how you find the callout
  target in a crowd, and one that renders every other frame is a gameplay regression wearing an
  aesthetic hat.
- **Muzzle flash**: one white frame, derived from the existing `p.lastShotTime` rather than any
  new state, so there is nothing extra to reset, sync or tear down.
- `zFrameCount` drives the flicker budget. It is **not a timer** — it ticks once per rendered
  frame in `gameLoop`, so it needs no `trackTimeout`/`trackInterval` registration.

**The HUD moved onto the shared tokens, mapped by meaning** rather than taste, which is the whole
point of the Signal Three being semantic: structure is `--phos-mid`, live numbers `--phos-hot`,
scrap `--sig-amber` (value/interact), weapon `--sig-cyan` (system), role and cards
`--world-hue`. The two end cards used to be green and red; **WIN is now cyan** (goal reached) and
**GAME OVER magenta** (death), which is the same vocabulary every other game will use.

**Leaderboard.** `LB.configure({ game: "zombie" })` at the end of `Zombie.html`;
`submitRunToLeaderboard()` in `zombie-game.js` fires from **both** `triggerGameOver()` and
`triggerWin()`.

- **The score is the round reached.** `scoreBoard[id].score` exists but is per-player kill credit
  inside one run and is host-owned; the number a survival game's board wants is how far you got,
  which is also the number the game already puts on the game-over card.
- `zLbSubmitted` guards it. `triggerGameOver()` is reachable **both** locally (everyone died) and
  from the host's `go` flag in `zombie-net.js`, so without the guard a client posts its run
  twice. `resetGame()` clears it so a replay can post again. Verified: one post per run, a
  second `triggerGameOver()` posts nothing, and a reset-then-replay posts once more.
- Name and room come from `MP.selfName`/`MP.room`, the same source as every other identity value
  here. **Under `file://` `LB` is a silent no-op**, so a double-clicked game is unaffected.

## The field manual

A terminal in the keep (`codexRect`), opened with F. Five tabs: weapons, cards, pickups, enemies,
the map. **Every table is generated from the live data** — `WEAPONS`, `CARDS`, `ZOMBIE_TYPES`,
`wallBuys`, `cardStations` — never hand-written, so it cannot drift from the balance numbers. It
also reads the actual zone names, so it tells you where *this* map's sniper is.

While it is open it swallows keyboard and mouse, or reading it would walk you into a wall and empty
your magazine. The round does **not** pause — it can't, the host owns the simulation.

## The Blood Silo endgame — how a run is won

`zombie-endgame.js`. Until this, a run could only end in failure.

    sluice gate (two players, two locks)
      -> funnel room, kill zombies ON the funnel to fill silo 1
      -> throw silo 1's switch to open funnel 2  ->  silo 2  ->  funnel 3
      -> third silo full: THE FLOOD, off every map edge at once
      -> clear it: the southern escape grinds open over 90s
      -> reach it: WON

Things to keep in mind if you touch it:

- **The sluice is at fixed world coordinates, not seeded.** It is the one landmark every run
  shares, so "meet at the sluice" has to mean the same place every time.
- **The gate needs two players** — two plates 436px apart, and two consecutive holds (the second
  is 1.6x longer). Releasing a plate drains progress, but slower than it fills.
- **Only kills inside an active funnel's radius fill its silo.** Every other system in the game
  rewards killing zombies wherever they are; this is the one that asks you to fight in a chosen
  place, which is what makes the funnel room a set piece.
- **THE FLOOD deliberately bypasses the zone-cooldown spawn rules** and comes off all four map
  edges. It is the one moment where zombies appearing everywhere at once is the intent. Normal
  round spawning pauses while it runs, or the two systems fight over the budget.
- **Nothing may spawn inside the sealed sluice.** It is a closed box until the gate opens, so
  anything placed in there is stuck for the whole run. `inSealedSluice()` enforces it; do not
  remove that check on the assumption it can't happen — it currently doesn't only because the
  sluice sits at the far south of its zone and spawn placement favours points near the player.
- `escapeAt` crosses the wire as a **remaining duration**, like every other timer here.

## Roles

Randomly assigned, but **derived from the client's own id hash — never dealt by the host**. No wire
traffic, survives a reconnect, and consistent with how colour and identity already work.

`roleForId()` deliberately does **not** use `hashToUnit()`: that keeps only the low bits of a djb2
hash (`% 10000`), and djb2 low bits cluster hard for similar strings. Across 400 ids it dealt
engineer 270 times, scout 40 and **medic zero**. It now runs a proper avalanche finalizer before
the modulo, which measures 187–210 of 800 for each of the four.

| Role | Passive |
|---|---|
| `MEDIC` | Revives 40% faster and ignores the per-round revive escalation |
| `ENGINEER` | Traps 40% cheaper (stacks with CONDUCTOR); reboards come back at 150% |
| `SCOUT` | Double ping reach, pickups on the minimap, +10% speed |
| `GUNNER` | +15% damage (applied at the damage site, so it covers ricochets and barrel chains) |

## Known gaps

- **A solo player cannot be revived.** Downed needs another *alive* player in the room, which is
  now necessarily a networked teammate. Playing alone, going down is a 25-second crawl that ends
  in death regardless — strictly worse than just dying. Worth either shortening the bleed-out
  when no reviver could possibly exist, or giving solo players a self-revive. Not done; it's a
  design call, not a bug.
- ~~**No audio at all**, so the downed-teammate alert is visual only.~~ **Wrong since v3
  (2026-09-04 correction).** `zombie-audio.js` has existed since v3 — this same file lists it at
  position 4 in the load order and documents it at length two sections above. Downs and revives
  both have sounds. The entry survived because "Known gaps" was never re-read when audio landed.
- **Nav pad is sized for the largest zombie plus skin** (`NAV_PAD = 15`; a brute is 26px, so 13
  is exactly half of one). It was 13 until 2026-09-07, which gave a brute *exactly zero* clearance
  in a cell the field called passable — any float error at a corner clipped. Every opening a zombie
  must use is wider than `2*NAV_CELL + 2*NAV_PAD` = 70px. If you add a narrower opening, large
  enemies will quietly stop using it.
- **A solo player cannot finish a run.** The sluice gate needs two people on two plates, so the
  whole Blood Silo chain — and the only win state — is unreachable alone. That is the deliberate
  point of idea 57, but it means solo play is still endless-survival-until-death.
- **No manual weapon switching.** A wall-buy equips what you bought; you can't cycle back to a
  weapon you already own.
- `window.GameInstance` is deliberately **not** implemented — see
  `GAME_PROTOTYPE_INSTRUCTIONS.md` §2. The `trackTimeout` / `AbortController` plumbing in
  `zombie-core.js` exists anyway, per the root `CLAUDE.md` hard constraint.

<!-- doc-sync: 896eb087 | 2026-09-07 -->
