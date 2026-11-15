// ===================================================
//   Gyro Fleet — the wing, the siphon capacitor, the HUD
// ===================================================
// Flood pass (2026-11-15). Ry: "the siphon currency is not clear. It needs to
// be more temporary, like a capacitor-type currency, rather than something
// that can be built up significantly", and "the fleet-ordering aspect is not
// clear or operational, but it should be and it should be balanced".
//
//   SIPHON CAPACITOR   Clean kills (vent or deflated body, never a rupture)
//                      drop siphon motes; fly near and they come to you. The
//                      capacitor holds 100 and LEAKS: a few seconds after the
//                      last mote it drains away. Spend it or lose it.
//                        R  call one bot from the mothership (34 charge)
//                        G  dump whatever is left into a hull mend
//   THE WING           Up to GF_WING.max bots fly with you. One key, two orders:
//                        F  FOLLOW  tight formation; they only fire at what
//                                   they can wound, so they never set off a
//                                   rupture, and they stay close enough to be
//                                   caught in yours.
//                           HUNT    they break off, get behind the nearest
//                                   creature and fire at anything: more kills
//                                   and ruptures, more lost bots.
//                      The whole wing together fires about as fast as you do.
//
// This replaces the engine's E fleet mode (drag-select, right-click go) for
// the game: that was the RTS feel Ry ruled out. The engine code is untouched.
"use strict";

const GF_WING = {
    start: 2, max: 5,
    speed: 78,          // units/s: a bit faster than the lead ship's cruise
    fireRate: 1.6,      // shots/s per bot
    range: 48,          // FOLLOW firing range
    huntR: 170,         // HUNT bots pick targets this close to the lead ship
    standoff: 15,       // HUNT bots hold this far off (outside an aircrab blast, inside a Bellwether's)
    callCost: 34,
    cap: 100,
    leakAfter: 4,       // seconds after the last mote before the leak starts
    leak: 12,           // charge per second once leaking
    mendPer: 0.5,       // hull per point of charge dumped
    magnet: 42,         // motes within this come to the lead ship
    moteLife: 8
};

const gfWing = [];
const gfWarpFx = [];   // ultradrive beams of bots dropping in: { x0, y0, x1, y1, t }
const gfMotes = [];
const gfCap = { charge: 0, sinceGain: 99, flash: 0, deny: 0 };
let gfWingOrder = "follow";   // follow | hunt
let gfWingSeq = 0;

function gfMakeBot(x, y) {
    return { id: ++gfWingSeq, x: x, y: y, vx: 0, vy: 0, angle: 0, isAlive: true, gfHp: GF.fleetHp, gfGrab: null,
             fireCd: Math.random(), target: null, flash: 0, arriving: 0, deathMsg: "", isBot: true };
}

function gfWingInit() {
    for (let i = 0; i < GF_WING.start; i++) gfWing.push(gfMakeBot(glShip.x - 6 - i * 3, glShip.y + (i ? 5 : -5)));
}

function gfWingAlive() { let n = 0; for (let i = 0; i < gfWing.length; i++) if (gfWing[i].isAlive) n++; return n; }

// ---- keys (from gl-boot.js) ----
function gfWingKey(code) {
    if (gfRoundOver()) { if (code === "Enter") location.reload(); return; }
    if (code === "KeyF") {
        gfWingOrder = gfWingOrder === "follow" ? "hunt" : "follow";
        gfBanner("WING: " + (gfWingOrder === "follow" ? "FOLLOW · hold formation, careful fire" : "HUNT · break off, fire at will"), 2.2);
    } else if (code === "KeyR") {
        if (!glShip.isAlive) return;
        if (gfWingAlive() >= GF_WING.max) { gfBanner("WING FULL", 1.2); gfCap.deny = 0.4; }
        else if (gfCap.charge < GF_WING.callCost) { gfBanner("NOT ENOUGH SIPHON", 1.2); gfCap.deny = 0.4; }
        else {
            gfCap.charge -= GF_WING.callCost;
            // Ultradrives in from the mothership: lock-on ticks, then the beam,
            // then it drops out beside you.
            const b = gfMakeBot(glShip.x, glShip.y);
            b.warp = { t: -0.7, a: Math.atan2(glShip.y - gfHome.y, glShip.x - gfHome.x), ticks: 0 };
            gfWing.push(b);
            gfBanner("BOT LOCKING ON", 1.2);
        }
    } else if (code === "KeyG") {
        if (!glShip.isAlive) return;
        if (gfCap.charge < 5 || gfHull >= GF.hull) { gfCap.deny = 0.4; return; }
        const want = (GF.hull - gfHull) / GF_WING.mendPer, use = Math.min(gfCap.charge, want);
        gfHull = Math.min(GF.hull, gfHull + use * GF_WING.mendPer);
        gfCap.charge -= use;
        gfCap.flash = 0.5;
        glSpawnBurst(glShip.x, glShip.y, 14, "#7DFF9C");
    }
}

