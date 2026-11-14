// ============================================================
// RD Arena — score, and the hub session (added 2026-11-13)
// ============================================================
// RD Arena had no score and no end: shared kills, endless rounds. Ry asked
// for a score so it counts on the hub. This is the smallest honest one, and
// it is PERSONAL, so a co-op arena still ranks the people in it:
//
//     +10   per point of damage you deal        (HUBSCORE.TIER.CHIP)
//     +1000 per round the arena gets through    (TIER.OBJECTIVE, shared)
//     -500  each time you are rendered
//
// Damage, not kills: enemies are host-authoritative, so a client never
// learns who landed a killing blow, but every weapon on every client goes
// through Entity.hit(), which is where rdScoreHit() is called from.
//
// OPENED FROM THE HUB (`hub=1`) the arena is a 3 minute run (RD_ROUND_MS)
// that ends in the session's result card. Opened directly it is the
// endless arena it always was; the score still counts up in the strip.
//
// NOT TUNED. Nobody has played a scored round. The three numbers above and
// the round length are first guesses.
//
// Classic script in RD Arena's shared global scope. Declarations only.
"use strict";

const RD_ROUND_MS = 180000;
const RD_PTS_DAMAGE = 10;
const RD_PTS_ROUND = 1000;
const RD_PTS_DEATH = 500;

let rdScore = 0;
let rdRemoteHit = false;        // true while the host applies a guest's hit
let rdPartyDone = false;
let rdRoundSeen = 1;

function rdScoreHit(dmg) {
    if (rdRemoteHit || rdPartyDone) return;
    rdScore += RD_PTS_DAMAGE * Math.max(1, Math.round(Number(dmg) || 1));
}

function rdScoreDeath() {
    if (!rdPartyDone) rdScore = Math.max(0, rdScore - RD_PTS_DEATH);
}

function rdClock(ms) {
    const s = Math.ceil(ms / 1000);
    return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

// Once a frame, from loop().
function rdPartyTick() {
    if (rdPartyDone) return;
    if (round > rdRoundSeen) { rdScore += RD_PTS_ROUND * (round - rdRoundSeen); rdRoundSeen = round; }
    if (typeof HUBSCORE === "undefined" || typeof PARTY === "undefined") return;

    const timed = PARTY.wanted();
    const left = timed ? PARTY.timeLeft(RD_ROUND_MS) : null;
    const label = [PARTY.label(), left === null ? "" : rdClock(left)].filter(Boolean).join(" · ");
    HUBSCORE.hud({ game: "rd-arena", score: rdScore, label: label });
    if (!timed) return;

    PARTY.live(rdScore);
    if (left !== null && left <= 0) {
        rdPartyDone = true;
        PARTY.finish({ score: HUBSCORE.snap(rdScore), cleared: true, game: "rd-arena" });
    }
}
