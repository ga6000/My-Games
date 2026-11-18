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
        air: 0, airMax: 0, cap: 1, down: 0, inv: 0, stumble: 0,
        patchedUntil: -1, patchedBy: "", krill: 0, boosting: false, dustT: 0,
        cd: 0, pts: 0, carryAcc: 0, grabWait: 0, passed: {}, seen: 0,
        contrib: { carry: 0, solves: 0, revives: 0, beams: 0, krill: 0, grabs: 0, crashes: 0 }
    };
}

function dcResetRider(r, z, x) {
    r.z = z; r.x = x || 0; r.v = 0; r.lean = 0; r.air = 0; r.cap = 1; r.down = 0; r.inv = 0;
    r.stumble = 0; r.patchedUntil = -1; r.krill = 0; r.cd = 0; r.pts = 0; r.carryAcc = 0;
    r.grabWait = 0; r.passed = {};
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
    if (r.cd > 0) { r.cd -= dt; if (r.cd <= 0 && !dc.demo) dcSnd.abilityReady(); }
    if (r.inv > 0) r.inv -= dt;
    if (r.dustT > 0) r.dustT -= dt;

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
    r.x = dcClamp(r.x, -1.9, 1.9);
    r.lean = dcLerp(r.lean, inp.steer, Math.min(1, dt * 8));

    // Speed.
    let target = DC_CRUISE;
    r.boosting = false;
    if (inp.boost && r.cap > 0.02 && !inp.brake) { target = DC_BOOST; r.cap -= 0.36 * dt; r.boosting = true; }
    else r.cap = Math.min(1, r.cap + 0.13 * dt);
    if (inp.brake) target = DC_BRAKE;
    if (Math.abs(r.x) > 1) target = Math.min(target, DC_OFFROAD);
    target *= (1 - 0.08 * r.krill);
    if (r.dustT > 0) target *= 0.95;
    // The convoy: riders behind the case surge to catch up; riders far ahead
    // are held back (nobody can ride back for a dropped case).
    const cz = dcCaseZ();
    if (cz !== null && !dcCarrying(r) && dc.mode === "play") {
        const d = (r.z - cz) / DC_SEG;
        if (d < -40 && !inp.brake) target *= 1.22;
        if (d > 120) target = Math.min(target, DC_CRUISE * 0.6);
        else if (d > 60) target = Math.min(target, DC_CRUISE * 0.82);
    }
    if (dcRamming(r.id)) target = Math.max(target, DC_BOOST * 1.05);
    if (r.stumble > 0) { r.stumble -= dt; target = Math.min(target, r.v); }
    if (r.v < target) r.v = Math.min(target, r.v + (target > DC_CRUISE ? 6200 : 4200) * dt);
    else r.v = Math.max(target, r.v - (inp.brake ? 9000 : 3200) * dt);

    // Jump: costs a quarter of the capacitor, and shakes off latched krill.
    if (inp.jump && r.air <= 0 && r.cap >= 0.25) {
        r.cap -= 0.25;
        dcLaunch(r, DC_TUNE.airT, false);
        if (r.krill > 0) dcShakeKrill(r);
    }
    if (r.air > 0) {
        r.air -= dt;
        if (r.air <= 0) { r.air = 0; r.v *= 0.95; if (!dc.demo) dcSnd.land(); dcBurstDust(r.z, r.x, 6); }
    }

    // Ability.
    if (inp.ability) {
        if (r.cd <= 0) dcCast(r);
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
    r.down = DC_TUNE.respawn;
    r.air = 0;
    r.krill = 0;
    r.v *= 0.15;                        // the bike tumbles a few metres, no further
    r.contrib.crashes++;
    if (!dc.demo) { dcSnd.crash(); dcShake(14); }
    dcBurstExplosion(r.z, r.x, r.color, 1);
    dcEmit({ k: "crash", z: Math.round(r.z), x: +r.x.toFixed(3), w: why });
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
            if (s1 < h.seg || s0 > h.seg || r.passed[h.id]) continue;
            r.passed[h.id] = 1;
            if (h.st === "gone") continue;
            // A ram or a shield goes straight through, gap or no gap.
            if (ram) { dcSmash(h, r, "RAMMED"); dcCredit(100, "solves", 1); continue; }
            if (sh) { dcSmash(h, r, "PLOWED"); dcCreditTo(sh.by, 100, "solves", "PLOWED"); continue; }
            const gw = h.st === "open" ? 1.15 : h.gapW;
            if (Math.abs(r.x - h.gapX) <= gw / 2 - DC_BIKE_HALF) {
                if (h.st === "") { dcCredit(10, null, 0); if (!dc.demo) dcSnd.gap(); }
                continue;
            }
            if (h.st === "ramp") { dcLaunch(r, 0.85, true); continue; }
            dcCrash(r, "barricade");
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
    if (Math.abs(r.x) > 1.2 && !air) {
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
    if (r.down > 0) { r.down -= dt; r.v = Math.max(0, r.v - 9000 * dt); }
    if (r.air > 0) r.air -= dt;
    r.z += r.v * dt;
    if (r.tz !== undefined) { r.z += (r.tz - r.z) * Math.min(1, dt * 4); r.tz += r.v * dt; }
    r.x = dcLerp(r.x, r.tx, Math.min(1, dt * 10));
}
