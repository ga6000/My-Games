// ===================================================
//   Gravity Lab — parameter model (the whole point of this build)
// ===================================================
// Local playtest-only breakaway from gyro-space/. NOT on the hub, NOT
// multiplayer, no Firebase, no score submission. Every number a gravity or
// lensing method reads lives in GLP.v and is driven by a slider, so a method
// can be re-tuned without an edit-reload cycle.
//
// Classic script, one shared global scope (file:// hard constraint). Every
// top-level name in this build is prefixed GL/gl so it can never collide with
// the st-*.js names if the two are ever loaded on one page.
//
// 2026-09-10 — BIG HOLES. See BIG_HOLES_PLAN.md. Holes are now sized in
// multiples of a size unit (default: the ship, 18 world units) at 10x-200x,
// and everything that used to be an absolute number tied to a ~200-unit hole
// is now EITHER derived from the hole's size OR expressed as a multiple of r_s:
// influence radius, mass, lens reach and Einstein radius. A number in world
// units or screen pixels cannot mean the same thing for a 180-unit hole and a
// 3,600-unit one, and every one that was left absolute broke at some size.
"use strict";

// SHIP SCALE (2026-09-11, GALAXY_PLAN.md). The world became real: 1 unit =
// 1,000 km, Earth 12.7 units wide. The old 18-unit hull would be bigger than
// Earth, so the ship shrinks to 1 unit — and every SHIP-SCALE length, speed and
// acceleration the lab was tuned with shrinks by the same factor (hull, cruise,
// spacing, clearances, hole sizes and pull, …). With time unchanged, every
// dimensionless ratio the tuning rests on is preserved. Real astronomical
// sizes are never multiplied by this; they are the world.
const GL_S = 1 / 18;

