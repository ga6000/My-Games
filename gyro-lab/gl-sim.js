// ===================================================
//   Gravity Lab — per-frame simulation: fleet, time dilation, autopilot
// ===================================================
// 2026-09-10 rewrite (FLEET_TIME_PLAN.md). Was one ship with its hyperdrive and
// autopilot state in globals; now every ship in glShips carries its own, and
// every ship runs on its OWN clock — see "time dilation" below.
//
// Asteroids, bullets and probes can each have gravity switched off
// independently. Isolating "gravity affects only the probes" is what makes a
// model readable: the field is much easier to judge when the thing you are
// steering is not also falling.
"use strict";

// ===================================================
//                  TIME DILATION
// ===================================================
// Every ship (and, with dilateWorld, every probe/asteroid/bullet/particle) gets
// dtLocal = dt · tau(position), tau from glTimeFactor() in gl-gravity.js.
//
// The key decision: tau scales the ship's ENTIRE timestep — gravity AND
// movement together. That keeps the path identical and only slows the rate it
// is traversed, which is exactly why an orbit stays holdable at tau = 0.01:
// the orbit is the same orbit, run a hundred times slower. Scaling gravity
// alone would make the ship outrun its own well and fly off tangent.
//
// Per-frame blends (turn rate, engine authority) cannot just be multiplied by
// tau — a lerp rate is not linear in time. glTimeLerpRate converts: a blend of
// `a` per frame at normal time becomes 1 − (1 − a)^tau.
function glTauAt(x, y) { return GLP.v.dilationOn ? glTimeFactor(x, y) : 1; }
function glTauWorld(x, y) { return (GLP.v.dilationOn && GLP.v.dilateWorld) ? glTimeFactor(x, y) : 1; }

function glTimeLerpRate(a, tau) {
    // Clamped below 1: a >= 1 is not a blend, and (1 − a)^tau is NaN for a
    // negative base and fractional tau — reachable now that number boxes can
    // push authority past the slider's 1.0.
    const c = Math.min(Math.max(a, 0), 0.9999);
    return 1 - Math.pow(1 - c, tau);
}

// ===================================================
//                  SHIPS
// ===================================================
// The ship keeps gyro-space's constant-speed arcade steering, but as a TARGET
// velocity rather than as position directly. Control authority is how hard the
// engines pull the actual velocity back toward that target each frame — at 1.0
// the ship is exactly the parent game's (gravity cannot move it at all), at 0
// it is a free-falling rock with a rudder.
function glUpdateShips(dt) {
    for (let i = glShips.length - 1; i >= 0; i--) {
        const s = glShips[i];
        glUpdateShipOne(s, dt);
        // Fleet ships that die are gone. Only the controlled ship respawns —
        // the player always has something to fly; a fleet that silently
        // refilled itself at one spawn point would hide every loss.
        if (!s.isAlive && s !== glShip) {
            glLeaveGroup(s);
            glShips.splice(i, 1);
        }
    }
}

