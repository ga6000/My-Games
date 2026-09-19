// ===================================================
//   Gravity Lab — five ways to fake gravitational lensing in canvas 2D
// ===================================================
// All five share one contract: the complete scene has already been drawn into
// glBuffer (gl-core.js), the visible canvas is empty, and the method's job is
// to get the buffer onto the screen distorted. The event horizon disc, photon
// ring and accretion disc are drawn AFTER, by gl-draw.js — they are not part of
// the lens and must not be sampled by it, or the hole smears itself.
//
// The physics they share is the thin-lens equation, the standard weak-lensing
// approximation:
//
//     beta = theta - thetaE^2 / theta
//
// theta is where you SEE something (its screen radius from the hole), beta is
// where it actually IS. So to fill screen radius theta, sample the buffer at
// radius beta. thetaE is the Einstein radius — the slider — and is the one
// number that sets the apparent size of the distortion.
//
// Methods 2 and 3 differ only in what they can express: rings can scale a
// circular region uniformly, pixels can move every sample independently. The
// interesting result is how little difference that makes at speed.
"use strict";

const GL_LENS_METHODS = {
    off: {
        label: "Off (control)",
        blurb: "Straight blit of the buffer. Use it to check what the gravity model alone communicates — a well with no visual distortion is a surprisingly readable thing."
    },
    rings: {
        label: "1. Concentric rings (heuristic)",
        blurb: "Concentric drawImage rings, each scaled by an ad-hoc 1 + s·(R/r²) factor. Cheap and stylised; the distortion grows without bound near the centre so it reads as smearing, not lensing. ~R/step draws per frame."
    },
    thinlens: {
        label: "2. Thin-lens rings (physical)",
        blurb: "Same ring machinery, but each ring's source radius comes from beta = theta - thetaE²/theta. Costs the same as the heuristic and produces an actual Einstein ring. Recommended starting point."
    },
    sectors: {
        label: "3. Radial sectors",
        blurb: "Wedges rather than rings, so the sample can be rotated per-sector — the only ring-family method that can express frame dragging as a visible twist. Cost is rings × sectors; watch the lens ms."
    },
    pixel: {
        label: "4. Per-pixel ImageData",
        blurb: "Inverse-maps every Nth pixel in the lens box through the thin-lens equation. The only method that gets the second (inner) image right. Cost is quadratic in the lens radius — this is the one to measure."
    },
    pixellow: {
        label: "5. Per-pixel, low-res buffer",
        blurb: "Method 4's exact map, resolved into a step-times-smaller buffer and scaled back up by the GPU. Same optics, softer edges. Measured 2.6x faster than method 4 at step 3 and 4x at step 4, and it is the only per-pixel option that fits in a frame budget — step 3 costs about 8ms at a 320px radius."
    },
    vector: {
        label: "7. Vector (warp geometry)",
        blurb: "Bends every POINT the scene draws — stars, probes and trails, asteroids, bullets, ship, force arrows, arena edge — through the thin-lens map as it is projected, so the frame is drawn once, already lensed. No pixels are copied: cost scales with vertex count, not with how much screen the hole covers. Primary image only; small objects are moved, not stretched."
    },
    stars: {
        label: "6. Starfield displacement",
        blurb: "No buffer sampling at all: each star is drawn at its deflected position, brightened near the Einstein radius. Essentially free, works at any lens radius, and only distorts the starfield — ships and asteroids pass through undistorted."
    }
};

// Screen position and horizon radius of one hole. RAW projection: a hole
// centre bent by its own lens would put the lens somewhere else.
function glHoleScreenOf(h) { return glWorldToScreenRaw(h.x, h.y); }
function glHorizonScreenROf(h) { return h.rs * glCamera.zoom; }

