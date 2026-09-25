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
 * (SUPERSEDED 2026-09-20: there is no "I finished" event any more, and
 * the race is per level -- see THE RACE IS PER LEVEL below.)
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

/**
 * THE RACE IS PER LEVEL, AND IT NO LONGER ENDS THE RUN (2026-09-20).
 *
 * The report: "in a multiplayer session from the hub, players can't get past
 * the first level and the Restart button just comes up." With anyone else in
 * the room the tunnel was the FINISH LINE -- finishRace() -> recordFinish() ->
 * showMessage(..., isGameOver = true) -- and Restart is a reload, back to level
 * 1 of the same seed. A hub launch puts the whole group in one room, so every
 * racer's run ended at level 1. The 2026-09-07 fix below (racingOthers)
 * rescued the player alone in a room; it left a group exactly where the solo
 * player had been.
 *
 * Now the tunnel is a stage gate for everyone, and a run ends only on death,
 * the same as solo. The race is read off the LEVEL each racer is on: `pos`
 * carries `s`, a rival's `s` going up is a level clear (the feed), and your
 * placing on a level is one plus the rivals already deeper than it. The "I
 * finished" event is gone -- `s` says the same thing, on a packet that was
 * already going out at 15Hz.
 *
 * Still parallel worlds: level N is built from baseSeed + N * 7919 on every
 * client, so a ghost on your level is in your streets. A ghost on any other
 * level is in another city, and is not drawn.
 *
 * REMOVED with the finish line, not left dangling: raceStartTime, raceFinished,
 * finishOrder, recordFinish(), standingsText(), finishRace(). raceStartTime
 * was written in three files and read only by finishRace(). The rival
 * "ESCAPED -- keep going!" box went too: it was the HTML message box on a raw
 * setTimeout(hideMessage, 3000), and with levels advancing it would have
 * popped up over the game every time anyone cleared anything.
 */
const NET_SEND_MS = 66;             // ~15Hz
const REMOTE_TIMEOUT_MS = 6000;

let netOnline = false;
let mpReady = false;
let ghosts = {};                    // peerId -> {x,y,z,stage,name,color,cores,lastSeen}
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
 *
 * 2026-09-20: this NO LONGER DECIDES THE TUNNEL -- the tunnel is a stage gate
 * for everyone now (see THE RACE IS PER LEVEL above). The question is still the
 * right one, it just gates less: whether there is a race board to draw and a
 * placing to announce.
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
        // The level (2026-09-20). It is what makes a ghost drawable -- only a
        // rival on YOUR level is in your city -- and it is the whole race.
        s: currentStage,
        c: MP.selfColor, n: collectedCount
    });
}

/**
 * A rival's position packet. Moved here from gc-boot.js's onMessage
 * (2026-09-20), because it does race bookkeeping now as well as ghosting.
 *
 * A missing `s` is a client from before 2026-09-20 -- which could never leave
 * level 1 with anyone else in the room, so reading it as 1 is not a guess.
 */