// ---- ultradrive: the wing leaves and arrives with the lead ship ----
function gfWingJumpOut() {
    for (let i = 0; i < gfWing.length; i++) {
        const b = gfWing[i];
        if (!b.isAlive || b.warp) continue;
        glUltraSpawnDust(b.x, b.y, 1);
        gfWarpFx.push({ x0: b.x, y0: b.y, x1: b.x + Math.cos(gfFlight.heading) * 900, y1: b.y + Math.sin(gfFlight.heading) * 900, t: 0, out: true });
        b.warp = { t: -1e9, a: gfFlight.heading, ticks: 9 };   // gone until gfWingJumpIn
        if (b.gfGrab) { if (b.gfGrab.by) b.gfGrab.by.grabbing = null; b.gfGrab = null; }
    }
}
function gfWingJumpIn(heading) {
    let n = 0;
    for (let i = 0; i < gfWing.length; i++) {
        const b = gfWing[i];
        if (!b.isAlive) continue;
        b.warp = { t: -0.5 - n * 0.28, a: heading, ticks: 9 };
        n++;
    }
}
// A bot in ultradrive is not in the fight. When its timer comes up it drops
// out at its slot: beam, flash, whoosh.
function gfBotWarp(b, k, dt) {
    const w = b.warp;
    w.t += dt;
    if (w.ticks < 2 && w.t > -0.6 + w.ticks * 0.25) { w.ticks++; glUltraSfxTick(w.ticks === 2); }
    if (w.t < 0) return;
    const slot = glShip.isAlive ? gfBotSlot(k) : { x: glShip.x, y: glShip.y };
    b.x = slot.x; b.y = slot.y;
    b.vx = Math.cos(w.a) * 60; b.vy = Math.sin(w.a) * 60;   // carries a little speed out
    b.angle = w.a;
    gfWarpFx.push({ x0: slot.x - Math.cos(w.a) * 1400, y0: slot.y - Math.sin(w.a) * 1400, x1: slot.x, y1: slot.y, t: 0, out: false });
    glUltraSpawnDust(slot.x, slot.y, 1);
    glUltraSfxExit();
    glUltraShakeKick = Math.max(glUltraShakeKick, 0.18);
    b.warp = null;
    b.arriving = 0.4;
}

// ---- siphon motes ----
function gfDropMotes(x, y, total) {
    const n = Math.max(1, Math.round(total / 4));
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = gfRand(4, 16);
        gfMotes.push({ x: x, y: y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, v: total / n, t: 0, ph: Math.random() * 6.28 });
    }
}

// ---- per-frame (from gfUpdate) ----
function gfWingUpdate(dt) {
    const s = glShip;
    // Capacitor: gains reset the leak timer; then it drains.
    gfCap.sinceGain += dt;
    gfCap.flash = Math.max(0, gfCap.flash - dt);
    gfCap.deny = Math.max(0, gfCap.deny - dt);
    if (gfCap.sinceGain > GF_WING.leakAfter) gfCap.charge = Math.max(0, gfCap.charge - GF_WING.leak * dt);

    for (let i = gfMotes.length - 1; i >= 0; i--) {
        const m = gfMotes[i];
        m.t += dt;
        const dx = s.x - m.x, dy = s.y - m.y, d = Math.hypot(dx, dy) || 1;
        if (s.isAlive && d < GF_WING.magnet) {
            const pull = 90 * (1 - d / GF_WING.magnet) + 30;
            m.vx += (dx / d * pull - m.vx) * Math.min(1, dt * 6);
            m.vy += (dy / d * pull - m.vy) * Math.min(1, dt * 6);
        } else { m.vx *= 1 - Math.min(1, dt * 1.2); m.vy *= 1 - Math.min(1, dt * 1.2); }
        m.x += m.vx * dt; m.y += m.vy * dt;
        if (s.isAlive && d < 2.2) {
            gfCap.charge = Math.min(GF_WING.cap, gfCap.charge + m.v);
            gfCap.sinceGain = 0;
            gfCap.flash = 0.25;
            gfMotes.splice(i, 1);
        } else if (m.t > GF_WING.moteLife) gfMotes.splice(i, 1);
    }

    // Bots.
    let slot = 0;
    for (let i = gfWing.length - 1; i >= 0; i--) {
        const b = gfWing[i];
        if (!b.isAlive) { gfWing.splice(i, 1); continue; }
    }
    for (let i = 0; i < gfWing.length; i++) {
        if (gfWing[i].warp) gfBotWarp(gfWing[i], slot++, dt);
        else gfBotUpdate(gfWing[i], slot++, dt);
    }
    for (let i = gfWarpFx.length - 1; i >= 0; i--) { gfWarpFx[i].t += dt; if (gfWarpFx[i].t > 1.1) gfWarpFx.splice(i, 1); }
}

function gfBotSlot(k) {
    // A V behind the lead ship's hull.
    const s = glShip, side = k % 2 ? 1 : -1, row = Math.floor(k / 2) + 1;
    const a = s.angle + Math.PI + side * 0.75;
    return { x: s.x + Math.cos(a) * (5 + row * 4), y: s.y + Math.sin(a) * (5 + row * 4) };
}

// Can a bolt from (x, y) wound this creature right now?
function gfCanWound(c, x, y) {
    if (c.birthT > 0) return false;
    if (!c.b.armour) return true;
    if (!c.b.open) return false;
    return Math.abs(glWrapAngle(Math.atan2(y - c.y, x - c.x) - (c.face + Math.PI))) < GF_OPEN_ARC * 0.8;
}

