// Play Zombie Arcade with a scripted bot, headless, over the page's own code.
//
//   node scripts/zombie-bot-playtest.js [--skill good|casual|expert]
//        [--diff 1.0] [--seed 3] [--start-map 1..4] [--minutes 25] [--kit]
//
// One run per invocation (a full run is a few minutes of CPU), JSON on stdout.
// See scripts/zombie-bot.inc.js for what the bot is and is not: it is a
// RELATIVE instrument, not a prediction of human win rates.

const fs = require("fs");
const path = require("path");
const harness = require(path.join(__dirname, "zombie-headless.js"));

const args = process.argv.slice(2);
function arg(name, dflt) {
    const i = args.indexOf("--" + name);
    return i >= 0 && args[i + 1] !== undefined ? args[i + 1] : dflt;
}

const seed = parseInt(arg("seed", "3"), 10);
const opts = {
    skill: arg("skill", "good"),
    diff: parseFloat(arg("diff", "1")),
    startMap: parseInt(arg("start-map", "1"), 10),
    maxMinutes: parseFloat(arg("minutes", "25")),
    kit: args.indexOf("--kit") >= 0,
    trace: args.indexOf("--trace") >= 0,
    caps3: arg("caps3", null) === null ? null : arg("caps3", "").split(",").map(Number),
    caps4: arg("caps4", null) === null ? null : arg("caps4", "").split(",").map(Number),
    pace3: arg("pace3", null) === null ? null : parseFloat(arg("pace3", null)),
    pace4: arg("pace4", null) === null ? null : parseFloat(arg("pace4", null)),
    clock3: arg("clock3", null) === null ? null : parseFloat(arg("clock3", null)),
    clock4: arg("clock4", null) === null ? null : parseFloat(arg("clock4", null))
};

const sb = harness.generate(seed, { fresh: true });
const src = fs.readFileSync(path.join(__dirname, "zombie-bot.inc.js"), "utf8");
const t0 = Date.now();
const realNow = Date.now;
const out = harness.evaluate(sb, src + "\nrunBot(" + JSON.stringify(opts) + ");");
Date.now = realNow;
const res = JSON.parse(out);
res.seed = seed;
res.cpuSeconds = Math.round((realNow() - t0) / 100) / 10;
console.log(JSON.stringify(res));