// Everything a lens pass needs about one hole this frame, in SCREEN pixels.
//
// Reach and Einstein radius are multiples of r_s (2026-09-10) — see the note
// in gl-params.js on why pixel radii stopped working once holes got big.
//
// Approach boost: p is how far the SHIP is into this hole's well, 0 at the
// influence edge and 1 at the horizon. Strength and reach both scale by
// (1 + boost·p²). Squared so it barely moves until you are genuinely close,
// then climbs fast — lensing that ramps linearly from the edge of a 5,000-unit
// well is already half-on before anything interesting is happening.
function glLensParamsFor(h) {
    const z = glCamera.zoom;
    // From the focus point: the flown ship in Q mode, the camera in E mode.
    const fp = glFocusPoint();
    const alt = Math.max(0, Math.hypot(fp.x - h.x, fp.y - h.y) - h.rs);
    const span = Math.max(1, h.wellRadius - h.rs);
    const p = Math.max(0, Math.min(1, 1 - alt / span));
    const p2 = p * p;
    return {
        R: h.rs * z * GLP.v.lensReach * (1 + GLP.v.lensApproachReach * p2),
        tE: h.rs * z * GLP.v.einsteinX,
        strength: GLP.v.lensStrength * (1 + GLP.v.lensApproachStrength * p2),
        p: p
    };
}

// Largest screen distance from (cx, cy) to any corner — lens rings beyond it
// cannot be seen, and with big holes R is routinely many screens wide.
function glFarCorner(cx, cy) {
    return Math.max(
        Math.hypot(cx, cy), Math.hypot(glW - cx, cy),
        Math.hypot(cx, glH - cy), Math.hypot(glW - cx, glH - cy)
    );
}

// Ring budget: GLP.v.lensMaxRings (was a hardcoded 160). Ring count used to be
// R/step, which for a 3,000px lens at step 2 is 1,500 clipped full-canvas
// drawImage calls; the step widens instead so the count never passes the cap.
// Each ring measured ~0.45ms GPU-inclusive regardless of its width — see the
// note on the slider.

// ---------------------------------------------------------------
//  Method 7 — VECTOR: warp the geometry, not the pixels
// ---------------------------------------------------------------
// Every raster method (1-5) draws the finished frame into a buffer and then
// COPIES PIXELS back out of it through the lens map. Its cost is therefore
// proportional to screen area covered by the lens — and a big hole covers the
// screen. But this scene is not made of pixels: it is points and lines
// (stars, probes, trails, asteroids, bullets, the ship, arrows, the arena
// edge). So bend each POINT through the lens as it is projected and draw the
// scene once, already lensed. Cost is proportional to vertex count (a few
// thousand), independent of hole size, zoom, or how much screen it covers.
//
// This generalises method 6, which already did exactly this for stars only.
//
// Same optics as method 6: the forward thin-lens map (where does a point at
// true screen radius beta APPEAR?), displacements from several holes summed.
// What it gives up versus the raster thin-lens method:
//   - only the primary (outer) image — no mirrored inner image;
//   - small objects are displaced as a whole, not stretched: an asteroid is
//     moved by the lens at its centre but keeps its shape. Long lines DO bend,
//     because they are drawn as many short segments (trails, arena edge).
// Neither is visible at playing speed; both are a fair trade for ~0ms.

// Per-frame list of lens params for every hole, screen space. Shared with the
// starfield method.
function glBuildVecLens() {
    return glHoles.map(function (h) {
        const s = glHoleScreenOf(h);
        const lp = glLensParamsFor(h);
        return { x: s.x, y: s.y, tE: lp.tE, R: lp.R, strength: lp.strength / 1.8,
                 s: lp.strength, inner: Math.max(glHorizonScreenROf(h), 1) };
    });
}

