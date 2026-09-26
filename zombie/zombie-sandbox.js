/* ===================================================================
   SANDBOX — play a stamp you are drawing, in the real map
   ===================================================================
   `Zombie.html?sandbox=1&solo=1#stamp=<the stamp, URI-encoded>`

   The STAMP RIDES IN THE HASH, not the query string: a hash is never sent
   to a server and never lands in a log, and it survives a reload, so the
   loop is draw -> playtest -> back -> redraw with nothing written to disk.
   stamp-builder.html's PLAYTEST button builds this URL.

   IT IS THE REAL MAP, not an empty room. A building only tells you
   anything beside the ground it will actually stand on: the sector's
   floor, its boundary doors, its other buildings, real sightlines, and a
   horde that arrives the way it will in a run. So the level generates
   exactly as it always does and the stamp is placed into it, in the first
   spot in its own sector where it legally fits.

   `&zombies=0` starts with spawning off (the dev panel's NO ZOMBIES,
   which L+G can toggle back on). `&sector=cold` overrides which sector to
   drop it in.
   =================================================================== */
"use strict";

const ZSANDBOX = (function () {
    const params = new URLSearchParams(window.location.search);
    const on = params.get("sandbox") === "1";

    function hashStamp() {
        const m = /(?:^|[#&])stamp=([^&]*)/.exec(window.location.hash || "");
        if (!m) return null;
        try { return decodeURIComponent(m[1]); } catch (e) { return null; }
    }

    // Sector key -> zone index, by what the level actually painted.
    function zoneForKey(key) {
        if (typeof zoneInfo === "undefined") return -1;
        for (let z = 0; z < zoneInfo.length; z++) {
            if (zoneInfo[z] && zoneInfo[z].tpl && zoneInfo[z].tpl.key === key) return z;
        }
        return -1;
    }

    let placed = null;        // the box it went into, for the spawn move
    let note = "";

    function place() {
        if (!on) return;
        placed = null;
        const text = hashStamp();
        if (!text) { note = "sandbox: no stamp in the URL"; console.warn(note); return; }

        const stamp = ZS.parse(text);
        const verdict = ZS.check(stamp);
        if (!verdict.ok) {
            note = "sandbox: this stamp does not pass its checks -- " + verdict.problems.join("; ");
            console.warn(note);
            // Placed anyway: you are testing a drawing, and seeing what a
            // broken shell plays like is the whole point of a sandbox.
        }

        const want = params.get("sector") ||
                     (stamp.sector && stamp.sector[0] !== "any" ? stamp.sector[0] : "cold");
        let z = zoneForKey(want);
        if (z < 0) z = zoneForKey("cold");
        if (z < 0) { note = "sandbox: no such sector"; console.warn(note); return; }

        // Walk the sector on a coarse grid and take the first legal spot.
        // Deterministic on purpose: redraw, reload, and the building is in
        // the same place, so you are comparing the drawing and not the roll.
        const b = zoneBounds(z);
        const step = 40;
        // Twice: legally, then FORCED. A sandbox that shows you nothing
        // because your drawing is too big for the ground has told you the
        // one thing you cannot act on -- you cannot see what is wrong with
        // a building you cannot look at. The second pass says so instead.
        for (let pass = 0; pass < 2; pass++) {
            for (let y = b.y + 40; y < b.y + b.h - stamp.h * STAMP_CELL; y += step) {
                for (let x = b.x + 40; x < b.x + b.w - stamp.w * STAMP_CELL; x += step) {
                    if (!placeStampAt(stamp, x, y, z, stamp.kind, pass === 1)) continue;
                    placed = buildingRooms[buildingRooms.length - 1];
                    note = "sandbox: '" + (stamp.name || "untitled") + "' in " + want +
                           " at " + placed.x + "," + placed.y +
                           (pass === 1 ? "  -- FORCED: too big for this sector's clear ground, " +
                                         "so the map itself would never place it" : "");
                    console.log(note);
                    return;
                }
            }
        }
        note = "sandbox: a " + stamp.w + "x" + stamp.h + " stamp does not fit inside " + want +
               " at all -- try &sector=, or a smaller drawing";
        console.warn(note);
    }

    // Put the player on its doorstep rather than in the keep, which is
    // most of what makes this fast: you are looking at the thing you drew
    // the moment the page loads.
    function moveTo(p) {
        if (!on || !placed || !p) return;
        p.x = placed.x + placed.w / 2;
        p.y = placed.y + placed.h + 70;
        if (typeof camera !== "undefined") { camera.x = p.x; camera.y = p.y; }
    }

    return { on: on, place: place, moveTo: moveTo,
             note: function () { return note; },
             box: function () { return placed; } };
})();

// Wrapped, not edited into the game: the same shape zombie-dev.js uses for
// its toggles, so nothing in the normal path knows the sandbox exists.
if (ZSANDBOX.on) {
    const zSandboxOrigSpawnPlayer = spawnPlayer;
    spawnPlayer = function (keepCards) {
        const p = zSandboxOrigSpawnPlayer(keepCards);
        ZSANDBOX.moveTo(p);
        return p;
    };

    // REGENERATED ONCE AT BOOT. This file loads last -- after zombie-dev.js,
    // whose flags it sets -- and zombie-game.js has already generated a
    // level by then, with ZSANDBOX still undefined and the stamp therefore
    // missing. Generating again here is the same call the reset path makes,
    // and the game has not started yet.
    generateLevel();

    // Spawning off at the start when asked, once the dev flags exist.
    if (new URLSearchParams(window.location.search).get("zombies") === "0") {
        trackTimeout(function () {
            if (typeof zDevNoZombies !== "undefined") {
                zDevNoZombies = true;
                if (typeof zombies !== "undefined") zombies.length = 0;
            }
        }, 0);
    }
}
