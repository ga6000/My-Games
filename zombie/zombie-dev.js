/**
 * Zombie — dev tools registration (2026-09-07)
 *
 * Everything the L+G panel shows and does for this game. Kept in its own file
 * for one reason: it should be deletable by removing a single <script> tag,
 * without a diff anywhere in the gameplay files.
 *
 * Loads LAST, after zombie-render.js. Only registration runs at load — the
 * callbacks below all execute later, so the names they read (round, zombies,
 * netIsHost, ...) are long since declared by the time any of them fires. One
 * exception (2026-09-18): three gameplay functions are WRAPPED at load for the
 * FREE BUYS / NO ZOMBIES toggles -- another reason this file must load last.
 * With both toggles off, the wrappers call straight through.
 *
 * ---------------------------------------------------------------------------
 * THIS GAME DOES NOT PAUSE WHILE THE PANEL IS OPEN
 * ---------------------------------------------------------------------------
 * The host simulates for the whole room. Pausing it locally would freeze
 * everybody else — the same call the field manual already makes for itself
 * ("The round does not pause while you read this"). onOpen therefore only
 * releases the local player's held keys, which is the one thing that would
 * otherwise leave someone walking into a wall behind the overlay.
 *
 * HOST-GATED ACTIONS. Round state, the zombie array and the scrap pool are all
 * host-authoritative — a guest writing to them locally gets one frame of a
 * lie, then the next broadcast overwrites it. Those buttons say so and return
 * a reason rather than pretending to work, because a dev button that silently
 * no-ops is worse than no button.
 */
"use strict";

// Toggled by the panel. Read nowhere else: god mode here is just a very long
// invulnerability window, which the game already understands natively.
var zDevGodOn = false;
var zDevPerkIdx = -1;

// ---------------------------------------------------------------------------
// FREE BUYS and NO ZOMBIES (2026-09-18, asked for mid-playtest: "without
// having to spam click the +500 scrap button").
//
// WRAPS, NOT HOOKS. This file has to stay deletable by removing its script
// tag, with no diff in any gameplay file -- so rather than add a dev flag to
// the gameplay code, the toggles wrap the functions every caller already
// reaches through the global binding:
//
//   hostHandleBuy        every purchase in the game, host-validated
//   spawnZombie          rounds, stragglers, screamer summons, spawnlings
//   spawnZombieAt        the flood
//   nearestPrompt        only to add "[DEV: FREE]" after a price
//
// Both are HOST-side functions, so both toggles are host-gated like the other
// world buttons: on the host they cover the whole room (a guest's buys are
// validated by the host's wrapped copy, and so are free too).
//
// With NO ZOMBIES on, a round cannot spend its budget, so it simply stays
// active: nothing spawns, nothing clears, no Blackout comes round. SPAWN
// TARGETS goes around the wrapper on purpose, so there is still something to
// shoot at.
// ---------------------------------------------------------------------------
var zDevFreeBuys = false;
var zDevNoZombies = false;
var zDevOrigHostHandleBuy = hostHandleBuy;
var zDevOrigSpawnZombie = spawnZombie;
var zDevOrigSpawnZombieAt = spawnZombieAt;

hostHandleBuy = function (msg) {
    if (!zDevFreeBuys) return zDevOrigHostHandleBuy(msg);
    // Every price check and every deduction in hostHandleBuy reads
    // scrapPool, so lend it an amount no price reaches, then put the real
    // pool back exactly as it was.
    const real = scrapPool;
    scrapPool = 1e12;
    try { return zDevOrigHostHandleBuy(msg); }
    finally { scrapPool = real; }
};

// Prompts still quote the real price with FREE BUYS on; say it is free, or
// a playtester reasonably wonders whether they were just charged.
var zDevOrigNearestPrompt = nearestPrompt;
nearestPrompt = function (p) {
    const s = zDevOrigNearestPrompt(p);
    return (zDevFreeBuys && s && / — \d/.test(s)) ? s + "  [DEV: FREE]" : s;
};

spawnZombie = function (type, roundNo) {
    return zDevNoZombies ? null : zDevOrigSpawnZombie(type, roundNo);
};

