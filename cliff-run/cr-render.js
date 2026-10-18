/**
 * Cliff Run — the raster draw
 * ===================================================
 * Declares only. cr-boot.js calls crRender() once per rendered frame.
 *
 * RASTER CABINET (AESTHETIC_GUIDE.md 1). The assignment is mechanical -- "what
 * does the game already draw?" -- and this draws chunky filled blocks on a tile
 * grid with blocky sprites, so: pure black ground, flat fills, hard edges,
 * scanlines permitted (gated on data-cabinet="raster" in the markup).
 *
 * THE FRAMEBUFFER IS 480x288 AND THE CANVAS IS 480x288. There is no ctx.scale
 * anywhere: the element is CSS-scaled by an integer factor with
 * image-rendering: pixelated, so one unit here is one fat screen pixel and
 * "snap to the pixel grid" (4.4) is just Math.round. That is also why the
 * simulation can keep sub-pixel positions -- RETRO.snap is applied at the draw
 * call and the physics never sees it.
 *
 * NOTHING THE CABINET PANEL SHOWS IS DRAWN HERE. 4.11a is explicit: no corner
 * minimap, no duplicate score, no stats stack. The only canvas text is the
 * three transient overlays (countdown, level card, result), which are events
 * rather than readouts.
 */
"use strict";

// A dry bleached wood for the branches, and the one token added to CR_INK's
// three rock tones. A branch drawn in basalt reads as a girder, and the spec
// asks for trees -- so this is the cheapest possible way to keep the palette
// honest about what the thing is.
var CR_BRANCH_INK = "#8F7A4A";

function crSnap(v) { return (typeof RETRO !== "undefined") ? RETRO.snap(v, 1) : Math.round(v); }

// ===================================================
//   FRAME
// ===================================================
function crRender() {
    var ctx = crCtx;
    if (!ctx) return;

    // Raster: clear outright. 4.1's phosphor persistence is a VECTOR
    // technique; smeared terrain on a scrolling platformer reads as a dirty
    // screen, not as a monitor.
    ctx.fillStyle = CR_INK.ground;
    ctx.fillRect(0, 0, CR_VW, CR_VH);

    if (!crLevel) return;

    var shakeX = 0, shakeY = 0;
    if (crCam.shake > 0) {
        shakeX = (Math.random() - 0.5) * crCam.shake;
        shakeY = (Math.random() - 0.5) * crCam.shake;
    }
    var ox = -crSnap(crCam.x) + crSnap(shakeX);
    var oy = crSnap(shakeY);

    crDrawBackdrop(ctx, crCam.x);

    ctx.save();
    ctx.translate(ox, oy);
    crDrawTiles(ctx);
    crDrawOutposts(ctx);
    crDrawGusts(ctx);
    crDrawItems(ctx);
    crDrawBombs(ctx);
    crDrawFalling(ctx);
    crDrawBodies(ctx);
    crDrawParticles(ctx);
    ctx.restore();

    crDrawAvalanche(ctx);
    crDrawOverlays(ctx);
}

// ===================================================
//   BACKDROP
// ===================================================
/*
 * THE BACKDROP IS A ROCK FACE, and getting that right took a second attempt.
 *
 * The first version drew two parallax layers of columns rising from the bottom
 * edge at varying heights. That is a SKYLINE -- it is the shape of a city, and
 * in the browser it read as one. The game is set on the side of a cliff, so
 * what is behind the player is not a horizon, it is more rock: continuous,
 * layered, and receding into the dark below.
 *
 * So: a flat mass, broken by horizontal STRATA (the seams a cliff is made of,
 * jittered so no seam is a ruler line), vertical FISSURES on a nearer layer,
 * an OVERHANG biting down from the top -- which is where the collapsing blocks
 * fall from, so it is worth being able to see it -- and the bottom banded down
 * to black, because the one thing the background has to say at all times is
 * "that is a long way down".
 *
 * Everything is CR_INK.rockLow at varying alpha. Nothing back here is allowed
 * to compete with the ledges the player has to read.
 */
