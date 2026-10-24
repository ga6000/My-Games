/**
 * Glass City Escape — the lift panel (2026-10-18, GCE_ELEVATOR_PLAN.md)
 *
 * The right-hand sidebar: a red seven-segment LEVEL display, and above the run's
 * numbers a column of lift buttons that reads out the FLOOR you are on.
 *
 * LEVEL and FLOOR are different things in this game and the panel keeps them
 * apart: the level is the stage (the city you are in, `currentStage`), the floor
 * is `player.z` inside a building. The level display deliberately does NOT track
 * `currentStage` frame by frame. It is told when to change -- on the elevator's
 * ding (gc-elevator.js) -- because the world is rebuilt in the dark halfway
 * through the ride and the number has to change when the doors open, not before.
 *
 * Classic script, one shared global scope, declarations only. No timers: the
 * flash is driven from sidebarFrame(), which gameLoop() calls.
 */
"use strict";

/**
 * Seven segments as [x, y, w, h] in units of a digit's box, built once.
 *
 *    aaa
 *   f   b
 *    ggg
 *   e   c
 *    ddd
 */
const SB_DIGIT_MASKS = {
    "0": "abcdef", "1": "bc", "2": "abdeg", "3": "abcdg", "4": "bcfg",
    "5": "acdfg", "6": "acdefg", "7": "abc", "8": "abcdefg", "9": "abcdfg"
};

let sbLevelShown = 1;          // what the red display currently reads
let sbFloorShown = 0;
let sbFlashUntil = 0;          // performance.now() the post-ding flash ends

// One segment as a rect inside a digit whose box is (x0, y0, w, h), thickness t.
function sidebarSegmentRect(seg, x0, y0, w, h, t) {
    const vlen = (h - 3 * t) / 2;
    switch (seg) {
        case "a": return [x0 + t, y0, w - 2 * t, t];
        case "b": return [x0 + w - t, y0 + t, t, vlen];
        case "c": return [x0 + w - t, y0 + 2 * t + vlen, t, vlen];
        case "d": return [x0 + t, y0 + h - t, w - 2 * t, t];
        case "e": return [x0, y0 + 2 * t + vlen, t, vlen];
        case "f": return [x0, y0 + t, t, vlen];
        default:  return [x0 + t, y0 + t + vlen, w - 2 * t, t];     // g
    }
}

/**
 * Draw the level into the red display. Two digits, no leading zero, with the
 * unlit segments left faintly visible the way a real LED module's are -- that
 * ghost "88" is most of why it reads as hardware and not as text.
 */
function sidebarDrawLevel(n, allLit) {
    const cv = document.getElementById('level-display');
    if (!cv) return;
    const c = cv.getContext('2d');
    c.clearRect(0, 0, cv.width, cv.height);

    const digitW = 54, digitH = 76, t = 9, gap = 12;
    const total = digitW * 2 + gap;
    const left = Math.round((cv.width - total) / 2);
    const top = Math.round((cv.height - digitH) / 2);
    const text = String(Math.max(0, Math.min(99, n | 0)));
    const chars = [text.length > 1 ? text[0] : " ", text[text.length - 1]];

    for (let d = 0; d < 2; d++) {
        const lit = allLit ? "abcdefg" : (SB_DIGIT_MASKS[chars[d]] || "");
        const x0 = left + d * (digitW + gap);
        for (const seg of "abcdefg") {
            const r = sidebarSegmentRect(seg, x0, top, digitW, digitH, t);
            const on = lit.indexOf(seg) >= 0;
            c.fillStyle = on ? '#ff2a2a' : 'rgba(255, 42, 42, 0.11)';
            // Inset by one px on every side so adjacent segments never touch.
            c.fillRect(r[0] + 1, r[1] + 1, r[2] - 2, r[3] - 2);
            if (on) {
                c.fillStyle = 'rgba(255, 190, 170, 0.55)';           // hot core
                if (r[2] > r[3]) c.fillRect(r[0] + 3, r[1] + 3, r[2] - 6, 2);
                else c.fillRect(r[0] + 3, r[1] + 3, 2, r[3] - 6);
            }
        }
    }
}

// Build the button column once. Top floor at the top, ground at the bottom, the
// way a real panel reads.
function sidebarInit() {
    const panel = document.getElementById('floor-panel');
    if (!panel) return;
    panel.innerHTML = '';
    for (let z = MAX_Z - 1; z >= 0; z--) {
        const b = document.createElement('div');
        b.className = 'floor-btn';
        b.id = 'floor-btn-' + z;
        b.textContent = z === 0 ? 'G' : String(z);
        panel.appendChild(b);
    }
    sidebarSetFloor(0);
    sidebarDrawLevel(currentStage, false);
    sbLevelShown = currentStage;
}

// The floor you are standing on. Called from the stair code and on every spawn.
function sidebarSetFloor(z) {
    sbFloorShown = z;
    for (let i = 0; i < MAX_Z; i++) {
        const b = document.getElementById('floor-btn-' + i);
        if (b) b.classList.toggle('lit', i === z);
    }
}

// The red display reads `n` from now on.
function sidebarSetLevel(n) {
    sbLevelShown = n;
    sidebarDrawLevel(n, false);
}

/**
 * The ding's flash: every segment and every button blinks together for a few
 * hundred ms, then the new level settles. Driven by sidebarFrame().
 */
function sidebarFlash() {
    sbFlashUntil = performance.now() + 480;
}

function sidebarFrame() {
    if (!sbFlashUntil) return;
    const now = performance.now();
    if (now >= sbFlashUntil) {
        sbFlashUntil = 0;
        sidebarDrawLevel(sbLevelShown, false);
        for (let i = 0; i < MAX_Z; i++) {
            const b = document.getElementById('floor-btn-' + i);
            if (b) b.classList.remove('flash');
        }
        return;
    }
    const on = Math.floor((sbFlashUntil - now) / 80) % 2 === 0;
    sidebarDrawLevel(sbLevelShown, on);
    for (let i = 0; i < MAX_Z; i++) {
        const b = document.getElementById('floor-btn-' + i);
        if (b) b.classList.toggle('flash', on);
    }
}
