# Zombie — mid-game map regeneration + big-zombie wedging

Written 2026-09-07. Two reported symptoms, four distinct causes.

---

## A. The map regenerates entirely, mid-game

**Reported:** intermittently, 10 rounds in, every door is shut again and the layout is new.

**Cause.** `zombie-net.js` `onPeerSync`:

```js
if (MP.seed() !== levelSeed) generateLevel();
```

`onPeerSync` is not a one-shot. `mp-core.js` fires it from `handle()` on **every** `players`
message the server sends — join, leave, and the rejoin handshake — and the line immediately
before it is `if (typeof data.seed === "number") setSeed(data.seed)`. So the moment the server
hands back a seed that differs from the one this page built its level from, `generateLevel()`
runs and wipes `walls`, `doors`, `barricades`, `wallBuys`, `ammoCrates`, `barrels`, `traps`,
`zoneHotUntil` and the whole endgame chain.

The server hands back a different seed when the room was garbage-collected while everyone was
briefly disconnected and then recreated on rejoin. In local testing that is the ordinary case,
not a rare one: `mp-core` reconnects on a 3s timer after every `onclose`, and a free-tier
instance that sleeps (or a laptop that does) empties the room in between.

The hook was written for the promotion path — a client that missed the 6s connect timeout, got a
throwaway clock seed, and needs to rebuild once the real seed lands. That case is real and worth
keeping. It just cannot be distinguished from "the seed changed 10 rounds in" by the seed alone.

**Fix.**
1. Only regenerate from a seed change while `gameStarted === false`. Once the game is running the
   level is in play and must never be rebuilt from under it. Pin `MP`'s stream back to the level
   we are actually on (`MP.reseed(levelSeed)`) so `MP.random()` and any later `resetGame()` stay
   consistent with what is on screen.
2. The host publishes its `levelSeed` on the world snapshot (`ls`) — one integer on a packet that
   already ships 15x/s, riding the generic `relay`, no server change. A client whose level does
   not match the host's adopts the host's and rebuilds once. That converges in a single step
   (`generateLevel()` sets `levelSeed = MP.seed()`), and it is applied at the TOP of
   `applyWorldSnapshot` so the door/barricade/crate state in the same packet lands on the fresh
   geometry.

That makes the host the authority on geometry the same way it is on everything else, and gives a
mid-game joiner the host's map instead of the server's newest seed.

---

## B. Brutes / screamers / splitters wedge on corners at broken barriers

Three separate causes, all size-dependent, which is why the small types never show it.

### B1. Steering compares a centre-space goal against a corner-space position

`zombie-game.js`, `updateZombies`:

```js
const step = navStepToward(z.x + z.size / 2, z.y + z.size / 2, field);   // centre in
const goal = step || target;
const dx = goal.x - z.x;      // <-- top-left corner out
const dy = goal.y - z.y;
```

`navStepToward` returns a nav-cell **centre**. The zombie's centre is `z.x + size/2`. So the
heading is biased toward +x/+y by half the body size — the zombie aims its top-left corner where
its centre should go, and the body rides high and left of the path it was handed.

Concretely, for a goal 100px dead right: brute (26px) steers 6.6 deg downward and its centre
starts 13px above the sampled line. A 112px window leaves a brute 43px of clearance per side;
that error eats ~25px of it. Walker (16px) loses ~15px of 48px and gets through.

The error scales exactly with body size: brute 13, splitter 12, screamer 10 vs walker 8,
runner 6, spawnling 4.5. That is precisely the reported split.

**Fix.** Work in centre space on both sides, including the `target` fallback (a player's `x` is
also a top-left corner).

### B2. `NAV_PAD` gives a brute exactly zero skin

`NAV_PAD = 13` is exactly half a brute (26). A nav cell marked passable is therefore *exactly*
wide enough for a brute and no wider, so any float error at a corner clips. Raise to 15.

Width check: guaranteed-navigable opening is `2*NAV_CELL + 2*NAV_PAD` = 40 + 30 = **70px**. The
narrowest opening in the map is the outpost doorway at 112px; windows are 112-151, doors 124-159.
Clear. (The existing comment claiming this figure is 106px is stale from when `NAV_CELL` was 40 —
at `NAV_CELL = 20, NAV_PAD = 13` it is 66. Corrected in place.)