function crDrawBackdrop(ctx, camX) {
    var i, x;

    // The face itself.
    ctx.fillStyle = CR_INK.rockLow;
    ctx.globalAlpha = 0.34;
    ctx.fillRect(0, 0, CR_VW, CR_VH);

    /* THE MOUNTAIN. "Make the mountain look more like a cliff and mountain."
     *
     * The furthest layer is a RIDGE -- a jagged skyline descending across the
     * frame with the mass filled in beneath it -- which is the one shape that
     * says "mountain" rather than "wall". It moves at 0.1, so it barely
     * shifts: distance is parallax, and a ridge that slides past at the speed
     * of the foreground is a fence.
     */
    var rp = camX * 0.1, rseg = 26;
    var rfirst = Math.floor(rp / rseg) - 1;
    ctx.globalAlpha = 0.5;
    ctx.fillStyle = CR_INK.rockLow;
    for (i = 0; i < CR_VW / rseg + 3; i++) {
        var rn = crHash2(rfirst + i, 61);
        var rn2 = crHash2(rfirst + i + 1, 61);
        var ry = 26 + rn * 54;
        var ry2 = 26 + rn2 * 54;
        x = crSnap((rfirst + i) * rseg - rp);
        // A stepped slope between this peak and the next: a ridge is a
        // sequence of facets, not a curve.
        for (var q = 0; q < rseg; q += 4) {
            var yy = crSnap(ry + (ry2 - ry) * (q / rseg));
            ctx.fillRect(x + q, yy, 5, CR_VH - yy);
        }
    }

    // FAR: horizontal strata. Each seam is a row of short segments whose y
    // steps by a hash, so it breaks the way bedding planes break.
    var sx = camX * 0.22;
    var seg = 20;
    var first = Math.floor(sx / seg) - 1;
    ctx.globalAlpha = 0.42;
    for (var sN = 0; sN < 13; sN++) {
        var baseY = 8 + sN * 27;
        for (i = 0; i < CR_VW / seg + 3; i++) {
            var n = crHash2(first + i, sN + 31);
            var y = baseY + Math.round((n - 0.5) * 7);
            x = crSnap((first + i) * seg - sx);
            ctx.fillRect(x, crSnap(y), seg + 1, 2 + Math.round(n * 2));
        }
    }

    // NEAR: fissures, and the outcrops that break them up.
    var sx2 = camX * 0.48;
    var step2 = 17;
    var first2 = Math.floor(sx2 / step2) - 1;
    ctx.globalAlpha = 0.62;
    for (i = 0; i < CR_VW / step2 + 3; i++) {
        var h2 = crHash2(first2 + i, 7);
        if (h2 < 0.55) continue;
        x = crSnap((first2 + i) * step2 - sx2);
        var fy = Math.round(crHash2(first2 + i, 13) * CR_VH * 0.7);
        ctx.fillRect(x, fy, 2 + Math.round(h2 * 2), crSnap(40 + h2 * 110));
    }

    // The overhang: the lip the collapsing blocks come off.
    ctx.globalAlpha = 0.85;
    for (i = 0; i < CR_VW / seg + 3; i++) {
        var hn = crHash2(first + i, 97);
        x = crSnap((first + i) * seg - sx);
        ctx.fillRect(x, 0, seg + 1, crSnap(4 + hn * 13));
    }

    // Down into the dark. Banded, not blended: 4.9, the era had no gradients.
    ctx.fillStyle = CR_INK.ground;
    for (var b = 0; b < 4; b++) {
        var t = b / 3;
        ctx.globalAlpha = (typeof RETRO !== "undefined" ? RETRO.band(t, 4) : t) * 0.55;
        ctx.fillRect(0, crSnap(CR_VH - (4 - b) * (CR_VH * 0.11)), CR_VW, crSnap(CR_VH * 0.11) + 1);
    }
    ctx.globalAlpha = 1;
}

