# Zombie — the Blood Silo endgame + roles

**STATUS: complete 2026-09-02.** All of it built and verified. Started 2026-09-02. This is idea 47 (Extraction) made concrete, plus idea 57 (two-player gate)
and idea 56 (roles, but randomly assigned).

## The chain

1. **THE SLUICE GATE** — a fixed, persistent location. Two plates, far enough apart that one
   player cannot cover both. Both must be held *simultaneously*, and the lock has **two stages**:
   fill the bar, it latches, then a second, longer hold opens it. Opening is permanent.
2. Through the gate: a **tight room** with a **giant funnel** filling most of the floor.
3. **Zombies killed while standing on an active funnel** drain into the connected **blood silo**.
   Kills anywhere else do nothing for it — you have to lure them onto the plate and kill them there.
4. When a silo fills, a **switch on that silo** unlocks. Flipping it opens the **next floor-funnel**
   somewhere else on the map.
5. **Three silos.** When the third fills: **THE FLOOD** — a massive wave from every direction at
   once, ignoring the normal spawn rules.
6. Survive the flood and clear it, and the **southern escape** begins opening. It takes a long
   time. Reach it once open and the run is **won** — the first win state the game has ever had.

## State (host-authoritative, all of it on the wire)

| Field | Meaning |
|---|---|
| `gateStage` | 0, 1, 2 — 2 means open |
| `gateProgress` | 0..1 for the stage in progress |
| `funnelActive[3]` | which funnels are live |
| `siloFill[3]` | 0..`SILO_CAPACITY` |
| `siloFlipped[3]` | switch thrown, next funnel opened |
| `floodActive` / `floodRemaining` | the final wave |
| `escapeAt` | when the southern route finishes opening |
| `won` | run complete |

Wire rule as always: `escapeAt` crosses as a **remaining duration**, never a timestamp.

## Consequences to accept, and flag

- **A solo player cannot finish the run.** The gate needs two people on two plates. That is the
  point of idea 57 — it is the one mechanic that makes this unambiguously a co-op game — but it
  means the endgame is unreachable alone. Flag it clearly on delivery.
- The flood must ignore the zone-cooldown spawn rules. It is the one moment where zombies
  appearing everywhere at once is the intent rather than a bug.
- Normal round spawning pauses during the flood, or the two systems fight over the budget.

## Roles (idea 56, randomly assigned)

Derived from `hashToUnit(netPrefix)`, **not** dealt by the host. That means: no wire traffic, it
survives a reconnect, and it is consistent with how identity and colour already work in this
project. Two players can roll the same role; that is fine.

| Role | Passive |
|---|---|
| `MEDIC` | Revives 40% faster and ignores the per-round revive escalation |
| `ENGINEER` | Traps 40% cheaper; re-boarded barricades come back at 150% HP |
| `SCOUT` | Double ping radius, pickups on the minimap, +10% move speed |
| `GUNNER` | +15% weapon damage, crates give +25% ammo |

Small on purpose. Roles should make four players feel different before anyone has bought
anything — they should never decide a run.

## Files

- **New** `zombie-endgame.js` — geometry, state machine, silo/funnel/flood/escape logic.
- `zombie-level.js` — place the sluice, funnels, silos, escape.
- `zombie-game.js` — hook kills into funnels, flood into the round loop, roles into effects.
- `zombie-net.js` — sync the chain.
- `zombie-render.js` — draw all of it, plus the victory screen and role in the HUD.
- `Zombie.html` — victory overlay.

## Verify

- [x] One player cannot open the gate; two can.
- [x] Two stages, and progress resets if a plate is released.
- [x] Only kills ON an active funnel fill its silo.
- [x] Silo switch is inert until full; flipping opens exactly the next funnel.
- [x] Third silo triggers the flood; flood spawns from all directions.
- [x] Clearing the flood opens the escape, slowly; reaching it wins.
- [x] Roles are stable across a reconnect and need no wire traffic.
- [x] Whole chain survives a host migration (state round-trips through the snapshot).
- [x] Nothing can spawn inside the sealed sluice — it would be trapped there for the run.
