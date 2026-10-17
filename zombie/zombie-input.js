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
let inpHintGone = false;           // the add-to-home-screen tip was dismissed
let inpTouchUi = null;             // {root, zones, sticks, buttons}

// "CLICK" / "TAP" / "PRESS A": the verb for the ready screen and end cards.
// A little closer on a phone: the 960x540 desktop window shows a world the
// thumbs and a small screen cannot read.
const INP_ZOOM_BOOST = 1.2;
function inputZoomBoost() { return inpTouchLayout ? INP_ZOOM_BOOST : 1; }
function inputHidesRadar() { return inpTouchLayout; }

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
    if (act === "hint") {                              // dismiss the install tip, for good
        try { localStorage.setItem("zombie_a2hs_hint", "1"); } catch (e) { /* private mode */ }
        inpHintGone = true;
        return;
    }
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
    "body.arcade.touch{--side-w:calc(132px + env(safe-area-inset-right,0px))}" +   // the notch inset is padding INSIDE the panel, so it widens it rather than squeezing the content
    "body.touch #sidebar{padding:6px;gap:5px}" +
    // The minimap is unreadable at phone scale, so it goes (its draw is skipped too).
    "body.touch #sidebar .cab-radar{display:none}" +
    // Gun strip and perks hug the right edge of the panel.
    "body.touch #sidebar #loadout{width:100%;align-items:flex-end}" +
    "body.touch #sidebar #gun,body.touch #sidebar #perks{width:100%;justify-content:flex-end;align-items:flex-end}" +
    // The loadout, compacted so gun, rounds, strip and four perks all fit in a
    // phone's ~300-390px of height (CSS beats the icons' width/height attributes).
    "body.touch #sidebar #gunIcon{width:72px;height:24px;margin-bottom:2px}" +
    "body.touch #sidebar #ammoBig{font-size:28px}" +
    "body.touch #sidebar #gunName{font-size:12px;letter-spacing:1px}" +
    "body.touch #sidebar #gunStrip{gap:3px;margin-top:4px;justify-content:flex-end}" +
    "body.touch #sidebar #gunStrip .slot{padding:1px 3px;gap:2px}" +
    "body.touch #sidebar #gunStrip i{font-size:11px}" +
    "body.touch #sidebar #gunStrip .slot.turret{font-size:11px}" +
    "body.touch #sidebar #gunStrip i{display:none}" +
    "body.touch #sidebar #perks{gap:9px 10px;margin:0 6px 6px auto}" +
    "body.touch #sidebar #perks .perk{width:30px;height:30px}" +
    "body.touch #sidebar #perks .perk img{width:21px;height:21px}" +
    "body.touch #sidebar #perks .perk b{font-size:10px;right:-4px;bottom:-7px;padding:0 2px}" +
    // A short phone (Safari with its bars up is ~300px tall): drop what the
    // objective and the lives blocks already say, so the loadout is never clipped.
    "@media (max-height:400px){body.touch #sidebar .cab-row,body.touch #sidebar .cab-l,body.touch #sidebar #gunName{display:none}" +
    "body.touch #sidebar #objective{font-size:11px}body.touch #sidebar #perks{margin-bottom:2px}}" +
    "body.touch #sidebar .cab-pair,body.touch #sidebar .cab-sess,body.touch #sideGoals,body.touch #sidebar #ui{display:none}" +
    "body.touch #sidebar #objective{font-size:13px;line-height:1.25;border-left-width:3px;padding-left:6px}" +
    "body.touch #sidebar .cab-cond{font-size:18px}" +
    "body.touch,body.touch canvas{touch-action:none;overscroll-behavior:none}" +
    // Cards, toasts and the ESC dialog were sized for a desktop window and ran
    // off a phone; they now fit the play area (the window minus the panel).
    "body.touch #toast{top:40px;font-size:15px;letter-spacing:1px;line-height:1.3;width:max-content;" +
    "max-width:calc(100vw - var(--side-w) - 28px);text-align:center;white-space:normal;box-sizing:border-box}" +
    "body.touch #prompt{font-size:13px;bottom:66px;width:max-content;max-width:calc(100vw - var(--side-w) - 28px);" +
    "text-align:center;box-sizing:border-box}" +
    "body.touch #win,body.touch #gameover{font-size:22px;padding:10px 14px;line-height:1.25;" +
    "max-width:calc(100vw - var(--side-w) - 20px);max-height:calc(100vh - 12px);overflow:hidden;box-sizing:border-box}" +
    "body.touch .runscore{font-size:11px;margin:6px auto 4px;line-height:1.35}" +
    "body.touch .runscore .total{font-size:20px}" +
    "body.touch #startprompt{max-width:calc(100vw - var(--side-w) - 20px);padding:10px 14px;font-size:13px;" +
    "box-sizing:border-box}" +
    "body.touch #startprompt .lb-head{font-size:14px;letter-spacing:3px;margin-bottom:8px}" +
    "body.touch #startprompt .lb-row{gap:12px;margin-bottom:8px}" +
    "body.touch #startprompt .lb-hint{font-size:15px;letter-spacing:3px}" +
    "body.touch #spectate,body.touch #netlost,body.touch #zonename,body.touch #roundcard{" +
    "max-width:calc(100vw - var(--side-w) - 20px);box-sizing:border-box;font-size:14px}" +
    "body.touch #help{inset:auto;left:6px;top:6px;bottom:6px;right:calc(var(--side-w) + 6px);font-size:12px}" +
    "body.touch .hp-body{gap:10px;padding:8px 10px}" +
    "body.touch .hp-col{flex:1 1 180px;min-width:0}" +
    "body.touch #itemList{grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:6px 12px}" +
    "body.touch #itemList .ico{width:48px}" +
    // Safari ignores the unprefixed user-select and shows Select All / Copy on a
    // long press; it needs the -webkit- forms, on everything.
    "html,body,body *{-webkit-user-select:none;user-select:none;-webkit-touch-callout:none;" +
    "-webkit-tap-highlight-color:transparent}" +
    // Notch and home-bar insets (non-zero only in landscape standalone).
    "#touchui{left:env(safe-area-inset-left,0px)}" +
    "body.touch #sidebar{padding-right:calc(8px + env(safe-area-inset-right,0px));padding-bottom:calc(12px + env(safe-area-inset-bottom,0px))}" +
    "#touchui .tb.hint{bottom:auto;top:8px;left:50%;transform:translateX(-50%);height:auto;padding:6px 10px;" +
    "font-size:12px;white-space:nowrap;border-color:#FFE033;color:#FFE033;opacity:.9}";

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
        "<button class='tb hint hide' data-a='hint'>FULL SCREEN: SHARE &gt; ADD TO HOME SCREEN &nbsp;[X]</button>" +
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
    inpTouchUi = { root: root, sticks: sticks, boom: root.querySelector("[data-a=boom]"),
                   turret: root.querySelector("[data-a=turret]"), hint: root.querySelector("[data-a=hint]") };

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

    // ONE set of touch-event handlers on the overlay, classifying every touch
    // itself (a button, or the left / right half). This replaced per-element
    // pointer handlers, which on iOS stopped the buttons working while a stick
    // thumb was down: touch events are the one multi-touch API every phone
    // browser agrees on. preventDefault on touchstart is also what stops iOS
    // from starting a text selection, the Select All / Copy callout, a
    // magnifier or a pinch from a held thumb.
    const knobs = { L: sticks.L.querySelector(".tk"), R: sticks.R.querySelector(".tk") };
    const heldBtn = {};                                    // touch id -> button element

    function stickDown(which, t) {
        const s = inpTouch[which], base = sticks[which];
        const r = root.getBoundingClientRect();
        s.id = t.identifier; s.dx = s.dy = 0; s.ox = t.clientX; s.oy = t.clientY;
        base.style.left = (t.clientX - r.left - INP_STICK_PX) + "px";
        base.style.top = (t.clientY - r.top - INP_STICK_PX) + "px";
        base.classList.add("on");
    }
    function stickRelease(which) {
        const s = inpTouch[which];
        s.id = null; s.dx = s.dy = 0;
        sticks[which].classList.remove("on");
        home(which);
    }
    function onStart(e) {
        e.preventDefault();
        inpTouchActive();
        const r = root.getBoundingClientRect();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            const btn = (t.target && t.target.closest) ? t.target.closest(".tb") : null;
            if (btn) {
                heldBtn[t.identifier] = btn;
                btn.classList.add("down");
                inpAction(btn.getAttribute("data-a"));
                continue;
            }
            inpAction("tap");                              // READY and the end cards take any tap
            const which = (t.clientX - r.left) < r.width / 2 ? "L" : "R";
            if (inpTouch[which].id === null) stickDown(which, t);
        }
    }
    function onMove(e) {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const t = e.changedTouches[i];
            for (const which of ["L", "R"]) {
                const s = inpTouch[which];
                if (s.id !== t.identifier) continue;
                let dx = t.clientX - s.ox, dy = t.clientY - s.oy;
                const m = Math.hypot(dx, dy);
                if (m > INP_STICK_PX) { dx = dx / m * INP_STICK_PX; dy = dy / m * INP_STICK_PX; }
                s.dx = dx; s.dy = dy;
                knobs[which].style.transform = "translate(" + dx + "px," + dy + "px)";
            }
        }
    }
    function onEnd(e) {
        e.preventDefault();
        for (let i = 0; i < e.changedTouches.length; i++) {
            const id = e.changedTouches[i].identifier;
            if (heldBtn[id]) { heldBtn[id].classList.remove("down"); delete heldBtn[id]; }
            if (inpTouch.L.id === id) stickRelease("L");
            if (inpTouch.R.id === id) stickRelease("R");
        }
        initAudio();                                       // touch activation lands on release
        inpTryFullscreen();
    }
    const tOpts = { signal: zSignal(), passive: false };
    root.addEventListener("touchstart", onStart, tOpts);
    root.addEventListener("touchmove", onMove, tOpts);
    root.addEventListener("touchend", onEnd, tOpts);
    root.addEventListener("touchcancel", onEnd, tOpts);

    // Belt and braces for the selection / callout / pinch paths touch events
    // do not cover (a long press on the sidebar, a gesture that starts off the overlay).
    document.addEventListener("selectstart", function (e) { e.preventDefault(); }, { signal: zSignal() });
    document.addEventListener("gesturestart", function (e) { e.preventDefault(); }, { signal: zSignal(), passive: false });
}