// A cheap deterministic hash in 0..1. Not seeded off the level: the backdrop
// is the same cliff on every level, which is the point -- you are descending
// one cliff, not visiting ten.
function crHash2(a, b) {
    var h = (a * 374761393 + b * 668265263) | 0;
    h = (h ^ (h >>> 13)) | 0;
    h = Math.imul(h, 1274126177) | 0;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

// ===================================================
//   TILES
// ===================================================
// Only the columns on screen, which is what keeps a 190-tile level the same
// cost to draw as a 150-tile one.
function crDrawTiles(ctx) {
    var level = crLevel;
    var c0 = Math.max(0, Math.floor(crCam.x / CR_TILE) - 1);
    var c1 = Math.min(level.cols - 1, Math.ceil((crCam.x + CR_VW) / CR_TILE) + 1);

    for (var c = c0; c <= c1; c++) {
        for (var r = 0; r < CR_ROWS; r++) {
            var code = crGet(level, c, r);
            if (code === CR_T.EMPTY) continue;
            crDrawTile(ctx, level, code, c, r);
        }
    }
}

function crDrawTile(ctx, level, code, c, r) {
    var x = c * CR_TILE, y = r * CR_TILE, T = CR_TILE;

    switch (code) {
        case CR_T.STONE: {
            /* ROCK, NOT BRICK. The user's note: "make the blocks like rocks".
             *
             * A tile grid wants to look like masonry, and the three things
             * that stop it are all here: the lit edge is drawn ONLY where
             * there is actually sky above (inside a mass, every tile had a
             * ledge highlight, which is what made a solid cliff read as a
             * stack of girders); the top edge STEPS by a per-column amount so
             * the skyline is not a ruled line; and each tile carries two
             * deterministic facets and a fissure, so the face has grain.
             *
             * Everything is a function of (c, r), so it costs no state, never
             * shimmers, and is the same rock every time you look at it.
             */
            var openAbove = !crTileSolid(crGet(level, c, r - 1));
            var openBelow = !crTileSolid(crGet(level, c, r + 1));
            var step = openAbove ? (crHash2(c, 11) * 4 | 0) : 0;

            ctx.fillStyle = CR_INK.rockMid;
            ctx.fillRect(x, y + step, T, T - step);

            if (openAbove) {
                // The lit crest, following the stepped top.
                ctx.fillStyle = CR_INK.rock;
                ctx.fillRect(x, y + step, T, 3);
                ctx.fillStyle = CR_INK.rockLow;
                ctx.fillRect(x, y + step + 3, T, 1);
                // A chipped corner, one side or the other.
                ctx.fillStyle = CR_INK.ground;
                if (crHash2(c, 23) > 0.6) ctx.fillRect(x, y + step, 3 + (crHash2(c, 5) * 3 | 0), 2);
                else if (crHash2(c, 29) > 0.6) ctx.fillRect(x + T - 5, y + step, 5, 2);
            }
            if (openBelow) {
                ctx.fillStyle = CR_INK.rockLow;     // the overhang
                ctx.fillRect(x, y + T - 4, T, 4);
            }

            // Facets: one lighter, one darker, both wedge-shaped rather than
            // square, which is what keeps them reading as stone and not dirt.
            var fa = crHash2(c, r + 3), fb = crHash2(c + 7, r);
            ctx.fillStyle = CR_INK.rockLow;
            ctx.fillRect(x + 2 + (fa * 10 | 0), y + 6 + (fb * 10 | 0), 4 + (fa * 4 | 0), 3);
            ctx.fillRect(x + 3 + (fb * 14 | 0), y + 4 + (fa * 14 | 0), 2, 5 + (fb * 4 | 0));
            if (fa > 0.55 && !openAbove) {
                ctx.fillStyle = CR_INK.rock;
                ctx.globalAlpha = 0.25;
                ctx.fillRect(x + 1 + (fb * 8 | 0), y + 2 + (fa * 6 | 0), 7, 2);
                ctx.globalAlpha = 1;
            }
            break;
        }
        case CR_T.CRUMBLE: {
            /* THE "FALLS IMMEDIATELY" KIND. Hollow, hairline-cracked, and the
               only ground tile with NO lit top edge -- so it reads as "not
               really there" at a glance and from the far side of the screen,
               which is where the decision to step on it gets made. */
            var fuse = crTouched.get(crIdx(level, c, r));
            var jx = 0, jy = 0;
            if (fuse !== undefined) { jx = (Math.random() - 0.5) * 2.4; jy = (Math.random() - 0.5) * 2.4; }
            ctx.fillStyle = fuse !== undefined ? CR_INK.magenta : CR_INK.rockMid;
            var px = crSnap(x + jx), py = crSnap(y + jy);
            ctx.fillRect(px, py, T, 1);
            ctx.fillRect(px, py + T - 1, T, 1);
            ctx.fillRect(px, py, 1, T);
            ctx.fillRect(px + T - 1, py, 1, T);
            ctx.fillStyle = CR_INK.rockLow;
            ctx.fillRect(px + 6, py + 5, 2, 11);
            ctx.fillRect(px + 14, py + 4, 2, 8);
            ctx.fillRect(px + 8, py + 14, 7, 2);
            break;
        }
        case CR_T.TIMED: {
            /* THE "FALLS A FEW SECONDS LATER" KIND. Solid like stone -- it
               really does hold you -- but scored across in red, and once armed
               it blinks faster as the fuse runs down. Same information as a
               number, in a form you can read while running. */
            var f2 = crTouched.get(crIdx(level, c, r));
            var armed = f2 !== undefined;
            var blink = armed && (Math.floor(crRunTime * (5 + (1 - f2 / CR_TIMED_FUSE) * 18)) % 2 === 0);
            ctx.fillStyle = blink ? CR_INK.magenta : CR_INK.rockMid;
            ctx.fillRect(x, y, T, T);
            ctx.fillStyle = blink ? CR_INK.hot : CR_INK.rock;
            ctx.fillRect(x, y, T, 2);
            ctx.fillStyle = CR_INK.magenta;
            ctx.globalAlpha = armed ? 1 : 0.65;
            ctx.fillRect(x + 3, y + 9, T - 6, 2);
            ctx.fillRect(x + 3, y + 15, T - 6, 2);
            ctx.globalAlpha = 1;
            break;
        }
        case CR_T.BREAK: {
            // Bolted plate, four rivets. Amber because it is a thing to
            // interact with (2.2), not a thing that will hurt you.
            ctx.fillStyle = CR_INK.rockMid;
            ctx.fillRect(x, y, T, T);
            ctx.strokeStyle = CR_INK.amber;
            ctx.lineWidth = 1;
            ctx.strokeRect(x + 0.5, y + 0.5, T - 1, T - 1);
            ctx.fillStyle = CR_INK.amber;
            ctx.fillRect(x + 4, y + 4, 3, 3);
            ctx.fillRect(x + T - 7, y + 4, 3, 3);
            ctx.fillRect(x + 4, y + T - 7, 3, 3);
            ctx.fillRect(x + T - 7, y + T - 7, 3, 3);
            break;
        }
        case CR_T.BRANCH: {
            ctx.fillStyle = CR_BRANCH_INK;
            ctx.fillRect(x, y + 6, T, 4);
            ctx.fillRect(x + 4, y + 1, 3, 6);       // a twig up
            ctx.fillRect(x + 16, y + 2, 3, 5);
            ctx.fillStyle = CR_INK.rockLow;
            ctx.fillRect(x, y + 10, T, 2);
            break;
        }
        case CR_T.CATWALK: {
            // Steel grating with a cyan lip: cyan is "system / safe /
            // navigable" everywhere in the repo, and a catwalk is the one
            // thing on this cliff that is all three.
            ctx.fillStyle = CR_INK.rockLow;
            ctx.fillRect(x, y, T, 9);
            ctx.fillStyle = CR_INK.rockMid;
            for (var s = 2; s < T - 1; s += 5) ctx.fillRect(x + s, y + 3, 3, 6);
            ctx.fillStyle = CR_INK.cyan;
            ctx.fillRect(x, y, T, 2);
            break;
        }
        case CR_T.OUTPOST: {
            // Mass and collision only. crDrawTowerBody draws the building over
            // the top of this -- a tower has to know where its own top and
            // catwalks are, and a tile does not.
            ctx.fillStyle = CR_INK.rockLow;
            ctx.fillRect(x, y, T, T);
            break;
        }
        case CR_T.VENT: {
            // An opening IN the cliff. Cyan mouth for an updraft (it helps),
            // magenta for a crosswind (it does not).
            ctx.fillStyle = CR_INK.rockMid;
            ctx.fillRect(x, y, T, T);
            ctx.fillStyle = CR_INK.ground;
            ctx.fillRect(x + 3, y + 4, T - 6, T - 8);
            var hostile = crVentHostile(level, c, r);
            ctx.fillStyle = hostile ? CR_INK.magenta : CR_INK.cyan;
            ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(crRunTime * 5 + c));
            ctx.fillRect(x + 4, y + 6, T - 8, 3);
            ctx.globalAlpha = 1;
            break;
        }
    }
}

