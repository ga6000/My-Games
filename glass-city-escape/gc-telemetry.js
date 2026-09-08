/**
 * Glass City Escape — the run log (2026-09-06)
 *
 * Added by the Stepwell pass, GCE_STEPWELL_PASS_PLAN.md §10. Its whole purpose
 * is to answer "is this too hard?" with measurements from real play instead of
 * with an opinion formed by driving the game from a console.
 *
 * ---------------------------------------------------------------------------
 * THREE CONSTRAINTS SHAPED THE DESIGN, AND THEY ARE WHY IT LOOKS LIKE THIS
 * ---------------------------------------------------------------------------
 * 1. It must survive `file://`. So: no server, no fetch, no file writes --
 *    localStorage and a textarea the player can copy out of.
 * 2. It must survive a reload, because a run ends and the page reloads to
 *    restart (the Restart button is `location.reload()`).
 * 3. THE OUTPUT MUST BE PASTEABLE. A five-minute run is ~18,000 frames; nobody
 *    is pasting an event stream into a chat window. So every run is reduced to
 *    AGGREGATES as it happens, and the log holds at most TELEMETRY_MAX_RUNS of
 *    them. The whole dump for a long session is a few kilobytes of JSON.
 *
 * What the aggregates are chosen to answer, specifically:
 *   - do deaths cluster on melee or on beams?          -> damage.melee / .beam
 *   - do they cluster on a FLOOR?                      -> deathZ, floorsVisited
 *     (a pile of deaths at z>0 says the cross-floor audio warning is failing)
 *   - is a hunt escapable in practice?                 -> huntsEscaped vs spotted
 *   - is the tuning tight or loose?                    -> hpLow across runs
 *   - is the dash a traversal verb or a death sentence -> dashes vs dashFalls
 *
 * Every entry point is wrapped. A telemetry bug must never be able to end a
 * run, which would corrupt the very thing it is measuring.
 *
 * Classic script, one shared global scope. Declarations only; gc-boot.js calls
 * gcTelemetryStartRun().
 */
"use strict";

const TELEMETRY_KEY = "gce_telemetry_v1";
const TELEMETRY_MAX_RUNS = 40;

let gcRun = null;          // the run in progress, or null between runs
// The panel PAUSES the simulation (gameLoop bails on this). Reading a
// difficulty report while the city keeps hunting you would corrupt the very
// run the report is about.
//
// 2026-09-07: this used to be OUR OWN #log-panel, opened with a bare L. That
// overlay is gone -- the run log now rides in the shared L+G dev panel
// (shared/devtools.js, registered by gc-dev.js), which shows the same summary,
// carries the same copyable payload, and adds the playtest buttons. The flag
// kept its name because gameLoop's pause branch reads it and the meaning did
// not change: something modal is up, do not advance the world.
let gcLogOpen = false;

function gcTelemetryBlankRun() {
    return {
        started: Date.now(),
        ms: 0,
        stage: 1,
        stagesCleared: 0,
        cores: 0,            // picked up
        deposited: 0,        // actually delivered to a pedestal -- the real one
        blips: 0,
        points: 0,
        coresNeeded: 0,
        maxZ: 0,
        floorsVisited: {},          // z -> frames spent there
        framesAboveGround: 0,
        frames: 0,
        hpLow: MAX_HEALTH,
        damage: { melee: 0, beam: 0, fall: 0 },
        hits: { melee: 0, beam: 0, fall: 0 },
        meleeWhiffed: 0,
        spotted: 0,
        huntsEscaped: 0,
        peakHunters: 0,
        dashes: 0,
        dashFalls: 0,
        ended: null,
        endedBy: null,
        deathZ: null
    };
}

function gcTelemetryStartRun() {
    try {
        gcRun = gcTelemetryBlankRun();
        gcRun.coresNeeded = totalCollectibles;
    } catch (e) { gcRun = null; }
}

/**
 * Per-frame sampling. Cheap on purpose: this runs 60 times a second, so it
 * counts and compares and does nothing else -- no allocation, no stringify, no
 * storage write. Storage is touched exactly once per run, at the end.
 */
