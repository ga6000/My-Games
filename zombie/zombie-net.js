// ===================================================
//   Zombie — networking
// ===================================================
// Model: HOST-AUTHORITATIVE WORLD, client-owned players.
//
//  - Each client owns and moves its own player(s) and reports where they
//    are. Nobody is corrected on their own position -- same trust model
//    the rest of the project uses, and the right call for a friend group.
//  - Exactly one client is the HOST. It alone spawns zombies, runs their
//    AI, resolves hits, runs the round clock, owns the scrap pool, and
//    decides who goes down and who dies. Everyone else renders what it
//    sends. Two clients spawning from their own RNG would drift into two
//    different games within seconds.
//  - Geometry comes from the shared room seed, so walls are never sent.
//
// The WebSocket server lives in a separate repo and CANNOT be changed
// (GAME_PROTOTYPE_INSTRUCTIONS.md §3), so every mechanic added here rides
// mp-core's generic `relay`. No new server message types exist or can.
"use strict";

const NET_SEND_MS = 66;          // ~15Hz
const REMOTE_TIMEOUT_MS = 5000;  // drop a peer's player if we stop hearing about it

let netOnline = false;
let netIsHost = true;            // solo players are their own host
let netPrefix = "solo";

let remotePlayers = {};
let remoteBullets = [];
let pendingReset = false;
let markers = [];                // ping markers (idea 24)

// The seed the HOST built its geometry from, learned off the world
// snapshot. The server's current seed is not a safe answer to "what map
// is this room playing?" -- see the onPeerSync note below -- so the host
// publishes the one it actually used and everyone else follows it.
let hostLevelSeed = null;

// Stable index <-> key mapping so zombies can go over the wire as a
// number instead of a type name on every entity, every frame.
const Z_TYPE_KEYS = ["walker", "runner", "brute", "screamer", "splitter", "spawnling"];

// One player per client now, so the suffix is constant. It's kept rather
// than using the bare socket id because isMyNetId() and onPeerLeave both
// match on the "<socketId>:" prefix.
function netIdFor(p) {
    return netPrefix + ":p";
}

function isMyNetId(id) {
    return typeof id === "string" && id.indexOf(netPrefix + ":") === 0;
}

function localPlayerByNetId(id) {
    for (let i = 0; i < players.length; i++) {
        if (netIdFor(players[i]) === id) return players[i];
    }
    return null;
}

