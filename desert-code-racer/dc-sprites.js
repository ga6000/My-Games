// ===================================================
//   Desert Code Racer — pixel-art crew sprites
// ===================================================
// Ry, 2026-11-23: "I'd like for the characters to not be vector drawn, and to
// be pixelized to more closely resemble the pixel characters on the lineup
// reference. also adapt the size of character to match the lineup."
// Reference: /mnt/project-files/characters/crew-lineup-reference.png
// (CREW_LOOK.md has the per-character breakdown).
//
// Each crew member is painted once, at load, into small offscreen canvases
// (one per frame) by a tiny pixel painter: flat shapes in the sheet's colours,
// then an automatic pass that lights the top edges, darkens the bottom and
// right edges, adds a fine grit and a dark outline, the way the lineup's
// pixels are lit from the lamp overhead. The game draws those canvases scaled
// up with smoothing off, so the pixels stay square.
//
// Frames per class:
//   ride0, ride1  seen from behind in the saddle (1 = wind flap: cape, tails)
//   stand, runA, runB, reach, flail  seen from the front, off the bike
//
// Sizes follow the lineup (feet to top of head, Greer = 1): Maren 0.95,
// Elodie 0.94 (plus the hard hat), Soren 0.97 (hood), Bex 0.96, Booke 1.04
// and half again as broad. One art pixel is the same size for everyone, so
// Booke is a bigger sprite, not a stretched one.
"use strict";

const DC_PX_RIDE = 0.0178;      // one art pixel, in units of s (s = 430 * u)
const DC_SPR_BUILD = {
    medic:    { k: 0.95, w: 0.95 },
    engineer: { k: 0.94, w: 0.95 },
    scout:    { k: 0.97, w: 0.95 },
    gunner:   { k: 1.00, w: 1.10 },
    butcher:  { k: 0.96, w: 1.02 },
    bulwark:  { k: 1.04, w: 1.45 },
    tech:     { k: 0.93, w: 0.95 }      // the friendly at the lab console (finale)
};

const DC_SPR_PAL = {
    medic: { coat: "#DCE4E8", scrub: "#2A8C8E", hair: "#2B1D1A", skin: "#C08A6A", boot: "#1E1A18", bag: "#5A3E26", glow: "#3FF0FF", glove: "#2A3034", belt: "#3A2C22" },
    engineer: { over: "#3559A0", shirt: "#8FA3BD", hat: "#F0A328", hair: "#1C1412", skin: "#7A4F36", belt: "#5C3D22", boot: "#9A6A38", metal: "#9AA4AC", glove: "#3A2A20" },
    scout: { cloak: "#4A5A30", suit: "#23252B", goggle: "#38C8FF", hood: "#141A10", boot: "#2E231C", belt: "#4A3424", skin: "#B88A70", glove: "#1E2024" },
    gunner: { vest: "#4C5733", fat: "#3B4229", skin: "#4A2E22", band: "#E0582A", ammo: "#2A2420", brass: "#D89A3A", gun: "#34383E", boot: "#2A201A", glove: "#1E1E1E" },
    butcher: { shirt: "#7E2329", apron: "#D8CCB0", blood: "#8A2A1E", hair: "#B4B4B0", skin: "#C4927A", pants: "#26262A", boot: "#4A3020", steel: "#B8BEC4", wood: "#5A3A22" },
    tech: { coat: "#B8C8D0", shirt: "#2E3A48", pants: "#2A2E36", hair: "#C8A060", skin: "#D0A080", boot: "#18181C", set: "#3FF0FF" },
    bulwark: { arm: "#5D646C", armD: "#3E444A", visor: "#FF8A1C", shield: "#4E555C", stripe: "#E0902A", rust: "#7A5A3A", joint: "#2A2E33" }
};

