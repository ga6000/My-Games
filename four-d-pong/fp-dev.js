/**
 * 4D Pong — dev tools registration (2026-09-07)
 *
 * Everything the L+G panel shows and does for this game, in its own file so it
 * can be removed by deleting one <script> tag. Loads LAST, after fp-boot.js.
 *
 * ---------------------------------------------------------------------------
 * THIS IS THE GAME THE L+G COMBO ACTUALLY COLLIDES WITH
 * ---------------------------------------------------------------------------
 * SEAT_KEYS in fp-input.js:
 *
 *     TOP    (2)   F/H move,  T/G in-out,  Y fire
 *     BOTTOM (3)   J/L move,  I/K in-out,  O fire
 *
 * KeyG and KeyL are LIVE GAMEPLAY KEYS in the 3P and 4P couch modes, held by
 * two different people sitting at one keyboard. TOP holding G while BOTTOM
 * holds L is ordinary play, not a coincidence — so a bare L+G gate would open
 * a modal overlay in the middle of somebody's rally.
 *
 * A dwell timer does not fix it. Those keys get held for seconds at a time;
 * any dwell short enough to be usable is shorter than a normal movement press.
 *
 * So this game supplies `armedWhen` instead, and the combo is simply not armed
 * while both of those seats are live humans mid-rally:
 *
 *   - 1P / 2P couch: TOP and BOTTOM are EMPTY, nothing owns G or L, and the
 *     combo works during play exactly like the other three games.
 *   - online: everyone drives their own seat with WASD/arrows (ONLINE_UP and
 *     friends), so L and G are unbound there too — armed during play.
 *   - 3P / 4P couch: pause with SPACE first, or open it from the menu or the
 *     game-over screen. Those are the only three seconds of friction in the
 *     whole feature and they are in the one mode that cannot afford a
 *     surprise overlay.
 *
 * The panel's own hint line says "L+G or ESC to close", which is true in every
 * mode — closing is always armed, because `isOpen` short-circuits the check.
 *
 * MATCH CONTROL IS OFFLINE-ONLY. Online, the host owns the ball, the
 * countdown and the seat map; a guest calling startMatch() locally desyncs
 * itself from everyone. Those buttons say so rather than lying.
 */
"use strict";

function fpDevCouchSeatLive(index) {
    var s = seats[index];
    return !!(s && s.kind === HUMAN);
}

function fpDevArmed() {
    // Menu, countdown, paused and game-over all leave the keyboard idle.
    if (phase !== "play") return true;
    // Online binds neither key — see ONLINE_UP/DOWN/LEFT/RIGHT in fp-input.js.
    if (net.on) return true;
    return !fpDevCouchSeatLive(TOP) && !fpDevCouchSeatLive(BOTTOM);
}

function fpDevOfflineOnly(what) {
    return net.on ? (what + " — OFFLINE ONLY (the host owns the match online)") : null;
}

function fpDevSeatLine(i) {
    var s = seats[i];
    if (!s) return "-";
    return SEAT_NAMES[i] + " " + s.kind +
           "  goals " + s.goals +
           "  len " + Math.round(s.long) +
           (s.desperate ? "  DESPERATE" : "") +
           (s.stunned ? "  STUNNED" : "");
}

function fpDevReport() {
    var rows = [
        ["phase", phase + (countdown > 0 ? "  (" + countdown + ")" : "") +
                  (attractRunning ? "  ATTRACT" : "")],
        ["mode", mode.label + "   key " + modeKey + "   axes " + mode.axes +
                 (mode.players === 1 ? "   difficulty " + difficulty : "")],
        ["winner", winnerSeat >= 0 ? SEAT_NAMES[winnerSeat] : "-"]
    ];

    for (var i = 0; i < seats.length; i++) rows.push(["seat " + i, fpDevSeatLine(i)]);

    rows.push(["ball", ball
        ? Math.round(ball.x) + "," + Math.round(ball.y) +
          "   speed " + Math.round(ballSpeed()) + " / " + ballMaxSpeed()
        : "none"]);
    rows.push(["powerup", powerup && powerup.active
        ? Math.round(powerup.x) + "," + Math.round(powerup.y) : "not out"]);
    rows.push(["blasters", blasters.length + "   particles " + particles.length]);
    rows.push(["match age", matchStartAt
        ? Math.round((performance.now() - matchStartAt) / 1000) + "s" : "-"]);
    rows.push(["net", net.on
        ? ((net.host ? "HOST" : "guest") + "   seat " + net.mySeat +
           "   humans " + net.humans + (net.spectator ? "   SPECTATOR" : ""))
        : "offline (couch)"]);
    rows.push(["L+G armed", fpDevArmed()
        ? "yes"
        : "NO — 3P/4P couch binds G (TOP) and L (BOTTOM); pause first"]);
    return rows;
}

