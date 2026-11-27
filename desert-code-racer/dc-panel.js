// ===================================================
//   Desert Code Racer — the cabinet panel (AESTHETIC_GUIDE §4.11a)
// ===================================================
// Right-hand panel, Bosconian-style, top to bottom:
//   HI-SCORE / TEAM / 1UP     the team's score (the score), and my share
//   THE ROUTE (the radar)     dome base at the bottom, the dotted route
//                             winding up through the ranges past the two
//                             checkpoints to the mountain base; every rider
//                             in their colour, the case in amber
//   CONDITION + lives         GREEN / YELLOW / RED from the case's state
//   CASE                      the integrity pips (the fail rule)
//   NEXT                      the next checkpoint
//   CREW                      each rider: crew figure (shared/crew.js),
//                             ability, points
// It is cabinet furniture: labels red, values white, CONDITION in its own
// colour. Nothing here is also drawn on the play field.
"use strict";

let dcPanelShown = "";
let dcRouteCv = null, dcRouteCtx = null;
const dcRoutePath = [];

function dcPanelInit() {
    dcRouteCv = document.getElementById("dcRoute");
    dcRouteCtx = dcRouteCv.getContext("2d");
    dcPanelMuteInit();
    // The route: a fixed winding line, sampled once (0 = dome, 1 = mountain base).
    for (let i = 0; i <= 120; i++) {
        const p = i / 120;
        dcRoutePath.push({ p: p, x: 0.5 + Math.sin(p * Math.PI * 3.2 + 0.4) * 0.22 * (1 - p * 0.35) + Math.sin(p * 17) * 0.025 });
    }
}

function dcRoutePoint(p, w, h) {
    const i = dcClamp(Math.floor(p * 120), 0, 119), t = p * 120 - i;
    const a = dcRoutePath[i], b = dcRoutePath[i + 1];
    const top = h * 0.1, bot = h * 0.9;
    return { x: dcLerp(a.x, b.x, t) * w, y: dcLerp(bot, top, p) };
}

function dcPanelUpdate() {
    if (!dcRouteCv || !dc.track) return;
    const me = dc.me;
    const team = dcTeamScore();
    const hi = typeof HUBSCORE !== "undefined" ? HUBSCORE.best(DC_GAME + "-team", dc.demo ? 0 : team) : team;
    const pad = function (n) { return typeof HUBSCORE !== "undefined" ? HUBSCORE.pad6(n) : String(n); };
    const c = dc.caseS;
    const pips = c ? c.pips : DC_TUNE.pips;
    let cond = "GREEN";
    if (c && (!c.holder || pips <= 1)) cond = "RED";
    else if (pips <= 2 || (me && me.krill > 0) || dc.beams.some(function (b) { return b.phase === "lock" && me && b.tg === me.id; })) cond = "YELLOW";
    const nextLeg = Math.min(3, dc.leg + 1);
    const riders = Object.keys(dc.riders).map(function (k) { return dc.riders[k]; });
    riders.sort(function (a, b) { return (a.local ? -1 : 0) - (b.local ? -1 : 0) || a.name.localeCompare(b.name); });

    const sig = [team, hi, me ? me.pts : 0, cond, pips, c && c.holder, nextLeg, dc.mode,
        riders.map(function (r) { return r.id + r.role + (r.down > 0 ? 1 : 0) + r.pts + r.color; }).join(",")].join("|");
    if (sig !== dcPanelShown) {
        dcPanelShown = sig;
        dcSet("dcHi", pad(hi));
        dcSet("dcTeam", pad(team));
        dcSet("dc1up", pad(me ? me.pts : 0));
        const ce = document.getElementById("dcCond");
        ce.textContent = cond;
        ce.className = "cond-" + cond.toLowerCase();
        document.getElementById("dcLives").innerHTML = riders.map(function (r) {
            return "<span class='life" + (r.down > 0 ? " down" : "") + "' style='--pc:" + dcEsc(r.color) + "'></span>";
        }).join("");
        let ph = "";
        for (let i = 0; i < DC_TUNE.pips; i++) ph += "<span class='pip" + (i < pips ? " on" : "") + "'></span>";
        document.getElementById("dcPips").innerHTML = ph;
        const holder = c && c.holder ? dc.riders[c.holder] : null;
        dcSet("dcHolder", c && c.over ? "" : holder ? (holder.local ? "YOU" : (DC_ABILITY[holder.role] || {}).crew || holder.name) : "ON THE ROAD");
        document.getElementById("dcHolder").style.color = holder ? holder.color : "#FF2E88";
        dcSet("dcNext", nextLeg >= 3 ? "MOUNTAIN BASE" : DC_LEG_NAMES[nextLeg]);
        dcSet("dcLeg", "ROUND " + Math.min(3, dc.leg + 1) + "/3");
        dcPanelCrew(riders);
    }
    dcPanelMute();
    dcDrawRoute();
}