function gfBotUpdate(b, k, dt) {
    const s = glShip;
    b.flash = Math.max(0, b.flash - dt);
    b.fireCd -= dt;
    b.arriving = Math.max(0, b.arriving - dt);
    if (b.gfGrab) return;   // held: gfUpdateGrabs moves it
    const lead = s.isAlive ? s : gfHome;
    const slot = s.isAlive ? gfBotSlot(k) : { x: b.x, y: b.y };
    // Left behind (the lead ship relaunched from home): ultradrive to it.
    if (s.isAlive && gfFlight.jump !== "burst" && Math.hypot(lead.x - b.x, lead.y - b.y) > 420) {
        gfWarpFx.push({ x0: b.x, y0: b.y, x1: b.x + (lead.x - b.x) * 0.2, y1: b.y + (lead.y - b.y) * 0.2, t: 0, out: true });
        b.warp = { t: -0.6 - (k * 0.28), a: Math.atan2(lead.y - b.y, lead.x - b.x), ticks: 9 };
        return;
    }

    // Pick a target.
    let tgt = null, td = Infinity;
    const hunt = gfWingOrder === "hunt" && s.isAlive;
    for (let i = 0; i < gfCreatures.length; i++) {
        const c = gfCreatures[i];
        if (c.hp <= 0 || c.birthT > 0) continue;
        const d = Math.hypot(c.x - b.x, c.y - b.y);
        if (hunt) {
            if (Math.hypot(c.x - s.x, c.y - s.y) > GF_WING.huntR) continue;
            if (d < td) { td = d; tgt = c; }
        } else if (d < GF_WING.range && d < td && gfCanWound(c, b.x, b.y)) { td = d; tgt = c; }
    }
    b.target = tgt;

    // Where to fly.
    let tx = slot.x, ty = slot.y, maxSp = GF_WING.speed * (b.arriving > 0 ? 4 : 1);
    if (hunt && tgt) {
        // Get round behind it, holding outside its tendrils and (mostly) its blast.
        const back = tgt.kind === "krill" ? 8 : GF_WING.standoff + tgt.b.r * 0.5;
        const side = b.id % 2 ? 0.5 : -0.5;
        tx = tgt.x + Math.cos(tgt.face + Math.PI + side) * back;
        ty = tgt.y + Math.sin(tgt.face + Math.PI + side) * back;
    }
    const dx = tx - b.x, dy = ty - b.y, d = Math.hypot(dx, dy) || 1;
    const sp = Math.min(maxSp, d * 4);
    const ease = Math.min(1, dt * 5);
    b.vx += (dx / d * sp - b.vx) * ease;
    b.vy += (dy / d * sp - b.vy) * ease;
    // Keep bots off each other.
    for (let i = 0; i < gfWing.length; i++) {
        const o = gfWing[i];
        if (o === b) continue;
        const ex = b.x - o.x, ey = b.y - o.y, e = Math.hypot(ex, ey);
        if (e < 3 && e > 1e-6) { b.vx += ex / e * (3 - e) * 8; b.vy += ey / e * (3 - e) * 8; }
    }
    b.x += b.vx * dt; b.y += b.vy * dt;
    // The Tide is solid.
    const hx = b.x - gfHive.x, hy = b.y - gfHive.y, hd = Math.hypot(hx, hy);
    if (hd < gfHive.r + 1.5) { b.x = gfHive.x + hx / (hd || 1) * (gfHive.r + 1.5); b.y = gfHive.y + hy / (hd || 1) * (gfHive.r + 1.5); }

    // Face the target, else the way it is going; fire.
    const want = tgt ? Math.atan2(tgt.y - b.y, tgt.x - b.x) : (Math.hypot(b.vx, b.vy) > 4 ? Math.atan2(b.vy, b.vx) : s.angle);
    b.angle += glWrapAngle(want - b.angle) * Math.min(1, dt * 10);
    if (tgt && b.fireCd <= 0 && b.arriving <= 0) {
        const inRange = td < (hunt ? GF_WING.range * 1.2 : GF_WING.range);
        if (inRange && (hunt || gfCanWound(tgt, b.x, b.y)) && glBullets.length < GL_MAX_BULLETS) {
            const W = GF_ARMS.blaster;
            // Lead the shot a little.
            const tt = td / (W.speed * 60);
            const a = Math.atan2(tgt.y + tgt.vy * tt - b.y, tgt.x + tgt.vx * tt - b.x) + (Math.random() - 0.5) * 0.08;
            glBullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * W.speed, vy: Math.sin(a) * W.speed, life: W.life, size: 2,
                             color: "#7DF9FF", gf: "bolt", bot: true });
            b.fireCd = 1 / GF_WING.fireRate;
        }
    }
    // An orifice that is open is always fair game, in either order.
    if (!tgt && b.fireCd <= 0 && b.arriving <= 0) {
        for (let i = 0; i < gfOrifices.length; i++) {
            const o = gfOrifices[i];
            if (o.sealed || o.state === "closed") continue;
            const p = gfOrificePos(o), od = Math.hypot(p.x - b.x, p.y - b.y);
            if (od > GF_WING.range * 1.3 || glBullets.length >= GL_MAX_BULLETS) continue;
            const W = GF_ARMS.blaster, a = Math.atan2(p.y - b.y, p.x - b.x);
            b.angle = a;
            glBullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * W.speed, vy: Math.sin(a) * W.speed, life: W.life, size: 2,
                             color: "#7DF9FF", gf: "bolt", bot: true });
            b.fireCd = 1 / GF_WING.fireRate;
            break;
        }
    }
}

