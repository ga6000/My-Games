# Zombie — design ideas, second pass: the evacuation train and the sector campaign

**Written 2026-09-24. Status: analysis and proposal. Nothing here is built, and not all of it
should be.** The ideas themselves are filed as **59–67 in `DESIGN_IDEAS.md` Part 7**; this document
is the argument behind them — what the proposal is right about, where it collides with code that
already exists and was already playtested, and what I would actually build.

The proposal it responds to is the user's, written the same day: reorganise the game around a
**long-horizon causal chain** — *prepare → activate → transport → assemble → depart → reach the next
sector* — with an **evacuation train** as the physical object that chain is about, and the current
map demoted from "the map" to **SECTOR 01**.

> **Read `ENDGAME_PLAN.md` and `CLAUDE.md` "The Blood Silo endgame" before this.** Most of the
> proposal's step 1 is already running code. Knowing exactly how much is the difference between a
> re-skin and a rebuild, and it is most of what this document is for.

---

## 0. The verdict up front

| | |
|---|---|
| **The diagnosis is right** | The game has a causal chain and refuses to say so. Players are asked to read it off a checkbox list in an ESC dialog. |
| **The premise is half wrong** | "Survive → fill silos → eventually escape" is not what the code does. The code already does *generator → gate → silo → silo → silo → flood → gate → out*, with hard dependencies, live progress, and a NEXT goal on the HUD. The chain exists; its **fiction** doesn't. |
| **The cheapest 80%** | Is **naming and staging**, not new systems. The train can be the *terminus* of the existing chain without a single new resource. |
| **The expensive 20%** | ~~Is a physically moving train and a second map. One fights the flow field~~ — **corrected 2026-09-25: the moving train is cheap** (§3.1, and `TRAIN_RAIL_PLAN.md`). What is expensive is the second map, and the **rail graph** the train needs: the sidings on this map are not connected to the line. |
| **The part I'd reject outright** | Re-purposing all nine sectors as train jobs. That deletes the economy the map was shaped around. |

**The one sentence I'd keep from the proposal verbatim:** *every major combat encounter should
advance the team's ability to leave the sector.* That is a good rule and the game already half
obeys it. The rest is about how much machinery it's worth building to say so out loud.

---

## 1. What is actually there right now

This matters more than any other section, because the proposal's §3, §4, §14 and §22 describe
things that are running.

### 1.1 The chain, as implemented

`zombie-endgame.js`, with the goal list in `zombie-render.js:354` (`mapGoals()`):

```
                       +-----------------------+
                       |  START THE GENERATOR  |   <- gates the lights and every perk station
                       +-----------+-----------+       (a Blackout un-ticks it, mid-run)
                                   |
                       +-----------v-----------+
                       |  OPEN THE SLUICE GATE |   <- TWO players, TWO consecutive locks
                       +-----------+-----------+       (2nd is 1.6x longer; release drains)
                                   |
      +----------------------------v----------------------------+
      |  FILL SILO 1  ->  THROW ITS SWITCH  -> opens FUNNEL 2    |   12 kills, in the sluice room
      |  FILL SILO 2  ->  THROW ITS SWITCH  -> opens FUNNEL 3    |   24 kills, in a funnel hall
      |  FILL SILO 3  ->  THROW ITS SWITCH  -> THE FLOOD         |   36 kills, in a funnel hall
      +----------------------------+----------------------------+
             (only kills ON the active funnel ring count)
                                   |
                       +-----------v-----------+
                       |    SURVIVE THE FLOOD  |   <- bypasses the zone-cooldown spawn rules,
                       +-----------+-----------+      comes off all four map edges at once
                                   |
                       +-----------v-----------+
                       |   REACH THE SOUTH GATE|   <- heavy slab grinds up over 90s behind a
                       +-----------+-----------+      chainlink gate that flies open at the end
                                   |
                              [ YOU GOT OUT ]        <- a 2.6s staged walk-out, not a frame
```

Every box is **live, host-authoritative, on the wire** (`gs gp fa sf sx fl ea wn` in the world
snapshot), ticked from state rather than from order, and it survives a host migration.

### 1.2 The HUD the proposal asks for, as it exists today

The proposal's §14 asks for state + dependency instead of `FUEL SILOS: 2/3`. That is what the ESC
dialog already prints — this is real output, not a mock:

```
  MISSION                                                      [ESC]
  GOALS
  [x] START THE GENERATOR - TURBINE HALL
      lights the map and powers the perk stations
  [x] OPEN THE SLUICE GATE - THE SLUICE YARD
      two players, one on each plate, through two locks
  [x] FILL SILO 1 AND THROW ITS SWITCH - THE SLUICE YARD (the sluice room)
      kill zombies standing ON funnel 1
  [>] FILL SILO 2 AND THROW ITS SWITCH - COLD STORAGE          14/24
      kill zombies standing ON funnel 2
  [ ] FILL SILO 3 AND THROW ITS SWITCH - THE SPILLWAY
  [ ] SURVIVE THE FLOOD
  [ ] REACH THE SOUTH GATE - THE SLUICE YARD
      it opens slowly once the flood is over

  The sluice gate needs TWO PLAYERS. Alone, a run is survival until you go down.
```

...and above the minimap, while it is up: `NEXT: FILL SILO 2 - COLD STORAGE`.

**So the proposal's P0 ("clarify the objective, show the complete chain") is about 80% done.** What
is missing is not the list. What is missing is:

1. **It is behind ESC.** A player who never presses ESC never sees a chain at all.
2. **Nothing in the world says why.** A silo is a tank that fills when you kill things near it. It
   is not visibly *for* anything.
