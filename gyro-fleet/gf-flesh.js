// ===================================================
//   Gyro Fleet — flesh: how the creatures and The Tide are drawn
// ===================================================
// Flood pass (2026-11-15). Ry: "the enemies are very very low detail currently
// and don't capture the horror & fleshiness of the actual air crabs". Pass 1
// drew two outlined blobs. These are bodies:
//
//   AIRCRAB     two lung lobes, wet and veined, hung off a ribbed windpipe
//               that ends in a ring of teeth at the front. Inflated they are
//               taut and translucent with pale armour ribs; deflated they
//               shrivel dark and wrinkled. Tendrils always trail from under
//               the mouth. The rear vent is a puckered sphincter that gapes
//               and glows when it is open. Pressure shows as the veins
//               heating to white and the body over-swelling.
//   BELLWETHER  three lobes, a crown of horn spines, a cluster of eyes.
//   AIRKRILL    a small bladder with a barbed tail and two pincers.
//   THE TIDE    a wall of flesh with veins, boils and cilia, and three
//               orifices: sphincters ringed with teeth that swell, dilate and
//               push creatures out trailing slime.
//
// All canvas paths and gradients, drawn per frame; nothing here changes play.
"use strict";

function gfLumps(c, R, wob, t, n, squash) {
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

function gfHeat(press) {
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
function gfLobePath(c, L, W, f, side, t, quiver) {
    const n = 30, slack = 1 - f, fb = Math.max(0, f * 1.7 - 0.7);
    c.beginPath();
    for (let i = 0; i <= n; i++) {
        const a = i / n * Math.PI * 2, ca = Math.cos(a), sa = Math.sin(a);
        const outer = sa * side > 0;
        let ry = W * (1 - 0.28 * ca) * (outer ? 1 : 0.5);            // apex narrow, base wide, flat inner face
        let rx = L * (1 + 0.14 * fb * Math.max(0, -ca));              // the base fills last
        const fold = slack * (0.13 * Math.sin(a * 6 + t * 0.6) + 0.07 * Math.sin(a * 11 - t)) + quiver * 0.035 * Math.sin(a * 7 - gfTime * 20);
        if (outer) ry *= 1 + fold; else ry *= 1 + fold * 0.3;
        rx *= 1 + fold * 0.4;
        const px = ca * rx, py = sa * ry;
        if (i === 0) c.moveTo(px, py); else c.lineTo(px, py);
    }
    c.closePath();
}
function gfLobe(c, L, W, cr, side, hue, f) {
    const soft = !cr.b.armour, st = cr.b.stage, t = gfTime * (soft ? 4 : 1.5) + cr.seed + side;
    const inh = st === "inhale" ? 1 : 0, exh = st === "exhale" ? 1 : 0;
    const hx = L * 0.15, hy = -side * W * 0.35;        // the hilum: where the bronchus enters
    const g = c.createRadialGradient(hx, hy, W * 0.05, 0, side * W * 0.2, Math.max(L, W) * 1.15);
    if (cr.flash > 0) { g.addColorStop(0, "#FFFFFF"); g.addColorStop(1, "#FFD0DC"); }
    else if (soft) { g.addColorStop(0, hue.softHi); g.addColorStop(0.6, hue.softMid); g.addColorStop(1, hue.softLo); }
    else { g.addColorStop(0, hue.hi); g.addColorStop(0.3 + 0.3 * f, hue.mid); g.addColorStop(1, hue.lo); }
    c.fillStyle = g;
    gfLobePath(c, L, W, f, side, t, inh + exh);
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
        const al = soft ? 0 : 0.16 + 0.34 * (inh + exh) * (0.6 + 0.4 * Math.sin(gfTime * 14));
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
    c.strokeStyle = gfHeat(cr.press);
    const pulse = 1 + 0.15 * Math.sin(gfTime * 6 + cr.seed), fan = 0.45 + 0.55 * f;
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
function gfDrawMaw(c, mR, cr, hue, soft, wide) {
    const t = gfTime * (soft ? 5 : 2.2) + cr.seed, gulp = 0.5 + 0.5 * Math.sin(t);
    const R = mR * (1 + 0.3 * wide);
    // Collar: lumpy lips, darker toward the throat.
    const lg = c.createRadialGradient(0, 0, R * 0.5, 0, 0, R * 1.3);
    lg.addColorStop(0, "#2A0210"); lg.addColorStop(0.55, soft ? "#5A1230" : "#9A2A4C"); lg.addColorStop(1, soft ? "#3A0A1C" : "#D8607F");
    c.fillStyle = cr.flash > 0 ? "#FFE6EC" : lg;
    gfLumps(c, R * 1.22, 0.1, t * 0.7, 18, 1); c.fill();
    c.strokeStyle = "rgba(40,0,15,0.9)"; c.lineWidth = 1; c.stroke();
    // Throat: black, with one wet red ring of muscle working inward.
    c.fillStyle = "#050002"; c.beginPath(); c.arc(0, 0, R * 0.9, 0, Math.PI * 2); c.fill();
    if (R > 5) {
        const rr = R * (0.75 - 0.5 * gfFrac(t * 0.16));
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
            const h = gfFrac(Math.sin(cr.seed * 7 + i * 12.9898 + row * 78.233) * 43758.5453);
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

const GF_HUES = {
    crab: { hi: "rgba(255,214,222,0.95)", mid: "rgba(232,96,136,0.9)", lo: "rgba(110,18,52,0.92)", rim: "#FFB4C6",
            softHi: "#C24A6E", softMid: "#7A1C3C", softLo: "#2E0614" },
    bell: { hi: "rgba(255,200,190,0.95)", mid: "rgba(214,44,52,0.92)", lo: "rgba(84,6,16,0.95)", rim: "#FF8A80",
            softHi: "#B02A30", softMid: "#6A1016", softLo: "#260406" }
};

function gfDrawKrill(c, cr, R) {
    const soft = !cr.b.armour, t = gfTime * 14 + cr.seed;
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
    gfLumps(c, R, soft ? 0.2 : 0.05, t * 0.4, 12, soft ? 0.7 : 0.95); c.fill();
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

function gfDrawCreature(c, cr, z) {
    const k = GF_KINDS[cr.kind];
    const p = glWorldToScreen(cr.x, cr.y);
    if (p.h) return;
    let R = Math.max(k.minPx, cr.b.r * z);
    if (!gfOnScreen(p, R * 4 + 40)) return;
    // Being born: small, then swelling, with slime strands back to the mouth.
    if (cr.birthT > 0 && cr.ori) {
        const w = gfOrificePos(cr.ori), op = glWorldToScreenRaw(w.x, w.y);
        c.strokeStyle = "rgba(230,200,150,0.5)"; c.lineWidth = Math.max(1, R * 0.15);
        for (let i = -1; i <= 1; i += 2) {
            c.beginPath(); c.moveTo(op.x, op.y);
            c.quadraticCurveTo((op.x + p.x) / 2 + i * R * 0.6, (op.y + p.y) / 2 + R * 0.5, p.x + i * R * 0.3, p.y); c.stroke();
        }
        R *= 0.45 + 0.55 * (1 - cr.birthT / 0.9);
    }
    c.save();
    c.translate(p.x, p.y);
    // Crushed against its neighbours on the inhale: squashed along the line
    // it will be thrown down, shuddering harder as the breath fills.
    if (cr.crush > 0.05 && cr.tumble <= 0 && cr.kind !== "krill") {
        const q = Math.min(1, cr.crush), sh = q * 1.5 * Math.sin(gfTime * 40 + cr.seed);
        c.translate(Math.cos(cr.crushA + 1.57) * sh, Math.sin(cr.crushA + 1.57) * sh);
        c.rotate(cr.crushA); c.scale(1 - 0.22 * q, 1 + 0.12 * q); c.rotate(-cr.crushA);
    }
    c.rotate(cr.face);
    c.lineJoin = "round";
    if (cr.kind === "krill") { gfDrawKrill(c, cr, R); c.restore(); return; }

    const hue = GF_HUES[cr.kind], soft = !cr.b.armour, sw = cr.b.swell, bell = cr.kind === "bell";
    // About to burst: the whole body strobes white inside its blast ring.
    if (cr.ruptT > 0) {
        const on = Math.floor(gfTime * 24) % 2;
        c.fillStyle = on ? "rgba(255,255,255,0.55)" : "rgba(255,120,40,0.35)";
        c.beginPath(); c.arc(0, 0, k.blast * z, 0, Math.PI * 2); c.fill();
        c.strokeStyle = "#FFFFFF"; c.lineWidth = 3; c.stroke();
    }
    // Blast warning: once pressure is past a third, the ring it will burst to.
    if (cr.press > 0.33 && k.blast) {
        c.strokeStyle = "rgba(255,150,80," + (0.25 + 0.6 * cr.press).toFixed(2) + ")"; c.lineWidth = 1 + 2 * cr.press;
        c.setLineDash([6, 6]); c.beginPath(); c.arc(0, 0, k.blast * z, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    // The frame the lungs hang on (windpipe, mouth, vent) changes size far
    // less than the lobes do: slack, it is a head trailing two empty bags;
    // full, the lobes swallow it.
    const q = R / Math.max(0.01, cr.b.r * z);
    const S = q * z * (k.rSmall * 1.15 + (k.rBig * 0.8 - k.rSmall * 1.15) * sw);
    const stg = cr.b.stage, wide = cr.grabbing ? 1 : (cr.tendril > 0 ? 0.6 : 0);
    // Tendrils trailing from under the mouth (longer when big). The lash itself
    // is drawn after, in screen space.
    c.strokeStyle = soft ? "rgba(150,40,80,0.8)" : "rgba(255,150,180,0.8)"; c.lineCap = "round";
    const tl = S * (soft ? 1.1 : 2.0), nT = bell ? 9 : 6;
    for (let i = 0; i < nT; i++) {
        const off = (i - (nT - 1) / 2) / nT * S * 1.3, ph = gfTime * 3 + cr.seed + i * 1.3;
        c.lineWidth = Math.max(0.8, S * 0.06);
        c.beginPath(); c.moveTo(S * 0.5, off);
        c.bezierCurveTo(S * 0.1, off + Math.sin(ph) * S * 0.3, -tl * 0.5, off * 1.4 + Math.cos(ph) * S * 0.35, -tl - S * 0.4, off * 1.8 + Math.sin(ph * 1.3) * S * 0.4);
        c.stroke();
    }
    // Lobes either side of the windpipe (the Bellwether has a third, behind).
    const Ll = S * 0.7 + (R * 0.8 - S * 0.7) * sw, Wl = S * 0.2 + (R * 0.5 - S * 0.2) * sw;
    if (bell) { c.save(); c.translate(-S * 0.5 - Ll * 0.35, 0); gfLobe(c, Ll * 0.7, Wl * 0.9, cr, 1, hue, sw); c.restore(); }
    for (let s = -1; s <= 1; s += 2) {
        c.save(); c.translate(-S * 0.1, s * (S * 0.1 + Wl * 0.72)); c.rotate(s * (0.05 + 0.14 * sw)); gfLobe(c, Ll, Wl, cr, s, hue, sw); c.restore();
    }
    // Windpipe: ribbed tube down the middle, cartilage rings.
    c.fillStyle = soft ? "#3A0A1C" : "#F2C9B4"; c.strokeStyle = "rgba(60,0,20,0.9)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(S * 0.95, -S * 0.15); c.lineTo(-S * 0.6, -S * 0.1); c.lineTo(-S * 0.6, S * 0.1); c.lineTo(S * 0.95, S * 0.15); c.closePath();
    c.fill(); c.stroke();
    if (S > 8) {
        c.strokeStyle = soft ? "rgba(140,40,70,0.9)" : "rgba(150,70,60,0.9)";
        for (let i = 0; i < 7; i++) { const x = -S * 0.5 + i * S * 0.21; c.beginPath(); c.moveTo(x, -S * 0.12); c.lineTo(x, S * 0.12); c.stroke(); }
        // The breath going down it (in) or back up it (out): gulps of pale air.
        if (stg === "inhale" || stg === "exhale") {
            for (let i = 0; i < 3; i++) {
                let u = gfFrac(gfTime * 2.6 + i / 3); if (stg === "exhale") u = 1 - u;
                const x = S * 0.9 - u * S * 1.4;
                c.fillStyle = "rgba(255,255,255," + (0.75 * Math.sin(Math.min(1, Math.max(0, stg === "exhale" ? 1 - u : u)) * Math.PI)).toFixed(3) + ")";
                c.beginPath(); c.ellipse(x, 0, S * 0.1, S * 0.13, 0, 0, Math.PI * 2); c.fill();
            }
        }
    }
    // Mouth.
    c.save(); c.translate(S * 0.98, 0); gfDrawMaw(c, S * (bell ? 0.34 : 0.3), cr, hue, soft, wide); c.restore();
    if (bell) {
        // Crown of horn spines over the back, and a cluster of eyes.
        c.fillStyle = "#3A0508"; c.strokeStyle = "#FF8A80"; c.lineWidth = 1;
        for (let i = 0; i < 9; i++) {
            const a = Math.PI + (i - 4) * 0.3, r0 = R * 0.95, r1 = R * (1.35 + 0.12 * Math.sin(gfTime * 2 + i));
            c.beginPath();
            c.moveTo(Math.cos(a - 0.09) * r0, Math.sin(a - 0.09) * r0); c.lineTo(Math.cos(a) * r1, Math.sin(a) * r1); c.lineTo(Math.cos(a + 0.09) * r0, Math.sin(a + 0.09) * r0);
            c.closePath(); c.fill(); c.stroke();
        }
        for (let i = 0; i < 5; i++) {
            const ex = S * (0.5 + 0.1 * (i % 2)), ey = (i - 2) * S * 0.15;
            c.fillStyle = "#FFE45C"; c.beginPath(); c.arc(ex, ey, Math.max(1.2, R * 0.05), 0, Math.PI * 2); c.fill();
            c.fillStyle = "#000"; c.beginPath(); c.arc(ex + R * 0.015, ey, Math.max(0.6, R * 0.022), 0, Math.PI * 2); c.fill();
        }
    }
    // The rear vent: a puckered sphincter. Open = gaping and lit.
    const vx = -Math.max(S * 0.62, Ll * 0.8), vR = S * 0.26;
    if (cr.b.open) {
        const g = c.createRadialGradient(vx, 0, 0, vx, 0, vR * 2.4);
        g.addColorStop(0, "rgba(255,240,150,0.9)"); g.addColorStop(0.4, "rgba(255,200,60,0.45)"); g.addColorStop(1, "rgba(255,200,60,0)");
        c.fillStyle = g; c.beginPath(); c.arc(vx, 0, vR * 2.4, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#FFE45C"; c.beginPath(); c.arc(vx, 0, vR, 0, Math.PI * 2); c.fill();
        c.fillStyle = "#3A0A00"; c.beginPath(); c.arc(vx, 0, vR * 0.45, 0, Math.PI * 2); c.fill();
    } else if (!soft) {
        c.fillStyle = "#4A0A1E"; c.beginPath(); c.arc(vx, 0, vR * 0.6, 0, Math.PI * 2); c.fill();
    }
    if (!soft || cr.b.open) {
        c.strokeStyle = cr.b.open ? "#FFF3B0" : "rgba(30,0,10,0.9)"; c.lineWidth = 1;
        for (let i = 0; i < 8; i++) {
            const a = i * Math.PI / 4, r0 = vR * (cr.b.open ? 1 : 0.15), r1 = vR * (cr.b.open ? 1.45 : 0.75);
            c.beginPath(); c.moveTo(vx + Math.cos(a) * r0, Math.sin(a) * r0); c.lineTo(vx + Math.cos(a) * r1, Math.sin(a) * r1); c.stroke();
        }
    }
    // Thrown and tumbling: helpless, open to any shot.
    if (cr.tumble > 0) {
        c.strokeStyle = "rgba(255,228,92," + (0.5 + 0.4 * Math.sin(gfTime * 30)).toFixed(2) + ")"; c.lineWidth = 2; c.setLineDash([5, 5]);
        c.beginPath(); c.arc(0, 0, R * 1.15, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    // Marked by a needle: a white bracket, double damage.
    if (cr.mark > 0) {
        c.strokeStyle = "#EAF2FF"; c.lineWidth = 1.5;
        for (let i = 0; i < 4; i++) { c.beginPath(); c.arc(0, 0, R * 1.3, i * Math.PI / 2 + 0.25 + gfTime, i * Math.PI / 2 + 0.75 + gfTime); c.stroke(); }
    }
    // Winded (its Bellwether died clean): a slack green ring, free to hit.
    if (cr.winded > 0) {
        c.strokeStyle = "rgba(125,255,156,0.7)"; c.lineWidth = 1.5; c.setLineDash([3, 4]);
        c.beginPath(); c.arc(0, 0, R * 1.25, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    // Frenzied by a rupture: burning eyes at the mouth.
    if (cr.frenzy > 0) {
        c.fillStyle = "#FFEE66";
        for (let s = -1; s <= 1; s += 2) { c.beginPath(); c.arc(S * 0.62, s * S * 0.24, Math.max(1.5, S * 0.08), 0, Math.PI * 2); c.fill(); }
    }
    c.restore();

    // The lash: the tell, the reach, the hold (screen space, to the ship).
    const tgt = cr.grabbing || (cr.tendril > 0 ? cr.tendrilTarget : null);
    if (tgt) {
        const tp = glWorldToScreen(tgt.x, tgt.y);
        const reach = cr.grabbing ? 1 : cr.tendril / 0.7;
        c.strokeStyle = cr.grabbing ? "#FF2E88" : "rgba(255,150,180,0.9)";
        c.lineWidth = cr.grabbing ? 2.5 : 1.5;
        for (let i = -1; i <= 1; i++) {
            const fx = p.x + Math.cos(cr.face + i * 0.4) * R * 0.9, fy = p.y + Math.sin(cr.face + i * 0.4) * R * 0.9;
            const ex = fx + (tp.x - fx) * reach, ey = fy + (tp.y - fy) * reach;
            const mx = (fx + ex) / 2 + Math.sin(gfTime * 9 + i) * R * 0.5, my = (fy + ey) / 2 + Math.cos(gfTime * 7 + i) * R * 0.5;
            c.beginPath(); c.moveTo(fx, fy); c.quadraticCurveTo(mx, my, ex, ey); c.stroke();
        }
    }
}

// ---- rupture rings and the shards they throw ----
function gfDrawBlasts(c, z) {
    c.save();
    c.lineCap = "round";
    for (let i = 0; i < gfSpines.length; i++) {
        const sp = gfSpines[i], p = glWorldToScreenRaw(sp.x, sp.y);
        if (!gfOnScreen(p, 30)) continue;
        const m = Math.hypot(sp.vx, sp.vy) || 1, L = Math.max(10, 2.2 * z), ux = sp.vx / m, uy = sp.vy / m;
        const fade = Math.min(1, (GF_SPINE.life - sp.t) * 3);
        c.globalAlpha = 0.45 * fade; c.strokeStyle = "#FF3B3B"; c.lineWidth = 6;
        c.beginPath(); c.moveTo(p.x - ux * L, p.y - uy * L); c.lineTo(p.x, p.y); c.stroke();
        c.globalAlpha = fade; c.strokeStyle = "#FFF3E0"; c.lineWidth = 2.2;
        c.beginPath(); c.moveTo(p.x - ux * L * 0.8, p.y - uy * L * 0.8); c.lineTo(p.x + ux * 3, p.y + uy * 3); c.stroke();
    }
    c.globalAlpha = 1;
    for (let i = 0; i < gfBlasts.length; i++) {
        const b = gfBlasts[i], p = glWorldToScreenRaw(b.x, b.y), k = b.t / 0.6, R = b.r * z;
        if (!gfOnScreen(p, R + 20)) continue;
        if (b.soft) {   // a Bellwether died clean: the ring of everything it winded
            c.strokeStyle = "rgba(" + (b.col || "125,255,156") + "," + (0.8 * (1 - k)).toFixed(3) + ")"; c.lineWidth = 2;
            c.beginPath(); c.arc(p.x, p.y, R * Math.min(1, k * 2.5), 0, Math.PI * 2); c.stroke();
            continue;
        }
        const rr = R * Math.min(1, k * 3.5);
        const g = c.createRadialGradient(p.x, p.y, rr * 0.2, p.x, p.y, Math.max(1, rr));
        g.addColorStop(0, "rgba(255,250,220," + (0.8 * (1 - k)).toFixed(3) + ")");
        g.addColorStop(0.6, "rgba(255,150,70," + (0.55 * (1 - k)).toFixed(3) + ")");
        g.addColorStop(1, "rgba(180,20,50,0)");
        c.fillStyle = g; c.beginPath(); c.arc(p.x, p.y, Math.max(1, rr), 0, Math.PI * 2); c.fill();
        c.strokeStyle = "rgba(255,200,140," + (1 - k).toFixed(3) + ")"; c.lineWidth = 3 * (1 - k) + 1;
        c.beginPath(); c.arc(p.x, p.y, R, 0, Math.PI * 2); c.stroke();
    }
    c.restore();
}

// ---- The Tide ----
let gfTideVeins = null;
function gfBuildTideVeins() {
    // Angle/radius polylines (fractions of the radius), built once.
    const out = [];
    for (let i = 0; i < 46; i++) {
        let a = gfHash(i, 5) * Math.PI * 2, r = 1.0;
        const pts = [[a, r]];
        for (let s = 0; s < 6; s++) { a += (gfHash(i, s + 11) - 0.5) * 0.09; r -= 0.03 + gfHash(i + 3, s) * 0.035; pts.push([a, r]); }
        out.push({ pts: pts, w: 1 + gfHash(i, 77) * 2.5, ph: gfHash(i, 9) * 6.28 });
    }
    return out;
}

// A captured human satellite, drawn under the flesh that has grown over it:
// a truss spine, two solar wings and a dish. Dark while it is held; its
// running lights come back on when it is freed.
function gfDrawSatellite(c, z, st) {
    const p = glWorldToScreen(st.x, st.y);
    if (p.h) return;
    const R = st.r0 * z;
    if (!gfOnScreen(p, R * 3.2)) return;
    // Lit once its growth is gone (gf-cine.js flickers st.lit on): green.
    const live = !!st.lit, line = live ? "#7DFF9C" : "rgba(125,249,255,0.35)";
    c.save();
    c.translate(p.x, p.y);
    c.rotate(st.rot !== undefined ? st.rot : (st.kind === "relay" ? 0.5 : -0.9));   // freed, it swings its dish to the hive
    c.strokeStyle = line; c.lineWidth = 1.4; c.fillStyle = live ? "#0E2A33" : "#0A161B";
    // Truss.
    c.fillRect(-R * 2.7, -R * 0.09, R * 5.4, R * 0.18); c.strokeRect(-R * 2.7, -R * 0.09, R * 5.4, R * 0.18);
    c.beginPath();
    for (let i = -13; i < 13; i++) { c.moveTo(i * R * 0.2, -R * 0.09); c.lineTo((i + 1) * R * 0.2, R * 0.09); }
    c.stroke();
    // Solar wings, cells drawn in.
    for (let s = -1; s <= 1; s += 2) {
        const x0 = s > 0 ? R * 1.25 : -R * 2.65, w = R * 1.4;
        c.fillStyle = live ? "rgba(18,58,90,0.55)" : "rgba(10,26,40,0.5)";
        c.fillRect(x0, -R * 0.38, w, R * 0.76); c.strokeRect(x0, -R * 0.38, w, R * 0.76);
        c.beginPath();
        for (let i = 1; i < 6; i++) { c.moveTo(x0 + w * i / 6, -R * 0.38); c.lineTo(x0 + w * i / 6, R * 0.38); }
        c.moveTo(x0, 0); c.lineTo(x0 + w, 0);
        c.stroke();
    }
    if (st.kind === "relay") {
        // The dish.
        c.fillStyle = live ? "#16424F" : "#0B1E26";
        c.beginPath(); c.arc(0, -R * 1.25, R * 0.6, Math.PI * 0.1, Math.PI * 0.9); c.closePath(); c.fill(); c.stroke();
        c.beginPath(); c.moveTo(0, -R * 0.7); c.lineTo(0, -R * 1.8); c.stroke();
    } else {
        // The drydock's cradle arms.
        c.beginPath();
        for (let s = -1; s <= 1; s += 2) { c.moveTo(s * R * 0.5, 0); c.lineTo(s * R * 0.9, -R * 1.5); c.lineTo(s * R * 0.4, -R * 1.7); }
        c.stroke();
    }
    if (live) {
        for (let i = -5; i <= 5; i++) {
            c.fillStyle = (Math.floor(gfTime * 4) + i + 50) % 4 === 0 ? "#FFFFFF" : "#7DFF9C";
            c.fillRect(i * R * 0.5 - 1.5, -R * 0.2, 3, 3);
        }
    }
    c.restore();
}

function gfDrawSite(c, z, st) {
    if (st.kind !== "tide") gfDrawSatellite(c, z, st);
    const p = glWorldToScreen(st.x, st.y);
    if (p.h) return;
    const R = Math.max(10, st.r * z);
    if (!gfOnScreen(p, R * 1.2 + 40)) return;
    const dead = st.dead, t = gfTime;
    let cineQ = 0;
    // A freed satellite has shed its growth entirely (gf-cine.js bursts it).
    if (st.shed) return;
    c.save();
    c.translate(p.x, p.y);
    // About to burst off the satellite: swelling, shuddering, strobing pale.
    if (st.cleared && gfCine && gfCine.st === st) {
        const q = Math.min(1, gfCine.t / 0.95), sc = 1 + 0.22 * q * q + 0.03 * Math.sin(gfTime * 50) * q;
        c.translate(Math.sin(gfTime * 70) * 3 * q, Math.cos(gfTime * 60) * 3 * q); c.scale(sc, sc);
        cineQ = q;
    }
    // Small on screen (seen from far off): a simple breathing mass.
    const g = c.createRadialGradient(0, 0, R * 0.55, 0, 0, R * 1.02);
    if (dead) { g.addColorStop(0, "#12060A"); g.addColorStop(0.8, "#2A1016"); g.addColorStop(1, "#3E1A22"); }
    else { g.addColorStop(0, "#1E040C"); g.addColorStop(0.72, "#5A0E24"); g.addColorStop(0.93, "#A8284A"); g.addColorStop(1, "#E8607F"); }
    c.fillStyle = g;
    // Lumpy rim: many points only when it is big enough to see them.
    const n = R > 200 ? 220 : 60;
    c.beginPath();
    for (let i = 0; i <= n; i++) {
        const a = i / n * Math.PI * 2;
        const rr = R * (1 + 0.012 * Math.sin(a * 9 + t * 0.5) + 0.008 * Math.sin(a * 31 - t * 0.8) + 0.005 * Math.sin(a * 67 + t));
        if (i === 0) c.moveTo(Math.cos(a) * rr, Math.sin(a) * rr); else c.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
    }
    c.closePath(); c.fill();
    c.strokeStyle = dead ? "#5A2A34" : "#FF9DB4"; c.lineWidth = 2; c.stroke();
    if (cineQ > 0 && Math.floor(gfTime * 18) % 2) { c.fillStyle = "rgba(255,235,225," + (0.75 * cineQ).toFixed(2) + ")"; c.fill(); }
    if (R > 120) {
        // Veins running in from the rim, pulsing with its breath.
        if (!gfTideVeins) gfTideVeins = gfBuildTideVeins();
        c.lineCap = "round";
        for (let i = 0; i < gfTideVeins.length; i++) {
            const v = gfTideVeins[i];
            const beat = dead ? 0.3 : 0.55 + 0.45 * Math.sin(t * 1.6 + v.ph);
            c.strokeStyle = "rgba(" + (dead ? "90,40,50" : "255,90,120") + "," + (0.25 + 0.4 * beat).toFixed(2) + ")";
            c.lineWidth = v.w * (0.8 + 0.4 * beat) * Math.min(2, R / 400);
            c.beginPath();
            for (let j = 0; j < v.pts.length; j++) {
                const x = Math.cos(v.pts[j][0]) * v.pts[j][1] * R, y = Math.sin(v.pts[j][0]) * v.pts[j][1] * R;
                if (j === 0) c.moveTo(x, y); else c.lineTo(x, y);
            }
            c.stroke();
        }
        // Boils just under the skin, and cilia along the rim.
        for (let i = 0; i < 70; i++) {
            const a = gfHash(i, 201) * Math.PI * 2, rr = R * (0.8 + gfHash(i, 202) * 0.17);
            const br = R * (0.006 + gfHash(i, 203) * 0.014) * (dead ? 0.7 : 1 + 0.25 * Math.sin(t * 2 + i));
            const x = Math.cos(a) * rr, y = Math.sin(a) * rr;
            if (!gfOnScreen({ x: p.x + x, y: p.y + y }, 30)) continue;
            c.fillStyle = dead ? "rgba(60,25,32,0.9)" : "rgba(255,170,150,0.35)";
            c.beginPath(); c.arc(x, y, br, 0, Math.PI * 2); c.fill();
            c.fillStyle = dead ? "rgba(30,10,14,0.9)" : "rgba(255,235,210,0.5)";
            c.beginPath(); c.arc(x - br * 0.3, y - br * 0.3, br * 0.3, 0, Math.PI * 2); c.fill();
        }
        if (!dead) {
            c.strokeStyle = "rgba(255,160,185,0.55)"; c.lineWidth = 1.2;
            c.beginPath();
            for (let i = 0; i < 360; i++) {
                const a = i / 360 * Math.PI * 2, x = Math.cos(a) * R, y = Math.sin(a) * R;
                if (!gfOnScreen({ x: p.x + x, y: p.y + y }, 20)) continue;
                const L = R * (0.012 + 0.008 * Math.sin(i * 1.7)), sway = Math.sin(t * 2 + i * 0.6) * 0.5;
                c.moveTo(x, y); c.lineTo(x + Math.cos(a + sway) * L, y + Math.sin(a + sway) * L);
            }
            c.stroke();
        }
    }
    c.restore();
    c.globalAlpha = 1;
    for (let i = 0; i < st.orifices.length; i++) gfDrawOrifice(c, st.orifices[i], z);
}

function gfDrawOrifice(c, o, z) {
    const w = gfOrificePos(o), p = glWorldToScreen(w.x, w.y);
    if (p.h) return;
    const R = Math.max(4, o.site.oriR * z);
    if (!gfOnScreen(p, R * 3)) return;
    // 0 shut .. 1 gaping.
    let open = 0, swell = 0;
    if (o.clamped) { swell = 0; open = 0; }
    else if (o.state === "swell") swell = 1 - o.t / GF.oriSwell;
    else if (o.state === "open") { swell = 1; open = Math.min(1, (GF.oriOpen - o.t) * 2, o.t * 2); }
    const t = gfTime;
    c.save();
    c.translate(p.x, p.y);
    c.rotate(o.a);
    if (o.sealed) {
        // A burst, slack wound, weeping.
        c.fillStyle = "#1A0A0E"; gfLumps(c, R * 1.1, 0.25, o.id * 3, 16, 1.2); c.fill();
        c.strokeStyle = "#5A2A34"; c.lineWidth = 2; c.stroke();
        c.strokeStyle = "rgba(120,40,50,0.8)"; c.lineWidth = 1.5;
        for (let i = 0; i < 5; i++) { c.beginPath(); c.moveTo(0, (i - 2) * R * 0.4); c.lineTo(R * (0.8 + 0.3 * Math.sin(t + i)), (i - 2) * R * 0.5); c.stroke(); }
        c.restore();
        return;
    }
    // The swollen collar bulges out of the rim (x is outward).
    const bulge = R * (1.25 + 0.45 * swell + 0.05 * Math.sin(t * 5) * swell);
    const g = c.createRadialGradient(R * 0.1, 0, R * 0.2, 0, 0, bulge);
    if (o.flash > 0) { g.addColorStop(0, "#fff"); g.addColorStop(1, "#FFC0D0"); }
    else { g.addColorStop(0, "#7A1230"); g.addColorStop(0.6, swell > 0 ? "#E86A8A" : "#B03458"); g.addColorStop(1, "#5A0E24"); }
    c.fillStyle = g;
    gfLumps(c, bulge, 0.07, t * 0.8 + o.id, 26, 1.15); c.fill();
    c.strokeStyle = swell > 0 ? "#FFE45C" : "#FF9DB4"; c.lineWidth = swell > 0 ? 2.5 : 1.5; c.stroke();
    // Radial puckers.
    const hole = R * (0.1 + 0.62 * open + 0.12 * swell);
    c.strokeStyle = "rgba(60,0,20,0.85)"; c.lineWidth = Math.max(1, R * 0.05);
    for (let i = 0; i < 18; i++) {
        const a = i / 18 * Math.PI * 2;
        c.beginPath(); c.moveTo(Math.cos(a) * hole, Math.sin(a) * hole * 1.15); c.lineTo(Math.cos(a) * bulge * 0.92, Math.sin(a) * bulge * 1.05); c.stroke();
    }
    // The opening: a lit, wet throat behind a ring of teeth.
    if (swell > 0) {
        const gg = c.createRadialGradient(0, 0, 0, 0, 0, Math.max(1, hole));
        gg.addColorStop(0, open > 0 ? "#FFF0A0" : "#FF9A6A"); gg.addColorStop(0.7, open > 0 ? "#FF8A3C" : "#A02A30"); gg.addColorStop(1, "#30040C");
        c.fillStyle = gg;
    } else c.fillStyle = "#1A0008";
    c.beginPath(); c.ellipse(0, 0, hole, hole * 1.15, 0, 0, Math.PI * 2); c.fill();
    c.fillStyle = "#FFF3E0";
    for (let i = 0; i < 14; i++) {
        const a = i / 14 * Math.PI * 2, tip = hole * (0.55 + 0.1 * Math.sin(t * 8 + i));
        c.beginPath();
        c.moveTo(Math.cos(a - 0.13) * hole, Math.sin(a - 0.13) * hole * 1.15);
        c.lineTo(Math.cos(a) * tip, Math.sin(a) * tip * 1.15);
        c.lineTo(Math.cos(a + 0.13) * hole, Math.sin(a + 0.13) * hole * 1.15);
        c.closePath(); c.fill();
    }
    // Clamped (a satellite is still held): the mouth is laced shut with bone.
    // Two rows of curved ribs grow out of the collar from either side and
    // interlock over the hole like the fingers of two hands, each rib thick
    // at its root with a knuckle, tapering to a hooked tip, shaded so it
    // reads as round. A ridged spine runs across where they meet. They
    // strain and settle with the site's breath. (Pass 6. Ry: "bones need
    // improved at the tide"; it was five straight bars.)
    if (o.clamped) {
        const strain = 0.5 + 0.5 * Math.sin(t * 1.1 + o.id), nR = 6, span = bulge * 0.92;
        c.lineCap = "round"; c.lineJoin = "round";
        // Shadow under the cage.
        c.fillStyle = "rgba(10,0,4,0.55)"; c.beginPath(); c.ellipse(0, 0, R * 0.75, span * 0.95, 0, 0, Math.PI * 2); c.fill();
        for (let side = -1; side <= 1; side += 2) {
            for (let i = 0; i < nR; i++) {
                // Ribs alternate across the gap so the two rows mesh.
                const v = ((i + (side > 0 ? 0.5 : 0)) / nR * 2 - 1) * span * 0.86;
                const root = side * R * (0.95 - 0.25 * Math.abs(v / span)), tip = -side * R * (0.28 + 0.06 * strain);
                const bow = (v / span) * R * 0.35, w0 = Math.max(2.5, R * 0.17), hook = side * R * 0.1;
                const rib = function (w, col) {
                    c.strokeStyle = col; c.lineWidth = w;
                    c.beginPath(); c.moveTo(root, v);
                    c.quadraticCurveTo((root + tip) * 0.5, v + bow * 0.4, tip, v + bow * 0.15);
                    c.stroke();
                };
                rib(w0 + 2, "rgba(40,10,10,0.9)");            // outline
                rib(w0, "#CDBB98");                            // bone
                rib(w0 * 0.4, "#F6EEDC");                      // the lit ridge along it
                // The hooked tip, and the knuckle where it leaves the flesh.
                c.strokeStyle = "#E8DCC0"; c.lineWidth = Math.max(1.5, w0 * 0.5);
                c.beginPath(); c.moveTo(tip, v + bow * 0.15); c.lineTo(tip + hook * -0.6, v + bow * 0.15 + (v >= 0 ? 1 : -1) * R * 0.08); c.stroke();
                c.fillStyle = "#B7A27C"; c.strokeStyle = "rgba(40,10,10,0.9)"; c.lineWidth = 1;
                c.beginPath(); c.arc(root, v, w0 * 0.75, 0, Math.PI * 2); c.fill(); c.stroke();
                c.fillStyle = "#F6EEDC"; c.beginPath(); c.arc(root - w0 * 0.2, v - w0 * 0.2, w0 * 0.25, 0, Math.PI * 2); c.fill();
            }
        }
        // The spine across the seam: a row of vertebrae.
        for (let i = 0; i < 9; i++) {
            const v = (i / 8 * 2 - 1) * span * 0.9, w = Math.max(3, R * (0.2 - 0.07 * Math.abs(v / span)));
            c.fillStyle = "#D9CBA8"; c.strokeStyle = "rgba(40,10,10,0.9)"; c.lineWidth = 1;
            c.beginPath(); c.ellipse(0, v, w, w * 0.62, 0, 0, Math.PI * 2); c.fill(); c.stroke();
            c.fillStyle = "#7A6848"; c.beginPath(); c.ellipse(0, v, w * 0.3, w * 0.18, 0, 0, Math.PI * 2); c.fill();
        }
    }
    // Slime ropes while it is birthing.
    if (open > 0) {
        c.strokeStyle = "rgba(230,200,150,0.55)"; c.lineWidth = Math.max(1, R * 0.06);
        for (let i = -2; i <= 2; i++) {
            c.beginPath(); c.moveTo(0, i * hole * 0.4);
            c.quadraticCurveTo(R * 1.2, i * hole * 0.6 + Math.sin(t * 4 + i) * R * 0.3, R * (1.8 + 0.5 * Math.sin(t * 3 + i * 2)), i * R * 0.5); c.stroke();
        }
    }
    c.restore();
}
