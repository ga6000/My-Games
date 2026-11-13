// ===================================================
//   Hub — marquee art
// ===================================================
// Added 2026-11-13 (Ry: "the tiles look amateur", "images per game ...
// horrific and in alliance with the story"). Every tile used to be an emoji.
// Each is now a small pixel scene from that chapter of the story, drawn
// here with rectangles onto a 96 x 54 canvas that CSS scales up unsmoothed.
//
// THE RULES THE SCENES KEEP (AESTHETIC_GUIDE.md):
//   - black ground, flat fills, no gradients, at most a handful of colours
//   - the chapter's own world hue for its place; --phos tones for structure
//   - magenta only on the thing that kills you
//   - BREATH: every aircrab on the board inflates and exhales on one shared
//     clock, in steps (hub-bestiary: breath is the rule for every creature)
//   - motion is stepped: the whole board advances at ART_FPS, never tweens
//
// This is placeholder key art in the right language, not the final word:
// a tile whose GAMES entry carries `art: "path/to.png"` shows that image
// instead (see artRepaint), which is how drawn marquees replace these.
//
// Classic script in the hub's shared global scope. Declarations only;
// hub-boot.js starts the clock.
"use strict";

const ART_W = 96;
const ART_H = 54;
const ART_FPS = 5;

const ART_INK = {
    hot: "#E8FFF4", mid: "#8FA89C", dim: "#2E3A34", deep: "#141A17",
    amber: "#FFB000", cyan: "#00E5FF", magenta: "#FF2E88",
    lung: "#C9566B", lungDark: "#6E1F35", lungPale: "#F2A0A8"
};

let artFrame = 0;
const artImages = {};

function artRand(n) {
    const x = Math.sin(n * 127.1 + 311.7) * 43758.5453;
    return x - Math.floor(x);
}

function artBox(c, x, y, w, h, col) {
    c.fillStyle = col;
    c.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

// A filled ellipse out of rows, so its edge is stepped pixels.
function artOval(c, cx, cy, rx, ry, col) {
    c.fillStyle = col;
    for (let dy = -ry; dy <= ry; dy++) {
        const w = Math.round(rx * Math.sqrt(Math.max(0, 1 - (dy * dy) / (ry * ry + 0.01))));
        if (w > 0) c.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2, 1);
    }
}

// The shared breath: 0 exhaled, 1, 2 full. One clock for the whole board.
function artBreath(offset) {
    const seq = [0, 0, 1, 2, 2, 2, 1, 0];
    return seq[(Math.floor(artFrame / 2) + (offset || 0)) % seq.length];
}

// An aircrab: two lung lobes on a stem, tendrils hanging. `s` is roughly
// its half height in pixels when full.
function artCrab(c, x, y, s, opts) {
    opts = opts || {};
    const b = opts.breath == null ? artBreath(opts.phase) : opts.breath;
    const body = opts.col || ART_INK.lung;
    const dark = opts.dark || ART_INK.lungDark;
    const ry = Math.max(2, Math.round(s * (0.62 + 0.19 * b)));
    const rx = Math.max(1, Math.round(s * (0.34 + 0.13 * b)));
    const gap = Math.max(1, Math.round(rx * 0.9));

    // Tendrils first, so the lobes sit over their roots.
    const n = opts.tendrils == null ? 4 : opts.tendrils;
    for (let i = 0; i < n; i++) {
        const tx = x - gap - rx + 1 + Math.round(i * ((gap + rx) * 2 - 2) / Math.max(1, n - 1));
        const len = Math.round(s * (0.9 + artRand(i + s) * 1.1));
        for (let k = 0; k < len; k++) {
            const sway = Math.round(Math.sin((artFrame + k * 2 + i * 5) * 0.5) * (k / len) * 2);
            artBox(c, tx + sway, y + ry - 1 + k, 1, 1, k > len - 3 ? ART_INK.magenta : dark);
        }
    }

    artOval(c, x - gap, y, rx, ry, body);
    artOval(c, x + gap, y, rx, ry, body);
    // The stem, and a vein down each lobe.
    artBox(c, x, y - ry - 2, 1, ry + 2, opts.pale || ART_INK.lungPale);
    artBox(c, x - gap, y - ry + 2, 1, ry * 2 - 3, dark);
    artBox(c, x + gap, y - ry + 2, 1, ry * 2 - 3, dark);
    if (b === 2) {
        artBox(c, x - gap - rx + 1, y - 1, 1, 2, opts.pale || ART_INK.lungPale);
        artBox(c, x + gap + rx - 2, y - 1, 1, 2, opts.pale || ART_INK.lungPale);
    }
}

