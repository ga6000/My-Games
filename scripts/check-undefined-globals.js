#!/usr/bin/env node
/**
 * check-undefined-globals.js
 *
 * The complement to check-global-collisions.js. That one asks "did two files
 * declare the same top-level name?"; this one asks "did a file REFERENCE a
 * name that no file on the page ever declares?"
 *
 * Why it exists (2026-09-07). zombie-game.js `relocateZombie()` read
 * SPAWN_RING_MIN and SPAWN_RING_MAX. Neither existed anywhere in the repo.
 * Nothing caught it, because a ReferenceError in JavaScript is a RUNTIME
 * error on a code path nobody was exercising: relocateZombie is the escape
 * hatch for a zombie the steering cannot free, so it only fired once a big
 * zombie actually wedged. When it did, the throw propagated out of
 * updateZombies and killed the rest of update() on the host -- revives,
 * traps, and critically broadcastPlayers and broadcastWorld. gameLoop
 * re-arms its rAF first, so the host kept drawing and looked perfectly
 * healthy while every other client in the room froze solid.
 *
 * That is the shape of bug this file is for: a name that is only wrong on a
 * rare path, in a project whose hard constraint (classic <script> tags, no
 * modules, no bundler) means nothing else will ever tell you.
 *
 * It resolves a name against, in order:
 *   - anything declared at top level by ANY script on the same page
 *     (that is the whole point: they share one global scope)
 *   - anything assigned as `window.foo = ...` by those scripts
 *   - function/class/param/catch/let/const/var bindings in enclosing scopes
 *   - the browser + JS builtin allowlist below
 *   - any name the same file feature-detects with `typeof X` (an optional
 *     dependency, which is a deliberate pattern here, not an oversight)
 *
 * A page that loads a CDN script is reported as WARN rather than FAIL: its
 * globals are not visible to us, so its findings are unproven and must not
 * fail a commit.
 *
 * Usage:
 *   node check-undefined-globals.js                # scan every *.html under cwd
 *   node check-undefined-globals.js game.html
 *
 * Exit code: 1 if any unresolved reference was found, 0 if clean.
 */

const fs = require("fs");
const path = require("path");
const acorn = require("acorn");

// The shared files publish their one global through a local alias for the
// window object -- `global.IDENTITY = {...}` inside an IIFE that was handed
// `this`. Treating only `window.X` as a publish would flag IDENTITY, LB and
// RETRO on every page that uses them, and a checker with three permanent
// false positives is a checker nobody reads.
const WINDOW_ALIASES = new Set(["window", "globalThis", "self", "global", "root"]);

