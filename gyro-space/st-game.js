// ===================================================
//   Space Tracer — scoring, multipliers, helpers
// ===================================================
// Split out of space-tracer.html's inline script 2026-09-04 (Pass A of
// gyro-space/ST_PASS_PLAN.md). Lines were MOVED VERBATIM and IN SOURCE ORDER --
// nothing was reordered, because this game's load-time statements are scattered
// through its sections rather than gathered at the end. Keeping the order is
// what makes the split safe.
//
// Classic scripts, one shared global scope, no modules (the file:// hard
// constraint). Declarations plus scoring state.
"use strict";

// ===================================================
//              SCORING
// ===================================================
// Score for a single life = (distance travelled, scaled) + (10 x seconds
// alive), all multiplied by a streak multiplier that increases +0.1x per
// consecutive kill (no death in between) and resets to 1.0x on death.
// The multiplier applies to the ENTIRE per-frame score rate once a
// streak is active -- not just to kill bonuses -- so a streak makes
// everything (distance, time, further kills) worth more while it lasts.
//
// This whole thing is tracked PER-LIFE and submitted once, on death --
// not continuously. That matches how the rest of the game already works
// (reportLifeEnded() at both death sites) and means only one Firestore
// write per death instead of one per frame.
//
// Distance is in raw world-units per frame (ship.speed is ~3 units/tick
// at 60fps, so a life can rack up tens of thousands of raw units -- far
// larger than the seconds-based time term, which tops out in the tens
// or low hundreds for a good life). DISTANCE_SCALE divides distance down
// into the same rough numeric range as the time term, so neither one
// trivially swamps the other in the combined total.
const DISTANCE_SCALE = 100;

// A kill (of a player) is worth roughly "30 seconds of ordinary
// non-kill play" as a flat bonus, awarded the instant the kill lands --
// BEFORE the current multiplier is applied to it (the multiplier then
// applies on top, same as it does to everything else). "30 seconds of
// ordinary play" = 30 seconds x the TIME_POINTS_PER_SECOND rate below
// (distance isn't part of this baseline since distance during those 30
// seconds is player-behavior-dependent, not a fixed rate).
const TIME_POINTS_PER_SECOND = 10;
const KILL_BONUS = TIME_POINTS_PER_SECOND * 30; // = 300
const ASTEROID_KILL_BONUS = KILL_BONUS / 20; // = 15, per your 1/20 spec

let lifeStartTime = Date.now();
let lifeStartX = 0;
let lifeStartY = 0;
let lifeDistance = 0;       // Raw world-units moved this life, accumulated each frame
let lifeKillStreak = 0;     // Consecutive kills this life, no death in between
let lifeScore = 0;          // Running total for the CURRENT life, in display units (not raw distance)
let bestLifeScore = 0;      // Session-local best, shown in the dev overlay for reference only

function currentMultiplier() {
    // 0 kills -> 1.0x, 1 kill -> 1.1x, 2 kills -> 1.2x, etc. Uncapped --
    // per your note, if this turns out overpowered at high streaks the
    // curve can be revisited later (e.g. capped, or diminishing per
    // kill), but starting linear and uncapped is the agreed starting point.
    return 1 + (lifeKillStreak * 0.1);
}

// Called every frame from updateShip(), but ONLY while alive and only
// when the ship actually moved (paused / not moving = no new distance,
// no new time-based score that frame -- this is what keeps sitting
// still from being a free way to rack up score, in solo or grouped play
// alike, without needing a separate solo-only rule).
function accumulateLiveScore(dtSeconds, distanceThisFrame) {
    lifeDistance += distanceThisFrame;

    const distanceComponent = (distanceThisFrame / DISTANCE_SCALE);
    const timeComponent = dtSeconds * TIME_POINTS_PER_SECOND;

    lifeScore += (distanceComponent + timeComponent) * currentMultiplier();

    updateBestScoreLive();
}