### B3. `moveWithCollisions` cannot resolve an existing overlap

Resolution is chosen by the sign of the movement delta only:

```js
if (dx > 0) entity.x = w.x - entity.size;
else if (dx < 0) entity.x = w.x + w.w;
```

With `dx === 0` nothing happens at all, and an entity that was *already* overlapping before the
step gets snapped by the sign of its travel rather than to the nearer face — which can shove it
straight through a 20px wall to the wrong side. A brute is bigger than the walls it stands in, so
this hits the big three and nobody else.

**Fix.** Keep the sign-based snap for the normal case, and detect the abnormal one exactly: a
legitimate step needs a correction no larger than `|delta|`. Anything larger means the entity was
embedded before the step, so eject to the nearer face instead.

---

## C. Perma-stuck zombies never despawn — and the escape hatch throws

This is the soft-lock, and it is the most severe finding.

### C1. `relocateZombie` throws a ReferenceError on every call

```js
const r = SPAWN_RING_MIN + Math.random() * (SPAWN_RING_MAX - SPAWN_RING_MIN);
```

**Neither constant exists anywhere in the repo.** `grep -rn SPAWN_RING zombie/ shared/` returns
that one line and nothing else.

So the first time any zombie reaches `stuck > 240`, `relocateZombie` throws. The throw propagates
out of `updateZombies` and kills the rest of `update()` on the host — `updateRevives`,
`updateTraps`, `interpolateRemotes`, `pruneRemotePlayers`, `broadcastPlayers` and
**`broadcastWorld`** all stop running. `gameLoop` re-arms its rAF first (deliberately), so the
host keeps drawing and looks alive while every other client freezes. And because the throw
happens *before* `z.stuck = 0`, it repeats every frame forever.

One wedged brute silently ends the session for the whole room. That is the soft-lock.

**Fix.** Drop the phantom constants and reuse `pickSpawnPoint(z.size)`, which already knows how
to find a legal, off-screen, non-sealed spot and is the same placement a fresh spawn gets. Keep
the existing despawn as the second stage when placement fails, per the brief: pathfinding first,
despawn/respawn as the fallback.

### C2. The progress watchdog can never reach the relocate threshold

```js
if (moved >= speed * 0.34) z.stuck = 0;          // every frame
...
if (gained < expect) z.stuck = Math.max(z.stuck || 0, 6);   // once per 800ms
```

A zombie oscillating between two nav cells *moves* every frame, so `z.stuck` is cleared to 0 on
the frame after the watchdog raises it to 6. It ping-pongs 0 <-> 6 and can never climb to the 240
that triggers relocation. The watchdog detects exactly the failure the escape hatch exists for,
and then immediately forgets it.

**Fix.** Give the watchdog its own counter (`z.noProgress`) that the per-frame `moved` check
cannot clear. Four consecutive dead 800ms windows (~3.2s of going nowhere) triggers relocation
directly. A window that does show real travel resets it.

### C3. Zombies can walk out of the world and never come back

There is **no perimeter wall** — `buildZoneWalls` only emits the interior boundaries at v=1,2 and
h=1,2 — and zombies move with `clampToWorld = false` so they can spawn off-map and walk in. But
nothing ever stops them walking back *out*. A zombie ejected outward at the map edge is
off-camera, unshootable, and `roundBudget === 0 && zombies.length === 0` never becomes true.
That is the "stuck off screen, can't be shot" report.

**Fix.** A one-way leash: track `z.entered`, set once the body is fully inside the bounds, and
clamp to the world from then on. Off-map spawning is preserved; the exit is closed.

---

## Files touched

| File | Change |
|---|---|
| `zombie-net.js` | A1, A2 — `onPeerSync` guard, `hostLevelSeed`, `ls` on the snapshot |
| `zombie-level.js` | B2, B3 — `NAV_PAD` 13 -> 15, penetration-aware `moveWithCollisions` |
| `zombie-game.js` | B1, C1, C2, C3 — centre-space steering, `relocateZombie`, watchdog, leash |
| `zombie-entities.js` | C2, C3 — `noProgress` / `entered` fields on `makeZombie` |

## Verify

```
node scripts/check-global-collisions.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
```
