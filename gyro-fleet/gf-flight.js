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
    moveMul: 6.2,       // WASD speed, x cruise (62 u/s; airkrill dive 24, aircrab dart 21: ~3x)
    boostMul: 10.5,     // Space held (105 u/s)
    slide: 0.13,       // velocity ease per frame: lower = more slide (~0.2 s settle; 0.035 felt floaty)
    turn: 0.35,         // hull turn toward the WASD direction per frame
    spoolDelay: 0.35,   // seconds of boost before a jump spool shows (out of combat)
    spoolTime: 2.0,     // spool after that: the ultradrive lock-on (infinity glyph, rising hum, ticks)
    burstMul: 1000,     // jump speed (10,000 u/s: home to hive in ~3 s)
    brakeR: 330,        // drop out this far outside The Tide; its brood hunts from 520 of itself
    combatR: 600,      // a creature this close = in combat: Space only boosts
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

// ---- ultradrive cues (2026-11-15) ----
// Ry: "I like the sound of locking on & jumping animation from ultradrive now
// that it's been lost... I'd like to bring it back even if spool time is 2s".
// The jump keeps its own rules (hand-aimed, no turning, auto-brake); it borrows
// gl-ultra.js's look and sound: the infinity glyph and rising hum while it
// spools, a tick every half second, the launch boom, the blue beam, warp
// streaks, the rumble, and the whoosh on drop-out.
function gfUltraCue() {
    if (gfFlight.jump === "spool") return { state: "charging", f: Math.min(1, gfFlight.spoolT / GF_FLIGHT.spoolTime) };
    if (gfFlight.jump === "burst") return { state: "active", f: 1 };
    return null;
}
function gfSpoolCancel() {
    gfFlight.jump = "idle"; gfFlight.spoolT = 0;
    glUltraSfxChargeStop();
}
function gfJumpLaunchFx(s) {
    glUltraSpawnDust(s.x, s.y, s.size);
    glUltraFlash.x = s.x; glUltraFlash.y = s.y; glUltraFlash.t = 0;
    glUltraBeam.pts.length = 0;
    glUltraBeam.pts.push(s.x, s.y);
    glUltraBeam.alpha = 1;
    glUltraShakeKick = 1;
    glUltraSfxChargeStop();
    glUltraSfxLaunch();
    glUltraSfxRumble(true);
    gfWingJumpOut();   // gf-wing.js: the wing lights its drives too
}

function gfFlightReset() {
    glUltraSfxChargeStop();
    if (gfFlight.jump === "burst") { glUltraSfxRumble(false); gfWingJumpIn(gfFlight.heading); }
    gfFlight.keys.up = gfFlight.keys.down = gfFlight.keys.left = gfFlight.keys.right = false;
    gfFlight.firing = false;
    gfFlight.space = false; gfFlight.spaceT = 0;
    gfFlight.jump = "idle"; gfFlight.spoolT = 0; gfFlight.ignore = [];
    gfFlightMirrorGear();
}

function gfFightCentres() {
    const out = [];
    // Every site still held stops a jump at its edge; a freed one you fly through.
    for (let i = 0; i < gfSites.length; i++) {
        const st = gfSites[i];
        if (!st.cleared) out.push({ x: st.x, y: st.y, r: st.r, name: st.name, key: st });
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
        if (gfFlight.jump === "spool") gfSpoolCancel();
        else if (gfFlight.jump === "burst") gfDropOut("", null);
    }
    gfFlightMirrorGear();
}
function gfFireSet(on) { gfFlight.firing = on; if (on) gfFlight.fireCd = 0; }

function gfFire() {
    const s = glShip;
    if (!s.isAlive || gfFlight.jump === "burst" || gfRoundOver()) return;
    return gfCrewFire(s, gfAimAngle(), false, null);   // gf-crew.js: this crew member's primary
}

