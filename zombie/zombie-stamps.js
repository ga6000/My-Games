/* ===================================================================
   ZOMBIE — HAND-AUTHORED STAMPS
   ===================================================================
   A stamp is a building (or a block of them) DRAWN AS TEXT on a 20px
   grid, instead of a rect the generator rolls and then pokes holes in.

   WHY. The 2026-09-20 audit (zombie/MAP_VISUAL_AUDIT.md) found the random
   placer shipping 95% of its buildings with an open corner, a quarter of
   the furniture standing on walls, and five sectors getting no building at
   all -- and none of it visible, because placement skips silently on a
   clash. A shape someone designed should be drawn, not rolled.

   THE CELL IS 20px, which is WALL_T and NAV_CELL. One character is one
   wall thickness and one nav cell, so nothing is rounded between what you
   draw and what the flow field sees. A 4-cell door is 80px, over the 78px
   nav guarantee (2*NAV_CELL + 2*NAV_PAD).

   THE FORMAT. Header lines `key: value`, then the grid. Everything is
   optional except the grid.

       name: cold-store-a
       sector: cold          one or more sector keys, or `any`
       kind: store           store | office | workshop -- the decor style
       rotate: any           any | none
       weight: 1             how often it is picked

       ################
       #s......#.....W#
       ...

   THE LEGEND is ZS.LEGEND below. Briefly: `#` wall, `D` door opening,
   `W` window (a barricade: zombies chew through, players never pass),
   `.` floor, a space is outside the stamp, `s d b r c` are stairs, desk,
   bench, rack, chair, and `$ P ?` mark wall-buy / perk / loot slots.

   NOTHING HERE CALLS MP.random(). Which stamp goes where is the caller's
   roll; a stamp itself is the same on every client by construction.

   Data lives in zombie-stamps-data.js, which is the file you paste new
   stamps into. The editor is zombie/stamp-builder.html.
   =================================================================== */
"use strict";

const STAMP_CELL = 20;                 // = WALL_T = NAV_CELL, deliberately

