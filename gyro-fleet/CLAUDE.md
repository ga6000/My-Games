# gyro-fleet/ — Gyro Fleet

**Local playtest build. Not on the hub, not multiplayer, not shipped.** Double-click
`gyro-fleet.html`. It runs over `file://` with no server.

Gyro Fleet is the game Ry is building out of the Gyro Lab bench (started 2026-11-08). In the
hub's shared story it's a space chapter of the aircrab invasion. Humanity's mothership has
launched, and crews lead wings of expendable ships against the creature hives.

## Where things are

- **New game code is prefixed `gf`/`GF`** and lives in `gf-*.js`:
  `gf-crabs.js` (creatures, The Tide and its orifices, the round, rupture and ricochet rules), `gf-flesh.js` (how creatures and The Tide are drawn), `gf-wing.js` (wing bots and orders, the siphon capacitor, score, the game sidebar and its maps), `gf-flight.js` (controls, the jump and its ultradrive cues), `gf-view.js` (backdrop, Earth, camera, readability), `gf-arms.js` (weapons, the flown ship's look), `gf-sfx.js` (sound cues), `gf-crew.js` (the six crew: hulls, primaries, K abilities, bot copies, and the L+G dev menu), `gf-cine.js` (set pieces: a satellite freed, the mothership's beam, the last swarm).
- **The parameter panel and the engine HUD are hidden in the game.** Open `gyro-fleet.html?dev` to get them and the engine's dev keys (E, H, C, O) back.
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
- Controls (Ry, 2026-11-14): Zombie-family twin-stick WASD + cursor aim, WITH slide, Space boost (hold out of combat = jump), hold to fire. The hull faces WASD; a turret tracks the cursor. The game owns the zoom in Q. Supersedes the 11-08 "no drift" lean; tune slide by playtest.
- Six crew classes, a hex spawn room, and each crew member commands a wing of bots of their class.
- The human mothership is 5 km, solid hull plus lattice mesh. The Tide (alien mothership) is about
  Florida-sized.
- Setting (Ry, 2026-11-14): HIGH EARTH ORBIT, Earth a massive backdrop; you launch from the human mothership and jump across the globe. Classes get different weapons.
- Creatures: aircrab, airkrill (minion), Bellwether (alpha, breath sync), The Tide, the Hurls.

## The one-loop design (Ry, 2026-11-13)

Gyro Fleet is the hub story's FINAL game. Space Tracer is scrapped; a second, smaller game on this engine, TAKEOFF (Earth launch-to-orbit battle in low orbit), comes before it and is scoped for later.

Launch from the hex bay, jump between 3 sites, crack breathing vents, harvest SIPHON (the one currency; since 2026-11-15 a small leaking CAPACITOR, not a bank: spend it in seconds on a bot or a hull mend, or lose it). Site 3 is the enemy mothership (The Tide); after it falls every remaining enemy floods toward the main player character, and surviving that wins. "Auto" is not a class: it's a FOLLOW / AUTO wing order. Each class gets a distinct ship look. Pass order: flight -> one site (vents, wrecks, siphon) -> classes + wing orders + ship looks -> The Tide, the flood, round end, hub card.

## Pass log

| Pass | Plan | State |
|---|---|---|
| 1 (2026-11-08) | `GYRO_FLEET_PASS_1_PLAN.md` | Enemies in groups, breath rule, Bellwether wave. Ry played it 2026-11-08: navigation was the problem. |
| flight (2026-11-13) | `GYRO_FLEET_FLIGHT_PLAN.md` | Right-click thrust, Space jump + auto-brake, Shift strafe, gears gone from Q. Ry played it 11-14: hard to control and read. |
| flight 2 / 2b (2026-11-14) | same file | WASD + aim + hold fire, slide, Space boost/jump, brake outside pod reach, fight camera, parallax backdrop, trails, reach rings, edge markers. Ry played it. |
| 3 (2026-11-14) | same file, last section | High Earth orbit (Earth backdrop, mothership home), closer zoom, snappier flight, detailed ship, shaped blaster bolts, seeker missiles, depth dust (`gf-arms.js`). Ry played it 11-15: slow, low detail, endless, not compelling. |
| flood (2026-11-15) | `GYRO_FLEET_FLOOD_PLAN.md` | The Tide with three orifices, a round that ends with a score, faster ship and shots, slow-turning creatures, ruptures and live ricochets, siphon capacitor, wing with FOLLOW / HUNT, fleshy creatures, game sidebar with maps, ultradrive cues on the jump and on bots. Ry played it: "massive improvement", too easy. |
| flood 2 (2026-11-15) | same file | Harder, fuse + shards + frenzy on ruptures, ricochets return to the shooter, `gf-sfx.js`, no text labels, slim sidebar. Ry played it: "a good foundation". |
| flood 3 (2026-11-15) | same file | Bolt streak and spool streak fixes, ONE breath per site with a gauge, Bellwether kill winds its brood, three sites (RELAY, DRYDOCK, THE TIDE) with The Tide clamped until both satellites are freed, boons per satellite, 8:00 clock. Ry played it: balance "much improved". |
| flood 4 (2026-11-16) | same file | Stray arcs fixed, lungs that fill like lungs, lamprey mouth, no tendril rings, 6.5 s grab, keys H / J / K, visible breath fronts, bot drop-in shockwave. Ry played it. |
| 5 (2026-11-16) | same file | Crush and launch (bunched bodies squash on the inhale, fire apart, tumble), six crew in `gf-crew.js`, K = crew ability, L+G dev menu, 3.5 s aftermath before the score. Ry played it. |
| 6 (2026-11-16) | same file | Grapple bites in three ticks, last stand (1 hull + 3 s safe), no ricochets while held, drawn battle lines that gate the ultradrive, jumps snap out at every site, Elodie's mine stock, bone cage on clamped mouths, true-scale maps, allied crew ships from the dev menu. Ry played it. |
| 7 (2026-11-16) | same file | `gf-cine.js`: satellite-freed sequence (growth bursts, green lights, sight on the hive), the beam finale through both satellites, the hive bursts into a 450-airkrill swarm that ends the game. **Not yet human-played.** |
