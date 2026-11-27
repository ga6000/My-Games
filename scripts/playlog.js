#!/usr/bin/env node
/**
 * playlog.js -- LOCAL playtest log (2026-11-27). Dev-only, like the launcher.
 *
 * Every page the launcher serves gets a small script injected (CLIENT below).
 * It reports when a run starts, a heartbeat every 10 s while playing, the result if the game
 * calls PARTY.finish(), and the end when the tab is hidden, closed or left. The
 * launcher appends each report as one JSON line to:
 *
 *     ...\Game Development\playtest-log\plays.jsonl     (next to the repo,
 *                                                       never committed)
 *
 * "Active" time only counts while the tab is visible AND there was input in the
 * last 20 s, so a game left open in a background tab does not count as play.
 * Nothing leaves the machine. Games opened by double-click (file://) are not
 * logged, because a page cannot write files.
 *
 *   node scripts/playlog.js            per-game summary (what threads read)
 *   node scripts/playlog.js --runs     one line per run, newest first
 */
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const LOG = process.env.PLAYLOG || path.join(ROOT, "..", "..", "playtest-log", "plays.jsonl");
const PLAYTEST_MS = 60 * 1000;   // a run counts as a playtest at 60 s of active play

// Which game and build a served page belongs to.
function classify(page) {
  let p = String(page || "/").split("?")[0];
  let build = "main";
  let m = p.match(/^\/branch\/([^/]+)(\/.*)?$/);
  if (m) { build = m[1].replace(/~/g, "/").replace(/^origin\//, ""); p = m[2] || "/"; }
  m = p.match(/^\/ext\/([^/]+)/);
  if (m) return { game: decodeURIComponent(m[1]), build: "standalone", page: p };
  const parts = p.split("/").filter(Boolean);
  if (!parts.length || (parts.length === 1 && /^index\.html?$/i.test(parts[0]))) return { game: "hub", build, page: p };
  if (parts[0] === "under-development" && parts[1]) return { game: parts[1], build, page: p };
  return { game: parts.length > 1 ? parts[0] : parts[0].replace(/\.html?$/i, ""), build, page: p };
}

function append(entry) {
  const line = JSON.stringify(Object.assign({ at: new Date().toISOString() }, entry, classify(entry.page))) + "\n";
  fs.mkdirSync(path.dirname(LOG), { recursive: true });
  fs.appendFileSync(LOG, line);
}

function readRuns() {
  let text = "";
  try { text = fs.readFileSync(LOG, "utf8"); } catch (e) { return []; }
  const runs = new Map();
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    let e; try { e = JSON.parse(line); } catch (err) { continue; }
    if (!e.id) continue;
    let r = runs.get(e.id);
    if (!r) { r = { id: e.id, game: e.game, build: e.build, page: e.page, title: e.title || "", start: e.at, end: e.at, activeMs: 0, inputs: 0, result: null, ended: false, fromHub: !!e.fromHub }; runs.set(e.id, r); }
    r.end = e.at;
    r.activeMs = Math.max(r.activeMs, Number(e.active) || 0);
    r.inputs = Math.max(r.inputs, Number(e.inputs) || 0);
    if (e.result) r.result = e.result;
    if (e.kind === "end") r.ended = true;
  }
  return [...runs.values()].sort((a, b) => b.start.localeCompare(a.start));
}

function summary() {
  const games = new Map();
  for (const r of readRuns()) {
    const key = r.game + (r.build === "main" ? "" : " @ " + r.build);
    let g = games.get(key);
    if (!g) { g = { game: r.game, build: r.build, runs: 0, playtests: 0, activeMs: 0, lastPlayed: null, lastPlaytest: null, lastResult: null }; games.set(key, g); }
    g.runs++;
    g.activeMs += r.activeMs;
    if (!g.lastPlayed || r.start > g.lastPlayed) g.lastPlayed = r.start;
    if (r.activeMs >= PLAYTEST_MS) {
      g.playtests++;
      if (!g.lastPlaytest || r.start > g.lastPlaytest) g.lastPlaytest = r.start;
    }
    if (r.result && !g.lastResult) g.lastResult = r.result;   // runs are newest first
  }
  return [...games.values()].sort((a, b) => String(b.lastPlayed).localeCompare(String(a.lastPlayed)));
}

// Injected into every HTML page the launcher serves. Top window only (the hub
// and the raster reel embed games in iframes; those report from their own tab).
const CLIENT = `(function () {
  if (window.top !== window || window.__playlog) return;
  window.__playlog = true;
  var id = Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  var t0 = Date.now(), last = t0, lastInput = 0, active = 0, inputs = 0, sentActive = -1, result = null, ended = false;
  var IDLE_MS = 20000, URL_ = "/__launcher/api/log";
  function tick() {
    var n = Date.now();
    if (!document.hidden && n - lastInput < IDLE_MS) active += n - last;
    last = n;
  }
  function payload(kind) {
    tick();
    return JSON.stringify({ id: id, kind: kind, page: location.pathname, fromHub: /[?&]hub=1/.test(location.search),
      title: document.title, ms: Date.now() - t0, active: active, inputs: inputs, result: result });
  }
  function send(kind) {
    var body = payload(kind);
    try {
      if (kind === "end" && navigator.sendBeacon && navigator.sendBeacon(URL_, new Blob([body], { type: "text/plain" }))) return;
      fetch(URL_, { method: "POST", body: body, keepalive: true }).catch(function () {});
    } catch (e) {}
  }
  var lastMove = 0;
  function input(e) {
    var n = Date.now();
    if (e.type === "pointermove") { if (n - lastMove < 1000) return; lastMove = n; }
    tick(); lastInput = n; inputs++;
  }
  ["keydown", "pointerdown", "pointermove", "wheel", "touchstart"].forEach(function (t) {
    addEventListener(t, input, { capture: true, passive: true });
  });
  // Hidden is the last moment a page is reliably alive (tab switch, close,
  // minimise), so flush there too; the summary takes the largest numbers per run.
  document.addEventListener("visibilitychange", function () { tick(); if (document.hidden) send("end"); });
  function wrapFinish() {
    var P = window.PARTY;
    if (!P || typeof P.finish !== "function" || P.finish.__playlog) return;
    var orig = P.finish;
    P.finish = function (r) {
      try { if (!result && r) { result = { score: Math.round(Number(r.score) || 0), cleared: !!r.cleared }; send("result"); } } catch (e) {}
      return orig.apply(this, arguments);
    };
    P.finish.__playlog = true;
  }
  function start() { wrapFinish(); send("start"); }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", start); else start();
  setInterval(function () { wrapFinish(); tick(); if (active !== sentActive) { sentActive = active; send("beat"); } }, 10000);
  addEventListener("pagehide", function () { if (!ended) { ended = true; send("end"); } });
})();`;

module.exports = { LOG, PLAYTEST_MS, classify, append, readRuns, summary, CLIENT };

if (require.main === module) {
  const min = (ms) => (ms / 60000).toFixed(1) + " min";
  const day = (iso) => iso ? iso.slice(0, 16).replace("T", " ") + "Z" : "never";
  console.log("Play log: " + LOG);
  if (process.argv.includes("--runs")) {
    for (const r of readRuns()) {
      const res = r.result ? " score " + r.result.score + (r.result.cleared ? " CLEARED" : "") : "";
      console.log(day(r.start) + "  " + r.game + (r.build === "main" ? "" : " @ " + r.build) + "  active " + min(r.activeMs) + res + (r.activeMs >= PLAYTEST_MS ? "  [playtest]" : ""));
    }
  } else {
    const rows = summary();
    if (!rows.length) console.log("No runs logged yet.");
    for (const g of rows) {
      console.log(g.game + (g.build === "main" ? "" : " @ " + g.build) + ": last playtest " + day(g.lastPlaytest) +
        ", " + g.playtests + " playtests / " + g.runs + " runs, " + min(g.activeMs) + " active" +
        (g.lastResult ? ", last result " + g.lastResult.score + (g.lastResult.cleared ? " cleared" : "") : ""));
    }
  }
}