function artPerson(c, x, y, col, lean) {
    artBox(c, x, y - 5, 2, 2, col);
    artBox(c, x + (lean || 0), y - 3, 2, 3, col);
    artBox(c, x, y, 1, 2, col);
    artBox(c, x + 1 + (lean || 0), y, 1, 2, col);
}

function artStars(c, n, seed, col) {
    for (let i = 0; i < n; i++) {
        const on = (artFrame + i) % 9 !== 0;
        if (on) artBox(c, artRand(seed + i) * ART_W, artRand(seed + i * 3.3) * ART_H, 1, 1, col || ART_INK.dim);
    }
}

// ---------------------------------------------------
//   THE SCENES, one per GAMES id
// ---------------------------------------------------
const ART_SCENES = {
    // ACT I. The meatball comes down over a camp.
    "alien-outpost": function (c) {
        artStars(c, 26, 1);
        const p = (artFrame % 24) / 24;
        const mx = 78 - p * 44, my = 2 + p * 30;
        for (let k = 1; k < 9; k++) artBox(c, mx + k * 3, my - k * 2, 2, 2, k < 3 ? ART_INK.amber : "#7A3B00");
        artOval(c, mx, my, 5, 4, ART_INK.lungDark);
        artOval(c, mx - 1, my - 1, 3, 2, ART_INK.lung);
        for (let i = 0; i < 12; i++) {
            const h = 8 + Math.round(artRand(i + 40) * 9);
            const x = i * 9 + Math.round(artRand(i) * 3);
            for (let k = 0; k < h; k += 2) artBox(c, x - k / 4, ART_H - 6 - h + k, 1 + k / 2, 2, ART_INK.deep);
        }
        artBox(c, 0, ART_H - 6, ART_W, 6, "#0C1410");
        artBox(c, 18, ART_H - 9, 3, 3, artFrame % 2 ? ART_INK.amber : "#FF6A00");
        artPerson(c, 24, ART_H - 8, ART_INK.mid);
        artPerson(c, 12, ART_H - 8, ART_INK.mid);
    },

    // The dive under the rig: the diver, and what breathes in the dark.
    "scuba-shooter": function (c) {
        artBox(c, 0, 0, ART_W, ART_H, "#02060F");
        artBox(c, 0, 9, ART_W, 1, "#0A3A6E");
        artBox(c, 30, 2, 40, 5, ART_INK.dim);
        [36, 50, 64].forEach(x => artBox(c, x, 7, 2, ART_H, ART_INK.deep));
        for (let i = 0; i < 9; i++) {
            const y = (ART_H - ((artFrame * 2 + i * 13) % ART_H));
            artBox(c, 20 + artRand(i) * 60, y, 1, 1, "#3C78B4");
        }
        artCrab(c, 70, 34, 10, { col: "#3E6E8C", dark: "#16303F", pale: "#9FD7E8", tendrils: 6 });
        const dy = 24 + (artBreath(3) > 0 ? 1 : 0);
        artBox(c, 18, dy, 7, 3, ART_INK.amber);
        artBox(c, 25, dy, 2, 2, ART_INK.hot);
        artBox(c, 14, dy + 1, 4, 1, ART_INK.mid);
        artBox(c, 27, dy + 1, 5, 1, ART_INK.cyan);
        if (artFrame % 6 < 2) artBox(c, 34, dy + 1, 8, 1, ART_INK.hot);
    },

    // ACT II. The Inspired at the gate, a crab over the fence line.
    "zombie": function (c) {
        artBox(c, 0, 0, ART_W, 30, "#1A0703");
        artBox(c, 0, 30, ART_W, 24, "#0A0302");
        artOval(c, 76, 30, 13, 13, "#FF4A1C");
        artBox(c, 0, 30, ART_W, 14, "#0A0302");
        artCrab(c, 30, 13, 8, { tendrils: 5 });
        for (let x = 0; x < ART_W; x += 6) artBox(c, x, 26, 1, 10, "#3A1208");
        artBox(c, 0, 28, ART_W, 1, "#3A1208");
        for (let i = 0; i < 15; i++) {
            const x = 3 + i * 6 + Math.round(artRand(i + 7) * 3);
            const bob = (artFrame + i) % 4 === 0 ? 1 : 0;
            artPerson(c, x, 40 + Math.round(artRand(i) * 8) + bob, i % 5 === 0 ? "#5A1A0C" : "#000000", (i + artFrame) % 3 === 0 ? 1 : 0);
        }
        artPerson(c, 46, 50, ART_INK.hot);
        if (artFrame % 5 < 2) artBox(c, 49, 46, 6, 1, ART_INK.amber);
    },

    // Rooftops, a runner mid-jump, the swarm between the towers.
    "glass-city-escape": function (c) {
        artStars(c, 14, 9);
        const hue = "#00B4FF";
        for (let i = 0; i < 8; i++) {
            const h = 14 + Math.round(artRand(i + 3) * 26);
            const x = i * 13 - 2;
            artBox(c, x, ART_H - h, 10, h, "#04121C");
            artBox(c, x, ART_H - h, 10, 1, hue);
            for (let k = 3; k < h; k += 4) {
                if (artRand(i * 9 + k) > 0.5) artBox(c, x + 2 + (k % 3) * 2, ART_H - h + k, 1, 2, "#0A4666");
            }
        }
        artCrab(c, 18, 12, 5, { phase: 2, tendrils: 3 });
        artCrab(c, 62, 9, 6, { phase: 5, tendrils: 3 });
        artCrab(c, 86, 20, 4, { phase: 1, tendrils: 3 });
        const hop = [0, 3, 5, 6, 5, 3][artFrame % 6];
        artPerson(c, 40, 22 - hop, ART_INK.hot, 1);
    },

    // The alley: one shield, the tendril tips coming like pong balls.
    "four-d-pong": function (c) {
        artBox(c, 0, 0, 22, ART_H, "#0B0B0B");
        artBox(c, 22, 0, 1, ART_H, ART_INK.dim);
        for (let y = 4; y < ART_H; y += 6) artBox(c, 47, y, 1, 3, ART_INK.dim);
        artCrab(c, 84, 24, 15, { tendrils: 0 });
        const reach = [10, 22, 34, 22][Math.floor(artFrame / 2) % 4];
        [10, 24, 38].forEach((y, i) => {
            const r = reach + i * 6;
            const tip = 72 - r;
            for (let x = 72; x > tip; x -= 2) artBox(c, x, y + Math.round(Math.sin((x + artFrame) * 0.5)), 2, 1, ART_INK.lungDark);
            artBox(c, tip - 2, y - 1, 3, 3, ART_INK.hot);
        });
        artBox(c, 26, 16 + [0, 4, 8, 4][Math.floor(artFrame / 2) % 4], 2, 12, ART_INK.hot);
        artPerson(c, 8, 30, ART_INK.mid);
        artPerson(c, 13, 32, ART_INK.mid);
        artPerson(c, 11, 26, ART_INK.dim);
    },

    // ACT III. From orbit: the Earth, and the pit bored into it.
    "hurl-strike": function (c) {
        artStars(c, 30, 21);
        artOval(c, 48, 66, 60, 34, "#0B2A3A");
        artOval(c, 48, 68, 56, 32, "#071A24");
        artOval(c, 52, 40, 9, 3, ART_INK.lungDark);
        artOval(c, 52, 40, 5, 2, "#000000");
        if (artBreath() === 2) artOval(c, 52, 40, 11, 4, "rgba(255,46,136,0.35)");
        artBox(c, 14, 10, 7, 2, ART_INK.mid);
        artBox(c, 12, 9, 2, 4, ART_INK.cyan);
        artBox(c, 21, 9, 2, 4, ART_INK.cyan);
        if (artFrame % 8 < 3) for (let k = 0; k < 14; k++) artBox(c, 22 + k * 2, 12 + k * 2, 2, 1, ART_INK.amber);
    },

    // Belly of the beast: the catwalk down the inside of the Hurl.
    "rd-arena": function (c) {
        const hue = "#8B0A2E";
        for (let r = 0; r < 5; r++) {
            const grow = r === (Math.floor(artFrame / 2) % 5) ? 1 : 0;
            artOval(c, 48, 30, 46 - r * 9 + grow, 30 - r * 6 + grow, r % 2 ? "#12020A" : hue);
        }
        artOval(c, 48, 30, 6, 4, "#000000");
        for (let i = 0; i < 16; i++) {
            const a = i * 0.39 + artFrame * 0.05;
            artBox(c, 48 + Math.cos(a) * (14 + (i % 4) * 8), 30 + Math.sin(a) * (9 + (i % 4) * 5), 2, 2, i % 3 ? ART_INK.magenta : ART_INK.lungPale);
        }
        artBox(c, 0, 44, 40, 1, ART_INK.mid);
        for (let x = 2; x < 40; x += 5) artBox(c, x, 45, 1, 3, ART_INK.dim);
        artPerson(c, 28, 42, ART_INK.hot);
        artPerson(c, 21, 42, ART_INK.mid);
        if (artFrame % 4 < 2) { artBox(c, 31, 39, 5, 1, ART_INK.amber); artBox(c, 36, 38, 3, 3, "#FF6A00"); }
    },

    // ACT IV. The launch codes across the desert, in vectors.
    "code-racer": function (c) {
        const hue = "#FF8A00";
        artBox(c, 0, 26, ART_W, 1, hue);
        [[8, 26, 22, 12], [22, 26, 40, 16], [40, 26, 58, 9], [58, 26, 80, 15], [80, 26, 96, 20]].forEach(m => {
            const steps = m[2] - m[0];
            for (let k = 0; k < steps; k++) {
                const up = k < steps / 2 ? k : steps - k;
                artBox(c, m[0] + k, 26 - Math.round(up * (26 - m[3]) / (steps / 2)), 1, 1, hue);
            }
        });
        for (let i = 0; i < 6; i++) {
            const y = 28 + Math.round(Math.pow(((i + (artFrame % 3) / 3) / 6), 2) * 26);
            artBox(c, 0, y, ART_W, 1, "#5A3000");
        }
        for (let i = -4; i <= 4; i++) for (let k = 0; k < 26; k += 2) artBox(c, 48 + i * (2 + k * 0.9), 28 + k, 1, 1, "#5A3000");
        artBox(c, 44, 40, 9, 3, ART_INK.hot);
        artBox(c, 43, 43, 3, 3, ART_INK.cyan);
        artBox(c, 51, 43, 3, 3, ART_INK.cyan);
        artBox(c, 47, 37, 3, 3, ART_INK.mid);
        artOval(c, 74, 10, 5, 3, ART_INK.dim);
    },

    "cliff-run": function (c) {
        artStars(c, 12, 33);
        for (let y = 0; y < ART_H; y += 3) {
            const edge = 40 + Math.round(artRand(y) * 10) - Math.round(y * 0.25);
            artBox(c, edge, y, ART_W - edge, 3, y % 2 ? "#161C22" : "#10151A");
            artBox(c, edge, y, 1, 3, ART_INK.mid);
        }
        [[44, 40, 14], [56, 28, 12], [50, 16, 16], [70, 8, 14]].forEach(l => artBox(c, l[0], l[1], l[2], 2, ART_INK.dim));
        const step = Math.floor(artFrame / 2) % 4;
        const spots = [[48, 38], [60, 26], [56, 14], [76, 6]];
        artPerson(c, spots[step][0], spots[step][1], ART_INK.hot, 1);
        artCrab(c, 16, 22, 7, { tendrils: 4 });
        artBox(c, 84, 1, 8, 5, ART_INK.cyan);
        artBox(c, 86, 3, 4, 3, "#000000");
    },

    // The Inspired in the wire: a screen of code going wrong.
    "text-editor-wars": function (c) {
        artBox(c, 4, 3, ART_W - 8, ART_H - 6, "#020A06");
        artBox(c, 4, 3, ART_W - 8, 1, ART_INK.mid);
        artBox(c, 4, ART_H - 4, ART_W - 8, 1, ART_INK.mid);
        for (let row = 0; row < 10; row++) {
            let x = 8 + (row % 3) * 4;
            for (let k = 0; k < 7; k++) {
                const w = 3 + Math.round(artRand(row * 11 + k) * 8);
                const bad = artRand(row * 5 + k + Math.floor(artFrame / 3)) > 0.86;
                if (x + w < ART_W - 8) artBox(c, x, 7 + row * 4, w, 2, bad ? ART_INK.magenta : (row === 4 ? ART_INK.hot : "#1F8A4C"));
                x += w + 2;
            }
        }
        if (artFrame % 2) artBox(c, 8, 23, 2, 3, ART_INK.amber);
    },

    // ACT V. First fights in orbit, stroked like a vector monitor.
    "space-tracer": function (c) {
        artStars(c, 34, 51, ART_INK.mid);
        const hue = "#7DF9FF";
        const ship = (x, y, col) => {
            for (let k = 0; k < 6; k++) { artBox(c, x + k, y - 5 + k, 1, 1, col); artBox(c, x + k, y + 5 - k, 1, 1, col); }
            artBox(c, x, y - 5, 1, 11, col);
        };
        ship(14, 28 + [0, 1, 0, -1][artFrame % 4], hue);
        ship(26, 12, ART_INK.mid);
        ship(24, 44, ART_INK.mid);
        if (artFrame % 3 === 0) artBox(c, 24, 28, 30, 1, ART_INK.hot);
        artCrab(c, 72, 24, 11, { tendrils: 6, phase: 2 });
        [[52, 8, 3], [60, 46, 4], [88, 6, 2]].forEach(a => { artOval(c, a[0], a[1], a[2], a[2], ART_INK.dim); artOval(c, a[0], a[1], a[2] - 1, a[2] - 1, "#000000"); });
    },

    // The Tide, lit only by its own lightning, and the fleet going out to it.
    "gyro-fleet": function (c) {
        artStars(c, 18, 77);
        const flash = artFrame % 11 === 0 || artFrame % 11 === 2;
        artOval(c, 58, 20, 44, 14, flash ? "#3A2440" : "#140B18");
        artOval(c, 40, 16, 20, 9, flash ? "#4A2E52" : "#1B0F20");
        artOval(c, 76, 22, 22, 10, flash ? "#4A2E52" : "#1B0F20");
        if (flash) [[44, 26], [47, 30], [45, 34], [49, 38]].forEach(p => artBox(c, p[0], p[1], 2, 4, ART_INK.hot));
        for (let i = 0; i < 9; i++) {
            const x = 22 + i * 9;
            for (let k = 0; k < 6 + (i % 3) * 3; k++) artBox(c, x + Math.round(Math.sin((artFrame + k + i) * 0.5)), 30 + k, 1, 1, ART_INK.lungDark);
        }
        for (let i = 0; i < 7; i++) {
            const x = 6 + i * 5 + (artFrame % 2), y = 50 - i * 2;
            artBox(c, x, y, 3, 1, i === 3 ? ART_INK.cyan : ART_INK.mid);
            artBox(c, x + 1, y - 1, 1, 1, ART_INK.hot);
        }
    },

    // ---- the two cards on the first screen ----
    "mode-story": function (c) {
        const nodes = [[10, 40], [28, 26], [28, 44], [48, 14], [48, 34], [68, 24], [86, 12]];
        const links = [[0, 1], [0, 2], [1, 3], [1, 4], [2, 4], [3, 5], [4, 5], [5, 6]];
        const at = Math.floor(artFrame / 3) % nodes.length;
        links.forEach(l => {
            const a = nodes[l[0]], b = nodes[l[1]], mx = Math.round((a[0] + b[0]) / 2);
            const lit = l[1] <= at;
            const col = lit ? ART_INK.amber : ART_INK.dim;
            artBox(c, a[0], a[1], mx - a[0], 1, col);
            artBox(c, mx, Math.min(a[1], b[1]), 1, Math.abs(a[1] - b[1]) + 1, col);
            artBox(c, mx, b[1], b[0] - mx, 1, col);
        });
        nodes.forEach((n, i) => {
            artBox(c, n[0] - 3, n[1] - 3, 7, 7, i <= at ? ART_INK.amber : ART_INK.dim);
            artBox(c, n[0] - 2, n[1] - 2, 5, 5, i === at ? ART_INK.hot : "#000000");
        });
        artCrab(c, 84, 34, 6, { tendrils: 3 });
    },

    "mode-free": function (c) {
        for (let r = 0; r < 3; r++) for (let k = 0; k < 5; k++) {
            const i = r * 5 + k;
            const on = Math.floor(artFrame / 2 + artRand(i) * 15) % 15 === i % 15 || (artFrame + i) % 7 === 0;
            artBox(c, 8 + k * 17, 6 + r * 15, 13, 11, on ? ART_INK.cyan : ART_INK.dim);
            artBox(c, 9 + k * 17, 7 + r * 15, 11, 9, on ? "#06323A" : "#000000");
        }
    }
};

// ---------------------------------------------------
//   PAINTING
// ---------------------------------------------------
function artPaintCanvas(canvas) {
    const id = canvas.dataset.art;
    const c = canvas.getContext("2d");
    if (!c) return;
    c.fillStyle = "#000000";
    c.fillRect(0, 0, ART_W, ART_H);

    // A drawn marquee, when the game has one.
    const g = gameById(id);
    if (g && g.art) {
        let img = artImages[id];
        if (!img) {
            img = artImages[id] = new Image();
            img.onload = artRepaint;
            img.src = g.art;
        }
        if (img.complete && img.naturalWidth) { c.imageSmoothingEnabled = false; c.drawImage(img, 0, 0, ART_W, ART_H); return; }
    }

    const scene = ART_SCENES[id];
    if (scene) scene(c);
}

function artRepaint() {
    document.querySelectorAll("canvas[data-art]").forEach(artPaintCanvas);
}

// Started from hub-boot.js. One tracked interval for every canvas on the
// page, so destroy() stops it with everything else.
function startArt() {
    const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    artRepaint();
    if (still) return;
    trackInterval(function () {
        if (document.hidden) return;
        artFrame++;
        artRepaint();
    }, 1000 / ART_FPS);
}
