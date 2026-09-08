// ===================================================
//   RD Arena -- networking
// ===================================================
// MP_ROLLOUT.md steps 2-4, built 2026-09-08. Read MP_BUILD_NOTES.md first: it
// records where this departs from the method, and why.
//
// Model: HOST-AUTHORITATIVE WORLD, client-owned players.
//
//  - Exactly one client is the HOST. It alone spawns enemies, runs their AI,
//    runs the round clock and owns the kill count. Everyone else renders what
//    it sends. Two clients spawning from their own RNG diverge in seconds.
//  - Each client owns its own player completely: position, HP, death, respawn,
//    cards, gun upgrades. Nobody is ever corrected on their own player. There
//    is deliberately no down/up/dead protocol -- see MP_BUILD_NOTES.md.
//  - The reaction-diffusion field is simulated by EVERYONE and corrected toward
//    the host once a second by the 133^2 2-bit packet (rd-netfield.js).
//    Collision keeps reading the fine 400^2 field.
//
// This file installs itself by assigning into RDHOOKS (rd-core.js). It is never
// called from the game loop by name. Delete the one <script> tag in RDArena.html
// and the defaults take over and this is a single-player game again -- that is
// the invariant the whole design protects.
//
// The WebSocket server is in a separate repo and cannot be changed
// (GAME_PROTOTYPE_INSTRUCTIONS.md 3), so everything below rides mp-core's
// generic `relay`. No new server message type exists or can.
"use strict";

// ---------------------------------------------------
//   FLAGS -- MP_ROLLOUT.md 1
// ---------------------------------------------------
// Three independently togglable parts, because three separate things could be
// what hurts gameplay feel and "turn multiplayer off" cannot tell you which.
// Feel judgements need an A/B inside ONE session on ONE field, seconds apart --
// a code revert compares across reloads, different RD seeds and different
// rounds, and so answers nothing.
//
//   NET.hostSim     off -> every client sims enemies and rounds locally again
//                          (suspect if enemies rubber-band or shoot from stale
//                          positions)
//   NET.resync      off -> no field corrections are applied
//                          (suspect if walls visibly pop or snap)
//   NET.carveEvents off -> carves stay local, holes only arrive with the field
//                          (suspect if holes appear late or in the wrong place)
//
// F9 all-off / all-on, F10 resync only, F11 host-sim only. F8 belongs to the
// render-field toggle in rd-netfield.js.
const NET = {
    enabled: true,
    hostSim: true,
    resync: true,
    carveEvents: true,
    debug: false
};

const NET_SEND_MS = 66;             // ~15Hz, matching zombie
const NET_FIELD_MS = 1000;          // the packet cadence NET_FIELD_NOTES.md picked
const REMOTE_TIMEOUT_MS = 5000;
const RESYNC_GUARD_PX = 90;         // MP_ROLLOUT.md 3.3 -- never resync under a player
const KIND_KEYS = ['grunt', 'heavy'];

let netOnline = false;
let netIsHost = true;               // solo players are their own host
let netSelf = "solo";
let netFieldSeed = null;            // the seed the HOST actually built its field from
let netSeedLatched = false;
let lastFieldAt = 0;

const remotePlayers = {};           // id -> interpolated peer
let remoteBullets = [];             // enemy fire, host-owned, simulated forward locally
const carveQueue = [];              // discrete carves, batched onto the 15Hz beat
const damageQueue = [];             // client -> host hit reports

// What MP_ROLLOUT.md 4 asks to measure. Surfaced through the dev panel rather
// than the console: nobody playtests with DevTools open, which is the whole
// reason shared/devtools.js keeps an error ring buffer.
const netStats = {
    corrected: 0, guarded: 0, packets: 0, bytesIn: 0, bytesOut: 0, lastCorrected: 0
};

// ---------------------------------------------------
//   URL overrides -- so a shortcut can pin a config
// ---------------------------------------------------
(function () {
    let v = null;
    try { v = new URLSearchParams(window.location.search).get('net'); } catch (e) { v = null; }
    if (v === null) return;
    if (v === '0' || v === 'off') NET.enabled = false;
    else if (v === 'nosync') NET.resync = false;
    else if (v === 'nohost') NET.hostSim = false;
    else if (v === 'nocarve') NET.carveEvents = false;
    else if (v === 'debug') NET.debug = true;
})();

function netActive() { return NET.enabled && netOnline; }

