# Cliff Run — build plan

**Which game?** `cliff-run/` — a new game, the repo's sixth active one. Not Hub ZOMBIE, not the
long game.

**Which finish-line item does this close?** **None.** `HUB_RETROSPECTIVE.md` §5 is a five-card
board plus Zombie v1, and a new game is not on that list. This is built **off-board on purpose**:
`SCOPE_RULES.md` rule 8 makes promotion one-in-one-out, and which card it would displace is the
user's call, not this plan's. So `cliff-run/` lands at the repo root (active, not
`under-development/`) and `hub/hub-core.js`'s `GAMES` array is **left untouched**. Requested by
the user 2026-10-16.

---

## 1. What it is

A 4-player free-for-all side-scrolling platformer down a cliff face. Ten levels. Forced scroll —
slow on level 1, fast by level 10 — with a rock avalanche filling the left 5% of the screen that
kills anyone it catches. Players 2–4 are bots for now.

**Session length.** `SCOPE_RULES.md` rule 0: 2–5 minutes. Ten levels inside that window means
~20–30s a level, which is what sets the level lengths in §4. This is the constraint that decides
the content budget, so it is stated first.

**Cabinet: RASTER.** `AESTHETIC_GUIDE.md` §1 makes the assignment mechanical — "what does the game
already draw?" — and the answer is chunky filled blocks on a tile grid with blocky sprites. So:
pure black ground, filled blocks snapped to a virtual pixel grid, scanlines permitted
(`data-cabinet="raster"` on `<body>` is what gates them), tight palette.

**World hue: `#6F8FA8` basalt steel.** A deliberate departure from §2.5's table, which is all
neon, and the reason is in the game: the cliff is the single biggest thing on screen, four player
identity colours are drawn on top of it, and the Signal Three have to stay legible against it. A
saturated terrain hue would fight all three. Rock reads as rock in three tones of basalt and the
hue budget goes to the entities — which is §2.2's own discipline ("most information was conveyed
by *brightness*, not hue"). Steel is also the one region of the hue table nobody has claimed: not
ice `#7DF9FF`, not glass `#00B4FF`, not rust `#C46A2F`.

---

## 2. Files

```
cliff-run/cliff-run.html   shell: cabinet panel, scanlines, menu, script order
cliff-run/cr-core.js       constants, state, teardown plumbing, identity, helpers
cliff-run/cr-audio.js      OWN AudioContext: one-shots + the sustained voices
cliff-run/cr-level.js      seeded level build + the guaranteed route
cliff-run/cr-entities.js   bodies, blocks, items, bombs, wind, branches, coins
cliff-run/cr-physics.js    integration, tile collision, wall skills, player-vs-player
cliff-run/cr-bots.js       route-following controller for players 2-4
cliff-run/cr-render.js     the raster draw
cliff-run/cr-panel.js      cabinet panel writers
cliff-run/cr-boot.js       window.GameInstance, menu, match flow, the loop  (LAST but one)
cliff-run/cr-dev.js        DEVTOOLS registration  (LAST)
```

Classic `<script>` tags, one shared global scope, no modules — the `file://` hard constraint.
Every top-level name is `cr`/`CR_`-prefixed; `scripts/check-global-collisions.js` enforces it.
`"use strict"` in **every** file (`GAME_PROTOTYPE_INSTRUCTIONS.md` §2: the directive is per-file,
and omitting it silently drops every file but the first into sloppy mode).

Load order: `identity.js` → `mp-core.js` → `retro.js` → `leaderboard.js` → `devtools.js` → this
game's files → `cr-dev.js`.

**Audio owns its own `AudioContext`, not `shared/sfx.js`.** Same call Glass City made and for the
same reason: `SFX` is a one-shot vocabulary with no sustained-voice primitive, and this game's two
most important sounds are sustained — the wind tunnels and the avalanche rumble. Loading `SFX` as
well would put a second `AudioContext` on the page. **The two shared jingles are reproduced
note-for-note** (`pickup` = rising triad 523.25/659.25/783.99, `death` = descending
392/329.63/261.63/196) so that the sounds `shared/sfx.js` says "should sound IDENTICAL everywhere"
still do.

