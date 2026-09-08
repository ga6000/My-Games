// ===================================================
//   4D Pong -- online play
// ===================================================
// Added 2026-09-06, the same day the game was promoted to the board. See
// ONLINE_PLAN.md for the reasoning; this file is the implementation.
//
// ---------------------------------------------------------------------------
// NO SERVER CHANGE. NOT ONE.
// ---------------------------------------------------------------------------
// Everything here rides on mp-core's generic `relay`, which the server passes
// through untouched -- MULTIPLAYER_PLAN.md 1-3 designed it for exactly this,
// and it is why online play could ship without redeploying the separate
// gyro-space-server repo. Every payload shape below is defined by this file
// and understood only by this file.
//
// ---------------------------------------------------------------------------
// HOST AUTHORITY, WITH ONE PIECE OF PREDICTION
// ---------------------------------------------------------------------------
// Glass City Escape's model -- parallel worlds, positions only, no host -- is
// cheaper and does not work here. It works for a RACE, where players never
// interact and each can run its own world. 4D Pong has exactly ONE ball and
// every player hits it; two clients simulating it from the same seed diverge
// the instant a paddle moves, because paddle positions are inputs, not seeds.
//
// So the host owns the ball, every collision, the score, the tug, the blasters,
// the power-up and the AI seats. Clients own exactly one thing: THEIR OWN
// PADDLE, drawn from local input with zero latency.
//
// That single prediction is safe in a way prediction usually is not, because
// nothing but your own keys moves your paddle. The one exception is a stun,
// which the host owns and the client accepts -- a stun that lands 80ms late is
// indistinguishable from one that lands on time.
//
// There is no rollback, no reconciliation and no input buffer. Those solve
// problems this game does not have, and each is a night of debugging.
"use strict";

// Snapshots and paddle updates both go at 20Hz. Fast enough that dead
// reckoning has little to hide, slow enough that four clients on Render's free
// tier are nowhere near saturating it.
var NET_SNAP_MS = 50;
var NET_PAD_MS = 50;

// How long a correction to the ball is blended over. Snapping looks like a
// glitch; blending over ~6 frames reads as the ball simply being where it is.
var NET_BLEND_MS = 100;

var net = {
    on: false,             // online AND seated: the flag the rest of the game tests
    host: false,
    seatOf: {},            // peerId -> seat index
    ownerOf: [null, null, null, null],   // seat index -> peerId (null = CPU or empty)
    nameOf: {},            // peerId -> display name
    colorOf: {},           // peerId -> identity colour
    mySeat: -1,
    humans: 0,
    spectator: false,
    lastSnapAt: 0,
    snap: null,            // the last snapshot received, as sent
    blendUntil: 0,
    blendFrom: null,
    inputs: {}             // host only: peerId -> {v, d, fire}
};

// ===================================================
//   SEATING
// ===================================================
// The host assigns seats and BROADCASTS them. Deriving them from a sorted peer
// list looks simpler and is a trap: peer lists differ transiently while someone
// is joining, so two clients can briefly disagree about who is LEFT -- and from
// then on every input goes to the wrong paddle. One authority, one message.
//
// Seat order is LEFT, RIGHT, TOP, BOTTOM: with two humans that is the classic
// left/right game with walls top and bottom, and the third and fourth arrivals
// open up the vertical axis. Three humans get a CPU on BOTTOM, which is the
// brief's own rule and the same seat the couch 3P mode uses -- so the two modes
// are the same game, not two games that resemble each other.
function assignSeats() {
    if (!net.host) return;

    var ids = [MP.selfId];
    var peers = MP.peers();
    for (var i = 0; i < peers.length; i++) {
        if (peers[i].id && peers[i].id !== MP.selfId) ids.push(peers[i].id);
    }
    // Stable order, so a rejoin does not reshuffle everyone who was already
    // playing. Sorting by id is arbitrary but consistent.
    ids.sort();

    var map = {};
    for (var s = 0; s < ids.length && s < 4; s++) map[ids[s]] = s;

    net.humans = Math.min(ids.length, 4);
    applySeatMap(map, net.humans);
    MP.send({ t: "seat", m: map, n: net.humans });
}

