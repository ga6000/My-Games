# Glucose Dash — local notes

> **Shelved 2026-09-05.** This game now lives at `under-development/glucose-dash/`, moved at the
> user's instruction. It is **still in the repo and still on GitHub** — it just has no card on the
> hub board, which was already true in practice: the tracker had it under *"Built, not
> hub-linked"*, an open gap since 2026-08-29. The move makes a de-facto status official rather
> than removing anything.
>
> Everything reaching outside this folder is now `../../`, not `../`. Only `glucose-dash.html`
> has any: `../../shared/identity.js` and `../../shared/mp-core.js`.
>
> It nonetheless got its full Split + Aesthetic pass on the same day, which is a **deliberate
> exception** to `under-development/README.md`'s "don't do speculative work on shelved games" —
> the work was already scoped and the file already understood. Recorded so it does not read as
> precedent.

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

## Twelve files (split 2026-09-05)
Was one self-contained `glucose-dash.html` with a 2,363-line inline script. It is now
`glucose-dash.html` plus twelve `gd-*.js` classic scripts, loaded in this order — which is also
the game's start-up order, since `gd-boot.js` ends by calling `GameInstance.init("gd-root")`:

| File | Lines | Holds |
|---|---|---|
| `gd-core.js` | 91 | boot and lifecycle |
| `gd-tune.js` | 188 | `TUNE`, `FOODS`, and all mutable state |
| `gd-course.js` | 308 | course build — the mall geometry |
| `gd-glucose.js` | 93 | the glucose model |
| `gd-runners.js` | 320 | runners and physics (`stepRunner`) |
| `gd-ai.js` | 194 | NPC AI |
| `gd-render.js` | 524 | camera + the top-down floor plan renderer, **and the gel** |
| `gd-hud.js` | 210 | HUD |
| `gd-audio.js` | 36 | audio — tiny, gesture-gated, procedural |
| `gd-input.js` | 55 | input |
| `gd-flow.js` | 198 | race flow and screens |
| `gd-boot.js` | 146 | sizing, `window.GameInstance`, boot |

Cut in **strict source order**; nothing reordered, nothing reindented.

**Every file carries its own `"use strict"`.** The original had one directive covering the whole
script. A classic-script split gives each file its own scope for it, so omitting it would have
dropped eleven of the twelve into sloppy mode — a semantic change, not a cosmetic one. If you add
a `gd-*.js`, it needs the directive too.

No `type="module"` anywhere, so double-click over `file://` still works fully (there's no
Firestore dependency to degrade). Section map is in `SCOPE.md` §8; the file boundaries above
follow it exactly.

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

## The GEL cabinet (2026-09-05) — `AESTHETIC_GUIDE.md` §6.5, option (a)

§6.5 offers two routes and is explicit that **(b), inverting to a black ground, "overturns a
deliberate call, so it is the user's decision, not a silent change."** That decision has not been
made, so this is **(a)**: the white mall stays, and each storey gets a hard-edged sheet of
coloured plastic (§4.5) so the three floors read as three physically different strips.

`GEL` in `gd-render.js` is `["#C9F5D4", "#BFE9FF", "#FFC2DC"]` — green, blue, pink by storey.
**Ordered that way on the second attempt, and the reason is worth keeping:** the first pass put
pink on the ground floor (it is this game's `--world-hue`), and pink sat pink-on-red against the
warm storefront signage, costing the storefronts exactly the separation §6.5 says to protect.
Green on the floor you spend the most time on gives warm signage the most contrast — and green
across the bottom band is literally what Space Invaders' own gel did.

**Why this does not violate rule 1 below.** The gel adds **no geometry**. It is a `multiply` pass
laid *inside the clip `pathWalkable()` already established*, so it covers exactly the floor that
path describes and cannot drift from it by construction. The hard edge §4.5 asks for is the clip
itself. Storefronts are drawn **after** the floor plate, on top of the gel, so they keep full
saturation and the protected intent survives.

The `save()`/`restore()` around the composite-op change is doing real work, not ceremony:
`drawFloorPlate` runs once per visible storey, and leaking `"multiply"` into the next one would
tint the floors below through each other.

Also: `data-game="glucose-dash" data-cabinet="gel"`, and §4.6 scanlines attached to
`#gd-stage::after` — gated on `data-cabinet` exactly like the class version in `retro.css`, and
done as a pseudo-element so nothing in the game's own DOM construction had to change.

**The mall's own signage is deliberately NOT retro-typed.** Only the HUD moved onto `--font-ui`.
A shopping centre whose store names read as 1978 arcade would fight the one thing §6.5 protects.

**Audio was not touched.** `Audio Design?` was already `Yes` — `gd-audio.js` is procedural and
gesture-gated, and `shared/sfx.js` was in fact derived from it. Re-pointing this game at `SFX`
would be an audio rewrite of a column that is already green, so `retro.js`/`sfx.js` are not
loaded here at all.

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

Then `http://127.0.0.1:8731/under-development/glucose-dash/glucose-dash.html`. **This is not
optional advice — it was re-confirmed on 2026-09-05.** Loaded in a pane that is not painting, the
game froze on the "3" of its own countdown and stayed there: rAF simply does not fire. Driving it
from the console ran 2,400 steps in one call and reached floor 2 at 1,138m without trouble.

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
cat under-development/glucose-dash/gd-*.js | grep -oE '^function [A-Za-z_$][A-Za-z0-9_$]*' | sort | uniq -d
``` Also worth re-checking `GameInstance.destroy()` still leaves nothing
behind (timers, listeners, socket, RAF, DOM) and that `init()` can be called again after it —
that round-trip is verified working today.

<!-- doc-sync: a2074372 | 2026-09-05 -->
