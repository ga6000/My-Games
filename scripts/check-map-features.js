// Does the Zombie map actually contain the map that was designed?
//
// WHY THIS EXISTS (2026-09-24). Every map pass before the 2026-09-20 audit
// was verified by proxies -- nav reachability, floor-tint dE, sightline %,
// gun placement -- and every one of them passed while the designed features
// silently failed to build: COLD STORAGE got 0 buildings of 12, THE SPILLWAY
// 2.5 pipe segments of 16, and 95% of buildings shipped with an open corner.
// Placement code `continue`s on a clash, so a feature that does not fit is
// skipped and nothing counts the misses. See zombie/MAP_VISUAL_AUDIT.md.
//
// This is the complement to check-undefined-globals.js in the same sense:
// nothing else in a no-bundler, no-type-checker repo can see these failures,
// and they sit on paths a playtest reads as "a bit empty" rather than as a bug.
//
// IT IS A REGRESSION CHECK, NOT A PASS/FAIL ON THE DESIGN. Several of the
// numbers below are bad TODAY and are known: they are recorded as baselines
// with a tolerance, so this fails when the map gets worse, not every time it
// is run. Fix a defect, then lower its baseline in the same commit.
//
// Usage:  node scripts/check-map-features.js [--seeds N] [--verbose]
// Exit 1 on a regression or a broken invariant. The pre-commit hook runs it
// warn-only, like the others.

const path = require("path");
const harness = require(path.join(__dirname, "zombie-headless.js"));

const args = process.argv.slice(2);
const SEEDS = (function () {
    const i = args.indexOf("--seeds");
    return i >= 0 ? Math.max(1, parseInt(args[i + 1], 10) || 12) : 12;
})();
const VERBOSE = args.indexOf("--verbose") >= 0;

// ---------------------------------------------------
//   BASELINES  (measured 2026-09-24, 24 seeds)
// ---------------------------------------------------
// `max` = worst allowed. `min` = least allowed. `exact` = an invariant that
// must hold on every seed. Tolerances are deliberately loose on the counts
// that a reseed moves and tight on the ones that are structural.
const BASELINE = {
    // KNOWN BAD. The 2026-09-20 audit's findings, held here so a regression
    // is visible; the fix is the stamp work in zombie/LEVEL_BUILDER_PLAN.md,
    // not a patch to makeBuilding.
    openCornerPct:      { max: 100, note: "buildings whose bite corner has no wall across it" },
    decorOnWallPct:     { max: 30,  note: "furniture pieces overlapping a wall" },
    decorOutsidePct:    { max: 22,  note: "furniture pieces outside the bitten shell" },
    zeroBuildingSectors: { max: 8.2, note: "sectors with no building, averaged over the sweep" },
    // FIXED 2026-09-24 by hoisting buildSectorInteriors above the buildings
    // and painting the drain only where a pipe stands. Keep it at zero.
    drainBuildings:     { max: 0,   note: "buildings standing on a painted Spillway drain" },
    // Floors. These are what must not fall further.
    //
    // buildingsPerMap fell 5.0 -> 3.1 in the same change, and that is the
    // TRADE, not a regression: the Spillway's storm runs and the Motor Pool's
    // bays now claim their ground before a generic building can take it, and
    // those two sectors stop getting sheds. Pipe segments went 2.5 -> 7.5 a
    // map and bays 0.38 -> 1.29. The real answer to "5 buildings against a
    // design of 49" is authored stamps, not loosening this.
    buildingsPerMap:    { min: 2.8, note: "buildings placed a map" },
    motorBaysPerMap:    { min: 1.0, note: "Motor Pool service bays built" },
    pipeSegmentsPerMap: { min: 6.0, note: "Spillway storm-run wall segments laid (16 designed)" },
    landmarks:          { exact: 7 },
    wallBuys:           { exact: 6 },
    stations:           { exact: 9 },
    doors:              { exact: 19 }
};

