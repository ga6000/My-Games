// ===================================================
//   Gravity Lab — the five gravity models, and one integrator
// ===================================================
// Every model is a single scalar function of one hole and a radius,
// glAccelMag(hole, r). Since 2026-09-08 there can be several holes; each reads
// its own mass/r_s/wellRadius, and glGravityAt() sums them. Direction,
// frame-dragging swirl, the acceleration cap and the influence-radius cutoff
// are applied ONCE, in glGravityAt(), for all of them — so switching models
// compares the models themselves rather than five slightly different
// implementations of the surrounding bookkeeping.
//
// Units are the game's, not physics': "GM" is whatever number makes the ship
// feel right at a few hundred world-units of separation. Nothing here is
// pretending to be a simulation; the point is which approximation reads as a
// black hole while you are flying past it.
"use strict";

const GL_GRAVITY_MODELS = {
    // Textbook inverse square, with a floor on r so the singularity does not
    // produce an infinite kick in one frame. Included as the control case: it
    // is what everyone writes first, and it is genuinely hard to fly near.
    newton: {
        label: "Newton (1/r^2)",
        blurb: "Inverse square with a hard radius floor. No horizon, no capture — a close pass slingshots to absurd speed. The baseline everything else is judged against.",
        f: function (h, r) {
            const rr = Math.max(r, 8);
            return h.mass / (rr * rr);
        }
    },

    // Plummer sphere: the standard softened potential. The softening length e
    // turns the singularity into a finite-density core, so a direct hit is
    // survivable and the peak force is bounded by construction rather than by
    // the accelCap slider.
    plummer: {
        label: "Plummer (softened core)",
        blurb: "a = GM·r / (r²+e²)^1.5. Force peaks near r=e and falls to zero at the centre. Forgiving, stable, and physically defensible — but it has no horizon, so nothing can ever be captured.",
        f: function (h, r) {
            const e = GLP.v.softening;
            const d = Math.pow(r * r + e * e, 1.5);
            return h.mass * r / Math.max(d, 1e-6);
        }
    },

    // Paczynski–Wiita pseudo-Newtonian potential. The reason to care: with a
    // 1/(r-rs)^2 force, a Newtonian integrator reproduces the two features that
    // actually make a black hole read as one — a marginally stable orbit at
    // 3·rs, and genuine capture below it. No GR needed.
    paczynski: {
        label: "Paczynski-Wiita (pseudo-GR)",
        blurb: "a = GM/(r-rs)². Newtonian code, GR behaviour: an ISCO at 3·rs and real capture inside it. The best value-for-effort model here — recommended default.",
        f: function (h, r) {
            const d = Math.max(r - h.rs, 0.5);
            return h.mass / (d * d);
        }
    },

    // Schwarzschild effective force for an orbiting body, truncated to the
    // leading correction. The 1/r^4 term is what precesses an orbit — set
    // grTerm high and an elliptical probe orbit visibly rotates, which is the
    // one relativistic effect a player can actually see without lensing.
    schwarzschild: {
        label: "Schwarzschild (precessing)",
        blurb: "a = GM/r² · (1 + w·3rs²/r²). The extra 1/r⁴ term precesses elliptical orbits — the one GR effect visible in the motion itself. Raise the r^-4 weight and watch probe orbits rosette.",
        f: function (h, r) {
            const rr = Math.max(r, h.rs * 0.5 + 1);
            const corr = 1 + GLP.v.grTerm * 3 * (h.rs * h.rs) / (rr * rr);
            return (h.mass / (rr * rr)) * corr;
        }
    },

    // Not physics at all: a bounded pull that switches off cleanly at the
    // influence radius. Costs nothing, never explodes, and is trivially
    // tunable — the honest arcade option, here so the physical models have
    // something to be compared against on feel rather than on correctness.
    arcade: {
        label: "Arcade well (bounded)",
        blurb: "Linear-to-quadratic ramp that reaches zero exactly at the influence radius. Not physical, cannot blow up, and is the easiest to balance around. Compare on feel, not correctness.",
        f: function (h, r) {
            const R = h.wellRadius;
            if (r >= R) return 0;
            const t = 1 - r / R;
            return h.mass / (R * R) * Math.pow(t, GLP.v.lensFalloff) * 6;
        }
    }
};

// Scalar magnitude only — used by glSeedProbes() to pick circular-orbit speeds
// and by the force-field debug overlay.
// Scalar magnitude for ONE hole — used to pick circular-orbit speeds when
// seeding probes, by the autopilot, and by the force-field overlay.
function glAccelMag(hole, r) {
    const m = GL_GRAVITY_MODELS[GLP.gravityModel];
    if (!m || !hole) return 0;
    return m.f(hole, Math.max(r, 0.001));
}

