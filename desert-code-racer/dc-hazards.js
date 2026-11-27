// ===================================================
//   Desert Code Racer — the mothership's beams, the krill, and the case
// ===================================================
// THE HOST owns everything here that needs one answer: when a beam fires
// and at whom, where it locks, when krill arrive and whether they latch,
// who holds the case, its pips, the checkpoints and the end of the run.
// It decides and then dcEmit()s; every client (the host included) applies
// the same message in dcHandle() (dc-net.js). Solo, this client is host.
//
// Each client still decides its OWN bike's fate: a beam impact is checked
// by every client against its own bike only.
"use strict";

// ---------------------------------------------------
//   BEAMS
// ---------------------------------------------------
function dcBeamTarget(b) {
    if (b.tg && b.tg.indexOf("beacon") === 0) return null;
    return dc.riders[b.tg] || null;
}

// Where a tracking beam's ring sits now: ahead of its rider, leading them.
function dcBeamAim(b) {
    const r = dcBeamTarget(b);
    if (!r) return { z: b.z || 0, x: b.x || 0 };
    const lead = Math.max(0, b.lockAt - dc.simT) + DC_TUNE.lock;
    return { z: r.z + r.v * lead, x: dcClamp(r.x, -1.3, 1.3) };
}

function dcOnBeamSpawn(m) {
    dc.beams.push({ id: m.id, tg: m.tg, src: m.src || 0, phase: "track", t: dc.simT,
        lockAt: dc.simT + DC_TUNE.track, z: 0, x: 0, phs: Math.random() * 6.28 });
    if (!dc.demo) {
        const forMe = dc.me && m.tg === dc.me.id;
        dcSnd.beamCharge(forMe ? 1 : 0.35);
    }
}

function dcOnBeamLock(m) {
    let b = dcFindBeam(m.id);
    if (!b) {
        b = { id: m.id, tg: m.tg || "", src: 0, t: dc.simT, phs: Math.random() * 6.28 };
        dc.beams.push(b);
    }
    b.phase = "lock";
    b.z = m.z; b.x = m.x;
    b.impactAt = dc.simT + (m.dt || DC_TUNE.lock);
    b.safe = !!m.safe;
    b.soak = m.soak || "";
    b.by = m.by || "";
    if (!dc.demo && dc.me && Math.abs(dc.me.z - b.z) < 120 * DC_SEG) {
        dcSnd.beamLock(Math.abs(dc.me.x - b.x) < DC_RING * 2.5 ? 1 : 0.3);
    }
}

function dcFindBeam(id) {
    for (let i = 0; i < dc.beams.length; i++) if (dc.beams[i].id === id) return dc.beams[i];
    return null;
}

function dcBeamImpact(b) {
    b.phase = "gone";
    dcBurstExplosion(b.z, b.x, b.safe ? DC_COL.cyan : DC_COL.magenta, 1.2);
    dcAddScorch(b.z, b.x);
    if (!dc.demo) dcSnd.beamImpact(dcVolAt(b.z));
    const me = dc.me;
    if (b.safe) {
        if (me && b.by === me.id) dcCredit(200, "beams", 1, "DECOYED");
        return;
    }
    if (b.soak) {
        // Drawn to the shield and soaked by it, wherever he is when it lands.
        if (me && b.soak === me.id) { dcSnd.soak(); dcBurstSparks(me.z, me.x, me.color, 14); dcCredit(200, "beams", 1, "SOAKED"); }
        return;
    }
    if (!me || me.down > 0 || dc.mode !== "play" || dcInTunnel(b.z) || me.home) return;
    const dz = Math.abs(me.z - b.z) / DC_SEG, dx = Math.abs(me.x - b.x);
    if (dz < 1.7 && dx < DC_RING + DC_BIKE_HALF) {
        const sh = dcShieldOf(me.id);
        if (sh) {
            dcSnd.soak();
            dcBurstSparks(me.z, me.x, DC_COL.cyan, 14);
            dcCreditTo(sh.by, 200, "beams", "SOAKED");
            return;
        }
        dcCrash(me, "beam");
    } else if (dz < 3 && dx < DC_RING * 2.6) {
        dcCredit(10, null, 0);                  // the universal answer: a dodge
    }
}

