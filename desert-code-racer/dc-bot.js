// ===================================================
//   Desert Code Racer — the autopilot (attract run, and the tests)
// ===================================================
// The cabinet plays itself behind the ready check (AESTHETIC_GUIDE §4.8),
// and the headless tests ride whole runs with it (?bot=1) to prove every
// class can finish alone. It reads the same road the player sees, scores a
// row of candidate lines across it, steers for the safest, jumps what it
// cannot steer round, and casts its ability when a hazard its class covers
// is coming up.
"use strict";

const dcBotOut = { steer: 0, boost: false, brake: false, jump: false, ability: false };
const dcBotList = [];

function dcBotThink(r) {
    const o = dcBotOut;
    o.steer = 0; o.boost = false; o.brake = false; o.jump = false; o.ability = false;
    if (!r || r.down > 0 || !dc.track) return o;
    const s0 = Math.floor(r.z / DC_SEG);
    const look = Math.max(25, Math.round((r.v * 1.5) / DC_SEG));
    dcBotList.length = 0;
    dcHazardsIn(s0, s0 + look, dcBotList);

    const myBeams = [];
    for (let i = 0; i < dc.beams.length; i++) {
        const b = dc.beams[i];
        if (b.phase === "lock" && !b.safe && !b.soak) myBeams.push(b);
    }
    const c = dc.caseS;
    const caseAhead = c && !c.holder && !c.over && c.z > r.z - DC_SEG && c.z < r.z + look * DC_SEG;

    // Patched (MEND) or ramming, the static road can't hurt: ride the line.
    const armoured = dcPatched(r) || dcRamming(r.id) || !!dcShieldOf(r.id);
    let best = r.x, bestCost = 1e9;
    for (let cx = -0.95; cx <= 0.951; cx += 0.05) {
        let cost = Math.abs(cx - r.x) * 0.5 + Math.abs(cx) * 0.15;
        for (let i = 0; i < dcBotList.length; i++) {
            const h = dcBotList[i];
            const d = Math.max(0, h.seg - s0);
            if (armoured && d < 40 && !(h.type === "crater" && !dcPatched(r) && !dcRamming(r.id))) continue;
            const w = 12 / (1 + d / 18);
            if (h.type === "crater") {
                if (h.st !== "ramp" && Math.abs(cx - h.x) < h.r + 0.13) cost += w;
            } else if (h.type === "barricade") {
                if (h.st === "gone" || h.st === "ramp" || h.seg + h.len < s0) continue;
                for (let k = 0; k < h.walls.length; k++) {
                    const wl = h.walls[k];
                    if (wl.seg < s0 || wl.low) continue;
                    const dw = Math.max(0, wl.seg - s0);
                    const ww = 12 / (1 + dw / 18);
                    if (dcBarrierHits(h, wl.seg, wl.seg, cx, false, 0.1) === wl) cost += ww * 4;
                }
                for (let k = 0; k < h.traps.length; k++) {
                    const tp = h.traps[k];
                    if (tp.seg < s0 || h.st === "open") continue;
                    if (Math.abs(cx - tp.x) < tp.r + 0.12) cost += 12 / (1 + Math.max(0, tp.seg - s0) / 18) * 2;
                }
            } else if (h.type === "dust") {
                const revealed = h.reveal && dc.simT - h.reveal < 6;
                let live = 0;
                for (let m = 0; m < h.mines.length; m++) {
                    const mn = h.mines[m];
                    if (mn.st === "pop" || mn.seg < s0) continue;
                    live++;
                    if (revealed && Math.abs(cx - mn.x) < 0.16) cost += w;
                }
                if (live && !revealed && Math.abs(cx - h.x) < h.w / 2 + 0.07) cost += w * 0.8;
            }
        }
        for (let i = 0; i < myBeams.length; i++) {
            const b = myBeams[i];
            const dz = (b.z - r.z) / DC_SEG;
            if (dz > -2 && dz < look && Math.abs(cx - b.x) < DC_RING + 0.14) cost += 30;
        }
        if (caseAhead) cost -= Math.abs(cx - c.x) < 0.14 ? 14 : (Math.abs(cx - c.x) < 0.3 ? 6 : 0);
        // A strafe walking down a lane: get out of it.
        for (let i = 0; i < dc.attacks.length; i++) {
            const a = dc.attacks[i];
            if (a.kind === "strafe" && a.st === "live" && Math.abs(cx - a.x) < 0.34) cost += 25;
        }
        if (cost < bestCost - 0.001) { bestCost = cost; best = cx; }
    }
    // Steer for the line, leaning into the bend so it doesn't drift out.
    const dx = best - r.x;
    const sp = r.v / DC_CRUISE;
    const push = sp * sp * dcSegAt(r.z).curve * 0.28 / dcSteerRate(r);
    o.steer = dcClamp(dx * 10 + push, -1, 1);
    if (Math.abs(o.steer) < 0.05) o.steer = 0;

    // Jump what cannot be steered round in time: the next ~0.35 s of road.
    const near = Math.round((r.v * 0.32) / DC_SEG) + 2;
    let threat = false, bar = false;
    for (let i = 0; i < dcBotList.length; i++) {
        const h = dcBotList[i];
        if (h.seg > s0 + near + 3) continue;
        if (h.type === "crater" && h.st !== "ramp" && Math.abs(r.x - h.x) < h.r + 0.08 && h.seg + h.len >= s0) threat = true;
        if (h.type === "dust" && h.seg + h.len >= s0) {
            for (let m = 0; m < h.mines.length; m++) {
                const mn = h.mines[m];
                if (mn.st !== "pop" && mn.seg >= s0 && mn.seg <= s0 + near + 2 && Math.abs(r.x - mn.x) < 0.14) threat = true;
            }
        }
        if (h.type === "barricade" && h.st !== "gone" && h.st !== "ramp") {
            for (let k = 0; k < h.walls.length; k++) {
                const wl = h.walls[k];
                if (wl.seg < s0 || wl.seg > s0 + near * 2) continue;
                if (wl.low) { if (h.st !== "open" && wl.seg <= s0 + near + 1) threat = true; continue; }
                if (dcBarrierHits(h, wl.seg, wl.seg, r.x, false, 0.06) === wl) bar = true;
            }
            for (let k = 0; k < h.traps.length; k++) {
                const tp = h.traps[k];
                if (h.st !== "open" && tp.seg >= s0 && tp.seg <= s0 + near + 1 && Math.abs(r.x - tp.x) < tp.r + 0.08) threat = true;
            }
        }
    }
    if ((threat && r.air <= 0) || (r.krill > 0 && r.air <= 0)) o.jump = r.jcd <= 0;
    // A barricade we are not lined up for: brake to buy time to steer.
    if (bar) o.brake = true;
    // A locked ring under us: brake out of it if steering won't do.
    for (let i = 0; i < myBeams.length; i++) {
        const b = myBeams[i];
        const dz = (b.z - r.z) / DC_SEG;
        if (dz > 0 && dz < 40 && Math.abs(r.x - b.x) < DC_RING + 0.05 && Math.abs(best - b.x) < DC_RING + 0.1) o.brake = true;
    }
    if (!o.brake && bestCost < 1 && Math.abs(dcSegAt(r.z).curve) < 1.5) o.boost = true;
    // The lash: jump it as it comes down on us.
    for (let i = 0; i < dc.attacks.length; i++) {
        const a = dc.attacks[i];
        if (a.kind !== "lash" || a.st !== "live") continue;
        const tS = a.t0 + DC_LASH_WARN;
        const eta = (a.z - r.z) / Math.max(1, r.v);
        const arrive = dc.simT + eta;
        if (eta > 0 && eta < 0.25 && arrive > tS - 0.1 && arrive < tS + DC_LASH_DOWN + 0.1 && r.air <= 0) o.jump = r.jcd <= 0;
    }

    if (r.ch > 0) o.ability = dcBotWantsAbility(r, s0);
    return o;
}

