// ===================================================
//   4D Pong -- menu, match flow, window.GameInstance, the loop
// ===================================================
// Loads LAST. Everything it calls is declared in the files above it.
//
// THE LOOP IS A FIXED-TIMESTEP ACCUMULATOR, and that is a bug fix rather than
// a preference. The file this replaces advanced the ball by a constant per
// requestAnimationFrame with no dt, so the same game ran 2.4x faster on a
// 144Hz monitor than on a 60Hz one -- the two people in a couch match were
// playing different games if they swapped seats to a different machine.
"use strict";

var rafId = null;
var lastTime = 0;
var accumMs = 0;

// ===================================================
//   PHASE
// ===================================================
function setPhase(p) {
    phase = p;
    menuEl.hidden = (p !== "menu");
    if (p === "play") hintEl.textContent = "SPACE PAUSE · ESC MENU · M MUTE";
    else if (p === "paused") hintEl.textContent = "PAUSED · SPACE RESUMES";
    else if (p === "over") hintEl.textContent = "ENTER REMATCH · ESC MENU";
}

// ===================================================
//   MODE SELECTION
// ===================================================
// Rebuilds the whole seat set. Called on every mode change AND on leaving
// attract mode, so there is exactly one path that can produce a seat array and
// no way for a demo's CPU seats to survive into a real match.
function applyMode(key) {
    modeKey = key;
    mode = MODES[key] || MODES[2];

    seats = buildSeats(mode);
    for (var i = 0; i < seats.length; i++) {
        if (seats[i].kind === CPU) {
            // 1P takes the menu's difficulty; the 3P seat is always medium --
            // it is filling a chair, not setting the challenge.
            attachAI(seats[i], mode.players === 1 ? difficulty : "medium");
        }
    }

    resize();                 // the aspect ratio differs between 2 and 4 seats
    ball = createBall();
    blasters = [];
    particles = [];
    powerup = createPowerup();
    applyTugMode();

    modeLabelEl.textContent = mode.label;
    diffRowEl.hidden = (mode.players !== 1);
    diffLabelEl.hidden = (mode.players !== 1);

    var lines = [];
    for (var s = 0; s < seats.length; s++) {
        if (seats[s].kind === HUMAN) lines.push(KEY_LEGEND[s]);
    }
    menuKeysEl.innerHTML = lines.join("<br>");

    syncButtons();
}

function syncButtons() {
    var mb = modeRowEl.querySelectorAll("button");
    for (var i = 0; i < mb.length; i++) {
        mb[i].setAttribute("aria-pressed", String(Number(mb[i].dataset.mode) === modeKey));
    }
    var db = diffRowEl.querySelectorAll("button");
    for (var j = 0; j < db.length; j++) {
        db[j].setAttribute("aria-pressed", String(db[j].dataset.diff === difficulty));
    }
}

function showMenu() {
    exitAttract();
    setPhase("menu");
    // applyMode() rebuilds seats from the LOCAL mode table, which would undo
    // the host's seat assignment. Online, the seat map is the authority.
    if (net.on) applyOnlineMode(); else applyMode(modeKey);
    if (attractCtl) attractCtl.poke();
}

// ===================================================
//   MATCH
// ===================================================
function startMatch() {
    // Online, only the host may start a match -- everyone shares one ball and
    // one countdown. A guest's START asks for it instead, which is why that
    // button relabels itself READY rather than going dead. A dead button in a
    // game three people are staring at is a support call.
    if (net.on && !net.host) { sendStart(); return; }

    exitAttract();
    if (net.on) applyOnlineMode(); else applyMode(modeKey);
    for (var i = 0; i < seats.length; i++) seats[i].goals = 0;
    tugReset();
    winnerSeat = -1;
    // Starts the serve-speed ramp for THIS match. Reset per match, not per
    // point: it is a clock on how long the two sides have been deadlocked.
    matchStartAt = performance.now();
    schedulePowerup(POWERUP_FIRST_MS);
    // -1 lets serveBall decide, which is the whole point: on a four-goal field
    // it takes a uniform heading from the full circle, so the vertical pair are
    // as likely to receive the opening serve as the horizontal one. Naming a
    // seat here is what used to make every match open sideways.
    serveBall(-1);
    startCountdown();
}

// 3-2-1-GO. On trackInterval, not setInterval: the countdown outliving a
// destroy() was one of the seven untracked timers in the file this replaces.
function startCountdown() {
    countdown = 3;
    setPhase("count");
    sfxCountdown(3);
    if (countdownTimer) clearTracked(countdownTimer);
    countdownTimer = trackInterval(function () {
        countdown--;
        if (countdown > 0) { sfxCountdown(countdown); return; }
        sfxCountdown(0);
        clearTracked(countdownTimer);
        countdownTimer = null;
        trackTimeout(function () { if (phase === "count") setPhase("play"); }, 550);
    }, 1000);
}

function endMatch(seatIndex) {
    winnerSeat = seatIndex;
    setPhase("over");
    var winner = seats[seatIndex];
    if (winner && winner.kind === HUMAN) sfxWin(); else sfxLose();
}

