// ===================================================
//   Desert Code Racer — the six crew and their abilities
// ===================================================
// One ability per class, on a cooldown. Each is ONE verb with a wide reach,
// so that every class answers four of the five hazard types and misses
// exactly one (DCR_SLICE_PLAN.md, the coverage matrix). That is what makes
// any lineup work: a solo rider of any class is left with only the
// universal answer (steer, brake, boost, jump) on one hazard type at most.
//
//   class      ability  misses   reach
//   medic      MEND     krill    remount the downed near her; 4 s PATCH (a crash becomes a stumble)
//   engineer   RIG      mines    a beacon 30 segs ahead: pulls beams and krill 5 s; ramps craters/barricades
//   scout      SCAN     crater   a pulse 130 segs down the road: pops mines, jams beams, scatters krill, opens barricades
//   gunner     FIRE     crater   a burst 80 segs ahead: downs beams, shoots krill off, opens barricades, pops mines
//   butcher    RAM      beam     a 1.5 s armoured charge: smashes, rips krill off, carries over craters, mines harmless
//   bulwark    SHIELD   crater   a 4 s dome on him and the nearest rider: beams retarget and soak, krill bounce, plows, mines harmless
//
// The matrix is also kept as data (DC_COVER) so dc-dev / tests can check
// the lineup rule against the code instead of against the doc.
"use strict";

const DC_ABILITY = {
    medic:    { name: "MEND",   cd: 12, crew: "MAREN" },
    engineer: { name: "RIG",    cd: 12, crew: "ELODIE" },
    scout:    { name: "SCAN",   cd: 10, crew: "SOREN" },
    gunner:   { name: "FIRE",   cd: 8,  crew: "GREER" },
    butcher:  { name: "RAM",    cd: 10, crew: "BEX" },
    bulwark:  { name: "SHIELD", cd: 12, crew: "BOOKE" }
};
const DC_FIRE_KRILL = 70;           // segs: Greer's seekers find every krill on riders this close
const DC_ROLES = ["medic", "engineer", "scout", "gunner", "butcher", "bulwark"];
const DC_HAZARD_TYPES = ["beam", "crater", "barricade", "krill", "mines", "lash", "strafe"];
const DC_COVER = {
    medic:    ["beam", "crater", "barricade", "mines", "lash", "strafe"],
    engineer: ["beam", "crater", "barricade", "krill", "lash", "strafe"],
    scout:    ["beam", "barricade", "krill", "mines", "lash", "strafe"],
    gunner:   ["beam", "barricade", "krill", "mines", "lash", "strafe"],
    butcher:  ["crater", "barricade", "krill", "mines", "lash", "strafe"],
    bulwark:  ["beam", "barricade", "krill", "mines", "lash", "strafe"]
};

// For tests: the worst count of universal-only hazard types over every
// lineup of 1 to 4 distinct classes. The rule says this must be <= 1.
function dcLineupWorst() {
    let worst = 0, at = [];
    const n = DC_ROLES.length;
    for (let mask = 1; mask < (1 << n); mask++) {
        const team = DC_ROLES.filter(function (r, i) { return mask & (1 << i); });
        if (team.length > 4) continue;
        const bare = DC_HAZARD_TYPES.filter(function (h) {
            return !team.some(function (r) { return DC_COVER[r].indexOf(h) >= 0; });
        });
        if (bare.length > worst) { worst = bare.length; at = team; }
    }
    return { worst: worst, lineup: at };
}

// THE ROLE. The hub deals one character per player (PARTY.role(): the
// session, or ?role= that the hub adds to the link). Opened directly, the
// last character this browser picked on the hub, then a deal by name so a
// fresh browser still gets a class (the same name always gets the same one).
function dcMyRole() {
    let r = "";
    try { if (typeof PARTY !== "undefined") r = PARTY.role() || ""; } catch (e) { r = ""; }
    if (!DC_ABILITY[r]) r = dcParam("role") || "";
    if (!DC_ABILITY[r]) { try { r = localStorage.getItem("gamehub_role") || ""; } catch (e) { r = ""; } }
    if (!DC_ABILITY[r]) {
        const name = (typeof MP !== "undefined" && MP.identity ? MP.identity().name : "") || "RIDER";
        let h = 7;
        for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
        r = DC_ROLES[h % DC_ROLES.length];
    }
    return r;
}