// Slider definitions. `g` drives the panel's section headings.
const GL_PARAM_DEFS = [
    // --- The hole itself (PER-HOLE: see GL_HOLE_KEYS) ----------------------
    // Default r_s is the 50x average at the default size unit (50 x 18 = 900).
    // Mass is a MULTIPLIER on the size rule, not an absolute GM: with holes
    // spanning 20x in size, any absolute default would be right for one size
    // and wrong for the rest. 1.0 = exactly what the size rule gives.
    { k: "massX",       g: "Black hole", label: "Mass (x size rule)",   min: 0.05,   max: 5,      step: 0.05, def: 1 },
    // Default = Sgr A* at TRUE size (4.15M M☉ → r_s 12,250 units), the pinned
    // hole #1 at the galactic centre since 2026-09-11. Stellar holes are drawn
    // from the size distribution below, enlarged (10–200 ship lengths).
    { k: "rs",          g: "Black hole", label: "Event horizon r_s",    min: 1,      max: 20000,  step: 1,    def: 12250 },
    { k: "photonRing",  g: "Black hole", label: "Photon ring x r_s",    min: 1,      max: 4,      step: 0.05, def: 1.55 },
    { k: "spin",        g: "Black hole", label: "Spin (frame drag)",    min: -1,     max: 1,      step: 0.01, def: 0.25 },
    { k: "bhX",         g: "Black hole", label: "Position X",           min: -36000, max: 36000,  step: 50,   def: 0 },
    { k: "bhY",         g: "Black hole", label: "Position Y",           min: -36000, max: 36000,  step: 50,   def: 0 },

    // --- Size & scale (GLOBAL — applies to every hole at once) -------------
    // The size unit is the reference the 10x/50x/200x distribution is in. It
    // defaults to the ship because that is the natural "size" in a game; set it
    // to 200 to read the distribution as multiples of the previous tuned hole
    // instead (and expect holes larger than the arena at the top end).
    { k: "sizeUnit",    g: "Size & scale", label: "Size unit (1x, world units)", min: 0.05, max: 25, step: 0.05, def: 18 * GL_S },
    // Influence radius is DERIVED: r_s x this. Default 5.45 = the user's tuned
    // 1090 / 200, so the preferred proportions survive the size change.
    { k: "influenceX",  g: "Size & scale", label: "Influence radius x r_s",      min: 1.2, max: 12, step: 0.05, def: 5.45 },

    // --- Gravity model tuning --------------------------------------------
    { k: "softening",   g: "Gravity",    label: "Softening e (Plummer)", min: GL_S, max: 4000 * GL_S, step: 10 * GL_S, def: 600 * GL_S },
    { k: "grTerm",      g: "Gravity",    label: "GR r^-4 term weight",  min: 0,    max: 5,      step: 0.05, def: 1 },
    { k: "swirl",       g: "Gravity",    label: "Tangential swirl",     min: 0,    max: 2,      step: 0.01, def: 0.3 },
    { k: "accelCap",    g: "Gravity",    label: "Max accel (0=off)",    min: 0,    max: 60 * GL_S, step: 0.5 * GL_S, def: 12 * GL_S },
    { k: "dragInner",   g: "Gravity",    label: "Inner drag",           min: 0,    max: 1,      step: 0.01, def: 0 },
    { k: "gravTimeScale", g: "Gravity",  label: "Physics time scale",   min: 0.1,  max: 3,      step: 0.05, def: 1 },
    // 1.0 reproduces gyro-space exactly (engines win, gravity cannot move the
    // ship); 0 is a rock with a rudder. The whole design question lives here.
    { k: "shipControl", g: "Gravity",    label: "Ship control authority", min: 0,  max: 1,      step: 0.01, def: 0.12 },

    // --- Hyperdrive -------------------------------------------------------
    // SPACE. Hold to charge, release to burn. This replaced gyro-space's flat
    // 3x dash 2026-09-08 because the dash could not answer the question it was
    // carried over for: at the default control authority it does not escape a
    // well at all, so "can I get out of this" had no honest answer.
    // 2026-09-11: the player's drive is GEARS now (Shift+wheel) — speed =
    // cruise × gearStep^gear, no charge. hyperThrust is what the AI's bursts
    // (escape, stall, autopilot) use, unchanged.
    { k: "hyperGearStep", g: "Hyperdrive", label: "Speed × per gear (Shift+wheel)", min: 2, max: 20, step: 1, def: 10 },
    { k: "hyperGearMax",  g: "Hyperdrive", label: "Top gear",            min: 1,   max: 12,  step: 1,    def: 9 },
    { k: "hyperThrust",   g: "Hyperdrive", label: "AI burst thrust ×",   min: 1,   max: 25,  step: 0.5,  def: 10 },
    // The one that actually matters — see the note in gl-sim.js. Raising the
    // target speed 10x does nothing if the engines are still only closing 12%
    // of the gap to it each frame while gravity pulls the other way.
    { k: "hyperAuthority",g: "Hyperdrive", label: "Authority while burning", min: 0, max: 1, step: 0.01, def: 0.55 },

    // --- Autopilot --------------------------------------------------------
    // 2026-09-10: the target is no longer a slider. On engage the autopilot
    // LOCKS the nearest hole and the ship's current distance from its HORIZON,
    // and holds that. `autoTargetR` (target as a multiple of r_s) is gone: on a
    // 900-r_s hole "6 x r_s" is 5,400 units out, nowhere near where you were.
    { k: "autoRadialGain",g: "Autopilot", label: "Radial correction",   min: 0,   max: 3,   step: 0.05, def: 1.4 },
    // Without this the autopilot settled ~13% INSIDE its target from every
    // start (measured 2026-09-10): a proportional term alone only pushes
    // outward when there is error, and holding an orbit against gravity needs
    // a constant outward push, so it parks wherever that error balances the
    // well. The integral term learns that push instead. 0 reproduces the bias.
    { k: "autoIntegral",  g: "Autopilot", label: "Offset correction (I)", min: 0, max: 3,   step: 0.05, def: 0.8 },
    // Bursts are SHORT and frequent now (were 1.2s / 2.5s cooldown): holding a
    // fixed altitude deep in a big well is a hover, and a hover is many small
    // corrections, not a few big shoves that overshoot.
    { k: "autoBurst",     g: "Autopilot", label: "Burst length (s)",    min: 0.05, max: 3,  step: 0.05, def: 3 },
    { k: "autoCooldown",  g: "Autopilot", label: "Burst cooldown (s)",  min: 0,   max: 10,  step: 0.05, def: 0 },
    // Now a fraction of the locked ALTITUDE, not of the orbit radius — so it
    // means the same thing 100 units above a horizon as 10,000 above it.
    { k: "autoTolerance", g: "Autopilot", label: "Burst trigger (x altitude)", min: 0.02, max: 1, step: 0.01, def: 0.02 },

    // --- Time dilation (2026-09-10) — see glTimeFactor in gl-gravity.js -----
    // Power 2 gives tau = altitude/r for a lone hole; 1 is the true
    // Schwarzschild factor (only bites within ~1% of r_s). Min is the floor
    // (1/100x requested); void max and reach set the speed-up far from all
    // holes (2x requested) and how far out "far" begins.
    { k: "dilationPower", g: "Time dilation", label: "Dilation power k",     min: 0.5,  max: 8,    step: 0.1,   def: 2 },
    { k: "dilationMin",   g: "Time dilation", label: "Max slowdown (floor)", min: 0.001, max: 1,   step: 0.001, def: 0.01 },
    { k: "voidMax",       g: "Time dilation", label: "Void speed-up max",    min: 1,    max: 4,    step: 0.05,  def: 2 },
    { k: "voidReach",     g: "Time dilation", label: "Void reach (u scale)", min: 0.005, max: 0.5, step: 0.005, def: 0.05 },

    // --- Fleet (2026-09-10) ------------------------------------------------
    // Spacing 110 ≈ six hull lengths between delta rows.
    { k: "formationSpacing", g: "Fleet", label: "Formation spacing",      min: 40 * GL_S, max: 400 * GL_S, step: 5 * GL_S, def: 110 * GL_S },
    { k: "boidSeparation",   g: "Fleet", label: "Boid separation",        min: 0,    max: 3,    step: 0.05,  def: 1.2 },
    { k: "followerBurstDist",g: "Fleet", label: "Follower catch-up if behind by", min: 200 * GL_S, max: 4000 * GL_S, step: 50 * GL_S, def: 900 * GL_S },
    // Escape rule (2026-09-10): any AI-driven ship whose estimated time to
    // impact with a horizon or surface drops under this bursts outward.
    // Before it, group-commanded ships had no way out of a well at all.
    { k: "escapeTime",       g: "Fleet", label: "Escape burst if impact within (s)", min: 0.5, max: 20, step: 0.5, def: 5 },

    // --- Ultradrive (2026-09-11, gl-ultra.js) ------------------------------
    // U in Q mode, solo only. 2026-09-11: speed is set by how long a rim-to-rim
    // crossing of the 100,000-ly galaxy takes (100 min), ramping exponentially
    // over the ramp time from peak/ratio to peak: 1.72 → 17.2 ly/s. See
    // glUltraPeakLyS in gl-ultra.js.
    { k: "ultraChargeTime", g: "Ultradrive", label: "Charge time (s, lab time)", min: 1, max: 30,  step: 0.5,  def: 10 },
    { k: "ultraCrossMin",   g: "Ultradrive", label: "Galaxy crossing (min)",  min: 5,   max: 600,  step: 5,    def: 100 },
    { k: "ultraRatio",      g: "Ultradrive", label: "Peak / start speed",     min: 1.5, max: 100,  step: 0.5,  def: 10 },
    { k: "ultraRampTime",   g: "Ultradrive", label: "Time to peak (s)",       min: 5,   max: 900,  step: 5,    def: 300 },
    { k: "ultraWarpMax",    g: "Ultradrive", label: "Star warp at full charge (x)", min: 1, max: 200, step: 1,   def: 100 },
    { k: "ultraShake",      g: "Ultradrive", label: "Screen rumble (px)",     min: 0,   max: 20,   step: 0.5,  def: 5 },
    { k: "ultraVolume",     g: "Ultradrive", label: "Volume",                 min: 0,   max: 1,    step: 0.05, def: 0.6 },

    // --- Audio (2026-09-12, gl-audio.js) -----------------------------------
    { k: "masterVolume",  g: "Audio", label: "Master volume",              min: 0, max: 1, step: 0.05, def: 0.7 },
    { k: "ambientVolume", g: "Audio", label: "Ambient",                    min: 0, max: 1, step: 0.05, def: 0.5 },
    { k: "engineVolume",  g: "Audio", label: "Engine (by gear)",           min: 0, max: 1, step: 0.05, def: 0.5 },
    { k: "sfxVolume",     g: "Audio", label: "Cues (gear shift, autopilot)", min: 0, max: 1, step: 0.05, def: 0.7 },

    // --- Lensing ----------------------------------------------------------
    { k: "lensStrength",g: "Lensing",    label: "Lens strength",        min: 0,    max: 6,      step: 0.05, def: 6 },
    // Reach and Einstein radius are multiples of r_s (were screen pixels). In
    // pixels, a tuned 335px lens sits INSIDE the black disc of a 900-r_s hole
    // at zoom 1 — no visible lensing at all. As multiples they scale with every
    // hole and every zoom level automatically.
    { k: "lensReach",   g: "Lensing",    label: "Lens reach x r_s",     min: 1.05, max: 8,      step: 0.025, def: 2.5 },
    { k: "einsteinX",   g: "Lensing",    label: "Einstein radius x r_s", min: 0.1, max: 4,      step: 0.05, def: 1.5 },
    // Approach boost (2026-09-10): lensing grows as the SHIP nears a hole.
    // p = 1 - altitude / (influence - r_s), and the boosts go as p², so the
    // effect stays subtle until you are genuinely close and then climbs fast.
    { k: "lensApproachStrength", g: "Lensing", label: "Approach: strength boost", min: 0, max: 5, step: 0.05, def: 1.5 },
    { k: "lensApproachReach",    g: "Lensing", label: "Approach: reach boost",    min: 0, max: 4, step: 0.05, def: 1.0 },
    { k: "lensStep",    g: "Lensing",    label: "Ring / pixel step",    min: 1,    max: 12,     step: 1,    def: 2 },
    // Ring budget for the RASTER ring methods (1-3). Measured 2026-09-10 with a
    // GPU flush: ~0.45ms PER RING, linear, at any hole size — every ring is a
    // near-full-screen masked copy of the frame, so this is a fill-rate cost.
    // It was a hardcoded 160 (= ~75ms). 40 ≈ 18ms. The vector method (7)
    // costs nothing here at all; this slider only matters for 1-3.
    { k: "lensMaxRings", g: "Lensing",   label: "Max rings (raster 1-3)", min: 4,  max: 240,    step: 4,    def: 40 },
    { k: "lensFalloff", g: "Lensing",    label: "Falloff exponent",     min: 0.5,  max: 4,      step: 0.05, def: 1.4 },
    { k: "lensFeather", g: "Lensing",    label: "Edge feather",         min: 0,    max: 1,      step: 0.01, def: 0.26 },

    // --- Look -------------------------------------------------------------
    { k: "diskBright",  g: "Look",       label: "Accretion brightness", min: 0,    max: 2,      step: 0.05, def: 0 },
    { k: "beaming",     g: "Look",       label: "Doppler beaming",      min: 0,    max: 1,      step: 0.01, def: 0.25 },
    { k: "ringGlow",    g: "Look",       label: "Photon ring glow",     min: 0,    max: 2,      step: 0.05, def: 1.55 },
    // Radius of the mini-map's MAX range (2026-09-10): stars within it are
    // plotted as single points and listed with name and distance.
    // 2026-09-11: the mini-map's LOCAL level (stars as points + nearest list),
    // in light-years. Was "max range" in world units.
    { k: "mmLocalLy",   g: "Look",       label: "Mini-map local radius (ly)", min: 2, max: 500, step: 1, def: 25 },

    // --- Probes -----------------------------------------------------------
    { k: "probeCount",  g: "Probes",     label: "Test particles",       min: 0,    max: 400,    step: 5,    def: 160 },
    { k: "probeTrail",  g: "Probes",     label: "Probe trail length",   min: 0,    max: 200,    step: 5,    def: 5 },
    { k: "probeSpeed",  g: "Probes",     label: "Probe launch speed",   min: 0,    max: 12 * GL_S, step: 0.1 * GL_S, def: 0.3 * GL_S }
];

