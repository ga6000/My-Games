// ===================================================
//   Gravity Lab — chunk streaming over the Milky Way
// ===================================================
// Added 2026-09-10 (CHUNKS_PLAN.md); rebuilt 2026-09-11 (GALAXY_PLAN.md) for
// the real-scale galaxy. The core decision is unchanged: glHoles, glBodies,
// glStarSystems and glAsteroids hold only what is LOADED; a chunk pushes its
// content in on load and splices it out on unload.
//
// What changed: a chunk is now 1 LIGHT-YEAR across and holds a POISSON number
// of stars drawn from the galaxy density Σ(x, y) (gl-galaxy.js) — ~0.025 per
// chunk at home, capped at GL_CHUNK_MAX_STARS in the core so a load stays
// bounded. One in 1,000 stellar objects is a (gameplay-enlarged) black hole.
// Stars are SUMMARIES (position, class, name, seed) until their chunk loads;
// then gl-galaxy builds the system. Every star system's reach (≤ ~60 AU) is
// far under a chunk, and pull/horizon queries use their own finer grid
// (glNear, gl-bodies.js), so chunk borders cut nothing.
//
// Everything derives from hash(worldSeed, cx, cy): the same chunk always
// regenerates identically. Only CHANGES need remembering.
"use strict";

const GL_CHUNK = GL_LY;               // 1 ly
const GL_WORLD_SEED = 0x5EED2026;     // one number = one universe
const GL_CHUNK_MAX_STARS = 12;        // core cap (the real nucleus is far denser)
const GL_BH_FRACTION = 0.001;         // stellar black holes per stellar object
const GL_HOLE_RING_DEF = GL_PARAM_DEFS.filter(function (d) { return d.k === "photonRing"; })[0].def;

const glChunks = new Map();           // key -> loaded chunk { key, cx, cy, holes, systems, lastWanted }
const glChunkSummaries = new Map();   // key -> memoised summary (no geometry — cheap)
const glChunkDeltas = new Map();      // procedural hole id -> saved edits, or { removed: true }
let glChunkTick = 0;                  // streamer passes, for unload hysteresis
let glChunkGenMs = 0;                 // cost of the last streamer pass (HUD)
let glChunkLoads = 0;                 // chunks generated since boot (HUD / tests)

function glChunkKey(cx, cy) { return cx + "," + cy; }
function glChunkOf(v) { return Math.floor(v / GL_CHUNK); }

// The chunk holding Sol (the world origin). Sol itself is pinned, not streamed.
function glIsHomeChunk(cx, cy) { return cx === 0 && cy === 0; }

function glChunkSeed(cx, cy) {
    let h = GL_WORLD_SEED ^ Math.imul(cx | 0, 0x27d4eb2d) ^ Math.imul(cy | 0, 0x165667b1);
    h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
    h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
    return (h ^ (h >>> 16)) | 0;
}

// Letters only — the mini-map's 3×5 pixel font draws A–Z and digits.
const GL_NAME_SYLL = ["KA", "VEL", "OR", "THE", "SIR", "ION", "MAR", "DUS", "PHA", "REN",
                      "TAU", "LYX", "NOR", "CEL", "ARA", "VEX", "ZEN", "OLU", "QUI", "BRA",
                      "SOL", "EN", "ITH", "ANT", "RIM", "OS", "ELL", "DRA", "KES", "UM"];

function glMakeStarName(rnd) {
    const n = rnd() < 0.7 ? 2 : 3;
    let s = "";
    for (let i = 0; i < n; i++) s += GL_NAME_SYLL[Math.floor(rnd() * GL_NAME_SYLL.length)];
    return s.slice(0, 9);
}

// What a chunk contains, without building any of it: its stars as summaries.
// Memoised. This is what lets the mini-map list stars 25 ly away, and the main
// view draw them zoomed out, without loading anything there. Every field is
// drawn from the RNG in the same order whether or not the star is kept, so
// the stream stays deterministic.
function glChunkSummary(cx, cy) {
    const key = glChunkKey(cx, cy);
    let s = glChunkSummaries.get(key);
    if (s) return s;
    if (glChunkSummaries.size > 60000) glChunkSummaries.clear();   // recomputable, so just drop
    const rnd = glRng(glChunkSeed(cx, cy));
    const lam = Math.min(GL_CHUNK_MAX_STARS, glGalaxyDensity((cx + 0.5) * GL_CHUNK, (cy + 0.5) * GL_CHUNK));
    const n = glPoisson(lam, rnd);
    const stars = [];
    for (let i = 0; i < n; i++) {
        const st = { fx: rnd(), fy: rnd(), seed: Math.floor(rnd() * 2147483647), bh: rnd() < GL_BH_FRACTION };
        st.cls = glSampleClass(rnd);
        st.name = glMakeStarName(rnd);
        st.color = GL_STAR_CLASSES[st.cls].col;
        const bhMult = glSampleSizeMultiple(rnd), bhSpin = rnd() * 2 - 1;
        if (st.bh) { st.mult = bhMult; st.spin = bhSpin; st.color = "#B03AC0"; }
        // Keep procedural stars off Sol's doorstep (Sol is pinned, not a summary).
        if (Math.hypot((cx + st.fx) * GL_CHUNK, (cy + st.fy) * GL_CHUNK) < 0.3 * GL_LY) continue;
        stars.push(st);
    }
    s = { stars: stars, lam: lam, home: glIsHomeChunk(cx, cy) };
    glChunkSummaries.set(key, s);
    return s;
}

