// ===================================================
//   Hub — events and init
// ===================================================
// Split out of index.html's inline script 2026-09-04 (Pass A of
// hub/HUB_PASS_PLAN.md). The lines below were MOVED VERBATIM -- Pass A
// deliberately changed no behaviour, so that any regression could be
// attributed to the skin pass that followed rather than to the split.
//
// Classic scripts, one shared global scope, no modules (the file://
// constraint). Loads LAST and is the ONLY file that executes anything: every listener and the init() IIFE.
"use strict";

// ===================================================
//   EVENTS
// ===================================================
identityJoinBtn.addEventListener("click", () => {
    const name = identityNameInput.value.trim();
    const room = identityRoomInput.value.trim().toUpperCase();

    if (!name) { identityNameInput.focus(); return; }

    storeIdentity(name, room);
    if (socket) { socket.onclose = null; socket.close(); }
    connectAndJoin(name, room);
}, { signal: hubSignal });

[identityNameInput, identityRoomInput].forEach(input => {
    input.addEventListener("keypress", (e) => {
        if (e.key === "Enter") identityJoinBtn.click();
    }, { signal: hubSignal });
});

changeIdentityBtn.addEventListener("click", () => {
    if (socket) { socket.onclose = null; socket.close(); }
    socket = null;
    showIdentityOverlay();
    identityNameInput.value = myName;
    identityRoomInput.value = myRoom === "PUBLIC" ? "" : myRoom;
}, { signal: hubSignal });

// Delegated on the grid rather than per-button, so re-rendering a page
// of tiles doesn't mean re-attaching eight listeners.
tileGrid.addEventListener("click", (e) => {
    const btn = e.target.closest(".vote-check");
    if (!btn) return;

    // These buttons sit inside <a class="tile"> links. Without stopping
    // the event, voting would ALSO navigate into the game -- and voting
    // and playing are deliberately two different actions.
    e.preventDefault();
    e.stopPropagation();

    if (!myName || !socket || socket.readyState !== WebSocket.OPEN) return;

    hubSoundVote();
    socket.send(JSON.stringify({
        type: "vote-update",
        gameId: btn.dataset.gameId,
        voted: !btn.classList.contains("mine")   // Toggle: clicking my own vote clears it
    }));
}, { signal: hubSignal });

continueBtn.addEventListener("click", () => {
    const leader = effectiveLeader();
    if (!leader || !socket || socket.readyState !== WebSocket.OPEN) return;

    socket.send(JSON.stringify({
        type: "ready-update",
        ready: !readyNames.includes(myName),
        gameId: leader
    }));
}, { signal: hubSignal });

pagePrev.addEventListener("click", () => setPage(currentPage - 1), { signal: hubSignal });
pageNext.addEventListener("click", () => setPage(currentPage + 1), { signal: hubSignal });

pageDots.addEventListener("click", (e) => {
    const dot = e.target.closest(".page-dot");
    if (dot) setPage(Number(dot.dataset.page));
}, { signal: hubSignal });

document.addEventListener("keydown", (e) => {
    if (!identityOverlay.hidden) return;
    if (e.key === "ArrowLeft") setPage(currentPage - 1);
    else if (e.key === "ArrowRight") setPage(currentPage + 1);
}, { signal: hubSignal });

window.addEventListener("resize", () => {
    applyGridShape();
    repositionRemoteCursors();
}, { signal: hubSignal });

// The resize event alone isn't enough for a layout whose whole promise
// is "fits your screen without scrolling". A phone's URL bar collapsing
// changes the board's height without a window resize, and some browsers
// report an orientation flip through orientationchange first. Watching
// the board's own box catches every case, including the ones no event
// covers.
window.addEventListener("orientationchange", applyGridShape, { signal: hubSignal });

if (window.ResizeObserver) {
    new ResizeObserver(applyGridShape).observe(document.getElementById("board"));
}

document.addEventListener("mousemove", (e) => {
    if (!socket || socket.readyState !== WebSocket.OPEN || !myName) return;

    const now = performance.now();
    if (now - lastCursorSendTime < CURSOR_SEND_INTERVAL) return;
    lastCursorSendTime = now;

    const hit = anchorUnder(e.clientX, e.clientY);

    socket.send(JSON.stringify({
        type: "cursor-update",
        // Raw viewport percentage is still sent as the fallback for
        // empty space -- it's meaningful for "where on the page are
        // they", just not for "which tile are they pointing at."
        x: Number(((e.clientX / window.innerWidth) * 100).toFixed(2)),
        y: Number(((e.clientY / window.innerHeight) * 100).toFixed(2)),
        anchor: hit ? hit.anchor : null,
        ax: hit ? Number(((e.clientX - hit.rect.left) / hit.rect.width).toFixed(3)) : undefined,
        ay: hit ? Number(((e.clientY - hit.rect.top) / hit.rect.height).toFixed(3)) : undefined
    }));
}, { signal: hubSignal });

// Only tear down when the page is really going away. A pagehide with
// persisted=true means the browser is putting this page in the back/
// forward cache -- destroying then would hand back a dead hub to anyone
// pressing Back out of a game.
window.addEventListener("pagehide", (e) => { if (!e.persisted) destroy(); }, { signal: hubSignal });

window.addEventListener("pageshow", (e) => {
    if (e.persisted && myName && (!socket || socket.readyState !== WebSocket.OPEN)) {
        connectAndJoin(myName, myRoom);
    }
}, { signal: hubSignal });



// ===================================================
//   INIT
// ===================================================
// A returning player doesn't retype anything -- stored identity means
// straight into the room with the roster already up. That's the actual
// "fluid group session" behaviour; the join form is only for a first
// visit or a deliberate change.
(function init() {
    renderAll();

    // Both declared in hub-attract.js. Started here because hub-boot.js is the
    // only file permitted to execute anything, and both hang off hubSignal /
    // trackInterval so destroy() still tears the hub down through one path.
    startHubAudio();
    startAttract();

    const stored = loadStoredIdentity();
    identityNameInput.value = stored.name;
    identityRoomInput.value = stored.room === "PUBLIC" ? "" : stored.room;

    if (stored.name) {
        connectAndJoin(stored.name, stored.room);
    } else {
        identityOverlay.hidden = false;
        identityNameInput.focus();
    }
})();
