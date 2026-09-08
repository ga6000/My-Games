// ===================================================
//   Glucose Dash -- course build -- the mall geometry
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 570-877 were MOVED VERBATIM and IN
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
     COURSE BUILD
   ===================================================
   Two different randomnesses, and mixing them up would be a real bug:

     COURSE_SEED  -> the mall itself. Constant. Identical on every
                     machine, every run, forever. This is the
                     "one hand-built course" decision, expressed as
                     rhythm parameters instead of 300 coordinates.

     MP.random()  -> which candidate slot in each cluster is stocked
                     this race. Comes from the SERVER's room seed, so
                     everyone in a room is racing for the same shake in
                     the same place. This is the only thing that varies.
*/

function makeRng(seed) {
    var a = seed | 0;
    return function () {
        a |= 0; a = (a + 0x6D2B79F5) | 0;
        var t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

/* Ramps are one-way and always traversed running FORWARD. Up-ramps and
   down-ramps are separate structures -- a two-way staircase would mean
   running backwards down the course, which fights a camera locked to
   the course axis. See SCOPE.md §3.5.

   The last two entries are `full: true` -- escalator banks spanning the
   ENTIRE hall, so they cannot be missed. That's not decoration, it's
   the fix for a real bug: the finish line only exists on the ground
   floor, so a runner who is still on floor 2 at the end of the course
   has no way to finish and runs off the end of the world forever.
   A side staircase can be overshot; a full-width bank funnels
   everyone down whether they meant to or not.

   Don't delete or narrow them without re-checking reachability from
   floor 2 -- MALL_END is only a backstop, not a way out. */
var RAMP_X = 8.0, RAMP_HALF = 2.6;
var MALL_END = COURSE_LEN + 60;
var RAMPS = [
    { side: -1, from: 0, to: 1, y0:  260, y1:  312 },
    { side:  1, from: 1, to: 2, y0:  440, y1:  492 },
    { side:  1, from: 0, to: 1, y0:  580, y1:  632 },
    { side:  1, from: 1, to: 0, y0:  760, y1:  808 },
    { side: -1, from: 1, to: 2, y0:  860, y1:  912 },
    { side: -1, from: 0, to: 1, y0:  960, y1: 1012 },
    { side:  1, from: 2, to: 1, y0: 1060, y1: 1108 },
    { side: -1, from: 1, to: 0, y0: 1200, y1: 1248 },
    { side:  1, from: 0, to: 1, y0: 1340, y1: 1392 },
    { side: -1, from: 2, to: 1, y0: 1420, y1: 1468 },
    { side: -1, from: 1, to: 2, y0: 1520, y1: 1572 },
    { side:  1, from: 1, to: 0, y0: 1620, y1: 1668 },
    { side:  1, from: 0, to: 1, y0: 1780, y1: 1832 },
    { side:  1, from: 2, to: 1, y0: 1880, y1: 1928 },
    { side: -1, from: 1, to: 2, y0: 1980, y1: 2032 },
    { side: -1, from: 1, to: 0, y0: 2100, y1: 2148 },
    { side: -1, from: 0, to: 1, y0: 2260, y1: 2312 },
    { side:  1, from: 2, to: 1, y0: 2340, y1: 2388 },
    { side:  1, from: 1, to: 2, y0: 2460, y1: 2512 },
    { side:  1, from: 1, to: 0, y0: 2600, y1: 2648 },
    { side: -1, from: 0, to: 1, y0: 2760, y1: 2812 },
    { side: -1, from: 2, to: 1, y0: 2860, y1: 2908 },
    { side:  1, from: 1, to: 0, y0: 3000, y1: 3048 },
    { side:  0, from: 2, to: 1, y0: 3080, y1: 3134, full: true },
    { side:  0, from: 1, to: 0, y0: 3170, y1: 3224, full: true }
];

function rampBlocks(side, floor, y0, y1) {
    for (var i = 0; i < RAMPS.length; i++) {
        var r = RAMPS[i];
        if (!r.full && r.side !== side) continue;
        // A ramp occupies its footprint on BOTH the floor it leaves and
        // the floor it arrives at -- you can see and run under/over it.
        if (r.from !== floor && r.to !== floor) continue;
        if (y1 > r.y0 - 10 && y0 < r.y1 + 10) return r;
    }
    return null;
}

/* Storefront rhythm, per floor.

   The ground floor is a busy mall: shops nose to tail. The balconies are
   NOT, and that's structural rather than decorative -- with the ground
   floor's spacing there was no open stretch of railless edge anywhere on
   floor 3 in the entire course, because a storefront platform covered it
   everywhere. The drop you're supposed to be frightened of was invisible.

   Upstairs the shops are fewer, shorter and further apart, so the
   balcony reads as a narrow ledge with the occasional platform hanging
   off it -- which is what makes going up there feel like a decision. */
var LEN_BASE = [34, 28, 24], LEN_RAND = [26, 16, 12];
/* Floor 2 is the TRANSIT floor -- everyone passes through it, and once
   the NPCs started climbing it became the most contested place in the
   mall. At floor-3 spacing it was a dead zone that starved anyone who
   stayed on it. It gets denser shops than the top; floor 3 keeps the
   long exposed ledges. */
var GAP_BASE = [15, 26, 56], GAP_RAND = [20, 24, 40];

function buildStores() {
    var rng = makeRng(COURSE_SEED);
    stores = [];

    for (var f = 0; f < FLOORS; f++) {
        var stock = FLOOR_STOCK[f];
        for (var s = 0; s < 2; s++) {
            var side = s === 0 ? -1 : 1;
            var y = 46 + rng() * 26;
            var guard = 0;

            while (y < COURSE_LEN - 70 && guard++ < 200) {
                var len = LEN_BASE[f] + rng() * LEN_RAND[f];
                var blocked = rampBlocks(side, f, y, y + len);
                if (blocked) { y = blocked.y1 + 14; continue; }

                var kind = stock[Math.floor(rng() * stock.length)];
                var def = STORE_KINDS[kind];
                stores.push({
                    side: side, floor: f, y0: y, y1: y + len,
                    kind: kind, def: def,
                    name: def.names[Math.floor(rng() * def.names.length)],
                    lit: 0.55 + rng() * 0.45
                });
                y += len + GAP_BASE[f] + rng() * GAP_RAND[f];
            }
        }
    }
    stores.sort(function (a, b) { return a.y0 - b.y0; });
}

/* Wall geometry is one polyline per (side, floor). Bays are jogs in it,
   so the same draw loop handles the corridor wall, the jambs and the
   shop back wall without special-casing any of them. */
/* Only the ground floor gets corridor walls. Upstairs the inner edge is
   open air -- that IS the mechanic, so it must not be walled in. */
function buildWalls() {
    wallPaths = {};
    for (var f = 0; f < 1; f++) {
        for (var s = 0; s < 2; s++) {
            var side = s === 0 ? -1 : 1;
            var pts = [{ y: -60, x: side * hallHalf(f) }];
            for (var i = 0; i < stores.length; i++) {
                var st = stores[i];
                if (st.floor !== f || st.side !== side) continue;
                pts.push({ y: st.y0, x: side * hallHalf(f) });
                pts.push({ y: st.y0, x: side * bayOut(f) });
                pts.push({ y: st.y1, x: side * bayOut(f) });
                pts.push({ y: st.y1, x: side * hallHalf(f) });
            }
            pts.push({ y: COURSE_LEN + 90, x: side * hallHalf(f) });
            wallPaths[f + ":" + side] = pts;
        }
    }
}

/* How far off the centre line you can get at this y. Bays are the only
   reason to ever leave the racing line, so the collision range is held
   slightly tighter than the visual one -- clipping a jamb corner at
   25 units/sec feels like a bug even when it's geometrically correct. */
var BAY_MARGIN = 2.2;
/* Upper-floor platforms get RUNOFF past each end of the shop: room to
   straighten up after grabbing something before the floor stops
   existing. Without it the only way off a platform was a turn you had
   to start before you reached the item. */
var BAY_RUNOFF = 3.0;
/* Stair landings, and they are deliberately ASYMMETRIC.

   Entering a staircase you only need enough room to line up (12 units,
   about half a second). LEAVING one you arrive at x=8 on a balcony whose
   walkable half-width is 5 -- so the exit apron has to be long enough to
   actually steer back inside before the floor runs out. At 12 units it
   wasn't: you exited the stairs and fell off immediately, through no
   fault of your own. 28 units is a comfortable second at racing speed.

   EDGE_GRACE is the same idea in miniature: your foot catches the lip.
   Without it a near-miss you were already correcting reads as the game
   cheating you. */
var APRON_IN = 12, APRON_OUT = 28;
var EDGE_GRACE = 0.7;
function walkLimit(side, floor, y) {
    /* Stair aprons first. Without them the approach to an upper-floor
       staircase runs along the very lip of the balcony, and you fall
       while lining the thing up rather than while taking a risk -- which
       reads as the game being broken, not as you being greedy. */
    for (var k = 0; k < RAMPS.length; k++) {
        var ra = RAMPS[k];
        if (ra.from !== floor && ra.to !== floor) continue;
        if (!ra.full && ra.side !== side) continue;
        if (y > ra.y0 - APRON_IN && y < ra.y1 + APRON_OUT) {
            return Math.max(hallHalf(floor), ra.full ? 0 : RAMP_X + RAMP_HALF + 0.6);
        }
    }
    for (var i = 0; i < stores.length; i++) {
        var st = stores[i];
        if (st.floor !== floor || st.side !== side) continue;
        if (st.y0 > y) break;                       // sorted by y0
        /* BAY_MARGIN holds the walkable bay slightly TIGHTER than the
           drawn one so you cannot clip a door jamb at 25 units/sec. That
           is a nicety on the ground floor and a disaster upstairs, where
           "slightly tighter" means the first and last 2.2 units of every
           storefront platform are an invisible hole you fall through
           while visibly standing on the shop floor. Upstairs the drawn
           platform is extended past the walkable one instead. Since v5
           the renderer draws the floor straight from walkLimit's own
           geometry (pathWalkable), so the ground you can see and the
           ground you can stand on cannot drift apart at all. */
        var m = (floor === 0) ? BAY_MARGIN : -BAY_RUNOFF;
        if (y > st.y0 + m && y < st.y1 - m) return bayOut(floor);
    }
    return hallHalf(floor);
}

function bayAt(floor, side, y) {
    for (var i = 0; i < stores.length; i++) {
        var st = stores[i];
        if (st.floor !== floor || st.side !== side) continue;
        var run = (floor === 0) ? 0 : BAY_RUNOFF;
        if (st.y0 - run > y) return null;
        if (y >= st.y0 - run && y <= st.y1 + run) return st;
    }
    return null;
}

function rampNear(floor, side, y) {
    for (var k = 0; k < RAMPS.length; k++) {
        var ra = RAMPS[k];
        if (ra.from !== floor && ra.to !== floor) continue;
        if (!ra.full && ra.side !== side) continue;
        if (y > ra.y0 - APRON_IN && y < ra.y1 + APRON_OUT) return ra;
    }
    return null;
}

/* Food placement.

   Concept decision: "each food type gets 2-3 candidate slots with one
   picked per race." Implemented as: walk the stocked storefronts in
   order, chunk them into threes, light exactly one per chunk. Roughly
   one stocked shop per 130 units per floor, and you can't learn the
   layout by rote -- only the rhythm. */
function buildItems() {
    items = [];
    MP.resetRandom();          // start from the ROOM seed, not wherever
                               // the stream happened to be

    var byFloor = [[], [], []];
    for (var i = 0; i < stores.length; i++) {
        if (stores[i].def.food) byFloor[stores[i].floor].push(stores[i]);
    }

    for (var f = 0; f < FLOORS; f++) {
        var list = byFloor[f];
        /* One stocked shop per chunk of two candidates.

           Was 3 on the ground floor, which was sized for the 1650 course.
           The ground floor stays at 3 -- it is a sugar minefield by
           design, and stocking it densely made running it strictly better
           than climbing, which collapses the whole premise. Upstairs uses
           2, because there are far fewer shops up there to begin with and
           the reward has to be worth the stairs.

           This number and TUNE.baseDecay are the pair that sets the whole
           economy; changing one without re-measuring the other will move
           the balance a long way. */
        var chunkSize = (f === 0) ? 3 : 2;
        for (var c = 0; c < list.length; c += chunkSize) {
            var chunk = list.slice(c, c + chunkSize);
            if (!chunk.length) continue;
            var st = chunk[Math.floor(MP.random() * chunk.length)];
            items.push({
                x: st.side * (hallHalf(f) + (bayOut(f) - hallHalf(f)) * 0.42),
                y: (st.y0 + st.y1) / 2,
                floor: f,
                food: st.def.food,
                taken: false,
                bay: true,          // NPCs need to know this one is off the safe line
                bob: MP.random() * 6.28
            });
        }
    }

    /* The centre-aisle shakes. These are the contested items -- the
       reason sprint exists. Always stocked, always on the racing line,
       always worth fighting for. */
    var aisles = [380, 760, 1130, 1500, 1870, 2240, 2610, 2980];
    for (var a = 0; a < aisles.length; a++) {
        var cand = [-2.4, 0, 2.4];
        items.push({
            x: cand[Math.floor(MP.random() * cand.length)],
            y: aisles[a] + (MP.random() * 40 - 20),
            floor: 0, food: "shake", taken: false, aisle: true,
            bob: MP.random() * 6.28
        });
    }

    items.sort(function (p, q) { return p.y - q.y; });
}

function buildCourse() {
    buildStores();
    buildWalls();
    buildItems();
}