function applySeatMap(map, humans) {
    net.seatOf = map || {};
    net.humans = humans || 0;
    net.ownerOf = [null, null, null, null];
    for (var id in net.seatOf) {
        if (!Object.prototype.hasOwnProperty.call(net.seatOf, id)) continue;
        var s = net.seatOf[id];
        if (s >= 0 && s < 4) net.ownerOf[s] = id;
    }
    net.mySeat = (MP.selfId && net.seatOf[MP.selfId] !== undefined) ? net.seatOf[MP.selfId] : -1;
    net.spectator = net.mySeat < 0;
    net.on = net.humans >= 2;

    // Names and colours come from mp-core's peer list, which carries the
    // SERVER's colour. Never hash a name here -- shared/identity.js is the one
    // client-side implementation and mp-core has already applied it.
    net.nameOf = {};
    net.colorOf = {};
    if (MP.selfId) {
        net.nameOf[MP.selfId] = MP.selfName || "YOU";
        net.colorOf[MP.selfId] = MP.selfColor || identity.color;
    }
    var peers = MP.peers();
    for (var i = 0; i < peers.length; i++) {
        net.nameOf[peers[i].id] = peers[i].name || "P";
        net.colorOf[peers[i].id] = peers[i].color;
    }

    if (net.on) applyOnlineMode();
}

// Two humans -> the two-paddle game. Three or four -> the four-paddle game,
// with any unowned seat handed to a CPU that the HOST runs.
//
// ---------------------------------------------------------------------------
// THE TWO CASES ARE VERY DIFFERENT AND ONLY ONE OF THEM IS DISRUPTIVE
// ---------------------------------------------------------------------------
// A fourth player joining a three-player match does NOT change the arena: both
// are the four-paddle square field, so all that happens is that the BOTTOM seat
// stops being a CPU and starts being a person. Nothing else moves. That is the
// common case for a friend group and it costs nothing.
//
// Going 2 <-> 3 does change the arena -- 16:9 with walls becomes a square with
// four goals -- and applyMode() rebuilds the seats and the ball to match. Doing
// that mid-rally is what nearly shipped a nasty bug: applyMode() calls
// createBall(), which places the ball at the centre with ZERO velocity, so a
// player joining mid-match froze the ball permanently, with nothing left to
// re-serve it.
//
// The fix is not to patch the ball back up -- a half-changed arena is not a
// state worth defending. The host restarts the match, which is also the honest
// thing to show people: the arena changed, so the match did.
var applyingOnlineMode = false;

function applyOnlineMode() {
    if (applyingOnlineMode) return;          // startMatch() calls back into this
    applyingOnlineMode = true;
    try {
        var wantKey = (net.humans <= 2) ? 2 : 4;
        var shapeChanged = (modeKey !== wantKey) || !seats.length;
        if (shapeChanged) applyMode(wantKey);

        for (var i = 0; i < seats.length; i++) {
            var live = (i < 2) || net.humans > 2;
            if (!live) { seats[i].kind = EMPTY; continue; }
            if (net.ownerOf[i]) {
                seats[i].kind = HUMAN;
                seats[i].ai = null;
            } else {
                seats[i].kind = CPU;
                if (!seats[i].ai) attachAI(seats[i], "medium");
            }
        }
        applyTugMode();
        updateNetHud();

        if (shapeChanged && net.host && (phase === "play" || phase === "count")) {
            startMatch();
        }
    } finally {
        applyingOnlineMode = false;
    }
}

// ===================================================
//   SNAPSHOT  -- host -> everyone, 20Hz
// ===================================================
// Compact because it goes 20x/second to every peer. Goals are included so a
// client can SOUND a goal without a separate event: a dropped event is silent
// forever, a changed number is self-correcting on the very next snapshot.
function sendSnapshot() {
    if (!net.host || !net.on) return;
    if (!MP.canSend("snap", NET_SNAP_MS)) return;

    var pos = [], dep = [], lng = [], stun = 0;
    for (var i = 0; i < 4; i++) {
        var s = seats[i];
        pos.push(s ? Math.round(s.pos * 10) / 10 : 0);
        // Depth travels too, now that every seat has it: without this a remote
        // paddle that had advanced into the middle still drew flat against its
        // own wall on everyone else's screen -- and the ball would then bounce
        // off thin air.
        dep.push(s ? Math.round(s.depth) : 0);
        lng.push(s ? s.long : PADDLE_LONG);
        if (s && s.stunned) stun |= (1 << i);
    }

    var bl = [];
    for (var b = 0; b < blasters.length && b < 12; b++) {
        var x = blasters[b];
        bl.push([Math.round(x.x - field.x), Math.round(x.y - field.y), x.vx, x.vy, x.hot ? 1 : 0, x.from]);
    }

    MP.send({
        t: "s",
        // FIELD-LOCAL, not stage-absolute. The client's field sits at a
        // different origin and may be a different size; sending local units and
        // scaling on arrival is what lets two people play on differently shaped
        // windows without either of them being letterboxed to match the other.
        b: ball ? [Math.round((ball.x - field.x) * 10) / 10, Math.round((ball.y - field.y) * 10) / 10,
                   Math.round(ball.vx), Math.round(ball.vy)] : null,
        p: pos,
        D: dep,
        L: lng,
        k: stun,
        u: [axes[0].pull, axes[1].pull],
        G: [seats[0].goals, seats[1].goals, seats[2].goals, seats[3].goals],
        ph: phase,
        cd: countdown,
        w: winnerSeat,
        pu: powerup && powerup.active ? [Math.round(powerup.x - field.x), Math.round(powerup.y - field.y)] : null,
        bl: bl,
        // Field size travels with the snapshot so a client whose window is a
        // different shape can map positions into ITS OWN field rather than
        // drawing the host's geometry. Everything on the wire is in the host's
        // field-local units; scaleIn() converts.
        f: [field.w, field.h]
    });
}