function glUpdateShipOne(s, dt) {
    if (!s.isAlive) {
        // A charge dies with the ship — its hum must not outlive it.
        if (s.ultraState) glUltraAbort(s, "ultradrive: ship lost");
        if (s === glShip && Date.now() - s.deathTime >= 1200) {
            // Safe spawn, not a fixed point: with 900-r_s holes the old fixed
            // (0, 600) was inside a horizon.
            glSafeSpawn(s);
            s.homeX = s.x; s.homeY = s.y;
            // A lock taken before dying describes a ship that no longer exists.
            s.autoLock = null;
            s.trajLock = null;
            s.angle = 0;
            s.isAlive = true;
            // Clear the drive on respawn — bursts, and the player's gear: a fresh
            // ship beside Earth still in gear 9 would be a light-year off in a second.
            s.hyperActive = false; s.hyperRemaining = 0; s.hyperPeakV = 0;
            glHyperGear = 0;
            s.speed = s.baseSpeed;
            s.deathCause = "";
        }
        return;
    }

    // Ultradrive (gl-ultra.js) takes the ship out of the simulation entirely:
    // no gravity, no dilation, no collisions. See glUltraUpdateShip.
    if (s.ultraState === "active") { glUltraUpdateShip(s, dt); return; }

    s.tau = glTauAt(s.x, s.y);
    const dtS = dt * s.tau;
    s.clock += dtS;
    const direct = (glMode === "q" && s === glShip);

    // ---- Heading source, in priority order ----
    let desired = null, turn = 0.06;
    s.speedMul = 1;
    s.boost = false;
    const g = s.group;
    if (g && g.leader !== s) {
        // 0.2 (was 0.12): the arrival controller asks for small, frequent
        // corrections, and a slow rudder turned each one into a loop.
        desired = glFollowerHeading(s, g, dt); turn = 0.2;
    } else if (s.autoOrbit) {
        // Autopilot turns faster (0.15 vs 0.06): at the mouse rate it lagged
        // its own commands by most of a quarter-orbit and could never settle.
        desired = glAutoOrbitHeading(s, dtS); turn = 0.15;
    } else if (g && g.cmd && g.cmd.type === "move") {
        desired = glLeaderMoveHeading(s, g); turn = 0.1;
    }
    if (!s.autoOrbit && s.autoLock) { s.autoLock = null; s.autoTarget = null; }   // re-engaging takes a fresh lock
    // Flown by hand: the mouse — or, with the trajectory locked, the held heading.
    if (desired === null && direct) desired = s.trajLock !== null ? s.trajLock : Math.atan2(glMouse.y - glCY, glMouse.x - glCX);
    if (desired === null) {
        // Loiter centre cleared every frame: a home point can sit in a well,
        // or in a planet's path, and planets move (gap found 2026-09-10).
        const hp = glClearPoint(s.homeX, s.homeY, 400 * GL_S);
        desired = glLoiterHeading(s, hp.x, hp.y, 160 * GL_S);
        s.speedMul = 0.8;
    }

    // ---- Escape rule (2026-09-10) ----
    // THE REPORTED BUG: no AI-driven ship could burst against gravity. Followers
    // burst only when far from their SLOT (and the slot falls with the leader),
    // move leaders and idle ships never burst at all, and cruise thrust (0.12
    // authority × speed 3 ≈ 0.36/frame²) is below a hole's 0.585 peak pull — so
    // a group that entered a well could not leave it. Now every ship not flown
    // directly and not on auto-orbit (which manages its own altitude) checks
    // time-to-impact against every hazard and, if it is short, turns outward
    // and burns.
    if (!direct && !s.autoOrbit && GLP.v.escapeOn) {
        const d = glDangerFor(s);
        if (d) { desired = glEscapeHeading(s, d); turn = 0.2; s.speedMul = 1; }
    }
    s.angle += glWrapAngle(desired - s.angle) * glTimeLerpRate(turn, s.tau);

    // Ultradrive charge: lab time, and it launches itself at full charge.
    if (s.ultraState === "charging") glUltraTickCharge(s, dt);

    // ---- Drive ----
    // 2026-09-11: the player's hyperdrive is GEARS (Shift+wheel), no charge —
    // the flown ship runs at cruise × gearStep^gear. Charge-and-burn could not
    // span a real-scale galaxy: a pilot needs everything from 10,000 km/s
    // (settling onto a moon) to a light-year a second. Above 1.8x cruise any
    // ship grips like a burn (the authority line below).
    if (direct && glHyperGear > 0 && !s.autoOrbit) s.speedMul = glGearMul(glHyperGear);
    if (!s.hyperActive) s.speed = s.baseSpeed * s.speedMul;
    if (s.hyperActive) {
        // A burst in an evenly spaced ring GRIPS rather than sprints
        // (2026-09-11): authority goes up, but speed stays within 1.5x of what
        // the ring's spacing asked for. At the full 30 units/frame a ship laps
        // the ring in seconds, and under the default burst settings (lit ~96%
        // of the time) spacing would never exist. Solo auto-orbit is unchanged.
        const lk = s.autoOrbit && s.autoLock;
        const grip = !!(lk && lk.ring && lk.ring.n > 1);
        s.speed = s.baseSpeed * (grip ? Math.min(GLP.v.hyperThrust, s.speedMul * 1.5) : GLP.v.hyperThrust);
        s.hyperPeakV = Math.max(s.hyperPeakV, Math.hypot(s.vx, s.vy));
        s.hyperRemaining -= dtS;
        if (s.hyperRemaining <= 0) {
            s.hyperRemaining = 0;
            s.hyperActive = false;
            s.speed = s.baseSpeed * s.speedMul;
        }
    }

    // ---- Control authority ----
    // Thrust is a TARGET velocity the engines lerp toward, so a 10x target at
    // the standing 0.12 authority is not 10x thrust — it is the same weak
    // engine aimed further away. Measured 2026-09-08 (default PW well, ship
    // falling at 10/frame, 5s burn): 10x @ a=0.12 dies from r=150, 10x @
    // a=0.55 escapes from r=80. So bursts raise authority too.
    // Anything well above cruise — a follower's catch-up (boost), a gear, a
    // geared formation leader — grips like a burn.
    const auth = (s.hyperActive || s.boost || s.speedMul > 1.8) ? Math.max(GLP.v.shipControl, GLP.v.hyperAuthority) : GLP.v.shipControl;
    const a = glTimeLerpRate(auth, s.tau);
    s.vx = glLerp(s.vx, Math.cos(s.angle) * s.speed, a);
    s.vy = glLerp(s.vy, Math.sin(s.angle) * s.speed, a);

    // Kept so the horizon test can look at the whole frame's travel rather
    // than just where it ended — at hyperdrive speeds that is the difference
    // between falling in and flying through untouched.
    const prevX = s.x, prevY = s.y;

    if (GLP.v.gravShip) {
        glIntegrate(s, dtS);
    } else {
        s.x += s.vx * s.tau;
        s.y += s.vy * s.tau;
    }

    if (GLP.v.horizonKills && glSegmentHitsHorizon(prevX, prevY, s.x, s.y)) {
        s.isAlive = false;
        s.deathTime = Date.now();
        s.selected = false;
        glSpawnBurst(s.x, s.y, 20, s === glShip ? "#7DF9FF" : "#C9FFE9");
    }
    // Star-system surfaces are solid (toggle). Segment test, like the horizon.
    if (s.isAlive && GLP.v.bodiesSolid) {
        const hit = glBodyHit(prevX, prevY, s.x, s.y);
        if (hit) {
            s.isAlive = false;
            s.deathTime = Date.now();
            s.selected = false;
            s.deathCause = hit.name;
            glSpawnBurst(s.x, s.y, 20, hit.color);
        }
    }

    // Bounce off the arena wall rather than dying on it.
    if (s.x < GL_WORLD.minX) { s.x = GL_WORLD.minX; s.vx = Math.abs(s.vx); }
    if (s.x > GL_WORLD.maxX) { s.x = GL_WORLD.maxX; s.vx = -Math.abs(s.vx); }
    if (s.y < GL_WORLD.minY) { s.y = GL_WORLD.minY; s.vy = Math.abs(s.vy); }
    if (s.y > GL_WORLD.maxY) { s.y = GL_WORLD.maxY; s.vy = -Math.abs(s.vy); }
}

// Circle a point at radius R: tangential, plus a radial correction toward R.
// Used by idle ships (around their home) and by a move-group leader that has
// arrived (around the target) — ships in this lab cannot stop, only circle.
function glLoiterHeading(s, cx, cy, R) {
    const dx = s.x - cx, dy = s.y - cy;
    const r = Math.max(Math.hypot(dx, dy), 1e-3);
    const ux = dx / r, uy = dy / r;
    const cross = dx * s.vy - dy * s.vx;
    const sense = Math.abs(cross) > 1e-3 ? Math.sign(cross) : 1;
    const err = (r - R) / Math.max(R, 1);
    const radial = Math.max(-1.5, Math.min(1.5, -err * 1.5));
    // Heading = tangent (−uy, ux)·sense + outward (ux, uy)·radial.
    return Math.atan2(ux * sense + uy * radial, -uy * sense + ux * radial);
}

// Belt rocks ride Kepler rails, placed with their system in glUpdateBodies
// (2026-09-11 — they used to integrate under gravity, wrap at the arena edge
// and respawn when swallowed). All that is left per frame is their spin.
function glUpdateAsteroids(dt) {
    for (let i = 0; i < glAsteroids.length; i++) {
        const a = glAsteroids[i];
        a.rotation += a.rotationSpeed * glTauWorld(a.x, a.y) * dt * 60;
    }
}

function glUpdateBullets(dt) {
    for (let i = glBullets.length - 1; i >= 0; i--) {
        const b = glBullets[i];
        const tau = glTauWorld(b.x, b.y);
        if (GLP.v.gravBullet) {
            glIntegrate(b, dt * tau);
        } else {
            b.x += b.vx * tau;
            b.y += b.vy * tau;
        }
        b.life -= tau;
        if (b.life <= 0 || glInsideHorizon(b.x, b.y) || (GLP.v.bodiesSolid && glBodyAt(b.x, b.y))) glBullets.splice(i, 1);
    }
}

