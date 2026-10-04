# Zombie — playtest 2 plan (2026-09-26)

**Status: PROPOSAL. Nothing here is built.** Everything below comes from one source: the
playtest of the evacuation train (`ef4129c`) on the evening of 2026-09-26. No item has been
invented and nothing from earlier passes has been folded in.

**The shape of the plan is the user's condition** — *"segmenting work as necessary to confirm
function along the way"*. So every phase ends with a **check**: something measurable, runnable, or
visible. A phase that cannot be confirmed is split until it can.

---

## 0. Two findings that collapse eight bullets into two causes

Worth reading before the phases, because they change what the work actually is.

### 0.1 Player push is the cause of at least four reported bugs

Pushing a railcar was implemented as **proximity at a car's end** (`trainPushFromPlayers`), on the
model of `updateGeneratorRestart` — no keypress, no message, no prediction. That was the wrong
model, and the report shows it from four directions at once:

| Reported | Why push explains it |
|---|---|
| *"player standing on one edge of a rail car causes it to just float all the way opposite"* | Standing at the end **is** the push input. There is no way to be near a car and not shove it. |
| *"buyable doors on rail sometimes don't allow player through after being bought"* | Walking through a doorway puts you at the end of the car parked in it (§0.2). You push it, it rolls, its deck **carries you with it**, and you travel backwards through the door you were trying to enter. |
| *"rail cars are spawning in unpurchasable doors"* | Independent (§0.2), but it is what puts a car where you will walk into its end. |
| *"after only filling two silos the couple the cars comes up"* | An accidental shove can couple a car at any point in the run, and `trainCouple()` fires **FUEL CAR COUPLED — 1/3** as a toast. The chain has not moved; the toast says it has. |

**So the first phase is mostly deletion**, and it should be done before anything else on the rail
is judged — several of these may simply stop existing.

### 0.2 A car sits in a closed rail door on every map. Measured.

24 seeds through the real generator:

```
cars sitting in or beside a rail door   1.00 per map, on 24 of 24 maps
always the same one                     car 1 (s = 532), door 6, open = false
```

It is deterministic, not unlucky: `trainBuild()` places cars at fixed fractions of the line
(`0.17 / 0.29 / 0.41`) and the line's geometry is fixed, so the first car lands on the
KENNELS|YARD crossing every time. Nothing in placement knows doors exist.

---

## Phase 1 — The loop, and an honest pause  ·  **S–M**

> *"Gameplay does not continue when tab inactive. Is there a way to remove this behavior or add an
> intentional pause button"*

**This goes first because it makes every later observation trustworthy.** `gameLoop` is driven
purely by `requestAnimationFrame` (`zombie-render.js:3429`), and a background tab gets no frames.
Two consequences, and the second is much worse than the first:

- Solo: the game silently stops and resumes. Annoying.
- **Multiplayer: if the HOST backgrounds its tab, the entire room freezes** — the host owns zombie
  AI, the round clock, the scrap pool and `broadcastWorld`. Everyone else sees CONNECTION
  UNSTABLE while nothing is actually wrong with the network.

There is a second, quieter bug in the same three lines: `dt` is clamped to 100ms
(`Math.min(100, now - lastFrame)`), so a loop that resumes after a gap advances the world by
100ms whatever the gap was. Any fallback timer that ticks slower than 10Hz would run the world in
slow motion rather than catching it up.

**Work:**

1. **Fixed-timestep accumulator.** `update()` runs in fixed 16.7ms steps from an accumulator,
   capped at N steps per tick so a long gap cannot produce a freeze-then-lurch. This is the piece
   that makes any tick source interchangeable, and it stands on its own.
2. **A background tick source for the host.** `setInterval` keeps running when hidden, throttled
   by browsers to about 1Hz — which, with (1), is enough to keep the round clock and
   `broadcastWorld` alive rather than stopping dead. Only armed while `document.hidden`.
