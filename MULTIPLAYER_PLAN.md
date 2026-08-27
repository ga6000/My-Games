# Multiplayer Rollout Plan — RDArena, Zombie, boids, Glass City Escape

Written 2026-08-24 before any code changes. Covers the server-architecture decision and the
per-game sync model for the four games named.

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

---

## 3. Shared client core — `shared/mp-core.js`

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
MP.peers()              // {id: {name, color, isHost}}
MP.selfId / MP.selfColor
```

Identity (name/room) is read from URL params then localStorage, matching what the hub already
writes — so a player who set their name on the hub is recognized in every game without
re-entering it.

---

## 4. Per-game sync models

Ordered easiest → hardest. This ordering is also the recommended build order.

### 4a. Zombie — co-op survival — **EASIEST, do first**
Already a 3-player local co-op game: `players[]`, `assignedControls{mouse,wasd,arrows}`,
per-player `keys`. The player model needed for network play already exists — the conversion is
"N remote players each owning one entry" instead of "3 control schemes on one keyboard."

- **Players:** each client owns its own player, broadcasts position/facing/shooting at ~10Hz.
- **Zombies/powerups:** host-authoritative. Host simulates, broadcasts state ~10Hz.
  Rough cost: ~100 zombies × ~12 bytes ≈ 1.2 KB/tick ≈ 12 KB/s. Fine for this group size.
- **Walls:** generated from the room seed — no sync needed after join.
- **⚠ Blocker specific to this game:** the playfield is currently the *browser viewport*
  (`width`/`height`), so every player has a differently-sized world. Must become a fixed world
  size with a per-client camera. This is a real change, not a tweak.

### 4b. Glass City Escape — parkour / collectathon
- **World:** fully seeded, generated identically on join. No ongoing sync.
- **Players:** own avatar, broadcast position ~10Hz. Lightest of the four.
- **Collectibles:** claim-by-relay (first claim wins, host arbitrates ties).
- **⚠ Design fork — needs a decision:** co-op (shared collectible pool, escape together) vs.
  race (everyone runs the same seeded city, first to the tunnel wins). Race is simpler (no
  shared-state contention at all) and probably more fun with friends; co-op matches the
  existing single-player goal structure. **Not yet chosen.**

### 4c. boids — swarm attractor
- **⚠ Design fork — needs a decision:**
  - **Competitive (recommended):** each player owns their own flock and syncs only their own
    boids. Natural "grow the biggest swarm" competition, light sync, no shared authority
    needed, degrades gracefully if someone lags.
  - **Co-op:** one shared swarm, host-simulated, broadcast ~10Hz. At level 10 that's
    ~135 boids ≈ 1 KB/tick ≈ 10 KB/s — feasible, but every player's attractor fights over the
    same flock, which may just feel muddy.
- Recommend competitive. **Not yet chosen.**

### 4d. RDArena — reaction-diffusion arena — **HARDEST, do last**
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
5. ⬜ RDArena — its own session, full host-authority + periodic bitmask resync approach.

### Three sync models, deliberately different

Worth noting these did **not** all get the same treatment, because they aren't the same problem:

| Game | Model | Shared state on the wire |
|---|---|---|
| Zombie | Host-authoritative world, client-owned players | Zombies, bullets, powerups, deaths |
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
  syncing ~30 patrolling bots at 15Hz would cost more than the rest of the game combined.
- **Laser strikes in boids are client-local**, for the same reason — each player runs their own
  parallel world at their own pace, so hazard timing is part of their own run. Same idea as two
  people racing the same seeded roguelike.
- **boids kept its viewport-sized world** rather than getting Zombie's fixed-world + letterbox
  treatment. That's deliberate: with parallel worlds, matching *relative* layout is all fairness
  needs, and the refactor would have bought nothing.
- **Glass City's stage progression only runs solo.** Online, reaching the tunnel ends the race
  instead of advancing a stage.

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
- Letterbox transform is exact at a non-16:9 aspect (scale 0.625, offset 168.8 as predicted)
  and mouse coordinates round-trip to the world perfectly, so aiming is correct on any screen.

### Known limitations carried forward (Zombie)
- **Bullet latency for non-hosts is hidden, not eliminated.** Your own shots are predicted
  locally so they feel instant, but the host is what decides whether they hit. On a bad
  connection you can see your bullet pass through a zombie that the host says you missed.
  Acceptable for this group size; the fix is real reconciliation, which is a much bigger job.
- **Kills/score are host-tallied.** A client's `kills` display is whatever the host last sent.
- **Couch co-op players share one network colour** — only the first local player on a keyboard
  gets the name-hash colour, players 2 and 3 fall back to the local palette, because all three
  share one socket identity.
- **`activePlayerCount` is never decremented on death** (pre-existing). After three players have
  ever joined on one keyboard, no more can join there even if they died. Not introduced here,
  but more visible now that sessions last longer.

## 6. Verification per game
- `node scripts/check-global-collisions.js` (mp-core.js adds a global to every page that loads it)
- Two browser windows, same room code → same world, both players visible
- One player reloads → identity/color survives, world still matches
- Host leaves → a new host takes over and the game keeps running
- Opened via `file://` → still runs (may be solo-only; degrade, don't crash)