// ---------------------------------------------------
//   THE PAINTER
// ---------------------------------------------------
function dcHexRgb(h) { const n = parseInt(h.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; }

function dcPxNew(w, h) {
    // f marks "flat" pixels that the light pass leaves alone (glows, visor).
    return { w: w, h: h, d: new Array(w * h).fill(null), f: new Uint8Array(w * h) };
}
function dcPxPut(P, x, y, c, flat) {
    x = Math.round(x); y = Math.round(y);
    if (x < 0 || y < 0 || x >= P.w || y >= P.h || !c) return;
    P.d[y * P.w + x] = typeof c === "string" ? dcHexRgb(c) : c;
    P.f[y * P.w + x] = flat ? 1 : 0;
}
function dcPxRect(P, x, y, w, h, c, flat) {
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) dcPxPut(P, x + i, y + j, c, flat);
}
function dcPxEll(P, cx, cy, rx, ry, c) {
    for (let y = Math.floor(cy - ry); y <= Math.ceil(cy + ry); y++)
        for (let x = Math.floor(cx - rx); x <= Math.ceil(cx + rx); x++) {
            const dx = (x + 0.5 - cx) / rx, dy = (y + 0.5 - cy) / ry;
            if (dx * dx + dy * dy <= 1) dcPxPut(P, x, y, c);
        }
}
function dcPxPoly(P, pts, c) {
    let y0 = Infinity, y1 = -Infinity;
    for (let i = 1; i < pts.length; i += 2) { y0 = Math.min(y0, pts[i]); y1 = Math.max(y1, pts[i]); }
    for (let y = Math.floor(y0); y <= Math.ceil(y1); y++) {
        const yc = y + 0.5, xs = [];
        for (let i = 0; i < pts.length; i += 2) {
            const ax = pts[i], ay = pts[i + 1], bx = pts[(i + 2) % pts.length], by = pts[(i + 3) % pts.length];
            if ((ay <= yc && by > yc) || (by <= yc && ay > yc)) xs.push(ax + (yc - ay) / (by - ay) * (bx - ax));
        }
        xs.sort(function (a, b) { return a - b; });
        for (let k = 0; k + 1 < xs.length; k += 2)
            for (let x = Math.round(xs[k]); x < Math.round(xs[k + 1]); x++) dcPxPut(P, x, y, c);
    }
}
// A thick line: a run of t x t squares.
function dcPxLine(P, x0, y0, x1, y1, t, c, flat) {
    const n = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    const h = (t - 1) / 2;
    for (let i = 0; i <= n; i++) {
        const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
        dcPxRect(P, Math.round(x - h), Math.round(y - h), t, t, c, flat);
    }
}
// A limb through a joint.
function dcPxLimb(P, a, b, c, t, col) { dcPxLine(P, a[0], a[1], b[0], b[1], t, col); dcPxLine(P, b[0], b[1], c[0], c[1], t, col); }

function dcPxHash(x, y, s) { let h = (x * 374761393 + y * 668265263 + s * 2147483647) | 0; h = (h ^ (h >>> 13)) * 1274126177; return ((h ^ (h >>> 16)) >>> 0) / 4294967296; }

// Light, grit and outline, then out to a canvas.
function dcPxBake(P, seed) {
    const W = P.w, H = P.h, D = P.d;
    const cv = document.createElement("canvas");
    cv.width = W; cv.height = H;
    const g = cv.getContext("2d");
    const img = g.createImageData(W, H);
    const at = function (x, y) { return x < 0 || y < 0 || x >= W || y >= H ? null : D[y * W + x]; };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x, c = D[i], o = i * 4;
        if (c) {
            let m = 1;
            if (!P.f[i]) {
                // Round the forms: pixels near a side edge fall off into shadow,
                // more on the right (the lamp sits up and to the left).
                let dl = 0, dr = 0;
                while (dl < 5 && at(x - dl - 1, y)) dl++;
                while (dr < 5 && at(x + dr + 1, y)) dr++;
                m *= 0.58 + 0.24 * Math.min(1, dl / 3) + 0.34 * Math.min(1, dr / 4);
                if (!at(x, y - 1)) m *= 1.3;
                else if (!at(x, y - 2)) m *= 1.12;
                if (!at(x - 1, y)) m *= 1.1;
                if (!at(x + 1, y)) m *= 0.72;
                else if (!at(x + 2, y)) m *= 0.86;
                if (!at(x, y + 1)) m *= 0.78;
                m *= 1.12 - 0.22 * (y / H);                        // lamp overhead
                m *= 0.88 + 0.24 * dcPxHash(x, y, seed);           // grit
            }
            img.data[o] = Math.min(255, c[0] * m); img.data[o + 1] = Math.min(255, c[1] * m); img.data[o + 2] = Math.min(255, c[2] * m); img.data[o + 3] = 255;
        } else if (at(x - 1, y) || at(x + 1, y) || at(x, y - 1) || at(x, y + 1)) {
            img.data[o] = 6; img.data[o + 1] = 6; img.data[o + 2] = 10; img.data[o + 3] = 255;
        }
    }
    g.putImageData(img, 0, 0);
    return cv;
}