function dcOnBeamGone(m) {
    const b = dcFindBeam(m.id);
    if (!b || b.phase === "gone") return;
    const aim = b.phase === "lock" ? { z: b.z, x: b.x } : dcBeamAim(b);
    b.phase = "gone";
    if (m.why === "jam") {
        // Lost its lock: it lands wide, off the road, harmlessly.
        const wx = aim.x > 0 ? -1.7 : 1.7;
        dcBurstExplosion(aim.z, wx, DC_COL.mid, 0.7);
    } else {
        dcBurstAir(aim.z, aim.x, DC_COL.amber);
    }
    if (!dc.demo) dcSnd.beamDowned(dcVolAt(aim.z));
    if (dc.me && m.by === dc.me.id) dcCredit(200, "beams", 1, m.why === "jam" ? "JAMMED" : "DOWNED");
}

// ---------------------------------------------------
//   KRILL
// ---------------------------------------------------
function dcOnKrillSpawn(m) {
    dc.krill.push({ id: m.id, tg: m.tg, phase: "fly", t: dc.simT, arriveAt: dc.simT + (m.arr || 2.2), n: 3, latchT: 0,
        seed: Math.random() * 100 });
    if (!dc.demo && dc.me && m.tg === dc.me.id) dcSnd.krillIncoming(1);
}

function dcFindKrill(id) {
    for (let i = 0; i < dc.krill.length; i++) if (dc.krill[i].id === id) return dc.krill[i];
    return null;
}

function dcOnKrillLatch(m) {
    const k = dcFindKrill(m.id);
    if (!k) return;
    const fresh = k.phase !== "latch";
    k.phase = "latch"; k.n = m.n;
    if (fresh) k.latchT = dc.simT;
    if (dc.me && k.tg === dc.me.id) {
        dc.me.krill = k.n;
        if (fresh && !dc.demo) dcSnd.krillLatch();
    }
}

function dcOnKrillGone(m) {
    const k = dcFindKrill(m.id);
    if (!k || k.phase === "gone") return;
    if (m.d && !k.dying) {
        // Seekers are on the way: it dies when they arrive (it can't bite meanwhile).
        k.dying = true;
        trackTimeout(function () { m.d = 0; dcOnKrillGone(m); }, m.d * 1000 / (dcOnline() ? 1 : DC_TIMESCALE));
        return;
    }
    const r = dc.riders[k.tg];
    k.phase = "gone";
    if (dc.me && k.tg === dc.me.id) {
        dc.me.krill = 0;
        // They held on too long: they drag the rider down (Ry, pass 2).
        if (m.why === "bite" && dc.mode === "play") { if (!dc.demo) dcSnd.krillBite(); dcCrash(dc.me, "krill"); }
    }
    if (r) dcBurstKrill(r.z, r.x);
    if (!dc.demo && r) dcSnd.krillOff(dcVolAt(r.z));
    const labels = { shot: "SHOT DOWN", scatter: "SCATTERED", rip: "RIPPED OFF", decoy: "DECOYED", bounce: "BOUNCED" };
    if (dc.me && m.by === dc.me.id && labels[m.why]) dcCredit(200, "krill", 1, labels[m.why]);
}

// The jump shakes off two krill (the universal answer).
function dcShakeKrill(r) {
    for (let i = 0; i < dc.krill.length; i++) {
        const k = dc.krill[i];
        if (k.phase === "latch" && k.tg === r.id) {
            const off = Math.min(2, k.n);
            dcCredit(10 * off, null, 0);
            dcEmit({ k: "shake", id: k.id, n: off });
        }
    }
}

// ---------------------------------------------------
//   HOST: spawns, locks, latches, the case
// ---------------------------------------------------
function dcAliveRiders() {
    const out = [];
    for (const id in dc.riders) { const r = dc.riders[id]; if (r.down <= 0 && r.seen >= 0 && !r.home && !dcInTunnel(r.z) && !dcInTunnel(r.z + 30 * DC_SEG)) out.push(r); }
    return out;
}

function dcActiveBeacon() {
    for (let i = dc.beacons.length - 1; i >= 0; i--) if (dc.beacons[i].until > dc.simT) return dc.beacons[i];
    return null;
}