3. **An intentional pause**, which is the other half of the ask: `P` (or ESC's dialog) pauses
   **solo** properly and says so on screen. **It must not pause a shared room** — the host
   simulates for everybody, which is already why the field manual and the dev panel do not pause.

**Check:** with the tab backgrounded for 60s, a host's round number and zombie count advance (at
reduced rate) rather than sticking, and a guest sees no CONNECTION UNSTABLE. Solo pause visibly
stops the world and resumes without a lurch. Measure the resumed frame's `dt` and step count.

> **Worth knowing before choosing (2):** a Web Worker timer is not throttled and would hold full
> rate, but a Worker cannot be constructed under `file://` in Chrome, and `file://` is a hard
> constraint of this repo. An `AudioWorklet` tick would also survive, at the cost of tying the
> simulation to the audio graph. `setInterval` is the version that cannot break the double-click
> case, which is why it is proposed.

---

## Phase 2 — The rail, de-bugged  ·  **S–M**

Mostly deletion and placement. **Do not start Phase 3 until this has been played**, because §0.1
predicts several of the remaining rail complaints will not survive it.

1. **Remove player push entirely.** `trainPushFromPlayers`, `TRAIN_PUSH_ACCEL`, `TRAIN_PUSH_REACH`
   and the "PUSH FROM EITHER END" prompt all go. *Consequence to accept deliberately:* **the
   rocket becomes the only way to move a car**, so a team that never buys the 7,500 rocket cannot
   assemble the train. Phase 4 removes that dependency by making cars start at the silos; until
   then, either the rocket is required or one cheap alternative is kept. **This is a real fork in
   the road and it is question 1 at the bottom.**
2. **Never place a car on a crossing.** `trainBuild()` learns where the rail doors are and slides
   each car clear (they are placed after `buildRailSpur`, so the doors exist).
