// ===================================================
//   Gravity Lab — input, seeding, main loop
// ===================================================
// Loads LAST. Everything above it only declares; this file is what runs.
//
// 2026-09-10: two input modes. Q = direct control of the last ship touched,
// exactly as before. E = fleet command: F spawns, left-drag box-selects,
// right-click orders "go here", O orbits, arrows pan. See FLEET_TIME_PLAN.md.
"use strict";

// ===================================================
//                    INPUT
// ===================================================
// The panel swallows keystrokes while one of its controls has focus, so a
// digit typed into a number box does not also trigger a shortcut.
function glTypingInPanel(e) {
    const t = e.target;
    return t && (t.tagName === "INPUT" || t.tagName === "SELECT" || t.tagName === "BUTTON");
}

let glGearWheelT = 0;   // last Shift+wheel gear shift (trackpad throttle)

function glCursorWorld() {
    return {
        x: glCamera.x + (glMouse.x - glCX) / glCamera.zoom,
        y: glCamera.y + (glMouse.y - glCY) / glCamera.zoom
    };
}

window.addEventListener("keydown", function (e) {
    glAudioUnlock();   // any key is the gesture that lets the page make sound (gl-audio.js)
    if (glTypingInPanel(e)) return;

    if (e.code === "KeyQ") glSetMode("q");
    if (e.code === "KeyE") glSetMode("e");

    // SPACE drops the drive to gear 0 — the quick brake when fine-tuning an
    // approach. Q: the flown ship; E: formations holding a selected ship.
    // (2026-09-11: it was hold-to-charge before the drive became gears.)
    // Gyro Fleet (2026-11-13): in Q, hold SPACE = jump drive (gf-flight.js).
    if (e.code === "Space") {
        e.preventDefault();
        if (!e.repeat) { if (glMode === "q") gfJumpPress(); else glShiftGear(0); }
    }
    // Hold SHIFT = strafe (Q): the ship holds its line, the gun follows the cursor.
    if ((e.code === "ShiftLeft" || e.code === "ShiftRight") && glMode === "q" && !e.repeat) gfStrafeSet(true);
    // U: ultradrive (gl-ultra.js) — Q mode, the flown ship, solo. Tap to
    // charge; tap again to abort the charge or to drop out of the drive.
    // (U ultradrive is off in Gyro Fleet pass 1: it crosses light-years, and
    // the battle space is ±60,000 units. Back when travel gets designed.)
    if (e.code === "KeyP") glPaused = !glPaused;
    if (e.code === "Period") { glStepOnce = true; }        // Single-frame advance
    if (e.code === "KeyH") glPanelEl.classList.toggle("hidden");
    // (R reseed-probes and M mini-map toggle removed 2026-09-12: the button
    // went at the user's request, and the mini-map is baked on.)

    // O: auto-orbit whoever this mode means — the selection in E (as one
    // formation), the flown ship in Q. Toggles: if every target is already
    // orbiting, it stands them down; otherwise it orders them all to orbit.
    if (e.code === "KeyO") {
        const targets = glMode === "e" ? glSelectedShips() : [glShip];
        // Not during an ultradrive charge or drive: the autopilot would take
        // the launch heading, or the helm on drop-out.
        if (targets.length && !(glMode === "q" && glShip.ultraState)) glOrbitCommand(targets, !targets.every(glIsOrbiting));
    }
    // F: spawn a ship at the cursor (either mode).
    if (e.code === "KeyF") {
        const w = glCursorWorld();
        glSpawnShip(w.x, w.y);
    }
    if (e.code === "Escape" && glMode === "e") glShips.forEach(function (s) { s.selected = false; });

    // (N new-hole-at-cursor and Tab next-hole removed 2026-09-12, with the
    // black-hole panel section: holes come from the galaxy now.)
    if (e.code === "KeyC" && !glIsLocked("freeCam")) { GLP.v.freeCam = !GLP.v.freeCam; glSyncPanelFromParams(); }

    // Shift+↑/↓: drive gear, the keyboard twin of Shift+wheel (2026-09-12).
    // Not a pan — and no auto-repeat, or holding it would race to gear 9.
    // (Gyro Fleet: E only now. Q has no gears; see gf-flight.js.)
    if (e.shiftKey && (e.code === "ArrowUp" || e.code === "ArrowDown")) {
        e.preventDefault();
        if (!e.repeat && glMode === "e") glShiftGear(e.code === "ArrowUp" ? 1 : -1);
        return;
    }
    if (e.code === "ArrowLeft")  { glPan.x = -1; e.preventDefault(); }
    if (e.code === "ArrowRight") { glPan.x = 1;  e.preventDefault(); }
    if (e.code === "ArrowUp")    { glPan.y = -1; e.preventDefault(); }
    if (e.code === "ArrowDown")  { glPan.y = 1;  e.preventDefault(); }

    // ([ ] lens-method and , / gravity-model cycling removed 2026-09-12: both
    // models are baked — arcade gravity, vector lens. GL_BAKED, gl-params.js.)
});

