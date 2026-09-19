// ===================================================
//   Gravity Lab — the three-stage render
// ===================================================
// 1. glDrawWorld()  -> everything lensable, into glBuffer
// 2. glComposite()  -> buffer to screen, distorted (gl-lens.js)
// 3. glDrawHole()   -> horizon, photon ring, accretion disc, straight to screen
//
// Stage 3 is separate for a concrete reason: if the hole were in the buffer,
// every lens method would sample it and smear the black disc outward into a
// grey halo. The hole is the one thing on screen whose position is exactly
// known, so it is drawn last and undistorted.
"use strict";

// ---------------------------------------------------------------
//  Stage 1 — the lensable scene
// ---------------------------------------------------------------
function glDrawWorld() {
    const c = glBufCtx;
    c.fillStyle = "#000000";
    c.fillRect(0, 0, glW, glH);

    const lensOn = GLP.v.lensStrength > 0;
    const vector = lensOn && GLP.lensMethod === "vector";

    // Methods 6 and 7 do their lensing here, at draw time, instead of as a
    // post-process. Every other method wants an undistorted scene to sample.
    // Ultradrive warp (gl-ultra.js) replaces the sky with streaks while it
    // lasts; there is nothing out there for the lens to bend anyway.
    if (glUltraWarp > 1.02) glDrawWarpStars(c);
    else if (lensOn && (GLP.lensMethod === "stars" || vector)) glDrawLensedStars(c);
    else glDrawStars(c);

    // Method 7: from here to the end of stage 1, every glWorldToScreen() call
    // bends its point through the lens. The finally is load-bearing — a throw
    // mid-draw that left glVecLens set would warp the HUD-side projections of
    // every later frame.
    if (vector) glVecLens = glBuildVecLens();
    try {
        glDrawArena(c);
        glDrawSummaryStars(c);
        if (GLP.v.showChunks) glDrawChunkGrid(c);
        glDrawBodies(c);
        if (GLP.v.showField) glDrawForceField(c);
        glDrawProbes(c);
        glDrawAsteroids(c);
        glDrawBullets(c);
        glDrawParticles(c);
        glDrawUltraBeam(c);   // behind the ships (gl-ultra.js)
        glDrawShips(c);
    } finally {
        glVecLens = null;
    }
}

// The world's edge: the galaxy's bounding box, galactic centre ± 55,000 ly
// (2026-09-11). Only the edges actually in view are drawn, clipped to the
// screen — a whole-box strokeRect would hand the canvas coordinates ~10¹⁴ px
// out. The vector-lens subdivision it used to need is moot out there: no hole
// lenses the rim of the galaxy.
function glDrawArena(c) {
    const tl = glWorldToScreenRaw(GL_WORLD.minX, GL_WORLD.minY), br = glWorldToScreenRaw(GL_WORLD.maxX, GL_WORLD.maxY);
    const L = Math.max(tl.x, -10), R = Math.min(br.x, glW + 10), T = Math.max(tl.y, -10), B = Math.min(br.y, glH + 10);
    if (L > R || T > B) return;
    c.strokeStyle = "rgba(125,249,255,0.25)";
    c.lineWidth = 2;
    c.beginPath();
    if (tl.x >= -10) { c.moveTo(tl.x, T); c.lineTo(tl.x, B); }
    if (br.x <= glW + 10) { c.moveTo(br.x, T); c.lineTo(br.x, B); }
    if (tl.y >= -10) { c.moveTo(L, tl.y); c.lineTo(R, tl.y); }
    if (br.y <= glH + 10) { c.moveTo(L, br.y); c.lineTo(R, br.y); }
    c.stroke();
}

