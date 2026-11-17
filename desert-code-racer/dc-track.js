// ===================================================
//   Desert Code Racer — the road and its set pieces
// ===================================================
// The whole run's road is built once, from the room seed, so every screen
// in a room rides the same curves past the same craters, barricades and
// mines with no messages at all (MULTIPLAYER: "the seed problem" in
// shared/mp-core.js). Each leg draws from its own stream, derived from
// MP.seed(), so changing one leg's content never reshuffles another's.
//
// STATIC set pieces live here (craters, barricades, dust with mines). The
// mothership's beams and the krill swarms are spawned live by the host
// (dc-hazards.js), because they hunt riders.
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
    if (typeof MP !== "undefined" && MP.seed) return MP.seed() | 0;
    return 12345;
}

function dcBuildTrack() {
    const segs = [];
    const legStart = [];
    const cpSeg = [];
    let n = 0;
    function add(count, curve) {
        for (let i = 0; i < count; i++) segs.push({ i: n++, curve: curve, scene: [] });
    }
    // An eased bend: in, hold, out (the classic pseudo-3D road shape).
    function bend(rnd, len, curve) {
        const e = Math.floor(len * 0.25);
        for (let i = 0; i < e; i++) segs.push({ i: n++, curve: curve * (i / e), scene: [] });
        for (let i = 0; i < len - 2 * e; i++) segs.push({ i: n++, curve: curve, scene: [] });
        for (let i = 0; i < e; i++) segs.push({ i: n++, curve: curve * (1 - i / e), scene: [] });
    }

    add(DC_START_SEGS, 0);
    for (let L = 0; L < 3; L++) {
        legStart.push(n);
        const rnd = dcMulberry(dcSeed() ^ Math.imul(L + 1, 0x9E3779B1));
        const end = n + DC_LEG_SEGS[L];
        add(30, 0);                                   // a straight out of each base
        while (n < end - 60) {
            const left = end - 60 - n;
            const len = Math.min(left, 80 + Math.floor(rnd() * 160));
            if (rnd() < 0.35 || len < 60) add(len, 0);
            else bend(rnd, len, (rnd() < 0.5 ? -1 : 1) * (1.2 + rnd() * (2.2 + L * 0.7)));
        }
        add(end - n, 0);
        cpSeg.push(n);                                // checkpoint at the end of the leg
    }
    add(DC_END_SEGS, 0);

    // Roadside scenery: cacti and scrub (cosmetic seed, but seeded anyway so
    // every screen agrees on which cactus a rider hit).
    const sr = dcMulberry(dcSeed() ^ 0x51CE);
    for (let i = 8; i < segs.length; i += 3 + Math.floor(sr() * 5)) {
        const side = sr() < 0.5 ? -1 : 1;
        const kind = sr() < 0.42 ? "cactus" : (sr() < 0.6 ? "rock" : "scrub");
        segs[i].scene.push({ kind: kind, x: side * (1.3 + sr() * 2.6), h: 0.7 + sr() * 0.6 });
    }
    return { segs: segs, legStart: legStart, cpSeg: cpSeg, finish: cpSeg[2], length: segs.length * DC_SEG };
}

// ---------------------------------------------------
//   SET PIECES
// ---------------------------------------------------
// One piece per slot; DC_LEG_PIECES slots a leg. The bag keeps the three
// static types even, and from leg 2 a slot can be a combo of two. Every
// piece leaves a way through by steering alone (the universal answer):
// a barricade's gap is always on the tarmac, craters never close the road,
// and a dust patch never spans more than about half of it.
function dcBuildHazards(track) {
    const list = [];
    for (let L = 0; L < 3; L++) {
        const rnd = dcMulberry(dcSeed() ^ Math.imul(L + 11, 0x85EBCA6B));
        const first = track.legStart[L] + 110;
        const last = track.cpSeg[L] - 90;
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
            const seg = Math.floor(first + p * gap + rnd() * gap * 0.4);
            const base = (L + 1) * 1000 + idx * 10;
            idx++;
            if (kind === "crater") dcPieceCraters(list, rnd, seg, base, L);
            else if (kind === "barricade") dcPieceBarricade(list, rnd, seg, base, L);
            else if (kind === "dust") dcPieceDust(list, rnd, seg, base, L);
            else {
                const pick = rnd();
                if (pick < 0.34) { dcPieceBarricade(list, rnd, seg, base, L); dcPieceCraters(list, rnd, seg + 30, base + 5, L); }
                else if (pick < 0.67) { dcPieceDust(list, rnd, seg, base, L); dcPieceBarricade(list, rnd, seg + 34, base + 5, L); }
                else { dcPieceCraters(list, rnd, seg, base, L); dcPieceDust(list, rnd, seg + 30, base + 5, L); }
            }
        }
    }
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
        list.push({ id: base + i, type: "crater", seg: seg + i * 9, len: 3, x: x, r: 0.24 + rnd() * 0.1, st: "" });
    }
}

function dcPieceBarricade(list, rnd, seg, base) {
    const gapW = DC_DIFF === "casual" ? 0.55 : 0.44;
    const gapX = -0.62 + rnd() * 1.24;
    list.push({ id: base, type: "barricade", seg: seg, len: 2, gapX: gapX, gapW: gapW, st: "" });
}

function dcPieceDust(list, rnd, seg, base, L) {
    const w = 0.5 + rnd() * 0.45;
    let x = -0.9 + w / 2 + rnd() * (1.8 - w);
    const len = 12 + Math.floor(rnd() * 8);
    const mines = [];
    const n = 2 + (L >= 1 ? 1 : 0) + Math.floor(rnd() * 2);
    for (let m = 0; m < n; m++) {
        mines.push({ x: x - w / 2 + 0.06 + rnd() * (w - 0.12), seg: seg + 1 + Math.floor(rnd() * (len - 2)), st: "" });
    }
    list.push({ id: base, type: "dust", seg: seg, len: len, x: x, w: w, mines: mines, st: "", reveal: 0 });
}

function dcSegAt(z) {
    const t = dc.track;
    const i = Math.floor(z / DC_SEG);
    return t.segs[dcClamp(i, 0, t.segs.length - 1)];
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
    while (lo < hi) { const mid = (lo + hi) >> 1; if (h[mid].seg + 30 < s0) lo = mid + 1; else hi = mid; }
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
