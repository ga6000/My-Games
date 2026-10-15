// ---------------------------------------------------
//   CONTROLLER AND TOUCH INPUT (2026-10-14)
// ---------------------------------------------------
// "PC wired or Bluetooth controller integration ... also allow for phone users
// to have full control of their character ... standard twin-stick shooter
// controls with trigger or bumper for fire." Plan: INPUT_PLAN.md.
//
// ONE FILE, REMOVABLE. It declares, builds its own DOM and CSS when the page
// is a real game page, and is driven by one call from gameLoop
// (`inputFrame`). Deleting its <script> tag removes all of it; the game files
// only carry `p.moveVec` (updatePlayers) and the one hook.
//
// IT NEVER FIGHTS THE KEYBOARD AND MOUSE. Movement goes in `p.moveVec`, a
// separate field, so a released pad never zeroes a held W. Aim only writes
// mouseX/mouseY while a stick is actually deflected. Fire writes
// p.keys.shoot on this module's own EDGES, so an idle pad never releases a
// mouse button.
//
// EVERYTHING ELSE IS THE KEYBOARD'S OWN FUNCTION. Buttons call the same
// functions the keys call (interactWith, cycleWeapon, arcadeBoomToggle, ...)
// behind the same gates (manual, ESC dialog, reconnect hold, ready screen,
// the walk-out), so there is no second rule set to drift.
//
// Not a GameInstance and has no timers of its own: the poll rides the render
// loop, and every listener is on zSignal() so destroy() takes it down.

const INP_ON = (function () {
    try {
        const q = new URLSearchParams(window.location.search);
        if (q.get("editor") === "1" || q.get("sandbox") === "1") return false;
        if (/node/i.test(navigator.userAgent || "")) return false;
        return typeof document !== "undefined" && !!document.body;
    } catch (e) { return false; }
})();

const INP_DEAD = 0.22;             // radial stick dead zone
const INP_AIM_DIST = 240;          // world px out along the stick; only the direction matters
const INP_TRIGGER = 0.35;          // analog trigger counts as pulled
const INP_TOUCH_FIRE = 0.35;       // right touch stick fires past this fraction of its travel
const INP_STICK_PX = 64;           // touch stick travel (px) for full deflection
const INP_END_GUARD_MS = 1200;     // a held trigger must not skip the end card

// standard-mapping button indices
const INP_B_A = 0, INP_B_B = 1, INP_B_X = 2, INP_B_Y = 3;
const INP_B_LB = 4, INP_B_RB = 5, INP_B_LT = 6, INP_B_RT = 7;
const INP_B_START = 9;
const INP_B_UP = 12, INP_B_DOWN = 13, INP_B_LEFT = 14, INP_B_RIGHT = 15;

let inpKind = "kb";                // "kb" | "pad" | "touch": last input family, for prompts
let inpTouchLayout = false;        // this device has shown touch: phone layout stays on
let inpPadIdx = -1;
let inpPadPrev = [];               // previous pressed state, per button
let inpPadFire = false;
let inpTouchFire = false;
let inpFiring = false;             // the combined state this module last applied
let inpEndSince = 0;
let inpLastPlayer = null;
let inpFsTried = false;
let inpTouchUi = null;             // {root, zones, sticks, buttons}

// "CLICK" / "TAP" / "PRESS A": the verb for the ready screen and end cards.
function inputVerb() {
    if (inpKind === "pad") return "PRESS A";
    if (inpKind === "touch") return "TAP";
    return "CLICK";
}

// Anything that should stop the pad and touch from acting on the world.
function inpWorldBlocked() {
    return codexOpen || helpOpen || netLost || winSequenceRunning() ||
           (typeof lobbyBlocks === "function" && lobbyBlocks()) || gameOver || uiWinShown;
}

// One named action, from a pad button or a touch button. Mirrors the key
// handler's gates, in the same order.
function inpAction(act) {
    initAudio();
    if (codexOpen) { if (act === "use" || act === "menu" || act === "back") closeCodex(); return; }
    if (helpOpen) { if (act === "use" || act === "menu" || act === "back") closeHelp(); return; }
    if (netLost) {
        if (act === "use" && Date.now() - netLostAt >= NET_LOST_OFFER_MS) goSoloAfterLoss();
        else if (act === "menu") openHelp();
        return;
    }
    if (act === "menu") { openHelp(); return; }
    if (typeof lobbyBlocks === "function" && lobbyBlocks()) {
        if (act === "use" || act === "fire" || act === "tap") lobbyClick();
        return;
    }
    if (winSequenceRunning()) return;
    if (gameOver || uiWinShown) {
        if ((act === "use" || act === "fire" || act === "tap") && Date.now() - inpEndSince >= INP_END_GUARD_MS) requestReset();
        return;
    }
    if (act === "tap" || act === "back") return;
    const p = players[0] || spawnPlayer();
    if (!p) return;
    const now = Date.now();
    if (act === "use") { if (!p.downed) interactWith(p); }
    else if (act === "next") { cycleWeapon(p, 1); p.turretArmed = false; }
    else if (act === "prev") { cycleWeapon(p, -1); p.turretArmed = false; }
    else if (act === "boom") { if (ZOMBIE_ARCADE) arcadeBoomToggle(p, now); }
    else if (act === "turret") {
        if (!ZOMBIE_ARCADE || !p.turretHeld || p.downed) return;
        if (p.turretArmed) inpPlaceTurret(p); else p.turretArmed = true;
    }
}

