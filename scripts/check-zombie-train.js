#!/usr/bin/env node
/**
 * check-zombie-train.js  (2026-09-26)
 *
 * Drives the evacuation train through the REAL game code, headless: shunt a
 * car with a rocket, couple all three, buy the crossings, start the
 * locomotive, and check it holds for the tunnel and then reaches it above the
 * win speed.
 *
 * It runs the page's own scripts through scripts/zombie-headless.js -- this
 * harness never reimplements the simulation, which is the only way a check
 * over it can mean anything. Same reasoning as check-map-features.js.
 *
 * WHY THIS IS IN THE REPO. zombie/CLAUDE.md records a nav measurement from
 * 2026-09-18 with the note "the method was recorded, the harness was not",
 * and it then had to be rewritten from scratch. The train is a physics
 * simulation with a dozen ways to go quietly wrong (a coupling that never
 * fires, a cap that stops applying, a locomotive that starts on empty tanks);
 * a check nobody can re-run is a check that stops being true.
 *
 * Usage, from the repo root:
 *   node scripts/check-zombie-train.js
 *
 * Exits 1 on any failed check.
 */
const fs=require("fs"),path=require("path"),vm=require("vm");
const SRC=fs.readFileSync("scripts/zombie-headless.js","utf8");const ALT=path.resolve("zombie");
const patched=SRC.replace('const ZOMBIE = path.join(__dirname, "..", "zombie");','const ZOMBIE = '+JSON.stringify(ALT)+';')
                 .replace('const PAGE = path.join(ZOMBIE, "Zombie.html");','const PAGE = path.join(ZOMBIE, "Zombie.html");');
const m={exports:{}};vm.runInThisContext('(function(module,require,__dirname){'+patched+'})')(m,require,path.resolve("scripts"));
const H=m.exports;
const sb=H.generate(22352);
const ev=e=>H.evaluate(sb,e);

function step(ms){ ev("trainUpdate(Date.now(), "+ms+")"); }
function state(){ return H.snapshot(sb,"trainCars.map(function(c){return {k:c.kind,s:Math.round(c.s),v:Math.round(c.v),c:c.coupled};})"); }

let fails=0;
function check(label, cond, extra){ console.log((cond?"  PASS  ":"  FAIL  ")+label+(extra?"   "+extra:"")); if(!cond)fails++; }

console.log("line "+ev("Math.round(trainLine.len)")+"px, cars: "+JSON.stringify(state())+"\n");

// 1. Friction brings a shunted car to rest.
ev("trainCars[1].v = 80");
for(let i=0;i<120;i++) step(16.7);
check("friction stops a rolling car", Math.abs(H.evaluate(sb,"trainCars[1].v"))<1, "v="+ev("Math.round(trainCars[1].v)"));

// 2. The shunt cap holds while not under power.
ev("trainCars[1].v = 5000");
step(16.7);
check("shunt speed is capped at 90px/s", ev("Math.abs(trainCars[1].v)")<=90, "v="+ev("Math.round(trainCars[1].v)"));
ev("trainCars[1].v = 0");

// 3. A rocket across the rails moves nothing; along them, it shunts.
const c3=ev("Math.round(trainCars[3].s)");
ev("trainRocketKick(trainCars[3].cx, trainCars[3].cy - 400, 0, 0, 1)"); // far away
check("a rocket out of range does nothing", ev("trainCars[3].v")===0);
ev("trainRocketKick(trainCars[3].cx - 40, trainCars[3].cy, 900, 0, 150)");
check("a rocket along the rails shunts the car", ev("trainCars[3].v")>0, "v="+ev("Math.round(trainCars[3].v)"));

// 4. Shunt every car home and check each one couples.
for(let k=3;k>=1;k--){
  let guard=0;
  while(!ev("trainCars["+k+"].coupled") && guard++<4000){
    if(ev("trainCars["+k+"].v")<60) ev("trainCars["+k+"].v = 90");
    step(16.7);
  }
}
check("all three fuel cars couple by shunting", ev("trainCoupledCount()")===3, JSON.stringify(state()));

// 5. The consist is in order, nose to tail, with no overlap.
const cars=state();
let ordered=true;
for(let i=1;i<cars.length;i++) if(cars[i].s>=cars[i-1].s) ordered=false;
check("the consist is in order with the loco at the head", ordered, cars.map(c=>c.s).join(" > "));

// 6. The locomotive will not start on empty tanks.
ev("trainHostStart()");
check("an unfuelled locomotive will not start", ev("trainRunning")===false);

// 7. Fill the tanks, start it, and run it to the tunnel.
ev("for (var i=0;i<3;i++){ siloFill[i] = siloCapacity(i); siloFlipped[i] = true; }");
check("tanks read full once the silos are", ev("trainTanksFull()")===true);
// A shut rail crossing is a shut line -- the train drives through a closed
// door but a RIDER does not, so this is a rule, not a nicety.
ev("trainHostStart()");
check("it will not start while a rail crossing is shut",
      ev("trainRunning")===false, "blocked at "+ev("JSON.stringify(trainPathBlockedBy()&&{x:trainPathBlockedBy().x,cost:trainPathBlockedBy().cost})"));
ev("doors.forEach(function(d){ if (d.rail) d.open = true; }); rebuildSolidIndex();");
check("buying the crossings makes it ready", ev("trainReady()")===true);
ev("trainHostStart()");
check("a fuelled, coupled locomotive starts", ev("trainRunning")===true);
check("starting it opens the tunnel and calls the flood",
      ev("escapeAt")>0 && ev("floodActive")===true);

// It must HOLD while the tunnel is shut -- that 90s is the fight.
const sHold=ev("Math.round(trainCars[0].s)");
for(let i=0;i<300;i++) step(16.7);   // 5 simulated seconds
// It may coast the last pixel of the shunt that coupled it -- friction is
// still running -- but it must come to REST and stay there.
check("it holds at the platform while the tunnel is shut",
      ev("trainCars[0].v")===0 && Math.abs(ev("Math.round(trainCars[0].s)")-sHold)<30,
      "coasted "+(ev("Math.round(trainCars[0].s)")-sHold)+"px, then v=0");

// Let the tunnel finish opening, then drive.
ev("escapeAt = Date.now() - 1");
let t=0, guard=0;
while(ev("trainCars[0].s") < ev("trainLine.len - 2") && guard++<4000){ step(16.7); t+=16.7; }
ev("won = true");   // what triggerWin() sets; the sim has no UI to run
const vEnd=ev("Math.round(trainCars[0].v)");
check("the train reaches the tunnel", ev("trainCars[0].s")>=ev("trainLine.len - 2"),
      "took "+(t/1000).toFixed(1)+"s");
check("and it arrives above the win speed", vEnd>=300, vEnd+" px/s (need 300)");
check("it does not exceed its maximum", vEnd<=1300, vEnd+" px/s");

console.log("\n"+(fails?fails+" CHECK(S) FAILED":"all checks passed"));
process.exit(fails?1:0);
