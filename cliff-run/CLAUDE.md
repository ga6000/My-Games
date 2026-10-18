# Cliff Run — file-by-file

A 4-player free-for-all side-scrolling platformer down a cliff face. Ten levels, forced scroll,
a rock avalanche filling the left edge. Players 2–4 are bots. Built 2026-10-16/17 from the user's
brief; `CLIFF_RUN_PLAN.md` is that brief turned into a plan and still describes the intent
accurately.

**Off the hub board on purpose.** `SCOPE_RULES.md` rule 8 keeps the board at five cards and makes
promotion one-in-one-out, so `hub/hub-core.js`'s `GAMES` array is untouched and which card this
would displace is the user's call. It lives at the repo root (active work) rather than under
`under-development/`.

- **Cabinet:** RASTER (`AESTHETIC_GUIDE.md` §1 — it draws filled blocks on a tile grid). Scanlines
  permitted, gated on `data-cabinet="raster"`.
- **World hue:** `#6F8FA8` basalt steel, a deliberate departure from §2.5's all-neon table. The
  cliff is the biggest thing on screen with four identity colours drawn on it; terrain gets
  brightness, entities get hue, which is §2.2's own discipline.
- **Status:** runs end to end; **not yet played by a human**, and the bot finish rate is still
  under its own acceptance bar (§"Where it stands").

---

## Files

Classic `<script>` tags, one shared global scope, no modules (`file://`). Every top-level name is
`cr`/`CR_`-prefixed; `scripts/check-global-collisions.js` and `check-undefined-globals.js` both
pass on the page.

| file | owns |
|---|---|
| `cliff-run.html` | the shell: cabinet panel markup + CSS, menu, script order |
| `cr-core.js` | constants (`CR_PHYS`, `CR_T`, `crLevelSpec`), all run state, teardown plumbing, seeded RNG |
| `cr-audio.js` | its **own** `AudioContext`: one-shots plus the two sustained voices |
| `cr-level.js` | level generation, the guaranteed route, corridor reservation, repair + verify |
| `cr-entities.js` | body factory, items, collapsing-block fuses, bombs, particles |
| `cr-physics.js` | integration, tile collision, wall skills, player-vs-player bounce, death/finish |
| `cr-bots.js` | the route-following controller for seats 1–3 (and seat 0 in attract mode) |
| `cr-render.js` | the raster draw |
| `cr-panel.js` | the cabinet panel writers, including the radar |
| `cr-boot.js` | input, match flow, `window.GameInstance`, the fixed-step loop. The only file that executes anything |
| `cr-dev.js` | `L`+`G` dev panel registration. Loads last, registers only |

Load order: `identity.js` → `mp-core.js` → `retro.js` → `leaderboard.js` → `devtools.js` → this
game's files → `cr-dev.js`.

**Audio owns its own context rather than loading `shared/sfx.js`** — the same call Glass City made,
for the same reason: `SFX` has no sustained-voice primitive and the two most important sounds here
are sustained (the wind tunnels, the avalanche rumble). Loading both would put two `AudioContext`s
on one page. The two jingles `shared/sfx.js` says should sound identical everywhere are reproduced
note for note, so a falling four-note figure still means "you died".

---

## The one idea the whole thing rests on

**`cr-level.js` emits a route as it builds the geometry, and `cr-bots.js` follows it.**

A forced-scroll platformer with collapsing blocks, wind, wall-jump chimneys and bombable walls is
not something a reactive bot can improvise. So the generator never places a hazard it has not just
made passable: it walks left to right emitting segments, and every segment appends the waypoints
that cross it. The hard question — *can this level be finished* — is answered at generation time,
and what is left for the bots is execution. The human player ignores the route entirely.

Two consequences constrain every edit:

1. **Gaps are capped against `CR_PHYS` by `crMaxGap`, derived rather than written down.** The reach
   of a jump depends on how far it also has to *rise*: 4.26 tiles level, 3.75 one row up, 2.97 two
   rows up. `CR_REACH_SAFETY` (0.72) keeps the cap well inside that, because a bot jumps on a tile
   boundary and not on a frame, and a crosswind may be blowing.
