# Zombie — file-by-file

Co-op survival. **The first game in this repo split into classic-script files** rather than one
monolithic HTML — the structure `GAME_PROTOTYPE_INSTRUCTIONS.md` §2 describes but no game had
adopted. Rebuilt 2026-09-01 from a 1040-line single file.

## Load order (matters)

Classic `<script>` tags, no modules — the `file://` hard constraint. **All files share one global
scope**, so every top-level name across them must be unique. Run
`node scripts/check-global-collisions.js` from the repo root after any change here; it reports
`zombie\Zombie.html (10 local scripts)`.

**Updated 2026-09-18.** The playtest pass (`PLAYTEST_PASS_PLAN.md`) added `zombie-music.js`,
`zombie-icons.js` and `zombie-floors.js`, so the checker now reports **17** local scripts.
(2026-09-07: the dev-tools pass added `../shared/devtools.js` and `zombie-dev.js`, taking it to 14.
2026-09-04: two shared files were added by the aesthetic pass, taking it to 12.) (The 2026-09-02
revision of this table fixed an earlier count of 7 that omitted `zombie-audio.js` and
`zombie-endgame.js`.) Full load order as it actually appears in `Zombie.html`:

| # | File | Owns |
|---|---|---|
| 1 | `../shared/identity.js` | `window.IDENTITY` — the one name→colour fallback. **Must precede mp-core** |
| 2 | `../shared/mp-core.js` | `window.MP` — transport, room seed, identity |
| 2a | `../shared/retro.js` | `window.RETRO` — `snap`/`flicker`, used by `zombie-render.js` |
| 2b | `../shared/leaderboard.js` | `window.LB` — score submission, used by `zombie-game.js` |
| 2c | `../shared/devtools.js` | `window.DEVTOOLS` — the L+G dev panel. **Must precede this game's files**: its error capture only sees throws after it installs, and its keydown listener has to be attached before `zombie-render.js`'s so a combo press can be stopped from also reaching the player |
| 3 | `zombie-core.js` | World size, camera, teardown plumbing, geometry + wire-time helpers, `WEAPON_KEYS` |
| 4 | `zombie-audio.js` | Procedural Web Audio, positional mix, `N` mute, event playback |
| 4a | `zombie-music.js` | **The score** (2026-09-18): organ bed, soprano, beat-quantized chime cues. Needs `audioCtx`/`audioMaster` from 4; `gameLoop` drives it |
| 5 | `zombie-level.js` | Seeded geometry, the solid spatial index, `moveWithCollisions`, funnel halls, perk stations |
| 6 | `zombie-entities.js` | Players, weapons + switching, zombie archetypes, perks, bullets, pickups |
| 7 | `zombie-endgame.js` | Roles, sluice gate, funnels, silos, pipes, the flood, the escape |
| 8 | `zombie-game.js` | Round curves, simulation, economy, revive / bleed-out / wipe / respawn, perk procs, generator trip |
| 9 | `zombie-net.js` | MP wiring, snapshots, broadcast |
| 9a | `zombie-icons.js` | Pixel-bitmap icons for every perk and gun (no emoji) → canvases + data URLs. Declares only |
| 9b | `zombie-floors.js` | Per-zone floor textures + grime noise map. Declares only; builds lazily on first draw |
| 10 | `zombie-render.js` | Draw, HUD, minimap, input, **boots the loop** |
| 11 | `zombie-dev.js` | Dev-panel registration: the state readout and the playtest buttons. **Last** — it reads names every file above declares, registers, and (since 2026-09-18) wraps `hostHandleBuy`/`spawnZombie`/`spawnZombieAt`/`nearestPrompt` for the FREE BUYS / NO ZOMBIES toggles — see "Controls" |

