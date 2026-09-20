# gyro-lab/ — Gravity & Lensing Lab

**Local playtest build. Not on the hub, not multiplayer, not shipped.**
Double-click `gravity-lab.html`. It runs over `file://` with no server, like everything
else in this repo.

Created 2026-09-08 as a breakaway from `gyro-space/` to answer two questions before any
of this touches the real game:

1. **Which gravity model should a black hole in Gyro Space use?** Five are implemented.
2. **Which screen-space lensing method is worth its frame cost?** Seven are implemented
   (six at first; method 7, vector, added 2026-09-10 and now the recommendation).

It is a **bench, not a game** — there is no score, no room code, no Firebase (audio
arrived 2026-09-11/12, synthesised: gl-audio.js, gl-ultra.js),
no death-on-border. Ship, asteroids and bullets exist only because a gravity model has to
be judged against the thing you actually steer.

## Relationship to gyro-space/

It is a **breakaway, not a fork**. Nothing here is loaded by `space-tracer.html` and
nothing there is loaded by this page. Every top-level name in this build is prefixed
`gl`/`GL`, so the two share no globals and `check-global-collisions.js` stays quiet even
though both define a ship, a camera and a starfield.

What was carried over deliberately: the hull geometry, camera-follows-ship, the
mouse-steer + `SPACE` hold-to-charge feel (the dash itself is now a hyperdrive — see
below), and the asteroid shape generator — because a
gravity well has to be judged with the parent game's handling, not generic handling.
What was dropped: multiplayer, scoring, trails-as-hazard, the 50,000-star field (6,000
here — method 6 touches every star every frame, so the count is a real cost).

## Files

| File | Holds |
|---|---|
| `gl-params.js` | Every slider definition, the live values (`GLP.v`), and the presets. Add a parameter here and its control appears by itself. |
| `gl-core.js` | Canvas, the offscreen scene buffer, camera, the ship model (`glShips`, `glShip` = controlled), mode/drag/pan state, holes, starfield, asteroids, bullets, probes. |
| `gl-gravity.js` | The five gravity models and the one shared integrator. |
| `gl-sim.js` | Per-frame updates, per-entity gravity opt-in, time dilation per entity, per-ship autopilot, fleet groups/boids/delta, ring orbits, formation hyperdrive, Q/E modes, camera. |
| `gl-ultra.js` | *(2026-09-11)* The ultradrive: charge/launch/drive/drop-out state, its draw (∞, sphere, beam, warp stars), the screen rumble, the HUD line, and all of the lab's audio (WebAudio, synthesised). Loads after gl-sim. |
| `gl-audio.js` | *(2026-09-12)* The one AudioContext: ambient bed, engine by gear, gear-shift and autopilot lock-on cues, pause/suspend. Unlocked on the first key or click. Loads after gl-ultra. |
| `gl-lens.js` | The seven lensing methods (1–5 raster, 6–7 forward/vector), `glForwardLens`, and the compositor. |
| `gl-draw.js` | The render: three lens stages plus the screen-space overlay (stage 4, 2026-09-10). |
| `gl-ui.js` | Panel generation and the HUD. |
| `gl-bodies.js` | The body model: parent-relative Kepler orbits analytic in real time (`glPlaceBody`), system register/remove, pull/dilation/collision, `glHazards()` + `glClearPoint()` (every hole and body behind one interface), `glNear` (own 4M-unit grid), `glNearestBody`, `glPickBody`. Loads after gl-gravity. |
| `gl-galaxy.js` | *(2026-09-11)* The Milky Way: scale constants (`GL_LY`, `GL_AU`, GM), `GL_WORLD`, the density formula Σ and region names, star classes, the system builder (binaries, planets, moons, belts), real Sol, Sgr A\*, the J2000 clock. Loads after gl-bodies. |
| `gl-chunks.js` | Streaming over the galaxy: 1-ly chunks of Poisson stars from Σ, memoised summaries, load/unload with hysteresis, procedural-hole edit persistence, star names, `glStarsNear`/`glNearestStar`, the debug chunk grid. Loads after gl-galaxy. |
| `gl-minimap.js` | The 8-bit mini-map — PLANET, SYSTEM, LOCAL and GALAXY (the rendered spiral) levels — and its 3×5 pixel font. Loads after gl-draw. |
| `gl-boot.js` | Input, seeding, main loop. Loads last. |

## The render is three lens stages plus an overlay, and the order is load-bearing

1. `glDrawWorld()` — everything lensable, into the **offscreen buffer**.
2. `glComposite()` — buffer → screen, distorted by the selected method.
3. `glDrawHole()` — horizon, photon ring, accretion disc, straight to the screen.
4. `glDrawOverlay()` *(added 2026-09-10)* — screen-space, constant pixel size, never
   lensed: every ship's permanent velocity vector, selection brackets, group move targets,
   star and planet names, the box-select rectangle.
5. `glDrawMinimap()` *(added 2026-09-10, gl-minimap.js)* — the 8-bit map, drawn very last
   so neither the lens nor the overlay can draw over it.
6. `glUltraApplyShake()` *(added 2026-09-11, gl-ultra.js)* — not a draw: a CSS translate of
   the finished canvas for the ultradrive rumble, so the lens maths never sees it.

Stage 3 is separate because canvas drawing is destructive and the lens methods *sample*
what stage 1 drew. If the black disc were in the buffer, every method would smear it
outward into a grey halo. The hole is the one object whose screen position is exactly
known, so it is painted last and undistorted.

## The gravity models

Cycle with `,` and `/`. All five are a single scalar function of radius; direction,
frame-drag swirl, the acceleration cap and the influence-radius cutoff are applied once
for all of them in `glGravityAt()`, so a comparison compares the models and not five
variations of the surrounding bookkeeping.

| Model | Character |
|---|---|
| **Newton** `1/r²` | The control case. No horizon, no capture, slingshots hard. |
| **Plummer** | Softened core, force peaks at `r≈e` and falls to zero at the centre. Forgiving and stable — but nothing can ever be captured. |
| **Paczynski–Wiita** `1/(r-rs)²` | **Recommended.** Newtonian code, GR behaviour: a real ISCO at `3·rs` and real capture inside it. |
| **Schwarzschild** | Adds the leading `1/r⁴` correction. Precesses elliptical orbits — the one relativistic effect visible in the *motion* rather than the optics. |
| **Arcade well** | Bounded ramp reaching zero exactly at the influence radius. Not physical, cannot explode, easiest to balance. |

### The integrator was wrong once — do not undo this

It began as semi-implicit Euler. Under it, a probe launched on an **exactly circular**
orbit at r=300 spiralled into the horizon within 3,000 steps under **every** model,
including Newton and Plummer, which have no capture mechanism at all. That decay was
integrator error being read as physics, and it would have made this bench lie about which
models can hold an orbit.

It is now **velocity Verlet (leapfrog)**, which is symplectic — its energy error
oscillates instead of accumulating. Measured after the change: circular orbits hold to
within **0.1% over 6,000 steps in all five models**. Radius-adaptive substepping is a
separate concern and is still needed, or a body tunnels straight through the hole.

### Verified model signatures (2026-09-08, measured in-page)

These are the behaviours that justify having more than one model, each confirmed
numerically rather than by eye:

- **Apsidal precession**: an eccentric orbit drifts **+15.5°/orbit** under Schwarzschild
  and **−0.3°/orbit** (noise) under Newton.
- **ISCO**: a 2% radial nudge to a circular orbit **inside** `3·rs` under Paczynski–Wiita
  diverges and ejects; the **same** nudge **outside** `3·rs` just oscillates (r 109→119);
  the same nudge at the same radius under Newton is stable (r 66→99). Paczynski–Wiita
  has a marginally stable orbit and Newton does not.

Note that an orbit destabilised inside the ISCO **escapes** here rather than plunging —
the influence-radius cutoff switches gravity off entirely at `wellRadius`, so a body
thrown outward never comes back. That is a gameplay decision, not a physical one, and it
is worth remembering when reading the "ejected" counter.

## The lensing methods

Cycle with `[` and `]`. All six get the finished scene in the buffer and must paint it
onto the screen. Methods 2–5 share the thin-lens equation, the standard weak-lensing
approximation:

```
beta = theta - thetaE^2 / theta
```

`theta` is where you *see* something (screen radius from the hole), `beta` is where it
actually *is*. So to fill screen radius `theta`, sample the buffer at radius `beta`.
`thetaE` is the Einstein radius slider, and it alone sets the apparent size of the effect.

### Measured cost — 1280×800, 320px lens radius, step 2

> **Superseded 2026-09-10 for methods 1–3.** Measured without a GPU flush: the ring and
> sector figures are JS recording time, not drawing time, and understate the real cost
> by an order of magnitude or more. Methods 4–5 read pixels back, which forces a flush,
> so theirs are roughly honest. See "Lens cost, measured honestly" below.

`glLensMs` in the HUD is the lens pass **alone**, deliberately separated from frame time:
a method can look fine at 60fps on an empty screen and still be the entire budget once
there are ships and asteroids in it.

| Method | ms/pass | Verdict |
|---|---|---|
| 0. Off | 0.03 | Control. |
| 1. Concentric rings (heuristic) | **1.4** | The approach from the brief. Cheap, stylised; its `1 + s·(R/r²)` factor is unbounded near the centre so it reads as smearing rather than lensing. |
| 2. Thin-lens rings | **2.9** | **Recommended starting point.** Same ring machinery, physical source radius, produces an actual Einstein ring — for 1.5ms more than the heuristic. |
| 3. Radial sectors | 18.3 | The only ring-family method that can express frame dragging as a visible twist. Expensive for what it adds. |
| 4. Per-pixel ImageData | 29.5 | Correct inner image, and the honest reference. Too slow to ship: ~half a frame budget for one effect. |
| 5. Per-pixel, low-res | **8.1 @ step 3**, 5.2 @ step 4 | Same map as #4 into a `step`-smaller buffer, upscaled by the GPU. **The realistic way to ship per-pixel lensing.** |
| 6. Starfield displacement | 0.01 | Free, unbounded radius — but lenses *only* the starfield. An asteroid crossing the lens stays perfectly straight. |

