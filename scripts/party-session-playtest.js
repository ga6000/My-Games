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
 *   node scripts/party-session-playtest.js --full [--shots DIR]
 *
 * `--full` plays a whole three-game STORY session (Zombie, 4D Pong, Space
 * Tracer, in story order) and checks the path gating and the final readout.
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
const FULL = args.includes("--full");
const SHOTS = args.includes("--shots") ? args[args.indexOf("--shots") + 1] : null;
const WEB = process.env.WEB || "http://127.0.0.1:8123";
const WS = process.env.WS || "ws://127.0.0.1:8131";
const ROOM = "T" + Date.now().toString(36).slice(-5).toUpperCase();

let fails = 0;
function ok(cond, label) { console.log((cond ? "PASS " : "FAIL ") + label); if (!cond) fails++; }
const sleep = ms => new Promise(r => setTimeout(r, ms));

// How each game's round is brought to its real end from the test.
const STORY = FULL || GAME === "zombie";

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
    if (SHOTS) await page.screenshot({ path: `${SHOTS}/${FULL ? "full" : GAME}-${name}.png` });
}

async function playRound(a, b, game, n, last) {
    // A story party counts "GAME n OF 3"; free play is open-ended.
    const OF = STORY ? " OF 3" : "";
    for (const p of [a, b]) await p.click(`.tile[data-game-id="${game}"]`);
    await a.waitForSelector("#continueBtn:not([hidden]):not([disabled])");
    for (const p of [a, b]) await p.click("#continueBtn");
    // Polled, not waitForURL: Space Tracer's page never reaches "load" in a
    // sandbox that cannot fetch the Firebase SDK.
    for (let t = 0; t < 100 && [a, b].some(p => /index\.html/.test(p.url())); t++) await sleep(150);
    ok(/party=1/.test(a.url()) && /hub=1/.test(a.url()), "the game link carries party=1 and hub=1");

    await a.waitForSelector("#bfBorder", { timeout: 15000 });
    ok(!(await a.$("#bfIntro")), "title card skipped inside a session");
    await sleep(600);
    await shot(a, n + "-3-ready-border");

    if (game === "space-tracer") {
        // Drop-in arena: each player's ready check is their own, and the
        // game only joins the room once they are through it.
        for (const p of [a, b]) await p.click("#bfReady");
    } else if (game === "four-d-pong") {
        await a.click("#bfReady");
        await sleep(300);
        ok(!!(await a.$("#bfReady")), "one tick does not start a two-player round");
        await b.click("#bfReady");
        await Promise.all([a, b].map(p => p.waitForSelector("#bfReady", { state: "detached", timeout: 8000 })));
        ok(true, "everyone ticked: the round starts");
    } else {
        // Zombie keeps its own ready squares (the model the shared one copies).
        await sleep(1500);
        await a.mouse.click(640, 360);
        await sleep(400);
        ok(await a.evaluate(() => !gameStarted), "one tick does not start a two-player round");
        await b.mouse.click(640, 360);
        for (const p of [a, b]) await p.waitForFunction(() => gameStarted && !zDemo, null, { timeout: 10000 });
        ok(true, "everyone ticked: the round starts");
    }
    for (const p of [a, b]) await p.waitForFunction(() => typeof PARTY !== "undefined" && PARTY.active(), null, { timeout: 15000 });
    ok(true, "both games joined the session");
    await sleep(5000);
    await shot(a, n + "-4-playing");
    ok(!(await a.$("#bfBorder")), "the border is gone once play is live");

    const hostIsA = await a.evaluate(() => MP.isHost());
    const host = hostIsA ? a : b, guest = hostIsA ? b : a;
    await END_ROUND[game](host, guest);

    for (const p of [a, b]) await p.waitForFunction(() => document.querySelector("#partyCard table"), null, { timeout: 25000 });
    const card = await a.textContent("#partyCard");
    ok(new RegExp(last ? "FINAL GAME" : "GAME " + n + OF).test(card) && /STANDINGS/.test(card), "result card shows the round and the standings");
    await shot(a, n + "-5-result-card");

    await Promise.all([a, b].map(async p => { await p.click("#partyHubBtn"); await p.waitForURL(/index\.html/); }));
    for (const p of [a, b]) await p.waitForSelector("#partyOverlay:not([hidden])", { timeout: 10000 });
    if (last) {
        const fin = await a.textContent("#partyOverlay");
        ok(/SESSION OVER/.test(fin) && /WINS|SHARE THE WIN/.test(fin), "hub shows the final readout and a winner");
        await shot(a, n + "-final");
        return;
    }
    const readout = await a.textContent("#partyOverlay");
    ok(new RegExp("AFTER GAME " + n + OF).test(readout), "hub shows the readout after game " + n);
    const pts = await a.evaluate(() => partySession.standings.map(r => r.name + ":" + r.points).join(" "));
    ok(/:\d+/.test(pts), "standings carry placement points (" + pts + ")");
    await shot(a, n + "-hub-readout");
    for (const p of [a, b]) await p.click('[data-party="dismiss"]');
    ok((await a.textContent("#partyBar")).includes("GAME " + (n + 1) + OF), "session bar moves on to game " + (n + 1));
    await shot(a, n + "-hub-next");
}