// Stars from the chunk SUMMARIES as coloured points, once the view is wider
// than the loaded neighbourhood (2026-09-11) — so zooming out after an
// ultradrive drop-out shows the stars around you before any of them load.
function glDrawSummaryStars(c) {
    const z = glCamera.zoom, halfW = glW / 2 / z, halfH = glH / 2 / z;
    if (halfW < 0.2 * GL_LY) return;   // the loaded systems already cover the view
    const x0 = glChunkOf(glCamera.x - halfW), x1 = glChunkOf(glCamera.x + halfW);
    const y0 = glChunkOf(glCamera.y - halfH), y1 = glChunkOf(glCamera.y + halfH);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > 20000) return;
    for (let cx = x0; cx <= x1; cx++) {
        for (let cy = y0; cy <= y1; cy++) {
            const s = glChunkSummary(cx, cy);
            for (let i = 0; i < s.stars.length; i++) {
                const st = s.stars[i], p = glWorldToScreenRaw((cx + st.fx) * GL_CHUNK, (cy + st.fy) * GL_CHUNK);
                if (p.x < -3 || p.y < -3 || p.x > glW + 3 || p.y > glH + 3) continue;
                // Bigger dots for the bright classes (A, B, O, giants), as the eye sees them.
                const sz = st.bh ? 2 : (st.cls >= 4 && st.cls <= 6) || st.cls === 8 ? 3 : (st.cls === 2 || st.cls === 3 ? 2 : 1.5);
                c.fillStyle = st.color;
                c.fillRect(p.x - sz / 2, p.y - sz / 2, sz, sz);
            }
        }
    }
}

// Arrow grid sampling the CURRENT model. Arrow length is log-scaled: a 1/r²
// field spans four orders of magnitude across the well, and a linear scale
// shows either a blank field or one solid smear of ink.
function glDrawForceField(c) {
    const spacing = 55;
    c.lineWidth = 1;
    for (let sx = spacing / 2; sx < glW; sx += spacing) {
        for (let sy = spacing / 2; sy < glH; sy += spacing) {
            const wx = glCamera.x + (sx - glCX) / glCamera.zoom;
            const wy = glCamera.y + (sy - glCY) / glCamera.zoom;
            const g = glGravityAt(wx, wy);
            const mag = Math.hypot(g.ax, g.ay);
            if (mag < 1e-5) continue;
            const len = Math.min(spacing * 0.8, 6 * Math.log10(1 + mag / GL_S * 400));   // pulls are × GL_S
            const ux = g.ax / mag, uy = g.ay / mag;
            c.strokeStyle = "rgba(255,176,0," + Math.min(0.75, 0.15 + mag / GL_S * 0.05) + ")";
            c.beginPath();
            if (glVecLens) {
                // The grid is laid out in screen space, so bend its endpoints
                // directly rather than round-tripping through world space.
                const p0 = glLensScreenPoint(sx, sy);
                const p1 = glLensScreenPoint(sx + ux * len, sy + uy * len);
                if (p0.h || p1.h) continue;
                c.moveTo(p0.x, p0.y);
                c.lineTo(p1.x, p1.y);
            } else {
                c.moveTo(sx, sy);
                c.lineTo(sx + ux * len, sy + uy * len);
            }
            c.stroke();
        }
    }
}

function glDrawProbes(c) {
    // Trails first, as one path per probe rather than per segment — with 400
    // probes and a 200-point trail this is the difference between 60fps and a
    // slideshow, and trail cost must not be confused with lens cost.
    if (GLP.v.probeTrail > 0) {
        c.strokeStyle = "rgba(125,249,255,0.22)";
        c.lineWidth = 1;
        c.beginPath();
        for (let i = 0; i < glProbes.length; i++) {
            const t = glProbes[i].trail;
            if (t.length < 4) continue;
            // Pen lifts across any point the vector lens hides behind a
            // horizon, so a trail passing behind the hole breaks instead of
            // drawing a chord across the black disc.
            let pen = false;
            for (let j = 0; j < t.length; j += 2) {
                const s = glWorldToScreen(t[j], t[j + 1]);
                if (s.h) { pen = false; continue; }
                if (pen) c.lineTo(s.x, s.y); else { c.moveTo(s.x, s.y); pen = true; }
            }
        }
        c.stroke();
    }

    c.fillStyle = "#E8FFF4";
    for (let i = 0; i < glProbes.length; i++) {
        const p = glProbes[i];
        const s = glWorldToScreen(p.x, p.y);
        if (s.h) continue;
        if (s.x < -8 || s.y < -8 || s.x > glW + 8 || s.y > glH + 8) continue;
        c.fillRect(s.x - 1, s.y - 1, 2.5, 2.5);

        if (GLP.v.showVectors) {
            c.strokeStyle = "rgba(255,46,136,0.5)";
            c.beginPath();
            c.moveTo(s.x, s.y);
            c.lineTo(s.x + p.vx * 4, s.y + p.vy * 4);
            c.stroke();
        }
    }
}

