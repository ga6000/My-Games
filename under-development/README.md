# Under development — pulled from the hub 2026-09-04

**Thirteen** games that are not developed enough to hand to the friend group — with one
exception, added 2026-09-06 and described below. They are **still
in the repo and still on GitHub** — they just have no card on the hub board, so nobody lands
on one by accident during a session.

Twelve arrived on 2026-09-04. **Glucose Dash joined them on 2026-09-05**, and it is a different
case from the other twelve: it was never on the board to be pulled off. The tracker had it under
*"Built, not hub-linked"* — an open gap since 2026-08-29 — so moving it here made a de-facto
status official rather than removing a card.

**2026-09-06 was a swap, and the count stayed at thirteen.** `four-d-pong/` went **up** to the
repo root and `reality-rewrite/` came **down** into its slot, at the user's request. Reality
Rewrite is a third kind of case again: it is not here for lack of readiness *or* for lack of a
card — it is finished, and it was traded out. Do not read its presence in this folder as a
verdict on it.

**4D Pong's promotion was the first time anything left this folder**, so it is the first real
test of the checklist below. The checklist held. The one gap: it never mentions
`shared/retro.css`'s per-game world-hue table — and did not need to, because the hue for every
game in here was decided in advance on 2026-09-04. That is the argument for keeping the other
twelve hues listed even while nobody can reach the games.

This folder is a status, not an archive. Nothing here is abandoned; the whole point of
moving them was to make the remaining `No`s in `Game dev tracking.xlsx` a finite list.

| Folder | Entry file | Why it is here |
|---|---|---|
| `boids/` | `boids_1.html` | Was hub `mp: true` — competitive parallel worlds over the server since 2026-08-25. The most nearly-ready of the twelve that came down on 2026-09-04. |
| `glucose-dash/` | `glucose-dash.html` | **The most finished thing in this folder by a distance**, and the only one that is here for lack of a hub card rather than for lack of readiness: solo-complete, implements `GameInstance`, has procedural audio, split into twelve `gd-*.js` files and given its GEL skin on 2026-09-05. Its `Server` cell is `Partial` — it takes the room seed and identity from `mp-core` but has no ghosts on the wire, so it still plays solo. Read `glucose-dash/CLAUDE.md` and `SCOPE.md` before touching it; it has three renderer rules that have each caused a real bug when broken. |
| `desert-robot-blaster/` | `desert-robot-blaster.html` | Solo only; long-term Unity candidate. |
| `fruit-dropper/` | `fruit-dropper.html` | Solo only. |
| `hex-grid/` | `Hex Grid.html` | Tile experiment, never a game. Was flagged `broken: true` on the board. |
| `infected-labyrinth/` | `infected-labyrinth.html` | Overlaps Zombie; unverified. |
| `javelin-battle/` | `javelin-battle.html` | 2-player, but couch — not networked. |
| `kula-world/` | `kula_world_fixed.html` | Unverified. |
| `particle-simulation/` | `particle_simulation_game.html` | Unverified. Has procedural audio. |
| `ps1-racer/` | `ps1racer.html` | Was flagged `broken: true`. |
| `reality-rewrite/` | `reality-rewrite.html` | **Traded off the board 2026-09-06 for 4D Pong — shelved, not broken.** The most finished thing here after Glucose Dash: six `rr-*.js` files, a verified `GameInstance`, procedural audio, and the VECTOR skin with §6.12's phosphor shift. Read `reality-rewrite/CLAUDE.md` first. Its four `../shared/` paths became `../../shared/` on the way down — reverse that to promote it. |
| `voice-runner/` | `voice-runner.html` | Was flagged `broken: true`. Mic capture only, no game audio. |
| `wasteland-train-sim/` | `wasteland_train_sim.html` | Unverified; long-term Unity candidate. |

## Bringing one back

1. `mv under-development/<game> .` — back to the repo root, where every active game lives.
2. Fix the relative paths that changed on the way down. **Four games have any**:
   `boids/boids_1.html` (`../../shared/…` → `../shared/…`),
   `voice-runner/voice-runner.html` (`../../index.html` → `../index.html`),
   `glucose-dash/glucose-dash.html` (`../../shared/identity.js` and
   `../../shared/mp-core.js` → `../shared/…`), and
   `reality-rewrite/reality-rewrite.html` (four of them — `retro.css`, `identity.js`,
   `mp-core.js`, `retro.js`, `sfx.js`). Every other game here is a single
   self-contained `.html` with no local `src`/`href`.

   Grep for it rather than trusting this list; it is the one step that silently half-works.

   Glucose Dash also loads twelve `gd-*.js` files, but those are **folder-relative** and move
   with it — they need no edit either way. Only paths that climb out of the folder change.
3. Add its entry back to the `GAMES` array — which lives in **`hub/hub-core.js`**, not
   `index.html`, since the 2026-09-04 hub split. Carry `broken: true` until it actually runs;
   that flag is what draws the "COMING SOON" stamp. A game that plays together at one keyboard
   rather than over the server takes `couch: true` instead (added 2026-09-06 for 4D Pong), which
   stamps "COUCH 2-4P".
4. `node scripts/check-global-collisions.js` and `node scripts/check-doc-sync.js` from the
   repo root. The doc-sync hash **will** move: a game here is invisible to `gameDirs()`
   (which only looks one level down), so promoting one puts it back into the repo-wide
   fingerprint.

## Do not do speculative work on these

The point of this folder is that its contents are **out of scope until deliberately promoted**.
Work spent here is work spent on something nobody can reach from the board.

**Glucose Dash on 2026-09-05 is the one recorded exception**: it was shelved and then given its
full Split + Aesthetic pass in the same session, at the user's explicit instruction, because that
work was already scoped and the file already understood. It is noted here so it does not read as
precedent for the other twelve.

**4D Pong on 2026-09-06 is not a second exception.** It was rebuilt *after* being promoted, at
the root, where the board can reach it — which is the rule working, not an exception to it.

## Mobile

Several of these still carry touch controls, a D-pad or an `orientationchange` handler.
That was left alone deliberately when mobile support was switched off across the active
games on 2026-09-04 — doing that surgery on a shelved game is work spent on something
nobody can reach. Strip it when the game comes back, not before. See
`../SCOPE_PULLBACK_PLAN.md` §1c.
