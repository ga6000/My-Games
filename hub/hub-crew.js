// ===================================================
//   Hub — the crew on the board: character select, tokens that walk,
//   the splash, the chapter card, the podium, the gamepad, the hum
// ===================================================
// Added 2026-11-13 (Ry: "treating the hub more as an overworld"). The hub
// used to be a menu the party looked AT. Now the party is ON it:
//
//   splash            The Tide in the thunderhead, CLICK TO START
//   mode select       story or free play                (hub-party.js)
//   character select  six crew, one holder each, everyone in the room visible
//   the board         each member stands on the party's tile as their
//                     character; an unpicked member is the grey figure
//   setting out       after the count, the party WALKS to the chosen tile,
//                     a chapter card names it, then the game opens
//   the podium        the final screen: characters standing, not portraits
//
// The server holds who plays whom (gyro-space-server "THE CREW"): a role
// has one holder while there are roles to go round, and a late joiner is
// dealt one nobody holds. This file only draws it and sends the pick.
//
// Classic script in the hub's shared global scope; loads after
// hub-party.js. Declarations only; hub-boot.js starts the clocks.
"use strict";

const CREW_GRID_COLS = 3;
const WALK_STEP_MS = 80;
const WALK_MAX_MS = 1700;
const CHAPTER_CARD_MS = 1700;

let crewFocus = 0;              // which card the keyboard is on
let crewLocalRole = "";         // playing without the server
let crewLocalPicked = false;
let crewLocalAt = "";           // offline: the tile the last game was on
let crewWalking = false;
let crewWalkTimer = null;
let crewDepartTimer = null;
let crewTokenBase = null;       // {x, y} of the first token, grid coordinates
let splashUp = true;

try {
    crewLocalRole = localStorage.getItem("gamehub_role") || "";
    crewLocalPicked = sessionStorage.getItem("gamehub_rolePicked") === "1" && CREW.has(crewLocalRole);
    crewLocalAt = sessionStorage.getItem("gamehub_localAt") || "";
    splashUp = sessionStorage.getItem("gamehub_splashSeen") !== "1";
} catch (e) { /* asked again */ }

const tokenLayer = document.getElementById("tokenLayer");
const chapterCard = document.getElementById("chapterCard");
const splashOverlay = document.getElementById("splashOverlay");
const soundBtn = document.getElementById("soundBtn");


// ---------------------------------------------------
//   WHO PLAYS WHOM
// ---------------------------------------------------
function crewRoleOf(name) {
    if (!partySession) return "";
    const row = partySession.standings.find(r => r.name === name);
    return row && row.role ? row.role : "";
}

function crewMyRole() {
    if (partySession) return crewRoleOf(myName);
    return crewLocalPicked ? crewLocalRole : "";
}

function crewOffline() {
    return !partySession && partyLocalMode && !lobbyOnline();
}

// Character select comes after mode select: a session exists (or the
// player chose to play without the server) and this player has no role.
function crewScreenUp() {
    if (!myName || !identityOverlay.hidden || splashUp) return false;
    if (partyOverlayMode || partyModeScreenUp()) return false;
    if (partyActive()) return !crewRoleOf(myName);
    return crewOffline() && !crewLocalPicked;
}

// Everyone the board shows a token for.
function crewMembers() {
    if (partySession) {
        return partySession.standings
            .map(r => ({ name: r.name, color: r.color, role: r.role || "" }))
            .sort((a, b) => (a.name === myName ? -1 : b.name === myName ? 1 : a.name.localeCompare(b.name)));
    }
    if (!myName) return [];
    return [{
        name: myName,
        color: (roomMembers[myName] && roomMembers[myName].color) || getColorFromName(myName),
        role: crewMyRole()
    }];
}

// The tile the party stands on: the game it last set out for.
function crewAtId() {
    if (partySession) return partySession.at || partyLastGameId() || "";
    return crewLocalAt;
}

function crewPick(role) {
    if (!CREW.has(role)) return;
    if (partyActive()) {
        const holder = partySession.standings.find(r => r.role === role && r.name !== myName);
        if (holder && partySession.standings.length <= CREW.KEYS.length) { hubSoundDeny(); return; }
        partySend({ type: "session-role", role: role });
    } else {
        crewLocalRole = role;
        crewLocalPicked = true;
        try {
            localStorage.setItem("gamehub_role", role);
            sessionStorage.setItem("gamehub_rolePicked", "1");
        } catch (e) { /* asked again next visit */ }
        renderParty();
        renderTokens();
    }
    hubSoundPick();
}