// Forward lens: a point truly at screen radius beta from hole e — at what
// radius does it APPEAR? Shared by methods 6 and 7 so they can never disagree.
//
// Heuristic profile (vecHeuristic, default): the raster ring method answers
// the INVERSE question — screen radius r shows the scene from r/d(r), with
// d(r) = 1 + a/r², a = (s/335)·R². Going forward means solving
//     beta = r / (1 + a/r²)   i.e.   r³ − beta·r² − beta·a = 0
// for r. One real root above beta; Newton from r0 = beta + cbrt(beta·a),
// which is provably at or above the root, converges monotonically — 6 steps
// is far more than enough at screen precision. This is what lets the vector
// method reproduce the look the user chose, not just approximate it.
//
// Thin-lens profile: the positive root of the thin-lens quadratic,
// theta = (beta + sqrt(beta² + 4·thetaE²)) / 2, strength as a multiplier.
function glForwardLens(e, beta) {
    const fade = glFeather(beta / e.R);
    if (GLP.v.vecHeuristic) {
        const a = (e.s / 335) * e.R * e.R;
        let r = beta + Math.cbrt(beta * a);
        for (let i = 0; i < 6; i++) {
            const f = r * r * r - beta * r * r - beta * a;
            const fp = 3 * r * r - 2 * beta * r;
            if (fp <= 0) break;
            r -= f / fp;
        }
        return beta + (r - beta) * fade;
    }
    const theta = (beta + Math.sqrt(beta * beta + 4 * e.tE * e.tE)) / 2;
    return beta + (theta - beta) * fade * e.strength;
}

// Bends one screen point through every active lens. Returns {x, y} and, if the
// bent point lands inside a horizon disc, h: true (the caller skips it).
function glLensScreenPoint(sx, sy) {
    const L = glVecLens;
    let ox = sx, oy = sy;
    for (let j = 0; j < L.length; j++) {
        const e = L[j];
        const dx = sx - e.x, dy = sy - e.y;
        const beta = Math.hypot(dx, dy);
        if (beta >= e.R || beta < 0.001) continue;
        const k = glForwardLens(e, beta) / beta;
        ox += dx * (k - 1);
        oy += dy * (k - 1);
    }
    for (let j = 0; j < L.length; j++) {
        const e = L[j];
        if (Math.hypot(ox - e.x, oy - e.y) < e.inner) return { x: ox, y: oy, h: true };
    }
    return { x: ox, y: oy };
}

// The thin-lens map, guarded. Returns the source radius for a given observed
// radius; negative results (the inner image) are folded to their magnitude,
// which is what produces the ring of duplicated sky just outside the horizon.
function glBeta(theta, tE) {
    const b = theta - (tE * tE) / Math.max(theta, 0.5);
    return Math.abs(b);
}

// A 0..1 taper that fades any method's effect out at the lens boundary, so the
// distortion does not end on a visible hard circle. Feather 0 disables it,
// which is worth doing once to see how obvious that edge really is.
function glFeather(t) {
    const f = GLP.v.lensFeather;
    if (f <= 0) return 1;
    const edge = 1 - f;
    if (t <= edge) return 1;
    return 1 - (t - edge) / f;
}

