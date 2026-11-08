# gyro-fleet/ — Gyro Fleet

**Local playtest build. Not on the hub, not multiplayer, not shipped.** Double-click
`gyro-fleet.html`. It runs over `file://` with no server.

Gyro Fleet is the game Ry is building out of the Gyro Lab bench (started 2026-11-08). In the
hub's shared story it's a space chapter of the aircrab invasion. Humanity's mothership has
launched, and crews lead wings of expendable ships against the creature hives.

## Where things are

- **New game code is prefixed `gf`/`GF`** and lives in `gf-*.js`. Pass 1 has one file,
  `gf-crabs.js`: the hive, pods, aircrabs, airkrill, the Bellwether, the breath rule, tendril grabs,
  hull, the nav targets and the HUD line.
- **The engine is Gyro Lab's, unchanged where possible, and keeps its `gl`/`GL` names**: ship
  flight, gears, fleet/boids (E), autopilot, the vector lens, audio and the mini-map. Its full history
  and the reasoning behind each piece are in `lab-plans/GYRO_LAB_CLAUDE.md` and the
  `lab-plans/*_PLAN.md` files. Read those before changing engine behaviour.
- **Hooks from the engine into gf code:** `gfUpdate(dt)` at the end of `glSimulate` (gl-sim.js),
  `gfDrawWorld(c)` before `glDrawShips` (gl-draw.js, lensable),
  `gfDrawOverlay(c)` and `gfNavTargets(s)` in the overlay and nav arrows, `gfHudLine()` in the
  HUD, and `gfInitBattle()` plus the battle-space block at the end of gl-boot.js.
- **Panel locks** use their own localStorage keys (`gyrofleet-locks-v1`), so they don't mix with an
  archived Gyro Lab opened from the same folder.

## The archive

The real-scale Milky Way bench is archived, not deleted:
- GitHub branch `archive/gyro-lab-2026-11-08`. Restore with
  `git checkout archive/gyro-lab-2026-11-08 -- gyro-lab`.
- Ry's OneDrive: `Documents\Projects\Game Development\archive\2026-11-08 gyro-lab (gravity + lensing bench, pre-redesign)`.

The galaxy code (`gl-galaxy.js`, `gl-chunks.js`) is still loaded here, because Sol, Earth and the
mini-map read it. The streamer is simply never called. Sgr A* still exists as hole #1, 26,000 ly
away, because `glHole` needs one.

## Design calls so far (Ry, 2026-11-07 / 11-08)

- PvE only. Auto-brake at the edge of a battle (not built yet). Opt-in ram with an impact frame (not built yet).
- No drift and no stopping dead: strafing is a committed pass, tuned by playtest.
- Six crew classes, a hex spawn room, and each crew member commands a wing of bots of their class.
- The human mothership is 5 km, solid hull plus lattice mesh. The Tide (alien mothership) is about
  Florida-sized.
- Creatures: aircrab, airkrill (minion), Bellwether (alpha, breath sync), The Tide, the Hurls.

## Pass log

| Pass | Plan | State |
|---|---|---|
| 1 (2026-11-08) | `GYRO_FLEET_PASS_1_PLAN.md` | Enemies in groups, breath rule, Bellwether wave. **Not yet human-played.** Next: Ry's controls playtest. |
