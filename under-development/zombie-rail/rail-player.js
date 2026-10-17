// ===================================================
//   RAIL SANDBOX — the player, input, guns, verbs
// ===================================================
// One local player, solo. No MP: the sandbox is a bench and the user did not
// ask for it, so there is no host authority to respect and no wire format to
// keep. If this ever grows one, the discipline to copy is zombie-train.js
// note 2 -- broadcast the body's scalar and DERIVE every car from it, never
// interpolate, or two screens drag a rider to two different places.
//
// THE RIDER RULE. A player on a deck gets that deck's delta for the frame and
// is otherwise free to walk around on it. Cars are not solid, so a moving car
// can never crush anyone against geometry -- the same flat-deck conclusion
// zombie-train.js note 1 reached. What a fast locomotive costs you is its
// NOSE, not its deck (railLocoNoseKill).
"use strict";

const RAIL_P_SIZE = 16;
const RAIL_P_SPEED = 240;        // px/s
const RAIL_P_HP = 100;

let railPlayer = null;
let railKeys = { up: false, down: false, left: false, right: false, shoot: false };
let railAim = { x: 0, y: 0 };
let railBullets = [];
let railRockets = [];
let railBlasts = [];             // drawn-only explosion rings
let railPrompt = "";
let railGun = "rifle";

const RAIL_GUNS = {
    rifle:  { name: "RIFLE",  dmg: 34, rate: 130, speed: 1500, spread: 0.02, ammo: 240 },
    rocket: { name: "ROCKET", dmg: 90, rate: 900, speed: 760,  spread: 0.0,  ammo: 24, radius: 150 }
};
let railAmmo = { rifle: 240, rocket: 24 };
let railLastShot = 0;

// Half the smallest thing a shot may hit (a switch lever at 18px), so nothing
// can pass through anything in one substep. See railUpdateShots.
const RAIL_SHOT_SUBSTEP = 9;
const RAIL_LEVER_HIT = 18;

function railPlayerReset() {
    railPlayer = {
        x: railSpawnPoint.x, y: railSpawnPoint.y,
        size: RAIL_P_SIZE,
        hp: RAIL_P_HP, dead: false,
        onCar: null, aimAng: 0,
        // `window.MP.` and not a bare `MP`: this page does not load mp-core,
        // so the name does not exist here at all. The short-circuit made it
        // safe at runtime, but check-undefined-globals.js was right to flag
        // it -- an unresolved global is one refactor away from being read.
        name: (window.MP && window.MP.selfName) || "ENGINEER",
        color: "#55FFFF"
    };
    // The ONE sanctioned name->colour fallback. Never write a second hashing
    // scheme (root CLAUDE.md); shared/identity.js is the only copy, and
    // check-identity-parity.js is what proves it still matches the server.
    if (window.IDENTITY && typeof IDENTITY.colorFromName === "function") {
        railPlayer.color = IDENTITY.colorFromName(railPlayer.name);
    }
    railBullets = [];
    railRockets = [];
    railBlasts = [];
    railAmmo = { rifle: 240, rocket: 24 };
    railGun = "rifle";
    railCam.x = railPlayer.x;
    railCam.y = railPlayer.y;
}