// The one place direction, swirl, capping and cutoff happen — now summed over
// every hole. Superposition is the whole reason multiple holes work at all:
// each contributes independently and the ship only ever feels the total.
//
// The per-hole cap is applied per hole rather than to the sum on purpose. A cap
// on the total would let two distant wells quietly cancel each other out to
// under the cap and then release it all at once as you cross between them; a
// per-hole cap keeps each well's character intact wherever you are.
//
// Returns the summed acceleration plus `r` — the distance to the NEAREST hole,
// which is what the integrator's substep count and the inner-drag test need.
function glGravityAt(x, y) {
    let ax = 0, ay = 0;
    let nearest = Infinity;

    // Only holes in this point's chunk and its 8 neighbours (glNear, 2026-09-10)
    // — exact, since no influence radius reaches past the 3×3.
    const nearH = glNear(x, y).holes;
    for (let i = 0; i < nearH.length; i++) {
        const h = nearH[i];
        const dx = h.x - x, dy = h.y - y;
        const r = Math.hypot(dx, dy);
        if (r < nearest) nearest = r;

        // Outside the influence radius a hole does nothing at all. This is a
        // gameplay decision, not a physical one: an unbounded 1/r² field means
        // the whole arena slowly drains toward one point, which plays badly —
        // and with several holes it would also mean nowhere is ever neutral.
        if (r > h.wellRadius || r < 1e-6) continue;

        let a = glAccelMag(h, r);

        // Cap before the swirl is added, so the cap bounds the radial pull and
        // the swirl can still curve the path at the cap. Uncapped (0) is worth
        // testing: it is what makes Newton feel dangerous.
        if (GLP.v.accelCap > 0) a = Math.min(a, GLP.v.accelCap);

        const ux = dx / r, uy = dy / r;
        ax += ux * a;
        ay += uy * a;

        // Frame dragging, cheaply: a tangential component that falls off faster
        // than the radial one, so it only matters close in. Sign follows this
        // hole's own spin, so two holes can drag in opposite directions.
        if (GLP.v.swirl !== 0 && h.spin !== 0) {
            const tan = a * GLP.v.swirl * h.spin * (h.wellRadius / (r + h.wellRadius));
            ax += -uy * tan;
            ay += ux * tan;
        }
    }

    // Star-system bodies (2026-09-10) pull small objects too — their own
    // bounded ramp, not the black-hole model (gl-bodies.js). `r` stays the
    // nearest HOLE: it drives the integrator's substeps, which exist for the
    // steep hole wells, not the gentle body ones.
    if (glBodies.length) {
        const o = { ax: ax, ay: ay };
        glBodiesGravity(x, y, o);
        ax = o.ax; ay = o.ay;
    }
    return { ax, ay, r: nearest === Infinity ? 0 : nearest };
}

// Velocity Verlet (leapfrog) with radius-adaptive substepping.
//
// This started as semi-implicit Euler and that was WRONG for the job — not
// unstable, but lossy. A probe launched on an exactly circular orbit at r=300
// spiralled into the horizon within 3,000 steps under EVERY model, including
// Newton and Plummer, which have no capture mechanism at all. That decay was
// integrator error being read as physics, which would have made the whole
// bench lie about which models can hold an orbit.
//
// Leapfrog is symplectic: it does not conserve energy exactly either, but the
// error oscillates instead of accumulating, so a circular orbit stays circular
// for as long as you care to watch. It costs one extra force evaluation per
// substep, and that is the correct trade here.
//
// Substepping is separate and still needed: near the horizon a single 60Hz
// step is far too coarse for a 1/(r-rs)² force, and the body tunnels through
// the hole entirely. Substeps scale with well depth, so the common case (far
// out, most bodies, most frames) stays at one step and two force evaluations.
function glIntegrate(body, dt) {
    const scaled = dt * GLP.v.gravTimeScale;
    const g0 = glGravityAt(body.x, body.y);
    // Substep count follows depth in the NEAREST hole's well — that is the one
    // whose curvature the step has to resolve.
    const nh = glNearestHole(body.x, body.y);
    const steps = (g0.r > 0 && nh)
        ? Math.min(8, Math.max(1, Math.floor(nh.wellRadius / Math.max(g0.r, 1))))
        : 1;
    // h carries the *60 that converts this build's per-frame velocity units
    // into per-second ones, applied once here rather than at each use.
    const h = (scaled / steps) * 60;

    let g = g0;
    for (let i = 0; i < steps; i++) {
        // Half kick, full drift, half kick with the force at the NEW position.
        body.vx += g.ax * h * 0.5;
        body.vy += g.ay * h * 0.5;

        body.x += body.vx * h;
        body.y += body.vy * h;

        g = glGravityAt(body.x, body.y);
        body.vx += g.ax * h * 0.5;
        body.vy += g.ay * h * 0.5;

        // Inner drag: bleeds velocity only well inside the influence radius,
        // off by default. Applied outside the symplectic pair on purpose — it
        // is meant to be dissipative, and it is the cheapest way to make an
        // orbit decay into the hole if that is the feel you want.
        if (GLP.v.dragInner > 0 && nh && g.r < nh.wellRadius * 0.5) {
            const k = 1 - GLP.v.dragInner * (h / 60) * (1 - g.r / (nh.wellRadius * 0.5));
            body.vx *= k;
            body.vy *= k;
        }
    }
}