// ---------------------------------------------------
//   POSES (anchor points, rows above the feet; Greer-sized)
// ---------------------------------------------------
// Ride: seen from behind, hunched over the bars, knees out to the pegs.
const DC_POSE_RIDE = {
    foot: [8, 0], knee: [11, 10], hip: [6, 17], waist: 7, wy: 20, shoulder: 10, sy: 33,
    neck: 35, head: 40, elbow: [13, 29], hand: [15, 24]
};
// Front view, off the bike.
const DC_POSE_STAND = {
    foot: [4, 0], knee: [4, 15], hip: [5, 28], waist: 6, wy: 32, shoulder: 9, sy: 46,
    neck: 48, head: 53, elbow: [11, 37], hand: [11, 27]
};

// Builds the joint list for a frame in canvas pixels.
function dcPoseJoints(frame, B, cx, by) {
    const ride = frame === "ride0" || frame === "ride1";
    const A = ride ? DC_POSE_RIDE : DC_POSE_STAND;
    const k = B.k, w = B.w;
    const Y = function (v) { return by - v * k; };
    const X = function (v) { return cx + v * w; };
    const J = {
        ride: ride, k: k, w: w, cx: cx, by: by,
        footL: [X(-A.foot[0]), Y(A.foot[1])], footR: [X(A.foot[0]), Y(A.foot[1])],
        kneeL: [X(-A.knee[0]), Y(A.knee[1])], kneeR: [X(A.knee[0]), Y(A.knee[1])],
        hipL: [X(-A.hip[0]), Y(A.hip[1])], hipR: [X(A.hip[0]), Y(A.hip[1])],
        waist: A.waist * w, wy: Y(A.wy), shoulder: A.shoulder * w, sy: Y(A.sy),
        neck: Y(A.neck), headY: Y(A.head), headR: 4.6 * Math.min(1.12, w), headRy: 5.2 * k,
        elbowL: [X(-A.elbow[0]), Y(A.elbow[1])], elbowR: [X(A.elbow[0]), Y(A.elbow[1])],
        handL: [X(-A.hand[0]), Y(A.hand[1])], handR: [X(A.hand[0]), Y(A.hand[1])]
    };
    if (frame === "runA" || frame === "runB") {
        const s = frame === "runA" ? 1 : -1;
        // One knee up, the other leg long; arms pump the other way.
        const up = s > 0 ? "L" : "R", dn = s > 0 ? "R" : "L";
        J["knee" + up] = [J["knee" + up][0], Y(19)]; J["foot" + up] = [J["foot" + up][0] * 0.6 + cx * 0.4, Y(7)];
        J["foot" + dn] = [J["foot" + dn][0], Y(0)];
        J["hand" + dn] = [X((dn === "L" ? -1 : 1) * 8), Y(36)]; J["elbow" + dn] = [X((dn === "L" ? -1 : 1) * 12), Y(34)];
        J["hand" + up] = [X((up === "L" ? -1 : 1) * 12), Y(25)];
    } else if (frame === "reach") {
        // Bent over to pick the bike up: shoulders and head drop, arms hang to the bars.
        const d = 8 * k;
        J.sy += d; J.neck += d; J.headY += d + 1;
        J.kneeL = [X(-6), Y(14)]; J.kneeR = [X(6), Y(14)];
        J.elbowL = [X(-9), Y(28)]; J.elbowR = [X(9), Y(28)];
        J.handL = [X(-8), Y(17)]; J.handR = [X(8), Y(17)];
    } else if (frame === "flail") {
        J.footL = [X(-9), Y(1)]; J.footR = [X(9), Y(1)]; J.kneeL = [X(-7), Y(14)]; J.kneeR = [X(7), Y(14)];
        J.elbowL = [X(-14), Y(50)]; J.elbowR = [X(14), Y(50)];
        J.handL = [X(-13), Y(59)]; J.handR = [X(13), Y(59)];
    }
    return J;
}