// ---------------------------------------------------
//   DRAWING THE FIGURES
// ---------------------------------------------------
// Every figure on the page is a <canvas data-crew="role">, repainted on the
// art clock (hub-art.js), so a breath or a step is one stepped frame for
// all of them at once.
function crewFig(role, cls, pose) {
    return `<canvas class="crew-fig ${cls || ""}" width="${CREW.W}" height="${CREW.H}" data-crew="${escapeAttr(role || "generic")}"${pose ? ` data-pose="${pose}"` : ""}></canvas>`;
}

function crewRepaint() {
    document.querySelectorAll("canvas[data-crew]").forEach(cv => {
        const c = cv.getContext("2d");
        if (!c) return;
        c.clearRect(0, 0, CREW.W, CREW.H);
        const walk = cv.dataset.pose === "walk";
        CREW.draw(c, cv.dataset.crew, 0, 0, 1, {
            pose: walk ? "walk" : "idle",
            frame: walk ? crewWalkFrame : artFrame + (Number(cv.dataset.phase) || 0),
            flip: cv.dataset.flip === "1"
        });
    });
}

let crewWalkFrame = 0;


// ---------------------------------------------------
//   CHARACTER SELECT
// ---------------------------------------------------
function renderCrewScreen() {
    const members = crewMembers();
    const cards = CREW.KEYS.map((role, i) => {
        const info = CREW.INFO[role];
        const holder = partySession ? members.find(m => m.role === role) : null;
        const mine = holder && holder.name === myName;
        const taken = holder && !mine;
        return `<div class="crew-card${i === crewFocus ? " is-focus" : ""}${taken ? " is-taken" : ""}${mine ? " is-mine" : ""}" role="button" tabindex="0" data-crew-pick="${role}">` +
            crewFig(role, "crew-big") +
            `<h3>${info.name}</h3><div class="crew-title">${info.title}</div>` +
            `<p>${info.line}</p>` +
            (holder ? `<div class="crew-holder">${partyDot(holder.color)}${escapeHtml(holder.name)}</div>` : '<div class="crew-holder">&nbsp;</div>') +
            "</div>";
    }).join("");

    // Presence: the people in the room who have not picked yet.
    const choosing = members.filter(m => !m.role && m.name !== myName);
    const foot = choosing.length
        ? choosing.map(m => `<span class="crew-wait">${crewFig("generic", "crew-small")}${partyDot(m.color)}${escapeHtml(m.name)}</span>`).join("")
        : "";

    return '<div class="mode-screen crew-screen">' +
        "<h2>WHO ARE YOU</h2>" +
        `<div class="crew-cards">${cards}</div>` +
        `<div class="mode-foot">${foot}</div>` +
        "</div>";
}

function crewKey(e) {
    const n = CREW.KEYS.length;
    if (e.key === "ArrowLeft") crewFocus = (crewFocus + n - 1) % n;
    else if (e.key === "ArrowRight") crewFocus = (crewFocus + 1) % n;
    else if (e.key === "ArrowUp" || e.key === "ArrowDown") crewFocus = (crewFocus + CREW_GRID_COLS) % n;
    else if (e.key === "Enter" || e.key === " ") { crewPick(CREW.KEYS[crewFocus]); return true; }
    hubSoundMove();
    renderPartyOverlay();
    return true;
}


// ---------------------------------------------------
//   TOKENS ON THE BOARD
// ---------------------------------------------------
function crewTokenScale() {
    const first = tileGrid.querySelector(".tile");
    if (!first) return 2;
    const h = first.getBoundingClientRect().height;
    return h < 110 ? 1 : h < 230 ? 2 : 3;
}

// Where the first token stands for a tile, in the grid's own coordinates:
// the tile's bottom-left corner, just above the name plate. With no tile
// yet (nothing played), the party waits on the story's first tile.
function crewAnchor(gameId, scale) {
    const box = tileGrid.getBoundingClientRect();
    if (!box.width) return null;
    const figH = CREW.H * scale;
    if (gameId) {
        const el = tileGrid.querySelector('.tile[data-game-id="' + gameId + '"]');
        if (!el) return null;
        const r = el.getBoundingClientRect();
        const plate = el.querySelector(".tile-plate");
        const floor = plate ? plate.getBoundingClientRect().top : r.bottom;
        return { x: r.left - box.left + 6, y: floor - box.top - figH - 2 };
    }
    // Nothing played yet: the party stands where the story starts.
    return STORY_START[0] ? crewAnchor(STORY_START[0], scale) : null;
}