function gfDropOut(msg, fight) {
    const s = glShip;
    if (gfFlight.jump === "burst") {
        glUltraShakeKick = Math.max(glUltraShakeKick, 0.5);
        glUltraSfxRumble(false);
        glUltraSfxExit();
        gfWingJumpIn(gfFlight.heading);   // gf-wing.js: the wing drops out behind you, one by one
    }
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
    if (gfFlight.firing && gfFlight.fireCd <= 0) gfFlight.fireCd = gfFire() || 0.1;

    // Boost held out of combat grows into a jump spool.
    if (gfFlight.space && gfFlight.jump === "idle") {
        gfFlight.spaceT += dt;
        if (!gfFlight.inCombat && gfFlight.spaceT >= GF_FLIGHT.spoolDelay) { gfFlight.jump = "spool"; gfFlight.spoolT = 0; glUltraSfxChargeStart(); }
    }
    if (gfFlight.jump === "spool") {
        if (gfFlight.inCombat) { gfSpoolCancel(); gfFlight.spaceT = 0; }
        else {
            const prevT = gfFlight.spoolT;
            gfFlight.spoolT += dt;
            // Lock-on ticks: one each half second, the last one higher.
            if (Math.floor(prevT * 2) !== Math.floor(gfFlight.spoolT * 2) && gfFlight.spoolT < GF_FLIGHT.spoolTime)
                glUltraSfxTick(GF_FLIGHT.spoolTime - gfFlight.spoolT <= 0.55);
            if (gfFlight.spoolT >= GF_FLIGHT.spoolTime) {
                gfFlight.jump = "burst";
                gfFlight.heading = gfAimAngle();   // along the aim line, wherever the hull had got to
                s.angle = gfFlight.heading;
                gfJumpLaunchFx(s);
                gfFlight.ignore = gfFightCentres().filter(function (f) {
                    return Math.hypot(f.x - s.x, f.y - s.y) < GF_FLIGHT.brakeR + f.r + 300;
                }).map(function (f) { return f.key; });
                gfFlightMirrorGear();
            }
        }
    }
    if (gfFlight.jump === "burst") {
        const step = s.baseSpeed * GF_FLIGHT.burstMul * 1.5;
        glUltraBeam.pts.push(s.x, s.y);
        if (glUltraBeam.pts.length > GL_ULTRA_BEAM_PTS * 2) glUltraBeam.pts.splice(0, 2);
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
                gfDropOut("CONTACT", f);
                return 1;
            }
        }
        return GF_FLIGHT.burstMul;
    }
    return (gfFlight.space ? GF_FLIGHT.boostMul : GF_FLIGHT.moveMul) * gfCrewSpeedMul();
}

// Target velocity and ease for the flown ship (replaces the engine's
// nose-follows-mouse thrust in Q mode). Called after gfFlightSpeedMul.
function gfFlightVelocity(s) {
    if (gfFlight.jump === "burst") {
        const v = s.baseSpeed * GF_FLIGHT.burstMul;
        return { vx: Math.cos(gfFlight.heading) * v, vy: Math.sin(gfFlight.heading) * v, a: 0.55 };
    }
    const ram = gfCrewRamVel(s);   // gf-crew.js: the butcher's dash owns the ship while it lasts
    if (ram) return ram;
    const k = gfFlight.keys;
    let mx = (k.right ? 1 : 0) - (k.left ? 1 : 0), my = (k.down ? 1 : 0) - (k.up ? 1 : 0);
    const m = Math.hypot(mx, my);
    // Boost with no keys held pushes along the nose (toward the cursor).
    if (m === 0 && gfFlight.space) { mx = Math.cos(s.angle); my = Math.sin(s.angle); }
    else if (m > 0) { mx /= m; my /= m; }
    const v = s.baseSpeed * (gfFlight.space ? GF_FLIGHT.boostMul : GF_FLIGHT.moveMul) * gfCrewSpeedMul();
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
    gfDrawShip(c, s, p);   // gf-arms.js: hull, engines, turret, seeker pips + lock
    // Velocity tick: where the slide is carrying you, about half a second out.
    const vp = Math.hypot(s.vx, s.vy) * 30 * glCamera.zoom;
    if (gfFlight.jump !== "burst" && vp > 4) {
        const a = Math.atan2(s.vy, s.vx), L = Math.min(90, vp);
        c.strokeStyle = "rgba(201,255,233,0.45)"; c.lineWidth = 1;
        c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + Math.cos(a) * L, p.y + Math.sin(a) * L); c.stroke();
    }
    let label = "", col = "#7DF9FF";
    // (No "JUMP 84%" text: the ring round the ship and the glyph say it.)
    if (gfFlight.dropT > 0) { label = gfFlight.dropMsg; col = "#FFB000"; }
    if (label) {
        c.font = "18px 'VT323', monospace";
        c.textAlign = "center";
        c.fillStyle = col;
        c.fillText(label, glCX, glH / 2 + 70);
    }
    c.restore();
}

function gfFlightHudLine() {
    const k = gfFlight.keys;
    const st = gfFlight.jump === "burst" ? "JUMP" : gfFlight.jump === "spool" ? "SPOOL" : gfFlight.space ? "BOOST" :
        (k.up || k.down || k.left || k.right) ? "MOVE" : "IDLE";
    return "<span style='color:" + (st === "IDLE" || st === "MOVE" ? "#cfe9e6" : "#FFB000") + "'>DRIVE " + st +
        (gfFlight.inCombat ? " · COMBAT" : "") + "</span> &nbsp; WASD · aim · hold click · right click seeker · SPACE";
}
