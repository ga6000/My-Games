#!/usr/bin/env node
/**
 * play-launcher.js -- one-click LOCAL playtesting (2026-11-26). Dev-only, like
 * dev-serve.js, whose handler it reuses for the repo itself.
 *
 * Double-click scripts/play-launcher.cmd (or the "Play Pleura (local)" desktop
 * shortcut that points at it). It serves the repo on http://localhost:8123,
 * opens a game picker in the browser, and adds three things dev-serve lacks:
 *
 *   /ext/<folder>/...          a standalone game that lives NEXT TO the repo in
 *                              Projects\Game Development (e.g. magnetile-drop).
 *                              Read-only. Godot projects (depth-diver) get a
 *                              button that opens them in Godot instead.
 *   /branch/<ref>/...          any claude/* branch, served straight out of git
 *                              (`git cat-file`), so nothing is checked out and
 *                              the working tree is never touched. "/" in the ref
 *                              is written "~", which git refs cannot contain.
 *   /__launcher/               the picker page, plus small JSON endpoints.
 *
 * If a launcher is already running, a second double-click just reopens the
 * picker. The page has a Stop button, so no terminal is needed at all.
 */
const http = require("http");
const fs = require("fs");
const path = require("path");
const { execFile, spawn, exec } = require("child_process");
const dev = require("./dev-serve.js");

const ROOT = dev.ROOT;                                  // ...\My Games-main
const GAMEDEV = path.resolve(ROOT, "..", "..");         // ...\Game Development
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8123;
const PICKER = "http://localhost:" + PORT + "/__launcher/";

// Folders in the repo that are not games, or are frozen copies of one.
const SKIP_REPO = /^(\.|node_modules$|scripts$|shared$|art$|concepts$|hub$|under-development$)|\.(original|pre-mp)$|-bench$/;
// Folders next to the repo that are not standalone games.
const SKIP_EXT = /^(\.|Active Github Repos$|archive$|reports$|research_notes$|resources$|working files$|z\. )/;

function git(args, opts) {
  return new Promise((resolve) => {
    execFile("git", args, Object.assign({ cwd: ROOT, maxBuffer: 64 * 1024 * 1024, windowsHide: true,
      env: Object.assign({}, process.env, { GIT_ASK_YESNO: "false", GIT_TERMINAL_PROMPT: "0" }) }, opts || {}),
      (err, stdout, stderr) => resolve({ err, stdout, stderr }));
  });
}

function htmlFiles(dir) {
  try {
    return fs.readdirSync(dir).filter((f) => /\.html?$/i.test(f)).sort((a, b) => {
      // The page named like its folder (or index.html) first.
      const base = path.basename(dir).toLowerCase().replace(/[-_ ]/g, "");
      const score = (f) => (f.toLowerCase().replace(/[-_ ]|\.html?$/g, "") === base || /^index\./i.test(f)) ? 0 : 1;
      return score(a) - score(b) || a.localeCompare(b);
    });
  } catch (e) { return []; }
}

function listDirs(dir, skip) {
  try {
    return fs.readdirSync(dir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && !skip.test(d.name)).map((d) => d.name).sort();
  } catch (e) { return []; }
}

function repoGames(sub) {
  const base = sub ? path.join(ROOT, sub) : ROOT;
  return listDirs(base, SKIP_REPO).map((name) => ({
    name, pages: htmlFiles(path.join(base, name)).map((f) => "/" + (sub ? sub + "/" : "") + name + "/" + f)
  })).filter((g) => g.pages.length);
}

function godotProject(dir) {
  for (const p of [dir, path.join(dir, "game")]) if (fs.existsSync(path.join(p, "project.godot"))) return p;
  return null;
}

function extGames() {
  return listDirs(GAMEDEV, SKIP_EXT).map((name) => {
    const dir = path.join(GAMEDEV, name);
    const pages = htmlFiles(dir).map((f) => "/ext/" + encodeURIComponent(name) + "/" + f);
    const godot = godotProject(dir);
    return { name, pages, godot: !!godot };
  }).filter((g) => g.pages.length || g.godot);
}

