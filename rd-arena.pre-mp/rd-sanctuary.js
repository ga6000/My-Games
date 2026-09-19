// ===================================================
//   RD Arena -- human sanctuaries, antibacterial defence, organs
// ===================================================
// Split out of RDArena.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 3). Lines 306-594 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, so every load-time statement
// still runs in the sequence it did as one file. The only change is that the
// four-space indent the whole script carried inside <script> was removed;
// there are no multi-line template literals, so that is whitespace-only.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint).
"use strict";

// ============================================================
// Human sanctuaries + antibacterial defence
// Walls are static structure: enemies cannot enter and nothing can
// shoot them open.
//
// Each doorway carries a sprinkler-style turret that sweeps an outward
// arc and lobs anti-microbial motes. A mote erodes flesh where it lands,
// and while it sits on living growth it slows and seeds children -- so
// the die-off spreads across the fleshscape for a brief time and then
// burns out. Anti-flesh only: motes never touch enemies.
// ============================================================
const WALL_T = 18;
const SPRAY_SWEEP_ARC = 2.5;        // ~145 degrees, centred on the outward normal
const SPRAY_SWEEP_SPEED = 0.021;
const SPRAY_FIRE_EVERY = 5;
const MOTE_SPEED = 2.7;
const MOTE_LIFE = 130;
const MOTE_MAX = 520;
const MOTE_BITE = 11;               // erosion radius while travelling
const MOTE_BITE_ON_FLESH = 15;      // bigger bite once it has taken hold
const MOTE_SPREAD_CHANCE = 0.16;
const MOTE_MAX_GEN = 3;

const sanctuaries = [];
const sprayTurrets = [];
const sprayMotes = [];
const wallRects = [];

// Cut a side of length `len` into wall runs, skipping the door fractions.
function sideSegments(len, doors) {
    let cuts = (doors || []).map(d => [d[0] * len, d[1] * len]).sort((p, q) => p[0] - q[0]);
    let segs = [], cur = 0;
    for (const c of cuts) {
        if (c[0] > cur) segs.push([cur, c[0]]);
        cur = Math.max(cur, c[1]);
    }
    if (cur < len) segs.push([cur, len]);
    return segs;
}

function buildSanctuary(x, y, w, h, doors) {
    const s = { x: x, y: y, w: w, h: h, doors: [] };

    for (const [a, b] of sideSegments(w, doors.n)) wallRects.push({ x: x + a, y: y, w: b - a, h: WALL_T });
    for (const [a, b] of sideSegments(w, doors.s)) wallRects.push({ x: x + a, y: y + h - WALL_T, w: b - a, h: WALL_T });
    for (const [a, b] of sideSegments(h, doors.w)) wallRects.push({ x: x, y: y + a, w: WALL_T, h: b - a });
    for (const [a, b] of sideSegments(h, doors.e)) wallRects.push({ x: x + w - WALL_T, y: y + a, w: WALL_T, h: b - a });

    // One spray emitter just outside each doorway.
    // `out` is the normal pointing away from the building, so a turret only
    // ever sweeps into the fleshscape and never back into the safe room.
    (doors.n || []).forEach(d => s.doors.push({ x: x + (d[0] + d[1]) / 2 * w, y: y - 26, out: -Math.PI / 2 }));
    (doors.s || []).forEach(d => s.doors.push({ x: x + (d[0] + d[1]) / 2 * w, y: y + h + 26, out: Math.PI / 2 }));
    (doors.w || []).forEach(d => s.doors.push({ x: x - 26, y: y + (d[0] + d[1]) / 2 * h, out: Math.PI }));
    (doors.e || []).forEach(d => s.doors.push({ x: x + w + 26, y: y + (d[0] + d[1]) / 2 * h, out: 0 }));

    s.doors.forEach((d, idx) => {
        sprayTurrets.push({
            x: d.x, y: d.y, out: d.out,
            sweep: idx * 1.7,               // desynchronise the sweeps
            angle: d.out,
            fire: idx % SPRAY_FIRE_EVERY
        });
    });

    sanctuaries.push(s);
    return s;
}

// The central base: human structure around the spawn point, and the only
// place the non-organic gun upgrades live. Doors on all four sides so it
// reads as a hub you pass through rather than a corner you hide in.
const BASE = { x: 2130, y: 2130, w: 540, h: 540 };
buildSanctuary(BASE.x, BASE.y, BASE.w, BASE.h, {
    n: [[0.43, 0.57]], s: [[0.43, 0.57]], w: [[0.43, 0.57]], e: [[0.43, 0.57]]
});

buildSanctuary(700, 700, 620, 480, { s: [[0.42, 0.58]], e: [[0.40, 0.60]] });
buildSanctuary(3480, 700, 620, 480, { s: [[0.42, 0.58]], w: [[0.40, 0.60]] });
buildSanctuary(700, 3620, 620, 480, { n: [[0.42, 0.58]], e: [[0.40, 0.60]] });
buildSanctuary(3480, 3620, 620, 480, { n: [[0.42, 0.58]], w: [[0.40, 0.60]] });