function crewPlaceTokens(base, scale) {
    const step = Math.round(CREW.W * scale * 0.62);
    tokenLayer.querySelectorAll(".crew-token").forEach((el, i) => {
        el.style.left = Math.round(base.x + i * step) + "px";
        el.style.top = Math.round(base.y + (i % 2) * scale * 2) + "px";
    });
}

function renderTokens() {
    if (!tokenLayer || crewWalking) return;
    const members = myName && identityOverlay.hidden ? crewMembers() : [];
    const scale = crewTokenScale();
    const base = members.length ? crewAnchor(crewAtId(), scale) : null;
    if (!base) { tokenLayer.innerHTML = ""; crewTokenBase = null; return; }

    const sig = members.map(m => m.name + ":" + m.role + ":" + m.color).join("|") + "@" + scale;
    if (tokenLayer.dataset.sig !== sig) {
        tokenLayer.dataset.sig = sig;
        tokenLayer.innerHTML = members.map((m, i) =>
            `<span class="crew-token${m.name === myName ? " is-you" : ""}" title="${escapeAttr(m.name)}" ` +
            `style="--c:${escapeAttr(m.color)};width:${CREW.W * scale}px;z-index:${10 - i}">` +
            crewFig(m.role, "", "").replace("<canvas ", `<canvas data-phase="${i * 2}" `) + "</span>"
        ).join("");
        crewRepaint();
    }
    crewTokenBase = base;
    crewPlaceTokens(base, scale);
}

// The party walks from where it stands to `gameId`, then `done` runs.
// Right angles, like the paths: along, then up or down, then along.
function crewWalkTo(gameId, done) {
    const still = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (pageOfGame(gameId) !== currentPage) { crewTokenBase = null; setPage(pageOfGame(gameId)); }
    const scale = crewTokenScale();
    const to = tokenLayer ? crewAnchor(gameId, scale) : null;
    if (!to || still || !tokenLayer.querySelector(".crew-token")) {
        crewNoteAt(gameId);
        renderTokens();
        done();
        return;
    }
    const from = crewTokenBase || { x: -CREW.W * scale * 3, y: to.y };
    const points = [from];
    if (Math.abs(from.x - to.x) > 8) {
        const mx = to.x > from.x ? to.x - 20 : from.x - 20;
        points.push({ x: mx, y: from.y }, { x: mx, y: to.y });
    }
    points.push(to);

    let total = 0;
    for (let i = 1; i < points.length; i++) total += Math.abs(points[i].x - points[i - 1].x) + Math.abs(points[i].y - points[i - 1].y);
    const stride = Math.max(9, total / (WALK_MAX_MS / WALK_STEP_MS));

    crewWalking = true;
    tokenLayer.querySelectorAll("canvas").forEach(cv => { cv.dataset.pose = "walk"; });
    let leg = 1;
    const at = { x: from.x, y: from.y };

    crewWalkTimer = trackInterval(() => {
        let left = stride;
        while (left > 0 && leg < points.length) {
            const p = points[leg];
            const dx = p.x - at.x, dy = p.y - at.y;
            const d = Math.abs(dx) + Math.abs(dy);
            if (d <= left) { at.x = p.x; at.y = p.y; left -= d; leg++; }
            else { at.x += Math.sign(dx) * Math.min(Math.abs(dx), left); at.y += Math.sign(dy) * Math.min(Math.abs(dy), dx ? 0 : left); left = 0; }
        }
        const goingLeft = leg < points.length && points[leg].x < at.x;
        tokenLayer.querySelectorAll("canvas").forEach(cv => { cv.dataset.flip = goingLeft ? "1" : "0"; });
        crewWalkFrame++;
        if (crewWalkFrame % 2 === 0) hubSoundStep();
        crewPlaceTokens(at, scale);
        crewRepaint();

        if (leg >= points.length) {
            clearTracked(crewWalkTimer);
            crewWalkTimer = null;
            crewWalking = false;
            crewTokenBase = to;
            crewNoteAt(gameId);
            tokenLayer.querySelectorAll("canvas").forEach(cv => { cv.dataset.pose = ""; cv.dataset.flip = "0"; });
            crewRepaint();
            done();
        }
    }, WALK_STEP_MS);
}

