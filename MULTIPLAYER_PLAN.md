# Multiplayer Rollout Plan — RDArena, Zombie, boids, Glass City Escape

Written 2026-08-24 before any code changes. Covers the server-architecture decision and the
per-game sync model for the four games named.

**Status refreshed 2026-09-02.** The architecture in §1–§3 is built, shipped and unchanged —
that part of this document is still authoritative. What had drifted is the *per-game* material:
Zombie has been through v2/v3/v4 since this was written and no longer resembles the game
described in §4a, and RDArena had a full single-player overhaul on 2026-09-02 that changes the
shape of the §4d problem. Sections that describe a game as it was in August now carry a dated
note. **When a §4 game description and `PROJECT_MEMORY.md` disagree, PROJECT_MEMORY is newer.**

Two games not in the original four have since appeared and are tracked in §5:
**Space Tracer** (retro-fitted, done) and **Glucose Dash** (partial — seed/identity only).

---

## 1. The architecture question: one server or one per game?

**Recommendation: keep ONE shared server. Do not split per game.**

Reasons, in order of how much they actually matter here:

1. **Render free-tier cold starts.** A free Render web service spins down when idle and takes
   tens of seconds to wake. One server shared across all games gets woken by whoever plays
   first and stays warm for everyone. Five services = five independent cold starts, and a
   friend clicking "Zombie" waits out a spin-up that playing Gyro Space five minutes ago did
   nothing to prevent. This is the single biggest practical argument.
