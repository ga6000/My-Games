# Rail Sandbox — a mechanics bench for Zombie Rail (2026-10-16)

**Which game?** `under-development/zombie-rail/` — the parked evacuation-train build, revived by
the user on 2026-10-16 as a standalone game. **Not** `zombie/` (ZOMBIE ARCADE), and not the hub.

**Which finish-line item does this close?** *None, and that is deliberate.* `SCOPE_RULES.md` §3
asks every plan to name one; this one cannot, because the user directed the work outright rather
than promoting an inbox item. It closes no `HUB_RETROSPECTIVE.md` §5 item and **does not touch the
board** — rule 8's one-in-one-out is unaffected, because nothing is being promoted. The work stays
under `under-development/`, where `README.md`'s "no speculative work" rule is lifted for it by the
user's explicit request.

---

## 1. What is being built

A **separate page**, `rail-sandbox.html`, beside the existing `Zombie.html`. It is a bench for the
rail mechanics with no level system, no round system and no zombies by default.

**`Zombie.html` and every `zombie-*.js` file are left exactly as they are.** This is additive. The
reason is not timidity, it is the one hard constraint that governs this repo: those 21 files share
one global scope, and the one that matters here — `zombie-train.js` — is bound to the level
generator in nine places (`railPaths`, `siloFill`, `siloCapacity`, `doors`, `escapeOpen`,
`escapeAt`, `floodActive`, `won`, `wonAboard`). Growing a rail *graph* with switches inside it
would mean rebuilding the generator that feeds it. A new page with its own `rail-*.js` set loads
none of that, so:

- "no levels or zombies" is the default rather than a thing to switch off,
- `check-global-collisions.js` sees two independent pages and can never report a clash between
  `rail-*` and `zombie-*`,
- the reference build stays runnable and comparable, which is the whole reason the fork was
  parked rather than deleted.

### Why not extend `zombie-train.js`

Its header is right that a train has ONE DEGREE OF FREEDOM, and the sandbox keeps that insight
whole. What it does not have is a graph: it takes the single longest `railPath` and says so in a
comment — *"THE SIDINGS ARE NOT JOINED TO IT and that is a known limit"*. The user's request is
precisely that limit (forks, switches, rearranging cars), so the graph is the new work and
everything else here is a port of reasoning that file already got right.

---

## 2. The rail network (`rail-net.js`)

A graph, arc-length parameterised, generalising the existing scalar model rather than replacing it.

- **Node** `{ id, x, y, edges: [edgeId] }`
- **Edge** `{ id, a, b, pts[], cum[], len }` — `pts[0]` at node `a`, last at node `b`.
- **Anchor** `{ e, s, d }` — an edge, an arc position on it, and `d = +1|-1`, the direction of
  travel relative to that edge's own parameterisation.

### Route memory is the load-bearing idea

A body does **not** re-derive where its cars are by consulting switches, because a switch thrown
behind a moving train would then teleport its cars onto the other branch. Instead each body keeps
a **route**: the ordered list of `{e, d}` it currently occupies, front-most first. Car poses are
walked along the stored route. Switches are consulted only when the *head* needs track it does not
yet have. That is also how a real railway behaves — the points behind you do not move your train.

Invariant, checked every frame: **the route covers at least `bodyLength` behind the head.** Front
extension happens when the head runs off `route[0]`; back extension when the invariant breaks
(which is what reversing into fresh track looks like). Surplus tail edges are trimmed.

### Switches

Declared explicitly in the map data, never inferred: `{ node, trunk, branches: [e, e], thrown }`.

- A **facing** move (arriving on the trunk) takes `branches[thrown]`. This is the decision the
  player manages, and the only one.
- A **trailing** move (arriving on a branch) takes the trunk and **auto-aligns** the switch.
  Chosen over blocking: a trailing move has exactly one destination, so blocking it teaches
  nothing and strands a car mid-track with no feedback.
- A switch is **refused while a car stands on it**, with a prompt, rather than derailing anything.

Thrown by `F` at the lever, or by shooting the lever — both routed through one `railThrowSwitch()`.

---

## 3. Cars, coupling, physics (`rail-cars.js`)

Four types, as asked:

| kind | len | wid | mass | notes |
|---|---|---|---|---|
| `loco` | 220 | 62 | 4.0 | pilot seat, fuel tank, pushes from its front |
| `flatbed` | 190 | 56 | 1.0 | open deck |
| `boxcar` | 190 | 60 | 1.4 | two side openings, crates inside sometimes |
| `passenger` | 200 | 58 | 1.3 | windows, seats |

