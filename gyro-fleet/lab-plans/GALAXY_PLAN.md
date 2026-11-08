# gyro-lab — a Milky Way–shaped world at real scale

Written 2026-09-11 before editing, per root `CLAUDE.md`. Request, in substance:

1. Base the world's limits on the **size and spiral shape of the Milky Way** — arms and a
   core, with rough proportions of stars : planets : black holes : asteroid belts. Use a
   procedural formula rather than a restructure, so leaving and returning keeps local
   orbits where time says they are.
2. **Real orbit times** (planets appear still) and **real diameters and orbit sizes**.
3. The mini-map's max zoom shows the **spiral**.
4. The ultradrive crosses the galaxy in **100 minutes**.
5. The hyperdrive needs **no charge**, and scales for fine local pathing after an ultradrive
   drop-out.

User decisions (asked 2026-09-11):
- Ship **not to scale**; 1 unit = 1,000 km.
- Depth: **real Solar System at home, Sgr A\* at the core, binary stars, moons**.
- Stellar black holes **enlarged, at their real count**.
- Hyperdrive on **Shift+wheel gears**.

## Scale

| | real | units (1 unit = 1,000 km) |
|---|---|---|
| Earth radius | 6,371 km | 6.37 |
| Sun radius | 695,700 km | 696 |
| 1 AU | 1.496e8 km | 149,598 |
| Neptune orbit | 30.07 AU | 4.5M |
| 1 light-year | 9.461e12 km | 9.461e9 |
| Milky Way radius (disk) | ~50,000 ly | 4.73e14 |
| Sun to centre | ~26,000 ly | 2.46e14 |

**World origin = the Sun.** The galactic centre (Sgr A\*) sits at (0, −26,000 ly). A
float64's step is 0.0156 units at Sgr A\*, and 0.125 at the far rim. Home is exact. World
bounds are the galactic centre ± 55,000 ly.

**The ship shrinks to fit: hull 18 → 1 unit (1,000 km)**, still ~10⁴× its true size. An
18-unit hull would be bigger than Earth (12.7 wide). Every tuned behaviour in the lab is a
ratio between the ship and its world. So every *ship-scale* length, speed and acceleration
is multiplied by one constant, **`GL_S = 1/18`** (gl-params.js):
- hull, cruise speed, bullet, probe and particle speeds;
- formation spacing, follower-burst distance, formation-radius padding, loiter radius;
- clearances, the autopilot's minimum altitude, ring altitude;
- the escape rule's velocity threshold, softening, the acceleration cap;
- the black-hole mass constant (`GL_MASS_K`), and the peak pull of stars and planets;
- hole sizes (`sizeUnit` 18 → 1, so 10–200× the ship becomes 10–200 units).

With lengths and speeds ×s and time unchanged, accelerations are ×s and every dimensionless
ratio the lab was tuned on is preserved. **Real astronomical sizes are NOT scaled** — they
are the world.

## Galaxy density Σ(x, y) — stars per ly², in `gl-galaxy.js`

