# FROZEN SNAPSHOT — rd-arena as of 2026-09-08, before multiplayer

**Do not edit, do not sync changes into this folder.** It is MP_ROLLOUT.md §0's dated
fallback: if multiplayer goes badly you double-click `rd-arena.pre-mp/RDArena.html` and you
are playing the 2026-09-07 build. It sits at this depth so its `../shared/` paths still
resolve. `check-doc-sync.js` tracks this file too (it finds docs by name, not by stamp) but it
will never go stale: the code it is scoped to is frozen, so its hash cannot move.

---

# RD Arena — file map

New 2026-09-05. This folder had no `CLAUDE.md` while every other active game did, which is
awkward given root `CLAUDE.md` says the per-game docs are the most accurate ones in the repo.
The other two files here are still current and cover different ground: `RD_ARENA_V2_PLAN.md`
(the V2 rebuild) and `MP_ROLLOUT.md` (multiplayer, still unbuilt).

## Nine files, split 2026-09-05

Was one 2,487-line `RDArena.html` — the tracker had it flagged "best split candidate" for weeks.

| File | Lines | Holds |
|---|---|---|
| `rd-core.js` | ~56 + skin | canvas/ctx, teardown plumbing (`abortCtl`, `timeoutIds`, `intervalIds`), world & camera — **plus `RDSKIN`, `audibleRD()` and the `SFX` bootstrap**, all new 2026-09-05 |
| `rd-field.js` | 203 | **the Gray-Scott reaction-diffusion field** — `dA`/`dB`/`feed`/`k`, the 400×400 grid, the `>0.3` threshold |
| `rd-netfield.js` | ~130 | **added 2026-09-07** — the 133² 2-bit network field the flesh is DRAWN from. Render-only; see below and `NET_FIELD_NOTES.md` |
| `rd-sanctuary.js` | 289 | human sanctuaries, antibacterial defence, organs |
| `rd-flow.js` | 193 | the flow field |
| `rd-input.js` | 168 | input and build state |
| `rd-entities.js` | 619 | entities and projectiles |
| `rd-rounds.js` | 188 | round/spawn state, the organ BIOhack loop |
| `rd-render.js` | 361 | rendering helpers (`drawSanctuaries`, `drawOrgans`, HUD, card offer) |
| `rd-boot.js` | 361 | the main `loop()` **and the boot sequence** |
| `rd-dev.js` | ~190 | **added 2026-09-07** — dev-panel registration, and `rdDevGod` |

## The network field — `rd-netfield.js` (2026-09-07)

The flesh you see is no longer `gridB`. It is a **133² 2-bit downsample of `gridB`, repacked once
a second and lerped between the last two packets** — the parameters picked in
`rd-arena-bench/rd-curves.html`. 4,423 bytes per packet, 4.52× cheaper than `MP_ROLLOUT.md` §2's
planned 400² 1-bit mask and arriving twice as often. `NET_FIELD_NOTES.md` has the full table.

**There is still no netcode.** `RDNET.pack()` reads the local sim; nothing is sent. The point is
to answer the visual question — *does a coarse, one-second-stale surface still read as this
game?* — before MP_ROLLOUT's steps 1–4 put a socket underneath it.

Two things that are easy to get wrong here:

- **`gridB` is still what you walk into.** `isSolid`, `isFlesh`, `hasLOS` and the flow field are
  untouched and still read the raw 400² field. So the wall you see is up to one second stale and
  one 36 px cell coarse relative to the wall you collide with. That gap is the thing to judge.
  It is also why none of this has to be agreed between clients.
- **The easing is `easeOutBack`, and it is fast.** At t=0.5 it is already at 1.003 — the surface
  arrives most of the way early, overshoots, and settles. That is the lab's "squelchy" option
  behaving as designed, not a morph that finished too soon.

`RDNET.WARP_AMP` is **0**: the domain warp is off. A wobbling warp fights the §6.4 raster grid,
which is a pixel lattice and not an organic edge. The constants stay so it can be dialled back
in without re-deriving them.

