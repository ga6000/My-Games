// ===================================================
//   RAIL SANDBOX — render, HUD, audio, the loop, boot
// ===================================================
// Loaded LAST of the game's own files: it boots. The grass tile, the tree
// canopy art and the four quantised lighting bands are ported from
// zombie-arcade.js / zombie-render.js as the user asked -- the ELEMENTS, not
// the arcade's level system, which is what would have dragged ARENA,
// arcLevelNo and ARENA_LAYOUTS in behind them.
"use strict";

// ---------------------------------------------------
//   AUDIO  (small, synthesised, no assets)
// ---------------------------------------------------
let railAudioCtx = null;
let railAudioLive = [];

function railAudioInit() {
    if (railAudioCtx) return railAudioCtx;
    try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) railAudioCtx = new AC();
    } catch (e) { railAudioCtx = null; }
    return railAudioCtx;
}

function railAudioStopAll() {
    for (let i = 0; i < railAudioLive.length; i++) {
        try { railAudioLive[i].stop(); } catch (e) { /* already done */ }
    }
    railAudioLive = [];
    if (railAudioCtx && railAudioCtx.state !== "closed") {
        try { railAudioCtx.close(); } catch (e) { /* nothing to do */ }
    }
    railAudioCtx = null;
}

// Volume falls off with distance from the camera, so a car clanging across
// the map is heard but does not compete with what is in front of you.
const RAIL_SFX = {
    rifle:     { f: 240, t: "square",   d: 0.07, g: 0.16, slide: -120 },
    rocket:    { f: 120, t: "sawtooth", d: 0.22, g: 0.24, slide: 60 },
    boom:      { f: 62,  t: "sawtooth", d: 0.45, g: 0.34, slide: -40 },
    couple:    { f: 150, t: "square",   d: 0.14, g: 0.26, slide: -90 },
    clang:     { f: 320, t: "square",   d: 0.20, g: 0.28, slide: -220 },
    switch:    { f: 520, t: "square",   d: 0.07, g: 0.18, slide: -180 },
    notchUp:   { f: 330, t: "triangle", d: 0.06, g: 0.14, slide: 110 },
    notchDown: { f: 330, t: "triangle", d: 0.06, g: 0.14, slide: -110 },
    reverse:   { f: 200, t: "square",   d: 0.12, g: 0.18, slide: -60 },
    pumpOn:    { f: 90,  t: "sawtooth", d: 0.30, g: 0.22, slide: 40 },
    pump:      { f: 74,  t: "sawtooth", d: 0.34, g: 0.20, slide: -12 },
    door:      { f: 180, t: "square",   d: 0.18, g: 0.22, slide: 90 },
    death:     { f: 150, t: "sawtooth", d: 0.55, g: 0.30, slide: -110 }
};

function railSfx(key, x, y) {
    const spec = RAIL_SFX[key];
    const ctxA = railAudioCtx;
    if (!spec || !ctxA || ctxA.state === "closed") return;
    const d = rDist(x === undefined ? railCam.x : x, y === undefined ? railCam.y : y,
                    railCam.x, railCam.y);
    const falloff = Math.max(0, 1 - d / 1700);
    if (falloff <= 0.01) return;
    try {
        const t0 = ctxA.currentTime;
        const osc = ctxA.createOscillator();
        const gain = ctxA.createGain();
        osc.type = spec.t;
        osc.frequency.setValueAtTime(spec.f, t0);
        if (spec.slide) osc.frequency.linearRampToValueAtTime(Math.max(30, spec.f + spec.slide), t0 + spec.d);
        gain.gain.setValueAtTime(spec.g * falloff, t0);
        gain.gain.exponentialRampToValueAtTime(0.0001, t0 + spec.d);
        osc.connect(gain).connect(ctxA.destination);
        osc.start(t0);
        osc.stop(t0 + spec.d + 0.02);
        railAudioLive.push(osc);
        if (railAudioLive.length > 32) railAudioLive.splice(0, 16);
    } catch (e) { /* audio is never worth a crash */ }
}

// The pump's noise. A no-op while zombies are off, which is the default --
// the hook exists so the pump's cost is real the moment they are switched on,
// rather than needing the mechanic rewritten then.
function railNoise(x, y, radius) {
    if (typeof railZombAlert === "function") railZombAlert(x, y, radius);
}

// ---------------------------------------------------
//   TOAST AND PROMPT
// ---------------------------------------------------
let railToastUntil = 0;

function railToast(text, ms) {
    const el = document.getElementById("toast");
    if (!el) return;
    el.textContent = text;
    el.style.display = "block";
    railToastUntil = Date.now() + (ms || 1500);
}

function railToastTick(now) {
    const el = document.getElementById("toast");
    if (el && railToastUntil && now > railToastUntil) {
        el.style.display = "none";
        railToastUntil = 0;
    }
    const pe = document.getElementById("prompt");
    if (pe) {
        if (railPrompt) { pe.textContent = railPrompt; pe.style.display = "block"; }
        else pe.style.display = "none";
    }
}

// ---------------------------------------------------
//   GROUND: the grass tile, ported unchanged in spirit
// ---------------------------------------------------
// Flat raster colours, no gradients (AESTHETIC_GUIDE 6.3): one tile of tufts
// on a base, made once from a FIXED seed so every reload shows the same
// tufts. Lighter greens on the ground, dark ones in the canopies -- the
// arcade's 2026-10-08 change for "more visual clarity between grass & trees".
let railGrassPattern = null;

function railGrassTile() {
    const S = 96;
    const c = document.createElement("canvas");
    c.width = S; c.height = S;
    const g = c.getContext("2d");
    g.fillStyle = "#34502A";
    g.fillRect(0, 0, S, S);
    const rnd = railRng(4242);
    const shades = ["#3E5C30", "#4A6A36", "#2C4422", "#56783C"];
    for (let i = 0; i < 70; i++) {
        const x = Math.floor(rnd() * S), y = Math.floor(rnd() * S);
        g.fillStyle = shades[Math.floor(rnd() * shades.length)];
        g.fillRect(x, y, 2, 4);
        if (rnd() < 0.5) g.fillRect(x + 2, y + 1, 2, 3);
    }
    for (let i = 0; i < 6; i++) {
        g.fillStyle = "#4A4A30";
        g.fillRect(Math.floor(rnd() * S), Math.floor(rnd() * S), 6, 4);
    }
    return c;
}

