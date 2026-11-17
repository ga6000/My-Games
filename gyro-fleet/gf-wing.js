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
//                        J  call one bot from the mothership (34 charge)
//                        K  dump whatever is left into a hull mend
//   THE WING           Up to GF_WING.max bots fly with you. One key, two orders:
//                        H  FOLLOW  tight formation; they only fire at what
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
    start: 2, max: 3,   // max goes to 5 when the RELAY satellite is freed (gfSiteCleared)
    speed: 78,          // units/s: a bit faster than the lead ship's cruise
    fireRate: 1.6,      // shots/s per bot
    range: 48,          // FOLLOW firing range
    huntR: 170,         // HUNT bots pick targets this close to the lead ship
    standoff: 15,       // HUNT bots hold this far off (outside an aircrab blast, inside a Bellwether's)
    callCost: 34,
    dropR: 24,          // a bot dropping out of ultradrive throws back everything this close
    cap: 100,
    leakAfter: 4,       // seconds after the last mote before the leak starts
    leak: 12,           // charge per second once leaking
    mendPer: 0.5,       // hull per point of charge dumped
    magnet: 42,         // motes within this come to the lead ship
    moteLife: 8
};

const gfWing = [];
const gfWarpFx = [];   // (.big = a drop-in: flash, double ring)
const gfWarpFxNote = 0;   // ultradrive beams of bots dropping in: { x0, y0, x1, y1, t }
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

function gfWingAlive() { let n = 0; for (let i = 0; i < gfWing.length; i++) if (gfWing[i].isAlive && !gfWing[i].ally) n++; return n; }

// ---- keys (from gl-boot.js) ----
function gfWingKey(code) {
    if (gfRoundOver()) { if (code === "Enter") location.reload(); return; }
    if (code === "KeyH") {
        gfWingOrder = gfWingOrder === "follow" ? "hunt" : "follow";
        gfBanner(gfWingOrder === "follow" ? "FOLLOW" : "HUNT", 1.4);
        gfSfx("order", gfWingOrder === "hunt" ? 1 : 0);
    } else if (code === "KeyJ") {
        if (!glShip.isAlive) return;
        if (gfWingAlive() >= GF_WING.max || gfCap.charge < GF_WING.callCost) { gfCap.deny = 0.4; gfSfx("deny"); }
        else {
            gfCap.charge -= GF_WING.callCost;
            // Ultradrives in from the mothership: lock-on ticks, then the beam,
            // then it drops out beside you.
            const b = gfMakeBot(glShip.x, glShip.y);
            b.warp = { t: -0.7, a: Math.atan2(glShip.y - gfHome.y, glShip.x - gfHome.x), ticks: 0 };
            gfWing.push(b);

        }
    } else if (code === "KeyK") gfCrewAbility();   // gf-crew.js: each crew member's siphon ability (Maren's is the mend)
}