// Checkbox state that is not a continuous slider.
const GL_TOGGLE_DEFS = [
    // Mass rule. OFF (default) = "feel" rule, M ∝ influence², which keeps the
    // arcade peak pull identical at every size — only the well's EXTENT grows.
    // ON = physical, M ∝ r_s (Schwarzschild: r_s = 2GM/c²). Anchored so the
    // two agree for the 50x average hole; under it a 200x hole pulls ~4x
    // GENTLER at its horizon than an average one and a 10x hole ~5x harder —
    // the real-universe result, and a real design choice.
    { k: "massPhysical", g: "Size & scale", label: "Physical mass rule (M ∝ r_s)", def: false },
    // Which curve the FORWARD lenses (6 starfield, 7 vector) bend points with.
    // ON (default) = the heuristic curve of ring method 1, solved in reverse,
    // so vector reproduces the look of the user's chosen method. OFF = true
    // thin-lens optics, which at the preferred strength (6, boosted to ~14 on
    // approach) pushes points ~2,000px outward near a big hole and empties the
    // screen — correct for those numbers, but a different look entirely.
    { k: "vecHeuristic", g: "Lensing",    label: "Vector/star lens: ring-1 curve", def: true },
    { k: "autoZoom",     g: "Size & scale", label: "Auto-zoom to nearest horizon", def: false },
    { k: "gravShip",     g: "Applies to", label: "Gravity affects ship",      def: true },
    { k: "gravBullet",   g: "Applies to", label: "Gravity affects bullets",   def: true },
    { k: "gravProbe",    g: "Applies to", label: "Gravity affects probes",    def: true },
    { k: "horizonKills", g: "Applies to", label: "Horizon kills ship",        def: true },
    { k: "dilationOn",   g: "Time dilation", label: "Time dilation on",       def: true },
    { k: "dilateWorld",  g: "Time dilation", label: "Also dilates probes, asteroids, bullets", def: true },
    // 2026-09-11: "void" = sparse galaxy (between arms, beyond the disk), not
    // merely "far from any body" — which at real scale was everywhere.
    { k: "voidGalactic", g: "Time dilation", label: "Void = sparse galaxy (between arms, beyond disk)", def: true },
    { k: "escapeOn",     g: "Fleet",      label: "AI ships burst to escape wells", def: true },
    { k: "bodiesGravity",g: "Star systems", label: "Stars & planets pull small objects", def: true },
    { k: "bodiesSolid",  g: "Star systems", label: "Stars & planets are solid", def: true },
    { k: "minimapOn",    g: "Look",       label: "8-bit mini-map (M)", def: true },
    { k: "audioOn",      g: "Audio",      label: "Sound on (starts on first key or click)", def: true },
    { k: "showChunks",   g: "Debug",      label: "Show chunk grid",    def: false },
    // Reflects the CONTROLLED ship (or, in E mode, drives the selection) — it
    // is a view onto per-ship state since the fleet, not a global of its own.
    { k: "autoOrbit",    g: "Autopilot",  label: "Auto-orbit (O) — locks hole + altitude", def: true },
    // Honest timing (2026-09-10). Canvas 2D queues draw calls for the GPU and
    // returns at once, so a JS timer around drawImage measures RECORDING, not
    // drawing — the ring methods read 0.3-1ms under it while really costing
    // 18-95ms. With this on, a 1px readback after each stage forces the GPU
    // to finish before the timer stops. Costs a small stall per frame; turn it
    // off to see peak fps, on to see where the time goes.
    { k: "gpuSync",      g: "Debug",      label: "GPU-synced timing (honest ms)", def: true },
    { k: "showField",    g: "Debug",      label: "Show force field",          def: true },
    { k: "showOrbit",    g: "Debug",      label: "Show radii guides",         def: true },
    { k: "showVectors",  g: "Debug",      label: "Show velocity vectors",     def: false },
    { k: "freeCam",      g: "Debug",      label: "Free camera (no follow)",   def: false },
    { k: "diskOn",       g: "Look",       label: "Accretion disk",            def: false }
];