*(A duplicate `zombie-endgame.js` tag on line 258 was removed 2026-09-02. It threw
`SyntaxError: Identifier 'ROLES' has already been declared` on every load without breaking play.
`check-global-collisions.js` was silently deduping the src list and so could not see it; it now
flags any page listing the same `src` twice. See `PROJECT_MEMORY.md` → Technical debt.*
*Three **identical duplicate CSS rules** were also removed 2026-09-03 — `#ui .role`, `#objective`
and `#win` were each declared twice, byte for byte (51 rules → 48). Purely cosmetic: a repeated
identical rule changes nothing at render time. The two remaining `#startprompt` duplicates are
**deliberate** — they are `@media (max-width: 620px), (max-height: 560px)` overrides with
different bodies, so don't "clean" those up. A repo-wide scan found no other file affected.)*

`zombie-net.js` runs `MP.connect()` at load, and `zombie-render.js` starts the RAF loop at load.
Everything else only declares. That's why render goes last — `zombie-dev.js` sits after it because
registration is inert, not because it needs the loop running.

## Lighting, generator, cards

The map is **dim until the generator runs**. `ambientDarkness()` is the single source of truth.

> **Corrected 2026-09-04.** This table used to read 0.55 / 0.00 / +0.20, which contradicted both
> the "Lighting" section further down *and* `zombie-game.js`. Those are pre-2026-09-02 numbers —
> the generator has not returned the map to full daylight since. The live values are below and in
> one place only.

| State | ambient | constant |
|---|---|---|
| Generator off (default) | 0.72 | `AMBIENT_DARK` |
| Generator on | 0.22 — lit, never full daylight | `AMBIENT_LIT` |
| Blackout round | **+0.26 on top of whichever applies** (was +0.20 until 2026-09-18) | `AMBIENT_BLACKOUT_ADD` |

Clamped to 0.9. **Do not add a second copy of these numbers anywhere** — that is exactly how the
two tables came to disagree.

### Blackouts trip the generator (2026-09-18, on request after a playtest)

"Black-out rounds should be slightly darker than current, and should force the players to restart
the generator prior to blackout stopping." So a Blackout round that starts with the generator
running **trips** it (`tripGenerator()`, `genTripped`): the map drops to 0.9 (the cap), the perk
stations die, and **the round cannot clear while it is tripped** — once the budget is spent,
stragglers keep coming every 2.6s (capped at 6 alive). Restarting is free and physical: anyone
alive standing within `GEN_RESTART_REACH` (40px) of the generator fills `genRestart` over
`GEN_RESTART_MS` (5s); step off and it drains at half speed. Host-tracked from positions the host
already has — the gate plates' pattern — so it needs no message; `gt`/`gr` ride the snapshot.
After the restart the round reads 0.22 + 0.26 = **0.48** (it was 0.42) until it clears.

A generator that was never bought has nothing to trip: that Blackout is the old kind, just darker.

**The cap was deliberately not moved.** 0.94 is the number that playtested as a guaranteed loss;
the light radius and the four-band ramp are untouched.

Your light is a radial gradient: fully clear to `LIGHT_RADIUS` (340), fading to ambient over an
extra 33% (to ~452). A canvas radial gradient paints its last stop everywhere beyond the outer
circle, so one fill does the pocket, the falloff and the flat ambient together.

v2 blacked out at **0.94 with a hard-edged 210px hole**, which playtested as a guaranteed loss.
Blackout after the generator is now a 0.20 dip with 2.6x the fully-lit area. *(2026-09-18: a 0.26
dip, and a running generator trips first — see "Blackouts trip the generator" below.)*

**Powerup cards — "PERKS" in the UI since 2026-09-18**: 3 slots, each **stackable to x3**, bought
at stations and **inert until the generator runs** (and dead again while a Blackout has it
tripped). Every effect scales with stack. The code keeps `cards`/`CARDS`/wire `cd`; only the words
players read changed, because "perks" is what they call them.

| Perk | Does | Base |
|---|---|---|
| `OVERDRIVE` | Fire rate (requested). **On every map** | 11,000 |
| `SCAVENGER` | +60% scrap per kill | 9,000 |
| `RICOCHET` | Rounds bounce off walls (not rockets / flame) | 9,500 |
| `DECOY` | **Replaced `BEACON`.** Your ping lures zombies within 320/400/480px for 4/5/6s; recharge 12/10/8s | 10,000 |
| `SPITE` | Going down detonates | 9,000 |
| `CONDUCTOR` | Traps cheaper, armed longer | 9,000 |
| `ARC` | Kills bolt to 1/2/3 more within 180px; damage scales with `zombieHpMultiplier` | 12,000 |
| `BLASTCAP` | 18/28/38% of kills burst (95px); **bursts never chain** | 12,500 |
| `SKEWER` | +1/+2/+3 pierce (the ULTRA still stops it) | 10,500 |
| `LAST STAND` | Down: x1 fire the pistol, x2 any gun, x3 crawl ×1.6 and bleed out ×1.5 slower | 9,500 |
| `SALVAGE` | 30/45/60% of kills refund a round to the gun in hand, scaled by `WEAPONS[].salvage` | 10,000 |

`BEACON` (a ping lit every zombie on the minimap for 5s) was cut on request: never worth a slot.
DECOY keeps the ping as the perk's hook, and is host-decided: the `ping` message now carries the
pinger's `id`, the host checks that player's level in `registerDecoy()`, and live lures ride the
snapshot as `dc` so every client draws the ring. Zombies inside a lure follow a third flow field
(`navFieldDecoy`); **contact is still tested against the real player**, so a lured zombie walking
through you still downs you.

**Procs only fire from weapon kills.** `damageZombie(index, dmg, owner, now, src)` takes a source,
and `PROC_SOURCES` is `shot`/`rocket`/`flame`/`burn`. A kill by an arc, a burst, a barrel, a trap
or SPITE cannot set off ARC or BLASTCAP — otherwise one kill in a dense horde cascades through all
of it. The same `src` keeps burn and flame from flashing a zombie white every tick.

**Stations: one in each of the 8 outer zones, OVERDRIVE always among them** (`CARD_ALWAYS`),
the other 7 drawn from the remaining 10, so 3 perks are absent from any map. The playtest's
"OVERDRIVE didn't spawn" had two causes, both measured on the old code: the 4-of-6 draw left it off
**61 of 200 maps**, and `placeCardStations` skipped a station outright when `findOpenSpot` came
back empty. Stations now use `findOpenSpotSure()`, which cannot fail. The absent three are listed in
the manual and announced on the objective line the first time power comes on (`absentCardKeys()`).
Prices are **per perk**, not per station slot, so a perk costs the same on every map.

`p.cards` is a **flat array with repeats**; the stack level is just how many times a key appears
(`cardLevel()`). That keeps the wire format an array of strings and leaves `hasCard()` unchanged.
Slots cap *distinct* keys at 3 — stacking one you already hold never needs a free slot. Cards ride
in the players payload (`cd`) because the **host** resolves damage and payouts and therefore needs
the *shooter's* cards, not its own.

Each perk has a **pixel icon** (`zombie-icons.js`) drawn on its station, in the HUD and in the
manual. The station prompt no longer prints the blurb — the playtest found a sentence on a world
prompt hard to read mid-fight — so the words live in the field manual only.

**Six weapon wall-buys exist on the whole map** — rifle, shotgun, SMG, sniper, flamethrower
(5,200) and rocket launcher (7,500), each in a different zone, the sniper preferring a
long-sightline zone. *(Four until 2026-09-18.)*

### Weapons: switching, rockets, flame (2026-09-18)

- **Switching exists now.** `1`–`7` select (`WEAPON_KEYS` order), the wheel cycles, and a gun that
  runs dry hands over to the **next gun you own** rather than to the pistol. `p.owned` records what
  was bought separately from what has rounds — a crate refills every owned gun, dry ones included.
  This closes the old known gap, and it was necessary: without it, buying the 12-round rocket
  launcher threw your rifle away.
- **`WEAPON_KEYS`** (`zombie-core.js`) is the one ordered list for the wire index, the voice and
  the number key. It replaced `WEAPON_SND_KEYS`. **Append only.**
- **Rocket**: detonates on the first zombie, wall or barrel it touches, or at the end of its range —
  direct hit plus a 150px splash with falloff, and it sets off barrels. A crate only half-fills it
  (`crateFrac`). A guest's rocket goes off **locally** on the frame it visibly hits, and the host's
  `SND_EXPLODE` event carries that guest as its owner so it is not drawn twice (verified: one blast
  on the shooter, one on the host).
- **Flamethrower**: three piercing flames per 70ms shot (≈ the SMG's message rate), 280px, and
  anything touched burns (`burnUntil`/`burnBy`, damage over time credited to whoever lit it; burn
  rides the zombie row as a remaining duration).
- **Shapes**: `WEAPONS[].shape` is how a round is drawn (slug, tracer, pellet, needle, streak,
  finned rocket, cooling flame). `bsize` is the collision box — the five original guns all stay 8,
  so the shape change is not a balance change.
- **A guest's round now stops where it visibly hits** instead of sailing through the zombie to the
  wall behind (visual prediction only — damage is still the host's).

### Card economy — the balance that matters

Scrap income already scales **twice**: zombie count per round, and the rising share of high-value
brutes. An added round multiplier made it scale a third time, and round 20 alone paid 48,000
against an 87,000 cost to max every card — the entire card economy solved itself in one round.
So: no round multiplier, brute payout cut 250 -> 150, stack cost curve `1 / 2.2 / 4.0`, station
bases 9,000–13,500.

Measured cumulative income (solo, playing straight through): ~41k by round 15, ~182k by round 25,
against 64,800 to max one card and ~227,000 to max all three. First stacks land around round
12–18; maxing everything is a long-run goal. ### Pacing, measured

| | first visible | reaches you |
|---|---|---|
| Round 1, sealed in the centre | 4.6s | 11.3s (2 windows chewed) |
| Late game, whole map explored | — | 12.8s |

Early rounds are unchanged in pace but now *telegraphed* — you watch them mass beyond the boundary
and chew in. The 45s cooldown is what keeps late rounds at pace. With a permanent "visited" flag
instead, a fully explored map left off-map as the only source and contact time doubled to 25.6s
exactly when rounds should be hardest — which also made opening the map *easier*, backwards.

**Re-measure this if you touch zombie `scrap` values,
`budgetForRound`, or the brute share.**

## Audio

`zombie-audio.js`. Procedural Web Audio, zero sample files — see the header for why (file://,
the DOS palette, and Gyro Space's open mobile audio-freeze bug). Gesture-gated: `initAudio()` runs
on every input, nothing before. **`N` mutes** (it was `M` until 2026-09-18, when `M` became the map
toggle); the preference persists in `localStorage`.

~~The **intensity drone** (idea 45) tracks the live zombie count within 1000px and pitches a low
oscillator to it — silent below 4 zombies, full at 28.~~ **Removed 2026-09-18 on request** ("has to
go"). Its job — telling you how bad it is getting when the tight FOV can't show you — moved to the
score.

### The score (`zombie-music.js`, 2026-09-18)

Asked for in the playtest: an eerie low organ that opens on chimes, intensifies with the nearby
count up to a limit, a harmonizing soprano that eases in under pressure, and chime cues **in
tempo** for round changes and the sluice unlock (its own building tune).

- **One tempo grid**, 66 BPM. Everything — every cue included — is scheduled on it, a 0.4s
  lookahead ahead of the audio clock, **from `gameLoop`** (`musicUpdate`). No timer of its own; the
  only long-lived node is the tremolo LFO, which `musicStop()` ends and `zDestroy()` calls.
- **Organ bed**: 8 bars of D minor (i, VI, iv, V, i, the Neapolitan ♭II, vii°, V7), drawbar
  PeriodicWaves with a celeste-detuned second pipe. **Intensity** = zombies within 1000px of you,
  `(near − 2) / 28`, **capped at 30**, eased (rise 1.2s, fall 5s): it opens the drawbars and the
  filter, adds a pedal pulse from 0.25 and an eighth-note ostinato from 0.55.
- **Soprano**: a formant-filtered "ah", two held notes a bar, always chord tones — eases in from
  **12** nearby zombies, fully in at **26**.
- **Cues**, quantized to the next beat and, for most, restarting the progression so they always
  land on D minor: `start` (opening chimes, then the organ swells in), `round`, `clear`, `trip`
  (an unresolved tritone), `power` (D major — the one bright chord), `unlock`, `win`, `over`.
- **The sluice build layer**: while the plates are held, chimes climb the current chord, denser
  and louder as `gateProgress` fills and denser again on the second lock. `unlock` resolves it.
- **Cues are driven by STATE** (round number/phase, `gateStage`, `genTripped`, `generatorOn`), not
  the event queue: events are capped at ten a snapshot and are the first thing dropped. So the old
  `SND_ROUND_START`/`SND_ROUND_CLEAR` stings are no longer emitted at round changes;
  `SND_ROUND_CLEAR` is still the silo-full and flood-cleared sound.

Verified headless against a recording mock `AudioContext`: the opening tolls, the organ, no
soprano on an empty map, the soprano in (and on chord tones only) with 32 zombies near, the
intensity cap, the ostinato, the round cue, the build layer (0 → 36 bells over 3s at 90% progress),
the unlock flourish, the game-over cue, and the score and its LFO stopping afterwards.

Sounds now cover: **per-weapon fire** (idea 40 — pistol blip, rifle crack, shotgun burst, dry SMG
tick, long sniper crack), kills, splitter bursts, the **screamer** (idea 44, carrying 2.2x further
than anything else, which is what makes it the callout target), barricade chewing and breaches,
downs and revives, pickups, doors, crates, traps and zaps, **round start/clear stings** (idea 42),
and game over.

**One-shot sounds are events, not state.** A client never receives "a zombie died", only a shorter
array — so the host drains an `eventQueue` into each snapshot as `ev`, capped at 10 per send so a
lagged packet can't dump eighty sounds at once. Per-entity ids are used *only* for sustained
sounds that must start and stop (barricade chewing), which key off stable array indices.
Everything is positional: pan by x-offset, squared distance falloff, hard cut past ~1500px.

Three rules for adding a sound:
- **Your own actions play locally and immediately** (`playEvent`) — a gun must never wait on a
  round trip. Broadcast the copy with `queueEvent`, which carries the actor id so that client
  skips its own echo. Without that the shooter hears every shot twice.
- **Gunfire and kills are throttled** (90ms / 70ms) or they fill the 10-slot queue every snapshot
  and crowd out breaches and downs.
- `hostEvent` = host-resolved, plays locally *and* broadcasts. `localEvent` = this client only.

## The three rules that break things quietly

1. **Never put an absolute `Date.now()` in a payload.** Clients' clocks are not synchronised.
   Everything time-shaped crosses the wire as a *remaining duration* via `msLeft()` and is rebased
   on arrival with `deadlineFrom()`. v1 shipped this bug: `flashTime` went over as a host
   timestamp, so a host running fast made every zombie render permanently white on every client.
2. **Level generation uses `MP.random()`, never `Math.random()`.** Every client builds the world
   independently from one server-issued seed. A stray `Math.random()` in `zombie-level.js` means
   two players collide with walls the other cannot see. `Math.random()` is correct for
   host-only rolls (zombie spawn placement, weapon spread) and per-client cosmetics.
3. **Nav resolution must exceed the smallest opening.** A gap is only *guaranteed* to contain a
   nav cell at `2*NAV_CELL + 2*NAV_PAD` px — cell size, plus the padding on each side, plus up to
   a whole cell lost to grid alignment. At `NAV_CELL = 40` that threshold was 106px, which silently
   made nook holes, outpost doorways and narrow windows **invisible to the pathfinder**: walkable
   in fact, sealed as far as the flow field was concerned. **Check this before shrinking any
   opening.**

   *Corrected 2026-09-07.* This used to give the formula as `2*NAV_CELL + 16` and the current
   threshold as 56. The `16` was half a **walker**, but the pad has been sized for a **brute**
   since the 106px note two paragraphs down in `zombie-level.js` — the two halves of the same
   invariant disagreed about which zombie they were protecting. With `NAV_CELL = 20` and
   `NAV_PAD = 15` the real threshold is **70px**. The narrowest opening in the map is the outpost
   doorway at 112, windows are 112–151, doors 124–159, so everything clears it.

   *Updated 2026-09-18.* The ULTRA HEAVY is 34px, so **`NAV_PAD = 19`** (half of it plus the same
   2px of skin) and the threshold is **78px**. The nook escape hole (`NOOK_HOLE`) was 74 — under the
   new guarantee — and is now **90**. Every other opening already cleared 78; funnel halls are 240.
4. **Opening a door refreshes only its own patch of the nav grid.** A full rebuild is 32,400
   cells and cost ~17ms — a dropped frame at the exact instant of a purchase, which is the worst
   possible moment for a stutter. `rebuildSolidIndex` diffs the door signature and calls
   `refreshNavRegion()` on just the doors that changed (1.3ms, and bit-identical to a full
   rebuild). A full rebuild is still used when the level itself is regenerated.
5. **The nav grid must be invalidated whenever geometry changes.** `generateLevel()` calls
   `markNavDirty()` explicitly, and it has to: `rebuildSolidIndex()` only re-checks the *door*
   pattern, and a freshly generated level has the same all-closed pattern as the old one — so
   without the explicit call the grid silently survives from the previous layout and zombies path
   against walls that no longer exist. Barricades deliberately do NOT dirty it (they're passable
   in the field either way), which is what keeps a window breaking from costing a ~14ms hitch.

## Authority

Host-authoritative world, client-owned players. The host alone runs zombie AI, resolves damage,
owns the round clock and the scrap pool, and decides who goes down. Clients own their own
movement and predict their own shots (the host filters those copies back out of the snapshot).

**The WebSocket server is a separate repo and cannot be changed**, so every mechanic here rides
mp-core's generic `relay`. Message kinds in use: `players`, `world`, `shoot`, `down`, `up`,
`dead`, `rvs`, `pickup`, `buy`, `bought`, `ping`, `reset`, `won`, and **`over`** (2026-09-18 —
the host calling the room wiped).

**Wire additions, 2026-09-18** (all appended, all durations never timestamps): zombie rows carry a
5th element, burn ms left, only while burning; bullet rows carry the gun index (`WEAPON_KEYS`) and,
for flame, distance travelled; `world` gains `gt`/`gr` (generator tripped / restart progress), `sb`
(the scoreboard — **guests never received it before**, so the round-end table only ever showed on
the host) and `dc` (live DECOY lures); `shoot` gains `wk` (the gun); `ping` gains `id`.
`Z_TYPE_KEYS` gained `ultra` **on the end** — both index lists are append-only wire values.

**Wire changes, 2026-09-19:** `players` rows **lost `rv`** (a guest's copy of its own revive
progress — echoing it back is what made the revive bar pulse; progress now travels only in `rvs`,
host → room) and **gained `sk`** (the socket id the row currently rides, so a server `leave`, which
names sockets, can be matched to a player). A player's `id` is now `<tab token>:p`, not
`<socket id>:p`.

### Connection trouble (2026-09-19)

Asked for after a playtest: *"a lack of penalty for wifi issues, but also welcoming to other friends
joining in mid game."* What a drop used to cost, read from `server.js` and `mp-core.js`: every
reconnect is a **new socket id**, and the player id, the role, the scoreboard row and the host's
bleed clock were all keyed on it; a dropped client flipped to **solo host** and ran its own fork of
the world, where it could die and then reset the room with "restart"; and a merely stalled socket
left the host mauling the player's last known position while their screen froze. Now:

- **Identity is a per-tab token** (`netToken`, `sessionStorage` key `zombie_tab_token`), not the
  socket id. Survives drops and page refreshes. `netPrefix` is still the socket id — routing and
  host checks only. A duplicated tab copies sessionStorage, so the `players` handler watches for its
  own token on another socket: **only the higher socket id re-rolls, and only once the clash has
  lasted 1s** — both re-rolling cost the original tab its class, and a single stray packet from our
  own dead socket (relayed just after a reconnect) must not cost a reconnecting player theirs.
- **Away, not gone.** A teammate silent for `AWAY_AFTER_MS` (1.2s), or `leave`d by the server, is
  `r.away` for up to `AWAY_GRACE_MS` (60s): drawn at 35% with a blinking RECONNECTING, grey on the
  minimap and the offscreen arrows, **out of `allTargets()`/`livingTargets()`/`teamSize()`/
  `anyoneAlive()`/the gate plates**, and a downed one's bleed-out clock pauses (`rec.pausedAt`,
  added back on return). The wipe grace is `WIPE_GRACE_AWAY_MS` (10s) instead of 2s while a
  teammate who was *standing* when they dropped is away. Back inside 60s → same record, same
  scoreboard row, RECONNECTED toast.
- **A client that loses a shared room HOLDS instead of forking** (`netLost`): `update()` returns
  early, input is released, and the CONNECTION LOST overlay counts up; after `NET_LOST_OFFER_MS`
  (15s) it offers ENTER → `goSoloAfterLoss()`, which gives the held time back to a downed player's
  bleed-out. mp-core keeps retrying every 3s regardless; a reconnect clears the hold, and the
  host's snapshot (`ls`) folds us back in. **Alone in the room, a drop is still plain solo** —
  there is nobody to disagree with.
- **A local game over while the room plays on** (went solo, died out there) → the next `go=0`
  snapshot runs `rejoinRunningRoom()`: back as a teammate who bled out, respawning at the breather,
  rather than sitting on a card whose "restart" would reset the room. Guarded on `pendingReset`, so
  a real restart is not mistaken for it.
- **Late joiners** (a guest spawning with `round >= 1`) arrive **beside a standing teammate**
  (`standingTeammate()`/`spotBeside()`) with 4s of protection instead of at the keep, and past
  round 4 with a rifle in hand. Everyone sees JOINED / LOST CONNECTION / RECONNECTED toasts.
- **CONNECTION UNSTABLE** (top right) on a guest that has had no snapshot for 1.5s.

**The revive-bar pulse** was the same family: the `players` handler *rebuilt* each remote record
from the guest's payload, including `rv`, the guest's copy of its own revive progress, always a
round trip old — so 15 times a second the host's live value was knocked back to a stale one.
Measured through the local relay: 34 / 69 / 65 reversals at 0 / 60 / 150ms and a 3s revive taking
5.4s or never finishing; after, 0 / 1 / 1 (the one is the bar completing) and 3.0–3.1s. The record is
now updated **in place**, progress has **one source** (`rvs`, now every 100ms), a reviver already
reviving keeps it out to `REVIVE_KEEP` (+18px) so a range edge can't flicker it, and the drawn bar
eases (`p.reviveShown`: rises gently, drops at once).

**Not fixable from here:** a host whose socket stalls *without closing* freezes the world for the
room (everyone sees CONNECTION UNSTABLE) until the server notices it is gone and re-elects. Host
election belongs to the server, which cannot change. A host that drops cleanly is promoted away
from in the ordinary way, and the new host inherits the round from the last snapshot.

### Death, respawn and the team wipe (2026-09-18)

Reported: *both players went down in a two-player game; one of them simply respawned at the start
instead of the run ending.* Reproduced headless on the old code with two clients through a local
relay: at 25s the host bled out, the guest stayed downed **forever**, nothing ended, and a keypress
walked the host straight back in at the keep. Three faults:

1. **A guest never bled out.** The bleed-out check ran only for the *host's own* player
   (`netIsHost && p.bleedDeadline`); nothing tracked a guest's deadline. Now the host keeps
   `remoteDowned[id] = {at, bleedAt}` for every downed guest (set in `downPlayer`, cleared on a
   revive or a RALLY, re-created with a fresh clock for a downed guest a promoted host never saw
   go down) and `updateRemoteBleed()` sends `dead` when it runs out. A guest's own "players"
   message can land a frame after the down with its pre-down state; the record's first 1.5s stops
   that reading as a second down (and a double alarm).
2. **`spawnPlayer()` had no notion of a run in progress**, so any key respawned a dead player. It
   now refuses while `zAwaitRespawn` is set.
3. **"Everyone down" was not an ending** — only "everyone dead", which 1 made unreachable.

The rules now: **nobody standing in the room → a 2s grace (a downed player crawling onto a RALLY
can still save it) → game over**, decided by the host (`updateTeamWipe`) and sent explicitly as
`over` — the snapshot's `go` flag alone can miss its only send, because `update()` stops
broadcasting the moment `gameOver` is set. A player who **bleeds out while a teammate stands** is
dead until the breather that ends that round (DESIGN_IDEAS #1's "dead for the round"), watching a
teammate by their light, then respawns at the keep with a pistol and **keeps their perks**
(`respawnLocalPlayer` path in `updateRespawn`). Solo, going down is now game over — which retires
the old known gap "a solo player going down is a 25s crawl that ends in death regardless".

**Spending must stay host-validated** (`hostHandleBuy`). Scrap is a shared pool; two clients
pressing buy on the same frame would both pass a local affordability check and spend it twice.

### The host owns the GEOMETRY SEED too (2026-09-07)

Added after the reported "the map regenerates entirely, mid-game, ten rounds in — every door shut
again and a new layout".

`onPeerSync` used to end with an unguarded `if (MP.seed() !== levelSeed) generateLevel();`. **That
hook is not a one-shot.** mp-core fires it from *every* `players` message the server sends — join,
leave, and the rejoin handshake — and the line immediately before it in `mp-core.handle()` is
`if (typeof data.seed === "number") setSeed(data.seed)`. So any time the server came back with a
different seed, `generateLevel()` ran and cleared `walls`, `doors`, `barricades`, `wallBuys`,
`ammoCrates`, `barrels`, `traps`, `zoneHotUntil` and the entire endgame chain, mid-fight.

The server hands back a different seed when the room was garbage-collected while everyone was
briefly disconnected and then recreated on rejoin. mp-core reconnects on a 3s timer after every
`onclose`, so a sleeping free-tier instance — or a sleeping laptop, which is what local testing
hits — produces this routinely rather than rarely.

The hook's original purpose is still real: a client that missed mp-core's 6s connect timeout got a
throwaway clock seed and genuinely does need to rebuild once the room seed lands. It simply cannot
be told apart from "the seed moved ten rounds in" *by looking at the seed*. Two changes fix it:

1. **`onPeerSync` only regenerates while `gameStarted === false`.** Once the game is running the
   level is in play. A seed change then re-pins MP's stream to the geometry on screen
   (`MP.reseed(levelSeed)`) and leaves the world alone.
2. **The host publishes `ls: levelSeed` on the world snapshot**, and a client whose level does not
   match adopts the host's and rebuilds *once*. One integer on a packet that already ships 15×/s,
   riding the generic `relay` — nothing is asked of the server, which is just as well. It is
   applied at the **top** of `applyWorldSnapshot` so the door/barricade/crate rows in the same
   packet land on the corrected geometry, and it converges in a single step because
   `generateLevel()` sets `levelSeed = MP.seed()`.

That makes the host authoritative over the geometry the same way it already is over the doors and
barricades indexed against it, and hands a mid-game joiner the host's map rather than the server's
newest seed.

`generateLevel()` is therefore called from exactly four places, and only two of them are reachable
once a run is under way: page load, `resetGame()`, `onReady`, and the snapshot's `ls` heal.

## Zones have identity

Nine 1600×900 zones, each with a seeded template and a name you can call out (`zoneName(i)`):
`COLD STORAGE`, `THE DRY POOL`, `SPILLWAY`, `THE KENNELS`, `DEAD LETTER`, `SLAG HEAP`,
`TICKET HALL`, `THE ANNEX`, `PUMP HOUSE`, `MOTOR POOL`, `THE LAUNDRY`, plus `TURBINE HALL`
(always exactly one — it holds the generator) and `THE BLOCKHOUSE` at the centre.

Templates differ in building density, barrel and crate counts, whether they have a holdable
outpost, and whether they have long sightline corridors. That is what makes "which door do we
buy?" a real decision rather than a coin flip.

**Each zone has its own floor (2026-09-18, `zombie-floors.js`)** — the playtest found the areas'
identity too faint. A 64×64-texel tile per template, drawn 2 world units a texel with smoothing
off: freezer tiles with frost (COLD STORAGE), cracked pool tiles (THE DRY POOL), oil-stained
concrete with a bay line (MOTOR POOL), worn lino checker (THE LAUNDRY), wet concrete with water and
a grate (SPILLWAY), dirt and straw (THE KENNELS), floorboards and stray post (DEAD LETTER),
ember-flecked slag (SLAG HEAP), terrazzo (TICKET HALL), carpet tiles (THE ANNEX), diamond plate
(PUMP HOUSE), grating (TURBINE HALL), concrete block (THE BLOCKHOUSE), and wet stone "drain" slabs
for the sluice room and funnel halls. Tileable value noise only ever *picks* between each tile's few
flat colours — no gradients — and one large **grime noise map** (three flat alpha steps, 1024px
repeat) over everything breaks the 128px repeat. Generated from fixed seeds: never `MP.random()`
(it would shift the level stream) and never `Math.random()` (players must be able to say "the blue
tiles"). The minimap tints each zone to match (`ZONE_FLOOR_TINT`). If the textures cannot be built,
`drawGround()`'s old grid is the fallback.

**Generation order changed (2026-09-18) and fixed a real layout bug.** The sluice used to be built
*after* every zone's contents, and corridors, outposts and the generator never checked
`reservedRects` at all. Measured on the old code: **239 of 300 seeds had zone walls inside the
funnel room, and 68 had a gate plate walled off** — maps on which the two-player gate, and so the
whole endgame, could not be finished. Now `buildSluice()` runs before `buildZoneContents()`,
corridors / outposts / the generator avoid reserved ground (re-roll, then drop), the generator
never lands in the sluice zone, and every floor item (crate, barrel, wall-buy, station, generator)
claims its footprint in `keepClearRects` so none lands on another — on the old code stations,
wall-buys and the generator could spawn **inside walls** or on top of each other. A 500-seed sweep
of the new code is clean on all of it (`PLAYTEST_PASS_PLAN.md` → Verify).

**Boundary cover spurs must be clipped 150px clear of a boundary intersection.** Unclipped, a spur
from one wall and a spur from the perpendicular wall formed an L that boxed in a corner pocket
nothing could path into — a free safe spot, and a trap for any zombie that wandered in.

## Map — 3×3 segmented zones

4800×2700 — 9× the old arena — split into nine 1600×900 zones, with a panning camera showing a
**960×540** window (tightened from 1600×900 on 2026-09-01; 2.78× less world on screen).

You start sealed in the centre zone and buy outward. **Every zone boundary carries both a door
and a boarded window**, and that pairing is the whole design:

| | Players | Zombies |
|---|---|---|
| Closed door | blocked (buy to open) | blocked |
| Boarded window | blocked, always | break through it |
| Breached window | **still blocked** | free passage |

That asymmetry is why segmentation is safe: there is no zone the horde cannot follow you into, so
"start small" can never become "hide in a box". It is enforced by **two separate collision
grids** — `solidGridPlayer` counts every barricade, `solidGridZombie` only intact ones. Bullets
use the zombie set, so a window you've lost stops being cover.

Other consequences worth knowing:

- **Zombies path on a BFS flow field**, not a beeline (`navFieldFrom` / `navStepToward`). Naive
  chase does not survive segmentation — see the pathfinding section below.
- **Zombies never spawn in ground the team is in or beside.** Spawn sites are limited to zones
  that are COLD -- nobody has been in or next to them for `ZONE_COOLDOWN_MS` (45s) -- nearest
  first, placed as close to the shared boundary as they can get. Never-entered zones are cold from
  the start. If nothing is cold they come in from off the edge of the map instead. Nothing is ever
  placed inside anyone's view.

  **Two checks divide the work and both are needed.** The zone cooldown covers "ground the team is
  in or beside"; `visibleToAnyone()` rejects individual points currently on screen. So a zone you
  can see a sliver of stays usable, minus the sliver. Marking whole zones from the player's *view
  box* instead does not work: that box is 1824x1026 against 1600x900 zones, so from the middle of
  the map it marks all nine and nothing is ever spawnable again.

  The ring-around-the-player placement this replaced put zombies in the player's *own* zone,
  directly behind them. Because the camera is player-centred, walking back the way you came
  revealed that ground and the zombie read as having materialised in a space you were looking at
  moments ago.

  `zoneHotUntil[]` is host-owned and broadcast as nine **remaining durations** (`vz`, never
  timestamps), so a promoted host doesn't immediately spawn in ground someone is standing in.
- Solids live in a uniform grid (`rebuildSolidIndex`). **Call it whenever a door opens or a
  barricade breaks or reboards**, or collision goes stale.
- Draw is culled to the view rect. The minimap and off-screen teammate arrows are not optional
  decoration — without them you cannot find anyone. *(2026-09-18: the minimap now starts hidden, on
  request, behind `M`. The off-screen teammate arrows are unchanged and always on, so teammates stay
  findable.)*

## Pathfinding — why it's a flow field

Segmenting the map broke naive chase AI completely, and it broke it in ways that each looked like
a different bug. Recorded because every one of these is easy to reintroduce:

1. **Beelining** walks a zombie into a boundary wall a few hundred px from the nearest window,
   where it stays forever. Wall-following heuristics got most of the horde through and reliably
   stranded the rest — "the round never ends" is worse than a slow round.
2. **Cell-centre passability sampling was the big one.** Testing a 16px box at each nav cell's
   centre makes a 20px wall *invisible*, because it falls in the gap between two adjacent cell
   centres. The field then flowed straight through solid geometry and confidently steered zombies
   into walls. `rebuildNavGrid` now tests the **whole cell**, padded by half a zombie.
3. **Off-field recovery needs line-of-sight.** A zombie pressed flat against a wall sits in a cell
   the BFS never reached; the recovery search then picked the lowest-distance cell nearby — which
   could be on the *far side of a closed door*, 20px away. `navClearLine` prevents that.

4. **Diagonal corner-cutting caused oscillation that no stuck-detector could see.** `navStepToward`
   would pick a diagonal neighbour that was open while the wall corner between them was not. The
   zombie walked at a target it could not reach, slid off, re-entered the cell it came from, and
   repeated forever — *moving every frame*, so the stuck counter never accumulated and none of the
   unstick paths ever ran. This was the real cause of "zombies that never arrive", and it survived
   three earlier rounds of heuristic fixes. A diagonal is now only considered when **both**
   orthogonal neighbours are passable.
5. **Steering compared a centre-space goal against a corner-space position** (found 2026-09-07,
   the cause of the reported "brutes, screamers and splitters wedge on corners at broken
   barriers"). `navStepToward` is handed a centre and returns a nav-cell **centre**, but
   `updateZombies` subtracted `z.x` — the **top-left corner** — so every zombie steered with a
   constant bias of half its own body toward +x/+y. It aimed its corner where its centre should
   go, and the body rode off the path it had been handed.

   The bias scales exactly with size: brute 13px, splitter 12, screamer 10, against walker 8,
   runner 6, spawnling 4.5 — which is why only the big three showed it. For a goal 100px dead
   right a brute steered 6.6° downward while already sitting 13px off the sampled line, eating
   ~25px of the 43px of clearance a 112px window gives it. The straight-line fallback needed the
   same fix: `target` is a player, whose `x` is also a corner.

   **Both sides of that subtraction are now centres.** This is the single highest-value fix of
   the four — see the measurements below.

Barricades are passable in the field (they're the way in); the chewing happens on arrival, and
**chew is checked before steering** so a zombie at a window attacks it instead of sliding past.
A zombie that stops making progress is re-placed by `relocateZombie` — not cosmetic, because a
round only clears when the map is empty and one pinned brute stalls the game forever. It uses
`pickSpawnPoint(z.size)`, so the destination obeys the same visibility and sealed-sluice rules a
fresh spawn does; if no legal spot is found in 8 tries the zombie is **despawned**, which is
strictly better than leaving it wedged.

> **`relocateZombie` never actually ran before 2026-09-07.** It read `SPAWN_RING_MIN` and
> `SPAWN_RING_MAX`, *neither of which existed anywhere in the repo* — so every call threw a
> `ReferenceError` straight out of `updateZombies`, taking the rest of `update()` with it:
> `updateRevives`, `updateTraps`, `interpolateRemotes`, `pruneRemotePlayers`, `broadcastPlayers`
> and **`broadcastWorld`**. `gameLoop` re-arms its rAF first (deliberately), so the host kept
> drawing and looked perfectly healthy while every other client in the room froze solid. And
> because the throw landed before `z.stuck = 0`, it repeated every frame forever. **One wedged
> brute silently ended the session for everyone.** `scripts/check-undefined-globals.js` now exists
> to catch exactly this, and is in the pre-commit hook.

**Two triggers reach it, and they catch different failures:**

- `z.stuck > 240` — ~4s of a zombie that genuinely cannot move at all.
- `z.noProgress >= PROGRESS_FAILS_TO_RELOCATE` (4 windows of 800ms, ~3.2s) — a zombie that
  *moves every frame and travels nowhere*. This needed its own counter: the per-frame check sets
  `z.stuck = 0` on any frame with movement, so the old watchdog's `z.stuck = Math.max(z.stuck, 6)`
  ping-ponged 0 ↔ 6 and **could never climb to 240**. The escape hatch was unreachable for
  precisely the failure it was written to catch.

**Chewing and being ON TARGET are both exempt** from the progress watchdog, for the same reason:
a zombie standing on a barricade or mauling a player is making no progress *by design*. Without
the on-target exemption a packed swarm reads as a crowd of stuck zombies and the watchdog
teleports them off the player one at a time — measured at 438 spurious relocations in 38 simulated
seconds before the exemption, **0** after.

**Zombies cannot leave the map.** There is no perimeter wall (`buildZoneWalls` only emits the
interior boundaries) and zombies move with `clampToWorld = false` so they can spawn off the edge
and walk in — but nothing stopped them walking back *out*, and a zombie past the edge is off
camera, unshootable, and holds the round open forever. `z.entered` is a **one-way leash**: free
movement until the body is fully inside once, clamped for the rest of its life.

### Measured (2026-09-07)

Headless traversal, 24 seeded layouts × 24 runs per type, every door open and **every barricade
already broken** — the exact reported failure condition:

| | walker (16) | runner (12) | screamer (20) | splitter (24) | brute (26) |
|---|---|---|---|---|---|
| before | 99.8% | 100% | 99.1% | 97.0% | **95.1%** |
| after | 100% | 100% | 100% | 100% | **99.8%** |

The failure rate tracked body size exactly, which is what identified the centre-space bug as the
cause. In the live game, 160 zombies weighted to the big three (growing to 320 as screamers
summoned) crossed a ~2000px average with 0 relocations, 0 despawns, 0 escapes off-map and no
errors; brutes and splitters 100%.

### Measured again (2026-09-18) — the ULTRA HEAVY, and NAV_PAD 19

Same method, re-implemented as a Node harness that runs the real scripts headless (the method was
recorded, the harness was not): 24 layouts × 24 runs per type, doors open, barricades broken, one
zombie vs a stationary player ≥ 1000px away, 120s cap. "Before" is the pre-pass code:

| | walker | runner | screamer | splitter | brute | ultra (34) |
|---|---|---|---|---|---|---|
| before, reached | 100% | 100% | 100% | 100% | 100% | — |
| after, reached | 100% | 100% | 100% | 100% | 100% | **100%** |
| after, without the escape hatch | 100% | 100% | 100% | 100% | 100% | 99.7% (2 relocations / 576) |

0 despawns and 0 timeouts in either run. (A 60s cap timed out 12 screamers on the old code; they
are simply the slowest type — at 120s every one arrives.)

## Controls — ONE player per screen

WASD moves, the mouse aims, left click fires. `F` uses/buys, `Q` or middle-click pings.
**`L`+`G` together opens the dev panel** (2026-09-07, `zombie-dev.js` + `shared/devtools.js`) —
neither key is bound to anything else here.

*2026-09-18:* **`1`–`7` / the wheel switch guns**, **`M` shows/hides the minimap together with the
TIME ALIVE / ZOMBIES / KILLS lines**, and **`N` mutes** (it was `M`). Number keys never spawn you —
they are not join keys. **The minimap starts hidden** (asked for mid-playtest) on every page load;
the choice then holds across restarts in the session. It was briefly remembered in
`localStorage`, which would have kept it on for anyone who had ever pressed `M`, so it deliberately
is not persisted any more.

**`ESC` opens the MISSION dialog** (`#help`, `openHelp()`), which is where the start prompt's
instructions went — the start prompt is now just "join" and "ESC — how to play & goals". It shows
the map's **goals as a checklist ticked from live state** (`mapGoals()`: generator, sluice, silos
1–3, flood, south gate — ticked cyan, the current one amber, the rest dimmed; checkboxes are CSS,
no glyphs), plus controls and rules. A goal is done *by state*, not by order: a Blackout un-ticks
the generator and puts "restart" back on top while the sluice stays ticked. Everything it reads
rides the world snapshot, so a guest ticks the same boxes as the host. Like the field manual it
takes the keyboard and mouse while open and **does not pause**. With the dev panel up, the panel eats
`ESC` itself. While the minimap is up, the **NEXT goal** (the first unticked one, with its zone and
live progress) is drawn on its top edge (`drawNextGoal`).

The gun and its rounds moved from the top-left stack to a **loadout HUD, bottom left**: the gun's
pixel icon, its name, a 48px round count (magenta when low), and a strip of every gun you own with
its number key; your perks sit beside it as icons with an `xN` stack badge. The HUD rewrites only
what changed — the old perk chips were rebuilt with `innerHTML` 60 times a second.

Dev panel additions: `TRIP GENERATOR`, `SPAWN ULTRA`, `GIVE ALL GUNS`, `NEXT PERK` (cycles all
11, adding a stack), `CLEAR PERKS`; the readout shows owned guns, perks, which perks the map sells
and which it does not, and ULTRAs alive/owed.

Then, asked for mid-playtest: **`FREE BUYS`** (every purchase costs nothing; prompts get a
`[DEV: FREE]` tag), **`NO ZOMBIES`** (clears the field; nothing spawns, so a round just holds) and
**`SPAWN TARGETS`** (8 stationary dummies in an arc where you aim — it goes around the NO ZOMBIES
block, so there is still something to shoot). Both toggles are host-gated. **They wrap, rather than
hook:** `zombie-dev.js` reassigns `hostHandleBuy`, `spawnZombie`, `spawnZombieAt` and
`nearestPrompt` at load (free buys lend `hostHandleBuy` an unreachable `scrapPool` and put the real
one back), so the gameplay files carry no dev flag and deleting the dev file's script tag still
removes all of it. That only works because every caller reaches those functions through the global
binding — if one is ever captured into a local, the toggle silently stops covering that path.

### The dev panel does NOT pause this game

Deliberate, and the same call the field manual already makes for itself ("The round does not pause
while you read this"). The host simulates for the whole room; pausing it locally would freeze
everybody else. `onOpen` only releases the local player's held keys, so nobody walks into a wall
behind the overlay.

**Round state, `zombies` and `scrapPool` are host-authoritative, so those buttons are host-gated**
and say so — a guest writing to them locally gets one frame of a lie before the next broadcast
overwrites it. `OPEN SLUICE` is the one worth knowing about: the two-plate gate is the only
mechanic in the game that is *strictly impossible alone*, so without that button a solo playtester
can never see anything past it.

Every weapon has a **screen-shake kick** (`WEAPONS[].shake`, in *screen pixels*): pistol 1.8, SMG
1.3, rifle 2.6, shotgun 8, sniper 10. `applyCameraTransform` divides by `camera.scale`, so the
felt amplitude is identical at any zoom or window size — measuring shake in world units would
have silently scaled every kick when the FOV tightened. Cap 17, decay 0.84: punch, not wobble.

**Couch co-op was removed 2026-09-01** after playtesting: three schemes on one keyboard
(mouse-follow / WASD / arrows) was too much for a standard player to control. `players` is still
an *array* of 0 or 1 — every consumer iterates it, and collapsing it to a bare object would have
meant touching all of them for nothing. Networked multiplayer is untouched; only local
splitscreen is gone.

Two things fell out of that removal:

- **Idea 23 is retired, not implemented.** The right-click hold-position modifier existed only
  because the old mouse-follow scheme made your movement vector and your aim vector the same
  thing. WASD-move + mouse-aim decouples them, so strafing is native and the workaround has
  nothing left to fix.
- **The camera no longer zooms.** Zoom-to-fit existed to frame multiple couch players; it now
  just pans a fixed 1600×900 window.

## Deliberate deviations from `DESIGN_IDEAS.md`

- **Doors gate rewards, not passage.** They seal the four compounds (which hold the better
  wall-buys and crates). The open map is always traversable, so a group can never lock itself out
  of anywhere it needs to go.
- **The pistol is infinite.** Ammo scarcity only means something if you can be generous with it,
  but a team that runs completely dry has no way back into the game.
- **Darkness is Blackout-round only** (every 7th), not permanent — a user call.
- **Pickups are `OVERCLOCK` / `ADRENALINE` / `RALLY`**, deliberately not the 1:1 CoD set — a user
  call. Ammo resupply is a map feature (crates) instead, which is what keeps it from being Max
  Ammo renamed.

## Reading the map at a glance

Doors and barricades were being mistaken for each other, so they now share **no** visual language:

| | Door | Boarded window |
|---|---|---|
| Colour | cool blue | warm timber brown |
| Shape | flat slab, hard frame, a post at each end | individual planks with nail heads |
| Shut | price plate + keyhole | plank count falls as it is chewed |
| Open | dark threshold, blue posts remain, chevrons through it | flashing red frame, broken stubs, **BREACH** |
| Who passes | players and zombies, once bought | zombies only, ever |

Keep that split if you touch either. The whole point is that a *bought door* and a *broken window*
are both holes in a wall, and the player must be able to tell them apart instantly.

## Lighting

`ambientDarkness()` is the single number. Generator off **0.72**, generator on **0.22** — the
lights never restore full daylight — and a Blackout round adds **+0.26** (+0.20 until 2026-09-18)
on top of whichever applies, after tripping a running generator. The player's light radius
therefore matters at all times, not only on Blackout rounds. A player waiting out a bleed-out sees
by the light of the teammate the camera is following.

### The ramp is quantized into four bands (2026-09-04)

`AESTHETIC_GUIDE.md` §6.3: the era had no smooth gradients. `drawLighting()` was one radial
gradient and is now four flat steps — lit / near / far / ambient — computed from **the identical
inputs**:

| Band | Radius | Alpha |
|---|---|---|
| lit | ≤ `LIGHT_RADIUS` | 0 |
| near | → midpoint | `dark × 1/3` |
| far | → `LIGHT_RADIUS × LIGHT_FADE` | `dark × 2/3` |
| ambient | beyond | `dark` |

**No balance number moved** *(in that pass — the Blackout dip went +0.20 → +0.26 on request on
2026-09-18; everything else here still holds)*. 0.72 / 0.22 / +0.20, `LIGHT_RADIUS` 340,
`LIGHT_FADE` 1.33 and the downed player's ×0.55 are all untouched — §5 lists this game's lighting as untouchable because
v2's 0.94 blackout playtested as a guaranteed loss, and quantizing the *ramp* is explicitly the
change that does not re-open that. Measured after the change: 255 / 194 / 133 / 71 on a white
field at `dark = 0.72`, with the steps landing at 342 / 399 / 453 px.

**The trap, if you ever rewrite this:** the obvious implementation is a flat ambient fill plus
`globalCompositeOperation = "destination-out"` to punch the light back out. That is wrong, and it
looks right until you check. `destination-out` removes alpha from **everything already on the
canvas**, not just from the darkness layer — so it erases the world inside the light pocket and
leaves a transparent hole precisely where the player is supposed to see. It was written that way
first and caught by sampling the canvas. The shipped version draws **disjoint annuli** with the
`evenodd` fill rule: source-over only, nothing is removed, and non-overlapping regions cannot
compound into the wrong alphas either.

**Blackout rounds now drop colour instead of adding darkness.** One
`globalCompositeOperation = "saturation"` fill over the canvas, gated on the same
`isBlackoutRound(round) && roundPhase === "active"` condition `ambientDarkness()` uses, so the
two can never disagree. Scarier than more black, and it avoids re-litigating a balance decision
that already failed once. The DOM HUD keeps its colour — the readout is a device, the world is
what has lost its colour.

## Aesthetic pass and the leaderboard (2026-09-04)

`AESTHETIC_GUIDE.md` §6.3 — **RASTER** cabinet, anchor *Berzerk* (1980). Session 1 of
`COLUMN_COMPLETION_ROADMAP.md` Phase 1; the plan is `zombie/AESTHETIC_PASS_PLAN.md`.

Zombie now loads two of the shared Phase-0 files, so the page is **12 scripts, not 10**:

| # | File | Added |
|---|---|---|
| 3 | `../shared/retro.js` | `RETRO` — `snap` and `flicker` in `zombie-render.js` |
| 4 | `../shared/leaderboard.js` | `LB` — `LB.submit` in `zombie-game.js` |

Plus `<link rel="stylesheet" href="../shared/retro.css">` and
`<body data-game="zombie" data-cabinet="raster">`, which is what selects this game's world hue
(`#FF4A1C` ember) and permits the scanline overlay — the scanline CSS is gated on
`data-cabinet` so it cannot be applied to a Vector game by reaching for a class name.

**Rendering changes, all in `zombie-render.js`:**

- Lighting quantized to four bands, and blackout rounds drop colour — see the Lighting section.
- **Zombies are blocky, ≤3 colours**: body, a flat shadow band (a constant `rgba`, not a computed
  shade — this runs for every zombie on screen every frame), white for the existing hit flash.
- **Positions are snapped with `RETRO.snap(v, 4)` at the DRAW CALL ONLY.** `z.x`/`z.y` are never
  written. Same discipline as Glucose Dash keeping its curve inside `SX()`: quantizing the
  simulation would produce collision bugs that present as gameplay bugs.
- ~~**Flicker budget (§4.7)**: past `ZOMBIE_DRAW_CAP` (40) zombies *on screen*, the overflow renders
  on alternating frames. Measured with a synthetic 100-zombie horde: 40 drawn every frame, the
  other 60 split 30/30 across two frames — 70 draws per frame instead of 100. Counted against
  zombies actually **on screen**, not the array index, or the budget would depend on where the
  camera is pointing. **Screamers are exempt** — the white outline is how you find the callout
  target in a crowd, and one that renders every other frame is a gameplay regression wearing an
  aesthetic hat.~~ **Removed 2026-09-18.** The playtest found it distracting and hard to read —
  exactly when the screen is fullest, which is when you most need to read it. Every zombie on
  screen is now drawn every frame; it is two `fillRect`s each and was never the frame budget. The
  screamer exemption above was already the tell that the budget cost readability.
- **Muzzle flash**: one white frame, derived from the existing `p.lastShotTime` rather than any
  new state, so there is nothing extra to reset, sync or tear down.
- `zFrameCount` drove the flicker budget and now only animates flame and burn pixels. It is **not
  a timer** — it ticks once per rendered frame in `gameLoop`, so it needs no
  `trackTimeout`/`trackInterval` registration.
- *2026-09-18:* the generator no longer prints U+26A1 (an emoji on most systems — a colour picture
  on a four-colour screen); it and every perk and gun are pixel bitmaps in `zombie-icons.js`, drawn
  with smoothing off (`ctx.imageSmoothingEnabled = false` is set every frame, since a canvas resize
  resets it). The ULTRA HEAVY is the one zombie that is not a square: an octagon with bone shoulder
  plates, three colours plus the hit flash, over the same square collision box.

**The HUD moved onto the shared tokens, mapped by meaning** rather than taste, which is the whole
point of the Signal Three being semantic: structure is `--phos-mid`, live numbers `--phos-hot`,
scrap `--sig-amber` (value/interact), weapon `--sig-cyan` (system), role and cards
`--world-hue`. The two end cards used to be green and red; **WIN is now cyan** (goal reached) and
**GAME OVER magenta** (death), which is the same vocabulary every other game will use.

**Leaderboard.** `LB.configure({ game: "zombie" })` at the end of `Zombie.html`;
`submitRunToLeaderboard()` in `zombie-game.js` fires from **both** `triggerGameOver()` and
`triggerWin()`.

- **The score is the round reached.** `scoreBoard[id].score` exists but is per-player kill credit
  inside one run and is host-owned; the number a survival game's board wants is how far you got,
  which is also the number the game already puts on the game-over card.
- `zLbSubmitted` guards it. `triggerGameOver()` is reachable **both** locally (everyone died) and
  from the host's `go` flag in `zombie-net.js`, so without the guard a client posts its run
  twice. `resetGame()` clears it so a replay can post again. Verified: one post per run, a
  second `triggerGameOver()` posts nothing, and a reset-then-replay posts once more.
- Name and room come from `MP.selfName`/`MP.room`, the same source as every other identity value
  here. **Under `file://` `LB` is a silent no-op**, so a double-clicked game is unaffected.

## The field manual

A terminal in the keep (`codexRect`), opened with F. Five tabs: weapons, perks (was "cards"),
pickups, enemies, the map. **Every table is generated from the live data** — `WEAPONS`, `CARDS`,
`ZOMBIE_TYPES`, `wallBuys`, `cardStations` — never hand-written, so it cannot drift from the balance
numbers. It also reads the actual zone names, so it tells you where *this* map's sniper is.

*2026-09-18:* weapons and perks carry their pixel icons; each perk shows its per-stack numbers
(`CARDS[].detail`) because the station prompt no longer does; the perks tab ends with **NOT ON THIS
MAP** (the three perks this map does not sell); the map tab covers the generator trip, the funnel
halls and every key. A **CLASSES** tab (asked for mid-playtest) prints every role's exact traits
from `ROLES[].detail` and lights your own row — "classes" in the UI, `roles` in the code, the same
split as perks/cards.

While it is open it swallows keyboard and mouse, or reading it would walk you into a wall and empty
your magazine. The round does **not** pause — it can't, the host owns the simulation.

## The Blood Silo endgame — how a run is won

`zombie-endgame.js`. Until this, a run could only end in failure.

    sluice gate (two players, two locks)
      -> funnel room, kill zombies ON the funnel to fill silo 1
      -> throw silo 1's switch to open funnel 2  ->  silo 2  ->  funnel 3
      -> third silo full: THE FLOOD, off every map edge at once
      -> clear it: the southern escape grinds open over 90s
      -> reach it: WON

Things to keep in mind if you touch it:

- **Each silo stands beside its funnel, piped to it (2026-09-18).** Funnel 1 and silo 1 share the
  sluice room (the funnel moved left of centre to make room; silo 1 is against the east wall).
  Funnels 2 and 3 are in **funnel halls** — two long walls, open at both ends (240px, three times
  the nav guarantee), a drain floor, the funnel near one end and its silo against a wall near the
  other — built *first* in their zones (`planFunnelHalls` → `buildFunnelHall`), so everything else
  routes around them. Never the centre zone, never the sluice's, corridor zones last. The pipe
  (`siloPipes`, visual only) runs rim to tank and carries animated blood while its funnel is live.
  This **supersedes** the old "the three silos sit elsewhere again, so filling one is a journey
  rather than a button next to you": the playtest found the funnel–silo link unreadable and asked
  for them side by side. The journey is now funnel to funnel. Silos are still floor, not wall,
  like every other station. `finishFunnelsAndSilos()` has two fallbacks (another zone, then a bare
  funnel with its silo alongside) so a map can never lack one; across 500 seeds neither ran.
- **The sluice is at fixed world coordinates, not seeded.** It is the one landmark every run
  shares, so "meet at the sluice" has to mean the same place every time. **It is built before the
  zone contents** (2026-09-18) — see "Zones have identity" for the bug that fixed.
- **The gate needs two players** — two plates 436px apart, and two consecutive holds (the second
  is 1.6x longer). Releasing a plate drains progress, but slower than it fills.
- **Only kills inside an active funnel's radius fill its silo.** Every other system in the game
  rewards killing zombies wherever they are; this is the one that asks you to fight in a chosen
  place, which is what makes the funnel room a set piece.
- **THE FLOOD deliberately bypasses the zone-cooldown spawn rules** and comes off all four map
  edges. It is the one moment where zombies appearing everywhere at once is the intent. Normal
  round spawning pauses while it runs, or the two systems fight over the budget.
- **Nothing may spawn inside the sealed sluice.** It is a closed box until the gate opens, so
  anything placed in there is stuck for the whole run. `inSealedSluice()` enforces it; do not
  remove that check on the assumption it can't happen — it currently doesn't only because the
  sluice sits at the far south of its zone and spawn placement favours points near the player.
- `escapeAt` crosses the wire as a **remaining duration**, like every other timer here.

## Roles

Randomly assigned, but **derived from the client's own id hash — never dealt by the host**. No wire
traffic, survives a reconnect, and consistent with how colour and identity already work.

> **Corrected 2026-09-19.** "Survives a reconnect" was not true until then: the id hashed was the
> *socket* id, which the server re-rolls on every connection, so a wifi drop re-dealt your class
> mid-run. It now hashes the per-tab token (`netToken`, see "Connection trouble" below), which
> survives drops and page refreshes.

`roleForId()` deliberately does **not** use `hashToUnit()`: that keeps only the low bits of a djb2
hash (`% 10000`), and djb2 low bits cluster hard for similar strings. Across 400 ids it dealt
engineer 270 times, scout 40 and **medic zero**. It now runs a proper avalanche finalizer before
the modulo, which measures 187–210 of 800 for each of the four.

| Role | Passive |
|---|---|
| `MEDIC` | Revives 40% faster and ignores the per-round revive escalation |
| `ENGINEER` | Traps 40% cheaper (stacks with CONDUCTOR); windows come back at 150%. **The second half never fired before 2026-09-18**: it lived only on the manual "board" purchase, which needs a damaged window during a breather — and `endRound()` repairs every window to full the moment the breather starts, so the purchase never came up. It now applies to that breather re-board whenever an ENGINEER is in the game (`engineerInGame()`), and a window above 100% draws a light reinforcing frame instead of planks past its ends. The trap prompt also showed the price *without* the ENGINEER cut it charged; now it matches |
| `SCOUT` | Double ping reach, pickups on the minimap, +10% speed |
| `GUNNER` | +15% damage, applied at the muzzle (`shoot()` and the `shoot` message) — so a ricochet keeps it (same round) but barrel and perk damage do **not**, which this table used to claim they did; +25% crate ammo, which its in-game blurb promised from the start and nothing applied until 2026-09-18 (`refillAmmo`) |

## Known gaps

- ~~**A solo player cannot be revived.** Downed needs another *alive* player in the room, which is
  now necessarily a networked teammate. Playing alone, going down is a 25-second crawl that ends
  in death regardless — strictly worse than just dying. Worth either shortening the bleed-out
  when no reviver could possibly exist, or giving solo players a self-revive. Not done; it's a
  design call, not a bug.~~ **Settled 2026-09-18** by the team-wipe rule: nobody standing → a 2s
  grace → game over. Solo, going down now ends the run in 2s instead of 25.
- ~~**No audio at all**, so the downed-teammate alert is visual only.~~ **Wrong since v3
  (2026-09-04 correction).** `zombie-audio.js` has existed since v3 — this same file lists it at
  position 4 in the load order and documents it at length two sections above. Downs and revives
  both have sounds. The entry survived because "Known gaps" was never re-read when audio landed.
- **Nav pad is sized for the largest zombie plus skin** (`NAV_PAD = 19` since 2026-09-18 — the
  ULTRA HEAVY is 34px; it was 15 for the 26px brute, and 13 until 2026-09-07, which gave a brute
  *exactly zero* clearance in a cell the field called passable — any float error at a corner
  clipped). Every opening a zombie must use is wider than `2*NAV_CELL + 2*NAV_PAD` = **78px**. If
  you add a narrower opening, or a bigger zombie, large enemies will quietly stop using it.
- **A solo player cannot finish a run.** The sluice gate needs two people on two plates, so the
  whole Blood Silo chain — and the only win state — is unreachable alone. That is the deliberate
  point of idea 57, but it means solo play is still endless-survival-until-death.
- ~~**No manual weapon switching.** A wall-buy equips what you bought; you can't cycle back to a
  weapon you already own.~~ **Resolved 2026-09-18** — `1`–`7`, the wheel, and a dry gun handing
  over to the next one you own.
- **The score has only been verified against a recording mock.** Every cue, layer and threshold is
  checked headless (what is scheduled, at what pitch, when), but nobody has listened to it in a
  session yet. The balance numbers most worth tuning by ear: `MUS_LEVEL`, the soprano's 12/26
  thresholds, and the chime volume.
- **Only the ULTRA HEAVY's single-zombie traversal is measured**, not a crowd of them — at most
  four can be alive (`ultraCap`), and relocation remains the backstop.
- `window.GameInstance` is deliberately **not** implemented — see
  `GAME_PROTOTYPE_INSTRUCTIONS.md` §2. The `trackTimeout` / `AbortController` plumbing in
  `zombie-core.js` exists anyway, per the root `CLAUDE.md` hard constraint.

<!-- doc-sync: 99690d40 | 2026-09-19 -->
