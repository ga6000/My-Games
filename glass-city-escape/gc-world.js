/**
 * Glass City Escape — world generation and stage management
 *
 * Split out of glass_city_escape.html's inline script 2026-09-04 (Pass A of
 * glass-city-escape/GCE_PASS_PLAN.md). The lines below were MOVED VERBATIM --
 * Pass A deliberately changed no behaviour, so that any regression could be
 * attributed to the skin pass that followed rather than to the split.
 *
 * Classic scripts, one shared global scope, no modules (the file:// hard
 * constraint). Declarations only.
 */
"use strict";

/**
 * World Generation & Stage Management
 */
function generateWorld() {
    // Rewind the shared random stream to this stage's starting point, so
    // the whole build below (buildings, doors, stairs, then the
    // collectibles and robots that continue the same stream) lands
    // identically on every client.
    seedForStage();

    for (let z = 0; z < MAX_Z; z++) {
        mapData[z] = [];
        for (let y = 0; y < TOTAL_CELLS; y++) {
            mapData[z][y] = [];
            for (let x = 0; x < TOTAL_CELLS; x++) {
                mapData[z][y][x] = null;
            }
        }
    }

    // THE ARENA (2026-09-06). Only the arena is ground; everything outside it
    // stays null, and the boundary itself is a wall ring.
    //
    // Why a ring and not just a clamp: at stage 1 the arena is 29 cells inside
    // a 58-cell map, holding one drone and one core. An invisible clamp there
    // reads as the game being broken -- you walk into nothing and stop. A wall
    // is a told edge, and it is the same wall type the buildings use, so it
    // needs no new collision rule.
    const h = arenaHalf(currentStage);
    const lo = PLAZA_CX - h, hi = PLAZA_CX + h;
    for (let y = lo; y <= hi; y++) {
        for (let x = lo; x <= hi; x++) {
            if (x < 0 || y < 0 || x >= TOTAL_CELLS || y >= TOTAL_CELLS) continue;
            const edge = (x === lo || x === hi || y === lo || y === hi);
            mapData[0][y][x] = edge ? { type: 'wall', broken: false, boundary: true }
                                    : { type: 'exterior' };
        }
    }

    layOutCity();
    carveStepwell();
}

/**
 * THE STEPWELL (2026-09-06, GCE_STEPWELL_PASS_PLAN.md §9)
 *
 * A 13x13 plaza at the map centre, terraced like a baoli: concentric rings
 * descending to the escape tunnel at the exact middle. Run AFTER layOutCity(),
 * which already refuses to place a building that would intersect the plaza --
 * so this is filling reserved ground, not demolishing anything.
 *
 * Each tile carries its Chebyshev ring index (0 at the centre, PLAZA_HALF at
 * the lip) so the renderer draws terraces without recomputing distance for
 * every tile of every frame.
 *
 * WALKABLE EXACTLY LIKE `exterior` AT z = 0, and every consumer was checked
 * rather than assumed: the player's and the robot's checkWallCollision only
 * block `wall`; botWalkable only excludes `wall` and above-ground `exterior`;
 * checkLOS only stops on `wall`. Cores and ground robots both test
 * `=== 'exterior'` explicitly, so neither spawns inside the well -- which is
 * right. It is the destination, not another room.
 */
function carveStepwell() {
    for (let dy = -PLAZA_HALF; dy <= PLAZA_HALF; dy++) {
        for (let dx = -PLAZA_HALF; dx <= PLAZA_HALF; dx++) {
            const x = PLAZA_CX + dx, y = PLAZA_CY + dy;
            if (x < 0 || y < 0 || x >= TOTAL_CELLS || y >= TOTAL_CELLS) continue;
            mapData[0][y][x] = {
                type: 'stepwell',
                ring: Math.max(Math.abs(dx), Math.abs(dy))
            };
        }
    }
}

// Does a rect overlap the reserved plaza (plus a 1-cell lip)? Used by
// layOutCity to skip lattice cells that would build over the well.
function overlapsPlaza(x, y, w, h) {
    const pad = 1;
    return x <= PLAZA_CX + PLAZA_HALF + pad && x + w - 1 >= PLAZA_CX - PLAZA_HALF - pad &&
           y <= PLAZA_CY + PLAZA_HALF + pad && y + h - 1 >= PLAZA_CY - PLAZA_HALF - pad;
}

