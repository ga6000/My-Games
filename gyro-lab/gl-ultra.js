// ===================================================
//   Gravity Lab — ultradrive (U)
// ===================================================
// Added 2026-09-11 (FORMATION_ULTRA_PLAN.md). The flown ship only, solo only
// (Q mode, not in a formation). Tap U to charge — 10 s, with the ∞ glyph, the
// sphere, the star warp, a rising hum and a countdown as cues — and it
// launches itself at full charge. Tap U again to abort a charge or to drop
// out of the drive.
//
// Speed ramps EXPONENTIALLY over ultraRampTime from peak/ultraRatio to peak,
// so the relative acceleration is constant. Since 2026-09-11 (GALAXY_PLAN.md)
// the peak is DERIVED from ultraCrossMin — a rim-to-rim crossing of the
// 100,000-ly galaxy in 100 minutes, ramp included — which gives 1.72 → 17.2
// ly/s. (It was 100x → 1000x hyperdrive speed, in the pre-galaxy world.)
//
// THE DECISION: a ship in the drive is outside the simulation. No gravity, no
// time dilation (τ = 1), no collisions, no escape rule, and the chunk streamer
// loads nothing around it (gl-chunks.js). At 30,000 units a frame nothing can
// be sampled honestly anyway: the segment tests would need every chunk along a
// path half a chunk long per frame loaded, and with the streamer's ~5 s
// hysteresis that piles up hundreds of loaded chunks. On drop-out the chunks
// there are force-loaded and the ship is pushed clear of anything it landed in.
//
// Audio is synthesised with WebAudio (no files, so file:// is unaffected). The
// context is gl-audio.js's since 2026-09-12, created on the first key or click
// — the user gesture a browser requires before it will make a sound.
"use strict";

let glUltraWarp = 1;          // star-streak multiplier; 1 = plain stars
let glUltraClock = 0;         // lab seconds, for animation (frozen when paused)
let glUltraShakeKick = 0;     // launch / drop-out jolt, decays
let glUltraShaking = false;   // a transform is currently on the canvas
let glUltraMsg = "", glUltraMsgT = -Infinity;   // last refusal or drop-out reason (HUD)
// The beam: world points behind the ship (x, y, x, y, …) and its brightness,
// which falls off after drop-out.
const glUltraBeam = { pts: [], alpha: 0 };
// Launch shockwave: where, and its age in seconds (-1 = none).
const glUltraFlash = { x: 0, y: 0, t: -1 };
const GL_ULTRA_BEAM_PTS = 120;   // ~2 s of trail

function glUltraSay(msg) { glUltraMsg = msg; glUltraMsgT = glUltraClock; }

// Charge fraction 0–1 and ramp fraction 0–1 (0 at launch, 1 at peak speed).
function glUltraChargeF(s) { return s.ultraCharge / Math.max(GLP.v.ultraChargeTime, 0.001); }
function glUltraRamp(s) { return Math.min(1, s.ultraT / Math.max(GLP.v.ultraRampTime, 0.1)); }

// Peak speed in ly/s from the crossing time. A rim-to-rim crossing (2 × the
// disk radius) takes ultraCrossMin minutes INCLUDING the ramp; the ramp covers
// peak·T·(1 − 1/k)/ln k, the rest is at peak.
function glUltraPeakLyS() {
    const D = 2 * GL_GAL.radius, T = GLP.v.ultraRampTime, k = Math.max(GLP.v.ultraRatio, 1.01);
    const total = Math.max(T * 1.01, GLP.v.ultraCrossMin * 60);
    return D / (total - T + T * (1 - 1 / k) / Math.log(k));
}
function glUltraSpeedLyS(s) {
    const k = Math.max(GLP.v.ultraRatio, 1.01);
    return glUltraPeakLyS() / k * Math.pow(k, glUltraRamp(s));
}
// World units per frame (the build's velocity unit).
function glUltraSpeed(s) { return glUltraSpeedLyS(s) * GL_LY / 60; }

// Why the drive can't be used right now, or "" if it can.
function glUltraBlocked(s) {
    if (glMode !== "q") return "fleet mode — Q to fly solo";
    if (!s.isAlive) return "no ship";
    if (s.group) return "in a formation";
    return "";
}

