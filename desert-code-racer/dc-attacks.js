// ===================================================
//   Desert Code Racer — the two skill attacks, and Greer's seekers
// ===================================================
// Ry, pass 2: "some additional 1-2 attacks that take some level of skill to
// react to". Both are spawned by the HOST (one answer to when and where),
// and each client judges its own bike against them, like the beams.
//
// THE LASH. A tendril of the Tide rears up beside the road ahead of a rider
// and slams down ACROSS the whole road at the spot the rider will reach just
// as it lands. A shadow line marks the spot and a closing ring counts down.
// Answers: jump it as it lands (timing), or brake or boost so you are not on
// that line when it comes down.
//
// THE STRAFE. The small ship dives and walks a line of cannon fire down one
// lane toward a rider: marks flash on the road ahead of each shot. Answer:
// read the lane and steer out of it before the line reaches you (a jump does
// not help: bullets, not rubble).
//
// Every class answers both with its ability (the matrix): MEND patches the
// hit into a stumble, RIG decoys either onto its beacon, SCAN stuns the
// tendril and jams the ship, FIRE severs the tendril and shoots the ship off
// its run, RAM charges through, SHIELD bounces both.
"use strict";

const DC_LASH_WARN = 1.15;          // s from rearing to slam
const DC_LASH_DOWN = 0.55;          // s the tendril lies across the road
const DC_STRAFE_LEAD = 0.75;        // s from a mark to its shot
const DC_STRAFE_SHOTS = 14;

// ---------------------------------------------------
//   HOST: when, at whom, where
// ---------------------------------------------------
function dcHostAttacks(dt, leg, crowd) {
    const every = (DC_DIFF === "casual" ? [26, 17, 13] : [19, 12.5, 9.5])[leg];
    dc.hostT.atk = (dc.hostT.atk === undefined ? 10 : dc.hostT.atk) - dt;
    if (dc.hostT.atk > 0) return;
    const t = dcHostPick(0.35);
    if (!t || t.home) { dc.hostT.atk = 2; return; }
    const lead = DC_LASH_WARN * Math.max(DC_CRUISE * 0.7, t.v);
    const z0 = t.z + lead;
    // Never in a tunnel, never on top of a set piece (fair, and readable).
    const s0 = Math.floor(z0 / DC_SEG);
    if (dcInTunnel(z0) || dcInTunnel(t.z + 40 * DC_SEG) || dcHazardsIn(s0 - 22, s0 + 22).some(function (h) { return h.type !== "chips" && h.type !== "pad"; })) {
        dc.hostT.atk = 1.5;
        return;
    }
    dc.hostT.atk = every * (0.8 + Math.random() * 0.4) / crowd;
    const lash = leg === 0 ? Math.random() < 0.35 : Math.random() < 0.55;
    if (lash) dcEmit({ k: "ax", a: "lash", id: dc.nextId++, tg: t.id, z: Math.round(z0), sd: Math.random() < 0.5 ? -1 : 1 });
    else dcEmit({ k: "ax", a: "strafe", id: dc.nextId++, tg: t.id, z: Math.round(t.z + 95 * DC_SEG), x: +dcClamp(t.x, -0.8, 0.8).toFixed(3) });
}

// The host's share of a cast: which attacks it ends.
function dcHostAttackAbility(m) {
    const live = dc.attacks.filter(function (a) { return a.st === "live"; });
    const inRange = function (a, lo, hi) { const z = a.kind === "lash" ? a.z : dcStrafeNow(a).z; return z > m.z + lo * DC_SEG && z < m.z + hi * DC_SEG; };
    live.forEach(function (a) {
        let why = "";
        if (m.a === "gunner" && inRange(a, -10, 90)) why = "shot";
        else if (m.a === "scout" && inRange(a, -10, 130)) why = "jam";
        else if (m.a === "engineer" && inRange(a, -10, 90)) why = "decoy";
        if (why) dcEmit({ k: "axx", id: a.id, why: why, by: m.by });
    });
}

// ---------------------------------------------------
//   EVERY CLIENT
// ---------------------------------------------------
function dcOnAttack(m) {
    if (dc.attacks.some(function (a) { return a.id === m.id; })) return;
    const a = { id: m.id, kind: m.a, tg: m.tg, z: m.z, x: m.x || 0, side: m.sd || 1, t0: dc.simT, st: "live", hit: {} };
    dc.attacks.push(a);
    if (dc.demo) return;
    const vol = dcVolAt(a.z);
    if (a.kind === "lash") dcSnd.lashWarn(Math.max(vol, dc.me && a.tg === dc.me.id ? 1 : 0));
    else dcSnd.strafeWarn(Math.max(vol, dc.me && a.tg === dc.me.id ? 1 : 0.4));
}

