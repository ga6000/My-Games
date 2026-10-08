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
| 2k | +25% outer buffer left/top/right with the chain unmoved; "ESCAPED AT m:ss"; no damage after the win; six perk slots | **done 2026-10-07** |
| 2j | Two-step wounds + 1.2s untouchable, no explanatory text; 1.5s revive; no Blackouts; no ping or DECOY; ATTRACT perk; drops +25%; arena +33% per side; real lighting (dark warehouse, window light); tight hedges, warehouse racking, a thicker forest; `pushProp` placement bug fixed | **done 2026-10-07** |
| 2i | **One-hit buffer** (switchable: `ARC_HIT_BUFFER`) and **silo sets**: hedge rings + containers at 1, a warehouse with window light + pallets at 2, a dense forest at 3 | **done 2026-10-07** |
| 2h | **Fourth playtest notes:** walk out of the tunnel to win, once the gate is fully open; one continuous tunnel; the gate flush, full width and solid; tanks and trees solid over their whole drawn shape; F only at a tank's base; round dark grates; tanks 10/15/20; drops +25%; "CLICK TO START" | **done 2026-10-04** |
| 2g | **Third playtest notes:** the intro flythrough with controls off; the gate bar and exit pocket (you could walk out before it opened); every spawn path kept inside the arena (screamer summons and splitter sheds went through the sector placer); the baseball-field layout; grey sunken funnels with grates and twin pipes; tall solid tanks and trees (1D iso); +2 tree patches and +10% density; the Bosconian cabinet panel | **done 2026-10-04** |
| 2f | **Second playtest notes:** compress the map (a 2400×1400 arena with a fixed chain), make the silos clear (beacon + edge arrow), a right sidebar with a permanent whole-map view and the HUD, auto-pickup, grass with tree and bush patches | **done 2026-10-04**; see `zombie/CLAUDE.md` "The arena, terrain, auto-pickup and the sidebar" |

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
