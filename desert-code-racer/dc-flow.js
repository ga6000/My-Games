// ===================================================
//   Desert Code Racer — boot flow, the run, the aftermath, the card, the loop
// ===================================================
// LOAD -> TITLE (BOOTFLOW.intro) -> the chapter crawl -> READY (the border
// and the ready squares, with the attract run behind them) -> PLAY ->
// AFTERMATH (3.5 s of the world going on) -> the result card -> PARTY.
//
// AFTERMATH: shared/party.js has no aftermath option (checked 2026-11-17),
// so the game holds the world for DC_AFTERMATH seconds itself, then shows
// its own card (team score + contributions), then hands over to
// PARTY.finish() when the hub opened it.
"use strict";

const DC_AFTERMATH = 3.5;
const DC_BOT = dcFlag("bot");
let dcRunning = true;
let dcLastTs = 0;
let dcPaused = false;
let dcCardTimer = 0;

function dcBoot() {
    if (typeof SFX !== "undefined") { SFX.configure({ game: DC_GAME }); SFX.unlockOn(window, dcAbort.signal); }
    dcInputInit();
    dcRenderInit();
    dcPanelInit();
    const ident = typeof MP !== "undefined" ? MP.identity() : { name: "" };
    const name = ident.name || "RIDER";
    const color = typeof IDENTITY !== "undefined" ? IDENTITY.colorFromName(name) : DC_COL.hot;
    dc.me = dcNewRider("solo", name, color, dcMyRole(), true);
    dc.riders[dc.me.id] = dc.me;
    dc.track = dcBuildTrack();
    dc.hazards = dcBuildHazards(dc.track);
    dcNetConnect();
    dcAdoptIdentity();
    requestAnimationFrame(dcFrame);

    const intro = function () {
        dcCrawl(function () { dcEnterReady(); });
    };
    if (typeof BOOTFLOW !== "undefined") {
        BOOTFLOW.intro({
            game: DC_GAME,
            title: "DESERT CODE RACER",
            chapter: "ACT IV · LAUNCH",
            tagline: "COMMS ARE DOWN. CARRY THE CODES.",
            loadReady: function () { return dcNet.ready; }
        }, intro);
    } else intro();
}

// ---------------------------------------------------
//   READY: the border, the squares, the attract run behind
// ---------------------------------------------------
function dcReadyPlayers() {
    if (!dcOnline()) return [{ id: "solo", name: dc.me.name, color: dc.me.color, self: true }];
    const list = [{ id: MP.selfId, name: MP.selfName || dc.me.name, color: MP.selfColor || dc.me.color, self: true }];
    MP.peers().forEach(function (p) { list.push({ id: p.id, name: p.name, color: p.color }); });
    return list;
}

function dcEnterReady() {
    dcHideCard();
    dc.mode = "ready";
    dcStartWorld(true);
    // Tests: ?bot=1 alone starts at once; in a room the ready check still runs.
    if ((DC_BOT || dcFlag("autostart")) && !dcOnline()) { trackTimeout(function () { if (dc.mode === "ready") dcStartRun(false); }, 400); return; }
    if (typeof BOOTFLOW === "undefined") { dcStartRun(false); return; }
    BOOTFLOW.ready({
        players: dcReadyPlayers,
        send: function (m) { if (dcOnline()) MP.send(m); },
        onStart: function () { dcStartRun(false); },
        joinLive: function () { return dcOnline() && dcNet.peerRun; },
        onUnlock: dcAudioInit,
        label: "DEMO · NOT LIVE"
    });
}

function dcOnGo(m, from) {
    if (dc.me && from === dc.me.id) return;
    if (dc.mode === "ready" && typeof BOOTFLOW !== "undefined" && BOOTFLOW.readyOpen()) BOOTFLOW.forceStart();
}

// A fresh world from the room seed. demo: the attract run (the bot rides,
// this client is its own host, nothing is relayed).
function dcStartWorld(demo) {
    dc.demo = demo;
    dc.track = dcBuildTrack();
    dc.hazards = dcBuildHazards(dc.track);
    dc.beams = []; dc.krill = []; dc.beacons = []; dc.fx = []; dc.texts = []; dc.attacks = []; dc.finale = null;
    dc.shields = {}; dc.rams = {};
    dc.leg = 0; dc.team = 0; dc.result = null; dc.cpSeen = {};
    dc.simT = 0;
    dc.crashLog = [];
    dc.pipLog = [];
    dc.hostT = { beam: 5, krill: 13, atk: 14 };
    // Keep me and the riders the server knows; reset me to the start line.
    for (const id in dc.riders) if (!dc.riders[id].local && demo) delete dc.riders[id];
    for (const id in dc.riders) { dc.riders[id].home = 0; dc.riders[id].slide = 0; }
    const ids = Object.keys(dc.riders).sort();
    const lanes = [-0.45, 0.45, -0.15, 0.15];
    const lane = lanes[Math.max(0, ids.indexOf(dc.me.id)) % 4];
    dcResetRider(dc.me, DC_START_SEGS * 0.5 * DC_SEG, demo ? 0 : lane);
    dc.me.v = demo ? DC_CRUISE * 0.6 : 0;
    if (demo || dcIsHost()) dc.caseS = dcCaseState(dc.me.id);
    else if (dc.caseS && dc.caseS.over) dc.caseS = null;
}

