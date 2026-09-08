// ===================================================
//   4D Pong -- the RASTER cabinet
// ===================================================
// AESTHETIC_GUIDE.md 6.6: "Pure white on pure black, square paddles, square
// ball, dashed centre line, enormous blocky score." Anchor: Pong (1972), which
// makes this the guide's reference Raster cabinet ( 8.2 lists it as the game
// that proves the Raster path the way Boids proves the Vector one).
//
// The world hue is #FFFFFF, so there is no tint to spend: this cabinet's
// entire identity is white geometry, the Signal Three, and hard edges.
//
// EVERY DRAW CALL SNAPS TO A 4px GRID AND NOTHING ELSE DOES. 4.4 is explicit
// that quantizing physics produces collision bugs that present as gameplay
// bugs; fp-entities.js holds floats and RETRO.snap() is applied here, at the
// last possible moment, exactly as Glucose Dash confines its curve to SX().
"use strict";

// Short aliases, used on nearly every line below. GRID is the virtual pixel
// this cabinet draws on; snapPx() is the ONLY place quantization happens.
var GRID = SNAP;
function snapPx(v) { return RETRO.snap(v, GRID); }

// ===================================================
//   PHOSPHOR PERSISTENCE ON A TRANSPARENT LAYER
// ===================================================
// 4.1 paints translucent BLACK over the frame instead of clearing it, and
// RETRO.persist() does exactly that -- source-over, which assumes the canvas
// it is decaying is the opaque ground.
//
// This canvas is NOT the ground. #fpBack sits behind it carrying the barbells,
// and painting black over #fpField would bury them within a few frames. So the
// decay is done with destination-out, which removes a fraction of the existing
// ALPHA and leaves the layer transparent: the same visual result, composited
// correctly against what is behind.
//
// It lives here rather than in shared/retro.js on that file's own rule --
// "only the techniques used by MORE THAN ONE game live here" -- and it stops
// being a one-game trick the moment a second game stacks two canvases.
function persistLayer(ctx, w, h, alpha) {
    var prevOp = ctx.globalCompositeOperation;
    var prevAlpha = ctx.globalAlpha;
    ctx.globalCompositeOperation = "destination-out";
    ctx.globalAlpha = 1;
    ctx.fillStyle = "rgba(0,0,0," + alpha + ")";
    ctx.fillRect(0, 0, w, h);
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = prevAlpha;
}

function rect(ctx, x, y, w, h, color, alpha) {
    ctx.globalAlpha = (alpha === undefined) ? 1 : alpha;
    ctx.fillStyle = color;
    ctx.fillRect(snapPx(x), snapPx(y), Math.max(GRID, snapPx(w)), Math.max(GRID, snapPx(h)));
    ctx.globalAlpha = 1;
}

