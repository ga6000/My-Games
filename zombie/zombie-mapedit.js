/* ===================================================================
   THE MAP EDITOR — hand-place buildings on the whole map
   ===================================================================
   `Zombie.html?editor=1&solo=1`

   IT TAKES OVER THE GAME PAGE rather than being a page of its own, and
   that is the whole design. The "drawn appearance" view is not a preview:
   it is `draw()`, the real renderer, over a real generated level. A
   separate editor page would need its own copy of the floors, the walls,
   the landmarks and the rolling stock, and the day those two drawings
   disagreed is the day the editor started lying.

   SPACE flips between the two views:

     PLAN     schematic -- floors, solids, sector edges, the 20px cell
              grid, and every authored placement as a box you can grab
     DRAWN    the game's own render of the same map

   Middle-drag (or space-less right-drag) pans, the wheel zooms, left click
   places the selected stamp, right click deletes the placement under the
   cursor. EXPORT prints the placements as the block to paste into
   zombie-map-data.js.

   THE MARGIN. A band outside the world is drawn in both views, because the
   perimeter is a thing you want to author against and until now it ran off
   the edge of a black screen. It is DRAWN ONLY: the world is still
   4800x2700 and a placement out there is refused. Enlarging the world is a
   real change -- ZONE_CELL_W is WORLD_W/24, so every sector shape stretches
   with it -- and it needs its own pass.
   =================================================================== */
"use strict";