/**
 * THE CITY GRID (2026-09-05, GCE_HUNT_PASS_PLAN.md §2)
 *
 * Replaces generateBuildingsInBlock(), which placed 4-7 buildings per
 * superblock by rejection sampling -- roll a random rect, reject it if it
 * overlapped anything already down (plus a 3-cell pad), give up after 50
 * attempts. That produced gaps of anywhere from 3 cells to half a block, at
 * random, which is fine when a dash is a speed boost and fatal when a dash is
 * supposed to be a RELIABLE way to cross to the next roof. You cannot build a
 * traversal verb on a layout that only sometimes affords it.
 *
 * So the packing is now constructive rather than rejective: roll a set of
 * column widths across x and a set of row depths down y, each separated by an
 * alley of 3 or 4, and put a building on every intersection.
 *
 * IT HAS TO BE A LATTICE -- shared rows, not per-column rows.
 *
 * The first version of this rolled each column's row depths independently, on
 * the theory that ragged columns would look less like graph paper. Measured, it
 * broke the rule it was written to enforce: where one column's alley lined up
 * with a neighbouring column's building, a straight run across the map passed
 * through alley + whole column + alley -- 16 cells at stage 1, 25 at stage 2,
 * against a dash that reaches 10. Every building still HAD a neighbour 3-4
 * away, so the rule held by the letter, and the map was still full of gaps you
 * would launch into and die in. Shared row bands make every adjacent pair of
 * footprints 3-4 apart along BOTH axes, which is what the rule was for.
 *
 * Variety comes from the three things that do not touch the gaps: column widths
 * (6-10), row depths (6-10) and building heights (2-5). The alleys that result
 * are the street grid, and a lattice is what a city looks like from above
 * anyway.
 *
 * MP.random() throughout, as before: every racer must run the SAME city.
 * Cosmetic randomness (robot patrol jitter, collectible hover phase) stays on
 * Math.random -- it never has to agree between clients, and routing it through
 * the shared stream would make the layout depend on how many decorations
 * happened to be drawn.
 */
function layOutCity() {
    // 2026-09-06: the lattice is now bounded by the ARENA rather than the map,
    // and only buildingsForStage(currentStage) of its lots are actually built.
    // Stage 1 and 2 build none at all -- flat ground, which is what makes the
    // first level a tutorial instead of a city.
    const h = arenaHalf(currentStage);
    // +3, not +2: that leaves a TWO-cell lane between the boundary wall and the
    // first lot. At +2 it was one cell, and a one-cell corridor with a 12px
    // player radius in a 40px cell is passable but reads as a mistake.
    const start = PLAZA_CX - h + 3;
    const limit = PLAZA_CX + h - 2;

    // A run of [start, size] bands, separated by a 3-4 cell alley. Used for
    // both axes, so the two can never drift apart.
    const bands = () => {
        const out = [];
        let p = start;
        while (limit - p >= LOT_MIN) {
            let size = LOT_MIN + Math.floor(MP.random() * (LOT_MAX - LOT_MIN + 1));
            if (size > limit - p) size = limit - p;
            out.push({ at: p, size: size });
            p += size + ALLEY_MIN + Math.floor(MP.random() * (ALLEY_MAX - ALLEY_MIN + 1));
        }
        return out;
    };

    const cols = bands();
    const rows = bands();

    // Which lots are buildable, indexed by their LATTICE POSITION rather than
    // flattened -- the growth below needs to know what is next to what.
    const key = (ci, ri) => ci + ',' + ri;
    const buildable = {};
    const all = [];
    for (let ci = 0; ci < cols.length; ci++) {
        for (let ri = 0; ri < rows.length; ri++) {
            if (overlapsPlaza(cols[ci].at, rows[ri].at, cols[ci].size, rows[ri].size)) continue;
            buildable[key(ci, ri)] = true;
            all.push({ ci: ci, ri: ri });
        }
    }
    if (!all.length) return;

    /**
     * THE CHOSEN LOTS MUST BE CONTIGUOUS, and this was measured rather than
     * assumed.
     *
     * The first version of the level curve took the first N of a shuffled lot
     * list. The lattice guarantees 3-4 cells between ADJACENT lots -- but when
     * only 2 of 16 lots are built, the two that happen to be chosen are not
     * adjacent, and the measured gap between them ran to 39 cells against a
     * dash that reaches 10. The alley rule held for the lattice and meant
     * nothing for the city actually built from it.
     *
     * So the set is GROWN instead of sampled: start at one seeded lot and keep
     * adding a lot orthogonally next to the ones already chosen. Every building
     * after the first therefore has a neighbour 3-4 cells away by construction,
     * which is the same guarantee the full lattice had, at any building count.
     */
    const want = Math.min(buildingsForStage(currentStage), all.length);
    // Stages 1 and 2 want ZERO buildings, and the seed has to be picked AFTER
    // that test -- seeding first and then checking the count built one building
    // on the flat tutorial levels, which is the one thing they must not have.
    if (want <= 0) return;

    const seed = all[Math.floor(MP.random() * all.length)];
    const chosen = [seed];
    const taken = {};
    taken[key(seed.ci, seed.ri)] = true;
    while (chosen.length < want) {
        // Every lot adjacent to the current cluster and not yet in it.
        const frontier = [];
        for (const c of chosen) {
            const nbrs = [[c.ci - 1, c.ri], [c.ci + 1, c.ri], [c.ci, c.ri - 1], [c.ci, c.ri + 1]];
            for (const [nc, nr] of nbrs) {
                const k = key(nc, nr);
                if (buildable[k] && !taken[k]) frontier.push({ ci: nc, ri: nr, k: k });
            }
        }
        if (!frontier.length) break;          // cluster is walled in by the plaza
        const pick = frontier[Math.floor(MP.random() * frontier.length)];
        taken[pick.k] = true;
        chosen.push(pick);
    }

    for (let i = 0; i < chosen.length; i++) {
        const c = chosen[i];
        // Stage 3's first building is deliberately short (the spec says "a few
        // levels"); later stages get the full 2-5 range.
        const height = currentStage <= 3 ? 3 : Math.floor(MP.random() * 4) + 2;
        buildGlassCube(cols[c.ci].at, rows[c.ri].at, cols[c.ci].size, rows[c.ri].size, height);
    }
}