Method 4's bottleneck turned out **not** to be the JS loop — it was `getImageData` over a
full-resolution 640×640 box. Method 5 downscales with `drawImage` first (GPU) and only
ever reads back the small image, which is where most of its speed comes from. Cost at
step 1 is *worse* than method 4; the whole point of 5 is step ≥ 3.

## The hyperdrive (added 2026-09-08)

> **Superseded 2026-09-11** (see "The Milky Way at real scale"). The player's drive is now
> **Shift+wheel gears**, with no charge and SPACE = gear 0. `hyperMaxBurn`,
> `hyperChargeCap` and `hyperPenalty` are gone. What survives from this section is the
> AI's burst (`hyperThrust`, `hyperAuthority`), and the escape findings below, which
> still hold.

`SPACE` — hold to charge, release to burn. Charge maps linearly onto burn length,
identical in feel to gyro-space's dash, and charging costs you 40% of your speed
(`hyperPenalty`), so spending time on it while falling is a real decision. Defaults: **10x
thrust, 5s max burn, 10s to full charge.** The HUD shows charge, burn remaining, and the
**peak velocity of the burn**, which persists after it ends — whether an escape worked is
something you judge afterwards.

This **replaced** the 3x dash carried over from gyro-space, which could not answer the
question it was carried over for: it does not escape a default well from any depth.

### Thrust alone is not what escapes — read this before tuning

Thrust is a **target velocity the engines lerp toward**, not a force. So 10x thrust at the
standing 0.12 control authority is the same weak engine aimed further away, and deep in a
well gravity removes velocity faster than 12%/frame restores it. The burn therefore also
raises authority (`hyperAuthority`, default 0.55). Measured, ship already falling inward at
10/frame, default Paczynski–Wiita well, 5s burn:

| start | no drive | old 3x dash | 10x @ auth 0.12 | 10x @ auth 0.55 |
|---|---|---|---|---|
| r=300 | died | died | **escaped** | **escaped** |
| r=150 | died | died | died | **escaped** |
| r=80 | died | died | died | **escaped** |

**Caveat worth knowing before you trust that table:** aimed straight out *from rest* at
r=200, everything escapes — including the old 3x dash. Escape is dominated by how deep you
are and how fast you are already falling, far more than by thrust. Test from a fall, not
from a standstill.

### It exposed a horizon bug

At 25x the ship travels **75 world units per frame** against a **52-unit-wide** horizon, so
it could start a frame outside the hole, end outside on the far side, and never be sampled
inside — flying through a black hole unharmed. The horizon test is now a **segment** test
(`glSegmentHitsHorizon`, closest approach of the frame's travel), not a point test. Proven
directly: a 75-unit hop through the centre reports `false` from both endpoint tests and
`true` from the segment test. **Do not simplify this back to a point check** — nothing
except the hyperdrive moves fast enough to reveal it again.

## Baked settings, trajectory lock, whirring engine, shot sound (2026-09-12, later)

**The first locks are baked** — `GL_BAKED` in gl-params.js holds the user's "Copy locked"
list verbatim (40 keys).
- **How it works:** each matching def gets `def = value` and `fixed: true`. The panel skips
  fixed defs, so their sliders and toggles are gone, and a group left empty disappears.
  Saved locks on baked keys are pruned, and those keys aren't lockable any more.
- **Knock-on removals:**
  - both model pickers and **all presets** (`GL_PRESETS`, `glApplyPreset`), since both
    models are baked: **arcade** gravity, **vector** lens (was sectors);
  - the `[ ]` and `, /` model hotkeys;
  - `M`, because the mini-map is baked on.
- **To reopen a value,** delete its line from `GL_BAKED`.
- **Notable baked values** that differ from the earlier defaults:
  - `ultraCrossMin` **10** (was 100) — the ultradrive now peaks at **240 ly/s**;
  - `ultraChargeTime` 15;
  - `ultraShake` 7.5, `ultraVolume` 0.75;
  - ambient 0.6, engine 0.2, cues 0.4.

**Removed at the user's request:**
- **The black-hole panel section:** the roster (pick, add, remove, generate field) and the
  per-hole sliders.
- **The `N` and `Tab` keys.**
- **The Reseed probes button, and `R`.** Probes still top themselves up.
- **Dead code with them:** `glAddRandomHole`, `glGenerateField`, `glRemoveSelectedHole`,
  `glSelectHole`, `glRebuildHoleSelect`, `glUpdateDescriptions`.
- **What's left for holes:** they come from the galaxy — Sgr A\* and stellar holes. The
  `GL_HOLE_KEYS` params still exist; `glPullParamsFromHole` keeps them mirroring the
  selected hole.

**Trajectory lock** — right-click in Q (`glToggleTrajLock`, gl-sim.js):
- **What it holds:** the heading toward the clicked point (`ship.trajLock`). The mouse stops
  steering until a second right-click. Gravity still acts: the heading is held, not the
  path.
- **Interplay:** it takes the ship off auto-orbit, and `O` clears it. It holds through the
  ultradrive — the way to cross the galaxy without holding the mouse still. It's cleared on
  respawn and on switching to E, where right-click means "go here".
- **Cues:** a marching amber dash line to the screen edge, a padlock, and a pulse ring on
  clamp (`glDrawTrajLock`); a thunk plus rising clicks on lock and falling clicks on release
  (`glAudioTrajLock`); a HUD line.

**Shift+↑ / Shift+↓** shift gear like Shift+wheel, with no auto-repeat, and don't pan.

**Engine:** now a turbine **whir**, not "a car" — two sines a hair over an octave apart,
plus a soft third partial, amplitude-modulated by a rotor that spins faster each gear, over
band-passed air. It runs 180 Hz at gear 0 up to 861 Hz at gear 9.

**Shot sound:** `glAudioShot`, a square wave swept 1,500 → 260 Hz, fired from `glFire` —
only for shots actually fired.

**Verified in-page:**
- the panel has no Model, Black holes or Reseed controls; its sections are Ships & modes,
  Autopilot, Time dilation, Fleet, Lensing, Look, Probes, Debug, Session;
- 38 fixed defs; the baked values are live;
- `N`/`Tab`/`R`/`M`/`]`/`,` change nothing;
- Shift+↑↑↓ → gear 2 then 1, with no pan;
- one fire → one shot cue;
- trajectory lock: a real right-click locked at −28° (expected −28°) and switched
  auto-orbit off; the heading held at −28° for 60 frames with the mouse elsewhere; the HUD
  line appeared; a second right-click released it; 2 cues;
- no console errors.

## Audio, panel locks, sharp hull (2026-09-12)

Plan: `AUDIO_LOCKS_PLAN.md`.

**Audio** — new file `gl-audio.js`. It owns the ONE AudioContext; the ultradrive's voices
now plug into it through their own gain.
- **Start and pause:** it starts on the first key or click (`glAudioUnlock`), because
  browsers require a gesture. Pausing suspends it.
- **Ambient:** a brown-noise drone, a slow A1/E2/A2 pad and a faint hiss.
  - The pad **sinks in pitch with the ship's clock τ**, so time dilation is audible.
  - In the **galactic void** it darkens and the hiss opens.
- **Engine by gear:** sawtooth plus square through a resonant lowpass, plus wind noise. Each
  gear is +4 semitones (38 Hz at gear 0, 304 Hz at gear 9) with a brighter filter and more
  wind. Bursts lift it; it's silent in the ultradrive and while dead.
- **Gear shift** (hooked in `glShiftGear`): a click plus a rising or falling chirp. Dropping
  to 0 from above gear 1 plays a power-down sweep.
- **Autopilot lock-on:** a two-note chime when the flown ship gains an auto-orbit lock, and
  three notes when a ring forms. Both are detected as *edges* in `glAudioFrame`, so the sim
  needs no hooks, and a new ring suppresses the solo chime that same frame.
- **Params:** the Audio group — master, ambient, engine and cue volumes, plus Sound on.

Verified in-page:
- nothing is built before a gesture; afterwards the context runs, both beds exist, and the
  ultradrive shares the context;
- 0 cues at start;
- 4 gear changes → exactly 4 shift cues;
- a lock edge → 1 lock-on cue; a ring → 1 ring cue, with no extra lock-on.

The sound itself hasn't been judged by ear.

**Locks** (gl-ui.js). Every slider, checkbox and the two model pickers get a 🔓. Per-hole
keys and auto-orbit are excluded.
- **Clicking it marks the field ready to lock:** the current value is saved in
  `localStorage` (`gyrolab-locks-v1`). The row turns amber, the slider is hidden, and the
  number box, checkbox or picker becomes inert.
- **Locked values win everywhere:** at boot (`glApplyLocks` before the panel builds), after
  Reset All, over presets (skipped), and over hotkeys (M, C, `[ ]`, `, /`, and the wheel's
  auto-zoom off-switch).
- **Session buttons:** **Hide locked (N)** removes the rows (persisted), **Copy locked**
  copies the JSON, and **Copy params** includes `locked`.
- **Next step:** that list is what a later pass bakes into the defaults, deleting those
  params.

Verified: every row control is disabled; a preset, Reset All and the `,` hotkey all left
the locked values alone; the locks survived a reload; hiding sets `display: none`.

**Sharp hull.** `glStrokeHull` line widths are now **screen pixels** (÷ zoom), and it has a
faint fill.
- **The cause of the "fuzzy ship":** the widths were world units inside the zoom-scaled
  transform. That was right for the old 18-unit hull near zoom 1. The 1-unit hull (GL_S)
  is seen at zoom 8–400, where the 4-unit glow became a 32–1,600 px haze over the shape.
- **Verified:** a crisp outline at zoom 200.

## The Milky Way at real scale (2026-09-11, later)

Plan: `GALAXY_PLAN.md`. **This supersedes the world, the drives' speeds and several
constants described in every section below.** The main markers are placed there. Where a
number below is in old lab units, divide lengths and speeds by 18 (see `GL_S`).

User decisions (asked):
- ship **not to scale**;
- real **Sol** at home, **Sgr A\*** at the core, **binaries**, **moons**;
- stellar black holes **enlarged at their real count**;
- hyperdrive on **Shift+wheel gears**.

**Scale.** 1 world unit = 1,000 km. Earth is 12.7 units wide, the Sun 1,391, 1 AU =
149,598, 1 ly = 9.46e9.
- **The origin is the Sun,** so home has full float precision. The galactic centre
  (Sgr A\*, true r_s 12,250) is at (0, −26,000 ly). A float64 step there is 0.03 units;
  at the far rim, 0.125.
- **The world** (`GL_WORLD`, now in gl-galaxy.js, split into minX/maxX/minY/maxY) is the
  centre ± 55,000 ly.

**The ship shrank, and everything ship-scale with it: `GL_S = 1/18`** (gl-params.js).
- The 18-unit hull would have been bigger than Earth, so it's now 1 unit (1,000 km), still
  ~10⁴× true.
- Scaled by the same factor:
  - cruise (0.167 units/frame = 10,000 km/s), bullets, probes, particles;
  - formation spacing, catch-up distance, loiter radius and clearances;
  - the autopilot minimum altitude and the ring altitude;
  - the escape velocity threshold, softening and the acceleration cap;
  - `GL_MASS_K`, and the peak pull of stars and planets;
  - `sizeUnit`, so holes are 10–200 units.
- Time is unchanged, so every dimensionless ratio the lab was tuned on survives — the
  regression runs below confirm it. **Real astronomical sizes are never multiplied by
  `GL_S`.**

**Galaxy density Σ(x, y)** (`glGalaxyShape` / `glGalaxyDensity`, gl-galaxy.js), in stars
per ly²:
- **Disk:** exponential, scale length 8,500 ly, tapering at 48,000.
- **Arms:** four log-spiral arms at 12° pitch, as one m = 4 pattern. They're phased so
  that on the Sun's azimuth Perseus sits at 32,500 ly and the others follow at the ×1.396
  ratio. Major arms (Perseus, Scutum–Centaurus) are 1.0, minor ones 0.6. Gaussian
  σ 1,200 ly across the arm.
- **Orion spur:** through the Sun.
- **Bar and bulge:** at 27° to the Sun–centre line.
- **Nucleus:** `20·e^(−R/200)`.
- **Normalised** so Sol's neighbourhood is **0.025 /ly²** (mean spacing ~6.3 ly). That's
  the real local 3D density taken to the ⅔ power, so nearest-star distances are real.

**Contents** — seeded, and analytic in time:
- **Chunks** are 1 ly, each holding Poisson(Σ) stars, capped at 12 per chunk in the core.
- **Star classes** are M/K/G/F/A/B/O plus white dwarfs and giants, with real radius, mass
  and colour ranges.
- **1 stellar object in 1,000** is a black hole.
- **Binaries** follow per-class fractions and ride their barycentre. Under 5 AU apart the
  planets are circumbinary; wider, they orbit star A inside a third of the separation.
- **Planets** follow the Kepler-statistics means, with a snow-line split into rocky,
  super-Earth, ice giant and gas giant.
- **Moons, and a belt in 25% of systems.**
- **Every orbit is circular Kepler with a real period,** at angle₀ + 2π·t/P. t = real
  seconds since J2000 at page load, plus lab time. A system unloaded and revisited is
  exactly where the clock says; rebuilding the same star gave 0 difference.
- **Sol:** 8 real planets on real a and P, placed at their **J2000 mean longitudes**, so
  they sit where they are today. Plus 12 major moons (Triton retrograde), the main belt
  and the Kuiper belt. Pinned.
- **Belt rocks** are enlarged, 0.2–0.8 units, on rails. The free-drifting asteroids and the
  `gravAst` toggle are gone.

**Streaming and queries** (gl-chunks.js, gl-bodies.js):
- **Summaries** carry position, class, name and seed. Systems are built only when their
  chunk loads.
- **`glNear`** has its own 4M-unit grid, with every well capped under a cell. A 3×3-chunk
  query would have handed each probe ~2,000 core bodies.
- **`glStarsNear` / `glNearestStar`** feed the mini-map and the nav arrows.

**Drives:**
- **Hyperdrive — gears:** Shift+wheel sets speed = cruise × 10^gear, gears 0–9. SPACE =
  gear 0. The hold-SPACE charge is gone, in Q and in formations. The AI's escape, stall
  and autopilot bursts keep `hyperThrust`. Formation leaders take their group's gear,
  limited near the target so they arrive.

  | gear | speed | 1 AU | 1 ly |
  |---|---|---|---|
  | 0 | 10,000 km/s | 4.2 h | 30 yr |
  | 1 | 100,000 km/s | 25 min | 3 yr |
  | 2 | 3.3c | 150 s | 110 d |
  | 3 | 33c | 15 s | 11 d |
  | 4 | 334c | 1.5 s | 26 h |
  | 5 | 3,340c | 0.15 s | 2.6 h |
  | 6 | 33,400c | — | 16 min |
  | 7 | 0.0106 ly/s | — | 95 s |
  | 8 | 0.106 ly/s | — | 9.5 s |
  | 9 | 1.06 ly/s | — | 0.95 s |

- **Ultradrive:** peak speed is derived from `ultraCrossMin` — a 100,000-ly rim-to-rim
  crossing in 100 min, ramp included — giving **1.72 → 17.2 ly/s**. Gear 9 meets its start.
  `ultraStartX`/`ultraPeakX` are gone.

**Views:**
- **Zoom** runs 1e-10 (~100 ly across) to 400. Zoomed out past the loaded range, the main
  view draws **summary stars** as class-coloured points.
- **Nav arrows** on the screen edge point at the nearest star (from summaries) and the
  nearest planet, with distances.
- **The mini-map has four levels** (wheel over it): PLANET 2 AU, SYSTEM 100 AU, LOCAL 25 ly
  (points plus a nearest-7 list), and **GALAXY** — the density formula rendered once as
  the spiral, with SGR A, SOL and you.
- **The HUD** shows the gear and speed in real units, region/arm, distance from the core,
  local density, the date, and altitude above the nearest body.
- **Auto-zoom** frames the nearest body — with the body included for planets and stars.

Measured headless:
- **Galaxy shape:**
  - arm peaks along the Sun's azimuth at 13,000 (Norma, reported "inter-arm" there because
    it is still fading in from the bar), 16,700, 23,300, 32,500 and 45,200 ly;
  - density 11.9 /ly² at 50 ly from the core (capped per chunk), 0.123 on Scutum–Centaurus,
    0.025 at Sol, 0.009 inter-arm vs 0.019 on Perseus, 0.0026 at 45,000 ly;
  - total **2.6 × 10⁸ stars**.