// ===================================================
//                  STATE
// ===================================================
function glUltraToggle() {
    const s = glShip;
    if (s.ultraState === "active") { glUltraExit(s, "dropped out of ultradrive"); return; }
    if (s.ultraState === "charging") { glUltraAbort(s, "ultradrive charge aborted"); return; }
    const why = glUltraBlocked(s);
    if (why) { glUltraSay("ultradrive unavailable: " + why); return; }
    // Aiming is the player's: left on, the autopilot would pick the launch
    // heading (and auto-orbit defaults on for the flown ship).
    if (s.autoOrbit) { s.autoOrbit = false; s.autoLock = null; glSyncPanelFromParams(); }
    s.ultraState = "charging";
    s.ultraCharge = 0;
    glUltraMsg = "";
    glUltraSfxChargeStart();
}

function glUltraAbort(s, reason) {
    if (!s || !s.ultraState) return;
    if (s.ultraState === "active") { glUltraExit(s, reason); return; }
    s.ultraState = "";
    s.ultraCharge = 0;
    if (reason) glUltraSay(reason);
    glUltraSfxChargeStop();
}

// From glUpdateShipOne while charging. LAB time, not ship time: the request is
// a 10 s charge, and the hyperdrive's ship-time charge would stretch it deep
// in a well. Launches itself at full charge.
function glUltraTickCharge(s, dt) {
    if (glUltraBlocked(s)) { glUltraAbort(s, "ultradrive charge aborted"); return; }
    const cap = GLP.v.ultraChargeTime;
    const prev = s.ultraCharge;
    s.ultraCharge = Math.min(cap, s.ultraCharge + dt);
    // Countdown: one blip per whole second, higher for the last three.
    if (Math.floor(prev) !== Math.floor(s.ultraCharge) && s.ultraCharge < cap) {
        glUltraSfxTick(cap - Math.floor(s.ultraCharge) <= 3);
    }
    if (s.ultraCharge >= cap) glUltraLaunch(s);
}

function glUltraLaunch(s) {
    s.ultraState = "active";
    s.ultraT = 0;
    s.ultraCharge = 0;
    s.autoOrbit = false; s.autoLock = null;
    s.hyperActive = false; s.hyperRemaining = 0;
    glHyperGear = 0;
    glUltraSpawnDust(s.x, s.y, s.size);
    glUltraFlash.x = s.x; glUltraFlash.y = s.y; glUltraFlash.t = 0;
    glUltraBeam.pts.length = 0;
    glUltraBeam.pts.push(s.x, s.y);
    glUltraBeam.alpha = 1;
    glUltraShakeKick = 1;
    glUltraSfxChargeStop();
    glUltraSfxLaunch();
    glUltraSfxRumble(true);
}

// The whole per-frame update of a ship in the drive; glUpdateShipOne returns
// straight after it. Mouse steers, slowly — at these speeds a fast rudder
// would throw the beam into knots.
function glUltraUpdateShip(s, dt) {
    s.tau = 1;
    s.speedMul = 1;
    s.boost = false;
    s.ultraT += dt;
    s.clock += dt;
    // A locked trajectory (right-click) holds through the drive — the way to
    // cross the galaxy without holding the mouse still for 10 minutes.
    const desired = s.trajLock !== null ? s.trajLock : Math.atan2(glMouse.y - glCY, glMouse.x - glCX);
    s.angle += glWrapAngle(desired - s.angle) * glTimeLerpRate(0.05, 1);
    const sp = glUltraSpeed(s);
    s.speed = sp;
    s.vx = Math.cos(s.angle) * sp;
    s.vy = Math.sin(s.angle) * sp;
    s.x += s.vx * dt * 60;
    s.y += s.vy * dt * 60;

    const P = glUltraBeam.pts;
    P.push(s.x, s.y);
    if (P.length > GL_ULTRA_BEAM_PTS * 2) P.splice(0, P.length - GL_ULTRA_BEAM_PTS * 2);

    // The arena wall ends the drive rather than bouncing a ship at 30,000/frame.
    if (s.x < GL_WORLD.minX || s.x > GL_WORLD.maxX || s.y < GL_WORLD.minY || s.y > GL_WORLD.maxY) {
        const m = 0.01 * GL_LY;
        s.x = Math.max(GL_WORLD.minX + m, Math.min(GL_WORLD.maxX - m, s.x));
        s.y = Math.max(GL_WORLD.minY + m, Math.min(GL_WORLD.maxY - m, s.y));
        glUltraExit(s, "ultradrive: arena edge — dropped out");
    }
}

