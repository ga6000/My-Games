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
    // WAS the 2026-09-20 audit's headline defects, at 100% / 30% / 22% on
    // 2026-09-24. Hand-authored stamps (zombie-stamps.js, 2026-09-26) took
    // all three to ZERO, because a drawn building is checked before it is
    // ever placed and a stamp that fails is dropped, not shipped. The small
    // margin left is for makeBuilding, still the fallback where a sector
    // has no stamp that fits. RAISING ANY OF THESE AGAIN MEANS THE MAP HAS
    // GONE BACK TO GENERATED BUILDINGS.
    openCornerPct:      { max: 5,   note: "buildings whose bite corner has no wall across it" },
    decorOnWallPct:     { max: 5,   note: "furniture pieces overlapping a wall" },
    decorOutsidePct:    { max: 5,   note: "furniture pieces outside the bitten shell" },
    // Counts only sectors NOT in BY_DESIGN_EMPTY (2026-09-26), so this is
    // "empty by ACCIDENT". Measured at 2.0 a map: TURBINE HALL gets a
    // building on about one seed in ten and PUMP HOUSE on three, because
    // nothing in the library is shaped for what is left of them. THE
    // TARGET IS 0 and the way there is drawing stamps that fit those two,
    // or placing buildings there by hand in the map editor -- not raising
    // this number.
    // 2.0 a map before the authored starter set, 0.83 after it -- TURBINE
    // HALL went 0.1 buildings a map to 2.0 and COLD STORAGE 0.8 to 2.4.
    // Tightened to match, because a baseline left slack is a baseline that
    // stops catching anything. THE PUMP HOUSE is what is left: nothing in
    // the stamp library fits it.
    zeroBuildingSectors: { max: 1.0, note: "sectors with no building by accident, per map" },
    // FIXED 2026-09-24 by hoisting buildSectorInteriors above the buildings
    // and painting the drain only where a pipe stands. Keep it at zero.
    drainBuildings:     { max: 0,   note: "buildings standing on a painted Spillway drain" },
    // Floors. These are what must not fall further.
    //
    // buildingsPerMap has changed meaning (2026-09-26, ZMAP.authoredOnly).
    // It was a quality number while the generator placed buildings: 5.0,
    // then 3.1 after the build-order fix, then 16.3 once stamps landed.
    // With the seeded placer OFF it is simply how many buildings have been
    // authored, and it is the same on every seed. It rises as the map is
    // drawn; the thing worth failing on is authoredMissing below, which
    // says whether what was authored actually got built.
    buildingsPerMap:    { min: 10,  note: "buildings placed a map (= authored, while authoredOnly)" },
    // 1.29 before the evacuation train (ef4129c), 1.04 after: the SE tunnel
    // takes Motor Pool ground. Left as a floor rather than chased -- it is
    // another session's change, and still well above the 0.38 it was before
    // any of this work.
    motorBaysPerMap:    { min: 0.9, note: "Motor Pool service bays built" },
    pipeSegmentsPerMap: { min: 6.0, note: "Spillway storm-run wall segments laid (16 designed)" },
    // AUTHORED BUILDINGS THAT DID NOT BUILD (2026-09-26). A placement is
    // somebody's decision, so one that silently does not appear is the
    // original defect wearing a new hat. The map's skeleton -- the keep,
    // the sluice, the boundary doors -- is still seeded, so a placement can
    // legitimately clash on some seeds; the number is what must not drift.
    // 0 over the 12 seeds this script uses, but NOT zero in general: the
    // sluice room is still seeded, and on about one map in thirty it lands
    // across the Sluice Yard placement at 2580,2260 -- measured over 70
    // seeds from three different families, and a smaller stamp in the same
    // place fails on the same seeds, so it is the ground and not the
    // building. The tolerance is that reality rather than the seeds this
    // script happens to draw; tuning it to 0 on the test family would be
    // measuring the test family.
    authoredMissing:    { max: 0.1, note: "authored placements that failed to build, per map" },
    landmarks:          { exact: 7 },
    wallBuys:           { exact: 6 },
    stations:           { exact: 9 },
    doors:              { exact: 19 }
};

