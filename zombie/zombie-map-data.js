/* ===================================================================
   THE AUTHORED MAP — hard-wired building placements
   ===================================================================
   Where every hand-placed building on the map stands. Written by the map
   editor (`Zombie.html?editor=1`): place buildings, press EXPORT, paste
   the block it gives you over the list below.

   A placement is `{ stamp, x, y, rot, mirror }` in WORLD coordinates,
   snapped to the 20px cell. The stamp name is a key into the library in
   zombie-stamps-data.js, so a stamp can be redrawn and every copy of it on
   the map changes with it -- which is the reason placements name a stamp
   rather than carrying their own grid.

   `authoredOnly` switches the seeded building placer OFF. Leave it false
   while the map is half-authored: authored buildings go down first and the
   generator fills whatever ground is left, so the map is playable
   throughout. Turn it on when the authored map is the map.

   WHAT IS STILL SEEDED either way: the sector shapes, floors, boundary
   doors and their prices, landmarks, the container maze, the Kennels'
   rolling stock, the Spillway's runs, crates, barrels, wall-buys and perk
   stations. Only BUILDINGS are authored here so far.
   =================================================================== */
"use strict";

const ZMAP = {
    // false: authored buildings, then the generator fills the gaps.
    // true:  authored buildings only.
    authoredOnly: false,

    placements: [],

    // Crates, barrels, wall-buys and perk stations (2026-09-26). Same
    // idea, smaller things: `{ kind, x, y }` in world coordinates.
    //
    // WHAT a wall-buy or a station SELLS is still the sector's business
    // (SECTORS[].guns, PERK_SECTOR_HOMES) -- authoring says WHERE. The
    // per-sector stock is a balance decision with its own reasoning in
    // zombie/CLAUDE.md, and moving it is a separate argument from placing
    // the furniture. An authored spot is consumed by that sector's next
    // wall-buy or station, in order; anything left over falls back to the
    // seeded search, so a half-authored map still works.
    props: [],

    add: function (o) {
        this.placements.push({
            stamp: o.stamp, x: o.x, y: o.y,
            rot: o.rot || 0, mirror: !!o.mirror
        });
    },

    addProp: function (o) {
        this.props.push({ kind: o.kind, x: o.x, y: o.y });
    },

    // Placement outcomes from the last generateLevel(), so a building that
    // could not be built says so instead of vanishing -- the failure mode
    // this whole line of work exists to end.
    report: { placed: 0, missing: [] }
};

// ---------------------------------------------------
//   PLACEMENTS  (paste the editor's EXPORT below)
// ---------------------------------------------------
// A STARTING POINT, not a map (2026-09-26). Ten buildings, and every one of
// them BUILDS ON EVERY SEED -- checked by running the real generator over
// eight of them and reading ZMAP.report.missing, which is the only test
// that means anything here.
//
// Getting that right took three attempts, and the first two are worth
// knowing about. Searching a FINISHED map for spots asks the wrong
// question: with the seeded placer on, its 13.8 buildings had taken the
// ground and only THE SPILLWAY had room; with it off, the funnel halls and
// landmarks still had, and COLD STORAGE reported zero legal spots for every
// stamp in the library. Authored buildings go down BEFORE halls and
// landmarks, so those move out of the way -- a finished map cannot answer
// whether an authored spot works. Propose liberally, then let the real
// generator decide.
//
// THE SPILLWAY, THE MOTOR POOL, THE KENNELS and THE YARD have none on
// purpose: their own geometry owns their middle. A first draft with three
// in the Spillway and one in the Motor Pool measurably cost service bays
// (1.17 -> 0.83 a map) and put buildings back on painted storm drains at
// 0.83 a map -- the exact defect the 2026-09-24 build-order fix removed.
//
// THE PUMP HOUSE has none either, and that one is not on purpose: nothing
// in the library fits what is left of it once its boundary doorways are
// clear. It wants a stamp drawn for it.
//
// Edit all of this in the editor (Zombie.html?editor=1&solo=1).

// COLD
ZMAP.add({ stamp: "cold-chiller-b", x: 1660, y: 1020, rot: 0, mirror: false });
ZMAP.add({ stamp: "Storage Shed", x: 1700, y: 460, rot: 0, mirror: false });

// CENTRE
ZMAP.add({ stamp: "warren-a", x: 3140, y: 1360, rot: 0, mirror: false });
ZMAP.add({ stamp: "warren-a", x: 2060, y: 1480, rot: 0, mirror: false });
ZMAP.add({ stamp: "hut-a", x: 2620, y: 1360, rot: 0, mirror: false });

// TURBINE
ZMAP.add({ stamp: "warren-a", x: 1540, y: 1360, rot: 0, mirror: false });
ZMAP.add({ stamp: "hut-a", x: 1620, y: 1880, rot: 1, mirror: false });

// SLUICE
ZMAP.add({ stamp: "cold-block-c", x: 2540, y: 2260, rot: 0, mirror: false });
ZMAP.add({ stamp: "cold-block-c", x: 460, y: 2700, rot: 0, mirror: false });
ZMAP.add({ stamp: "cold-block-c", x: 1140, y: 2780, rot: 0, mirror: false });


// PROPS. Three examples of the syntax, no more -- crates and barrels are
// yours to place, and a wall-buy spot says only WHERE: COLD STORAGE still
// sells the rifle, because what a sector stocks is a balance decision
// (SECTORS[].guns) and not a placement one.
ZMAP.addProp({ kind: "crate",   x: 1780, y: 640 });
ZMAP.addProp({ kind: "barrel",  x: 1860, y: 640 });
ZMAP.addProp({ kind: "wallbuy", x: 1720, y: 700 });