function buildGlassCube(x, y, w, h, height) {
    let doorWall = Math.floor(MP.random() * 4);
    let midW = Math.floor(w/2);
    let midH = Math.floor(h/2);
    let doors = [];
    if (doorWall === 0) doors.push({dx: midW, dy: 0}, {dx: midW+1, dy: 0});
    else if (doorWall === 1) doors.push({dx: w-1, dy: midH}, {dx: w-1, dy: midH+1});
    else if (doorWall === 2) doors.push({dx: midW, dy: h-1}, {dx: midW+1, dy: h-1});
    else if (doorWall === 3) doors.push({dx: 0, dy: midH}, {dx: 0, dy: midH+1});

    let prevUpStair = null;

    for (let z = 0; z < height; z++) {
        for (let dy = 0; dy < h; dy++) {
            for (let dx = 0; dx < w; dx++) {
                let isWall = (dx === 0 || dy === 0 || dx === w - 1 || dy === h - 1);
                
                let isDoor = false;
                if (z === 0) {
                    for (let d of doors) {
                        if (d.dx === dx && d.dy === dy) isDoor = true;
                    }
                }

                if (isWall && !isDoor) {
                    // `broken` is per TILE, not per face: once you burst
                    // through a pane the whole cell reads as shattered, which
                    // is both cheaper and the right read -- you do not put half
                    // a hole in a curtain wall.
                    mapData[z][y + dy][x + dx] = { type: 'wall', broken: false };
                } else {
                    mapData[z][y + dy][x + dx] = { type: 'floor' }; 
                }
            }
        }
        
        if (z > 0 && prevUpStair) {
            mapData[z][prevUpStair.y][prevUpStair.x] = { type: 'stair_down' };
        }
        
        if (z < height - 1) {
            let upX, upY;
            let attempts = 0;
            do {
                upX = x + 2 + Math.floor(MP.random() * (w - 4));
                upY = y + 2 + Math.floor(MP.random() * (h - 4));
                attempts++;
            } while (z > 0 && prevUpStair && upX === prevUpStair.x && upY === prevUpStair.y && attempts < 20);
            
            mapData[z][upY][upX] = { type: 'stair_up' };
            prevUpStair = { x: upX, y: upY };
        }
    }
    
    // Drones are NO LONGER spawned per building (2026-09-06). The level curve
    // sets an exact total -- 1, then 3, then 3 per stage - see dronesForStage()
    // -- and a per-building spawn cannot hit an exact total when the number of
    // buildings is itself a function of the stage. spawnDrones() owns it now.
}

