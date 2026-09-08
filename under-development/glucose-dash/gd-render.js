// ===================================================
//   Glucose Dash -- camera and the top-down floor plan renderer
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 1485-2008 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, nothing was reindented.
//
// EVERY FILE CARRIES ITS OWN "use strict". The original script had one at the
// top, covering all 2,363 lines; a classic-script split gives each file its own
// scope for that directive, so omitting it would silently drop files 2-12 into
// sloppy mode. That is a semantic change, not a cosmetic one.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). This game lives under under-development/, so its shared paths
// are ../../shared/, not ../shared/.
"use strict";

/* ===================================================
     CAMERA — orthographic top-down
   ===================================================
   v5 threw out the perspective renderer. Every graphical bug this
   project hit came from the projection: near-plane clipping, depth
   sorting across draw categories, billboarded-vs-wall-plane text,
   white-on-white silhouettes, and a duplicate quad() that hid inside a
   2600-line file for a whole revision. None of those failure modes
   exist here. There is no projection, so nothing can be clipped wrong;
   there is no depth, so draw order is just source order and is
   trivially correct by construction.

   Still FIXED TO THE COURSE AXIS, as decided: forward is up the screen
   and the camera never rotates. The mall winds across the frame because
   centerX(y) genuinely moves, which is the clearest possible reading of
   the curve.

   The course is 35 units wide and we show 136 units of it along, so on
   a wide window the playfield is a ribbon with room either side. That
   space is deliberate: it reads as a floor plan, and the HUD sits in it
   without ever covering the course. */

/* VIEW_BEHIND is not really about seeing behind you -- it sets where the
   runner sits on screen. anchorY = ahead/(ahead+behind), so at 110/26 the
   player sat at 81% down, directly underneath the glucose monitor. 105/40
   puts them at 72%, clear of the HUD on any sensible window, and you get
   to see rivals coming up behind you as a bonus. */
var VIEW_AHEAD = 105, VIEW_BEHIND = 40;
var cam = { y: 0, wx: 0, shake: 0, shakeX: 0, shakeY: 0 };
var VP = { scale: 6, anchorY: 0, cx: 0 };

function updateCamera(dt) {
    cam.y = player.y;
    // Follow the centreline fully and the player's lateral position only
    // partly, so you can feel where you are across the corridor while the
    // hall stays framed.
    var targetWX = centerX(player.y) + player.x * 0.6;
    cam.wx += (targetWX - cam.wx) * Math.min(1, 9 * dt);

    if (cam.shake > 0.05) {
        cam.shake *= Math.max(0, 1 - 7 * dt);
        cam.shakeX = (Math.random() - 0.5) * cam.shake;
        cam.shakeY = (Math.random() - 0.5) * cam.shake;
    } else { cam.shake = 0; cam.shakeX = 0; cam.shakeY = 0; }

    VP.scale = VIEW.h / (VIEW_AHEAD + VIEW_BEHIND);
    VP.anchorY = VIEW.h * (VIEW_AHEAD / (VIEW_AHEAD + VIEW_BEHIND));

    /* Where the corridor sits horizontally. Centred when there's room,
       but slid left when the window is too narrow for both the ribbon and
       the bottom-right HUD cluster -- otherwise the runner ends up behind
       the glucose monitor, which is the one thing that must never happen
       in a game about reading the glucose monitor. */
    var halfW = (bayOut(0) + 6) * VP.scale;
    var minC = halfW + 34;                        // clear of the progress rail
    var maxC = VIEW.w - 300 - halfW;              // clear of the HUD cluster
    VP.cx = Math.max(minC, Math.min(VIEW.w * 0.5, Math.max(minC, maxC)));
}

function shake(a) { cam.shake = Math.min(26, cam.shake + a); }

/* Track space -> screen. SX needs the y as well as the x because the
   centreline moves: that one term is the entire curvature implementation
   on the render side. */