// Names the browser and the language provide. Deliberately generous: a false
// NEGATIVE here costs nothing (some other tool or the page itself will catch a
// misspelled builtin), while a false POSITIVE trains people to ignore the
// checker, which is how a checker dies.
const BUILTINS = new Set([
  // language
  "globalThis", "undefined", "NaN", "Infinity", "Object", "Array", "Function",
  "Boolean", "Symbol", "Error", "TypeError", "RangeError", "SyntaxError",
  "ReferenceError", "EvalError", "URIError", "Number", "BigInt", "Math", "Date",
  "String", "RegExp", "Map", "Set", "WeakMap", "WeakSet", "WeakRef", "ArrayBuffer",
  "SharedArrayBuffer", "DataView", "Int8Array", "Uint8Array", "Uint8ClampedArray",
  "Int16Array", "Uint16Array", "Int32Array", "Uint32Array", "Float32Array",
  "Float64Array", "BigInt64Array", "BigUint64Array", "Promise", "Proxy", "Reflect",
  "JSON", "Intl", "parseInt", "parseFloat", "isNaN", "isFinite", "encodeURI",
  "encodeURIComponent", "decodeURI", "decodeURIComponent", "escape", "unescape",
  "eval", "arguments", "structuredClone", "queueMicrotask", "AggregateError",
  // DOM / BOM
  "window", "document", "navigator", "location", "history", "screen", "console",
  "alert", "confirm", "prompt", "getComputedStyle", "matchMedia", "devicePixelRatio",
  "innerWidth", "innerHeight", "outerWidth", "outerHeight", "scrollX", "scrollY",
  "setTimeout", "setInterval", "clearTimeout", "clearInterval", "requestAnimationFrame",
  "cancelAnimationFrame", "requestIdleCallback", "cancelIdleCallback",
  "localStorage", "sessionStorage", "indexedDB", "crypto", "performance",
  "fetch", "Request", "Response", "Headers", "FormData", "URL", "URLSearchParams",
  "Blob", "File", "FileReader", "XMLHttpRequest", "WebSocket", "EventSource",
  "AbortController", "AbortSignal", "Event", "CustomEvent", "EventTarget",
  "MessageChannel", "MessagePort", "BroadcastChannel", "Worker", "Notification",
  "Image", "Audio", "Option", "Path2D", "ImageData", "OffscreenCanvas",
  "DOMParser", "XMLSerializer", "MutationObserver", "ResizeObserver",
  "IntersectionObserver", "TextEncoder", "TextDecoder", "CSS",
  "AudioContext", "webkitAudioContext", "OscillatorNode", "GainNode",
  "HTMLElement", "HTMLCanvasElement", "HTMLImageElement", "HTMLAudioElement",
  "Node", "Element", "Text", "DocumentFragment", "SVGElement",
  "atob", "btoa", "postMessage", "addEventListener", "removeEventListener",
  "dispatchEvent", "open", "close", "focus", "blur", "print", "scrollTo", "scrollBy",
  "DeviceOrientationEvent", "DeviceMotionEvent", "KeyboardEvent", "MouseEvent",
  "PointerEvent", "TouchEvent", "WheelEvent", "GamepadEvent", "Gamepad",
  "screenLeft", "screenTop", "top", "self", "parent", "frames", "name", "status",
  // Node. shared/identity.js is deliberately dual-loaded -- the browser gets
  // window.IDENTITY, and scripts/check-identity-parity.js requires the same
  // file -- so its `module.exports` tail is correct, not a mistake.
  "module", "exports", "require", "process", "__dirname", "__filename", "Buffer"
]);

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
  let external = 0;
  const re = /<script\b[^>]*\ssrc\s*=\s*["']([^"']+)["'][^>]*>/gi;
  let m;
  while ((m = re.exec(html))) {
    const src = m[1];
    // A CDN script (three.js, firebase) defines globals we cannot see, so a
    // page that loads one cannot be judged. Counted rather than ignored: the
    // page still gets looked at, its findings are just reported as unproven.
    if (/^(https?:)?\/\//i.test(src)) { external++; continue; }
    srcs.push(path.resolve(dir, src));
  }
  return { srcs: [...new Set(srcs)], external: external };
}

// Inline <script> blocks share the same scope and can both declare and use
// names, so they have to be part of the page's picture.
function extractInlineScripts(htmlPath) {
  const html = fs.readFileSync(htmlPath, "utf8");
  const out = [];
  const re = /<script\b(?![^>]*\ssrc\s*=)[^>]*>([\s\S]*?)<\/script>/gi;
  let m;
  let n = 0;
  while ((m = re.exec(html))) {
    if (m[1].trim()) out.push({ file: htmlPath + " (inline #" + (++n) + ")", src: m[1] });
  }
  return out;
}

// Returns { ast, isModule } or null.
//
// A `type="module"` inline script does NOT share the classic global scope, so
// its top-level bindings are invisible to the rest of the page -- but a
// `window.foo = ...` inside it publishes to the page just like anything else.
// gyro-space does exactly that with submitScoreToFirebase. Before this branch
// existed the module simply failed to parse, the publish went unseen, and the
// classic file that calls it was reported as referencing a phantom.
function parse(src, file) {
  try {
    return { ast: acorn.parse(src, { ecmaVersion: 2022, locations: true, allowReturnOutsideFunction: true }),
             isModule: false };
  } catch (e) {
    try {
      return { ast: acorn.parse(src, { ecmaVersion: 2022, locations: true, sourceType: "module" }),
               isModule: true };
    } catch (e2) {
      console.error("  parse error in " + file + ": " + e.message);
      return null;
    }
  }
}