function railDrawGround(vr) {
    railCtx.fillStyle = "#050505";
    railCtx.fillRect(vr.x, vr.y, vr.w, vr.h);
    if (!railGrassPattern) railGrassPattern = railCtx.createPattern(railGrassTile(), "repeat");
    railCtx.save();
    railCtx.imageSmoothingEnabled = false;
    railCtx.fillStyle = railGrassPattern;
    railCtx.fillRect(Math.max(0, vr.x), Math.max(0, vr.y),
                     Math.min(RAIL_WORLD_W, vr.x + vr.w) - Math.max(0, vr.x),
                     Math.min(RAIL_WORLD_H, vr.y + vr.h) - Math.max(0, vr.y));
    railCtx.restore();
}

// ---------------------------------------------------
//   TRACK: ballast, sleepers across, two rails along
// ---------------------------------------------------
// Drawn per visible segment rather than cached to an offscreen canvas. The
// arcade cached because its track was a baked floor tile it had to beat; here
// the whole network is ~1,600 short segments and only the on-screen ones are
// touched, which measures as nothing next to the grass fill.
const RAIL_GAUGE = 40;
const RAIL_RAIL_W = 5;
const RAIL_SLEEPER_LEN = 64;
const RAIL_SLEEPER_W = 7;
const RAIL_SLEEPER_PITCH = 17;
const RAIL_BALLAST_W = 78;

function railDrawTrack(inView) {
    // Ballast first, under every edge, so crossings do not show a seam.
    for (let pass = 0; pass < 3; pass++) {
        for (let i = 0; i < railEdges.length; i++) {
            const E = railEdges[i];
            for (let k = 1; k < E.pts.length; k++) {
                const a = E.pts[k - 1], b = E.pts[k];
                const minx = Math.min(a.x, b.x), miny = Math.min(a.y, b.y);
                if (!inView(minx - 60, miny - 60, Math.abs(b.x - a.x) + 120, Math.abs(b.y - a.y) + 120)) continue;
                const ang = Math.atan2(b.y - a.y, b.x - a.x);
                const L = Math.hypot(b.x - a.x, b.y - a.y);
                railCtx.save();
                railCtx.translate(a.x, a.y);
                railCtx.rotate(ang);
                if (pass === 0) {
                    railCtx.fillStyle = "#2A2520";
                    railCtx.fillRect(0, -RAIL_BALLAST_W / 2, L + 1, RAIL_BALLAST_W);
                } else if (pass === 1) {
                    // Sleepers, pitched on DISTANCE ALONG THE LINE (E.cum),
                    // not per segment -- otherwise every segment restarts the
                    // pattern and a curve reads as a picket fence.
                    railCtx.fillStyle = "#3B2E22";
                    const s0 = E.cum[k - 1];
                    const first = Math.ceil(s0 / RAIL_SLEEPER_PITCH) * RAIL_SLEEPER_PITCH - s0;
                    for (let o = first; o < L; o += RAIL_SLEEPER_PITCH) {
                        railCtx.fillRect(o, -RAIL_SLEEPER_LEN / 2, RAIL_SLEEPER_W, RAIL_SLEEPER_LEN);
                    }
                } else {
                    railCtx.fillStyle = "#8A8A92";
                    railCtx.fillRect(0, -RAIL_GAUGE / 2 - RAIL_RAIL_W / 2, L + 1, RAIL_RAIL_W);
                    railCtx.fillRect(0, RAIL_GAUGE / 2 - RAIL_RAIL_W / 2, L + 1, RAIL_RAIL_W);
                }
                railCtx.restore();
            }
        }
    }
}

// A switch stand: a post, and a BLADE pointing at the branch it is set for.
// Green for the first branch, amber for the second -- the only two states, so
// the colour is the whole readout.
function railDrawSwitches(now, inView) {
    for (let i = 0; i < railSwitches.length; i++) {
        const sw = railSwitches[i];
        if (!inView(sw.lx - 30, sw.ly - 40, 60, 70)) continue;
        const set = sw.thrown === 0;
        const col = set ? RC_SWITCH_MAIN : RC_SWITCH_DIV;
        railCtx.fillStyle = "rgba(0,0,0,0.45)";
        railCtx.fillRect(sw.lx - 7, sw.ly - 4, 18, 10);
        railCtx.fillStyle = "#4A4A50";                       // the stand
        railCtx.fillRect(sw.lx - 5, sw.ly - 26, 10, 30);
        railCtx.fillStyle = now < sw.litUntil ? "#FFFFFF" : col;
        railCtx.fillRect(sw.lx - 11, sw.ly - 38, 22, 14);    // the target plate
        railCtx.fillStyle = "#101014";
        railCtx.fillRect(sw.lx - 2, sw.ly - 35, 4, 8);
        // A tie bar at the node itself, so the points are visible on the rail.
        const n = railNodes[sw.node];
        railCtx.strokeStyle = col;
        railCtx.lineWidth = 4;
        railCtx.beginPath();
        railCtx.moveTo(n.x - 22, n.y);
        railCtx.lineTo(n.x + 22, n.y);
        railCtx.stroke();
    }
}

// ---------------------------------------------------
//   CARS: four kinds, drawn in the car's own frame
// ---------------------------------------------------
// Everything below is in LOCAL coordinates after a translate+rotate, which is
// what lets one body of art serve a car on a straight and the same car on the
// loop's 300px curve.
function railDrawCar(c, now) {
    const half = c.len / 2, hw = c.wid / 2;
    railCtx.save();
    railCtx.translate(c.cx, c.cy);
    railCtx.rotate(c.ang);

    // Shadow, then the underframe and the trucks poking out beneath.
    railCtx.fillStyle = "rgba(0,0,0,0.42)";
    railCtx.fillRect(-half + 7, -hw + 8, c.len, c.wid);
    railCtx.fillStyle = "#23201C";
    railCtx.fillRect(-half + 18, -hw - 5, 34, c.wid + 10);
    railCtx.fillRect(half - 52, -hw - 5, 34, c.wid + 10);
    railCtx.fillStyle = "#3A2C22";
    railCtx.fillRect(-half, -hw, c.len, c.wid);

    if (c.kind === "loco") railDrawLoco(c, half, hw, now);
    else if (c.kind === "flatbed") railDrawFlat(c, half, hw);
    else if (c.kind === "boxcar") railDrawBox(c, half, hw);
    else railDrawPassenger(c, half, hw);

    // Couplers at both ends, on every kind.
    railCtx.fillStyle = "#5A5A62";
    railCtx.fillRect(half - 2, -5, 8, 10);
    railCtx.fillRect(-half - 6, -5, 8, 10);
    railCtx.restore();
}

