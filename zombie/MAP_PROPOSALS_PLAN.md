# Map proposals — implementation plan (2026-09-20)

All twelve proposals from `MAP_DESIGN_GUIDE.md` §6, approved in full. Plus a workflow fix that
came out of the same conversation.

## 0. Local playtesting (shipped first, separately)

**`?solo=1` in `shared/mp-core.js`.** Reported: *"server/online integration prevents zombies
spawning which makes local play testing hard. It forces me to commit/push or form a new branch in
order to play test features."*

The mechanism, read from the code rather than guessed:

1. `connect()` always ran, and always joined the live server's default room.
2. `CONNECT_TIMEOUT_MS` is 6,000, so a slow or unreachable server drops you to **solo** — you are
   your own host, zombies spawn, everything works.
3. **`socket.onclose` retries every 3s forever, and a later successful open upgrades the session
   to `"online"`.** At that point `hostId = data.hostId` comes from the server and
   `onHostChange` sets `netIsHost`.

So a local session can start fine and then be **demoted mid-run** the moment the socket finally
opens, if any other socket in that room holds host — a friend, a second tab, or a stale connection
the server has not yet reaped. Every host-only system (in Zombie, the entire zombie simulation)
stops. It reads as "the feature I am testing is broken".

`?solo=1` (or `?offline=1`) opens no socket at all, so there is nothing to retry and nothing to
race. `isHost()` already returns true whenever `status !== "online"`, so solo is not a special case
anywhere else. `?solo=0` and `?solo=false` are deliberately *not* solo.

**Verified in the browser:** `status "solo"`, `isHost true`, no socket, and with the loop driven
(the Browser pane suppresses rAF while hidden) round 1 spent budget 7 → 3 with 4 zombies alive.

---

## 1. P1 — the 24 × 18 paint grid

`ZONE_COLS_FINE` 12 → **24**, `ZONE_ROWS_FINE` 9 → **18**, so `ZONE_CELL_W/H` become **200 × 150**.
The grid is 432 cells.

Validated before writing any code: no disconnected sector, the keep (cols 10–13, rows 7–10), the
sluice room (cols 10–13, rows 14–16) and the south gate all contained, **41 merged boundary runs
against 39** — because `zoneBoundaryRuns` merges collinear cells, a 2× upsample of the *current*
shapes measures exactly 39, so the finer grid is free until a shape spends it.

```
  0 SSSSSSCCCCCCCCKKKKYYYYYY     S spillway  C cold     K kennels
  1 SSSSSSCCCCCCCCKKKKYYYYYY     Y yard      B blockhouse
  2 SSSSSSSSCCCCKKKKKKYYYYYY     T turbine   P pump
  3 SSSSSSSSCCCCKKKKKKYYYYYY     L sluice    M motor
  4 SSSSSSCCCCCCCCKKKKYYYYYY
  5 SSSSSSCCCCCCCCKKKKYYYYYY
  6 SSSSTTTTTTBBBBBBKKYYYYYY
  7 SSSSTTTTBBBBBBBBKKYYYYYY
  8 SSSSTTTTBBBBBBBBPPPPYYYY
  9 SSSSTTTTBBBBBBBBPPPPPPYY
 10 SSSSTTTTTTBBBBBBPPPPPPYY
 11 SSSSSSTTTTTTBBBBPPPPPPYY
 12 SSSSSSLLLLLLLLMMMMMMMMYY
 13 SSSSSSLLLLLLLLMMMMMMMMYY
 14 LLLLLLLLLLLLLLMMMMMMMMMM
 15 LLLLLLLLLLLLLLMMMMMMMMMM
 16 LLLLLLLLLLLLLLMMMMMMMMMM
 17 LLLLLLLLLLLLLLMMMMMMMMMM
```

**Three things are NOT derived from the constants and must move by hand:**