---

## 3. Geometry and physics

Virtual framebuffer **480 × 288** (16:9, 30 × 18 tiles at `TILE = 16`), integer-scaled with
`image-rendering: pixelated` and letterboxed into the window-minus-panel. Players are 10 × 14 —
"somewhat small on screen", as asked.

`RETRO.snap()` at the draw call only. **Quantize rendering, never physics** (§4.4) — the sim never
sees a snapped value, because quantized physics produces collision bugs that read as gameplay
bugs.

Constants (virtual px, seconds), chosen so the generator in §4 can prove reachability:

| | value | consequence |
|---|---|---|
| `GRAVITY` | 760 | |
| `MOVE_SPEED` | 108 | |
| `JUMP_VEL` | −240 | apex 37.9px ≈ **2.4 tiles**, airtime 0.63s, range **68px ≈ 4.2 tiles** |
| double jump | −216 | second jump, only with a charge |
| `DASH_VEL` | 260 for 0.18s, 0.6s cooldown | ≈ +47px of reach |
| branch spring | −420 | apex 116px ≈ 7.2 tiles, range ≈ **7.4 tiles** |
| wall slide | `vy` capped at 46 | |
| wall jump | `vy` −230, `vx` ±140, 0.12s steer lockout | short enough to press back into the same wall — the Celeste back-and-forth |
| coyote / buffer | 0.09 / 0.10 | |

**Generated gaps are capped at 3 tiles** (48px) for a plain jump against a 4.2-tile range, and
**step-ups at 2 rows** against a 2.4-tile apex. Everything bigger needs a branch, a vent or a
double-jump charge, and the generator only emits those when it has placed the thing that pays for
them. The margin is the point: a route that is exactly reachable is a route the bots fail.

### Player-vs-player, the bouncy part

AABB overlap, resolved on the axis of least penetration.

- **Stationary is a wall.** `speed < 12 && onGround` → immovable; the mover takes the full
  reflection at restitution 0.8 and the wall does not move. This is also what makes a **finished**
  player on the catwalk a wall, which is the spec's own consequence ("remains stationary until
  other players finish or die") and is left in deliberately.
- **Landing on a head** (vertical axis, upper body falling): upper gets `vy = −190` and a jump
  refresh, lower gets `vy = +60` and a horizontal shove.
- **Both moving** → equal-mass elastic exchange along the normal at restitution 0.75, penetration
  split half each.

### Death

- `y` past the level floor → **death by falling**.
- left of the avalanche line (camera + 5% of screen width) → **death by avalanche**.
- A dead player **does not appear on later levels**. Level *n*+1 starts with exactly the survivors.
- **No human alive → the run ends immediately** and the leader is announced. With MP this is where
  the surviving-player winner is announced; see `SERVER_NOTES.md`.

---

## 4. Levels, lanes, and the guaranteed route

Ten levels, seeded (`levelSeed = CR_BASE_SEED + index * 7919`) so a level is reproducible and so
the room seed can replace the base seed later without touching the generator.

Length 150 → 190 tiles; scroll 46 → 96 px/s across the ten. The camera also pushes forward when
the leader passes 70% of the screen, so a fast player is never held back by the floor speed.

**Lanes → intermix, the mechanical version.** Four routes are generated, one per lane, top to
bottom — which is also the spawn order the spec asks for (P1 top-left, P2 upper-middle, P3
lower-middle, P4 lower-left). Each route's **allowed vertical range widens with progress**:

```
laneBlend = clamp(progress / 0.33, 0, 1)
band(lane, p) = lerp(thatLane'sBand, theWholeHeight, laneBlend)
```

At `p = 0` the four routes cannot leave their own band, so the map reads as four horizontal lanes.
By `p = 0.33` every route may use the full height, so they cross, share platforms and put players
in each other's way — which is the "actions of other players directly influence you by this point"
the spec asks for, arrived at by geometry rather than by a scripted event.

All four routes are stamped into **one** shared tile grid, so an overlap is a genuinely shared
platform.