function glUltraExit(s, reason) {
    if (s.ultraState !== "active") return;
    s.ultraState = "";
    s.ultraT = 0;
    if (reason) glUltraSay(reason);
    // Load where we are NOW (not 10 frames in) and step clear of anything
    // that turned out to be here — the drive ignored it all on the way.
    glUpdateChunks(true);
    const c = glClearPoint(s.x, s.y, 400 * GL_S);
    s.x = c.x; s.y = c.y;
    // Carry hyperdrive speed out; the engines bleed it back to cruise.
    const hs = s.baseSpeed * GLP.v.hyperThrust;
    s.vx = Math.cos(s.angle) * hs;
    s.vy = Math.sin(s.angle) * hs;
    s.speed = s.baseSpeed;
    s.homeX = s.x; s.homeY = s.y;
    glUltraShakeKick = Math.max(glUltraShakeKick, 0.5);
    glUltraSfxRumble(false);
    glUltraSfxExit();
}

// Dust bits at the launch point: slow, small, gone in ~2.5 s.
function glUltraSpawnDust(x, y, size) {
    for (let i = 0; i < 70; i++) {
        const a = Math.random() * Math.PI * 2;
        const r = Math.random() * size * 2.5;
        const sp = 0.08 + Math.random() * 0.9;
        glParticles.push({
            x: x + Math.cos(a) * r, y: y + Math.sin(a) * r,
            vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
            life: 0.7 + Math.random() * 0.3,
            decay: 0.28 + Math.random() * 0.2,
            size: 1.2 + Math.random() * 1.8,
            color: i % 3 ? "#9FB3C8" : "#D6ECFF"
        });
    }
}

// Once per rendered frame, from the main loop: warp level, beam fade, flash,
// jolt decay, and the audio. dt is 0 while paused.
function glUltraFrame(dt, paused) {
    glUltraClock += dt;
    const s = glShip, W = GLP.v.ultraWarpMax;
    const f = s.ultraState === "charging" ? glUltraChargeF(s) : 0;

    // Warp: 1x → W over the charge (squared, so it starts subtle and then
    // climbs), held at W in the drive, eased back to 1 after.
    if (s.ultraState === "charging") glUltraWarp = 1 + (W - 1) * f * f;
    else if (s.ultraState === "active") glUltraWarp = W;
    else if (glUltraWarp > 1) {
        glUltraWarp = 1 + (glUltraWarp - 1) * Math.exp(-dt * 2.5);
        if (glUltraWarp < 1.01) glUltraWarp = 1;
    }

    if (s.ultraState === "active") glUltraBeam.alpha = 1;
    else if (glUltraBeam.alpha > 0) {
        glUltraBeam.alpha -= dt / 2.5;
        if (glUltraBeam.alpha <= 0) { glUltraBeam.alpha = 0; glUltraBeam.pts.length = 0; }
    }
    if (glUltraFlash.t >= 0) {
        glUltraFlash.t += dt;
        if (glUltraFlash.t > 1.4) glUltraFlash.t = -1;
    }
    glUltraShakeKick *= Math.exp(-dt * 2.5);

    const A = glUltraAudio;
    if (A.ctx) {
        // (Pause/resume of the shared context is gl-audio.js's since 2026-09-12.)
        A.master.gain.setTargetAtTime(GLP.v.ultraVolume, A.ctx.currentTime, 0.05);
        if (s.ultraState === "charging") glUltraSfxChargeLevel(f);
        if (s.ultraState === "active") glUltraSfxRumbleLevel(glUltraRamp(s));
    }
}

