// ===================================================
//   Gyro Fleet — flight: twin-stick move, boost, jump, auto-brake, fire
// ===================================================
// Flight pass 2 (2026-11-14, GYRO_FLEET_FLIGHT_PLAN.md). Ry's 11-13 playtest
// of pass 1 (right-click thrust) found it hard to shoot while evading. Now the
// same family of controls as Zombie, but with slide:
//
//   W A S D             move (screen directions). The ship SLIDES: velocity
//                       eases toward the keys, it doesn't snap (GF_FLIGHT.slide).
//   CURSOR              aims. The ship's nose and the gun follow it.
//   LEFT MOUSE (hold)   fire, GF_FLIGHT.fireRate shots/s toward the cursor.
//                       Shots carry the ship's velocity.
//   SPACE (hold)        boost. Out of combat, keep holding: after a short
//                       wait it spools (aim line = the cursor), then JUMPS at
//                       ~1000x on the locked heading. No turning in a jump.
//                       Let go to drop out early.
//   auto-brake          a jump drops out by itself OUTSIDE a fight's reach
//                       (brakeR beyond pod hunting range), facing the fight.
//
// The engine's glHyperGear mirrors the drive (0 idle, 1 moving/boost, 3 jump)
// so the engine sound and shift cues still play.
"use strict";

const GF_FLIGHT = {
    moveMul: 3.5,       // WASD speed, x cruise (35 u/s; airkrill 19, aircrab dash 15)
    boostMul: 7,        // Space held (70 u/s)
    slide: 0.035,       // velocity ease per frame: lower = more slide (~0.5 s settle)
    turn: 0.25,         // nose turn toward the cursor per frame
    fireRate: 7,        // shots per second while the button is held
    spoolDelay: 0.35,   // seconds of boost before a jump spool shows (out of combat)
    spoolTime: 1.6,     // spool after that
    burstMul: 1000,     // jump speed (10,000 u/s: home to hive in ~3 s)
    brakeR: 1200,       // drop out this far outside a fight; pods hunt from 900
    combatR: 1000,      // a creature this close = in combat: Space only boosts
    dropFlash: 1.2      // seconds the DROP OUT cue shows
};

const gfFlight = {
    keys: { up: false, down: false, left: false, right: false },
    firing: false, fireCd: 0,
    space: false, spaceT: 0,
    jump: "idle",       // idle | spool | burst
    spoolT: 0, heading: 0,
    ignore: [],         // fights within reach when the burst began
    dropT: 0, dropMsg: "", dropFight: null,
    inCombat: false
};

const GF_MOVE_KEYS = { KeyW: "up", KeyS: "down", KeyA: "left", KeyD: "right" };

function gfFlightReset() {
    gfFlight.keys.up = gfFlight.keys.down = gfFlight.keys.left = gfFlight.keys.right = false;
    gfFlight.firing = false;
    gfFlight.space = false; gfFlight.spaceT = 0;
    gfFlight.jump = "idle"; gfFlight.spoolT = 0; gfFlight.ignore = [];
    gfFlightMirrorGear();
}

function gfFightCentres() {
    const out = [];
    if (gfHive) out.push({ x: gfHive.x, y: gfHive.y, r: gfHive.r, name: "HIVE", key: "HIVE" });
    for (let i = 0; i < gfPods.length; i++) {
        const lead = gfPods[i].bell || gfPods[i].members[0];
        if (lead) out.push({ x: lead.x, y: lead.y, r: 0, name: "POD", key: gfPods[i] });
    }
    return out;
}

function gfNearestCreatureDist(x, y) {
    let bd = Infinity;
    for (let i = 0; i < gfCreatures.length; i++) {
        const c = gfCreatures[i];
        const d = Math.hypot(c.x - x, c.y - y);
        if (d < bd) bd = d;
    }
    return bd;
}

function gfFlightMirrorGear() {
    const k = gfFlight.keys;
    const moving = k.up || k.down || k.left || k.right || gfFlight.space;
    const g = gfFlight.jump === "burst" ? 3 : (moving ? 1 : 0);
    if (g !== glHyperGear) { glAudioGear(glHyperGear, g); glHyperGear = g; }
}

// ---- input (called from gl-boot.js, Q mode only) ----
function gfMoveKey(code, down) {
    const k = GF_MOVE_KEYS[code];
    if (!k) return false;
    gfFlight.keys[k] = down;
    gfFlightMirrorGear();
    return true;
}
function gfSpaceSet(down) {
    if (down && !gfFlight.space) { gfFlight.space = true; gfFlight.spaceT = 0; }
    else if (!down && gfFlight.space) {
        gfFlight.space = false;
        if (gfFlight.jump === "spool") { gfFlight.jump = "idle"; gfFlight.spoolT = 0; }
        else if (gfFlight.jump === "burst") gfDropOut("DROP OUT", null);
    }
    gfFlightMirrorGear();
}
function gfFireSet(on) { gfFlight.firing = on; if (on) gfFlight.fireCd = 0; }

