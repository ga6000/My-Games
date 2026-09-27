#!/usr/bin/env node
/**
 * dev-serve.js -- a static file server for LOCAL TESTING ONLY.
 *
 * Not part of the shipped repo's runtime and not a build step: every game here
 * is required to work by double-click over file://, and that constraint is
 * unchanged. This exists because the in-app browser renders a file:// page as
 * a static snapshot with scripts disabled, so it cannot verify that a game
 * actually RUNS -- only that its markup parses. Serving the same folder over
 * http lets the same classic <script> tags execute.
 *
 * The only behavioural difference from file:// is that <script type="module">
 * would work here and does not there. No game file loaded by this server uses
 * one, which is exactly what makes the substitution safe.
 *
 *   node scripts/dev-serve.js [port]
 */
const http = require("http");
const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
// PORT env before the 8123 default, so two sessions can serve the same
// folder at once (the launch config asks the harness to assign one).
const PORT = Number(process.argv[2]) || Number(process.env.PORT) || 8123;

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".woff2": "font/woff2",
  ".mp3": "audio/mpeg",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml"
};

// THE ONE ROUTE THAT WRITES (2026-09-26). The map editor posts the
// authored map here instead of handing you a block to paste, so "export"
// means the file on disk changed.
//
// Deliberately narrow: ONE path, under the repo, and the body must still
// look like the file it is replacing. This server is already dev-only and
// refuses to serve outside ROOT; a write route wants the same care and a
// little more, because a mistake here edits the repo rather than showing
// the wrong page.
const WRITABLE = { "/zombie/zombie-map-data.js": true };

function handleWrite(req, res, rel) {
  if (!WRITABLE[rel]) { res.writeHead(403).end("not writable: " + rel); return; }
  let body = "";
  req.on("data", (c) => { body += c; if (body.length > 4e6) req.destroy(); });
  req.on("end", () => {
    // A guard against writing a truncated or wrong-shaped file: whatever
    // the editor sends has to still be the map data module.
    if (body.indexOf("const ZMAP") < 0 || body.indexOf("placements") < 0) {
      res.writeHead(400).end("that does not look like zombie-map-data.js");
      return;
    }
    fs.writeFile(path.join(ROOT, rel), body, (err) => {
      if (err) { res.writeHead(500).end(String(err.message)); return; }
      const lines = body.split("\n").length;
      console.log("wrote " + rel + " (" + lines + " lines)");
      res.writeHead(200, { "Content-Type": "text/plain" });
      res.end("wrote " + rel + ", " + lines + " lines");
    });
  });
}

http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split("?")[0]);
  if (req.method === "POST") { handleWrite(req, res, rel); return; }
  if (rel.endsWith("/")) rel += "index.html";
  const file = path.join(ROOT, rel);

  // Never serve outside the repo root, even for a dev-only server.
  if (!file.startsWith(ROOT)) { res.writeHead(403).end("forbidden"); return; }

  fs.readFile(file, (err, body) => {
    if (err) { res.writeHead(404).end("not found: " + rel); return; }
    res.writeHead(200, { "Content-Type": TYPES[path.extname(file).toLowerCase()] || "application/octet-stream" });
    res.end(body);
  });
}).listen(PORT, () => console.log("dev-serve on http://localhost:" + PORT));
