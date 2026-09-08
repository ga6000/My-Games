/**
 * Zombie — dev tools registration (2026-09-07)
 *
 * Everything the L+G panel shows and does for this game. Kept in its own file
 * for one reason: it should be deletable by removing a single <script> tag,
 * without a diff anywhere in the gameplay files.
 *
 * Loads LAST, after zombie-render.js. Only registration runs at load — the
 * callbacks below all execute later, so the names they read (round, zombies,
 * netIsHost, ...) are long since declared by the time any of them fires.
 *
 * ---------------------------------------------------------------------------
 * THIS GAME DOES NOT PAUSE WHILE THE PANEL IS OPEN
 * ---------------------------------------------------------------------------
 * The host simulates for the whole room. Pausing it locally would freeze
 * everybody else — the same call the field manual already makes for itself
 * ("The round does not pause while you read this"). onOpen therefore only
 * releases the local player's held keys, which is the one thing that would
 * otherwise leave someone walking into a wall behind the overlay.
 *
 * HOST-GATED ACTIONS. Round state, the zombie array and the scrap pool are all
 * host-authoritative — a guest writing to them locally gets one frame of a
 * lie, then the next broadcast overwrites it. Those buttons say so and return
 * a reason rather than pretending to work, because a dev button that silently
 * no-ops is worse than no button.
 */
"use strict";

// Toggled by the panel. Read nowhere else: god mode here is just a very long
// invulnerability window, which the game already understands natively.
var zDevGodOn = false;

function zDevPlayer() {
    return players[0] || null;
}

function zDevHostOnly(what) {
    return netIsHost ? null : (what + " — HOST ONLY (this client is a guest)");
}

function zDevReport() {
    const p = zDevPlayer();
    const now = Date.now();
    const rows = [
        ["round", round + "  (" + roundPhase + ", " + roundLabel(round) + ")"],
        ["budget left", roundBudget + (roundPhase === "intermission"
            ? "   next in " + Math.max(0, Math.ceil((roundEndsAt - now) / 1000)) + "s" : "")],
        ["zombies", zombies.length],
        ["bullets", bullets.length + " local / " + remoteBullets.length + " remote"],
        ["pickups", pickups.length],
        ["kills / scrap", kills + " / " + scrapPool],
        ["players", players.length + " local, " + Object.keys(remotePlayers).length + " remote"]
    ];

    if (p) {
        rows.push(["you", (p.downed ? "DOWNED" : "up") +
                          "   " + p.weapon +
                          "   cards " + (p.cards.length ? p.cards.join(",") : "none")]);
        rows.push(["ammo", JSON.stringify(p.ammo)]);
        rows.push(["god mode", zDevGodOn ? "ON" : "off"]);
    } else {
        rows.push(["you", "not spawned — move or click to join"]);
    }

    rows.push(["lights", generatorOn ? "GENERATOR ON" : "dark"]);
    rows.push(["endgame", "gate " + gateStage + "/" + GATE_STAGES +
                          "   silos " + siloFill.join("/") +
                          "   flood " + (floodActive ? floodRemaining : "no") +
                          "   escape " + (escapeAt ? (escapeOpen() ? "OPEN" : "opening") : "no")]);
    rows.push(["state", (gameStarted ? "started" : "menu") +
                        (gameOver ? " GAME OVER" : "") + (won ? " WON" : "")]);
    rows.push(["net", (netOnline ? "online" : "solo") +
                      (netIsHost ? " HOST" : " guest") +
                      "   room " + ((typeof MP !== "undefined" && MP.room) || "-") +
                      "   as " + ((typeof MP !== "undefined" && MP.selfName) || "-")]);
    return rows;
}