function dcOnAttackGone(m) {
    const a = dc.attacks.find(function (q) { return q.id === m.id; });
    if (!a || a.st !== "live") return;
    a.st = "gone"; a.goneT = dc.simT; a.why = m.why;
    const z = a.kind === "lash" ? a.z : dcStrafeNow(a).z;
    dcBurstAir(z, a.kind === "lash" ? a.side * 1.3 : a.x, m.why === "jam" ? DC_COL.cyan : DC_COL.amber);
    if (!dc.demo) dcSnd.beamDowned(dcVolAt(z));
    const labels = { shot: a.kind === "lash" ? "SEVERED" : "SHOT DOWN", jam: a.kind === "lash" ? "STUNNED" : "JAMMED", decoy: "DECOYED" };
    if (dc.me && m.by === dc.me.id) dcCredit(200, "solves", 1, labels[m.why] || "");
}

// Where a strafe's line of fire is now.
function dcStrafeNow(a) {
    const k = dcClamp((dc.simT - a.t0 - DC_STRAFE_LEAD) / (DC_STRAFE_SHOTS * 0.075), 0, 1);
    return { z: a.z - k * DC_STRAFE_SHOTS * 7 * DC_SEG, k: k };
}
function dcStrafeShot(a, i) {
    // Shot i lands at this z and x, at this time. The line walks back toward the rider.
    return { z: a.z - i * 7 * DC_SEG, x: a.x + Math.sin(i * 1.9 + a.id) * 0.05, t: a.t0 + DC_STRAFE_LEAD + i * 0.075 };
}

function dcAttacksUpdate(dt) {
    const me = dc.me;
    for (let i = 0; i < dc.attacks.length; i++) {
        const a = dc.attacks[i];
        if (a.st !== "live") continue;
        if (a.kind === "lash") {
            const tS = a.t0 + DC_LASH_WARN;
            if (!a.slammed && dc.simT >= tS) {
                a.slammed = true;
                dcBurstDust(a.z, -0.6, 10); dcBurstDust(a.z, 0.6, 10);
                if (!dc.demo) { dcSnd.lashSweep(dcVolAt(a.z)); if (dcVolAt(a.z) > 0.6) dcShake(8); }
            }
            if (dc.simT > tS + DC_LASH_DOWN + 0.6) a.st = "done";
            if (me && me.down <= 0 && dc.mode === "play" && !a.hit[me.id]) dcLashCheck(a, me, tS);
        } else {
            for (let s = 0; s < DC_STRAFE_SHOTS; s++) {
                const sh = dcStrafeShot(a, s);
                if (a.hit["s" + s] || dc.simT < sh.t) continue;
                a.hit["s" + s] = 1;
                if (dcInTunnel(sh.z)) continue;
                dcFx({ kind: "star", z: sh.z, x: sh.x, y: 0, life: 0.25, len: 260, col: DC_COL.magenta, n: 6 });
                dcFx({ kind: "scorch", z: sh.z, x: sh.x, y: 0, life: 2.5, r1: 0.1, col: DC_COL.magenta, seed: s + a.id });
                if (!dc.demo && s % 2 === 0) dcSnd.strafeShot(dcVolAt(sh.z));
            }
            // Swept hit: the line of fire is continuous, so it hits you the frame it
            // crosses your bike (shots 7 segs apart would otherwise let a bike slip between).
            if (me && me.down <= 0 && dc.mode === "play") {
                const now = dcStrafeNow(a), rel = now.z - me.z;
                if (a.prevRel !== undefined && a.prevRel > 0 && rel <= 0 && now.k > 0 && now.k < 1 && !dcInTunnel(me.z)) {
                    const i = dcClamp(Math.round((a.z - me.z) / (7 * DC_SEG)), 0, DC_STRAFE_SHOTS - 1);
                    dcStrafeCheck(a, me, { z: me.z, x: dcStrafeShot(a, i).x });
                }
                a.prevRel = rel;
            }
            if (dc.simT > a.t0 + DC_STRAFE_LEAD + DC_STRAFE_SHOTS * 0.075 + 0.5) a.st = "done";
        }
    }
    dc.attacks = dc.attacks.filter(function (a) { return a.st === "live" || (a.st === "gone" && dc.simT - a.goneT < 0.6) || (a.st === "done" && false); });
}