MP.connect({
    game: "zombie",

    onReady: function (info) {
        netOnline = !info.solo;
        netIsHost = info.isHost;
        netPrefix = info.selfId || "solo";
        // The seed only becomes known here, so the level built at page
        // load came from a throwaway local seed. Rebuild it.
        generateLevel();
    },

    onPeerSync: function () {
        // The promotion path. onReady fires exactly ONCE, so a player
        // whose socket missed mp-core's 6s connect timeout was handed a
        // "solo" identity and a level from the throwaway clock seed, and
        // nothing re-ran when the connection landed later. Render's free
        // tier cold-starts in tens of seconds, so this is the ordinary
        // first-player experience, not a rare race.
        //
        // This hook rather than onStatus: onStatus fires BEFORE mp-core
        // applies the id, host and seed from the same message, so it
        // would read a null id and a stale seed.
        netIsHost = MP.isHost();
        if (MP.selfId && MP.selfId !== netPrefix) netPrefix = MP.selfId;

        // 2026-09-07 -- THE MID-GAME MAP WIPE.
        //
        // This hook is NOT a one-shot. mp-core fires it from every
        // `players` message the server sends: joins, leaves, and the
        // rejoin handshake. The line immediately before it in
        // mp-core.handle() is `if (typeof data.seed === "number")
        // setSeed(data.seed)`. So the unguarded `if (MP.seed() !==
        // levelSeed) generateLevel()` that used to live here fired
        // whenever the server came back with a different seed -- and
        // generateLevel() clears walls, doors, barricades, wall-buys,
        // crates, barrels, traps, zone cooldowns and the whole endgame
        // chain. Ten rounds of opened doors, gone, mid-fight.
        //
        // The server hands back a new seed when the room was collected
        // while everyone was briefly disconnected and then recreated on
        // rejoin. mp-core reconnects on a 3s timer after every onclose,
        // so a sleeping free-tier instance (or a sleeping laptop, which
        // is what local testing hits) produces this routinely.
        //
        // The promotion case above is still real and still worth
        // handling -- it just cannot be told apart from "the seed moved
        // ten rounds in" by looking at the seed. So: gate on whether the
        // game is actually running.
        const want = (!netIsHost && hostLevelSeed !== null) ? hostLevelSeed : MP.seed();
        if (want === levelSeed) return;

        if (gameStarted) {
            // The level is in play. Pin MP's stream back to the geometry
            // that is on screen, so MP.random() and any later
            // resetGame() stay consistent with what everyone is standing
            // in, and leave the world alone.
            MP.reseed(levelSeed);
            return;
        }

        MP.reseed(want);
        generateLevel();
    },

    onHostChange: function (nowHost) {
        // Whoever is promoted keeps simulating from the last state it
        // received, so the arena carries on rather than emptying.
        netIsHost = nowHost;
    },

    onPeerLeave: function (peer) {
        if (!peer) return;
        Object.keys(remotePlayers).forEach(function (id) {
            if (id.indexOf(peer.id + ":") === 0) delete remotePlayers[id];
        });
    },

    onStatus: function (s) {
        netOnline = (s === "online");
        if (!netOnline) netIsHost = true;   // dropped to solo -- simulate locally again
    },

    onMessage: function (msg) {
        if (!msg || !msg.k) return;
        const now = Date.now();

        if (msg.k === "players") {
            (msg.list || []).forEach(function (rp) {
                if (isMyNetId(rp.id)) return;   // never mirror our own back onto ourselves
                const prev = remotePlayers[rp.id];
                remotePlayers[rp.id] = {
                    id: rp.id, name: rp.name, color: rp.color,
                    size: rp.size, facingX: rp.fx, facingY: rp.fy,
                    downed: !!rp.dn,
                    reviveProgress: rp.rv || 0,
                    weapon: rp.w || "pistol",
                    cards: rp.cd || [],
                    // Interpolate rather than snap -- at 15Hz, snapping
                    // reads as a stutter rather than movement.
                    x: prev ? prev.x : rp.x,
                    y: prev ? prev.y : rp.y,
                    tx: rp.x, ty: rp.y,
                    lastSeen: now
                };
            });
            return;
        }

        if (msg.k === "world") {
            if (netIsHost) return;          // we ARE the authority
            applyWorldSnapshot(msg, now);
            return;
        }

        if (msg.k === "shoot" && netIsHost) {
            // Only the host turns a client's shot into bullets that can
            // damage anything.
            (msg.s || []).forEach(function (s) {
                bullets.push({
                    x: s[0], y: s[1], vx: s[2], vy: s[3], size: 8,
                    dmg: msg.d || 1, pierce: msg.pr || 0, bounces: msg.bo || 0, hitIds: [],
                    travelled: 0, range: msg.rg || 800,
                    ownerColor: msg.c, owner: msg.id
                });
            });
            return;
        }

        if (msg.k === "down") {
            const p = localPlayerByNetId(msg.id);
            if (p && !p.downed) {
                p.downed = true;
                p.bleedDeadline = deadlineFrom(msg.ms || BLEED_OUT_MS, now);
                p.reviveProgress = 0;
            }
            return;
        }

        if (msg.k === "up") {
            const p = localPlayerByNetId(msg.id);
            if (p) {
                p.downed = false;
                p.bleedDeadline = 0;
                p.reviveProgress = 0;
                p.invulnUntil = now + 1500;
            }
            return;
        }

        if (msg.k === "dead") {
            const p = localPlayerByNetId(msg.id);
            if (p) killLocalPlayer(p);
            delete remotePlayers[msg.id];
            return;
        }

        if (msg.k === "pickup") {
            applyTeamPickup(msg.t, msg.ms || 0, now, false);
            return;
        }

        if (msg.k === "rvs") {
            // Revive progress is computed by the host (only it sees every
            // position) and published so the downed player's own client
            // can draw the bar. One authority, propagated -- two sources
            // would fight and flicker.
            (msg.list || []).forEach(function (row) {
                const p = localPlayerByNetId(row[0]);
                if (p) p.reviveProgress = row[1];
                else if (remotePlayers[row[0]]) remotePlayers[row[0]].reviveProgress = row[1];
            });
            return;
        }

        if (msg.k === "buy" && netIsHost) {
            hostHandleBuy(msg);
            return;
        }

        if (msg.k === "bought") {
            applyPurchase(msg, now);
            return;
        }

        if (msg.k === "ping") {
            markers.push({
                x: msg.x, y: msg.y, color: msg.c || "#FFFFFF",
                name: msg.n || "", until: now + 4000
            });
            return;
        }

        if (msg.k === "won") {
            triggerWin();
            return;
        }

        if (msg.k === "reset") {
            pendingReset = true;
            return;
        }
    }
});

