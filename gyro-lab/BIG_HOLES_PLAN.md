# gyro-lab — Big holes, approach lensing, altitude-hold autopilot

Written 2026-09-10 before editing, per root `CLAUDE.md` ("for anything nontrivial, write the
plan to a markdown file before editing"). Request, verbatim in substance:

1. Black holes much bigger by default: **min 10x, avg 50x, a minority up to 200x.**
   "Consider the implications of this when simulating."
2. Influence range scales with size.
3. Stronger radial lensing as the ship approaches a hole.
4. Auto-orbit holds the **same distance from the horizon** using short hyperdrive bursts,
   **no charge required**, and the **target cannot change** while engaged.

## Assumption that most needs confirming

**"10x / 50x / 200x" is read as multiples of the ship's size (18 world units)**, giving
r_s = 180 / 900 / 3,600. Reasons: the ship is the natural size reference in a game; the
average then comes out 4.5x the current tuned r_s of 200 ("much much bigger"); and the
largest still fits a sane arena. Reading it as multiples of the *current* hole (r_s 200)
gives an average r_s of 10,000 and a maximum of 40,000 — larger than the whole ±16,000
arena. Either reading stays reachable: the base is a **Size unit** slider.

## Implications, and what each one forces

| Implication | Consequence if ignored | Decision |
|---|---|---|
| Arcade pull is `6·M/R²`. Keep M and grow R 25x, pull drops 600x | Big holes are toothless | Mass follows size. **Feel rule** (default): `M = K·R²`, K from the user's tuning (154000 / 1090²), so peak pull is the same at every size and only the *extent* grows. **Physical rule** (toggle): `M ∝ r_s`, as Schwarzschild says — big holes get *gentler* near the horizon, which is the real-universe result. Anchored so both agree at the 50x average. Per-hole slider becomes **Mass × size rule**. |
| Influence must scale | Stated requirement | `wellRadius = r_s × Influence ×` (global, default 5.45 = the user's 1090/200). Derived, not stored, so resizing a hole resizes its well. |
| Largest hole: r_s 3,600, influence ~19,600 | Doesn't fit ±16,000 | Arena to **±40,000**. |
| Lens radius and Einstein radius are in **screen px** | A 900-r_s hole at zoom 0.3 has a 270px horizon; the tuned 335px lens barely clears it, and at zoom 1 the lens would be *inside* the black disc — no lensing at all | Both become **multiples of r_s** (global): `lensReach` (1.675 = 335/200), `einsteinX` (1.5 = 300/200). They then scale per hole automatically, which also removes the per-hole Einstein slider. |
| Screen-space lens radius can now be thousands of px | Ring count = R/step → thousands of clipped drawImage calls per frame | Clip R to the farthest visible screen corner, cap rings at 160 (step grows to fit). *(2026-09-10: not enough — at ~0.45 ms per ring, GPU-synced, 160 rings is 75 ms. Cap is now a slider, default 40, and method 7 (vector) avoids rings entirely. See `CLAUDE.md`, "Lens cost, measured honestly".)* |
| At zoom 1 near a 900-r_s hole the screen is all horizon | Unplayable, can't see the ship against anything | **Auto-zoom** (default on): frame the ship and the nearest horizon edge. Zoom floor 0.25 → 0.01. Wheel switches auto-zoom off. Ship drawn at ≥0.5 scale so it doesn't vanish at 0.02 zoom. |
| Ship respawns at (0,600); asteroids seed within 4,000 of origin | Both land inside a 900-r_s horizon — instant death / a 14-per-frame respawn churn | Safe spawn pushes out of every well; asteroid spawns reject points inside any horizon. |
| Probes seed at circular speed for their radius | Speeds grow with well size (v = √(a·r)) | Accepted; that *is* the physics. |
| Autopilot target was `autoTargetR × r_s`, error relative to target radius | At r_s 900 a 200-unit altitude error is 3% — never triggers a burst while the ship is losing half its altitude | Error is measured relative to **altitude** (floor 60). |
| Hover deep in a big well | Cruise authority 0.12 × speed 3 = 0.36/frame², arcade peak ≈ 0.78 — cannot hover without the drive | This is exactly why bursts are needed. Bursts: short (0.35s), 0.5s cooldown, no charge. |

## Autopilot changes

- On engage: **lock** the nearest hole and the current **altitude** (r − r_s, floored at a
  safe margin). Neither changes while engaged — not the nearest-hole switch, not `Tab`, not
  `N`. Disengages if its hole is removed.
- Target radius = hole's *current* r_s + locked altitude, so the ship holds distance from
  the horizon even if r_s is changed live.
- Bursts ignite the drive directly (never touch charge state); remove `autoTargetR`.

## Approach lensing

Proximity `p = clamp(1 − altitude / (wellRadius − r_s), 0, 1)` of the ship to each hole;
lens strength × `(1 + approachStrength·p²)`, lens reach × `(1 + approachReach·p²)`. Squared
so it stays subtle until you are genuinely close.

## New buttons

- **+ Add black hole** samples a size from the distribution (not a copy any more).
- **Generate field**: 6 holes, sizes from the distribution, influences non-overlapping.

## Verify

Size sampler: min/mean/max and share above 90x over 10,000 draws. Arcade peak pull constant
across sizes under the feel rule. Autopilot holds altitude for small/average/large holes.
Lens ms with a huge hole on screen. Checkers + doc-sync.

## Status — implemented 2026-09-10, all checks passed

Results are recorded in `gyro-lab/CLAUDE.md` (section "Big holes, approach lensing,
altitude-hold autopilot"). In short: distribution mean 50.8x, min 10.0, max 199.8, 8.8%
above 90x; feel-rule peak pull 0.585 at all three sizes; altitude hold within 0.1–0.3% at
10x/50x/200x (−3.9% worst case, 200x at altitude 3,000), no deaths; lock held against a
closer hole and `Tab`, and disengaged on removal.

**One deviation from this plan:** the preferred preset's lens reach is 2.5 × r_s, not the
1.675 the pixel ratio gives — at 1.675 the lens reads as a halo hugging a screen-filling
horizon. Flagged in `gl-params.js`; one slider to undo.
