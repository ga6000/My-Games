# gyro-lab — Escape bursts, scope gaps, star systems, 8-bit mini-map

Written 2026-09-10 before editing, per root `CLAUDE.md`.

## 1. The reported bug: group-commanded ships cannot burst out of a well

No code path lets an AI-driven ship use the hyperdrive against gravity:

| ship role | bursts before this fix |
|---|---|
| auto-orbit (incl. orbit-group leader) | yes — altitude bursts |
| group follower | only when far from its **slot** — and the slot falls with the leader |
| move-group leader | **never** |
| idle / loitering fleet ship | **never** |

Cruise thrust is 0.12 authority × speed 3 ≈ 0.36/frame², against a 0.585 peak pull. Without a
burst, a group that enters a well cannot leave it.

**Fix — one rule for every AI-driven ship** (everything except the directly flown ship and
auto-orbit ships, which already manage themselves): each frame, for every hole and body whose
well it is in, estimate **time to impact** from altitude and relative radial velocity. If it is
under `escapeTime` (default 5 s), or the ship is already skimming the surface, override the
heading to outward-with-a-tangential-lean and fire a burst (no charge, `autoCooldown`).

## 2. The same class of gap, found by audit

1. **Idle ships never burst** — covered by the rule above.
2. **Move-group slots can sit inside a horizon** — the clamp only existed for orbit groups.
   All slots are now pushed clear of every horizon and surface.
3. **A move target inside or near a horizon** — the leader loiters on a circle crossing it.
   The target is pushed clear, re-evaluated every frame because planets move.
4. **`F` can spawn a ship inside a horizon** — spawn points are pushed clear.
5. **A move leader can stall** — heading at the target while gravity drags it backwards,
   forever. Every 2 s of ship time, if the distance fell by less than 3%, it bursts toward the
   target.
6. **Idle home points** can lie in a well or in a planet's path — loiter centres are cleared
   every frame.
7. *Flagged, not changed:* auto-orbit engaged **outside every well** (true at boot now, since
   auto-orbit defaults on and the spawn is outside the hole's influence) holds an "orbit"
   around empty space and burns the drive continuously. "Lock the current altitude" is the
   user's rule, so it is left.

## 3. Star systems

Two stars, 10 planets each, seeded (mulberry32) so they are identical on every load. Planets
ride **fixed circular orbits** (on rails; no mutual gravity). Stars and planets pull and block
**small objects only** — ships, asteroids, bullets, probes, particles — with a bounded arcade
ramp normalised so the pull at the surface is exactly the body's `peak` (star 0.5, planets
~0.12–0.32). Surfaces are solid (toggle). They add mild time dilation (they are cosmic bodies,
per the dilation request): u gains `dilK·radius/r`, star 0.12, planet 0.05. Auto-orbit locks the
nearest body by **surface** distance, and matches a moving planet's velocity (feed-forward).
Planet orbital speeds stay below ship cruise speed so a planet can be orbited.

## 4. Mini-map

128×128 low-res canvas, drawn at 2× with smoothing off for crisp 8-bit pixels, and a restricted
palette. It shows the whole ±40,000 arena, holes (downsampled discs plus a dotted influence
ring), star systems (dotted orbits, planet pixels, star crosses with names in a hand-drawn
3×5 pixel font), ships (fleet, selected, and the flown ship blinking), and the camera view
rectangle. It redraws at 15 Hz. Toggle with `M` / the checkbox.

## Verify

Escape: a group move across a well and a group falling into one, deaths with the rule on vs
off. Gaps: slot and target clearance, spawn clearance. Bodies: orbits advance, pull, crash,
dilation, auto-orbit on a planet. Mini-map renders; toggling works. Cost. Checkers, doc-sync.

## Status — implemented 2026-09-10, all checks passed

Results in `gyro-lab/CLAUDE.md` ("Escape bursts, scope gaps, star systems, 8-bit mini-map").
Headlines: move group 4/6 → 6/6 alive, and the leader now reaches its target; orbit group
2/6 → 6/6; a move ordered onto a hole's centre, 5/5 alive; auto-orbit on moving planet
VESPER IV held altitude 298 against a lock of 299. Simulate step 0.83 ms with 6 ships and 22
bodies; mini-map 0.42 ms per render.

**One deviation:** the idle-ship scenario did not reproduce a loss with the escape rule off
(6/6 both ways). Gap 6's loiter-centre clearing, which is on in both runs, was already
enough there. The escape rule is still what saves idle ships whose home a planet sweeps
through; that case wasn't separately measured.
