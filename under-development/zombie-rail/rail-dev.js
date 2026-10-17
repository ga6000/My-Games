// ===================================================
//   RAIL SANDBOX — the L+G dev panel
// ===================================================
// Registered LAST, as DEV_TOOLS_PLAN.md requires, and through
// shared/devtools.js rather than a panel of its own -- that module keeps its
// OWN AbortController and timer set, so this page's teardown cannot leave the
// panel half-alive and the panel's teardown does not depend on this page
// having been written to the GameInstance contract.
//
// "add developer gui to override filling silos, adjusting train fuel" -- the
// two sliders at the top are those. Everything under them exists because a
// rail sandbox is unusable without a way to put a car back where you wanted
// it: a bad shunt can strand a wagon on the wrong side of a boulder, and
// walking it home by hand is not a test of anything.
"use strict";

// Which body the panel acts on: the one the player is driving or standing on,
// else the first with a locomotive. The same rule the sidebar uses, so the
// panel and the readout can never be talking about different trains.
function railDevBody() {
    const seat = (typeof railPilotCarFor === "function") ? railPilotCarFor(railPlayer) : null;
    if (seat) return seat.body;
    if (railPlayer && railPlayer.onCar) return railBodies[railPlayer.onCar.body];
    for (let i = 0; i < railBodies.length; i++) if (railHasLoco(railBodies[i])) return railBodies[i];
    return railBodies[0] || null;
}

function railDevLoco() {
    const b = railDevBody();
    return b ? railBodyLoco(b) : null;
}

function railDevReport() {
    const b = railDevBody();
    const loco = railDevLoco();
    const sil = [];
    for (let i = 0; i < railSilos.length; i++) {
        sil.push(railSilos[i].name + " " + Math.round(railSilos[i].fill * 100) + "%" +
                 (railSilos[i].pumpOn ? " PUMPING" : ""));
    }
    const pts = [];
    for (let i = 0; i < railSwitches.length; i++) {
        const sw = railSwitches[i];
        const to = railEdges[sw.branches[sw.thrown]];
        pts.push((i + 1) + ":" + (to ? (to.label || to.name) : "?"));
    }
    const bodies = [];
    for (let i = 0; i < railBodies.length; i++) {
        const bb = railBodies[i];
        const kinds = [];
        for (let k = 0; k < bb.cars.length; k++) kinds.push(railCars[bb.cars[k]].kind);
        bodies.push("[" + kinds.join("+") + "] v=" + Math.round(bb.v) +
                    " route=" + bb.route.length + "e");
    }
    return [
        "RAIL SANDBOX",
        "zombies: " + (railZombiesOn ? "ON (" + railZombies.length + ")" : "OFF"),
        "scrap: " + railScrap,
        "fuel: " + (loco ? Math.round((loco.fuel || 0) * 100) + "%" : "no locomotive"),
        "train: " + (b ? railNotchLabel(b.notch) + " " + (b.dir > 0 ? "FWD" : "REV") +
                         " " + Math.round(Math.abs(b.v)) + "px/s" : "—"),
        "silos: " + sil.join("  "),
        "points: " + pts.join("  "),
        "bodies (" + railBodies.length + "): " + bodies.join("  ")
    ].join("\n");
}

