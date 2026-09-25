# Zombie — co-op gameplay & level design ideas

> **STATUS — all 26 ideas below are incorporated as of 2026-09-01**, four of them changed in the
> doing and one retired. Scorecard in the next section. This file is kept as the design
> *rationale* — the why behind each mechanic. For what exists now read `zombie/CLAUDE.md`; for how
> it was built and what was skipped, `zombie/REBUILD_PLAN.md`.
>
> **Part 5 update (2026-09-02):** **19 of the 20 are built** — everything except **34** (map
> changes between rounds) — plus the lighting rework, the wall-buy change, ADRENALINE removal,
> powerup cards (3 slots, each stacking to x3), and a spawn-placement rewrite: zombies now only
> appear in zones nobody has entered, or from off the edge of the map, never in ground the team
> has already crossed.
>
> The "current design" section below describes **v1**, the game as it was *before* this work. Left
> intact because the arguments only make sense against it.

Written 2026-09-01, against `zombie/Zombie.html` as it then stood. Every entry names the
multiplayer consequence, because in this game that's the hard part, not the mechanic.

## What got incorporated

| # | Idea | Status |
|---|---|---|
| 1 | Downed & revive | **Shipped** — 25s bleed-out, host-owned |
| 2 | Revive cost escalation | **Shipped** — 3s / 4.5s / 6s per round |
| 3 | Shared scrap | **Shipped** — host-validated buys |
| 4 | Team-wide pickups | **Changed** — team-wide kept, but `OVERCLOCK`/`ADRENALINE`/`RALLY` instead of the 1:1 CoD set. Ammo resupply became a map feature (crates) |
| 5 | Kill credit + scoreboard | **Shipped** — kills, assists, revives |
| 6 | Proximity bonus | **Shipped** — 1.5x within 150px |
| 7 | Round spawning | **Shipped** — the backbone, as specced in Part 1 |
| 8 | Intermission breather | **Shipped** — 7s, reboards barricades |
| 9 | Special rounds | **Shipped** — Horde ÷5, Brute ÷10, Blackout ÷7 |
| 10 | Team-size scaling | **Shipped** — fixed the "more friends = easier" bug |
| 11 | Runner | **Shipped** |
| 12 | Screamer | **Shipped** — summons until killed |
| 13 | Splitter | **Shipped** — bursts into 3 spawnlings |
| 14 | Isolation targeting | **Shipped** — ~25% of zombies |
| 15 | Wall-buys | **Shipped** — 9 across the map |
| 16 | Openable doors | **Changed twice** — first built to gate *rewards* only (safe), then rebuilt as true **map segmentation** on request. Now 12 zone doors |
| 17 | Barricaded windows | **Shipped** — and became the load-bearing piece of segmentation |
| 18 | Defensible centre | **Shipped** — the keep, 2 doorways |
| 19 | Darkness + light radius | **Scoped down** — Blackout rounds only, not permanent |
| 20 | Environmental hazards | **Shipped** — barrels (chain-explode) + buyable traps |
| 21 | Weapon roles | **Shipped** — pistol / rifle / shotgun / SMG / sniper |
| 22 | Ammo scarcity | **Shipped** — with an infinite pistol so a dry team is never stuck |
| 23 | Mouse strafe fix | **Retired** — obsoleted when couch co-op was cut. See its entry |
| 24 | Ping / marker | **Shipped** |
| 25 | Downed alert | **Partial** — arrow + flashing marker shipped; **the sound never was**, because the game has no audio at all. Picked up by idea 43 |
| 26 | Off-screen indicators | **Shipped** — required once the camera panned |

**Also built, beyond the original list:** the 9x map and panning camera, the single WASD+mouse
control scheme (couch co-op removed after playtesting), 3x3 map segmentation, BFS flow-field
zombie pathfinding, per-weapon screen shake, and the two bugs in Part 4.

**The one thing the whole list never touched: the game is completely silent.** That is what
Part 5 is mostly about.

## Read the v1 design first (superseded)

- **Players**: up to 3 local (mouse / WASD / arrows) + any number networked. Size 16, speed 4,
  **1 HP**, no respawn. Mouse players move *toward* the cursor, so aim and movement are the same
  vector — they cannot strafe, WASD players can.