// Probes never expire on a timer. They end by falling in, and how long that
// takes is itself the measurement. Under time dilation, a probe falling in
// visibly slows and hangs at the horizon before it crosses — the one GR effect
// people recognise from pictures, and here it falls out of the clock for free.
function glUpdateProbes(dt) {
    const trailLen = GLP.v.probeTrail;
    const fp = glFocusPoint(), range = glFocusRange();
    for (let i = glProbes.length - 1; i >= 0; i--) {
        const p = glProbes[i];
        const tau = glTauWorld(p.x, p.y);
        p.age += dt * tau;

        if (GLP.v.gravProbe) {
            glIntegrate(p, dt * tau);
        } else {
            p.x += p.vx * tau;
            p.y += p.vy * tau;
        }

        if (trailLen > 0) {
            p.trail.push(p.x, p.y);
            while (p.trail.length > trailLen * 2) p.trail.splice(0, 2);
        } else if (p.trail.length) {
            p.trail.length = 0;
        }

        if (glInsideHorizon(p.x, p.y) || (GLP.v.bodiesSolid && glBodyAt(p.x, p.y))) {
            glCapturedCount++;
            glProbes.splice(i, 1);
            continue;
        }
        // Outside the loaded range (2026-09-10; was "outside twice the arena",
        // which at ±40M never happens): no holes there are loaded, so it is
        // just drifting. Count it as ejected and let the top-up replace it
        // near the focus.
        if (Math.hypot(p.x - fp.x, p.y - fp.y) > range * 1.2) {
            glEjectedCount++;
            glProbes.splice(i, 1);
        }
    }

    // Track the slider live, round-robin across holes, so a hole's probes are
    // replaced at that hole rather than all migrating to hole #1.
    const near = glHoles.filter(function (h) { return Math.hypot(h.x - fp.x, h.y - fp.y) < range; });
    while (glProbes.length < GLP.v.probeCount && near.length) {
        glSeedProbeAt(near[glProbeRefill++ % near.length]);
    }
    while (glProbes.length > GLP.v.probeCount) glProbes.pop();
}

let glCapturedCount = 0;
let glEjectedCount = 0;
let glProbeRefill = 0;   // Round-robin cursor for topping probes up across holes

// ===================================================
//                  ESCAPE RULE (2026-09-10)
// ===================================================
// The most urgent hazard for ship s, or null. For every hole and body whose
// well it is inside: altitude above the surface, and radial velocity RELATIVE
// to the body (a planet can close on a ship that is standing still), both
// observed, give a time to impact in lab seconds. Skimming the surface counts
// as zero time. Anything under escapeTime is a danger.
function glDangerFor(s) {
    const hz = glNear(s.x, s.y).hazards;   // only wells that can reach this ship
    let worst = null, worstT = Infinity;
    for (let i = 0; i < hz.length; i++) {
        const e = hz[i];
        const dx = s.x - e.b.x, dy = s.y - e.b.y;
        const r = Math.max(Math.hypot(dx, dy), 1e-3);
        if (r > e.well) continue;
        const ux = dx / r, uy = dy / r;
        const alt = r - e.surface;
        const vr = (s.vx * s.tau - e.vx) * ux + (s.vy * s.tau - e.vy) * uy;   // + = separating
        const tti = vr < -0.02 * GL_S ? alt / (-vr * 60) : Infinity;
        const t = alt < Math.max(GL_AUTO_MIN_ALT * 2, e.surface * 0.1) ? 0 : tti;
        if (t < worstT) { worstT = t; worst = { e: e, ux: ux, uy: uy, alt: alt, tti: t }; }
    }
    return worstT < GLP.v.escapeTime ? worst : null;
}

// Outward with a tangential lean in the direction the ship is already going
// round: leaving straight out throws away the sideways velocity it has, and
// the lean carries it around the body instead of bouncing off the same spot.
// The burst needs no charge and respects autoCooldown, like the autopilot's.
function glEscapeHeading(s, d) {
    const e = d.e;
    const cross = (s.x - e.b.x) * s.vy - (s.y - e.b.y) * s.vx;
    const sense = Math.abs(cross) > 1e-3 ? Math.sign(cross) : 1;
    const tx = -d.uy * sense, ty = d.ux * sense;
    if (!s.hyperActive && s.clock - s.autoLastBurst > GLP.v.autoCooldown) {
        s.hyperActive = true;
        s.hyperRemaining = Math.max(0.5, GLP.v.autoBurst);
        s.hyperPeakV = 0;
        s.autoLastBurst = s.clock;
    }
    s.autoState = "ESCAPE from " + glBodyName(e.b) + " (" +
        (d.tti === 0 ? "skimming" : d.tti.toFixed(1) + "s to impact") + ")";
    return Math.atan2(d.uy + ty * 0.5, d.ux + tx * 0.5);
}

// ===================================================
//                  AUTO-ORBIT (O) — per ship
// ===================================================
// Flies a ship onto a circular orbit and holds it with short hyperdrive bursts.
// It works through the ship's normal controls — a heading in place of the
// mouse, and the same hyperdrive — so whatever it manages, a skilled player
// could also manage at these settings.
//
// THE LOCK, taken once at the moment auto-orbit engages, on the ship:
//   hole — the nearest hole AT THAT MOMENT; it stays the target while engaged
//          (no retarget — explicit request). Disengage and re-engage to change.
//   alt  — the ship's distance from that hole's HORIZON. Held from the horizon,
//          not the centre, so resizing a hole live keeps the ship's height.
//
// Time dilation reaches the autopilot three ways: its integral runs on dtS, its
// burst cooldown reads the ship's own clock (was the wall clock), and its turn
// rate goes through glTimeLerpRate. So deep in a well the whole controller
// slows with the ship, as asked — and because the path is unchanged, the orbit
// it was holding is still the orbit it holds.
function glAutoTargetRadius(s) {
    return s.autoLock ? s.autoLock.hole.rs + s.autoLock.alt : 0;
}

function glAutoEngage(s) {
    // Nearest celestial body by SURFACE distance — a hole, a star or a planet
    // (2026-09-10; holes only before the star systems existed).
    const h = glNearestBody(s.x, s.y);
    if (!h) return null;
    const r = Math.hypot(s.x - h.x, s.y - h.y);
    s.autoLock = { hole: h, alt: Math.max(GL_AUTO_MIN_ALT, r - h.rs) };
    s.autoErrInt = 0;
    return s.autoLock;
}

function glAutoDisengage(s, reason) {
    s.autoOrbit = false;
    s.autoLock = null;
    s.autoTarget = null;
    s.autoState = reason || "";
    // (Orbit groups disbanded here until 2026-09-11. Rings have no leader: each
    // member whose body went disengages on its own, and glUpdateRings drops it.)
    if (s === glShip) glSyncPanelFromParams();
}

