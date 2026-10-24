/**
 * Glass City Escape — the elevator (2026-10-18, GCE_ELEVATOR_PLAN.md)
 *
 * The stepwell's tunnel is a lift now. A steel cage stands on the well; once
 * the last pedestal is filled its gates slide open, and walking into it starts
 * a ride:
 *
 *   enter    the gates close on all four sides
 *   descend  the cab sinks down a black shaft, the screen goes dark
 *            -- the next level is built here, in the dark --
 *   arrive   the same cab drops in at the new spawn, thuds down
 *   open     the gates open again, then the DING, and the red LEVEL display
 *            changes
 *
 * THE WORLD IS FROZEN FOR THE WHOLE RIDE. gameLoop() hands control to
 * elevUpdate() while `elev` is set: no drones, bolts or telemetry advance, so
 * the player is invulnerable inside the cage by construction rather than by a
 * flag. The ride is paced by its own clock (`elev.pt`, advanced by dt) and not
 * by performance.now(), so the L+G pause or a throttled tab cannot desync it.
 *
 * This SUPERSEDES the Robotron "no pause between levels" rule of 2026-09-06 for
 * the level change itself (about 5 s with the player locked in). The wave burst
 * and the "LEVEL n" title are kept, armed at the release.
 *
 * Classic script, one shared global scope, declarations only.
 */
"use strict";

const CAB_HALF = 40;               // the cab is 80 px square, two cells
const ELEV_ENTER_MS = 750;         // walk to the middle + gates close
const ELEV_DESCEND_MS = 1700;
const ELEV_ARRIVE_MS = 1300;
const ELEV_OPEN_MS = 750;
const ELEV_SINK_TO = 0.38;         // scale the cab reaches at the bottom of the shaft
const ELEV_DROP_FROM = 2.4;        // scale the cab starts at when it drops in
const ELEV_STEEL = '#9fb3ba';
const ELEV_STEEL_MID = '#5d7178';
const ELEV_STEEL_DK = '#2b3a3f';

// null when no ride is running. Otherwise:
//   { phase, pt, cab: 'well'|'spawn', closed, scale, dark, streaks, ... }
let elev = null;
let elevShakeUntil = 0;
let elevShakeAmp = 0;

function elevEase(t) {
    t = Math.max(0, Math.min(1, t));
    return t * t * (3 - 2 * t);
}

function elevWellPos() {
    return { x: PLAZA_CX * CELL_SIZE + CELL_SIZE / 2, y: PLAZA_CY * CELL_SIZE + CELL_SIZE / 2 };
}

// While the well's cab is shut it is a solid object. Once the tunnel is open the
// gates are clear on all four sides and the player walks in.
function elevCabBlocks(px, py) {
    if (escapeTunnelOpen || !pedestals.length) return false;
    const w = elevWellPos();
    const reach = CAB_HALF + 8;
    return Math.abs(px - w.x) < reach && Math.abs(py - w.y) < reach;
}

// ---- the two cabs -------------------------------------------------------

function elevWellCab() {
    const w = elevWellPos();
    let closed = 1;
    let scale = 1;
    if (elev && elev.cab === 'well') { closed = elev.closed; scale = elev.scale; }
    else if (escapeTunnelOpen) closed = 1 - elevEase(exitOpenProgress());
    return { x: w.x, y: w.y, closed: closed, scale: scale, open: escapeTunnelOpen || (elev && elev.cab === 'well') };
}

function elevSpawnCab() {
    const sp = spawnPoint();
    let closed = 0;
    let scale = 1;
    if (elev && elev.cab === 'spawn') { closed = elev.closed; scale = elev.scale; }
    return { x: sp.x, y: sp.y, closed: closed, scale: scale, open: true };
}

// ---- drawing ------------------------------------------------------------

function elevCabVisible(cab) {
    const r = CAB_HALF * Math.max(1, cab.scale) + 30;
    return cab.x + r > camera.x && cab.x - r < camera.x + canvas.width &&
           cab.y + r > camera.y && cab.y - r < camera.y + canvas.height;
}

/**
 * pass 'under': the shaft, the shadow, the grating floor.
 * pass 'over':  roof bars, corner posts, the four gates -- drawn AFTER the
 *               player, so the player is seen through a cage and not above it.
 */