// Place the armed turret along the aim (or the facing, if nothing is aimed).
function inpPlaceTurret(p) {
    const cx = p.x + p.size / 2, cy = p.y + p.size / 2;
    mouseX = cx + (p.facingX || 0) * TURRET_REACH;
    mouseY = cy + (p.facingY || 1) * TURRET_REACH;
    arcadePlaceTurret(p);
}

function inpRadial(x, y) {
    const m = Math.hypot(x, y);
    if (m < INP_DEAD) return { x: 0, y: 0, m: 0 };
    const k = Math.min(1, (m - INP_DEAD) / (1 - INP_DEAD)) / m;
    return { x: x * k, y: y * k, m: Math.min(1, (m - INP_DEAD) / (1 - INP_DEAD)) };
}

// ---------------------------------------------------
//   GAMEPAD
// ---------------------------------------------------
// The state read this frame, merged with touch below.
let inpMove = { x: 0, y: 0 };
let inpAim = null;                 // {x, y} unit, or null

function inpPollPad() {
    inpMove = { x: 0, y: 0 };
    inpAim = null;
    inpPadFire = false;
    if (typeof navigator.getGamepads !== "function") return;
    let pads;
    try { pads = navigator.getGamepads(); } catch (e) { return; }
    if (!pads) return;
    // The pad in use: stay on it; switch to another only when that one is
    // touched and ours is idle. Keeps a second controller from stealing control.
    let pad = inpPadIdx >= 0 ? pads[inpPadIdx] : null;
    if (!pad || !pad.connected) {
        pad = null;
        inpPadIdx = -1;
        for (let i = 0; i < pads.length; i++) {
            if (pads[i] && pads[i].connected) { pad = pads[i]; inpPadIdx = i; break; }
        }
    }
    if (!pad) return;
    const ax = function (i) { return (pad.axes && typeof pad.axes[i] === "number") ? pad.axes[i] : 0; };
    const btn = function (i) { const b = pad.buttons && pad.buttons[i]; return !!b && (b.pressed || b.value > INP_TRIGGER); };
    const pressed = [];
    let any = false;
    for (let i = 0; i < 17; i++) { pressed[i] = btn(i); if (pressed[i]) any = true; }

    const ls = inpRadial(ax(0), ax(1));
    const rs = inpRadial(ax(2), ax(3));
    if (ls.m > 0 || rs.m > 0) any = true;
    if (any) {
        if (inpKind !== "pad") { inpKind = "pad"; inpSyncUi(); }
    } else {
        inpPadPrev = pressed;
        return;
    }

    // buttons: edges
    for (let i = 0; i < pressed.length; i++) {
        if (!pressed[i] || inpPadPrev[i]) continue;
        if (i === INP_B_A) inpAction("use");
        else if (i === INP_B_B) inpAction(helpOpen || codexOpen ? "back" : "boom");
        else if (i === INP_B_X) inpAction("turret");
        else if (i === INP_B_Y) inpAction("next");
        else if (i === INP_B_LB) inpAction("prev");
        else if (i === INP_B_START) inpAction("menu");
        else if (i === INP_B_RB || i === INP_B_RT || i === INP_B_LT) inpAction("fire");
    }
    inpPadPrev = pressed;

    inpMove = { x: ls.x, y: ls.y };
    if (ls.m === 0) {                                  // the D-pad, for pads with no useful stick
        const dx = (pressed[INP_B_RIGHT] ? 1 : 0) - (pressed[INP_B_LEFT] ? 1 : 0);
        const dy = (pressed[INP_B_DOWN] ? 1 : 0) - (pressed[INP_B_UP] ? 1 : 0);
        if (dx || dy) { const l = Math.hypot(dx, dy); inpMove = { x: dx / l, y: dy / l }; }
    }
    if (rs.m > 0) inpAim = { x: rs.x / Math.hypot(rs.x, rs.y), y: rs.y / Math.hypot(rs.x, rs.y) };
    inpPadFire = pressed[INP_B_RB] || pressed[INP_B_RT] || pressed[INP_B_LT];
}