// ---- drawing: world ----
function gfDrawMotes(c, z) {
    c.save();
    for (let i = 0; i < gfMotes.length; i++) {
        const m = gfMotes[i], p = glWorldToScreenRaw(m.x, m.y);
        if (p.x < -10 || p.y < -10 || p.x > glW + 10 || p.y > glH + 10) continue;
        const fade = Math.min(1, (GF_WING.moteLife - m.t) / 2);
        const r = (2.2 + Math.sin(gfTime * 8 + m.ph)) * Math.max(0.8, z / 9);
        c.globalAlpha = 0.25 * fade; c.fillStyle = "#7DFF9C";
        c.beginPath(); c.arc(p.x, p.y, r * 2.4, 0, Math.PI * 2); c.fill();
        c.globalAlpha = fade; c.fillStyle = "#E8FFF0";
        c.beginPath(); c.arc(p.x, p.y, r * 0.8, 0, Math.PI * 2); c.fill();
    }
    c.restore();
}

function gfDrawWing(c, z) {
    c.save();
    // Ultradrive beams: the same layered blue as the lead ship's, thinner,
    // with a ring where a bot drops out.
    c.globalCompositeOperation = "lighter"; c.lineCap = "round";
    for (let i = 0; i < gfWarpFx.length; i++) {
        const f = gfWarpFx[i], k = f.t / 1.1, a = glWorldToScreenRaw(f.x0, f.y0), b = glWorldToScreenRaw(f.x1, f.y1);
        const seg = glUltraClip(a.x, a.y, b.x, b.y, -200, -200, glW + 200, glH + 200);
        if (seg) {
            [[26, "40,110,255", 0.14], [12, "110,195,255", 0.4], [4, "225,245,255", 0.9]].forEach(function (L) {
                c.lineWidth = L[0] * (1 - k * 0.6); c.strokeStyle = "rgba(" + L[1] + "," + (L[2] * (1 - k)).toFixed(3) + ")";
                c.beginPath(); c.moveTo(seg[0], seg[1]); c.lineTo(seg[2], seg[3]); c.stroke();
            });
        }
        const e = f.out ? a : b;
        c.strokeStyle = "rgba(150,210,255," + (0.8 * (1 - k)).toFixed(3) + ")"; c.lineWidth = 5 * (1 - k) + 1;
        c.beginPath(); c.arc(e.x, e.y, 8 + k * 110, 0, Math.PI * 2); c.stroke();
    }
    c.globalCompositeOperation = "source-over"; c.lineCap = "butt";
    for (let i = 0; i < gfWing.length; i++) {
        const b = gfWing[i];
        if (!b.isAlive || b.warp) continue;
        const p = glWorldToScreenRaw(b.x, b.y);
        if (p.x < -40 || p.y < -40 || p.x > glW + 40 || p.y > glH + 40) continue;
        const k = Math.max(0.6, z / 14);
        // HUNT: a thin line to what it is after, so the order is visible.
        if (gfWingOrder === "hunt" && b.target) {
            const tp = glWorldToScreenRaw(b.target.x, b.target.y);
            c.strokeStyle = "rgba(255,176,0,0.25)"; c.lineWidth = 1; c.setLineDash([2, 6]);
            c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(tp.x, tp.y); c.stroke(); c.setLineDash([]);
        }
        c.save();
        c.translate(p.x, p.y); c.rotate(b.angle); c.scale(k, k);
        const sp = Math.hypot(b.vx, b.vy);
        const fl = 3 + Math.min(14, sp * 0.12) * (0.8 + Math.random() * 0.4);
        c.fillStyle = "rgba(125,249,255,0.7)";
        c.beginPath(); c.moveTo(-6, -1.5); c.lineTo(-6 - fl, 0); c.lineTo(-6, 1.5); c.closePath(); c.fill();
        c.fillStyle = b.flash > 0 ? "#FFFFFF" : "#0E2A33";
        c.strokeStyle = gfWingOrder === "hunt" ? "#FFB000" : "#7DF9FF"; c.lineWidth = 1.2 / k; c.lineJoin = "round";
        c.beginPath(); c.moveTo(9, 0); c.lineTo(-5, 6); c.lineTo(-7, 2.5); c.lineTo(-7, -2.5); c.lineTo(-5, -6); c.closePath();
        c.fill(); c.stroke();
        c.fillStyle = "#C9FFE9"; c.fillRect(1, -1, 3, 2);
        c.restore();
        // Hull pips when hurt.
        if (b.gfHp < GF.fleetHp) {
            c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(p.x - 8, p.y + 10 * k, 16, 3);
            c.fillStyle = b.gfHp > GF.fleetHp * 0.4 ? "#7DF9FF" : "#FF2E88"; c.fillRect(p.x - 8, p.y + 10 * k, 16 * Math.max(0, b.gfHp / GF.fleetHp), 3);
        }
        if (b.gfGrab) { c.strokeStyle = "#FF2E88"; c.lineWidth = 1.5; c.beginPath(); c.arc(p.x, p.y, 12 * k, 0, Math.PI * 2); c.stroke(); }
    }
    c.restore();
}

