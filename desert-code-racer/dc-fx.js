// ===================================================
//   Desert Code Racer — effects: bursts, scorches, floating text, banners
// ===================================================
// Effects live in WORLD space (z along the road, x across it, y up in world
// units), so an explosion stays where the beam landed while the bike rides
// past it. dc-render.js projects them every frame.
"use strict";

const DC_FX_MAX = 420;
let dcShakeAmt = 0;

function dcFx(p) {
    if (dc.fx.length >= DC_FX_MAX) dc.fx.shift();
    p.t = 0;
    dc.fx.push(p);
}

function dcBurstExplosion(z, x, col, size) {
    size = size || 1;
    dcFx({ kind: "ring", z: z, x: x, y: 0, life: 0.6, r0: 0.05, r1: 0.55 * size, col: col });
    dcFx({ kind: "ring", z: z, x: x, y: 0, life: 0.9, r0: 0.02, r1: 0.9 * size, col: DC_COL.hot });
    dcFx({ kind: "star", z: z, x: x, y: 0, life: 0.45, len: 900 * size, col: col, n: 9 });
    const n = Math.round(14 * size);
    for (let i = 0; i < n; i++) {
        const a = Math.random() * Math.PI;
        dcFx({ kind: "spark", z: z, x: x, y: 0, vx: Math.cos(a) * (0.6 + Math.random()) * size, vy: Math.sin(a) * (1600 + Math.random() * 1800) * size,
            vz: (Math.random() - 0.3) * 3000, life: 0.6 + Math.random() * 0.6, col: Math.random() < 0.5 ? col : DC_COL.amber });
    }
}

function dcBurstAir(z, x, col) {
    dcFx({ kind: "ring", z: z, x: x, y: 2600, life: 0.5, r0: 0.05, r1: 0.5, col: col });
    dcFx({ kind: "star", z: z, x: x, y: 2600, life: 0.4, len: 700, col: DC_COL.hot, n: 8 });
    for (let i = 0; i < 10; i++) {
        dcFx({ kind: "spark", z: z, x: x, y: 2600, vx: (Math.random() - 0.5) * 2, vy: (Math.random() - 0.2) * 2000, vz: 0,
            life: 0.5 + Math.random() * 0.4, col: col });
    }
}

function dcBurstSparks(z, x, col, n) {
    for (let i = 0; i < n; i++) {
        dcFx({ kind: "spark", z: z, x: x + (Math.random() - 0.5) * 0.1, y: 200, vx: (Math.random() - 0.5) * 1.6, vy: Math.random() * 1500,
            vz: 2000 + Math.random() * 3000, life: 0.4 + Math.random() * 0.3, col: col });
    }
}

function dcBurstDust(z, x, n) {
    for (let i = 0; i < n; i++) {
        dcFx({ kind: "spark", z: z, x: x + (Math.random() - 0.5) * 0.2, y: 0, vx: (Math.random() - 0.5) * 1.2, vy: 300 + Math.random() * 500,
            vz: 3000 + Math.random() * 2000, life: 0.3 + Math.random() * 0.2, col: DC_COL.mid });
    }
}

function dcBurstKrill(z, x) {
    for (let i = 0; i < 10; i++) {
        dcFx({ kind: "krill", z: z, x: x, y: 400, vx: (Math.random() - 0.5) * 3, vy: 800 + Math.random() * 1600, vz: -2000 + Math.random() * 6000,
            life: 0.8 + Math.random() * 0.4, col: DC_COL.hot, rot: Math.random() * 6 });
    }
}

function dcBurstDebris(z, x) {
    for (let i = 0; i < 18; i++) {
        dcFx({ kind: "chunk", z: z, x: x + (Math.random() - 0.5) * 1.6, y: 200, vx: (Math.random() - 0.5) * 2, vy: 600 + Math.random() * 1600,
            vz: 1000 + Math.random() * 6000, life: 0.7 + Math.random() * 0.5, col: DC_COL.mid, rot: Math.random() * 6 });
    }
}

