/*
 * shared/identity.js — the ONE client-side implementation of name→colour.
 *
 * Root CLAUDE.md's hard constraint: colour/identity is server-side, name-hash
 * based (djb2), never session-ID based, and must survive reconnects and match
 * across screens. The server (`gyro-space-server/server.js`) is the authority
 * and always wins at runtime.
 *
 * So why does a client copy exist at all? Because `file://` is also a hard
 * constraint. A game opened by double-click has no server, and still has to
 * colour its players. The copy is therefore not a shortcut to be deleted — it
 * is required. What was wrong before was having THREE of them:
 *
 *   - server.js            the authority
 *   - index.html           a byte-identical duplicate, used as a fallback in 9 places
 *   - reality-rewrite.html a DIFFERENT scheme (hue from 360, not the palette),
 *                          which agreed with the server 0 times out of 10
 *
 * This file replaces both client copies. The rule is now simple:
 *
 *   **Never write a name→colour function anywhere else.** Prefer `MP.selfColor`
 *   (the server's answer) and fall back to `IDENTITY.colorFromName(name)` only
 *   when there is no server. `scripts/check-identity-parity.js` proves this file
 *   and server.js still agree, and fails if they drift.
 *
 * Loaded as a classic script (no modules — the file:// constraint) and exposes
 * exactly ONE global, `IDENTITY`, to keep the collision surface at one name.
 */
(function (global) {
    "use strict";

    /*
     * 16 hues at 22.5° spacing, saturation/lightness solved rather than picked.
     *
     * The old palette had 10 entries and a real defect: hues 45 and 50 were 5°
     * apart — two visually identical yellows, minimum pairwise ΔE of 9.7, which
     * is inside "easily confused". Two players with DIFFERENT colours could look
     * the same, which is worse than a plain collision because nothing signals it.
     *
     * These values come from a hill-climb maximising the minimum pairwise CIE76
     * ΔE in Lab, subject to every colour keeping ≥1.9:1 contrast against BOTH
     * grounds this repo actually draws on: #0D1117 (most games) and near-white
     * (glucose-dash's mall). Result: minimum ΔE 25.9, worst contrast 1.90:1 on
     * white and 1.92:1 on dark.
     *
     * If you change ANY of these, change them in server.js too and re-run
     * `node scripts/check-identity-parity.js`.
     */
    var COLOR_PALETTE = [
        "hsl(0, 75%, 58%)", "hsl(23, 75%, 46%)",
        "hsl(45, 75%, 49%)", "hsl(68, 62%, 40%)",
        "hsl(90, 62%, 48%)", "hsl(113, 90%, 43%)",
        "hsl(135, 66%, 40%)", "hsl(158, 66%, 41%)",
        "hsl(180, 75%, 44%)", "hsl(203, 75%, 46%)",
        "hsl(225, 75%, 58%)", "hsl(248, 70%, 44%)",
        "hsl(270, 89%, 52%)", "hsl(293, 80%, 40%)",
        "hsl(315, 75%, 58%)", "hsl(338, 75%, 46%)"
    ];

    // djb2. Unchanged from the original on purpose — it is the one part of this
    // that was never wrong, and changing it would reshuffle every player's
    // colour for no reason.
    function hashStringToIndex(str, modulo) {
        var hash = 5381;
        for (var i = 0; i < str.length; i++) {
            hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
        }
        return Math.abs(hash) % modulo;
    }

    // The "Anonymous" default matters: it must match the server's, or an unnamed
    // player is one colour on the hub and another in the game.
    function colorFromName(name) {
        var key = (name && name.trim()) || "Anonymous";
        return COLOR_PALETTE[hashStringToIndex(key, COLOR_PALETTE.length)];
    }

    global.IDENTITY = {
        PALETTE: COLOR_PALETTE,
        hashStringToIndex: hashStringToIndex,
        colorFromName: colorFromName
    };
})(typeof window !== "undefined" ? window : this);

// Node (the parity checker) loads this file directly; browsers ignore the branch.
if (typeof module !== "undefined" && module.exports) {
    module.exports = (typeof window !== "undefined" ? window : this).IDENTITY;
}
