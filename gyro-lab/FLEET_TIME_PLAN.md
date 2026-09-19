# gyro-lab — Time dilation, fleet (Q/E modes), number inputs, ship scale

Written 2026-09-10 before editing, per root `CLAUDE.md`. Request, in substance:

1. Number inputs that can go **beyond slider limits**.
2. **Time dilation**: a per-ship time coefficient from proximity to bodies **and their
   mass**. Near a horizon: gravity, movement, animation and autopilot all slow, orbit still
   holdable; floor **1/100x**. In a cosmic void: up to **2x**.
3. **Q mode** = direct control of the last ship touched (as before). **E mode** = spawn
   several ships, left-drag box-select (by centroid), `O` and right-click "go here" command
   all selected; commanded ships fly as **boids** and self-organise into a **delta**.
4. **Ship scale**: must shrink with zoom (it doesn't — the ≥0.5 clamp from the big-holes
   pass, not the vector change).
5. **Ship velocity vector always on**, constant on-screen size at any zoom.

## 1. Number inputs

Each slider row gets a number box. Typing sets `GLP.v` directly, unclamped; the slider
clamps only its own display. A per-def `floor` guards the handful of values below which
code breaks (r_s, influence ×, size unit, ring cap, lens step, reach, probe count,
dilation floor). `glSyncPanelFromParams` writes the true value to the box.

## 2. Time dilation

Potential-like sum over holes, mass-weighted:  `u = Σ (r_s,i · massX_i) / r_i`.
`r_s` already carries mass (Schwarzschild r_s ∝ M); `massX` is the hole's mass relative to
its size rule, so a heavier-than-rule hole dilates further out. With massX = 1, u = 1
exactly at the horizon for a lone hole — the right place for time to stop.

    τ_grav = (1 − u)^(k/2)                 k = "dilation power" (2 → τ = altitude / r)
    τ_void = 1 + (voidMax − 1)·e^(−u/uVoid) far from everything → voidMax
    τ      = clamp(τ_grav · τ_void, dilationMin, voidMax)     defaults 0.01 … 2

k = 1 is the real Schwarzschild factor, but it only bites within ~0.01 r_s of the horizon;
k = 2 (default) gives a noticeable slowdown at a few hundred units of altitude.

**Application — the key decision.** Each ship gets `dtShip = dt · τ(ship)` and *everything
about that ship* runs on it: the gravity integration **and** the movement (so the path is
the same, only traversed slower — which is what keeps an orbit holdable), turning, control
authority (per-frame lerps become `1 − (1 − a)^τ`), hyperdrive charge and burn timers,
autopilot integral, burst cooldown (on a per-ship clock, not the wall clock), engine
animation. Probes, asteroids, bullets and particles get their own τ at their own position
(toggle) so the world near a horizon slows consistently.

Charge/burst timing currently reads `performance.now()` — the wall clock — which time
dilation cannot touch. Those move to per-ship accumulated ship-time.

## 3. Fleet

`glShips[]` replaces the singleton. Hyperdrive state and the autopilot lock move onto each
ship. `glShip` survives as a `let` pointing at the **controlled** ship (Q mode's "last
touched"), because most of its call sites mean exactly that — the same trick as `glHole`.

- **Q**: as before, for the controlled ship; camera follows it. Taking direct control of a
  ship removes it from its group.
- **E**: camera stops following; arrows pan. `F` spawns a ship at the cursor; panel button
  spawns 5. Left-drag = box select by centroid (shift adds); click = pick nearest / clear.
  `O` toggles auto-orbit on the selection; right-click = go here. Camera follows the
  selection's centroid (toggle with C).
- **Formation**: a command to >1 ship forms a group. Leader = the first selected; followers
  take delta slots (row n, alternating sides, spacing ~6 hulls), rotated to the leader's
  smoothed heading. Each follower's desired velocity = seek(slot) + separation (boids) +
  alignment; speed 0.3×–1.8× base to close on its slot; a hyperdrive burst if more than
  ~800 units behind. Move: leader seeks the target, then loiters in a circle around it.
  Orbit: leader auto-orbits with its own lock; followers hold slots relative to it.

  > **Superseded 2026-09-11** (`FORMATION_ULTRA_PLAN.md`). "A hyperdrive burst if more than
  > ~800 units behind" is what made followers overshoot and circle at hyperdrive speed.
  > Followers now use a slot-velocity arrival controller under a speed limit. The orbit
  > formation became an evenly spaced ring orbit.
- Non-controlled ships that die are removed; the controlled ship respawns.

## 4–5. Ship draw

Hull strictly world-scale again. Velocity vector drawn as a screen-space overlay after the
lens pass: constant-pixel arrow (length from speed, capped) plus a hot dot at the true
position, for every ship, so a ship too small to see at 0.01 zoom is still findable.
Selection brackets, the drag box and command markers live in the same overlay.

## Verify

Number box beyond limits persists and survives preset/selection sync. τ: horizon ~0.01,
void ~2, mass dependence, orbit held under dilation with the same path. Fleet: box select,
O / right-click on a group, formation error over time, separation (no overlaps). Hull
scales with zoom. Checkers, doc-sync.

## Status — implemented 2026-09-10, all checks passed

Numbers in `gyro-lab/CLAUDE.md` ("Time dilation, the fleet…"). Headlines: τ 0.01 at the
horizon, 0.25 at altitude 300, 1.69 at the arena corner; an orbit under τ 0.25 holds the
identical band (252–334 vs 251–333) and sweeps 0.243x the angle; a 7-ship move group settles
to 49 mean slot error at 110 spacing; a 7-ship orbit group, 7/7 alive after 60 s.

**Deviations from this plan:**
- The void boost only reaches the full 2x as u → 0. With one hole in the arena the far
  corner reads 1.69. `voidReach` tunes it; not changed, because clamping it to hit 2x
  earlier would make "void" start inside other holes' long-range potential.
- Separation is a steering force, not a collision: ships came within 31 units of each
  other during form-up (hull ~32 long). There is no ship-ship collision to prevent, so this
  was left as is.
- SPACE is Q-mode only: in E there is no single flown ship for a charge to belong to.