// ---------------------------------------------------
//   SESSION
// ---------------------------------------------------
MP.connect({
    game: "rd-arena",

    onReady: function (info) {
        netOnline = !info.solo;
        netIsHost = info.isHost;
        netSelf = info.selfId || "solo";
        applyRoomSeed();
    },

    // The promotion path. onReady fires exactly ONCE, so a client whose socket
    // missed mp-core's 6s connect timeout was handed a solo identity and a
    // field from the throwaway clock seed, and nothing re-ran when the
    // connection landed later. On Render's free tier that is the ORDINARY
    // first-player experience, not a rare race.
    //
    // This hook rather than onStatus: onStatus fires BEFORE mp-core applies the
    // id, host and seed carried on the same message, so it would read a null id.
    onPeerSync: function () {
        netIsHost = MP.isHost();
        if (MP.selfId && MP.selfId !== netSelf) netSelf = MP.selfId;
        applyRoomSeed();
    },

    onHostChange: function (nowHost) {
        // Whoever is promoted carries on from the last snapshot it received, so
        // the arena keeps its enemies rather than emptying. Its flow field is
        // one rebuild behind, which costs the grunts about a quarter second.
        netIsHost = nowHost;
    },

    onPeerLeave: function (peer) {
        if (peer && peer.id) delete remotePlayers[peer.id];
    },

    onStatus: function (s) {
        netOnline = (s === "online");
        if (!netOnline) netIsHost = true;      // dropped to solo -- simulate locally again
    },

    onMessage: function (msg, from) {
        if (!msg || !msg.k || !NET.enabled) return;

        if (msg.k === 'p') { applyPeer(msg, from); return; }

        if (msg.k === 'w') {
            if (netIsHost || !NET.hostSim) return;      // we ARE the authority
            applyWorldSnapshot(msg);
            return;
        }

        if (msg.k === 'f') {
            if (netIsHost || !NET.resync) return;
            applyFieldPacket(msg.d);
            return;
        }

        if (msg.k === 'c') {
            // Discrete carves. Applied through applyCarve, NOT clearRadius --
            // re-entering the choke point would relay the carve straight back
            // out and every client would echo every other client for ever.
            if (!NET.carveEvents) return;
            const list = msg.l || [];
            for (let i = 0; i < list.length; i++) {
                applyCarve(list[i][0], list[i][1], list[i][2], false, true);
            }
            return;
        }

        if (msg.k === 'd' && netIsHost && NET.hostSim) {
            // A client reporting hits on host-owned enemies.
            const list = msg.l || [];
            for (let i = 0; i < list.length; i++) {
                const en = enemyByNetId(list[i][0]);
                if (en) en.hit(list[i][1], list[i][2]);
            }
            return;
        }
    }
});

// The world IS the game here, so two players must not start in two different
// fields (MULTIPLAYER_PLAN.md 2). LATCHED: applied once and never again, which
// is the rule that section added on 2026-09-07 after Zombie wiped a ten-round
// map because a reconnect brought back a different seed and nothing checked
// whether the world was already in play.
function applyRoomSeed() {
    if (netSeedLatched || !netOnline) return;
    if (typeof MP.seed() !== 'number') return;
    netSeedLatched = true;
    netFieldSeed = MP.seed();
    MP.resetRandom();
    seedField(MP.random);
    // Re-carve the starting bubble the game opens under the player at boot.
    applyCarve(worldWidth / 2, worldHeight / 2, 80, false, false);
    rebuildFlowField();
}

function enemyByNetId(id) {
    for (let i = 0; i < enemies.length; i++) if (enemies[i].netId === id) return enemies[i];
    return null;
}

// ---------------------------------------------------
//   PEERS
// ---------------------------------------------------
function applyPeer(msg, from) {
    const id = from || msg.i;
    if (!id || id === netSelf) return;
    const prev = remotePlayers[id];
    remotePlayers[id] = {
        id: id,
        name: msg.n || "",
        color: msg.c || KIND.player.color,
        // Interpolated rather than snapped: at 15Hz a snap reads as a stutter
        // rather than as movement.
        x: prev ? prev.x : msg.x,
        y: prev ? prev.y : msg.y,
        tx: msg.x, ty: msg.y,
        angle: msg.a || 0,
        hp: msg.h || 0,
        maxHp: msg.m || 1,
        dead: !!msg.dd,
        selecting: !!msg.s,
        radius: KIND.player.radius,
        lastSeen: Date.now()
    };
}

function pruneRemotes() {
    const now = Date.now();
    for (const id in remotePlayers) {
        if (now - remotePlayers[id].lastSeen > REMOTE_TIMEOUT_MS) delete remotePlayers[id];
    }
}

