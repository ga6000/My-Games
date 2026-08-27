// ===================================================
//   MP — shared multiplayer core for My-Games
// ===================================================
// Loaded by every multiplayer game as a CLASSIC script tag:
//
//     <script src="../shared/mp-core.js"></script>
//
// Deliberately NOT an ES module: the project's hard constraint is that
// games run by double-click over file://, and browsers refuse to load
// type="module" from file://. Classic scripts load fine there.
//
// Everything hangs off ONE global (window.MP) on purpose. Classic
// scripts all share one global scope, so every extra top-level name is
// a chance to collide with a game's own variables -- see
// scripts/check-global-collisions.js, which enforces exactly this.
//
// ---------------------------------------------------------------
// WHY THIS EXISTS: the seed problem
// ---------------------------------------------------------------
// Every game in this repo builds its world with unseeded Math.random().
// That's invisible in Gyro Space because it only ever syncs ships --
// its asteroids genuinely differ per player and nobody notices, they're
// scenery. It is NOT survivable in a game where the world IS the game:
// two players would collide with walls the other cannot see.
//
// So the server hands every client in a room the SAME seed, and games
// call MP.random() instead of Math.random() for anything world-shaped
// (level layout, spawn points, item placement). Same seed in ->
// identical world out, on every screen.
//
// Use MP.random() for world generation. Keep Math.random() for
// cosmetic, per-client things (particle jitter, screen shake) where
// divergence is harmless and syncing would be wasteful.