function crewNoteAt(gameId) {
    if (partySession) { partySession.at = gameId; return; }
    crewLocalAt = gameId;
    try { sessionStorage.setItem("gamehub_localAt", gameId); } catch (e) { /* the party starts over next visit */ }
}


// ---------------------------------------------------
//   SETTING OUT: walk, chapter card, game
// ---------------------------------------------------
function chapterCardShow(game, done) {
    const act = ACTS.find(a => a.n === game.act);
    chapterCard.innerHTML =
        `<div class="chap-kicker">${act ? "ACT " + act.numeral + " · " + escapeHtml(act.name) : ""}</div>` +
        `<canvas class="chap-art" width="${ART_W}" height="${ART_H}" data-art="${escapeAttr(game.id)}"></canvas>` +
        `<h2>${escapeHtml(game.title)}</h2>` +
        `<p>${escapeHtml(game.desc)}</p>`;
    chapterCard.hidden = false;
    artRepaint();
    hubSoundChapter();
    crewDepartTimer = trackTimeout(done, CHAPTER_CARD_MS);
}

function launchDepart(game) {
    countdownOverlay.hidden = true;
    isLaunching = true;
    crewWalkTo(game.id, () => {
        chapterCardShow(game, () => { window.location.href = gameHref(game); });
    });
}

function departCancel() {
    if (crewWalkTimer) { clearTracked(crewWalkTimer); crewWalkTimer = null; }
    if (crewDepartTimer) { clearTracked(crewDepartTimer); crewDepartTimer = null; }
    const was = crewWalking;
    crewWalking = false;
    if (chapterCard) chapterCard.hidden = true;
    if (was) { tokenLayer.dataset.sig = ""; renderTokens(); }
}


// ---------------------------------------------------
//   THE PODIUM
// ---------------------------------------------------
// The final screen. First in the middle and highest, second on the left,
// third on the right; anyone after that stands on the floor beside them.
function crewPodiumHtml() {
    const rows = partySession.standings;
    const order = [1, 0, 2].filter(i => rows[i]).map(i => rows[i]).concat(rows.slice(3));
    return '<div class="podium">' + order.map(r => {
        const step = r.place <= 3 ? " p" + r.place : " p4";
        return `<div class="podium-spot${step}${r.name === myName ? " is-you" : ""}">` +
            crewFig(r.role, "crew-podium") +
            `<div class="podium-block"><b>${partyOrdinal(r.place)}</b></div>` +
            `<div class="podium-name">${partyDot(r.color)}${escapeHtml(r.name)}</div>` +
            `<div class="podium-pts">${r.points} PTS</div></div>`;
    }).join("") + "</div>";
}


// ---------------------------------------------------
//   THE SPLASH
// ---------------------------------------------------
// The Tide in the thunderhead (Ry, 2026-11-13: "final image can be splash
// for the hub with low white text (click to start)"). 192 x 108, the same
// language as the marquee scenes at twice the resolution: flat fills,
// stepped motion, the breath clock. Lightning is what shows the shape.
const SPLASH_W = 192;
const SPLASH_H = 108;

