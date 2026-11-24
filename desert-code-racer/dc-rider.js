// ===================================================
//   Desert Code Racer — riders: input, bike physics, crashes, the case
// ===================================================
// Each client owns its own bike (dc.me) and is the only one that decides
// whether it crashed. Other riders are drawn from what they relay
// (dc-net.js) and extrapolated between messages.
"use strict";

const DC_RING = 0.27;               // beam ring radius, road units
const DC_BIKE_HALF = 0.06;

function dcNewRider(id, name, color, role, local) {
    return {
        id: id, name: name || "RIDER", color: color || DC_COL.hot, role: role || "medic", local: !!local,
        z: DC_START_SEGS * 0.5 * DC_SEG, x: 0, v: 0, tx: 0, lean: 0,
        air: 0, airMax: 0, jcd: 0, ch: DC_CHARGES, down: 0, inv: 0, stumble: 0,
        patchedUntil: -1, patchedBy: "", krill: 0, boosting: false, dustT: 0,
        cd: 0, pts: 0, carryAcc: 0, grabWait: 0, passed: {}, seen: 0,
        contrib: { carry: 0, solves: 0, revives: 0, beams: 0, krill: 0, grabs: 0, crashes: 0 }
    };
}

function dcResetRider(r, z, x) {
    r.z = z; r.x = x || 0; r.v = 0; r.lean = 0; r.air = 0; r.jcd = 0; r.ch = DC_CHARGES; r.down = 0; r.inv = 0;
    r.stumble = 0; r.patchedUntil = -1; r.krill = 0; r.cd = 0; r.pts = 0; r.carryAcc = 0;
    r.grabWait = 0; r.passed = {};
    r.home = 0; r.slide = 0; r.chips = 0; r.scrape = 0; r.crashKind = ""; r.downMax = 0;
    r.contrib = { carry: 0, solves: 0, revives: 0, beams: 0, krill: 0, grabs: 0, crashes: 0 };
}

// ---------------------------------------------------
//   INPUT (keyboard and mouse only: no gamepad, GAME_PROTOTYPE_INSTRUCTIONS §1)
// ---------------------------------------------------
const dcKeys = {};
const dcInput = { steer: 0, boost: false, brake: false, jump: false, ability: false };
let dcJumpEdge = false, dcAbilityEdge = false;

function dcInputInit() {
    dcOn(window, "keydown", function (e) {
        if (e.ctrlKey || e.metaKey || e.altKey) return;
        const c = e.code;
        if (!dcKeys[c]) {
            if (c === "Space") dcJumpEdge = true;
            if (c === "KeyE" || c === "ShiftLeft" || c === "ShiftRight") dcAbilityEdge = true;
            if (c === "KeyM") dcToggleMute();
        }
        dcKeys[c] = true;
        if (dc.mode === "play" && (c === "Space" || c.indexOf("Arrow") === 0)) e.preventDefault();
        dcAudioInit();
    });
    dcOn(window, "keyup", function (e) { dcKeys[e.code] = false; });
    dcOn(window, "blur", function () { for (const k in dcKeys) dcKeys[k] = false; });
    dcOn(window, "pointerdown", function (e) {
        dcAudioInit();
        if (e.button === 0 && dc.mode === "play" && e.target && e.target.id === "dcCanvas") dcAbilityEdge = true;
    });
}

function dcReadInput() {
    const k = dcKeys;
    dcInput.steer = ((k.ArrowRight || k.KeyD) ? 1 : 0) - ((k.ArrowLeft || k.KeyA) ? 1 : 0);
    dcInput.boost = !!(k.ArrowUp || k.KeyW);
    dcInput.brake = !!(k.ArrowDown || k.KeyS);
    dcInput.jump = dcJumpEdge;
    dcInput.ability = dcAbilityEdge;
    dcJumpEdge = false; dcAbilityEdge = false;
    return dcInput;
}

// ---------------------------------------------------
//   STATUS
// ---------------------------------------------------
function dcPatched(r) { return dc.simT < r.patchedUntil; }
function dcShieldOf(id) { const s = dc.shields[id]; return s && dc.simT < s.until ? s : null; }
function dcRamming(id) { return (dc.rams[id] || 0) > dc.simT; }
function dcCarrying(r) { return !!dc.caseS && dc.caseS.holder === r.id; }

// Where the case is along the road (its holder's z, or where it lies).
function dcCaseZ() {
    const c = dc.caseS;
    if (!c) return null;
    if (c.holder) { const h = dc.riders[c.holder]; return h ? h.z : c.z; }
    return c.z;
}

