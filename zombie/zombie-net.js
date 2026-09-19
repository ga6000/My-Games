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

// ---------------------------------------------------
//   CONNECTION TROUBLE (2026-09-19)
// ---------------------------------------------------
// The ask: "a lack of penalty for wifi issues, but also welcoming to other
// friends joining in mid game". What a drop USED to cost, read from
// server.js and mp-core.js:
//
//  - Every reconnect is a new socket id, and the player id, the role, the
//    scoreboard row and the host's bleed clock were all keyed on it. A wifi
//    blip re-rolled your class, zeroed your kills and made you a stranger.
//  - A dropped client flipped to solo HOST and ran its own fork of the
//    world, where its own zombies could down or kill it -- and a local game
//    over, then a click on "restart" after reconnecting, reset the ROOM.
//  - A stalled socket (no close, packets just queued) left the host
//    mauling the player's last known position while their screen froze.
//
// So: identity is a per-tab token (below); a silent teammate is AWAY, not
// gone (untouchable, paused, ghosted, for up to AWAY_GRACE_MS); and a client
// that loses a shared room HOLDS instead of forking (netLost).
const AWAY_AFTER_MS = 1200;      // silent this long -> away
const AWAY_GRACE_MS = 60000;     // away this long -> gone
const NET_LOST_OFFER_MS = 15000; // then offer to carry on alone

let netOnline = false;
let netIsHost = true;            // solo players are their own host
let netPrefix = "solo";          // the SOCKET id: routing and host checks only
let netLost = false;             // lost a shared room mid-run: holding, not forking
let netLostAt = 0;
let lastWorldAt = 0;             // guest: when the last snapshot landed

// THE PLAYER'S IDENTITY: a token per browser tab, kept in sessionStorage so
// it survives both a dropped socket and a page refresh. It used to be the
// socket id, which the server re-rolls on every connection. Everything that
// is "who is this player" -- the player id, the role, the scoreboard row,
// the host's bleed clock, DECOY's recharge -- hangs off it now.
//
// sessionStorage is per tab, except that "duplicate tab" copies it; the
// players handler spots a second socket wearing our token and re-rolls.
const NET_TOKEN_KEY = "zombie_tab_token";
let netToken = "";
let netDupSince = 0;             // first sighting of our token on another socket

function newNetToken() {
    let t = "t";
    for (let i = 0; i < 8; i++) t += Math.floor(Math.random() * 36).toString(36);
    try { sessionStorage.setItem(NET_TOKEN_KEY, t); } catch (e) { /* private mode: per page load */ }
    return t;
}

try { netToken = sessionStorage.getItem(NET_TOKEN_KEY) || ""; } catch (e) { netToken = ""; }
if (!/^t[0-9a-z]{8}$/.test(netToken)) netToken = newNetToken();

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
// number instead of a type name on every entity, every frame. APPEND ONLY
// (the ULTRA HEAVY went on the end, 2026-09-18): an index is a wire value.
const Z_TYPE_KEYS = ["walker", "runner", "brute", "screamer", "splitter", "spawnling", "ultra"];

// One player per client now, so the suffix is constant. The prefix is the
// tab token (was the socket id until 2026-09-19 -- see netToken).
function netIdFor(p) {
    return netToken + ":p";
}

function isMyNetId(id) {
    return typeof id === "string" && id.indexOf(netToken + ":") === 0;
}

// Anyone else in the room, whether or not their messages are arriving.
function remoteCount(includeAway) {
    let n = 0;
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        if (includeAway || !remotePlayers[id].away) n++;
    }
    return n;
}