2. **The last stretch of every route is a forced staircase onto a catwalk** (`crApproach`). The
   convergence pass before it only makes that staircase short; it is never what makes the level
   finishable.

**Lanes → intermix is geometry, not script.** Four routes, one per lane, each with a vertical band
that widens with progress: own band at 0%, the whole cliff by 33% (`crLaneBlend`). They then cross,
share platforms and get in each other's way with no code that says "now interact". The band narrows
again over the last 22% so the far outpost's four catwalks are reached from four heights.

---

## What the bots actually do

Priority order, highest first, in `crBotThink`:

1. **avalanche** — within 50px of the line, sprint and dash
2. **recovery** — more than 2.2 tiles off the route: first try switching to the nearest lane's
   route, then climb
3. **stuck guard** — no forward progress for 1.5s: hop and dash
4. **waypoint** — the node's `kind` picks the behaviour
5. **opportunist** — a coin within a short hop, only if nothing above wanted the frame

Branches **auto-spring on contact** rather than needing a timed input. That was chosen so the bots
could use them at all, and it reads better for a person too.

---

## Bugs this game has already had, and what each one cost

Kept because every one of them was invisible from the code and only showed up as a number. All
measured with `scripts/cliff-run-playtest.js`, 4 bots × 10 levels × N seeds.

