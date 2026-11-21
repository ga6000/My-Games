#!/usr/bin/env node
/**
 * takeoff-playtest.js — does a Takeoff round run from the countdown to the
 * score card without errors, and can a simple autopilot win it?
 *
 * Loads takeoff/takeoff.html in headless Chromium over file://, sets
 * window.TO_TEST so the frame loop draws but never steps, then drives the
 * game's own toUpdate at its fixed timestep with a crude autopilot (stay
 * beside the mothership, under the wall during gates, shoot the nearest weak
 * spot or creature). It proves the round RUNS, not that it is fun.
 *
 * Usage:
 *   node scripts/takeoff-playtest.js              # one run, a summary
 *   node scripts/takeoff-playtest.js --shots DIR  # also save screenshots
 *   node scripts/takeoff-playtest.js --runs 3
 *   node scripts/takeoff-playtest.js --idle       # no autopilot: should LOSE cleanly
 *
 * Exit code 1 on any page error, or if no run reaches the score card.
 */
"use strict";
const path = require("path");
const fs = require("fs");
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const shotDir = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
const runs = args.includes("--runs") ? Number(args[args.indexOf("--runs") + 1]) : 1;
const idle = args.includes("--idle");
const reduced = args.includes("--reduced");
const url = "file://" + path.resolve(__dirname, "..", "takeoff", "takeoff.html");

(async function () {
    const browser = await chromium.launch();
    const page = await browser.newPage({ viewport: { width: 1280, height: 720 }, reducedMotion: reduced ? "reduce" : "no-preference" });
    const errors = [];
    page.on("pageerror", function (e) { errors.push(String(e && e.stack || e)); });
    page.on("console", function (m) { if (m.type() === "error") errors.push(m.text()); });
    await page.addInitScript(function () { window.TO_TEST = true; });
    await page.goto(url);
    await page.addScriptTag({ path: path.join(__dirname, "takeoff-autopilot.inc.js") });
    await page.waitForTimeout(300);
    if (shotDir) { fs.mkdirSync(shotDir, { recursive: true }); await page.screenshot({ path: path.join(shotDir, "00-title.png") }); }

    let anyCard = false;
    for (let r = 0; r < runs; r++) {
        await page.evaluate(function () { TO_API.newRun(); });
        const shotsAt = { 6: "01-doors", 9.5: "02-rise", 13: "03-liftoff", 40: "04-climb" };
        const log = [];
        let t = 0, lastPhase = "", gateShot = {}, done = false;
        while (!done && t < 520) {
            const res = await page.evaluate(function (opt) {
                const out = [];
                for (let i = 0; i < 30; i++) {
                    if (!opt.idle) toAutopilot();
                    TO_API.step(1 / 60);
                }
                return { phase: toPhase, seg: toSeg, hull: Math.round(toM.hull), score: toScore, deaths: toP.deaths,
                         gate: toG ? toG.state + ":" + Math.round(toG.pool) + ":" + Math.round(toMotherBottom() - toCam.y) : "", foes: toFoes.length };
            }, { idle: idle });
            t += 0.5;
            if (res.phase + res.seg !== lastPhase) { log.push(t.toFixed(1) + "s " + res.phase + " seg" + res.seg + " hull " + res.hull + " score " + res.score); lastPhase = res.phase + res.seg; }
            if (shotDir && r === 0) {
                for (const k in shotsAt) if (Math.abs(t - Number(k)) < 0.01) { await page.evaluate(function () { TO_API.draw(); }); await page.screenshot({ path: path.join(shotDir, shotsAt[k] + ".png") }); }
                if (res.phase === "gate" && res.gate.indexOf("hold") === 0 && !gateShot[res.seg]) {
                    gateShot[res.seg] = true;
                    await page.evaluate(function () { for (let i = 0; i < 180; i++) { toAutopilot(); TO_API.step(1 / 60); } TO_API.draw(); });
                    t += 3;
                    await page.screenshot({ path: path.join(shotDir, "05-gate-seg" + res.seg + ".png") });
                }
                if ((res.phase === "orbit" && !gateShot.orbit && (gateShot.orbit = true)) || (res.phase === "dock" && !gateShot.dock && (gateShot.dock = true))) {
                    await page.evaluate(function () { for (let i = 0; i < 300; i++) { toAutopilot(); TO_API.step(1 / 60); } TO_API.draw(); });
                    t += 5;
                    await page.screenshot({ path: path.join(shotDir, "06-" + res.phase + ".png") });
                }
            }
            if (res.phase === "card") {
                done = true; anyCard = true;
                await page.evaluate(function () { for (let i = 0; i < 300; i++) TO_API.step(1 / 60); TO_API.draw(); });
                if (shotDir && r === 0) await page.screenshot({ path: path.join(shotDir, "07-card.png") });
                const st = await page.evaluate(function () { return { win: toWin, score: toScore, tally: toTally, hull: toM.hull, deaths: toP.deaths, why: toAfterWhy, rows: toCardRows }; });
                log.push(t.toFixed(1) + "s CARD " + JSON.stringify(st));
            }
        }
        console.log("--- run " + (r + 1) + (idle ? " (idle)" : "") + " ---\n" + log.join("\n"));
        if (!done) console.log("did not reach the card in " + t + " s");
    }
    if (errors.length) console.log("PAGE ERRORS:\n" + errors.slice(0, 10).join("\n"));
    await browser.close();
    process.exit(errors.length || !anyCard ? 1 : 0);
})();