function dcHostPick(preferCase) {
    const alive = dcAliveRiders();
    if (!alive.length) return null;
    const c = dc.caseS;
    if (c && c.holder && dc.riders[c.holder] && alive.indexOf(dc.riders[c.holder]) >= 0 && Math.random() < preferCase) return dc.riders[c.holder];
    return alive[Math.floor(Math.random() * alive.length)];
}

function dcHostUpdate(dt) {
    if (dc.mode !== "play" || !dc.caseS || dc.caseS.over) return;
    // A lost round plays its crash out first (Ry 2026-11-26), then restarts.
    if (dc.rrAt) {
        if (dc.simT >= dc.rrAt) { const m = dc.rrMsg; dc.rrAt = 0; dc.rrMsg = null; dcEmit(m); }
        return;
    }
    const leg = Math.min(2, dc.leg);
    const n = Math.max(1, Object.keys(dc.riders).length);
    const crowd = 1 + 0.22 * (n - 1);
    const caseZ = dcCaseZ() || 0;
    const caseSeg = caseZ / DC_SEG;
    const legStart = dc.track.legStart[leg];
    let quiet = caseSeg < legStart + 60 || caseSeg > dc.track.finish - 40;
    // The round break: the sky holds fire from the checkpoint tunnel's mouth.
    const ct = dc.track.cpTun || [];
    for (let i = 0; i < ct.length; i++) if (caseSeg >= ct[i].a - 40 && caseSeg < ct[i].b) quiet = true;

    // Beams.
    dc.hostT.beam -= dt;
    if (dc.hostT.beam <= 0 && !quiet) {
        dc.hostT.beam = DC_TUNE.beamEvery[leg] * (0.75 + Math.random() * 0.5) / crowd;
        const bc = dcActiveBeacon();
        const t = dcHostPick(0.45);
        if (t || bc) dcEmit({ k: "bm", id: dc.nextId++, tg: t ? t.id : "beacon", src: Math.random() < 0.25 ? 1 : 0 });
    }
    if (!quiet) dcHostAttacks(dt, leg, crowd);
    for (let i = 0; i < dc.beams.length; i++) {
        const b = dc.beams[i];
        if (b.phase === "track" && dc.simT >= b.lockAt) {
            const bc = dcActiveBeacon();
            const sh = dcHostShieldOwner();
            if (bc) dcEmit({ k: "bl", id: b.id, z: Math.round(bc.z), x: bc.x, safe: 1, by: bc.by, dt: 0.6 });
            else if (sh) {
                const r = dc.riders[sh];
                dcEmit({ k: "bl", id: b.id, z: Math.round(r.z + r.v * 0.7), x: +r.x.toFixed(3), soak: sh, dt: 0.7 });
            } else {
                const a = dcBeamAim(b);
                dcEmit({ k: "bl", id: b.id, z: Math.round(a.z), x: +a.x.toFixed(3) });
            }
        }
        if (b.phase === "track" && dc.simT > b.lockAt + 3) b.phase = "gone";       // its rider left
    }

    // Krill.
    dc.hostT.krill -= dt;
    if (dc.hostT.krill <= 0 && !quiet) {
        dc.hostT.krill = DC_TUNE.krillEvery[leg] * (0.8 + Math.random() * 0.4) / crowd;
        const t = dcHostPick(0.7);
        if (t) dcEmit({ k: "kk", id: dc.nextId++, tg: t.id, arr: 2.2 });
    }
    for (let i = 0; i < dc.krill.length; i++) {
        const k = dc.krill[i];
        const r = dc.riders[k.tg];
        if (k.phase === "gone") continue;
        if (!r) { dcEmit({ k: "kx", id: k.id, why: "lost" }); continue; }
        if (k.phase === "fly" && dc.simT >= k.arriveAt) {
            const bc = dcActiveBeacon();
            const sh = dcShieldOf(r.id);
            if (bc && Math.abs(bc.z - r.z) < 60 * DC_SEG) dcEmit({ k: "kx", id: k.id, why: "decoy", by: bc.by });
            else if (sh) dcEmit({ k: "kx", id: k.id, why: "bounce", by: sh.by });
            else if (r.down > 0 || r.home || dcInTunnel(r.z)) dcEmit({ k: "kx", id: k.id, why: "lost" });
            else dcEmit({ k: "kl", id: k.id, n: 3 });
        } else if (k.phase === "latch") {
            const sh = dcShieldOf(r.id);
            if (sh) { dcEmit({ k: "kx", id: k.id, why: "bounce", by: sh.by }); continue; }
            if (r.down > 0) { dcEmit({ k: "kx", id: k.id, why: "lost" }); continue; }
            if (dcInTunnel(r.z) || r.home) { dcEmit({ k: "kx", id: k.id, why: "scrape" }); continue; }
            if (k.dying) continue;
            // A rammer rips krill off herself and anyone she passes.
            for (const rid in dc.rams) {
                const rr = dc.riders[rid];
                if (rr && dcRamming(rid) && Math.abs(rr.z - r.z) < 6 * DC_SEG) { dcEmit({ k: "kx", id: k.id, why: "rip", by: rid }); break; }
            }
            if (k.phase === "gone") continue;
            const held = dc.simT - k.latchT;
            if (dcCarrying(r) && held > DC_TUNE.steal) {
                // They tear the case loose.
                dcEmit({ k: "kx", id: k.id, why: "steal" });
                dcHostDrop(r.z, r.x, r.id, "krill", r.v);
            } else if (!dcCarrying(r) && held > DC_TUNE.steal) {
                // Nothing to steal: they drag the rider down.
                dcEmit({ k: "kx", id: k.id, why: "bite" });
            }
        }
    }

    dcHostCase(dt);
}

