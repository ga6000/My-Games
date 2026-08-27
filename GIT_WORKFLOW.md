# Git Workflow

Replaces an earlier version of this file written against a different, non-existent local repo
(`~/game-prototypes` with a 5-commit history that never existed here).

## Current reality

**This folder (`Active Github Repos/My Games-main/`) is not currently a git repository** — there
is no `.git/` here. The name "Active Github Repos" suggests this is a working copy pulled down
for local editing (e.g. downloaded from `github.com/ga6000/My-Games`) rather than a live `git
clone`. Before any `git` command below will work, this folder needs to actually be a repo
connected to that remote:

```bash
cd "Active Github Repos/My Games-main"
git init
git remote add origin https://github.com/ga6000/My-Games.git
git fetch origin
git checkout main   # or whatever the default branch is called
```

If you already have a real clone of `ga6000/My-Games` elsewhere on this machine, it's probably
simpler to do this restructure's edits there directly (or copy this folder's contents over it)
rather than turning this working copy into a second clone of the same repo.

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