const railDevActions = [
    {
        slider: true,
        label: "TRAIN FUEL",
        hint: "live — the tank of whichever locomotive you are driving or standing on",
        min: 0, max: 1, step: 0.01, def: 0.25,
        value: function () { const l = railDevLoco(); return l ? (l.fuel || 0) : 0; },
        format: function (v) { return Math.round(v * 100) + "%"; },
        ticks: [
            { v: 0, label: "0%" + String.fromCharCode(10) + "DRY" },
            { v: 0.25, label: "25%" + String.fromCharCode(10) + "DEFAULT" },
            { v: 1, label: "100%" + String.fromCharCode(10) + "FULL" }
        ],
        onInput: function (v) {
            const l = railDevLoco();
            if (!l) return "no locomotive";
            l.fuel = rClamp(v, 0, 1);
            return undefined;
        }
    },
    {
        slider: true,
        label: "ALL SILOS",
        hint: "live — overrides every blood silo at once; the pumps still have to be driven to",
        min: 0, max: 1, step: 0.01, def: 0,
        value: function () {
            if (!railSilos.length) return 0;
            let t = 0;
            for (let i = 0; i < railSilos.length; i++) t += railSilos[i].fill / railSilos[i].cap;
            return t / railSilos.length;
        },
        format: function (v) { return Math.round(v * 100) + "%"; },
        ticks: [
            { v: 0, label: "0%" + String.fromCharCode(10) + "EMPTY" },
            { v: 0.5, label: "50%" },
            { v: 1, label: "100%" + String.fromCharCode(10) + "FULL" }
        ],
        onInput: function (v) {
            for (let i = 0; i < railSilos.length; i++) railSilos[i].fill = railSilos[i].cap * rClamp(v, 0, 1);
            return undefined;
        }
    },
    {
        label: "NO ZOMBIES",
        sub: "toggle — OFF is the default, and the pump's alert is a no-op while it is",
        fn: function () { return railZombSetEnabled(!railZombiesOn); }
    },
    {
        label: "OPEN EVERY DOOR",
        sub: "clears all three rail crossings without spending scrap",
        fn: function () {
            let n = 0;
            for (let i = 0; i < railDoors.length; i++) if (!railDoors[i].open) { railDoors[i].open = true; n++; }
            return n + " opened";
        }
    },
    {
        label: "SHUT EVERY DOOR",
        sub: "to re-test the car-against-a-shut-crossing bounce",
        fn: function () {
            let n = 0;
            for (let i = 0; i < railDoors.length; i++) if (railDoors[i].open) { railDoors[i].open = false; n++; }
            return n + " shut";
        }
    },
    {
        label: "+2000 SCRAP",
        sub: "for buying crossings",
        fn: function () { railScrap += 2000; return String(railScrap); }
    },
    {
        label: "THROW ALL POINTS",
        sub: "flips every switch that is not standing under a car",
        fn: function () {
            let n = 0, refused = 0;
            for (let i = 0; i < railSwitches.length; i++) {
                if (railSwitchOccupied(railSwitches[i])) { refused++; continue; }
                railSwitches[i].thrown = railSwitches[i].thrown ? 0 : 1;
                n++;
            }
            return n + " thrown" + (refused ? ", " + refused + " occupied" : "");
        }
    },
    {
        label: "SPAWN FLAT BED",
        sub: "on the track nearest you, clear of other cars",
        fn: function () { return railDevSpawn("flatbed"); }
    },
    {
        label: "SPAWN BOX CAR",
        sub: "two side openings; crates are per-car and deterministic",
        fn: function () { return railDevSpawn("boxcar"); }
    },
    {
        label: "SPAWN PASSENGER CAR",
        sub: "on the track nearest you",
        fn: function () { return railDevSpawn("passenger"); }
    },
    {
        label: "SPAWN LOCOMOTIVE",
        sub: "a second one — useful for testing nose-pushing against a consist",
        fn: function () { return railDevSpawn("loco"); }
    },
    {
        label: "RESET THE STOCK",
        sub: "every car back to its starting place; the map and your scrap are untouched",
        fn: function () {
            const E = {};
            for (let i = 0; i < railEdges.length; i++) E[railEdges[i].name] = i;
            railPlaceStock(E);
            return "6 bodies";
        }
    },
    {
        label: "TELEPORT — WEST TOWN",
        sub: "the platform at " + RM_TOWN_W.name,
        fn: function () { return railDevGoto(RM_LOOP_W_X + 150, 1960, RM_TOWN_W.name); }
    },
    {
        label: "TELEPORT — EAST TOWN",
        sub: "the platform at " + RM_TOWN_E.name,
        fn: function () { return railDevGoto(RM_LOOP_E_X - 150, 1960, RM_TOWN_E.name); }
    },
    {
        label: "TELEPORT — SOUTH CUT",
        sub: "the forest silo on the south loop",
        fn: function () { return railDevGoto(3040, RM_LOOP_S_Y - 130, "SOUTH CUT"); }
    },
    {
        label: "TELEPORT — NORTH CUT",
        sub: "the forest silo on the north loop",
        fn: function () { return railDevGoto(3700, RM_LOOP_N_Y + 130, "NORTH CUT"); }
    },
    {
        label: "TELEPORT TO THE LOCOMOTIVE",
        sub: "onto its cab, wherever it has got to",
        fn: function () {
            const l = railDevLoco() || (function () {
                for (let i = 0; i < railCars.length; i++) if (railCars[i].kind === "loco") return railCars[i];
                return null;
            })();
            if (!l) return "no locomotive";
            return railDevGoto(l.cx - 8, l.cy - 8, "the cab");
        }
    }
];

function railDevGoto(x, y, what) {
    if (!railPlayer) return "no player";
    railPlayer.x = rClamp(x, 0, RAIL_WORLD_W - railPlayer.size);
    railPlayer.y = rClamp(y, 0, RAIL_WORLD_H - railPlayer.size);
    railPlayer.dead = false;
    railPlayer.hp = 100;
    // Move the camera with it, or the lerp spends a second panning across the
    // map and the teleport reads as a freeze.
    railCam.x = railPlayer.x;
    railCam.y = railPlayer.y;
    return "at " + what;
}

// Spawn on the nearest track to the player, nudged along until it is clear of
// every other car -- dropping a wagon inside one would couple them on the
// first frame at a random velocity, which is a confusing way to be handed a
// new car.
function railDevSpawn(kind) {
    if (!railPlayer) return "no player";
    const near = railNearestOnNet(railPlayer.x, railPlayer.y);
    if (near.e < 0) return "no track";
    const E = railEdges[near.e];
    const want = RAIL_KINDS[kind].len;
    for (let tries = 0; tries < 24; tries++) {
        const s = rClamp(near.s + (tries % 2 ? 1 : -1) * Math.ceil(tries / 2) * (want + 30),
                         want + 10, E.len - 10);
        const p = railPose(near.e, s - want / 2);
        if (railCarUnder(p.x - 8, p.y - 8, 16)) continue;
        railSpawnBody([kind], near.e, s, 1);
        return RAIL_KINDS[kind].label + " on " + (E.label || E.name);
    }
    return "no clear spot on " + (E.label || E.name);
}

if (window.DEVTOOLS) {
    DEVTOOLS.init({
        game: "rail-sandbox",
        onOpen: function () {
            // Not a pause -- just let go of what was held, or the player keeps
            // walking behind the overlay.
            railKeys = { up: false, down: false, left: false, right: false, shoot: false };
            railHeldF = false;
        },
        report: railDevReport,
        actions: railDevActions
    });
}
