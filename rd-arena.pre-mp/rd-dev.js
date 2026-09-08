/**
 * RD Arena — dev tools registration (2026-09-07)
 *
 * Everything the L+G panel shows and does for this game, in its own file so it
 * can be removed by deleting one <script> tag.
 *
 * Loads LAST, after rd-boot.js — which is not just a dependency list here:
 * rd-boot ENDS by calling rebuildFlowField(), startRound(1) and loop(), so by
 * the time this file runs the game is already going. That is fine, because
 * nothing below executes at load except the registration itself.
 *
 * ONE GAMEPLAY EDIT SUPPORTS THIS FILE: `rdDevGod` is read by Entity.hit() in
 * rd-entities.js, one line next to the invuln/dash check that was already
 * there. It is declared here rather than there so that deleting the dev panel
 * leaves exactly one dangling reference to find, not a scattered handful.
 *
 * NO PAUSE ON OPEN. RD Arena is single-player with no server, so pausing is
 * safe — but it is offered as a BUTTON rather than done automatically,
 * because half of what you want the panel for is watching the field move
 * while you read the numbers. onOpen only drops held keys.
 */
"use strict";

// Read by Entity.hit() in rd-entities.js. The player object is REPLACED on
// death (`player = new Entity(...)` inside the respawn timeout), so this
// cannot live on the instance — it would evaporate the first time you died,
// which is the exact moment you would notice god mode was not on.
var rdDevGod = false;

function rdDevRelease() {
    for (const k in keys) keys[k] = false;
    mouse.down = false;
    mouse.right = false;
    mouse.clicked = false;
}

function rdDevReport() {
    const trees = Object.keys(build).map(function (t) {
        return t + " " + build[t].tier;
    }).join("  ");

    return [
        ["round", round + "  (" + roundPhase + ")"],
        ["budget left", roundBudget + (roundPhase === "intermission"
            ? "   next in " + Math.max(0, Math.ceil(breatherTimer / 60)) + "s" : "")],
        ["enemies", enemies.length + " / " + MAX_ENEMIES +
                    "   crawlers " + crawlers.length +
                    "   bullets " + bullets.length],
        ["carriers", bioCarriers.length + "   grenades " + grenades.length],
        ["player", "hp " + player.hp + "/" + player.maxHp +
                   (player.dead ? "  DEAD" : "") +
                   (player.invuln > 0 ? "  invuln " + player.invuln : "") +
                   (player.isDashing ? "  DASHING" : "")],
        ["god mode", rdDevGod ? "ON" : "off"],
        ["kills / deaths", kills + " / " + deaths],
        ["biohacks", "pending " + pendingBiohacks +
                     "   baking " + (activeBake ? activeBake.name : "none") +
                     "   next at " + nextBioThreshold() + " kills"],
        ["build tiers", trees],
        ["card offer", cardOffer ? (cardOfferTree + ": " +
            cardOffer.map(function (c) { return c.name; }).join(" / ")) : "none"],
        ["frames", frameCount + (running ? "" : "   LOOP STOPPED")]
    ];
}

var rdDevActions = [
    {
        label: "ROUND +1",
        fn: function () {
            enemies.length = 0;
            startRound(round + 1);
            return "now round " + round;
        }
    },
    {
        label: "CLEAR ENEMIES",
        fn: function () {
            const n = enemies.length + crawlers.length + bioCarriers.length;
            enemies.length = 0;
            crawlers.length = 0;
            bioCarriers.length = 0;
            return n + " removed";
        }
    },
    {
        label: "END ROUND",
        hint: "clears + empties budget",
        fn: function () {
            enemies.length = 0;
            roundBudget = 0;
            // updateRounds() sees no budget and an empty field on the next
            // frame and calls endRound() itself, so the breather and the
            // banner happen exactly as they do in play.
            return "field cleared, budget zeroed";
        }
    },
    {
        label: "SPAWN x5",
        fn: function () {
            let made = 0;
            for (let i = 0; i < 5; i++) if (spawnEnemy()) made++;
            return made + " spawned" + (made < 5 ? " (cap or no spawn point)" : "");
        }
    },
    {
        label: "RESET GAME",
        hint: "reloads the page",
        danger: true,
        fn: function () {
            // RD Arena has no reset path in its own code — no game-over
            // screen, no restart, just an endless field and a death that
            // respawns you two seconds later. A reload IS the reset here, and
            // pretending otherwise by hand-clearing twenty arrays is how you
            // end up debugging the dev tool instead of the game.
            location.reload();
            return "reloading";
        }
    },
    {
        label: "GOD MODE",
        hint: "toggle",
        fn: function () {
            rdDevGod = !rdDevGod;
            return rdDevGod ? "ON" : "off";
        }
    },
    {
        label: "FULL HP",
        fn: function () {
            player.hp = player.maxHp;
            player.invuln = Math.max(player.invuln, 60);
            return player.hp + "/" + player.maxHp;
        }
    },
    {
        label: "PAUSE / RESUME",
        fn: function () {
            running = !running;
            // loop() bails on `!running` and re-arms its own rAF at the end,
            // so resuming is simply calling it once more.
            if (running) loop();
            return running ? "running" : "stopped";
        }
    },
    {
        label: "+1 BIOHACK",
        hint: "then hold F at an organ",
        fn: function () {
            pendingBiohacks++;
            return pendingBiohacks + " pending";
        }
    },
    {
        label: "OFFER CARD",
        hint: "skips the kill threshold",
        fn: function () {
            if (cardOffer) return "an offer is already open";
            // Cheapest tree first, so repeated presses walk a build up rather
            // than re-rolling the same maxed-out one.
            const trees = Object.keys(build).sort(function (a, b) {
                return build[a].tier - build[b].tier;
            });
            for (let i = 0; i < trees.length; i++) {
                const offer = offerCardsFor(trees[i]);
                if (offer) {
                    cardOffer = offer;
                    cardOfferTree = trees[i];
                    return trees[i] + ": " + offer.map(function (c) { return c.name; }).join(" / ");
                }
            }
            return "every tree is capped";
        }
    },
    {
        label: "MAX A TREE",
        hint: "crawler -> splatter -> mob",
        fn: function () {
            const trees = Object.keys(build).sort(function (a, b) {
                return build[a].tier - build[b].tier;
            });
            for (let i = 0; i < trees.length; i++) {
                const t = trees[i];
                if (build[t].tier >= TIER_CAP) continue;
                let taken = 0;
                // Real cards, applied through their own apply() — a tier
                // number bumped by hand would leave every stat behind it
                // untouched, which is a build that exists nowhere in the game.
                while (build[t].tier < TIER_CAP) {
                    const offer = offerCardsFor(t);
                    if (!offer || !offer.length) break;
                    const card = offer[0];
                    card.apply();
                    cardsTaken[card.id] = (cardsTaken[card.id] || 0) + 1;
                    build[t].tier = Math.min(TIER_CAP, build[t].tier + 1);
                    taken++;
                }
                return t + " -> tier " + build[t].tier + " (" + taken + " cards)";
            }
            return "every tree is capped";
        }
    }
];

if (typeof DEVTOOLS !== "undefined") {
    DEVTOOLS.init({
        game: "rd-arena",
        onOpen: rdDevRelease,
        report: rdDevReport,
        actions: rdDevActions
    });
}