/**
 * VISION IS REBALANCED FOR THE SMALLER MAP -- a judgement call, not a request
 * (GCE_HUNT_PASS_PLAN.md §5).
 *
 * 250 + stage*15 was tuned against a 7,200 px map, where it covered 3.5% of
 * the width. On the 2,320 px map it is 11%, and at 3x the robot density that
 * leaves no tile outside somebody's cone -- a death march rather than a game.
 * 210 + stage*8 keeps the city dangerous while leaving gaps to move through.
 *
 * The reason it can be this generous at all is that being seen is now
 * survivable: LASER_LOCK_MS of warning before the first shot, a bolt slower
 * than a walk, and HUNT_FORGET_MS of broken sight to escape.
 */
function applyStageDifficulty(r) {
    r.patrolSpeed = 0.5 + (currentStage * 0.15);
    // 2026-09-06: was 3.5 + stage*0.3. At stage 1 a hunter now closes at 3.25
    // px/frame against the player's 6.0 walk instead of 3.8 -- about 14% less
    // pressure, which is what "slightly" buys. Vision and patrol are untouched.
    r.chaseSpeed = 3.0 + (currentStage * 0.25);
    r.visionRange = 210 + (currentStage * 8);
}

/**
 * Blue Lancers are the only drones that shoot (§3). Assigned off the SEEDED
 * stream, so every racer faces the same mix in the same places -- the kind is
 * part of the layout, not a client-local roll like patrol jitter.
 */
function assignDroneKind(r) {
    const roll = MP.random();
    // The STALKER arrives at STALKER_FROM_STAGE and takes its share out of the
    // melee population, so the Lancer fraction is unchanged by its arrival --
    // a new kind should not quietly halve the number of things that shoot.
    if (roll < LANCER_SHARE) r.kind = 'lancer';
    else if (currentStage >= STALKER_FROM_STAGE && roll < LANCER_SHARE + STALKER_SHARE) r.kind = 'stalker';
    else r.kind = 'melee';

    /**
     * ORDERING HAZARD, stated because it is easy to get wrong: this runs AFTER
     * applyStageDifficulty() at both spawn sites, and the 1.25x multiplies the
     * already-stage-scaled chaseSpeed. Call them the other way round and the
     * multiplier is silently overwritten.
     *
     * forgetMs is per-drone because HUNT_FORGET_MS is now only the DEFAULT.
     */
    r.forgetMs = HUNT_FORGET_MS;
    if (r.kind === 'stalker') {
        r.forgetMs = HUNT_FORGET_MS * STALKER_FORGET_MULT;
        r.chaseSpeed *= STALKER_SPEED_MULT;
    }
    return r;
}

/**
 * ===================================================
 *   CORES, PEDESTALS, BLIPS, DRONES  (2026-09-06)
 * ===================================================
 * GCE_RASTER_PASS_PLAN.md §1/§2. The loop changed from "walk over N cubes" to
 * "carry N cores, one at a time, to N pedestals ringing the well".
 *
 * Placement rules, and each one is doing a job:
 *   pedestals  ring the plaza lip, evenly spaced -- the well becomes the hub
 *              you keep returning to under pressure, instead of a place you
 *              visit once at the end
 *   cores      out in the arena, biased into buildings when there are any;
 *              never inside the plaza, or the round trip would be no trip
 *   blips      anywhere walkable, including the plaza -- they are the reward
 *              for going where the objective is not
 *   drones     an exact count from the level curve, never per-building
 *
 * All on MP.random(): the layout is the one thing every racer must share.
 */

// Every walkable cell inside the arena, split by whether it is inside a
// building. Walked once per stage rather than sampled -- see the 2026-09-05
// note that removed an unbounded retry loop for exactly this reason.
function arenaCandidates(includePlaza) {
    const h = arenaHalf(currentStage);
    const lo = PLAZA_CX - h + 1, hi = PLAZA_CX + h - 1;
    const interior = [], street = [];
    for (let z = 0; z < MAX_Z - 1; z++) {
        if (!mapData[z]) continue;
        for (let y = lo; y <= hi; y++) {
            for (let x = lo; x <= hi; x++) {
                const t = mapData[z][y] && mapData[z][y][x];
                if (!t) continue;
                if (t.type === 'floor') interior.push({ x: x, y: y, z: z });
                else if (t.type === 'exterior') street.push({ x: x, y: y, z: z });
                else if (includePlaza && t.type === 'stepwell') street.push({ x: x, y: y, z: z });
            }
        }
    }
    return { interior: interior, street: street };
}