// Number boxes (2026-09-10) may go past a slider's min/max on purpose — that
// was the request. These floors are only for values below which code breaks:
// division by zero, an empty lens band, a negative count, a lerp that is no
// longer a lerp. Nothing here caps the top end.
const GL_PARAM_FLOORS = {
    rs: 1, sizeUnit: 0.005, influenceX: 1.01, photonRing: 1, massX: 0,
    lensReach: 1.001, einsteinX: 0, lensStep: 1, lensMaxRings: 1,
    probeCount: 0, probeTrail: 0, softening: 0.01 * GL_S, gravTimeScale: 0.001,
    hyperGearStep: 1.01, hyperGearMax: 0, autoBurst: 0.01, autoCooldown: 0,
    dilationPower: 0.01, dilationMin: 0.0001, voidMax: 1, voidReach: 0.0001,
    formationSpacing: 10 * GL_S, boidSeparation: 0, followerBurstDist: 0, escapeTime: 0,
    mmLocalLy: 0.5,
    ultraChargeTime: 0.1, ultraCrossMin: 0.1, ultraRatio: 1.01, ultraRampTime: 0.1,
    ultraWarpMax: 1, ultraShake: 0, ultraVolume: 0,
    masterVolume: 0, ambientVolume: 0, engineVolume: 0, sfxVolume: 0,
    shipControl: 0, hyperAuthority: 0, accelCap: 0
};