// ===================================================
//                  DRAW
// ===================================================
// In the ship's LOCAL frame (glDrawShips has translated, scaled by zoom and
// rotated), so x is forward and one unit is one world unit. Under the hull.
function glDrawUltraShip(c, s) {
    const S = s.size, px = 1 / Math.max(glCamera.zoom, 1e-6);   // one screen pixel, in world units
    const charging = s.ultraState === "charging";
    const f = charging ? glUltraChargeF(s) : 1;
    const t = glUltraClock;
    c.save();
    c.globalCompositeOperation = "lighter";
    c.lineCap = "round";
    c.lineJoin = "round";

    if (charging) {
        // ∞: lemniscate of Bernoulli, 10× the hull's width (hull width is
        // 1.2·size), lying across the ship's axis, centred behind it.
        const a = S * 1.2 * 10 / 2, cx = -S * 4;
        const pt = function (u) {
            const sn = Math.sin(u), cs = Math.cos(u), d = 1 + sn * sn;
            return [cx + a * sn * cs / d, a * cs / d];
        };
        // The whole figure: faint at the start, bright at full charge.
        c.strokeStyle = "rgba(125,249,255," + (0.06 + 0.4 * f) + ")";
        c.lineWidth = Math.max(1.2, 1.4 * px);
        c.beginPath();
        for (let i = 0; i <= 96; i++) {
            const q = pt(i / 96 * Math.PI * 2);
            if (i) c.lineTo(q[0], q[1]); else c.moveTo(q[0], q[1]);
        }
        c.stroke();
        // The tracer: a head running the figure — faster as the charge builds
        // — with a fading tail, and a glow that grows with the charge. The glow
        // is a wide faint pass under the bright core, NOT shadowBlur: that is a
        // Gaussian blur per stroke, and 36 strokes a frame of it was the bulk of
        // the world pass while charging (see gyro-lab/CLAUDE.md).
        const head = t * (1.5 + 9 * f), N = 36, span = 2.2;
        for (let pass = 0; pass < 2; pass++) {
            for (let i = 0; i < N; i++) {
                const q0 = pt(head - span * (i + 1) / N), q1 = pt(head - span * i / N), k = 1 - i / N;
                const w = Math.max(1.5, 2.2 * px) * (0.6 + 1.4 * f) * (0.4 + 0.6 * k);
                const a = k * (0.3 + 0.7 * f);
                c.strokeStyle = pass
                    ? "rgba(" + Math.round(125 + 130 * f) + ",249,255," + a + ")"
                    : "rgba(125,249,255," + (a * 0.22) + ")";
                c.lineWidth = pass ? w : w * (3 + 4 * f);
                c.beginPath();
                c.moveTo(q0[0], q0[1]);
                c.lineTo(q1[0], q1[1]);
                c.stroke();
            }
        }
    }

    // The sphere right behind the hull: grows and brightens with the charge,
    // burns steady and bigger while the drive is lit.
    const pulse = 1 + 0.08 * Math.sin(t * (charging ? 6 + 20 * f : 30));
    const r = S * (charging ? 0.25 + 0.95 * f : 1.4) * pulse;
    const sx = -S * 1.1;
    const g = c.createRadialGradient(sx, 0, 0, sx, 0, r * 2.2);
    g.addColorStop(0, "rgba(255,255,255," + (0.5 + 0.5 * f) + ")");
    g.addColorStop(0.35, "rgba(160,220,255," + (0.35 + 0.5 * f) + ")");
    g.addColorStop(1, "rgba(60,140,255,0)");
    c.fillStyle = g;
    c.beginPath();
    c.arc(sx, 0, r * 2.2, 0, Math.PI * 2);
    c.fill();
    c.restore();
}

// Liang–Barsky: the part of a segment inside the box, or null. At peak speed
// the beam's older points are millions of pixels off-screen, and handing those
// to the canvas as-is invites precision trouble.
function glUltraClip(ax, ay, bx, by, x0, y0, x1, y1) {
    let t0 = 0, t1 = 1;
    const dx = bx - ax, dy = by - ay;
    const p = [-dx, dx, -dy, dy], q = [ax - x0, x1 - ax, ay - y0, y1 - ay];
    for (let i = 0; i < 4; i++) {
        if (p[i] === 0) { if (q[i] < 0) return null; continue; }
        const r = q[i] / p[i];
        if (p[i] < 0) { if (r > t1) return null; if (r > t0) t0 = r; }
        else { if (r < t0) return null; if (r < t1) t1 = r; }
    }
    return [ax + dx * t0, ay + dy * t0, ax + dx * t1, ay + dy * t1];
}

