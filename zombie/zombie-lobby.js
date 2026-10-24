// ---------------------------------------------------
//   THE LOBBY: AN ATTRACT RUN AND A READY SCREEN (2026-10-13)
// ---------------------------------------------------
// "Add auto-play at the beginning before the screen is clicked. Make it a
// 'perfect' AI player on level 3 at 15 minutes with all abilities. Just make
// them survive instead of completing the objective." and "Instead of 'Click to
// start,' have a 'Players in party' ready screen, which has a blank square for
// each player in the party ... when players ready = total number of players
// in party, then start the game. Don't allow for players to move on in
// parties until everyone is ready. This checks the box of needing to have the
// player click to start audio."
//
// TWO THINGS, ONE FILE
//
//   THE ATTRACT RUN (`zDemo`). Before a run begins the world is map 3 on the
//   curve's 15:00 mark, and a scripted player with every gun and every perk at
//   x3 and the BOOMGUN on a cycle survives in it. It never dies: it is
//   untouchable and out of the objective, because its job is to be watched.
//   It runs the game's REAL update() on this client alone: for the length of
//   each step netOnline is false and this client is its own host, so nothing
//   it does reaches the room, and the rest of the time the game's own net
//   code sees an ordinary page that has not started. Sounds, toasts, the end
//   cards, the leaderboard and the cabinet's score are all muted for it
//   (zDemo is read in those places). Starting the real run is resetGame(), the
//   same full reset a restart does, so nothing of the demo survives into it.
//
//   THE READY SCREEN. One square per player in the party (MP.peers(), or one
//   if you are alone). A click (or Enter, Space) ticks yours in your colour and
//   tells the room (`ready` over relay); when every square is ticked everyone
//   starts, together. Nothing else works before that: no movement, no firing,
//   no gun keys. A click is also the browser's audio unlock, so the box that
//   used to be "click to start" is still ticked. A friend arriving after the
//   run began is not gated (there is nobody to wait for): CLICK TO JOIN.
//
// Off for the map editor and the stamp sandbox (they take the page over), for
// the headless harness (scripts/zombie-headless.js reports itself as "node"),
// and with ?nolobby=1.
// zDemo itself is declared in zombie-game.js so earlier files can read it.

const LOBBY_ON = (function () {
    try {
        const q = new URLSearchParams(window.location.search);
        if (q.get("editor") === "1" || q.get("sandbox") === "1" || q.get("nolobby") === "1") return false;
        if (/node/i.test(navigator.userAgent || "")) return false;
    } catch (e) { /* default: on */ }
    return ZOMBIE_ARCADE;
})();

const DEMO_MAP = 3;
const DEMO_CLOCK_S = 900;           // 15:00 on the curve
const DEMO_BOOM_EVERY_MS = 24000;
const LOBBY_GO_DELAY_MS = 650;      // the last tick is seen before it starts

let lobbyReady = {};                // peer id -> true
let lobbyRunLive = false;           // the room is already playing: join, do not wait
let lobbyGoAt = 0;                  // everyone is ready; start at this time
let lobbyBusy = false;              // we are inside our own resetGame()
let lobbySig = "";
let lobbyResendAt = 0;
let demoState = null;               // the AI's own memory

// ---------------------------------------------------
//   THE PARTY
// ---------------------------------------------------
// zombie-input.js supplies the real one ("CLICK" / "TAP" / "PRESS A").
function lobbyVerb() { return typeof inputVerb === "function" ? inputVerb() : "CLICK"; }

function lobbySelfKey() {
    return (typeof MP !== "undefined" && MP.selfId) ? MP.selfId : "solo";
}