function fpDevGoal(seatIndex) {
    return function () {
        var no = fpDevOfflineOnly("goal");
        if (no) return no;
        if (phase !== "play" && phase !== "count") return "not in a match";
        // seats always holds four entries, EMPTY ones included -- so TOP and
        // BOTTOM exist as objects in 1P/2P and scoreGoal() would happily move
        // a rope on behalf of a seat that is not on the field.
        if (!seats[seatIndex] || seats[seatIndex].kind === EMPTY) {
            return SEAT_NAMES[seatIndex] + " is not in play in " + mode.label;
        }
        // scoreGoal takes the seat that CONCEDED — it is the rope-mover, and
        // tugScore() decides who gets credit on a four-goal field.
        scoreGoal(seatIndex);
        return SEAT_NAMES[seatIndex] + " conceded";
    };
}

var fpDevActions = [
    { label: "GOAL ON LEFT",   hint: "left concedes",   fn: fpDevGoal(LEFT) },
    { label: "GOAL ON RIGHT",  hint: "right concedes",  fn: fpDevGoal(RIGHT) },
    { label: "GOAL ON TOP",    hint: "top concedes",    fn: fpDevGoal(TOP) },
    { label: "GOAL ON BOTTOM", hint: "bottom concedes", fn: fpDevGoal(BOTTOM) },
    {
        label: "NEW MATCH",
        hint: "offline only",
        fn: function () {
            var no = fpDevOfflineOnly("new match");
            if (no) return no;
            startMatch();
            return "counting down";
        }
    },
    {
        label: "END MATCH",
        hint: "offline only — shows the over screen",
        fn: function () {
            var no = fpDevOfflineOnly("end match");
            if (no) return no;
            // Whoever is ahead, so the winner card is not a lie. Ties go to
            // LEFT, which is the seat that always exists.
            var best = LEFT;
            for (var i = 1; i < seats.length; i++) {
                if (seats[i] && seats[i].goals > seats[best].goals) best = i;
            }
            endMatch(best);
            return SEAT_NAMES[best] + " wins";
        }
    },
    {
        label: "BACK TO MENU",
        danger: true,
        fn: function () {
            showMenu();
            return "menu";
        }
    },
    {
        label: "PAUSE / RESUME",
        hint: "offline only",
        fn: function () {
            var no = fpDevOfflineOnly("pause");
            if (no) return no;
            if (phase === "play") { setPhase("paused"); return "paused"; }
            if (phase === "paused") { setPhase("play"); return "playing"; }
            return "not in a match (" + phase + ")";
        }
    },
    {
        label: "SERVE BALL",
        hint: "offline only",
        fn: function () {
            var no = fpDevOfflineOnly("serve");
            if (no) return no;
            // -1 lets serveBall pick from the full circle, which is the point
            // of it on a four-goal field.
            serveBall(-1);
            return "served";
        }
    },
    {
        label: "FREEZE BALL",
        hint: "for looking at geometry",
        fn: function () {
            if (!ball) return "no ball";
            if (ball.vx === 0 && ball.vy === 0) {
                serveBall(-1);
                return "unfrozen — re-served";
            }
            ball.vx = 0;
            ball.vy = 0;
            return "frozen at " + Math.round(ball.x) + "," + Math.round(ball.y);
        }
    },
    {
        label: "SPAWN POWERUP",
        fn: function () {
            spawnPowerup();
            return "out at " + Math.round(powerup.x) + "," + Math.round(powerup.y);
        }
    },
    {
        label: "CYCLE MODE",
        hint: "1P -> 2P -> 3P -> 4P",
        fn: function () {
            var no = fpDevOfflineOnly("mode");
            if (no) return no;
            // applyMode is the ONLY path that produces a seat array — going
            // through it is what stops a demo's CPU seats surviving into a
            // real match, and the same reasoning applies to a dev button.
            applyMode(modeKey >= 4 ? 1 : modeKey + 1);
            showMenu();
            return mode.label;
        }
    },
    {
        label: "CYCLE CPU SKILL",
        hint: "1P only",
        fn: function () {
            var no = fpDevOfflineOnly("difficulty");
            if (no) return no;
            difficulty = difficulty === "easy" ? "medium"
                       : difficulty === "medium" ? "hard" : "easy";
            // Re-running applyMode is what actually re-attaches the AI at the
            // new level; setting the variable alone changes nothing until the
            // next mode change.
            applyMode(modeKey);
            return difficulty;
        }
    }
];

if (typeof DEVTOOLS !== "undefined") {
    DEVTOOLS.init({
        game: "four-d-pong",
        armedWhen: fpDevArmed,
        onOpen: function () {
            // releaseAll() empties the `held` map fp-input polls every fixed
            // step. Without it a paddle keeps sliding behind the overlay, and
            // in a four-player game that is somebody else's paddle.
            releaseAll();
        },
        report: fpDevReport,
        actions: fpDevActions
    });
}
