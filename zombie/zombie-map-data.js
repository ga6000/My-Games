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

    add: function (o) {
        this.placements.push({
            stamp: o.stamp, x: o.x, y: o.y,
            rot: o.rot || 0, mirror: !!o.mirror
        });
    },

    // Placement outcomes from the last generateLevel(), so a building that
    // could not be built says so instead of vanishing -- the failure mode
    // this whole line of work exists to end.
    report: { placed: 0, missing: [] }
};

// ---------------------------------------------------
//   PLACEMENTS  (paste the editor's EXPORT below)
// ---------------------------------------------------