// ---------------------------------------------------
//   THE CREW
// ---------------------------------------------------
// Shared body: legs, torso, arms. Each class paints clothes over the shapes.
function dcPxLegs(P, J, pants, boot, t) {
    dcPxLimb(P, J.hipL, J.kneeL, J.footL, t, pants);
    dcPxLimb(P, J.hipR, J.kneeR, J.footR, t, pants);
    const bw = t + 1, bh = J.ride ? 3 : 4;
    dcPxRect(P, J.footL[0] - bw / 2 - (J.ride ? 0 : 1), J.footL[1] - bh + 1, bw + 1, bh, boot);
    dcPxRect(P, J.footR[0] - bw / 2, J.footR[1] - bh + 1, bw + 1, bh, boot);
}
function dcPxTorso(P, J, col, flare) {
    const f = flare || 0;
    dcPxPoly(P, [J.cx - J.shoulder, J.sy, J.cx + J.shoulder, J.sy, J.cx + J.waist + f, J.wy + 3, J.cx - J.waist - f, J.wy + 3], col);
}
function dcPxArms(P, J, sleeve, hand, t) {
    const sl = [J.cx - J.shoulder + 1, J.sy + 1], sr = [J.cx + J.shoulder - 1, J.sy + 1];
    dcPxLimb(P, sl, J.elbowL, J.handL, t, sleeve);
    dcPxLimb(P, sr, J.elbowR, J.handR, t, sleeve);
    dcPxRect(P, J.handL[0] - 1, J.handL[1] - 1, 3, 3, hand);
    dcPxRect(P, J.handR[0] - 1, J.handR[1] - 1, 3, 3, hand);
}
function dcPxHead(P, J, col) { dcPxEll(P, J.cx, J.headY, J.headR, J.headRy, col); dcPxRect(P, J.cx - 1.5, J.headY + J.headRy - 1, 4, Math.max(1, J.sy - (J.headY + J.headRy) + 2), col); }
function dcPxFace(P, J, skin, eyes) {
    dcPxHead(P, J, skin);
    const ey = Math.round(J.headY);
    dcPxPut(P, J.cx - 2, ey, eyes || "#1A1210"); dcPxPut(P, J.cx + 2, ey, eyes || "#1A1210");
}