function SX(tx, ty) { return VP.cx + ((tx + centerX(ty)) - cam.wx) * VP.scale + cam.shakeX; }
function SY(ty)     { return VP.anchorY - (ty - cam.y) * VP.scale + cam.shakeY; }


/* ===================================================
     RENDER — top-down floor plan
   =================================================== */

var C = {
    outside:   "#e8ebf0",
    shell:     "#d3d8e0",
    shellEdge: "#b9c0cc",
    tile:      ["#f8f7f4", "#f4f7f9", "#f6f9fb"],
    tileAlt:   ["#e6e2da", "#dfe6ec", "#e2ebef"],
    wall:      "#8d95a6",
    aisle:     "#e3ded4",
    below1:    "#c7ccd6",
    below2:    "#b4bac6",
    belowEdge: "#a4abb9",
    hazDark:   "#2c3242",
    hazLight:  "#fcbc2a",
    rampUp:    "#12b886",
    rampDown:  "#f59f00",
    ink:       "#39415a"
};

/* ===================================================
     THE GEL -- AESTHETIC_GUIDE.md 6.5 (option a) and 4.5
   ===================================================
   Space Invaders was black and white. Its green ground and the coloured band
   across the top were STRIPS OF TRANSPARENT PLASTIC taped to the tube: hard
   edges, no gradient, because it was a physical sheet with a scissor cut.

   6.5 offers two routes for this game and is explicit that option (b) --
   inverting to a black ground -- "overturns a deliberate call, so it is the
   user's decision, not a silent change." That decision has not been made, so
   this is (a): the white mall stays and each storey gets its own sheet, so the
   three floors read as three physically different strips of plastic.

   WHY THIS DOES NOT VIOLATE RULE 1. glucose-dash/CLAUDE.md's first rule is that
   pathWalkable(f) is the single source of floor geometry -- the fill, the
   checkerboard clip and the wall stroke all come off that one path, because when
   the drawn floor and the walkable floor disagreed, every upper storefront had
   an invisible hole at each end. The gel adds NO geometry. It is a multiply pass
   laid INSIDE the clip pathWalkable() already established, so it covers exactly
   the floor that path describes and cannot drift from it by construction.

   And the storefronts still win. They are drawn AFTER the floor plate, on top of
   the gel, so 6.5's protected intent -- "all the colour saved for the
   storefronts so the thing you're steering toward is the only saturated object
   on screen" -- survives: the gel tints the ground, never the goal. */
var GEL = [
    "#C9F5D4",   // ground -- green, and green on the bottom band is literally
                 //           what Space Invaders' own gel did
    "#BFE9FF",   // first  -- blue
    "#FFC2DC"    // second -- pink, this game's --world-hue as a sheet
];
/* Ordered green-blue-pink rather than pink-blue-green on the first pass, for two
   reasons that only showed up on screen. Space Invaders' sheet put GREEN across
   the bottom of the tube, where the player was; and the storefront signage in
   this game runs warm, so a pink ground floor sat pink-on-red against it and
   cost the storefronts exactly the separation 6.5 says to protect. Green on the
   floor you spend the most time on gives the warm signage the most contrast.
   Pink ends up on the second storey, which is also the one with no railings. */

var PATH_STEP = 4;      // world units between points when tracing a curved edge
var TILE = 4.0;         // floor tile size, world units