function dcLashCheck(a, me, tS) {
    const dz = (me.z - a.z) / DC_SEG;
    const down = dc.simT >= tS && dc.simT <= tS + DC_LASH_DOWN;
    if (Math.abs(dz) < 1.6 && down) {
        a.hit[me.id] = 1;
        if (me.air > 0.05) { dcCredit(50, null, 0, "OVER IT"); return; }
        const sh = dcShieldOf(me.id);
        if (sh) { dcSnd.soak(); dcCreditTo(sh.by, 150, "solves", "BOUNCED"); return; }
        if (dcRamming(me.id)) { dcCredit(150, "solves", 1, "THROUGH"); return; }
        dcCrash(me, "lash");
    } else if (dz > 1.6 && !a.hit[me.id] && dc.simT > tS) {
        a.hit[me.id] = 1;
        if (dz < 25) dcCredit(10, null, 0);         // under it or past it: a dodge
    }
}

function dcStrafeCheck(a, me, sh) {
    const dz = Math.abs(me.z - sh.z) / DC_SEG, dx = Math.abs(me.x - sh.x);
    if (dz > 4) return;
    if (dx < 0.2 && dz < 3.6) {
        if (a.hit[me.id]) return;
        a.hit[me.id] = 1;
        const shd = dcShieldOf(me.id);
        if (shd) { dcSnd.soak(); dcCreditTo(shd.by, 150, "solves", "SOAKED"); return; }
        if (dcRamming(me.id)) { dcCredit(150, "solves", 1, "THROUGH"); return; }
        dcCrash(me, "strafe");
    } else if (dx < 0.5 && !a.hit[me.id + "d"]) { a.hit[me.id + "d"] = 1; dcCredit(10, null, 0); }
}

// The small ship swoops over the line of fire while a run is on.
function dcStrafeShip() {
    for (let i = 0; i < dc.attacks.length; i++) {
        const a = dc.attacks[i];
        if (a.kind !== "strafe" || a.st !== "live") continue;
        const now = dcStrafeNow(a);
        const p = dcScreenAt(now.z, a.x, 2400);
        const age = dc.simT - a.t0;
        const k = dcClamp(age / 0.5, 0, 1) * dcClamp((a.t0 + DC_STRAFE_LEAD + DC_STRAFE_SHOTS * 0.075 + 0.4 - dc.simT) / 0.4, 0, 1);
        if (p) return { x: p.x, y: Math.min(p.y, dcHy - dcH * 0.05), k: k };
        return { x: dcW / 2, y: dcHy - dcH * 0.12, k: k * 0.5 };
    }
    return null;
}

// ---------------------------------------------------
//   DRAWING
// ---------------------------------------------------
function dcAttacksBuckets() {
    for (let i = 0; i < dc.attacks.length; i++) {
        const a = dc.attacks[i];
        if (a.kind === "lash") dcBucket(a.z, 3, dcDrawLash, a);
        else if (a.st === "live") {
            for (let s = 0; s < DC_STRAFE_SHOTS; s++) {
                const sh = dcStrafeShot(a, s);
                if (dc.simT >= sh.t || dc.simT < sh.t - DC_STRAFE_LEAD) continue;
                dcBucket(sh.z, 0, dcDrawStrafeMark, a, s);
            }
        }
    }
}

function dcDrawStrafeMark(ctx, a, s) {
    const sh = dcStrafeShot(a, s);
    const p = dcScreenAt(sh.z, sh.x, 0);
    if (!p || p.y > p.clip + 2) return;
    const k = dcClamp(1 - (sh.t - dc.simT) / DC_STRAFE_LEAD, 0, 1);
    const r = Math.max(2, p.w * 0.12);
    const blink = DC_REDUCED || Math.floor(dc.simT * 16) % 2 === 0;
    ctx.globalAlpha = 0.35 + 0.65 * k;
    ctx.beginPath();
    ctx.moveTo(p.x - r, p.y - r * 0.25); ctx.lineTo(p.x + r, p.y + r * 0.25);
    ctx.moveTo(p.x + r, p.y - r * 0.25); ctx.lineTo(p.x - r, p.y + r * 0.25);
    ctx.strokeStyle = blink || k < 0.6 ? DC_COL.magenta : DC_COL.hot; ctx.lineWidth = 1.4; ctx.stroke();
    // The lane, ruled on the road, so you can see which one to leave.
    if (s % 3 === 0) { ctx.globalAlpha = 0.25; dcLine(ctx, [p.x - p.w * 0.2, p.y, p.x + p.w * 0.2, p.y], DC_COL.magenta, 0, 1); }
    ctx.globalAlpha = 1;
}

