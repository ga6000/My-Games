# Desert Code Racer — ACT IV · LAUNCH

Pass 1 (2026-11-17): a solo-playable vertical slice, co-op wired and verified headless with
two clients. Ry played pass 1; pass 2 (2026-11-18) is his feedback list (marked "pass 2" below),
**not yet played by a person**. The hub card stays `soon: true` (IN DEVELOPMENT)
and the game is on no story path (`SCOPE_RULES.md` rule 5). Plan: `DCR_SLICE_PLAN.md`.

**Open:** `desert-code-racer/desert-code-racer.html` (double-click plays solo), or
`node scripts/dev-serve.js` then `http://localhost:8123/desert-code-racer/desert-code-racer.html`.
Useful params: `?role=medic|engineer|scout|gunner|butcher|bulwark`, `?difficulty=casual`,
`?nointro=1` (skip title and crawl), `?bot=1` (the autopilot rides; solo it starts at once),
`?timescale=4` (solo tests only), `?seed=N` (a fixed road, solo only), `?server=ws://…&room=…&name=…` (a local server).

## The game
The EMP killed comms, so the crew rides cyber bikes from the dome base across the Black Rock
Desert to the mountain base with the launch-code case. The Tide hangs on the horizon and fires
homing beams down the road. Right before Cliff Run in the chronology.

- **The convoy.** 1 to 4 riders on one road. One holds the case. A carrier who crashes drops it;
  anyone rides over it to take it. Pass 2: no rubber-banding. Riders spread out freely and
  finish at different times; the minimap marks every rider.
- **Three ROUNDS of about a minute (Ry 2026-11-25)** (`DC_LEG_SEGS` 2350 / 2550 / 2750, set pieces
  9 / 12 / 15). Rounds 1 and 2 end inside a mountain: a 240-seg lit tunnel (`DC_CP_TUNNEL`, in
  `track.cpTun`) with the checkpoint gate 30 segs in, the mountain face lettered with the
  checkpoint's name. The sky holds fire from 40 segs before the tunnel to its exit, and a TALLY
  board (`dcDrawTally`, dc-finale.js; 3.2 s) rides over live play through the tunnel: two short
  rows, the checkpoint name and REACHED (Ry 2026-11-26: show it was reached, not points). The
  checkpoint banner and toast are gone so nothing overlaps it. Round 2 or 3 starts at the exit. Round 3 ends at the lab. No clock
  (rule 0). Bot runs at seed 4242: rounds land at about 40 s, 54 s and 72 s, ~2:45 total.
