# Glucose Dash — local notes

**Read `SCOPE.md` in this folder first.** It holds the design decisions, the balance numbers and
why they are what they are, the open questions, and the hub/server integration plan. This file is
just the orientation.

## What it is
Overhead 3rd-person footrace down a three-storey mall corridor. Car-style physics. The resource
is blood glucose, not stamina: it falls the whole way, food is scattered through the storefronts,
and glucose sets your **top speed** as well as whether you finish at all.

Light mall aesthetic: white walls and a white checkered floor, with all the colour saved for the
storefronts so the thing you're steering toward is the only saturated object on screen. The
camera sits *below* wall height, so on the ground floor you are inside the corridor rather than
looking down at a diorama.

## One file
`glucose-dash.html` — self-contained, inline `<style>` and `<script>`, plus a classic
`<script src="../shared/mp-core.js">`. No `type="module"` anywhere, so double-click over `file://`
works fully (there's no Firestore dependency to degrade). Section map is in `SCOPE.md` §8.

## The renderer is top-down 2D (v5) — and that is deliberate
The game used a pseudo-3D perspective renderer for four revisions and every graphical bug came
from the projection: near-plane clipping, cross-category depth sorting, billboarded text,
white-on-white silhouettes, and a duplicate `quad()` that shadowed a fix for a whole revision.
The 2D renderer makes all of those *unrepresentable*. If you are tempted to reintroduce
perspective, read `SCOPE.md` §7b first. The old build is kept at
`glucose-dash-perspective.html.bak`.

Three rules:

1. **`SX(tx, ty)` takes a y as well as an x.** That is the entire curvature implementation on the
   render side — the centreline `centerX(y)` is added there and nowhere else. Physics, collision
   and AI stay in flat track space and never see the curve.
2. **`pathWalkable(f)` is the single source of floor geometry.** It is built from exactly the
   regions `walkLimit()` treats as standable, and the fill, the checkerboard clip, and the
   wall/hazard stroke all come off that one path. Do not draw the floor from anywhere else —
   when the drawn floor and the walkable floor disagreed, every upper storefront had an invisible
   hole at each end (`SCOPE.md` §5.3).
3. **Draw order is source order.** There is no depth, no sorting, no bias. Levels below are drawn
   first and covered by your own floor; whatever shows through is the drop.

## Geometry: the mall narrows as it climbs
`FLOOR_HALF = [11, 7.5, 5]` and `BAY_OUT = [17.5, 12.5, 9]`. The ground floor has walls; floors
2 and 3 are **railless balconies you can fall off**, and storefront platforms hang out over the
drop. That is the risk/reward structure, not decoration — see `SCOPE.md` §4 for what it measured.

Three things exist purely to keep falling *fair*, and removing any of them makes the upper floors
feel broken rather than risky:
- `BAY_RUNOFF` — walkable room past each end of a storefront platform, and the platform is
  **drawn longer than it is walkable**. Ground you can see is always ground you can stand on.
- `APRON_IN` / `APRON_OUT` (12 / 28) — stair landings are asymmetric. You leave a staircase at
  x=8 onto a balcony that is 5 wide; you need far more room on the way out than on the way in.
- `EDGE_GRACE` — your foot catches the lip. Without it a near-miss you were already correcting
  reads as the game cheating you.

`walkLimit()` is the single authority on "can I stand here". `bayAt()` must agree with it — when
they disagreed, every platform had an invisible hole at each end (`SCOPE.md` §5.3).

## Before changing anything
- **All balance numbers live in `TUNE` and `FOODS`.** Don't scatter magic numbers into the
  physics or AI; if you need a new knob, add it to `TUNE`.
- **`TUNE.baseDecay` and the food density in `buildItems` are ONE dial.** Changing either alone
  swings the balance hard in opposite directions — denser food makes every route safe and kills
  the gamble; sparser food collapses the NPC field. Re-measure both together.
- **Several constants are scaled to the course length.** `COURSE_LEN` is 3300; the NPC planning
  horizon, food density and scan ranges were all silently wrong when it was doubled from 1650.
  If you change it again, re-check `npcThink`'s horizon and `NPC_SCAN_AHEAD` first.
- **Two randomnesses, and confusing them is a real bug.** `COURSE_SEED` (a constant) builds the
  mall — identical for everyone, every run, forever. `MP.random()` (the server's room seed)
  picks which candidate slots are stocked this race. World layout must never touch `MP.random()`
  in a way that makes it differ between clients, and slot choice must never use `COURSE_SEED` or
  every race stocks the same shops.
- **`stepRunner` is shared by the player and every NPC.** An NPC that cheats physics is the
  fastest way to make a race feel unfair. Change handling in one place.

## How to test it properly
rAF is throttled in a background pane, so watching it is a bad way to check anything. Drive it
instead — serve the repo root and run the sim from the console:

```bash
python -m http.server 8731 --bind 127.0.0.1
```

Then in the page: `startRace(); phase="racing"; keys.ArrowUp=true;` and step `update(1/60)` in a
loop, reading `player`, `runners` and `items`. Every bug in `SCOPE.md` §5 was found this way and
none was visible from play — a compounding friction term just feels "heavy."

**Use at least 24 samples.** NPC decision timing uses `Math.random()`, so races are not
reproducible even from a fixed seed; 8-10 samples swung measured DNF rates by 20+ points during
tuning and led to two wrong conclusions before I noticed.

Call `render(); updateHUD(1/60)` after stepping if you want to screenshot a specific moment.

## Verify before calling a phase done
```bash
node scripts/check-global-collisions.js
```
Run from the repo root. Also scan for duplicate definitions *inside* this file, which that script
cannot catch:

```bash
grep -oE '^function [A-Za-z_$][A-Za-z0-9_$]*' glucose-dash/glucose-dash.html | sort | uniq -d
``` Also worth re-checking `GameInstance.destroy()` still leaves nothing
behind (timers, listeners, socket, RAF, DOM) and that `init()` can be called again after it —
that round-trip is verified working today.