| # | the bug | effect | fix |
|---|---|---|---|
| 1 | **The band clamp moved the walker without building anything.** `if (w.row < band.lo) w.row = band.lo` ran *after* a segment, so the next platform appeared up to fourteen rows from the last landing with nothing between. The route was a list of waypoints across a hole. | 3% of bot attempts finished | deleted; the band is enforced inside `crEmitWeighted`, which only offers a segment whose `dRow` fits |
| 2 | **Every bot jump was cut to 45% height on its first frame.** `inp.jump` was computed at the top of `crBotThink`, before the layer that pressed it, so the frame the jump fired on had `jump` false and `CR_PHYS.jumpCutMul` clipped it. Apex 37.9px → 7.7px, on a cliff whose smallest step is 16px. | 12% | every hold goes through `crBotHold`, which sets the edge and the held flag together |
| 3 | **A one-pixel inset in the vertical collision scan.** `b.y + b.h - 1` is the right idiom for the last pixel inside an AABB and catastrophic for a body at rest: `crLand` snaps the feet to exactly `r*TILE`, so the next step's 0.05px of gravity put the feet in the row *below* the one the scan looked at. `onGround` was false for most of every frame of ordinary walking — so bots ran off ledges without jumping, could wall-jump while walking, and the collapsing blocks often never armed. | 1238 route departures at plain `walk` waypoints | `CR_EPS` on the bottom edge, plus `crGroundUnder` — ground is now *probed* every step, not inferred from a collision |
| 4 | **The scroll outran the walk speed.** 46→96 px/s over 150→190 tiles is a slack ratio of 2.3 falling to **1.13**: level 10 afforded 3.7 seconds of not-running-flat-out, for jump arcs, a chimney, a bomb fuse and three players shoving you. | bots caught by the avalanche on every seed from level 5 up | 40→68 px/s over 150→165 tiles (slack 2.7 → 1.6); still a 1.7× ramp |
| 5 | **The updraft was a cannon.** `ay = -820` against gravity 760 is a net *lift*, and the bot jumped into it: entering at −240 with nothing to decay it, a body rose 127px — eight tiles — past the top of the rect and off the route, every time. | every vent gap | `ay = -755` (gravity almost exactly cancelled, so you cross level), rect only 3 rows tall, and the bot walks in rather than jumping |
| 6 | **The spring overshot its landing.** A branch is a fixed impulse carrying 7.7 tiles (8.75 if jump is held), but the platform was placed after a 3–5 tile gap — so the arc ended past its far edge. | bots still airborne and two rows high at the next waypoint | `crEmitBranch` sizes the platform *to the arc* |
| 7 | **The first finisher parked in the catwalk doorway.** The approach is one body wide and a finished body is a wall (`crIsWallBody`), so it came to rest on the catwalk's first tile with everyone queued behind it. | whole levels timing out at 150s with three live bots shoving | each arrival parks two columns further along |
| 8 | **The avalanche stopped when the camera clamped** at the end of the level, so a bot wedged short of the outpost lived forever. | sim-cap timeouts | `crAvalancheX` creeps on its own; finished bodies are exempt |
| 9 | **Chimneys and bomb walls were abandoned mid-use.** Waypoint re-acquisition is keyed on x, and both features are vertical and stateful — a bot entered a chimney, rose two rows, and re-acquired a `walk` node on the far side of the wall it was standing inside. | hopping at a wall until the avalanche arrived | `crBotBlockingWp` / `crBotWpDone` make those two kinds sticky |
| 10 | **Four routes, one grid, no reservation.** A later lane stamped chimney walls, bomb columns and ordinary platforms straight through an earlier lane's path. The worst shape is subtle: a 14px body on a 16px grid occupies exactly *one* row, the row above its platform — so a tile there is not a ceiling, it is where the player *is*. | `crVerifyRoutes` found flaws in **105 of 120** generated levels | per-lane corridor reservation (`crMarkCorridor` stamps the owner, so a route respects everyone's but its own), `crBoxFree` for chimneys and bomb walls, pre-reserved approach corridors, and `crRepairRoutes` |
| 11 | **Build order was a pecking order.** Routes were built one lane at a time, start to finish, so lane 0 wrote into an empty cliff and lane 3 into the leftovers. | 61/42/34/25% finish by lane; flaws 2/4/11/23 | `crBuildRoutes` steps all four walkers round-robin, furthest-behind first. **38% -> 59% mean finish**, the single biggest win here |
| 12 | **A uniform corridor depth is wrong in both directions.** At 3 rows, four lanes wanted 16 of 15 playable rows, so almost nothing but a flat run ever fitted and levels came out as five unbroken shelves — the finish rate went UP while the game got worse. At 1 row the levels were varied and jumps clipped other lanes' platforms at the apex. | 57% and boring, or 36% and falling | the depth travels with the segment: a run claims 1 row, a jump `CR_HEADROOM`, a branch its own arc, a chimney a box |
| 13 | **The gust held you at exactly platform height.** `ay = -755` against gravity 760 cancels weight, so the body flew with its feet on the landing's top surface — and `crMoveX` then caught the platform's *side* the moment it sagged one pixel. It hit the edge of its own landing. | vents were the costliest feature, worth 13 points | `ay = -790`, a 30 px/s^2 lift: arrive 5-10px high and fall onto it |
| 14 | **Crumble runs converted other lanes' ground.** `crSpan` writes unconditionally, so a collapsing run laid over another lane's stone platform turned their footing into blocks that fall — and once a neighbour triggered them, into a hole. The corridor reservation cannot catch this: it protects the rows *above* a platform, and this is the platform row. | part of crumble's 7-point cost | `crCrumbleSpan` converts empty cells only; where another lane has built, the routes share that stone |

The verifier that caught #10 is the lesson worth keeping: **`crVerifyRoutes` separates "the level is
broken" from "the bot is bad"**, and before it existed those two were one number going down.

---

## The revision (2026-10-17, second pass)

The user asked for seven things after seeing the first build; all seven are in.
`CLIFF_RUN_PLAN.md` ends with the plan that was written for them.

| | was | now |
|---|---|---|
| player | a 10x14 blocky figure | **Zombie's player**: a 16x16 identity-coloured square with a 4x4 white facing pip, ported from `zombie-render.js`'s `drawPlayerBody` |
| `CR_TILE` | 16 | **24** |
| framebuffer | 480x288 = 30x18 tiles | **480x384 = 20x16 tiles**, which is also the 5:4 the raster cabinets shipped with |
| lane rows | 3 / 7 / 11 / 15 | **3 / 6 / 9 / 12**, three apart |
| `moveSpeed` | 108 (6.75 tiles/s) | **120 (5 tiles/s)** |
| `jumpVel` | −240, apex 2.37 tiles | **−290, apex 1.75 tiles** |
| scroll | 40 → 68 px/s | **24 → 46 px/s** |
| level length | 150 → 165 tiles | **60 → 80 tiles** |
| terrain | thin platforms in black | **solid rock with corridors cut through it** (`crThicken`) |