function glAutoOrbitHeading(s, dtS) {
    if (!s.autoLock) glAutoEngage(s);
    if (!s.autoLock) return null;
    const h = s.autoLock.hole;
    // Its hole was deleted from under it. Retargeting to whatever is nearest
    // would break the no-retarget rule silently; disengaging says so.
    if (!glBodyExists(h)) { glAutoDisengage(s, "target removed — disengaged"); return null; }
    s.autoTarget = h;

    const dx = s.x - h.x, dy = s.y - h.y;
    const r = Math.max(Math.hypot(dx, dy), 1e-3);
    const ux = dx / r, uy = dy / r;                 // outward unit
    const alt = s.autoLock.alt;
    const targetR = h.rs + alt;

    // Keep the current sense of rotation (sign of r × v). A ship at rest picks
    // the hole's own spin direction, so it is carried by frame drag.
    // Everything relative to the body's velocity (0 for holes and stars; a
    // planet moves), in this ship's proper units.
    const tauS = Math.max(s.tau, 1e-3);
    const bvx = (h.vx || 0) / tauS, bvy = (h.vy || 0) / tauS;
    const rvx = s.vx - bvx, rvy = s.vy - bvy;
    const cross = dx * rvy - dy * rvx;
    // A ring (2026-09-11) flies one way round, whatever each ship was doing.
    const ring = s.autoLock.ring && s.autoLock.ring.n > 1 ? s.autoLock.ring : null;
    const sense = ring ? ring.sense : (Math.abs(cross) > 1e-3 ? Math.sign(cross) : (h.spin >= 0 ? 1 : -1));
    const tx = -uy * sense, ty = ux * sense;

    // Error relative to the locked ALTITUDE, not the orbit radius: above a
    // 900-r_s horizon, losing half a 200-unit altitude is only a 9% radius
    // error — under the burst trigger. Against altitude it is the real 50%.
    const err = (r - targetR) / Math.max(alt, GL_AUTO_MIN_ALT);

    // Integral term (0.8 default). Without it the autopilot parked ~14% inside
    // its target from every start: holding an orbit needs a constant outward
    // push, which a proportional term only gives when there is error.
    if (Math.abs(err) < 0.5) {
        s.autoErrInt += err * dtS;
        s.autoErrInt = Math.max(-2, Math.min(2, s.autoErrInt));   // anti-windup
    }
    const radial = Math.max(-1.5, Math.min(1.5,
        -err * GLP.v.autoRadialGain - s.autoErrInt * GLP.v.autoIntegral));
    const hx = tx + ux * radial, hy = ty + uy * radial;

    // ---- Bursts ----
    // Fire when the error is outside tolerance AND still growing; a burst
    // against a closing error just overshoots. NO CHARGE REQUIRED — a burst
    // ignites the drive directly.
    const vr = rvx * ux + rvy * uy;        // + = moving outward, relative to the body
    const losing = (err < 0 && vr < 0) || (err > 0 && vr > 0);
    if (!s.hyperActive && Math.abs(err) > GLP.v.autoTolerance && losing &&
        s.clock - s.autoLastBurst > GLP.v.autoCooldown) {
        s.hyperRemaining = GLP.v.autoBurst;
        s.hyperActive = true;
        s.hyperPeakV = 0;
        s.autoLastBurst = s.clock;
    }

    s.autoState = err < -GLP.v.autoTolerance ? "too deep"
        : err > GLP.v.autoTolerance ? "closing in"
        : "holding";
    // Ring spacing (2026-09-11): ahead of its slot → slower, behind → faster,
    // 1.2 per radian of phase error, clamped 0.5–1.6x. 1 for a solo orbit.
    const ringMul = ring ? Math.max(0.5, Math.min(1.6, 1 - s.ringErr * 1.2)) : 1;
    // Moving body: feed its velocity forward so the ship orbits the planet
    // rather than the spot the planet used to be. Zero for holes and stars,
    // where this reduces exactly to the heading it always returned.
    if (bvx || bvy) {
        const hn = Math.hypot(hx, hy) || 1;
        const wx = hx / hn * s.baseSpeed * ringMul + bvx, wy = hy / hn * s.baseSpeed * ringMul + bvy;
        s.speedMul = Math.max(0.3, Math.min(3, Math.hypot(wx, wy) / s.baseSpeed));
        return Math.atan2(wy, wx);
    }
    s.speedMul = ringMul;
    return Math.atan2(hy, hx);
}

// ===================================================
//                  FLEET: groups, boids, delta formation
// ===================================================
// A command to more than one ship forms a GROUP: one leader, the rest
// followers in delta (V) slots behind it. Each follower is a boid whose
// desired velocity is:
//   alignment  — the SLOT's own velocity (feed-forward; it was the leader's,
//                which is wrong for every slot the moment the V turns),
//   cohesion   — a proportional pull toward its slot, so it brakes by itself
//                as the slot comes up (the formation IS the cohesion rule),
//   separation — a push away from any ship closer than 0.6 spacings, capped.
// Speed is a LIMIT, not a fixed burn: 1.8x base normally, up to hyperdrive
// speed when more than followerBurstDist behind or while the leader burns.
//
// 2026-09-11 (FORMATION_ULTRA_PLAN.md) — why that replaced the old rule. The
// old catch-up was an open-loop burst: more than 900 from its slot, a follower
// fired autoBurst × 2 (6 s at the defaults) at the full 30 units/frame toward
// a point 900 away. It overshot by thousands of units and circled back at
// hyperdrive speed — the reported "blasting around in circles". With no slot
// velocity in the seek, a follower also chased where its slot HAD been
// whenever the V turned: the spiral.
//
// Time dilation applies per ship, so a formation flying past a hole stretches:
// the inner ships' clocks run slow and they fall behind their slots. That is
// not a bug in the formation — it is the effect, visible.
const glGroups = [];
let glGroupSeq = 0;

function glSelectedShips() {
    return glShips.filter(function (s) { return s.selected && s.isAlive; });
}

// (Orbit groups became rings 2026-09-11; a ring member is simply on auto-orbit.)
function glIsOrbiting(s) {
    return s.autoOrbit;
}

function glLeaveGroup(s) {
    const g = s.group;
    if (!g) return;
    s.group = null;
    if (g.leader === s) {
        const next = g.followers.shift();
        if (next) {
            g.leader = next;
            glAssignSlots(g);
        } else {
            const i = glGroups.indexOf(g);
            if (i !== -1) glGroups.splice(i, 1);
        }
    } else {
        const i = g.followers.indexOf(s);
        if (i !== -1) { g.followers.splice(i, 1); glAssignSlots(g); }
    }
    s.homeX = s.x; s.homeY = s.y;
}