// ---- score ----
// Clean kills are worth far more than burst ones, so the score pays for tact.
const GF_SCORE = { orifice: 1000, crab: 100, krill: 20, bell: 500, burst: 10, ship: 500, bot: 100, second: 5 };
function gfScoreParts() {
    const won = gfRound.phase === "won";
    const p = [
        ["Orifices sealed", 3 - gfOrificesLeft(), GF_SCORE.orifice],
        ["Aircrabs, clean", gfKills.crab, GF_SCORE.crab],
        ["Airkrill, clean", gfKills.krill, GF_SCORE.krill],
        ["Bellwethers, clean", gfKills.bell, GF_SCORE.bell],
        ["Burst in ruptures", gfKills.burst, GF_SCORE.burst]
    ];
    if (won) {
        p.push(["Ships left", gfRound.ships, GF_SCORE.ship]);
        p.push(["Wing bots alive", gfWingAlive(), GF_SCORE.bot]);
        p.push(["Seconds to spare", Math.floor(Math.max(0, GF.clock - gfRound.t)), GF_SCORE.second]);
    }
    return p;
}
function gfScore() {
    let t = 0;
    gfScoreParts().forEach(function (r) { t += r[1] * r[2]; });
    return t;
}

// ---- drawing: the game sidebar (screen space, from gfDrawOverlay) ----
// Replaces the engine's parameter panel (Ry, 2026-11-15). Everything the
// round runs on is here: the clock, the orifices, hull, the siphon capacitor,
// the wing and its order, the score, and two maps for the sense of direction.
const GF_SIDE_W = 270;

function gfBar(c, x, y, w, h, k, col) {
    c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = col; c.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
    c.strokeStyle = "rgba(201,255,233,0.45)"; c.lineWidth = 1; c.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
}
function gfSideHead(c, x, y, w, label) {
    c.font = "12px monospace"; c.textAlign = "left"; c.fillStyle = "#7DF9FF";
    c.fillText(label, x, y);
    c.fillStyle = "rgba(125,249,255,0.2)"; c.fillRect(x, y + 4, w, 1);
}

