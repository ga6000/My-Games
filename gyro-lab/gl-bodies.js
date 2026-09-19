// ===================================================
//   Gravity Lab — star systems: stars and planets on fixed orbits
// ===================================================
// Added 2026-09-10 (STARS_MAP_PLAN.md). Two stars, ten planets each. Planets
// ride fixed circular orbits ("on rails") — no body pulls on any other body.
// Bodies DO pull on, and block, small objects: ships, asteroids, bullets,
// probes, particles. That is exactly the requested split: the scenery is
// kinematic, the things you fly among it are dynamic.
//
// Bodies deliberately duck-type as holes where it helps — x, y, rs (surface
// radius), wellRadius, spin, vx/vy — so the autopilot, the auto-zoom and the
// lock-ring drawing work on a planet unchanged. They are NOT in glHoles, so
// they never lens, never use the black-hole gravity models, and never count as
// horizons.
"use strict";

const glStarSystems = [];   // { star, planets[], reach }
const glBodies = [];        // flat list: every star and planet

// Deterministic PRNG (mulberry32). A bench whose scenery reshuffles on every
// reload cannot be compared across runs.
function glRng(seed) {
    return function () {
        seed |= 0; seed = seed + 0x6D2B79F5 | 0;
        let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
        t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
        return ((t ^ t >>> 14) >>> 0) / 4294967296;
    };
}

// 2026-09-11 (GALAXY_PLAN.md): the two hand-made systems (VESPER, HALCYON) are
// gone. Systems are built by gl-galaxy.js — the real Sol, pinned, and
// procedural ones from the chunk summaries — and every body rides a circular
// Kepler orbit about a PARENT: a star, a binary's barycentre, or (for a moon)
// a planet. Real periods, so at real-time speed they look still.
function glMakeBody(o) {
    return Object.assign({ vx: 0, vy: 0, spin: 1, massX: 1, parent: null, orbitR: 0, angle0: 0, periodS: 1, angle: 0 }, o);
}

// Position and velocity are ANALYTIC in time t (real seconds since J2000), not
// accumulated. That is what makes a system unloaded and revisited an hour
// later come back with its bodies an hour along their orbits, and it makes
// velocity exact — the autopilot's feed-forward reads it. Parents are placed
// before children (sys.order), so a moon rides its planet's current position.
function glPlaceBody(b, t) {
    const p = b.parent;
    if (!p) return;
    const w = Math.PI * 2 / b.periodS;       // rad/s; a negative period is retrograde
    const a = b.angle0 + w * t;
    const c = Math.cos(a), s = Math.sin(a);
    b.angle = a;
    b.x = p.x + c * b.orbitR;
    b.y = p.y + s * b.orbitR;
    b.vx = (p.vx || 0) - s * b.orbitR * w / 60;   // world units per frame at 60 fps
    b.vy = (p.vy || 0) + c * b.orbitR * w / 60;
}

// Belt rocks are kinematic too (gl-galaxy.js glBeltRocks): placed here, not integrated.
function glPlaceSystem(sys, t) {
    for (let i = 0; i < sys.order.length; i++) glPlaceBody(sys.order[i], t);
    for (let i = 0; i < sys.rocks.length; i++) glPlaceBody(sys.rocks[i], t);
}

// A built system joins the loaded lists: bodies into glBodies, rocks into glAsteroids.
function glRegisterSystem(sys) {
    glPlaceSystem(sys, glSimTimeS());
    glStarSystems.push(sys);
    for (let i = 0; i < sys.order.length; i++) glBodies.push(sys.order[i]);
    for (let i = 0; i < sys.rocks.length; i++) glAsteroids.push(sys.rocks[i]);
    return sys;
}

// The streamer's unload: the system, all its bodies and its belt rocks leave.
function glRemoveStarSystem(sys) {
    const i = glStarSystems.indexOf(sys);
    if (i !== -1) glStarSystems.splice(i, 1);
    const gone = new Set(sys.order);
    for (let j = glBodies.length - 1; j >= 0; j--) if (gone.has(glBodies[j])) glBodies.splice(j, 1);
    for (let j = glAsteroids.length - 1; j >= 0; j--) if (glAsteroids[j].sys === sys) glAsteroids.splice(j, 1);
}

// The pinned home system: the real Sol (gl-galaxy.js).
function glCreateStarSystems() {
    if (glStarSystems.some(function (s) { return s.home; })) return;
    glRegisterSystem(glBuildSol());
}

