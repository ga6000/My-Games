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
// Usage: node scripts/measure-zombie-nav.js [--seeds N]
// Reference: 0.0036% (2026-09-20), 0.0010% after the 2026-09-24 build-order
// change. It has never been zero; relocateZombie is the backstop.

const path = require("path");
const harness = require(path.join(__dirname, "zombie-headless.js"));

const args = process.argv.slice(2);
const i = args.indexOf("--seeds");
const SEEDS = i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || 12) : 12;

const PROBE = "(function () {" +
    "for (var i = 0; i < doors.length; i++) doors[i].open = true;" +
    "barricades.length = 0;" +
    "markNavDirty(); rebuildNavGrid();" +
    "var seen = new Uint8Array(navW * navH);" +
    // Seed from the nearest passable cell to the keep. A field seeded on an
    // impassable cell is degenerate -- that mistake once reported 13.4%.
    "var sx = -1, sy = -1;" +
    "var kx = Math.floor(WORLD_W / 2 / NAV_CELL), ky = Math.floor(WORLD_H / 2 / NAV_CELL);" +
    "for (var r = 0; r < 80 && sx < 0; r++)" +
    "  for (var dy = -r; dy <= r && sx < 0; dy++)" +
    "    for (var dx = -r; dx <= r && sx < 0; dx++) {" +
    "      var cx = kx + dx, cy = ky + dy;" +
    "      if (cx >= 0 && cy >= 0 && cx < navW && cy < navH && navPassable[cy * navW + cx]) { sx = cx; sy = cy; }" +
    "    }" +
    "var q = [sy * navW + sx]; seen[q[0]] = 1; var head = 0;" +
    "while (head < q.length) {" +
    "  var i0 = q[head++], cx2 = i0 % navW, cy2 = (i0 - cx2) / navW;" +
    "  var n = [[1,0],[-1,0],[0,1],[0,-1]];" +
    "  for (var k = 0; k < 4; k++) {" +
    "    var nx = cx2 + n[k][0], ny = cy2 + n[k][1];" +
    "    if (nx < 0 || ny < 0 || nx >= navW || ny >= navH) continue;" +
    "    var j = ny * navW + nx;" +
    "    if (seen[j] || !navPassable[j]) continue;" +
    "    seen[j] = 1; q.push(j);" +
    "  }" +
    "}" +
    "var pass = 0, un = 0;" +
    "for (var i1 = 0; i1 < navPassable.length; i1++) if (navPassable[i1]) { pass++; if (!seen[i1]) un++; }" +
    "return [pass, un];" +
    "})()";

let cells = 0, unreachable = 0, worst = 0, worstSeed = 0;
for (let s = 0; s < SEEDS; s++) {
    const seed = 1000 + s * 137;
    const r = harness.evaluate(harness.generate(seed), PROBE);
    cells += r[0];
    unreachable += r[1];
    if (r[1] > worst) { worst = r[1]; worstSeed = seed; }
}
console.log("nav reachability over " + SEEDS + " maps, doors open, barricades broken:");
console.log("  passable cells   " + cells);
console.log("  unreachable      " + unreachable + "  = " + ((unreachable / cells) * 100).toFixed(4) + "%");
console.log("  worst seed       " + worstSeed + " (" + worst + " cells)");
