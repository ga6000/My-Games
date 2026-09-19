// ===================================================
//   RD Arena -- canvas, teardown plumbing, world and camera
// ===================================================
// Split out of RDArena.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 3). Lines 47-102 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, so every load-time statement
// still runs in the sequence it did as one file. The only change is that the
// four-space indent the whole script carried inside <script> was removed;
// there are no multi-line template literals, so that is whitespace-only.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint).
"use strict";

const canvas = document.getElementById('gameCanvas');
const ctx = canvas.getContext('2d');

// ============================================================
// Teardown plumbing.
// Repo hard constraint: every timer goes through trackTimeout /
// trackInterval, every listener through one AbortController, so a
// future destroy() can fully tear this instance down.
// ============================================================
const abortCtl = new AbortController();
const listenOpts = { signal: abortCtl.signal };
const timeoutIds = new Set();
const intervalIds = new Set();
let running = true;

function trackTimeout(fn, ms) {
    const id = setTimeout(() => { timeoutIds.delete(id); fn(); }, ms);
    timeoutIds.add(id);
    return id;
}
function trackInterval(fn, ms) {
    const id = setInterval(fn, ms);
    intervalIds.add(id);
    return id;
}
function destroy() {
    running = false;
    abortCtl.abort();
    timeoutIds.forEach(clearTimeout); timeoutIds.clear();
    intervalIds.forEach(clearInterval); intervalIds.clear();
}

// ============================================================
// World & camera
// v2: four times the area at the same simulation cost --
// cellSize goes 6 -> 12, the RD grid stays 400x400.
// ============================================================
const worldWidth = 4800;
const worldHeight = 4800;
let cameraX = 0;
let cameraY = 0;
let screenShake = 0;

// Blood is painted at half resolution: a full 4800^2 layer would be ~92MB of texture.
const bloodScale = 0.5;
const bloodCanvas = document.createElement('canvas');
bloodCanvas.width = worldWidth * bloodScale;
bloodCanvas.height = worldHeight * bloodScale;
const bloodCtx = bloodCanvas.getContext('2d');

let bloodParticles = [];
let shockwaves = [];
let explosionParticles = [];
let grenades = [];
let floatTexts = [];


