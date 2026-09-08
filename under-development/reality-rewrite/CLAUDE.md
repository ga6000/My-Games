# Reality Rewrite — file map

> **SHELVED 2026-09-06 — moved to `under-development/reality-rewrite/`.** Traded off the hub
> board for 4D Pong at the user's request; the board stays at five cards. **This is not a verdict
> on the game.** Nothing here is broken and nothing was removed: the six-file split, the verified
> `GameInstance`, the procedural audio and the VECTOR skin with §6.12's phosphor shift all still
> work exactly as described below. It simply has no card.
>
> **One thing changed, and it is the only thing that changes on the way down:** the five
> `../shared/…` references in `reality-rewrite.html` became `../../shared/…`, because the file is
> now one directory deeper. The six `rr-*.js` files are folder-relative and moved with it
> untouched. Reverse that one edit to promote it again — see `../README.md`.
>
> Everything below this note describes the game as it stands and remains current.

> **The split is real as of 2026-09-05.** Everything below describes files that exist. This note
> replaces a correction added 2026-09-02 which said the opposite — that the six files were a
> *plan* this document had been reading as fact. They were, for about three days short of a year
> of sessions. They are not any more.

Six classic-script files, loaded from `reality-rewrite.html` in this order:

| File | Lines | Holds |
|---|---|---|
| `rr-core.js` | ~180 | canvas/ctx, `resize()`, math helpers, `ui` refs, `STATE`, game vars, `mapBounds`, `SHIFTS`, input + `attachInputListeners`, `COSTS`, lifecycle vars, `trackTimeout`/`trackInterval`, `darken`, `resolveIdentity`, entity arrays — **plus `RRSKIN` and the earshot gate**, both new 2026-09-05 |
| `rr-entities.js` | ~560 | `Block`, `Bullet`, `SlowOrb`, `SlowField`, `Ripple`, `Particle`, `Fighter` |
| `rr-mapgen.js` | ~150 | `rotateOffset`, `makePieceRects`, `subdivideForPieces`, `buildBorder`, `buildMap`, `findSafeSpawn` — the recursive quadtree scatter map, mirrored for symmetry, quatrefoil pool, castellated border ring |
| `rr-phases.js` | ~185 | `initGame`, `hasCard`, `modifyStability`, `startAuthorPhase`, `executeShift`, `renderCards`, `triggerEnding`, `showRankings` |
| `rr-render.js` | ~180 | `update`, `updateUI`, `draw`, `loop` |
| `rr-boot.js` | ~105 | `window.GameInstance` + the standalone boot calls |

**The cut was made in strict source order and nothing was reordered.** That matters here more
than it looks: `rr-core.js` resolves `#gameCanvas` from the DOM and **calls `resize()` at load
time**, and `mouse` is then built from the `width` that `resize()` set. This is why the
`<script>` tags sit at the end of `<body>`, after the markup, and why they must stay there.

Two documented deviations from the 6-file plan this file used to carry:
- **`rr-` prefixes**, because every other split game in the repo uses one (`st-*`, `gc-*`,
  `zombie-*`) and `check-global-collisions.js` reads better for it. `game.js` → `rr-boot.js`.
- **`rr-render.js` holds `update()` and `loop()`** as well as `draw()`. The planned `render.js`
  was draw calls only, but `updateUI()` sits between `update()` and `draw()` in source, and
  separating them would have meant interleaving the range. Contiguous-ranges-only is the rule
  that has kept four splits bug-free; it was not worth spending for one 55-line file.

## Colour comes from the server now (2026-09-03)

This game used to compute its own player colour: `nameHash(name) % 360` → `hsl(hue, 65%, 55%)`.
That is **not** the shared palette, so it produced a different colour for the same player —
measured agreement with the server was **0 out of 10 names**. It could never correct itself
either, because it preferred `?color=` from the URL and the hub only ever passes `?name=`
and `?room=`.

It now loads `../shared/identity.js` and `../shared/mp-core.js` (identity first — mp-core falls
back to it when solo), connects as `game: 'reality-rewrite'`, and applies `MP.selfColor` in
`onReady` to both the identity record and the live `player` fighter, since the socket resolves
after `initGame()` may already have built it. `destroy()` calls `MP.destroy()`.

**This is identity only — the game is still single-player.** There is no `onMessage` handler and
nothing is synced. Don't read the mp-core dependency as "reality-rewrite is multiplayer now."

Do not add a name→colour function back to this file. `IDENTITY.colorFromName()` is the only one.

> **Observed live 2026-09-05, and it is the deployed-server bug, not this game's:** loaded over
> `http://127.0.0.1`, `MP.selfColor` came back `hsl(0, 85%, 60%)` while
> `IDENTITY.colorFromName('YOU')` returns `hsl(45, 75%, 49%)` — the same disagreement
> `PROJECT_MEMORY.md` measured at 0/5 on 2026-09-04. `check-identity-parity.js` is green because
> it compares the client to the **local** `server.js`, which is correct; the **deployed** Render
> instance is the stale one. Nothing in this repo can close it. Deferred by the user this session.
>
> One consequence worth knowing while reading `Fighter.draw`: the palette is `hsl()` strings, and
> `darken()` only understands `#rrggbb`, so it returns the player's colour unchanged and the arm
> shade equals the body colour. That is pre-existing and documented at `darken()` itself. Bots do
> darken correctly, because their colour is now the `--sig-magenta` hex.