function rgb(c) { return "rgb(" + (c[0] | 0) + "," + (c[1] | 0) + "," + (c[2] | 0) + ")"; }
function mixc(a, b, t) { return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]; }
var _hexCache = {};
function hexRgb(h) {
    if (_hexCache[h]) return _hexCache[h];
    var v = [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
    _hexCache[h] = v;
    return v;
}
function hexA(hex, a) {
    var c = hexRgb(hex);
    return "rgba(" + c[0] + "," + c[1] + "," + c[2] + "," + a + ")";
}

function viewY0() { return cam.y - VIEW_BEHIND - 8; }
function viewY1() { return cam.y + VIEW_AHEAD + 10; }

/* One closed path per rectangular strip, always wound the same way
   (up the smaller-x edge, back down the larger-x edge) so that several
   subpaths union cleanly under the nonzero fill rule instead of
   cancelling each other out. */
function stripSubpath(xa, xb, y0, y1) {
    var lo = Math.min(xa, xb), hi = Math.max(xa, xb), y;
    ctx.moveTo(SX(lo, y0), SY(y0));
    for (y = y0; y < y1; y += PATH_STEP) ctx.lineTo(SX(lo, y), SY(y));
    ctx.lineTo(SX(lo, y1), SY(y1));
    ctx.lineTo(SX(hi, y1), SY(y1));
    for (y = y1; y > y0; y -= PATH_STEP) ctx.lineTo(SX(hi, y), SY(y));
    ctx.lineTo(SX(hi, y0), SY(y0));
    ctx.closePath();
}

/* The complete walkable region of a floor: corridor + storefront
   platforms + stair aprons. Everything else -- filling it, clipping the
   checkerboard to it, stroking its outline as either a wall or a
   hazard-striped cliff edge -- is done from this one path, so the floor
   you can see and the floor you can stand on cannot disagree. */
function pathWalkable(f, y0, y1) {
    ctx.beginPath();
    var hh = hallHalf(f);
    stripSubpath(-hh, hh, y0, y1);

    var i, st;
    for (i = 0; i < stores.length; i++) {
        st = stores[i];
        if (st.floor !== f) continue;
        if (st.y1 < y0 || st.y0 > y1) continue;
        var run = (f === 0) ? 0 : BAY_RUNOFF;
        stripSubpath(st.side * hh, st.side * bayOut(f),
                     Math.max(y0, st.y0 - run), Math.min(y1, st.y1 + run));
    }

    if (f > 0) {
        for (i = 0; i < RAMPS.length; i++) {
            var ra = RAMPS[i];
            if (ra.full || (ra.from !== f && ra.to !== f)) continue;
            var a = ra.y0 - APRON_IN, b = ra.y1 + APRON_OUT;
            if (b < y0 || a > y1) continue;
            stripSubpath(ra.side * hh, ra.side * (RAMP_X + RAMP_HALF + 0.6),
                         Math.max(y0, a), Math.min(y1, b));
        }
    }
}

function drawChecker(f, y0, y1) {
    var lo = Math.floor(y0 / TILE) * TILE;
    var xr = bayOut(f) + TILE;
    var c0 = Math.floor(-xr / TILE), c1 = Math.ceil(xr / TILE);
    ctx.fillStyle = C.tileAlt[Math.min(2, f)];
    for (var y = lo; y < y1; y += TILE) {
        var row = Math.floor(y / TILE);
        for (var c = c0; c < c1; c++) {
            if (((row + c) & 1) === 0) continue;      // base fill is the other colour
            var xa = c * TILE, xb = xa + TILE;
            ctx.beginPath();
            ctx.moveTo(SX(xa, y), SY(y));
            ctx.lineTo(SX(xb, y), SY(y));
            ctx.lineTo(SX(xb, y + TILE), SY(y + TILE));
            ctx.lineTo(SX(xa, y + TILE), SY(y + TILE));
            ctx.closePath();
            ctx.fill();
        }
    }
}

/* Every level beneath you, drawn first and then covered by your own
   floor. Whatever is left showing IS the drop -- so the hole you can
   fall through is exactly the hole you can see, with no separate
   "void" geometry to get out of step with the collision test. */
function drawFloorsBelow(f, y0, y1) {
    for (var lo = f - 1; lo >= 0; lo--) {
        pathWalkable(lo, y0, y1);
        ctx.fillStyle = (lo === f - 1) ? C.below1 : C.below2;
        ctx.fill();
        ctx.lineWidth = Math.max(1, VP.scale * 0.25);
        ctx.strokeStyle = C.belowEdge;
        ctx.stroke();
    }
}

function drawFloorPlate(f, y0, y1) {
    pathWalkable(f, y0, y1);
    ctx.fillStyle = C.tile[Math.min(2, f)];
    ctx.fill();
    ctx.save();
    ctx.clip();
    drawChecker(f, y0, y1);
    drawFloorMarkings(f, y0, y1);

    /* The gel, last inside the clip so it sits over the tile AND the
       checkerboard -- one sheet over the whole floor, which is what a sheet is.
       multiply, because that is what coloured plastic does to the light coming
       through it. The hard edge 4.5 asks for is the clip itself: the sheet is
       cut to the exact shape of the walkable floor.

       Restoring the composite op explicitly rather than relying on the
       surrounding save/restore would be redundant here -- but drawFloorPlate is
       called once per visible storey, and leaking "multiply" into the next one
       would tint the floors below through each other. The save/restore pair
       below is doing real work, not ceremony. */
    ctx.save();
    ctx.globalCompositeOperation = "multiply";
    ctx.fillStyle = GEL[Math.min(2, f)];
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.restore();

    ctx.restore();
}

function drawFloorMarkings(f, y0, y1) {
    // centre aisle: dashed, and only where there's room for one
    if (hallHalf(f) >= 4) {
        ctx.fillStyle = "rgba(120,128,145,0.28)";
        for (var ly = Math.floor(y0 / 16) * 16; ly < y1; ly += 16) {
            ctx.beginPath();
            ctx.moveTo(SX(-0.35, ly), SY(ly));
            ctx.lineTo(SX(0.35, ly), SY(ly));
            ctx.lineTo(SX(0.35, ly + 7), SY(ly + 7));
            ctx.lineTo(SX(-0.35, ly + 7), SY(ly + 7));
            ctx.closePath();
            ctx.fill();
        }
    }
    // light spilling from each lit storefront
    for (var i = 0; i < stores.length; i++) {
        var st = stores[i];
        if (st.floor !== f || st.y1 < y0 || st.y0 > y1) continue;
        var hh = hallHalf(f);
        ctx.fillStyle = hexA(st.def.sign, (0.085 * st.lit).toFixed(3));
        ctx.beginPath();
        ctx.moveTo(SX(st.side * hh, st.y0), SY(st.y0));
        ctx.lineTo(SX(st.side * Math.max(0.5, hh - 3.0), st.y0), SY(st.y0));
        ctx.lineTo(SX(st.side * Math.max(0.5, hh - 3.0), st.y1), SY(st.y1));
        ctx.lineTo(SX(st.side * hh, st.y1), SY(st.y1));
        ctx.closePath();
        ctx.fill();
    }
    if (f === 0) drawStartFinish2D(y0, y1);
}

function drawStartFinish2D(y0, y1) {
    var hh = hallHalf(0), i, k;
    if (y0 < 6) {
        for (i = -6; i < 6; i++) {
            ctx.fillStyle = (i % 2) ? "rgba(44,50,66,0.55)" : "rgba(255,255,255,0.85)";
            band(i * 2.2, i * 2.2 + 2.2, 0, 2.6);
        }
    }
    if (COURSE_LEN > y0 - 6 && COURSE_LEN < y1 + 6) {
        for (i = -6; i < 6; i++) {
            for (k = 0; k < 2; k++) {
                ctx.fillStyle = ((i + k) % 2) ? "#ffffff" : "#20232e";
                band(i * 2.2, i * 2.2 + 2.2, COURSE_LEN + k * 2.2, COURSE_LEN + k * 2.2 + 2.2);
            }
        }
    }
    function band(xa, xb, ya, yb) {
        ctx.beginPath();
        ctx.moveTo(SX(xa, ya), SY(ya));
        ctx.lineTo(SX(xb, ya), SY(ya));
        ctx.lineTo(SX(xb, yb), SY(yb));
        ctx.lineTo(SX(xa, yb), SY(yb));
        ctx.closePath();
        ctx.fill();
    }
}

/* Ground floor gets a wall. Upper floors get a hazard-striped cliff
   edge, drawn as a dark stroke with a dashed amber stroke over it. */
function drawEdges(f, y0, y1) {
    pathWalkable(f, y0, y1);
    if (f === 0) {
        ctx.lineWidth = Math.max(2.5, VP.scale * 0.95);
        ctx.strokeStyle = C.wall;
        ctx.lineJoin = "round";
        ctx.stroke();
    } else {
        ctx.lineJoin = "round";
        ctx.lineWidth = Math.max(3, VP.scale * 1.25);
        ctx.strokeStyle = C.hazDark;
        ctx.setLineDash([]);
        ctx.stroke();
        ctx.strokeStyle = C.hazLight;
        ctx.setLineDash([VP.scale * 2.2, VP.scale * 2.2]);
        ctx.stroke();
        ctx.setLineDash([]);
    }
}

function drawStores2D(f, y0, y1) {
    var bo = bayOut(f);
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    for (var i = 0; i < stores.length; i++) {
        var st = stores[i];
        if (st.floor !== f || st.y1 < y0 || st.y0 > y1) continue;
        var xi = st.side * bo, xo = st.side * (bo + 3.2);

        ctx.beginPath();
        ctx.moveTo(SX(xi, st.y0), SY(st.y0));
        ctx.lineTo(SX(xo, st.y0), SY(st.y0));
        ctx.lineTo(SX(xo, st.y1), SY(st.y1));
        ctx.lineTo(SX(xi, st.y1), SY(st.y1));
        ctx.closePath();
        ctx.fillStyle = st.def.sign;
        ctx.fill();

        // name, running along the shopfront the way a floor-plan label does
        var lenPx = Math.abs(SY(st.y1) - SY(st.y0));
        var size = Math.min(VP.scale * 1.9, lenPx / (st.name.length * 0.62));
        if (size >= 6) {
            var mid = (st.y0 + st.y1) / 2;
            ctx.save();
            ctx.translate(SX(st.side * (bo + 1.6), mid), SY(mid));
            ctx.rotate(-Math.PI / 2);
            ctx.font = "800 " + size.toFixed(1) + "px Segoe UI, sans-serif";
            ctx.fillStyle = "rgba(255,255,255,0.97)";
            ctx.fillText(st.name, 0, 0);
            ctx.restore();
        }
    }
}

function drawRamps2D(f, y0, y1) {
    for (var i = 0; i < RAMPS.length; i++) {
        var r = RAMPS[i];
        if (r.from !== f && r.to !== f) continue;
        if (r.y1 < y0 || r.y0 > y1) continue;

        var up = r.to > r.from;
        var mine = (r.from === f);
        var x = r.full ? 0 : r.side * RAMP_X;
        var half = r.full ? hallHalf(r.from) : RAMP_HALF;
        var xa = x - half, xb = x + half;

        ctx.beginPath();
        ctx.moveTo(SX(xa, r.y0), SY(r.y0));
        ctx.lineTo(SX(xb, r.y0), SY(r.y0));
        ctx.lineTo(SX(xb, r.y1), SY(r.y1));
        ctx.lineTo(SX(xa, r.y1), SY(r.y1));
        ctx.closePath();
        ctx.fillStyle = mine ? "#eef0f4" : "#dce0e8";
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, VP.scale * 0.35);
        ctx.strokeStyle = up ? C.rampUp : C.rampDown;
        ctx.stroke();

        // treads
        ctx.strokeStyle = "rgba(90,98,118,0.35)";
        ctx.lineWidth = Math.max(1, VP.scale * 0.16);
        for (var t = r.y0 + 4; t < r.y1; t += 4.5) {
            ctx.beginPath();
            ctx.moveTo(SX(xa, t), SY(t));
            ctx.lineTo(SX(xb, t), SY(t));
            ctx.stroke();
        }

        if (!mine) continue;

        // direction chevrons at the mouth
        ctx.fillStyle = up ? C.rampUp : C.rampDown;
        for (var ch = 0; ch < 3; ch++) {
            var cy = r.y0 - 8 + ch * 3.0;
            ctx.beginPath();
            ctx.moveTo(SX(x, cy + 2.2), SY(cy + 2.2));
            ctx.lineTo(SX(x - half * 0.65, cy), SY(cy));
            ctx.lineTo(SX(x + half * 0.65, cy), SY(cy));
            ctx.closePath();
            ctx.fill();
        }
        var lbl = (up ? "▲ " : "▼ ") + (r.to + 1);
        ctx.textAlign = "center"; ctx.textBaseline = "middle";
        ctx.font = "900 " + Math.max(9, VP.scale * 1.7).toFixed(1) + "px Segoe UI, sans-serif";
        ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,0.92)"; ctx.lineJoin = "round";
        ctx.strokeText(lbl, SX(x, r.y0 + 6), SY(r.y0 + 6));
        ctx.fillStyle = up ? C.rampUp : C.rampDown;
        ctx.fillText(lbl, SX(x, r.y0 + 6), SY(r.y0 + 6));
    }
}