// Promotes the running life score into the session best the MOMENT it
// passes it, rather than waiting for death to notice. Without this, a
// life that is already the best of the session shows nothing on the
// scoreboard until it ends -- so the corner would sit there displaying a
// number you had already beaten, for both you and (via the relay below)
// everyone else in the room.
//
// bestLifeScore is kept as a rounded integer, which also means this only
// marks the scoreboard dirty when the DISPLAYED number would actually
// change, not on every fractional frame's worth of score.
function updateBestScoreLive() {
    const rounded = Math.round(lifeScore);
    if (rounded > bestLifeScore) {
        bestLifeScore = rounded;
        markScoreboardDirty();
    }
}

// Multiplier callout: large yellow text, top-center, appears/refreshes
// on increase, fades after 2s while remaining logically "active" (the
// multiplier itself doesn't reset when the text fades -- only the
// VISIBILITY fades; killStreak/currentMultiplier() keep applying to
// score in the background regardless of whether this is on screen).
const multiplierCalloutEl = document.getElementById("multiplierCallout");
let multiplierCalloutTimeout = null;

function showMultiplierCallout() {
    if (!multiplierCalloutEl) return;
    const mult = currentMultiplier();

    multiplierCalloutEl.textContent = `${mult.toFixed(1)}x`;
    multiplierCalloutEl.style.opacity = "1";

    // Re-triggering on every increase means a fast second kill restarts
    // the 2s clock rather than fighting an already-running fade-out.
    if (multiplierCalloutTimeout) clearTimeout(multiplierCalloutTimeout);
    multiplierCalloutTimeout = setTimeout(() => {
        multiplierCalloutEl.style.opacity = "0";
    }, 2000);
}

// Score display: current life's running score, top-right, always visible
// once the game has started (not just on death).
const scoreDisplayEl = document.getElementById("scoreDisplay");
function updateScoreDisplay() {
    if (!scoreDisplayEl) return;
    scoreDisplayEl.textContent = `SCORE: ${Math.round(lifeScore)}`;
}

// Called when THIS client's bullet is confirmed (by the server relay) to
// have killed another player. killType distinguishes player kills (full
// KILL_BONUS, extends the streak) from asteroid kills (does NOT extend
// the player-kill streak or affect the multiplier -- asteroids are a
// scoring bonus, not a "kill chain" in the combo sense described for
// player kills). sizeRatio is only used for asteroid kills -- see
// destroyAsteroid, which computes it as (this asteroid's size / average
// asteroid size) so an average-size asteroid is still worth almost
// exactly the original flat ASTEROID_KILL_BONUS, while small/large ones
// scale proportionally around that midpoint. Using a ratio rather than
// raw size directly avoids the largest asteroids (size 40) being worth
// roughly 2x a full player kill, which raw size * bonus would produce.
function creditKill(killType, sizeRatio = 1) {
    if (killType === "asteroid") {
        lifeScore += ASTEROID_KILL_BONUS * sizeRatio * currentMultiplier();
        updateBestScoreLive();
        return; // No streak change, no callout -- asteroid kills are a flat top-up, not a combo event
    }

    // Player kill: award bonus at the CURRENT multiplier (before
    // incrementing the streak), then increment the streak so the NEXT
    // thing scored (including this kill's own follow-on frames) benefits
    // from the new, higher multiplier.
    lifeScore += KILL_BONUS * currentMultiplier();
    lifeKillStreak += 1;
    showMultiplierCallout();
    updateScoreDisplay();
    updateBestScoreLive();
}

