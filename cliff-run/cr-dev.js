/**
 * Cliff Run — dev tools registration (L+G)
 * ===================================================
 * Loads LAST, after cr-boot.js. Everything the shared panel shows and does for
 * this game lives here so the whole feature can be removed by deleting one
 * <script> tag.
 *
 * THE COMBO IS ARMED ALWAYS, and that is worth stating because 4D Pong's is
 * not: DEV_TOOLS_PLAN.md records that `armedWhen` exists because fp-input.js
 * binds KeyG and KeyL to the TOP and BOTTOM couch seats, so a bare gate would
 * open a modal over somebody's rally. This game binds neither key (CR_KEYMAP
 * in cr-boot.js is WASD / arrows / space, plus E, M, P and Enter), so there is
 * nothing to disarm.
 *
 * WHAT THE REPORT IS FOR. The one thing that is genuinely hard to see from
 * outside is what each bot BELIEVES: which waypoint of its lane's route it is
 * on, and what kind that waypoint is. A bot that has quietly fallen two tiles
 * below its route looks, from the outside, exactly like a bot that is about to
 * make the jump — the route index and the recovery flag are the difference,
 * and they are the first thing to look at when a bot stops finishing.
 */
"use strict";

function crDevReport() {
    var rows = [];
    rows.push(["phase", crPhase + (crPaused ? " (paused)" : "") + (crAttractRunning ? " (attract)" : "")]);
    rows.push(["level", (crLevelIndex + 1) + "/" + CR_LEVEL_COUNT +
                        (crLevel ? "  seed " + crLevel.spec.seed.toString(16) : "")]);
    rows.push(["scroll", crLevel ? crLevel.spec.scroll.toFixed(1) + " px/s" : "--"]);
    rows.push(["cam / wall", Math.round(crCam.x) + " / " + Math.round(crAvalancheX)]);
    rows.push(["level time", crLevelTime.toFixed(2) + "s"]);
    rows.push(["entities", "coins " + crCoins.filter(function (c) { return !c.taken; }).length +
                           "  items " + crPickups.filter(function (p) { return !p.taken; }).length +
                           "  bombs " + crBombs.length +
                           "  falling " + crFalling.length +
                           "  armed " + crTouched.size]);

    for (var i = 0; i < crPlayers.length; i++) {
        var p = crPlayers[i];
        var route = crLevel ? (crLevel.routes[p.seat] || []) : [];
        var wp = p.ai ? route[Math.min(p.ai.routeIdx, route.length - 1)] : null;
        var state = !p.alive ? ("DEAD (" + p.deathCause + ")")
                  : p.finished ? "IN" : "running";
        var detail = Math.round(p.x) + "," + Math.round(p.y) +
                     "  " + (p.onGround ? "gnd" : (p.wallDir ? "wall" + (p.wallDir > 0 ? "R" : "L") : "air")) +
                     (p.dashTime > 0 ? " dash" : "") +
                     "  dj" + p.djCharges + " bmb" + p.bombs +
                     "  lv" + p.levelsCleared + " sc" + p.score;
        if (wp) {
            detail += "  wp " + p.ai.routeIdx + "/" + route.length + " " + wp.kind;
            // The off-route flag, which is the whole reason this row exists.
            if (p.y > wp.y + CR_TILE * 2.2) detail += " RECOVERING";
        }
        rows.push([CR_SEAT_NAMES[p.seat] + (p.bot ? " bot" : " you") + " " + state, detail]);
    }
    return rows;
}

function crDevPayload() {
    // The whole GameInstance state, so a paste from the panel is the same shape
    // the hub would read.
    return { state: window.GameInstance.getState() };
}

var crDevActions = [
    {
        label: "SKIP LEVEL",
        hint: "counts as a clear for everyone still running",
        fn: function () {
            if (!crLevel) return "no level";
            for (var i = 0; i < crBodies.length; i++) {
                if (crBodies[i].alive && !crBodies[i].finished) crFinishBody(crBodies[i]);
            }
            return "level " + (crLevelIndex + 1) + " forced";
        }
    },
    {
        label: "REBUILD LEVEL",
        hint: "same seed, fresh geometry and items",
        fn: function () {
            crStartLevel(crLevelIndex);
            return "level " + (crLevelIndex + 1) + " rebuilt";
        }
    },
    {
        label: "GIVE CHARGES",
        hint: "2 second-jumps and 3 bombs to you",
        fn: function () {
            var me = crPlayers[0];
            if (!me) return "no seat 0";
            me.djCharges = 2; me.bombs = 3;
            return "loaded";
        }
    },
    {
        label: "HOLD THE WALL",
        hint: "parks the avalanche at the left edge for this level",
        fn: function () {
            if (!crLevel) return "no level";
            crLevel.spec.scroll = 0;
            return "scroll 0 — the camera still follows the leader";
        }
    },
    {
        label: "TELEPORT TO FINISH",
        hint: "drops you by the far outpost",
        fn: function () {
            var me = crPlayers[0];
            if (!me || !crLevel) return "nothing to move";
            me.x = (crLevel.finishCol - 3) * CR_TILE;
            me.y = crStandY(CR_LANE_ROWS[0]) - 20;
            me.vx = 0; me.vy = 0;
            return "moved to col " + (crLevel.finishCol - 3);
        }
    },
    {
        label: "BOT TAKEOVER",
        danger: true,
        hint: "hands seat 0 to a bot — the attract-mode path, live",
        fn: function () {
            var me = crPlayers[0];
            if (!me) return "no seat 0";
            me.bot = !me.bot;
            me.ai = null;
            return me.bot ? "seat 0 is a bot" : "seat 0 is yours";
        }
    },
    {
        label: "KILL ME",
        danger: true,
        hint: "death by falling — ends the run, as the spec requires",
        fn: function () {
            var me = crPlayers[0];
            if (!me || !me.alive) return "already down";
            crKill(me, "fall");
            return "killed";
        }
    }
];

if (typeof DEVTOOLS !== "undefined") {
    DEVTOOLS.init({
        game: "cliff-run",
        onOpen: function () {
            // The panel is modal, so a key held when it opened would otherwise
            // keep the player running behind it — and on this cliff that means
            // running off it.
            for (var k in crKeys) crKeys[k] = false;
            crPaused = true;
        },
        onClose: function () { crPaused = false; },
        report: crDevReport,
        payload: crDevPayload,
        actions: crDevActions
    });
}