// Free bots from the mothership (a freed relay): they ultradrive in like a called one.
function gfWingReinforce(n) {
    for (let i = 0; i < n && gfWingAlive() < GF_WING.max; i++) {
        const b = gfMakeBot(glShip.x, glShip.y);
        b.warp = { t: -0.9 - i * 0.35, a: Math.atan2(glShip.y - gfHome.y, glShip.x - gfHome.x), ticks: 0 };
        gfWing.push(b);
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
    gfSfx("drop");
    glUltraShakeKick = Math.max(glUltraShakeKick, 0.4);
    glSpawnBurst(slot.x, slot.y, 26, "#9FD8FF");
    gfWarpFx[gfWarpFx.length - 1].big = true;
    // The arrival is a blow: everything close is thrown back and knocked
    // breathless for a moment, so a bot called into a crowd buys you room.
    // (Pass 4. Ry: "intensifying the bot drop in a bit would add reward".)
    for (let i = 0; i < gfCreatures.length; i++) {
        const m = gfCreatures[i], dx = m.x - slot.x, dy = m.y - slot.y, d = Math.hypot(dx, dy);
        if (d > GF_WING.dropR || m.hp <= 0 || m.birthT > 0) continue;
        const push = (1 - d / GF_WING.dropR) * (m.kind === "bell" ? 25 : 70);
        m.vx += dx / (d || 1) * push; m.vy += dy / (d || 1) * push;
        if (m.kind === "krill") { m.hp = 0; continue; }
        m.winded = Math.max(m.winded, m.kind === "bell" ? 1 : 2);
        if (m.grabbing) { m.grabbing.gfGrab = null; m.grabbing = null; m.tendrilCd = 3; }
    }
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
            gfSfx("mote", gfCap.charge / GF_WING.cap);
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

    // Pick a target. An allied crew ship (dev menu) flies by its own habits
    // (GF_ALLY, gf-crew.js) whatever the wing's order is.
    let tgt = null, td = Infinity;
    const A = b.ally ? GF_ALLY[b.crew] : null;
    const hunt = (A ? A.mode === "hunt" : gfWingOrder === "hunt") && s.isAlive;
    const range = A ? A.range : GF_WING.range;
    for (let i = 0; i < gfCreatures.length; i++) {
        const c = gfCreatures[i];
        if (c.hp <= 0 || c.birthT > 0) continue;
        const d = Math.hypot(c.x - b.x, c.y - b.y);
        if (hunt) {
            if (Math.hypot(c.x - s.x, c.y - s.y) > GF_WING.huntR) continue;
            if (d < td) { td = d; tgt = c; }
        } else if (d < range && d < td && (gfCanWound(c, b.x, b.y) || c.tumble > 0)) { td = d; tgt = c; }
    }
    b.target = tgt;

    // Where to fly.
    let tx = slot.x, ty = slot.y, maxSp = GF_WING.speed * (A ? A.speed : 1) * (b.arriving > 0 ? 4 : 1);
    if (A && A.mode === "screen" && s.isAlive) {
        // Hold between the lead ship and whatever is nearest to it.
        let nc = null, nd = 200;
        for (let i = 0; i < gfCreatures.length; i++) { const d2 = Math.hypot(gfCreatures[i].x - s.x, gfCreatures[i].y - s.y); if (d2 < nd) { nd = d2; nc = gfCreatures[i]; } }
        if (nc) { const sa = Math.atan2(nc.y - s.y, nc.x - s.x); tx = s.x + Math.cos(sa) * 11; ty = s.y + Math.sin(sa) * 11; }
    }
    if (hunt && tgt) {
        // Get round behind it, holding outside its tendrils and (mostly) its blast.
        const back = A ? A.standoff + tgt.b.r : (tgt.kind === "krill" ? 8 : GF_WING.standoff + tgt.b.r * 0.5);
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
    // Sites are solid.
    for (let i = 0; i < gfSites.length; i++) {
        const st = gfSites[i], hx = b.x - st.x, hy = b.y - st.y, hd = Math.hypot(hx, hy);
        if (hd < st.r + 1.5) { b.x = st.x + hx / (hd || 1) * (st.r + 1.5); b.y = st.y + hy / (hd || 1) * (st.r + 1.5); }
    }

    // Face the target, else the way it is going; fire.
    const want = tgt ? Math.atan2(tgt.y - b.y, tgt.x - b.x) : (Math.hypot(b.vx, b.vy) > 4 ? Math.atan2(b.vy, b.vx) : s.angle);
    b.angle += glWrapAngle(want - b.angle) * Math.min(1, dt * 10);
    if (tgt && b.fireCd <= 0 && b.arriving <= 0) {
        const inRange = td < (hunt ? range * 1.2 : range);
        if (inRange && (hunt || gfCanWound(tgt, b.x, b.y)) && glBullets.length < GL_MAX_BULLETS) {
            const W = GF_ARMS.blaster;
            // Lead the shot a little. The bot fires a weaker copy of its leader's weapon (gf-crew.js).
            const tt = td / (W.speed * 60);
            const a = Math.atan2(tgt.y + tgt.vy * tt - b.y, tgt.x + tgt.vx * tt - b.x) + (Math.random() - 0.5) * 0.08;
            b.fireCd = gfCrewFire(b, a, true, tgt, b.crew) * (A ? 0.45 : 1);
        }
    }
    // An orifice that is open is always fair game, in either order.
    if (!tgt && b.fireCd <= 0 && b.arriving <= 0) {
        for (let i = 0; i < gfOrifices.length; i++) {
            const o = gfOrifices[i];
            if (o.sealed || o.clamped || o.state === "closed" || !o.site.awake) continue;
            const p = gfOrificePos(o), od = Math.hypot(p.x - b.x, p.y - b.y);
            if (od > GF_WING.range * 1.3 || glBullets.length >= GL_MAX_BULLETS) continue;
            const W = GF_ARMS.blaster, a = Math.atan2(p.y - b.y, p.x - b.x);
            b.angle = a;
            glBullets.push({ x: b.x, y: b.y, vx: Math.cos(a) * W.speed, vy: Math.sin(a) * W.speed, life: W.life, size: 2,
                             color: "#7DF9FF", gf: "bolt", bot: true, owner: b });
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
        if (f.big) {
            // The drop-in: a white flash, a hard shock ring out to its reach, a cross flare.
            const rr = GF_WING.dropR * z, q = Math.min(1, k * 3);
            if (k < 0.25) {
                const fg = c.createRadialGradient(e.x, e.y, 0, e.x, e.y, rr * 1.2);
                fg.addColorStop(0, "rgba(255,255,255," + (1 - k * 4).toFixed(3) + ")"); fg.addColorStop(0.4, "rgba(150,210,255," + (0.6 * (1 - k * 4)).toFixed(3) + ")"); fg.addColorStop(1, "rgba(60,120,255,0)");
                c.fillStyle = fg; c.beginPath(); c.arc(e.x, e.y, rr * 1.2, 0, Math.PI * 2); c.fill();
            }
            c.strokeStyle = "rgba(235,248,255," + (1 - q).toFixed(3) + ")"; c.lineWidth = 7 * (1 - q) + 1;
            c.beginPath(); c.arc(e.x, e.y, rr * q, 0, Math.PI * 2); c.stroke();
            c.strokeStyle = "rgba(200,235,255," + (0.9 * (1 - q)).toFixed(3) + ")"; c.lineWidth = 3 * (1 - q) + 0.5;
            const fl = rr * (0.5 + 0.9 * q);
            c.beginPath(); c.moveTo(e.x - fl, e.y); c.lineTo(e.x + fl, e.y); c.moveTo(e.x, e.y - fl * 0.5); c.lineTo(e.x, e.y + fl * 0.5); c.stroke();
        }
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
        const hs = b.ally ? 0.95 : 0.62;
        c.save(); c.scale(hs, hs);
        gfCrewHull(c, b.crew || gfCrewId, 1.2 / k / hs, b.flash > 0);   // the leader's look, smaller; an ally wears its own
        c.restore();
        c.restore();
        // Hull pips when hurt.
        const mh = b.maxHp || GF.fleetHp;
        if (b.gfHp < mh) {
            c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(p.x - 8, p.y + 10 * k, 16, 3);
            c.fillStyle = b.gfHp > mh * 0.4 ? "#7DF9FF" : "#FF2E88"; c.fillRect(p.x - 8, p.y + 10 * k, 16 * Math.max(0, b.gfHp / mh), 3);
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
        ["Sealed", gfOrifices.length - gfOrificesLeft(), GF_SCORE.orifice],
        ["Aircrab, clean", gfKills.crab, GF_SCORE.crab],
        ["Airkrill, clean", gfKills.krill, GF_SCORE.krill],
        ["Bellwether, clean", gfKills.bell, GF_SCORE.bell],
        ["Burst", gfKills.burst, GF_SCORE.burst]
    ];
    if (won) {
        p.push(["Ships", gfRound.ships, GF_SCORE.ship]);
        p.push(["Wing", gfWingAlive(), GF_SCORE.bot]);
        p.push(["Time", Math.floor(Math.max(0, GF.clock - gfRound.t)), GF_SCORE.second]);
    }
    return p;
}
function gfScore() {
    let t = 0;
    gfScoreParts().forEach(function (r) { t += r[1] * r[2]; });
    return t;
}

// ---- drawing: the game sidebar (screen space, from gfDrawOverlay) ----
// Replaces the engine's parameter panel (Ry, 2026-11-15). Simplified after
// the first playtest: no sentences, one row per thing. Clock and score, the
// three orifices, hull, the siphon capacitor with its two spends, the wing
// with its order, and the two maps.
const GF_SIDE_W = 220;

function gfBar(c, x, y, w, h, k, col) {
    c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(x - 1, y - 1, w + 2, h + 2);
    c.fillStyle = col; c.fillRect(x, y, w * Math.max(0, Math.min(1, k)), h);
    c.strokeStyle = "rgba(201,255,233,0.45)"; c.lineWidth = 1; c.strokeRect(x - 0.5, y - 0.5, w + 1, h + 1);
}
// A key cap: lit when the key would do something right now.
function gfKeyCap(c, x, y, key, on, col) {
    c.fillStyle = on ? col : "rgba(255,255,255,0.06)"; c.fillRect(x, y, 18, 18);
    c.strokeStyle = on ? col : "rgba(255,255,255,0.25)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, 17, 17);
    c.font = "bold 12px monospace"; c.textAlign = "center"; c.fillStyle = on ? "#001014" : "rgba(255,255,255,0.4)";
    c.fillText(key, x + 9, y + 13);
}

function gfDrawSidebar(c) {
    const X0 = glW - GF_SIDE_W, x = X0 + 14, W = GF_SIDE_W - 28;
    c.fillStyle = "rgba(2,6,10,0.82)"; c.fillRect(X0, 0, GF_SIDE_W, glH);
    c.fillStyle = "rgba(125,249,255,0.25)"; c.fillRect(X0, 0, 1, glH);
    let y = 30;

    // Clock and score.
    const left = Math.max(0, GF.clock - gfRound.t), mm = Math.floor(left / 60), ss = Math.floor(left % 60);
    c.font = "32px 'VT323', monospace"; c.textAlign = "left";
    c.fillStyle = left < 60 ? "#FF2E88" : "#E8FFF4";
    c.fillText(mm + ":" + (ss < 10 ? "0" : "") + ss, x, y);
    c.textAlign = "right"; c.fillStyle = "#FFE45C";
    c.fillText(String(gfScore()), x + W, y);
    y += 30;

    // The route: a group of mouths per site, in the order you meet them.
    // Each mouth is ringed by what it has left. The Tide's are barred until
    // both satellites are freed.
    {
        const gap = 12, n = gfOrifices.length, step = (W - gap * (gfSites.length - 1)) / n;
        let ox = x + step / 2;
        const here = gfSiteHere();
        for (let si = 0; si < gfSites.length; si++) {
            const st = gfSites[si];
            if (st === here) { c.fillStyle = "rgba(255,255,255,0.08)"; c.fillRect(ox - step / 2 - 2, y - 12, step * st.orifices.length + 4, 32); }
            for (let i = 0; i < st.orifices.length; i++, ox += step) {
                const o = st.orifices[i], hot = !o.sealed && !o.clamped && o.state !== "closed", oy = y + 4, r = Math.min(8, step * 0.3);
                if (o.sealed) {
                    c.strokeStyle = "rgba(125,255,156,0.6)"; c.lineWidth = 2;
                    c.beginPath(); c.moveTo(ox - 5, oy - 5); c.lineTo(ox + 5, oy + 5); c.moveTo(ox + 5, oy - 5); c.lineTo(ox - 5, oy + 5); c.stroke();
                    continue;
                }
                c.fillStyle = o.clamped ? "rgba(120,120,120,0.3)" : (hot ? "rgba(255,228,92,0.45)" : "rgba(194,51,90,0.4)");
                c.beginPath(); c.arc(ox, oy, r, 0, Math.PI * 2); c.fill();
                c.fillStyle = "#1a0008"; c.beginPath(); c.arc(ox, oy, hot ? r * 0.55 : 1.5, 0, Math.PI * 2); c.fill();
                c.strokeStyle = "rgba(255,255,255,0.12)"; c.lineWidth = 2.5;
                c.beginPath(); c.arc(ox, oy, r + 4, 0, Math.PI * 2); c.stroke();
                c.strokeStyle = o.clamped ? "#8A8A8A" : (hot ? "#FFE45C" : "#FF7A9C");
                c.beginPath(); c.arc(ox, oy, r + 4, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0, o.hp / st.oriHp)); c.stroke();
                if (o.clamped) { c.strokeStyle = "#E8D8C0"; c.lineWidth = 2; c.beginPath(); c.moveTo(ox - r - 3, oy); c.lineTo(ox + r + 3, oy); c.stroke(); }
            }
            ox += gap;
        }
    }
    y += 40;

    // Hull, with the ships left as pips.
    const hfrac = gfHull / GF.hull;
    const hcol = hfrac > 0.6 ? "#7DF9FF" : (hfrac > 0.25 ? "#FFB000" : "#FF2E88");
    c.font = "11px monospace"; c.textAlign = "left"; c.fillStyle = gfCrew().col; c.fillText(gfCrew().name + (gfCrewSt.god ? "  no dmg" : ""), x, y);
    c.textAlign = "right"; c.fillStyle = "#cfe9e6";
    let ships = "";
    for (let i = 0; i < GF.ships; i++) ships += i < gfRound.ships ? "▲" : "△";
    c.fillText(ships, x + W, y);
    gfBar(c, x, y + 6, W, 10, gfHull / GF.hull, hcol);
    y += 40;

    // Siphon capacitor: leaks, so it drains by itself. A notch per bot call.
    const leaking = gfCap.sinceGain > GF_WING.leakAfter && gfCap.charge > 0;
    c.font = "11px monospace"; c.textAlign = "left"; c.fillStyle = leaking ? "#FFB000" : "#6d8582";
    c.fillText(leaking ? "SIPHON  leaking" : "SIPHON", x, y);
    const ccol = gfCap.deny > 0 ? "#FF2E88" : (gfCap.flash > 0 ? "#FFFFFF" : (leaking ? "#4FAE6A" : "#7DFF9C"));
    gfBar(c, x, y + 6, W, 12, gfCap.charge / GF_WING.cap, ccol);
    c.fillStyle = "rgba(0,0,0,0.8)";
    for (let i = 1; i * GF_WING.callCost < GF_WING.cap; i++) c.fillRect(x + W * i * GF_WING.callCost / GF_WING.cap, y + 6, 1.5, 12);
    y += 26;
    const canCall = gfCap.charge >= GF_WING.callCost && gfWingAlive() < GF_WING.max;
    const canMend = gfCrewAbilityReady();
    gfKeyCap(c, x, y, "J", canCall, "#7DFF9C");
    c.font = "11px monospace"; c.textAlign = "left"; c.fillStyle = canCall ? "#cfe9e6" : "#4a5f5c"; c.fillText("bot", x + 24, y + 13);
    gfKeyCap(c, x + W / 2, y, "K", canMend, gfCrew().col);
    c.textAlign = "left"; c.font = "11px monospace"; c.fillStyle = canMend ? "#cfe9e6" : "#4a5f5c"; c.fillText(gfCrew().abil.toLowerCase(), x + W / 2 + 24, y + 13);
    y += 42;

    // The wing: a pip per slot (its hull as the fill), and the order.
    const hunt = gfWingOrder === "hunt", wcol = hunt ? "#FFB000" : "#7DF9FF";
    c.font = "11px monospace"; c.textAlign = "left"; c.fillStyle = "#6d8582"; c.fillText("WING", x, y);
    const wingOnly = gfWing.filter(function (q) { return !q.ally; });
    for (let i = 0; i < GF_WING.max; i++) {
        const b = wingOnly[i], px = x + 44 + i * 26, on = b && b.isAlive;
        c.strokeStyle = on ? (b.gfGrab ? "#FF2E88" : wcol) : "rgba(255,255,255,0.2)"; c.lineWidth = 1;
        c.strokeRect(px + 0.5, y - 10.5, 19, 11);
        if (on) {
            c.fillStyle = b.warp ? "rgba(125,249,255,0.3)" : (b.gfHp > GF.fleetHp * 0.4 ? wcol : "#FF2E88");
            c.fillRect(px + 2, y - 9, 16 * Math.max(0, b.gfHp / GF.fleetHp), 8);
        }
    }
    y += 12;
    gfKeyCap(c, x, y, "H", true, wcol);
    const bw = (W - 30) / 2;
    [["FOLLOW", !hunt, "#7DF9FF"], ["HUNT", hunt, "#FFB000"]].forEach(function (o, i) {
        const bx = x + 26 + i * (bw + 4);
        c.fillStyle = o[1] ? o[2] : "rgba(255,255,255,0.04)"; c.fillRect(bx, y, bw, 18);
        c.strokeStyle = o[1] ? o[2] : "rgba(255,255,255,0.2)"; c.lineWidth = 1; c.strokeRect(bx + 0.5, y + 0.5, bw - 1, 17);
        c.font = "bold 11px monospace"; c.textAlign = "center"; c.fillStyle = o[1] ? "#001014" : "rgba(255,255,255,0.45)";
        c.fillText(o[0], bx + bw / 2, y + 13);
    });
    y += 36;

    // Maps: SITE (round you) and ORBIT (the whole theatre), in what room is left.
    const orbitH = 54, siteS = Math.max(0, Math.min(W, glH - y - orbitH - 26));
    if (siteS >= 80) { gfDrawSiteMap(c, x + (W - siteS) / 2, y, siteS); y += siteS + 10; }
    if (glH - y > orbitH + 8) gfDrawOrbitMap(c, x, y, W, orbitH);
}

let gfMapR = 420;   // the radar's current reach in units (it eases toward what it needs to show)
// SITE: a radar round the lead ship. North is up, same as the screen.
function gfDrawSiteMap(c, x, y, S) {
    // True to scale, always (Ry, 2026-11-16: the maps felt "diagramatic and not
    // true to scale"). The range changes instead: inside a battle it fits the
    // whole battle line; in open space it reaches out to the nearest site, so
    // distance is something you can read. The ring is labelled with its radius.
    const s = glShip;
    let want = 420;
    const zone = gfInZone(s.x, s.y);
    if (zone) want = Math.max(420, Math.hypot(zone.x - s.x, zone.y - s.y) + gfZoneR(zone) * 0.35);
    else {
        let nd = Infinity;
        for (let i = 0; i < gfSites.length; i++) nd = Math.min(nd, Math.hypot(gfSites[i].x - s.x, gfSites[i].y - s.y) + gfZoneR(gfSites[i]) * 0.5);
        nd = Math.min(nd, Math.hypot(gfHome.x - s.x, gfHome.y - s.y) + 300);
        want = Math.max(420, nd * 1.08);
    }
    gfMapR = Math.exp(Math.log(gfMapR) + (Math.log(want) - Math.log(gfMapR)) * 0.06);
    const R = gfMapR, k = S / 2 / R, cx = x + S / 2, cy = y + S / 2;
    c.save();
    c.fillStyle = "rgba(0,0,0,0.7)"; c.fillRect(x, y, S, S);
    c.strokeStyle = "rgba(125,249,255,0.35)"; c.lineWidth = 1; c.strokeRect(x + 0.5, y + 0.5, S - 1, S - 1);
    c.beginPath(); c.rect(x, y, S, S); c.clip();
    function P(wx, wy) { return { x: cx + (wx - s.x) * k, y: cy + (wy - s.y) * k }; }
    // One range ring at half the map's reach, with its radius in units.
    c.strokeStyle = "rgba(125,249,255,0.12)";
    c.beginPath(); c.arc(cx, cy, S / 4, 0, Math.PI * 2); c.stroke();
    const half = R / 2;
    c.font = "9px monospace"; c.textAlign = "left"; c.fillStyle = "rgba(125,249,255,0.5)";
    c.fillText(half >= 1000 ? (half / 1000).toFixed(1) + "k" : String(Math.round(half / 10) * 10), cx + S / 4 + 3, cy - 2);
    // Where the nose of a jump would go: the aim line.
    if (s.isAlive) {
        const aa = gfAimAngle();
        c.strokeStyle = gfFlight.inCombat ? "rgba(255,255,255,0.08)" : "rgba(125,249,255,0.3)"; c.setLineDash([3, 4]);
        c.beginPath(); c.moveTo(cx, cy); c.lineTo(cx + Math.cos(aa) * S, cy + Math.sin(aa) * S); c.stroke(); c.setLineDash([]);
    }
    // The sites, their battle lines, and their orifices.
    for (let i = 0; i < gfSites.length; i++) {
        const st = gfSites[i], t = P(st.x, st.y), zr = gfZoneR(st) * k;
        if (Math.abs(t.x - cx) > S + zr || Math.abs(t.y - cy) > S + zr) continue;
        c.strokeStyle = st.cleared ? "rgba(125,249,255,0.25)" : "rgba(125,249,255,0.7)"; c.setLineDash([4, 3]);
        c.beginPath(); c.arc(t.x, t.y, Math.max(3, zr), 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
        c.fillStyle = st.cleared ? "rgba(20,70,80,0.8)" : (st.dead ? "rgba(70,30,40,0.8)" : "rgba(150,30,60,0.75)"); c.strokeStyle = st.cleared ? "#7DF9FF" : "#C2335A";
        c.beginPath(); c.arc(t.x, t.y, Math.max(1.5, st.r * k), 0, Math.PI * 2); c.fill(); c.stroke();
    }
    for (let i = 0; i < gfOrifices.length; i++) {
        const o = gfOrifices[i], w = gfOrificePos(o), p = P(w.x, w.y);
        if (!o.site.awake || o.clamped || R > 900) continue;
        if (o.sealed) { c.fillStyle = "#3a1018"; c.fillRect(p.x - 2, p.y - 2, 4, 4); continue; }
        const hot = o.state !== "closed";
        c.fillStyle = hot ? "#FFE45C" : "#FF7A9C";
        c.beginPath(); c.arc(p.x, p.y, hot ? 4 + Math.sin(gfTime * 10) : 3, 0, Math.PI * 2); c.fill();
    }
    // Creatures, motes, wing.
    for (let i = 0; i < gfCreatures.length && R < 2500; i++) {
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
    // The drive lamp: lit outside a battle line, dark inside one.
    const ok = !gfFlight.inCombat;
    c.font = "bold 10px monospace"; c.textAlign = "left";
    c.fillStyle = ok ? "#7DF9FF" : "rgba(255,255,255,0.3)";
    c.fillRect(x + 6, y + 7, 6, 6);
    c.fillText(ok ? "DRIVE" : "DRIVE LOCKED", x + 16, y + 13);
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
    // The route to scale: the straight lane, and each site where it really is.
    c.setLineDash([2, 4]); c.strokeStyle = "rgba(125,249,255,0.3)";
    c.beginPath(); c.moveTo(x + pad, my); c.lineTo(x + W - pad, my); c.stroke(); c.setLineDash([]);
    c.strokeStyle = "#7DF9FF"; c.strokeRect(x + pad - 3, my - 3, 6, 6);
    // Scale bar: 5,000 units.
    c.strokeStyle = "rgba(125,249,255,0.5)"; c.beginPath(); c.moveTo(x + 6, y + H - 5); c.lineTo(x + 6 + 5000 * k, y + H - 5); c.stroke();
    c.font = "8px monospace"; c.textAlign = "left"; c.fillStyle = "rgba(125,249,255,0.5)"; c.fillText("5k", x + 9 + 5000 * k, y + H - 3);

    // The stops: true position, the battle line to scale, the body a dot at its centre.
    const next = gfNextSite();
    for (let i = 0; i < gfSites.length; i++) {
        const st = gfSites[i], q = P(st.x, st.y);
        const col = st.cleared ? "#7DF9FF" : (st.dead ? "#5a2030" : "#FF3B5E");
        if (st === next && !gfRoundOver()) {
            c.strokeStyle = "rgba(255,228,92," + (0.5 + 0.5 * Math.sin(gfTime * 6)).toFixed(2) + ")"; c.lineWidth = 1.5;
            c.beginPath(); c.arc(q.x, q.y, 9, 0, Math.PI * 2); c.stroke();
        }
        c.strokeStyle = col; c.lineWidth = 1;
        c.beginPath(); c.arc(q.x, q.y, Math.max(3, gfZoneR(st) * k), 0, Math.PI * 2); c.stroke();
        c.fillStyle = col;
        if (st.kind === "tide") { c.beginPath(); c.arc(q.x, q.y, 2, 0, Math.PI * 2); c.fill(); }
        else c.fillRect(q.x - 1.5, q.y - 1.5, 3, 3);
    }
    if (s.isAlive) {
        // You, and the line your aim would jump along.
        const p = P(s.x, s.y), aa = gfAimAngle(), da = Math.atan2(-Math.cos(aa) * uy + Math.sin(aa) * ux, Math.cos(aa) * ux + Math.sin(aa) * uy);
        if (!gfFlight.inCombat) {
            c.strokeStyle = "rgba(125,249,255,0.35)"; c.setLineDash([2, 3]);
            c.beginPath(); c.moveTo(p.x, p.y); c.lineTo(p.x + Math.cos(da) * W, p.y + Math.sin(da) * W); c.stroke(); c.setLineDash([]);
        }
        c.fillStyle = "#FFFFFF";
        c.beginPath(); c.moveTo(p.x + Math.cos(da) * 5, p.y + Math.sin(da) * 5);
        c.lineTo(p.x + Math.cos(da + 2.5) * 4, p.y + Math.sin(da + 2.5) * 4); c.lineTo(p.x + Math.cos(da - 2.5) * 4, p.y + Math.sin(da - 2.5) * 4); c.closePath(); c.fill();
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
    // The breath gauge: where the site's breath is, as it reaches you. The
    // long green stretch is the soft window (shoot); the red is the held,
    // armoured breath (hold fire, flank); the amber joins are vents open.
    if (gfBreathNow >= 0 && !gfRoundOver()) {
        const bw = 280, bx = mid - bw / 2, by = glH - 46, bh = 8, P = GF_PH;
        c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(bx - 2, by - 2, bw + 4, bh + 4);
        const seg = function (a, b, col) { c.fillStyle = col; c.fillRect(bx + bw * a, by, bw * (b - a) - 1, bh); };
        const soft = gfBreathNow >= P.exhale;
        seg(0, P.inhale, "rgba(255,176,0,0.55)"); seg(P.inhale, P.hold, "rgba(255,46,80,0.6)");
        seg(P.hold, P.exhale, "rgba(255,176,0,0.55)"); seg(P.exhale, 1, soft ? "#7DFF9C" : "rgba(125,255,156,0.4)");
        const nx = bx + bw * gfBreathNow;
        c.fillStyle = "#FFFFFF"; c.fillRect(nx - 1.5, by - 5, 3, bh + 10);
    }
    // Your own ricochet came back: a hard red frame for half a second.
    if (gfRicoFlash > 0 && !gfRoundOver()) {
        c.strokeStyle = "rgba(255,40,40," + Math.min(1, gfRicoFlash * 2).toFixed(3) + ")"; c.lineWidth = 14;
        c.strokeRect(7, 7, glW - GF_SIDE_W - 14, glH - 14);
    }
    // Keys, for the first half minute only.
    if (gfRound.t < 30 && !gfRoundOver()) {
        c.globalAlpha = Math.min(1, (30 - gfRound.t) / 3) * 0.75;
        c.font = "13px monospace"; c.fillStyle = "#cfe9e6";
        c.fillText("WASD move  ·  mouse aim  ·  hold click fire  ·  right click seeker  ·  SPACE boost, hold to jump  ·  H J K wing", mid, glH - 14);
        c.globalAlpha = 1;
    }
    if (!glShip.isAlive && !gfRoundOver()) {
        c.font = "22px 'VT323', monospace"; c.fillStyle = "#FF2E88";
        c.fillText((glShip.deathMsg || "ship lost").toUpperCase(), mid, glH / 2);
    }

    gfCrewOverlay(c);   // gf-crew.js: ability ring, the ram's impact frame
    // Aftermath: the round is decided and the world plays on for a few
    // seconds under closing bars before the score comes up.
    if (gfRound.after) {
        const k = Math.min(1, (GF_AFTER - gfRound.after.t) / 0.6), bh = glH * 0.09 * k;
        c.fillStyle = "#000"; c.fillRect(0, 0, glW - GF_SIDE_W, bh); c.fillRect(0, glH - bh, glW - GF_SIDE_W, bh);
    }
    // End card: the score readout.
    if (gfRoundOver()) {
        const won = gfRound.phase === "won";
        c.fillStyle = "rgba(0,0,0," + Math.min(0.8, gfRound.endT * 1.2).toFixed(3) + ")";
        c.fillRect(0, 0, glW, glH);
        const parts = gfScoreParts(), cx = glCX;
        let y = Math.max(70, glH / 2 - 190);
        c.font = "64px 'VT323', monospace";
        c.fillStyle = won ? "#7DFF9C" : "#FF2E88";
        c.fillText(won ? "SORTIE COMPLETE" : "SORTIE LOST", cx, y);
        c.font = "22px 'VT323', monospace"; c.fillStyle = "#E8FFF4";
        c.fillText(gfRound.endMsg.toUpperCase(), cx, y + 30);
        const t = gfRound.t, m2 = Math.floor(t / 60), s2 = Math.floor(t % 60);
        c.fillStyle = "#9fb8b4"; c.fillText(m2 + ":" + (s2 < 10 ? "0" : "") + s2, cx, y + 54);
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
        c.fillText("ENTER", cx, y + 50);
    }
    c.restore();
}