// ---------------------------------------------------
//   TOUCH
// ---------------------------------------------------
const inpTouch = {
    L: { id: null, ox: 0, oy: 0, dx: 0, dy: 0 },     // move
    R: { id: null, ox: 0, oy: 0, dx: 0, dy: 0 }      // aim + fire
};

function inpTouchVec(s) {
    const x = s.dx / INP_STICK_PX, y = s.dy / INP_STICK_PX;
    const m = Math.hypot(x, y);
    if (m < 0.12) return { x: 0, y: 0, m: 0 };
    const mm = Math.min(1, m);
    return { x: x / m * mm, y: y / m * mm, m: mm };
}

const INP_CSS =
    "#touchui{display:none;position:fixed;left:0;top:0;bottom:0;right:var(--side-w,0px);z-index:9;" +
    "touch-action:none;-webkit-user-select:none;user-select:none;-webkit-touch-callout:none}" +
    "body.touch #touchui{display:block}" +
    "#touchui.pad{display:none!important}" +
    "#touchui .tz{position:absolute;top:0;bottom:0;width:50%;touch-action:none}" +
    "#touchui .tz-l{left:0}#touchui .tz-r{right:0}" +
    "#touchui .ts{position:absolute;width:" + (INP_STICK_PX * 2) + "px;height:" + (INP_STICK_PX * 2) +
    "px;border:3px solid #55FFFF;background:rgba(0,0,0,.35);opacity:.28;pointer-events:none;box-sizing:border-box}" +
    "#touchui .ts.on{opacity:.8}" +
    "#touchui .tk{position:absolute;left:50%;top:50%;width:44px;height:44px;margin:-22px 0 0 -22px;" +
    "background:#55FFFF;opacity:.85}" +
    "#touchui .tr .tk{background:#FF3344}#touchui .tr{border-color:#FF3344}" +
    "#touchui .tb{position:absolute;bottom:10px;min-width:56px;height:46px;padding:0 6px;border:3px solid #E8E8E8;" +
    "background:rgba(0,0,0,.6);color:#E8E8E8;font:bold 13px/1 'VT323','Courier New',monospace;letter-spacing:1px;" +
    "text-transform:uppercase;touch-action:none;box-sizing:border-box;border-radius:0;margin:0}" +
    "#touchui .tb:active,#touchui .tb.down{background:#E8E8E8;color:#000}" +
    "#touchui .tb.hide{display:none}" +
    "#touchui .tb.use{border-color:#FFE033;color:#FFE033}" +
    "#touchui .tb.use:active{background:#FFE033;color:#000}" +
    "#touchui .tb.menu{bottom:auto;top:8px;left:8px;min-width:48px;height:34px;opacity:.7}" +
    "#touchrotate{display:none;position:fixed;inset:0;z-index:50;background:#000;color:#55FFFF;" +
    "align-items:center;justify-content:center;text-align:center;font:bold 18px/1.6 'Courier New',monospace;" +
    "letter-spacing:3px;padding:24px}" +
    "@media (orientation:portrait){body.touch #touchrotate{display:flex}}" +
    // The cabinet panel is the one thing that must shrink on a phone: it was
    // sized for a desktop (240px minimum) and would take half a landscape phone.
    "body.arcade.touch{--side-w:152px}" +
    "body.touch #sidebar{padding:8px;gap:6px}" +
    "body.touch #sidebar .cab-pair,body.touch #sidebar .cab-sess,body.touch #sideGoals,body.touch #sidebar #ui{display:none}" +
    "body.touch #sidebar #objective{font-size:13px;line-height:1.25;border-left-width:3px;padding-left:6px}" +
    "body.touch #sidebar .cab-cond{font-size:18px}" +
    "body.touch,body.touch canvas{touch-action:none;overscroll-behavior:none}";

