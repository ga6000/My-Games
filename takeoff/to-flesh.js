// ===================================================
//   Takeoff — flesh: how the creatures are drawn
// ===================================================
// Borrowed from Gyro Fleet's gf-flesh.js (lung lobes, lamprey mouth, the
// airkrill) with the gf names changed to to, so the creatures read the same
// in both games. toDrawBody is a trimmed copy of gfDrawCreature (no birth
// strands, crush, tumble, marks or lash: Takeoff has none of those yet).
// toDrawPlank is new: the air plankton placeholder.
"use strict";

function toLumps(c, R, wob, t, n, squash) {
    // A lumpy closed outline round the origin (alveoli along the edge).
    c.beginPath();
    for (let i = 0; i <= n; i++) {
        const a = i / n * Math.PI * 2;
        const rr = R * (1 + wob * (Math.sin(a * 3 + t) * 0.45 + Math.sin(a * 7 - t * 1.3) * 0.3 + Math.sin(a * 13 + t * 0.7) * 0.25));
        const px = Math.cos(a) * rr, py = Math.sin(a) * rr * (squash || 1);
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
}

function toHeat(press) {
    // Vein colour from pressure: dark red -> orange -> white.
    if (press < 0.05) return "rgba(120,10,40,0.75)";
    const r = 255, g = Math.round(70 + 185 * press), b = Math.round(60 + 180 * Math.max(0, press - 0.5) * 2);
    return "rgba(" + r + "," + g + "," + b + "," + (0.6 + 0.4 * press).toFixed(2) + ")";
}

// One lung lobe at the origin, long axis along x, `side` = which way is out.
// L, W are its half length and half width NOW; f is how full it is (0..1).
// (Pass 4, 2026-11-16. Ry: "so it looks like actual lungs inflating rather
// than just polygons increasing/decreasing in size". A lobe is a sac hung on
// the windpipe: narrow apex by the mouth, wide base at the rear, flat where
// it lies against the windpipe. Empty it is a slack, pleated bag. Air comes
// in at the hilum and the glow of it spreads outward; the pleats open and
// flatten, the base fills last, the bronchi spread, the skin goes pale and
// tight. It was three pale "rib" arcs drawn with the wrong sweep that left
// stray circles hanging off every body; those are gone.)
function toLobePath(c, L, W, f, side, t, quiver) {
    const n = 30, slack = 1 - f, fb = Math.max(0, f * 1.7 - 0.7);
    c.beginPath();
    for (let i = 0; i <= n; i++) {
        const a = i / n * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const outer = sa * side > 0;
        let ry = W * (1 - 0.28 * ca) * (outer ? 1 : 0.5);            // apex narrow, base wide, flat inner face
        let rx = L * (1 + 0.14 * fb * Math.max(0, -ca));              // the base fills last
        const fold = slack * (0.13 * Math.sin(a * 6 + t * 0.6) + 0.07 * Math.sin(a * 11 - t)) + quiver * 0.035 * Math.sin(a * 7 - toTime * 20);
        if (outer) ry *= 1 + fold; else ry *= 1 + fold * 0.3;
        rx *= 1 + fold * 0.4;
        const px = ca * rx, py = sa * ry;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
}
function toLobe(c, L, W, cr, side, hue, f) {
    const soft = !cr.b.armour, st = cr.b.stage, t = toTime * (soft ? 4 : 1.5) + cr.seed + side;
    const inh = st === "inhale" ? 1 : 0, exh = st === "exhale" ? 1 : 0;
    const hx = L * 0.15, hy = -side * W * 0.35;        // the hilum: where the bronchus enters
    const g = c.createRadialGradient(hx, hy, W * 0.05, 0, side * W * 0.2, Math.max(L, W) * 1.15);
    if (cr.flash > 0) { g.addColorStop(0, "#FFFFFF"); g.addColorStop(1, "#FFD0DC"); }
    else if (soft) { g.addColorStop(0, hue.softHi); g.addColorStop(0.6, hue.softMid); g.addColorStop(1, hue.softLo); }
    else { g.addColorStop(0, hue.hi); g.addColorStop(0.3 + 0.3 * f, hue.mid); g.addColorStop(1, hue.lo); }
    c.fillStyle = g;
    toLobePath(c, L, W, f, side, t, inh + exh);
    c.fill();
    c.strokeStyle = soft ? "rgba(60,0,20,0.9)" : hue.rim; c.lineWidth = soft ? 1 : 1.2 + 0.6 * f;
    c.stroke();
    if (L < 6) return;
    c.save();
    c.clip();
    // The air itself: a pale front spreading out from the hilum as it fills,
    // drawing back to it as it empties.
    if (f > 0.02 && cr.flash <= 0) {
        const reach = Math.max(2, (L + W) * (0.25 + 0.95 * f));
        const ag = c.createRadialGradient(hx, hy, 0, hx, hy, reach);
        const al = soft ? 0 : 0.16 + 0.34 * (inh + exh) * (0.6 + 0.4 * Math.sin(toTime * 14));
        ag.addColorStop(0, "rgba(255,244,236," + al.toFixed(3) + ")");
        ag.addColorStop(0.75, "rgba(255,226,220," + (al * 0.8).toFixed(3) + ")");
        ag.addColorStop(0.92, "rgba(255,255,255," + (al * (inh ? 1.5 : 0.6)).toFixed(3) + ")");
        ag.addColorStop(1, "rgba(255,230,225,0)");
        c.fillStyle = ag; c.fillRect(-L * 1.3, -W * 1.6, L * 2.6, W * 3.2);
    }
    // Pleats: deep, dark and close together when slack; they spread apart and
    // fade to faint lobule lines as the sac fills.
    c.lineCap = "round";
    const nP = 6;
    for (let i = 0; i < nP; i++) {
        const u = (i + 0.5) / nP * 2 - 1, x = u * L * (0.55 + 0.4 * f);
        const major = i === 2 || i === 4;                 // the fissures that stay when taut
        const al = major ? 0.75 - 0.4 * f : 0.75 * (1 - f * 1.15);
        if (al <= 0.02) continue;
        c.strokeStyle = "rgba(40,0,15," + al.toFixed(3) + ")"; c.lineWidth = Math.max(0.8, W * (0.1 - 0.06 * f));
        c.beginPath(); c.moveTo(x - L * 0.12, -side * W * 0.5);
        c.quadraticCurveTo(x + L * (0.1 + 0.12 * f), side * W * 0.25, x - L * 0.05, side * W * 1.3); c.stroke();
    }
    // The bronchial tree, out from the hilum. Its branches open out with the sac.
    c.strokeStyle = toHeat(cr.press);
    const pulse = 1 + 0.15 * Math.sin(toTime * 6 + cr.seed), fan = 0.45 + 0.55 * f;
    for (let b = -1; b <= 1; b++) {
        const a0 = side * (Math.PI / 2 + b * 0.95 * fan) + 0.12 * Math.sin(cr.seed + b);
        const len = (b === 0 ? W * 1.0 : L * 0.62) * (0.55 + 0.45 * f);
        const x1 = hx + Math.cos(a0) * len, y1 = hy + Math.sin(a0) * len;
        c.lineWidth = Math.max(0.8, W * 0.11 * pulse);
        c.beginPath(); c.moveTo(hx, hy); c.quadraticCurveTo((hx + x1) / 2, hy + (y1 - hy) * 0.3, x1, y1); c.stroke();
        c.lineWidth = Math.max(0.6, W * 0.06);
        for (let k = -1; k <= 1; k += 2) {
            const a1 = a0 + k * (0.3 + 0.45 * f), l2 = len * 0.6;
            const x2 = x1 + Math.cos(a1) * l2, y2 = y1 + Math.sin(a1) * l2;
            c.beginPath(); c.moveTo(x1, y1); c.lineTo(x2, y2); c.stroke();
            if (W > 9) {
                c.lineWidth = Math.max(0.5, W * 0.035);
                for (let m = -1; m <= 1; m += 2) { c.beginPath(); c.moveTo(x2, y2); c.lineTo(x2 + Math.cos(a1 + m * 0.6) * l2 * 0.5, y2 + Math.sin(a1 + m * 0.6) * l2 * 0.5); c.stroke(); }
                c.lineWidth = Math.max(0.6, W * 0.06);
            }
        }
    }
    // Alveoli: clusters of small sacs along the outer edge that bead up as it fills.
    if (!soft && W > 6) {
        c.fillStyle = "rgba(255,225,215," + (0.12 + 0.3 * f).toFixed(3) + ")";
        for (let i = 0; i < 9; i++) {
            const u = (i + 0.5) / 9 * 2 - 1, x = u * L * 0.85, y = side * W * (0.78 + 0.12 * Math.sin(i * 2.3 + cr.seed)) * Math.sqrt(Math.max(0, 1 - u * u * 0.8));
            c.beginPath(); c.arc(x, y, Math.max(0.8, W * (0.05 + 0.09 * f)), 0, Math.PI * 2); c.fill();
        }
        // Wet highlight on the taut skin.
        c.fillStyle = "rgba(255,255,255," + (0.08 + 0.2 * f).toFixed(3) + ")";
        c.beginPath(); c.ellipse(L * 0.2, side * W * 0.45, L * 0.38, W * 0.13, 0.25 * side, 0, Math.PI * 2); c.fill();
    }
    // Pustules.
    c.fillStyle = soft ? "rgba(90,10,40,0.8)" : "rgba(120,20,50,0.5)";
    for (let i = 0; i < 4; i++) {
        const a = cr.seed * (i + 1) * 1.7, rr = 0.3 + 0.45 * ((cr.seed * (i + 3)) % 1);
        c.beginPath(); c.arc(Math.cos(a) * rr * L, side * Math.abs(Math.sin(a)) * rr * W, Math.max(0.8, W * 0.08), 0, Math.PI * 2); c.fill();
    }
    c.restore();
}

// The mouth, at the origin, facing +x seen end-on: a lamprey's. A slack wet
// collar of gum round a throat that never stops swallowing, with rows of thin
// uneven needle teeth all the way down it, and ropes of spit.
// (Pass 4. Ry: "make the mouth a bit less cheesey and more menacing/gross".
// It was eight white triangles on a circle, which read as a cog.)
function toDrawMaw(c, mR, cr, hue, soft, wide) {
    const t = toTime * (soft ? 5 : 2.2) + cr.seed, gulp = 0.5 + 0.5 * Math.sin(t);
    const R = mR * (1 + 0.3 * wide);
    // Collar: lumpy lips, darker toward the throat.
    const lg = c.createRadialGradient(0, 0, R * 0.5, 0, 0, R * 1.3);
    lg.addColorStop(0, "#2A0210"); lg.addColorStop(0.55, soft ? "#5A1230" : "#9A2A4C"); lg.addColorStop(1, soft ? "#3A0A1C" : "#D8607F");
    c.fillStyle = cr.flash > 0 ? "#FFE6EC" : lg;
    toLumps(c, R * 1.22, 0.1, t * 0.7, 18, 1); c.fill();
    c.strokeStyle = "rgba(40,0,15,0.9)"; c.lineWidth = 1; c.stroke();
    // Throat: black, with one wet red ring of muscle working inward.
    c.fillStyle = "#050002"; c.beginPath(); c.arc(0, 0, R * 0.9, 0, Math.PI * 2); c.fill();
    if (R > 5) {
        const rr = R * (0.75 - 0.5 * toFrac(t * 0.16));
        c.strokeStyle = "rgba(170,20,50,0.55)"; c.lineWidth = Math.max(1, R * 0.1);
        c.beginPath(); c.arc(0, 0, rr, 0, Math.PI * 2); c.stroke();
        c.strokeStyle = "rgba(110,10,36,0.5)";
        c.beginPath(); c.arc(0, 0, R * (0.3 + 0.08 * gulp), 0, Math.PI * 2); c.stroke();
    }
    // Teeth: three rows of needles, each one its own length and lean.
    const rows = R > 7 ? 3 : 2;
    for (let row = 0; row < rows; row++) {
        const n = 13 - row * 3, r0 = R * (0.95 - row * 0.24), w = 0.11 + row * 0.03;
        c.fillStyle = row === 0 ? "#EFE3C4" : (row === 1 ? "#CDBB94" : "#8E7A5C");
        c.strokeStyle = "rgba(40,10,0,0.7)"; c.lineWidth = 0.6;
        for (let i = 0; i < n; i++) {
            const h = toFrac(Math.sin(cr.seed * 7 + i * 12.9898 + row * 78.233) * 43758.5453);
            if (h < 0.1) continue;                          // a gap where one tore out
            const a = (i + row * 0.5) / n * Math.PI * 2 + (h - 0.5) * 0.18;
            const len = R * (0.2 + 0.34 * h) * (1 - 0.35 * wide) * (0.85 + 0.15 * Math.sin(t * 2 + i + row));
            const lean = (h - 0.5) * 0.5, r1 = r0 - len;
            c.beginPath();
            c.moveTo(Math.cos(a - w) * r0, Math.sin(a - w) * r0);
            c.lineTo(Math.cos(a + lean * 0.3) * r1, Math.sin(a + lean * 0.3) * r1);
            c.lineTo(Math.cos(a + w) * r0, Math.sin(a + w) * r0);
            c.closePath(); c.fill(); if (R > 9) c.stroke();
        }
    }
    // Spit: ropes strung across the mouth and one hanging off the lip.
    if (R > 6) {
        c.strokeStyle = "rgba(235,225,190,0.45)"; c.lineWidth = Math.max(0.7, R * 0.045); c.lineCap = "round";
        for (let i = 0; i < 2; i++) {
            const a = cr.seed * (i + 2) + 1, b2 = a + 2.2 + 0.5 * Math.sin(t * 0.8 + i);
            c.beginPath(); c.moveTo(Math.cos(a) * R * 0.85, Math.sin(a) * R * 0.85);
            c.quadraticCurveTo(Math.sin(t + i) * R * 0.2, Math.cos(t * 0.7 + i) * R * 0.2, Math.cos(b2) * R * 0.85, Math.sin(b2) * R * 0.85); c.stroke();
        }
        c.beginPath(); c.moveTo(R * 1.1, R * 0.2);
        c.quadraticCurveTo(R * (1.5 + 0.2 * Math.sin(t)), R * 0.3, R * (1.6 + 0.3 * gulp), R * (0.1 + 0.3 * Math.sin(t * 0.6))); c.stroke();
    }
}

const TO_HUES = {
    crab: { hi: "rgba(255,214,222,0.95)", mid: "rgba(232,96,136,0.9)", lo: "rgba(110,18,52,0.92)", rim: "#FFB4C6",
            softHi: "#C24A6E", softMid: "#7A1C3C", softLo: "#2E0614" },
    bell: { hi: "rgba(255,200,190,0.95)", mid: "rgba(214,44,52,0.92)", lo: "rgba(84,6,16,0.95)", rim: "#FF8A80",
            softHi: "#B02A30", softMid: "#6A1016", softLo: "#260406" }
};

function toDrawKrill(c, cr, R) {
    const soft = !cr.b.armour, t = toTime * 14 + cr.seed;
    // Seen first, drawn second: a dark keyline so it never melts into the
    // nebula, and a glow that is hot white-violet while it can bite (soft and
    // diving) and dim while it is armoured and circling.
    c.fillStyle = "rgba(0,0,0,0.55)";
    c.beginPath(); c.arc(0, 0, R * 1.55, 0, Math.PI * 2); c.fill();
    const hg = c.createRadialGradient(0, 0, R * 0.6, 0, 0, R * 2.6);
    hg.addColorStop(0, soft ? "rgba(255,120,255,0.55)" : "rgba(201,162,255,0.28)"); hg.addColorStop(1, "rgba(201,162,255,0)");
    c.fillStyle = hg; c.beginPath(); c.arc(0, 0, R * 2.6, 0, Math.PI * 2); c.fill();
    // Barbed tail.
    c.strokeStyle = "#D9BEFF"; c.lineWidth = Math.max(1.5, R * 0.28); c.lineCap = "round";
    c.beginPath(); c.moveTo(-R * 0.8, 0);
    c.quadraticCurveTo(-R * 1.8, Math.sin(t) * R * 0.8, -R * 2.6, Math.sin(t + 1) * R * 0.6); c.stroke();
    // Bladder.
    const g = c.createRadialGradient(-R * 0.2, -R * 0.3, R * 0.1, 0, 0, R);
    if (cr.flash > 0) { g.addColorStop(0, "#fff"); g.addColorStop(1, "#fff"); }
    else if (soft) { g.addColorStop(0, "#FFB8FF"); g.addColorStop(0.6, "#C060F0"); g.addColorStop(1, "#5A1890"); }
    else { g.addColorStop(0, "#FFFFFF"); g.addColorStop(0.55, "#D9BEFF"); g.addColorStop(1, "#7A50D0"); }
    c.fillStyle = g;
    toLumps(c, R, soft ? 0.2 : 0.05, t * 0.4, 12, soft ? 0.7 : 0.95); c.fill();
    c.strokeStyle = soft ? "#FFE0FF" : "#FFFFFF"; c.lineWidth = 1.5; c.stroke();
    if (R < 4) return;
    // Pincers and a dark eye.
    c.strokeStyle = "#E6D4FF"; c.lineWidth = Math.max(1, R * 0.16);
    const open = 0.5 + 0.3 * Math.sin(t * 0.7);
    for (let s = -1; s <= 1; s += 2) {
        c.beginPath(); c.moveTo(R * 0.7, s * R * 0.3); c.quadraticCurveTo(R * 1.5, s * R * (0.3 + open), R * 1.7, s * R * 0.1); c.stroke();
    }
    c.fillStyle = "#12021E"; c.beginPath(); c.arc(R * 0.4, 0, R * 0.2, 0, Math.PI * 2); c.fill();
}

// AIR PLANKTON (placeholder until the bestiary entry): a pale translucent
// mote with a dark nucleus and two hair-fine feelers. The whole cloud pulses
// in one rhythm; armoured on the pulse (bright rim), soft between.
function toDrawPlank(c, f, R) {
    const arm = f.b.armour;
    c.fillStyle = arm ? "rgba(232,255,244,0.25)" : "rgba(201,162,255,0.18)";
    c.beginPath(); c.arc(0, 0, R * 2.4, 0, Math.PI * 2); c.fill();
    c.fillStyle = f.flash > 0 ? "#fff" : (arm ? "#E8FFF4" : "#BFA6E8");
    c.beginPath(); c.arc(0, 0, R, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#1A0830"; c.beginPath(); c.arc(R * 0.2, 0, R * 0.4, 0, Math.PI * 2); c.fill();
    c.strokeStyle = "rgba(232,255,244,0.5)"; c.lineWidth = 0.8;
    const t = toTime * 6 + f.seed;
    c.beginPath(); c.moveTo(-R, 0); c.quadraticCurveTo(-R * 2.5, Math.sin(t) * R * 1.5, -R * 3.5, Math.sin(t + 1) * R); c.stroke();
}

// AIRCRAB and BELLWETHER: lobes on a windpipe, the mouth at the front, a
// vent at the rear (lit while it is open on the inhale).
function toDrawBody(c, cr, R) {
    const hue = TO_HUES[cr.kind], soft = !cr.b.armour, sw = cr.b.swell, bell = cr.kind === "bell";
    const k = TO_KINDS[cr.kind], z = toCam.s;
    const S = z * (k.rSmall * 1.15 + (k.rBig * 0.8 - k.rSmall * 1.15) * sw);
    c.lineJoin = "round";
    c.strokeStyle = soft ? "rgba(150,40,80,0.8)" : "rgba(255,150,180,0.8)"; c.lineCap = "round";
    const tl = S * (soft ? 1.1 : 2.0), nT = bell ? 9 : 6;
    for (let i = 0; i < nT; i++) {
        const off = (i - (nT - 1) / 2) / nT * S * 1.3, ph = toTime * 3 + cr.seed + i * 1.3;
        c.lineWidth = Math.max(0.8, S * 0.06);
        c.beginPath(); c.moveTo(S * 0.5, off);
        c.bezierCurveTo(S * 0.1, off + Math.sin(ph) * S * 0.3, -tl * 0.5, off * 1.4 + Math.cos(ph) * S * 0.35, -tl - S * 0.4, off * 1.8 + Math.sin(ph * 1.3) * S * 0.4);
        c.stroke();
    }
    const Ll = S * 0.7 + (R * 0.8 - S * 0.7) * sw, Wl = S * 0.2 + (R * 0.5 - S * 0.2) * sw;
    if (bell) { c.save(); c.translate(-S * 0.5 - Ll * 0.35, 0); toLobe(c, Ll * 0.7, Wl * 0.9, cr, 1, hue, sw); c.restore(); }
    for (let s = -1; s <= 1; s += 2) {
        c.save(); c.translate(-S * 0.1, s * (S * 0.1 + Wl * 0.72)); c.rotate(s * (0.05 + 0.14 * sw)); toLobe(c, Ll, Wl, cr, s, hue, sw); c.restore();
    }
    c.fillStyle = soft ? "#3A0A1C" : "#F2C9B4"; c.strokeStyle = "rgba(60,0,20,0.9)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(S * 0.95, -S * 0.15); c.lineTo(-S * 0.6, -S * 0.1); c.lineTo(-S * 0.6, S * 0.1); c.lineTo(S * 0.95, S * 0.15); c.closePath();
    c.fill(); c.stroke();
    c.save(); c.translate(S * 0.98, 0); toDrawMaw(c, S * (bell ? 0.34 : 0.3), cr, hue, soft, cr.latch ? 1 : 0); c.restore();
    if (bell) {
        c.fillStyle = "#3A0508"; c.strokeStyle = "#FF8A80"; c.lineWidth = 1;
        for (let i = 0; i < 9; i++) {
            const a = Math.PI + (i - 4) * 0.3, r0 = R * 0.95, r1 = R * (1.35 + 0.12 * Math.sin(toTime * 2 + i));
            c.beginPath();
            c.moveTo(Math.cos(a - 0.09) * r0, Math.sin(a - 0.09) * r0); c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); c.lineTo(Math.cos(a + 0.09) * r0, Math.sin(a + 0.09) * r0);
            c.closePath(); c.fill(); c.stroke();
        }
        for (let i = 0; i < 5; i++) {
            const ex = S * (0.5 + 0.1 * (i % 2)), ey = (i - 2) * S * 0.15;
            c.fillStyle = "#FFE45C"; c.beginPath(); c.arc(ex, ey, Math.max(1.2, R * 0.05), 0, Math.PI * 2); c.fill();
        }
    }
    const vx = -Math.max(S * 0.62, Ll * 0.8), vR = S * 0.26;
    if (cr.b.open) {
        const g = c.createRadialGradient(vx, 0, 0, vx, 0, vR * 2.4);
        g.addColorStop(0, "rgba(255,240,150,0.9)"); g.addColorStop(0.4, "rgba(255,200,60,0.45)"); g.addColorStop(1, "rgba(255,200,60,0)");
        c.fillStyle = g; c.beginPath(); c.arc(vx, 0, vR * 2.4, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#FFE45C"; c.beginPath(); c.arc(vx, 0, vR, 0, Math.PI * 2); c.fill();
    }
    // Clamped onto the mothership: three hooked tendrils into the hull.
    if (cr.latch && cr.kind === "crab") {
        c.strokeStyle = "#FF2E88"; c.lineWidth = 2;
        for (let i = -1; i <= 1; i++) {
            c.beginPath(); c.moveTo(S * 0.8, i * S * 0.3);
            c.quadraticCurveTo(S * 1.6, i * S * 0.6 + Math.sin(toTime * 8 + i) * 3, S * 2, i * S * 0.9); c.stroke();
        }
    }
}