function dcStartRun(joining) {
    if (dc.mode === "play") return;
    const live = dcOnline() && dcNet.peerRun && !dcIsHost();
    dcStartWorld(false);
    dc.mode = "play";
    dcAdoptIdentity();
    dc.me.role = dcMyRole();
    if (live || joining) {
        // A late joiner drops in behind the convoy.
        let back = null;
        for (const id in dc.riders) { const r = dc.riders[id]; if (!r.local && (back === null || r.z < back)) back = r.z; }
        if (back !== null) dc.me.z = Math.max(dc.me.z, back - 20 * DC_SEG);
        dc.caseS = null;
    }
    if (dcIsHost() && !live) {
        dc.caseS = dcCaseState(dc.me.id);
        dcEmitCase();
        dcEmit({ k: "go" });
    }
    dc.restarts = 0; dc.tally = null;
    dc.hostSnap = { leg: 0, pips: DC_TUNE.pips, holder: dc.caseS ? dc.caseS.holder : dc.me.id };
    dcRoundSnap(0);
    dcMusic.start();
    dcSnd.go();
    dcBanner("GO", DC_COL.amber);
}

// ---------------------------------------------------
//   ROUNDS (Ry 2026-11-25): three of about a minute. Rounds 1 and 2 end at
//   a checkpoint inside a mountain tunnel; a lost case restarts the round.
// ---------------------------------------------------
function dcRoundSnap(L) {
    const me = dc.me;
    dc.roundSnap = { leg: L, team: dc.team, score: dcTeamScore(), pts: me ? me.pts : 0,
                     contrib: me ? JSON.parse(JSON.stringify(me.contrib)) : null };
}

// Round 1 restarts on the start line; rounds 2 and 3 inside the checkpoint
// tunnel that began them, past the gate, so the restart is calm.
function dcRoundStartZ(L) {
    if (L === 0 || !dc.track.cpTun[L - 1]) return DC_START_SEGS * 0.5 * DC_SEG;
    return (dc.track.cpTun[L - 1].b - 70) * DC_SEG;
}

function dcOnRoundRestart(m) {
    if (dc.mode !== "play" || !dc.track || !dc.me) return;
    const L = m.leg;
    dc.restarts = m.n || (dc.restarts || 0) + 1;
    dc.leg = L;
    dc.tally = null;
    for (const k in dc.cpSeen) if (+k > L) delete dc.cpSeen[k];
    const snap = dc.roundSnap && dc.roundSnap.leg === L ? dc.roundSnap : null;
    if (snap) dc.team = snap.team;
    // This round's road is fresh again: barricades stand, mines are buried.
    const a = L === 0 ? 0 : dc.track.legStart[L] - 80, b = dc.track.cpSeg[L];
    for (let i = 0; i < dc.hazards.length; i++) {
        const h = dc.hazards[i];
        if (h.seg < a || h.seg > b) continue;
        h.st = ""; h.reveal = 0;
        if (h.mines) h.mines.forEach(function (mn) { mn.st = ""; mn.fx = 0; });
    }
    dc.beams.length = 0; dc.krill.length = 0; dc.attacks.length = 0; dc.beacons.length = 0;
    dc.shields = {}; dc.rams = {}; dc.finale = null;
    dc.hostT = { beam: 6, krill: 12, atk: 12 };
    const z = dcRoundStartZ(L);
    const ids = Object.keys(dc.riders).sort();
    const lanes = [-0.45, 0.45, -0.15, 0.15];
    const me = dc.me;
    const pts = snap ? snap.pts : me.pts;
    const contrib = snap && snap.contrib ? JSON.parse(JSON.stringify(snap.contrib)) : me.contrib;
    dcResetRider(me, z, lanes[Math.max(0, ids.indexOf(me.id)) % 4]);
    me.pts = pts; me.contrib = contrib;
    me.v = L === 0 ? 0 : DC_CRUISE * 0.7;
    me.inv = 2.5;
    for (const id in dc.riders) {
        const r = dc.riders[id];
        if (r.local) continue;
        r.z = z; r.tz = z; r.down = 0; r.home = 0; r.slide = 0; r.krill = 0; r.flyH = 0;
    }
    const c = dc.caseS;
    if (c) {
        c.holder = dc.riders[m.h] ? m.h : me.id; c.pips = m.p; c.lying = 0; c.over = false; c.v = 0; c.behind = 0;
        c.z = z; c.x = 0;
        if (dcIsHost()) dcEmitCase();
    }
    if (!dc.demo) {
        dcSnd.pipLost();
        dcShake(12);
        const left = DC_RESTARTS - dc.restarts;
        dcBanner("ROUND " + (L + 1) + " AGAIN  " + (left > 0 ? left + (left === 1 ? " RESTART LEFT" : " RESTARTS LEFT") : "LAST CHANCE"), DC_COL.magenta);
    }
}