function railDrawLoco(c, half, hw, now) {
    // THE NOSE IS THE DANGEROUS END and is drawn to say so: a red pilot
    // wedge, which is the same 26px band railLocoNoseKill tests.
    railCtx.fillStyle = "#2A2E33";
    railCtx.fillRect(-half + 4, -hw + 4, c.len - 8, c.wid - 8);
    railCtx.fillStyle = "#3C4248";                       // the long hood
    railCtx.fillRect(-half + 26, -hw + 9, c.len - 58, c.wid - 18);
    // Boiler bands.
    railCtx.fillStyle = "#2A2E33";
    for (let x = -half + 40; x < half - 40; x += 24) railCtx.fillRect(x, -hw + 9, 4, c.wid - 18);
    // The cab, at the rear: where the pilot seat prompt fires.
    railCtx.fillStyle = "#4A5056";
    railCtx.fillRect(-half + 6, -hw + 5, c.len * RAIL_PILOT_FRAC, c.wid - 10);
    railCtx.fillStyle = "#1A1E22";
    railCtx.fillRect(-half + 14, -hw + 13, c.len * RAIL_PILOT_FRAC - 18, c.wid - 26);
    // A lamp that lights when under power.
    const lit = railBodies[c.body] && railBodies[c.body].notch > 0;
    railCtx.fillStyle = lit ? "#FFF2A8" : "#5A5A50";
    railCtx.fillRect(half - 16, -7, 10, 14);
    // The pilot.
    railCtx.fillStyle = "#8A1C18";
    railCtx.fillRect(half - 26, -hw + 2, 22, c.wid - 4);
    railCtx.fillStyle = "#B4302A";
    for (let y = -hw + 4; y < hw - 6; y += 10) railCtx.fillRect(half - 24, y, 18, 4);
    // Blood tank on the hood, filling with the fuel level.
    const f = rClamp(c.fuel || 0, 0, 1);
    railCtx.fillStyle = "#241C1C";
    railCtx.fillRect(-half + 60, -10, 74, 20);
    railCtx.fillStyle = f > 0.25 ? RC_BLOOD_HOT : "#5A1016";
    railCtx.fillRect(-half + 62, -8, Math.round(70 * f), 16);
}

function railDrawFlat(c, half, hw) {
    railCtx.fillStyle = "#57432F";                       // the deck
    railCtx.fillRect(-half + 4, -hw + 4, c.len - 8, c.wid - 8);
    railCtx.fillStyle = "#43341F";                       // planking, along it
    for (let y = -hw + 10; y < hw - 7; y += 9) railCtx.fillRect(-half + 8, y, c.len - 16, 2);
    railCtx.fillStyle = "#6E5842";                       // end sills
    railCtx.fillRect(-half + 4, -hw + 4, 9, c.wid - 8);
    railCtx.fillRect(half - 13, -hw + 4, 9, c.wid - 8);
    // Stake pockets down both sides: what says "flat bed" rather than "slab".
    railCtx.fillStyle = "#2E2419";
    for (let x = -half + 24; x < half - 24; x += 28) {
        railCtx.fillRect(x, -hw + 2, 6, 5);
        railCtx.fillRect(x, hw - 7, 6, 5);
    }
}

// TWO OPENINGS ON THE SIDES, as asked, and the crates are drawn THROUGH them
// -- which is the only reason the openings read as openings from above.
function railDrawBox(c, half, hw) {
    const openW = Math.round(c.len * 0.22);
    railCtx.fillStyle = "#4A2E22";                       // the roof
    railCtx.fillRect(-half + 4, -hw + 4, c.len - 8, c.wid - 8);
    railCtx.fillStyle = "#3A2418";
    for (let x = -half + 16; x < half - 10; x += 22) railCtx.fillRect(x, -hw + 6, 3, c.wid - 12);
    // A running board ridge along the roof's spine.
    railCtx.fillStyle = "#5C3A2A";
    railCtx.fillRect(-half + 10, -6, c.len - 20, 12);
    // The two doorways, mirrored on both sides.
    const doorX = [-openW - 14, 14];
    for (let i = 0; i < doorX.length; i++) {
        const x = doorX[i];
        railCtx.fillStyle = "#120C08";                   // the dark interior
        railCtx.fillRect(x, -hw + 4, openW, c.wid - 8);
        // Crates visible inside this opening.
        for (let k = 0; k < c.crates.length; k++) {
            const cr = c.crates[k];
            if (cr.o < x - 6 || cr.o > x + openW - cr.s + 6) continue;
            railCtx.fillStyle = cr.t > 0.5 ? "#6A5330" : "#5A4428";
            railCtx.fillRect(cr.o, cr.a - cr.s / 2, cr.s, cr.s);
            railCtx.fillStyle = "#2E2417";
            railCtx.fillRect(cr.o, cr.a - cr.s / 2, cr.s, 3);
        }
        railCtx.strokeStyle = "#6E4A33";                 // the door frame
        railCtx.lineWidth = 3;
        railCtx.strokeRect(x, -hw + 4, openW, c.wid - 8);
    }
}

function railDrawPassenger(c, half, hw) {
    railCtx.fillStyle = "#2C3A44";
    railCtx.fillRect(-half + 4, -hw + 4, c.len - 8, c.wid - 8);
    railCtx.fillStyle = "#3A4C58";                       // the clerestory roof
    railCtx.fillRect(-half + 8, -hw + 13, c.len - 16, c.wid - 26);
    // Windows down both sides, and seat backs between them.
    railCtx.fillStyle = "#0E1418";
    for (let x = -half + 22; x < half - 28; x += 22) {
        railCtx.fillRect(x, -hw + 6, 14, 6);
        railCtx.fillRect(x, hw - 12, 14, 6);
    }
    railCtx.fillStyle = "#53402C";
    for (let x = -half + 26; x < half - 30; x += 22) {
        railCtx.fillRect(x, -hw + 15, 10, 7);
        railCtx.fillRect(x, hw - 22, 10, 7);
    }
    // End vestibules, so it is obviously boardable.
    railCtx.fillStyle = "#1E282E";
    railCtx.fillRect(-half + 4, -14, 14, 28);
    railCtx.fillRect(half - 18, -14, 14, 28);
}

