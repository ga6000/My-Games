// ===================================================
//   Gravity Lab — canvas, buffer, camera, ship, world, entities
// ===================================================
// Local-only breakaway from gyro-space/. The world model here is a deliberate
// SIMPLIFICATION of st-world.js: same bounds, same camera-follows-ship
// convention, same asteroid shape generator — but no multiplayer, no score, no
// audio, no trail-as-hazard. Anything that would need a server is gone, because
// the only thing this build exists to answer is "which gravity/lens method
// feels right", and every one of those answers is a single-machine question.
//
// The second canvas (glBuffer) is what makes screen-space lensing possible at
// all: canvas 2D drawing is destructive, so the frame has to be composed
// somewhere you can still read pixels out of. Everything except the black hole
// itself renders into the buffer; the lens methods sample it onto the visible
// canvas. See gl-lens.js.
"use strict";

const glCanvas = document.getElementById("glGame");
const glCtx = glCanvas.getContext("2d");

// Offscreen scene buffer, same size as the visible canvas. Recreated on resize
// rather than scaled, so the 1:1 pixel mapping the lens math assumes holds.
const glBuffer = document.createElement("canvas");
const glBufCtx = glBuffer.getContext("2d", { willReadFrequently: true });

let glW = 0, glH = 0, glCX = 0, glCY = 0;

function glResize() {
    glW = glCanvas.width = window.innerWidth;
    glH = glCanvas.height = window.innerHeight;
    glBuffer.width = glW;
    glBuffer.height = glH;
    glCX = glW / 2;
    glCY = glH / 2;
}

// ===================================================
//                     STATE
// ===================================================
let glPaused = false;
let glLastFrame = performance.now();
let glFps = 0;
let glFrameMs = 0;
let glPhysMs = 0;      // Time in the gravity integrator alone
let glLensMs = 0;      // Time in the lens pass alone — the number that decides
                       // whether a lens method is shippable at all
let glWorldMs = 0;     // Time drawing the scene into the buffer (stage 1). For
                       // the vector method THIS is where its lens cost lands.
let glStepOnce = false; // Single-frame advance while paused (period key)
let glFrameNo = 0;      // Rendered frames — throttles the chunk streamer, keys the hazard cache
let glWorldTime = 0;    // Lab seconds simulated — planets are placed from it on (re)load

const glMouse = { x: 0, y: 0 };

const glCamera = { x: 0, y: 0, zoom: 1 };

// The world's bounds (GL_WORLD) live in gl-galaxy.js since 2026-09-11: they are
// the Milky Way's (galactic centre ± 55,000 ly), and that file defines the
// galaxy. Arena history: ±1,600 → ±16,000 → ±40,000 → ±40,000,000 (chunked,
// 2026-09-10) → the galaxy. The hand-made home sector (origin hole, VESPER,
// HALCYON, the asteroid field) is gone; the real Sol replaced it.

// Mass calibration: the user's tuned hole (2026-09-08) had GM 154,000 at an
// influence radius of 1,090. Under the arcade model peak pull is 6·M/R², so
// holding M/R² at this ratio holds the tuned peak pull at EVERY size. × GL_S
// (2026-09-11): lengths and speeds shrank with the ship, so accelerations do.
const GL_MASS_K = 154000 / (1090 * 1090) * GL_S;

// Minimum altitude the autopilot will lock. Below this, "hold this distance
// from the horizon" means skimming it, and one frame of error is death.
const GL_AUTO_MIN_ALT = 60 * GL_S;

// ===================================================
//                  SHIPS (a fleet since 2026-09-10)
// ===================================================
// Was a single `const glShip` with its hyperdrive and autopilot state in
// globals. Now any number of ships live in glShips, and every piece of
// per-ship state — hyperdrive, autopilot lock and integral, burst cooldown,
// its own clock — lives on the ship object: a fleet sharing one hyperdrive
// timer is a fleet of one.
//
// `glShip` survives as a `let` pointing at the CONTROLLED ship — Q mode's "last
// ship touched". Most of its call sites really do mean that one ship (mouse
// steering, SPACE, the HUD, the camera): the same trick as `glHole`.
let glShipSeq = 0;

