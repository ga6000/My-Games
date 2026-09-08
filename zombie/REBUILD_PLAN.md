# Zombie — v2 rebuild plan

**STATUS: complete 2026-09-01.** All phases landed and verified; see the
Verify section. Started 2026-09-01. Implements every idea in `DESIGN_IDEAS.md` plus a 9× map with a panning
camera. Live plan — tick items as they land. Sessions compact; this file doesn't.

## Scope decisions (from the user, 2026-09-01)

- Fix both bugs from `DESIGN_IDEAS.md` Part 4 **first**.
- Then all 26 ideas, in the Part 3 build order, **unless noted otherwise** below.
- **No 1:1 Call of Duty powerups.** Idea 4 keeps the *team-wide* concept but the pickups are
  original: `OVERCLOCK`, `ADRENALINE`, `RALLY`. No Max Ammo / Instakill / Double Points / Nuke.
  Ammo resupply is a **map feature** (idea 22 crates), not a floor powerup — that's what keeps it
  from being Max Ammo by another name.
- **Map ≥9× larger, with camera panning.** 1600×900 → **4800×2700** (exactly 3× each axis = 9×
  area).
- **Idea 23 is in** — mouse players get a hold-position modifier.
- **Idea 19 darkness is NOT permanent.** Light radius applies only during Blackout special rounds.

## Constraints this rebuild must not break

- `file://` — classic `<script>` tags, no modules, no build step.
- **The WebSocket server is a separate repo and cannot be changed.** Every new mechanic rides
  `MP.send` / the generic `relay`. No new server message types.
- World generation must use `MP.random()` off the shared seed; per-client cosmetics use
  `Math.random()`.
- Host-authoritative world, client-owned players. New authority goes on the host.
- Timers through `trackTimeout`/`trackInterval`, listeners through one `AbortController`
  (root `CLAUDE.md` hard constraint; the v1 file honoured neither).
- **No `window.GameInstance`.** `GAME_PROTOTYPE_INSTRUCTIONS.md` §2 is explicit that embedding is
  not the target and shouldn't be assumed.

## File split

v1 was a single 1040-line inline script. v2 is ~3× that, so it splits into classic scripts —
the path `GAME_PROTOTYPE_INSTRUCTIONS.md` §2 sanctions. Load order matters; all files share one
global scope, so every top-level name must be unique (`check-global-collisions.js` enforces).

| File | Owns |
|---|---|
| `Zombie.html` | Markup, CSS, script tags in load order |
| `zombie-core.js` | Tunables, world/camera state, utils, teardown plumbing |
| `zombie-level.js` | Seeded level gen: buildings, keep, doors, wall-buys, windows, barrels, traps |
| `zombie-entities.js` | Players, zombie archetypes, bullets, weapons, pickups |
| `zombie-net.js` | MP wiring, snapshots, ping markers |
| `zombie-game.js` | Rounds, update, economy, revive loop |
| `zombie-render.js` | Draw, HUD, minimap, input, boot (split out of game.js — it was too big) |

Prefix shared globals `Z_` / `z_` where a bare name would be at risk.

## Phase 1 — bugs

- [x] **B1 Clock skew.** Anything time-shaped crossing the wire goes as a *remaining duration*,
      never an absolute `Date.now()`. Affects `flashTime`, `mg`, and every new timer
      (round, overclock, adrenaline, bleed-out, revive).
- [x] **B2 Team-size scaling.** `teamSize()` feeds spawn budget. Delete the time-based drift
      (`zombieBaseSpeed += 0.0003`, `zombieSpawnRate -= 0.3`) so difficulty doesn't scale twice.

## Phase 2 — world (9× map + camera)

- [x] `WORLD_W 4800 × WORLD_H 2700`; nominal viewport 1600×900 world units.
- [x] Camera follows the player, clamped to world bounds. ~~Zoom-to-fit for couch co-op~~ removed
      2026-09-01 with local multiplayer; it now pans a fixed 1600x900 window.
- [x] `screenToWorld` must go through the camera or every mouse-aimed shot is wrong.
- [x] Cull draws to the view rect — 4800×2700 with 200 zombies otherwise redraws the whole world.
- [x] **Zombies spawn near a random alive player** (ring ~1100–1400px, outside view, not inside a
      wall), not at world edges. At this map size, edge spawns would walk for 30 seconds.
- [x] Minimap — mandatory at this size.

## Phase 3 — rounds (ideas 7–10)