// ---------------------------------------------------
//   SCENERY
// ---------------------------------------------------
const RAIL_TREE_LIFT = 30;
const RAIL_TREE_SHADES = ["#1F4A1A", "#28581F", "#1A4216", "#2E6024"];
const RAIL_TRUNK_W = 14;

function railTreeFullHeight(cw) {
    return RAIL_TREE_LIFT + Math.round((cw || RM_TREE_CANOPY) * 0.8) + 8;
}

function railDrawTree(t) {
    const cx = t.x + t.w / 2;
    const lift = RAIL_TREE_LIFT;
    const cw = t.cw || RM_TREE_CANOPY, ch = Math.round(cw * 0.8);
    railCtx.fillStyle = "rgba(0,0,0,0.42)";
    railCtx.fillRect(Math.round(cx - RM_TREE_TRUNK / 2) + 6, t.y + t.h - RM_TREE_TRUNK + 6, RM_TREE_TRUNK, RM_TREE_TRUNK);
    railCtx.fillStyle = "#3A2614";
    railCtx.fillRect(Math.round(cx - RAIL_TRUNK_W / 2), t.y + t.h - lift - 6, RAIL_TRUNK_W, lift + 6);
    const top = t.y + t.h - lift - ch;
    const shade = RAIL_TREE_SHADES[Math.floor(t.shade * RAIL_TREE_SHADES.length) % RAIL_TREE_SHADES.length];
    railCtx.fillStyle = "#132A0F";
    railCtx.fillRect(Math.round(cx - cw / 2), top + Math.round(ch * 0.55), cw, Math.round(ch * 0.45));
    railCtx.fillStyle = shade;
    railCtx.fillRect(Math.round(cx - cw / 2), top, cw, Math.round(ch * 0.6));
    railCtx.fillRect(Math.round(cx - cw * 0.35), top - 8, Math.round(cw * 0.7), 10);
    railCtx.fillStyle = "#3A6A2C";
    railCtx.fillRect(Math.round(cx - cw * 0.3), top - 4, Math.round(cw * 0.35), 7);
}

function railDrawProp(p) {
    railCtx.fillStyle = "rgba(0,0,0,0.40)";
    railCtx.fillRect(p.x + 6, p.y + 7, p.w, p.h);
    if (p.kind === "platform") {
        railCtx.fillStyle = "#5A5A5E";
        railCtx.fillRect(p.x, p.y, p.w, p.h);
        railCtx.fillStyle = "#8C8C90";
        railCtx.fillRect(p.x, p.y, p.w, p.h - 8);
        railCtx.fillStyle = "#FFE033";                   // the platform edge line
        railCtx.fillRect(p.x + p.w - 5, p.y, 3, p.h - 8);
        return;
    }
    if (p.kind === "crate") {
        railCtx.fillStyle = "#5A4428";
        railCtx.fillRect(p.x, p.y, p.w, p.h);
        railCtx.fillStyle = "#6A5330";
        railCtx.fillRect(p.x + 2, p.y + 2, p.w - 4, p.h - 10);
        railCtx.fillStyle = "#2E2417";
        railCtx.fillRect(p.x + 2, p.y + Math.round(p.h / 2) - 2, p.w - 4, 3);
        return;
    }
    if (p.kind === "tower") {
        railCtx.fillStyle = "#2E2A26";
        railCtx.fillRect(p.x, p.y, p.w, p.h);
        railCtx.fillStyle = "#4A443C";
        railCtx.fillRect(p.x + 4, p.y + 4, p.w - 8, p.h - 20);
        railCtx.fillStyle = "#6A6256";
        railCtx.fillRect(p.x + 10, p.y + 10, p.w - 20, p.h - 34);
        railCtx.fillStyle = "#1A1714";                   // the spout
        railCtx.fillRect(p.x + p.w - 6, p.y + p.h - 26, 18, 7);
        return;
    }
    // shed / warehouse
    railCtx.fillStyle = "#23201C";
    railCtx.fillRect(p.x, p.y, p.w, p.h);
    railCtx.fillStyle = p.kind === "warehouse" ? "#44403A" : "#4E463C";
    railCtx.fillRect(p.x + 3, p.y + 3, p.w - 6, p.h - 6);
    railCtx.fillStyle = "#2E2A24";                       // roof ribs
    for (let x = p.x + 10; x < p.x + p.w - 8; x += 18) railCtx.fillRect(x, p.y + 6, 4, p.h - 12);
    railCtx.fillStyle = "#15120F";                       // a doorway
    railCtx.fillRect(p.x + Math.round(p.w / 2) - 16, p.y + p.h - 10, 32, 9);
}