// ---------------------------------------------------
//   SNAPSHOT
// ---------------------------------------------------
function applyWorldSnapshot(msg, now) {
    // GEOMETRY FIRST. The host is already the authority on doors,
    // barricades, crates and barrels; making it the authority on the
    // seed those indices refer to closes the last gap. A client that
    // generated from a different seed -- a mid-game joiner handed the
    // server's newest one, or anyone who rebuilt before the guard in
    // onPeerSync existed -- rebuilds once from the host's and converges,
    // because generateLevel() sets levelSeed = MP.seed(). Done here,
    // before the door/barricade rows below are applied, so the host's
    // state lands on the corrected geometry in the same packet.
    if (typeof msg.ls === "number") {
        hostLevelSeed = msg.ls;
        if (msg.ls !== levelSeed) {
            MP.reseed(msg.ls);
            generateLevel();
        }
    }

    // Zombies reconcile by index so interpolation targets survive
    // between snapshots.
    const incoming = msg.z || [];
    const next = [];
    for (let i = 0; i < incoming.length; i++) {
        const zi = incoming[i];
        const prev = zombies[i];
        const key = Z_TYPE_KEYS[zi[2]] || "walker";
        const spec = ZOMBIE_TYPES[key];
        next.push({
            type: key,
            x: prev ? prev.x : zi[0],
            y: prev ? prev.y : zi[1],
            tx: zi[0], ty: zi[1],
            size: spec.size,
            color: spec.color,
            hp: 1,
            speedMult: spec.speed,
            speedOffset: 0,
            // BUG 1: arrives as a REMAINING DURATION and is rebased onto
            // this client's clock. v1 sent an absolute host timestamp and
            // compared it against the local clock, so a host running fast
            // made every zombie render permanently white here.
            flashUntil: deadlineFrom(zi[3] || 0, now),
            nextScream: 0,
            isolationSeeker: false
        });
    }
    zombies = next;

    pickups = (msg.p || []).map(function (pu) {
        return { x: pu[0], y: pu[1], size: 18, type: PICKUP_TYPES[pu[2]] || "overclock" };
    });

    // Other players' bullets only -- ours are simulated locally so our
    // shots appear instantly instead of after a round trip.
    remoteBullets = (msg.b || [])
        .filter(function (b) { return !isMyNetId(b[4]); })
        .map(function (b) {
            return { x: b[0], y: b[1], size: 8, ownerColor: b[2], vx: b[3][0], vy: b[3][1] };
        });

    scrapPool = msg.sc || 0;
    kills = msg.ki || kills;

    if (msg.vz && msg.vz.length) {
        for (let i = 0; i < msg.vz.length && i < zoneHotUntil.length; i++) {
            zoneHotUntil[i] = deadlineFrom(msg.vz[i], now);
        }
    }

    gateStage = msg.gs || 0;
    gateProgress = msg.gp || 0;
    if (msg.fa) for (let i = 0; i < msg.fa.length; i++) funnelActive[i] = !!msg.fa[i];
    if (msg.sf) for (let i = 0; i < msg.sf.length; i++) siloFill[i] = msg.sf[i];
    if (msg.sp) for (let i = 0; i < msg.sp.length; i++) siloFlipped[i] = !!msg.sp[i];
    floodActive = !!msg.fl;
    floodRemaining = msg.fr || 0;
    escapeAt = deadlineFrom(msg.esc || 0, now);
    if (msg.wn && !won) triggerWin();
    if (gateStage >= GATE_STAGES && sluiceGate && !sluiceGate.open) {
        sluiceGate.open = true;
        rebuildSolidIndex();
    }

    if (msg.gen && !generatorOn) {
        generatorOn = true;
        if (generatorRect) playEvent(SND_GENERATOR, generatorRect.x, generatorRect.y);
    } else if (!msg.gen && generatorOn) {
        generatorOn = false;
    }

    // Cap what one snapshot can play. A lagged packet carrying a long
    // backlog should not dump the whole queue into the mix at once.
    const evs = msg.ev || [];
    for (let i = 0; i < evs.length && i < 6; i++) {
        const e = evs[i];
        // Skip our own echo: we already played this locally the instant
        // it happened (gunfire especially), and hearing it again on the
        // snapshot round-trip is a distinct, wrong-sounding double tap.
        if (e[4] && isMyNetId(e[4])) continue;
        playEvent(e[0], e[1], e[2], e[3]);
        // Clients draw their own shockwave from the same event, so the
        // ring costs nothing extra on the wire.
        if (e[0] === SND_EXPLODE) addBlast(e[1], e[2], 190);
    }

    // Round state (sent as a remaining duration, never a timestamp).
    round = msg.rd || 0;
    roundPhase = ROUND_PHASES[msg.rp] || "idle";
    roundEndsAt = deadlineFrom(msg.rt || 0, now);
    roundBudget = msg.rb || 0;

    // Level state the host owns.
    (msg.dr || []).forEach(function (open, i) { if (doors[i]) doors[i].open = !!open; });
    (msg.bc || []).forEach(function (hp, i) { if (barricades[i]) barricades[i].hp = hp; });
    (msg.cr || []).forEach(function (uses, i) { if (ammoCrates[i]) ammoCrates[i].uses = uses; });
    (msg.br || []).forEach(function (alive, i) { if (barrels[i]) barrels[i].alive = !!alive; });
    (msg.tr || []).forEach(function (ms, i) { if (traps[i]) traps[i].armedUntil = deadlineFrom(ms, now); });

    rebuildSolidIndex();

    if (msg.go && !gameOver) triggerGameOver();
}