3. **The fiction is "blood into tanks."** There is no stated reason the team wants three full
   silos, so the chain has dependencies but no *purpose*. This is the proposal's real target and
   it is correct.

### 1.3 The rail, as implemented

Also real, also recent (`buildRailSpur`, `zombie-level.js:2043`; track art `drawRailTracks`,
`zombie-render.js:1400`):

```
   col:  0    4    8    12   16   20   23
        +---------------------------------+
   row 0|  SPILLWAY | COLD ST | KEN |YARD |
        |           |         |  ===O=====|=====>  leg A: y 920-1040, east
   row 6|           | TURBINE |     |    ||        out of the Kennels' neck,
   row 8|           |  BLOCK  | PUMP|    ||        under the Yard's crane
   row12|  SLUICE   |     |  MOTOR POOL  ||
   row14|                   |            ||   leg B: x 4600-4720, south
   row17|        [ESCAPE]   |           _||_  down the Yard's tail into
        +--------------------------------++-  the MOTOR POOL
                                          ^
                                          the line ENDS at y 2660.
                                          The south perimeter wall is at
                                          y 2680. IT DEAD-ENDS 20px FROM
                                          THE WALL, in the south-east corner.
```

**That last fact is the most useful thing in this document.** The proposal's §9 ("move the
departure point to the south-east and have the tracks lead to it") is *already true of the
geometry*. The line runs Kennels → Yard → Motor Pool and stops dead against the southern perimeter
wall in the south-east corner. Nobody planned that as an exit; it fell out of "run the leg deep
enough into the Motor Pool that a flatcar can stand on it."

There is rolling stock on it already: `railStock()` puts 190x54 cars along both legs, and
`buildKennels` puts more on their own sidings.

### 1.4 What the game does NOT have, that the proposal assumes

| Proposal assumes | Reality |
|---|---|
| A train | Railcars are **walls**. Static solid rects with art. No locomotive exists. |
| Fuel | There is no resource but **scrap** (shared, spent on doors/guns/perks/traps). Silos count **kills**, not a substance. |
| Anything that moves | Every solid in the map is static. See §3.1 — this is the hard one. |
| A second map | `generateLevel()` re-rolls interiors from a seed. There is **one sector skeleton**, hand-painted into `ZONE_PAINT`, and it is the same nine sectors every run. |
| Run-to-run persistence | None. No `localStorage` for the run; the score posts to a leaderboard and that is all. |
| Classes with jobs | Four roles, **four passives**, no verbs. The proposal's §8 is correct that this is the weakest system in the game. |

---

## 2. The strongest claim, tested

> *"The player still lacks a strong long-horizon causal chain that answers: why are we doing all of
> this, and what are we building toward?"*

**Half right, and the half that's wrong is worth knowing.** There *is* a long-horizon chain. What
is missing is a *referent* — a thing in the world the chain is obviously about.

Compare the two systems the game already has:

| | THE GENERATOR | THE SILOS |
|---|---|---|
| What it asks | walk to it, hold it | kill 12/24/36 zombies on a ring |
| What it gives | **the lights come on** | a switch unlocks |
| Does anyone ask why? | No. You can see it. | **Yes, constantly.** |

The generator needs no mission dialog, no NEXT label and no checkbox. It is self-explaining because
its effect is the world changing in front of you. The silos need all three and are still opaque,
because their effect is *another silo opening somewhere else*.

**That is the actual defect, and the proposal's diagnosis of it is the best thing in it.** The
chain is legible as a *list* and illegible as a *place*. A train fixes that — not because a train
is a better objective than a silo, but because a train is a **visible thing that is obviously not
ready and obviously getting readier**.

### The counter-angle worth stating

Two arguments against going further than that:

1. **"Why continue?" may not be the group's actual problem.** This is a ~3-10 person friend group
   playing browser prototypes. The proposal's §20 assumes the failure mode is *motivation decay
   after the novelty wears off*. The repo's own evidence says the failure modes so far have been
   **legibility** ("what am I supposed to be doing"), **map quality** (`MAP_VISUAL_AUDIT.md`), and
   **solo dead-ends** (the gate needs two players). None of those is fixed by a longer chain, and
   two of them are made *worse* by one.
2. **A campaign is a commitment to content.** Sector 02 is not a feature, it's a second map — and
   `MAP_VISUAL_AUDIT.md` found the *first* map is placing 5.3 buildings against a target of 49,
   with 95% of them open-cornered. `LEVEL_BUILDER_PLAN.md` exists because the answer is to
   hand-author. Committing to "reach the next sector" as the game's premise commits to
   hand-authoring N maps before the premise pays off even once.

So: take the causal hierarchy. Be very careful about taking the campaign.

---

## 3. Where the proposal collides with the code

Eight collisions, each with a verdict. These are the "what would need rethought" list.

### 3.1 A moving train fights the flow field — ~~the hard one~~ **WRONG, corrected 2026-09-25**

