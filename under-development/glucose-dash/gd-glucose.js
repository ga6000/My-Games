// ===================================================
//   Glucose Dash -- the glucose model
// ===================================================
// Split out of glucose-dash.html's inline script 2026-09-05
// (FINAL_THREE_PASS_PLAN.md 4). Lines 878-970 were MOVED VERBATIM and IN
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
     GLUCOSE MODEL
   ===================================================
   Everything is expressed as a RATE in mg/dL per second and integrated,
   rather than as a target value the display chases. That matters:
   rates compose. Sprinting, climbing and a half-absorbed donut all add
   into the same number without any of them having to know about the
   others.

   Absorption is a half-sine so a food ramps on and off smoothly, with
   its area equal to the food's stated peak. High-GI foods then run a
   second, negative half-sine -- the insulin overshoot. That's the
   crash, and for every high-GI food the crash is LARGER than the
   spike: cake genuinely leaves you worse off than not eating, twelve
   seconds later. That's the whole point of it.
*/

function makeBolus(key) {
    var f = FOODS[key];
    return {
        key: key, t: 0,
        rise: f.rise, peak: f.peak,
        crash: f.crash || 0, crashDur: f.crashDur || 0,
        hold: f.hold || 0, holdX: f.holdX || 1
    };
}

function bolusRate(b, dt) {
    var rate = 0;
    if (b.t < b.rise) {
        rate += b.peak * (Math.PI / (2 * b.rise)) * Math.sin(Math.PI * b.t / b.rise);
    } else if (b.crash > 0 && b.t < b.rise + b.crashDur) {
        var u = (b.t - b.rise) / b.crashDur;
        rate -= b.crash * (Math.PI / (2 * b.crashDur)) * Math.sin(Math.PI * u);
    }
    return rate;
}

function bolusDone(b) {
    var span = b.rise + Math.max(b.crashDur, b.hold);
    return b.t > span;
}

function stepGlucose(r, dt) {
    if (r.dnf || r.finished) return;

    /* Baseline burn. Sprint doubles it (concept decision). Low-GI food
       suppresses it -- that's what "holds elevated for 30+ seconds"
       actually means mechanically.

       STACKING TAKES THE STRONGEST SUPPRESSOR, NEVER THE PRODUCT. Two
       salads multiplying to 0.18x decay is a hole you could drive a
       race through. */
    var supp = 1;
    for (var i = 0; i < r.boluses.length; i++) {
        var b = r.boluses[i];
        if (b.hold > 0 && b.t < b.hold) supp = Math.min(supp, b.holdX);
    }

    var decayX = supp * (r.sprintT > 0 ? TUNE.sprintDecayX : 1);
    var rate = -TUNE.baseDecay * decayX;

    for (var j = r.boluses.length - 1; j >= 0; j--) {
        var bo = r.boluses[j];
        rate += bolusRate(bo, dt);
        bo.t += dt;
        if (bolusDone(bo)) r.boluses.splice(j, 1);
    }

    r.glucose += rate * dt;
    r.glucoseRate = rate;

    if (r.glucose > TUNE.glucoseMax) r.glucose = TUNE.glucoseMax;
    if (r.glucose <= 0) {
        r.glucose = 0;
        crash(r);
    }

    if (r.isPlayer && phase === "racing") {
        r.timeInRange += (r.glucose >= TUNE.hypo && r.glucose <= TUNE.hyper) ? dt : 0;
        r.timeTotal += dt;
    }
}

function crash(r) {
    if (r.dnf || r.finished) return;
    r.dnf = true;
    r.speed = 0; r.vx = 0; r.vy = 0;
    finishOrder.push({ name: r.name, color: r.color, ms: null, self: !!r.isPlayer, dnf: true });
    if (r.isPlayer) endRace("dnf");
}