// THE MUTE BUTTON. Same toggle as M (the hub-wide SFX mute, stored per game).
// tabindex -1 and pointerdown preventDefault keep it from taking focus, or
// Space (jump) would press it again.
let dcMuteShown = null;
function dcPanelMuteInit() {
    const b = document.getElementById("dcMute");
    if (!b) return;
    dcOn(b, "pointerdown", function (e) { e.preventDefault(); });
    dcOn(b, "click", function () { dcAudioInit(); dcToggleMute(); dcPanelMute(); });
}
function dcPanelMute() {
    const m = dcMuted();
    if (m === dcMuteShown) return;
    dcMuteShown = m;
    const b = document.getElementById("dcMute");
    if (!b) return;
    b.textContent = m ? "OFF" : "ON";
    b.className = m ? "off" : "";
    b.setAttribute("aria-pressed", m ? "true" : "false");
    b.title = m ? "Sound off (M)" : "Sound on (M)";
}

function dcPanelCrew(riders) {
    const box = document.getElementById("dcCrew");
    box.innerHTML = riders.map(function (r) {
        const a = DC_ABILITY[r.role] || { name: "", crew: r.name };
        return "<div class='crew-row" + (r.down > 0 ? " down" : "") + "'><canvas width='16' height='20' data-role='" + dcEsc(r.role) + "'></canvas>" +
            "<div class='crew-txt'><b style='color:" + dcEsc(r.color) + "'>" + dcEsc(a.crew) + (r.local ? " · YOU" : "") + "</b>" +
            "<span>" + dcEsc(a.name) + "</span></div><i>" + (typeof HUBSCORE !== "undefined" ? HUBSCORE.format(r.pts) : r.pts) + "</i></div>";
    }).join("");
    const cvs = box.querySelectorAll("canvas");
    for (let i = 0; i < cvs.length; i++) {
        const g = cvs[i].getContext("2d");
        if (typeof CREW !== "undefined") CREW.draw(g, cvs[i].getAttribute("data-role"), 0, 0, 1, { frame: 0 });
    }
}