// The tendril: a ribbed, tapering arm rearing up from beside the road, then
// lying across it. Black body, violet-magenta skin, suckers.
function dcDrawLash(ctx, a) {
    const tS = a.t0 + DC_LASH_WARN;
    const now = dc.simT;
    let rise, across;
    if (a.st === "gone") { rise = 1 - dcClamp((now - a.goneT) / 0.4, 0, 1); across = 0; }
    else if (now < tS) { rise = dcClamp((now - a.t0) / DC_LASH_WARN, 0, 1); across = 0; }
    else if (now < tS + DC_LASH_DOWN) { rise = 1; across = 1; }
    else { rise = 1 - dcClamp((now - tS - DC_LASH_DOWN) / 0.5, 0, 1); across = rise; }
    if (rise <= 0) return;
    const base = dcScreenAt(a.z, a.side * 1.55, 0);
    if (!base) return;
    const bx = base.x, by = base.y, bw = base.w, s = base.s, clip = base.clip;
    dcClipBegin(ctx, clip);
    // The shadow line across the road and the countdown ring: where, and when.
    if (across < 1 && a.st === "live") {
        const k = dcClamp((now - a.t0) / DC_LASH_WARN, 0, 1);
        const p0 = dcScreenAt(a.z, -1.15, 0); const x0 = p0 ? p0.x : bx;
        const p1 = dcScreenAt(a.z, 1.15, 0); const x1 = p1 ? p1.x : bx;
        ctx.save(); ctx.setLineDash([6, 4]);
        ctx.globalAlpha = 0.4 + 0.6 * k;
        dcLine(ctx, [x0, by, x1, by], DC_COL.magenta, 2 + 6 * k, 1 + k);
        ctx.restore();
        const c = dcScreenAt(a.z, 0, 0);
        if (c) {
            ctx.beginPath(); ctx.ellipse(c.x, c.y, c.w * (1.3 - k * 1.1), Math.max(2, c.w * 0.18 * (1.3 - k * 1.1)), 0, 0, Math.PI * 2);
            ctx.globalAlpha = 0.8; ctx.strokeStyle = DC_COL.magenta; ctx.lineWidth = 1.4; ctx.stroke(); ctx.globalAlpha = 1;
        }
    }
    // The arm: a curve from its root beside the road, up and over.
    const H = 3600 * s * dcVy * rise;
    const reach = bw * 3.1;                         // across the full road
    const pts = [];
    const N = 14;
    for (let i = 0; i <= N; i++) {
        const u = i / N;
        // Rearing: up and curling over the road. Slammed: flat across it.
        const upX = bx - a.side * reach * 0.35 * Math.sin(u * 1.4) * u, upY = by - H * Math.sin(u * Math.PI * 0.62);
        const dnX = bx - a.side * reach * u, dnY = by - 120 * s * dcVy * (1 - u * 0.5) - Math.sin(u * 9 + now * 30) * 12 * s * dcVy;
        const sway = DC_REDUCED ? 0 : Math.sin(now * 3 + u * 4) * bw * 0.06 * (1 - across);
        pts.push(dcLerp(upX, dnX, across) + sway, dcLerp(upY, dnY, across));
    }
    // Thickness tapers from root to tip.
    const thick = function (u) { return Math.max(1.5, bw * 0.16 * (1 - u * 0.8)); };
    const L = [], R = [];
    for (let i = 0; i <= N; i++) {
        const i0 = Math.max(0, i - 1), i1 = Math.min(N, i + 1);
        const dx = pts[i1 * 2] - pts[i0 * 2], dy = pts[i1 * 2 + 1] - pts[i0 * 2 + 1];
        const l = Math.hypot(dx, dy) || 1, nx = -dy / l, ny = dx / l, w = thick(i / N);
        L.push(pts[i * 2] + nx * w, pts[i * 2 + 1] + ny * w);
        R.push(pts[i * 2] - nx * w, pts[i * 2 + 1] - ny * w);
    }
    const poly = L.slice();
    for (let i = N; i >= 0; i--) poly.push(R[i * 2], R[i * 2 + 1]);
    const breath = DC_REDUCED ? 0.8 : 0.6 + 0.4 * Math.sin(now * 6);
    dcSolid(ctx, poly, "#C060F0", 6, 1.8);
    // Ribs and suckers.
    ctx.beginPath();
    for (let i = 1; i < N; i++) { ctx.moveTo(L[i * 2], L[i * 2 + 1]); ctx.lineTo(R[i * 2], R[i * 2 + 1]); }
    ctx.globalAlpha = 0.5 * breath; ctx.strokeStyle = DC_COL.magenta; ctx.lineWidth = 1; ctx.stroke();
    ctx.globalAlpha = 1;
    for (let i = 2; i < N; i += 2) {
        const rr = thick(i / N) * 0.35;
        ctx.beginPath(); ctx.arc(R[i * 2], R[i * 2 + 1], rr, 0, Math.PI * 2);
        ctx.strokeStyle = "#FFB8FF"; ctx.lineWidth = 1; ctx.stroke();
    }
    ctx.restore();
}