// --- input ----------------------------------------------------------
// Keys chosen so the pilot controls never fight walking, and never touch the
// dev panel's L+G (DEV_TOOLS_PLAN.md: 4D Pong's seat keys are why that combo
// has to be respected rather than assumed free).
//
//   WASD / arrows  walk          F  interact
//   Q / E          notch down/up R  reverser
//   1 / 2          rifle/rocket  mouse  aim and fire
function railBindInput() {
    const opts = { signal: railSignal() };

    window.addEventListener("keydown", function (e) {
        if (e.repeat) return;
        if (railKeyDown(e.code)) e.preventDefault();
    }, opts);

    window.addEventListener("keyup", function (e) {
        railKeyUp(e.code);
    }, opts);

    railCanvas.addEventListener("mousemove", function (e) {
        const r = railCanvas.getBoundingClientRect();
        const w = railScreenToWorld(e.clientX - r.left, e.clientY - r.top);
        railAim.x = w.x; railAim.y = w.y;
    }, opts);

    railCanvas.addEventListener("mousedown", function (e) {
        if (e.button === 0) railKeys.shoot = true;
    }, opts);

    window.addEventListener("mouseup", function () { railKeys.shoot = false; }, opts);
    window.addEventListener("blur", function () {
        railKeys = { up: false, down: false, left: false, right: false, shoot: false };
    }, opts);
    window.addEventListener("resize", function () {
        railResizeCanvas();
    }, opts);
    railCanvas.addEventListener("contextmenu", function (e) { e.preventDefault(); }, opts);
}

function railKeyDown(code) {
    switch (code) {
        case "KeyW": case "ArrowUp": railKeys.up = true; return true;
        case "KeyS": case "ArrowDown": railKeys.down = true; return true;
        case "KeyA": case "ArrowLeft": railKeys.left = true; return true;
        case "KeyD": case "ArrowRight": railKeys.right = true; return true;
        case "KeyF": railInteract(); return true;
        case "KeyE": railPilotNotch(1); return true;
        case "KeyQ": railPilotNotch(-1); return true;
        case "KeyR": railPilotReverse(); return true;
        case "Digit1": railGun = "rifle"; return true;
        case "Digit2": railGun = "rocket"; return true;
        case "Space": railKeys.shoot = true; return true;
    }
    return false;
}

function railKeyUp(code) {
    switch (code) {
        case "KeyW": case "ArrowUp": railKeys.up = false; break;
        case "KeyS": case "ArrowDown": railKeys.down = false; break;
        case "KeyA": case "ArrowLeft": railKeys.left = false; break;
        case "KeyD": case "ArrowRight": railKeys.right = false; break;
        case "Space": railKeys.shoot = false; break;
    }
}

// --- the pilot seat -------------------------------------------------
// The controls only answer while you are standing at the cab, which is what
// makes "standing at pilot seat prompts controls" true rather than decorative
// -- the keys are dead everywhere else, so the prompt is the whole interface.
function railPilotNotch(delta) {
    const seat = railPilotCarFor(railPlayer);
    if (!seat) return;
    const label = railNotch(seat.body, delta);
    if (label && typeof railToast === "function") railToast(label, 900);
}

function railPilotReverse() {
    const seat = railPilotCarFor(railPlayer);
    if (!seat) return;
    const msg = railReverse(seat.body);
    if (msg && typeof railToast === "function") railToast(msg, 1400);
}

// --- the F verb -----------------------------------------------------
// ONE key, resolved by what is nearest, in a fixed priority. A single
// interact key with a printed prompt beats four keys nobody remembers.
function railInteract() {
    if (!railPlayer || railPlayer.dead) return;
    const p = railPlayer;
    const px = p.x + p.size / 2, py = p.y + p.size / 2;

    // 1. A switch lever.
    const sw = railSwitchNear(px, py, 52);
    if (sw) { railThrowSwitch(sw, "lever"); return; }

    // 2. A shut door you are standing at.
    const d = railDoorAt(p.x, p.y, p.size, p.size);
    if (d) { railBuyDoor(d); return; }

    // 3. A coupled joint: split the train here.
    const j = railJointFor(p);
    if (j) { railUncouple(j.body, j.at); return; }

    // 4. Otherwise, lean on a loose car. Held rather than tapped, so this
    //    only reports; the push itself is proximity, in railCarsUpdate.
    const pushed = railPushFromPlayer(p, 0);
    if (!pushed && typeof railToast === "function") railToast("NOTHING TO DO HERE", 800);
}

function railSwitchNear(x, y, reach) {
    let best = null, bd = Infinity;
    for (let i = 0; i < railSwitches.length; i++) {
        const sw = railSwitches[i];
        const d = rDist(x, y, sw.lx, sw.ly);
        if (d < (reach || 52) && d < bd) { bd = d; best = sw; }
    }
    return best;
}