- **Sol:**
  - Earth's and Jupiter's longitudes equal today's real mean longitudes to 0.01°;
  - Moon at 384,400 km, Earth at 29.78 km/s, Earth's period 365.256 d.
- **Proportions** over 321 systems near Sol:
  - class mix M 74.5%, K 11.2%, G 5.9%, F 4.7%, WD 2.5%, giant 1.2%;
  - 1.65 planets per star; 80% of stars have planets; 0.41 moons per planet;
  - 28% binaries, 27% with belts;
  - black holes 927 in 874,704 (0.106%).
- **Drives:**
  - ultradrive crossing, integrated: **100.0 min**;
  - after 20 random drop-outs the nearest star was a median **4.5 ly** away (max 25) —
    **42 s at gear 8**.
- **Load at the nucleus:**
  - 95 systems, 328 bodies and 3,020 belt rocks;
  - load 12.5 ms, a sim step 2.9 ms;
  - `glNear` against brute force: difference 0.
- **Earlier behaviour at the new scale:**
  - solo auto-orbit of Earth held 47.71 locked altitude exactly;
  - gear 3 gave 166.67 units/frame (exact);
  - 7-ship formation move: formed at 7.6 s, slot error mean 0.10 / max 1.9 spacings, leader
    0% burning;
  - right-click Earth: ring of 7 at 22.7 s, altitude 16.3–16.8 against 16.67, phase ≤10°,
    7/7 alive;
  - escape from a 50-unit hole: 6/6 alive;
  - ultradrive: 1.719 ly/s at launch, 17.9 ly in 10 s, dropped out clean.

**Flagged, not changed:**
1. ~~**The void time boost applies nearly everywhere.**~~ **Resolved 2026-09-11 (user's
   call): "void" now means the sparse galaxy.** A planet's share of `u` is ~0.006 at
   real size, so "far from every body" had been true almost everywhere — ×1.87 beside
   Earth.
   - **The fix:** the boost is also multiplied by `glGalaxyVoid` (gl-galaxy.js). That's
     1 between the arms and beyond the disk, and 0 on an arm, the Orion spur or the bar and
     bulge, with smoothstep edges on arm strength and cached per 0.5 ly.
   - **Toggle:** `voidGalactic`, default on; off restores the old everywhere-void.
   - **Measured τ:**
     - beside Earth ×1.03 (off: ×1.87);
     - on the Scutum–Centaurus, Sagittarius, Perseus and Outer arms, and in the bulge:
       ×1.00;
     - inter-arm at 20k, 29k and 38.5k ly, and beyond the disk: ×2.00;
     - near Sgr A\* (alt 300): 0.024, still dilated.
   - **Coverage:** 66.5% of the disk between 11k and 48k ly counts as void.
   - **Cost:** ~1.3 µs per `glTimeFactor` call.
2. **Formations stretch at high gears.** A 0.3-unit-scale spacing can't be held at 10⁴+
   units a frame; they re-form on slowing.
3. **The core is capped** at 12 stars per ly² chunk (the real nucleus is far denser).
4. **A flat slice holds ~10⁸ stars, not 10¹¹.** Spacing was kept real, not total count.
5. **Precision at the far rim** is 0.125 units — visible jitter only at zoom ≳ 50 out
   there.

## Formation fix, ring orbits, formation hyperdrive, ultradrive (2026-09-11)

Plan: `FORMATION_ULTRA_PLAN.md`. **Parts of the fleet description in "Time dilation, the
fleet…" below are superseded by this section.** They're marked there.