// ============================================================
// THE SKIN — tokens read once (AESTHETIC_GUIDE.md §6.4)
// ============================================================
// RASTER cabinet, anchor Space Invaders (1978). §6.4 calls this "the best
// discovery in this review" and it is right: the flesh field was ALREADY
// thresholded at gridB > 0.3, ALREADY filled in one flat colour, and ALREADY on
// a 400x400 grid. It only had to stop drawing itself as overlapping discs.
//
// Read once at load rather than per frame. There is no shifting hue here (that
// is reality-rewrite's trick, not this game's), so nothing re-reads these.
const RDSKIN = {
    ground:  "#000000",
    phosHot: "#E8FFF4",
    phosMid: "#8FA89C",
    phosDim: "#2E3A34",
    amber:   "#FFB000",
    cyan:    "#00E5FF",
    magenta: "#FF2E88",

    // §6.4: "Recolour to #8B0A2E, and add a second band (cells above ~0.6 in a
    // hotter tone) for the two-tone sprite look." The cold tone is this game's
    // --world-hue (viscera) and comes from the token; the hot band is derived
    // from it rather than hardcoded, so changing the token moves both.
    fleshCold: "#8B0A2E",
    fleshHot:  "#D6214E",
    HOT_BAND: 0.6,

    read: function () {
        // READ FROM <body>, NOT <html>. The world hue is selected by
        // [data-game="rd-arena"] in shared/retro.css, and that attribute lives
        // on <body>. Reading documentElement instead resolves --world-hue to
        // the :root default (var(--phos-mid)) and silently paints the entire
        // fleshscape pale grey-green -- which is exactly what happened the first
        // time this ran, and it looks like a design choice rather than a bug.
        // The Signal Three and the phosphors are on :root and inherit down, so
        // reading from body gets those too.
        var cs = getComputedStyle(document.body);
        function tok(name, fallback) {
            var v = cs.getPropertyValue(name);
            v = v ? v.trim() : "";
            return v || fallback;
        }
        this.ground  = tok("--ground",      this.ground);
        this.phosHot = tok("--phos-hot",    this.phosHot);
        this.phosMid = tok("--phos-mid",    this.phosMid);
        this.phosDim = tok("--phos-dim",    this.phosDim);
        this.amber   = tok("--sig-amber",   this.amber);
        this.cyan    = tok("--sig-cyan",    this.cyan);
        this.magenta = tok("--sig-magenta", this.magenta);
        this.fleshCold = tok("--world-hue", this.fleshCold);
        this.fleshHot = this.heat(this.fleshCold, 0.17);
    },

    // Raises a #rrggbb's LIGHTNESS while holding its hue and saturation, so the
    // hot band is the same flesh lit harder rather than a second colour. Used
    // only for that band, so the two tones can never drift apart the way two
    // hardcoded hexes would.
    //
    // The first version of this blended toward white, which is the obvious move
    // and the wrong one: #8B0A2E lifted 45% toward white is #BF788C, a washed
    // dusty pink. It desaturates, and a two-tone SPRITE reads as two
    // brightnesses of one ink, not as one ink and one pastel. Space Invaders'
    // sprites were a single colour per row of the gel; the band here has to look
    // like more of the same substance, not like a different one.
    heat: function (hex, amt) {
        var m = /^#([0-9a-f]{6})$/i.exec(hex || "");
        if (!m) return hex;
        var n = parseInt(m[1], 16);
        var r = ((n >> 16) & 0xff) / 255, g = ((n >> 8) & 0xff) / 255, b = (n & 0xff) / 255;
        var max = Math.max(r, g, b), min = Math.min(r, g, b);
        var l = (max + min) / 2;
        var h = 0, sat = 0;
        if (max !== min) {
            var d = max - min;
            sat = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h /= 6;
        }
        l = Math.min(1, l + amt);

        function hue2rgb(pp, qq, t) {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return pp + (qq - pp) * 6 * t;
            if (t < 1 / 2) return qq;
            if (t < 2 / 3) return pp + (qq - pp) * (2 / 3 - t) * 6;
            return pp;
        }
        var q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat;
        var pcomp = 2 * l - q;
        var rr = Math.round(hue2rgb(pcomp, q, h + 1 / 3) * 255);
        var gg = Math.round(hue2rgb(pcomp, q, h) * 255);
        var bb = Math.round(hue2rgb(pcomp, q, h - 1 / 3) * 255);
        return "#" + ((1 << 24) + (rr << 16) + (gg << 8) + bb).toString(16).slice(1);
    }
};

RDSKIN.read();

// Audio, new 2026-09-05. glide.mp3 sits in this folder UNREFERENCED and stays
// that way: procedural keeps the file:// constraint clean, matches what zombie
// and glass-city-escape already do, and the repo's one sampled-audio game is
// the one with the open freeze bug. configure() namespaces the mute preference
// so muting this game does not mute Zombie.
SFX.configure({ game: "rd-arena" });
SFX.unlockOn(window, abortCtl.signal);

// Up to 40 grunts shoot on their own cooldowns across a 4800x4800 world. Playing
// every one of those is a wall of noise that buries the shot about to kill you,
// so only what is on (or just off) screen is audible. This is a viewport test,
// not the positional distance mix in zombie/ -- that one is a property of that
// game's camera and belongs there.
const SFX_MARGIN = 160;
function audibleRD(x, y) {
    return x > cameraX - SFX_MARGIN && x < cameraX + canvas.width + SFX_MARGIN &&
           y > cameraY - SFX_MARGIN && y < cameraY + canvas.height + SFX_MARGIN;
}