// The beam and the launch shockwave, into the buffer behind the ships, in the
// RAW projection (ships are exempt from the vector lens; the beam must agree
// with the hull it leaves from). Constant screen width: it is meant to read
// as massive at any zoom.
function glDrawUltraBeam(c) {
    const B = glUltraBeam;
    if (B.alpha > 0 && B.pts.length >= 4) {
        const P = B.pts, m = 160;
        const pulse = 1 + 0.12 * Math.sin(glUltraClock * 23) + 0.06 * Math.sin(glUltraClock * 57);
        const pts = [];
        for (let i = 0; i < P.length; i += 2) pts.push(glWorldToScreenRaw(P[i], P[i + 1]));
        // The newest point is pulled back to the ship's tail, so the beam leaves
        // FROM the ship instead of swallowing it.
        if (glShip.ultraState === "active") {
            const tail = glShip.size * glCamera.zoom * 1.3 + 8, e = pts[pts.length - 1];
            pts[pts.length - 1] = { x: e.x - Math.cos(glShip.angle) * tail, y: e.y - Math.sin(glShip.angle) * tail };
        }
        const layers = [[120, "40,110,255", 0.10], [72, "60,150,255", 0.20], [40, "110,195,255", 0.42], [16, "225,245,255", 0.9]];
        c.save();
        c.globalCompositeOperation = "lighter";
        c.lineCap = "round";
        c.lineJoin = "round";
        for (let j = 0; j < layers.length; j++) {
            c.lineWidth = layers[j][0] * pulse;
            c.strokeStyle = "rgba(" + layers[j][1] + "," + (layers[j][2] * B.alpha) + ")";
            c.beginPath();
            for (let i = 1; i < pts.length; i++) {
                const seg = glUltraClip(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y, -m, -m, glW + m, glH + m);
                if (!seg) continue;
                c.moveTo(seg[0], seg[1]);
                c.lineTo(seg[2], seg[3]);
            }
            c.stroke();
        }
        c.restore();
    }
    if (glUltraFlash.t >= 0) {
        const k = glUltraFlash.t / 1.4, p = glWorldToScreenRaw(glUltraFlash.x, glUltraFlash.y);
        c.save();
        c.globalCompositeOperation = "lighter";
        c.strokeStyle = "rgba(150,210,255," + (0.8 * (1 - k)) + ")";
        c.lineWidth = 10 * (1 - k) + 1;
        c.beginPath();
        c.arc(p.x, p.y, 20 + k * 520, 0, Math.PI * 2);
        c.stroke();
        c.restore();
    }
}

// The sky while warping: every star a streak along the direction of flight,
// its length the star's size × the warp. Replaces glDrawStars /
// glDrawLensedStars for as long as the warp lasts. Two batched paths (thin
// and thick stars) — 6,000 separate strokes would be the whole frame.
function glDrawWarpStars(c) {
    const W = glUltraWarp, k = 1.3 * W;
    const ux = Math.cos(glShip.angle), uy = Math.sin(glShip.angle);
    const hot = Math.min(1, (W - 1) / 30);   // tints toward blue-white as it builds
    c.save();
    c.lineCap = "round";
    for (let pass = 0; pass < 2; pass++) {
        c.beginPath();
        for (let i = 0; i < GL_STAR_COUNT; i++) {
            const star = glStars[i];
            if ((star.size >= 1.2) !== (pass === 1)) continue;
            const sx = glCX + glStarWrap(star.x - glStarOff.x);
            const sy = glCY + glStarWrap(star.y - glStarOff.y);
            const L = star.size * k * 0.5;
            if (sx < -L || sy < -L || sx > glW + L || sy > glH + L) continue;
            c.moveTo(sx - ux * L, sy - uy * L);
            c.lineTo(sx + ux * L, sy + uy * L);
        }
        c.lineWidth = pass ? 1.6 : 0.9;
        c.strokeStyle = "rgba(" + Math.round(143 + 60 * hot) + "," + Math.round(168 + 60 * hot) + "," +
            Math.round(156 + 99 * hot) + "," + (0.75 + 0.25 * hot) + ")";
        c.stroke();
    }
    c.restore();
}

// Screen rumble: a CSS translate on the canvas, applied after the frame is
// drawn — it never touches the lens maths, the HUD or the panel.
function glUltraApplyShake() {
    const s = glShip, base = GLP.v.ultraShake;
    let amp = glUltraShakeKick * base * 3;
    if (s.ultraState === "active") amp += base * (0.6 + 0.4 * glUltraRamp(s));
    else if (s.ultraState === "charging") {
        const f = glUltraChargeF(s);
        if (f > 0.7) amp += base * 0.5 * (f - 0.7) / 0.3;   // the last 30% of the charge shudders
    }
    if (glPaused) amp = 0;
    if (amp > 0.05) {
        const t = glUltraClock;
        const dx = amp * (0.6 * Math.sin(t * 71) + 0.4 * (Math.random() * 2 - 1));
        const dy = amp * (0.6 * Math.sin(t * 53 + 1.3) + 0.4 * (Math.random() * 2 - 1));
        glCanvas.style.transform = "translate(" + dx.toFixed(1) + "px," + dy.toFixed(1) + "px)";
        glUltraShaking = true;
    } else if (glUltraShaking) {
        glCanvas.style.transform = "";
        glUltraShaking = false;
    }
}