function gfDrawSidebar(c) {
    const X0 = glW - GF_SIDE_W, x = X0 + 14, W = GF_SIDE_W - 28;
    c.fillStyle = "rgba(2,6,10,0.86)"; c.fillRect(X0, 0, GF_SIDE_W, glH);
    c.fillStyle = "rgba(125,249,255,0.3)"; c.fillRect(X0, 0, 1, glH);
    let y = 26;

    // Clock, objective, score.
    const left = Math.max(0, GF.clock - gfRound.t), mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    c.font = "30px 'VT323', monospace"; c.textAlign = "left";
    c.fillStyle = left < 60 ? "#FF2E88" : "#E8FFF4";
    c.fillText(mm + ":" + (ss < 10 ? "0" : "") + ss, x, y + 4);
    c.textAlign = "right"; c.fillStyle = "#FFE45C";
    c.fillText(String(gfScore()), x + W, y + 4);
    c.font = "11px monospace"; c.fillStyle = "#6d8582";
    c.fillText("SCORE", x + W, y + 18); c.textAlign = "left"; c.fillText("TIME LEFT", x, y + 18);
    y += 42;

    // The Tide's orifices.
    gfSideHead(c, x, y, W, gfRound.phase === "flood" ? "THE FLOOD · " + gfCreatures.length + " LEFT" : "THE TIDE · SEAL 3 ORIFICES");
    y += 20;
    for (let i = 0; i < gfOrifices.length; i++) {
        const o = gfOrifices[i], hot = !o.sealed && o.state !== "closed";
        c.lineWidth = 2;
        if (o.sealed) {
            c.strokeStyle = "rgba(255,122,156,0.45)";
            c.beginPath(); c.moveTo(x + 2, y - 9); c.lineTo(x + 12, y + 1); c.moveTo(x + 12, y - 9); c.lineTo(x + 2, y + 1); c.stroke();
        } else {
            c.strokeStyle = hot ? "#FFE45C" : "#FF7A9C";
            c.fillStyle = hot ? "rgba(255,228,92,0.5)" : "rgba(194,51,90,0.4)";
            c.beginPath(); c.arc(x + 7, y - 4, hot ? 7 : 5.5, 0, Math.PI * 2); c.fill(); c.stroke();
            c.fillStyle = "#1a0008"; c.beginPath(); c.arc(x + 7, y - 4, hot ? 3.5 : 1.2, 0, Math.PI * 2); c.fill();
        }
        c.font = "12px monospace"; c.textAlign = "left";
        c.fillStyle = o.sealed ? "#6d8582" : (hot ? "#FFE45C" : "#cfe9e6");
        c.fillText(o.sealed ? "sealed" : o.state === "swell" ? "SWELLING" : o.state === "open" ? "OPEN" : "shut " + Math.ceil(o.t) + "s", x + 22, y);
        if (!o.sealed) gfBar(c, x + 110, y - 8, W - 110, 7, o.hp / GF.oriHp, "#FF3B5E");
        y += 19;
    }
    y += 10;

    // Hull and ships.
    gfSideHead(c, x, y, W, "HULL"); y += 12;
    const hcol = gfHull > 60 ? "#7DF9FF" : (gfHull > 25 ? "#FFB000" : "#FF2E88");
    gfBar(c, x, y, W - 70, 11, gfHull / GF.hull, hcol);
    c.font = "12px monospace"; c.textAlign = "right"; c.fillStyle = "#cfe9e6";
    let ships = "";
    for (let i = 0; i < GF.ships; i++) ships += i < gfRound.ships ? "▲" : "△";
    c.fillText(ships, x + W, y + 10);
    y += 34;

    // Siphon capacitor: leaks, so it drains by itself. A notch per bot call.
    const leaking = gfCap.sinceGain > GF_WING.leakAfter && gfCap.charge > 0;
    gfSideHead(c, x, y, W, "SIPHON CAPACITOR" + (leaking ? " · LEAKING" : "")); y += 12;
    const ccol = gfCap.deny > 0 ? "#FF2E88" : (gfCap.flash > 0 ? "#FFFFFF" : (leaking ? "#4FAE6A" : "#7DFF9C"));
    gfBar(c, x, y, W, 13, gfCap.charge / GF_WING.cap, ccol);
    c.fillStyle = "rgba(0,0,0,0.8)";
    for (let i = 1; i * GF_WING.callCost < GF_WING.cap; i++) c.fillRect(x + W * i * GF_WING.callCost / GF_WING.cap, y, 1.5, 13);
    y += 28;
    const canCall = gfCap.charge >= GF_WING.callCost && gfWingAlive() < GF_WING.max;
    const canMend = gfCap.charge >= 5 && gfHull < GF.hull;
    c.font = "12px monospace"; c.textAlign = "left";
    c.fillStyle = canCall ? "#7DFF9C" : "#4a5f5c";
    c.fillText("[R] call a bot · " + GF_WING.callCost, x, y);
    c.fillStyle = canMend ? "#7DFF9C" : "#4a5f5c";
    c.fillText("[G] mend hull · +" + Math.floor(Math.min(gfCap.charge * GF_WING.mendPer, GF.hull - gfHull)), x, y + 15);
    c.fillStyle = "#6d8582";
    c.fillText("clean kills fill it; it won't keep", x, y + 30);
    y += 48;

    // The wing: the order, then one row per slot.
    const hunt = gfWingOrder === "hunt";
    gfSideHead(c, x, y, W, "WING · " + gfWingAlive() + "/" + GF_WING.max); y += 14;
    const bw = (W - 6) / 2;
    [["FOLLOW", !hunt, "#7DF9FF"], ["HUNT", hunt, "#FFB000"]].forEach(function (o, i) {
        const bx = x + i * (bw + 6);
        c.fillStyle = o[1] ? o[2] : "rgba(255,255,255,0.05)"; c.fillRect(bx, y, bw, 20);
        c.strokeStyle = o[2]; c.lineWidth = 1; c.strokeRect(bx + 0.5, y + 0.5, bw - 1, 19);
        c.font = "bold 12px monospace"; c.textAlign = "center"; c.fillStyle = o[1] ? "#001014" : o[2];
        c.fillText(o[0], bx + bw / 2, y + 14);
    });
    y += 34;
    c.font = "11px monospace"; c.textAlign = "left"; c.fillStyle = "#9fb8b4";
    c.fillText(hunt ? "break off, flank, fire at will" : "hold formation, shoot only to wound", x, y);
    c.fillStyle = "#6d8582"; c.fillText("[F] switches the order", x, y + 14);
    y += 30;
    for (let i = 0; i < GF_WING.max; i++) {
        const b = gfWing[i];
        c.font = "12px monospace"; c.textAlign = "left";
        if (b && b.isAlive) {
            c.fillStyle = hunt ? "#FFB000" : "#7DF9FF"; c.fillText("◆", x, y);
            gfBar(c, x + 16, y - 8, 70, 7, b.gfHp / GF.fleetHp, b.gfHp > GF.fleetHp * 0.4 ? "#7DF9FF" : "#FF2E88");
            const st = b.warp ? "ultradrive" : b.gfGrab ? "GRABBED" : b.arriving > 0 ? "inbound" : b.target ? (hunt ? "hunting" : "firing") : (hunt ? "seeking" : "in formation");
            c.fillStyle = b.gfGrab ? "#FF2E88" : "#9fb8b4"; c.fillText(st, x + 96, y);
        } else { c.fillStyle = "#4a5f5c"; c.fillText("◇  empty slot", x, y); }
        y += 16;
    }
    y += 12;

    // Maps: SITE (round you) and ORBIT (the whole theatre), in what room is left.
    const keysH = 62, room = glH - y - keysH - 30;
    const orbitH = 46, siteS = Math.max(0, Math.min(W, room - orbitH - 30));
    if (siteS >= 90) {
        gfSideHead(c, x, y, W, "SITE"); y += 10;
        gfDrawSiteMap(c, x + (W - siteS) / 2, y, siteS);
        y += siteS + 20;
    }
    if (glH - y - keysH > orbitH + 10) {
        gfSideHead(c, x, y, W, "ORBIT"); y += 10;
        gfDrawOrbitMap(c, x, y, W, orbitH);
    }

    // Keys.
    c.font = "11px monospace"; c.textAlign = "left"; c.fillStyle = "#6d8582";
    const ky = glH - keysH + 6;
    c.fillText("WASD move · mouse aim · click fire", x, ky);
    c.fillText("right click seeker · SPACE boost", x, ky + 14);
    c.fillText("hold SPACE out of combat: jump", x, ky + 28);
    c.fillText("F order · R bot · G mend · P pause", x, ky + 42);
}

