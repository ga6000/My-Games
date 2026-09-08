/**
 * Glass City Escape — multiplayer (ghosts, seed, race finish)
 *
 * Split out of glass_city_escape.html's inline script 2026-09-04 (Pass A of
 * glass-city-escape/GCE_PASS_PLAN.md). The lines below were MOVED VERBATIM --
 * Pass A deliberately changed no behaviour, so that any regression could be
 * attributed to the skin pass that followed rather than to the split.
 *
 * Classic scripts, one shared global scope, no modules (the file:// hard
 * constraint). Declarations only. The MP.connect() CALL lives in gc-boot.js -- see there for why.
 */
"use strict";

/**
 * ===================================================
 *   MULTIPLAYER — RACE MODE
 * ===================================================
 * Everyone runs the SAME seeded city (see the MP.random() calls through
 * generateWorld / spawnCollectibles) and races to be first through the
 * escape tunnel.
 *
 * Deliberately the lightest sync model of any game in this repo: there
 * is no shared world state at all. Each racer collects their own cores,
 * opens their own tunnel, and fights their own robots -- the only thing
 * on the wire is "where is everyone" plus a single "I finished" event.
 * Nothing can desync, because nothing is shared beyond the layout, and
 * the layout comes from the seed rather than from messages.
 *
 * Consequence worth knowing: robots start identically on every client
 * (their spawn placement is seeded) but their patrol AI is client-local
 * and drifts apart within seconds. So you may watch a rival's ghost
 * take a hit from a robot that isn't there on your screen. For a race
 * that's a fair trade -- robots are an obstacle course, not a shared
 * simulation, and syncing ~30 patrolling bots at 15Hz would cost more
 * bandwidth than the entire rest of this game combined.
 */
const NET_SEND_MS = 66;             // ~15Hz
const REMOTE_TIMEOUT_MS = 6000;

let netOnline = false;
let mpReady = false;
let ghosts = {};                    // peerId -> {x,y,z,name,color,cores,lastSeen}
let raceStartTime = 0;
let raceFinished = false;
let finishOrder = [];               // [{name, ms, self}]
let baseSeed = null;

// Each stage needs a DIFFERENT city, but the same different city on
// every client. Deriving the stage seed from the room seed plus the
// stage number gives both: solo players still get a fresh layout each
// stage, and racers still agree with each other.
function seedForStage() {
    if (baseSeed === null) baseSeed = MP.seed();
    MP.reseed((baseSeed + currentStage * 7919) | 0);
}


function rebuildWorldFromSeed() {
    entities = [];
    // Same reset as triggerNextStage(): the seed rebuild replaces the whole
    // city, so anything indexed against the old one has to go with it.
    gcLasers.length = 0;
    pursuitField = null;
    pursuitAnchor = -1;
    gcShards.length = 0;
    minimapCache = null;
    generateWorld();
    spawnLevelContents();
    const sp = spawnPoint();
    player.x = sp.x;
    player.y = sp.y;
    player.z = 0;
    player.isFalling = false;
    player.scale = 1.0;
    player.carrying = 0;
    updateFloorUI(0);
    raceStartTime = performance.now();
}

/**
 * IS THERE ANYONE TO RACE? (2026-09-07)
 *
 * THE BUG THIS FIXES, because it was flagged twice and left alone twice, and
 * both times that was the wrong call:
 *
 *   if (netOnline && !raceFinished) finishRace();
 *   else if (!netOnline) triggerNextStage();
 *
 * `netOnline` is TRUE THE MOMENT THE SOCKET OPENS. It does not mean "someone
 * else is here", it means "the server answered". So a player alone in a room --
 * which is every ordinary session, because the server is up -- reached the
 * tunnel at the end of level 1, took the RACE branch, and got a game-over box
 * with a Restart button. **Levels 2 and up were unreachable in normal play.**
 * The endless progression the whole level curve was built for could only be
 * seen by killing the server first.
 *
 * It was documented as "surprising" in CLAUDE.md and as critique point 9 in
 * GCE_HUNT_PASS_PLAN.md, deferred as a loop-design decision nobody had asked
 * for. It is not a design decision; it is a mode check asking the wrong
 * question. A race needs RIVALS, not a socket.
 *
 * peers() is the authority -- it is the room roster the server maintains.
 * `ghosts` is the fallback for the window between a peer joining and mp-core
 * telling us: anyone who has broadcast a position is definitely present.
 */