function glDrawAsteroids(c) {
    for (const a of glAsteroids) {
        const s = glWorldToScreen(a.x, a.y);
        if (s.h) continue;
        if (s.x < -100 || s.y < -100 || s.x > glW + 100 || s.y > glH + 100) continue;
        c.save();
        c.translate(s.x, s.y);
        c.rotate(a.rotation);
        c.scale(glCamera.zoom, glCamera.zoom);
        c.strokeStyle = "rgba(255,255,255,0.85)";
        c.fillStyle = "rgba(255,255,255,0.08)";
        c.lineWidth = 1.5;
        c.beginPath();
        a.shape.forEach(function (p, i) { i === 0 ? c.moveTo(p.x, p.y) : c.lineTo(p.x, p.y); });
        c.closePath();
        c.fill();
        c.stroke();
        c.restore();
    }
}

function glDrawBullets(c) {
    for (const b of glBullets) {
        const s = glWorldToScreen(b.x, b.y);
        if (s.h) continue;
        c.fillStyle = b.color;
        c.beginPath();
        c.arc(s.x, s.y, b.size, 0, Math.PI * 2);
        c.fill();
    }
}

function glDrawParticles(c) {
    for (const p of glParticles) {
        const s = glWorldToScreen(p.x, p.y);
        if (s.h) continue;
        c.globalAlpha = Math.max(0, p.life);
        c.fillStyle = p.color;
        const sz = p.size || 3;   // ultradrive dust carries its own
        c.fillRect(s.x - sz / 2, s.y - sz / 2, sz, sz);
    }
    c.globalAlpha = 1;
}

// Every ship's hull, into the buffer. TRUE SCALE (2026-09-10): the big-holes
// pass clamped the hull to at least half size so it stayed visible at 0.02
// zoom — that was a deliberate choice, not a side effect of the vector lens,
// and it is gone. The always-on velocity vector in glDrawOverlay() is what now
// keeps a ship findable at any zoom, so the hull can be honest about size.
//
// Ships are EXEMPT from the vector lens (drawn with the raw projection): near
// a big hole the lens displaced a hull ~2,000px from where it was, and the
// overlay vector — drawn at the true position — would then point at nothing.
// The raster methods still lens hulls; that is their limitation.
function glDrawShips(c) {
    const z = glCamera.zoom;
    for (let i = 0; i < glShips.length; i++) {
        const s = glShips[i];
        if (!s.isAlive) continue;
        const p = glWorldToScreenRaw(s.x, s.y);
        // The ultradrive ∞ reaches ~6 hull lengths behind the ship.
        const reach = s.size * z * (s.ultraState ? 14 : 8) + 4;
        if (p.x < -reach || p.y < -reach || p.x > glW + reach || p.y > glH + reach) continue;
        const controlled = (s === glShip);

        c.save();
        c.translate(p.x, p.y);
        c.scale(z, z);
        c.rotate(s.angle);

        // Ultradrive: the ∞, its tracer and the sphere, under the hull.
        if (s.ultraState) glDrawUltraShip(c, s);

        // Engine plume while burning — or, for a follower, while it uses drive
        // power to catch its slot (boost, 2026-09-11). Its flicker runs on the
        // SHIP'S clock (was Math.random per frame), so under time dilation the
        // animation slows with the ship — one of the things the request named.
        if (s.hyperActive || s.boost || s.speedMul > 1.8) {   // bursts, catch-up, and gears
            const flick = 0.8 + 0.15 * Math.sin(s.clock * 37) + 0.1 * Math.sin(s.clock * 91);
            // Length from the speed the engines are actually asked for (it was
            // always hyperThrust): a ring's grip burst or a follower's catch-up
            // runs well under full thrust and should not look like a sprint.
            const plume = s.size * (0.6 + Math.min(s.speed / s.baseSpeed, GLP.v.hyperThrust) * 0.18) * flick;
            const grad = c.createLinearGradient(-s.size * 0.8, 0, -plume, 0);
            grad.addColorStop(0, "rgba(255,240,200,0.9)");
            grad.addColorStop(0.4, "rgba(255,176,0,0.55)");
            grad.addColorStop(1, "rgba(255,46,136,0)");
            c.fillStyle = grad;
            c.beginPath();
            c.moveTo(-s.size * 0.7, -s.size * 0.42);
            c.lineTo(-plume, 0);
            c.lineTo(-s.size * 0.7, s.size * 0.42);
            c.closePath();
            c.fill();
        }

        glStrokeHull(c, s.size, controlled ? "#7DF9FF" : "#C9FFE9", z);
        c.restore();
    }
}

