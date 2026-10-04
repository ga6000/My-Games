# Zombie Rail — the evacuation-train build, parked off the hub (2026-10-04)

**What this is:** a copy of `zombie/` as it stood at tag **`zombie-rail-fork`** (commit `22365e6`).
It is the most developed version of Zombie: nine painted sectors, hand-authored stamps, the map
editor, and the generator → levers → tanks → train → tunnel chain. The user parked it here,
outside the hub, so that `zombie/` could become **ZOMBIE ARCADE**: an open map aimed at a 2–4
minute run (`../../HUB_1_0_PLAN.md`).

**It is not under active development.** `under-development/README.md` rules apply: no
speculative work until it is deliberately promoted. Its ideas belong to the long game
(`../../zombie/THE_SPLIT.md`), which is meant to start outside this repo and carry **knowledge,
not code**. This copy is that knowledge, still runnable.

## How it differs from `zombie/` at the fork

Only the things needed to run side by side without colliding:

| | `zombie/` (arcade) | here |
|---|---|---|
| `../shared/` paths | `../shared/` | `../../shared/` (one folder deeper) |
| MP room namespace (`MP.connect` in `zombie-net.js`) | `zombie` | **`zombie-rail`**, so the two builds never share a room and sync incompatible worlds |
| Leaderboard id (`LB.configure` in `Zombie.html`) | `zombie` | **`zombie-rail`**, so its runs don't mix into the arcade's board. `leaderboard.html` doesn't list it; Firestore rules may also refuse an unknown id. Untested |
| Dev panel key (`zombie-dev.js`) | `zombie` | `zombie-rail` |
| Map editor export (`MAP_DATA_PATH` in `zombie-mapedit.js`) | `/zombie/zombie-map-data.js` | **`/under-development/zombie-rail/zombie-map-data.js`**. Before this change, this copy's editor would have overwritten the arcade's map. `scripts/dev-serve.js` allows both |
| `<title>` | Zombie | Zombie Rail |

`data-game="zombie"` on `<body>` is unchanged. It selects the world hue in `retro.css`, and the
look is the same.

## Documentation

**The file-by-file reference is `../../zombie/CLAUDE.md` at the tag:**
`git show zombie-rail-fork:zombie/CLAUDE.md`. The same goes for every design doc
(`TRAIN_RAIL_PLAN.md`, `LEVEL_BUILDER_PLAN.md`, `MAP_VISUAL_AUDIT.md`,
`SESSION_CONTEXT_MAP_AUTHORING.md`, `PLAYTEST_2_PLAN.md`, ...). They weren't copied, so there is
one history rather than two copies that drift. From 2026-10-04 onward, `zombie/CLAUDE.md`
describes the arcade, and it will stop describing this build as the arcade is trimmed.

**Not covered by the checkers that target `zombie/`:** `scripts/check-zombie-train.js`,
`check-map-features.js` and `measure-zombie-nav.js` all read `zombie/`. They describe this build
only until the arcade loses its rail. `check-global-collisions.js` and
`check-undefined-globals.js` do scan this page.

## Run it

- Double-click `Zombie.html` (solo, `file://`).
- Or, with the dev server: `/under-development/zombie-rail/Zombie.html?solo=1`.
- The editor is `map-editor.html`, and the stamp builder is `stamp-builder.html`.