function dcHostShieldOwner() {
    for (const id in dc.shields) {
        const s = dc.shields[id];
        if (s.until > dc.simT && s.by === id && dc.riders[id] && dc.riders[id].down <= 0) return id;
    }
    return "";
}

// The host's share of a cast: everything that hunts riders.
function dcHostAbility(m) {
    const near = function (id, segs) { const r = dc.riders[id]; return r && Math.abs(r.z - m.z) < segs * DC_SEG; };
    const ringIn = function (b, a, c) {
        const z = b.phase === "lock" ? b.z : dcBeamAim(b).z;
        return z > m.z + a * DC_SEG && z < m.z + c * DC_SEG;
    };
    const liveBeams = dc.beams.filter(function (b) { return b.phase !== "gone" && !b.safe; });
    const liveKrill = dc.krill.filter(function (k) { return k.phase !== "gone"; });
    if (m.a === "gunner") {
        liveBeams.forEach(function (b) { if (near(b.tg, 30) || ringIn(b, -10, 90)) dcEmit({ k: "bx", id: b.id, why: "shot", by: m.by }); });
        // Greer's seekers chase every krill near the convoy, latched or still diving.
        liveKrill.forEach(function (k) { if (near(k.tg, DC_FIRE_KRILL)) dcEmit({ k: "kx", id: k.id, why: "shot", by: m.by, d: 0.4 }); });
    } else if (m.a === "scout") {
        liveBeams.forEach(function (b) { if (near(b.tg, 40) || ringIn(b, -10, 130)) dcEmit({ k: "bx", id: b.id, why: "jam", by: m.by }); });
        liveKrill.forEach(function (k) { if (near(k.tg, 45)) dcEmit({ k: "kx", id: k.id, why: "scatter", by: m.by }); });
    } else if (m.a === "engineer") {
        const bc = dc.beacons[dc.beacons.length - 1];
        liveBeams.forEach(function (b) { dcEmit({ k: "bl", id: b.id, z: Math.round(bc.z), x: bc.x, safe: 1, by: m.by, dt: 0.7 }); });
        liveKrill.forEach(function (k) { if (near(k.tg, 45)) dcEmit({ k: "kx", id: k.id, why: "decoy", by: m.by }); });
    } else if (m.a === "bulwark") {
        const r = dc.riders[m.by];
        if (r) liveBeams.forEach(function (b) {
            dcEmit({ k: "bl", id: b.id, z: Math.round(r.z + r.v * 0.8), x: +r.x.toFixed(3), soak: m.by, dt: 0.8 });
        });
        liveKrill.forEach(function (k) { if (k.tg === m.by || k.tg === m.ally) dcEmit({ k: "kx", id: k.id, why: "bounce", by: m.by }); });
    } else if (m.a === "butcher") {
        liveKrill.forEach(function (k) { if (k.phase === "latch" && near(k.tg, 6)) dcEmit({ k: "kx", id: k.id, why: "rip", by: m.by }); });
    }
}