const DC_SPR_PAINT = {
    medic: function (P, J, fr, C) {
        const back = J.ride;
        dcPxLegs(P, J, C.scrub, C.boot, 3);
        // White coat: a long torso that flares into tails over the hips.
        const tail = fr === "ride1" ? 3 : 1;
        dcPxTorso(P, J, C.coat, 2);
        dcPxPoly(P, [J.cx - J.waist - 1, J.wy, J.cx + J.waist + 1, J.wy, J.cx + J.waist + 2 + tail, J.wy + (back ? 9 : 11), J.cx - J.waist - 2 - tail, J.wy + (back ? 9 : 11)], C.coat);
        if (back) {
            dcPxLine(P, J.cx, J.wy + 2, J.cx, J.wy + 8, 1, "#9AA6AC");              // vent
            dcPxLine(P, J.cx + J.shoulder - 2, J.sy + 1, J.cx - J.waist + 1, J.wy + 1, 1, C.bag); // satchel strap
            dcPxRect(P, J.cx - J.waist - 4, J.wy, 5, 5, C.bag);
            dcPxPut(P, J.cx - J.waist - 2, J.wy + 2, C.glow, true);
        } else {
            dcPxRect(P, J.cx - 2, J.sy + 1, 5, J.wy - J.sy + 8, C.scrub);         // scrubs under the open coat
            dcPxLine(P, J.cx - J.shoulder + 2, J.sy + 1, J.cx + J.waist, J.wy + 2, 1, C.bag);
            dcPxRect(P, J.cx + J.waist - 1, J.wy + 1, 5, 5, C.bag);
            dcPxPut(P, J.cx + J.waist + 1, J.wy + 3, C.glow, true); dcPxPut(P, J.cx + J.waist + 2, J.wy + 3, C.glow, true);
        }
        dcPxArms(P, J, C.coat, C.glove, 3);
        if (back) dcPxHead(P, J, C.hair);
        else { dcPxFace(P, J, C.skin); dcPxEll(P, J.cx, J.headY - 3, J.headR, 2.6, C.hair); }
        dcPxEll(P, J.cx + (back ? 0 : 1), J.headY - J.headRy - 1, 2.2, 2.2, C.hair);      // the bun
    },
    engineer: function (P, J, fr, C) {
        const back = J.ride;
        dcPxLegs(P, J, C.over, C.boot, 3);
        dcPxTorso(P, J, C.shirt, 0);
        // Overalls: the bib (front) or the back panel, and straps.
        dcPxPoly(P, [J.cx - J.waist + 1, J.sy + 5, J.cx + J.waist - 1, J.sy + 5, J.cx + J.waist + 1, J.wy + 4, J.cx - J.waist - 1, J.wy + 4], C.over);
        dcPxLine(P, J.cx - J.shoulder + 3, J.sy, J.cx - 3, J.sy + 6, 1, C.over);
        dcPxLine(P, J.cx + J.shoulder - 3, J.sy, J.cx + 3, J.sy + 6, 1, C.over);
        dcPxRect(P, J.cx - J.waist - 1, J.wy + 1, J.waist * 2 + 3, 2, C.belt);           // tool belt
        dcPxRect(P, J.cx - J.waist - 2, J.wy + 2, 3, 4, C.belt); dcPxRect(P, J.cx + J.waist, J.wy + 2, 3, 4, C.belt);
        dcPxArms(P, J, C.shirt, C.glove, 3);
        if (back) {
            dcPxLine(P, J.cx - 3, J.wy - 1, J.cx + 4, J.sy + 4, 1, C.metal);          // wrench in the back pocket
            dcPxRect(P, J.cx + 3, J.sy + 2, 3, 2, C.metal);
            dcPxHead(P, J, C.hair);
            dcPxRect(P, J.cx - 1, J.headY + 2, 3, 6, C.hair);                          // ponytail
        } else {
            dcPxLine(P, J.handR[0], J.handR[1], J.handR[0] + 1, J.handR[1] - 7, 1, C.metal);
            dcPxRect(P, J.handR[0] - 1, J.handR[1] - 9, 4, 2, C.metal);
            dcPxFace(P, J, C.skin);
        }
        // Hard hat with a brim.
        dcPxEll(P, J.cx, J.headY - 2.5, J.headR + 0.6, 3.6, C.hat);
        dcPxRect(P, J.cx - J.headR - 2, J.headY - 1, J.headR * 2 + 4, 2, C.hat);
    },
    scout: function (P, J, fr, C) {
        const back = J.ride;
        const fl = fr === "ride1" ? 2 : 0;
        // The cloak hangs behind (front view) or over everything (back view).
        const hem = J.ride ? J.wy + 10 + fl : J.by - 10;
        const cloak = function () {
            const pts = [J.cx - J.shoulder, J.sy - 1, J.cx + J.shoulder, J.sy - 1, J.cx + J.shoulder + 4 + fl, hem];
            for (let i = 4; i >= -4; i--) pts.push(J.cx + i * (J.shoulder + 4 + fl) / 4, hem + ((i & 1) ? 2 : -1));
            pts.push(J.cx - J.shoulder - 4 - fl, hem);
            dcPxPoly(P, pts, C.cloak);
        };
        if (!back) cloak();
        dcPxLegs(P, J, C.suit, C.boot, 3);
        dcPxTorso(P, J, C.suit, 0);
        dcPxRect(P, J.cx - J.waist, J.wy + 1, J.waist * 2 + 1, 2, C.belt);
        dcPxArms(P, J, C.suit, C.glove, 3);
        if (back) cloak();
        else {
            // Cloak edges framing the body.
            dcPxLine(P, J.cx - J.shoulder, J.sy, J.cx - J.shoulder - 2, hem - 2, 2, C.cloak);
            dcPxLine(P, J.cx + J.shoulder, J.sy, J.cx + J.shoulder + 2, hem - 2, 2, C.cloak);
        }
        // Hood: a peaked shape over the head; goggles glow from inside it.
        dcPxEll(P, J.cx, J.headY, J.headR + 1.2, J.headRy + 1, C.cloak);
        dcPxPoly(P, [J.cx - 3, J.headY - J.headRy, J.cx, J.headY - J.headRy - 3, J.cx + 3, J.headY - J.headRy], C.cloak);
        if (!back) {
            dcPxEll(P, J.cx, J.headY + 1, J.headR - 1, J.headRy - 1, C.hood);
            dcPxRect(P, J.cx - 3, J.headY, 3, 2, C.goggle, true); dcPxRect(P, J.cx + 1, J.headY, 3, 2, C.goggle, true);
        } else {
            // Goggle strap glints at the sides of the hood.
            dcPxPut(P, J.cx - J.headR - 1, J.headY, C.goggle, true); dcPxPut(P, J.cx + J.headR + 1, J.headY, C.goggle, true);
        }
    },
    gunner: function (P, J, fr, C) {
        const back = J.ride;
        dcPxLegs(P, J, C.fat, C.boot, 4);
        // Knee pads on the front view.
        if (!back) { dcPxRect(P, J.kneeL[0] - 2, J.kneeL[1] - 1, 4, 3, C.vest); dcPxRect(P, J.kneeR[0] - 2, J.kneeR[1] - 1, 4, 3, C.vest); }
        dcPxTorso(P, J, C.vest, 1);
        // Webbing rows on the plate carrier.
        for (let y = J.sy + 4; y < J.wy; y += 3) dcPxLine(P, J.cx - J.waist + 1, y, J.cx + J.waist - 1, y, 1, "#3A4326");
        // Shoulder pads.
        dcPxEll(P, J.cx - J.shoulder, J.sy + 2, 3, 2.5, C.vest); dcPxEll(P, J.cx + J.shoulder, J.sy + 2, 3, 2.5, C.vest);
        dcPxArms(P, J, C.fat, C.glove, 4);
        // Ammo belt over one shoulder, brass rounds along it.
        const a0 = [J.cx + J.shoulder - 1, J.sy + 1], a1 = [J.cx - J.waist, J.wy + 1];
        dcPxLine(P, a0[0], a0[1], a1[0], a1[1], 2, C.ammo);
        for (let i = 1; i < 8; i++) { const q = i / 8; dcPxPut(P, a0[0] + (a1[0] - a0[0]) * q, a0[1] + (a1[1] - a0[1]) * q - 1, C.brass, true); }
        if (back) {
            // Rifle slung across the back.
            dcPxLine(P, J.cx - J.shoulder - 3, J.wy + 1, J.cx + J.shoulder + 2, J.sy - 2, 2, C.gun);
            dcPxRect(P, J.cx - 2, J.sy + 8, 3, 3, C.gun);
            dcPxHead(P, J, C.skin);
        } else {
            // Rifle held across the body.
            dcPxLine(P, J.handL[0] - 2, J.handL[1] + 1, J.handR[0] + 5, J.handR[1] - 2, 3, C.gun);
            dcPxRect(P, J.cx - 1, J.handL[1] + 2, 3, 4, C.gun);
            dcPxFace(P, J, C.skin, "#0E0806");
            dcPxRect(P, J.cx - 3, J.headY + 3, 7, 2, "#1C1210");                     // beard
        }
        // Bandana over the top of the head, knot tails in the wind.
        dcPxEll(P, J.cx, J.headY - 2.5, J.headR + 0.4, 3.2, C.band);
        const tl = fr === "ride1" ? 2 : 0;
        dcPxLine(P, J.cx + J.headR - 1, J.headY - 1, J.cx + J.headR + 3 + tl, J.headY + 1 + tl, 1, C.band);
        dcPxLine(P, J.cx + J.headR - 1, J.headY, J.cx + J.headR + 2 + tl, J.headY + 3, 1, C.band);
    },
    butcher: function (P, J, fr, C) {
        const back = J.ride;
        dcPxLegs(P, J, C.pants, C.boot, 4);
        dcPxTorso(P, J, C.shirt, 1);
        if (back) {
            // The apron's sides at the hips, neck strap, the bow at the small of the back.
            dcPxRect(P, J.cx - J.waist - 2, J.wy, 3, 7, C.apron); dcPxRect(P, J.cx + J.waist, J.wy, 3, 7, C.apron);
            dcPxLine(P, J.cx - J.waist, J.wy + 1, J.cx + J.waist, J.wy + 1, 1, C.apron);
            dcPxRect(P, J.cx - 2, J.wy, 2, 2, C.apron); dcPxRect(P, J.cx + 1, J.wy, 2, 2, C.apron);
            dcPxLine(P, J.cx - 1, J.wy + 2, J.cx - 2, J.wy + 5, 1, C.apron); dcPxLine(P, J.cx + 1, J.wy + 2, J.cx + 2, J.wy + 5, 1, C.apron);
            dcPxLine(P, J.cx - 3, J.sy - 1, J.cx - 1, J.sy + 2, 1, C.apron); dcPxLine(P, J.cx + 3, J.sy - 1, J.cx + 1, J.sy + 2, 1, C.apron);
            // Cleaver tucked in the belt.
            dcPxRect(P, J.cx + J.waist - 3, J.wy - 3, 4, 3, C.steel); dcPxRect(P, J.cx + J.waist - 2, J.wy, 1, 3, C.wood);
        } else {
            // The bloodstained apron from chest to knee.
            dcPxPoly(P, [J.cx - 4, J.sy + 2, J.cx + 4, J.sy + 2, J.cx + J.waist + 2, J.wy + 3, J.cx + J.waist + 2, J.by - 16, J.cx - J.waist - 2, J.by - 16, J.cx - J.waist - 2, J.wy + 3], C.apron);
            for (let i = 0; i < 14; i++) {
                const x = J.cx - J.waist + Math.floor(dcPxHash(i, 3, 9) * (J.waist * 2 + 2)), y = J.sy + 4 + Math.floor(dcPxHash(i, 7, 9) * (J.by - 16 - J.sy - 4));
                dcPxRect(P, x, y, 1 + (i % 2), 1 + ((i >> 1) % 2), C.blood);
            }
            dcPxLine(P, J.cx - 4, J.sy + 2, J.cx - 3, J.sy - 1, 1, C.apron); dcPxLine(P, J.cx + 4, J.sy + 2, J.cx + 3, J.sy - 1, 1, C.apron);
        }
        // Rolled sleeves: maroon to the elbow, bare forearms.
        const sl = [J.cx - J.shoulder + 1, J.sy + 1], sr = [J.cx + J.shoulder - 1, J.sy + 1];
        dcPxLine(P, sl[0], sl[1], J.elbowL[0], J.elbowL[1], 4, C.shirt); dcPxLine(P, sr[0], sr[1], J.elbowR[0], J.elbowR[1], 4, C.shirt);
        dcPxLine(P, J.elbowL[0], J.elbowL[1], J.handL[0], J.handL[1], 3, C.skin); dcPxLine(P, J.elbowR[0], J.elbowR[1], J.handR[0], J.handR[1], 3, C.skin);
        dcPxRect(P, J.handL[0] - 1, J.handL[1] - 1, 3, 3, C.skin); dcPxRect(P, J.handR[0] - 1, J.handR[1] - 1, 3, 3, C.skin);
        if (!back) {
            // Cleaver raised in the right hand.
            dcPxRect(P, J.handR[0], J.handR[1] - 9, 4, 6, C.steel); dcPxRect(P, J.handR[0] + 1, J.handR[1] - 3, 1, 3, C.wood);
            dcPxFace(P, J, C.skin);
            dcPxRect(P, J.cx - 3, J.headY + 2, 7, 4, C.hair);                          // grey beard
            dcPxPut(P, J.cx - 2, J.headY, "#1A1210"); dcPxPut(P, J.cx + 2, J.headY, "#1A1210");
            dcPxEll(P, J.cx, J.headY - 3.5, J.headR, 2.4, C.hair);
        } else {
            dcPxHead(P, J, C.skin);
            dcPxEll(P, J.cx, J.headY - 1, J.headR + 0.3, J.headRy - 0.6, C.hair);      // grey hair from behind
        }
    },
    tech: function (P, J, fr, C) {
        // A lab tech: grey-blue coat over a dark shirt, a headset with a cyan mic.
        dcPxLegs(P, J, C.pants, C.boot, 3);
        dcPxTorso(P, J, C.coat, 2);
        dcPxPoly(P, [J.cx - J.waist - 1, J.wy, J.cx + J.waist + 1, J.wy, J.cx + J.waist + 2, J.wy + 10, J.cx - J.waist - 2, J.wy + 10], C.coat);
        dcPxRect(P, J.cx - 2, J.sy + 1, 5, J.wy - J.sy + 4, C.shirt);
        dcPxArms(P, J, C.coat, C.skin, 3);
        dcPxFace(P, J, C.skin);
        dcPxEll(P, J.cx, J.headY - 3, J.headR + 0.3, 2.8, C.hair);
        dcPxRect(P, J.cx - J.headR - 1, J.headY - 2, 2, 4, C.set, true);
        dcPxLine(P, J.cx - J.headR, J.headY + 2, J.cx - 2, J.headY + 4, 1, C.set, true);
    },
    bulwark: function (P, J, fr, C) {
        const back = J.ride;
        // Shield: on the back (ride) or held at the right side (front).
        const shield = function (x, y, w, h) {
            dcPxRect(P, x, y, w, h, C.shield);
            for (let i = 0; i < 2; i++) dcPxLine(P, x + 2 + i * 4, y + h * 0.62, x + w - 2, y + h * 0.62 - (w - 4 - i * 4) * 1.1 + i * 2, 2, C.stripe);
            for (let i = 0; i < 10; i++) dcPxPut(P, x + Math.floor(dcPxHash(i, 1, 4) * w), y + Math.floor(dcPxHash(i, 2, 4) * h), C.rust);
        };
        dcPxLegs(P, J, C.arm, C.armD, 6);
        dcPxRect(P, J.kneeL[0] - 3, J.kneeL[1] - 2, 6, 4, C.armD); dcPxRect(P, J.kneeR[0] - 3, J.kneeR[1] - 2, 6, 4, C.armD);
        dcPxTorso(P, J, C.arm, 2);
        dcPxLine(P, J.cx - J.waist, J.sy + 7, J.cx + J.waist, J.sy + 7, 1, C.joint);  // plate seams
        dcPxLine(P, J.cx, J.sy + 2, J.cx, J.wy, 1, C.joint);
        dcPxRect(P, J.cx - J.waist - 1, J.wy + 1, J.waist * 2 + 3, 2, C.joint);
        // Huge pauldrons and armoured arms.
        dcPxEll(P, J.cx - J.shoulder - 1, J.sy + 2, 5, 4, C.arm); dcPxEll(P, J.cx + J.shoulder + 1, J.sy + 2, 5, 4, C.arm);
        dcPxArms(P, J, C.arm, C.armD, 5);
        if (back) shield(J.cx - 7, J.sy - 1, 15, J.wy - J.sy + 6);
        // Helmet: squared, the orange visor slit (glimpsed at the sides from behind).
        dcPxRect(P, J.cx - J.headR - 0.5, J.headY - J.headRy, J.headR * 2 + 2, J.headRy * 2 + 1, C.arm);
        dcPxRect(P, J.cx - J.headR + 1, J.headY - J.headRy - 1, J.headR * 2 - 1, 1, C.arm);
        if (back) { dcPxPut(P, J.cx - J.headR - 1, J.headY - 1, C.visor, true); dcPxPut(P, J.cx + J.headR + 1, J.headY - 1, C.visor, true); dcPxLine(P, J.cx - 2, J.headY + 1, J.cx + 2, J.headY + 1, 1, C.joint); }
        else {
            dcPxRect(P, J.cx - J.headR + 1, J.headY - 1, J.headR * 2 - 1, 2, C.visor, true);
            shield(J.handR[0] - 3, J.sy + 2, 13, J.by - 6 - J.sy);
        }
    }
};