// ===================================================
//   ARENA
// ===================================================
// A wall and a goal must not look alike -- in the four-paddle modes that is
// the difference between "bounce off it" and "lose the game through it". Walls
// are solid world-hue; goals are a dim dashed rule.
function drawArena(ctx) {
    var hue = tokenColor("--world-hue");
    var dim = tokenColor("--phos-dim");
    var dual = mode.axes === 2;

    ctx.save();

    // Goal lines: left and right always, top and bottom only when they are
    // goals rather than walls.
    ctx.setLineDash([GRID * 2, GRID * 2]);
    ctx.strokeStyle = dim;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(snapPx(field.x), snapPx(field.y)); ctx.lineTo(snapPx(field.x), snapPx(field.y + field.h));
    ctx.moveTo(snapPx(field.x + field.w), snapPx(field.y)); ctx.lineTo(snapPx(field.x + field.w), snapPx(field.y + field.h));
    if (dual) {
        ctx.moveTo(snapPx(field.x), snapPx(field.y)); ctx.lineTo(snapPx(field.x + field.w), snapPx(field.y));
        ctx.moveTo(snapPx(field.x), snapPx(field.y + field.h)); ctx.lineTo(snapPx(field.x + field.w), snapPx(field.y + field.h));
    }
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.restore();

    // Walls, two-paddle modes only. Solid, thick, unmistakably not a goal.
    if (!dual) {
        rect(ctx, field.x, field.y - 4, field.w, 4, hue, 0.9);
        rect(ctx, field.x, field.y + field.h, field.w, 4, hue, 0.9);
    } else {
        drawCornerBumpers(ctx, hue);
    }

    // 6.6's dashed centre line. With four goals the centre line is a CROSS,
    // because a single line would only divide one of the two contests.
    var dashLen = GRID * 4, gap = GRID * 3;
    var cx = field.x + field.w / 2, cy = field.y + field.h / 2;
    var yy;
    for (yy = field.y; yy < field.y + field.h; yy += dashLen + gap) {
        rect(ctx, cx - GRID / 2, yy, GRID, Math.min(dashLen, field.y + field.h - yy), dim, 0.85);
    }
    if (dual) {
        for (var xx = field.x; xx < field.x + field.w; xx += dashLen + gap) {
            rect(ctx, xx, cy - GRID / 2, Math.min(dashLen, field.x + field.w - xx), GRID, dim, 0.85);
        }

        // THE MIDDLE GROUND, drawn as a PLUS rather than a square.
        //
        // That is not a stylistic choice, it is what the reachable area
        // actually is. The left and right paddles can enter a vertical band of
        // NEUTRAL_ZONE width at any height; the top and bottom paddles can
        // enter a horizontal band at any width. Their union is a plus. Drawing
        // the intersection alone (the centre square) would tell three quarters
        // of a lie about where a paddle may go.
        //
        // The two bands are drawn separately and overlap, so the centre square
        // -- the only place all four can meet, and where the power-up spawns --
        // comes out brighter for free.
        rect(ctx, cx - NEUTRAL_ZONE / 2, field.y, NEUTRAL_ZONE, field.h, dim, 0.1);
        rect(ctx, field.x, cy - NEUTRAL_ZONE / 2, field.w, NEUTRAL_ZONE, dim, 0.1);
    } else {
        // The neutral zone the depth shuffle is bounded by. Kept from the
        // original, redrawn as a hard-edged band rather than a soft wash.
        rect(ctx, cx - NEUTRAL_ZONE / 2, field.y, NEUTRAL_ZONE, field.h, dim, 0.16);
    }
}

// The diagonals that stop a 45-degree ball crossing a corner no paddle can
// reach. See FOUR_D_PONG_PLAN.md 2.3 -- they are load-bearing, not trim.
function drawCornerBumpers(ctx, hue) {
    var c = cornerSize();
    if (c <= 0) return;
    var x0 = field.x, y0 = field.y, x1 = field.x + field.w, y1 = field.y + field.h;

    ctx.save();
    ctx.strokeStyle = hue;
    ctx.globalAlpha = 0.9;
    ctx.lineWidth = 4;
    ctx.lineCap = "square";
    ctx.beginPath();
    ctx.moveTo(snapPx(x0), snapPx(y0 + c)); ctx.lineTo(snapPx(x0 + c), snapPx(y0));
    ctx.moveTo(snapPx(x1 - c), snapPx(y0)); ctx.lineTo(snapPx(x1), snapPx(y0 + c));
    ctx.moveTo(snapPx(x1), snapPx(y1 - c)); ctx.lineTo(snapPx(x1 - c), snapPx(y1));
    ctx.moveTo(snapPx(x0 + c), snapPx(y1)); ctx.lineTo(snapPx(x0), snapPx(y1 - c));
    ctx.stroke();
    ctx.restore();
}

