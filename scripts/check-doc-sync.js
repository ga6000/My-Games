#!/usr/bin/env node
/**
 * check-doc-sync.js
 *
 * Answers one question: "has a game's code changed since anyone last said its docs
 * were current?"
 *
 * The problem this exists for: per-game docs (`<game>/CLAUDE.md`) have historically
 * stayed accurate in this repo, while the cross-cutting root-level plans
 * (`MULTIPLAYER_PLAN.md`, `HUB_LOBBY_PLAN.md`, `PROJECT_MEMORY.md`) quietly rot —
 * the 2026-09-02 audit found every per-game doc current and every cross-cutting plan
 * stale. Nothing mechanical connected a change in `zombie/zombie-net.js` to the fact
 * that `MULTIPLAYER_PLAN.md` §4a was now describing a game that no longer existed.
 *
 * HOW IT WORKS — content fingerprints, not timestamps.
 *
 * Each tracked doc carries a stamp naming the code it was last reconciled against:
 *
 *     <!-- doc-sync: a1b2c3d4 | 2026-09-02 -->
 *
 * The hash covers the *content* of the code files that doc is responsible for. Re-run
 * the checker and it recomputes; if the hash moved, the code changed and the doc has
 * not been confirmed since. Timestamps were deliberately not used: mtimes are reset by
 * checkouts, copies and OneDrive sync, so they produce both false alarms and false
 * silence. A content hash is stable under all of those.
 *
 * WHAT IT CANNOT DO — read this before trusting a green run.
 *
 * It verifies that a human (or Claude) *asserted* the docs were current at a given
 * code state. It cannot verify the docs are actually correct — re-stamping without
 * reading is exactly as easy as reading, and produces a clean run either way. It is a
 * dirty-flag, not a proof. Treat a flagged doc as "go and re-read this", and a green
 * run as "nobody has changed the code since someone last looked."
 *
 * Usage:
 *   node scripts/check-doc-sync.js            # report drift; exit 1 if any
 *   node scripts/check-doc-sync.js --update   # re-stamp everything as current
 *   node scripts/check-doc-sync.js --update zombie
 *                                             # re-stamp only docs covering zombie/
 *
 * Run from the repo root.
 */

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const STAMP_RE = /<!--\s*doc-sync:\s*([0-9a-f]+)\s*\|\s*([0-9-]+)\s*-->/;
const CODE_EXT = new Set([".html", ".js"]);
const SKIP_DIRS = new Set(["node_modules", ".git", ".githooks", "scripts"]);

function today() {
  return new Date().toISOString().slice(0, 10);
}

// Files whose CONTENT a doc is responsible for describing.
function codeFilesIn(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isFile() && CODE_EXT.has(path.extname(e.name).toLowerCase()))
    .map((e) => path.join(dir, e.name))
    .sort();
}

// Hash file contents, not paths+mtimes. Normalise line endings so a CRLF/LF flip
// (which OneDrive and Windows editors cause routinely) is not reported as a change.
function fingerprint(files) {
  const h = crypto.createHash("sha256");
  for (const f of files) {
    const body = fs.readFileSync(f, "utf8").replace(/\r\n/g, "\n");
    h.update(path.basename(f));
    h.update("\0");
    h.update(body);
    h.update("\0");
  }
  return h.digest("hex").slice(0, 8);
}

function gameDirs(root) {
  return fs
    .readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith("."))
    .map((e) => path.join(root, e.name))
    .filter((d) => codeFilesIn(d).length > 0)
    .sort();
}

