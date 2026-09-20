/*
 * shared/leaderboard.js — score submission to Firestore, for any game.
 *
 * Classic script, one global (`LB`).
 *
 *     <script src="../shared/leaderboard.js"></script>
 *     LB.configure({ game: "glass-city-escape" });
 *     LB.submit({ player: name, score: 1250, room: roomCode });
 *     LB.submit({ player: name, score: 1250, round: 7, room: roomCode });   // round is optional
 *
 * WHAT THIS REPLACES
 * Today exactly one game submits scores, and it does it with ~40 lines of
 * inline <script type="module"> in gyro-space/space-tracer.html. Five more
 * games need the same thing. This is that block, once, behind three lines.
 *
 * ---------------------------------------------------------------------------
 * HOW A CLASSIC SCRIPT LOADS FIREBASE AT ALL
 * ---------------------------------------------------------------------------
 * The Firestore SDK and firebase-config.js are ES modules, and this repo bans
 * module <script> tags because file:// refuses them. The way out is dynamic
 * `import()`, which is legal INSIDE a classic script and returns a promise —
 * so a failure is catchable rather than a parse error.
 *
 * That is what makes the file:// degradation clean instead of special-cased:
 * on a double-clicked page the import rejects (a file: origin cannot fetch a
 * cross-origin module), we catch it, mark ourselves unavailable, and every
 * submit() after that is a silent no-op. The game never knows. This is the
 * behaviour GAME_PROTOTYPE_INSTRUCTIONS.md §1 requires: "everything else on
 * the page works; only the score-submission piece silently no-ops."
 *
 * firebase-config.js is resolved from THIS FILE's own URL rather than a
 * relative path, because a relative specifier in an injected module resolves
 * against the document, not the script — so "../firebase-config.js" would mean
 * something different in gyro-space/ than in under-development/boids/. Deriving
 * it from the script URL makes the depth irrelevant.
 *
 * ---------------------------------------------------------------------------
 * NO TIMERS, NO LISTENERS
 * ---------------------------------------------------------------------------
 * Nothing here needs tracking under the root CLAUDE.md teardown rule. The only
 * async is promises, and destroy() drops the queue.
 */