function splashPaint() {
    const cv = splashOverlay ? splashOverlay.querySelector("canvas") : null;
    const c = cv ? cv.getContext("2d") : null;
    if (!c) return;
    const beat = artFrame % 34;
    const flash = beat === 0 || beat === 1 || beat === 4 || beat === 19;
    const b = artBreath();

    c.fillStyle = flash ? "#0E1614" : "#000000";
    c.fillRect(0, 0, SPLASH_W, SPLASH_H);

    // The sea and the coast, far below.
    artBox(c, 0, 92, SPLASH_W, 16, flash ? "#0C1A1E" : "#04090A");
    artBox(c, 0, 92, SPLASH_W, 1, flash ? ART_INK.mid : ART_INK.dim);
    for (let i = 0; i < 26; i++) {
        const x = 96 + Math.round(artRand(i) * 92), y = 89 + Math.round(artRand(i + 40) * 2);
        if ((artFrame + i) % 9 !== 0) artBox(c, x, y, 1, 1, ART_INK.amber);
        if (i % 3 === 0) artBox(c, x, 94 + (i % 4) * 3, 1, 2, "#5A3E00");
    }
    artBox(c, 92, 90, 100, 2, ART_INK.deep);

    // The shape inside the cloud: two lobes the size of a state.
    // Back-lit: in the flash the cloud goes bright and the Tide stays dark,
    // a silhouette with a lit rim. Between flashes it is barely there.
    const body = flash ? "#3A1420" : "#12080B";
    const edge = flash ? ART_INK.lung : "#1E0D12";
    const ry = 24 + b * 2, rx = 30 + b * 2;
    artOval(c, 66, 40, rx + 2, ry + 2, edge);
    artOval(c, 126, 40, rx + 2, ry + 2, edge);
    artOval(c, 66, 40, rx, ry, body);
    artOval(c, 126, 40, rx, ry, body);
    artBox(c, 92, 14, 8, 30, edge);
    if (flash) {
        for (let i = 0; i < 9; i++) {
            artBox(c, 44 + i * 5, 30 + (i % 3) * 7, 1, 10 + (i % 4) * 4, "#1E0A10");
            artBox(c, 108 + i * 5, 28 + (i % 3) * 8, 1, 9 + (i % 4) * 4, "#1E0A10");
        }
    }
    // Tendrils down to the water.
    for (let i = 0; i < 14; i++) {
        const tx = 40 + i * 9 + Math.round(artRand(i + 7) * 4);
        const len = 22 + Math.round(artRand(i + 90) * 16);
        for (let k = 0; k < len; k += 2) {
            const sway = Math.round(Math.sin((artFrame + k + i * 4) * 0.35) * (k / len) * 2);
            artBox(c, tx + sway, 60 + k, 1, 2, flash ? ART_INK.lungDark : "#1A0C10");
        }
    }

    // The thunderhead over it: stacked banks that hide all but the middle.
    const cloudA = flash ? "#3E4E48" : "#0C1210";
    const cloudB = flash ? "#5E7068" : "#141A17";
    for (let i = 0; i < 12; i++) {
        artOval(c, i * 18 + (i % 2) * 5, 8 + (i % 3) * 3, 16, 9, cloudA);
        artOval(c, i * 18 + 8, 64 + (i % 3) * 2, 15, 6, i % 2 ? cloudA : cloudB);
    }
    for (let i = 0; i < 7; i++) {
        artOval(c, -6 + i * 4, 22 + i * 6, 20 - i, 9, cloudB);
        artOval(c, SPLASH_W + 6 - i * 4, 22 + i * 6, 20 - i, 9, cloudB);
    }
    // Rags of cloud across the lobes, so it is never seen whole.
    [[52, 24, 22, 5], [118, 20, 26, 5], [84, 34, 18, 4], [140, 48, 20, 5], [46, 52, 24, 5], [96, 56, 22, 4]].forEach((r, i) =>
        artOval(c, r[0] + (Math.floor(artFrame / 6) % 3) - 1, r[1], r[2], r[3], i % 2 ? cloudA : cloudB));

    // The bolt.
    if (beat === 0 || beat === 19) {
        let x = beat === 0 ? 150 : 38, y = 62;
        while (y < 92) {
            const dx = Math.round((artRand(x + y + beat) - 0.5) * 8);
            artBox(c, Math.min(x, x + dx), y, Math.abs(dx) + 1, 1, ART_INK.hot);
            x += dx;
            artBox(c, x, y, 1, 4, ART_INK.hot);
            y += 4;
        }
    }
}

function splashDismiss() {
    if (!splashUp) return;
    splashUp = false;
    try { sessionStorage.setItem("gamehub_splashSeen", "1"); } catch (e) { /* shown again */ }
    splashOverlay.hidden = true;
    hubSoundPick();
    hubHumStart();
    if (!identityOverlay.hidden) { try { identityNameInput.focus(); } catch (e) { /* not focusable */ } }
    renderAll();
}