// ---------------------------------------------------
//   CREDIT: points into this rider's contribution row (and a toast)
// ---------------------------------------------------
function dcCredit(pts, field, n, label) {
    const r = dc.me;
    if (!r || dc.demo || dc.mode !== "play") return;
    if (field) r.contrib[field] += (n === undefined ? 1 : n);
    if (pts > 0) {
        r.pts += pts;
        dcToastAtMe(pts, label);
    }
}

// Credit someone else for something that happened on my bike (their shield
// plowed my barricade, their patch saved my crash, their Mend got me up).
function dcCreditTo(id, pts, field, label) {
    if (!id) return;
    if (dc.me && id === dc.me.id) { dcCredit(pts, field, 1, label); return; }
    dcEmit({ k: "cr", to: id, pts: pts, f: field, l: label || "" });
}

// ---------------------------------------------------
//   THE LOCAL BIKE
// ---------------------------------------------------
function dcRiderUpdate(r, inp, dt) {
    if (r.grabWait > 0) r.grabWait -= dt;
    // Ability charges: one recharges at a time, over the class cooldown.
    if (r.ch < DC_CHARGES) {
        r.cd -= dt;
        if (r.cd <= 0) { r.ch++; r.cd = r.ch < DC_CHARGES ? dcAbilityCd(r) : 0; if (!dc.demo && r.local) dcSnd.abilityReady(); }
    } else r.cd = 0;
    if (r.jcd > 0 && r.air <= 0) r.jcd -= dt;
    if (r.inv > 0) r.inv -= dt;
    if (r.dustT > 0) r.dustT -= dt;

    if (dcHomeUpdate(r, dt)) return;
    if (r.down > 0) {
        r.down -= dt;
        r.v = Math.max(0, r.v - 30000 * dt);
        r.z += r.v * dt;
        if (r.down <= 0) dcRemount(r);
        return;
    }

    const seg = dcSegAt(r.z);
    const sp = r.v / DC_CRUISE;

    // Steering, plus the bend pushing the bike outward.
    const steerRate = dcSteerRate(r);
    r.x += inp.steer * steerRate * dt;
    r.x -= dt * sp * sp * seg.curve * 0.28;
    // Walls (canyon, tunnel) scrape and push back; open desert lets you wander.
    const lim = dcLaneLimit(seg);
    if (Math.abs(r.x) > lim) {
        r.x = Math.sign(r.x) * lim;
        if (seg.zone === "valley" || seg.zone === "tunnel" || seg.zone === "lab") {
            r.v *= Math.pow(0.55, dt);
            r.scrape = 0.12;
            if (!dc.demo && Math.random() < dt * 30) dcBurstSparks(r.z, r.x, DC_COL.hot, 2);
        }
    }
    if (r.scrape > 0) r.scrape -= dt;
    r.lean = dcLerp(r.lean, inp.steer, Math.min(1, dt * 8));

    // Speed.
    // Coast at cruise; hold boost for 400 as long as you like; brake to a stop.
    let target = DC_CRUISE;
    r.boosting = false;
    if (inp.boost && !inp.brake) { target = DC_BOOST; r.boosting = true; }
    if (inp.brake) target = 0;
    if (!dcOnRoad(r.x, seg)) target = Math.min(target, DC_OFFROAD);
    target *= (1 - 0.08 * r.krill);
    if (r.dustT > 0) target *= 0.95;
    // The convoy spreads out freely (Ry, pass 2): no hold-back, no surge.
    if (dcRamming(r.id)) target = Math.max(target, DC_BOOST * 1.05);
    if (r.stumble > 0) { r.stumble -= dt; target = Math.min(target, r.v); }
    if (r.v < target) r.v = Math.min(target, r.v + (target > DC_CRUISE ? 6200 : 4200) * dt);
    else r.v = Math.max(target, r.v - (inp.brake ? 7500 : 3200) * dt);

    // Jump: instant, short, on its own quick cooldown; shakes off latched krill.
    if (inp.jump && r.air <= 0 && r.jcd <= 0) {
        r.jcd = DC_TUNE.jumpCd;
        dcLaunch(r, DC_TUNE.airT, false);
        if (r.krill > 0) dcShakeKrill(r);
    }
    if (r.air > 0) {
        r.air -= dt;
        if (r.air <= 0) { r.air = 0; r.v *= 0.95; if (!dc.demo) dcSnd.land(); dcBurstDust(r.z, r.x, 6); }
    }

    // Ability.
    if (inp.ability) {
        if (r.ch > 0) dcCast(r);
        else if (!dc.demo) dcSnd.denied();
    }

    const z0 = r.z;
    r.z += r.v * dt;
    if (dc.track) r.z = Math.min(r.z, dc.track.length - DC_SEG * 2);

    // Carrying the case: distance pays (a CHIP every 100 m).
    if (dcCarrying(r)) {
        r.carryAcc += r.z - z0;
        r.contrib.carry += (r.z - z0) / 67;           // metres
        while (r.carryAcc >= 6700) { r.carryAcc -= 6700; r.pts += 10; }
    }

    dcCollide(r, Math.floor(z0 / DC_SEG), Math.floor(r.z / DC_SEG));
    dcTryGrab(r);
}