function inpBuildUi() {
    const st = document.createElement("style");
    st.textContent = INP_CSS;
    document.head.appendChild(st);

    const root = document.createElement("div");
    root.id = "touchui";
    root.innerHTML =
        "<div class='tz tz-l'></div><div class='tz tz-r'></div>" +
        "<div class='ts tl'><div class='tk'></div></div>" +
        "<div class='ts tr'><div class='tk'></div></div>" +
        "<button class='tb menu' data-a='menu'>MENU</button>" +
        "<button class='tb' data-a='prev' style='left:calc(50% - 150px)'>&lt; GUN</button>" +
        "<button class='tb use' data-a='use' style='left:calc(50% - 82px)'>USE</button>" +
        "<button class='tb' data-a='next' style='left:calc(50% - 14px)'>GUN &gt;</button>" +
        "<button class='tb hide' data-a='boom' style='left:calc(50% + 62px)'>BOOM</button>" +
        "<button class='tb hide' data-a='turret' style='left:calc(50% + 130px)'>TURRET</button>";
    document.body.appendChild(root);

    const rot = document.createElement("div");
    rot.id = "touchrotate";
    rot.innerHTML = "<div>TURN YOUR PHONE SIDEWAYS<br>TO PLAY</div>";
    document.body.appendChild(rot);

    const sig = { signal: zSignal() };
    const sticks = { L: root.querySelector(".tl"), R: root.querySelector(".tr") };
    inpTouchUi = { root: root, sticks: sticks, boom: root.querySelector("[data-a=boom]"), turret: root.querySelector("[data-a=turret]") };

    function home(which) {
        const r = root.getBoundingClientRect();
        const s = INP_STICK_PX * 2;
        const x = which === "L" ? 28 : r.width - s - 28;
        sticks[which].style.left = x + "px";
        sticks[which].style.top = Math.max(0, r.height - s - 28) + "px";
        sticks[which].querySelector(".tk").style.transform = "";
    }
    inpTouchUi.home = home;
    home("L"); home("R");
    window.addEventListener("resize", function () {
        if (inpTouch.L.id === null) home("L");
        if (inpTouch.R.id === null) home("R");
    }, sig);

    function bindZone(zoneEl, which) {
        const s = inpTouch[which], base = sticks[which], knob = base.querySelector(".tk");
        zoneEl.addEventListener("pointerdown", function (e) {
            if (e.pointerType === "mouse") return;            // a mouse on a touch laptop: the mouse handlers own it
            e.preventDefault();
            inpTouchActive();
            if (s.id !== null) return;
            s.id = e.pointerId; s.dx = s.dy = 0;
            const r = root.getBoundingClientRect();
            s.ox = e.clientX; s.oy = e.clientY;
            base.style.left = (e.clientX - r.left - INP_STICK_PX) + "px";
            base.style.top = (e.clientY - r.top - INP_STICK_PX) + "px";
            base.classList.add("on");
            try { zoneEl.setPointerCapture(e.pointerId); } catch (err) { /* old browsers */ }
            inpAction("tap");                                  // READY and the end cards take any tap
        }, { signal: zSignal(), passive: false });
        zoneEl.addEventListener("pointermove", function (e) {
            if (e.pointerId !== s.id) return;
            e.preventDefault();
            let dx = e.clientX - s.ox, dy = e.clientY - s.oy;
            const m = Math.hypot(dx, dy);
            if (m > INP_STICK_PX) { dx = dx / m * INP_STICK_PX; dy = dy / m * INP_STICK_PX; }
            s.dx = dx; s.dy = dy;
            knob.style.transform = "translate(" + dx + "px," + dy + "px)";
        }, { signal: zSignal(), passive: false });
        const up = function (e) {
            if (e.pointerId !== s.id) return;
            s.id = null; s.dx = s.dy = 0;
            base.classList.remove("on");
            home(which);
            initAudio();                                       // touch activation lands on release
            inpTryFullscreen();
        };
        zoneEl.addEventListener("pointerup", up, sig);
        zoneEl.addEventListener("pointercancel", up, sig);
    }
    bindZone(root.querySelector(".tz-l"), "L");
    bindZone(root.querySelector(".tz-r"), "R");

    const btns = root.querySelectorAll(".tb");
    for (let i = 0; i < btns.length; i++) {
        const b = btns[i];
        b.addEventListener("pointerdown", function (e) {
            if (e.pointerType === "mouse") return;
            e.preventDefault();
            inpTouchActive();
            inpAction(b.getAttribute("data-a"));
        }, { signal: zSignal(), passive: false });
        b.addEventListener("pointerup", function () { initAudio(); inpTryFullscreen(); }, sig);
    }
}

// The first touch turns the touch layout on (and a pad's hidden overlay back on).
function inpTouchActive() {
    if (inpKind !== "touch" || !inpTouchLayout) { inpKind = "touch"; inpTouchLayout = true; inpSyncUi(); }
}

function inpSyncUi() {
    if (!inpTouchUi) return;
    document.body.classList.toggle("touch", inpTouchLayout);
    inpTouchUi.root.classList.toggle("pad", inpKind === "pad");
    if (inpTouch.L.id === null) inpTouchUi.home("L");        // laid out while display:none, so re-home now
    if (inpTouch.R.id === null) inpTouchUi.home("R");
    if (typeof resizeCanvas === "function") resizeCanvas();   // --side-w changed
}