| Where | Today | Why |
|---|---|---|
| `HALL_MIN_CELLS = 9` | → **36** | a cell is a quarter of the area it was |
| `buildYardSpur` cell literals (`7 * ZONE_CELL_H`, `9 * ZONE_CELL_W`, `11 * ZONE_CELL_W`) | rewritten | P6 replaces this function outright |
| `randomPointInZone` pad `m = 40` | keep | 200 − 80 and 150 − 80 are both still positive |

`zoneGridDist` divides by `ZONE_CELL_W`, but it only ever **orders** spawn candidates
(`cands.push({d})`), never compares against a threshold, so a uniform scale change is harmless.
Checked both call sites.

Subsumed by this grid: **P2** (Cold Storage is a true H — rows 0–5, cols 6–13, with a four-cell
waist at rows 2–3 whose notches open into the Spillway and the Kennels), **P3** (the Kennels' tail
at rows 6–7 severs Yard ↔ Blockhouse, so the Yard is ring 2 and the rocket costs 10,350 instead of
8,750) and **P11** (the one-cell peninsula does not exist in the new paint).

## 2. P4 / P5 — stock

- **SMG moves from THE YARD to THE SLUICE YARD.** East/west guns go 3:1 → 2:2, and the Sluice Yard
  stops being 15.7% of the map with nothing in it until the last sixty seconds.
- **PUMP HOUSE gains one perk station**, the only sector that had none while still selling a gun.
  Totals go 8 → 9 stations; `CARD_ALWAYS` (OVERDRIVE in Turbine Hall) is untouched.

## 3. P7 — floor tints

Re-solved for perceptual separation under a fixed dark band (L\* 18–34, chroma ≤ 22, hue family
within 32°): min adjacent ΔE **5.5 → 23.2**, mean **16.9 → 32.1**, adjacent pairs under ΔE 12
**5 → 0**, L\* range **7.5 → 16.0**.

The solver greyed the Spillway to `#2C2C2C` because at very low chroma the hue lock stops meaning
anything. **Hand-set that one** and re-measure rather than shipping the solver's answer.

## 4. P10 — density per cell

`SECTORS[].buildings` is a flat count, so the same number lands in a 5-cell sector and an 18-cell
one. Replace with `bpc` (buildings per cell) and derive the count. Targets keep Cold Storage's
warren and roughly double the Spillway, which is the emptiest ground in the game at 0.17/cell.

## 5. P6 — the rail spur, Kennels → Yard → Motor Pool

The contradiction this fixes: the Kennels' rail cars and the Motor Pool's flatcars share artwork
so the spur "visibly runs between them", and **the two sectors are not adjacent**. On the new paint
the Yard sits between them, which is correct — a gantry crane exists to move containers between a
rail head and a stack, so the Yard is the natural middle of the line.

One continuous run of track across all three sectors, drawn as one line, with the crane straddling
it. Track is floor (`ballast`), rolling stock is solid.

## 6. P12 — the `threshold` floor layer

A fourth treatment beside interior / exterior / unique: a short worn patch across every door and
window opening. It marks openings without a HUD, reads as wear where everything walks, and it is
the one place two sectors' floors meet and currently just abut.

## 7. P8 — per-sector wall treatment

Nine floors, one wall — and the wall is the surface you actually look at down a corridor with a
340px light radius. Give each sector a wall body and cap colour from its own floor family.

## 8. P9 — landmark sightlines

`addLandmark` currently takes any spot that fits. Prefer one with clear line of sight to at least
one of the sector's own door openings, so the height ladder (crane 16 → bus 5) becomes navigation
rather than decoration. Keep the existing escalating-pad fallback: **a sector without its landmark
is much better than a landmark on the endgame**, and that rule already cost one bug.

## Verification

Per `CLAUDE.md`: all four checkers, plus the parse-every-script pass added on 2026-09-20 after a
duplicate `const` took down `zombie-game.js` while `check-undefined-globals` passed.

Sweeps to re-run (these are the numbers the guide quotes, so they must be re-measured, not
assumed): guns/stations/doors/landmarks per map, nothing in the wrong sector, every sector
reachable by door and by zombie, nav reachability with doors open and barricades broken, hall ends
at exactly 140px, containers per map in the Yard.