// Rails: lab time, not dilated — the bodies are the stage, not the actors.
function glUpdateBodies(dt) {
    const t = glSimTimeS();
    for (let i = 0; i < glStarSystems.length; i++) glPlaceSystem(glStarSystems[i], t);
}

// Pull on a small object, added into out.ax / out.ay by glGravityAt(). An
// arcade-style ramp normalised so the pull AT THE SURFACE is exactly `peak`,
// falling to zero at the well edge. Bodies do not use the black-hole models:
// a Paczynski-Wiita planet would have an ISCO, which planets do not.
function glBodiesGravity(x, y, out) {
    if (!GLP.v.bodiesGravity) return;
    const L = glNear(x, y).bodies;   // exact: no well reaches past the 3×3
    for (let i = 0; i < L.length; i++) {
        const b = L[i];
        const dx = b.x - x, dy = b.y - y;
        const r = Math.hypot(dx, dy);
        if (r > b.wellRadius || r < 1e-6) continue;
        const t = Math.min(1, (b.wellRadius - r) / (b.wellRadius - b.rs));
        const a = b.peak * Math.pow(t, 1.4);
        out.ax += dx / r * a;
        out.ay += dy / r * a;
    }
}

// Their share of the time-dilation potential u (see glTimeFactor). Mild on
// purpose: a star's surface reads τ ≈ 0.88, a planet's ≈ 0.95, at power 2.
function glBodiesDilation(x, y) {
    let u = 0;
    const L = glNear(x, y).bodies;   // long-range potential, cut at the 3×3 (see glNear)
    for (let i = 0; i < L.length; i++) {
        const b = L[i];
        u += b.dilK * b.rs / Math.max(Math.hypot(x - b.x, y - b.y), b.rs * 0.5);
    }
    return u;
}

// Segment test, like the horizon one: a ship at hyperdrive speed can cross a
// small planet between frames.
function glBodyHit(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, len2 = dx * dx + dy * dy;
    const L = glNear(x0, y0).bodies;
    for (let i = 0; i < L.length; i++) {
        const b = L[i];
        let t = len2 > 1e-9 ? ((b.x - x0) * dx + (b.y - y0) * dy) / len2 : 0;
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(x0 + dx * t - b.x, y0 + dy * t - b.y) < b.rs) return b;
    }
    return null;
}

function glBodyAt(x, y) {
    const L = glNear(x, y).bodies;
    for (let i = 0; i < L.length; i++) {
        const b = L[i];
        if (Math.hypot(x - b.x, y - b.y) < b.rs) return b;
    }
    return null;
}

// ===================================================
//      Hazards: holes and bodies behind one interface
// ===================================================
// Everything a ship can fall into or hit: { b, surface, well, vx, vy }. The
// escape rule, target/slot clearance and safe spawning all read this one list,
// so a new kind of body is safe the moment it is added here.
//
// CACHED once per frame (2026-09-10). It was rebuilt on every call — per ship
// per frame for the escape rule, per follower for slot clearance, per idle
// ship for its loiter centre — and the streamed world loads far more bodies.
// Entries read the body LIVE through getters (a planet's position and
// velocity, a hole's edited r_s), so caching the list costs no freshness; the
// key only has to catch bodies arriving and leaving.
let glHazardCache = null;
let glHazardKey = "";
function glHazards() {
    const key = glFrameNo + ":" + glHoles.length + ":" + glBodies.length;
    if (glHazardCache && key === glHazardKey) return glHazardCache;
    const out = [];
    const all = glHoles.concat(glBodies);
    for (let i = 0; i < all.length; i++) {
        out.push({
            b: all[i],
            get surface() { return this.b.rs; },
            get well() { return this.b.wellRadius; },
            get vx() { return this.b.vx || 0; },
            get vy() { return this.b.vy || 0; }
        });
    }
    glHazardCache = out;
    glHazardKey = key;
    return out;
}