// ---------------------------------------------------------------
//  Stage 3 — the hole itself, undistorted, on the visible canvas
// ---------------------------------------------------------------
// All holes, then the markers that are about ONE hole: the selection ring for
// the hole the sliders are editing, and the autopilot's target orbit.
function glDrawHole() {
    const z = glCamera.zoom;
    for (let i = 0; i < glHoles.length; i++) {
        const h = glHoles[i];
        const hs = glHoleScreenOf(h);
        // Cull on the largest thing drawn for a hole (its influence guide).
        const reach = Math.max(h.photon * 1.6, h.isco * 3.2, GLP.v.showOrbit ? h.wellRadius : 0) * z;
        if (hs.x < -reach || hs.y < -reach || hs.x > glW + reach || hs.y > glH + reach) continue;
        glDrawOneHole(h, hs, z, i === glSelectedHoleIndex);
    }

    // Selection bracket: four short arcs, so it reads as "this one" rather than
    // as another physical radius among the dashed guides.
    const sel = glHoles[glSelectedHoleIndex];
    if (sel && glHoles.length > 1) {
        const hs = glHoleScreenOf(sel);
        const rr = sel.photon * z * 1.9 + 8;
        glCtx.save();
        glCtx.strokeStyle = "#FF2E88";
        glCtx.lineWidth = 2;
        for (let q = 0; q < 4; q++) {
            const a = q * Math.PI / 2 + Math.PI / 4;
            glCtx.beginPath();
            glCtx.arc(hs.x, hs.y, rr, a - 0.3, a + 0.3);
            glCtx.stroke();
        }
        glCtx.fillStyle = "#FF2E88";
        glCtx.font = "11px monospace";
        glCtx.fillText("#" + (glSelectedHoleIndex + 1) + " selected", hs.x + rr * 0.72, hs.y + rr * 0.72 + 12);
        glCtx.restore();
    }

    // Autopilot target orbits, one ring per distinct lock (a group shares its
    // leader's), so you can see the altitude each is trying to hold.
    const drawn = {};
    glCtx.save();
    glCtx.setLineDash([10, 8]);
    glCtx.strokeStyle = "rgba(255,176,0,0.7)";
    glCtx.lineWidth = 1.5;
    for (let i = 0; i < glShips.length; i++) {
        const s = glShips[i];
        if (!s.isAlive || !s.autoOrbit || !s.autoLock) continue;
        const R = glAutoTargetRadius(s);
        const key = glBodyName(s.autoLock.hole) + ":" + Math.round(R / 20);
        if (drawn[key]) continue;
        drawn[key] = true;
        const hs = glHoleScreenOf(s.autoLock.hole);
        glCtx.beginPath();
        glCtx.arc(hs.x, hs.y, R * z, 0, Math.PI * 2);
        glCtx.stroke();
    }
    glCtx.restore();
}