/*
 * THE COMMS TOWERS. "Make the start and end points look more like a radio
 * tower or ship tower, with catwalks and railings... windows... as if they are
 * buildings that are secured to the side of the mountain."
 *
 * Drawn as a STRUCTURE on top of the tiles rather than per-tile: a tower needs
 * to know where its own top, bottom and catwalks are, and a tile does not. The
 * OUTPOST and CATWALK tiles still provide the mass and the collision; this adds
 * everything that makes it a building -- lit windows, handrails along every
 * catwalk, the diagonal struts bolting it into the rock, and a mast with a
 * blinking beacon.
 *
 * Cyan throughout, which is not decoration: 2.2 makes cyan "system / safe /
 * navigable" in every game in the repo, and the far tower is the one thing on
 * this cliff that is all three.
 */
function crDrawOutposts(ctx) {
    var level = crLevel;
    for (var i = 0; i < level.catwalks.length; i++) {
        var cw = level.catwalks[i];
        if (i === 0 || level.catwalks[i - 1].finish !== cw.finish) {
            crDrawTowerBody(ctx, level, cw.finish);
        }
        crDrawCatwalk(ctx, cw);
    }
}

/*
 * THE OUTPOST, built from the reference the user attached: a brutalist
 * concrete tower bolted to the mountainside, going green, with a drum-shaped
 * top floor under a railed roof deck and a trussed catwalk reaching out over
 * the drop.
 *
 * The things that make it read as that building rather than a grey box, in
 * order of how much they do:
 *
 *   - CONCRETE, NOT ROCK. Its own palette (CR_INK.concrete*), so the structure
 *     separates from the cliff instead of looking carved out of it.
 *   - BANDED WINDOWS. Long horizontal ribbons of glazing per storey with
 *     mullions, the way the reference has them, rather than a scatter of lit
 *     squares. A few dark, one in twelve flickering.
 *   - THE DRUM. The top floor is inset and rounded off at the corners, with a
 *     railed deck on top of it. That silhouette is most of the reference.
 *   - MOSS ON EVERY LEDGE. Every horizontal surface that would hold water
 *     carries a ragged green fringe, heavier lower down.
 *   - A TRUSS under each catwalk, and struts into the rock, so the whole thing
 *     reads as fixed ON rather than grown out of.
 */
function crDrawTowerBody(ctx, level, isFinish) {
    var c0 = isFinish ? level.finishCol - 1 : 1;
    var c1 = isFinish ? level.cols - 2 : CR_START_COLS - 2;
    var x0 = c0 * CR_TILE, x1 = (c1 + 1) * CR_TILE;
    if (x1 < crCam.x - 60 || x0 > crCam.x + CR_VW + 60) return;

    var deckY = 46;                                   // top of the roof deck
    var drumY = deckY + 10;                           // the drum floor
    var bodyY = drumY + 30;
    var bottom = (CR_ROW_MAX + 2) * CR_TILE;
    var mid = crSnap((x0 + x1) / 2);
    var i, y;

    // ---- the shaft
    ctx.fillStyle = CR_INK.concreteMid;
    ctx.fillRect(x0, bodyY, x1 - x0, bottom - bodyY);
    ctx.fillStyle = CR_INK.concrete;                  // the lit face
    ctx.fillRect(isFinish ? x1 - 5 : x0, bodyY, 5, bottom - bodyY);

    // ---- the drum: inset, with its corners knocked off
    var dIn = 7;
    ctx.fillStyle = CR_INK.concreteMid;
    ctx.fillRect(x0 + dIn, drumY, (x1 - x0) - dIn * 2, bodyY - drumY);
    ctx.fillStyle = CR_INK.concrete;
    ctx.fillRect(x0 + dIn, drumY, (x1 - x0) - dIn * 2, 3);
    ctx.fillStyle = CR_INK.ground;                    // rounded shoulders
    ctx.fillRect(x0 + dIn, drumY, 3, 2);
    ctx.fillRect(x1 - dIn - 3, drumY, 3, 2);

    // ---- the roof deck and its railing
    ctx.fillStyle = CR_INK.concreteLow;
    ctx.fillRect(x0 + dIn - 3, deckY, (x1 - x0) - dIn * 2 + 6, drumY - deckY);
    ctx.fillStyle = CR_INK.concrete;
    ctx.fillRect(x0 + dIn - 3, deckY, (x1 - x0) - dIn * 2 + 6, 2);
    ctx.fillStyle = CR_INK.concreteMid;
    for (i = x0 + dIn - 2; i < x1 - dIn + 3; i += 7) ctx.fillRect(crSnap(i), deckY - 8, 2, 8);
    ctx.fillStyle = CR_INK.concrete;
    ctx.fillRect(x0 + dIn - 3, deckY - 9, (x1 - x0) - dIn * 2 + 6, 2);

    // ---- banded glazing
    for (y = bodyY + 9, i = 0; y < bottom - 30; y += 24, i++) {
        ctx.fillStyle = CR_INK.concreteLow;
        ctx.fillRect(x0 + 4, crSnap(y), (x1 - x0) - 8, 11);
        for (var wx = x0 + 6; wx < x1 - 7; wx += 10) {
            var h = crHash2(wx + i * 37, isFinish ? 2 : 1);
            if (h < 0.2) continue;
            var lit = h > 0.3 || (Math.floor(crRunTime * 1.4 + h * 9) % 2 === 0);
            ctx.fillStyle = lit ? CR_INK.cyan : CR_INK.concreteMid;
            ctx.globalAlpha = lit ? 0.7 : 1;
            ctx.fillRect(crSnap(wx), crSnap(y + 2), 7, 7);
            ctx.globalAlpha = 1;
        }
        // the sill, and the moss that has taken it
        ctx.fillStyle = CR_INK.concrete;
        ctx.fillRect(x0 + 4, crSnap(y + 11), (x1 - x0) - 8, 2);
        crDrawMoss(ctx, x0 + 4, y + 13, (x1 - x0) - 8, i * 13 + (isFinish ? 5 : 0),
                   0.25 + 0.5 * (y / bottom));
    }

    // a lit band on the drum too
    ctx.fillStyle = CR_INK.concreteLow;
    ctx.fillRect(x0 + dIn + 3, drumY + 9, (x1 - x0) - dIn * 2 - 6, 10);
    for (var dx = x0 + dIn + 5; dx < x1 - dIn - 5; dx += 9) {
        ctx.fillStyle = (Math.floor(crRunTime + dx) % 5) ? CR_INK.cyan : CR_INK.concreteMid;
        ctx.globalAlpha = 0.7;
        ctx.fillRect(crSnap(dx), drumY + 11, 6, 6);
        ctx.globalAlpha = 1;
    }

    // ---- struts into the mountain
    ctx.fillStyle = CR_INK.concreteMid;
    var sx = isFinish ? x0 : x1;
    var dir = isFinish ? -1 : 1;
    for (var k = 0; k < 4; k++) {
        var sy2 = bodyY + 46 + k * 62;
        if (sy2 > bottom - 24) break;
        for (var tt = 0; tt < 18; tt++) {
            ctx.fillRect(crSnap(sx + dir * tt), crSnap(sy2 + tt), 2, 2);
            ctx.fillRect(crSnap(sx + dir * tt), crSnap(sy2 - tt), 2, 2);
        }
    }

    // ---- the mast
    ctx.fillStyle = CR_INK.concreteMid;
    ctx.fillRect(mid - 2, 0, 4, deckY - 8);
    ctx.fillStyle = CR_INK.concreteLow;
    for (var g = 0; g < 14; g++) {
        ctx.fillRect(crSnap(mid - 2 - g), crSnap(g * 2.6), 1, 1);
        ctx.fillRect(crSnap(mid + 2 + g), crSnap(g * 2.6), 1, 1);
    }
    ctx.fillStyle = (Math.floor(crRunTime * 1.6) % 2) ? CR_INK.magenta : CR_INK.concreteLow;
    ctx.fillRect(mid - 2, 0, 4, 5);
}

