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

// One lung lobe at the origin, long axis along x.
function gfLobe(c, R, cr, side, hue) {
    const soft = !cr.b.armour, sw = cr.b.swell, t = gfTime * (soft ? 5 : 1.5) + cr.seed + side;
    const g = c.createRadialGradient(-R * 0.25, -R * 0.3 * side, R * 0.05, 0, 0, R * 1.1);
    if (cr.flash > 0) { g.addColorStop(0, "#FFFFFF"); g.addColorStop(1, "#FFD0DC"); }
    else if (soft) { g.addColorStop(0, hue.softHi); g.addColorStop(0.6, hue.softMid); g.addColorStop(1, hue.softLo); }
    else { g.addColorStop(0, hue.hi); g.addColorStop(0.55, hue.mid); g.addColorStop(1, hue.lo); }
    c.fillStyle = g;
    gfLumps(c, R, soft ? 0.16 : 0.05, t, 22, soft ? 0.72 : 0.9);
    c.fill();
    c.strokeStyle = soft ? "rgba(60,0,20,0.9)" : hue.rim; c.lineWidth = soft ? 1 : 1.6;
    c.stroke();
    if (R < 7) return;
    // Bronchial veins: a trunk from the windpipe side, forking twice.
    c.strokeStyle = gfHeat(cr.press); c.lineCap = "round";
    const pulse = 1 + 0.15 * Math.sin(gfTime * 6 + cr.seed);
    for (let b = -1; b <= 1; b++) {
        const a0 = b * 0.7 + 0.15 * Math.sin(cr.seed + b);
        const x1 = Math.cos(a0) * R * 0.45, y1 = Math.sin(a0) * R * 0.4 + side * R * 0.1;
        c.lineWidth = Math.max(0.8, R * 0.07 * pulse);
        c.beginPath(); c.moveTo(-R * 0.1, -side * R * 0.45); c.quadraticCurveTo(x1 * 0.3, y1 * 0.2, x1, y1); c.stroke();
        c.lineWidth = Math.max(0.6, R * 0.04);
        for (let f = -1; f <= 1; f += 2) {
            const a1 = a0 + f * 0.55;
            c.beginPath(); c.moveTo(x1, y1); c.lineTo(x1 + Math.cos(a1) * R * 0.34, y1 + Math.sin(a1) * R * 0.3); c.stroke();
        }
    }
    if (soft) {
        // Shrivelled: wrinkle folds.
        c.strokeStyle = "rgba(40,0,15,0.6)"; c.lineWidth = 1;
        for (let i = -2; i <= 2; i++) { c.beginPath(); c.moveTo(i * R * 0.28, -R * 0.45); c.quadraticCurveTo(i * R * 0.28 + R * 0.1, 0, i * R * 0.28, R * 0.45); c.stroke(); }
    } else {
        // Taut: pale armour ribs across the lobe, and a wet highlight.
        c.strokeStyle = "rgba(255,235,225," + (0.18 + 0.3 * sw).toFixed(2) + ")"; c.lineWidth = Math.max(1, R * 0.06);
        for (let i = -1; i <= 1; i++) { c.beginPath(); c.arc(i * R * 0.42, side * R * 1.5, R * 1.55, -Math.PI / 2 - 0.42, -Math.PI / 2 + 0.42, side < 0); c.stroke(); }
        c.fillStyle = "rgba(255,255,255,0.22)";
        c.beginPath(); c.ellipse(-R * 0.3, -side * R * 0.3, R * 0.3, R * 0.12, -0.5 * side, 0, Math.PI * 2); c.fill();
    }
    // Pustules.
    c.fillStyle = soft ? "rgba(90,10,40,0.8)" : "rgba(255,210,190,0.55)";
    for (let i = 0; i < 4; i++) {
        const a = cr.seed * (i + 1) * 1.7, rr = R * (0.35 + 0.4 * ((cr.seed * (i + 3)) % 1));
        c.beginPath(); c.arc(Math.cos(a) * rr, Math.sin(a) * rr * 0.75, Math.max(0.8, R * 0.07), 0, Math.PI * 2); c.fill();
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
    // Tendrils trailing from under the mouth (longer when big). The lash itself
    // is drawn after, in screen space.
    c.strokeStyle = soft ? "rgba(150,40,80,0.8)" : "rgba(255,150,180,0.8)"; c.lineCap = "round";
    const tl = R * (soft ? 0.9 : 1.6), nT = bell ? 9 : 6;
    for (let i = 0; i < nT; i++) {
        const off = (i - (nT - 1) / 2) / nT * R * 1.3, ph = gfTime * 3 + cr.seed + i * 1.3;
        c.lineWidth = Math.max(0.8, R * 0.05);
        c.beginPath(); c.moveTo(R * 0.5, off);
        c.bezierCurveTo(R * 0.1, off + Math.sin(ph) * R * 0.3, -tl * 0.5, off * 1.4 + Math.cos(ph) * R * 0.35, -tl - R * 0.4, off * 1.8 + Math.sin(ph * 1.3) * R * 0.4);
        c.stroke();
    }
    // Lobes either side of the windpipe (the Bellwether has a third, behind).
    const spread = R * (soft ? 0.36 : 0.46), lobeR = R * (soft ? 0.6 : 0.7);
    if (bell) { c.save(); c.translate(-R * 0.5, 0); gfLobe(c, lobeR * 0.9, cr, 1, hue); c.restore(); }
    for (let s = -1; s <= 1; s += 2) {
        c.save(); c.translate(-R * 0.05, s * spread); c.rotate(s * 0.25); gfLobe(c, lobeR, cr, s, hue); c.restore();
    }
    // Windpipe: ribbed tube down the middle, cartilage rings.
    c.fillStyle = soft ? "#3A0A1C" : "#F2C9B4"; c.strokeStyle = "rgba(60,0,20,0.9)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(R * 0.95, -R * 0.13); c.lineTo(-R * 0.55, -R * 0.09); c.lineTo(-R * 0.55, R * 0.09); c.lineTo(R * 0.95, R * 0.13); c.closePath();
    c.fill(); c.stroke();
    if (R > 8) {
        c.strokeStyle = soft ? "rgba(140,40,70,0.9)" : "rgba(150,70,60,0.9)";
        for (let i = 0; i < 7; i++) { const x = -R * 0.45 + i * R * 0.2; c.beginPath(); c.moveTo(x, -R * 0.11); c.lineTo(x, R * 0.11); c.stroke(); }
    }
    // Mouth: a ring of teeth round a dark throat, working open and shut.
    const gape = 0.5 + 0.5 * Math.sin(gfTime * (soft ? 9 : 2.5) + cr.seed), mR = R * (bell ? 0.3 : 0.26);
    c.fillStyle = "#1A0008"; c.beginPath(); c.arc(R * 0.95, 0, mR, 0, Math.PI * 2); c.fill();
    c.strokeStyle = hue.rim; c.lineWidth = Math.max(1, R * 0.05); c.stroke();
    c.fillStyle = "#FFF3E0";
    const nTeeth = bell ? 12 : 8;
    for (let i = 0; i < nTeeth; i++) {
        const a = i / nTeeth * Math.PI * 2, inner = mR * (0.35 + 0.35 * gape);
        c.beginPath();
        c.moveTo(R * 0.95 + Math.cos(a - 0.2) * mR, Math.sin(a - 0.2) * mR);
        c.lineTo(R * 0.95 + Math.cos(a) * inner, Math.sin(a) * inner);
        c.lineTo(R * 0.95 + Math.cos(a + 0.2) * mR, Math.sin(a + 0.2) * mR);
        c.closePath(); c.fill();
    }
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
            const ex = R * (0.45 + 0.1 * (i % 2)), ey = (i - 2) * R * 0.13;
            c.fillStyle = "#FFE45C"; c.beginPath(); c.arc(ex, ey, Math.max(1.2, R * 0.05), 0, Math.PI * 2); c.fill();
            c.fillStyle = "#000"; c.beginPath(); c.arc(ex + R * 0.015, ey, Math.max(0.6, R * 0.022), 0, Math.PI * 2); c.fill();
        }
    }
    // The rear vent: a puckered sphincter. Open = gaping and lit.
    const vx = -R * 0.72, vR = R * 0.26;
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
    // Winded (its Bellwether died clean): a slack green ring, free to hit.
    if (cr.winded > 0) {
        c.strokeStyle = "rgba(125,255,156,0.7)"; c.lineWidth = 1.5; c.setLineDash([3, 4]);
        c.beginPath(); c.arc(0, 0, R * 1.25, 0, Math.PI * 2); c.stroke(); c.setLineDash([]);
    }
    // Frenzied by a rupture: burning eyes at the mouth.
    if (cr.frenzy > 0) {
        c.fillStyle = "#FFEE66";
        for (let s = -1; s <= 1; s += 2) { c.beginPath(); c.arc(R * 0.7, s * R * 0.2, Math.max(1.5, R * 0.07), 0, Math.PI * 2); c.fill(); }
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
            c.strokeStyle = "rgba(125,255,156," + (0.8 * (1 - k)).toFixed(3) + ")"; c.lineWidth = 2;
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
    const live = st.cleared, line = live ? "#7DF9FF" : "rgba(125,249,255,0.35)";
    c.save();
    c.translate(p.x, p.y);
    c.rotate(st.kind === "relay" ? 0.5 : -0.9);
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
    // A freed satellite sheds most of its growth: what is left hangs thin.
    if (st.cleared) c.globalAlpha = 0.45;
    c.save();
    c.translate(p.x, p.y);
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
    // Clamped (a satellite is still held): bone bars locked across the mouth.
    if (o.clamped) {
        c.strokeStyle = "#E8D8C0"; c.lineCap = "round";
        for (let i = -2; i <= 2; i++) {
            c.lineWidth = Math.max(2, R * 0.14);
            c.beginPath(); c.moveTo(R * 0.25, i * R * 0.42 - R * 0.9 * 0); c.moveTo(-R * 0.1 + Math.abs(i) * R * 0.05, i * R * 0.45);
            c.lineTo(R * 0.35, i * R * 0.45); c.stroke();
        }
        c.lineWidth = Math.max(2, R * 0.16);
        c.beginPath(); c.moveTo(R * 0.3, -R * 1.25); c.lineTo(R * 0.3, R * 1.25); c.stroke();
        c.beginPath(); c.moveTo(-R * 0.05, -R * 1.15); c.lineTo(-R * 0.05, R * 1.15); c.stroke();
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