// SITE: a radar round the lead ship. North is up, same as the screen.
function gfDrawSiteMap(c, x, y, S) {
    const s = glShip, R = 420, k = S / 2 / R, cx = x + S / 2, cy = y + S / 2;
    c.save();
    c.fillStyle = "rgba(0,0,0,0.7)"; c.fillRect(x, y, S, S);
    c.strokeStyle = "rgba(125,249,255,0.35)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
    c.beginPath(); c.rect(x, y, S, S); c.clip();
    function P(wx, wy) { return { x: cx + (wx - s.x) * k, y: cy + (wy - s.y) * k }; }
    c.strokeStyle = "rgba(125,249,255,0.12)";
    c.beginPath(); c.arc(cx, cy, 200 * k, 0, Math.PI * 2); c.stroke();
    // The Tide and its orifices.
    const t = P(gfHive.x, gfHive.y);
    c.fillStyle = gfHive.dead ? "rgba(70,30,40,0.8)" : "rgba(150,30,60,0.75)"; c.strokeStyle = "#C2335A";
    c.beginPath(); c.arc(t.x, t.y, gfHive.r * k, 0, Math.PI * 2); c.fill(); c.stroke();
    for (let i = 0; i < gfOrifices.length; i++) {
        const o = gfOrifices[i], w = gfOrificePos(o), p = P(w.x, w.y);
        if (o.sealed) { c.fillStyle = "#3a1018"; c.fillRect(p.x - 2, p.y - 2, 4, 4); continue; }
        const hot = o.state !== "closed";
        c.fillStyle = hot ? "#FFE45C" : "#FF7A9C";
        c.beginPath(); c.arc(p.x, p.y, hot ? 4 + Math.sin(gfTime * 10) : 3, 0, Math.PI * 2); c.fill();
    }
    // Creatures, motes, wing.
    for (let i = 0; i < gfCreatures.length; i++) {
        const cr = gfCreatures[i], p = P(cr.x, cr.y), big = cr.kind === "bell" ? 3 : (cr.kind === "crab" ? 2 : 1);
        c.fillStyle = GF_KINDS[cr.kind].col; c.fillRect(p.x - big / 2, p.y - big / 2, big + 0.5, big + 0.5);
    }
    c.fillStyle = "#7DFF9C";
    for (let i = 0; i < gfMotes.length; i++) { const p = P(gfMotes[i].x, gfMotes[i].y); c.fillRect(p.x, p.y, 1, 1); }
    c.fillStyle = gfWingOrder === "hunt" ? "#FFB000" : "#7DF9FF";
    for (let i = 0; i < gfWing.length; i++) { if (gfWing[i].warp) continue; const p = P(gfWing[i].x, gfWing[i].y); c.fillRect(p.x - 1, p.y - 1, 2, 2); }
    // Home: an arrow on the rim pointing the way back.
    const ha = Math.atan2(gfHome.y - s.y, gfHome.x - s.x);
    if (Math.hypot(gfHome.x - s.x, gfHome.y - s.y) > R) {
        const hx = cx + Math.cos(ha) * (S / 2 - 8), hy = cy + Math.sin(ha) * (S / 2 - 8);
        c.fillStyle = "#7DF9FF";
        c.beginPath(); c.moveTo(hx + Math.cos(ha) * 6, hy + Math.sin(ha) * 6);
        c.lineTo(hx + Math.cos(ha + 2.5) * 5, hy + Math.sin(ha + 2.5) * 5); c.lineTo(hx + Math.cos(ha - 2.5) * 5, hy + Math.sin(ha - 2.5) * 5); c.closePath(); c.fill();
    } else { const p = P(gfHome.x, gfHome.y); c.strokeStyle = "#7DF9FF"; c.strokeRect(p.x - 3, p.y - 3, 6, 6); }
    // You: a wedge on the hull's heading, and the view box.
    if (s.isAlive) {
        c.fillStyle = "#FFFFFF";
        c.beginPath(); c.moveTo(cx + Math.cos(s.angle) * 5, cy + Math.sin(s.angle) * 5);
        c.lineTo(cx + Math.cos(s.angle + 2.5) * 4, cy + Math.sin(s.angle + 2.5) * 4); c.lineTo(cx + Math.cos(s.angle - 2.5) * 4, cy + Math.sin(s.angle - 2.5) * 4); c.closePath(); c.fill();
        const vw = glW / glCamera.zoom * k, vh = glH / glCamera.zoom * k;
        if (vw < S) { c.strokeStyle = "rgba(255,255,255,0.25)"; c.strokeRect(cx - vw / 2, cy - vh / 2, vw, vh); }
    }
    c.restore();
}