function railDrawSilo(s, now) {
    const lift = 92;
    railCtx.fillStyle = "rgba(0,0,0,0.45)";
    railCtx.fillRect(s.x + 8, s.y + 10, s.w, s.h);
    // The tank: a tall drum, lifted, with blood showing through a gauge slot.
    railCtx.fillStyle = "#2A2622";
    railCtx.fillRect(s.x, s.y - lift, s.w, s.h + lift);
    railCtx.fillStyle = "#3E3A34";
    railCtx.fillRect(s.x + 4, s.y - lift + 4, s.w - 8, s.h + lift - 8);
    railCtx.fillStyle = "#4E4A42";
    for (let y = s.y - lift + 10; y < s.y + s.h - 8; y += 22) railCtx.fillRect(s.x + 6, y, s.w - 12, 3);
    // THE GAUGE. The only thing on the silo that moves, so it is what the eye
    // goes to from across the map.
    const gh = s.h + lift - 34;
    const f = rClamp(s.fill / s.cap, 0, 1);
    railCtx.fillStyle = "#17120F";
    railCtx.fillRect(s.x + s.w / 2 - 13, s.y - lift + 17, 26, gh);
    railCtx.fillStyle = RC_BLOOD;
    railCtx.fillRect(s.x + s.w / 2 - 11, s.y - lift + 17 + gh - Math.round(gh * f), 22, Math.round(gh * f));
    railCtx.strokeStyle = "#5A564E";
    railCtx.lineWidth = 2;
    railCtx.strokeRect(s.x + s.w / 2 - 13, s.y - lift + 17, 26, gh);
    // The pump stand, on the rail side, lit while running.
    const p = railPose(s.pump.e, s.pump.s);
    railCtx.fillStyle = "#302C28";
    railCtx.fillRect(p.x - 9, p.y - 46, 18, 22);
    railCtx.fillStyle = s.pumpOn ? (Math.floor(now / 140) % 2 ? RC_BLOOD_HOT : "#FF6A4A") : "#4A4A50";
    railCtx.fillRect(p.x - 6, p.y - 43, 12, 16);
    // A hose from the tank to the stand while pumping.
    if (s.pumpOn) {
        railCtx.strokeStyle = RC_BLOOD;
        railCtx.lineWidth = 6;
        railCtx.beginPath();
        railCtx.moveTo(s.x + s.w / 2, s.y + s.h - 14);
        railCtx.lineTo(p.x, p.y - 30);
        railCtx.stroke();
    }
    // Its name, so the fuel stops are identifiable from the minimap's labels.
    railCtx.fillStyle = "rgba(255,224,51,0.78)";
    railCtx.font = "bold 15px 'Courier New', monospace";
    railCtx.textAlign = "center";
    railCtx.fillText(s.name, s.x + s.w / 2, s.y - lift - 10);
    railCtx.textAlign = "left";
}

function railDrawWallsDoors(inView) {
    for (let i = 0; i < railWalls.length; i++) {
        const w = railWalls[i];
        if (!inView(w.x - 6, w.y - 10, w.w + 12, w.h + 20)) continue;
        railCtx.fillStyle = "rgba(0,0,0,0.45)";
        railCtx.fillRect(w.x + 5, w.y + 6, w.w, w.h);
        railCtx.fillStyle = "#5A5A60";
        railCtx.fillRect(w.x, w.y, w.w, w.h);
        railCtx.fillStyle = "#74747C";
        railCtx.fillRect(w.x, w.y, w.w, Math.min(8, w.h));
        railCtx.fillStyle = "#3A3A40";
        for (let x = w.x; x < w.x + w.w; x += 26) railCtx.fillRect(x, w.y, 2, w.h);
    }
    for (let i = 0; i < railDoors.length; i++) {
        const d = railDoors[i];
        if (!inView(d.x - 10, d.y - 10, d.w + 20, d.h + 20)) continue;
        if (d.open) {
            // Open: the jambs only, so the gap is unmistakably clear.
            railCtx.fillStyle = "#3A3A40";
            if (d.w > d.h) { railCtx.fillRect(d.x, d.y, 5, d.h); railCtx.fillRect(d.x + d.w - 5, d.y, 5, d.h); }
            else { railCtx.fillRect(d.x, d.y, d.w, 5); railCtx.fillRect(d.x, d.y + d.h - 5, d.w, 5); }
            continue;
        }
        railCtx.fillStyle = d.rail ? "#6A4A20" : "#4A4A7A";
        railCtx.fillRect(d.x, d.y, d.w, d.h);
        railCtx.fillStyle = d.rail ? "#8A6428" : "#6A6A9A";
        railCtx.fillRect(d.x + 3, d.y + 3, d.w - 6, d.h - 6);
        // Hazard stripes on a RAIL crossing, plain boards on a foot door --
        // so you can see from a distance which doors are on the line.
        if (d.rail) {
            railCtx.fillStyle = "#1A1410";
            const along = d.w > d.h;
            for (let o = 0; o < (along ? d.w : d.h); o += 18) {
                if (along) railCtx.fillRect(d.x + o, d.y + 4, 8, d.h - 8);
                else railCtx.fillRect(d.x + 4, d.y + o, d.w - 8, 8);
            }
        }
        railCtx.fillStyle = "#55FF55";
        railCtx.font = "bold 14px 'Courier New', monospace";
        railCtx.textAlign = "center";
        railCtx.fillText(String(d.cost), d.x + d.w / 2, d.y + d.h / 2 + 5);
        railCtx.textAlign = "left";
    }
}

function railDrawBoulders(inView) {
    for (let i = 0; i < railBoulders.length; i++) {
        const b = railBoulders[i];
        if (!inView(b.x - 8, b.y - 12, b.w + 16, b.h + 24)) continue;
        railCtx.fillStyle = "rgba(0,0,0,0.45)";
        railCtx.fillRect(b.x + 5, b.y + 6, b.w, b.h);
        railCtx.fillStyle = "#44444A";
        railCtx.fillRect(b.x, b.y, b.w, b.h);
        railCtx.fillStyle = "#5C5C64";
        railCtx.fillRect(b.x + 4, b.y + 3, b.w - 12, b.h - 12);
        railCtx.fillStyle = "#2E2E34";
        railCtx.fillRect(b.x + b.w - 14, b.y + b.h - 12, 12, 9);
    }
}

// ---------------------------------------------------
//   PLAYER, SHOTS, LIGHTING
// ---------------------------------------------------
function railDrawPlayer() {
    const p = railPlayer;
    if (!p || p.dead) return;
    railCtx.fillStyle = "rgba(0,0,0,0.45)";
    railCtx.fillRect(p.x + 3, p.y + 4, p.size, p.size);
    railCtx.fillStyle = p.color;
    railCtx.fillRect(p.x, p.y, p.size, p.size);
    railCtx.fillStyle = "#000";
    railCtx.fillRect(p.x + 3, p.y + 4, 3, 3);
    railCtx.fillRect(p.x + p.size - 6, p.y + 4, 3, 3);
    // The gun, pointing where the mouse is.
    const cx = p.x + p.size / 2, cy = p.y + p.size / 2;
    railCtx.strokeStyle = railGun === "rocket" ? "#FFB000" : "#00E5FF";
    railCtx.lineWidth = 4;
    railCtx.beginPath();
    railCtx.moveTo(cx, cy);
    railCtx.lineTo(cx + Math.cos(p.aimAng) * 22, cy + Math.sin(p.aimAng) * 22);
    railCtx.stroke();
    // A ring while riding, so "I am on the deck" is visible rather than felt.
    if (p.onCar) {
        railCtx.strokeStyle = "rgba(255,224,51,0.75)";
        railCtx.lineWidth = 2;
        railCtx.strokeRect(p.x - 5, p.y - 5, p.size + 10, p.size + 10);
    }
}