// A ragged fringe of green along a ledge. Deterministic, so the building
// weathers the same way every time you look at it.
function crDrawMoss(ctx, x, y, w, seed, density) {
    for (var i = 0; i < w; i += 3) {
        var h = crHash2(i + seed, 53);
        if (h > density) continue;
        ctx.fillStyle = h > density * 0.6 ? CR_INK.moss : CR_INK.mossLit;
        ctx.fillRect(crSnap(x + i), crSnap(y), 3, 1 + (h * 6 | 0));
    }
}

/*
 * A catwalk and its HANDRAIL. The rail is drawn above the walking surface and
 * is not collidable -- it is the thing that makes a 9px strip of grating read
 * as somewhere a person is meant to stand.
 */
function crDrawCatwalk(ctx, cw) {
    var x0 = cw.col0 * CR_TILE, x1 = (cw.col1 + 1) * CR_TILE;
    if (x1 < crCam.x - 60 || x0 > crCam.x + CR_VW + 60) return;
    var y = cw.row * CR_TILE;

    // The deck.
    ctx.fillStyle = CR_INK.concreteMid;
    ctx.fillRect(x0, y, x1 - x0, 7);
    ctx.fillStyle = cw.finish ? CR_INK.cyan : CR_INK.concrete;
    ctx.fillRect(x0, y, x1 - x0, 2);

    /* THE TRUSS. A walkway out over a drop has something holding it up, and in
       the reference that is a lattice of diagonals under the span. It is also
       the detail that stops a catwalk reading as a floating platform. */
    ctx.fillStyle = CR_INK.concreteLow;
    ctx.fillRect(x0, y + 7, x1 - x0, 2);
    for (var tx = x0; tx < x1 - 6; tx += 12) {
        for (var d = 0; d < 7; d++) {
            ctx.fillRect(crSnap(tx + d), crSnap(y + 9 + d), 2, 2);
            ctx.fillRect(crSnap(tx + 11 - d), crSnap(y + 9 + d), 2, 2);
        }
    }

    // Handrail: posts, a top rail and a mid rail. Not collidable -- it is what
    // makes a strip of grating read as somewhere a person stands.
    ctx.fillStyle = CR_INK.concreteMid;
    for (var px = x0 + 2; px < x1; px += 13) ctx.fillRect(crSnap(px), y - 15, 2, 15);
    ctx.fillStyle = cw.finish ? CR_INK.cyan : CR_INK.concrete;
    ctx.fillRect(x0, y - 16, x1 - x0, 2);
    ctx.fillStyle = CR_INK.concreteMid;
    ctx.fillRect(x0, y - 8, x1 - x0, 1);

    crDrawMoss(ctx, x0, y + 9, x1 - x0, cw.row * 7, 0.3);
}

// A vent is hostile if the gust it feeds pushes left -- back toward the
// avalanche. Looked up rather than stored on the tile because the grid is a
// Uint8Array of codes and "which way does this blow" is not a code.
function crVentHostile(level, c, r) {
    for (var i = 0; i < level.vents.length; i++) {
        if (level.vents[i].col === c && level.vents[i].row === r) {
            return level.vents[i].dir === "left";
        }
    }
    return false;
}

