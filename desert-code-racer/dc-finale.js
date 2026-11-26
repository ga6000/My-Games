// ===================================================
//   Desert Code Racer — the finale: into the mountain, the slide, the toss
// ===================================================
// Ry, pass 2: "a finish of going into a tunnel into a solid mountain with
// down lighting and akira-sliding into a massive computer lab, then tossing
// the codes to a friendly." And: "players should be able to finish at
// different times."
//
// Each rider who crosses the finish line slides sideways into the lab on
// their own and parks (HOME). When the rider with the case gets there the
// host starts the finale: the carrier tosses the case to the friendly at the
// console, the screens arm the launch, and anyone still on the road gets
// DC_HOME_GRACE seconds to make it in (a bonus each). Then the card.
"use strict";

const DC_HOME_GRACE = 10;           // s for the stragglers once the codes are in
const DC_HOME_BONUS = 1500;         // per rider who made it into the lab
const DC_SLIDE_T = 1.5;
// The toss waits for the slide to finish and the carrier to step off the bike
// (Ry 2026-11-24: the toss "appears to be missing": it used to fly mid-slide,
// from a seated rider, to a tech 20 segs away who was a few pixels tall).
const DC_STEP_OFF = 0.25;           // s after the slide stops: the rider stands up beside the bike
const DC_TOSS_AT = 2.0, DC_TOSS_T = 0.9;
const DC_FRIENDLY_SEG = 30;         // segs past the finish line: the tech steps up to meet the riders

// ---- every client: my own bike crossing the line ----
function dcHomeUpdate(r, dt) {
    const fin = dc.track.finish * DC_SEG;
    if (!r.home && r.z >= fin && r.down <= 0) {
        r.home = dc.simT;
        r.slide = 0.001;
        r.slideDir = r.x >= 0 ? 1 : -1;
        let order = 0;
        for (const id in dc.riders) if (dc.riders[id] !== r && dc.riders[id].home) order++;
        r.park = [-0.9, 0.9, -0.35, 0.35][order % 4];
        r.krill = 0;
        if (!dc.demo) { dcSnd.slide(); dcBanner(dcCarrying(r) ? "CODES IN THE LAB" : "HOME", dcCarrying(r) ? DC_COL.amber : DC_COL.cyan); }
        if (r.local) dcEmit({ k: "home", by: r.id });
    }
    if (!r.home) return false;
    // The slide: sideways, sparks, speed bleeding off, into a parking spot.
    r.slide = Math.min(1, r.slide + dt / DC_SLIDE_T);
    r.v = Math.max(0, r.v - Math.max(3000, r.v * 1.6) * dt);
    r.x = dcLerp(r.x, r.park, Math.min(1, dt * 1.6));
    r.z = Math.min(r.z + r.v * dt, (dc.track.finish + 26) * DC_SEG);
    r.lean = 0; r.boosting = false; r.air = 0;
    return true;
}

// Remote riders: start their slide when they cross (drawing only).
function dcRemoteHome(r, dt) {
    const fin = dc.track.finish * DC_SEG;
    if (!r.home && r.z >= fin) { r.home = dc.simT; r.slide = 0.001; r.slideDir = r.x >= 0 ? 1 : -1; if (!dc.demo) dcSnd.slide(); }
    if (r.home) { r.slide = Math.min(1, r.slide + dt / DC_SLIDE_T); r.z = Math.min(r.z, (dc.track.finish + 26) * DC_SEG); r.tz = Math.min(r.tz || r.z, r.z); }
}

// ---- host ----
function dcHostFinale() {
    const f = dc.finale;
    if (!f || dc.caseS.over) return;
    let out = 0;
    for (const id in dc.riders) if (!dc.riders[id].home && dc.riders[id].seen >= 0) out++;
    const caught = dc.simT - f.t > DC_TOSS_AT + DC_TOSS_T + 1.2;
    if ((out === 0 && caught) || dc.simT - f.t > DC_HOME_GRACE + 2) dcHostEnd(true);
}

function dcOnFinale(m) {
    if (dc.finale) return;
    dc.finale = { by: m.by, t: dc.simT, caught: false, tossed: false };
    dcMusic.stop();
}

function dcFinaleUpdate() {
    const f = dc.finale;
    if (!f) return;
    const age = dc.simT - f.t;
    if (!f.tossed && age >= DC_TOSS_AT) { f.tossed = true; if (!dc.demo) dcSnd.toss(); }
    if (!f.caught && age >= DC_TOSS_AT + DC_TOSS_T) {
        f.caught = true;
        if (!dc.demo) { dcSnd.catchIt(); dcBanner("LAUNCH ARMED", DC_COL.amber); }
        dcBurstSparks((dc.track.finish + DC_FRIENDLY_SEG) * DC_SEG, 0, DC_COL.amber, 16);
    }
}

// ---- drawing ----
function dcFinaleBuckets() {
    const zF = (dc.track.finish + DC_FRIENDLY_SEG) * DC_SEG;
    dcBucket(zF, 5, dcDrawFriendly);
    const f = dc.finale;
    if (f && f.tossed && !f.caught) {
        const k = dcClamp((dc.simT - f.t - DC_TOSS_AT) / DC_TOSS_T, 0, 1);
        const c = dc.riders[f.by];
        // From the carrier's hands: they stand beside the bike, on the far side from where it fell.
        const z0 = c ? c.z : dc.track.finish * DC_SEG, x0 = c ? c.x + (c.slideDir || 1) * 0.085 : 0;
        const z = dcLerp(z0, zF, k);
        dcBucket(z, 7, dcDrawTossedCase, k, { z0: z0, x0: x0, zF: zF });
    }
}