// cmd: {type:"move", x, y, body?} | null (stand down to idle). A move with a
// `body` follows that body and becomes a ring orbit on arrival (right-click on
// a planet, 2026-09-11). There is no {type:"orbit"} group any more: O on
// several ships makes a ring directly (glRingOrbit).
function glCommandShips(ships, cmd) {
    ships = ships.filter(function (s) { return s.isAlive; });
    ships.forEach(glLeaveGroup);
    if (!ships.length) return null;
    if (!cmd) {
        ships.forEach(function (s) { s.autoOrbit = false; s.autoLock = null; s.homeX = s.x; s.homeY = s.y; });
        return null;
    }
    // The ship nearest the target leads, so the formation doesn't have to
    // turn inside out to get there.
    const leader = ships.reduce(function (a, b) {
        return Math.hypot(b.x - cmd.x, b.y - cmd.y) < Math.hypot(a.x - cmd.x, a.y - cmd.y) ? b : a;
    });
    const g = {
        id: ++glGroupSeq, leader: leader, cmd: cmd, formErr: 0,
        followers: ships.filter(function (s) { return s !== leader; }),
        // Facing the TARGET from the first frame (2026-09-11). It was the
        // leader's current velocity, which can point anywhere: the V then
        // swung through up to 180° while the leader turned, and the back rows
        // swept the widest arc of all.
        heading: Math.atan2(cmd.y - leader.y, cmd.x - leader.x)
    };
    leader.group = g;
    g.followers.forEach(function (f) { f.group = g; f.autoOrbit = false; f.autoLock = null; });
    glAssignSlots(g);
    leader.autoOrbit = false;
    leader.autoLock = null;
    leader.progT = -Infinity; // fresh stall baseline for the new order
    leader.progD = Infinity;
    glGroups.push(g);
    glShip = leader;          // "last ship touched"
    return g;
}

// Which follower flies which slot: greedy, front slots first, each taking the
// nearest ship still unassigned. Run at the order and whenever the follower
// set changes (2026-09-11). Slots are INDICES into g.followers and slot k's
// side is k % 2, so before this a single death shifted every later follower
// by one — and swapped each of them to the other wing, mid-flight.
function glAssignSlots(g) {
    const pool = g.followers.slice(), out = [];
    for (let k = 1; pool.length; k++) {
        const p = glSlotPosition(g, k);
        let bi = 0, bd = Infinity;
        for (let i = 0; i < pool.length; i++) {
            const d = Math.hypot(pool[i].x - p.x, pool[i].y - p.y);
            if (d < bd) { bd = d; bi = i; }
        }
        out.push(pool.splice(bi, 1)[0]);
    }
    g.followers = out;
}

// O, the panel checkbox, and group orders all go through here.
function glOrbitCommand(targets, on) {
    targets = targets.filter(function (s) { return s.isAlive; });
    if (!targets.length) return;
    if (!on) {
        glCommandShips(targets, null);
    } else if (targets.length === 1) {
        const s = targets[0];
        glLeaveGroup(s);
        s.autoOrbit = true;
        s.autoLock = null;
        s.trajLock = null;   // the autopilot steers now
    } else {
        // Several ships (2026-09-11; was a delta around an orbiting leader,
        // which is what spiralled): one evenly spaced ring round the body
        // nearest their centroid, at their mean current altitude — "hold where
        // you are", as solo O does — never tighter than the spacing needs.
        let cx = 0, cy = 0;
        targets.forEach(function (s) { cx += s.x; cy += s.y; });
        const b = glNearestBody(cx / targets.length, cy / targets.length);
        if (b) {
            let alt = 0;
            targets.forEach(function (s) { alt += Math.hypot(s.x - b.x, s.y - b.y) - b.rs; });
            glRingOrbit(targets, b, Math.max(glRingAlt(b, targets.length), alt / targets.length));
        }
    }
    glSyncPanelFromParams();
}

// ===================================================
//      RING ORBIT (2026-09-11)
// ===================================================
// A formation that reaches a body — or several ships told to O — breaks up
// into an evenly spaced ring: every ship its own auto-orbit lock on the body,
// all at one altitude and one sense of rotation, each nudging its speed
// (0.5–1.6x) to sit 360°/n from its neighbours. No leader: the reference
// phase is the circular mean of the whole ring, so losing a ship re-spaces
// the rest instead of leaving them chasing a slot nobody holds.
const glRings = [];
let glRingSeq = 0;

// Shared altitude: at least 300 (and 0.6 r_s, so a star or a big hole gets
// room), and high enough that n ships 1.5 spacings apart fit round it.
function glRingAlt(b, n) {
    const r = n * GLP.v.formationSpacing * 1.5 / (Math.PI * 2);
    return Math.max(300 * GL_S, b.rs * 0.6, r - b.rs);
}

// alt null = glRingAlt.
function glRingOrbit(ships, b, alt) {
    ships = ships.filter(function (s) { return s.isAlive; });
    if (!ships.length || !b) return null;
    glCommandShips(ships, null);   // out of every group first
    const n = ships.length;
    if (alt == null) alt = glRingAlt(b, n);
    // One sense for the whole ring: the way the first ship already goes round
    // the body (relative to it — planets move), else the body's own spin.
    const s0 = ships[0];
    const cross = (s0.x - b.x) * (s0.vy * s0.tau - (b.vy || 0)) - (s0.y - b.y) * (s0.vx * s0.tau - (b.vx || 0));
    const sense = Math.abs(cross) > 1e-3 ? Math.sign(cross) : (b.spin >= 0 ? 1 : -1);
    // Slots in the order the ships already sit round the body, so nobody has
    // to cross the ring to reach theirs.
    const TAU = Math.PI * 2;
    function phase(s) { return ((sense * Math.atan2(s.y - b.y, s.x - b.x)) % TAU + TAU) % TAU; }
    const order = ships.slice().sort(function (a, c) { return phase(a) - phase(c); });
    const ring = { id: ++glRingSeq, body: b, alt: alt, sense: sense, order: order, n: n };
    glRings.push(ring);
    order.forEach(function (s) {
        s.autoOrbit = true;
        s.autoLock = { hole: b, alt: alt, ring: ring };
        s.autoErrInt = 0;
        s.ringErr = 0;
    });
    glSyncPanelFromParams();
    return ring;
}

// Once per frame: drop ships that left the ring (new order, disengaged, dead),
// then give each member its phase error against its evenly spaced slot,
// + = ahead of it in the direction of travel.
function glUpdateRings() {
    for (let i = glRings.length - 1; i >= 0; i--) {
        const R = glRings[i];
        R.order = R.order.filter(function (s) {
            return s.isAlive && s.autoOrbit && s.autoLock && s.autoLock.ring === R;
        });
        R.n = R.order.length;
        if (!R.n) { glRings.splice(i, 1); continue; }
        const b = R.body, step = Math.PI * 2 / R.n;
        let sx = 0, sy = 0;
        const p = R.order.map(function (s, k) {
            const v = R.sense * Math.atan2(s.y - b.y, s.x - b.x) - step * k;
            sx += Math.cos(v); sy += Math.sin(v);
            return v;
        });
        const ref = Math.atan2(sy, sx);
        R.order.forEach(function (s, k) { s.ringErr = glWrapAngle(p[k] - ref); });
    }
}