// ===================================================
//   GUSTS
// ===================================================
// The gust field has to be VISIBLE or it is an invisible force, which is the
// one unfair thing a platformer can do. Short streaks moving in the gust's own
// direction, alpha-banded through RETRO.band so they step rather than fade --
// the era had no smooth gradients (4.9).
function crDrawGusts(ctx) {
    var level = crLevel;
    for (var i = 0; i < level.gusts.length; i++) {
        var g = level.gusts[i];
        if (g.x + g.w < crCam.x - 20 || g.x > crCam.x + CR_VW + 20) continue;
        var up = g.dir === "up";
        ctx.fillStyle = up ? CR_INK.cyan : CR_INK.magenta;
        var n = Math.floor((g.w * g.h) / 900);
        for (var k = 0; k < n; k++) {
            var seed = crHash2(i * 31 + k, 7);
            var phase = (crRunTime * (up ? 70 : 90) + seed * 400) % (up ? g.h : g.w);
            var px, py, w, h;
            if (up) {
                px = g.x + 3 + seed * (g.w - 6);
                py = g.y + g.h - phase;
                w = 1; h = 5;
            } else {
                px = g.x + g.w - phase;
                py = g.y + 3 + seed * (g.h - 6);
                w = 6; h = 1;
            }
            var a = typeof RETRO !== "undefined"
                ? RETRO.band(0.2 + 0.5 * seed, 3)
                : 0.4;
            ctx.globalAlpha = a * 0.6;
            ctx.fillRect(crSnap(px), crSnap(py), w, h);
        }
        ctx.globalAlpha = 1;
    }
}

// ===================================================
//   ITEMS
// ===================================================
function crDrawItems(ctx) {
    var i;
    for (i = 0; i < crCoins.length; i++) {
        var c = crCoins[i];
        if (c.taken) continue;
        if (c.x < crCam.x - 16 || c.x > crCam.x + CR_VW + 16) continue;
        var bob = Math.sin(crRunTime * 4 + c.bob) * 1.5;
        var x = crSnap(c.x - 3), y = crSnap(c.y - 3 + bob);
        // A 6x6 coin that spins by getting narrower. Four frames, no tween:
        // "numbers never animate smoothly. They tick." (3.4)
        var fr = Math.floor(crRunTime * 7 + c.bob * 3) % 4;
        var wid = [8, 5, 2, 5][fr];
        ctx.fillStyle = CR_INK.amber;
        ctx.fillRect(x + (8 - wid) / 2, y, wid, 8);
        ctx.fillStyle = CR_INK.hot;
        ctx.fillRect(x + (8 - wid) / 2, y + 2, Math.max(1, wid - 2), 2);
    }

    for (i = 0; i < crPickups.length; i++) {
        var p = crPickups[i];
        if (p.taken) continue;
        if (p.x < crCam.x - 16 || p.x > crCam.x + CR_VW + 16) continue;
        var pb = Math.sin(crRunTime * 3.4 + p.bob) * 2;
        var px = crSnap(p.x - 5), py = crSnap(p.y - 5 + pb);
        if (p.kind === "dj") {
            // Two chevrons up: the shape says "a second jump" without a label.
            ctx.fillStyle = CR_INK.cyan;
            ctx.fillRect(px + 4, py, 2, 2);
            ctx.fillRect(px + 2, py + 2, 6, 1);
            ctx.fillRect(px + 4, py + 4, 2, 2);
            ctx.fillRect(px + 2, py + 6, 6, 1);
            ctx.fillStyle = CR_INK.hot;
            ctx.fillRect(px + 4, py + 1, 2, 1);
        } else {
            ctx.fillStyle = CR_INK.magenta;
            ctx.fillRect(px + 1, py + 3, 8, 7);
            ctx.fillStyle = CR_INK.amber;
            ctx.fillRect(px + 5, py, 2, 3);
            ctx.fillStyle = CR_INK.hot;
            ctx.fillRect(px + 3, py + 5, 2, 2);
        }
    }
}

function crDrawBombs(ctx) {
    for (var i = 0; i < crBombs.length; i++) {
        var b = crBombs[i];
        var hot = (b.fuse < 0.6) && (Math.floor(b.blink * 12) % 2 === 0);
        ctx.fillStyle = hot ? CR_INK.hot : CR_INK.magenta;
        ctx.fillRect(crSnap(b.x - 4), crSnap(b.y - 7), 8, 7);
        ctx.fillStyle = CR_INK.amber;
        ctx.fillRect(crSnap(b.x - 1), crSnap(b.y - 10), 2, 3);
    }
}

function crDrawFalling(ctx) {
    for (var i = 0; i < crFalling.length; i++) {
        var f = crFalling[i];
        if (f.x < crCam.x - 24 || f.x > crCam.x + CR_VW + 24) continue;
        ctx.fillStyle = f.code === CR_T.TIMED ? CR_INK.rockMid : CR_INK.rockLow;
        var w = 14 - (Math.floor(f.spin) % 3) * 2;      // tumbling, in steps
        ctx.fillRect(crSnap(f.x + (16 - w) / 2), crSnap(f.y), w, 14);
        ctx.fillStyle = CR_INK.rockLow;
        ctx.fillRect(crSnap(f.x + (16 - w) / 2), crSnap(f.y), w, 2);
    }
}

// ===================================================
//   BODIES
// ===================================================
function crDrawBodies(ctx) {
    for (var i = 0; i < crBodies.length; i++) {
        var b = crBodies[i];
        if (!b.alive) continue;
        crDrawBody(ctx, b);
    }
}

/*
 * THE PLAYER IS A ZOMBIE PLAYER.
 *
 * zombie-render.js's drawPlayerBody is a 16x16 filled square in the identity
 * colour with a 4x4 white pip at centre + facing*13, a 2px white ring while
 * invulnerable, and #FF5555 squashed to 60% height when downed. That is the
 * whole sprite, and the user asked for the character to look the same in both
 * games, so it is ported rather than reinterpreted: same square, same pip, same
 * offsets, with facing reduced to the one axis a side-scroller has.
 *
 * The blocky little figure this replaces -- torso, head, two legs on a stepped
 * stride, an arm and a visor -- was better animation and the wrong character.
 */