// ---------------------------------------------------
//   WORLD SNAPSHOT (host -> clients)
// ---------------------------------------------------
function applyWorldSnapshot(msg) {
    // Enemies are reconciled BY NET ID, not by array index: the host splices
    // dead enemies out mid-frame, so index 7 is a different creature either
    // side of a kill and interpolation targets would jump between bodies.
    const byId = {};
    for (let i = 0; i < enemies.length; i++) byId[enemies[i].netId] = enemies[i];

    const list = msg.e || [];
    const next = [];
    for (let i = 0; i < list.length; i++) {
        const row = list[i];              // [id, x, y, kindIdx, hp]
        const kind = KIND_KEYS[row[3]] || 'grunt';
        let en = byId[row[0]];
        if (!en) {
            en = new Entity(row[1], row[2], kind);
            en.netId = row[0];
        }
        en.tx = row[1];
        en.ty = row[2];
        en.hp = row[4];
        next.push(en);
    }
    enemies = next;

    // Enemy fire, carried WITH VELOCITY so a client can run it forward between
    // snapshots. A bullet moving 13px a frame, interpolated at 15Hz, is a row
    // of dashes rather than a bullet.
    remoteBullets = (msg.b || []).map(function (b) {
        return { x: b[0], y: b[1], vx: b[2], vy: b[3], radius: b[4] || 2, carve: b[5] || 20 };
    });

    const prevKills = kills;
    kills = msg.ki || 0;
    round = msg.r || round;
    roundPhase = msg.rp === 1 ? 'intermission' : 'active';
    roundBudget = msg.rb || 0;
    if (kills > prevKills) checkBioThreshold();

    // The host publishes the seed it ACTUALLY built from, exactly as Zombie
    // does. The server's current seed is not a safe answer to "what field is
    // this room playing?" -- it is reissued when a room is garbage-collected
    // during a disconnect, which mp-core's 3s reconnect timer makes routine.
    if (typeof msg.fs === 'number' && netFieldSeed === null) netFieldSeed = msg.fs;
}

// ---------------------------------------------------
//   FIELD RESYNC -- MP_ROLLOUT.md 3, at the 2026-09-07 format
// ---------------------------------------------------
// Every mitigation in that section is here, and each one is load-bearing:
//   3.1 correct only DISAGREEMENTS -- most cells agree, and a full overwrite
//       would pop the entire screen once a second
//   3.2 land JUST PAST the threshold (0.35/0.25), not at 1/0, so the RD kernel
//       heals the seam over the next few frames instead of leaving a hard edge
//   3.3 never resync within RESYNC_GUARD_PX of a player -- collision is a POINT
//       TEST ON THE ENTITY CENTRE, so a cell going solid under someone traps
//       them where they stand
//   3.5 never touch staticMask or noGrow -- sanctuaries and organ aprons are
//       deterministic from fixed constants, cannot drift, and excluding them
//       costs nothing and removes a pop source
function applyFieldPacket(b64) {
    const levels = RDNET.decode(b64);
    if (!levels) return;
    const res = RDNET.RES;
    const maxLevel = (1 << RDNET.BITS) - 1;
    const T = RDNET.THRESH;
    const guards = RDHOOKS.targets();
    const g2 = RESYNC_GUARD_PX * RESYNC_GUARD_PX;

    let corrected = 0, guarded = 0;
    for (let ny = 0; ny < res; ny++) {
        for (let nx = 0; nx < res; nx++) {
            const hostSolid = (levels[nx + ny * res] / maxLevel) > T;
            const b = RDNET.blockBounds(nx, ny);

            // Our own value for this cell, by the same box filter the host used.
            let sum = 0, n = 0;
            for (let y = b.y0; y < b.y1; y++) {
                for (let x = b.x0; x < b.x1; x++) { sum += gridB[x + y * gridCols]; n++; }
            }
            if (!n) continue;
            if (((sum / n) > T) === hostSolid) continue;          // 3.1

            const cx = (b.x0 + b.x1) * 0.5 * cellSize;
            const cy = (b.y0 + b.y1) * 0.5 * cellSize;
            let near = false;
            for (let i = 0; i < guards.length; i++) {
                const t = guards[i];
                if (!t) continue;
                const dx = t.x - cx, dy = t.y - cy;
                if (dx * dx + dy * dy < g2) { near = true; break; }
            }
            if (near) { guarded++; continue; }                    // 3.3

            for (let y = b.y0; y < b.y1; y++) {
                for (let x = b.x0; x < b.x1; x++) {
                    const i = x + y * gridCols;
                    if (staticMask[i] || noGrow[i]) continue;     // 3.5
                    gridB[i] = hostSolid ? 0.35 : 0.25;           // 3.2
                    gridA[i] = hostSolid ? 0.5 : 1;
                }
            }
            corrected++;
        }
    }

    netStats.lastCorrected = corrected;
    netStats.corrected += corrected;
    netStats.guarded += guarded;
    netStats.packets++;
    netStats.bytesIn += b64.length;
    if (NET.debug) {
        console.log('[rd-net] resync corrected ' + corrected + ' guarded ' + guarded +
                    ' of ' + (res * res) + ' cells');
    }
}