function gfFire() {
    const s = glShip;
    if (!s.isAlive || gfFlight.jump === "burst") return;
    const a = gfAimAngle();
    const n = glBullets.length;
    glFire(s.x, s.y, a);
    if (glBullets.length > n) {
        const b = glBullets[glBullets.length - 1];
        b.vx += s.vx; b.vy += s.vy;
    }
}

function gfDropOut(msg, fight) {
    const s = glShip;
    gfFlight.jump = "idle";
    gfFlight.spoolT = 0;
    gfFlight.spaceT = 0;
    gfFlight.ignore = [];
    // Arrive almost still: the burst velocity is the overshoot auto-brake
    // exists to stop, and a still arrival is the beat to look around.
    s.vx = Math.cos(s.angle) * s.baseSpeed; s.vy = Math.sin(s.angle) * s.baseSpeed;
    gfFlight.dropT = GF_FLIGHT.dropFlash;
    gfFlight.dropMsg = msg;
    gfFlight.dropFight = fight;
    if (typeof gfViewOnDropOut === "function") gfViewOnDropOut(fight);
    gfFlightMirrorGear();
}

// ---- per-frame, from glUpdateShipOne (gl-sim.js), flown ship only ----
// The hull faces where you're steering (WASD); the turret tracks the cursor.
// While spooling a jump the hull swings to the aim line (the cursor).
function gfFlightHeading(s) {
    if (gfFlight.jump === "burst") return gfFlight.heading;
    if (gfFlight.jump === "spool") return gfAimAngle();
    const k = gfFlight.keys;
    const mx = (k.right ? 1 : 0) - (k.left ? 1 : 0), my = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    if (mx || my) return Math.atan2(my, mx);
    return s.angle;   // no keys: keep the last heading
}
function gfAimAngle() { return Math.atan2(glMouse.y - glCY, glMouse.x - glCX); }

// State machine: fire, boost -> spool -> burst, auto-brake. Returns the
// engine speed multiplier (kept so the engine's own speed bookkeeping is sane).
function gfFlightSpeedMul(s, dt) {
    if (!s.isAlive) return 1;
    gfFlight.dropT = Math.max(0, gfFlight.dropT - dt);
    gfFlight.inCombat = gfNearestCreatureDist(s.x, s.y) < GF_FLIGHT.combatR;

    // Hold to fire.
    gfFlight.fireCd -= dt;
    if (gfFlight.firing && gfFlight.fireCd <= 0) { gfFire(); gfFlight.fireCd = 1 / GF_FLIGHT.fireRate; }

    // Boost held out of combat grows into a jump spool.
    if (gfFlight.space && gfFlight.jump === "idle") {
        gfFlight.spaceT += dt;
        if (!gfFlight.inCombat && gfFlight.spaceT >= GF_FLIGHT.spoolDelay) { gfFlight.jump = "spool"; gfFlight.spoolT = 0; }
    }
    if (gfFlight.jump === "spool") {
        if (gfFlight.inCombat) { gfFlight.jump = "idle"; gfFlight.spoolT = 0; gfFlight.spaceT = 0; }
        else {
            gfFlight.spoolT += dt;
            if (gfFlight.spoolT >= GF_FLIGHT.spoolTime) {
                gfFlight.jump = "burst";
                gfFlight.heading = gfAimAngle();   // along the aim line, wherever the hull had got to
                s.angle = gfFlight.heading;
                gfFlight.ignore = gfFightCentres().filter(function (f) {
                    return Math.hypot(f.x - s.x, f.y - s.y) < GF_FLIGHT.brakeR + f.r + 300;
                }).map(function (f) { return f.key; });
                gfFlightMirrorGear();
            }
        }
    }
    if (gfFlight.jump === "burst") {
        const step = s.baseSpeed * GF_FLIGHT.burstMul * 1.5;
        const ux = Math.cos(gfFlight.heading), uy = Math.sin(gfFlight.heading);
        const fights = gfFightCentres();
        for (let i = 0; i < fights.length; i++) {
            const f = fights[i];
            if (gfFlight.ignore.indexOf(f.key) !== -1) continue;
            const dx = f.x - s.x, dy = f.y - s.y;
            const along = dx * ux + dy * uy;
            if (along < 0) continue;
            const t = Math.min(along, step);
            const ring = GF_FLIGHT.brakeR + f.r;
            if (Math.hypot(f.x - (s.x + ux * t), f.y - (s.y + uy * t)) < ring) {
                const d = Math.hypot(dx, dy);
                if (d > ring) {
                    const perp2 = Math.max(0, d * d - along * along);
                    const k = Math.max(0, along - Math.sqrt(Math.max(0, ring * ring - perp2)));
                    s.x += ux * k; s.y += uy * k;
                }
                s.angle = Math.atan2(f.y - s.y, f.x - s.x);
                gfDropOut("DROPPING OUT · " + f.name, f);
                return 1;
            }
        }
        return GF_FLIGHT.burstMul;
    }
    return gfFlight.space ? GF_FLIGHT.boostMul : GF_FLIGHT.moveMul;
}