function paintRectToMask(mask, rx, ry, rw, rh, value) {
    let gx0 = Math.max(0, Math.floor(rx / cellSize));
    let gy0 = Math.max(0, Math.floor(ry / cellSize));
    let gx1 = Math.min(gridCols - 1, Math.ceil((rx + rw) / cellSize));
    let gy1 = Math.min(gridRows - 1, Math.ceil((ry + rh) / cellSize));
    for (let gx = gx0; gx <= gx1; gx++) {
        for (let gy = gy0; gy <= gy1; gy++) mask[gx + gy * gridCols] = value;
    }
}

function paintDiscToMask(mask, cx, cy, radius, value) {
    let gx = Math.floor(cx / cellSize), gy = Math.floor(cy / cellSize);
    let r = Math.ceil(radius / cellSize), r2 = r * r;
    for (let x = gx - r; x <= gx + r; x++) {
        for (let y = gy - r; y <= gy + r; y++) {
            if (x < 0 || x >= gridCols || y < 0 || y >= gridRows) continue;
            let ox = x - gx, oy = y - gy;
            if (ox * ox + oy * oy > r2) continue;
            mask[x + y * gridCols] = value;
        }
    }
}

// Sanctuary footprints never grow flesh; the wall runs are permanent structure.
for (const s of sanctuaries) paintRectToMask(noGrow, s.x - 4, s.y - 4, s.w + 8, s.h + 8, 1);
for (const w of wallRects) paintRectToMask(staticMask, w.x, w.y, w.w, w.h, 1);
for (let i = 0; i < gridSize; i++) if (noGrow[i]) { gridA[i] = 1; gridB[i] = 0; }

// --- Non-organic gun upgrades -------------------------------------
// Metal, not meat: these sit in the base's four inside corners and stack
// to 3 each. Deliberately NOT part of the organ card system.
const GUN_MAX_STACK = 3;
const gun = { firerate: 0, spread: 0, size: 0, pierce: 0 };

const GUN_UPGRADES = [
    { id: 'firerate', name: 'FIRE-RATE',     blurb: 'reload -18f per stack' },
    { id: 'spread',   name: 'BULLET SPREAD', blurb: '+1 round per shot' },
    { id: 'size',     name: 'BULLET SIZE',   blurb: 'fatter round, bigger hole' },
    { id: 'pierce',   name: 'PIERCING',      blurb: 'punch through +1 body' }
];

const gunTerminals = [];
(function placeTerminals() {
    const inset = 52;
    const corners = [
        [BASE.x + inset,              BASE.y + inset],
        [BASE.x + BASE.w - inset,     BASE.y + inset],
        [BASE.x + inset,              BASE.y + BASE.h - inset],
        [BASE.x + BASE.w - inset,     BASE.y + BASE.h - inset]
    ];
    for (let i = 0; i < 4; i++) {
        gunTerminals.push({
            x: corners[i][0], y: corners[i][1],
            up: GUN_UPGRADES[i],
            hold: 0,
            lastRound: 0        // one stack per terminal per round
        });
    }
})();

const TERMINAL_HOLD = 45;

function playerReloadTime() { return Math.max(30, 90 - gun.firerate * 18); }
function gunBulletCount()   { return 1 + gun.spread; }
function gunBulletCarve()   { return 20 + gun.size * 8; }
function gunBulletRadius()  { return 2 + gun.size * 1.1; }

function updateGunTerminals() {
    for (const t of gunTerminals) {
        const maxed = gun[t.up.id] >= GUN_MAX_STACK;
        const usedThisRound = t.lastRound === round;
        const near = !player.dead && Math.hypot(player.x - t.x, player.y - t.y) < 44;

        if (near && keys.f && !maxed && !usedThisRound && !cardOffer) {
            t.hold++;
            if (t.hold >= TERMINAL_HOLD) {
                t.hold = 0;
                gun[t.up.id]++;
                t.lastRound = round;
                floatText(t.x, t.y - 26, t.up.name + ' ' + gun[t.up.id], '#9fd4e3');
                banner(t.up.name + ' ' + gun[t.up.id] + '/' + GUN_MAX_STACK);
            }
        } else {
            t.hold = Math.max(0, t.hold - 3);
        }
    }
}