**The reported bug: followers spiralled, or blasted round in high-speed circles, and never
settled into the delta.** Three causes:
- **The catch-up burst was open-loop.** More than `followerBurstDist` (900) from its slot, a
  follower fired `autoBurst × 2` at the full 30 units/frame. At the user's defaults that's
  6 s. It overshot by thousands of units, then circled back at hyperdrive speed.
- **The seek didn't know the slot moves.** It was the leader's velocity plus a capped pull,
  so whenever the V turned, a follower chased where its slot had been — the spiral.
- **Orbit groups under the default autopilot.** The leader burst ~96% of the time at 30
  units/frame, and a delta slaved to that couldn't hold.

**Fixes:**
- **Each follower is an arrival controller** (`glFollowerHeading`). Desired velocity is:
  - the slot's own velocity — a finite difference, smoothed, falling back to the leader's
    when hazard clearance makes the slot jump;
  - plus 2.5% of the gap per frame toward the slot;
  - plus capped separation.

  Speed is a **limit**, not a fixed burn. It's 1.8× cruise normally, and rises to
  hyperdrive speed only when more than `followerBurstDist` behind or while the leader
  burns. Above 1.8× the ship gets hyperdrive authority and a plume (`boost`). Followers no
  longer fire timed bursts; the escape rule still can.
- **Stable slots** (`glAssignSlots`): greedy nearest ship to each slot, front slots first,
  re-run whenever the follower set changes. Before this, one death shifted every later
  follower by one index — and `k % 2` is the side, so each of them swapped wings.
- **The V faces the target from the moment of the order.** It used to face the leader's
  current velocity.
- **The leader waits for its formation.** It runs at 0.55× instead of 0.85× while mean slot
  error is over 2.5 spacings.
- **The move leader's stall rule was firing at plain cruise.** This predates today's work,
  and it turned up in a screenshot. The rule asked whether the distance to target had
  shrunk by 3% in 2 s — 3% of the *remaining* distance. So every target beyond ~10,000
  counted as a stall (0.85× covers ~306 units in 2 s; 3% of 14,000 is 420). The leader then
  burst at 30 units/frame every few seconds, towing its formation into hyperdrive catch-up.
  A stall is now covering under 30% of what the leader's own speed should have covered.

**Right-click targets:**
- **On a body** — a hole, star or planet, or within 30 px of its surface (`glPickBody`). The
  order follows the body. On arrival (the leader within 1.5 formation radii of the cleared
  target) the group becomes a **ring orbit**. The leader feeds the body's velocity forward,
  as the autopilot does, so it closes at its own cruise speed however the planet moves.
- **Open space** — unchanged: go there and loiter in formation indefinitely.
- The marker is a dashed ring round a body target, and a cross for a point.

**Ring orbit** (`glRingOrbit`, `glUpdateRings`):
- **Lock:** each ship gets its own auto-orbit lock on the body, at one shared altitude
  `max(300, 0.6·r_s, n·1.5·spacing/2π − r_s)`.
- **One sense:** the whole ring flies the same direction round.
- **Spacing:** each ship's phase error against its evenly spaced slot scales its speed
  0.5–1.6×. The reference phase is the ring's circular mean, so there's no leader to lose.
- **`O` on several ships now makes a ring** round the body nearest their centroid, at their
  mean current altitude. The `"orbit"` group type is gone.
- **Ring bursts grip, they don't sprint.** In a ring of 2 or more, a burst raises authority
  but caps speed at 1.5× the ring speed. The default burst is lit ~90% of the time, and at
  full thrust a ship laps the ring. Solo auto-orbit keeps its full burst, untouched.
- **The plume** now follows the speed actually commanded, so a grip burst doesn't look like
  a sprint.

**Formation hyperdrive** — `SPACE` in E. Hold to charge (lab time, `hyperChargeCap`). On
release, every leader of a move group holding a selected ship burns for `charge/cap ×
hyperMaxBurn`. Followers keep up through their raised speed limit. A leader cuts its burn
once inside braking range of the target.

> **Superseded later on 2026-09-11:** the charge is gone. Formations now take a **gear**
> (Shift+wheel in E; SPACE = gear 0). The leader's geared speed is limited near the target,
> so it arrives rather than overshoots.

Measured headless — the same scripts before and after, 7 ships, defaults:

| scenario | before | after |
|---|---|---|
| move order from a ~3,000-unit spread: slot error, last 20 s of 60 (mean / max) | 37 / 225 | **1 / 2** (formed at 5.8 s) |
| same: follower top speed | 27.7 (a 6 s open burn) | 29.3 (braked catch-up from ~2,700 behind, proportional to the gap) |
| formed-up move to a point 32,000 away: leader burning / follower top speed | 21.8% (4 stall bursts) / 33.3 | **0%** / **7.3** |
| six ships already falling into the hole's well, ordered to the far side, 40 s | 6/6 alive, leader holding at target (2026-09-10 measurement) | 6/6 alive, closest pass 157 above the horizon, 0 stall bursts; leader still 1,037 short of target (it now waits for the formation, and doesn't burst) |
| `O` at altitude 900 over the home hole: top speed | 25.4, burning 95.6% of frames | **3.5**, 7/7 alive |
| same: ring phase error / altitude band, last 20 s | — | ≤26° at 60 s, **≤2° at 120 s** / 879–916 vs 900 |
| right-click VESPER IV (r 233, moving 1.15/frame) from ~8,000 away | — | arrived in **30–50 s** over three world times (110/160/300 s); ring of 7 at alt 300, band 272–331, phase ≤7°, 7/7 alive. One run *before* the body-velocity feed-forward, at an unrecorded world time, failed to arrive within 120 s; it didn't reproduce afterwards. |
| formation hyperdrive: 10 s charge → 5 s burn | SPACE did nothing in E | leader 30, followers ≤31; formation error mean 15 / max 91 during the burn (spacing 110), 0 twenty seconds later; 7/7 alive |

**Ultradrive** — new file `gl-ultra.js`. `U` in Q mode, for the flown ship, solo only (not
in a formation). Tap to charge, tap again to abort or drop out. Switching to E, or losing
the ship, ends it.
- **Charge:** 10 s of **lab** time (`ultraChargeTime`). The hyperdrive's ship-time charge
  would stretch it inside a well. Starting a charge takes the ship off auto-orbit, so the
  mouse aims the launch.
- **Charge cues, visual:**
  - an ∞ (lemniscate of Bernoulli) 10× the hull's width behind the ship, traced by a head
    that speeds up and glows as the charge builds;
  - a glowing sphere right behind the hull;
  - star streaks along the flight direction, warping 1→100× (squared over the charge, so it
    starts subtle);
  - a shudder over the last 30%.
- **Charge cues, audio:** a hum rising in pitch and filter, and a countdown blip each second
  (higher for the last three).
- **Launch:** a noise-sweep and sub-drop boom, a shockwave ring, and **70 dust bits at the
  launch point** that fade over ~2.5 s.
- **Speed:** hyperdrive speed × `ultraStartX`·(peak/start)^(t/`ultraRampTime`). That's
  exponential: 100× → 1000× over 5 min, i.e. 3,000 → 30,000 units/frame. The mouse
  steers, slowly.
- **Beam:** thick and blue, four additive layers at constant screen width. Segments are
  clipped with Liang–Barsky, because old points sit millions of px off-screen.
- **Rumble:** a CSS translate on the canvas after the frame is drawn, plus a looped
  brown-noise and sub-sine rumble that builds with the ramp.
- **The ship is outside the simulation during the drive:** no gravity, no dilation (τ = 1),
  no collisions, no escape rule. **The streamer loads nothing around it.** At peak it
  crosses a chunk every two frames, and with ~5 s unload hysteresis it would pile up
  hundreds of loaded chunks.
- **Drop-out:** chunks are force-loaded at the new spot and the ship is pushed clear of every
  hazard. It carries hyperdrive speed out and bleeds back to cruise. Beam and warp fade over
  ~2.5 s.
- **Audio:** WebAudio, synthesised, no files, so file:// is unaffected. The context is
  created only from the U keypress, and suspends with pause. **This is the lab's first
  audio.** The graph builds and the context runs; the sound itself has not been judged by
  ear.
- **The star parallax changed to suit it.** It's now an offset accumulated from camera motion
  and capped at 45 px/frame (`glStarOff`). At 0.05 × 30,000 units/frame, the old
  camera-derived offset jumped 1,500 px a frame across a 6,000 px wrapping patch and
  strobed. Below the cap it moves exactly as before.

Measured:
- **Charge:** still charging at 9.98 s, launched by 10.03 s; warp 25.7× at 5 s.
- **Speed:** 3,001/frame at launch; **6,464** at 100 s against 6,463 predicted, after
  27.1M units covered.
- **Chunks:** never more than **9** loaded during the drive.
- **Drop-out:** `U` dropped out at 30/frame, clear of every body, back to cruise 3.0 within
  2 s.
- **Draw cost** (world pass, GPU-synced, 333×833 pane): normal 1.1–1.5 ms. The ∞ costs
  **3.1 ms**; its first version used `shadowBlur` and cost **74.4 ms** — a Gaussian per
  stroke, 36 strokes a frame. It's now a wide faint pass under the bright core. The warp
  stars cost 2.0 ms and the beam 1.8 ms; a full-charge frame with warp is 3.6 ms.

> **Resolved later on 2026-09-11:** the world is now the galaxy. The speed is derived from
> a 100-minute rim-to-rim crossing (1.72 → 17.2 ly/s), replacing `ultraStartX`/`ultraPeakX`.
> The speed figures in this section are pre-galaxy.

**Flagged, not changed — the world is too small for the ramp.** At the default ramp, flying
from the origin along an axis reaches the ±40M wall in **~130 s** (~160 s diagonally). So
the 5-minute peak is unreachable, and at peak the whole world is ~2.7 s across. The wall
ends the drive cleanly: a forced drop-out, with the ship pulled 1,000 inside. But a bigger
or wrapping world, or a slower ramp, is a design decision, not a bug fix. `ultraRampTime`
and `ultraStartX` are on the panel.

**New params** (the Ultradrive group): charge time, start ×, peak ×, time to peak, warp
max, rumble px, volume.