function glSummaryPos(cx, cy, st) {
    return { x: (cx + st.fx) * GL_CHUNK, y: (cy + st.fy) * GL_CHUNK };
}

function glLoadChunk(cx, cy) {
    const key = glChunkKey(cx, cy);
    const s = glChunkSummary(cx, cy);
    const ch = { key: key, cx: cx, cy: cy, holes: [], systems: [], lastWanted: glChunkTick };
    glChunks.set(key, ch);
    for (let i = 0; i < s.stars.length; i++) {
        const st = s.stars[i], p = glSummaryPos(cx, cy, st);
        if (st.bh) {
            const id = "h:" + key + ":" + i;
            const d = glChunkDeltas.get(id);
            if (d && d.removed) continue;
            const h = glMakeHole(GLP.v);
            h.id = id;
            h.chunkKey = key;
            h.name = "BH " + st.name;
            h.rs = st.mult * GLP.v.sizeUnit;
            h.massX = 1;
            h.spin = st.spin;
            h.photonRing = GL_HOLE_RING_DEF;
            h.x = p.x; h.y = p.y;
            // Edits made on an earlier visit win over the generated values.
            if (d) { h.x = d.x; h.y = d.y; h.rs = d.rs; h.massX = d.massX; h.photonRing = d.photonRing; h.spin = d.spin; }
            glHoles.push(h);
            ch.holes.push(h);
        } else {
            ch.systems.push(glRegisterSystem(glBuildSystem(st, p.x, p.y, key)));
        }
    }
    glChunkLoads++;
    return ch;
}

function glUnloadChunk(ch) {
    // Holes remember their current state by id; a reload restores it, so an
    // edited or moved procedural hole stays edited.
    ch.holes.forEach(function (h) {
        const i = glHoles.indexOf(h);
        if (i === -1) return;
        glChunkDeltas.set(h.id, { x: h.x, y: h.y, rs: h.rs, massX: h.massX, photonRing: h.photonRing, spin: h.spin });
        glHoles.splice(i, 1);
    });
    ch.systems.forEach(glRemoveStarSystem);   // bodies and belt rocks with them
    glChunks.delete(ch.key);
}

// Everything procedural goes, and every remembered edit with it. Used by Reset All.
function glResetChunks() {
    Array.from(glChunks.values()).forEach(glUnloadChunk);
    glChunks.clear();
    glChunkDeltas.clear();
}

// How many chunks out from the focus to keep loaded: enough to cover the view
// (1 at normal zoom, up to 3 zoomed right out).
function glFocusChunkRadius() {
    const half = Math.max(glW, glH) / 2 / Math.max(glCamera.zoom, 1e-12);
    return Math.max(1, Math.min(3, Math.ceil(half / GL_CHUNK + 0.5)));
}
function glFocusRange() { return (glFocusChunkRadius() + 0.5) * GL_CHUNK; }

// The streamer. Every 10 frames:
//   - WANT: the chunks around the focus, plus a 3×3 block around EVERY live
//     ship — a fleet ship far from the camera still falls into holes that are
//     really there;
//   - load what is wanted and missing;
//   - unload what has not been wanted for 30 passes (~5 s) — hysteresis.
function glUpdateChunks(force) {
    if (!force && (glFrameNo % 10)) return;
    glChunkTick++;
    const t0 = performance.now();
    const want = new Map();
    function around(x, y, r) {
        const cx = glChunkOf(x), cy = glChunkOf(y);
        for (let dx = -r; dx <= r; dx++) {
            for (let dy = -r; dy <= r; dy++) want.set(glChunkKey(cx + dx, cy + dy), [cx + dx, cy + dy]);
        }
    }
    const fp = glFocusPoint();
    // Nothing loads around a ship in ultradrive (2026-09-11, gl-ultra.js): it
    // crosses chunks every frame, and each would linger ~5 s. On drop-out the
    // chunks there are force-loaded.
    if (!(glMode === "q" && glShip.ultraState === "active")) around(fp.x, fp.y, glFocusChunkRadius());
    for (let i = 0; i < glShips.length; i++) {
        const s = glShips[i];
        if (s.isAlive && s.ultraState !== "active") around(s.x, s.y, 1);
    }

    const prevSel = glHoles[glSelectedHoleIndex];
    let changed = false;
    want.forEach(function (c, key) {
        const ch = glChunks.get(key);
        if (ch) ch.lastWanted = glChunkTick;
        else { glLoadChunk(c[0], c[1]); changed = true; }
    });
    glChunks.forEach(function (ch, key) {
        if (!want.has(key) && glChunkTick - ch.lastWanted > 30) { glUnloadChunk(ch); changed = true; }
    });
    if (changed) glAfterWorldChange(prevSel);
    glChunkGenMs = performance.now() - t0;
}

