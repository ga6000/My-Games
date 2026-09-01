# Glucose Dash — Scope Doc

**Slug:** `glucose-dash` · **File:** `glucose-dash/glucose-dash.html` · **Written:** 2026-08-29 · **v2 revamp:** 2026-08-29 · **v3 graphics + curved course:** 2026-08-29 · **v4 depth sorting:** 2026-08-29 · **v5 top-down 2D:** 2026-08-29

> **v2** replaced the dark diorama with a light mall (white walls, white checkered floor,
> colourful storefronts), brought the camera in close, rounded the runners, and — the part that
> is not cosmetic — **narrowed the upper floors and removed their railings so you can fall off
> them.** See `REVAMP_PLAN.md` for the plan and §5 for what the falling did to the balance.
>
> **v3** fixed the renderer (near-plane clipping — geometry was being discarded a frame before
> you reached it, which is why the corridor had no walls), painted store names onto the wall
> plane instead of billboarding them, made every floor above visible at all times, raised draw
> distance 50%, and **doubled the course to 3300 units and bent it** with a centreline.
>
> **v4** replaced fixed category draw order with a real depth-sorted painter, and found that v3's
> near-plane clipping had been **dead code** — see §5.7, which corrects §5.4.
>
> **v5 threw the perspective renderer out entirely** and rebuilt the view as a top-down 2D floor
> plan. Every graphical defect this game hit came from the projection; none of those failure
> modes exist without one. Gameplay is untouched — same physics, glucose, food, falls, NPCs,
> curved 3300-unit course. The perspective build is kept at
> `glucose-dash-perspective.html.bak` if it's ever wanted back.

An ultramarathon footrace through a three-storey shopping mall where the real resource isn't
stamina, it's blood glucose. You run the course, you raid the storefronts, and you decide —
constantly — whether the cake in the recessed bay is worth the momentum you'll lose steering
into it.

This document is the plan of record: what's built, what was decided, what I decided *for* you
and want confirmed, what the balance simulation actually measured, what's still open, and
exactly what hub/server integration needs.

---

## 1. What the prototype does today

Single-player-complete. Runs by double-click (`file://`), no server, no build step.

| System | State |
|---|---|
| Car-style physics movement (momentum, turning radius, lateral slip) | ✅ built |
| Overhead 3rd-person perspective camera, fixed to the course axis | ✅ built |
| Blood-glucose model with per-food GI curves | ✅ built |
| Glucose drives top speed (bonk below 70, small bonus when fuelled) | ✅ built |
| Hypo desaturation / hyper exposure blowout | ✅ built |
| Scrolling glucose timeline wave, bottom-right | ✅ built |
| Two-slot inventory above the monitor, Space to eat FIFO | ✅ built |
| Three-floor mall, forward-traversed ramps, ascent penalty | ✅ built |
| **Upper floors narrow + railless; falling off costs ~2.5s and your momentum** | ✅ built (v2) |
| Light mall aesthetic, close camera, rounded runners with white heads | ✅ built (v2) |
| Top-down 2D floor-plan renderer (no projection, no depth sort) | ✅ built (v5) |
| Floors below drawn through every drop, so the hole you see is the hole you fall through | ✅ built (v5) |
| ~~Near-plane clipping~~ / ~~depth-sorted painter~~ | removed with the 3D renderer (v5) |
| Store names painted on the wall plane, in perspective | ✅ built (v3) |
| All floors above visible at all times (soffits + edges) | ✅ built (v3) |
| Curved 3300-unit course (~125s race) | ✅ built (v3) |
| One hand-built course, per-race food-slot selection | ✅ built |
| 3 easy NPCs that contest items and manage their own glucose | ✅ built |
| Finish line / DNF-at-zero / results screen with time-in-range | ✅ built |
| `window.GameInstance` lifecycle + verified full `destroy()` teardown | ✅ built |
| Room seed via `MP` so every client stocks the same slots | ✅ built |
| Ghost racers on the wire, contested-pickup arbitration | ⬜ **not built — §7** |
| Mobile / touch controls | ⬜ not built |
| Firestore leaderboard | ⬜ not built |

---

## 2. Decisions locked from the concept conversation

Recorded so a later session doesn't relitigate them.

- **Win/loss:** finish line wins; glucose hitting **0** is a crash → DNF. Highs are visual-only,
  no DNF above 200.