## 1000× chunked, procedural world + two-range mini-map (2026-09-10)

> **Superseded 2026-09-11** (see "The Milky Way at real scale"). What changed:
> - **The world** is the galaxy, not ±40M.
> - **Chunks** are 1 ly holding Poisson stars, not 60,000 units with one feature.
> - **The home sector is gone:** no origin hole, VESPER, HALCYON or asteroid field. Sol
>   replaced it.
> - **The mini-map** has four levels.
> - **`glNear`** uses its own grid.
>
> The architecture described here — "the global arrays hold what is loaded", memoised
> summaries, hysteresis, hole-edit persistence — is unchanged.

Plan: `CHUNKS_PLAN.md`. The world is **±40,000,000**. The old ±40,000 arena is now the
hand-made **home sector** (origin hole, VESPER, HALCYON, the asteroid field). It is pinned —
never unloaded — so every earlier measurement in this file still describes something that
exists. Everything beyond it is generated on demand by `gl-chunks.js`.

**The core decision.** `glHoles`, `glBodies`, `glStarSystems` and `glAsteroids` are still the
arrays every system loops over, but they now hold only what is **loaded**. The streamer pushes
a chunk's content in on load and splices it out on unload. Gravity, dilation, hazards,
autopilot, lensing and the mini-map needed almost no changes.

**Chunks** — 60,000 across:
- **Size:** at least the largest single reach (a 200× hole's influence ~19,600; a system
  ~17,000).
- **Content:** one feature per chunk (30% hole, 20% star system with 4–10 planets and a
  generated name, 50% empty), inset by its reach so it **never crosses a border**, plus 3–7
  asteroids.
- **Determinism:** everything comes from `hash(worldSeed, cx, cy)`. A memoised **summary**
  (kind, position fraction, size, name, colour — no geometry) is what the max-range map
  reads.
- **Loading:** the chunks around the focus (radius 1–3, from zoom) **plus a 3×3 block around
  every live ship**, so a fleet ship far from the camera still falls into holes that are
  really there. Chunks unload after ~5 s unwanted (hysteresis). The streamer runs every 10th
  frame.
- **Persistence:** an edited or removed procedural hole remembers it by id across
  unload/reload. Planets are analytic in time, so a system reloaded later has its planets
  where they would be *now*. Asteroids regenerate fresh.

**Spatial query `glNear(x, y)`** (gl-bodies.js) — added after measuring. With 10 fleet ships
spread over 99 chunks (25 holes, 276 bodies, 513 asteroids) a simulate step took **21.9 ms**,
because every object still looped over every *loaded* body. Now gravity, horizons, surfaces,
dilation, the escape rule and point clearance read only the point's chunk and the 8 around
it — **2.84 ms** on the identical scene.
- **Exact for gravity, horizons and surfaces:** no reach exceeds a chunk. Verified at 3,000
  points against brute force: gravity diff **0**, horizon mismatches **0**, surface mismatches
  **0**.
- **Time dilation is cut at the 3×3 by design.** It differs from brute force by 0.20 mean /
  0.55 max. That's the *old* behaviour being wrong: brute force summed every loaded body, so a
  point's clock rate depended on how many chunks happened to be loaded. Spreading the fleet
  loaded more distant bodies and quietly cancelled the void speed-up everywhere. Chunk-local,
  it depends only on position.

**What else had to change at 1000×:**
- **Starfield** tiles (`glStarWrap`); it had been a fixed ±3,000 parallax patch, gone past
  ~60,000.
- **Position sliders** re-centre ±36,000 on the selected hole. With a fixed range, touching one
  on a far hole would have teleported it.
- **Generate field** is confined to the home sector.
- **Probes** seed only at holes near the focus and are culled outside the loaded range.
- **The hazard list** is cached per frame, with getters, so it stays live.
- **Reset All** also clears the streamed world and its remembered edits.

**Measured:** 0 of 991 generated features within their reach of a chunk edge; kinds over
2,000 chunks 31% hole / 19% system / 50% empty; identical summaries on regeneration; a jump
1.4M out generated 9 chunks in 2.8 ms and unloaded the old ones after the hysteresis; an
edited hole (mass ×3.25, spin −0.8) came back identical and in place; a system reloaded
after 10 simulated minutes had its planets exactly where world time puts them; 151 stars on
screen at 1.35M out. No regressions: the group-escape scenario 6/6, and the home-hole
auto-orbit holds 299 against 300.

**Mini-map, two ranges.** Scroll **down** over the map for max range, **up** for close.
It's direction-based, not a toggle, because a trackpad sends a burst of wheel events per
gesture.
- **Close:** 240,000 units around the focus, with the chunk grid (loaded chunks and the home
  sector tinted), holes downsampled, systems with orbits and names, ships, the view
  rectangle, and the current chunk.
- **Max:** radius `mmMaxRange` (1.5M; Look group). Every star is **one point** in its own
  colour and every hole a dim point, not downsampled, read from the chunk summaries — so
  unloaded space shows. Below it, the **7 nearest stars with name and distance** and the
  count in range. Measured: 373 stars in range; 6 ms for the first render (summaries being
  built), 1.3 ms after.
- Wheel and clicks over the map never reach the camera or selection. Verified.

**Debug:** "Show chunk grid" draws chunk borders, loaded tint, and each chunk's key and
content. The HUD shows the focus chunk, chunks loaded, bodies, and the streamer's pass cost.

**Not in scope, flagged:** travel. At full hyperdrive one chunk takes ~33 s; the nearest
listed stars are minutes away. The number box lets hyperdrive thrust go past its slider (25)
as a stopgap. Warp or jump gates are a design decision. A one-off 438 ms "lens" reading in
one screenshot didn't reproduce: at that view no lens was on screen and every method
measured ~0.7 ms. It looked like a first-render stall after a large chunk load in the hidden
pane.

> **Partly superseded 2026-09-11:** the ultradrive (`U`; see "Formation fix, ring orbits,
> formation hyperdrive, ultradrive") is the travel answer for now, at 3,000 → 30,000
> units/frame. It in turn shows the ±40M world is only about 2 minutes across at the default
> ramp.

## Escape bursts, scope gaps, star systems, 8-bit mini-map (2026-09-10)

> **Partly superseded 2026-09-11.** The escape rule and the five gaps still hold, their
> distances now ×`GL_S`. **The star systems described here are gone:** no more VESPER,
> HALCYON, 3,000–14,500-unit orbits or 1.5-units/frame planets. Systems are real-scale,
> procedural or the real Sol, with Kepler periods in real time (see "The Milky Way at
> real scale").

Plan: `STARS_MAP_PLAN.md`.

**The reported bug: group-commanded ships could not burst out of a well.** No AI code path
fired the hyperdrive against gravity:
- followers burst only when far from their *slot*, and the slot falls with the leader;
- move leaders and idle ships never burst;
- only auto-orbit ships did altitude bursts.

Cruise thrust (≈0.36/frame²) is below a hole's 0.585 peak pull, so a group that entered a
well could not leave. **Fix — the escape rule** (`glDangerFor` / `glEscapeHeading`):

- **Who it applies to:** every ship that is neither flown directly nor on auto-orbit.
- **What it checks:** time to impact against every horizon and surface, from altitude and
  radial velocity *relative to the body*.
- **What it does:** under `escapeTime` (5 s), or when skimming, the ship turns
  outward-with-a-tangential-lean and bursts. No charge needed; it respects `autoCooldown`.

Measured, six ships already falling into the hole's well, 40 s, rule off (old behaviour) vs on:

| scenario | off | on |
|---|---|---|
| group move to the far side | **4/6** alive, leader 8,814 from target | **6/6**, leader holding at target |
| orbit group | **2/6** | **6/6** |
| idle ships | 6/6 | 6/6 |

Idle ships already survived with the rule off, because of gap 5 below (loiter centres now
cleared).

**The same class of gap, found by audit and fixed:**
1. Formation slots for **move** groups could sit inside a horizon — the clamp covered only
   orbit groups. All slots are now pushed clear of every hazard (`glClearPoint`).
2. A move target on or near a hole gave the leader a loiter circle crossing the horizon. The
   target is cleared each frame (planets move). Verified: a group ordered onto the hole's
   *centre* — 5/5 alive, never closer than 385 above the horizon.
3. `F` could spawn a ship inside a horizon — spawn points are cleared.
4. A move leader could stall, heading at the target while being dragged backwards. The stall
   rule: every 2 s of ship time, if the distance fell by under 3%, burst toward the target.
   > **Superseded 2026-09-11:** "3%" was of the *remaining* distance, so any target beyond
   > ~10,000 read as a stall at plain cruise, and the leader burst every few seconds. It is
   > now "covered under 30% of what its own speed should have". See "Formation fix, ring
   > orbits…".
5. Idle home points could lie in a well or a planet's path — loiter centres are cleared each
   frame.

*Flagged, not changed:* auto-orbit engaged **outside every well** — true at boot now, since
auto-orbit defaults on and the spawn is outside the hole's influence — holds an "orbit" around
empty space and burns the drive continuously. "Lock the current altitude" is the user's rule.

**Star systems** (`gl-bodies.js`). VESPER (−22,000, 20,000) and HALCYON (24,000, −21,000),
10 planets each, seeded (mulberry32) so they are identical every load:
- **Orbits:** planets ride fixed circular orbits — on rails, with no mutual gravity. Radii are
  geometric from 3,000 to 14,500; speed follows Kepler-like v ∝ r^−½, 1.5 units/frame
  innermost. That's kept under ship cruise speed so every planet can be caught.
- **Effect on small objects:** stars and planets pull and block ships, asteroids, bullets,
  probes and particles. The pull is a bounded ramp normalised to `peak` at the surface (star
  0.5, planets 0.12–0.32), not a black-hole model. Surfaces are solid (toggle), with a segment
  test so a fast ship can't skip a small planet; the HUD shows "CRASHED into VESPER IV".
- **Time dilation:** they add a mild share — measured τ 0.85 at a star's surface, 0.92 at a
  planet's.
- **Duck-typing:** bodies carry `x, y, rs, wellRadius, spin, vx, vy`, so the autopilot,
  auto-zoom and lock rings work on them unchanged. They are *not* in `glHoles`, so they never
  lens and never count as horizons.
- **One hazard list:** `glHazards()` covers holes and bodies. Escape, clearance and safe spawn
  all read it, so a new kind of body is safe the moment it's added there.
- **Generated holes** keep out of the star systems.

**Auto-orbit now locks the nearest celestial body** by *surface* distance — hole, star or
planet — and feeds a moving planet's velocity forward. Verified on VESPER IV (moving 1.15
units/frame): locked at altitude 299, averaged 298 over the last 20 s of 60 s, alive. The
band (184–396) is wider than around a hole, because a planet's pull is weak and the planet
itself moves.

> **Superseded 2026-09-10:** the single whole-arena view described below mapped ±40,000.
> The world is now ±40,000,000, and the map has close and max ranges. See "1000× chunked,
> procedural world + two-range mini-map". The rendering approach (128×128 at 2×, palette,
> 3×5 font) is unchanged.