// Holes came or went: keep the panel's selected hole pointing at a real hole.
// If the selected one was unloaded, the one nearest the focus takes over.
function glAfterWorldChange(prevSel) {
    let i = glHoles.indexOf(prevSel);
    if (i === -1) {
        const fp = glFocusPoint();
        let best = Infinity;
        for (let j = 0; j < glHoles.length; j++) {
            const d = Math.hypot(glHoles[j].x - fp.x, glHoles[j].y - fp.y);
            if (d < best) { best = d; i = j; }
        }
    }
    glSelectedHoleIndex = Math.max(0, i);
    glPullParamsFromHole();
    glSyncPanelFromParams();
}

// Stars (and stellar holes) within rLy light-years of (x, y), from summaries —
// loaded or not — plus Sol, sorted nearest first. Mini-map LOCAL list, nav arrow.
function glStarsNear(x, y, rLy) {
    const out = [], R = Math.ceil(rLy), rr = rLy * GL_LY;
    const c0x = glChunkOf(x), c0y = glChunkOf(y);
    for (let dx = -R; dx <= R; dx++) {
        for (let dy = -R; dy <= R; dy++) {
            const cx = c0x + dx, cy = c0y + dy, s = glChunkSummary(cx, cy);
            for (let i = 0; i < s.stars.length; i++) {
                const st = s.stars[i], p = glSummaryPos(cx, cy, st);
                const d = Math.hypot(p.x - x, p.y - y);
                if (d <= rr) out.push({ name: st.name, x: p.x, y: p.y, color: st.color, bh: st.bh, cls: st.cls, d: d });
            }
        }
    }
    const ds = Math.hypot(x, y);
    if (ds <= rr) out.push({ name: "SOL", x: 0, y: 0, color: "#FFF4EA", bh: false, cls: 2, d: ds, home: true });
    out.sort(function (a, b) { return a.d - b.d; });
    return out;
}

// Nearest actual star (not a hole), searching outward; null past 40 ly.
function glNearestStar(x, y) {
    const radii = [2, 6, 15, 40];
    for (let i = 0; i < radii.length; i++) {
        const l = glStarsNear(x, y, radii[i]);
        for (let j = 0; j < l.length; j++) if (!l[j].bh) return l[j];
    }
    return null;
}

// Debug overlay (toggle "Show chunk grid"): chunk borders in the buffer,
// loaded chunks faintly tinted, and each chunk's key and star count once a
// chunk is big enough on screen to label.
function glDrawChunkGrid(c) {
    const z = glCamera.zoom, S = GL_CHUNK;
    const halfW = glW / 2 / z, halfH = glH / 2 / z;
    const x0 = glChunkOf(glCamera.x - halfW), x1 = glChunkOf(glCamera.x + halfW);
    const y0 = glChunkOf(glCamera.y - halfH), y1 = glChunkOf(glCamera.y + halfH);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 400) return;
    c.save();
    c.font = "11px monospace";
    for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
            const a = glWorldToScreenRaw(cx * S, cy * S), b = glWorldToScreenRaw((cx + 1) * S, (cy + 1) * S);
            const key = glChunkKey(cx, cy);
            if (glChunks.has(key)) {
                c.fillStyle = glIsHomeChunk(cx, cy) ? "rgba(155,197,61,0.04)" : "rgba(125,249,255,0.035)";
                c.fillRect(a.x, a.y, b.x - a.x, b.y - a.y);
            }
            c.strokeStyle = "rgba(125,249,255,0.22)";
            c.lineWidth = 1;
            c.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
            if (b.x - a.x > 140) {
                const s = glChunkSummary(cx, cy);
                c.fillStyle = "rgba(125,249,255,0.55)";
                c.fillText("chunk " + key + "  " + s.stars.length + " star" + (s.stars.length === 1 ? "" : "s") +
                    (glChunks.has(key) ? "" : "  (unloaded)"), a.x + 6, a.y + 14);
            }
        }
    }
    c.restore();
}
