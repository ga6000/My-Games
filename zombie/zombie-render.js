// ===================================================
//   Zombie — rendering, HUD, input, boot
// ===================================================
// Loads LAST. Everything here runs after the other files have declared
// their globals.
"use strict";

// ---------------------------------------------------
//   AESTHETIC (AESTHETIC_GUIDE.md §6.3 -- RASTER, Berzerk)
// ---------------------------------------------------
// Frame counter. It drove the flicker budget (§4.7); now it only animates
// flame and burn pixels. Deliberately NOT a timer -- it ticks once per
// rendered frame in gameLoop, so it needs no trackTimeout registration.
let zFrameCount = 0;

// THE FLICKER BUDGET IS GONE (2026-09-18). Past 40 zombies on screen the
// overflow used to draw on alternate frames -- §4.7's "flicker as a
// budget". The playtest found it distracting and, worse, hard to read:
// exactly when the screen is fullest you most need to see what is on it.
// Drawing every zombie every frame costs two fillRects each; it was never
// the frame budget.

// Four bands: lit / near / far / ambient. The era had no smooth gradients.
const LIGHT_BANDS = 4;

const uiTime = document.getElementById('scoreDisplay');
const uiZombies = document.getElementById('zombieCount');
const uiKills = document.getElementById('killCount');
const uiRound = document.getElementById('roundDisplay');
const uiScrap = document.getElementById('scrapDisplay');
const uiPrompt = document.getElementById('prompt');
// The loadout HUD, bottom left (2026-09-18).
const uiGunIcon = document.getElementById('gunIcon');
const uiGunName = document.getElementById('gunName');
const uiAmmo = document.getElementById('ammoBig');
const uiGunStrip = document.getElementById('gunStrip');
const uiPerks = document.getElementById('perks');
const uiStats = document.getElementById('stats');
const uiSpectate = document.getElementById('spectate');
const uiLoadout = document.getElementById('loadout');
// The HUD panel itself, so the win sequence can fade the readout with the
// world instead of leaving live numbers floating over black.
const uiHudRoot = document.getElementById('ui');
const uiNetLost = document.getElementById('netlost');
const uiNetLostTime = document.getElementById('netLostTime');
const uiNetLostOffer = document.getElementById('netLostOffer');
const uiNetWarn = document.getElementById('netwarn');
const uiToast = document.getElementById('toast');
const uiRoundCard = document.getElementById('roundcard');
const uiScores = document.getElementById('scores');
const uiGameOver = document.getElementById('gameover');
const uiFinalRound = document.getElementById('finalRound');
const uiStart = document.getElementById('startprompt');
const uiZone = document.getElementById('zonename');
const uiAudio = document.getElementById('audioState');
const uiWin = document.getElementById('win');
const uiWinRound = document.getElementById('winRound');
const uiWinScore = document.getElementById('winScore');
const uiOverScore = document.getElementById('overScore');
const uiObjective = document.getElementById('objective');
const uiRole = document.getElementById('roleDisplay');
const uiCodex = document.getElementById('codex');
const uiCodexBody = document.getElementById('codexBody');
const uiCodexTabs = document.getElementById('codexTabs');
const uiCodexClose = document.getElementById('codexClose');

// ---------------------------------------------------
//   FIELD MANUAL
// ---------------------------------------------------
// Every table below is built FROM the live data (WEAPONS, CARDS,
// ZOMBIE_TYPES, the map arrays), never hand-written. A manual that can
// drift out of step with the balance numbers is worse than no manual.
// True while the HUD carries a win-sequence opacity, so the one frame that
// puts it back to 1 still runs after the fade is cleared by a restart.
let hudFaded = false;
let codexOpen = false;
let codexTab = "weapons";

const CODEX_TABS = [
    ["weapons", "WEAPONS"],
    ["cards", "PERKS"],
    ["roles", "CLASSES"],
    ["pickups", "PICKUPS"],
    ["enemies", "ENEMIES"],
    ["map", "THE MAP"]
];

// BOTH ends release the held keys, and the open side is the one that was
// missing (fixed 2026-09-19, reported as "holding a direction while opening
// the field manual makes the player keep moving").
//
// Why it happened: the keydown that opens the manual leaves p.keys.<dir>
// true, the `keyup` listener returns early while `codexOpen`, so the release
// is never seen -- and NOTHING gates updatePlayers on codexOpen. So you
// walked for as long as you read. closeCodex() already cleared the keys,
// which is exactly why it stopped the instant you shut the manual and read
// as "it moves while the manual is up" rather than "it moves afterwards".
// openHelp()/closeHelp() had this right on both sides all along.
function openCodex() {
    codexOpen = true;
    releaseHeldKeys();
    uiCodex.classList.add('open');
    renderCodex();
}

function closeCodex() {
    codexOpen = false;
    uiCodex.classList.remove('open');
    releaseHeldKeys();
}

function swatch(color) {
    return "<span class='swatch' style='background:" + color + "'></span>";
}

function codexWeapons() {
    let h = "<p class='lede'>One of each is sold somewhere on the map — never two. " +
            "The pistol is always with you and never runs dry. Everything you buy stays yours: " +
            "<b>1–7</b> or the <b>mouse wheel</b> switch guns, and a gun that runs dry hands over " +
            "to the next one you own. Crates refill every gun you own.</p>" +
            "<table><tr><th></th><th>WEAPON</th><th>KEY</th><th>DAMAGE</th><th>RATE</th><th>RANGE</th><th>AMMO</th><th>NOTES</th></tr>";
    for (let i = 0; i < WEAPON_KEYS.length; i++) {
        const k = WEAPON_KEYS[i], w = WEAPONS[k];
        const buy = wallBuys.filter(function (b) { return b.weapon === k; })[0];
        const notes = [];
        if (w.pellets > 1 && k !== "flamer") notes.push(w.pellets + " pellets");
        if (w.pierce && k !== "flamer") notes.push("pierces " + w.pierce);
        if (w.splash) notes.push("explodes: " + w.splash.dmg + " damage in " + w.splash.r + "px, sets off barrels");
        if (w.burn) notes.push("hits everything in the cone and sets it burning");
        if (w.crateFrac) notes.push("crates only half-fill it");
        if (w.infinite) notes.push("never runs out");
        if (buy) notes.push("buy in " + zoneName(buy.zone) + " — " + buy.cost);
        h += "<tr><td>" + iconImg("gun", k, 2) + "</td><td class='k'>" + w.name + "</td><td class='n'>" + (i + 1) +
             "</td><td class='n'>" + w.dmg +
             "</td><td class='n'>" + (1000 / w.cooldown).toFixed(1) + "/s</td><td class='n'>" + w.range +
             "</td><td class='n'>" + (w.infinite ? "&#8734;" : w.capacity) +
             "</td><td>" + notes.join(", ") + "</td></tr>";
    }
    return h + "</table>";
}

// PERKS (called cards in the code). What each does lives HERE now, not on
// the station prompt -- the icon on the station is how you recognise it.
function codexCards() {
    let h = "<p class='lede'>Bought at perk stations, which stay dead until the GENERATOR is running " +
            "(and go dead again if a Blackout trips it). Three slots. Each perk stacks to x" + CARD_MAX_STACK +
            ", and every stack costs more than the last (x1, x" + CARD_STACK_COST[1] +
            ", x" + CARD_STACK_COST[2] + "). Every map sells " + cardStations.length + " of the " +
            CARD_KEYS.length + "; OVERDRIVE is always one of them.</p>" +
            "<table><tr><th></th><th>PERK</th><th>WHAT IT DOES</th><th>ON THIS MAP</th></tr>";
    const absent = absentCardKeys();
    for (let i = 0; i < CARD_KEYS.length; i++) {
        const k = CARD_KEYS[i], c = CARDS[k];
        if (absent.indexOf(k) !== -1) continue;
        const st = cardStations.filter(function (s2) { return s2.card === k; })[0];
        h += "<tr><td>" + iconImg("perk", k, 2) + "</td><td class='k'>" + c.name + "</td><td>" + c.blurb +
             "<br><span style='color:#6FA06F'>" + c.detail + "</span></td><td>" +
             (st ? zoneName(st.zone) + " — " + st.cost : "") + "</td></tr>";
    }
    h += "</table>";
    if (absent.length) {
        h += "<p class='lede' style='margin-top:14px'><b>NOT ON THIS MAP:</b></p>" +
             "<table><tr><th></th><th>PERK</th><th>WHAT IT DOES</th></tr>";
        for (let i = 0; i < absent.length; i++) {
            const c = CARDS[absent[i]];
            h += "<tr style='opacity:.55'><td>" + iconImg("perk", absent[i], 2, ICON_DIM) + "</td><td class='k'>" +
                 c.name + "</td><td>" + c.blurb + "<br><span style='color:#6FA06F'>" + c.detail + "</span></td></tr>";
        }
        h += "</table>";
    }
    return h;
}

// CLASSES (roles in the code). Asked for 2026-09-18: "add to field manual
// what each class trait does". From ROLES[].detail, with your own row lit.
function codexRoles() {
    const mine = myRole();
    let h = "<p class='lede'>Everyone is dealt one of four classes on joining — worked out from your " +
            "player id, so it costs no network traffic and stays the same if you reconnect. Two " +
            "players can share one. It is shown under your scrap. <b>You are " + ROLES[mine].name +
            ".</b></p>" +
            "<table><tr><th>CLASS</th><th>IN SHORT</th><th>EXACTLY</th></tr>";
    for (let i = 0; i < ROLE_KEYS.length; i++) {
        const k = ROLE_KEYS[i], r = ROLES[k];
        const you = k === mine;
        h += "<tr" + (you ? " style='background:rgba(255,74,28,0.12)'" : "") + ">" +
             "<td class='k'>" + r.name + (you ? " <span style='color:#FF4A1C'>(YOU)</span>" : "") +
             "</td><td>" + r.blurb + "</td><td>" + r.detail + "</td></tr>";
    }
    return h + "</table>";
}

function codexPickups() {
    return "<p class='lede'>Dropped when a round is cleared. Picking one up applies it to " +
           "<b>everyone alive</b>, not just you — so call it before you grab it.</p>" +
           "<table><tr><th>PICKUP</th><th>EFFECT</th></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_PICKUP) + "OVERCLOCK</td>" +
           "<td>Everyone fires far faster for 6 seconds.</td></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_PICKUP) + "RALLY</td>" +
           "<td>Instantly revives every downed player and grants brief immunity.</td></tr>" +
           "</table>";
}

function codexEnemies() {
    const notes = {
        walker: "The baseline. Slow, weak, endless.",
        runner: "Fast and fragile. Punishes wandering off alone.",
        brute: "Heavy, tough, and tears through barricades. Focus it.",
        screamer: "Summons more until it dies. Kill it FIRST — you can hear it much further away than anything else.",
        splitter: "Bursts into three fast spawnlings when killed. Do not shoot it point blank.",
        spawnling: "What a splitter leaves behind.",
        ultra: "From round 16. Huge, slow and armoured: rounds stop in it instead of piercing through, " +
               "and it goes through a boarded window in moments. Rockets and flame are the answer."
    };
    let h = "<p class='lede'>HP shown for round 1; it rises every six rounds.</p>" +
            "<table><tr><th>ENEMY</th><th>HP</th><th>SPEED</th><th>SCRAP</th><th>BEHAVIOUR</th></tr>";
    for (let i = 0; i < Z_TYPE_KEYS.length; i++) {
        const k = Z_TYPE_KEYS[i], z = ZOMBIE_TYPES[k];
        h += "<tr><td class='k'>" + swatch(z.color) + zombieDisplayName(k) + "</td><td class='n'>" + z.hp +
             "</td><td class='n'>" + z.speed.toFixed(2) + "x</td><td class='n'>" + z.scrap +
             "</td><td>" + (notes[k] || "") + "</td></tr>";
    }
    return h + "</table>";
}

function codexMap() {
    return "<p class='lede'>The map is nine zones. You start sealed in " + zoneName(4) +
           " and buy your way out. Scrap is <b>shared</b> — every purchase spends the team's money.</p>" +
           "<table><tr><th>THING</th><th>WHAT IT IS</th></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_DOOR) + "DOOR</td><td>Blue, square, with a price plate and two posts. " +
           "<b>Buy it to open a new zone.</b> Never breaks. Players and zombies both use it once open.</td></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_WINDOW) + "BOARDED WINDOW</td><td>Brown planks with nail heads. " +
           "<b>Zombies chew through these to reach you</b> — you will hear it. You can never walk through one, " +
           "even after it breaks. Every window is re-boarded free at each breather between rounds — " +
           "at 150%, with a light frame round it, while an ENGINEER is in the game.</td></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_BUY) + "GENERATOR</td><td>Start it to light the map and switch on the perk stations. " +
           "<b>A Blackout trips it</b>: the map goes dark, the stations die, and the round will not end until " +
           "someone stands at the generator for " + (GEN_RESTART_MS / 1000) + " seconds to restart it. Free.</td></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_PICKUP) + "AMMO CRATE</td><td>Free, limited uses, refills every gun you own.</td></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_TRAP) + "TRAP</td><td>Arm it with scrap to hurt everything that walks over it.</td></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_BARREL) + "BARREL</td><td>Shoot it. It chains to nearby barrels.</td></tr>" +
           "<tr><td class='k'>" + swatch("#AA1122") + "SLUICE, FUNNELS, SILOS</td><td>How a run is won. Two players on the two plates open " +
           "the sluice. Kill zombies <b>on</b> a live funnel to fill the silo piped to it, then throw that silo's switch " +
           "to wake the next funnel. Funnel 1 is in the sluice room; 2 and 3 are in funnel halls — long " +
           "two-walled halls on a drain floor, a funnel at one end and its silo at the other.</td></tr>" +
           "</table>" +
           "<p class='lede' style='margin-top:12px'><b>KEYS</b> — <b>ESC</b> goals and how to play · " +
           "<b>M</b> map and stats on/off · <b>N</b> sound on/off · " +
           "<b>1–7</b> / wheel guns · <b>F</b> use · <b>Q</b> ping. If you bleed out while a teammate is still up, " +
           "you are back at the next breather. If everyone is down at once, the run is over.</p>";
}

