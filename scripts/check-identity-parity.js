#!/usr/bin/env node
/**
 * check-identity-parity.js
 *
 * Proves that the client's name→colour implementation (`shared/identity.js`) and
 * the server's (`gyro-space-server/server.js`) still agree.
 *
 * WHY THIS EXISTS. Root CLAUDE.md says colour is server-side and name-hash based.
 * It is — the server is the authority and wins at runtime. But `file://` play is
 * also a hard constraint, and a double-clicked game has no server to ask, so a
 * client copy is *required*. Duplication here cannot be designed away; it can
 * only be made safe. This is what makes it safe.
 *
 * It replaces the old situation, where the same scheme existed three times:
 * server.js, index.html (byte-identical), and reality-rewrite.html (a different
 * scheme that agreed with the server 0 times out of 10).
 *
 * The server lives in a SEPARATE repo, so this resolves it by path. If that repo
 * isn't beside this one, the check skips with a warning rather than failing —
 * a missing sibling checkout is not a drift.
 *
 * Usage:
 *   node scripts/check-identity-parity.js
 *   node scripts/check-identity-parity.js --server ../path/to/server.js
 *
 * Exit code: 1 on drift, 0 when they agree (or when the server file is absent).
 */

/**
 * ============================================================================
 * WHAT THIS CHECKER CANNOT SEE — read before trusting a green run (2026-09-04)
 * ============================================================================
 *
 * It compares TWO LOCAL FILES: shared/identity.js against the local checkout of
 * ../gyro-space-server-main/server.js. It proves the client matches the SERVER
 * SOURCE. It does NOT prove the client matches the server that is actually
 * RUNNING, because it never speaks to it.
 *
 * That gap is not hypothetical. Measured 2026-09-04 against the live Render
 * deployment, over five names:
 *
 *     name        client (identity.js)   deployed server
 *     Ry          hsl(0, 75%, 58%)       hsl(260, 75%, 60%)
 *     Alex        hsl(338, 75%, 46%)     hsl(210, 85%, 55%)
 *     Sam         hsl(135, 66%, 40%)     hsl(180, 75%, 45%)
 *     Jordan      hsl(293, 80%, 40%)     hsl(120, 70%, 45%)
 *     Anonymous   hsl(315, 75%, 58%)     hsl(0, 85%, 60%)
 *
 * 0 of 5 agree, and 0 of 5 of the server's answers appear ANYWHERE in the
 * current 16-colour palette — the deployment is still serving the pre-2026-09-03
 * palette. This checker was green the whole time, correctly, because the local
 * server.js has been updated. Only the REDEPLOY is missing.
 *
 * The consequence is the exact thing root CLAUDE.md forbids: a player's colour
 * does not match across screens. PROJECT_MEMORY predicted it in the 2026-09-03
 * entry — "until step 2 ships, clients and the server disagree, which is exactly
 * the class of bug the parity checker exists to catch" — and then it shipped
 * anyway, because a green local run reads like proof.
 *
 * TO CLOSE IT: push shared/identity.js's palette to the gyro-space-server repo
 * and redeploy Render. Then re-run the live probe, not just this script.
 */

const fs = require("fs");
const path = require("path");

const DEFAULT_SERVERS = [
  "../gyro-space-server-main/server.js",
  "../gyro-space-server/server.js",
];

function loadClient() {
  const p = path.resolve(process.cwd(), "shared/identity.js");
  if (!fs.existsSync(p)) {
    console.error("! shared/identity.js not found. Run from the repo root.");
    process.exit(1);
  }
  const sandbox = { window: {}, module: { exports: {} } };
  sandbox.window.window = sandbox.window;
  new Function("window", "module", fs.readFileSync(p, "utf8")).call(
    sandbox.window, sandbox.window, sandbox.module
  );
  return sandbox.window.IDENTITY;
}

