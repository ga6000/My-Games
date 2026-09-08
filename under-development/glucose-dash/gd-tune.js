// ===================================================
//   Glucose Dash -- TUNE, FOODS and all mutable state
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 382-569 were MOVED VERBATIM and IN
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
     TUNING — every balance number lives here
   =================================================== */

var TUNE = {
    /* --- movement: car-style, momentum-carrying --- */
    maxSpeed:      27,     // units/sec on the flat, no sprint
    accel:         34,
    brake:         48,
    reverseMax:     8,
    drag:          0.55,   // proportional, per second
    turnRate:      2.55,   // rad/sec at or above turnSpeedRef
    turnSpeedRef:  11,     // below this you steer proportionally worse
    grip:          6.2,    // how fast velocity realigns to heading (lower = slidier)
    wallLoss:      0.45,   // fraction of speed shed on a wall scrape

    /* --- sprint: a burst, not a new cap (concept decision) --- */
    sprintMult:    1.36,
    sprintAccel:   1.55,
    sprintDur:     2.5,
    sprintCd:      3.2,
    dblTapMs:      280,

    /* --- eating: throttle cap drops, steering untouched --- */
    eatSpeedMult:  0.55,

    /* --- ramps: slow up, slightly quick down --- */
    rampUpMult:    0.60,
    rampDownMult:  1.06,
    rampAlign:     7.0,    // how hard you're auto-aligned onto the stairs

    /* --- glucose --- */
    glucoseStart:  145,
    /* Swept against the doubled course. The pair that matters is this
       and the food density in buildItems -- raising density alone made
       every route safe and killed the gamble, lowering it alone
       collapsed the NPC field. 2.0 with two-candidate chunks is where
       ignoring food still always kills you, the ground-floor route is a
       real 3-in-8 gamble, and climbing is both faster and safer. */
    baseDecay:     2.0,    // mg/dL per second while running
    sprintDecayX:  2.0,    // concept decision: sprint burns 2x
    hypo:          70,
    hyper:         200,
    glucoseMax:    420,
    bonkFloor:     0.40,   // top-speed multiplier at glucose 0
    bonkCurve:     1.4,    // >1 makes the last stretch of a bonk a cliff, not a slope
    rangeBonus:    0.12,   // top-speed bonus for being comfortably fuelled

    /* --- pickups --- */
    pickupR:       2.7,
    invSize:       2
};

/* Food curves.
   peak/rise  : total mg/dL delivered, and over how many seconds
   crash/crashDur : insulin overshoot AFTER absorption (high-GI only)
   hold/holdX : low-GI only -- multiplies baseline decay for `hold` sec
   eat        : seconds locked into the slow-down while eating

   The eat times are the balance lever that makes high-GI worth taking
   at all: candy is a 0.7s window, an oat bowl is 3.1s. Without that,
   high-GI food is strictly dominated. See SCOPE.md §3.2. */
var FOODS = {
    candy:    { icon: "🍬", name: "Candy Bag",     gi: "high", peak: 78, rise: 1.5, crash: 88,  crashDur: 7.5, eat: 0.7 },
    soda:     { icon: "🥤", name: "Big Soda",      gi: "high", peak: 98, rise: 1.8, crash: 114, crashDur: 8.0, eat: 0.9 },
    choc:     { icon: "🍫", name: "Chocolate Bar", gi: "high", peak: 82, rise: 2.0, crash: 86,  crashDur: 8.0, eat: 1.0 },
    donut:    { icon: "🍩", name: "Donut",         gi: "high", peak: 86, rise: 2.2, crash: 96,  crashDur: 8.5, eat: 1.1 },
    cake:     { icon: "🍰", name: "Cake Slice",    gi: "high", peak: 92, rise: 2.4, crash: 104, crashDur: 9.0, eat: 1.3 },

    sandwich: { icon: "🥪", name: "Sandwich",      gi: "med",  peak: 44, rise: 4.2, eat: 1.9 },
    pizza:    { icon: "🍕", name: "Pizza Slice",   gi: "med",  peak: 48, rise: 4.6, eat: 2.1 },
    noodles:  { icon: "🍜", name: "Noodle Bowl",   gi: "med",  peak: 46, rise: 4.8, eat: 2.2 },
    burrito:  { icon: "🌯", name: "Burrito",       gi: "med",  peak: 52, rise: 5.0, eat: 2.3 },

    nuts:     { icon: "🥜", name: "Trail Mix",     gi: "low",  peak: 22, rise: 5.5, hold: 26, holdX: 0.55, eat: 1.6 },
    salad:    { icon: "🥗", name: "Grain Salad",   gi: "low",  peak: 26, rise: 6.4, hold: 30, holdX: 0.42, eat: 2.6 },
    shake:    { icon: "🧋", name: "Balanced Shake",gi: "low",  peak: 32, rise: 7.0, hold: 34, holdX: 0.38, eat: 2.9 },
    oats:     { icon: "🥣", name: "Oat Bowl",      gi: "low",  peak: 30, rise: 7.5, hold: 36, holdX: 0.40, eat: 3.1 }
};

var GI_COLOR = { high: "#f4453f", med: "#f59f00", low: "#12b886" };

/* Storefronts. `food` null = scenery, nothing to grab.
   Signage telegraphs GI: a returning player should be able to read the
   course off the shop names without slowing down to look. */
