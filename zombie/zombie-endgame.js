// ===================================================
//   Zombie — the Blood Silo endgame + roles
// ===================================================
// The first WIN state this game has ever had. Until now a run could only
// ever end in failure, which meant every session finished the same way
// and nothing survived it.
//
// The chain:
//   sluice gate (two players, two stages) -> funnel room -> kill zombies
//   ON the funnel to fill a silo -> flip that silo's switch to open the
//   next funnel -> three silos -> THE FLOOD -> clear it -> the southern
//   escape grinds open -> reach it and you have won.
"use strict";

// ---------------------------------------------------
//   ROLES (idea 56, randomly assigned)
// ---------------------------------------------------
// Derived from the client's own id hash rather than dealt out by the
// host: no wire traffic, survives a reconnect, and it matches how colour
// and identity already work everywhere else in this project. Two players
// can roll the same role -- that's fine.
//
// Deliberately small. Four players should feel different before anyone
// has bought anything; a role must never decide a run.
const ROLES = {
    medic:    { name: "MEDIC",    blurb: "REVIVES 40% FASTER, IGNORES ESCALATION" },
    engineer: { name: "ENGINEER", blurb: "TRAPS 40% OFF, REBOARDS 150% STRONGER" },
    scout:    { name: "SCOUT",    blurb: "DOUBLE PING, PICKUPS ON MAP, +10% SPEED" },
    gunner:   { name: "GUNNER",   blurb: "+15% DAMAGE, +25% CRATE AMMO" }
};
const ROLE_KEYS = ["medic", "engineer", "scout", "gunner"];

// NOT hashToUnit(): that keeps only the low bits of a djb2 hash
// (`% 10000`), and djb2 low bits cluster hard for similar strings. Across
// 400 ids it dealt engineer 270 times, scout 40 and medic ZERO. The
// avalanche finalizer below mixes the whole word before the modulo, so
// adjacent ids land in unrelated buckets.
function roleForId(netId) {
    if (!netId) return "medic";
    let h = 5381;
    for (let i = 0; i < netId.length; i++) h = ((h << 5) + h + netId.charCodeAt(i)) | 0;
    h ^= h >>> 16;
    h = Math.imul(h, 0x7feb352d);
    h ^= h >>> 15;
    h = Math.imul(h, 0x846ca68b);
    h ^= h >>> 16;
    return ROLE_KEYS[(h >>> 0) % ROLE_KEYS.length];
}

function myRole() {
    return roleForId(netPrefix);
}

function idHasRole(id, key) {
    return roleForId((id || "").split(":")[0]) === key;
}

// ---------------------------------------------------
//   GEOMETRY  (placed by zombie-level.js)
// ---------------------------------------------------
let sluiceRoom = null;    // {x,y,w,h}
let sluiceGate = null;    // {x,y,w,h} -- the door itself
let gatePlates = [];      // two {x,y,w,h}, deliberately far apart
let funnels = [];         // three {x,y,r,zone}
let silos = [];           // three {x,y,w,h,zone}
let escapeRect = null;    // the southern way out

// ---------------------------------------------------
//   STATE (host-authoritative; mirrored by snapshot)
// ---------------------------------------------------
const GATE_STAGES = 2;
const GATE_HOLD_MS = 4000;        // per stage; the second one is longer
const SILO_CAPACITY = 12;         // kills on the funnel per silo
const FLOOD_SIZE = 90;            // zombies in the final wave, scaled by team
const ESCAPE_OPEN_MS = 90000;     // "takes a long time to open"

let gateStage = 0;
let gateProgress = 0;
let funnelActive = [false, false, false];
let siloFill = [0, 0, 0];
let siloFlipped = [false, false, false];
let floodActive = false;
let floodRemaining = 0;
let escapeAt = 0;                 // when the route finishes opening; 0 = not started
let won = false;

function resetEndgame() {
    gateStage = 0;
    gateProgress = 0;
    funnelActive = [false, false, false];
    siloFill = [0, 0, 0];
    siloFlipped = [false, false, false];
    floodActive = false;
    floodRemaining = 0;
    escapeAt = 0;
    won = false;
}

function endgameStarted() {
    return gateStage >= GATE_STAGES;
}

function escapeOpen() {
    return escapeAt > 0 && Date.now() >= escapeAt;
}

// A short line for the HUD describing what the team should be doing.
function endgameObjective() {
    if (won) return "";
    if (escapeAt > 0) {
        if (escapeOpen()) return "THE SOUTH GATE IS OPEN — GO";
        const left = Math.ceil((escapeAt - Date.now()) / 1000);
        return "SOUTH GATE OPENING — " + left + "s";
    }
    if (floodActive) return "SURVIVE THE FLOOD — " + zombies.length + " LEFT";
    if (gateStage < GATE_STAGES) return "";
    for (let i = 0; i < 3; i++) {
        if (funnelActive[i] && siloFill[i] < SILO_CAPACITY) {
            return "KILL ON FUNNEL " + (i + 1) + " — SILO " + (i + 1) + " " + siloFill[i] + "/" + SILO_CAPACITY;
        }
        if (siloFill[i] >= SILO_CAPACITY && !siloFlipped[i]) {
            return "SILO " + (i + 1) + " FULL — THROW ITS SWITCH";
        }
    }
    return "";
}