// The server is a live ws server; requiring it would start it. Pull just the two
// pieces we care about out of the source text and evaluate those in isolation.
function loadServer(serverPath) {
  const src = fs.readFileSync(serverPath, "utf8");

  const pal = src.match(/const\s+COLOR_PALETTE\s*=\s*\[([\s\S]*?)\]\s*;/);
  const fn = src.match(/function\s+hashStringToIndex\s*\([\s\S]*?\n\}/);
  const from = src.match(/function\s+getColorFromName\s*\([\s\S]*?\n\}/);

  if (!pal || !fn || !from) {
    console.error(`! Could not find COLOR_PALETTE / hashStringToIndex / getColorFromName in ${serverPath}`);
    console.error("  The server's shape changed — update this checker rather than deleting it.");
    process.exit(1);
  }

  const scope = {};
  new Function(
    `const COLOR_PALETTE = [${pal[1]}];\n${fn[0]}\n${from[0]}\n` +
    "this.PALETTE = COLOR_PALETTE; this.colorFromName = getColorFromName; this.hashStringToIndex = hashStringToIndex;"
  ).call(scope);
  return scope;
}

// Names chosen to exercise the edges, not just the happy path: empty and
// whitespace (both must hit the shared "Anonymous" default), case and unicode,
// plus a long run of ordinary names to catch a palette that differs only in one
// slot — which is exactly what a careless edit produces.
function corpus() {
  const fixed = [
    "", "   ", "Anonymous", "anonymous", "A", "Z", "Alice", "alice", "ALICE",
    "Bob", "Riley", "Sam", "Dave", "Kim", "Jo", "Max", "Ana", "Zed",
    "Ann-Marie", "Jo Jo", " padded ", "émile", "日本語", "🎮", "x".repeat(200),
  ];
  const generated = [];
  for (let i = 0; i < 3000; i++) generated.push("player_" + i.toString(36));
  return fixed.concat(generated);
}

function main() {
  const argIdx = process.argv.indexOf("--server");
  const candidates = argIdx > -1 ? [process.argv[argIdx + 1]] : DEFAULT_SERVERS;

  const serverPath = candidates
    .map((c) => path.resolve(process.cwd(), c))
    .find((p) => fs.existsSync(p));

  const client = loadClient();

  if (!serverPath) {
    console.log("SKIP  server.js not found beside this repo — cannot check parity.");
    console.log("      Looked for: " + DEFAULT_SERVERS.join(", "));
    console.log("      Pass --server <path>, or ignore this if you have no server checkout.");
    console.log(`ok    client palette: ${client.PALETTE.length} colours`);
    process.exit(0);
  }

  const server = loadServer(serverPath);
  const rel = path.relative(process.cwd(), serverPath);
  let failures = [];

  if (server.PALETTE.length !== client.PALETTE.length) {
    failures.push(`palette LENGTH differs: server ${server.PALETTE.length}, client ${client.PALETTE.length}`);
  } else {
    server.PALETTE.forEach((c, i) => {
      if (c !== client.PALETTE[i]) {
        failures.push(`palette[${i}] differs: server "${c}" vs client "${client.PALETTE[i]}"`);
      }
    });
  }

  let mismatches = 0, firstExamples = [];
  for (const name of corpus()) {
    const a = server.colorFromName(name);
    const b = client.colorFromName(name);
    if (a !== b) {
      mismatches++;
      if (firstExamples.length < 5) firstExamples.push(`"${name}" -> server ${a}, client ${b}`);
    }
  }

  const names = corpus().length;
  if (failures.length === 0 && mismatches === 0) {
    console.log(`OK    identity parity: ${names} names agree`);
    console.log(`      client shared/identity.js  <->  server ${rel}`);
    console.log(`      ${client.PALETTE.length} colours, identical and in the same order`);
    process.exit(0);
  }

  console.log("--- identity parity FAILED ---");
  for (const f of failures) console.log(`  ⚠ ${f}`);
  if (mismatches) {
    console.log(`  ⚠ ${mismatches} of ${names} names resolve to different colours`);
    for (const e of firstExamples) console.log(`      ${e}`);
  }
  console.log("");
  console.log("  A player would be one colour on the hub and another in-game.");
  console.log(`  Fix: make the palette and hash in ${rel} and shared/identity.js identical.`);
  process.exit(1);
}

main();