(async () => {
    const browser = await chromium.launch();
    const a = await player(browser, "Ann");
    const b = await player(browser, "Bob");
    // The first screen: story party or free play.
    await a.waitForSelector(".mode-screen", { timeout: 8000 });
    await b.waitForSelector(".mode-screen", { timeout: 8000 });
    ok(true, "the first screen asks for story party or free play");
    await shot(a, "1-mode");

    await a.click('[data-party-total="3"]');
    await a.click('[data-mode-pick="story"] h3');
    for (const p of [a, b]) await p.waitForFunction(() => partySession && partySession.mode === "story");
    ok(!(await b.$(".mode-screen")), "one pick starts the session for the whole room");
    ok((await b.textContent("#partyBar")).includes("GAME 1 OF 3"), "both see the session strip");

    // Story path: only the first playable chapter is open at the start.
    const locked = await a.$$eval(".tile.is-locked", els => els.map(e => e.dataset.gameId));
    ok(locked.includes("space-tracer") && locked.includes("four-d-pong") && locked.includes("gyro-fleet") && !locked.includes("zombie"),
        "story start: zombie open, later chapters locked (" + locked.join(",") + ")");
    ok((await a.$$(".act-col")).length === 5 && (await a.$$(".path-line")).length > 8, "five act columns with paths drawn between them");
    await a.click('.tile[data-game-id="space-tracer"]');
    await sleep(200);
    ok(!(await a.$('.tile[data-game-id="space-tracer"].is-mine')), "a locked tile takes no vote");
    await shot(a, "2-story-board");

    if (!STORY) {
        // Free play for the other games: back to the first screen.
        await a.click('[data-party="end"]');
        await b.waitForSelector(".mode-screen");
        await a.click('[data-mode-pick="free"] h3');
        await b.waitForFunction(() => partySession && partySession.mode === "free" && partySession.total === 0);
        const lockedFree = await a.$$eval(".tile.is-locked", els => els.map(e => e.dataset.gameId));
        ok(!lockedFree.includes("rd-arena") && lockedFree.includes("gyro-fleet"), "free play: every built game open, unbuilt ones dark");
    }

    if (FULL) {
        // The whole story path, start to finish: three chapters in order.
        const order = ["zombie", "four-d-pong", "space-tracer"];
        for (let i = 0; i < order.length; i++) {
            if (i > 0) {
                const open = await a.$$eval(".tile:not(.is-locked)", els => els.map(e => e.dataset.gameId));
                ok(open.includes(order[i]) && !open.includes(order[i - 2] || "none"),
                    "story path after " + order[i - 1] + ": open = " + open.join(","));
            }
            await playRound(a, b, order[i], i + 1, i === order.length - 1);
        }
    } else {
        await playRound(a, b, GAME, 1, false);
    }

    await browser.close();
    console.log(fails ? fails + " FAILED" : "ALL PASSED");
    process.exit(fails ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
