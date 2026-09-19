// ===================================================
//   Zombie — zone floors (2026-09-18)
// ===================================================
// "Identity of the different areas should be more apparent: a tiling +
// noise map floor tile for each of the areas that corresponds with the
// area names." Until this, every zone was the same black with a faint
// 200px grid, and the only thing telling COLD STORAGE from SLAG HEAP was
// the name that flashes up on the way in.
//
// Each zone template gets a 64x64-texel TILE: a pattern that says what the
// place is (freezer tiles, pool tiles, floorboards, grating...) mixed with
// tileable value noise so no two texels are quite alike. Over all of it
// sits one GRIME map -- a much larger tileable noise field, quantized to
// three hard steps -- so the 128px repeat never reads as wallpaper.
//
// RASTER cabinet rules (AESTHETIC_GUIDE §6.3) are why it looks like this:
//   - texels are drawn 2 world units square with smoothing OFF, so the
//     floor is chunky pixels, never a blur;
//   - every tile keeps to a few flat colours, and noise only ever PICKS
//     between them -- no gradients, and no dithering used as decoration
//     (§4.12); the grime is three flat alpha steps, not a soft shadow;
//   - all of it is DARK. The floor is the ground under a lighting pass
//     that already covers most of the screen; it must never compete with
//     zombies, walls or the HUD.
// A deliberate deviation, noted here and in zombie/CLAUDE.md: §2.5 gives
// each game ONE world hue for its terrain. Zone identity is the point of
// this change, so each floor carries a faint tint of its own.
//
// Cosmetic, and identical for everyone: generated from fixed seeds, never
// from MP.random() (which would shift the level stream) and never from
// Math.random() (two players must be able to say "the blue tiles").
"use strict";

const FLOOR_TEX = 64;            // texels per tile side
const FLOOR_SCALE = 2;           // world units per texel
const FLOOR_GRIME_TEX = 128;
const FLOOR_GRIME_SCALE = 8;     // one grime texel = 8 world units

// A tint per zone for the minimap, so the map shows the same identity.
const ZONE_FLOOR_TINT = {
    cold: "#2B4552", pool: "#135A5C", motor: "#4A4630", laundry: "#4A4436",
    spill: "#1D4A56", kennel: "#5A4520", letter: "#5A3A1C", slag: "#5A2A14",
    ticket: "#44444E", annex: "#2E4A36", pump: "#3E4448", turbine: "#3A4046",
    centre: "#38382F"
};

let zfPatterns = null;           // key -> CanvasPattern
let zfGrime = null;
let zfFailed = false;

