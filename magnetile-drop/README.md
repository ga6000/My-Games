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

## Magnets (pass 2)
- Parallel edges within ~0.38 tile pull together; touching edges lock with capped
  point-to-point joints (two per long edge = a hinge). Stretch a joint past 0.07 and it lets go;
  picking a tile up breaks its joints.
- Pulling only happens while a tile is held or for 1.5 s after it is dropped. Settled tiles
  keep their joints but stop tugging, so big piles go to sleep.
- A held tile passes through everything while it is catching up with the cursor or moving fast.

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
