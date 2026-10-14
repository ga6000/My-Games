// Zombie Arcade: do the camera and the map change stay smooth?
//
//   node scripts/zombie-camera-check.js
//
// Runs the page's own scripts headless (scripts/zombie-headless.js) and drives
// the REAL flythrough, fade and map-change code at 60Hz. Added 2026-10-12 with
// the "no hard cuts" pass (zombie/CLAUDE.md, "Eleventh"). Exit code 1 if any
// check fails. Thresholds are in screen widths a second, so they do not move
// with the window.
//
//   * every map's flythrough is map 1's own grammar (the user's reference:
//     "the zoom in and out, time at each silo, and speed of camera ... for
//     level 1 is great"), so every map is held to the SAME limits, which sit
//     just over what map 1 measures: pan MAX_PAN_WIDTHS, zoom MAX_ZOOM
//   * each tank gets a hold of at least MIN_HOLD_MS (map 1's are 600)
//   * the intro hands over to the follow camera without a step
//   * a map change swaps the world only on a fully black frame, and the frame
//     before it is black too
//   * the follow camera never moves more than CAM_MAX_STEP in one frame

const path = require("path");
const H = require(path.join(__dirname, "zombie-headless.js"));

const MAX_PAN_WIDTHS = 1.8;     // map 1 measures ~1.6 (1100px canvas)
const MAX_ZOOM = 2.2;           // e-folds a second; map 1 measures ~2.0
const MAX_HANDOVER_PX = 1;
const MAX_FIRST_ZOOM_ACCEL = 1.5;   // screen widths/s^2 through the wide shot -> silo 1 move (it was 3 to 7: a jolt)
const MAX_CLAMP_PX = 2;            // the arena's bounds may not move the view mid-zoom
const MAX_INTRO_MS = 20000;     // a runaway-length guard, not a taste limit
const MIN_HOLD_MS = 600;        // map 1's TANK 2 / TANK 3: matched, not squeezed
const W = 1100, HGT = 700, FRAME = 1000 / 60;

const sb = H.bootstrap();
const ev = (e) => H.evaluate(sb, e);
ev("var __T = 0; Date.now = function(){ return __T; }; canvas.width = " + W + "; canvas.height = " + HGT + ";");

let failed = 0;
function check(ok, msg) {
    console.log((ok ? "ok    " : "FAIL  ") + msg);
    if (!ok) failed++;
}

for (let L = 1; L <= 4; L++) {
    ev("arcLevelNo = " + L + "; MP.reseed(22352); generateLevel(); players.length = 0; spawnPlayer(); gameStarted = true;");
    ev("(function(){ const p = players[0]; if (arcLevelNo > 1) { p.x = WORLD_W/2 - 8; p.y = ARENA.y + WALL_T + 30; }" +
       " camera.scale = arcadeNormalScale(); })()");
    ev("arcadeBeginIntro(1000);");
    const len = ev("arcIntroLen");
    let prev = null, maxPan = 0, maxZoom = 0, last = null, zoomBack = 0, maxClamp = 0, maxAccel = 0;
    const zv = [];   // screen velocity (widths/s) through the first zoom
    const shots0 = JSON.parse(ev("JSON.stringify(arcadeIntroShots())"));
    const zoomStart = 1000 + shots0[0][1], zoomEnd = 1000 + shots0[1][1];   // the move that follows the wide hold
    for (let t = 1000; t < 1000 + len; t += FRAME) {
        ev("arcadeRunOn(" + t + "); arcadeIntroCamera(" + t + ");");
        const f = { t: t, x: ev("camera.x"), y: ev("camera.y"), s: ev("camera.scale") };
        if (prev) {
            const dt = (f.t - prev.t) / 1000;
            maxPan = Math.max(maxPan, Math.hypot(f.x - prev.x, f.y - prev.y) * ((f.s + prev.s) / 2) / dt);
            maxZoom = Math.max(maxZoom, Math.abs(Math.log(f.s / prev.s)) / dt);
            if (t >= zoomStart && t <= zoomEnd && f.s < prev.s - 1e-9) zoomBack++;
            if (t >= zoomStart && t <= zoomEnd) {
                maxClamp = Math.max(maxClamp, ev("arcIntroClampDelta"));
                zv.push([(f.x - prev.x) * f.s / dt / W, (f.y - prev.y) * f.s / dt / W]);
                const n = zv.length;
                if (n > 3) maxAccel = Math.max(maxAccel, Math.hypot(zv[n-1][0] - zv[n-4][0], zv[n-1][1] - zv[n-4][1]) / (3 * dt));
            }
        }
        prev = f; last = f;
    }
    ev("__T = " + (1000 + len + FRAME) + "; updateCamera(cameraTargets());");
    const hand = Math.hypot(ev("camera.x") - last.x, ev("camera.y") - last.y) * last.s;
    const shots = JSON.parse(ev("JSON.stringify(arcadeIntroShots())"));
    // The holds on a tank: the captioned shots map 1 and the later maps share.
    const tankHolds = shots.filter(function (s) {
        return /^TANK \d+$/.test(s[4] || "");
    }).map(function (s) { return s[1] - s[0]; });
    const tanks = ev("funnels.length");
    const label = "map " + L + " (" + (len / 1000).toFixed(1) + "s, " + tanks + " tanks)";
    check(maxPan / W <= MAX_PAN_WIDTHS, label + ": peak pan " + (maxPan / W).toFixed(2) + " screen widths/s");
    check(maxZoom <= MAX_ZOOM, label + ": peak zoom " + maxZoom.toFixed(2) + " e-folds/s");
    // The first zoom goes straight into TANK 1: that one move ends ON the first
    // tank (not the arena's middle) and never zooms back out on the way.
    const f0 = ev("funnels[0].x + 60"), g0 = ev("funnels[0].y");
    const z0 = shots0[1];
    check(Math.hypot(z0[2].x - f0, z0[2].y - g0) < 1 && z0[3] === "near" && zoomBack === 0 &&
          /^TANK 1$/.test((shots0[2] || [])[4] || ""),
        label + ": first zoom goes straight into silo 1 (" + (z0[1] - z0[0]) + "ms, " + zoomBack + " frames of zoom-out)");
    check(maxAccel <= MAX_FIRST_ZOOM_ACCEL && maxClamp <= MAX_CLAMP_PX,
        label + ": first zoom is smooth: peak acceleration " + maxAccel.toFixed(2) + " widths/s^2, arena bounds moved it " + maxClamp.toFixed(1) + "px");
    // Every tank is captioned TANK k, so that is where you see "TANK 1".
    check(tankHolds.length === tanks && Math.min.apply(null, tankHolds) >= MIN_HOLD_MS,
        label + ": time on each tank " + tankHolds.join("/") + "ms");
    const first = shots[0] || [0, 0, null, "", ""];
    check(first[3] === "fit" && first[4] === tanks + " SILOS TO FILL",
        label + ": opens on the whole map, \"" + first[4] + "\"");
    check(len <= MAX_INTRO_MS, label + ": length " + (len / 1000).toFixed(1) + "s (cap " + (MAX_INTRO_MS / 1000) + "s)");
    check(hand <= MAX_HANDOVER_PX, label + ": hand-over to follow " + hand.toFixed(2) + " px");
}

