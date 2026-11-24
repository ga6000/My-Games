// ===================================================
//   Desert Code Racer — dev tools registration (hold L+G)
// ===================================================
// Loads LAST, after dc-flow.js. Everything the shared panel (shared/devtools.js)
// shows and does for this game lives here, so the feature comes out by
// deleting one <script> tag (plus the two dc.dev* reads in dc-rider.js and
// dc-flow.js, which do nothing while false).
//
// THE COMBO IS ARMED ALWAYS. DEV_TOOLS_PLAN.md records that `armedWhen`
// exists because 4D Pong binds KeyG and KeyL to couch seats; this game binds
// neither (dc-rider.js: WASD / arrows, Space, E, Shift, M), so there is
// nothing to disarm.
//
// ONLINE. The jumps, crash and end buttons act on the local rider and, where
// the case or the end is involved, only on the host (it owns the case). The
// panel pauses the game only offline: an online run cannot stop for one
// screen, so it rolls on behind the panel there.
"use strict";

function dcDevMe() { return dc.me; }

// Move the local rider to a segment, bring the case along when this screen is
// the host and nobody is holding it, and give a moment of grace so the rider
// does not land in something.
function dcDevJump(seg, label) {
    const me = dcDevMe();
    if (!me || !dc.track) return "no run";
    if (dc.mode !== "play") return "only during a run";
    me.z = seg * DC_SEG;
    me.x = 0; me.air = 0; me.down = 0; me.krill = 0;
    me.v = Math.max(me.v, DC_CRUISE);
    me.inv = Math.max(me.inv, 1.5);
    const c = dc.caseS;
    if (c && !c.over && dcIsHost()) {
        if (!c.holder) dcHostGrab(me.id);
        else if (c.holder === me.id) { c.z = me.z; c.x = me.x; }
    }
    return label + " (seg " + seg + ")";
}

function dcDevReport() {
    const me = dcDevMe();
    const t = dc.track;
    const c = dc.caseS;
    const rows = [];
    rows.push(["mode", dc.mode + (dc.demo ? " (attract)" : "") + (dcPaused ? " (paused)" : "") +
        (dcOnline() ? (dcIsHost() ? "  online HOST" : "  online guest") : "  offline")]);
    rows.push(["difficulty", DC_DIFF + "  timescale " + DC_TIMESCALE]);
    rows.push(["sim time", dc.simT.toFixed(1) + "s"]);
    rows.push(["screen", dcW + "x" + dcH + " virtual, x" + dcPixel]);
    if (t && me) {
        const seg = Math.floor(me.z / DC_SEG);
        rows.push(["road", "seg " + seg + "/" + t.finish + "  " + dcZoneAt(me.z) +
            "  leg " + (dc.leg + 1) + "  cp " + t.cpSeg.join("/")]);
        rows.push(["you", me.role + "  " + Math.round(me.v * DC_MPH) + " MPH  x " + me.x.toFixed(2) +
            (me.air > 0 ? "  AIR" : "") + (me.down > 0 ? "  DOWN " + me.down.toFixed(1) : "") +
            (me.krill > 0 ? "  krill " + me.krill : "")]);
        rows.push(["charges", me.ch + "/" + DC_CHARGES + "  cd " + me.cd.toFixed(1) + "s" +
            (dc.devGod ? "  GOD" : "") + (dc.devBot ? "  BOT" : "")]);
    }
    if (c) {
        const h = c.holder ? dc.riders[c.holder] : null;
        rows.push(["case", "pips " + c.pips + "/" + DC_TUNE.pips + "  " +
            (c.over ? "OVER" : h ? "held by " + (h.local ? "you" : h.name) : "lying " + c.lying.toFixed(1) + "s at seg " + Math.floor(c.z / DC_SEG))]);
    }
    rows.push(["live", "riders " + Object.keys(dc.riders).length +
        "  beams " + dc.beams.filter(function (b) { return b.phase !== "gone"; }).length +
        "  krill " + dc.krill.filter(function (k) { return k.phase !== "gone"; }).length +
        "  attacks " + dc.attacks.length + "  fx " + dc.fx.length]);
    if (dc.finale) rows.push(["finale", JSON.stringify(dc.finale).slice(0, 80)]);
    rows.push(["crashes", dc.crashLog.slice(-5).join("  ") || "none"]);
    rows.push(["pips lost", dc.pipLog.slice(-5).join("  ") || "none"]);
    rows.push(["sound", dcMuted() ? "MUTED" : "on"]);
    return rows;
}