function drawItems2D(f, y0, y1) {
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    for (var i = 0; i < items.length; i++) {
        var it = items[i];
        if (it.taken || it.floor !== f) continue;
        if (it.y < y0 || it.y > y1) continue;
        var px = SX(it.x, it.y), py = SY(it.y);
        var food = FOODS[it.food];
        var col = GI_COLOR[food.gi];
        var rad = VP.scale * 2.1;
        var pulse = 1 + Math.sin(raceTime * 3 + it.bob) * 0.06;

        ctx.beginPath();
        ctx.arc(px, py, rad * pulse, 0, 6.284);
        ctx.fillStyle = hexA(col, "0.20");
        ctx.fill();
        ctx.lineWidth = Math.max(1.5, VP.scale * 0.3);
        ctx.strokeStyle = col;
        ctx.stroke();

        ctx.beginPath();
        ctx.arc(px, py, rad * 0.68, 0, 6.284);
        ctx.fillStyle = "rgba(255,255,255,0.92)";
        ctx.fill();

        ctx.font = (rad * 1.05).toFixed(1) + "px Segoe UI Emoji, Apple Color Emoji, serif";
        ctx.fillText(food.icon, px, py);
    }
}

/* Runners seen from directly above: a coloured shoulder disc with the
   white top of the head inside it, and a nose wedge for heading -- which
   matters, because with car-style physics you are often not travelling
   the way you are pointing. Falling shrinks the runner toward a landing
   ring on the floor below, which is the top-down reading of "going
   down". */