**8-bit mini-map** (`gl-minimap.js`, `M`, on by default):
- **Rendering:** a 128×128 canvas drawn at exactly 2× with smoothing off, integer
  `fillRect`s, a restricted palette, and a hand-drawn **3×5 pixel font**.
- **Contents:** holes (dark disc at true scale, magenta rim, dotted influence ring), dotted
  planet orbits and planet pixels, star crosses with names, the camera view rectangle, and
  ships (fleet mint, selected amber, the flown ship a blinking 2×2).
- **Cost:** redrawn at 15 Hz, measured 0.42 ms per render. A whole simulation step with 6
  fleet ships and 22 bodies measured 0.83 ms.

## Radial sectors fixed; the user's settings are now the defaults (2026-09-10)

**Defaults.** The user's exported configuration *is* the default set: arcade gravity, lens
method **3. Radial sectors**, and 17 `def` values in gl-params.js (photon ring 1.55; autopilot
burst 3 s, cooldown 0, trigger 0.02; lens strength 6, falloff 1.4, feather 0.26; disc off and
brightness 0; beaming 0.25; glow 1.55; 160 probes, trail 5, speed 0.3; auto-zoom off;
**auto-orbit on**; force field on). `GL_DEFAULT_GRAVITY` / `GL_DEFAULT_LENS` hold the model
choices. **Reset All returns here.** The old boot preset is gone. The dropdown's "User defaults
(2026-09-10)" is *generated from the defs*, so it can't disagree with them. It skips per-hole
keys, which would resize the selected hole. Verified: at boot and after Reset All (following
a scramble and an added hole), 0 mismatches against the JSON, the export diff is empty, and the
flown ship has auto-orbit on.

Auto-orbit is per ship, and the panel reads its checkbox *from* the flown ship. So boot and
Reset write the default onto `glShip` before the first sync; otherwise the sync would switch
it off. The first view is framed once at boot even with auto-zoom off, because at zoom 1 the
spawn point shows empty space.

**The autopilot at these defaults** holds within **0.1%** (286–305 at altitude 300,
1463–1512 at 1,500, 60 s), tighter than before. But with 3 s bursts, no cooldown and a 2%
trigger, the drive is lit **96% / 87%** of the time. It's a near-continuous burn, not
occasional corrections.

**Why sectors broke below zoom ~0.4.** Each ring's source radius was
`r + (thin-lens shift) × k`, with k = strength/1.8. At the default strength (6, boosted to
~15 on approach) k reaches 8.3, and that throws the source radius **past zero** for most
rings. Those rings were silently skipped. With the ship 800 above the horizon: **all 10**
skipped at zoom 1 and 0.6, so the lens was never drawn there; 7–8 of 11 below that. The few
survivors sat next to the zero crossing and magnified their source up to **31×** (156× at
zoom 0.1). Which rings survived flipped as the approach boost changed, so the lens popped. The
survivors were the *outer* rings, off-screen until the whole lens fits — hence "fine above
0.4, unstable below". Two smaller effects added to it. The float ring loop gave 10 or 11 rings
depending on rounding, so one ring flickered. And every wedge was a full pie slice from the
centre, so each lens pixel was drawn ~N/2 times. That last one was invisible only because most
rings were being skipped.

**Fix, three parts, all in `glLensSectors`:**
1. **Strength as a power:** `srcR = r · q^(k·fade)`, q = β/r. It can't cross zero, it's
   continuous in r, k and fade, it's the identity at k·fade = 0 and exactly the thin lens at
   k = 1. Magnification is clamped at `GL_SECTOR_MAX_MAG` = 12 either way.
2. **Integer ring count**, equal-width bands.
3. **Annular sectors:** each draw clips to its own band, with 0.75 px / 3% overlap so the
   anti-aliased edges show no seams.

Measured, GPU-synced, against reconstructions of the earlier versions:

| | original | power map, pie slices | **final** |
|---|---|---|---|
| lens ms, zoom 0.8 | 2.4 | 4.7 | **3.7** |
| lens ms, zoom 0.3 | 21.1 | 56.2 | **16.0** |
| flyby worst frame / median, zoom 0.8 | 11.6 | — | **4.5** |
| flyby worst frame / median, zoom 0.3 | 3.7 | — | **2.7** |
| ring counts seen in flyby, zoom 0.3 | 10, 11 | — | **10** |

**The look changed.** The inner ~85% of the sectors lens was never drawn before, and that
emptiness was part of what made the method feel balanced. It now lenses all the way to the
horizon. The force-field arrows (on by default) show up as amber streaks where they pass
through the 12× band.

**Not changed, same defect:** method 2 (thin-lens rings) uses the identical linear
`× strength/1.8` shift, so it also skips rings at high strength. Methods 4/5 do it too, but
there a negative β mirrors the sample instead of skipping it. Applying the power mapping to
them is a small change; it wasn't asked for, so it's left.

**Canvas self-heal (found while testing this).** The preview pane collapsed to 0 px
mid-test. The resize handler sized both canvases to 0×0, and when the window came back **no
resize event arrived** (the page was hidden). So the lab stayed at 0×0, and every
`drawImage(glBuffer, …)` threw `InvalidStateError` once per frame out of the rAF loop.
`glRender` now compares the canvas to `innerWidth/innerHeight` each frame and resizes itself,
and skips a genuinely zero-area frame. Verified: forced to 0×0, one render restored
1280×800 with no throw.

## Time dilation, the fleet (Q/E), number boxes, true-scale hulls (2026-09-10)

Plan: `FLEET_TIME_PLAN.md`.

**Number boxes.** Every slider has one, and it is not bound by the slider's range — type 12
into a 0–6 slider and you get 12; the slider parks at its end, the row is outlined amber.
`GL_PARAM_FLOORS` (gl-params.js) stops only values below which code breaks (r_s ≥ 1,
influence × ≥ 1.01, ring cap ≥ 1, …); nothing caps the top. Commits on Enter/blur, not per
keystroke. Verified: 12 persists through a panel sync; a per-hole box (mass ×8) writes
through to the hole; r_s −5 floors to 1.

**Time dilation** (`glTimeFactor`, gl-gravity.js). `u = Σ r_s·massX / r` over every hole —
mass-weighted and multi-body; `τ = clamp((1−u)^(k/2) · voidBoost, min, voidMax)`, void boost
`1 + (voidMax−1)·e^(−u/voidReach)`. k = 2 by default (τ = altitude/r for one hole); k = 1 is the
true Schwarzschild factor and only bites within ~1% of r_s. **Not** cut off at the influence
radius the way the force is — the potential is long-range, so only far from every hole does
the void boost take over. Measured on a 900-r_s hole:

| where | τ |
|---|---|
| altitude 1 / 10 / 60 | 0.01 (floor) / 0.011 / 0.063 |
| altitude 300 / 900 | 0.25 / 0.50 |
| influence edge | 0.84 |
| altitude 20,000 / arena corner | 1.36 / 1.69 |
| alt 300, massX 2 / 0.5 | 0.01 / 0.63 |
| a point 2,000 from one hole → from two | 0.55 → 0.10 |

The void boost reaches 2x only as u → 0; with one hole in the arena the far corner still
reads 1.69. **Void reach** moves where "far" starts.

**How it is applied — the decision that matters.** τ scales a ship's *whole* timestep —
gravity and movement together — so the path is identical and only its speed changes. That
is what keeps an orbit holdable at τ = 0.01; scaling gravity alone would let the ship outrun
its own well. Per-frame blends (turn rate, authority) go through
`glTimeLerpRate = 1 − (1−a)^τ`, because a lerp rate is not linear in time. Hyperdrive charge
and burn, the autopilot's integral, and its **burst cooldown** all run on the ship's own
clock — the charge and cooldown used to read the **wall clock**, which dilation cannot touch.
Engine-plume flicker runs on the ship clock too. Probes, asteroids, bullets and particles
get τ at their own positions (toggle); a probe falling in now visibly slows at the horizon.

Verified — the same autopilot hold at altitude 300, 60 s, dilation off vs on:

| | band | mean alt | ship clock | angle swept | bursts |
|---|---|---|---|---|---|
| off | 251–333 | 300 | 60 s | 2,804° | 67 |
| on (τ 0.25) | 252–334 | 297 | 15 s | 682° | 17 |

Same orbit, run at 0.243x — the swept-angle ratio matches τ.

**Fleet.** `glShips[]` replaced the singleton; hyperdrive state, the autopilot lock,
integral, cooldown and clock all live on each ship. `glShip` is a `let` pointing at the
*controlled* ship ("last ship touched"), the same trick as `glHole`.
- **Q** — direct control, as before; taking the helm pulls the ship out of its group.
- **E** — `F` spawns at the cursor (also in Q); left-drag box-selects **by centroid**
  (shift adds, click picks within 22 px); right-click = go here; `O` orbits the selection
  as one formation; arrows pan; `Esc` deselects. The camera follows the selection.