function crDrawBody(ctx, b) {
    var x = crSnap(b.x), y = crSnap(b.y);

    // Dash trail. Three stepped ghosts rather than a smear: a raster cabinet
    // has no motion blur, it has a sprite drawn in more than one place.
    if (b.dashTime > 0) {
        ctx.globalAlpha = 0.3;
        ctx.fillStyle = b.color;
        for (var t = 1; t <= 3; t++) {
            ctx.fillRect(x - b.dashDir * t * 7, y + 2, b.w, b.h - 4);
        }
        ctx.globalAlpha = 1;
    }

    // A one-pixel black silhouette under everything, so a player is legible
    // against rock, against a gust and against another player. Zombie does not
    // need this -- its ground is flat dark -- and this game's is not.
    ctx.fillStyle = CR_INK.ground;
    ctx.fillRect(x - 1, y - 1, b.w + 2, b.h + 2);

    var body = b.color;
    if (b.bounceFlash > 0 && Math.floor(b.bounceFlash * 30) % 2 === 0) body = CR_INK.hot;
    if (b.springFlash > 0) body = CR_INK.hot;
    if (b.finished) body = CR_INK.cyan;

    ctx.fillStyle = body;
    ctx.fillRect(x, y, b.w, b.h);

    // The facing pip, at Zombie's own offset. It sits just OUTSIDE the square,
    // which is what makes a 16px block read as having a front.
    ctx.fillStyle = "#FFFFFF";
    ctx.fillRect(crSnap(x + b.w / 2 + b.face * 13 - 2), crSnap(y + b.h / 2 - 2), 4, 4);

    // Clinging: a scrape of dust against the wall it is holding.
    if (b.wallDir !== 0 && !b.onGround) {
        ctx.fillStyle = CR_INK.mid;
        ctx.globalAlpha = 0.6;
        ctx.fillRect(b.wallDir < 0 ? x - 2 : x + b.w, y + 4 + (Math.floor(crRunTime * 20) % 6), 2, 4);
        ctx.globalAlpha = 1;
    }

    // THE CARET. The one marker on the play field, and it is on the human only:
    // four identically-shaped squares of similar brightness make "which one am
    // I" a question the screen has to answer at all times.
    if (b.seat === 0) {
        ctx.fillStyle = CR_INK.amber;
        var cy = y - 7 + Math.round(Math.sin(crRunTime * 6) * 1);
        ctx.fillRect(x + 5, cy, 6, 2);
        ctx.fillRect(x + 7, cy + 2, 2, 2);
    }

    // Charges and bombs, as pips on the shoulder. State about THIS body at the
    // moment you act on it, not a readout -- 4.11a's "nothing in the panel is
    // drawn here as well" still holds, and the panel shows the counts.
    if (b.djCharges > 0) {
        ctx.fillStyle = CR_INK.cyan;
        for (var k = 0; k < b.djCharges; k++) ctx.fillRect(x + b.w + 1, y + k * 4, 2, 3);
    }
    if (b.bombs > 0) {
        ctx.fillStyle = CR_INK.magenta;
        for (var m = 0; m < b.bombs; m++) ctx.fillRect(x - 3, y + m * 4, 2, 3);
    }
}

function crDrawParticles(ctx) {
    for (var i = 0; i < crParticles.length; i++) {
        var p = crParticles[i];
        ctx.fillStyle = p.color;
        ctx.globalAlpha = crClamp(p.life * 2.2, 0, 1);
        ctx.fillRect(crSnap(p.x), crSnap(p.y), 2, 2);
    }
    ctx.globalAlpha = 1;
}

// ===================================================
//   THE AVALANCHE
// ===================================================
// Screen space, not world space: it is the left 5% of the SCREEN, which is what
// makes it a pace-setter rather than a place. Magenta leading edge because it
// is the thing in this game most likely to kill you (2.2).
/*
 * THE AVALANCHE: ROCKS AND DUST.
 *
 * The user's note -- "make it look like actual rocks and dust". It was a field
 * of same-sized squares, which at any distance is gravel or static. Three
 * things make it rock instead:
 *
 *   - BOULDERS OF VERY DIFFERENT SIZES. A real slide is a few big masses with
 *     rubble between them, and the big ones are what give it scale. Each is
 *     two or three overlapping rectangles, which is how you get an irregular
 *     silhouette out of fillRect.
 *   - THEY TUMBLE. Each boulder's offset is a function of time, so the mass
 *     churns rather than shimmering in place.
 *   - DUST. A billowing front that reaches PAST the kill line, in stepped
 *     alpha bands (4.9: the era had no gradients). The dust is what sells it
 *     as moving air rather than a wall of texture, and it is also the warning
 *     you see before the rock arrives.
 *
 * It is drawn in screen space because that is what it is: the left edge of the
 * screen, the whole way down, at a constant speed.
 */