// Sectors that get no building on any seed. EMPTY SINCE 2026-09-26, which
// is the whole point of the list: it held centre, cold, kennel, pump and
// turbine for months, and hand-authored stamps emptied it. A name appearing
// here again is a sector that has quietly stopped being built.
const KNOWN_EMPTY = [];

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
// THE KENNELS joined them on 2026-09-26: it is full of rolling stock and
// containers at 8.1 pieces a map, which IS its geometry.
const BY_DESIGN_EMPTY = ["spill", "motor", "yard", "kennel"];

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
        motorBays: 0, drainBuildings: 0, maps: 0, zeroSectors: 0, pipeSegments: 0,
        authoredMissing: 0
    };
    const sectorBuildings = {};
    const invariants = { landmarks: [], wallBuys: [], stations: [], doors: [] };
    const failures = [];
    let authoredOnly = false;

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
        totals.authoredMissing += read("ZMAP.report.missing.length");
        authoredOnly = !!read("ZMAP.authoredOnly");

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
        // RELATIVE TO THE SECTOR ORIGIN (2026-09-26). These were absolute,
        // and the perimeter band moved the sectors by MAP_X0/MAP_Y0 -- the
        // count fell 8.0 -> 1.75 and nothing was wrong with the map. A
        // check written in world coordinates measures the origin as much as
        // the thing it is checking.
        const ox = read("MAP_X0"), oy = read("MAP_Y0");
        for (let i = 0; i < walls.length; i++) {
            const w = walls[i];
            if (w.w === 20 && w.h > 100 &&
                w.x < ox + 820 && w.y >= oy + 330 && w.y + w.h <= oy + 1730) {
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

        // BY-DESIGN-EMPTY SECTORS DO NOT COUNT (2026-09-26). Four of the
        // nine are meant to hold no generic building -- their own geometry
        // fills them -- so counting them made this metric mostly a count of
        // decisions already taken, and it drifted up whenever one more
        // sector was correctly recognised as by-design. What it is for is
        // sectors that are empty by ACCIDENT.
        let zero = 0;
        for (const k in perSector) {
            if (BY_DESIGN_EMPTY.indexOf(k) >= 0) continue;
            if (perSector[k] === 0) zero++;
        }
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
        pipeSegmentsPerMap: totals.pipeSegments / totals.maps,
        authoredMissing: totals.authoredMissing / totals.maps
    };

    console.log("Zombie map features, " + totals.maps + " seeds:");
    report("buildings a map", measured.buildingsPerMap, BASELINE.buildingsPerMap, failures);
    report("sectors empty by accident", measured.zeroBuildingSectors, BASELINE.zeroBuildingSectors, failures);
    report("open-corner buildings %", measured.openCornerPct, BASELINE.openCornerPct, failures);
    report("furniture on a wall %", measured.decorOnWallPct, BASELINE.decorOnWallPct, failures);
    report("furniture outside the shell %", measured.decorOutsidePct, BASELINE.decorOutsidePct, failures);
    report("Motor Pool bays a map", measured.motorBaysPerMap, BASELINE.motorBaysPerMap, failures);
    report("Spillway pipe segments a map", measured.pipeSegmentsPerMap, BASELINE.pipeSegmentsPerMap, failures);
    report("buildings on a drain a map", measured.drainBuildings, BASELINE.drainBuildings, failures);
    report("authored buildings missing", measured.authoredMissing, BASELINE.authoredMissing, failures);

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
        // WITH THE MAP AUTHORED, an empty sector is a TO-DO, not a defect.
        // ZMAP.authoredOnly means the buildings on the map are exactly the
        // ones somebody placed, so a sector with none has not been drawn
        // yet -- failing on that would fail on every commit until the whole
        // map is hand-built, and a check that always fails is a check
        // nobody reads. What still fails is a placement that was authored
        // and did not build: authoredMissing, above.
        if (authoredOnly) {
            console.log("  NOT AUTHORED YET (the map is hand-built now): " + newEmpties.join(", "));
        } else {
            failures.push("sectors that NEWLY get zero buildings on every seed: " + newEmpties.join(", "));
        }
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