// ===================================================
//      DRIVE GEARS (2026-09-11)
// ===================================================
// Shift+wheel shifts a gear; SPACE drops to gear 0. Speed = cruise ×
// gearStep^gear — gear 1 ≈ the old 10x hyperdrive, gear 3 ≈ 1 AU in 15 s,
// gear 8 ≈ 1 ly in 16 s, gear 9 ≈ 1 ly/s (where the ultradrive starts).
// Q: the flown ship (glHyperGear). E: every formation holding a selected ship
// (g.gear). This replaced hold-SPACE-to-charge, in Q and in formations.
let glHyperGear = 0;
function glGearMul(g) { return Math.pow(GLP.v.hyperGearStep, g); }

// Trajectory lock (2026-09-12): right-click while flying solo holds the
// heading toward the clicked point; the mouse stops steering until a second
// right-click releases it. Gravity still acts — it is the HEADING that is
// held, not the path. It takes the ship off auto-orbit, which would otherwise
// steer over it, and holds through the ultradrive. Cues: gl-audio.js
// glAudioTrajLock, gl-draw.js glDrawTrajLock, a HUD line.
function glToggleTrajLock(wx, wy) {
    const s = glShip;
    if (!s.isAlive) return;
    if (s.trajLock !== null) { s.trajLock = null; glAudioTrajLock(false); return; }
    s.trajLock = Math.atan2(wy - s.y, wx - s.x);
    s.trajLockT = performance.now();
    if (s.autoOrbit) { s.autoOrbit = false; s.autoLock = null; glSyncPanelFromParams(); }
    glAudioTrajLock(true);
}

function glFleetGroups() {
    const out = [];
    glSelectedShips().forEach(function (s) {
        const g = s.group;
        if (g && g.cmd && g.cmd.type === "move" && out.indexOf(g) === -1) out.push(g);
    });
    return out;
}

// dir +1 / -1 shifts; 0 drops to gear 0. Returns the resulting gear.
function glShiftGear(dir) {
    const top = Math.max(0, Math.round(GLP.v.hyperGearMax));
    function next(g) { return dir === 0 ? 0 : Math.max(0, Math.min(top, g + dir)); }
    if (glMode === "e") {
        const gs = glFleetGroups();
        const before = gs.length ? (gs[0].gear || 0) : 0;
        gs.forEach(function (g) { g.gear = next(g.gear || 0); });
        const after = gs.length ? gs[0].gear : 0;
        glAudioGear(before, after);   // shift sound (gl-audio.js), 2026-09-12
        return after;
    }
    const before = glHyperGear;
    glHyperGear = next(glHyperGear);
    glAudioGear(before, glHyperGear);
    // Taking a gear is taking the helm: auto-orbit would otherwise ignore it.
    if (glHyperGear > 0 && glShip.autoOrbit) { glShip.autoOrbit = false; glShip.autoLock = null; glSyncPanelFromParams(); }
    return glHyperGear;
}

function glFormationRadius(g) {
    return GLP.v.formationSpacing * (1.5 + Math.ceil(g.followers.length / 2)) + 100 * GL_S;
}

// Delta slot k (1-based): row = ceil(k/2) back, alternating left/right, so
// the V fills front to back. Rotated to the group's smoothed heading.
function glSlotPosition(g, k) {
    const L = g.leader, sp = GLP.v.formationSpacing;
    const row = Math.ceil(k / 2), side = (k % 2) ? -1 : 1;
    const bx = -row * sp, by = side * row * sp * 0.8;
    const c = Math.cos(g.heading), sn = Math.sin(g.heading);
    const x = L.x + bx * c - by * sn;
    const y = L.y + bx * sn + by * c;
    // Every slot, every hazard (gap found 2026-09-10): pushed clear of each
    // horizon and surface. The orbit-group horizon clamp that sat here went
    // with orbit groups (2026-09-11) — rings hold their own altitude.
    return glClearPoint(x, y, 250 * GL_S);
}

function glLeaderMoveHeading(s, g) {
    const R = glFormationRadius(g);
    // The target is pushed clear of every horizon and surface by the loiter
    // radius plus margin, re-evaluated each frame because planets move. Gap
    // found 2026-09-10: a right-click on or near a hole gave the leader a
    // loiter circle that crossed the horizon.
    const c = glClearPoint(g.cmd.x, g.cmd.y, R + 250 * GL_S);
    const dx = c.x - s.x, dy = c.y - s.y, d = Math.hypot(dx, dy);
    // Formation hyperdrive (2026-09-11): cut the burn once the target is
    // inside braking range (~40 frames of travel), or a 30-units/frame leader
    // shoots straight past and drags the whole V back round after it.
    if (s.hyperActive && d < R * 1.5 + Math.hypot(s.vx, s.vy) * s.tau * 40) {
        s.hyperActive = false;
        s.hyperRemaining = 0;
    }
    if (d > R * 1.5) {
        // 0.85x so followers (1.8x) can catch their slots — 0.55x while the
        // formation is still badly out of shape (mean slot error over 2.5
        // spacings), so it forms up on the way instead of trailing a comet.
        const forming = g.followers.length && g.formErr > GLP.v.formationSpacing * 2.5;
        const cruise = !g.followers.length ? 1 : (forming ? 0.55 : 0.85);
        // The formation's gear (Shift+wheel in E, 2026-09-11), limited so it
        // arrives rather than overshoots: never faster than covers the rest of
        // the way in ~2 s, never slower than cruise.
        s.speedMul = Math.max(cruise, Math.min(cruise * glGearMul(g.gear || 0), (d - R) / (s.baseSpeed * 120)));
        s.autoState = forming ? "moving — forming up" : "moving";
        // Stall rule (gap found 2026-09-10): every 2s of ship time, if the
        // distance to the target shrank by under 3%, gravity is winning —
        // burst toward the target. Without it a leader could head at its goal
        // while being dragged backwards indefinitely.
        //
        // 2026-09-11: "shrank by under 3%" was relative to the REMAINING
        // distance, so every target beyond ~10,000 read as a stall at plain
        // cruise (0.85x covers ~306 units in 2 s; 3% of 14,000 is 420). The
        // leader then burst at 30 units/frame every couple of seconds and
        // dragged its whole formation into hyperdrive catch-up. A stall is now
        // covering under 30% of what the leader's own speed should have covered.
        if (s.clock - s.progT > 2) {
            const expected = s.baseSpeed * s.speedMul * 60 * (s.clock - s.progT);
            if (s.progD - d < expected * 0.3 && !s.hyperActive && s.clock - s.autoLastBurst > GLP.v.autoCooldown) {
                s.hyperActive = true;
                s.hyperRemaining = Math.max(0.5, GLP.v.autoBurst);
                s.hyperPeakV = 0;
                s.autoLastBurst = s.clock;
                s.autoState = "stalled — burst toward target";
            }
            s.progT = s.clock;
            s.progD = d;
        }
        // A moving body target (2026-09-11): feed its velocity forward, as the
        // autopilot does, so the closing speed is the leader's own cruise
        // whatever the planet is doing. Without it, a leader at 0.55–0.85x
        // (1.7–2.6 units/frame) chasing a planet doing ~1.2 closed at a crawl —
        // the right-click-a-planet order took over 120 s and never arrived.
        const b = g.cmd.body;
        if (b && (b.vx || b.vy)) {
            const tauS = Math.max(s.tau, 1e-3);
            const wx = dx / d * s.baseSpeed * s.speedMul + b.vx / tauS;
            const wy = dy / d * s.baseSpeed * s.speedMul + b.vy / tauS;
            s.speedMul = Math.max(0.3, Math.min(3, Math.hypot(wx, wy) / s.baseSpeed));
            return Math.atan2(wy, wx);
        }
        return Math.atan2(dy, dx);
    }
    s.speedMul = 0.7;
    s.autoState = "holding at target";
    return glLoiterHeading(s, c.x, c.y, R);
}

