**Which game?** Gyro Fleet (`gyro-fleet/`). Not a hub card yet.
**Which finish-line item does this close?** None on the hub list. It's pass 1 of the one-loop design Ry agreed on 2026-11-13 (thread "Ivy - Gyro Space Game Loop"): flight that feels right before sites, siphon and classes exist. It also answers Ry's 2026-11-08 playtest (trackpad gear-flipping, enemies seen for a split second, aiming = flying into them).

# Gyro Fleet, flight pass (2026-11-13)

## Asked for (Ry, 2026-11-13)

Hold right-click = thrust (not RTS click-to-move). Hold Space = jump drive with a 2 s spool, no turning at burst speed, release to drop out. Auto-brake at the edge of a fight. Gears and Shift+wheel go. Strafe on hold-Shift (right-click is thrust now). No sites, siphon or classes in this pass.

## What was built (`gf-flight.js`, plus small hooks)

| | |
|---|---|
| Cruise | Released, the flown ship eases to 1x cruise (10 u/s). Never stops dead, no drift. |
| Thrust | Hold right mouse: 4x (40 u/s), faster than airkrill (19). High grip, so turns are snappy. |
| Jump | Hold Space: 2 s spool (steerable, dashed aim line + ring), then 1000x (10,000 u/s, home to hive in ~3 s) on the locked heading. Release Space to drop out. |
| Auto-brake | During a burst, any fight ahead (the hive, or a pod's Bellwether) stops the ship 250 units outside it, facing it, with a DROPPING OUT cue. Fights you jumped from are ignored. Burst velocity is zeroed on drop-out, so no overshoot. |
| Strafe | Hold Shift: the ship holds its line, the gun follows the cursor (amber lines). Works with thrust for a committed pass. |
| Fire | Click fires toward the cursor; shots now carry the ship's velocity, so you can't outrun them. |
| Gears | Gone from Q (Shift+wheel, Shift+arrows, Space = gear 0). `glHyperGear` mirrors the drive (0 cruise, 1 thrust, 3 jump) so engine sound and shift cues still play. E-mode formations keep Shift+wheel until the wing pass. |
| Removed in Q | The lab's right-click trajectory lock and shift-click probe drop. |

Tunables are in `GF_FLIGHT` at the top of `gf-flight.js`.

## Verified (headless Chromium, file://)

- 0 errors. Cruise 10 u/s, thrust 40, back to 10 on release.
- Strafe: heading drift 0 with the cursor swung away.
- Jump toward the hive: spool 2 s, burst at 10,000 u/s, auto-brake 394 units from the hive centre (250 outside its edge), ship alive, facing it.
- A shot fired at thrust leaves at 80 u/s (40 own + 40 ship).
- `check-global-collisions` and `check-undefined-globals` pass.
- **Not yet played by a human.** Things to judge: thrust and cruise speeds, the 250-unit brake ring (the hive is still off screen at the default zoom), the spool length.