function cellToWorld(c) {
    return { x: c.x * CELL_SIZE + CELL_SIZE / 2, y: c.y * CELL_SIZE + CELL_SIZE / 2, z: c.z };
}

/**
 * Pedestals ring the plaza lip. Evenly spaced by angle rather than dropped at
 * random, because they are the thing the player navigates BACK to -- a ring you
 * can predict is a landmark, a scatter is a search.
 */
function spawnPedestals() {
    pedestals = [];
    coresDeposited = 0;
    const n = coresForStage(currentStage);
    const r = PLAZA_HALF;                     // on the outermost terrace
    for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2 - Math.PI / 2;
        let cx = PLAZA_CX + Math.round(Math.cos(a) * r);
        let cy = PLAZA_CY + Math.round(Math.sin(a) * r);
        cx = Math.max(0, Math.min(TOTAL_CELLS - 1, cx));
        cy = Math.max(0, Math.min(TOTAL_CELLS - 1, cy));
        pedestals.push({
            cx: cx, cy: cy,
            x: cx * CELL_SIZE + CELL_SIZE / 2,
            y: cy * CELL_SIZE + CELL_SIZE / 2,
            filled: false
        });
    }
}

function spawnCores() {
    collectibles = [];
    collectedCount = 0;
    totalCollectibles = coresForStage(currentStage);
    escapeTunnelOpen = false;
    exitOpenedAt = 0;

    const pool = arenaCandidates(false);
    if (!pool.interior.length && !pool.street.length) { updateCollectUI(); return; }

    for (let i = 0; i < totalCollectibles; i++) {
        // From stage 3 the spec wants at least one core UP on a building, so
        // the first pick prefers an upper floor outright rather than trusting
        // the bias to get there.
        let list;
        if (i === 0 && pool.interior.length) {
            const upper = pool.interior.filter(function (c) { return c.z > 0; });
            list = upper.length ? upper : pool.interior;
        } else if (pool.interior.length && MP.random() < CORE_INTERIOR_BIAS) {
            list = pool.interior;
        } else {
            list = pool.street.length ? pool.street : pool.interior;
        }
        const c = cellToWorld(list[Math.floor(MP.random() * list.length)]);
        collectibles.push({
            x: c.x, y: c.y, z: c.z,
            collected: false, carried: false, delivered: false,
            spin: Math.random() * Math.PI * 2
        });
    }
    updateCollectUI();
}

function spawnBlips() {
    blips = [];
    const pool = arenaCandidates(true);
    const all = pool.interior.concat(pool.street);
    if (!all.length) return;
    const n = blipsForStage(currentStage);
    for (let i = 0; i < n; i++) {
        const c = cellToWorld(all[Math.floor(MP.random() * all.length)]);
        blips.push({ x: c.x, y: c.y, z: c.z, collected: false,
                     phase: Math.random() * Math.PI * 2 });
    }
}

/**
 * An EXACT drone count from the level curve. The old per-building spawn could
 * not hit an exact total once the number of buildings became a function of the
 * stage, and "1 drone on level 1" is the whole point of level 1.
 *
 * Roofs get their share only once buildings exist, and the spawn-safe ring
 * around the player's start is kept -- being attacked before the first keypress
 * is not a difficulty curve.
 */
function spawnDrones() {
    const want = dronesForStage(currentStage);
    const pool = arenaCandidates(false);
    const spawn = spawnPoint();
    const SAFE_RADIUS = 380;

    const ok = function (c) {
        const w = cellToWorld(c);
        return Math.hypot(w.x - spawn.x, w.y - spawn.y) >= SAFE_RADIUS;
    };
    const street = pool.street.filter(ok);
    const upper = pool.interior.filter(function (c) { return c.z > 0; }).filter(ok);

    let placed = 0, attempts = 0;
    while (placed < want && attempts < want * 40) {
        attempts++;
        // Roughly a third on the roofs when there are roofs to be on.
        const useUpper = upper.length && MP.random() < 0.34;
        const list = useUpper ? upper : (street.length ? street : upper);
        if (!list || !list.length) break;
        const w = cellToWorld(list[Math.floor(MP.random() * list.length)]);
        const r = new Robot(w.x, w.y, w.z);
        applyStageDifficulty(r);
        assignDroneKind(r);
        entities.push(r);
        placed++;
    }
}

// Kept as the single call site the three world builders share, so initGame,
// triggerNextStage and the seed rebuild cannot drift apart -- which is exactly
// what happened before spawnGroundRobots() was factored out in 2026-09-05.
function spawnLevelContents() {
    spawnPedestals();
    spawnCores();
    spawnBlips();
    spawnDrones();
}


