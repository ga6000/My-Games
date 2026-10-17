// ===================================================
//   RAIL SANDBOX — blood, silos, pumps, the throttle
// ===================================================
// BLOOD FUELS THE BLOOD TRAIN. There is no second resource and no abstract
// "fuel" currency: a silo holds blood, the pump moves it into the locomotive,
// and the locomotive burns it to make power. zombie-train.js reached the same
// conclusion from the other direction ("call the silo count fuel and move
// on") -- the difference here is that the transfer is a thing you drive to
// and stop at, rather than a counter that fills elsewhere.
//
// THE PUMP IS LOUD, and that is its cost. Fuelling is the one moment the
// train is stationary, committed, and announcing itself.
"use strict";

// --- the locomotive's numbers ---------------------------------------
// Power is divided by total mass in railCarsUpdate, so these are the figures
// for a bare locomotive (mass 4.0): 520/4 = 130 px/s^2, which takes it to
// walking pace in under two seconds and to full speed in about nine.
const RAIL_LOCO_POWER = 520;      // px/s^2 * mass, at full notch
const RAIL_LOCO_VMAX = 980;       // px/s -- about 4x walking
const RAIL_BRAKE_FULL = 760;      // px/s^2 * mass
const RAIL_BRAKE_LIGHT = 260;
const RAIL_REVERSE_MAX_V = 9;     // you may only change direction near a stand

// Fuel is 0..1 of a tank, and these two numbers were MEASURED against the
// map rather than guessed.
//
// The loop is 11,758px round. The first cut burned 0.0105/s, which measured
// as SEVEN LAPS on one tank -- and a fuel mechanic you never reach in a test
// session is not a mechanic. At 0.030 a bare locomotive gets 33s at full
// notch, and a four-car train measured 43s and 2.86 laps, which is the figure
// that matters. The burn scales with the notch (0.3 + 0.7 * notch/4), so a
// gentler drive stretches it further.
//
// Pumping a dry tank full takes ~9 seconds. That is deliberately long: the
// pump's whole cost is that it is loud and the train cannot move, and at the
// old 0.16 (6s) there was barely time for anything to arrive.
//
// Both are on dev-panel sliders -- these are starting points, not findings.
const RAIL_FUEL_BURN = 0.030;     // tank fraction per second at full notch
const RAIL_PUMP_RATE = 0.11;      // tank fraction per second
const RAIL_PUMP_SPEED = 26;       // px/s -- at or below this the pump can latch
const RAIL_PUMP_TOL = 90;         // px either side of the stop
const RAIL_PUMP_NOISE_MS = 900;
const RAIL_PUMP_NOISE_R = 760;    // "alerts zombies in area and is loud"

let railBloodBank = 0;            // blood collected but not yet in a silo
let railScrap = 1500;             // currency, for the buyable doors

function railFuelReset() {
    railBloodBank = 0;
    railScrap = 1500;
    for (let i = 0; i < railSilos.length; i++) {
        railSilos[i].fill = 0;
        railSilos[i].pumpOn = false;
    }
}

// --- fuel -----------------------------------------------------------
function railFuelAvailable(b) {
    const loco = railBodyLoco(b);
    return !!loco && loco.fuel > 0.0005;
}

function railBurnFuel(b, sec) {
    const loco = railBodyLoco(b);
    if (!loco) return;
    loco.fuel = Math.max(0, loco.fuel - RAIL_FUEL_BURN * sec);
    if (loco.fuel <= 0 && b.notch > 0) {
        b.notch = 0;
        if (typeof railToast === "function") railToast("OUT OF BLOOD — THE LOCOMOTIVE IS DEAD", 2400);
    }
}

// --- the throttle ---------------------------------------------------
// Notches: -2 full brake, -1 light brake, 0 coast, 1..4 power. Q down, E up.
// The brake notches are part of the SAME lever rather than a separate key,
// because the thing to learn is that power and brake are one decision -- you
// cannot hold both, and you have to let go of one before the other does
// anything.
const RAIL_NOTCH_MIN = -2;
const RAIL_NOTCH_MAX = 4;

function railNotch(b, delta) {
    if (!b || !railBodyLoco(b)) return "";
    const was = b.notch;
    b.notch = rClamp(b.notch + delta, RAIL_NOTCH_MIN, RAIL_NOTCH_MAX);
    if (b.notch !== was) {
        // Taking power releases the pump. There is no separate "disconnect"
        // verb: driving away IS the disconnect.
        if (b.notch > 0 && b.pumpAt >= 0) railPumpRelease(b, true);
        if (typeof railSfx === "function") {
            const l = railBodyLoco(b);
            railSfx(b.notch > was ? "notchUp" : "notchDown", l.cx, l.cy);
        }
    }
    return railNotchLabel(b.notch);
}

function railNotchLabel(n) {
    if (n === -2) return "FULL BRAKE";
    if (n === -1) return "BRAKE";
    if (n === 0) return "COAST";
    return "POWER " + n;
}