function dcSteerRate(r) {
    return 1.9 * (0.7 + 0.3 * Math.min(1, r.v / DC_CRUISE)) * (r.air > 0 ? 0.55 : 1);
}

function dcLaunch(r, t, ramp) {
    r.air = Math.max(r.air, t);
    r.airMax = r.air;
    if (dc.demo) return;
    if (ramp) dcSnd.ramp(); else dcSnd.jump();
}

function dcRemount(r) {
    r.down = 0;
    r.inv = 1.2;
    r.v = Math.max(r.v, DC_CRUISE * 0.4);
    r.x = dcClamp(r.x, -0.85, 0.85);
    r.stumble = 0;
    if (!dc.demo) dcSnd.remount();
}

// Every way a bike can go down comes through here.
function dcCrash(r, why) {
    if (r.down > 0 || r.inv > 0) return "none";
    if (r.local && dc.devGod) return "none";        // dev panel GOD MODE
    if (dcPatched(r)) {
        // MEND's patch: the crash becomes a stumble. No drop, some speed.
        r.v *= 0.62;
        r.stumble = 0.5;
        r.inv = 0.5;
        if (!dc.demo) dcSnd.stumble();
        dcBurstSparks(r.z, r.x, "#3FFFB0", 12);
        dcCreditTo(r.patchedBy, dcCarrying(r) ? 200 : 100, "solves", "PATCHED");
        return "stumble";
    }
    if (r.local) dc.crashLog.push(why + "@" + Math.floor(r.z / DC_SEG));
    const v0 = r.v;
    r.down = r.downMax = DC_TUNE.respawn;
    r.crashKind = why;
    r.crashSide = r.x > 0.3 ? 1 : (r.x < -0.3 ? -1 : (Math.random() < 0.5 ? -1 : 1));
    r.air = 0;
    r.krill = 0;
    r.v *= 0.15;                        // the bike tumbles a few metres, no further
    r.contrib.crashes++;
    if (!dc.demo) { dcSnd.crash(); dcShake(14); }
    dcBurstExplosion(r.z, r.x, r.color, 1);
    dcEmit({ k: "crash", z: Math.round(r.z), x: +r.x.toFixed(3), w: why, sd: r.crashSide });
    if (dcCarrying(r)) dcEmit({ k: "drop", z: Math.round(r.z), x: +r.x.toFixed(3), v: Math.round(v0), by: r.id });
    return "crash";
}

