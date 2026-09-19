// ===================================================
//   Gravity Lab — the slider panel and HUD
// ===================================================
// Built from GL_PARAM_DEFS / GL_TOGGLE_DEFS at boot rather than written out as
// markup, so adding a parameter is a one-line change in gl-params.js and the
// control appears by itself. Nothing here caches a value: the controls write
// straight into GLP.v and the simulation reads GLP.v every frame.
//
// 2026-09-10: every slider now has a NUMBER BOX beside it, and the box is not
// bound by the slider's min/max — typing 12 into a 0–6 slider sets 12. The
// slider then only shows the clamped position; the box, outlined amber when a
// value is out of the slider's range, shows the truth. GL_PARAM_FLOORS
// (gl-params.js) guards the few values below which code breaks.
"use strict";

const glPanelEl = document.getElementById("glPanel");
const glHudEl = document.getElementById("glHud");
const glInputs = {};        // key -> the range/checkbox <input> that owns it
const glNumInputs = {};     // key -> the number box

function glFmt(v) {
    if (!isFinite(v)) return "";
    return String(+(+v).toFixed(4));
}

// The one write path for a numeric param, from either control.
function glSetParam(d, v) {
    const f = GL_PARAM_FLOORS[d.k];
    if (f !== undefined && v < f) v = f;
    GLP.v[d.k] = v;
    if (GL_HOLE_KEYS.indexOf(d.k) !== -1) glPushParamsToHole();
    if (glInputs[d.k]) glInputs[d.k].value = v;   // the range clamps its own display
    glUpdateValueLabel(d);
}

// ===================================================
//                     LOCKS (2026-09-12)
// ===================================================
// Mark a panel field "ready to lock": its current value is frozen — stored in
// localStorage, applied at boot and after Reset All, skipped by presets and
// hotkeys — and its controls go (slider hidden, number box and checkbox
// inert). "Hide locked" removes the rows entirely. "Copy locked" hands over
// the list, which a later pass bakes into the defaults, deleting those params.
// Not lockable: per-hole keys (per-object state) and auto-orbit (a view of the
// flown ship).
const GL_LOCK_STORE = "gyrolab-locks-v1";
const GL_LOCK_HIDE_STORE = "gyrolab-locks-hidden-v1";
let glLocks = {};   // key -> frozen value; "gravityModel" / "lensMethod" for the pickers

function glLoadLocks() {
    try { glLocks = JSON.parse(localStorage.getItem(GL_LOCK_STORE) || "{}") || {}; } catch (e) { glLocks = {}; }
    // Keys baked into GL_BAKED (gl-params.js) are fixed, not locked: drop them,
    // so the store and the "Hide locked (N)" count describe only live locks.
    let pruned = false;
    for (const k in glLocks) if (k in GL_BAKED) { delete glLocks[k]; pruned = true; }
    if (pruned) glSaveLocks();
}
function glSaveLocks() {
    try { localStorage.setItem(GL_LOCK_STORE, JSON.stringify(glLocks)); } catch (e) { /* private window etc. */ }
}
function glIsLocked(k) { return Object.prototype.hasOwnProperty.call(glLocks, k); }

function glApplyLocks() {
    for (const k in glLocks) {
        if (k === "gravityModel") { if (GL_GRAVITY_MODELS[glLocks[k]]) GLP.gravityModel = glLocks[k]; }
        else if (k === "lensMethod") { if (GL_LENS_METHODS[glLocks[k]]) GLP.lensMethod = glLocks[k]; }
        else if (k in GLP.v) GLP.v[k] = glLocks[k];
    }
}

function glLockable(k) { return GL_HOLE_KEYS.indexOf(k) === -1 && k !== "autoOrbit" && !(k in GL_BAKED); }
function glLockBtn(k) {
    return glLockable(k) ? '<button class="gl-lock" data-k="' + k + '" title="Mark ready to lock">🔓</button>' : "";
}

function glToggleLock(k) {
    if (glIsLocked(k)) delete glLocks[k];
    else glLocks[k] = k === "gravityModel" ? GLP.gravityModel : k === "lensMethod" ? GLP.lensMethod : GLP.v[k];
    glSaveLocks();
    glSyncLockUi();
}

