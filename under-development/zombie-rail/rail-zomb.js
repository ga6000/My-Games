// ===================================================
//   RAIL SANDBOX — zombies, OFF BY DEFAULT
// ===================================================
// "Let's turn off zombies by default."
//
// So why is this file here at all? Because two of the mechanics the user
// asked for are DEFINED by zombies: the pump "alerts zombies in area and is
// loud", and blood is what fuels the train. A flag with nothing behind it
// would have made both of those untestable, and the pump's cost imaginary.
//
// What this is NOT is a port of the arcade's zombie. There is no flow field,
// no sector nav grid, no round system, no perks and no types. The map is open
// and the only obstacles are trunks and sheds, so a straight line at the
// player plus wall-sliding gets within a few percent of the flow field's
// behaviour for a tenth of the code -- and the flow field is the single most
// expensive thing in zombie-game.js (a full rebuild is ~17ms).
//
// railZombiesOn starts FALSE. Nothing below runs until the dev panel, or
// `?zombies=1`, turns it on.
"use strict";

let railZombiesOn = false;
let railZombies = [];

const RZ_SIZE = 18;
const RZ_SPEED = 92;             // px/s -- well under the player's 240
const RZ_HP = 60;
const RZ_DMG = 18;               // per bite
const RZ_BITE_MS = 700;
const RZ_CAP = 70;
const RZ_SPAWN_MS = 1400;
const RZ_SPAWN_RING_MIN = 760;   // just outside the 960x540 view
const RZ_SPAWN_RING_MAX = 1180;
// Blood per kill, as a fraction of one silo. 40 kills fills a silo, which is
// roughly a tank and a half of fuel.
const RZ_BLOOD = 0.025;

let railZombLastSpawn = 0;

function railZombReset() {
    railZombies = [];
    railZombLastSpawn = 0;
}

function railZombSetEnabled(on) {
    railZombiesOn = !!on;
    if (!railZombiesOn) railZombies = [];
    if (typeof railUpdateTitle === "function") railUpdateTitle();
    return railZombiesOn ? "ON" : "OFF — and cleared";
}

// --- spawning -------------------------------------------------------
// On a ring around the player, outside the view, on clear ground. The ring
// bounds are named constants because the arcade learned the hard way what
// happens when they are not: zombie-game.js once read SPAWN_RING_MIN and
// SPAWN_RING_MAX, two constants that existed NOWHERE in the repo, and the
// ReferenceError came out of the host's update loop and froze every client.
// check-undefined-globals.js exists because of that, and it covers this page.
function railZombSpawnOne(nearX, nearY, radMin, radMax) {
    if (railZombies.length >= RZ_CAP) return null;
    const cx = nearX === undefined ? (railPlayer ? railPlayer.x : RAIL_WORLD_W / 2) : nearX;
    const cy = nearY === undefined ? (railPlayer ? railPlayer.y : RAIL_WORLD_H / 2) : nearY;
    for (let tries = 0; tries < 24; tries++) {
        const a = Math.random() * Math.PI * 2;
        const r = (radMin || RZ_SPAWN_RING_MIN) +
                  Math.random() * ((radMax || RZ_SPAWN_RING_MAX) - (radMin || RZ_SPAWN_RING_MIN));
        const x = rClamp(cx + Math.cos(a) * r, 24, RAIL_WORLD_W - 24 - RZ_SIZE);
        const y = rClamp(cy + Math.sin(a) * r, 24, RAIL_WORLD_H - 24 - RZ_SIZE);
        if (railSolidAt(x, y, RZ_SIZE, RZ_SIZE)) continue;
        const z = {
            x: x, y: y, size: RZ_SIZE, hp: RZ_HP,
            lastBite: 0, onCar: false,
            lvx: 0, lvy: 0, launchUntil: 0,
            shade: Math.random()
        };
        railZombies.push(z);
        return z;
    }
    return null;
}

