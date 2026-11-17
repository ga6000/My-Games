// ===================================================
//   Gyro Fleet — set pieces: a satellite freed, the beam, the swarm
// ===================================================
// Pass 7 (2026-11-16). Ry: when a satellite's growth is cleared the view
// "flips to the satellite", the growth explodes off it, its lights "flick
// green and on", and it turns and puts "a green laser sight on the hive".
// When both are free and the hive is weakened, "the mothership channels a
// laser beam connecting through the two satellites in a sweeping animation
// that is smooth and intentional-looking. This explodes the hive, releasing
// thousands of airkrill, which then need to be wiped out by the player, but
// then this becomes the end of the game."
//
//   SAT   (4.2 s)  cut to the satellite; the growth swells and bursts (its
//                  brood dies with it); lights stutter on, green; it swings
//                  round to face the hive; the sight snaps on and stays.
//   BEAM  (9.7 s)  a route board: the beam leaves the mothership and sweeps
//                  relay, drydock, hive, one eased leg after another. Cut to
//                  the hive: the beam walks across it, leaving a burning
//                  scar. It bursts, and nothing is left of it; the sights go
//                  out. That is the end of the game: the view holds on the
//                  empty space through the aftermath, then the score.
//   (SWARM, switched off 2026-11-16 at Ry's call: the burst used to release
//   GF_CINE.swarm airkrill as a last fight. gfSwarm* is kept but never started.)
//
// While a set piece plays the lead ship cannot be hurt and the clock stops.
// The view is borrowed (gfCineCam) and handed back at the end.
"use strict";

const GF_CINE = { satT: 4.2, beamT: 9.7, swarm: 450, swarmAlive: 90, swarmClock: 75 };
let gfCine = null;                 // { type, st, t, ... } while a set piece plays
const gfCineBits = [];             // flesh thrown by a burst: { x, y, vx, vy, t, life, r, col }
const gfSwarm = { left: 0, total: 0, on: false };

function gfCineOn() { return !!gfCine; }
function gfCineEase(a, b, t) { const k = Math.max(0, Math.min(1, (t - a) / (b - a))); return k * k * (3 - 2 * k); }

function gfCineSat(st) {
    gfCine = { type: "sat", st: st, t: 0, burst: false, flick: 0, sighted: false };
    st.rot0 = st.kind === "relay" ? 0.5 : -0.9;
    // Its dish (local -y) is what turns to the hive.
    st.rot1 = st.rot0 + glWrapAngle(Math.atan2(gfHive.y - st.y, gfHive.x - st.x) + Math.PI / 2 - st.rot0);
    gfFireSet(false);
}
function gfCineBeam() {
    gfCine = { type: "beam", st: gfHive, t: 0, burst: false, legs: 0 };
    gfFireSet(false);
}

function gfCineFlesh(st, n, speed) {
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, rr = st.r0 * Math.sqrt(Math.random()), sp = speed * (0.25 + Math.random());
        gfCineBits.push({ x: st.x + Math.cos(a) * rr, y: st.y + Math.sin(a) * rr, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, t: 0,
                          life: 1.2 + Math.random() * 1.6, r: st.r0 * (0.03 + Math.random() * 0.09), col: Math.random() < 0.3 ? "#FFB4C6" : (Math.random() < 0.5 ? "#C2335A" : "#6A1028") });
    }
}