// ===================================================
//      SPATIAL QUERY — what is near (x, y)
// ===================================================
// Added 2026-09-10 after measurement: with 10 fleet ships spread over 99
// chunks (276 bodies, 25 holes loaded) a simulate step took 22 ms, because
// every probe, asteroid and ship still looped over EVERY loaded body. Loading
// by chunk bounded the world; this bounds each query.
//
// Returns the holes, bodies and hazard entries in the point's chunk and the 8
// around it. The largest single reach (a 200x hole's influence, ~19,600) is
// under GL_CHUNK (60,000), so for gravity, horizons and surfaces this is
// EXACT — nothing outside the 3×3 can reach the point. Time dilation is the
// one approximation: its potential is long-range and is now cut at the 3×3,
// which the chunking plan called for (a "void" = nothing within a chunk).
//
// Rebuilt at most once per frame (keyed like the hazard cache); each 3×3
// union is cached per chunk, so the hundreds of probes and asteroids sharing
// a few chunks cost one Map lookup each.
// 2026-09-11: its own grid, not the chunks. Chunks are now 1 ly across and a
// core chunk can hold a dozen systems, so a 3×3-CHUNK query handed every probe
// ~2,000 bodies. 4M-unit cells, with every well capped under a cell (stars at
// 0.9 cell), keep "nothing outside the 3×3 can reach the point" — exact.
const GL_NEAR_CELL = 4e6;
function glNearCellOf(v) { return Math.floor(v / GL_NEAR_CELL); }

let glNearIndex = null;
let glNearKey = "";
function glNear(x, y) {
    const key = glFrameNo + ":" + glHoles.length + ":" + glBodies.length;
    if (!glNearIndex || key !== glNearKey) {
        glNearKey = key;
        const cells = new Map();
        const hz = glHazards();   // holes first, then bodies — same order as glHoles.concat(glBodies)
        for (let i = 0; i < hz.length; i++) {
            const e = hz[i];
            const k = glChunkKey(glNearCellOf(e.b.x), glNearCellOf(e.b.y));
            let c = cells.get(k);
            if (!c) { c = { holes: [], bodies: [], hazards: [] }; cells.set(k, c); }
            if (i < glHoles.length) c.holes.push(e.b); else c.bodies.push(e.b);
            c.hazards.push(e);
        }
        glNearIndex = { cells: cells, q: new Map() };
    }
    const cx = glNearCellOf(x), cy = glNearCellOf(y);
    const qk = glChunkKey(cx, cy);
    let r = glNearIndex.q.get(qk);
    if (r) return r;
    r = { holes: [], bodies: [], hazards: [] };
    for (let dx = -1; dx <= 1; dx++) {
        for (let dy = -1; dy <= 1; dy++) {
            const c = glNearIndex.cells.get(glChunkKey(cx + dx, cy + dy));
            if (!c) continue;
            for (let j = 0; j < c.holes.length; j++) r.holes.push(c.holes[j]);
            for (let j = 0; j < c.bodies.length; j++) r.bodies.push(c.bodies[j]);
            for (let j = 0; j < c.hazards.length; j++) r.hazards.push(c.hazards[j]);
        }
    }
    glNearIndex.q.set(qk, r);
    return r;
}

// Pushes (x, y) radially out of any hazard's surface + clearance. A few passes,
// because pushing clear of one body can land the point on another.
function glClearPoint(x, y, clearance) {
    const hz = glNear(x, y).hazards;
    for (let pass = 0; pass < 4; pass++) {
        let moved = false;
        for (let i = 0; i < hz.length; i++) {
            const e = hz[i];
            const dx = x - e.b.x, dy = y - e.b.y;
            const d = Math.hypot(dx, dy);
            const need = e.surface + clearance;
            if (d < need) {
                const ux = d > 1e-3 ? dx / d : 0, uy = d > 1e-3 ? dy / d : 1;
                x = e.b.x + ux * need;
                y = e.b.y + uy * need;
                moved = true;
            }
        }
        if (!moved) break;
    }
    return { x: x, y: y };
}

// Nearest hole OR body, by distance to its SURFACE — "nearest celestial body"
// in the auto-orbit sense. Centre distance would pick a star's centre over a
// planet whose surface is much closer.
function glNearestBody(x, y) {
    let best = null, bestD = Infinity;
    const all = glHoles.concat(glBodies);
    for (let i = 0; i < all.length; i++) {
        const d = Math.hypot(x - all[i].x, y - all[i].y) - all[i].rs;
        if (d < bestD) { bestD = d; best = all[i]; }
    }
    return best;
}