- **Combat**: one bullet per 1000ms (100ms for 5s under the minigun pickup). Bullets die on walls.
- **Zombies**: spawn off the map edges every `zombieSpawnRate` ms (2000, decaying 0.3/frame to a
  floor of 200). Speed `zombieBaseSpeed` (1.0, +0.0003/frame) ± 0.2 per zombie. 1 HP.
  "Powerful" variant: purple, size 24, 5 HP, ×1.4 speed, released in waves gated on total spawns.
- **Level**: 4–8 buildings, each a *nook* (3 walls) or *through* (2 parallel walls). **No border
  walls** — zombies pour in from all four edges.
- **Authority**: host simulates zombies, bullets-vs-zombies and deaths; clients own their own
  players and predict their own shots.

## The two framing problems

**1. Nothing requires cooperation.** Every mechanic is individual. Two players in a room have
exactly the experience of two players in two separate rooms who happen to share a wall layout.
Most of the list below exists to fix this.

**2. Difficulty ignores team size.** Spawn rate and speed are driven purely by wall-clock time.
An eight-player room gets the same trickle as a solo player, so the intended "we're being
overwhelmed" fantasy never arrives. **Fix this first — several ideas below are balanced against
it and will feel wrong without it.**

---

# Part 1 — Round-based spawning (requested)

Replaces the continuous time-decay trickle with discrete rounds: a fixed budget of zombies per
round, a breather between rounds, and difficulty that scales with **round number and team size**
rather than elapsed seconds.

## Why it's the right backbone for co-op

The current game has no punctuation — it's one unbroken ramp, so there is never a moment to
regroup, share a pickup, revive someone, or decide anything together. Rounds create a repeating
beat: *fight → survive → breathe → talk → fight harder*. Nearly every other idea in this
document hangs off that breather.

## State (host-authoritative)

```js
let round = 0;
let roundBudget = 0;         // zombies left to SPAWN this round
let roundPhase = "idle";     // idle | active | intermission
let roundEndsAt = 0;         // host clock; sent as a DURATION, see note 4
const ROUND_BREAK_MS = 7000;
```

## Curves

```js
function teamSize() {
    return Math.max(1, players.length + Object.keys(remotePlayers).length);
}

// Gentle round 1, ~1.16x per round, then scaled by how many people are playing.
function budgetForRound(r) {
    const solo = Math.floor(6 * Math.pow(1.16, r - 1)) + r;
    return Math.ceil(solo * (0.6 + 0.4 * teamSize()));
}

function zombieHpForRound(r)      { return 1 + Math.floor(r / 6); }
function zombieSpeedForRound(r)   { return Math.min(2.6, 0.9 + r * 0.06); }
function spawnGapForRound(r)      { return Math.max(180, 1400 - r * 70); }
function powerfulShareForRound(r) { return r < 4 ? 0 : Math.min(0.22, 0.03 * (r - 3)); }
```

The `0.6 + 0.4 * teamSize()` shape gives 1 player = 1.0x, 2 = 1.4x, 4 = 2.2x, 8 = 3.8x — more
players is more dangerous, but sub-linearly, so a big room isn't instantly overrun.

## Flow, inside the existing `if (netIsHost)` block in `update()`

```js
if (roundPhase === "intermission" && now >= roundEndsAt) startRound(round + 1);

if (roundPhase === "active") {
    if (roundBudget > 0 && now - lastSpawnTime > spawnGapForRound(round)) {
        spawnZombie(Math.random() < powerfulShareForRound(round));
        roundBudget--;
        lastSpawnTime = now;
    }
    // Round clears only when the budget is spent AND the map is empty.
    if (roundBudget === 0 && zombies.length === 0) {
        roundPhase = "intermission";
        roundEndsAt = now + ROUND_BREAK_MS;
    }
}
```

`startRound(r)` sets `round = r`, `roundBudget = budgetForRound(r)`, `roundPhase = "active"`.

## Integration notes — the parts that will bite

1. **Delete the time-based drift.** `zombieBaseSpeed += 0.0003` and `zombieSpawnRate -= 0.3` must
   go, or difficulty scales twice and rounds 8+ become unplayable. `spawnZombie` should read
   `zombieSpeedForRound(round)` / `zombieHpForRound(round)` instead of the globals.
