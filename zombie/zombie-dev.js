/**
 * Zombie — dev tools registration (2026-09-07; reworked 2026-10-11)
 *
 * Everything the L+G panel shows and does for this game. Kept in its own file
 * for one reason: it should be deletable by removing a single <script> tag,
 * without a diff anywhere in the gameplay files.
 *
 * Loads LAST, after zombie-render.js. Only registration runs at load — the
 * callbacks below all execute later, so the names they read are long since
 * declared by the time any of them fires. One exception: two gameplay
 * functions are WRAPPED at load for the NO ZOMBIES toggle (which
 * zombie-sandbox.js and zombie-mapedit.js also read) -- another reason this
 * file must load last. With the toggle off, the wrappers call straight through.
 *
 * 2026-10-11 CLEAN-OUT ("remove stale/obsolete items"). The arcade has no
 * rounds, scrap, generator, sluice, horde switch, flood or shop, so these are
 * gone: FREE BUYS (and its hostHandleBuy / nearestPrompt wrappers), ROUND +1,
 * END ROUND, +500 SCRAP, LIGHTS, TRIP GENERATOR, CALL THE HORDE, OPEN SLUICE,
 * START FLOOD, and NEXT PERK (a cycler, replaced by one button per perk, with
 * its icon). Perks that cannot drop here (SCAVENGER, CONDUCTOR, DECOY) get no
 * button. The state readout lost the same rows.
 *
 * ---------------------------------------------------------------------------
 * THIS GAME DOES NOT PAUSE WHILE THE PANEL IS OPEN
 * ---------------------------------------------------------------------------
 * The host simulates for the whole room. Pausing it locally would freeze
 * everybody else, so onOpen only releases the local player's held keys.
 *
 * HOST-GATED ACTIONS. The zombie array, the chain and the level are
 * host-authoritative — a guest writing to them locally gets one frame of a
 * lie, then the next broadcast overwrites it. Those buttons say so and return
 * a reason rather than pretending to work.
 */
"use strict";

// Toggled by the panel. God mode here is just a very long invulnerability
// window, which the game already understands natively.
var zDevGodOn = false;

// NO ZOMBIES (2026-09-18). WRAPS, NOT HOOKS, so this file stays deletable
// with no diff in any gameplay file: spawnZombie (screamer summons, spawnling
// births, the old placer) and spawnZombieAt (the arcade wave and FLARE) are
// both host-side, so the toggle is host-gated and covers the whole room.
// SPAWN TARGETS goes round the wrapper on purpose, so there is still
// something to shoot at.
var zDevNoZombies = false;
var zDevOrigSpawnZombie = spawnZombie;
var zDevOrigSpawnZombieAt = spawnZombieAt;

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
        ["dev toggles", "no zombies " + (zDevNoZombies ? "ON" : "off") + "   god " + (zDevGodOn ? "ON" : "off")],
        ["map", "level " + arcLevelNo + "   " + funnels.length + " tanks   clock " + arcadeClock(now) +
                "   wave level " + arcadeLevel(now)],
        ["spawn", "x" + arcadeSpawnRate(arcadeElapsedS(now), now).toFixed(2) + "/s base" +
                  (now < arcLullUntil ? "   LULL " + Math.ceil((arcLullUntil - now) / 1000) + "s" : "") +
                  "   cap " + arcadeAliveCap()],
        ["field", zombies.length + " zombies, " + bullets.length + " local / " + remoteBullets.length + " remote bullets, " +
                  pickups.length + " drops, " + arcTurrets.length + " turrets" +
                  (freezeZone && now < freezeZone.until ? ", FROZEN" : "")],
        ["kills", kills],
        ["players", players.length + " local, " + Object.keys(remotePlayers).length + " remote"]
    ];

    if (p) {
        rows.push(["you", (p.downed ? "DOWNED" : "up") + "   " + currentWeaponKey(p) +
                          "   owns " + (Object.keys(p.owned || {}).join(",") || "pistol only")]);
        const stacks = [];
        const seen = {};
        for (let i = 0; i < p.cards.length; i++) {
            if (seen[p.cards[i]]) continue;
            seen[p.cards[i]] = 1;
            stacks.push(p.cards[i] + " x" + cardLevel(p, p.cards[i]));
        }
        rows.push(["perks", stacks.length ? stacks.join(", ") : "none"]);
        rows.push(["powerups", "boomgun " + (p.boomUntil > now ? Math.ceil((p.boomUntil - now) / 1000) + "s" : "no") +
                               "   turret " + (p.turretHeld ? (p.turretArmed ? "armed" : "held") : "no") +
                               "   slow " + (p.slowUntil > now ? "yes" : "no") + "   jam " + (p.jamUntil > now ? "yes" : "no")]);
        rows.push(["ammo", JSON.stringify(p.ammo)]);
    } else {
        rows.push(["you", zAwaitRespawn ? "DOWN — respawning" : "not spawned — move or click to join"]);
    }

    rows.push(["chain", "silos " + siloFill.join("/") + " of " + siloCapacityList() +
                        "   switches " + siloFlipped.map(function (f) { return f ? "T" : "-"; }).join("") +
                        "   gate " + (escapeAt ? (escapeOpen() ? "OPEN" : "opening") : "shut")]);
    rows.push(["state", (gameStarted ? "started" : "menu") + (gameOver ? " GAME OVER" : "") + (won ? " WON" : "")]);
    rows.push(["net", (netOnline ? "online" : "solo") + (netIsHost ? " HOST" : " guest") +
                      "   room " + ((typeof MP !== "undefined" && MP.room) || "-") +
                      "   as " + ((typeof MP !== "undefined" && MP.selfName) || "-")]);
    return rows;
}

