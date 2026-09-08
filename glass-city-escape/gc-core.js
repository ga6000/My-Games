/**
 * Glass City Escape — audio, configuration, globals, messages
 *
 * Split out of glass_city_escape.html's inline script 2026-09-04 (Pass A of
 * glass-city-escape/GCE_PASS_PLAN.md). The lines below were MOVED VERBATIM --
 * Pass A deliberately changed no behaviour, so that any regression could be
 * attributed to the skin pass that followed rather than to the split.
 *
 * Classic scripts, one shared global scope, no modules (the file:// hard
 * constraint). Loads FIRST: everything else reads the state declared here.
 */
"use strict";

/**
 * 8-Bit Audio System
 */
let audioCtx = null;

function initAudio() {
    if (!audioCtx) {
        audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    }
}

function playTone(freq1, freq2, type, duration, vol=0.1) {
    if(!audioCtx) return;
    let osc = audioCtx.createOscillator();
    let gain = audioCtx.createGain();
    
    osc.type = type;
    osc.connect(gain);
    gain.connect(audioCtx.destination);
    
    osc.frequency.setValueAtTime(freq1, audioCtx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(freq2, audioCtx.currentTime + duration);
    
    gain.gain.setValueAtTime(vol, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + duration);
    
    osc.start();
    osc.stop(audioCtx.currentTime + duration);
}

function playUpSound() { playTone(300, 800, 'square', 0.15, 0.05); setTimeout(() => playTone(400, 1000, 'square', 0.2, 0.05), 150); }
function playDownSound() { playTone(800, 300, 'square', 0.15, 0.05); setTimeout(() => playTone(600, 200, 'square', 0.2, 0.05), 150); }
/*
 * REMOVED 2026-09-06: playFallSound, playCollectSound and playEscapeSound.
 *
 * All three were superseded by richer replacements in gc-audio.js -- gcFallSound,
 * gcCoreFoundSound and gcExitOpenSound -- and left behind as callers-of-nothing.
 * Deleted rather than kept "just in case": a dead one-shot next to a live one
 * with a similar name is how the wrong sound gets wired back in later.
 * playUpSound / playDownSound above are still the stair sounds and stay.
 */

/**
 * Game Configuration & Globals
 */
const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

const CELL_SIZE = 40;

/**
 * THE CITY GRID (2026-09-05, GCE_HUNT_PASS_PLAN.md §1/§2)
 *
 * Replaces MAP_BLOCKS/BLOCK_SIZE/BLVD_SIZE, which described nine superblocks
 * separated by 10-cell boulevards. Those constants were REMOVED rather than
 * resized: a 10-cell boulevard is a 2.5x violation of the rule below, and a
 * constant whose name no longer describes what it holds is worse than no
 * constant at all.
 *
 * TOTAL_CELLS 180 -> 58 is 3,364 cells against 32,400: 10.4% of the old area.
 * The old map was ~45 buildings and 5 cores spread over 7,200 x 7,200 px, so
 * most of the play time was transit across empty street.
 *
 * ALLEY_MIN/MAX ARE THE LOAD-BEARING PAIR. Every building is laid out on a
 * packed column/row grid (layOutCity), so the distance between two footprints
 * is 3 or 4 cells BY CONSTRUCTION, never by luck. That is what makes the dash
 * a traversal verb you can rely on rather than a gamble on the layout -- see
 * DASH_CELLS below, which is 10, comfortably over the worst case.
 */
const LOT_MIN = 6;          // smallest building footprint, cells
const LOT_MAX = 10;         // largest
const ALLEY_MIN = 3;        // gap between adjacent footprints, cells
const ALLEY_MAX = 4;
// CITY_MARGIN and SPAWN_CELL were removed 2026-09-06. Both described a fixed
// margin on a fixed-size map; the arena is now a function of the stage, so the
// lattice bound comes from arenaHalf() and the start position from spawnPoint().
// Removed rather than left dangling for the same reason MAP_BLOCKS was: a
// constant nothing reads is a constant that will be read again by mistake.
const TOTAL_CELLS = 58;
const MAX_Z = 6;

/**
 * DASH -- a launch, not a speed multiplier (§3).
 *
 * Before this pass the dash was 15 frames of baseSpeed * 2.2 with no cooldown:
 * you reached the same places slightly sooner and could not cross anything.
 * Now it is a fixed launch vector that suspends the fall test, so roof-to-roof
 * hopping is the fast lane it always looked like it should be.
 */
const DASH_CELLS = 10;                                   // reach, in cells
const DASH_SPEED = 17;                                   // px per frame
const DASH_FRAMES = Math.ceil(DASH_CELLS * CELL_SIZE / DASH_SPEED);
const DASH_COOLDOWN_FRAMES = 30;

/**
 * SURVEYOR HUNT + LASER (§4).
 *
 * LASER_LOCK_MS is the reaction window. Contact damage in the old build was
 * 5 HP per frame of overlap -- four frames emptied a 20 HP bar with no tell at
 * all. A visible sight that paints you for 600ms before the first shot, and a
 * projectile slower than you can walk, is the same threat made answerable.
 */
const HUNT_FORGET_MS = 5000;      // sight broken this long -> back to patrol
const LASER_LOCK_MS = 600;        // sight held this long before the first shot
const LASER_FIRE_MS = 1400;       // between shots while the sight holds
const LASER_SPEED = 3.6;          // px/frame ~= 216 px/s; the player walks 360
const LASER_DAMAGE = 1;
const LASER_RANGE = 900;          // px before a bolt expires
const LASER_KNOCKBACK = 28;       // px shove along the bolt's heading
const PURSUIT_REBUILD_FRAMES = 12; // pursuit-field refresh cap, ~5Hz

/**
 * THE STEPWELL PASS (2026-09-06, GCE_STEPWELL_PASS_PLAN.md)
 *
 * Combat is now TELEGRAPHED IN FULL. Nothing damages the player without first
 * showing and sounding an intent they had time to answer:
 *
 *   spotted   -> SPOT_TELEGRAPH_MS of ring + sting, drone frozen, no attacks
 *   melee     -> MELEE_WINDUP_MS of a swelling arc, then MELEE_DAMAGE
 *   beam      -> LASER_LOCK_MS of visible sight, then a bolt slower than a walk
 *
 * Contact damage is GONE, not reduced. Even at one hit per 500ms it was still
 * "damage for occupying the same pixels", delivered under the drone's own body
 * where the player could not see it land.
 */
const SPOT_TELEGRAPH_MS = 2000;   // "it has seen you" -- the reaction window
const MELEE_RANGE = 34;           // px; player radius 12 + drone radius 12 + reach
const MELEE_WINDUP_MS = 350;      // swelling arc before the strike
const MELEE_COOLDOWN_MS = 2000;   // one swing per drone per 2s
const MELEE_DAMAGE = 4;           // hearts

/**
 * Only BLUE LANCERS shoot. Everything else about the two kinds is identical.
 *
 * See the plan's §3 for why blue is a recorded risk against AESTHETIC_GUIDE
 * §2.3 (the identity palette contains two blues, so a blue enemy can read as a
 * rival's ghost) and why the Lancer's answer is SHAPE first -- a barrel stub
 * and a rotating sight ring nothing else has -- with colour second.
 */
const LANCER_SHARE = 0.22;        // fraction of drones that carry a beam
const LANCER_BLUE = '#2F6BFF';    // deeper than either identity-palette blue

/**
 * Cores lean into buildings rather than sitting in the street.
 * GCE_HUNT_PASS_PLAN.md §0.2 named "going up is all cost and no benefit" and
 * did not fix it; this is the fix. Bias, not exclusivity -- street cores are
 * what stop the first minute being a hunt for a door.
 */
const CORE_INTERIOR_BIAS = 0.72;

/**
 * THE STEPWELL. A 13x13 plaza at the map centre, reserved before the lattice
 * is laid so no building can sit on it, filled with terraces that descend to
 * the escape tunnel.
 *
 * It DELIBERATELY breaks the 3-4 cell alley rule. A plaza is not an alley: the
 * buildings stand 6+ cells back, so the well is a hole in the skyline you can
 * see from any nearby roof and cannot dash across. That is what turns the
 * centre from a coordinate into a landmark.
 */
const PLAZA_HALF = 6;             // 13x13 including the centre tile
const PLAZA_CX = Math.floor(TOTAL_CELLS / 2);
const PLAZA_CY = Math.floor(TOTAL_CELLS / 2);

/**
 * Cross-floor drone audio (§7). The failure this answers: climbing a stairwell
 * into a room you could not hear, and dying to something that was always there.
 */
const VERT_PENALTY = 0.85;        // a drone one floor away sounds ~1.85x further
const VERT_ALERT_RANGE = 260;     // px in x/y for the dedicated above/below tone

const MINIMAP_CELL = 2;           // px per map cell
const MINIMAP_PAD = 10;

/**
 * ===================================================
 *   THE RASTER PASS (2026-09-06, GCE_RASTER_PASS_PLAN.md)
 * ===================================================
 */

/**
 * HEALTH. 20 hearts over three wrapped rows became 9 in one row, and a fall
 * costs a flat 3 instead of 3 per storey.
 *
 * MELEE STAYS AT 4, WHICH IS NOW 44% OF THE BAR rather than 20%. Three melee
 * hits kill, three falls kill, nine beams kill. That is a real difficulty
 * increase and it is deliberate rather than overlooked -- it follows from the
 * two numbers the user set, and the run log is what should settle whether it
 * stands. Regen (below) becomes correspondingly more valuable.
 */
const MAX_HEALTH = 9;
const FALL_DAMAGE = 3;            // flat, regardless of how far you fell
const REGEN_FRAMES = 60;          // stationary frames per heart restored
const LOW_HEALTH_AT = 3;          // heartbeat below this

/**
 * THE LEVEL CURVE. Level 1 is a tutorial: flat ground, one drone, one core,
 * one pedestal, the exit. The city arrives gradually.
 *
 *   stage 1  0 buildings   1 drone    1 core
 *   stage 2  0 buildings   3 drones   2 cores
 *   stage 3  1 building    6 drones   3 cores   (one of them up on the roof)
 *   stage n  n-2           3(n-1)     n
 *
 * The ARENA grows with it, bounded by a wall ring. A 58x58 map holding one
 * drone and one core is not a tutorial, it is a hike -- and with the map mostly
 * empty the player needs a told edge rather than an invisible clamp.
 */
const ARENA_HALF_BASE = 14;       // 29x29 cells at stage 1
const ARENA_HALF_STEP = 2;
const ARENA_HALF_MAX = 27;        // 55x55, inside the 58 map with a margin
const MAX_CORES = 8;

function arenaHalf(stage) {
    return Math.min(ARENA_HALF_MAX, ARENA_HALF_BASE + ARENA_HALF_STEP * (stage - 1));
}
function coresForStage(stage)     { return Math.min(MAX_CORES, stage); }
function buildingsForStage(stage) { return Math.max(0, stage - 2); }
function dronesForStage(stage)    { return stage <= 1 ? 1 : 3 * (stage - 1); }
function blipsForStage(stage)     { return 4 + stage * 3; }

// The player starts at the arena's north-west inside corner, not the map's.
function spawnPoint() {
    const h = arenaHalf(currentStage);
    return { x: (PLAZA_CX - h + 2) * CELL_SIZE, y: (PLAZA_CY - h + 2) * CELL_SIZE };
}

/**
 * SCORING. Cores are the objective, blips are the reward for going where the
 * objective is not, and surviving hearts only bank if you actually reach the
 * exit -- so running the level out at 1 HP is worth less than clearing it
 * carefully, which is the incentive the old "score = stage reached" had no way
 * to express.
 */
const PTS_CORE = 250;
const PTS_BLIP = 25;
const PTS_LEVEL = 500;
const PTS_PER_HEART = 100;

let gcScore = 0;
let blips = [];                   // point pickups: {x, y, z, collected, phase}
let pedestals = [];               // {x, y, cx, cy, filled}
let coresDeposited = 0;
let exitOpenedAt = 0;             // performance.now() when the trapdoor started

/**
 * Latched for the 2 seconds triggerNextStage() spends showing its message
 * before it rebuilds the world.
 *
 * WITHOUT THIS THE LEVEL ADVANCES ONCE PER FRAME. The player is still standing
 * on the tunnel tile while the message is up, escapeTunnelOpen is still true
 * (spawnCores only clears it during the rebuild), so Player.update() calls
 * triggerNextStage() again on the very next frame -- and again, ~120 times over
 * the two seconds. Measured: level 1 -> level 4 on a single descent, with the
 * survival bonus paid three times.
 *
 * This is PRE-EXISTING, not introduced by the points system; the points just
 * made it visible, because a stage counter jumping by three looks like a fast
 * animation and a score jumping by 4,200 does not.
 */
let stageAdvancing = false;

/**
 * THE ROBOTRON WAVE TRANSITION (2026-09-06).
 *
 * Replaces a modal "LEVEL CLEARED" box and a 2-second setTimeout with an
 * expanding, colour-cycled rectangle burst drawn over the ALREADY-REBUILT next
 * level. No input is asked for and nothing waits.
 *
 * WAVE_GRACE_MS is shorter than the burst on purpose. Robotron freezes
 * everything for its wave change; here only the DRONES are held, and only for
 * the first two thirds of the effect. The player is live from frame one --
 * "remove the rest between levels" means the player never stops playing, and a
 * freeze that included them would be the same pause wearing a better costume.
 * The drone hold is a spawn grace: materialising into a new arena with hunters
 * already converging is not a fair opening.
 */
const WAVE_TRANSITION_MS = 780;
const WAVE_GRACE_MS = 520;
const WAVE_RINGS = 7;

let waveTransitionAt = 0;
let waveBonus = 0;

/**
 * Carrying is ONE AT A TIME, and that is the whole loop. Each core is a round
 * trip you have to survive; you cannot bank four and walk home once.
 */
const CARRY_CAPACITY = 1;

// Vision cones are drawn as true visibility polygons now -- see castConeRays().
const CONE_RAYS = 26;

/**
 * RASTER CABINET. AESTHETIC_GUIDE §6.8 assigned this game to VECTOR; §1 says
 * the assignment is mechanical -- "what does the game already draw?" -- and the
 * honest answer changed underneath it. This is a tile grid drawing chunky
 * filled cells, blocky sprites and a fixed HUD, which is the RASTER
 * description. Recorded as a reassignment in the plan, not done quietly.
 *
 * RASTER_GRID is the virtual pixel: every sprite coordinate snaps to it, which
 * is what stops blocky art from having sub-pixel edges the scanlines then
 * shimmer against.
 */
const RASTER_GRID = 4;
const GLASS_INTACT = '#7FE9FF';
const GLASS_BROKEN = '#2C5563';

/**
 * ===================================================
 *   THE BROKEN GLASS PASS (2026-09-07)
 * ===================================================
 */

/**
 * IS THIS TILE A WALL THAT STILL STOPS THINGS?
 *
 * ONE PREDICATE, SIX CONSUMERS -- the player's and the robot's collision, the
 * robot's checkLOS, the drawn cone's castRay, botWalkable (the pursuit field)
 * and the laser bolts. They are written down together here because the last
 * time two of them disagreed about what "opaque" meant, the drawn vision cone
 * spent a whole pass telling the player something checkLOS did not enforce.
 *
 * A BROKEN PANE IS A HOLE, in every sense: you walk through it, you see through
 * it, drones path through it and shoot through it. Anything less would be a
 * hole you can see through but not walk into, or walk into but not see through,
 * and either one reads as a bug.
 */
function solidWall(tile) {
    return !!(tile && tile.type === 'wall' && !tile.broken);
}

/**
 * THE STALKER, from stage 6. Triple the forget time and 1.25x the chase speed
 * of a standard drone; no beam.
 *
 * Spring green, and the same caveat the Lancer blue carries: the identity
 * palette contains greens, so the read is SHAPE first -- the Stalker is a
 * forward-pointing triangle against everything else's square. A silhouette
 * nothing else has survives a colour collision; a colour alone does not.
 */
const STALKER_FROM_STAGE = 6;
const STALKER_SHARE = 0.18;
const STALKER_GREEN = '#4CFF9E';
const STALKER_FORGET_MULT = 3;
const STALKER_SPEED_MULT = 1.25;

let lastTime = 0;
let keys = {};
let mapData = [];
let entities = [];
let gcLasers = [];          // live laser bolts: {x, y, z, vx, vy, dist}
let camera = { x: 0, y: 0 };
let gameRunning = false;

// Progression & Collectibles
let currentStage = 1;
let collectibles = [];
let collectedCount = 0;
let totalCollectibles = 0;
let escapeTunnelOpen = false;
let escapeTunnelPos = { x: 0, y: 0 };


/**
 * UI Message Logic
 */
/**
 * The canvas cannot read CSS custom properties, so the tokens are pulled out of
 * retro.css ONCE at boot rather than retyped as literals here -- retro.css stays
 * the single source of truth, and this cannot drift from it.
 *
 * The literals below are only the fallback for the case where the stylesheet did
 * not load at all; the game still draws, just in its own colours.
 */
const INK = {
    ground:  "#000000",
    cyan:    "#00E5FF",
    amber:   "#FFB000",
    magenta: "#FF2E88",
    hot:     "#E8FFF4",
    mid:     "#8FA89C",
    dim:     "#2E3A34"
};

function loadInkFromCss() {
    try {
        const cs = getComputedStyle(document.documentElement);
        const pick = (name, fallback) => (cs.getPropertyValue(name) || "").trim() || fallback;
        INK.ground  = pick("--ground", INK.ground);
        INK.cyan    = pick("--sig-cyan", INK.cyan);
        INK.amber   = pick("--sig-amber", INK.amber);
        INK.magenta = pick("--sig-magenta", INK.magenta);
        INK.hot     = pick("--phos-hot", INK.hot);
        INK.mid     = pick("--phos-mid", INK.mid);
        INK.dim     = pick("--phos-dim", INK.dim);
    } catch (e) { /* fallbacks already in place */ }
}

/**
 * LEADERBOARD — score is the STAGE REACHED.
 *
 * Posted from here because showMessage(..., isGameOver=true) is the single
 * choke point where a run ends: it is what sets gameRunning = false, and it is
 * reached by both deaths (a fall, a Surveyor) and by finishing a race.
 *
 * WHY NOT THE RACE TIME. leaderboard.html does orderBy("score", "desc") and
 * keeps each player's maximum, so it can only express "higher is better".
 * A finish time in ms would rank the SLOWEST player first. Race placings and
 * times already exist in-game via standingsText(); nothing is lost.
 *
 * WHY NOT SOLO-ONLY, which is what was originally planned: mp-core's "solo"
 * means THE SERVER IS UNREACHABLE, not "playing by yourself" -- info.solo is
 * false the moment the socket opens, even alone in a room. A solo-only hook
 * would therefore almost never fire, and would fire mainly on file://, where
 * LB cannot submit anyway. Posting on every run end is what actually works.
 */
/**
 * SUPERSEDED 2026-09-06: the score is now POINTS, not the stage reached.
 *
 * The 2026-09-04 reasoning above is still correct about the constraint --
 * leaderboard.html does orderBy("score","desc") and keeps each player's max, so
 * it can only express "higher is better" -- and points satisfy that just as
 * well. What changed is that there is now something worth measuring inside a
 * level: cores deposited, blips swept up, and hearts still alive at the exit.
 * "Stage reached" threw all of it away, and rewarded quitting a level the
 * instant the exit opened exactly as much as clearing it.
 *
 * Points still encode depth, because deeper levels pay more and hearts only
 * bank if you actually get out. Direction is unchanged, so old stage-based
 * entries stay comparable in ORDER even though their magnitudes are not.
 */
let gcPostedScore = 0;

function submitRunToLeaderboard() {
    if (typeof LB === "undefined") return;
    // A run can only improve on itself; guard so a long game posts once per new
    // best rather than once per level.
    if (gcScore <= gcPostedScore) return;
    gcPostedScore = gcScore;
    LB.submit({
        player: (typeof MP !== "undefined" && MP.selfName) || "Anonymous",
        score: gcScore,
        room: (typeof MP !== "undefined" && MP.room) || ""
    });
}

// One place that adds points, so the HUD can never disagree with the total.
function addPoints(n) {
    gcScore += n;
    const el = document.getElementById('score-counter');
    if (el) el.innerText = 'SCORE: ' + gcScore;
}

function showMessage(title, desc, isGameOver = false) {
    const msg = document.getElementById('message-box');
    document.getElementById('msg-title').innerText = title;
    document.getElementById('msg-desc').innerText = desc;
    
    // Style adjustments for Game Over vs Notifications
    msg.style.borderColor = isGameOver ? INK.magenta : INK.cyan;
    msg.style.boxShadow = isGameOver ? '0 0 20px ' + INK.magenta : '0 0 20px rgba(0,229,255,0.5)';
    
    document.getElementById('restart-btn').style.display = isGameOver ? 'inline-block' : 'none';
    msg.style.display = 'block';
    
    if (isGameOver) {
        gameRunning = false;
        // gameLoop is what pumps the sustained voices (drone, pursuit tune,
        // laser sight), and it returns immediately once gameRunning is false --
        // so without this the last frame's drone hangs on forever under the
        // game-over box. Silencing at the choke point covers every death path.
        gcAudioSilence();
        // Same choke point, same reason the leaderboard posts from here: it is
        // the one place EVERY ending passes through -- a fall, a drone, a race
        // finish. A telemetry hook anywhere else would miss one of them.
        gcTelemetryEndRun(title);
        submitRunToLeaderboard();
    }
}

function hideMessage() {
    if (gameRunning) {
        document.getElementById('message-box').style.display = 'none';
    }
}