function glDrawOneHole(h, hs, z, isSelected) {
    const rs = h.rs * z;

    if (GLP.v.diskOn && GLP.v.diskBright > 0) glDrawDisk(h, hs, z);

    // Event horizon: flat black, no gradient. It is not a dark object, it is an
    // absence, and any shading on it makes it read as a sphere.
    glCtx.fillStyle = "#000000";
    glCtx.beginPath();
    glCtx.arc(hs.x, hs.y, rs, 0, Math.PI * 2);
    glCtx.fill();

    // Photon ring: the bright circle where light grazes and comes back around.
    if (GLP.v.ringGlow > 0) {
        const pr = h.photon * z;
        glCtx.save();
        glCtx.globalCompositeOperation = "lighter";
        const grad = glCtx.createRadialGradient(hs.x, hs.y, rs * 0.9, hs.x, hs.y, pr * 1.6);
        grad.addColorStop(0, "rgba(255,255,255,0)");
        grad.addColorStop(0.55, "rgba(255,240,200," + (0.55 * GLP.v.ringGlow) + ")");
        grad.addColorStop(1, "rgba(255,176,0,0)");
        glCtx.fillStyle = grad;
        // Fill only the BAND the gradient is visible in (from 0.9 r_s out),
        // not the whole disc, since the gradient is transparent inside.
        // Honest note (2026-09-10): this measured NO saving in the case that
        // prompted it. The glow is ~5.8ms of the ~6ms hole draw near a big
        // horizon, but there the band itself covers the whole screen — the
        // cost is the glow's on-screen AREA, not the interior. It only helps
        // when the hole's black interior is on screen. ringGlow 0 removes it.
        glCtx.beginPath();
        glCtx.arc(hs.x, hs.y, pr * 1.6, 0, Math.PI * 2);
        glCtx.arc(hs.x, hs.y, rs * 0.9, 0, Math.PI * 2, true);
        glCtx.fill("evenodd");
        glCtx.restore();
    }

    // Guides on the selected hole only. With five holes each wearing five
    // dashed circles the screen is all guide and no hole.
    if (GLP.v.showOrbit && isSelected) glDrawRadiiGuides(h, hs, z);
}

// Accretion disc as an ellipse seen near edge-on, with Doppler beaming: the
// side rotating toward the viewer is brighter. Direction follows the spin
// slider, so flipping spin flips which limb is bright — a good check that the
// visual and the physics are reading the same parameter.
function glDrawDisk(h, hs, z) {
    const inner = h.isco * z;
    const outer = inner * 3.2;
    const t = performance.now() / 1000;

    glCtx.save();
    glCtx.globalCompositeOperation = "lighter";
    glCtx.translate(hs.x, hs.y);
    glCtx.scale(1, 0.32);   // Near edge-on

    const steps = 44;
    for (let i = 0; i < steps; i++) {
        const a0 = (i / steps) * Math.PI * 2;
        const a1 = ((i + 1.2) / steps) * Math.PI * 2;
        // Beaming factor: +1 on the approaching limb, -1 on the receding one.
        const approach = Math.cos(a0 - (h.spin >= 0 ? 0 : Math.PI));
        const beam = 1 + GLP.v.beaming * approach;
        const flicker = 0.85 + 0.15 * Math.sin(t * 2 + i);
        glCtx.strokeStyle = "rgba(255," + Math.round(150 + 80 * beam) + ",90," +
            Math.min(0.9, 0.16 * GLP.v.diskBright * beam * flicker) + ")";
        glCtx.lineWidth = outer - inner;
        glCtx.beginPath();
        glCtx.arc(0, 0, (inner + outer) / 2, a0, a1);
        glCtx.stroke();
    }
    glCtx.restore();
}