spawnZombieAt = function (type, roundNo, x, y) {
    return zDevNoZombies ? null : zDevOrigSpawnZombieAt(type, roundNo, x, y);
};

function zDevPlayer() {
    return players[0] || null;
}

function zDevHostOnly(what) {
    return netIsHost ? null : (what + " — HOST ONLY (this client is a guest)");
}

function zDevReport() {
    const p = zDevPlayer();
    const now = Date.now();
    const rows = [
        ["dev toggles", "free buys " + (zDevFreeBuys ? "ON" : "off") +
                        "   no zombies " + (zDevNoZombies ? "ON" : "off")],
        ["round", round + "  (" + roundPhase + ", " + roundLabel(round) + ")"],
        ["budget left", roundBudget + (roundPhase === "intermission"
            ? "   next in " + Math.max(0, Math.ceil((roundEndsAt - now) / 1000)) + "s" : "")],
        ["zombies", zombies.length],
        ["bullets", bullets.length + " local / " + remoteBullets.length + " remote"],
        ["pickups", pickups.length],
        ["kills / scrap", kills + " / " + scrapPool],
        ["players", players.length + " local, " + Object.keys(remotePlayers).length + " remote"]
    ];

    if (p) {
        rows.push(["you", (p.downed ? "DOWNED" : "up") +
                          "   " + currentWeaponKey(p) +
                          "   owns " + (Object.keys(p.owned || {}).join(",") || "pistol only")]);
        rows.push(["perks", p.cards.length ? p.cards.join(",") : "none"]);
        rows.push(["ammo", JSON.stringify(p.ammo)]);
        rows.push(["god mode", zDevGodOn ? "ON" : "off"]);
    } else {
        rows.push(["you", zAwaitRespawn ? "BLED OUT — back at round " + zDiedRound + "'s breather"
                                        : "not spawned — move or click to join"]);
    }

    rows.push(["lights", generatorOn ? "GENERATOR ON" : (genTripped ? "TRIPPED " + Math.round(genRestart * 100) + "%" : "dark")]);
    rows.push(["perks on map", cardStations.map(function (s) { return s.card; }).join(",") +
                               "   absent " + absentCardKeys().join(",")]);
    rows.push(["ultras", countZombies("ultra") + " alive, " + ultraOwed + " owed this round"]);
    rows.push(["endgame", "gate " + gateStage + "/" + GATE_STAGES +
                          "   silos " + siloFill.join("/") +
                          "   flood " + (floodActive ? floodRemaining : "no") +
                          "   escape " + (escapeAt ? (escapeOpen() ? "OPEN" : "opening") : "no")]);
    rows.push(["state", (gameStarted ? "started" : "menu") +
                        (gameOver ? " GAME OVER" : "") + (won ? " WON" : "")]);
    rows.push(["net", (netOnline ? "online" : "solo") +
                      (netIsHost ? " HOST" : " guest") +
                      "   room " + ((typeof MP !== "undefined" && MP.room) || "-") +
                      "   as " + ((typeof MP !== "undefined" && MP.selfName) || "-")]);
    return rows;
}