// A goal moves a rope. Nothing else in this game does.
function scoreGoal(concededSeat) {
    var scorer = tugScore(concededSeat);
    if (seats[scorer]) seats[scorer].goals++;
    sfxGoal(scorer);

    var w = tugWinner();
    if (w >= 0) {
        // Attract mode must never end -- a demo that stops on a GAME OVER
        // screen is a cabinet that looks broken from across the room.
        if (attractRunning) { tugReset(); serveBall(concededSeat); return; }
        endMatch(w);
        return;
    }
    serveBall(concededSeat);
}

// ===================================================
//   DESPERATION
// ===================================================
// Kept from the original and rescaled: at `desperationAt()` goals down, the
// paddle grows, turns magenta and its blaster becomes a 200ms machine gun. It
// is the comeback mechanic, and a tug-of-war with no way to pull back is just
// a countdown to a result everyone can already see.
//
// The growth is now CAPPED. The original had none, so a player 20 down had a
// paddle taller than the field and the game could not end.
function updateDesperation(dt) {
    var live = activeSeats();
    for (var i = 0; i < live.length; i++) {
        var seat = live[i];
        var deficit = deficitFor(seat);
        var over = deficit - desperationAt();
        seat.desperate = over >= 0;

        var want = seat.desperate
            ? Math.min(PADDLE_LONG_MAX, PADDLE_LONG + (over + 1) * PADDLE_GROWTH)
            : PADDLE_LONG;

        if (want !== seat.long) {
            seat.long = want;
            placeSeat(seat);   // a longer paddle has a narrower legal range
        }

        if (seat.desperate && !seat.stunned && Math.random() < dt * 22) {
            var r = seatRect(seat);
            spawnParticle(r.x + Math.random() * r.w, r.y + Math.random() * r.h);
        }
    }
}

// ===================================================
//   SIMULATION  -- one fixed 60Hz step
// ===================================================
function simulate(dt, nowMs) {
    var demo = (phase === "menu" && attractRunning);
    if (phase !== "play" && !demo) return;

    // -----------------------------------------------------------------
    // ONLINE GUEST: simulate NOTHING but your own paddle.
    // -----------------------------------------------------------------
    // The host owns the ball, every collision, the score, the tug, the
    // blasters and the CPU seats, and sends them 20x/second. A guest that also
    // ran that simulation would spend the whole match being corrected, and
    // every disagreement would be a bug to chase. The one thing it does run is
    // the local paddle, which is what makes your own movement feel immediate --
    // safe here because nothing but your own keys moves it.
    if (net.on && !net.host) {
        if (phase === "play") pollInput(dt);
        updateParticles(dt);          // cosmetic; never synced
        return;
    }

    if (phase === "play") pollInput(dt);

    // Remote paddles land BEFORE physics, so a paddle the host has just been
    // told about is in place when the ball is tested against it.
    if (net.on) applyRemoteInputs();

    updateDesperation(dt);

    for (var i = 0; i < seats.length; i++) {
        if (seats[i] && seats[i].kind === CPU) aiAct(seats[i], dt, nowMs);
    }

    updateBlasters(dt);
    updateParticles(dt);
    updatePowerup();

    var goal = stepBall(dt);
    if (goal >= 0) scoreGoal(goal);
}

// ===================================================
//   ATTRACT MODE  ( 4.8)
// ===================================================
// "Every cabinet, left alone, played itself." It costs almost nothing here
// because fp-ai.js already exists for the 1P and 3P seats -- the demo is the
// same code with every seat handed to a CPU.
//
// Deliberately MIXED levels: four identical hard paddles produce a rally that
// never ends, which is the least interesting thing a demo can show.
var ATTRACT_LEVELS = ["medium", "hard", "easy", "medium"];

function enterAttract() {
    if (phase !== "menu" || attractRunning) return;
    // Never demo an online lobby: it would hand every seat to a CPU, including
    // seats other people are sitting in, and the host would then broadcast that.
    if (net.on) return;
    attractRunning = true;
    menuEl.classList.add("demo");
    for (var i = 0; i < seats.length; i++) {
        if (seats[i].kind === EMPTY) continue;
        seats[i].kind = CPU;
        attachAI(seats[i], ATTRACT_LEVELS[i]);
    }
    tugReset();
    for (var g = 0; g < seats.length; g++) seats[g].goals = 0;
    matchStartAt = performance.now();
    serveBall(-1);
    insertCoinEl.hidden = false;
    menuTitleEl.textContent = "DEMO";
}

function exitAttract() {
    if (!attractRunning) return;
    attractRunning = false;
    insertCoinEl.hidden = true;
    menuEl.classList.remove("demo");
    menuTitleEl.textContent = "SELECT PLAYERS";
    // REBUILD rather than restore a saved list. onExit fires on any keypress
    // or mouse move, from outside this file, so the seats have to come back to
    // the selected mode by the one path that can produce them -- otherwise a
    // player who nudges the mouse during the demo gets a menu whose seats are
    // all still CPUs, and a "2P" match neither of them can move a paddle in.
    applyMode(modeKey);
}