// Every doc this checker tracks, and the code each is responsible for.
function buildTargets(root) {
  const targets = [];
  const dirs = gameDirs(root);

  // 1. Per-game docs: responsible for their own folder only.
  for (const dir of dirs) {
    const doc = path.join(dir, "CLAUDE.md");
    if (fs.existsSync(doc)) {
      targets.push({ doc, files: codeFilesIn(dir), scope: path.basename(dir) });
    }
  }

  // 2. Cross-cutting docs: responsible for EVERY game's code plus the hub and shared
  //    core. These are the ones that rot, so they are deliberately the most sensitive —
  //    any game changing anywhere marks them for re-reading.
  const allCode = [
    ...dirs.flatMap(codeFilesIn),
    ...codeFilesIn(root).filter((f) => path.basename(f) !== "leaderboard.html"),
    ...codeFilesIn(path.join(root, "shared")),
  ].sort();

  // AESTHETIC_GUIDE.md added 2026-09-04. It carries a per-game treatment for
  // every game plus the shared token layer, so it is repo-wide like the other
  // three — and it is the doc most likely to drift, because it describes what
  // the code SHOULD look like rather than what it does. Nothing marked it dirty
  // before; the guide flagged that gap about itself.
  for (const name of [
    "PROJECT_MEMORY.md",
    "MULTIPLAYER_PLAN.md",
    "HUB_LOBBY_PLAN.md",
    "AESTHETIC_GUIDE.md"
  ]) {
    const doc = path.join(root, name);
    if (fs.existsSync(doc)) targets.push({ doc, files: allCode, scope: "repo-wide" });
  }

  return targets;
}

function readStamp(doc) {
  const m = fs.readFileSync(doc, "utf8").match(STAMP_RE);
  return m ? { hash: m[1], date: m[2] } : null;
}

function writeStamp(doc, hash) {
  const body = fs.readFileSync(doc, "utf8");
  const stamp = `<!-- doc-sync: ${hash} | ${today()} -->`;
  if (STAMP_RE.test(body)) {
    fs.writeFileSync(doc, body.replace(STAMP_RE, stamp), "utf8");
  } else {
    // New stamp goes at the end, where it cannot disturb a title or front matter.
    const sep = body.endsWith("\n") ? "" : "\n";
    fs.writeFileSync(doc, `${body}${sep}\n${stamp}\n`, "utf8");
  }
}

function main() {
  const args = process.argv.slice(2);
  const update = args.includes("--update");
  const filter = args.filter((a) => !a.startsWith("--"))[0] || null;

  const root = process.cwd();
  const targets = buildTargets(root);

  if (targets.length === 0) {
    console.log("No tracked docs found. Run this from the repo root.");
    process.exit(0);
  }

  let drifted = 0;
  let stamped = 0;

  for (const { doc, files, scope } of targets) {
    const rel = path.relative(root, doc);
    if (filter && scope !== filter && scope !== "repo-wide") continue;
    if (filter && scope === "repo-wide" && !update) {
      // A filtered report still shows repo-wide docs; a filtered --update re-stamps them
      // too, since a change in the filtered game does affect them.
    }

    const hash = fingerprint(files);
    const stamp = readStamp(doc);

    if (update) {
      writeStamp(doc, hash);
      stamped++;
      console.log(`stamped  ${rel}  -> ${hash} (${files.length} files, ${scope})`);
      continue;
    }

    if (!stamp) {
      drifted++;
      console.log(`UNSTAMPED  ${rel}`);
      console.log(`      -> never reconciled. Read it, then: node scripts/check-doc-sync.js --update`);
    } else if (stamp.hash !== hash) {
      drifted++;
      console.log(`STALE  ${rel}`);
      console.log(`      -> code changed since ${stamp.date} (${stamp.hash} -> ${hash}), scope: ${scope}`);
    } else {
      console.log(`ok     ${rel}  (reconciled ${stamp.date}, ${files.length} files)`);
    }
  }

  if (update) {
    console.log(`\nRe-stamped ${stamped} doc(s) as current.`);
    console.log("This asserts you READ them. It does not check that they are correct.");
    process.exit(0);
  }

  if (drifted > 0) {
    console.log(`\n${drifted} doc(s) need re-reading against the current code.`);
    console.log("Update whatever is now wrong, then: node scripts/check-doc-sync.js --update");
  }
  process.exit(drifted > 0 ? 1 : 0);
}

main();