function renderCodex() {
    let tabs = "";
    for (let i = 0; i < CODEX_TABS.length; i++) {
        const t = CODEX_TABS[i];
        tabs += "<button data-tab='" + t[0] + "'" + (codexTab === t[0] ? " class='on'" : "") + ">" + t[1] + "</button>";
    }
    uiCodexTabs.innerHTML = tabs;

    let body = "";
    if (codexTab === "weapons") body = codexWeapons();
    else if (codexTab === "cards") body = codexCards();
    else if (codexTab === "roles") body = codexRoles();
    else if (codexTab === "pickups") body = codexPickups();
    else if (codexTab === "enemies") body = codexEnemies();
    else body = codexMap();
    uiCodexBody.innerHTML = body;
}

uiCodexTabs.addEventListener('click', function (e) {
    const t = e.target && e.target.getAttribute('data-tab');
    if (!t) return;
    codexTab = t;
    renderCodex();
}, { signal: zSignal() });

uiCodexClose.addEventListener('click', closeCodex, { signal: zSignal() });

let lastZoneShown = -1;

let mouseX = WORLD_W / 2;
let mouseY = WORLD_H / 2;

// ---------------------------------------------------
//   HUD STATE (2026-09-18)
// ---------------------------------------------------
// M shows/hides the minimap and the TIME / ZOMBIES / KILLS lines together
// (it used to mute; N does that now).
//
// HIDDEN AT START (2026-09-18, asked for mid-playtest: "start game without
// minimap"). Every page load starts with it off. It was remembered in
// localStorage for a few hours, which would have brought it back on for
// anyone who had ever pressed M -- so it is deliberately NOT persisted. The
// choice does hold across restarts within a session: turning it on and
// then dying should not take it away again.
let hudMapOn = false;

function toggleHudMap() {
    hudMapOn = !hudMapOn;
    uiStats.style.display = hudMapOn ? "" : "none";
}

// The HUD rewrites only what changed. innerHTML every frame rebuilt the
// perk chips 60 times a second -- with <img> tags in them now, that would
// also re-decode every icon every frame.
let hudGunSig = "";
let hudAmmoSig = "";
let hudStripSig = "";
let hudPerkSig = "";
let hudSeenPower = false;       // the first time the lights come on this run
let hudAbsentUntil = 0;         // ...the absent perks are announced until then

function hudReset() {
    hudGunSig = hudAmmoSig = hudStripSig = hudPerkSig = "";
    hudSeenPower = false;
    hudAbsentUntil = 0;
    helpSig = "";
}

// ---------------------------------------------------
//   GOALS, AND THE ESC DIALOG (2026-09-18)
// ---------------------------------------------------
// Asked for mid-playtest: take the instructions off the start prompt and put
// them behind ESC, "which includes the map goals with check boxes as
// applies", and show the NEXT goal above the minimap while it is up.
//
// The goals are computed from state every client already has -- the
// generator, the gate, the silos, the flood and the escape all ride the
// world snapshot -- so a guest ticks exactly the boxes the host does, with no
// new traffic. A goal is DONE by state, not by order: a Blackout un-ticks
// the generator (and puts it back at the top as "restart") while the sluice
// stays ticked, because it is.
let helpOpen = false;
let helpSig = "";
const uiHelp = document.getElementById('help');
const uiGoalList = document.getElementById('goalList');
const uiGoalNote = document.getElementById('goalNote');
const uiHelpClose = document.getElementById('helpClose');

function zoneAt(r) {
    return r ? zoneName(zoneOf(r.x + (r.w || 0) / 2, r.y + (r.h || 0) / 2)) : "";
}

// In order. `short` is the minimap label; `note` explains; `progress` is
// live numbers where there are any.
function mapGoals() {
    const goals = [];
    goals.push({
        text: genTripped ? "Restart the generator" : "Start the generator",
        short: genTripped ? "RESTART THE GENERATOR" : "START THE GENERATOR",
        where: zoneAt(generatorRect),
        note: genTripped ? "a Blackout tripped it — stand at it for " + (GEN_RESTART_MS / 1000) + "s"
                         : "lights the map and powers the perk stations",
        progress: (genTripped && genRestart > 0) ? Math.floor(clamp(genRestart, 0, 1) * 100) + "%" : "",
        done: generatorOn
    });
    goals.push({
        text: "Open the sluice gate",
        short: "OPEN THE SLUICE GATE",
        where: zoneAt(sluiceRoom),
        note: "two players, one on each plate, through two locks",
        progress: (gateStage < GATE_STAGES && (gateStage > 0 || gateProgress > 0))
                  ? "lock " + (gateStage + 1) + "/" + GATE_STAGES + "  " + Math.floor(clamp(gateProgress, 0, 1) * 100) + "%" : "",
        done: gateStage >= GATE_STAGES
    });
    for (let k = 0; k < 3; k++) {
        const where = k === 0 ? zoneAt(sluiceRoom) + " (the sluice room)"
                    : (funnelHalls[k] ? zoneName(funnelHalls[k].zone) : (funnels[k] ? zoneName(funnels[k].zone) : ""));
        const full = siloFill[k] >= siloCapacity(k);
        goals.push({
            text: "Fill silo " + (k + 1) + " and throw its switch",
            short: full ? "THROW SILO " + (k + 1) + "'S SWITCH" : "FILL SILO " + (k + 1),
            where: where,
            note: full ? "full — throw the switch on the silo" : "kill zombies standing ON funnel " + (k + 1),
            progress: (!siloFlipped[k] && siloFill[k] > 0) ? siloFill[k] + "/" + siloCapacity(k) : "",
            done: !!siloFlipped[k]
        });
    }
    goals.push({
        text: "Survive the flood",
        short: "SURVIVE THE FLOOD",
        where: "",
        note: "it comes in off every edge of the map at once",
        progress: floodActive ? zombies.length + " left" : "",
        done: escapeAt > 0 || won
    });
    goals.push({
        text: "Reach the south gate",
        short: "REACH THE SOUTH GATE",
        where: zoneAt(escapeRect),
        note: (escapeAt > 0 && !escapeOpen()) ? "grinding open" : "it opens slowly once the flood is over",
        progress: escapeAt > 0 ? (escapeOpen() ? "OPEN" : Math.ceil((escapeAt - Date.now()) / 1000) + "s") : "",
        done: won
    });
    return goals;
}

function nextGoal(goals) {
    const g = goals || mapGoals();
    for (let i = 0; i < g.length; i++) if (!g[i].done) return g[i];
    return null;
}

// Rebuilt only when something on it changed (it is checked every frame
// while the dialog is up).
function renderHelp(force) {
    const goals = mapGoals();
    let sig = "";
    for (let i = 0; i < goals.length; i++) sig += (goals[i].done ? 1 : 0) + goals[i].text + goals[i].progress + goals[i].note + "|";
    if (!force && sig === helpSig) return;
    helpSig = sig;

    const cur = nextGoal(goals);
    let h = "";
    for (let i = 0; i < goals.length; i++) {
        const g = goals[i];
        const cls = g.done ? "done" : (g === cur ? "current" : "later");
        h += "<li class='" + cls + "'><span class='gbox'></span><span class='gt'>" + g.text.toUpperCase() +
             (g.where ? " <span class='gw'>— " + g.where + "</span>" : "") +
             "<span class='gn'>" + g.note + "</span></span>" +
             (g.progress ? "<span class='gp'>" + g.progress + "</span>" : "") + "</li>";
    }
    uiGoalList.innerHTML = h;

    // The one goal that cannot be done alone, said plainly.
    const alone = !netOnline || teamSize() < 2;
    uiGoalNote.innerHTML = (alone && gateStage < GATE_STAGES)
        ? "The sluice gate needs <b>two players</b>. Alone, a run is survival until you go down."
        : "Round " + round + (roundPhase === "intermission" ? " — breather" : "") + ".";
}

function releaseHeldKeys() {
    const p = players[0];
    if (p) { p.keys.up = p.keys.down = p.keys.left = p.keys.right = p.keys.shoot = false; }
}

// Like the field manual: it takes the keyboard and mouse while it is up, and
// it does NOT pause -- the host simulates for the whole room.
function openHelp() {
    helpOpen = true;
    releaseHeldKeys();
    uiHelp.classList.add('open');
    renderHelp(true);
}

function closeHelp() {
    helpOpen = false;
    releaseHeldKeys();
    uiHelp.classList.remove('open');
}

uiHelpClose.addEventListener('click', closeHelp, { signal: zSignal() });

// ---------------------------------------------------
//   DRAW
// ---------------------------------------------------
function draw() {
    const now = Date.now();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    // Pixel art stays square: floors, icons. Set every frame because a
    // canvas resize resets the whole context state, this included.
    ctx.imageSmoothingEnabled = false;

    applyCameraTransform();

    // Only what's on screen. At 4800x2700 with ~200 zombies, drawing the
    // whole world every frame is most of the frame budget.
    const vr = viewRect();
    const pad = 120;
    const inView = function (x, y, w, h) {
        return x + w > vr.x - pad && x < vr.x + vr.w + pad &&
               y + h > vr.y - pad && y < vr.y + vr.h + pad;
    };

    // Zone floors (zombie-floors.js); the old grid only if they failed.
    if (!drawZoneFloors(vr)) drawGround(vr);

    // World border
    ctx.strokeStyle = COLOR_WALL;
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    drawSiloPipes(now, inView);
    drawEndgame(now, inView);
    drawCodex(now, inView);
    drawTraps(now, inView);
    drawCrates(inView);
    drawBarrels(inView);
    drawGenerator(inView, now);
    drawCardStations(inView, now);
    drawWallBuys(inView);
    drawPickups(now, inView);
    drawDecoys(now);
    drawWalls(inView);
    drawDoors(inView);
    drawBarricades(inView);
    drawBlasts(now);
    drawZombies(now, inView);
    drawBolts(now);
    drawBullets(inView);
    drawRemotePlayers(now, inView);
    drawLocalPlayers(now);
    drawMarkers(now);

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    // Before the lighting: the light bands are pure black and have no colour
    // to drain, so draining after would be wasted work on the same pixels.
    drawBlackoutMonochrome();
    drawLighting();
    drawOffscreenMarkers(now);
    if (hudMapOn) drawMinimap();
    // THE FADE (2026-09-19): after the walk out, everything goes. Last, and
    // over the lighting and the minimap, because it is the screen going
    // dark, not the world going dark -- the DOM HUD is faded with it in
    // updateHud so the numbers do not float over black.
    if (winFade > 0) {
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.fillStyle = "rgba(0,0,0," + winFade.toFixed(3) + ")";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    updateHud(now);
}

// The fallback floor: a faint grid. Only drawn if the zone floors failed
// to build -- see drawZoneFloors.
function drawGround(vr) {
    // A faint grid: on a map this size with a moving camera, a flat black
    // field gives no sense of speed or direction.
    ctx.fillStyle = COLOR_BG;
    ctx.fillRect(0, 0, WORLD_W, WORLD_H);

    ctx.strokeStyle = "#101010";
    ctx.lineWidth = 1;
    const step = 200;
    const x0 = Math.max(0, Math.floor(vr.x / step) * step);
    const x1 = Math.min(WORLD_W, vr.x + vr.w + step);
    const y0 = Math.max(0, Math.floor(vr.y / step) * step);
    const y1 = Math.min(WORLD_H, vr.y + vr.h + step);
    ctx.beginPath();
    for (let x = x0; x <= x1; x += step) {
        ctx.moveTo(x, y0);
        ctx.lineTo(x, y1);
    }
    for (let y = y0; y <= y1; y += step) {
        ctx.moveTo(x0, y);
        ctx.lineTo(x1, y);
    }
    ctx.stroke();
}

function drawWalls(inView) {
    for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        if (!inView(w.x, w.y, w.w, w.h)) continue;
        ctx.fillStyle = COLOR_WALL;
        ctx.fillRect(w.x, w.y, w.w, w.h);
        ctx.fillStyle = COLOR_WALL_LIT;
        ctx.fillRect(w.x, w.y, w.w, 2);
        ctx.fillRect(w.x, w.y, 2, w.h);
    }
}