// ---- scope walking -------------------------------------------------------
// A hand-rolled walk rather than a scope-analysis dependency: the repo keeps
// its dev tooling to one package (acorn), and the language subset in play here
// is small -- classic scripts, no modules, no decorators.

function declaredNamesInPattern(node, out) {
  if (!node) return;
  switch (node.type) {
    case "Identifier": out.add(node.name); break;
    case "ObjectPattern":
      for (const p of node.properties) {
        if (p.type === "RestElement") declaredNamesInPattern(p.argument, out);
        else declaredNamesInPattern(p.value, out);
      }
      break;
    case "ArrayPattern":
      for (const el of node.elements) declaredNamesInPattern(el, out);
      break;
    case "AssignmentPattern": declaredNamesInPattern(node.left, out); break;
    case "RestElement": declaredNamesInPattern(node.argument, out); break;
  }
}

function isFunctionNode(n) {
  return n.type === "FunctionDeclaration" || n.type === "FunctionExpression" ||
         n.type === "ArrowFunctionExpression";
}

// Every child node, generically -- acorn nodes are plain objects.
function children(node) {
  const out = [];
  for (const key of Object.keys(node)) {
    if (key === "type" || key === "start" || key === "end" || key === "loc") continue;
    const v = node[key];
    if (Array.isArray(v)) {
      for (const c of v) if (c && typeof c.type === "string") out.push(c);
    } else if (v && typeof v.type === "string") {
      out.push(v);
    }
  }
  return out;
}

// var + function declarations hoist to the nearest FUNCTION scope; let/const/class
// to the nearest BLOCK. Collect the ones that belong to `scopeNode` itself.
function collectHoisted(scopeNode, isFunctionScope, out) {
  const stack = [...(scopeNode.body ? (Array.isArray(scopeNode.body) ? scopeNode.body : [scopeNode.body]) : [])];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== "string") continue;
    if (n.type === "VariableDeclaration") {
      if (n.kind === "var" ? isFunctionScope : true) {
        for (const d of n.declarations) declaredNamesInPattern(d.id, out);
      }
      if (n.kind === "var" && !isFunctionScope) {
        // still hoists past this block, but the caller's function scope
        // already walked it -- nothing to do here
      }
      continue;
    }
    if (n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") {
      if (n.id) out.add(n.id.name);
      continue;   // do not descend into its body: that is a different scope
    }
    if (isFunctionNode(n)) continue;
    if (n.type === "ClassExpression") continue;
    for (const c of children(n)) stack.push(c);
  }
}

// Names this whole script contributes to the shared page scope.
function topLevelNames(ast) {
  const out = new Set();
  for (const n of ast.body) {
    if (n.type === "VariableDeclaration") {
      for (const d of n.declarations) declaredNamesInPattern(d.id, out);
    } else if ((n.type === "FunctionDeclaration" || n.type === "ClassDeclaration") && n.id) {
      out.add(n.id.name);
    } else if (n.type === "ExpressionStatement") {
      // `window.MP = MP;` publishes a global too.
      const e = n.expression;
      if (e.type === "AssignmentExpression" && e.left.type === "MemberExpression" &&
          !e.left.computed && e.left.object.type === "Identifier" &&
          WINDOW_ALIASES.has(e.left.object.name) &&
          e.left.property.type === "Identifier") {
        out.add(e.left.property.name);
      }
    }
  }
  // An IIFE at top level (mp-core, retro, leaderboard) publishes via
  // window.X inside itself; catch those wherever they appear.
  const stack = [...ast.body];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== "string") continue;
    if (n.type === "AssignmentExpression" && n.left.type === "MemberExpression" &&
        !n.left.computed && n.left.object.type === "Identifier" &&
        WINDOW_ALIASES.has(n.left.object.name) &&
        n.left.property.type === "Identifier") {
      out.add(n.left.property.name);
    }
    for (const c of children(n)) stack.push(c);
  }
  return out;
}

