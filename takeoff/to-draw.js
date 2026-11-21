// ===================================================
//   Takeoff — drawing: sky, ground and silo, clouds, Earth, effects, HUD,
//   title, crawl and the score card; plus the frame loop
// ===================================================
// Cabinet: VECTOR, like Gyro Fleet. A night launch, so the ground stays
// black (AESTHETIC_GUIDE §2.1); the sky fades from deep navy to black as you
// climb and the stars come out. Signal colours keep their meanings: amber =
// value (the meter, the live port), cyan = system (the mothership), magenta =
// danger (hits, enemy fire, the held-ship warning).
"use strict";

const TO_FONT = "'Press Start 2P', 'Courier New', monospace";
const TO_CLIMB_H = 9500;       // world units from the pad to orbit, for the sky and the altitude strip
const toStars = [];
for (let i = 0; i < 160; i++) toStars.push({ x: Math.random(), y: Math.random(), b: Math.random(), tw: Math.random() * 6 });
const toClouds = [];
for (let i = 0; i < 26; i++) toClouds.push({ x: toRand(-900, 900), y: 500 + i * 140 + toRand(-60, 60), w: toRand(120, 300), seed: Math.random() * 10 });

function toAlt() { return toClamp(toCam.y / TO_CLIMB_H, 0, 1); }

function toDrawSky(c) {
    const k = toPhase === "orbit" || toPhase === "dock" || (toPhase === "after" && toWin) || toPhase === "card" && toWin ? 1 : toAlt();
    const g = c.createLinearGradient(0, 0, 0, toH);
    const lo = Math.round(28 * (1 - k)), mid = Math.round(14 * (1 - k));
    g.addColorStop(0, "rgb(0," + Math.round(mid * 0.3) + "," + mid + ")");
    g.addColorStop(1, "rgb(" + Math.round(lo * 0.15) + "," + Math.round(lo * 0.45) + "," + lo + ")");
    c.fillStyle = g; c.fillRect(0, 0, toW, toH);
    // Dawn glow on the eastern horizon, low down only.
    if (k < 0.5) {
        const a = 0.22 * (1 - k * 2), gy = toSY(0);
        const dg = c.createRadialGradient(toW * 1.05, gy, 10, toW * 1.05, gy, toW * 0.7);
        dg.addColorStop(0, "rgba(255,150,80," + a.toFixed(3) + ")"); dg.addColorStop(1, "rgba(255,150,80,0)");
        c.fillStyle = dg; c.fillRect(0, 0, toW, toH);
    }
    // Stars: they come out as you climb, and drift with the camera a little.
    const sa = 0.15 + 0.85 * k;
    for (let i = 0; i < toStars.length; i++) {
        const s = toStars[i];
        const x = ((s.x * toW - toCam.x * 0.03 * toCam.s) % toW + toW) % toW;
        const y = ((s.y * toH + toCam.y * 0.04 * toCam.s) % toH + toH) % toH;
        const a = sa * (0.3 + 0.7 * s.b) * (0.75 + 0.25 * Math.sin(toTime * 2 + s.tw));
        c.fillStyle = "rgba(232,255,244," + a.toFixed(3) + ")";
        c.fillRect(x, y, s.b > 0.85 ? 2 : 1, s.b > 0.85 ? 2 : 1);
    }
}