function dcDrawRoute() {
    const cv = dcRouteCv, ctx = dcRouteCtx;
    const w = cv.clientWidth, h = cv.clientHeight;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    if (cv.width !== Math.floor(w * dpr) || cv.height !== Math.floor(h * dpr)) { cv.width = Math.floor(w * dpr); cv.height = Math.floor(h * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = "#000"; ctx.fillRect(0, 0, w, h);
    // Mountain ranges either side of the route, thicker toward the top.
    ctx.beginPath();
    const rnd = dcMulberry(77);
    for (let i = 0; i < 26; i++) {
        const p = 0.12 + rnd() * 0.85;
        const rp = dcRoutePoint(p, w, h);
        const side = rnd() < 0.5 ? -1 : 1;
        const mx = dcClamp(rp.x + side * (w * 0.14 + rnd() * w * 0.22), 8, w - 8);
        const s = 5 + rnd() * 7 * (0.6 + p);
        ctx.moveTo(mx - s, rp.y + s * 0.6); ctx.lineTo(mx, rp.y - s * 0.6); ctx.lineTo(mx + s, rp.y + s * 0.6);
    }
    ctx.strokeStyle = DC_COL.hue; ctx.lineWidth = 1.2; ctx.stroke();
    // The route, dotted.
    ctx.fillStyle = DC_COL.mid;
    for (let i = 0; i <= 60; i++) {
        const q = dcRoutePoint(i / 60, w, h);
        ctx.fillRect(q.x - 1, q.y - 1, 2, 2);
    }
    // Dome base (bottom) and mountain base (top).
    const d = dcRoutePoint(0, w, h);
    ctx.beginPath(); ctx.arc(d.x, d.y + 4, 9, Math.PI, 0);
    ctx.moveTo(d.x - 9, d.y + 4); ctx.lineTo(d.x + 9, d.y + 4);
    ctx.moveTo(d.x, d.y - 5); ctx.lineTo(d.x - 6, d.y + 4); ctx.moveTo(d.x, d.y - 5); ctx.lineTo(d.x + 6, d.y + 4);
    ctx.strokeStyle = DC_COL.cyan; ctx.lineWidth = 1.2; ctx.stroke();
    const mb = dcRoutePoint(1, w, h);
    ctx.beginPath(); ctx.moveTo(mb.x - 14, mb.y + 6); ctx.lineTo(mb.x - 4, mb.y - 8); ctx.lineTo(mb.x + 3, mb.y - 2); ctx.lineTo(mb.x + 8, mb.y - 10); ctx.lineTo(mb.x + 16, mb.y + 6);
    ctx.strokeStyle = DC_COL.hue; ctx.stroke();
    ctx.strokeStyle = DC_COL.cyan; ctx.strokeRect(mb.x - 4, mb.y - 1, 8, 7);
    // Checkpoints.
    const t = dc.track;
    for (let L = 0; L < 2; L++) {
        const q = dcRoutePoint(dcProgress(t.cpSeg[L] * DC_SEG), w, h);
        ctx.strokeStyle = dc.leg > L ? DC_COL.cyan : DC_COL.mid;
        ctx.strokeRect(q.x - 4, q.y - 4, 8, 8);
    }
    // Names on the map (Ry 2026-11-24): each stop labelled on the open side
    // of the route, on a black plate so the ranges behind don't eat it.
    // Passed stops go cyan, the next one amber, the rest dim.
    const stops = [
        { p: 0, name: "DOME BASE", leg: -1 },
        { p: dcProgress(t.cpSeg[0] * DC_SEG), name: "ALPHA", leg: 0 },
        { p: dcProgress(t.cpSeg[1] * DC_SEG), name: "BRAVO", leg: 1 },
        { p: 1, name: "MOUNTAIN BASE", leg: 2 }
    ];
    ctx.font = "8px 'Press Start 2P', monospace";
    ctx.textBaseline = "middle";
    for (const st of stops) {
        const q = dcRoutePoint(st.p, w, h);
        const tw = ctx.measureText(st.name).width;
        const right = q.x < w / 2;
        let tx = right ? q.x + 12 : q.x - 12 - tw;
        tx = dcClamp(tx, 3, w - tw - 3);
        let ty = q.y;
        if (st.leg === -1) ty = Math.min(h - 7, q.y + 2);
        if (st.leg === 2) ty = Math.max(7, q.y + 16);
        ctx.fillStyle = "#000";
        ctx.fillRect(Math.round(tx) - 2, Math.round(ty) - 6, Math.ceil(tw) + 4, 12);
        ctx.fillStyle = st.leg < dc.leg ? DC_COL.cyan : (st.leg === dc.leg ? DC_COL.amber : DC_COL.mid);
        ctx.fillText(st.name, Math.round(tx), Math.round(ty) + 1);
    }
    // Riders, then the case on top.
    for (const id in dc.riders) {
        const r = dc.riders[id];
        const q = dcRoutePoint(dcProgress(r.z), w, h);
        ctx.fillStyle = r.down > 0 ? DC_COL.dim : r.color;
        const s = r.local ? 4 : 3;
        ctx.fillRect(q.x - s, q.y - s, s * 2, s * 2);
        if (r.local) { ctx.strokeStyle = DC_COL.hot; ctx.strokeRect(q.x - s - 2, q.y - s - 2, s * 2 + 4, s * 2 + 4); }
    }
    const cz = dcCaseZ();
    if (cz !== null && dc.caseS && !dc.caseS.over) {
        const q = dcRoutePoint(dcProgress(cz), w, h);
        const blink = DC_REDUCED || dc.caseS.holder || Math.floor(dc.simT * 4) % 2 === 0;
        if (blink) { ctx.strokeStyle = DC_COL.amber; ctx.lineWidth = 1.6; ctx.strokeRect(q.x + 6, q.y - 4, 9, 7); ctx.beginPath(); ctx.moveTo(q.x + 9, q.y - 4); ctx.lineTo(q.x + 9, q.y - 6); ctx.lineTo(q.x + 12, q.y - 6); ctx.lineTo(q.x + 12, q.y - 4); ctx.stroke(); }
    }
}

function dcSet(id, txt) {
    const el = document.getElementById(id);
    if (el && el.textContent !== txt) el.textContent = txt;
}

function dcEsc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
        return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
}

// The TEAM score: checkpoints + everyone's points (+ the clear bonus at the end).
function dcTeamScore() {
    if (dc.result) return dc.result.team;
    let t = dc.team;
    for (const id in dc.riders) t += dc.riders[id].pts || 0;
    return t;
}