function dcDrawAttacksTop(ctx) { void ctx; }

// ---------------------------------------------------
//   GREER'S SEEKERS (FIRE): homing rounds that chase every krill in range
// ---------------------------------------------------
// The seekers are effects: the host has already decided which krill die
// (with a short delay, dc-hazards.js), and each seeker flies to one of them.
function dcLaunchSeekers(m, col) {
    const targets = [];
    for (let i = 0; i < dc.krill.length; i++) {
        const k = dc.krill[i];
        if (k.phase === "gone") continue;
        const r = dc.riders[k.tg];
        if (!r || Math.abs(r.z - m.z) > DC_FIRE_KRILL * DC_SEG) continue;
        targets.push(k.id);
    }
    const n = Math.max(4, targets.length * 3);
    for (let i = 0; i < n; i++) {
        dcFx({ kind: "seeker", z: m.z + DC_SEG, x: m.x, y: 700, vz: 18000 + Math.random() * 8000, vx: (Math.random() - 0.5) * 3, vy: 900 + Math.random() * 1600,
            life: 0.9, tk: targets.length ? targets[i % targets.length] : 0, col: col, delay: i * 0.03, trail: [] });
    }
}

function dcSeekerUpdate(f, dt) {
    // Steer toward the krill it was given (or straight down the road).
    let tz = f.z + 30 * DC_SEG, tx = f.x, ty = 900;
    if (f.tk) {
        const k = dcFindKrill(f.tk);
        if (k) {
            const r = dc.riders[k.tg];
            if (k.phase === "fly") { const w = dcKrillWorld(k, Math.floor(f.t * 7) % 5); if (w) { tz = w.z; tx = w.x; ty = w.y; } }
            else if (r) { tz = r.z; tx = r.x; ty = 520; }
        }
    }
    const dz = tz - f.z, dx = tx - f.x, dy = ty - f.y;
    const turn = Math.min(1, dt * 9);
    f.vz += (dz * 6 - f.vz) * turn;
    f.vx += (dx * 6 - f.vx) * turn;
    f.vy += (dy * 6 - f.vy) * turn;
    f.trail.push(f.z, f.x, f.y);
    if (f.trail.length > 18) f.trail.splice(0, 3);
    f.z += f.vz * dt; f.x += f.vx * dt; f.y += f.vy * dt;
    if (f.tk && Math.abs(dz) < DC_SEG * 1.5 && Math.abs(dx) < 0.15 && !f.hitDone) {
        f.hitDone = true;
        f.t = f.life;
        dcFx({ kind: "star", z: f.z, x: f.x, y: f.y, life: 0.25, len: 300, col: DC_COL.hot, n: 6 });
        if (!dc.demo) dcSnd.seekerHit(dcVolAt(f.z));
    }
}

function dcDrawSeeker(ctx, f) {
    const pts = [];
    for (let i = 0; i < f.trail.length; i += 3) {
        const p = dcScreenAt(f.trail[i], f.trail[i + 1], f.trail[i + 2]);
        if (p) pts.push(p.x, p.y);
    }
    const p = dcScreenAt(f.z, f.x, f.y);
    if (p) pts.push(p.x, p.y);
    if (pts.length >= 4) { ctx.globalAlpha = 0.7; dcLine(ctx, pts, f.col, 3, 1.2); ctx.globalAlpha = 1; }
    if (p) dcBloom(ctx, p.x, p.y, Math.max(1, p.s * 600));
}
