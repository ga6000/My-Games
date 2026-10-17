# Zombie — file-by-file

> **2026-09-27: Zombie is two games — read `THE_SPLIT.md` first.** This folder is **ZOMBIE, the
> hub game**: a one-sitting co-op arcade run, heading for a frozen v1. The rail-connected world,
> campaign, survival-sim and roguelite ideas belong to a separate *long game* and must not be
> prototyped here. Route them to `../IDEAS_INBOX.md` instead.

> **2026-10-04: this folder is ZOMBIE ARCADE, an open map.** The hub's goal is now 2–5 minute
> sessions (`../SCOPE_RULES.md` rule 0), and this game is heading for a **2–4 minute** run
> (`../HUB_1_0_PLAN.md` Phase 2).
> - **The walled build with the train is parked at `../under-development/zombie-rail/`**
>   (tag `zombie-rail-fork`). Everything below about sectors, boundary doors, windows, buildings,
>   stamps, pipes, bays, the maze and rail crossings describes **that** build. Here,
>   `openTheArena()` (`zombie-level.js`, flag `ARCADE_OPEN_MAP`) removes it all after generation.
> - **What survives**, by tag: `perim` (the south/east hard wall), `column` (the escape gate),
>   `trunk` (forest), `landmark`, and `railcar`. There are no doors, windows or thresholds, and no
>   room floors without a room.
> - **Every placer still runs**, in order and off the same random stream, so items stand where
>   they always did. Then the walls come out from under them.
> - **The rail stays until the first open-map playtest** (user), then goes.
> - Measured: round 1 reaches an idle player in **13.0s** (11.3s through windows on the walled
>   map), with no errors. `check-map-features.js` checks the open-map invariants while the flag is
>   on; its walled baselines describe zombie-rail. `check-zombie-train.js` skips the two crossing
>   checks when a map has no doors.
> - The sector paint, the map editor and the stamps still run, and on this map they now edit
>   ground nobody sees as walls. Trimming them is step 2e.

## The arcade rules — `zombie-arcade.js` (2026-10-04)

`../HUB_1_0_PLAN.md` Phase 2d. The user's brief: a swarm that *"escalates way too quickly"*, so the
team is **overwhelmed around 4:00** and the run is a race to finish the chain and get out first.
Drops come from kills, each drop has **one taker**, and the game has to *"reward cooperative play"*.

