// ===================================================
//   4D Pong -- the tug-of-war: one scale, or two barbells
// ===================================================
// THE SCORE IS NOT A COUNTER. IT IS A ROPE POSITION.
//
// Each axis owns one signed integer, `pull`. Nobody accumulates points; the
// rope moves, and the game ends when it reaches one end. That is why there is
// no score1/score2 anywhere in this game and why "first person to win the
// tug-o-war wins the whole game" needs no separate win condition -- reaching
// the end of the rope IS the win.
//
//     axis 0  HORIZONTAL   pull +1 when LEFT scores, -1 when RIGHT scores
//     axis 1  VERTICAL     pull +1 when TOP  scores, -1 when BOTTOM scores
//
// 1P / 2P  -- one axis is live, so there is ONE scale: the DOM bar above the
//             stage, which is the bar the game already had.
// 3P / 4P  -- both axes are live, so it "becomes a dual scale": the DOM bar is
//             hidden and TWO BARBELLS are drawn behind the canvas.
//
// ---------------------------------------------------------------------------
// THE TWO VISUALISATIONS MOVE IN OPPOSITE DIRECTIONS, AND THAT IS DELIBERATE
// ---------------------------------------------------------------------------
// The DOM bar is a TERRITORY read, kept exactly as it was: when the left
// player scores, the divider is pushed AWAY from them, into the other player's
// half, and the left player's fill grows. That is what the brief means by
// "shifts as current tug-o-war style".
//
// A barbell is a ROPE read: "when top player scores, the barbell shift closer
// to his side". The whole bar slides TOWARD whoever pulled.
//
// They never appear together -- one axis gets the bar, two axes get the
// barbells -- so nobody has to hold both conventions in their head at once.
// Recording it here because it looks like an inconsistency bug and is not.
"use strict";

// Eased over ~380ms rather than snapped. 3.4 says numbers tick and never
// animate smoothly, and the NUMBER still ticks -- it is the physical rope that
// slides, and a rope that teleports does not read as a rope.
var TUG_TAU = 0.12;
var TUG_EPS = 0.002;     // below this, stop redrawing the back canvas

var axes = [
    { pull: 0, disp: 0, lastScorer: -1 },   // horizontal: LEFT (+) vs RIGHT (-)
    { pull: 0, disp: 0, lastScorer: -1 }    // vertical:   TOP  (+) vs BOTTOM (-)
];

// 10 in the two-paddle modes -- the value the original game already used --
// and 7 with four paddles, because two live axes and four players produce
// goals roughly twice as fast. A 10-pull four-way game outlasts its welcome.
function winPull() { return mode.axes === 2 ? 7 : 10; }

// The desperation threshold scales with the rope length for the same reason.
function desperationAt() { return mode.axes === 2 ? 4 : 6; }

function tugReset() {
    for (var i = 0; i < axes.length; i++) {
        axes[i].pull = 0;
        axes[i].disp = 0;
        axes[i].lastScorer = -1;
    }
    updateTugDom();
    drawBarbells();
}

// The seat OPPOSITE the one that conceded is the one that scored, and it pulls
// its own axis toward itself. Returns the scoring seat index.
function tugScore(concededSeat) {
    var axis = axisOf(concededSeat);
    var scorer = (concededSeat % 2 === 0) ? concededSeat + 1 : concededSeat - 1;

    // SEAT_SIGN -1 seats (LEFT, TOP) pull positive; +1 seats pull negative.
    axes[axis].pull += -SEAT_SIGN[scorer];
    axes[axis].lastScorer = scorer;

    updateTugDom();
    return scorer;
}

// Whoever has reached the end of their rope, or -1. Checked immediately on the
// goal rather than after the slide finishes: the game is decided the moment
// the pull lands, and the barbell finishes travelling under the GAME OVER
// overlay, which looks like follow-through rather than lag.
function tugWinner() {
    var limit = winPull();
    for (var i = 0; i < axes.length; i++) {
        // An axis with no players on it can never be pulled, but guard anyway:
        // a stale pull from a previous mode must not decide a new game.
        if (i === 1 && mode.axes === 1) continue;
        if (axes[i].pull >= limit) return (i === 0) ? LEFT : TOP;
        if (axes[i].pull <= -limit) return (i === 0) ? RIGHT : BOTTOM;
    }
    return -1;
}

// How far behind a seat is on its own axis, in goals. Drives desperation.
function deficitFor(seat) {
    var axis = axisOf(seat.index);
    var mine = -SEAT_SIGN[seat.index] * axes[axis].pull;   // +ve when this seat is ahead
    return -mine;
}

