#!/usr/bin/env node
/**
 * party-server-test.js -- the party session protocol, against a running
 * game server, with plain sockets (no browser).
 *
 * LOCAL TESTING ONLY. Start the server first, then point this at its folder
 * (for the `ws` module) and its port:
 *
 *   PORT=8131 node ../gyro-space-server/server.js
 *   node scripts/party-server-test.js ../gyro-space-server 8131
 *
 * Covers: the session outliving the empty hub room, ranking and ties, the
 * clear bonus, a late joiner, a player who drops mid-round, the final
 * winner, and a cancelled launch. Never run it against the live server: it
 * starts and ends sessions.
 */
const path = require("path");
const WebSocket = require(path.join(process.argv[2], "node_modules", "ws"));
const URL = "ws://127.0.0.1:" + process.argv[3];
const sleep = ms => new Promise(r => setTimeout(r, ms));
let fails = 0;
function ok(cond, label) { console.log((cond ? "PASS " : "FAIL ") + label); if (!cond) fails++; }
function client(game, room, name) {
    return new Promise(res => {
        const ws = new WebSocket(URL);
        const c = { ws, msgs: [], session: undefined, send: o => ws.send(JSON.stringify(o)), close: () => ws.close(),
            last: t => c.msgs.filter(m => m.type === t).pop() };
        ws.on("message", m => { const d = JSON.parse(m); c.msgs.push(d); if (d.type === "session") c.session = d.session; });
        ws.on("open", () => { c.send({ type: "join-room", game, room, name }); setTimeout(() => res(c), 150); });
    });
}
async function launch(hubs, gameId) {
    for (const h of hubs) h.send({ type: "vote-update", gameId, voted: true });
    await sleep(100);
    for (const h of hubs) h.send({ type: "ready-update", ready: true, gameId });
    await sleep(3300);
    ok(hubs[0].last("launch") && hubs[0].last("launch").gameId === gameId, "launch " + gameId);
    for (const h of hubs) h.close();
    await sleep(100);
}
(async () => {
    const R = "T" + Date.now().toString(36).slice(-5).toUpperCase();
    let a = await client("_hub", R, "Ann"), b = await client("_hub", R, "Bob"), c = await client("_hub", R, "Cy");
    ok(a.session === null, "hub gets an empty session snapshot");
    a.send({ type: "session-start", mode: "story", total: 2 });
    await sleep(150);
    ok(b.session && b.session.total === 2 && b.session.standings.length === 3, "session starts with 3 players");
    await launch([a, b, c], "zombie");

    // round 1: all three in zombie; Bob wins, group clears
    let ga = await client("zombie", R, "Ann"), gb = await client("zombie", R, "Bob"), gc = await client("zombie", R, "Cy");
    ok(ga.session && ga.session.current && ga.session.current.gameId === "zombie", "game gets the session, hub room gone");
    ga.send({ type: "session-report", score: 1000, final: false });
    ga.send({ type: "session-report", score: 12000, cleared: true, final: true });
    gb.send({ type: "session-report", score: 20000, cleared: true, final: true });
    await sleep(150);
    ok(ga.session.rounds.length === 0, "round waits for Cy");
    gc.send({ type: "session-report", score: 12000, cleared: true, final: true });
    await sleep(150);
    const r1 = ga.session.rounds[0];
    ok(r1 && r1.cleared && r1.results[0].name === "Bob" && r1.results[0].points === 10, "Bob first, 10");
    ok(r1 && r1.results[1].place === 2 && r1.results[2].place === 2 && r1.results[2].points === 7, "tie shares second");
    ok(r1 && r1.results[0].bonus === 2, "clear bonus");
    ok(ga.session.current === null && !ga.session.done, "between games");
    ga.close(); gb.close(); gc.close(); await sleep(150);

    // back to hub; Dee joins late
    a = await client("_hub", R, "Ann"); b = await client("_hub", R, "Bob"); c = await client("_hub", R, "Cy");
    const d = await client("_hub", R, "Dee");
    ok(d.session && d.session.rounds.length === 1, "session survived the empty hub");
    ok(d.session.standings.find(x => x.name === "Dee").points === 0, "late joiner at zero");
    ok(a.session.standings[0].name === "Bob" && a.session.standings[0].points === 12, "standings 12");
    // Dee stays behind on the hub; the other three launch without her...
    d.close(); await sleep(100);
    await launch([a, b, c], "space-tracer");

    // round 2: Cy leaves mid-game with a live score, Dee never reports but leaves
    ga = await client("space-tracer", R, "Ann"); gb = await client("space-tracer", R, "Bob");
    gc = await client("space-tracer", R, "Cy");
    ga.send({ type: "session-report", score: 4000, final: false }); await sleep(100);
    // ...and she follows late, through the hub, on her own launch. The round
    // in flight must survive that.
    const d2 = await client("_hub", R, "Dee");
    ok(d2.session.current && d2.session.current.gameId === "space-tracer", "late joiner's hub sees the game in flight");
    await launch([d2], "space-tracer");
    const gd = await client("space-tracer", R, "Dee");
    ok(gd.session && gd.session.current && gd.session.rounds.length === 1, "late joiner lands in the same round");
    gc.send({ type: "session-report", score: 900, final: false }); await sleep(100); gc.close();
    ga.send({ type: "session-report", score: 5000, final: true });
    gb.send({ type: "session-report", score: 300, final: true });
    await sleep(150);
    ok(ga.session.rounds.length === 1, "round waits for Dee, who is still in the room");
    gd.close(); await sleep(200);
    const s = ga.session;
    ok(s.rounds.length === 2 && s.done, "session done after 2");
    const r2 = s.rounds[1];
    ok(r2.results.map(x => x.name).join() === "Ann,Cy,Bob,Dee", "order Ann,Cy,Bob,Dee: " + r2.results.map(x => x.name + ":" + x.score).join(" "));
    ok(r2.results[3].points === 3 && r2.results[0].bonus === 0, "4th gets 3, no bonus");
    ok(s.winners.join() === "Ann", "Ann wins 9+10=19 vs Bob 12+5=17: " + s.standings.map(x => x.name + ":" + x.points).join(" "));
    ga.close(); gb.close(); await sleep(150);

    a = await client("_hub", R, "Ann");
    ok(a.session && a.session.done, "final readout available on the hub");
    a.send({ type: "session-end" }); await sleep(150);
    ok(a.session === null, "session ends");
    // cancel path: start, launch, cancel -> no stuck round
    a.send({ type: "session-start", mode: "free", total: 3 }); await sleep(100);
    a.send({ type: "vote-update", gameId: "zombie", voted: true }); await sleep(50);
    a.send({ type: "ready-update", ready: true, gameId: "zombie" }); await sleep(200);
    a.send({ type: "ready-update", ready: false, gameId: "zombie" }); await sleep(200);
    ok(a.session && a.session.current === null, "cancelled launch leaves no round open");
    a.close();
    console.log(fails ? fails + " FAILED" : "ALL PASSED");
    process.exit(fails ? 1 : 0);
})();