// ---------------------------------------------------
//   HOOKS -- everything above is reached only through these
// ---------------------------------------------------
RDHOOKS.simsWorld = function () {
    if (!netActive() || !NET.hostSim) return true;
    return netIsHost;
};

RDHOOKS.targets = function () {
    if (!netActive()) return [player];
    const out = [player];
    for (const id in remotePlayers) {
        const r = remotePlayers[id];
        if (!r.dead) out.push(r);
    }
    return out;
};

RDHOOKS.carve = function (cx, cy, radius, kind) {
    if (!netActive() || !NET.carveEvents) return;
    // Only DISCRETE carves go on the wire.
    //  - 'spray' is every sanctuary mote on every frame: a flood, not a message
    //  - 'blood' is up to 250 particles a frame during a CORROSION splatter
    // Both are structural and gradual, and the 1s field packet corrects
    // whatever they drift by. A hole punched by a bullet, a dash or a machete
    // is the one a player watches for and notices arriving late, so that is
    // what gets sent.
    if (kind !== 'clear') return;
    carveQueue.push([Math.round(cx), Math.round(cy), Math.round(radius)]);
};

RDHOOKS.damage = function (netId, dmg, angle) {
    if (!netActive()) return;
    damageQueue.push([netId, dmg, +angle.toFixed(2)]);
};

RDHOOKS.tick = function () {
    if (!NET.enabled) return;

    interpolateRemotes();
    updateRemoteBullets();
    pruneRemotes();

    if (!netOnline) return;

    broadcastSelf();
    flushCarves();
    flushDamage();
    if (RDHOOKS.simsWorld()) {
        broadcastWorld();
        broadcastField();
    }
};

function interpolateRemotes() {
    for (const id in remotePlayers) {
        const r = remotePlayers[id];
        r.x += (r.tx - r.x) * 0.35;
        r.y += (r.ty - r.y) * 0.35;
    }
    if (RDHOOKS.simsWorld()) return;
    for (let i = 0; i < enemies.length; i++) {
        const e = enemies[i];
        if (e.tx === undefined) continue;
        e.x += (e.tx - e.x) * 0.35;
        e.y += (e.ty - e.y) * 0.35;
    }
}

// Enemy fire on a client. Run forward locally and resolved against OUR OWN
// player only, because each client owns its own HP. These never carve: the
// host's copy of this bullet already did, and relayed it as a carve event.
function updateRemoteBullets() {
    if (RDHOOKS.simsWorld()) { remoteBullets.length = 0; return; }
    for (let i = remoteBullets.length - 1; i >= 0; i--) {
        const b = remoteBullets[i];
        b.x += b.vx; b.y += b.vy;
        if (b.x < 0 || b.x > worldWidth || b.y < 0 || b.y > worldHeight || isSolid(b.x, b.y)) {
            remoteBullets.splice(i, 1);
            continue;
        }
        if (player.dead) continue;
        const d = Math.hypot(player.x - b.x, player.y - b.y);
        if (cardOffer && d < BUBBLE_R) {
            remoteBullets.splice(i, 1);
            for (let k = 0; k < 3; k++) spawnWallExplosion(b.x, b.y);
            continue;
        }
        if (d < player.radius + b.radius) {
            remoteBullets.splice(i, 1);
            player.hit(1, Math.atan2(b.vy, b.vx));
        }
    }
}

// ---------------------------------------------------
//   BROADCAST
// ---------------------------------------------------
function broadcastSelf() {
    if (!MP.canSend('p', NET_SEND_MS)) return;
    MP.send({
        k: 'p',
        i: netSelf,
        n: MP.selfName || '',
        c: MP.selfColor || KIND.player.color,
        x: Math.round(player.x), y: Math.round(player.y),
        a: +player.angle.toFixed(2),
        h: player.hp, m: player.maxHp,
        dd: player.dead ? 1 : 0,
        s: cardOffer ? 1 : 0
    });
}