// Dashed circles for r_s, the photon sphere, the ISCO, the Einstein radius and
// the influence radius. Reading a model is much easier when you can see which
// of its characteristic radii a probe is actually crossing.
function glDrawRadiiGuides(h, hs, z) {
    const guides = [
        [h.rs * z, "rgba(255,46,136,0.55)", "r_s"],
        [h.photon * z, "rgba(255,240,200,0.45)", "photon"],
        [h.isco * z, "rgba(255,176,0,0.45)", "ISCO 3rs"],
        [h.rs * z * GLP.v.einsteinX, "rgba(125,249,255,0.5)", "Einstein"],
        [h.wellRadius * z, "rgba(125,249,255,0.18)", "influence"]
    ];
    glCtx.save();
    glCtx.setLineDash([4, 6]);
    glCtx.lineWidth = 1;
    glCtx.font = "10px monospace";
    for (const g of guides) {
        if (g[0] < 2 || g[0] > Math.max(glW, glH) * 1.5) continue;
        glCtx.strokeStyle = g[1];
        glCtx.beginPath();
        glCtx.arc(hs.x, hs.y, g[0], 0, Math.PI * 2);
        glCtx.stroke();
        glCtx.fillStyle = g[1];
        glCtx.fillText(g[2], hs.x + g[0] * 0.7071 + 3, hs.y - g[0] * 0.7071 - 3);
    }
    glCtx.restore();
}

function glRender() {
    // Self-healing size (2026-09-10). Found when the preview pane collapsed to
    // 0px mid-test: the resize handler faithfully sized both canvases to 0×0,
    // and when the window came back to 1280×800 NO resize event reached the
    // page (it was hidden at the time) — so the lab sat at 0×0 indefinitely,
    // and every drawImage(glBuffer, …) threw InvalidStateError once per frame
    // out of the rAF loop. Relying on the event is the bug; comparing against
    // the real window every frame costs two reads and cannot miss.
    if (glW !== window.innerWidth || glH !== window.innerHeight) glResize();
    // Genuinely zero-area (minimised): nothing to draw, and drawing would throw.
    if (glW <= 0 || glH <= 0) return;
    const t0 = performance.now();
    glDrawWorld();     // -> buffer
    // Same honest-timing flush as in glComposite: the vector method's whole
    // cost lands in this stage, so it has to be measured the same way.
    if (GLP.v.gpuSync) glBufCtx.getImageData(0, 0, 1, 1);
    glWorldMs = performance.now() - t0;
    glComposite();     // buffer -> screen, via the selected lens method
    glDrawHole();      // -> screen, undistorted
    glDrawOverlay();   // -> screen, constant pixel size, never lensed
    glDrawMinimap();   // -> screen, 8-bit map (gl-minimap.js), toggle M
    glUltraApplyShake(); // ultradrive rumble: a CSS translate of the finished frame (gl-ultra.js)
}