// Every name this file feature-detects with `typeof X`. Such a name is an
// OPTIONAL dependency by design, and its guarded uses must not be reported:
// mp-core.js does `if (typeof IDENTITY !== "undefined") ... IDENTITY.colorFromName(...)`
// precisely so it can be loaded on a page that has no identity.js, which
// rd-arena-bench is. Flagging the body of the guard would mean the checker
// disagrees with the idiom the repo uses on purpose.
function guardedNames(ast) {
  const out = new Set();
  const stack = [ast];
  while (stack.length) {
    const n = stack.pop();
    if (!n || typeof n.type !== "string") continue;
    if (n.type === "UnaryExpression" && n.operator === "typeof" &&
        n.argument.type === "Identifier") {
      out.add(n.argument.name);
    }
    for (const c of children(n)) stack.push(c);
  }
  return out;
}

// Walk for references, carrying a scope chain.
function findUnresolved(ast, pageGlobals, file, hits) {
  const guarded = guardedNames(ast);
  function walk(node, scopes) {
    if (!node || typeof node.type !== "string") return;

    if (node.type === "Identifier") return; // handled by parents that know the context

    // ---- new scopes ----
    if (isFunctionNode(node)) {
      const s = new Set();
      if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
        if (node.id) s.add(node.id.name);
        s.add("arguments");
      }
      for (const p of node.params) declaredNamesInPattern(p, s);
      if (node.body && node.body.type === "BlockStatement") {
        collectHoisted(node.body, true, s);
        // var hoisting through nested blocks
        const st = [...node.body.body];
        while (st.length) {
          const n = st.pop();
          if (!n || typeof n.type !== "string") continue;
          if (isFunctionNode(n) || n.type === "ClassExpression") continue;
          if (n.type === "VariableDeclaration" && n.kind === "var") {
            for (const d of n.declarations) declaredNamesInPattern(d.id, s);
          }
          if (n.type === "FunctionDeclaration") { if (n.id) s.add(n.id.name); continue; }
          for (const c of children(n)) st.push(c);
        }
        for (const st2 of node.body.body) walk(st2, [...scopes, s]);
      } else if (node.body) {
        walk(node.body, [...scopes, s]);   // concise arrow body
      }
      return;
    }

    if (node.type === "BlockStatement" || node.type === "Program") {
      const s = new Set();
      collectHoisted(node, node.type === "Program", s);
      for (const c of (node.body || [])) walk(c, [...scopes, s]);
      return;
    }

    if (node.type === "ForStatement" || node.type === "ForInStatement" || node.type === "ForOfStatement") {
      const s = new Set();
      const init = node.init || node.left;
      if (init && init.type === "VariableDeclaration") {
        for (const d of init.declarations) declaredNamesInPattern(d.id, s);
      }
      const inner = [...scopes, s];
      for (const c of children(node)) walk(c, inner);
      return;
    }

    if (node.type === "CatchClause") {
      const s = new Set();
      if (node.param) declaredNamesInPattern(node.param, s);
      walk(node.body, [...scopes, s]);
      return;
    }

    if (node.type === "ClassDeclaration" || node.type === "ClassExpression") {
      const s = new Set();
      if (node.id) s.add(node.id.name);
      for (const c of children(node)) walk(c, [...scopes, s]);
      return;
    }

    // ---- reference sites ----
    const check = (id) => {
      if (!id || id.type !== "Identifier") return;
      const n = id.name;
      if (BUILTINS.has(n) || pageGlobals.has(n) || guarded.has(n)) return;
      for (const s of scopes) if (s.has(n)) return;
      hits.push({ file, name: n, line: id.loc ? id.loc.start.line : 0 });
    };

    // `typeof X` on an undeclared X is LEGAL and returns "undefined" -- it is
    // the standard feature-detect, and the repo uses it deliberately
    // (`if (typeof LB === "undefined") return;`). It cannot throw, so it is
    // not a reference for our purposes.
    if (node.type === "UnaryExpression" && node.operator === "typeof" &&
        node.argument.type === "Identifier") {
      return;
    }

    if (node.type === "MemberExpression") {
      walk(node.object, scopes);
      if (node.computed) walk(node.property, scopes);
      if (node.object.type === "Identifier") check(node.object);
      return;
    }

    if (node.type === "Property") {
      if (node.computed) walk(node.key, scopes);
      walk(node.value, scopes);
      if (node.value.type === "Identifier" && !node.shorthand) check(node.value);
      else if (node.shorthand && node.value.type === "Identifier") check(node.value);
      return;
    }

    if (node.type === "VariableDeclarator") {
      if (node.init) { walk(node.init, scopes); if (node.init.type === "Identifier") check(node.init); }
      return;
    }

    if (node.type === "LabeledStatement" || node.type === "BreakStatement" ||
        node.type === "ContinueStatement") {
      return;   // labels are not references
    }

    for (const c of children(node)) {
      walk(c, scopes);
      if (c.type === "Identifier") {
        // skip positions where an Identifier is a name, not a reference
        if ((node.type === "FunctionDeclaration" || node.type === "FunctionExpression" ||
             node.type === "ClassDeclaration" || node.type === "ClassExpression") && node.id === c) continue;
        if (node.type === "MethodDefinition" && node.key === c) continue;
        check(c);
      }
    }
  }
  walk(ast, []);
}