function glUltraFmtTime(sec) {
    const m = Math.floor(sec / 60), r = Math.floor(sec % 60);
    return m + ":" + (r < 10 ? "0" : "") + r;
}

function glUltraHudLine() {
    const s = glShip;
    if (s.ultraState === "active") {
        const lys = glUltraSpeedLyS(s);
        const left = Math.max(0, GLP.v.ultraRampTime - s.ultraT);
        return "<span style='color:#6FB8FF'><b style='color:#9FD8FF'>ULTRADRIVE</b> " + lys.toFixed(2) +
            " ly/s (" + (lys * 3.156e7 / 1e6).toFixed(0) + "M c) &nbsp; " +
            (left > 0 ? "peak in " + glUltraFmtTime(left) : "at peak") + " &nbsp; U drops out</span>";
    }
    if (s.ultraState === "charging") {
        return "<span style='color:#7DF9FF'>ULTRADRIVE charging " + s.ultraCharge.toFixed(1) + " / " +
            GLP.v.ultraChargeTime + "s &nbsp; U aborts</span>";
    }
    if (glUltraMsg && glUltraClock - glUltraMsgT < 4) return "<span style='color:#FF2E88'>" + glUltraMsg + "</span>";
    return glMode === "q" ? "ultradrive ready (U)" : "ultradrive: Q mode, solo only";
}

// ===================================================
//                  AUDIO (WebAudio, synthesised)
// ===================================================
const glUltraAudio = { ctx: null, master: null, white: null, brown: null, charge: null, rumble: null, pausedByUs: false };

// The ultradrive's own gain on the SHARED context (2026-09-12: gl-audio.js owns
// the one AudioContext, its noise buffers, and pause/resume). No context →
// silent, nothing breaks.
function glUltraAudioCtx() {
    const A = glUltraAudio;
    if (A.ctx) return A.ctx;
    const ctx = glAudioCtx();
    if (!ctx) return null;
    A.master = ctx.createGain();
    A.master.gain.value = GLP.v.ultraVolume;
    A.master.connect(glAudio.master);
    A.white = glAudio.white;
    A.brown = glAudio.brown;
    A.ctx = ctx;
    return ctx;
}

function glUltraNoise(ctx, buf, loop) {
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = !!loop;
    return src;
}

// Charge hum: a sawtooth + sine pair through a lowpass, with a tremolo. Pitch,
// filter, tremolo rate and level all climb with the charge (glUltraSfxChargeLevel).
function glUltraSfxChargeStart() {
    const ctx = glUltraAudioCtx();
    if (!ctx) return;
    if (ctx.state === "suspended" && !glPaused) ctx.resume();
    glUltraSfxChargeStop();
    const A = glUltraAudio, t = ctx.currentTime;
    const o1 = ctx.createOscillator(), o2 = ctx.createOscillator(), lfo = ctx.createOscillator();
    o1.type = "sawtooth"; o1.frequency.value = 55;
    o2.type = "sine"; o2.frequency.value = 110;
    lfo.type = "sine"; lfo.frequency.value = 2;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 220; lp.Q.value = 5;
    const trem = ctx.createGain(), depth = ctx.createGain(), out = ctx.createGain();
    trem.gain.value = 0.7;
    depth.gain.value = 0.3;
    out.gain.value = 0;
    lfo.connect(depth); depth.connect(trem.gain);
    o1.connect(lp); o2.connect(lp); lp.connect(trem); trem.connect(out); out.connect(A.master);
    out.gain.setTargetAtTime(0.1, t, 0.15);
    o1.start(t); o2.start(t); lfo.start(t);
    A.charge = { o1: o1, o2: o2, lfo: lfo, lp: lp, out: out };
}

function glUltraSfxChargeLevel(f) {
    const A = glUltraAudio, v = A.charge;
    if (!v) return;
    const t = A.ctx.currentTime, e = f * f;
    v.o1.frequency.setTargetAtTime(55 + 385 * e, t, 0.1);
    v.o2.frequency.setTargetAtTime(110 + 770 * e, t, 0.1);
    v.lp.frequency.setTargetAtTime(220 + 5200 * f, t, 0.1);
    v.lfo.frequency.setTargetAtTime(2 + 16 * f, t, 0.1);
    v.out.gain.setTargetAtTime(0.1 + 0.25 * f, t, 0.1);
}

