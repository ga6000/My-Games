// ===================================================
//   Zombie — rendering, HUD, input, boot
// ===================================================
// Loads LAST. Everything here runs after the other files have declared
// their globals.
"use strict";

// ---------------------------------------------------
//   AESTHETIC (AESTHETIC_GUIDE.md §6.3 -- RASTER, Berzerk)
// ---------------------------------------------------
// Frame counter for the flicker budget (§4.7). Nothing else reads it, and
// it deliberately is NOT a timer -- it ticks once per rendered frame in
// gameLoop, so it needs no trackTimeout/trackInterval registration.
let zFrameCount = 0;

// Past this many zombies ON SCREEN, the overflow renders on alternating
// frames. Era hardware flickered when too many sprites shared a scanline;
// this adopts the vocabulary rather than simulating a glitch, and it
// genuinely halves the draw cost of a late-round horde.
const ZOMBIE_DRAW_CAP = 40;

// Four bands: lit / near / far / ambient. The era had no smooth gradients.
const LIGHT_BANDS = 4;

const uiTime = document.getElementById('scoreDisplay');
const uiZombies = document.getElementById('zombieCount');
const uiKills = document.getElementById('killCount');
const uiRound = document.getElementById('roundDisplay');
const uiScrap = document.getElementById('scrapDisplay');
const uiWeapon = document.getElementById('weaponDisplay');
const uiPrompt = document.getElementById('prompt');
const uiToast = document.getElementById('toast');
const uiRoundCard = document.getElementById('roundcard');
const uiScores = document.getElementById('scores');
const uiGameOver = document.getElementById('gameover');
const uiFinalRound = document.getElementById('finalRound');
const uiStart = document.getElementById('startprompt');
const uiCards = document.getElementById('cards');
const uiZone = document.getElementById('zonename');
const uiAudio = document.getElementById('audioState');
const uiWin = document.getElementById('win');
const uiWinRound = document.getElementById('winRound');
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
let codexOpen = false;
let codexTab = "weapons";

const CODEX_TABS = [
    ["weapons", "WEAPONS"],
    ["cards", "CARDS"],
    ["pickups", "PICKUPS"],
    ["enemies", "ENEMIES"],
    ["map", "THE MAP"]
];

function openCodex() {
    codexOpen = true;
    uiCodex.classList.add('open');
    renderCodex();
}

function closeCodex() {
    codexOpen = false;
    uiCodex.classList.remove('open');
    // Drop any keys held when it opened, or the player walks off on their
    // own the moment it closes.
    const p = players[0];
    if (p) { p.keys.up = p.keys.down = p.keys.left = p.keys.right = p.keys.shoot = false; }
}

function swatch(color) {
    return "<span class='swatch' style='background:" + color + "'></span>";
}

function codexWeapons() {
    let h = "<p class='lede'>One of each is sold somewhere on the map — never two. " +
            "The pistol is always with you and never runs dry.</p>" +
            "<table><tr><th>WEAPON</th><th>DAMAGE</th><th>RATE</th><th>RANGE</th><th>AMMO</th><th>NOTES</th></tr>";
    const order = ["pistol", "rifle", "shotgun", "smg", "sniper"];
    for (let i = 0; i < order.length; i++) {
        const k = order[i], w = WEAPONS[k];
        const buy = wallBuys.filter(function (b) { return b.weapon === k; })[0];
        const notes = [];
        if (w.pellets > 1) notes.push(w.pellets + " pellets");
        if (w.pierce) notes.push("pierces " + w.pierce);
        if (w.infinite) notes.push("never runs out");
        if (buy) notes.push("buy in " + zoneName(buy.zone) + " — " + buy.cost);
        h += "<tr><td class='k'>" + w.name + "</td><td class='n'>" + w.dmg +
             "</td><td class='n'>" + (1000 / w.cooldown).toFixed(1) + "/s</td><td class='n'>" + w.range +
             "</td><td class='n'>" + (w.infinite ? "&#8734;" : w.capacity) +
             "</td><td>" + notes.join(", ") + "</td></tr>";
    }
    return h + "</table>";
}

