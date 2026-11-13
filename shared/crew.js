/*
 * shared/crew.js — the six crew, drawn.
 *
 * Classic script, one global (`CREW`). No dependencies.
 *
 *     CREW.draw(ctx, "medic", x, y, 2, { pose: "walk", frame: n });
 *
 * Added 2026-11-13 (Ry: "player tokens as their actual characters"). Until
 * now the crew existed only as names and rules (zombie-endgame.js ROLES);
 * every game drew a player as a square in their identity colour. These are
 * the first drawn versions: a 16 x 20 pixel figure each, flat fills, built
 * so the SILHOUETTE tells them apart before the colour does:
 *
 *     medic    MAREN   white coat, satchel at the hip
 *     engineer ELODIE  hard hat, wrench held up
 *     scout    SOREN   hood and a cape that flares
 *     gunner   GREER   bandana tail, a gun across the body
 *     butcher  BEX     apron, cleaver raised
 *     bulwark  BOOKE   helmet, a shield as tall as the torso
 *
 * "generic" is the figure for someone who has not picked yet.
 *
 * A figure is 14 rows of head and body plus 6 rows of legs. The legs are
 * shared (three poses) and take the role's trouser and boot colours, which
 * is what lets every figure stand, breathe and walk without being drawn
 * four times. Identity colour is NOT in the figure: whoever draws it marks
 * the player some other way (the hub underlines the token).
 */