function interpolateRemotes() {
    Object.keys(remotePlayers).forEach(function (id) {
        const r = remotePlayers[id];
        r.x += (r.tx - r.x) * 0.35;
        r.y += (r.ty - r.y) * 0.35;
    });
    if (!netIsHost) {
        for (let i = 0; i < zombies.length; i++) {
            const z = zombies[i];
            if (z.tx === undefined) continue;
            z.x += (z.tx - z.x) * 0.35;
            z.y += (z.ty - z.y) * 0.35;
        }
    }
}

function pruneRemotePlayers() {
    const now = Date.now();
    Object.keys(remotePlayers).forEach(function (id) {
        if (now - remotePlayers[id].lastSeen > REMOTE_TIMEOUT_MS) delete remotePlayers[id];
    });
}

// ---------------------------------------------------
//   BROADCAST
// ---------------------------------------------------
function broadcastPlayers() {
    if (!netOnline || players.length === 0) return;
    if (!MP.canSend("players", NET_SEND_MS)) return;
    MP.send({
        k: "players",
        list: players.map(function (p) {
            return {
                id: netIdFor(p), name: MP.selfName || "", color: p.color,
                x: Math.round(p.x), y: Math.round(p.y), size: p.size,
                fx: +p.facingX.toFixed(2), fy: +p.facingY.toFixed(2),
                dn: p.downed ? 1 : 0,
                rv: +p.reviveProgress.toFixed(2),
                w: currentWeaponKey(p),
                cd: p.cards
            };
        })
    });
}