/**
 * ===================================================
 *   THE PURSUIT FIELD — one BFS, not fifty paths
 * ===================================================
 * GCE_HUNT_PASS_PLAN.md §4. "Bots continue to pursue the player via the stair
 * path after the player dashes across to another building" needs real routing:
 * out of a room, down a stairwell, through the ground-floor door, across the
 * alley, up the neighbour's stairs. Per-robot A* with ~55 hunters is the wrong
 * shape for that -- fifty searches for one destination.
 *
 * So it is inverted: ONE breadth-first flood outward from the player's tile,
 * across all six floors at once, stored as a flat distance array. A hunting
 * robot then does no searching at all -- it reads the four neighbours of its
 * own cell plus whatever stair it is standing on, and steps to the lowest
 * number. Correct routing for every robot on the map for the cost of one
 * flood, five times a second.
 *
 * The vertical links work because buildGlassCube() writes the matching
 * stair_down at exactly prevUpStair -- so a stair_up at (z, x, y) always has
 * its partner at (z+1, x, y), and the flood can step between floors without
 * any separate stairwell index.
 */
let pursuitField = null;            // Int32Array, -1 = unreached
let pursuitQueue = null;            // reused ring buffer; allocation-free per rebuild
let pursuitAge = 999;               // frames since the last rebuild
let pursuitAnchor = -1;             // index the current field was flooded from

function pursuitIndex(z, x, y) {
    return (z * TOTAL_CELLS + y) * TOTAL_CELLS + x;
}

/**
 * Where a robot may stand. Deliberately the same rule as
 * Robot.checkWallCollision(), which is the thing that would otherwise contradict
 * it: walls are solid everywhere, and above ground level the void and any stray
 * exterior tile are off-limits. A field that routed robots somewhere they
 * cannot walk would jam them against the geometry instead of moving them.
 */
function botWalkable(z, x, y) {
    if (x < 0 || y < 0 || x >= TOTAL_CELLS || y >= TOTAL_CELLS) return false;
    if (z < 0 || z >= MAX_Z) return false;
    const row = mapData[z] && mapData[z][y];
    const t = row && row[x];
    if (!t) return false;
    // A hole the player smashed is a route the drones get to use. That is the
    // balance side of the ask: breaking a wall to escape also opens a way in.
    if (solidWall(t)) return false;
    if (z > 0 && t.type === 'exterior') return false;
    return true;
}