function railDrawShots() {
    railCtx.fillStyle = RC_BULLET;
    for (let i = 0; i < railBullets.length; i++) {
        const b = railBullets[i];
        railCtx.fillRect(b.x - 2, b.y - 2, 4, 4);
    }
    for (let i = 0; i < railRockets.length; i++) {
        const r = railRockets[i];
        railCtx.fillStyle = "#FFB000";
        railCtx.fillRect(r.x - 4, r.y - 4, 9, 9);
        railCtx.fillStyle = "rgba(255,120,40,0.5)";
        railCtx.fillRect(r.x - r.vx * 0.012 - 3, r.y - r.vy * 0.012 - 3, 7, 7);
    }
    for (let i = 0; i < railBlasts.length; i++) {
        const b = railBlasts[i];
        const t = 1 - b.t / b.max;
        railCtx.strokeStyle = "rgba(255," + Math.round(180 - t * 120) + ",60," + (1 - t) + ")";
        railCtx.lineWidth = 8 * (1 - t) + 2;
        railCtx.beginPath();
        railCtx.arc(b.x, b.y, b.r * (0.25 + t * 0.9), 0, Math.PI * 2);
        railCtx.stroke();
    }
}

// Ported from zombie-render.js, NOTHING about the balance moved: 340 radius,
// 1.33 fade, four bands. Drawn as DISJOINT annuli with source-over only --
// the obvious implementation (flat ambient, then destination-out to punch the
// light back out) erases the WORLD inside the pocket, not just the darkness,
// which measured on 2026-09-04 as a transparent hole exactly where the player
// is meant to see.
const RAIL_AMBIENT = 0.56;       // the sandbox is dusk, not a blackout

function railDrawLighting() {
    const dark = RAIL_AMBIENT;
    const p = railPlayer;
    const c = p ? railWorldToScreen(p.x + p.size / 2, p.y + p.size / 2)
                : railWorldToScreen(railCam.x, railCam.y);
    const inner = RAIL_LIGHT_RADIUS * railCam.scale;
    const outer = inner * RAIL_LIGHT_FADE;
    const steps = RAIL_LIGHT_BANDS - 1;

    railCtx.fillStyle = "rgba(0,0,0," + dark + ")";
    railCtx.beginPath();
    railCtx.rect(0, 0, railCanvas.width, railCanvas.height);
    railCtx.arc(c.x, c.y, outer, 0, Math.PI * 2);
    railCtx.fill("evenodd");

    for (let i = 1; i < steps; i++) {
        const rOut = outer - (outer - inner) * ((i - 1) / (steps - 1));
        const rIn = outer - (outer - inner) * (i / (steps - 1));
        railCtx.fillStyle = "rgba(0,0,0," + (dark * (steps - i) / steps) + ")";
        railCtx.beginPath();
        railCtx.arc(c.x, c.y, rOut, 0, Math.PI * 2);
        railCtx.arc(c.x, c.y, rIn, 0, Math.PI * 2);
        railCtx.fill("evenodd");
    }
    // A locomotive under power throws its own pocket, so a train arriving is
    // visible before it is on top of you.
    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        const loco = railBodyLoco(b);
        if (!loco || b.notch <= 0) continue;
        const sc = railWorldToScreen(loco.cx + Math.cos(loco.ang) * 150,
                                     loco.cy + Math.sin(loco.ang) * 150);
        const rr = 190 * railCam.scale;
        railCtx.fillStyle = "rgba(255,240,180,0.09)";
        railCtx.beginPath();
        railCtx.arc(sc.x, sc.y, rr, 0, Math.PI * 2);
        railCtx.fill();
    }
}

// ---------------------------------------------------
//   THE SIDEBAR  (the arcade's cabinet panel, scrubbed)
// ---------------------------------------------------
// Kept: the radar, because a rail network is the thing a minimap is actually
// for. Added: the train readout and the fuel gauge. GONE: HI-SCORE, 1UP,
// SESSION BEST, lives, CONDITION and the goal list -- none of them mean
// anything without rounds or a score, and leaving them in would have made the
// panel a costume rather than an instrument.
// The title line states the REAL state, not the default. `?zombies=1` and the
// dev panel's toggle both have to show up here or the page lies about itself.
// Called from railBoot and from railZombSetEnabled.
function railUpdateTitle() {
    const el = document.getElementById("title");
    if (!el) return;
    const on = typeof railZombiesOn !== "undefined" && railZombiesOn;
    el.innerHTML = "<b>RAIL SANDBOX</b> — ZOMBIE RAIL · NO LEVELS, NO ROUNDS · ZOMBIES " +
                   (on ? "ON" : "OFF");
}

function railSidebarWidth() {
    const el = document.getElementById("sidebar");
    if (!el) return 0;
    const r = el.getBoundingClientRect();
    return Math.round(r.width) || 0;
}

let railHudLast = 0;