// The first touch turns the touch layout on (and a pad's hidden overlay back on).
function inpTouchActive() {
    if (inpKind !== "touch" || !inpTouchLayout) { inpKind = "touch"; inpTouchLayout = true; inpSyncUi(); }
}

// "Click anywhere to restart" / "Tap anywhere ..." / "Press A to ..." on both end cards.
function inpEndCardWords() {
    const verb = inpKind === "pad" ? "Press A" : (inpKind === "touch" ? "Tap" : "Click");
    const vs = document.querySelectorAll(".rv"), as = document.querySelectorAll(".ra");
    for (let i = 0; i < vs.length; i++) vs[i].textContent = verb;
    for (let i = 0; i < as.length; i++) as[i].style.display = inpKind === "pad" ? "none" : "";
}

function inpSyncUi() {
    if (!inpTouchUi) return;
    inpEndCardWords();
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

// iOS gives a web page no way to hide Safari's address bar, and has no
// Fullscreen API on iPhone. Opened from the Home Screen it runs with no browser
// chrome at all (apple-mobile-web-app-capable in Zombie.html), so the tip shows
// on the ready screen until dismissed.
function inpWantsHomeHint() {
    if (inpHintGone || !inpTouchLayout) return false;
    if (typeof lobbyBlocks !== "function" || !lobbyBlocks()) return false;
    const ua = navigator.userAgent || "";
    const ios = /iPhone|iPad|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (!ios) return false;
    if (navigator.standalone) return false;
    try {
        if (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) return false;
        if (localStorage.getItem("zombie_a2hs_hint") === "1") { inpHintGone = true; return false; }
    } catch (e) { /* storage blocked: show it */ }
    return true;
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

    if (inpTouchUi) {
        inpTouchUi.hint.classList.toggle("hide", !inpWantsHomeHint());
    }

    if (inpTouchUi && p) {
        const live = !zDemo && !(typeof lobbyBlocks === "function" && lobbyBlocks());   // not the attract run's survivor
        const hasBoom = live && ZOMBIE_ARCADE && (p.boomUntil > now || p.boomStore > 0);
        inpTouchUi.boom.classList.toggle("hide", !hasBoom);
        const hasTurret = live && ZOMBIE_ARCADE && !!p.turretHeld;
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