// Called once per death (both death sites: border collision, bullet
// hit). Finalizes the just-ended life's score, submits it (every life,
// not just personal bests -- per your direction, tracked and
// transmitted on death), relays it live to the room, and resets all
// per-life counters for the next spawn. Death does not penalize the
// score already earned -- it only resets the streak going forward,
// matching what you confirmed.
function reportLifeEnded() {
    const finalScore = Math.round(lifeScore);

    if (finalScore > bestLifeScore) {
        bestLifeScore = finalScore; // Session-local reference value only, shown in dev overlay
    }

    // Live relay to whoever else is in this room right now (display only).
    if (hasJoinedRoom) {
        // `best` is the session high, `score` is just this life. Both go
        // out because the receiver keeps the max -- sending only `score`
        // is what used to let a bad life visibly overwrite a good one on
        // everyone else's scoreboard.
        MP.send({ t: "score", score: finalScore, best: bestLifeScore });
    }

    // Persisted write, every life. Fire-and-forget, and genuinely optional.
    //
    // The typeof guard is load-bearing, not defensive noise: the Firebase
    // block in <head> is an ES module, and over file:// -- which this
    // project REQUIRES games to run under -- the browser refuses to load
    // it, so this global never comes into existence. Calling it bare (as
    // this line used to) threw a ReferenceError out of the middle of this
    // function on every single death, which silently skipped the score
    // relay and the per-life counter resets below it. typeof is the one
    // check that's safe against a never-declared identifier.
    if (typeof submitScoreToFirebase === "function") {
        submitScoreToFirebase(ship.name || "Anonymous", finalScore, currentRoomCode);
    }

    updateScoreboardDisplay();

    // Reset per-life counters. lifeStartTime/X/Y get set again on the
    // actual respawn (in updateShip's respawn branch) -- this reset here
    // covers the interval between death and respawn, so the displayed
    // score doesn't linger showing the dead life's number while waiting
    // to respawn.
    lifeScore = 0;
    lifeDistance = 0;
    lifeKillStreak = 0;
    updateScoreDisplay();
}

// Cancels an in-progress beam charge. Called on death so a player who
// was mid-charge when they died doesn't keep the charge ring on screen,
// keep the charge loop audible, or -- with the input gating added to
// mouseup -- get a free shot out of the release.
function cancelBeamCharge() {
    isChargingBeam = false;
    stopBeamChargeAudio();
}

// Puts dash back to its neutral, ready state. spaceHeld is cleared too,
// not just the dash timers: without that, a player who died holding
// SPACE would keep accumulating dashChargeDuration while dead and then
// dash the instant they respawned. The release handler checks spaceHeld,
// so clearing it here also makes the eventual keyup a no-op rather than a
// delayed dash.
function resetDashState() {
    spaceHeld = false;
    isDashing = false;
    dashChargeDuration = 0;
    dashTimeRemaining = 0;
    ship.speed = ship.baseSpeed;
    updateDashMeter();
}

// The single death transition for the local player. All three death
// sites (world border, asteroid impact, remote bullet hit) call this
// instead of repeating the same four lines -- which is exactly how the
// dash and beam-charge resets came to be missing from all three. Each
// site still owns its own explosion/cleanup specifics before calling
// this; everything common to "this life just ended" lives here.
function onLocalDeath() {
    ship.isAlive = false;
    ship.deathTime = Date.now();
    trail = []; // Clear trail immediately
    cancelBeamCharge();
    resetDashState();
    reportLifeEnded();
}

const scoreboardEl = document.getElementById("scoreboard");
const scoreboardListEl = document.getElementById("scoreboard-list");

// Best score per player now moves LIVE, which means the naive thing --
// rebuilding this panel's innerHTML from updateBestScoreLive() -- would
// rewrite the DOM several times a second all game. Instead callers mark
// it dirty and animate() renders at most every
// SCOREBOARD_RENDER_INTERVAL ms. Death still calls
// updateScoreboardDisplay() directly, so the final number of a life is
// never left waiting on a throttle window.
let scoreboardDirty = false;
let lastScoreboardRender = 0;
const SCOREBOARD_RENDER_INTERVAL = 200; // ms -- 5Hz, well under the rate best actually ticks up

function markScoreboardDirty() {
    scoreboardDirty = true;
}