// ---- per-frame (from the top of gfUpdate) ----
function gfCineUpdate(dt) {
    for (let i = gfCineBits.length - 1; i >= 0; i--) {
        const b = gfCineBits[i];
        b.t += dt; b.x += b.vx * dt; b.y += b.vy * dt; b.vx *= 1 - Math.min(1, dt * 0.8); b.vy *= 1 - Math.min(1, dt * 0.8);
        if (b.t > b.life) gfCineBits.splice(i, 1);
    }
    const ci = gfCine;
    if (!ci) return;
    const p = ci.t; ci.t += dt;
    const st = ci.st, crossed = function (x) { return p < x && ci.t >= x; };
    if (ci.type === "sat") {
        if (crossed(0.35)) gfSfx("crush", 1);
        if (crossed(0.95)) {
            // The growth goes, and everything it birthed goes with it.
            st.shed = true;
            gfCineFlesh(st, 110, 90);
            gfBlasts.push({ x: st.x, y: st.y, r: st.r0 * 2.6, t: 0 });
            glSpawnBurst(st.x, st.y, 90, "#FF7A9C");
            for (let i = 0; i < gfCreatures.length; i++) if (gfCreatures[i].ori.site === st) { gfCreatures[i].hp = 0; gfCreatures[i].burst = true; }
            gfSfx("rupture", 1); glUltraShakeKick = Math.max(glUltraShakeKick, 0.8);
        }
        // Lights: on, off, on, off, on.
        [1.55, 1.75, 1.92].forEach(function (x) { if (crossed(x)) { st.lit = true; gfSfx("ping", 0.6); } });
        [1.65, 1.84].forEach(function (x) { if (crossed(x)) st.lit = false; });
        if (crossed(2.15)) gfSfx("servo");
        st.rot = st.rot0 + (st.rot1 - st.rot0) * gfCineEase(2.15, 2.95, ci.t);
        if (crossed(3.05)) { st.sight = gfTime; gfSfx("sight"); }
        if (ci.t >= GF_CINE.satT) { st.rot = st.rot1; st.lit = true; if (!st.sight) st.sight = gfTime; gfCine = null; }
    } else {
        if (crossed(0.05)) gfSfx("charge");
        [0.6, 1.4, 2.2].forEach(function (x, i) { if (crossed(x)) gfSfx("leg", i / 2); });   // each leg sounds as it leaves, lands as it arrives
        [1.3, 2.1, 2.9].forEach(function (x, i) { if (crossed(x)) ci.legs = i + 1; });
        if (crossed(3.55)) gfSfx("sight");
        if (ci.t > 3.7 && ci.t < 6.3) {
            const q = (ci.t - 3.7) / 2.6;
            glUltraShakeKick = Math.max(glUltraShakeKick, 0.12 + 0.3 * q);
            gfSfx("slice", q);                                   // gfSfxOk spaces it into a steady burn
        }
        if (crossed(6.3)) gfCineHiveBurst();
        if (ci.t >= GF_CINE.beamT) gfCine = null;
    }
}

// The hive goes, all of it, and that is the end of the game: nothing is left
// of it, the satellites' sights go out, and after the aftermath beat the score
// comes up. (Ry, 2026-11-16, after seeing the swarm ending: "remove the hive
// after it's killed, and remove the lasers after that point. I'd say we scrap
// the air krill after. the game should just end at that point". The swarm
// code below is kept, switched off, in case it comes back.)
function gfCineHiveBurst() {
    const st = gfHive;
    gfCine.burst = true;
    gfCine.R0 = st.r0;
    gfCineFlesh(st, 520, 300);
    gfBlasts.push({ x: st.x, y: st.y, r: st.r0 * 2.4, t: 0 });
    glSpawnBurst(st.x, st.y, 240, "#FF7A9C");
    for (let i = 0; i < gfCreatures.length; i++) { gfCreatures[i].hp = 0; gfCreatures[i].burst = true; }
    st.dead = true; st.cleared = true; st.gone = true; st.r0 = 0; st.r = 0;
    for (let i = 0; i < gfSites.length; i++) gfSites[i].sight = 0;
    gfSfx("hiveburst");
    glUltraShakeKick = 1;
    gfEndRound("won", "the tide is gone");
}
// Feed the swarm out of the husk (from gfUpdate, while it lasts).
function gfSwarmUpdate(dt) {
    if (!gfSwarm.on || gfSwarm.left <= 0) return;
    const st = gfHive, o = st.orifices[0];
    let room = GF_CINE.swarmAlive - gfCreatures.length, n = Math.min(room, gfSwarm.left, Math.ceil(dt * 90));
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI * 2, sp = 30 + Math.random() * 70;
        const c = gfMakeCreature("krill", st.x + Math.cos(a) * (st.r0 + 2), st.y + Math.sin(a) * (st.r0 + 2), o);
        c.vx = Math.cos(a) * sp; c.vy = Math.sin(a) * sp; c.face = a;
        c.free = true; c.frenzy = 9999; c.birthT = 0.35;
        gfSwarm.left--;
    }
}
function gfSwarmLeft() { return gfSwarm.left + (gfSwarm.on ? gfCreatures.length : 0); }