- **Camera:** fixed to the course's axis. It does not rotate with the runner.
- **Course:** one hand-built course for v1. No generator.
- **Food spawn:** each food cluster has 2–3 candidate slots; exactly one goes live per race.
- **Curves:** high-GI spikes then crashes below where you'd have been; medium-GI is a clean
  no-overshoot bump; low-GI is small but holds for 30s+.
- **Eating:** not a pickup. Pickup fills an inventory slot (max 2, third pickup is *blocked*,
  item stays on the floor). Space eats slot 1, FIFO, and lowers your throttle cap while you do
  it — steering still works.
- **Stairs:** narrow, soft auto-align on the way up, ascent is slow, upper floors hold better
  food. Floors are an optional detour; the finish line is on the ground floor.
- **Sprint:** double-tap forward, a few seconds of raised top speed, short cooldown, burns
  glucose 2×.
- **NPCs:** contest scarce items like a player would, slower, no sprint spam.
- **The course is 3300 units and it winds.** Curvature is a `centerX(y)` centreline applied
  only in `toCam()`; physics, collision and AI stay in flat track space, so nothing that was
  balanced against a straight course can break on a bent one.
- **The mall narrows as it climbs, and the upper floors have no railings.** Floor 1 is a walled
  corridor (half-width 11). Floor 2 is a railless balcony (7.5). Floor 3 is tighter still (5.0).
  Storefront platforms hang out over the drop. Falling costs the drop, all your momentum and a
  landing stun — and can cascade, so a bad line on floor 3 can put you on floor 1.
- **Better food means "speed up + maintained blood glucose"** — from the original concept, and
  the half I nearly missed. Glucose drives *top speed*, not just survival. Without it, ignoring
  every storefront is the fastest line through the mall and the premise collapses into "don't
  hit zero." See §3.1.

---

## 3. Decisions I made to get this playable — please confirm or overrule

Each is one constant away from being changed. All of them live in `TUNE` or `FOODS`.

**3.1 — Glucose sets your top speed.** Below 70 it falls away to 0.40× at zero, on a curve
(exponent 1.4) so the last stretch of a bonk is a cliff rather than a slope. Above 90 you get a
bonus topping out at **+12% around 195** — deliberately reachable only by food that *holds* you
there, which is only ever low-GI. This is what makes cake interesting rather than merely
survivable: the spike touches the cap for about three seconds, and the crash makes you slow for
nine, while an oat bowl parks you on it for half a minute. Raised from +8% in v2, because at
+8% the climb to the top floor could not pay for itself (§4).

**3.2 — Baseline decay is −2.0/s and you start at 145.** The concept said roughly −1/s. At −1/s
a runner coasts the whole course on their starting glucose without ever looking at a storefront,
which I measured — a food-free run *won*. At −2.0/s a food-free run DNFs. See §4.

**3.3 — Eating time scales inversely with GI.** Candy is 0.7s, a burrito is 2.3s, an oat bowl is
3.1s. Without this, high-GI food is strictly dominated (same vulnerable window, worse curve) and
nobody would ever pick it up. The short window is what buys the crash. This is the single most
important balance lever in the build.

**3.4 — Low-GI "holds elevated" is decay *suppression*, not a plateau.** An oat bowl gives +30
and cuts your baseline burn to 40% for 36s. A flat plateau would have meant food that stops
time; suppression composes correctly with sprinting and climbing. **Stacking takes the strongest
suppressor only**, never the product — two salads multiplying to 0.16× decay would be an exploit.

**3.5 — Eating is committed.** No cancel once started. That's the whole risk of the mechanic; a
cancellable bite is free.

**3.6 — Ramps are forward-traversed and one-way.** Up-ramps and down-ramps are separate
structures, both entered running forward. A two-way staircase means running backwards down the
course, which fights a camera locked to the course axis.

**3.7 — The last descent on each upper floor is a full-width escalator bank.** Not decoration —
see the bug in §5.

**3.8 — The course layout is fixed-seed procedural, not literally hand-placed.** Store positions,
kinds and names come from a constant `COURSE_SEED`, so the mall is byte-identical for every
player on every run — functionally the hand-built course you asked for, but tunable by rhythm
parameters instead of by editing 40 coordinates. Only the *food slot choice* uses the room seed.

**3.9 — Falling drops you one floor, it doesn't kill you.** ~0.55s of no control, land at 25% of
your speed, then a 0.7s stun — about 2.5 seconds all in, plus the glucose that drained while you
were in the air. A DNF-on-fall would have made the upper floors unplayable rather than risky.