function crDrawAvalanche(ctx) {
    if (crPhase !== "play" && crPhase !== "between") return;
    var w = crClamp(crAvalancheX - crCam.x, 0, CR_VW);
    if (w <= 0) return;
    var t = crRunTime;

    // Behind the front: solid black, because nothing has survived back there.
    ctx.fillStyle = CR_INK.ground;
    ctx.fillRect(0, 0, w, CR_VH);

    // ---- the mass
    var i, h1, h2, bx, by, sz;
    for (i = 0; i < 70; i++) {
        h1 = crHash2(i, 3);
        h2 = crHash2(i, 17);
        // Tumbling: each boulder drifts on its own clock and wraps.
        by = (h1 * CR_VH + t * (26 + h2 * 50)) % (CR_VH + 30) - 15;
        bx = (h2 * w) + Math.sin(t * 1.7 + i) * 3;
        sz = 3 + Math.floor(h1 * h2 * 26);               // a few big, many small
        if (bx + sz < 0 || bx > w) continue;
        ctx.fillStyle = h1 > 0.72 ? CR_INK.rock : (h1 > 0.34 ? CR_INK.rockMid : CR_INK.rockLow);
        // Two or three overlapping blocks: an irregular lump, not a square.
        ctx.fillRect(crSnap(bx), crSnap(by), sz, sz);
        ctx.fillRect(crSnap(bx + sz * 0.45), crSnap(by - sz * 0.3), sz * 0.7, sz * 0.8);
        if (sz > 10) {
            ctx.fillStyle = CR_INK.rockLow;
            ctx.fillRect(crSnap(bx + 2), crSnap(by + sz * 0.5), sz * 0.5, 2);
        }
    }

    // ---- the dust front, reaching past the kill line
    for (var band = 0; band < 4; band++) {
        var reach = 10 + band * 11;
        ctx.globalAlpha = (typeof RETRO !== "undefined" ? RETRO.band(1 - band / 4, 4) : 0.4) * 0.26;
        ctx.fillStyle = CR_INK.dust;
        for (i = 0; i < 16; i++) {
            var dh = crHash2(i + band * 29, 41);
            var dy = (dh * CR_VH + t * (16 + dh * 26)) % (CR_VH + 40) - 20;
            var dw = 10 + dh * 22;
            ctx.fillRect(crSnap(w - 6 + dh * reach), crSnap(dy), dw, 7 + (dh * 10 | 0));
        }
    }
    ctx.globalAlpha = 1;

    // ---- debris thrown clear of the front
    ctx.fillStyle = CR_INK.rockMid;
    for (i = 0; i < 9; i++) {
        var sh = crHash2(i, Math.floor(t * 3) + 77);
        var px = w + sh * 30;
        var py = ((sh * CR_VH) + t * 150) % CR_VH;
        ctx.globalAlpha = 0.8 - sh * 0.5;
        ctx.fillRect(crSnap(px), crSnap(py), 2 + (sh * 3 | 0), 2 + (sh * 3 | 0));
    }
    ctx.globalAlpha = 1;

    // The kill line itself stays readable: this is the thing that ends you.
    ctx.fillStyle = CR_INK.magenta;
    ctx.globalAlpha = 0.5 + 0.5 * Math.abs(Math.sin(t * 9));
    ctx.fillRect(crSnap(w), 0, 1, CR_VH);
    ctx.globalAlpha = 1;
}

// ===================================================
//   THE THREE OVERLAYS
// ===================================================
// Events, not readouts: a level card, a countdown, and the line that says how
// the level ended. Everything persistent lives in the cabinet panel.
function crDrawOverlays(ctx) {
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";

    if (crPhase === "ready") {
        crBanner(ctx, "LEVEL " + (crLevelIndex + 1), CR_INK.cyan, 20, CR_VH / 2 - 26);
        crBanner(ctx, crLevel.objective, CR_INK.amber, 8, CR_VH / 2 - 2);
        var n = Math.ceil(crReadyLeft);
        crBanner(ctx, n > 0 ? String(n) : "GO", n > 0 ? CR_INK.hot : CR_INK.amber, 26, CR_VH / 2 + 34);
        return;
    }

    if (crPhase === "between") {
        crScrim(ctx, 0.55);
        crBanner(ctx, "LEVEL " + (crLevelIndex + 1) + " CLEAR", CR_INK.cyan, 16, CR_VH / 2 - 16);
        crBanner(ctx, crAliveCount() + " STILL ON THE CLIFF", CR_INK.mid, 8, CR_VH / 2 + 14);
        return;
    }

    if (crPhase === "over") {
        // A scrim, and real spacing. These four lines used to sit 24px apart at
        // sizes up to 20px in Press Start 2P, which is a very wide face -- they
        // overlapped each other and the cliff behind them.
        crScrim(ctx, 0.72);
        var me = crPlayers[0];
        var won = me && me.finished && crLevelIndex >= CR_LEVEL_COUNT - 1;
        crBanner(ctx, won ? "CLIFF CLEARED" : "RUN OVER",
                 won ? CR_INK.amber : CR_INK.magenta, 20, CR_VH / 2 - 52);
        if (!won && crLastDeath) {
            crBanner(ctx, crLastDeath === "fall" ? "YOU FELL" : "THE AVALANCHE TOOK YOU",
                     CR_INK.magenta, 8, CR_VH / 2 - 18);
        }
        crBanner(ctx, "WINNER  " + crWinnerName, CR_INK.cyan, 10, CR_VH / 2 + 14);
        crBanner(ctx, "ENTER  RUN AGAIN", CR_INK.mid, 8, CR_VH / 2 + 48);
        return;
    }

    if (crAttractRunning) {
        crBanner(ctx, "CLIFF RUN", CR_INK.cyan, 22, 40);
        // 4.8: INSERT COIN, pulsing in amber. The sim is already playing itself.
        if (Math.floor(crRunTime * 2) % 2 === 0) {
            crBanner(ctx, "INSERT COIN", CR_INK.amber, 12, CR_VH - 40);
        }
    }
}

// Flat black at an alpha, not a gradient: a card has to be readable over
// whatever the cliff happens to look like behind it.
function crScrim(ctx, alpha) {
    ctx.globalAlpha = alpha;
    ctx.fillStyle = CR_INK.ground;
    ctx.fillRect(0, 0, CR_VW, CR_VH);
    ctx.globalAlpha = 1;
}

function crBanner(ctx, text, color, size, y) {
    ctx.font = size + "px 'Press Start 2P', monospace";
    // A hard black shim, not a shadow: it has to stay legible over rock.
    ctx.fillStyle = CR_INK.ground;
    ctx.fillText(text, CR_VW / 2 + 1, y + 1);
    ctx.fillText(text, CR_VW / 2 - 1, y + 1);
    ctx.fillStyle = color;
    ctx.fillText(text, CR_VW / 2, y);
}