// ---------------------------------------------------
//   COLLISIONS with the static road (craters, barricades, mines, cacti)
// ---------------------------------------------------
const dcScratch = [];
function dcCollide(r, s0, s1) {
    if (r.down > 0) return;
    dcScratch.length = 0;
    dcHazardsIn(s0, s1 + 1, dcScratch);
    const air = r.air > 0;
    const ram = dcRamming(r.id);
    const sh = dcShieldOf(r.id);
    for (let i = 0; i < dcScratch.length; i++) {
        const h = dcScratch[i];
        if (r.down > 0) return;
        if (h.type === "crater") {
            if (s1 < h.seg || s0 > h.seg + h.len) continue;
            if (Math.abs(r.x - h.x) >= h.r + DC_BIKE_HALF || r.passed[h.id]) continue;
            r.passed[h.id] = 1;
            if (h.st === "ramp") { dcLaunch(r, 0.85, true); continue; }
            if (air) continue;
            if (ram) { dcLaunch(r, 0.45, true); dcCredit(100, "solves", 1, "CARRIED OVER"); continue; }
            dcCrash(r, "crater");
        } else if (h.type === "barricade") {
            if (s1 < h.seg || s0 > h.seg + h.len) continue;
            if (h.st === "gone") continue;
            const key = h.id + ":" + s1;
            if (r.passed[key]) continue;
            // A ram or a shield goes straight through, gap or no gap.
            const hit = dcBarrierHits(h, s0, s1, r.x, air, DC_BIKE_HALF);
            const st0 = h.st;
            if (h.st === "ramp" && !r.passed[h.id] && s1 >= h.seg) { r.passed[h.id] = 1; dcLaunch(r, 0.85, true); continue; }
            if (!hit) {
                // Threaded it: the universal answer pays a little.
                if (st0 === "" && !r.passed[h.id] && s1 >= h.seg + h.len - 1) { r.passed[h.id] = 1; dcCredit(10, null, 0); if (!dc.demo) dcSnd.gap(); }
                continue;
            }
            r.passed[key] = 1;
            if (ram) { dcSmash(h, r, "RAMMED"); dcCredit(100, "solves", 1); continue; }
            if (sh) { dcSmash(h, r, "PLOWED"); dcCreditTo(sh.by, 100, "solves", "PLOWED"); continue; }
            dcCrash(r, h.kind === "pipe" ? "pipe" : (h.kind === "traps" ? "trap" : "barricade"));
        } else if (h.type === "pad") {
            if (s1 < h.seg || s0 > h.seg + h.len || r.passed[h.id]) continue;
            if (Math.abs(r.x - h.x) < 0.3 && !air) { r.passed[h.id] = 1; dcLaunch(r, 0.9, true); dcCredit(50, null, 0, "AIR"); }
        } else if (h.type === "chips") {
            for (let c = 0; c < h.chips.length; c++) {
                const ch = h.chips[c];
                if (ch.seg < s0 || ch.seg > s1 || r.passed[h.id + "c" + c]) continue;
                if (Math.abs(r.x - ch.x) < 0.2) {
                    r.passed[h.id + "c" + c] = 1;
                    r.chips = (r.chips || 0) + 1;
                    dcCredit(50, null, 0, "");
                    if (!dc.demo) { dcSnd.chip(); dcBurstSparks(ch.seg * DC_SEG, ch.x, DC_COL.amber, 5); }
                }
            }
        } else if (h.type === "dust") {
            if (s1 < h.seg || s0 > h.seg + h.len) continue;
            if (Math.abs(r.x - h.x) < h.w / 2 && !air) r.dustT = 0.15;
            for (let m = 0; m < h.mines.length; m++) {
                const mn = h.mines[m];
                if (mn.st === "pop" || mn.seg < s0 || mn.seg > s1) continue;
                if (Math.abs(r.x - mn.x) >= 0.1) continue;
                if (air) continue;
                if (ram) { dcEmit({ k: "hz", id: h.id, m: m, st: "pop" }); dcCredit(50, "solves", 1); continue; }
                if (sh) { dcEmit({ k: "hz", id: h.id, m: m, st: "pop" }); dcCreditTo(sh.by, 50, "solves", ""); continue; }
                dcEmit({ k: "hz", id: h.id, m: m, st: "boom" });
                dcCrash(r, "mine");
            }
        }
    }
    // Cacti off the road.
    if (!dcOnRoad(r.x, dcSegAt(r.z)) && Math.abs(r.x) > 1.2 && !air) {
        for (let s = s0; s <= s1; s++) {
            const sg = dc.track.segs[s];
            if (!sg) continue;
            for (let k = 0; k < sg.scene.length; k++) {
                const o = sg.scene[k];
                if (o.kind === "cactus" && Math.abs(r.x - o.x) < 0.13) { dcCrash(r, "cactus"); return; }
            }
        }
    }
}

function dcSmash(h, r, label) {
    dcEmit({ k: "hz", id: h.id, st: "gone" });
    if (!dc.demo) dcText3D(label, h.seg * DC_SEG, h.gapX, DC_COL.hot);
}

// ---------------------------------------------------
//   THE CASE: riding over a dropped case asks the host for it
// ---------------------------------------------------
function dcTryGrab(r) {
    const c = dc.caseS;
    if (!c || c.holder || c.over || r.down > 0 || r.air > 0 || r.grabWait > 0) return;
    if (Math.abs(r.z - c.z) < 2.4 * DC_SEG && Math.abs(r.x - c.x) < 0.36) {
        r.grabWait = 0.5;
        dcEmit({ k: "grab", by: r.id });
    }
}

// ---------------------------------------------------
//   REMOTE RIDERS: extrapolated between relays
// ---------------------------------------------------
function dcRemoteUpdate(r, dt) {
    dcRemoteHome(r, dt);
    if (r.home) { r.v = Math.max(0, r.v - Math.max(3000, r.v * 1.6) * dt); r.x = dcLerp(r.x, r.tx, Math.min(1, dt * 4)); r.z += r.v * dt; r.z = Math.min(r.z, (dc.track.finish + 26) * DC_SEG); return; }
    if (r.down > 0) { r.down -= dt; r.v = Math.max(0, r.v - 9000 * dt); }
    if (r.air > 0) r.air -= dt;
    r.z += r.v * dt;
    if (r.tz !== undefined) { r.z += (r.tz - r.z) * Math.min(1, dt * 4); r.tz += r.v * dt; }
    r.x = dcLerp(r.x, r.tx, Math.min(1, dt * 10));
}

function dcAbilityCd(r) {
    const a = DC_ABILITY[r.role];
    return a ? a.cd : 10;
}
