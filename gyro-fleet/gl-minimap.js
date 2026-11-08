// ===================================================
//   Gravity Lab — 8-bit mini-map (M), four levels
// ===================================================
// Added 2026-09-10 with two ranges; four levels since the world became the
// real-scale Milky Way (2026-09-11, GALAXY_PLAN.md):
//
//   PLANET  2 AU across the focus — planets, MOONS and their orbits, holes.
//   SYSTEM  100 AU — whole systems: orbits, belts, stars (binaries show both).
//   LOCAL   radius mmLocalLy (25 ly) — every star ONE point in its class
//           colour, holes dim, read from the chunk SUMMARIES so unloaded space
//           shows; a nearest-7 list with distances underneath.
//   GALAXY  the whole disk — the density formula rendered once, with SGR A,
//           SOL and you. The spiral.
//
// Scroll over the map to step: down = out, up = in (throttled — a trackpad
// sends a burst of events per gesture).
//
// Drawn onto small canvases at exactly 2× with smoothing off — integer scaling
// keeps every map pixel a crisp square — using integer fillRects, a small
// palette and a hand-drawn 3×5 pixel font. Redrawn at 15 Hz.
"use strict";

const GL_MM_RES = 128;           // map pixels per side
const GL_MM_SCALE = 2;           // integer upscale → 256 screen px
const GL_MM_LIST_H = 54;         // star list strip under the LOCAL map
const GL_MM_LEVELS = ["planet", "system", "local", "galaxy"];

const glMMCanvas = document.createElement("canvas");
glMMCanvas.width = GL_MM_RES;
glMMCanvas.height = GL_MM_RES;
const glMMCtx = glMMCanvas.getContext("2d");
const glMMCanvasMax = document.createElement("canvas");
glMMCanvasMax.width = GL_MM_RES;
glMMCanvasMax.height = GL_MM_RES + GL_MM_LIST_H;
const glMMCtxMax = glMMCanvasMax.getContext("2d");
let glMMGalaxyImg = null;         // the rendered spiral, built once on first use

let glMMTick = 0;
let glMMMode = "system";
let glMMStepT = 0;                // last level step (trackpad throttle)
let glMMRect = null;              // on-screen rectangle, for wheel/click hit tests
let glMMc = glMMCtx;              // the canvas the helpers are currently drawing into
const glMMView = { x0: 0, y0: 0, span: 1 };
let glMMStarCount = 0;            // stars within the LOCAL radius at the last render

const GL_MM_PAL = {
    bg: "#000000", grid: "#0B1B2B", frame: "#3A6EA5",
    loaded: "#07121C", home: "#0C170E",
    well: "#3A1648", hole: "#1A0626", holeRim: "#FF2E88", holePt: "#B03AC0",
    orbit: "#16303E", belt: "#3A3A30", view: "#E8FFF4", text: "#E8FFF4", dim: "#6D8582",
    ship: "#9FF5D8", sel: "#FFB000", you: "#7DF9FF", range: "#16303E"
};

// 3×5 glyphs, row-major, "1" = lit.
const GL_FONT_3X5 = {
    A: "010101111101101", B: "110101110101110", C: "011100100100011", D: "110101101101110",
    E: "111100110100111", F: "111100110100100", G: "011100101101011", H: "101101111101101",
    I: "111010010010111", J: "001001001101010", K: "101101110101101", L: "100100100100111",
    M: "101111111101101", N: "110101101101101", O: "010101101101010", P: "110101110100100",
    Q: "010101101011001", R: "110101110101101", S: "011100010001110", T: "111010010010010",
    U: "101101101101111", V: "101101101101010", W: "101101111111101", X: "101101010101101",
    Y: "101101010010010", Z: "111001010100111",
    "0": "111101101101111", "1": "010110010010111", "2": "110001010100111", "3": "110001010001110",
    "4": "101101111001001", "5": "111100110001110", "6": "011100111101111", "7": "111001010010010",
    "8": "111101111101111", "9": "111101111001110", "-": "000000111000000", " ": "000000000000000",
    ".": "000000000000010"
};