function zfRng(seed) {
    let a = seed | 0;
    return function () {
        a = (a + 0x6D2B79F5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// Tileable value noise: a `cells` x `cells` lattice that wraps, smoothly
// interpolated. Returns size*size values in 0..1.
function zfNoise(size, cells, rng) {
    const lat = new Float32Array(cells * cells);
    for (let i = 0; i < lat.length; i++) lat[i] = rng();
    const out = new Float32Array(size * size);
    const step = size / cells;
    for (let y = 0; y < size; y++) {
        const gy = y / step, y0 = Math.floor(gy), fy = gy - y0;
        const sy = fy * fy * (3 - 2 * fy);
        for (let x = 0; x < size; x++) {
            const gx = x / step, x0 = Math.floor(gx), fx = gx - x0;
            const sx = fx * fx * (3 - 2 * fx);
            const x1 = (x0 + 1) % cells, y1 = (y0 + 1) % cells;
            const a = lat[(y0 % cells) * cells + (x0 % cells)];
            const b = lat[(y0 % cells) * cells + x1];
            const c = lat[y1 * cells + (x0 % cells)];
            const d = lat[y1 * cells + x1];
            out[y * size + x] = (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
        }
    }
    return out;
}

// Layered noise, still tileable because every layer's lattice divides the
// tile. Normalized to 0..1.
function zfFbm(size, rng, layers) {
    const out = new Float32Array(size * size);
    let total = 0;
    for (let l = 0; l < layers.length; l++) {
        const n = zfNoise(size, layers[l][0], rng);
        const w = layers[l][1];
        total += w;
        for (let i = 0; i < out.length; i++) out[i] += n[i] * w;
    }
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < out.length; i++) { out[i] /= total; if (out[i] < lo) lo = out[i]; if (out[i] > hi) hi = out[i]; }
    const span = (hi - lo) || 1;
    for (let i = 0; i < out.length; i++) out[i] = (out[i] - lo) / span;
    return out;
}

function zfHex(h) {
    return [parseInt(h.substr(1, 2), 16), parseInt(h.substr(3, 2), 16), parseInt(h.substr(5, 2), 16)];
}

// Noise PICKS a palette entry -- quantized, never blended.
function zfPick(pal, v) {
    return pal[Math.min(pal.length - 1, Math.floor(v * pal.length))];
}

// Each painter fills a 64x64 array of [r,g,b] from its zone's idea of a
// floor. `n` and `m` are two independent noise fields; `rng` is for
// scattered details (cracks, straw, paper, rust).
const ZF_PAINTERS = {
    // Freezer tiles, frost in the grout.
    cold: function (px, n, m) {
        const tile = [zfHex("#0E1820"), zfHex("#112029"), zfHex("#15252E")];
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            const grout = (x % 16 === 0) || (y % 16 === 0);
            let c = grout ? zfHex("#070C10") : zfPick(tile, n[i]);
            if (m[i] > 0.83) c = zfHex("#223A46");
            px(x, y, c);
        }
    },
    // Small pool tiles, cracked and dry.
    pool: function (px, n, m, rng) {
        const tile = [zfHex("#0B2224"), zfHex("#0E292B"), zfHex("#113133")];
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            px(x, y, (x % 8 === 0 || y % 8 === 0) ? zfHex("#051110") : zfPick(tile, n[i]));
        }
        for (let k = 0; k < 5; k++) {
            let x = Math.floor(rng() * FLOOR_TEX), y = Math.floor(rng() * FLOOR_TEX);
            for (let s = 0; s < 22; s++) {
                px(x, y, zfHex("#031010"));
                x += Math.floor(rng() * 3) - 1;
                y += rng() < 0.7 ? 1 : 0;
            }
        }
    },
    // Oil-stained concrete and one faded bay line.
    motor: function (px, n, m) {
        const conc = [zfHex("#151517"), zfHex("#19191B"), zfHex("#1D1D20")];
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            let c = zfPick(conc, n[i]);
            if (m[i] > 0.72) c = zfHex("#0B0B0E");
            if ((x === 30 || x === 31) && n[i] > 0.25) c = zfHex("#3A3316");
            px(x, y, c);
        }
    },
    // Worn linoleum checkerboard.
    laundry: function (px, n) {
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            const light = ((x >> 3) + (y >> 3)) & 1;
            const worn = n[i] > 0.7;
            px(x, y, light ? zfHex(worn ? "#17150F" : "#1D1B16") : zfHex(worn ? "#151410" : "#111010"));
        }
    },
    // Wet concrete, water running across it, a drain grate.
    spill: function (px, n, m) {
        const base = [zfHex("#0D1416"), zfHex("#0F1719"), zfHex("#121B1E")];
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            // Streaks: the noise read stretched along x.
            const s = m[y * FLOOR_TEX + ((x >> 3) << 3)];
            let c = zfPick(base, n[i]);
            if (s > 0.66) c = zfHex(s > 0.84 ? "#173038" : "#12262E");
            if (x >= 48 && x < 60 && y >= 48 && y < 60) c = ((x + y) % 3 === 0) ? zfHex("#050708") : zfHex("#22292C");
            px(x, y, c);
        }
    },
    // Packed dirt and straw.
    kennel: function (px, n, m, rng) {
        const dirt = [zfHex("#140E08"), zfHex("#1A130B"), zfHex("#20180F")];
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            px(x, y, zfPick(dirt, n[y * FLOOR_TEX + x]));
        }
        for (let k = 0; k < 46; k++) {
            let x = Math.floor(rng() * FLOOR_TEX), y = Math.floor(rng() * FLOOR_TEX);
            const dx = rng() < 0.5 ? 1 : -1, len = 3 + Math.floor(rng() * 3);
            for (let s = 0; s < len; s++) { px(x, y, zfHex(k % 3 ? "#3A2E14" : "#4A3B18")); x += dx; y += 1; }
        }
    },
    // Floorboards, and the post nobody delivered.
    letter: function (px, n, m, rng) {
        const wood = [zfHex("#1A110A"), zfHex("#1E140C"), zfHex("#22170E")];
        for (let y = 0; y < FLOOR_TEX; y++) {
            const row = y >> 3;
            const joint = (row * 23) % 64;
            for (let x = 0; x < FLOOR_TEX; x++) {
                const i = y * FLOOR_TEX + x;
                let c = zfPick(wood, (n[i] + (row % 3) * 0.2) % 1);
                if (y % 8 === 0 || x === joint || x === (joint + 32) % 64) c = zfHex("#0D0804");
                else if (m[(y & ~1) * FLOOR_TEX + x] > 0.8) c = zfHex("#150D07");
                px(x, y, c);
            }
        }
        for (let k = 0; k < 6; k++) {
            const x = Math.floor(rng() * 60), y = Math.floor(rng() * 61);
            for (let a = 0; a < 4; a++) for (let b = 0; b < 3; b++) px(x + a, y + b, zfHex("#34332D"));
        }
    },
    // Rubble and slag with embers still in it.
    slag: function (px, n, m, rng) {
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            const v = n[i];
            let c = v < 0.33 ? zfHex("#0B0908") : v < 0.66 ? zfHex("#141110") : zfHex("#1C1714");
            if (m[i] > 0.9) c = zfHex("#5A1E0A");
            px(x, y, c);
        }
        for (let k = 0; k < 7; k++) px(Math.floor(rng() * FLOOR_TEX), Math.floor(rng() * FLOOR_TEX), zfHex("#8A2E10"));
    },
    // Big terrazzo tiles.
    ticket: function (px, n, m, rng) {
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            let c = (x % 32 === 0 || y % 32 === 0) ? zfHex("#0B0B0D") : (n[i] > 0.5 ? zfHex("#1B1B1F") : zfHex("#18181C"));
            px(x, y, c);
        }
        const chips = [zfHex("#26262C"), zfHex("#111114"), zfHex("#2D2A24")];
        for (let k = 0; k < 150; k++) {
            const x = Math.floor(rng() * FLOOR_TEX), y = Math.floor(rng() * FLOOR_TEX);
            if (x % 32 === 0 || y % 32 === 0) continue;
            px(x, y, chips[k % 3]);
        }
    },
    // Office carpet tiles, the pile turned on alternate squares.
    annex: function (px, n) {
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            const flip = ((x >> 4) + (y >> 4)) & 1;
            const stripe = ((flip ? x : y) & 1) === 0;
            let c = stripe ? zfHex("#141A16") : zfHex("#111613");
            if (n[i] > 0.82) c = zfHex("#18201A");
            if (x % 16 === 0 || y % 16 === 0) c = zfHex("#0D110E");
            px(x, y, c);
        }
    },
    // Diamond plate, rusting.
    pump: function (px, n, m) {
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            let c = n[i] > 0.5 ? zfHex("#181B1E") : zfHex("#16191C");
            const cx = x % 8, cy = y % 8;
            const odd = ((x >> 3) + (y >> 3)) & 1;
            if (odd ? (cx === cy && cx > 1 && cx < 6) : (cx + cy === 7 && cx > 1 && cx < 6)) c = zfHex("#343A3F");
            else if (odd ? (cx === cy + 1 && cx > 2 && cx < 7) : (cx + cy === 8 && cx > 2 && cx < 7)) c = zfHex("#0E1012");
            // Rust, kept brown and sparse: redder and it read as blood.
            if (m[i] > 0.9) c = zfHex("#2A1C12");
            px(x, y, c);
        }
    },
    // Steel grating over a dark pit.
    turbine: function (px, n) {
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            const cx = x % 8, cy = y % 8;
            let c = zfHex("#07080A");
            if (cx < 2 || cy < 2) c = n[i] > 0.6 ? zfHex("#262B2F") : zfHex("#22262A");
            if (cx === 0 || cy === 0) c = zfHex("#30353A");
            px(x, y, c);
        }
    },
    // Concrete block, running bond: the keep.
    centre: function (px, n) {
        for (let y = 0; y < FLOOR_TEX; y++) {
            const course = y >> 4;
            const off = (course & 1) ? 16 : 0;
            for (let x = 0; x < FLOOR_TEX; x++) {
                const i = y * FLOOR_TEX + x;
                const mortar = y % 16 === 0 || ((x + off) % 32 === 0);
                px(x, y, mortar ? zfHex("#0D0D0C") : zfPick([zfHex("#171715"), zfHex("#1A1A18"), zfHex("#1D1D1B")], n[i]));
            }
        }
    },
    // Wet stone slabs and old blood: the sluice and the funnel halls.
    drain: function (px, n, m) {
        for (let y = 0; y < FLOOR_TEX; y++) for (let x = 0; x < FLOOR_TEX; x++) {
            const i = y * FLOOR_TEX + x;
            let c = (x % 16 === 0 || y % 16 === 0) ? zfHex("#060808") : (n[i] > 0.5 ? zfHex("#101416") : zfHex("#0D1113"));
            if (m[i] > 0.8) c = zfHex("#2A0C0C");
            px(x, y, c);
        }
    }
};