function dcBotWantsAbility(r, s0) {
    const role = r.role;
    const targeted = dc.beams.some(function (b) { return b.tg === r.id && !b.safe; }) ||
        dc.attacks.some(function (a) { return a.st === "live" && a.tg === r.id && dc.simT - a.t0 > 0.3; });
    const krillOnMe = r.krill > 0 || dc.krill.some(function (k) { return k.tg === r.id && k.phase === "fly" && k.arriveAt - dc.simT < 1.2; });
    function has(a, b, types) {
        for (let i = 0; i < dcBotList.length; i++) {
            const h = dcBotList[i];
            if (h.seg < s0 + a || h.seg > s0 + b) continue;
            if (types.indexOf(h.type) < 0) continue;
            if (h.type === "crater" && h.st !== "") continue;
            if (h.type === "barricade" && (h.st === "gone" || h.st === "ramp" || (h.st === "open" && role !== "engineer"))) continue;
            if (h.type === "dust" && !h.mines.some(function (m) { return m.st !== "pop"; })) continue;
            return true;
        }
        return false;
    }
    // Medic: a teammate down near her, or anything she can patch through.
    if (role === "medic") {
        for (const id in dc.riders) { const o = dc.riders[id]; if (o !== r && o.down > 0 && Math.abs(o.z - r.z) < 35 * DC_SEG) return true; }
        return targeted || has(2, 26, ["crater", "barricade", "dust"]);
    }
    if (role === "engineer") return targeted || krillOnMe || has(29, 70, ["crater", "barricade"]);
    if (role === "scout") return targeted || krillOnMe || has(8, 110, ["barricade", "dust"]);
    if (role === "gunner") return targeted || krillOnMe || has(4, 70, ["barricade", "dust"]);
    if (role === "butcher") return krillOnMe || has(3, 24, ["barricade", "crater", "dust"]);
    if (role === "bulwark") return targeted || krillOnMe || has(3, 22, ["barricade", "dust"]);
    return false;
}
