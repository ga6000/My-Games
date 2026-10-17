# Zombie Rail — the evacuation-train build, parked off the hub (2026-10-04)

> ## REVIVED 2026-10-17: there are now TWO pages in this folder.
>
> | page | what it is |
> |---|---|
> | **`rail-sandbox.html`** | **the live one.** A bench for the rail mechanics: a rail GRAPH with switches, four car types, coupling, fuel and a hand-authored two-town map. No levels, no rounds, **no zombies by default**. Its files are `rail-*.js`. |
> | `Zombie.html` | the parked 2026-10-04 reference build, below. Unchanged. Its files are `zombie-*.js`. |
>
> **The two pages share no code and never load together**, so `rail-*` and `zombie-*` cannot
> collide — `check-global-collisions.js` works per page and passes on both.
>
> The sandbox exists because the user asked (2026-10-17) to revive this build as a standalone
> game, turn zombies off, and get a map for testing rail mechanics. **The design and every
> decision behind it are in `RAIL_SANDBOX_PLAN.md`** — read that before changing anything in
> `rail-*.js`. The short version of the one idea that matters:
>
> - `zombie-train.js` was right that **a train on rails has one degree of freedom**, and the
>   sandbox keeps that whole. What it adds is a **graph**, which that file's own comment names as
>   its known limit (*"THE SIDINGS ARE NOT JOINED TO IT"*).
> - A body carries the **route** it occupies — front-most edge first — and car poses are walked
>   along that, never re-derived from the switches. Throwing points behind a moving train must
>   not teleport its cars. A lever is **refused** while a car stands on it rather than derailing.
>
> **Run it:** `/under-development/zombie-rail/rail-sandbox.html` on the dev server, or
> double-click it for `file://`. `?zombies=1` opts in to zombies; `L`+`G` is the dev panel.
>
> **Not promoted.** It is not on the hub board and `SCOPE_RULES.md` rule 8 is untouched.
>
> ### The numbers that were measured, not guessed
> Changing any of these without re-measuring is how the map stops working:
> - **Track curvature.** A siding's S-curve has its tightest radius at its ENDS, at `H²/(6L)` for
>   lateral `L` over run `H`. The first cut used L=320 over H=250 → a 42px radius, which bunched
>   a three-car consist by 43px. Now L=150 over H=430 → 205px, worst car-gap error 6px anywhere
>   on the network. Keep `H² >= 1200*L`.
> - **A polyline is only as smooth as its point spacing.** At a fixed 22 samples a 500px
>   transition facets every 23px, and that faceting measured as a 173px radius on a 278px curve.
> - **Fuel.** A bare locomotive gets 33s at full notch; a four-car train measured 43s = 2.86 laps
>   of the 11,758px loop. The first cut gave seven laps, i.e. a mechanic you never reach.
> - **Bullets substep.** A rifle round covers 25px per 60Hz frame and a switch lever's hit radius
>   is 18px, so testing only the frame's end point let every shot tunnel through the lever.

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
