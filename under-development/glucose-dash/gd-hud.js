// ===================================================
//   Glucose Dash -- HUD
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 2009-2218 were MOVED VERBATIM and IN
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
     HUD
   ===================================================
   The exposure effects deliberately stop at the canvas. When you're at
   38 mg/dL the world should be a grey tunnel -- but the monitor telling
   you WHY has to stay legible, or the mechanic reads as the game
   breaking rather than as your body failing. */

var WAVE_N = 300, WAVE_HZ = 10;         // 30 seconds of history
var waveBuf = new Float32Array(WAVE_N);
var waveHead = 0, waveFill = 0, waveAcc = 0;
var railPips = [];

function pushWave(v) {
    waveBuf[waveHead] = v;
    waveHead = (waveHead + 1) % WAVE_N;
    if (waveFill < WAVE_N) waveFill++;
}

function drawWave() {
    var w = waveCanvas.width, h = waveCanvas.height, d = VIEW.dpr;
    waveCtx.setTransform(1, 0, 0, 1, 0, 0);
    waveCtx.clearRect(0, 0, w, h);

    var LO = 30, HI = 300;
    function ty(v) { return h - ((Math.max(LO, Math.min(HI, v)) - LO) / (HI - LO)) * h; }

    waveCtx.fillStyle = "rgba(255,255,255,0.03)";
    waveCtx.fillRect(0, 0, w, h);

    // the three zones, drawn as the background rather than as lines --
    // you read this at a glance while steering, not by inspecting it
    waveCtx.fillStyle = "rgba(255,107,107,0.16)";
    waveCtx.fillRect(0, ty(TUNE.hypo), w, h - ty(TUNE.hypo));
    waveCtx.fillStyle = "rgba(255,196,84,0.14)";
    waveCtx.fillRect(0, 0, w, ty(TUNE.hyper));
    waveCtx.fillStyle = "rgba(108,231,168,0.10)";
    waveCtx.fillRect(0, ty(TUNE.hyper), w, ty(TUNE.hypo) - ty(TUNE.hyper));

    waveCtx.strokeStyle = "rgba(255,255,255,0.22)";
    waveCtx.lineWidth = 1 * d;
    [TUNE.hypo, TUNE.hyper].forEach(function (v) {
        waveCtx.beginPath();
        waveCtx.moveTo(0, ty(v) + 0.5); waveCtx.lineTo(w, ty(v) + 0.5);
        waveCtx.stroke();
    });

    if (waveFill < 2) return;
    waveCtx.beginPath();
    for (var i = 0; i < waveFill; i++) {
        var idx = (waveHead - waveFill + i + WAVE_N * 2) % WAVE_N;
        var x = (i / (WAVE_N - 1)) * w;
        var yy = ty(waveBuf[idx]);
        if (i === 0) waveCtx.moveTo(x, yy); else waveCtx.lineTo(x, yy);
    }
    waveCtx.strokeStyle = zoneColor(player.glucose);
    waveCtx.lineWidth = 2.2 * d;
    waveCtx.lineJoin = "round";
    waveCtx.stroke();

    var hx = ((waveFill - 1) / (WAVE_N - 1)) * w;
    waveCtx.beginPath();
    waveCtx.arc(hx, ty(player.glucose), 3.2 * d, 0, 6.284);
    waveCtx.fillStyle = zoneColor(player.glucose);
    waveCtx.fill();
}

function zoneColor(g) {
    if (g < TUNE.hypo) return "#ff6b6b";
    if (g > TUNE.hyper) return "#ffc454";
    return "#6ce7a8";
}

function progressOf(r) {
    if (r.finished) return 1e9 - r.finishMs;
    if (r.dnf) return -1;
    return r.y;
}

function placeOf(r) {
    var better = 1;
    for (var i = 0; i < runners.length; i++) {
        if (runners[i] !== r && progressOf(runners[i]) > progressOf(r)) better++;
    }
    return better;
}