// ---------------------------------------------------
//   SOUND
// ---------------------------------------------------
// Short stepped tones through shared/sfx.js, and a hum: two low notes a
// breath apart, the invasion's own rhythm, quiet enough to talk over.
function hubTone(opts) {
    if (typeof SFX !== "undefined" && SFX.tone) { try { SFX.tone(opts); } catch (e) { /* silent */ } }
}
function hubSoundMove() { hubTone({ freq: 520, dur: 0.025, type: "square", gain: 0.1 }); }
function hubSoundPick() { if (typeof SFX !== "undefined") SFX.sequence([392, 523.25, 783.99], { type: "square", step: 0.07, dur: 0.06, gain: 0.16 }); }
function hubSoundDeny() { hubTone({ freq: 140, slideTo: 90, dur: 0.12, type: "square", gain: 0.16 }); }
function hubSoundStep() { hubTone({ freq: 90, dur: 0.03, type: "triangle", gain: 0.22 }); }
function hubSoundChapter() { if (typeof SFX !== "undefined") SFX.sequence([146.83, 174.61, 220, 293.66], { type: "sawtooth", step: 0.16, dur: 0.22, gain: 0.14 }); }

let hubHumOn = false;
let hubHumBeat = 0;

function hubHumStart() {
    if (hubHumOn) return;
    hubHumOn = true;
    // D minor, slow: in on the low note, out on the one above it.
    const line = [73.42, 0, 87.31, 0, 73.42, 0, 69.3, 0];
    trackInterval(() => {
        if (document.hidden || isLaunching) return;
        const f = line[hubHumBeat % line.length];
        hubHumBeat++;
        if (f) hubTone({ freq: f, slideTo: f * 0.985, dur: 1.5, type: "triangle", gain: 0.07 });
        if (hubHumBeat % 16 === 7) hubTone({ freq: 587.33, dur: 0.5, type: "sine", gain: 0.03 });
    }, 1100);
}

function soundBtnPaint() {
    if (!soundBtn || typeof SFX === "undefined") return;
    soundBtn.textContent = SFX.isMuted() ? "Sound off" : "Sound on";
}


// ---------------------------------------------------
//   THE GAMEPAD
// ---------------------------------------------------
// A pad drives the hub through the same keys the keyboard uses: stick or
// D-pad for the arrows, A or Start for Enter. Polled on a tracked interval;
// a held direction repeats.
const PAD_POLL_MS = 50;
const PAD_REPEAT_MS = 220;
let padHeld = "";
let padHeldAt = 0;
let padButtonWas = false;

function padPress(key) {
    if (splashUp) { splashDismiss(); return; }
    document.dispatchEvent(new KeyboardEvent("keydown", { key: key, bubbles: true }));
}

function padPoll() {
    if (!navigator.getGamepads) return;
    let pad = null;
    const pads = navigator.getGamepads();
    for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected) { pad = pads[i]; break; }
    if (!pad) return;

    const b = n => !!(pad.buttons[n] && pad.buttons[n].pressed);
    const ax = pad.axes[0] || 0, ay = pad.axes[1] || 0;
    let dir = "";
    if (b(14) || ax < -0.55) dir = "ArrowLeft";
    else if (b(15) || ax > 0.55) dir = "ArrowRight";
    else if (b(12) || ay < -0.55) dir = "ArrowUp";
    else if (b(13) || ay > 0.55) dir = "ArrowDown";

    const now = performance.now();
    if (dir && (dir !== padHeld || now - padHeldAt > PAD_REPEAT_MS)) {
        padHeld = dir;
        padHeldAt = now;
        padPress(dir);
    } else if (!dir) {
        padHeld = "";
    }

    const go = b(0) || b(9);
    if (go && !padButtonWas) padPress("Enter");
    padButtonWas = go;
}

function startCrew() {
    if (splashOverlay) {
        splashOverlay.hidden = !splashUp;
        splashOverlay.addEventListener("click", splashDismiss, { signal: hubSignal });
    }
    if (soundBtn) {
        soundBtnPaint();
        soundBtn.addEventListener("click", () => {
            if (typeof SFX !== "undefined") SFX.toggleMute();
            soundBtnPaint();
        }, { signal: hubSignal });
    }
    if (!splashUp) {
        // Back from a game: the hum resumes on the first input (browser policy).
        window.addEventListener("pointerdown", hubHumStart, { once: true, signal: hubSignal });
        window.addEventListener("keydown", hubHumStart, { once: true, signal: hubSignal });
    }
    trackInterval(padPoll, PAD_POLL_MS);
}