function zfTileCanvas(key, seed) {
    const data = new Uint8ClampedArray(FLOOR_TEX * FLOOR_TEX * 4);
    const px = function (x, y, c) {
        x = ((x % FLOOR_TEX) + FLOOR_TEX) % FLOOR_TEX;
        y = ((y % FLOOR_TEX) + FLOOR_TEX) % FLOOR_TEX;
        const o = (y * FLOOR_TEX + x) * 4;
        data[o] = c[0]; data[o + 1] = c[1]; data[o + 2] = c[2]; data[o + 3] = 255;
    };
    const rng = zfRng(seed);
    const n = zfFbm(FLOOR_TEX, rng, [[4, 0.6], [8, 0.3], [16, 0.1]]);
    const m = zfFbm(FLOOR_TEX, rng, [[4, 0.5], [16, 0.5]]);
    ZF_PAINTERS[key](px, n, m, rng);

    const src = document.createElement("canvas");
    src.width = FLOOR_TEX;
    src.height = FLOOR_TEX;
    const sg = src.getContext("2d");
    const img = sg.createImageData(FLOOR_TEX, FLOOR_TEX);
    img.data.set(data);
    sg.putImageData(img, 0, 0);

    // Upscaled once with smoothing off, so the texels stay square however
    // the main canvas samples it.
    const big = document.createElement("canvas");
    big.width = FLOOR_TEX * FLOOR_SCALE;
    big.height = FLOOR_TEX * FLOOR_SCALE;
    const bg = big.getContext("2d");
    bg.imageSmoothingEnabled = false;
    bg.drawImage(src, 0, 0, big.width, big.height);
    return big;
}

