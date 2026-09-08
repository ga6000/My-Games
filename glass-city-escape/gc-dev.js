/**
 * Glass City Escape — dev tools registration (2026-09-07)
 *
 * Everything the L+G panel shows and does for this game. Loads LAST, after
 * gc-boot.js.
 *
 * ---------------------------------------------------------------------------
 * THIS GAME ALREADY HAD HALF OF THIS, AND THE HALF IT HAD MOVED
 * ---------------------------------------------------------------------------
 * gc-telemetry.js has recorded a run log since 2026-09-06, and it used to draw
 * its own #log-panel overlay opened with a bare L. That overlay is gone. The
 * numbers are not: gcTelemetry* still aggregates every run, gcDumpLog() is
 * still the console entry point, and gcLogSummaryLines() still decides which
 * of it is worth a line. All of it now renders inside the shared panel, which
 * means one overlay instead of two stacked on each other, and the playtest
 * buttons sit next to the numbers they move.
 *
 * THE PAUSE SURVIVED THE MOVE. gcLogOpen still gates gameLoop, it is just set
 * from onOpen/onClose below now. Pausing matters more here than in the other
 * three games for a specific reason: reading a difficulty report while the
 * city is still hunting you corrupts the very run the report is about.
 *
 * ONE GAMEPLAY EDIT SUPPORTS THIS FILE: `gcDevGod` is read at the three places
 * gc-entities.js damages the player (fall, melee, beam). It is declared here
 * so deleting the panel leaves a findable set of dangling references rather
 * than a flag nobody can trace.
 */
"use strict";

// Read by gc-entities.js at the fall, melee and beam damage sites.
var gcDevGod = false;

function gcDevCount(pred) {
    let n = 0;
    for (let i = 0; i < entities.length; i++) if (pred(entities[i])) n++;
    return n;
}

function gcDevReport() {
    const rows = [
        ["stage", currentStage + (stageAdvancing ? "  (advancing)" : "")],
        ["floor", player.z + " / " + MAX_Z + (player.isFalling ? "  FALLING" : "")],
        ["position", Math.round(player.x) + "," + Math.round(player.y) +
                     "  cell " + Math.floor(player.x / CELL_SIZE) + "," + Math.floor(player.y / CELL_SIZE)],
        ["health", player.health + " / " + player.maxHealth +
                   (gcDevGod ? "   GOD MODE" : "")],
        ["carrying", player.carrying ? "a core" : "nothing"],
        ["cores", coresDeposited + " / " + totalCollectibles + " delivered" +
                  "   " + collectibles.filter(function (c) { return !c.collected; }).length + " still out"],
        ["blips", blips.filter(function (b) { return !b.collected; }).length + " left"],
        ["score", gcScore],
        ["exit", escapeTunnelOpen
            ? ("OPEN at " + escapeTunnelPos.x + "," + escapeTunnelPos.y)
            : ("shut — " + coresDeposited + " of " + pedestals.length +
               " pedestal" + (pedestals.length === 1 ? "" : "s") + " filled")],
        ["drones", entities.length +
                   "   hunting " + gcDevCount(function (r) { return r.state === "hunt"; }) +
                   "   lancers " + gcDevCount(function (r) { return r.kind === "lancer"; }) +
                   "   stalkers " + gcDevCount(function (r) { return r.kind === "stalker"; })],
        ["bolts", gcLasers.length + "   shards " + gcShards.length],
        ["running", gameRunning ? (gcLogOpen ? "yes (PAUSED by this panel)" : "yes") : "no"],
        ["net", (netOnline ? "online" : "solo") +
                "   ghosts " + Object.keys(ghosts).length +
                "   seed " + (baseSeed === null ? "local" : baseSeed)]
    ];

    // The run log, folded in. First line keeps the label, the rest hang under
    // it, so the whole thing stays in one aligned column.
    const lines = gcLogSummaryLines();
    for (let i = 0; i < lines.length; i++) rows.push([i === 0 ? "run log" : "", lines[i]]);
    return rows;
}

var gcDevActions = [
    {
        label: "STAGE +1",
        hint: "rebuilds the city",
        fn: function () {
            if (!gameRunning) return "not started yet";
            // The real path, bonus and telemetry included: a stage that was
            // skipped by hand would not appear in the run log, and the run log
            // is half of why this panel exists.
            triggerNextStage();
            return "now stage " + currentStage;
        }
    },
    {
        label: "CLEAR DRONES",
        fn: function () {
            const n = entities.length;
            entities.length = 0;
            gcLasers.length = 0;
            // The pursuit field indexes the drones that were flooding it.
            pursuitField = null;
            pursuitAnchor = -1;
            return n + " removed, bolts cleared";
        }
    },
    {
        label: "OPEN EXIT",
        hint: "fills every pedestal",
        fn: function () {
            if (escapeTunnelOpen) return "already open";
            if (!pedestals.length) return "no pedestals — start a run first";
            for (let i = 0; i < pedestals.length; i++) pedestals[i].filled = true;
            coresDeposited = pedestals.length;
            updateCollectUI();
            openEscapeTunnel();
            return "trapdoor open in the plaza";
        }
    },
    {
        label: "FULL HEAL",
        fn: function () {
            player.health = player.maxHealth;
            updateHealthUI();
            return player.health + " hearts";
        }
    },
    {
        label: "GOD MODE",
        hint: "toggle",
        fn: function () {
            gcDevGod = !gcDevGod;
            if (gcDevGod) { player.health = player.maxHealth; updateHealthUI(); }
            return gcDevGod ? "ON — fall, melee and beam all skipped" : "off";
        }
    },
    {
        label: "TELEPORT TO PLAZA",
        hint: "the stepwell, ground floor",
        fn: function () {
            player.x = PLAZA_CX * CELL_SIZE + CELL_SIZE / 2;
            player.y = PLAZA_CY * CELL_SIZE + CELL_SIZE / 2;
            player.z = 0;
            player.isFalling = false;
            keys = {};
            return "at the well";
        }
    },
    {
        label: "RESET GAME",
        hint: "reloads the page",
        danger: true,
        fn: function () {
            // There is no restart path in this game's own code -- the game
            // over box's button is location.reload() too. Matching it is
            // honest; hand-clearing twenty arrays to imitate it is not.
            location.reload();
            return "reloading";
        }
    },
    {
        label: "CLEAR RUN LOG",
        hint: "wipes stored telemetry",
        danger: true,
        fn: function () {
            gcTelemetryClear();
            return "localStorage cleared — the summary above resets on the next open";
        }
    }
];

if (typeof DEVTOOLS !== "undefined") {
    DEVTOOLS.init({
        game: "glass-city-escape",
        onOpen: function () {
            // gcLogOpen is what gameLoop's pause branch reads. Setting it here
            // is the whole pause: the loop keeps drawing so the page does not
            // look dead behind the panel, and advances nothing.
            gcLogOpen = true;
            // Held keys would otherwise still be down when the panel closes,
            // walking the player somewhere they did not ask to go.
            keys = {};
            gcAudioSilence();
        },
        onClose: function () {
            gcLogOpen = false;
        },
        report: gcDevReport,
        // The full telemetry payload, unchanged -- the same object gcDumpLog()
        // has always returned, so anything that already reads it still can.
        payload: gcDumpLog,
        actions: gcDevActions
    });
}