// ORBIT: the whole theatre on one line, mothership to The Tide, Earth between.
// Later sites go on this same strip, so each one is a place on the way.
function gfDrawOrbitMap(c, x, y, W, H) {
    const s = glShip;
    c.save();
    c.fillStyle = "rgba(0,0,0,0.7)"; c.fillRect(x, y, W, H);
    c.strokeStyle = "rgba(125,249,255,0.35)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, W - 1, H - 1);
    c.beginPath(); c.rect(x, y, W, H); c.clip();
    // Project onto the home -> Tide axis (u) and its normal (v).
    const ax = gfHive.x - gfHome.x, ay = gfHive.y - gfHome.y, L = Math.hypot(ax, ay) || 1, ux = ax / L, uy = ay / L;
    const pad = 26, k = (W - pad * 2) / L, my = y + H / 2;
    function P(wx, wy) {
        const dx = wx - gfHome.x, dy = wy - gfHome.y;
        return { x: x + pad + (dx * ux + dy * uy) * k, y: my + (-dx * uy + dy * ux) * k };
    }
    // Earth, behind and below the lane.
    const g = c.createRadialGradient(x + W / 2 - 8, y + H + 30, 10, x + W / 2, y + H + 46, 70);
    g.addColorStop(0, "rgba(60,120,190,0.9)"); g.addColorStop(1, "rgba(10,30,70,0.9)");
    c.fillStyle = g; c.beginPath(); c.arc(x + W / 2, y + H + 46, 70, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(170,225,255,0.5)"; c.beginPath(); c.arc(x + W / 2, y + H + 46, 70, Math.PI, Math.PI * 2); c.stroke();
    c.setLineDash([2, 4]); c.strokeStyle = "rgba(125,249,255,0.3)";
    c.beginPath(); c.moveTo(x + pad, my); c.lineTo(x + W - pad, my); c.stroke(); c.setLineDash([]);
    c.font = "9px monospace"; c.textAlign = "center";
    c.strokeStyle = "#7DF9FF"; c.strokeRect(x + pad - 4, my - 4, 8, 8);
    c.fillStyle = "#7DF9FF"; c.fillText("HOME", x + pad, my - 9);
    c.fillStyle = gfHive.dead ? "#5a2030" : "#C2335A"; c.beginPath(); c.arc(x + W - pad, my, 7, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#FF7A9C"; c.fillText("THE TIDE", x + W - pad - 4, my - 11);
    if (s.isAlive) {
        const p = P(s.x, s.y);
        c.fillStyle = "#FFFFFF";
        c.beginPath(); c.moveTo(p.x, Math.max(y + 4, Math.min(y + H - 4, p.y)) - 5); c.lineTo(p.x + 4, Math.max(y + 4, Math.min(y + H - 4, p.y)) + 3);
        c.lineTo(p.x - 4, Math.max(y + 4, Math.min(y + H - 4, p.y)) + 3); c.closePath(); c.fill();
    }
    c.restore();
}

function gfDrawHud(c) {
    c.save();
    gfDrawSidebar(c);
    const mid = (glW - GF_SIDE_W) / 2;
    c.textAlign = "center";
    // Banner.
    if (gfRound.bannerT > 0 && !gfRoundOver()) {
        c.globalAlpha = Math.min(1, gfRound.bannerT * 2);
        c.font = "26px 'VT323', monospace";
        c.fillStyle = "#FFE45C";
        c.fillText(gfRound.banner, mid, glH * 0.2);
        c.globalAlpha = 1;
    }
    if (!glShip.isAlive && !gfRoundOver()) {
        c.font = "22px 'VT323', monospace"; c.fillStyle = "#FF2E88";
        c.fillText((glShip.deathMsg || "ship lost").toUpperCase(), mid, glH / 2);
    }

    // End card: the score readout.
    if (gfRoundOver()) {
        const won = gfRound.phase === "won";
        c.fillStyle = "rgba(0,0,0," + Math.min(0.8, gfRound.endT * 1.2).toFixed(3) + ")";
        c.fillRect(0, 0, glW, glH);
        const parts = gfScoreParts(), cx = glW / 2;
        let y = Math.max(70, glH / 2 - 190);
        c.font = "64px 'VT323', monospace";
        c.fillStyle = won ? "#7DFF9C" : "#FF2E88";
        c.fillText(won ? "YOU WIN" : "YOU LOSE", cx, y);
        c.font = "22px 'VT323', monospace"; c.fillStyle = "#E8FFF4";
        c.fillText(gfRound.endMsg, cx, y + 30);
        const t = gfRound.t, m2 = Math.floor(t / 60), s2 = Math.floor(t % 60);
        c.fillStyle = "#9fb8b4"; c.fillText("round time " + m2 + ":" + (s2 < 10 ? "0" : "") + s2, cx, y + 54);
        y += 92;
        c.font = "20px 'VT323', monospace";
        parts.forEach(function (r) {
            c.textAlign = "left"; c.fillStyle = "#cfe9e6"; c.fillText(r[0], cx - 200, y);
            c.textAlign = "right"; c.fillStyle = "#9fb8b4"; c.fillText(r[1] + " x " + r[2], cx + 90, y);
            c.fillStyle = "#E8FFF4"; c.fillText(String(r[1] * r[2]), cx + 200, y);
            y += 24;
        });
        c.fillStyle = "rgba(232,255,244,0.4)"; c.fillRect(cx - 200, y - 12, 400, 1);
        y += 20;
        c.font = "36px 'VT323', monospace";
        c.textAlign = "left"; c.fillStyle = "#FFE45C"; c.fillText("SCORE", cx - 200, y);
        c.textAlign = "right"; c.fillText(String(gfScore()), cx + 200, y);
        c.textAlign = "center"; c.font = "24px 'VT323', monospace";
        c.fillText("ENTER to fly again", cx, y + 50);
    }
    c.restore();
}