// ---------------------------------------------------------------
//  Method 1 — concentric rings, heuristic scale factor
// ---------------------------------------------------------------
function glLensRings(hole, useThinLens, lp) {
    const hs = glHoleScreenOf(hole);
    const cx = hs.x, cy = hs.y;
    const R = lp.R;                                   // feather/heuristic reference
    const inner = Math.max(glHorizonScreenROf(hole), 2);
    // Start at the lens edge or the farthest visible corner, whichever is
    // nearer — rings entirely off-screen are pure cost.
    const rStart = Math.min(R, glFarCorner(cx, cy));
    const step = Math.max(1, GLP.v.lensStep, (rStart - inner) / GLP.v.lensMaxRings);
    const strength = lp.strength;

    for (let r = rStart; r > inner; r -= step) {
        let srcR;
        if (useThinLens) {
            srcR = glBeta(r, lp.tE);
        } else {
            // The ad-hoc form: distortion rises as R/r², unbounded at the
            // centre. Kept exactly as-is because its failure mode is the
            // instructive part — compare it against method 2 at the same
            // strength and the difference is entirely in the inner rings.
            // 2026-09-10: normalised. The original `1 + s·R/r²` is NOT scale
            // invariant — writing x = r/R it is `1 + s/(R·x²)`, so the same
            // strength distorts 10x less on a lens 10x wider, and a big hole
            // under the user's chosen heuristic method read as barely lensed.
            // `1 + (s/335)·(R/r)²` is identical to the old form at R = 335px
            // (the user's tuned radius) and the same shape at every size.
            const distortion = 1 + (strength / 335) * (R / r) * (R / r);
            srcR = r / distortion;
        }

        // Blend the effect out at the rim so the lens has no hard edge.
        const fade = glFeather(r / R);
        srcR = r + (srcR - r) * fade * (useThinLens ? strength / 1.8 : 1);
        if (srcR <= 0.5) continue;

        glCtx.save();
        glCtx.beginPath();
        glCtx.arc(cx, cy, r, 0, Math.PI * 2);
        glCtx.arc(cx, cy, Math.max(r - step, 0), 0, Math.PI * 2, true);
        glCtx.clip("evenodd");
        glCtx.drawImage(
            glBuffer,
            cx - srcR, cy - srcR, srcR * 2, srcR * 2,
            cx - r, cy - r, r * 2, r * 2
        );
        glCtx.restore();
    }
}

// ---------------------------------------------------------------
//  Method 3 — radial sectors
// ---------------------------------------------------------------
// Rings can only scale. Sectors can scale AND rotate the sample, which is the
// only way anything in the ring family can show frame dragging: the twist angle
// falls off with radius, so the sky visibly shears around a spinning hole.
// Cap on how much one sector ring may magnify (or shrink) its source. Near the
// Einstein radius the thin-lens ratio goes to zero — genuinely infinite
// magnification — and one ring would blow a sub-pixel source up across a whole
// wedge, which reads as a flashing block rather than a lens.
const GL_SECTOR_MAX_MAG = 12;