function receiveGhostPos(msg, fromId, fromName) {
    const prev = ghosts[fromId];
    const stage = (typeof msg.s === "number" && msg.s > 0) ? msg.s : 1;
    // A new level is a new city: SNAP to the new spawn rather than sliding the
    // ghost across a map it is no longer on.
    const fresh = !prev || prev.stage !== stage;
    ghosts[fromId] = {
        name: fromName || "racer",
        color: msg.c,
        z: msg.z,
        stage: stage,
        cores: msg.n || 0,
        // Interpolate between the 15Hz updates rather than
        // teleporting the ghost every frame.
        x: fresh ? msg.x : prev.x,
        y: fresh ? msg.y : prev.y,
        tx: msg.x, ty: msg.y,
        lastSeen: Date.now()
    };
    // Their level went UP: they cleared one. Reported as the level just
    // below where they are now, which is also right when a throttled tab
    // skipped a packet window and the step is more than one.
    //
    // A rival who dies and restarts does NOT come through here as a drop: a
    // restart is a reload, a reload is a new socket, and a new socket is a new
    // peer id -- so `prev` is undefined and nothing is announced.
    if (prev && stage > prev.stage) {
        pushRaceFeed((fromName || "racer") + " cleared level " + (stage - 1), msg.c);
    }
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
        // Another level is another city (2026-09-20). A level-3 ghost drawn in
        // level-2 streets walks through walls that do not exist where it is.
        if (g.stage !== currentStage) continue;

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

/**
 * ===================================================
 *   THE RACE BOARD AND FEED  (2026-09-20)
 * ===================================================
 * These replace recordFinish()'s game-over box and its "ESCAPED" pop-up.
 *
 *   board  under the minimap: every racer's level, deepest first, plus anyone
 *          in the room who is not running (start menu, game-over box). Only
 *          with company -- alone, a one-row board just repeats STAGE.
 *   feed   bottom centre, a few seconds per line: "ALICE CLEARED LEVEL 2",
 *          and your own "1ST OUT OF LEVEL 2".
 *
 * NO TIMERS. A feed line is a timestamp and an age test, the same way the wave
 * burst is. Screen space: render() calls drawRaceBoard() after the camera
 * restore, beside the rest of the furniture.
 */
const RACE_FEED_MS = 2600;
const RACE_FEED_MAX = 3;
let raceFeed = [];                  // [{text, color, at}], newest last

function pushRaceFeed(text, color) {
    raceFeed.push({ text: String(text).toUpperCase(), color: color || INK.hot, at: performance.now() });
    if (raceFeed.length > RACE_FEED_MAX) raceFeed.shift();
}

function gcOrdinal(n) {
    const teen = n % 100 >= 11 && n % 100 <= 13;
    return n + (teen ? "TH" : (["TH", "ST", "ND", "RD"][n % 10] || "TH"));
}

/**
 * Called at the tunnel, BEFORE triggerNextStage(): the placing is counted
 * against the level being LEFT, and triggerNextStage() increments it.
 *
 * Placing is LIVE STANDINGS, not a ledger -- one plus the rivals already on a
 * deeper level. A rival who died and restarted is back on level 1 and is not
 * ahead of you any more, which is the honest answer to "where am I in this
 * race". A no-op alone: first out of one is not a race.
 */
function noteLevelCleared(stage) {
    if (!racingOthers()) return;
    let ahead = 0;
    for (const id in ghosts) {
        if (!Object.prototype.hasOwnProperty.call(ghosts, id)) continue;
        if (ghosts[id].stage > stage) ahead++;
    }
    pushRaceFeed(gcOrdinal(ahead + 1) + " out of level " + stage, MP.selfColor);
}

function raceBoardRows() {
    const rows = [{ name: "YOU", color: MP.selfColor, stage: currentStage, cores: collectedCount, self: true }];
    const seen = Object.create(null);
    for (const id in ghosts) {
        if (!Object.prototype.hasOwnProperty.call(ghosts, id)) continue;
        const g = ghosts[id];
        seen[id] = true;
        rows.push({ name: g.name, color: g.color, stage: g.stage, cores: g.cores, self: false });
    }
    // In the room, not sending -- on the start menu, or looking at a game-over
    // box. Listed but unranked (stage 0), so the board is the whole room.
    let peers = [];
    try { peers = (typeof MP.peers === "function" && MP.peers()) || []; } catch (e) { peers = []; }
    for (let i = 0; i < peers.length; i++) {
        const p = peers[i];
        if (!p || seen[p.id]) continue;
        rows.push({ name: p.name || "racer", color: p.color, stage: 0, cores: 0, self: false });
    }
    // Deepest first; on the same level, whoever has picked up more of it.
    rows.sort(function (a, b) {
        return (b.stage - a.stage) || (b.cores - a.cores) || ((b.self ? 1 : 0) - (a.self ? 1 : 0));
    });
    return rows;
}

function drawRaceBoard() {
    const now = performance.now();
    while (raceFeed.length && now - raceFeed[0].at >= RACE_FEED_MS) raceFeed.shift();

    const font = getComputedStyle(document.body).getPropertyValue('--font-ui') || 'monospace';
    ctx.save();
    ctx.textBaseline = 'middle';

    if (racingOthers()) {
        const rows = raceBoardRows();
        const size = TOTAL_CELLS * MINIMAP_CELL;
        const x = canvas.width - size - MINIMAP_PAD;
        // Below the minimap AND below the (WELL OPEN) readout, which owns the
        // strip under it for the back half of every level. Fixed rather than
        // following it, so the board does not jump when the well opens.
        let y = MINIMAP_PAD + size + 52;
        const rowH = 16;
        const h = rowH * (rows.length + 1);

        ctx.globalAlpha = 0.9;
        ctx.fillStyle = 'rgba(0,0,0,0.72)';
        ctx.fillRect(x - 2, y - 2, size + 4, h + 4);
        ctx.strokeStyle = INK.dim;
        ctx.lineWidth = 1;
        ctx.strokeRect(x - 2.5, y - 2.5, size + 5, h + 5);

        ctx.globalAlpha = 1;
        ctx.font = '10px ' + font;
        ctx.fillStyle = INK.mid;
        ctx.textAlign = 'left';
        ctx.fillText('RACE', x + 4, y + rowH / 2);
        y += rowH;

        ctx.font = 'bold 12px ' + font;
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i];
            // Identity colour, the one the ghost is drawn in, so a name on the
            // board and a shape in the street are visibly the same person.
            ctx.globalAlpha = r.stage ? 1 : 0.45;
            ctx.fillStyle = r.color || INK.hot;
            ctx.textAlign = 'left';
            ctx.fillText((r.self ? '▸ ' : '  ') + String(r.name).toUpperCase().slice(0, 10), x + 2, y + rowH / 2);
            ctx.textAlign = 'right';
            ctx.fillText(r.stage ? 'L' + r.stage : '—', x + size - 4, y + rowH / 2);
            y += rowH;
        }
    }

    // The feed, newest lowest. Backed, because it lands on whatever part of
    // the city happens to be at the bottom of the screen.
    ctx.font = 'bold 14px ' + font;
    ctx.textAlign = 'center';
    let fy = canvas.height - 30;
    for (let i = raceFeed.length - 1; i >= 0; i--) {
        const f = raceFeed[i];
        const age = (now - f.at) / RACE_FEED_MS;
        const a = age < 0.7 ? 1 : Math.max(0, (1 - age) / 0.3);
        const w = ctx.measureText(f.text).width + 18;
        ctx.globalAlpha = a * 0.7;
        ctx.fillStyle = '#000';
        ctx.fillRect(canvas.width / 2 - w / 2, fy - 10, w, 20);
        ctx.globalAlpha = a;
        ctx.fillStyle = f.color;
        ctx.fillText(f.text, canvas.width / 2, fy);
        fy -= 22;
    }

    ctx.restore();
    ctx.globalAlpha = 1;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
}