**A body** is one or more coupled cars sharing one `v` and one route — 1 DOF, as before.

- **Rocket push.** An impulse `J`, so `dv = J / totalMass`. One flatbed gets a big shove; three
  coupled cars get a third of it. That *is* the requested physics — "multiple rail cars attached
  are not pushed as easily" falls straight out of summing mass, with no special case.
- **Coupling** is inelastic: `v = (mA*vA + mB*vB) / (mA + mB)`. Detected on world distance between
  facing end points, which is edge-agnostic and so works across a junction.
- **The locomotive's front pushes without coupling** (its pilot), its rear couples. Pushing is
  solved as a momentary rigid pair each frame — both take the momentum-conserving common velocity
  — so under power the loco keeps shoving, and a heavier set accelerates slower.
- **Blockers** (shut doors, buffer stops, boulders) are points on an edge. The *leading end* of a
  body is tested for having crossed one this frame; resolution is a bounce, `v = -v * 0.35`.
  Nothing is pushed into `walls[]` and no nav grid exists here, so the warning at the top of
  `zombie-train.js` cannot be violated.
- **Oriented rects, not AABBs.** `zombie-train.js` could honestly use an AABB because its line was
  rectilinear; this map has arcs, so car hit tests rotate the point into car space.

---

## 4. The locomotive (`rail-fuel.js`, pilot seat in `rail-player.js`)

Standing at the pilot seat prompts the controls. Keys chosen to leave `WASD` free for walking
(the player stands, not sits) and to stay clear of the dev panel's `L`+`G`:

- `E` notch up, `Q` notch down — notches `-2` (full brake), `-1` (light brake), `0` (coast), `1..4`
- `R` reverse direction, allowed only under ~8 px/s
- `F` interact (couple/uncouple, throw a switch, buy a door)

Momentum is the point: low coasting friction, and acceleration and braking both divided by total
mass, so cutting power early is a thing to learn rather than a thing to be told.

**Blood fuels the blood train.** Silos hold blood; the loco holds fuel; fuel burns under power.
A silo's **pump stop** is a point on an edge with a tolerance window: bring the loco inside it at
or below the pump speed and it latches to the pump. Pumping is **loud** and alerts zombies in a
radius (a no-op while zombies are off, which is the default). The right sidebar shows the fuel
gauge **only while aboard the locomotive**.

---

## 5. The sandbox map (`rail-map.js`)

6400 x 3600. A large loop with two towns and thick forest between them, as asked.

Nodes: `WN WS EN ES` on the loop, `WY EY` mid-siding, `WD ED` dead ends.

| edge | from -> to | what it is |
|---|---|---|
| `loopN` | EN -> WN | the north leg, through the forest |
| `loopS` | WS -> ES | the south leg, through the forest |
| `wMain` | WN -> WS | west town through track |
| `wSidA` / `wSidB` | WN -> WY -> WS | west passing siding |
| `wSpur` | WY -> WD | west dead-end spur |
| `eMain` | EN -> ES | east town through track |
| `eSidA` / `eSidB` | EN -> EY -> ES | east passing siding |
| `eSpur` | EY -> ED | east dead-end spur |

Six switches (`WN WS WY EN ES EY`). A through track plus a passing loop plus a dead-end spur in
each town is exactly the geometry a shunting puzzle needs — it is the smallest layout in which
cars can actually be **rearranged** rather than merely moved.

Four blood silos beside the track, each with a pump stop: two in the towns, two out in the forest
legs, so there is a reason to drive the whole loop. Walls with **buyable doors** straddle the rail
in three places; a shut door is a blocker, which is the rule `zombie-train.js` found in the
browser and got right — *"a shut crossing is a shut line"*. Buffer stops at `WD` and `ED`.

---

## 6. Look and HUD (`rail-render.js`, `rail-hud.js`)

Ported from ZOMBIE ARCADE as the user asked, taking the **elements** and not the level system:

- `arenaGrassTile()` — self-contained, fixed seed, flat raster colours
- `drawTallTree` / `treeFullHeight` — canopy art, `TREE_LIFT`, tree shades
- `drawLighting()` — the four quantised bands, `LIGHT_RADIUS` 340, `LIGHT_FADE` 1.33, unchanged
- the track art's sleepers-and-rails approach, re-laid along graph edges
- the cabinet **sidebar**, scrubbed: the radar/minimap stays (it is the most useful panel a rail
  sandbox could have), and HI-SCORE, 1UP, SESSION BEST, lives, CONDITION and the goal list all go,
  since none of them mean anything without rounds or a score. In their place: TRAIN (speed,
  direction, notch, cars), FUEL (aboard the loco only), SILOS, and switch states.

---

## 7. Dev GUI (`rail-dev.js`)

Through `shared/devtools.js` (`L`+`G`), registered last, as `DEV_TOOLS_PLAN.md` requires. Buttons
and sliders for: fill / empty every silo, set loco fuel, open every door, toggle zombies (default
**off**), spawn each car type, reset the consist, teleport to a town, and throw every switch.

---

## 8. Teardown

One `AbortController` and `trackTimeout`/`trackInterval` throughout, per the root hard constraint,
and a `window.GameInstance` with `init/start/pause/resume/destroy/getState` —
`GAME_PROTOTYPE_INSTRUCTIONS.md` §2 says to write new games to the contract even though nothing
embeds them yet.

Solo only. `shared/identity.js` supplies the player colour via `IDENTITY.colorFromName`, which is
the single sanctioned name→colour fallback; **no second hashing scheme is written here.** No MP:
the sandbox is a bench, and the user did not ask for it.

## 8b. Built 2026-10-17 — where it diverged, and what had to be measured

The plan above is kept as written. These are the places the build went another way, and why.

**`rail-hud.js` was never created.** The sidebar lives in `rail-render.js` (`railHudUpdate`,
`railDrawMinimap`). It is ~90 lines and runs at 10Hz off the same frame, so a file of its own
would have been a file for the sake of the plan.

**The third door moved off the west main onto the loop** (§5 said `wMain`). An east-west fence
across the west main passes within 23px of the siding running parallel to it — close enough to
look like it blocks a track it has no door on. All three crossings are now on the loop, where
there are genuine single-track stretches. It is now the west town's gate, on the loop's west leg.

**At the yard throat the SPUR is the straight and the siding curves back** (§5 implied the
reverse). Making the spur the branch that curved away needed a radius under 90px at the node,
because it would have had to turn 90 degrees inside the length of one car.

**Three bugs the browser found that reading could not:**

1. **The fillet's arc centre was mirrored.** Both signs were inverted, which turned every corner
   into a cusp: the loop's 300px corners measured a **9px** radius. Check the sign against a
   case — heading east and turning south is `turn > 0`, and that arc's centre is due south of the
   tangent point.
2. **`railSyncBody` ran twice per step**, so the second call recorded the centre it had just
   written and every carry delta came out as zero. **Nothing could ride a car.** There is now
   exactly one sync per step, at the end.
3. **Uncoupling did not exist.** The two halves are left one `RAIL_COUPLE_GAP` apart — inside
   `RAIL_COUPLE_DIST` — and the closing test treats equal velocities as closing, so the next
   frame re-merged them. Fixed with a **no-couple mark** cleared by the pair actually coming
   apart, not by a timer: a timer would just re-latch two cars left standing together.

**Numbers that were measured against the map, not chosen:** see the table in `CLAUDE.md`
(curvature `H² >= 1200*L`, polyline sampling, fuel economy, bullet substepping).

**Verified end to end in the browser**, by stepping the simulation deterministically rather than
by eye: rocket impulse scaling exactly 1/mass (420 / 210 / 105 for 1 / 2 / 4 cars); inelastic
coupling; the locomotive's nose pushing without ever coupling while its rear couples on a reverse;
a shut crossing stopping a car 2px short and bouncing it, and clearing once bought; buffer stops;
facing moves taking the set road; a lever refused under a train; mounting at 0–440 px/s; the deck
safe at 400 px/s while the nose is lethal above 170; the pump latching, holding and transferring
(0.10 → 0.65 tank against the silo's 1.00 → 0.45); a full lap of the loop under power with four
cars coupled at the 980 px/s cap; and the whole shunting manoeuvre — back down the spur, couple,
haul out over the points, drop the wagon and run light.

## 9. Verification

`check-global-collisions.js`, `check-undefined-globals.js`, `check-identity-parity.js`,
`check-doc-sync.js` from the repo root, then the page driven in the browser pane against the dev
server (`file://` shows no scripts in the pane — the `my-games` launch config on :8123).