function glLensSectors(hole, lp) {
    const hs = glHoleScreenOf(hole);
    const cx = hs.x, cy = hs.y;
    const R = lp.R;
    const inner = Math.max(glHorizonScreenROf(hole), 2);
    const rStart = Math.min(R, glFarCorner(cx, cy));
    // A quarter of the ring budget: each ring here is 16 sector draws.
    const step = Math.max(2, GLP.v.lensStep * 2, (rStart - inner) / Math.max(1, GLP.v.lensMaxRings / 4));
    const sectors = 16;
    const dA = (Math.PI * 2) / sectors;
    const k = lp.strength / 1.8;

    // FIXED RING COUNT (2026-09-10). This was `for (r = rStart; r > inner;
    // r -= step)`, whose count is floor or ceil of span/step depending on
    // floating-point rounding — so as the lens radius eased with the approach
    // boost, the loop flickered between 10 and 11 rings and the ring pattern
    // jumped. An integer count with equal-width bands cannot flicker.
    const nRings = Math.max(1, Math.ceil((rStart - inner) / step - 1e-6));
    const band = (rStart - inner) / nRings;

    for (let i = 0; i < nRings; i++) {
        const r = rStart - i * band;
        const rIn = Math.max(inner, r - band);
        const fade = glFeather(r / R);
        // STRENGTH AS A POWER, NOT A MULTIPLIER (fixed 2026-09-10).
        //
        // This was `srcR = r + (beta − r)·fade·k`: the thin-lens shift scaled
        // linearly by k = strength/1.8. At the preferred strength (6, boosted
        // to 15 on approach) k reaches 8.3, which throws srcR PAST ZERO for
        // most rings. Those were silently skipped — measured: 5 of 11 rings at
        // zoom 1, all 10 at zoom 0.39 — and the few that survived sat beside
        // the zero crossing, magnifying a tiny source up to 44x. Which rings
        // survived flipped as the ship's altitude (and so the approach boost)
        // changed, so the lens popped. Those survivors were the OUTER rings,
        // off-screen at high zoom and on screen once the whole lens fit —
        // which is why it looked stable above zoom ~0.4 and broke below it.
        //
        // srcR = r · q^(k·fade), q = beta/r, can never cross zero, is
        // continuous in r, k and fade (so no ring ever pops in or out), is the
        // identity at k·fade = 0 and exactly the thin-lens map at k = 1. The
        // clamp bounds magnification either way.
        const q = Math.max(glBeta(r, lp.tE) / r, 1e-6);
        let srcR = r * Math.pow(q, k * fade);
        srcR = Math.min(r * GL_SECTOR_MAX_MAG, Math.max(r / GL_SECTOR_MAX_MAG, srcR));
        if (srcR < 0.25) continue;   // only when r itself is ~3px — nothing to draw

        // Twist strongest near the horizon, zero at the rim.
        const twist = hole.spin * GLP.v.swirl * 1.2 * Math.pow(1 - r / R, 2);

        for (let s = 0; s < sectors; s++) {
            const a0 = s * dA;
            glCtx.save();
            glCtx.beginPath();
            // ANNULAR sector, not a pie slice (2026-09-10). A pie slice from the
            // centre out to r filled the whole wedge every ring, relying on
            // smaller rings to paint over the inside — so every lens pixel was
            // drawn ~N/2 times. That was hidden while most rings were being
            // skipped; with every ring drawn it measured 49.5ms at zoom 0.3.
            // Each draw now touches only its own band. The 0.75px / 3% overlap
            // keeps anti-aliased clip edges from showing as hairline seams.
            const ov = dA * 0.03;
            glCtx.arc(cx, cy, r + 0.75, a0 - ov, a0 + dA + ov);
            glCtx.arc(cx, cy, Math.max(0, rIn - 0.75), a0 + dA + ov, a0 - ov, true);
            glCtx.closePath();
            glCtx.clip();
            glCtx.translate(cx, cy);
            glCtx.rotate(twist);
            glCtx.translate(-cx, -cy);
            glCtx.drawImage(
                glBuffer,
                cx - srcR, cy - srcR, srcR * 2, srcR * 2,
                cx - r, cy - r, r * 2, r * 2
            );
            glCtx.restore();
        }
    }
}