- A command to several ships forms a **group**: leader + followers in **delta** slots
  (row n, alternating sides, `formationSpacing` apart, rotated to the leader's smoothed
  heading). Followers are **boids**: alignment (the leader's *observed* velocity) + a capped
  seek to the slot (the slot replaces classic cohesion) + separation from every ship within
  0.6 spacings, speed 0.3–1.8x, a hyperdrive burst if more than `followerBurstDist` behind.
  Move: the ship nearest the target leads, then loiters around it. Orbit: the leader
  auto-orbits with its own lock; any slot that would sit too near the horizon is pushed out.

  > **Superseded 2026-09-11** (see "Formation fix, ring orbits…"). What changed:
  > - Followers no longer align to the leader's velocity or fire hyperdrive bursts. They fly
  >   the slot's own velocity plus a proportional pull, under a speed limit.
  > - Slots are assigned nearest-first and reassigned whenever the group changes.
  > - `O` on several ships makes an evenly spaced ring; there are no more orbit groups.
  >
  > The "`O` on the same 7" measurement below describes the old orbit group.
- Fleet ships that die are removed; only the controlled ship respawns.

Verified through the real mouse/key handlers: a box drag selected 7; right-click formed one
group of 1+6. Slot error went from 397 mean / 601 max at the order to **49 / 76** after 40 s
(spacing 110); the leader was holding at the target; the closest any pair came during
form-up was 31 units (hulls are ~32 long). `O` on the same 7 near the hole: an orbit group,
only the leader on auto-orbit; after 60 s **7/7 alive**, slot error ~79, and the formation's
τ spread 0.60–0.67 — the inner wing's clock runs slow, so it stretches. That is the effect,
not a bug. (The leader's altitude at that instant was 10.6% under its lock — a single
end-of-run sample, inside the ±15% wobble band measured for solo holds at that altitude.)

**Ship scale.** Hulls are true scale again. The "never below half size" clamp was added
deliberately in the big-holes pass so a ship stayed visible at 0.02 zoom — not by the vector
lens. It is gone, because every ship now has a **permanent velocity vector** in a
screen-space overlay (stage 4, `glDrawOverlay`): a constant-pixel arrow plus a dot at the
true position, at any zoom. Its length follows *observed* speed (proper × τ), so time
dilation shows as the arrow shrinking even when the hull is a third of a pixel (0.36 px at
zoom 0.02, measured). Ships are exempt from the vector lens so hull and arrow agree.

## Lens cost, measured honestly — and method 7, vector (2026-09-10)

**Read this before trusting any older ms figure in this file.** Canvas 2D *queues* draw
calls for the GPU and returns at once, so a JS timer around `drawImage` measures recording,
not drawing. Every ring-method number below this section (and the HUD, until now) was
recording time only — rings "0.3–1.4 ms" were really **18–95 ms**. The per-pixel methods
were roughly honest, because their `getImageData` forces the GPU to finish. The HUD now
syncs with a 1px readback after each stage (**GPU-synced timing**, Debug, default on) and
shows **world** and **lens** separately.

**Why the raster methods are slow.** Methods 1–5 are raster: they draw the frame into a
buffer and *copy pixels* back out through the lens. Each ring is a near-full-screen masked
`drawImage`. Measured with a GPU flush, **≈0.45 ms per ring, linear** (160 rings 75 ms,
85 → 38, 43 → 18, 22 → 11.5). A bigger hole only changes *how many rings are on screen*
— which is why r_s > 2,500 hurt. The cap is now a slider, **Max rings**, default 40
(was a hardcoded 160).

**Method 7 — vector.** The scene is points and lines, not pixels, so bend each *point*
through the lens as it's projected (`glWorldToScreen`, while `glVecLens` is set during
stage 1) and draw the frame once, already lensed. Cost scales with vertex count, not
screen area. Long lines bend because they're drawn as many short segments (trails, the
arena edge, now subdivided); points that land behind a horizon are dropped and lines lift
their pen across them. Generalises method 6, which did this for stars only; both now share
`glForwardLens()`.

GPU-synced, world + lens ms, altitude 400, auto-zoom:

| r_s | rings (40 cap) | rings (160 cap) | **vector** | lens off |
|---|---|---|---|---|
| 900 | 23.2 | ~56 | **4.6** | 2.9 |
| 2,500 | 8.7 | — | **4.4** | 3.2 |
| 3,600 | 8.0 | — | **6.4** | 2.9 |

Vector with 400 probes × 60-point trails at r_s 2,500: 8.4 ms total frame.

**Two things the first vector version got wrong, both found by screenshot:**
- It used true thin-lens optics. At the preferred strength (6, boosted to ~14 on approach)
  and Einstein radius 1.5 × r_s, that pushes points ~2,000 px outward near a big hole:
  **0 of 168** on-screen stars survived at r_s 2,500. Correct for those numbers, and a
  completely different look from the rings method the user chose. So **Vector/star lens:
  ring-1 curve** (default on) runs the rings method's heuristic curve *in reverse*: that
  method shows radius r from r/d(r), d = 1 + a/r², so forward is the root of
  `r³ − β·r² − β·a = 0` (Newton from β + ∛(β·a), which is provably above the root).
  Round-trip against the raster formula: **error ≤ 1e-13 px**. 102 of 168 stars stay on
  screen. Turn it off for true thin-lens.
- It lensed the ship, for parity with the raster methods (which lens it because it's in
  their buffer). Near a big hole the ship was drawn off-screen. **The ship is exempt from
  the vector lens** — the raster methods still lens it, which is their limitation.

**What vector gives up:** only the primary image (no mirrored inner one); small objects
are moved as a whole, not stretched. Neither is visible at playing speed.

**The remaining frame cost is the photon-ring glow**, ~5.8 ms near a big horizon, because
the glow band covers the screen. Filling only the band instead of the whole disc saved
nothing measurable there (it's the area, not the interior). **Photon ring glow 0** removes
it.

## Big holes, approach lensing, altitude-hold autopilot (2026-09-10)

Plan and full implication table: `BIG_HOLES_PLAN.md`. **Several passages in the next
section are superseded by this one** and are marked so; this section wins where they differ.

**Sizes.** Holes are sized in multiples of a **Size unit** (default 18 = the ship): min
10x, mean ~50x, a minority to 200x — r_s 180 / 900 / 3,600. *This reading of the request
is an assumption*: as multiples of the old tuned hole (r_s 200) the largest would be
40,000, bigger than the arena. The Size unit slider covers either reading. Sampler: 90%
uniform 10–72x, 10% uniform 72–200x. Measured over 10,000 draws: min 10.0, **mean 50.8**,
max 199.8, 8.8% above 90x, 4% above 150x. Boot hole is the 50x average; **+ Add** and `N`
draw from the distribution (they used to copy the selected hole); **Generate field (6)**
places non-overlapping wells.

**Everything tied to the old ~200-unit scale is now derived from size** — each one broke
at some size when left absolute:

| Was | Now | Why it had to change |
|---|---|---|
| Per-hole influence radius | `r_s × influenceX` (global, 5.45 = the tuned 1090/200) | The request: influence scales with size |
| Per-hole absolute GM | `sizeRule(r_s) × massX` per hole | Arcade pull is `6M/R²`: fixed M with 25x R = 600x weaker |
| Lens radius, Einstein radius in px | `lensReach`, `einsteinX` × r_s | A 335px lens sits *inside* the black disc of a 900-r_s hole at zoom 1 |
| Heuristic ring `1 + s·R/r²` | `1 + (s/335)·(R/r)²` | Not scale-invariant: 10x wider lens = 10x weaker. Identical at the tuned 335px |
| Arena ±16,000 | ±40,000 | A 200x hole's well (~19,600) did not fit |
| Zoom floor 0.25 | 0.01 + **auto-zoom** (default on; wheel turns it off) | At zoom 1 near a big hole the screen is all horizon |
| Spawn (0,600); asteroids near origin | Safe spawn outside wells; asteroids reject horizons | Both landed inside the default horizon |
| Probes at `3r_s + rand·well` | Between `1.2r_s` and the well edge | Up to a third sat outside the arcade well, motionless |

**Mass rule** — the main simulation implication. Measured peak arcade pull at the horizon:

| Hole | Feel rule (default, M ∝ R²) | Physical rule (toggle, M ∝ r_s) |
|---|---|---|
| 10x | 0.585 | 2.927 |
| 50x | 0.585 | 0.585 |
| 200x | 0.585 | 0.146 |

The feel rule keeps the tuned pull at every size and grows only the well's *extent*. The
physical rule is what Schwarzschild says (r_s = 2GM/c²): big holes are **gentler** at the
horizon — true of real supermassive holes, and it makes 200x holes the easy ones. Both are
anchored to agree at 50x. Which one plays better is a playtest question.

**Approach lensing.** `p = 1 − altitude/(well − r_s)`; strength and reach scale by
`1 + boost·p²`. Measured on the boot hole: at altitude 4,000, p=0, strength 6, reach
2,250; at altitude 300, p=0.93, strength **13.7**, reach **4,176** (×1.86).

**Lens cost with a big hole on screen** (ms/pass; rings clipped to the far screen corner
and capped at 160):

| | rings | thin-lens | sectors | per-pixel low-res | stars |
|---|---|---|---|---|---|
| alt 300, zoom 0.25 | 0.94 | 0.29 | 0.58 | **18.4** | 0 |
| alt 1500, zoom 0.1 | 0.76 | 0.16 | 4.54 | 6.05 | 0 |

> **Superseded 2026-09-10 — this table and the sentence below it are wrong.** They were
> measured without a GPU flush, so the ring columns are recording time only. GPU-synced,
> rings cost 18–95 ms here, not <1 ms. See "Lens cost, measured honestly" above.

~~Ring methods got *cheaper*: the horizon covers most of the screen and the clipping skips
everything off-screen.~~ **Per-pixel low-res is the one to watch** — its box is now the
whole canvas (this part holds: its readback made it honest, and it measures ~34 ms).

**Autopilot: hold altitude, locked target.** On engage it **locks** the nearest hole and
the ship's current **altitude above the horizon** (floor 60). Neither changes while
engaged: not a closer hole, not `Tab`, not `N`. Removing the locked hole **disengages**
("target removed — disengaged") rather than retargeting. Target radius is the hole's
*current* r_s + locked altitude, so resizing a hole live keeps the ship the same height
above its surface. Error is measured against **altitude** (it was radius — above a 900-r_s
horizon, losing half of a 200-unit altitude was only a 9% radius error, under the burst
trigger). Bursts: 0.35s, 0.5s cooldown, **no charge**, fired only when the error is outside
tolerance and still growing. `autoTargetR` is removed. Measured, 60s runs, mean altitude
over the last 20s:

| Hole | Locked alt | Mean | Band | Error | Bursts/min |
|---|---|---|---|---|---|
| 10x | 300 | 300 | 240–352 | +0.1% | 76 |
| 50x | 300 | 300 | 251–333 | −0.1% | 67 |
| 50x | 800 (moving at 6) | 798 | 679–897 | −0.2% | 33 |
| 50x | 1500 | 1496 | 1274–1719 | −0.3% | 10 |
| 200x | 500 | 499 | 424–554 | −0.1% | 56 |
| 200x | 3000 | 2882 | 2550–3204 | −3.9% | 8 |

No run died. Low altitude costs **many** bursts — cruise authority (0.12 × speed 3 =
0.36/frame²) cannot hover against the 0.585 peak pull, so a low hold *is* a string of
bursts. That is the physics working, not the autopilot failing.

## Multiple black holes, the 10x arena, and auto-orbit (added 2026-09-08/10)

> **Partly superseded 2026-09-10 by the section above.** Still accurate: the roster, the
> selected-hole slider contract, superposition, per-hole cap, the multi-lens overlap
> limitation, and the integral-term finding. Superseded: the per-hole key list (influence,
> mass and Einstein radius are now derived from size), "+ Add copies the selected hole"
> (it now samples a size), the ±16,000 arena and the 4,000 asteroid field, and the whole
> auto-orbit *targeting* description (`autoTargetR × r_s`, "nearest hole", radius-relative
> error). The auto-orbit table below was measured under the old targeting and old defaults.

> **Superseded 2026-09-10:** there is no longer a boot preset or a separate set of generic
> defaults. The user's configuration *is* the defaults, and Reset All returns to it. See
> "Radial sectors fixed; the user's settings are now the defaults".

~~**Boots into the user's tuned configuration** (preset *Preferred (user tuned)*: arcade
gravity, heuristic rings, r_s 200, influence 1090, lens strength 6.0, disc off). **Reset
all** still returns to the generic defaults.~~

