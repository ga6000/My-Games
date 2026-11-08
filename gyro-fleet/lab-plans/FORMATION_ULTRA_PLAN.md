# gyro-lab — formation flying fix, formation hyperdrive, orbit-on-arrival, ultradrive

Written 2026-09-11 before editing, per root `CLAUDE.md`. Request, in substance:

1. **Fix formation flying.** After a right-click order or `O`, several followers spiral
   erratically or blast around in high-speed circles and never settle into the delta.
2. **Hyperdrive while flying in formation.**
3. **Right-click a planet** → the formation goes there and, on arrival, orbits it.
   **Right-click open space** → go there and hold formation until told otherwise.
4. **A formation reaching a planet breaks formation**; every ship orbits it, evenly spaced.
5. **Ultradrive** — solo-flown ship only. 10 s charge with visual + audio cues: an ∞
   pattern 10× the ship's width traced behind the ship, glowing brighter, with a glowing
   sphere right behind it; star lines warp along the direction of flight from 1× to 100×
   during the charge and stay warped during the drive. During the drive: a massive thick
   blue beam left behind and the screen rumbles. Speed starts at 100× hyperdrive speed and
   builds to 1000× over 5 minutes.
6. **Dust bits** left briefly at the spot an ultradrive launches from.

## 1. Why formations break (diagnosis from the code)