function checkPage(htmlPath) {
  const { srcs, external } = extractLocalScriptSrcs(htmlPath);
  const inline = extractInlineScripts(htmlPath);
  const units = [];

  for (const s of srcs) {
    if (!fs.existsSync(s)) {
      console.log("MISS " + path.relative(process.cwd(), htmlPath) +
                  " -> missing script " + path.relative(process.cwd(), s));
      continue;
    }
    units.push({ file: s, src: fs.readFileSync(s, "utf8") });
  }
  for (const i of inline) units.push(i);
  if (!units.length) return { hits: [], external: external };

  const pageGlobals = new Set();
  const asts = [];
  for (const u of units) {
    const parsed = parse(u.src, u.file);
    if (!parsed) continue;
    // Modules contribute their window.X publishes and nothing else, and are
    // not themselves checked: their scope is not this page's scope.
    if (!parsed.isModule) asts.push({ ast: parsed.ast, file: u.file });
    for (const n of topLevelNames(parsed.ast)) pageGlobals.add(n);
  }

  const hits = [];
  for (const a of asts) findUnresolved(a.ast, pageGlobals, a.file, hits);
  return { hits: hits, external: external };
}

function main() {
  const args = process.argv.slice(2);
  const pages = args.length ? args.map((a) => path.resolve(a)) : findHtmlFiles(process.cwd());
  let bad = 0;

  for (const page of pages.sort()) {
    const rel = path.relative(process.cwd(), page);
    let res;
    try {
      res = checkPage(page);
    } catch (e) {
      console.log("ERR  " + rel + "  " + e.message);
      bad++;
      continue;
    }
    if (!res.hits.length) continue;

    // one line per distinct name, with every site
    const byName = new Map();
    for (const h of res.hits) {
      if (!byName.has(h.name)) byName.set(h.name, []);
      byName.get(h.name).push(h);
    }
    const proven = res.external === 0;
    console.log((proven ? "FAIL " : "WARN ") + rel +
                (proven ? "" : "  (" + res.external + " CDN script(s): these names may come from one)"));
    for (const [name, list] of [...byName].sort()) {
      const where = list.slice(0, 4).map((h) => path.relative(process.cwd(), h.file) + ":" + h.line).join(", ");
      const more = list.length > 4 ? " (+" + (list.length - 4) + " more)" : "";
      console.log("       " + name + "  <- " + where + more);
      if (proven) bad++;
    }
  }

  if (bad) {
    console.log("\n" + bad + " unresolved global reference" + (bad === 1 ? "" : "s") + ".");
    console.log("Each one throws a ReferenceError the first time that line runs. In a game");
    console.log("loop that means the rest of the frame's update never happens -- including,");
    console.log("on a host, the world broadcast every other client is waiting on.");
    process.exit(1);
  }
  console.log("OK    no unresolved global references");
}

main();