function glUltraSfxChargeStop() {
    const A = glUltraAudio, v = A.charge;
    if (!v) return;
    A.charge = null;
    const t = A.ctx.currentTime;
    v.out.gain.cancelScheduledValues(t);
    v.out.gain.setTargetAtTime(0, t, 0.05);
    [v.o1, v.o2, v.lfo].forEach(function (o) { o.stop(t + 0.4); });
}

function glUltraSfxTick(final) {
    const A = glUltraAudio, ctx = A.ctx;
    if (!ctx) return;
    const t = ctx.currentTime, o = ctx.createOscillator(), g = ctx.createGain();
    o.type = "sine";
    o.frequency.value = final ? 1320 : 880;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(final ? 0.35 : 0.22, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    o.connect(g); g.connect(A.master);
    o.start(t); o.stop(t + 0.15);
}

// Launch: a noise burst with a falling lowpass, under a sub-bass drop.
function glUltraSfxLaunch() {
    const A = glUltraAudio, ctx = A.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = glUltraNoise(ctx, A.white), lp = ctx.createBiquadFilter(), g = ctx.createGain();
    lp.type = "lowpass";
    lp.frequency.setValueAtTime(5000, t);
    lp.frequency.exponentialRampToValueAtTime(60, t + 1.8);
    g.gain.setValueAtTime(0.9, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 2.2);
    n.connect(lp); lp.connect(g); g.connect(A.master);
    n.start(t); n.stop(t + 2.3);
    const o = ctx.createOscillator(), og = ctx.createGain();
    o.type = "sine";
    o.frequency.setValueAtTime(170, t);
    o.frequency.exponentialRampToValueAtTime(28, t + 1.4);
    og.gain.setValueAtTime(0.8, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 1.8);
    o.connect(og); og.connect(A.master);
    o.start(t); o.stop(t + 1.9);
}

// Drive rumble: looped brown noise through a lowpass plus a sub sine. Fades in
// on launch, out on drop-out; builds with the speed ramp.
function glUltraSfxRumble(on) {
    const A = glUltraAudio, ctx = A.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    if (A.rumble) {
        const r = A.rumble;
        A.rumble = null;
        r.out.gain.cancelScheduledValues(t);
        r.out.gain.setTargetAtTime(0, t, 0.3);
        r.n.stop(t + 1.5);
        r.o.stop(t + 1.5);
    }
    if (!on) return;
    const n = glUltraNoise(ctx, A.brown, true), lp = ctx.createBiquadFilter();
    const o = ctx.createOscillator(), og = ctx.createGain(), out = ctx.createGain();
    lp.type = "lowpass"; lp.frequency.value = 140;
    o.type = "sine"; o.frequency.value = 36;
    og.gain.value = 0.35;
    out.gain.value = 0;
    out.gain.setTargetAtTime(0.6, t, 0.4);
    n.connect(lp); lp.connect(out); o.connect(og); og.connect(out); out.connect(A.master);
    n.start(t); o.start(t);
    A.rumble = { n: n, o: o, lp: lp, out: out };
}

function glUltraSfxRumbleLevel(f) {
    const A = glUltraAudio, r = A.rumble;
    if (!r) return;
    const t = A.ctx.currentTime;
    r.out.gain.setTargetAtTime(0.5 + 0.4 * f, t, 0.3);
    r.lp.frequency.setTargetAtTime(140 + 160 * f, t, 0.3);
    r.o.frequency.setTargetAtTime(36 + 14 * f, t, 0.3);
}

// Drop-out: a short falling band-passed whoosh.
function glUltraSfxExit() {
    const A = glUltraAudio, ctx = A.ctx;
    if (!ctx) return;
    const t = ctx.currentTime;
    const n = glUltraNoise(ctx, A.white), bp = ctx.createBiquadFilter(), g = ctx.createGain();
    bp.type = "bandpass";
    bp.Q.value = 2;
    bp.frequency.setValueAtTime(2400, t);
    bp.frequency.exponentialRampToValueAtTime(180, t + 0.7);
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.8);
    n.connect(bp); bp.connect(g); g.connect(A.master);
    n.start(t); n.stop(t + 0.85);
}