// ===================================================
//   PADDLES
// ===================================================
// White, and ONLY white. 6.6 asks for pure white on pure black, the world
// hue says the same, and in four-way pong the seat is already unambiguous from
// its edge -- a paddle on the left edge is the left player, no legend needed.
//
// A PADDLE IS NEVER TINTED WITH THE PLAYER'S IDENTITY COLOUR. The first pass
// capped the local player's paddle ends with it, and that is 2.3's failure
// mode exactly: the current palette has an entry 1 degree of hue from signal
// magenta (AESTHETIC_GUIDE 2.4 measures it and flags it as unfixed until the
// palette migration lands), and magenta on a paddle already MEANS desperate in
// this game. An unlucky player would have shipped a paddle that permanently
// read as "about to lose".
//
// The identity colour moved to the seat LABEL instead -- see drawSeatLabels().
// Text carries no semantic colour here, so nothing collides.
function drawPaddles(ctx) {
    var hot = tokenColor("--phos-hot");
    var dim = tokenColor("--phos-dim");
    var magenta = tokenColor("--sig-magenta");
    var live = activeSeats();

    for (var i = 0; i < live.length; i++) {
        var seat = live[i];
        var r = seatRect(seat);
        var color = seat.stunned ? dim : (seat.desperate ? magenta : hot);
        rect(ctx, r.x, r.y, r.w, r.h, color);

        // A stunned paddle also gets a hollow core, so "I cannot move" is
        // legible at a glance and not only from a colour a colourblind player
        // may not separate from white.
        if (seat.stunned) {
            ctx.globalCompositeOperation = "destination-out";
            rect(ctx, r.x + GRID, r.y + GRID, r.w - GRID * 2, r.h - GRID * 2, "#000");
            ctx.globalCompositeOperation = "source-over";
        }

    }
}

// ===================================================
//   BALL, BLASTERS, PARTICLES, POWER-UP
// ===================================================
function drawBall(ctx) {
    if (!ball) return;
    rect(ctx, ball.x - BALL_HALF, ball.y - BALL_HALF, BALL_SIZE, BALL_SIZE, tokenColor("--phos-hot"));
}

function drawBlasters(ctx) {
    var magenta = tokenColor("--sig-magenta");
    var hot = tokenColor("--phos-hot");
    for (var i = 0; i < blasters.length; i++) {
        var b = blasters[i];
        rect(ctx, b.x, b.y, b.w, b.h, b.hot ? magenta : hot);
    }
}

// 4.7 -- the flicker budget. Past the cap the overflow renders on alternating
// frames, which is both what era hardware did when too many sprites shared a
// scanline AND a real halving of the draw cost. Desperation sprays hardest
// exactly when the field is busiest, which is what makes this the right home
// for it in this game.
function drawParticles(ctx) {
    var magenta = tokenColor("--sig-magenta");
    var amber = tokenColor("--sig-amber");
    for (var i = 0; i < particles.length; i++) {
        if (!RETRO.flicker(i, 40, frameCount)) continue;
        var p = particles[i];
        rect(ctx, p.x, p.y, p.size, p.size, p.color === "amber" ? amber : magenta, clamp(p.life, 0, 1));
    }
}

function drawPowerup(ctx) {
    if (!powerup || !powerup.active) return;
    // Amber, because 2.2 makes amber mean attention/value/interact in every
    // game in this repo, and a blaster recharge is exactly that. Blinks on a
    // step, not a fade -- nothing in a cabinet eases.
    if ((frameCount >> 4) & 1) return;
    rect(ctx, powerup.x - POWERUP_SIZE / 2, powerup.y - POWERUP_SIZE / 2,
         POWERUP_SIZE, POWERUP_SIZE, tokenColor("--sig-amber"));
}

// ===================================================
//   HUD
// ===================================================
// 6.6's "enormous blocky score". Pong's own score was two digits, so
// RETRO.padScore is called with 2 rather than 3.4's default 6 -- a
// six-digit Pong score would be a bigger anachronism than an unpadded one.
function scoreFont(px) { return px + "px 'Press Start 2P', 'Courier New', monospace"; }
function uiFont(px) { return px + "px 'VT323', 'Courier New', monospace"; }

