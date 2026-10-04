/* ===================================================================
   THE STAMP LIBRARY — this is the file you paste hand-drawn stamps into
   ===================================================================
   Draw one in zombie/stamp-builder.html, press COPY, and paste it here as
   another ZS.add(`...`) block. Reload the game and it is on the map.

   A JS file, not a folder of .txt, because of the file:// constraint: a
   double-clicked page cannot fetch anything, and a stamp that only works
   under the dev server is a stamp the group cannot play.

   ZS.add() CHECKS EACH ONE and drops it with a console warning if it
   fails -- an open shell, a door under 4 cells, furniture outside the
   walls, a room no door reaches. A rejected stamp never reaches the map.

   The four below are a STARTING POINT to hand-author from, not a design.
   Three are Cold Storage, which got zero buildings on every seed before
   this (zombie/MAP_VISUAL_AUDIT.md); the hut is small enough to fit the
   leftover ground in sectors whose own geometry owns the middle.

   Legend, briefly:  # wall   D door (>=4 cells)   W window (>=2)
                     . floor  s stairs  d desk  b bench  r rack  c chair
                     $ wall-buy slot   P perk slot   ? loot slot
                     a space is OUTSIDE the stamp, so a stamp need not be
                     a rectangle -- an L, a U or a whole block is fine.
   =================================================================== */
"use strict";

// COLD STORAGE — chiller hall. Racking down one half, office down the
// other, the internal door lined up with neither exterior door so you
// cannot see straight through.
ZS.add(`
name: cold-hall-a
sector: cold
kind: store
rotate: any
weight: 1

################
#ss....#.......#
#ss....D..rrr..#
#......D.......#
D......D..###..W
D......D.......W
D......D..rrr..#
D......#.......#
#..dd..#..###..#
#..cc..#.......#
##########DDDD##
`);

// COLD STORAGE — the small chiller. Same idiom, half the footprint, for
// the ground between the hall and a boundary.
ZS.add(`
name: cold-chiller-b
sector: cold
kind: store
rotate: any
weight: 1

###########
#s...#....#
#....#.rr.#
D....D....W
D....D.rr.W
D....D....#
D....D.rr.#
#..c.#....#
#####DDDD##
`);

// COLD STORAGE — A BLOCK, not a building: two units sharing a double
// wall, joined by a 2x4 passage. Blocks are allowed on purpose (the
// user's call, 2026-09-26) -- a yard of separate sheds reads as scatter,
// two buildings that grew into each other read as a place.
ZS.add(`
name: cold-block-c
sector: cold
kind: store
rotate: any
weight: 1

##################
#s.....##........#
#..dd..##..rrrr..#
D..dd..##..rrrr..W
D......DD........W
D......DD........#
D......DD..rrrr..#
#..c...DD..rrrr..#
#......##........#
#......##..rrrr..#
#......##........#
##DDDD####DDDD####
`);

// ANY SECTOR — a utility hut. Deliberately small (180x160), because the
// sectors that get nothing are the ones whose own geometry owns the
// middle: the Spillway's storm runs, the Motor Pool's bays. This is what
// fits beside them.
ZS.add(`
name: hut-a
sector: any
kind: workshop
rotate: any
weight: 1

#########
#s......#
#.......W
D.......W
D.......#
D..bb...#
D.......#
#########
`);


// ONE-CELL DOORS (2026-09-26). The demonstration of the split nav grid:
// every interior door here is a single 20px cell, so walkers, runners,
// screamers and spawnlings pour through them -- and a brute, ULTRA HEAVY
// or SUPER SPLITTER cannot, because it does not fit. They have to use the
// 4-cell door on the south face, which reaches the left hall ONLY.
//
// So the two right-hand rooms are small-bodies-only ground. That is a
// decision this format now lets you make per building, and it is what the
// builder's "no door 4 cells or wider" warning is about.
ZS.add(`
name: warren-a
sector: any
kind: office
rotate: any
weight: 1

#############
#s....#.rr..#
#.....#.....W
#.....D.....W
#.....#.....#
#.....####D##
#.....#.....#
#.....#..bb.#
#.....#.....#
##DDDD#######
`);


// --- drawn by the user, 2026-09-26 -------------------------------------
ZS.add(`
name: Storage Shed
sector: cold
kind: store
rotate: any
weight: 1

#DDDD######
#....rrrr.#
#r.......r#
#r.......r#
#r.......r#
#.rrrr....#
######DDDD#
`);


ZS.add(`
name: hut-b
sector: any
kind: office
rotate: any
weight: 1

 #####DDDD#
#rr.......#
#r.......r#
D...#....r#
D..b#bdc.##
D..b#bd...D
D..b#bdc..D
#r........D
#rr.......D
 ##########
`);