**The jump is tuned to one fact: it clears a two-tile GAP but not a two-tile
CLIMB.** That is where the strategy comes from. A jump that does both solves the
level by itself; one that does neither is a slower walk. Splitting them makes a
2-tile climb and a 3-tile gap double-jump-only, which turns the `dj` pickup from
a bonus into a key and makes *where you spend it* the decision of the level.

**The cliff is solid now.** `crThicken` grows every solid tile downward, stopping
at any lane's reserved corridor. The world reads as rock with passages cut
through it; the space between lanes becomes mostly stone, leaving one-row
corridors; and a hole in an upper lane's floor is a **shaft into the lane
below** — so a fall costs height and position rather than the run, and the lanes
connect vertically with no code that says "now interact". Only the bottom lane
has nothing underneath, which is the price of the top lane being the easiest
spawn.

**`crEmitTunnel` is the one-block squeeze**: floor, your own row, and rock
directly above it. A 16px body fits a 24px opening; `CR_PHYS.jumpVel` wants 1.75
rows and there is one. Inside it you cannot jump, cannot be bounced over, and
cannot turn a mistake into a detour.

**Forgiveness is a real mechanic, not a label.** `crLevelSpec.forgiveness`
scales `coyote` and `jumpBuffer` from 1.8x on level 1 down to 1.0 on level 10
(`crCoyote` / `crBuffer` in cr-physics.js), so a late press still works early on
and nothing on screen says so. Levels 1–2 also get `crSafeFloor`, a solid row
under the world: you can still lose to the avalanche, but you cannot fall out.
From level 3 the void is real, and that is the single biggest difficulty step in
the game.

---

## The third pass: movement, pacing, art (2026-10-17)

**Controls, rewritten around "nothing needs mastery."** The first build copied
Celeste's wall — hold *into* it, jump, press *back* — which is three ordered
inputs inside a fifth of a second for one move. The user's call: *"I wouldn't
expect a friend group to get it down."* Correct, and the reference games agree:
TowerFall, Rayman and Ultimate Chicken Horse all make the wall **contact-
triggered**, and SpeedRunners (the closest relative — four players, forced
scroll, die when the screen leaves you) puts its dynamism in a grapple that
aims itself. The pattern is always *the player supplies timing and intent, the
level and the game supply the execution.* Full write-up and the two
alternatives are in `CLIFF_RUN_PLAN.md` → "Movement".

- **The wall asks for nothing.** Cling is automatic while falling beside one;
  jump launches you up and away. No direction, no window.
- **Everyone always has one air jump**, back on any contact (`b.airJumps`). The
  chevron now grants an *extra stored* jump on top of it.
- **Input windows ramp**: `coyote` and `jumpBuffer` at 1.8× on level 1 down to
  1.0× by level 10 (`crCoyote` / `crBuffer`).

**The camera runs at a fixed rate and nothing speeds it up**, and the right edge
of the screen is a wall. The user's call, and it turned out to be the single
biggest mechanical win in the project: **50% → 66% bot finish in one change.**
A camera one player can drag is a camera that kills the other three; a hard
right edge means the gap between first and last can never exceed one screen. It
also makes a level's duration a number the generator sets —
`(worldW − CR_VW) / scroll` — instead of an emergent property of how fast the
quickest bot happened to be.

**Level length is now a measured compromise.** Length *is* duration, so it is
also how many chances a bot gets to wedge itself: at 70–95 tiles the finish rate
fell 63% → 38%, nearly all avalanche deaths. At 50–70 the bots did well and ten
levels went by in two minutes with no room to differ. **60 → 80 tiles** is
~19–20s a level, about 3.5 minutes for the ten.

**Art.** Stone draws as rock, not brick: the lit crest appears only where there
is sky above, the top edge *steps* per column so the skyline is not a ruled
line, and every tile carries two facets and a fissure keyed off `(c, r)` — no
state, no shimmer. The backdrop gained a **ridge** at 0.1 parallax, which is the
one shape that reads as a mountain rather than a wall. The outposts are drawn as
**structures** over the tiles (`crDrawOutposts`): lit windows on a deterministic
grid with a few dark and one in twelve flickering, handrails with posts along
every catwalk, diagonal struts bolting the hull into the rock, and a mast with
guy wires and a blinking beacon. The near tower is narrow (it is a door you
leave through, and at 8 columns it ate a third of a 20-tile screen); the far one
is wide, because four finishers park on it.