**3.10 — Stair landings are asymmetric, and there is an edge grace.** Entering a staircase needs
12 units of apron; *leaving* one needs 28, because you arrive at x=8 on a balcony that is only 5
wide and need time to steer back in. At a symmetric 12 you exited the stairs and fell off
immediately through no fault of your own. `EDGE_GRACE` (0.7 units) is the same idea in miniature
— your foot catches the lip — so a near-miss you were already correcting doesn't read as the
game cheating you.

**3.11 — Storefront platforms have 3 units of runoff past each end**, and are *drawn* longer than
they are walkable. Ground you can see is always ground you can stand on. Bay pickups also moved
from 58% to 42% of the platform depth so grabbing one doesn't require running to the very lip.

**3.12 — A staircase only takes you if you're running roughly along the course.** Without a
heading check, diving sideways into a storefront that happened to sit near a stair dragged you up
a floor you never asked for.

**3.13 (v3) — Storefront rhythm is per floor, and it is load-bearing.** The ground floor is a
busy mall (`GAP_BASE` 15); the balconies are sparse (26 and 56). At ground-floor spacing there
was **no open stretch of railless edge anywhere on floor 3 in the entire course** — a platform
covered it everywhere, so the drop you're meant to fear was invisible. Floor 3 is now ~37% open
ledge.

**3.14 (v3) — Food density and `baseDecay` are one dial, not two.** Every attempt to fix one
without re-measuring the other swung the balance hard: denser food made every route safe and
killed the gamble; sparser food collapsed the NPC field to a 67% DNF rate. The settled pair is
`baseDecay 2.0` with 3-candidate chunks on the ground floor and 2 upstairs.

**3.15 — Hyperglycemia has no mechanical penalty**, per your call. But the blowout is severe
enough that you genuinely can't read the course at 290+ (I checked). See Q1.

---

## 4. What the balance simulation measured (v3, curved 3300-unit course)

24 samples per route. NPC decision timing uses `Math.random()`, so races are **not** reproducible
— 8–10 samples swung results by 20+ points and is not enough to tune on. Use 24+.

| Route | Avg finish | DNF | Median worst glucose |
|---|---|---|---|
| **Ignore all food** | — | **100%** | 0 |
| **Ground floor only** | **124.5s** | 8% | 84 |
| **Climb to the top floor** | 126.6s | **0%** | 96 |

NPCs: **15% DNF**, median **127.3s**, range 121.8–147.9s, **1.9 falls per race**.

The structure that shakes out:

- Ignoring food is still never survivable — you die at 59% of the course, every time.
- The ground floor is the fast line and a modest gamble. It's a sugar minefield by design, so
  running it means riding spikes and crashes with your vision blowing in and out.
- The top floor costs ~2 seconds and never fails. Median worst glucose 96 — you simply never get
  into trouble up there. It's the expert-safe line.
- The NPC field is healthy and genuinely competitive: their median (127.3s) sits between the two
  player routes.

**One finding worth keeping: the middle floor is a transit level, not a destination.** A bot that
climbs to floor 2 and *stays* there DNFs 83% of the time — it's the most contested floor (every
NPC passes through it), its food is mid-GI, and it's threaded with staircases going both ways.
Using it as a route to the top is fine; camping it is a trap. That's emergent rather than
designed, and I'd leave it — but it's the kind of thing that reads as a bug to a new player, so
it may deserve signposting.

## 5. Bugs the simulation caught

Recording these because both were invisible from looking at the code and would have been
maddening to diagnose from play.

**5.1 — Wall friction compounded 60×/second.** The wall response multiplied forward speed by a
flat `(1 - wallLoss*0.5)` on *every frame of contact*. Half a second of leaning on a storefront
multiplied your speed by ~0.0004. One NPC spent 50% of a race scraping the wall at 17 u/s
instead of 27. Tangential friction now scales with how hard you actually hit the wall, so a
glancing scrape costs a few percent and a head-on costs half your speed. **This affected the
player too** — brushing a wall used to nearly stop you dead.

**5.2 — You could run past the finish line forever.** The finish only exists on the ground
floor, so a runner still on floor 2 at the end of the course had no exit and ran off the end of
the world. The scripted player did exactly this, reaching y=5229 on a 1650-long course. Fixed
with full-width escalator banks that funnel everyone down whether they aimed for them or not; a
side staircase can be overshot, a full-width bank can't. `MALL_END` is a backstop only.

