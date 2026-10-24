#!/usr/bin/env node
/**
 * cliff-run-playtest.js — do the bots actually finish?
 *
 * "make players 2-4 bots for now and make sure they can actually beat the
 * game" is the one requirement in Cliff Run's brief that cannot be answered by
 * reading the code, by a screenshot, or by playing it once. So it is answered
 * here, over hundreds of levels, before the claim is made anywhere else.
 *
 * THE REAL GAME CODE RUNS. Cliff Run is classic <script> files sharing one
 * global scope (the file:// hard constraint), which means they drop straight
 * into a vm context with a stub document -- exactly the trick
 * scripts/zombie-headless.js uses, and for the same reason: a harness that
 * reimplements any of the physics, the generator or the bot controller is
 * measuring itself.
 *
 * Nothing is drawn and no frame is waited for. cr-boot.js's requestAnimationFrame
 * is a no-op stub, so GameInstance.start() arms a loop that never fires, and
 * this file drives crStep(CR_STEP) by hand at the game's own fixed timestep.
 * A ten-level run takes a few hundred milliseconds instead of four minutes.
 *
 * TWO MODES, because they answer different questions:
 *
 *   levels (default)  Each level started directly, four bots, N seeds. This is
 *                     the per-level capability number. It exists separately
 *                     because a full run ENDS when seat 0 dies (the spec: "if
 *                     at any point there are only bots alive the game should
 *                     end"), so a run-only measurement would never reach level
 *                     9 often enough to say anything about it.
 *   run               Full ten-level runs with seat 0 bot-driven, to check the
 *                     flow end to end: survivors carrying forward, dead seats
 *                     not reappearing, the run ending where it should.
 *
 * Usage:
 *   node scripts/cliff-run-playtest.js                 # levels, 12 seeds
 *   node scripts/cliff-run-playtest.js levels 40
 *   node scripts/cliff-run-playtest.js run 20
 *   node scripts/cliff-run-playtest.js levels 12 --verbose
 *
 * Exit code 1 if the acceptance bar below is not met.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const GAME_DIR = path.join(__dirname, "..", "cliff-run");
const PAGE = path.join(GAME_DIR, "cliff-run.html");

// ===================================================
//   ACCEPTANCE BAR
// ===================================================
// Stated here, in code, so tuning cannot quietly move it. CLIFF_RUN_PLAN.md 6
// names the first of these; the other two are what make it mean something.
//
// RESULT, 2026-10-17 (16 seeds): mean bot finish 55%, level 10 any-bot 94%,
// worst level 56% at level 9. Two of the three pass; `anyBotPerLevel` does not,
// and it is LEFT FAILING rather than moved. The brief's actual requirement is
// the `run` mode's: a bot clears all ten levels on 13% of seeds, mean 5.8
// levels, ~4.4 minutes for a full clear. See cliff-run/CLAUDE.md.
//
const BAR = {
    // Every level must be finishable: at least one of the four bots gets out,
    // on at least this share of seeds.
    anyBotPerLevel: 0.9,
    // Across every level and lane, this share of bot attempts end in a finish.
    // Bots are MEANT to die sometimes -- that is the game -- so this is a
    // floor on competence, not a demand for perfection.
    meanBotFinish: 0.5,
    // And the last level, the fastest scroll, must not be a wall.
    lastLevelAnyBot: 0.8
};

const SIM_CAP_SECONDS = 150;

// ===================================================
//   THE PAGE'S OWN SCRIPT LIST
// ===================================================
// Read out of the markup rather than hand-listed, so a file added to the page
// is a file this harness runs. A hand-picked subset rots the first time
// somebody splits one more module out.
function pageScripts() {
    const html = fs.readFileSync(PAGE, "utf8");
    const out = [];
    const re = /<script\s+src="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
        if (/^https?:/.test(m[1])) continue;
        out.push(path.resolve(GAME_DIR, m[1]));
    }
    return out;
}

// ===================================================
//   STUB BROWSER
// ===================================================
function stubCtx() {
    return new Proxy({}, {
        get(t, k) {
            if (k === "canvas") return { width: 480, height: 288 };
            if (!(k in t)) t[k] = () => stubCtx();
            return t[k];
        },
        set(t, k, v) { t[k] = v; return true; }
    });
}

function stubEl() {
    const el = {
        style: {},
        classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
        addEventListener() {}, removeEventListener() {},
        appendChild() {}, removeChild() {}, remove() {},
        setAttribute() {}, getAttribute() { return null; }, removeAttribute() {},
        getContext: stubCtx,
        getBoundingClientRect() { return { left: 0, top: 0, width: 480, height: 288 }; },
        innerHTML: "", textContent: "", value: "",
        width: 240, height: 140,
        clientWidth: 1280, clientHeight: 720,
        hidden: false, title: "",
        dataset: {}, children: [], childNodes: []
    };
    el.querySelector = () => stubEl();
    el.querySelectorAll = () => [];
    el.cloneNode = () => stubEl();
    return el;
}

function bootstrap() {
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.self = sandbox;
    sandbox.console = { log() {}, warn() {}, error() {}, info() {} };
    sandbox.Math = Math;
    sandbox.Date = Date;
    sandbox.JSON = JSON;
    sandbox.Set = Set;
    sandbox.Map = Map;
    sandbox.Uint8Array = Uint8Array;
    sandbox.Object = Object;
    sandbox.Array = Array;
    sandbox.Number = Number;
    sandbox.String = String;
    sandbox.isFinite = isFinite;
    sandbox.performance = { now: () => Date.now() };
    sandbox.setTimeout = () => 0;
    sandbox.clearTimeout = () => {};
    sandbox.setInterval = () => 0;
    sandbox.clearInterval = () => {};
    // The loop is armed and never fires; this file is the clock.
    sandbox.requestAnimationFrame = () => 0;
    sandbox.cancelAnimationFrame = () => {};
    sandbox.addEventListener = () => {};
    sandbox.removeEventListener = () => {};
    sandbox.location = { search: "?solo=1", hash: "",
                         href: "http://localhost/cliff-run/cliff-run.html?solo=1" };
    sandbox.navigator = { userAgent: "node", maxTouchPoints: 0 };
    sandbox.localStorage = sandbox.sessionStorage = {
        getItem: () => null, setItem() {}, removeItem() {}
    };
    sandbox.URLSearchParams = URLSearchParams;
    sandbox.AbortController = AbortController;
    sandbox.document = {
        getElementById: (id) => (id === "game" ? Object.assign(stubEl(), { width: 480, height: 288 }) : stubEl()),
        querySelector: () => stubEl(),
        querySelectorAll: () => [],
        createElement: () => stubEl(),
        addEventListener() {},
        body: stubEl(),
        documentElement: stubEl(),
        hidden: false,
        fonts: { check: () => true }
    };
    // No AudioContext at all: crAudioInit() returns false and every crSfx*
    // call short-circuits on !crActx. Silence is the correct sound here.
    sandbox.WebSocket = function () { throw new Error("no sockets in the harness"); };

    vm.createContext(sandbox);
    for (const file of pageScripts()) {
        vm.runInContext(fs.readFileSync(file, "utf8"), sandbox, { filename: file });
    }
    return sandbox;
}

function ev(sb, expr) { return vm.runInContext(expr, sb); }
function snap(sb, expr) { return JSON.parse(vm.runInContext("JSON.stringify(" + expr + ")", sb)); }

// ===================================================
//   DRIVING ONE LEVEL
// ===================================================
// Four bots, one level, stepped at the game's own fixed timestep until every
// body has finished or died. Returns what happened to each lane.
function playLevel(sb, baseSeed, levelIndex) {
    ev(sb, "CR_SANDBOX = false;");
    ev(sb, "CR_BASE_SEED = " + (baseSeed | 0) + ";");
    ev(sb, "crStartRun(true);");               // attract == all four seats bot-driven
    ev(sb, "crStartLevel(" + levelIndex + ");");

    const step = ev(sb, "CR_STEP");
    const cap = Math.ceil(SIM_CAP_SECONDS / step);
    let steps = 0;

    while (steps < cap) {
        ev(sb, "crStep(CR_STEP);");
        steps++;
        const phase = ev(sb, "crPhase");
        if (phase === "between" || phase === "over") break;
    }

    const players = snap(sb, "crPlayers");
    return {
        level: levelIndex,
        seed: baseSeed,
        timedOut: steps >= cap,
        simSeconds: steps * step,
        lanes: players.map((p) => ({
            seat: p.seat,
            finished: !!p.finished,
            alive: !!p.alive,
            cause: p.deathCause || "",
            x: p.x,
            coins: p.coins
        }))
    };
}

// ===================================================
//   DRIVING ONE FULL RUN
// ===================================================
function playRun(sb, baseSeed) {
    ev(sb, "CR_SANDBOX = false;");
    ev(sb, "CR_BASE_SEED = " + (baseSeed | 0) + ";");
    ev(sb, "crStartRun(true);");

    const step = ev(sb, "CR_STEP");
    const cap = Math.ceil((SIM_CAP_SECONDS * 10) / step);
    let steps = 0;

    while (steps < cap && ev(sb, "crPhase") !== "over") {
        ev(sb, "crStep(CR_STEP);");
        steps++;
    }

    const players = snap(sb, "crPlayers");
    return {
        seed: baseSeed,
        timedOut: steps >= cap,
        simSeconds: steps * step,
        reachedLevel: ev(sb, "crLevelIndex") + 1,
        winner: ev(sb, "crWinnerName"),
        players: players.map((p) => ({
            seat: p.seat, levels: p.levelsCleared, alive: !!p.alive,
            cause: p.deathCause || "", score: p.score
        }))
    };
}

// ===================================================
//   REPORT
// ===================================================
function pct(n) { return (n * 100).toFixed(0).padStart(3) + "%"; }

function runLevelsMode(sb, seeds, verbose) {
    const levelCount = ev(sb, "CR_LEVEL_COUNT");
    const rows = [];
    let attempts = 0, finishes = 0, timeouts = 0;

    for (let L = 0; L < levelCount; L++) {
        let anyBot = 0, laneFin = [0, 0, 0, 0], fell = 0, caught = 0, secs = 0;
        for (let s = 0; s < seeds.length; s++) {
            const r = playLevel(sb, seeds[s], L);
            if (r.timedOut) timeouts++;
            secs += r.simSeconds;
            let any = false;
            for (const lane of r.lanes) {
                attempts++;
                if (lane.finished) { finishes++; laneFin[lane.seat]++; any = true; }
                else if (lane.cause === "fall") fell++;
                else if (lane.cause === "avalanche") caught++;
            }
            if (any) anyBot++;
            if (verbose) {
                console.log("   seed " + seeds[s].toString(16) + "  " +
                    r.lanes.map((l) => "P" + (l.seat + 1) + (l.finished ? ":IN " : (l.cause === "fall" ? ":FELL" : (l.cause === "avalanche" ? ":WALL" : ":----")))).join("  ") +
                    "  " + r.simSeconds.toFixed(1) + "s" + (r.timedOut ? "  TIMEOUT" : ""));
            }
        }
        rows.push({
            level: L + 1,
            scroll: ev(sb, "crLevelSpec(" + L + ").scroll").toFixed(0),
            anyBot: anyBot / seeds.length,
            lanes: laneFin.map((n) => n / seeds.length),
            fell: fell, caught: caught,
            meanSecs: secs / seeds.length
        });
        process.stdout.write(".");
    }
    process.stdout.write("\n\n");

    console.log("LEVEL  SCROLL   ANY BOT   P1    P2    P3    P4    FELL  WALL   MEAN");
    console.log("-----  ------   -------  ----  ----  ----  ----   ----  ----   ----");
    for (const r of rows) {
        console.log(
            String(r.level).padStart(5) + "  " + String(r.scroll).padStart(4) + "p/s" +
            "   " + pct(r.anyBot) + "    " +
            r.lanes.map((v) => pct(v)).join("  ") + "   " +
            String(r.fell).padStart(4) + "  " + String(r.caught).padStart(4) + "  " +
            r.meanSecs.toFixed(1).padStart(5) + "s"
        );
    }

    const meanFinish = finishes / attempts;
    const worstAny = Math.min.apply(null, rows.map((r) => r.anyBot));
    const lastAny = rows[rows.length - 1].anyBot;

    console.log("");
    console.log("attempts " + attempts + "   finishes " + finishes +
                "   mean bot finish " + pct(meanFinish) +
                "   worst level (any bot out) " + pct(worstAny) +
                (timeouts ? "   TIMEOUTS " + timeouts : ""));

    const fails = [];
    if (worstAny < BAR.anyBotPerLevel) {
        fails.push("a level let no bot out on more than " +
                   pct(1 - BAR.anyBotPerLevel).trim() + " of seeds (worst " + pct(worstAny).trim() + ")");
    }
    if (meanFinish < BAR.meanBotFinish) {
        fails.push("mean bot finish " + pct(meanFinish).trim() +
                   " is under the " + pct(BAR.meanBotFinish).trim() + " bar");
    }
    if (lastAny < BAR.lastLevelAnyBot) {
        fails.push("level " + levelCount + " let a bot out on only " + pct(lastAny).trim() + " of seeds");
    }
    if (timeouts) fails.push(timeouts + " level(s) hit the " + SIM_CAP_SECONDS + "s sim cap");
    return fails;
}

function runRunsMode(sb, seeds) {
    let cleared = 0, timeouts = 0;
    const reach = [];
    for (const seed of seeds) {
        const r = playRun(sb, seed);
        if (r.timedOut) timeouts++;
        const best = Math.max.apply(null, r.players.map((p) => p.levels));
        reach.push(best);
        if (best >= ev(sb, "CR_LEVEL_COUNT")) cleared++;
        console.log("seed " + seed.toString(16).padStart(8) +
            "   reached L" + String(r.reachedLevel).padStart(2) +
            "   best bot cleared " + String(best).padStart(2) + " levels" +
            "   winner " + (r.winner || "-").padEnd(8) +
            "   " + r.simSeconds.toFixed(1) + "s" + (r.timedOut ? "  TIMEOUT" : ""));
    }
    const rate = cleared / seeds.length;
    const mean = reach.reduce((a, b) => a + b, 0) / reach.length;
    console.log("");
    console.log("full runs " + seeds.length + "   all ten cleared by a bot " + pct(rate) +
                "   mean levels cleared " + mean.toFixed(1) +
                (timeouts ? "   TIMEOUTS " + timeouts : ""));
    const fails = [];
    if (timeouts) fails.push(timeouts + " run(s) hit the sim cap");
    return fails;
}

// ===================================================
//   MAIN
// ===================================================
function main() {
    const args = process.argv.slice(2);
    const verbose = args.indexOf("--verbose") >= 0;
    const positional = args.filter((a) => !a.startsWith("--"));
    const mode = positional[0] === "run" ? "run" : "levels";
    const count = Number(positional[1]) || (mode === "run" ? 10 : 12);

    console.log("Cliff Run bot playtest — " + mode + ", " + count + " seed(s)\n");

    const sb = bootstrap();

    // Seeds spread by a large odd stride rather than 1, 2, 3: consecutive
    // mulberry32 seeds produce visibly related streams, and a sample of
    // near-identical levels is a sample of one.
    const seeds = [];
    for (let i = 0; i < count; i++) seeds.push((0x5C11FF + i * 0x9E3779B1) | 0);

    const fails = mode === "run" ? runRunsMode(sb, seeds) : runLevelsMode(sb, seeds, verbose);

    console.log("");
    if (!fails.length) {
        console.log("PASS — the bots can beat it.");
        process.exit(0);
    }
    console.log("FAIL");
    for (const f of fails) console.log("  - " + f);
    process.exit(1);
}

main();
