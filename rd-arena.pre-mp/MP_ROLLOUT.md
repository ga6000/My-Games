# RD Arena — multiplayer rollout with a one-key local revert

Written 2026-09-03. Implements `MULTIPLAYER_PLAN.md` §4d (host authority + periodic coarse
bitmask resync), structured so gameplay feel can be A/B'd and abandoned without unpicking code.

**Nothing here is built yet.** This is the method, not a status report.

---

## 0. First: this working copy is not a git repo

`git rev-parse` fails at both `My Games-main/` and its parent. This is a downloaded GitHub ZIP
(`-main` suffix), not a clone — so `git checkout .` is **not available as a revert**, which is
normally the answer to "how do I back this out".

Two things to do before writing any netcode:

```bash
cd "Active Github Repos/My Games-main" && git init && git add -A && git commit -m "baseline before RD Arena multiplayer"
```

and a frozen file snapshot that needs no tooling at all:

```bash
cp rd-arena/RDArena.html rd-arena/RDArena.pre-mp.html
```

The snapshot is a **dated fallback, not a maintained fork** — don't sync changes into it. If MP
goes badly you double-click the snapshot and you're playing today's build.

## 1. Why a runtime flag beats a code revert here

The question is "does this hurt gameplay feel". Feel judgements need **A/B within one session**,
on the same field, seconds apart. A VCS revert can't do that — you'd be comparing across
reloads, different RD seeds, different rounds.

So the primary mechanism is a **runtime kill switch with independently togglable parts**, because
three separate things could be what hurts, and you need to know which:

| Flag | What it turns off | Suspect if… |
|---|---|---|
| `NET.hostSim` | host-authoritative enemies/rounds; each client sims locally again | enemies feel laggy, rubber-band, or shoot from stale positions |
| `NET.resync` | the periodic solidity bitmask | walls visibly pop or snap every 2-3s |
| `NET.carveEvents` | relaying discrete carves; carves stay local-only | carve holes appear late, or in the wrong place |

Bind them to keys (`F9` cycles all-off / all-on, `F10` resync only, `F11` host-sim only) and read
overrides from the URL so a shortcut can pin a config: `RDArena.html?net=0`, `?net=nosync`.

**`NET.enabled = false` must be byte-for-byte today's game.** That is the invariant the whole
design protects. Verify it by diffing behaviour, not by reading code.

## 2. Build order — the refactor is the risky part, so isolate it

### Step 1 — the mutation choke point, as a no-op
Every discrete write to `gridB` currently happens in three places (`RDArena.html`): `clearRadius`
(219), `suppressRadius` (237), and the blood-particle loop (~2200). Funnel all three through one
function:

```js
function carve(x, y, r, kind) {   // kind: 'bullet' | 'blast' | 'spray' | 'blood' | 'dash' | 'machete'
    applyCarve(x, y, r, kind);              // exactly the old local behaviour
    if (NET.active && NET.carveEvents) NET.emitCarve(x, y, r, kind);
}
```

Ship **only this**, with `NET` absent. It must change nothing. Verify before moving on — if
something breaks later you then know it wasn't the refactor. This is the step most likely to
introduce a silent bug, and the one least likely to be blamed.

Continuous evolution (`updateRD`) is deliberately *not* routed through this. It is never sent;
it's what the resync corrects for.

### Step 2 — split netcode into its own file
Follow the `zombie` precedent (`Zombie.html` loads 9 classic scripts including
`../shared/mp-core.js` and `zombie-net.js`):

```html
<script src="../shared/mp-core.js"></script>
<script src="rd-arena.js"></script>      <!-- today's inline script, moved out verbatim -->
<script src="rd-net.js"></script>        <!-- everything new -->
```

`rd-net.js` defines `window.RDNet` and installs itself by *assigning into* hook points the game
exposes — it is never called from inside the game loop except through the `NET.active` guards.
Delete the one script tag and the game is single-player again. Run
`node scripts/check-global-collisions.js` after splitting; that checker exists for exactly this.

### Step 3 — host authority
Host simulates RD, enemies, rounds, organ bakes. Clients own their own player only and send
input/position. Reuse `mp-core`'s host election and room seed rather than inventing a scheme, and
take identity/colour from hub identity — **do not add a third client-side name-hash**;
`PROJECT_MEMORY.md` flags that duplication as open technical debt.

### Step 4 — the periodic bitmask
400×400 bits = **20,000 bytes**, unchanged by the arena growing to 4800² (the grid stayed 400²).
Broadcast every 2-3s ≈ 8KB/s.

```js
// pack: 1 bit per cell, solidity only -- never the floats
for (let i = 0; i < gridSize; i++)
    if (gridB[i] > 0.3) mask[i >> 3] |= (1 << (i & 7));
```

## 3. The thing most likely to hurt feel, and how to soften it

The resync **pop**. Client floats drift from host floats, so every 2-3s some cells disagree and
snap. Mitigations, cheapest first:

1. **Correct only disagreements.** Compare bit against `gridB[i] > 0.3` and touch nothing else.
   Most cells agree; a full overwrite would pop the entire screen.
2. **Land just past the threshold, not at the extremes.** Set `0.35` / `0.25`, not `1` / `0`, so
   the RD kernel heals the seam over the next few frames instead of leaving a hard edge.
3. **Never resync under a player.** Skip cells within ~40px of any player. A cell going solid
   under someone traps them — collision is a point test on the entity centre, so a player inside
   fresh flesh cannot step out.
4. **Unstick the player too.** The enemy unstick ladder already exists (probe → carve → relocate);
   players need at least the carve rung, triggered on "solid at my centre".
5. **Never touch `staticMask` or `noGrow`.** Sanctuaries and organ aprons are deterministic from
   the room seed — they can't drift, so excluding them costs nothing and removes a pop source.

If it still pops: fall back to `MULTIPLAYER_PLAN.md`'s documented plan B — a **coarser 200×200
collision grid** (5KB) that is authoritative, with the fine 400² field kept purely visual. Walls
then disagree cosmetically between clients but never disagree about what you can walk through,
which is the only disagreement that actually ruins a match.

## 4. What to measure before deciding

Feel is subjective, so capture something objective alongside it:

- **cells corrected per resync** — if this is thousands rather than dozens, divergence is the
  problem, not the resync rate. Raising the rate won't help; determinism will.
- **KB/s actually sent** — budget was ~8KB/s. Render's free tier is fine for 3-10 players.
- **player-trapped events** — count how often mitigation 3/4 fires. Should be near zero.

Log these to console behind `NET.debug` and read them after a session.

## 5. Interaction with what already shipped

- The **card overlay already does not pause the world** and shields the choosing player in a
  bubble. That was built for this: one player choosing must not stop the match.
- **Edge smoothing is render-only** — it reads `gridB` and never writes, so it is invisible to
  the bitmask. Safe to change freely without touching netcode.
- Enemy **wall collision is a point test on the entity centre**, which is why resync-under-player
  traps are a real risk (§3.3) rather than a cosmetic one.