function glMMText(str, x, y, col) {
    glMMc.fillStyle = col;
    for (let i = 0; i < str.length; i++) {
        const g = GL_FONT_3X5[str[i].toUpperCase()] || GL_FONT_3X5[" "];
        for (let p = 0; p < 15; p++) {
            if (g[p] === "1") glMMc.fillRect(x + i * 4 + (p % 3), y + Math.floor(p / 3), 1, 1);
        }
    }
}

// Text on a black backing, so a header stays readable over a star or a hole.
function glMMLabel(str, x, y, col) {
    glMMc.fillStyle = GL_MM_PAL.bg;
    glMMc.fillRect(x - 1, y - 1, str.length * 4 + 1, 7);
    glMMText(str, x, y, col);
}

function glMMPos(wx, wy) {
    return {
        x: Math.floor((wx - glMMView.x0) / glMMView.span * GL_MM_RES),
        y: Math.floor((wy - glMMView.y0) / glMMView.span * GL_MM_RES)
    };
}
function glMMLen(w) { return w / glMMView.span * GL_MM_RES; }

function glMMDisc(cx, cy, r, col) {
    glMMc.fillStyle = col;
    const ri = Math.ceil(r);
    for (let dy = -ri; dy <= ri; dy++) {
        for (let dx = -ri; dx <= ri; dx++) {
            if (dx * dx + dy * dy <= r * r + 0.5) glMMc.fillRect(cx + dx, cy + dy, 1, 1);
        }
    }
}

// Pixel circle by angle stepping; `every` > 1 gives the dotted 8-bit ring.
function glMMRing(cx, cy, r, col, every) {
    if (r < 1 || r > GL_MM_RES * 4) return;
    glMMc.fillStyle = col;
    const n = Math.max(12, Math.ceil(Math.PI * 2 * r));
    for (let i = 0; i < n; i += every) {
        const a = i / n * Math.PI * 2;
        glMMc.fillRect(Math.round(cx + Math.cos(a) * r), Math.round(cy + Math.sin(a) * r), 1, 1);
    }
}

function glMMBorder(h) {
    const N = GL_MM_RES;
    glMMc.fillStyle = GL_MM_PAL.frame;
    glMMc.fillRect(0, 0, N, 1); glMMc.fillRect(0, h - 1, N, 1);
    glMMc.fillRect(0, 0, 1, h); glMMc.fillRect(N - 1, 0, 1, h);
}

// Distances the 3×5 font can spell: AU inside ~0.05 ly, LY beyond.
function glMMFmt(d) {
    if (d < 0.05 * GL_LY) {
        const au = d / GL_AU;
        return (au < 10 ? au.toFixed(2) : au < 1000 ? au.toFixed(0) : Math.round(au / 1000) + "K") + "AU";
    }
    const ly = d / GL_LY;
    return (ly < 10 ? ly.toFixed(2) : ly < 1000 ? ly.toFixed(1) : Math.round(ly / 1000) + "K") + "LY";
}

function glMMShips() {
    const blink = Math.floor(performance.now() / 250) % 2 === 0;
    for (let i = 0; i < glShips.length; i++) {
        const s = glShips[i];
        if (!s.isAlive) continue;
        const p = glMMPos(s.x, s.y);
        if (s === glShip) {
            glMMc.fillStyle = blink ? GL_MM_PAL.you : GL_MM_PAL.text;
            glMMc.fillRect(p.x, p.y, 2, 2);
        } else {
            glMMc.fillStyle = s.selected ? GL_MM_PAL.sel : GL_MM_PAL.ship;
            glMMc.fillRect(p.x, p.y, 1, 1);
        }
    }
}

