// ===================================================
//   Hub — socket, countdown, persistence
// ===================================================
// Split out of index.html's inline script 2026-09-04 (Pass A of
// hub/HUB_PASS_PLAN.md). The lines below were MOVED VERBATIM -- Pass A
// deliberately changed no behaviour, so that any regression could be
// attributed to the skin pass that followed rather than to the split.
//
// Classic scripts, one shared global scope, no modules (the file://
// constraint). Declarations only. connectAndJoin() is called by hub-boot.js's init().
"use strict";

// ===================================================
//   CONNECTION
// ===================================================
function connectAndJoin(name, room) {
    myName = name;
    myRoom = (room || "public").toUpperCase();

    // A new socket hasn't proven anything yet. Left over from a previous
    // connection, this would show that server's winner and a live
    // Continue button until the new lobby message arrived.
    serverHasLobby = false;

    socket = new WebSocket(SERVER_URL);

    socket.onopen = () => {
        connectFailures = 0;
        renderBottomBar();   // "Connecting..." -> "Joining the room..."
        socket.send(JSON.stringify({
            type: "join-room",
            // The hub has its own namespace. It used to send no game
            // field, which put it in the legacy namespace alongside
            // space-tracer.html -- meaning a friend already playing Gyro
            // Space counted as someone who had to click Continue, and
            // couldn't, deadlocking every launch. See server.js.
            game: "_hub",
            room: myRoom,
            name: myName
        }));
    };

    socket.onmessage = (event) => {
        try {
            handleServerMessage(JSON.parse(event.data));
        } catch (e) {
            console.error("Error parsing server message:", e);
        }
    };

    socket.onclose = () => {
        // The lobby went away with the socket. Redraw, so the board stops
        // showing a winner and a Continue button that nothing will answer
        // -- this used to re-render nothing at all.
        connectFailures++;
        syncBoard();
        renderBottomBar();

        // Quiet reconnect -- doesn't bounce the player back to the join
        // form, it just re-establishes presence underneath them.
        if (reconnectTimer) clearTracked(reconnectTimer);
        reconnectTimer = trackTimeout(() => {
            if (myName) connectAndJoin(myName, myRoom);
        }, 3000);
    };

    showHub();
}

function handleServerMessage(data) {
    if (data.type === "players") {
        Object.keys(roomMembers).forEach(k => delete roomMembers[k]);

        // The snapshot excludes us; `you` is how the server hands us our
        // own authoritative identity. Adding it here is what finally puts
        // the player's own dot in their own roster.
        if (data.you) {
            myName = data.you.name || myName;
            roomMembers[myName] = { color: data.you.color || getColorFromName(myName) };
        }

        (data.players || []).forEach(p => {
            roomMembers[p.name || "(unnamed)"] = { color: p.color || getColorFromName(p.name) };
        });

        renderAll();

    } else if (data.type === "join" && data.player) {
        roomMembers[data.player.name || "(unnamed)"] = {
            color: data.player.color || getColorFromName(data.player.name)
        };
        renderRoster();
        renderBottomBar();

    } else if (data.type === "leave") {
        if (data.name) {
            delete roomMembers[data.name];
            votesByGame.forEach(voters => voters.delete(data.name));
            removeRemoteCursor(data.name);
            renderRoster();
            renderAllVoteChecks();
            renderBottomBar();
        }

    } else if (data.type === "votes") {
        votesByGame.clear();
        (data.votes || []).forEach(v => {
            voteMapFor(v.gameId).set(
                v.voterName,
                (roomMembers[v.voterName] && roomMembers[v.voterName].color) || getColorFromName(v.voterName)
            );
        });
        syncBoard();
        renderBottomBar();

    } else if (data.type === "vote-update") {
        // Broadcast to everyone including the sender, so our own
        // checkmark is drawn from server-confirmed state rather than an
        // optimistic local guess. gameId is null when someone un-voted,
        // so clear this voter everywhere first -- one vote per person.
        votesByGame.forEach(voters => voters.delete(data.voterName));
        if (data.gameId) {
            voteMapFor(data.gameId).set(data.voterName, data.voterColor || getColorFromName(data.voterName));
        }
        syncBoard();
        renderBottomBar();

    } else if (data.type === "lobby") {
        serverHasLobby = true;
        serverLeaderGameId = data.leaderGameId || null;
        readyNames = data.ready || [];
        if (!data.launching) stopCountdown();

        // A game picked while the lobby was down -- typically during a
        // Render cold start -- becomes a real vote now instead of being
        // dropped with the offline state (HUB_LOBBY_PLAN.md §9c).
        if (offlinePick) {
            const pick = offlinePick;
            offlinePick = null;
            sendVote(pick, true);
        }

        syncBoard();         // the winning tile is highlighted
        renderRoster();      // ready players are marked in the roster too
        renderBottomBar();

    } else if (data.type === "launch") {
        startCountdown(data.gameId, data.delayMs);

    } else if (data.type === "launch-cancel") {
        stopCountdown();
        flashHint("Launch cancelled — " + (data.reason || "something changed"));

    } else if (data.type === "presence") {
        presenceList = data.players || [];
        renderRoster();

    } else if (data.type === "cursor-update") {
        renderRemoteCursor(data);
    }
}

// voted:false clears it -- and the server only clears it if that game is
// still your current vote, so a stale in-flight clear can't wipe a newer one.
function sendVote(gameId, voted) {
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(JSON.stringify({
        type: "vote-update",
        gameId: gameId,
        voted: voted
    }));
}



// ===================================================
//   LAUNCH COUNTDOWN
// ===================================================
let countdownTimer = null;
let countdownTick = null;

function startCountdown(gameId, delayMs) {
    const game = gameById(gameId);
    if (!game) return;   // A game this hub doesn't list -- don't navigate anywhere

    stopCountdown();
    isLaunching = true;

    let remaining = Math.ceil((delayMs || 3000) / 1000);
    countdownGame.textContent = game.title;
    countdownNumber.textContent = remaining;
    countdownOverlay.hidden = false;

    countdownTick = trackInterval(() => {
        remaining -= 1;
        countdownNumber.textContent = Math.max(0, remaining);
    }, 1000);

    countdownTimer = trackTimeout(() => {
        window.location.href = gameHref(game);
    }, delayMs || 3000);

    renderBottomBar();
}

function stopCountdown() {
    if (countdownTimer) { clearTracked(countdownTimer); countdownTimer = null; }
    if (countdownTick) { clearTracked(countdownTick); countdownTick = null; }
    countdownOverlay.hidden = true;
    isLaunching = false;
}

// The no-lobby path (HUB_LOBBY_PLAN.md §9c): nobody to wait for, so no
// countdown. Same link the tile itself used to be, so a solo player lands
// exactly where they always did.
function launchSolo(gameId) {
    const game = gameById(gameId);
    if (game) window.location.href = gameHref(game);
}



// ===================================================
//   PERSISTENCE
// ===================================================
function loadStoredIdentity() {
    try {
        return {
            name: localStorage.getItem("gamehub_playerName") || "",
            room: localStorage.getItem("gamehub_roomCode") || ""
        };
    } catch (e) {
        return { name: "", room: "" };   // Private mode / blocked storage
    }
}

function storeIdentity(name, room) {
    try {
        localStorage.setItem("gamehub_playerName", name);
        localStorage.setItem("gamehub_roomCode", room);
    } catch (e) { /* Not fatal -- identity just won't survive a reload */ }
}