function racingOthers() {
    if (!netOnline) return false;
    try {
        if (typeof MP.peers === "function") {
            const p = MP.peers();
            if (p && p.length > 0) return true;
        }
    } catch (e) { /* fall through to the ghost check */ }
    for (const id in ghosts) {
        if (Object.prototype.hasOwnProperty.call(ghosts, id)) return true;
    }
    return false;
}

function broadcastPosition() {
    if (!netOnline || !gameRunning) return;
    if (!MP.canSend("pos", NET_SEND_MS)) return;
    MP.send({
        k: "pos",
        x: Math.round(player.x), y: Math.round(player.y), z: player.z,
        c: MP.selfColor, n: collectedCount
    });
}

function updateGhosts() {
    const now = Date.now();
    for (const id in ghosts) {
        if (!Object.prototype.hasOwnProperty.call(ghosts, id)) continue;
        if (now - ghosts[id].lastSeen > REMOTE_TIMEOUT_MS) { delete ghosts[id]; continue; }
        const g = ghosts[id];
        g.x += (g.tx - g.x) * 0.35;
        g.y += (g.ty - g.y) * 0.35;
    }
}

function drawGhosts(z, isCurrent) {
    for (const id in ghosts) {
        if (!Object.prototype.hasOwnProperty.call(ghosts, id)) continue;
        const g = ghosts[id];
        if (g.z !== z) continue;

        ctx.save();
        // Rivals render translucent so they read as "someone else over
        // there" rather than competing with your own player for
        // attention on a busy screen.
        ctx.globalAlpha = isCurrent ? 0.55 : 0.15;
        ctx.translate(g.x, g.y);

        ctx.fillStyle = g.color || '#00ffff';
        ctx.shadowColor = g.color || '#00ffff';
        ctx.shadowBlur = 12;
        ctx.beginPath();
        ctx.arc(0, 0, 12, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;

        if (isCurrent) {
            ctx.globalAlpha = 0.9;
            ctx.fillStyle = '#ffffff';
            ctx.font = '11px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(g.name + '  ' + g.cores, 0, -20);
        }
        ctx.restore();
    }
    ctx.globalAlpha = 1.0;
}

function recordFinish(name, ms, isSelf) {
    if (finishOrder.some(function (f) { return f.name === name; })) return;
    finishOrder.push({ name: name, ms: ms, self: isSelf });
    finishOrder.sort(function (a, b) { return a.ms - b.ms; });

    const place = finishOrder.findIndex(function (f) { return f.name === name; }) + 1;
    const secs = (ms / 1000).toFixed(1);

    if (isSelf) {
        raceFinished = true;
        showMessage(
            place === 1 ? "YOU WON" : "FINISHED — #" + place,
            "Escaped in " + secs + "s\n" + standingsText(),
            true
        );
    } else if (!raceFinished) {
        // Someone else got out first -- say so, but let this player keep
        // running for their own placing rather than ending their race.
        showMessage(name + " ESCAPED", "#" + place + " in " + secs + "s — keep going!");
        setTimeout(hideMessage, 3000);
    }
}

function standingsText() {
    return finishOrder.map(function (f, i) {
        return (i + 1) + ". " + f.name + "  " + (f.ms / 1000).toFixed(1) + "s";
    }).join("\n");
}

function finishRace() {
    const ms = Math.round(performance.now() - raceStartTime);
    if (netOnline) MP.send({ k: "finish", ms: ms });
    recordFinish(MP.selfName || "you", ms, true);
}