// ---- the view, borrowed (from the end of gfViewFrame) ----
function gfCineCam(cam) {
    const ci = gfCine;
    if (!ci) return;
    const end = ci.type === "sat" ? GF_CINE.satT : GF_CINE.beamT;
    const from = ci.type === "sat" ? 0 : 3.3;
    const w = Math.min(gfCineEase(from, from + 0.45, ci.t), 1 - gfCineEase(end - 0.45, end, ci.t));
    if (w <= 0) return;
    const R = ci.type === "sat" ? ci.st.r0 * 4.2 : (ci.burst ? 330 : 250);
    cam.x += (ci.st.x - cam.x) * w; cam.y += (ci.st.y - cam.y) * w;
    const target = Math.min(glW - 220, glH) / 2 / R;
    cam.zoom = Math.exp(glLerp(Math.log(cam.zoom), Math.log(target), 0.14 * w));
}

// ---- drawing: world (from gfDrawWorld) ----
function gfCineLine(c, ax, ay, bx, by, w, col) {
    const a = glWorldToScreenRaw(ax, ay), b = glWorldToScreenRaw(bx, by);
    const seg = glUltraClip(a.x, a.y, b.x, b.y, -50, -50, glW + 50, glH + 50);
    if (!seg) return;
    c.strokeStyle = col; c.lineWidth = w;
    c.beginPath(); c.moveTo(seg[0], seg[1]); c.lineTo(seg[2], seg[3]); c.stroke();
}
function gfCineDrawWorld(c, z) {
    c.save();
    c.lineCap = "round";
    // The sights: a thin green line from each freed satellite to the hive.
    for (let i = 0; i < gfSites.length; i++) {
        const st = gfSites[i];
        if (!st.sight || st.kind === "tide") continue;
        const grow = Math.min(1, (gfTime - st.sight) / 0.35), a = Math.atan2(gfHive.y - st.y, gfHive.x - st.x);
        const L = Math.hypot(gfHive.x - st.x, gfHive.y - st.y) - gfHive.r, ex = st.x + Math.cos(a) * L * grow, ey = st.y + Math.sin(a) * L * grow;
        const sx = st.x + Math.cos(a) * st.r0 * 1.9, sy = st.y + Math.sin(a) * st.r0 * 1.9;
        gfCineLine(c, sx, sy, ex, ey, 5, "rgba(125,255,156,0.18)");
        gfCineLine(c, sx, sy, ex, ey, 1.4, "rgba(170,255,190," + (0.75 + 0.2 * Math.sin(gfTime * 30)).toFixed(2) + ")");
        if (grow >= 1) {
            const e = glWorldToScreenRaw(ex, ey);
            if (gfOnScreen(e, 20)) { c.fillStyle = "#B8FFCB"; c.beginPath(); c.arc(e.x, e.y, 3 + Math.sin(gfTime * 12), 0, Math.PI * 2); c.fill(); }
        }
    }
    // The beam on the hive: in from the drydock, walking across the body.
    const ci = gfCine;
    if (ci && ci.type === "beam" && ci.t > 3.5 && ci.t < 6.9) {
        const st = gfHive, dock = gfSites[1] || gfSites[0];
        const ia = Math.atan2(st.y - dock.y, st.x - dock.x), na = ia + Math.PI / 2;
        const sweep = gfCineEase(3.9, 6.2, ci.t) * 2 - 1, R0 = ci.burst ? ci.R0 : st.r0;
        const hx = st.x + Math.cos(na) * sweep * R0 * 0.8, hy = st.y + Math.sin(na) * sweep * R0 * 0.8;
        const on = gfCineEase(3.5, 3.9, ci.t) * (1 - gfCineEase(6.35, 6.9, ci.t)), fl = 0.85 + 0.15 * Math.sin(gfTime * 60);
        // The scar it has cut so far.
        if (!ci.burst) {
            const s0x = st.x - Math.cos(na) * R0 * 0.8, s0y = st.y - Math.sin(na) * R0 * 0.8;
            gfCineLine(c, s0x, s0y, hx, hy, 0.09 * R0 * z, "rgba(255,120,40,0.55)");
            gfCineLine(c, s0x, s0y, hx, hy, 0.03 * R0 * z, "rgba(255,250,200,0.9)");
        }
        const fx = hx - Math.cos(ia) * 4000, fy = hy - Math.sin(ia) * 4000;
        c.globalCompositeOperation = "lighter";
        gfCineLine(c, fx, fy, hx, hy, 46 * on * fl, "rgba(60,255,120,0.18)");
        gfCineLine(c, fx, fy, hx, hy, 20 * on * fl, "rgba(140,255,170,0.5)");
        gfCineLine(c, fx, fy, hx, hy, 7 * on, "rgba(240,255,245,0.95)");
        const h = glWorldToScreenRaw(hx, hy);
        const g = c.createRadialGradient(h.x, h.y, 0, h.x, h.y, 90 * on + 1);
        g.addColorStop(0, "rgba(255,255,255," + on.toFixed(2) + ")"); g.addColorStop(0.3, "rgba(170,255,190," + (0.7 * on).toFixed(2) + ")"); g.addColorStop(1, "rgba(60,255,120,0)");
        c.fillStyle = g; c.beginPath(); c.arc(h.x, h.y, 90 * on + 1, 0, Math.PI * 2); c.fill();
        c.globalCompositeOperation = "source-over";
    }
    // Thrown flesh.
    for (let i = 0; i < gfCineBits.length; i++) {
        const b = gfCineBits[i], p = glWorldToScreenRaw(b.x, b.y);
        if (!gfOnScreen(p, 30)) continue;
        c.globalAlpha = Math.min(1, (b.life - b.t) * 1.5); c.fillStyle = b.col;
        c.beginPath(); c.arc(p.x, p.y, Math.max(1.2, b.r * z), 0, Math.PI * 2); c.fill();
    }
    c.globalAlpha = 1;
    c.restore();
}

