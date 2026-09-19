// ===================================================
//   Gravity Lab — the Milky Way: density formula, star classes, systems, Sol
// ===================================================
// Added 2026-09-11 (GALAXY_PLAN.md). 1 world unit = 1,000 km. Astronomical
// sizes here are REAL; only ship-scale things are scaled (GL_S, gl-params.js).
//
// World origin = the Sun, so float precision is best at home; the galactic
// centre (Sgr A*) is at (0, -26,000 ly). Everything is seeded and ANALYTIC IN
// TIME: an orbit's angle is angle0 + 2π·t/P with t = real seconds since J2000,
// so a system unloaded and reloaded later has its bodies where the clock says.
// Loads after gl-bodies (glMakeBody), before gl-chunks.
"use strict";

const GL_LY = 9.4607e9;          // units per light-year
const GL_AU = 149598;            // units per AU
const GL_GM_SUN = 132.7;         // G·M☉ in units³/s²
const GL_GM_EARTH = 3.986e-4;    // G·M⊕ in units³/s²
const GL_R_SUN = 695.7;          // units
const GL_R_EARTH = 6.371;        // units
const GL_J2000_MS = Date.UTC(2000, 0, 1, 12);
const GL_EPOCH_S = (Date.now() - GL_J2000_MS) / 1000;   // real "now" at page load

// Sim clock for orbits: real time at load, advanced by lab time.
function glSimTimeS() { return GL_EPOCH_S + glWorldTime; }

// Kepler: period in seconds of a circular orbit of radius a (units) about GM.
function glKeplerPeriod(a, gm) { return 2 * Math.PI * Math.sqrt(a * a * a / gm); }

// ===================================================
//                  GALAXY SHAPE
// ===================================================
// All lengths in light-years, galactocentric. See GALAXY_PLAN.md for why each
// number is what it is.
const GL_GAL = {
    cx: 0, cy: -26000 * GL_LY,       // galactic centre in world units
    sunR: 26000, sunPhi: Math.PI / 2, // the Sun, galactocentric
    Rd: 8500,                         // disk scale length
    edge: 48000,                      // disk taper centre
    pitch: 12 * Math.PI / 180,        // arm pitch angle
    perseusR: 32500,                  // Perseus crosses the Sun's azimuth here
    armSigma: 1200,                   // arm half-width (Gaussian σ, ly)
    barAng: Math.PI / 2 - 27 * Math.PI / 180,   // bar axis: 27° off the Sun–centre line
    radius: 50000,                    // nominal disk radius (the world is ±55,000)
    extent: 55000
};
const GL_ARM_NAMES = ["Perseus", "Sagittarius", "Scutum-Centaurus", "Norma"];

// The world's bounds: the galactic centre ± 55,000 ly (the disk's 50,000 plus
// margin). Separate x/y since the origin is the Sun, not the centre.
const GL_WORLD = {
    minX: GL_GAL.cx - GL_GAL.extent * GL_LY, maxX: GL_GAL.cx + GL_GAL.extent * GL_LY,
    minY: GL_GAL.cy - GL_GAL.extent * GL_LY, maxY: GL_GAL.cy + GL_GAL.extent * GL_LY
};

function glSmoothstep(a, b, x) { const t = Math.max(0, Math.min(1, (x - a) / (b - a))); return t * t * (3 - 2 * t); }

// Arm strength 0..1 at (R, phi), which arm, and the Orion spur's share.
// Four log spirals are one m=4 pattern: along the Sun's azimuth the arms sit
// at radius ratios of exp((2π/4)·tan ψ) = 1.396 — Perseus 32.5k, Sagittarius
// 23.3k, Scutum–Centaurus 16.7k, Norma 12k; outward, the Outer arm at 45.4k.
function glGalaxyArm(R, phi) {
    const G = GL_GAL, tp = Math.tan(G.pitch), sp = Math.sin(G.pitch);
    const Rs = Math.max(R, 1);
    const u = 4 * ((phi - G.sunPhi) - Math.log(Rs / G.perseusR) / tp) / (Math.PI * 2);
    const n = Math.round(u);
    const d = Math.abs(u - n) * (Math.PI / 2) * Rs * sp;   // perpendicular distance to the arm, ly
    const k = ((n % 4) + 4) % 4;
    const on = glSmoothstep(11000, 15000, R) * (1 - glSmoothstep(44000, 52000, R));
    const arm = (k % 2 === 0 ? 1 : 0.6) * Math.exp(-d * d / (2 * G.armSigma * G.armSigma)) * on;
    // Orion spur: a short partial arm through the Sun, same pitch.
    const dphi = glWrapAngle(phi - G.sunPhi);
    const ds = Math.abs(dphi - Math.log(Rs / G.sunR) / tp) * Rs * sp;
    const spur = 0.45 * Math.exp(-ds * ds / (2 * 700 * 700)) * Math.exp(-dphi * dphi / (2 * 0.25 * 0.25));
    return { a: Math.max(arm, spur), arm: arm, spur: spur, k: k, n: n };
}

