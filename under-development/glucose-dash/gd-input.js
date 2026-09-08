// ===================================================
//   Glucose Dash -- input
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 2255-2309 were MOVED VERBATIM and IN
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
     INPUT
   ===================================================
   Arrow keys, per the concept. WASD aliased because it costs one line
   and half the group will reach for it.

   Double-tap forward = sprint. Tracked as an edge, not a held state:
   the second press ARMS one sprint, it doesn't hold one open. */

var keys = {};
var lastFwdTap = -1e9;
var sprintArmed = false;
var eatEdge = false;

function isFwd(c) { return c === "ArrowUp" || c === "KeyW"; }

function onKeyDown(e) {
    var c = e.code;
    if (["ArrowUp","ArrowDown","ArrowLeft","ArrowRight","Space"].indexOf(c) >= 0) e.preventDefault();

    if (phase === "menu" && (c === "Enter" || c === "Space")) { startRace(); return; }
    if (phase === "done" && (c === "Enter" || c === "KeyR")) { startRace(); return; }
    if (c === "KeyP") { togglePause(); return; }
    if (c === "KeyR" && phase === "racing") { startRace(); return; }

    if (keys[c]) return;                     // ignore auto-repeat
    keys[c] = true;

    if (isFwd(c)) {
        var now = performance.now();
        if (now - lastFwdTap < TUNE.dblTapMs) sprintArmed = true;
        lastFwdTap = now;
    }
    if (c === "Space") eatEdge = true;
}

function onKeyUp(e) { keys[e.code] = false; }

function playerInput() {
    var steer = 0;
    if (keys.ArrowLeft || keys.KeyA) steer -= 1;
    if (keys.ArrowRight || keys.KeyD) steer += 1;
    var inp = {
        throttle: !!(keys.ArrowUp || keys.KeyW),
        brake: !!(keys.ArrowDown || keys.KeyS),
        steer: steer,
        sprint: sprintArmed,
        eat: eatEdge
    };
    sprintArmed = false;
    eatEdge = false;
    return inp;
}