(function (global) {
    "use strict";

    var W = 16, H = 20;
    var KEYS = ["medic", "engineer", "scout", "gunner", "butcher", "bulwark"];

    var INFO = {
        medic:    { name: "MAREN",  title: "MEDIC",    line: "GETS PEOPLE BACK ON THEIR FEET" },
        engineer: { name: "ELODIE", title: "ENGINEER", line: "BUILDS THINGS THAT FIGHT FOR HER" },
        scout:    { name: "SOREN",  title: "SCOUT",    line: "FAST. FINDS WHAT OTHERS MISS" },
        gunner:   { name: "GREER",  title: "GUNNER",   line: "HITS HARDER THAN ANYONE" },
        butcher:  { name: "BEX",    title: "BUTCHER",  line: "MAKES EVERY KILL COUNT" },
        bulwark:  { name: "BOOKE",  title: "BULWARK",  line: "STANDS IN FRONT. TAKES THE HIT" },
        generic:  { name: "?",      title: "NO ONE YET", line: "" }
    };

    // k is always the dark outline ink; s is skin. l and f are the legs.
    var SKIN_A = "#E0B08A", SKIN_B = "#B9825C", SKIN_C = "#8A5A3C";
    var PAL = {
        medic:    { k: "#101412", s: SKIN_A, h: "#3A2A22", w: "#E8FFF4", c: "#3FB8A0", b: "#7A5A3A", x: "#00E5FF", l: "#3FB8A0", f: "#22302C" },
        engineer: { k: "#101412", s: SKIN_B, a: "#FFB000", b: "#4A6A8C", o: "#2C405A", m: "#B8C4C0", l: "#2C405A", f: "#5A4630" },
        scout:    { k: "#101412", s: SKIN_A, g: "#3E6A3A", c: "#00E5FF", d: "#22302C", l: "#22302C", f: "#3E6A3A" },
        gunner:   { k: "#101412", s: SKIN_C, r: "#E86A1C", v: "#5E6A3A", y: "#D8C060", m: "#3A4440", l: "#3A4440", f: "#1E2422" },
        butcher:  { k: "#101412", s: SKIN_A, h: "#C8D0CC", t: "#7A2A3A", p: "#D8D0BC", x: "#6E1F35", m: "#B8C4C0", l: "#2E3A34", f: "#141A17" },
        bulwark:  { k: "#101412", s: SKIN_B, m: "#8FA89C", d: "#4A5A6A", c: "#FFB000", n: "#6A7A74", l: "#4A5A54", f: "#22302C" },
        generic:  { k: "#101412", q: "#4A5A54", l: "#3A4640", f: "#2E3A34" }
    };

    var UPPER = {
        medic: [
            "................",
            ".....hhhhhh.....",
            "....hhhhhhhh....",
            "....hsssssshh...",
            "....skssksshh...",
            "....sssssssh....",
            ".....ssssss.....",
            "....wwwccwww....",
            "...wwwwccwwww...",
            "..swwwwccwwwws..",
            "..swwwwccwwwbbb.",
            "..swwwwccwwwbxb.",
            "...wwwwccwwwbbb.",
            "...wwwwwwwwww..."
        ],
        engineer: [
            "................",
            ".....aaaaaa.....",
            "....aaaaaaaa....",
            "...aaaaaaaaaa..m",
            "....sksskss...mm",
            "....sssssss...m.",
            ".....sssss....m.",
            "....bbobbobb..m.",
            "...bbbobbobbbsm.",
            "..sbbboooobbbs..",
            "..sbbboooobbb...",
            "..sbbboooobbb...",
            "...bbboooobbb...",
            "...bbbbbbbbbb..."
        ],
        scout: [
            "......gggg......",
            ".....gggggg.....",
            "....gggggggg....",
            "....ggsssggg....",
            "....gccsccgg....",
            "....ggsssgg.....",
            ".....gsssg......",
            "....gggggggg....",
            "...gggddddggg...",
            "..gggddddddggg..",
            "..ggsddddddsgg..",
            "..gg.dddddd.gg..",
            ".ggg.dddddd.ggg.",
            ".gg..dddddd..gg."
        ],
        gunner: [
            "................",
            ".....rrrrrr.....",
            "....rrrrrrrr....",
            "....sssssssrr...",
            "....skssksss.r..",
            "....sssssss..r..",
            ".....sssss......",
            "....vvyvvvvv....",
            "...vvvvyvvvvv...",
            "..svvvvvyvvvvs..",
            "..smmmmmmmmmmmmm",
            "..smmmmmmmmmmm..",
            "...vvmmvvvyvv...",
            "...vvvvvvvvvv..."
        ],
        butcher: [
            "................",
            ".mm...hhhhh.....",
            ".mmm.hhhhhhh....",
            ".mmm.sssssss....",
            ".mmm.skssks.....",
            "..k..sssssss....",
            "..k...sssss.....",
            "..s.tttppttt....",
            "..sttttpppttt...",
            "...tttppppptts..",
            "....ttpppxpts...",
            "....ttpxpppts...",
            "....ttppppptt...",
            "....ttppppptt..."
        ],
        bulwark: [
            "....mmmmmmmm....",
            "...mmmmmmmmmm...",
            "...mmmmmmmmmm...",
            "...mkkkkkkkkm...",
            "...mssksskssm...",
            "....ssssssss....",
            ".....ssssss.....",
            ".ddddddnnnnnnn..",
            ".dcccddnnnnnnnn.",
            ".dcccddnnnnnnns.",
            ".dcccddnnnnnnns.",
            ".dcccddnnnnnnns.",
            ".ddddddnnnnnnn..",
            "..dddd.nnnnnn..."
        ],
        generic: [
            "................",
            ".....qqqqqq.....",
            "....qqqqqqqq....",
            "....qqqqqqqq....",
            "....qqqqqqqq....",
            "....qqqqqqqq....",
            ".....qqqqqq.....",
            "....qqqqqqqq....",
            "...qqqqqqqqqq...",
            "..qqqqqqqqqqqq..",
            "..qqqqqqqqqqqq..",
            "..qq.qqqqqq.qq..",
            "...qqqqqqqqqq...",
            "...qqqqqqqqqq..."
        ]
    };

    var LEGS = {
        stand: [
            "....lll..lll....",
            "....lll..lll....",
            "....lll..lll....",
            "....lll..lll....",
            "....fff..fff....",
            "...ffff..ffff..."
        ],
        stepA: [
            "....lll..lll....",
            "...lll...lll....",
            "...lll....lll...",
            "..lll.....lll...",
            "..fff......fff..",
            ".ffff.....ffff.."
        ],
        stepB: [
            "....lll.lll.....",
            ".....lllll......",
            ".....llll.......",
            ".....lll........",
            ".....fff........",
            "....ffff........"
        ]
    };

    function rows(ctx, list, pal, x, y, s, flip) {
        for (var r = 0; r < list.length; r++) {
            var line = list[r];
            for (var c = 0; c < W; c++) {
                var ch = line.charAt(flip ? W - 1 - c : c);
                if (ch === ".") continue;
                var col = pal[ch];
                if (!col) continue;
                ctx.fillStyle = col;
                ctx.fillRect(x + c * s, y + r * s, s, s);
            }
        }
    }

    // opts.pose   "idle" (default) breathes; "walk" steps
    // opts.frame  any counter; the caller's clock decides the speed
    // opts.flip   face left
    function draw(ctx, role, x, y, scale, opts) {
        opts = opts || {};
        var key = UPPER[role] ? role : "generic";
        var pal = PAL[key];
        var s = scale || 1;
        var f = Math.floor(opts.frame || 0);
        var walk = opts.pose === "walk";
        var legs = walk ? (f % 2 === 0 ? LEGS.stepA : LEGS.stepB) : LEGS.stand;
        // The breath, and the bob of a step: the head and body drop a pixel.
        var dip = walk ? (f % 2) : (f % 4 === 3 ? 1 : 0);
        x = Math.round(x); y = Math.round(y);
        rows(ctx, legs, pal, x, y + 14 * s, s, !!opts.flip);
        rows(ctx, UPPER[key], pal, x, y + dip * s, s, !!opts.flip);
    }

    global.CREW = {
        W: W, H: H, KEYS: KEYS, INFO: INFO,
        draw: draw,
        has: function (role) { return KEYS.indexOf(role) >= 0; }
    };
})(window);