2. **Reset in `resetGame()`** — `round`, `roundBudget`, `roundPhase`, `roundEndsAt`. Easy to miss;
   that function already has a long tail of fields.
3. **Wire format**: add `rd` (round), `rp` (phase), `rt` (ms remaining) to the `world` snapshot in
   `broadcastWorld`, and apply them in `applyWorldSnapshot`. Two numbers and a short string —
   negligible next to the zombie array.
4. **Send the intermission timer as a REMAINING DURATION, not a timestamp.** Clients' `Date.now()`
   clocks are not synchronised. The existing code already has one live instance of this mistake
   (see Part 4), so don't copy the pattern.
5. **Host migration**: if the host drops mid-round, a promoted host inherits `round` from the last
   snapshot it applied, but `roundBudget` is host-only and would be lost. Simplest correct answer:
   broadcast `roundBudget` too and resume from the last value seen.
6. **Powerups** currently drop every 20 total spawns. Re-hang them on rounds instead — one
   guaranteed drop per round clear reads as a reward rather than a random trickle.

## Presentation

A big centred `ROUND 7` card during intermission, the round number always visible in the HUD, and
a distinct sound on round clear. The card is the natural home for the end-of-round scoreboard
(#5) and a revive summary.

## Special rounds

Every 5th round, swap the composition instead of just scaling it:

- **Horde** (÷5): triple budget, all fast, all 1 HP, no powerfuls. Pure crowd control.
- **Brute** (÷10): small budget, all powerful. Forces focus fire and target calling.
- **Blackout** (÷7): vision collapses to a small radius per player (#19), so the team must
  physically stay together to see.

---

# Part 2 — The idea list

## A. Make players actually need each other

**1. Downed & revive.** *The single highest-value change in this document.* Instead of dying
outright, a player enters a `downed` state: crawling at ~1 speed, unable to shoot, bleeding out
over ~25s. Any teammate who stands adjacent for 3 uninterrupted seconds revives them. Bleed out
with nobody coming and *then* you're dead for the round. This makes your friend's position your
problem, and it fixes the current worst social outcome — dying at 40 seconds and spectating for
ten minutes.
*Multiplayer*: host owns the downed/bleed state and revive timer, extending `killLocalPlayer` and
the existing `death` message rather than adding a new authority. Add `dn` (downed) and `rv`
(revive progress) to the player payload. **Medium effort; everything else in section A assumes it.**

**2. Revive cost escalation.** Each revive within a round raises the *next* revive's time
(3s → 4.5s → 6s), resetting at round start. Stops chain-reviving from trivialising a round and
makes "do we go get them now or clear first?" a real question. *Small, once #1 exists.*

**3. Shared scrap currency.** Zombies drop scrap into a **team pool**, spent at wall-buys (#15) on
weapons, ammo and doors. One pool means one conversation: who gets the shotgun.
*Multiplayer*: pool lives on the host and rides the snapshot as one integer. Spending must be a
host-validated request (`{k:"buy"}`), or two players will spend the same scrap on the same frame.
*Medium.*

**4. Team-wide pickups.** Make the minigun pickup — and new ones — apply to **everyone alive**:
Max Ammo, Instakill, Double Points, Nuke. Instantly creates the "GRAB IT!" moment shared powerups
are famous for. *Small* — the pickup already spawns and syncs; only the application changes.

**5. Per-player kill credit + end-of-round scoreboard.** `kills` is currently one shared number.
Bullets **already carry `owner`** (the shooter's netId) all the way through the wire, so
attribution is nearly free: on a kill, increment a per-owner tally instead of the global. Show it
on the round card, with revives and assists as their own columns so the player who spent the round
reviving isn't shown a zero. *Small, and it makes the group competitive inside a co-op frame.*

**6. Proximity bonus.** Kills within ~150px of a teammate score 1.5x. A quiet, always-on nudge to
fight as a unit rather than drifting to opposite corners. *Small.*

## B. Pacing & structure

**7. Round-based spawning.** See Part 1.

**8. Intermission breather.** The 7s between rounds — regroup, revive, spend scrap, read the
scoreboard. Its mechanical purpose is to make the *social* moment exist.

**9. Special rounds.** See Part 1.

**10. Team-size scaling.** The `teamSize()` multiplier. Standalone value even if you adopt nothing
else: without it, a full room is a walkover.

## C. Zombie variety

Every zombie currently beelines at its nearest player and differs only in size and HP. Variety is
what forces *roles* and *callouts*.

**11. Runner.** Fast (×2), 1 HP, small, from round 3. Punishes wandering alone and creates the
"behind you!" callout co-op lives on. *Small.*

**12. Screamer.** Slow, 3 HP, spawns two regular zombies every 4s until killed. A priority target
the team must name and focus — the best single mechanic here for forcing verbal coordination.
*Small; reuses `spawnZombie`.*

**13. Splitter.** 3 HP, size 24; on death splits into three fast size-8 zombies. Punishes
point-blank shotgunning and injects sudden chaos into a tidy defence. *Small.*

**14. Isolation targeting.** Have ~25% of zombies target the *most isolated* player — furthest
from any teammate — instead of the nearest. This is the mechanical enforcement of "don't split
up", and it's about eight lines inside the existing target-selection loop.
*Small, high impact.*

## D. Level design

The arena is 4–8 free-standing buildings with open edges on all four sides. There is no defensible
position, no chokepoint and no reason to be anywhere in particular — so there is nothing to *hold
together*.

**15. Wall-buys.** Marked spots on building walls selling a weapon or ammo for scrap. Gives the map
named landmarks ("meet at the shotgun wall"), which is most of what co-op map communication needs.
*Medium.*

**16. Openable doors.** The map starts small — one building's interior — and doors bought with
shared scrap (#3) expand it. Makes spending a **group decision** and gives a long session a sense
of progress beyond a rising number. *Medium; doors must be part of the seeded layout so every
client agrees.*

**17. Barricaded windows.** Zombies break through boarded windows over a few seconds; players
re-board them during intermission. Creates a defensible interior and a job for whoever isn't
holding the front. *Medium.*

**18. A defensible centre.** The cheap version of #15–17: guarantee one central building with
exactly two entrances. Suddenly "hold the middle, you take that door, I'll take this one" is a
plan the level supports. **Do this before the fancier versions — it's a change to
`generateLevel()` alone and would improve the game tonight.** *Small.*

**19. Darkness + light radius.** Each player carries a light radius; outside it the map is black.
Forces genuine physical grouping and makes Blackout rounds trivial to add. Fits the DOS aesthetic.
*Medium — one composite-mode pass over the existing draw.*

**20. Environmental hazards.** Seeded explosive barrels and player-triggered electric floor traps.
Gives a weak or out-of-ammo player something useful to do, and creates "lure them onto the trap"
setups that only work with two people. *Small–medium.*

## E. Weapons

**21. Distinct weapon roles.** Shotgun (wide cone, short range), rifle (current), sniper (pierces
a line), SMG. Different guns create *roles* — the thing that makes a team feel like a team instead
of four identical squares. *Medium.*

**22. Ammo scarcity.** Finite ammo refilled by shared crates and Max Ammo drops. Ammo is the
resource that makes generosity meaningful ("take the crate, I've still got 40"). Infinite ammo
means there is nothing to be generous *with*. *Medium.*

**23. Fix the mouse player's strafe disadvantage.** *(RETIRED 2026-09-01 — see below.)* A mouse player's movement vector *is* their aim
vector, so they cannot back away while shooting — a real asymmetry against WASD players in the
same room. Options: right-button to hold position while aiming, or add a fourth scheme with
WASD-to-move and mouse-to-aim. *Small, and arguably a bug rather than a design choice.*

> **Outcome:** shipped as the hold-position modifier, then made obsolete when couch co-op was
> removed and the single scheme became WASD-move + mouse-aim. The second option turned out to be
> the real fix: decoupling the two vectors removes the asymmetry instead of working around it.
> The modifier is gone.

## F. Multiplayer UX

**24. Ping / marker.** A key that drops a coloured world marker visible to everyone for ~4s. The
highest value-per-line item in this list for a group not on voice chat: it rides the existing
relay, needs no new authority, and is roughly 30 lines. *Small.*

**25. Downed-teammate alert.** A large arrow toward any downed player plus a distinct sound.
Without it, #1's revive window is simply missed by players looking elsewhere. *Small, but
functionally mandatory alongside #1.*

**26. Off-screen teammate indicators.** Edge markers in each player's colour. The world is a fixed
1600×900 letterbox so everyone sees everything today — this becomes necessary the moment you add
darkness (#19) or a scrolling camera. *Small; defer until needed.*

---

# Part 3 — Suggested build order

1. **Team-size scaling (#10)** — one function; fixes the most wrong thing about playing as a group.
2. **Defensible centre (#18)** — `generateLevel()` only; gives the map a point.
3. **Round spawning (#7/#8)** — the backbone everything else hangs on.
4. **Downed & revive (#1) + alert (#25)** — the change that makes it a co-op game.
5. **Kill credit & scoreboard (#5)** — nearly free, since bullets already carry `owner`.
6. **Ping (#24)** — highest value per line of code in the list.
7. **Runner + Screamer (#11/#12)** and **isolation targeting (#14)** — variety and anti-splitting.
8. Then the economy layer: scrap (#3) → wall-buys (#15) → doors (#16).

Items 1–3 are a coherent first phase and don't touch the network authority model at all. Item 4 is
the first one that extends it.

---

# Part 4 — Two bugs found while reading

**Clock skew on `flashTime` (live bug).** `broadcastWorld` sends `z.flashTime` as an absolute
`Date.now()` value; `applyWorldSnapshot` stores it raw, and `draw()` compares it against the
*client's* `Date.now()`. Those clocks are not synchronised. If the host's clock runs ahead by more
than the 50ms flash window, every zombie renders permanently white on every client; if it runs
behind, damage flashes never render at all. Send a remaining duration instead. `mg`
(`minigunTimer`) in `broadcastPlayers` has the same shape, though it is currently stored and never
read. **Relevant to Part 1**: the round timer must not repeat this.

**Difficulty ignores team size.** Framing problem #2 above — recorded here so it isn't mistaken for
a design opinion. It is the reason a full room is easier than a solo run.

---

# Part 5 — Round two: level & sound design

Written 2026-09-01 against the game **as it now stands** (4800×2700, 3×3 zones, 960×540 view,
flow-field pathfinding, five weapons, no audio). **Nothing in this part is built.**

## Two framing observations, same as last time

**1. Every zone is structurally identical.** All eight outer zones are generated the same way:
one wall-buy and one crate at a random position, behind a boundary with one door and one window
at fixed offsets. So the most interesting decision the segmentation created — *which door do we
spend our scrap on?* — currently has no information behind it. Any door is as good as any other.
Most of section G exists to fix that.

**2. The game is completely silent, and the tighter FOV made that cost more.** At 960×540 you can
no longer see the horde building at the edge of the arena the way you could at 1600×900. Sound is
the obvious channel to give that awareness back, and it is the single largest missing system in
the game. Section H is greenfield.

---

## G. Level design

**27. Give each zone an identity.** Replace "one wall-buy + one crate, placed randomly" with
seeded *themed* zones, so the door you buy is a real choice: an **Armoury** (two wall-buys, almost
no cover), a **Yard** (wide open, dense barrels — trap-and-detonate country), the **Warrens** (a
maze of nook buildings: brutes struggle, sightlines are terrible), a **Depot** (three crates, one
exit). The generator only has to pick 8 of ~12 templates per seed.
*Medium — mostly `placeZoneRewards()` and `buildOuterBuildings()` becoming per-zone.*

**28. Build the boundary corridors deliberately.** `nearZoneBoundary()` keeps scattered buildings
130px clear of every zone wall, so each boundary is flanked by two empty strips. That is the most
tactically important ground on the map — where you hold a door — and it is dead space. Place cover
there on purpose instead: a short wall spur beside each window, a pillar opposite each door. The
flow field will funnel zombies straight past it, which is exactly what makes holding a chokepoint
feel good. *Small–medium, and probably the highest-value item in this section.*

**29. Vary the windows.** All 12 zone windows are 90px, at the same 150px offset from the corner.
Every boundary therefore reads identically and there is nothing to learn about the map. Vary the
count (1–3), the width and the position per boundary, seeded. A boundary with three narrow
breaches plays nothing like one with a single wide one. *Small.*

**30. Put barrels where they pay off.** They are scattered uniformly, so most of them explode
where nobody is fighting. Deliberately seed a share of them at window approaches and door
corridors, where a shot into one actually swings a defence. *Small.*

**31. Something to hold in every zone.** The keep is the only defensible structure on the map, so
every fight resolves into "retreat to the middle". Give each outer zone one small holdable
building — two entrances and a window, the keep's shape at a third the size — so a team can push
out and hold *forward* instead of only ever falling back. *Medium.*

**32. Audit the nook trap.** Flow-field zombies funnel efficiently and relentlessly, which turned
a three-walled nook from "cover" into a place you can be cornered with no exit. Either guarantee a
second opening on nooks near high-traffic routes, or keep them and mark them clearly so it reads
as a deliberate risk rather than a generation accident. *Small — but check it before adding more
buildings.*

**33. A map-wide objective: the generator.** One seeded zone contains a generator. Buying and
starting it powers every trap on the map (no per-trap cost afterwards) and lights the Blackout
rounds. It gives one zone genuine strategic priority over the other seven, and gives the team a
goal that is not simply "survive the next round". *Medium.*

**34. Let the map change between rounds.** Geometry is fixed at generation; only barricade HP
moves. Breached windows already persist — go further. At set rounds, collapse a wall to open a
shortcut, or cave one in to close a route the team has grown comfortable with. A space that
evolves keeps a long session from settling into one solved position. *Medium.*

**35. Name the places.** Pings help, but "meet at the shotgun wall" needs the map to *have* names.
Give each zone a short name from its template (#27), show it on the minimap, and toast it when you
cross a boundary. Callouts are most of co-op communication and this costs almost nothing to
enable. *Small.*

**36. Give the sniper somewhere to be a sniper.** Its range is 1900px; the view is 960×540. Its
entire advantage happens off-screen where you cannot see the payoff. Either carve a few long
straight sightlines through the map that reward it (and make them landmarks, per #35), or cut the
range to something you can actually see. As it stands it is a weapon whose strength is invisible.
*Small either way — but it is a real balance bug wearing a level-design costume.*

---

## H. Sound design

The game has no audio whatsoever. These are ordered so the first two unblock the rest.

**37. Procedural Web Audio, not sample files.** `glucose-dash.html` already has the pattern worth
copying: a gesture-gated `AudioContext`, one `tone(f0, f1, type, dur, vol)` helper, every call
wrapped in try/catch. Three reasons it is right here specifically — it adds **zero binary assets**,
so `file://` keeps working untouched; square and triangle waves *are* the DOS PC-speaker palette
the game is drawn in; and the repo's one sampled-audio game, Gyro Space, has the open mobile
audio-freeze bug sitting at the top of `PROJECT_MEMORY.md`. **Foundation for everything below.**
*Small.*

**38. Read this before building any sound: snapshots are state, not events.** A non-host client
never receives "a zombie died" — it receives a zombie array that is one shorter. There is no event
on the wire to hang a sound on. Two workable answers: derive sounds from **state deltas** (count
dropped by N → play up to a capped number of death blips), or add explicit **one-shot event
messages** to the relay alongside the snapshot. Get this wrong and clients either play nothing at
all, or play eighty sounds at once the moment a lagged snapshot lands. *A design decision rather
than effort — but it shapes every item below.*

**39. Positional audio: distance falloff and stereo pan.** Non-negotiable on a 4800×2700 map with
a 960×540 window. Without it, every event anywhere on the map is equally loud and the mix is just
noise. Pan by x-offset from the player, attenuate with distance, hard-cut past roughly 1.5 screen
widths. *Small once #37 exists, and it is what makes everything else usable.*

**40. Per-weapon report.** Each gun already has its own screen-shake kick; give it the matching
voice. Pistol a short square blip, SMG a dry fast tick, shotgun a low noise burst, sniper a long
descending crack. Kick and report together are what actually make five weapons feel like five
weapons rather than five damage numbers. *Small.*

**41. Barricade audio as a warning system.** The most important thing in this game to *hear*: a
window being chewed is the horde entering your zone, and at the current FOV it is usually
off-screen. A rhythmic splintering tick while a barricade is under attack, pitch rising as its HP
falls, then a distinct crack on breach. Positional (#39), so it tells you *which side* is failing
without looking. This is information, not decoration. *Small–medium, and the highest-value sound
in the list.*

**42. Round pacing cues.** A rising three-note sting on round start, a descending resolve on
clear, a soft tick through the intermission countdown. The round structure is the game's spine and
it is currently silent — the beat exists in the code and nowhere in the player's ears. *Small.*

**43. Downed and revive audio.** Idea **25** asked for a sound and shipped without one, because
there was no audio system to put it in. A hard alarm when a teammate goes down, positional so you
know which way to run; a rising tone while a revive is in progress; a confirming chime on success.
Without it, the revive window is simply missed by anyone looking the other way. *Small — this is
the missing half of an already-shipped feature.*

**44. Give the archetypes voices.** A fast high chitter for runners, a slow low thud for brutes,
and an actual scream for the screamer — audible from noticeably further than anything else, which
is what would finally make it the callout target the design always intended. *Small.*

**45. Adaptive intensity drone.** Track live zombie count within a radius and pitch a low drone to
it. The tighter FOV took away the player's ability to *see* how bad it is getting; letting them
hear the pressure build is the cheapest way to give that awareness back, and it costs one
oscillator. *Small.*

> **Superseded 2026-09-18.** Built, playtested, and cut on request ("has to go"). The same job is
> now done by a score (`zombie-music.js`): an organ bed that swells with the nearby count up to a
> cap, and a soprano line that eases in when it gets bad — plus chime cues in tempo for round
> changes and the sluice. See `zombie/CLAUDE.md` → Audio.

**46. Mute and master volume, gesture-gated.** A toggle in the HUD, persisted per client via
`localStorage`. Two hard requirements: audio must not start until the first click or keypress
(mobile browsers refuse otherwise), and a friend group playing in one room needs to be able to
kill it instantly. *Small, and it ships with #37 or not at all.*

---

## Suggested first slice

1. **#37 + #38** — the audio foundation and the state-vs-events decision. Nothing else can start
   until these are settled.
2. **#39 + #41** — positional audio and barricade warnings. This pair alone changes how the game
   is played, because it restores the situational awareness the tighter FOV removed.
3. **#43** — finishes idea 25, half-shipped since the rebuild.
4. **#28** — deliberate boundary cover. The cheapest level change with the biggest effect on how
   holding a door feels.
5. **#27 + #35** — zone identities and names, which together make "which door do we buy?" a real
   decision and make callouts possible.
6. **#36** — decide the sniper question; it is a balance bug sitting in a level-design costume.

Items 1–3 are a coherent audio phase and touch no gameplay logic. Item 4 onward is level work and
can proceed independently.

---

# Part 6 — Secondary & long-term goals

Written 2026-09-02.

> **Update, same day:** **47 (extraction), 56 (roles) and 57 (two-player gates) are now BUILT**, as
> the Blood Silo chain — see `zombie/ENDGAME_PLAN.md`. Extraction turned out to want a *ritual*
> rather than a fetch quest: a gate only two people can open, three funnels to drown zombies on,
> three silos to fill, a flood, and a slow southern door. Roles shipped randomly assigned rather
> than chosen. The rest of this part is still unbuilt.

## The problem worth naming

The game now has excellent *minute-to-minute* structure — rounds, a breather, an economy, a map
that opens — but only one *run-level* goal: **survive, then die.** Every session ends the same way,
in failure, and the only thing separating a good run from a bad one is a number that nobody sees
after the fact. There is no ending to reach, no reason to start a second run tonight, and no
record of the first.

Everything below exists to give a run a **shape** — a beginning, a target, and something left over
when it's finished.

---

## A. Give a run an ending

**47. Extraction.** The single biggest gap: you cannot *win*. Repair a radio (or a truck) using
parts scattered across the outer zones, call extraction at any point from round 8, then survive one
final fixed-length assault at the pickup point before leaving. A run that ends in escape is a story
you retell; a run that ends in death is a number.
*Multiplayer*: the call is a group decision — one player commits everyone, which is exactly the
kind of argument this game should produce. Extraction leaves **the whole team** or nobody.
*Medium–large, and the one I would build first.*

**48. Campaign vs endless.** Keep what exists as ENDLESS, and make Extraction the CAMPAIGN mode.
Two runs of different lengths for two different evenings. *Small once 47 exists.*

**49. A boss round.** Round 20 (and every 10 after) spawns a stationary **Hive** in a random zone
that keeps producing zombies until destroyed, and the round will not end while it lives. A concrete
"can we actually do this" milestone rather than a slowly rising number.
*Medium.*

---

## B. Give a run a memory

**50. The run report.** An end screen built from data you already track: rounds survived, a timeline
of when each door opened and each player went down, kills by weapon, who revived whom most.
Costs almost nothing — the scoreboard, round number and event queue already hold all of it — and it
is what turns a session into something the group talks about afterwards. *Small, highest value per
line of code in this section.*

**51. Persistent requisition.** A little currency banked per run (scaled to best round reached),
kept in `localStorage`, spent on permanent unlocks: start with the rifle, a fourth card slot, a
cheaper first door, one free revive per run. Gives a reason to start a *second* run.
*Medium. Keep the unlocks small — this should tilt a run, never decide it.*

**52. The daily seed.** Everyone in the group plays the same generated map on the same day, and the
best round is posted. `MP.reseed()` already makes this trivial, and the repo has working Firestore
leaderboard code in `gyro-space` and `leaderboard.html` to copy.
*Small, and it makes a friend group competitive without touching gameplay.*

---

## C. Give a round a purpose beyond "clear it"

**53. Contracts.** Two or three optional objectives per round, drawn from a pool and paying scrap:
*clear a round without opening a door*, *20 shotgun kills*, *three revives*, *nobody goes down*,
*hold the keep for a full round*. Turns an endless grind into a sequence of small, nameable goals.
*Small — the scoreboard already counts nearly all of these.*

**54. Territory.** A zone whose barricades are all intact at round end pays passive scrap. A zone
with a breach pays nothing. Suddenly re-boarding during the breather is an *investment* rather than
a chore, and holding ground beats kiting forever. *Small–medium, and it makes idea 17 matter far
more than it currently does.*

**55. Weapon modification, as a trade.** Spend heavily at the generator to alter a weapon — but as a
**trade**, never a straight upgrade: the shotgun gains damage and loses half its magazine; the SMG
gains ammo and loses damage; the sniper gains pierce and loses fire rate. A pure upgrade is a
formality, a trade is a decision. *Medium — and deliberately not a Pack-a-Punch clone.*

---

## D. Give the players distinct jobs

**56. Roles.** Each player picks one at join: **Medic** (revives faster, revive escalation does not
apply to them), **Engineer** (traps and re-boarding cost less, barricades they repair come back
stronger), **Scout** (wider ping, sees pickups on the minimap), **Gunner** (larger ammo reserve).
Small passives only — the point is that four players are four *different* players before anyone has
bought anything. *Medium; pairs naturally with cards rather than duplicating them.*

**57. Two-player gates.** A few high-value doors need two players on two plates at once. The only
mechanic in the list that is strictly impossible alone, which makes it the strongest possible
statement that this is a co-op game. Use sparingly — one or two on the map.
*Small, but it changes what the group is for.*

---

## E. The rail line (2026-09-24)

**58. A rideable railcar, the way Transit uses its bus.** The spur is real geometry now — one
continuous line from THE KENNELS through THE YARD and down into THE MOTOR POOL, with track art
that turns the corner (`MAP_VISUAL_AUDIT.md` §1.4). It is scenery. In *Call of Duty: Zombies*,
Transit's bus is the thing that makes a scattered map feel like one place: it moves on its own
schedule, you can ride it or chase it, and being caught out when it leaves is a real cost.

Here that would be a flatcar that runs the line slowly and continuously: step on and it carries
you across three sectors without paying for the doors between them, which has to be balanced
against the "buy outward" economy — probably by it being **slow, loud, and a spawn magnet**, so
riding it costs you the fight you would rather have had in a doorway. The rail gates it passes
through are already barricades.

*Large, and it needs the map-design talk first (the CoD Zombies direction in
`MAP_VISUAL_AUDIT.md` §4.2). Noted at the user's request 2026-09-24 because the track now
exists; nothing is planned.*

---

## Where I would start

1. **50 — the run report.** Almost free, and it immediately makes finished runs worth something.
2. **47 + 48 — extraction and the mode split.** The one change that gives a run an ending.
3. **53 — contracts.** Cheap, and it fixes "every round feels the same" without new systems.
4. **54 — territory.** Makes the barricade system you already built matter far more.
5. **49 — the boss round**, then **51/52** for the between-sessions layer.

Items 1 and 3 are a weekend. Item 2 is the real project.
