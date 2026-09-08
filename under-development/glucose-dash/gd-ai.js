// ===================================================
//   Glucose Dash -- NPC AI
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 1291-1484 were MOVED VERBATIM and IN
// STRICT SOURCE ORDER -- nothing was reordered, nothing was reindented.
//
// EVERY FILE CARRIES ITS OWN "use strict". The original script had one at the
// top, covering all 2,363 lines; a classic-script split gives each file its own
// scope for that directive, so omitting it would silently drop files 2-12 into
// sloppy mode. That is a semantic change, not a cosmetic one.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). This game lives under under-development/, so its shared paths
// are ../../shared/, not ../shared/.
"use strict";

/* ===================================================
     NPC AI — deliberately easy
   ===================================================
   Concept decision: NPCs contest scarce items like a player would, but
   slower and without sprint spam. They exist to give sprint a reason to
   exist before multiplayer arrives -- if nothing ever races you for the
   centre-aisle shake, the double-tap is decoration.

   "Easy" is three specific things, not a difficulty multiplier:
     1. they decide at 2Hz, so they commit late and overshoot bays;
     2. their steering carries a jitter term, so they don't drive the
        perfect line;
     3. they only sprint when something is genuinely contesting them.

   SCOPE.md §6d: when real players are in the room these should probably
   just be removed rather than synced. They've done their job by then. */

/* Widened for the doubled course. These are how far an NPC can even SEE
   food, and on a 3300-unit course a 112-unit horizon meant they were
   reacting to shops that were already almost past them. */
var NPC_SCAN_AHEAD = 145;
var NPC_SCAN_SIDE  = 34;

function npcThink(r, dt) {
    r.think -= dt;
    if (r.think > 0) return;
    r.think = 0.42 + Math.random() * 0.22;

    /* Will I even get there? Distance left, at my burn rate, against
       what I'm carrying. An NPC that jogs serenely into a hypo crash
       reads as broken rather than as easy. */
    var secsLeft = Math.max(0, COURSE_LEN - r.y) / Math.max(8, r.speed);
    var carried = 0;
    for (var c = 0; c < r.inventory.length; c++) {
        var cf = FOODS[r.inventory[c]];
        carried += cf.peak - (cf.crash || 0) + (cf.hold ? cf.hold * TUNE.baseDecay * (1 - cf.holdX) : 0);
    }
    /* Judge starvation over a PLANNING HORIZON, not the whole remaining
       race. Against the full distance, a 126s course means every NPC
       thinks it is starving from the starting gun -- which tripled every
       item score, dropped their detour threshold to nothing, and had them
       careening across the mall after food they didn't need while
       actually starving. Food keeps appearing; you only have to survive
       as far as the next few shops. */
    var horizon = Math.min(28, secsLeft);
    var starving = (r.glucose + carried) < horizon * TUNE.baseDecay * 1.05;

    /* Eat first -- an NPC that dies holding two donuts looks broken. */
    if (!r.eating && r.inventory.length) {
        /* Eat sooner. Food in hand does nothing -- and with two slots
           you cannot bank much anyway, so sitting on a sandwich at 118
           while sliding toward a bonk is just a slower death. */
        var hungry = r.glucose < (124 + r.aggression * 10);
        var projected = r.glucose + r.glucoseRate * 4;
        if (hungry || projected < 95 || starving) { r.wantEat = true; }
    }

    /* Look for something worth leaving the line for. */
    r.target = null;
    if (r.inventory.length < TUNE.invSize) {
        var best = null, bestScore = 0;
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            if (it.taken || it.floor !== r.floor) continue;
            var ahead = it.y - r.y;
            if (ahead < 3 || ahead > NPC_SCAN_AHEAD) continue;
            if (Math.abs(it.x - r.x) > NPC_SCAN_SIDE + 7) continue;

            var f = FOODS[it.food];
            /* Value is "how much of my problem does this solve", not
               raw sugar: a crash-y food is worth less unless I'm
               actually in trouble right now, and a food that suppresses
               the burn for 30s is worth far more than its peak says. */
            /* Weight the crash at nearly its full size. At 0.55 an NPC
               rated a cake as +35 and happily ate the ground floor's
               sugar minefield all race -- 59% of everything they ate was
               high-GI, which is net NEGATIVE, so they were eating
               themselves into the floor. The desperation clause is also
               tighter (was 80): reaching for sugar at 78 starts the exact
               spike-crash-spike spiral the food model is designed to
               punish. Below 62 it really is the right call. */
            var value = f.peak - (f.crash || 0) * 0.82 + (f.hold ? 45 : 0);
            if (r.glucose < 62) value += (f.crash || 0) * 0.9;   // genuinely desperate
            var detour = Math.abs(it.x - r.x) * 0.9 + f.eat * 7;
            var score = value / (1 + detour * 0.05);
            if (starving) score *= 3;
            // A platform hanging over a drop is worth less than the same
            // food on solid ground. They are easy, not suicidal.
            if (it.bay && r.floor > 0) score *= (r.floor === 2 ? 0.45 : 0.65);
            if (score > bestScore) { bestScore = score; best = it; }
        }
        if (best && bestScore > (starving ? 2 : 4)) r.target = best;
    }

    /* Some NPCs believe in the upper floors. Gives the field variety
       and makes the ramps look used. */
    if (!r.target && r.wantsUp && r.floor < 2) {
        for (var j = 0; j < RAMPS.length; j++) {
            var ra = RAMPS[j];
            if (ra.from !== r.floor || ra.to <= ra.from) continue;
            if (ra.y0 < r.y + 8 || ra.y0 > r.y + 190) continue;
            r.target = { x: ra.side * RAMP_X, y: (ra.y0 + ra.y1) / 2, ramp: true };
            break;
        }
    }

    /* Late in the race, get back to the ground floor or you can't
       finish. Same bail-out logic a player has to work out themselves. */
    if (r.floor > 0 && r.y > COURSE_LEN - 420) {
        for (var k = 0; k < RAMPS.length; k++) {
            var rd = RAMPS[k];
            if (rd.from !== r.floor || rd.to >= rd.from) continue;
            if (rd.y0 < r.y + 4) continue;
            r.target = { x: rd.side * RAMP_X, y: (rd.y0 + rd.y1) / 2, ramp: true };
            break;
        }
    }
}