**Arena is ±16,000** (was ±1,600). Asteroids no longer spawn across the whole arena —
14 rocks spread over 32,000 units are invisible — they seed within `GL_FIELD_RADIUS`
(4,000) of the origin. Position sliders go to ±9,000, influence to 12,000, r_s to 1,200.

### Holes: one roster, one set of sliders

> **Superseded 2026-09-12:** the roster, the per-hole sliders, Add/Remove/Generate and
> `N`/`Tab` were all removed at the user's request. Holes come from the galaxy. The
> selected-hole mirroring (`GL_HOLE_KEYS`, `glPull/PushParamsToHole`) still exists
> underneath.

`glHoles` is the authority. The **Black holes** panel section picks which hole the
sliders edit. **Per-hole** (marked with a magenta rule in the panel): mass, r_s, photon
ring, influence radius, spin, X, Y, **and Einstein radius** — the optical counterpart of
mass, so two holes of different mass need their own or they lens identically. Everything
else is global. `GL_HOLE_KEYS` in `gl-params.js` is the list; `glPullParamsFromHole` /
`glPushParamsToHole` in `gl-core.js` are the two halves of the contract. **Add** copies
the selected hole two influence-radii to its right; `N` drops one at the cursor; `Tab`
cycles; the last hole cannot be removed.

`glHole` survives as a proxy for the **selected** hole, because most of its call sites
really do mean "the one the sliders point at". Anything that must see *all* holes —
gravity, the horizon tests, the lens pass — iterates `glHoles` and never goes through it.

Verified in-page: editing hole #2's mass via the real slider leaves hole #1 at 154k,
switching back reloads 154k; and with overlapping wells the summed field equals hole A
alone plus hole B alone **exactly** (to 1e-9). Superposition is the whole reason several
holes work at all.

**Per-hole cap, not a total cap** — deliberate. A cap on the sum would let two wells
cancel below the cap and release all at once as you cross between them.

**Known limitation of the buffer-sampling lens methods with several holes:** each hole
gets its own pass sampling the *undistorted* buffer, so where two lenses overlap on
screen the later hole paints over the earlier one instead of compounding. Method 6
(starfield) sums deflections properly. Off-screen holes are culled per hole and cost
nothing.

### Auto-orbit (`O`)

Flies onto a circular orbit around the **nearest** hole, at `autoTargetR × r_s` (clamped
inside 90% of that hole's influence radius — past it there is nothing to orbit against).
It drives the ship's **normal controls** — a heading in place of the mouse, and the same
hyperdrive the player has — so anything it can do, a player can do at these settings. If
it cannot hold an orbit, suspect the tuning, not the pilot.

Heading = tangential (keeps whatever sense of rotation you already have; picks the hole's
spin direction from rest) + radial correction. Hyperdrive bursts fire only when the radius
error is outside `autoTolerance` **and still growing**; bursting against an error that is
already closing just overshoots.

**The first version was biased, and the fix is the `autoIntegral` slider.** With a
proportional term alone it settled **~14% inside** its target from every start: holding
an orbit against gravity needs a *constant* outward push, and a P term only pushes when
there is error, so it parks where that error balances the well. That 14% sat under the
30% burst threshold, so it never corrected either. An integral term (with anti-windup
clamp, only integrating within ±50% of target, reset when the nearest hole changes)
learns the push. Measured, arcade well, target r=981, mean radius over the last 20s of a
60s run:

| start | I = 0 (old) | I = 0.8 (default) |
|---|---|---|
| r=3000 from rest | — | 975 (0.6%) |
| r=1500 from rest | 841 (**14.3%**) | 976 (0.5%) |
| r=400 (deep) | — | 970 (1.1%) |
| r=1500, v=8 tangential | — | 975 (0.6%) |
| r=700, falling at 6 | — | 970 (1.1%) |

No run died. Radial wobble is about ±60–120 around target; `autoRadialGain` trades that
wobble against how quickly it closes. Tests fake `performance.now()` forward with sim
time — the burst cooldown reads the wall clock, so 3,600 instant steps would otherwise
count as 0.1s and block every burst after the first.

## Controls

| | |
|---|---|
| mouse / click / shift+click | steer / fire / drop a probe at the cursor |
| wheel | zoom (lens radius is in **screen** px and deliberately does not scale with it) |
| `shift+wheel` | drive gear up/down, ×10 each, 0–9 (2026-09-11). Q: the flown ship (takes it off auto-orbit); E: formations holding a selected ship |
| `shift+↑` / `shift+↓` | the same as shift+wheel (2026-09-12) |
| Q: right-click | lock / release the trajectory toward the click (2026-09-12) |
| `SPACE` | drop to gear 0. *(Superseded 2026-09-11: it was hold to charge the hyperdrive, release to burn.)* |
| `U` | ultradrive (Q, solo): tap to charge 10 s, tap again to abort or drop out (`gl-ultra.js`, 2026-09-11) |
| `P` / `.` | pause / single-frame step |
| ~~`[` `]`~~ | ~~cycle lensing method~~ — removed 2026-09-12 (vector is baked) |
| ~~`,` `/`~~ | ~~cycle gravity model~~ — removed 2026-09-12 (arcade is baked) |
| `C` / `H` | free camera / hide panel (`R` reseed probes removed 2026-09-12) |
| `O` | auto-orbit the nearest body (hole, star or planet) — the flown ship in Q; in E, the selection as an **evenly spaced ring** (2026-09-11; was a delta orbit group) |
| ~~`M`~~ | ~~toggle the 8-bit mini-map~~ — removed 2026-09-12 (the mini-map is baked on) |
| wheel over the mini-map | down = step out, up = step in: PLANET 2 AU · SYSTEM 100 AU · LOCAL 25 ly · GALAXY (2026-09-11; was close/max) |
| ~~`N` / `Tab`~~ | ~~new black hole at the cursor / select next hole~~ — removed 2026-09-12 with the black-hole panel section |
| `Q` / `E` | direct control of the last ship touched / fleet command mode |
| `F` | spawn a ship at the cursor |
| E: left-drag / click / shift | box-select by centroid / pick one / add to selection |
| E: right-click | selected ships go there in delta formation and hold it; **on a body**: go there, then ring-orbit it on arrival (2026-09-11) |
| arrows / `Esc` | pan / deselect (E mode) |

**Copy params** in the panel puts the current configuration on the clipboard as JSON
(console fallback when `file://` blocks the clipboard) — paste that into a plan file or
back into a session rather than describing settings in prose.

## The two questions to actually answer with this

0. **Is a 10x hyperdrive the right escape hatch at all?** It is now tunable, and the table
   above says thrust barely matters next to depth and infall speed. The alternative worth
   trying with these sliders is a *weaker* drive with much higher authority — a ship that
   escapes because it grips, not because it is fast.
1. **`shipControl`** (Gravity section) is the design question in one slider. At `1.0` the
   ship is exactly gyro-space's and gravity cannot move it at all; at `0` it is a rock
   with a rudder. Default `0.12`. Where on that range a black hole is *fun* rather than
   *frustrating* is not derivable — it has to be flown.
2. **Does the lensing need to distort entities, or only the sky?** Method 6 is free and
   method 5 is not. If nobody notices that asteroids pass through the lens undistorted,
   that is a ~8ms/frame saving.

## If a model or method graduates into gyro-space

Nothing here is written to the `GameInstance` contract — there is no `init`/`destroy`,
timers are not tracked, and the one listener set is never torn down, because the page is
never embedded and never re-instantiated. **Any code moved into `gyro-space/` has to be
rewritten to `GAME_PROTOTYPE_INSTRUCTIONS.md` first**, not copied. The parts worth moving
are the maths (`glGravityAt`, `glBeta`, `glIntegrate`) and the three-stage render order;
the harness around them is deliberately throwaway.

<!-- doc-sync: 53170539 | 2026-09-20 -->