// Positions on the wire are the HOST's field-local pixels. A client with a
// different window size scales them into its own field, so nobody has to play
// letterboxed to match someone else's monitor.
function scaleIn(v, horizontal) {
    if (!net.snap || !net.snap.f) return v;
    var hostSpan = horizontal ? net.snap.f[0] : net.snap.f[1];
    var mySpan = horizontal ? field.w : field.h;
    if (!hostSpan) return v;
    return v * (mySpan / hostSpan);
}

function applySnapshot(m) {
    var prevGoals = net.snap ? net.snap.G : null;
    var prevPhase = net.snap ? net.snap.ph : null;

    // Keep the pre-correction ball so the blend has something to come from.
    if (ball) net.blendFrom = { x: ball.x, y: ball.y };
    net.blendUntil = performance.now() + NET_BLEND_MS;

    net.snap = m;
    net.lastSnapAt = performance.now();

    // The ball arrives in the host's field-local units and lands in ours.
    // Velocity is scaled too: on a smaller field the ball must cross it in the
    // same time, or the two screens disagree about when it arrives.
    if (m.b && ball) {
        ball.x = field.x + scaleIn(m.b[0], true);
        ball.y = field.y + scaleIn(m.b[1], false);
        ball.vx = scaleIn(m.b[2], true);
        ball.vy = scaleIn(m.b[3], false);
    }

    for (var i = 0; i < 4; i++) {
        var s = seats[i];
        if (!s) continue;
        if (m.L) s.long = m.L[i];
        s.stunned = !!(m.k & (1 << i));
        if (m.G) s.goals = m.G[i];
        // Your OWN paddle is not overwritten: it is drawn from local input.
        if (i === net.mySeat) continue;
        if (m.D) {
            var dAlongY = (SEAT_AXIS[i] === "y");
            s.depth = clamp(scaleIn(m.D[i], dAlongY), 0, maxDepth(i));
        }
        if (m.p) {
            // A vertical-edge seat (LEFT/RIGHT) slides on Y, so its position
            // scales by the field HEIGHT; a horizontal one by the width.
            var alongY = (SEAT_AXIS[i] === "y");
            s.netTarget = scaleIn(m.p[i], !alongY);
            // First snapshot: place it rather than easing in from wherever the
            // menu left it, or every remote paddle slides across the field once.
            if (s.netSeen !== true) { s.pos = s.netTarget; s.netSeen = true; }
            var span = slideSpan(s);
            s.frac = (span.max - span.min) > 0 ? (s.pos - span.min) / (span.max - span.min) : 0.5;
        }
    }

    if (m.u) { axes[0].pull = m.u[0]; axes[1].pull = m.u[1]; updateTugDom(); }
    if (typeof m.cd === "number") countdown = m.cd;
    if (typeof m.w === "number") winnerSeat = m.w;

    // Guests keep their own copy of the match clock, purely so the serve-speed
    // ramp survives host migration. Without it, a guest promoted to host mid-way
    // through a long deadlocked match would restart the ramp from zero and the
    // game would visibly get slower again -- which reads as a bug, not a
    // handover.
    if (m.ph === "count" && prevPhase !== "count") matchStartAt = performance.now();

    if (m.ph && m.ph !== phase) setPhase(m.ph);

    if (powerup) {
        powerup.active = !!m.pu;
        if (m.pu) { powerup.x = field.x + scaleIn(m.pu[0], true); powerup.y = field.y + scaleIn(m.pu[1], false); }
    }

    blasters = [];
    if (m.bl) {
        for (var b = 0; b < m.bl.length; b++) {
            var q = m.bl[b];
            var alongY = SEAT_AXIS[q[5]] === "y";
            blasters.push({
                x: field.x + scaleIn(q[0], true), y: field.y + scaleIn(q[1], false),
                vx: q[2], vy: q[3],
                w: alongY ? BLASTER_LONG : BLASTER_THICK,
                h: alongY ? BLASTER_THICK : BLASTER_LONG,
                hot: !!q[4], from: q[5], active: true
            });
        }
    }

    // Sound goals off the CHANGED NUMBER rather than off an event.
    if (prevGoals && m.G) {
        for (var g = 0; g < 4; g++) {
            if (m.G[g] > prevGoals[g]) { sfxGoal(g); break; }
        }
    }
    if (prevPhase !== "over" && m.ph === "over") {
        if (winnerSeat === net.mySeat) sfxWin(); else sfxLose();
    }
}