function rebuildPursuitField() {
    const sx = Math.floor(player.x / CELL_SIZE);
    const sy = Math.floor(player.y / CELL_SIZE);
    const sz = player.z;

    // Checked BEFORE the array is cleared. The player is regularly somewhere no
    // robot can stand -- mid-dash over an alley is the whole point of the dash --
    // and wiping the field on those frames would drop every hunter back to
    // straight-line steering exactly when the routing matters most. Keeping the
    // last field means they converge on where you launched from, which is both
    // cheaper and better behaviour.
    if (!botWalkable(sz, sx, sy)) {
        pursuitAge = 0;
        return;
    }

    const size = MAX_Z * TOTAL_CELLS * TOTAL_CELLS;
    if (!pursuitField || pursuitField.length !== size) {
        pursuitField = new Int32Array(size);
        pursuitQueue = new Int32Array(size);
    }
    pursuitField.fill(-1);

    const start = pursuitIndex(sz, sx, sy);
    pursuitField[start] = 0;
    pursuitQueue[0] = start;
    let head = 0, tail = 1;

    const PLANE = TOTAL_CELLS * TOTAL_CELLS;

    while (head < tail) {
        const cur = pursuitQueue[head++];
        const d = pursuitField[cur];

        const z = Math.floor(cur / PLANE);
        const rem = cur - z * PLANE;
        const y = Math.floor(rem / TOTAL_CELLS);
        const x = rem - y * TOTAL_CELLS;

        // Four-way on this floor.
        if (x > 0 && pursuitField[cur - 1] === -1 && botWalkable(z, x - 1, y)) {
            pursuitField[cur - 1] = d + 1; pursuitQueue[tail++] = cur - 1;
        }
        if (x < TOTAL_CELLS - 1 && pursuitField[cur + 1] === -1 && botWalkable(z, x + 1, y)) {
            pursuitField[cur + 1] = d + 1; pursuitQueue[tail++] = cur + 1;
        }
        if (y > 0 && pursuitField[cur - TOTAL_CELLS] === -1 && botWalkable(z, x, y - 1)) {
            pursuitField[cur - TOTAL_CELLS] = d + 1; pursuitQueue[tail++] = cur - TOTAL_CELLS;
        }
        if (y < TOTAL_CELLS - 1 && pursuitField[cur + TOTAL_CELLS] === -1 && botWalkable(z, x, y + 1)) {
            pursuitField[cur + TOTAL_CELLS] = d + 1; pursuitQueue[tail++] = cur + TOTAL_CELLS;
        }

        // Vertical, through the stair the cell IS. Costed at 3 rather than 1 so
        // the flood prefers a route on one floor where one exists -- otherwise
        // a robot two rooms away would dive down a stairwell and come back up
        // because the raw step count happened to tie.
        //
        // A NON-UNIFORM COST IN A PLAIN FIFO QUEUE IS NOT SHORTEST-PATH, and it
        // does not need to be. The only property pursuitStep() relies on is that
        // every reached cell has a neighbour with a STRICTLY smaller value --
        // which holds by construction, because each cell is written as
        // parent + cost with cost > 0, and its parent is a neighbour. Steepest
        // descent therefore strictly decreases every step and always terminates
        // at the player. Some routes come out a little longer than optimal;
        // robots taking a slightly scenic path to you is not a defect, and the
        // alternative is a priority queue rebuilt five times a second.
        const tile = mapData[z][y][x];
        if (tile.type === 'stair_up' && botWalkable(z + 1, x, y)) {
            const up = cur + PLANE;
            if (pursuitField[up] === -1) { pursuitField[up] = d + 3; pursuitQueue[tail++] = up; }
        } else if (tile.type === 'stair_down' && botWalkable(z - 1, x, y)) {
            const dn = cur - PLANE;
            if (pursuitField[dn] === -1) { pursuitField[dn] = d + 3; pursuitQueue[tail++] = dn; }
        }
    }

    pursuitAge = 0;
    pursuitAnchor = start;
}

/**
 * Called once per frame from gameLoop(). Floods only when somebody is actually
 * hunting -- on a quiet map this costs one pass over the entity list and
 * nothing else.
 *
 * The player-moved-tile test is what keeps pursuit tight without flooding every
 * frame: standing still needs no rebuild at all, and a player crossing tiles at
 * a walk triggers at most a handful per second.
 */
function updatePursuitField() {
    pursuitAge++;

    let anyHunting = false;
    for (let i = 0; i < entities.length; i++) {
        if (entities[i].state === 'hunt') { anyHunting = true; break; }
    }
    if (!anyHunting) return;

    const cur = pursuitIndex(player.z, Math.floor(player.x / CELL_SIZE), Math.floor(player.y / CELL_SIZE));
    if (cur !== pursuitAnchor || pursuitAge >= PURSUIT_REBUILD_FRAMES) {
        rebuildPursuitField();
    }
}

/**
 * The direction a robot at (z, px, py) should move to close on the player, or
 * null when it is not on the field at all (unreachable, or the field predates
 * the stage it is standing in). Callers fall back to steering straight at the
 * player, which is right for the common case of "same room, clear line".
 */
function pursuitStep(z, px, py) {
    if (!pursuitField) return null;
    const x = Math.floor(px / CELL_SIZE);
    const y = Math.floor(py / CELL_SIZE);
    if (x < 0 || y < 0 || x >= TOTAL_CELLS || y >= TOTAL_CELLS) return null;

    const here = pursuitField[pursuitIndex(z, x, y)];
    if (here < 0) return null;
    if (here === 0) return null;                 // standing on the player's tile

    let best = here;
    let bx = x, by = y, bz = z;

    const consider = (nz, nx, ny) => {
        if (!botWalkable(nz, nx, ny)) return;
        const d = pursuitField[pursuitIndex(nz, nx, ny)];
        if (d >= 0 && d < best) { best = d; bx = nx; by = ny; bz = nz; }
    };

    consider(z, x - 1, y);
    consider(z, x + 1, y);
    consider(z, x, y - 1);
    consider(z, x, y + 1);

    const tile = mapData[z] && mapData[z][y] && mapData[z][y][x];
    if (tile && tile.type === 'stair_up') consider(z + 1, x, y);
    else if (tile && tile.type === 'stair_down') consider(z - 1, x, y);

    if (best === here) return null;              // local minimum, nothing better
    return {
        // Aim at the CENTRE of the target cell. Aiming at its edge is what makes
        // a flow-field follower graze corners and stick on them.
        x: bx * CELL_SIZE + CELL_SIZE / 2,
        y: by * CELL_SIZE + CELL_SIZE / 2,
        z: bz,
        changesFloor: bz !== z
    };
}