// Eased toward the true pull. Returns true while anything is still moving, so
// the render loop knows whether the back canvas needs another frame.
function tugTick(dt) {
    var moving = false;
    var k = 1 - Math.exp(-dt / TUG_TAU);
    for (var i = 0; i < axes.length; i++) {
        var a = axes[i];
        var gap = a.pull - a.disp;
        if (Math.abs(gap) > TUG_EPS) {
            a.disp += gap * k;
            moving = true;
        } else if (a.disp !== a.pull) {
            a.disp = a.pull;
            moving = true;
        }
    }
    return moving;
}

// ===================================================
//   THE SINGLE SCALE  (1P / 2P)
// ===================================================
function updateTugDom() {
    if (mode.axes === 2) return;
    var pull = axes[0].pull;                       // +ve = LEFT is ahead
    var pct = clamp(50 + (pull / winPull()) * 50, 0, 100);

    tugFillEl.style.width = pct + "%";
    tugDividerEl.style.left = pct + "%";
    tugNetEl.textContent = String(Math.abs(pull));
    tugNetEl.style.color = pull === 0 ? tokenColor("--phos-hot") : tokenColor("--sig-amber");
}

function applyTugMode() {
    var dual = mode.axes === 2;
    tugBarEl.hidden = dual;
    if (!dual) updateTugDom();
    drawBarbells();
}

// ===================================================
//   THE DUAL SCALE  (3P / 4P) -- two barbells, behind the canvas
// ===================================================
// A barbell is a bar with a plate at each end and a knurled centre marker.
// The horizontal one spans the field left-to-right, the vertical one spans it
// top-to-bottom, and they cross at the middle. Each slides bodily toward
// whoever last pulled it.
//
// They are drawn on #fpBack, which sits at a LOWER z-index than #fpField, and
// #fpField paints no ground of its own -- so they are literally behind the
// canvas rather than composited into it. That also means this canvas only has
// to be repainted while a barbell is moving, not once per frame.
var BAR_THICK = 9;
var PLATE_W = 13;
var PLATE_LONG = 48;
var KNURL_W = 7;
var KNURL_LONG = 40;

// ---------------------------------------------------------------------------
// WHY THE BAR IS SHORTER THAN THE FIELD
// ---------------------------------------------------------------------------
// The first version spanned the whole field and slid within the stage margin,
// which left the throw bounded by that margin: about 4px per goal, too small to
// read, and at full pull the plate on the WINNING side slid off the top of the
// stage entirely -- the one moment the reader most wants to see it.
//
// Shortening the bar solves both at once. A barbell at two thirds of the field
// still reads as a barbell, and the room it gives back becomes travel: ~15px
// per goal, with the plates ending up just outside the field at full pull and
// inside it at rest. That is also a better picture of a tug-of-war -- the rope
// gets dragged ACROSS the line rather than shuffling inside a track.
var BAR_SPAN_FRAC = 0.34;    // half-length of the bar, as a fraction of the field
var TUG_THROW_FRAC = 0.20;   // travel from centre to a win line, likewise

function tugThrow(horizontal) {
    return (horizontal ? field.w : field.h) * TUG_THROW_FRAC;
}

function drawBarbells() {
    if (!backCtx) return;
    backCtx.clearRect(0, 0, stageW, stageH);
    if (mode.axes !== 2) return;              // one axis -> the DOM bar has it

    drawOneBarbell(true, axes[0].disp);
    drawOneBarbell(false, axes[1].disp);
}