// ---------------------------------------------------
//   THE GATE (idea 57)
// ---------------------------------------------------
// Two plates, far enough apart that one player physically cannot cover
// both. This is the only mechanic in the game that is strictly
// impossible alone, which is exactly the point -- and it means a solo
// player cannot reach the ending.
function playersOnPlates() {
    const all = [];
    for (let i = 0; i < players.length; i++) if (!players[i].downed) all.push(players[i]);
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        if (!remotePlayers[id].downed) all.push(remotePlayers[id]);
    }

    let covered = 0;
    for (let g = 0; g < gatePlates.length; g++) {
        const pl = gatePlates[g];
        for (let i = 0; i < all.length; i++) {
            const a = all[i];
            const sz = a.size || 16;
            if (rectIntersect(a.x, a.y, sz, sz, pl.x, pl.y, pl.w, pl.h)) { covered++; break; }
        }
    }
    return covered;
}

function updateGate(dt) {
    if (gateStage >= GATE_STAGES || !gatePlates.length) return;

    if (playersOnPlates() >= gatePlates.length) {
        // Second stage is deliberately longer -- by then the horde knows
        // where you both are.
        const need = GATE_HOLD_MS * (1 + gateStage * 0.6);
        gateProgress += dt / need;
        if (gateProgress >= 1) {
            gateProgress = 0;
            gateStage++;
            if (gateStage >= GATE_STAGES) {
                funnelActive[0] = true;
                if (sluiceGate) {
                    sluiceGate.open = true;
                    rebuildSolidIndex();
                }
                hostEvent(SND_GENERATOR, sluiceGate ? sluiceGate.x : WORLD_W / 2,
                                          sluiceGate ? sluiceGate.y : WORLD_H / 2);
            } else {
                hostEvent(SND_CARD, gatePlates[0].x, gatePlates[0].y);
            }
        }
    } else if (gateProgress > 0) {
        // Step off and it drains. Slower than it fills, so a brief
        // stumble doesn't undo a whole hold.
        gateProgress = Math.max(0, gateProgress - dt / (GATE_HOLD_MS * 2.5));
    }
}

// ---------------------------------------------------
//   FUNNELS AND SILOS
// ---------------------------------------------------
// Only kills that happen ON an active funnel count. Everything else in
// the game rewards killing zombies wherever they are; this is the one
// system that asks you to fight in a specific place, which is what makes
// the funnel room a set piece rather than another room.
function funnelIndexAt(x, y) {
    for (let i = 0; i < funnels.length; i++) {
        if (!funnelActive[i]) continue;
        const f = funnels[i];
        if (Math.hypot(x - f.x, y - f.y) <= f.r) return i;
    }
    return -1;
}

function creditFunnelKill(x, y) {
    const i = funnelIndexAt(x, y);
    if (i < 0 || siloFill[i] >= SILO_CAPACITY) return;
    siloFill[i]++;
    if (siloFill[i] >= SILO_CAPACITY) {
        // Silo full: its switch unlocks. The funnel itself goes quiet so
        // there is no ambiguity about where to fight next.
        funnelActive[i] = false;
        hostEvent(SND_ROUND_CLEAR, silos[i] ? silos[i].x : x, silos[i] ? silos[i].y : y);
    } else {
        hostEvent(SND_CRATE, x, y);
    }
}

function siloReady(i) {
    return siloFill[i] >= SILO_CAPACITY && !siloFlipped[i];
}

// Throwing a full silo's switch opens the NEXT funnel -- or, on the
// third, starts the flood.
function flipSilo(i) {
    if (!siloReady(i)) return false;
    siloFlipped[i] = true;
    if (i + 1 < funnels.length) {
        funnelActive[i + 1] = true;
        hostEvent(SND_GENERATOR, funnels[i + 1].x, funnels[i + 1].y);
    } else {
        startFlood();
    }
    return true;
}

// ---------------------------------------------------
//   THE FLOOD
// ---------------------------------------------------
// The one moment where zombies appearing from everywhere at once is the
// intent rather than a bug, so it ignores the zone-cooldown spawn rules
// entirely and comes in off every edge of the map.
function startFlood() {
    floodActive = true;
    floodRemaining = Math.ceil(FLOOD_SIZE * (0.6 + 0.4 * teamSize()));
    hostEvent(SND_SCREAM, WORLD_W / 2, WORLD_H / 2);
    addShake(16);
}

function floodSpawnPoint(size) {
    const side = Math.floor(Math.random() * 4);
    const pad = 120;
    if (side === 0) return { x: -pad, y: Math.random() * (WORLD_H - size) };
    if (side === 1) return { x: WORLD_W + pad - size, y: Math.random() * (WORLD_H - size) };
    if (side === 2) return { x: Math.random() * (WORLD_W - size), y: -pad };
    return { x: Math.random() * (WORLD_W - size), y: WORLD_H + pad - size };
}

function updateFlood(now) {
    if (!floodActive) return;

    if (floodRemaining > 0 && now - lastSpawnTime > 90) {
        const type = Math.random() < 0.22 ? "brute" : (Math.random() < 0.5 ? "runner" : "walker");
        const spec = ZOMBIE_TYPES[type];
        const at = floodSpawnPoint(spec.size);
        const z = spawnZombieAt(type, round, at.x, at.y);
        if (z) {
            floodRemaining--;
            lastSpawnTime = now;
        }
    }

    if (floodRemaining === 0 && zombies.length === 0) {
        floodActive = false;
        escapeAt = now + ESCAPE_OPEN_MS;
        hostEvent(SND_ROUND_CLEAR, WORLD_W / 2, WORLD_H / 2);
    }
}

// ---------------------------------------------------
//   ESCAPE
// ---------------------------------------------------
function updateEscape() {
    if (won || !escapeRect || !escapeOpen()) return;
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        if (p.downed) continue;
        if (rectIntersect(p.x, p.y, p.size, p.size, escapeRect.x, escapeRect.y, escapeRect.w, escapeRect.h)) {
            triggerWin();
            return;
        }
    }
}

function updateEndgame(now, dt) {
    if (won) return;
    updateGate(dt);
    updateFlood(now);
    updateEscape();
}
