#!/usr/bin/env node
/**
 * party-session-playtest.js -- drives a whole party session in headless
 * browsers: two players on the hub, a session started, a game voted and
 * launched, the round reported, the standings read back on the hub.
 *
 * LOCAL TESTING ONLY. It needs two things running first:
 *
 *   node scripts/dev-serve.js 8123                    (this repo, over http)
 *   PORT=8131 node ../gyro-space-server/server.js     (the game server)
 *
 *   node scripts/party-session-playtest.js [game] [--shots DIR]
 *
 * `game` is four-d-pong (default), space-tracer or zombie. Each game's round
 * is ended through the game's own end-of-round path, forced from the page so
 * the test takes seconds rather than minutes; see END_ROUND below.
 *
 * Needs Playwright (dev machine or cloud session); it is not a dependency of
 * the repo and nothing shipped loads it.
 */
const { chromium } = require("playwright");

const args = process.argv.slice(2);
const GAME = args.find(a => !a.startsWith("--")) || "four-d-pong";
const SHOTS = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
const WEB = process.env.WEB || "http://127.0.0.1:8123";
const WS = process.env.WS || "ws://127.0.0.1:8131";
const ROOM = "T" + Date.now().toString(36).slice(-5).toUpperCase();

let fails = 0;
function ok(cond, label) { console.log((cond ? "PASS " : "FAIL ") + label); if (!cond) fails++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// How each game's round is brought to its real end from the test.
const END_ROUND = {
    "four-d-pong": async (host) => host.evaluate(() => { seats[0].goals = 3; seats[1].goals = 1; endMatch(0); sendSnapshot(true); }),
    "space-tracer": async (host, guest) => {
        await host.evaluate(() => stPartyForceEnd(4200));
        await guest.evaluate(() => stPartyForceEnd(1300));
    },
    "zombie": async (host) => host.evaluate(() => { zPartyTestEnd(); })
};

async function player(browser, name) {
    const ctx = await browser.newContext({ viewport: { width: 1280, height: 720 } });
    const page = await ctx.newPage();
    page.on("pageerror", e => { console.log("PAGEERROR " + name + ": " + e.message); fails++; });
    await page.goto(`${WEB}/index.html?server=${encodeURIComponent(WS)}`);
    await page.fill("#identityNameInput", name);
    await page.fill("#identityRoomInput", ROOM);
    await page.click("#identityJoinBtn");
    return page;
}

async function shot(page, name) {
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${GAME}-${name}.png` });
}

(async () => {
    const browser = await chromium.launch();
    const a = await player(browser, "Ann");
    const b = await player(browser, "Bob");
    await a.waitForSelector("#partyBtn:not([hidden])", { timeout: 8000 });
    ok(true, "PARTY button appears once the server offers sessions");

    await a.click("#partyBtn");
    await a.click('[data-party-total="3"]');
    await a.click('[data-party-mode="story"]');
    await shot(a, "1-setup");
    await a.click('[data-party="start"]');
    await b.waitForSelector("#partyBar:not([hidden])");
    ok((await b.textContent("#partyBar")).includes("GAME 1 OF 3"), "both see the session bar");

    // Story path: only the starting stack's party game is open at first.
    const locked = await a.$$eval(".tile.is-locked", els => els.map(e => e.dataset.gameId));
    ok(locked.includes("space-tracer") && locked.includes("four-d-pong") && !locked.includes("zombie"),
        "story start: zombie open, later chapters locked (" + locked.join(",") + ")");
    await a.click('.tile[data-game-id="space-tracer"]');
    await sleep(200);
    ok(!(await a.$('.tile[data-game-id="space-tracer"].is-mine')), "a locked tile takes no vote");
    await shot(a, "2-story-board");

    if (GAME !== "zombie") {
        // Free play for the other games: restart the session.
        await a.click('[data-party="end"]');
        await a.waitForSelector("#partyBtn:not([hidden])");
        await a.click("#partyBtn");
        await a.click('[data-party-mode="free"]');
        await a.click('[data-party="start"]');
        await b.waitForFunction(() => partySession && partySession.mode === "free");
    }

    for (const p of [a, b]) await p.click(`.tile[data-game-id="${GAME}"]`);
    await a.waitForSelector("#continueBtn:not([hidden]):not([disabled])");
    for (const p of [a, b]) await p.click("#continueBtn");
    await Promise.all([a, b].map(p => p.waitForURL(u => !/index\.html/.test(u.toString()), { timeout: 10000 })));
    ok(/party=1/.test(a.url()), "the game link carries party=1");

    for (const p of [a, b]) await p.waitForFunction(() => typeof PARTY !== "undefined" && PARTY.active(), null, { timeout: 15000 });
    ok(true, "both games joined the session");
    ok(!(await a.$("#bfIntro")), "title card skipped inside a session");
    await a.waitForSelector("#bfBorder", { timeout: 10000 });
    await sleep(600);
    await shot(a, "3-ready-border");

    // Ready check: both tick.
    if (await a.$("#bfReady")) {
        await a.click("#bfReady");
        await sleep(300);
        ok(!!(await a.$("#bfReady")), "one tick does not start a two-player round");
        await b.click("#bfReady");
        await Promise.all([a, b].map(p => p.waitForSelector("#bfReady", { state: "detached", timeout: 8000 })));
        ok(true, "everyone ticked: the round starts");
    } else {
        // Zombie keeps its own ready squares (the model the shared one copies).
        for (const p of [a, b]) await p.mouse.click(640, 360);
    }
    await sleep(5000);
    await shot(a, "4-playing");
    ok(!(await a.$("#bfBorder")), "the border is gone once play is live");

    const hostIsA = await a.evaluate(() => MP.isHost());
    const host = hostIsA ? a : b, guest = hostIsA ? b : a;
    await END_ROUND[GAME](host, guest);

    for (const p of [a, b]) await p.waitForFunction(() => document.querySelector("#partyCard table"), null, { timeout: 25000 });
    const card = await a.textContent("#partyCard");
    ok(/GAME 1 OF 3/.test(card) && /STANDINGS/.test(card), "result card shows the round and the standings");
    await shot(a, "5-result-card");

    await Promise.all([a, b].map(async p => { await p.click("#partyHubBtn"); await p.waitForURL(/index\.html/); }));
    for (const p of [a, b]) await p.waitForSelector("#partyOverlay:not([hidden])", { timeout: 10000 });
    const readout = await a.textContent("#partyOverlay");
    ok(/AFTER GAME 1 OF 3/.test(readout), "hub shows the readout between games");
    const pts = await a.evaluate(() => partySession.standings.map(r => r.name + ":" + r.points).join(" "));
    ok(/:1[02]/.test(pts), "standings carry placement points (" + pts + ")");
    await shot(a, "6-hub-readout");
    await a.click('[data-party="dismiss"]');
    ok((await a.textContent("#partyBar")).includes("GAME 2 OF 3"), "session bar moves on to game 2");
    await shot(a, "7-hub-next");

    await browser.close();
    console.log(fails ? fails + " FAILED" : "ALL PASSED");
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
