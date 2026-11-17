**Which game?** Desert Code Racer, a new hub game (ACT IV · LAUNCH, `code-racer` tile, still IN DEVELOPMENT).
**Which finish-line item?** The ACT IV "code racer" chapter of the hub story (`HUB_1_0_PLAN.md` Phase 7, story board): a solo-playable vertical slice with co-op wired, ahead of the group playtest (rule 5).

# Desert Code Racer: solo vertical slice (pass 1, 2026-11-17)

## The loop
The crew rides cyber bikes from the dome base to the mountain base with the launch-code case.
One rider holds the case. Three checkpoint legs, each a fixed count of road set pieces
(leg 1: 10, leg 2: 13, leg 3: 16), with the mothership's beams and the krill swarms coming
faster each leg. No clock (rule 0). Cruise is 300 MPH, about 60 s a leg, about 3 to 4 minutes a run.

## Fail rule: case integrity
The case has **4 integrity pips** (casual: 6).
- It loses **1 pip each time it hits the road** (the carrier crashes, or krill rip it loose).
- It loses **1 more for every 5 s it lies there** unclaimed.
- Each checkpoint **restores 1 pip** (up to the max).
- At 0 the codes are scrambled: the convoy has failed.
- A dropped case skids on a few metres; a case every rider has passed tumbles back into the
  road ahead of the last rider (nobody can ride back for it).

Why this rule: it works the same for 1 or 4 riders and for every lineup. "Everyone down at
once" never happens solo, and "lying too long" alone never happens solo either, because the
carrier remounts on top of the case. Pips make every carrier crash cost something, so the
abilities that stop a drop (Mend, Shield) and the riders who grab the case fast matter.

## Controls (keyboard and mouse)
A / D or ← / → steer · S or ↓ brake · W or ↑ boost · Space jump · E, Shift or left click: ability.
Boost and jump draw on one capacitor meter (jump costs a quarter of it).

## Abilities (one each, on a cooldown)
Ry's draft gave each class one or two hazards. With 5 hazard types that leaves a solo rider
with only the universal answer for 3 or 4 of them, which breaks the any-lineup rule. So each
ability is one verb with a wider reach, and **every class misses exactly one hazard type**:

| Class | Ability | What it does |
|---|---|---|
| Medic MAREN | MEND (12 s) | Downed riders near her remount at once. For 4 s she and riders near her are PATCHED: a crash becomes a stumble (no drop, some speed lost). |
| Engineer ELODIE | RIG (12 s) | Drops a beacon ahead. For 5 s it pulls homing beams and krill to itself. Laid before a crater or barricade, it unfolds a ramp that launches riders over. |
| Scout SOREN | SCAN (10 s) | A pulse runs down the road: hidden mines show and pop, beams lose their lock and land wide, krill scatter, and each barricade's weak joint gives (its gap opens wide). |
| Gunner GREER | FIRE (8 s) | A burst down the road ahead: shoots krill off any rider, detonates beams in flight, blows barricades open, sets off mines. |
| Butcher BEX | RAM (10 s) | A 1.5 s armoured charge: smashes barricades, rips krill off herself and riders she passes, carries over craters, sets off mines harmlessly. |
| Bulwark BOOKE | SHIELD (12 s) | A 4 s dome on him and the nearest rider: every live beam retargets to him and is soaked, krill bounce off, he plows barricades, mines pop harmlessly. |

## Coverage matrix
✓ = that class's ability solves it. Universal answer in the last column (always works, scores less).

| Hazard | Medic | Engineer | Scout | Gunner | Butcher | Bulwark | Universal answer |
|---|---|---|---|---|---|---|---|
| Homing beam (locks a ring ahead of you) | ✓ patched | ✓ decoy | ✓ jams lock | ✓ detonates | · | ✓ soaks | Steer out of the ring after it locks, or brake/boost |
| Scorch crater | ✓ patched | ✓ ramp | · | · | ✓ carries over | · | Steer round it, or jump |
| Debris barricade (one gap) | ✓ patched | ✓ ramp | ✓ opens gap | ✓ blows open | ✓ smashes | ✓ plows | Steer through the gap |
| Airkrill swarm (latches, steals the case) | · | ✓ decoy | ✓ scatters | ✓ shoots off | ✓ rips off | ✓ bounce off | Jump to shake them off |
| Mines in dust | ✓ patched | · | ✓ reveals, pops | ✓ sets off | ✓ harmless | ✓ harmless | Steer round the dust, or jump it |
| **Classes that solve it** | | | | | | | **beam 5 · crater 3 · barricade 6 · krill 5 · mines 5** |

**Lineup check.** A lineup is universal-only on a hazard only if every class in it misses that
hazard. Each class misses one: Medic krill, Engineer mines, Scout crater, Gunner crater,
Butcher beam, Bulwark crater. Solo: one hazard each. Any pair with different misses: none. The
only shared miss is crater (Scout, Gunner, Bulwark), so the worst lineup, any mix of those
three, is universal-only on crater alone. **No lineup is left with more than one.**

Abilities never gate: every hazard can be passed by steering, braking, boosting or jumping.
An ability solve pays 100 to 200; a universal dodge pays 10 or nothing.

## Co-op (the convoy), net model
- Each client owns its own bike and relays it (`MP.send`, about 10 a second).
- The host owns: who holds the case (one answer to "who grabbed it"), case pips, beam and krill
  spawns and their targets/locks/latches, and the final result.
- Static road hazards (craters, barricades, dust and mines, scenery) come from `MP.random()`
  reseeded per leg, so every screen builds the same road with no messages. Their state changes
  (a mine popped, a barricade opened, a ramp laid) are relayed events by hazard id.
- A rider decides their own crashes. Riders far behind the case get a catch-up surge; riders
  far ahead are held to the convoy (they cannot ride back for a dropped case).
- Identity and colour from `MP` / `shared/identity.js`. Class from `PARTY.role()` (the hub's
  deal: session or `?role=`), then the hub's stored pick, then a deal by name.
- Only relay payloads; no new server message types. `?solo=1` and `file://` play alone.

## Score
One TEAM score on the hub scale (HUBSCORE toasts in the earner's colour) plus a contribution
list per rider: case carried (m), hazards solved by ability, revives, beams soaked/downed/jammed,
krill, case grabs. Every rider reports the TEAM score to `PARTY.finish` (all tie, as Phase 7's
"score together" direction asks). Checkpoint 1,000; clear 10,000 plus 1,000 a pip left.

## Also in this pass
SFX for everything (WebAudio, `shared/sfx.js` for the master bus), one music hook (no music),
a skippable crawl (no shared one exists: `dc-crawl.js`, placeholder text), BOOTFLOW boot,
3.5 s aftermath before the card (party.js has no aftermath option, so the game holds it),
`?difficulty=casual` read as a hook (PARTY has no difficulty yet), hardcore by default.

## Done when
Plays start to finish solo (file:// and dev-serve) with no console errors; two headless
clients see each other, the case hands over on a crash, same result card; every class finishes
a solo run (bot); both checkers pass; reduced-motion run passes; `CLAUDE.md` written.