// ---------------------------------------------------
//   THE END
// ---------------------------------------------------
function dcOnEnd(m) {
    if (dc.demo) {
        // The attract run loops.
        trackTimeout(function () { if (dc.demo && dc.mode === "ready") dcStartWorld(true); }, 2500);
        return;
    }
    if (dc.result) return;
    dc.result = m;
    dc.mode = "aftermath";
    dc.aftermathT = m.won ? 2 : DC_AFTERMATH;      // a win has already had its finale
    dcMusic.stop();
    const c = dc.caseS;
    if (m.won) {
        dcSnd.win();
        dcBanner("CODES DELIVERED", DC_COL.cyan);
    } else {
        dcSnd.lose();
        dcBanner("CODES LOST", DC_COL.magenta);
        if (c) { dcBurstExplosion(dcCaseZ() || c.z, c.x, DC_COL.amber, 2); dcShake(18); }
    }
}

function dcShowResult() {
    const m = dc.result;
    dc.mode = "result";
    dcEngineStop();
    if (typeof HUBSCORE !== "undefined") HUBSCORE.best(DC_GAME + "-team", m.team);
    const el = document.getElementById("dcCard");
    const fmt = function (n) { return typeof HUBSCORE !== "undefined" ? HUBSCORE.format(n) : String(n); };
    const pad = function (n) { return typeof HUBSCORE !== "undefined" ? HUBSCORE.pad6(n) : String(n); };
    const meId = dc.me ? dc.me.id : "";
    const rows = (m.rows || []).map(function (r) {
        const a = DC_ABILITY[r.role] || { crew: r.name };
        const c = r.c || {};
        return "<tr" + (r.id === meId ? " class='me'" : "") + "><td><span class='dot' style='background:" + dcEsc(r.color) + "'></span>" +
            dcEsc(a.crew) + " <small>" + dcEsc(r.name) + "</small></td>" +
            "<td class='n'>" + fmt(Math.round(c.carry || 0)) + "</td><td class='n'>" + (c.solves || 0) + "</td>" +
            "<td class='n'>" + (c.revives || 0) + "</td><td class='n'>" + (c.beams || 0) + "</td><td class='n'>" + (c.krill || 0) + "</td>" +
            "<td class='n'>" + (c.grabs || 0) + "</td><td class='n'>" + (c.crashes || 0) + "</td><td class='n pts'>" + fmt(r.pts) + "</td></tr>";
    }).join("");
    const hub = typeof PARTY !== "undefined" && PARTY.wanted();
    el.innerHTML = "<div class='card-box'><div class='kick'>ACT IV · LAUNCH · " + (DC_DIFF === "casual" ? "CASUAL" : "HARDCORE") + "</div>" +
        "<h2 class='" + (m.won ? "won" : "lost") + "'>" + (m.won ? "CODES DELIVERED" : "CODES LOST") + "</h2>" +
        "<div class='sub'>TEAM SCORE</div><div class='score' id='dcCardScore'>" + pad(0) + "</div>" +
        "<div class='bonus'>CHECKPOINTS " + fmt(m.cps || 0) + (m.won ? " · CLEAR " + fmt(10000) + " · CASE " + m.pips + " × 1,000" : "") + "</div>" +
        "<table><tr><th>CREW</th><th class='n'>CARRIED M</th><th class='n'>SOLVED</th><th class='n'>REVIVES</th><th class='n'>BEAMS</th>" +
        "<th class='n'>KRILL</th><th class='n'>GRABS</th><th class='n'>CRASHES</th><th class='n'>PTS</th></tr>" + rows + "</table>" +
        "<div class='btns'>" + (hub ? "<button type='button' id='dcCardGo'>CONTINUE <span id='dcCardCount'>8</span></button>"
            : "<button type='button' id='dcCardAgain'>PLAY AGAIN</button>") + "</div></div>";
    el.hidden = false;
    // The score ticks up, the way a cabinet tallies a bonus.
    const steps = 16;
    let i = 0;
    const tick = trackInterval(function () {
        i++;
        const n = document.getElementById("dcCardScore");
        if (!n) { clearInterval(tick); return; }
        n.textContent = pad(i >= steps ? m.team : Math.floor(m.team * i / steps / 10) * 10);
        dcSnd.tick();
        if (i >= steps) clearInterval(tick);
    }, 70);
    if (hub) {
        let left = 8;
        const go = function () { clearInterval(dcCardTimer); dcHideCard(); PARTY.finish({ score: m.team, cleared: !!m.won, game: DC_GAME }); };
        document.getElementById("dcCardGo").addEventListener("click", go);
        dcCardTimer = trackInterval(function () {
            left--;
            const c = document.getElementById("dcCardCount");
            if (c) c.textContent = String(Math.max(0, left));
            if (left <= 0) go();
        }, 1000);
    } else {
        const again = document.getElementById("dcCardAgain");
        again.addEventListener("click", function () { dcEnterReady(); });
        try { again.focus(); } catch (e) { /* not focusable yet */ }
    }
}

