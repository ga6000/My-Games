# Quick Reference

Replaces an earlier version of this file written against a different project (wrong repo path,
wrong folder layout). This one matches the real repo.

## Where things are

```
Active Github Repos/My Games-main/     ← this repo (ga6000/My-Games)
├── index.html                         ← hub, must stay at repo root for GitHub Pages
├── leaderboard.html, firebase-config.js
├── <game-slug>/<game-file>.html       ← one folder per game, e.g. gyro-space/space-tracer.html
├── scripts/check-global-collisions.js, check-undefined-globals.js
├── .githooks/pre-commit
├── PROJECT_MEMORY.md                  ← current status, priorities, technical debt — read first
├── GAME_PROTOTYPE_INSTRUCTIONS.md     ← how to build/integrate a new game
└── GAME_POSTMORTEM_TEMPLATE.md

Active Github Repos/gyro-space-server-main/   ← separate repo, the WebSocket server (Render)
```

**Not real, unlike the previous version of this file:** there's no `docs/`, `games/`, `src/`,
or `archive/` folder here, and this local folder is **not currently a git repository** — no
`.git/` exists in `My Games-main/` right now. See `GIT_WORKFLOW.md` for what that means.

## Read these first
| File | Purpose |
|---|---|
| `PROJECT_MEMORY.md` | Current per-game status, active priorities, known technical debt |
| `GAME_PROTOTYPE_INSTRUCTIONS.md` | Real architecture, hard constraints, multiplayer pattern |
| Each game's own `CLAUDE.md`, where present | File-by-file notes local to that game |

## Verify before calling anything done
```bash
cd "Active Github Repos/My Games-main"
node scripts/check-global-collisions.js
node scripts/check-undefined-globals.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
```
The first flags duplicate top-level identifiers across scripts that load on the same page. The
second is its complement — a reference to a name **no** script on the page declares. That one was
added 2026-09-07 after `zombie-game.js` was found reading two constants that existed nowhere in
the repo; with no bundler and no type checker, nothing else in this project can see that, and the
reference sat on a rare path so it only threw once something had already gone wrong.

**Stale since at least 2026-09-04:** the note that used to sit here said every game is a
single-file HTML so the collision checker "passes trivially". Not true — `zombie/`, `rd-arena/`,
`four-d-pong/`, `glass-city-escape/`, `gyro-space/` and the hub are all split into classic-script
files, and the checker reports 9–14 local scripts per page.

## Playtesting a game

**`L` + `G` held together opens the dev panel** in Zombie, 4D Pong, RD Arena and Glass City
Escape (added 2026-09-07 — `shared/devtools.js` plus a `<game>-dev.js` in each). It carries a live
state readout, **every error and warning thrown since page load**, per-game buttons (round/level
advance, clear enemies, reset, god mode, and each game's own awkward-to-reach states), and a
copyable JSON payload for pasting into a chat. `ESC` closes it.

**One exception, and it is not a bug:** in 4D Pong's **3P and 4P couch modes** `G` and `L` are
live gameplay keys (TOP's in-out and BOTTOM's move), so the combo is disarmed while a rally is
running. Pause with `SPACE` first, or open it from the menu. Everywhere else — including 4D Pong
in 1P/2P and online — it works mid-play. See `DEV_TOOLS_PLAN.md`.

## Common asks
- "Update PROJECT_MEMORY.md with [game]'s new status"
- "Wire up multiplayer for [game], following the gyro-space pattern"
- "Create a postmortem for [game] using GAME_POSTMORTEM_TEMPLATE.md"
- "Add a dev-tools button for [thing]" — one entry in that game's `<game>-dev.js` `actions` array

See `GIT_WORKFLOW.md` for version control.
