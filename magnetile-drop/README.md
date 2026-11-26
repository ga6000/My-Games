# Magnetile Drop (standalone, not part of the PLEURA hub)

Drag magnet tiles out of a 5-slot tray and drop them onto an isometric floor. The tiles have
real thickness and rigid-body physics (cannon-es), plus edge magnets that pull parallel edges
together and then let them hinge, so walls, corners and boxes stand up.

Play: open `index.html` (works straight from disk, or on GitHub Pages).

## Controls
- Drag from the tray, release over the floor. Flick as you release to throw.
- While holding, each press turns the tile a fixed 45 deg (Shift: 15 deg), holding repeats:
  W/S tilt away/toward, A/D spin left/right, Q/E roll left/right. R stands it on edge,
  F lays it flat, wheel raises/lowers it, Space drops, Esc puts it back.
- The held tile floats (no gravity) from its centroid and magnets tug it onto nearby edges.
- 1-5 grab a slot without dragging (click to drop). Click a placed tile to pick it up again.
- Left/Right arrows rotate the view, wheel zooms (when not holding), M magnets, C clear, P pause, H help.

## Magnets (pass 3)
- Parallel edges within 0.4 tile pull together (420 vs gravity 130). Touching, well-aligned
  edges lock into capped point-to-point joints (2500 x mass; two per long edge = a hinge),
  which let go if stretched past 0.15.
- A held tile feels magnets once it has caught up with the cursor. When one of its magnets
  seats on an edge, the hand goes soft so the magnets pull it flush; drag 0.75 away to tear it free.
  Let go while seated and it locks at once. It never pulls placed tiles toward itself.
- Held tiles hover just 0.06 above the surface. Pointing at the side of a standing tile aims
  beside/behind it (so the 4th wall of a box can go in); a flat held tile aims on top (roofs).
- Pulling only happens while held or for 3 s after a drop, so settled builds sleep.
- R stands a tile on an edge with the bottom edge parallel to the screen.

## Files
- `src/main.js` is the source. `src/lib/` holds vendored three.js r170 and cannon-es 0.20 (MIT).
- `magnetile-drop.js` is the shipped bundle. Rebuild after editing `src/`:
  `npx esbuild magnetile-drop/src/main.js --bundle --minify --format=iife --outfile=magnetile-drop/magnetile-drop.js`
- Tunables (gravity, magnet strength, refill speed, hold height, fling) are in `CFG` at the top
  of `src/main.js`. `window.MD` exposes the game state for testing.

## Assumptions (Ry to steer)
- Sandbox, no win/lose. The HUD shows tile count and tallest resting height (cm, 1 tile = 7.5 cm).
- Five shapes: big square, small square, equilateral, right and tall triangles; six colours.
- Tray refills 0.22 s after a pick, with weighted random shapes.
- Magnets attract any edge (no polarity), parallel edges only; a blocked pair gives up after
  0.6 s so piles settle.