---

## The grapple (2026-10-17)

**One key, and the game aims it.** `F` fires at the best ring in range, hold to
swing, let go to fly. This is the SpeedRunners answer to "more dynamic and easy
to play", and the two halves of that only pull against each other for other
mechanics: what makes a grapple feel good is the **arc**, what makes it hard in
most games is the **aim**. Take the aiming away and what is left is two
decisions — when to fire, when to let go — neither needing practice, attached to
the longest, fastest movement in the game.

| piece | file | what it does |
|---|---|---|
| `CR_T.ANCHOR` | cr-core.js | a ring bolted to an overhang. **Not solid** — you pass through it |
| `crFindAnchor` | cr-physics.js | the auto-aim |
| `crGrappleAttach` / `crGrappleRelease` | cr-physics.js | start and end a swing |
| `crGrappleStep` | cr-physics.js | the rope constraint |
| `crPlaceAnchors` | cr-level.js | puts rings over gaps |
| `crDrawRopes` | cr-render.js | the rope, and the ring you would get |

**The auto-aim does not pick the nearest ring.** It picks the one that throws
you *forward and up*, because that is what pressing the key meant — nobody fires
a grapple to go backwards. A ring behind you is rejected outright, above scores
better than level, distance is only a tie-break, and line of sight is checked so
you cannot grapple through the cliff. It runs every frame whether or not the key
is down, because **cr-render.js draws the ring you would get**: being able to see
the choice is what makes an automatic aim feel like yours rather than the game's.

**The reel-in is where the speed comes from.** A shortening rope on a swinging
body conserves angular momentum, so you accelerate as you rise — the same reason
a spinning skater pulls their arms in. Measured on a test swing: **141 px/s in,
334 px/s out**, nearly three times walking speed, for one keypress.

**Rings are always a shortcut, never the way through** (`crPlaceAnchors` runs
after `crThicken`, over gaps the routes already cross by other means). A player
who never touches `F` finishes exactly as before. That is the rule the chimneys
should follow and currently do not, and it is also why adding the grapple did
not move the bot finish rate (34% → 35%): the bots ignore the rings entirely and
are none the worse for it.

Two things worth knowing if you tune it:

- **`grappleRopeMin` is 46, not 34.** The ring is bolted to rock, so reeling in
  under a tile and a half swings you into the ceiling it hangs from.
- **The first placement rule put zero anchors on every level.** It asked for a
  cell with rock above and air below, which in a `crThicken`-ed world is almost
  nowhere — below any mass is a one-row corridor and below that is the next
  floor. A gap is the only place with genuine air under it, and the only place a
  swing is worth anything, so placement walks the gap's own columns.

---

## The fourth pass: bottlenecks, pads, checkpoints, art (2026-10-17)

The user's verdict after playing: *"95% of the game is walking in a straight
line… there needs to be more crossover and player interaction: people
dogpiling, sometimes bottlenecking into one location or two."*

**That diagnosis is structural and it was right.** The generator built four
private routes, one per lane, that only crossed by accident — four parallel
single-player games sharing a screen. Nobody is ever in your way and nothing is
ever contested, and no number of extra verbs fixes that, because the problem is
there is nothing to have a verb *at*.

**Bottlenecks (`crBuildGates` / `crEmitGate`).** The run is punctuated by a
short shared ledge that every route is routed through: a shaft is cut above it,
each lane walks off its own corridor and drops in, the four of you squeeze onto
the same ledge and shove each other (a standing body is now **shovable** rather
than immovable — an immovable one deadlocks a queue). Between gates each lane is
pushed toward a *different* technique (`w.prefer`), so you and your neighbour
take different kinds of route to the same place.