- **The follower burst is open-loop.** More than `followerBurstDist` (900) from its slot,
  a follower fires `autoBurst × 2` = **6 s** at a fixed `hyperThrust × base` = 30
  units/frame (the user's defaults: autoBurst 3, cooldown 0). That's ~10,800 units of
  travel aimed at a point 900 away, still turning at 0.12/frame — it overshoots and
  circles at hyperdrive speed. This is the "blasting around in circles".
- **Nothing brakes on arrival.** The seek is `min(1.2·base, 0.02·d)` added on top of the
  leader's velocity, with no notion of the SLOT's own velocity. The slot swings when
  the formation heading turns (loitering, turning to the target), and the follower is
  always chasing where the slot was. So it spirals.
- **The heading at order time is the leader's current velocity**, which may point away
  from the target. The V then swings through up to 180° while the leader turns, and
  the back rows sweep the widest arc.
- **Slots are indices into `followers`**, and slot k's side is `k % 2`. A death or a
  leave shifts every later follower one index, so **every ship behind it swaps sides**.
- **Orbit groups under the user's autopilot defaults**: the leader bursts about 96% of
  the time at 30 units/frame. A delta slaved to that can't hold.

## 2. Fix — follower as an arrival controller

`glFollowerHeading(s, g, dt)`:
- Slot velocity from a finite difference of the slot position (smoothed, and replaced by
  the leader's velocity if the slot jumps because of hazard clearance). This is the
  **feed-forward** term: in slot, desired velocity ≈ slot velocity.
- Correction toward the slot: `min(cap, kP·d)` — proportional, so it brakes by itself.
- Cap: 1.8× base normally. It rises to hyperdrive speed only when far behind
  (`followerBurstDist`) or when the leader is itself burning. It's a speed *limit*, not a
  fixed burn, and it raises authority (`boost`) instead of setting `hyperActive`. Followers
  no longer fire timed bursts at all (the escape rule still can).
- Separation kept, with its total push capped.
- **Stable slot assignment**: greedy nearest-ship-to-slot, front slots first, run at
  command time and again whenever the follower set changes.
- **Formation heading at order time = direction to the target.**
- **Leader waits** (0.55× instead of 0.85×) while mean slot error > 2.5 spacings.

## 3. Formation hyperdrive (E mode)

`SPACE` in E charges (lab time, same `hyperChargeCap`); on release, every **leader of a
move group that holds a selected ship** burns for `charge/cap × hyperMaxBurn`. Followers
match through the raised cap. A leader cuts its burn once inside braking range of the
target, so it doesn't overshoot. Before this, SPACE did nothing in E.

## 4. Targets and arrival

- Right-click picks a body (hole, star or planet) when the click is on it or within ~30 px
  of its surface. Then `cmd = {type:"move", body}`, and the target tracks the moving body
  every frame.
- Open-space right-click is unchanged: go there, loiter in formation, indefinitely.
- **Arrival** (leader within 1.5 formation radii of the cleared target point) → the group
  dissolves into a **ring orbit**.
- **`O` on several ships** also makes a ring orbit, around the body nearest the
  selection, instead of the delta-around-an-orbiting-leader. The delta orbit is the case
  that spiralled, and one orbit behaviour is simpler than two. The `"orbit"` group type is
  removed; nothing creates it any more.

**Ring orbit:** every ship gets its own auto-orbit lock on the body at a shared altitude,
`max(300, 0.6·r_s, n·1.5·spacing/2π − r_s)`, or for `O` the selection's mean current
altitude if that is higher. One shared rotation sense. Each frame, each ship's phase error
against its evenly spaced slot (ring reference = circular mean) scales its speed 0.5–1.6×.
**Ring bursts grip, they don't sprint:** in a ring of 2 or more, a burst raises authority but
caps speed at 1.5× the ring speed. A 30-units/frame burst would lap the ring and destroy the
spacing. Solo auto-orbit keeps the user's tuned burst exactly as it is.

## 5–6. Ultradrive — new file `gl-ultra.js` (loads after gl-sim, before gl-lens)

- `U` (Q mode, flown ship not in a formation): tap to start charging, tap again to abort.
  At full charge it launches. Tap during the drive to drop out. Switching to E, dying or
  respawning cancels.
- Charge runs on **lab time** (the request says 10 s; the hyperdrive's ship-time charge
  would make it longer in a well). Starting a charge disengages auto-orbit so the mouse
  aims the launch.
- Speed = `base·hyperThrust·start·(peak/start)^(t/ramp)` — exponential, so the relative
  acceleration is constant: 3,000 → 30,000 units/frame over 300 s. All tunable in a new
  **Ultradrive** panel group.
- During the drive the ship is outside the sim: no gravity, no dilation (τ = 1), no
  collisions, no escape rule. At 30,000 units/frame nothing can be sampled honestly
  anyway, and the chunk streamer **does not load** around it. At peak it crosses about
  a chunk every 2 frames, and with 5 s unload hysteresis it would pile up hundreds of
  loaded chunks. On drop-out: force-load the chunks there, push the ship clear of
  every hazard, and carry hyperdrive speed out.
- Arena wall → forced drop-out.
- Visuals: ∞ (lemniscate of Bernoulli, 10× hull width) behind the ship, traced by a
  bright head with a fading trail, brightness ∝ charge; glowing sphere behind the ship;
  star streaks along the flight direction, warp 1→`ultraWarpMax`, eased back after
  drop-out. The star parallax becomes an **accumulated offset with a per-frame cap**,
  because at 0.05 × 30,000 units/frame the old camera-derived offset jumps 1,500 px a
  frame across a 6,000 px wrapping patch and strobes. At normal speeds it's identical. Blue
  beam: a trail of world points drawn as layered additive strokes in constant screen width
  (clipped per segment), fading after drop-out. Rumble: CSS translate on the canvas —
  it doesn't touch the lens maths.
- Audio (WebAudio, synthesised, no files): a charge hum rising in pitch and filter with
  a speeding tremolo, a countdown tick each second (higher for the last three), a launch
  boom (noise sweep + sub drop), a looped rumble during the drive, and a whoosh on
  drop-out. It suspends with pause.
- Dust: about 70 slow particles at the launch point that fade over about 2.5 s (new
  optional per-particle `decay`/`size`).

## Verify

Headless (glSimulate loop in page), before vs after: 7-ship move order from a spread start
— follower peak speed, % frames burning, mean slot error after 30 s. Planet right-click →
ring of 7, alive, phase error, altitude band. `O` ring around the home hole, alive. E-mode
hyperdrive: formation arrives intact. Ultradrive: 10 s charge, launch speed 3,000, speed
at t = 150 s ≈ 9,487, drop-out clear of hazards, chunk count bounded. Screenshots of the
charge, warp and beam. Then the four checkers and doc-sync.

## Status — implemented 2026-09-11

The numbers are in `gyro-lab/CLAUDE.md` ("Formation fix, ring orbits…"). Everything above
was built as written, apart from these deviations:
- **Speed checked at t = 100 s, not 150 s** (6,464 against 6,463). At the default ramp the
  ship reaches the ±40M wall at ~130 s along an axis, so the 150 s run measured a forced
  drop-out instead. That **world-size-versus-ramp mismatch is flagged**; the wall drop-out
  itself works.
- **The engine plume now scales with commanded speed.** This came out of measuring ring
  bursts: they're lit ~91% of the time, and with the old full-length plume a gripping ring
  would have looked exactly like the old blasting.
- **Audio is verified structurally only.** The graph builds and the context runs; nobody has
  listened to it yet.
- **Not in the plan: the move leader's stall rule was fixed as well.** A screenshot showed a
  leader burning on an open-space move. "3% closer in 2 s" was 3% of the *remaining*
  distance, so any far target read as a stall at cruise: the leader burned 21.8% of a 60 s
  move and towed followers to 33 units/frame. It's now "under 30% of expected progress":
  0% burning, followers peak at 7.3. The well case the rule exists for is still 6/6 alive.
- **Not in the plan: the ∞ glow is a halo pass, not `shadowBlur`.** Measured at 74.4 ms a
  frame with `shadowBlur`, 3.1 ms without.
- **Not in the plan: a body target's velocity is fed forward to the move leader.** Once the
  stall rule stopped firing spuriously, a leader cruising at 0.55–0.85× chased a planet
  moving at ~1.2 units/frame. One run failed to arrive within 120 s (it didn't reproduce).
  With the feed-forward, three world times arrive in 30–50 s.

> **Superseded later on 2026-09-11** (`GALAXY_PLAN.md`). A few things in this plan no longer
> hold:
> - **The ultradrive's speed** is derived from a 100-minute galaxy crossing (1.72 → 17.2
>   ly/s), not 100× → 1000× hyperdrive speed.
> - **The formation hyperdrive's SPACE charge** became Shift+wheel gears.
> - **The world-too-small flag** is resolved: the world is now the Milky Way.
>
> Every ship-scale number here is in old lab units: divide lengths and speeds by 18.