// REVERSING IS ONLY ALLOWED NEAR A STAND. Not a restriction for its own sake:
// it is the one rule that forces the player to plan a stop, which is what
// makes momentum a mechanic instead of a nuisance.
function railReverse(b) {
    if (!b || !railBodyLoco(b)) return "";
    if (Math.abs(b.v) > RAIL_REVERSE_MAX_V) return "TOO FAST TO REVERSE — BRAKE FIRST";
    b.dir = -b.dir;
    b.notch = 0;
    if (typeof railSfx === "function") {
        const l = railBodyLoco(b);
        railSfx("reverse", l.cx, l.cy);
    }
    return "REVERSER — " + (b.dir > 0 ? "FORWARD" : "REVERSE");
}

// --- the pump -------------------------------------------------------
// Where is a body's locomotive on the network?
function railLocoAnchor(b) {
    const i = b.cars.indexOf(railBodyLoco(b) ? railBodyLoco(b).id : -1);
    return railWalkBack(b.route, b.headS, railCarOffset(b, i < 0 ? 0 : i));
}

function railPumpRelease(b, quiet) {
    if (!b || b.pumpAt < 0) return;
    const s = railSilos[b.pumpAt];
    if (s) s.pumpOn = false;
    b.pumpAt = -1;
    if (!quiet && typeof railToast === "function") railToast("PUMP DISCONNECTED", 1200);
}

function railPumpUpdate(now, dt) {
    const sec = dt / 1000;
    for (let i = 0; i < railSilos.length; i++) railSilos[i].pumpOn = false;

    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        const loco = railBodyLoco(b);
        if (!loco) { b.pumpAt = -1; continue; }

        // Still latched? Only while slow and still in the window.
        if (b.pumpAt >= 0) {
            const s = railSilos[b.pumpAt];
            const a = railLocoAnchor(b);
            if (!s || Math.abs(b.v) > RAIL_PUMP_SPEED + 14 ||
                a.e !== s.pump.e || Math.abs(a.s - s.pump.s) > RAIL_PUMP_TOL + 40) {
                railPumpRelease(b, true);
            }
        }

        // Latching: slow enough, and inside a stop's window.
        if (b.pumpAt < 0 && Math.abs(b.v) <= RAIL_PUMP_SPEED) {
            const a = railLocoAnchor(b);
            for (let k = 0; k < railSilos.length; k++) {
                const s = railSilos[k];
                if (a.e !== s.pump.e || Math.abs(a.s - s.pump.s) > RAIL_PUMP_TOL) continue;
                b.pumpAt = k;
                // THE PUMP HOLDS THE LOCOMOTIVE. "stopping or slowing to x
                // speed which stops locomotive at certain location connects
                // locomotive to pump" -- so latching is also what stops it.
                b.v = 0;
                b.notch = 0;
                if (typeof railSfx === "function") railSfx("pumpOn", loco.cx, loco.cy);
                if (typeof railToast === "function") {
                    railToast("PUMP CONNECTED — " + s.name + "  (E TO PULL AWAY)", 2200);
                }
                break;
            }
        }

        if (b.pumpAt < 0) continue;
        const s = railSilos[b.pumpAt];
        s.pumpOn = true;
        b.v = 0;

        const want = 1 - loco.fuel;
        if (want <= 0.0005 || s.fill <= 0.0005) continue;
        const moved = Math.min(RAIL_PUMP_RATE * sec, want, s.fill);
        s.fill -= moved;
        loco.fuel += moved;

        // LOUD. The one real cost of fuelling, and a no-op while zombies are
        // off -- which is the default, so the sandbox stays quiet until you
        // ask for company.
        if (now - s.lastNoise > RAIL_PUMP_NOISE_MS) {
            s.lastNoise = now;
            if (typeof railSfx === "function") railSfx("pump", s.x + s.w / 2, s.y + s.h / 2);
            if (typeof railNoise === "function") {
                railNoise(s.x + s.w / 2, s.y + s.h / 2, RAIL_PUMP_NOISE_R);
            }
        }
    }
}

// --- blood ----------------------------------------------------------
// Blood from a kill runs to the nearest silo. In the real game the sluice and
// the funnels do this; here it is direct, because the sandbox's job is the
// rail and a second plumbing puzzle would only be in the way.
function railAddBlood(x, y, amount) {
    let best = -1, bd = Infinity;
    for (let i = 0; i < railSilos.length; i++) {
        const s = railSilos[i];
        const d = rDist(x, y, s.x + s.w / 2, s.y + s.h / 2);
        if (d < bd) { bd = d; best = i; }
    }
    if (best < 0) return;
    railSilos[best].fill = Math.min(railSilos[best].cap, railSilos[best].fill + amount);
    railBloodBank += amount;
}

function railSiloTotal() {
    let t = 0;
    for (let i = 0; i < railSilos.length; i++) t += railSilos[i].fill;
    return t;
}

// --- buying a door --------------------------------------------------
function railBuyDoor(d) {
    if (!d || d.open) return "";
    if (railScrap < d.cost) return "NEED " + d.cost;
    railScrap -= d.cost;
    d.open = true;
    if (typeof railSfx === "function") railSfx("door", d.x + d.w / 2, d.y + d.h / 2);
    if (typeof railToast === "function") {
        railToast(d.rail ? "CROSSING OPEN — THE LINE IS CLEAR" : "DOOR OPEN", 1800);
    }
    return "OPEN";
}
