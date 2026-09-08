// ===================================================
//   Glucose Dash -- boot and lifecycle
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 291-381 were MOVED VERBATIM and IN
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
     GLUCOSE DASH
   ===================================================
   An ultramarathon footrace through a three-storey mall where the
   resource you're managing is blood glucose, not stamina.

   Read glucose-dash/SCOPE.md before retuning anything -- it records
   which numbers were decided in the concept conversation and which
   ones I picked to make the thing playable.

   Everything below lives inside one IIFE-free top-level scope on
   purpose (matching every other game in this repo), but every name is
   prefixed or generic enough to survive scripts/check-global-collisions.js
   alongside shared/mp-core.js, which exposes exactly one global (MP).
*/


/* ===================================================
     BOOT & LIFECYCLE
   ===================================================
   Root CLAUDE.md hard constraint: every timer goes through
   trackTimeout/trackInterval and every listener through ONE
   AbortController, so destroy() can actually tear an instance down.

   This is also the only game in the repo that implements
   window.GameInstance. PROJECT_MEMORY.md records that whether the hub
   will ever embed games is UNDECIDED -- the hub links full pages today.
   This is here because it was cheap while the code was fresh, not
   because embedding is assumed. */

var GD_TIMEOUTS = new Set();
var GD_INTERVALS = new Set();
var gdAbort = null;
var gdRAF = 0;

function trackTimeout(fn, ms) {
    var id = setTimeout(function () { GD_TIMEOUTS.delete(id); fn(); }, ms);
    GD_TIMEOUTS.add(id);
    return id;
}
function trackInterval(fn, ms) {
    var id = setInterval(fn, ms);
    GD_INTERVALS.add(id);
    return id;
}
function clearTracked(id) {
    clearTimeout(id); clearInterval(id);
    GD_TIMEOUTS.delete(id); GD_INTERVALS.delete(id);
}

/* The whole UI is built from this template rather than sitting in the
   body, so init(containerId) can put a working instance into any
   element. Standalone, #gd-root is that element. */
var LAYOUT_HTML =
'<div id="gd-stage">' +
    '<canvas id="gd-canvas"></canvas>' +
    '<div id="gd-blowout"></div>' +
    '<div id="gd-vignette"></div>' +
'</div>' +
'<div id="gd-net">SOLO</div>' +
'<div id="gd-top">' +
    '<div class="gd-stat"><div class="k">Place</div><div class="v" id="gd-place">—</div></div>' +
    '<div class="gd-stat"><div class="k">To Finish</div><div class="v" id="gd-dist">—</div></div>' +
    '<div class="gd-stat"><div class="k">Time</div><div class="v" id="gd-time">0.0</div></div>' +
'</div>' +
'<div id="gd-warn"></div>' +
'<div id="gd-toast"></div>' +
'<div id="gd-rail"></div>' +
'<div id="gd-left">' +
    '<div id="gd-floor">FLOOR <b>1</b></div>' +
    '<div id="gd-sprint-label">SPRINT</div>' +
    '<div id="gd-sprint-wrap"><div id="gd-sprint"></div></div>' +
'</div>' +
'<div id="gd-corner">' +
    '<div id="gd-inv">' +
        '<div class="gd-slot empty" id="gd-slot0"><span class="key">SPACE</span></div>' +
        '<div class="gd-slot empty" id="gd-slot1"><span class="key">NEXT</span></div>' +
    '</div>' +
    '<div id="gd-monitor">' +
        '<div id="gd-mon-head">' +
            '<span id="gd-mon-title">BLOOD GLUCOSE</span>' +
            '<span><span id="gd-mon-val">135</span><span id="gd-mon-unit">mg/dL</span></span>' +
        '</div>' +
        '<canvas id="gd-wave"></canvas>' +
        '<div id="gd-mon-zone">IN RANGE</div>' +
    '</div>' +
'</div>' +
'<div id="gd-screen"></div>';