// Renders roomScores (populated by the `best` field on incoming position
// updates, and by {t:"score"} death relays) plus this client's own
// best-this-session, sorted high to low.
function updateScoreboardDisplay() {
    if (!scoreboardEl) return;
    scoreboardEl.style.display = "block";
    scoreboardDirty = false;
    lastScoreboardRender = performance.now();

    const rows = Object.entries(roomScores).map(([name, score]) => ({ name, score, isMe: false }));

    // Own row is unconditional now (it used to be gated on bestLifeScore
    // > 0, so you were absent from your own scoreboard until you'd scored
    // something). It's the row the player looks for, so it should be
    // there from the first frame, at 0 if that's the honest number.
    const myLabel = ship.name || "You";
    const existingMine = rows.find(r => r.name === myLabel);
    if (existingMine) {
        existingMine.score = Math.max(existingMine.score, bestLifeScore);
        existingMine.isMe = true;
    } else {
        rows.push({ name: myLabel, score: bestLifeScore, isMe: true });
    }

    rows.sort((a, b) => b.score - a.score);

    scoreboardListEl.innerHTML = rows.length
        ? rows.map(r => r.isMe
            ? `<span style="color:${ship.color}; font-weight:bold;">${r.name}: ${r.score}</span>`
            : `${r.name}: ${r.score}`).join("<br>")
        : "—";
}

// One place that decides whether an incoming best is actually news. A
// stored best NEVER goes down -- both callers (live position updates and
// death relays) can legitimately deliver a number lower than what's
// already stored, since a player's later life can score less than an
// earlier one.
function recordRoomBest(key, value) {
    if (!key || typeof value !== "number" || !isFinite(value)) return;
    const previous = roomScores[key] || 0;
    if (value > previous) {
        roomScores[key] = value;
        markScoreboardDirty();
    }
}

// name -> score, for players currently in this room. Populated by
// {t:"score"} relays. Read by the scoreboard overlay above.
const roomScores = {};

function updateRemotePlayer(id, x, y, angle, color, shot, isAlive, name) {
    let p = remotePlayers[id];

    // Colour is server-assigned and normally arrives with the payload.
    // The peer record covers a position update that beats the join it
    // came with; the name hash is a last resort, so a missing colour can
    // never render an invisible ship. That last resort used to be
    // COLOR_PALETTE[0] -- always red, i.e. the wrong player's colour and
    // identical for every unknown ship. Hashing the name we were handed
    // yields the colour the server would have sent anyway.
    const known = (MP.peers() || []).find(function (q) { return q && q.id === id; });
    const playerColor = color || (known && known.color) || IDENTITY.colorFromName(name);

    if (!p) {
        remotePlayers[id] = { 
            x: x, 
            y: y, 
            targetX: x, 
            targetY: y, 
            angle: angle, 
            color: playerColor,
            trail: [],
            isAlive: isAlive !== false,  // Default to alive if not specified
            name: name || ""  // Now populated from the server's join-room record
        };
        console.log("Remote player created:", id, "isAlive:", isAlive);
    } else {
        p.targetX = x;
        p.targetY = y;
        p.angle = angle;
        p.color = playerColor;
        if (name) p.name = name;
        
        // Handle death state change
        if (isAlive === false && p.isAlive === true) {
            // Player just died - create explosion
            console.log("Remote player DIED:", id, "at", x, y);
            createExplosion(p.x, p.y, 15);
            p.trail = []; // Clear trail immediately
        }
        
        p.isAlive = isAlive !== false;
        
        // Only add to trail if alive
        if (isAlive !== false) {
            p.trail.push({ x: x, y: y });
            if (p.trail.length > 500) p.trail.shift();
        }
    }

    if (shot) {
        console.log("Remote shot received:", shot);
        // Fire remote shot - isLocalShot will be false (undefined = false).
        // ownerId is the shooter's own player id (the "id" parameter of
        // this function) -- this is what lets OUR client later recognize
        // "this specific bullet belongs to that specific remote player,"
        // which matters if it goes on to hit us: see the collision check
        // further down, where b.ownerId is read to know who to credit.
        fireLaser(shot.x, shot.y, shot.angle, playerColor, shot.type || "standard", id);
        // Clear isLocalShot flag on the last bullet (it's a remote shot)
        if (bullets.length > 0) {
            bullets[bullets.length - 1].isLocalShot = false;
        }
        playRemoteShotSound(shot.x, shot.y, shot.type || "standard");
    }
}

// ===================================================
//                   HELPERS
// ===================================================
function lerp(a,b,t){
    return a+(b-a)*t;
}

function wrapAngle(a){
    while(a>Math.PI) a-=Math.PI*2;
    while(a<-Math.PI) a+=Math.PI*2;
    return a;
}