function glMakeShip(x, y) {
    return {
        id: ++glShipSeq,
        x: x, y: y, vx: 0, vy: 0, angle: 0,
        // × GL_S (2026-09-11): a 1,000 km hull cruising at 10,000 km/s.
        baseSpeed: 3 * GL_S, speed: 3 * GL_S, speedMul: 1, size: 18 * GL_S,
        isAlive: true, deathTime: 0,
        // Hyperdrive — per ship. Charge and burn are in SHIP time.
        hyperRemaining: 0, hyperActive: false,
        // Peak speed of the current burn: escaping is a thing you did or did
        // not do, and this says which without watching the HUD at that moment.
        hyperPeakV: 0,
        // Autopilot — per ship. See glAutoOrbitHeading in gl-sim.js.
        autoOrbit: false, autoLock: null, autoErrInt: 0, autoLastBurst: -Infinity,
        autoTarget: null, autoState: "",
        // Time dilation: tau is this frame's clock rate against the lab's
        // (1 normal, 0.01 at a horizon, 2 in a void); clock is accumulated
        // proper time, which the burst cooldown reads instead of the wall
        // clock, so dilation slows the autopilot as well as the ship.
        tau: 1, clock: 0,
        // Fleet.
        group: null, selected: false, homeX: x, homeY: y,
        // Move-leader stall detection: distance to target at the last check,
        // and the ship-clock time of that check. See glLeaderMoveHeading.
        progT: -Infinity, progD: Infinity,
        // Formation follower (2026-09-11): distance to its slot, the slot's
        // position last frame (its velocity is the feed-forward term), and
        // whether it is using drive power to catch up. See glFollowerHeading.
        slotErr: 0, slotPrev: null, slotV: null, boost: false,
        // Ring orbit: phase error against its evenly spaced slot (glUpdateRings).
        ringErr: 0,
        // Ultradrive (gl-ultra.js): "" | "charging" | "active"; the charge in
        // lab seconds; seconds since launch (the speed ramp reads it).
        ultraState: "", ultraCharge: 0, ultraT: 0,
        // Trajectory lock (2026-09-12): a held heading in radians, or null.
        // Right-click while flying solo; see glToggleTrajLock in gl-sim.js.
        trajLock: null, trajLockT: 0,
        // What killed it, when it was a body rather than a horizon (HUD).
        deathCause: ""
    };
}

const glShips = [];
let glShip = glMakeShip(0, 0);
glShips.push(glShip);

function glSpawnShip(x, y) {
    // Never inside a horizon or a planet (gap found 2026-09-10: F at the
    // cursor over a hole spawned a ship that died on its first frame).
    const p = glClearPoint(x, y, 300 * GL_S);
    const s = glMakeShip(p.x, p.y);
    s.angle = Math.random() * Math.PI * 2;
    glShips.push(s);
    return s;
}

// Input mode: "q" = direct control of glShip, "e" = fleet command.
let glMode = "q";
const glPan = { x: 0, y: 0 };  // arrow-key pan direction
let glDrag = null;              // box select in progress: { x0, y0, x1, y1, add }

// Where "the player is" for anything that asks: the controlled ship in Q, the
// camera in E (where there is no single ship being flown). Used by the lens
// approach boost.
function glFocusPoint() { return glMode === "q" ? glShip : glCamera; }

// ===================================================
//                  HYPERDRIVE
// ===================================================
// History: gyro-space's 3x dash → a hold-SPACE-to-charge hyperdrive
// (2026-09-08, the dash escaped no well) → since 2026-09-11 GEARS on
// Shift+wheel with SPACE = gear 0 (glShiftGear, gl-sim.js). No charge: a
// real-scale galaxy needs speeds from 10,000 km/s to a light-year a second.
// Per-ship burst state (hyperActive/hyperRemaining) remains for the AI.