// The noise map over everything: three flat steps of black, no blend.
function zfGrimeCanvas() {
    const size = FLOOR_GRIME_TEX;
    const rng = zfRng(90210);
    const n = zfFbm(size, rng, [[4, 0.55], [8, 0.3], [32, 0.15]]);
    const src = document.createElement("canvas");
    src.width = size;
    src.height = size;
    const g = src.getContext("2d");
    const img = g.createImageData(size, size);
    for (let i = 0; i < n.length; i++) {
        const v = n[i];
        const a = v < 0.5 ? 0 : v < 0.64 ? 34 : v < 0.78 ? 62 : 92;
        img.data[i * 4 + 3] = a;             // black, at one of three alphas
    }
    g.putImageData(img, 0, 0);
    return src;
}

function zfBuild() {
    zfPatterns = {};
    try {
        const keys = Object.keys(ZF_PAINTERS);
        for (let i = 0; i < keys.length; i++) {
            zfPatterns[keys[i]] = ctx.createPattern(zfTileCanvas(keys[i], 1009 * (i + 1)), "repeat");
        }
        const grimeSrc = zfGrimeCanvas();
        const pat = ctx.createPattern(grimeSrc, "repeat");
        // Scale the grime up in the pattern itself where the browser can;
        // otherwise pre-scale it (4x, a smaller repeat, still fine).
        if (pat && typeof pat.setTransform === "function" && typeof DOMMatrix === "function") {
            pat.setTransform(new DOMMatrix([FLOOR_GRIME_SCALE, 0, 0, FLOOR_GRIME_SCALE, 0, 0]));
            zfGrime = pat;
        } else {
            const big = document.createElement("canvas");
            big.width = big.height = FLOOR_GRIME_TEX * 4;
            const bg = big.getContext("2d");
            bg.imageSmoothingEnabled = false;
            bg.drawImage(grimeSrc, 0, 0, big.width, big.height);
            zfGrime = ctx.createPattern(big, "repeat");
        }
    } catch (e) {
        // A floor is never worth a crash; fall back to the plain ground.
        zfFailed = true;
    }
}