// Relative stellar surface density at galactocentric (x, y) ly — unnormalised.
function glGalaxyShape(xl, yl) {
    const G = GL_GAL;
    const R = Math.hypot(xl, yl), phi = Math.atan2(yl, xl);
    const disk = Math.exp(-R / G.Rd) / (1 + Math.exp((R - G.edge) / 1500));
    const armA = glGalaxyArm(R, phi).a;
    const cb = Math.cos(G.barAng), sb = Math.sin(G.barAng);
    const xb = xl * cb + yl * sb, yb = -xl * sb + yl * cb;
    const bulge = 4 * Math.exp(-Math.hypot(xb, yb / 0.5) / 2600);
    const bar = 0.8 * Math.exp(-Math.pow(Math.hypot(xb, yb / 0.2) / 13000, 4));
    const nucleus = 20 * Math.exp(-R / 200);
    return disk * (0.45 + 1.1 * armA) + bulge + bar + nucleus;
}

// Normalised so the Sun's neighbourhood has 0.025 stars/ly² — mean spacing
// ~6.3 ly, the real local density taken to the 2/3 power, so nearest-star
// distances are real even though a flat slice holds ~10⁸ stars, not 10¹¹.
const GL_GAL_NORM = 0.025 / glGalaxyShape(0, GL_GAL.sunR);

// Stars per ly² at a WORLD position.
function glGalaxyDensity(wx, wy) {
    return GL_GAL_NORM * glGalaxyShape((wx - GL_GAL.cx) / GL_LY, (wy - GL_GAL.cy) / GL_LY);
}

// Galactic "void" 0..1, which gates time dilation's void speed-up (2026-09-11,
// the user's call). Sparse galaxy is void: BETWEEN the arms, and beyond the
// disk. The arms, the Orion spur and the bar/bulge are not. Cached per
// ~0.5 ly, because a frame asks for hundreds of objects in the same
// neighbourhood (ships, probes, belt rocks, particles).
const glVoidCache = { x: NaN, y: NaN, v: 0 };
function glGalaxyVoid(wx, wy) {
    if (Math.abs(wx - glVoidCache.x) < 0.5 * GL_LY && Math.abs(wy - glVoidCache.y) < 0.5 * GL_LY) return glVoidCache.v;
    const xl = (wx - GL_GAL.cx) / GL_LY, yl = (wy - GL_GAL.cy) / GL_LY;
    const R = Math.hypot(xl, yl);
    const arm = glGalaxyArm(R, Math.atan2(yl, xl)).a;          // arms + spur, 0..1
    const core = 1 - glSmoothstep(9000, 15000, R);              // bar / bulge
    const v = 1 - glSmoothstep(0.1, 0.5, Math.max(arm, core));
    glVoidCache.x = wx; glVoidCache.y = wy; glVoidCache.v = v;
    return v;
}

// Where you are, in words (HUD).
function glGalaxyRegion(wx, wy) {
    const xl = (wx - GL_GAL.cx) / GL_LY, yl = (wy - GL_GAL.cy) / GL_LY;
    const R = Math.hypot(xl, yl);
    if (R < 1000) return "galactic nucleus";
    if (R < 11000) return "bar / bulge";
    if (R > GL_GAL.radius) return "beyond the disk";
    const a = glGalaxyArm(R, Math.atan2(yl, xl));
    if (a.spur > 0.2 && a.spur >= a.arm) return "Orion spur";
    if (a.arm < 0.25) return "inter-arm";
    if (a.n < 0 && a.k === 3) return "Outer arm";
    return GL_ARM_NAMES[a.k] + " arm";
}