// ===================================================
//              THE BLACK HOLE
// ===================================================
// Position comes from sliders rather than being fixed, so a tester can drag the
// hole under the ship and watch the near-field behaviour without having to fly
// there. Radii are derived, never stored, so a mid-flight r_s change is
// immediately consistent everywhere.
// There can be several. `glHoles` is the authority; the panel edits whichever
// one `glSelectedHoleIndex` points at, through GL_HOLE_KEYS (gl-params.js).
//
// Radii are DERIVED at read time, never stored, so changing r_s mid-flight is
// immediately consistent for the horizon test, the photon ring and the ISCO
// guide at once.
const glHoles = [];
let glSelectedHoleIndex = 0;

// Mass the size rule gives a hole of this r_s (before its own massX).
//   Feel (default):  M = K·R²      — same arcade peak pull at every size.
//   Physical:        M ∝ r_s       — anchored to agree with the feel rule at
//                                    the 50x average, so toggling it changes
//                                    how small and large holes compare, not
//                                    how the average one feels.
function glMassRule(rs) {
    const R = rs * GLP.v.influenceX;
    if (!GLP.v.massPhysical) return GL_MASS_K * R * R;
    const rsRef = 50 * GLP.v.sizeUnit;
    const Rref = rsRef * GLP.v.influenceX;
    return GL_MASS_K * Rref * Rref * (rs / rsRef);
}

// Influence and mass are GETTERS, not stored fields: resizing a hole (or
// moving the global influence / size sliders) moves its well and its pull in
// the same instant, everywhere. That is what "influence scales with size"
// means in code — there is no second number that can fall out of step.
function glMakeHole(v) {
    return {
        x: v.bhX, y: v.bhY,
        rs: v.rs, massX: v.massX,
        photonRing: v.photonRing, spin: v.spin,
        get wellRadius() { return this.rs * GLP.v.influenceX; },
        get mass() { return glMassRule(this.rs) * this.massX; },
        get photon() { return this.rs * this.photonRing; },
        get isco() { return this.rs * 3; }
    };
}

// Hole sizes, as multiples of the size unit: min 10x, mean ~50x, a minority
// reaching 200x. A two-part mixture rather than a lognormal because it hits
// all three stated numbers exactly and is readable at a glance:
//   90%  uniform 10x-72x   (mean 41)
//   10%  uniform 72x-200x  (mean 136)
//   overall mean 0.9·41 + 0.1·136 = 50.5; ~8.6% above 90x.
// Verified by sampling in-page (see gyro-lab/CLAUDE.md).
// `rnd` defaults to Math.random; the chunk generator passes its seeded one so
// a procedural hole's size is the same on every visit.
function glSampleSizeMultiple(rnd) {
    rnd = rnd || Math.random;
    return rnd() < 0.9
        ? 10 + rnd() * 62
        : 72 + rnd() * 128;
}

// Creates a hole from the CURRENT slider values and selects it. Used at boot
// for hole #1 (the 50x average) and by Reset.
function glAddHoleFromParams(atX, atY) {
    const h = glMakeHole(GLP.v);
    if (atX !== undefined) { h.x = atX; h.y = atY; }
    glHoles.push(h);
    glSelectedHoleIndex = glHoles.length - 1;
    glPullParamsFromHole();
    return h;
}

// (glAddRandomHole, glGenerateField and glRemoveSelectedHole went 2026-09-12
// with the black-hole panel section and the N / Tab keys: holes come from the
// galaxy now — Sgr A* and the chunk streamer's stellar holes.)

