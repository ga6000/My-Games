# RD Arena — multiplayer build notes (MP_ROLLOUT steps 1–4)

Written 2026-09-08, **before editing**, per root `CLAUDE.md` ("for anything nontrivial, write the
plan to a markdown file before editing; sessions compact, saved plans don't"). `MP_ROLLOUT.md`
is the method; this is what the method turned into once it met the code that actually exists.

Read with `NET_FIELD_NOTES.md` (2026-09-07), which already landed the field format.

---

## Where MP_ROLLOUT's plan no longer matches the code

| MP_ROLLOUT says | Reality on 2026-09-08 | What we do |
|---|---|---|
| §0 `git init`, and snapshot `RDArena.html` | Still not a git repo. And the game is **14 files**, so snapshotting one HTML preserves nothing | Snapshot the **whole folder** to `rd-arena.pre-mp/`. `git init` left to the user — it is a repo-wide act, not part of steps 1–4 |
| §2 step 1: funnel three writers through `carve(x,y,r,kind)` | The three writers are still exactly where §2 said: `clearRadius`, `suppressRadius`, and the blood loop (now `rd-boot.js`) | Same choke point, different names — see below |
| §2 step 2: move the inline script to `rd-arena.js`, add `rd-net.js` | The split already happened on 2026-09-05, into ten `rd-*.js`, and better than proposed | Step 2 collapses to "add three script tags" |
| §2 step 4: 400² 1-bit every 2–3 s | Superseded 2026-09-07 by 133² 2-bit every 1.0 s | Already decided; this build sends it |
| §1 flags on F9/F10/F11 | **F9 was taken on 2026-09-07** by the `RDNET` render toggle | Render toggle moves to **F8**; F9/F10/F11 are the net flags as written |

## Step 1 — the mutation choke point

MP_ROLLOUT wants one function named `carve`. Renaming would touch **14 call sites** across four
files for no behavioural gain, and step 1's entire value is that it ships as a **provable no-op**.
So the choke point keeps the existing public names and gains a private core:

```
applyCarve(cx, cy, r, circular, debris)   // the old bodies, merged
clearRadius(cx, cy, r)      -> applyCarve(..., square,   debris) + RDHOOKS.carve(...)
suppressRadius(cx, cy, r)   -> applyCarve(..., circular, none)   + RDHOOKS.carve(...)
bloodCarve(cx, cy, r)       -> applyCarve(..., square,   debris) + RDHOOKS.carve(...)   [new]
```

`bloodCarve` is the third writer — the blood-particle loop in `rd-boot.js` wrote `gridB` inline
and was the one §2 warned would be forgotten. It is now in `rd-field.js` with the other two.

**Not routed through it:** `updateRD()`. Continuous evolution is never sent; it is what the
resync corrects for. That is MP_ROLLOUT's call and it still holds.

Only `'clear'` actually reaches the wire. `RDHOOKS.carve` in `rd-net.js` drops the other two,
and it drops them *there* rather than by silently not calling the hook, so the decision is
visible with the netcode instead of hidden in `rd-field.js` as an omission:

- **`'spray'`** is every sanctuary mote on every frame. That is a flood, not a message.
- **`'blood'`** is up to 250 particles a frame while a CORROSION splatter is landing.

Both are gradual and structural, and the 1 s field packet corrects whatever they drift by. A
hole punched by a bullet, a dash or a machete is the one a player watches for and notices
arriving late — so that is the one that gets sent.

## Step 2 — the tags

```html
<script src="../shared/identity.js"></script>   <!-- MUST precede mp-core (§3) -->
<script src="../shared/mp-core.js"></script>
...
<script src="rd-net.js"></script>               <!-- last; registration only -->
```

`rd-net.js` installs by **assigning into `RDHOOKS`**, an object declared in `rd-core.js` whose
defaults are the single-player behaviour. Deleting the one tag therefore really does give today's
game back — which it would not if the game called `netFoo()` directly, because that would be a
`ReferenceError` and `check-undefined-globals.js` would (correctly) fail.

## Step 3 — host authority, and the three places we deviate

Host owns: **enemies, all bullets, crawlers, the round clock, the kill counter.**
Clients own: **their own player** — position, HP, death, respawn, cards, gun upgrades.

Three deliberate departures from Zombie's protocol, each to remove a whole class of bug:

1. **No `down`/`up`/`dead` protocol.** Zombie needs one because a downed player is a shared
   objective. Here death is a 2 s respawn, so each client resolves damage to its own player from
   the bullets it already has on screen. Nobody is ever corrected on their own HP, which is the
   same trust model the repo already uses for position.
2. **Organs, bakes and cards are per-client and never sent.** `kills` is host-owned and shared,
   so everyone crosses a BIOhack threshold together; what they then do with it is private. This
   is Glass City's parallel-worlds answer (§4b) rather than a claim protocol — there is no
   contention to arbitrate if the resource isn't shared.
3. **The flow field becomes multi-source.** It seeded Dijkstra from `player` alone; on a host
   with three players that would path every grunt toward the host specifically. Seeding from all
   known players is ~10 lines and is the difference between co-op and "everyone follows Dave".

Client bullets are simulated locally for instant feedback and **resolve no enemy damage** — the
snapshot overwrites `enemies` anyway. Same as `zombie-game.js:733`.

## Step 4 — the field packet, and what it corrects

The host packs `RDNET.pack()` (already written, 133² × 2 bit) into 4,423 bytes, base64s it onto
the generic relay, once a second. Clients **do not** render it directly and **do not** collide
with it. They use it to correct their own 400² `gridB`, applying MP_ROLLOUT §3 in full:

- correct only cells that **disagree** about solidity (§3.1)
- land on `0.35` / `0.25`, not `1` / `0`, so the RD kernel heals the seam (§3.2)
- **never** within 90 px of any known player (§3.3) — collision is a point test on the entity
  centre, so a cell going solid under someone strands them
- never touch `staticMask` or `noGrow` (§3.5)

One net cell covers a 3×3 block of RD cells, so a correction writes the block, not one cell.

Rendering is unchanged: `RDNET` still packs the **local** `gridB`. On a client that field is now
being pulled toward the host's, so the picture converges without the renderer knowing anything
about the network. One format, two uses.

**§3.4 (unstick the player) is deferred.** §3.3 is the mitigation that prevents the trap; §3.4 is
the recovery for when it happens anyway. Shipping the counter (`NET.debug`) first tells us
whether the recovery is needed at all, which §4 asks for.

## What §4 says to measure

`NET.debug` (dev panel readout) logs cells corrected per resync, KB/s sent, and player-trapped
near-misses. Thousands corrected means divergence, not resync rate — raising the rate will not
help and determinism would have to.

## Known v1 limitations, written down so they are not rediscovered

- Enemy **spawn** positions come from host `Math.random()`, not `MP.random()`. They are
  broadcast, so clients agree; they just are not reproducible. Fine — nothing replays a run.
- A promoted host inherits enemies from the last snapshot but rebuilds its own flow field. Brief
  AI stall on host migration, no state loss.
- The initial RD blob field is seeded from `MP.random()` and **latched** (MULTIPLAYER_PLAN §2's
  rule). The host also publishes the seed it built from on every snapshot, as Zombie does, so a
  late joiner converges instead of trusting a server seed that may have been regenerated.

---

## Built and verified 2026-09-08

Two live clients against the deployed server (`wss://my-games-faxi.onrender.com`), room `RDTEST`:

| Checked | Result |
|---|---|
| Seed latched identically on both | `871646719` on host and client |
| Host authority | client reports `simsWorld() === false`, never spawns, never runs enemy AI |
| Enemy reconciliation by net id | client rebuilt `enemies` from the snapshot, ids preserved across frames |
| **Field packet** | 5,900 chars of base64 on the wire (4,423 bytes + base64's third), 1/s |
| **Resync corrections** | **149 cells of 17,689** on the first packet — dozens, not thousands, which is the healthy end of §4's range |
| Resync guard (§3.3) | 0 refusals — nobody was standing in contested ground |
| Carve relay | client carved at (1000,1000); host's `gridB` there went `1.0 → 0`, with no echo back |
| Damage report | client called `hit()` on enemy net id 1; host's `kills` went `0 → 1` |
| Kill switch | `?net=0` → `NET.enabled false`, `simsWorld() true`, one target, game sims normally |

**Not yet observed, because it needs real play rather than two driven tabs:** whether the resync
*pops* visibly, and whether §3.4 (unstick the player) turns out to be needed. The dev-panel rows
exist to answer both from a session rather than from a console.