function gcTelemetryFrame() {
    if (!gcRun || !gameRunning) return;
    try {
        gcRun.frames++;
        const z = player.z;
        gcRun.floorsVisited[z] = (gcRun.floorsVisited[z] || 0) + 1;
        if (z > 0) gcRun.framesAboveGround++;
        if (z > gcRun.maxZ) gcRun.maxZ = z;
        if (player.health < gcRun.hpLow) gcRun.hpLow = player.health;

        let hunters = 0;
        for (let i = 0; i < entities.length; i++) {
            if (entities[i].state === 'hunt') hunters++;
        }
        if (hunters > gcRun.peakHunters) gcRun.peakHunters = hunters;
    } catch (e) { /* never break a frame for a counter */ }
}

// src: 'melee' | 'beam' | 'fall'
function gcTelemetryDamage(src, amount) {
    if (!gcRun) return;
    try {
        if (!(src in gcRun.damage)) return;
        gcRun.damage[src] += amount;
        gcRun.hits[src]++;
    } catch (e) { /* ignore */ }
}

function gcTelemetryEvent(what) {
    if (!gcRun) return;
    try {
        if (what === 'spotted') gcRun.spotted++;
        else if (what === 'escaped') gcRun.huntsEscaped++;
        else if (what === 'whiff') gcRun.meleeWhiffed++;
        else if (what === 'dash') gcRun.dashes++;
        else if (what === 'dashFall') gcRun.dashFalls++;
        else if (what === 'core') gcRun.cores++;
        else if (what === 'deposit') gcRun.deposited++;
        else if (what === 'blip') gcRun.blips++;
        else if (what === 'stage') {
            gcRun.stagesCleared++;
            gcRun.stage = currentStage;
            gcRun.coresNeeded = totalCollectibles;
        }
    } catch (e) { /* ignore */ }
}

/**
 * Closes the run and writes it. Called from showMessage(..., isGameOver=true),
 * the single choke point every ending passes through.
 *
 * The gcRun = null at the end is what makes this idempotent: showMessage can be
 * reached twice in a frame (a bolt and a fall landing together), and without it
 * the same run would be written twice and skew every average I read off it.
 */
function gcTelemetryEndRun(reason) {
    if (!gcRun) return;
    try {
        gcRun.ms = Date.now() - gcRun.started;
        gcRun.stage = currentStage;
        gcRun.points = gcScore;
        gcRun.ended = new Date().toISOString().slice(0, 19).replace('T', ' ');
        gcRun.endedBy = String(reason || 'unknown');
        gcRun.deathZ = player.z;

        const all = gcTelemetryLoad();
        all.push(gcRun);
        while (all.length > TELEMETRY_MAX_RUNS) all.shift();
        gcTelemetrySave(all);
    } catch (e) { /* ignore */ }
    gcRun = null;
}