// Somewhere the ship can appear without being inside anything: beside Earth
// (2026-09-11; was just outside the nearest hole's influence), then pushed
// clear of any well it happens to land in.
function glSafeSpawn(s) {
    s = s || glShip;
    const e = glSolBody("EARTH");
    let x = 0, y = 0;
    if (e) { x = e.x; y = e.y + e.wellRadius + 400 * GL_S; }
    for (let pass = 0; pass < 8; pass++) {
        let moved = false;
        // Every hazard — holes AND star-system bodies (2026-09-10).
        const hz = glHazards();
        for (let i = 0; i < hz.length; i++) {
            const o = { x: hz[i].b.x, y: hz[i].b.y, wellRadius: hz[i].well };
            const d = Math.hypot(x - o.x, y - o.y);
            if (d < o.wellRadius + 200 * GL_S) {
                const ux = d > 1e-6 ? (x - o.x) / d : 0, uy = d > 1e-6 ? (y - o.y) / d : 1;
                x = o.x + ux * (o.wellRadius + 400 * GL_S);
                y = o.y + uy * (o.wellRadius + 400 * GL_S);
                moved = true;
            }
        }
        if (!moved) break;
    }
    s.x = x; s.y = y;
    s.vx = 0; s.vy = 0;
}

// The selected hole. `glHole` is kept as a name because most call sites mean
// exactly "the hole the sliders are pointed at" — the HUD, the radii guides,
// the shift-click probe drop. Anything that must consider ALL holes (gravity,
// the horizon test, the lens pass) iterates glHoles instead and does not go
// through here.
const glHole = {
    get ref() { return glHoles[glSelectedHoleIndex] || glHoles[0]; },
    get x() { return this.ref.x; },
    get y() { return this.ref.y; },
    get rs() { return this.ref.rs; },
    get photon() { return this.ref.photon; },
    get isco() { return this.ref.isco; },
    get wellRadius() { return this.ref.wellRadius; }
};

// The two halves of the "sliders edit the selected hole" contract.
function glPullParamsFromHole() {
    const h = glHoles[glSelectedHoleIndex];
    if (!h) return;
    GLP.v.bhX = h.x; GLP.v.bhY = h.y;
    GLP.v.massX = h.massX; GLP.v.rs = h.rs;
    GLP.v.photonRing = h.photonRing; GLP.v.spin = h.spin;
}

function glPushParamsToHole() {
    const h = glHoles[glSelectedHoleIndex];
    if (!h) return;
    h.x = GLP.v.bhX; h.y = GLP.v.bhY;
    h.massX = GLP.v.massX; h.rs = GLP.v.rs;
    h.photonRing = GLP.v.photonRing; h.spin = GLP.v.spin;
}

// Nearest hole by centre distance. The autopilot's "nearest celestial body",
// and what the HUD reports range to.
function glNearestHole(x, y) {
    let best = null, bestD = Infinity;
    for (let i = 0; i < glHoles.length; i++) {
        const d = Math.hypot(x - glHoles[i].x, y - glHoles[i].y);
        if (d < bestD) { bestD = d; best = glHoles[i]; }
    }
    return best;
}

// ===================================================
//                  STARFIELD
// ===================================================
// 6,000 rather than gyro-space's 50,000. The starfield-displacement lens method
// touches every star every frame, so the count is a real cost here in a way it
// is not in the parent game, and 6,000 is enough to read the distortion.
const GL_STAR_COUNT = 6000;
const glStars = [];
for (let i = 0; i < GL_STAR_COUNT; i++) {
    glStars.push({
        x: (Math.random() - 0.5) * 6000,
        y: (Math.random() - 0.5) * 6000,
        size: Math.random() * 1.6 + 0.4
    });
}

// The starfield TILES (2026-09-10). It is a ±3,000 patch offset by 5% of the
// camera position for parallax; at 40,000,000 out that offset is 2,000,000
// and the whole patch was off-screen. Wrapping the offset into the patch makes
// the sky endless, and changes nothing near the origin.
function glStarWrap(d) { return ((d + 3000) % 6000 + 6000) % 6000 - 3000; }