function flushCarves() {
    if (carveQueue.length === 0) return;
    if (!MP.canSend('c', NET_SEND_MS)) {
        // Never let the queue grow without bound if sends are being dropped --
        // a dash carves on every frame it is active.
        if (carveQueue.length > 240) carveQueue.splice(0, carveQueue.length - 240);
        return;
    }
    MP.send({ k: 'c', l: carveQueue.splice(0, carveQueue.length) });
}

function flushDamage() {
    if (damageQueue.length === 0) return;
    MP.send({ k: 'd', l: damageQueue.splice(0, damageQueue.length) });
}

function broadcastWorld() {
    if (!MP.canSend('w', NET_SEND_MS)) return;
    // Packed as arrays rather than objects: at the 40-enemy cap that is the
    // difference between a ~1KB and a ~4KB frame, fifteen times a second.
    const eb = [];
    for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        if (b.isPlayerBullet) continue;      // ours are simulated on each client
        eb.push([Math.round(b.x), Math.round(b.y), +b.vx.toFixed(1), +b.vy.toFixed(1),
                 b.radius, b.carve]);
    }
    MP.send({
        k: 'w',
        e: enemies.map(function (e) {
            return [e.netId, Math.round(e.x), Math.round(e.y),
                    KIND_KEYS.indexOf(e.kind), e.hp];
        }),
        b: eb,
        ki: kills,
        r: round,
        rp: roundPhase === 'intermission' ? 1 : 0,
        rb: roundBudget,
        fs: netFieldSeed
    });
}

function broadcastField() {
    if (!NET.resync) return;
    const now = performance.now();
    if (now - lastFieldAt < NET_FIELD_MS) return;
    lastFieldAt = now;
    const d = RDNET.encode();
    netStats.bytesOut += d.length;
    MP.send({ k: 'f', d: d });
}

// ---------------------------------------------------
//   DRAW -- called inside the camera transform
// ---------------------------------------------------
RDHOOKS.draw = function () {
    for (const id in remotePlayers) {
        const r = remotePlayers[id];
        if (r.dead) continue;

        ctx.save();
        ctx.translate(r.x, r.y);
        ctx.rotate(r.angle);
        ctx.scale(0.5, 0.5);
        ctx.fillStyle = r.color;
        ctx.beginPath();
        ctx.ellipse(0, 0, 10, 16, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = '#9ca3af';
        ctx.fillRect(8, -3, 16, 6);
        ctx.fillStyle = '#f3f4f6';
        ctx.beginPath();
        ctx.arc(2, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();

        // Their bubble, so it is visible who is mid-card and why nothing is
        // touching them.
        if (r.selecting) {
            ctx.beginPath();
            ctx.arc(r.x, r.y, BUBBLE_R, 0, Math.PI * 2);
            ctx.strokeStyle = 'rgba(255,255,255,0.5)';
            ctx.lineWidth = 1.5;
            ctx.stroke();
        }

        ctx.fillStyle = r.color;
        ctx.font = 'bold 10px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(r.name || '?', r.x, r.y - 18);
        ctx.textAlign = 'left';
    }

    // Enemy fire we did not simulate ourselves.
    for (let i = 0; i < remoteBullets.length; i++) {
        const b = remoteBullets[i];
        ctx.fillStyle = b.carve > 24 ? '#ff9d3d' : '#fbbf24';
        ctx.beginPath();
        ctx.arc(b.x, b.y, b.radius, 0, Math.PI * 2);
        ctx.fill();
    }
};

// ---------------------------------------------------
//   THE A/B KEYS -- MP_ROLLOUT.md 1
// ---------------------------------------------------
window.addEventListener('keydown', function (e) {
    let label = null;
    if (e.code === 'F9') {
        NET.enabled = !NET.enabled;
        if (NET.enabled) { NET.hostSim = true; NET.resync = true; NET.carveEvents = true; }
        label = NET.enabled ? 'NET ON (all)' : 'NET OFF - local game';
    } else if (e.code === 'F10') {
        NET.resync = !NET.resync;
        label = 'FIELD RESYNC ' + (NET.resync ? 'ON' : 'OFF');
    } else if (e.code === 'F11') {
        NET.hostSim = !NET.hostSim;
        label = 'HOST SIM ' + (NET.hostSim ? 'ON' : 'OFF');
    } else {
        return;
    }
    e.preventDefault();
    floatText(player.x, player.y - 52, label, RDSKIN.amber);
}, listenOpts);