function glFollowerHeading(s, g, dt) {
    const L = g.leader;
    const k = g.followers.indexOf(s) + 1;
    const slot = glSlotPosition(g, k);
    const base = s.baseSpeed;
    const frames = Math.max(dt * 60, 1e-3);        // velocities are per 60 Hz frame
    const lvx = L.vx * L.tau, lvy = L.vy * L.tau;  // the leader, OBSERVED
    const lsp = Math.hypot(lvx, lvy);

    // Slot velocity: the feed-forward. A finite difference of the slot, so it
    // includes the V swinging round when the formation turns (the outer back
    // slot of a turning V moves far faster than the leader). A jump — hazard
    // clearance shoving the slot round a planet — is not a velocity, so it
    // falls back to the leader's. Smoothed, or one noisy frame jerks the ship.
    let svx = lvx, svy = lvy;
    const sp = s.slotPrev;
    if (sp && sp.g === g.id && sp.k === k) {
        const jx = (slot.x - sp.x) / frames, jy = (slot.y - sp.y) / frames;
        if (Math.hypot(jx - lvx, jy - lvy) < base * 3 + lsp * 0.5) { svx = jx; svy = jy; }
        if (s.slotV) { svx = glLerp(s.slotV.x, svx, 0.35); svy = glLerp(s.slotV.y, svy, 0.35); }
    }
    s.slotV = { x: svx, y: svy };
    s.slotPrev = { x: slot.x, y: slot.y, g: g.id, k: k };

    const tx = slot.x - s.x, ty = slot.y - s.y, d = Math.hypot(tx, ty);
    s.slotErr = d;

    // Speed LIMIT: 1.8x base normally; hyperdrive speed when far behind or
    // while the leader itself burns (formation hyperdrive, escape and stall
    // bursts); never under 1.25x whatever the leader is actually doing.
    let cap = base * 1.8;
    if (d > GLP.v.followerBurstDist || L.hyperActive) {
        cap = Math.max(cap, base * GLP.v.hyperThrust * (L.hyperActive ? 1.15 : 1));
    }
    cap = Math.max(cap, lsp * 1.25);

    // Correction toward the slot, proportional to the gap: 2.5% of it per
    // frame, so it closes in ~40 frames and slows by itself on the way in.
    // This is what makes a follower ARRIVE at its slot instead of orbiting it.
    const corr = Math.min(cap, d * 0.025);
    let vx = svx, vy = svy;
    if (d > 1e-3) { vx += tx / d * corr; vy += ty / d * corr; }

    // Separation from every other ship, fleet-wide — two groups crossing
    // should not fly through each other either. Capped in total at base, so a
    // crowd at form-up can nudge a ship but never overpower its slot.
    const sepR = GLP.v.formationSpacing * 0.6;
    let px = 0, py = 0;
    for (let i = 0; i < glShips.length; i++) {
        const o = glShips[i];
        if (o === s || !o.isAlive) continue;
        const ox = s.x - o.x, oy = s.y - o.y, od = Math.hypot(ox, oy);
        if (od < sepR && od > 1e-3) {
            const push = GLP.v.boidSeparation * base * (1 - od / sepR);
            px += ox / od * push;
            py += oy / od * push;
        }
    }
    const pm = Math.hypot(px, py);
    if (pm > base) { px *= base / pm; py *= base / pm; }
    vx += px; vy += py;

    let mag = Math.hypot(vx, vy);
    const lim = Math.max(cap, Math.hypot(svx, svy) + base * 0.5);
    if (mag > lim) { vx *= lim / mag; vy *= lim / mag; mag = lim; }

    // That is an observed velocity; this ship's engines work in its own proper
    // units, so divide by its tau. A follower whose clock is slower than the
    // leader's needs more proper speed to keep station — and, capped, cannot
    // always get it. That is where formations stretch near a hole.
    // (No fixed ceiling since formations take gears, 2026-09-11 — `lim` above
    // already bounds it to the leader's speed plus a margin.)
    s.speedMul = Math.max(0.2, mag / Math.max(s.tau, 1e-3) / base);
    // Above cruise it is using drive power: hyperdrive authority, and a plume.
    s.boost = s.speedMul > 1.8;
    s.autoState = d < GLP.v.formationSpacing * 0.5 ? "in slot" : (s.boost ? "catching up" : "closing on slot");
    return mag > 1e-3 ? Math.atan2(vy, vx) : g.heading;
}

// Once per frame, before ships move: drop the dead, promote a new leader if
// needed, and ease the formation heading toward the leader's direction of
// travel (smoothed, or every wobble of the leader whips the whole V).
function glUpdateGroups() {
    for (let i = glGroups.length - 1; i >= 0; i--) {
        const g = glGroups[i];
        const before = g.followers.length;
        g.followers = g.followers.filter(function (f) { return f.isAlive && f.group === g; });
        let reslot = g.followers.length !== before;
        if (!g.leader || !g.leader.isAlive || g.leader.group !== g) {
            if (g.leader && g.leader.group === g) g.leader.group = null;
            const next = g.followers.shift();
            if (!next) { glGroups.splice(i, 1); continue; }
            g.leader = next;
            reslot = true;
        }
        if (reslot) glAssignSlots(g);
        const L = g.leader;

        // A body target moves (planets), so the order follows it. A body that
        // has gone (unloaded, deleted) leaves a plain move to where it was.
        if (g.cmd && g.cmd.body) {
            const b = g.cmd.body;
            if (glBodyExists(b)) {
                g.cmd.x = b.x;
                g.cmd.y = b.y;
                // ARRIVAL — the leader has reached the cleared target point:
                // the formation breaks into an evenly spaced ring round the body.
                const R = glFormationRadius(g);
                const c = glClearPoint(b.x, b.y, R + 250 * GL_S);
                if (Math.hypot(L.x - c.x, L.y - c.y) < R * 1.5) {
                    glRingOrbit([L].concat(g.followers), b, null);
                    continue;
                }
            } else {
                delete g.cmd.body;
            }
        }

        if (Math.hypot(L.vx, L.vy) > 0.1) {
            g.heading += glWrapAngle(Math.atan2(L.vy, L.vx) - g.heading) * glTimeLerpRate(0.05, L.tau);
        }
        // How out of shape the formation is (last frame's slot errors) — the
        // leader slows down to let it form (glLeaderMoveHeading).
        let e = 0;
        g.followers.forEach(function (f) { e += f.slotErr; });
        g.formErr = g.followers.length ? e / g.followers.length : 0;
    }
}

