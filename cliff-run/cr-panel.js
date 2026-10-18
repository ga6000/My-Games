/**
 * Cliff Run — the cabinet panel
 * ===================================================
 * Declares only. cr-boot.js calls crPanelInit() once and crPanelFrame() per
 * rendered frame.
 *
 * AESTHETIC_GUIDE.md "The cabinet panel" (4.11a) is a REQUIREMENT, not a
 * suggestion: every hub game gets a right-hand Bosconian panel. Zombie's
 * #sidebar is the reference implementation and this follows it -- red labels,
 * white values, black ground, the radar in a hard light frame, CONDITION in
 * its own colour with RED blinking.
 *
 * The rule that is easiest to break and matters most: NOTHING IN HERE IS ALSO
 * DRAWN ON THE PLAY FIELD. cr-render.js draws no score, no timer, no minimap
 * and no objective; its only text is three transient cards. The one thing that
 * looks like an exception -- the charge and bomb pips on the player sprite --
 * is state about that body at the moment you act on it, not a readout, and the
 * panel shows the counts instead.
 *
 * THE RADAR USES A NON-UNIFORM SCALE, on purpose. A level is up to 3040x288,
 * which is 10.5:1; drawn to scale in a 240x140 frame it would be a 22px ribbon
 * with 118px of black above it. It is a schematic, not a picture, so x is
 * squeezed to the level's length and y is stretched to the frame. What the
 * player reads off it is "which lane, how far, how close is the wall" -- all
 * three survive the distortion, and the lanes are actually easier to tell
 * apart because of it.
 */
"use strict";

var crPanelEls = null;
var crRadarCtx = null;

function crPanelInit() {
    function el(id) { return document.getElementById(id); }
    crPanelEls = {
        hi: el("cabHi"), score: el("cabScore"), name: el("cabName"),
        cond: el("cabCond"), lives: el("cabLives"),
        next: el("cabNext"),
        level: el("cabLevel"), time: el("cabTime"),
        coins: el("cabCoins"), speed: el("cabSpeed"),
        jumps: el("cabJumps"), bombs: el("cabBombs"),
        radar: el("cabRadar")
    };
    if (crPanelEls.radar) crRadarCtx = crPanelEls.radar.getContext("2d");
    document.body.classList.add("arcade");
}

function crSetText(node, text) {
    if (node && node.textContent !== text) node.textContent = text;
}

function crPanelFrame() {
    if (!crPanelEls) return;
    var me = crPlayers[0];

    // 3.4: zero-padded to six digits, through the shared helper so every game
    // in the repo pads the same way.
    var pad = (typeof RETRO !== "undefined") ? RETRO.padScore : function (n) { return String(n); };
    var live = crScoreTotal + (me ? me.score : 0);
    crSetText(crPanelEls.hi, pad(Math.max(crHiScore, live)));
    crSetText(crPanelEls.score, pad(live));
    crSetText(crPanelEls.name, me ? me.name : "");

    crSetText(crPanelEls.level, (crLevelIndex + 1) + "/" + CR_LEVEL_COUNT);
    crSetText(crPanelEls.time, crLevelTime.toFixed(1));
    crSetText(crPanelEls.coins, String(me ? me.coins : 0));
    crSetText(crPanelEls.speed, crLevel ? Math.round(crLevel.spec.scroll) + " PX/S" : "--");
    crSetText(crPanelEls.jumps, me ? (me.djCharges > 0 ? "+" + me.djCharges : "--") : "--");
    crSetText(crPanelEls.bombs, me ? (me.bombs > 0 ? String(me.bombs) : "--") : "--");

    crPanelCondition(me);
    crPanelLives();
    crPanelNext(me);
    crPanelRadar();
}

// ===================================================
//   CONDITION
// ===================================================
// 4.11a leaves what each level MEANS to the game. Here it is the one number
// that can end your run without warning: how much cliff there is between you
// and the avalanche.
function crPanelCondition(me) {
    var node = crPanelEls.cond;
    if (!node) return;
    var label = "GREEN", cls = "green";
    // Before a run starts there is no avalanche and nothing to be amber about.
    // The panel used to read the live distance on the MENU, where crAvalancheX
    // is still at its spawn value and the bodies are not placed yet, so the
    // title screen greeted you with a blinking RED and "MOVE - THE WALL IS ON
    // YOU". A readout that cries wolf on the menu is a readout nobody checks
    // during a run.
    if (crPhase === "menu" || crPhase === "ready") { label = "READY"; cls = "green"; }
    else if (!me || !me.alive) { label = "LOST"; cls = "red"; }
    else if (me.finished) { label = "CLEAR"; cls = "green"; }
    else {
        var d = me.x - crAvalancheX;
        if (d < 70) { label = "RED"; cls = "red"; }
        else if (d < 170) { label = "YELLOW"; cls = "yellow"; }
    }
    crSetText(node, label);
    if (node.className !== "cab-cond " + cls) node.className = "cab-cond " + cls;
}

// One block per player: lit in their own colour while they are running, dim
// once they are parked on a catwalk, red when the cliff got them.
function crPanelLives() {
    var host = crPanelEls.lives;
    if (!host) return;
    if (host.childNodes.length !== crPlayers.length) {
        host.innerHTML = "";
        for (var k = 0; k < crPlayers.length; k++) {
            var d = document.createElement("div");
            d.className = "life";
            host.appendChild(d);
        }
    }
    for (var i = 0; i < crPlayers.length; i++) {
        var p = crPlayers[i];
        var node = host.childNodes[i];
        var want = !p.alive ? "#FF2233" : (p.finished ? "#2E3A34" : p.color);
        if (node.style.background !== want) node.style.background = want;
        var title = p.name + (p.alive ? (p.finished ? " — IN" : "") : " — DOWN");
        if (node.getAttribute("data-t") !== title) {
            node.setAttribute("data-t", title);
            node.title = title;
        }
    }
}

