# Zombie Arcade — a better lighting solution (proposal, 2026-10-11)

**Game:** hub ZOMBIE ARCADE. **Finish-line item:** `HUB_RETROSPECTIVE.md` §5 item 2 (a finished,
readable Zombie). **Status: DECIDED AND BUILT 2026-10-11, option A** (user's pick). Built as written under "Option A,
concretely"; see `zombie/CLAUDE.md` "Seventh". Not judged by a human yet, and B is one gradient away if
seven bands still read as hard.

## What was reported

Light levels are *"generally acceptable, maybe slightly too low"*, but: hard-edged bands, a stark
light-to-dark, **objects that block light can't be seen** (warehouse racks, hedges, silos), and
*"the dark within those squares makes things look a little bit odd"*.

## What the code does (so the fixes are aimed correctly)

`arcadeDrawLighting()` in `zombie-arcade.js` paints one offscreen darkness layer over the *finished*
frame (outdoors alpha 0.74, warehouse 0.95), then cuts light out of it with `destination-out`.
Every light is clipped to `visPoly()`, a raycast against **every wall**, and every wall includes the
tall props at their **whole drawn height** (hedge, rack, tank, tree: footprint + lift).

That explains all three symptoms from one cause:

1. A ray stops at the *near face* of the prop's rect, so the **prop's own body is outside every
   visibility polygon**. The darkness layer is then drawn over it at full strength: a hedge or rack
   is a black hole with a lit floor around it, i.e. "can't see objects that block light".
2. The "dark squares" are those same bodies, plus the shadow wedge behind them. The shape of the
   hole is the prop's rectangle, which is why it reads as a *square* of nothing.
3. `ARC_LIGHT_BANDS` is 4 steps (`1 / .66 / .36 / .12`) over a ground at 0.74–0.95 darkness. The last
   step down to ambient is the stark edge, and the warehouse at 0.95 is near-void.

## The constraint to raise first (checklist item 9)

`hub-visual-review` item 9, decided by the user on 2026-10-09: *light steps in flat bands, never a
smooth ramp*. The complaint about "hard edge bands" cuts against it. **Three honest options:**

| | What | Cost |
|---|---|---|
| **A. Stay in bands, but finer and never black** (recommended) | 7 bands instead of 4; lift the ambient floor; make props visible by lighting their faces. Still stepped, so the pillar holds | Smallest change; the "stepped" look stays, just much finer |
| **B. Smooth the world light, keep the flashlight banded** | A dated deviation from item 9 for lamps/sun/ambient only | Reverses a 2026-10-09 decision; the cabinet look weakens |
| **C. Amend the pillar** | Make smooth light the rule | Touches the other four cards' direction too |

I recommend **A**, then looking at it before deciding B is needed. If seven bands still read as
"hard", B is a one-line change per gradient (`bandGradient` → a ramp), so nothing is lost by trying A.

## Option A, concretely (three changes, each independent)

1. **Light the faces of whatever blocks the light.** In `visPoly()`, once a ray has found the entry
   point of a blocker, let it run on *into the prop by up to its footprint depth* (min(w, h, ~26px)).
   The visibility polygon then includes the lit front slab of every hedge, rack, tank and tree, so
   the thing that blocks the light is visibly lit on the side facing it. This is the entire fix for
   symptom 1, it is about ten lines, and it needs no draw-order change.
2. **A floor under the dark.** Outdoors 0.74 → ~0.62; warehouse 0.95 → ~0.80; tint a deep blue
   (`#06101C`-ish) instead of black so what is left is a colour, not a void. Props keep a faint rim
   (the existing flat shadow band) so silhouettes survive at 0.80. This is the "slightly too low"
   fix and the "dark squares" fix together.
3. **More bands.** `ARC_LIGHT_BANDS` from 4 to 7:
   `[[.15,1],[.3,.86],[.45,.7],[.6,.52],[.75,.36],[.9,.2],[1,.1]]`. `TORCH_LAYERS` 3 → 4 so the beam
   still steps sideways. No dithering (`AESTHETIC_GUIDE.md` §4.12 lists it as a don't).

**Not recommended:** drawing tall props *after* the darkness layer with a computed per-prop
brightness. It is the "correct" fix and it is a draw-order rewrite (`arcadeDrawTall` is sorted with
zombies and players), and change 1 gets most of the result for a tenth of the work.

## Verification (what I would do, and its limit)

- Capture a full-resolution canvas, not a Browser-pane thumbnail: a thumbnail cannot judge soft
  light. Frames: tank 1's hedge rings at night, inside the warehouse by the racking, a tree patch,
  and a busy frame with the flashlight and three lamps overlapping.
- Cost: `visPoly` is ~3.6ms a frame today; change 1 does not add rays, only extends them.
- The warehouse sun shafts must still read as shafts at 0.80, so check them first.

## Questions

1. A, B or C? (A first, then re-judge, is my pick.)
2. Is the warehouse's near-black interior a *feature* (a scary dark building) or a casualty? The
   plan above assumes casualty; if it is a feature, keep 0.95 and only light the rack faces.
