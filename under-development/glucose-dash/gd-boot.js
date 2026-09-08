// ===================================================
//   Glucose Dash -- sizing, window.GameInstance and boot
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 2508-2653 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, nothing was reindented.
//
// EVERY FILE CARRIES ITS OWN "use strict". The original script had one at the
// top, covering all 2,363 lines; a classic-script split gives each file its own
// scope for that directive, so omitting it would silently drop files 2-12 into
// sloppy mode. That is a semantic change, not a cosmetic one.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). This game lives under under-development/, so its shared paths
// are ../../shared/, not ../shared/.
"use strict";

/* ===================================================
     SIZING
   =================================================== */

function resize() {
    var r = canvas.parentNode.getBoundingClientRect();
    VIEW.dpr = Math.min(2, window.devicePixelRatio || 1);
    VIEW.w = Math.max(320, r.width);
    VIEW.h = Math.max(240, r.height);
    canvas.width = Math.round(VIEW.w * VIEW.dpr);
    canvas.height = Math.round(VIEW.h * VIEW.dpr);

    var wr = waveCanvas.getBoundingClientRect();
    waveCanvas.width = Math.round(Math.max(80, wr.width) * VIEW.dpr);
    waveCanvas.height = Math.round(Math.max(40, wr.height) * VIEW.dpr);
}


/* ===================================================
     GameInstance
   ===================================================
   The contract from GAME_PROTOTYPE_INSTRUCTIONS.md, implemented in
   full. No other game in this repo implements it and the hub links
   full pages rather than embedding -- see SCOPE.md §7. */

window.GameInstance = {
    init: function (containerId) {
        var root = document.getElementById(containerId || "gd-root");
        if (!root) return false;
        root.innerHTML = LAYOUT_HTML;
        gdAbort = new AbortController();

        canvas = root.querySelector("#gd-canvas");
        ctx = canvas.getContext("2d");
        waveCanvas = root.querySelector("#gd-wave");
        waveCtx = waveCanvas.getContext("2d");

        el = {
            stage: root.querySelector("#gd-stage"),
            blowout: root.querySelector("#gd-blowout"),
            vignette: root.querySelector("#gd-vignette"),
            place: root.querySelector("#gd-place"),
            dist: root.querySelector("#gd-dist"),
            time: root.querySelector("#gd-time"),
            warn: root.querySelector("#gd-warn"),
            toast: root.querySelector("#gd-toast"),
            rail: root.querySelector("#gd-rail"),
            floor: root.querySelector("#gd-floor"),
            sprint: root.querySelector("#gd-sprint"),
            slots: [root.querySelector("#gd-slot0"), root.querySelector("#gd-slot1")],
            monVal: root.querySelector("#gd-mon-val"),
            monZone: root.querySelector("#gd-mon-zone"),
            screen: root.querySelector("#gd-screen"),
            net: root.querySelector("#gd-net")
        };

        window.addEventListener("keydown", onKeyDown, { signal: gdAbort.signal });
        window.addEventListener("keyup", onKeyUp, { signal: gdAbort.signal });
        window.addEventListener("resize", resize, { signal: gdAbort.signal });
        window.addEventListener("blur", function () {
            if (phase === "racing") togglePause();
        }, { signal: gdAbort.signal });

        resize();

        /* Multiplayer today is exactly this much: identity, colour, and
           the ROOM SEED that decides which candidate slots are stocked.
           Nothing is broadcast yet -- see SCOPE.md §6 for the ghost /
           contested-pickup work, which needs no server change. */
        MP.connect({
            game: "glucose-dash",
            onReady: function (info) {
                mpSeed = info.seed;
                netOnline = !info.solo;
                el.net.textContent = info.solo ? "SOLO" : "ROOM " + (MP.room || "PUBLIC");
                // If the seed landed after the player already hit start,
                // re-pick the stocked slots so a room races one course.
                if (phase === "countdown") buildItems();
            },
            onStatus: function (s) {
                netOnline = (s === "online");
                el.net.textContent = netOnline ? "ROOM " + (MP.room || "PUBLIC") : "SOLO";
            }
        });

        // A course exists before Start so the menu isn't sitting on nothing.
        buildCourse();
        setupRunners();
        return true;
    },

    start: function () {
        phase = "menu";
        showMenu();
        lastFrame = 0;
        if (!gdRAF) gdRAF = requestAnimationFrame(loop);
        return true;
    },

    pause: function () { if (phase === "racing") { phase = "paused"; showPause(); } },
    resume: function () { if (phase === "paused") { phase = "racing"; hideScreen(); } },

    getState: function () {
        return {
            phase: phase,
            time: raceTime,
            glucose: player ? Math.round(player.glucose) : null,
            floor: player ? Math.round(player.z / FLOOR_H) + 1 : null,
            place: player ? placeOf(player) : null,
            runners: runners.length,
            inventory: player ? player.inventory.slice() : [],
            eating: player ? player.eating : null,
            metresLeft: player ? Math.max(0, Math.round((COURSE_LEN - player.y) * 0.5)) : null,
            timeInRangePct: player && player.timeTotal ? Math.round(100 * player.timeInRange / player.timeTotal) : null,
            finished: player ? player.finished : false,
            dnf: player ? player.dnf : false,
            online: netOnline,
            seed: mpSeed
        };
    },

    destroy: function () {
        if (gdRAF) { cancelAnimationFrame(gdRAF); gdRAF = 0; }
        GD_TIMEOUTS.forEach(clearTimeout); GD_TIMEOUTS.clear();
        GD_INTERVALS.forEach(clearInterval); GD_INTERVALS.clear();
        if (gdAbort) { gdAbort.abort(); gdAbort = null; }
        try { MP.destroy(); } catch (e) { /* never connected */ }
        if (audioCtx) { try { audioCtx.close(); } catch (e) {} audioCtx = null; }
        runners = []; items = []; stores = []; railPips = [];
        player = null; phase = "menu";
        var root = document.getElementById("gd-root");
        if (root) root.innerHTML = "";
        return true;
    }
};

if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", function () {
        window.GameInstance.init("gd-root");
        window.GameInstance.start();
    });
} else {
    window.GameInstance.init("gd-root");
    window.GameInstance.start();
}