function drawCab(cab, pass) {
    if (!elevCabVisible(cab)) return;
    const H = CAB_HALF;
    const s = cab.scale;

    ctx.save();
    ctx.translate(cab.x, cab.y);

    if (pass === 'under') {
        if (s < 0.999) {
            // Sinking: the shaft is a black hole the cab shrinks down into.
            ctx.fillStyle = '#000';
            ctx.fillRect(-H - 4, -H - 4, H * 2 + 8, H * 2 + 8);
            ctx.strokeStyle = ELEV_STEEL_DK;
            ctx.lineWidth = 2;
            ctx.strokeRect(-H - 3, -H - 3, H * 2 + 6, H * 2 + 6);
        } else if (s > 1.001) {
            // Falling in from above: a growing shadow on the floor it will hit.
            const k = Math.min(1, (s - 1) / (ELEV_DROP_FROM - 1));
            const sh = H * (1.05 + (1 - k) * 0.2);
            ctx.fillStyle = 'rgba(0,0,0,' + (0.55 * (1 - k * 0.6)).toFixed(3) + ')';
            ctx.fillRect(-sh, -sh, sh * 2, sh * 2);
        }
        ctx.scale(s, s);

        // Floor plate.
        ctx.fillStyle = '#0d1417';
        ctx.fillRect(-H, -H, H * 2, H * 2);
        // Grating, 8 px pitch.
        ctx.strokeStyle = ELEV_STEEL_DK;
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let k = -H + 8; k < H; k += 8) {
            ctx.moveTo(k + 0.5, -H); ctx.lineTo(k + 0.5, H);
            ctx.moveTo(-H, k + 0.5); ctx.lineTo(H, k + 0.5);
        }
        ctx.stroke();
        // A cyan guide square on the floor: the goal colour, now that the
        // cab is the goal. Brighter once the well is open.
        const pulse = Math.sin(performance.now() / (cab.open ? 220 : 900)) * 0.5 + 0.5;
        ctx.strokeStyle = 'rgba(0, 229, 255, ' + (cab.open ? 0.35 + pulse * 0.4 : 0.14).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.strokeRect(-H + 9, -H + 9, H * 2 - 18, H * 2 - 18);
        ctx.restore();
        return;
    }

    // ---- pass 'over' ----
    ctx.scale(s, s);

    // Roof bars: thin, so the cab is a cage and not a box.
    ctx.strokeStyle = 'rgba(159, 179, 186, 0.30)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    for (let k = -H + 10; k < H; k += 10) { ctx.moveTo(-H, k); ctx.lineTo(H, k); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(159, 179, 186, 0.55)';
    ctx.beginPath();
    ctx.moveTo(-H, 0); ctx.lineTo(H, 0);
    ctx.moveTo(0, -H); ctx.lineTo(0, H);
    ctx.stroke();

    // The four gates. Each is drawn on the north edge and the context is
    // rotated a quarter turn per side. Leaves slide behind the corner posts.
    const lampLit = cab.open ? INK.cyan : (Math.sin(performance.now() / 400) > 0 ? INK.magenta : '#4a1030');
    const shift = (1 - cab.closed) * 28;
    for (let side = 0; side < 4; side++) {
        ctx.save();
        ctx.rotate(side * Math.PI / 2);
        ctx.beginPath();
        ctx.rect(-H, -H - 1, H * 2, 12);
        ctx.clip();
        for (let leaf = -1; leaf <= 1; leaf += 2) {
            const x = leaf < 0 ? -H + 6 - shift : 0 + shift;
            drawCabLeaf(x, -H, 34, 8);
        }
        ctx.restore();
        // The lamp over the gate, outside the clip. Cyan when the way is open.
        ctx.save();
        ctx.rotate(side * Math.PI / 2);
        ctx.fillStyle = lampLit;
        ctx.fillRect(-4, -H - 5, 8, 3);
        ctx.restore();
    }

    // Corner posts last, so the leaves slide BEHIND them.
    for (let sx = -1; sx <= 1; sx += 2) {
        for (let sy = -1; sy <= 1; sy += 2) {
            const px = sx < 0 ? -H : H - 8;
            const py = sy < 0 ? -H : H - 8;
            ctx.fillStyle = ELEV_STEEL_MID;
            ctx.fillRect(px, py, 8, 8);
            ctx.fillStyle = ELEV_STEEL;
            ctx.fillRect(px, py, 8, 2);
            ctx.fillRect(px, py, 2, 8);
        }
    }

    // The landing: a square dust ring that opens out from the cab.
    if (elev && elev.cab === 'spawn' && elev.landedAt !== undefined && cab.scale <= 1.001) {
        const age = elev.pt - elev.landedAt;
        if (age >= 0 && age < 380) {
            const k = age / 380;
            const r = H * (1.02 + k * 0.9);
            ctx.strokeStyle = 'rgba(159, 179, 186, ' + (0.7 * (1 - k)).toFixed(3) + ')';
            ctx.lineWidth = 3;
            ctx.strokeRect(-r, -r, r * 2, r * 2);
        }
    }
    ctx.restore();
}

// One gate leaf: a steel frame with vertical bars and a cross brace.
function drawCabLeaf(x, y, w, h) {
    ctx.fillStyle = '#141d20';
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = ELEV_STEEL;
    ctx.lineWidth = 1;
    ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    ctx.strokeStyle = ELEV_STEEL_MID;
    ctx.beginPath();
    for (let k = x + 5; k < x + w - 2; k += 5) { ctx.moveTo(k + 0.5, y + 1); ctx.lineTo(k + 0.5, y + h - 1); }
    ctx.stroke();
}

function drawElevatorCabs(pass) {
    drawCab(elevWellCab(), pass);
    drawCab(elevSpawnCab(), pass);
}

