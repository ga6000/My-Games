// ===================================================
//   Desert Code Racer — co-op over shared/mp-core.js (the room relay)
// ===================================================
// NET MODEL (DCR_SLICE_PLAN.md):
//   - each client owns its bike and relays it ("p", ~10 a second)
//   - the host owns the case, beam/krill spawns, locks and latches, the
//     checkpoints and the final result (dc-hazards.js)
//   - static road hazards come from the room seed; their state changes are
//     relayed as events ("hz", and the deterministic "ab" casts)
//   - only MP.send relays: no new server message types
//
// ONE PATH FOR EVERY EVENT. dcEmit(msg) applies msg locally through
// dcHandle() and relays it to the room; a relayed msg arrives in dcHandle()
// too. So solo and online run the same code, and the host is just the
// client whose dcHandle() also acts on requests ("drop", "grab", "shake").
"use strict";

const dcNet = { ready: false, solo: true, lastPos: 0, lastCt: 0, peerRun: false };

function dcEmit(msg) {
    dcHandle(msg, dc.me ? dc.me.id : "solo");
    if (dcOnline() && !dc.demo) MP.send(msg);
}

function dcHandle(m, from) {
    if (!m || typeof m.k !== "string") return;
    // During the attract run only the local demo talks to itself.
    switch (m.k) {
        case "p": dcOnPos(m, from); return;
        case "ct": { const r = dc.riders[from]; if (r && !r.local) { r.contrib = m.c || r.contrib; r.pts = m.pt || r.pts; } return; }
        case "ab": if (dc.mode === "play" || dc.demo) dcApplyAbility(m); return;
        case "hz": dcOnHazard(m); return;
        case "bm": dcOnBeamSpawn(m); return;
        case "bl": dcOnBeamLock(m); return;
        case "bx": dcOnBeamGone(m); return;
        case "kk": dcOnKrillSpawn(m); return;
        case "kl": dcOnKrillLatch(m); return;
        case "kx": dcOnKrillGone(m); return;
        case "crash": {
            const r = dc.riders[from];
            if (r && !r.local) {
                r.down = r.downMax = DC_TUNE.respawn; r.crashKind = m.w || "barricade"; r.crashSide = m.sd || 1;
                dcBurstExplosion(m.z, m.x, r.color, 1); if (!dc.demo) dcSnd.beamImpact(dcVolAt(m.z) * 0.6);
            }
            return;
        }
        case "ax": dcOnAttack(m); return;
        case "axx": dcOnAttackGone(m); return;
        case "fin": dcOnFinale(m); return;
        case "home": { const r = dc.riders[from]; if (r && !r.local && !r.home) { r.z = Math.max(r.z, dc.track.finish * DC_SEG); } return; }
        case "cr": if (dc.me && m.to === dc.me.id) dcCredit(m.pts || 0, m.f || null, 1, m.l || ""); return;
        case "cs": dcOnCase(m); return;
        case "cp": dcOnCheckpoint(m); return;
        case "end": dcOnEnd(m); return;
        case "go": dcOnGo(m, from); return;
        // Requests only the host acts on.
        case "drop": if (dcIsHost()) dcHostDrop(m.z, m.x, m.by || from, "crash", m.v); return;
        case "grab": if (dcIsHost()) dcHostGrab(m.by || from); return;
        case "shake":
            if (dcIsHost()) {
                const k = dcFindKrill(m.id);
                if (k && k.phase === "latch") {
                    const left = k.n - (m.n || 1);
                    if (left <= 0) dcEmit({ k: "kx", id: k.id, why: "shake" });
                    else dcEmit({ k: "kl", id: k.id, n: left });
                }
            }
            return;
        default: return;
    }
}

// ---- the case, as the host last said ----
function dcOnCase(m) {
    const prev = dc.caseS || {};
    const c = dc.caseS = dc.caseS || {};
    const was = prev.holder;
    c.holder = m.h || null;
    if (!c.holder) { c.z = m.z; c.x = m.x; c.v = m.v || 0; }
    else { const h = dc.riders[c.holder]; c.z = h ? h.z : m.z; c.x = h ? h.x : m.x; }
    const pipsBefore = c.pips;
    c.pips = m.p; c.lying = m.l; c.over = !!m.o;
    if (typeof m.leg === "number" && m.leg > dc.leg) dc.leg = m.leg;
    if (dc.demo) return;
    const me = dc.me ? dc.me.id : "";
    if (c.holder && c.holder !== was) {
        if (c.holder === me) { dcSnd.casePickup(); dcBanner("YOU HAVE THE CODES", DC_COL.amber); }
        else { const h = dc.riders[c.holder]; dcBanner((h ? h.name : "A RIDER") + " HAS THE CODES", DC_COL.amber); }
    }
    if (!c.holder && was) { dcSnd.caseDrop(); dcBanner("CODES DOWN", DC_COL.magenta); }
    if (typeof pipsBefore === "number" && c.pips < pipsBefore && !c.over) dcSnd.pipLost();
}