// Numeric total over the disk (tests/HUD; ~0.3 s, never at boot).
function glGalaxyTotalStars() {
    const step = 250, E = GL_GAL.extent;
    let sum = 0;
    for (let x = -E; x < E; x += step) for (let y = -E; y < E; y += step) sum += glGalaxyShape(x + step / 2, y + step / 2);
    return sum * step * step * GL_GAL_NORM;
}

// ===================================================
//                  STAR CLASSES
// ===================================================
// By number. r in R☉, m in M☉, bin = binary fraction, pl = mean planet count.
const GL_STAR_CLASSES = [
    { c: "M", p: 0.73,    r: [0.1, 0.6],    m: [0.08, 0.45], col: "#FFB56C", bin: 0.27, pl: 1.6 },
    { c: "K", p: 0.12,    r: [0.7, 0.96],   m: [0.45, 0.8],  col: "#FFD2A1", bin: 0.40, pl: 2.2 },
    { c: "G", p: 0.07,    r: [0.96, 1.15],  m: [0.8, 1.04],  col: "#FFF4EA", bin: 0.45, pl: 2.6 },
    { c: "F", p: 0.03,    r: [1.15, 1.4],   m: [1.04, 1.4],  col: "#F8F7FF", bin: 0.45, pl: 2.2 },
    { c: "A", p: 0.006,   r: [1.4, 1.8],    m: [1.4, 2.1],   col: "#CAD7FF", bin: 0.50, pl: 1.2 },
    { c: "B", p: 0.0013,  r: [1.8, 6.6],    m: [2.1, 16],    col: "#AABFFF", bin: 0.70, pl: 0.4 },
    { c: "O", p: 0.00003, r: [6.6, 12],     m: [16, 60],     col: "#9BB0FF", bin: 0.70, pl: 0.1 },
    { c: "D", p: 0.04,    r: [0.008, 0.02], m: [0.5, 0.8],   col: "#E6ECFF", bin: 0.20, pl: 0.3 },   // white dwarf
    { c: "g", p: 0.004,   r: [10, 100],     m: [0.8, 3],     col: "#FFB080", bin: 0.30, pl: 0.8 }    // K/M giant
];
const GL_CLASS_CUM = (function () {
    let t = 0; const tot = GL_STAR_CLASSES.reduce(function (s, c) { return s + c.p; }, 0);
    return GL_STAR_CLASSES.map(function (c) { t += c.p / tot; return t; });
})();

function glSampleClass(rnd) {
    const u = rnd();
    for (let i = 0; i < GL_CLASS_CUM.length; i++) if (u < GL_CLASS_CUM[i]) return i;
    return 0;
}
// Main-sequence class for a mass (binary companions).
function glClassForMass(m) {
    for (let i = 0; i < 7; i++) if (m <= GL_STAR_CLASSES[i].m[1]) return i;
    return 6;
}
function glLerp2(r, t) { return r[0] + (r[1] - r[0]) * t; }

function glGauss(rnd) { return Math.sqrt(-2 * Math.log(1 - rnd())) * Math.cos(Math.PI * 2 * rnd()); }
function glPoisson(lam, rnd) {
    if (lam <= 0) return 0;
    if (lam > 30) return Math.max(0, Math.round(lam + Math.sqrt(lam) * glGauss(rnd)));
    const L = Math.exp(-lam);
    let k = 0, p = 1;
    do { k++; p *= rnd(); } while (p > L);
    return k - 1;
}

// ===================================================
//                  SYSTEM BUILDER
// ===================================================
const GL_ROCKY_COL = ["#B7B1A8", "#C9A27E", "#D9744B", "#9BC53D", "#81B29A", "#E5989B"];
const GL_ICE_COL = ["#9FE3E8", "#5B7FDE", "#6D9DC5"];
const GL_GAS_COL = ["#D8B58A", "#E6D3A3", "#F4A261", "#C9A27E"];
const GL_PLANET_LETTERS = "bcdefghijk";
const GL_ROMAN_MOON = ["I", "II", "III", "IV"];

function glPick(arr, rnd) { return arr[Math.floor(rnd() * arr.length)]; }

function glStarBody(name, cls, t, rnd, parent, orbitR, periodS, angle0) {
    const C = GL_STAR_CLASSES[cls];
    const rs = glLerp2(C.r, t) * GL_R_SUN;
    return glMakeBody({
        name: name, kind: "star", cls: cls, parent: parent, orbitR: orbitR, periodS: periodS, angle0: angle0,
        rs: rs, wellRadius: Math.min(rs * 6, GL_NEAR_CELL * 0.9), peak: 0.5 * GL_S, dilK: 0.12, color: C.col
    });
}