function drawGunTerminals() {
    for (const t of gunTerminals) {
        const stacks = gun[t.up.id];
        const maxed = stacks >= GUN_MAX_STACK;
        const usedThisRound = t.lastRound === round;

        ctx.fillStyle = maxed ? '#3d4b52' : (usedThisRound ? '#4a5a63' : '#8d99a6');
        ctx.fillRect(t.x - 13, t.y - 13, 26, 26);
        ctx.fillStyle = maxed ? '#6ee7b7' : (usedThisRound ? '#7c8b95' : '#cfe8ef');
        ctx.fillRect(t.x - 8, t.y - 8, 16, 16);

        for (let i = 0; i < GUN_MAX_STACK; i++) {
            ctx.fillStyle = i < stacks ? '#9fd4e3' : 'rgba(255,255,255,0.16)';
            ctx.fillRect(t.x - 12 + i * 9, t.y + 16, 7, 4);
        }

        ctx.fillStyle = 'rgba(207, 232, 239, 0.8)';
        ctx.font = '9px monospace';
        ctx.textAlign = 'center';
        ctx.fillText(t.up.name, t.x, t.y - 20);
        ctx.textAlign = 'left';

        if (t.hold > 0) {
            ctx.strokeStyle = '#cfe8ef';
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.arc(t.x, t.y, 24, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * (t.hold / TERMINAL_HOLD));
            ctx.stroke();
        }

        if (!player.dead && Math.hypot(player.x - t.x, player.y - t.y) < 44 && !cardOffer) {
            ctx.fillStyle = '#ffffff';
            ctx.font = 'bold 10px monospace';
            ctx.textAlign = 'center';
            ctx.fillText(maxed ? 'MAXED' : (usedThisRound ? 'NEXT ROUND' : 'HOLD F'), t.x, t.y + 34);
            ctx.textAlign = 'left';
        }
    }
}

function inSanctuary(x, y) {
    for (const s of sanctuaries) {
        if (x > s.x && x < s.x + s.w && y > s.y && y < s.y + s.h) return s;
    }
    return null;
}

function updateSprays() {
    for (const t of sprayTurrets) {
        t.sweep += SPRAY_SWEEP_SPEED;
        t.angle = t.out + Math.sin(t.sweep) * (SPRAY_SWEEP_ARC / 2);
        t.fire--;
        if (t.fire <= 0) {
            t.fire = SPRAY_FIRE_EVERY;
            if (sprayMotes.length < MOTE_MAX) {
                const a = t.angle + (Math.random() - 0.5) * 0.16;
                const sp = MOTE_SPEED * (0.85 + Math.random() * 0.3);
                sprayMotes.push({
                    x: t.x + Math.cos(a) * 10, y: t.y + Math.sin(a) * 10,
                    vx: Math.cos(a) * sp, vy: Math.sin(a) * sp,
                    life: MOTE_LIFE, maxLife: MOTE_LIFE, gen: 0
                });
            }
        }
    }

    for (let i = sprayMotes.length - 1; i >= 0; i--) {
        const m = sprayMotes[i];
        m.x += m.vx; m.y += m.vy;
        m.life--;

        if (m.life <= 0 || m.x < 0 || m.x > worldWidth || m.y < 0 || m.y > worldHeight) {
            sprayMotes.splice(i, 1);
            continue;
        }
        // Splashes on human structure rather than ghosting through it.
        if (isStatic(m.x, m.y)) { sprayMotes.splice(i, 1); continue; }

        if (isFlesh(m.x, m.y)) {
            // Taken hold: eat the growth, slow down, and pass the die-off outward.
            suppressRadius(m.x, m.y, MOTE_BITE_ON_FLESH);
            m.vx *= 0.90; m.vy *= 0.90;
            m.life -= 2;
            if (m.gen < MOTE_MAX_GEN && sprayMotes.length < MOTE_MAX && Math.random() < MOTE_SPREAD_CHANCE) {
                const a = Math.random() * Math.PI * 2;
                sprayMotes.push({
                    x: m.x, y: m.y,
                    vx: Math.cos(a) * 1.5, vy: Math.sin(a) * 1.5,
                    life: m.life * 0.55, maxLife: m.maxLife, gen: m.gen + 1
                });
            }
        } else {
            suppressRadius(m.x, m.y, MOTE_BITE);
        }
    }
}

// ============================================================
// Organs
// One of each, far apart. Which one you run to IS the build decision.
// ============================================================
const organs = [
    { id: 'prosiblast', name: 'PROSIBLAST', tree: 'crawler',  x: 2400, y: 620,  color: '#6ec24a', blurb: 'pulsating pile of intestines' },
    { id: 'coaxitrib',  name: 'COAXITRIB',  tree: 'splatter', x: 860,  y: 2400, color: '#c9304a', blurb: 'twitching banana-shaped heart' },
    { id: 'shahnter',   name: 'SHAHNTER',   tree: 'mob',      x: 3960, y: 2560, color: '#3aa8c9', blurb: 'braided sheath of tendon' }
];
organs.forEach(o => {
    o.state = 'idle';     // idle | connecting | baking
    o.connect = 0;
    o.bake = 0;
    o.pulse = Math.random() * Math.PI * 2;
    // A permanent apron so the organ is always physically reachable.
    paintDiscToMask(noGrow, o.x, o.y, 64, 1);
});
for (let i = 0; i < gridSize; i++) if (noGrow[i]) { gridA[i] = 1; gridB[i] = 0; }

const CONNECT_FRAMES = 120;   // 2s hold on F
const BAKE_FRAMES = 900;      // 15s bake at the organ