// Doors and barricades kept getting confused for each other, so they now
// share nothing visually:
//
//   DOOR      cool blue, hard straight frame, always two posts, a cost
//             plate when shut and an open threshold when bought. Players
//             pass; it never breaks.
//   BARRICADE warm timber, ragged plank ends, an HP bar, and a flashing
//             red BREACH frame once it goes. Zombies pass; players never.
function drawDoors(inView) {
    for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        if (!inView(d.x - 20, d.y - 20, d.w + 40, d.h + 40)) continue;
        const vertical = d.w < d.h;

        // The posts are drawn open or shut, so a bought door still reads
        // as a doorway rather than a random hole in a wall.
        ctx.fillStyle = COLOR_DOOR;
        if (vertical) {
            ctx.fillRect(d.x - 3, d.y - 14, d.w + 6, 14);
            ctx.fillRect(d.x - 3, d.y + d.h, d.w + 6, 14);
        } else {
            ctx.fillRect(d.x - 14, d.y - 3, 14, d.h + 6);
            ctx.fillRect(d.x + d.w, d.y - 3, 14, d.h + 6);
        }

        if (d.open) {
            ctx.fillStyle = "#0A0A18";
            ctx.fillRect(d.x, d.y, d.w, d.h);
            // Chevrons pointing through the opening: "you can walk here".
            ctx.strokeStyle = "#3A3A7A";
            ctx.lineWidth = 2;
            for (let c = 0; c < 3; c++) {
                const t = 0.25 + c * 0.25;
                ctx.beginPath();
                if (vertical) {
                    const y = d.y + d.h * t;
                    ctx.moveTo(d.x - 4, y - 5); ctx.lineTo(d.x + d.w + 4, y); ctx.lineTo(d.x - 4, y + 5);
                } else {
                    const x = d.x + d.w * t;
                    ctx.moveTo(x - 5, d.y - 4); ctx.lineTo(x, d.y + d.h + 4); ctx.lineTo(x + 5, d.y - 4);
                }
                ctx.stroke();
            }
            continue;
        }

        // Shut: solid slab, bright frame, cost plate.
        ctx.fillStyle = "#2B2B6B";
        ctx.fillRect(d.x, d.y, d.w, d.h);
        ctx.strokeStyle = COLOR_DOOR;
        ctx.lineWidth = 3;
        ctx.strokeRect(d.x + 1, d.y + 1, d.w - 2, d.h - 2);

        ctx.fillStyle = COLOR_DOOR;
        const cxm = d.x + d.w / 2, cym = d.y + d.h / 2;
        ctx.fillRect(cxm - 3, cym - 3, 6, 6);          // keyhole

        // The price plate, but ONLY for a door that has a price. The sluice
        // gate is a door with no `cost` -- it is opened by two players on
        // two plates, never bought -- so this printed a plate reading
        // "undefined" over the game's one fixed landmark. Pre-existing;
        // spotted in the browser 2026-09-19 while rebuilding the escape.
        if (typeof d.cost === "number") {
            ctx.save();
            ctx.translate(cxm, cym);
            if (vertical) ctx.rotate(-Math.PI / 2);
            ctx.fillStyle = "#000000";
            ctx.fillRect(-30, -22, 60, 15);
            ctx.strokeStyle = COLOR_DOOR;
            ctx.lineWidth = 1;
            ctx.strokeRect(-30, -22, 60, 15);
            ctx.fillStyle = COLOR_DOOR;
            ctx.font = "bold 11px Courier";
            ctx.textAlign = "center";
            ctx.fillText(String(d.cost), 0, -11);
            ctx.textAlign = "left";
            ctx.restore();
        }
    }
}


function drawBarricades(inView) {
    const now = Date.now();
    for (let i = 0; i < barricades.length; i++) {
        const b = barricades[i];
        if (!inView(b.x - 16, b.y - 16, b.w + 32, b.h + 32)) continue;
        const vertical = b.w < b.h;
        const span = vertical ? b.h : b.w;

        // The hole behind the boards.
        ctx.fillStyle = "#120A04";
        ctx.fillRect(b.x, b.y, b.w, b.h);

        if (b.hp <= 0) {
            // BREACHED: broken stubs and a flashing hazard frame. This is
            // the single most important thing on screen to notice.
            ctx.fillStyle = "#6B3F14";
            if (vertical) {
                ctx.fillRect(b.x, b.y, b.w, 9);
                ctx.fillRect(b.x, b.y + b.h - 9, b.w, 9);
            } else {
                ctx.fillRect(b.x, b.y, 9, b.h);
                ctx.fillRect(b.x + b.w - 9, b.y, 9, b.h);
            }
            ctx.strokeStyle = (now % 600 < 300) ? "#FF5555" : "#993333";
            ctx.lineWidth = 3;
            ctx.strokeRect(b.x - 3, b.y - 3, b.w + 6, b.h + 6);

            ctx.fillStyle = "#FF5555";
            ctx.font = "bold 10px Courier";
            ctx.textAlign = "center";
            ctx.save();
            ctx.translate(b.x + b.w / 2, b.y + b.h / 2);
            if (vertical) ctx.rotate(-Math.PI / 2);
            ctx.fillText("BREACH", 0, -14);
            ctx.restore();
            ctx.textAlign = "left";
            continue;
        }

        // Intact: individual planks, so damage reads as boards being torn
        // off rather than a bar quietly shrinking.
        // Above 1 when an ENGINEER's breather re-board left it at 150%: the
        // planks cap at four (more would be drawn past the window's ends) and
        // a reinforcing frame shows the extra instead.
        //
        // `planks`/`shown` come from zombie-level.js since 2026-09-19,
        // because BULLETS now read the same geometry (bulletBlockedAt): the
        // gap you can see is the gap you can shoot through, and keeping one
        // copy of the arithmetic is what guarantees that stays true.
        const reinforced = b.hp > b.maxHp;
        const frac = Math.min(1, b.hp / b.maxHp);
        const planks = BARRICADE_PLANKS;
        const shown = barricadePlanksShown(b);
        if (reinforced) {
            ctx.strokeStyle = "#C89B5A";
            ctx.lineWidth = 2;
            ctx.strokeRect(b.x - 8, b.y - 8, b.w + 16, b.h + 16);
        }
        const step = span / planks;
        ctx.fillStyle = COLOR_WINDOW;
        for (let k = 0; k < shown; k++) {
            const off = k * step + 2;
            const len = Math.max(3, step - 4);
            if (vertical) ctx.fillRect(b.x - 4, b.y + off, b.w + 8, len);
            else ctx.fillRect(b.x + off, b.y - 4, len, b.h + 8);
        }
        // Nail heads, and a darker frame so it never reads as a door.
        ctx.fillStyle = "#4A2C0E";
        for (let k = 0; k < shown; k++) {
            const off = k * step + step / 2;
            if (vertical) ctx.fillRect(b.x + b.w / 2 - 1, b.y + off - 1, 3, 3);
            else ctx.fillRect(b.x + off - 1, b.y + b.h / 2 - 1, 3, 3);
        }
        ctx.strokeStyle = "#5A3512";
        ctx.lineWidth = 2;
        ctx.strokeRect(b.x - 4, b.y - 4, b.w + 8, b.h + 8);

        // Health pips along the opening while it is being chewed.
        if (b.chewUntil && now < b.chewUntil) {
            ctx.fillStyle = (now % 200 < 100) ? "#FFAA00" : "#FF7700";
            const w = vertical ? 4 : span * frac;
            const h = vertical ? span * frac : 4;
            if (vertical) ctx.fillRect(b.x + b.w + 7, b.y, w, h);
            else ctx.fillRect(b.x, b.y + b.h + 7, w, h);
        }
    }
}


// Expanding shockwave. Barrels previously detonated with no visual at
// all -- zombies just silently vanished.
// ---------------------------------------------------
//   THE BLOOD SILO CHAIN
// ---------------------------------------------------
function drawEndgame(now, inView) {
    // --- gate plates ---
    for (let i = 0; i < gatePlates.length; i++) {
        const g = gatePlates[i];
        if (!inView(g.x, g.y, g.w, g.h)) continue;
        const done = gateStage >= GATE_STAGES;
        ctx.fillStyle = done ? "#0F2A0F" : "#2A0F1A";
        ctx.fillRect(g.x, g.y, g.w, g.h);
        ctx.strokeStyle = done ? COLOR_BUY : "#FF55AA";
        ctx.lineWidth = 3;
        ctx.strokeRect(g.x, g.y, g.w, g.h);
        if (!done) {
            ctx.fillStyle = "#FF55AA";
            ctx.font = "9px Courier";
            ctx.textAlign = "center";
            ctx.fillText("STAND", g.x + g.w / 2, g.y + g.h / 2 + 3);
            ctx.textAlign = "left";
        }
    }

    // --- gate progress, drawn over the sluice door ---
    if (sluiceGate && gateStage < GATE_STAGES && inView(sluiceGate.x, sluiceGate.y - 60, sluiceGate.w, 60)) {
        const w = sluiceGate.w;
        ctx.fillStyle = "#220011";
        ctx.fillRect(sluiceGate.x, sluiceGate.y - 34, w, 12);
        ctx.fillStyle = "#FF55AA";
        ctx.fillRect(sluiceGate.x, sluiceGate.y - 34, w * clamp(gateProgress, 0, 1), 12);
        ctx.strokeStyle = "#FF99CC";
        ctx.lineWidth = 1;
        ctx.strokeRect(sluiceGate.x, sluiceGate.y - 34, w, 12);
        ctx.fillStyle = "#FF99CC";
        ctx.font = "10px Courier";
        ctx.textAlign = "center";
        ctx.fillText("LOCK " + (gateStage + 1) + " OF " + GATE_STAGES + " — TWO PLAYERS",
                     sluiceGate.x + w / 2, sluiceGate.y - 40);
        ctx.textAlign = "left";
    }

    // --- funnels ---
    for (let i = 0; i < funnels.length; i++) {
        const f = funnels[i];
        if (!f || !inView(f.x - f.r, f.y - f.r, f.r * 2, f.r * 2)) continue;
        const live = funnelActive[i];
        const spent = siloFill[i] >= siloCapacity(i);

        ctx.strokeStyle = live ? "#FF3355" : (spent ? "#334433" : "#442233");
        ctx.lineWidth = live ? 4 : 2;
        for (let ring = 0; ring < 3; ring++) {
            ctx.beginPath();
            ctx.arc(f.x, f.y, f.r * (1 - ring * 0.3), 0, Math.PI * 2);
            ctx.stroke();
        }
        if (live) {
            // Slow rotating spokes, so the drain reads as machinery.
            const a0 = (now / 1400) % (Math.PI * 2);
            ctx.strokeStyle = (now % 700 < 350) ? "#FF6677" : "#AA2233";
            ctx.lineWidth = 3;
            for (let k = 0; k < 6; k++) {
                const a = a0 + k * Math.PI / 3;
                ctx.beginPath();
                ctx.moveTo(f.x + Math.cos(a) * f.r * 0.16, f.y + Math.sin(a) * f.r * 0.16);
                ctx.lineTo(f.x + Math.cos(a) * f.r, f.y + Math.sin(a) * f.r);
                ctx.stroke();
            }
            ctx.fillStyle = "#FF3355";
            ctx.font = "bold 11px Courier";
            ctx.textAlign = "center";
            ctx.fillText("FUNNEL " + (i + 1) + " — " + siloFill[i] + "/" + siloCapacity(i), f.x, f.y - f.r - 10);
            ctx.textAlign = "left";
        }
    }

    // --- silos ---
    for (let i = 0; i < silos.length; i++) {
        const si = silos[i];
        if (!si || !inView(si.x, si.y, si.w, si.h)) continue;
        const frac = Math.min(1, siloFill[i] / siloCapacity(i));

        ctx.fillStyle = "#160608";
        ctx.fillRect(si.x, si.y, si.w, si.h);
        // Blood level rises from the bottom.
        const h = si.h * frac;
        ctx.fillStyle = "#AA1122";
        ctx.fillRect(si.x + 3, si.y + si.h - h, si.w - 6, Math.max(0, h - 3));
        // Hoops, so it reads as a tank and not a gauge.
        ctx.fillStyle = "#3A1418";
        ctx.fillRect(si.x, si.y + Math.round(si.h * 0.33), si.w, 3);
        ctx.fillRect(si.x, si.y + Math.round(si.h * 0.66), si.w, 3);
        ctx.strokeStyle = siloFlipped[i] ? "#335533" : (siloReady(i) ? COLOR_BUY : "#884455");
        ctx.lineWidth = 3;
        ctx.strokeRect(si.x, si.y, si.w, si.h);

        // The two labels. They sat unconditionally ABOVE the tank, which in a
        // HORIZONTAL funnel hall is inside the hall's north wall -- the silo
        // is parked against it. zombie-level.js marks that case `labelBelow`
        // at build time, because that is where it is known which wall the
        // tank went against (2026-09-19).
        //
        // The backing plate is not decoration either: 9px Courier over a
        // drain floor with animated blood in the pipe beside it was marginal
        // even where it did fit.
        const l1 = "SILO " + (i + 1);
        const l2 = siloFlipped[i] ? "SPENT"
                 : (siloReady(i) ? "[F] SWITCH" : siloFill[i] + "/" + siloCapacity(i));
        ctx.font = "9px Courier";
        ctx.textAlign = "center";
        const cx = si.x + si.w / 2;
        const plateW = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width) + 10;
        // Top of the two-line block, on whichever side has floor.
        const top = si.labelBelow ? si.y + si.h + 5 : si.y - 24;
        ctx.fillStyle = "rgba(8,4,5,0.72)";
        ctx.fillRect(Math.round(cx - plateW / 2), top, Math.round(plateW), 22);
        ctx.fillStyle = siloFlipped[i] ? "#557755" : (siloReady(i) ? COLOR_BUY : "#CC6677");
        ctx.fillText(l1, cx, top + 9);
        ctx.fillText(l2, cx, top + 20);
        ctx.textAlign = "left";
    }

    // --- the way out ---
    if (escapeRect && inView(escapeRect.x - 20, escapeRect.y - 20, escapeRect.w + 40, escapeRect.h + 40)) {
        drawEscapeGate(now);
    }
}