// THE PUMP'S COST. railNoise routes here, so running the pump genuinely
// brings a crowd to the one place the train cannot drive away from.
function railZombAlert(x, y, radius) {
    if (!railZombiesOn) return 0;
    // Pull in anything already within the radius...
    let pulled = 0;
    for (let i = 0; i < railZombies.length; i++) {
        const z = railZombies[i];
        if (rDist(z.x, z.y, x, y) > (radius || 700)) continue;
        z.lureX = x; z.lureY = y; z.lureUntil = Date.now() + 4000;
        pulled++;
    }
    // ...and bring a few more in from outside it.
    const extra = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < extra; i++) railZombSpawnOne(x, y, (radius || 700) * 0.8, (radius || 700) * 1.25);
    return pulled + extra;
}

// --- damage ---------------------------------------------------------
// Returns true when a bullet is consumed, which is what makes a zombie stop
// a shot instead of the shot carrying on through the whole crowd.
function railZombHit(x, y, dmg) {
    if (!railZombiesOn) return false;
    for (let i = railZombies.length - 1; i >= 0; i--) {
        const z = railZombies[i];
        if (!rRectIntersect(x - 1, y - 1, 2, 2, z.x, z.y, z.size, z.size)) continue;
        z.hp -= dmg || 30;
        if (z.hp <= 0) railZombKill(i);
        return true;
    }
    return false;
}

function railZombAt(x, y) {
    if (!railZombiesOn) return null;
    for (let i = 0; i < railZombies.length; i++) {
        const z = railZombies[i];
        if (rRectIntersect(x - 1, y - 1, 2, 2, z.x, z.y, z.size, z.size)) return z;
    }
    return null;
}

function railZombBlast(x, y, radius, dmg) {
    if (!railZombiesOn) return 0;
    let n = 0;
    for (let i = railZombies.length - 1; i >= 0; i--) {
        const z = railZombies[i];
        const d = rDist(x, y, z.x + z.size / 2, z.y + z.size / 2);
        if (d > (radius || 150)) continue;
        z.hp -= (dmg || 90) * (1 - d / (radius || 150) * 0.6);
        if (z.hp <= 0) { railZombKill(i); n++; }
    }
    return n;
}

// BLOOD FUELS THE BLOOD TRAIN, and this is where it enters the system: a kill
// runs its blood to the nearest silo.
function railZombKill(i) {
    const z = railZombies[i];
    if (!z) return;
    railAddBlood(z.x, z.y, RZ_BLOOD);
    if (typeof railSfx === "function") railSfx("couple", z.x, z.y);
    railZombies.splice(i, 1);
}

