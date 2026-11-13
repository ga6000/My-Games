// ===================================================
//   Gyro Fleet — flight: thrust, jump drive, auto-brake, strafe
// ===================================================
// Flight pass (2026-11-13, GYRO_FLEET_FLIGHT_PLAN.md). Replaces the flown
// ship's gears (Q mode only; E-mode formations keep Shift+wheel for now).
//
//   RIGHT MOUSE (hold)  thrust toward the cursor. Let go: the ship eases back
//                       to a slow cruise. It never stops dead, and it doesn't
//                       drift (the engine's velocity lerp does that).
//   SPACE (hold)        jump drive. 2 s spool (still steerable, aim line
//                       shown), then a burst at ~1000x cruise along the
//                       heading the spool ended on. No turning during the
//                       burst. Let go to drop out early.
//   auto-brake          the burst drops out by itself on reaching the edge of
//                       a fight (hive or pod) that lies ahead, so it can't
//                       overshoot. Targets you jumped FROM are ignored.
//   SHIFT (hold)        strafe: the ship holds its current line; the gun
//                       follows the cursor. Combine with thrust for a pass.
//   LEFT MOUSE          fire (toward the cursor; shots carry the ship's speed).
//
// The engine's glHyperGear is kept as a MIRROR of the drive state (0 cruise,
// 1 thrust, 3 burst) so the engine sound and the gear-shift cue still work.
"use strict";

const GF_FLIGHT = {
    cruiseMul: 1,       // released: slow cruise (10 u/s; airkrill do 19)
    thrustMul: 4,       // right mouse held (40 u/s)
    spoolTime: 2,       // seconds of spool before the burst
    burstMul: 1000,     // burst speed (10,000 u/s: home to hive in ~3 s)
    brakeR: 250,        // auto-brake: drop out this far outside a fight (pod aggro is 900)
    dropFlash: 0.5      // seconds the DROP OUT cue shows
};

const gfFlight = {
    thrust: false,
    strafe: false, strafeA: 0,
    jump: "idle",       // idle | spool | burst
    spoolT: 0, heading: 0,
    ignore: [],         // fight centres within brakeR when the burst began
    dropT: 0, dropMsg: ""
};

function gfFlightReset() {
    gfFlight.thrust = false;
    gfFlight.strafe = false;
    gfFlight.jump = "idle";
    gfFlight.spoolT = 0;
    gfFlight.ignore = [];
    gfFlightMirrorGear();
}

// Fight centres auto-brake can stop at: the hive and every pod's Bellwether
// (or first member). Each with the radius the brake adds to brakeR.
function gfFightCentres() {
    const out = [];
    if (gfHive) out.push({ x: gfHive.x, y: gfHive.y, r: gfHive.r, name: "HIVE" });
    for (let i = 0; i < gfPods.length; i++) {
        const lead = gfPods[i].bell || gfPods[i].members[0];
        if (lead) out.push({ x: lead.x, y: lead.y, r: 0, name: "POD", pod: gfPods[i] });
    }
    return out;
}

function gfFlightMirrorGear() {
    const g = gfFlight.jump === "burst" ? 3 : (gfFlight.thrust ? 1 : 0);
    if (g !== glHyperGear) { glAudioGear(glHyperGear, g); glHyperGear = g; }
}

// ---- input (called from gl-boot.js, Q mode only) ----
function gfJumpPress() {
    const s = glShip;
    if (!s.isAlive || gfFlight.jump !== "idle") return;
    gfFlight.jump = "spool";
    gfFlight.spoolT = 0;
}
function gfJumpRelease() {
    if (gfFlight.jump === "spool") { gfFlight.jump = "idle"; gfFlight.spoolT = 0; }
    else if (gfFlight.jump === "burst") gfDropOut("DROP OUT");
}
function gfStrafeSet(on) {
    if (on && !gfFlight.strafe) gfFlight.strafeA = glShip.angle;
    gfFlight.strafe = on;
}
function gfThrustSet(on) { gfFlight.thrust = on; gfFlightMirrorGear(); }

// Fire toward the cursor; the shot carries the ship's velocity, or the ship
// would outrun its own bullets under thrust.
function gfFire() {
    const s = glShip;
    if (!s.isAlive || gfFlight.jump === "burst") return;
    const a = Math.atan2(glMouse.y - glCY, glMouse.x - glCX);
    const n = glBullets.length;
    glFire(s.x, s.y, a);
    if (glBullets.length > n) {
        const b = glBullets[glBullets.length - 1];
        b.vx += s.vx; b.vy += s.vy;
    }
}

function gfDropOut(msg) {
    const s = glShip;
    gfFlight.jump = "idle";
    gfFlight.spoolT = 0;
    gfFlight.ignore = [];
    // Kill the burst velocity outright: the engine's lerp would carry the ship
    // a few hundred units on, which is the overshoot auto-brake exists to stop.
    const v = s.baseSpeed * GF_FLIGHT.cruiseMul;
    s.vx = Math.cos(s.angle) * v; s.vy = Math.sin(s.angle) * v;
    gfFlight.dropT = GF_FLIGHT.dropFlash;
    gfFlight.dropMsg = msg;
    gfFlightMirrorGear();
}

// ---- per-frame, from glUpdateShipOne (gl-sim.js) for the flown ship ----
// Returns the heading the ship wants, or null to let the mouse steer.
function gfFlightHeading(s) {
    if (gfFlight.jump === "burst") return gfFlight.heading;
    if (gfFlight.strafe) return gfFlight.strafeA;
    return null;
}