// ---------------------------------------------------
//   CASTING (the caster's client): one relayed event, applied everywhere
// ---------------------------------------------------
function dcCast(r) {
    const a = DC_ABILITY[r.role];
    if (!a) return;
    if (r.ch >= DC_CHARGES) r.cd = a.cd;      // start the recharge clock
    r.ch--;
    const msg = { k: "ab", a: r.role, by: r.id, z: Math.round(r.z), x: +r.x.toFixed(3) };
    if (r.role === "bulwark") msg.ally = dcNearestRider(r);
    dcEmit(msg);
}

function dcNearestRider(r) {
    let best = "", bd = 30 * DC_SEG;
    for (const id in dc.riders) {
        const o = dc.riders[id];
        if (o === r) continue;
        const d = Math.abs(o.z - r.z);
        if (d < bd) { bd = d; best = id; }
    }
    return best;
}

// Everyone runs this for every cast, in the same order, against the same
// road, so the static effects come out the same on every screen. Points go
// to the caster's own client (it is the one that counts them).
function dcApplyAbility(m) {
    const mine = dc.me && m.by === dc.me.id;
    const s = Math.floor(m.z / DC_SEG);
    const caster = dc.riders[m.by];
    const col = caster ? caster.color : DC_COL.hot;
    const vol = dcVolAt(m.z);
    let n = 0;
    if (!dc.demo && (mine || vol > 0.2)) {
        const f = { medic: "mend", engineer: "rig", scout: "scan", gunner: "fire", butcher: "ram", bulwark: "shield" }[m.a];
        if (f) dcSnd[f]();
    }
    dcFxAbility(m, col);

    if (m.a === "medic") {
        const me = dc.me;
        if (me && dc.mode === "play") {
            const d = Math.abs(me.z - m.z) / DC_SEG;
            if (me.down > 0 && d < 40) {
                dcRemount(me);
                dcCreditTo(m.by, 200, "revives", "MENDED");
            }
            if (d < 25) { me.patchedUntil = dc.simT + 4; me.patchedBy = m.by; }
        }
    } else if (m.a === "engineer") {
        const bz = m.z + 30 * DC_SEG;
        dc.beacons.push({ z: bz, x: dcClamp(m.x, -0.8, 0.8), until: dc.simT + 5, by: m.by, color: col, t: dc.simT });
        const bs = Math.floor(bz / DC_SEG);
        dcHazardsIn(bs - 2, bs + 45).forEach(function (h) {
            if ((h.type === "crater" && h.st === "") || (h.type === "barricade" && (h.st === "" || h.st === "open"))) {
                h.st = "ramp"; n++;
            }
        });
        if (mine && n) dcCredit(100 * n, "solves", n, "RAMP");
    } else if (m.a === "scout") {
        dcHazardsIn(s, s + 130).forEach(function (h) {
            if (h.type === "barricade" && h.st === "") { h.st = "open"; n++; }
            if (h.type === "dust") {
                h.reveal = dc.simT;
                h.mines.forEach(function (mn) { if (mn.st === "") { mn.st = "pop"; mn.popT = dc.simT + (mn.seg - s) / 130; n++; } });
            }
        });
        if (mine && n) dcCredit(100 * n, "solves", n, "SCANNED");
    } else if (m.a === "gunner") {
        dcHazardsIn(s, s + 80).forEach(function (h) {
            if (h.type === "barricade" && h.st === "") { h.st = "open"; n++; }
            if (h.type === "dust") h.mines.forEach(function (mn) { if (mn.st === "" && mn.seg >= s) { mn.st = "pop"; mn.popT = dc.simT + 0.3; n++; } });
        });
        if (mine && n) dcCredit(100 * n, "solves", n, "CLEARED");
    } else if (m.a === "butcher") {
        dc.rams[m.by] = dc.simT + 1.5;
    } else if (m.a === "bulwark") {
        dc.shields[m.by] = { until: dc.simT + 4, by: m.by };
        if (m.ally) dc.shields[m.ally] = { until: dc.simT + 4, by: m.by };
    }
    if (dcIsHost()) { dcHostAbility(m); dcHostAttackAbility(m); }
}