// ===================================================
//   LOOP
// ===================================================
function loop(now) {
    rafId = requestAnimationFrame(loop);

    // Clamped: a backgrounded tab hands back a delta of minutes, and an
    // unclamped accumulator would then simulate all of it in one frame.
    var dtMs = Math.min(250, now - lastTime);
    if (!isFinite(dtMs) || dtMs < 0) dtMs = 0;
    lastTime = now;
    accumMs += dtMs;

    var steps = 0;
    while (accumMs >= STEP_MS && steps < MAX_CATCHUP_STEPS) {
        simulate(STEP_S, now);
        accumMs -= STEP_MS;
        steps++;
    }
    if (steps >= MAX_CATCHUP_STEPS) accumMs = 0;

    // A guest carries the ball forward between snapshots. Runs on the render
    // clock rather than the fixed step because it is presentation, not
    // simulation -- see netExtrapolate().
    netExtrapolate(dtMs);
    sendPaddle();
    sendSnapshot();

    // The back canvas is only repainted while a barbell is actually moving.
    if (tugTick(dtMs / 1000)) drawBarbells();

    renderFrame();
    if (attractCtl) attractCtl.tick();
}

// ===================================================
//   MENU WIRING
// ===================================================
function attachMenu(signal) {
    modeRowEl.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-mode]");
        if (!btn) return;
        sfxUi();
        exitAttract();
        applyMode(Number(btn.dataset.mode));
    }, { signal: signal });

    diffRowEl.addEventListener("click", function (e) {
        var btn = e.target.closest("button[data-diff]");
        if (!btn) return;
        sfxUi();
        difficulty = btn.dataset.diff;
        applyMode(modeKey);
    }, { signal: signal });

    startBtnEl.addEventListener("click", function () {
        sfxUi();
        startMatch();
    }, { signal: signal });
}

// ===================================================
//   HUB SHELL: window.GameInstance
// ===================================================
// GAME_PROTOTYPE_INSTRUCTIONS.md 2: the hub links to each game as a full
// page rather than embedding it, so destroy() is not load-bearing at runtime
// yet. Written to the contract anyway, for the reason the doc gives -- it is
// cheap up front and expensive to retrofit, and this whole file IS the
// retrofit of a game that was written without it.
window.GameInstance = {
    init: function (config) {
        identity = resolveIdentity(config);

        // Safe to call init() more than once: the previous controller is
        // aborted rather than leaked.
        if (listeners) listeners.abort();
        listeners = new AbortController();

        attachInput(listeners.signal);
        attachMenu(listeners.signal);
        initAudio();

        // 4.8. RETRO.attract REFUSES to attach listeners without a signal --
        // it warns and returns an inert handle rather than leaking something
        // destroy() cannot remove.
        attractCtl = RETRO.attract({
            idleMs: 20000,
            signal: listeners.signal,
            onEnter: enterAttract,
            onExit: exitAttract
        });

        // Was identity-only when this game was couch-only (2026-09-06 morning).
        // netConnect() now owns the whole MP lifecycle -- seats, snapshots,
        // host migration -- and still degrades to exactly the old behaviour
        // when there is no server, which is the normal case on file://.
        netConnect();

        applyMode(modeKey);
        setPhase("menu");
        updateNetHud();
    },

    start: function () {
        if (rafId !== null) cancelAnimationFrame(rafId);
        lastTime = performance.now();
        accumMs = 0;
        rafId = requestAnimationFrame(loop);
    },

    pause: function () {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        if (phase === "play") setPhase("paused");
    },

    resume: function () {
        if (rafId !== null) return;
        lastTime = performance.now();
        accumMs = 0;
        rafId = requestAnimationFrame(loop);
    },

    destroy: function () {
        if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
        if (listeners) { listeners.abort(); listeners = null; }
        clearAllTracked();
        countdownTimer = null;
        powerupTimer = null;
        releaseAll();
        blasters = [];
        particles = [];
        if (attractCtl) { attractCtl.destroy(); attractCtl = null; }
        // Browsers cap live AudioContexts per page, so an init/destroy cycle
        // that never closes one eventually fails to create another.
        if (typeof SFX !== "undefined") SFX.destroy();
    },

    getState: function () {
        return {
            phase: phase,
            mode: modeKey,
            difficulty: difficulty,
            attract: attractRunning,
            pull: { horizontal: axes[0].pull, vertical: axes[1].pull },
            winPull: winPull(),
            goals: seats.map(function (s) { return s.goals; }),
            winner: winnerSeat >= 0 ? SEAT_NAMES[winnerSeat] : null,
            online: net.on,
            host: net.host,
            seat: net.mySeat >= 0 ? SEAT_NAMES[net.mySeat] : null,
            humans: net.humans
        };
    }
};

window.GameInstance.init();
window.GameInstance.start();