// [{id, name, color, self}], everyone in the room, you included.
function lobbyParty() {
    const out = [];
    const selfKey = lobbySelfKey();
    const peers = (netOnline && MP.peers) ? MP.peers() : [];
    for (let i = 0; i < peers.length; i++) {
        const p = peers[i];
        out.push({ id: p.id, name: String(p.name || "PLAYER"), color: p.color || "#55FFFF", self: p.id === selfKey });
    }
    if (!out.some(function (m) { return m.self; })) {
        out.unshift({ id: selfKey, name: String(MP.selfName || "YOU"), color: MP.selfColor || P_COLORS[0], self: true });
    }
    return out;
}

function lobbyAllReady(party) {
    for (let i = 0; i < party.length; i++) if (!lobbyReady[party[i].id]) return false;
    return party.length > 0;
}

// Before a run, on the arcade page, with the lobby on.
function lobbyBlocks() {
    return LOBBY_ON && !gameStarted;
}

// ---------------------------------------------------
//   INPUT, from zombie-render.js
// ---------------------------------------------------
function lobbyClick() {
    initAudio();                                   // the click is the browser's audio unlock
    if (lobbyBusy || lobbyNaming) return;          // a name first (see below)
    if (lobbyRunLive) { lobbyBegin(); return; }    // joining a run in progress
    const me = lobbySelfKey();
    if (!lobbyReady[me]) {
        lobbyReady[me] = true;
        lobbySend();
        lobbySig = "";
    }
}

function lobbySend() {
    if (netOnline) MP.send({ k: "ready" });
}

// A teammate ticked (relay; `from` is their socket id).
function lobbyOnReady(from) {
    if (!from) return;
    lobbyReady[from] = true;
    lobbySig = "";
}

// From the net hooks: someone came or went. Anyone already ticked says so again.
function lobbyPeersChanged() {
    const keep = {};
    const party = lobbyParty();
    for (let i = 0; i < party.length; i++) if (lobbyReady[party[i].id]) keep[party[i].id] = true;
    lobbyReady = keep;
    if (lobbyReady[lobbySelfKey()]) lobbySend();
    lobbySig = "";
}

// From applyWorldSnapshot: the host is running a run and we have not started.
function lobbyRunSeen() {
    if (!LOBBY_ON || lobbyRunLive) return;
    lobbyRunLive = true;
    lobbySig = "";
}

// From generateLevel callers in zombie-net.js that run before a run starts:
// the map under the demo has just been rebuilt from another seed.
function lobbyLevelRebuilt() {
    if (!zDemo || lobbyBusy) return;
    // Its bodies stand in the old map. Re-seat the attract run on the new one
    // WITHOUT resetGame(): that fades up from black, which read as the demo
    // "not starting" for the 2-3s the room takes to hand over its seed.
    zombies = []; bullets = []; remoteBullets = []; pickups = []; blasts = []; decoys = [];
    arcTurrets = []; boomBolts = []; boomLocal = []; freezeZone = null;
    players.length = 0;
    demoStart(false);
}

// resetGame() ran (a restart, or our own begin): a fresh ready screen.
function lobbyOnReset() {
    if (!LOBBY_ON || lobbyBusy) return;
    lobbyReady = {};
    lobbyRunLive = false;
    lobbyGoAt = 0;
    lobbySig = "";
    demoStart(false);                 // resetGame() has just run
}

// ---------------------------------------------------
//   GOING
// ---------------------------------------------------
function lobbyBegin() {
    if (lobbyBusy) return;
    lobbyBusy = true;
    zDemo = false;
    demoState = null;
    try {
        document.body.classList.remove("demo");
        resetGame();                                 // the demo is gone, the map is map 1
        uiStart.style.display = 'none';
        lobbyReady = {};
        lobbyGoAt = 0;
        spawnPlayer();                               // -> startGame(): the flythrough, the clock, the score
    } finally {
        lobbyBusy = false;
    }
}