function railHudUpdate(now) {
    if (now - railHudLast < 100) return;          // 10Hz is plenty for text
    railHudLast = now;

    const seat = railPilotCarFor(railPlayer);
    const aboard = railPlayer && railPlayer.onCar;
    // The body being reported: the one you are driving, else the one you are
    // standing on, else the one with the locomotive.
    let b = seat ? seat.body : null;
    if (!b && aboard) b = railBodies[railPlayer.onCar.body];
    if (!b) { for (let i = 0; i < railBodies.length; i++) if (railHasLoco(railBodies[i])) { b = railBodies[i]; break; } }

    const set = function (id, text) {
        const el = document.getElementById(id);
        if (el && el.textContent !== text) el.textContent = text;
    };
    set("hudSpeed", b ? String(Math.round(Math.abs(b.v))) : "—");
    set("hudNotch", b && railHasLoco(b) ? railNotchLabel(b.notch) : "—");
    set("hudDir", b && railHasLoco(b) ? (b.dir > 0 ? "FORWARD" : "REVERSE") : "—");
    set("hudCars", b ? String(b.cars.length) : "0");
    set("hudScrap", String(railScrap));

    // FUEL IS SHOWN ONLY WHILE IN THE LOCOMOTIVE, as asked. Standing on the
    // deck of the loco counts; standing in a box car three cars back does not
    // -- the gauge is in the cab.
    const loco = b ? railBodyLoco(b) : null;
    const inLoco = !!(loco && railPlayer && railPlayer.onCar && railPlayer.onCar.id === loco.id);
    const fuelBox = document.getElementById("hudFuelBox");
    if (fuelBox) fuelBox.style.display = inLoco ? "block" : "none";
    if (inLoco) {
        const f = rClamp(loco.fuel || 0, 0, 1);
        set("hudFuelPct", Math.round(f * 100) + "%");
        const bar = document.getElementById("hudFuelBar");
        if (bar) {
            bar.style.width = Math.round(f * 100) + "%";
            bar.style.background = f < 0.2 ? "#FF2233" : (f < 0.45 ? "#FFE033" : RC_BLOOD_HOT);
        }
    }

    // Silos.
    const ul = document.getElementById("hudSilos");
    if (ul) {
        let html = "";
        for (let i = 0; i < railSilos.length; i++) {
            const s = railSilos[i];
            const pct = Math.round((s.fill / s.cap) * 100);
            html += '<li' + (s.pumpOn ? ' class="on"' : '') + '><span>' + s.name +
                    '</span><b>' + pct + '%</b></li>';
        }
        if (ul.innerHTML !== html) ul.innerHTML = html;
    }

    // Points.
    const pl = document.getElementById("hudPoints");
    if (pl) {
        let html = "";
        for (let i = 0; i < railSwitches.length; i++) {
            const sw = railSwitches[i];
            const to = railEdges[sw.branches[sw.thrown]];
            html += '<li><span>' + (railNodes[sw.node] ? ("PTS " + (i + 1)) : "PTS") +
                    '</span><b class="' + (sw.thrown ? "div" : "main") + '">' +
                    (to ? (to.label || to.name) : "?") + '</b></li>';
        }
        if (pl.innerHTML !== html) pl.innerHTML = html;
    }

    railDrawMinimap();
}

// The radar: the whole network, every car, the silos and the player. Drawn at
// 10Hz with the HUD rather than per frame -- it is a reference, not an
// animation, and it is the one DOM-side canvas on the page.
function railDrawMinimap() {
    const cv = document.getElementById("sidemap");
    if (!cv) return;
    const g = cv.getContext("2d");
    const sc = Math.min(cv.width / RAIL_WORLD_W, cv.height / RAIL_WORLD_H);
    const ox = (cv.width - RAIL_WORLD_W * sc) / 2;
    const oy = (cv.height - RAIL_WORLD_H * sc) / 2;
    const X = function (x) { return ox + x * sc; };
    const Y = function (y) { return oy + y * sc; };

    g.fillStyle = "#000";
    g.fillRect(0, 0, cv.width, cv.height);
    // The forest band, so the two towns read as separated.
    g.fillStyle = "#0E1C0C";
    g.fillRect(X(RM_FOREST.x0), oy, (RM_FOREST.x1 - RM_FOREST.x0) * sc, RAIL_WORLD_H * sc);

    // The network.
    g.strokeStyle = "#4A5A50";
    g.lineWidth = 1.6;
    for (let i = 0; i < railEdges.length; i++) {
        const E = railEdges[i];
        g.beginPath();
        for (let k = 0; k < E.pts.length; k++) {
            if (k === 0) g.moveTo(X(E.pts[k].x), Y(E.pts[k].y));
            else g.lineTo(X(E.pts[k].x), Y(E.pts[k].y));
        }
        g.stroke();
    }
    // Shut rail crossings, as a bar across the line.
    for (let i = 0; i < railDoors.length; i++) {
        const d = railDoors[i];
        if (!d.rail || d.open) continue;
        g.fillStyle = "#FF6A20";
        g.fillRect(X(d.x) - 1, Y(d.y) - 1, Math.max(3, d.w * sc), Math.max(3, d.h * sc));
    }
    // Silos, coloured by how full they are.
    for (let i = 0; i < railSilos.length; i++) {
        const s = railSilos[i];
        const f = s.fill / s.cap;
        g.fillStyle = f > 0.05 ? RC_BLOOD_HOT : "#4A3034";
        g.fillRect(X(s.x + s.w / 2) - 3, Y(s.y + s.h / 2) - 3, 6, 6);
    }
    // Points.
    for (let i = 0; i < railSwitches.length; i++) {
        const sw = railSwitches[i];
        g.fillStyle = sw.thrown ? RC_SWITCH_DIV : RC_SWITCH_MAIN;
        g.fillRect(X(sw.lx) - 2, Y(sw.ly) - 2, 4, 4);
    }
    // Cars: the locomotive white, everything else steel.
    for (let i = 0; i < railCars.length; i++) {
        const c = railCars[i];
        g.fillStyle = c.kind === "loco" ? "#FFFFFF" : "#9AA0A8";
        g.fillRect(X(c.cx) - 2, Y(c.cy) - 2, 4, 4);
    }
    // The player, and the view box.
    if (railPlayer) {
        g.fillStyle = railPlayer.color;
        g.fillRect(X(railPlayer.x) - 2, Y(railPlayer.y) - 2, 5, 5);
    }
    const vr = railViewRect();
    g.strokeStyle = "rgba(255,255,255,0.35)";
    g.lineWidth = 1;
    g.strokeRect(X(vr.x), Y(vr.y), vr.w * sc, vr.h * sc);
}