- **Lose the case, replay the round (Ry 2026-11-25).** When the pips run out the host emits `rp`
  (CODES LOST banner; the crash keeps playing, nobody remounts) and, `DC_RR_HOLD` = 2.4 s later,
  `rr` (`dcHostRoundLost`; Ry 2026-11-26: "I would still like to see the death animation"). Then every screen puts the convoy back at that round's start (round 1 the start
  line, else inside the previous checkpoint tunnel past the gate), resets that round's road
  (barricades stand, mines rebury), clears the sky, restores the team score and your points to
  the checkpoint snapshot (`dcRoundSnap`), and the case comes back with the pips it had at the
  checkpoint. A run gets `DC_RESTARTS` = 3 (Ry 2026-11-27: "a cap and three restarts before codes
  are lost"); the banner counts them down (2 LEFT, 1 LEFT, LAST CHANCE), the tally shows what is
  left, and the next lost case after the third is CODES LOST.
- **The road (pass 2):** hills (crests hide what is behind them), dark valleys (legs 1 and 3),
  tunnels (legs 2 and 3: no beams, no attacks, krill scraped off), side roads that fork off and
  rejoin (a pad or chips on them, sometimes traps). Set pieces never sit in a tunnel.
- **Crests (Ry 2026-11-24: the drops and rises are "among the best part"):** steeper, closer
  rolling hills, plus ~28 KICKERS a run (a short sharp rise, a longer fall; open desert only,
  `dc-track.js`). The bike follows real ballistics (`dcCrestUpdate` in `dc-rider.js`): it leaves
  the road when the crest bends away faster than gravity can hold it at that speed (curvature ×
  speed² > 1.2 g, `DC_G` = 15000), flies a true arc while the ground drops away, and lands where
  the arc meets the road. So speed is the choice: brake to stay glued, boost to sail further.
  Jump on the lip (crest pull > 0.45 g) for a bigger flight. Steering keeps 90% in a flight (55% in a
  plain hop), so a kicker before a barricade is a chance, not a blind trap. Landing: under 0.25 s is a hop;
  meeting the road too steeply from high (> 600 up) is a HARD LANDING (speed ×0.82, shake);
  otherwise CLEAN (+50, +700 speed) or BIG AIR over 1.1 s (+100). More than 650 up over a
  barricade clears it (OVER THE TOP, +100). The camera rises 30% of the flight height (drawn height
  capped at 1600) so the bike lifts on screen over a flat shadow while the road drops away. Bot run at seed 4242: ~24 flights of 0.3–1.1 s, a few hard landings, all at 400 MPH.
  Tuning is unplayed by a person.
- **Finale (pass 2):** the last 150 segs run into a tunnel in a solid mountain, lit from above,
  into the computer lab. Each rider who crosses the line slides sideways (Akira) into a parking
  spot: HOME. When the case gets home the carrier tosses it to the tech at the console
  (LAUNCH ARMED); riders still out get 10 s to make it in, +1,500 each. Then the card.
  Ry 2026-11-24: the slide ends HORIZONTAL (the bike goes all the way down on its side and stays),
  the rider steps off beside it, and the carrier throws the case once standing (`DC_TOSS_AT` 2.0 s
  after the carrier crosses) to the tech, who now stands 30 segs in (was 44: a few pixels tall).
- **Minimap names (Ry 2026-11-24):** DOME BASE, ALPHA, BRAVO, MOUNTAIN BASE on the route map;
  passed stops cyan, the next amber, the rest dim.
- **Case integrity.** 4 pips (casual 6; Ry 2026-11-26 "back to 4 pips. yes to + 1 @ ea
  checkpoint", after a day at 6 / 8). −1 each time it hits the road (crash or krill steal),
  −1 per 5 s lying there, +1 per checkpoint, carried over between rounds. 0 = the round restarts.
- **The motherships (Ry 2026-11-25/26, `dc-ships.js`):** "stationary and monolithic, but rendered as
  if 3d if it rotates to line up an attack ... wedge shapes with round brain at front" (refs in
  /mnt/project-files/desert-code-racer/ref/). One small flat-shaded mesh drawn twice: an arrowhead
  slab pointing at the camera with a U notch cut from the back. Ry 2026-11-26 asked for it more
  organic: the outline is knobbled and the thickness uneven (fixed seed), bone ribs bow at the
  knobs, the red rim drips, the brain is two lumpy lobes with wandering folds. The big ship is seen
  from a little below (`DC_SHIP_PITCH_BIG` −0.22: veined underside, the eye, the brain rising over
  the point); the small one from above. FIXED IN THE SKY (Ry 2026-11-26): both slide with the
  ridgelines as the road turns (`dcSkyTurn`, shared with the ranges); so a long bend can't lose them for good, their
  bearing follows the road's heading with a 14 s lag (`DC_SHIP_SETTLE`) and snaps back on a new run
  or round restart. Beams and strafe bolts leave the eye wherever it is, on screen or off; hits are
  decided on the road as before. Each ship turns slowly (0.55 rad/s) toward the target while its
  beam is tracking, holds still once it locks, and rests a little turned when idle. The small ship
  fires its strafe from where it hangs (`dcDrawStrafeBolts`).
- **A dropped case skids** on from the carrier's speed (about 8 segs), so the riders behind and
  the remounting carrier ride up on it. If every rider has passed it (nobody can ride back), it
  tumbles back into the road 14 segs ahead of the last rider after 1.5 s; it keeps losing pips
  while it lies. Found by the bot runs: without this a solo rider who missed the grab lost the run.
- **Hazards (7):** homing beams (the ring tracks you, then locks; move out), scorch craters,
  debris barricades (six kinds: wall, twin gaps, sliding gate, chicane, tank traps, low pipe to
  jump), airkrill swarms, mines (always drawn since 2026-11-26: a dark spiked dome with a red
  blinking lamp, clipped under crests; Scout's reveal turns it magenta), and two skill attacks:
  - **Lash:** a tendril from the small ship sweeps across the road ahead. A shadow line and a
    closing ring warn for 1.15 s; jump it at the line (or shield/ram through).
  - **Strafe:** the small ship, hanging where it is, walks a line of fire back down your lane (0.75 s
    lead, marks on the road); change lanes. The hit is swept, so you can't slip between shots.
- **Krill grip (pass 2):** a latched swarm shows a grip ring that fills. Carrier: at the end of
  it they tear the case off (3 s hardcore, 4.5 casual). Anyone else: the krill BITE and you
  crash. Jump to shake two off.
- **Crashes (pass 2):** context poses (thrown over the bars, laid down sideways, blown up),
  then the rider walks back, picks up the bike and remounts.
- **The crew are pixel art (Ry, 2026-11-23):** "not vector drawn ... pixelized to more closely
  resemble the pixel characters on the lineup reference", sized to the lineup. `dc-sprites.js`
  paints each crew member (and the lab tech) once at load into small canvases: seated from behind
  (two wind-flap frames) and standing/running/reaching/flailing from the front for the crash and
  remount. Heights follow the lineup (Greer 1, Maren 0.95, Elodie 0.94, Soren 0.97, Bex 0.96,
  Booke 1.04 and half again as broad), one art pixel = 0.0178 s for everyone. The bike's tail
  cowl is drawn again over the rider's hips and carries the identity colour.

## Cabinet: RASTER (reassigned from VECTOR, Ry 2026-11-23; night desert)
Ry: "transitioning to a raster cabinet would be strongly preferred", then chose the night sky.
Done as a package (`AESTHETIC_GUIDE.md` §6.8 "a reassignment is a package, not a switch"):
- **The canvas is the virtual screen** (`dcResize`): about `DC_VROWS` = 216 rows, width from the
  window, CSS-scaled by an integer `dcPixel` with `image-rendering: pixelated`. Every coordinate
  in the draw code is a fat pixel, so nothing needs a separate snap. At 640 px tall that is 3 CSS
  px a pixel, which makes one crew art pixel one screen pixel up close.
- **Scanlines on** (`#dcScan.retro-scanlines`, gated on `data-cabinet="raster"`); no phosphor
  persistence, no beam overdraw (`dcLine`'s `wide` is ignored), no vertex bloom (`dcBloom` is a
  no-op).
- **Flat fills** (`dcSolid`: a dark shade of the colour plus a one-pixel lit edge).
- **The road** (Pole Position anchor): `dcDrawRoadSeg` fills sand, rumble strips, asphalt and the
  centre dash per segment in 3-segment bands (`DC_RAS`); distance darkens in three flat steps
  (`dcFog`). Tunnel lamps light the asphalt one flat step brighter; valley walls and tunnel rock are
  filled. Sky: black with four flat bands of the world hue over the horizon, filled ridgelines.
  The ridgelines sit at infinity: their scroll is the road's heading under the camera (`hd` per
  segment in `dc-track.js`, `dcSkyAt`), so they turn with the road at any frame rate (Ry 2026-11-24:
  they used to slide a fixed step per drawn frame). Ry 2026-11-26: the whole sky (both ranges and
  both ships) reads one number, `dcSkyTurn` in dc-ships.js, so it stays locked together; only the
  road's heading moves it (the bike sliding across the road moves nothing up there); the turn is
  scaled down a touch (`DC_SKY_TURN` 0.85) and each layer takes a share (`DC_SKY_LAYER`: far range
  0.75, ships 0.9, near range 1.0).
- **Text** is Press Start 2P at 8 or 16 px (`dc-font.js`'s `dcText`); in-world text too small for
  8 px is not drawn. The stroke glyph table is kept but unused.
- **Not done in this pass:** the colour count is well over §1's "≤4 on screen" (the crew sprites,
  the road bands), the same way the other raster cards already run; the krill, beams and FX are
  still one-pixel line art on the grid rather than sprites; the cabinet panel's minimap is still
  line art.

## Controls (keyboard and mouse only)
A/D or ←/→ steer · W/↑ boost · S/↓ brake · Space jump · E, Shift or left click: ability · M sound
(or the SOUND button in the cabinet panel: the same hub-wide SFX mute) · hold L+G: dev tools.
Pass 2: no throttle = coast at cruise (300 MPH); hold W for 400 MPH as long as you like; hold S
to slow all the way to 0. Jump (Ry 2026-11-26 "taller, to clear more obstacles"): peak `jumpH`
950 world units (casual 1050; was a drawn 520), 0.68 s in the air (casual 0.74), 0.4 s cooldown.
Over `DC_HIGH` (470; walls stand 560, so a bike drawn over the top counts as over) it clears a
barricade, so a well-timed jump hops a wall (OVER THE TOP), as a crest flight already could. A
barricade cleared once is cleared for all its segments (`passed[id+"^"]`). Jump works at speed:
a press during a low crest skim (under 260 above the road) drops you to the road and jumps; a
press while already airborne with krill on shakes them off. Barricades span the whole drivable
width (`dcLaneLimit`) and the gaps are wider (wall 0.56, twin 0.46, gate/chicane 0.6; casual
+0.11). Side roads are shortcuts: on one you cover ground 1.4× (`DC_SHORTCUT`), SHORTCUT text.
A crash from height (`crashH` > 250, sent in the crash message) falls: the bike and rider drop
from where they were, tumble and bounce (`dcCrashPose`). Each
ability holds **2 charges** that refill one at a time on the class cooldown. Esc is the shared hub menu.

## Dev tools (hold L+G; Ry 2026-11-24)
The shared panel (`shared/devtools.js`, `DEV_TOOLS_PLAN.md`), registered in `dc-dev.js`, which
loads last. Always armed (the game binds neither L nor G). It pauses offline only. The report
shows mode, road segment/zone/leg, speed, charges, the case, live hazards and the last crashes
and pip losses. Buttons: NEXT CHECKPOINT, SKIP TO THE LAB, FILL CHARGES, CASE PIPS FULL, CLEAR
THE SKY, SEND KRILL, SEND BEAM, NEXT CLASS (offline), GOD MODE, BOT TAKEOVER, MUTE, CRASH ME,
WIN NOW, LOSE ROUND (runs the case dry: the round restarts), LOSE NOW. Case and end buttons are host only. GOD MODE and BOT TAKEOVER are two flags on
`dc` (`devGod`, read in `dcCrash`; `devBot`, read in `dcStep`).

## Abilities and the coverage matrix
Each class misses exactly one hazard, so any lineup is universal-only on at most one type.
The matrix is also data: `DC_COVER` in `dc-crew.js`; `dcLineupWorst()` checks every lineup of 1
to 4 classes against it and returns the worst count of universal-only hazard types: 1 (any solo
rider; for teams, only a mix of Scout, Gunner and Bulwark, on craters).

| Hazard | Medic MEND | Engineer RIG | Scout SCAN | Gunner FIRE | Butcher RAM | Bulwark SHIELD | Universal |
|---|---|---|---|---|---|---|---|
| Beam | ✓ patched | ✓ decoy | ✓ jams | ✓ downs | · | ✓ soaks | steer out of the locked ring, brake/boost |
| Crater | ✓ patched | ✓ ramp | · | · | ✓ carries over | · | steer round, jump |
| Barricade | ✓ patched | ✓ ramp | ✓ opens gap | ✓ blows open | ✓ smashes | ✓ plows | steer through the gap |
| Krill | · | ✓ decoy | ✓ scatters | ✓ shoots off | ✓ rips off | ✓ bounce off | jump (shakes off 2) |
| Mines | ✓ patched | · | ✓ pops | ✓ pops | ✓ harmless | ✓ harmless | steer round the dust, jump |
| Lash | ✓ patched | ✓ decoy | ✓ stuns | ✓ severs | ✓ through | ✓ bounces | jump it |
| Strafe | ✓ patched | ✓ decoy | ✓ jams | ✓ shoots down | ✓ through | ✓ soaks | change lane |

- **MEND** (12 s): downed riders within 40 segs remount at once; riders within 25 segs are
  PATCHED for 4 s (a crash becomes a stumble: no drop, speed ×0.62).
- **RIG** (12 s): a beacon 30 segs ahead for 5 s; all live beams and new ones land on it, krill
  near it divert; craters/barricades in the 45 segs past it get a ramp.
- **SCAN** (10 s): a pulse 130 segs ahead: mines show and pop, beams in range lose their lock,
  krill near scatter, barricades open (gap 1.15 wide).
- **FIRE** (8 s): 80 segs ahead: beams downed, barricades open, mines popped, lash/strafe
  downed; pass 2: homing rounds fly to every krill swarm within 70 segs and kill it.
- **RAM** (10 s): 1.5 s at boost+: smashes barricades, carries over craters, mines harmless, rips
  krill off riders within 6 segs.
- **SHIELD** (12 s): 4 s dome on Booke and the nearest rider: every live beam retargets to Booke
  and is soaked, krill bounce, barricades plowed, mines harmless.

## Score
TEAM score on the hub scale (`HUBSCORE` toasts in the earner's colour): ability solves 100,
beams/krill neutralised 200, revive 200, case grab 100, carrying 10 per 100 m, universal dodges
10, checkpoint 1,000 (team), clear 10,000 + 1,000 a pip left. Bot solo runs land 20k–25k
(par 25k). Every rider reports the TEAM score to `PARTY.finish` (all tie, per Phase 7's "score
together"); the game's own card shows the contribution list first (carried m, solved, revives,
beams, krill, grabs, crashes, points).

## Net model (shared/mp-core.js relay only; no new server message types)
- `dcEmit(msg)` applies a message locally through `dcHandle()` and relays it; a relayed message
  goes through the same `dcHandle()`. Solo is the same code with no relay.
- Each client owns its bike: `p` at 10 Hz, `ct` (contribution row) at 1 Hz. It alone decides its
  crashes (`crash`), and asks the host for the case (`drop`, `grab`).
- The host owns: the case (`cs`, plus a 1 Hz heartbeat), checkpoints (`cp`), beams (`bm` spawn,
  `bl` lock/retarget, `bx` downed/jammed), krill (`kk`, `kl`, `kx`; `shake` from the rider), and
  the end (`end`, with the frozen rows so every screen shows the same card).
- The road (curves, scenery, set pieces) is built from `MP.seed()` per leg (`dc-track.js`), so no
  messages. State changes on it: `hz` (a mine popped, a barricade smashed/plowed) and the casts
  (`ab`), which every client applies the same way.
- Identity: `MP.selfColor` / `IDENTITY.colorFromName`. Class: `PARTY.role()` (session or `?role=`),
  then the hub's stored pick (`gamehub_role`), then a deal by name (offline only).

## Files (classic scripts, `"use strict"`, every top-level name `dc*` / `DC_*`)
`dc-core` constants, tuning, timers, state · `dc-font` text (Press Start 2P) · `dc-track` road and set
pieces · `dc-audio` every SFX + the music hook · `dc-rider` input, bike physics, collisions ·
`dc-crew` abilities and the matrix · `dc-sprites` the pixel crew · `dc-hazards` beams, krill, the case (host) · `dc-attacks`
lash, strafe, Gunner seekers · `dc-finale` the slide, toss and HOME · `dc-net` the
event bus and MP · `dc-fx` bursts, banners, toasts · `dc-render` the road, scenery, tunnels, lab ·
`dc-ships` the two motherships · `dc-actors`
riders, crash poses, krill, beams, HUD · `dc-panel`
the cabinet panel and SOUND button · `dc-bot` autopilot · `dc-crawl` the chapter crawl · `dc-flow` boot, run,
aftermath, card, loop, `GameInstance` · `dc-dev` the L+G dev panel.

## Hooks for what comes later
- **Music:** `dcMusic.start()` / `dcMusic.stop()` in `dc-audio.js` (called at GO and at the end).
- **Crawl text:** placeholder in `DC_CRAWL_TEXT` (`dc-crawl.js`). The real text belongs in the story
  doc; paste it there until a shared crawl reads it.
- **Difficulty:** `dcReadDifficulty()` reads `PARTY.difficulty()` if it ever exists, then
  `?difficulty=`. Hardcore by default. Tuning in `DC_TUNE`.
- **Aftermath:** `shared/party.js` has no aftermath option, so the game holds 3.5 s itself
  (`DC_AFTERMATH`) and a downed rider stays down on the crash (no remount; Ry 2026-11-26), then its card, then `PARTY.finish()` when the hub opened it.

## Verified (2026-11-17, headless)
- Solo start to finish from `file://` and from dev-serve, no console errors.
- Every class finished a solo bot run on hardcore (all six won, 20k–25k).
- Two clients on a local server: see each other, one host, the case drops on the carrier's crash
  and the other rider takes it on both screens, same pips, same result card.
- `check-global-collisions.js`, `check-undefined-globals.js`; a reduced-motion run.

## Verified pass 2 (2026-11-18, headless)
- Every class won a solo bot run on hardcore at `?seed=4242` (21k–27k, 157–168 s sim time).
- Forced events (screenshots): every crash kind and remount, krill fly/latch/grip/bite, lash
  hit, strafe hit (rider held in lane) and miss (rider drifted out), FIRE seekers.
- Two clients on a local server: all checks pass, staggered finish, same CODES DELIVERED card.
- Both checkers; a reduced-motion run.

## Unproven
- **Fun, feel, difficulty.** Nobody has played it. The bot is not a person: its line choice is
  better than a human's and its reactions are instant. Hardcore may be too hard or too soft.
- Hand-steering through a 0.44-wide gap at 300 MPH; the beam lock window (0.75 s); whether the
  lash warning (1.15 s) and strafe lead (0.75 s) are fair reaction windows for a person.
- Whether sustained 400 MPH plus two charges makes hardcore too easy.
- The raster look by eye on a real screen (scanline beat at other window sizes, readability of
  8 px text, whether the road bands are too busy at 400 MPH).
- Three or four riders; latency over the real server; host migration mid-run (beams in flight
  are lost; the case survives because every client holds its last state); a late joiner sees
  hazard states (popped mines, smashed barricades) as fresh.
- Phones and touch: no touch controls in this pass.
- Sounds by ear.