function drawScores(ctx) {
    var size = Math.max(18, Math.round(Math.min(field.w, field.h) * 0.085));
    var dim = tokenColor("--phos-dim");
    var hot = tokenColor("--phos-hot");
    var cx = field.x + field.w / 2, cy = field.y + field.h / 2;
    var inset = size * 1.4;

    ctx.save();
    ctx.font = scoreFont(size);
    ctx.textBaseline = "top";
    ctx.globalAlpha = 0.55;

    // A SCORE BELONGS NEXT TO ITS OWN GOAL. With two paddles that is Pong's
    // own layout, two numbers flanking the net; with four it has to be the
    // seat's own edge, or the reading is a puzzle. The first arrangement put
    // TOP and BOTTOM both down the left-hand side, where they read as two more
    // numbers belonging to the LEFT player.
    //
    // Each four-seat score is also pushed off centre along its own edge, so it
    // never sits under the barbell that crosses there.
    var pad = size * 0.5;
    var dual = mode.axes === 2;
    var live = activeSeats();

    for (var i = 0; i < live.length; i++) {
        var seat = live[i];
        var txt = RETRO.padScore(seat.goals || 0, 2);
        ctx.fillStyle = (axes[axisOf(seat.index)].lastScorer === seat.index) ? hot : dim;

        if (!dual) {
            ctx.textAlign = (seat.index === LEFT) ? "right" : "left";
            ctx.fillText(txt, snapPx(cx + (seat.index === LEFT ? -inset : inset) * 1.1), snapPx(field.y + inset * 0.4));
            continue;
        }

        switch (seat.index) {
            case LEFT:   ctx.textAlign = "left";   ctx.fillText(txt, snapPx(field.x + pad), snapPx(cy - size * 1.6)); break;
            case RIGHT:  ctx.textAlign = "right";  ctx.fillText(txt, snapPx(field.x + field.w - pad), snapPx(cy - size * 1.6)); break;
            case TOP:    ctx.textAlign = "center"; ctx.fillText(txt, snapPx(cx + size * 2), snapPx(field.y + pad)); break;
            default:     ctx.textAlign = "center"; ctx.fillText(txt, snapPx(cx + size * 2), snapPx(field.y + field.h - pad - size)); break;
        }
    }
    ctx.restore();
}

// A charge bar per seat, drawn flush against that seat's own wall so it can
// never be confused with somebody else's. Replaces the two DOM conic-gradient
// dials the original had, which did not generalise past two players.
function drawCooldowns(ctx) {
    var amber = tokenColor("--sig-amber");
    var dim = tokenColor("--phos-dim");
    var live = activeSeats();
    var LEN = 44, THK = 5, PAD = 7;

    for (var i = 0; i < live.length; i++) {
        var seat = live[i];
        var f = cooldownFraction(seat);
        var full = seat.canShoot;
        var alongY = SEAT_AXIS[seat.index] === "y";
        var bx, by, bw, bh;

        // Placed at a QUARTER along the edge, not the middle. Centred, it sat
        // directly beside a paddle at rest and read as amber paint on a white
        // paddle; a quarter along, it is never behind anything and the barbell
        // plate never lands on it either.
        if (alongY) {
            bx = (seat.index === LEFT) ? field.x - PAD - THK : field.x + field.w + PAD;
            by = field.y + field.h * 0.25 - LEN / 2;
            bw = THK; bh = LEN;
            rect(ctx, bx, by, bw, bh, dim, 0.6);
            rect(ctx, bx, by + LEN * (1 - f), bw, LEN * f, amber, full ? 1 : 0.6);
        } else {
            bx = field.x + field.w * 0.25 - LEN / 2;
            by = (seat.index === TOP) ? field.y - PAD - THK : field.y + field.h + PAD;
            bw = LEN; bh = THK;
            rect(ctx, bx, by, bw, bh, dim, 0.6);
            rect(ctx, bx, by, LEN * f, bh, amber, full ? 1 : 0.6);
        }
    }
}