var zDevActions = [
    {
        label: "FREE BUYS",
        hint: "toggle — host only",
        fn: function () {
            const no = zDevHostOnly("free buys");
            if (no) return no;
            zDevFreeBuys = !zDevFreeBuys;
            return zDevFreeBuys ? "ON — doors, guns, perks, generator, traps cost nothing"
                                : "off";
        }
    },
    {
        label: "NO ZOMBIES",
        hint: "toggle — host only",
        fn: function () {
            const no = zDevHostOnly("no zombies");
            if (no) return no;
            zDevNoZombies = !zDevNoZombies;
            if (zDevNoZombies) zombies.length = 0;
            return zDevNoZombies ? "ON — field cleared, nothing spawns (rounds hold)" : "off — spawning resumes";
        }
    },
    {
        label: "SPAWN TARGETS",
        hint: "host only — 8 that stand still",
        fn: function () {
            const no = zDevHostOnly("targets");
            if (no) return no;
            const p = zDevPlayer();
            if (!p) return "no local player";
            // An arc in front of wherever you are aiming, clear of walls.
            // Stationary (speedMult 0) and silent, so they are dummies: the
            // progress watchdog expects no travel from a zombie that cannot
            // move, and never relocates them.
            const kinds = ["walker", "walker", "brute", "walker", "splitter", "walker", "brute", "walker"];
            const base = Math.atan2(p.facingY, p.facingX);
            let made = 0;
            for (let i = 0; i < kinds.length; i++) {
                const a = base + (i - 3.5) * 0.18;
                const size = ZOMBIE_TYPES[kinds[i]].size;
                const x = p.x + p.size / 2 + Math.cos(a) * 230 - size / 2;
                const y = p.y + p.size / 2 + Math.sin(a) * 230 - size / 2;
                if (blockedAt(x, y, size, true)) continue;
                const z = zDevOrigSpawnZombieAt(kinds[i], Math.max(1, round), x, y);
                z.speedMult = 0;
                z.nextScream = Infinity;
                made++;
            }
            return made + " targets placed" + (made < kinds.length ? " (" + (kinds.length - made) + " blocked by walls)" : "");
        }
    },
    {
        label: "ROUND +1",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("round advance");
            if (no) return no;
            zombies.length = 0;
            startRound(round + 1);
            return "now round " + round;
        }
    },
    {
        label: "CLEAR ZOMBIES",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("clear");
            if (no) return no;
            const n = zombies.length;
            zombies.length = 0;
            return n + " removed";
        }
    },
    {
        label: "END ROUND",
        hint: "clears + empties budget",
        fn: function () {
            const no = zDevHostOnly("end round");
            if (no) return no;
            zombies.length = 0;
            roundBudget = 0;
            // The normal path: update() sees an empty field and no budget left
            // and calls endRound() itself, so the breather, the pickup and the
            // barricade repair all happen exactly as they would in play.
            return "field cleared, budget zeroed — round will end itself";
        }
    },
    {
        label: "RESET GAME",
        hint: "back to the start screen",
        danger: true,
        fn: function () {
            resetGame();
            return "reset";
        }
    },
    {
        label: "GOD MODE",
        hint: "toggle",
        fn: function () {
            zDevGodOn = !zDevGodOn;
            const p = zDevPlayer();
            // The game already gates downPlayer() on invulnUntil, so this
            // needs no gameplay edit at all — it is the mercy window from a
            // revive, held open indefinitely.
            if (p) p.invulnUntil = zDevGodOn ? Number.MAX_SAFE_INTEGER : 0;
            return zDevGodOn ? "ON" : "off";
        }
    },
    {
        label: "HEAL / REVIVE",
        fn: function () {
            const p = zDevPlayer();
            if (!p) return "no local player";
            p.downed = false;
            p.bleedDeadline = 0;
            p.reviveProgress = 0;
            p.invulnUntil = Math.max(p.invulnUntil, Date.now() + 3000);
            return "up, 3s mercy";
        }
    },
    {
        label: "REFILL AMMO",
        fn: function () {
            const p = zDevPlayer();
            if (!p) return "no local player";
            refillAmmo(p);
            return "full";
        }
    },
    {
        label: "+500 SCRAP",
        hint: "host only",
        fn: function () {
            // Spending is host-validated for a real reason (two clients
            // pressing buy on the same frame both pass a local affordability
            // check), so granting has to be too.
            const no = zDevHostOnly("scrap");
            if (no) return no;
            scrapPool += 500;
            return "pool now " + scrapPool;
        }
    },
    {
        label: "LIGHTS",
        hint: "toggle generator",
        fn: function () {
            generatorOn = !generatorOn;
            if (generatorOn) { genTripped = false; genRestart = 0; }
            return generatorOn ? "lit" : "dark";
        }
    },
    {
        label: "TRIP GENERATOR",
        hint: "host only — what a Blackout does",
        fn: function () {
            const no = zDevHostOnly("trip");
            if (no) return no;
            if (!generatorOn) return "start the generator first (LIGHTS)";
            tripGenerator();
            return "tripped — stand at it " + (GEN_RESTART_MS / 1000) + "s to restart";
        }
    },
    {
        label: "SPAWN ULTRA",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("ultra");
            if (no) return no;
            const z = spawnZombie("ultra", Math.max(round, ULTRA_FROM_ROUND));
            if (!z) return "no legal spawn point";
            hostEvent(SND_ULTRA, z.x, z.y, 0);
            return "one ULTRA HEAVY in " + zoneName(zoneOf(z.x, z.y));
        }
    },
    {
        label: "GIVE ALL GUNS",
        fn: function () {
            const p = zDevPlayer();
            if (!p) return "no local player";
            for (let i = 1; i < WEAPON_KEYS.length; i++) {
                const k = WEAPON_KEYS[i];
                p.owned[k] = true;
                p.ammo[k] = WEAPONS[k].capacity;
            }
            p.weapon = "rocket";
            return "all seven — 1-7 or the wheel";
        }
    },
    {
        label: "NEXT PERK",
        hint: "adds a stack, cycles all 11",
        fn: function () {
            const p = zDevPlayer();
            if (!p) return "no local player";
            // Straight into p.cards, like applyPurchase does, ignoring price,
            // power and slots -- this is for looking at perks, not buying them.
            zDevPerkIdx = (zDevPerkIdx + 1) % CARD_KEYS.length;
            const k = CARD_KEYS[zDevPerkIdx];
            if (cardLevel(p, k) < CARD_MAX_STACK) p.cards.push(k);
            return k + " x" + cardLevel(p, k);
        }
    },
    {
        label: "CLEAR PERKS",
        fn: function () {
            const p = zDevPlayer();
            if (!p) return "no local player";
            p.cards = [];
            return "none";
        }
    },
    {
        label: "CALL THE HORDE",
        hint: "host only — the intensify switch, from anywhere",
        fn: function () {
            const no = zDevHostOnly("intensify");
            if (no) return no;
            if (intensified) return "already called";
            // Exactly what the switch in the keep does, so a playtester can
            // reach the blitz without walking back to the keep first -- and
            // so the announce beats can be checked on demand.
            hostFlipIntensify({ id: netIdFor(zDevPlayer()) });
            return "called";
        }
    },
    {
        label: "OPEN SLUICE",
        hint: "host only — skips the 2-player gate",
        fn: function () {
            const no = zDevHostOnly("sluice");
            if (no) return no;
            if (gateStage >= GATE_STAGES) return "already open";
            // The gate is the one mechanic that is strictly impossible alone
            // (two plates, too far apart for one body), so a solo playtester
            // cannot otherwise see anything past it. This mirrors exactly what
            // updateGate() does on completion.
            gateStage = GATE_STAGES;
            gateProgress = 0;
            funnelActive[0] = true;
            if (sluiceGate) {
                sluiceGate.open = true;
                rebuildSolidIndex();
            }
            return "gate open, funnel 1 live";
        }
    },
    {
        label: "FILL SILOS",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("silos");
            if (no) return no;
            for (let i = 0; i < siloFill.length; i++) siloFill[i] = siloCapacity(i);
            return "all three full — throw the switches";
        }
    },
    {
        label: "START FLOOD",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("flood");
            if (no) return no;
            startFlood();
            return floodRemaining + " incoming";
        }
    },
    {
        label: "OPEN ESCAPE",
        hint: "host only — skips the 90s wait",
        fn: function () {
            const no = zDevHostOnly("escape");
            if (no) return no;
            escapeAt = Date.now();
            return "south gate open";
        }
    }
];

if (typeof DEVTOOLS !== "undefined") {
    DEVTOOLS.init({
        game: "zombie",
        onOpen: function () {
            // Not a pause: see the header. Just let go of what was held, or
            // the player keeps walking behind the overlay.
            const p = zDevPlayer();
            if (p) p.keys = { up: false, down: false, left: false, right: false, shoot: false };
        },
        report: zDevReport,
        actions: zDevActions
    });
}