// Target velocity and ease for the flown ship (replaces the engine's
// nose-follows-mouse thrust in Q mode). Called after gfFlightSpeedMul.
function gfFlightVelocity(s) {
    if (gfFlight.jump === "burst") {
        const v = s.baseSpeed * GF_FLIGHT.burstMul;
        return { vx: Math.cos(gfFlight.heading) * v, vy: Math.sin(gfFlight.heading) * v, a: 0.55 };
    }
    const k = gfFlight.keys;
    let mx = (k.right ? 1 : 0) - (k.left ? 1 : 0), my = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    const m = Math.hypot(mx, my);
    // Boost with no keys held pushes along the nose (toward the cursor).
    if (m === 0 && gfFlight.space) { mx = Math.cos(s.angle); my = Math.sin(s.angle); }
    else if (m > 0) { mx /= m; my /= m; }
    const v = s.baseSpeed * (gfFlight.space ? GF_FLIGHT.boostMul : GF_FLIGHT.moveMul);
    return { vx: mx * v, vy: my * v, a: GF_FLIGHT.slide };
}

// ---- drawing (from gfDrawOverlay) ----
function gfFlightOverlay(c) {
    const s = glShip;
    if (!s.isAlive || glMode !== "q") return;
    const p = glWorldToScreenRaw(s.x, s.y);
    c.save();
    if (gfFlight.jump === "spool") {
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
    // Turret: a blaster on the hull, locked to the cursor.
    if (gfFlight.jump !== "burst") {
        const ta = gfAimAngle(), L = 11;
        c.strokeStyle = "#FFB000"; c.lineWidth = 3; c.lineCap = "round";
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + Math.cos(ta) * L, p.y + Math.sin(ta) * L); c.stroke();
        c.fillStyle = "#FFB000"; c.beginPath(); c.arc(p.x, p.y, 3, 0, Math.PI * 2); c.fill();
        c.lineCap = "butt";
    }
    // Velocity tick: where the slide is carrying you, about half a second out.
    const vp = Math.hypot(s.vx, s.vy) * 30 * glCamera.zoom;
    if (gfFlight.jump !== "burst" && vp > 4) {
        const a = Math.atan2(s.vy, s.vx), L = Math.min(90, vp);
        c.strokeStyle = "rgba(201,255,233,0.45)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + Math.cos(a) * L, p.y + Math.sin(a) * L); c.stroke();
    }
    let label = "", col = "#7DF9FF";
    if (gfFlight.jump === "spool") label = "JUMP " + Math.min(100, Math.round(gfFlight.spoolT / GF_FLIGHT.spoolTime * 100)) + "%";
    else if (gfFlight.jump === "burst") { label = "JUMP"; col = "#FFFFFF"; }
    else if (gfFlight.dropT > 0) { label = gfFlight.dropMsg; col = "#FFB000"; }
    if (label) {
        c.font = "18px 'VT323', monospace";
        c.textAlign = "center";
        c.fillStyle = col;
        c.fillText(label, glW / 2, glH / 2 + 70);
    }
    c.restore();
}

function gfFlightHudLine() {
    const k = gfFlight.keys;
    const st = gfFlight.jump === "burst" ? "JUMP" : gfFlight.jump === "spool" ? "SPOOL" : gfFlight.space ? "BOOST" :
        (k.up || k.down || k.left || k.right) ? "MOVE" : "IDLE";
    return "<span style='color:" + (st === "IDLE" || st === "MOVE" ? "#cfe9e6" : "#FFB000") + "'>DRIVE " + st +
        (gfFlight.inCombat ? " · COMBAT" : "") + "</span> &nbsp; WASD · aim · hold click · SPACE";
}