**The route is the solvability proof.** Each route is emitted as a waypoint chain
`{x, y, kind}` with `kind ∈ walk | jump | spring | walljump | bomb | gust | wait`, and the
generator only emits a segment it has just made reachable. That is what lets §6 claim the bots can
finish: they are not solving the level, they are following a path that was built to be followable.
The human player ignores it entirely.

Segment vocabulary, weighted by level index: `run`, `gap`, `up`, `down`, `shaft` (wall-jump,
levels 4+), `branch`, `vent`, `crumble`, `breakable` (bomb, levels 6+).

### Tiles

| code | tile | look (must be unique — the spec asks for it twice) |
|---|---|---|
| 0 | empty | |
| 1 | stone | solid 3-tone basalt block |
| 2 | **crumble-instant** | hollow, hairline-cracked, **no top highlight** — reads as "not really there" |
| 3 | **crumble-timed** | solid but **scored across in red**, and it visibly ticks once touched |
| 4 | breakable | bolted plate, four rivets |
| 5 | branch | stroked limb, not a block |
| 6 | catwalk | steel grating, cyan edge — the finish |
| 7 | outpost | the comms structure at both ends |
| 8 | vent | a dark opening in the rock with its gust field attached |

Start **and** end of every level is a cliff-mounted Comms outpost with **4 catwalk platforms**.
Any player may take any catwalk; walking onto one finishes you and parks you there. The level ends
when every surviving player has finished or died, which is also why the finish re-separates into
four heights after the mid-level intermix.

---

## 5. Audio

One-shots: jump, double-jump, dash, land, coin, pickup, bomb-place, bomb-blast, crumble-tick,
crumble-collapse, block-impact, branch-spring, player-bounce, finish, level-start,
level-transition, run-over, death-by-fall, death-by-avalanche, countdown.

Sustained voices, gain-modulated per frame: **wind tunnel** (filtered noise, panned and gained by
proximity to the nearest vent), **avalanche rumble** (sub oscillator + low noise, gained by how
close the left edge is — the spec's "constant rumble"), and a thin altitude wind bed.

§4.10: square and triangle, hard envelopes, no reverb.

---

## 6. Bots, and how "they can actually beat the game" gets proved

Players 2–4 follow their own lane's route (§4). Controller, in priority order: avalanche panic
(sprint + dash when within 40px of the line) → hazard (a crumble already triggered is waited out
or jumped) → bomb (place, back off a tile, wait for the blast) → shaft (alternate wall, jump,
steer back) → waypoint seek (move toward target x; jump inside a launch window sized from the
physics in §3) → opportunist (coins and charges within a short detour).

Branches **auto-spring on landing** — a trampoline, not a timed input. That is a design choice
made for the bots' sake and it also feels better for the human.

A **stuck guard** (no forward progress for 1.5s while on the ground) fires a hop + dash, so one
bad frame cannot end a bot's run.

Per-bot skill jitter (reaction delay, timing error) scales with level index, so they are competent
but beatable. They are *meant* to die sometimes — that is the game.

**Verification is a headless harness, not a claim.** `scripts/cliff-run-playtest.js` runs the real
game files under `vm` with a stub canvas and no rAF, many seeds × all ten levels, and reports
per-level bot finish rates. The target is stated before the tuning, so the tuning cannot move it:
**a bot reaches and clears level 10 in the clear majority of runs.** Numbers land in
`cliff-run/CLAUDE.md` when they are real.

---

## 7. Cabinet panel — required

`AESTHETIC_GUIDE.md` §4.11a, modelled on Zombie's `#sidebar` (`clamp(240px, 18vw, 380px)`, ground
`#050505`, 2px `--phos-dim` inner rule, red labels / white values).

1. **HI-SCORE** + **1UP**
2. **The radar** — the whole level in a 3px light frame: terrain silhouette, the four players, the
   four catwalks, the avalanche line, vents and breakables. The things you navigate by.
3. **CONDITION** GREEN / YELLOW / RED by distance to the avalanche, RED blinking. Beside it, four
   **lives** blocks — one per player, red when dead, dim when finished.
