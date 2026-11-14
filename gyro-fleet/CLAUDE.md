# gyro-fleet/ — Gyro Fleet

**Local playtest build. Not on the hub, not multiplayer, not shipped.** Double-click
`gyro-fleet.html`. It runs over `file://` with no server.

Gyro Fleet is the game Ry is building out of the Gyro Lab bench (started 2026-11-08). In the
hub's shared story it's a space chapter of the aircrab invasion. Humanity's mothership has
launched, and crews lead wings of expendable ships against the creature hives.

## Where things are

- **New game code is prefixed `gf`/`GF`** and lives in `gf-*.js`. Pass 1 has one file,
  `gf-crabs.js` (creatures), `gf-flight.js` (controls), `gf-view.js` (backdrop, camera, readability). `gf-crabs.js` holds the hive, pods, aircrabs, airkrill, the Bellwether, the breath rule, tendril grabs,
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

- PvE only. Auto-brake at the edge of a battle (built in the flight pass). Opt-in ram with an impact frame (not built yet).
- Controls (Ry, 2026-11-14): Zombie-family twin-stick WASD + cursor aim, WITH slide, Space boost (hold out of combat = jump), hold to fire. Supersedes the 11-08 "no drift" lean; tune slide by playtest.
- Six crew classes, a hex spawn room, and each crew member commands a wing of bots of their class.
- The human mothership is 5 km, solid hull plus lattice mesh. The Tide (alien mothership) is about
  Florida-sized.
- Creatures: aircrab, airkrill (minion), Bellwether (alpha, breath sync), The Tide, the Hurls.

## The one-loop design (Ry, 2026-11-13)

Gyro Fleet is the hub story's FINAL game. Space Tracer is scrapped; a second, smaller game on this engine, TAKEOFF (Earth launch-to-orbit battle in low orbit), comes before it and is scoped for later.

Launch from the hex bay, jump between 3 sites, crack breathing vents, shoot wrecks into SIPHON (the one currency: medic heals with it, anyone calls bots with it). Site 3 is the enemy mothership (The Tide); after it falls every remaining enemy floods toward the main player character, and surviving that wins. "Auto" is not a class: it's a FOLLOW / AUTO wing order. Each class gets a distinct ship look. Pass order: flight -> one site (vents, wrecks, siphon) -> classes + wing orders + ship looks -> The Tide, the flood, round end, hub card.

## Pass log

| Pass | Plan | State |
|---|---|---|
| 1 (2026-11-08) | `GYRO_FLEET_PASS_1_PLAN.md` | Enemies in groups, breath rule, Bellwether wave. Ry played it 2026-11-08: navigation was the problem. |
| flight (2026-11-13) | `GYRO_FLEET_FLIGHT_PLAN.md` | Right-click thrust, Space jump + auto-brake, Shift strafe, gears gone from Q. Ry played it 11-14: hard to control and read. |
| flight 2 (2026-11-14) | same file, second half | WASD + aim + hold fire, slide, Space boost/jump, brake outside pod reach, fight camera, parallax backdrop, trails, reach rings, edge markers (`gf-flight.js`, `gf-view.js`). **Not yet human-played.** |