// Returns the speed multiplier for the flown ship this frame.
function gfFlightSpeedMul(s, dt) {
    if (!s.isAlive) return GF_FLIGHT.cruiseMul;
    gfFlight.dropT = Math.max(0, gfFlight.dropT - dt);

    if (gfFlight.jump === "spool") {
        gfFlight.spoolT += dt;
        if (gfFlight.spoolT >= GF_FLIGHT.spoolTime) {
            gfFlight.jump = "burst";
            gfFlight.heading = s.angle;
            gfFlight.strafe = false;
            // Ignore fights we are already in or beside: jumping OUT of a pod
            // must not brake on the pod.
            gfFlight.ignore = gfFightCentres().filter(function (f) {
                return Math.hypot(f.x - s.x, f.y - s.y) < GF_FLIGHT.brakeR + f.r + 200;
            }).map(function (f) { return f.pod || f.name; });
            gfFlightMirrorGear();
        }
    }
    if (gfFlight.jump === "burst") {
        // Auto-brake: look one frame ahead along the burst heading.
        const step = s.baseSpeed * GF_FLIGHT.burstMul * 1.5;
        const ux = Math.cos(gfFlight.heading), uy = Math.sin(gfFlight.heading);
        const fights = gfFightCentres();
        for (let i = 0; i < fights.length; i++) {
            const f = fights[i];
            if (gfFlight.ignore.indexOf(f.pod || f.name) !== -1) continue;
            const dx = f.x - s.x, dy = f.y - s.y;
            const along = dx * ux + dy * uy;
            if (along < 0) continue;   // behind us
            // Closest approach within this frame's travel.
            const t = Math.min(along, step);
            const cx = s.x + ux * t, cy = s.y + uy * t;
            if (Math.hypot(f.x - cx, f.y - cy) < GF_FLIGHT.brakeR + f.r) {
                // Stop on the brake ring, facing the fight.
                const d = Math.hypot(dx, dy);
                if (d > GF_FLIGHT.brakeR + f.r) {
                    const back = GF_FLIGHT.brakeR + f.r;
                    const k = Math.max(0, along - Math.sqrt(Math.max(0, back * back - (d * d - along * along))));
                    s.x += ux * k; s.y += uy * k;
                }
                s.angle = Math.atan2(f.y - s.y, f.x - s.x);
                gfDropOut("DROPPING OUT · " + f.name);
                return GF_FLIGHT.cruiseMul;
            }
        }
        return GF_FLIGHT.burstMul;
    }
    return gfFlight.thrust ? GF_FLIGHT.thrustMul : GF_FLIGHT.cruiseMul;
}

// ---- drawing (from gfDrawOverlay) ----
function gfFlightOverlay(c) {
    const s = glShip;
    if (!s.isAlive || glMode !== "q") return;
    const p = glWorldToScreenRaw(s.x, s.y);
    c.save();
    if (gfFlight.jump === "spool") {
        // Aim line: where the burst will go. Brightens as the spool fills.
        const k = Math.min(1, gfFlight.spoolT / GF_FLIGHT.spoolTime);
        const ux = Math.cos(s.angle), uy = Math.sin(s.angle);
        const L = Math.max(glW, glH);
        c.strokeStyle = "rgba(125,249,255," + (0.15 + 0.6 * k).toFixed(3) + ")";
        c.lineWidth = 1 + 2 * k;
        c.setLineDash([10, 8]);
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + ux * L, p.y + uy * L); c.stroke();
        c.setLineDash([]);
        c.strokeStyle = "#7DF9FF"; c.lineWidth = 3;
        c.beginPath(); c.arc(p.x, p.y, 26, -Math.PI / 2, -Math.PI / 2 + k * Math.PI * 2); c.stroke();
    }
    if (gfFlight.strafe && gfFlight.jump !== "burst") {
        // Strafe: the held line (amber) and the gun's line to the cursor.
        const ux = Math.cos(gfFlight.strafeA), uy = Math.sin(gfFlight.strafeA);
        c.strokeStyle = "rgba(255,176,0,0.5)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(p.x - ux * 40, p.y - uy * 40); c.lineTo(p.x + ux * 200, p.y + uy * 200); c.stroke();
        c.strokeStyle = "rgba(255,176,0,0.9)";
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(glMouse.x, glMouse.y); c.stroke();
    }
    let label = "", col = "#7DF9FF";
    if (gfFlight.jump === "spool") label = "SPOOLING " + Math.min(100, Math.round(gfFlight.spoolT / GF_FLIGHT.spoolTime * 100)) + "%";
    else if (gfFlight.jump === "burst") { label = "JUMP · RELEASE SPACE TO DROP OUT"; col = "#FFFFFF"; }
    else if (gfFlight.dropT > 0) { label = gfFlight.dropMsg; col = "#FFB000"; }
    else if (gfFlight.strafe) { label = "STRAFE"; col = "#FFB000"; }
    if (label) {
        c.font = "18px 'VT323', monospace";
        c.textAlign = "center";
        c.fillStyle = col;
        c.fillText(label, glW / 2, glH / 2 + 70);   // just under the ship: the bottom of the screen is the help bar
    }
    c.restore();
}

function gfFlightHudLine() {
    const st = gfFlight.jump === "burst" ? "JUMP" : gfFlight.jump === "spool" ? "SPOOL" : gfFlight.thrust ? "THRUST" : "CRUISE";
    return "<span style='color:" + (st === "CRUISE" ? "#cfe9e6" : "#FFB000") + "'>DRIVE " + st + "</span>" +
        " &nbsp; right mouse = thrust · hold SPACE = jump · hold SHIFT = strafe";
}