All of it is in `zombie-arcade.js` (#7b, between the train and `zombie-game.js`), switched by
**`ZOMBIE_ARCADE`** in `zombie-core.js`. The other files hold one-line hooks only, so trimming
has one place to look. The page is **24 local scripts**.

| | |
|---|---|
| **Clock** | One continuous wave on elapsed `T`, host-owned, sent as `el` (elapsed ms, a duration). Level = 1 + ⌊T/12⌋. It drives the old round curves: type mix, HP, speed, and the HORDE/BRUTE/Blackout waves. Spawn rate is 0.8/s × 2^(T/50) × team scale. The alive cap is 60 + 30/player, but splitter children land on top of it (a kite test reached 229 solo at 4:20, which is the overwhelm). Spawns land on a 640–900px ring around a random living player, outside a 0.62×view box |
| **Chain** | Power on, sluice open and no levers (`arcadeStart`). Tanks take **8/12/16** kills. Tank 3 opens the gate over **30s** (`ESCAPE_OPEN_MS`). There's no flood (the wave already is one) and no train: the rail is scenery and `trainUpdate` doesn't run |
| **Win** | **Every player still standing must be inside the exit zone** (`arcadeUpdateEscape`). A downed teammate has to be revived or left. Anyone left gets no escape bonus (`wonAboard`, reusing the train's rule). The card reads THEY GOT OUT / LEFT BEHIND |
| **Drops** | Replace the wall-buys, stations, crates, traps and levers (all cleared in `openTheArena`). Kinds: gun (by level), perk (9; CONDUCTOR and SCAVENGER are out), and the team drops AMMO, OVERCLOCK, RALLY, FUEL (+4 to the live tank) and SHOCKWAVE (the swarm thrown back through the SUPER SPLITTER's launch phase). Every drop is **24px**. The chance is 6% per kill, guaranteed within 25 kills. A drop lasts 25s, at most 6 are live, and they blink for the last 5s |
| **One taker** | `requestBuy("drop", id)` → `arcadeHostTake` → `bought` → `arcadeApplyTake` on every client. So the host decides, and two players on one frame produce one taker. **Guns and perks need F**, so you can leave one for a teammate. Team drops are walked over. Full perk slots refuse the drop with "CALL IT OUT" |
| **Respawn** | 10s after bleeding out (15s until 2026-10-11), beside a standing teammate (`arcadeRespawnDue`, `arcadePlaceRespawn`) |
| **Separation** | `separateZombies()`: a uniform 32px grid, a push capped at 1.4px/step, through `moveWithCollisions`. It skips flying and chewing zombies. **Zombies on their target are NOT exempt**: with them exempt, the whole cap stood in ONE 20px cell on the player |

**Measured, headless in the real page (seed of the moment):**
- Max bodies per 20px cell: **51 → 2–13**.
- A flamer player standing on funnel 1 fills tank 1 by **0:21**, gets touched by **0:12**, and
  touches climb steeply from ~1:20. Standing still loses well before 4:00.
- Running the chain end to end, ignoring the fighting, is **7,853px ≈ 33s** at 4px/step.
- **0.25ms per simulation step** at 68 alive.
- Drop take, perk refusal, team ammo, expiry, and the gate win both blocked (1/2 at the gate)
  and then won together, all verified.
- **Not measured:** a full winning run. The scripted kiting player is too weak to stand in for
  people (6–37 kills per 20s). The playtest is the measurement.

> **2026-10-11:** the arcade now has TWO maps; the table above describes map 1. Map 2 is in "Seventh".

**Not updated for the arcade yet:** the field manual still describes wall-buys, stations, crates
and traps, and the horde switch and generator still stand in the map. Those are step 2e's trim.
*(2026-10-04, later: the field manual, the horde switch and the generator are gone from the map; see
below. The manual's code is still loaded, just unreachable.)*

### Multiplayer fixes, easier, aim aids (2026-10-17, branch `zombie-funnel-pipes`)

- **A guest could never leave a map.** `esc` went over as `msLeft(escapeAt)`, which is 0 once the
  gate is open, and a guest read 0 as "not started": on a guest the gate never opened, its
  `gateBar` stayed solid, they were never OUT, and the host waited for them forever. `esc` is now
  signed (negative = opened that long ago). **Verified with two real clients** (local
  `server.js`, two tabs): the guest sees the gate open and its bar gone; both walked out, 2/2, and
  both arrived on map 2.
- **The start trays never reached guests:** the snapshot carried `tr` twice (the trays and the old
  traps row), and the traps won. The trays ride as `ty` now.
- **One perk tray per player:** `arcadePlaceTrays` counted `teamSize()` at the instant of the
  start, when every client has just reset and the host has not yet heard from anyone (1). It
  takes the lobby party's size too (`arcadePartyIds`).
- **Each player starts on their own pedestal slot**, above their own tray (`arcadeMyStartX`: the
  party's ids sorted, so every client agrees). It was a hash of the tab token, which bunched up.
  Verified: two players, 72px apart.
- **Easier** ("too hard" for 2 of 3 testers, even on casual): spawns start at 0.6/s (was 0.8) and
  double every 60s (was 50); each extra player adds 30% (was 40%); the alive cap is 48 + 24 per
  player (was 60 + 30). The slider now reaches maps 1 and 2: their rate +-60% and cap +-40% of the
  slider's distance from 1 (was +-10% and nothing). Zombie speed follows it everywhere
  (`arcDiffSpeed`: casual 0.92, brutal 1.08). **Not measured by a bot sweep or a playtest yet.**
- **Aim aids** ("bigger crosshair or laser sight in esc menu ... visibility issues"): the ESC
  menu's **AIM** button cycles STANDARD / LARGE / LASER / LARGE + LASER (`arcAimMode`, kept per
  browser). LARGE draws a white crosshair and ring with a black outline at the aim point and hides
  the system cursor. LASER draws a line in your colour from you along your aim until a wall or
  620px. Drawn after the lighting (`arcadeDrawAim`).

### BUTCHER and BULWARK, the scout's SATCHEL, two turrets each, turrets tire (2026-10-17, branch `zombie-funnel-pipes`)

- **Six classes now** (`ROLE_KEYS` + `butcher`, `bulwark`). The hash deals modulo the list
  length, so **everyone's dealt class changed once.**
- **BUTCHER:** their funnel kills add `BUTCHER_BLOOD` (2) to the backlog (`creditFunnelKill` now
  carries the killer's id); a funnel with a standing butcher inside drains every
  650 x `BUTCHER_DRAIN_K` (0.667) ms (`butcherInFunnel`). Measured: 4 units drained in 2s against 3.
- **BULWARK:** absorbs `BULWARK_HIT_STEPS` (3) hits and goes down on the **fourth**
  (`arcHitSteps(id)`; the red edge pulses on the last step whatever the count). Zombies within
  `BULWARK_TAUNT_R` (150px) follow a bulwark-seeded flow field and target them (`arcBulwarks`,
  `arcBulwarkField`, built with the other fields). Their `"shot"` rounds shove what they hit
  (`BULWARK_PUSH` 4px a step for 90ms, the launch phase already on the wire).
- **SCOUT is the quartermaster** ("THE SATCHEL"): good drops they walk over go into a host-owned
  satchel (`arcSatchel`, `SATCHEL_MAX` 2, on the snapshot as `sat`) instead of taking effect,
  even ones they couldn't use. [Q] (the ping is gone in the arcade) tosses the oldest out 80px
  ahead (`what: "toss"`) as a drop flagged `tossBy` (7th element of a pickup row), which no scout
  re-stashes. Their kills drop 50% more (`SCOUT_DROP_K`); their radar draws each drop's time
  left. The side panel shows the satchel above the perks. Kept over a map change, cleared on a
  new run.
- **Turrets:** two per player (`TURRET_PER_PLAYER`; a third retires your oldest; the map cap is
  now 8). **They tire:** past `TURRET_TIRE_MS` (3:00) of age, life drains an extra
  `((age - 3:00) / 30s)^2` per ms, so a SALVAGE engineer turret parked on a funnel can't hold the
  swarm off it forever (the soft lock).

### Dev drops and class, a near-instant medic, a sure-footed scout (2026-10-17, branch `zombie-funnel-pipes`)

- **Dev panel (L+G):** `CLASS` cycles MEDIC, ENGINEER, SCOUT, GUNNER and back to your dealt
  class (`zDevRoleOverride`, honoured by `myRole()` and by `idHasRole()` for your own id; local
  only, so teammates still deal yours from your token). `DROP <TYPE>` puts a real drop 70px ahead
  of you for every team drop, the turret, the Boomgun, each hazard, a random gun and a random perk
  (`zDevDrop`, host only).
- **MEDIC:** revives in 0.2s (`MEDIC_REVIVE_K` 0.27 of the arcade's 0.75s) from 1.8x as far
  (`MEDIC_REVIVE_RANGE_K`: 46 to 83px, 64 to 115 once reviving).
- **SCOUT:** mud slows them only to 75% (`SCOUT_MUD_SPEED`) for 3s (`SCOUT_MUD_MS`), not 50% for
  5s. Measured: 3.3 against 4.4, about 3s.

### Engineer turrets carry perks, overclock drives the machines, classes in ESC (2026-10-17, branch `zombie-funnel-pipes`)

- **An ENGINEER's turret reads its owner's perks live** (`eng`, set by the host from the placer's
  id; `arcadeUpdateTurrets`). OVERDRIVE speeds its fire (`TURRET_OD`, the gun table);
  RICOCHET/SKEWER/SEEKER go on its rounds; ARC and BLASTCAP proc on its kills (src `"shot"`);
  SALVAGE kills add `TURRET_SALVAGE_MS` (1.5s) to its bar at the gun perk's chances, capped at a
  full life (`arcadeTurretKill`); SPITE goes off when it expires or is chewed down
  (`arcadeTurretSpite`). ATTRACT and LAST STAND do nothing for it. Before this the ENGINEER did
  nothing at all in the arcade (its traps and windows are gone).
- **Anyone else's turret is plain:** its rounds are src `"turret"` (not a `PROC_SOURCE`), so
  ARC/BLASTCAP no longer fire off any player's turret. `updateBullets` passes `b.src` when a bullet
  has one.
- **OVERCLOCK drives the machines** (`arcOverclockUntil`, set in `applyTeamPickup` on every
  client): turrets and the Boomgun fire twice as fast while it lasts (`OVERCLOCK_MACHINE` 0.5).
- **Measured** (engineer turret into a row of brutes, 1s each): 9 shots plain, 17 with OVERDRIVE
  x2, 33 with OVERCLOCK on top. SALVAGE x6 added 7.5s over ten kills. SPITE x3 went off on expiry.
- **MEDIC was slower than everyone in the arcade:** it used a fixed 1.8s against the arcade's flat
  0.75s revive. It is now 0.6x whatever the revive costs.
- **The ESC guide has a CLASSES section** (`GUIDE_CLASSES`), arcade-accurate and lighting the
  player's own. `ROLES`' blurbs still describe the walled game.
- **Hazards do expire:** `HAZARD_LIFE_MS` (20s), checked.

### ATTRACT pulls, sidebar perks in colour (2026-10-17, branch `zombie-funnel-pipes`)

- **ATTRACT no longer reaches out; it pulls** (`arcadeMagnetDrops`, run every step on every
  client from `update()`). A takeable drop (not a hazard, not one the holder would refuse) inside
  `ATTRACT_PULL[stacks]` (96 / 136 / 172 / 204 / 232 / 256px; x0.8 on 10-17, "25% too powerful")
  slides toward the nearest holder at `(48 + 24 * stacks) * (1 + 3 * closeness^2)` px/s, so it speeds up as it closes. It is taken
  only when it **touches** you: `arcadeWalkOverDrops` uses no pad now. The speed has no stored
  velocity, so the host (whose drop positions ride the snapshot) and a guest predicting between
  snapshots move it alike. Measured at x3 from 157px: 157, 134, 116, 84, 48, then taken, at 100ms
  steps. ~~`ATTRACT_REACH`~~ is gone.
- **Held perks in the side panel show the perk's own colour** (`PERK_TINT` behind a white icon),
  as their drops and the ESC guide already did. They were world-hue icons on black.

### The blood run: a backlog funnel, one L-shaped pipe, a riser, READY waits for the blood (2026-10-16, branch `zombie-funnel-pipes`)

`zombie-arcade.js` "THE BLOOD RUN". The user's calls: the tank must WAIT for the blood; the funnel
is a BACKLOG that drains steadily and OVERFLOWS, and kills past the tank's capacity still fill it;
the pipe goes HORIZONTALLY out of the funnel and elbows 90 degrees up the tank; the spatter starts
at the real kill.

- **Host-owned model.** A kill inside an accepting funnel (live, or full-and-unpumped) adds to
  `funnelBacklog[i]`, up to `FUNNEL_HOLD` (10). Past that the funnel overflows and the kill is
  spilled. Every `FUNNEL_DRAIN_MS` (650) one unit leaves while the tank has room
  (`funnelDrained[i]++`). It lands after its travel time (pipe length at `FLOW_SPEED` 380px/s +
  `FLOW_RISE_MS` 550 + `FLOW_POUR_MS` 320), and only then does `siloFill` go up. So READY, the
  switch, the labels and the score all wait for the blood. `arcadeUpdateBlood` runs from
  `updateEndgame`. A promoted host re-creates the in-flight blood from `funnelDrained - siloFill`.
- **The wire:** `fb` (backlog) and `fd` (drained, a running count). Every client draws a pulse down
  the pipe for each rise in `fd`. The kill's spatter comes off the `SND_CRATE` event
  `creditFunnelKill` already sends, at the kill's own spot (`arcadeFunnelSplash`, hooked in
  `playEvent`).
- **The route** (`arcadePipeRoute`, stored in `siloPipes` with a corner `cx,cy`): out of the
  funnel horizontally, a 90-degree elbow, to a riser's foot beside the tank. The riser climbs the
  tank's side and a gooseneck pours over the lid (`arcadeDrawRiser`, in the tall pass after its
  tank). On map 4 each riser stands in the gap between two bays, clear of the sight-glasses and
  switches. Back risers show only their neck above the lid.
- **The funnel** draws the backlog from the grate to the brim, and at the brim a wet ring and
  runs over the lip. An overflow kill's spatter is thrown out over the lip.
- **Measured in the page:** 13 kills at once fill the funnel to 10 (3 spilled), then drain one per
  ~0.65s. The tank reaches 10/10 and READY about 8s later, never before its last blood lands.
- **Smoothed and dressed (2026-10-17).** The pool follows the backlog on a soft, slightly
  underdamped spring (`arcadeFunnelLevel`, `POOL_K`/`POOL_C`), so kills and drains blend into one
  level that ebbs and swells instead of ticking between two. The pool's radius goes as the square
  root of the level, it sways while blood is moving, and the pulsing colour flash is gone. The
  overflow got a full treatment (`arcadeDrawPuddle`, `arcadeDrawOverflow`): a ground puddle with an
  irregular edge that spreads to `PUDDLE_MAX` (58px) while it overflows and soaks away after, drawn
  under the bowl; sheets over the lip ending in round lobes inside the puddle, with flow marks; a
  swollen meniscus; stepped ripples and popping bubbles; overflow spatter arcs out and lands. Flat
  fills only. Verified: with the raw backlog flipping 3/4/5, the drawn level glides 0.41 to 0.33.
- **Gameplay effect worth a playtest:** overflow wastes kills, so killing faster than the drain on
  a big tank (20) no longer helps once the funnel is brim-full.

### Grass masks, the long warehouse, concrete, low grass (2026-10-16)

- **One ground grid** (`arcadeGrassGrid`, 20px, built lazily per level, bits `GB_STRUCT / ROAD / NEAR / CONC / TREE`)
  records funnels, tanks, pipes, warehouses, props, the road corridor and concrete. **Grass is masked by it**
  (`arcadeGrassMasked`) in the ground pass, the flashlight-shade pass and the blades drawn in front of zombies, so no
  blade is drawn on a funnel, floor, road or slab, and a zombie standing there is not covered. The ground pass is
  also reordered: grass first, then set floors, concrete, roads (grass had been drawn OVER floors and roads).
- **Map 3's divider is an ultra-long warehouse** (`buildLongHouse`, 480x1370): closed ends, door openings (130px) in
  BOTH long sides about every 220px, columns (`column` prop) between the door rows and a rack across each door row on a
  grid, every gap inside >= 80px (the 78px nav guarantee), a floor, a lamp outside each door, and 90px concrete
  aprons down both outside faces. It replaces the solid "divider" slab (the kind is still used for the boss map's
  cover walls). The road planner still treats it as one rect, so roads keep clear of it.
- **Concrete on maps 3 and 4** (`arcadeDrawConcrete`, drawn UNDER the roads, never on a road corridor or under a
  tree): a pad round every funnel, tank and pipe, an apron round the warehouse (outside only), pads under the boss
  map's containers and walls, and a 3-cell link strip from each cluster to the nearest road (stopping at its edge),
  so nothing is isolated. About 6,400 cells on map 3 and 8,300 on map 4 (~25-30% of the arena); the knobs are
  `CONC_PAD`, `CONC_LINK_W` and `CONC_LINK_MAX`.
- **The last map has low grass** (`arcadeDrawLowGrass`): a 5-10% scatter (noise-varied) of short blades over open
  ground, `ROAD_NEAR` (170px) clear of every road, and off structures, slabs and the tall-grass band.
- **Verified headless (3 seeds x maps 3 and 4):** 0% unreachable arena cells on both nav grids (the long warehouse's
  interior included), 0 concrete cells on a road, every funnel masked. **Not seen by eye.**

**Follow-ups, same day.** (1) **"SILOS 17/10" on the win card:** the numerator counts every tank filled across all maps
(`silosFilled()` adds `arcL1Silos`, and the score is right: 17 x 8,000) but the denominator was the CURRENT map's tank
count. It is now `arcadeTotalSilos()`, the tanks of every map reached so far (25 on a full run). (2) **No concrete inside
either warehouse:** a tank pad or link strip used to lay slab under the map-3 warehouse; the bits are cleared inside
`arenaWarehouse` and `arenaLongHouse`, so the floor is the warehouse's own. (3) **Concrete meets roads flush:** concrete
and link strips now run UNDER the road's edge (up to a new inner-core bit, `GB_ROADIN`, radius 42) instead of stopping at
the kerb-plus-margin circle, so the join is a straight meeting with the road drawn on top, not a pointed stub.

### Ready card moved to the bottom (2026-10-16)

`#startprompt` (the attract run's PLAYERS IN PARTY / CLICK TO READY card) sat at `top: 50%` and covered the
scripted survivor being watched behind it. It is now pinned `bottom: 24px` of the play area
(`body.arcade #startprompt`, `Zombie.html`). On touch (`zombie-input.js`) it sits at `bottom: 66px`, just above
the USE / GUN row, with 34px squares. Checked at 1024x768 and an emulated 844x390: no overlap with the buttons,
centre of the screen clear. Not seen on a real phone.

### Shorter instructions, perks in a 2x2 (2026-10-16)

From a phone screenshot: the sidebar's objective line ran to 9 wrapped rows ("GATE OPEN - 0/0 OUT -
EVERYONE STANDING WALKS OUT THE BOTTOM") and pushed the perks off the panel. **`endgameObjective()` is now
terse everywhere (desktop and phone alike):** `FUNNEL 1  3/10`, `TANK 1 FULL  [F]`, `GATE OPENS 12s`,
`GATE OPENING`, `GO! 1/2 OUT`; the goal notes and the "EVERYONE TO THE GATE" short name are trimmed to
match. **`#perks` is a fixed 2x2 grid pinned to the bottom right of the loadout** (`Zombie.html`; 30px tiles
on touch in `zombie-input.js`), so four slots can never wrap off the panel. The ESC dialog's longer
explanations are unchanged on purpose. Not re-checked on a phone.

**Perk tiles cropped on a notched phone (same day, later).** The first perk column and the bottom row were
clipped. Cause: `body.touch #sidebar` pads its right side by `env(safe-area-inset-right)` (~60px on the test
phone) INSIDE the fixed 132px panel, leaving ~60px of content for a 70px grid, which overflowed left under
`overflow: hidden`. **`--side-w` is now `calc(132px + env(safe-area-inset-right))`** (read through
`offsetWidth`, so the canvas follows), the panel gets a bottom safe-area pad, and the "short phone"
compaction now starts under 400px of height (was 340) so two rows of perks fit at 844x390. Not seen on the
phone: the Browser pane here has no safe-area insets.

### Silo 1 not filling on phones: `onReady` rebuilt the level mid-run (2026-10-16)

Reported on two mobile sessions, never on a laptop. **Cause:** `MP.connect`'s `onReady` called
`generateLevel()` unconditionally. It fires when the socket lands, or when mp-core's 6s connect timeout
hands over a solo identity, and on a phone's network that is easily *after* the player has tapped READY.
`generateLevel()` rebuilds the arena arrays, so `funnelActive` went all-false and `siloFill` zero: tank 1's
funnel was dead and nothing counted. Reproduced headless (`arcadeStart`, fill 4, `generateLevel()` ->
`funnelActive [false,false,false]`, fill `[0,0,0]`). **Fix:** `onReady` now only re-pins the seed
(`MP.reseed(levelSeed)`) once `gameStarted`, exactly as `onPeerSync` already did; the rebuild still
happens before a run. Not re-verified on a phone.

### Fifteenth: gamepad and phone controls (2026-10-14)

User request; plan in `INPUT_PLAN.md`. **Reverses the 2026-09-04 "mobile switched off" decision for
Zombie only** (`../SCOPE_PULLBACK_PLAN.md` §1). Closes no `HUB_RETROSPECTIVE.md` §5 item.
All of it is **`zombie-input.js`**, script #26 (page is **26 local scripts**), driven by one
`inputFrame(now)` call in `gameLoop` *before* the simulation step. Deleting its tag removes it.

- **It never fights keyboard and mouse.** Movement goes in **`p.moveVec`** (analog, 0..1; read in
  `updatePlayers`, ignored once `p.exited` so the walk-out still owns `p.keys`). Aim writes
  `mouseX/mouseY` only while a stick is deflected (a point 240 world px out; only the direction
  matters). Fire writes `p.keys.shoot` on this module's own edges only.
- **Buttons call the keys' own functions** behind the same gates (manual, ESC dialog, reconnect hold,
  ready screen, walk-out): `inpAction()` mirrors the key handler's order.
- **Pad (standard mapping):** left stick move, right stick aim, **RT / RB / LT fire**, A use (also
  READY, and restart on the end cards), B Boomgun, X arm / stow / place turret, Y next gun, LB
  previous gun, Start ESC dialog (B / A / Start closes it), D-pad moves if no stick is held. Polled,
  not event-driven; the first connected pad is kept until it disconnects. Non-standard mappings are
  best-effort (axes 0-3, buttons by index).
- **Touch:** `#touchui` over the play area. Floating left stick moves; floating right stick aims and
  **auto-fires past 35% travel**; buttons USE, `< GUN`, `GUN >`, and BOOM / TURRET (shown only while
  you hold fuel / a turret; TURRET reads PLACE once armed); MENU top-left. Any tap ticks READY or
  restarts from an end card. Shown when `(pointer: coarse)` or on the first touch pointer; hidden
  while a pad is the last input. Portrait shows a "turn your phone" card.
- **Phone layout:** `body.touch` narrows the cabinet panel to 152px (`--side-w`), hides HI-SCORE /
  SESSION BEST / the goal list / the stats line, and shrinks the objective, so gun and ammo still
  fit at 844x390. The first touch asks for fullscreen and a landscape lock (silently refused where
  unsupported, e.g. iPhone Safari).
- **End-card guard:** a pad or touch restart is ignored for 1.2s after the card appears, because a
  held trigger or auto-fire stick would otherwise skip it. The mouse path is unchanged.
- **Ready screen** reads CLICK / TAP / PRESS A (`inputVerb()`, via `lobbyVerb()`).
- **Verified:** headless in the page with a faked `navigator.getGamepads` (A readies and starts; stick
  moves full and half speed; right stick aims; RT fires and releases; an idle pad leaves a held W
  alone; Y cycles; Start / B open and close the dialog) and dispatched touch pointer events at an
  844x390 emulated viewport (tap readies; stick moves; right stick aims and fires, releasing stops).
  Collision, undefined-global and camera checks pass. **Not verified:** real controller hardware, a
  real phone, two clients, or pointer capture on iOS. The Browser pane draws no frames here, so the
  loop was stepped by hand.
- **Phone fixes, same day, after a real-phone test (iPhone Safari and Chrome).**
  - **Select All / Copy on a long press.** `Zombie.html` had only the unprefixed `user-select: none`,
    which Safari ignores; the prefixed `-webkit-user-select` and `-webkit-touch-callout` are on
    `html, body` and `*` now (page and injected CSS), plus `selectstart` and `gesturestart` are cancelled.
  - **Buttons dead while a stick thumb was down.** Per-element pointer handlers (with pointer capture on
    the stick zones) were replaced by ONE set of `touchstart/move/end/cancel` handlers on `#touchui`
    that classifies every touch itself (a `.tb` button, or the left / right half). Each touch is tracked
    by its own identifier, so a stick and a button work together. `preventDefault` on `touchstart` is
    also what suppresses iOS's selection, magnifier and pinch from a held thumb. **Verified headless
    with synthetic multi-touch** (stick held; USE, NEXT, PREV and TURRET all fire; stick still held);
    **not re-verified on the phone.**
  - **Browser bars taking 20-30% of the screen.** No web API can hide Safari's bars on iPhone. Opened
    **from the Home Screen** the page runs with none (`apple-mobile-web-app-capable`, `zombie.webmanifest`
    with `display: fullscreen` and landscape). The ready screen shows a dismissible "SHARE > ADD TO HOME
    SCREEN" tip on iOS when not already installed (`zombie_a2hs_hint` in `localStorage`). Android Chrome
    still gets the first-touch fullscreen request. Safe-area insets pad the overlay and the panel.
    **No icon yet**: the Home Screen icon is a page screenshot until an `apple-touch-icon` exists.
  - The BOOM / TURRET buttons no longer show on the ready screen (the attract-run survivor holds both).
- **Phone fit (2026-10-15, from a screenshot).** All in `zombie-input.js`'s injected CSS plus two hooks in
  `arcadeNormalScale` / `arcadeDrawSidebar`:
  - **Minimap gone on touch** (`body.touch .cab-radar`, and `arcadeDrawSidebar` returns early via
    `inputHidesRadar()`). Panel narrowed 152 -> **132px**; gun, strip and perks right-aligned; the
    loadout compacted (gun icon 72x24, rounds 28px, perk tiles 27px). Under 340px of height the CONDITION
    row, the NEXT / CONDITION labels and the gun name also go. Checked at 844x390 and 667x320: panel
    `scrollHeight == clientHeight` (nothing clipped).
  - **Zoom x1.2 on touch** (`INP_ZOOM_BOOST`, via `inputZoomBoost()` in `arcadeNormalScale`): the
    follow camera and every "near" flythrough shot. The wide "fit" shot is untouched. 0.722 -> 0.866 at
    712x390. Everything that reads the view (spawn-outside-view, drop culling) uses `camera.scale`, so it
    follows.
  - **Toast, prompt, end cards, ready card, banners and the ESC dialog** are capped to the play area
    (`100vw - --side-w`) and wrap; the ESC dialog is inset to it and scrolls. **Not changed:** the ESC
    dialog's controls text still lists keyboard keys only.
- **Leftovers closed (2026-10-15).** The ESC dialog shows the touch controls on a phone (the keyboard
  lines are hidden under `body.touch`) and a one-line CONTROLLER mapping everywhere; the two end cards
  read Click / Tap / Press A to restart (`.rv` / `.ra`, set by `inpEndCardWords`); the gun strip drops
  its key numbers and T / B letters on touch; the Home Screen icon exists (`zombie-icon-180/192/512.png`,
  a flat ember "Z" on black, listed in `zombie.webmanifest` and as `apple-touch-icon`).
  **Still rough:** the perk tiles are 27px on a phone (32px would force a second row at ~320px tall).

### Fourteenth: blackout, perk trays, wind pulses, a pickup guide (2026-10-13, later)

Closes `../HUB_RETROSPECTIVE.md` §5 item 2 (arcade-side playtest fixes). User notes, in order.

- **The perk HUD no longer shows the last run's perks after a restart.** `hudReset` set `hudPerkSig`
  to `""`, which is also what an empty perk set computes to, so the tiles were never redrawn.
  It resets to `"?"` now (`zombie-render.js`).
- **Pulses are wind, not a ring.** A tank pulse and a stored RALLY (`arcadePulseAt`, radius
  `PULSE_R`) draw as 28 curved streaks swept round the centre while the front rolls out
  (`drawWindBlast`, flagged in `addBlast` by `radius === PULSE_R`, so guests get it from
  `SND_EXPLODE`). 800ms. **No "N CLEARED" in the toast.** On a solo stored RALLY a 8x8 pixel
  skull also rises ~260px off the player (`rallySkulls`, `drawRallySkulls`; local to the client
  that spent it, which is the solo one).
- **BLACKOUT is back (`zombie-arcade.js`, "BLACKOUT").** One or two outages a run, drawn in
  `arcadeStart` (`arcadeBlackoutPlan`): the first 25-90 run-seconds in, a second (50%) 60-150s
  after it. Each: SURGE `BO_SURGE_MS` 1.8s (lights brighten and stutter, `sndPowerSurge`), OUTAGE
  `BO_OUT_MS` 15s (`sndPowerOut`; lamps, sun shafts, drop glow and the exit flood dead; ambient is
  `BO_AMBIENT` 10% light; flashlights stay), RESTORE `BO_RESTORE_MS` 0.9s (stutters back on,
  `sndPowerUp`). **Host schedules; the snapshot carries `bo: [id, ms to outage, ms to end]`**
  (durations). Every client derives the phase and plays the sounds once per id, and a late
  joiner gets no stale sound. A map change or restart clears the event, not the run's marks.
  **Off in the attract run** (`zDemo`). The sounds are non-positional, at the end of
  `zombie-audio.js`. Not heard or seen by a human.
- **Four perk slots** (`CARD_SLOTS`, was six). Each perk still stacks to x6.
- **Perk drops are 30px** (`PERK_DROP_SIZE`; the rest stay 24), colour-filled per perk
  (`PERK_TINT`) inside the red border, **hovering** 0-6px in whole pixels over a flat shadow.
  Hit boxes stay on the ground. `DROP_APART` 44 -> 52.
- **Start trays** (`arcadePlaceTrays`, map 1 only): one concrete tray per player in the room at
  the start, in a row 120px south of the spawn, each holding a different perk drop that never
  expires (`until: 0`) and a recess shaped like the perk (`drawTrays`). Host-picked; the snapshot
  carries `tr: [[x, y, CARD_KEYS index]]`. A late joiner gets no tray. **Not checked that the row
  is clear of structures on every seed** - move `cy` if one is not.
- **ESC menu (`#help`, `renderPickupGuide`).** A PICKUPS section: every perk (tile in its own
  colour, effect numbers, a flavour line), gun and team/hazard drop. The stale walled-build text
  is gone (generator, scrap, breather, field manual, ping, sector names on the goals).
  Still non-pausing.
- **THE START: pedestal, eight trays, fountain, roundabout (map 1 only).** Offsets from the world
  centre, so every client agrees with no message (`arcadeStartLayout` constants, `START_*`,
  `FOUNTAIN_*`, `ROUNDABOUT_R`): a solid concrete **pedestal** 624x60 flush under the warehouse's
  south face (cy-230 - verified the same on every seed tried), **eight tray slots** below it (always
  drawn; only the first n of the room are filled, centred, `arcadeTraySlot`), a spawn strip below
  those (`START_SPAWN_DY`, players spread across it), and a **fountain** (solid 96px, animated
  ripples and arcing jets, `drawFountain`) centred 170 south of the world centre with the **road
  looping round it** at radius 110: the road now starts at the ring's south point, the ring is a
  closed polyline, and a short spur runs up to the spawn strip. The four start lamps moved out
  beside the fountain. Replaces the earlier 56px trays at cy+120. Checked headless on 4 seeds
  (no tree or wall in the complex besides the warehouse's own south wall; map-feature check
  clean; a bot run reaches map 2). **Not seen by eye, and the roundabout is not nav-measured.**
- **THE START, REVISED (same day).** The pedestal is **ground, not a collision** (drawn in the ground
  pass, `arcadeDrawPedestal`) and **you spawn on it** (`START_SPAWN_DY`); it and the trays moved 40px
  south (`START_PED_TOP` -190) clear of the warehouse. The roundabout is a closed loop with **no road
  leading north**. **An opening is cut in the warehouse's south wall** (190px, straight above the
  start; windows across it removed, a lamp each side, racks kept off it) in `buildWarehouseSet`.
- **TALL-GRASS BANDS (`arcadeDrawBands`, `arcadeDrawBandOver`, all four maps).** The east and west
  fence segments are `zpass`: they stop **players only** (`solidRectsFor(true)`, `rebuildNavGrid` and
  `refreshNavRegion` skip them), are not drawn as walls, and the 400px band beyond is tall grass.
  The north and south walls are drawn continuous across the bands. 40% of arcade spawns
  (`BAND_SPAWN_CHANCE`, in `arcadeSpawnPoint`) land in the band, level with a target, and walk in;
  while outside they are covered from the feet up by blades (more the deeper they are). Everything
  in the band goes dark outward in 10 stepped bands: a hard step at the fence, a slow fade to
  black. Bullets pass the side fence (they use the zombie grid). Verified headless: zombies pass
  and players do not on both sides, the nav field crosses the fence, the opening is walkable and the
  wall beside it is not; a bot run on map 1 completes. **Not seen by eye.**
- **GRASS TAPERS, AND IS WALKABLE (supersedes the hard-edged bands above).** `arcadeBandDensity`: 1 on
  the old fence line, easing to 0 by `BAND_TAPER` (420px, ~7 trees) on BOTH sides, pushed in and out
  by two octaves of large-scale value noise (`arcadeNoise2`), so no edge shows. Tint and blades are
  per 22px cell by that density; the dark fade is 24 fine steps with no step at the fence. **Players
  now stop `BAND_WALK` (300px) past the fence line** (the `zpass` wall moved out; zombies still ignore
  it), so the grass can be walked. **Flashlight filtering:** `arcadeDrawBladeShade` redraws the blades
  as dark silhouettes AFTER the lighting pass, so the beam is broken up by the grass. Zombies hide by
  local density, inside the arena too. Measured headless: density 1 / 1 / .45 / .07 / 0 at 0 / 100 /
  200 / 300 / 420px out. **Not seen by eye.**
- **GRASS, CORRECTED (supersedes the two band paragraphs above).** The boundary is **hard again, on
  the original fence line** (`zpass` walls back at `A.x` / `A.x + A.w - T`: players cannot walk off the
  side; zombies and the nav field still cross). The grass lies **inside** it: full at and beyond the
  boundary, tapering to 0 by `BAND_TAPER` (420px) inward with noise. **Zombie visibility is a straight
  line in height:** `arcadeBandVisible` = 30% of the body at the boundary (and beyond), 100% where the
  grass ends (measured 0.30 / 0.47 / 0.65 / 0.82 / 1.00 at 0 / 105 / 210 / 315 / 420px in). The
  flashlight still filters through the blades (`arcadeDrawBladeShade`). Not seen by eye.
- **Grass layering and colour (same day, later).** The grass is a dry golden-green (`#8E8A2A`..`#CDBE52`,
  zombie cover to match), distinct from the lawn and the trees. The flashlight-filter blades
  (`arcadeDrawBladeShade`, drawn after the lighting) skip any blade standing under a tree, prop,
  tank, zombie or player, so grass is no longer drawn on top of things. Ground blades were already
  in the ground pass, under everything.
- **GRASS IS INDIVIDUAL BLADES NOW (supersedes the per-zombie cover in the paragraphs above).**
  `arcadeDrawBandFront` draws real blades **in front of** each zombie in the grass: for every zombie,
  the blades on an 8px lattice whose roots lie below its feet (up to 34px) are drawn over it, so it
  walks between them; blades rooted behind it were already drawn with the ground. Density is still
  `arcadeBandDensity`. **Blade height falls with distance from the boundary** (`arcadeBandTall`: x1.0 at
  the boundary to x0.3 where the grass ends), for the ground blades, the flashlight-shade blades and the
  front blades alike. The old solid green rectangle over a zombie and the straight-line visibility
  (`arcadeBandVisible`, now unused) are gone, so how hidden a zombie is comes out of the blades'
  density and height rather than a number. Not seen by eye.
- **The attract run no longer restarts from black when the room's seed lands**
  (`lobbyLevelRebuilt` re-seats it with no `resetGame`). The hard-coded "CLICK TO START" was removed
  from `Zombie.html`; `zombie-lobby.js` writes the card.
- **Not verified:** any of the above by eye or by ear; two real clients; the tray row's clearance.
  A headless bot run completes (map 2 reached, no errors).

> **Superseded by the above:** "Sixth" item 5 / "Seventh" -> six perk slots (now four); the toast
> in "Tenth/Twelfth" that read "RALLY - N CLEARED".

### Thirteenth, addendum: the Boomgun is carried, and its ammo is its time (2026-10-13)

`p.boomUntil` is still the in-hand deadline (the renderer, the wire `bm` and `boomActive()` read it);
**`p.boomStore`** banks the fuel while it is out of your hands and does not drain. Picking one up **adds**
`BOOM_MS` (stacks to `BOOM_MAX_MS` 90s) and equips it (`arcadeBoomGrant`). **Switching to another gun** (keys
1-7, the wheel: `selectWeapon` / `cycleWeapon`) banks what is left; **B or 8** takes it back out
(`arcadeBoomToggle`); the gun strip shows a BOOM tile with its seconds whether in hand or banked. **A map
change and a down bank it** (`arcadeBoomCarry`; a map change hands it back when the flythrough ends,
`boomResume` / `arcadeBoomResume`). Previously it expired on a down and ran down through every
flythrough. **Turrets:** one carried at a time was already the rule (`TURRET HELD` refuses a second pickup);
unchanged. Headless: grant 15s, 5s used, switch banks 10s, 20s idle keeps 10s, B restores it, a second
pickup stacks to 25s, 9 pickups cap at 90s, a map change banks 20s and gives 20s back.

### Thirteenth: an attract run and a party ready screen (2026-10-13)

Closes `../HUB_RETROSPECTIVE.md` §5 item 2 (arcade-side playtest fixes). **`zombie-lobby.js`**, script #25,
after `zombie-dev.js`; **"CLICK TO START" is gone.**

- **The attract run (`zDemo`).** Before a run, behind the ready screen, map 3 runs on the curve's **15:00**
  mark (`DEMO_CLOCK_S`; read live from the difficulty) with a scripted survivor: every gun, every drop-perk x3,
  the Boomgun on a 24s cycle, turrets placed into crowds, no aim error, steering by the map's own flow field.
  **It never dies and ignores the objective**: it is untouchable (`invulnUntil` held) because its job is to be
  watched. It runs the game's REAL `update()` on this client alone: for each step `netOnline` is false and
  this client is its own host, so nothing reaches the room, and the game's net code otherwise sees a page that
  has not started. **Muted for it** (`zDemo` is read by `playEvent`, `showToast`, `triggerGameOver`,
  `triggerWin`, the cabinet's score and the loadout panel), and its stats, objective and checklist are hidden
  (`body.demo`). It is rebuilt when the room's seed lands (`lobbyLevelRebuilt`) and restarts itself if it ever
  ends.
- **The ready screen.** A square per player in the party (`MP.peers()`, or one when alone), blank until
  that player clicks (or presses Enter or Space), then ticked in their colour; "WAITING FOR PLAYERS n/m";
  when every square is ticked everyone starts together. The tick rides relay as `{k: "ready"}` (the sender's
  socket id is the key; re-sent every 1.5s and whenever the party changes, so a message sent before a friend's
  page was listening is not lost). **Nothing else works before the party is ready**: movement, fire, gun keys,
  the wheel and the mouse buttons are gated in `zombie-render.js` (`lobbyBlocks`), Esc, M and N still work.
  The click is also the browser's **audio unlock** (`initAudio`), which is the box "click to start" used to
  tick. Starting = `lobbyBegin()`: the same full `resetGame()` a restart does (so nothing of the attract run
  survives) and then `spawnPlayer()` -> `startGame()`. A restart goes back through the screen (everyone ticks
  again).
- **A friend joining a run in progress is not gated** (nobody to wait for): the first host snapshot that
  arrives while this page has not started (`lobbyRunSeen`) turns the card into CLICK TO JOIN.
- **Off** for the map editor, the stamp sandbox, `?nolobby=1`, and the headless harness (it reports itself as
  "node"), so the bot, the camera check and the map checks are unchanged.
- **Verified:** in the page, solo (a key starts nothing; the click ticks; the run begins on map 1 with a
  clean pistol-only player and the demo gone) and a stubbed four-player party (four squares; 3 of 4 holds;
  4 of 4 starts; three `ready` messages sent). **Not verified:** two real clients, the server's peer list
  carrying `name` and `color` as read here (it is what `mp-core` stores), or the attract run's feel over a
  long idle (it reaches ~285 kills in six simulated seconds).

### Twelfth: roads, one giant silo, spawnlings, session best, flythrough sounds (2026-10-12, later)

The user asked for six things in one message. Closes `../HUB_RETROSPECTIVE.md` §5 item 2 (arcade-side playtest fixes).

- **Roads (`arenaRoads`, `arcadePlanRoads`), reworked later the same day.** One continuous road from the
  spawn (map 1) or the entry tunnel (maps 2 and 3) through the arena and down the exit's tunnel, now limited
  to **0/45/90/135/180 degrees** (the unit checks every segment). The road is planned FIRST, before the tanks
  exist ("the road should look like it came before the things"): an octilinear A* (8 headings, a heavy cost
  per bend, so it is the straight line from the way in to the exit and bends only to slip between the
  structures) over the sets' footprints taken from the layout; a 90 degree change is two 45s. The structures
  it cannot pass cleanly are then **nudged** (`relax`): a set too near the road climbs away from it 20px at a
  time in whichever of eight directions helps most, and whatever it lands on gives way (forest, then hedge,
  then warehouse and the divider). Plan, nudge, plan again, twice; two readings of "keep clear" are tried and
  the better wins. **The tank's position in the layout moves** (`plan.offs`), so the funnel, tank and set all
  move together; map 3's divider moves too (`arenaDividerOff`). The corridor goes into `clear` before anything
  is built, so trees, containers and landmarks keep off it as well. Typical nudges: tens of px; the worst
  measured is a forest ~400px (it has no outline of its own). Map 2's hedge sits over the exit, so its road
  loops round the east side. 40px grid, ~0.3s a plan on maps 2 and 3. Visual only. Drawn in
  `arcadeDrawGround`, again over the entry tunnel's floor (`arcadeDrawRoadsIn`), and on the sidebar map.
  Map 4's hand-laid road has its 90 degree corners chamfered at 45 (`arcadeChamfer`).
- **Map 4 (`giant: true` in its layout row).** The rows moved apart (-250/+170 -> -470/+400) to make room
  for **one giant tank** between them (`giantSilo`, `buildGiantSilo`, `drawGiantSilo`): ten bays, each
  with its own gauge, 130px tall. **The ten funnels and their quotas (6/6/6/6/7/7/7/7/8/8) are unchanged**;
  every funnel pipes into the tank. `silos[k]` is still bay k (so the beacon, pulse, prompts and sidebar
  work untouched) and carries `use`, the whole base, so a full funnel's switch is thrown from anywhere
  along it. Only one solid is built. The pulse therefore always goes off at the hub.
  The road is hand-laid here: a stem from the entry, a **split north of the block, one half down each side
  (x = +-1540), both rejoin south of it** and go to the exit at dx -1200.
- **Cover on map 4 (`arcadeBuildBossCover`).** Eight listed pieces mirrored about the centre line = 16
  containers and concrete walls, in the band between the rows and in the gaps between funnels; the left side
  differs by two nudges and the hues so it is "almost" symmetrical. A landmark the seed happened to
  put on the road is removed.
- **Spawnlings on the boss map.** A second stream beside walkers and runners at `BOSS_SPAWNLING_MULT` (2) x
  the runner share of the horde, i.e. 0.6 x `BOSS_HORDE_RATE`, same cap, same ramp. It is *on top of* the
  horde (walkers and runners are unchanged). Read "spawns" as the splitter's spawnling (`ZOMBIE_TYPES.spawnling`).
- **HI-SCORE is the world's, read from Firebase** (`LB.top("zombie", 50)`, once per page; `shared/leaderboard.js`
  gained `top`, a read of the game's rows with the same equality filter `leaderboard.html` uses). It shows
  the holder's name beside the label. `localStorage` is now only the fallback for a page with no Firestore
  (file://, offline) and for a run that has just beaten the board, shown at once. **SESSION BEST** sits under
  it (`sessionStorage`, counted live; a new tab starts again). Rows with no `round` and a score under 50 are
  the oldest round-as-score rows and are skipped, the rule `leaderboard.html` uses.
- **A red handle switch at the base of every tank** (`drawLeverSwitch`, `arcadeLeverFrac`; map 4 has ten, one
  per bay). A plate on the face with a slot and a pivot bolt, a fat red arm and grip; **up until the tank's
  switch is thrown, then it falls** over 420ms with a little overshoot and a settle, and a lamp goes amber
  when the tank is full and waiting, green when pumped. The throw is **`SND_THUNK`** (27, appended; arg = tank
  index), sent by the host from `flipSilo`: a deep thump, a clank and a scrape, and it times the lever's fall
  on every client. A client that joins with a tank already pumped sees the lever down, not falling. The
  sight-glass moved to the left of the face to make room.
- **Drops no longer overlap** (`arcadeDropSpot`, `DROP_APART` 44px): a drop lands at the nearest spot, in
  rings outward, that keeps clear of every drop already standing, so a hazard can never sit under a good
  drop. When the ground is full there is no drop and the pity counter keeps its count. Forced 400 drops on
  one spot headless: nearest pair 45px.
- **The final win ends on fireworks** (`arcadeWinFade`, `arcadeDrawFireworks`): the walk-out plays, the screen
  goes to black in stepped fades (0.6s to 1.7s after `triggerWin`), and rockets and flat square sparks burst on
  the black from then; the win card comes up at 2.6s over them (`winFade` stays 1 in the arcade). Cosmetic,
  per client. Only the last map's exit ends a run, so only the final win does this.
- **The run clock stops when the run ends**: `arcadePlayS` clamps to `runEndAt` (a loss) or `winSeqAt` (a win),
  and the TIME ALIVE line does the same. It had kept counting under the game-over card.
- **A stored RALLY, solo only** (`arcadeStoredRally`, `p.rallyStored`, `soloRun()`): taking a RALLY with nobody
  else in the room keeps it (one slot; the sidebar shows RALLY STORED). The moment you would go down with
  nobody else standing it is spent: you are stood back up with 3s untouchable and the tank pulse
  (`arcadePulseAt`, 620px) clears the swarm round you. Take another to have it again. With a team a RALLY is
  the team revive as before. **Read as: the stored rally revives you too** (a shockwave on its own would only
  have cleared the crowd for the death card).
- **Flythrough sounds** (`arcadeIntroSfx`, from `arcadeIntroCamera`; voices at the end of `zombie-audio.js`):
  a whoosh as each shot that moves or zooms the camera begins, a ding per TANK n hold (the SAME note every
  time since the later round), a low dong on the gate hold (louder, with its octave and partials above it so
  a small speaker can play it: the 147Hz sine was inaudible). Driven from the shot list, so they cannot drift from the picture.

**Verified:** headless, 5 seeds x 4 maps: 0 unreachable arena cells, every funnel, switch strip and gate
reachable, roads clear of structures except the squeezes above; `zombie-camera-check`, the collision,
undefined-global and map-feature checks pass; a 6-minute bot run on map 4 fills 4 tanks through the giant
silo with no errors; in the page, frames of maps 3 and 4 and the sound schedule (whoosh/ding/dong order).
**Not verified:** by ear, by a human, or two real clients. The map 4 intro grew 18.1 -> 18.7s (rows moved).
The road reads dim under the night light on purpose; brighten `#3B3B3D` in `arcadeDrawRoads` if wanted.

### Eleventh: a flythrough for every map, and no hard cuts (2026-10-12)

The user: *"add level start animations for levels after 1 also, assure visual transitions are not
jumpy/jarring/or teleporting the camera for all."* Closes `../HUB_RETROSPECTIVE.md` §5 item 2
(arcade-side playtest fixes). **Supersedes** the 2.6s "SECTOR n" run-on in "Seventh" and "Ninth".

**The rule:** a hard change of world (a restart, a map change, a late joiner catching up) happens
**under black**. The screen fades out before it and in after it, and the camera is placed where the
next shot starts while nothing can be seen. All in `zombie-arcade.js` ("FADES" and "THE INTRO").

**What was jumping, measured** (headless, real camera code, 1100x700 canvas, seed 22352). The
"After" column is `node scripts/zombie-camera-check.js`, which holds EVERY map to map 1's limits
(pan 1.8 screen widths a second, zoom 2.2 e-folds a second, 600ms on each tank), and fails if a
hand-over steps or the swap lands on anything but a black frame. "Before" is the same measurement over `git show HEAD`:

| | Before | After |
|---|---|---|
| Map 1 flythrough, peak pan | 2,869 px/s (2.6 screen widths a second) | 1,760 px/s |
| Map 1 flythrough, peak zoom | 2.84 e-folds/s | 2.00 |
| Map 2+ intro | a 2.6s run-on; camera **teleported 273px** on its first frame, and ignored the arena clamp | one flythrough for every map (whole map, then TANK 1, 2, ...), 13.7 to 18.1s with the tank count, the cut hidden under black |
| The swap itself | the world replaced in one frame, camera set to a fixed point | fade out 800ms, swap on a fully black frame, fade in 700ms |
| Follow camera, target 2,000px away | **240px** in its first frame | 36px (`CAM_MAX_STEP`) |
| Hand-over, intro to follow | 0 px (map 1) | 0 px, all four maps (one shared clamp) |

**The flythrough, FOURTH PASS (2026-10-12, later): one shot list for every map.** The user: *"revise
all animations to start at whole map zoomed out with 'x silos to fill' -> Tank 1 -> tank 2 ... so on
so we see 'Tank 1'."* Map 1's hand-written shot list is gone, and so is the separate later-map
generator: **`arcadeIntroShotList()` builds the list for every map**, and `arcadeShotCamera` is the
one camera. (The history, so it is not repeated: the first pass zoomed while panning; the second
flew a route at one zoom; the third made maps 2 to 4 match map 1's per-silo timing, which the user
called "great".)

| Beat | Time | Caption |
|---|---|---|
| The whole map, zoomed out | `ARC_INTRO_WIDE_MS` 1.5s | **"N SILOS TO FILL"**, 72px, cyan |
| **One move: zoom straight into tank 1**, then hold | 1.5s to 2.6s, then **1.0s** | none, then **"TANK 1"** |
| Every other tank | move, then **0.6s** (`ARC_INTRO_HOLD_MS`) | "TANK 2", "TANK 3", ... |
| The exit | move, then 1.2s | "INITIATE GATE OPEN — ESCAPE" |
| Home | move (the way home is timed to the longest) | none |

- **Gone from map 1:** the "ESCAPE" caption (the wide shot now says the job) and the "YOU" beat
  (a zoom to you, 0.8s, and its arrow). **Gone from later maps:** "SECTOR n" / "FINAL SECTOR" (the
  wide caption is now the silo count) and the numbered tank markers. All four are one line each in
  `arcadeIntroShotList` if wanted back; a sector label could ride the wide caption as a second line.
- **Timing is map 1's** for the first tank (1.0s) and the rest (0.6s). Moves average
  `ARC_INTRO_SPEED` 1,450 px/s (map 1's moves ran 1,100 to 1,670), clamped 550ms to 1.5s.
- **The first zoom goes straight into silo 1** (2026-10-12, fifth pass: *"it seems to first zoom in
  the exact middle of the screen after saying the number of silos. it should just first zoom into
  the first silo"*). It had been an in-place zoom at the arena's middle followed by a pan, which I
  chose because zooming while panning 2,000px at map 1's 1.5s measured 2.1 to 2.4 screen widths a
  second. It is one move again, made safe two ways: (1) its time is `dist / ARC_INTRO_ZOOMIN_SPEED`
  (1,000 px/s), clamped 1.5 to 2.6s, so the pan that rides along with the zoom stays at map 1's
  pace; (2) **a move that changes the zoom never pulls back** (`arcadeShotCamera`'s swoop is only
  for moves at one zoom), because zoom in and then out while panning is what read as a bug.
  `scripts/zombie-camera-check.js` asserts the move ends on tank 1 and has no frame of zoom-out.
- **The host's clock** now starts after `arcIntroMs()` (it was a constant 11,400ms for map 1), so
  `arcadeStart`, `arcadeEnterLevel` and the camera all read the same function.
- **Measured** (`scripts/zombie-camera-check.js`, 1100px canvas, same limits for every map): peak
  pan 1.39 / 1.43 / 1.56 / 1.49 screen widths/s on maps 1 to 4, zoom 1.80 / 1.94 / 1.90 / 1.64
  e-folds/s, hand-over to following under 0.1px, and every map opens on `fit` with "N SILOS TO
  FILL" and has "TANK 1" to "TANK n" at 1.0s then 0.6s.
- **LENGTH:** map 1 **10.0s**, map 2 **13.7s**, map 3 **17.2s**, the boss **18.1s** (5, 7 and 10
  tanks). It is the tank count: each tank after the first costs a move plus a 0.6s hold. Not
  skippable yet (`IDEAS_INBOX.md`). Knobs: `ARC_INTRO_HOLD_MS`, `ARC_INTRO_SPEED`, `ARC_INTRO_WIDE_MS`.

**Map 1's shots keep the user's timeline and shape** and gained three things (`arcadeShotCamera`):
zoom in log space (a linear scale ramp spends its first half looking twice as fast), a long move
**pulls back in its middle** (the swoop: `ARC_SWOOP_*`, never below 0.6x, because a deeper dip trades
a slow pan for a fast zoom, measured), and the same arena clamp the follow camera uses
(`clampCameraCentre`, `zombie-core.js`). The wide hold gave 500ms to a 5x zoom-in; it has 1.5s now
from the same total (ESCAPE hold 1.8 to 1.3s).

**The map change** (`arcadeBeginNextLevel` is now only the START):

1. Everyone is out: `arcLeaveAt` is set, the walk-out keeps playing, `ARC_LEAVE_MS` 1.1s, fading to
   black over the last `ARC_LEAVE_FADE_MS` 0.8s.
2. `arcadeLeaveTick` (from `arcadeUpdateEscape`) swaps the world on a fully black frame.
3. `arcadeEnterLevel` starts the flythrough and a `ARC_FADE_IN_MS` 0.7s fade up.
- **Wire:** the snapshot gains **`lq`** (ms until the swap, a duration, 0 when no change is under
  way), so guests fade out with the host. A guest that missed it holds black past the deadline until
  `lv` arrives, and gives up after 5s.
- **A client that did not see the leave** (joined mid-map, or a late snapshot) gets no 8s of "no
  controls in the middle of a fight": just the 0.7s fade up and the toast. `cinematic` in
  `arcadeEnterLevel`.
- The dev panel's NEXT LEVEL goes through the same two steps.

**The first zoom is smooth now** (2026-10-12, *"between the n silos to fill onto the first silo, it's
kind of jolty"*). Measured through the wide-shot -> silo 1 move: **3 to 7 screen widths/s^2 of
acceleration, a spike ~300ms in**. Cause: at the wide zoom the view is TALLER than the arena's
camera bounds (the 700px-tall window shows 3,150 world px against bounds of 2,685), so the clamp
pins the camera to the bounds' middle on that axis until the zoom brings the view inside, then
releases it onto the path. Fixed in `arcadeShotCamera`: (1) it interpolates between the CLAMPED
start and end views; (2) a zoom moves the centre by how far the view's WIDTH has closed (1/scale),
which holds one world point still on screen and makes the pan even; (3) `arcadeAxisProgress()`
holds an axis at the bounds' middle until the view fits and then eases away from rest, so the
clamp never has to move the view mid-zoom. After: **0.65 / 0.95 / 1.21 / 0.68** on maps 1 to 4, and
`arcIntroClampDelta` (px the clamp moved the view) reads 0.0. The move got a 2.0s minimum
(`ARC_INTRO_ZOOMIN_MIN_MS`): at 1.5s map 2 peaked at 1.7. `scripts/zombie-camera-check.js` asserts
both numbers.

**THE WAY IN** (2026-10-12, *"a 'Previous level: tunnel' that has the player enter into the arena
with an open gate, but then the gate closes behind them"*). Every map after the first has a tunnel
stub in its NORTH fence, mirroring the exit (`entryRect`, built in `buildArcadeArena`):

- **Geometry:** a 212px opening (`ARC_GATE_W`) at the world's centre between two columns, tunnel
  walls up to the top of the world and a cap, and a solid `entryBar` filling the gate. The bar has its
  own flag: `arcadeUpdateGateBar` removes every `gateBar` wall when the EXIT opens, and must not
  take this one. `check-map-features.js` skips `entryBar` like `gateBar`.
- **Arrival:** a client that saw the map change spawns **inside the tunnel** (`ARC_ENTRY_SPAWN_BACK`
  120px north of the fence) with the bar removed (`arcadeEntryOpen`), the flythrough ends on you
  there, and the run-on (`ARC_RUNON_MS` **1.0s**, was 0.7: 240px, tunnel + gate + in) walks you
  through.
- **Closing:** `arcadeEntryTick` (with `arcadeUpdateGateBar`, every step, every client) shuts it
  when the flythrough ends and none of that client's players is still in or north of the gate; the
  bar goes solid at once and the slab drops over `ARC_ENTRY_CLOSE_MS` 0.6s (`drawEntryGate`), with a
  door sound and a shake. A stalled client is moved inside after 5s rather than shut in.
- **No message and no host involvement:** each client does it off its own flythrough (players and
  their collision are client-owned). Not `markNavDirty()`: nothing walks the tunnel, so the nav grid
  keeps the shut gate. **A catch-up client** (no flythrough) spawns inside the fence with the gate
  already shut.
- **The tunnel:** floor, flat bands darker toward the far end, three chevrons pointing in, a
  **"PREVIOUS LEVEL"** plate, rails for the slab, and flood lights either side of the gate inside
  the fence.
- **Verified headless** (`scripts/zombie-camera-check.js`, "way in"): map 1 has none; maps 2 to 4
  start in the tunnel with the gate open, the run-on puts you 100px past the gate's inner face, it
  shuts, and 1.5s of walking north is blocked. **Seen in the page** (still frames, console clean).
  **Not verified:** the arrival in motion, or with two clients.

**Nothing throbs on the start card** (2026-10-12, on request): the in-world objective beacon (the
pulsing ring and "TANK 1  0/10") is drawn only once `gameStarted`, and the sidebar map's blinking
funnel rings and pulsing objective ring hold still until then.

**A run's start and a restart**: `arcadeIdleCamera` rests the camera on the whole arena at the
flythrough's first shot while there is no run and no player, so CLICK TO START has nothing to cut
from; `resetGame` fades up from black over the regenerated level (`arcadeResetTransition`).

**Smaller ones:** letterbox bars slide in and out over 450ms (they popped off in one frame as the
controls came back); the loadout HUD fades with the canvas through the same value; the camera
follow is capped at `CAM_MAX_STEP` (36 world px a frame; walking is 4 and a run's own lag ~33, so
normal play is untouched).

**Fades are STEPPED** (`ARC_FADE_STEPS` 8, ~100ms a step), per checklist item 9 (nothing ramps).
That is a call: the old `winFade` is smooth. `ARC_FADE_STEPS = 0` gives a smooth ramp.

**Verified:** headless, over the page's own scripts: all four maps' flythroughs (above); the swap
frame and the frame before it are both fully black; a double trigger is ignored; the real
`arcadeUpdateEscape` path goes 1 -> leaving -> 2; a catch-up guest skips the cinematic and a guest
that saw `lq` plays it; the idle camera equals the flythrough's frame 0; `scripts/zombie-bot-playtest.js
--start-map 2` runs clean. In the page: no console errors across start, a forced map change and
the sweep. **Not verified:** motion by eye (the Browser pane delivers ~1 frame/s here, so frames
were judged for content only), two real clients, or 144Hz. The bot's `survived` numbers shift by
the longer intros (~5s a map of no-control time); they were never wall-clock.

### Tenth: a hard speed cap, a difficulty slider, and a bot that plays (2026-10-11, last)

The user: *"zombie movement speed needs capped at player max speed. It makes getting tripple tapped at
the high levels virtually impossible ... This should be a hard rule"*, *"scale back the map-starting time
for 3 & 4"*, and *"playtest yourself ... if not, or if your tests are not felt to be accurate or true to
human players, then create a difficulty slider ... in the dev menu"*. Both were done: the slider is
built AND the playtest was run, and the playtest says it cannot stand in for a person (below).

**1. THE HARD SPEED CAP.** `updateZombies`: `speed = min(PLAYER_SPEED, (base + offset) * mult)`. No
zombie WALKS faster than a player (4 px/step). The curve still rises and the fast types simply hit the
cap: a runner from wave level 18, a spawnling from 11. **Separation is held to the same budget**
(`separateZombies` skips any push the zombie's own step has no room for, via `z.mx0/my0`), because a
push stacked on a capped step would have been a second way to outrun a player. A zombie THROWN (the
launch phase) is not walking and is exempt. Measured at wave level 51 (uncapped: runner 5.33, spawnling
6.11): **exactly 4.00px a step, alone and inside a packed crowd of 60.** A scout (4.4) can now outrun
everything; nobody else can be caught from behind by a straight chase.

**2. THE DIFFICULTY SLIDER** (`arcDifficulty`, 0.50 to 1.50, default 1.00; the dev panel's top row,
ticks CASUAL / EASY / DEFAULT / HARD / BRUTAL, double-click or click DEFAULT to reset). Everything reads
it LIVE, so dragging it mid-run reshapes the curve at once (checked in the page: on map 3, T 120 -> 60 /
180, spawn rate 1.42 -> 0.29 / 4.19, alive cap 90 -> 77 / 103). Persisted per browser
(`zombie_arcade_difficulty`), mirrored to guests on the snapshot (`df`), and **host-only**.

| What it scales | Maps 1 and 2 ("near the same") | Maps 3 and 4 |
|---|---|---|
| head start on the curve (`ARENA_LAYOUTS[n].clock`) | map 2 only, +-20% of the slider's distance from default | x D |
| the curve's speed inside the map (`pace`) | 1 | `pace` x D (0.5 x D on map 3, 0.6 x D on the boss, at default) |
| spawn rate | +-10% | x D |
| alive cap | 1 | x (0.7 + 0.3 D) |
| boss horde rate / super-splitter interval and cap | n/a | rate x D, interval / D, cap +round(2(D-1)) |

- **`arcadePlayS` and `arcadeElapsedS` are different things now.** Play seconds count from the end of the
  map's intro; `T` (the curve's clock) = play seconds x `arcPace()` + `arcClockOffsetS()`. Both read the
  slider live. `startTime` is the intro's end, not shifted by the head start, which is what makes it live.
- **The head starts were scaled back:** map 3 120 -> **60s**, the boss 240 -> **100s**. Map 3's tanks also went 8/10/12/12/14/14/16 -> **7/8/10/10/12/12/14** (-15%).
- **`pace` is new**, and it exists because of what the playtest found (next): the hard maps are bound by
  the timeline, not by tank cost.
- A dev-panel **slider widget** now exists in `shared/devtools.js` (`{slider, min, max, step, def, value,
  ticks, format, onInput}`); `onInput` fires on every move.

**3. THE BOT PLAYTEST** (`scripts/zombie-bot-playtest.js` + `scripts/zombie-bot.inc.js`). A scripted
player runs the real game code headless at ~20x real time (a fake clock, `update()` at 60Hz) and touches
only what a player can: keys, the pointer, F, the turret click. Three skill profiles (reaction 330 / 180
/ 100ms, aim error 5 / 2.5 / 1 degrees). It steers by the game's own flow field, kites by repulsion,
picks a gun by range, holds fire off the funnel when a tank is filling, takes good drops and dodges
hazards. **It found two real bugs on the way** (below).

**What the bot can and cannot tell you.** It is a RELATIVE instrument and a pessimist about
tactics: it plays solo (a group revives, and has more guns), it cannot read a crowd or choose a fight, it
dies to being boxed in where a person would burn a powerup, and it never learns a map. It has **no
panic, no boredom and perfect bookkeeping**, which cut the other way. So: its win rates are NOT human win
rates. What it IS good for is "setting X is harder than setting Y", and "this part of this map is a wall".
The user's own condition for the slider ("if your tests are not felt to be accurate") is met, which is
why the slider exists regardless of what the bot says.

**What it found** (solo bot, `good` and `expert` profiles, 2 to 3 seeds each; every number is a bot's, see
above). Each row is one setting against the others:

| Setting | Result |
|---|---|
| Map 1, default, 6 runs | **0 clears.** All died at 68 to 222s with 1 to 3 of 3 tanks (best: expert, 3 tanks at 210s). A person clears this map: a bot dying here is the bot's flaw, which is why its absolute numbers are a floor, not a rate |
| Map 3 head start 60 / 90 / 120s | survived **63-230s / 112-162s / 63-86s**: lower is monotonically better |
| Map 3 slider 0.5 / 0.75 / 1.0 (head start 60) | **0 / 0 / 0 wins in 4 each**; survived 200-334 / 148-240 / 117-204s |
| Map 3 tank sizes, full vs -30% | 1 to 5 of 7 new tanks vs 4 to 6 of 7, **both dying at ~160-240s**: the wall is the clock, not the cost |
| Map 3 curve speed (`pace`) 0.6 / 0.45 | 0 of 4 / **1 of 4 cleared** (the first clear anywhere on map 3: 383s, then died on the boss at 232s) |
| Boss slider 0.75 / 1.0 / 1.25 / 1.5 (head start 100) | **3 / 1 / 1 / 0 wins in 4**: the slider moves it the right way |
| Boss `pace` 0.6 / 0.45 (D 1.0) | **1 of 4 each** (the 0.45 set also had a run alive and still fighting at the 14-minute cap): the boss's horde is constant, so the curve's speed barely matters there |

| **The SHIPPED defaults** (head starts 60 / 100s, map 3 pace 0.5 and tanks -15%, boss pace 0.6, slider 1.00) | **Starting on map 3: 2 of the 3 finished runs won maps 3 AND 4** (253s + 250s, 341s + 252s); one died on map 3 at 181s; one run was still going when this was written. **Starting on the boss: 3 of 4 won** (258 / 354 / 480s), one died at 78s |

**So, in the bot's terms: map 3 was the wall and the boss the easier of the two; at the shipped
defaults the wall is down.** The head start,
the slider and the tank sizes each nudge map 3; the curve's speed is what finally cleared it. **Defaults
chosen from this:** head starts 60 / 100s, map 3 `pace` 0.5 and tanks 7/8/10/10/12/12/14 (-15%), boss
`pace` 0.6, slider 1.00. Reproduce any row with `node scripts/zombie-bot-playtest.js --skill good
--start-map 3 --diff 1 --pace3 0.5 --seed 3` (see the script's header for every flag).


**4. Two real bugs the bot found.**

- **`arcadeUpdateBoomBolts` read `zombies[k]` after a kill had shrunk the array** (an ARC / BLASTCAP
  chain takes OTHER zombies with it), so `z` was `undefined` and the host's update threw. On a live room
  that is the host loop dying and every guest freezing (the old `relocateZombie` failure mode). Fixed by
  collecting the victims first and damaging by object.
- **The `endgameObjective` "SILO N FULL" and the funnel hold logic were fine; the bot's greedy
  steering was not.** (A bot bug, noted so it is not mistaken for a game one: it could not get round the
  hedge rings until it used the flow field.)

### Ninth: maps 3 and 4 (the boss), and a smaller Boomgun bolt (2026-10-11, last)

The user: *"level 2 worked flawlessly"*, then a **third map with 7 silos and a large middle dividing
element**, and a **fourth, "boss", map: more open, 10 tightly stacked silos, only super splitters and a
constant horde, increased negative drops; beating it is a win.** So the run is now **four maps** and the
win moved to the end of map 4 (`ARC_MAX_LEVEL`). Supersedes "map 2's exit ends the game" in "Seventh".

| Map | Tanks (kills) | Layout | Clock head start | Gate |
|---|---|---|---|---|
| 1 | 3 (10/15/20) | the diamond: hedge, warehouse, forest | 0 | south-centre |
| 2 | 5 (8/10/12/14/16) | a "W": hedge, warehouse, forest, hedge, forest | 60s | dx +1360 |
| **3** | **7** (~~8/10/12/12/14/14/16~~ **7/8/10/10/12/12/14**) | **a 480 x 1370 concrete DIVIDER down the middle** (a 285px lane over its top, a ~490px pass under its foot where tank 4 stands). Left half: forest, hedge, warehouse; the pass: forest; right half: hedge, forest, hedge | ~~120s~~ **60s** ("Tenth") | dx +2000 (south-east) |
| **4 (boss)** | **10** (6/6/6/6/7/7/7/7/8/8) | **open**: two rows of five stacked 600px apart, no sets, no scatter or patch trees in the core (the edge forest stands) | ~~240s~~ **100s** ("Tenth") | dx -1200 (under the last tank) |

How it is built (all in `ARENA_LAYOUTS` and `zombie-arcade.js`):

- **A layout row now carries** `funnels`, `gateDx`, `caps`, `clock`, `sets`, and optionally `divider`,
  `open`, `boss`. `arcClockOffsetS()` reads the row; `L2_CLOCK_OFFSET_S` is kept only as a name.
  The pattern the user set holds: each map starts a further 60s up the same curve.
- **The exit hands over to the next row** (`arcadeBeginNextLevel`), or wins on the last. The run time is
  summed across maps (`arcL1Seconds` = playing seconds so far; the name is a leftover) and the tanks
  filled so far are credited (`arcL1Silos`; `silosFilled()` already adds them, which a first version
  double-counted: caught by the flow test as 3 -> 11 instead of 3 -> 8).
- **The divider** is `pushProp("divider", ...)` (a solid prop, `kind: "divider"`, drawn in
  `drawSetProp`), built first so every set routes round it, with a 60px `clear` margin.
- **Set build order is hedge, then warehouse, then forests, whatever the tank order.** A forest planted
  before a hedge ring left the ring standing in its trees.
- **THE BOSS WAVE** (`arcadeBossWave`, map 4 only): no tide, no lull after a tank fills, no ease. A
  **constant horde** of walkers (70%) and runners (30%) at `BOSS_HORDE_RATE` 6.5/s solo, scaled by team
  size and held at the alive cap, and a **SUPER SPLITTER every 7s** up to `BOSS_SPLIT_MAX` (3, +1 per
  extra player) alive. Nothing else spawns. It has the same arrival lull every map after the first has,
  then it is constant.
- **Negative drops on the boss map:** 10% a kill (was 3%), up to 8 live (was 3). The good drops are
  untouched.
- **Intro:** "SECTOR 2", "SECTOR 3", "FINAL SECTOR", then "N TANKS" *(superseded 2026-10-12: a full flythrough, see "Eleventh")*. Dev panel: GO TO LEVEL 2 became
  **NEXT LEVEL** (`arcadeBeginNextLevel`).

**Measured, headless:** every map over 12 seeds, both nav grids: **0.0000% unreachable arena cells, every
tank, switch strip and the gate reachable, nothing solid outside the fence** (map 1 unchanged at
0.0435% / 0.0055%). The pathing sim at every tank of map 3 (7) and map 4 (6 of 10): 0 relocations except
1 to 3 on a tank the 28 zombies were piled on (the crowd on the target, not geometry). The 4-map flow:
heads start 0/60/120/240, run time 100/200/300/400s, tanks credited 3/8/15, `won` only after map 4. The
boss wave over 30s unkilled: 3 super splitters (the cap) plus ~65 walkers and ~25 runners at the alive
cap (90); hazards after 400 kills: 3 on map 1 (cap 3), 8 on the boss (cap 8). Live page: jumped 2 -> 3 -> 4,
divider built and drawn, bolts flying, no console errors.

**Not known, and it is the point of the next playtest:** map 3 starts at 120s and map 4 at 240s, so the
swarm is at the alive cap from the first seconds of each; whether map 3 and the boss are winnable, and for
how long a run lasts (~6 to 10 minutes), is a guess. The levers are `clock`, `caps`, `BOSS_HORDE_RATE`,
`BOSS_SPLIT_*` and `BOSS_HAZARD_*`.

**The Boomgun bolt, again:** drawn at **1/5 of its size** (`BOOM_DRAW_LEN` 112 -> 24; the three layers
34/20/9 -> 7/4/2; the head 10 -> 3), and it **grows out of the muzzle** (`len = min(24, travelled + 2)`,
no tail until it has cleared the gun) instead of trailing back behind it, which is what read as "spawning
behind the gun". `BOOM_MUZZLE` 42 -> 46 (the cannon ends at ~43). The `travelled` distance now rides the
snapshot row (`bb`'s 7th element) so a guest's copy does not flicker. **The wipe strip (60px) did not
change**: a tiny bolt still clears a wide path; if that reads wrong, shrink `BOOM_HALF_W`.

### Eighth: the Boomgun is a bolt now, and a smaller cannon (2026-10-11, after the map 2 build)

Asked for: *"a bit smaller, more in front of the player / off of the player square, and instead of
shooting lasers, a long line of glowing orange thick that behaves as a bullet."* **This supersedes
the instant beam in "Sixth" item 5.** Spin-up (1s), the rate climb (520 to 130ms), no ammo, the
push-back, the screen kick and the 15s are all unchanged.

- **The cannon** is 30px long and 14px thick (was 56 x 22), and starts 9px out from the player's
  centre, so it sits in front of the square instead of overlapping it. Amber rails, three barrel
  rings, a short orange flash on a shot.
- **The shot is a bolt.** `arcadeBoomResolve` (host) throws close zombies back and launches an entry in
  `boomBolts` from `BOOM_MUZZLE` (42px) out: `BOOM_SPEED` 28px a step (~1,700px/s), `BOOM_RANGE` 980.
  It **travels**, **stops at a wall** (`bulletBlockedAt`), and **pierces everything**: each step
  `arcadeUpdateBoomBolts` takes every zombie within `BOOM_HALF_W` (30px) + its radius of the segment
  the bolt just crossed, once, for 120 damage through `damageZombie` (kills credit the owner;
  ARC / BLASTCAP fire). So it wipes a 60px strip as it passes without needing a direct hit, but not
  before it arrives: nothing dies at the instant of firing.
- **Drawn** by `drawBoomBolts` after the lighting: a 112px line along the heading in three flat layers
  (a dim orange halo, a hot orange body, a pale-yellow core), a thinner dimmer second segment behind
  it as a tail, and a hard 10px head. No gradients.
- **Wire:** the host sends `bb: [[id, x, y, vx, vy, owner]]` on the snapshot. Guests dead-reckon the
  bolts every step (`arcadeAdvanceBoomBolts`, from `update()`). A guest draws its OWN shot from a local
  prediction (`boomLocal`, never damaging) and skips the host's copy by owner id. `SND_BOOM` now carries
  no geometry (arg 0): it is the sound and the kick. `boomBeams`, `addBoomBeam` and `drawBoomBeams` are
  gone.
- **Verified headless** (strip of three walkers, one off-line, one near, one behind): the three in the
  strip die as it passes, the others live, the near one is thrown, the bolt ends at 35 steps (980 / 28),
  and ends at ~308px when a wall is 350px out, sparing a zombie behind the wall. **Not seen by eye.**

### Seventh: lighting option A, MAP 2, a cleaned-out dev panel (2026-10-11, last)

The user chose lighting **A**, accepted a longer full run, and gave the map 2 clock rule. Plans:
`LIGHTING_PROPOSAL.md` and `LEVEL_2_PROPOSAL.md` (both now built; their headers say so).

**1. Lighting, option A** (all in `zombie-arcade.js`):

- **Lit faces.** `visPoly()` lets each ray run on INTO the blocker it hit by up to `VIS_PENETRATION`
  (24px), so the face of a hedge, rack, tank or tree that faces the light is inside the lit polygon.
  Before, the polygon stopped at the near edge and the prop's own body was painted black. The cause
  was that props are raycast as their WHOLE drawn rectangle.
- **A floor under the dark.** `LIGHT_OUTSIDE` 0.74 to 0.62, `LIGHT_INSIDE` 0.95 to 0.80, and the tint
  `4,7,20` to `6,16,28`, so what is left in the dark is deep blue, not a void.
- **Seven bands, not four** (`ARC_LIGHT_BANDS`), and four flashlight layers (`TORCH_LAYERS`,
  `TORCH_LAYER_A` .53 so the core is still ~0.95). Still flat steps, so the quantized-light pillar
  (checklist item 9) holds. No dithering.
- **Not judged by a human.** I looked at frames in the Browser pane (the pane crops and throttles),
  which is the limit the visual-review skill warns about. B (smooth the world light) is still one
  gradient change away if seven bands still read as hard.

**2. MAP 2 (`ARENA_LAYOUTS[2]`).** After map 1's exit, everyone arrives at the north fence of a second
arena and the run continues; **map 2's exit ends the game**.

| | |
|---|---|
| Layout | a fixed "W" of 5 tanks, offsets from the world centre: (-1360,-750) hedge, (-560,200) **warehouse**, (200,-650) forest, (800,300) hedge, (1520,-700) forest. Gate at dx +1360 in the south wall |
| Tank sizes | 8 / 10 / 12 / 14 / 16 kills (map 1 is 10 / 15 / 20), read through `siloCapacity()` |
| Entry | you spawn at the north fence and **run south** for the 2.6s intro (`arcadeRunOn`, controls off), the camera on you, captions "SECTOR 2" and "5 TANKS" *(superseded 2026-10-12: "Eleventh")* |
| Kit | carried over: guns, ammo, perks, powerups. Downed players are stood up at the entry; anyone dead respawns through the normal 10s path beside a teammate |
| Clock | **offset by 60s** (`L2_CLOCK_OFFSET_S`): at the end of the run-on `arcadeElapsedS` reads 60, so **map 2's minute 2 is map 1's minute 3** and it follows the same curve after (rate, mix and HP all read the same clock). Measured: +120s = 180s, rate 11.17/s on both |
| Arrival | `arcadeL2Ramp`: x0.25 for 15s, then a smoothstep up over 20s. Nothing spawns during the run-on (`arcadeIntroActive` guards the wave) |
| Run time | `arcadeRunSeconds` = map 1's seconds + map 2's past the offset; the cards and the cabinet read it. The wave reads `arcadeElapsedS` |
| Wipe | **game over**, as on map 1. A restart is always map 1 (`resetGame` sets `arcLevelNo = 1`). *(There are four maps now; see "Ninth".)* |
| Score | map 1's filled tanks still count (`arcL1Silos` added in `silosFilled`) |

How it is built, so it is not re-broken:

- **`buildSiloSets` is now a dispatcher** over `buildHedgeSet(k)`, `buildWarehouseSet(k)` and
  `buildForestSet(k)`, one per tank in layout order. Each claims its ground (`clear`) before the next
  looks. Map 1 still builds hedge, warehouse, forest, identically.
- **Every "three tanks" assumption became `funnels.length`**: the arena builder, the objective beacon,
  the lull latch, the side-panel goals (`arcadeMapGoals`), the endgame objective line and the lamps.
  `funnelActive`, `siloFill` and `siloFlipped` are resized in `buildArcadeArena`, because `[x, x, x]`
  made `siloFill[3] < cap` false forever.
- **The seed does not change between maps.** `arcadeEnterLevel(level, now, l1)` runs on every client:
  it sets `arcLevelNo`, calls `generateLevel()` (same seed, so the same world with map 2's arena),
  re-gives the chain, clears the field and puts players at the entry. The host calls it from
  `arcadeUpdateEscape`; a guest calls it from `applyWorldSnapshot` when the snapshot's **`lv`** is
  ahead of its own. `lv` and `l1` ([map 1 seconds, tanks]) ride every snapshot, so a client that missed
  the moment still catches up. Anything keyed on the level seed alone is stale across maps: the sidebar
  map cache now includes the level number.
- `arcadeIntroSync` (a guest skipping a run already in progress) is map 1 only; map 2's clock is
  offset on purpose and would have skipped the run-on every time.

**Measured over 12 seeds, headless** (`scripts/measure-zombie-nav.js` measures from the keep and means
nothing on a fenced arena; the in-arena version is in the session scratchpad):

| | tight grid | wide grid | targets |
|---|---|---|---|
| map 1 (unchanged) | 0.0435% | 0.0055% | all reachable |
| **map 2** | **0.0000%** | **0.0000%** | all 5 tanks, 5 switch strips and the gate reachable; nothing solid outside the fence |

Pathing sim (a target at each map-2 tank, 36 zombies released outside): **0 relocations, 36/36
arriving, on all five tanks, two seeds**. The route is ~7,800px of straight lines (~33s of running)
against map 1's ~3,800 (~16s). The user accepted the longer full run and asked that playtesting
decide; offsets can be pulled in from `ARENA_LAYOUTS[2]` alone.

**3. The dev panel was cleaned out** (`zombie-dev.js`, and a generic `icon` on `shared/devtools.js`
buttons). New: **BOOMGUN**, **TURRET**, **FREEZE**, **GO TO LEVEL 2**, and **one button per perk that
can drop here, each with its icon** (ten: OVERDRIVE, RICOCHET, ATTRACT, SPITE, ARC, BLASTCAP, SKEWER,
LAST STAND, SALVAGE, SEEKER). Each press adds a stack up to x6. **Removed as obsolete:** FREE BUYS (and
the `hostHandleBuy` / `nearestPrompt` wrappers), ROUND +1, END ROUND, +500 SCRAP, LIGHTS, TRIP
GENERATOR, CALL THE HORDE, OPEN SLUICE, START FLOOD, NEXT PERK. SCAVENGER, CONDUCTOR and DECOY get no
button (they cannot drop). The state readout lost the round, budget, lights, "perks on map" and
super-splitter rows and gained the map, tanks, clock, spawn rate, powerups and held kit. NO ZOMBIES is
kept, wrapping `spawnZombie` / `spawnZombieAt`, because the sandbox and map editor read its flag.

### Sixth: seeker rounds, three crowd tools, the Boomgun, tide and lull (2026-10-11, later)

The user answered the previous round's questions and accepted its recommendations
(`../HUB_1_0_PLAN.md` 2m / 2n). **Proposals only, not built:** `LIGHTING_PROPOSAL.md` and
`LEVEL_2_PROPOSAL.md`.

**1. SEEKER perk: rounds curve to the nearest zombie, and it stacks.** `CARDS.seeker`, appended to
`CARD_KEYS` (index 12; icon in `zombie-icons.js`), in `DROP_PERKS`. `homeBullet()` in
`zombie-game.js` runs before each step: nearest zombie within 420px **and within ~80 degrees of the
heading** (so it never U-turns), never one the round has already pierced, speed preserved. Turn rate
per step by stack: `HOMING_TURN` = 0 / .03 / .045 / .06 / .075 / .09 / .105 rad (1.7 to 6 degrees).

- Applied at the muzzle like SKEWER and RICOCHET (`b.homing`, and `hm` on the `shoot` message), so
  the host's copy of a guest's shot curves too. Not rockets or flame.
- Headless, a round fired 28 degrees off a zombie 300px away: x0 and x1 (before the curve was raised
  from .02) missed; x3 and x6 hit.

**2. The tank pulse.** F at a full tank's base (`flipSilo`) now calls `arcadeSiloPulse(i)`: every
zombie within `PULSE_R` (620px) of the tank is **removed outright** (a SUPER SPLITTER would otherwise
throw its 20 spawnlings into the crowd the pulse is clearing), with a blast and a toast. Three
guaranteed crowd-clears per run.

**3. FREEZE (team drop).** `arcadeFreeze`: everything within `FREEZE_R` (560px) of the taker is
held for `FREEZE_MS` (4s). Skipped before pathing, scream and contact in `updateZombies`
(`arcadeFrozen`), watchdog reset so a thaw is not read as "stuck". One zone at a time; it rides the
snapshot as `frz: [x, y, r, ms left]` so guests draw the ring and tint the held zombies. Still
shootable.

**4. TURRET (carried like a gun, placed on click).** A drop, taken by walking over it. It is
`p.turretHeld` and **armed** on pickup: the next left click places it (`arcadePlaceTurret`), `T`
re-arms / stows it, and a gun key disarms it. It lands at the cursor but never further than
`TURRET_REACH` (110px) from you, so a specific spot means going there, into the swarm. It deploys for
0.7s (ghosted), then fires at the nearest zombie in sight for 15s; zombies standing on it chew its
140 HP. Once placed, you can carry another; **you cannot pick up a second while holding one**.

- The host owns `arcTurrets`; a guest sends `{k: "turret", id, c, x, y}`. Turret rounds are ordinary
  bullets owned by the placer (SMG shape, 2.5 dmg every 100ms, no homing), so kills credit them and
  there is no new bullet wire. Snapshot field `tu`: `[id, x, y, ms left, hp, aim x100, ms to live]`.
- Max 4 live; the oldest goes first.
- Headless: 6 zombies in range, 3 left after 8s with HP untouched.

**5. THE BOOMGUN (a 15s personal powerup).** A drop (weight 4). While `p.boomUntil` runs it replaces
your gun:

- **A big visible cannon** drawn on the player (`drawPlayerBody`): a 22px-thick body, amber rails,
  three barrel rings that flicker faster once spun up, a kick back on each shot. Teammates see it
  (`bm`, ms left, on the `players` payload). It blinks red for its last 4s.
- **Spin-up 1s**: `p.boomHeld` climbs while the trigger is down. Letting go drains it at 2.5x, so a
  brief release keeps most of the spin. **The longer you hold, the faster it fires**, from a shot every
  520ms down to **130ms** over the next 5s. No ammo.
- **Each shot** (`arcadeBoomResolve`, host): zombies within 150px that are not in the beam are
  **thrown back** (the SUPER SPLITTER launch phase); everything within 34px either side of a 980px
  beam, wall-stopped, takes 120 damage **without needing a hit**, through `damageZombie` as a `shot`
  (so kills credit the owner and ARC / BLASTCAP fire). Then a screen kick, 9 to 14 shake.
- *(Superseded the same day, see "Eighth": the shot is a travelling bolt, not an instant beam.)* **The tracer** is an event (`SND_BOOM`, arg = length x 1000 + angle in degrees), drawn by
  `drawBoomBeams` as three flat layers (amber / yellow / white) **after the lighting**, so the dark
  does not dim the brightest thing in the game. A guest predicts its own beam at once; the host's
  echo is skipped by owner id, like every other own-action sound.
- Measured: first shot at 985ms, gaps 485 / 451 / 417 / 401 ... 133ms; 3 of 5 zombies in the strip
  died and the 2 off it were spared; the near one was thrown.
- A down ends it. The HUD swaps the gun for a BOOMGUN icon in amber and the seconds left where the
  rounds go (magenta under 4s). **Not verified by a human, and not with two real clients.**

**6. Breathing room without rounds** (`arcadeSpawnRate(t, now)`):

| | |
|---|---|
| TIDE | the rate x (1 + 0.35 sin(2 pi T / 28s)) over the exponential, so ~14s swells and ~14s ebbs; the 4:00 overwhelm is unchanged |
| LULL | x0.4 for 8s after a tank fills (latched per tank in `arcWasFull`) and when the gate starts opening |
| EASE | 5 kills inside 3s push the spawn debt down by 3 (it can go negative, which is the gap); not more than once per 3s |

**7. Ammo hand-over.** A gun that runs dry now goes to the **most powerful gun you still have
rounds for** (`WEAPON_POWER`: rocket, flamer, sniper, shotgun, SMG, rifle, pistol), not the next in key
order and not straight to the pistol. `currentWeaponKey` does the same if ammo is removed any other
way. Arcade only; the walled build keeps the old order.

**New wire, all appended:** zombie rows are `[x, y, type, flash, nid, ...]` (see the fifth playtest);
`world` gains `frz` and `tu`; `shoot` gains `hm`; `players` gains `bm`; relay kinds `turret` and
`boom`; `PICKUP_TYPES` gains `freeze`, `turret`, `boomgun`; `SND_BOOM = 26`.

### Fifth playtest: guest flashing, hedge pathing, negative drops, a readable panel (2026-10-11)

From a friends' session (3–10 players): guests saw *"dozens of zombie shapes flashing all over
the screen"* (near-unplayable); zombies *"get stuck in place and then despawn ... can't navigate
around the corners"* at the hedges. Both were reproduced and fixed. Plan, verification list and
open questions: `../HUB_1_0_PLAN.md` "2m".

**1. The guest flashing: zombies are matched by a stable id now.** `applyWorldSnapshot` matched
snapshot rows to the guest's zombies **by array index**, and the host `splice`s a zombie out on
every kill, so every zombie after it inherited its neighbour's previous position and lerped across
the screen. The wire row is now `[x, y, type, flash ms, nid, burn ms?, launch ms?, lvx, lvy]`.

- `nid` is assigned lazily in `broadcastWorld` (`z.nid || (z.nid = ++zNidSeq)`), so no spawn site
  has to know. `zNidSeq` lives in `zombie-entities.js`.
- A guest keeps the max `nid` it has seen, so a promoted host never reuses a live id.
- **Burn moved from index 4 to index 5** and the launch triple from 5–7 to 6–8. The burn slot is
  pushed as 0 when only the launch is present. Anything reading zombie rows by position must use
  the new layout (nothing else in the repo does; checked).
- Verified by replaying two snapshots across a mid-array kill: every survivor keeps its own `x`.
  *Not* verified between two real clients on a network.

**2. Hedge pathing: three causes, all in code that every zombie shares.** Reproduced headless with
the repo's own `scripts/zombie-headless.js`: a target stands at funnel 1, 48 zombies are released
600px out, 45 simulated seconds. Before: **22–43 relocations (despawns) and ~30 of 48 arriving.**
After: **0 relocations, 48 of 48.** Same on funnels 2 and 3 (0–1 in 120 zombies).

- **Off-field recovery had no line of sight** (`navStepToward`, the `here < 0` branch). It took the
  lowest field distance within ±2 cells — nearly always the cell *beyond the wall* the body is
  pressed against, since a wall off the 20px lattice (a 24px hedge, a 40px tree) blocks a cell that
  overhangs it and so puts a flush body's centre in a blocked cell. It now tries candidates in
  distance order and takes the first with `navClearLine`. **The pathfinding section's item 3 says
  recovery needs line of sight; this had silently regressed.**
- **The 5-cell lookahead is string-pulled.** The point the zombie steers at is the furthest path
  cell with a clear line; the adjacent cell is the floor. Before, round a wall piece's tip it
  pointed *through* the corner.
- **A blocked step spends its lost speed on the free axis** (`updateZombies`, after
  `moveWithCollisions`; not while chewing). Axis-separated collision kept only the free axis's
  share, so a goal nearly perpendicular to a wall crept at ~35% speed, tripped the stuck heuristic,
  and the perpendicular slide threw it the other way — a lone walker 20px under a gap tip
  oscillated 10px for 8s and was despawned.
- **Not changed, and worth knowing:** walls are still off the lattice. Snapping hedge rings to 20px
  would remove the trigger for cause 1 and was left out because the line-of-sight fix is general
  (trees, containers, racks all have the same property). If a new off-lattice prop reports stuck
  zombies, snap it before touching the nav code.
- The headless sim itself is in no repo script yet. It is ~40 lines over `zombie-headless.js`
  (`spawnZombieAt`, override `allTargets`, set `won = true` so touches are inert, call
  `updateZombies` at 1000/60ms). Worth promoting to `scripts/` if pathing is touched again.

**3. Numbers.** Revive **0.75s** (`ARC_REVIVE_MS`, was 1.5s). Respawn **10s** (`ARC_RESPAWN_MS`,
was 15s). Funnel radius **150** (`ARENA_FUNNEL_R`, was 110; area ×1.86); funnel 2 sits at -680
instead of -600 so its warehouse (300px below the funnel) keeps clear of the start. Measured over
12 seeds after: every tank, switch strip and the gate reachable on both grids; arena cells
unreachable 0.044% tight, 0.006% wide.

**4. Silo 1's hedges opened up.** Inner ring 100px off the tank (was 36), every gap and the lane
between the rings 200px (was 130), and the inner ring now has a gap on all four sides. `hedgeRing`
takes a gap width. The other two sets are untouched.

**5. Negative drops (`HAZARD_*`, `DROP_HAZARD` in `zombie-arcade.js`).** Walked over like any drop
and decided by the host through the same one-taker path, but bad for the taker:

| | Effect | Where it lands |
|---|---|---|
| MUD | taker at 50% speed for 5s | `p.slowUntil`, read in `playerSpeed` |
| JAM | taker's gun will not fire for 2.5s | `p.jamUntil`, checked in `updatePlayers`' shoot gate |
| FLARE | 7 zombies (a third runners) land 240–340px round the taker | host, `arcadeFlare` |

- **Rolled separately from the good drops** (3% a kill, max 3 live, 20s life) so "drop rates are
  good" is untouched — a hazard is extra, not a share taken from a gun or perk. They do not count
  against `DROP_MAX_LIVE`.
- **ATTRACT never pulls one in** (`arcadeWalkOverDrops` re-tests a hazard at pad 0).
- Drawn strobing red with the word above (SLOW / BAIT / JAM), red on the minimap. `PICKUP_TYPES`
  gained `mud`, `flare`, `jam` **on the end** (the index is the wire value).
- Hazard frequency was confirmed as right (user, 2026-10-11).
- **Not verified in a real run with a group.** A zombie-spawning drop on a guest's take depends on
  the host running `arcadeHostTake`, which is the same path FUEL and SHOCKWAVE use.

**6. The panel reads from the corner of the eye.** All in `Zombie.html` + `updateLoadoutHud`.

- Gun in hand: icon 6x (4x under a 300px sidebar), name on its own line, ammo 52px.
- Gun strip: icons 3x (2x narrow) with a 13px key number; the gun in hand is a **filled cyan tile**
  with a black icon, guns you cannot fire are dimmed. Wraps.
- **Perk tiles wrap** (`#perks { flex-wrap }`). Six 46px tiles in a fixed row ran past the
  sidebar's `overflow: hidden`, which is why they "flowed off screen".
- Objective 15px → **24px bold** with an amber bar; the checklist 13 → 17px and **hidden under
  900px tall**; stats are one wrapped paragraph; HI-SCORE and 1UP share a row.
- Checked at **1366×768** with all 7 guns and 6 perks: everything fits. **Not checked at 1080p.**

**7. "Increase bullet curving?"** Nothing in this game curved a bullet, so nothing was built that
round. *(Answered the same day: "add bullet curving towards nearest enemy ... this also can stack".
Built as the SEEKER perk; see "Sixth" above.)*

### Smooth light, lit intro, more lamps (2026-10-08, later)

> **Superseded 2026-10-09: the light is BANDED again**, on request ("step into bands"), and banded
> light is now a standing rule (`.claude/skills/hub-visual-review`, checklist item 9). Every cut
> and additive pool goes through `bandGradient()` on `ARC_LIGHT_BANDS` (4 flat steps: radius 0.3 /
> 0.55 / 0.8 / 1.0 at light 1 / 0.66 / 0.36 / 0.12). The flashlight is 3 stacked sectors
> (`TORCH_LAYERS`, alpha 0.63 each), so it steps across the beam as well as along it. The
> raycasting, the dusk sun and every lamp are unchanged. "No drawn light edges" below is the old
> request.

- **No drawn light edges.** The flat bands are gone: every glow is a radial gradient on the shared
  `FALLOFF` stops (`cutGlow`, lamps' additive pools), the flashlight is 9 stacked sectors that each
  carry that falloff (`cutTorch`, `TORCH_LAYERS`) so it feathers sideways, and window and door
  shafts are linear gradients, with widening layers on the sides. `TORCH_BANDS` is now unused.
- **The intro shows all the lighting** (night, flashlight, lamps, window shafts). Only the beacon
  and the hurt frame still wait for the intro to end.
- **Raycast light** (`visPoly`): every light (lamps, your torch and glow, teammates') is clipped to
  a visibility polygon cast against `walls` (glass `window` walls let light through), so it stops
  at trees, racks, tanks and walls. ~3.6ms for a frame of lighting in the Browser pane. Lamps keep
  their polygon (`l.poly`) for the additive pass. Window and door shafts are not raycast.
- **The dusk sun is a real light now** (2026-10-08, later). The hand-drawn window/door shafts are
  gone. `sunLights` (built in `arcadeDrawLighting`) puts a raycast light just outside every window
  and door, low to the west, clipped to the warehouse, so the shafts are whatever the walls and
  racking let through. `arcadeDrawLight` adds the warm colour from the same polygons. Levels moved
  to `LIGHT_OUTSIDE` 0.74 / `LIGHT_INSIDE` 0.95 so it reads. Outside lamps are no longer clipped to
  the outside (the raycast stops them at the wall), so they light inward through windows.
- **Exit floods:** 5 cool blue-white lamps (`cool: true`, radius 330) either side of the gate and
  one out front. Lamps take a per-lamp `r`.
- **The boxed "CLICK TO START" flash** was `body.arcade` being added by script after first paint;
  `Zombie.html` now carries `class="arcade"` on `<body>`.
- **Silo 2 gets the same 5 extra lamps**, inside the warehouse.
- **More lamps:** 5 extra each at silos 1 and 3 (tank west foot and top, funnel N/S/W) and 4
  around the start point (world centre).
- Verified headless-in-page by looking at frames; `arcadeDrawLighting` returns early at a 0-size canvas.

### Flashlight, night, lamps, an edge forest, x6 perks (2026-10-08)

- **Night, and a flashlight** (`arcadeDrawLighting`, "LIGHT"). The whole map is dark: a 0.8
  blue-black (`LIGHT_TINT`) outdoors, not a grey wash, and 0.93 in the warehouse. Your light is a
  **cone toward the pointer** (`TORCH_RANGE` 640, ~48°, three flat bands) plus a small glow round
  your feet.
  - **Teammates' flashlights light the world too**: their aim already rides `players` as
    `fx`/`fy`.
  - Drops glow faintly, so a callout has something to point at, and the gate glows once it
    starts opening.
  - All of it is cut out of one offscreen darkness layer, where destination-out is safe.
- **Orange lamps** (`arenaLamps`, `arcadeDrawLamps`): on the warehouse's OUTER walls between the
  windows, and one beside each tank. Each lamp cuts a pool out of the dark and adds a flat
  additive orange.
  - **A lamp lights only its own side of the warehouse wall** (`clipToLampSide`). Unclipped, the
    wall lamps lit the warehouse through its own wall.
  - 13 lamps a map.
- **The grass is lighter** (base `#34502A`), so the dark canopies stand clear of it.
- **The outer buffer is forest** (`plantBufferForest`), to discourage exploring the edges:
  - trees with 58px canopies, `BUFFER_GAP` 92 apart, plus thick undergrowth that is drawn only,
    so it reads dense without closing a gap;
  - **92, not 80**: at 80, three trees in a triangle sealed pockets off the wide nav grid on 2
    seeds in 12 (0.2%);
  - about 140–150 trees a map in all.
- **Perks stack to x6 and six are held** (the user's "both"). `CARD_MAX_STACK` is 6 in the arcade,
  and every per-stack table is extended, keeping each perk's curve:
  - OVERDRIVE cooldown x0.33 / x0.28 / x0.24
  - SALVAGE 70 / 78 / 85%
  - BLASTCAP 46 / 53 / 60%
  - ATTRACT 165 / 195 / 220px
  - ARC, SKEWER, RICOCHET and SPITE already scale with the level.
- **The larger arena now takes in three old landmarks** in its buffer (the feed silo, the gantry
  crane, the pump bank). They are kept, per the earlier "keep for now".
- **Measured over 12 seeds:** every tank, switch strip and the gate are reachable on both nav
  grids (0%; one seed at 0.009% on the tight grid).
- **Verified in the page:** perks to x6, with a seventh refused. Frames captured of the flashlight,
  the warehouse inside and out, tank 1, the buffer forest and the overview.

### The arena's outer buffer, the win card, six perks (2026-10-07, last)

- **25% more room on the left, top and right**, and nothing in the chain moved.
  - `ARENA` is now `ARENA_CORE_W`×`ARENA_CORE_H` (3200×1860) plus `ARENA_BUFFER_X` (800) on each
    side and `ARENA_BUFFER_TOP` (465) on top: 4800×2325 at (400, 355). The south wall and the gate
    are unchanged.
  - **The chain is laid out from the WORLD centre, not the arena's** (`buildArcadeArena`'s
    `cx, cy`), because the top buffer moved the arena's centre. Verified: tanks at (1650,1750),
    (2800,1150), (3900,1750), and the gate line at y 2660, exactly as before.
  - The open terrain was re-scattered over the larger area at the same density (20 patches, 94
    scattered trees, 128 bushes, about 80–90 trees a map). The west container row at tank 1 now has
    room, so there are 7–9 containers.
- **The win card gives the run's time**: "ESCAPED AT 3:12", or "LEFT BEHIND AT 3:12", from
  `arcadeElapsedS(winSeqAt)`, never a round.
- **Nothing hurts anyone once the run is won**: the contact test skips `won`.
- **Six perk slots** in the arcade (`CARD_SLOTS`), on request ("allow for stacking up to 6 perks").
  Read as six different perks held at once; each perk's own stack still tops out at x3, because
  every per-stack table is written to x3.
- Measured over 12 seeds: every tank, switch strip and the gate are reachable on both nav grids
  (0%; one seed at 0.008% on the tight grid).

### Two-step wounds, light, a bigger arena, racking (2026-10-07, later)

- **The hit buffer is two steps now** (`ARC_HIT_STEPS` = 2). Hit 1 gives a faint red edge; hit 2
  gives a strong pulsing red edge; hit 3 downs you. Each hit is followed by **1.2s untouchable**
  (was 0.5s), and every 6s without a hit heals a step (`woundLevel`).
  - **No words**: the "WOUNDED — NEXT HIT DOWNS YOU" caption is gone, on request ("favor more of
    a learn-through-experience type model rather than explaining"). The red is the explanation.
  - In the same spirit, the beacon reads only "TANK 1  3/10", "TANK 1  [F]" or "EXIT", and a
    refused perk only "SLOTS FULL".
  - `ARC_HIT_BUFFER = false` still restores the one-touch down exactly. The `hit` relay message
    carries the new level (`l`).
- **Revive is a flat 1.5s** (`ARC_REVIVE_MS`) *(0.75s since 2026-10-11)*. The old escalation resets per round, and the arcade
  has no rounds, so it had climbed to its 6s cap and stayed there all run.
- **Blackouts are off** in the arcade: no darkening, no monochrome, no card.
- **The ping is off** (`pingFrom` returns), and **DECOY** is out of the drop pool with it.
  **ATTRACT** is in: a new perk (`CARDS.attract`, `CARD_KEYS` index 11, appended; a magnet icon)
  that takes drops from 50 / 90 / 130px away (`ATTRACT_REACH`). *(Superseded 2026-10-17: it pulls drops to you; see "ATTRACT pulls".)*
- **Drops +25% again**: 9.4% a kill, guaranteed within 16, up to 10 live.
- **The arena is a third bigger on each side: 3200×1860.** Tanks sit at centre-left −1150,
  top-middle −600 and centre-right +1100, so the three sets have room. The open terrain scales
  with it: 11 patches, 50 scattered trees, 68 bushes.
- **Light** (`arcadeDrawLighting`, replacing `drawLighting` in the arcade): a darkness layer on
  its own offscreen canvas. It is a light 0.12 outdoors and a deep 0.74 in the warehouse. Window
  shafts, the two door openings and the player's own light (the same four flat bands) are cut OUT
  of that layer with destination-out, then it is laid over the frame. destination-out is safe
  here because the layer holds only darkness; `drawLighting`'s warning is about the main canvas.
- **The sets, reworked:**
  - **Tank 1:** both hedge rings pulled in tight (36px and 190px out, was 70 / 224), and containers
    in rows just outside them, 5–6 a map.
  - **Tank 2:** a **big warehouse** (`WH_SIDE` 420 each side, 160 above, 300 below) with **storage
    racking**: steel racks 60 high with orange uprights and pallets on the shelves, in two columns
    per side bay (split round the door band) and a row below the tank, with aisles over the 78px a
    brute needs. 10 racks and 12 windows.
  - **Tank 3:** a **thicker forest** of 44px trees 80px apart, about 30 within 800px of the tank
    (was ~15).
- **A real bug fixed:** `pushProp` read `footY` as the footprint's TOP while every caller passed its
  BOTTOM, so every hedge, container, rack and pallet sat one footprint too low (racks stood through
  the warehouse's south wall). Fixed, then re-measured.
- **Measured over 12 seeds:** every tank, switch strip and the gate are reachable on both nav
  grids, with 0% of arena cells unreachable (one seed: 0.017% on the tight grid).
  38–48 trees a map.
- **Verified in the page:** hit 1 → level 1, a touch at 0.8s is ignored, hit 2 → level 2, hit 3
  downs, healed to 0 after 6s. Revive 1.5s. ATTRACT x2 took a drop 80px away. The ping does
  nothing. Frames were captured of the overview, warehouse, tank 1, tank 3 and the red edge. No
  console errors.

### The one-hit buffer and the silo sets (2026-10-07)

- **The one-hit buffer** (`zombie-arcade.js` "THE ONE-HIT BUFFER"). **Flip `ARC_HIT_BUFFER` to
  `false` for the old one-touch down**; it gates `arcadeAbsorbHit()` and nothing else.
  - The first touch is absorbed: a ~60px bump away from the zombie, a red flash, and 0.5s
    untouchable.
  - For the next 5s you are WOUNDED: a red frame with "NEXT HIT DOWNS YOU", and the panel reads
    CONDITION RED. A touch then downs you.
  - 1s after the red goes, the buffer is back. A down clears the record, so a revived player
    starts fresh.
  - **The host decides** (`arcHitState`, per net id). A guest is told with a `hit` relay message;
    the bump and the red are applied by the hit player's own client (`arcadeApplyHit`,
    `arcadeKnock`), because only it moves that player.
  - Verified: first touch absorbed (63px bump), immune for 0.5s, the wounded touch downs, fresh
    after a revive, recharged after 6s.
- **The silo sets** (`buildSiloSets`, built before the open terrain so they claim their ground).
  Every prop is **solid over its whole drawn shape** and drawn tall (`drawSetProp`, the 1D-iso
  rule). Every gap a body uses is `SET_GAP` 130, and freestanding props keep `SET_CLEAR` 90 from
  everything.
  - **Tank 1:** two rectangular **hedge rings**. The inner ring has gaps N/S/E, the outer one a gap
    on every side, staggered, so you zig-zag in and out. **Container stacks** of 1–2 sit in rows
    above and below the rings, 2–4 a map.
  - **Tank 2:** a **warehouse** round the funnel and tank, with a concrete floor and a wide
    170px door on the left and on the right. The top and bottom walls carry **windows** (solid
    glass, `window` walls) that throw **light shafts** across the floor. The shafts are drawn
    additive, after the darkness (`arcadeDrawLight`), so they read in the dark. **Pallet stacks**
    of 1–3 layers fill the side bays, clear of the doors, 6–10 a map.
  - **Tank 3:** a **dense, untidy forest** of smaller trees (48px canopy, 80px apart; still over
    the 78px a brute needs), mostly on the side you arrive from, so the last tank is reached
    through it.
- **Two traps hit and fixed, both the same rule:** "a gap is either closed or walkable".
  - A container hard against the west fence sealed a 320px strip: 1% of the arena unreachable on
    every seed. Hence `SET_CLEAR`.
  - The first build also redeclared `CONTAINER_LIFT` and `CONTAINER_HUES`, which already exist in
    `zombie-render.js`. The collision checker caught it; they are `SET_CONTAINER_*` here.
- **Measured over 12 seeds:** every tank, every tank's switch strip and the gate are reachable on
  both nav grids. Unreachable arena cells: 0% on the tight grid, 0–0.08% on the wide grid (a few
  cells beside pallets, which relocation covers). 18–23 trees a map.

### Walk-out win, the tunnel, full collisions (2026-10-04, fourth playtest)

- **Winning means walking out** (`arcadeUpdateEscape`, `arcadeExitControl`, `isOut`).
  - Once the gate is FULLY open (`escapeChainFrac() >= 1`), a standing player who passes `arcOutY`
    (100px past the gate) is OUT. Their own client takes the controls and walks them down the
    middle of the tunnel and off the screen; the camera stays in the arena.
  - The run is won when every standing player is out, and the card follows 2.6s later.
  - It replaced "win as soon as everyone stands in front of the gate", which read as *"just 'you
    win' as soon as you survive the end horde"*.
- **The exit is one continuous tunnel** to the bottom of the world.
  - The gate is `ARC_GATE_W` (212) wide, the tunnel's full inside width, so the fence has no
    side gaps.
  - It sits **flush with the south wall** (`escapeRect.y` = the wall line).
  - It is **solid over everything it draws** (`gateBar` = the whole gate rect) until fully open.
    The old pocket is gone.
- **Tanks are solid over their whole drawn shape** (footprint + `SILO_LIFT`), so you can't stand on
  one. **F works only at the base** (`siloUseRect`: a strip along the bottom edge).
- **Trees are solid over their whole drawn shape** (`treeFullHeight()`: trunk, canopy and crown),
  so no zombie can hide behind one. `TREE_GAP` dropped 110 → 90 to keep the count up (still over
  the 78px a brute needs). 15 trees at fewest over 12 seeds.
- **The funnel grate is round and dark.** **Tanks take 10/15/20** kills (was 8/12/16, "+25%").
  **Drops +25%**: 7.5% a kill, guaranteed within 20, up to 8 live.
- **The start card** is just a blinking "CLICK TO START", with no box.
- **Verified in the page:**
  - Walking down onto a tank stops at its drawn top.
  - No prompt from above the tank; the prompt appears at its base.
  - Canopies block from the side.
  - The gate blocks while opening. After it opens, the player is walked out, ends 700px down the
    tunnel, and the run is won.
  - Frames captured of the gate and a tank. No console errors.

### Intro, gate bar, spawns, tall tanks and trees, the cabinet panel (2026-10-04, third playtest)

- **The intro** (`arcadeBeginIntro`, `arcadeIntroCamera`, `arcadeDrawIntroText`): 11.4s on every
  client.
  - The shots: the whole map "ESCAPE" → zoom to the spawn "YOU" → tank 1 "FILL THE SILOS" → tank 2
    → tank 3 (about a second each) → the gate "INITIATE GATE OPEN — ESCAPE" → back to you.
  - Letterboxed. Controls are off (`updatePlayers` and `interactWith` return early) and the
    lighting is skipped so the map is visible.
  - **The host's clock starts after it** (`arcadeStart` pushes `startTime` forward by
    `ARC_INTRO_MS`), so the wave and the 4:00 curve begin when the camera lands. `el` goes
    negative during the intro, and that is fine because it is a duration.
  - A guest whose first snapshot shows `el` > 1.5s skips the intro (`arcadeIntroSync`).
- **The gate bar** (`gateBar` wall, removed by `arcadeUpdateGateBar` on every client once the
  chainlink is open, with a nav rebuild). A **walled pocket** behind the gate catches anyone who
  walks through, and the exit zone extends into it. Reported as *"I can walk outside of the map
  ... before it's ready"*: the opening was only ever drawn shut.
- **Every spawn stays inside the arena.** `pickSpawnPoint` delegates to `arcadeSpawnPoint` in the
  arcade. Screamer summons, splitter sheds and spawnling births all went through the sector
  placer, which puts zombies in cold sectors and off the map edge: the reported *"zombies are
  spawning outside of the map"*. `placeShed` also refuses a spot outside the fence.
- **Baseball layout:** tanks at centre-left, top-middle and centre-right, and the gate at home
  plate (south-centre). The tank stands `ARENA_PIPE_RUN` (110px) past its funnel's rim, so the
  pipes read.
- **Funnels** are grey bowls stepping darker and slightly down toward a grate, with blood pooling
  as the tank fills (`arcadeDrawFunnels`). **Twin pipes** with flanges carry moving blood while
  the funnel is live (`arcadeDrawPipes`).
- **Tall things, 1D iso** (`arcadeDrawTall`, after `drawZombies`, sorted by footprint bottom):
  - Each **tank** is a solid 70×56 footprint (`silo` wall) extruded 96px up the screen. It has a
    front face with a sight-glass of blood, hoops, a lit top with its number, and the state under
    it.
  - Each **tree** is a solid 40px footprint (was a 26px trunk) with a trunk and a canopy lifted
    30px.
  - `drawWalls` skips `tree`, `silo` and `gateBar`.
- **Density:** 8 patches (was 6), +10% trees and bushes. 18 trees at fewest over 12 seeds.
- **The cabinet panel** (`AESTHETIC_GUIDE.md` §4.11a, required for every game):
  - HI-SCORE (best run, `localStorage` `zombie_arcade_best`) and 1UP (`runScoreFor`).
  - The radar in a hard frame.
  - CONDITION GREEN/YELLOW/RED (`cabCondition`: zombies within 260px, or how full the alive cap
    is; RED blinks), and lives blocks.
  - Then NEXT, the checklist, stats and the loadout.
- The sector-name popup is off in the arcade.
- **Verified in the page:**
  - Controls stay off and nothing spawns during the intro.
  - 60 forced old-path spawns all landed inside the arena.
  - The bar stopped a player at the gate. After it opened, the pocket held them and the run was
    won.
  - The tanks are solid. Frames were captured from the intro and from play. No console errors.

### The arena, terrain, auto-pickup and the sidebar (2026-10-04, second playtest)

From the user's notes on the first local run: *"compress quite a bit so there's less running between
silos"*; *"very visually clear where the silos are"*; *"a permanent minimap ... on a right sidebar
... 15 to 20% of the screen ... the rest of the UI is pushed onto there ... OK not to reflect
zombies"*; *"auto-pick up"*; *"remove field manual, horde switch"*; *"sparse trees & bushes with
denser patches & grass throughout, rather than the alternate floor tiles"*.

- **`ARENA`** (`zombie-core.js`) is a **2400×1400** fenced rectangle at the world's centre.
  `buildArcadeArena()` runs at the end of `openTheArena()`. The world and its placers are
  untouched; the arena just keeps what falls inside it.
  - The three funnels sit on a **fixed triangle** (`ARENA_FUNNELS`), each with its tank beside it.
  - The gate is cut into the arena's south wall between two columns.
  - The route from start through 1, 2 and 3 to the gate is ~3,800px (~16s), down from ~7,850px
    (~33s).
  - The camera clamps to the arena (+90px). Spawns, relocations and drops stay inside it
    (`inArena`, `arcadeSpawnPoint`).
- **Removed:** the rail (`railPaths`, `railcars`, `trainReset()`), the field manual
  (`codexRect`), the horde switch (`intensifyRect`) and the generator rect. **No landmark falls
  inside the arena**; they all stood in the outer sectors.
- **Terrain** (`plantArenaTerrain`, `MP.random` so every client grows the same one):
  - One flat **grass** ground, a fixed-seed tile of tufts, replaces the nine sector floors.
  - **Six dense patches** plus a sparse scatter: 18+ trees and ~44 bushes a map.
  - **Trees are solid** (walls tagged `tree`) and keep `TREE_GAP` 110px apart, so no patch seals
    a pocket. **Bushes are drawn only**: small, lighter ground cover that never reads as a tree.
- **Auto-pickup:** every drop is taken by walking over it, and the F path is gone. It is still
  **one taker**, decided by the host. A perk you have no slot for is not taken and stays for a
  teammate ("CALL IT OUT").
- **The objective beacon** (`arcadeObjectiveTarget`, `arcadeDrawBeacon`) is a pulsing ring plus a
  label on the live funnel, the full tank's switch, or the gate. It is drawn in screen space
  **after the lighting**, so the dark never hides it, with an edge arrow when it's off-screen. The
  beacon, the arrow and the sidebar all read the same target.
- **The sidebar** (`#sidebar`, `arcadeMountSidebar`, `arcadeDrawSidebar`), `clamp(240px, 18vw,
  380px)` wide, full height, contains:
  - the whole-arena map: grass, trees, numbered funnel rings, tanks filling, the gate, drops,
    teammates and you, but no zombies;
  - NEXT, and the goal checklist;
  - the stats and the loadout, **moved** there rather than copied, so every HUD writer still
    works.

  The canvas is the window minus the sidebar, from the left edge, so `clientX` is still canvas
  x. Every overlay that centred on the window now centres on the play area. The corner minimap,
  its NEXT strip and the "perks not on this map" notice are off in the arcade.
- **Checks:**
  - `check-map-features.js` (open map): 12+ trees (18 at fewest when written), no solid outside the arena except the gate's
    columns, and no placed items or openings.
  - **`check-zombie-train.js` now targets `under-development/zombie-rail`**, which is where the
    train lives.
- **Verified in the page:** auto-pickup, perk refusal, first contact at 13.6s with every zombie
  inside the arena, a win at the arena gate, and no console errors. Screenshots were taken at
  1400×800. **Not verified:** a full run by people.

Co-op survival. **The first game in this repo split into classic-script files** rather than one
monolithic HTML — the structure `GAME_PROTOTYPE_INSTRUCTIONS.md` §2 describes but no game had
adopted. Rebuilt 2026-09-01 from a 1040-line single file.

## Load order (matters)

Classic `<script>` tags, no modules — the `file://` hard constraint. **All files share one global
scope**, so every top-level name across them must be unique. Run
`node scripts/check-global-collisions.js` from the repo root after any change here; it reports
`zombie\Zombie.html (10 local scripts)`.

**Updated 2026-09-26.** The evacuation train added `zombie-train.js` (18 local scripts), then the
stamp work added `zombie-stamps.js`, `zombie-stamps-data.js` and `zombie-sandbox.js`, so the
checker now reports **21**. (`stamp-builder.html` is a separate page, not part of the game's load
order, and the checker reports it on its own at 2 local scripts.) (2026-09-18: the playtest pass added `zombie-music.js`, `zombie-icons.js` and
`zombie-floors.js`, taking it to 17.)
(2026-09-07: the dev-tools pass added `../shared/devtools.js` and `zombie-dev.js`, taking it to 14.
2026-09-04: two shared files were added by the aesthetic pass, taking it to 12.) (The 2026-09-02
revision of this table fixed an earlier count of 7 that omitted `zombie-audio.js` and
`zombie-endgame.js`.) Full load order as it actually appears in `Zombie.html`:

| # | File | Owns |
|---|---|---|
| 1 | `../shared/identity.js` | `window.IDENTITY` — the one name→colour fallback. **Must precede mp-core** |
| 2 | `../shared/mp-core.js` | `window.MP` — transport, room seed, identity |
| 2a | `../shared/retro.js` | `window.RETRO` — `snap`/`flicker`, used by `zombie-render.js` |
| 2b | `../shared/leaderboard.js` | `window.LB` — score submission, used by `zombie-game.js` |
| 2c | `../shared/devtools.js` | `window.DEVTOOLS` — the L+G dev panel. **Must precede this game's files**: its error capture only sees throws after it installs, and its keydown listener has to be attached before `zombie-render.js`'s so a combo press can be stopped from also reaching the player |
| 3 | `zombie-core.js` | World size, camera, teardown plumbing, geometry + wire-time helpers, `WEAPON_KEYS` |
| 4 | `zombie-audio.js` | Procedural Web Audio, positional mix, `N` mute, event playback |
| 4a | `zombie-music.js` | **The score** (2026-09-18): organ bed, soprano, beat-quantized chime cues. Needs `audioCtx`/`audioMaster` from 4; `gameLoop` drives it |
| 4b | `zombie-stamps.js` | **Hand-authored building stamps** (2026-09-26): the text format, the checks, rotate/mirror, `ZS.build()`. Declares only. **Before the level**, which places them |
| 4b2 | `zombie-map-data.js` | **The authored map**: hard-wired building placements, written by the map editor. Declares `ZMAP` |
| 4c | `zombie-stamps-data.js` | The stamp library — **the file drawings are pasted into**. `ZS.add()` checks each one and drops a failing stamp with a console warning |
| 5 | `zombie-level.js` | Seeded geometry, the solid spatial index, `moveWithCollisions`, funnel halls, perk stations |
| 6 | `zombie-entities.js` | Players, weapons + switching, zombie archetypes, perks, bullets, pickups |
| 7 | `zombie-endgame.js` | Roles, the sluice levers, funnels, silos, pipes, the flood, the tunnel |
| 7a | `zombie-train.js` | **The evacuation train** (2026-09-26): the rail line, the cars, 1-D physics, coupling, carriage, the cowcatcher. Declares only; reads `railPaths` (5) and `siloFill` (7) |
| 8 | `zombie-game.js` | Round curves, simulation, economy, revive / bleed-out / wipe / respawn, perk procs, generator trip |
| 9 | `zombie-net.js` | MP wiring, snapshots, broadcast |
| 9a | `zombie-icons.js` | Pixel-bitmap icons for every perk and gun (no emoji) → canvases + data URLs. Declares only |
| 9b | `zombie-floors.js` | Per-zone floor textures + grime noise map. Declares only; builds lazily on first draw |
| 10 | `zombie-render.js` | Draw, HUD, minimap, input, **boots the loop** |
| 11 | `zombie-dev.js` | Dev-panel registration: the state readout and the playtest buttons. **Last** — it reads names every file above declares, registers, and (since 2026-09-18) wraps `hostHandleBuy`/`spawnZombie`/`spawnZombieAt`/`nearestPrompt` for the FREE BUYS / NO ZOMBIES toggles — see "Controls" |
| 14 | `zombie-input.js` | **Gamepad + touch** (2026-10-14): the pad poll, the touch overlay and its CSS, `inputFrame`. After `zombie-lobby.js`; read by one line in `gameLoop`. See "Fifteenth" |

| 13 | `zombie-mapedit.js` | **The map editor** (2026-09-26), opened by double-clicking `map-editor.html`, which redirects to `Zombie.html?editor=1&solo=1`: it takes the page over — the whole map, SPACE to flip between a schematic PLAN and the game's own `draw()`, click to place a building, E to export. Last, because it drives everything above it |
| 12 | `zombie-sandbox.js` | **The stamp sandbox** (2026-09-26): `?sandbox=1&solo=1#stamp=...` drops a drawing into the real map and stands the player at its door. **After `zombie-dev.js`**, whose NO ZOMBIES flag `&zombies=0` sets, and it wraps `spawnPlayer` rather than editing it. Regenerates the level once at boot, because `zombie-game.js` has already built one by the time this file runs |

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

## The simulation clock (2026-10-03)

`HUB_1_0_PLAN.md` Phase 1. **`update()` runs in fixed 60Hz steps** (`Z_STEP_MS`) from an accumulator
in `stepSimulation()` (`zombie-render.js`), not once per rendered frame. Two faults had the same
cause:

- **Movement is pixels per call, not per second.** Players, zombies and bullets all move a fixed
  amount per `update()`, so one call per rAF frame ran the game **2.4x fast on a 144Hz monitor**.
  Measured headless: 60, 144 and 30Hz frame rates now all give ~60 steps a second.
- **A hidden host froze the room.** A background tab gets no rAF, and the host owns zombie AI, the
  round clock, the scrap pool and `broadcastWorld`, so one alt-tab left every guest staring at
  CONNECTION UNSTABLE. Now `zBackgroundTick` (a `trackInterval`, 250ms; browsers throttle it to
  ~1Hz in a hidden tab) steps the world whenever rAF has been silent for 300ms. It catches up to 60
  steps a tick, so a hidden host still simulates at close to full rate. Measured in a hidden
  Browser pane with zero frames drawn: **57.6 steps/s**, with zombies spawning.
  - **Only for a host with a connected guest.** A hidden solo game still freezes, which is the
    honest pause it always was. A hidden guest still freezes too: it stops sending, the host marks
    it AWAY and pauses its bleed-out. That's kinder than an unattended body left in the fight.
  - **Not a Worker**, because Chrome won't construct one under `file://`.
- **A rendered frame catches up at most `Z_MAX_STEPS` (5, ~83ms)**, and anything owed beyond that
  is dropped rather than queued. That matches the old `Math.min(100, dt)` clamp, so returning to a
  tab doesn't lurch.
- Each step gets its own timestamp, spread back across the gap, so per-step gates (the spawn gap)
  still see time pass between steps.
- `lastFrame` is now the **simulation's** clock. `zLastDraw` is the rendered frame's, and
  `musicUpdate` still gets the frame dt.
- **Not verified in the browser at 144Hz, or by the group.** The Browser pane draws no frames
  while it is hidden, so the visible-frame path is measured headless only.
- **What it may change in feel:** anyone who played on a high-refresh monitor was playing a faster
  game than the 60Hz numbers assumed, and now isn't. Remote interpolation and the camera were per
  frame and still are.

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
| Blackout round | **+0.26 on top of whichever applies** (was +0.20 until 2026-09-18) | `AMBIENT_BLACKOUT_ADD` |

Clamped to 0.9. **Do not add a second copy of these numbers anywhere** — that is exactly how the
two tables came to disagree.

### Blackouts trip the generator (2026-09-18, on request after a playtest)

"Black-out rounds should be slightly darker than current, and should force the players to restart
the generator prior to blackout stopping." So a Blackout round that starts with the generator
running **trips** it (`tripGenerator()`, `genTripped`): the map drops to 0.9 (the cap), the perk
stations die, and **the round cannot clear while it is tripped** — once the budget is spent,
stragglers keep coming every 2.6s (capped at 6 alive). Restarting is free and physical: anyone
alive standing within `GEN_RESTART_REACH` (40px) of the generator fills `genRestart` over
`GEN_RESTART_MS` (5s); step off and it drains at half speed. Host-tracked from positions the host
already has — the gate plates' pattern — so it needs no message; `gt`/`gr` ride the snapshot.
After the restart the round reads 0.22 + 0.26 = **0.48** (it was 0.42) until it clears.

A generator that was never bought has nothing to trip: that Blackout is the old kind, just darker.

**The cap was deliberately not moved.** 0.94 is the number that playtested as a guaranteed loss;
the light radius and the four-band ramp are untouched.

Your light is a radial gradient: fully clear to `LIGHT_RADIUS` (340), fading to ambient over an
extra 33% (to ~452). A canvas radial gradient paints its last stop everywhere beyond the outer
circle, so one fill does the pocket, the falloff and the flat ambient together.

v2 blacked out at **0.94 with a hard-edged 210px hole**, which playtested as a guaranteed loss.
Blackout after the generator is now a 0.20 dip with 2.6x the fully-lit area. *(2026-09-18: a 0.26
dip, and a running generator trips first — see "Blackouts trip the generator" below.)*

**Powerup cards — "PERKS" in the UI since 2026-09-18**: 3 slots, each **stackable to x3**, bought
at stations and **inert until the generator runs** (and dead again while a Blackout has it
tripped). Every effect scales with stack. The code keeps `cards`/`CARDS`/wire `cd`; only the words
players read changed, because "perks" is what they call them.

| Perk | Does | Base |
|---|---|---|
| `OVERDRIVE` | Fire rate (requested). **On every map** | 11,000 |
| `SCAVENGER` | +60% scrap per kill | 9,000 |
| `RICOCHET` | Rounds bounce off walls (not rockets / flame) | 9,500 |
| `DECOY` | **Replaced `BEACON`.** Your ping lures zombies within 320/400/480px for 4/5/6s; recharge 12/10/8s | 10,000 |
| `SPITE` | Going down detonates | 9,000 |
| `CONDUCTOR` | Traps cheaper, armed longer | 9,000 |
| `ARC` | Kills bolt to 1/2/3 more within 180px; damage scales with `zombieHpMultiplier` | 12,000 |
| `BLASTCAP` | 18/28/38% of kills burst (95px); **bursts never chain** | 12,500 |
| `SKEWER` | +1/+2/+3 pierce (the ULTRA still stops it) | 10,500 |
| `LAST STAND` | Down: x1 fire the pistol, x2 any gun, x3 crawl ×1.6 and bleed out ×1.5 slower | 9,500 |
| `SALVAGE` | 30/45/60% of kills refund a round to the gun in hand, scaled by `WEAPONS[].salvage` | 10,000 |

`BEACON` (a ping lit every zombie on the minimap for 5s) was cut on request: never worth a slot.
DECOY keeps the ping as the perk's hook, and is host-decided: the `ping` message now carries the
pinger's `id`, the host checks that player's level in `registerDecoy()`, and live lures ride the
snapshot as `dc` so every client draws the ring. Zombies inside a lure follow a third flow field
(`navFieldDecoy`); **contact is still tested against the real player**, so a lured zombie walking
through you still downs you.

**Procs only fire from weapon kills.** `damageZombie(index, dmg, owner, now, src)` takes a source,
and `PROC_SOURCES` is `shot`/`rocket`/`flame`/`burn`. A kill by an arc, a burst, a barrel, a trap
or SPITE cannot set off ARC or BLASTCAP — otherwise one kill in a dense horde cascades through all
of it. The same `src` keeps burn and flame from flashing a zombie white every tick.

**Stations: one in each of the 8 outer zones, OVERDRIVE always among them** (`CARD_ALWAYS`),
the other 7 drawn from the remaining 10, so 3 perks are absent from any map. The playtest's
"OVERDRIVE didn't spawn" had two causes, both measured on the old code: the 4-of-6 draw left it off
**61 of 200 maps**, and `placeCardStations` skipped a station outright when `findOpenSpot` came
back empty. Stations now use `findOpenSpotSure()`, which cannot fail. The absent three are listed in
the manual and announced on the objective line the first time power comes on (`absentCardKeys()`).
Prices are **per perk**, not per station slot, so a perk costs the same on every map.

`p.cards` is a **flat array with repeats**; the stack level is just how many times a key appears
(`cardLevel()`). That keeps the wire format an array of strings and leaves `hasCard()` unchanged.
Slots cap *distinct* keys at 3 — stacking one you already hold never needs a free slot. Cards ride
in the players payload (`cd`) because the **host** resolves damage and payouts and therefore needs
the *shooter's* cards, not its own.

Each perk has a **pixel icon** (`zombie-icons.js`) drawn on its station, in the HUD and in the
manual. The station prompt no longer prints the blurb — the playtest found a sentence on a world
prompt hard to read mid-fight — so the words live in the field manual only.

**Six weapon wall-buys exist on the whole map** — rifle (1,500), shotgun (2,600), SMG (3,400),
sniper (4,200), flamethrower (**5,800**) and rocket launcher (7,500), each in a different zone.
*(Four until 2026-09-18. The flamethrower was 5,200 until the 2026-09-19 nerf.)*

> **Which zone is no longer a coin flip (2026-09-19).** The sniper "preferring a long-sightline
> zone" is now the rule for every gun: each belongs to a **template**, not to a shuffled zone
> index. See "Zones have identity".

### Weapons: switching, rockets, flame (2026-09-18)

- **Switching exists now.** `1`–`7` select (`WEAPON_KEYS` order), the wheel cycles, and a gun that
  runs dry hands over to the **next gun you own** rather than to the pistol. `p.owned` records what
  was bought separately from what has rounds — a crate refills every owned gun, dry ones included.
  This closes the old known gap, and it was necessary: without it, buying the 12-round rocket
  launcher threw your rifle away.
- **`WEAPON_KEYS`** (`zombie-core.js`) is the one ordered list for the wire index, the voice and
  the number key. It replaced `WEAPON_SND_KEYS`. **Append only.**
- **Rocket**: detonates on the first zombie, wall or barrel it touches, or at the end of its range —
  direct hit plus a 150px splash with falloff, and it sets off barrels. A crate only half-fills it
  (`crateFrac`). A guest's rocket goes off **locally** on the frame it visibly hits, and the host's
  `SND_EXPLODE` event carries that guest as its owner so it is not drawn twice (verified: one blast
  on the shooter, one on the host).
- **Flamethrower**: three piercing flames per 70ms shot (≈ the SMG's message rate), 280px, and
  anything touched burns (`burnUntil`/`burnBy`, damage over time credited to whoever lit it; burn
  rides the zombie row as a remaining duration).
  **Nerfed 2026-09-19** on a playtest call of "a bit OP", and only slightly: cost 5,200 → 5,800,
  `capacity` 400 → **340**. One ammo is spent per *trigger pull*, not per pellet (`shoot()`
  decrements once before the pellet loop), so `capacity` is seconds of held trigger: 28.0s → 23.8s.
  Damage, cooldown, pierce, range and burn are untouched — what makes it strong is pierce against
  a crowd (~21 dps on one zombie, ~170 on eight), and that is also what it is priced for.
  **`salvage` / `salvageAmt` (1 / 5) are deliberately untouched.** The brief asked that the nerf
  "pair well with the salvage perk", and cutting the magazine is what *creates* that pairing:
  SALVAGE refunds 5 rounds on 30/45/60% of kills, so at x3 into a crowd it nearly sustains itself
  and without it you now feel the 340. Nerfing the refund as well would delete the answer at the
  same moment as the problem.
- **Shapes**: `WEAPONS[].shape` is how a round is drawn (slug, tracer, pellet, needle, streak,
  finned rocket, cooling flame). `bsize` is the collision box — the five original guns all stay 8,
  so the shape change is not a balance change.
- **A guest's round now stops where it visibly hits** instead of sailing through the zombie to the
  wall behind (visual prediction only — damage is still the host's).

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
on every input, nothing before. **`N` mutes** (it was `M` until 2026-09-18, when `M` became the map
toggle); the preference persists in `localStorage`.

~~The **intensity drone** (idea 45) tracks the live zombie count within 1000px and pitches a low
oscillator to it — silent below 4 zombies, full at 28.~~ **Removed 2026-09-18 on request** ("has to
go"). Its job — telling you how bad it is getting when the tight FOV can't show you — moved to the
score.

### The score (`zombie-music.js`, 2026-09-18)

Asked for in the playtest: an eerie low organ that opens on chimes, intensifies with the nearby
count up to a limit, a harmonizing soprano that eases in under pressure, and chime cues **in
tempo** for round changes and the sluice unlock (its own building tune).

- **One tempo grid**, 66 BPM. Everything — every cue included — is scheduled on it, a 0.4s
  lookahead ahead of the audio clock, **from `gameLoop`** (`musicUpdate`). No timer of its own; the
  only long-lived node is the tremolo LFO, which `musicStop()` ends and `zDestroy()` calls.
- **Organ bed**: 8 bars of D minor (i, VI, iv, V, i, the Neapolitan ♭II, vii°, V7), drawbar
  PeriodicWaves with a celeste-detuned second pipe. **Intensity** = zombies within 1000px of you,
  `(near − 2) / 28`, **capped at 30**, eased (rise 1.2s, fall 5s): it opens the drawbars and the
  filter, adds a pedal pulse from 0.25 and an eighth-note ostinato from 0.55.
- **Soprano**: a formant-filtered "ah", two held notes a bar, always chord tones — eases in from
  **12** nearby zombies, fully in at **26**.
- **Cues**, quantized to the next beat and, for most, restarting the progression so they always
  land on D minor: `start` (opening chimes, then the organ swells in), `round`, `clear`, `trip`
  (an unresolved tritone), `power` (D major — the one bright chord), `unlock`, `win`, `over`.
- **The sluice build layer**: while the plates are held, chimes climb the current chord, denser
  and louder as `gateProgress` fills and denser again on the second lock. `unlock` resolves it.
- **Intensified, the score turns cold (2026-09-19).** The organ bed is **replaced**, not layered
  over — the brief said the music *changes*, and an organ under a drum kit is a thicker score, not
  a colder one. What plays instead: a dry kick on 1 and 3 (`musKick`), rim clicks on the offbeats
  (`musRim`), **one** high chord tone a bar on the bell voice, and a near-silent pedal an octave
  under the bass so the key is still there. No chord, no ostinato, no soprano. "Cold" is a mix
  decision rather than a note choice: short envelopes, no tail, no room — a kick that rings is
  warm, one that stops is not. Same `MUS_PROG`, so the key never moves and the end cues still land
  in D. **The sluice build layer is deliberately left running**: it is the gate's own tune and it
  still has a job after the switch is thrown.
- **`roundHard`** replaces the `round` cue while intensified — three struck hits low-to-high
  instead of a four-note melody — and it is the one cue with `transpose: true`, so `musPlayCue`
  lifts the whole thing a semitone for every round since the switch was thrown
  (`musIntensifyRound`), capped at an octave (`MUS_TRANSPOSE_CAP`; past that the bell partials
  thin out and it stops reading as the same instrument). That is what makes "a harsher more
  percussive raising note each time" raise across a whole run rather than only inside one cue.
  Measured: 0 / 1 / 4 / 12 / 12 semitones at rounds 1 / 2 / 5 / 13 / 30.
- **Cues are driven by STATE** (round number/phase, `gateStage`, `genTripped`, `generatorOn`), not
  the event queue: events are capped at ten a snapshot and are the first thing dropped. So the old
  `SND_ROUND_START`/`SND_ROUND_CLEAR` stings are no longer emitted at round changes;
  `SND_ROUND_CLEAR` is still the silo-full and flood-cleared sound.

Verified headless against a recording mock `AudioContext`: the opening tolls, the organ, no
soprano on an empty map, the soprano in (and on chord tones only) with 32 zombies near, the
intensity cap, the ostinato, the round cue, the build layer (0 → 36 bells over 3s at 90% progress),
the unlock flourish, the game-over cue, and the score and its LFO stopping afterwards.

**The siren (`SND_SIREN`, 2026-09-19) is the one exception to the positional rule.** Everything
else pans and falls off with distance; the horde call is meant to be everywhere at once, so
`playEvent` returns it straight to the master bus before `audioPlacement` is ever consulted. If
you add another sound like that, do it the same way rather than by giving it a huge radius — a
radius that large silently changes the mix for every other sound sharing the falloff curve.

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
3. **Nav resolution must exceed the smallest opening — FOR THE BODY USING IT.**

   > **THE GRID SPLIT IN TWO ON 2026-09-26 and this rule now has two answers.** There is a TIGHT
   > grid at `NAV_TIGHT_PAD = 0` for bodies of 20px and under (walker, runner, screamer, splitter,
   > spawnling) and the old WIDE grid at `NAV_PAD = 19` for brute 26 and the 34px ULTRA HEAVY /
   > SUPER SPLITTER. A walker paths through a **one-cell, 20px** door; a brute still needs **78px**.
   >
   > **`NAV_TIGHT_PAD` HAS TO BE 0, not 1.** Cell testing is whole-cell, so a one-cell doorway is
   > exactly `NAV_CELL` wide and *any* padding makes the walls beside it overlap the padded box —
   > the door disappears from the grid entirely. This is also why stamps snap to the 20px lattice:
   > an 80px door 11px off the lattice loses its clear column to alignment, which sealed an entire
   > hand-drawn building to the flow field while it stayed perfectly walkable to a player.
   >
   > Why: the single wide grid made 78px the narrowest opening ANY zombie could use, so every
   > hand-drawn building needed 4-cell doors and no interior wall within four cells of another.
   > Interesting buildings were forced to be enormous. **A tight door is now a design tool** — it
   > is a room walkers swarm and brutes cannot enter, and the stamp builder warns when a stamp has
   > no 4-cell door at all so that choice is made on purpose.
   >
   > **Anything that writes the grid must write BOTH.** `refreshNavRegion()` (the door-purchase
   > fast path) wrote only the wide one at first, which would have left a door the team had just
   > bought still shut to every walker, with nothing on screen to say why.

   The old rule, which is still exactly right per grid: a gap is only *guaranteed* to contain a
   nav cell at `2*NAV_CELL + 2*that grid's pad` px — cell size, plus the padding on each side, plus up to
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

   *Updated 2026-09-18.* The ULTRA HEAVY is 34px, so **`NAV_PAD = 19`** (half of it plus the same
   2px of skin) and the threshold is **78px**. *(The SUPER SPLITTER replaced it on 2026-09-20 at
   the same 34px, so the pad is unchanged and for the same reason.)* The nook escape hole (`NOOK_HOLE`) was 74 — under the
   new guarantee — and is now **90**. Every other opening already cleared 78; funnel halls were 240.

   *Updated 2026-09-19.* Funnel halls are **no longer 240**: each end is pinched to `HALL_DOOR`
   (**140**) by four jambs, so the halls read as rooms with doors rather than open-ended tubes.
   **140 is now the narrowest opening in the game** — outpost doorways 112 are wider only because
   the hall figure is the *clear span between jambs*. Current list, narrowest first: funnel-hall
   ends **140**, outpost doorways 112, windows 112–151, keep and sluice 120, doors 124–159, the
   nook hole 90. So the nook hole is still the true minimum and the guarantee holds with 12px to
   spare there and 62px at a hall. **If `NAV_CELL` or `NAV_PAD` move again, check `HALL_DOOR`
   first** — it is the number most likely to be forgotten, because it is computed rather than
   written as a literal opening.
4. **Opening a door refreshes only its own patch of the nav grid.** A full rebuild is 32,400
   cells and cost ~17ms — a dropped frame at the exact instant of a purchase, which is the worst
   possible moment for a stutter. `rebuildSolidIndex` diffs the door signature and calls
   `refreshNavRegion()` on just the doors that changed (1.3ms, and bit-identical to a full
   rebuild). A full rebuild is still used when the level itself is regenerated.
4a. **Seed the flow field from a cell the field can flow out of.** `navFieldFrom()` snaps every
   source to the nearest **passable** cell (`navNearestPassable`). It used to seed the player's own
   cell — and a player touching a wall stands in a cell the grid calls blocked, so the BFS expanded
   out of a cell no path could reach and whichever neighbour happened to be open decided the route
   for the whole horde. A one-pixel step across a cell boundary swapped which one that was, so
   **hovering against a wall flipped every zombie's direction at each field refresh and dodged them
   entirely** (reported 2026-09-26; measured at 120 of 120 positions along one wall giving the
   zombie no field route at all).
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
`dead`, `rvs`, `pickup`, `buy`, `bought`, `ping`, `reset`, `won`, and **`over`** (2026-09-18 —
the host calling the room wiped).

**Wire additions, 2026-09-18** (all appended, all durations never timestamps): zombie rows carry a
5th element, burn ms left, only while burning; bullet rows carry the gun index (`WEAPON_KEYS`) and,
for flame, distance travelled; `world` gains `gt`/`gr` (generator tripped / restart progress), `sb`
(the scoreboard — **guests never received it before**, so the round-end table only ever showed on
the host) and `dc` (live DECOY lures); `shoot` gains `wk` (the gun); `ping` gains `id`.
`Z_TYPE_KEYS` gained `ultra` **on the end** — both index lists are append-only wire values.

**Wire changes, 2026-09-19:** `players` rows **lost `rv`** (a guest's copy of its own revive
progress — echoing it back is what made the revive bar pulse; progress now travels only in `rvs`,
host → room) and **gained `sk`** (the socket id the row currently rides, so a server `leave`, which
names sockets, can be matched to a player). A player's `id` is now `<tab token>:p`, not
`<socket id>:p`.

### Connection trouble (2026-09-19)

Asked for after a playtest: *"a lack of penalty for wifi issues, but also welcoming to other friends
joining in mid game."* What a drop used to cost, read from `server.js` and `mp-core.js`: every
reconnect is a **new socket id**, and the player id, the role, the scoreboard row and the host's
bleed clock were all keyed on it; a dropped client flipped to **solo host** and ran its own fork of
the world, where it could die and then reset the room with "restart"; and a merely stalled socket
left the host mauling the player's last known position while their screen froze. Now:

- **Identity is a per-tab token** (`netToken`, `sessionStorage` key `zombie_tab_token`), not the
  socket id. Survives drops and page refreshes. `netPrefix` is still the socket id — routing and
  host checks only. A duplicated tab copies sessionStorage, so the `players` handler watches for its
  own token on another socket: **only the higher socket id re-rolls, and only once the clash has
  lasted 1s** — both re-rolling cost the original tab its class, and a single stray packet from our
  own dead socket (relayed just after a reconnect) must not cost a reconnecting player theirs.
- **Away, not gone.** A teammate silent for `AWAY_AFTER_MS` (1.2s), or `leave`d by the server, is
  `r.away` for up to `AWAY_GRACE_MS` (60s): drawn at 35% with a blinking RECONNECTING, grey on the
  minimap and the offscreen arrows, **out of `allTargets()`/`livingTargets()`/`teamSize()`/
  `anyoneAlive()`/the gate plates**, and a downed one's bleed-out clock pauses (`rec.pausedAt`,
  added back on return). The wipe grace is `WIPE_GRACE_AWAY_MS` (10s) instead of 2s while a
  teammate who was *standing* when they dropped is away. Back inside 60s → same record, same
  scoreboard row, RECONNECTED toast.
- **A client that loses a shared room HOLDS instead of forking** (`netLost`): `update()` returns
  early, input is released, and the CONNECTION LOST overlay counts up; after `NET_LOST_OFFER_MS`
  (15s) it offers ENTER → `goSoloAfterLoss()`, which gives the held time back to a downed player's
  bleed-out. mp-core keeps retrying every 3s regardless; a reconnect clears the hold, and the
  host's snapshot (`ls`) folds us back in. **Alone in the room, a drop is still plain solo** —
  there is nobody to disagree with.
- **A local game over while the room plays on** (went solo, died out there) → the next `go=0`
  snapshot runs `rejoinRunningRoom()`: back as a teammate who bled out, respawning at the breather,
  rather than sitting on a card whose "restart" would reset the room. Guarded on `pendingReset`, so
  a real restart is not mistaken for it.
- **Late joiners** (a guest spawning with `round >= 1`) arrive **beside a standing teammate**
  (`standingTeammate()`/`spotBeside()`) with 4s of protection instead of at the keep, and past
  round 4 with a rifle in hand. Everyone sees JOINED / LOST CONNECTION / RECONNECTED toasts.
- **CONNECTION UNSTABLE** (top right) on a guest that has had no snapshot for 1.5s.

**The revive-bar pulse** was the same family: the `players` handler *rebuilt* each remote record
from the guest's payload, including `rv`, the guest's copy of its own revive progress, always a
round trip old — so 15 times a second the host's live value was knocked back to a stale one.
Measured through the local relay: 34 / 69 / 65 reversals at 0 / 60 / 150ms and a 3s revive taking
5.4s or never finishing; after, 0 / 1 / 1 (the one is the bar completing) and 3.0–3.1s. The record is
now updated **in place**, progress has **one source** (`rvs`, now every 100ms), a reviver already
reviving keeps it out to `REVIVE_KEEP` (+18px) so a range edge can't flicker it, and the drawn bar
eases (`p.reviveShown`: rises gently, drops at once).

**Not fixable from here:** a host whose socket stalls *without closing* freezes the world for the
room (everyone sees CONNECTION UNSTABLE) until the server notices it is gone and re-elects. Host
election belongs to the server, which cannot change. A host that drops cleanly is promoted away
from in the ordinary way, and the new host inherits the round from the last snapshot.

### Death, respawn and the team wipe (2026-09-18)

Reported: *both players went down in a two-player game; one of them simply respawned at the start
instead of the run ending.* Reproduced headless on the old code with two clients through a local
relay: at 25s the host bled out, the guest stayed downed **forever**, nothing ended, and a keypress
walked the host straight back in at the keep. Three faults:

1. **A guest never bled out.** The bleed-out check ran only for the *host's own* player
   (`netIsHost && p.bleedDeadline`); nothing tracked a guest's deadline. Now the host keeps
   `remoteDowned[id] = {at, bleedAt}` for every downed guest (set in `downPlayer`, cleared on a
   revive or a RALLY, re-created with a fresh clock for a downed guest a promoted host never saw
   go down) and `updateRemoteBleed()` sends `dead` when it runs out. A guest's own "players"
   message can land a frame after the down with its pre-down state; the record's first 1.5s stops
   that reading as a second down (and a double alarm).
2. **`spawnPlayer()` had no notion of a run in progress**, so any key respawned a dead player. It
   now refuses while `zAwaitRespawn` is set.
3. **"Everyone down" was not an ending** — only "everyone dead", which 1 made unreachable.

The rules now: **nobody standing in the room → a 2s grace (a downed player crawling onto a RALLY
can still save it) → game over**, decided by the host (`updateTeamWipe`) and sent explicitly as
`over` — the snapshot's `go` flag alone can miss its only send, because `update()` stops
broadcasting the moment `gameOver` is set. A player who **bleeds out while a teammate stands** is
dead until the breather that ends that round (DESIGN_IDEAS #1's "dead for the round"), watching a
teammate by their light, then respawns at the keep with a pistol and **keeps their perks**
(`respawnLocalPlayer` path in `updateRespawn`). Solo, going down is now game over — which retires
the old known gap "a solo player going down is a 25s crawl that ends in death regardless".

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

> **Rewritten 2026-09-19.** ~~Nine 1600×900 zones, each with a seeded template shuffled into it
> from a pool of eleven: `COLD STORAGE`, `THE DRY POOL`, `SPILLWAY`, `THE KENNELS`, `DEAD LETTER`,
> `SLAG HEAP`, `TICKET HALL`, `THE ANNEX`, `PUMP HOUSE`, `MOTOR POOL`, `THE LAUNDRY`, plus
> `TURBINE HALL` and `THE BLOCKHOUSE`.~~ The templates were the right idea solving half the
> problem — a zone had a *character* but not a *place*, because its shape and position were
> re-rolled underneath it. See "Map — nine PAINTED sectors" below for what replaced them. THE DRY
> POOL, THE LAUNDRY, DEAD LETTER, SLAG HEAP, TICKET HALL and THE ANNEX are retired; the names are
> kept in `zombie-level.js` as a list to draw on if the map ever grows past nine.

Nine sectors, each with a fixed shape, a name you can call out (`zoneName(i)`) and a hero
structure: `THE SPILLWAY`, `COLD STORAGE`, `THE KENNELS`, `THE YARD`, `THE BLOCKHOUSE` (centre),
`TURBINE HALL` (the generator), `PUMP HOUSE`, `THE SLUICE YARD`, `THE MOTOR POOL`.

Sectors differ in **shape and proportion** (5 to 18 cells, bbox fill 58–81%), building density,
barrel and crate counts, whether they hold an outpost or long sightline corridors, and **how many
guns and perk stations they carry**. That is what makes "which door do we buy?" a real decision
rather than a coin flip.

### A gun and a perk belong to a TEMPLATE, not to a zone index (2026-09-19)

Asked for as "make perk / spawn locations consistent for guns / perks / silos in areas that make
sense (even if sometimes perks don't spawn)".

There used to be **two** layers of randomness stacked on each other: templates were shuffled into
zone slots (`assignZones`), and then guns and perks were shuffled across zone *indices*
(`placeWallBuys`, `placeCardStations`). So the sniper was in a corridor zone by design and
everything else was a coin flip — the same map twice running put the shotgun in two unrelated
places, and no zone was ever worth remembering.

> **Simplified again 2026-09-19 (later the same day).** Binding a gun to a *template* was one
> layer short: the template still moved around the map. Now the sectors themselves are fixed, so
> a gun simply belongs to a **sector**, listed on `SECTORS[].guns`. No preference lists, no
> fallbacks, no shuffle. THE KENNELS sells the shotgun and THE KENNELS is always the same shape in the
> north-centre. `GUN_COSTS` holds the prices; `PERK_SECTOR_HOMES` does the same for perks, with the
> seed only choosing among a sector's own list and filling any spare slot from whatever is
> unplaced — so a sector's stock is recognisable without being identical every run.
>
> Measured over 200 seeds: **every gun and every perk in its named sector 100% of the time**, 6
> guns and 8 stations on every map, nothing in the wrong sector.

**Each sector has its own floor (2026-09-18, `zombie-floors.js`)** — the playtest found the areas'
identity too faint. A 64×64-texel tile, drawn 2 world units a texel with smoothing off: freezer
tiles with frost (COLD STORAGE), dirt and straw (THE KENNELS), wet concrete with water and a grate
(THE SPILLWAY), oil-stained concrete with a bay line (THE MOTOR POOL and THE YARD), diamond plate
(PUMP HOUSE), grating (TURBINE HALL), concrete block (THE BLOCKHOUSE), and wet stone "drain" slabs
for the sluice room and the funnel halls. Tileable value noise only ever *picks* between each
tile's few flat colours — no gradients — and one large **grime noise map** (three flat alpha steps,
1024px repeat) over everything breaks the 128px repeat. Generated from fixed seeds: never
`MP.random()` (it would shift the level stream) and never `Math.random()` (players must be able to
say "the blue tiles"). The minimap tints each sector to match (`ZONE_FLOOR_TINT`).

> **The palette was RE-SOLVED on 2026-09-20 (`MAP_DESIGN_GUIDE.md` P7), and the old one was
> measurably not doing its job.** In CIELAB the minimum dE76 between two sectors that *share a
> boundary* was **5.5** (Spillway / Cold Storage, over a four-cell border -- the same colour at a
> glance), six of eighteen adjacent pairs fell under dE 12, and Turbine Hall / Pump House sat 2.2
> apart, one tint occupying two of nine slots.
>
> The deeper fault was tonal: every floor in the game sat inside a **7.5-point lightness band**
> (L* 23.3-30.7), so the tints were asked to do all their work in hue and chroma, at very low
> chroma, in a dark scene lit by a 340px pocket. Lightness is the one channel that survives those
> conditions and it was unused.
>
> Solved under three constraints so it is a re-solve and not a repaint -- hue within 34 degrees of
> the original, chroma 10-24, L* 18-36 so nothing reads as lit floor:
> **min adjacent dE 5.5 -> 22.7, mean 16.9 -> 34.7, pairs under 12 six -> zero, min dE between ANY
> two sectors 2.2 -> 19.0, L* range 7.5 -> 18.0.**
>
> **The chroma FLOOR is load-bearing.** A solve without a lower bound greyed the Spillway out to
> `#2C2C2C` -- at very low chroma the hue lock stops meaning anything and the sector lost its
> water. A later one had a floor but seeded from the current values, three of which are already
> below it, so those sectors were rejected on every move and **never changed at all**. Seed *at*
> the floor, then optimise.
>
> These are **tints**: `ZF_PAINTERS` mixes several flat colours per zone over the top, so the
> shipped contrast is not these numbers. Re-measure against rendered tiles, not the table. If the textures cannot be built, `drawGround()`'s
old grid is the fallback.

> **Extended 2026-09-19 into three layers — EXTERIOR / INTERIOR / UNIQUE.** The tiles above were
> washed across a sector's *whole rect*, so freezer tile ran over open ground and a wall was the
> only thing telling you that you were indoors. They are the **interior** layer now and are painted
> only inside a room footprint; open ground gets a flat, low-contrast **exterior** (dirt, gravel,
> asphalt, concrete, wet concrete) and a structure's own ground gets a **unique** tile (rail
> ballast, pipe invert, hardstanding). The tile *generators* did not change — only where they are
> painted. See "Map — nine PAINTED sectors" below.
>
> The old floor tiles for the retired sectors (pool, laundry, letter, slag, ticket, annex) are
> still in `ZF_PAINTERS` and still good; nothing on the map selects them.

**Generation order changed (2026-09-18) and fixed a real layout bug.** The sluice used to be built
*after* every zone's contents, and corridors, outposts and the generator never checked
`reservedRects` at all. Measured on the old code: **239 of 300 seeds had zone walls inside the
funnel room, and 68 had a gate plate walled off** — maps on which the two-player gate, and so the
whole endgame, could not be finished. Now `buildSluice()` runs before `buildZoneContents()`,
corridors / outposts / the generator avoid reserved ground (re-roll, then drop), the generator
never lands in the sluice zone, and every floor item (crate, barrel, wall-buy, station, generator)
claims its footprint in `keepClearRects` so none lands on another — on the old code stations,
wall-buys and the generator could spawn **inside walls** or on top of each other. A 500-seed sweep
of the new code is clean on all of it (`PLAYTEST_PASS_PLAN.md` → Verify).

**Boundary cover spurs must be clipped 150px clear of a boundary intersection.** Unclipped, a spur
from one wall and a spur from the perpendicular wall formed an L that boxed in a corner pocket
nothing could path into — a free safe spot, and a trap for any zombie that wandered in.

## THE WORLD IS BIGGER THAN THE SECTORS (2026-09-26)

Asked for as *"stretch exterior perimeter band without stretching sector shapes"*, and that is
exactly what it does.

| | |
|---|---|
| `MAP_INNER_W` x `MAP_INNER_H` | **4800 x 2700** — the nine sectors, unchanged |
| `MAP_BAND` | **400** all round |
| `WORLD_W` x `WORLD_H` | **5600 x 3500** |
| `MAP_X0`, `MAP_Y0` | **400, 400** — where the sector grid starts |
| `ZONE_CELL_W/H` | **200 x 150**, unchanged, and now derived from `MAP_INNER_*` |

**The trick is that the cell size comes from the inner rectangle, not the world**, so growing the
world cannot stretch a sector. What it costs is an ORIGIN: every cell-to-world conversion goes
through **`zoneX` / `zoneY` / `zoneCol` / `zoneRow`**, and **a bare `c * ZONE_CELL_W` is now a
bug** — it lands a whole sector's worth of geometry 400px out. The sites that had to change were
`zoneBoxes`, `randomPointInZone`, `zoneOf`, `zoneCellsNear`, `zoneBoundaryRuns`, the boundary
grid, the rail spur's cell literals, the Spillway's runs, and the floor painter.

**The band is real ground**: the forest, the hard wall and its culverts now sit out there, so the
sectors keep their whole area and there is somewhere to author a perimeter. `zoneOf` clamps, so a
point in the band belongs to the sector it is nearest and everything that asks "which sector is
this?" keeps working without a tenth sector existing. `inPerimeterBand()` says when a point is out
there. The floor painter fills the whole world with one flat exterior tile (`BAND_EXTERIOR`,
dirt) before painting sectors over it.

**The band is symmetric, so `WORLD_W/2` is still the middle of the sectors** and the keep has not
moved.

> **A check written in world coordinates measures the origin as much as the thing it checks.**
> `check-map-features.js` counted Spillway pipe segments by absolute x/y and reported 8.0 -> 1.75
> the moment the band landed. Nothing was wrong with the map. It reads `MAP_X0`/`MAP_Y0` now.

## Map — nine PAINTED sectors (2026-09-19)

> **BUILDINGS ARE HAND-DRAWN NOW (2026-09-26).** `zombie-stamps.js` + `zombie-stamps-data.js`
> hold stamps -- buildings drawn as text on the 20px cell -- and `placeStampAt()` puts them
> down ahead of `makeBuilding`, which survives only as the fallback. Drawn in
> `zombie/stamp-builder.html`, playtested with `Zombie.html?sandbox=1&solo=1#stamp=...`
> (`zombie-sandbox.js`). See `LEVEL_BUILDER_PLAN.md`, whose top block is the how-to.
>
> Measured over 24 seeds the day it landed: buildings a map **3.1 -> 16.3**, open-corner
> buildings **100% -> 0%**, furniture on a wall **29% -> 0%**, and the five sectors that got
> nothing on any seed (centre, cold, kennel, pump, turbine) all get buildings.
>
> **Three rules it had to learn, all of them ones this file already states in other words:**
> stamps are **snapped to the 20px lattice** (an 80px door 11px off the nav grid sealed a
> whole building to the flow field); `STAMP_CLEAR` is **90, not 40**, because a 40px gap is
> neither closed nor walkable and took nav reachability 0.0010% -> 0.3263%; and stamps measure
> clearance **from the openings themselves**, not `nearZoneBoundary`'s blanket 150px, which is
> the whole arm in a three-row sector -- the identical finding THE KENNELS made in 2026-09-20.
>
> **THE MAP IS BEING HAND-AUTHORED (2026-09-26).** `zombie-map-data.js` holds absolute
> `{stamp, x, y, rot, mirror}` placements, written by `Zombie.html?editor=1`, and
> `placeAuthoredBuildings()` puts them down **immediately after the keep and the sluice** — ahead
> of the funnel halls, the landmarks and everything seeded, because a building somebody placed is
> a decision the rest of the map should route around. Placed earlier than that it cannot be, and
> placed later two test placements were both reported blocked by a hall that had taken the ground.
>
> An authored placement ignores the clearance rules (`force`) and can only be stopped by
> overlapping something solid; when that happens it goes in `ZMAP.report.missing` **with the
> reason**, is warned about in the console, and draws red in the editor. `ZMAP.authoredOnly`
> turns the seeded building placer off entirely, for when the authored map IS the map.
>
> **Crates, barrels, wall-buys and perk stations are authored too (2026-09-26)**, as
> `ZMAP.props` — `{kind, x, y}`. Crates and barrels are placed outright by
> `placeAuthoredProps()`. A wall-buy or station spot says **where, not what**: `addWallBuy` and
> `placeCardStations` take the next unused authored spot **in that sector** and otherwise fall
> back to their own search, so a half-authored map still works and what a sector *sells* stays a
> balance decision (`SECTORS[].guns`, `PERK_SECTOR_HOMES`) rather than a placement one.
> **The editor labels each spot with what actually landed there** — "wallbuy: RIFLE 1500" — read
> off the built map after each regenerate rather than guessed, so the sector still decides and you
> can still see what you placed.
>
> **`ZMAP.cells` is the map's own geometry** (2026-09-26), one 20px cell at a time: `#` wall,
> `W` window, `.` floor, and the furniture letters. `placeAuthoredCells()` coalesces them into
> rects the same greedy way `ZS.rects` does — a hand-painted 40-cell wall must not become 40 rects,
> because every solid here is tested linearly by `clashesReserved` and swept by the nav rebuild.
> The editor can **explode** a placed stamp into cells, which is how a building stops being an
> instance of a stamp and joins the base map.
>
> **SECTOR SHAPES ARE EDITABLE (2026-09-26).** `ZMAP.paint` records `{c, r, z}` edits applied over
> `ZONE_PAINT` by `applyAuthoredPaint()` before anything reads it — so boundary walls, the door
> pairs and their prices, floors and every placement bound follow with no other code involved. It
> stores EDITS, not a re-dumped grid: a four-line diff is readable, 432 characters are not.
> `repaintRefusal()` enforces the rule that makes this safe — **a cell may only join a sector it
> already touches**, and a paint that would split a sector (`paintConnected`) or take its last cell
> is refused. Islands are impossible by construction rather than caught by
> `assertZoneConnectivity` at the end of generation, which is far too late to tell somebody
> painting. Verified by eating COLD STORAGE's one-row waist: the last connecting cell refuses with
> "it would split COLD STORAGE in two".
>
> `stampBlockedReason()` is the one predicate behind all of it — the level places with it, and the
> editor asks it under the cursor every frame to colour the ghost. An editor with its own idea of
> what fits is an editor that starts disagreeing with the game.
>
> **Two scripts to run when the map moves (2026-09-24):**
> `node scripts/measure-zombie-nav.js` is the unreachable-cell measurement this file has asked
> for since 2026-09-19 and that was rewritten from scratch every time; it is a script now.
>
> **Run `node scripts/check-map-features.js`** before and after any map change. It
> generates maps in Node through `scripts/zombie-headless.js` -- a vm harness that runs the page's
> own scripts, so the real generator is what gets measured -- and compares against recorded
> baselines. Several of those baselines are known-bad; it fails when the map gets *worse*. The
> pre-commit hook runs it warn-only.
>
> **Read `MAP_VISUAL_AUDIT.md` first (2026-09-21).** It is the first pass that *looked* at rendered
> maps, and several numbers below turned out to be targets rather than outputs; each one is marked
> where it stands. `LEVEL_BUILDER_PLAN.md` is the plan to replace random building placement with
> hand-authored stamps. The visual direction is under reconsideration (audit §4) and
> `AESTHETIC_GUIDE.md` §6.3 has not been changed.

4800×2700, with a panning camera showing a **960×540** window (tightened from 1600×900 on
2026-09-01; 2.78× less world on screen).

> ~~Split into nine 1600×900 zones on a 3×3 grid.~~ **Superseded 2026-09-19.** Nine identical
> rectangles with a template shuffled into each is why nowhere was worth remembering: you cannot
> learn a place whose shape, position *and* contents are all re-rolled, and the sniper zone being
> the only sector anyone could describe was the tell — it was the only one with a rule attached.
> Plan and the full design: `zombie/MAP_REVAMP_PLAN.md`. Steps 1–4 of its sequencing are built;
> step 5 (the container maze) is deliberately held.

### The paint grid

Sectors are **painted into a 24 × 18 grid of 200 × 150 cells** (`ZONE_PAINT`, 432 entries of a
sector id 0–8). That buys arbitrary rectilinear outlines while `zoneOf()` stays **one array read**,
which matters because it runs per zombie per frame.

> **It was 12 × 9 until 2026-09-20**, and that was the binding constraint on sector SHAPE — not
> taste and not effort. An H needs a bounding box of at least **5 × 5** (two spines, a gap, a
> crossbar) and its notches must open onto a real neighbour or they island a sector, which
> `assertZoneConnectivity` rejects. At 108 cells over nine sectors the average sector was twelve
> cells against the twenty-five a 5 × 5 needs, and **nine of nine bounding boxes failed** — the
> largest pairs were 4 × 7 and 3 × 8. No painter could have drawn an H on that grid.
>
> **The refinement is close to free, which is the part worth knowing.** `zoneBoundaryRuns()` merges
> collinear cells, so what costs a run is shape complexity, not cell count: a 2× upsample of the
> *old* shapes measures **exactly 39 runs**, identical to the old grid. The shapes actually shipped
> below cost **41**. Two runs bought every silhouette on the map.
>
> A second rule falls out of the map edges and never goes away: **a sector against the border can
> be a C, an E or a comb, but never an S or a Z**, because an S bulges both ways and one way is
> off-map. That rules THE SPILLWAY (west) and THE SLUICE YARD (south) out of S/Z at any resolution.

```
  0 SSSSSSCCCCCCCCKKKKYYYYYY     S spillway   C cold storage   K kennels
  1 SSSSSSCCCCCCCCKKKKYYYYYY     Y yard       B blockhouse     T turbine
  2 SSSSSSCCCCCCCCKKKKYYYYYY     P pump       L sluice         M motor
  3 SSSSSSSSCCCCKKKKKKYYYYYY     <- COLD STORAGE's waist: the H
  4 SSSSSSCCCCCCCCKKKKYYYYYY
  5 SSSSSSCCCCCCCCKKKKYYYYYY
  6 SSSSTTTTTTBBBBBBKKYYYYYY
  7 SSSSTTTTBBBBBBBBKKYYYYYY     <- the Kennels' tail severs YARD <-> BLOCKHOUSE
  8 SSSSTTTTBBBBBBBBPPPPYYYY
  9 SSSSTTTTBBBBBBBBPPPPPPYY
 10 SSSSTTTTTTBBBBBBPPPPPPYY
 11 SSSSSSTTTTTTBBBBPPPPPPYY
 12 SSSSSSLLLLLLLLMMMMMMMMYY
 13 SSSSSSLLLLLLLLMMMMMMMMYY
 14 LLLLLLLLLLLLLLMMMMMMMMMM
 15 LLLLLLLLLLLLLLMMMMMMMMMM
 16 LLLLLLLLLLLLLLMMMMMMMMMM
 17 LLLLLLLLLLLLLLMMMMMMMMMM
```

| Sector | Cells | Shape | ring |
|---|---|---|---|
| THE SPILLWAY | 76 | comb against the west edge — two bulges east, neither an S | 2 |
| COLD STORAGE | 44 | **a true H**, arms at rows 0–2 and 4–5, waist at row 3 | 1 |
| THE KENNELS | 30 | staircase with a tail down to row 7 | 1 |
| THE YARD | 62 | hook — a wide head north-east, a two-cell tail down the east edge | **2** |
| THE BLOCKHOUSE | 40 | arrow narrowing south toward the escape | 0 |
| TURBINE HALL | 30 | dog-leg | 1 |
| PUMP HOUSE | 22 | L | 1 |
| THE SLUICE YARD | 72 | tee along the south wall | 1 |
| THE MOTOR POOL | 56 | bracket with the rail spur through it | 1 |

**COLD STORAGE's waist is ONE row, not two, and that is a measured constraint rather than a
preference.** The first version used a two-row waist, giving 300px-deep arms — and every boundary
reserves **150px inward for its door**, so a two-row arm has *nothing* left once both long edges
are taken out. The 130px chiller could not be placed and the map shipped six landmarks instead of
seven. **A sector arm that has to hold a hero structure needs three rows.**

**THE YARD IS RING 2 NOW.** On the old paint it touched the Blockhouse at exactly one cell, so the
rocket was one 1,250 door from spawn; the Kennels' tail at rows 6–7 severs that. Cost to own the
rocket goes **8,750 → 10,350**. It is still the sector worth the trip — it is no longer the whole
game for one door.

**`zoneBounds(i)` is a BOUNDING BOX, not the sector.** Unchanged and still the trap: anything that
picks a point in the bounds must then call `inZone(x, y, i)`.

**Three things do NOT follow the grid constants** and had to move by hand when it changed:
`HALL_MIN_CELLS` (9 → **36**, since a cell is a quarter of the area it was), the rail spur's cell
literals, and `randomPointInZone`'s pad (checked, still fits: 200 − 80 and 150 − 80 are positive).
`zoneGridDist` divides by `ZONE_CELL_W` but only ever *orders* spawn candidates and never compares
against a threshold, so a uniform scale change is harmless — both call sites checked.

### Fixed skeleton, seeded interior

`SECTORS` replaces `ZONE_TEMPLATES`. Shape, position, name, landmark, floor treatment and **which
gun and how many perk stations** are fixed; buildings, cover, crates, barrels, container stacks,
where inside a sector its structures stand and every door and window position along a shared wall
are still seeded from `MP.random()`. Every client still builds from one seed.

**Stock varies by sector** (`SECTORS[].guns` / `.perks`), which is the point — two sectors are
worth a trip and three are deliberately bare. Totals are unchanged at 6 guns and 8 stations, so no
balance number moved, only where they sit:

| Sector | Guns | Stations |
|---|---|---|
| THE YARD | 1 — ROCKET | 2 |
| THE MOTOR POOL | 0 | **2** |
| COLD STORAGE / THE KENNELS / THE SPILLWAY | 1 each — RIFLE / SHOTGUN / SNIPER | 1 each |
| PUMP HOUSE | 1 — FLAMETHROWER | **1** |
| TURBINE HALL | 0 | 1 — OVERDRIVE, always |
| **THE SLUICE YARD** | **1 — SMG** | 0 |
| THE BLOCKHOUSE | 0 | 0 |

> **Two moves on 2026-09-20, both from measured asymmetry** (`MAP_DESIGN_GUIDE.md` C1/C4/C5).
> Over *exactly* the same 35 cells, the east half of the map (Yard + Pump House + Motor Pool) held
> **three guns and four perks** and the west/south half (Spillway + Sluice Yard) held **one and
> one**. Nothing in the fiction explained it and nothing in the pacing needed it.
>
> - **THE SMG moved to THE SLUICE YARD.** East/west guns go 3:1 -> 2:2, and the sector that was
>   15.7% of the map with nothing in it until the last sixty seconds now has a reason to exist --
>   you learn the escape ground before the run that depends on it.
> - **PUMP HOUSE gained a station**, the only sector selling a gun and carrying none. Totals are
>   **6 guns and 9 stations** (was 8). `CARD_ALWAYS` is untouched. `PERK_SECTOR_HOMES` gained
>   `pump: ["blastcap", "spite"]` -- fire and blast, beside the flamethrower it sells.

### Building density is PER CELL (`bpc`), not a flat count

The comment in `SECTORS` used to describe a `density` field that scaled buildings by sector size.
**No such field ever existed** -- `buildZoneContents` read a flat `buildings` count -- so the same
number landed in a 5-cell sector and an 18-cell one, and density ranged over **7.6x** without
anyone choosing it. `sectorBuildingCount()` derives the count from `bpc * zoneCellCount()`.

COLD STORAGE stays a warren on purpose (0.275/cell); **THE SPILLWAY roughly doubles** from what was
the emptiest ground in the game. THE YARD and THE KENNELS stay deliberately low -- their real
buildings are the container stacks and the rolling stock, placed separately, and raising this
crowds them out (measured once at 1.5 containers placed of 14 attempted).

> **Superseded 2026-09-21 -- the "warren" was a target, not an output.** A 40-seed sweep
> (`MAP_VISUAL_AUDIT.md` §1.2) found **COLD STORAGE gets 0 buildings a map against a target of 12**,
> and the whole map **5.3 against 49**. Placement `continue`s on any clash, so a sector whose
> ground is taken by landmarks, halls and reserves simply gets nothing, and nothing reports it.
> `bpc` sets how many are *attempted*. Re-measure before quoting any density here.

### The rail spur -- KENNELS -> THE YARD -> THE MOTOR POOL (2026-09-20)

This fixes a contradiction rather than adding decoration. The Kennels' rail cars and the Motor
Pool's flatcars were given **shared artwork** on 2026-09-20 so the spur "visibly runs between
them" -- and **on the old paint the two sectors were not adjacent.** The art implied one rail line
across a gap it never crossed.

On the new paint THE YARD sits between them, which is the right answer and not a workaround: a
gantry crane exists to move containers between a rail head and a stack, so the Yard is the natural
middle of the line. One continuous L -- east out of the Kennels' neck, across the Yard under the
crane, then south down the Yard's tail into the Motor Pool.

**Where it crosses a boundary wall it is a BOARDED RAIL GATE, not a hole.** A plain gap would have
handed players a free route between three sectors and quietly deleted two door purchases -- the
whole "buy outward" economy. A barricade is the idiom the map already has for this ("zombies pass,
players never do"), needs no new notion of solidity, and a rail gate boarded over is what it looks
like anyway. `carveOpening()` splits the walls; the cut pieces become barricades at 140 HP.

**Three ordering bugs, all the same shape, and worth knowing because the next feature will hit
them too:**

1. **The lane reserved itself.** `railLeg` reserved the track before `railStock` ran, and every
   piece of rolling stock sits on the track by definition -- so it clashed with its own reservation
   and **zero** pieces were placed. Stock first, `railReserve` second.
2. **`buildKennels()` reset `railcars = []`**, and the spur is built before it now, so it deleted
   every piece the spur had just placed. `generateLevel()` already clears the array.
3. **Both legs sat inside a 150px boundary door reserve** -- leg A straddled rows 6-7 and the
   Kennels/Pump boundary reserves y 1050-1200; leg B was centred in the Yard's two-cell tail and
   landed **one pixel** inside the Yard/Pump reserve. Both silently dropped their stock. The legs
   sit in the band that is actually free.

Measured over 120 seeds: **2-8 pieces of rolling stock a map** (mode 6), present in all three
sectors -- Kennels 1.1, Yard 3.6, Motor Pool 0.7 per map. The *track* always runs the full line;
the stock is what varies.

**The track is DRAWN now, not tiled (2026-09-21).** It used to be baked into the `ballast` floor
tile as stripes every 16px, and a tile repeats on the **world grid**, not along the track. So leg
A read as sleepers, leg B as stripes running the wrong way, neither had rails, and the corner was
two rectangles meeting. Now:

- `ballast` is **plain gravel** (`zombie-floors.js`). It is only the bed.
- **`railPaths`** (`zombie-level.js`) is a list of `{ pts, w, r }`: a centreline polyline, a bed
  width, and a fillet radius for every interior vertex. The spur is one path with a **90px curve**
  at the corner. It is pure geometry derived from rects already placed, **no `MP.random()`**, so
  adding it moved nothing on any seed.
- **`drawRailTracks(inView)`** (`zombie-render.js`), drawn after the floors and before furniture,
  lays sleepers across the direction of travel and two rails along it, including through the
  curve. Each path is rendered once into an offscreen canvas at 2 world units per texel and
  blitted with smoothing off, so the curve is stepped pixels. It is cached by `railPaths` array
  identity, so a reseed rebuilds it. **44ms once per level** (146ms before a rect prefilter).
- The bed keeps the lanes' **square** outer corner; only the track curves. A curved bed over the
  square ballast patch left a seam between two gravels.
- **THE KENNELS' run is no longer painted as track.** It was ballast across the sector's bounding
  box and ran under a boundary wall on 40 maps of 40. It is still a reserved lane. Each Kennels
  railcar gets a **siding** instead (`kennelSiding`: the car's length + 28px at each end, 80px
  bed, in the car's own orientation).

### THE KENNELS is a tight-quarters sector (2026-09-20)

Asked for after a playtest: the shotgun sector was *"not reading as a tight-quarters sector"*.
It carried about **2.8 pieces of stock a map at ~3% solid coverage**; it now carries **8.1
(6-13) at 8.7%**. Five things were in the way, and only one of them was the piece count.

**1. Reservations covered nearly twice the sector.** 54% of candidate positions passed `inZone`
and then `clashesReserved` rejected **97% of those** -- 1598 down to 54, leaving **1.5% of the
sector placeable**. Reserved rects touching the Kennels totalled 1,731,152 px2 against a sector
area of 900,000. Almost all of it was the **150px inward reserve around every boundary opening**.

So `reserveAround` takes a **`soft`** flag and `clashesReservedHard()` skips them. A building must
not sit on a doorway; a railcar 82px from one is the claustrophobia the sector is supposed to have.
The Kennels honours hard reserves and takes its own `KENNEL_DOOR_CLEAR` (82, comfortably over the
78px nav guarantee) from the openings themselves. The rail spur's reservation is soft for the same
reason -- it crosses a quarter of this sector, and stock beside the running line is the picture --
with `spurLanes` keeping stock off the track itself.

**2. The pieces were too thin to read as walls.** A railcar is 56px across, and at a 90px lane the
count is near the packing limit, so density could not come from more of them. A 56px sliver reads
as an obstacle you walk around; `KENNEL_CONTAINER_DEEP` (96) reads as a block, and the gap between
two blocks reads as a hallway. Railcars stay narrow, because a railcar is narrow -- the mix is
the point.

**3. Separation is ANISOTROPIC, and this is the one that changed the feel.** A uniform lane in both
axes produces a **scatter**: every piece islanded, and the eye reads "things placed about". Pieces
may now sit end to end along their length (`KENNEL_END_GAP`), which lines them into runs that read
as walls, and must keep the full `KENNEL_LANE` across it, which is the hallway between runs. Same
geometry budget, completely different sector. The container maze feels claustrophobic with seven
pieces for exactly this reason: it is a baffle, not a scatter.

**4. `KENNEL_END_GAP` is 0, and 22 was the wrong kind of number.** A GAP MUST BE EITHER CLOSED OR
WALKABLE, NEVER IN BETWEEN. At 22 the pieces did not join, but the slot between them was far under
the nav guarantee, so it held passable cells the flow field could never reach: map-wide nav
reachability went **0.0055% -> 0.0531%, and 298 of the 321 unreachable cells were in this sector**.
The static clearance in `placeKennelPiece` dropped 10 -> 2 for the same reason.

**5. `KENNEL_ELBOW` (70) stops a piece SEALING a passage.** Closing the end gaps did not fix the
pockets, because they were not between pieces: THE KENNELS has a **one-cell-tall western arm at
row 3**, and a cell is 150px, so a single container laid across it closes the arm completely.
Clustering the unreachable cells on seed 22352 gave **one blob of 44 at x 2440-2820, y 480-540** --
exactly that arm. Requiring sector ground all round means a piece can only go where the sector is
more than one piece deep, so it can narrow a route and never close one.

**70 is not negotiable down to 50.** Tried: 50 still protects the row-3 arm on paper (a 96-deep
piece needs the arm to be 196px and it is 150) and nav went straight back to **0.0617%**, because
vertical pieces and other narrow spots need the extra 20px. It costs about three pieces a map and
it buys the sector's connectivity.

THE KENNELS also grew **30 -> 34 cells**, taking four from THE YARD at rows 4-5. The Yard is 58
and still the largest sector; its container maze was re-measured at **7.2 pieces a map, unchanged**.
> **Superseded 2026-09-21:** the 40-seed audit counted **3.35 containers a map in THE YARD**, not
> 7.2 (`MAP_VISUAL_AUDIT.md` §1.2). Where the 7.2 came from is not known. Treat it as unverified.

Final, 25 seeds with doors open and barricades broken: **nav reachability 0.0036% (22 cells), which
is better than the 0.0055% before this work**. Generation is 39ms a map.

### Thresholds -- the fourth floor treatment (2026-09-20)

Beside interior / exterior / unique: **a worn patch across every door and window.** It is the one
place on the map where two sectors' floors meet, and until now they simply abutted -- a hard seam
between two tiles with nothing to explain it. The `threshold` tile is deliberately near-neutral and
dark so it reads as wear on whichever two floors it joins, not as a third colour between them.

`paintThresholds()` runs in **one pass at the end of `generateLevel`**, because that is the only
point at which every opening exists -- boundary doors, the keep's two barricades, the sluice, the
rail gates and the funnel halls are created by six different functions. ~63 patches a map.

### Walls are keyed per sector (2026-09-20)

There were nine floor treatments and **one** wall. The wall is the surface you actually look at: a
top-down game with a 340px light pocket spends most of its time showing you a corridor, not a
floor, so the place sector identity was most visible carried none of it. `ZONE_WALL` gives each
sector a body and a cap drawn from its own floor's hue family.

**Sampled at the wall's CENTRE, not its corner.** A boundary wall is centred on the line between
two sectors, so its own top-left can sit in either one -- sampling `x, y` made a single run flicker
between two palettes along its length. Cost is one `zoneOf()` per wall per frame, a single array
read.

### Landmark sightlines (2026-09-20)

The height ladder already worked -- crane 16, silo 14, standpipe 13, down to the bus at 5 -- but
nothing guaranteed a landmark could be seen from anywhere useful. The map had a skyline and no
sightlines. `addLandmark` now **prefers** a spot with clear line of sight from one of the sector's
own doorways, and keeps the old "any spot that fits" as the floor, because *a sector without its
landmark beats a landmark standing on the endgame* and that rule has already cost one bug.

**Two things had to be right before the measurement meant anything**, and both were wrong first:

- **The eye is a stride INSIDE the sector (`EYE_STEP_IN` = 130), not the middle of the doorway.**
  The doorway's centre lies in the plane of the boundary wall, so every line that is not near
  perpendicular clips the wall the door is set in, and the test degenerates into "is the landmark
  straight ahead". That reported 13.6%, and reserving the line moved it by 0.3 points -- because
  the occluder was the doorway itself, not anything placed later.
- **The landmark blocked its own sightline.** The line is cast to the body's centre, so once the
  landmark is solid its last samples are inside it. This does not show up at placement time (it is
  not a wall yet) and showed up as **"crane 98%, everything else 0%"** over finished maps -- the
  crane being the one landmark with no collision. `clearSightStatic` takes the body to skip.

Sightlines are also **held open**: four 70px waypoints along the chosen line, because landmarks are
placed early by design and the buildings, containers and rolling stock do not exist yet when the
line is picked. A continuous corridor would be tens of rects per landmark and `clashesReserved` is
linear.

Measured over 100 seeds: **100% of landmarks, all seven kinds, visible from one of their sector's
doorways on a fully built map.**

### Boundaries, doors and pricing

`zoneBoundaryRuns()` scans the paint for cells whose neighbour has a different id and merges them
into **runs** — 42 of them over 17 sector pairs, every one axis-aligned and a whole number of
cells long, which is what keeps both solid grids and the door/window art unchanged.

**One door + window pair per sector PAIR, on the longest wall they share.** Per segment would have
been 42 doors. One pair (THE BLOCKHOUSE | THE YARD) shares only a 300px wall, under the
`BOUNDARY_BOTH_MIN` of 320, so it gets a **window and no door** — already a legal state ("zombies
pass, players never do"), and the keep having one boarded window onto the yard is a better answer
than widening a wall to suit the code.

**Door pricing is graph depth, not ring distance.** `computeZoneDepth()` BFSes from the Blockhouse
over door edges and `priceDoors()` charges `900 + 350 × depth` in a second pass — the cost is not
known until every door exists. Ring distance in a 3×3 was approximating exactly this and means
nothing once sectors interlock and the centre borders five of them.

`zoneNavRebuild()` builds a 9×9 **next-hop table** for `zoneStepToward`, which used to be grid
arithmetic. `assertZoneConnectivity()` runs at the end of `generateLevel` and checks every sector
is reachable **by door** (players) and **at all** (zombies) — the check that would have caught the
2026-09-18 walled-off gate plate.

### The perimeter (2026-09-19)

There used to be **no perimeter at all**. Now two edge conditions:

- **North and west: deep forest.** A `FOREST_BAND` (240px) of scattered trunks **inside the map**,
  no wall. Being inside is the point — it is a spawn **reservoir** with real cover rather than
  "somewhere past the edge", and `z.entered` has less to do.
- **South and east: a concrete wall**, with the escape gate set into the southern one. The heavy
  gate and chainlink built on 2026-09-19 were standing in a wall that did not exist.

**Culverts** (`PERIM_CULVERT`, 120px — well over the 78px guarantee) are mouths through the hard
wall, ~7 a map, and they are not decoration: **walling two sides removes half the spawn
frontier.** Measured from a camp at every sector's centroid, worst case **1,223px now against
1,343px** under the old nearest-map-edge rule — better, not worse. Without culverts THE MOTOR POOL
measured **+1,790px**, which is the failure this was built to avoid, and is the same trap the zone
cooldown already hit once (a permanent "visited" flag doubled contact time to 25.6s).

`offMapPoint()` picks whichever is nearer: a point in the forest band, or just outside the nearest
culvert mouth.

### Landmarks (2026-09-19)

One hero structure per sector — the gantry crane (THE YARD), the wrecked bus (MOTOR POOL), the
turbine drum, the pump bank, the chiller, the feed silo, the standpipe. THE BLOCKHOUSE's is the
keep and THE SLUICE YARD's is the south wall; both already exist.

**The height illusion is two flat fills**, applied identically to every one, and both are flat —
no gradients, which is how 1980 raster games faked height:

- a **cast shadow** offset down-right, one constant `rgba`
- a **top face** offset up-left by `lift`, which *encodes* height: 16 on the crane against 5 on the bus

Drawn **after the walls and culled to the VIEW, not the sector**, so the crane shows over a
boundary wall from two sectors away. That is the entire point of a landmark. Each also gets a
**minimap glyph** — shapes, not letters, because a letter at 6px is a smudge.

**Two traps, both hit:** `findOpenSpotSure` relaxes the reserved-ground rule on its later passes
(right for a wall-buy, which must exist somewhere; wrong for a 420px solid — it put the crane on a
silo), and every spot finder takes a **square** `size`, so the crane was being fitted as 420×420
and missed 39 maps in 40. Landmarks use `hallFits()` now, which tests the real rect, and they are
placed **after the funnel halls and before the generic buildings** so they get first pick.

### Sector interiors and the three floor layers

`buildSectorInteriors()` gives four sectors their signature geometry: THE SPILLWAY's three 160px
storm runs, THE KENNELS' pens opening onto the one lane you can run down, THE MOTOR POOL's
three-walled service bays (deliberately the opposite — one way out), and THE YARD's rail spur with
flatcars and container stacks. `INTERIOR_LANE` is 160 everywhere you are meant to fight.

> **Superseded 2026-09-21 -- this described the design, not the map.** Measured over 40 seeds
> (`MAP_VISUAL_AUDIT.md` §1.2-1.3): **2.5 of 16 Spillway pipe segments** and **0.6 of ~6 Motor
> Pool bays** got built. Buildings were placed in `buildZoneContents()` *before* the pipes, so the
> pipes lost, and the drain floor was painted under the buildings that took their ground.
>
> **Fixed 2026-09-24.** `buildSectorInteriors()` now runs BEFORE `buildZoneContents()`, beside
> the rail spur, the maze and the Kennels -- a sector's signature geometry outranks a generic
> building. `segmentedWall()` returns which segments it laid, and the invert floor is painted,
> and the ground reserved, **only where a pipe actually stands**. Pipe segments **2.5 -> 8.1** a
> map, bays **0.38 -> 1.29**, buildings on a drain **2.08 -> 0**.
>
> **The cost, and it is deliberate: buildings a map fell 5.0 -> 3.1**, and THE SPILLWAY and THE
> MOTOR POOL now get no generic building at all -- their own geometry holds that ground. Nav
> reachability was re-measured (the rule below) and is **0.0010%, better than the 0.0036%** it
> replaced. The pens were replaced by rolling stock on 2026-09-20 (below). The pipe centre line
> is still a tile artifact repeating every 128px, unrelated to where any pipe is.

**`segmentedWall()` leaves deliberate gaps** and it is not cosmetic: an unbroken 1,380px pipe wall
turns each run into a tube reachable only from its ends, and a reserved rect across an end sealed
it — **579 unreachable nav cells in THE SPILLWAY alone**. Forest trunks reserve their own
clearance for the same reason (clumped trunks against a boundary make a pocket). Both are the same
failure the boundary-spur clipping rule already exists to prevent: a free safe spot for a player
and a trap for any zombie that wanders in.

**Floors are three layers now** (`zombie-floors.js`), asked for as "limit drawing of floor tiles to
interior spaces":

| Layer | What | Where |
|---|---|---|
| EXTERIOR | dirt, gravel, asphalt, concrete, wet concrete — flat, low contrast | the whole sector, per cell |
| INTERIOR | the existing per-sector tiles | **only inside a room footprint** |
| UNIQUE | rail ballast, pipe invert, hardstanding | only under the structure that owns it |

(2026-09-21: ballast is plain gravel now. The track is drawn over it by `drawRailTracks`; see the
rail spur section.)

`zfPatch()` pushes a patch, `zfInteriorAt()` returns a sector's interior tile, `zfClearPatches()`
runs on regenerate. One tile used to be washed across a sector's **whole rect**, which is why the
areas still read faintly after the 2026-09-18 floor pass — and why a wall was the only thing
telling you that you were indoors.

### The container maze (2026-09-19, sequence step 5)

A shipping container maze in THE YARD. **Containers, not hedges** -- the user's call, and the
better one: a hedge that blocks sight but not movement would need a **fourth** notion of solidity
(there are two solid grids, and bullets gained a third *view* with `bulletBlockedAt`), whereas
containers are sight-blocking by being solid, are rectilinear so they cost the flow field nothing
walls do not already cost, and THE YARD was already stacking them.

**Braided, not perfect, and that is the design.** A perfect maze -- one route between any two
points -- is exactly the geometry the flow field is worst at: dead ends that zombies path into and
stall in, with `relocateZombie` papering over it. So it is a **staggered baffle**: every horizontal
lane runs the full width, vertical movement happens through the gaps, and consecutive rows are
offset so no two gaps line up. You can always run, you can never see far, and there are no dead
ends by construction -- which is also what a container yard is.

`MAZE_LANE` is **140**, not the 160 the plan asked for. 160 was the right instinct, but at a 220
pitch THE YARD's usable rectangle held only a 4x6 grid and, after the boundary reserves and the
sector's ragged west edge, produced **four containers a map**. 140 still clears the 78px guarantee
by 62 and is four times the widest body.

**Two layout decisions fell out of it, and both are load-bearing:**

- **THE YARD owns (col 9, row 2)**, taken from THE KENNELS, so cols 9-11 x rows 0-3 is an unbroken
  1200x1200 block. Spread across the hourglass the maze was five boxes over 1,000x1,500, with 37%
  of attempts failing `inZone`.
- **Funnel halls no longer go in THE YARD.** A hall reserves 780x500 -- half the maze -- on the two
  thirds of maps that put one there. A sector with a job does not get a second one. That left two
  eligible sectors for two halls, so `HALL_MIN_CELLS` dropped 10 -> 9 to make COLD STORAGE a third
  option; `finishFunnelsAndSilos` can still fall back to THE YARD if a hall genuinely cannot go
  anywhere else.

**Three bugs, not tuning, stood between four containers and a yard**, and two are the same shape as
bugs found elsewhere this week:

1. A single-slot container is exactly `pitch - lane` wide. When the pitch was retuned from 220/60
   to 190/50, the old `w >= 60` guard silently threw away **every** single-slot container and only
   two-slot runs were ever attempted. It reads `w >= MAZE_DEPTH` now.
2. `placeContainer` used `blockedAtStatic`, which takes a **square** `size`, so a 440px container
   was tested as 468x468 -- the identical trap the gantry crane hit. It uses `rectBlockedStatic`.
3. The crane reserved its whole 420x150 span, taking a third of the maze's ground. **A gantry crane
   spans a container yard**; it reserves only its legs now, and containers belong under its beam.

**The test a maze actually needs** is not "is the map connected" but "with a player standing
**inside** it, can a zombie starting anywhere still reach them" -- a maze that fails that is a free
safe spot. Over 30 seeds, doors open and barricades broken: **15 passable nav cells of 733,192
(0.002%) cannot reach a player in the container field.**

> The first version of that test reported **13.4%** and was wrong. It seeded the flow field at the
> **centroid of the containers**, which is usually *inside* one of them, and a field seeded on an
> impassable cell is degenerate. If you re-run it, seed from the nearest cell `navPassable` agrees
> with. A measurement that says the map is broken is worth doubting once before believing it.

Drawn with the same two flat fills as the landmarks at a small lift, plus corrugation ribs and end
frames. **This is the one place on the map where the palette is allowed to be loud** -- five
container hues against a world of ember and grey (`AESTHETIC_GUIDE.md` 2.5) -- because a container
yard that is not a jumble of colours does not read as one, and it is what makes THE YARD
recognisable from across the map.

### Measured (2026-09-20, after the twelve map proposals)

Re-measured rather than assumed -- the grid, the stock, the density and the palette all moved.

| | |
|---|---|
| guns / stations / doors / landmarks | **6 / 9 / 19 / 7 on every seed** (120 seeds) |
| anything in the wrong sector | **0** |
| generation failures | **0** |
| landmarks visible from a doorway | **100%**, all 7 kinds (100 seeds) |
| rolling stock a map | 2-8, mode 6, across all three spur sectors |
| threshold patches a map | ~63 |
| floor tint, min dE between adjacent sectors | **22.7** (was 5.5) |
| nav reachability, doors open + barricades broken | **22 cells = 0.0036%** (25 seeds) |
| THE KENNELS stock | **8.1 a map (6-13), 8.7% solid coverage** -- was 2.8 at ~3% |

**Nav reachability is slightly worse than the 0.002% of 2026-09-19 and that is expected**, not a
regression to chase: the rail gates, the reserved sightlines and a higher `bpc` in two sectors all
add geometry. It is ~1.4 cells a map, and 31 of the 34 are on a single seed as scattered 2-3 cell
nooks inside the container maze -- which is what `relocateZombie` exists for. **Re-run the A/B with
each layer disabled if this geometry is touched again**; that is what found the pipe-run and forest
pockets (579 and 488 cells).

### Measured (2026-09-19)

200 seeds unless stated. 6 wall-buys, 8 stations and 17 doors on every map; every gun and perk in
its named sector **100%** of the time; **nothing in the wrong sector**; every sector reachable by
door and by window on every map; all 7 landmarks on every map; 7.2 containers a map in THE YARD
(4 to 11); all hall ends exactly 140px.
> **2026-09-21:** the 40-seed audit measured **3.35** Yard containers, not 7.2. See above.

**Funnel halls: about 97% of maps get both** (144/150 after the maze landed). The rest fall back to
a bare funnel ring with its silo alongside, which is the pre-existing behaviour and is **an
accepted outcome, not a known gap** -- confirmed by the user 2026-09-19: *"sometimes bare funnel
ring is ok"*. Do not spend effort chasing it to zero; the chain is completable either way.

**Nav reachability**, doors open and barricades broken, field from the keep: **15 unreachable
cells of 611,136 (0.002%)** — about five 20px cells a map, which `relocateZombie` already covers.
An A/B with each layer disabled is what found the pipe-run and forest pockets (579 and 488 cells)
before they were fixed; run it again if this geometry is touched.

### The old grid, for reference

You start sealed in the centre sector and buy outward. **Every sector pair carries both a door
and a boarded window**, and that pairing is the whole design:

You start sealed in the centre zone and buy outward. **Every zone boundary carries both a door
and a boarded window**, and that pairing is the whole design:

| | Players | Zombies |
|---|---|---|
| Closed door | blocked (buy to open) | blocked |
| Boarded window | blocked, always | break through it |
| Breached window | **still blocked** | free passage |

That asymmetry is why segmentation is safe: there is no zone the horde cannot follow you into, so
"start small" can never become "hide in a box". It is enforced by **two separate collision
grids** — `solidGridPlayer` counts every barricade, `solidGridZombie` only intact ones.

**Bullets get a third view (2026-09-19): `bulletBlockedAt()`.** The zombie set minus the plank
slots a barricade has *already lost* — so you can shoot into the gap a zombie is chewing while the
window is still standing, which is what was asked for ("shoot them as they're breaking through and
keep barricade in tact"). Before this a window was total cover until `hp <= 0`, so the only way to
shoot through one was to lose it entirely.

The renderer already told exactly this story, so there is now **one copy of the arithmetic** and
both read it:

    BARRICADE_PLANKS = 4
    barricadePlanksShown(b)     // 0 at hp<=0, else max(1, ceil(4 * hp/maxHp))
    inBarricadeGap(b, x, y, sz) // the box lies WHOLLY past shown * (span/4)

Planks fill from the low end of the span upward, so the missing ones are always the far end. The
box must be *wholly* past the last board, not merely overlapping it: a round clipping the last
plank is stopped, which at a 112px window (28px a slot) against a bullet of 8–14 is the difference
between a clean shot through the gap and a lucky one. A gap needs `frac <= 0.75`, so a quarter of
the window has to be chewed before anything gets through, and it widens 28 → 56 → 84 → 112px.

**Player collision, zombie collision and both nav grids are untouched** — a gap you can shoot
through is not a gap anyone can walk through. All four bullet tests use it, **the two RICOCHET
axis probes included**, or a round bounces off a hole it should have flown through. No new wire
field: host and guest compute the gap from the same `hp`, which already ships as `bc`.

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
  decoration — without them you cannot find anyone. *(2026-09-18: the minimap now starts hidden, on
  request, behind `M`. The off-screen teammate arrows are unchanged and always on, so teammates stay
  findable.)*

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
3. **Off-field recovery needs line-of-sight.** *(It had silently regressed by 2026-10-10 and is restored: see "Fifth playtest", item 2.)* A zombie pressed flat against a wall sits in a cell
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

### Measured again (2026-09-18) — the ULTRA HEAVY, and NAV_PAD 19

Same method, re-implemented as a Node harness that runs the real scripts headless (the method was
recorded, the harness was not): 24 layouts × 24 runs per type, doors open, barricades broken, one
zombie vs a stationary player ≥ 1000px away, 120s cap. "Before" is the pre-pass code:

| | walker | runner | screamer | splitter | brute | ultra (34) |
|---|---|---|---|---|---|---|
| before, reached | 100% | 100% | 100% | 100% | 100% | — |
| after, reached | 100% | 100% | 100% | 100% | 100% | **100%** |
| after, without the escape hatch | 100% | 100% | 100% | 100% | 100% | 99.7% (2 relocations / 576) |

0 despawns and 0 timeouts in either run. (A 60s cap timed out 12 screamers on the old code; they
are simply the slowest type — at 120s every one arrives.)

## Controls — ONE player per screen

WASD moves, the mouse aims, left click fires. `F` uses/buys, `Q` or middle-click pings.

> **Holding a direction into the field manual no longer keeps you walking** (fixed 2026-09-19).
> `openCodex()` never released held keys — `openHelp()` always did — and `keyup` returns early
> while the manual is up, so the release of the key you were holding when you pressed `F` was
> never seen; nothing gates `updatePlayers` on `codexOpen`, so you walked for as long as you read.
> `closeCodex()` already cleared the keys, which is exactly why it stopped the instant you shut
> the manual and read as "it moves *while* the manual is up".
>
> `F` at the keep's south wall also throws the **horde switch** — see "The horde switch" below.
**`L`+`G` together opens the dev panel** (2026-09-07, `zombie-dev.js` + `shared/devtools.js`) —
neither key is bound to anything else here.

*2026-09-18:* **`1`–`7` / the wheel switch guns**, **`M` shows/hides the minimap together with the
TIME ALIVE / ZOMBIES / KILLS lines**, and **`N` mutes** (it was `M`). Number keys never spawn you —
they are not join keys. **The minimap starts hidden** (asked for mid-playtest) on every page load;
the choice then holds across restarts in the session. It was briefly remembered in
`localStorage`, which would have kept it on for anyone who had ever pressed `M`, so it deliberately
is not persisted any more.

**`ESC` opens the MISSION dialog** (`#help`, `openHelp()`), which is where the start prompt's
instructions went — the start prompt is now just "join" and "ESC — how to play & goals". It shows
the map's **goals as a checklist ticked from live state** (`mapGoals()`: generator, sluice, silos
1–3, flood, south gate — ticked cyan, the current one amber, the rest dimmed; checkboxes are CSS,
no glyphs), plus controls and rules. A goal is done *by state*, not by order: a Blackout un-ticks
the generator and puts "restart" back on top while the sluice stays ticked. Everything it reads
rides the world snapshot, so a guest ticks the same boxes as the host. Like the field manual it
takes the keyboard and mouse while open and **does not pause**. With the dev panel up, the panel eats
`ESC` itself. While the minimap is up, the **NEXT goal** (the first unticked one, with its zone and
live progress) is drawn on its top edge (`drawNextGoal`).

The gun and its rounds moved from the top-left stack to a **loadout HUD, bottom left**: the gun's
pixel icon, its name, a 48px round count (magenta when low), and a strip of every gun you own with
its number key; your perks sit beside it as icons with an `xN` stack badge. The HUD rewrites only
what changed — the old perk chips were rebuilt with `innerHTML` 60 times a second.

Dev panel additions: `TRIP GENERATOR`, `SPAWN ULTRA`, `GIVE ALL GUNS`, `NEXT PERK` (cycles all
11, adding a stack), `CLEAR PERKS`; the readout shows owned guns, perks, which perks the map sells
and which it does not, and ULTRAs alive/owed.

Then, asked for mid-playtest: **`FREE BUYS`** (every purchase costs nothing; prompts get a
`[DEV: FREE]` tag), **`NO ZOMBIES`** (clears the field; nothing spawns, so a round just holds) and
**`SPAWN TARGETS`** (8 stationary dummies in an arc where you aim — it goes around the NO ZOMBIES
block, so there is still something to shoot). Both toggles are host-gated. **They wrap, rather than
hook:** `zombie-dev.js` reassigns `hostHandleBuy`, `spawnZombie`, `spawnZombieAt` and
`nearestPrompt` at load (free buys lend `hostHandleBuy` an unreachable `scrapPool` and put the real
one back), so the gameplay files carry no dev flag and deleting the dev file's script tag still
removes all of it. That only works because every caller reaches those functions through the global
binding — if one is ever captured into a local, the toggle silently stops covering that path.

### The dev panel does NOT pause this game

Deliberate, and the same call the field manual already makes for itself ("The round does not pause
while you read this"). The host simulates for the whole room; pausing it locally would freeze
everybody else. `onOpen` only releases the local player's held keys, so nobody walks into a wall
behind the overlay.

**Round state, `zombies` and `scrapPool` are host-authoritative, so those buttons are host-gated**
and say so — a guest writing to them locally gets one frame of a lie before the next broadcast
overwrites it. `OPEN SLUICE` is the one worth knowing about: the two-plate gate is the only
mechanic in the game that is *strictly impossible alone*, so without that button a solo playtester
can never see anything past it. *(2026-10-03: the plates became levers on 2026-09-26 and solo can
throw them, so this is now a convenience rather than the only way past.)*

**`NEXT CHAIN STEP`** (2026-10-03, `zDevAdvanceChain`) completes whichever link of the chain is
current, in `mapGoals()` order: generator → sluice → each tank filled, then its switch thrown →
each fuel car coupled → each rail crossing opened → locomotive started → tunnel open. Fifteen
presses take a fresh map to the run's final seconds (verified headless, seed 22352). Wherever a
real trigger function exists it goes through it (`flipSilo`, `trainCouple`, `trainHostStart`).
The train steps are `typeof`-guarded so the button survives `zombie-train.js` being removed. With no
train, the last step starts the flood.

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
lights never restore full daylight — and a Blackout round adds **+0.26** (+0.20 until 2026-09-18)
on top of whichever applies, after tripping a running generator. The player's light radius
therefore matters at all times, not only on Blackout rounds. A player waiting out a bleed-out sees
by the light of the teammate the camera is following.

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

**No balance number moved** *(in that pass — the Blackout dip went +0.20 → +0.26 on request on
2026-09-18; everything else here still holds)*. 0.72 / 0.22 / +0.20, `LIGHT_RADIUS` 340,
`LIGHT_FADE` 1.33 and the downed player's ×0.55 are all untouched — §5 lists this game's lighting as untouchable because
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
- ~~**Flicker budget (§4.7)**: past `ZOMBIE_DRAW_CAP` (40) zombies *on screen*, the overflow renders
  on alternating frames. Measured with a synthetic 100-zombie horde: 40 drawn every frame, the
  other 60 split 30/30 across two frames — 70 draws per frame instead of 100. Counted against
  zombies actually **on screen**, not the array index, or the budget would depend on where the
  camera is pointing. **Screamers are exempt** — the white outline is how you find the callout
  target in a crowd, and one that renders every other frame is a gameplay regression wearing an
  aesthetic hat.~~ **Removed 2026-09-18.** The playtest found it distracting and hard to read —
  exactly when the screen is fullest, which is when you most need to read it. Every zombie on
  screen is now drawn every frame; it is two `fillRect`s each and was never the frame budget. The
  screamer exemption above was already the tell that the budget cost readability.
- **Muzzle flash**: one white frame, derived from the existing `p.lastShotTime` rather than any
  new state, so there is nothing extra to reset, sync or tear down.
- `zFrameCount` drove the flicker budget and now only animates flame and burn pixels. It is **not
  a timer** — it ticks once per rendered frame in `gameLoop`, so it needs no
  `trackTimeout`/`trackInterval` registration.
- *2026-09-18:* the generator no longer prints U+26A1 (an emoji on most systems — a colour picture
  on a four-colour screen); it and every perk and gun are pixel bitmaps in `zombie-icons.js`, drawn
  with smoothing off (`ctx.imageSmoothingEnabled = false` is set every frame, since a canvas resize
  resets it). The ULTRA HEAVY is the one zombie that is not a square: an octagon with bone shoulder
  plates, three colours plus the hit flash, over the same square collision box.

**The HUD moved onto the shared tokens, mapped by meaning** rather than taste, which is the whole
point of the Signal Three being semantic: structure is `--phos-mid`, live numbers `--phos-hot`,
scrap `--sig-amber` (value/interact), weapon `--sig-cyan` (system), role and cards
`--world-hue`. The two end cards used to be green and red; **WIN is now cyan** (goal reached) and
**GAME OVER magenta** (death), which is the same vocabulary every other game will use.

**Leaderboard.** `LB.configure({ game: "zombie" })` at the end of `Zombie.html`;
`submitRunToLeaderboard()` in `zombie-game.js` fires from **both** `triggerGameOver()` and
`triggerWin()`.

- ~~**The score is the round reached.**~~ **Superseded 2026-09-19 — see "The run score" below.**
  (Was: `scoreBoard[id].score` is per-player kill credit and host-owned, so the board used how
  far you got instead.)
- `zLbSubmitted` guards it. `triggerGameOver()` is reachable **both** locally (everyone died) and
  from the host's `go` flag in `zombie-net.js`, so without the guard a client posts its run
  twice. `resetGame()` clears it so a replay can post again. Verified: one post per run, a
  second `triggerGameOver()` posts nothing, and a reset-then-replay posts once more.
- Name and room come from `MP.selfName`/`MP.room`, the same source as every other identity value
  here. **Under `file://` `LB` is a silent no-op**, so a double-clicked game is unaffected.

## The run score (2026-09-19)

What posts to the leaderboard, what the end cards itemise, and what the round-end scoreboard's
SCORE column shows: `runScoreFor(id)` in `zombie-game.js`. All the constants sit above it.

    total = combat + 50 * round^2 + 8,000 per silo filled
          + 40 per second alive while INTENSIFIED
          + (won ? 50,000 : 0),  then x2 if won

- **Combat** is still the host-credited `scoreBoard[id].score`, per player, but **rescaled**:
  a kill is the type's `score` × **10** (was × 100) × the 1.5 near-a-teammate bonus, an assist is
  **3** (was 25), and a revive is **100 × the current round** (was a flat 300). The 10× cut is
  what stops kills drowning out the other terms. Kills per round already grow ~1.16^r.
- **Round, silos and the win are team terms**, so everyone in a run shares them and only combat
  separates teammates. "Silo filled" means `siloFill[i] >= SILO_CAPACITY`, flipped or not.
- **The calibration is the user's brief:** a win is a massive chunk, but a deep loss (~round 35)
  should beat an ordinary early win, and a win that also gets deep doubles again. Modelled per
  player from the real spawn tables, for teams of 2–4: lose on 15 ≈ 21k, 25 ≈ 77k, 35 ≈ 250k;
  win on 15 ≈ 190k, 25 ≈ 300k, 35 ≈ 650k. A loss overtakes a round-10-to-20 win around rounds
  33–35. The model assumes an even kill share, so real rows will spread more than that.
- The end cards render it once, on open, via `renderRunScore()` in `zombie-render.js`. A guest
  reads its snapshot copy of `scoreBoard`, which can trail the host by one snapshot at the end.
- Verified in the browser with `LB.submit` stubbed: a walker kill credits 10; a round-15 win with
  3 silos and 9,000 combat posts 188,500 = (9,000 + 11,250 + 24,000 + 50,000) × 2, once; a round-35
  loss with 1 silo posts 237,250, once, across two `triggerGameOver()` calls.
- ~~Rows posted before this change (score = round reached, e.g. `2`) are still in Firestore.
  They are far below any new score, so they only matter as clutter.~~ **Superseded 2026-09-19
  (later):** the scores page lists every run, so those rows were visible — as a "score" of `2`.
  The run also posts **`round`** as its own field now (`LB.submit` takes an optional `round`),
  and `readZombieRun()` in `leaderboard.html` sorts the three doc shapes out: `{score, round}` is
  current; `{score}` under 50 is an old round-as-score row (shown as round, no score); `{score}`
  of 50+ is a run score from before `round` had a field (shown with no round). 50 is the floor
  because `runScoreFor()` adds `50 × round²` once round 1 starts. **If `SCORE_ROUND_K` or the
  round term changes, check `ZOMBIE_MIN_RUN_SCORE` in `leaderboard.html`.**

### The typed readout (2026-09-19)

The end cards no longer show the breakdown all at once. `renderRunScore()` types it out like a
terminal report. Each label types with a quiet printer key-click per character. The line's number
then lands with a tone, one step higher than the last. **FINAL SCORE** types last, and its number
lands with a chord and a low hum that swells in, holds, and takes ~8s to fade.

- **Everything is in D**, because the organ's own end cue (`musicEnd`, in D) is still ringing when the
  readout starts at 1.1s. A death steps up D minor pentatonic and ends on D minor. An escape steps up
  D major pentatonic and ends on an open D major chord. The voices are `sndReadoutKey`,
  `sndReadoutLine` and `sndReadoutFinal` in `zombie-audio.js`.
- **The hum** is two slightly detuned saws on D2 plus an octave sine, through a 420 Hz lowpass. It
  stops itself at 9.6s. `stopReadoutHum()` only exists to cut it short.
- **No reflow.** Every cell is laid out with its full text from the start and the untyped part
  `visibility: hidden` (`.ghost`), so the card is its final size before the first character types.
  The next character sits under an inverse block cursor (`.cur`).
- **One pending timer at a time.** The readout is a flat list of `[delay, action]` steps walked by
  one `trackTimeout` chain. Zero-delay steps run in the same tick, so a line's tone fires the
  moment its last digit appears. `stopRunScoreReadout()` clears the one timer and cuts the hum. It
  is called from `resetGame()` (a click restarts immediately, mid-readout or not), from
  `rejoinRunningRoom()` and from `zDestroy()`.
- Verified in the browser: a round-15 win typed 94 characters, with five line tones about 0.9s apart
  and the final chord at 7.5s. A restart while the hum rang silenced it. A restart 2s into a
  readout left no timer, and nothing sounded after the cut.

## The field manual

A terminal in the keep (`codexRect`), opened with F. Five tabs: weapons, perks (was "cards"),
pickups, enemies, the map. **Every table is generated from the live data** — `WEAPONS`, `CARDS`,
`ZOMBIE_TYPES`, `wallBuys`, `cardStations` — never hand-written, so it cannot drift from the balance
numbers. It also reads the actual zone names, so it tells you where *this* map's sniper is.

*2026-09-18:* weapons and perks carry their pixel icons; each perk shows its per-stack numbers
(`CARDS[].detail`) because the station prompt no longer does; the perks tab ends with **NOT ON THIS
MAP** (the three perks this map does not sell); the map tab covers the generator trip, the funnel
halls and every key. A **CLASSES** tab (asked for mid-playtest) prints every role's exact traits
from `ROLES[].detail` and lights your own row — "classes" in the UI, `roles` in the code, the same
split as perks/cards.

While it is open it swallows keyboard and mouse, or reading it would walk you into a wall and empty
your magazine. The round does **not** pause — it can't, the host owns the simulation.

## The Blood Silo endgame — how a run is won

`zombie-endgame.js`. Until this, a run could only end in failure.

~~sluice gate (two players, two locks) -> ... -> third silo full: THE FLOOD -> the southern heavy
gate grinds open over 90s -> walk out and you have WON~~ **Superseded 2026-09-26 — see "The
evacuation train" below.** The chain is the same shape and most of the code is untouched; three
links changed. Current:

    sluice LEVERS (N of four, scattered -- solo throws two)
      -> funnel room, kill zombies ON the funnel to fill TANK 1  (12)
      -> throw tank 1's switch to open funnel 2  ->  tank 2 (24)  ->  funnel 3 (36)
      -> all three tanks full: NOTHING HAPPENS YET. The team chooses when.
      -> shunt three fuel cars into the locomotive; buy the rail crossings
      -> START THE LOCOMOTIVE: the horn, THE FLOOD, and the tunnel begins opening
      -> the train HOLDS at the platform for the full 90s -- that is the fight
      -> the tunnel opens: it runs, reaching ~1,190px/s at the mouth, and you are WON
      -> the score types over a world that is still running, with the team on the train

**Silo capacity rises: `SILO_CAPACITY = [12, 24, 36]`** (2026-09-19, on request — it was a flat
12). Always read it through **`siloCapacity(i)`**: there were nine bare reads of the old scalar
across four files, and a missed one silently yields `undefined` and makes a silo that can never
fill. Total kills on funnels goes 36 → 72, and the escalation lands on funnels 2 and 3, which live
in halls built for a long fight.

Things to keep in mind if you touch it:

- **Each silo stands beside its funnel, piped to it (2026-09-18).** Funnel 1 and silo 1 share the
  sluice room (the funnel moved left of centre to make room; silo 1 is against the east wall).
  Funnels 2 and 3 are in **funnel halls** — two long walls, a drain floor, the funnel near one
  end and its silo against a wall near the other — built *first* in their zones (`planFunnelHalls` → `buildFunnelHall`), so everything else
  routes around them. Never the centre zone, never the sluice's, corridor zones last. The pipe
  (`siloPipes`, visual only) runs rim to tank and carries animated blood while its funnel is live.
  This **supersedes** the old "the three silos sit elsewhere again, so filling one is a journey
  rather than a button next to you": the playtest found the funnel–silo link unreadable and asked
  for them side by side. The journey is now funnel to funnel. Silos are still floor, not wall,
  like every other station. `finishFunnelsAndSilos()` has two fallbacks (another zone, then a bare
  funnel with its silo alongside) so a map can never lack one; across 500 seeds neither ran.

  **A hall's ends are pinched to a door (2026-09-19).** They used to stand open the full 240px
  inner width. Four jambs (`addHallPinches`, `HALL_DOOR` 140, `HALL_JAMB_D` 26) narrow each end,
  so a hall reads as a room you enter and leave rather than a tube — asked for as "cause pinch
  point slightly in silo hallways so there is more of a door-like entrance & exit". See rule 3
  above for why 140 and not less.

  **The silo label knows which wall its tank is against.** `drawEndgame` wrote both lines *above*
  the silo unconditionally, which in a **horizontal** hall is inside the hall's north wall — the
  reported "text showing amount full is currently inside of wall above". It did not happen
  everywhere, and that is the tell: a vertical hall parks the silo against the *west* wall and the
  sluice's silo against the *east* wall, and both have open floor above them. `makeFunnelHall` now
  sets **`labelBelow`** on the horizontal case, where it knows which wall it just used, rather
  than having the renderer guess. Both lines also get a dark backing plate either way — 9px
  Courier over a drain floor with animated blood in the pipe beside it was marginal even where it
  fitted.

  Swept 200 seeds: 400 halls, all 800 ends measure exactly 140px, every label side correct, no
  jamb clipping a funnel ring or a silo.
- **The sluice is at fixed world coordinates, not seeded.** It is the one landmark every run
  shares, so "meet at the sluice" has to mean the same place every time. **It is built before the
  zone contents** (2026-09-18) — see "Zones have identity" for the bug that fixed.
- ~~**The gate needs two players** — two plates 436px apart, and two consecutive holds.~~
  **Superseded 2026-09-26 (idea 69).** The plates are gone: **four levers scattered across the
  map**, ring-graduated (THE BLOCKHOUSE free, TURBINE HALL and THE MOTOR POOL a door out, THE
  SPILLWAY two), of which you throw **N**. Solo throws **two, any order, and they stay down**; a
  team throws **one per standing player, capped at four, all within `SWITCH_WINDOW_MS` (4.5s)**
  measured on the host's clock. A lapsed window springs them all back.

  This **retires idea 57** deliberately, and it is a trade rather than a repair: the game gives up
  its one strictly-impossible-alone mechanic and gains a chain a lone player can finish. The five
  things it has to get right — latching the required count on the first throw, counting only
  standing non-AWAY players, capping at four, measuring the window on the host's clock on arrival,
  and not looking like the one-way horde switch — are written out at the top of the switch section
  in `zombie-endgame.js`.
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

### ~~The south gate, and the walk out (2026-09-19)~~ — superseded 2026-09-26

> **The gate is a TUNNEL at the south-east rail head now, and nobody walks out — the train
> drives.** The machinery below is mostly intact and still describes what is drawn (a heavy slab
> grinding up over `ESCAPE_OPEN_MS`, derived from `escapeAt` alone, nothing new on the wire), so it
> is kept. What changed:
>
> - **`escapeRect` moved from x 2310 (south-centre, "dead south of the sluice") to the rail head at
>   x 4570.** The line already ended at y 2660, twenty pixels short of the southern perimeter wall,
>   in the south-east corner — it had always pointed at a way out that was 2,170px away from it.
>   **Accepted cost:** `PERIM_CORNER_CLEAR` (700px) deliberately keeps culverts away from that
>   corner, added 2026-09-20 after zombies wedged pathing round it. A gate that opens once is not a
>   culvert, but the climax fight is now in the one corner the map was closed over.
> - **The 90s is no longer a wait.** It starts when the locomotive does, together with the flood,
>   and the train holds at the platform for all of it.
> - **`updateEscape()` is a no-op.** Nobody wins by walking into the gate; `trainCheckTunnel()`
>   decides, and only above `TRAIN_WIN_SPEED`. A player on foot at the gate is a player who missed
>   the train.
> - **The walk-out and the fade are gone** (`ESCAPE_PULL_MS` / `ESCAPE_FADE_MS` no longer drive
>   anything; `winPullPx` and `winFade` stay at 0). The world keeps rendering behind the score.

### The south gate, as built 2026-09-19

~~A yellow loading bar over `escapeRect` and the word SEALED.~~ Replaced with the thing the bar
was describing, on request:

- **A heavy inner gate** grinds upward over the full `ESCAPE_OPEN_MS` (90s) — a ribbed slab in
  rails, revealing black beneath it as it lifts.
- **A chainlink gate stands shut in front of it the whole time.** When the slab is clear the fence
  **flies open** (`CHAIN_SWING_MS` 700, eased hard — a gate let go under tension does not travel
  at a constant rate), and only at `escapeChainFrac() >= 0.5` may anyone leave.
- Both are derived from `escapeAt` alone (`escapeGateFrac()` / `escapeChainFrac()`), so **nothing
  new crosses the wire** and a guest's gate is at the host's height.
- **The label is drawn ABOVE the rect.** `escapeRect` sits 8px off the bottom of the world and the
  camera clamps there, so anything below it is outside the view and is never seen — a label at
  `r.y + r.h + 20` lands at world y 2712 against a `WORLD_H` of 2700. Checked in the browser.

**Winning is a sequence, not a frame.** `triggerWin()` starts it and the card comes at the end:

| phase | ms | what |
|---|---|---|
| walk out | 0 – 1,400 | the local player is drawn progressively south, off screen |
| fade | 1,400 – 2,600 | the world, the lighting and the DOM HUD fade to black |
| card | 2,600 | `showWinCard()` — YOU GOT OUT, and the typed run score |

- **`won` is still set on the FIRST frame**, not the last: it is host-authoritative state on the
  wire (`wn`) and it is what stops the endgame and the flood. Only the *card* is delayed.
- **The pull is a draw offset (`winPullPx`), never a write to `p.x`/`p.y`** — the same discipline
  as `RETRO.snap`. Moving the simulation would run the player into the world clamp and the
  collision code on the way out, and broadcast it to everyone else as well.
- **Input and gameplay sound are dead for the whole sequence** (`winSequenceRunning()`, checked in
  the key/mouse/wheel handlers and at the top of `playEvent`), as asked. The score's own win cue
  is scheduled by `musicEnd()` and does not come through `playEvent`, so it rings under the fade.
- The sequence is **local and every client plays its own** — the run is won by the team.
- Driven from `gameLoop`, not `update()`: `update()` returns early while `netLost`, and a
  connection dropping mid-walk-out must not freeze the world half-faded with no card ever coming.

**Three pre-existing bugs were found on this path and fixed:**

1. **Only the HOST could ever win.** `updateEscape` looped `players` — the *local* array — while
   `updateEndgame` is called host-only, so a guest could stand in the open gate indefinitely and
   nothing happened. It uses `allTargets()` now, the same list the gate plates and the flood use,
   which also excludes AWAY players for the same reason they do.
2. **The WIN card could not be clicked.** It says "Click anywhere to run it again", but the
   mousedown handler only tested `gameOver` — and a win sets `won`, never `gameOver`. The losing
   card worked; the winning one was a dead end you had to reload the page to leave.
3. **The sluice gate's price plate read "undefined".** It is a door with no `cost` (it is opened
   by two players on two plates, never bought), and `drawDoors` printed `String(d.cost)`
   unconditionally. Costless doors no longer draw a plate.

## The evacuation train (2026-09-26)

`zombie-train.js`. What the objective chain is now *about*. Design and the alternatives that were
rejected: `TRAIN_RAIL_PLAN.md`; the decisions: `DESIGN_IDEAS_2.md` §8 and `DESIGN_IDEAS.md` Part 7.

> **Built as `zombie-alt/`, a second hub card, on 2026-09-25 and merged back into `zombie/` on
> 2026-09-26.** The fork existed for one evening so the train could be played without touching the
> game the group already had. `ae0f19d` is the last commit before it, if the old ending is ever
> wanted back.

**A TRAIN ON RAILS HAS ONE DEGREE OF FREEDOM.** Each car is a scalar `s` — arc length along one
polyline — plus a velocity. Collisions are 1-D, coupling merges two bodies and sums the mass, and
everything visible (the rect, the angle, a rider's carried delta) is derived from `s`. No physics
engine, and no second frame of reference.

Four rules, each load-bearing:

1. **NOTHING HERE TOUCHES THE NAV GRID.** Cars are not in `walls[]` and not in either solid grid;
   the deck is walkable for players and zombies alike. So `rebuildNavGrid`, `refreshNavRegion` and
   `navDirty` are never involved, a moving car cannot wedge a zombie against geometry, and it
   cannot crush a player into a wall. The only physical interaction is the cowcatcher, which
   **throws** rather than blocks. **Do not "fix" this by putting cars in `walls[]`:**
   `rebuildSolidIndex()` rebuilds both grids from scratch, and `markNavDirty()` costs a full ~17ms
   nav rebuild plus up to three BFS fields, every frame.
2. **Position is derived from one broadcast scalar per car** (`tw` on the snapshot), never
   interpolated — the `escapeGateFrac()` pattern. Not tidiness: a rider adds the car's own delta
   to its own position, and two clients disagreeing about the car by a pixel would drag two
   players to different places.
3. **Riders are carried, not re-pathed.** One rule, shared by players and zombies. Players apply
   it **client-side to their own player only** — each client owns its position and the host cannot
   move a guest.
4. **Shunting is capped at `TRAIN_SHUNT_MAX` (90px/s).** The flow field refreshes every
   `NAV_REFRESH_MS` (220ms), so a car travelling further than one nav cell (20px) in that window
   is one zombies steer at where it *was*. 20/220ms is ~90px/s. The cap lifts only once the
   locomotive is rolling, where being outrun is the point.

### The verbs

- **Push** from a car's **END** — proximity, not a keypress, the same shape as
  `updateGeneratorRestart`, so it needs no message and no prediction. Which end you stand at
  decides the direction. **ENGINEER 4x** (`TRAIN_ENGINEER_MULT`): a **time** gate, never a
  capability gate, because roles are hashed from `netToken` and a lobby can legitimately contain
  no Engineer.
- **Rocket:** `trainRocketKick()` projects the blast onto the track, so a rocket fired **across**
  the rails moves nothing. A shot you aim, not a shot you land nearby.
- **Couple:** a car reaching the consist merges in, mass-weighted, so a car slammed into a
  stationary train nudges it rather than vanishing into it.

### Started is not rolling

`trainReady()` needs **three cars coupled**, **three tanks full** (the tanks *are* the silos — no
second resource) **and every rail crossing bought open**.

Starting powers the locomotive up, sounds the horn, calls the flood and begins grinding the tunnel
— and the train **holds at the platform for the whole `ESCAPE_OPEN_MS`**. That 90 seconds is the
fight, and it only works as one if the train is still there to defend. An earlier version rolled
immediately, sat at a shut tunnel mouth with the throttle open, and won the instant the gate
finished.

**`TRAIN_RUN_ACCEL` is 520 px/s², sized to the actual run.** It is 1,369px from where the
locomotive stands to the tunnel, and `v = sqrt(2*a*d)`. At the first value (150) it arrived at
641px/s — 2.7x walking, not the ~5x the departure is for. At 520 it arrives at **1,190px/s** over
the same ground.

### The rail crossings are the boundary doors

Where the line crosses a sector boundary, **that pair's existing door MOVES onto the track**
(`railOpenCrossing`) and the hole it left is walled up. Two openings per wall as before — the
difference is that buying the door is also what clears the line, which is the point: exploring
outward *is* opening the rail path, at the expense of your scrap.

Measured over 47 seeds: the rail crosses **KENNELS|YARD** and **YARD|MOTOR POOL**, both of which
already carried a door and a window, so **no sector's depth and no door price moved** — THE YARD
is still ring 2 and the rocket still costs 10,350.

**The first attempt was wrong and the mistake is easy to repeat:** making each piece
`carveOpening` cut into its own door produced a **33px door** on the Yard|Motor crossing (the lane
there overlaps an opening that already existed, so only 33px of the 120px lane was still wall) and
left it at the placeholder cost of 900, because `priceDoors()` walks `zonePassages` and a
hand-pushed door is not in it.

### Who gets the win score

**Only the players standing on the train when it took the tunnel.** `trainAboardIds()` is computed
by the **host** from positions it already has — not from each client's own `onTrain`, which is
client-side and is exactly the flag a player would want wrong in their favour — captured into
`wonAboard` on the frame before `triggerWin()`, and broadcast as `wab`.

`runScoreFor(id)` gates both win terms on it: `SCORE_WIN` and the x2. Everything else (combat, the
round term, the tanks) is unchanged, because that work was done either way. The card reads **THE
TRAIN LEFT / YOU WERE NOT ON IT** and the ESCAPED row becomes **MISSED THE TRAIN**. Measured on one
run: **166,100 aboard against 33,050 left behind.**

### Four bugs that only showed up by playing it

1. **Two renderings of one state contradicting each other on screen** — the objective line read
   "THROW THE SLUICE LEVERS" while the NEXT strip two rows below read "START THE GENERATOR". Both
   true, both about the same chain. `endgameObjective()` waits for the generator now.
2. **A relative shift is the wrong tool for an absolute requirement.** Windows overlapping the lane
   were nudged by a fixed amount and 4 seeds in 12 were still on it by 15px; a later version moved
   one east and the world clamp put it straight back onto the track. Now: trim to the lane edge,
   and if that leaves a stub, try **both** sides and check the result. *Never trust a clamp to
   preserve an invariant it does not know about.*
3. **`onTrain` was cleared on any frame the train stood still**, because "am I aboard" and "did it
   move" were one question. The flag is what grants the grace to stay on a car already over
   `TRAIN_BOARD_MAX`, so a player standing on a stationary locomotive was treated as boarding
   afresh the moment it pulled away — and left on the ballast.
4. **A rider on a moving deck cannot be re-tested for overlap.** At 1,300px/s the deck moves 21px a
   frame; one frame of `updatePlayers` clamping you to the world edge and you are off it forever.
   465px of lag over a run, 1,289px after the win. The rider is **parented** to their car above
   `TRAIN_BOARD_MAX` and once `won`. 465px to **46px**.

### Verified

Two harnesses over the page's own scripts (`scripts/zombie-headless.js`), plus solo play:

- **47-seed map sweep** — 4 levers a map, 4 cars, 2 rail doors, none narrower than the 120px lane,
  none underpriced, **no barricade left standing on the running line**, no boundary window trimmed
  under the 78px nav guarantee, every sector still connected, `escapeRect` at the rail head.
- **The train simulation** — friction stops a rolling car; the shunt cap holds; a rocket out of
  range does nothing and one along the rails shunts; all three cars couple by shunting; the consist
  is ordered nose-to-tail; an unfuelled loco will not start; **a loco with a shut crossing ahead of
  it will not start**; buying the crossings makes it ready; starting it opens the tunnel and calls
  the flood; it **holds** while the tunnel is shut; it reaches the mouth at 1,190px/s.

### Known limits

- **The Kennels' sidings still go nowhere.** 3.0 sidings a map and **0 of them joined to the line**
  (measured). A rail **graph** with junctions is `TRAIN_RAIL_PLAN.md` T1 and belongs with authored
  geometry (`LEVEL_BUILDER_PLAN.md` phase 4). The train lives on the through line.
- `spurLanes` was never cleared in `generateLevel()` — fixed here. It only mattered because the
  lanes are pure geometry and identical every seed, which is exactly why nobody noticed.

## THE SUPER SPLITTER (2026-09-20)

Replaces the ULTRA HEAVY in the same slot: 34px body, 30 HP, the same wire index, the same reason
`NAV_PAD` is 19. Everything else is new, and all of it is about it **coming apart**.

| | |
|---|---|
| every damaging shot | sheds a **SPAWNLING** (throttled — see below) |
| every step of cumulative damage | drops a full **SPLITTER** |
| death | throws **20 ULTRA SPAWNLINGS** in a **fan**, along the killing shot |

**The fan is the only thing on this map that is not pathing the moment it exists.** It needed:

- a **`launch` phase** (`updateZombieLaunch`) that `updateZombies` checks **first** and `continue`s
  past — no pathing, no chewing, no screaming, and **exempt from the stuck watchdog** for exactly
  the reason chewing is: travelling nowhere is the point.
- **three appended fields on the zombie row** (`launchUntil`, `lvx`, `lvy`), present only while it
  is actually in the air, so nothing else on the map pays for them. Remaining durations, never
  timestamps (rule 1). Without them a guest draws a flying zombie as a teleport.
- **`damageZombie` now takes the hitting round's velocity**, so the fan opens along the shot. A fan
  that always pointed the same way would be a firework; the point is that where you stand when you
  kill it decides where the pieces go.

Verified: 20 thrown, staggered landings over ~1s, 104–194px of travel, spread perpendicular to the
shot direction.

### The balance was measured, and the first pass was wrong

Shedding one spawnling per shot and one splitter per **8 raw damage** gives, at round 16 where
`zombieHpMultiplier` puts this at 90 HP: **29 spawnlings and 11 splitters from one kill**, rising
to 49 spawnlings by round 26. The swarm would have grown with the round *on top of* everything
else that already does.

So **the splitter step scales with the HP multiplier**, and **the spawnling throttle widens at half
that rate**. Across rifle / SMG / sniper at rounds 16, 26 and 31:

| | |
|---|---|
| splitters | **3**, every round, every gun |
| spawnlings | **11 to 20** |
| fan | **20**, always |

**15–16 spawnlings is the number to tune by feel.** High enough that emptying a magazine into it is
visibly a bad idea — which is the whole point of it — and low enough not to be a screen wipe.
Burn ticks deliberately do **not** count as shots, or one flamethrower is an endless fountain.

### Its own round (item 7)

Every 5 rounds from 16 (`isSuperRound`), one at first and another every two special rounds after,
capped at four (`superRoundCount`). The ordinary spawn table can still roll one outside those — the
"on normal rounds too" half of the brief, and what stops the special round being the only time you
meet it. `ultraCap` lifts to whatever the special round is supposed to deliver.

### Drawing it

A **square** — it is a splitter and the square says so — with seven smaller squares riding its
**perimeter**, each crawling at its own speed and pulsing in size. That is the squelch. Riders
crawl the edge rather than orbiting, because things going round a square body in a circle read as
a halo.

**Every rider is derived from its index and the clock**, so it costs no state, needs no reset and
never crosses the wire. Colour moved from the ULTRA's red into the **splitter's blue family**,
because the colour should say which mechanic you are about to deal with.

### `Z_TYPE_KEYS` index 6 was REPLACED, not appended

The list is append-only and this is the exception, safe only because the two are the same slot —
same body, same HP, same role — so a client on the old build would draw the new one as an ULTRA
HEAVY rather than as something nonsensical, and this group updates together. **`uspawn` is a
genuine append on the end.**

## THE HORDE SWITCH — intensified play (2026-09-19)

A heavy knife switch in the keep (`intensifyRect`, against the south wall, ~300px from the field
manual with the ammo crate between them so the two `F` targets can never be confused). Asked for
as a switch that "flips down and is heavy", which intensifies and speeds up the game for blitz
runs.

**It is ONE WAY.** There is no un-intensifying, and the prompt says so — `CALL THE HORDE — NO
GOING BACK`. That is the only thing that makes it worth a set piece: a decision the team makes
together and then lives with.

### The moment

Host-validated through the existing buy seam (`requestBuy("intensify")` → `hostHandleBuy` →
`hostFlipIntensify`), because two players hitting it on the same frame must produce **one** call.
It is free and is checked *before* the scrap tests, so an empty pool can never block it. Then
three beats, which every client runs itself from one broadcast flag:

1. **A normal toast** — `"<NAME> CALLED THE HORDE"`, via `showToast`, the existing device.
2. **A siren** — `SND_SIREN` / `sirenCall()`. Two rise-and-fall sweeps over 3.4s on a detuned
   sawtooth pair through a lowpass; the detune is what gives a mechanical siren its beat rather
   than a clean glide. **It is the only sound in this game that is not positional** — it skips
   `audioPlacement` entirely rather than being handed a very large radius, because it is coming
   from everywhere.
3. **`INTENSIFY_SIREN_MS` (1.2s) later, THEY HEAR YOUR CALL** fills the screen in crude red
   (`#hordecall` in `Zombie.html`). It **vibrates on a whole-pixel jitter written from the render
   loop**, never a CSS animation: sub-pixel wobble reads as 2016 indie, not 1980 arcade
   (`AESTHETIC_GUIDE.md` §4), and driving it from `updateHordeCall` means it needs no timer of its
   own and cannot outlive a teardown. It holds 2.2s and **cuts**, it does not fade.

The lever itself falls over `INTENSIFY_LEVER_MS` (450ms) with a slight overshoot and settle, which
is the whole read of "heavy" — a lever that snaps to its new angle in one frame is a toggle, not a
piece of gear. Afterwards it is dead metal and the keep stops advertising it.

### What it changes — four places, all reading `intensified`

| | normal | intensified |
|---|---|---|
| a round clears when | budget spent **and** map empty | **budget spent** alone |
| zombie speed | `spec.speed` | **× 1.28** (`INTENSIFY_SPEED`) |
| score | — | **40/s** on your feet (`SCORE_ALIVE_PER_SEC`) |
| the score (music) | the organ bed | cold drumming, sparse notes |
| round change cue | `round` | `roundHard`, rising a semitone per round |

- **The Blackout condition is deliberately kept.** A round still cannot clear while `genTripped`.
  That is the 2026-09-18 mechanic and it is the one thing that should still be able to stop the
  clock; intensify drops the *empty-map* condition only. Verified both ways in the browser.
- **The speed multiplier is applied where speed is READ** (`updateZombies`), not written into the
  zombie at spawn — so throwing the switch speeds up everything already on the map at that
  instant. A runner goes 2.05 → 2.62, which is "a fair amount but not overkill".
- **`SCORE_ALIVE_PER_SEC` is the only run-score term the host does not own**: each client counts
  its own seconds (`aliveMs`, only while up — a downed player is not surviving, they are being
  rescued) and posts them with its own run. 40/s makes five intensified minutes worth 12,000,
  between one silo (8,000) and the round term at round 16 — a real reason to throw the switch
  early without ever competing with kills, which grow ~1.16^r. It shows on the end card as
  **HELD OUT**, and only when it is non-zero, so an ordinary run carries no row reading 0.

### Wire

`iz` (0/1) and `hc` (the caller's name) on the world snapshot. **State, not an event**: the event
queue is capped at ten a snapshot and is the first thing dropped, and the one packet that says the
horde has been called must not be droppable. A guest runs all three announce beats off the
`0 → 1` transition rather than needing three events to survive the trip. `hc` rides only while the
announce window is live, not on every frame of the rest of the run.

Everything is cleared in `resetGame()`, including `hideHordeCall()`.

A host-gated **CALL THE HORDE** dev button does exactly what the switch does, so a playtester can
reach the blitz — and re-check the announce beats — without walking back to the keep.

## Roles

Randomly assigned, but **derived from the client's own id hash — never dealt by the host**. No wire
traffic, survives a reconnect, and consistent with how colour and identity already work.

> **Corrected 2026-09-19.** "Survives a reconnect" was not true until then: the id hashed was the
> *socket* id, which the server re-rolls on every connection, so a wifi drop re-dealt your class
> mid-run. It now hashes the per-tab token (`netToken`, see "Connection trouble" below), which
> survives drops and page refreshes.

`roleForId()` deliberately does **not** use `hashToUnit()`: that keeps only the low bits of a djb2
hash (`% 10000`), and djb2 low bits cluster hard for similar strings. Across 400 ids it dealt
engineer 270 times, scout 40 and **medic zero**. It now runs a proper avalanche finalizer before
the modulo, which measures 187–210 of 800 for each of the four.

| Role | Passive |
|---|---|
| `MEDIC` | Revives 40% faster and ignores the per-round revive escalation |
| `ENGINEER` | Traps 40% cheaper (stacks with CONDUCTOR); windows come back at 150%. **The second half never fired before 2026-09-18**: it lived only on the manual "board" purchase, which needs a damaged window during a breather — and `endRound()` repairs every window to full the moment the breather starts, so the purchase never came up. It now applies to that breather re-board whenever an ENGINEER is in the game (`engineerInGame()`), and a window above 100% draws a light reinforcing frame instead of planks past its ends. The trap prompt also showed the price *without* the ENGINEER cut it charged; now it matches |
| `SCOUT` | Double ping reach, pickups on the minimap, +10% speed |
| `GUNNER` | +15% damage, applied at the muzzle (`shoot()` and the `shoot` message) — so a ricochet keeps it (same round) but barrel and perk damage do **not**, which this table used to claim they did; +25% crate ammo, which its in-game blurb promised from the start and nothing applied until 2026-09-18 (`refillAmmo`) |

## Known gaps

- ~~**Buildings are broken on most maps (audit 2026-09-21, `MAP_VISUAL_AUDIT.md` §1.1).** 95%
  have an open corner; 26% of furniture overlaps walls; 23% of stairs stand outside.~~
  **Answered 2026-09-26 by hand-authored stamps** -- all three measure 0% now. `makeBuilding`
  still has every one of those defects and is still the fallback in a sector with no stamp
  that fits, so the way to finish this is to draw stamps until it is never reached, not to
  patch it. Building windows still use the barricade art.

- ~~**A solo player cannot be revived.** Downed needs another *alive* player in the room, which is
  now necessarily a networked teammate. Playing alone, going down is a 25-second crawl that ends
  in death regardless — strictly worse than just dying. Worth either shortening the bleed-out
  when no reviver could possibly exist, or giving solo players a self-revive. Not done; it's a
  design call, not a bug.~~ **Settled 2026-09-18** by the team-wipe rule: nobody standing → a 2s
  grace → game over. Solo, going down now ends the run in 2s instead of 25.
- ~~**No audio at all**, so the downed-teammate alert is visual only.~~ **Wrong since v3
  (2026-09-04 correction).** `zombie-audio.js` has existed since v3 — this same file lists it at
  position 4 in the load order and documents it at length two sections above. Downs and revives
  both have sounds. The entry survived because "Known gaps" was never re-read when audio landed.
- **Nav pad is sized for the largest zombie plus skin** (`NAV_PAD = 19` since 2026-09-18 — the
  ULTRA HEAVY is 34px; it was 15 for the 26px brute, and 13 until 2026-09-07, which gave a brute
  *exactly zero* clearance in a cell the field called passable — any float error at a corner
  clipped). Every opening a zombie must use is wider than `2*NAV_CELL + 2*NAV_PAD` = **78px**. If
  you add a narrower opening, or a bigger zombie, large enemies will quietly stop using it.
- ~~**A solo player cannot finish a run.**~~ **Fixed 2026-09-26** by the sluice levers (idea 69):
  alone you throw two of the four and they stay down. Solo can now reach the ending, which is the
  whole reason idea 57 was retired.
- **The levers have never been thrown by a real team.** Everything about the multi-player case —
  one lever per standing player, capped at four, all within 4.5s on the host's clock — is verified
  solo and headless only. `SWITCH_WINDOW_MS` is the number most likely to need tuning by feel.
- **The win does not require anyone aboard, only that the train gets out.** A scattered team still
  ends the run; what they lose is the win SCORE, which goes only to players standing on the train
  when it took the tunnel (`wonAboard` / `wonOnTrain`). Their card reads THE TRAIN LEFT and the
  ESCAPED row becomes MISSED THE TRAIN. Measured: 166,100 aboard against 33,050 left behind on the
  same run. A hard TRAIN LOST state is deliberately not built.
- **The rider ends the run about 480px behind the locomotive on screen.** They are parented to
  their car and moving with it; the offset is from the frames before the parent took hold.
  Cosmetic, and only on the win card.
- ~~**No manual weapon switching.** A wall-buy equips what you bought; you can't cycle back to a
  weapon you already own.~~ **Resolved 2026-09-18** — `1`–`7`, the wheel, and a dry gun handing
  over to the next one you own.
- **The score has only been verified against a recording mock.** Every cue, layer and threshold is
  checked headless (what is scheduled, at what pitch, when), but nobody has listened to it in a
  session yet. The balance numbers most worth tuning by ear: `MUS_LEVEL`, the soprano's 12/26
  thresholds, and the chime volume.
- **Only the ULTRA HEAVY's single-zombie traversal is measured**, not a crowd of them — at most
  four can be alive (`ultraCap`), and relocation remains the backstop.
- `window.GameInstance` is deliberately **not** implemented — see
  `GAME_PROTOTYPE_INSTRUCTIONS.md` §2. The `trackTimeout` / `AbortController` plumbing in
  `zombie-core.js` exists anyway, per the root `CLAUDE.md` hard constraint.

<!-- doc-sync: dc0edf48 | 2026-10-17 -->
