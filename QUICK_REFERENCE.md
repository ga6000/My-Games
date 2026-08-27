# Quick Reference

Replaces an earlier version of this file written against a different project (wrong repo path,
wrong folder layout). This one matches the real repo.

## Where things are

```
Active Github Repos/My Games-main/     ← this repo (ga6000/My-Games)
├── index.html                         ← hub, must stay at repo root for GitHub Pages
├── leaderboard.html, firebase-config.js
├── <game-slug>/<game-file>.html       ← one folder per game, e.g. gyro-space/space-tracer.html
├── scripts/check-global-collisions.js
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
```
Flags duplicate top-level identifiers across scripts that load on the same page. Currently every
game is a single-file HTML with inline scripts, so this passes trivially until a game gets split
into multiple classic-script files.

## Common asks
- "Update PROJECT_MEMORY.md with [game]'s new status"
- "Wire up multiplayer for [game], following the gyro-space pattern"
- "Create a postmortem for [game] using GAME_POSTMORTEM_TEMPLATE.md"

See `GIT_WORKFLOW.md` for version control.