4. **NEXT** — the objective ("REACH THE OUTPOST", "BOMB THE WALL", "RIDE THE GUST").
5. **Readouts** — LEVEL *n*/10, TIME, COINS, SPEED, and the loadout (double-jump charge, bombs) at
   the bottom.

**Nothing in the panel is also drawn on the play field.** No corner minimap, no duplicate HUD.

---

## 8. Lifecycle

`window.GameInstance` with `init` / `start` / `pause` / `resume` / `destroy` / `getState`, per
`GAME_PROTOTYPE_INSTRUCTIONS.md` §2. Every timer through `trackTimeout` / `trackInterval`, every
listener through **one** `AbortController`, `cr-audio`'s context closed in `destroy()` — browsers
cap live contexts per page and an init/destroy cycle that never closes one eventually fails to
make another.

Attract mode (§4.8) via `RETRO.attract`, idle 20s: the sim runs itself with four bots and
`INSERT COIN` pulses in `--sig-amber`. Cheap here, because the bots already exist.

---

## 9. Deliberately not in this pass

- **Multiplayer.** Considerations written to `cliff-run/SERVER_NOTES.md`, nothing wired. No
  `MP.connect` beyond identity, no message types, no host election.
- **Firebase.** `leaderboard.js` is loaded and `LB.submit` is called at run end, which is the
  existing pattern and no-ops on `file://`. No new Firestore work.
- **The hub board.** `GAMES` untouched; see the header.
- **Mobile.** Desktop keyboard only, like the rest of the board since `SCOPE_PULLBACK_PLAN.md`.

## 10. Checks before this is called done

```
node scripts/check-global-collisions.js
node scripts/check-undefined-globals.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
node scripts/cliff-run-playtest.js
```

Plus the game served over `http` in the browser pane (a `file://` page renders as a static
snapshot with scripts disabled, so it cannot show that the game *runs*) and opened by double-click
once, to prove the `file://` constraint holds.

---

# Revision — compact, claustrophobic, strategic (2026-10-17)

The user's second pass, after seeing the first build. Seven changes, and the first
one sets the scale for all the others.

## R1. The player is a Zombie player

*"player character should appear the same as on zombie."*

`zombie/zombie-render.js` `drawPlayerBody` is a **16×16 filled square** in the
identity colour with a **4×4 white facing pip** at `centre + facing*13 − 2`, plus
a 2px white ring while invulnerable and `#FF5555` at 60% height when downed. That
is the whole sprite. It ports here as-is: the square becomes the body, the pip
becomes horizontal-only, and the blocky little figure built in the first pass is
deleted.

This also answers R2's second half for free — a 16px square inside a 24px tile is
exactly *"players should be slightly smaller blocks within that space."*

## R2. Bigger blocks, smaller player, less screen

| | was | now |
|---|---|---|
| `CR_TILE` | 16 | **24** |
| framebuffer | 480×288 = 30×18 tiles | **480×336 = 20×14 tiles** |
| player | 10×14 figure | **16×16 square** |
| lane rows | 3 / 7 / 11 / 15 of 18 | **3 / 6 / 9 / 12 of 14** |

Twenty tiles of sight line instead of thirty, and three rows between lanes
instead of four. A body 16 tall on a 24 grid still occupies exactly **one row**,
so the corridor reservation (`CR_CORRIDOR_ROWS`) is unchanged in meaning.

## R3. Slower, more deliberate, and a jump that cannot do everything

*"more slow-moving… more strategy."* Strategy comes from the jump being **unable
to solve the level by itself**, so the numbers are chosen to make one specific
thing true: **a plain jump clears a 2-tile gap but not a 2-tile climb.**

| | value | consequence |
|---|---|---|
| `gravity` | 1000 | less float than 760 |
| `moveSpeed` | 120 | 5 tiles/s, down from 6.75 |
| `jumpVel` | −290 | apex 42px = **1.75 tiles** — one tile up, never two |
| | | airtime 0.58s → range 70px = **2.9 tiles** → `crMaxGap` = 2 |
| double jump | −260 | total range ≈ 4.4 tiles → `crMaxGap` = **3** |
| scroll | 24 → 46 px/s | slack 5.0 falling to 2.6 |
| level length | 60 → 80 tiles | ~20–28s a level, ten in about four minutes |