window.addEventListener("keyup", function (e) {
    if (e.code === "Space") gfJumpRelease();
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") gfStrafeSet(false);
    if (e.code === "ArrowLeft" || e.code === "ArrowRight") glPan.x = 0;
    if (e.code === "ArrowUp" || e.code === "ArrowDown") glPan.y = 0;
});

// A lost focus (alt-tab) must not leave thrust, strafe or a spool held down.
window.addEventListener("blur", function () {
    gfThrustSet(false); gfStrafeSet(false);
    if (gfFlight.jump === "spool") gfJumpRelease();
});

// Right-click is a game command in E mode, never the browser's menu.
glCanvas.addEventListener("contextmenu", function (e) { e.preventDefault(); });

glCanvas.addEventListener("mousedown", function (e) {
    glAudioUnlock();
    // Give keyboard focus back to the page: a panel control left focused
    // would swallow Q / E / O for as long as it kept it.
    if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur();

    // Clicks on the mini-map belong to the mini-map, not to firing, probe
    // drops or a box select that would start underneath it.
    if (glMinimapHit(e.clientX, e.clientY)) return;
    const wx = glCamera.x + (e.clientX - glCX) / glCamera.zoom;
    const wy = glCamera.y + (e.clientY - glCY) / glCamera.zoom;

    if (e.button === 2) {
        // Go here: the selection as one formation (2026-09-11). Right-click ON
        // a body — or within ~30 px of its surface — targets the body: go
        // there, then break into an evenly spaced ring orbit on arrival. Open
        // space: go there and hold formation until told otherwise.
        if (glMode === "e") {
            const sel = glSelectedShips();
            if (sel.length) {
                const b = glPickBody(wx, wy, 30 / glCamera.zoom);
                glCommandShips(sel, b ? { type: "move", x: b.x, y: b.y, body: b } : { type: "move", x: wx, y: wy });
            }
            glSyncPanelFromParams();
        } else {
            // Q (Gyro Fleet, 2026-11-13): hold right mouse = thrust. Replaces
            // the lab's trajectory lock. Released on the window's mouseup.
            gfThrustSet(true);
        }
        return;
    }
    if (e.button !== 0) return;

    if (glMode === "e") {
        glDrag = { x0: e.clientX, y0: e.clientY, x1: e.clientX, y1: e.clientY, add: e.shiftKey };
        return;
    }
    // Q mode: a click fires toward the cursor (gf-flight.js). Gyro Fleet
    // dropped the lab's shift-click probe: Shift is strafe now.
    gfFire();
});

window.addEventListener("mousemove", function (e) {
    if (glDrag) { glDrag.x1 = e.clientX; glDrag.y1 = e.clientY; }
});

// Box select finishes on the WINDOW, not the canvas, so releasing over the
// panel still completes the drag instead of leaving a box stuck on screen.
window.addEventListener("mouseup", function (e) {
    if (e.button === 2) gfThrustSet(false);
    if (!glDrag || e.button !== 0) return;
    const d = glDrag;
    glDrag = null;
    const x0 = Math.min(d.x0, d.x1), x1 = Math.max(d.x0, d.x1);
    const y0 = Math.min(d.y0, d.y1), y1 = Math.max(d.y0, d.y1);
    if (!d.add) glShips.forEach(function (s) { s.selected = false; });

    let touched = null;
    if (x1 - x0 < 6 && y1 - y0 < 6) {
        // A click, not a drag: the nearest ship within 22px of it. Uses the
        // RAW projection — the same one hulls and vectors are drawn with.
        let best = 22;
        glShips.forEach(function (s) {
            if (!s.isAlive) return;
            const p = glWorldToScreenRaw(s.x, s.y);
            const dd = Math.hypot(p.x - d.x1, p.y - d.y1);
            if (dd < best) { best = dd; touched = s; }
        });
        if (touched) touched.selected = d.add ? !touched.selected : true;
    } else {
        // By CENTROID (the ship's position), as asked — a ship whose hull
        // pokes into the box but whose centre is outside is not selected.
        glShips.forEach(function (s) {
            if (!s.isAlive) return;
            const p = glWorldToScreenRaw(s.x, s.y);
            if (p.x >= x0 && p.x <= x1 && p.y >= y0 && p.y <= y1) {
                s.selected = true;
                if (!touched) touched = s;
            }
        });
    }
    // "Last ship touched" — what Q will fly.
    if (touched && touched.selected) glShip = touched;
    glSyncPanelFromParams();
});

