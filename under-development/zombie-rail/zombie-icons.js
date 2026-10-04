// ===================================================
//   Zombie — icons (2026-09-18)
// ===================================================
// Pixel bitmaps for every perk and every gun. The playtest asked for "its
// own unique icon that corresponds to its function (don't use emojis)" --
// so no glyphs, no fonts: each icon is a grid of characters drawn once
// into a canvas at load and reused. The world draws the canvases
// (drawImage, crisp), the DOM HUD uses the same pixels as data URLs.
//
//   '#' = the icon's colour     '+' = a hot highlight     '.' = empty
//
// Two colours plus black, the RASTER cabinet's budget (AESTHETIC_GUIDE §6.3).
// Perks read in the world hue, guns in the system cyan, matching how the
// HUD already maps them (Zombie.html's token comment).
"use strict";

const ICON_WORLD_HUE = "#FF4A1C";   // --world-hue for data-game="zombie"
const ICON_CYAN = "#00E5FF";        // --sig-cyan
const ICON_HOT = "#E8FFF4";         // --phos-hot
const ICON_DIM = "#3A3A3A";

// 12x12, one per perk. Each is drawn from what the perk DOES.
const ICON_PERK_ROWS = {
    // Fast-forward: fire rate.
    overdrive: [
        "............",
        "#.....#.....",
        "##....##....",
        "###...###...",
        "####..####..",
        "#####.#####+",
        "#####.#####+",
        "####..####..",
        "###...###...",
        "##....##....",
        "#.....#.....",
        "............"
    ],
    // A cog: scrap.
    scavenger: [
        ".....##.....",
        "..#.####.#..",
        ".##########.",
        "..###..###..",
        ".###....###.",
        "####.++.####",
        "####.++.####",
        ".###....###.",
        "..###..###..",
        ".##########.",
        "..#.####.#..",
        ".....##....."
    ],
    // A round glancing off a wall.
    ricochet: [
        "..........##",
        "##........##",
        "..##......##",
        "....##....##",
        "......##..##",
        "........+###",
        "......##..##",
        "....##....##",
        "..##......##",
        "###.......##",
        "##........##",
        "#.........##"
    ],
    // The ping marker, with rings: a lure.
    decoy: [
        ".....++.....",
        ".....##.....",
        ".....##.....",
        "...######...",
        "..#......#..",
        ".#..####..#.",
        ".#..#++#..#.",
        ".#..#++#..#.",
        ".#..####..#.",
        "..#......#..",
        "...######...",
        "............"
    ],
    // A skull: what going down costs them.
    spite: [
        "............",
        "...######...",
        "..########..",
        ".##########.",
        ".#..####..#.",
        ".#+.####.+#.",
        ".##########.",
        "..###..###..",
        "...######...",
        "...#.##.#...",
        "...######...",
        "............"
    ],
    // A bolt in a floor plate: traps.
    conductor: [
        "############",
        "#..........#",
        "#......++..#",
        "#.....++...#",
        "#....++....#",
        "#...++++++.#",
        "#.....++...#",
        "#....++....#",
        "#...++.....#",
        "#..........#",
        "############",
        "............"
    ],
    // Forked lightning: it jumps.
    arc: [
        ".......##...",
        "......##....",
        ".....##.....",
        "....##......",
        "...#######..",
        "......##....",
        ".....##.#...",
        "....##...#..",
        "...##.....#.",
        "..##.......+",
        ".+..........",
        "............"
    ],
    // A starburst: they go off.
    blastcap: [
        ".....#......",
        ".#...#...#..",
        "..#..#..#...",
        "...#.#.#....",
        "....+++.....",
        "####+++####.",
        "....+++.....",
        "...#.#.#....",
        "..#..#..#...",
        ".#...#...#..",
        ".....#......",
        "............"
    ],
    // One shaft through two heads: pierce.
    skewer: [
        "............",
        "............",
        ".##...##....",
        "####.####.#.",
        "####.####.##",
        "++++++++++++",
        "####.####.##",
        "####.####.#.",
        ".##...##....",
        "............",
        "............",
        "............"
    ],
    // A gun over a down-chevron: firing while downed.
    laststand: [
        "............",
        "..########+.",
        "..#########.",
        "..#####.....",
        "..###.#.....",
        "..###.......",
        "............",
        ".#........#.",
        "..#......#..",
        "...#....#...",
        "....#..#....",
        ".....##....."
    ],
    // A cartridge and a plus: ammo back.
    salvage: [
        "....##......",
        "...####.....",
        "...####.....",
        "...####.....",
        "...####..+..",
        "...####.+++.",
        "...####..+..",
        "..######....",
        "..######....",
        "..######....",
        "............",
        "............"
    ]
};