// The body a right-click means (2026-09-11): the nearest hole, star or planet
// whose SURFACE is within `slack` of the point (inside it counts). Null over
// open space.
function glPickBody(x, y, slack) {
    let best = null, bestD = slack;
    const all = glHoles.concat(glBodies);
    for (let i = 0; i < all.length; i++) {
        const d = Math.hypot(x - all[i].x, y - all[i].y) - all[i].rs;
        if (d < bestD) { bestD = d; best = all[i]; }
    }
    return best;
}

function glBodyExists(b) { return glHoles.indexOf(b) !== -1 || glBodies.indexOf(b) !== -1; }

function glBodyName(b) {
    if (!b) return "-";
    return b.name || ("hole #" + (glHoles.indexOf(b) + 1));
}

// ===================================================
//                  DRAW
// ===================================================
// Into the buffer (stage 1), so the raster lenses bend a planet passing behind
// a hole like anything else.
function glDrawBodies(c) {
    const z = glCamera.zoom;
    // Orbit paths, culled unless the circle actually crosses the screen — at
    // zoom 1 an outer orbit is ~90,000px round and entirely off-screen.
    c.lineWidth = 1;
    c.strokeStyle = "rgba(125,249,255,0.08)";
    // Every orbit about its own parent (star, barycentre or planet), 2026-09-11.
    for (let i = 0; i < glStarSystems.length; i++) {
        const O = glStarSystems[i].order;
        for (let j = 0; j < O.length; j++) {
            const b = O[j];
            if (!b.parent || !(b.orbitR > 0)) continue;
            const R = b.orbitR * z;
            if (R < 3) continue;
            const sc = glWorldToScreen(b.parent.x, b.parent.y);
            if (sc.h) continue;
            const near = Math.hypot(Math.max(0, Math.abs(sc.x - glCX) - glCX), Math.max(0, Math.abs(sc.y - glCY) - glCY));
            const far = Math.hypot(Math.abs(sc.x - glCX) + glCX, Math.abs(sc.y - glCY) + glCY);
            if (R < near - 2 || R > far + 2) continue;
            c.beginPath();
            c.arc(sc.x, sc.y, R, 0, Math.PI * 2);
            c.stroke();
        }
    }
    for (let i = 0; i < glBodies.length; i++) {
        const b = glBodies[i];
        const s = glWorldToScreen(b.x, b.y);
        if (s.h) continue;
        // Stars never under 2 px: at real scale a star is sub-pixel at any zoom
        // that shows its planets.
        const r = Math.max(b.kind === "star" ? 2 : 1, b.rs * z);
        const glowR = b.kind === "star" ? r * 2.4 : r;
        if (s.x < -glowR || s.y < -glowR || s.x > glW + glowR || s.y > glH + glowR) continue;
        if (b.kind === "star") {
            c.save();
            c.globalCompositeOperation = "lighter";
            const g = c.createRadialGradient(s.x, s.y, r * 0.8, s.x, s.y, glowR);
            g.addColorStop(0, "rgba(255,240,190,0.55)");
            g.addColorStop(1, "rgba(255,200,120,0)");
            c.fillStyle = g;
            c.beginPath(); c.arc(s.x, s.y, glowR, 0, Math.PI * 2); c.fill();
            c.restore();
            c.fillStyle = b.color;
            c.beginPath(); c.arc(s.x, s.y, r, 0, Math.PI * 2); c.fill();
        } else {
            c.fillStyle = b.color;
            c.beginPath(); c.arc(s.x, s.y, r, 0, Math.PI * 2); c.fill();
            if (r > 3) {
                c.strokeStyle = "rgba(232,255,244,0.45)";
                c.lineWidth = 1;
                c.stroke();
            }
        }
    }
}

// Names on the main view, screen space (stage 4): stars always, planets once
// they are big enough on screen to be worth labelling.
function glDrawBodyLabels(c) {
    const z = glCamera.zoom;
    c.textAlign = "center";
    for (let i = 0; i < glBodies.length; i++) {
        const b = glBodies[i];
        const s = glWorldToScreenRaw(b.x, b.y);
        const r = b.rs * z;
        if (b.kind !== "star" && r < 6) continue;   // planets and moons once they're big enough
        if (s.x < -200 || s.y < -200 || s.x > glW + 200 || s.y > glH + 200) continue;
        c.font = (b.kind === "star" ? "12px " : "10px ") + "monospace";
        c.fillStyle = b.kind === "star" ? b.color : "rgba(232,255,244,0.75)";
        c.fillText(b.name, s.x, s.y + Math.max(r, 2) + 14);
    }
    c.textAlign = "start";
}