async function branches() {
  const r = await git(["for-each-ref", "--sort=-committerdate",
    "--format=%(refname:short)|%(committerdate:relative)|%(contents:subject)",
    "refs/remotes/origin/claude", "refs/heads/claude"]);
  const seen = new Set(), out = [];
  for (const line of r.stdout.split("\n").filter(Boolean)) {
    const [ref, when, subject] = line.split("|");
    const short = ref.replace(/^origin\//, "");
    if (seen.has(short)) continue;               // local and remote copy: keep the newer (first)
    seen.add(short);
    const key = ref.replace(/\//g, "~");
    // Which pages this branch changed relative to main, so the likely game is one click.
    const d = await git(["diff", "--name-only", "main..." + ref]);
    const tops = new Set(d.stdout.split("\n").filter(Boolean).map((f) => f.split("/").slice(0, f.startsWith("under-development/") ? 2 : 1).join("/")));
    const pages = [];
    for (const top of tops) {
      if (!top.includes("/") && SKIP_REPO.test(top) || top === "hub") continue;
      const ls = await git(["ls-tree", "--name-only", ref, top + "/"]);
      ls.stdout.split("\n").filter((f) => /\.html?$/i.test(f) && f.split("/").length === top.split("/").length + 1)
        .forEach((f) => pages.push("/branch/" + key + "/" + f));
    }
    out.push({ ref: short, when, subject, hub: "/branch/" + key + "/index.html", pages });
  }
  return out;
}

function send(res, code, type, body) {
  res.writeHead(code, { "Content-Type": type, "Cache-Control": "no-store" });
  res.end(body);
}

async function serveBranch(req, res, rest) {
  const slash = rest.indexOf("/");
  const ref = (slash < 0 ? rest : rest.slice(0, slash)).replace(/~/g, "/");
  let file = slash < 0 ? "" : rest.slice(slash + 1);
  if (!/^(origin\/)?claude\/[\w.\-\/]+$/.test(ref) || file.includes("..")) return send(res, 403, "text/plain", "forbidden");
  if (file === "" || file.endsWith("/")) file += "index.html";
  const r = await git(["cat-file", "blob", ref + ":" + file], { encoding: "buffer" });
  if (r.err) return send(res, 404, "text/plain", "not on " + ref + ": " + file);
  send(res, 200, dev.TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", r.stdout);
}

function serveExt(req, res, rest) {
  const slash = rest.indexOf("/");
  const name = slash < 0 ? rest : rest.slice(0, slash);
  if (SKIP_EXT.test(name)) return send(res, 403, "text/plain", "forbidden");
  const base = path.join(GAMEDEV, name);
  let rel = slash < 0 ? "" : rest.slice(slash + 1);
  if (rel === "" || rel.endsWith("/")) rel += "index.html";
  const file = path.resolve(base, rel);
  if (!file.startsWith(base + path.sep)) return send(res, 403, "text/plain", "forbidden");
  fs.readFile(file, (err, body) => {
    if (err) return send(res, 404, "text/plain", "not found: " + rel);
    send(res, 200, dev.TYPES[path.extname(file).toLowerCase()] || "application/octet-stream", body);
  });
}

async function api(req, res, what, query) {
  if (what === "list") {
    return send(res, 200, "application/json", JSON.stringify({
      games: repoGames(""), shelf: repoGames("under-development"), ext: extGames(), branches: await branches()
    }));
  }
  if (req.method !== "POST") return send(res, 405, "text/plain", "POST only");
  if (what === "fetch") {
    const r = await git(["fetch", "--prune", "origin"]);
    return send(res, 200, "application/json", JSON.stringify({ ok: !r.err || /->/.test(r.stderr) }));
  }
  if (what === "godot") {
    const g = extGames().find((x) => x.name === query.get("name") && x.godot);
    if (!g) return send(res, 404, "text/plain", "no such Godot project");
    const proj = godotProject(path.join(GAMEDEV, g.name));
    const child = spawn("godot", ["--path", proj], { detached: true, stdio: "ignore", shell: true, windowsHide: true });
    child.on("error", () => {});
    child.unref();
    return send(res, 200, "application/json", '{"ok":true}');
  }
  if (what === "stop") {
    send(res, 200, "application/json", '{"ok":true}');
    console.log("stopped from the picker");
    return setTimeout(() => process.exit(0), 100);
  }
  send(res, 404, "text/plain", "unknown");
}

function handler(req, res) {
  const url = new URL(req.url, "http://localhost");
  const p = decodeURIComponent(url.pathname);
  if (p === "/__launcher" || p === "/__launcher/") return send(res, 200, "text/html; charset=utf-8", PAGE);
  if (p.startsWith("/__launcher/api/")) return api(req, res, p.slice(16), url.searchParams);
  if (p.startsWith("/branch/")) return serveBranch(req, res, p.slice(8));
  if (p.startsWith("/ext/")) return serveExt(req, res, p.slice(5));
  return dev.handler(req, res);
}

function openBrowser() { if (!process.env.NO_BROWSER) exec('start "" "' + PICKER + '"', { windowsHide: true }); }

const server = http.createServer(handler);
server.on("error", (e) => {
  if (e.code !== "EADDRINUSE") throw e;
  // Something already holds the port. If it is us, just reopen the picker.
  http.get(PICKER, (r) => {
    if (r.statusCode === 200) { console.log("launcher already running; reopening the picker"); openBrowser(); setTimeout(() => process.exit(0), 1500); }
    else { console.log("port " + PORT + " is busy with something else (dev-serve?). Close it and try again."); setTimeout(() => process.exit(1), 8000); }
  }).on("error", () => process.exit(1));
});
server.listen(PORT, () => {
  console.log("Pleura local launcher on " + PICKER);
  console.log("Leave this window open while playing. Close it (or press Stop in the picker) to stop.");
  openBrowser();
  git(["fetch", "--prune", "origin"]);           // refresh claude/* branches in the background
});

const PAGE = `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><title>Pleura - local launcher</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{margin:0;background:#000;color:#cfe;font:15px/1.4 "Courier New",monospace;padding:24px 32px}
  h1{color:#7ff;letter-spacing:6px;margin:0 0 4px;font-size:30px}
  .sub{color:#688;margin-bottom:20px}
  h2{color:#fd6;font-size:14px;letter-spacing:3px;border-bottom:1px solid #233;padding-bottom:4px;margin:26px 0 10px}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(240px,1fr));gap:10px}
  .card{border:1px solid #2a4;background:#030a06;padding:10px 12px}
  .card b{color:#9f9;display:block;margin-bottom:6px}
  .card small{color:#688;display:block;margin-bottom:6px}
  a,button{display:inline-block;margin:2px 4px 2px 0;padding:4px 8px;border:1px solid #3c6;background:#061;color:#dfd;text-decoration:none;font:inherit;font-size:13px;cursor:pointer}
  a:hover,button:hover{background:#3c6;color:#000}
  .hub{font-size:20px;padding:10px 22px;border-color:#7ff;background:#033;color:#dff}
  .bar{display:flex;gap:10px;align-items:center;flex-wrap:wrap}
  .stop{border-color:#c44;background:#300;color:#fcc;margin-left:auto}
  input{background:#011;border:1px solid #355;color:#cfe;font:inherit;padding:6px 8px;width:240px}
  .hide{display:none}
</style></head><body>
<h1>PLEURA</h1><div class="sub">local playtest launcher &middot; games open in a new tab</div>
<div class="bar">
  <a class="hub" href="/" target="_blank">&#9654; Open the Pleura hub</a>
  <a class="hub" href="https://claude.ai/artifact/S4rPvY3dL8dZYccmq9CYin" target="_blank">Board</a>
  <input id="q" placeholder="filter games..." autofocus>
  <button id="fetch">Refresh branches from GitHub</button>
  <button class="stop" id="stop">Stop server</button>
</div>
<div id="out">loading...</div>
<script>
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]));
const label = (p) => p.split("/").pop().replace(/\\.html?$/i, "");
const links = (pages) => pages.map((p) => '<a target="_blank" href="' + esc(p) + '">' + esc(label(p)) + '</a>').join("");
function card(title, body, sub) { return '<div class="card" data-k="' + esc(title.toLowerCase()) + '"><b>' + esc(title) + '</b>' + (sub ? '<small>' + esc(sub) + '</small>' : '') + body + '</div>'; }
function section(t, cards) { return cards.length ? '<h2>' + t + '</h2><div class="grid">' + cards.join("") + '</div>' : ""; }
async function load() {
  const d = await (await fetch("api/list")).json();
  document.getElementById("out").innerHTML =
    section("HUB GAMES (main)", d.games.map((g) => card(g.name, links(g.pages)))) +
    section("STANDALONE GAMES (next to the repo)", d.ext.map((g) => card(g.name,
      links(g.pages) + (g.godot ? '<button data-godot="' + esc(g.name) + '">Open in Godot</button>' : "")))) +
    section("CLAUDE BRANCHES (served from git, nothing checked out)", d.branches.map((b) => card(b.ref,
      '<a target="_blank" href="' + esc(b.hub) + '">hub</a>' + links(b.pages), b.when + " - " + b.subject))) +
    section("SHELF (under-development)", d.shelf.map((g) => card(g.name, links(g.pages))));
  filter();
}
function filter() {
  const q = document.getElementById("q").value.toLowerCase();
  document.querySelectorAll(".card").forEach((c) => c.classList.toggle("hide", q && !c.dataset.k.includes(q)));
}
document.getElementById("q").oninput = filter;
document.getElementById("out").onclick = async (e) => {
  const n = e.target.dataset && e.target.dataset.godot; if (!n) return;
  e.target.textContent = "opening..."; await fetch("api/godot?name=" + encodeURIComponent(n), {method:"POST"});
  setTimeout(() => e.target.textContent = "Open in Godot", 3000);
};
document.getElementById("fetch").onclick = async (e) => {
  e.target.textContent = "fetching..."; await fetch("api/fetch", {method:"POST"}); await load();
  e.target.textContent = "Refresh branches from GitHub";
};
document.getElementById("stop").onclick = async () => {
  await fetch("api/stop", {method:"POST"}).catch(() => {});
  document.body.innerHTML = '<h1>PLEURA</h1><p>Server stopped. Double-click the desktop shortcut to start it again.</p>';
};
load();
</script></body></html>`;