// Full screen is most of a phone's usable height. Once, on a real gesture;
// refused quietly where unsupported (iPhone Safari) or already full.
function inpTryFullscreen() {
    if (inpFsTried || inpKind !== "touch") return;
    inpFsTried = true;
    try {
        const el = document.documentElement;
        if (document.fullscreenElement || !el.requestFullscreen) return;
        el.requestFullscreen({ navigationUI: "hide" }).then(function () {
            if (screen.orientation && screen.orientation.lock) screen.orientation.lock("landscape").catch(function () {});
        }).catch(function () {});
    } catch (e) { /* not available */ }
}

// ---------------------------------------------------
//   THE FRAME
// ---------------------------------------------------
// From gameLoop, before the simulation steps, so what it writes is read by
// the very next update().
function inputFrame(now) {
    if (!INP_ON) return;
    if (gameOver || uiWinShown) { if (!inpEndSince) inpEndSince = now; } else inpEndSince = 0;

    inpPollPad();

    // touch -> the same two vectors; a deflected pad stick wins
    let touchFire = false;
    if (inpTouch.L.id !== null) {
        const v = inpTouchVec(inpTouch.L);
        if (v.m > 0 && !(inpMove.x || inpMove.y)) inpMove = { x: v.x, y: v.y };
    }
    if (inpTouch.R.id !== null) {
        const v = inpTouchVec(inpTouch.R);
        if (v.m > 0) {
            if (!inpAim) inpAim = { x: v.x / v.m, y: v.y / v.m };
            if (v.m >= INP_TOUCH_FIRE) touchFire = true;
        }
    }
    inpTouchFire = touchFire;

    const p = players[0];
    if (p !== inpLastPlayer) { inpLastPlayer = p; inpFiring = false; }

    if (inpTouchUi && p) {
        const hasBoom = ZOMBIE_ARCADE && (p.boomUntil > now || p.boomStore > 0);
        inpTouchUi.boom.classList.toggle("hide", !hasBoom);
        const hasTurret = ZOMBIE_ARCADE && !!p.turretHeld;
        inpTouchUi.turret.classList.toggle("hide", !hasTurret);
        inpTouchUi.turret.textContent = p.turretArmed ? "PLACE" : "TURRET";
    }

    if (!p || inpWorldBlocked() || p.exited) {
        if (p) p.moveVec = null;
        if (inpFiring && p) p.keys.shoot = false;
        inpFiring = false;
        return;
    }

    // movement (analog; arcadeExitControl's walk-out is handled in updatePlayers)
    p.moveVec = (inpMove.x || inpMove.y) ? { x: inpMove.x, y: inpMove.y } : null;

    // aim: only while a stick is deflected, so the mouse keeps its own
    if (inpAim) {
        const cx = p.x + p.size / 2, cy = p.y + p.size / 2;
        mouseX = cx + inpAim.x * INP_AIM_DIST;
        mouseY = cy + inpAim.y * INP_AIM_DIST;
    }

    // fire: this module's edges only
    const want = inpPadFire || inpTouchFire;
    if (want && !inpFiring) {
        inpFiring = true;
        if (ZOMBIE_ARCADE && p.turretHeld && p.turretArmed && !p.downed) {
            if (inpAim) arcadePlaceTurret(p); else inpPlaceTurret(p);
        } else p.keys.shoot = true;
    } else if (!want && inpFiring) {
        inpFiring = false;
        p.keys.shoot = false;
    }
}

// ---------------------------------------------------
//   BOOT
// ---------------------------------------------------
if (INP_ON) {
    inpBuildUi();
    const sigOpts = { signal: zSignal(), capture: true, passive: true };
    // The last family of input decides the prompts and whether the overlay shows.
    window.addEventListener("keydown", function () { if (inpKind !== "kb") { inpKind = "kb"; inpSyncUi(); } }, sigOpts);
    window.addEventListener("pointerdown", function (e) {
        if (e.pointerType === "touch" || e.pointerType === "pen") inpTouchActive();
        else if (inpKind !== "kb") { inpKind = "kb"; inpSyncUi(); }
    }, sigOpts);
    try {
        if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
            inpKind = "touch";
            inpTouchLayout = true;
        }
    } catch (e) { /* no matchMedia */ }
    window.addEventListener("gamepadconnected", function () { /* the poll finds it; this just lets the page know one exists */ }, sigOpts);
    inpSyncUi();
}