function markAway(r, now, why) {
    if (r.away) return;
    r.away = true;
    r.awaySince = now;
    r.awayStanding = !r.downed;
    if (gameStarted && !gameOver) showToast((r.name || "A TEAMMATE") + " LOST CONNECTION", 2200);
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

    // A server `leave` is not proof they are gone -- the same person
    // reconnecting comes back on a NEW socket a few seconds later. Away, not
    // deleted; pruneRemotePlayers removes them if the grace runs out.
    onPeerLeave: function (peer) {
        if (!peer) return;
        const now = Date.now();
        Object.keys(remotePlayers).forEach(function (id) {
            const r = remotePlayers[id];
            if (r.sk === peer.id) markAway(r, now, "left");
        });
    },

    onStatus: function (s) {
        const online = (s === "online");
        if (online) {
            // Back. onPeerSync (which runs after this, once mp-core has
            // applied the host and seed) decides whether we host or follow.
            netOnline = true;
            if (netLost) showToast("RECONNECTED", 1800);
            netLost = false;
            return;
        }
        // Lost a SHARED room mid-run: hold the world rather than fork it.
        // Alone in the room, carry on solo exactly as before -- there is
        // nobody to disagree with.
        if (netOnline && gameStarted && !gameOver && !won && remoteCount(true) > 0) {
            netLost = true;
            netLostAt = Date.now();
            releaseHeldKeys();
        }
        netOnline = false;
        netIsHost = !netLost;               // holding: nobody here simulates
    },

    onMessage: function (msg) {
        if (!msg || !msg.k) return;
        const now = Date.now();

        if (msg.k === "players") {
            (msg.list || []).forEach(function (rp) {
                if (isMyNetId(rp.id)) {
                    // Our own id on ANOTHER socket: a duplicated tab carried
                    // our sessionStorage token over. Two guards, both found by
                    // test: only ONE tab re-rolls (the higher socket id), or
                    // both lose their role and row; and the clash must PERSIST,
                    // because one stray packet from our own dead socket can be
                    // relayed to us just after a reconnect -- and re-rolling
                    // then would cost the player the identity this protects.
                    if (rp.sk && MP.selfId && rp.sk !== MP.selfId && MP.selfId > rp.sk) {
                        if (!netDupSince || now - netDupSince > 5000) netDupSince = now;
                        else if (now - netDupSince > 1000) { netToken = newNetToken(); netDupSince = 0; }
                    }
                    return;   // never mirror our own back onto ourselves
                }
                // UPDATED IN PLACE, not rebuilt (2026-09-19). The rebuild took
                // reviveProgress from this payload -- the guest's own copy,
                // always a round trip old -- and so knocked the host's live
                // value back 15 times a second: THE PULSING REVIVE BAR. Revive
                // progress now has one source, the host (`rvs`), and this
                // handler never writes it except to clear it on a stand-up.
                let r = remotePlayers[rp.id];
                const isNew = !r;
                if (isNew) {
                    // Interpolate rather than snap -- at 15Hz, snapping reads
                    // as a stutter rather than movement.
                    r = { id: rp.id, x: rp.x, y: rp.y, reviveProgress: 0 };
                    remotePlayers[rp.id] = r;
                }
                r.name = rp.name;
                r.color = rp.color;
                r.size = rp.size;
                r.facingX = rp.fx;
                r.facingY = rp.fy;
                // Just revived by this host: their own messages say "downed"
                // until our "up" reaches them. Don't take that as a new down.
                r.downed = !!rp.dn && !(r.revivedAt && now - r.revivedAt < 1500);
                if (!r.downed) r.reviveProgress = 0;
                r.weapon = rp.w || "pistol";
                r.cards = rp.cd || [];
                if (rp.sk) r.sk = rp.sk;
                r.tx = rp.x;
                r.ty = rp.y;
                r.lastSeen = now;
                if (r.away) {
                    r.away = false;
                    if (gameStarted && !gameOver) showToast((r.name || "A TEAMMATE") + " RECONNECTED", 1800);
                } else if (isNew && gameStarted && !gameOver) {
                    showToast((r.name || "A TEAMMATE") + " JOINED", 1800);
                }
            });
            return;
        }

        if (msg.k === "world") {
            if (netIsHost) return;          // we ARE the authority
            lastWorldAt = now;
            applyWorldSnapshot(msg, now);
            return;
        }

        if (msg.k === "shoot" && netIsHost) {
            // Only the host turns a client's shot into bullets that can
            // damage anything. `wk` names the gun (2026-09-18); what a
            // rocket or a flame DOES is read from this host's own WEAPONS,
            // never taken off the wire.
            const kind = WEAPON_KEYS[msg.wk | 0] || "pistol";
            const size = WEAPONS[kind].bsize;
            (msg.s || []).forEach(function (s) {
                bullets.push({
                    x: s[0], y: s[1], vx: s[2], vy: s[3], size: size,
                    dmg: msg.d || 1, pierce: msg.pr || 0, bounces: msg.bo || 0, hitZ: [],
                    travelled: 0, range: msg.rg || 800, kind: kind,
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
            // PERK: DECOY. The ping carries its sender (2026-09-18) so the
            // host -- the one that steers zombies -- can make it a lure.
            if (netIsHost && msg.id) registerDecoy(msg.id, msg.x, msg.y, now);
            return;
        }

        if (msg.k === "won") {
            triggerWin();
            return;
        }

        // The host called the room wiped (updateTeamWipe). Sent on its own
        // because the snapshot's `go` flag can miss its only send.
        if (msg.k === "over") {
            if (!gameOver) triggerGameOver();
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
            burnUntil: deadlineFrom(zi[4] || 0, now),   // same rule, same reason
            nextScream: 0,
            isolationSeeker: false
        });
    }
    zombies = next;

    pickups = (msg.p || []).map(function (pu) {
        return { x: pu[0], y: pu[1], size: 18, type: PICKUP_TYPES[pu[2]] || "overclock" };
    });

    // Other players' bullets only -- ours are simulated locally so our
    // shots appear instantly instead of after a round trip. Row 5 is the
    // gun (so each is drawn in its own shape), row 6 how far a flame has
    // gone (it changes colour and size as it burns out).
    remoteBullets = (msg.b || [])
        .filter(function (b) { return !isMyNetId(b[4]); })
        .map(function (b) {
            const kind = WEAPON_KEYS[b[5] | 0] || "pistol";
            return {
                x: b[0], y: b[1], size: WEAPONS[kind].bsize, ownerColor: b[2],
                vx: b[3][0], vy: b[3][1], kind: kind,
                travelled: b[6] || 0, range: WEAPONS[kind].range
            };
        });

    // The scoreboard, which guests never received before 2026-09-18 -- the
    // round-end table only ever showed on the host. It also feeds SALVAGE,
    // which is how a guest learns about its own kills.
    if (msg.sb) {
        const sb = {};
        for (let i = 0; i < msg.sb.length; i++) {
            const r = msg.sb[i];
            sb[r[0]] = { kills: r[1], assists: r[2], revives: r[3], score: r[4] };
        }
        scoreBoard = sb;
    }

    // PERK: DECOY lures, for drawing.
    decoys = (msg.dc || []).map(function (d) {
        return { x: d[0], y: d[1], r: d[2], until: deadlineFrom(d[3], now) };
    });

    scrapPool = msg.sc || 0;
    kills = msg.ki || kills;

    if (msg.vz && msg.vz.length) {
        for (let i = 0; i < msg.vz.length && i < zoneHotUntil.length; i++) {
            zoneHotUntil[i] = deadlineFrom(msg.vz[i], now);
        }
    }

    // The horde being called is a 0 -> 1 transition, so a guest runs the
    // same three announce beats the host does off one flag, rather than
    // needing three separate events to survive the trip.
    if (msg.iz && !intensified) {
        intensified = true;
        intensifyAt = Date.now();
        hordeCalledBy = msg.hc || hordeCalledBy || "SOMEONE";
        beginIntensifyAnnounce();
    } else if (msg.iz && msg.hc && !hordeCalledBy) {
        hordeCalledBy = msg.hc;
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

    // GENERATOR. `gt` = tripped by a Blackout, `gr` = restart progress.
    const wasTripped = genTripped;
    genTripped = !!msg.gt;
    genRestart = msg.gr || 0;
    if (genTripped && !wasTripped) showToast("THE GENERATOR TRIPPED", 2600);

    if (msg.gen && !generatorOn) {
        generatorOn = true;
        if (generatorRect) playEvent(SND_GENERATOR, generatorRect.x, generatorRect.y);
        if (wasTripped) showToast("POWER RESTORED", 2200);
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
        // ring costs nothing extra on the wire. `arg` carries the radius
        // since rockets and SPITE have their own (190 was every blast).
        if (e[0] === SND_EXPLODE) addBlast(e[1], e[2], e[3] || 190);
        else if (e[0] === SND_POP) addBlast(e[1], e[2], e[3] || 95);
        else if (e[0] === SND_ULTRA && e[3] === 1) addBlast(e[1], e[2], 70);
        else if (e[0] === SND_ARC) {
            // The bolt's far end is packed into arg; see arcFrom().
            addBolt(e[1], e[2], e[1] + Math.floor(e[3] / 1024) - 512, e[2] + (e[3] % 1024) - 512);
        }
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
    // The room is still PLAYING but this client thinks it is over: it went
    // solo after a drop and died out there (goSoloAfterLoss). Rejoin the run
    // as a teammate who bled out -- back at the next breather -- instead of
    // sitting on a game-over card whose "restart" would reset the room.
    // (A real room game over never reaches this: the host stops sending
    // world snapshots the moment its own gameOver is set. A host RESTART
    // does send go=0 again, but its `reset` lands first and is applied on
    // the next frame -- hence the pendingReset guard.)
    else if (!msg.go && gameOver && !won && !pendingReset) rejoinRunningRoom();
}

function rejoinRunningRoom() {
    gameOver = false;
    uiGameOver.style.display = 'none';
    stopRunScoreReadout();
    if (!players.length) {
        zAwaitRespawn = true;
        zDiedRound = round;
    }
    musicStart();
    showToast("BACK IN THE ROOM'S RUN", 2200);
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

// Silent for AWAY_AFTER_MS -> away (untouchable, paused, ghosted). Silent
// for AWAY_GRACE_MS -> gone. It was "silent 5s -> deleted", which dropped a
// player whose wifi hiccuped for six seconds out of the game altogether,
// and meanwhile let the host maul the spot they were frozen on.
function pruneRemotePlayers() {
    const now = Date.now();
    Object.keys(remotePlayers).forEach(function (id) {
        const r = remotePlayers[id];
        const quiet = now - r.lastSeen;
        if (quiet > AWAY_GRACE_MS) {
            delete remotePlayers[id];
            delete remoteDowned[id];
        } else if (quiet > AWAY_AFTER_MS) {
            markAway(r, now, "silent");
        }
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
                // No `rv` any more: revive progress belongs to the host and
                // travels only in `rvs`. Echoing it back here is what made
                // the bar pulse (see the players handler).
                w: currentWeaponKey(p),
                cd: p.cards,
                // The socket this id currently rides, so a server `leave`
                // (which names sockets) can be matched to a player.
                sk: MP.selfId || ""
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
            const row = [
                Math.round(z.x), Math.round(z.y),
                Z_TYPE_KEYS.indexOf(z.type),
                msLeft(z.flashUntil, now)      // duration, never a timestamp
            ];
            // Burning, as a remaining duration. Omitted when not burning, so
            // a horde with no flamethrower in it costs nothing extra.
            if (z.burnUntil && now < z.burnUntil) row.push(msLeft(z.burnUntil, now));
            return row;
        }),
        // [x, y, colour, [vx, vy], owner, gun index, flame distance]. The
        // velocity is rounded now -- it went out at full float precision.
        b: bullets.map(function (b) {
            const k = WEAPON_KEYS.indexOf(b.kind || "pistol");
            const row = [Math.round(b.x), Math.round(b.y), b.ownerColor,
                         [+b.vx.toFixed(2), +b.vy.toFixed(2)], b.owner || "", k];
            if (b.kind === "flamer") row.push(Math.round(b.travelled));
            return row;
        }),
        p: pickups.map(function (pu) {
            return [pu.x, pu.y, PICKUP_TYPES.indexOf(pu.type)];
        }),
        sc: Math.round(scrapPool),
        ki: kills,
        gen: generatorOn ? 1 : 0,
        gt: genTripped ? 1 : 0,
        gr: +genRestart.toFixed(2),

        // [id, kills, assists, revives, score] per player. Guests never had
        // the scoreboard; SALVAGE needs it to count a guest's own kills.
        sb: Object.keys(scoreBoard).map(function (id) {
            const s = scoreBoard[id];
            return [id, s.kills, s.assists, s.revives, s.score];
        }),
        // Live DECOY lures, as remaining durations.
        dc: decoys.map(function (d) {
            return [Math.round(d.x), Math.round(d.y), d.r, msLeft(d.until, now)];
        }),

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

        // INTENSIFY (2026-09-19). Two tiny fields on a packet that already
        // ships 15x/s, riding the generic relay like everything else here.
        // STATE, not an event: the event queue is capped at ten a snapshot
        // and is the first thing dropped, and the one packet that says "the
        // horde has been called" must not be droppable. `hc` is sent only
        // while the announce window is live, so the name is not on every
        // frame of the rest of the run.
        iz: intensified ? 1 : 0,
        hc: (intensified && Date.now() - intensifyAt < 6000) ? hordeCalledBy : undefined,

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
    // `id` so the host can check the pinger's DECOY. The host's own ping
    // never crosses the wire, so it registers its lure directly.
    const id = netIdFor(players[0]);
    if (netIsHost) registerDecoy(id, x, y, now);
    if (netOnline) MP.send({ k: "ping", x: Math.round(x), y: Math.round(y), c: color, n: name, id: id });
}

function requestReset() {
    // Room-wide: one person clicking restart shouldn't drop them into a
    // fresh level while everyone else stares at a game-over screen.
    // echo:true so the sender resets on the same path as everyone else.
    if (netOnline) MP.send({ k: "reset" }, true);
    else resetGame();
}