// THE SOUTH GATE (2026-09-19). Replaces a yellow loading bar and the word
// SEALED with the thing the bar was describing: a heavy slab grinding up
// behind a chainlink gate, and the fence flying open when the slab is clear.
//
// Both fractions come from escapeGateFrac()/escapeChainFrac() in
// zombie-endgame.js, which derive from `escapeAt` alone -- so nothing new
// crosses the wire and a guest's gate is at the host's height.
function drawEscapeGate(now) {
    const r = escapeRect;
    const started = escapeAt > 0;
    const gf = escapeGateFrac();
    const cf = escapeChainFrac();

    // The opening itself: black, because what is past it is outside.
    ctx.fillStyle = "#050505";
    ctx.fillRect(r.x, r.y, r.w, r.h);

    // --- the heavy inner gate, rising ---
    // It sits IN the opening and retracts upward, so the black revealed
    // beneath it is the way out.
    const slabH = Math.round(r.h * (1 - gf));
    if (slabH > 0) {
        ctx.fillStyle = "#2B2B2E";
        ctx.fillRect(r.x, r.y + r.h - slabH, r.w, slabH);
        // Ribs across it -- flat bands, no gradient (AESTHETIC_GUIDE 6.3).
        ctx.fillStyle = "#3A3A3F";
        for (let yy = r.y + r.h - slabH + 6; yy < r.y + r.h - 4; yy += 12) {
            ctx.fillRect(r.x + 3, Math.round(yy), r.w - 6, 4);
        }
        // The lifting edge, bright, so you can see it move at all.
        ctx.fillStyle = started ? "#6E6E52" : "#4A4A4E";
        ctx.fillRect(r.x, r.y + r.h - slabH, r.w, 4);
    }
    // The rails it runs in.
    ctx.fillStyle = "#1C1C20";
    ctx.fillRect(r.x - 7, r.y - 4, 7, r.h + 8);
    ctx.fillRect(r.x + r.w, r.y - 4, 7, r.h + 8);

    // --- the chainlink gate in front ---
    // Hinged on the left. Shut for the whole 90s, then it flies.
    const swing = cf;                       // 0 shut .. 1 flat against the wall
    const gw = Math.round(r.w * (1 - swing * 0.94));
    if (gw > 6) {
        ctx.save();
        ctx.beginPath();
        ctx.rect(r.x, r.y - 2, gw, r.h + 4);
        ctx.clip();
        // Diamond mesh: two sets of diagonals, one colour, on the open gap.
        ctx.strokeStyle = swing > 0 ? "#8A9A88" : "#6E7A6E";
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let d = -r.h; d < gw + r.h; d += 9) {
            ctx.moveTo(r.x + d, r.y);
            ctx.lineTo(r.x + d + r.h, r.y + r.h);
            ctx.moveTo(r.x + d, r.y + r.h);
            ctx.lineTo(r.x + d + r.h, r.y);
        }
        ctx.stroke();
        ctx.restore();
        // Frame: top and bottom rails plus the leading post.
        ctx.fillStyle = "#9AA69A";
        ctx.fillRect(r.x, r.y - 2, gw, 3);
        ctx.fillRect(r.x, r.y + r.h - 1, gw, 3);
        ctx.fillRect(r.x + gw - 3, r.y - 2, 3, r.h + 4);
        // The hinge post, always where the wall is.
        ctx.fillStyle = "#C8D0C8";
        ctx.fillRect(r.x - 2, r.y - 5, 4, r.h + 10);
    }

    // --- the label ---
    // ABOVE the gate, not below it. The escape sits 8px off the bottom of
    // the world and the camera clamps there, so anything drawn below the
    // rect is outside the view and is never seen -- checked in the browser,
    // where a label at r.y + r.h + 20 landed at world y 2712 against a
    // WORLD_H of 2700 and simply did not render.
    const open = escapeOpen() && cf >= 0.5;
    ctx.fillStyle = open ? COLOR_BUY : (started ? "#AAAA55" : "#888888");
    ctx.font = "bold 12px Courier";
    ctx.textAlign = "center";
    const cx = r.x + r.w / 2;
    const ly = r.y - 10;
    const label = open ? "ESCAPE"
                : started ? Math.ceil((escapeAt - now) / 1000) + "s"   // the gate IS the bar now
                : "SEALED";
    const lw = ctx.measureText(label).width + 12;
    ctx.save();
    ctx.fillStyle = "rgba(6,6,6,0.75)";
    ctx.fillRect(Math.round(cx - lw / 2), ly - 11, Math.round(lw), 15);
    ctx.restore();
    ctx.fillStyle = open ? COLOR_BUY : (started ? "#AAAA55" : "#888888");
    ctx.fillText(label, cx, ly);
    ctx.textAlign = "left";
}

// Funnel -> silo pipes (2026-09-18). Drawn under everything else in the
// endgame so the funnel ring and the tank sit on top of the pipe ends. A
// live funnel runs blood along its pipe toward the silo; a full or spent
// one is dry.
function drawSiloPipes(now, inView) {
    for (let i = 0; i < siloPipes.length; i++) {
        const p = siloPipes[i];
        if (!p) continue;
        const x0 = Math.min(p.x1, p.x2), y0 = Math.min(p.y1, p.y2);
        if (!inView(x0 - 10, y0 - 10, Math.abs(p.x2 - p.x1) + 20, Math.abs(p.y2 - p.y1) + 20)) continue;
        const len = Math.hypot(p.x2 - p.x1, p.y2 - p.y1);
        if (len < 1) continue;
        const ux = (p.x2 - p.x1) / len, uy = (p.y2 - p.y1) / len;

        ctx.lineCap = "butt";
        ctx.strokeStyle = "#2A1416";
        ctx.lineWidth = 12;
        ctx.beginPath();
        ctx.moveTo(p.x1, p.y1);
        ctx.lineTo(p.x2, p.y2);
        ctx.stroke();
        ctx.strokeStyle = "#4A2226";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(p.x1 - uy * 3, p.y1 + ux * 3);
        ctx.lineTo(p.x2 - uy * 3, p.y2 + ux * 3);
        ctx.stroke();

        // Flanges every 30px.
        ctx.fillStyle = "#5A2A2E";
        for (let d = 8; d < len - 4; d += 30) {
            const fx = p.x1 + ux * d, fy = p.y1 + uy * d;
            ctx.save();
            ctx.translate(fx, fy);
            ctx.rotate(Math.atan2(uy, ux));
            ctx.fillRect(-2, -9, 4, 18);
            ctx.restore();
        }

        if (funnelActive[i] && siloFill[i] < siloCapacity(i)) {
            ctx.strokeStyle = "#CC1A2A";
            ctx.lineWidth = 4;
            ctx.setLineDash([6, 10]);
            ctx.lineDashOffset = -((now / 40) % 16);
            ctx.beginPath();
            ctx.moveTo(p.x1, p.y1);
            ctx.lineTo(p.x2, p.y2);
            ctx.stroke();
            ctx.setLineDash([]);
            ctx.lineDashOffset = 0;
        }
    }
}

function drawBlasts(now) {
    for (let i = 0; i < blasts.length; i++) {
        const b = blasts[i];
        const t = (now - b.born) / b.life;
        if (t < 0 || t > 1) continue;
        const r = b.r * (0.25 + 0.75 * t);

        ctx.globalAlpha = Math.max(0, 1 - t);
        ctx.strokeStyle = t < 0.35 ? "#FFFFFF" : COLOR_BARREL;
        ctx.lineWidth = Math.max(1, 9 * (1 - t));
        ctx.beginPath();
        ctx.arc(b.x, b.y, r, 0, Math.PI * 2);
        ctx.stroke();

        // A second, faster inner ring gives it a hard leading edge.
        if (t < 0.55) {
            ctx.strokeStyle = "#FFDD88";
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.arc(b.x, b.y, r * 0.55, 0, Math.PI * 2);
            ctx.stroke();
        }
        if (t < 0.18) {
            ctx.fillStyle = "#FFFFFF";
            ctx.globalAlpha = (0.18 - t) / 0.18;
            ctx.beginPath();
            ctx.arc(b.x, b.y, b.r * 0.3, 0, Math.PI * 2);
            ctx.fill();
        }
        ctx.globalAlpha = 1;
    }
}

function drawCodex(now, inView) {
    if (!codexRect) return;
    const c = codexRect;
    if (!inView(c.x, c.y, c.w, c.h)) return;
    ctx.fillStyle = "#02160A";
    ctx.fillRect(c.x, c.y, c.w, c.h);
    ctx.strokeStyle = COLOR_BUY;
    ctx.lineWidth = 2;
    ctx.strokeRect(c.x, c.y, c.w, c.h);
    ctx.fillStyle = (now % 900 < 450) ? COLOR_BUY : "#227722";
    ctx.font = "9px Courier";
    ctx.textAlign = "center";
    ctx.fillText("MANUAL", c.x + c.w / 2, c.y + 16);
    ctx.fillText("[F]", c.x + c.w / 2, c.y + 30);
    ctx.textAlign = "left";
}

// The gun's silhouette on the plate, so a wall-buy says what it sells
// before you are close enough for the prompt.
function drawWallBuys(inView) {
    for (let i = 0; i < wallBuys.length; i++) {
        const wb = wallBuys[i];
        if (!inView(wb.x, wb.y, wb.w, wb.h)) continue;
        ctx.fillStyle = "#003300";
        ctx.fillRect(wb.x, wb.y, wb.w, wb.h);
        ctx.strokeStyle = COLOR_BUY;
        ctx.lineWidth = 2;
        ctx.strokeRect(wb.x, wb.y, wb.w, wb.h);
        const icon = gunIcon(wb.weapon, COLOR_BUY);
        if (icon) ctx.drawImage(icon, wb.x + 4, wb.y + 6, icon.width * 2, icon.height * 2);
        ctx.fillStyle = COLOR_BUY;
        ctx.font = "10px Courier";
        ctx.fillText(weaponShortName(wb.weapon), wb.x + 56, wb.y + 18);
    }
}

function drawCrates(inView) {
    for (let i = 0; i < ammoCrates.length; i++) {
        const c = ammoCrates[i];
        if (!inView(c.x, c.y, c.size, c.size)) continue;
        ctx.fillStyle = c.uses > 0 ? "#665500" : "#222222";
        ctx.fillRect(c.x, c.y, c.size, c.size);
        ctx.strokeStyle = c.uses > 0 ? COLOR_PICKUP : "#444444";
        ctx.lineWidth = 2;
        ctx.strokeRect(c.x, c.y, c.size, c.size);
        if (c.uses > 0) {
            ctx.fillStyle = COLOR_PICKUP;
            ctx.font = "bold 14px Courier";
            ctx.fillText("A", c.x + 11, c.y + 22);
        }
    }
}

function drawBarrels(inView) {
    for (let i = 0; i < barrels.length; i++) {
        const b = barrels[i];
        if (!b.alive || !inView(b.x, b.y, b.size, b.size)) continue;
        ctx.fillStyle = COLOR_BARREL;
        ctx.fillRect(b.x, b.y, b.size, b.size);
        ctx.fillStyle = "#000000";
        ctx.fillRect(b.x + 4, b.y + 9, b.size - 8, 5);
    }
}

function drawGenerator(inView, now) {
    if (!generatorRect) return;
    const g = generatorRect;
    if (!inView(g.x, g.y, g.w, g.h)) return;

    // Tripped by a Blackout: flashing red, and the restart zone marked out
    // on the floor with how far the restart has got.
    const tripped = genTripped;
    const edge = generatorOn ? COLOR_BUY : (tripped ? ((now % 500 < 250) ? "#FF3344" : "#881122") : COLOR_PICKUP);
    ctx.fillStyle = generatorOn ? "#224422" : (tripped ? "#2A0A0E" : "#332200");
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.strokeStyle = edge;
    ctx.lineWidth = 3;
    ctx.strokeRect(g.x, g.y, g.w, g.h);

    // Running generators pulse; dead ones sit there costing you light.
    if (generatorOn && now % 900 < 450) {
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1;
        ctx.strokeRect(g.x - 5, g.y - 5, g.w + 10, g.h + 10);
    }
    // A bolt in the same pixel language as the perk icons -- this used to
    // be the U+26A1 emoji, which renders as a colour picture on some systems.
    const bolt = miscIcon("power", edge);
    if (bolt) ctx.drawImage(bolt, g.x + g.w / 2 - 18, g.y + g.h / 2 - 18, 36, 36);

    if (tripped) {
        const r = GEN_RESTART_REACH;
        ctx.strokeStyle = "#FF3344";
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 6]);
        ctx.strokeRect(g.x - r, g.y - r, g.w + r * 2, g.h + r * 2);
        ctx.setLineDash([]);
        const w = g.w + r * 2;
        ctx.fillStyle = "#220008";
        ctx.fillRect(g.x - r, g.y - r - 18, w, 9);
        ctx.fillStyle = "#FF3344";
        ctx.fillRect(g.x - r, g.y - r - 18, w * clamp(genRestart, 0, 1), 9);
        ctx.fillStyle = "#FF8899";
        ctx.font = "bold 11px Courier";
        ctx.textAlign = "center";
        ctx.fillText("TRIPPED \u2014 STAND HERE TO RESTART", g.x + g.w / 2, g.y - r - 24);
        ctx.textAlign = "left";
    }
}

// A perk station is its ICON (2026-09-18: "each perk should have its own
// unique icon that corresponds to its function"), lit in the world hue
// while there is power and grey when there is not, with the price under
// it. The name and what it does are in the prompt and the manual.
function drawCardStations(inView, now) {
    for (let i = 0; i < cardStations.length; i++) {
        const st = cardStations[i];
        if (!inView(st.x, st.y, st.w, st.h)) continue;
        const live = generatorOn;
        ctx.fillStyle = live ? "#1E0C08" : "#141414";
        ctx.fillRect(st.x, st.y, st.w, st.h);
        ctx.strokeStyle = live ? ICON_WORLD_HUE : "#3A3A3A";
        ctx.lineWidth = 2;
        ctx.strokeRect(st.x, st.y, st.w, st.h);
        const icon = perkIcon(st.card, live ? ICON_WORLD_HUE : "#4A4A4A");
        if (icon) ctx.drawImage(icon, st.x + st.w / 2 - 12, st.y + 3, 24, 24);
        ctx.fillStyle = live ? "#FFB000" : "#555555";
        ctx.font = "9px Courier";
        ctx.textAlign = "center";
        ctx.fillText(live ? String(st.cost) : "NO PWR", st.x + st.w / 2, st.y + st.h - 5);
        ctx.textAlign = "left";
    }
}