// ---------------------------------------------------
//   THE SCREEN
// ---------------------------------------------------
function lobbyRender(party, allReady) {
    const row = document.getElementById("lobbyRow");
    const head = document.getElementById("lobbyHead");
    const hint = document.getElementById("lobbyHint");
    if (!row || !hint) return;
    const meReady = !!lobbyReady[lobbySelfKey()];
    let n = 0;
    for (let i = 0; i < party.length; i++) if (lobbyReady[party[i].id]) n++;
    const sig = party.map(function (m) { return m.id + m.name + m.color + (lobbyReady[m.id] ? 1 : 0); }).join("|") +
                "#" + lobbyRunLive + meReady + allReady + lobbyVerb() + lobbyNaming;
    if (sig === lobbySig) return;
    lobbySig = sig;
    if (lobbyNaming) {
        head.textContent = "";
        row.innerHTML = "";
        hint.textContent = "";
        hint.className = "lb-hint";
        return;
    }
    if (lobbyRunLive) {
        head.textContent = "A RUN IS UNDER WAY";
        row.innerHTML = "";
        hint.textContent = lobbyVerb() + " TO JOIN";
        hint.className = "lb-hint blink";
        return;
    }
    head.textContent = "PLAYERS IN PARTY";
    let html = "";
    for (let i = 0; i < party.length; i++) {
        const m = party[i];
        const nm = m.name.replace(/[<>&"]/g, "").toUpperCase().slice(0, 10);
        html += "<div class='lb-slot'><div class='lb-box" + (lobbyReady[m.id] ? " ready" : "") + (m.self ? " self" : "") +
                "' style='--pc:" + m.color + "'></div><div class='lb-name'>" + nm + (m.self && nm !== "YOU" ? " (YOU)" : "") + "</div></div>";
    }
    row.innerHTML = html;
    if (allReady) { hint.textContent = "STARTING"; hint.className = "lb-hint"; }
    else if (meReady) { hint.textContent = "WAITING FOR PLAYERS  " + n + "/" + party.length; hint.className = "lb-hint"; }
    else { hint.textContent = lobbyVerb() + " TO READY"; hint.className = "lb-hint blink"; }
}

// Every frame, from the game loop, before the world draws.
function lobbyFrame(now) {
    if (!LOBBY_ON || gameStarted || lobbyBusy) return;
    uiStart.style.display = 'block';
    document.body.classList.toggle("demo", zDemo);      // hides the run's own readouts (see Zombie.html)
    const party = lobbyParty();
    const all = !lobbyRunLive && lobbyAllReady(party);
    lobbyRender(party, all);
    // Re-say it now and then: a message sent before a friend's page was
    // listening is simply gone, and this costs one tiny packet.
    if (lobbyReady[lobbySelfKey()] && netOnline && now - lobbyResendAt > 1500) {
        lobbyResendAt = now;
        lobbySend();
    }
    if (all) {
        if (!lobbyGoAt) lobbyGoAt = now + LOBBY_GO_DELAY_MS;
        else if (now >= lobbyGoAt) lobbyBegin();
    } else {
        lobbyGoAt = 0;
    }
}

// ---------------------------------------------------
//   A NAME FIRST (2026-10-24)
// ---------------------------------------------------
// The hub stores the player's name (gamehub_playerName) and every game reads
// it from there. A Home Screen install on iOS has its OWN empty storage, so
// opened that way Zombie had no name and every score went up as "Anonymous".
// With no name from the URL or storage, the ready screen asks for one first,
// stores it under the hub's key, and reloads: the room is joined with a name
// on connect (mp-core's join-room), so a reload is the one clean way to rejoin
// under it. It asks once per install, because the name is then stored.
let lobbyNaming = false;

function lobbyNeedsName() {
    if (!LOBBY_ON || typeof MP === "undefined" || !MP.identity) return false;
    return !MP.identity().name.trim();
}

function lobbyAskName() {
    lobbyNaming = true;
    const box = document.createElement("form");
    box.id = "nameEntry";
    box.innerHTML =
        "<label for='nameEntryInput'>ENTER YOUR NAME</label>" +
        "<input id='nameEntryInput' type='text' maxlength='20' autocomplete='off' autocapitalize='words' spellcheck='false' placeholder='e.g. Ry'>" +
        "<button type='submit'>OK</button>" +
        "<div class='ne-hint'>SHOWN ON THE LEADERBOARD</div>";
    document.body.appendChild(box);
    const input = box.querySelector("input");
    box.addEventListener("submit", function (e) {
        e.preventDefault();
        const name = input.value.replace(/\s+/g, " ").trim().slice(0, 20);
        if (!name) { input.focus(); return; }
        try { localStorage.setItem("gamehub_playerName", name); } catch (err) { /* blocked storage */ }
        // Storage refused it (private mode): carry it in the URL instead, which
        // mp-core reads first, so this run at least still has the name.
        let stored = "";
        try { stored = localStorage.getItem("gamehub_playerName") || ""; } catch (err) { /* blocked */ }
        if (stored === name) { window.location.reload(); return; }
        const u = new URL(window.location.href);
        u.searchParams.set("name", name);
        window.location.replace(u.href);
    }, { signal: zSignal() });
    try { input.focus(); } catch (e) { /* iOS only focuses on a tap */ }
}

// ---------------------------------------------------
//   THE ATTRACT RUN
// ---------------------------------------------------
// (Re)build the demo world. `fresh` = run resetGame() first; the caller that
// has just reset passes false.
function demoStart(fresh) {
    if (!LOBBY_ON) return;
    const wasBusy = lobbyBusy;
    lobbyBusy = true;
    try {
        if (fresh !== false) resetGame();
        zDemo = true;
        arcLevelNo = DEMO_MAP;
        arcL1Seconds = 0; arcL1Silos = 0;
        generateLevel();
        const now = Date.now();
        // The curve's 15:00 mark: T = played * pace + head start.
        const played = Math.max(0, (DEMO_CLOCK_S - arcClockOffsetS()) / arcPace());
        gameStarted = true;                          // spawnPlayer must not start a real run
        const p = spawnPlayer();
        arcadeStart(now);
        startTime = now - played * 1000;
        lastSpawnTime = now;
        arcIntroAt = 0;
        arcL2StartAt = 0;                            // no arrival lull: it has been going 15 minutes
        gameStarted = false;
        if (p) {
            p.x = WORLD_W / 2 - 8; p.y = WORLD_H / 2 + 120;
            p.owned = {};
            for (const k in WEAPONS) {
                p.owned[k] = true;
                if (k !== "pistol") p.ammo[k] = WEAPONS[k].capacity;
            }
            p.weapon = "rifle";
            p.cards = [];
            for (let i = 0; i < DROP_PERKS.length; i++) for (let s = 0; s < 3; s++) p.cards.push(DROP_PERKS[i]);
        }
        demoState = { step: 0, goal: null, goalUntil: 0, field: null, fieldKey: "", fieldAt: 0, boomAt: now + 6000, turretAt: now + 3000 };
    } finally {
        lobbyBusy = wasBusy;
    }
    uiStart.style.display = 'block';
}

// One simulation step of the attract run. Called from stepSimulation in place
// of update() while zDemo.
function demoUpdate(t, dt) {
    if (!zDemo) return;
    const saved = [netOnline, netIsHost, netLost];
    netOnline = false; netIsHost = true; netLost = false;     // alone, and its own host, for this step
    gameStarted = true;
    try {
        const p = players[0];
        if (p) demoDecide(p, demoState, t);
        update(t, dt);
    } catch (e) {
        // Never let the attract run take the page down: start it over.
        if (window.console) console.warn("attract run reset:", e);
        gameOver = true;
    } finally {
        gameStarted = false;
        netOnline = saved[0]; netIsHost = saved[1]; netLost = saved[2];
    }
    if (gameOver || won) { gameOver = false; won = false; demoStart(true); }
}

function demoGauss() { return 0; }              // perfect aim: no error to draw

function demoClearLine(x0, y0, x1, y1) {
    const d = Math.hypot(x1 - x0, y1 - y0);
    const n = Math.max(1, Math.ceil(d / 32));
    for (let i = 1; i < n; i++) {
        const k = i / n;
        if (bulletBlockedAt(x0 + (x1 - x0) * k - 4, y0 + (y1 - y0) * k - 4, 8)) return false;
    }
    return true;
}

// The survivor: stay among the open ground, keep clear of the crowd, shoot
// whatever is nearest and in the clear, switch to what the situation wants.
// It plays the arena, never the objective.
function demoDecide(p, st, now) {
    st.step++;
    const cx = p.x + p.size / 2, cy = p.y + p.size / 2;
    // Untouchable and always armed: the point is to be watched, not to be fair.
    p.invulnUntil = now + 600;
    p.downed = false;
    p.bleedDeadline = 0;
    if (st.step % 30 === 0) {
        for (const k in WEAPONS) if (k !== "pistol") p.ammo[k] = WEAPONS[k].capacity;
    }

    // ---- the crowd
    let nearest = null, nearestD = 1e9, rx = 0, ry = 0, close = 0;
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        const zx = z.x + z.size / 2, zy = z.y + z.size / 2;
        const dx = cx - zx, dy = cy - zy, d = Math.hypot(dx, dy) || 1;
        if (d < nearestD) { nearestD = d; nearest = z; }
        if (d < 210) {
            const w = 1 / (d * d) * (z.type === "supersplit" ? 2.5 : z.type === "brute" ? 1.6 : 1);
            rx += dx / d * w * 1e4;
            ry += dy / d * w * 1e4;
            close++;
        }
    }

    // ---- where to roam: a point round the middle of the map, a few seconds at a time
    if (!st.goal || now >= st.goalUntil || Math.hypot(cx - st.goal.x, cy - st.goal.y) < 100) {
        for (let tries = 0; tries < 12; tries++) {
            const gx = WORLD_W / 2 + (Math.random() - 0.5) * 2600, gy = WORLD_H / 2 + (Math.random() - 0.5) * 1300;
            if (!blockedAt(gx, gy, 20, false)) { st.goal = { x: gx, y: gy }; break; }
        }
        st.goalUntil = now + 4500;
        st.fieldKey = "";
    }
    const goal = st.goal || { x: cx, y: cy };

    // ---- heading: the map's own flow field to the goal, away from the crowd
    let tx = goal.x - cx, ty = goal.y - cy;
    const tl = Math.hypot(tx, ty);
    if (tl > 1) { tx /= tl; ty /= tl; }
    if (tl > 50) {
        const key = Math.round(goal.x / 40) + "," + Math.round(goal.y / 40);
        if (key !== st.fieldKey || st.step - st.fieldAt > 150) {
            st.field = navFieldFrom([{ x: goal.x, y: goal.y }], false);
            st.fieldKey = key;
            st.fieldAt = st.step;
        }
        const nx = st.field ? navStepToward(cx, cy, st.field, false) : null;
        if (nx) {
            const fx = nx.x - cx, fy = nx.y - cy, fl = Math.hypot(fx, fy) || 1;
            tx = fx / fl; ty = fy / fl;
        }
    }
    const rl = Math.hypot(rx, ry);
    let wantX = tx, wantY = ty;
    if (rl > 0) {
        const wr = Math.min(2.6, 0.6 + close * 0.35);
        wantX = tx + rx / rl * wr;
        wantY = ty + ry / rl * wr;
    }
    const wl = Math.hypot(wantX, wantY) || 1;
    wantX /= wl; wantY /= wl;

    // ---- a heading that is actually open, and clear of bodies
    let bestK = -1, bestScore = -1e9;
    for (let k = 0; k < 16; k++) {
        const a = k / 16 * Math.PI * 2, ux = Math.cos(a), uy = Math.sin(a);
        let open = 0;
        for (let s = 1; s <= 5; s++) {
            if (blockedAt(p.x + ux * s * 22, p.y + uy * s * 22, p.size, false)) break;
            open = s;
        }
        if (open < 2) continue;
        let crowd = 0;
        for (let i = 0; i < zombies.length && i < 120; i++) {
            const z = zombies[i];
            const ex = z.x - (p.x + ux * 80), ey = z.y - (p.y + uy * 80);
            if (ex * ex + ey * ey < 90 * 90) crowd++;
        }
        const score = (ux * wantX + uy * wantY) * 2 + open * 0.25 - crowd * 0.3;
        if (score > bestScore) { bestScore = score; bestK = k; }
    }
    p.keys.up = p.keys.down = p.keys.left = p.keys.right = false;
    if (bestK >= 0) {
        const a = bestK / 16 * Math.PI * 2;
        const ux = Math.cos(a), uy = Math.sin(a);
        if (ux > 0.38) p.keys.right = true;
        if (ux < -0.38) p.keys.left = true;
        if (uy > 0.38) p.keys.down = true;
        if (uy < -0.38) p.keys.up = true;
    }

    // ---- aim (no error) and fire at the nearest thing that is in the clear
    p.keys.shoot = false;
    let target = null, td = 1e9;
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        const zx = z.x + z.size / 2, zy = z.y + z.size / 2;
        const d = Math.hypot(zx - cx, zy - cy);
        if (d < td && d < 640 && demoClearLine(cx, cy, zx, zy)) { td = d; target = z; }
    }
    if (target) {
        const ax = target.x + target.size / 2, ay = target.y + target.size / 2;
        mouseX = ax; mouseY = ay;
        p.keys.shoot = true;
    } else if (nearest) {
        mouseX = nearest.x + nearest.size / 2; mouseY = nearest.y + nearest.size / 2;
    }

    // ---- the abilities
    if (now >= st.boomAt && now >= (p.boomUntil || 0)) {
        p.boomUntil = now + BOOM_MS;               // the Boomgun, on a cycle
        p.boomHeld = 0;
        st.boomAt = now + DEMO_BOOM_EVERY_MS;
    }
    if (close >= 4 && nearest && now >= st.turretAt && arcTurrets.length < 3) {
        st.turretAt = now + 7000;
        p.turretHeld = true;
        p.turretArmed = true;
        const a = Math.atan2(nearest.y - cy, nearest.x - cx);
        const mx = mouseX, my = mouseY;
        mouseX = cx + Math.cos(a) * 90; mouseY = cy + Math.sin(a) * 90;
        arcadePlaceTurret(p);
        mouseX = mx; mouseY = my;
    }
    // The gun for the moment: close and crowded, the spreaders; open, the long guns.
    const order = (close >= 2 || nearestD < 140)
        ? ["flamer", "shotgun", "smg", "rifle", "rocket", "pistol", "sniper"]
        : ["rocket", "sniper", "rifle", "smg", "shotgun", "flamer", "pistol"];
    for (let i = 0; i < order.length; i++) {
        if (WEAPONS[order[i]] && weaponUsable(p, order[i])) {
            if (p.weapon !== order[i]) p.weapon = order[i];
            break;
        }
    }
}

// ---------------------------------------------------
//   BOOT
// ---------------------------------------------------
if (LOBBY_ON) {
    uiStart.innerHTML =
        "<div id='lobbyHead' class='lb-head'>PLAYERS IN PARTY</div>" +
        "<div id='lobbyRow' class='lb-row'></div>" +
        "<div id='lobbyHint' class='lb-hint blink'>CLICK TO READY</div>";
    demoStart(false);          // the page has just built map 1; the demo replaces it
    if (lobbyNeedsName()) lobbyAskName();
}
