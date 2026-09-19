# RD Arena — network-field rendering (step 0 of MP_ROLLOUT)

Written 2026-09-07. Lands the field parameters chosen in `rd-arena-bench/rd-curves.html`
against the local sim, with **no netcode**. `MP_ROLLOUT.md` steps 1–4 are still unbuilt; this
is the thing that goes in front of them so the visual question is settled before the wire is.

## What was chosen in the lab

| Lab control | Value | Note |
|---|---|---|
| Renderer | Overlapping discs (shipping game) | **contour path rejected** — RD Arena keeps its per-cell renderer, which since 2026-09-05 is `fillRect` raster (`AESTHETIC_GUIDE.md` §6.4), not the discs the lab's label still says |
| Edge smoothing / iso threshold | raw polyline / 0.30 | smoothing is contour-only, so it is moot; 0.30 is already this game's threshold |
| Network resolution | 133² | 36.09 world px per cell vs the sim's 12 |
| Bits per cell | 2 | 4 levels, so there *are* sub-cell values — the reason 133² is not just a coarser 1-bit mask |
| Update interval | 1.0 s | 4.32 KB/packet, 30.2 KB/s host-up at 8 players, 4.52× cheaper than the planned 400² 1-bit |
| Morph | field-space lerp, overshoot easing | duration locked to the interval |
| Squelch | warp amplitude **0** | domain warp off. Threshold breathing kept at 0.002 |

Warp at 0 with breathing at 0.002 is close to nothing, deliberately: the raster skin is a
1978 pixel grid and a wobbling domain warp fights it. Both are render-only and stay tunable.

## Why this supersedes MP_ROLLOUT §2 step 4

`MP_ROLLOUT.md` §2 step 4 (2026-09-03) budgets a **400² 1-bit** solidity mask, 20,000 bytes
every 2–3 s. That is superseded as of 2026-09-07: 133² × 2 bit at 1 s is 4,423 bytes, arrives
**twice as often**, and carries four levels instead of two — which is what makes the
between-packet lerp produce motion rather than a snap. The old passage is left in place; its
reasoning about *what* to send (solidity only, never the floats) still holds.

§3's resync-pop mitigations are unaffected and still apply when the wire lands.

## What this actually changes in the game

`rd-netfield.js` (new, loads after `rd-field.js`, before `rd-boot.js`) keeps two 133²
snapshots and repacks locally on the same 1 s cadence a host would. `rd-boot.js`'s flesh pass
reads `RDNET.sample()` instead of `gridB` directly when `RDNET.enabled`.

**Collision, LOS and the flow field are untouched.** They still read raw 400² `gridB` through
`isSolid` / `isFlesh`. That is the same separation §6.4 protected and the same one the lab's
squelch note relies on: nothing here has to be agreed between clients.

Consequence worth knowing before playtesting: the walls you *see* are now up to one second
stale and one 36 px cell coarse relative to the walls you *collide with*. That mismatch is
the whole point of looking at it locally first — if it is unplayable single-player it will not
improve with a network under it.

**F9 toggles it**, so A/B is within one session on one field, per §1. Neither F9 nor the
dev panel's `L`+`G` collide with this game's `keys` map (`wasdeqrf`, space, `123`).