// ---------------------------------------------------
//   THE CASE (host)
// ---------------------------------------------------
function dcCaseState(holder) {
    return { holder: holder, z: DC_START_SEGS * 0.5 * DC_SEG, x: 0, pips: DC_TUNE.pips, lying: 0, over: false };
}

function dcEmitCase() {
    const c = dc.caseS;
    dcEmit({ k: "cs", h: c.holder || "", z: Math.round(c.z), x: +c.x.toFixed(3), v: Math.round(c.v || 0), p: c.pips, l: +c.lying.toFixed(2), o: c.over ? 1 : 0, leg: dc.leg });
}

let dcCaseBeat = 0;
function dcHostCase(dt) {
    const c = dc.caseS;
    if (c.over) return;
    if (c.holder) {
        const h = dc.riders[c.holder];
        if (!h) { dcHostDrop(c.z, c.x, c.holder, "left"); return; }
        c.z = h.z; c.x = h.x;
        const leg = dcLegAt(c.z);
        if (leg > dc.leg) {
            dcEmit({ k: "cp", leg: leg });
            c.pips = Math.min(DC_TUNE.pips, c.pips + 1);
            dcEmitCase();
            // Where a lost case sends the convoy back to (Ry 2026-11-25).
            if (leg < 3) dc.hostSnap = { leg: leg, pips: c.pips, holder: c.holder };
        }
        if (leg >= 3 && h.home && !dc.finale) { dcEmit({ k: "fin", by: h.id }); }
    } else {
        // Left behind by every rider (nobody can ride back): it tumbles on
        // into the road ahead of the last rider. It still costs pips lying.
        let rear = Infinity;
        for (const id in dc.riders) if (!dc.riders[id].home) rear = Math.min(rear, dc.riders[id].z);
        if (rear === Infinity) rear = c.z;
        if (c.v <= 0 && rear > c.z + 3 * DC_SEG) {
            c.behind = (c.behind || 0) + dt;
            if (c.behind > 1.5) { c.behind = 0; c.z = rear + 14 * DC_SEG; c.x = 0; c.v = 0; dcEmitCase(); }
        } else c.behind = 0;
        c.lying += dt;
        if (c.lying >= 5) {
            c.lying -= 5;
            c.pips -= 1;
            dc.pipLog.push("lying@" + Math.floor(c.z / DC_SEG));
            dcEmitCase();
            if (c.pips <= 0) { dcHostRoundLost(); return; }
        }
    }
    dcCaseBeat -= dt;
    if (dcCaseBeat <= 0) { dcCaseBeat = 1; dcEmitCase(); }
    dcHostFinale();
}

// A dropped case skids on down the road from the carrier's speed, so the
// riders behind (and the carrier, remounting) ride up on it.
function dcHostDrop(z, x, by, why, v) {
    const c = dc.caseS;
    if (!c || c.over || c.holder !== by || dc.rrAt) return;
    c.holder = null;
    c.z = z + 1.5 * DC_SEG;
    c.v = Math.min(DC_CRUISE, (v || 0) * 0.55);
    c.behind = 0;
    c.x = dcClamp(x + (Math.random() - 0.5) * 0.5, -0.8, 0.8);
    c.pips -= 1;
    c.lying = 0;
    dc.pipLog.push(why + "@" + Math.floor(z / DC_SEG));
    dcEmitCase();
    if (c.pips <= 0) dcHostRoundLost();
}

function dcHostGrab(by) {
    const c = dc.caseS;
    if (!c || c.over || c.holder || !dc.riders[by]) return;
    c.holder = by;
    c.lying = 0;
    dcEmitCase();
    dcEmit({ k: "cr", to: by, pts: 100, f: "grabs", l: "GOT IT" });
}