function glSyncLockUi() {
    const btns = glPanelEl.querySelectorAll(".gl-lock");
    for (let i = 0; i < btns.length; i++) {
        const b = btns[i], on = glIsLocked(b.dataset.k);
        b.textContent = on ? "🔒" : "🔓";
        b.classList.toggle("on", on);
        b.title = on ? "Locked at " + JSON.stringify(glLocks[b.dataset.k]) + " — click to unlock" : "Mark ready to lock";
        const row = b.closest(".gl-row");
        if (!row) continue;
        row.classList.toggle("gl-locked", on);
        row.querySelectorAll("input, select").forEach(function (el) { el.disabled = on; });
    }
    const n = Object.keys(glLocks).length, hb = document.getElementById("glHideLocked");
    if (hb) hb.textContent = (glPanelEl.classList.contains("gl-hide-locked") ? "Show" : "Hide") + " locked (" + n + ")";
}

// Clipboard with the console fallback file:// often needs.
function glCopyText(text, note) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text)
            .then(function () { note.textContent = "Copied to clipboard."; })
            .catch(function () { console.log(text); note.textContent = "Clipboard blocked — printed to console."; });
    } else {
        console.log(text);
        note.textContent = "Printed to console (F12).";
    }
}

function glBuildPanel() {
    glLoadLocks();
    glApplyLocks();
    const groups = {};
    const order = [];

    function bucket(name) {
        if (!groups[name]) { groups[name] = []; order.push(name); }
        return groups[name];
    }

    // Baked params (`fixed`, GL_BAKED in gl-params.js) have no controls, and the
    // per-hole "Black hole" sliders are gone (2026-09-12, both user requests).
    // A group left with nothing in it simply never gets a section.
    function shown(d) { return !d.fixed && d.g !== "Black hole"; }
    GL_PARAM_DEFS.forEach(function (d) { if (shown(d)) bucket(d.g).push({ type: "range", d }); });
    GL_TOGGLE_DEFS.forEach(function (d) { if (shown(d)) bucket(d.g).push({ type: "check", d }); });

    let html = "";

    // (The Model section — gravity and lens pickers, presets — went 2026-09-12:
    // both models are baked, arcade + vector. GL_BAKED, gl-params.js.)

    // --- fleet and modes ---------------------------------------------------
    html += '<div class="gl-sec"><h3>Ships &amp; modes</h3>' +
        '<div class="gl-btns">' +
        '<button id="glModeQ">Q · direct</button>' +
        '<button id="glModeE">E · fleet</button>' +
        '<button id="glSpawn5">Spawn 5 ships</button>' +
        '<button id="glSelAll">Select all</button>' +
        '<button id="glClearFleet">Clear fleet</button>' +
        '</div><p class="gl-desc"><kbd>Q</kbd> flies the last ship touched, as before. ' +
        '<kbd>E</kbd>: <kbd>F</kbd> spawns a ship at the cursor, left-drag box-selects (shift adds), ' +
        'right-click sends the selection there in a delta (on a planet: it orbits on arrival), <kbd>O</kbd> ' +
        'rings it round the nearest body, <kbd>Shift+wheel</kbd> or <kbd>Shift+↑↓</kbd> sets the formation\'s ' +
        'gear. In Q: <kbd>U</kbd> ultradrive, <kbd>right-click</kbd> locks the trajectory. Arrows pan.</p></div>';

    // (The Black holes roster — pick, add, remove, generate field — went
    // 2026-09-12 at the user's request: holes come from the galaxy now.)

    // --- generated controls ----------------------------------------------
    order.forEach(function (g) {
        html += '<div class="gl-sec"><h3>' + g + '</h3>';
        groups[g].forEach(function (item) {
            const d = item.d;
            if (item.type === "range") {
                // A div, not a label: a label holding two inputs would send
                // clicks on its text to whichever it decides is "the" control.
                html += '<div class="gl-row gl-slider" id="gl-row-' + d.k + '"><span><em class="gl-lbl">' +
                    glLockBtn(d.k) + d.label + '</em>' +
                    '<input type="number" class="gl-num" id="gl-num-' + d.k + '" step="any"></span>' +
                    '<input type="range" id="gl-in-' + d.k + '" min="' + d.min +
                    '" max="' + d.max + '" step="' + d.step + '"></div>';
            } else {
                html += '<label class="gl-row gl-check">' + glLockBtn(d.k) + '<input type="checkbox" id="gl-in-' + d.k +
                    '"><span>' + d.label + '</span></label>';
            }
        });
        html += '</div>';
    });

    html += '<div class="gl-sec"><h3>Session</h3>' +
        '<div class="gl-btns">' +
        '<button id="glReset">Reset all</button>' +
        '<button id="glCopy">Copy params</button>' +
        '<button id="glHideLocked">Hide locked (0)</button>' +
        '<button id="glCopyLocked">Copy locked</button>' +
        '</div><p class="gl-desc">🔓 beside a field marks it <b>ready to lock</b>: its value freezes ' +
        '(kept across reloads and Reset All) and its controls go. Copy locked hands over the list to ' +
        'bake in — the first batch was baked 2026-09-12 and no longer appears here.</p>' +
        '<p class="gl-desc" id="glCopyNote"></p></div>';

    glPanelEl.innerHTML = html;

    // A clicked panel button keeps keyboard focus, and glTypingInPanel() then
    // swallows every key — Q, E, O all dead until you click the canvas. So
    // buttons give focus straight back.
    glPanelEl.addEventListener("click", function (e) {
        // Lock buttons first. preventDefault: a button inside a <label> must
        // not also toggle that label's checkbox.
        const lb = e.target && e.target.closest ? e.target.closest(".gl-lock") : null;
        if (lb) { e.preventDefault(); e.stopPropagation(); glToggleLock(lb.dataset.k); lb.blur(); return; }
        if (e.target && e.target.tagName === "BUTTON") e.target.blur();
    });

    GL_PARAM_DEFS.forEach(function (d) {
        const el = document.getElementById("gl-in-" + d.k);
        const num = document.getElementById("gl-num-" + d.k);
        if (!el) return;   // baked or hidden: no control to wire
        glInputs[d.k] = el;
        glNumInputs[d.k] = num;
        el.addEventListener("input", function () { glSetParam(d, parseFloat(el.value)); });
        // Commit on change (Enter / blur), not per keystroke: "-" and "1e" are
        // on the way to valid numbers and must not be applied half-typed.
        num.addEventListener("change", function () {
            const v = parseFloat(num.value);
            if (isFinite(v)) glSetParam(d, v); else glUpdateValueLabel(d);
        });
        num.addEventListener("keydown", function (e) { if (e.key === "Enter") num.blur(); });
        if (GL_HOLE_KEYS.indexOf(d.k) !== -1) el.closest(".gl-row").classList.add("gl-perhole");
    });

    document.getElementById("glModeQ").addEventListener("click", function () { glSetMode("q"); });
    document.getElementById("glModeE").addEventListener("click", function () { glSetMode("e"); });
    document.getElementById("glSpawn5").addEventListener("click", function () {
        // A ring of five around the view centre, 150 units apart.
        for (let i = 0; i < 5; i++) {
            const a = (i / 5) * Math.PI * 2;
            glSpawnShip(glCamera.x + Math.cos(a) * 240 * GL_S, glCamera.y + Math.sin(a) * 240 * GL_S);
        }
    });
    document.getElementById("glSelAll").addEventListener("click", function () { glSelectAll(); glSetMode("e"); });
    document.getElementById("glClearFleet").addEventListener("click", glClearFleet);

    GL_TOGGLE_DEFS.forEach(function (d) {
        const el = document.getElementById("gl-in-" + d.k);
        if (!el) return;   // baked: no control to wire
        glInputs[d.k] = el;
        el.addEventListener("change", function () {
            GLP.v[d.k] = el.checked;
            // Auto-orbit is per ship now; the box commands whoever it means
            // in this mode — the selection in E, the flown ship in Q.
            if (d.k === "autoOrbit") {
                const sel = glMode === "e" ? glSelectedShips() : [];
                glOrbitCommand(sel.length ? sel : [glShip], el.checked);
            }
        });
    });

    // Reset also clears the streamed world and every remembered edit to it;
    // the streamer regenerates the chunks around you on its next pass.
    document.getElementById("glReset").addEventListener("click", function () {
        glResetParams();
        glResetChunks();
        glUpdateChunks(true);
    });
    document.getElementById("glCopy").addEventListener("click", function () {
        const text = glExportParams();
        const note = document.getElementById("glCopyNote");
        // clipboard.writeText is unavailable on file:// in some browsers, so
        // the fallback is not optional here — it is the likely path.
        if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(text)
                .then(function () { note.textContent = "Copied to clipboard."; })
                .catch(function () { console.log(text); note.textContent = "Clipboard blocked — printed to console."; });
        } else {
            console.log(text);
            note.textContent = "Printed to console (F12).";
        }
    });

    document.getElementById("glHideLocked").addEventListener("click", function () {
        const hide = !glPanelEl.classList.contains("gl-hide-locked");
        glPanelEl.classList.toggle("gl-hide-locked", hide);
        try { localStorage.setItem(GL_LOCK_HIDE_STORE, hide ? "1" : ""); } catch (e) { /* ignore */ }
        glSyncLockUi();
    });
    document.getElementById("glCopyLocked").addEventListener("click", function () {
        glCopyText(JSON.stringify(glLocks, null, 2), document.getElementById("glCopyNote"));
    });
    try { glPanelEl.classList.toggle("gl-hide-locked", !!localStorage.getItem(GL_LOCK_HIDE_STORE)); } catch (e) { /* ignore */ }

    glSyncPanelFromParams();
    glSyncLockUi();
}

