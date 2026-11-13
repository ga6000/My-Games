// ===================================================
//   Space Tracer — hub party session, score toasts, boot flow
// ===================================================
// Added 2026-11-13 (HUB_1_0_PLAN.md Phase 7). This game's side of the three
// shared modules, in one file:
//
//   shared/hubscore.js  kills and asteroids float their points off the ship
//   shared/party.js     a round clock, and the round's score at the end
//   shared/bootflow.js  LOAD / TITLE, an attract run, the READY border
//
// THE ROUND. Space Tracer has no end: you fly until you die, respawn, and
// fly again. A party round therefore runs on a clock, ST_ROUND_MS from the
// hub's launch (the server's clock, so every screen and a late joiner stop
// together). The round's score is the BEST single life, which is what the
// in-game scoreboard has always ranked.
//
// LATE JOINERS. The arena is drop-in, as it always was: someone who arrives
// mid-round flies at once and gets whatever time is left on the clock.
//
// THE HUB SCALE (st-game.js): a ship kill is 1,000 and an asteroid 100, both
// times the streak multiplier; time and distance still trickle in.
"use strict";

const ST_ROUND_MS = 180000;     // 3:00 of play
const ST_GRACE_MS = 20000;      // loading and the ready press, before the clock

let stDemo = false;             // the attract run: this client flying itself, off the network
let stDemoAngle = 0;
let stDemoShotAt = 0;
let stAsteroidsSeeded = false;
let stRoundOver = false;
let stClockEl = null;

// ---- toasts ----
// The ship is pinned to the centre of the screen (the world moves), so that
// is where its points appear.
function stToast(points) {
    if (typeof HUBSCORE === "undefined" || stDemo) return;
    const pts = HUBSCORE.snap(points);
    if (pts <= 0) return;
    const r = canvas.getBoundingClientRect();
    HUBSCORE.toast(
        r.left + r.width / 2 + (Math.random() - 0.5) * 90,
        r.top + r.height / 2 - 46 - Math.random() * 24,
        pts, { color: ship.color });
}

// ---- the attract run ----
// The real updateShip / updateAsteroids / updateTrail, steered by a pointer
// that circles the screen centre. Nothing is sent and nothing is scored:
// hasJoinedRoom is still false, and reportLifeEnded() skips the board.
function stDemoStart() {
    if (stDemo || gameStarted) return;
    stDemo = true;
    if (!stAsteroidsSeeded) { stAsteroidsSeeded = true; seedAsteroidField(); }
    startScreenContainer.style.background = "transparent";
    camera.zoom = ZOOM_SETTINGS.desktop;
}

function stDemoStop() {
    if (!stDemo) return;
    stDemo = false;
    startScreenContainer.style.background = "#000";
    ship.x = 0; ship.y = 0; ship.angle = 0; ship.isAlive = true;
    trail = [];
    lifeScore = 0;
    bestLifeScore = 0;
    lifeDistance = 0;
    lifeKillStreak = 0;
    cancelBeamCharge();
    resetDashState();
}

function stDemoStep(dt, now) {
    stDemoAngle += dt * 0.55;
    mouse.x = centerX + Math.cos(stDemoAngle) * 220;
    mouse.y = centerY + Math.sin(stDemoAngle * 1.7) * 160;
    updateShip(dt);
    updateAsteroids(dt);
    updateTrail(dt);
    if (ship.isAlive && now - stDemoShotAt > 700) {
        stDemoShotAt = now;
        fireLaser(ship.x, ship.y, ship.angle, ship.color, "standard", myPlayerId);
    }
}

// ---- LOAD -> TITLE -> ATTRACT -> READY ----
function stBootIntro() {
    if (typeof BOOTFLOW === "undefined") return;       // the old title screen still works alone
    screenTitle.style.display = "none";
    BOOTFLOW.intro({
        title: "SPACE TRACER",
        chapter: "ACT V · COUNTERATTACK",
        tagline: "THE FIRST FIGHTS IN ORBIT. YOUR TRAIL IS YOUR WEAPON."
    }, function (how) {
        // The attract run plays behind the ready check whichever way the
        // title ended, so the screen under the border is never just black.
        stDemoStart();
        BOOTFLOW.ready({
            // Drop-in arena: there is nobody to wait for, so the check is
            // this player alone. It is still the one place the game says
            // "not live yet", and its press is the browser's audio unlock.
            players: function () {
                return [{ id: "me", name: playerName || "YOU", color: ship.color, self: true }];
            },
            label: "DEMO · NOT LIVE · PRESS TO LAUNCH",
            onStart: function () {
                stDemoStop();
                afterTitle();
                // Arrived from the hub with a name: straight in.
                if (cameFromHub) enterGameBtn.click();
            }
        });
    });
}

// ---- the party round ----
function stClock(leftMs) {
    if (!stClockEl) {
        stClockEl = document.createElement("div");
        stClockEl.id = "stPartyClock";
        stClockEl.style.cssText = "position:absolute;top:38px;left:50%;transform:translateX(-50%);z-index:20;" +
            "font-family:'Press Start 2P','VT323',monospace;font-size:16px;color:#FFB000;text-shadow:2px 2px 0 #000;pointer-events:none";
        document.body.appendChild(stClockEl);
    }
    const s = Math.ceil(Math.min(leftMs, ST_ROUND_MS) / 1000);
    const text = "TIME " + Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
    if (stClockEl.textContent !== text) stClockEl.textContent = text;
    stClockEl.style.color = s <= 10 ? "#FF2E88" : "#FFB000";
}

function stPartyEnd(score) {
    if (stRoundOver) return;
    stRoundOver = true;
    // Down for good: updateShip's respawn test never passes.
    ship.isAlive = false;
    ship.deathTime = Infinity;
    cancelBeamCharge();
    resetDashState();
    const final = (typeof HUBSCORE !== "undefined") ? HUBSCORE.snap(score) : Math.round(score);
    PARTY.finish({ score: final, cleared: false, game: "space-tracer" });
}

// Once a frame, from animate().
function stPartyTick() {
    if (!gameStarted) return;
    // The score strip, in place of the old "SCORE: n" box: this life's
    // score on the hub scale, and the best on this machine.
    if (typeof HUBSCORE !== "undefined" && HUBSCORE.hud) {
        if (scoreDisplayEl) scoreDisplayEl.style.display = "none";
        HUBSCORE.hud({ game: "space-tracer", score: HUBSCORE.snap(Math.max(0, lifeScore)), color: ship.color,
                       label: typeof PARTY !== "undefined" ? PARTY.label() : "" });
    }
    if (typeof PARTY === "undefined" || stRoundOver) return;
    // A round on the clock: a session's round, or any game the hub opened.
    if (!PARTY.wanted()) return;
    const left = PARTY.timeLeft(ST_ROUND_MS, ST_GRACE_MS);
    if (left === null) return;
    stClock(left);
    if (PARTY.active()) PARTY.live(bestLifeScore);
    if (left <= 0) stPartyEnd(Math.max(bestLifeScore, Math.round(lifeScore)));
}

// For scripts/party-session-playtest.js: end the round now with this score.
function stPartyForceEnd(score) {
    bestLifeScore = score;
    stPartyEnd(score);
}

stBootIntro();