// ---------------------------------------------------
//   CACHE AND DRAW
// ---------------------------------------------------
const DC_SPR_FRAMES = ["ride0", "ride1", "stand", "runA", "runB", "reach", "flail"];
const dcSprCache = {};

function dcSprites(role) {
    if (dcSprCache[role]) return dcSprCache[role];
    const B = DC_SPR_BUILD[role] || DC_SPR_BUILD.medic;
    const C = DC_SPR_PAL[role] || DC_SPR_PAL.medic;
    const paint = DC_SPR_PAINT[role] || DC_SPR_PAINT.medic;
    const out = {};
    DC_SPR_FRAMES.forEach(function (fr, n) {
        const ride = fr.indexOf("ride") === 0;
        const W = Math.ceil((ride ? 44 : 40) * B.w) + 6, H = Math.ceil((ride ? 52 : 70) * B.k) + 4;
        const P = dcPxNew(W, H);
        const J = dcPoseJoints(fr, B, Math.floor(W / 2), H - 2);
        paint(P, J, fr, C);
        out[fr] = { cv: dcPxBake(P, n + 1), w: W, h: H, foot: H - 2 };
    });
    dcSprCache[role] = out;
    return out;
}

// Draws a frame with its feet at (x, y) in the current transform, scaled so
// one art pixel is px screen pixels.
function dcDrawSprite(ctx, role, frame, x, y, px) {
    const S = dcSprites(role)[frame];
    if (!S) return;
    const was = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(S.cv, x - S.w * px / 2, y - S.foot * px, S.w * px, S.h * px);
    ctx.imageSmoothingEnabled = was;
}