// Planet by kind: radius in R⊕, mass in M⊕.
function glMakePlanet(kind, rnd) {
    let R, M, col;
    if (kind === "rocky")      { R = 0.3 + rnd() * 1.3; M = Math.pow(R, 3.3); col = glPick(GL_ROCKY_COL, rnd); }
    else if (kind === "super") { R = 1.6 + rnd() * 1.9; M = 2.7 * Math.pow(R, 1.3); col = glPick(GL_ICE_COL.concat(GL_ROCKY_COL), rnd); }
    else if (kind === "ice")   { R = 3.5 + rnd() * 1.0; M = 14 + rnd() * 6; col = glPick(GL_ICE_COL, rnd); }
    else                        { R = 9 + rnd() * 4; M = 50 + rnd() * 950; col = glPick(GL_GAS_COL, rnd); }
    return { R: R, M: M, col: col };
}

function glPlanetBody(name, pk, parent, a, gmHost, rnd) {
    const rs = pk.R * GL_R_EARTH;
    return glMakeBody({
        name: name, kind: "planet", parent: parent, orbitR: a, angle0: rnd() * Math.PI * 2,
        periodS: glKeplerPeriod(a, gmHost), rs: rs, wellRadius: rs * 5,
        peak: GL_S * (0.12 + 0.2 * Math.min(1, rs / 70)), dilK: 0.05, color: pk.col, gm: GL_GM_EARTH * pk.M
    });
}

function glMoonBody(name, parent, a, rsMoon, rnd, retro) {
    return glMakeBody({
        name: name, kind: "moon", parent: parent, orbitR: a, angle0: rnd() * Math.PI * 2,
        periodS: glKeplerPeriod(a, parent.gm) * (retro ? -1 : 1), rs: rsMoon, wellRadius: rsMoon * 4,
        peak: GL_S * 0.08, dilK: 0.03, color: "#C8C8C0"
    });
}

// Belt rocks: kinematic rocks on circular Kepler orbits, enlarged (not to
// scale, like the ship). Returned; glRegisterSystem puts them in glAsteroids.
function glBeltRocks(sys, host, gmHost, rIn, rOut, count, rnd) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const r = rIn + rnd() * (rOut - rIn);
        const size = (0.2 + rnd() * 0.6) * GL_S * 18;   // 0.2–0.8 units
        out.push({
            rail: true, parent: host, orbitR: r, angle0: rnd() * Math.PI * 2, periodS: glKeplerPeriod(r, gmHost),
            x: host.x, y: host.y, vx: 0, vy: 0, size: size, shape: glAsteroidShape(size),
            rotation: rnd() * Math.PI * 2, rotationSpeed: (rnd() - 0.5) * 0.01, chunkKey: sys.chunkKey, sys: sys
        });
    }
    sys.belts.push({ host: host, rIn: rIn, rOut: rOut });
    return out;
}