2. **The hub already depends on it.** `index.html` connects to this same server for the room
   roster, votes, and live cursors. Per-game servers would mean the hub holds N connections,
   or loses cross-game presence entirely — and cross-game presence ("who's here, what should
   we play") is the whole point of the hub.
3. **One deploy, one URL, one log.** Five services is five things to redeploy and five places
   to look when something breaks, for a ~3-10 person friend group.

**What does need to change:** the current server is Gyro-Space-shaped, not generic. Its
`update` handler hardcodes `x/y/angle/shot/isAlive`, and `kill-credit` assumes bullets and
shooters. Adding four games' worth of message types to it would turn it into a junk drawer.

**So: one server, but restructured around a generic core.**

| Change | Why |
|---|---|
| Room key becomes `game + ":" + roomCode` | Room "ASDF" in Zombie and "ASDF" in boids must be different rooms. Without this, joining the same code from two different games puts you in one broken shared room. |
| New generic `relay` message type | Server forwards `{type:"relay", payload:<anything>}` to the rest of the room, tagged with sender id. **New games then need zero server changes** — all game-specific protocol lives in the game file. This is what stops the junk drawer. |
| Server assigns a **host** (first player in room) | Gives every game a designated authority for simulating shared world state, without needing a real authoritative server. Reassigned automatically if the host leaves. |
| Server generates a **room seed** | Sent to everyone on join. This is what makes all clients generate the *same world*. See §2 — it's the thing that's actually missing today. |
| Server computes **color from name** | Resolves the long-standing debt where `CLAUDE.md` claims identity is server-side but it's actually duplicated client-side. Server is now authoritative; clients use what they're given. |

**Backwards compatibility is mandatory** — the deployed hub and Gyro Space talk to this server
right now. Any client that sends no `game` field lands in a legacy namespace and the existing
`update` / `score-update` / `kill-credit` handlers keep working untouched. Nothing that works
today breaks.

**Note on the repo name:** `gyro-space-server` becomes a misnomer once it serves five games.
Don't rename the Render *service* — that changes the URL (`wss://my-games-faxi.onrender.com`)
which is hardcoded in the deployed hub and Gyro Space. Rename the repo/readme only, if at all.

---

## 2. The real blocker: no game generates a deterministic world

**Every one of these games builds its world with unseeded `Math.random()`**, including
`space-tracer.html`. In Gyro Space this is invisible, because it only ever syncs *ships* —
`seedAsteroidField()` is a misnomer, it takes no seed, and **every player in a Gyro Space room
is flying through a different asteroid field right now.** That works there because asteroids
are scenery.

It does not work for any of these four, where the world *is* the game:
- Zombie: `generateLevel()` places buildings randomly — players would collide with walls
  teammates can't see.
- Glass City: the entire city, collectibles, and escape tunnel are random.
- RDArena: the reaction-diffusion field defines every wall.
- boids: spawn positions and level layout.

**Fix (shared, one implementation for all games):** a seeded PRNG in a shared client file.
Server sends `seed` on join; each game swaps its world-gen `Math.random()` calls for
`MP.random()`. Same seed in, identical world out, on every client.

This is the highest-leverage piece of work here and it's needed by all four games regardless of
which sync model each one ends up with.

### The seed is not immutable, and regenerating on a change destroys a run (added 2026-09-07)

Written as if the seed arrives once and stays. **It does not.** `mp-core.handle()` applies
`setSeed(data.seed)` on *every* `players` message the server sends — join, leave, and the rejoin
handshake — and then fires `onPeerSync`. The server issues a *different* seed when the room was
garbage-collected during a disconnect and recreated on rejoin, which the 3s reconnect timer makes
routine rather than rare on a sleeping free-tier instance.

So "same seed in, identical world out" holds only if a game **latches the seed** rather than
re-reading it. Checked across the repo 2026-09-07:

| Game | Pattern | Safe? |
|---|---|---|
| Glass City | `if (baseSeed === null) baseSeed = MP.seed();` | ✅ latched once |
| boids | `if (baseSeed === null) baseSeed = MP.seed();` | ✅ latched once |
| Zombie | `if (MP.seed() !== levelSeed) generateLevel();` in `onPeerSync` | ❌ **was the bug** |

Zombie rebuilt its entire level — doors, barricades, crates, barrels, traps, endgame chain — the
moment a rejoin brought back a new seed, ten rounds into a run. Fixed by gating regeneration on
`gameStarted` and making the **host** authoritative over the geometry seed (`ls` on the world
snapshot). See `zombie/CLAUDE.md` § "The host owns the GEOMETRY SEED too".

**The rule for any new game:** latch the seed at first use, or make the host publish the one it
actually built from. Never rebuild a live world because `MP.seed()` moved.

---

## 3. Shared client core — `shared/mp-core.js` (+ `shared/identity.js`)

> **Updated 2026-09-03: there are now TWO shared client files.** `shared/identity.js` holds the
> single client-side name→colour implementation (`IDENTITY.colorFromName`) and **must load before
> `mp-core.js`**, which falls back to it when there is no server. It exists because `file://` play
> has no server to ask, so a client copy is mandatory; `scripts/check-identity-parity.js` proves
> it matches the server. Before this, four different copies existed and one of them agreed with
> the server 0 times out of 10. See `PROJECT_MEMORY.md` → "Colour/identity is centralized".

One new file, loaded by every multiplayer game via a classic `<script src="../shared/mp-core.js">`
tag (works over `file://`; only `type="module"` doesn't — hard constraint respected).

Exposes a **single global**, `window.MP`, to keep the global-collision surface to one name
(`scripts/check-global-collisions.js` will verify this).

```
MP.connect({game, room, name, onReady, onPeerJoin, onPeerLeave, onMessage})
MP.send(payload)        // relay to everyone else in the room
MP.random()             // seeded PRNG — deterministic across clients
MP.reseed(seed)
MP.isHost()             // true for exactly one client per room
MP.peers()              // ARRAY of peer objects, not a keyed map
MP.identity()           // {name, room} the hub wrote -- URL params, then localStorage
MP.selfId / MP.selfColor / MP.selfName
```

Identity (name/room) is read from URL params then localStorage, matching what the hub already
writes — so a player who set their name on the hub is recognized in every game without
re-entering it.

---

## 4. Per-game sync models

Ordered easiest → hardest. This ordering is also the recommended build order.

### 4a. Zombie — co-op survival — **EASIEST, do first** — ✅ DONE, then rebuilt three more times

> **Superseded 2026-09-02.** Everything below is the August analysis, kept for the reasoning.
> It describes a game that no longer exists. Since then Zombie went through **v2** (2026-09-01
> co-op rebuild, 9× map, split into classic scripts), **v3** (light/sound/cards/zone identity),
> **v3.1–v3.4** (audio, stacking cards, spawn-placement rewrite, big-enemy pathfinding) and
> **v4** (the Blood Silo endgame — the game can now be *won*). The current networked surface is
> far larger than this section describes: generator state, card purchases, a host event queue
> for one-shot audio, zone-visited cooldowns as nine remaining durations, and the whole
> endgame chain (`gateStage`, `funnelActive[3]`, `siloFill[3]`, `floodActive`, `escapeAt`, `won`),
> and since 2026-09-19 the intensify flag (`iz`/`hc` — deliberately snapshot **state** rather than
> an event, because the event queue is capped at ten a snapshot and is the first thing dropped,
> and "the horde has been called" must not be droppable).
>
> **The 2026-09-19 map revamp changed nothing on the wire, on purpose.** Zombie's nine sectors are
> painted into a 12×9 grid now instead of being a 3×3 of rectangles, and the perimeter, landmarks
> and per-sector floors are all new — but the map is still built by every client from one server
> seed, `vz` is still nine remaining durations, and `ls` still heals a client whose geometry does
> not match the host's. Worth noting because "we redesigned the map" is the kind of change that
> usually does touch a protocol, and here the seed contract is exactly what stopped it: the
> skeleton is now FIXED (identical on every client without being sent) and only the interior is
> seeded.
> **For the current design read `zombie/CLAUDE.md`, then `zombie/REBUILD_PLAN.md`,
> `zombie/V3_PLAN.md` and `zombie/ENDGAME_PLAN.md` in that order.**
>
> Two specific things in the text below are now false:
> - **Local/couch co-op was removed 2026-09-01** after playtesting. There is no
>   `assignedControls{mouse,wasd,arrows}` any more — one player per screen, WASD moves and the
>   mouse aims. `players` stays an array of 0-or-1 so iterating consumers were left alone.
> - **The viewport blocker was fixed in v2.** The world is a fixed `4800×2700` with a panning
>   per-client camera and a nominal `960×540` view, so every client shares one world geometry.

Already a 3-player local co-op game: `players[]`, `assignedControls{mouse,wasd,arrows}`,
per-player `keys`. The player model needed for network play already exists — the conversion is
"N remote players each owning one entry" instead of "3 control schemes on one keyboard."

- **Players:** each client owns its own player, broadcasts position/facing/shooting at ~10Hz.
- **Zombies/powerups:** host-authoritative. Host simulates, broadcasts state ~10Hz.
  Rough cost: ~100 zombies × ~12 bytes ≈ 1.2 KB/tick ≈ 12 KB/s. Fine for this group size.
- **Walls:** generated from the room seed — no sync needed after join.
- **⚠ Blocker specific to this game** *(fixed in v2, 2026-09-01)***:** the playfield is currently
  the *browser viewport* (`width`/`height`), so every player has a differently-sized world. Must
  become a fixed world size with a per-client camera. This is a real change, not a tweak.

### 4b. Glass City Escape — parkour / collectathon

> **Superseded 2026-08-25 (fork resolved) and 2026-09-05 (Hunt pass).** The design fork below was
> decided in favour of **race** — see §240 and the "Verified for Glass City" section, which are
> current. Two other bullets never described the shipped game and are corrected here rather than
> deleted, because the reasoning behind them is still the reasoning behind what shipped:
>
> - **Collectibles are not claim-by-relay.** There is no claim protocol and no host arbitration,
>   because parallel worlds removed the contention the protocol existed to resolve: each racer
>   collects their *own* cores from the same seeded layout and opens their *own* tunnel. Nothing
>   about a core crosses the wire.
> - **Position goes at ~15Hz, not ~10Hz** (`NET_SEND_MS = 66`), interpolated between updates.
>
> The **2026-09-05 Hunt pass** changed the single-player shape substantially — a 58 × 58 city
> (10 % of the old area) on a 3-4 cell alley lattice, a dash that crosses roofs, and Surveyors
> that hold a laser sight and pursue through stairwells — **but changed nothing on the wire.**
> The sync model in the table below is untouched: still positions plus one "I finished" event,
> still nothing shared beyond the seed. See `glass-city-escape/GCE_HUNT_PASS_PLAN.md`.

- **World:** fully seeded, generated identically on join. No ongoing sync.
- **Players:** own avatar, broadcast position ~10Hz. Lightest of the four.
- **Collectibles:** claim-by-relay (first claim wins, host arbitrates ties).
- **⚠ Design fork — needs a decision:** co-op (shared collectible pool, escape together) vs.
  race (everyone runs the same seeded city, first to the tunnel wins). Race is simpler (no
  shared-state contention at all) and probably more fun with friends; co-op matches the
  existing single-player goal structure. **Not yet chosen.**

### 4c. boids — swarm attractor

> **Shelved 2026-09-04.** `boids` moved to `under-development/boids/boids_1.html` in the scope
> pullback and no longer has a hub card. Nothing below is *wrong* — the competitive fork shipped
> and works — it is simply not reachable by players right now. Kept in full because boids is the
> single most nearly-ready game on the shelf (it is the only shelved game with working server
> integration), so this is the section anyone promoting it back will need. Its two `shared/`
> script paths were re-pointed to `../../` on the way down.
- **⚠ Design fork — needs a decision:**
  - **Competitive (recommended):** each player owns their own flock and syncs only their own
    boids. Natural "grow the biggest swarm" competition, light sync, no shared authority
    needed, degrades gracefully if someone lags.
  - **Co-op:** one shared swarm, host-simulated, broadcast ~10Hz. At level 10 that's
    ~135 boids ≈ 1 KB/tick ≈ 10 KB/s — feasible, but every player's attractor fights over the
    same flock, which may just feel muddy.
- Recommend competitive. **Not yet chosen.**

### 4d. RDArena — reaction-diffusion arena — **HARDEST, do last** — ✅ **BUILT 2026-09-08**

> **Superseded 2026-09-08 (merged to `main` 2026-09-19).** This section is kept for the method
> it records, but its status line is history: RD Arena's multiplayer is built and on the board.
> `MP_ROLLOUT.md` steps 1–4 all landed, the three toggles exist as F9/F10/F11, and the build
> record is `rd-arena/MP_BUILD_NOTES.md`. See §6 item 6 for what shipped and the three
> deliberate departures from Zombie's protocol.
>
> **One claim below is simply wrong and was wrong when written:** this working copy is a real
> git clone, not a ZIP download, so `git init` is not a prerequisite and the usual revert does
> exist. `GIT_WORKFLOW.md` corrects the same error at length — check with
> `git rev-parse --show-toplevel`, never with a doc.

> **Method written 2026-09-03 — see `rd-arena/MP_ROLLOUT.md`.** Still not started, but the *how* is
> now specified: a mutation choke point shipped as a verified no-op first, netcode split into its
> own `rd-net.js` (the `zombie` pattern), and three **independently togglable** runtime flags
> (`hostSim` / `resync` / `carveEvents`) so gameplay feel can be A/B'd inside one session and the
> guilty part identified rather than the whole feature abandoned. That doc also records the
> resync-pop mitigations and the trap that matters most here: enemy and player wall collision is a
> **point test on the entity centre**, so a resync that turns a cell solid under someone strands
> them. Note also that this working copy is a ZIP download, **not a git clone** — `git init`
> before starting, or the usual revert does not exist.

> **Re-scoped 2026-09-02.** The RD analysis below is still correct and still the right approach —
> and the grid is deliberately still **400×400**, so the 20 KB bitmask maths holds exactly. What
> changed is that **RDArena is no longer just an RD field**. The v2 "Fleshscape" overhaul
> (`rd-arena/RD_ARENA_V2_PLAN.md`) took it from 708 to ~1560 lines and added a great deal of
> state that has nothing to do with reaction-diffusion and would also need syncing:
>
> - **Two enemy types** (grunt with a shared flow field, heavy with a carve-through bee-line),
>   plus a getting-unstuck ladder and ring spawning — host-authoritative, like Zombie's horde.
> - **Wave-based rounds** with a per-round budget, mirroring `zombie`.
> - **Player HP, three organs, the BIOhack loop and per-factor cards** — per-player progression.
> - **Four sanctuaries plus a central base**, with static walls and spray-turret mote systems.
> - **Gun terminals** (4 upgrades × 3 stacks) in the base.
>
> Two things already went in with multiplayer in mind and should be preserved:
> - **The card screen deliberately does not pause the game** — the chooser sits in a protective
>   bubble while the world keeps simulating, precisely so one player choosing cannot stop
>   everyone else. That decision was made *for* this section.
> - **Edge smoothing is render-only.** Solid cells draw as overlapping discs, but collision, LOS
>   and the flow field still read `gridB` exactly — so the bitmask this section depends on is
>   unaffected.
>
> Net effect: the hard part is no longer *only* the field. Budget for a Zombie-shaped
> host-authoritative entity sync **on top of** the bitmask resync below. Still its own session.

The arena is a **400 × 400 = 160,000-cell** continuous float simulation, stepped every frame.
This cannot be state-synced naively at any frame rate.

Options considered:
- *Full state sync* — 160k floats/frame. Impossible.
- *Deterministic lockstep* — RD is float-heavy; cross-browser float divergence is not
  guaranteed to stay bounded, and divergence means players collide with walls others don't see.
  Too risky to rely on alone.
- **Host authority + periodic coarse resync (recommended).** Host simulates the RD field.
  Clients run their own copy locally for smooth visuals, corrected by an authoritative
  *solidity bitmask* (400×400 bits = 20 KB) broadcast every ~2-3 s, plus immediate events for
  discrete perturbations (`clearRadius`, `spawnWallExplosion`). ≈ 8 KB/s. Feasible.
- If that proves too heavy in practice, fall back to a coarser collision grid (200×200 = 5 KB)
  with the fine RD field kept purely visual.

**This one deserves its own session.** It is not a "wire up the same pattern" job like the
other three.

---

## 5. Build order & status

1. ✅ **DONE** — `mp-core.js` + server rewrite (generic relay, namespaced rooms, host election,
   room seed, server-side colour). 28/28 integration tests passing.
2. ✅ **DONE** — **Zombie**. Validated end-to-end in two live browser clients.
3. ✅ **DONE** — **Glass City Escape**, as a RACE (decision made 2026-08-25).
4. ✅ **DONE** — **boids**, as COMPETITIVE parallel worlds (decision made 2026-08-25).
   *(Shelved to `under-development/` 2026-09-04 — the work stands, the game is just off the
   board. See §4c.)*
5. ✅ **DONE 2026-08-28** — **Space Tracer**, retro-fitted onto the same core. It predated
   `mp-core.js` and kept its own socket, its own message types, its own name/room screen and its
   own (session-ID-based, therefore wrong) colour scheme. Now indistinguishable from the others:
   `space-tracer:CODE`, generic `relay`, hub identity, server colour.
6. ✅ **DONE 2026-09-08** — **RDArena**, host authority + periodic field resync. The last of the
   board games. Verified with two live clients: 149 cells corrected of 17,689 on a packet,
   carve relay and client damage reports both round-tripping, `?net=0` still today's game.
   Build record: `rd-arena/MP_BUILD_NOTES.md`. Three departures from the Zombie protocol are
   recorded there — no down/up/dead (each client owns its own HP), organs and cards never sent,
   and a multi-source flow field so grunts path to the *nearest* player rather than to the host.

   *Original entry, kept for the sequencing it records:*
   ⬜ RDArena — its own session, full host-authority + periodic bitmask resync approach.
   Method specified 2026-09-03 in `rd-arena/MP_ROLLOUT.md` (not yet implemented).
   **Now also needs entity/round/progression sync — see the re-scope note in §4d.**

   > **Update 2026-09-07 — the field format is now decided, and it is not a bitmask.**
   > `rd-arena-bench/rd-curves.html` was built to test whether a coarser field can still look
   > like this game. It can, and the winning configuration is **133² at 2 bits, every 1.0 s,
   > field-space lerped between packets** — 4,423 bytes, 30.2 KB/s host-up at 8 players,
   > **4.52× cheaper than the 400² 1-bit mask** this plan and `MP_ROLLOUT.md` §2 step 4 budget,
   > while arriving twice as often. The 2 bits are the point: 1 bit leaves nothing to
   > interpolate, so there is no between-packet motion to hide the update rate behind.
   >
   > This shipped into the game **as rendering only** (`rd-arena/rd-netfield.js`,
   > `rd-arena/NET_FIELD_NOTES.md`) so the coarseness could be judged single-player first.
   > Collision still reads raw 400² `gridB`. §4d's resync-pop mitigations are unaffected.

> **Scope note 2026-09-04.** The pullback cut the hub from 17 games to 5, which changes what
> "done" means for this plan. Of the 5 games still on the board, 3 already play together
> (Zombie, Space Tracer, Glass City Escape) and 2 do not (RD Arena, Reality Rewrite). Glucose
> Dash is off-board but still partially wired (item 7 below). So the remaining multiplayer
> work is **three games, not eleven** — RD Arena, Reality Rewrite, and finishing Glucose Dash.
> Sequencing and the open questions on each are in `COLUMN_COMPLETION_ROADMAP.md`.

> **Update 2026-09-08.** RD Arena is done, so of the 5 games on the board **4 now play
> together** and the remaining multiplayer work is **Reality Rewrite, and finishing Glucose
> Dash** (off-board). The hardest one is behind us: §4d called RD Arena "not a wire up the same
> pattern job", and it was not — but the thing that made it tractable was deciding the field
> format in a bench (`rd-arena-bench/rd-curves.html`) and shipping it as rendering only for a
> day before any socket existed.
>
> **Superseded 2026-09-06 — the remaining work is now TWO games, not three.** Reality Rewrite was
> traded off the board for 4D Pong at the user's request. It keeps its `mp-core` identity wiring
> (item 8 below) and nothing about it broke, but it is shelved, so the *board* no longer contains
> a game waiting on a multiplayer decision other than RD Arena. **4D Pong does not replace it in
> this plan and never will: it is couch multiplayer by design** — up to four people at one
> keyboard, on `mp-core` for identity and presence only, with nothing on the wire. Putting four
> paddles on a socket is not a goal anyone has asked for, and listing it as pending work would
> misrepresent a finished game as an unfinished one. So: **RD Arena, and finishing Glucose Dash.**
>
> **Overtaken the same evening (2026-09-06).** 4D Pong went fully server-integrated — see item 9.
> The paragraph above is wrong about that game in every particular, and is kept as a record of how
> confidently a "never" can be written hours before it stops being true. The remaining list is
> unchanged in substance: **RD Arena, and finishing Glucose Dash.**
>
> **Still exactly those three as of 2026-09-05, and none of them moved.** That day's pass closed
> `Scripts Segmented?`, `Audio Design?` and `Aesthetic Unified?` on all three and touched no
> networking at all — the two `Server` questions were **deferred by the user on purpose**, because
> neither is work of that kind. What did change is where the files live and what they are called:
> Glucose Dash is now `under-development/glucose-dash/` and split into twelve `gd-*.js`, RD Arena
> into nine `rd-*.js`, Reality Rewrite into six `rr-*.js`. Any patch below that names a line in a
> monolithic `.html` now needs a file as well.

### Dev tools respect host authority (added 2026-09-07)

`shared/devtools.js` + `<game>-dev.js` put a playtest panel on `L`+`G` in every board game. It is
worth one line here because it touches §1–§3's authority model directly: **an action that writes
host-owned state is host-gated, and returns a reason instead of pretending.**

In Zombie that is round state, the `zombies` array and `scrapPool` — a guest writing to any of
them locally gets one frame of a lie before the next broadcast overwrites it, which looks exactly
like a desync bug and is not one. In 4D Pong the equivalent is the whole match: the host owns the
ball, the countdown and the seat map, so `NEW MATCH` / `PAUSE` / `SERVE` are offline-only.

The rule generalises: **if the server or the host is the authority for a value, a dev button may
not write it locally.** The panel's own State readout shows `netIsHost` / `net.host` so you can
see which side of that line you are on before pressing anything.

### Added since this plan was written (2026-09-02)

7. ◨ **Glucose Dash** — *partial.* Loads `shared/mp-core.js` and takes **room seed and identity**
   from it, so every racer runs the same seeded mall and keeps their hub name/colour — but
   **no ghosts are on the wire yet**, so it is still effectively solo. Finishing it is the
   cheapest remaining multiplayer win in the repo: it is a **race**, so it needs the Glass City
   model (§4b) — parallel worlds, positions only, no host and no shared authority.
   ~~It is also **not linked from the hub** (§7b of `HUB_LOBBY_PLAN.md` added every *other* game
   with code), so it needs a manifest entry before anyone can reach it.~~
   **Superseded 2026-09-05: it was moved to `under-development/glucose-dash/`.** It is now
   shelved rather than merely unlisted, so a manifest entry is no longer the next step — bringing
   it back off the shelf is, and `under-development/README.md` documents that path (its two
   shared-script paths climb `../../` and would need to come back to `../`). Nothing about the
   *networking* work below changed: it is still a race, still wants the Glass City model, and is
   still the cheapest remaining multiplayer win. It is just no longer on-deck.
8. ◨ **reality-rewrite** — *identity only (2026-09-03).* Now loads `mp-core` + `identity.js` and
   takes the server's colour, which it previously contradicted with a scheme of its own. **No
   gameplay is synced** — there is no `onMessage` handler — so it is not a multiplayer game yet;
   this was a correctness fix, not a rollout step.
   **Shelved 2026-09-06** to `under-development/reality-rewrite/` in the 4D Pong swap. The wiring
   is intact and moved with it; only its `../shared/` paths changed depth.
9. ✅ **four-d-pong** — *fully synced, host-authoritative, 2026-09-06 evening.*
   **The lines below were written earlier the same day and were overtaken within hours.** They
   are kept because the reasoning was sound for the game as it then existed — it *was* couch-only
   — and because "deliberately final" is exactly the kind of claim this repo has learned to date
   rather than delete. The user asked for online play for a three-friend session that night.

   **What it is now.** Host authority, the Zombie model, not Glass City's. Glass City's
   parallel-worlds model is cheaper and does not work here: it suits a *race*, where players never
   interact and each can run its own world, whereas 4D Pong has **one ball that everybody hits**,
   and two clients simulating it from the same seed diverge the instant a paddle moves — paddle
   positions are inputs, not seeds. So the host owns the ball, every collision, the score, the
   tug, the blasters and the CPU seats, and broadcasts a snapshot at 20 Hz. Clients predict
   exactly one thing: **their own paddle**, which is safe here because nothing but your own keys
   moves it.

   **No server change, and that is the headline.** Everything rides §1–§3's generic `relay`, which
   the server passes through untouched — the payload shapes live in `four-d-pong/fp-net.js` and
   are understood only there. This is the first game to exercise that design end-to-end for a
   *fast shared object* rather than for occasional events, and it needed no Render deploy.

   Seats: 2 humans → LEFT/RIGHT on the 16:9 field; 3 → LEFT/RIGHT/TOP with a **host-run CPU on
   BOTTOM**, the same seat the couch 3P mode uses; 4 → all four; 5+ spectate. The host assigns and
   broadcasts the map rather than everyone deriving it from a sorted peer list — peer lists differ
   transiently during a join, and two clients disagreeing about who is LEFT sends every input to
   the wrong paddle. Host migration is free: `onHostChange` fires and the new host already holds
   the last snapshot. Plan: `four-d-pong/ONLINE_PLAN.md`.

   ~~*identity and presence only (2026-09-06), and deliberately final.*~~
   Promoted onto the board and rebuilt the same day for 1-4 players. It joins the room the way
   Reality Rewrite does — `MP.connect({ game: "four-d-pong" })`, an `onReady` that takes
   `MP.selfColor`, no `onMessage` — which is what puts a player in the hub's presence roster
   while they are inside a game and what makes the local seat label the colour the board gave
   them. **This is the finished state, not a stage.** The game is four people at one keyboard;
   there is no second client to synchronise. Its hub entry carries `couch: true` rather than
   `mp`, which is why the board stamps it `COUCH 2-4P` instead of `MULTIPLAYER SOON` — see
   `hub/hub-core.js`.
10. ⬜ Still untouched: `javelin-battle`, `hex-grid`. *(`four-d-pong` left this list on
    2026-09-06 — see item 9. It is not untouched and not pending; it is done and local.)*

### Zombie has moved well past this plan

Zombie is listed ✅ DONE at step 2, and its *transport* is unchanged — but three further
rebuilds have loaded a lot more onto that transport. Anything syncing a new Zombie mechanic
should read `zombie/CLAUDE.md` and the three zombie plans rather than §4a. The wire rule that
matters most, and that every one of those rebuilds had to honour: **anything time-shaped crosses
as a remaining duration, never a timestamp.**

### Three sync models, deliberately different

Worth noting these did **not** all get the same treatment, because they aren't the same problem:

| Game | Model | Shared state on the wire |
|---|---|---|
| Zombie | Host-authoritative world, client-owned players | Zombies, bullets, powerups, deaths — and, since 2026-09-18, guests' bleed-outs and the team wipe |
| Glass City | Parallel worlds, pure race | Player positions + one "I finished" event |
| boids | Parallel worlds, competitive | Sampled swarm + attractor, for presence only |

Only Zombie needs a host, because only Zombie has a genuinely shared world. Glass City and
boids each run their own copy of a seeded world, which is why they need no authority, can't
desync, and degrade to solo cleanly.

### Verified for Glass City (two live clients)
- Identical city on both: **48,855 tiles with a matching structural hash**, identical
  collectible positions, identical robot count and spawn placement.
- Ghost racers sync with floor (z) and core count; positions interpolate between 15Hz updates.
- Race finish: first finisher sees "YOU WON", the other sees "Alice ESCAPED #1 — keep going!"
  and **keeps racing** for their own placing rather than being cut off. Second finisher
  correctly placed #2 with sorted standings on both screens.
- Per-stage seeding (`baseSeed + stage * 7919`) so solo players still get a fresh city each
  stage while racers stay in agreement.

### Verified for boids (two live clients)
- Identical node layout from the shared per-level seed at matching viewport size.
- Positions normalised to 0..1 and round-tripped exactly (0.5,0.5 → 640,360 on a 1280×720
  screen), so a phone player's swarm lands in the right place on a desktop screen.
- Swarm sampling caps correctly: a 215-boid flock sends **27 points, 401 bytes ≈ 3.9 KB/s**
  at 10Hz. Even eight players is a trivial load.
- The overlay resets `globalAlpha` and `textAlign` — verified — so it can't leak canvas state
  into the game's own drawing on the following frame.

### Known limitations carried forward (Glass City / boids)
- **Robots in Glass City drift apart between clients.** Spawn placement is seeded and
  identical, but patrol AI is client-local, so within seconds each player faces a slightly
  different robot arrangement. You may see a rival's ghost take a hit from a robot that isn't
  on your screen. Accepted: robots are an obstacle course, not a shared simulation, and
  syncing the patrol at 15Hz would cost more than the rest of the game combined.
  **Updated 2026-09-05:** the Hunt pass took the count from ~30 to **~94 per stage** and gave
  each one a pursuit state and a laser. That makes the drift more visible, and makes the decision
  *more* clearly right rather than less — the bandwidth the alternative would need has tripled,
  while the reason it was acceptable (parallel worlds, hazards not shared state) is unchanged.
  Laser bolts are client-local for the same reason.
  **Updated again 2026-09-06 (the Stepwell pass):** drones now come in two kinds, and **the kind
  is assigned off the SEEDED stream** (`assignDroneKind`), so it is part of the layout rather than
  a client-local roll like patrol jitter — every racer faces the same blue Lancer in the same
  doorway at the start of the stage, and only their behaviour diverges afterwards. The stepwell
  plaza is likewise seeded geometry (it is a constant position, reserved before the lattice), so
  it is identical everywhere. **Nothing was added to the wire by that pass** — still positions at
  ~15Hz plus one "I finished" event.
  **Updated 2026-09-06 (the Raster pass), and this one DOES touch a shared assumption.** The
  single-player loop became fetch-and-deposit (carry cores to pedestals) and the level curve now
  scales buildings, drones and the arena with the stage. All of it is seeded, so racers still get
  identical cities -- but the `pos` message still carries `n: collectedCount`, which now means
  "cores PICKED UP", not "cores delivered". The rival-progress readout beside each ghost is
  therefore optimistic by however many cores that racer is currently carrying (at most one).
  Left as is deliberately: it is one field, it is only a scoreboard hint, and changing it would
  mean a wire change for a cosmetic. **Recorded because it is exactly the kind of quiet meaning
  drift that a "nothing changed on the wire" note would otherwise hide.**
- **Laser strikes in boids are client-local**, for the same reason — each player runs their own
  parallel world at their own pace, so hazard timing is part of their own run. Same idea as two
  people racing the same seeded roguelike.
- **boids kept its viewport-sized world** rather than getting Zombie's fixed-world + letterbox
  treatment. That's deliberate: with parallel worlds, matching *relative* layout is all fairness
  needs, and the refactor would have bought nothing.
- **Glass City's stage progression runs whenever you have no rivals.** Reaching the tunnel ends
  the race only when somebody else is actually in the room; otherwise it advances a level.
  **Corrected 2026-09-07** — this bullet used to say "only runs solo", and the code agreed with it
  by testing `netOnline`, which is true as soon as the SOCKET opens. The result was that a player
  alone in a room (the normal case, because the server is up) hit a game-over box at the end of
  level 1 and could never reach level 2. The test is now `racingOthers()`, which asks
  `MP.peers()`. **Worth generalising to the other games here: `netOnline` answers "did the server
  answer", and nothing in this document should use it to mean "am I in company".**

### What was verified for Zombie (two live clients, local server)
- Both clients generated **byte-identical wall geometry** from the shared seed (19 walls,
  matching to 3 decimals) — the thing that was impossible before.
- Bidirectional player sync, each wearing their server-assigned name-hash colour.
- Client-fired bullets reach the host as authoritative bullets; the firing client renders its
  own predicted copy and filters the host's echo, so nothing draws twice.
- Host migration: killing the host promoted the other client, which carried the existing
  zombies over and resumed spawning rather than emptying the arena.
- Solo fallback: with the server unreachable the game drops to `solo`, self-hosts, generates a
  level and simulates normally — so `file://` double-click still works.
  *(2026-09-19: still true for a client that is alone. A client that loses a room **with teammates
  in it** now holds its world instead of self-hosting a fork of it — see "Zombie, 2026-09-19" below.)*
- Letterbox transform is exact at a non-16:9 aspect (scale 0.625, offset 168.8 as predicted)
  and mouse coordinates round-trip to the world perfectly, so aiming is correct on any screen.

### Known limitations carried forward (Zombie)
- **Bullet latency for non-hosts is hidden, not eliminated.** Your own shots are predicted
  locally so they feel instant, but the host is what decides whether they hit. On a bad
  connection you can see your bullet pass through a zombie that the host says you missed.
  Acceptable for this group size; the fix is real reconciliation, which is a much bigger job.
  *(2026-09-18: a guest's predicted round now stops where it visibly hits, and a predicted rocket
  goes off there — so the failure now looks like the opposite: your round vanishing into a
  zombie the host says you missed. The host still decides.)*
- **Kills/score are host-tallied.** A client's `kills` display is whatever the host last sent.
  *(2026-09-18: the per-player scoreboard now rides the snapshot as `sb`. Until then **guests
  never received it** — the round-end table only ever showed on the host.)*
- ~~**Couch co-op players share one network colour**~~ — **no longer applies (2026-09-01).**
  Local/couch co-op was removed after playtesting; there is one player per screen, so there is
  no second or third local player to fall back to the local palette. Every player now gets the
  server's name-hash colour.
- ~~**`activePlayerCount` is never decremented on death**~~ — **gone with couch co-op
  (2026-09-01).** The identifier no longer exists anywhere in `zombie/` (verified 2026-09-02);
  it only ever counted local players sharing one keyboard.

### Known limitations added since (2026-09-02)

- **A solo player cannot finish a run.** The v4 endgame opens with a sluice gate needing two
  players on two plates 436px apart, held simultaneously. That is deliberate — it is the one
  mechanic that makes this unambiguously co-op — but it means the ending is unreachable alone.
  See `zombie/ENDGAME_PLAN.md`.
- **Roles are derived, not dealt.** Medic/engineer/scout/gunner come from a hash of the client's
  own id, so they cost no wire traffic and survive a reconnect. Two players can roll the same
  role; that is accepted. *(Corrected 2026-09-19: they did **not** survive a reconnect — the id was
  the socket id, which is new on every connection. It is now a per-tab token; see below.)* Note `roleForId` deliberately **cannot** use `hashToUnit()`, whose
  `% 10000` keeps only djb2's low bits and clustered 400 ids into medic 0.

### Zombie, 2026-09-18 — deaths were not host-authoritative for guests

The playtest report "both of us went down and I just respawned at the start" was a sync-model
bug, not a UI one, and it is worth knowing for any host-authoritative game here. The host decided
who went **down**, but only its **own** player ever **bled out**: nothing held a guest's deadline,
so a downed guest stayed downed forever and "the whole room is dead" could never become true. The
host now keeps a bleed clock per downed guest (with a fresh one for any it inherits by promotion),
calls the room wiped itself when nobody is standing, and says so with an explicit new relay kind,
**`over`** — because the snapshot's `go` flag rides a throttled send and `update()` stops
broadcasting the moment `gameOver` is set, so the flag alone could be skipped entirely. A player
who bleeds out while someone stands comes back at the next breather. Reproduced on the old code
and verified on the new with two headless clients through a local stand-in relay (clocks set 777s
apart, which also confirms every new field is a duration). Detail: `zombie/CLAUDE.md` → "Death,
respawn and the team wipe"; the other wire additions of that pass are listed under "Authority".

### Zombie, 2026-09-19 — identity was the socket, and a client echoed host state

Two lessons from one playtest ("the revive bar pulses"; "what happens when someone's wifi drops,
and can friends join mid-game?") that apply to any game on this server:

- **The server's socket id is not a player identity.** `server.js` gives every connection a fresh
  random id, so anything keyed on it — Zombie's player id, role, scoreboard row, the host's bleed
  clock — is lost on every wifi blip. Zombie now keys all of it on a per-tab token in
  `sessionStorage` (survives drops and refreshes) and sends the socket id alongside only so a
  server `leave` can be matched. A duplicated tab copies sessionStorage: resolve that with a
  one-sided tiebreak that must persist, never a re-roll on first sight.
- **Never echo host-owned state back through a client's payload.** The host advanced a downed
  guest's revive progress, the guest reported its (round-trip-old) copy in its `players` row, and
  the host's handler rebuilt the record from that row — knocking its own value back 15×/s. One
  owner per field; the handler updates in place.
- **A drop in a shared room should hold, not fork.** Self-hosting on disconnect is right alone and
  wrong with teammates: the fork can die on its own and then "restart" resets the room. Zombie
  marks a silent teammate *away* (untargetable, bleed paused, 60s grace) and holds the dropped
  client's world under an overlay, with an opt-in to go solo after 15s.
- **Cannot be fixed client-side:** a host whose socket stalls without closing freezes the room until
  the server re-elects. That is the server's election, and the server cannot change.

Detail and measurements: `zombie/CLAUDE.md` → "Connection trouble (2026-09-19)".

## 6. Verification per game
- `node scripts/check-global-collisions.js` (mp-core.js adds a global to every page that loads it)
- Two browser windows, same room code → same world, both players visible
- One player reloads → identity/color survives, world still matches
- Host leaves → a new host takes over and the game keeps running
- Opened via `file://` → still runs (may be solo-only; degrade, don't crash)

<!-- doc-sync: 85a70f20 | 2026-09-20 -->