// True once a body is inside the horizon. Every model answers this the same
// way even though only Paczynski-Wiita has a horizon in its force law —
// otherwise "what happens at the middle" would differ per model for reasons
// unrelated to the model, which is exactly the confound this build avoids.
function glInsideHorizon(x, y) {
    const nearH = glNear(x, y).holes;
    for (let i = 0; i < nearH.length; i++) {
        const h = nearH[i];
        if (Math.hypot(x - h.x, y - h.y) < h.rs) return true;
    }
    return false;
}

// Did the straight path from (x0,y0) to (x1,y1) pass through the horizon?
//
// A point test at frame boundaries is not enough once anything moves fast.
// The hyperdrive tops out at 25x base speed = 75 world units per frame against
// a 52-unit-wide horizon, so a ship can begin the frame outside the hole, end
// it outside on the far side, and never be sampled inside — flying through a
// black hole unharmed. Found 2026-09-08 while testing the hyperdrive, which is
// the only thing in this build fast enough to expose it.
//
// This is the closest approach of the SEGMENT to the hole, which is exact for
// straight-line motion and near enough for one frame of a curved path.
function glSegmentHitsHorizon(x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0;
    const len2 = dx * dx + dy * dy;
    if (len2 < 1e-9) return glInsideHorizon(x0, y0);

    const nearH = glNear(x0, y0).holes;
    for (let i = 0; i < nearH.length; i++) {
        const h = nearH[i];
        // Projection of this hole onto the segment, clamped to its ends.
        let t = ((h.x - x0) * dx + (h.y - y0) * dy) / len2;
        t = Math.max(0, Math.min(1, t));
        if (Math.hypot(x0 + dx * t - h.x, y0 + dy * t - h.y) < h.rs) return true;
    }
    return false;
}

// ===================================================
//                  TIME DILATION FACTOR
// ===================================================
// How fast a clock at (x, y) runs compared with the lab's: 1 = normal,
// → dilationMin at a horizon, → voidMax deep in empty space. 2026-09-10.
//
//   u      = Σ (r_s,i · massX_i) / r_i       mass-weighted, summed over holes
//   τ_grav = (1 − u)^(k/2)                   k = dilation power
//   τ_void = 1 + (voidMax − 1)·e^(−u / voidReach)
//   τ      = clamp(τ_grav · τ_void, dilationMin, voidMax)
//
// Why this form:
//   - k = 1 IS the Schwarzschild factor √(1 − r_s/r). It is honest and nearly
//     useless as gameplay: it only bites within ~1% of r_s of the horizon.
//     k = 2 (default) gives τ = altitude / r for a lone hole — a slowdown you
//     feel a few hundred units up. The slider covers both.
//   - r_s carries mass already (Schwarzschild: r_s ∝ M); massX is the hole's
//     mass relative to its size rule, so a heavier-than-rule hole dilates
//     further out and a lighter one less. At massX 1, u = 1 exactly at the
//     horizon of a lone hole: where time should stop, it does.
//   - Summing u over holes makes it multi-body: between two holes the slowdowns
//     compound, as potentials do.
//   - It is NOT cut off at the influence radius, unlike the force. Gravity's
//     cutoff is a gameplay decision about where you get pulled; time dilation
//     is the potential, and it is long-range. Only far from EVERY hole does u
//     approach 0 and the void boost take over.
function glTimeFactor(x, y) {
    let u = 0;
    // Cut at the 3×3 around the point (glNear) — the one approximation the
    // chunked world makes: dilation is long-range, and summing every loaded
    // hole made its cost grow with how far the fleet was spread.
    const nearH = glNear(x, y).holes;
    for (let i = 0; i < nearH.length; i++) {
        const h = nearH[i];
        u += (h.rs * h.massX) / Math.max(Math.hypot(x - h.x, y - h.y), 1e-6);
    }
    // Stars and planets are cosmic bodies too, so they slow clocks — mildly —
    // and a "void" now means far from them as well as from every hole.
    u += glBodiesDilation(x, y);
    const grav = u >= 1 ? 0 : Math.pow(1 - u, GLP.v.dilationPower / 2);
    const vmax = GLP.v.voidMax;
    // 2026-09-11: at real scale a planet's u is ~0.006, so "far from every
    // body" was true almost everywhere — ×1.87 beside Earth. The boost is now
    // also gated by the GALAXY (glGalaxyVoid, gl-galaxy.js): full between the
    // arms and beyond the disk, none on an arm, the Orion spur or the bulge.
    // The toggle restores the old everywhere-void.
    const gv = GLP.v.voidGalactic ? glGalaxyVoid(x, y) : 1;
    const voidBoost = 1 + (vmax - 1) * Math.exp(-u / Math.max(GLP.v.voidReach, 1e-6)) * gv;
    return Math.max(GLP.v.dilationMin, Math.min(vmax, grav * voidBoost));
}