**5.3 (v2) — Every upper-floor storefront had an invisible hole at each end.** `BAY_MARGIN` holds
the *walkable* bay slightly tighter than the *drawn* one, so you can't clip a door jamb at 25
units/sec. Harmless on the ground floor. Upstairs it meant the first and last 2.2 units of every
storefront platform were a hole you fell through **while visibly standing on the shop floor** —
NPCs were falling 3× per race and starving as a consequence. Now the margin only applies on the
ground floor, and upstairs the drawn platform is deliberately *longer* than the walkable one.

Found by logging every `startFall` with the geometry that triggered it; the giveaway was events
reporting `inBay: true` alongside `limit: 7.5` — two functions disagreeing about the same
storefront.

**5.4 (v3) — Geometry was discarded a frame before you reached it.** `quad()` projected four
corners and bailed if *any* was behind the near plane. A wall panel running past the camera
always has a corner behind it, so the corridor walls were being thrown away entirely — which is
exactly what "there are no walls on the left/right, the floor just ends" was. Replaced with
Sutherland-Hodgman clipping against the near plane, so a polygon straddling the camera gets cut
instead of dropped.

**5.5 (v3) — The NPC starvation predictor was scaled to the old course length.** It compared
carried glucose against the burn for the *entire remaining race*. On a 126s course that is true
from the starting gun, so every NPC believed it was starving all race, which tripled every item
score and dropped their detour threshold to nothing — they careened across the mall after food
they didn't need while actually starving. Now judged over a 28-second planning horizon.

**5.6 (v3) — NPCs were eating themselves to death on the ground floor.** 59% of everything they
ate was high-GI, which is net *negative*. Their scoring weighted the crash at 0.55 of its real
size and their "desperate, grab sugar" clause fired at glucose 80 — which starts the exact
spike-crash-spike spiral the food model exists to punish. Crash weight is now 0.82 and the
desperation threshold is 62.

**5.7 (v4) — CORRECTION to 5.4: the near-plane clipping was dead code.** An older immediate-mode
`quad()` — the one that projected four corners and bailed if any was behind the camera — survived
the v3 refactor further down the same file and **shadowed** the new clipping version, because a
later function declaration wins. So v3 *looked* like it fixed "geometry disappears before it
leaves the screen"; the walls reappearing was down to the camera and shading changes, not the
clipping. The clip only actually started running when the duplicate was deleted in v4.

Two things made this survive review: the file has one 2600-line inline script, so a duplicate
definition 76 lines apart is invisible; and `scripts/check-global-collisions.js` only compares
identifiers **across separate script files**, so a collision inside one file is exactly what it
cannot see. There is now a scan for this in the verify step, and a comment on `quad()` saying so.

**5.8 (v4) — Draw order had no depth relationship between categories.** The renderer drew every
ramp, then every wall, then every facade, each internally sorted far-to-near but with no ordering
*between* them. A staircase ten units ahead was therefore painted before a shopfront a hundred
and twenty units away, and the shopfront won — "stairs showing behind shops". Everything now goes
into one list keyed by centroid depth plus a small bias (floors < decals < ramps < walls, to
break ties between coplanar things) and is sorted once per frame. Sprites join the same queue, so
a pickup in a bay can be occluded by the jamb in front of it instead of floating through it.

The generalisable lesson for this repo: **all of these were found by driving the game with a
script and reading the numbers, not by playing it.** A car-physics game hides a compounding
friction term extremely well — it just feels "heavy" — and a 2-unit hole at the end of a
platform just feels like you're bad at the game.

---

## 6. Open questions

**Q1 — Should going over 200 cost anything besides vision?** Currently visual-only, per your
call. A player who eats cake constantly and tanks their visibility is mechanically fine, just
blind. Options: leave it; add a top-speed penalty above ~260; add steering wobble. I'd leave it
one playtest longer — the blowout may already be punishing enough.

**Q2 — Should the third pickup swap instead of being blocked?** Currently blocked, per the
conversation. The failure case: you're at 60 glucose holding two oat bowls, and you run over the
soda that would have saved you. Blocked is the more honest rule; "hold Space near an item to
swap" is the escape hatch if it bites.

**Q3 — Is FIFO the right eat order?** You can't choose which slot. Fine when your two items are
similar, infuriating when you're holding a soda for an emergency and a salad you grabbed
opportunistically. Cheapest fix is a second key (`2` or Shift+Space) for slot 2.

**Q4 — Is ~64s the right race length?** Short enough to run repeatedly, but "marathon" implies
longer. `COURSE_LEN` is one constant. Note that lengthening the course tightens the glucose
economy proportionally — decay is per-second, so a 50% longer course needs ~50% more food.

