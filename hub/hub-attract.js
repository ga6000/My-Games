// ===================================================
//   Hub — attract mode and audio
// ===================================================
// AESTHETIC_GUIDE.md §4.8, which calls attract mode "the most era-defining
// behaviour in the document": every cabinet, left alone, played itself. For the
// hub it asks for idle → cycle marquees.
//
// Added 2026-09-04 (Pass B of hub/HUB_PASS_PLAN.md). Declarations only — the
// listeners and the tick driver are started from hub-boot.js, which is the one
// file allowed to execute anything.
"use strict";

const ATTRACT_IDLE_MS = 20000;

// The tick driver runs at 500ms; the highlight advances every 3rd tick (1.5s),
// which is a readable pace for reading a tile title.
const ATTRACT_POLL_MS = 500;
const ATTRACT_STEP_TICKS = 3;

let hubAttract = null;
let attractTicks = 0;
let attractIndex = 0;

/*
 * WHY THIS IS SUPPRESSED MORE OFTEN THAN IT RUNS
 *
 * A board that starts cycling tiles underneath a group mid-vote is a bug
 * wearing an idiom's clothes. Attract mode is for an unattended screen, so it
 * is held off whenever the screen is plainly attended:
 *
 *   - a launch countdown is running (the screen is about to change anyway)
 *   - the identity overlay is open (someone is literally typing)
 *   - anyone else is in the room (a group is looking at this, and "idle" for
 *     one cursor does not mean idle for five people)
 *
 * Suppression pokes the controller rather than pausing it, so the idle clock
 * keeps resetting and it can never enter mid-suppression and then reveal
 * itself the moment the condition clears.
 */
function attractSuppressed() {
    if (isLaunching) return true;
    if (countdownOverlay && !countdownOverlay.hidden) return true;
    if (identityOverlay && !identityOverlay.hidden) return true;
    if (Object.keys(roomMembers).length > 1) return true;
    return false;
}

function attractClear() {
    tileGrid.querySelectorAll(".tile.attract-on").forEach(function (el) {
        el.classList.remove("attract-on");
    });
}

function attractAdvance() {
    const tiles = tileGrid.querySelectorAll(".tile:not(.tile-empty)");
    attractClear();
    if (!tiles.length) return;
    attractIndex = attractIndex % tiles.length;
    tiles[attractIndex].classList.add("attract-on");
    attractIndex++;
}

/*
 * Started from hub-boot.js.
 *
 * RETRO.attract() opens NO timer of its own and REFUSES to attach listeners
 * without an AbortSignal — so it gets `hubSignal`, the hub's single controller,
 * and destroy() keeps tearing everything down through one path. The hub is DOM
 * rather than canvas and owns no render loop, so tick() is driven by
 * trackInterval — the hub's own tracked-timer helper, which is what keeps this
 * inside the root CLAUDE.md teardown rule rather than beside it.
 */
function startAttract() {
    if (typeof RETRO === "undefined") return;

    hubAttract = RETRO.attract({
        idleMs: ATTRACT_IDLE_MS,
        signal: hubSignal,
        onEnter: function () {
            attractIndex = 0;
            attractTicks = 0;
            attractAdvance();
        },
        onExit: attractClear
    });

    trackInterval(function () {
        if (attractSuppressed()) { hubAttract.poke(); return; }
        hubAttract.tick();
        if (!hubAttract.isActive()) return;
        attractTicks++;
        if (attractTicks % ATTRACT_STEP_TICKS === 0) attractAdvance();
    }, ATTRACT_POLL_MS);
}

// renderTiles() rebuilds the grid, which throws away the highlight. Re-apply it
// rather than waiting up to 1.5s for the next step, or the cycle visibly
// stutters every time the board repaints.
function attractRepaint() {
    if (!hubAttract || !hubAttract.isActive()) return;
    if (attractIndex > 0) attractIndex--;
    attractAdvance();
}

/*
 * AUDIO — §4.10, via shared/sfx.js.
 *
 * Deliberately sparse. The hub is a lobby people sit in while deciding, not a
 * game; a sound on every hover would be unbearable within a minute. Two events
 * only, both of which mark a decision:
 *
 *   - a vote is cast          -> blip
 *   - the winning game CHANGES -> rising triad (the same "you got it" shape
 *                                 every game uses, per §4.10)
 *
 * Silent until the first click, which is browser policy rather than a choice.
 */
function startHubAudio() {
    if (typeof SFX === "undefined") return;
    SFX.configure({ game: "hub" });
    SFX.unlockOn(window, hubSignal);
}

function hubSoundVote() {
    if (typeof SFX !== "undefined") SFX.blip(760);
}

let soundedLeader = null;

function hubSoundLeader(leader) {
    if (typeof SFX === "undefined") return;
    // Only on a real change, and never for the initial null -> null settle.
    if (leader === soundedLeader) return;
    const had = soundedLeader;
    soundedLeader = leader;
    if (leader && had !== null) SFX.pickup();
}
