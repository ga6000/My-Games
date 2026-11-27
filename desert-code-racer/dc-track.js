// ===================================================
//   Desert Code Racer — the road and its set pieces
// ===================================================
// The whole run's road is built once, from the room seed, so every screen
// in a room rides the same curves, hills, valleys, tunnels and side roads
// past the same craters, barricades and mines with no messages at all
// (MULTIPLAYER: "the seed problem" in shared/mp-core.js). Each leg draws
// from its own streams, derived from MP.seed().
//
// A SEGMENT: { i, curve, y (road height, world units), scene[], zone, lit,
//              alt (a side road: { off, w } in road units, or null), dark }
//   zone: "" open desert · "valley" a dark canyon · "tunnel" · "lab"
//
// STATIC set pieces live here (craters, barricades, dust with mines, the
// side roads' traps and chips). The mothership's beams, the krill and the
// two skill attacks are spawned live by the host (dc-hazards.js,
// dc-attacks.js), because they hunt riders.
"use strict";

function dcMulberry(a) {
    return function () {
        a |= 0;
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

function dcSeed() {
    const forced = dcParam("seed");                 // tests: the same road every time (solo only)
    if (forced && !dcOnline()) return Number(forced) | 0;
    if (typeof MP !== "undefined" && MP.seed) return MP.seed() | 0;
    return 12345;
}

function dcEase(t) { return 0.5 - 0.5 * Math.cos(Math.PI * dcClamp(t, 0, 1)); }

// The finale: the last DC_FINALE_SEGS of leg 3 are the lit tunnel into the
// mountain; the lab is the DC_END_SEGS after the finish line.
const DC_FINALE_SEGS = 150;
const DC_LAB_DEPTH = 64;                // finish line to the lab's back wall

function dcBuildTrack() {
    const segs = [];
    const legStart = [];
    const cpSeg = [];
    const cpTun = [];                   // { a, b } the checkpoint tunnels of rounds 1 and 2
    const features = [];                // { kind, a, b, side } for the map and the tests
    let n = 0;
    function seg(curve) { segs.push({ i: n++, curve: curve, y: 0, scene: [], zone: "", lit: false, alt: null, dark: 0 }); }
    function add(count, curve) { for (let i = 0; i < count; i++) seg(curve); }
    // An eased bend: in, hold, out (the classic pseudo-3D road shape).
    function bend(len, curve) {
        const e = Math.floor(len * 0.25);
        for (let i = 0; i < e; i++) seg(curve * (i / e));
        for (let i = 0; i < len - 2 * e; i++) seg(curve);
        for (let i = 0; i < e; i++) seg(curve * (1 - i / e));
    }

    add(DC_START_SEGS, 0);
    for (let L = 0; L < 3; L++) {
        legStart.push(n);
        const rnd = dcMulberry(dcSeed() ^ Math.imul(L + 1, 0x9E3779B1));
        const end = n + DC_LEG_SEGS[L] - (L === 2 ? DC_FINALE_SEGS : DC_CP_TUNNEL);
        add(30, 0);                                   // a straight out of each base
        while (n < end - 60) {
            const left = end - 60 - n;
            const len = Math.min(left, 80 + Math.floor(rnd() * 160));
            if (rnd() < 0.35 || len < 60) add(len, 0);
            else bend(len, (rnd() < 0.5 ? -1 : 1) * (1.2 + rnd() * (2.2 + L * 0.7)));
        }
        add(end - n, 0);
        if (L === 2) {
            // The finale tunnel: one long gentle bend into the mountain.
            const a = n;
            bend(DC_FINALE_SEGS, (rnd() < 0.5 ? -1 : 1) * 1.1);
            for (let i = a; i < n; i++) { segs[i].zone = "tunnel"; segs[i].lit = true; }
            features.push({ kind: "tunnel", a: a, b: n, finale: true });
            cpSeg.push(n);                            // the finish line, into the lab
        } else {
            // The round ends in a mountain: a lit tunnel with the checkpoint
            // gate just inside; the next round starts where it comes out.
            const a = n;
            bend(DC_CP_TUNNEL, (rnd() < 0.5 ? -1 : 1) * 0.9);
            for (let i = a; i < n; i++) { segs[i].zone = "tunnel"; segs[i].lit = true; }
            features.push({ kind: "tunnel", a: a, b: n, cp: true });
            cpTun.push({ a: a, b: n });
            cpSeg.push(a + DC_CP_IN);
        }
    }
    const finish = cpSeg[2];
    add(DC_END_SEGS, 0);
    for (let i = finish; i < n; i++) segs[i].zone = "lab";

    // ---- zones: one valley, a tunnel, a side road or two per leg ----
    for (let L = 0; L < 3; L++) {
        const zr = dcMulberry(dcSeed() ^ Math.imul(L + 31, 0x27D4EB2F));
        const a0 = legStart[L] + 140, b0 = L === 2 ? cpSeg[L] - DC_FINALE_SEGS - 60 : cpTun[L].a - 60;
        const span = b0 - a0;
        const plan = [];
        // Valley (legs 1 and 3), tunnel (legs 2 and 3), side roads (all).
        if (L !== 1) plan.push({ kind: "valley", len: 240 + Math.floor(zr() * 120) });
        if (L !== 0) plan.push({ kind: "tunnel", len: 110 + Math.floor(zr() * 50) });
        plan.push({ kind: "fork", len: 150 + Math.floor(zr() * 60) });
        if (L === 2) plan.push({ kind: "fork", len: 130 + Math.floor(zr() * 50) });
        // Spread them evenly along the leg, in a shuffled order, with room between.
        for (let i = plan.length - 1; i > 0; i--) { const j = Math.floor(zr() * (i + 1)); const t = plan[i]; plan[i] = plan[j]; plan[j] = t; }
        const slot = span / plan.length;
        for (let k = 0; k < plan.length; k++) {
            const f = plan[k];
            const room = Math.max(0, slot - f.len - 40);
            const a = Math.floor(a0 + k * slot + 20 + zr() * room);
            const b = Math.min(b0, a + f.len);
            f.a = a; f.b = b; f.leg = L;
            if (f.kind === "valley") {
                for (let i = a; i < b; i++) {
                    segs[i].zone = "valley";
                    segs[i].dark = dcEase(Math.min(i - a, b - 1 - i) / 40);
                }
            } else if (f.kind === "tunnel") {
                for (let i = a; i < b; i++) segs[i].zone = "tunnel";
            } else {
                f.side = zr() < 0.5 ? -1 : 1;
                const e = 30;
                for (let i = a; i < b; i++) {
                    const t = Math.min(i - a, b - 1 - i) / e;
                    segs[i].alt = { off: f.side * (0.75 + 1.85 * dcEase(t)), w: 0.32 + 0.18 * dcEase(t), hold: t >= 1 };
                }
            }
            features.push(f);
        }
    }

    // ---- elevation: rolling hills, a drop into each valley, flat in tunnels and the lab ----
    const hr = dcMulberry(dcSeed() ^ 0x4111);
    let h = 0, i = 0;
    const base = new Array(segs.length).fill(0);
    // Ry 2026-11-24: the drops and rises are "among the best part", so the
    // rolling hills are steeper and closer together than pass 2's.
    while (i < segs.length) {
        const len = 70 + Math.floor(hr() * 120);
        const to = dcClamp(h + (hr() - 0.5) * 4600, -1900, 2800);
        for (let k = 0; k < len && i < segs.length; k++, i++) base[i] = dcLerp(h, to, dcEase(k / len));
        h = to;
    }
    for (let k = 0; k < DC_START_SEGS + 30; k++) base[k] = base[DC_START_SEGS + 30] * dcEase(k / (DC_START_SEGS + 30));
    // KICKERS: short sharp crests (a quick rise, a longer fall) that throw a
    // fast bike into the air (dc-rider.js dcCrestUpdate). Out in the open
    // only: not in valleys, tunnels, the lab run or the start.
    const kick = [];
    const lastK = segs.length - DC_FINALE_SEGS - DC_END_SEGS - 120;
    for (let k = DC_START_SEGS + 140; k < lastK; k += 150 + Math.floor(hr() * 170)) {
        const up = 14 + Math.floor(hr() * 8), down = 36 + Math.floor(hr() * 18);
        let ok = true;
        for (let j = k - 25; j < k + up + down + 25; j++) { const z = segs[j] && segs[j].zone; if (z === "valley" || z === "tunnel" || z === "lab") { ok = false; break; } }
        if (!ok) continue;
        const H = 800 + hr() * 700;
        for (let j = 0; j < up; j++) base[k + j] += H * dcEase(j / up);
        for (let j = 0; j < down; j++) base[k + up + j] += H * (1 - dcEase(j / down));
        kick.push(k + up);
    }
    for (let k = 0; k < segs.length; k++) {
        const sg = segs[k];
        sg.y = base[k] - 2600 * (sg.zone === "valley" ? Math.max(0.0001, sg.dark) : 0);
    }
    // Tunnels and the lab run level: hold the height they start at.
    for (let k = 1; k < segs.length; k++) {
        const z = segs[k].zone;
        if ((z === "tunnel" || z === "lab") && (segs[k - 1].zone === z || (z === "lab" && segs[k - 1].zone === "tunnel"))) segs[k].y = segs[k - 1].y;
    }
    // ...and ease back into the hills after a tunnel.
    for (let k = 1; k < segs.length; k++) {
        if (segs[k - 1].zone === "tunnel" && segs[k].zone !== "tunnel" && segs[k].zone !== "lab") {
            const y0 = segs[k - 1].y;
            for (let j = 0; j < 60 && k + j < segs.length; j++) segs[k + j].y = dcLerp(y0, segs[k + j].y, dcEase(j / 60));
        }
    }

    // ---- roadside scenery (seeded so every screen agrees on which cactus a rider hit) ----
    const sr = dcMulberry(dcSeed() ^ 0x51CE);
    for (let k = 8; k < segs.length; k += 3 + Math.floor(sr() * 5)) {
        const sg = segs[k];
        const side = sr() < 0.5 ? -1 : 1;
        const r1 = sr(), r2 = sr(), r3 = sr();
        if (sg.zone === "tunnel" || sg.zone === "lab") continue;
        if (sg.zone === "valley") { sg.scene.push({ kind: "rock", x: side * (1.32 + r1 * 0.1), h: 0.6 + r3 * 0.6 }); continue; }
        let x = side * (1.3 + r1 * 2.6);
        // Keep the side road and its median clear of cacti (rocks only there).
        let kind = r2 < 0.42 ? "cactus" : (r2 < 0.6 ? "rock" : "scrub");
        if (sg.alt) {
            const lo = Math.min(sg.alt.off, 0), hi = Math.max(sg.alt.off, 0);
            if (Math.sign(x) === Math.sign(sg.alt.off) || (x > lo - 1.2 && x < hi + 1.2)) {
                x = sg.alt.off + Math.sign(sg.alt.off) * (sg.alt.w + 0.5 + r1 * 1.4);
                if (kind === "cactus") kind = "scrub";
            }
        }
        sg.scene.push({ kind: kind, x: x, h: 0.7 + r3 * 0.6 });
    }
    // Heading: how far the road has turned by each segment (the projection
    // adds `curve` to the lateral step every segment, so the slope of the road
    // grows by curve / DC_SEG a segment). The far mountains are locked to it.
    let hd = 0;
    for (let k = 0; k < segs.length; k++) { segs[k].hd = hd; hd += segs[k].curve / DC_SEG; }
    return { segs: segs, legStart: legStart, cpSeg: cpSeg, cpTun: cpTun, finish: finish, features: features, kickers: kick, length: segs.length * DC_SEG };
}

// ---------------------------------------------------
//   ROAD QUERIES
// ---------------------------------------------------
function dcSegAt(z) {
    const t = dc.track;
    const i = Math.floor(z / DC_SEG);
    return t.segs[dcClamp(i, 0, t.segs.length - 1)];
}

// Road height at world z (interpolated between segment starts).
function dcRoadY(z) {
    const t = dc.track;
    const f = z / DC_SEG;
    const i = dcClamp(Math.floor(f), 0, t.segs.length - 2);
    return dcLerp(t.segs[i].y, t.segs[i + 1].y, dcClamp(f - i, 0, 1));
}

function dcZoneAt(z) { return dcSegAt(z).zone; }
function dcInTunnel(z) { const zn = dcSegAt(z).zone; return zn === "tunnel" || zn === "lab"; }

// On tarmac: the main road, or the side road where there is one.
function dcOnRoad(x, sg) {
    if (Math.abs(x) <= 1) return true;
    return !!(sg.alt && Math.abs(x - sg.alt.off) <= sg.alt.w);
}

// How far out a bike may go at this segment (walls in valleys and tunnels).
function dcLaneLimit(sg) {
    if (sg.zone === "tunnel" || sg.zone === "lab") return 1.12;
    if (sg.zone === "valley") return 1.38;
    if (sg.alt) return Math.max(1.9, Math.abs(sg.alt.off) + sg.alt.w + 0.3);
    return 1.9;
}

// ---------------------------------------------------
//   SET PIECES
// ---------------------------------------------------
// One piece per slot; DC_LEG_PIECES slots a leg. The bag keeps the three
// static types even, and from leg 2 a slot can be a combo of two. Every
// piece leaves a way through by steering or jumping (the universal answer).
// No set pieces in tunnels (the beams can't reach in there either: a breather).
function dcBuildHazards(track) {
    const list = [];
    const inTunnel = function (s0, s1) {
        for (let s = s0; s <= s1; s++) { const sg = track.segs[s]; if (sg && (sg.zone === "tunnel" || sg.zone === "lab")) return true; }
        return false;
    };
    for (let L = 0; L < 3; L++) {
        const rnd = dcMulberry(dcSeed() ^ Math.imul(L + 11, 0x85EBCA6B));
        const first = track.legStart[L] + 110;
        const last = L === 2 ? track.cpSeg[L] - DC_FINALE_SEGS - 70 : track.cpTun[L].a - 90;
        const count = DC_LEG_PIECES[L];
        const gap = (last - first) / count;
        let bag = [];
        let idx = 0;
        for (let p = 0; p < count; p++) {
            if (!bag.length) {
                bag = ["crater", "barricade", "dust"];
                if (L >= 1) bag.push("combo");
                if (L >= 2) bag.push("combo");
                for (let i = bag.length - 1; i > 0; i--) {
                    const j = Math.floor(rnd() * (i + 1));
                    const t = bag[i]; bag[i] = bag[j]; bag[j] = t;
                }
            }
            const kind = bag.pop();
            let seg = Math.floor(first + p * gap + rnd() * gap * 0.4);
            // Slide a piece that would sit in a tunnel to just past it.
            let guard = 0;
            while (inTunnel(seg - 8, seg + 60) && guard++ < 400) seg += 4;
            if (seg > last + 40) continue;
            const base = (L + 1) * 1000 + idx * 10;
            idx++;
            if (kind === "crater") dcPieceCraters(list, rnd, seg, base, L);
            else if (kind === "barricade") dcPieceBarricade(list, rnd, seg, base, L);
            else if (kind === "dust") dcPieceDust(list, rnd, seg, base, L);
            else {
                const pick = rnd();
                if (pick < 0.34) { dcPieceBarricade(list, rnd, seg, base, L); dcPieceCraters(list, rnd, seg + 34, base + 5, L); }
                else if (pick < 0.67) { dcPieceDust(list, rnd, seg, base, L); dcPieceBarricade(list, rnd, seg + 36, base + 5, L); }
                else { dcPieceCraters(list, rnd, seg, base, L); dcPieceDust(list, rnd, seg + 30, base + 5, L); }
            }
        }
    }
    // The side roads: traps to thread, a launch pad, chips to collect.
    let sid = 9000;
    track.features.forEach(function (f) {
        if (f.kind !== "fork") return;
        const rnd = dcMulberry(dcSeed() ^ (f.a * 2654435761));
        const a = f.a + 34, b = f.b - 34;
        const off = f.side * 2.6;
        const chips = [];
        for (let s = a + 6; s < b - 4; s += 9) chips.push({ seg: s, x: off + Math.sin(s * 0.21) * 0.18, st: "" });
        list.push({ id: sid++, type: "chips", seg: a, len: b - a, chips: chips, st: "", fork: f.a });
        const mid = Math.floor((a + b) / 2);
        list.push({ id: sid++, type: "pad", seg: mid, len: 3, x: off, st: "" });
        for (let k = 0; k < 2; k++) {
            const s = a + 14 + Math.floor((mid - a - 24) * (k / 2)) + Math.floor(rnd() * 6);
            const x = off + (k % 2 ? 0.17 : -0.17);
            list.push({ id: sid++, type: "barricade", kind: "traps", seg: s, len: 1, walls: [], traps: [{ seg: s, x: x, r: 0.09 }], st: "", gapX: off, fork: f.a });
        }
        list.push({ id: sid++, type: "barricade", kind: "traps", seg: mid + 18, len: 1, walls: [], traps: [{ seg: mid + 18, x: off, r: 0.1 }], st: "", gapX: off, fork: f.a });
    });
    list.sort(function (a, b) { return a.seg - b.seg; });
    return list;
}

function dcPieceCraters(list, rnd, seg, base, L) {
    const n = L === 0 ? 1 + Math.floor(rnd() * 2) : 2 + Math.floor(rnd() * 2);
    let lastX = 0;
    for (let i = 0; i < n; i++) {
        let x = -0.62 + rnd() * 1.24;
        if (i > 0 && Math.abs(x - lastX) < 0.5) x = lastX > 0 ? lastX - 0.7 : lastX + 0.7;
        x = dcClamp(x, -0.68, 0.68);
        lastX = x;
        list.push({ id: base + i, type: "crater", seg: seg + i * 9, len: 3, x: x, r: 0.24 + rnd() * 0.1, st: "", seed: rnd() * 1000 });
    }
}

// BARRICADES come in kinds (Ry, pass 2: "more variation in the barriers").
// A barricade is walls (each a row across the road at one segment, with open
// gaps; a wall can slide, or be low enough to jump) and traps (tank traps you
// steer between or jump). Every kind counts as "barricade" in the matrix.
//   wall      one gap                  twin      two narrow gaps, pick one
//   gate      one gap that slides      chicane   two walls, gaps on opposite sides
//   traps     a field of tank traps    pipe      a low pipe across the road: jump it
function dcPieceBarricade(list, rnd, seg, base, L) {
    const kinds = L === 0 ? ["wall", "twin", "traps"] : (L === 1 ? ["wall", "gate", "chicane", "traps", "twin"] : ["gate", "chicane", "pipe", "traps", "twin", "wall"]);
    const kind = kinds[Math.floor(rnd() * kinds.length)];
    const cas = DC_DIFF === "casual" ? 0.11 : 0;
    const h = { id: base, type: "barricade", kind: kind, seg: seg, len: 2, walls: [], traps: [], st: "", gapX: 0 };
    if (kind === "wall") {
        const x = -0.62 + rnd() * 1.24;
        h.walls.push({ seg: seg, gaps: [{ x: x, w: 0.44 + cas }] });
    } else if (kind === "twin") {
        const x1 = -0.55 + rnd() * 0.35, x2 = 0.2 + rnd() * 0.35;
        h.walls.push({ seg: seg, gaps: [{ x: x1, w: 0.36 + cas }, { x: x2, w: 0.36 + cas }] });
    } else if (kind === "gate") {
        h.walls.push({ seg: seg, gaps: [{ x: 0, w: 0.5 + cas }], mv: { amp: 0.45, rate: 1.0 + rnd() * 0.5, ph: rnd() * 6.28 } });
    } else if (kind === "chicane") {
        const side = rnd() < 0.5 ? -1 : 1;
        h.walls.push({ seg: seg, gaps: [{ x: side * 0.5, w: 0.5 + cas }] });
        h.walls.push({ seg: seg + 16, gaps: [{ x: -side * 0.5, w: 0.5 + cas }] });
        h.len = 17;
    } else if (kind === "pipe") {
        h.walls.push({ seg: seg, gaps: [], low: true });
    } else {
        // Two staggered rows of traps; each row leaves at least one wide hole.
        for (let row = 0; row < 2; row++) {
            const hole = -0.6 + rnd() * 1.2;
            for (let x = -0.85; x <= 0.86; x += 0.34) {
                const xx = x + (rnd() - 0.5) * 0.08 + (row ? 0.17 : 0);
                if (Math.abs(xx - hole) < 0.3 + cas || xx > 0.95) continue;
                h.traps.push({ seg: seg + row * 10, x: xx, r: 0.085 });
            }
        }
        h.len = 11;
    }
    h.gapX = h.walls.length && h.walls[0].gaps.length ? h.walls[0].gaps[0].x : 0;
    list.push(h);
}

function dcPieceDust(list, rnd, seg, base, L) {
    const w = 0.5 + rnd() * 0.4;
    const x = -0.9 + w / 2 + rnd() * (1.8 - w);
    const len = 12 + Math.floor(rnd() * 8);
    const mines = [];
    const n = 2 + (L >= 1 ? 1 : 0) + Math.floor(rnd() * 2);
    for (let m = 0; m < n; m++) {
        mines.push({ x: x - w / 2 + 0.06 + rnd() * (w - 0.12), seg: seg + 1 + Math.floor(rnd() * (len - 2)), st: "" });
    }
    list.push({ id: base, type: "dust", seg: seg, len: len, x: x, w: w, mines: mines, st: "", reveal: 0 });
}

// A wall's gaps right now (a gate slides; an opened wall's gaps go wide).
function dcWallGaps(h, wl, out) {
    out.length = 0;
    const open = h.st === "open";
    for (let i = 0; i < wl.gaps.length; i++) {
        const g = wl.gaps[i];
        let x = g.x;
        if (wl.mv && !open) x += wl.mv.amp * Math.sin(dc.simT * wl.mv.rate + wl.mv.ph);
        out.push({ x: x, w: open ? Math.max(g.w, 1.15) : g.w });
    }
    return out;
}

// Does a bike at x hit this barricade at segment s (in the air or not)?
const dcGapTmp = [];
function dcBarrierHits(h, s0, s1, x, air, half) {
    if (h.st === "gone" || h.st === "ramp") return null;
    for (let i = 0; i < h.walls.length; i++) {
        const wl = h.walls[i];
        if (wl.seg < s0 || wl.seg > s1) continue;
        if (wl.low) { if (air || h.st === "open") continue; return wl; }
        if (h.st === "open" && !wl.gaps.length) continue;
        const gaps = dcWallGaps(h, wl, dcGapTmp);
        let through = false;
        for (let g = 0; g < gaps.length; g++) if (Math.abs(x - gaps[g].x) <= gaps[g].w / 2 - half) through = true;
        if (!through) return wl;
    }
    if (h.st !== "open") {
        for (let i = 0; i < h.traps.length; i++) {
            const t = h.traps[i];
            if (t.seg < s0 || t.seg > s1 || air) continue;
            if (Math.abs(x - t.x) < t.r + half) return t;
        }
    }
    return null;
}

function dcHazardById(id) {
    for (let i = 0; i < dc.hazards.length; i++) if (dc.hazards[i].id === id) return dc.hazards[i];
    return null;
}

// Hazards whose span touches [s0, s1] (segment indices).
function dcHazardsIn(s0, s1, out) {
    out = out || [];
    const h = dc.hazards;
    let lo = 0, hi = h.length;
    while (lo < hi) { const mid = (lo + hi) >> 1; if (h[mid].seg + 220 < s0) lo = mid + 1; else hi = mid; }
    for (let i = lo; i < h.length && h[i].seg <= s1; i++) {
        if (h[i].seg + h[i].len >= s0) out.push(h[i]);
    }
    return out;
}

// Which leg a world z is on (0..2), and 3 past the finish.
function dcLegAt(z) {
    const s = z / DC_SEG;
    const cp = dc.track.cpSeg;
    if (s < cp[0]) return 0;
    if (s < cp[1]) return 1;
    if (s < cp[2]) return 2;
    return 3;
}

// 0..1 along the route (the sidebar map), from the dome to the mountain base.
function dcProgress(z) {
    const t = dc.track;
    return dcClamp((z / DC_SEG - DC_START_SEGS) / (t.finish - DC_START_SEGS), 0, 1);
}