// Clip a rect to the view, return null if nothing is on screen.
function zfClip(x, y, w, h, vr) {
    const x0 = Math.max(x, vr.x - 8), y0 = Math.max(y, vr.y - 8);
    const x1 = Math.min(x + w, vr.x + vr.w + 8), y1 = Math.min(y + h, vr.y + vr.h + 8);
    if (x1 <= x0 || y1 <= y0) return null;
    return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

// Drawn in WORLD space, straight after the clear. Patterns anchor to the
// transformed origin, i.e. world (0,0), so the floor is fixed to the map
// and does not swim as the camera pans.
function drawZoneFloors(vr) {
    if (!zfPatterns && !zfFailed) zfBuild();
    if (zfFailed || !zfPatterns) return false;
    const prevSmooth = ctx.imageSmoothingEnabled;
    ctx.imageSmoothingEnabled = false;

    for (let z = 0; z < ZONE_COLS * ZONE_ROWS; z++) {
        const b = zoneBounds(z);
        const r = zfClip(b.x, b.y, b.w, b.h, vr);
        if (!r) continue;
        const key = zoneInfo[z] && zoneInfo[z].tpl ? zoneInfo[z].tpl.key : "centre";
        ctx.fillStyle = zfPatterns[key] || zfPatterns.centre;
        ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    // The sluice room and the funnel halls are the same kind of place --
    // drains -- whatever zone they stand in.
    const special = [];
    if (sluiceRoom) special.push(sluiceRoom);
    for (let i = 0; i < funnelHalls.length; i++) if (funnelHalls[i]) special.push(funnelHalls[i]);
    ctx.fillStyle = zfPatterns.drain;
    for (let i = 0; i < special.length; i++) {
        const s = special[i];
        const r = zfClip(s.x, s.y, s.w, s.h, vr);
        if (r) ctx.fillRect(r.x, r.y, r.w, r.h);
    }

    if (zfGrime) {
        const r = zfClip(0, 0, WORLD_W, WORLD_H, vr);
        if (r) {
            ctx.fillStyle = zfGrime;
            ctx.fillRect(r.x, r.y, r.w, r.h);
        }
    }
    ctx.imageSmoothingEnabled = prevSmooth;
    return true;
}