// The parameters that belong to ONE black hole rather than to the world.
//
// These sliders always edit the SELECTED hole: picking a different hole in the
// dropdown reloads them, and moving one writes straight through to that hole.
// So `GLP.v.rs` means "the selected hole's r_s", not "the r_s".
//
// 2026-09-10: influence radius, mass and Einstein radius LEFT this list. They
// are now derived from each hole's own r_s (via the global multipliers), which
// is what "influence scales with size" requires — a per-hole absolute influence
// would have to be re-set by hand every time a hole was resized.
const GL_HOLE_KEYS = ["massX", "rs", "photonRing", "spin", "bhX", "bhY"];

// Live values. Seeded from the defs, then mutated in place by the sliders.
// DEFAULTS ARE THE USER'S (2026-09-10). The `def` values above and the two
// models below were set from the user's own exported configuration, and Reset
// All returns here. Before this, defaults were generic and the user's setup was
// a preset applied on top at boot — two sources of truth for "where the lab
// starts", which is how they drift. Now there is one: the defs.
//
// BAKED 2026-09-12 — the user's "Copy locked" list, verbatim. These values ARE
// the design now: they are the defaults, and they are no longer adjustable —
// the panel skips any def marked `fixed`, and the hotkeys and presets that
// could change them are gone. To reopen one, delete its line here.
const GL_BAKED = {
    lensMethod: "vector", gravityModel: "arcade",
    influenceX: 5.45, sizeUnit: 1, massPhysical: false, autoZoom: false,
    softening: 33.33333333333333, grTerm: 1, swirl: 0.3, accelCap: 0.6666666666666666,
    dragInner: 0, gravTimeScale: 1, shipControl: 0.12,
    hyperGearStep: 10, hyperGearMax: 9, hyperThrust: 10, hyperAuthority: 0.55,
    ultraChargeTime: 15, ultraCrossMin: 10, ultraRatio: 10, ultraRampTime: 300,
    ultraWarpMax: 100, ultraShake: 7.5, ultraVolume: 0.75,
    audioOn: true, masterVolume: 0.7, ambientVolume: 0.6, engineVolume: 0.2, sfxVolume: 0.4,
    diskOn: false, minimapOn: true, diskBright: 0, beaming: 0.25, ringGlow: 1.55,
    gravShip: true, gravBullet: true, gravProbe: true, horizonKills: true,
    bodiesGravity: true, bodiesSolid: true
};
GL_PARAM_DEFS.concat(GL_TOGGLE_DEFS).forEach(function (d) {
    if (d.k in GL_BAKED) { d.def = GL_BAKED[d.k]; d.fixed = true; }
});
const GL_DEFAULT_GRAVITY = GL_BAKED.gravityModel;
const GL_DEFAULT_LENS = GL_BAKED.lensMethod;   // was "sectors"
const GLP = { v: {}, gravityModel: GL_DEFAULT_GRAVITY, lensMethod: GL_DEFAULT_LENS };
GL_PARAM_DEFS.forEach(function (d) { GLP.v[d.k] = d.def; });
GL_TOGGLE_DEFS.forEach(function (d) { GLP.v[d.k] = d.def; });

