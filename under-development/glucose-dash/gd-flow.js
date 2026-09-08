// ===================================================
//   Glucose Dash -- race flow and screens
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 2310-2507 were MOVED VERBATIM and IN
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
     RACE FLOW
   =================================================== */

var NPC_NAMES = ["RICO", "MABEL", "DEX"];

function setupRunners() {
    runners = [];
    var myName = (MP.selfName || MP.identity().name || "YOU").toUpperCase().slice(0, 12);
    player = makeRunner(myName, MP.selfColor || RUNNER_COLORS[0], true);
    player.x = 0;
    runners.push(player);

    /* Easy, per the concept: a shade slower than you, jittery steering,
       and they only sprint when genuinely contested. */
    var lanes = [-6.5, 6.5, -3.2];
    for (var i = 0; i < NPC_NAMES.length; i++) {
        var n = makeRunner(NPC_NAMES[i], RUNNER_COLORS[i + 1], false);
        n.x = lanes[i];
        n.y = -1.5 - i * 0.6;
        n.lane = lanes[i] * 0.5;
        n.jitter = i * 2.1;
        n.npcSpeed = 0.95 + i * 0.02;
        n.aggression = 0.8 + i * 0.25;
        /* Two of the three head upstairs. The ground floor is a sugar
           minefield by design, so an NPC that never climbs is choosing
           between crash-y foods all race -- and it also means the player
           never sees the upper floors being used. */
        n.wantsUp = (i !== 0);
        runners.push(n);
    }

    // rail pips, one per runner, created once per race
    el.rail.innerHTML = "";
    railPips = runners.map(function (r) {
        var d = document.createElement("div");
        d.className = "gd-pip";
        d.style.background = r.color;
        el.rail.appendChild(d);
        return d;
    });
}

var raceId = 0;

function startRace() {
    initAudio();
    raceId++;
    buildCourse();
    setupRunners();
    finishOrder = [];
    raceTime = 0;
    countdownLeft = 3.1;
    waveHead = 0; waveFill = 0; waveAcc = 0;
    fullWarnAt = -1e9;
    cam.y = 0; cam.wx = centerX(0); cam.shake = 0; cam.shakeX = 0; cam.shakeY = 0;
    phase = "countdown";
    el.screen.dataset.count = "";
    hideScreen();
    for (var i = 0; i < 8; i++) pushWave(TUNE.glucoseStart);
}

/* The results delay is what lets a crash land before the board covers
   it. Keyed to raceId so restarting during that window doesn't drop a
   results screen on top of the new race. */
function endRace(reason) {
    if (phase === "done") return;
    var id = raceId;
    trackTimeout(function () {
        if (phase === "done" || id !== raceId) return;
        phase = "done";
        showResults(reason);
    }, reason === "dnf" ? 1500 : 900);
}

function togglePause() {
    if (phase === "racing") { phase = "paused"; showPause(); }
    else if (phase === "paused") { phase = "racing"; hideScreen(); }
}

function update(dt) {
    if (phase === "countdown") {
        countdownLeft -= dt;
        showCountdown();
        if (countdownLeft <= 0) { phase = "racing"; hideScreen(); tone(880, 1320, "square", 0.2, 0.08); }
        // runners hold at the line but the camera settles
        updateCamera(dt);
        return;
    }
    if (phase !== "racing") { updateCamera(dt); return; }

    raceTime += dt;

    stepRunner(player, playerInput(), dt);
    for (var i = 1; i < runners.length; i++) {
        stepRunner(runners[i], npcInput(runners[i], dt), dt);
    }
    updateCamera(dt);
}

function loop(ts) {
    gdRAF = requestAnimationFrame(loop);
    if (!lastFrame) lastFrame = ts;
    var dt = Math.min(0.05, (ts - lastFrame) / 1000);   // clamp: a tab-switch
    lastFrame = ts;                                     // must not teleport anyone

    // The menu sits over a live course rather than a black screen, so
    // the game is legible before you've pressed anything.
    update(dt);
    render();
    updateHUD(dt);
}


/* ===================================================
     SCREENS
   =================================================== */

function hideScreen() { el.screen.className = "hidden"; }

function showScreen(html) {
    el.screen.className = "";
    el.screen.innerHTML = html;
}