// Who sits where, and on what keys. Four people at one keyboard need this on
// screen for the first minute and never again, so it is dim and out of the way
// rather than a panel.
function drawSeatLabels(ctx) {
    var dim = tokenColor("--phos-dim");
    var live = activeSeats();
    ctx.save();
    ctx.font = uiFont(15);
    ctx.textBaseline = "middle";

    for (var i = 0; i < live.length; i++) {
        var seat = live[i];
        var tag, tint = null;

        if (net.on) {
            // Online, the label answers the only question that matters mid-game:
            // which of these paddles is which person. Names and colours come
            // from mp-core's peer list, which carries the SERVER's colour --
            // never hashed here. Your own seat says YOU, because reading your
            // own name off a paddle is slower than reading "YOU".
            var owner = net.ownerOf[seat.index];
            if (seat.index === net.mySeat) {
                tag = SEAT_NAMES[seat.index] + "  YOU";
                tint = identity.color;
            } else if (owner) {
                tag = SEAT_NAMES[seat.index] + "  " + String(net.nameOf[owner] || "?").toUpperCase();
                tint = net.colorOf[owner] || null;
            } else {
                tag = SEAT_NAMES[seat.index] + "  CPU";
            }
        } else {
            tag = SEAT_NAMES[seat.index] + (seat.kind === CPU ? " CPU" : "  " + KEY_HINT[seat.index]);
            // The one place the couch game spends the identity colour: the
            // LOCAL player's own label, so the person who clicked through from
            // the hub is the colour the board already gave them. The server's
            // answer wins (MP.selfColor); IDENTITY.colorFromName is the file://
            // fallback, and it is the single client-side implementation in the
            // repo. There is no name->colour function anywhere in this game.
            if (seat.index === LEFT && seat.kind === HUMAN && identity.color) tint = identity.color;
        }

        ctx.fillStyle = tint || dim;

        switch (seat.index) {
            case LEFT:   ctx.textAlign = "left";  ctx.fillText(tag, snapPx(field.x + 8), snapPx(field.y + 14)); break;
            case RIGHT:  ctx.textAlign = "right"; ctx.fillText(tag, snapPx(field.x + field.w - 8), snapPx(field.y + 14)); break;
            case TOP:    ctx.textAlign = "center"; ctx.fillText(tag, snapPx(field.x + field.w / 2), snapPx(field.y - 16)); break;
            default:     ctx.textAlign = "center"; ctx.fillText(tag, snapPx(field.x + field.w / 2), snapPx(field.y + field.h + 16)); break;
        }
    }
    ctx.restore();
}

// ===================================================
//   OVERLAYS
// ===================================================
function centreText(ctx, text, px, color, dy, font) {
    ctx.save();
    ctx.font = (font || scoreFont)(px);
    ctx.fillStyle = color;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(text, snapPx(field.x + field.w / 2), snapPx(field.y + field.h / 2 + (dy || 0)));
    ctx.restore();
}

function drawOverlay(ctx) {
    var big = Math.max(20, Math.round(Math.min(field.w, field.h) * 0.09));

    if (phase === "count") {
        var label = countdown > 0 ? String(countdown) : "GO";
        centreText(ctx, label, big * 1.4, tokenColor("--sig-amber"), 0);
        return;
    }
    if (phase === "paused") {
        rect(ctx, field.x, field.y, field.w, field.h, "#000", 0.62);
        centreText(ctx, "PAUSED", big, tokenColor("--phos-hot"), 0);
        centreText(ctx, "SPACE TO RESUME", 17, tokenColor("--phos-mid"), big * 1.1, uiFont);
        return;
    }
    if (phase === "over") {
        rect(ctx, field.x, field.y, field.w, field.h, "#000", 0.72);
        var who = winnerSeat >= 0 ? SEAT_NAMES[winnerSeat] : "NOBODY";
        var isCpu = winnerSeat >= 0 && seats[winnerSeat] && seats[winnerSeat].kind === CPU;
        centreText(ctx, "GAME OVER", big * 0.8, tokenColor("--phos-mid"), -big * 1.1);
        centreText(ctx, who + (isCpu ? " CPU WINS" : " WINS"), big, tokenColor("--sig-amber"), 0);
        centreText(ctx, "ENTER REMATCH  ·  ESC MENU", 18, tokenColor("--phos-mid"), big * 1.2, uiFont);
    }
}

// ===================================================
//   FRAME
// ===================================================
function renderFrame() {
    frameCount++;

    // 4.1 at the raster rate. Vector cabinets smear (0.18-0.30); a raster
    // tube did not, so 0.6 leaves a one-or-two-frame ghost behind the ball and
    // nothing else.
    persistLayer(fieldCtx, stageW, stageH, RETRO.PERSIST.raster);

    if (!seats.length) return;

    drawArena(fieldCtx);
    drawScores(fieldCtx);
    drawSeatLabels(fieldCtx);
    drawPowerup(fieldCtx);
    drawParticles(fieldCtx);
    drawPaddles(fieldCtx);
    drawBlasters(fieldCtx);
    drawCooldowns(fieldCtx);
    if (phase !== "menu" || attractRunning) drawBall(fieldCtx);
    drawOverlay(fieldCtx);
}