function toDrawEarth(c) {
    const inOrbit = toPhase === "orbit" || toPhase === "dock" || ((toPhase === "after" || toPhase === "card") && toWin);
    const k = inOrbit ? Math.min(1, toPhase === "orbit" ? toPhaseT / 4 : 1) : Math.max(0, (toAlt() - 0.8) / 0.2) * 0.5;
    if (k <= 0) return;
    const R = toW * 2.2, cx = toW / 2, cy = toH + R - toH * 0.16 * k;
    c.save();
    const g = c.createRadialGradient(cx, cy, R * 0.9, cx, cy, R);
    g.addColorStop(0, "#02060C"); g.addColorStop(1, "#071A2A");
    c.fillStyle = g; c.beginPath(); c.arc(cx, cy, R, 0, Math.PI * 2); c.fill();
    // Atmosphere rim.
    c.strokeStyle = "rgba(0,229,255,0.55)"; c.lineWidth = 2;
    c.beginPath(); c.arc(cx, cy, R, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
    c.strokeStyle = "rgba(0,229,255,0.12)"; c.lineWidth = 10;
    c.beginPath(); c.arc(cx, cy, R + 6, Math.PI * 1.2, Math.PI * 1.8); c.stroke();
    // City lights turning under you.
    const rot = toCam.x * 0.00012;
    c.fillStyle = "rgba(255,176,0,0.55)";
    for (let i = 0; i < 90; i++) {
        const a = Math.PI * 1.5 + (toFrac(i * 0.61803 - rot) - 0.5) * 0.7, rr = R - 6 - toFrac(i * 0.377) * 40;
        c.fillRect(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr, 1.5, 1.5);
    }
    c.restore();
}

function toDrawClouds(c) {
    const k = toAlt();
    if (k > 0.45 || toPhase === "orbit" || toPhase === "dock" || ((toPhase === "after" || toPhase === "card") && toWin)) return;
    c.save();
    for (let i = 0; i < toClouds.length; i++) {
        const cl = toClouds[i];
        // Parallax: clouds sit a little "behind" the play plane.
        const y = toH - (cl.y - toCam.y * 0.75) * toCam.s, x = toW / 2 + (cl.x - toCam.x * 0.75) * toCam.s;
        if (y < -60 || y > toH + 60) continue;
        const w = cl.w * toCam.s;
        c.fillStyle = "rgba(6,12,20,0.75)"; c.strokeStyle = "rgba(143,168,156,0.28)"; c.lineWidth = 1;
        c.beginPath();
        for (let j = 0; j <= 6; j++) {
            const u = j / 6, bx = x - w / 2 + u * w, r = w * (0.09 + 0.06 * Math.sin(cl.seed + j * 2.3));
            c.arc(bx, y - r * 0.3, r, Math.PI, 0);
        }
        c.lineTo(x + w / 2, y + 4); c.lineTo(x - w / 2, y + 4); c.closePath();
        c.fill(); c.stroke();
    }
    c.restore();
}

// The launch site: silo shaft, aperture doors, pads, towers and floodlights.
function toDrawSiloBack(c) {
    const gy = toSY(0);
    if (gy > toH + 400 || gy < -50) return;
    const s = toCam.s;
    // Shaft walls.
    c.fillStyle = "#070C0E"; c.fillRect(toSX(-80), gy, 160 * s, toH);
    c.strokeStyle = "rgba(143,168,156,0.35)"; c.lineWidth = 1;
    c.beginPath();
    for (let i = 0; i < 12; i++) { const y = gy + i * 30 * s; c.moveTo(toSX(-80), y); c.lineTo(toSX(-70), y + 10 * s); c.moveTo(toSX(80), y); c.lineTo(toSX(70), y + 10 * s); }
    c.moveTo(toSX(-80), gy); c.lineTo(toSX(-80), toH); c.moveTo(toSX(80), gy); c.lineTo(toSX(80), toH);
    c.stroke();
    // Floodlight cones toward the silo.
    [-330, 330].forEach(function (tx) {
        const lx = toSX(tx), ly = toSY(210);
        const g = c.createLinearGradient(lx, ly, toSX(0), gy);
        g.addColorStop(0, "rgba(232,255,244,0.14)"); g.addColorStop(1, "rgba(232,255,244,0)");
        c.fillStyle = g; c.beginPath(); c.moveTo(lx, ly); c.lineTo(toSX(tx > 0 ? -40 : 40), gy); c.lineTo(toSX(tx > 0 ? 120 : -120), gy); c.closePath(); c.fill();
    });
}
function toDrawGround(c) {
    const gy = toSY(0);
    if (gy > toH + 10 || gy < -300) return;
    const s = toCam.s, open = toDoors;
    // Ground, with the aperture hole.
    c.fillStyle = "#000";
    c.fillRect(0, gy, toSX(-80), toH - gy); c.fillRect(toSX(80), gy, toW - toSX(80), toH - gy);
    c.strokeStyle = "#8FA89C"; c.lineWidth = 1.5;
    c.beginPath(); c.moveTo(0, gy); c.lineTo(toSX(-80), gy); c.moveTo(toSX(80), gy); c.lineTo(toW, gy); c.stroke();
    // Ground texture: a few faint contour lines.
    c.strokeStyle = "rgba(46,58,52,0.8)"; c.lineWidth = 1;
    for (let i = 1; i < 5; i++) { c.beginPath(); c.moveTo(0, gy + i * 14 * s); c.lineTo(toW, gy + i * 14 * s); c.stroke(); }
    // Aperture doors sliding apart (amber hazard edges).
    const dw = 80;
    [-1, 1].forEach(function (sd) {
        const x0 = sd < 0 ? -80 - open * dw : 0 + open * dw, x1 = x0 + dw;
        const a = toSX(sd < 0 ? x0 : x0), b = toSX(sd < 0 ? x1 : x1);
        c.fillStyle = "#121A1C"; c.fillRect(Math.min(a, b), gy - 2, Math.abs(b - a), 8 * s);
        c.strokeStyle = "#8FA89C"; c.strokeRect(Math.min(a, b), gy - 2, Math.abs(b - a), 8 * s);
        c.fillStyle = "#FFB000";
        const edge = sd < 0 ? Math.max(a, b) : Math.min(a, b);
        for (let j = 0; j < 3; j++) c.fillRect(edge - (sd < 0 ? 6 : 0) * s - 0, gy - 2 + j * 3 * s, 6 * s * 0 + 3, 2);
    });
    // Pads: yours lit, three empty ones for the absent crews.
    [-260, -190, 190, 260].forEach(function (px) {
        const mine = px === -190;
        c.fillStyle = "#0B1214"; c.strokeStyle = mine ? "#00E5FF" : "rgba(143,168,156,0.5)"; c.lineWidth = 1.2;
        c.fillRect(toSX(px - 22), gy - 4 * s, 44 * s, 4 * s); c.strokeRect(toSX(px - 22), gy - 4 * s, 44 * s, 4 * s);
        if (mine && toP.onPad) { c.fillStyle = "rgba(0,229,255," + (0.3 + 0.3 * Math.sin(toTime * 4)).toFixed(2) + ")"; c.fillRect(toSX(px - 22), gy - 5 * s, 44 * s, 1.5); }
    });
    // Towers with floodlights.
    [-330, 330].forEach(function (tx) {
        c.strokeStyle = "rgba(143,168,156,0.8)"; c.lineWidth = 1;
        const x0 = toSX(tx - 10), x1 = toSX(tx + 10);
        c.beginPath(); c.moveTo(x0, gy); c.lineTo(toSX(tx - 5), toSY(210)); c.moveTo(x1, gy); c.lineTo(toSX(tx + 5), toSY(210));
        for (let i = 0; i < 10; i++) { const y0 = toSY(i * 21), y1 = toSY((i + 1) * 21); c.moveTo(toLerp(x0, toSX(tx - 5), i / 10), y0); c.lineTo(toLerp(x1, toSX(tx + 5), (i + 1) / 10), y1); }
        c.stroke();
        c.fillStyle = "#E8FFF4"; c.fillRect(toSX(tx) - 4, toSY(214), 8, 4);
        c.fillStyle = (Math.floor(toTime * 1.5) % 2) ? "#FF2E88" : "#3a0a1c"; c.fillRect(toSX(tx) - 1.5, toSY(222), 3, 3);
    });
}

function toDrawFx(c) {
    for (let i = 0; i < toFx.length; i++) {
        const f = toFx[i], x = toSX(f.x), y = toSY(f.y), k = f.t / f.life;
        if (f.k === "p") {
            c.globalAlpha = 1 - k; c.fillStyle = f.col; c.fillRect(x - 1.5, y - 1.5, 3, 3);
        } else if (f.k === "r") {
            c.globalAlpha = 1 - k; c.strokeStyle = f.col; c.lineWidth = 2;
            c.beginPath(); c.arc(x, y, Math.max(1, f.r * toCam.s * (0.2 + 0.8 * k)), 0, Math.PI * 2); c.stroke();
        } else if (f.k === "smoke") {
            c.globalAlpha = 0.35 * (1 - k); c.fillStyle = "#8FA89C";
            c.beginPath(); c.arc(x, y, f.r * toCam.s, 0, Math.PI * 2); c.fill();
        }
    }
    c.globalAlpha = 1;
}

// ---- HUD ----
function toDrawHud(c) {
    const s = Math.max(1, Math.min(1.6, toH / 700));
    c.save();
    c.font = Math.round(9 * s) + "px " + TO_FONT; c.textBaseline = "top";
    // Mothership hull (the team's health), top left: a little ship glyph and a bar.
    const hx = 16, hy = 16, hw = 190 * s, f = toM.hull / TO.hull;
    c.strokeStyle = "#00E5FF"; c.lineWidth = 1.2;
    c.beginPath(); c.moveTo(hx + 6, hy); c.lineTo(hx + 10, hy + 4); c.lineTo(hx + 10, hy + 13); c.lineTo(hx + 2, hy + 13); c.lineTo(hx + 2, hy + 4); c.closePath(); c.stroke();
    c.fillStyle = "rgba(46,58,52,0.9)"; c.fillRect(hx + 18, hy + 3, hw, 8);
    c.fillStyle = f < 0.34 ? "#FF2E88" : "#00E5FF"; c.fillRect(hx + 18, hy + 3, hw * f, 8);
    if (toM.flash > 0) { c.fillStyle = "rgba(255,46,136," + (toM.flash * 2).toFixed(2) + ")"; c.fillRect(hx + 18, hy + 3, hw, 8); }
    // A notch every third: one failed gate's worth.
    c.fillStyle = "#000"; for (let i = 1; i < 3; i++) c.fillRect(hx + 18 + hw * (1 - i * TO.gateHit / 100), hy + 2, 2, 10);

    // The meter: amber, right under your ship, so it never takes your eyes off the fight.
    if (!toP.dead && !toP.onPad) {
        const mw = 36, mx = toSX(toP.x) - mw / 2, my = toSY(toP.y) + 24, mf = toP.meter / TO_SHIP.meterMax;
        c.fillStyle = "rgba(46,58,52,0.9)"; c.fillRect(mx, my, mw, 3);
        c.fillStyle = mf < 0.15 && Math.floor(toTime * 8) % 2 ? "#FF2E88" : "#FFB000"; c.fillRect(mx, my, mw * mf, 3);
    }

    // Altitude strip on the right: Earth at the bottom, orbit at the top, the four gates.
    const ax = toW - 18, ay0 = toH * 0.82, ay1 = toH * 0.18;
    c.strokeStyle = "rgba(143,168,156,0.6)"; c.lineWidth = 1;
    c.beginPath(); c.moveTo(ax, ay0); c.lineTo(ax, ay1); c.stroke();
    const segAlt = toPlanAlts();
    for (let i = 0; i < segAlt.gates.length; i++) {
        const y = toLerp(ay0, ay1, segAlt.gates[i]), done = toSeg > segAlt.idx[i];
        c.fillStyle = done ? "rgba(143,168,156,0.5)" : (i === segAlt.gates.length - 1 ? "#FF2E88" : "#C24A6E");
        c.fillRect(ax - (i === segAlt.gates.length - 1 ? 7 : 5), y - 1.5, i === segAlt.gates.length - 1 ? 14 : 10, 3);
    }
    const py = toLerp(ay0, ay1, toPlanProgress());
    c.fillStyle = "#FFC83D"; c.beginPath(); c.moveTo(ax - 10, py - 4); c.lineTo(ax - 3, py); c.lineTo(ax - 10, py + 4); c.closePath(); c.fill();

    // Held-ship warning: the bottom edge glows magenta as the ship slides toward it.
    if (toG && toG.state === "hold") {
        const gap = toMotherBottom() - toCam.y, w = toClamp(1 - gap / 220, 0, 1);
        if (w > 0) {
            const g = c.createLinearGradient(0, toH, 0, toH - 90 * s);
            g.addColorStop(0, "rgba(255,46,136," + (w * (0.5 + 0.3 * Math.sin(toTime * 10))).toFixed(3) + ")"); g.addColorStop(1, "rgba(255,46,136,0)");
            c.fillStyle = g; c.fillRect(0, toH - 90 * s, toW, 90 * s);
        }
    }
    // Respawn timer by the mothership.
    if (toP.dead && toPhase !== "after" && toPhase !== "card") {
        c.textAlign = "center"; c.fillStyle = "#00E5FF"; c.font = Math.round(14 * s) + "px " + TO_FONT;
        c.fillText(String(Math.ceil(Math.max(0, toP.respawnT))), toSX(toM.x + toM.w / 2 + 30), toSY(toM.y + toM.h * 0.2) - 8);
    }
    // Countdown digits.
    if (toPhase === "launch" && toCount > 0) {
        c.textAlign = "center"; c.textBaseline = "middle";
        c.font = Math.round(64 * s) + "px " + TO_FONT;
        c.fillStyle = "rgba(232,255,244," + (1 - toFrac(toPhaseT - TO_LAUNCH.count0) * 0.7).toFixed(2) + ")";
        c.fillText(String(toCount), toW / 2, toH * 0.3);
        c.font = Math.round(10 * s) + "px " + TO_FONT; c.fillStyle = "#8FA89C";
        c.fillText("T-MINUS", toW / 2, toH * 0.3 - 52 * s);
    }
    // Caption.
    if (toCaption.t > 0 && toCaption.text) {
        c.textAlign = "center"; c.textBaseline = "middle";
        c.font = Math.round(14 * s) + "px " + TO_FONT;
        c.globalAlpha = Math.min(1, toCaption.t * 2);
        c.fillStyle = "#E8FFF4"; c.fillText(toCaption.text, toW / 2, toH * 0.42);
        c.globalAlpha = 1;
    }
    if (toGod) { c.textAlign = "left"; c.fillStyle = "#FFB000"; c.font = Math.round(8 * s) + "px " + TO_FONT; c.fillText("DEV", 16, 40 * s); }
    c.restore();
}
// Where the gates sit on the altitude strip, as fractions of the run (by plan time).
function toPlanAlts() {
    if (toPlanAlts.cache) return toPlanAlts.cache;
    let t = 0; const marks = [], idx = [];
    const total = toPlanTotal();
    for (let i = 0; i < TO_PLAN.length; i++) {
        const s = TO_PLAN[i];
        if (s.k === "gate") { marks.push((t + 7) / total); idx.push(i); t += 15; }
        else if (s.k === "climb") t += s.dur;
    }
    toPlanAlts.cache = { gates: marks, idx: idx };
    return toPlanAlts.cache;
}
function toPlanTotal() { let t = 0; TO_PLAN.forEach(function (s) { t += s.k === "gate" ? 15 : (s.k === "climb" ? s.dur : 0); }); return t + 2; }
function toPlanProgress() {
    if (toPhase === "launch" || toPhase === "title" || toPhase === "crawl") return 0;
    if (toSeg >= 8) return 1;
    let t = 0;
    for (let i = 0; i < toSeg; i++) { const s = TO_PLAN[i]; t += s.k === "gate" ? 15 : (s.k === "climb" ? s.dur : 0); }
    const cur = TO_PLAN[toSeg];
    if (cur.k === "climb") t += Math.min(cur.dur, toSegT);
    else if (cur.k === "gate") t += Math.min(14, toPhaseT * 0.8);
    return toClamp(t / toPlanTotal(), 0, 1);
}

// ---- title, crawl, card ----
function toDrawTitle(c) {
    const s = Math.max(1, Math.min(1.8, toH / 700));
    c.save(); c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "rgba(0,0,0,0.45)"; c.fillRect(0, 0, toW, toH);
    c.font = Math.round(44 * s) + "px " + TO_FONT;
    c.shadowColor = "#FFB000"; c.shadowBlur = 18;
    c.fillStyle = "#E8FFF4"; c.fillText("TAKEOFF", toW / 2, toH * 0.32);
    c.shadowBlur = 0;
    c.font = Math.round(10 * s) + "px " + TO_FONT;
    c.fillStyle = Math.floor(toTime * 2) % 2 ? "#FFB000" : "rgba(255,176,0,0.35)";
    c.fillText("CLICK TO START", toW / 2, toH * 0.62);
    c.restore();
}
function toDrawCrawl(c) {
    const s = Math.max(1, Math.min(1.6, toH / 700));
    c.save(); c.textAlign = "center"; c.textBaseline = "middle";
    c.fillStyle = "#000"; c.fillRect(0, 0, toW, toH);
    toDrawSky(c);
    c.font = Math.round(13 * s) + "px " + TO_FONT;
    const lh = 34 * s, y0 = toH + 20 - toPhaseT * 46 * s;
    for (let i = 0; i < TO_CRAWL.length; i++) {
        const y = y0 + i * lh;
        if (y < -20 || y > toH + 20) continue;
        const fade = toClamp(y / (toH * 0.35), 0, 1);
        c.fillStyle = "rgba(255,176,0," + fade.toFixed(3) + ")";
        c.fillText(TO_CRAWL[i], toW / 2, y);
    }
    c.font = Math.round(7 * s) + "px " + TO_FONT; c.fillStyle = "rgba(143,168,156,0.7)";
    c.fillText("CLICK TO SKIP", toW / 2, toH - 18);
    c.restore();
    if (y0 + TO_CRAWL.length * lh < -20) toNewRun();
}
function toDrawCard(c) {
    const s = Math.max(1, Math.min(1.6, toH / 700));
    c.save();
    c.fillStyle = "rgba(0,0,0,0.82)"; c.fillRect(0, 0, toW, toH);
    c.textAlign = "center"; c.textBaseline = "middle";
    c.font = Math.round(18 * s) + "px " + TO_FONT;
    c.fillStyle = toWin ? "#00E5FF" : "#FF2E88";
    c.fillText(toWin ? "IN ORBIT" : "MOTHERSHIP LOST", toW / 2, toH * 0.18);
    const w = Math.min(560 * s, toW - 40), x0 = toW / 2 - w / 2;
    c.font = Math.round(10 * s) + "px " + TO_FONT;
    const shown = Math.min(toCardRows.length, Math.floor(toPhaseT / 0.25));
    for (let i = 0; i < shown; i++) {
        const y = toH * 0.28 + i * 24 * s, r = toCardRows[i];
        c.textAlign = "left"; c.fillStyle = "#8FA89C"; c.fillText(r[0], x0, y);
        c.textAlign = "right"; c.fillStyle = "#E8FFF4"; c.fillText(window.HUBSCORE ? HUBSCORE.format(r[1]) : String(r[1]), x0 + w, y);
    }
    if (shown >= toCardRows.length) {
        const y = toH * 0.28 + (toCardRows.length + 0.8) * 24 * s;
        c.fillStyle = "#2E3A34"; c.fillRect(x0, y - 14 * s, w, 2);
        c.font = Math.round(13 * s) + "px " + TO_FONT;
        c.textAlign = "left"; c.fillStyle = "#FFB000"; c.fillText("TOTAL", x0, y + 6 * s);
        c.textAlign = "right"; c.fillText(window.HUBSCORE ? HUBSCORE.format(toScore) : String(toScore), x0 + w, y + 6 * s);
        c.textAlign = "center"; c.font = Math.round(8 * s) + "px " + TO_FONT;
        c.fillStyle = Math.floor(toTime * 2) % 2 ? "#E8FFF4" : "rgba(232,255,244,0.4)";
        c.fillText("CLICK TO FLY AGAIN", toW / 2, toH * 0.9);
    }
    c.restore();
}

// ---- one frame ----
function toDraw() {
    const c = toCtx;
    c.setTransform(toDpr, 0, 0, toDpr, 0, 0);
    if (toCam.shake > 0) c.translate((Math.random() - 0.5) * toCam.shake, (Math.random() - 0.5) * toCam.shake);
    if (toPhase === "crawl") { toDrawCrawl(c); return; }
    toDrawSky(c);
    toDrawEarth(c);
    toDrawClouds(c);
    toDrawGateBehind(c);
    toDrawSiloBack(c);
    // Play column edges (dim) when the window is wider than the column.
    if (toCam.PW < toCam.VW / 2 - 20 && toPhase !== "orbit" && toPhase !== "dock") {
        c.strokeStyle = "rgba(46,58,52,0.9)"; c.lineWidth = 1; c.setLineDash([4, 8]);
        [-1, 1].forEach(function (sd) { const x = toSX(toCam.x + sd * toCam.PW); c.beginPath(); c.moveTo(x, 0); c.lineTo(x, toH); c.stroke(); });
        c.setLineDash([]);
    }
    toDrawMother(c);
    toDrawGround(c);
    toDrawGate(c);
    toDrawFoes(c);
    toDrawBolts(c);
    toDrawShip(c);
    toDrawFx(c);
    toDrawGateLight(c);
    if (toPhase === "title") { toDrawTitle(c); return; }
    toDrawHud(c);
    if (toPhase === "card") toDrawCard(c);
}

// ---- the loop ----
let toLast = 0, toAcc = 0, toPaused = false, toRaf = 0;
const TO_DT = 1 / 60;
function toFrame(ts) {
    toRaf = requestAnimationFrame(toFrame);
    if (!toLast) toLast = ts;
    let el = (ts - toLast) / 1000; toLast = ts;
    if (el > 0.25) el = 0.25;
    if (!toPaused && !window.TO_TEST) {
        toAcc += el;
        let n = 0;
        while (toAcc >= TO_DT && n < 6) { toUpdate(TO_DT); toAcc -= TO_DT; n++; }
        if (n >= 6) toAcc = 0;
    }
    toDraw();
}

// The hub's game contract (GAME_PROTOTYPE_INSTRUCTIONS.md §2). Not load-bearing yet.
window.GameInstance = {
    init: function () { return true; },
    start: function () { toBegin(); },
    pause: function () { toPaused = true; },
    resume: function () { toPaused = false; toLast = 0; },
    destroy: function () {
        cancelAnimationFrame(toRaf);
        toAbort.abort();
        toTimers.forEach(function (id) { clearTimeout(id); clearInterval(id); });
        toTimers.clear();
        toSayStop();
        if (toAudio.ctx) toAudio.ctx.close();
        if (window.HUBSCORE) HUBSCORE.destroy();
    },
    getState: function () { return { phase: toPhase, score: toScore, hull: toM.hull, seg: toSeg, win: toWin }; }
};
// Test hook (scripts/takeoff-playtest.js): step the sim by hand.
window.TO_API = { step: function (dt) { toUpdate(dt || TO_DT); }, draw: toDraw, begin: toBegin, newRun: toNewRun, devJump: toDevJump };

toRaf = requestAnimationFrame(toFrame);
