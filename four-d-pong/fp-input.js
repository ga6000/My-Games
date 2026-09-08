// ===================================================
//   4D Pong -- input
// ===================================================
// e.code, NOT e.key. Four people share one keyboard, so what matters is where
// a key physically IS, not what the layout prints on it -- `code` is the
// physical position and survives an AZERTY or Dvorak player joining the game.
// It also fixes the Shift problem for free: e.key reports both shifts as
// "Shift", while ShiftLeft and ShiftRight are distinct codes, which is what
// makes the right-hand seat's fire key possible at all.
//
// EVERY listener goes through the one AbortController in fp-core.js. The file
// this replaces attached three bare listeners to window with no way to remove
// them, which is the leak the hard constraint exists to stop.
"use strict";

// Four people can physically stand at a keyboard in this order: far-left,
// left-centre, right-centre, far-right.
//
//   LEFT   seat  W / S      move  |  A / D  depth  |  Q          fire (or A+D)
//   RIGHT  seat  Up / Down  move  |  Lt / Rt depth |  RightShift fire (or Lt+Rt)
//   TOP    seat  F / H      move  |  T / G  depth  |  KeyY       fire (or T+G)
//   BOTTOM seat  J / L      move  |  I / K  depth  |  KeyO       fire (or I+K)
//
// DEPTH NOW EXISTS ON EVERY SEAT. It used to be two-paddle-only, on the
// reasoning that a paddle which can leave its edge stops being a paddle. The
// user overruled that: four-way play wants both axes, and the trade-off is the
// point -- advancing into the middle ground abandons your own goal to contest
// the power-up. See shuffleSeat() in fp-entities.js.
//
// Every seat also keeps the ORIGINAL GAME'S FIRE IDIOM: both depth keys held
// together. That is how the blaster worked before any of this, it costs no
// extra keys, and on the top and bottom seats it is the pair that sits under
// the same fingers as their movement.
var SEAT_KEYS = [
    { minus: "KeyW",    plus: "KeyS",      depthOut: "KeyD",      depthIn: "KeyA",       fire: "KeyQ" },
    { minus: "ArrowUp", plus: "ArrowDown", depthOut: "ArrowLeft", depthIn: "ArrowRight", fire: "ShiftRight" },
    { minus: "KeyF",    plus: "KeyH",      depthOut: "KeyG",      depthIn: "KeyT",       fire: "KeyY" },
    { minus: "KeyJ",    plus: "KeyL",      depthOut: "KeyI",      depthIn: "KeyK",       fire: "KeyO" }
];

// Shown under each seat's goal by fp-render.js.
//
// ASCII ONLY, both here and in the legend below. 3.2: the embedded faces are
// the Google Fonts LATIN subsets, so an arrow glyph (U+2190+) is not in either
// one and degrades to Courier New mid-word -- which rendered "UP/DOWN" as a
// pair of dashes on screen. Spelling the keys out costs a few characters and
// is legible in the face the rest of the HUD is already using.
var KEY_HINT = ["W/S A/D  Q", "ARROWS  RSHIFT", "F/H T/G  Y", "J/L I/K  O"];

// The same, spelled out for the menu.
var KEY_LEGEND = [
    "<b>LEFT</b> W/S move &middot; A/D in-out &middot; Q or A+D fire",
    "<b>RIGHT</b> UP/DOWN move &middot; LEFT/RIGHT in-out &middot; RSHIFT or BOTH fire",
    "<b>TOP</b> F/H move &middot; T/G in-out &middot; Y or T+G fire",
    "<b>BOTTOM</b> J/L move &middot; I/K in-out &middot; O or I+K fire"
];

// ---------------------------------------------------------------------------
// ONLINE USES ONE KEY SET FOR EVERYBODY, MAPPED TO YOUR OWN SEAT
// ---------------------------------------------------------------------------
// The couch map above is four clusters spread across one keyboard, which is
// right when four people share it and wrong the moment each has their own. A
// player seated TOP online would otherwise have to reach for F/H while their
// whole keyboard sat idle.
//
// So online, both WASD and the arrows drive YOUR paddle, mapped by which way
// your seat actually slides: LEFT/RIGHT move on the vertical pair, TOP/BOTTOM
// on the horizontal one. Nobody has to be told which seat they were given.
//
// WHICHEVER PAIR IS LEFT OVER IS YOUR DEPTH CONTROL, and holding both of it at
// once fires -- the original game's idiom, and the reason a TOP player fires
// with W+S while a LEFT player fires with A+D. Both also have a dedicated fire
// key, because a two-key chord is a poor thing to need in a hurry.
var ONLINE_UP    = ["KeyW", "ArrowUp"];
var ONLINE_DOWN  = ["KeyS", "ArrowDown"];
var ONLINE_LEFT  = ["KeyA", "ArrowLeft"];
var ONLINE_RIGHT = ["KeyD", "ArrowRight"];
var ONLINE_FIRE  = ["KeyQ", "ShiftRight", "Slash", "KeyE"];

function anyHeld(list) {
    for (var i = 0; i < list.length; i++) if (held[list[i]]) return true;
    return false;
}

function inList(list, code) {
    for (var i = 0; i < list.length; i++) if (list[i] === code) return true;
    return false;
}

var held = Object.create(null);