// ===================================================
//   DEAD RECKONING
// ===================================================
// Between bounces the ball travels in a straight line at constant velocity, so
// a client can carry it forward from the last snapshot and hide almost all of
// the latency. The visible cost is a small correction at each bounce, blended
// over NET_BLEND_MS rather than snapped -- a snap reads as a glitch, a blend
// reads as the ball simply being where it is.
function netExtrapolate(dtMs) {
    if (!net.on || net.host || !net.snap) return;
    var dt = dtMs / 1000;

    if (ball) {
        ball.x += ball.vx * dt;
        ball.y += ball.vy * dt;
    }
    for (var b = 0; b < blasters.length; b++) {
        blasters[b].x += blasters[b].vx * dt;
        blasters[b].y += blasters[b].vy * dt;
    }
    // Remote paddles ease toward their last reported position instead of
    // stepping 20 times a second.
    for (var i = 0; i < 4; i++) {
        if (i === net.mySeat || !seats[i] || seats[i].kind === EMPTY) continue;
        if (seats[i].netTarget === undefined) continue;
        seats[i].pos += (seats[i].netTarget - seats[i].pos) * Math.min(1, dt * 14);
    }
}

// ===================================================
//   CLIENT -> HOST
// ===================================================
function sendPaddle() {
    if (!net.on || net.host || net.mySeat < 0) return;
    if (!MP.canSend("pad", NET_PAD_MS)) return;
    var s = seats[net.mySeat];
    if (!s) return;
    var along = (SEAT_AXIS[net.mySeat] === "y");
    // Sent in FIELD-LOCAL units so the host can scale it into its own field.
    MP.send({
        t: "p",
        v: Math.round(s.pos * 10) / 10,
        f: along ? field.h : field.w,        // scale for `v` (the slide axis)
        d: Math.round(s.depth),
        fd: along ? field.w : field.h        // scale for `d` (the depth axis)
    });
}

function sendFire() {
    if (!net.on || net.mySeat < 0) return false;
    if (net.host) return false;          // the host fires locally
    MP.send({ t: "f" });
    return true;
}

function sendStart() {
    if (!net.on) return false;
    if (net.host) return false;
    MP.send({ t: "go" });
    return true;
}

// ===================================================
//   HOST <- CLIENT
// ===================================================
// Applied once per simulation step, before physics, so a paddle the host has
// just been told about is in place when the ball is tested against it.
function applyRemoteInputs() {
    if (!net.host || !net.on) return;
    for (var seat = 0; seat < 4; seat++) {
        var owner = net.ownerOf[seat];
        if (!owner || owner === MP.selfId) continue;
        var inp = net.inputs[owner];
        if (!inp) continue;
        var s = seats[seat];
        if (!s || s.kind !== HUMAN) continue;

        if (typeof inp.v === "number") {
            var along = (SEAT_AXIS[seat] === "y");
            var theirSpan = inp.f || (along ? field.h : field.w);
            var mySpan = along ? field.h : field.w;
            var want = inp.v * (mySpan / (theirSpan || mySpan));
            var span = slideSpan(s);
            s.pos = clamp(want, span.min + s.long / 2, span.max - s.long / 2);
            s.frac = (span.max - span.min) > 0 ? (s.pos - span.min) / (span.max - span.min) : 0.5;
        }
        if (typeof inp.d === "number") {
            // Depth is sent in the sender's field units too, and now applies on
            // every seat rather than only in the two-paddle game.
            var dSpan = (SEAT_AXIS[seat] === "y") ? field.w : field.h;
            var theirD = inp.fd || dSpan;
            s.depth = clamp(inp.d * (dSpan / (theirD || dSpan)), 0, maxDepth(seat));
        }
        if (inp.fire) { inp.fire = false; tryFire(s); }
    }
}

