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

---

# Flight pass 2 (2026-11-14): twin-stick + readability

## Asked for (Ry, 2026-11-14, after playtesting pass 1)

Pass 1 was hard to control: hard to shoot while evading, hard to read enemy speed, no sense of own speed, and auto-brake dropped him into tendrils with no moment to orient. Ry's call: Zombie-family controls (WASD + cursor aim) **with a bit more slide**, Space boost, **hold to fire**. Plus my five fixes and a parallax backdrop for orientation.

## What was built

| | |
|---|---|
| Move | WASD (screen directions), 35 u/s. Velocity eases at `slide` 0.035/frame (about 0.5 s to settle), so the ship slides. Lets go to a stop. |
| Aim / fire | The nose tracks the cursor. Hold left mouse: 7 shots/s toward the cursor, carrying the ship's velocity. |
| Boost / jump | Space = boost (70 u/s; with no keys held it pushes along the nose). Out of combat (no creature within 1,000), holding Space past 0.35 s spools the jump (1.6 s, aim line = cursor), then jumps at 1000x. Release to drop out. In combat Space only boosts. |
| Auto-brake | Now 1,200 units OUTSIDE the hive or a pod (pods hunt from 900), so you arrive unseen and nearly still. |
| Fight camera | Near a fight the zoom frames the nearest creature (wide right after a drop-out, then eases in as you close). A wheel zoom pauses it for 5 s. |
| Backdrop (`gf-view.js`) | FAR: nebula tile, Earth at home, the hive's red glow (slow, so they point home / hive). MID: hashed rocks at 1.4 px per unit of travel. NEAR: speed dust that streaks with the camera. |
| Readability | Creature trails (0.6 s of travel), dashed tendril-reach rings on big armoured creatures (brighten during the tell), edge markers for creatures within 2,600 that are off screen, a velocity tick on your ship. |
| Removed | Right-click thrust and Shift strafe (twin-stick makes them unneeded). Right mouse is free in Q (candidate for wing orders). |

## Verified (headless Chromium, file://)

- 0 errors, 60 fps. D held: 11 u/s after 0.15 s, 33 after 1.35 s; released: 17 after 0.3 s, ~0 after 1.8 s.
- Hold fire: 7 shots in 1 s.
- Space toward the hive: boost 31 -> spool -> jump -> drop out 1,340 from the hive centre, nearest creature 1,389 (outside hunting range), hull 100. Camera framed the hive and both pods (zoom 6.8 -> 0.25).
- Static checks pass. **Not yet played by a human.** To judge: slide amount, move/boost speeds, the zoom-out on arrival, whether the backdrop helps.