function broadcastWorld() {
    if (!netOnline || !netIsHost) return;
    if (!MP.canSend("world", NET_SEND_MS)) return;
    const now = Date.now();

    // Packed as arrays rather than objects: with ~200 zombies in flight
    // on a 9x map this is the difference between a ~3KB and a ~12KB
    // frame, 15 times a second, on a free tier.
    MP.send({
        k: "world",
        z: zombies.map(function (z) {
            return [
                Math.round(z.x), Math.round(z.y),
                Z_TYPE_KEYS.indexOf(z.type),
                msLeft(z.flashUntil, now)      // duration, never a timestamp
            ];
        }),
        b: bullets.map(function (b) {
            return [Math.round(b.x), Math.round(b.y), b.ownerColor, [b.vx, b.vy], b.owner || ""];
        }),
        p: pickups.map(function (pu) {
            return [pu.x, pu.y, PICKUP_TYPES.indexOf(pu.type)];
        }),
        sc: Math.round(scrapPool),
        ki: kills,
        gen: generatorOn ? 1 : 0,

        // Which seed this room's geometry actually came from. One integer
        // on a packet that already ships 15x/s, riding the generic relay,
        // so it needs nothing from the server -- which is just as well,
        // since the server cannot be changed.
        ls: levelSeed,

        // The Blood Silo chain. All small integers; `esc` is a REMAINING
        // DURATION, never a timestamp.
        gs: gateStage,
        gp: +gateProgress.toFixed(2),
        fa: funnelActive.map(function (v) { return v ? 1 : 0; }),
        sf: siloFill.slice(),
        sp: siloFlipped.map(function (v) { return v ? 1 : 0; }),
        fl: floodActive ? 1 : 0,
        fr: floodRemaining,
        esc: msLeft(escapeAt, now),
        wn: won ? 1 : 0,
        // Per-zone spawn cooldown, as REMAINING DURATIONS (never
        // timestamps -- clients' clocks are not synchronised). Host-owned,
        // but broadcast so a promoted host doesn't immediately start
        // spawning in ground someone is standing in.
        vz: (function () {
            const out = [];
            for (let i = 0; i < zoneHotUntil.length; i++) out.push(msLeft(zoneHotUntil[i], now));
            return out;
        })(),

        // Audio events (idea 38). Drained every send: they are one-shots,
        // not state, so a client that misses one has simply missed a
        // sound rather than desynced.
        ev: eventQueue.splice(0, eventQueue.length),

        rd: round,
        rp: ROUND_PHASES.indexOf(roundPhase),
        rt: msLeft(roundEndsAt, now),
        rb: roundBudget,                       // so a promoted host can resume mid-round

        dr: doors.map(function (d) { return d.open ? 1 : 0; }),
        bc: barricades.map(function (b) { return Math.round(b.hp); }),
        cr: ammoCrates.map(function (c) { return c.uses; }),
        br: barrels.map(function (b) { return b.alive ? 1 : 0; }),
        tr: traps.map(function (t) { return msLeft(t.armedUntil, now); }),

        go: gameOver
    });
}

function sendPing(x, y, color, name) {
    const now = Date.now();
    markers.push({ x: x, y: y, color: color, name: name, until: now + 4000 });
    if (netOnline) MP.send({ k: "ping", x: Math.round(x), y: Math.round(y), c: color, n: name });
}

function requestReset() {
    // Room-wide: one person clicking restart shouldn't drop them into a
    // fresh level while everyone else stares at a game-over screen.
    // echo:true so the sender resets on the same path as everyone else.
    if (netOnline) MP.send({ k: "reset" }, true);
    else resetGame();
}