// --- guns -----------------------------------------------------------
function railShoot(now) {
    const g = RAIL_GUNS[railGun];
    if (!g || now - railLastShot < g.rate) return;
    if (railAmmo[railGun] <= 0) return;
    railLastShot = now;
    railAmmo[railGun]--;

    const p = railPlayer;
    const ox = p.x + p.size / 2, oy = p.y + p.size / 2;
    const ang = Math.atan2(railAim.y - oy, railAim.x - ox) + (Math.random() - 0.5) * g.spread;
    const vx = Math.cos(ang) * g.speed, vy = Math.sin(ang) * g.speed;

    if (railGun === "rocket") {
        railRockets.push({ x: ox, y: oy, vx: vx, vy: vy, life: 2600 });
        railShake(5);
        if (typeof railSfx === "function") railSfx("rocket", ox, oy);
    } else {
        railBullets.push({ x: ox, y: oy, vx: vx, vy: vy, life: 1100, dmg: g.dmg });
        railShake(1.6);
        if (typeof railSfx === "function") railSfx("rifle", ox, oy);
    }
}

function railUpdateShots(now, dt) {
    const sec = dt / 1000;

    for (let i = railBullets.length - 1; i >= 0; i--) {
        const b = railBullets[i];
        b.life -= dt;
        const travel = Math.hypot(b.vx, b.vy) * sec;
        // SUBSTEPPED, never one jump per frame. A rifle round covers 25px in
        // a 60Hz step and a switch lever's hit radius is 20, so testing only
        // the step's END POINT let every shot tunnel straight through the
        // lever -- measured, shooting a switch from 60px away threw it 0
        // times. Walls and zombies had the same hole. RAIL_SHOT_SUBSTEP is
        // half the smallest thing a bullet may hit.
        const n = Math.max(1, Math.ceil(travel / RAIL_SHOT_SUBSTEP));
        let consumed = false;
        for (let k = 0; k < n && !consumed; k++) {
            const nx = b.x + b.vx * sec / n, ny = b.y + b.vy * sec / n;
            // A SHOT SWITCH THROWS. The user asked for forks changeable
            // "either by shooting fork rail switcher, or by pressing f on
            // it", and both go through the same railThrowSwitch -- so the
            // occupied-points refusal and the sound can never apply to one
            // and not the other.
            for (let q = 0; q < railSwitches.length; q++) {
                const sw = railSwitches[q];
                if (rDist(nx, ny, sw.lx, sw.ly) > RAIL_LEVER_HIT) continue;
                railThrowSwitch(sw, "shot");
                consumed = true;
                break;
            }
            if (!consumed && typeof railZombHit === "function" && railZombHit(nx, ny, b.dmg)) consumed = true;
            if (!consumed && railBulletBlocked(nx, ny)) consumed = true;
            b.x = nx; b.y = ny;
        }
        if (consumed || b.life <= 0 ||
            b.x < 0 || b.y < 0 || b.x > RAIL_WORLD_W || b.y > RAIL_WORLD_H) {
            railBullets.splice(i, 1);
        }
    }

    for (let i = railRockets.length - 1; i >= 0; i--) {
        const r = railRockets[i];
        r.life -= dt;
        // Substepped for the same reason as the rifle, though a rocket is
        // slower: at 760px/s it covers 13px a frame, which is already most of
        // a wall's thickness.
        const rn = Math.max(1, Math.ceil(Math.hypot(r.vx, r.vy) * sec / RAIL_SHOT_SUBSTEP));
        let boom = false;
        for (let k = 0; k < rn && !boom; k++) {
            const nx = r.x + r.vx * sec / rn, ny = r.y + r.vy * sec / rn;
            // A rocket detonates on a CAR as well as on geometry, which is
            // the whole point -- the blast is what shunts it.
            if (railCarUnder(nx - 2, ny - 2, 4)) boom = true;
            if (!boom && railBulletBlocked(nx, ny)) boom = true;
            if (!boom && typeof railZombAt === "function" && railZombAt(nx, ny)) boom = true;
            r.x = nx; r.y = ny;
        }
        if (boom || r.life <= 0 ||
            r.x < 0 || r.y < 0 || r.x > RAIL_WORLD_W || r.y > RAIL_WORLD_H) {
            railRocketBlast(r);
            railRockets.splice(i, 1);
        }
    }

    for (let i = railBlasts.length - 1; i >= 0; i--) {
        railBlasts[i].t -= dt;
        if (railBlasts[i].t <= 0) railBlasts.splice(i, 1);
    }
}