const ZS = (function () {

    const LEGEND = {
        "#": { what: "wall",   solid: true },
        "D": { what: "door",   opening: true },
        "W": { what: "window", opening: true, barricade: true },
        ".": { what: "floor",  floor: true },
        "s": { what: "stairs", floor: true, decor: "stairs" },
        "d": { what: "desk",   floor: true, decor: "desk" },
        "b": { what: "bench",  floor: true, decor: "bench" },
        "r": { what: "rack",   floor: true, decor: "rack" },
        "c": { what: "chair",  floor: true, decor: "chair" },
        "$": { what: "wall-buy slot", floor: true, slot: "wallbuy" },
        "P": { what: "perk slot",     floor: true, slot: "perk" },
        "?": { what: "loot slot",     floor: true, slot: "loot" },
        " ": { what: "outside" }
    };

    // Minimum opening widths, in CELLS. A door must clear the nav
    // guarantee; a window is a barricade, which only zombies use, and
    // matches the 44px the generator has always used.
    const DOOR_MIN = 4;
    const WINDOW_MIN = 2;

    function isFloor(ch) { return !!(LEGEND[ch] && LEGEND[ch].floor); }
    function isSolid(ch) { return ch === "#" || ch === "W"; }
    function isOpening(ch) { return ch === "D" || ch === "W"; }
    function isOutside(ch) { return ch === " " || ch === undefined; }

    // --- PARSE ------------------------------------------------------
    function parse(text) {
        const stamp = { name: "", sector: ["any"], kind: "office",
                        rotate: "any", weight: 1, rows: [], w: 0, h: 0 };
        const lines = String(text).replace(/\r/g, "").split("\n");
        let inGrid = false;
        const rows = [];
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            if (!inGrid) {
                if (/^\s*$/.test(line)) continue;
                const m = /^\s*([A-Za-z_]+)\s*:\s*(.*)$/.exec(line);
                // A header key is only a header until the grid starts --
                // after that a line is grid, whatever is in it.
                if (m && !/^[#.DWsdbrc$P?\s]+$/.test(line.replace(/^\s*[A-Za-z_]+\s*:/, ""))) {
                    applyHeader(stamp, m[1].toLowerCase(), m[2].trim());
                    continue;
                }
                if (m && /^(name|sector|kind|rotate|weight)$/i.test(m[1])) {
                    applyHeader(stamp, m[1].toLowerCase(), m[2].trim());
                    continue;
                }
                inGrid = true;
            }
            rows.push(line);
        }
        // Trim blank lines top and bottom, but never the leading spaces
        // inside a row -- a space is a cell, not indentation.
        while (rows.length && /^\s*$/.test(rows[0])) rows.shift();
        while (rows.length && /^\s*$/.test(rows[rows.length - 1])) rows.pop();

        let w = 0;
        for (let i = 0; i < rows.length; i++) w = Math.max(w, rows[i].length);
        for (let i = 0; i < rows.length; i++) {
            const r = rows[i].split("");
            while (r.length < w) r.push(" ");
            stamp.rows.push(r);
        }
        stamp.w = w;
        stamp.h = stamp.rows.length;
        return stamp;
    }

    function applyHeader(stamp, key, value) {
        if (key === "name") stamp.name = value;
        else if (key === "sector") stamp.sector = value.split(/[,\s]+/).filter(Boolean);
        else if (key === "kind") stamp.kind = value || "office";
        else if (key === "rotate") stamp.rotate = value || "any";
        else if (key === "weight") stamp.weight = Math.max(0, parseFloat(value) || 1);
    }

    function toText(stamp) {
        const head = "name: " + (stamp.name || "untitled") + "\n" +
                     "sector: " + (stamp.sector || ["any"]).join(", ") + "\n" +
                     "kind: " + (stamp.kind || "office") + "\n" +
                     "rotate: " + (stamp.rotate || "any") + "\n" +
                     "weight: " + (stamp.weight === undefined ? 1 : stamp.weight) + "\n\n";
        const grid = stamp.rows.map(function (r) { return r.join(""); }).join("\n");
        return head + grid + "\n";
    }

    // --- CHECKS -----------------------------------------------------
    // Everything the audit found wrong with a generated building, asked as
    // a question a grid can answer. `problems` are failures; `warnings`
    // are things worth seeing that do not make the stamp unusable.
    function check(stamp) {
        const problems = [];
        const warnings = [];
        const w = stamp.w, h = stamp.h, rows = stamp.rows;
        if (!w || !h) return { ok: false, problems: ["the stamp is empty"], warnings: warnings };

        const at = function (x, y) {
            if (x < 0 || y < 0 || x >= w || y >= h) return " ";
            return rows[y][x];
        };

        // 1. Unknown characters.
        const unknown = {};
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (!LEGEND[at(x, y)]) unknown[at(x, y)] = true;
        }
        const unknownKeys = Object.keys(unknown);
        if (unknownKeys.length) problems.push("characters that mean nothing: " + unknownKeys.join(" "));

        // 2. Flood from OUTSIDE, through anything that is not a wall, a
        //    window or a doorway. If that reaches a floor cell, the shell
        //    has a hole in it -- which is exactly the 95% open-corner
        //    defect, asked as a question.
        const outside = flood(w, h, function (x, y) {
            const ch = at(x, y);
            return !isSolid(ch) && ch !== "D";
        });
        let leaks = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (isFloor(at(x, y)) && outside[y * w + x]) leaks++;
        }
        if (leaks) {
            problems.push(leaks + " floor cell(s) open straight to the outside -- " +
                          "the shell has a gap that is not a door or a window");
        }

        // 3. Openings: every run of D at least DOOR_MIN, every run of W at
        //    least WINDOW_MIN. A GAP IS EITHER CLOSED OR WALKABLE, NEVER
        //    IN BETWEEN (the KENNEL_END_GAP rule from zombie/CLAUDE.md).
        const runs = openingRuns(stamp);
        let doors = 0;
        for (let i = 0; i < runs.length; i++) {
            const run = runs[i];
            if (run.ch === "D") {
                doors++;
                if (run.len < DOOR_MIN) {
                    problems.push("a door of " + run.len + " cell(s) at " + run.x + "," + run.y +
                                  " -- a door is at least " + DOOR_MIN + " (" + (DOOR_MIN * STAMP_CELL) + "px)");
                }
            } else if (run.len < WINDOW_MIN) {
                problems.push("a window of " + run.len + " cell at " + run.x + "," + run.y +
                              " -- a window is at least " + WINDOW_MIN);
            }
        }
        if (!doors) problems.push("no door: nothing can get in on foot");

        // 4. The inside is one place. Flood the floor from the first floor
        //    cell beside a doorway; anything it misses is a room you can
        //    only reach through a window, or not at all.
        const inside = flood(w, h, function (x, y) {
            return isFloor(at(x, y)) || at(x, y) === "D";
        }, doorSeeds(stamp));
        let stranded = 0;
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (isFloor(at(x, y)) && !inside[y * w + x]) stranded++;
        }
        if (stranded) problems.push(stranded + " floor cell(s) cannot be reached from any door");

        // 5. Furniture has to be inside. It is the 26%-on-a-wall finding.
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            const L = LEGEND[at(x, y)];
            if (L && L.decor && outside[y * w + x]) {
                warnings.push("furniture at " + x + "," + y + " is outside the walls");
            }
        }

        // 6. Size sanity.
        if (w < 5 || h < 5) warnings.push("smaller than 5x5 cells -- that is a shed, not a building");

        return { ok: problems.length === 0, problems: problems, warnings: warnings };
    }

    // Flood fill from the border (or from `seeds`), 4-connected, over
    // cells `passable` agrees with. The grid is treated as if padded by
    // one cell of outside all round, which is what makes "from outside"
    // mean anything for a stamp whose wall runs along its own edge.
    function flood(w, h, passable, seeds) {
        const seen = new Uint8Array(w * h);
        const q = [];
        if (seeds && seeds.length) {
            for (let i = 0; i < seeds.length; i++) {
                const s = seeds[i];
                if (s.x >= 0 && s.y >= 0 && s.x < w && s.y < h && passable(s.x, s.y)) {
                    seen[s.y * w + s.x] = 1;
                    q.push(s.y * w + s.x);
                }
            }
        } else {
            for (let x = 0; x < w; x++) {
                if (passable(x, 0)) { seen[x] = 1; q.push(x); }
                if (passable(x, h - 1)) { seen[(h - 1) * w + x] = 1; q.push((h - 1) * w + x); }
            }
            for (let y = 0; y < h; y++) {
                if (passable(0, y)) { seen[y * w] = 1; q.push(y * w); }
                if (passable(w - 1, y)) { seen[y * w + w - 1] = 1; q.push(y * w + w - 1); }
            }
        }
        let head = 0;
        while (head < q.length) {
            const i = q[head++];
            const x = i % w, y = (i - x) / w;
            const n = [[1, 0], [-1, 0], [0, 1], [0, -1]];
            for (let k = 0; k < 4; k++) {
                const nx = x + n[k][0], ny = y + n[k][1];
                if (nx < 0 || ny < 0 || nx >= w || ny >= h) continue;
                const j = ny * w + nx;
                if (seen[j] || !passable(nx, ny)) continue;
                seen[j] = 1;
                q.push(j);
            }
        }
        return seen;
    }

    function doorSeeds(stamp) {
        const out = [];
        for (let y = 0; y < stamp.h; y++) for (let x = 0; x < stamp.w; x++) {
            if (stamp.rows[y][x] === "D") out.push({ x: x, y: y });
        }
        return out;
    }

    // Contiguous runs of D or W, horizontal or vertical.
    function openingRuns(stamp) {
        const w = stamp.w, h = stamp.h, rows = stamp.rows;
        const seen = {};
        const out = [];
        const scan = function (x, y, dx, dy) {
            const ch = rows[y][x];
            if (!isOpening(ch)) return;
            if (seen[x + "," + y]) return;
            let len = 0, cx = x, cy = y;
            while (cx < w && cy < h && rows[cy][cx] === ch) {
                seen[cx + "," + cy] = true;
                len++; cx += dx; cy += dy;
            }
            out.push({ ch: ch, x: x, y: y, len: len, dx: dx, dy: dy });
        };
        for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
            if (!isOpening(rows[y][x])) continue;
            // Horizontal if the neighbour to the east matches, else vertical.
            const horiz = x + 1 < w && rows[y][x + 1] === rows[y][x];
            const vert = y + 1 < h && rows[y + 1][x] === rows[y][x];
            scan(x, y, horiz && !vert ? 1 : 0, horiz && !vert ? 0 : 1);
        }
        return out;
    }

    // --- TRANSFORM --------------------------------------------------
    function rotate(stamp, turns, mirror) {
        let rows = stamp.rows.map(function (r) { return r.slice(); });
        if (mirror) rows = rows.map(function (r) { return r.slice().reverse(); });
        turns = ((turns % 4) + 4) % 4;
        for (let t = 0; t < turns; t++) {
            const h = rows.length, w = rows[0].length;
            const next = [];
            for (let x = 0; x < w; x++) {
                const row = [];
                for (let y = h - 1; y >= 0; y--) row.push(rows[y][x]);
                next.push(row);
            }
            rows = next;
        }
        const out = { name: stamp.name, sector: stamp.sector, kind: stamp.kind,
                      rotate: stamp.rotate, weight: stamp.weight,
                      rows: rows, w: rows[0].length, h: rows.length };
        return out;
    }

    // --- PLACEMENT --------------------------------------------------
    // Greedy rectangle decomposition: take an unclaimed cell, run right
    // while the character matches, then down while the whole span
    // matches. A straight wall comes out as ONE rect rather than sixteen,
    // which matters -- every solid here is tested linearly by
    // clashesReserved and the nav rebuild.
    function rects(stamp, match) {
        const w = stamp.w, h = stamp.h, rows = stamp.rows;
        const used = new Uint8Array(w * h);
        const out = [];
        for (let y = 0; y < h; y++) {
            for (let x = 0; x < w; x++) {
                if (used[y * w + x] || !match(rows[y][x])) continue;
                const ch = rows[y][x];
                let ex = x;
                while (ex + 1 < w && !used[y * w + ex + 1] && rows[y][ex + 1] === ch) ex++;
                let ey = y;
                for (;;) {
                    if (ey + 1 >= h) break;
                    let ok = true;
                    for (let cx = x; cx <= ex && ok; cx++) {
                        if (used[(ey + 1) * w + cx] || rows[ey + 1][cx] !== ch) ok = false;
                    }
                    if (!ok) break;
                    ey++;
                }
                for (let cy = y; cy <= ey; cy++) for (let cx = x; cx <= ex; cx++) used[cy * w + cx] = 1;
                out.push({ ch: ch, cx: x, cy: y, cw: ex - x + 1, ch2: ey - y + 1 });
            }
        }
        return out;
    }

    function worldRect(ox, oy, r) {
        return { x: ox + r.cx * STAMP_CELL, y: oy + r.cy * STAMP_CELL,
                 w: r.cw * STAMP_CELL, h: r.ch2 * STAMP_CELL };
    }

    // Everything a stamp turns into, in world coordinates, WITHOUT
    // touching any game state. The builder renders this; the level places
    // it. One description, two consumers, so the preview cannot drift
    // from the map (the same reason barricadePlanks has one home).
    function build(stamp, ox, oy) {
        const out = { x: ox, y: oy,
                      w: stamp.w * STAMP_CELL, h: stamp.h * STAMP_CELL,
                      kind: stamp.kind || "office",
                      walls: [], windows: [], floors: [], decor: [], slots: [] };
        const solid = rects(stamp, function (ch) { return ch === "#"; });
        for (let i = 0; i < solid.length; i++) out.walls.push(worldRect(ox, oy, solid[i]));

        const win = rects(stamp, function (ch) { return ch === "W"; });
        for (let i = 0; i < win.length; i++) out.windows.push(worldRect(ox, oy, win[i]));

        // Floor: every cell that is not outside, so a doorway and the
        // ground under the furniture are floor too.
        const floor = rects(stamp, function (ch) {
            return ch !== " " && ch !== "#" && LEGEND[ch] !== undefined;
        });
        for (let i = 0; i < floor.length; i++) out.floors.push(worldRect(ox, oy, floor[i]));

        const dec = rects(stamp, function (ch) { return LEGEND[ch] && LEGEND[ch].decor; });
        for (let i = 0; i < dec.length; i++) {
            const r = worldRect(ox, oy, dec[i]);
            const type = LEGEND[dec[i].ch].decor;
            // Inset a little so a desk is furniture in a cell rather than
            // a tile of it, and stairs keep their tread direction.
            out.decor.push({ type: type, x: r.x + 3, y: r.y + 3,
                             w: Math.max(8, r.w - 6), h: Math.max(8, r.h - 6),
                             down: false });
        }

        const slotCells = rects(stamp, function (ch) { return LEGEND[ch] && LEGEND[ch].slot; });
        for (let i = 0; i < slotCells.length; i++) {
            const r = worldRect(ox, oy, slotCells[i]);
            out.slots.push({ kind: LEGEND[slotCells[i].ch].slot, x: r.x, y: r.y, w: r.w, h: r.h });
        }
        return out;
    }

    // --- LIBRARY ----------------------------------------------------
    // Filled by zombie-stamps-data.js, which is the file you paste a
    // stamp into. Parsed once, checked once, and a stamp that fails its
    // checks is REPORTED AND DROPPED rather than built into the map --
    // silent skipping is the habit this whole system exists to end.
    const LIBRARY = [];
    const REJECTED = [];

    function add(text) {
        const stamp = parse(text);
        const verdict = check(stamp);
        stamp.verdict = verdict;
        if (!verdict.ok) {
            REJECTED.push(stamp);
            if (typeof console !== "undefined") {
                console.warn("stamp '" + (stamp.name || "untitled") + "' rejected: " +
                             verdict.problems.join("; "));
            }
            return null;
        }
        LIBRARY.push(stamp);
        return stamp;
    }

    function forSector(key) {
        const out = [];
        for (let i = 0; i < LIBRARY.length; i++) {
            const s = LIBRARY[i];
            if (s.sector.indexOf("any") >= 0 || s.sector.indexOf(key) >= 0) out.push(s);
        }
        return out;
    }

    return { LEGEND: LEGEND, CELL: STAMP_CELL, DOOR_MIN: DOOR_MIN, WINDOW_MIN: WINDOW_MIN,
             parse: parse, toText: toText, check: check, rotate: rotate,
             build: build, rects: rects, add: add, forSector: forSector,
             LIBRARY: LIBRARY, REJECTED: REJECTED };
})();