function siloCapacityList() {
    const out = [];
    for (let i = 0; i < funnels.length; i++) out.push(siloCapacity(i));
    return out.join("/");
}

// One press, one link of the chain: fill the live tank, throw its switch,
// then open the gate. Each case goes through the real function where one
// exists (flipSilo).
function zDevAdvanceChain() {
    if (won) return "already won";
    for (let i = 0; i < siloFill.length; i++) {
        if (siloFlipped[i]) continue;
        if (siloFill[i] < siloCapacity(i)) {
            funnelActive[i] = true;
            siloFill[i] = siloCapacity(i);
            return "tank " + (i + 1) + " full";
        }
        flipSilo(i);
        return "tank " + (i + 1) + " switch thrown (pulse)";
    }
    if (escapeAt && !escapeOpen()) {
        escapeAt = Date.now();
        return "gate open";
    }
    return "nothing left to advance";
}

// What the slider's current value does, for the log: the head start each
// hard map begins on the curve, and the spawn rate / alive cap multipliers.
function zDevDifficultyNote() {
    const D = arcDifficulty;
    const off = function (lv) { const L = ARENA_LAYOUTS[lv]; return Math.round(L.clock * (lv >= 3 ? D : 1 + 0.2 * (D - 1))); };
    return "map 2 starts at " + off(2) + "s, map 3 at " + off(3) + "s, boss at " + off(4) + "s;" +
           " rate x" + (1 + 0.1 * (D - 1)).toFixed(2) + " on 1-2, x" + D.toFixed(2) + " on 3-4;" +
           " cap x" + (0.7 + 0.3 * D).toFixed(2) + " on 3-4;" +
           " the curve runs at x" + Math.max(0.2, ARENA_LAYOUTS[3].pace * D).toFixed(2) + " speed inside them";
}