// ---- PLANET / SYSTEM: loaded detail around the focus ----------------------
function glRenderMinimapDetail(span, label, moons) {
    glMMc = glMMCtx;
    const c = glMMc, N = GL_MM_RES;
    const fp = glFocusPoint();
    glMMView.span = span;
    glMMView.x0 = fp.x - span / 2;
    glMMView.y0 = fp.y - span / 2;
    c.fillStyle = GL_MM_PAL.bg;
    c.fillRect(0, 0, N, N);

    for (let i = 0; i < glStarSystems.length; i++) {
        const sys = glStarSystems[i];
        const cp = glMMPos(sys.centre.x, sys.centre.y), reachPx = glMMLen(sys.reach);
        if (cp.x < -reachPx || cp.y < -reachPx || cp.x > N + reachPx || cp.y > N + reachPx) continue;
        // Belts: two dotted bounds.
        for (let j = 0; j < sys.belts.length; j++) {
            const bt = sys.belts[j], hp = glMMPos(bt.host.x, bt.host.y);
            glMMRing(hp.x, hp.y, glMMLen(bt.rIn), GL_MM_PAL.belt, 2);
            glMMRing(hp.x, hp.y, glMMLen(bt.rOut), GL_MM_PAL.belt, 2);
        }
        // Orbits about each body's own parent, then the bodies.
        for (let j = 0; j < sys.order.length; j++) {
            const b = sys.order[j];
            if (!b.parent || !(b.orbitR > 0) || (b.kind === "moon" && !moons)) continue;
            const pp = glMMPos(b.parent.x, b.parent.y);
            glMMRing(pp.x, pp.y, glMMLen(b.orbitR), GL_MM_PAL.orbit, 3);
        }
        for (let j = 0; j < sys.order.length; j++) {
            const b = sys.order[j];
            if (b.kind === "moon" && !moons) continue;
            const p = glMMPos(b.x, b.y);
            c.fillStyle = b.color;
            if (b.kind === "star") {
                c.fillRect(p.x - 1, p.y, 3, 1);
                c.fillRect(p.x, p.y - 1, 1, 3);
            } else {
                const r = glMMLen(b.rs);
                if (r > 1) glMMDisc(p.x, p.y, r, b.color); else c.fillRect(p.x, p.y, 1, 1);
            }
        }
        const w = sys.name.length * 4 - 1, sp = glMMPos(sys.star.x, sys.star.y);
        glMMText(sys.name, Math.max(1, Math.min(N - w - 1, sp.x - Math.floor(w / 2))),
                 sp.y + 3 < N - 6 ? sp.y + 3 : sp.y - 7, sys.star.color);
    }

    // Holes: dotted influence ring, dark disc at true scale (never below 1px),
    // magenta rim so a 1px hole still shows.
    for (let i = 0; i < glHoles.length; i++) {
        const h = glHoles[i];
        const p = glMMPos(h.x, h.y);
        const wr = glMMLen(h.wellRadius);
        if (p.x < -wr - 2 || p.y < -wr - 2 || p.x > N + wr + 2 || p.y > N + wr + 2) continue;
        glMMRing(p.x, p.y, wr, GL_MM_PAL.well, 2);
        const r = Math.max(1, glMMLen(h.rs));
        glMMDisc(p.x, p.y, r, GL_MM_PAL.hole);
        glMMRing(p.x, p.y, r + 0.5, GL_MM_PAL.holeRim, 1);
    }

    // The camera's view.
    const vw = glW / 2 / glCamera.zoom, vh = glH / 2 / glCamera.zoom;
    const a = glMMPos(glCamera.x - vw, glCamera.y - vh), b = glMMPos(glCamera.x + vw, glCamera.y + vh);
    const x0 = Math.max(0, a.x), y0 = Math.max(0, a.y), x1 = Math.min(N - 1, b.x), y1 = Math.min(N - 1, b.y);
    if (x1 >= x0 && y1 >= y0 && (x1 - x0 < N - 2 || y1 - y0 < N - 2)) {
        c.fillStyle = GL_MM_PAL.view;
        c.globalAlpha = 0.55;
        c.fillRect(x0, y0, x1 - x0 + 1, 1); c.fillRect(x0, y1, x1 - x0 + 1, 1);
        c.fillRect(x0, y0, 1, y1 - y0 + 1); c.fillRect(x1, y0, 1, y1 - y0 + 1);
        c.globalAlpha = 1;
    }

    glMMShips();
    glMMBorder(N);
    glMMLabel(label, 3, 3, GL_MM_PAL.frame);
}