// Writes the TRUE value to the number box (never while it is being typed in),
// and flags the row when that value is past the slider's own range.
function glUpdateValueLabel(d) {
    const num = glNumInputs[d.k];
    if (!num) return;
    const val = GLP.v[d.k];
    if (document.activeElement !== num) num.value = glFmt(val);
    const row = num.closest(".gl-row");
    // Against the slider's CURRENT range — the position sliders move theirs.
    const rng = glInputs[d.k];
    const lo = rng ? +rng.min : d.min, hi = rng ? +rng.max : d.max;
    if (row) row.classList.toggle("gl-over", val < lo || val > hi);
}

// Pushes GLP back out to the controls. Called by presets, reset, selection and
// mode changes — anything that changes values behind the panel's back.
function glSyncPanelFromParams() {
    // Auto-orbit is per ship; the checkbox is a view of the controlled one.
    GLP.v.autoOrbit = !!(glShip && glShip.autoOrbit);
    GL_PARAM_DEFS.forEach(function (d) {
        const el = glInputs[d.k];
        if (!el) return;
        // Position sliders re-centre on the selected hole (2026-09-10). With a
        // fixed ±36,000 range, touching the slider of a procedural hole 3M out
        // would have teleported it to the slider's end. Now the slider spans
        // ±36,000 around wherever the hole is; the number box sets anything.
        if (d.k === "bhX" || d.k === "bhY") {
            el.min = GLP.v[d.k] - 36000 * GL_S;
            el.max = GLP.v[d.k] + 36000 * GL_S;
        }
        el.value = GLP.v[d.k];
        glUpdateValueLabel(d);
    });
    GL_TOGGLE_DEFS.forEach(function (d) {
        const el = glInputs[d.k];
        if (el) el.checked = !!GLP.v[d.k];
    });
    const mq = document.getElementById("glModeQ"), me = document.getElementById("glModeE");
    if (mq) mq.classList.toggle("gl-on", glMode === "q");
    if (me) me.classList.toggle("gl-on", glMode === "e");
}