// Screen space. The dark that hides the rebuild, and the shaft walls streaking
// past while the cab drops.
function drawElevatorOverlay() {
    if (!elev || elev.dark <= 0) return;
    ctx.save();
    ctx.fillStyle = 'rgba(0, 0, 0, ' + Math.min(1, elev.dark).toFixed(3) + ')';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    if (elev.streaks > 0) {
        const now = performance.now();
        ctx.strokeStyle = 'rgba(159, 179, 186, ' + (0.35 * elev.streaks).toFixed(3) + ')';
        ctx.lineWidth = 2;
        ctx.beginPath();
        for (let i = 0; i < 22; i++) {
            const x = Math.round(((i * 97.3) % canvas.width) / 4) * 4;
            const sp = 0.9 + (i % 4) * 0.55;
            const y = canvas.height - ((now * sp + i * 71) % (canvas.height + 60));
            ctx.moveTo(x, y); ctx.lineTo(x, y + 26 + (i % 3) * 14);
        }
        ctx.stroke();
    }
    ctx.restore();
}

// A pixel or two of camera shake after the thud. Added in render().
function elevShakeOffset() {
    const now = performance.now();
    if (now >= elevShakeUntil) return { x: 0, y: 0 };
    const k = (elevShakeUntil - now) / 320;
    return { x: Math.round((Math.random() * 2 - 1) * elevShakeAmp * k),
             y: Math.round((Math.random() * 2 - 1) * elevShakeAmp * k) };
}

// ---- the ride -----------------------------------------------------------

function elevBegin() {
    const w = elevWellPos();
    elev = {
        phase: 'enter', pt: 0, cab: 'well',
        closed: 0, scale: 1, dark: 0, streaks: 0,
        fromX: player.x, fromY: player.y, wx: w.x, wy: w.y,
        doorSounded: false
    };
    keys = {};
    player.dir = Math.PI / 2;
    // The drone, the pursuit tune and the sight tone would otherwise hang at
    // their last level for the whole ride.
    gcAudioSilence();
}

function elevEnterPhase(phase) {
    elev.phase = phase;
    elev.pt = 0;
    elev.doorSounded = false;
}

function elevUpdate(dt) {
    if (!elev) return;
    elev.pt += Math.min(dt, 100);
    const t = elev.pt;

    if (elev.phase === 'enter') {
        const k = elevEase(t / 320);
        player.x = elev.fromX + (elev.wx - elev.fromX) * k;
        player.y = elev.fromY + (elev.wy - elev.fromY) * k;
        elev.closed = elevEase((t - 160) / (ELEV_ENTER_MS - 160));
        if (!elev.doorSounded && t >= 160) { elev.doorSounded = true; gcElevDoorSound(); }
        if (t >= ELEV_ENTER_MS) {
            elev.closed = 1;
            elevEnterPhase('descend');
            gcElevMotorSound();
        }
    } else if (elev.phase === 'descend') {
        const p = Math.min(1, t / ELEV_DESCEND_MS);
        elev.scale = 1 - (1 - ELEV_SINK_TO) * elevEase(p);
        player.scale = elev.scale;
        elev.dark = elevEase((p - 0.30) / 0.70);
        elev.streaks = Math.min(1, p / 0.25);
        if (p >= 1) {
            // THE REBUILD HAPPENS HERE, in the dark. After this the player
            // stands in the new level's spawn cab, doors shut, high above it.
            advanceStageWorld();
            elev.cab = 'spawn';
            elev.closed = 1;
            elev.scale = ELEV_DROP_FROM;
            elev.dark = 1;
            elev.streaks = 0;
            player.scale = elev.scale;
            player.dir = Math.PI / 2;
            delete elev.landedAt;
            elevEnterPhase('arrive');
        }
    } else if (elev.phase === 'arrive') {
        const p = Math.min(1, t / ELEV_ARRIVE_MS);
        const f = Math.min(1, p / 0.72);
        elev.dark = 1 - elevEase(p / 0.28);
        elev.streaks = 0;
        // Accelerating drop: slow at the top, fast into the floor.
        elev.scale = 1 + (ELEV_DROP_FROM - 1) * (1 - f * f);
        player.scale = elev.scale;
        if (f >= 1 && elev.landedAt === undefined) {
            elev.landedAt = t;
            elevShakeUntil = performance.now() + 320;
            elevShakeAmp = 9;
            gcElevThudSound();
        }
        if (p >= 1) { elev.scale = 1; player.scale = 1; elevEnterPhase('open'); }
    } else if (elev.phase === 'open') {
        if (!elev.doorSounded) { elev.doorSounded = true; gcElevDoorSound(); }
        elev.closed = 1 - elevEase(t / ELEV_OPEN_MS);
        if (t >= ELEV_OPEN_MS) elevRelease(true);
    }
}

/**
 * The ride is over: the DING, then the level display changes, then the player
 * is theirs again. `ding` is false on the dev panel's instant STAGE +1.
 */
function elevRelease(ding) {
    if (ding) gcElevDingSound();
    sidebarSetLevel(currentStage);
    if (ding) sidebarFlash();
    waveTransitionAt = performance.now();
    elev = null;
    player.scale = 1.0;
    keys = {};
    stageAdvancing = false;
}