function dcOnCheckpoint(m) {
    if (m.leg <= dc.leg && dc.leg > 0 && dc.cpSeen && dc.cpSeen[m.leg]) return;
    dc.cpSeen = dc.cpSeen || {};
    if (dc.cpSeen[m.leg]) return;
    dc.cpSeen[m.leg] = 1;
    dc.leg = Math.max(dc.leg, m.leg);
    if (m.leg >= 3) return;                         // the finish is the end card's, not a checkpoint
    dc.team += 1000;
    if (dc.demo) return;
    dcSnd.checkpoint();
    dcBanner(DC_LEG_NAMES[m.leg], DC_COL.cyan);
    dcToastAtMe(1000, "CHECKPOINT");
}

// ---- positions ----
function dcOnPos(m, from) {
    if (dc.me && from === dc.me.id) return;
    let r = dc.riders[from];
    if (!r) {
        const peer = dcPeerInfo(from);
        r = dc.riders[from] = dcNewRider(from, peer.name, peer.color, m.r, false);
        r.z = m.z; r.tz = m.z; r.x = m.x;
    }
    r.role = DC_ABILITY[m.r] ? m.r : r.role;
    r.tz = m.z; r.tx = m.x; r.v = m.v;
    r.air = m.a || 0;
    r.flyH = m.fh || 0;
    if (!(r.down > 0 && m.d > 0)) r.down = m.d || 0;      // keep our own crash clock for the animation
    r.boosting = !!m.b;
    r.pts = m.pt || 0;
    r.krill = m.kr || 0;
    r.seen = dcNow();
    if (m.run) dcNet.peerRun = true;
}

function dcPeerInfo(id) {
    const list = (typeof MP !== "undefined" && MP.peers) ? MP.peers() : [];
    for (let i = 0; i < list.length; i++) if (list[i].id === id) return list[i];
    return { name: "RIDER", color: (typeof IDENTITY !== "undefined") ? IDENTITY.colorFromName("RIDER") : DC_COL.hot };
}

function dcNetTick() {
    if (!dcOnline() || dc.demo || !dc.me) return;
    const r = dc.me;
    if (MP.canSend("dc-pos", 100)) {
        MP.send({ k: "p", z: Math.round(r.z), x: +r.x.toFixed(3), v: Math.round(r.v), a: +Math.max(0, r.air).toFixed(2), fh: r.fly ? Math.round(r.fy - dcRoadY(r.z)) : 0,
            d: +Math.max(0, r.down).toFixed(2), b: r.boosting ? 1 : 0, r: r.role, pt: r.pts, kr: r.krill,
            run: dc.mode === "play" ? 1 : 0 });
    }
    if (MP.canSend("dc-ct", 1000)) MP.send({ k: "ct", c: r.contrib, pt: r.pts });
}

// ---- connection ----
function dcNetConnect() {
    if (typeof MP === "undefined") { dcNet.ready = true; return; }
    MP.connect({
        game: DC_GAME,
        onReady: function (info) {
            dcNet.ready = true;
            dcNet.solo = info.solo;
            dcAdoptIdentity();
        },
        onStatus: function () { dcAdoptIdentity(); },
        onPeerSync: function () { dcAdoptIdentity(); },
        onPeerJoin: function (p) {
            if (!dc.riders[p.id]) { dc.riders[p.id] = dcNewRider(p.id, p.name, p.color, "", false); dc.riders[p.id].seen = -1; }
        },
        onPeerLeave: function (p) {
            delete dc.riders[p.id];
            if (dcIsHost() && dc.caseS && dc.caseS.holder === p.id && !dc.caseS.over) {
                dc.caseS.holder = p.id;     // so the drop below is accepted
                dcHostDrop(dc.caseS.z, dc.caseS.x, p.id, "left");
            }
        },
        onHostChange: function (now) {
            if (now && dc.mode === "play") dcBanner("YOU ARE THE HOST", DC_COL.cyan);
        },
        onMessage: function (payload, from) {
            if (typeof BOOTFLOW !== "undefined" && BOOTFLOW.onMessage(payload, from)) return;
            if (dc.demo && payload && payload.k !== "p" && payload.k !== "go") return;
            dcHandle(payload, from);
        }
    });
}

// The server's identity wins once it answers; until then IDENTITY's
// fallback (mp-core does that). Re-key the local rider to the socket id.
function dcAdoptIdentity() {
    const r = dc.me;
    if (!r || typeof MP === "undefined") return;
    const id = dcSelfId();
    if (r.id !== id) {
        delete dc.riders[r.id];
        r.id = id;
        dc.riders[id] = r;
        if (dc.caseS && dc.caseS.holder === "solo") dc.caseS.holder = id;
    }
    r.name = MP.selfName || r.name || "RIDER";
    if (MP.selfColor) r.color = MP.selfColor;
    else if (typeof IDENTITY !== "undefined") r.color = IDENTITY.colorFromName(r.name);
}