function updateHUD(dt) {
    var g = player.glucose;

    el.place.textContent = placeOf(player) + "/" + runners.length;
    el.dist.textContent = player.finished ? "0m" :
        Math.max(0, Math.round((COURSE_LEN - player.y) * 0.5)) + "m";
    el.time.textContent = raceTime.toFixed(1);
    el.floor.innerHTML = "FLOOR <b>" + (Math.round(player.z / FLOOR_H) + 1) + "</b>";

    var sp = player.sprintT > 0 ? player.sprintT / TUNE.sprintDur
        : (player.sprintCd > 0 ? 1 - player.sprintCd / TUNE.sprintCd : 1);
    el.sprint.style.width = (sp * 100).toFixed(1) + "%";
    el.sprint.className = player.sprintT > 0 ? "hot" : "";

    el.monVal.textContent = Math.round(g);
    el.monVal.style.color = zoneColor(g);
    el.monZone.style.color = zoneColor(g);
    el.monZone.textContent = g < TUNE.hypo ? "HYPO — EAT NOW"
        : g > TUNE.hyper ? "SPIKED" : "IN RANGE";

    /* Inventory. The item being eaten has already been shifted OUT of
       player.inventory, so slot 0 shows it while it's in your mouth and
       everything else slides up behind it. Rebuilt only when the
       rendered content actually changes -- innerHTML at 60Hz for a
       two-slot panel is a lot of garbage for no reason. */
    var display = player.eating ? [player.eating].concat(player.inventory) : player.inventory;
    for (var i = 0; i < 2; i++) {
        var slot = el.slots[i];
        var key = display[i];

        if (!key) {
            if (slot.dataset.sig !== "empty") {
                slot.dataset.sig = "empty";
                slot.className = "gd-slot empty";
                slot.innerHTML = '<span class="key">' + (i === 0 ? "SPACE" : "NEXT") + '</span>';
            }
            continue;
        }
        var fd = FOODS[key];
        var eating = (i === 0 && player.eating === key);
        var pct = eating ? Math.min(100, (player.eatT / fd.eat) * 100) : 0;
        var sig = key + (eating ? "|e" : "");
        if (slot.dataset.sig !== sig) {
            slot.dataset.sig = sig;
            slot.className = "gd-slot gi-" + fd.gi;
            slot.innerHTML =
                '<span class="ic">' + fd.icon + '</span>' +
                '<span class="tx"><span class="nm">' + fd.name + '</span>' +
                '<span class="gi" style="color:' + GI_COLOR[fd.gi] + '">' +
                (eating ? "EATING…" : fd.gi.toUpperCase() + " GI") + '</span></span>' +
                '<span class="key">' + (i === 0 ? "SPACE" : "NEXT") + '</span>' +
                '<span class="eatbar"></span>';
        }
        if (eating) {
            var bar = slot.querySelector(".eatbar");
            if (bar) bar.style.width = pct.toFixed(0) + "%";
        }
    }

    // warnings
    var wtxt = "", wcol = "";
    if (player.dnf) { wtxt = "CRASHED"; wcol = "#ff6b6b"; }
    else if (g < 40) { wtxt = "CRITICAL — EAT"; wcol = "#ff6b6b"; }
    else if (g < TUNE.hypo) { wtxt = "LOW · SLOWING"; wcol = "#ff6b6b"; }
    else if (g > 280) { wtxt = "WAY TOO HIGH"; wcol = "#ffc454"; }
    else if (g > TUNE.hyper) { wtxt = "SPIKED"; wcol = "#ffc454"; }
    el.warn.textContent = wtxt;
    el.warn.style.color = wcol;
    el.warn.className = wtxt ? (g < 45 || player.dnf ? "on pulse" : "on") : "";

    /* --- the exposure mechanic ---
       Below 70: saturation and light drain out and the world closes in.
       Above 200: the sensor blows out and you lose the course. Highs
       are visual-only by design -- no DNF above range. */
    var hypoT = Math.max(0, Math.min(1, (TUNE.hypo - g) / TUNE.hypo));
    var hyperT = Math.max(0, Math.min(1, (g - TUNE.hyper) / 130));
    /* Retuned for the light mall. The old values assumed a dark scene:
       a white overlay at 0.55 on an already-white corridor is an instant
       featureless whiteout with no information left in it. The blowout
       now comes mostly from saturation and contrast -- the colourful
       storefronts go neon and smear -- with only a light wash of white
       on top. Hypo is the opposite: draining a BRIGHT scene to grey and
       closing a dark vignette over it reads far harder than it did on
       black, so it can afford to be gentler. */
    var sat = (1 - 0.90 * hypoT) * (1 + 1.15 * hyperT);
    var bri = (1 - 0.55 * hypoT) * (1 + 0.26 * hyperT);
    var con = 1 - 0.30 * hypoT + 0.20 * hyperT;
    canvas.style.filter = "saturate(" + sat.toFixed(3) + ") brightness(" + bri.toFixed(3) +
        ") contrast(" + con.toFixed(3) + ")";
    el.blowout.style.opacity = (hyperT * 0.30).toFixed(3);
    el.vignette.style.opacity = (hypoT * 0.95).toFixed(3);

    // wave sampling
    waveAcc += dt;
    while (waveAcc >= 1 / WAVE_HZ) { waveAcc -= 1 / WAVE_HZ; pushWave(g); }
    drawWave();

    updateRail();
}

function updateRail() {
    for (var i = 0; i < runners.length; i++) {
        var r = runners[i];
        var pip = railPips[i];
        if (!pip) continue;
        var t = Math.max(0, Math.min(1, r.y / COURSE_LEN));
        pip.style.top = ((1 - t) * 100).toFixed(2) + "%";
        pip.style.background = r.color;
        pip.className = "gd-pip" + (r.isPlayer ? " self" : "") +
            (Math.abs(r.z - player.z) > FLOOR_H * 0.75 ? " other-floor" : "");
        pip.style.opacity = r.dnf ? 0.25 : "";
    }
}

function toast(text, color) {
    el.toast.textContent = text;
    el.toast.style.color = color || "#eef2f7";
    el.toast.className = "on";
    if (toastTimer) clearTracked(toastTimer);
    toastTimer = trackTimeout(function () { el.toast.className = ""; }, 1000);
}