// The map change, host path: leave -> swap -> fade in.
ev("arcLevelNo = 1; MP.reseed(22352); generateLevel(); players.length = 0; spawnPlayer(); gameStarted = true;");
const T0 = 100000;
ev("__T = " + T0 + "; arcadeBeginNextLevel(" + T0 + ");");
let swapAlpha = null, beforeAlpha = null, prevAlpha = 0, swapped = false;
for (let t = T0; t < T0 + 2500; t += FRAME) {
    ev("__T = " + t + ";");
    if (!swapped) ev("arcadeLeaveTick(" + t + ")");
    const lv = ev("arcLevelNo");
    const a = ev("arcadeFadeAlpha(" + t + ")");
    if (!swapped && lv === 2) { swapped = true; swapAlpha = a; beforeAlpha = prevAlpha; }
    prevAlpha = a;
}
check(swapped, "map change: the swap lands");
check(swapAlpha === 1 && beforeAlpha === 1, "map change: swap frame alpha " + swapAlpha + ", frame before " + beforeAlpha + " (both must be 1)");
ev("arcLeaveAt = 0; arcLeaveEndAt = 0; arcadeBeginNextLevel(5); var __e1 = arcLeaveEndAt; arcadeBeginNextLevel(9999);");
check(ev("arcLeaveEndAt === __e1"), "map change: a second trigger while leaving is ignored");

// THE WAY IN (maps 2 to 4): you start in the tunnel behind an open gate, walk in,
// and it shuts behind you; map 1 has none.
ev("netIsHost = true; netOnline = false; arcLevelNo = 1; generateLevel();");
check(ev("entryRect") === null, "way in: map 1 has no entrance tunnel");
for (let L = 2; L <= 4; L++) {
    ev("arcLevelNo = 1; generateLevel(); players.length = 0; spawnPlayer(); __T = 5000; arcadeEnterLevel(" + L + ", 5000, [0, 0]);");
    const r = JSON.parse(ev("JSON.stringify(entryRect)"));
    const inTunnel = ev("players[0].y < ARENA.y");
    const open = ev("arcEntryState === 'open' && !walls.some(function (w) { return w.entryBar; })");
    const end = 5000 + ev("arcIntroLen");
    for (let t = end - 1000; t < end; t += FRAME) ev("__T = " + t + "; arcadeRunOn(" + t + ");");
    const through = ev("players[0].y") > r.y + r.h;
    ev("__T = " + (end + 20) + "; arcadeEntryTick(" + (end + 20) + ");");
    const shut = ev("arcEntryState === 'closed' && walls.some(function (w) { return w.entryBar; })");
    const y0 = ev("players[0].y");
    for (let i = 0; i < 90; i++) ev("moveWithCollisions(players[0], 0, -4, true, false);");
    const blocked = ev("players[0].y") > r.y + r.h - 1;
    check(inTunnel && open && through && shut && blocked,
        "way in, map " + L + ": starts in the tunnel (" + inTunnel + "), gate open (" + open + "), walks in (" + through +
        "), shuts behind (" + shut + "), cannot walk back (" + blocked + ")");
}

// The follow camera, target 2000px away.
ev("arcLevelNo = 1; generateLevel(); players.length = 0; camera.x = ARENA.x + 400; camera.y = ARENA.y + 400; camera.scale = arcadeNormalScale();");
let px = ev("camera.x"), py = ev("camera.y"), worst = 0;
for (let i = 0; i < 90; i++) {
    ev("updateCamera([{x: ARENA.x + 2400, y: ARENA.y + 900}])");
    const x = ev("camera.x"), y = ev("camera.y");
    worst = Math.max(worst, Math.hypot(x - px, y - py)); px = x; py = y;
}
check(worst <= ev("CAM_MAX_STEP") + 0.001, "follow camera: biggest frame step " + worst.toFixed(1) + " world px (cap " + ev("CAM_MAX_STEP") + ")");

console.log(failed ? "\n" + failed + " check(s) FAILED" : "\nall camera checks passed");
process.exit(failed ? 1 : 0);