// ===================================================
//                  MODES
// ===================================================
// Q — direct control of glShip, "the last ship touched". Taking the helm pulls
//     that ship out of any group; it keeps its own auto-orbit state, so a
//     group leader that was orbiting keeps orbiting until you press O.
// E — fleet command. Every idle ship holds (loiters) where it is.
function glSetMode(m) {
    if (m === glMode) return;
    glMode = m;
    if (m === "q") {
        glLeaveGroup(glShip);
    } else {
        // Ultradrive is solo flight only: fleet mode ends a charge or a drive.
        glUltraAbort(glShip, "ultradrive: fleet mode — dropped out");
        glShip.trajLock = null;   // right-click means "go here" in E
        glShips.forEach(function (s) { if (!s.group && !s.autoOrbit) { s.homeX = s.x; s.homeY = s.y; } });
    }
    glSyncPanelFromParams();
}

function glSelectAll() {
    glShips.forEach(function (s) { s.selected = s.isAlive; });
}

// Removes every fleet ship except the controlled one.
function glClearFleet() {
    for (let i = glShips.length - 1; i >= 0; i--) {
        if (glShips[i] !== glShip) { glLeaveGroup(glShips[i]); glShips.splice(i, 1); }
    }
    glGroups.length = 0;
    glShip.group = null;
}

// ===================================================
//                  PARTICLE BURSTS
// ===================================================
const glParticles = [];

function glSpawnBurst(x, y, count, color) {
    for (let i = 0; i < count; i++) {
        const a = Math.random() * Math.PI * 2;
        const s = (1 + Math.random() * 3) * GL_S;
        glParticles.push({ x, y, vx: Math.cos(a) * s, vy: Math.sin(a) * s, life: 1, color });
    }
}

function glUpdateParticles(dt) {
    for (let i = glParticles.length - 1; i >= 0; i--) {
        const p = glParticles[i];
        const tau = glTauWorld(p.x, p.y);
        p.x += p.vx * tau; p.y += p.vy * tau;
        p.life -= dt * (p.decay || 1.5) * tau;   // ultradrive dust lingers (gl-ultra.js)
        if (p.life <= 0 || (GLP.v.bodiesSolid && glBodyAt(p.x, p.y))) glParticles.splice(i, 1);
    }
}

function glSimulate(dt) {
    const t0 = performance.now();
    glWorldTime += dt;    // the clock newly loaded star systems place their planets by
    glUpdateBodies(dt);   // planets first: this frame's ships react to where they ARE
    glUpdateGroups();
    glUpdateRings();
    glUpdateShips(dt);
    glUpdateAsteroids(dt);
    glUpdateBullets(dt);
    glUpdateProbes(dt);
    glUpdateParticles(dt);
    glPhysMs = performance.now() - t0;
}

// ===================================================
//                  CAMERA
// ===================================================
// Runs every frame, paused or not (moved out of glSimulate), so arrow-pan and
// box-select framing still work on a paused scene.
//   Q: follow the controlled ship.
//   E: follow the selection's centroid, eased; arrows pan.
// Zoom range (2026-09-11): 1e-10 shows ~100 ly across a screen, 400 puts a
// 1,000 km hull at 400 px. Was 0.01–3 in the pre-galaxy world.
const GL_ZOOM_MIN = 1e-10, GL_ZOOM_MAX = 400;

function glUpdateCamera(dt) {
    if (!GLP.v.freeCam) {
        if (glMode === "q") {
            glCamera.x = glShip.x;
            glCamera.y = glShip.y;
        } else {
            const sel = glSelectedShips();
            if (sel.length) {
                let cx = 0, cy = 0;
                sel.forEach(function (s) { cx += s.x; cy += s.y; });
                glCamera.x = glLerp(glCamera.x, cx / sel.length, 0.08);
                glCamera.y = glLerp(glCamera.y, cy / sel.length, 0.08);
            }
        }
    }
    if (glPan.x || glPan.y) {
        const k = 900 * dt / glCamera.zoom;     // ~900 screen px/s at any zoom
        glCamera.x += glPan.x * k;
        glCamera.y += glPan.y * k;
    }
    if (GLP.v.autoZoom) glUpdateAutoZoom();
    glUpdateStarOffset();   // after the camera settles: the sky follows it (capped)
}

// Auto-zoom. Q: frame the gap between the ship and the nearest (or locked)
// horizon at ~38% of the short screen side, capped at the influence radius.
// E: frame the selection's bounding box. Eased in log space — zoom is a ratio.
function glUpdateAutoZoom() {
    let target;
    if (glMode === "e") {
        const sel = glSelectedShips();
        if (!sel.length) return;
        let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
        sel.forEach(function (s) { x0 = Math.min(x0, s.x); y0 = Math.min(y0, s.y); x1 = Math.max(x1, s.x); y1 = Math.max(y1, s.y); });
        const extent = Math.max(x1 - x0, y1 - y0, 500 * GL_S);
        target = Math.max(GL_ZOOM_MIN, Math.min(1.2 / GL_S, ((Math.min(glW, glH) || 800) * 0.45) / extent));
    } else {
        // Nearest BODY — planet, moon, star or hole (was holes only): at real
        // scale the thing you are flying near is almost always a planet.
        const h = glShip.autoLock ? glShip.autoLock.hole : glNearestBody(glShip.x, glShip.y);
        if (!h) return;
        const alt = Math.max(0, Math.hypot(glShip.x - h.x, glShip.y - h.y) - h.rs);
        // A planet or star is framed WITH its body (+ r_s): at real scale the
        // ship hovers a few radii up, and framing the gap alone left Earth off
        // screen. Holes keep the tuned gap-only framing.
        const eff = Math.max(150 * GL_S, Math.min(alt, h.wellRadius) + (glHoles.indexOf(h) === -1 ? h.rs * 2 : 0));
        target = Math.max(GL_ZOOM_MIN, Math.min(1.2 / GL_S, ((Math.min(glW, glH) || 800) * 0.38) / eff));
    }
    glCamera.zoom = Math.exp(glLerp(Math.log(glCamera.zoom), Math.log(target), 0.05));
}