// ---- LOCAL: stars from summaries, nearest list ---------------------------
function glRenderMinimapLocal() {
    glMMc = glMMCtxMax;
    const c = glMMc, N = GL_MM_RES;
    const rLy = GLP.v.mmLocalLy, R = rLy * GL_LY;
    const fp = glFocusPoint();
    glMMView.span = R * 2;
    glMMView.x0 = fp.x - R;
    glMMView.y0 = fp.y - R;
    c.fillStyle = GL_MM_PAL.bg;
    c.fillRect(0, 0, N, N + GL_MM_LIST_H);
    glMMRing(N / 2, N / 2, N / 2 - 0.5, GL_MM_PAL.range, 3);

    const list = glStarsNear(fp.x, fp.y, rLy);
    for (let i = 0; i < list.length; i++) {
        const st = list[i], p = glMMPos(st.x, st.y);
        c.fillStyle = st.bh ? GL_MM_PAL.holePt : st.color;
        c.fillRect(p.x, p.y, 1, 1);
    }
    glMMShips();
    const fc = glMMPos(fp.x, fp.y);
    c.fillStyle = GL_MM_PAL.view;
    c.fillRect(fc.x - 2, fc.y, 2, 1); c.fillRect(fc.x + 1, fc.y, 2, 1);
    c.fillRect(fc.x, fc.y - 2, 1, 2); c.fillRect(fc.x, fc.y + 1, 1, 2);

    glMMBorder(N);
    glMMLabel("LOCAL " + rLy + " LY", 3, 3, GL_MM_PAL.frame);

    const stars = list.filter(function (s) { return !s.bh; });
    glMMStarCount = stars.length;
    c.fillStyle = GL_MM_PAL.frame;
    c.fillRect(0, N, N, 1);
    glMMText(stars.length + " STARS IN RANGE", 2, N + 3, GL_MM_PAL.dim);
    for (let i = 0; i < Math.min(7, stars.length); i++) {
        const y = N + 10 + i * 6, dist = glMMFmt(stars[i].d);
        glMMText(stars[i].name, 2, y, stars[i].home ? GL_MM_PAL.sel : GL_MM_PAL.text);
        glMMText(dist, N - 2 - dist.length * 4 + 1, y, GL_MM_PAL.sel);
    }
    glMMBorder(N + GL_MM_LIST_H);
}

// ---- GALAXY: the density formula, rendered once ---------------------------
// Each map pixel is ~860 ly. Brightness is log density (a 10⁴ range from the
// nucleus to the rim), quantised to 8 steps for the 8-bit look; colour runs
// from the bulge's old warm light to the arms' young blue-white.
function glBuildGalaxyImage() {
    const cv = document.createElement("canvas");
    cv.width = GL_MM_RES; cv.height = GL_MM_RES;
    const cx = cv.getContext("2d"), img = cx.createImageData(GL_MM_RES, GL_MM_RES);
    const E = GL_GAL.extent, px = 2 * E / GL_MM_RES;
    for (let j = 0; j < GL_MM_RES; j++) {
        for (let i = 0; i < GL_MM_RES; i++) {
            const xl = -E + (i + 0.5) * px, yl = -E + (j + 0.5) * px;
            const v = glGalaxyShape(xl, yl);
            let b = (Math.log10(Math.max(v, 1e-6)) + 2.8) / 4.2;
            b = Math.max(0, Math.min(1, b));
            b = Math.round(b * 8) / 8;
            const t = Math.min(1, Math.hypot(xl, yl) / 40000);
            const o = (j * GL_MM_RES + i) * 4;
            img.data[o] = Math.round(255 * b * (1 - 0.35 * t));
            img.data[o + 1] = Math.round(235 * b * (1 - 0.12 * t));
            img.data[o + 2] = Math.round(255 * b * (0.62 + 0.38 * t));
            img.data[o + 3] = 255;
        }
    }
    cx.putImageData(img, 0, 0);
    return cv;
}