(function (global) {
    "use strict";

    var FIREBASE_VERSION = "10.13.0";   // matches leaderboard.html and space-tracer
    var CDN = "https://www.gstatic.com/firebasejs/" + FIREBASE_VERSION + "/";

    // Bounded so a game submitting in a loop on a dead connection cannot grow
    // this without limit. Scores are not important enough to leak memory over.
    var MAX_QUEUE = 32;

    var gameId = null;
    var collectionName = "scores";
    var writer = null;          // set once the SDK is up
    var state = "idle";         // idle | loading | ready | unavailable
    var queue = [];
    var warned = false;

    /*
     * Captured at load time. document.currentScript is only valid while the
     * script is executing, so this cannot be deferred to first use. The
     * querySelector fallback covers a defer/async tag, where currentScript is
     * null.
     */
    var selfUrl = (function () {
        try {
            if (global.document && document.currentScript && document.currentScript.src) {
                return document.currentScript.src;
            }
            if (global.document) {
                var tags = document.querySelectorAll('script[src*="leaderboard.js"]');
                if (tags.length) return tags[tags.length - 1].src;
            }
        } catch (e) { /* fall through */ }
        return null;
    })();

    function configUrl() {
        // firebase-config.js lives at the repo root; this file is in shared/.
        if (!selfUrl) return null;
        try { return new global.URL("../firebase-config.js", selfUrl).href; }
        catch (e) { return null; }
    }

    function configure(opts) {
        var o = opts || {};
        if (o.game) gameId = String(o.game);
        if (o.collection) collectionName = String(o.collection);
        // A game that loads this file intends to submit, so start the SDK now
        // rather than on the first score. Space Tracer's inline block does the
        // same, for the same reason: a game-over submit should not also be
        // waiting on a ~100 KB SDK download and an auth round-trip.
        if (o.preload !== false) preload();
    }

    function preload() {
        if (state !== "idle") return;
        var cfgUrl = configUrl();
        if (!cfgUrl) { unavailable("could not resolve firebase-config.js from " + selfUrl); return; }

        state = "loading";
        Promise.all([
            import(CDN + "firebase-app.js"),
            import(CDN + "firebase-firestore.js"),
            import(CDN + "firebase-auth.js"),
            import(cfgUrl)
        ]).then(function (mods) {
            var appMod = mods[0], fsMod = mods[1], authMod = mods[2], cfgMod = mods[3];
            var app = appMod.initializeApp(cfgMod.firebaseConfig);
            var db = fsMod.getFirestore(app);

            /*
             * Anonymous auth exists only to give Firestore security rules
             * something to check ("request.auth != null") without making
             * friends create accounts. It is deliberately NOT awaited before
             * marking ready: a rules setup that does not require auth should
             * still accept writes, and a failed sign-in should degrade to
             * "writes may be rejected", not "leaderboard is dead".
             */
            try {
                authMod.signInAnonymously(authMod.getAuth(app)).catch(function (err) {
                    note("anonymous auth failed; writes may be rejected by rules", err);
                });
            } catch (e) { /* auth module shape changed; not fatal */ }

            writer = function (doc) {
                var data = {
                    game: doc.game,
                    player: doc.player,
                    score: doc.score,
                    room: doc.room,
                    timestamp: fsMod.serverTimestamp()
                };
                // Only games with rounds send one; the rest keep the original
                // five-field shape rather than writing round: null.
                if (doc.round != null) data.round = doc.round;
                return fsMod.addDoc(fsMod.collection(db, collectionName), data);
            };
            state = "ready";
            flush();
        }).catch(function (err) {
            // The expected path on file://, and on any machine with no network.
            unavailable(err && err.message ? err.message : String(err));
        });
    }

    function unavailable(why) {
        state = "unavailable";
        writer = null;
        queue.length = 0;
        note("score submission is off (this is expected on file:// — open over http(s) to record scores)", why);
    }

    // One line, once. A game calling submit() every death must not produce a
    // console full of the same message on a page that will never have Firebase.
    function note(msg, detail) {
        if (warned) return;
        warned = true;
        if (global.console && console.info) console.info("LB: " + msg, detail || "");
    }

    /*
     * Room normalisation — this fixes a real mismatch rather than inheriting it.
     *
     * The hub stores its default room as "PUBLIC" (index.html: `myRoom =
     * (room || "public").toUpperCase()`), and shared/mp-core.js uppercases every
     * room code too. But leaderboard.html filters the public view with
     * where("room", "==", "public") — LOWERCASE. So a score submitted from a
     * hub-launched game lands as "PUBLIC" and never appears under the public
     * filter that is supposed to show it.
     *
     * Canonical form here: the public room is lowercase "public"; every named
     * room is uppercase. That makes new scores match the filter that already
     * exists. Scores already written as "PUBLIC" stay invisible to it — fixing
     * those is a data migration, not a code change.
     *
     * Superseded 2026-09-18: leaderboard.html no longer filters by room at all
     * (every room counts toward one board per game), so the mismatch above is
     * moot for display. The normalisation is kept so `room` stays consistent
     * in the log in case a room view ever comes back.
     */
    function normalizeRoom(room) {
        var r = String(room == null ? "" : room).trim();
        if (!r || r.toLowerCase() === "public") return "public";
        return r.toUpperCase();
    }

    /*
     * Fire and forget. Returns nothing to await on purpose — this is called
     * from game-over paths, and a caller that awaits a leaderboard write is a
     * caller that can be blocked by a slow network at the worst moment.
     */
    function submit(entry) {
        var e = entry || {};
        var game = e.game || gameId;
        if (!game) {
            if (global.console && console.warn) {
                console.warn("LB.submit: no game id. Call LB.configure({ game: '...' }) first.");
            }
            return;
        }

        var score = Number(e.score);
        // Guard here rather than at the call site: NaN reaches Firestore
        // happily and then breaks leaderboard.html's sort, which is a long way
        // from the cause.
        if (!isFinite(score)) return;

        var doc = {
            game: String(game),
            player: String(e.player || "Anonymous").slice(0, 32) || "Anonymous",
            score: Math.round(score),
            room: normalizeRoom(e.room)
        };
        // Optional: the round/wave the run reached, for a game whose score is
        // something else. Zombie since 2026-09-19 — before that its score WAS
        // the round, so the board could not show both. leaderboard.html gives
        // it its own column.
        var round = Number(e.round);
        if (e.round != null && isFinite(round)) doc.round = Math.round(round);

        if (state === "unavailable") return;
        if (state === "idle") preload();
        if (state !== "ready") {
            if (queue.length < MAX_QUEUE) queue.push(doc);
            return;
        }
        write(doc);
    }

    // A REJECTED WRITE RETRIES ONCE WITHOUT THE OPTIONAL FIELDS (2026-09-20).
    //
    // `round` is optional and was added on 2026-09-19. If the Firestore rules
    // whitelist field names -- which they may, and which cannot be checked
    // from this repo because rules live in the console -- then a doc carrying
    // `round` is refused ENTIRELY and the whole run is lost over a column.
    // That is the wrong trade: the score is the point, the round is a nicety,
    // and leaderboard.html already knows how to read a doc that has a score
    // and no round.
    //
    // Measured 2026-09-20: 182 docs in the collection, every one written
    // before `round` existed, and ZERO with `game: "zombie"` -- which is what
    // a rules rejection of the new field would look like from outside.
    var OPTIONAL_KEYS = ["round"];

    function write(doc, isRetry) {
        try {
            writer(doc).catch(function (err) {
                var code = (err && (err.code || err.message)) || String(err);
                var hasOptional = false;
                for (var i = 0; i < OPTIONAL_KEYS.length; i++) {
                    if (doc[OPTIONAL_KEYS[i]] !== undefined) hasOptional = true;
                }
                if (!isRetry && hasOptional) {
                    var bare = {};
                    for (var k in doc) {
                        if (!Object.prototype.hasOwnProperty.call(doc, k)) continue;
                        if (OPTIONAL_KEYS.indexOf(k) === -1) bare[k] = doc[k];
                    }
                    note("score write refused (" + code + ") -- retrying without " +
                         OPTIONAL_KEYS.join("/"));
                    write(bare, true);
                    return;
                }
                // Never let a failed write break gameplay. This is called from
                // a death/finish handler the player should never see fail. Say
                // WHICH write failed, though: the old message was a bare
                // "score write failed" with no game and no score in it.
                if (global.console && console.warn) {
                    console.warn("LB: score write failed for game '" + doc.game +
                                 "' (score " + doc.score + ", player " + doc.player +
                                 "): " + code, err);
                }
            });
        } catch (e) {
            if (global.console && console.warn) console.warn("LB: score write threw", e);
        }
    }

    function flush() {
        if (state !== "ready") return;
        var pending = queue.slice();
        queue.length = 0;
        for (var i = 0; i < pending.length; i++) write(pending[i]);
    }

    function available() { return state === "ready"; }
    function status() { return state; }

    /*
     * Diagnostics. The URL derivation is the one genuinely non-obvious thing in
     * this file — it is what makes the same script work from gyro-space/ and
     * from under-development/<game>/ — so it is worth being able to inspect it
     * without a debugger. shared/selftest.html asserts against this.
     */
    function debug() {
        return { selfUrl: selfUrl, configUrl: configUrl(), state: state, game: gameId, collection: collectionName };
    }

    function destroy() {
        queue.length = 0;
        // `writer` and the loaded SDK are intentionally kept: the modules are
        // cached by the browser anyway, and a game that re-inits should not pay
        // the download again.
    }

    global.LB = {
        configure: configure,
        preload: preload,
        submit: submit,
        available: available,
        status: status,
        debug: debug,
        destroy: destroy
    };
})(typeof window !== "undefined" ? window : this);