function gcTelemetryLoad() {
    try {
        const raw = window.localStorage.getItem(TELEMETRY_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        return Array.isArray(parsed) ? parsed : [];
    } catch (e) { return []; }
}

function gcTelemetrySave(runs) {
    try { window.localStorage.setItem(TELEMETRY_KEY, JSON.stringify(runs)); }
    catch (e) { /* private mode, quota, disabled storage -- the game plays on */ }
}

function gcTelemetryClear() {
    try { window.localStorage.removeItem(TELEMETRY_KEY); } catch (e) { /* ignore */ }
    return "cleared";
}

/**
 * The numbers I actually read. Derived rather than stored, so an older log
 * written before a summary field existed still summarises correctly.
 */
function gcTelemetrySummary(runs) {
    const n = runs.length;
    if (!n) return { runs: 0 };

    const sum = (f) => runs.reduce((a, r) => a + (f(r) || 0), 0);
    const byCause = {};
    const deathFloors = {};
    runs.forEach(r => {
        byCause[r.endedBy] = (byCause[r.endedBy] || 0) + 1;
        if (r.deathZ !== null && r.deathZ !== undefined) {
            deathFloors["z" + r.deathZ] = (deathFloors["z" + r.deathZ] || 0) + 1;
        }
    });

    const dmg = { melee: sum(r => r.damage && r.damage.melee),
                  beam:  sum(r => r.damage && r.damage.beam),
                  fall:  sum(r => r.damage && r.damage.fall) };
    const totalDmg = dmg.melee + dmg.beam + dmg.fall || 1;
    const totalMs = sum(r => r.ms) || 1;
    const frames = sum(r => r.frames) || 1;

    return {
        runs: n,
        medianRunSec: +(runs.map(r => r.ms).sort((a, b) => a - b)[Math.floor(n / 2)] / 1000).toFixed(1),
        avgRunSec: +(totalMs / n / 1000).toFixed(1),
        bestStage: Math.max.apply(null, runs.map(r => r.stage || 1)),
        stagesClearedTotal: sum(r => r.stagesCleared),
        coresPerRun: +(sum(r => r.cores) / n).toFixed(1),
        // Picked up vs actually delivered. A gap between these two is the
        // clearest possible signal that the carry leg is too dangerous: it
        // means cores are being found and then lost with the player.
        depositedPerRun: +(sum(r => r.deposited) / n).toFixed(1),
        blipsPerRun: +(sum(r => r.blips) / n).toFixed(1),
        bestPoints: Math.max.apply(null, runs.map(r => r.points || 0)),
        avgPoints: Math.round(sum(r => r.points) / n),
        endedBy: byCause,
        deathFloor: deathFloors,
        // The headline ratio: where is the damage actually coming from?
        damageShare: {
            melee: Math.round(100 * dmg.melee / totalDmg) + "%",
            beam:  Math.round(100 * dmg.beam  / totalDmg) + "%",
            fall:  Math.round(100 * dmg.fall  / totalDmg) + "%"
        },
        damagePerMinute: +(totalDmg / (totalMs / 60000)).toFixed(1),
        avgHpLow: +(sum(r => r.hpLow) / n).toFixed(1),
        spottedPerMinute: +(sum(r => r.spotted) / (totalMs / 60000)).toFixed(1),
        // Below ~0.4 means being seen is effectively a death sentence.
        huntEscapeRate: +(sum(r => r.huntsEscaped) / (sum(r => r.spotted) || 1)).toFixed(2),
        meleeWhiffRate: +(sum(r => r.meleeWhiffed) /
                          ((sum(r => r.meleeWhiffed) + sum(r => r.hits && r.hits.melee)) || 1)).toFixed(2),
        peakHuntersMax: Math.max.apply(null, runs.map(r => r.peakHunters || 0)),
        dashes: sum(r => r.dashes),
        dashFallRate: +(sum(r => r.dashFalls) / (sum(r => r.dashes) || 1)).toFixed(2),
        timeAboveGround: Math.round(100 * sum(r => r.framesAboveGround) / frames) + "%"
    };
}

// Console entry point: gcDumpLog()
function gcDumpLog() {
    const runs = gcTelemetryLoad();
    return { summary: gcTelemetrySummary(runs), runs: runs };
}

/**
 * The run log as display lines, for whoever is drawing it.
 *
 * 2026-09-07: this WAS gcShowLog(), which built these same lines and poked
 * them into a #log-panel this game owned. The panel moved to
 * shared/devtools.js so all four active games share one, so what is left here
 * is the part that was actually about telemetry -- deciding which numbers are
 * worth a line and how to phrase them. gcHideLog() and gcCopyLog() went with
 * the panel; the shared one owns closing and copying now.
 */
function gcLogSummaryLines() {
    const s = gcTelemetrySummary(gcTelemetryLoad());
    const lines = [];
    if (!s.runs) {
        lines.push("No runs recorded yet — play one through to a death or an escape.");
        return lines;
    }
    lines.push("runs " + s.runs + "   median " + s.medianRunSec + "s   best level " + s.bestStage +
               "   best score " + s.bestPoints);
    lines.push("cores found " + s.coresPerRun + "/run, delivered " + s.depositedPerRun +
               "   blips " + s.blipsPerRun);
    lines.push("damage  melee " + s.damageShare.melee + "  beam " + s.damageShare.beam +
               "  fall " + s.damageShare.fall + "   (" + s.damagePerMinute + " hp/min)");
    lines.push("spotted " + s.spottedPerMinute + "/min   escaped " + s.huntEscapeRate +
               "   avg lowest HP " + s.avgHpLow + "/20");
    lines.push("dashes " + s.dashes + "   fell on " + s.dashFallRate +
               "   time above ground " + s.timeAboveGround);
    lines.push("ended by: " + JSON.stringify(s.endedBy));
    lines.push("death floor: " + JSON.stringify(s.deathFloor));
    return lines;
}