## The VECTOR skin (2026-09-05) — `AESTHETIC_GUIDE.md` §6.12

Ground `#f4f6f8` → `var(--ground)`; Helvetica → `--font-ui`/`--font-display`; panels are cut-outs
in the black with a 2px `--sig-cyan` bezel (§4.11), no rounded corners and no drop shadows.
`data-game="reality-rewrite" data-cabinet="vector"` — the cabinet attribute is what keeps §4.6's
scanlines off, since they are raster-only and gated on it.

### `RRSKIN` (`rr-core.js`) — read the tokens once, own the tube

**§6.12 was wrong about where this game's colour lives, and it is worth knowing why before
trusting the rest of it.** The guide says the phosphor shift *"costs approximately one CSS custom
property because the game already funnels colour through `var(--stable-color)`."* It does not:
`--stable-color` is the **stability meter's fill** and nothing else — `#stability-bar` in CSS and
one threshold swap in `updateUI()`. What the game actually did was call
`getComputedStyle(document.documentElement).getPropertyValue('--bg-color')` **inside `draw()`, on
every frame**, which is a forced style recalc per frame. `RRSKIN.read()` replaces that with one
read at load.

`shared/retro.css` already anticipated this game and deliberately leaves `--world-hue` unset for
it, with a comment saying script drives it. `RRSKIN.setTube()` writes the CSS custom property
**and** the JS-side value together, so DOM chrome and canvas geometry can never disagree about
which tube is in the cabinet. `executeShift()` calls `nextTube()`; `initGame()` resets to green.

**The Signal Three are not available as a world hue, and that is a real constraint §6.12 misses.**
Three of the four tube colours it names (amber, cyan, magenta) are §2.2 signal tokens with fixed
meanings. Painting the whole world in one would stop that signal reading. Resolved by *role*
rather than by picking different colours: the tube colour is applied only to **world structure**
(floor grid, arena bounds, cover outlines) at low alpha, via `RRSKIN.structure(alpha)`. Signals
stay small, hot and fully saturated, so they still read against any of the four.

### The one deliberate deviation from the VECTOR cabinet

**Fighter heads are still filled.** A vector cabinet draws unfilled stroked geometry, and cover
now does. Heads do not, because this is a twin-stick shooter where you track six fighters at once
against a field of outlined boxes, and an outlined head loses that fight. They get a hot rim and
§4.3 vertex bloom instead — the look without the cost to the silhouette. Cover keeps a very faint
fill for the same class of reason: a fully unfilled box reads as a hole you can shoot through,
which in a cover shooter is a gameplay lie. `glass-city-escape/CLAUDE.md` recorded the identical
deviation against §6.8.

## Known pitfall — and it bit exactly as documented

This file has always warned that *"`render.js` has previously overwritten CSS values on every call
(the vignette regression)."* Creating `rr-render.js` while restyling the vignette walked straight
into it: `initGame()` and `renderCards()` both re-stated the **old smooth gradient** inline, which
silently beat the quantized one the stylesheet now defines.

**The rule that came out of it:** CSS owns the default vignette and is restored by *clearing* the
inline value (`ui.vignette.style.background = ''`), never by re-typing the gradient in script.
Script states only the `blind` variant, which is a state script owns. `rr-render.js` must not
write that property at all — `rr-phases.js` owns it.

## Audio (2026-09-05) — `shared/sfx.js`, procedural

No audio existed before this. Procedural rather than samples for the reason `shared/sfx.js`'s own
header gives: zero binary assets keeps the `file://` constraint untouched, and square/triangle is
the era's palette (§4.10). `SFX.configure({ game: 'reality-rewrite' })` in `init()` **namespaces
the mute preference** — without it, muting Zombie silently mutes this game. `SFX.destroy()` in
`destroy()`, because browsers cap live `AudioContext`s per page.

**Shots and hits are gated by `audible()` (`rr-core.js`), not played unconditionally.** Six bots
firing on a 0.12s cooldown is not "arcade", it is a wall of noise that buries the shot about to
kill you. Deaths bypass the gate — rare enough to afford, and a kill anywhere is information.
There is no positional pan; that lives in `zombie/` because it is a property of that game's
camera.

## Still open

- **`Firebase / Leaderboard Integrated?` is deliberately still `No`.** `getState()` does return
  `player.score` and `player.kills`, so the roadmap's question — *does this game even have a
  number* — is answerable **yes**. Whether a 3-minute deathmatch score belongs on a shared
  leaderboard is a design call, not a wiring task, and it was not made this session.
- **`Server Integrated?` remains identity-only.** No gameplay is on the wire.
- `init()`/`getState()` were verified against `GAME_PROTOTYPE_INSTRUCTIONS.md` while `rr-boot.js`
  was being written: `init`/`start`/`pause`/`resume`/`destroy`/`getState` are all present, timers
  go through `trackTimeout`/`trackInterval`, and every listener rides one `AbortController`.
  Note that `GAME_PROTOTYPE_INSTRUCTIONS.md` is itself stale on this point — it still says no game
  implements `GameInstance` — so it was read as the contract, not as a status report.

<!-- doc-sync: a6f3e788 | 2026-09-06 -->