// ===================================================
//                     HUD
// ===================================================
// Deliberately shows the lens pass in isolation. Total frame time hides the
// answer: a method can look fine at 60fps on an empty screen and be the entire
// budget once there are ships and asteroids in it.
// Real units for the HUD (2026-09-11; 1 unit = 1,000 km, velocities per 60 Hz frame).
function glFmtAstro(d) {
    if (d < 1e5) return Math.round(d * 1000).toLocaleString() + " km";
    if (d < 0.05 * GL_LY) return (d / GL_AU).toPrecision(3) + " AU";
    return (d / GL_LY).toPrecision(3) + " ly";
}
function glFmtSpeed(v) {
    const kms = v * 60000, c = 299792.458;
    if (kms < c) return Math.round(kms).toLocaleString() + " km/s";
    const lys = kms / (GL_LY * 1000);
    if (lys < 0.01) return (kms / c).toPrecision(3) + "c (" + (kms / (GL_AU * 1000)).toPrecision(3) + " AU/s)";
    return lys.toPrecision(3) + " ly/s";
}
function glFmtMul(m) { return m >= 1e6 ? m.toExponential(0).replace("+", "") : Math.round(m).toLocaleString(); }

// Where in the Milky Way, how crowded, and when.
function glGalaxyLine(s) {
    const R = Math.hypot(s.x - GL_GAL.cx, s.y - GL_GAL.cy) / GL_LY;
    const date = new Date(GL_J2000_MS + glSimTimeS() * 1000).toISOString().slice(0, 10);
    return "<span style='color:#9FD8FF'>" + glGalaxyRegion(s.x, s.y) + "</span> &nbsp; " +
        Math.round(R).toLocaleString() + " ly from the core &nbsp; " +
        glGalaxyDensity(s.x, s.y).toPrecision(2) + " stars/ly² &nbsp; " + date;
}