> **This section was wrong as first written.** It concluded that a moving solid costs ~14ms a frame
> and that incremental nav updates were an `L`-effort engine project. Both are false:
> **`refreshNavRegion()` already exists** (`zombie-level.js:415`), built for door purchases, and it
> patches only the cells around one rect. Measured through the real generator on 2026-09-25, a
> mover costs **under 1ms a frame in the browser** — a patch is ~0.19ms (of which only 0.06ms is
> cell work) and one BFS is ~0.27ms over all 32,400 cells. The ~14ms figure is the *full* rebuild,
> which a mover never needs to pay.
>
> **Pathfinding is therefore not the obstacle to a rideable train.** The real constraints are a
> ~90px/s speed cap (so the train stays inside one nav cell per 220ms field refresh), keeping the
> cars out of `walls[]`, and never calling `markNavDirty()` — which would trigger the full rebuild
> *and* up to three BFS fields every frame.
>
> The full measurements, the evaluation of the "gated hybrid" flow-field proposal, and the
> architecture that replaced this section are in **`zombie/TRAIN_RAIL_PLAN.md` (2026-09-25)**.
> The original reasoning is left below because option A — a static train that moves only in a
> scripted departure — is still what gets built first; it is now **phase one of the same system**
> rather than a way of avoiding it.

The proposal's §10 and §19 both need the train to **physically move**. The engine cannot currently
have a moving solid, and the reason is measured:

- Zombies navigate a **BFS flow field** over a 240x135 grid of 20px nav cells
  (`rebuildNavGrid`, `zombie-level.js:668`).
- A cell is passable only if nothing solid touches it *padded by `NAV_PAD` (19px)*. The whole cell
  is tested, not its centre — because centre-testing made 20px walls invisible and flowed zombies
  straight through masonry.
- **Rebuilding is expensive enough that the code goes out of its way to avoid it.** Barricades were
  deliberately made permanently passable in the field precisely so a window breaking never dirties
  nav: *"Rebuilding on every barricade hit cost a ~14ms hitch mid-fight, which is most of a frame
  at 60fps"* (`zombie-level.js:656`). Only a **door** opening can change nav passability, and
  `navDoorSig` exists solely to keep that cheap.

A 190x54 railcar sliding along a track is a solid changing cells **every frame**. That is a
~14ms rebuild per frame, on the host, which also owns every zombie, every bullet and
`broadcastWorld`. It would not be a slow train; it would be a frozen room for every guest — the
exact failure mode `check-undefined-globals.js` was written after (`relocateZombie` throwing out of
`updateZombies` and silently killing `broadcastWorld` while the host kept drawing).

**Three ways out, in order of cost:**

| Option | How | Cost |
|---|---|---|
| **A. The train moves only at the very end** | Departure is a scripted sequence like `triggerWin()` already is. Zombies during it are spawned and steered by the *sequence*, not the field; the train's solid is added to `walls` once, at rest, before it starts. | **S.** Reuses the win-sequence pattern exactly. |
| **B. The train is never a solid** | It is drawn, it is an `F` target, players walk over it (like a funnel ring, which is floor). Nothing about nav changes. | **XS**, and it costs the "climb aboard" feeling. |
| **C. Moving solids properly** | Incremental nav updates: re-test only the cells the mover vacated/occupied. Genuinely doable (the grid is a flat `Uint8Array`) but it also needs the BFS re-run, which is the other half of the cost. | **L**, and it is engine work, not design work. |

**Verdict: A.** The train should be static for the whole run and move only during a departure
sequence that owns the frame. That is *also* the better set piece — a train that has been sitting
there inert for forty minutes and then starts is worth more than one that shuttles.