// ===================================================
//   ATTACH
// ===================================================
function attachInput(signal) {
    window.addEventListener("keydown", onKeyDown, { signal: signal });
    window.addEventListener("keyup", onKeyUp, { signal: signal });
    // A held key with the window unfocused would otherwise stay held forever,
    // and the player comes back to a paddle driving itself into a wall.
    window.addEventListener("blur", releaseAll, { signal: signal });
    window.addEventListener("resize", resize, { signal: signal });

    // The tab losing visibility pauses rather than letting the accumulator
    // bank several seconds of simulation to replay at once on return.
    document.addEventListener("visibilitychange", function () {
        if (document.hidden && phase === "play") setPhase("paused");
    }, { signal: signal });
}

function releaseAll() {
    for (var k in held) delete held[k];
}

function onKeyDown(e) {
    if (e.repeat) return;
    held[e.code] = true;

    // Space is pause during play and start-the-countdown from the menu, which
    // is how the original behaved and what anyone who has played it will try.
    if (e.code === "Space") {
        e.preventDefault();
        if (phase === "menu") { startMatch(); return; }
        if (phase === "play") { setPhase("paused"); return; }
        if (phase === "paused") { setPhase("play"); return; }
        return;
    }

    if (e.code === "Enter" && phase === "over") { startMatch(); return; }

    if (e.code === "Escape") {
        if (phase !== "menu") showMenu();
        return;
    }

    if (e.code === "KeyM") {
        var m = toggleMute();
        hintEl.textContent = m ? "MUTED · M TO UNMUTE"
                               : "SPACE PAUSE · ESC MENU · M MUTE";
        return;
    }

    // Arrow keys and space scroll the page; a game that scrolls under its own
    // players is a game nobody finishes a rally in.
    if (e.code.indexOf("Arrow") === 0) e.preventDefault();

    if (phase !== "play") return;

    // Fire is edge-triggered on keydown, not polled while held: the blaster
    // has a cooldown, and polling it turns a held key into an automatic weapon
    // for anyone who noticed.
    if (net.on) {
        if (net.mySeat < 0) return;                    // spectator
        if (!inList(ONLINE_FIRE, e.code)) return;
        // A guest asks the host, which owns the cooldown; the host fires
        // directly. sendFire() returns false when we ARE the host.
        if (!sendFire()) tryFire(seats[net.mySeat]);
        return;
    }

    for (var i = 0; i < seats.length; i++) {
        var seat = seats[i];
        if (!seat || seat.kind !== HUMAN) continue;
        if (e.code === SEAT_KEYS[i].fire) { tryFire(seat); return; }
    }
}

function onKeyUp(e) {
    delete held[e.code];
}

// ===================================================
//   POLL  -- called once per fixed simulation step
// ===================================================
function pollInput(dt) {
    if (net.on) { pollOnlineInput(dt); return; }

    for (var i = 0; i < seats.length; i++) {
        var seat = seats[i];
        if (!seat || seat.kind !== HUMAN) continue;
        var k = SEAT_KEYS[i];

        if (held[k.minus]) slideSeat(seat, -1, dt);
        if (held[k.plus]) slideSeat(seat, 1, dt);

        if (k.depthOut) {
            // depthOut moves AWAY from your own wall, toward the middle ground.
            var pushing = held[k.depthOut], pulling = held[k.depthIn];
            if (pushing) shuffleSeat(seat, 1, dt);
            if (pulling) shuffleSeat(seat, -1, dt);

            // Both depth keys at once fires -- the original game's idiom, now on
            // every seat rather than only the two that had a depth pair.
            if (pushing && pulling) tryFire(seat);
        }
    }
}

// Online, you drive one paddle and only one. Which keys move it depends on
// which way your seat slides, not on which seat it is -- see the note above
// ONLINE_UP.
function pollOnlineInput(dt) {
    if (net.mySeat < 0) return;                        // spectator: nothing to drive
    var seat = seats[net.mySeat];
    if (!seat || seat.kind !== HUMAN) return;

    var out, back;

    if (SEAT_AXIS[net.mySeat] === "y") {
        // LEFT / RIGHT: slide on the vertical pair, depth on the horizontal one.
        if (anyHeld(ONLINE_UP)) slideSeat(seat, -1, dt);
        if (anyHeld(ONLINE_DOWN)) slideSeat(seat, 1, dt);
        out = (net.mySeat === LEFT) ? ONLINE_RIGHT : ONLINE_LEFT;
        back = (net.mySeat === LEFT) ? ONLINE_LEFT : ONLINE_RIGHT;
    } else {
        // TOP / BOTTOM: slide on the horizontal pair, depth on the vertical one.
        if (anyHeld(ONLINE_LEFT)) slideSeat(seat, -1, dt);
        if (anyHeld(ONLINE_RIGHT)) slideSeat(seat, 1, dt);
        out = (net.mySeat === TOP) ? ONLINE_DOWN : ONLINE_UP;
        back = (net.mySeat === TOP) ? ONLINE_UP : ONLINE_DOWN;
    }

    var pushing = anyHeld(out), pulling = anyHeld(back);
    if (pushing) shuffleSeat(seat, 1, dt);
    if (pulling) shuffleSeat(seat, -1, dt);

    // Both at once = fire. The original idiom, so a TOP player fires with W+S
    // and a LEFT player with A+D. Guests ask the host, which owns the cooldown.
    if (pushing && pulling) { if (!sendFire()) tryFire(seat); }
}