function dcHideCard() {
    const el = document.getElementById("dcCard");
    if (el) { el.hidden = true; el.innerHTML = ""; }
}

// ---------------------------------------------------
//   THE LOOP
// ---------------------------------------------------
function dcFrame(ts) {
    if (!dcRunning) return;
    requestAnimationFrame(dcFrame);
    const dt = dcLastTs ? Math.min(0.05, (ts - dcLastTs) / 1000) : 0;
    dcLastTs = ts;
    if (!dcPaused) {
        let left = dt * (dcOnline() ? 1 : DC_TIMESCALE);
        let guard = 0;
        while (left > 0.0001 && guard++ < 40) {
            const step = Math.min(1 / 60, left);
            dcStep(step);
            left -= step;
        }
    }
    try { dcRender(); } catch (e) { console.error("dcRender", e); dcRunning = false; throw e; }
    dcPanelUpdate();
    dcEngineUpdate(dc.me);
    dcNetTick();
}

function dcStep(dt) {
    const live = dc.mode === "play" || dc.mode === "aftermath" || (dc.demo && (dc.mode === "ready" || dc.mode === "crawl" || dc.mode === "boot"));
    if (!live || !dc.me) return;
    dc.simT += dt;
    const inp = (dc.demo || DC_BOT || dc.devBot) ? dcBotThink(dc.me) : dcReadInput();
    dcRiderUpdate(dc.me, inp, dt);
    for (const id in dc.riders) { const r = dc.riders[id]; if (!r.local) dcRemoteUpdate(r, dt); }
    if (dcIsHost()) dcHostUpdate(dt);
    dcHazardsUpdate(dt);
    dcAttacksUpdate(dt);
    dcFinaleUpdate();
    dcFxUpdate(dt);
    if (dc.mode === "play" && !dc.demo && typeof PARTY !== "undefined") PARTY.live(dcTeamScore());
    if (dc.mode === "aftermath") {
        dc.aftermathT -= dt;
        if (dc.aftermathT <= 0) dcShowResult();
    }
}

// ---------------------------------------------------
//   THE GAMEINSTANCE CONTRACT (GAME_PROTOTYPE_INSTRUCTIONS §2) and teardown
// ---------------------------------------------------
function dcDestroy() {
    dcRunning = false;
    dcClearTimers();
    dcAbort.abort();
    dcEngineStop();
    dcMusic.stop();
    if (typeof MP !== "undefined") MP.destroy();
    if (typeof BOOTFLOW !== "undefined") BOOTFLOW.destroy();
}

window.GameInstance = {
    init: function () { /* boots on load */ },
    start: function () { if (dc.mode === "ready") dcStartRun(false); },
    pause: function () { if (!dcOnline()) dcPaused = true; },
    resume: function () { dcPaused = false; },
    destroy: dcDestroy,
    getState: function () {
        return { mode: dc.mode, leg: dc.leg, team: dcTeamScore(), role: dc.me && dc.me.role, pips: dc.caseS ? dc.caseS.pips : null,
            holder: dc.caseS ? dc.caseS.holder : null, result: dc.result };
    }
};

dcBoot();