// A procedural star system from a chunk-summary star at (x, y). Deterministic
// from ss.seed. Returns a system object (not yet registered).
function glBuildSystem(ss, x, y, chunkKey) {
    const rnd = glRng(ss.seed);
    const C = GL_STAR_CLASSES[ss.cls];
    const centre = { x: x, y: y, vx: 0, vy: 0, name: ss.name };
    const sys = { name: ss.name, centre: centre, stars: [], planets: [], moons: [], order: [], belts: [], rocks: [],
                  reach: 0, home: false, chunkKey: chunkKey || null };
    const t1 = rnd(), m1 = glLerp2(C.m, t1);
    let host = centre, gmHost = GL_GM_SUN * m1, aMin = 0, aMax = 60 * GL_AU;

    if (rnd() < C.bin) {
        // Binary: both stars ride the barycentre on rails.
        const m2 = m1 * (0.1 + 0.9 * rnd());
        const c2 = glClassForMass(m2);
        const C2 = GL_STAR_CLASSES[c2];
        const t2 = Math.max(0, Math.min(1, (m2 - C2.m[0]) / (C2.m[1] - C2.m[0])));
        const sepAU = Math.max(0.02, Math.min(5000, Math.pow(10, Math.log10(40) + 1.3 * glGauss(rnd))));
        const sep = sepAU * GL_AU, M = m1 + m2;
        const P = glKeplerPeriod(sep, GL_GM_SUN * M), th = rnd() * Math.PI * 2;
        const A = glStarBody(ss.name + " A", ss.cls, t1, rnd, centre, sep * m2 / M, P, th);
        const B = glStarBody(ss.name + " B", c2, t2, rnd, centre, sep * m1 / M, P, th + Math.PI);
        sys.stars.push(A, B);
        if (sepAU < 5) { host = centre; gmHost = GL_GM_SUN * M; aMin = 3 * sep; }        // circumbinary (P-type)
        else { host = A; gmHost = GL_GM_SUN * m1; aMax = Math.min(aMax, sep / 3); }     // around A (S-type)
        sys.reach = Math.max(sys.reach, sep);
    } else {
        sys.stars.push(glStarBody(ss.name, ss.cls, t1, rnd, null, 0, 1, 0));
        const S = sys.stars[0];
        S.x = x; S.y = y;
        host = S;
    }
    sys.star = sys.stars[0];

    const Mh = gmHost / GL_GM_SUN;
    const snow = Math.max(0.1, Math.min(50, 2.7 * Mh * Mh)) * GL_AU;
    const giantP = Math.min(1, Mh);
    const nPl = Math.min(10, glPoisson(C.pl * (aMin > 0 ? 0.7 : 1), rnd));
    let a = Math.exp(Math.log(0.03) + rnd() * (Math.log(0.4) - Math.log(0.03))) * Math.sqrt(Mh) * GL_AU;
    a = Math.max(a, aMin);
    for (let i = 0; i < nPl && a < aMax; i++) {
        const u = rnd();
        let kind;
        if (a < snow) kind = (a < 0.1 * GL_AU && u < 0.05 * giantP) ? "gas" : (u < 0.6 ? "rocky" : "super");
        else kind = u < 0.35 * giantP ? "gas" : (u < 0.7 ? "ice" : "rocky");
        const p = glPlanetBody(ss.name + " " + GL_PLANET_LETTERS[i], glMakePlanet(kind, rnd), host, a, gmHost, rnd);
        sys.planets.push(p);
        // Moons: gas giants 1–4, ice giants 0–2, rocky 20% for one.
        const nm = kind === "gas" ? 1 + Math.floor(rnd() * 4) : kind === "ice" ? Math.floor(rnd() * 3) : (rnd() < 0.2 ? 1 : 0);
        let ma = p.rs * (kind === "gas" || kind === "ice" ? 5 + rnd() * 5 : 30 + rnd() * 40);
        for (let j = 0; j < nm; j++) {
            const rm = (kind === "gas" ? 0.1 + rnd() * 0.32 : 0.1 + rnd() * 0.2) * GL_R_EARTH;
            sys.moons.push(glMoonBody(p.name + " " + GL_ROMAN_MOON[j], p, ma, rm, rnd, false));
            ma *= 1.5 + rnd() * 0.6;
        }
        sys.reach = Math.max(sys.reach, a + p.wellRadius);
        a *= 1.4 + rnd() * 1.2;
    }
    // Asteroid belt in a quarter of systems, beyond the snow line.
    if (rnd() < 0.25) {
        const rIn = Math.max(2 * snow, aMin), rOut = Math.min(4 * snow, aMax);
        if (rOut > rIn) sys.rocks = sys.rocks.concat(glBeltRocks(sys, host, gmHost, rIn, rOut, 120, rnd));
    }
    sys.order = sys.stars.concat(sys.planets, sys.moons);
    sys.reach = Math.max(sys.reach, sys.star.wellRadius);
    return sys;
}

