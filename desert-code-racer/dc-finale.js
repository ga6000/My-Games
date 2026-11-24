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
const DC_TOSS_AT = 1.3, DC_TOSS_T = 0.75;
const DC_FRIENDLY_SEG = 44;         // segs past the finish line: where the friendly stands

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
        const z0 = c ? c.z : dc.track.finish * DC_SEG, x0 = c ? c.x : 0;
        const z = dcLerp(z0, zF, k);
        dcBucket(z, 7, dcDrawTossedCase, k, { z0: z0, x0: x0, zF: zF });
    }
}

function dcDrawTossedCase(ctx, k, o) {
    const z = dcLerp(o.z0, o.zF, k), x = dcLerp(o.x0, 0, k);
    const y = dcLerp(500, 1500, k) + Math.sin(Math.PI * k) * 2200;
    const p = dcScreenAt(z, x, y);
    if (!p) return;
    const u = p.s * dcVy, w = Math.max(4, 240 * u), h = Math.max(3, 150 * u);
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
}