// The starfield's parallax offset, ACCUMULATED from camera motion with a
// per-frame cap (2026-09-11). It was camera × 0.05 read directly, which at
// ultradrive speed (30,000 units/frame) moves the sky 1,500 px a frame across
// a 6,000 px wrapping patch: the stars strobe instead of streaming. Below the
// cap — every speed the lab had before — it moves exactly as camera × 0.05.
const GL_STAR_PARALLAX = 0.05;
const GL_STAR_MAXSTEP = 45;   // px per frame
const glStarOff = { x: 0, y: 0, camX: NaN, camY: NaN };
function glUpdateStarOffset() {
    if (isNaN(glStarOff.camX)) {
        glStarOff.x = glCamera.x * GL_STAR_PARALLAX;
        glStarOff.y = glCamera.y * GL_STAR_PARALLAX;
    } else {
        let dx = (glCamera.x - glStarOff.camX) * GL_STAR_PARALLAX;
        let dy = (glCamera.y - glStarOff.camY) * GL_STAR_PARALLAX;
        const m = Math.hypot(dx, dy);
        if (m > GL_STAR_MAXSTEP) { dx *= GL_STAR_MAXSTEP / m; dy *= GL_STAR_MAXSTEP / m; }
        glStarOff.x += dx;
        glStarOff.y += dy;
    }
    glStarOff.camX = glCamera.x;
    glStarOff.camY = glCamera.y;
}

// ===================================================
//                  ASTEROIDS
// ===================================================
// 2026-09-11: every asteroid is a BELT ROCK on a Kepler rail (gl-galaxy.js
// glBeltRocks), placed with its system (glPlaceSystem) — the free home field
// and the per-chunk drifting rocks are gone. This array is still what the
// draw loops over.
const glAsteroids = [];

function glAsteroidShape(size) {
    const points = 7 + Math.floor(Math.random() * 4);
    const shape = [];
    for (let i = 0; i < points; i++) {
        const a = (i / points) * Math.PI * 2;
        const j = 0.65 + Math.random() * 0.5;
        shape.push({ x: Math.cos(a) * size * j, y: Math.sin(a) * size * j });
    }
    return shape;
}


// ===================================================
//                  BULLETS
// ===================================================
const glBullets = [];
const GL_MAX_BULLETS = 220;

function glFire(x, y, angle) {
    if (glBullets.length >= GL_MAX_BULLETS) return;
    glBullets.push({
        x, y,
        vx: Math.cos(angle) * 12 * GL_S,
        vy: Math.sin(angle) * 12 * GL_S,
        life: 200,
        size: 3,
        color: "#FFB000"
    });
    glAudioShot();   // gl-audio.js, 2026-09-12 — only a shot actually fired makes a sound
}

// ===================================================
//              TEST PROBES
// ===================================================
// Massless tracers. The single most useful thing in this build: a gravity model
// is much easier to judge from 120 free-falling particles drawing their own
// orbits than from one ship you are also trying to steer.
const glProbes = [];

function glSpawnProbe(x, y, vx, vy) {
    glProbes.push({ x, y, vx, vy, trail: [], captured: false, age: 0 });
}

// Seeds probes on circular-ish orbits around the hole, spread over a range of
// radii, so precession and ISCO behaviour show up immediately rather than
// needing to be aimed for by hand.
// Probes are dealt round-robin across every hole, so adding a second one
// immediately populates it instead of leaving it bare until a reseed.
function glSeedProbeAt(hole) {
    // Inside the well, between just above the horizon and its edge. This used
    // to be `3·r_s + rand·well`, which put up to a third of probes OUTSIDE the
    // arcade well where there is no force to orbit — invisible at small sizes,
    // a field of motionless dots at big ones.
    const r = hole.rs * 1.2 + Math.random() * Math.max(1, hole.wellRadius - hole.rs * 1.2);
    const a = Math.random() * Math.PI * 2;
    // Circular-orbit speed for the CURRENT model AND this hole's own mass, so
    // a light companion does not get seeded at its heavy neighbour's speeds.
    const vCirc = Math.sqrt(Math.max(0, glAccelMag(hole, r) * r));
    const jitter = 0.7 + Math.random() * 0.6;
    glSpawnProbe(
        hole.x + Math.cos(a) * r,
        hole.y + Math.sin(a) * r,
        -Math.sin(a) * vCirc * jitter,
        Math.cos(a) * vCirc * jitter
    );
}