function drawRunners2D(f, y0, y1) {
    for (var i = 0; i < runners.length; i++) {
        var r = runners[i];
        if (Math.abs(r.z - player.z) > FLOOR_H * 0.8 && !r.fall) continue;
        if (r.y < y0 - 6 || r.y > y1 + 6) continue;

        var px = SX(r.x, r.y), py = SY(r.y);
        var fallT = r.fall ? Math.min(1, r.fall.t / r.fall.dur) : 0;
        var shrink = 1 - fallT * 0.45;
        var rad = VP.scale * 1.95 * shrink;

        if (r.fall) {
            ctx.beginPath();
            ctx.arc(px, py, VP.scale * 2.6, 0, 6.284);
            ctx.strokeStyle = "rgba(244,69,63," + (0.75 * (1 - fallT)).toFixed(2) + ")";
            ctx.lineWidth = Math.max(1.5, VP.scale * 0.3);
            ctx.stroke();
        }

        ctx.save();
        ctx.globalAlpha = r.dnf ? 0.45 : (r.fall ? 1 - fallT * 0.35 : 1);

        /* Heading wedge. With car-style physics you are frequently not
           travelling the way you are pointing, and from directly above a
           disc has no facing at all -- so this is the only cue for which
           way you'll go when you next touch the throttle. It has to be
           solid, not a hint. */
        if (!r.fall) {
            var hx = Math.sin(r.heading), hy = Math.cos(r.heading);
            ctx.beginPath();
            ctx.moveTo(px + hx * rad * 2.4, py - hy * rad * 2.4);
            ctx.lineTo(px + hy * rad * 0.95, py + hx * rad * 0.95);
            ctx.lineTo(px - hy * rad * 0.95, py - hx * rad * 0.95);
            ctx.closePath();
            ctx.fillStyle = hexA(r.color, "0.75");
            ctx.fill();
        }

        // soft contact shadow so runners sit ON the floor plan, not in it
        ctx.beginPath();
        ctx.arc(px + rad * 0.16, py + rad * 0.22, rad, 0, 6.284);
        ctx.fillStyle = "rgba(40,48,68,0.16)";
        ctx.fill();

        // shoulders
        ctx.beginPath();
        ctx.arc(px, py, rad, 0, 6.284);
        ctx.fillStyle = r.color;
        ctx.fill();
        ctx.lineWidth = Math.max(1, rad * 0.16);
        ctx.strokeStyle = "rgba(40,46,64,0.35)";
        ctx.stroke();

        // top of the head
        ctx.beginPath();
        ctx.arc(px, py, rad * 0.44, 0, 6.284);
        ctx.fillStyle = "#ffffff";
        ctx.fill();

        if (r.sprintT > 0 && !r.fall) {
            ctx.beginPath();
            ctx.arc(px, py, rad * 1.9, 0, 6.284);
            ctx.strokeStyle = "rgba(18,184,134,0.8)";
            ctx.lineWidth = Math.max(1.5, rad * 0.22);
            ctx.stroke();
        }
        ctx.restore();

        if (r.eating) {
            ctx.textAlign = "center"; ctx.textBaseline = "middle";
            ctx.font = (rad * 1.5).toFixed(1) + "px Segoe UI Emoji, serif";
            ctx.fillText(FOODS[r.eating].icon, px + rad * 2.0, py - rad * 1.6);
        }

        if (!r.isPlayer) {
            ctx.textAlign = "center"; ctx.textBaseline = "bottom";
            ctx.font = "700 " + Math.max(9, VP.scale * 1.5).toFixed(1) + "px Segoe UI, sans-serif";
            ctx.lineWidth = 3; ctx.strokeStyle = "rgba(255,255,255,0.9)"; ctx.lineJoin = "round";
            ctx.strokeText(r.name, px, py - rad * 1.9);
            ctx.fillStyle = C.ink;
            ctx.fillText(r.name, px, py - rad * 1.9);
        }
    }
}

function render() {
    var f = player.floor;
    var y0 = viewY0(), y1 = viewY1();

    ctx.setTransform(VIEW.dpr, 0, 0, VIEW.dpr, 0, 0);
    ctx.fillStyle = C.outside;
    ctx.fillRect(0, 0, VIEW.w, VIEW.h);

    // the building footprint, so the mall reads as a building on a plan
    ctx.beginPath();
    stripSubpath(-(bayOut(0) + 5), bayOut(0) + 5, y0, y1);
    ctx.fillStyle = C.shell;
    ctx.fill();
    ctx.lineWidth = Math.max(1.5, VP.scale * 0.4);
    ctx.strokeStyle = C.shellEdge;
    ctx.stroke();

    // Draw order is just source order -- there is no depth to get wrong.
    if (f > 0) drawFloorsBelow(f, y0, y1);
    drawFloorPlate(f, y0, y1);
    drawRamps2D(f, y0, y1);
    drawEdges(f, y0, y1);
    drawStores2D(f, y0, y1);
    drawItems2D(f, y0, y1);
    drawRunners2D(f, y0, y1);
}