function drawTraps(now, inView) {
    for (let i = 0; i < traps.length; i++) {
        const t = traps[i];
        if (!inView(t.x, t.y, t.w, t.h)) continue;
        const armed = now < t.armedUntil;
        const ready = now >= t.readyAt;
        ctx.strokeStyle = armed ? "#FFFFFF" : (ready ? COLOR_TRAP : "#333344");
        ctx.lineWidth = armed ? 3 : 1;
        ctx.strokeRect(t.x, t.y, t.w, t.h);
        if (armed) {
            ctx.fillStyle = (now % 200 < 100) ? "rgba(85,153,255,0.45)" : "rgba(255,255,255,0.30)";
            ctx.fillRect(t.x, t.y, t.w, t.h);
        }
    }
}

function drawPickups(now, inView) {
    for (let i = 0; i < pickups.length; i++) {
        const pu = pickups[i];
        if (!inView(pu.x, pu.y, pu.size, pu.size)) continue;
        ctx.fillStyle = (now % 300 < 150) ? COLOR_PICKUP : "#FFFFFF";
        ctx.fillRect(pu.x, pu.y, pu.size, pu.size);
        ctx.fillStyle = "#000000";
        ctx.font = "bold 13px Courier";
        ctx.fillText(PICKUP_LABEL[pu.type] || "?", pu.x + 5, pu.y + 14);
    }
}

// Blocky sprites, at most three colours (§6.3, §4.4). Every zombie on screen
// is drawn on every frame -- the flicker budget is gone, see the top.
function drawZombies(now, inView) {
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        if (!inView(z.x, z.y, z.size, z.size)) continue;

        // Render-space quantization ONLY (§4.4). z.x/z.y are never written --
        // physics and collision keep full precision, the same discipline as
        // Glucose Dash keeping its curve inside SX(). Quantizing the
        // simulation would produce collision bugs that present as gameplay bugs.
        const x = RETRO.snap(z.x, 4);
        const y = RETRO.snap(z.y, 4);
        const s = z.size;
        const flash = now < z.flashUntil;

        if (z.type === "ultra") {
            drawUltra(x, y, s, flash, now);
        } else {
            ctx.fillStyle = flash ? "#FFFFFF" : z.color;
            ctx.fillRect(x, y, s, s);

            if (!flash) {
                // Colour two of three: a hard-edged shadow band, no gradient.
                // A flat constant rather than a computed shade, because this
                // runs for every zombie on screen every frame.
                const band = Math.max(4, s >> 2);
                ctx.fillStyle = "rgba(0,0,0,0.38)";
                ctx.fillRect(x, y + s - band, s, band);
            }
        }

        if (z.type === "screamer") {
            ctx.strokeStyle = "#FFFFFF";
            ctx.lineWidth = 1;
            ctx.strokeRect(x - 3, y - 3, s + 6, s + 6);
        }

        // FLAMETHROWER: burning zombies carry flame pixels that jump about.
        if (z.burnUntil && now < z.burnUntil) {
            const f = zFrameCount + i * 7;
            ctx.fillStyle = (f & 4) ? "#FFB000" : "#FF4A1C";
            ctx.fillRect(x + ((f * 5) % Math.max(1, s - 4)), y - 4, 4, 6);
            ctx.fillStyle = (f & 2) ? "#FFE680" : "#FF7A1C";
            ctx.fillRect(x + ((f * 11 + 3) % Math.max(1, s - 4)), y - 7, 3, 5);
            ctx.fillStyle = "rgba(255,90,20,0.35)";
            ctx.fillRect(x, y, s, s);
        }
    }
}

// ULTRA HEAVY: not a square. An octagon with shoulder plates wider than
// its body and two eyes, in three colours plus the hit flash. Collision is
// still the 34px square underneath -- the plates are paint.
function drawUltra(x, y, s, flash, now) {
    const c = s / 4;                     // corner cut
    ctx.fillStyle = flash ? "#FFFFFF" : COLOR_ULTRA;
    ctx.beginPath();
    ctx.moveTo(x + c, y);
    ctx.lineTo(x + s - c, y);
    ctx.lineTo(x + s, y + c);
    ctx.lineTo(x + s, y + s - c);
    ctx.lineTo(x + s - c, y + s);
    ctx.lineTo(x + c, y + s);
    ctx.lineTo(x, y + s - c);
    ctx.lineTo(x, y + c);
    ctx.closePath();
    ctx.fill();
    if (flash) return;
    // Shoulder plates and a spine plate, in bone.
    ctx.fillStyle = COLOR_ULTRA_PLATE;
    ctx.fillRect(x - 6, y + 4, 10, 12);
    ctx.fillRect(x + s - 4, y + 4, 10, 12);
    ctx.fillRect(x + s / 2 - 3, y + s - 12, 6, 10);
    // Shadow band, as every zombie has.
    ctx.fillStyle = "rgba(0,0,0,0.38)";
    ctx.fillRect(x + c, y + s - 8, s - c * 2, 8);
    // Eyes, which blink slowly -- the one living thing about it.
    if (now % 2400 > 180) {
        ctx.fillStyle = "#FFFF55";
        ctx.fillRect(x + s / 2 - 8, y + 9, 5, 4);
        ctx.fillRect(x + s / 2 + 3, y + 9, 5, 4);
    }
}

// ROUND SHAPES (2026-09-18: "modify bullet shape depending on gun"). Every
// gun fired the same 8px square. Each now has its own shape, drawn along
// its velocity, in the shooter's colour -- the colour still says WHO,
// the shape now says WHAT:
//   pistol  a small cross-shaped slug        rifle   a tracer streak
//   shotgun small square pellets             smg     a thin needle
//   sniper  a long hot line                  rocket  a finned body + exhaust
//   flame   growing, cooling, fading blocks, drawn additively
// Collision boxes are unchanged -- this is paint (WEAPONS[].bsize).
function drawBullets(inView) {
    const lists = [bullets, remoteBullets];
    // Solid rounds first, then every flame in one additive pass.
    for (let l = 0; l < 2; l++) {
        const list = lists[l];
        for (let i = 0; i < list.length; i++) {
            const b = list[i];
            if (b.kind === "flamer" || !inView(b.x - 40, b.y - 40, b.size + 80, b.size + 80)) continue;
            drawRound(b);
        }
    }
    const prevOp = ctx.globalCompositeOperation;
    ctx.globalCompositeOperation = "lighter";
    for (let l = 0; l < 2; l++) {
        const list = lists[l];
        for (let i = 0; i < list.length; i++) {
            const b = list[i];
            if (b.kind !== "flamer" || !inView(b.x - 20, b.y - 20, b.size + 40, b.size + 40)) continue;
            drawFlame(b, i);
        }
    }
    ctx.globalCompositeOperation = prevOp;
    ctx.globalAlpha = 1;
}

function drawRound(b) {
    const w = WEAPONS[b.kind || "pistol"] || WEAPONS.pistol;
    const cx = b.x + b.size / 2;
    const cy = b.y + b.size / 2;
    const sp = Math.hypot(b.vx, b.vy) || 1;
    const ux = b.vx / sp, uy = b.vy / sp;
    ctx.lineCap = "butt";

    switch (w.shape) {
        case "tracer":
            ctx.strokeStyle = b.ownerColor;
            ctx.lineWidth = 3;
            ctx.beginPath();
            ctx.moveTo(cx - ux * 14, cy - uy * 14);
            ctx.lineTo(cx, cy);
            ctx.stroke();
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(cx - 1.5, cy - 1.5, 3, 3);
            break;
        case "pellet":
            ctx.fillStyle = b.ownerColor;
            ctx.fillRect(cx - 2, cy - 2, 4, 4);
            break;
        case "needle":
            ctx.strokeStyle = b.ownerColor;
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.moveTo(cx - ux * 9, cy - uy * 9);
            ctx.lineTo(cx, cy);
            ctx.stroke();
            break;
        case "streak":
            ctx.strokeStyle = b.ownerColor;
            ctx.globalAlpha = 0.45;
            ctx.lineWidth = 5;
            ctx.beginPath();
            ctx.moveTo(cx - ux * 40, cy - uy * 40);
            ctx.lineTo(cx, cy);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.strokeStyle = "#FFFFFF";
            ctx.lineWidth = 1.5;
            ctx.beginPath();
            ctx.moveTo(cx - ux * 32, cy - uy * 32);
            ctx.lineTo(cx, cy);
            ctx.stroke();
            break;
        case "rocket": {
            ctx.save();
            ctx.translate(cx, cy);
            ctx.rotate(Math.atan2(uy, ux));
            // Exhaust, flickering behind it.
            const f = (zFrameCount >> 1) & 1;
            ctx.fillStyle = f ? "#FFB000" : "#FF4A1C";
            ctx.fillRect(-18 - f * 3, -3, 8 + f * 3, 6);
            ctx.fillStyle = "#FFE680";
            ctx.fillRect(-11, -2, 4, 4);
            // Body, fins, nose.
            ctx.fillStyle = b.ownerColor;
            ctx.fillRect(-8, -3, 14, 6);
            ctx.fillRect(-8, -6, 4, 12);
            ctx.fillStyle = "#FFFFFF";
            ctx.fillRect(6, -2, 3, 4);
            ctx.restore();
            break;
        }
        default:                                    // "round": the pistol slug
            ctx.fillStyle = b.ownerColor;
            ctx.fillRect(cx - 3, cy - 2, 6, 4);
            ctx.fillRect(cx - 2, cy - 3, 4, 6);
            break;
    }
}

// A flame cools as it goes: white-hot, yellow, orange, red, and grows and
// fades on the way. Snapped to 2px so it stays a stack of blocks.
function drawFlame(b, i) {
    const range = b.range || WEAPONS.flamer.range;
    const t = clamp((b.travelled || 0) / range, 0, 1);
    const size = 8 + 16 * t + ((zFrameCount + i) & 1) * 2;
    const cx = RETRO.snap(b.x + b.size / 2, 2);
    const cy = RETRO.snap(b.y + b.size / 2, 2);
    // Burns out rather than lingering: the last 30% of its run fades to
    // nothing, or old flame hangs in the air as dark red boxes that read
    // as blood, not fire.
    ctx.globalAlpha = t < 0.7 ? 1 - 0.45 * t : Math.max(0, (1 - t) * 2.3);
    ctx.fillStyle = t < 0.12 ? "#FFF4C0" : t < 0.35 ? "#FFD23A" : t < 0.6 ? "#FF8A1C" : "#E8481A";
    ctx.fillRect(cx - size / 2, cy - size / 2, size, size);
}

// PERK: ARC bolts. A jagged line, jittered from a per-bolt seed rather than
// Math.random(), so a bolt holds its shape for the 220ms it lives instead
// of boiling every frame.
function drawBolts(now) {
    if (!bolts.length) return;
    ctx.lineCap = "butt";
    for (let i = 0; i < bolts.length; i++) {
        const bo = bolts[i];
        const age = (now - bo.born) / 220;
        if (age > 1) continue;
        const dx = bo.x2 - bo.x1, dy = bo.y2 - bo.y1;
        const len = Math.hypot(dx, dy) || 1;
        const nx = -dy / len, ny = dx / len;
        ctx.globalAlpha = 1 - age;
        ctx.strokeStyle = (i & 1) ? "#AEE8FF" : "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(bo.x1, bo.y1);
        let s = bo.seed;
        for (let k = 1; k < 6; k++) {
            s = (s * 1103515245 + 12345) & 0x7fffffff;
            const off = ((s % 21) - 10) * 1.2;
            ctx.lineTo(bo.x1 + dx * k / 6 + nx * off, bo.y1 + dy * k / 6 + ny * off);
        }
        ctx.lineTo(bo.x2, bo.y2);
        ctx.stroke();
    }
    ctx.globalAlpha = 1;
}

// PERK: DECOY. Each live lure is a dashed ring the size of its pull, so
// the team can see what it covers and for how long.
function drawDecoys(now) {
    for (let i = 0; i < decoys.length; i++) {
        const d = decoys[i];
        const left = d.until - now;
        if (left <= 0) continue;
        ctx.strokeStyle = (now % 500 < 250) ? "#FFB000" : "#AA7700";
        ctx.lineWidth = 2;
        ctx.setLineDash([10, 8]);
        ctx.lineDashOffset = -((now / 30) % 18);
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.lineDashOffset = 0;
        ctx.fillStyle = "#FFB000";
        ctx.font = "bold 11px Courier";
        ctx.textAlign = "center";
        ctx.fillText("DECOY " + Math.ceil(left / 1000) + "s", d.x, d.y - 38);
        ctx.textAlign = "left";
    }
}

