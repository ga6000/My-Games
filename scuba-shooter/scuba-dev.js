/**
 * Scuba Shooter — dev tools registration (L+G)
 * ===================================================
 * Loads LAST, after the game's own <script>. The game is one classic script, so
 * its top-level const/let (diver, specimens, creatures, snake, heli, CK, ...) are
 * reachable here by name. The knobs the game itself reads live on
 * window.SCUBA_DEV (speed, dark, god, snake, music); every other tool here acts
 * on game state directly. Delete this file's <script> tag and the panel is gone.
 *
 * THE COMBO IS ARMED ALWAYS. The game binds neither L nor G, and the attract
 * run's "any key dives in" handler skips both, so L+G opens the panel over the
 * attract too.
 *
 * The panel pauses the game while it is open (like Cliff Run), unless
 * "RUN BEHIND PANEL" is on, which is what you want when dragging sliders.
 */
"use strict";

(function () {
    if (typeof DEVTOOLS === "undefined" || typeof SCUBA_DEV === "undefined") return;
    var D = SCUBA_DEV;

    // ---------- live readouts kept by the panel itself ----------
    var fps = 0, fpsN = 0, fpsT = performance.now();
    var infAmmo = false, liveBehind = false;
    function tick(t) {
        fpsN++;
        if (t - fpsT >= 500) { fps = fpsN * 1000 / (t - fpsT); fpsN = 0; fpsT = t; }
        if (infAmmo) { pistol.mag = pistol.magMax; pistol.reload = 0; }
        requestAnimationFrame(tick);
    }
    requestAnimationFrame(tick);

    // creature speed scales from the shipped CK values, so the slider is absolute
    var CK_BASE = {};
    for (var k in CK) CK_BASE[k] = { lurk: CK[k].lurk, chase: CK[k].chase, rush: CK[k].rush, swim: CK[k].swim };
    var ckMul = 1;
    var GORE_BASE = GORE_MUL;

    function phase() {
        if (gameOver) return "OVER (" + gameOver + ")";
        if (window.__demoActive) return "ATTRACT";
        if (finale.active) return "FINALE " + finale.phase;
        if (intro.active) return "INTRO " + intro.t + "/" + intro.dur;
        if (heli.boarded) return "BOARDED";
        return snake && snake.hunt ? "ESCAPE" : "PLAY";
    }
    function liveCreatures() { return creatures.filter(function (c) { return !c.dead && !c.carried; }); }
    function nextSpecimen() { return specimens.find(function (s) { return !s.popped; }) || null; }

    // ---------- placement helpers ----------
    // the room a specimen sits in: x inside the room, the nearest floor at or below it
    // (the RESEARCH one is up on the mezzanine, well above the room's main floor)
    function roomOf(s) {
        var best = null, bd = Infinity;
        rooms.forEach(function (r) {
            if (s.x < r.ix || s.x > r.ix + r.iw || s.y > r.floor + 4) return;
            var d = r.floor - s.y; if (d < bd && d < 700) { bd = d; best = r; }
        });
        return best;
    }
    function settle() {
        diver.vx = 0; diver.vy = 0; diver.entryLock = null;
        if (typeof cancelHarpoonInstant === "function") cancelHarpoonInstant();
        var c = camFor(diver.x, diver.y); camX = c.x; camY = c.y; fade = 0.6;
    }
    function swimTo(x, y) {
        var at = waterAt(x, y);
        diver.x = at.x; diver.y = at.y;
        if (diver.mode !== "swim") { diver.mode = "swim"; diver.seg = null; diver.climb = null; diver.room = null; diver.cover = null; }
        settle();
        return Math.round(at.x) + "," + Math.round(at.y);
    }
    function goToSpecimen(s) {
        if (!s) return "none left";
        if (!s.inside) return "swam to " + swimTo(s.x + 110, s.y - 70);
        var r = roomOf(s);
        if (!r) return "no room found for it";
        var x = Math.max(r.ix + 40, Math.min(r.ix + r.iw - 40, s.x - 130));
        placeOnFloor(x, s.y);
        diver.room = r; settle();
        return "in " + r.name;
    }

    // a creature near the diver: same floor if he's walking, open water if he's swimming
    function spawnNear(kind) {
        if (diver.mode === "walk" && diver.seg) {
            var sg = diver.seg, side = Math.random() < 0.5 ? -1 : 1;
            var tries = [diver.x + side * 320, diver.x - side * 320, diver.x + side * 180, diver.x - side * 180];
            for (var i = 0; i < tries.length; i++) {
                var x = tries[i];
                if (x > sg.x0 + 20 && x < sg.x1 - 20) {
                    var c = spawnCreature(kind, { x: x, y: segY(sg, x) - 28, seg: sg });
                    noticePlayer(c); return c;
                }
            }
            var c2 = spawnCreature(kind, { x: diver.x, y: diver.y, seg: sg });   // tiny room: on top of him
            noticePlayer(c2); return c2;
        }
        for (var t = 0; t < 16; t++) {
            var a = Math.random() * Math.PI * 2, rr = 360 + Math.random() * 260;
            var x2 = diver.x + Math.cos(a) * rr, y2 = diver.y + Math.sin(a) * rr;
            if (y2 < waterLevel + 80 || y2 > getTerrainY(x2) - 60 || hitsSolid(x2, y2)) continue;
            var c3 = spawnCreature(kind, waterAt(x2, y2));
            noticePlayer(c3); return c3;
        }
        return null;
    }
    function spawnBtn(kind, n) {
        return function () {
            var made = 0;
            for (var i = 0; i < n; i++) if (spawnNear(kind)) made++;
            return made + " " + kind + (made === 1 ? "" : "s") + (made < n ? " (no room for the rest)" : "");
        };
    }

    // the crab-snake, loose and hunting, a short swim from the diver
    function releaseSnake() {
        if (window.__demoActive) return "the attract run already has one";
        makeSnake();
        var a = diver.x < mapW / 2 ? 0 : Math.PI, best = null;
        for (var t = 0; t < 24 && !best; t++) {
            var ang = a + (t % 2 ? 1 : -1) * Math.floor(t / 2) * 0.35, x = diver.x + Math.cos(ang) * 750, y = diver.y + Math.sin(ang) * 750;
            if (y > waterLevel + 200 && y < getTerrainY(x) - 200 && x > 300 && x < mapW - 300) best = waterAt(x, y);
        }
        if (!best) best = waterAt(diver.x + 700, Math.max(waterLevel + 300, diver.y));
        var S = snake, dx = best.x < diver.x ? -1 : 1;
        for (var i = 0; i < S.segs.length; i++) { var g = S.segs[i]; g.x = best.x + dx * i * SN_GAP; g.y = best.y + Math.sin(i * 0.4) * 30; }
        for (var j = 0; j < S.tendrils.length; j++) { var tn = S.tendrils[j], B = S.segs[tn.i]; for (var p = 0; p < tn.pts.length; p++) { tn.pts[p].x = B.x; tn.pts[p].y = B.y; } tn.tip.x = B.x; tn.tip.y = B.y + 60; }
        S.mode = ""; S.hunt = true; S.vx = 0; S.vy = 0; S.wasWet = true;
        return "loose at " + Math.round(best.x) + "," + Math.round(best.y);
    }

    function quietPopAll(leave) {
        var n = 0, left = specimens.filter(function (s) { return !s.popped; });
        for (var i = 0; i < left.length - leave; i++) { left[i].popped = true; left[i].hp = 0; n++; }
        return n;
    }

    function report() {
        var live = liveCreatures(), by = { tank: 0, lanky: 0, flood: 0 };
        live.forEach(function (c) { by[c.kind] = (by[c.kind] || 0) + 1; });
        var popped = specimens.filter(function (s) { return s.popped; }).length;
        var sn = "none";
        if (snake) {
            var tl = snake.tendrils.filter(function (t) { return t.alive; }).length, br = snake.segs.filter(function (g) { return g.broken; }).length;
            sn = (snake.mode === "burst" ? "BURST" : snake.hunt ? "HUNTING" : window.__demoActive ? "attract" : "frozen") +
                 "  tendrils " + tl + "/" + snake.tendrils.length + "  broken segs " + br +
                 (snake.grabbing ? "  GRABBING" : "") + "  head " + Math.round(snake.segs[0].x) + "," + Math.round(snake.segs[0].y);
        }
        var acc = shotStats.shots ? Math.round(shotStats.hits / shotStats.shots * 100) + "%" : "--";
        return [
            ["phase", phase() + (paused ? " (paused)" : "")],
            ["frame / fps", frame + "  /  " + fps.toFixed(1) + " fps"],
            ["specimens", popped + "/" + specimens.length + " popped" + (nextSpecimen() ? "  next: " + (nextSpecimen().inside ? "inside " + ((roomOf(nextSpecimen()) || {}).name || "?") : "water @" + Math.round(nextSpecimen().x)) : "")],
            ["creatures", live.length + " live  (tank " + by.tank + ", lanky " + by.lanky + ", flood " + by.flood + ")  " + creatures.length + " in list"],
            ["crab-snake", sn],
            ["diver", Math.round(diver.x) + "," + Math.round(diver.y) + "  " + diver.mode + (diver.room ? " in " + diver.room.name : "") +
                      "  wounds " + wound.level + "/3" + (D.god ? "  GOD" : "") + "  " + current + " mag " + pistol.mag + (infAmmo ? " (inf)" : "")],
            ["heli", heli.state + (heli.boarded ? " boarded" : "")],
            ["shots", shotStats.hits + "/" + shotStats.shots + " hit  (" + acc + ")"],
            ["clutter", "bubbles " + bubbles.length + "  particles " + particles.length + "  clouds " + clouds.length + "  chunks " + chunks.length + "  traces " + traces.length],
            ["knobs", "speed x" + D.speed + "  creatures x" + ckMul + "  snake x" + D.snake + "  dark x" + D.dark + "  gore " + GORE_MUL + "  music x" + D.music]
        ];
    }

    var pct = function (v) { return "x" + (+v).toFixed(2); };
    var actions = [
        // ---- objectives ----
        { label: "SKIP INTRO", hint: "straight to play", fn: function () { if (!intro.active) return "intro already over"; skipIntro(); return "skipped"; } },
        { label: "POP NEXT SPECIMEN", hint: "the last one triggers the finale", fn: function () {
            var s = nextSpecimen(); if (!s) return "all popped";
            popSpecimen(s, 0, -1); return (specimens.filter(function (q) { return q.popped; }).length) + "/" + specimens.length; } },
        { label: "GO TO NEXT SPECIMEN", hint: "teleport beside it (room or water)", fn: function () { return goToSpecimen(nextSpecimen()); } },
        { label: "LEAVE ONE SPECIMEN", hint: "pops all but one, silently; then go pop it", fn: function () { return quietPopAll(1) + " popped"; } },
        { label: "POP ALL → FINALE", hint: "the full cutscene: fade, burst, Escape", fn: function () {
            if (window.__demoActive) return "not in attract";
            if (finale.active) return "finale already running";
            quietPopAll(0); startFinale(); return "finale started"; } },
        { label: "SKIP TO ESCAPE", hint: "no cutscene: snake hunting, heli inbound", fn: function () {
            if (window.__demoActive) return "not in attract";
            if (intro.active) skipIntro();
            quietPopAll(0); finale.active = false; fade = 0;
            var r = releaseSnake(); escBanner = 170; startExtraction(); return r; } },
        { label: "CALL HELI", hint: "extraction without the snake", fn: function () { startExtraction(); return "inbound to x " + Math.round(heli.tx); } },
        { label: "WIN NOW", hint: "end card as a win", fn: function () { if (intro.active) skipIntro(); quietPopAll(0); endGame("win"); return gameOver ? "won" : "blocked (attract?)"; } },
        { label: "KILL ME", danger: true, hint: "end card as a death", fn: function () { if (intro.active) skipIntro(); endGame("dead"); return gameOver ? "dead" : "blocked (attract?)"; } },

        // ---- enemies ----
        { label: "SPAWN TANK", hint: "near you, already hunting", fn: spawnBtn("tank", 1) },
        { label: "SPAWN LANKY", hint: "near you, already hunting", fn: spawnBtn("lanky", 1) },
        { label: "SPAWN FLOOD", hint: "a six-body cluster", fn: spawnBtn("flood", 1) },
        { label: "SPAWN SWARM", hint: "6 mixed, round you", fn: function () {
            var kinds = ["flood", "flood", "lanky", "flood", "tank", "lanky"], m = 0;
            kinds.forEach(function (k) { if (spawnNear(k)) m++; }); return m + " spawned"; } },
        { label: "KILL ALL CREATURES", danger: true, hint: "every live one drops", fn: function () {
            var n = 0; liveCreatures().forEach(function (c) { c.dead = true; c.hp = 0; if (c.members) c.members.forEach(function (m) { m.alive = false; }); n++; }); return n + " killed"; } },
        { label: "CLEAR CREATURES", hint: "removes bodies too", fn: function () { var n = creatures.length; creatures.length = 0; return n + " removed"; } },

        // ---- crab-snake ----
        { label: "RELEASE CRAB-SNAKE", hint: "hunting you, ~750px off", fn: releaseSnake },
        { label: "PLAY BURST CUTSCENE", hint: "the finale without popping anything", fn: function () {
            if (window.__demoActive) return "not in attract"; if (intro.active) skipIntro(); startFinale(); return "rolling"; } },
        { label: "FREEZE / UNFREEZE SNAKE", hint: "toggles its hunt", fn: function () {
            if (!snake || window.__demoActive) return "no hunting snake"; snake.hunt = !snake.hunt; if (!snake.hunt) snake.grabbing = null; return snake.hunt ? "hunting" : "frozen"; } },
        { label: "SEVER ALL TENDRILS", hint: "breaks every armed section", fn: function () {
            if (!snake) return "no snake"; var n = 0;
            for (var i = 0; i < snake.segs.length; i++) if (!snake.segs[i].broken && snake.tendrils.some(function (t) { return t.i === i && t.alive; })) { breakSegment(i, null); n++; }
            return n + " sections broken"; } },
        { label: "REGROW TENDRILS", hint: "heals every section now", fn: function () {
            if (!snake) return "no snake"; snake.segs.forEach(function (g) { if (g.broken) g.broken = 1; }); return "regrowing next frame"; } },
        { label: "REMOVE SNAKE", danger: true, hint: "gone, mid-hunt or not", fn: function () { if (window.__demoActive) return "not in attract"; snake = null; return "removed"; } },

        // ---- player ----
        { label: "GOD MODE", hint: "toggle: no damage", fn: function () { D.god = !D.god; return D.god ? "on" : "off"; } },
        { label: "HEAL", hint: "wounds back to green", fn: function () { wound.level = 0; wound.flash = 0; if (snake && snake.grabbing) snake.grabbing = null; return "green"; } },
        { label: "INFINITE AMMO", hint: "toggle: mag stays full", fn: function () { infAmmo = !infAmmo; return infAmmo ? "on" : "off"; } },
        { label: "TP: SURFACE", hint: "open water by the heli hover", fn: function () { return swimTo(3600, waterLevel + 90); } },
        { label: "TP: MID-WATER", hint: "between the rig legs", fn: function () { return swimTo(6000, 3000); } },
        { label: "TP: SEABED", hint: "by the bottom bases", fn: function () { return swimTo(6000, getTerrainY(6000) - 160); } },
        { label: "TP: TO THE SNAKE", hint: "just outside its reach", fn: function () {
            if (!snake) return "no snake"; var h = snake.segs[0]; return swimTo(h.x + (diver.x < h.x ? -420 : 420), h.y - 120); } },

        // ---- housekeeping ----
        { label: "CLEAR CLUTTER", hint: "bubbles, casings, clouds, chunks, traces", fn: function () {
            var n = bubbles.length + particles.length + clouds.length + chunks.length + traces.length;
            bubbles.length = 0; particles.length = 0; clouds.length = 0; chunks.length = 0; traces.length = 0; return n + " cleared"; } },
        { label: "RUN BEHIND PANEL", hint: "toggle: keep the game running while open", fn: function () {
            liveBehind = !liveBehind; paused = liveBehind ? false : true; return liveBehind ? "running" : "paused while open"; } },
        { label: "RESTART (ATTRACT)", hint: "reload into the attract run", fn: function () { location.replace(location.pathname); return "reloading"; } },
        { label: "RESTART (RUN)", hint: "reload straight into a run", fn: function () { location.replace(location.pathname + "?nodemo=1"); return "reloading"; } },

        // ---- sliders ----
        { slider: true, label: "GAME SPEED", hint: "sim steps per real second", min: 0.1, max: 3, step: 0.05, def: 1,
          value: function () { return D.speed; }, format: pct,
          ticks: [{ v: 0.25, label: "1/4" }, { v: 1, label: "DEFAULT" }, { v: 2, label: "2x" }],
          onInput: function (v) { D.speed = v; } },
        { slider: true, label: "CREATURE SPEED", hint: "all kinds, on top of the shipped speeds", min: 0, max: 3, step: 0.05, def: 1,
          value: function () { return ckMul; }, format: pct, ticks: [{ v: 0, label: "STILL" }, { v: 1, label: "DEFAULT" }],
          onInput: function (v) { ckMul = v; for (var k in CK_BASE) for (var f in CK_BASE[k]) if (CK_BASE[k][f]) CK[k][f] = CK_BASE[k][f] * v; } },
        { slider: true, label: "SNAKE SPEED", hint: "the hunting crab-snake's swim and lunge", min: 0.2, max: 3, step: 0.05, def: 1,
          value: function () { return D.snake; }, format: pct, ticks: [{ v: 1, label: "DEFAULT" }],
          onInput: function (v) { D.snake = v; } },
        { slider: true, label: "DARKNESS", hint: "0 = lights up, for reading the level", min: 0, max: 1.4, step: 0.05, def: 1,
          value: function () { return D.dark; }, format: pct, ticks: [{ v: 0, label: "OFF" }, { v: 1, label: "DEFAULT" }],
          onInput: function (v) { D.dark = v; } },
        { slider: true, label: "GORE", hint: "blood multiplier (shipped: Evil Dead, 4)", min: 0, max: 8, step: 0.5, def: GORE_BASE,
          value: function () { return GORE_MUL; }, format: function (v) { return String(v); },
          ticks: [{ v: 0, label: "NONE" }, { v: 1, label: "GROUNDED" }, { v: GORE_BASE, label: "DEFAULT" }],
          onInput: function (v) { GORE_MUL = v; } },
        { slider: true, label: "MUSIC VOLUME", hint: "the score only, not sfx", min: 0, max: 3, step: 0.05, def: 1,
          value: function () { return D.music; }, format: pct, ticks: [{ v: 0, label: "MUTE" }, { v: 1, label: "DEFAULT" }],
          onInput: function (v) {
              D.music = v;
              if (music.m && actx) music.m.master.gain.setTargetAtTime(Math.max(0.0002, 0.16 * v), actx.currentTime, 0.1);
              return music.m ? undefined : "music starts on your first click";
          } }
    ];

    DEVTOOLS.init({
        game: "scuba-shooter",
        onOpen: function () {
            // modal: drop held keys so the diver doesn't drift behind it
            for (var k in keys) keys[k] = false; mouseDown = false;
            if (!liveBehind) paused = true;
        },
        onClose: function () { paused = menuEl.classList.contains("open"); },   // the Esc menu keeps its own pause
        report: report,
        payload: function () {
            return { phase: phase(), frame: frame, diver: { x: diver.x, y: diver.y, mode: diver.mode, wounds: wound.level },
                     specimens: specimens.map(function (s) { return { x: s.x, y: s.y, inside: s.inside, popped: s.popped }; }),
                     creatures: liveCreatures().map(function (c) { return { kind: c.kind, x: Math.round(c.x), y: Math.round(c.y), mode: c.mode }; }),
                     snake: snake ? { mode: snake.mode, hunt: !!snake.hunt, head: [snake.segs[0].x, snake.segs[0].y] } : null,
                     knobs: { speed: D.speed, creatures: ckMul, snake: D.snake, dark: D.dark, gore: GORE_MUL, music: D.music, god: D.god } };
        },
        actions: actions
    });
})();