/**
 * The trapdoor. Called when the LAST pedestal is filled, not when the last core
 * is picked up -- carrying a core is no longer the same thing as delivering it.
 */
function openEscapeTunnel() {
    escapeTunnelOpen = true;
    exitOpenedAt = performance.now();
    gcExitOpenSound();

    // The floor of the stepwell. carveStepwell() has already made this tile
    // `stepwell` with ring 0; overwriting it loses nothing, because ring 0 is
    // the single centre tile and it is about to be drawn as the tunnel anyway.
    let cx = PLAZA_CX;
    let cy = PLAZA_CY;

    mapData[0][cy][cx] = { type: 'escape_tunnel' };
    escapeTunnelPos = { x: cx, y: cy };

    // NO DIALOGUE BOX (2026-09-07). This used to raise a centred modal and hide
    // it on a raw setTimeout. Two things were wrong with that: a centred HTML
    // panel over a running game reads as a web page rather than a cabinet, and
    // it was a MODAL for information the player needs for the rest of the level
    // rather than for four seconds.
    //
    // drawWellIndicator() in gc-render.js shows "(WELL OPEN)" with an arrow
    // pointing at the well, for as long as it is open. It also removes the last
    // raw setTimeout on the level path.
}

/**
 * Banks the level's points and rebuilds the world one stage deeper.
 *
 * SURVIVING HEARTS ARE PAID HERE and nowhere else, which is the whole point of
 * paying them at all: they only count if you actually reached the exit, so
 * running a level out at 1 HP is worth measurably less than clearing it
 * carefully. "Score = stage reached" could not express that.
 */
/**
 * ROBOTRON 2084 WAVE TRANSITION (2026-09-06).
 *
 * There is no message box, no timer and no pause any more. Robotron's wave
 * change is the whole idiom: you clear a wave and you are ALREADY playing the
 * next one, roughly a second later, with a colour-cycled rectangle burst over
 * the top and no input asked for. The arcade reason is the arcade reason --
 * a cabinet that stops to talk to you loses the quarter.
 *
 * So the rebuild is SYNCHRONOUS. Everything the old setTimeout body did now
 * happens on this frame, and the burst is drawn over the new level rather than
 * over a frozen picture of the old one -- see drawWaveTransition() in
 * gc-render.js. The player is live for all of it; only the drones are held.
 */
function triggerNextStage() {
    // The re-entry latch still matters, but for a much shorter window: the
    // rebuild below is synchronous, so the only thing it guards is a second
    // call arriving inside it. It is cleared before this function returns.
    if (stageAdvancing) return;
    stageAdvancing = true;

    const bonus = PTS_LEVEL + player.health * PTS_PER_HEART;
    addPoints(bonus);
    gcLevelClearSound();
    gcWaveSweepSound();
    // Recorded BEFORE the increment, so the run log counts a stage that was
    // actually finished rather than the one just entered.
    gcTelemetryEvent('stage');
    currentStage++;
    document.getElementById('stage-counter').innerText = 'STAGE: ' + currentStage;

    entities = [];
    // The old stage's bolts and pursuit flood do not survive into a new
    // city: the field indexes tiles that have just been rewritten, and a
    // bolt in flight would arrive in a building that no longer exists.
    gcLasers.length = 0;
    gcShards.length = 0;
    pursuitField = null;
    pursuitAnchor = -1;
    minimapCache = null;
    generateWorld();
    spawnLevelContents();

    const sp = spawnPoint();
    player.x = sp.x;
    player.y = sp.y;
    player.z = 0;
    player.isFalling = false;
    player.scale = 1.0;
    player.carrying = 0;
    player.health = player.maxHealth;
    // Held keys would otherwise carry a direction across the transition and
    // walk the new spawn straight into whatever is next to it.
    keys = {};

    updateHealthUI();
    updateFloorUI(0);
    updateCollectUI();
    raceStartTime = performance.now();

    // Arms the burst. The bonus rides along so it can be shown ON THE CANVAS
    // for a moment instead of in a modal nobody asked to read.
    waveTransitionAt = performance.now();
    waveBonus = bonus;

    stageAdvancing = false;
}