**Q5 — Should there be a reason *not* to eat immediately?** Today the optimal play is roughly
"eat as soon as glucose dips." The interesting version has a reason to bank food — a finish-line
sprint, a known food desert ahead. A signposted stretch with no stores would create that. Not
built, and it's the change I'd most want to try next.

**Q6 — Does the ascent pay for itself?** **Answered in §4: yes for floor 2, not yet for floor 3.**
The open part is what to do about it — whether floor 3 should get a unique premium reward to
justify being the riskiest place in the game, or whether "maximum safety, costs you 2 seconds"
is a fine identity for a top floor. My inclination is that it needs something of its own, but
that's a design call, not a tuning one.

**Q8 (v2) — Is 2.6 NPC falls per race the right amount of chaos?** It's dramatic and it costs
them races. It's also the main driver of their 27% DNF rate. If the field starts reading as
incompetent rather than as easy opponents taking real risks, make them value upper-floor bay
items lower still (`npcThink`, the `it.bay && r.floor > 0` multiplier).

**Q7 — Are the NPCs at the right difficulty?** Tuned to ~0.95–0.99× player top speed with
jittery steering and conservative eating. They win sometimes. There's no difficulty setting.

---

## 7. Hub & server integration — TODO

The prototype already loads `../shared/mp-core.js` and calls `MP.connect({game:"glucose-dash"})`.
It uses the room seed for food-slot selection and `MP.selfColor` for the runner — and I confirmed
against the live Render server that it connects and receives a real seed. **It does not broadcast
anything yet.** That's deliberate — you asked to hone single-player first — so the game shows up
in the room as present but races alone.

**No server change is required for any of this.** Per `MULTIPLAYER_PLAN.md`, rooms are namespaced
`game:code` and the generic `relay` message carries arbitrary payloads, so `glucose-dash` gets
its own namespace for free.

### 7a. Hub card
Add to the `GAMES` array in `index.html` (~line 721):

```js
{ id: "glucose-dash", icon: "🩸", title: "Glucose Dash", desc: "Mall Marathon Blood-Sugar Race", href: "glucose-dash/glucose-dash.html", isNew: true },
```

Add `mp: true` **only** after §7b ships — the hub derives its diagonal stamp from that flag, and
claiming multiplayer before ghosts exist is exactly the class of bug `PROJECT_MEMORY.md` records
under "Three hub features were dead in production."

### 7b. Ghost racers (the Glass City Escape model, near-identical)
The lightest possible sync, and the right one here: the course is deterministic from the seed, so
**nothing needs to be shared except where everyone is**.

- Broadcast `{k:"pos", x, y, z, f, c, g}` at ~15Hz via `MP.canSend("pos", 66)`. Include floor `f`
  so ghosts on other floors render as rail pips instead of standing in mid-air, and glucose `g`
  so you can see who's about to crash.