// ---- drawing: overlay (from gfDrawHud) ----
function gfCineOverlay(c) {
    const W = glW - 220, ci = gfCine;
    // The swarm that is left, while it lasts.
    if (gfSwarm.on && !gfRoundOver() && !ci) {
        const k = gfSwarmLeft() / gfSwarm.total, bw = 320, bx = W / 2 - bw / 2;
        c.fillStyle = "rgba(0,0,0,0.6)"; c.fillRect(bx - 2, 20, bw + 4, 10);
        c.fillStyle = "#C9A2FF"; c.fillRect(bx, 22, bw * Math.max(0, Math.min(1, k)), 6);
    }
    if (!ci) return;
    const end = ci.type === "sat" ? GF_CINE.satT : GF_CINE.beamT;
    const bars = Math.min(gfCineEase(0, 0.4, ci.t), 1 - gfCineEase(end - 0.4, end, ci.t)) * glH * 0.1;
    c.save();
    c.fillStyle = "#000"; c.fillRect(0, 0, W, bars); c.fillRect(0, glH - bars, W, bars);
    if (ci.type === "beam") {
        // The route board: everything where it really is, and the beam
        // taking it one leg at a time.
        const a = Math.min(gfCineEase(0, 0.5, ci.t), 1 - gfCineEase(3.2, 3.7, ci.t));
        if (a > 0) {
            c.globalAlpha = a;
            c.fillStyle = "rgba(1,6,8,0.94)"; c.fillRect(0, bars, W, glH - bars * 2);
            const ax = gfHive.x - gfHome.x, ay = gfHive.y - gfHome.y, L = Math.hypot(ax, ay) || 1, ux = ax / L, uy = ay / L;
            const pad = 110, k = (W - pad * 2) / L, my = glH / 2;
            const P = function (o) { const dx = o.x - gfHome.x, dy = o.y - gfHome.y; return { x: pad + (dx * ux + dy * uy) * k, y: my + (-dx * uy + dy * ux) * k * 2.2 }; };
            const pts = [P(gfHome), P(gfSites[0]), P(gfSites[1]), P(gfHive)];
            // Faint grid and the lane.
            c.strokeStyle = "rgba(125,249,255,0.07)"; c.lineWidth = 1;
            for (let x = pad; x <= W - pad + 1; x += (W - pad * 2) / 12) { c.beginPath(); c.moveTo(x, my - 150); c.lineTo(x, my + 150); c.stroke(); }
            c.setLineDash([3, 6]); c.strokeStyle = "rgba(125,249,255,0.25)"; c.beginPath(); c.moveTo(pts[0].x, pts[0].y); c.lineTo(pts[3].x, pts[3].y); c.stroke(); c.setLineDash([]);
            // The beam: three eased legs.
            const legT = [[0.6, 1.3], [1.4, 2.1], [2.2, 2.9]];
            c.lineCap = "round"; c.globalCompositeOperation = "lighter";
            for (let i = 0; i < 3; i++) {
                const s = gfCineEase(legT[i][0], legT[i][1], ci.t);
                if (s <= 0) continue;
                const p0 = pts[i], p1 = pts[i + 1], ex = p0.x + (p1.x - p0.x) * s, ey = p0.y + (p1.y - p0.y) * s;
                [[22, "rgba(60,255,120,0.16)"], [9, "rgba(140,255,170,0.5)"], [3, "rgba(240,255,245,1)"]].forEach(function (q) {
                    c.strokeStyle = q[1]; c.lineWidth = q[0]; c.beginPath(); c.moveTo(p0.x, p0.y); c.lineTo(ex, ey); c.stroke();
                });
                if (s < 1) { c.fillStyle = "#FFFFFF"; c.beginPath(); c.arc(ex, ey, 7, 0, Math.PI * 2); c.fill(); }
            }
            c.globalCompositeOperation = "source-over";
            // The places.
            c.lineWidth = 2;
            c.strokeStyle = "#7DF9FF"; c.fillStyle = "#06222A"; c.beginPath(); c.arc(pts[0].x, pts[0].y, 13, 0, Math.PI * 2); c.fill(); c.stroke();
            c.beginPath(); c.arc(pts[0].x, pts[0].y, 20 + 5 * Math.sin(gfTime * 9), 0, Math.PI * 2); c.stroke();
            for (let i = 1; i <= 2; i++) {
                const hit = ci.legs >= i, q = pts[i];
                c.strokeStyle = "#7DFF9C"; c.fillStyle = hit ? "#B8FFCB" : "#0C3318";
                c.save(); c.translate(q.x, q.y); c.rotate(i === 1 ? 0.5 : -0.9);
                c.fillRect(-16, -2, 32, 4); c.strokeRect(-16, -2, 32, 4); c.fillRect(-5, -5, 10, 10); c.strokeRect(-5, -5, 10, 10);
                c.restore();
                if (hit) { c.beginPath(); c.arc(q.x, q.y, 16 + ((ci.t * 40) % 26), 0, Math.PI * 2); c.globalAlpha = a * 0.5; c.stroke(); c.globalAlpha = a; }
            }
            const hv = pts[3], pulse = ci.legs >= 3 ? 1 + 0.15 * Math.sin(gfTime * 40) : 1;
            c.fillStyle = ci.legs >= 3 ? "#FF9DB4" : "#8A1E3C"; c.strokeStyle = "#FF3B5E";
            c.beginPath(); c.arc(hv.x, hv.y, 24 * pulse, 0, Math.PI * 2); c.fill(); c.stroke();
            c.globalAlpha = 1;
        }
        // The burst: a white frame.
        const fl = 1 - gfCineEase(6.3, 6.9, ci.t);
        if (ci.burst && fl > 0) { c.fillStyle = "rgba(255,255,255," + (0.9 * fl).toFixed(3) + ")"; c.fillRect(0, 0, W, glH); }
    }
    c.restore();
}
