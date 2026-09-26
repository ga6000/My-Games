// Unreachable passable nav cells, doors open and barricades broken, flood
// filled from the keep.
//
// zombie/CLAUDE.md asks for this number whenever map geometry moves, and
// until now it was rewritten from scratch each time in a session scratchpad.
// It is the measurement that found the pipe-run and forest pockets (579 and
// 488 cells) before they shipped: a sealed pocket is a free safe spot for a
// player and a trap for any zombie that wanders into it.
//
// NOT in the pre-commit hook -- it is slower than check-map-features.js and
// only means something when the geometry has actually changed.
//
// BOTH GRIDS since 2026-09-26. The nav grid split by body size -- TIGHT
// (pad 0) for the 16-20px bodies and WIDE (pad 19) for brute and up -- so
// "unreachable" is now two different questions:
//
//   TIGHT  is anywhere genuinely sealed? This is the old number, and the
//          one that must stay near zero.
//   WIDE   how much of the map can the big bodies not enter? This is
//          EXPECTED to be larger and is a design dial, not a fault: a
//          one-cell door is a door a brute cannot fit through.
//
// Usage: node scripts/measure-zombie-nav.js [--seeds N]
// Reference (tight): 0.0036% on 2026-09-20, 0.0010% after the 2026-09-24
// build-order change. It has never been zero; relocateZombie is the backstop.

const path = require("path");
const harness = require(path.join(__dirname, "zombie-headless.js"));

const args = process.argv.slice(2);
const i = args.indexOf("--seeds");
const SEEDS = i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || 12) : 12;

function probe(wide) {
  return PROBE.replace("__WIDE__", wide ? "true" : "false");
}

const PROBE = "(function () {" +
    "for (var i = 0; i < doors.length; i++) doors[i].open = true;" +
    "barricades.length = 0;" +
    "markNavDirty(); rebuildNavGrid();" +
    "var navPass = navGridFor(__WIDE__);" +
    "var seen = new Uint8Array(navW * navH);" +
    // Seed from the nearest passable cell to the keep. A field seeded on an
    // impassable cell is degenerate -- that mistake once reported 13.4%.
    "var sx = -1, sy = -1;" +
    "var kx = Math.floor(WORLD_W / 2 / NAV_CELL), ky = Math.floor(WORLD_H / 2 / NAV_CELL);" +
    "for (var r = 0; r < 80 && sx < 0; r++)" +
    "  for (var dy = -r; dy <= r && sx < 0; dy++)" +
    "    for (var dx = -r; dx <= r && sx < 0; dx++) {" +
    "      var cx = kx + dx, cy = ky + dy;" +
    "      if (cx >= 0 && cy >= 0 && cx < navW && cy < navH && navPass[cy * navW + cx]) { sx = cx; sy = cy; }" +
    "    }" +
    "var q = [sy * navW + sx]; seen[q[0]] = 1; var head = 0;" +
    "while (head < q.length) {" +
    "  var i0 = q[head++], cx2 = i0 % navW, cy2 = (i0 - cx2) / navW;" +
    "  var n = [[1,0],[-1,0],[0,1],[0,-1]];" +
    "  for (var k = 0; k < 4; k++) {" +
    "    var nx = cx2 + n[k][0], ny = cy2 + n[k][1];" +
    "    if (nx < 0 || ny < 0 || nx >= navW || ny >= navH) continue;" +
    "    var j = ny * navW + nx;" +
    "    if (seen[j] || !navPass[j]) continue;" +
    "    seen[j] = 1; q.push(j);" +
    "  }" +
    "}" +
    "var pass = 0, un = 0;" +
    "for (var i1 = 0; i1 < navPass.length; i1++) if (navPass[i1]) { pass++; if (!seen[i1]) un++; }" +
    "return [pass, un];" +
    "})()";

const tally = { tight: { cells: 0, un: 0, worst: 0, seed: 0 },
                wide:  { cells: 0, un: 0, worst: 0, seed: 0 } };
for (let s = 0; s < SEEDS; s++) {
    const seed = 1000 + s * 137;
    const sandbox = harness.generate(seed);
    [["tight", false], ["wide", true]].forEach(function (pair) {
        const r = harness.evaluate(sandbox, probe(pair[1]));
        const t = tally[pair[0]];
        t.cells += r[0];
        t.un += r[1];
        if (r[1] > t.worst) { t.worst = r[1]; t.seed = seed; }
    });
}
console.log("nav reachability over " + SEEDS + " maps, doors open, barricades broken:");
["tight", "wide"].forEach(function (k) {
    const t = tally[k];
    console.log("  " + k.toUpperCase().padEnd(6) +
                " passable " + String(t.cells).padStart(7) +
                "   unreachable " + String(t.un).padStart(6) +
                " = " + ((t.un / t.cells) * 100).toFixed(4) + "%" +
                "   worst seed " + t.seed + " (" + t.worst + ")");
});
console.log("  TIGHT is the one that must stay near zero. WIDE is how much of the map");
console.log("  the big bodies cannot enter, which tight doors deliberately increase.");