function drawPlayerBody(p, now, name) {
    const downed = p.downed;
    ctx.fillStyle = downed ? COLOR_DOWNED : p.color;
    if (downed) {
        ctx.fillRect(p.x, p.y + p.size * 0.4, p.size, p.size * 0.6);
    } else {
        ctx.fillRect(p.x, p.y, p.size, p.size);
    }

    if (!downed) {
        ctx.fillStyle = "#FFFFFF";
        ctx.fillRect(
            p.x + p.size / 2 + (p.facingX * 13) - 2,
            p.y + p.size / 2 + (p.facingY * 13) - 2,
            4, 4
        );

        // MUZZLE FLASH: one white frame (§6.3). Deliberately NO new state --
        // p.lastShotTime is already set on every shot in zombie-game.js, so
        // this is derived rather than tracked, and there is nothing extra to
        // reset, sync or tear down.
        if (now - (p.lastShotTime || 0) < 60) {
            ctx.fillRect(
                RETRO.snap(p.x + p.size / 2 + (p.facingX * 22) - 4, 2),
                RETRO.snap(p.y + p.size / 2 + (p.facingY * 22) - 4, 2),
                8, 8
            );
        }
    }

    if (now < (p.invulnUntil || 0)) {
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 2;
        ctx.strokeRect(p.x - 4, p.y - 4, p.size + 8, p.size + 8);
    }

    if (downed) {
        // Revive progress bar — the thing a teammate is watching while
        // they stand over you.
        //
        // EASED (2026-09-19). Progress now has one source, the host, which
        // publishes it every 100ms; drawn raw that is a staircase. The shown
        // value glides toward the real one, and drops at once when the real
        // one falls (a revive broken off must read as broken off).
        const target = clamp(p.reviveProgress || 0, 0, 1);
        const shown = p.reviveShown || 0;
        p.reviveShown = target < shown ? target : shown + (target - shown) * 0.25;
        const w = 40;
        ctx.fillStyle = "#330000";
        ctx.fillRect(p.x + p.size / 2 - w / 2, p.y - 14, w, 5);
        ctx.fillStyle = COLOR_BUY;
        ctx.fillRect(p.x + p.size / 2 - w / 2, p.y - 14, w * p.reviveShown, 5);
        ctx.fillStyle = COLOR_DOWNED;
        ctx.font = "10px Courier";
        ctx.textAlign = "center";
        ctx.fillText("DOWN", p.x + p.size / 2, p.y - 18);
        ctx.textAlign = "left";
    }

    if (name) {
        ctx.font = "12px Courier";
        ctx.textAlign = "center";
        ctx.fillStyle = p.color;
        ctx.fillText(name, p.x + p.size / 2, p.y - (downed ? 28 : 8));
        ctx.textAlign = "left";
    }
}

function drawLocalPlayers(now) {
    // THE WALK OUT (2026-09-19). During the win sequence the local player is
    // DRAWN progressively further south, off the bottom of the screen, as if
    // they had walked out of the area. Their simulated position never moves:
    // writing p.y would run them into the world clamp and the collision code
    // on the way, and it would cross the wire to everyone else as well.
    if (winPullPx > 0) {
        ctx.save();
        ctx.translate(0, winPullPx);
        for (let i = 0; i < players.length; i++) drawPlayerBody(players[i], now, null);
        ctx.restore();
        return;
    }
    for (let i = 0; i < players.length; i++) drawPlayerBody(players[i], now, null);
}

function drawRemotePlayers(now, inView) {
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        if (!inView(r.x, r.y, r.size, r.size)) continue;
        // AWAY: a ghost where they were, so the team can see who is missing
        // and that zombies are ignoring that spot.
        if (r.away) {
            ctx.globalAlpha = 0.35;
            drawPlayerBody(r, now, r.name || "");
            ctx.globalAlpha = 1;
            ctx.fillStyle = (now % 1000 < 500) ? "#8FA89C" : "#2E3A34";
            ctx.font = "10px Courier";
            ctx.textAlign = "center";
            ctx.fillText("RECONNECTING", r.x + (r.size || 16) / 2, r.y + (r.size || 16) + 14);
            ctx.textAlign = "left";
            continue;
        }
        drawPlayerBody(r, now, r.name || "");
    }
}

function drawMarkers(now) {
    for (let i = 0; i < markers.length; i++) {
        const m = markers[i];
        // Clamped: an out-of-range lifetime used to produce a NEGATIVE
        // radius, and arc() throws on that -- which killed the whole
        // draw pass, not just the marker.
        const life = clamp((m.until - now) / 4000, 0, 1);
        const r = 16 + (1 - life) * 26;
        ctx.strokeStyle = m.color;
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(m.x, m.y, r, 0, Math.PI * 2);
        ctx.stroke();
        ctx.beginPath();
        ctx.moveTo(m.x, m.y - 30);
        ctx.lineTo(m.x, m.y - 12);
        ctx.stroke();
    }
}

// The map is DIM until the generator runs, and Blackout rounds only dip
// it further. v2 punched a hard-edged 210px hole out of 94% black, which
// playtested as a guaranteed loss rather than a hard round.
//
// One radial gradient does the whole job: transparent out to LIGHT_RADIUS,
// fading to the ambient level over an extra 33%, and -- because a canvas
// radial gradient paints its final stop everywhere beyond the outer circle
// -- uniformly ambient across the rest of the screen. No second pass, no
// compositing tricks.
// QUANTIZED into four bands 2026-09-04 (AESTHETIC_GUIDE.md §6.3). It was one
// radial gradient; the era had none.
//
// NOTHING ABOUT THE BALANCE MOVED. ambientDarkness() is still the single
// source of truth, LIGHT_RADIUS is still 340, LIGHT_FADE still 1.33, and the
// downed player still gets 0.55 of the radius. Only the RAMP between them is
// discretized -- §5 lists this game's lighting as untouchable because v2's
// 0.94 blackout playtested as a guaranteed loss, and quantizing the ramp is
// explicitly the change that does not re-open that.
//
// Hard-edged light is more threatening than soft, so this should read better
// as well as being period-correct.
function drawLighting() {
    const dark = ambientDarkness();
    if (dark <= 0.005) return;                 // generator on, normal round

    const me = players[0];
    // Spectating after a bleed-out: see by the light of whoever the camera
    // is following, or the wait is spent staring at black.
    const watching = !me && zAwaitRespawn && gameStarted;
    if (!me && !watching) {
        ctx.fillStyle = "rgba(0,0,0," + dark + ")";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }

    const c = me ? worldToScreen(me.x + me.size / 2, me.y + me.size / 2) : worldToScreen(camera.x, camera.y);
    const inner = ((me && me.downed) ? LIGHT_RADIUS * 0.55 : LIGHT_RADIUS) * camera.scale;
    const outer = inner * LIGHT_FADE;

    // Drawn as DISJOINT REGIONS, each filled once at its own flat alpha.
    //
    // The obvious implementation -- flat ambient everywhere, then
    // globalCompositeOperation = "destination-out" to punch the light back
    // out -- is wrong here, and wrong in a way that looks right in isolation.
    // destination-out removes alpha from EVERYTHING already on the canvas, not
    // just from the darkness layer, so it erases the world inside the light
    // pocket and leaves a transparent hole exactly where the player is meant
    // to see. Measured on 2026-09-04: band geometry landed correctly at
    // 342/399/453 px, and the pocket read as fully transparent rather than
    // fully lit.
    //
    // Non-overlapping annuli avoid that completely: source-over only, nothing
    // is ever removed, and because the regions do not overlap their alphas
    // cannot compound into the wrong levels either.
    const steps = LIGHT_BANDS - 1;             // 3 boundaries between 4 bands

    // Everything beyond `outer`: flat ambient. Rect + circle with the evenodd
    // rule gives "the whole screen except this disc" in one path.
    ctx.fillStyle = "rgba(0,0,0," + dark + ")";
    ctx.beginPath();
    ctx.rect(0, 0, canvas.width, canvas.height);
    ctx.arc(c.x, c.y, outer, 0, Math.PI * 2);
    ctx.fill("evenodd");

    // The falloff, as flat rings: outer..mid at 2/3 ambient, mid..inner at 1/3.
    for (let i = 1; i < steps; i++) {
        const rOut = outer - (outer - inner) * ((i - 1) / (steps - 1));
        const rIn = outer - (outer - inner) * (i / (steps - 1));
        const a = dark * (steps - i) / steps;
        ctx.fillStyle = "rgba(0,0,0," + a + ")";
        ctx.beginPath();
        ctx.arc(c.x, c.y, rOut, 0, Math.PI * 2);
        ctx.arc(c.x, c.y, rIn, 0, Math.PI * 2);
        ctx.fill("evenodd");
    }

    // Inside `inner` nothing is drawn at all -- that is the lit pocket, and it
    // keeps the world exactly as the pass before this one left it.
}

// BLACKOUT ROUNDS DROP COLOUR instead of adding darkness (§6.3). Scarier than
// more black, and it avoids re-litigating the 0.94 balance failure -- the
// blackout still only adds its +0.20 dip, exactly as before.
//
// One composite fill, not the per-pixel pass §4.12 forbids. Canvas only, so
// the DOM HUD keeps its green: the readout is a device, the world is the thing
// that has lost its colour.
//
// Gated on the SAME condition ambientDarkness() uses, so the two can never
// disagree about whether a round is a blackout.
function drawBlackoutMonochrome() {
    if (!isBlackoutRound(round) || roundPhase !== "active") return;
    const prevOp = ctx.globalCompositeOperation;
    // If a browser does not support this blend mode it falls back to
    // source-over, which would paint flat grey over the world -- so bail
    // rather than risk that.
    ctx.globalCompositeOperation = "saturation";
    if (ctx.globalCompositeOperation === "saturation") {
        ctx.fillStyle = "hsl(0, 0%, 50%)";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
    }
    ctx.globalCompositeOperation = prevOp;
}

function worldToScreen(wx, wy) {
    return {
        x: (wx - camera.x) * camera.scale + canvas.width / 2,
        y: (wy - camera.y) * camera.scale + canvas.height / 2
    };
}

// IDEA 26: mandatory now the camera pans -- a teammate off the edge of
// the screen is otherwise invisible, and a DOWNED one off-screen is a
// teammate you will never reach in time (idea 25).
function drawOffscreenMarkers(now) {
    const cx = canvas.width / 2;
    const cy = canvas.height / 2;
    const margin = 46;

    const flagged = [];
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        flagged.push(remotePlayers[id]);
    }
    for (let i = 0; i < players.length; i++) {
        if (players[i].downed) flagged.push(players[i]);
    }

    for (let i = 0; i < flagged.length; i++) {
        const t = flagged[i];
        const s = worldToScreen(t.x + (t.size || 16) / 2, t.y + (t.size || 16) / 2);
        const onScreen = s.x > margin && s.x < canvas.width - margin &&
                         s.y > margin && s.y < canvas.height - margin;
        if (onScreen && !t.downed) continue;
        if (onScreen && t.downed) continue;

        const ang = Math.atan2(s.y - cy, s.x - cx);
        const rx = (canvas.width / 2 - margin);
        const ry = (canvas.height / 2 - margin);
        const scale = Math.min(
            Math.abs(rx / Math.cos(ang)) || Infinity,
            Math.abs(ry / Math.sin(ang)) || Infinity
        );
        const ex = cx + Math.cos(ang) * scale;
        const ey = cy + Math.sin(ang) * scale;

        // An away teammate's arrow is grey and never "urgent": nothing can be
        // done for them until they are back.
        const urgent = !!t.downed && !t.away;
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(ang);
        ctx.fillStyle = t.away ? "#3A4A44"
            : urgent ? ((now % 400 < 200) ? "#FFFFFF" : COLOR_DOWNED)
            : (t.color || "#55FFFF");
        ctx.beginPath();
        ctx.moveTo(14, 0);
        ctx.lineTo(-10, -9);
        ctx.lineTo(-10, 9);
        ctx.closePath();
        ctx.fill();
        ctx.restore();

        if (urgent) {
            ctx.fillStyle = "#FFFFFF";
            ctx.font = "bold 11px Courier";
            ctx.textAlign = "center";
            ctx.fillText("DOWN", ex, ey + 26);
            ctx.textAlign = "left";
        }
    }
}

// Mandatory at 4800x2700 -- without it you cannot tell where the keep is.
// Sized as a fraction of the window rather than a fixed 230px: on a
// narrow window a fixed panel swallowed most of the play area.
const MAP_MAX_W = 230;

function minimapRect() {
    const w = Math.round(Math.min(MAP_MAX_W, canvas.width * 0.26));
    const h = Math.round(w * (WORLD_H / WORLD_W));
    return { w: w, h: h, x: canvas.width - w - 14, y: canvas.height - h - 14 };
}