const ZMAPEDIT = (function () {
    const on = new URLSearchParams(window.location.search).get("editor") === "1";
    if (!on) return { on: false };

    const MARGIN = 360;              // drawn band outside the world
    const MIN_ZOOM = 0.12, MAX_ZOOM = 2.5;

    let mode = "plan";               // plan | drawn
    let pan = { x: 0, y: 0 };        // world point at screen centre
    let zoom = 0.2;
    let stampIndex = 0;
    // What a click puts down: a building, or one of the small things.
    // Wall-buy and station spots say WHERE, not what is sold -- see
    // ZMAP.addProp.
    const TOOLS = ["stamp", "crate", "barrel", "wallbuy", "station", "tree", "culvert"];
    const TOOL_COLOR = { crate: "#8FA89C", barrel: "#C24A2A",
                         wallbuy: "#FFB000", station: "#00E5FF",
                         tree: "#4E7A3E", culvert: "#9AA6A9" };
    const TOOL_SIZE = { crate: 32, barrel: 24, wallbuy: 110, station: 60,
                        tree: 26, culvert: 120 };
    // A trunk reserves 86px around itself in the level, so two hand-planted
    // trees closer than this simply reject each other -- the brush spaces
    // them rather than letting you paint a line that half builds.
    const TREE_SPACING = 190;
    let tool = 0;
    let rot = 0, mirror = false;
    let hover = null;                // {x, y} snapped world cell
    let dragging = null;             // middle-drag pan
    let painting = false;            // left button held, for the tree brush origin
    let message = "";

    function stamp() {
        const lib = ZS.LIBRARY;
        if (!lib.length) return null;
        let s = lib[Math.max(0, Math.min(lib.length - 1, stampIndex))];
        if (rot || mirror) s = ZS.rotate(s, rot, mirror);
        return s;
    }

    // --- coordinates ------------------------------------------------
    function screenToWorld(sx, sy) {
        return { x: pan.x + (sx - canvas.width / 2) / zoom,
                 y: pan.y + (sy - canvas.height / 2) / zoom };
    }
    function snap(v) { return Math.round(v / STAMP_CELL) * STAMP_CELL; }

    function placementAt(wx, wy) {
        for (let i = ZMAP.placements.length - 1; i >= 0; i--) {
            const p = ZMAP.placements[i];
            const s = byName(p.stamp);
            if (!s) continue;
            const r = p.rot || p.mirror ? ZS.rotate(s, p.rot || 0, !!p.mirror) : s;
            const w = r.w * STAMP_CELL, h = r.h * STAMP_CELL;
            if (wx >= p.x && wx <= p.x + w && wy >= p.y && wy <= p.y + h) return i;
        }
        return -1;
    }

    function byName(name) {
        for (let i = 0; i < ZS.LIBRARY.length; i++) {
            if (ZS.LIBRARY[i].name === name) return ZS.LIBRARY[i];
        }
        return null;
    }

    // --- editing ----------------------------------------------------
    function place(wx, wy) {
        if (TOOLS[tool] === "culvert") {
            // A mouth belongs to the hard wall, so it snaps to whichever of
            // the two is nearer. The north and west edges are forest, not
            // wall, and a culvert through a tree line means nothing.
            const dEast = Math.abs(wx - (WORLD_W - WALL_T));
            const dSouth = Math.abs(wy - (WORLD_H - WALL_T));
            const p = dEast < dSouth
                ? { kind: "culvert", x: WORLD_W - WALL_T, y: snap(wy - PERIM_CULVERT / 2) }
                : { kind: "culvert", x: snap(wx - PERIM_CULVERT / 2), y: WORLD_H - WALL_T };
            ZMAP.addProp(p);
            message = "culvert on the " + (dEast < dSouth ? "east" : "south") + " wall" +
                      (ZMAP.authoredPerimeter ? "" : "  (authoredPerimeter is off -- press P)");
            rebuild();
            return;
        }
        if (TOOLS[tool] !== "stamp") {
            const kind = TOOLS[tool];
            const x = snap(wx - TOOL_SIZE[kind] / 2), y = snap(wy - 12);
            if (x < 0 || y < 0 || x > WORLD_W || y > WORLD_H) {
                message = "outside the world";
                return;
            }
            if (kind === "tree") {
                // Painted, not clicked one at a time: a tree line is fifty
                // trunks and nobody is clicking fifty times.
                for (let i = 0; i < ZMAP.props.length; i++) {
                    const q = ZMAP.props[i];
                    if (q.kind !== "tree") continue;
                    if (Math.hypot(q.x - x, q.y - y) < TREE_SPACING) return;
                }
            }
            ZMAP.addProp({ kind: kind, x: x, y: y });
            message = "placed a " + kind + " at " + x + "," + y +
                      (kind === "tree" && !ZMAP.authoredPerimeter
                          ? "  (authoredPerimeter is off -- press P)" : "");
            rebuild();
            return;
        }
        const s = stamp();
        if (!s) { message = "no stamps in the library"; return; }
        const x = snap(wx - (s.w * STAMP_CELL) / 2);
        const y = snap(wy - (s.h * STAMP_CELL) / 2);
        if (x < 0 || y < 0 || x + s.w * STAMP_CELL > WORLD_W || y + s.h * STAMP_CELL > WORLD_H) {
            message = "outside the world -- the margin is drawn, not built";
            return;
        }
        ZMAP.add({ stamp: ZS.LIBRARY[stampIndex].name, x: x, y: y, rot: rot, mirror: mirror });
        message = "placed " + ZS.LIBRARY[stampIndex].name + " at " + x + "," + y;
        rebuild();
    }

    function remove(wx, wy) {
        // Props first: they are small and sit on top of buildings.
        for (let i = ZMAP.props.length - 1; i >= 0; i--) {
            const p = ZMAP.props[i];
            const sz = TOOL_SIZE[p.kind] || 32;
            if (wx >= p.x - 8 && wx <= p.x + sz + 8 && wy >= p.y - 8 && wy <= p.y + 40) {
                message = "removed a " + p.kind;
                ZMAP.props.splice(i, 1);
                rebuild();
                return;
            }
        }
        const i = placementAt(wx, wy);
        if (i < 0) { message = "nothing there"; return; }
        message = "removed " + ZMAP.placements[i].stamp;
        ZMAP.placements.splice(i, 1);
        rebuild();
    }

    // Regenerating is how a placement becomes REAL: it goes through
    // placeAuthoredBuildings exactly as it will in a run, so what the DRAWN
    // view shows is what the game builds, including a placement that could
    // not be built at all.
    function rebuild() {
        generateLevel();
        if (ZMAP.report.missing.length) {
            message += "  |  " + ZMAP.report.missing.length + " placement(s) blocked";
        }
    }

    function exportText() {
        const lines = ZMAP.placements.map(function (p) {
            return "ZMAP.add({ stamp: \"" + p.stamp + "\", x: " + p.x + ", y: " + p.y +
                   ", rot: " + (p.rot || 0) + ", mirror: " + (p.mirror ? "true" : "false") + " });";
        });
        const props = ZMAP.props.map(function (p) {
            return "ZMAP.addProp({ kind: \"" + p.kind + "\", x: " + p.x + ", y: " + p.y + " });";
        });
        // The flags travel with the placements: paste the block and the map
        // is in the state it was on screen.
        const flags = ["ZMAP.authoredOnly = " + (ZMAP.authoredOnly ? "true" : "false") + ";",
                       "ZMAP.authoredPerimeter = " + (ZMAP.authoredPerimeter ? "true" : "false") + ";",
                       ""];
        return flags.concat(lines).concat(props.length ? [""].concat(props) : []).join("\n") + "\n";
    }

    // --- drawing ----------------------------------------------------
    function view() {
        return { x: pan.x - (canvas.width / zoom) / 2, y: pan.y - (canvas.height / zoom) / 2,
                 w: canvas.width / zoom, h: canvas.height / zoom };
    }

    function applyView() {
        ctx.setTransform(zoom, 0, 0, zoom,
                         canvas.width / 2 - pan.x * zoom,
                         canvas.height / 2 - pan.y * zoom);
    }

    function drawMargin() {
        ctx.fillStyle = "#14171a";
        ctx.fillRect(-MARGIN, -MARGIN, WORLD_W + MARGIN * 2, WORLD_H + MARGIN * 2);
        // A coarse hatch, so the band reads as ground rather than as a
        // background, without pretending to be a floor the game has.
        ctx.strokeStyle = "rgba(255,255,255,0.05)";
        ctx.lineWidth = 1 / zoom;
        for (let x = -MARGIN; x < WORLD_W + MARGIN; x += 80) {
            ctx.beginPath(); ctx.moveTo(x, -MARGIN); ctx.lineTo(x, WORLD_H + MARGIN); ctx.stroke();
        }
        for (let y = -MARGIN; y < WORLD_H + MARGIN; y += 80) {
            ctx.beginPath(); ctx.moveTo(-MARGIN, y); ctx.lineTo(WORLD_W + MARGIN, y); ctx.stroke();
        }
    }

    function drawPlan() {
        const vr = view();
        drawMargin();
        // Floors: the real ones, so sectors are recognisable in plan.
        if (typeof drawZoneFloors === "function") drawZoneFloors(vr);

        // Sector edges.
        ctx.strokeStyle = "rgba(255,176,0,0.25)";
        ctx.lineWidth = 2 / zoom;
        for (let cr = 0; cr < ZONE_ROWS_FINE; cr++) {
            for (let cc = 0; cc < ZONE_COLS_FINE; cc++) {
                const z = ZONE_PAINT[cr * ZONE_COLS_FINE + cc];
                const x = cc * ZONE_CELL_W, y = cr * ZONE_CELL_H;
                if (cc + 1 < ZONE_COLS_FINE && ZONE_PAINT[cr * ZONE_COLS_FINE + cc + 1] !== z) {
                    ctx.beginPath(); ctx.moveTo(x + ZONE_CELL_W, y);
                    ctx.lineTo(x + ZONE_CELL_W, y + ZONE_CELL_H); ctx.stroke();
                }
                if (cr + 1 < ZONE_ROWS_FINE && ZONE_PAINT[(cr + 1) * ZONE_COLS_FINE + cc] !== z) {
                    ctx.beginPath(); ctx.moveTo(x, y + ZONE_CELL_H);
                    ctx.lineTo(x + ZONE_CELL_W, y + ZONE_CELL_H); ctx.stroke();
                }
            }
        }

        // Every solid, flat. This is the schematic: what is in the way.
        ctx.fillStyle = "#7E8A8D";
        for (let i = 0; i < walls.length; i++) {
            const w = walls[i];
            if (w.x + w.w < vr.x || w.x > vr.x + vr.w || w.y + w.h < vr.y || w.y > vr.y + vr.h) continue;
            ctx.fillRect(w.x, w.y, w.w, w.h);
        }
        ctx.fillStyle = "#C98A3A";
        for (let i = 0; i < barricades.length; i++) {
            const b = barricades[i];
            ctx.fillRect(b.x, b.y, b.w, b.h);
        }
        ctx.fillStyle = "#00E5FF";
        for (let i = 0; i < doors.length; i++) {
            const d = doors[i];
            ctx.fillRect(d.x, d.y, d.w, d.h);
        }

        // The 20px cell grid, once it is legible.
        if (zoom > 0.55) {
            ctx.strokeStyle = "rgba(255,255,255,0.05)";
            ctx.lineWidth = 1 / zoom;
            const x0 = Math.max(0, Math.floor(vr.x / STAMP_CELL) * STAMP_CELL);
            const y0 = Math.max(0, Math.floor(vr.y / STAMP_CELL) * STAMP_CELL);
            for (let x = x0; x < Math.min(WORLD_W, vr.x + vr.w); x += STAMP_CELL) {
                ctx.beginPath(); ctx.moveTo(x, vr.y); ctx.lineTo(x, vr.y + vr.h); ctx.stroke();
            }
            for (let y = y0; y < Math.min(WORLD_H, vr.y + vr.h); y += STAMP_CELL) {
                ctx.beginPath(); ctx.moveTo(vr.x, y); ctx.lineTo(vr.x + vr.w, y); ctx.stroke();
            }
        }
    }

    // WHAT A SPOT SELLS, read off the built map rather than guessed.
    //
    // The sector decides -- that stays true -- but a spot that will not
    // tell you what it turned into is a spot you have to go and find in
    // game. So after every rebuild the label is the weapon or card of the
    // wall-buy or station that actually landed there.
    function soldAt(p) {
        if (p.kind === "wallbuy" && typeof wallBuys !== "undefined") {
            for (let i = 0; i < wallBuys.length; i++) {
                if (Math.abs(wallBuys[i].x - p.x) < 2 && Math.abs(wallBuys[i].y - p.y) < 2) {
                    return String(wallBuys[i].weapon).toUpperCase() + " " + wallBuys[i].cost;
                }
            }
            return "unused by this sector";
        }
        if (p.kind === "station" && typeof cardStations !== "undefined") {
            for (let i = 0; i < cardStations.length; i++) {
                if (Math.abs(cardStations[i].x - p.x) < 2 && Math.abs(cardStations[i].y - p.y) < 2) {
                    return String(cardStations[i].card).toUpperCase() + " " + cardStations[i].cost;
                }
            }
            return "unused by this sector";
        }
        return "";
    }

    function drawProps() {
        for (let i = 0; i < ZMAP.props.length; i++) {
            const p = ZMAP.props[i];
            const sz = TOOL_SIZE[p.kind] || 32;
            const h = p.kind === "wallbuy" ? 28 : p.kind === "station" ? 44
                    : p.kind === "culvert" ? (p.x > WORLD_W - 200 ? PERIM_CULVERT : WALL_T)
                    : sz;
            const w = p.kind === "culvert" && p.x > WORLD_W - 200 ? WALL_T : sz;
            ctx.strokeStyle = TOOL_COLOR[p.kind] || "#FFFFFF";
            ctx.lineWidth = 2 / zoom;
            ctx.strokeRect(p.x, p.y, w, h);
            if (zoom > 0.5) {
                ctx.fillStyle = TOOL_COLOR[p.kind] || "#FFFFFF";
                ctx.font = (10 / zoom) + "px Courier New";
                const sold = soldAt(p);
                ctx.fillText(p.kind + (sold ? ": " + sold : ""), p.x, p.y - 4 / zoom);
            }
        }
    }

    function drawPlacements() {
        for (let i = 0; i < ZMAP.placements.length; i++) {
            const p = ZMAP.placements[i];
            const s = byName(p.stamp);
            if (!s) continue;
            const r = (p.rot || p.mirror) ? ZS.rotate(s, p.rot || 0, !!p.mirror) : s;
            const w = r.w * STAMP_CELL, h = r.h * STAMP_CELL;
            const blocked = ZMAP.report.missing.some(function (m) {
                return m.indexOf(p.stamp + " @" + p.x + "," + p.y) === 0;
            });
            ctx.strokeStyle = blocked ? "#FF5555" : "#6FD08C";
            ctx.lineWidth = 2 / zoom;
            ctx.strokeRect(p.x, p.y, w, h);
            if (zoom > 0.35) {
                ctx.fillStyle = blocked ? "#FF5555" : "#6FD08C";
                ctx.font = (11 / zoom) + "px Courier New";
                ctx.fillText(p.stamp + (blocked ? "  BLOCKED" : ""), p.x + 4, p.y - 6 / zoom);
            }
        }
    }

    let ghostWhy = "";

    function drawGhost() {
        if (TOOLS[tool] !== "stamp") {
            if (!hover) return;
            const kind = TOOLS[tool];
            const sz = TOOL_SIZE[kind];
            ctx.strokeStyle = TOOL_COLOR[kind];
            ctx.lineWidth = 2 / zoom;
            ctx.strokeRect(snap(hover.x - sz / 2), snap(hover.y - 12), sz,
                           kind === "wallbuy" ? 28 : kind === "station" ? 44 : sz);
            return;
        }
        const s = stamp();
        if (!s || !hover) return;
        const w = s.w * STAMP_CELL, h = s.h * STAMP_CELL;
        const x = snap(hover.x - w / 2), y = snap(hover.y - h / 2);
        // THE SAME PREDICATE THE LEVEL USES, asked live under the cursor,
        // so the ghost is red exactly when the placement would be.
        const bad = stampBlockedReason(s, x, y, undefined, true);
        ghostWhy = bad ? bad.why : "";
        const geom = ZS.build(s, x, y);
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = "#9FB0B4";
        for (let i = 0; i < geom.walls.length; i++) {
            const r = geom.walls[i];
            ctx.fillRect(r.x, r.y, r.w, r.h);
        }
        ctx.fillStyle = "#C98A3A";
        for (let i = 0; i < geom.windows.length; i++) {
            const r = geom.windows[i];
            ctx.fillRect(r.x, r.y, r.w, r.h);
        }
        ctx.globalAlpha = 1;
        ctx.strokeStyle = ghostWhy ? "#FF5555" : "#FFB000";
        ctx.lineWidth = 2 / zoom;
        ctx.strokeRect(x, y, w, h);
        if (ghostWhy && zoom > 0.3) {
            ctx.fillStyle = "#FF5555";
            ctx.font = (11 / zoom) + "px Courier New";
            ctx.fillText(ghostWhy, x + 4, y + h + 14 / zoom);
        }
    }

    function render() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "#05070a";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.imageSmoothingEnabled = false;
        applyView();

        if (mode === "drawn") {
            // The REAL renderer, at the editor's camera. draw() reads
            // `camera`, so the camera is pointed at the editor's view and
            // then put back -- the game is not running, nothing else reads it.
            const keep = { x: camera.x, y: camera.y, scale: camera.scale, shake: camera.shake };
            camera.x = pan.x; camera.y = pan.y; camera.scale = zoom; camera.shake = 0;
            // THE LIGHT POCKET COMES OFF WHILE AUTHORING. Darkness is the
            // game's best mechanic and completely useless here: at editor
            // zoom the whole map is outside a 340px pocket, so the first
            // drawn view was a black screen with two red boxes on it. The
            // HUD, minimap and off-screen markers go with it -- they are
            // about a run, and there is no run.
            const hidden = ["drawLighting", "drawBlackoutMonochrome", "updateHud",
                            "drawMinimap", "drawOffscreenMarkers", "drawObjective"];
            const saved = {};
            for (let i = 0; i < hidden.length; i++) {
                const name = hidden[i];
                if (typeof window[name] === "function") {
                    saved[name] = window[name];
                    window[name] = function () {};
                }
            }
            try { draw(); } catch (e) { message = "draw failed: " + e.message; }
            for (const name in saved) window[name] = saved[name];
            camera.x = keep.x; camera.y = keep.y; camera.scale = keep.scale; camera.shake = keep.shake;
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            applyView();
            drawPlacements();
            drawProps();
        } else {
            drawPlan();
            drawPlacements();
            drawProps();
            drawGhost();
        }

        drawHud();
        requestAnimationFrame(render);
    }

    function drawHud() {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        const lines = [
            "MAP EDITOR   " + (mode === "plan" ? "[PLAN]" : "[DRAWN]") + "   SPACE to flip",
            "tool:   " + TOOLS[tool].toUpperCase() + "   ( T to change tool )",
            "stamp:  " + (ZS.LIBRARY[stampIndex] ? ZS.LIBRARY[stampIndex].name : "none") +
                "   ( [ ] to change, R rotate " + (rot * 90) + "°, M mirror" + (mirror ? " ON" : "") + " )",
            "placed: " + ZMAP.placements.length + " buildings, " + ZMAP.props.length + " props" +
                (ZMAP.report.missing.length ? "   BLOCKED: " + ZMAP.report.missing.length : ""),
            "click place   right-click delete   middle-drag pan   wheel zoom" +
                (ghostWhy ? "     HERE: " + ghostWhy : ""),
            "E export   G regenerate   F freeze perimeter",
            "A authored-only: " + (ZMAP.authoredOnly ? "ON" : "off") +
                "   P authored-perimeter: " + (ZMAP.authoredPerimeter ? "ON" : "off"),
            message
        ];
        ctx.font = "13px Courier New";
        const w = 560, h = lines.length * 18 + 16;
        ctx.fillStyle = "rgba(6,10,12,0.86)";
        ctx.fillRect(8, 8, w, h);
        ctx.strokeStyle = "#2a3336";
        ctx.strokeRect(8.5, 8.5, w, h);
        for (let i = 0; i < lines.length; i++) {
            ctx.fillStyle = i === 0 ? "#FFB000" : (i === lines.length - 1 ? "#6FD08C" : "#C8D2D4");
            ctx.fillText(lines[i], 18, 30 + i * 18);
        }
    }

    // --- input ------------------------------------------------------
    function wire() {
        const sig = (typeof zSignal === "function") ? { signal: zSignal() } : undefined;

        canvas.addEventListener("mousedown", function (ev) {
            const w = screenToWorld(ev.offsetX, ev.offsetY);
            if (ev.button === 1) { dragging = { sx: ev.clientX, sy: ev.clientY, px: pan.x, py: pan.y }; }
            else if (ev.button === 2) remove(w.x, w.y);
            else { painting = true; place(w.x, w.y); }
            ev.preventDefault();
        }, sig);

        canvas.addEventListener("mousemove", function (ev) {
            hover = screenToWorld(ev.offsetX, ev.offsetY);
            if (painting && TOOLS[tool] === "tree") place(hover.x, hover.y);
            if (dragging) {
                pan.x = dragging.px - (ev.clientX - dragging.sx) / zoom;
                pan.y = dragging.py - (ev.clientY - dragging.sy) / zoom;
            }
        }, sig);

        window.addEventListener("mouseup", function () { dragging = null; painting = false; }, sig);
        canvas.addEventListener("contextmenu", function (ev) { ev.preventDefault(); }, sig);

        canvas.addEventListener("wheel", function (ev) {
            const before = screenToWorld(ev.offsetX, ev.offsetY);
            zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, zoom * (ev.deltaY < 0 ? 1.15 : 1 / 1.15)));
            const after = screenToWorld(ev.offsetX, ev.offsetY);
            // Zoom about the cursor, not the screen centre.
            pan.x += before.x - after.x;
            pan.y += before.y - after.y;
            ev.preventDefault();
        }, sig);

        window.addEventListener("keydown", function (ev) {
            const k = ev.key.toLowerCase();
            if (ev.code === "Space") { mode = mode === "plan" ? "drawn" : "plan"; ev.preventDefault(); }
            else if (k === "[") { stampIndex = (stampIndex + ZS.LIBRARY.length - 1) % ZS.LIBRARY.length; }
            else if (k === "]") { stampIndex = (stampIndex + 1) % ZS.LIBRARY.length; }
            else if (k === "t") { tool = (tool + 1) % TOOLS.length; }
            else if (k === "r") { rot = (rot + 1) % 4; }
            else if (k === "m") { mirror = !mirror; }
            else if (k === "g") { rebuild(); message = "regenerated"; }
            else if (k === "f") {
                // FREEZE the perimeter this seed happens to have into
                // authored props, as a starting point to edit. Hand-placing
                // ~90 trunks from nothing is not authoring, it is typing;
                // what you actually want to hand-author is the SHAPE of a
                // tree line you already know.
                let trees = 0, mouths = 0;
                ZMAP.props = ZMAP.props.filter(function (q) {
                    return q.kind !== "tree" && q.kind !== "culvert";
                });
                for (let i = 0; i < forestRects.length; i++) {
                    ZMAP.addProp({ kind: "tree", x: forestRects[i].x, y: forestRects[i].y });
                    trees++;
                }
                for (let i = 0; i < culverts.length; i++) {
                    ZMAP.addProp({ kind: "culvert", x: culverts[i].x, y: culverts[i].y });
                    mouths++;
                }
                ZMAP.authoredPerimeter = true;
                rebuild();
                message = "froze the perimeter: " + trees + " trees, " + mouths +
                          " culverts -- now edit them, then E to export";
            }
            else if (k === "p") {
                ZMAP.authoredPerimeter = !ZMAP.authoredPerimeter;
                rebuild();
                message = "authored perimeter " + (ZMAP.authoredPerimeter
                    ? "ON -- only hand-placed trees and culverts exist"
                    : "off -- the forest and culverts are seeded again");
            }
            else if (k === "a") {
                ZMAP.authoredOnly = !ZMAP.authoredOnly;
                rebuild();
                message = "authored-only " + (ZMAP.authoredOnly ? "ON -- the generator places no buildings" : "off");
            }
            else if (k === "e") {
                const text = exportText();
                if (navigator.clipboard) {
                    navigator.clipboard.writeText(text).then(function () {
                        message = "exported " + ZMAP.placements.length + " placements to the clipboard";
                    }, function () {
                        console.log(text);
                        message = "clipboard refused (file://) -- the block is in the console";
                    });
                } else {
                    console.log(text);
                    message = "the block is in the console";
                }
            }
        }, sig);
    }

    // Fit the whole world plus its margin on screen.
    function fitZoom() {
        if (typeof resizeCanvas === "function" && (!canvas.width || !canvas.height)) resizeCanvas();
        if (!canvas.width || !canvas.height) return;
        zoom = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM,
            Math.min(canvas.width / (WORLD_W + MARGIN * 2),
                     canvas.height / (WORLD_H + MARGIN * 2))));
    }

    function start() {
        // The game must not run under the editor: no rounds, no spawning,
        // no camera of its own.
        if (typeof zRafHandle !== "undefined" && zRafHandle) cancelAnimationFrame(zRafHandle);
        if (typeof zDevNoZombies !== "undefined") zDevNoZombies = true;
        if (typeof zombies !== "undefined") zombies.length = 0;
        const start = document.getElementById("start");
        if (start) start.style.display = "none";
        const ui = document.getElementById("ui");
        if (ui) ui.style.display = "none";

        pan.x = WORLD_W / 2;
        pan.y = WORLD_H / 2;
        fitZoom();
        // The canvas is sized by a resize listener that has not fired yet
        // when this runs, so a fit computed now is a fit to 0x0 -- it came
        // out as zoom 0 and drew nothing. Size it first, and refit while
        // the canvas is still degenerate.
        window.addEventListener("resize", fitZoom,
                                (typeof zSignal === "function") ? { signal: zSignal() } : undefined);
        rebuild();
        wire();
        message = "ready -- " + ZS.LIBRARY.length + " stamps in the library";
        render();
    }

    // `render` and `look` are exposed for verification from a console or a
    // harness -- the browser pane does not always fire rAF, and a way to
    // draw one frame on demand is the difference between checking this and
    // guessing about it.
    function look(o) {
        if (o.mode) mode = o.mode;
        if (o.zoom) zoom = o.zoom;
        if (o.x !== undefined) pan.x = o.x;
        if (o.y !== undefined) pan.y = o.y;
        if (o.stamp !== undefined) stampIndex = o.stamp;
    }

    return { on: true, start: start, exportText: exportText, render: render, look: look,
             place: place, remove: remove, rebuild: rebuild,
             state: function () { return { mode: mode, zoom: zoom, pan: pan, message: message }; } };
})();

if (ZMAPEDIT.on) ZMAPEDIT.start();