- Interpolate remote positions between updates (Glass City's `g.x += (g.tx - g.x) * 0.35`).
- Time out a ghost after ~6s of silence.
- Broadcast `{k:"finish", ms}` once and record it into the same `finishOrder` array the NPCs
  already write to. The results screen needs no change.

### 7c. Contested pickups — the one part that needs real thought
Two players grabbing the same shake is the *entire premise of sprint*. Client-side "I touched it
first" means both clients think they won, both eat it, and the race silently forks.

Recommended: **claim-by-relay with host arbitration**, matching what `MULTIPLAYER_PLAN.md`
already specifies for Glass City collectibles.

1. On touch, the client sends `{k:"claim", slot:<id>}` and marks the item *pending* locally —
   greyed out, not yet in inventory.
2. The `MP.isHost()` client keeps the authoritative claimed-set. First claim it sees wins; it
   replies `{k:"claimed", slot, by:<id>}` to the room.
3. Everyone removes the item. The winner promotes pending → inventory. A loser gets a "TOO SLOW"
   toast and keeps running.
4. The ~100ms round-trip is visible but honest. The host being one of the racers is a mild
   advantage — acceptable at this group size, the same call already made for kill attribution in
   Gyro Space.

Do **not** defer this past 7b. Retrofitting arbitration into a pickup path that assumes instant
local success means touching every call site — `tryPickup()` is written as a synchronous
"take it now," and both the player and all three NPCs go through it.

### 7d. NPCs in multiplayer — decide before 7b
NPCs are simulated independently on every client and would drift apart within seconds (the same
robot-AI drift Glass City accepted). For a race where NPCs *contest items*, drift isn't cosmetic:
two clients would disagree about who got the shake. Options: (a) host simulates NPCs and
broadcasts at 10Hz, (b) drop NPCs entirely when the room has 2+ humans. **(b) is cheaper and
probably better** — NPCs exist to give sprint a reason to exist before multiplayer arrives, and
once real players are there they've done their job.

### 7e. Deployment checklist (from `PROJECT_MEMORY.md`)
- [x] Runs via double-click — verified
- [x] `node scripts/check-global-collisions.js` passes — verified
- [x] Full `destroy()` teardown verified (timers, listeners, socket, RAF, DOM, re-init)
- [ ] Room-join works with a second client; identity/colour survives reconnect and matches the hub
- [ ] Linked from `index.html`'s game-card grid
- [ ] Row added to `Game dev tracking.xlsx`
- [ ] `PROJECT_MEMORY.md` games table updated

---

## 7b. The v5 renderer, and why the 3D one went

Four revisions of graphical bugs all had the same root: perspective projection.

| Symptom | Actual cause |
|---|---|
| Corridor had no walls | Whole polygons discarded when one corner crossed the near plane |
| Stairs drawn behind distant shops | Fixed category draw order, no depth relation between categories |
| Store names floating perpendicular to the wall | Camera-facing billboards |
| Wall invisible against floor | Everything white, no silhouette without foreshortening cues |
| A rendering fix that did nothing for a whole revision | Duplicate `quad()` shadowing the fixed one |

The top-down rewrite makes all five *unrepresentable*, which is worth more than fixing them
individually:

- **No projection** → nothing can be clipped wrong, and there is no near plane.
- **No depth** → draw order is source order and is correct by construction.
- **No foreshortening** → colour and shape read directly; a wall is a stroked line.
- **One geometry source.** `pathWalkable()` builds the floor from exactly the regions
  `walkLimit()` treats as standable, and everything — the fill, the checkerboard clip, the wall
  or hazard stroke — comes off that one path. The v2 bug where the drawn platform and the
  walkable platform disagreed by 2.2 units (§5.3) is now structurally impossible.

**How the floors read**, per the design call: every level below you is drawn first, then your own
floor is drawn over it. Whatever is left showing through **is** the drop — there is no separate
"void" geometry that could drift out of step with the fall test. Falling shrinks the runner
toward a landing ring on the level below.

**Camera:** orthographic, still fixed to the course axis, 105 units ahead / 40 behind (the runner
sits at 72% down the screen). The mall visibly winds across the frame because `centerX(y)` really
moves — curvature is one term inside `SX()`. The play ribbon is 35 units wide against 145 along,
so on a wide window it's a vertical strip; it auto-shifts left when the window is too narrow for
both the strip and the HUD, so the runner is never hidden behind the glucose monitor.

**Cost: 0.97 ms/frame, down from 6.1.**

---

## 8. File map

Single self-contained HTML, matching every other game in this repo.

`glucose-dash/glucose-dash.html`, in source order:

| Section | Contents |
|---|---|
| `<style>` | HUD, glucose panel, inventory slots, results. The exposure filter is applied to the canvas only, never the HUD — you must always be able to read your own glucose. |
| Boot & lifecycle | `trackTimeout`/`trackInterval`, one `AbortController`, `LAYOUT_HTML`, `window.GameInstance` |
| Tuning | `TUNE`, `FOODS`, `STORE_KINDS`, `FLOOR_STOCK` — every balance number is here |
| Course build | `makeRng`, `RAMPS`, `buildStores`, `buildWalls`, `laneLimit`, `buildItems` |
| Glucose model | `makeBolus`, `bolusRate`, `stepGlucose`, `crash` |
| Physics | `glucoseSpeedMult`, `stepRunner` — shared by the player and every NPC |
| NPC AI | `npcThink` / `npcInput` — 2Hz decisions, item scoring, survival mode, sprint gating |
| Input | keyboard, double-tap sprint detection |
| Camera & render | `SX`/`SY`, `pathWalkable`, checkerboard, hazard edges, storefronts, ramps, runners |
| HUD | glucose wave, inventory, progress rail, warnings, exposure filter |
| Race flow | countdown, placement, finish, DNF, results |

**A note for whoever touches this next:** `window.GameInstance` is implemented here and no other
game in the repo implements it. `PROJECT_MEMORY.md` records that the embed contract vs. the hub's
actual full-page-link behaviour is an *undecided* architecture question. This game satisfies the
contract because it was cheap to do while the code was fresh — treat it as proof the contract is
satisfiable, not as evidence the hub embeds anything.
