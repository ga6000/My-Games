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
- **Three legs**, each a fixed count of road set pieces (10 / 13 / 16), checkpoints ALPHA and
  BRAVO, then the mountain base. No clock (rule 0). Bot runs take about 2:40 to 2:50.
- **The road (pass 2):** hills (crests hide what is behind them), dark valleys (legs 1 and 3),
  tunnels (legs 2 and 3: no beams, no attacks, krill scraped off), side roads that fork off and
  rejoin (a pad or chips on them, sometimes traps). Set pieces never sit in a tunnel.
- **Finale (pass 2):** the last 150 segs run into a tunnel in a solid mountain, lit from above,
  into the computer lab. Each rider who crosses the line slides sideways (Akira) into a parking
  spot: HOME. When the case gets home the carrier tosses it to the tech at the console
  (LAUNCH ARMED); riders still out get 10 s to make it in, +1,500 each. Then the card.
- **Fail rule: case integrity.** 4 pips (casual 6). −1 each time it hits the road (crash or krill
  steal), −1 per 5 s lying there, +1 per checkpoint. 0 = codes lost.
- **A dropped case skids** on from the carrier's speed (about 8 segs), so the riders behind and
  the remounting carrier ride up on it. If every rider has passed it (nobody can ride back), it
  tumbles back into the road 14 segs ahead of the last rider after 1.5 s; it keeps losing pips
  while it lies. Found by the bot runs: without this a solo rider who missed the grab lost the run.
- **Hazards (7):** homing beams (the ring tracks you, then locks; move out), scorch craters,
  debris barricades (six kinds: wall, twin gaps, sliding gate, chicane, tank traps, low pipe to
  jump), airkrill swarms, mines hidden in dust, and two skill attacks:
  - **Lash:** a tendril from the small ship sweeps across the road ahead. A shadow line and a
    closing ring warn for 1.15 s; jump it at the line (or shield/ram through).
  - **Strafe:** the small ship dives and walks a line of fire back down your lane (0.75 s
    lead, marks on the road); change lanes. The hit is swept, so you can't slip between shots.
- **Krill grip (pass 2):** a latched swarm shows a grip ring that fills. Carrier: at the end of
  it they tear the case off (3 s hardcore, 4.5 casual). Anyone else: the krill BITE and you
  crash. Jump to shake two off.
- **Crashes (pass 2):** context poses (thrown over the bars, laid down sideways, blown up),
  then the rider walks back, picks up the bike and remounts.

## Controls (keyboard and mouse only)
A/D or ←/→ steer · W/↑ boost · S/↓ brake · Space jump · E, Shift or left click: ability · M sound.
Pass 2: no throttle = coast at cruise (300 MPH); hold W for 400 MPH as long as you like; hold S
to slow all the way to 0. Jump is quicker (hardcore 0.56 s in the air, 0.4 s cooldown). Each
ability holds **2 charges** that refill one at a time on the class cooldown. Esc is the shared hub menu.

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
`dc-core` constants, tuning, timers, state · `dc-font` stroke font · `dc-track` road and set
pieces · `dc-audio` every SFX + the music hook · `dc-rider` input, bike physics, collisions ·
`dc-crew` abilities and the matrix · `dc-hazards` beams, krill, the case (host) · `dc-attacks`
lash, strafe, Gunner seekers · `dc-finale` the slide, toss and HOME · `dc-net` the
event bus and MP · `dc-fx` bursts, banners, toasts · `dc-render` the road, scenery, tunnels, lab · `dc-actors`
riders, crash poses, krill, beams, HUD · `dc-panel`
the cabinet panel · `dc-bot` autopilot · `dc-crawl` the chapter crawl · `dc-flow` boot, run,
aftermath, card, loop, `GameInstance`.

## Hooks for what comes later
- **Music:** `dcMusic.start()` / `dcMusic.stop()` in `dc-audio.js` (called at GO and at the end).
- **Crawl text:** placeholder in `DC_CRAWL_TEXT` (`dc-crawl.js`). The real text belongs in the story
  doc; paste it there until a shared crawl reads it.
- **Difficulty:** `dcReadDifficulty()` reads `PARTY.difficulty()` if it ever exists, then
  `?difficulty=`. Hardcore by default. Tuning in `DC_TUNE`.
- **Aftermath:** `shared/party.js` has no aftermath option, so the game holds 3.5 s itself
  (`DC_AFTERMATH`), then its card, then `PARTY.finish()` when the hub opened it.

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
- Character art: drawn from the crew figures (`shared/crew.js` look), not a model sheet. Swap in
  the agreed character sheet when one exists.
- Three or four riders; latency over the real server; host migration mid-run (beams in flight
  are lost; the case survives because every client holds its last state); a late joiner sees
  hazard states (popped mines, smashed barricades) as fresh.
- Phones and touch: no touch controls in this pass.
- Sounds by ear.