// ===================================================
//   NEXT
// ===================================================
// The level's objective, overridden by whatever is actually about to happen to
// you. Checked in order of how little time you have to react.
function crPanelNext(me) {
    var node = crPanelEls.next;
    if (!node || !crLevel) return;
    var text = crLevel.objective;

    if (crPhase === "menu") text = "PRESS START";
    else if (crPhase === "ready") text = crLevel.objective;
    else if (me && me.alive && !me.finished) {
        if (me.x - crAvalancheX < 70) text = "MOVE — THE WALL IS ON YOU";
        else if (me.x > crLevel.finishCol * CR_TILE - 140) text = "TAKE A CATWALK";
        else {
            var wall = crPanelWallAhead(me);
            if (wall) text = me.bombs > 0 ? "BOMB THE WALL" : "FIND A BOMB";
            else if (crPanelGustAhead(me)) text = "RIDE THE GUST";
        }
    } else if (me && !me.alive) {
        text = "ONLY BOTS LEFT";
    } else if (me && me.finished) {
        text = "WAIT FOR THE CLIFF";
    }
    crSetText(node, text);
}

function crPanelWallAhead(me) {
    var c0 = Math.floor(me.x / CR_TILE);
    for (var c = c0; c < c0 + 12 && c < crLevel.cols; c++) {
        for (var r = 0; r < CR_ROWS; r++) {
            if (crGet(crLevel, c, r) === CR_T.BREAK) return true;
        }
    }
    return false;
}

function crPanelGustAhead(me) {
    for (var i = 0; i < crLevel.gusts.length; i++) {
        var g = crLevel.gusts[i];
        if (g.dir !== "up") continue;
        if (g.x > me.x && g.x < me.x + 120) return true;
    }
    return false;
}

// ===================================================
//   THE RADAR
// ===================================================
function crPanelRadar() {
    var c = crRadarCtx;
    if (!c || !crLevel) return;
    var W = crPanelEls.radar.width, H = crPanelEls.radar.height;
    var sx = W / crLevel.worldW;
    var sy = H / CR_VH;

    c.fillStyle = "#000000";
    c.fillRect(0, 0, W, H);

    // Terrain. Sampled every other column: at ~1.3px per column, drawing all
    // of them is twice the work for a mark you cannot see.
    var tw = Math.max(1, Math.ceil(sx * 2));
    var th = Math.max(1, Math.ceil(sy * CR_TILE));
    c.fillStyle = CR_INK.rockMid;
    for (var col = 0; col < crLevel.cols; col += 2) {
        for (var row = 0; row < CR_ROWS; row++) {
            var code = crGet(crLevel, col, row);
            if (code === CR_T.EMPTY || code === CR_T.CATWALK) continue;
            if (code === CR_T.BREAK || code === CR_T.VENT) continue;
            c.fillRect(col * CR_TILE * sx, row * CR_TILE * sy, tw, th);
        }
    }

    // The things you navigate BY, over the top of the terrain.
    var i;
    c.fillStyle = CR_INK.amber;
    for (col = 0; col < crLevel.cols; col++) {
        for (row = 0; row < CR_ROWS; row++) {
            if (crGet(crLevel, col, row) !== CR_T.BREAK) continue;
            c.fillRect(col * CR_TILE * sx - 1, row * CR_TILE * sy, Math.max(2, tw), th);
        }
    }
    for (i = 0; i < crLevel.vents.length; i++) {
        var v = crLevel.vents[i];
        c.fillStyle = v.dir === "left" ? CR_INK.magenta : CR_INK.cyan;
        c.fillRect(v.col * CR_TILE * sx - 1, v.row * CR_TILE * sy, 2, Math.max(2, th));
    }
    c.fillStyle = CR_INK.cyan;
    for (i = 0; i < crLevel.catwalks.length; i++) {
        var cw = crLevel.catwalks[i];
        c.fillRect(cw.col0 * CR_TILE * sx, cw.row * CR_TILE * sy,
                   Math.max(2, (cw.col1 - cw.col0) * CR_TILE * sx), Math.max(2, th));
    }

    // Where the screen currently is, and where the wall currently is.
    c.strokeStyle = CR_INK.dim;
    c.lineWidth = 1;
    c.strokeRect(Math.round(crCam.x * sx) + 0.5, 0.5, Math.round(CR_VW * sx), H - 1);
    c.fillStyle = CR_INK.magenta;
    c.fillRect(Math.round(crAvalancheX * sx), 0, 1, H);

    // Players last, so nothing can hide one.
    for (i = 0; i < crPlayers.length; i++) {
        var p = crPlayers[i];
        if (!p.alive) continue;
        var px = Math.round(p.x * sx) - 1;
        var py = Math.round(p.y * sy) - 1;
        if (p.seat === 0) {
            c.fillStyle = CR_INK.amber;
            c.fillRect(px - 2, py - 2, 7, 7);
        }
        c.fillStyle = p.finished ? CR_INK.cyan : p.color;
        c.fillRect(px, py, 4, 4);
    }
}