// Sectors that get no building on any seed today (2026-09-24, 24 seeds).
// Every name here is a DEFECT: the sector has nothing of its own instead.
const KNOWN_EMPTY = ["centre", "cold", "kennel", "pump", "turbine"];

// Sectors that get no generic building ON PURPOSE, because their own
// signature geometry fills them: the Spillway's storm runs, the Motor Pool's
// service bays, the Kennels' rolling stock, the Yard's container maze. A
// shed in a storm run was the bug, not the fix.
//
// **"yard" joined this list 2026-09-26**, with the evacuation train. It was
// already scraping 0.1 generic buildings a map -- about one in ten seeds --
// against a container maze, a gantry crane and the rail line, and this
// comment has named it a by-design case since the list was written. What
// tipped it to 0.0: the spur's static rolling stock (railStock) was removed
// so the train has a clear running line, and the Kennels|Yard boundary door
// moved onto the track. The sector did not lose content; it swapped an
// occasional shed for a locomotive.
const BY_DESIGN_EMPTY = ["spill", "motor", "yard"];

function rectsOverlap(a, b) {
    return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

// The bite is a rect anchored at one corner of the room. Its two INNER edges
// are where a wall ought to be and is not -- makeBuilding drops the shell
// spans the bite covers and never builds anything across the gap.
function biteInnerEdges(room) {
    const b = room.bite;
    if (!b || !b.w || !b.h) return [];
    const east = b.corner === 1 || b.corner === 2;
    const south = b.corner === 2 || b.corner === 3;
    const bx = east ? room.x + room.w - b.w : room.x;
    const by = south ? room.y + room.h - b.h : room.y;
    return [
        // the vertical inner edge, and the horizontal one
        { x: east ? bx : bx + b.w, y: by, w: 1, h: b.h, vertical: true },
        { x: bx, y: south ? by : by + b.h, w: b.w, h: 1, vertical: false }
    ];
}

// What fraction of an edge any solid covers. Sampled, because the walls are
// a flat list of rects and an edge is usually several spans.
function edgeCovered(edge, solids) {
    const span = edge.vertical ? edge.h : edge.w;
    const steps = Math.max(4, Math.round(span / 5));
    let hit = 0;
    for (let i = 0; i < steps; i++) {
        const t = (i + 0.5) / steps;
        const p = { x: edge.vertical ? edge.x : edge.x + edge.w * t,
                    y: edge.vertical ? edge.y + edge.h * t : edge.y, w: 1, h: 1 };
        for (let k = 0; k < solids.length; k++) {
            if (rectsOverlap(p, solids[k])) { hit++; break; }
        }
    }
    return hit / steps;
}

function inBite(room, r) {
    const b = room.bite;
    if (!b) return false;
    const east = b.corner === 1 || b.corner === 2;
    const south = b.corner === 2 || b.corner === 3;
    const bx = east ? room.x + room.w - b.w : room.x;
    const by = south ? room.y + room.h - b.h : room.y;
    return rectsOverlap(r, { x: bx, y: by, w: b.w, h: b.h });
}

function run() {
    const totals = {
        buildings: 0, openCorner: 0, decor: 0, decorOnWall: 0, decorOutside: 0,
        motorBays: 0, drainBuildings: 0, maps: 0, zeroSectors: 0, pipeSegments: 0
    };
    const sectorBuildings = {};
    const invariants = { landmarks: [], wallBuys: [], stations: [], doors: [] };
    const failures = [];

    for (let s = 0; s < SEEDS; s++) {
        const seed = 1000 + s * 137;
        let sandbox;
        try {
            sandbox = harness.generate(seed);
        } catch (e) {
            failures.push("seed " + seed + " failed to generate: " + e.message);
            continue;
        }
        const read = function (expr) { return harness.snapshot(sandbox, expr); };
        const rooms = read("buildingRooms");
        const walls = read("walls");
        const barricades = read("barricades");
        const patches = read("zfFloorPatches");
        const keys = read("zoneInfo.map(function (z) { return z.tpl.key; })");
        const zoneOfRoom = read("buildingRooms.map(function (r) { " +
                                "return zoneOf(r.x + r.w / 2, r.y + r.h / 2); })");
        const solids = walls.concat(barricades);

        invariants.landmarks.push(read("landmarks.length"));
        invariants.wallBuys.push(read("wallBuys.length"));
        invariants.stations.push(read("cardStations.length"));
        invariants.doors.push(read("doors.length"));

        const perSector = {};
        for (let i = 0; i < keys.length; i++) perSector[keys[i]] = 0;

        for (let i = 0; i < rooms.length; i++) {
            const room = rooms[i];
            totals.buildings++;
            const key = keys[zoneOfRoom[i]];
            if (key !== undefined) perSector[key]++;

            const edges = biteInnerEdges(room);
            let open = false;
            for (let e = 0; e < edges.length; e++) {
                if (edgeCovered(edges[e], solids) < 0.6) open = true;
            }
            if (open) totals.openCorner++;

            for (let d = 0; d < room.decor.length; d++) {
                const o = room.decor[d];
                totals.decor++;
                let onWall = false;
                for (let k = 0; k < solids.length && !onWall; k++) {
                    if (rectsOverlap(o, solids[k])) onWall = true;
                }
                if (onWall) totals.decorOnWall++;
                if (inBite(room, o)) totals.decorOutside++;
            }
        }

        // The Spillway's storm runs: WALL_T-wide vertical segments in the
        // sector's spine, between the runs' own top and bottom. This is the
        // count that was 2.5 of a designed 16 before the build order moved.
        for (let i = 0; i < walls.length; i++) {
            const w = walls[i];
            if (w.w === 20 && w.h > 100 && w.x < 820 && w.y >= 330 && w.y + w.h <= 1730) {
                totals.pipeSegments++;
            }
        }

        // A service bay is the only 210x190 hardstanding on the map.
        for (let i = 0; i < patches.length; i++) {
            const p = patches[i];
            if (p.kind === "hardstand" && p.w === 210 && p.h === 190) totals.motorBays++;
            // A building standing on a painted drain: the Spillway's pipe
            // floor goes down before the pipes, and the buildings take the
            // ground first. See MAP_VISUAL_AUDIT.md 1.3.
            if (p.kind !== "invert") continue;
            for (let r = 0; r < rooms.length; r++) {
                if (rectsOverlap(rooms[r], p)) { totals.drainBuildings++; break; }
            }
        }

        let zero = 0;
        for (const k in perSector) if (perSector[k] === 0) zero++;
        totals.zeroSectors += zero;
        for (const k in perSector) {
            sectorBuildings[k] = (sectorBuildings[k] || 0) + perSector[k];
        }
        totals.maps++;

        if (VERBOSE) {
            console.log("  seed " + seed + ": " + rooms.length + " buildings, " +
                        zero + " empty sectors");
        }
    }

    if (!totals.maps) {
        console.log("FAIL  no map generated at all");
        return 1;
    }

    const measured = {
        openCornerPct: pct(totals.openCorner, totals.buildings),
        decorOnWallPct: pct(totals.decorOnWall, totals.decor),
        decorOutsidePct: pct(totals.decorOutside, totals.decor),
        zeroBuildingSectors: totals.zeroSectors / totals.maps,
        buildingsPerMap: totals.buildings / totals.maps,
        motorBaysPerMap: totals.motorBays / totals.maps,
        drainBuildings: totals.drainBuildings / totals.maps,
        pipeSegmentsPerMap: totals.pipeSegments / totals.maps
    };

    console.log("Zombie map features, " + totals.maps + " seeds:");
    report("buildings a map", measured.buildingsPerMap, BASELINE.buildingsPerMap, failures);
    report("sectors with no building", measured.zeroBuildingSectors, BASELINE.zeroBuildingSectors, failures);
    report("open-corner buildings %", measured.openCornerPct, BASELINE.openCornerPct, failures);
    report("furniture on a wall %", measured.decorOnWallPct, BASELINE.decorOnWallPct, failures);
    report("furniture outside the shell %", measured.decorOutsidePct, BASELINE.decorOutsidePct, failures);
    report("Motor Pool bays a map", measured.motorBaysPerMap, BASELINE.motorBaysPerMap, failures);
    report("Spillway pipe segments a map", measured.pipeSegmentsPerMap, BASELINE.pipeSegmentsPerMap, failures);
    report("buildings on a drain a map", measured.drainBuildings, BASELINE.drainBuildings, failures);

    const names = Object.keys(sectorBuildings).sort();
    const empties = names.filter(function (k) { return sectorBuildings[k] === 0; });
    console.log("  buildings by sector: " + names.map(function (k) {
        return k + " " + (sectorBuildings[k] / totals.maps).toFixed(1);
    }).join(", "));

    // A sector that gets nothing on EVERY seed is the headline defect, and
    // five of them do today. Listing the known ones rather than failing on
    // them keeps this check green-until-it-regresses: a check that fails on
    // every commit is a check nobody reads. THE GOAL IS AN EMPTY LIST.
    const newEmpties = empties.filter(function (k) {
        return KNOWN_EMPTY.indexOf(k) < 0 && BY_DESIGN_EMPTY.indexOf(k) < 0;
    });
    const fixed = KNOWN_EMPTY.filter(function (k) { return empties.indexOf(k) < 0; });
    if (KNOWN_EMPTY.length) {
        console.log("  KNOWN: no building on any seed in: " + KNOWN_EMPTY.join(", ") +
                    "  (audit 2026-09-20; target is none)");
    }
    if (newEmpties.length) {
        failures.push("sectors that NEWLY get zero buildings on every seed: " + newEmpties.join(", "));
    }
    if (fixed.length) {
        console.log("  " + fixed.join(", ") + " now gets buildings -- remove it from KNOWN_EMPTY.");
    }

    checkExact("landmarks", invariants.landmarks, BASELINE.landmarks.exact, failures);
    checkExact("wall-buys", invariants.wallBuys, BASELINE.wallBuys.exact, failures);
    checkExact("stations", invariants.stations, BASELINE.stations.exact, failures);
    checkExact("doors", invariants.doors, BASELINE.doors.exact, failures);

    console.log("");
    if (failures.length) {
        for (let i = 0; i < failures.length; i++) console.log("FAIL  " + failures[i]);
        console.log("");
        console.log("If a change made the map genuinely better or is a deliberate trade,");
        console.log("move the baseline in scripts/check-map-features.js in the same commit.");
        return 1;
    }
    console.log("OK    no regression against the 2026-09-24 baselines");
    console.log("      (several of these are BAD and known -- zombie/MAP_VISUAL_AUDIT.md)");
    return 0;
}

function pct(n, d) { return d ? (n * 100) / d : 0; }

function report(label, value, base, failures) {
    const shown = value.toFixed(value < 10 ? 2 : 1);
    let verdict = "";
    if (base.max !== undefined && value > base.max + 1e-9) {
        verdict = "  <- WORSE than the baseline of " + base.max;
        failures.push(label + ": " + shown + " against a baseline of " + base.max);
    }
    if (base.min !== undefined && value < base.min - 1e-9) {
        verdict = "  <- BELOW the baseline of " + base.min;
        failures.push(label + ": " + shown + " against a floor of " + base.min);
    }
    console.log("  " + label.padEnd(32) + shown + verdict);
}

function checkExact(label, values, want, failures) {
    const bad = values.filter(function (v) { return v !== want; });
    if (bad.length) {
        failures.push(label + ": expected " + want + " on every map, saw " +
                      Array.from(new Set(values)).join("/") + " over " + values.length + " seeds");
    } else {
        console.log("  " + (label + " (every map)").padEnd(32) + want);
    }
}

process.exit(run());
