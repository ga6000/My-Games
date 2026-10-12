# Hub 1.0 — the phased plan (2026-10-03)

**Which game:** the hub as a whole: all five cards, ZOMBIE included. The long game only appears in Phase 6, after 1.0.
**Which finish-line item:** all of `HUB_RETROSPECTIVE.md` §5. Each phase names the item it closes.

This plan pulls together three sessions: the map-authoring work (`zombie/SESSION_CONTEXT_MAP_AUTHORING.md`),
the evacuation train (`zombie/TRAIN_RAIL_PLAN.md`, `zombie/PLAYTEST_2_PLAN.md`) and the scope
decisions (`zombie/THE_SPLIT.md`, `SCOPE_RULES.md`). Per `SCOPE_RULES.md` rule 4 it is the one open
hub plan. **`zombie/PLAYTEST_2_PLAN.md` is absorbed:** its Phase 1 and §6.4 become Phase 1 here, and
the rest is re-sorted below. That file is kept as the record of what the playtest found.

---

## Phase 0 — Paperwork · §5 groundwork · **done 2026-10-03**

- The 2026-09-27 scope docs are committed (`SCOPE_RULES.md`, `IDEAS_INBOX.md`, `HUB_RETROSPECTIVE.md`,
  `zombie/THE_SPLIT.md`, plus the `PROJECT_MEMORY.md` entry and the `zombie/CLAUDE.md` banner).
- `zombie/PLAYTEST_2_PLAN.md` is committed unchanged, as a record. Its owning session
  ("Zombie game design review and reorganization") had been idle since 2026-09-26, and nothing in
  the file was built.
- doc-sync: only the docs that were actually re-read get stamped. The four repo-wide docs cover
  every game, so they wait for Phase 5's reconciliation.

## Phase 1 — Bugs that end a session · §5 item 3 · **done 2026-10-03 (Zombie; the other cards audited)**

1. **Fixed-timestep loop + a background tick for the host.** A host tab in the background got no
   `requestAnimationFrame` calls, so the whole room froze and showed CONNECTION UNSTABLE.
   `setInterval` keeps it alive (a Worker is not an option, because Workers can't be created
   under `file://`).
2. **Audit the other four cards** for the same "hidden host freezes the room" fault, and record
   what each one does.
3. **Dev buttons that advance each step of the Zombie chain**, so later phases can be tested in
   seconds.

### Phase 1 results (2026-10-03)

- **1 — done in ZOMBIE.** Fixed 60Hz step plus `zBackgroundTick`; see `zombie/CLAUDE.md` → "The
  simulation clock". It also fixed a fault nobody had reported: the game ran **2.4x fast at
  144Hz**, because movement is pixels per `update()` call. Measured in a hidden Browser pane with
  no frames drawn: a host with a guest simulates at 57.6 steps/s. Solo, and a guest, stay frozen
  on purpose.
- **3 — done.** One dev-panel button, `NEXT CHAIN STEP`. Fifteen presses take a fresh map to the
  open tunnel. It survives the rail being removed.
- **2 — audit only; nothing changed in the other games.** Read from each game's loop and net code:

  | Card | Host? | Hidden tab does | Session-ender? |
  |---|---|---|---|
  | Gyro Space | no, peer positions | freezes only itself | no |
  | Glass City | no ("parallel worlds, no host") | freezes only itself; its ghost stands still for the others | no |
  | **RD Arena** | **yes** (`rd-net.js`: enemies, rounds, field packets) | rAF stops, so **enemies and rounds freeze for every client**. No guest-side fallback | **yes, same fault as Zombie had** |
  | **4D Pong** | **yes** (`fp-net.js`: ball, score, tug) | pauses itself on `visibilitychange`, but the PAUSED phase only goes out in a snapshot from the rAF loop, which has stopped. **Guests see a frozen ball with no PAUSED** until the host returns | **partly**: the room is stuck and nothing says why |

  Proposed fixes, **not done**:
  - RD Arena: the same background tick, if its loop can take a fixed step. Read `rd-arena/CLAUDE.md`
    first; `loop()` advances one step per frame.
  - ~~4D Pong: pausing is right for a pong match. It just has to send the paused snapshot right away,
    skipping the `canSend` throttle.~~ **Done 2026-10-04** (user: "now"). `sendSnapshot(true)` on hide,
    and guests read WAITING FOR THE HOST. Not yet run with two real clients.

  RD Arena is Phase 4 work: fix it when it gets its game night.