**Jump pads replace the chevron pickup.** A pad is a *place*: take it and it
goes dark for `CR_PAD_RECHARGE` seconds, then lights again. Places can be
queued for and taken from under somebody; a consumable cannot. The free air jump
added in the third pass is **gone**, at the user's call.

**Checkpoints (`crSetCheckpoint`, `Q`).** Set one on any solid ground, any time,
free and re-settable. Dying returns you there instead of ending your run —
*unless the avalanche has already passed it*, which is what keeps it honest: the
question becomes "is it still worth going back for".

**Art.** The avalanche is boulders of wildly different sizes (two or three
overlapping rects each, so the silhouette is irregular), tumbling on their own
clocks, with a stepped-alpha dust front that reaches *past* the kill line. The
outposts are rebuilt from the user's reference: concrete rather than rock, with
its own palette, banded ribbon glazing per storey, an inset drum top floor under
a railed roof deck, a truss under every catwalk, struts into the mountain, and
moss on every ledge.

### What this cost, stated plainly

**The bottlenecks took the bot finish rate from 53% to ~34%**, and the mechanism
is only half understood. What is known:

- deaths are now almost entirely the avalanche, with falls near zero;
- 196 of 196 dead bots had been **wedged somewhere for over three seconds**;
- stalls cluster at the gate and in the ten columns before it;
- `crVerifyRoutes` went from ~13 flaws over eighty levels to **512**, because
  four lanes each built their own convergence staircase over the same fourteen
  columns at four different heights and landed in each other's body rows.

Five things were tried and recorded in the code where they happened: constrain
the gate rows to short hops; make the approach a cheap staircase; have the gate
bridge its own approach (a genuine re-run of the original band-clamp bug); slow
the scroll to pay for the climbing; make standing bodies shovable. Each helped a
little. Replacing the staircases with a **drop-in shaft** helped most, and
moving the ledge from the cliff bottom to mid-height helped again — a low gate
makes the drop free and the climb out enormous.

**The remaining ~19 points are not diagnosed.** This is the first thing to pick
up, and the measurement to start from is `scripts/cliff-run-playtest.js` plus the
stall-location probe described above.

---

## Where it stood after the third pass (before bottlenecks)

```
node scripts/cliff-run-playtest.js            # per-level
node scripts/cliff-run-playtest.js run 20     # full ten-level runs
```

| | |
|---|---|
| a bot clears all ten levels | **20%** of seeds; mean **6.4** levels reached |
| mean bot finish, per level | **53%** (bar: 50%) — pass |
| level 10, any bot out | **80%** (bar: 80%) — pass |
| worst level, any bot out | **70%** (bar: 90%) — **fail** |

Two of three bars pass, up from 17% / 50% / 75% before this pass. The third is
left failing rather than moved.

**The remaining problem has a name and a measurement: bots get WEDGED.** 168 of
168 dead bots had been stuck somewhere for over three seconds — not outpaced,
not falling, stuck. `crVerifyRoutes` reports the likely cause as "roof over a
jump" on most levels, and the note in that function explains why the two obvious
fixes both made the game *worse* (50% → 44%): the cliff is already nearly full,
so a bigger reservation pushes the generator into forcing corridors, which costs
more than the roofs do. **The fix is more room for the generator, not a bigger
reservation.**

**Still not played by a human.** Headless runs prove it runs, not that it is fun
(`SCOPE_RULES.md` rule 5).

> **The in-app browser throttles `requestAnimationFrame` to ~1fps** even with
> the pane visible, so the game looks frozen there while being perfectly healthy
> (`crRender` 0.51ms, a fixed step 0.07ms). Drive it with `crStep(CR_STEP)` in a
> loop from the console then `crRender()`, or test headless. To judge the art,
> set `#game`'s CSS width to 960px first.

---

## Verify before calling a phase done

From the repo root:

```
node scripts/check-global-collisions.js   # OK: cliff-run.html, 15 local scripts
node scripts/check-undefined-globals.js   # OK: no unresolved global references
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
node scripts/cliff-run-playtest.js
```

Plus: serve it over http and play it (a `file://` page renders in the in-app browser as a static
snapshot with scripts disabled, so it cannot show that the game *runs*), and double-click it once
to prove the `file://` constraint holds.