(function () {
    "use strict";

    var DEFAULT_SERVER = "wss://my-games-faxi.onrender.com";

    // How long to wait for the socket before giving up and starting a
    // solo game. Render's free tier cold-starts in tens of seconds, but
    // making a player stare at a dead screen that long is worse than
    // just letting them play alone -- MP keeps trying in the background
    // and promotes them to multiplayer if it connects later.
    var CONNECT_TIMEOUT_MS = 6000;
    var RECONNECT_MS = 3000;

    // ---- internal state ----
    var socket = null;
    var selfId = null;
    var hostId = null;
    var roomSeed = null;
    var peers = {};             // id -> {id, name, color}
    var opts = null;
    var status = "idle";        // idle | connecting | online | solo
    var readyFired = false;
    var timers = [];
    var abort = null;
    var throttleMarks = {};
    var rngState = 0;
    var rng = null;

    // ---- timers, tracked so destroy() can actually tear down ----
    function trackTimeout(fn, ms) {
        var t = setTimeout(fn, ms);
        timers.push(t);
        return t;
    }
    function trackInterval(fn, ms) {
        var t = setInterval(fn, ms);
        timers.push(t);
        return t;
    }
    function clearAllTimers() {
        for (var i = 0; i < timers.length; i++) {
            clearTimeout(timers[i]);
            clearInterval(timers[i]);
        }
        timers = [];
    }

    // ---- seeded PRNG (mulberry32) ----
    // Small, fast, and good enough for level layout. Deterministic for a
    // given seed across every browser -- integer ops only, no floating
    // point accumulation, so it can't drift the way a float simulation
    // can.
    function mulberry32(a) {
        return function () {
            a |= 0;
            a = (a + 0x6D2B79F5) | 0;
            var t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    function setSeed(seed) {
        roomSeed = seed | 0;
        rngState = roomSeed;
        rng = mulberry32(roomSeed);
    }

    // Seeded from the clock until the server supplies the real one, so
    // MP.random() is always callable -- a game that runs solo over
    // file:// never has to special-case "no seed yet".
    setSeed((Date.now() & 0x7fffffff));

    // ---- identity ----
    // Reads the same URL params and localStorage keys the hub writes, so
    // a player who entered their name once on index.html is recognised
    // in every game without retyping it.
    function readIdentity(override) {
        var params = {};
        try {
            params = new URLSearchParams(window.location.search);
        } catch (e) {
            params = { get: function () { return null; } };
        }

        var name = (override && override.name) ||
            params.get("name") ||
            safeLocalGet("gamehub_playerName") ||
            "";

        var room = (override && override.room) ||
            params.get("room") ||
            safeLocalGet("gamehub_roomCode") ||
            "";

        return {
            name: String(name).slice(0, 20),
            room: String(room).trim().toUpperCase()
        };
    }

    function safeLocalGet(key) {
        // localStorage throws in some file:// / private-mode contexts.
        try {
            return localStorage.getItem(key) || "";
        } catch (e) {
            return "";
        }
    }

    function serverUrl() {
        // ?server=ws://localhost:8123 makes local testing against a
        // dev server possible without editing this file.
        try {
            var p = new URLSearchParams(window.location.search).get("server");
            if (p) return p;
        } catch (e) { /* fall through to default */ }
        return (opts && opts.url) || DEFAULT_SERVER;
    }

    function fire(name) {
        var fn = opts && opts[name];
        if (typeof fn !== "function") return;
        var args = Array.prototype.slice.call(arguments, 1);
        try {
            fn.apply(null, args);
        } catch (e) {
            console.error("MP: error in " + name, e);
        }
    }

    function setStatus(s) {
        if (status === s) return;
        status = s;
        fire("onStatus", s);
    }

    // Starts the game whether or not the network came up. Called once.
    function fireReady() {
        if (readyFired) return;
        readyFired = true;
        fire("onReady", {
            selfId: selfId,
            seed: roomSeed,
            isHost: isHost(),
            solo: status !== "online",
            peers: peerList()
        });
    }

    function peerList() {
        var out = [];
        for (var id in peers) {
            if (Object.prototype.hasOwnProperty.call(peers, id)) out.push(peers[id]);
        }
        return out;
    }

    function isHost() {
        // Solo players are their own host -- a game running alone still
        // needs someone to simulate the shared world, and that's them.
        if (status !== "online") return true;
        return !!selfId && selfId === hostId;
    }

    function connect() {
        var url = serverUrl();
        setStatus("connecting");

        try {
            socket = new WebSocket(url);
        } catch (e) {
            goSolo();
            return;
        }

        // If the socket hasn't opened in time, start the game solo
        // rather than hanging on a black screen. A later successful
        // open still upgrades the session to multiplayer.
        trackTimeout(function () {
            if (status === "connecting") goSolo();
        }, CONNECT_TIMEOUT_MS);

        socket.onopen = function () {
            var ident = readIdentity(opts);
            socket.send(JSON.stringify({
                type: "join-room",
                game: opts.game,
                room: ident.room,
                name: ident.name
            }));
        };

        socket.onmessage = function (ev) {
            var data;
            try {
                data = JSON.parse(ev.data);
            } catch (e) {
                return;
            }
            handle(data);
        };

        socket.onclose = function () {
            if (status === "online") setStatus("solo");
            // Keep trying. If the player is mid-game solo, a successful
            // reconnect quietly restores multiplayer.
            trackTimeout(connect, RECONNECT_MS);
        };

        socket.onerror = function () {
            // onclose always follows, which owns the retry.
        };
    }

    function goSolo() {
        setStatus("solo");
        fireReady();
    }

    function handle(data) {
        if (data.type === "welcome") {
            selfId = data.id;
            return;
        }

        if (data.type === "players") {
            setStatus("online");

            if (data.you) {
                selfId = data.you.id;
                MP.selfName = data.you.name;
                MP.selfColor = data.you.color;
            }

            hostId = data.hostId;

            // The seed is the whole point of this handshake. Set it
            // BEFORE onReady fires so the game generates its world from
            // the shared seed on its very first frame.
            if (typeof data.seed === "number") setSeed(data.seed);

            peers = {};
            (data.players || []).forEach(function (p) {
                peers[p.id] = p;
            });

            MP.room = data.room;
            MP.selfId = selfId;

            fireReady();
            fire("onPeerSync", peerList());
            return;
        }

        if (data.type === "join" && data.player) {
            peers[data.player.id] = data.player;
            fire("onPeerJoin", data.player);
            return;
        }

        if (data.type === "leave") {
            var gone = peers[data.id];
            delete peers[data.id];
            fire("onPeerLeave", gone || { id: data.id, name: data.name });
            return;
        }

        if (data.type === "host") {
            var was = isHost();
            hostId = data.hostId;
            var now = isHost();
            if (was !== now) fire("onHostChange", now, hostId);
            return;
        }

        if (data.type === "relay") {
            fire("onMessage", data.payload, data.from, data.name);
            return;
        }
    }

    // ---- public API ----
    var MP = {
        selfId: null,
        selfName: "",
        selfColor: null,
        room: "",

        // Start a session. Safe to call once per page.
        connect: function (o) {
            opts = o || {};
            if (!opts.game) {
                console.error("MP.connect: a 'game' id is required (used to namespace rooms)");
                return MP;
            }
            readyFired = false;
            abort = new AbortController();
            connect();
            return MP;
        },

        // Broadcast an arbitrary payload to everyone else in the room.
        // The server relays it untouched -- games define their own
        // payload shapes and need no server change to add a new one.
        send: function (payload, echo) {
            if (!socket || socket.readyState !== WebSocket.OPEN) return false;
            socket.send(JSON.stringify({
                type: "relay",
                payload: payload,
                echo: !!echo
            }));
            return true;
        },

        // Rate-limit a repeating broadcast. Returns true at most once
        // per intervalMs for a given key. Every game needs this for
        // position updates, so it lives here rather than four times.
        //
        //   if (MP.canSend("pos", 100)) MP.send({...});
        canSend: function (key, intervalMs) {
            var now = (typeof performance !== "undefined" ? performance.now() : Date.now());
            var last = throttleMarks[key] || 0;
            if (now - last < intervalMs) return false;
            throttleMarks[key] = now;
            return true;
        },

        // Deterministic, room-shared random in [0,1). Use for anything
        // that must look identical on every screen.
        random: function () {
            return rng();
        },

        randomInt: function (min, max) {
            return Math.floor(rng() * (max - min + 1)) + min;
        },

        // Restart the sequence from the room seed. Call at the start of
        // world generation so a regenerated level matches everyone
        // else's, rather than continuing a stream that's already been
        // advanced a different number of times on each client.
        resetRandom: function () {
            rng = mulberry32(roomSeed);
        },

        seed: function () {
            return roomSeed;
        },

        // Override the seed locally. Mainly for testing determinism.
        reseed: function (s) {
            setSeed(s);
        },

        isHost: isHost,
        peers: peerList,
        status: function () {
            return status;
        },

        // Tear everything down: timers, listeners, socket. The project's
        // hard constraint is that a game instance can be fully disposed.
        destroy: function () {
            clearAllTimers();
            if (abort) {
                abort.abort();
                abort = null;
            }
            if (socket) {
                socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
                try {
                    socket.close();
                } catch (e) { /* already closing */ }
                socket = null;
            }
            peers = {};
            selfId = null;
            hostId = null;
            readyFired = false;
            status = "idle";
        },

        // Exposed so games can attach their own listeners to the same
        // lifetime: addEventListener(..., {signal: MP.signal()})
        signal: function () {
            return abort ? abort.signal : undefined;
        }
    };

    window.MP = MP;
})();