// Nav arrows (2026-09-11): pinned to the screen edge, pointing at the nearest
// star (from the summaries — loaded or not) and the nearest loaded planet,
// with name and distance. After an ultradrive drop-out the nearest star is
// typically light-years off and nothing is on screen; this is the way back to
// something. Q mode only. The star search runs every 30 frames.
let glNavStar = null, glNavTick = 0;
function glDrawNav(c) {
    const s = glShip;
    if (glMode !== "q" || !s.isAlive) return;
    if (glNavTick++ % 30 === 0) glNavStar = glNearestStar(s.x, s.y);
    const targets = [];
    if (glNavStar) targets.push({ x: glNavStar.x, y: glNavStar.y, r: 0, name: glNavStar.name, col: "#FFB000" });
    let bp = null, bd = Infinity;
    for (let i = 0; i < glBodies.length; i++) {
        const b = glBodies[i];
        if (b.kind !== "planet") continue;
        const d = Math.hypot(b.x - s.x, b.y - s.y);
        if (d < bd) { bd = d; bp = b; }
    }
    if (bp) targets.push({ x: bp.x, y: bp.y, r: bp.rs, name: bp.name, col: "#7DF9FF" });
    c.save();
    c.font = "11px monospace";
    for (let i = 0; i < targets.length; i++) {
        const t = targets[i], p = glWorldToScreenRaw(t.x, t.y);
        const dx = p.x - glCX, dy = p.y - glCY, m = 44;
        const kx = dx !== 0 ? (glCX - m) / Math.abs(dx) : Infinity;
        const ky = dy !== 0 ? (glCY - m) / Math.abs(dy) : Infinity;
        const k = Math.min(kx, ky);
        if (k >= 1) continue;   // it is on screen; its own label says what it is
        const ax = glCX + dx * k, ay = glCY + dy * k, a = Math.atan2(dy, dx);
        c.fillStyle = t.col;
        c.beginPath();
        c.moveTo(ax + Math.cos(a) * 9, ay + Math.sin(a) * 9);
        c.lineTo(ax + Math.cos(a + 2.5) * 7, ay + Math.sin(a + 2.5) * 7);
        c.lineTo(ax + Math.cos(a - 2.5) * 7, ay + Math.sin(a - 2.5) * 7);
        c.closePath();
        c.fill();
        const label = t.name + " " + glFmtAstro(Math.max(0, Math.hypot(t.x - s.x, t.y - s.y) - t.r));
        c.textAlign = ax > glCX ? "right" : "left";
        c.fillText(label, ax - Math.cos(a) * 14, ay - Math.sin(a) * 14 + 4);
    }
    c.restore();
}

// Trajectory lock (2026-09-12): a marching amber dash line from the ship along
// the held heading to the screen edge, a padlock beside the hull, and a ring
// that pulses out from the ship for 0.6 s when the lock clamps.
function glDrawTrajLock(c) {
    const s = glShip;
    if (glMode !== "q" || !s.isAlive || s.trajLock === null) return;
    const p = glWorldToScreenRaw(s.x, s.y), ux = Math.cos(s.trajLock), uy = Math.sin(s.trajLock);
    const L = Math.hypot(glW, glH);
    c.save();
    c.strokeStyle = "rgba(255,176,0,0.8)";
    c.lineWidth = 1.5;
    c.setLineDash([10, 7]);
    c.lineDashOffset = -(performance.now() / 40) % 17;
    c.beginPath();
    c.moveTo(p.x + ux * 20, p.y + uy * 20);
    c.lineTo(p.x + ux * L, p.y + uy * L);
    c.stroke();
    c.setLineDash([]);
    // Padlock: body and shackle, above-right of the ship.
    const lx = p.x + 16, ly = p.y - 18;
    c.fillStyle = "#FFB000";
    c.fillRect(lx - 4, ly - 1, 8, 6);
    c.lineWidth = 1.5;
    c.beginPath();
    c.arc(lx, ly - 1, 3, Math.PI, 0);
    c.stroke();
    const age = (performance.now() - s.trajLockT) / 1000;
    if (age < 0.6) {
        c.globalAlpha = 1 - age / 0.6;
        c.lineWidth = 2;
        c.beginPath();
        c.arc(p.x, p.y, 10 + age * 120, 0, Math.PI * 2);
        c.stroke();
    }
    c.restore();
}