var STORE_KINDS = {
    bakery:   { food: "cake",     sign: "#ff5c9d", names: ["SUGAR & CRUMB", "FROSTED", "CAKEWALK", "THE ICING"] },
    donuts:   { food: "donut",    sign: "#ff77b4", names: ["HOLE IN ONE", "GLAZED", "DOZEN"] },
    candy:    { food: "candy",    sign: "#f4453f", names: ["SUGAR RUSH", "PENNY SWEETS", "GUMMY CO"] },
    soda:     { food: "soda",     sign: "#e8342f", names: ["FIZZ 32oz", "BIG GULP", "SODA WORKS"] },
    chocolate:{ food: "choc",     sign: "#b5651d", names: ["COCOA BAR", "TRUFFLE", "70%"] },

    pizzeria: { food: "pizza",    sign: "#f59f00", names: ["SLICE HOUSE", "NAPOLI", "BIG SLICE"] },
    deli:     { food: "sandwich", sign: "#e8a33d", names: ["THE DELI", "STACKED", "ON RYE"] },
    ramen:    { food: "noodles",  sign: "#d98b1f", names: ["NOODLE BAR", "BROTH", "SLURP"] },
    burritos: { food: "burrito",  sign: "#ef8a2b", names: ["ROLLED", "CANTINA", "EL WRAP"] },

    smoothie: { food: "shake",    sign: "#12b886", names: ["BALANCE BAR", "GREEN CO", "THE BLEND"] },
    salads:   { food: "salad",    sign: "#2fb35c", names: ["LEAF & GRAIN", "TOSSED", "GARDEN"] },
    oatbar:   { food: "oats",     sign: "#57a848", names: ["SLOW OATS", "STEEL CUT", "MORNING"] },
    nuts:     { food: "nuts",     sign: "#8bbf3f", names: ["NUT HOUSE", "TRAIL CO", "ROASTED"] },

    // Non-food shops still get colour -- a white mall with grey gaps
    // reads as unfinished. They just don't get FOOD colour.
    shoes:    { food: null, sign: "#4a6ea8", names: ["SOLE", "RUNNERS", "LACED", "STRIDE"] },
    phones:   { food: null, sign: "#3f8ec4", names: ["CELL HUT", "SCREENS", "PLAN B"] },
    books:    { food: null, sign: "#7a5cc4", names: ["CHAPTERS", "SPINE", "PAGE 1"] },
    clothes:  { food: null, sign: "#a355b8", names: ["DENIM CO", "OUTFIT", "RACK"] },
    plants:   { food: null, sign: "#4f9e7a", names: ["FERN", "POTTED", "GREENERY"] }
};

/* What each floor stocks. Ground floor is a sugar minefield; climbing
   is how you reach food that actually holds. */
var FLOOR_STOCK = [
    ["candy","bakery","soda","donuts","candy","chocolate","soda","pizzeria","bakery",
     "shoes","phones","donuts","candy","deli","clothes","soda"],
    ["pizzeria","deli","ramen","burritos","pizzeria","nuts","books","deli","salads",
     "ramen","plants","burritos","ramen","nuts"],
    ["smoothie","salads","oatbar","smoothie","nuts","oatbar","salads","plants",
     "smoothie","oatbar","books","salads"]
];

/* ---- course geometry ---- */
var COURSE_LEN   = 3300;   // finish line y

/* THE CENTRELINE.

   The mall winds. `centerX(y)` is the lateral offset of the course axis
   at distance y, and it is the ONLY thing that knows about curvature:
   physics, collision, walkLimit, item placement and the NPC AI all stay
   in flat TRACK space (x = offset from the centre of the corridor), and
   only SX() adds the centreline when converting to screen space.

   That's the classic pseudo-3D road trick, and the reason it's worth
   using here is that curvature then costs exactly zero gameplay risk --
   nothing that was tested against a straight course can break on a bent
   one, because none of it can tell the difference.

   Two sines rather than one so the rhythm doesn't feel like a sine
   wave. Peak slope is about 0.16 lateral units per unit forward (~9
   degrees), which bends visibly without the far end of the draw
   distance swinging off the side of the screen. */
function centerX(y) {
    return Math.sin(y * 0.00115) * 42 + Math.sin(y * 0.0041 + 1.7) * 22;
}

/* THE VERTICAL RISK, in two arrays.

   The mall narrows as it climbs. Floor 1 is a proper corridor with
   solid walls on both sides -- nothing to fall off. Floors 2 and 3 are
   balconies with NO railings, and they get tighter each storey, so the
   low-GI food that actually holds you steady sits on a platform jutting
   out over a drop.

   That is the trade the concept asked for, expressed as geometry rather
   than as a rule: better food is further up, and further up is thinner. */
var FLOOR_HALF   = [11.0, 7.5, 5.0];   // walkable half-width per floor
var BAY_OUT      = [17.5, 12.5, 9.0];  // how far a storefront platform reaches
var FLOOR_H      = 13;     // z per storey
var FLOORS       = 3;

function hallHalf(f) { return FLOOR_HALF[f] !== undefined ? FLOOR_HALF[f] : FLOOR_HALF[0]; }
function bayOut(f)   { return BAY_OUT[f]   !== undefined ? BAY_OUT[f]   : BAY_OUT[0]; }
var COURSE_SEED  = 20260829;  // fixed: the course is the SAME for everyone,
                              // every run. Only food-slot choice uses the room seed.

/* ===================================================
     STATE
   =================================================== */

var canvas = null, ctx = null, waveCanvas = null, waveCtx = null;
var el = {};                 // cached HUD elements
var VIEW = { w: 0, h: 0, dpr: 1 };

var phase = "menu";          // menu | countdown | racing | done
var raceTime = 0;
var countdownLeft = 0;
var runners = [];            // [0] is always the player
var player = null;
var items = [];
var stores = [];
var wallPaths = { "-1": [], "1": [] };   // per side, per floor polylines
var finishOrder = [];
var lastFrame = 0;
var netOnline = false;
var mpSeed = null;
var toastTimer = 0;