// ---------------------------------------------------------------
//  Method 4 — per-pixel inverse mapping
// ---------------------------------------------------------------
// The honest one. Every destination pixel asks "where did this light come
// from", which is the only way to get a real Einstein ring with a correct inner
// image. Cost is O(R²/step²) with a JS loop over a typed array, so the lensStep
// slider is not a quality knob here so much as a framerate knob.
function glLensPixels(hole, lp) {
    const hs = glHoleScreenOf(hole);
    const cx = hs.x, cy = hs.y;
    const tE = lp.tE;
    const R = lp.R;
    const step = Math.max(1, GLP.v.lensStep);
    const inner = Math.max(glHorizonScreenROf(hole), 1);

    // Clamp the work box to the canvas — off-screen pixels cost the same as
    // on-screen ones otherwise, and a hole near the edge is the common case.
    const x0 = Math.max(0, Math.floor(cx - R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const x1 = Math.min(glW, Math.ceil(cx + R));
    const y1 = Math.min(glH, Math.ceil(cy + R));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;

    const src = glBufCtx.getImageData(x0, y0, bw, bh);
    const dst = glCtx.createImageData(bw, bh);
    const s = src.data, d = dst.data;
    const strength = lp.strength / 1.8;

    for (let py = 0; py < bh; py += step) {
        for (let px = 0; px < bw; px += step) {
            const dx = (x0 + px) - cx;
            const dy = (y0 + py) - cy;
            const theta = Math.hypot(dx, dy);

            let sx, sy;
            if (theta > R) {
                sx = px; sy = py;                     // Outside the lens: identity.
            } else if (theta < inner) {
                // Inside the horizon: leave transparent. gl-draw.js paints the
                // black disc on top, and letting the lens decide the hole's
                // colour would mean two places own the same pixels.
                sx = -1; sy = -1;
            } else {
                const fade = glFeather(theta / R);
                let beta = glBeta(theta, tE);
                beta = theta + (beta - theta) * fade * strength;
                const k = beta / theta;
                sx = Math.round(cx + dx * k) - x0;
                sy = Math.round(cy + dy * k) - y0;
            }

            let r = 0, g = 0, b = 0, a = 0;
            if (sx >= 0 && sy >= 0 && sx < bw && sy < bh) {
                const si = (sy * bw + sx) * 4;
                r = s[si]; g = s[si + 1]; b = s[si + 2]; a = s[si + 3];
            }

            // Write the whole step×step block from the one sample. This is the
            // downsample: at step 3 it is one ninth of the sampling work and
            // reads as a slight chunkiness only where contrast is high.
            for (let by = 0; by < step && py + by < bh; by++) {
                for (let bx = 0; bx < step && px + bx < bw; bx++) {
                    const di = ((py + by) * bw + (px + bx)) * 4;
                    d[di] = r; d[di + 1] = g; d[di + 2] = b; d[di + 3] = a;
                }
            }
        }
    }

    glCtx.putImageData(dst, x0, y0);
}

// ---------------------------------------------------------------
//  Method 5 — per-pixel at reduced resolution
// ---------------------------------------------------------------
// Method 4's cost is dominated by two things: the JS loop, and the putImageData
// of a full-resolution box. This variant attacks both — it resolves the lens
// into a buffer `step` times smaller in each axis and lets drawImage scale it
// back up, which moves the interpolation onto the GPU. The map is identical, so
// any difference you see between this and method 4 is purely resolution, which
// makes the pair a direct answer to "how much resolution does this effect
// actually need".
// Two scratch canvases: one holds the DOWNSCALED source, one receives the
// lensed result. Measuring method 4 showed the JS loop was not actually the
// bottleneck — getImageData over a full-resolution 640x640 box was — so this
// variant downscales with drawImage FIRST (GPU) and only ever reads back the
// small image. That is where most of its speed comes from.
const glLowResSrc = document.createElement("canvas");
const glLowResSrcCtx = glLowResSrc.getContext("2d", { willReadFrequently: true });
const glLowResCanvas = document.createElement("canvas");
const glLowResCtx = glLowResCanvas.getContext("2d");

function glLensPixelsLowRes(hole, lp) {
    const hs = glHoleScreenOf(hole);
    const cx = hs.x, cy = hs.y;
    const tE = lp.tE;
    const R = lp.R;
    const step = Math.max(1, GLP.v.lensStep);
    const inner = Math.max(glHorizonScreenROf(hole), 1);

    const x0 = Math.max(0, Math.floor(cx - R));
    const y0 = Math.max(0, Math.floor(cy - R));
    const x1 = Math.min(glW, Math.ceil(cx + R));
    const y1 = Math.min(glH, Math.ceil(cy + R));
    const bw = x1 - x0, bh = y1 - y0;
    if (bw <= 0 || bh <= 0) return;

    const ow = Math.max(1, Math.ceil(bw / step));
    const oh = Math.max(1, Math.ceil(bh / step));

    // Downscale the source region on the GPU, then read back only ow x oh.
    glLowResSrc.width = ow;
    glLowResSrc.height = oh;
    glLowResSrcCtx.imageSmoothingEnabled = true;
    glLowResSrcCtx.drawImage(glBuffer, x0, y0, bw, bh, 0, 0, ow, oh);
    const src = glLowResSrcCtx.getImageData(0, 0, ow, oh);

    const out = glLowResCtx.createImageData(ow, oh);
    const s = src.data, d = out.data;
    const strength = lp.strength / 1.8;

    for (let oy = 0; oy < oh; oy++) {
        // Sample from the CENTRE of each output cell, not its corner —
        // corner sampling shifts the whole image half a step toward the
        // origin, which at step 8 is a visible offset of the entire lens.
        const py = Math.min(bh - 1, (oy + 0.5) * step);
        const dy = (y0 + py) - cy;
        for (let ox = 0; ox < ow; ox++) {
            const px = Math.min(bw - 1, (ox + 0.5) * step);
            const dx = (x0 + px) - cx;
            const theta = Math.hypot(dx, dy);

            // Source coordinates in FULL-RES screen pixels, converted to the
            // low-res grid at the end — keeping the map itself in screen units
            // is what makes this provably the same optics as method 4.
            let fx, fy;
            if (theta > R) { fx = px; fy = py; }
            else if (theta < inner) { fx = -1; fy = -1; }
            else {
                const fade = glFeather(theta / R);
                let beta = glBeta(theta, tE);
                beta = theta + (beta - theta) * fade * strength;
                const k = beta / theta;
                fx = cx + dx * k - x0;
                fy = cy + dy * k - y0;
            }

            const di = (oy * ow + ox) * 4;
            if (fx >= 0 && fy >= 0) {
                const lx = Math.min(ow - 1, Math.floor(fx / step));
                const ly = Math.min(oh - 1, Math.floor(fy / step));
                const si = (ly * ow + lx) * 4;
                d[di] = s[si]; d[di + 1] = s[si + 1]; d[di + 2] = s[si + 2]; d[di + 3] = s[si + 3];
            }
        }
    }

    glLowResCanvas.width = ow;
    glLowResCanvas.height = oh;
    glLowResCtx.putImageData(out, 0, 0);

    glCtx.save();
    glCtx.imageSmoothingEnabled = true;
    glCtx.drawImage(glLowResCanvas, 0, 0, ow, oh, x0, y0, bw, bh);
    glCtx.restore();
}

// ---------------------------------------------------------------
//  Method 6 — starfield displacement
// ---------------------------------------------------------------
// Not a post-process: the stars are simply drawn somewhere else. Because it
// never touches the buffer it is effectively free and unbounded in radius, but
// it can only lens the starfield — an asteroid crossing the lens stays
// perfectly straight, which is either an acceptable stylisation or the thing
// that kills the method, and that is a playtest question.
function glDrawLensedStars(c) {
    // Screen positions and lens params resolved once per frame per hole, not
    // once per star per hole. Same list the vector method uses.
    const hsList = glBuildVecLens();

    for (let i = 0; i < GL_STAR_COUNT; i++) {
        const star = glStars[i];
        const ox = glCX + glStarWrap(star.x - glStarOff.x);
        const oy = glCY + glStarWrap(star.y - glStarOff.y);
        let sx = ox, sy = oy;
        let bright = 1;
        let hidden = false;

        // Displacements from every hole are SUMMED, each computed from the
        // star's true position. Chaining them (feeding hole A's output into
        // hole B) would make the result depend on hole order in the array,
        // which is not a physical property of anything.
        for (let j = 0; j < hsList.length; j++) {
            const hs = hsList[j];
            const dx = ox - hs.x, dy = oy - hs.y;
            const beta = Math.hypot(dx, dy);
            if (beta >= hs.R) continue;

            // Forward map: given where the star IS (beta), solve for where it
            // APPEARS (theta). The positive root of the thin-lens quadratic,
            // theta = (beta + sqrt(beta^2 + 4 thetaE^2)) / 2 — light always
            // appears pushed AWAY from the hole.
            // Same forward map as the vector method, so switching 6 <-> 7
            // changes only WHAT is lensed, never how.
            const tE = hs.tE;
            const theta = beta > 0.001 ? glForwardLens(hs, beta) : beta;
            const k = beta > 0.001 ? theta / beta : 1;
            sx += dx * (k - 1);
            sy += dy * (k - 1);

            // Magnification. The real expression diverges at beta=0; clamped,
            // because a single infinitely bright star is not a look.
            const mu = Math.abs(1 / Math.max(1 - Math.pow(tE / Math.max(theta, 1), 4), 0.08));
            bright = Math.max(bright, Math.min(3, mu));
        }

        if (sx < -4 || sy < -4 || sx > glW + 4 || sy > glH + 4) continue;
        // Hidden behind any hole's disc.
        for (let j = 0; j < hsList.length; j++) {
            if (Math.hypot(sx - hsList[j].x, sy - hsList[j].y) < hsList[j].inner) { hidden = true; break; }
        }
        if (hidden) continue;

        c.globalAlpha = Math.min(1, 0.5 * bright);
        c.fillStyle = bright > 1.4 ? "#E8FFF4" : "#8FA89C";
        c.beginPath();
        c.arc(sx, sy, star.size * Math.min(2, bright), 0, Math.PI * 2);
        c.fill();
    }
    c.globalAlpha = 1;
}

// Plain starfield, for every method that is not #5.
function glDrawStars(c) {
    c.fillStyle = "#8FA89C";
    for (let i = 0; i < GL_STAR_COUNT; i++) {
        const star = glStars[i];
        const sx = glCX + glStarWrap(star.x - glStarOff.x);
        const sy = glCY + glStarWrap(star.y - glStarOff.y);
        if (sx < 0 || sy < 0 || sx > glW || sy > glH) continue;
        c.beginPath();
        c.arc(sx, sy, star.size, 0, Math.PI * 2);
        c.fill();
    }
}

// ---------------------------------------------------------------
//  Dispatch
// ---------------------------------------------------------------
// Composites glBuffer onto the visible canvas using the selected method, and
// records how long that took in glLensMs — the number that decides whether a
// method is usable in the real game at all.
function glComposite() {
    const t0 = performance.now();
    const method = GLP.lensMethod;

    // Every method starts from an undistorted full-screen blit; the distorted
    // region is then painted over the top of it. This is also why a method that
    // fails only shows a plain frame rather than a black screen.
    glCtx.drawImage(glBuffer, 0, 0);

    // "stars" and "vector" did their lensing while stage 1 drew the scene.
    if (GLP.v.lensStrength > 0 && method !== "stars" && method !== "vector" && method !== "off") {
        // One lens pass per ON-SCREEN hole. Each pass samples the undistorted
        // buffer, not the screen, so where two lenses overlap the later hole
        // simply paints over the earlier one rather than compounding it. That
        // is a known limitation of the buffer-sampling methods with several
        // holes; the starfield method sums deflections properly instead. Cost
        // is linear in visible holes, which the lens-ms readout will show.
        //
        // The off-screen cull stays per hole: in a 32,000-unit arena most
        // holes are off-screen most of the time, and should cost nothing.
        for (let i = 0; i < glHoles.length; i++) {
            const h = glHoles[i];
            const hs = glHoleScreenOf(h);
            const lp = glLensParamsFor(h);
            const R = lp.R;
            if (hs.x < -R || hs.y < -R || hs.x > glW + R || hs.y > glH + R) continue;
            // Horizon covers the whole screen: nothing visible to distort.
            if (glHorizonScreenROf(h) >= glFarCorner(hs.x, hs.y)) continue;

            if (method === "rings") glLensRings(h, false, lp);
            else if (method === "thinlens") glLensRings(h, true, lp);
            else if (method === "sectors") glLensSectors(h, lp);
            else if (method === "pixel") glLensPixels(h, lp);
            else if (method === "pixellow") glLensPixelsLowRes(h, lp);
        }
    }

    // Force the queued GPU work to finish before stopping the timer — see the
    // gpuSync toggle. Without it this number is recording time only.
    if (GLP.v.gpuSync) glCtx.getImageData(0, 0, 1, 1);
    glLensMs = performance.now() - t0;
}