// `horizontal` picks the orientation; `disp` is the eased pull, in goals.
// Positive disp = LEFT / TOP is winning, so the bar shifts toward the minimum
// edge -- "when top player scores, the barbell shift closer to his side".
function drawOneBarbell(horizontal, disp) {
    var cx = field.x + field.w / 2;
    var cy = field.y + field.h / 2;
    var span = (horizontal ? field.w : field.h) * BAR_SPAN_FRAC;
    var throwPx = tugThrow(horizontal);
    var shift = -(clamp(disp / winPull(), -1, 1)) * throwPx;

    var mid = tokenColor("--phos-mid");
    var dim = tokenColor("--phos-dim");
    var cyan = tokenColor("--sig-cyan");
    var magenta = tokenColor("--sig-magenta");

    backCtx.save();

    // The win lines. Magenta is 2.2's danger signal and this is exactly that:
    // the mark that says somebody is one pull from losing the whole game.
    backCtx.strokeStyle = magenta;
    backCtx.globalAlpha = 0.75;
    backCtx.lineWidth = 2;
    backCtx.setLineDash([6, 6]);
    backCtx.beginPath();
    if (horizontal) {
        var wl = RETRO.snap(cx - throwPx, SNAP), wr = RETRO.snap(cx + throwPx, SNAP);
        backCtx.moveTo(wl, cy - PLATE_LONG); backCtx.lineTo(wl, cy + PLATE_LONG);
        backCtx.moveTo(wr, cy - PLATE_LONG); backCtx.lineTo(wr, cy + PLATE_LONG);
    } else {
        var wt = RETRO.snap(cy - throwPx, SNAP), wb = RETRO.snap(cy + throwPx, SNAP);
        backCtx.moveTo(cx - PLATE_LONG, wt); backCtx.lineTo(cx + PLATE_LONG, wt);
        backCtx.moveTo(cx - PLATE_LONG, wb); backCtx.lineTo(cx + PLATE_LONG, wb);
    }
    backCtx.stroke();
    backCtx.setLineDash([]);

    // The bar. Dim where it crosses the live field so it cannot be mistaken
    // for the ball, full strength in the margin where the plates live.
    var a = horizontal ? RETRO.snap(cx + shift - span, SNAP) : RETRO.snap(cx - BAR_THICK / 2, SNAP);
    var b = horizontal ? RETRO.snap(cy - BAR_THICK / 2, SNAP) : RETRO.snap(cy + shift - span, SNAP);
    var w = horizontal ? RETRO.snap(span * 2, SNAP) : BAR_THICK;
    var h = horizontal ? BAR_THICK : RETRO.snap(span * 2, SNAP);

    // 0.20, not 0.32: at a third opacity the two bars crossing the middle of
    // the field competed with the ball for attention, which is the one thing a
    // background layer must never do. They still read clearly -- the plates and
    // the knurl carry the information, and the bar only has to connect them.
    backCtx.globalAlpha = 0.2;
    backCtx.fillStyle = mid;
    backCtx.fillRect(a, b, w, h);

    // Plates at both ends. Held at half strength: they now sit INSIDE the
    // field when the rope is even, and a full-brightness slab there reads as a
    // fifth paddle. The cyan knurl is the readout; the plates only have to say
    // where the bar ends.
    backCtx.globalAlpha = 0.5;
    backCtx.fillStyle = mid;
    if (horizontal) {
        backCtx.fillRect(a, RETRO.snap(cy - PLATE_LONG / 2, SNAP), PLATE_W, PLATE_LONG);
        backCtx.fillRect(a + w - PLATE_W, RETRO.snap(cy - PLATE_LONG / 2, SNAP), PLATE_W, PLATE_LONG);
    } else {
        backCtx.fillRect(RETRO.snap(cx - PLATE_LONG / 2, SNAP), b, PLATE_LONG, PLATE_W);
        backCtx.fillRect(RETRO.snap(cx - PLATE_LONG / 2, SNAP), b + h - PLATE_W, PLATE_LONG, PLATE_W);
    }

    // The knurled centre marker -- the thing that actually crosses a win line.
    // Cyan because 2.2 makes cyan the system/navigable signal, and this mark
    // is how you read the state of the game at a glance.
    backCtx.fillStyle = cyan;
    if (horizontal) {
        backCtx.fillRect(RETRO.snap(cx + shift - KNURL_W / 2, SNAP), RETRO.snap(cy - KNURL_LONG / 2, SNAP), KNURL_W, KNURL_LONG);
    } else {
        backCtx.fillRect(RETRO.snap(cx - KNURL_LONG / 2, SNAP), RETRO.snap(cy + shift - KNURL_W / 2, SNAP), KNURL_LONG, KNURL_W);
    }

    // Seat labels on the plates, so a glance says which end is whose.
    backCtx.globalAlpha = 0.85;
    backCtx.fillStyle = dim;
    backCtx.font = "13px 'VT323', 'Courier New', monospace";
    backCtx.textAlign = "center";
    backCtx.textBaseline = "middle";
    if (horizontal) {
        backCtx.fillText("L", a + PLATE_W / 2, cy);
        backCtx.fillText("R", a + w - PLATE_W / 2, cy);
    } else {
        backCtx.fillText("T", cx, b + PLATE_W / 2);
        backCtx.fillText("B", cx, b + h - PLATE_W / 2);
    }

    backCtx.restore();
}