var zDevActions = [
    {
        label: "ROUND +1",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("round advance");
            if (no) return no;
            zombies.length = 0;
            startRound(round + 1);
            return "now round " + round;
        }
    },
    {
        label: "CLEAR ZOMBIES",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("clear");
            if (no) return no;
            const n = zombies.length;
            zombies.length = 0;
            return n + " removed";
        }
    },
    {
        label: "END ROUND",
        hint: "clears + empties budget",
        fn: function () {
            const no = zDevHostOnly("end round");
            if (no) return no;
            zombies.length = 0;
            roundBudget = 0;
            // The normal path: update() sees an empty field and no budget left
            // and calls endRound() itself, so the breather, the pickup and the
            // barricade repair all happen exactly as they would in play.
            return "field cleared, budget zeroed — round will end itself";
        }
    },
    {
        label: "RESET GAME",
        hint: "back to the start screen",
        danger: true,
        fn: function () {
            resetGame();
            return "reset";
        }
    },
    {
        label: "GOD MODE",
        hint: "toggle",
        fn: function () {
            zDevGodOn = !zDevGodOn;
            const p = zDevPlayer();
            // The game already gates downPlayer() on invulnUntil, so this
            // needs no gameplay edit at all — it is the mercy window from a
            // revive, held open indefinitely.
            if (p) p.invulnUntil = zDevGodOn ? Number.MAX_SAFE_INTEGER : 0;
            return zDevGodOn ? "ON" : "off";
        }
    },
    {
        label: "HEAL / REVIVE",
        fn: function () {
            const p = zDevPlayer();
            if (!p) return "no local player";
            p.downed = false;
            p.bleedDeadline = 0;
            p.reviveProgress = 0;
            p.invulnUntil = Math.max(p.invulnUntil, Date.now() + 3000);
            return "up, 3s mercy";
        }
    },
    {
        label: "REFILL AMMO",
        fn: function () {
            const p = zDevPlayer();
            if (!p) return "no local player";
            refillAmmo(p);
            return "full";
        }
    },
    {
        label: "+500 SCRAP",
        hint: "host only",
        fn: function () {
            // Spending is host-validated for a real reason (two clients
            // pressing buy on the same frame both pass a local affordability
            // check), so granting has to be too.
            const no = zDevHostOnly("scrap");
            if (no) return no;
            scrapPool += 500;
            return "pool now " + scrapPool;
        }
    },
    {
        label: "LIGHTS",
        hint: "toggle generator",
        fn: function () {
            generatorOn = !generatorOn;
            return generatorOn ? "lit" : "dark";
        }
    },
    {
        label: "OPEN SLUICE",
        hint: "host only — skips the 2-player gate",
        fn: function () {
            const no = zDevHostOnly("sluice");
            if (no) return no;
            if (gateStage >= GATE_STAGES) return "already open";
            // The gate is the one mechanic that is strictly impossible alone
            // (two plates, too far apart for one body), so a solo playtester
            // cannot otherwise see anything past it. This mirrors exactly what
            // updateGate() does on completion.
            gateStage = GATE_STAGES;
            gateProgress = 0;
            funnelActive[0] = true;
            if (sluiceGate) {
                sluiceGate.open = true;
                rebuildSolidIndex();
            }
            return "gate open, funnel 1 live";
        }
    },
    {
        label: "FILL SILOS",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("silos");
            if (no) return no;
            for (let i = 0; i < siloFill.length; i++) siloFill[i] = SILO_CAPACITY;
            return "all three full — throw the switches";
        }
    },
    {
        label: "START FLOOD",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("flood");
            if (no) return no;
            startFlood();
            return floodRemaining + " incoming";
        }
    },
    {
        label: "OPEN ESCAPE",
        hint: "host only — skips the 90s wait",
        fn: function () {
            const no = zDevHostOnly("escape");
            if (no) return no;
            escapeAt = Date.now();
            return "south gate open";
        }
    }
];

if (typeof DEVTOOLS !== "undefined") {
    DEVTOOLS.init({
        game: "zombie",
        onOpen: function () {
            // Not a pause: see the header. Just let go of what was held, or
            // the player keeps walking behind the overlay.
            const p = zDevPlayer();
            if (p) p.keys = { up: false, down: false, left: false, right: false, shoot: false };
        },
        report: zDevReport,
        actions: zDevActions
    });
}