So a 2-tile climb and a 3-tile gap are **double-jump-only**, which turns the
`dj` pickup from a bonus into a key, and *where you spend it* into the decision
the brief is asking for.

## R4. The cliff is solid, and you run in corridors carved out of it

*"compact… claustrophobic."* The first build drew thin platforms floating in
black, which reads as open air. A thickening pass after generation grows every
solid tile **downward** by up to `CR_THICK` rows, stopping at any lane's reserved
corridor, at `CR_ROW_MAX`, or at rock already there.

Three things fall out of that, all wanted:

- the world reads as **rock with passages cut through it**, not girders in space;
- the space between two lanes becomes mostly solid, leaving 1–2 row corridors;
- a hole in an upper lane's floor is a **shaft into the lane below** — so falling
  costs you height and position instead of the run, and the lanes connect
  vertically without a single line of code that says "now interact".

Only the bottom lane (row 12) has nothing under it, so only the bottom lane's
holes are lethal. That asymmetry is deliberate and is the price of the easiest
spawn being at the top.

## R5. One-block-tall squeezes

*"There should be gaps only a single block tall."* A new `tunnel` segment: floor
at row R, the body's row R−1 carved, and **rock at R−2**. A 16px body fits a
24px opening with room; a jump does not. You commit, you cannot dodge, and you
cannot be bounced over it — which is the most strategic thing a corridor can be
in a game whose other three players are solid.

## R6. Forgiving at the start, lethal at the end

*"early levels should allow for imprecise input, and maybe the first two levels
lack the ability to fall off the map."*

- **Levels 1–2 have a floor.** A solid row at `CR_ROW_MAX + 1` across the whole
  level. You can still lose — the avalanche is the pressure — but you cannot
  fall out of the world. From level 3 the floor is gone and the void is real.
- **Input forgiveness ramps down**: `coyote` 0.16 → 0.09s, `jumpBuffer` 0.18 →
  0.10s, scaled per level, so a late press still works early on.
- **Gaps ramp up**: 1 tile on levels 1–2, 2 from level 3, and from level 8 some
  are sized to the double-jump reach so they cannot be crossed without one.
- **Features unlock in order**: 1–2 nothing but ground and gaps · 3–4 crumbling
  blocks and squeezes · 5–6 branches and wind · 7–8 chimneys · 9–10 bomb walls
  and double-jump gaps.

## R7. What has to be re-measured

Every number in `cliff-run/CLAUDE.md` is against the old 16px geometry and is
void. `scripts/cliff-run-playtest.js` is unchanged and still the arbiter; the
acceptance bar in it stays where it is.

---

# Movement: the control scheme (2026-10-17, third pass)

The user's verdict on the first two passes: *"I'm looking for something a lot
more dynamic and easy to play… the jumping off of the wall is hard to master,
and I wouldn't expect a friend group to get it down."* That is the right call,
and it is worth saying exactly why the first version was wrong.

**I copied Celeste's wall, and Celeste is a single-player precision game.** Its
wall-jump asks you to hold *into* a wall, jump, then press *back* to return —
three correctly-ordered inputs inside about a fifth of a second, for one move.
That is a reasonable thing to ask of someone who will spend forty hours in a
game alone. It is not a reasonable thing to ask of the third friend at a
keyboard who has never seen this before and is about to be eaten by a rock.

## What the good four-player platformers actually do

| Game | What it asks of your hands | The lesson |
|---|---|---|
| **SpeedRunners** | Run, jump, slide, and a **one-button grapple that aims itself**. Four players, one forced-scrolling screen, you die when the screen leaves you behind. | The closest relative this game has. Its dynamism comes from a verb that *cannot be fluffed* — you press one key and the hook finds an anchor. |
| **TowerFall Ascension** | Move, jump, shoot, dodge. Wall-cling is **automatic on contact**; the wall-jump is just "jump while touching a wall". | The single most-copied accessible wall in the genre. No direction, no window, no technique. |
| **Ultimate Chicken Horse** | Move, jump, wall-jump — and that is the entire verb list. | A party platformer whose depth is in the LEVEL, not the fingers. Groups do manage its wall-jump, because it is one key. |
| **Rayman Legends** (co-op) | Run, jump, and wall-runs that trigger **by touching the wall**. | Contact-triggered traversal: the level performs the trick, you supply the timing. |
| **Duck Game** | Move, jump, grab, shoot. | Chaos from items and from each other, never from execution. |
| **Celeste** | Precise directional wall work, air-dash with eight-way aim. | The one to learn *from* and not copy. It is a game about mastery. |