function dcAddScorch(z, x) {
    dcFx({ kind: "scorch", z: z, x: x, y: 0, life: 7, r1: DC_RING, col: DC_COL.magenta, seed: Math.random() * 1000 });
}

// What an ability looks like on the road, for everyone who can see it.
function dcFxAbility(m, col) {
    if (m.a === "scout") dcFx({ kind: "pulse", z: m.z, x: 0, y: 0, life: 1.0, len: 130, col: col });
    else if (m.a === "gunner") {
        for (let i = 0; i < 7; i++) dcFx({ kind: "tracer", z: m.z + 2 * DC_SEG, x: m.x + (Math.random() - 0.5) * 0.3, y: 500,
            vz: 60000, vx: (Math.random() - 0.5) * 0.8, vy: 0, life: 0.3, delay: i * 0.055, col: col });
        dcLaunchSeekers(m, col);
    } else if (m.a === "medic") dcFx({ kind: "ring", z: m.z + DC_CAM_BACK * 0, x: m.x, y: 300, life: 0.8, r0: 0.1, r1: 2.4, col: col });
    else if (m.a === "butcher") dcBurstDust(m.z, m.x, 14);
    else if (m.a === "bulwark") dcFx({ kind: "ring", z: m.z, x: m.x, y: 400, life: 0.5, r0: 0.4, r1: 0.9, col: col });
}

function dcFxUpdate(dt) {
    for (let i = 0; i < dc.fx.length; i++) {
        const p = dc.fx[i];
        if (p.delay > 0) { p.delay -= dt; continue; }
        p.t += dt;
        if (p.kind === "seeker") { dcSeekerUpdate(p, dt); continue; }
        if (p.kind === "spark" || p.kind === "krill" || p.kind === "chunk" || p.kind === "tracer") {
            p.x += (p.vx || 0) * dt;
            p.z += (p.vz || 0) * dt;
            p.y += (p.vy || 0) * dt;
            if (p.kind !== "tracer") p.vy -= 4200 * dt;
            if (p.y < 0) { p.y = 0; p.vy *= -0.3; p.vx *= 0.6; }
        }
    }
    dc.fx = dc.fx.filter(function (p) { return p.t < p.life; });
    for (let i = 0; i < dc.texts.length; i++) dc.texts[i].t += dt;
    dc.texts = dc.texts.filter(function (t) { return t.t < t.life; });
    if (dcShakeAmt > 0) dcShakeAmt = Math.max(0, dcShakeAmt - dt * 40);
}

function dcShake(n) { if (!DC_REDUCED) dcShakeAmt = Math.max(dcShakeAmt, n); }

// Stroke text over the road (a label where a thing happened).
function dcText3D(str, z, x, col) {
    dc.texts.push({ kind: "world", s: str, z: z, x: x, col: col, t: 0, life: 1.1 });
}

// A line across the middle of the screen, for things the whole convoy needs.
function dcBanner(str, col) {
    for (let i = 0; i < dc.texts.length; i++) if (dc.texts[i].kind === "banner") dc.texts[i].t = Math.max(dc.texts[i].t, dc.texts[i].life - 0.15);
    dc.texts.push({ kind: "banner", s: str, col: col, t: 0, life: 1.8 });
}

// Score toast (AESTHETIC_GUIDE §4.13) floating off my bike, in my colour.
function dcToastAtMe(pts, label) {
    if (typeof HUBSCORE === "undefined" || !dc.me || dc.demo) return;
    const c = document.getElementById("dcCanvas");
    if (!c) return;
    const rect = c.getBoundingClientRect();
    const p = dcBikeScreen();
    const x = rect.left + (p ? p.x : rect.width / 2) + (Math.random() - 0.5) * 50;
    const y = rect.top + (p ? p.y : rect.height * 0.8) - 70;
    HUBSCORE.toast(x, y, pts, { color: dc.me.color, text: label ? label + "  " + HUBSCORE.format(pts) : undefined, big: pts >= 1000 });
}