**F9 toggles it** (`RDNET.enabled`), so the A/B is within one session on one field, per
`MP_ROLLOUT.md` §1. Neither F9 nor `L`+`G` is in this game's `keys` map. The packet clock is
driven from `loop()` rather than a timer, so it cannot outlive `destroy()`.

`../shared/devtools.js` loads before `rd-core.js` (its keydown listener has to beat
`rd-input.js`'s so a combo press can be stopped from also reaching the player) and `rd-dev.js`
loads last, after the game is already running. Fourteen local scripts now, not eleven.

**Cut in strict source order; nothing reordered.** The one textual change is that the four-space
indent the whole script carried inside `<script>` was removed — verified whitespace-only first,
because there are no multi-line template literals to have their content shifted.

`rd-boot.js` **ends by calling** `rebuildFlowField()`, `startRound(1)` and `loop()`, so the tag
order in the HTML is the game's start-up sequence, not just a dependency list. The tags live at
the end of `<body>` because `rd-core.js` resolves `#gameCanvas` at load time.

## Dev tools — `L`+`G` (2026-09-07)

Neither key is in this game's `keys` map (`w a s d e q r f space`, plus `1 2 3` for card picks), so
the combo is always armed here — no `armedWhen` predicate, unlike 4D Pong.

**`rd-dev.js` is supported by exactly one line of gameplay code**, in `Entity.hit()`:

```js
if (this.isPlayer && (this.invuln > 0 || this.isDashing)) return;
if (this.isPlayer && rdDevGod) return;          // dev panel god mode
```

It sits with the other two reasons the player takes no damage rather than anywhere else, so there
is one line in `rd-entities.js` to delete along with the panel. **`rdDevGod` is a module-level flag
rather than a field on `player` for a specific reason**: `player` is *replaced* on death
(`player = new Entity(...)` inside the respawn timeout), so a flag on the instance would evaporate
at exactly the moment you would notice god mode was not on.

Two buttons worth knowing:

- **RESET GAME reloads the page**, because this game has no reset path of its own — no game-over
  screen, no restart, just an endless field and a death that respawns you two seconds later. A
  reload *is* the reset here; hand-clearing twenty arrays to imitate one is how you end up
  debugging the dev tool instead of the game.
- **PAUSE / RESUME** flips `running` and calls `loop()` again to resume, since `loop()` bails on
  `!running` at the top and re-arms its own rAF at the end.
- **MAX A TREE** applies real cards through their own `apply()`. Bumping `build[t].tier` by hand
  would leave every stat behind it untouched, which is a build that exists nowhere in the game.

## The RASTER skin (2026-09-05) — `AESTHETIC_GUIDE.md` §6.4

§6.4 called this "the best discovery in this review" and it was **right, which makes it the only
§6 entry in this phase that has been** — the flesh field was already thresholded at `gridB > 0.3`,
already filled in one flat colour, already on a 400×400 grid. It only had to stop drawing itself
as overlapping discs.

The change is literally: one `ctx.arc(bx, by, cellSize * 0.78, …)` per solid cell became one
`ctx.fillRect(x * cellSize, y * cellSize, cellSize, cellSize)`. The fleshscape is now a chunky
pixel grid — what a 1978 raster cabinet could actually put on a tube.

**The simulation is untouched, and that is the point.** §5 lists `dA`/`dB`/`feed`/`k`, the grid,
the `>0.3` threshold, the flow field and the motes as untouchable: this game *is* its
reaction-diffusion field. Collision, LOS and the flow field still read `gridB` exactly as before,
so nothing a future multiplayer bitmask would have to agree on has moved.

Also done: two-tone band (cells above `RDSKIN.HOT_BAND` = 0.6 in a hotter tone), sanctuaries →
`--sig-cyan`, sprinkler motes → `--sig-amber`, walls → `--phos-mid` with a `--phos-hot` top edge,
ground `#050505` → `var(--ground)`, the pulsing floor's discs → cells, `data-cabinet="raster"`
and a real `.retro-scanlines` overlay — this is the cabinet §4.6 actually permits them on.

### `RDSKIN.heat()`, and why it is not a lift toward white

The hot band is derived from `--world-hue` rather than hardcoded, so the two tones cannot drift
apart. The first implementation lifted toward white, which is the obvious move and the wrong one:
`#8B0A2E` lifted 45% toward white is `#BF788C`, a washed dusty pink. **A two-tone sprite reads as
two brightnesses of one ink, not as one ink and one pastel.** `heat()` raises HSL *lightness* and
holds hue and saturation, giving `#dc1049`.

### Two bugs this pass found, one of them a trap worth knowing

1. **`RDSKIN.read()` must read `getComputedStyle(document.body)`, not `documentElement`.** The
   world hue is selected by `[data-game="rd-arena"]`, and **that attribute is on `<body>`**.
   Reading the root element resolves `--world-hue` to the `:root` default — `var(--phos-mid)` —
   and silently paints the entire fleshscape pale grey-green. It looks like a deliberate colour
   choice, not a bug, which is what makes it worth writing down. (Reality Rewrite does not hit
   this because it *writes* `--world-hue` onto `documentElement` from script.)
2. **`loop()` self-schedules its own `requestAnimationFrame`.** Calling it in a tight loop to
   hand-step the sim forks one rAF chain per call and wedges the page. Step the simulation
   directly instead. This is a testing trap, not a game bug.

### Measured, and it corrects §6.4

§6.4 predicts the rect version "should also be faster: rect fills beat 160k arc paths."
**Measured on the real canvas, over the same visible cell set: 0.177 ms/frame for the arcs vs
0.165 ms for the two rect passes — 1.07×, a wash.** The reason is that the `160k` figure assumes
the whole 400×400 grid is drawn, and it never is: the draw is clipped to the camera viewport, so
the real count is **617 solid cells**, not 160,000. The render change is still correct — it is the
period-accurate look — but it is not a performance win, and the estimate it rests on was for a
loop that does not exist.

## Audio (2026-09-05) — procedural, and `glide.mp3` stays orphaned

`glide.mp3` sits in this folder and is **referenced nowhere**. It stays that way. Audio is
procedural via `shared/sfx.js`, matching Zombie and Glass City: zero binary assets keeps the
`file://` constraint clean, and the repo's one sampled-audio game is the one with the open freeze
bug. The file is left in place rather than deleted — deleting an asset is a separate decision.

`SFX.configure({ game: 'rd-arena' })` **namespaces the mute preference**; without it, muting this
game silently mutes Zombie. `SFX.unlockOn(window, abortCtl.signal)` rides the same
`AbortController` everything else here does.

**`audibleRD()` gates shots and enemy hits to the camera viewport plus a 160px margin.** Up to 40
grunts fire on their own cooldowns across a 4800×4800 world; playing all of them is a wall of
noise that buries the shot about to kill you. The player's own hits and death always sound. There
is no positional distance mix — that lives in `zombie/`, because it is a property of that game's
camera.

## Still open

- **`Server Integrated?` is still `No`, deliberately.** A 400×400 Gray-Scott field cannot go on
  the wire, and it is the game. The only shapes that work are deterministic-seed-plus-input-lock
  or host-authoritative-summary. That is a design session with its own plan file — see
  `MP_ROLLOUT.md` and `COLUMN_COMPLETION_ROADMAP.md`. **Deferred by the user on 2026-09-05.**
- **The Space Invaders speed-up (§6.4's gameplay suggestion) was NOT implemented.** Raising RD
  steps per frame as the field shrinks is a good idea and roughly one line — and it is a
  difficulty-curve change to a game whose balance nobody has re-measured since the V2 rebuild.
  Every session in this phase has changed no gameplay; this one kept that. Flagged, not taken.
- **This game does not implement `window.GameInstance`.** It has the teardown plumbing (one
  `AbortController`, tracked timers) but no `init`/`start`/`pause`/`resume`/`destroy`/`getState`.
  Out of scope for the columns this session closed, but it is the only active game missing it.
- `Firebase / Leaderboard Integrated?` remains `No` — round reached would be the obvious score.


<!-- doc-sync: 7fd3fd4a | 2026-09-19 -->