// (Presets and glApplyPreset went 2026-09-12. Every preset existed to pick a
// gravity model and a lens method with matching tuning; both models are baked
// now, so they could only fight GL_BAKED.)

// Everything a tester would want to paste back into a plan file: every
// ADJUSTABLE value that differs from the default (baked ones cannot differ).
function glExportParams() {
    const out = { gravityModel: GLP.gravityModel, lensMethod: GLP.lensMethod, v: {} };
    GL_PARAM_DEFS.concat(GL_TOGGLE_DEFS).forEach(function (d) {
        if (!d.fixed && GLP.v[d.k] !== d.def) out.v[d.k] = GLP.v[d.k];
    });
    out.locked = glLocks;   // the values marked ready to bake in (gl-ui.js)
    return JSON.stringify(out, null, 2);
}

function glResetParams() {
    GL_PARAM_DEFS.forEach(function (d) { GLP.v[d.k] = d.def; });
    GL_TOGGLE_DEFS.forEach(function (d) { GLP.v[d.k] = d.def; });
    GLP.gravityModel = GL_DEFAULT_GRAVITY;
    GLP.lensMethod = GL_DEFAULT_LENS;
    glApplyLocks();   // locked values survive Reset All (gl-ui.js, 2026-09-12)
    // Reset drops every extra hole too. A "reset all" that left four holes
    // scattered around the arena would not be a reset.
    glHoles.length = 0;
    glSelectedHoleIndex = 0;
    // Stand every ship down: locks point at deleted holes, and groups would
    // be holding formation around orders given in a world that is gone.
    glShips.forEach(function (s) { s.autoOrbit = false; s.autoLock = null; s.group = null; });
    glGroups.length = 0;
    glAddCoreHole();   // Sgr A* at the galactic centre (gl-galaxy.js)
    // Auto-orbit defaults ON for the flown ship. It is per ship, and
    // glSyncPanelFromParams reads the checkbox FROM glShip — so the default
    // has to be written onto the ship first, or the sync would turn it off.
    glShip.autoOrbit = !!GLP.v.autoOrbit;
    glSyncPanelFromParams();
}