## Phase 2 — ZOMBIE ARCADE: a 2–4 minute run · §5 item 2

**Decided 2026-10-04 (user).** The hub's goal is now *"minify games, simplify their content until
they can be completed & enjoyable within short 2-5 minute sessions before being rerouted to the
games hub page"* (`SCOPE_RULES.md` rule 0). For ZOMBIE that means:

- **The walled build is parked, not cut:** `under-development/zombie-rail/`, tag
  `zombie-rail-fork`. Rail stays there, untouched.
- **`zombie/` is ZOMBIE ARCADE**, *"almost none"* of the walls (an open arena), and a new economy
  to come.

| Step | What | State |
|---|---|---|
| 2a | Fork the rail build out; the hub card reads "Open-Map Arcade" | **done 2026-10-04** |
| 2b | **Open map, same perimeter**: every wall except the hard wall, escape columns, forest, landmarks and rolling stock is removed, along with every door, window and orphaned room floor. Items stay. `zombie-level.js` → `openTheArena()`, behind `ARCADE_OPEN_MAP` | **done 2026-10-04** |
| → | **Playtest the open map** (user's next step) | |
| 2c | **Cut the rail from the arcade**, "immediately after playtesting" (user). The ending falls back to the south gate walk-out (`ae0f19d`'s), which the user accepted "for now" | **done 2026-10-04**, with the arena (2f) |
| 2d | **The 2–4 minute loop** (spec below, built in `zombie-arcade.js`) | **built 2026-10-04, waiting on the local playtest** |
| 2e | Trim the remaining items the loop doesn't use (the user expects "trimming all others off") | partly done: field manual, horde switch, generator and rail gone from the map (2026-10-04). Their code is still loaded |
| 2q | **Hard speed cap, a difficulty slider and a bot playtest (2026-10-11, very last):** no zombie walks faster than a player (hard rule); map 3 / boss head starts 120 / 240 -> 60 / 100s plus a per-map curve `pace`; a live DIFFICULTY slider in the dev panel (maps 1-2 near-fixed, 3-4 take it whole); a scripted-bot playtest in `scripts/`. **The bot says map 3 was the wall and, at the new defaults, it is not; it is not a human** | **built 2026-10-11, waiting on the group** |
| 2p | **MAPS 3 AND 4 (the boss) (2026-10-11, last):** map 3 = 7 tanks round a long concrete divider; map 4 = 10 tanks stacked tight in an open map with only super splitters and a constant horde, negative drops x3.3; **beating map 4 is the win**. Each map starts a further 60s up the swarm curve. Also the Boomgun bolt drawn at 1/5 size and growing out of the muzzle | **built 2026-10-11, waiting on the group** |
| 2o | **Lighting option A, MAP 2 and a cleaned dev panel (2026-10-11):** lit faces, a floor under the dark and 7 bands; a second 5-tank map after the exit (a "W": hedge, warehouse, forest, hedge, forest), its clock offset 60s so its minute 2 is map 1's minute 3, a wipe is game over; dev panel gains BOOMGUN / TURRET / FREEZE / LEVEL 2 and an icon button per perk, and loses ten obsolete items | **built 2026-10-11, waiting on the group** |
| 2n | **Round 2 of the fifth playtest, answers and acceptances (2026-10-11):** SEEKER perk (bullet curving, stacks); tank pulse on F at a full tank; FREEZE and TURRET drops; the BOOMGUN powerup; tide + lull + ease on the spawn rate; ammo hand-over to the most powerful gun. **Proposals, not built:** `zombie/LIGHTING_PROPOSAL.md`, `zombie/LEVEL_2_PROPOSAL.md` | **built 2026-10-11, waiting on the group**; proposals waiting on the user |
| 2m | **Fifth playtest (friends, 2026-10-10/11):** guest flashing fixed (zombies keyed by a stable wire id, not array index); hedge/corner pathing fixed (three causes, below); revive 0.75s; respawn 10s; funnels r 110 → 150; silo 1's rings opened; bigger gun + gun strip, perks wrap, 24px objective; negative drops (MUD / FLARE / JAM). Recommendations and the open list are in "2m — next steps" below | **built 2026-10-11, waiting on the next group playtest** |
| 2l | Perks x6 (and six held); a forest in the outer buffer; lighter grass; night with a pointer flashlight (no grey); orange lamps at the warehouse and the tanks | **done 2026-10-08** |
| 2k | +25% outer buffer left/top/right with the chain unmoved; "ESCAPED AT m:ss"; no damage after the win; six perk slots | **done 2026-10-07** |
| 2j | Two-step wounds + 1.2s untouchable, no explanatory text; 1.5s revive; no Blackouts; no ping or DECOY; ATTRACT perk; drops +25%; arena +33% per side; real lighting (dark warehouse, window light); tight hedges, warehouse racking, a thicker forest; `pushProp` placement bug fixed | **done 2026-10-07** |
| 2i | **One-hit buffer** (switchable: `ARC_HIT_BUFFER`) and **silo sets**: hedge rings + containers at 1, a warehouse with window light + pallets at 2, a dense forest at 3 | **done 2026-10-07** |
| 2h | **Fourth playtest notes:** walk out of the tunnel to win, once the gate is fully open; one continuous tunnel; the gate flush, full width and solid; tanks and trees solid over their whole drawn shape; F only at a tank's base; round dark grates; tanks 10/15/20; drops +25%; "CLICK TO START" | **done 2026-10-04** |
| 2g | **Third playtest notes:** the intro flythrough with controls off; the gate bar and exit pocket (you could walk out before it opened); every spawn path kept inside the arena (screamer summons and splitter sheds went through the sector placer); the baseball-field layout; grey sunken funnels with grates and twin pipes; tall solid tanks and trees (1D iso); +2 tree patches and +10% density; the Bosconian cabinet panel | **done 2026-10-04** |
| 2f | **Second playtest notes:** compress the map (a 2400×1400 arena with a fixed chain), make the silos clear (beacon + edge arrow), a right sidebar with a permanent whole-map view and the HUD, auto-pickup, grass with tree and bush patches | **done 2026-10-04**; see `zombie/CLAUDE.md` "The arena, terrain, auto-pickup and the sidebar" |

### 2m — fifth playtest: next steps (2026-10-11)

*Game: hub ZOMBIE ARCADE. Finish-line item: §5 item 2 (a playable, finished Zombie) and item 3
(bugs that end a session).* The group's report, and where each line landed:

| Report | State |
|---|---|
| Guests: dozens of zombie shapes flashing all over, "near-unplayable" | **fixed, verified headless.** Root cause below |
| Zombies stuck at hedge corners, then despawn; hurts the early game | **fixed, verified headless** (48/48 reach the target, 0 relocations; was ~30/48 and 22–43) |
| Revive shorter | **done**: 1.5s → 0.75s (`ARC_REVIVE_MS`) |
| Respawn 10s | **done** (`ARC_RESPAWN_MS`) |
| Funnels larger | **done**: r 110 → 150 (`ARENA_FUNNEL_R`); funnel 2 moved up 80px so its warehouse clears the start |
| Silo 1 hedges too tight | **done**: inner ring 36 → 100px off the tank, every gap and lane 130 → 200px, a gap on all four sides of the inner ring |
| Guns bigger; know which gun I hold and what else I own | **done**: icon 4x → 6x, strip icons 1x → 3x with key numbers, the gun in hand is a filled cyan tile |
| Perk tiles running off screen | **done**: tiles wrap (3 a row at 246px); the checklist hides under 900px tall so the loadout always fits |
| Objective text readable from the periphery | **done**: 15px → 24px bold with an amber bar; stats 15 → 17px and one paragraph |
| Negative drops | **done**: MUD, FLARE, JAM — see CLAUDE.md |
| "Increase bullet curving?" | **not built — needs the user's answer.** No bullet in this game curves. See question 1 below |
| More crowd tools; let the swarm breathe without rounds | **recommendations only**, below |

**What was actually wrong (so it is not re-broken):**

1. *Flashing.* The host `splice`s a zombie out of `zombies` on every kill; the guest matched snapshot
   rows to its own zombies **by array index**. So after any kill every later zombie inherited its
   neighbour's old position and lerped across the screen. Cost scales with kill rate, which is the
   arcade's whole premise. Rows now carry a stable `nid` (index 4); `[x, y, type, flash, nid,
   burn?, launch?, lvx, lvy]`. Host assigns lazily, guests keep the max so a promoted host never
   reuses an id.
2. *Hedge pathing,* three stacked causes, found by a headless reproduction (a target at funnel 1,
   48 zombies released from outside the rings, 45 simulated seconds):
   a. `navStepToward`'s off-field recovery took the lowest field distance within ±2 cells with **no
      line-of-sight check**, which is almost always the cell on the *far side* of the wall the body
      is pressed against. (Walls off the 20px lattice — 24px hedges, trees — block a cell that
      overhangs them, so a body flush against one has its centre in a blocked cell.) It now tries
      candidates in distance order and takes the first the body can walk to.
   b. The 5-cell lookahead was aimed through wall corners. It is now string-pulled: the furthest
      path point with a clear line.
   c. Axis-separated collision kept only the free axis's share of the step, so a goal nearly
      perpendicular to a wall crept at ~35% speed, tripped the stuck heuristic and was thrown the
      other way. A blocked step now spends its lost speed on the free axis (not while chewing).
3. *Measured after:* 0 relocations on all three silo sets over 3–6 seeds; every tank, switch strip
   and the gate reachable on both grids in 12 seeds (arena cells unreachable: 0.044% tight, 0.006%
   wide). A brute/splitter/screamer-heavy mix still relocates a few zombies that are *on* the
   target in a pile; that is the crowd, not the geometry, and the player is shooting in the real game.

**Questions for the user (answers change what gets built):**

1. *"Increase bullet curving?"* What did you see? Candidates: (a) ARC perk chains reach further /
   bend between more targets, (b) a homing/steering assist on rifle and SMG rounds, (c) RICOCHET
   bounces more, (d) you meant spread/recoil. Nothing is built until this is answered.
2. Hazard frequency: one about every 33 kills, max 3 live. Too rare / right / too common?

**Recommendations (not built; each is one line in `IDEAS_INBOX.md`):**

*Crowd management — in the order I would build them:*
1. **TANK PULSE.** When a tank fills, a shockwave (the existing `arcadeShockwave`, radius ×2) clears
   the swarm around the funnel. Three guaranteed crowd-clears per run, each tied to the objective,
   no new item, and a place for the team to regroup. Cheapest and the most on-theme.
2. **FREEZE drop (team).** Everything within ~400px of the taker is held for 3s, using the launch
   phase's "skip pathing" exemption. A crowd tool that lets you reload and reposition rather than
   one that kills.
3. **TURRET drop.** A 12s sentry on the spot, aimed at the nearest zombie. Gives a corner you can
   hold, and a reason for two players to stand together.
4. **Funnel as a kill zone.** Zombies standing on an active funnel take damage over time, so camping
   the funnel (which you must do anyway to fill the tank) is itself crowd control.
5. **A throwable (G).** Frag or stun, with its own small ammo that refills with AMMO drops. This is
   the only item here that is a skill action rather than a lucky drop; build it last.

*Breathing room without rounds — a clock can breathe, it just has to be told to:*
1. **A tide.** Multiply the spawn rate by `1 + 0.35·sin(2πT/28s)` on top of the exponential envelope
   in `arcadeSpawnRate`. The envelope is unchanged, so the run still overwhelms at ~4:00, but there
   are ~14s swells and ~14s ebbs inside it. Two constants; no round concept.
2. **A lull after each milestone.** Spawn rate × 0.4 for 8s after a tank fills and after the gate
   starts opening. Rewards the objective with a beat of air.
3. **Kill-feeds-the-lull.** Spawn debt drops by a little per kill in a burst (5 kills in 3s), so a
   good clear is rewarded with a gap rather than the same pressure. Only if 1 and 2 are not enough.
4. **Do not** lower the cap or flatten the curve: the 2–4 minute session depends on the overwhelm
   (`SCOPE_RULES.md` rule 0).

**Verify next playtest (the things headless cannot tell us):**
- Two real clients at 60+ zombies: is the guest view smooth? (Verified by snapshot replay, not on a network.)
- Silo 1 with the opened rings and r 150: is it still a "set", or now just a clearing?
- Funnel 2's warehouse after moving up 80px: start point still clear, route still ~16s?
- Revive at 0.75s: too forgiving? (Watch for downs being undone before a zombie leaves.)
- Do hazards read as "don't step" before the first one is taken, with no explanation?
- The sidebar at 1920×1080 (checked at 1366×768 only).

### 2q — the speed cap, the difficulty slider and the bot (2026-10-11, very last)

*Game: hub ZOMBIE ARCADE. Closes §5 item 2.* The user's three asks, and what happened to each:

| Ask | Result |
|---|---|
| Zombie speed capped at player speed, a hard rule | **done**, measured at exactly 4.00px a step at wave level 51, alone and in a 60-crowd. Crowd separation is held to the same budget |
| Scale back the map-starting time on 3 and 4 | **done**: map 3 120 -> 60s, boss 240 -> 100s, plus a `pace` on both (0.5, 0.6) and map 3's tanks -15% |
| Playtest as a 75th-percentile player; if it can't be trusted, a slider | **both.** A bot played it (it is not a person: see `zombie/CLAUDE.md` "Tenth"); the slider is built regardless, live, ticked, default 1.00, in the dev panel's top row |

**My best guess at a balanced HARD game win** (a guess, from a solo bot and arithmetic, not from a
human): *a competent group of three or four wins roughly one run in three, in 8 to 11 minutes, and what
beats the rest is the crowd on map 3 or the boss rather than maps 1 and 2.*

**The honest read of the bot's numbers.** At the shipped default (1.00) the solo bot cleared maps 3 and 4
together in 2 of 3 finished runs and won the boss alone in 3 of 4. The bot is a worse player than a person
(it cannot clear map 1 reliably), so **at 1.00 the game is likely EASIER than "hard" for a good group**.
That is deliberate: 1.00 is "fair", the number to learn the maps on. **My pick for "balanced hard" is
about 1.25** (bot: boss 1 of 4, shorter survival), and a group should move up to it after the first win.

| Slider | Who it is for | What the bot suggests it plays like |
|---|---|---|
| 0.50 CASUAL | a first run, or showing someone the game | boss comfortably won; map 3 gentle |
| 0.75 EASY | solo, or a pair that has not seen map 3 | boss won 3 of 4 (at the old defaults) |
| **1.00 DEFAULT** | **learning it; three or four who have cleared the first two maps** | **maps 3-4 won 2 of 3, boss 3 of 4**: fair |
| **1.25 HARD** | **my pick for the "balanced hard win": a competent group after one win** | boss ~1 of 4 and shorter survival |
| 1.50 BRUTAL | a stunt | boss 0 of 4 |

Groups are *stronger* than the solo bot (more guns, a revive, the powerups shared) but also face a
bigger swarm (the rate scales by 0.6 + 0.4 x players and the alive cap by +30 a player). The two roughly
cancel, which is why the default is not raised for a group: raise the slider instead.

**What to watch in the next playtest, and which way to move the slider:**
- *Dying on map 3 before the third tank* every time: lower to 0.75, or `pace` on map 3 to 0.4. It is the
  map the bot could not clear.
- *Clearing map 3 with a minute to spare*: raise to 1.25. That is the sign the boss is the only fight.
- *The boss over in under 3 minutes*: raise it. The horde is constant, so its pressure is the rate x D.
- *Anyone saying "I can't outrun them"*: that would be a bug, not a balance issue (the cap is exact).

**Verify next playtest (new):** does the slider's default feel like "hard" or like "unfair"? Is map 3
too long to be fun at any setting (its route is ~10,000px)? Does the 0.6x curve on the hard maps read as
a calmer game, or just as a longer one?

### 2p — maps 3 and 4 (2026-10-11, last)

*Game: hub ZOMBIE ARCADE. Closes §5 item 2.* A full run is now **four maps** (`zombie/CLAUDE.md` "Ninth").
That is well past `SCOPE_RULES.md` rule 0 (2 to 5 minutes): the user accepted a longer full run on
2026-10-11 and asked playtesting to decide; **estimate 6 to 10 minutes, a guess**. If it has to come back
under the line, the cheapest cuts are, in order: tank sizes (`caps`), map 3's clock head start, and a
checkpoint (restart at the map you died on) rather than game over. The playtest gate (rule 5) now has
**four un-played passes** stacked: nothing more should be added until the group has played this.

**Verify next playtest (new):** Is map 3's divider a good fight (two halves, a lane over and a pass
under), or a corridor chore? Is the boss unwinnable, trivially easy, or a good last stand? Are 8
negative drops at once funny or unfair? Does a four-map run still feel like one arcade run?

### 2o — the two proposals, decided and built (2026-10-11, last)

*Game: hub ZOMBIE ARCADE. Closes §5 item 2.* Lighting **A** was chosen (the "bands" pillar stands, bands
are finer, and nothing is black). **Rule 0 was accepted as an exception for now**: a full run is two maps,
about 4 to 7 minutes, and **playtesting decides whether map 2 is trimmed**. The knobs, all in
`ARENA_LAYOUTS[2]` and its neighbours: tank offsets (route ~7,800px against map 1's ~3,800), tank sizes
(8 to 16), `L2_LULL_MS` / `L2_RAMP_MS`, and `L2_CLOCK_OFFSET_S`. The playtest gate (rule 5) still applies:
**this is the third un-played pass**, so the group should play before anything more is added.

**Verify next playtest (new):** does the whole run feel like two acts or like one that overstays? Is
map 2's arrival lull long enough to read the map, and does the +35s ramp land hard? Which map-2 tank is
the worst to get to? Do the lit faces on hedges and racks read, or do they make the props look glowing?
Is the warehouse at 0.80 still scary enough?

### 2n — decisions on 2m's questions and recommendations (2026-10-11, later)

*Game: hub ZOMBIE ARCADE. Closes §5 item 2.* The user answered 2m: hazard frequency is right, and
bullet curving means *rounds that bend toward the nearest enemy, to raise damage output, stackable*.
Accepted from the recommendations, all built (`zombie/CLAUDE.md` "Sixth"): the tank pulse on F, a FREEZE
team drop, a TURRET drop (carried, placed on click, risky to place), the spawn **tide**, the **lull**
and **easing the spawn debt**. Added by the user: ammo hand-over to the next most powerful gun, and the
**BOOMGUN**. Not accepted or not mentioned, left in the inbox: funnel damage-over-time, the throwable.

**Two proposals are waiting on the user, and both trip a standing rule:**

| | Rule it trips | The choice |
|---|---|---|
| `zombie/LIGHTING_PROPOSAL.md` | `hub-visual-review` item 9: *light steps in bands, decided 2026-10-09*, and the complaint is "hard edge bands" | **A** finer bands + a floor under the dark + lit faces (recommended), **B** smooth the world light with a dated deviation, **C** amend the pillar |
| `zombie/LEVEL_2_PROPOSAL.md` | `SCOPE_RULES.md` rule 0 (2 to 5 minutes): a full run becomes ~4 to 7 | accept a longer full run, trim it, or leave it as one map; plus rule 5's playtest gate |

**Verify next playtest (new):** is SEEKER at x1 to x2 noticeable, and at x6 silly? Is the Boomgun's 1s
spin-up felt as tension or as lag? Does a frozen crowd read as frozen to a guest? Is the turret worth
the risk of placing it, and does 15s feel right? Do the tide and lull read as breathing, or as the
game stuttering?

### 2d — balance proposal: a swarm that escalates too fast to hold (not built)

The user's direction: *"ramp up zombie spawning tremendously so this becomes more of a swarm &
enemy management that escalates way too quickly."* What the numbers are today, all measured in
**rounds**:

- round 1 = 7 zombies at one per 1.4s, then ×1.16 per round, with 7s breaks
- a generator for 2,500 scrap, four levers, tanks of 12/24/36 funnel kills, and a 90s gate
- a winning run is well over 30 minutes and has never been timed

Proposed, on a **clock** rather than rounds:

| | today | proposed |
|---|---|---|
| Pacing unit | rounds + 7s breaks | **one continuous wave**, with no breaks, driven by elapsed time `T` |
| Spawn rate | 1 per 1.4s, flattening to 1 per 0.18s around round 18 | **0.8/s at 0:00, doubling every ~50s**: ~2/s at 1:00, ~5/s at 2:00, ~13/s at 3:00. Past 3:30 it outruns any loadout. That's the "escalates way too quickly" |
| Alive cap | budget-limited | **60 + 30 per player** (solo 90, four players 180). The 90-zombie flood is the most this map has ever run, so 180 needs a frame-time check |
| Mix | by round number | by `T`: walkers → runners at 0:30 → brutes and splitters at 1:30 → SUPER SPLITTER at 2:30 |
| Speed / HP | per round | per `T`, so the same curve the spawn rate follows |
| Objective | generator → levers → 3 tanks → (train) → 90s gate | **power on from the start** (no generator); **no levers**; **three tanks at 8/12/16 funnel kills**, which is about 20s each at the 1:00–2:30 kill rate; then **the gate opens over 30s** (not 90) |
| Win | escape | **escape inside ~2:30–3:30**. Getting out is a race against the curve |
| Loss | team wipe | the same. A death at ~3:30 should feel like the swarm won, not like a mistake |
| Economy | doors are the big sink; perks 9–12.5k ×3 stacks; guns 1.5–7.5k | **no doors exist now**. Option A: same wall-buys and stations, prices ÷~5, **one stack per perk**. Option B (more arcade): **guns and perks drop from kills** as timed pickups, and the stations go |
| Score | combat + round² + tanks + win ×2 | combat + **seconds survived** + tanks + escape bonus. Short runs post often, which suits the leaderboard |

**User's answers, 2026-10-04:** be **overwhelmed around 4:00**, so it's a race to finish and get out
before then. Only a team managing things very well gets past that point. **Guns and perks drop from
kills**, along with other drop kinds, all about one size (wall-buys were 4x+ a player). **One
pickup in total**: each drop goes to one player, so the team has to call drops out. Co-op must be
rewarded. Remove the door traps. Separation: yes. Landmarks: keep for now.

**Build spec (2d), as built 2026-10-04.** All of it lives in `zombie/zombie-arcade.js`, switched by
`ZOMBIE_ARCADE` (`zombie-core.js`):
- **The clock.** `T` = seconds since start, host-owned and sent as an elapsed duration.
  - Level = 1 + ⌊T/12⌋. It drives the existing type mix, HP and speed curves, so HORDE (L5, L15)
    and BRUTE (L10, L20) waves and the Blackout darkening (L7, L14) still punctuate the run.
    SUPER SPLITTERs arrive from L16 (3:00).
  - Spawn rate = 0.8/s × 2^(T/50) × team scale.
  - Alive cap = 60 + 30 per player.
  - Spawns land on a ring just off-screen around a random living player.
- **The chain.** Power is on from the start. There are no levers: the sluice is open and funnel 1
  is live. Tanks take 8/12/16 funnel kills. Throwing the third tank's switch opens the south gate
  over 30s (`ESCAPE_OPEN_MS`). The rail is scenery for this playtest: it's out of the chain and
  its cars don't move.
- **Win: everyone standing has to be at the gate.** The run is won when every player still on
  their feet is inside the exit zone. A downed teammate must be revived or left behind, and a
  player left behind gets no escape bonus.
- **Drops** replace the wall-buys, perk stations, ammo crates and traps, which are all removed.
  - Kinds: gun (tiered by level), perk (the nine that still mean something here; CONDUCTOR
    needed traps and SCAVENGER needed scrap), AMMO (whole team), OVERCLOCK (whole team), RALLY
    (whole team), FUEL (+4 to the live tank), SHOCKWAVE (blasts the swarm back from whoever
    takes it).
  - Every drop is 24px, 1.5x a player.
  - **The host decides who gets each drop**, through the purchase path, so two players can't
    both take it. Guns and perks need **F** (a deliberate choice, so you can leave it for someone
    else). Team drops are taken by walking over them.
  - A drop lasts 25s, at most 6 are live, and there's a 6% chance per kill, guaranteed at least
    every 25 kills.
- **Respawn** 15s after bleeding out, beside a standing teammate.
- **Separation:** a soft push-apart on a uniform grid, which skips zombies that are flying, chewing
  or already on their target.

**Swarm reading needs separation.** At 100+ alive, the reported stacking ("100+ zombies can be
within the same square") stops being cosmetic, because a swarm reads as a blob. The soft
separation in `PLAYTEST_2_PLAN` Phase 5 moves up with this, and it has to be measured first
(bodies per 20px cell under the cap).

**How to check it:** time-to-death for an idle player and for a moving player with a pistol, and
time-to-escape with the chain advanced at the intended kill rate. All three come from the
headless harness. Then the group plays it, because a curve that measures right can still feel
wrong.

## Phase 3 — ZOMBIE fixes from game night 1 · §5 item 2

Only what the night turns up. Candidates: minimap, floor tints, door/window art, zombie separation
(measure first).

## Phase 4 — The other four cards · §5 items 1, 3

RD Arena (never played by a human, MP included), 4D Pong with four humans, Glass City past level 1,
Gyro Space. Fix only bugs that end a session; everything else goes on a known-issues list.

**Added 2026-10-04 (user): every card gets the cabinet panel** (`AESTHETIC_GUIDE.md` §4.11a,
modelled on Bosconian; Zombie's is the reference). It is part of each card's Phase 4 pass, along
with trimming the card toward a 2–5 minute session (`SCOPE_RULES.md` rule 0).

## Phase 5 — Reconciliation · §5 items 4, 5

Fix the RD Arena MP row, archive finished plans, reconcile and stamp the repo-wide docs, write the
**lessons-for-the-long-game** doc, then tag `hub-1.0` and the Zombie fork point.

## Phase 6 — The long game, step 0 · after 1.0

Name and home, then engine, then a test of the level representation, in that order.

---

## ~~Open: the arcade scope cut (raised 2026-10-03)~~ — decided 2026-10-04

The user proposed that arcade ZOMBIE loses all rail elements and most walls. **Decided 2026-10-04**: see
Phase 2. Recorded here, in `zombie/THE_SPLIT.md`, `SCOPE_RULES.md` rule 0, `HUB_RETROSPECTIVE.md` §5
and `PROJECT_MEMORY.md`.