// 24x8 side-on silhouettes, muzzle to the right.
const ICON_GUN_ROWS = {
    pistol: [
        "........................",
        "....#############.......",
        "....##############......",
        "....#############.......",
        "....#####...............",
        "....####.#..............",
        "....####................",
        "........................"
    ],
    rifle: [
        "............##..........",
        "###.####################",
        "########################",
        "######..####............",
        "#####....#..#...........",
        "####.....##.............",
        "###.....................",
        "........................"
    ],
    shotgun: [
        "........................",
        "##..###################.",
        "#######################+",
        "######..########........",
        "#####....#####..........",
        "####....................",
        "###.....................",
        "........................"
    ],
    smg: [
        "........................",
        "......###############...",
        "....#################+..",
        "....#######...##........",
        "....######....##........",
        ".....####.....##........",
        ".....###......##........",
        "..............##........"
    ],
    sniper: [
        "........#######.........",
        ".........#####..........",
        "#######################+",
        "#######.................",
        "######..................",
        "#####...................",
        "####....................",
        "........................"
    ],
    rocket: [
        "........................",
        "..##################....",
        ".####################+..",
        "######################++",
        ".####################+..",
        "..#####.#####...........",
        "......#.....#...........",
        "........................"
    ],
    flamer: [
        "........................",
        ".....#############......",
        "..###############.+.+...",
        ".################+++....",
        ".###.......###..+.+.....",
        ".###....................",
        ".###....................",
        "........................"
    ]
};

// Everything else that needs a pixel symbol.
const ICON_MISC_ROWS = {
    // The generator. It used to print U+26A1, which is an emoji on most
    // systems -- a colour picture in the middle of a four-colour screen.
    power: [
        "......###...",
        ".....###....",
        "....###.....",
        "...###......",
        "..########..",
        "......###...",
        ".....###....",
        "....###.....",
        "...###......",
        "..##........",
        ".#..........",
        "............"
    ]
};

let iconCache = {};

// One canvas per (bitmap, colour). Cached, so asking every frame is free.
function iconCanvas(rows, main, hot, cacheKey) {
    const k = cacheKey + "|" + main + "|" + hot;
    if (iconCache[k]) return iconCache[k];
    const h = rows.length;
    const w = rows[0].length;
    const c = document.createElement("canvas");
    c.width = w;
    c.height = h;
    const g = c.getContext("2d");
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const ch = rows[y].charAt(x);
            if (ch === "#") g.fillStyle = main;
            else if (ch === "+") g.fillStyle = hot;
            else continue;
            g.fillRect(x, y, 1, 1);
        }
    }
    iconCache[k] = c;
    return c;
}

function perkIcon(key, color) {
    const rows = ICON_PERK_ROWS[key];
    if (!rows) return null;
    return iconCanvas(rows, color || ICON_WORLD_HUE, ICON_HOT, "p:" + key);
}

function gunIcon(key, color) {
    const rows = ICON_GUN_ROWS[key];
    if (!rows) return null;
    return iconCanvas(rows, color || ICON_CYAN, ICON_HOT, "g:" + key);
}

function miscIcon(key, color) {
    const rows = ICON_MISC_ROWS[key];
    if (!rows) return null;
    return iconCanvas(rows, color || ICON_HOT, ICON_HOT, "m:" + key);
}

// Data URLs for the DOM HUD and the field manual, built on first ask.
let iconUrlCache = {};

function iconUrl(kind, key, color) {
    const k = kind + ":" + key + ":" + (color || "");
    if (iconUrlCache[k] !== undefined) return iconUrlCache[k];
    let url = "";
    try {
        const c = kind === "gun" ? gunIcon(key, color) : perkIcon(key, color);
        url = c ? c.toDataURL() : "";
    } catch (e) { url = ""; }
    iconUrlCache[k] = url;
    return url;
}

// An <img> tag for the HUD / manual. `scale` multiplies the bitmap size;
// image-rendering: pixelated (Zombie.html) keeps it square-edged.
function iconImg(kind, key, scale, color, cls) {
    const rows = kind === "gun" ? ICON_GUN_ROWS[key] : ICON_PERK_ROWS[key];
    if (!rows) return "";
    const s = scale || 2;
    return "<img class='" + (cls || "pix") + "' alt='' src='" + iconUrl(kind, key, color) +
           "' width='" + (rows[0].length * s) + "' height='" + (rows.length * s) + "'>";
}
