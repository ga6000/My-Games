# Git Workflow

Replaces an earlier version of this file written against a different, non-existent local repo
(`~/game-prototypes` with a 5-commit history that never existed here).

## Current reality

> **Corrected 2026-09-08.** The section this replaces said this folder was **not** a git
> repository and gave `git init` instructions. That was wrong, and it had been wrong long enough
> to get quoted as fact elsewhere — `rd-arena/MP_ROLLOUT.md` §0 built its whole "how do I revert
> this" argument on it, and a session repeated the claim without checking. **Check with
> `git rev-parse --show-toplevel`, not with this file.**

`Active Github Repos/My Games-main/` **is a real clone**, on `main`, with
`origin = https://github.com/ga6000/My-Games.git` and history behind it. `git checkout .` works.
The pre-commit hook is already active (`core.hooksPath = .githooks`).

## Once it's a real repo

```bash
git status                          # what changed
git add <specific files>            # avoid `git add -A` — review what's staged
git commit -m "..."                 # see repo convention below
git push origin main
```

**Pre-commit hook:** `.githooks/pre-commit` runs the collision checker. Activate it with:
```bash
git config core.hooksPath .githooks
```
It's warn-only by default (`|| true` in the hook) — won't block a commit until you remove that.

## Typical workflow for shipping a game change

1. Make the change in the game's own folder
2. `node scripts/check-global-collisions.js` from the repo root
3. Update `PROJECT_MEMORY.md`'s status table and, if relevant, `Game dev tracking.xlsx`
   (outside this repo, in the local working folder)
3. Commit, push
4. GitHub Pages picks up `main` automatically for the hub/games; the server
   (`gyro-space-server-main`) deploys separately via Render, from its own repo

## Postmortems

When a game reaches a stable/shipped state, copy `GAME_POSTMORTEM_TEMPLATE.md` into that game's
own folder as `POSTMORTEM.md` and fill it in.