// Wheel zooms, and takes the camera off auto-zoom — a manual zoom that the
// auto-zoom immediately eased back would feel like the wheel was broken.
glCanvas.addEventListener("wheel", function (e) {
    e.preventDefault();
    // Over the mini-map the wheel switches its range instead of zooming the
    // camera: down (zoom out) = max range, up (zoom in) = close range.
    // Direction, not toggle — a trackpad sends a burst of wheel events per
    // gesture, and a toggle would flip back and forth through all of them.
    // Shift+wheel arrives as a HORIZONTAL scroll in some browsers.
    const dy = e.deltaY || e.deltaX;
    // Over the map: step out (down) / in (up) through its four levels.
    if (glMinimapHit(e.clientX, e.clientY)) { glMinimapStep(dy > 0 ? 1 : -1); return; }
    // Shift+wheel: drive gear, up = faster (2026-09-11). Throttled, since a
    // trackpad sends a burst of events per gesture.
    if (e.shiftKey && glMode === "e") {   // Gyro Fleet: formations only; Q has no gears
        const now = performance.now();
        if (now - glGearWheelT > 120) { glGearWheelT = now; glShiftGear(dy < 0 ? 1 : -1); }
        return;
    }
    if (GLP.v.autoZoom && !glIsLocked("autoZoom")) { GLP.v.autoZoom = false; glSyncPanelFromParams(); }
    glCamera.zoom = Math.max(GL_ZOOM_MIN, Math.min(GL_ZOOM_MAX, glCamera.zoom * (dy > 0 ? 0.92 : 1.08)));
}, { passive: false });

// ===================================================
//                  MAIN LOOP
// ===================================================
function glAnimate(now) {
    requestAnimationFrame(glAnimate);

    const frameStart = performance.now();
    const dt = Math.min((now - glLastFrame) / 1000, 0.05);
    glLastFrame = now;
    glFps = glLerp(glFps, 1 / Math.max(dt, 0.0001), 0.08);

    const running = !glPaused || glStepOnce;
    if (running) {
        glSimulate(glStepOnce ? 1 / 60 : dt);
        glStepOnce = false;
    }
    glFrameBootView();    // once, as soon as the canvas has a size
    glUpdateCamera(dt);   // every frame, paused or not — pan and framing still work
    // Ultradrive cues — warp, beam fade, audio. Frozen with the sim when
    // paused, and the audio suspends.
    glUltraFrame(running ? dt : 0, !running);
    glAudioFrame(running ? dt : 0, !running);   // ambient, engine, cues; suspends when paused
    glFrameNo++;
    // (No chunk streaming in Gyro Fleet: the galaxy is archived, see CLAUDE.md.)

    glRender();

    glFrameMs = performance.now() - frameStart;
    glUpdateHud();
}

// ===================================================
//                    BOOT
// ===================================================
// Hole #1 must exist before the panel syncs, the preset pushes into it, and
// probes seed around it — in that order.
glAddCoreHole();   // Sgr A*, at the galactic centre (gl-galaxy.js)
// Star systems before anything that must avoid them: the ship's safe spawn
// reads the hazard list, and it spawns beside Earth.
glCreateStarSystems();
// The defaults ARE the user's configuration since 2026-09-10 (gl-params.js),
// so boot applies no preset. Auto-orbit is per ship: write its default onto
// the flown ship BEFORE the panel's first sync reads it back.
glShip.autoOrbit = !!GLP.v.autoOrbit;
glBuildPanel();
glSeedProbes();

// Beside Earth (2026-09-11; was just outside the origin hole's influence).
glSafeSpawn(glShip);
// ---- Gyro Fleet battle space (2026-11-08) ----
// One box round home instead of the galaxy; the ship bounces off its walls.
// Gears top out at 4 (×10,000 cruise): enough to cross to the hive in a few
// seconds, not enough to leave the solar system.
(function () {
    const B = 60000;
    GL_WORLD.minX = glShip.x - B; GL_WORLD.maxX = glShip.x + B;
    GL_WORLD.minY = glShip.y - B; GL_WORLD.maxY = glShip.y + B;
    GLP.v.hyperGearMax = 4;
    // Start on the stick, not on auto-orbit round Earth: this is a game now.
    GLP.v.autoOrbit = false;
    glShip.autoOrbit = false;
    glSyncPanelFromParams();
    // Engine sliders the creatures don't need: no probes cluttering the fight.
    glProbes.length = 0;
})();
gfInitBattle();
glShip.homeX = glShip.x;
glShip.homeY = glShip.y;
glCamera.x = glShip.x;
glCamera.y = glShip.y;
// Frame the first view ONCE even though auto-zoom now defaults off — at zoom
// 1.0 the spawn point shows empty space with the hole off-screen. After this
// the zoom is left alone, which is what auto-zoom off means.
// Done on the first frame the canvas has a real size (2026-09-11): a page that
// boots hidden (a background tab, a collapsed pane) has a 0-px canvas here, and
// framing against that picked the wrong zoom.
let glBootFrame = true;
function glFrameBootView() {
    if (!glBootFrame || window.innerWidth <= 0 || window.innerHeight <= 0) return;
    if (glW !== window.innerWidth || glH !== window.innerHeight) glResize();
    for (let i = 0; i < 200; i++) glUpdateAutoZoom();
    glBootFrame = false;
}
glFrameBootView();

requestAnimationFrame(glAnimate);
console.log("Gyro Fleet ready — see gyro-fleet/CLAUDE.md.");
