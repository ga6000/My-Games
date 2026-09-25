// Generate Zombie levels in Node, with no browser.
//
// Zombie is classic <script> files sharing one global scope (the file://
// constraint), so they can be run straight into a vm context with a stub
// document. THE REAL GAME CODE RUNS -- this harness never reimplements
// generation, which is the only way a check over it can mean anything.
//
// Only the files generateLevel() needs are loaded. Everything else (render,
// game loop, audio, net) is skipped, and the handful of names those files
// own that level generation touches are stubbed below.
//
// Used by scripts/check-map-features.js. A fuller harness (fake clock, rAF,
// two-client relay) has existed in session scratchpads since 2026-09-18 and
// is not in the repo; this is the generation-only part, which is what a
// pre-commit check can afford to run.

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ZOMBIE = path.join(__dirname, "..", "zombie");
const PAGE = path.join(ZOMBIE, "Zombie.html");

// EVERY local script the page loads, in the page's own order. Not a
// hand-picked subset: the files are strict-mode, so a `let` one file owns
// cannot be assigned from another unless that file has actually run --
// generateLevel() writes names declared in zombie-game.js and
// zombie-endgame.js, and a stub list for those would rot the first time
// somebody added one.
function pageScripts() {
    const html = fs.readFileSync(PAGE, "utf8");
    const out = [];
    const re = /<script\s+src="([^"]+)"/g;
    let m;
    while ((m = re.exec(html))) {
        if (/^https?:/.test(m[1])) continue;
        out.push(path.resolve(ZOMBIE, m[1]));
    }
    return out;
}

const FILES = pageScripts();

// A canvas 2D context that answers every call with a no-op. Generation
// never draws; zombie-core.js only needs the object to exist.
function stubCtx() {
    return new Proxy({}, {
        get: function (t, k) {
            if (k === "canvas") return { width: 960, height: 540 };
            if (!(k in t)) t[k] = function () { return stubCtx(); };
            return t[k];
        },
        set: function (t, k, v) { t[k] = v; return true; }
    });
}

function stubCanvas() {
    return { width: 960, height: 540, style: {}, getContext: stubCtx,
             addEventListener: function () {}, getBoundingClientRect: function () {
                 return { left: 0, top: 0, width: 960, height: 540 };
             } };
}

function stubEl() {
    const el = {
        style: {}, classList: { add: function () {}, remove: function () {}, toggle: function () {},
                                contains: function () { return false; } },
        addEventListener: function () {}, removeEventListener: function () {},
        appendChild: function () {}, removeChild: function () {}, remove: function () {},
        setAttribute: function () {}, removeAttribute: function () {}, focus: function () {},
        blur: function () {}, getContext: stubCtx,
        getBoundingClientRect: function () { return { left: 0, top: 0, width: 0, height: 0 }; },
        innerHTML: "", textContent: "", value: "", width: 0, height: 0, dataset: {},
        children: [], childNodes: []
    };
    el.querySelector = function () { return stubEl(); };
    el.querySelectorAll = function () { return []; };
    el.cloneNode = function () { return stubEl(); };
    return el;
}

// Build a context, run the files into it, and return it.
function bootstrap() {
    const sandbox = {};
    sandbox.window = sandbox;
    sandbox.globalThis = sandbox;
    sandbox.console = console;
    sandbox.Math = Math;
    sandbox.Date = Date;
    sandbox.performance = { now: function () { return Date.now(); } };
    sandbox.setTimeout = function () { return 0; };
    sandbox.clearTimeout = function () {};
    sandbox.setInterval = function () { return 0; };
    sandbox.clearInterval = function () {};
    sandbox.requestAnimationFrame = function () { return 0; };
    sandbox.cancelAnimationFrame = function () {};
    sandbox.addEventListener = function () {};
    sandbox.removeEventListener = function () {};
    sandbox.location = { search: "?solo=1", hash: "", href: "http://localhost/zombie/Zombie.html?solo=1" };
    sandbox.navigator = { userAgent: "node", maxTouchPoints: 0 };
    sandbox.localStorage = sandbox.sessionStorage = {
        getItem: function () { return null; }, setItem: function () {}, removeItem: function () {}
    };
    sandbox.URLSearchParams = URLSearchParams;
    sandbox.AbortController = AbortController;
    sandbox.document = {
        getElementById: function (id) { return id === "gameCanvas" ? stubCanvas() : stubEl(); },
        querySelector: function () { return stubEl(); },
        querySelectorAll: function () { return []; },
        createElement: function (tag) { return tag === "canvas" ? stubCanvas() : stubEl(); },
        addEventListener: function () {},
        body: stubEl(),
        documentElement: stubEl(),
        hidden: false
    };
    // mp-core opens no socket under ?solo=1; this is the belt to that braces.
    sandbox.WebSocket = function () { throw new Error("no sockets in the harness"); };

    vm.createContext(sandbox);
    for (let i = 0; i < FILES.length; i++) {
        const src = fs.readFileSync(FILES[i], "utf8");
        vm.runInContext(src, sandbox, { filename: FILES[i] });
    }

    return sandbox;
}

let cached = null;

// READ THE MAP THROUGH THIS, not off the sandbox object.
//
// `let walls = []` at the top of a classic script is a LEXICAL declaration:
// in a vm context it lives in the context's global scope but is NOT a
// property of the sandbox, so `sandbox.walls` is undefined while `walls` is
// perfectly visible to code running inside. Everything this game declares is
// let/const, so every read has to be an expression evaluated in there.
function evaluate(sandbox, expr) {
    return vm.runInContext(expr, sandbox);
}

// A structured clone of an expression's value, for a caller that wants plain
// data rather than live objects that the next generate() will overwrite.
function snapshot(sandbox, expr) {
    return JSON.parse(vm.runInContext("JSON.stringify(" + expr + ")", sandbox));
}

// Generate one map. Returns the sandbox; read it with evaluate/snapshot.
function generate(seed, opts) {
    if (!cached || (opts && opts.fresh)) cached = bootstrap();
    vm.runInContext("MP.reseed(" + Number(seed) + "); generateLevel();", cached);
    return cached;
}

module.exports = { bootstrap: bootstrap, generate: generate, evaluate: evaluate,
                   snapshot: snapshot, FILES: FILES };