let glHudTick = 0;
function glUpdateHud() {
    if (++glHudTick % 6) return;   // 10Hz — a HUD that updates every frame is unreadable
    const s = glShip;
    const nb = glNearestBody(s.x, s.y);   // planet, moon, star or hole (was holes only)
    const proper = Math.hypot(s.vx, s.vy);

    // Hyperdrive line. Peak burn velocity is kept on screen after the burn
    // ends, because whether the escape worked is judged after the fact.
    let hyper;
    if (!s.isAlive) {
        // Without this the HUD reads as a live ship sitting inside a horizon,
        // which looks like a broken kill check rather than a successful one.
        hyper = "<span style='color:#FF2E88'>" + (s.deathCause ? "CRASHED into " + s.deathCause : "CONSUMED") +
            " — respawning</span>";
    } else {
        // Drive gear (2026-09-11): Shift+wheel shifts, SPACE drops to 0. In E
        // it shows the first selected formation's gear.
        const gs = glMode === "e" ? glFleetGroups() : null;
        const gear = gs ? (gs.length ? (gs[0].gear || 0) : 0) : glHyperGear;
        hyper = "<span style='color:" + (gear ? "#FFB000" : "#cfe9e6") + "'>GEAR " + gear + "/" +
            Math.round(GLP.v.hyperGearMax) + " &nbsp; ×" + glFmtMul(glGearMul(gear)) + " = " +
            glFmtSpeed(s.baseSpeed * glGearMul(gear)) +
            (gs ? " &nbsp; " + gs.length + " formation" + (gs.length === 1 ? "" : "s") : "") +
            (s.hyperActive ? " &nbsp; BURST " + s.hyperRemaining.toFixed(1) + "s" : "") +
            "</span> &nbsp; Shift+wheel · SPACE = gear 0";
    }

    // Time rate: magenta when dilated, cyan when sped up in a void.
    const tau = s.tau;
    const tcol = tau < 0.95 ? "#FF2E88" : (tau > 1.05 ? "#7DF9FF" : "#cfe9e6");
    const tlabel = tau < 0.95 ? "dilated" : (tau > 1.05 ? "void" : "normal");
    const timeLine = GLP.v.dilationOn
        ? "<span style='color:" + tcol + "'><b>time x" + (tau < 0.1 ? tau.toFixed(3) : tau.toFixed(2)) +
          "</b> (" + tlabel + ")</span>"
        : "time dilation off";

    let autoLine = "";
    if (s.group && s.group.leader !== s) {
        autoLine = "<span style='color:#FFB000'>FORMATION #" + s.group.id + " · " + s.autoState + "</span><br>";
    } else if (s.autoOrbit && s.autoLock) {
        const lh = s.autoLock.hole;
        const la = Math.hypot(s.x - lh.x, s.y - lh.y) - lh.rs;
        autoLine = "<span style='color:#FFB000'>AUTO-ORBIT " + s.autoState + " &nbsp; LOCKED " +
            glBodyName(lh) + " &nbsp; alt " + Math.round(la) + " / " +
            Math.round(s.autoLock.alt) + " (" + ((la - s.autoLock.alt) / s.autoLock.alt * 100).toFixed(0) +
            "%)" + (s.autoLock.ring && s.autoLock.ring.n > 1 ? " · RING " + (s.autoLock.ring.order.indexOf(s) + 1) +
            "/" + s.autoLock.ring.n + " phase " + Math.round(s.ringErr * 180 / Math.PI) + "°" : "") + "</span><br>";
    } else if (s.group) {
        autoLine = "<span style='color:#FFB000'>LEADS #" + s.group.id + " · " + s.autoState + "</span><br>";
    } else if (s.autoState && s.autoState.indexOf("disengaged") !== -1) {
        autoLine = "<span style='color:#FF2E88'>" + s.autoState + "</span><br>";
    }

    const alive = glShips.filter(function (x) { return x.isAlive; }).length;
    const modeLine = glMode === "q"
        ? "<b style='color:#7DF9FF'>Q · DIRECT</b> ship #" + s.id
        : "<b style='color:#FFB000'>E · FLEET</b> " + alive + " ships, " + glSelectedShips().length +
          " selected, " + glGroups.length + " group" + (glGroups.length === 1 ? "" : "s");

    glHudEl.innerHTML =
        modeLine + "<br>" +
        "<b>" + glFps.toFixed(0) + " fps</b> &nbsp; frame " + glFrameMs.toFixed(1) + "ms<br>" +
        "physics " + glPhysMs.toFixed(2) + "ms &nbsp; world " + glWorldMs.toFixed(1) +
            "ms &nbsp; <b>lens " + glLensMs.toFixed(1) + "ms</b>" +
            (GLP.v.gpuSync ? "" : " <span style='color:#FF2E88'>(not GPU-synced)</span>") + "<br>" +
        timeLine + "<br>" +
        // Altitude above the horizon, not centre distance: with holes this big,
        // "r = 1,400" says nothing until you know r_s is 900. Speed is shown as
        // observed (what you see) and proper (what the ship's engines make).
        "ship #" + s.id + " alt " + (nb ? glFmtAstro(Math.max(0, Math.hypot(s.x - nb.x, s.y - nb.y) - nb.rs)) +
            " above " + glBodyName(nb) : "-") + " &nbsp; v=" + glFmtSpeed(proper * tau) + " obs<br>" +
        glGalaxyLine(s) + "<br>" +
        "zoom " + glCamera.zoom.toPrecision(3) + (GLP.v.autoZoom ? " (auto)" : "") + "<br>" +
        hyper + "<br>" +
        glUltraHudLine() + "<br>" +
        (s.trajLock !== null && glMode === "q" ? "<span style='color:#FFB000'>🔒 TRAJECTORY LOCKED " +
            Math.round(((s.trajLock * 180 / Math.PI) % 360 + 360) % 360) + "° &nbsp; right-click releases</span><br>" : "") +
        autoLine +
        (function () {
            const f = glFocusPoint();
            return "chunk " + glChunkOf(f.x) + "," + glChunkOf(f.y) + " &nbsp; " + glChunks.size +
                " loaded &nbsp; " + glBodies.length + " bodies &nbsp; stream " + glChunkGenMs.toFixed(1) + "ms<br>";
        })() +
        "holes " + glHoles.length + " &nbsp; editing #" + (glSelectedHoleIndex + 1) + "<br>" +
        "probes " + glProbes.length + " &nbsp; captured " + glCapturedCount + " &nbsp; ejected " + glEjectedCount + "<br>" +
        (glPaused ? "<span style='color:#FFB000'>PAUSED — . to step</span>" : "&nbsp;");
}