// --- the update -----------------------------------------------------
function railZombUpdate(now, dt) {
    if (!railZombiesOn) {
        if (railZombies.length) railZombies = [];
        return;
    }
    const sec = dt / 1000;
    const p = railPlayer;

    if (p && !p.dead && now - railZombLastSpawn > RZ_SPAWN_MS) {
        railZombLastSpawn = now;
        railZombSpawnOne();
    }

    for (let i = railZombies.length - 1; i >= 0; i--) {
        const z = railZombies[i];

        // Thrown by the cowcatcher: ballistic, and exempt from steering --
        // the same launch phase shape zombie-train.js reused for its shove.
        if (z.launchUntil && now < z.launchUntil) {
            z.x = rClamp(z.x + z.lvx, 0, RAIL_WORLD_W - z.size);
            z.y = rClamp(z.y + z.lvy, 0, RAIL_WORLD_H - z.size);
            z.lvx *= 0.92; z.lvy *= 0.92;
            continue;
        }
        z.launchUntil = 0;

        // Where is it going? A lure (the pump) outranks the player, which is
        // what makes the noise a real decision rather than a sound effect.
        let tx = p ? p.x : z.x, ty = p ? p.y : z.y;
        if (z.lureUntil && now < z.lureUntil) { tx = z.lureX; ty = z.lureY; }
        else { z.lureUntil = 0; }

        const a = Math.atan2(ty - z.y, tx - z.x);
        const step = RZ_SPEED * sec;
        const dx = Math.cos(a) * step, dy = Math.sin(a) * step;
        // Axis-separated, so it slides along a shed instead of sticking. With
        // no flow field this is the whole of its pathing, and on an open map
        // with only trunks and sheds in the way it is close enough.
        if (!railSolidAt(z.x + dx, z.y, z.size, z.size)) z.x += dx;
        else if (!railSolidAt(z.x + dx, z.y + dy * 1.6, z.size, z.size)) { z.x += dx; z.y += dy * 1.6; }
        if (!railSolidAt(z.x, z.y + dy, z.size, z.size)) z.y += dy;
        else if (!railSolidAt(z.x + dx * 1.6, z.y + dy, z.size, z.size)) { z.x += dx * 1.6; z.y += dy; }

        // Carried by a deck, exactly as the player is.
        const carry = railCarryDelta(z.x, z.y, z.size);
        z.onCar = !!carry;
        if (carry) { z.x += carry.dx; z.y += carry.dy; }

        z.x = rClamp(z.x, 0, RAIL_WORLD_W - z.size);
        z.y = rClamp(z.y, 0, RAIL_WORLD_H - z.size);

        if (p && !p.dead && now - z.lastBite > RZ_BITE_MS &&
            rRectIntersect(z.x, z.y, z.size, z.size, p.x, p.y, p.size, p.size)) {
            z.lastBite = now;
            railHurtPlayer(RZ_DMG, "EATEN");
        }
    }

    railZombShove(now);
}

// THE COWCATCHER, for zombies: the locomotive's head sweeps its own rect and
// THROWS what is inside it. Not a block -- a block would let a moving car
// wedge a zombie against geometry, which is exactly what zombie-train.js note
// 1 forbids.
const RZ_SHOVE_SPEED = 150;

function railZombShove(now) {
    for (let i = 0; i < railBodies.length; i++) {
        const b = railBodies[i];
        const loco = railBodyLoco(b);
        if (!loco || Math.abs(b.v) < RZ_SHOVE_SPEED) continue;
        const sign = b.v > 0 ? 1 : -1;
        const dirx = Math.cos(loco.ang) * sign, diry = Math.sin(loco.ang) * sign;
        for (let k = 0; k < railZombies.length; k++) {
            const z = railZombies[k];
            if (z.launchUntil) continue;
            if (!rPointInOriented(z.x + z.size / 2, z.y + z.size / 2,
                                  loco.cx, loco.cy, loco.len, loco.wid, loco.ang)) continue;
            const kick = 7 + Math.random() * 5;
            const spread = (Math.random() - 0.5) * 6;
            z.lvx = dirx * kick - diry * spread;
            z.lvy = diry * kick + dirx * spread;
            z.launchUntil = now + 260 + Math.random() * 220;
            z.onCar = false;
        }
    }
}

// --- draw -----------------------------------------------------------
function railDrawZombie(z) {
    railCtx.fillStyle = "rgba(0,0,0,0.42)";
    railCtx.fillRect(z.x + 3, z.y + 4, z.size, z.size);
    railCtx.fillStyle = z.launchUntil ? "#FF9955" : RC_ZOMBIE;
    railCtx.fillRect(z.x, z.y, z.size, z.size);
    railCtx.fillStyle = "#3A0A0A";
    railCtx.fillRect(z.x + 3, z.y + 4, 3, 3);
    railCtx.fillRect(z.x + z.size - 6, z.y + 4, 3, 3);
    // A health nick, so a wounded one is readable without a bar.
    if (z.hp < RZ_HP) {
        railCtx.fillStyle = "#FFE033";
        railCtx.fillRect(z.x, z.y - 4, Math.round(z.size * (z.hp / RZ_HP)), 2);
    }
}