The pattern across all five of the accessible ones: **the player supplies
timing and intent; the level and the game supply the execution.**

## The scheme now implemented (Option A — "nothing needs mastery")

```
A / D  or  ← / →      run
W / ↑ / SPACE         jump  — hold for height, and ONE FREE AIR JUMP
                              that recharges on any contact
double-tap a direction
       or SHIFT       dash
E                     set down a bomb
```

Three changes from the last build, all of them removals:

1. **The wall asks for nothing.** Touch it while falling and you cling and slide
   automatically — no direction held. Press jump and you go up and away from it.
   The steer-lock afterwards is short enough that you are flying again almost
   immediately. There is no input you can get wrong; the only skill left is
   *when*, which everybody already has.
2. **Everyone always has a second jump**, back the moment you touch ground or a
   wall. This is the largest accessibility win available to a platformer:
   almost every mistake becomes survivable, and — counter-intuitively — the
   game gets *more* dynamic rather than easier-looking, because people start
   attempting things they would not have risked. The chevron pickup now grants
   an **extra stored jump on top of it**, so it means "I can try the big route"
   instead of "I am allowed to jump twice".
3. **Input windows ramp.** `coyote` and `jumpBuffer` run at 1.8× on level 1 and
   1.0× by level 10, so a late or early press works while you are learning and
   stops working once you are not.

## Two alternatives, if Option A still is not dynamic enough

**Option B — the grapple (SpeedRunners).** One key; it finds the nearest anchor
ahead-and-above and swings you to it. The most dynamic thing available and
genuinely easy, because the aiming is the game's job. Costs: a new anchor tile,
a rope constraint in the physics, anchor placement in the generator, and a new
bot behaviour. Call it a session's work. It would also change what the levels
want to be — more open air, fewer corridors.

**Option C — momentum.** No dash; speed builds as you run and slopes carry it,
with jump height scaling off speed. Superb feel, and the wrong shape for this
engine: it needs sloped collision, which the tile grid does not have.

**Recommendation: A now, B as the next feature if the group wants more.** A is
in and measurable; B is the one worth building if "more dynamic" still is not
met after a playtest.

## Level design that inspires movement

The accessible games all put the dynamism in the level. What that means here,
roughly in order of value per hour:

1. **Branches are the best verb in the game and are currently rare.** A spring
   that throws you ten tiles forward is the most expressive thing here and it
   needs no technique. Raise their frequency sharply and build *around* them —
   a branch over a long drop, a branch that is the only way onto a high shelf.
2. **Make the wall-jump optional, never required.** Chimneys should be a
   shortcut past a longer, flatter route, so a group that never learns them
   still finishes and a player who does is rewarded. Right now a chimney is a
   wall across the only path.
3. **Vertical shafts between the lanes.** `crThicken` already turns a hole in an
   upper lane's floor into a shaft into the lane below. Place those
   deliberately: a drop that *gains* you ground is a decision, and it is the
   cheapest way to make four lanes feel like one place.
4. **Updraft vents as routes, not obstacles.** A gust that lifts you two lanes
   is free dynamism — the game does the move.
5. **Wide, obvious coin arcs** along the fast line, so the greedy path and the
   quick path are the same shape and reading one teaches the other.
6. **One pinch per level where all four lanes meet.** With bouncy bodies and a
   fixed screen, a single shared ledge is where the game becomes four-player
   rather than four parallel one-player games.
7. **Squeezes as commitment, not filler.** A one-block tunnel next to an open
   route is a real choice: faster, but you cannot jump, dodge, or be bounced
   out of trouble while you are in it.