function codexCards() {
    let h = "<p class='lede'>Bought at card stations, which stay dead until the GENERATOR is running. " +
            "Three slots. Each card stacks to x" + CARD_MAX_STACK +
            ", and every stack costs more than the last (x1, x" + CARD_STACK_COST[1] +
            ", x" + CARD_STACK_COST[2] + ").</p>" +
            "<table><tr><th>CARD</th><th>EFFECT</th><th>ON THIS MAP</th></tr>";
    for (let i = 0; i < CARD_KEYS.length; i++) {
        const k = CARD_KEYS[i], c = CARDS[k];
        const st = cardStations.filter(function (s2) { return s2.card === k; })[0];
        h += "<tr><td class='k'>" + c.name + "</td><td>" + c.blurb + "</td><td>" +
             (st ? zoneName(st.zone) + " — " + st.cost : "not on this map") + "</td></tr>";
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
        spawnling: "What a splitter leaves behind."
    };
    let h = "<p class='lede'>HP shown for round 1; it rises every six rounds.</p>" +
            "<table><tr><th>ENEMY</th><th>HP</th><th>SPEED</th><th>SCRAP</th><th>BEHAVIOUR</th></tr>";
    for (let i = 0; i < Z_TYPE_KEYS.length; i++) {
        const k = Z_TYPE_KEYS[i], z = ZOMBIE_TYPES[k];
        h += "<tr><td class='k'>" + swatch(z.color) + k.toUpperCase() + "</td><td class='n'>" + z.hp +
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
           "even after it breaks. Re-board them free during the breather between rounds.</td></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_BUY) + "GENERATOR</td><td>Start it to light the map and switch on the card stations.</td></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_PICKUP) + "AMMO CRATE</td><td>Free, limited uses, refills what you carry.</td></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_TRAP) + "TRAP</td><td>Arm it with scrap to hurt everything that walks over it.</td></tr>" +
           "<tr><td class='k'>" + swatch(COLOR_BARREL) + "BARREL</td><td>Shoot it. It chains to nearby barrels.</td></tr>" +
           "</table>";
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
let beaconUntil = 0;

let mouseX = WORLD_W / 2;
let mouseY = WORLD_H / 2;

// ---------------------------------------------------
//   DRAW
// ---------------------------------------------------
function draw() {
    const now = Date.now();

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = "#000000";
    ctx.fillRect(0, 0, canvas.width, canvas.height);

    applyCameraTransform();

    // Only what's on screen. At 4800x2700 with ~200 zombies, drawing the
    // whole world every frame is most of the frame budget.
    const vr = viewRect();
    const pad = 120;
    const inView = function (x, y, w, h) {
        return x + w > vr.x - pad && x < vr.x + vr.w + pad &&
               y + h > vr.y - pad && y < vr.y + vr.h + pad;
    };

    drawGround(vr);

    // World border
    ctx.strokeStyle = COLOR_WALL;
    ctx.lineWidth = 3;
    ctx.strokeRect(0, 0, WORLD_W, WORLD_H);

    drawEndgame(now, inView);
    drawCodex(now, inView);
    drawTraps(now, inView);
    drawCrates(inView);
    drawBarrels(inView);
    drawGenerator(inView, now);
    drawCardStations(inView);
    drawWallBuys(inView);
    drawPickups(now, inView);
    drawWalls(inView);
    drawDoors(inView);
    drawBarricades(inView);
    drawBlasts(now);
    drawZombies(now, inView);
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
    drawMinimap();
    updateHud(now);
}

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
        const frac = b.hp / b.maxHp;
        const planks = 4;
        const shown = Math.max(1, Math.ceil(planks * frac));
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
        const spent = siloFill[i] >= SILO_CAPACITY;

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
            ctx.fillText("FUNNEL " + (i + 1) + " — " + siloFill[i] + "/" + SILO_CAPACITY, f.x, f.y - f.r - 10);
            ctx.textAlign = "left";
        }
    }

    // --- silos ---
    for (let i = 0; i < silos.length; i++) {
        const si = silos[i];
        if (!si || !inView(si.x, si.y, si.w, si.h)) continue;
        const frac = siloFill[i] / SILO_CAPACITY;

        ctx.fillStyle = "#160608";
        ctx.fillRect(si.x, si.y, si.w, si.h);
        // Blood level rises from the bottom.
        const h = si.h * frac;
        ctx.fillStyle = "#AA1122";
        ctx.fillRect(si.x + 3, si.y + si.h - h, si.w - 6, Math.max(0, h - 3));
        ctx.strokeStyle = siloFlipped[i] ? "#335533" : (siloReady(i) ? COLOR_BUY : "#884455");
        ctx.lineWidth = 3;
        ctx.strokeRect(si.x, si.y, si.w, si.h);

        ctx.fillStyle = siloFlipped[i] ? "#557755" : (siloReady(i) ? COLOR_BUY : "#CC6677");
        ctx.font = "9px Courier";
        ctx.textAlign = "center";
        ctx.fillText("SILO " + (i + 1), si.x + si.w / 2, si.y - 16);
        ctx.fillText(siloFlipped[i] ? "SPENT" : (siloReady(i) ? "[F] SWITCH" : siloFill[i] + "/" + SILO_CAPACITY),
                     si.x + si.w / 2, si.y - 5);
        ctx.textAlign = "left";
    }

    // --- the way out ---
    if (escapeRect && inView(escapeRect.x, escapeRect.y, escapeRect.w, escapeRect.h)) {
        const open = escapeOpen();
        const started = escapeAt > 0;
        ctx.fillStyle = open ? "#0A2A0A" : "#1A1A1A";
        ctx.fillRect(escapeRect.x, escapeRect.y, escapeRect.w, escapeRect.h);
        ctx.strokeStyle = open ? COLOR_BUY : (started ? "#AAAA55" : "#555555");
        ctx.lineWidth = 4;
        ctx.strokeRect(escapeRect.x, escapeRect.y, escapeRect.w, escapeRect.h);

        if (started && !open) {
            const total = ESCAPE_OPEN_MS;
            const frac = clamp(1 - (escapeAt - now) / total, 0, 1);
            ctx.fillStyle = "#AAAA55";
            ctx.fillRect(escapeRect.x, escapeRect.y - 14, escapeRect.w * frac, 8);
        }
        ctx.fillStyle = open ? COLOR_BUY : "#888888";
        ctx.font = "bold 12px Courier";
        ctx.textAlign = "center";
        ctx.fillText(open ? "ESCAPE" : "SEALED", escapeRect.x + escapeRect.w / 2, escapeRect.y + 42);
        ctx.textAlign = "left";
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

function drawWallBuys(inView) {
    for (let i = 0; i < wallBuys.length; i++) {
        const wb = wallBuys[i];
        if (!inView(wb.x, wb.y, wb.w, wb.h)) continue;
        ctx.fillStyle = "#003300";
        ctx.fillRect(wb.x, wb.y, wb.w, wb.h);
        ctx.strokeStyle = COLOR_BUY;
        ctx.lineWidth = 2;
        ctx.strokeRect(wb.x, wb.y, wb.w, wb.h);
        ctx.fillStyle = COLOR_BUY;
        ctx.font = "11px Courier";
        ctx.fillText(WEAPONS[wb.weapon].name, wb.x + 6, wb.y + 17);
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

    ctx.fillStyle = generatorOn ? "#224422" : "#332200";
    ctx.fillRect(g.x, g.y, g.w, g.h);
    ctx.strokeStyle = generatorOn ? COLOR_BUY : COLOR_PICKUP;
    ctx.lineWidth = 3;
    ctx.strokeRect(g.x, g.y, g.w, g.h);

    // Running generators pulse; dead ones sit there costing you light.
    if (generatorOn && now % 900 < 450) {
        ctx.strokeStyle = "#FFFFFF";
        ctx.lineWidth = 1;
        ctx.strokeRect(g.x - 5, g.y - 5, g.w + 10, g.h + 10);
    }
    ctx.fillStyle = generatorOn ? COLOR_BUY : COLOR_PICKUP;
    ctx.font = "bold 22px Courier";
    ctx.textAlign = "center";
    ctx.fillText("\u26A1", g.x + g.w / 2, g.y + g.h / 2 + 8);
    ctx.textAlign = "left";
}

function drawCardStations(inView) {
    for (let i = 0; i < cardStations.length; i++) {
        const st = cardStations[i];
        if (!inView(st.x, st.y, st.w, st.h)) continue;
        const live = generatorOn;
        ctx.fillStyle = live ? "#2A1436" : "#161616";
        ctx.fillRect(st.x, st.y, st.w, st.h);
        ctx.strokeStyle = live ? COLOR_POWERFUL : "#3A3A3A";
        ctx.lineWidth = 2;
        ctx.strokeRect(st.x, st.y, st.w, st.h);
        ctx.fillStyle = live ? "#FF99FF" : "#555555";
        ctx.font = "10px Courier";
        ctx.textAlign = "center";
        ctx.fillText(CARDS[st.card].name.slice(0, 8), st.x + st.w / 2, st.y + 17);
        ctx.fillText(live ? String(st.cost) : "NO PWR", st.x + st.w / 2, st.y + 31);
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

// Blocky sprites, at most three colours, on a flicker budget (§6.3, §4.7, §4.4).
function drawZombies(now, inView) {
    let onScreen = 0;

    for (let i = 0; i < zombies.length; i++) {
        const z = zombies[i];
        if (!inView(z.x, z.y, z.size, z.size)) continue;

        const screamer = z.type === "screamer";
        // Counted against zombies actually ON SCREEN, not the array index --
        // otherwise the budget would depend on where the camera is pointing.
        const slot = onScreen++;

        // Screamers are EXEMPT from the flicker budget. The white outline is
        // how you find the callout target in a crowd; a screamer rendering on
        // alternate frames is a gameplay regression wearing an aesthetic hat.
        if (!screamer && !RETRO.flicker(slot, ZOMBIE_DRAW_CAP, zFrameCount)) continue;

        // Render-space quantization ONLY (§4.4). z.x/z.y are never written --
        // physics and collision keep full precision, the same discipline as
        // Glucose Dash keeping its curve inside SX(). Quantizing the
        // simulation would produce collision bugs that present as gameplay bugs.
        const x = RETRO.snap(z.x, 4);
        const y = RETRO.snap(z.y, 4);
        const s = z.size;
        const flash = now < z.flashUntil;

        ctx.fillStyle = flash ? "#FFFFFF" : z.color;
        ctx.fillRect(x, y, s, s);

        if (!flash) {
            // Colour two of three: a hard-edged shadow band, no gradient. A
            // flat constant rather than a computed shade, because this runs
            // for every zombie on screen every frame.
            const band = Math.max(4, s >> 2);
            ctx.fillStyle = "rgba(0,0,0,0.38)";
            ctx.fillRect(x, y + s - band, s, band);
        }

        if (screamer) {
            ctx.strokeStyle = "#FFFFFF";
            ctx.lineWidth = 1;
            ctx.strokeRect(x - 3, y - 3, s + 6, s + 6);
        }
    }
}

function drawBullets(inView) {
    for (let i = 0; i < bullets.length; i++) {
        const b = bullets[i];
        if (!inView(b.x, b.y, b.size, b.size)) continue;
        ctx.fillStyle = b.ownerColor;
        ctx.fillRect(b.x, b.y, b.size, b.size);
    }
    for (let i = 0; i < remoteBullets.length; i++) {
        const b = remoteBullets[i];
        if (!inView(b.x, b.y, b.size, b.size)) continue;
        ctx.fillStyle = b.ownerColor;
        ctx.fillRect(b.x, b.y, b.size, b.size);
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
        const w = 40;
        ctx.fillStyle = "#330000";
        ctx.fillRect(p.x + p.size / 2 - w / 2, p.y - 14, w, 5);
        ctx.fillStyle = COLOR_BUY;
        ctx.fillRect(p.x + p.size / 2 - w / 2, p.y - 14, w * clamp(p.reviveProgress || 0, 0, 1), 5);
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
    for (let i = 0; i < players.length; i++) drawPlayerBody(players[i], now, null);
}

function drawRemotePlayers(now, inView) {
    for (const id in remotePlayers) {
        if (!Object.prototype.hasOwnProperty.call(remotePlayers, id)) continue;
        const r = remotePlayers[id];
        if (!inView(r.x, r.y, r.size, r.size)) continue;
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
    if (!me) {
        ctx.fillStyle = "rgba(0,0,0," + dark + ")";
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        return;
    }

    const c = worldToScreen(me.x + me.size / 2, me.y + me.size / 2);
    const inner = (me.downed ? LIGHT_RADIUS * 0.55 : LIGHT_RADIUS) * camera.scale;
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

        const urgent = !!t.downed;
        ctx.save();
        ctx.translate(ex, ey);
        ctx.rotate(ang);
        ctx.fillStyle = urgent
            ? ((now % 400 < 200) ? "#FFFFFF" : COLOR_DOWNED)
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

    // CARD: BEACON -- a ping lights every zombie on the minimap briefly.
    const beacon = Date.now() < beaconUntil;
    ctx.fillStyle = beacon ? "#FFFFFF" : COLOR_ZOMBIE;
    const zs = beacon ? 3 : 2;
    for (let i = 0; i < zombies.length; i++) {
        ctx.fillRect(ox + zombies[i].x * sx, oy + zombies[i].y * sy, zs, zs);
    }

    if (generatorRect) {
        ctx.fillStyle = generatorOn ? COLOR_BUY : COLOR_PICKUP;
        ctx.fillRect(ox + generatorRect.x * sx - 2, oy + generatorRect.y * sy - 2, 5, 5);
    }
    ctx.fillStyle = COLOR_POWERFUL;
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
        ctx.fillStyle = r.downed ? COLOR_DOWNED : (r.color || "#55FFFF");
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
    if (me) {
        const key = currentWeaponKey(me);
        const w = WEAPONS[key];
        const ammo = w.infinite ? "∞" : String(me.ammo[key]);
        uiWeapon.innerText = w.name + " " + ammo;
        const prompt = me.downed ? "" : nearestPrompt(me);
        uiPrompt.innerText = prompt;
        uiPrompt.style.display = prompt ? 'block' : 'none';

        // One chip per distinct card, with its stack level above it.
        // me.cards is a flat array with repeats, so distinct-then-count.
        const held = [];
        for (let i = 0; i < me.cards.length; i++) {
            if (held.indexOf(me.cards[i]) === -1) held.push(me.cards[i]);
        }
        let ch = "";
        for (let i = 0; i < CARD_SLOTS; i++) {
            const key = held[i];
            if (key) {
                ch += "<span class='card'><b>" + cardLevel(me, key) + "</b>" +
                      CARDS[key].name + "</span>";
            } else {
                ch += "<span class='card empty'>-- --</span>";
            }
        }
        uiCards.innerHTML = ch;
    } else {
        uiWeapon.innerText = "--";
        uiPrompt.style.display = 'none';
    }

    uiRole.innerText = ROLES[myRole()].name;
    const obj = endgameObjective();
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

function renderScores() {
    const ids = Object.keys(scoreBoard);
    if (!ids.length) { uiScores.style.display = 'none'; return; }
    ids.sort(function (a, b) { return scoreBoard[b].score - scoreBoard[a].score; });

    let html = "<table><tr><th>PLAYER</th><th>KILLS</th><th>ASSIST</th><th>REVIVES</th><th>SCORE</th></tr>";
    for (let i = 0; i < ids.length; i++) {
        const s = scoreBoard[ids[i]];
        html += "<tr><td>" + playerName(ids[i]) + "</td><td>" + s.kills + "</td><td>" +
            s.assists + "</td><td>" + s.revives + "</td><td>" + s.score + "</td></tr>";
    }
    html += "</table>";
    uiScores.innerHTML = html;
    uiScores.style.display = 'block';
}

// ---------------------------------------------------
//   INPUT
// ---------------------------------------------------
// Every listener carries the shared AbortController's signal, per the
// project's teardown constraint.
const KEY_OPTS = { signal: zSignal() };

function pingFrom(p) {
    // CARD: BEACON.
    if (hasCard(p, "beacon")) beaconUntil = Date.now() + 5000;
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

    if (key === 'm') {
        const muted = toggleMute();
        uiAudio.innerText = muted ? "MUTED" : "SOUND ON";
        uiAudio.style.opacity = "1";
        trackTimeout(function () { uiAudio.style.opacity = "0"; }, 1400);
        return;
    }

    const move = MOVE_KEYS[key];
    if (!move && key !== 'f' && key !== 'e' && key !== 'q') return;

    const p = players[0] || spawnPlayer();
    if (!p) return;

    if (move) p.keys[move] = true;
    else if ((key === 'f' || key === 'e') && !p.downed) interactWith(p);
    else if (key === 'q') pingFrom(p);
}, { signal: zSignal(), passive: false });

window.addEventListener('keyup', function (e) {
    if (codexOpen) return;
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
    // every tab press also fires the gun.
    if (codexOpen) return;
    if (gameOver) { requestReset(); return; }
    const p = players[0] || spawnPlayer();
    if (!p) return;
    if (e.button === 0) p.keys.shoot = true;
    else if (e.button === 1) { e.preventDefault(); pingFrom(p); }
}, KEY_OPTS);

window.addEventListener('mouseup', function (e) {
    if (codexOpen) return;
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
    updateCamera(cameraTargets());
    draw();

    // Sustained audio is driven from state every frame rather than from
    // events -- it has to start AND stop, which one-shots can't express.
    updateBarricadeAudio();
    updateReviveAudio();
    updateIntensityAudio();
}

resizeCanvas();
generateLevel();
zRafHandle = requestAnimationFrame(gameLoop);
