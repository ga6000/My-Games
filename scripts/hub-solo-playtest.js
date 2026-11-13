#!/usr/bin/env node
/*
 * One player, the two ways a lone player meets the hub (added 2026-11-13,
 * after a solo run of Zombie restarted itself instead of coming back to the
 * board):
 *
 *   ONLINE   alone in a room: first screen, story party, the keyboard picks
 *            Zombie, the run ends, the result card leads back to the board
 *            and its readout.
 *   OFFLINE  no game server at all: first screen, "play solo without it",
 *            Zombie, the run ends, the local score card leads back to the
 *            board.
 *
 *     node scripts/dev-serve.js 8123 &
 *     (cd ../gyro-space-server && PORT=8131 node server.js) &
 *     node scripts/hub-solo-playtest.js [--shots DIR]
 */
"use strict";
const { chromium } = require("playwright");

const WEB = process.env.WEB || "http://localhost:8123";
const WS = process.env.WS || "ws://localhost:8131";
const DEAD_WS = "ws://localhost:9";
const SHOTS = process.argv.includes("--shots") ? process.argv[process.argv.indexOf("--shots") + 1] : null;
const sleep = ms => new Promise(r => setTimeout(r, ms));

let fails = 0;
function ok(cond, what) {
    console.log((cond ? "PASS " : "FAIL ") + what);
    if (!cond) fails++;
}

async function open(browser, server, room) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on("pageerror", e => { console.log("PAGEERROR: " + e.message); fails++; });
    await page.goto(`${WEB}/index.html?server=${encodeURIComponent(server)}`);
    await page.fill("#identityNameInput", "Ry");
    await page.fill("#identityRoomInput", room);
    await page.click("#identityJoinBtn");
    await page.waitForSelector(".mode-screen", { timeout: 8000 });
    return page;
}

async function shot(page, name) {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/solo-${name}.png` });
}

async function intoZombieAndDie(page) {
    for (let t = 0; t < 100 && /index\.html/.test(page.url()); t++) await sleep(150);
    ok(/Zombie\.html/.test(page.url()) && /hub=1/.test(page.url()), "Zombie opens with hub=1");
    await page.waitForFunction(() => typeof gameStarted !== "undefined", null, { timeout: 15000 });
    // Through the title (if any) and the ready square.
    for (let i = 0; i < 12 && !(await page.evaluate(() => gameStarted && !zDemo)); i++) {
        await page.mouse.click(640, 360);
        await sleep(700);
    }
    ok(await page.evaluate(() => gameStarted && !zDemo), "the run starts");
    await sleep(2500);
    await page.evaluate(() => zPartyTestEnd());
    await page.waitForSelector("#partyCard", { timeout: 20000 });
}

(async () => {
    const browser = await chromium.launch();

    // ---------- ONLINE, alone ----------
    let page = await open(browser, WS, "SOLO" + (Date.now() % 10000));
    await page.keyboard.press("Enter");                 // the story card has the focus
    await page.waitForFunction(() => partySession && partySession.mode === "story");
    ok(true, "online: Enter on the first screen starts a story party");
    await page.keyboard.press("ArrowRight");            // the cursor appears on the open tile
    ok((await page.$eval(".tile.is-cursor", el => el.dataset.gameId)) === "zombie", "the keyboard cursor starts on the open chapter");
    await page.keyboard.press("Enter");
    await page.waitForSelector('.tile[data-game-id="zombie"].is-mine');
    await shot(page, "1-board");
    await page.keyboard.press("Enter");                 // Continue
    await intoZombieAndDie(page);
    await page.waitForFunction(() => document.querySelector("#partyCard table"), null, { timeout: 25000 });
    ok(/GAME 1 OF 3/.test(await page.textContent("#partyCard")), "online: the result card shows the round");
    await sleep(2500);
    await shot(page, "2-result");
    await page.click("#partyHubBtn");
    await page.waitForURL(/index\.html/);
    await page.waitForSelector("#partyOverlay .party-card", { timeout: 10000 });
    ok(/AFTER GAME 1 OF 3/.test(await page.textContent("#partyOverlay")), "online: back on the board with the readout");
    await sleep(2500);
    await shot(page, "3-readout");
    await page.keyboard.press("Enter");                 // PICK THE NEXT GAME
    await sleep(300);
    const open2 = await page.$$eval(".tile:not(.is-locked)", els => els.map(e => e.dataset.gameId));
    ok(open2.includes("four-d-pong") && open2.includes("zombie"), "the story moved on: open = " + open2.join(","));
    ok((await page.$$(".path-line.is-open")).length > 0, "the way forward is lit on the board");
    await shot(page, "4-board-next");
    await page.context().close();

    // ---------- OFFLINE ----------
    page = await open(browser, DEAD_WS, "OFF" + (Date.now() % 10000));
    await page.click('[data-party="local"]');
    ok(!(await page.$(".mode-screen")), "offline: play solo without the server closes the first screen");
    await page.click('.tile[data-game-id="zombie"]');
    await page.waitForSelector("#continueBtn:not([hidden])");
    ok(/SOLO/.test(await page.textContent("#continueBtn")), "offline: the button plays the pick solo");
    await page.click("#continueBtn");
    await intoZombieAndDie(page);
    const card = await page.textContent("#partyCard");
    ok(/YOUR SCORE/.test(card) && /GAME SELECT/.test(card) && /PLAY AGAIN/.test(card), "offline: the local score card offers the board or another go");
    await sleep(1500);
    await shot(page, "5-local-card");
    await page.click("#partyHubBtn");
    await page.waitForURL(/index\.html/);
    await page.waitForSelector(".tile", { timeout: 8000 });
    ok(!(await page.$(".mode-screen")), "offline: back on the board, not asked for the mode again");
    await page.context().close();

    await browser.close();
    console.log(fails ? fails + " FAILED" : "ALL PASSED");
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
