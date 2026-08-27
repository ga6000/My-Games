#!/usr/bin/env node
/**
 * check-global-collisions.js
 *
 * Classic <script> tags loaded on the same HTML page share ONE global scope.
 * If two files both declare a top-level `const foo`, or both assign
 * `window.foo = ...`, the page can throw a SyntaxError at load time, or one
 * declaration can silently overwrite the other. This script parses each
 * game's real file list (as the browser would load it) and flags collisions
 * *within files that actually load together on the same page* — it does not
 * treat every .js file in the repo as one shared scope.
 *
 * Usage:
 *   node check-global-collisions.js                  # scan every *.html found under cwd
 *   node check-global-collisions.js game1.html game2.html
 *
 * Exit code: 1 if any collision was found, 0 if clean.
 */

const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

function findHtmlFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".git") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) findHtmlFiles(full, out);
    else if (entry.isFile() && entry.name.toLowerCase().endsWith(".html")) out.push(full);
  }
  return out;
}

function extractLocalScriptSrcs(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const dir = path.dirname(htmlPath);
  const srcs = [];
  const re = /<script\b[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    if (/^(https?:)?\/\//i.test(src)) continue; // external/CDN, not part of this page's local scope collisions
    srcs.push(path.resolve(dir, src));
  }
  return [...new Set(srcs)];
}

function namesFromPattern(node, out) {
  if (!node) return;
  switch (node.type) {
    case "Identifier":
      out.push(node.name);
      break;
    case "ObjectPattern":
      for (const p of node.properties) {
        if (p.type === "RestElement") namesFromPattern(p.argument, out);
        else namesFromPattern(p.value, out);
      }
      break;
    case "ArrayPattern":
      for (const el of node.elements) if (el) namesFromPattern(el, out);
      break;
    case "AssignmentPattern":
      namesFromPattern(node.left, out);
      break;
    case "RestElement":
      namesFromPattern(node.argument, out);
      break;
  }
}

// Returns { decls: [{name, kind}], windowAssigns: [name] } for one file's TOP-LEVEL statements only.
function analyzeFile(jsPath) {
  const code = fs.readFileSync(jsPath, "utf8");
  let ast;
  try {
    ast = acorn.parse(code, { ecmaVersion: "latest", sourceType: "script" });
  } catch (err) {
    return { error: err.message };
  }
  const decls = [];
  const windowAssigns = [];

  for (const stmt of ast.body) {
    if (stmt.type === "VariableDeclaration") {
      for (const d of stmt.declarations) {
        const names = [];
        namesFromPattern(d.id, names);
        for (const name of names) decls.push({ name, kind: stmt.kind });
      }
    } else if (stmt.type === "FunctionDeclaration" && stmt.id) {
      decls.push({ name: stmt.id.name, kind: "function" });
    } else if (stmt.type === "ClassDeclaration" && stmt.id) {
      decls.push({ name: stmt.id.name, kind: "class" });
    } else if (
      stmt.type === "ExpressionStatement" &&
      stmt.expression.type === "AssignmentExpression" &&
      stmt.expression.operator === "=" &&
      stmt.expression.left.type === "MemberExpression" &&
      stmt.expression.left.object.type === "Identifier" &&
      stmt.expression.left.object.name === "window" &&
      !stmt.expression.left.computed &&
      stmt.expression.left.property.type === "Identifier"
    ) {
      windowAssigns.push(stmt.expression.left.property.name);
    }
  }
  return { decls, windowAssigns };
}

function checkPage(htmlPath) {
  const scripts = extractLocalScriptSrcs(htmlPath);
  if (scripts.length === 0) return { htmlPath, scripts, collisions: [], errors: [] };

  const declMap = new Map(); // name -> [{file, kind}]
  const winMap = new Map(); // name -> [file]
  const errors = [];

  for (const jsPath of scripts) {
    const rel = path.relative(path.dirname(htmlPath), jsPath);
    if (!fs.existsSync(jsPath)) {
      errors.push(`${rel}: file not found`);
      continue;
    }
    const result = analyzeFile(jsPath);
    if (result.error) {
      errors.push(`${rel}: parse error — ${result.error}`);
      continue;
    }
    for (const { name, kind } of result.decls) {
      if (!declMap.has(name)) declMap.set(name, []);
      declMap.get(name).push({ file: rel, kind });
    }
    for (const name of result.windowAssigns) {
      if (!winMap.has(name)) winMap.set(name, []);
      winMap.get(name).push(rel);
    }
  }

  const collisions = [];
  for (const [name, sites] of declMap) {
    const files = new Set(sites.map((s) => s.file));
    if (files.size > 1) {
      const hard = sites.some((s) => s.kind !== "var" && s.kind !== "function");
      collisions.push({
        name,
        type: "declaration",
        detail: sites.map((s) => `${s.file} (${s.kind})`).join(", "),
        severity: hard ? "SyntaxError risk (redeclaration)" : "silent overwrite risk (last script wins)",
      });
    }
  }
  for (const [name, files] of winMap) {
    const uniq = [...new Set(files)];
    if (uniq.length > 1) {
      collisions.push({
        name: `window.${name}`,
        type: "assignment",
        detail: uniq.join(", "),
        severity: "silent overwrite risk (last script wins)",
      });
    }
  }

  return { htmlPath, scripts, collisions, errors };
}

function main() {
  const args = process.argv.slice(2);
  const htmlFiles = args.length > 0 ? args.map((a) => path.resolve(a)) : findHtmlFiles(process.cwd());

  if (htmlFiles.length === 0) {
    console.log("No .html files found to check.");
    process.exit(0);
  }

  let anyCollision = false;
  for (const htmlPath of htmlFiles) {
    const rel = path.relative(process.cwd(), htmlPath);
    const { scripts, collisions, errors } = checkPage(htmlPath);
    if (scripts.length === 0) continue; // no local scripts on this page, nothing to check

    if (errors.length === 0 && collisions.length === 0) {
      console.log(`OK  ${rel}  (${scripts.length} local script${scripts.length === 1 ? "" : "s"})`);
      continue;
    }
    console.log(`--- ${rel} ---`);
    for (const e of errors) console.log(`  ! ${e}`);
    for (const c of collisions) {
      anyCollision = true;
      console.log(`  ⚠ '${c.name}' declared in: ${c.detail}`);
      console.log(`      -> ${c.severity}`);
    }
  }

  process.exit(anyCollision ? 1 : 0);
}

main();