// Only at holes near the focus (2026-09-10): in the streamed world a probe
// seeded at a far pinned hole would sit outside the loaded range and be culled
// the same frame, forever.
function glSeedProbes() {
    glProbes.length = 0;
    const near = glHolesNearFocus();
    if (!near.length) return;
    const n = GLP.v.probeCount;
    for (let i = 0; i < n; i++) glSeedProbeAt(near[i % near.length]);
}

function glHolesNearFocus() {
    const fp = glFocusPoint(), range = glFocusRange();
    return glHoles.filter(function (h) { return Math.hypot(h.x - fp.x, h.y - fp.y) < range; });
}

// ===================================================
//                  HELPERS
// ===================================================
function glLerp(a, b, t) { return a + (b - a) * t; }

function glWrapAngle(a) {
    while (a > Math.PI) a -= Math.PI * 2;
    while (a < -Math.PI) a += Math.PI * 2;
    return a;
}

// Plain camera projection. Hole centres, the HUD and everything drawn on the
// visible canvas after the lens pass use this — they must never be warped.
function glWorldToScreenRaw(wx, wy) {
    return {
        x: glCX + (wx - glCamera.x) * glCamera.zoom,
        y: glCY + (wy - glCamera.y) * glCamera.zoom
    };
}

// Vector lens state (2026-09-10). Non-null ONLY while stage 1 draws the world
// under lens method 7; it is the per-frame list of hole lens params built by
// glBuildVecLens() in gl-lens.js. While set, every world point drawn through
// glWorldToScreen is bent by the lens as it is projected — which is the whole
// vector method: warp the geometry, not the pixels. Result may carry `h: true`
// when the bent point lands behind a horizon and must not be drawn.
let glVecLens = null;

function glWorldToScreen(wx, wy) {
    const s = glWorldToScreenRaw(wx, wy);
    return glVecLens ? glLensScreenPoint(s.x, s.y) : s;
}

// Screen position of the hole, needed by every lens method.
function glHoleScreen() { return glWorldToScreenRaw(glHole.x, glHole.y); }

const GL_SHIP_HULL = [[1, 0], [-0.8, -0.6], [-0.35, 0], [-0.8, 0.6]];

// Drawn inside a transform scaled by zoom `z`, so line widths are divided by it:
// SCREEN pixels, not world units (2026-09-12). They were world units — right
// for the old 18-unit hull near zoom 1, but the 1-unit hull is seen at zoom
// 8–400, where the 4-unit glow became a 32–1,600 px haze that swallowed the
// shape: the "fuzzy ship". A faint fill makes it read solid when it is big.
function glStrokeHull(c, size, color, z) {
    const px = 1 / Math.max(z || 1, 1e-6);
    const pts = GL_SHIP_HULL.map(function (p) { return [p[0] * size, p[1] * size]; });
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < pts.length; i++) c.lineTo(pts[i][0], pts[i][1]);
    c.closePath();
    c.lineJoin = "round";
    c.globalAlpha = 0.14;
    c.fillStyle = color;
    c.fill();
    c.globalAlpha = 0.35;
    c.lineWidth = 4 * px;
    c.strokeStyle = color;
    c.stroke();
    c.globalAlpha = 1;
    c.lineWidth = 1.5 * px;
    c.stroke();
}

glResize();
window.addEventListener("resize", glResize);
window.addEventListener("mousemove", function (e) { glMouse.x = e.clientX; glMouse.y = e.clientY; });