3. **Cars collide with unpurchased doors.** A closed rail door stops a rolling car dead — which is
   the physical statement of the rule the game already enforces at start-up ("a shut crossing is a
   shut line"), and it is what makes buying the crossing feel like clearing the road rather than
   satisfying a checklist.
4. **Increase rocket efficacy on cars.** `TRAIN_ROCKET_KICK` is 300px/s against a
   `TRAIN_SHUNT_MAX` of 90 — the cap is eating most of it. Raise the cap for a rocket-struck car,
   or let a rocket hit ignore the cap for a short window. **The cap exists for a measured reason**
   (a car must not travel more than one nav cell per 220ms field refresh), so this needs the
   number re-derived, not just raised.

**Check:** a new assertion in `scripts/check-zombie-train.js` — **no car within 30px of any rail
door on any seed** (today: 1.00 per map on 24 of 24). Plus: a rolling car stops at a closed door
and passes an open one; one rocket moves a car a useful distance; standing anywhere near a car
does nothing at all.

---

## Phase 3 — The rail, presentable  ·  **M**

1. **Cars rotate through the elbow.** `trainCarRect()` returns an **axis-aligned** box chosen by
   which leg the car is on, which is why a car at the 90° fillet "visually slides off the track".
   The comment in `zombie-train.js` calls the AABB honest *because the line is rectilinear* — it
   stops being honest at the curve. Needs a rotated draw (and then a decision about whether
   collision follows, see 3 below).
2. **Draw order at the doorway.** The rail and the cars are drawn before `drawDoors`, so a door
   paints over both. *"Rail is being drawn under door opening, and also rail cars are under door
   opening too which does not look correct."* The track should read as running **through** the
   threshold and the car as standing **in** it.
3. **Cars get walls on at least two sides.** This is the one item here that is not cosmetic: it
   changes the deck from the flat, walkable surface the whole carriage model was built on
   (`TRAIN_RAIL_PLAN.md` §2.5 chose N2/flat deliberately, to keep the nav grid untouched). Walls
   mean solids that move, which means either (a) walls that are solid to **players only** — cheap,
   and zombies still swarm aboard — or (b) real moving solids, which is the nav work that whole
   design avoided. **Question 2 at the bottom.**

**Check:** rendered captures at the elbow across several seeds (the method is the
`zombie-map-capture` full-res PNG sink, not pane screenshots — a car on a curve is exactly the
kind of thing a 480px screenshot cannot adjudicate). Doorway order judged by eye on one capture.

---

## Phase 4 — Cars start at the silos  ·  **M–L**

> *"Rail cars should start @ silos with rail adjacency, read as 'filled' after filled, then eject
> / release rail car for it to be added"*

This is a **design change, not a bug fix**, and it is the one that dissolves the sequencing
complaint structurally rather than by patching the UI: a car cannot couple out of order if it does
not exist as a loose car until its tank is full.

It also ends the rocket dependency from Phase 2.1 — releasing a full car is a deliberate action at
the silo, not a shunt from across the map.

**What it needs first, and this is the cost:** a car parked at a silo has to be able to *reach*
the line. Measured 2026-09-25: a map has **1 main line plus 3.0 sidings, and 0 of the sidings
touch the line.** So this phase contains the **rail graph** (junctions, arc-length edges, points)
that `TRAIN_RAIL_PLAN.md` files as T1 — the piece deliberately deferred because a rail graph is
authored geometry and belongs with `LEVEL_BUILDER_PLAN.md` phase 4.

**Sequencing consequence: this phase is the one that genuinely wants the map work to happen
first.** Doing it before the level builder means authoring rail geometry twice.

**Check:** on every seed, each silo has a siding that joins the main line, and a car released from
any silo can reach the locomotive under its own power (headless, in
`scripts/check-zombie-train.js`).

---

## Phase 5 — Zombies stop standing inside each other  ·  **M, and the riskiest**

> *"all zombies lack collisions or separation meaning 100+ zombies can be within the same square
> which is really underwhelming"*

Correct, and it is the item with the most gameplay upside in the whole list — a horde that
occupies space is a horde you can be *cornered* by.

**Why it is the riskiest thing here.** This game's pathfinding history is a list of fixes for
zombies that stopped arriving: beelining, cell-centre sampling, diagonal corner-cutting,
centre-vs-corner steering, two different stuck watchdogs and `relocateZombie`. Every one of those
was found by a measurement, and separation pushes bodies **off** the path the field handed them —
the exact shape of failure that history is made of.

**Proposed approach, smallest first:**

1. **Soft separation only**: a short push-apart between zombies within a small radius, applied
   after steering, capped well below step size so it biases rather than overrides.
2. **Uniform-grid neighbour lookup** — the solid index's own `GRID_CELL` pattern. Never O(n²):
   the flood is 90 bodies scaled by team, and the SUPER SPLITTER's fan adds 20 at once.
3. **No separation while chewing, on target, or in the launch phase** — the three states already
   exempt from the progress watchdog, and for the same reason: not moving is the point.

**Check, and it must be the existing one:** the 24-layout × 24-run headless traversal that
`CLAUDE.md` records at 100% reach for every type. **If separation drops any type below 100%, it is
wrong.** Plus a crowd measurement that does not exist yet — mean bodies per 20px cell under a
90-zombie flood, before and after — because "they stack" currently has no number attached to it.

---

## Phase 6 — Reading the map  ·  **S each, independent**

All four are small, independent, and confirmable by looking. Good candidates to interleave.

1. **Minimap 2–3× larger, with sector labels, and hold-`M` only** (the toggle goes). Note the
   labels want the sector name at a size that is legible — `CLAUDE.md` already records that a
   letter at 6px is a smudge, which is why landmarks use glyphs.
2. **More saturation on the floor tints.** These were re-solved on 2026-09-20 under explicit
   constraints (hue within 34° of original, chroma 10–24, L\* 18–36), and the **chroma floor is
   recorded as load-bearing** — a solve without one greyed the Spillway out entirely. So this is
   "raise the chroma band and re-solve", not "pick brighter colours".
3. **The goal list must not assume order.** *"UI needs check of tasks completed out of order.
   Tasks complete prior to others leads to a UI softlock."* `nextGoal()` returns the first
   not-done goal in a fixed list; anything finished early is invisible and anything finished late
   strands the pointer. Needs goals with **explicit dependencies** rather than an implied
   sequence, so NEXT is "the first goal whose prerequisites are met and which is not done".
4. **Dev buttons to advance each chain step**, below the existing ones. Cheap, and it is what
   makes Phases 2–4 testable in seconds instead of by playing a whole run.

**Do 6.4 first.** It pays for itself immediately in every other phase.

**Check:** a screenshot each for 1–2; for 3, force each step out of order from the dev panel and
confirm NEXT is always sensible and never blank; for 4, that every step is reachable from the
panel.

---

## Phase 7 — Out of Zombie's scope  ·  **L, and it is a hub project**

> *"return to game hub after game completion, or pause menu vote return. All games need a 'win
> state' and pause menu"*

Correctly identified as general scope. This is not Zombie work — it is a **shared contract across
all five games**, and it belongs beside `GAME_PROTOTYPE_INSTRUCTIONS.md`'s `GameInstance` contract
and `HUB_LOBBY_PLAN.md`'s room overlay. Zombie is also the game that deliberately does **not**
implement `window.GameInstance`, so it is the worst one to prototype it in.

**Proposed:** a separate plan, in `HUB_LOBBY_PLAN.md` or its own file, covering a shared pause
overlay, a return-to-hub path and a voted return. Not scheduled here.

---

## Phase 8 — Door and window art  ·  **S, but blocked**

> *"Suggest alternate door and window design. It feels a bit under designed and a carry over from
> early concepts."*

Agreed, and there is a specific known defect behind the feeling: **a building window uses the
boundary-barricade art**, so from above a window and a boarded door read identically
(`MAP_VISUAL_AUDIT.md` §1.1, still unfixed).

**But this is downstream of a decision that is still open.** The FAITH-style black/white/red
direction was proposed on 2026-09-21 and **declined for now on 2026-09-24**, with the ordering
question tabled. Redrawing doors and windows in the current palette and then restyling is drawing
them twice. **Question 3.**

---

## Proposed order

```
  1  the loop + pause        <- first: makes every later observation trustworthy
  6.4 dev step buttons       <- second: makes every later phase testable in seconds
  2  rail de-bugged          <- mostly deletion; several complaints may vanish with it
      |
      +-- PLAY IT AGAIN before going further
      |
  6.1-6.3 reading the map    <- small, independent, interleave freely
  3  rail presentable
  5  zombie separation       <- riskiest; gated on the traversal measurement
      |
  4  cars start at silos     <- wants the rail graph, which wants the map work
  8  door/window art         <- wants the art-direction decision
  7  hub pause / win state   <- not Zombie's, needs its own plan
```

The break after Phase 2 is the important one. Four of the rail complaints are predicted to be one
bug (§0.1); confirming that before building Phases 3 and 4 is the difference between fixing the
cause and decorating it.

---

## Open questions

1. **Phase 2.1 removes player push. Until Phase 4, that makes the 7,500 rocket the only way to
   assemble the train.** Accept the rocket as required, or keep one cheap alternative (an `F`
   hold at a coupling point, say) that cannot be triggered by standing nearby?
   → *"rocket only" / "keep a deliberate alternative".*
2. **Phase 3.3, walls on the cars: solid to players only, or real moving solids?** Players-only is
   cheap and keeps the nav grid untouched, and zombies still swarm aboard. Real moving solids is
   the engine work `TRAIN_RAIL_PLAN.md` §2.5 deliberately avoided.
   → *"players only" / "do it properly" / "show me what players-only looks like first".*
3. **Phase 8 is blocked on the art direction you tabled on 2026-09-24.** Take that decision now,
   redraw doors/windows in the current palette anyway, or leave Phase 8 until after the map work?
   → *"decide the art direction" / "redraw now anyway" / "leave it".*
4. **Phase 4 wants the rail graph, which wants authored geometry.** Do it inside the level-builder
   work when that happens, or build a minimal junction system for the silo sidings now and author
   it properly later?
   → *"wait for the builder" / "minimal now".*
5. **Phase 5's crowd measurement does not exist.** Before changing anything, is it worth one
   session building the "bodies per cell under a flood" measurement so the fix has a number to
   move — the way every previous pathfinding fix did?
   → *"measure first" / "just build it and judge by feel".*