var zDevActions = [
    {
        slider: true,
        label: "DIFFICULTY",
        hint: "live — maps 3 and 4 take it whole, 1 and 2 barely move. Double-click: back to default",
        min: ARC_DIFF_MIN,
        max: ARC_DIFF_MAX,
        step: 0.05,
        def: ARC_DIFF_DEFAULT,
        value: function () { return arcDifficulty; },
        ticks: [
            { v: 0.5, label: "0.50" + String.fromCharCode(10) + "CASUAL" },
            { v: 0.75, label: "0.75" + String.fromCharCode(10) + "EASY" },
            { v: 1.0, label: "1.00" + String.fromCharCode(10) + "DEFAULT" },
            { v: 1.25, label: "1.25" + String.fromCharCode(10) + "HARD" },
            { v: 1.5, label: "1.50" + String.fromCharCode(10) + "BRUTAL" }
        ],
        format: function (v) { return v.toFixed(2); },
        onInput: function (v) {
            if (!netIsHost) return "HOST ONLY — the host's value replaces this one every snapshot";
            arcadeSetDifficulty(v);
            return zDevDifficultyNote();
        }
    },
    {
        label: "BOOMGUN",
        hint: "15s powerup — hold the trigger",
        icon: iconUrl("gun", "boomgun", "#FFB000"),
        fn: function () {
            const p = zDevPlayer();
            if (!p) return "no local player";
            const total = arcadeBoomGrant(p, Date.now());
            return Math.round(total / 1000) + "s banked (stacks) — spin up takes 1s, then it climbs to a shot every " + BOOM_CD_MIN + "ms";
        }
    },
    {
        label: "TURRET",
        hint: "carried, armed — click to place",
        fn: function () {
            const p = zDevPlayer();
            if (!p) return "no local player";
            p.turretHeld = true;
            p.turretArmed = true;
            return "in hand — click to place, T stows";
        }
    },
    {
        label: "FREEZE",
        hint: "host only — at your feet",
        fn: function () {
            const no = zDevHostOnly("freeze");
            if (no) return no;
            const p = zDevPlayer();
            if (!p) return "no local player";
            arcadeFreeze(p.x + p.size / 2, p.y + p.size / 2, Date.now());
            return (FREEZE_MS / 1000) + "s, " + FREEZE_R + "px";
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
            return zDevNoZombies ? "ON — field cleared, nothing spawns" : "off — spawning resumes";
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
                const z = zDevOrigSpawnZombieAt(kinds[i], Math.max(1, arcadeLevel(Date.now())), x, y);
                z.speedMult = 0;
                z.nextScream = Infinity;
                z.entered = true;
                made++;
            }
            return made + " targets placed" + (made < kinds.length ? " (" + (kinds.length - made) + " blocked by walls)" : "");
        }
    },
    {
        label: "SPAWN SUPER SPLITTER",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("super splitter");
            if (no) return no;
            const spot = arcadeSpawnPoint(ZOMBIE_TYPES.supersplit.size);
            const z = spawnZombieAt("supersplit", Math.max(arcadeLevel(Date.now()), ULTRA_FROM_ROUND), spot.x, spot.y);
            if (!z) return "spawning is off";
            z.entered = true;
            hostEvent(SND_ULTRA, z.x, z.y, 0);
            return "one SUPER SPLITTER at " + Math.round(z.x) + "," + Math.round(z.y);
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
        label: "GOD MODE",
        hint: "toggle",
        fn: function () {
            zDevGodOn = !zDevGodOn;
            const p = zDevPlayer();
            // The game already gates downPlayer() on invulnUntil, so this
            // needs no gameplay edit at all.
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
            return "all " + WEAPON_KEYS.length + " — 1-" + WEAPON_KEYS.length + " or the wheel";
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
        label: "NEXT CHAIN STEP",
        hint: "host only — fills a tank, throws its switch, opens the gate",
        fn: function () {
            const no = zDevHostOnly("chain");
            if (no) return no;
            return zDevAdvanceChain();
        }
    },
    {
        label: "FILL SILOS",
        hint: "host only",
        fn: function () {
            const no = zDevHostOnly("silos");
            if (no) return no;
            for (let i = 0; i < siloFill.length; i++) siloFill[i] = siloCapacity(i);
            return "all " + siloFill.length + " full — throw the switches (F at a tank's base)";
        }
    },
    {
        label: "OPEN GATE",
        hint: "host only — skips the " + Math.round(ESCAPE_OPEN_MS / 1000) + "s wait",
        fn: function () {
            const no = zDevHostOnly("gate");
            if (no) return no;
            escapeAt = Date.now();
            return "gate open";
        }
    },
    {
        label: "NEXT LEVEL",
        hint: "host only — jump to the next map (4 in all; 4 is the boss)",
        danger: true,
        fn: function () {
            const no = zDevHostOnly("next level");
            if (no) return no;
            if (typeof arcadeBeginNextLevel !== "function") return "levels are not built";
            if (!ARENA_LAYOUTS[arcLevelNo + 1]) return "already on the last level";
            arcadeBeginNextLevel(Date.now());
            return "level " + arcLevelNo;
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
    }
];

// One button per perk that can drop in the arcade, each with its own icon.
// Straight into p.cards like applyTake does -- ignoring slots and drops --
// because this is for looking at perks, not earning them. Each press adds a
// stack, up to CARD_MAX_STACK.
DROP_PERKS.forEach(function (k) {
    zDevActions.push({
        label: "+ " + CARDS[k].name,
        hint: CARDS[k].blurb,
        icon: iconUrl("perk", k, ICON_WORLD_HUE),
        fn: function () {
            const p = zDevPlayer();
            if (!p) return "no local player";
            if (cardLevel(p, k) >= CARD_MAX_STACK) return CARDS[k].name + " is already x" + CARD_MAX_STACK;
            p.cards.push(k);
            return CARDS[k].name + " x" + cardLevel(p, k) + " of " + CARD_MAX_STACK;
        }
    });
});

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