function glRenderMinimapGalaxy() {
    glMMc = glMMCtx;
    const c = glMMc, N = GL_MM_RES, E = GL_GAL.extent * GL_LY;
    if (!glMMGalaxyImg) glMMGalaxyImg = glBuildGalaxyImage();
    glMMView.span = 2 * E;
    glMMView.x0 = GL_GAL.cx - E;
    glMMView.y0 = GL_GAL.cy - E;
    c.drawImage(glMMGalaxyImg, 0, 0);

    // Sgr A*, Sol, and you.
    const g = glMMPos(GL_GAL.cx, GL_GAL.cy);
    c.fillStyle = GL_MM_PAL.holeRim;
    c.fillRect(g.x, g.y, 1, 1);
    glMMText("SGR A", g.x + 3, g.y + 3, GL_MM_PAL.holeRim);
    const sol = glMMPos(0, 0);
    c.fillStyle = GL_MM_PAL.sel;
    c.fillRect(sol.x - 1, sol.y, 3, 1);
    c.fillRect(sol.x, sol.y - 1, 1, 3);
    glMMText("SOL", sol.x + 3, sol.y - 2, GL_MM_PAL.sel);
    glMMShips();

    glMMBorder(N);
    glMMLabel("MILKY WAY 110K LY", 3, 3, GL_MM_PAL.frame);
}

// Wheel over the map: +1 = out, −1 = in, throttled.
function glMinimapStep(dir) {
    const now = performance.now();
    if (now - glMMStepT < 250) return;
    glMMStepT = now;
    const i = Math.max(0, Math.min(GL_MM_LEVELS.length - 1, GL_MM_LEVELS.indexOf(glMMMode) + dir));
    if (GL_MM_LEVELS[i] === glMMMode) return;
    glMMMode = GL_MM_LEVELS[i];
    glMMTick = 0;   // redraw on the next frame rather than up to 4 frames later
}

function glMinimapHit(px, py) {
    const r = glMMRect;
    return !!r && px >= r.x && py >= r.y && px < r.x + r.w && py < r.y + r.h;
}

// Stage 5, last: bottom-left, above the key legend and below the HUD.
function glDrawMinimap() {
    if (!GLP.v.minimapOn) { glMMRect = null; return; }
    const local = glMMMode === "local";
    if (glMMTick++ % 4 === 0) {
        if (glMMMode === "planet") glRenderMinimapDetail(2 * GL_AU, "PLANET 2 AU", true);
        else if (glMMMode === "system") glRenderMinimapDetail(100 * GL_AU, "SYSTEM 100 AU", false);
        else if (local) glRenderMinimapLocal();
        else glRenderMinimapGalaxy();
    }
    const cv = local ? glMMCanvasMax : glMMCanvas;
    const w = cv.width * GL_MM_SCALE, h = cv.height * GL_MM_SCALE;
    const x = 12, y = Math.max(250, glH - h - 128);
    glMMRect = { x: x, y: y, w: w, h: h };
    glCtx.save();
    glCtx.imageSmoothingEnabled = false;
    glCtx.globalAlpha = 0.92;
    glCtx.drawImage(cv, x, y, w, h);
    glCtx.restore();
}