function dcDrawTossedCase(ctx, k, o) {
    const z = dcLerp(o.z0, o.zF, k), x = dcLerp(o.x0, 0, k);
    const y = dcLerp(420, 520, k) + Math.sin(Math.PI * k) * 1400;
    const p = dcScreenAt(z, x, y);
    if (!p) return;
    const u = p.s * dcVy, w = Math.max(5, 300 * u), h = Math.max(4, 190 * u);
    // A short amber trail, so the arc reads on a low-res screen.
    for (let i = 1; i <= 3; i++) {
        const kk = Math.max(0, k - i * 0.06);
        const q = dcScreenAt(dcLerp(o.z0, o.zF, kk), dcLerp(o.x0, 0, kk), dcLerp(420, 520, kk) + Math.sin(Math.PI * kk) * 1400);
        if (q) { ctx.fillStyle = dcShade(DC_COL.amber, 0.8 - i * 0.2); ctx.fillRect(Math.round(q.x) - 1, Math.round(q.y) - 1, 2, 2); }
    }
    ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(k * 8);
    dcSolid(ctx, [-w / 2, h / 2, -w / 2, -h / 2, w / 2, -h / 2, w / 2, h / 2], DC_COL.amber, 4, 1.8);
    ctx.restore();
}

// The friendly at the console: a lab tech (pixel sprite, like the crew),
// arms up for the catch, then the case held high.
function dcDrawFriendly(ctx) {
    const zF = (dc.track.finish + DC_FRIENDLY_SEG) * DC_SEG;
    const p = dcScreenAt(zF, 0, 0);
    if (!p) return;
    const s = p.s * dcVy * 430;
    if (s < 2) return;
    const f = dc.finale;
    const age = f ? dc.simT - f.t : 0;
    const up = f && f.tossed;
    const wave = !f && !DC_REDUCED && Math.sin(dc.simT * 3) > 0.6;
    dcDrawSprite(ctx, "tech", up || wave ? "flail" : "stand", p.x, p.y, s * DC_PX_RIDE);
    if (f && f.caught) {
        const w = s * 0.3, h = s * 0.18, cy = p.y - s * 1.12 - (DC_REDUCED ? 0 : Math.abs(Math.sin(age * 5)) * s * 0.05);
        dcSolid(ctx, [p.x - w / 2, cy + h / 2, p.x - w / 2, cy - h / 2, p.x + w / 2, cy - h / 2, p.x + w / 2, cy + h / 2], DC_COL.amber, 4, 1.8);
    }
}

function dcDrawFinaleHud(ctx, big) {
    const r = dc.me;
    if (!r || dc.mode !== "play") return;
    const f = dc.finale;
    const sz = 8; void big;
    if (f && !r.home) {
        const left = Math.max(0, Math.ceil(DC_HOME_GRACE + 2 - (dc.simT - f.t)));
        dcText(ctx, "CODES ARE IN  GET TO THE LAB  " + left, dcW / 2, dcH * 0.2, sz, DC_COL.amber, "center");
    } else if (r.home && !f) {
        dcText(ctx, "HOME  WAITING FOR THE CODES", dcW / 2, dcH * 0.2, sz, DC_COL.cyan, "center");
    }
    dcDrawTally(ctx);
}

// The round break (Ry 2026-11-25): a checkpoint tally that rides over live
// play through the mountain tunnel. dcOnCheckpoint fills dc.tally (leg 1 =
// ALPHA, so round 1 is clear); hazards
// are already quiet in the tunnel, so the board can sit mid-screen.
const DC_TALLY_T = 5.5;
function dcDrawTally(ctx) {
    const t = dc.tally;
    if (!t || dc.demo) return;
    const age = dc.simT - t.t;
    if (age > DC_TALLY_T) { dc.tally = null; return; }
    const rows = [
        ["ROUND " + t.leg + " CLEAR", DC_COL.amber],
        [DC_LEG_NAMES[t.leg] || "", DC_COL.cyan],
        ["CHECKPOINT +1000", DC_COL.mid],
        ["ROUND   " + t.round, DC_COL.hot],
        ["YOU     " + t.mine, DC_COL.hot],
        ["TEAM    " + t.team, DC_COL.amber],
        ["CASE    " + (dc.caseS ? dc.caseS.pips : 0) + " PIPS", DC_COL.magenta],
        ["", null],
        ["ROUND " + (t.leg + 1) + " AT THE EXIT", DC_COL.mid]
    ];
    const lh = 11, w = Math.min(dcW - 16, 200), h = rows.length * lh + 12;
    const x = Math.round(dcW / 2 - w / 2), y = Math.round(dcH * 0.13);
    // In and out: a quick wipe so it does not pop.
    const k = Math.min(1, age / 0.25, (DC_TALLY_T - age) / 0.4);
    const shown = Math.max(0, Math.min(rows.length, Math.floor(age / 0.12)));
    ctx.save();
    ctx.globalAlpha = 0.72 * k;
    ctx.fillStyle = "#05070A";
    ctx.fillRect(x, y, w, Math.round(h * k));
    ctx.globalAlpha = k;
    ctx.strokeStyle = DC_COL.amber; ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, Math.round(h * k) - 1);
    ctx.restore();
    if (k < 0.9) return;
    for (let i = 0; i < shown; i++) {
        if (!rows[i][1]) continue;
        dcText(ctx, rows[i][0], dcW / 2, y + 7 + i * lh, 8, rows[i][1], "center");
    }
}