function showMenu() {
    showScreen(
        '<h1>Glucose Dash</h1>' +
        '<p>An ultramarathon through a three-storey mall. The clock is not your problem — ' +
        '<b>your blood sugar is</b>. It falls the whole way, faster when you sprint. ' +
        'Under 70 the world greys out. Over 200 the light blows out and you can\'t read the course. ' +
        'Hit zero and you\'re done.</p>' +
        '<p style="color:#7f8ea6">Cake gets you out of a hole right now and drops you through the floor twelve seconds later. ' +
        'The balanced shake in the centre aisle barely registers — and then holds you steady for half a minute. ' +
        'Climbing costs you speed and buys you better food.</p>' +
        '<div class="keys">' +
            '<span><kbd>↑</kbd><kbd>↓</kbd><kbd>←</kbd><kbd>→</kbd> <b>drive</b></span>' +
            '<span>double-tap <kbd>↑</kbd> <b>sprint</b> (2× burn)</span>' +
            '<span><kbd>space</kbd> <b>eat slot 1</b></span>' +
            '<span><kbd>P</kbd> pause · <kbd>R</kbd> restart</span>' +
        '</div>' +
        '<button class="gd-btn" id="gd-start">START RACE</button>'
    );
    var b = document.getElementById("gd-start");
    if (b) b.addEventListener("click", startRace, { signal: gdAbort.signal });
}

function showCountdown() {
    var n = Math.ceil(countdownLeft);
    var txt = n > 0 ? String(n) : "GO";
    if (el.screen.dataset.count === txt) return;
    el.screen.dataset.count = txt;
    showScreen('<div id="gd-count">' + txt + '</div>');
    tone(n > 0 ? 440 : 880, n > 0 ? 440 : 1320, "square", 0.12, 0.05);
}

function showPause() {
    showScreen('<h2>PAUSED</h2><div class="keys"><span><kbd>P</kbd> resume · <kbd>R</kbd> restart</span></div>');
}

function showResults(reason) {
    /* Everyone who hasn't finished gets slotted in by how far they got,
       so the board is complete the moment the player's race ends rather
       than making them watch the NPCs jog home. */
    var rest = runners.filter(function (r) { return !r.finished && !r.dnf; })
        .sort(function (a, b) { return b.y - a.y; });
    var rows = finishOrder.slice().sort(function (a, b) {
        if (a.dnf !== b.dnf) return a.dnf ? 1 : -1;
        return (a.ms || 0) - (b.ms || 0);
    });
    var board = rows.filter(function (r) { return !r.dnf; })
        .concat(rest.map(function (r) { return { name: r.name, color: r.color, ms: null, self: r.isPlayer, dnf: false, unfinished: true }; }))
        .concat(rows.filter(function (r) { return r.dnf; }));

    var tir = player.timeTotal > 0 ? Math.round(100 * player.timeInRange / player.timeTotal) : 0;
    var head = reason === "dnf"
        ? '<h2 style="color:#ff6b6b">HYPOGLYCEMIC CRASH</h2><p>You ran out of glucose at ' +
          Math.round(player.y * 0.5) + 'm of ' + Math.round(COURSE_LEN * 0.5) + 'm. Did not finish.</p>'
        : '<h2 style="color:#7af5c8">FINISHED — ' + (raceTime).toFixed(2) + 's</h2>' +
          '<p>Time in range: <b style="color:' + (tir > 70 ? "#6ce7a8" : "#ffc454") + '">' + tir + '%</b></p>';

    var html = head + '<div id="gd-results">';
    for (var i = 0; i < board.length; i++) {
        var b = board[i];
        html += '<div class="gd-row' + (b.self ? " self" : "") + (b.dnf ? " dnf" : "") + '">' +
            '<span class="pos">' + (b.dnf ? "—" : (i + 1)) + '</span>' +
            '<span class="dot" style="background:' + b.color + '"></span>' +
            '<span class="nm">' + b.name + '</span>' +
            '<span class="tm">' + (b.dnf ? "DNF" : b.ms != null ? (b.ms / 1000).toFixed(2) + "s" : "—") + '</span>' +
            '</div>';
    }
    html += '</div><button class="gd-btn" id="gd-again">RACE AGAIN</button>';
    showScreen(html);
    var again = document.getElementById("gd-again");
    if (again) again.addEventListener("click", startRace, { signal: gdAbort.signal });
}