This also kills **idea 58 (the rideable railcar, Transit's bus)** as written. Noted in
`DESIGN_IDEAS.md` Part 6 E on 2026-09-24, superseded here the same day: a vehicle that runs
continuously on its own schedule is option C, and option C is an engine project.

### 3.2 The escape is in the wrong corner for a train

The proposal wants the departure point in the south-east. Here is where the pieces actually sit:

```
  ZONE_PAINT, 24 x 18 cells of 200 x 150
   row  0 SSSSSSCCCCCCCCKKKKYYYYYY
        1 SSSSSSCCCCCCCCKKKKYYYYYY
        2 SSSSSSCCCCCCCCKKKKYYYYYY
        3 SSSSSSSSCCCCKKKKKKYYYYYY
        4 SSSSSSCCCCCCCCKKKKYYYYYY
        5 SSSSSSCCCCCCCCKKKKYYYYYY
        6 SSSSTTTTTTBBBBBBKK=====R   <- leg A of the rail, east
        7 SSSSTTTTBBBBBBBBKKYYYY|
        8 SSSSTTTTBBBBBBBBPPPPYY|
        9 SSSSTTTTBBBBBBBBPPPPPP|    <- leg B, south, x 4600-4720
       10 SSSSTTTTTTBBBBBBPPPPPP|
       11 SSSSSSTTTTTTBBBBPPPPPP|
       12 SSSSSSLLLLLLLLMMMMMMMM|
       13 SSSSSS[]LLLLLLMMMMMMMM|       [] = THE SLUICE (fixed, x 2170-2630)
       14 LLLLLL[]LLLLLLMMMMMMMM|
       15 LLLLLLLLLLLLLLMMMMMMMM|
       16 LLLLLLLLLLLLLLMMMMMMMM|
       17 LLLLLLLLLLLL^LMMMMMMMM|
          ============|==========+     south perimeter wall, y 2680
                      ^          ^
                      |          the rail DEAD-ENDS here, y 2660,
                      |          20px short of the wall.
                      the ESCAPE, x 2310-2490. 2,170px west of the rail head.
```

So today: **the sluice is south-centre, the escape is directly below it, and the rail head is
2,170px away in the opposite corner.** The escape's whole design is "dead south of the sluice" —
that's the comment in `zombie-level.js:3399`, and it's why the sluice is at fixed rather than
seeded coordinates.

Moving the exit to the rail head means:

- `buildEscapeOpening()` moves, and with it the **culvert exclusion** around it.
- The south-east corner is **deliberately sealed**: `PERIM_CORNER_CLEAR` (700px) keeps culverts
  away from it, added 2026-09-20 after *"zombies wedging while pathing round the south-east hard
  corner, and the openings there making the area undefendable."* A departure set piece in that
  corner is a large fight in the one place the map was specifically closed because fights there
  went badly. That's not fatal — a gate that opens once is not a culvert, and a sealed corner is a
  *good* place to be cornered on purpose — but it must be entered knowingly.
- The walk from the last silo to the exit gets much longer and crosses ring-2 ground (THE YARD is
  ring 2 since the Kennels' tail severed the Yard↔Blockhouse adjacency; the rocket already costs
  10,350 in doors to reach).

**Verdict: worth doing, and cheaper than it looks, but it is a real geometry change with three
knock-on systems.** Not a P2 "move the rail line" — a P2 "move the exit to where the rail already
ends."

### 3.3 Silo → pipe → railcar re-separates what a playtest deliberately joined

The proposal's §4 wants `SILO → PIPE → RAILCAR`, with the railcar's gauge visibly rising as the
silo fills. The map already has `SILO → PIPE → FUNNEL`, and it got that way **by request, from a
playtest**:

> *"The old layout put every silo in a different zone from its funnel on purpose, 'a journey rather
> than a button next to you'; the playtest found the connection between the two unreadable, and
> asked for them side by side."* — `zombie-endgame.js:14`

The pipe art (`siloPipes`, `pipeBetween`) exists and carries animated blood while its funnel is
live. The silo already has a label that knows which wall it's against.

So there are two pipes wanted from one tank, and the second one is 2,000px long and crosses four
sectors. **Drawing a full-length pipe run from each silo to the rail head is not viable** — it
would cross the funnel halls, the container maze, the keep and the sluice reserve, and the map has
no notion of a decorative solid that other placement respects.

**Verdict: don't run the pipe. Run the *signal*.** Options that get the causal read without the
geometry:

- A **short pipe stub** leaving each silo toward the rail head, going into the floor, with a
  matching stub surfacing at the train. Two 80px pieces of art, not a 2,000px run. This is the
  standard trick and it works.
- The **minimap draws the link**: a thin line silo → train, lit while that silo is transferring.
  Costs nothing; the minimap already draws landmark glyphs.
- **The train's own gauge is the readout.** Three tanks on the locomotive, one per silo, each
  filling as its silo does. You learn the causal chain by looking at the train, once.

### 3.4 "Three silos, three different problems" fights how halls are built

The proposal's §5 is good design and I want it. The obstacle: funnels 2 and 3 live in **funnel
halls**, and a hall is a deliberately uniform object — `HALL_LEN` 560, `HALL_WID` 280, both ends
pinched to exactly `HALL_DOOR` 140 by `addHallPinches`, placed *first* in their zones so everything
routes around them. Swept over 200 seeds: 400 halls, all 800 ends measure exactly 140px.

They are identical by construction, and that uniformity is load-bearing — it's what guarantees the
nav clearance and what makes a hall read as a room rather than a tube.

**Verdict: buy the variation from placement rules, not from new mechanics.** `planFunnelHalls`
already picks zones (never the centre zone, never the sluice's, corridor zones last). Give each
silo index a *different* placement rule and a different escalation:

| | today | proposed |
|---|---|---|
| Silo 1 | sluice room, 12 kills | unchanged — it is the tutorial |
| Silo 2 | random hall, 24 kills | a hall in a **ring-1 sector behind a bought door**; small local horde on activation |
| Silo 3 | random hall, 36 kills | a hall in a **ring-2 sector** (Yard or Spillway); activation summons a named heavy, and the hall's ends are barricaded and must be broken open |

That is placement-constraint work plus one spawn rule. It does not need a new resource, a new
interaction verb, or a change to the hall geometry.

### 3.5 Nine sectors as nine train jobs deletes the economy

The proposal's §16 gives each sector a job in the train chain (Kennels = fuel, Depot = assembly,
Maintenance = repair, Yard = clear obstruction, Control = open the gate…).

The map does not work that way, and the reason is economic rather than thematic. Sectors are on
**rings** priced outward from spawn, and their *stock* is the reason to travel:

| Sector | ring | what it sells | why you go |
|---|---|---|---|
| THE YARD | 2 | ROCKET + 2 stations | the 10,350-scrap trip |
| THE MOTOR POOL | 1 | 2 stations | perks |
| COLD STORAGE / KENNELS / SPILLWAY | 1 / 1 / 2 | RIFLE / SHOTGUN / SNIPER | one gun each |
| PUMP HOUSE | 1 | FLAMETHROWER + 1 station | fire and blast perks live here |
| TURBINE HALL | 1 | OVERDRIVE, always | the generator is here |
| THE SLUICE YARD | 1 | SMG | you learn the escape ground early |
| THE BLOCKHOUSE | 0 | nothing | it's the keep — spawn |

Three of those placements were **moved on 2026-09-20 from a measured asymmetry** (east half held 3
guns and 4 perks against west/south's 1 and 1). Assigning each sector a mandatory train job on top
means either (a) the objective route and the shopping route disagree and players do both, doubling
traversal, or (b) they agree, and the doors stop being a choice — which is the "buy outward"
economy, deleted.

**Verdict: reject as written. Take the weaker, better version:** the chain should *pass through*
2–3 named sectors and give them a reason to be remembered, not conscript all nine. Three silos in
three different rings already does most of this (§3.4).

### 3.6 Cross-sector persistence has nowhere to live

The proposal's §23 — carry 3 railcars, 85% fuel, the Engineer, into Sector 02 — needs run state to
survive a map change. Three obstacles, in ascending order:

1. **`generateLevel()` clears everything**, including the whole endgame chain. There is already a
   scar about this: the 2026-09-07 **mid-game map wipe**, where an unguarded reseed on a reconnect
   wiped ten rounds of opened doors mid-fight. The guard is `if (gameStarted) { MP.reseed(levelSeed); return; }`. A deliberate mid-run map change has to thread that needle on purpose.
2. **Who carries it?** The host owns the world, and **any client can become the host** on a
   migration. Carry-over state must ride the snapshot, not the host's memory — same discipline as
   `escapeAt` crossing as a *remaining duration* rather than a timestamp.
3. **Who is even here?** "One player dead → they start Sector 02 without their loadout" assumes a
   stable roster. The net layer's whole design assumes the opposite: peers go **AWAY**, not
   deleted; a socket id is re-rolled on every reconnect, which is why roles hash the per-tab
   `netToken` instead. Persistence keyed to a player has to key to `netToken`, and a player who
   refreshes their tab is a new person.

**Verdict: defer, and if it's ever built, key it to `netToken` and put it on the wire.** None of
this is impossible. All of it is a second project.

### 3.7 The checklist trap is real, and the game is already partly in it

The proposal's §17 warns against a co-op fetch quest simulator and is right to. Worth saying
plainly: **the existing chain already has this problem in two places.**

- *"Kill 12 zombies standing on this ring"* is a number going up. What saves it is the **funnel**:
  a ring on the floor in a pinched hall, which changes *where* you fight. That is the mechanic
  doing the work, not the count.
- *"Walk to the generator and hold it"* is a fetch quest. What saves it is that the lights come on.

The proposal's own fix is the right one and should be stated as a **rule for this pass**:

> **An objective must change what players are doing to each other, or change the world visibly.
> A counter that goes up is neither.**

Measured against that rule, the proposal's own steps score unevenly:

| Proposed step | Changes what players do to each other? | Verdict |
|---|---|---|
| Fuel a silo under a 90s horde | Yes — someone holds, someone defends | **keep** |
| Operate a switch while others protect | Yes | **keep** |
| Couple the train while the yard is held | Yes | **keep** |
| Two generators on opposite sides, simultaneously | Yes — and it is **already built** (the sluice gate's two plates) | **already have it; don't build a second one** |
| "Load the railcars" | No — it's a transfer that happens on its own | **cut or fold into the silo step** |
| "Clear the track with a rocket" | Only if the obstruction fights back | **needs a reason, see §3.8** |

### 3.8 Weapons and classes as objective verbs — the good idea with the smallest blast radius

The proposal's §7 and §8 are, to me, the most valuable part of the whole document after the
naming, and the cheapest.

Right now every role is a **passive multiplier**: MEDIC 40% faster revives, ENGINEER 40% cheaper
traps, SCOUT +10% speed, GUNNER +15% damage. Nobody has ever said *"we need an Engineer for this"*,
because there is nothing an Engineer can do that a Gunner can't do slower.

The chain has exactly the right shape to fix this, and it needs no new systems — the `F`
interaction seam and the host-validated buy seam (`requestBuy` → `hostHandleBuy`) already exist and
are already used by the generator, the silo switches, the field manual and the horde switch.

```
  THE COUPLING                 THE JAMMED SWITCH            THE NEST
  [locomotive]==?==[car]       rail points, seized          infected growth on the track
       |                              |                             |
   ENGINEER: 4s hold             ROCKET: one shot              FLAMETHROWER: burn it
   anyone else: 12s              anyone else: 40s of           anyone else: cannot
                                 melee-range chipping          be cleared at all
```

The shape to aim for is **"faster / possible at all" rather than "only the Engineer"** — the game
has *randomly assigned* roles (`roleForId`, hashed from `netToken`), so a lobby can legitimately
contain zero Engineers. Any step that hard-requires a role is a run that cannot be finished, which
is the mistake the two-player gate already makes for solo players (§3.9).

Exception worth making once: **one** step that a role does *instantly* and everyone else does
slowly and loudly is exactly the "we need an Engineer" moment, with no dead run attached.

### 3.9 The longer the chain, the deader solo play gets

Already a documented known gap: *"A solo player cannot finish a run."* The sluice gate needs two
players, so the entire Blood Silo chain — the only win state — is unreachable alone. That is the
deliberate point of idea 57, but it means a solo session is survival-until-death.

Every step the proposal adds is another step a solo player will never see. If the campaign is
adopted, the solo experience becomes *"you cannot play the game, you can only play round 1–20 of
the thing that used to be the game."*

**Verdict: if the chain gets longer, solo needs an answer in the same pass.** The cheapest is a
`?solo=1`-style flag that makes the two-plate gate a single long hold — the flag already exists for
keeping MP off the live server.

---

## 4. What I would actually build

Five steps. The first two are most of the value and cost about one session each.

### P0 — Name the chain. Change the fiction, not the code.

The chain exists. Give it a subject.

```
  BEFORE                                  AFTER
  MISSION                                 SECTOR 01 - THE SLUICE YARD
  GOALS                                   EVACUATION TRAIN - NOT READY
  [x] START THE GENERATOR                 [x] POWER THE YARD          TURBINE HALL
  [x] OPEN THE SLUICE GATE                [x] OPEN THE SLUICE GATE    two players, two locks
  [x] FILL SILO 1 AND THROW ITS SWITCH    [x] CHARGE TANK 1           sluice room
  [>] FILL SILO 2 AND THROW ITS SWITCH    [>] CHARGE TANK 2    14/24  COLD STORAGE
  [ ] FILL SILO 3 AND THROW ITS SWITCH    [ ] CHARGE TANK 3           THE SPILLWAY
  [ ] SURVIVE THE FLOOD                   [ ] SURVIVE THE FLOOD
  [ ] REACH THE SOUTH GATE                [ ] BOARD THE TRAIN         THE MOTOR POOL
                                          NEXT: CHARGE TANK 2 - COLD STORAGE
```

Plus three things the list cannot do:

1. **Put the chain on screen without ESC.** Not the whole list — the current step, the one after
   it, and the count. It already computes; `nextGoal()` returns it.
2. **Say it once, at the start.** A short card on round 1: *RESTORE THE EVACUATION TRAIN.* The
   round card, the win card and the horde call all already do exactly this kind of overlay.
3. **Make the train exist from minute one.** Static, dark, unpowered, at the rail head. Three
   empty tanks on it. That is the referent the chain has never had, and it costs one new art
   function plus a rect.

**Cost: S. Touches `mapGoals()` strings, one overlay, one draw function, one static solid.**
No new state, no new wire fields, no nav change.

### P1 — Make the departure a playable event

Today: the flood clears, a slab grinds up for 90s behind a chainlink gate, you walk into it and a
2.6s sequence plays. The proposal's §19 is right that this is the climax and is currently a door.

```
  third tank full
        |
        v
  THE FLOOD  (unchanged - all four edges, ignores zone cooldowns)
        |
        v
  THE ENGINE TURNS OVER
   - the locomotive's lights come on. The map's ambient changes.
   - the train horn. (Non-positional, like the siren - it is coming from everywhere.)
   - the SE gate begins grinding open. 90s, unchanged, but now you can SEE what it is for.
        |
        v
  BOARDING WINDOW  (the new part)
   - everyone must reach the rail head. The horde does not stop.
   - a player ON the train is safe; a player not on it is not.
   - the train leaves when everyone aboard, or on a timer.
        |
        v
  DEPARTURE  (scripted, owns the frame - see 3.1 option A)
   - the train pulls out. Zombies come off the flanks.
   - 30-60s of defending a moving object, with the camera locked to it.
        |
        v
  SECTOR 01 CLEARED        or        TRAIN LOST
```

The **boarding window** is the piece that pays for itself: it reproduces Transit's real tension
(being caught out when the bus leaves) *without* a vehicle that moves during play, and it is the
only moment in this game where the team's positions relative to each other matter absolutely.

**The departure sequence is `triggerWin()` grown up.** That machinery already exists and its
discipline is documented: local per client, driven from `gameLoop` not `update()` (so a connection
drop mid-sequence cannot freeze the world half-faded), input and gameplay sound dead for the
duration, the player drawn with an offset rather than moved. All of that carries over directly.

**Cost: M. One new phase in the endgame state machine, one wire flag, one scripted sequence.**

### P2 — Move the exit to the rail head

Per §3.2. `escapeRect` moves from x 2310 (south-centre) to the rail head at x ~4600. Knock-ons:
`buildEscapeOpening`, the culvert exclusion, `PERIM_CORNER_CLEAR`, and the sluice's "dead south of
the sluice" comment stops being true.

The gain: the rail line becomes a **route sign**. Anywhere on the map you can see track, the track
points at the way out. That is environmental storytelling for free, on geometry that is already
drawn.

**Do P2 with P1 or not at all** — a departure sequence at the old exit, with the train 2,170px
away, is worse than either.

**Cost: S-M, and it moves every seed's layout, so re-run `scripts/check-map-features.js` before and
after.**

### P3 — Three silos, three problems (§3.4), and objective verbs (§3.8)

Placement constraints per silo index, plus 2–3 interactions that a class or a weapon does faster.
This is where the game gets *deeper* rather than clearer, and it should come after the clarity
work, because it is much easier to judge once the chain has a subject.

**Cost: M.**

### P4 — Sector 02. Last, and probably not what it sounds like.

A second sector is a second map. Before committing:

- `LEVEL_BUILDER_PLAN.md` phases 1-3 (~3-4 sessions) hand over building authoring.
- `MAP_VISUAL_AUDIT.md` §4 art direction is **undecided** — the user declined the FAITH palette
  change on 2026-09-24 and tabled the ordering question. A restyle before the builder was the
  recommendation, and both sit in front of any second map.
- Phase 4 (full sector authoring) is "L, 3+ sessions, and it depends on the design talk."

**The cheap version that gets 70% of the feeling:** `SECTOR 01 CLEARED` → the train arrives at a
sector that is **the same skeleton, reseeded, harder, and renamed**, carrying your loadout, your
round number and your scrap. `MP.reseed()` makes it trivial and the repo already does this for the
daily-seed idea (52). It is honest about being a variation, it costs a fraction of a new map, and
it tells you whether "reach the next sector" is actually motivating *before* anyone authors a
second map.

**If that lands, author Sector 02 properly. If it doesn't, you've saved 3+ sessions.**

---

## 5. What I would leave

| Proposal item | Why not |
|---|---|
| **Fuel as a resource** (§4, §6, §23) | The game has one currency. A second one that is only spent on one thing is a counter with a costume. The silos already count; call the count fuel and move on. |
| **Nine sectors as nine train jobs** (§16) | Deletes the ring economy. See §3.5. |
| **Physically assembling the train from scattered cars** (§6) | Needs moving solids (§3.1) or the cars teleport, which reads as a bug. The *gauge* filling gives the same "we're getting closer" read for a tenth of the cost. |
| **A branching world map** (§13) | Two maps do not need a map screen. Revisit at four. |
| **Rounds as scripted story beats** (§12) | The round curve is tuned and measured (`budgetForRound`, the special-round divisors, `ultraOwed` from round 16). Hard-coding "round 8 = train event" re-times all of it. The weaker version is free and better: **the chain's own steps escalate**, and rounds keep doing what they do. |
| **Cross-sector persistence** (§23) | §3.6. Defer until there are two sectors to persist between. |
| **Idea 58, the rideable railcar** | Superseded by this pass. A continuously-running vehicle is §3.1 option C. |

---

## 6. Sequencing against the plans already open

> **SETTLED 2026-09-25 — the map comes first.** The user's call, citing §2's counter-angle
> directly: *"Let's proceed with prioritizing improving this map and its delivery first before
> adding content as these are the bones of everything future."*
>
> So the order below is superseded at the top: **`LEVEL_BUILDER_PLAN.md` phases 1–3 and the
> `MAP_VISUAL_AUDIT.md` §3 defect list come before P1–P4 of this pass.** The art-direction
> decision has to be taken first, because it decides whether the stamps are authored against
> textured per-sector surfaces or white line work.
>
> **P0 survives the reprioritisation and should still be done early**, because it is "delivery"
> rather than content: it is strings, one overlay and one static solid, it touches neither the
> generator nor the palette, and the legibility problem it fixes is one of the three failure modes
> §2 names. Everything from P1 down waits.

Three plans are live and this pass has to fit around them, not through them:

```
  now
   |
   +-- [undecided] art direction        MAP_VISUAL_AUDIT.md §4   user declined 2026-09-24,
   |                                                             ordering tabled
   +-- [planned]   level builder P1-3   LEVEL_BUILDER_PLAN.md    ~3-4 sessions, hand-over point
   |
   +-- [proposed]  THIS PASS
         |
         P0  name the chain + the train exists .... S   <- independent of both. Do it whenever.
         P1  the departure as an event ............ M   <- independent of both.
         P2  exit to the rail head ................ S-M <- moves seeds; before the builder is easier
         P3  three problems + objective verbs ..... M
         P4  sector 02 ............................ L   <- AFTER the builder and the art call
```

**P0 and P1 do not touch the map generator or the renderer's palette.** They are the parts of this
proposal that can be built today without pre-empting either open decision, and they are also the
parts that test the premise. If naming the chain and staging the departure doesn't make the group
care about leaving, nothing downstream of it will.

---

## 7. The ideas, as filed

Entered in `DESIGN_IDEAS.md` **Part 7** as ideas **59–67**, in the numbering that file has used
since 2026-09-01:

| # | Idea | Verdict here |
|---|---|---|
| 59 | The evacuation train replaces the south gate | **build — P0/P2** |
| 60 | The departure as a playable event, not a cut | **build — P1** |
| 61 | Name the chain: EVACUATION, and put it on screen without ESC | **build — P0** |
| 62 | The train's tanks are the silo gauge; the causal link is signalled, not piped | **build — P0** |
| 63 | Three silos, three different spatial problems | **build — P3** |
| 64 | Objective verbs for the ENGINEER, the rocket and the flamethrower | **build — P3** |
| 65 | The sector campaign: SECTOR 01 → 02 | **defer — P4, and try the reseed version first** |
| 66 | What carries over between sectors | **defer — needs 65** |
| 67 | Rounds escalate against the chain rather than becoming it | **partial — the weak version only** |

---


## 8. Settled — the answers, 2026-09-25

The five open questions this document asked have been answered. Recorded here as decisions rather
than as options, with the consequence each one carries.

### 8.1 The train does **not** replace the south gate — it drives through a tunnel

> *"This should be a tunnel gate that opens slowly after train is started & concurrent horde event.
> Current game completion should work by successfully getting up-to speed (say 5x walking speed), &
> effectively fleeing the sector."*

So the 90s grind (`ESCAPE_OPEN_MS`) stays, and stops being a **wait** — it becomes the clock on a
fight. Three consequences:

1. **The win is a SPEED threshold, not a place.** ~5x walking speed ≈ **1,200px/s**. That is a much
   better climax than a traversal and it is self-limiting: the fight happens during
   **acceleration**, the threat is what is already aboard or boarding at low speed, and boarding
   gets harder the faster the train goes. Worth making explicit — above some speed, nothing boards.
2. **It needs very little track**, which is fortunate: the whole line is ~3,130px, so at 1,200px/s
   the run out is about two seconds. The content is the ramp, not the distance.
3. **`buildEscapeOpening` has to become a rail-sized tunnel mouth.** Today the escape is a
   person-width hole in the perimeter wall behind a slab, added because the win walk-out was
   flying over solid masonry. A locomotive does not fit through it.

### 8.2 Move the exit to the south-east corner, and the rail crosses buyable doors

Measured 2026-09-24/25, and the economy risk is not there:

- The rail crosses exactly two sector pairs — **KENNELS | YARD** and **YARD | MOTOR POOL** — on
  10/10 seeds.
- Both pairs **already carry a door and a window** on 10/10 seeds.
- Turning the rail gates into priced doors changes **no sector's depth and no door price on any
  seed**. `computeZoneDepth()` BFSes over door edges and those edges already exist, so **THE YARD
  stays ring 2 and the rocket stays at 10,350.**

**What actually changes is defensibility, not price:** those two boundary walls end up with *three*
openings (door + window + rail gate). A wall with three holes is not a wall you can hold. Decide it
deliberately — accept three, or let the rail gate *be* the door on those two boundaries.

The corner itself is the other cost: `PERIM_CORNER_CLEAR` (700px) deliberately seals the south-east
against culverts, added 2026-09-20 after *"zombies wedging while pathing round the south-east hard
corner, and the openings there making the area undefendable."* A gate that opens once is not a
culvert, so this is acceptable — but the climax fight now happens in the one corner the map was
closed because fights there went badly.

### 8.3 Class gating is a **time** gate, never a capability gate

> *"It should be a skill/time gate like engineer 4s to perform task & standard player 4x."*

So: **ENGINEER 4s, anyone else 16s.** No step in the chain is ever impossible for a team that rolled
no Engineer, which matters because roles are **hashed from `netToken`, not chosen** (`roleForId`) —
a three-player lobby can legitimately contain zero Engineers.

This closes the question §3.8 raised and it is the conservative answer: 16s under a horde is a real
cost and a real reason to want an Engineer, without a run ever being unwinnable at the moment the
roles were dealt. **A 4x multiplier is the pattern to reuse** for the rocket (instant vs. a long
manual clear) and the flamethrower (fast vs. slow), rather than inventing a different gate shape
per step.

### 8.4 Sector 02 — **not yet**, not even the cheap version

The reseed-variant test is not being taken up now. This follows from the map-first decision in §6:
a variation of a map whose buildings are 95% open-cornered tests nothing about whether "reach the
next place" is motivating. Revisit after the level builder.

### 8.5 Solo is fixed by **replacing the sluice plates with switches**

> *"Consider removal of standing pads to open sluice, and rather switches around the map in
> sensible locations considering ring economy; single player: 2 switches around map to open
> (simultaneous operation not required / switches stay down) [reuse horde switch]; multiplayer
> switch # = player count (same time pull required within x seconds, considering latency)."*

```
  TODAY                              PROPOSED
  two plates, 436px apart,           N switches, scattered by ring
  both HELD simultaneously,          SOLO:  2 switches, pull either order, they STAY DOWN
  two consecutive locks              TEAM:  one switch per player, all within X seconds
  -> impossible alone                -> possible alone, and a real co-ordination problem in a team
```

This **supersedes idea 57** (the two-player gate, "the only mechanic strictly impossible alone"),
deliberately, in exchange for solo play existing at all. Worth recording as a trade rather than a
fix: the game loses its single strongest statement that it is co-op, and gains a chain a lone player
can finish.

**Five things to settle before this is written**, all of them found in existing scars:

1. **Player count moves during a run.** `teamSize()` changes on joins, leaves and AWAY. If the
   switch count equals the player count, a join mid-sequence changes the requirement underneath the
   team. Fix: fix the count when the **first** switch is pulled, and count only **standing,
   non-AWAY** players — the gate plates and the flood already exclude AWAY via `allTargets()`, for
   exactly this reason.
2. **Cap the count.** Eight players means eight switches within X seconds across 4,800 × 2,700 —
   worst-case traversal alone is ~1,200px. At 240px/s that is 5s of running before anyone even
   arrives. **Cap at 3 or 4** ("all players, up to 4"), or the mechanic is unusable at the top of
   this group's size range.
3. **X has to be measured on the host's clock, on arrival.** It is the only clock that exists
   (`CLAUDE.md` rule 1). A guest on 150ms sees its own pull register late, so X should be generous —
   **3–5s**, not 1. Note this is the *opposite* problem to the horde switch, where two players
   pressing on the same frame must produce **one** call; here N distinct calls must all land.
4. **Reusing the horde-switch art needs a different prompt and a different state.** The horde
   switch is **one-way and dead metal afterwards**; these reset if the window lapses (in a team) or
   stay down forever (solo). Same lever, three states — players will confuse them otherwise, and
   the two `F` targets in the keep were already spaced apart specifically so they could not be.
5. **Switch placement has to respect the ring economy**, which is the point of putting them around
   the map: a switch behind a 1,600 door is a cost, and two switches in ring 0 are not. That makes
   placement a **pricing** decision, not a geometry one.

### 8.6 Recorded, not asked: what the train is for long term

From the same 2026-09-25 message, so it is on the record even though none of it is next:

- Railcars stand on the main line and on spurs; **the rocket bumps a car or the locomotive along
  the track**, and a car rolling into the locomotive **couples** to it. Coupled cars are fuel cars,
  and coupled cars are the locomotive's fuel.
- Long term, **an open world connected by rail**: the tank sets how far the group reaches before
  refuelling, and running dry strands them in distant, sparse, sometimes-secret ground.
- **Fuel is a second currency after all** — but one the player only ever touches *as railcar fuel*,
  never as a number to spend. That narrows §5's objection rather than answering it: the objection
  was to a parallel economy, not to a tank gauge.
- **Sector 1 stays at three tanks** for now, with one-tank runs being the later game's shape.

**The architecture, the evaluation of the "gated hybrid" flow-field proposal, and the measured
per-frame costs are in `zombie/TRAIN_RAIL_PLAN.md` (2026-09-25).** The headline from it: a train on
rails has **one degree of freedom**, so the physics is a scalar per car and 1-D collisions — and the
real blocker is not pathfinding but that **`railPaths` is a list of polylines, not a graph, and
0 of the 3 sidings a map touch the main line.**