// ---------------------------------------------------
//   THE FRAME
// ---------------------------------------------------
// Tall things are drawn back to front in ONE sorted pass, by the bottom of
// their footprint -- so a car passes behind a tree whose trunk is further
// down the screen and in front of one above it. Without the sort a canopy
// drawn after a locomotive hides it completely.
function railDrawWorld(now) {
    const vr = railViewRect();
    const inView = railInViewFn();

    railDrawGround(vr);
    railDrawTrack(inView);
    railDrawSwitches(now, inView);
    railDrawBoulders(inView);

    const tall = [];
    for (let i = 0; i < railTrees.length; i++) {
        const t = railTrees[i];
        if (inView(t.x - 40, t.y - railTreeFullHeight(t.cw), t.w + 80, t.h + railTreeFullHeight(t.cw) + 20)) {
            tall.push({ y: t.y + t.h, tree: t });
        }
    }
    for (let i = 0; i < railProps.length; i++) {
        const p = railProps[i];
        if (inView(p.x - 8, p.y - 8, p.w + 16, p.h + 16)) tall.push({ y: p.y + p.h, prop: p });
    }
    for (let i = 0; i < railSilos.length; i++) {
        const s = railSilos[i];
        if (inView(s.x - 20, s.y - 200, s.w + 40, s.h + 220)) tall.push({ y: s.y + s.h, silo: s });
    }
    for (let i = 0; i < railCars.length; i++) {
        const c = railCars[i];
        const r = Math.max(c.len, c.wid);
        if (inView(c.cx - r, c.cy - r, r * 2, r * 2)) tall.push({ y: c.cy + c.wid / 2, car: c });
    }
    if (typeof railZombies !== "undefined" && railZombiesOn) {
        for (let i = 0; i < railZombies.length; i++) {
            const z = railZombies[i];
            if (inView(z.x - 6, z.y - 10, z.size + 12, z.size + 16)) tall.push({ y: z.y + z.size, zomb: z });
        }
    }
    if (railPlayer && !railPlayer.dead) tall.push({ y: railPlayer.y + railPlayer.size, me: true });

    tall.sort(function (a, b) { return a.y - b.y; });
    for (let i = 0; i < tall.length; i++) {
        const t = tall[i];
        if (t.tree) railDrawTree(t.tree);
        else if (t.prop) railDrawProp(t.prop);
        else if (t.silo) railDrawSilo(t.silo, now);
        else if (t.car) railDrawCar(t.car, now);
        else if (t.zomb) railDrawZombie(t.zomb);
        else if (t.me) railDrawPlayer();
    }

    railDrawWallsDoors(inView);
    railDrawShots();
}

function railStep(now, dt) {
    railCarsUpdate(now, dt);
    railPumpUpdate(now, dt);
    railPlayerUpdate(now, dt);
    if (typeof railZombUpdate === "function") railZombUpdate(now, dt);
}

let railPaused = false;
let railLastFrame = 0;

function railFrame(ts) {
    railRaf = requestAnimationFrame(railFrame);
    const now = Date.now();
    if (!railLastFrame) railLastFrame = ts;
    const elapsed = Math.min(400, ts - railLastFrame);
    railLastFrame = ts;

    if (!railPaused) {
        // Fixed 60Hz steps from an accumulator. Movement is px per call, so
        // one call per rendered frame would run the sim 2.4x fast on a 144Hz
        // monitor -- the exact bug the arcade's Z_STEP_MS exists to prevent.
        railSimAcc += elapsed;
        let steps = 0;
        while (railSimAcc >= RAIL_STEP_MS && steps < RAIL_MAX_STEPS) {
            railStep(now, RAIL_STEP_MS);
            railSimAcc -= RAIL_STEP_MS;
            steps++;
        }
        if (steps === RAIL_MAX_STEPS) railSimAcc = 0;      // do not bank a backlog
    }

    railUpdateCamera(railPlayer && !railPlayer.dead ? { x: railPlayer.x, y: railPlayer.y } : null);

    railCtx.setTransform(1, 0, 0, 1, 0, 0);
    railCtx.fillStyle = "#000";
    railCtx.fillRect(0, 0, railCanvas.width, railCanvas.height);
    railApplyCamera();
    railDrawWorld(now);
    railCtx.setTransform(1, 0, 0, 1, 0, 0);
    railDrawLighting();

    railToastTick(now);
    railHudUpdate(now);
}

// ---------------------------------------------------
//   BOOT  +  GameInstance
// ---------------------------------------------------
function railBoot() {
    const E = railMapBuild();
    railPlaceStock(E);
    railFuelReset();
    railPlayerReset();
    if (typeof railZombReset === "function") railZombReset();
    // ZOMBIES OFF BY DEFAULT. `?zombies=1` is the opt-in, and the dev panel
    // can toggle it at any time -- the flag is read every frame, never cached.
    if (typeof railZombSetEnabled === "function") {
        railZombSetEnabled(new URLSearchParams(window.location.search).get("zombies") === "1");
    }
    railResizeCanvas();
    railBindInput();
    railBindHeldF();
    // Audio needs a gesture, so it is created on the first one rather than at
    // load (GAME_PROTOTYPE_INSTRUCTIONS.md §4: never autoplay on load).
    const once = function () { railAudioInit(); };
    window.addEventListener("pointerdown", once, { once: true, signal: railSignal() });
    window.addEventListener("keydown", once, { once: true, signal: railSignal() });

    // Short, because the full key list is permanently in the sidebar.
    railUpdateTitle();
    railToast("RAIL SANDBOX — THE KEYS ARE IN THE PANEL", 3600);
    if (!railRaf) railRaf = requestAnimationFrame(railFrame);
    return E;
}

// Written to the contract even though nothing embeds it yet: cheap now,
// expensive to retrofit (GAME_PROTOTYPE_INSTRUCTIONS.md §2).
window.GameInstance = {
    init: function () { return railBoot(); },
    start: function () { railPaused = false; if (!railRaf) railRaf = requestAnimationFrame(railFrame); },
    pause: function () { railPaused = true; },
    resume: function () { railPaused = false; },
    destroy: function () { railTeardown(); if (window.DEVTOOLS) DEVTOOLS.destroy(); },
    getState: function () {
        return {
            bodies: railBodies.length,
            cars: railCars.length,
            silos: railSilos.map(function (s) { return Math.round(s.fill * 100) / 100; }),
            points: railSwitches.map(function (s) { return s.thrown; }),
            scrap: railScrap,
            player: railPlayer ? { x: Math.round(railPlayer.x), y: Math.round(railPlayer.y), dead: railPlayer.dead } : null
        };
    }
};

railBoot();