function drawMinimap() {
    const m = minimapRect();
    const MAP_W = m.w;
    const MAP_H = m.h;
    const ox = m.x;
    const oy = m.y;
    const sx = MAP_W / WORLD_W;
    const sy = MAP_H / WORLD_H;

    ctx.fillStyle = "rgba(0,0,0,0.72)";
    ctx.fillRect(ox, oy, MAP_W, MAP_H);
    // Each zone in its floor's tint (zombie-floors.js), so the map carries
    // the same identity the ground does.
    ctx.globalAlpha = 0.28;
    for (let z = 0; z < ZONE_COLS * ZONE_ROWS; z++) {
        const key = zoneInfo[z] && zoneInfo[z].tpl ? zoneInfo[z].tpl.key : "centre";
        const b = zoneBounds(z);
        ctx.fillStyle = ZONE_FLOOR_TINT[key] || "#333333";
        ctx.fillRect(ox + b.x * sx, oy + b.y * sy, b.w * sx, b.h * sy);
    }
    ctx.globalAlpha = 1;
    ctx.strokeStyle = COLOR_WALL;
    ctx.lineWidth = 1;
    ctx.strokeRect(ox, oy, MAP_W, MAP_H);

    ctx.fillStyle = "#444444";
    for (let i = 0; i < walls.length; i++) {
        const w = walls[i];
        ctx.fillRect(ox + w.x * sx, oy + w.y * sy, Math.max(1, w.w * sx), Math.max(1, w.h * sy));
    }

    // Door state is the main strategic read on a segmented map: blue =
    // still sealed (and costing you), dim = opened.
    for (let i = 0; i < doors.length; i++) {
        const d = doors[i];
        ctx.fillStyle = d.open ? "#224422" : COLOR_DOOR;
        ctx.fillRect(ox + d.x * sx - 1, oy + d.y * sy - 1, 4, 4);
    }

    // Breached windows -- where the horde is getting in.
    for (let i = 0; i < barricades.length; i++) {
        const b = barricades[i];
        ctx.fillStyle = b.hp <= 0 ? "#FF5555" : COLOR_WINDOW;
        ctx.fillRect(ox + b.x * sx - 1, oy + b.y * sy - 1, 3, 3);
    }

    ctx.fillStyle = COLOR_ZOMBIE;
    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        const big = z.type === "ultra";
        if (big) ctx.fillStyle = COLOR_ULTRA_PLATE;
        ctx.fillRect(ox + z.x * sx, oy + z.y * sy, big ? 4 : 2, big ? 4 : 2);
        if (big) ctx.fillStyle = COLOR_ZOMBIE;
    }

    if (generatorRect) {
        // Tripped: a big flashing marker, because finding it in the dark is
        // the whole of a Blackout now.
        const now = Date.now();
        if (genTripped) {
            ctx.fillStyle = (now % 500 < 250) ? "#FF3344" : "#FFFFFF";
            ctx.fillRect(ox + generatorRect.x * sx - 4, oy + generatorRect.y * sy - 4, 9, 9);
        } else {
            ctx.fillStyle = generatorOn ? COLOR_BUY : COLOR_PICKUP;
            ctx.fillRect(ox + generatorRect.x * sx - 2, oy + generatorRect.y * sy - 2, 5, 5);
        }
    }
    ctx.fillStyle = generatorOn ? ICON_WORLD_HUE : "#553322";
    for (let i = 0; i < cardStations.length; i++) {
        ctx.fillRect(ox + cardStations[i].x * sx - 1, oy + cardStations[i].y * sy - 1, 4, 4);
    }
    ctx.fillStyle = COLOR_BUY;
    for (let i = 0; i < wallBuys.length; i++) {
        ctx.fillRect(ox + wallBuys[i].x * sx - 1, oy + wallBuys[i].y * sy - 1, 4, 4);
    }

    // ROLE: SCOUT is the only one who sees pickups on the minimap.
    if (myRole() === "scout") {
        ctx.fillStyle = COLOR_PICKUP;
        for (let i = 0; i < pickups.length; i++) {
            ctx.fillRect(ox + pickups[i].x * sx - 2, oy + pickups[i].y * sy - 2, 5, 5);
        }
    }

    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        ctx.fillStyle = r.away ? "#3A4A44" : (r.downed ? COLOR_DOWNED : (r.color || "#55FFFF"));
        ctx.fillRect(ox + r.x * sx - 2, oy + r.y * sy - 2, 4, 4);
    }
    for (let i = 0; i < players.length; i++) {
        const p = players[i];
        ctx.fillStyle = p.downed ? COLOR_DOWNED : p.color;
        ctx.fillRect(ox + p.x * sx - 2, oy + p.y * sy - 2, 5, 5);
    }

    // The endgame chain, so you can find the sluice and the silos.
    if (sluiceGate) {
        ctx.fillStyle = gateStage >= GATE_STAGES ? COLOR_BUY : "#FF55AA";
        ctx.fillRect(ox + sluiceGate.x * sx - 2, oy + sluiceGate.y * sy - 2, 5, 5);
    }
    for (let i = 0; i < funnels.length; i++) {
        if (!funnels[i] || !funnelActive[i]) continue;
        ctx.fillStyle = "#FF3355";
        ctx.fillRect(ox + funnels[i].x * sx - 2, oy + funnels[i].y * sy - 2, 5, 5);
    }
    for (let i = 0; i < silos.length; i++) {
        if (!silos[i]) continue;
        ctx.fillStyle = siloFlipped[i] ? "#335533" : (siloReady(i) ? COLOR_BUY : "#AA1122");
        ctx.fillRect(ox + silos[i].x * sx - 2, oy + silos[i].y * sy - 2, 4, 4);
    }
    if (escapeRect && escapeAt > 0) {
        ctx.fillStyle = escapeOpen() ? COLOR_BUY : "#AAAA55";
        ctx.fillRect(ox + escapeRect.x * sx, oy + escapeRect.y * sy - 2, 6, 4);
    }

    // Where the camera is looking.
    const vr = viewRect();
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 1;
    ctx.strokeRect(ox + vr.x * sx, oy + vr.y * sy, vr.w * sx, vr.h * sy);

    drawNextGoal(ox, oy, MAP_W);
}

// The NEXT goal, sat on the minimap's top edge and right-aligned to it
// (2026-09-18). Only drawn with the minimap, which is the ask: "above minimap
// (when minimap is active)". Amber, because it is the thing to act on.
function drawNextGoal(ox, oy, mapW) {
    const g = nextGoal();
    if (!g || won) return;
    const text = "NEXT: " + g.short + (g.where ? " — " + g.where.replace(" (the sluice room)", "") : "") +
                 (g.progress ? "  " + g.progress : "");
    ctx.font = "bold 12px 'Courier New', Courier, monospace";
    const tw = Math.ceil(ctx.measureText(text).width);
    const bw = tw + 14;
    const bx = Math.max(4, ox + mapW - bw);
    const by = oy - 26;
    ctx.fillStyle = "rgba(0,0,0,0.78)";
    ctx.fillRect(bx, by, bw, 20);
    ctx.strokeStyle = "#FFB000";
    ctx.lineWidth = 1;
    ctx.strokeRect(bx + 0.5, by + 0.5, bw - 1, 19);
    ctx.fillStyle = "#FFB000";
    ctx.textAlign = "left";
    ctx.fillText(text, bx + 7, by + 14);
}

// ---------------------------------------------------
//   HUD
// ---------------------------------------------------
function playerName(id) {
    if (isMyNetId(id)) return MP.selfName || "YOU";
    const r = remotePlayers[id];
    if (r && r.name) return r.name;
    return id.split(":")[0].slice(0, 6);
}

function updateHud(now) {
    // The readout goes out with the world (2026-09-19). Written only while
    // the sequence is running or has just ended, so this is not a style
    // write on every ordinary frame.
    if (winFade > 0 || hudFaded) {
        const o = (1 - winFade).toFixed(3);
        if (uiHudRoot) uiHudRoot.style.opacity = o;
        if (uiLoadout) uiLoadout.style.opacity = o;
        hudFaded = winFade > 0;
    }

    uiTime.innerText = Math.floor((now - startTime) / 1000) + "s";
    uiZombies.innerText = String(zombies.length);
    uiKills.innerText = String(kills);
    uiRound.innerText = String(round);
    uiScrap.innerText = String(Math.round(scrapPool));

    // IDEA 35: name the place you are standing in, so callouts work.
    const me0 = players[0];
    if (me0) {
        const z = zoneOf(me0.x, me0.y);
        if (z !== lastZoneShown) {
            lastZoneShown = z;
            uiZone.innerText = zoneName(z);
            uiZone.style.opacity = "1";
            trackTimeout(function () { uiZone.style.opacity = "0"; }, 2000);
        }
    }

    const me = players[0];
    uiLoadout.style.display = me ? '' : 'none';
    if (me) {
        updateLoadoutHud(me);
        const prompt = me.downed ? "" : nearestPrompt(me);
        uiPrompt.innerText = prompt;
        uiPrompt.style.display = prompt ? 'block' : 'none';
    } else {
        uiPrompt.style.display = 'none';
    }

    // Bled out, waiting for the breather.
    const waiting = zAwaitRespawn && gameStarted && !gameOver && !won;
    uiSpectate.style.display = waiting ? 'block' : 'none';

    // Connection trouble (2026-09-19): holding for a reconnect, and the
    // softer "no snapshot lately" warning for a guest whose socket is up
    // but whose packets are not arriving.
    if (netLost) {
        uiNetLost.style.display = 'block';
        uiNetLostTime.innerText = Math.floor((now - netLostAt) / 1000) + "s";
        uiNetLostOffer.style.display = (now - netLostAt >= NET_LOST_OFFER_MS) ? 'block' : 'none';
    } else {
        uiNetLost.style.display = 'none';
    }
    const unstable = !netLost && netOnline && !netIsHost && gameStarted && !gameOver &&
                     lastWorldAt > 0 && now - lastWorldAt > 1500;
    uiNetWarn.style.display = unstable ? 'block' : 'none';

    uiRole.innerText = ROLES[myRole()].name;
    if (helpOpen) renderHelp(false);

    // The first time the lights come on in a run, say which perks this map
    // does not sell (playtest item 6) -- the manual also lists them.
    if (generatorOn && !hudSeenPower && gameStarted) {
        hudSeenPower = true;
        if (absentCardKeys().length) hudAbsentUntil = now + 9000;
    }
    const obj = hudObjective(now);
    uiObjective.innerText = obj;
    uiObjective.style.display = obj ? 'block' : 'none';

    // Round card + scoreboard
    if (roundPhase === "intermission") {
        const left = Math.max(0, Math.ceil((roundEndsAt - now) / 1000));
        uiRoundCard.innerHTML = "ROUND " + round + " CLEARED" +
            "<div style='font-size:20px;color:#55FF55'>NEXT IN " + left + "</div>";
        uiRoundCard.style.display = 'block';
        renderScores();
    } else if (now < roundCardUntil) {
        uiRoundCard.innerHTML = roundLabel(round);
        uiRoundCard.style.display = 'block';
        uiScores.style.display = 'none';
    } else {
        uiRoundCard.style.display = 'none';
        uiScores.style.display = 'none';
    }
}

// The line above the prompt. A tripped generator outranks everything: it
// is the one thing that will stop the round ending.
function hudObjective(now) {
    if (genTripped && gameStarted && !gameOver) {
        const where = generatorRect ? zoneName(zoneOf(generatorRect.x, generatorRect.y)) : "";
        return "GENERATOR TRIPPED — RESTART IT IN " + where +
               (genRestart > 0 ? "  " + Math.floor(clamp(genRestart, 0, 1) * 100) + "%" : "");
    }
    if (now < hudAbsentUntil) {
        return "PERKS NOT ON THIS MAP: " + absentCardKeys().map(function (k) { return CARDS[k].name; }).join(" · ");
    }
    return endgameObjective();
}

// BOTTOM-LEFT LOADOUT (2026-09-18: "ammo + gun to a HUD at the bottom left
// with an icon for the active gun, a larger rounds-left readout", and
// "icons with a stack number for your perks next to it"). Each piece is
// rewritten only when its signature changes.
function updateLoadoutHud(me) {
    const key = me.downed ? (downedWeaponKey(me) || "") : currentWeaponKey(me);
    const w = WEAPONS[key];

    const gunSig = key + (me.downed ? ":down" : "");
    if (gunSig !== hudGunSig) {
        hudGunSig = gunSig;
        if (w) {
            uiGunIcon.src = iconUrl("gun", key, ICON_CYAN);
            uiGunIcon.width = 24 * 4;
            uiGunIcon.height = 8 * 4;
            uiGunIcon.style.visibility = "visible";
            uiGunName.innerText = w.name + (me.downed ? " — LAST STAND" : "");
        } else {
            uiGunIcon.style.visibility = "hidden";
            uiGunName.innerText = "DOWN";
        }
    }

    const ammoSig = w ? (w.infinite ? "inf" : String(me.ammo[key])) : "";
    if (ammoSig !== hudAmmoSig) {
        hudAmmoSig = ammoSig;
        uiAmmo.innerHTML = !w ? "--" : (w.infinite ? "&#8734;" : ammoSig);
        const low = w && !w.infinite && me.ammo[key] <= Math.max(3, w.capacity * 0.15);
        uiAmmo.className = low ? "low" : "";
    }

    // Every gun you own, with its number key; the one in your hands lit.
    let strip = "";
    for (let i = 0; i < WEAPON_KEYS.length; i++) {
        const k = WEAPON_KEYS[i];
        if (!ownsWeapon(me, k)) continue;
        const usable = weaponUsable(me, k);
        strip += k + (k === key ? "*" : "") + (usable ? "" : "!") + ",";
    }
    if (strip !== hudStripSig) {
        hudStripSig = strip;
        let h = "";
        for (let i = 0; i < WEAPON_KEYS.length; i++) {
            const k = WEAPON_KEYS[i];
            if (!ownsWeapon(me, k)) continue;
            const cls = "slot" + (k === key ? " on" : "") + (weaponUsable(me, k) ? "" : " dry");
            h += "<span class='" + cls + "'><i>" + (i + 1) + "</i>" + iconImg("gun", k, 1, k === key ? ICON_CYAN : "#5A8A96") + "</span>";
        }
        uiGunStrip.innerHTML = h;
    }

    // Perks: one tile per distinct perk, the icon with its stack under it.
    // me.cards is a flat array with repeats, so distinct-then-count.
    const held = [];
    for (let i = 0; i < me.cards.length; i++) {
        if (held.indexOf(me.cards[i]) === -1) held.push(me.cards[i]);
    }
    let perkSig = "";
    for (let i = 0; i < held.length; i++) perkSig += held[i] + cardLevel(me, held[i]) + ",";
    if (perkSig !== hudPerkSig) {
        hudPerkSig = perkSig;
        let h = "";
        for (let i = 0; i < CARD_SLOTS; i++) {
            const k = held[i];
            if (k) {
                h += "<span class='perk' title='" + CARDS[k].name + "'>" + iconImg("perk", k, 3) +
                     "<b>x" + cardLevel(me, k) + "</b></span>";
            } else {
                h += "<span class='perk empty'></span>";
            }
        }
        uiPerks.innerHTML = h;
    }
}

