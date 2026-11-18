// ===================================================
//   Desert Code Racer — stroke font (AESTHETIC_GUIDE §3.3)
// ===================================================
// Vector games had no fonts: letters were line segments drawn by the same
// beam as everything else. Every glyph here is a few polylines on a 4 x 6
// grid (y down), Asteroids-style, all straight strokes. In-canvas text uses
// this; DOM text (the panel, the cards) stays VT323 / Press Start 2P.
"use strict";

const DC_GLYPHS = (function () {
    const src = {
        A: "0,6 0,2 2,0 4,2 4,6|0,4 4,4",
        B: "0,6 0,0 3,0 4,1 4,2 3,3 0,3|3,3 4,4 4,5 3,6 0,6",
        C: "4,0 0,0 0,6 4,6",
        D: "0,0 0,6 2,6 4,4 4,2 2,0 0,0",
        E: "4,0 0,0 0,6 4,6|0,3 3,3",
        F: "4,0 0,0 0,6|0,3 3,3",
        G: "4,1 4,0 0,0 0,6 4,6 4,3 2,3",
        H: "0,0 0,6|4,0 4,6|0,3 4,3",
        I: "0,0 4,0|2,0 2,6|0,6 4,6",
        J: "4,0 4,6 1,6 0,5 0,4",
        K: "0,0 0,6|4,0 0,3 4,6",
        L: "0,0 0,6 4,6",
        M: "0,6 0,0 2,2 4,0 4,6",
        N: "0,6 0,0 4,6 4,0",
        O: "0,0 4,0 4,6 0,6 0,0",
        P: "0,6 0,0 4,0 4,3 0,3",
        Q: "0,0 4,0 4,4 2,6 0,6 0,0|2,4 4,6",
        R: "0,6 0,0 4,0 4,3 0,3|1,3 4,6",
        S: "4,1 3,0 0,0 0,3 4,3 4,6 1,6 0,5",
        T: "0,0 4,0|2,0 2,6",
        U: "0,0 0,6 4,6 4,0",
        V: "0,0 2,6 4,0",
        W: "0,0 0,6 2,4 4,6 4,0",
        X: "0,0 4,6|4,0 0,6",
        Y: "0,0 2,2 4,0|2,2 2,6",
        Z: "0,0 4,0 0,6 4,6",
        "0": "0,0 4,0 4,6 0,6 0,0|0,6 4,0",
        "1": "1,1 2,0 2,6|1,6 3,6",
        "2": "0,0 4,0 4,3 0,3 0,6 4,6",
        "3": "0,0 4,0 4,6 0,6|1,3 4,3",
        "4": "0,0 0,3 4,3|4,0 4,6",
        "5": "4,0 0,0 0,3 4,3 4,6 0,6",
        "6": "4,0 0,0 0,6 4,6 4,3 0,3",
        "7": "0,0 4,0 1,6",
        "8": "0,0 4,0 4,6 0,6 0,0|0,3 4,3",
        "9": "4,3 0,3 0,0 4,0 4,6 0,6",
        ".": "2,5.4 2,6",
        ",": "2,5 1,7",
        "!": "2,0 2,4|2,5.4 2,6",
        "?": "0,1 1,0 3,0 4,1 4,2 2,3 2,4|2,5.4 2,6",
        "-": "1,3 3,3",
        "+": "1,3 3,3|2,2 2,4",
        "/": "0,6 4,0",
        ":": "2,1.4 2,2|2,4.4 2,5",
        "'": "2,0 2,1.5",
        "·": "1.8,3 2.2,3",
        "×": "1,2 3,4|3,2 1,4"
    };
    const out = {};
    Object.keys(src).forEach(function (k) {
        out[k] = src[k].split("|").map(function (line) {
            return line.split(" ").map(function (pt) {
                const p = pt.split(",");
                return [Number(p[0]), Number(p[1])];
            });
        });
    });
    return out;
})();

function dcTextWidth(str, size) {
    return String(str).length * size * (5.6 / 6) - size * (1.6 / 6);
}

// Draws `str` with its top-left at (x, y) (or centred / right-aligned).
// size is the glyph height in px. Two passes: a wide dim beam, a hot core.
function dcText(ctx, str, x, y, size, color, align, alpha) {
    str = String(str).toUpperCase();
    const w = dcTextWidth(str, size);
    if (align === "center") x -= w / 2;
    else if (align === "right") x -= w;
    const k = size / 6;
    const adv = size * (5.6 / 6);
    ctx.save();
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    for (let i = 0; i < str.length; i++) {
        const g = DC_GLYPHS[str[i]];
        if (!g) continue;
        const ox = x + i * adv;
        for (let p = 0; p < g.length; p++) {
            const line = g[p];
            ctx.moveTo(ox + line[0][0] * k, y + line[0][1] * k);
            for (let q = 1; q < line.length; q++) ctx.lineTo(ox + line[q][0] * k, y + line[q][1] * k);
        }
    }
    const a = alpha === undefined ? 1 : alpha;
    ctx.globalAlpha = 0.22 * a;
    ctx.strokeStyle = color;
    ctx.lineWidth = Math.max(2.5, size / 5);
    ctx.stroke();
    ctx.globalAlpha = a;
    ctx.strokeStyle = color === DC_COL.hot ? DC_COL.hot : color;
    ctx.lineWidth = Math.max(1.2, size / 11);
    ctx.stroke();
    ctx.restore();
    return w;
}