// ===================================================
//                  SOL (pinned, real)
// ===================================================
// a (AU), P (days), radius (km), L0 (mean longitude at J2000, deg), mass (M⊕).
const GL_SOL_PLANETS = [
    ["Mercury", 0.387, 87.969, 2439.7, 252.25, 0.055, "#B7B1A8"],
    ["Venus",   0.723, 224.70, 6051.8, 181.98, 0.815, "#E8CDA0"],
    ["Earth",   1.000, 365.256, 6371.0, 100.46, 1.0,  "#6FA8DC"],
    ["Mars",    1.524, 686.98, 3389.5, 355.45, 0.107, "#D9744B"],
    ["Jupiter", 5.203, 4332.59, 69911, 34.40, 317.8,  "#D8B58A"],
    ["Saturn",  9.537, 10759.2, 58232, 49.94, 95.2,   "#E6D3A3"],
    ["Uranus",  19.19, 30688.5, 25362, 313.23, 14.5,  "#9FE3E8"],
    ["Neptune", 30.07, 60182,   24622, 304.88, 17.1,  "#5B7FDE"]
];
// planet, moon, radius (km), a (km), P (days; negative = retrograde)
const GL_SOL_MOONS = [
    ["Earth", "Moon", 1737.4, 384400, 27.322], ["Mars", "Phobos", 11.3, 9376, 0.3189], ["Mars", "Deimos", 6.2, 23463, 1.263],
    ["Jupiter", "Io", 1821.6, 421700, 1.769], ["Jupiter", "Europa", 1560.8, 671034, 3.551],
    ["Jupiter", "Ganymede", 2634.1, 1070412, 7.155], ["Jupiter", "Callisto", 2410.3, 1882709, 16.689],
    ["Saturn", "Titan", 2574.7, 1221870, 15.945], ["Saturn", "Rhea", 763.8, 527108, 4.518],
    ["Uranus", "Titania", 788.9, 435910, 8.706], ["Uranus", "Oberon", 761.4, 583520, 13.463],
    ["Neptune", "Triton", 1353.4, 354759, -5.877]
];

function glBuildSol() {
    const rnd = glRng(1977);
    const sun = glMakeBody({ name: "SOL", kind: "star", cls: 2, parent: null, orbitR: 0, periodS: 1, angle0: 0,
        x: 0, y: 0, rs: GL_R_SUN, wellRadius: GL_R_SUN * 6, peak: 0.5 * GL_S, dilK: 0.12, color: "#FFF4EA" });
    const sys = { name: "SOL", centre: { x: 0, y: 0, vx: 0, vy: 0 }, stars: [sun], star: sun, planets: [], moons: [],
                  order: [], belts: [], rocks: [], reach: 0, home: true, chunkKey: null };
    const byName = {};
    GL_SOL_PLANETS.forEach(function (d) {
        const rs = d[3] / 1000, P = d[2] * 86400;
        // angle0 chosen so the angle at J2000 is the real mean longitude.
        const p = glMakeBody({ name: d[0].toUpperCase(), kind: "planet", parent: sun, orbitR: d[1] * GL_AU, periodS: P,
            angle0: d[4] * Math.PI / 180, rs: rs, wellRadius: rs * 5, peak: GL_S * (0.12 + 0.2 * Math.min(1, rs / 70)),
            dilK: 0.05, color: d[6], gm: GL_GM_EARTH * d[5] });
        sys.planets.push(p);
        byName[d[0]] = p;
        sys.reach = Math.max(sys.reach, p.orbitR + p.wellRadius);
    });
    GL_SOL_MOONS.forEach(function (d) {
        const host = byName[d[0]], rs = d[2] / 1000;
        sys.moons.push(glMakeBody({ name: d[1].toUpperCase(), kind: "moon", parent: host, orbitR: d[3] / 1000,
            periodS: d[4] * 86400, angle0: rnd() * Math.PI * 2, rs: rs, wellRadius: rs * 4, peak: GL_S * 0.08,
            dilK: 0.03, color: "#C8C8C0" }));
    });
    // Main belt and Kuiper belt.
    sys.rocks = glBeltRocks(sys, sun, GL_GM_SUN, 2.2 * GL_AU, 3.3 * GL_AU, 160, rnd)
        .concat(glBeltRocks(sys, sun, GL_GM_SUN, 30 * GL_AU, 50 * GL_AU, 220, rnd));
    sys.reach = Math.max(sys.reach, 50 * GL_AU);
    sys.order = sys.stars.concat(sys.planets, sys.moons);
    return sys;
}

function glSolBody(name) {
    const sys = glStarSystems.filter(function (s) { return s.home; })[0];
    if (!sys) return null;
    return sys.order.filter(function (b) { return b.name === name; })[0] || null;
}

// Sgr A*: the pinned hole at the galactic centre, true size (the r_s default
// in gl-params is its 12,250 units = 4.15M M☉).
function glAddCoreHole() {
    const h = glAddHoleFromParams(GL_GAL.cx, GL_GAL.cy);
    h.name = "SGR A*";
    return h;
}