In galactocentric polar coordinates (R, φ), in ly:
- **Disk:** `exp(−R/8,500)`, tapered to zero past ~48,000.
- **Arms:** four logarithmic spirals, pitch 12°. They are phased so that, on the Sun's
  azimuth, **Perseus** sits at 32,500 ly and the others follow inward at the pattern's ×1.396
  radius ratio: **Sagittarius** 23,300, **Scutum–Centaurus** 16,700, **Norma** 12,000; outward,
  the **Outer arm** at 45,400. That matches the real ordering and spacing roughly.
  - Even arms (Perseus, Scutum–Centaurus) are major, strength 1.0; odd arms are minor, 0.6.
  - Profile: Gaussian, σ 1,200 ly measured perpendicular to the arm.
  - The arms fade in over 11–15k ly (from the bar's ends) and fade out over 44–52k.
- **Orion spur:** a short partial arm through the Sun, strength 0.45, azimuth extent σ 0.25
  rad.
- **Arm contrast:** interarm base 0.45, arm gain 1.1 — 3.4× on a major arm.
- **Bar + bulge:** the bar sits at 27° to the Sun–centre line. An elliptical bulge
  (scale 2,600 ly, axis ratio 0.5), plus a flat-topped long bar to ~13,000 ly (ratio 0.2).
- **Nucleus:** `20·exp(−R/200)`.
- **Normalised** so Σ at the Sun = **0.025 /ly²**, i.e. mean spacing ~6.3 ly. That is the
  real local 3D density taken to the ⅔ power, which keeps nearest-star distances real.
  - Consequence, stated plainly: a flat slice with real local spacing holds ~10⁸ stars,
    not the real 10¹¹. Spacing, not total count, is what a pilot feels.

## Contents (all seeded from hash(worldSeed, chunk), all analytic in time)

- **Chunks:** 1 ly square. Each holds Poisson(Σ·1 ly²) stars, capped at 12. That's ~0.025
  per chunk near home, capped in the core so a load stays bounded.
- **Star classes** (by number), each with real radius, mass and colour ranges:

  | M | K | G | F | A | B | O | white dwarf | giant |
  |---|---|---|---|---|---|---|---|---|
  | 73% | 12% | 7% | 3% | 0.6% | 0.13% | ~0 | 4% | 0.4% |

- **Stellar black holes:** 1 in 1,000 stellar objects. They use the existing size sampler,
  enlarged (10–200 units).
- **Sgr A\*:** at the centre at true size, r_s 12,250 units (4.15M M☉). It is pinned, and
  it's hole #1.
- **Binaries** by class: O/B 70%, A 50%, F/G 45%, K 40%, M 27%, WD 20%, giant 30%.
  - Mass ratio 0.1–1; separation log-normal around 40 AU (1.3 dex).
  - Under 5 AU → planets are circumbinary (P-type), from 3× the separation outward.
  - Wider → planets orbit the primary inside a third of the separation (S-type).
  - Both stars ride their barycentre on rails.
- **Planets:** Poisson mean by class — M 1.6, K 2.2, G 2.6, F 2.2, A 1.2, B 0.4, WD 0.3,
  giant 0.8. That averages ~1.8 per star, in line with Kepler statistics.
  - The first orbit is log-uniform 0.03–0.4 AU × √M; each next one is ×1.4–2.6, out to
    60 AU.
  - Types by snow line (2.7 AU × M²): rocky, super-Earth/mini-Neptune, ice giant and gas
    giant, plus rare hot Jupiters. Giants are rarer around M dwarfs.
  - Radii are real (Earth = 6.37 units). Mass is taken from radius.
- **Moons:** gas giants 1–4, ice giants 0–2, rocky 20% for one. Orbits run from 5–80 planet
  radii, with Kepler periods about the planet's mass.
- **Asteroid belts:** 25% of systems, at 2–4× the snow line. Sol has the main belt
  (2.2–3.3 AU) and the Kuiper belt (30–50 AU). Rocks are on rails and enlarged
  (0.2–0.8 units); 120–200 of them represent each belt.
- **All orbits are Kepler, real-time:** `P = 2π√(a³/GM)`, with GM☉ = 132.7 units³/s² and
  GM⊕ = 3.986e-4 units³/s².
  - Angle = angle₀ + 2π·t/P, where **t = real seconds since J2000** at page load, plus lab
    time.
  - So a system left and revisited is where the clock says. Earth moves 0.0005 units a
    frame: still, as asked.
- **Sol:** the real 8 planets with real a, P and J2000 mean longitudes, so the planets sit
  where they are today. Major moons: Moon, Phobos, Deimos, the Galileans, Titan, Rhea,
  Titania, Oberon, Triton (retrograde). Pinned, never streamed.
- **Gameplay pull and wells stay arcade,** ×GL_S. Real surface gravity at these speeds is
  ~10⁻¹² units/frame² — invisible.

**Spatial query:** `glNear` gets its own grid (4M-unit cells, every well capped to fit).
With 1-ly chunks, a 3×3-chunk query could return ~2,000 core bodies per probe. Stays exact
for pull, horizons and surfaces.

## Drives

- **Hyperdrive gears** (Shift+wheel): speed = cruise × 10^gear, gears 0–9.
  - Cruise is 0.167 units/frame = 10,000 km/s.
  - Gear 1 ≈ the old 10× hyperdrive; gear 3 ≈ 1 AU in 15 s; gear 8 ≈ 1 ly in 16 s; gear 9
    ≈ 1 ly/s.
  - Gear ≥1 grips (hyperdrive authority) and takes the ship off auto-orbit.
  - **SPACE** = drop to gear 0. Charging, the burst, `hyperMaxBurn`, `hyperChargeCap` and
    `hyperPenalty` are gone.
  - The AI's escape, stall and autopilot bursts keep `hyperThrust` (10×) and are unchanged.
  - E mode: Shift+wheel and SPACE act on formations holding a selected ship. Their leader
    slows automatically as the target nears (never below cruise).
- **Ultradrive:** speed in ly/s, derived from a **100-minute rim-to-rim crossing**
  (100,000 ly), keeping the 5-minute ramp and 10× ratio. Peak = 100,000 /
  (6000 − 300 + 300·0.9/ln 10) = **17.2 ly/s**, start 1.72 ly/s (~gear 9, so the two
  drives join up). Param: crossing minutes.

## Views

- **Zoom** 1e-10 (~100 ly across) … 400.
  - When zoomed out past the loaded range, the main view draws stars from the chunk
    summaries as coloured points.
  - Auto-zoom frames the nearest **body**, not the nearest hole.
- **Mini-map:** four levels, wheel steps through them, with a cooldown for trackpads:
  - PLANET (2 AU across);
  - SYSTEM (100 AU);
  - LOCAL (radius `mmLocalLy`, 25 ly — stars as points plus a nearest-7 list in LY);
  - **GALAXY** (the whole Milky Way, rendered once from Σ, plus SGR A, SOL and you).
- **Nav arrows** at the screen edge: the nearest star (from summaries) and the nearest
  planet (loaded), each with its distance.
- **HUD:**
  - gear and speed in km/s, c, AU/s or ly/s;
  - the date (real, advancing with sim time);
  - distance from the galactic centre, arm or region, and local star density;
  - altitude above the nearest body.

## Removed or changed

- **Home sector:** the old origin hole, VESPER, HALCYON, the asteroid field and
  `GL_HOME_HALF`/`GL_FIELD_RADIUS` go. Sol replaces them.
- **Free chunk asteroids** go; there are only belts now. The `gravAst` toggle goes, since
  rail rocks don't integrate.
- **The panel's hole tools:**
  - "+ Add" places a hole near the focus;
  - "Generate field" places holes around the focus, not the old home sector;
  - Reset recreates Sgr A\*;
  - spawn and respawn = beside Earth.
- **Formations at high gears stretch.** A 6-unit spacing can't be held at 10⁴ units a
  frame, and the formation re-forms when it slows.

## Verify

- **Σ:** check the arms, the density at Sol (0.025), and the total count.
- **Galaxy map:** screenshot it.
- **Sol:**
  - Earth at 1 AU with a period of 365.256 d;
  - planets placed at today's longitudes;
  - positions identical after unload and reload with time advanced.
- **Chunks:**
  - a load near the core is bounded;
  - `glNear` agrees with brute force.
- **Drives:**
  - gear speeds as tabled;
  - after an ultradrive, the time to the nearest star at gear 8;
  - ultradrive crossing time ≈ 100 min (integrated).
- **Earlier behaviour still holds:**
  - the formation, ring and planet-arrival tests;
  - auto-orbit around Earth;
  - the escape case.
- **Checks:** the four checkers, then doc-sync.

## Status — implemented 2026-09-11

Everything above was built. Every verification item passed; the numbers are in
`gyro-lab/CLAUDE.md` ("The Milky Way at real scale").

Deviations and findings:
- **Auto-zoom** frames planets and stars *with* their radius. Framing the gap alone
  left Earth off screen at boot, and a hidden page had a 0-px canvas that drove the zoom to
  its 1e-10 floor. The fix falls back to 800 px.
- **The world bounds** became `minX/maxX/minY/maxY`, since the origin is the Sun, not the
  centre, and moved to gl-galaxy.js. The arena edge draws clipped to the screen.
- **Norma** peaks at 13,000 ly on the Sun's azimuth but reads "inter-arm" there: the arms
  are still fading in from the bar.
- **Void time boost — resolved after review (user's call):** "void" = sparse galaxy.
  The boost is gated by `glGalaxyVoid`: 1 between the arms and beyond the disk, 0 on the
  arms, the spur and the bulge; toggle `voidGalactic`. τ is ×1.03 beside Earth (it was
  ×1.87), ×1.00 on the arms, ×2.00 between them.
- **Flagged, and accepted by the user:**
  - formations stretch at high gears;
  - the core cap of 12 stars per chunk;
  - ~10⁸ stars rather than 10¹¹;
  - 0.125-unit precision at the far rim.