// THE ROUND IS LOST (Ry 2026-11-25: "just restarting from that round"): the
// case hit zero, so the host sends everyone back to the start of the round
// they are on, with the pips and the holder it had when the round began.
// The attract run still just ends.
function dcHostRoundLost() {
    if (dc.demo || (dc.restarts || 0) >= DC_RESTARTS) { dcHostEnd(false); return; }
    if (dc.rrAt) return;
    const s = dc.hostSnap || { leg: 0, pips: DC_TUNE.pips, holder: null };
    const h = s.holder && dc.riders[s.holder] ? s.holder : dc.me.id;
    // Hold the restart while the crash plays out on every screen (Ry 2026-11-26:
    // "I would still like to see the death animation/crash").
    dc.rrMsg = { k: "rr", leg: s.leg, p: s.pips, h: h, n: (dc.restarts || 0) + 1 };
    dc.rrAt = dc.simT + DC_RR_HOLD;
    dcEmit({ k: "rp" });
}

// The end: the host freezes the numbers so every screen shows the same card.
function dcHostEnd(won) {
    const c = dc.caseS;
    if (c.over) return;
    c.over = true;
    dcEmitCase();
    const rows = [];
    for (const id in dc.riders) {
        const r = dc.riders[id];
        rows.push({ id: id, name: r.name, color: r.color, role: r.role, pts: r.pts, c: r.contrib, home: r.home ? 1 : 0 });
    }
    rows.sort(function (a, b) { return b.pts - a.pts; });
    const homeN = rows.filter(function (r) { return r.home; }).length;
    const bonus = won ? 10000 + 1000 * Math.max(0, c.pips) + DC_HOME_BONUS * homeN : 0;
    let team = dc.team + bonus;
    rows.forEach(function (r) { team += r.pts; });
    dcEmit({ k: "end", won: won ? 1 : 0, team: team, bonus: bonus, cps: dc.team, pips: Math.max(0, c.pips), rows: rows });
}

// ---------------------------------------------------
//   EVERY CLIENT: timers on what the host started
// ---------------------------------------------------
function dcHazardsUpdate(dt) {
    const c = dc.caseS;
    if (c && !c.holder && c.v > 0) { c.z += c.v * dt; c.v = Math.max(0, c.v - 6000 * dt); }
    for (let i = 0; i < dc.beams.length; i++) {
        const b = dc.beams[i];
        if (b.phase === "lock" && dc.simT >= b.impactAt) dcBeamImpact(b);
    }
    dc.beams = dc.beams.filter(function (b) { return b.phase !== "gone"; });
    dc.krill = dc.krill.filter(function (k) { return k.phase !== "gone"; });
    dc.beacons = dc.beacons.filter(function (b) { return b.until > dc.simT - 0.5; });
    // Mines popped by a pulse or a burst go off as the wave reaches them.
    for (let i = 0; i < dc.hazards.length; i++) {
        const h = dc.hazards[i];
        if (h.type !== "dust") continue;
        for (let m = 0; m < h.mines.length; m++) {
            const mn = h.mines[m];
            if (mn.st === "pop" && mn.popT !== undefined && !mn.fx && dc.simT >= mn.popT) {
                mn.fx = 1;
                dcBurstExplosion(mn.seg * DC_SEG, mn.x, DC_COL.amber, 0.5);
                if (!dc.demo) dcSnd.minePop(dcVolAt(mn.seg * DC_SEG));
            }
        }
    }
    // Latched krill chatter on my bike.
    if (dc.me && dc.me.krill > 0 && !dc.demo && Math.random() < dt * 8) dcSnd.krillChitter();
}

// A static hazard changed (a mine set off, a barricade smashed or plowed).
function dcOnHazard(m) {
    const h = dcHazardById(m.id);
    if (!h) return;
    if (m.m !== undefined && h.mines && h.mines[m.m]) {
        const mn = h.mines[m.m];
        if (mn.st === "pop") return;
        mn.st = "pop"; mn.fx = 1;
        const big = m.st === "boom";
        dcBurstExplosion(mn.seg * DC_SEG, mn.x, big ? DC_COL.magenta : DC_COL.amber, big ? 1 : 0.5);
        if (!dc.demo) (big ? dcSnd.mine : dcSnd.minePop)(dcVolAt(mn.seg * DC_SEG));
        return;
    }
    if (h.st === m.st) return;
    h.st = m.st;
    if (m.st === "gone") {
        dcBurstDebris(h.seg * DC_SEG, h.gapX);
        if (!dc.demo) dcSnd.smash(dcVolAt(h.seg * DC_SEG));
    }
}
