# Dev Tools Plan — the L+G panel

**Written 2026-09-07, before any edit.** Root `CLAUDE.md`: anything nontrivial spanning
multiple files gets a saved plan, because sessions compact and plans don't.

## The ask

A dev/playtest overlay in **Zombie, 4D Pong, RD Arena and Glass City Escape**, opened by
holding **L and G at the same time**, carrying a log readout plus buttons for round/level
advance, clear enemies, reset, and whatever else each game can usefully offer.

Glass City already has a log overlay on bare `L`; that key gate moves to L+G like the rest.

## Shape: one shared module, one small per-game file

`shared/devtools.js` publishes exactly **one** top-level name, `DEVTOOLS`, and owns:

- the L+G key gate,
- the panel DOM (built in JS and injected, so no game's HTML gains markup),
- an **error ring buffer** wrapping `console.error` / `console.warn` / `window.onerror` /
  `unhandledrejection`, installed at load,
- a copy-to-clipboard textarea carrying the whole payload as JSON.

Each game then gets `<prefix>-dev.js`, loaded last, which calls `DEVTOOLS.init()` with its
own report provider and button list. Separate files because dev code should be deletable in
one line, and because it keeps playtest buttons out of gameplay files.

### Why the error buffer is the centrepiece

`check-undefined-globals.js` exists (2026-09-07) because `zombie-game.js` read two constants
that existed nowhere, and the `ReferenceError` came out of the host's update loop, stopped
`broadcastWorld`, and froze every other client **while the host kept drawing and looked
fine**. Nobody had a console open. A panel that shows the last N throws, on the machine
where the freeze happened, is the runtime half of that same lesson — the checker catches the
static case, this catches the one that only appears under play.

### API

```js
DEVTOOLS.init({
    game:      "zombie",
    armedWhen: function () { ... },   // optional; when false the combo is ignored
    onOpen:    function () { ... },   // optional; release held keys, pause, silence audio
    onClose:   function () { ... },   // optional
    report:    function () { return [ ["ROUND", round], ... ]; },
    actions:   [ { label: "ROUND +1", fn: ... , hint: "host only" }, ... ]
});
DEVTOOLS.note("text")   // append a line to the panel's own activity log
DEVTOOLS.open() / .close() / .toggle() / .isOpen()
DEVTOOLS.destroy()      // aborts its listeners; the repo's teardown rule applies here too
```

`report()` is re-read every time the panel opens **and on a ~500 ms interval while it is
up**, so a value that moves while you read it is visibly moving.

## The 4D Pong key collision — the one real problem

`fp-input.js` `SEAT_KEYS`:

| seat | keys |
| --- | --- |
| TOP (index 2) | F/H move, T/**G** in-out, Y fire |
| BOTTOM (index 3) | J/**L** move, I/K in-out, O fire |

**`KeyL` and `KeyG` are live gameplay keys in 3P and 4P**, held by two different people at
one desk. TOP holding G while BOTTOM holds L is ordinary play, not a rare coincidence, so a
bare L+G gate would open the dev panel mid-rally.

A dwell timer does not fix it — those keys get held for well over a second at a time.

**Resolution:** `armedWhen`. 4D Pong arms the combo only when neither key belongs to a live
human seat, or when the game is not in `phase === "play"`:

```js
armedWhen: function () {
    if (phase !== "play") return true;              // menu, paused, countdown, over
    return !seatIsLiveHuman(TOP) && !seatIsLiveHuman(BOTTOM);
}
```

So in 1P/2P (seats TOP/BOTTOM are `EMPTY`) L+G works during play exactly like the other
three games. In 3P/4P you pause first (SPACE) and then open it. The other three games pass
no `armedWhen` and are always armed.

Checked against the other three: Zombie binds W/A/S/D/F/E/Q/M, RD Arena binds
`w a s d e q r f space` and `1 2 3`, Glass City binds WASD/arrows/space/b/shift/m — **no L
or G in any of them.** Glass City's bare-`L` log binding is the only thing being displaced.

## Per-game buttons

Actions are host-gated where the game is host-authoritative, and say so in the button hint
rather than silently doing nothing.

### Zombie (`zombie/zombie-dev.js`)
Host-authoritative and multiplayer, so **no pause** — same call the codex already makes
("The round does not pause while you read this"). Buttons:

- **ROUND +1** — `endRound(Date.now())` then `startRound(round + 1)`, host only
- **CLEAR ZOMBIES** — `zombies.length = 0`, host only
- **KILL ROUND** — clear the field *and* zero `roundBudget`, so the round ends naturally
- **RESET GAME** — `resetGame()`
- **+500 SCRAP** — the economy is host-validated; the button asks the host the same way a
  buy does, and is host-only for the same reason
- **HEAL / REVIVE** — full heal + clear `downed` on the local player
- **GOD MODE** — `invulnUntil` far future, toggling
- **REFILL AMMO** — `refillAmmo(p)`
- **LIGHTS** — flip `generatorOn`, which is what gates the map's darkness
- **SKIP TO ENDGAME** — the sluice/gate sequence is otherwise a long climb to reach

### RD Arena (`rd-arena/rd-dev.js`)
Single player, no server, no reset path in the code at all (`location.reload()` is the
honest one).

- **ROUND +1** — `startRound(round + 1)`
- **CLEAR ENEMIES** — `enemies.length = 0` (plus crawlers, bioCarriers)
- **END ROUND** — clear the field and zero `roundBudget`
- **RESET GAME** — `location.reload()`
- **GOD MODE** — clamp `player.hp` each frame via a flag the panel owns
- **FULL HP**, **+5 ROUNDS**
- **OFFER CARD** — force a card offer, which is otherwise gated on a BIO threshold
- **SPAWN ENEMY x5**

### 4D Pong (`four-d-pong/fp-dev.js`)
Local couch play; online is host-driven so the match-control buttons are gated on `!net.on`.

- **GOAL: LEFT / RIGHT / TOP / BOTTOM** — `scoreGoal(seat)`, the one thing that moves a rope
- **NEXT MATCH** — `startMatch()`
- **RESET MATCH** — `showMenu()`
- **PAUSE / RESUME** — `setPhase()`, offline only
- **SERVE BALL** — `serveBall(-1)`
- **SPAWN POWERUP** — `spawnPowerup()`
- **FREEZE BALL** — zero the ball velocity, for looking at geometry
- **CYCLE MODE** — 1P → 2P → 3P → 4P without going back to the menu

### Glass City Escape (`glass-city-escape/gc-dev.js`)
Already pauses while its log is up (`gcLogOpen` gates `gameLoop`); that stays.

- **STAGE +1** — `triggerNextStage()`
- **CLEAR DRONES** — `entities.length = 0`, plus `gcLasers`
- **RESET GAME** — `location.reload()`
- **FULL HEAL**, **GOD MODE**
- **OPEN EXIT** — fill every pedestal and `openEscapeTunnel()`, so the descent can be tested
  without hunting eight cores
- **RUN LOG** — the existing `gcDumpLog()` payload, folded into the shared panel's report

## What must still hold afterwards

- `file://` — no modules, classic `<script>` only; the panel is built with `document.createElement`
- One `AbortController` per module, `trackTimeout`/`trackInterval` for the refresh interval
- `node scripts/check-global-collisions.js` — every new top-level name is prefixed
  (`DEVTOOLS`, `zDev*`, `rdDev*`, `fpDev*`, `gcDev*`)
- `node scripts/check-undefined-globals.js` — dev files reference game globals, and the
  checker resolves those across the page, so they must be listed **after** the game's files
- `node scripts/check-identity-parity.js` — untouched, but it is in the gate
- `node scripts/check-doc-sync.js --update` after reading what the change invalidated