function railRocketBlast(r) {
    const g = RAIL_GUNS.rocket;
    railBlasts.push({ x: r.x, y: r.y, t: 320, max: 320, r: g.radius });
    railShake(9);
    if (typeof railSfx === "function") railSfx("boom", r.x, r.y);
    // THE SHUNT. Velocity is passed through so the blast is projected onto
    // the track: a rocket fired across the rails moves nothing.
    railRocketKick(r.x, r.y, r.vx, r.vy, g.radius);
    if (typeof railZombBlast === "function") railZombBlast(r.x, r.y, g.radius, g.dmg);
    // A shut rail door is not blown open -- it is BOUGHT open. Keeping the
    // two separate is what makes the currency decision real.
}

// --- movement -------------------------------------------------------
function railMovePlayer(dt) {
    const p = railPlayer;
    if (!p || p.dead) return;
    const sec = dt / 1000;

    let dx = 0, dy = 0;
    if (railKeys.left) dx -= 1;
    if (railKeys.right) dx += 1;
    if (railKeys.up) dy -= 1;
    if (railKeys.down) dy += 1;
    if (dx && dy) { const n = Math.SQRT1_2; dx *= n; dy *= n; }

    const step = RAIL_P_SPEED * sec;
    // Axis-separated, so sliding along a wall works instead of stopping dead.
    if (dx) {
        const nx = p.x + dx * step;
        if (!railSolidAt(nx, p.y, p.size, p.size)) p.x = nx;
    }
    if (dy) {
        const ny = p.y + dy * step;
        if (!railSolidAt(p.x, ny, p.size, p.size)) p.y = ny;
    }

    // CARRIED BY THE DECK. Applied after the player's own movement, and
    // without a collision test: a rider on a car crossing a shut door would
    // otherwise be scraped off against it, which is the exact bug
    // zombie-train.js hit. Here the car cannot reach a shut door at all, so
    // the carry is always onto clear ground.
    const carry = railCarryDelta(p.x, p.y, p.size);
    p.onCar = carry ? carry.car : null;
    if (carry) { p.x += carry.dx; p.y += carry.dy; }

    p.x = rClamp(p.x, 0, RAIL_WORLD_W - p.size);
    p.y = rClamp(p.y, 0, RAIL_WORLD_H - p.size);

    const ox = p.x + p.size / 2, oy = p.y + p.size / 2;
    p.aimAng = Math.atan2(railAim.y - oy, railAim.x - ox);

    // THE COWCATCHER. Instant, and only from the nose above RAIL_KILL_SPEED.
    const killer = railLocoNoseKill(p);
    if (killer) railKillPlayer("RUN DOWN BY THE LOCOMOTIVE");
}

function railKillPlayer(why) {
    const p = railPlayer;
    if (!p || p.dead) return;
    p.dead = true;
    p.hp = 0;
    railShake(16);
    if (typeof railSfx === "function") railSfx("death", p.x, p.y);
    // NOT "press R" -- R is the reverser, and the respawn below is automatic.
    if (typeof railToast === "function") railToast(why, 1500);
    // A sandbox must not end. Respawn on its own after a beat, at the
    // platform, with everything else left exactly where it was.
    railTrackTimeout(function () {
        if (!railPlayer) return;
        railPlayer.dead = false;
        railPlayer.hp = RAIL_P_HP;
        railPlayer.x = railSpawnPoint.x;
        railPlayer.y = railSpawnPoint.y;
    }, 1600);
}