// ===================================================
//   WIRING
// ===================================================
function onNetMessage(payload, from) {
    if (!payload || !payload.t) return;

    if (payload.t === "s") {
        if (net.host) return;                    // the host is the source
        applySnapshot(payload);   // sets each remote seat's netTarget itself
        return;
    }

    if (payload.t === "seat") {
        if (net.host) return;
        applySeatMap(payload.m, payload.n);
        return;
    }

    if (payload.t === "p") {
        if (!net.host) return;
        var rec = net.inputs[from] || (net.inputs[from] = {});
        rec.v = payload.v; rec.d = payload.d; rec.f = payload.f; rec.fd = payload.fd;
        return;
    }

    if (payload.t === "f") {
        if (!net.host) return;
        var r2 = net.inputs[from] || (net.inputs[from] = {});
        r2.fire = true;
        return;
    }

    if (payload.t === "go") {
        if (!net.host) return;
        startMatch();
        return;
    }
}

function netConnect() {
    if (typeof MP === "undefined" || mpConnected) return;
    mpConnected = true;
    MP.connect({
        game: "four-d-pong",
        onReady: function (info) {
            if (MP.selfColor) identity.color = MP.selfColor;
            if (MP.selfName) identity.name = MP.selfName;
            net.host = !!(info && info.isHost);
            if (MP.status() === "online") assignSeats();
            updateNetHud();
        },
        onPeerSync: function () { if (net.host) assignSeats(); updateNetHud(); },
        onPeerJoin: function () {
            // A joiner takes an AI seat straight away rather than waiting for
            // the next match. This is a friend group; somebody arriving two
            // minutes late should get to play, and the AI was only ever a
            // placeholder holding the chair.
            if (net.host) assignSeats();
            updateNetHud();
        },
        onPeerLeave: function () { if (net.host) assignSeats(); updateNetHud(); },
        onHostChange: function (amHost) {
            net.host = amHost;
            // Free: the new host already holds the last snapshot, so it adopts
            // that as truth and simulates on from there.
            if (amHost) assignSeats();
            updateNetHud();
        },
        onStatus: function () { updateNetHud(); },
        onMessage: onNetMessage
    });
}

// ===================================================
//   HUD
// ===================================================
// When two or more people are in the room the game engages online play BY
// ITSELF and locks the local mode buttons. Seats are assigned by the host, so a
// button that lets one player choose "2P" while the room holds three is a
// desync with a UI affordance attached to it. Locking is one line and removes
// the whole class of confusion -- which matters more than usual for a game
// whose first outing is three friends on a call.
function updateNetHud() {
    if (!netStatusEl) return;
    var st = (typeof MP === "undefined") ? "solo" : MP.status();
    var locked = false;
    var warn = false;
    var text = "";

    if (st === "connecting") {
        text = "CONNECTING…";
        warn = true;
    } else if (st !== "online") {
        // Not a failure: file:// double-click has no server and never will, and
        // that is a hard constraint rather than a degraded mode.
        text = "OFFLINE · LOCAL PLAY ONLY";
    } else if (net.humans < 2) {
        text = "ROOM " + (MP.room || "PUBLIC") + " · WAITING FOR PLAYERS · SHARE THE ROOM CODE";
        warn = true;
    } else {
        locked = true;
        var seat = net.spectator ? "SPECTATING" : SEAT_NAMES[net.mySeat];
        var cpu = (net.humans === 3) ? " · CPU ON BOTTOM" : "";
        text = "ROOM " + (MP.room || "PUBLIC") + " · " + net.humans + " PLAYERS · YOU ARE " +
               seat + (net.host ? " (HOST)" : "") + cpu;
    }

    netStatusEl.textContent = text;
    netStatusEl.classList.toggle("warn", warn);
    modeRowEl.classList.toggle("locked", locked);

    var btns = modeRowEl.querySelectorAll("button");
    for (var i = 0; i < btns.length; i++) btns[i].disabled = locked;
    if (locked) { diffRowEl.hidden = true; diffLabelEl.hidden = true; }

    if (startBtnEl) {
        startBtnEl.textContent = (locked && !net.host) ? "READY" : "START";
    }
}