function npcInput(r, dt) {
    npcThink(r, dt);

    /* Between 2Hz decisions an item can be taken by someone else or slip
       behind you. Without this an NPC keeps steering at a pickup that
       isn't there any more, straight into the storefront wall. */
    if (r.target && !r.target.ramp && (r.target.taken || r.target.y < r.y - 1)) r.target = null;

    var tx, ty;
    if (r.target) { tx = r.target.x; ty = r.target.y; }
    else { tx = r.lane; ty = r.y + 60; }

    /* Reaching for a pickup on a balcony platform: aim SHORT of it.
       The pickup radius is 2.7, so aiming ~1.8 inside the item still
       collects it while leaving the runner most of a lane closer to
       safety. Aiming at the item itself put them right on the lip with
       nothing left to correct with -- once they started climbing more,
       that alone doubled their fall rate. */
    if (r.target && r.target.bay && r.floor > 0) {
        tx -= (tx < 0 ? -1 : 1) * 1.8;
    }

    /* Do not wander off a balcony while thinking about something else.
       Only a target they have actually committed to gets to pull them
       past the safe band. */
    if (r.floor > 0) {
        var safe = hallHalf(r.floor) * 0.82;
        if (!r.target || !r.target.bay) {
            tx = Math.max(-safe, Math.min(safe, tx));
            /* Cut back HARD, aiming past the centre line. Coming off a
               storefront platform there is very little y left before the
               floor simply stops, and a gentle correction at 25 units/sec
               does not arrive in time. */
            if (Math.abs(r.x) > hallHalf(r.floor) * 0.8) {
                tx = -(r.x < 0 ? -1 : 1) * hallHalf(r.floor) * 0.35;
            }
        }
    }

    var want = Math.atan2(tx - r.x, Math.max(2, ty - r.y));
    /* jitter: an NPC that drives the exact optimal line reads as a
       machine, and reads as unfair when it beats you to a shake */
    want += Math.sin(raceTime * 1.7 + r.jitter) * 0.055;

    var diff = Math.atan2(Math.sin(want - r.heading), Math.cos(want - r.heading));
    var steer = Math.max(-1, Math.min(1, diff * 3.1));

    /* Sprint only when actually contested: someone else is near the
       same item and close enough to take it. */
    var sprint = false;
    // never sprint into a platform hanging over a drop
    var sprintSafe = !(r.target && r.target.bay && r.floor > 0);
    if (sprintSafe && r.target && !r.target.ramp && r.glucose > 112 && r.sprintCd <= 0) {
        var dToItem = Math.hypot(r.target.x - r.x, r.target.y - r.y);
        if (dToItem < 34) {
            for (var i = 0; i < runners.length; i++) {
                var o = runners[i];
                if (o === r || o.finished || o.dnf || o.floor !== r.floor) continue;
                if (Math.hypot(r.target.x - o.x, r.target.y - o.y) < dToItem + 9) { sprint = true; break; }
            }
        }
    }

    var eat = !!r.wantEat && !r.onRamp;
    if (eat) r.wantEat = false;

    return {
        throttle: true,
        brake: Math.abs(diff) > 1.15 && r.speed > 16,
        steer: steer,
        sprint: sprint,
        eat: eat
    };
}