function railHurtPlayer(n, why) {
    const p = railPlayer;
    if (!p || p.dead) return;
    p.hp -= n;
    if (p.hp <= 0) railKillPlayer(why || "KILLED");
}

// --- the world prompt -----------------------------------------------
// What to print at the bottom of the screen. ONE string, decided in the same
// priority order railInteract uses, so the prompt can never offer a verb that
// F would not actually run.
function railUpdatePrompt() {
    railPrompt = "";
    const p = railPlayer;
    if (!p || p.dead) return;
    const px = p.x + p.size / 2, py = p.y + p.size / 2;

    const sw = railSwitchNear(px, py, 52);
    if (sw) {
        const to = railEdges[sw.branches[sw.thrown]];
        const other = railEdges[sw.branches[sw.thrown ? 0 : 1]];
        railPrompt = "F — POINTS SET FOR " + (to ? (to.label || to.name) : "?") +
                     "   (SWITCH TO " + (other ? (other.label || other.name) : "?") + ")";
        return;
    }

    const d = railDoorAt(p.x, p.y, p.size, p.size);
    if (d) {
        railPrompt = (d.rail ? "F — BUY RAIL CROSSING — " : "F — BUY DOOR — ") + d.cost +
                     (railScrap < d.cost ? "   (NOT ENOUGH)" : "");
        return;
    }

    const seat = railPilotCarFor(p);
    if (seat) {
        const b = seat.body;
        railPrompt = "PILOT SEAT — E POWER UP / Q BRAKE / R REVERSER   [" +
                     railNotchLabel(b.notch) + "  " + (b.dir > 0 ? "FWD" : "REV") +
                     "  " + Math.round(Math.abs(b.v)) + " px/s]";
        return;
    }

    const j = railJointFor(p);
    if (j) { railPrompt = "F — UNCOUPLE HERE"; return; }

    // A loose car, from one of its ends.
    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        if (railHasLoco(b)) continue;
        for (let k = 0; k < b.cars.length; k++) {
            const c = railCars[b.cars[k]];
            const L = rLocalInOriented(px, py, c.cx, c.cy, c.ang);
            if (Math.abs(L.ly) > c.wid / 2 + RAIL_PUSH_REACH) continue;
            const half = c.len / 2;
            if (L.lx < -half - RAIL_PUSH_REACH || L.lx > half + RAIL_PUSH_REACH) continue;
            if (Math.abs(L.lx) < half - 6) {
                railPrompt = RAIL_KINDS[c.kind].label + " — PUSH FROM EITHER END";
            } else {
                railPrompt = "HOLD F — PUSH THE " + RAIL_KINDS[c.kind].label;
            }
            return;
        }
    }
}

// Held-F pushing is proximity, not a keypress -- the same shape
// zombie-train.js used, and for the same reason: mashing a key sixteen times
// is a worse mechanic than leaning on a car.
function railPlayerPush(dt) {
    if (!railPlayer || railPlayer.dead) return;
    if (!railHeldF) return;
    railPushFromPlayer(railPlayer, dt);
}

let railHeldF = false;

function railBindHeldF() {
    const opts = { signal: railSignal() };
    window.addEventListener("keydown", function (e) { if (e.code === "KeyF") railHeldF = true; }, opts);
    window.addEventListener("keyup", function (e) { if (e.code === "KeyF") railHeldF = false; }, opts);
}

function railPlayerUpdate(now, dt) {
    if (!railPlayer) return;
    railMovePlayer(dt);
    if (railKeys.shoot && !railPlayer.dead) railShoot(now);
    railUpdateShots(now, dt);
    railPlayerPush(dt);
    railUpdatePrompt();
}
