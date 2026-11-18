// ===================================================
//   Desert Code Racer — the chapter crawl (GAME_PROTOTYPE_INSTRUCTIONS §1)
// ===================================================
// Every hub game opens with a skippable chapter crawl that places it in
// the story. There is no shared crawl yet (nothing in shared/), so this is
// the minimal one: rolling text, any key or click skips it, once per tab.
//
// THE TEXT IS A PLACEHOLDER. The standard says the real text lives in the
// story doc, not in the game. Until the hub has a shared crawl that reads
// it from there, paste the approved ACT IV text into DC_CRAWL_TEXT below
// (one string per paragraph) and nothing else changes. If a shared crawl
// lands (say shared/crawl.js), dcCrawl() is the one call to swap.
"use strict";

const DC_CRAWL_TEXT = [
    "ACT IV · LAUNCH",
    "THE EMP TOOK EVERY LINE. NO RADIO. NO SATELLITES. NO WAY TO SEND THE LAUNCH CODES.",
    "SO THE CREW WILL CARRY THEM.",
    "FROM THE DOME BASE, ACROSS THE BLACK ROCK DESERT, TO THE MOUNTAIN BASE AND THE LAUNCH.",
    "THE TIDE HANGS ON THE HORIZON. IT IS WATCHING THE ROAD."
];

function dcCrawl(done) {
    let seen = false;
    try { seen = sessionStorage.getItem("dc_crawl_seen") === "1"; } catch (e) { seen = false; }
    if (seen || dcFlag("nointro") || dcFlag("nocrawl")) { done(); return; }
    try { sessionStorage.setItem("dc_crawl_seen", "1"); } catch (e) { /* not kept */ }

    dc.mode = "crawl";
    const el = document.getElementById("dcCrawl");
    el.innerHTML = "<div class='crawl-stage'><div class='crawl-text'>" +
        DC_CRAWL_TEXT.map(function (p, i) { return "<p" + (i === 0 ? " class='crawl-head'" : "") + ">" + dcEsc(p) + "</p>"; }).join("") +
        "</div></div><div class='crawl-skip'>PRESS ANY KEY</div>";
    el.hidden = false;
    if (DC_REDUCED) el.classList.add("still");

    let over = false;
    const local = new AbortController();
    function end() {
        if (over) return;
        over = true;
        local.abort();
        el.hidden = true;
        el.innerHTML = "";
        done();
    }
    trackTimeout(function () {
        if (over) return;
        window.addEventListener("keydown", end, { signal: local.signal });
        el.addEventListener("pointerdown", end, { signal: local.signal });
        dcAbort.signal.addEventListener("abort", function () { local.abort(); });
    }, 300);
    trackTimeout(end, DC_REDUCED ? 12000 : 24000);
}