- [x] Round state, curves, flow per `DESIGN_IDEAS.md` Part 1.
- [x] Intermission + round card; powerups re-hung on round clear.
- [x] Special rounds: Horde ÷5, Brute ÷10, Blackout ÷7 (Blackout is the *only* darkness).
- [x] Broadcast `roundBudget` too, so a promoted host can resume mid-round.

## Phase 4 — co-op core (ideas 1, 2, 5, 6, 25)

- [x] Downed state: crawl speed 1, cannot shoot, ~25s bleed-out.
- [x] Revive: 3s adjacent, escalating 3 → 4.5 → 6s per round.
- [x] Kill credit per `owner` (already on the bullet), + revives + assists.
- [x] Round scoreboard on the intermission card.
- [x] Proximity bonus 1.5× within 150px of a teammate.
- [x] Downed alert: off-screen arrow + flashing DOWN marker.
- [ ] ~~Sound on the downed alert~~ — **not done.** The game has no audio system at all (v1 had
      none either), so adding one is its own piece of work. The alert is visual only.

## Phase 5 — zombies (ideas 11–14)

- [x] Runner, Screamer, Splitter archetypes alongside normal/brute.
- [x] Isolation targeting for ~25% of zombies.

## Phase 6 — level (ideas 15–20)

- [x] Central keep with exactly two entrances (idea 18 — highest value, do first in this phase).
- [x] Wall-buys, seeded so all clients agree.
- [x] Doors bought from the shared pool, seeded.
- [x] Barricaded windows, re-boardable in intermission.
- [x] Barrels + traps.
- [x] Blackout-only light radius.

## Phase 7 — weapons & economy (ideas 3, 4, 21, 22, 23)

- [x] Weapons: rifle / shotgun / sniper / SMG with distinct cone, damage, rate, ammo.
- [x] Finite ammo + map crates.
- [x] Shared scrap pool, host-validated `buy` requests (two clients must not spend the same scrap).
- [x] Team-wide pickups: OVERCLOCK, ADRENALINE, RALLY.
- [x] ~~Mouse hold-position modifier (right button)~~ — **removed again 2026-09-01.** Couch co-op
      was cut after playtesting; the single WASD-move + mouse-aim scheme decouples movement from
      aim, so idea 23's problem no longer exists and the modifier had nothing to fix.

## Phase 8 — UX (ideas 24, 26)

- [x] Ping markers over the relay.
- [x] Off-screen teammate indicators — now genuinely required by the camera.
- [x] HUD: round, scrap, ammo, weapon, downed states.

## Phase 9 — feel & structure pass (2026-09-01, post-playtest)

- [x] **Tighter FOV** — nominal view 1600x900 -> **960x540** (2.78x less world on screen).
- [x] **Per-gun screen shake** — every weapon kicks (pistol 1.8 -> sniper 10), measured in SCREEN
      pixels and divided by `camera.scale`, so the tighter FOV didn't silently amplify it.
- [x] **Map segmented into 3x3 zones.** Start sealed in the centre and buy outward. Every boundary
      has a door (players) AND a boarded window (zombies), so no zone is ever unreachable for the
      horde.
- [x] **Zombies path on a BFS flow field**, not a beeline — segmentation broke naive chase AI
      three separate ways (see `CLAUDE.md` -> Pathfinding).
- [x] **Spawn ring 1050-1500 -> 620-950**, just outside the view's 551px half-diagonal. Time to
      first contact roughly halves (~22s -> ~12s at round-1 speed).
- [x] Verified: 20/20 seeded layouts have all 8 zombies infiltrate the centre zone (median 21.4s);
      260 zombies + breaking windows runs 1.44ms avg / 10.2ms worst.

## Verify

- [x] `node scripts/check-global-collisions.js` passes with 7 local scripts.
- [x] `node --check` on each JS file.
- [x] In-page harness, 60 assertions across 6 runs: both bugs, rounds, revive/bleed-out, economy,
      weapons, archetypes, camera clamp/zoom/pan, blackout, and a 14-round soak.
- [x] Perf at peak load: 260 zombies -> 0.48ms avg frame (0.27 update / 0.21 draw), 3.4ms worst.
- [x] **Opens by double-click over `file://` — CONFIRMED by the user 2026-09-02.** It could not
      be verified in-session: everything was tested over `http://localhost:8123`, because the
      preview pane snapshots local files to a `data:` URL where relative `<script src>` cannot
      resolve. The prediction held — classic relative scripts do load under `file://`, which is
      the whole reason this project bans modules.

      Worth keeping as a testing note: **the preview pane cannot verify the `file://` hard
      constraint.** Any future claim about double-click behaviour needs a human, or it is a
      prediction rather than a result.