function renderScores() {
    const ids = Object.keys(scoreBoard);
    if (!ids.length) { uiScores.style.display = 'none'; return; }
    // SCORE is the full run score (runScoreFor) -- what would post to the
    // leaderboard if the run ended now -- not just the combat credit.
    const totals = {};
    for (let i = 0; i < ids.length; i++) totals[ids[i]] = runScoreFor(ids[i]).total;
    ids.sort(function (a, b) { return totals[b] - totals[a]; });

    let html = "<table><tr><th>PLAYER</th><th>KILLS</th><th>ASSIST</th><th>REVIVES</th><th>SCORE</th></tr>";
    for (let i = 0; i < ids.length; i++) {
        const s = scoreBoard[ids[i]];
        html += "<tr><td>" + playerName(ids[i]) + "</td><td>" + s.kills + "</td><td>" +
            s.assists + "</td><td>" + s.revives + "</td><td>" + fmtScore(totals[ids[i]]) + "</td></tr>";
    }
    html += "</table>";
    uiScores.innerHTML = html;
    uiScores.style.display = 'block';
}

function fmtScore(n) {
    return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ",");
}

// ---------------------------------------------------
//   END-CARD READOUT (2026-09-19)
// ---------------------------------------------------
// This player's run score, itemised, on whichever end card is showing --
// typed out a line at a time like a terminal printing a report. Each line's
// label types with a key-click per character, its number lands with a tone
// one step higher than the last, and the total comes last with a chord and
// a hum that takes ~8s to fade (the voices are in zombie-audio.js).
//
// The full text is laid out from the start with the untyped part hidden
// (.ghost), so the card is its final size before anything types and never
// reflows mid-readout. The score is computed once, when the card opens --
// nothing changes after the run ends.
//
// One chain of trackTimeout steps, each scheduling the next, so there is
// only ever one pending timer and stopRunScoreReadout() can cut it cleanly.
// A click still restarts straight away; resetGame() stops the readout.
const READOUT_START_MS = 1100;     // let the organ's end cue land first
const READOUT_CHAR_MS = 32;
const READOUT_NUM_CHAR_MS = 40;
const READOUT_LINE_GAP_MS = 320;
const READOUT_TOTAL_GAP_MS = 650;
const READOUT_TOTAL_CHAR_MS = 90;

let readoutTimer = 0;

function renderRunScore(el) {
    if (!el) return;
    stopRunScoreReadout();
    const b = runScoreFor(netIdFor(players[0]));
    const lines = [
        ["KILLS " + b.kills + " / REVIVES " + b.revives, fmtScore(b.combat), ""],
        ["ROUND " + b.round, fmtScore(b.roundPts), ""],
        ["SILOS " + b.silos + "/" + siloFill.length, fmtScore(b.siloPts), ""]
    ];
    if (b.won) {
        lines.push(["ESCAPED", "+" + fmtScore(b.winPts), "win"]);
        lines.push(["WIN DOUBLES IT", "x2", "win"]);
    }

    let html = "<table>";
    for (let i = 0; i < lines.length; i++) {
        html += "<tr class='" + lines[i][2] + "'><td></td><td class='pts'></td></tr>";
    }
    html += "</table><div class='totalline'><span class='lbl'></span><br><span class='total'></span></div>";
    el.innerHTML = html;

    const cells = el.querySelectorAll("td");
    const lbl = el.querySelector(".lbl");
    const total = el.querySelector(".total");

    // Build the whole readout as a flat list of [delay before, action].
    const steps = [];
    function typeInto(cell, text, charMs, click) {
        cell._text = text;
        setTyped(cell, 0, false);
        for (let n = 1; n <= text.length; n++) {
            steps.push([charMs, function () {
                setTyped(cell, n, n < text.length);
                if (click && text.charAt(n - 1) !== " ") sndReadoutKey();
            }]);
        }
    }

    for (let i = 0; i < lines.length; i++) {
        const at = steps.length;
        typeInto(cells[i * 2], lines[i][0], READOUT_CHAR_MS, true);
        typeInto(cells[i * 2 + 1], lines[i][1], READOUT_NUM_CHAR_MS, true);
        const line = i;
        steps.push([0, function () { sndReadoutLine(line, b.won); }]);
        steps[at][0] = i === 0 ? READOUT_START_MS : READOUT_LINE_GAP_MS;
    }
    const at = steps.length;
    typeInto(lbl, "FINAL SCORE", READOUT_CHAR_MS, true);
    steps[at][0] = READOUT_TOTAL_GAP_MS;
    typeInto(total, fmtScore(b.total), READOUT_TOTAL_CHAR_MS, true);
    steps.push([0, function () {
        total.classList.add("landed");
        sndReadoutFinal(b.won);
    }]);

    let k = 0;
    function next() {
        readoutTimer = 0;
        // Zero-delay steps run in the same tick as the one before them, so
        // a line's tone fires the moment its last digit appears.
        while (k < steps.length) {
            steps[k++][1]();
            if (k < steps.length && steps[k][0] > 0) {
                readoutTimer = trackTimeout(next, steps[k][0]);
                return;
            }
        }
    }
    readoutTimer = trackTimeout(next, steps[0][0]);
}

// Typed text, a block cursor over the next character, and the untyped rest
// held invisibly so the cell keeps its final width. Only digits, letters and
// "+/x," ever reach here, so no escaping is needed.
function setTyped(cell, n, cursor) {
    const t = cell._text;
    if (cursor && n < t.length) {
        cell.innerHTML = t.slice(0, n) + "<span class='cur'>" + t.charAt(n) +
            "</span><span class='ghost'>" + t.slice(n + 1) + "</span>";
    } else {
        cell.innerHTML = t.slice(0, n) + "<span class='ghost'>" + t.slice(n) + "</span>";
    }
}

// Restart, fold-back into a live room, or teardown mid-readout.
function stopRunScoreReadout() {
    if (readoutTimer) clearTimeout(readoutTimer);
    readoutTimer = 0;
    stopReadoutHum();
}

// ---------------------------------------------------
//   INPUT
// ---------------------------------------------------
// Every listener carries the shared AbortController's signal, per the
// project's teardown constraint.
const KEY_OPTS = { signal: zSignal() };

// PERK: DECOY hangs off the ping, but the host decides it (registerDecoy,
// via sendPing or the relayed ping), so nothing perk-shaped happens here.
function pingFrom(p) {
    // ROLE: SCOUT reaches twice as far.
    const reach = myRole() === "scout" ? 520 : 260;
    sendPing(
        p.x + p.size / 2 + p.facingX * reach,
        p.y + p.size / 2 + p.facingY * reach,
        p.color,
        MP.selfName || ""
    );
}

// ONE scheme per screen: WASD moves, the mouse aims, left button fires.
// The three-scheme couch co-op split (mouse-follow / WASD / arrows) was
// removed after playtesting -- it was too much to control, and two of the
// three schemes couldn't aim independently of movement.
//
// With one player owning the whole keyboard there's no longer any reason
// to hunt for non-colliding keys, so the verbs are the obvious ones.
const MOVE_KEYS = { w: 'up', s: 'down', a: 'left', d: 'right' };

window.addEventListener('keydown', function (e) {
    if (e.repeat) return;
    const key = e.key.toLowerCase();

    // Browsers refuse to start an AudioContext without a user gesture, so
    // every input doubles as the unlock.
    initAudio();

    // While the manual is up it owns the keyboard, so reading it can
    // never walk you into a wall.
    if (codexOpen) {
        if (key === 'escape' || key === 'f' || key === 'e') closeCodex();
        return;
    }

    // ESC: how to play, and the map's goals (2026-09-18). Same rules as the
    // manual -- it owns the keyboard while it is up. Works on the start
    // screen too, which is where a new player looks for it. (With the dev
    // panel up, the panel eats ESC itself and this never sees it.)
    if (helpOpen) {
        if (key === 'escape') closeHelp();
        return;
    }
    // Holding for a reconnect: nothing acts on a world that is not moving.
    // ENTER, once offered, carries on alone. ESC still opens the dialog.
    if (netLost) {
        if (key === 'enter' && Date.now() - netLostAt >= NET_LOST_OFFER_MS) { goSoloAfterLoss(); return; }
        if (key !== 'escape') return;
    }
    if (key === 'escape') {
        openHelp();
        return;
    }

    // M = map and stats (2026-09-18, on request). Mute moved to N.
    if (key === 'm') {
        toggleHudMap();
        return;
    }
    if (key === 'n') {
        const muted = toggleMute();
        uiAudio.innerText = muted ? "MUTED" : "SOUND ON";
        uiAudio.style.opacity = "1";
        trackTimeout(function () { uiAudio.style.opacity = "0"; }, 1400);
        return;
    }

    // 1-7 pick a gun you own. Never spawns you: it is not a "join" key.
    if (key >= '1' && key <= '7') {
        const p = players[0];
        if (p) selectWeapon(p, WEAPON_KEYS[key.charCodeAt(0) - 49]);
        return;
    }

    // WALKING OUT (2026-09-19): input is dead for the length of the win
    // sequence, as asked. Below the manual/MISSION/mute gates, so those all
    // still work, and above everything that acts on the world.
    if (winSequenceRunning()) return;

    const move = MOVE_KEYS[key];
    if (!move && key !== 'f' && key !== 'e' && key !== 'q') return;

    const p = players[0] || spawnPlayer();
    if (!p) return;

    if (move) p.keys[move] = true;
    else if ((key === 'f' || key === 'e') && !p.downed) interactWith(p);
    else if (key === 'q') pingFrom(p);
}, { signal: zSignal(), passive: false });

// The wheel cycles through the guns you own. Throttled, because one flick
// of a free-spinning wheel is a dozen events.
let wheelAt = 0;
window.addEventListener('wheel', function (e) {
    if (codexOpen || helpOpen || winSequenceRunning()) return;
    const p = players[0];
    if (!p || !e.deltaY) return;
    const now = Date.now();
    if (now - wheelAt < 90) return;
    wheelAt = now;
    cycleWeapon(p, e.deltaY > 0 ? 1 : -1);
}, { signal: zSignal(), passive: true });

window.addEventListener('keyup', function (e) {
    if (codexOpen || helpOpen || winSequenceRunning()) return;
    const p = players[0];
    if (!p) return;
    const move = MOVE_KEYS[e.key.toLowerCase()];
    if (move) p.keys[move] = false;
}, KEY_OPTS);

window.addEventListener('mousemove', function (e) {
    const w = screenToWorld(e.clientX, e.clientY);
    mouseX = w.x;
    mouseY = w.y;
}, KEY_OPTS);

window.addEventListener('mousedown', function (e) {
    initAudio();
    // Clicks belong to the manual's tabs while it is open -- otherwise
    // every tab press also fires the gun. The ESC dialog likewise.
    if (codexOpen || helpOpen || winSequenceRunning()) return;
    // `|| uiWinShown` fixes a real bug found 2026-09-19: the WIN card says
    // "Click anywhere to run it again" and could not be clicked. A win sets
    // `won`, never `gameOver`, so this only ever tested the LOSING card --
    // the winning one was a dead end you had to reload the page to leave.
    if (gameOver || uiWinShown) { requestReset(); return; }
    const p = players[0] || spawnPlayer();
    if (!p) return;
    if (e.button === 0) p.keys.shoot = true;
    else if (e.button === 1) { e.preventDefault(); pingFrom(p); }
}, KEY_OPTS);

window.addEventListener('mouseup', function (e) {
    if (codexOpen || helpOpen || winSequenceRunning()) return;
    const p = players[0];
    if (!p) return;
    if (e.button === 0) p.keys.shoot = false;
}, KEY_OPTS);

// Middle-click pings, so suppress the browser's own middle/right menus.
window.addEventListener('contextmenu', function (e) { e.preventDefault(); }, KEY_OPTS);
window.addEventListener('resize', resizeCanvas, KEY_OPTS);

// ---------------------------------------------------
//   BOOT
// ---------------------------------------------------
function gameLoop(ts) {
    // Scheduled FIRST, on purpose. It used to be the last statement, so
    // any exception thrown in update() or draw() meant the next frame was
    // never requested and the game froze dead rather than glitching for
    // one frame. Re-arming up front makes a transient error survivable.
    zRafHandle = requestAnimationFrame(gameLoop);

    const now = Date.now();
    const dt = lastFrame ? Math.min(100, now - lastFrame) : 16;
    lastFrame = now;
    zFrameCount++;                             // drives the flicker budget

    // Applied on a frame boundary rather than inside the message
    // handler, so a reset never lands mid-update with half the entity
    // arrays already iterated.
    if (pendingReset) {
        pendingReset = false;
        resetGame();
    }

    update(now, dt);
    // Driven from the LOOP, not from update(): update() returns early while
    // netLost, and a connection that drops during the walk-out must not
    // leave the world frozen half-faded with no card ever arriving.
    updateWinSequence(now);
    updateCamera(cameraTargets());
    draw();

    // Sustained audio is driven from state every frame rather than from
    // events -- it has to start AND stop, which one-shots can't express.
    // The score (zombie-music.js) schedules its next few beats here too; it
    // opens no timer of its own.
    updateBarricadeAudio();
    updateReviveAudio();
    musicUpdate(now, dt);
}

resizeCanvas();
generateLevel();
uiStats.style.display = hudMapOn ? "" : "none";
zRafHandle = requestAnimationFrame(gameLoop);