// ---------------------------------------------------------------
//  Stage 4 — screen-space overlay (2026-09-10)
// ---------------------------------------------------------------
// Things that must read at ANY zoom are drawn here, in pixels, after the lens:
//   - every ship's velocity vector, PERMANENTLY ON: a constant-pixel arrow
//     plus a dot at the true position. With hulls back at true scale, this is
//     what finds a ship at zoom 0.01. Its length follows OBSERVED speed
//     (proper velocity × tau), so time dilation is visible as the arrow
//     shrinking even when the hull is too small to see;
//   - selection brackets, group move targets, the drag box.
function glDrawOverlay() {
    const c = glCtx;
    c.save();
    c.lineCap = "round";
    for (let i = 0; i < glShips.length; i++) {
        const s = glShips[i];
        if (!s.isAlive) continue;
        const p = glWorldToScreenRaw(s.x, s.y);
        if (p.x < -120 || p.y < -120 || p.x > glW + 120 || p.y > glH + 120) continue;

        const ovx = s.vx * s.tau, ovy = s.vy * s.tau;
        const sp = Math.hypot(ovx, ovy);
        let ux, uy;
        if (sp > 0.05) { ux = ovx / sp; uy = ovy / sp; } else { ux = Math.cos(s.angle); uy = Math.sin(s.angle); }
        // Log length (2026-09-11): speeds now span cruise to a light-year a
        // second, ten orders of magnitude. Still observed speed, so dilation
        // still shows as the arrow shrinking.
        const len = 14 + Math.min(90, 24 * Math.log10(1 + sp / (s.baseSpeed * 0.25)));
        const col = s === glShip ? "#7DF9FF" : (s.selected ? "#FFB000" : "rgba(201,255,233,0.75)");

        c.strokeStyle = col;
        c.fillStyle = col;
        c.lineWidth = 1.5;
        const ex = p.x + ux * len, ey = p.y + uy * len;
        c.beginPath();
        c.moveTo(p.x, p.y);
        c.lineTo(ex, ey);
        // Arrowhead: two short strokes at ±150° from the direction of travel.
        const ah = 6, ca = Math.cos(2.6), sa = Math.sin(2.6);
        c.moveTo(ex, ey);
        c.lineTo(ex + (ux * ca - uy * sa) * ah, ey + (ux * sa + uy * ca) * ah);
        c.moveTo(ex, ey);
        c.lineTo(ex + (ux * ca + uy * sa) * ah, ey + (-ux * sa + uy * ca) * ah);
        c.stroke();
        c.beginPath();
        c.arc(p.x, p.y, 2.2, 0, Math.PI * 2);
        c.fill();

        if (s.selected) {
            const b = 11, k = 4;
            c.strokeStyle = "#FFB000";
            c.lineWidth = 1.2;
            c.beginPath();
            [[-1, -1], [1, -1], [1, 1], [-1, 1]].forEach(function (q) {
                const cx = p.x + q[0] * b, cy = p.y + q[1] * b;
                c.moveTo(cx, cy - q[1] * k); c.lineTo(cx, cy); c.lineTo(cx - q[0] * k, cy);
            });
            c.stroke();
        }
    }

    // Group move targets.
    c.strokeStyle = "rgba(255,176,0,0.8)";
    c.lineWidth = 1.5;
    for (let i = 0; i < glGroups.length; i++) {
        const g = glGroups[i];
        if (!g.cmd || g.cmd.type !== "move") continue;
        const t = glWorldToScreenRaw(g.cmd.x, g.cmd.y);
        if (g.cmd.body) {
            // A body target (2026-09-11): a dashed ring round it — "orbit this
            // on arrival" — instead of the cross that marks a point in space.
            c.save();
            c.setLineDash([6, 5]);
            c.beginPath();
            c.arc(t.x, t.y, g.cmd.body.rs * glCamera.zoom + 10, 0, Math.PI * 2);
            c.stroke();
            c.restore();
            continue;
        }
        c.beginPath();
        c.moveTo(t.x - 7, t.y - 7); c.lineTo(t.x + 7, t.y + 7);
        c.moveTo(t.x + 7, t.y - 7); c.lineTo(t.x - 7, t.y + 7);
        c.stroke();
    }

    glDrawBodyLabels(c);
    glDrawNav(c);
    glDrawTrajLock(c);

    // Box select in progress.
    if (glDrag) {
        const x = Math.min(glDrag.x0, glDrag.x1), y = Math.min(glDrag.y0, glDrag.y1);
        const w = Math.abs(glDrag.x1 - glDrag.x0), h = Math.abs(glDrag.y1 - glDrag.y0);
        c.fillStyle = "rgba(255,176,0,0.07)";
        c.fillRect(x, y, w, h);
        c.setLineDash([5, 4]);
        c.strokeStyle = "rgba(255,176,0,0.8)";
        c.strokeRect(x, y, w, h);
    }
    c.restore();
}