function dcDevPayload() {
    return { state: window.GameInstance.getState ? window.GameInstance.getState() : null,
             crashLog: dc.crashLog, pipLog: dc.pipLog };
}

const dcDevActions = [
    {
        label: "NEXT CHECKPOINT",
        hint: "jumps you (and a loose case, host) just past the next checkpoint",
        fn: function () {
            if (!dc.track) return "no run";
            const leg = Math.min(2, dcLegAt(dc.me.z));
            return dcDevJump(dc.track.cpSeg[leg] + 4, "past checkpoint " + (leg + 1));
        }
    },
    {
        label: "SKIP TO THE LAB",
        hint: "drops you just short of the finish line, for the finale",
        fn: function () { return dc.track ? dcDevJump(dc.track.finish - 25, "at the lab door") : "no run"; }
    },
    {
        label: "FILL CHARGES",
        hint: "both ability charges, cooldown cleared",
        fn: function () { const me = dcDevMe(); if (!me) return "no rider"; me.ch = DC_CHARGES; me.cd = 0; return "loaded"; }
    },
    {
        label: "CASE PIPS FULL",
        hint: "host only",
        fn: function () {
            const c = dc.caseS;
            if (!c || c.over) return "no case";
            if (!dcIsHost()) return "host only";
            c.pips = DC_TUNE.pips; dcEmitCase(); return "pips " + c.pips;
        }
    },
    {
        label: "CLEAR THE SKY",
        hint: "removes beams, krill and attacks on this screen",
        fn: function () {
            const n = dc.beams.length + dc.krill.length + dc.attacks.length;
            dc.beams.length = 0; dc.krill.length = 0; dc.attacks.length = 0;
            if (dc.me) dc.me.krill = 0;
            return n + " removed";
        }
    },
    {
        label: "SEND KRILL",
        hint: "host only: the next krill wave now",
        fn: function () { if (!dcIsHost()) return "host only"; dc.hostT.krill = 0; return "queued"; }
    },
    {
        label: "SEND BEAM",
        hint: "host only: the next beam now",
        fn: function () { if (!dcIsHost()) return "host only"; dc.hostT.beam = 0; return "queued"; }
    },
    {
        label: "NEXT CLASS",
        hint: "swap your crew member (offline)",
        fn: function () {
            const me = dcDevMe();
            if (!me) return "no rider";
            if (dcOnline()) return "offline only";
            me.role = DC_ROLES[(DC_ROLES.indexOf(me.role) + 1) % DC_ROLES.length];
            dcPanelShown = "";
            return me.role;
        }
    },
    {
        label: "GOD MODE",
        hint: "toggle: nothing crashes you",
        fn: function () { dc.devGod = !dc.devGod; return dc.devGod ? "on" : "off"; }
    },
    {
        label: "BOT TAKEOVER",
        hint: "toggle: the autopilot rides for you",
        fn: function () { dc.devBot = !dc.devBot; return dc.devBot ? "bot riding" : "yours"; }
    },
    {
        label: "MUTE",
        hint: "toggle sound (same as M or the panel button)",
        fn: function () { dcToggleMute(); return dcMuted() ? "muted" : "sound on"; }
    },
    {
        label: "CRASH ME",
        danger: true,
        hint: "a crater crash, with the drop if you carry the case",
        fn: function () { const me = dcDevMe(); if (!me || dc.mode !== "play") return "only during a run"; me.inv = 0; const g = dc.devGod; dc.devGod = false; const r = dcCrash(me, "crater"); dc.devGod = g; return r; }
    },
    {
        label: "WIN NOW",
        danger: true,
        hint: "host only: ends the run as delivered",
        fn: function () { if (!dc.caseS || dc.mode !== "play") return "only during a run"; if (!dcIsHost()) return "host only"; dcHostEnd(true); return "ended"; }
    },
    {
        label: "LOSE NOW",
        danger: true,
        hint: "host only: ends the run as lost",
        fn: function () { if (!dc.caseS || dc.mode !== "play") return "only during a run"; if (!dcIsHost()) return "host only"; dcHostEnd(false); return "ended"; }
    }
];

if (typeof DEVTOOLS !== "undefined") {
    DEVTOOLS.init({
        game: DC_GAME,
        onOpen: function () {
            // The panel is modal: a key held when it opened would keep steering
            // behind it, and keyup still arrives, so clear what is held now.
            for (const k in dcKeys) dcKeys[k] = false;
            if (!dcOnline()) dcPaused = true;
        },
        onClose: function () { dcPaused = false; dcLastTs = 0; },
        report: dcDevReport,
        payload: dcDevPayload,
        actions: dcDevActions
    });
}
