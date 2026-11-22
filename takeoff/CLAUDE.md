# takeoff/ — Takeoff

**Local playtest build. Not on the hub, solo, Greer only.** Double-click `takeoff.html`. It runs
over `file://` with no server.

Takeoff is the hub story's Act IV/V hinge: the crew escort the human mothership from the ground
to orbit, just before Gyro Fleet (the final game). Design brief: the Claude Doc "Takeoff — Design
Brief" (https://claude.ai/artifact/ULtYapPQncYKECB5huFxvx), settled 2026-11-21 in the Max thread.

## Where things are

Code is prefixed `to` / `TO`. Classic scripts, one shared scope, loaded in this order:

| File | What |
|---|---|
| `to-core.js` | canvas, camera (world y is UP), input, teardown (`toAbort`, `toTimeout`), score, particles |
| `to-sfx.js` | Web Audio sfx, the music loop and its moods, the countdown voice (Web Speech API) |
| `to-ship.js` | Greer's ship: heavy flight, booster, shared meter, twin blaster, caught/wriggle, death, respawn, straggler blast |
| `to-mother.js` | the mothership: launch, home position, being held, shared hull, docking ports, drawing |
| `to-flesh.js` | creature drawing, borrowed from Gyro Fleet's `gf-flesh.js` (renamed gf to to) plus the plankton placeholder |
| `to-foes.js` | airkrill, air plankton, aircrabs, the Bellwether, debris, spit; the breath rule; bolt hits |
| `to-gates.js` | tendril gates and the boss gate: wall, grip, weak spots, catch, snap, failed-gate blast, lightning |
| `to-phases.js` | the round: title, crawl, launch countdown, the climb plan (`TO_PLAN`), director, orbit, dock, end, card, dev keys |
| `to-draw.js` | sky, silo and ground, clouds, Earth, HUD, title/crawl/card, the frame loop, `GameInstance` |

**Engine choice (Ry, 2026-11-21):** borrow Gyro Fleet's look, weapons, creatures and sfx into a
lean vertical-scroll loop. It does NOT load the `gl-*` orbit sim.

## Controls

WASD fly (heavy, slidey, gravity pulls down), SPACE booster (in the WASD direction, straight up if
none), hold left click to fire at the cursor. Boosting and firing share one amber meter under your
ship that refills over time. Caught on a tendril wall: tap SPACE to wriggle free (costs meter), or
you slip free after 4.5 s.

**Dev menu:** hold L + G, then 1 climb, 2 gate 1, 3 gate 2, 4 gate 3, 5 boss gate, 6 orbit, 7 dock,
minus = no damage, equals = refill hull, ship and meter.

## The round (pass 1)

Launch countdown (11 s) → climb 24 s → gate 1 → climb 20 → gate 2 → climb 20 → gate 3 → climb 14 →
boss gate → orbit 18 s (calm) → dock (25 s, then you're towed in) → aftermath 3.5 s → score card.
About 3 to 4 minutes. Lose when the mothership hull reaches 0.

- **Launch:** spoken count T-10 to 1 and "Liftoff" (the browser's own voice, no library; falls
  back to beeps), aperture doors open at T-7, the mothership ignites at T-4 and rises through the
  aperture from T-3, your ship lifts off its pad at 0.
- **Gates:** the wall sits 70 units above the mothership's nose and rides with it. The grip
  slides the ship down the screen at 11 u/s (boss 7), +5 while the gate's aircrab is clamped on,
  +3 while the Bellwether lives. Weak spots flare bright once every 2.4 s and are dim between.
  Failed gate: 34 hull, blast radius 170 knocks you to the respawn timer.
- **Hull:** latched airkrill 0.15/s each, a clamped aircrab 0.6/s, plankton 0.6 per hit, debris 3,
  spit 0.6, straggler blast 4, failed gate 34. Feeding airkrill stay deflated (soft).
- **Score:** airkrill 100, plankton 10, aircrab 500, Bellwether 500, weak spot 200, gate 1,000,
  boss gate 5,000, docked 10,000, clean dock 2,000 (relative speed under 45 and within 7 units of
  the port's centre), hull bonus 50 per hull point at docking (the brief marks this "suggested").

## Guesses waiting on Ry (not decided in the brief)

- The aircrab's job at a gate (here: clamps on and drags the ship down faster). The Bellwether
  sits at the boss gate and spits.
- Air plankton look and breath timing (placeholder: pale motes, armoured on a shared pulse).
- Solo stand-in for the rescue shot (wriggle). The straggler blast costs 4 hull.
- Every number above. `node scripts/takeoff-playtest.js` with its crude autopilot wins about 1
  run in 4, usually losing at the boss gate after one failed gate.
- Not in pass 1: the other five crew kits, AI wingmates (next), multiplayer (later), hub board
  card / party.js / casual-hardcore switch, cabinet name.

## Testing

`node scripts/takeoff-playtest.js [--runs N] [--shots DIR] [--idle] [--reduced]` runs the real game
in headless Chromium with `window.TO_TEST` set and steps `toUpdate` by hand. Exit 1 on any page
error or if no run reaches the card. It proves the round runs, not that it is fun.

## Pass log

| Pass | State |
|---|---|
| 1 (2026-11-21) | Launch countdown with voice and the aperture launch, the climb with clusters and debris, escort chip damage, 3 gates + boss gate with lightning and The Tide's silhouette, orbit, docking, score card, Greer only, solo. **Not yet human-played.** |
