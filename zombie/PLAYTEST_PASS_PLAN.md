# Zombie — playtest pass (2026-09-18)

**STATUS: complete 2026-09-18.** All 18 items landed and verified (log at the bottom). Not yet re-playtested by the group.

Eighteen items came back from a friends playtest. Numbered as the user numbered them.

## Decisions made up front (flag these on delivery)

| # | Decision | Why |
|---|---|---|
| 16 | **Mute moves `M` → `N`.** `M` now toggles the minimap + TIME / ZOMBIES / KILLS | The user asked for `M` = map. `N` sits next to it |
| 8 | Bleeding out while a teammate is still up = **dead until the next breather**, then respawn at the keep with a pistol. Perks are kept, bought guns are not | `DESIGN_IDEAS.md` #1 said "dead for the round". Today a dead player respawns instantly on any keypress, which is the reported bug |
| 8 | **Everyone down at once = the run is over** (2 s grace so a RALLY grab can still save it) | The game-over card already says "EVERYONE WENT DOWN". Also closes the known gap "a solo player going down is a 25 s crawl that ends in death regardless" |
| 7 | Blackout **trips a running generator**. Restart = stand at it for 5 s (free, host-tracked, like the gate plates). The round cannot clear while it is tripped — stragglers keep coming | "force the players to restart the generator prior to blackout stopping" |
| 7 | `AMBIENT_BLACKOUT_ADD` 0.20 → **0.26**. Cap stays 0.9 | "slightly darker". After a restart a blackout reads 0.48, was 0.42 |
| 5/6 | 11 perks, **8 stations per map** (one per outer zone), **OVERDRIVE guaranteed**. The 3 absent perks are listed in the manual and announced when power first comes on | 4-of-6 with no guarantee is why OVERDRIVE never showed. Rotation is kept so maps still differ |
| 9/11 | BEACON removed. New: **DECOY** (its replacement), **ARC**, **BLASTCAP**, **SKEWER**, **LAST STAND**, **SALVAGE** | Action-augmenting, and none are Perk-a-Cola clones |
| 10 | UI says **PERKS**, not cards. Code keeps `cards`/`CARDS`/wire `cd` | It is what the players call them; renaming internals is churn |
| 13/14 | Rocket + flamethrower need **weapon switching** (`1`–`7`, mouse wheel), and a dry gun auto-switches to the next one you own | Otherwise buying the rocket launcher throws your rifle away. Closes the known gap "no manual weapon switching" |
| 15 | ULTRA HEAVY is **34 px**, so `NAV_PAD` 15 → **19** and `NOOK_HOLE` 74 → **90** (guaranteed-navigable width becomes 78 px) | The nav pad must cover the largest body; a 74 px nook hole would drop below the guarantee |
| 3 | Funnels 2 and 3 sit in **funnel halls** — two-wall hallways built into their zone before the scattered buildings. Every silo sits beside its funnel, piped to it | "in hallways (preexisting structures) … adjacent … piping visually connecting" |
| 1 | Flicker budget **removed** for zombies | Playtest: distracting and hard to read. §4.7 of the aesthetic guide is superseded for this game |

## Items

- [x] **1 Flicker** — `drawZombies` draws every zombie every frame.
- [x] **2 Music** — new `zombie-music.js`. D-minor organ bed on a 66 BPM grid, scheduled
      ahead from the rAF loop (no new timer). Intensity from zombies within 1000 px (cap 30).
      Soprano layer eases in from 12 nearby, full at 26. Cues quantized to the beat: game-start
      chimes, round start, round clear, generator trip, power restored, the sluice **build layer**
      (tracks gate progress) and its unlock flourish. The intensity drone is deleted.
- [x] **3 Funnel halls + silos + pipes** — `zombie-level.js` / `zombie-endgame.js` / render.
- [x] **4 Zone floors** — new `zombie-floors.js`: a 64² texel tileable texture per zone template
      (pattern + tileable value noise), drawn ×2, plus a quantized grime noise-map overlay.
      Minimap tints zones to match.
- [x] **5 OVERDRIVE always spawns**; station placement can no longer silently drop a station.
- [x] **6 Absent perks noted** — manual lists "NOT ON THIS MAP"; announced at power-on.
- [x] **7 Blackout** — trip, restart, straggler gating, darker.
- [x] **8 Death** — host tracks guests' bleed-outs (they never bled out before), team wipe → game
      over (explicit `over` message, not just the throttled snapshot flag), respawn at breather,
      spectator camera.
- [x] **9 New perks** — ARC, BLASTCAP, SKEWER, LAST STAND, SALVAGE (+ DECOY under 11).
- [x] **10 Perk icons** — new `zombie-icons.js`, pixel bitmaps, no emoji. Blurb removed from the
      station prompt (manual only).
- [x] **11 BEACON → DECOY** — ping lures zombies within a radius for a few seconds (cooldown).
- [x] **12 Bullet shapes** per gun (round / tracer / pellet / needle / streak / rocket / flame).
- [x] **13 Rocket launcher** — 7,500 wall-buy, splash, chains barrels.
- [x] **14 Flamethrower** — 5,200 wall-buy, short piercing stream, sets zombies burning.
- [x] **15 ULTRA HEAVY** — from round 16, one guaranteed per round plus rare extras; octagonal
      silhouette; bullets cannot pierce past it. **Re-measure traversal** (24 layouts × 24 runs
      per type, doors open, barricades broken), before and after.
- [x] **16 `M` toggles map + stats**, ~~persisted in localStorage~~ (superseded by the follow-up:
      it now starts hidden on every page load and is not persisted).
- [x] **17 Bottom-left gun HUD** — icon, name, large ammo readout, owned-gun strip.
- [x] **18 Perk icons + stack badges** next to the gun HUD.

## Follow-up asks (2026-09-18, during the playtest)

- [x] **Dev panel: FREE BUYS and NO ZOMBIES** toggles (+ SPAWN TARGETS, stationary dummies to
      shoot at). Host-gated like the other world buttons. Done by *wrapping* `hostHandleBuy`,
      `spawnZombie` and `spawnZombieAt` from `zombie-dev.js`, so the dev file stays deletable with
      no diff in any gameplay file (its header's rule).
- [x] **Start without the minimap** — `hudMapOn` starts false on every page load; `M` shows it
      and the choice holds across restarts in the session. No longer persisted.
- [x] **Start prompt trimmed** to "join" + "ESC — how to play & goals". The instructions move into
      a new **ESC dialog**: the map's goals as a checklist (generator, sluice, silos 1–3, flood,
      escape — each ticked from live state, current one highlighted), plus controls and rules.
- [x] **NEXT goal above the minimap** while the minimap is showing — the first unticked goal.
- [x] **Field manual CLASSES tab** — what each role's traits do, exactly, and which one is yours.
      Found while writing it: ENGINEER's "reboards 150% stronger" could never fire (every breather
      already re-boards every window to full, so there was never a damaged window to re-board).
      It now applies to the breather re-board whenever an ENGINEER is in the game. Also: the trap
      prompt never showed ENGINEER's 40% discount, and a >100% window drew planks past its ends.

**Verified:** 30/30 headless checks (minimap hidden at start and `M`; the dialog before and after
joining; 7 goals with the right one current; ticks following state, incl. a tripped generator
jumping back on top while later goals stay ticked; NEXT drawn only with the minimap; NO ZOMBIES —
nothing spawns for 25s and the round holds; SPAWN TARGETS under it, and they stay put; FREE BUYS —
door, generator, wall-buy and perk from an empty pool, and normal prices again when off; the
CLASSES tab; ENGINEER 150% on vs 100% off). In the browser through the real input path: ESC
opened/closed the dialog on the start screen and in play, the dev panel's new buttons clicked
through, the `[DEV: FREE]` prompt tag, no console errors. Every earlier suite re-run green.
Collisions / undefined-globals checkers clean.

## Connection pass (2026-09-19): the revive-bar pulse, drops, rejoins, late joiners

**The pulse (bug, measured).** The host adds to a downed guest's revive progress every frame, but
the `players` handler rebuilt the guest's record from the guest's own payload — including `rv`, the
guest's copy of the progress, which is always a round trip old. 15 times a second the host's value
was knocked back to a stale one. Two clients through the local relay, host reviving a guest:

| added latency | host's bar went backwards | revive took (should be 3.0s) |
|---|---|---|
| 0 | 34 times | 5.4s |
| 60ms ±30 | 69 | not done in 6.4s |
| 150ms ±75 | 65 (and 14 on the downed guest's own screen) | not done in 6.4s |

Fix: revive progress has ONE source, the host (`rvs`); the `players` payload stops carrying it and
the handler updates the record in place instead of rebuilding it. Plus a little range hysteresis
(a reviver already reviving keeps it to +18px) and display easing between `rvs` packets.

**Connection trouble, today** (read from `server.js` and `mp-core.js`):
1. Every reconnect is a **new socket id**, and the player id, the role, the scoreboard row and the
   host's bleed clock were all keyed on it — so a wifi drop re-rolled your class, wiped your kills,
   and made you a stranger to the host.
2. A dropped client flipped to **solo host** and simulated its own fork of the world: its own
   zombies could down or kill it, and a local game over could follow — after which clicking
   "restart" on reconnecting sends a room-wide reset.
3. A merely *stalled* socket (no close, packets queued) left the host still mauling the player's
   last known position while their screen was frozen.

**Plan** (all landed 2026-09-19 — verify log below):
- [x] **Stable identity**: a per-tab token (`sessionStorage`) instead of the socket id for the
      player id, the role and everything keyed on them. Survives drops and page refreshes. The
      socket id rides the payload (`sk`) so a server `leave` can still be matched; a duplicated tab
      (which copies sessionStorage) re-rolls its token on seeing its own id with another socket.
- [x] **Away, not gone**: a teammate silent for 1.2s (or `leave`d by the server) is *away* for up to
      60s — drawn ghosted with RECONNECTING, untargetable, can't be downed, revived, stand on a
      plate or restart the generator; their bleed-out clock pauses; they don't count toward team
      size. Back within 60s → they carry on where they were. A wipe waits 10s, not 2s, when a
      teammate who was standing is only away.
- [x] **Drop → hold, not fork**: a client that loses the room mid-run *with teammates in it* holds
      its world (no local simulation, no input) under a RECONNECTING overlay; after 15s it offers
      ENTER to carry on alone. Alone in the room it just carries on solo, as before.
- [x] **Late joiners**: spawn beside a standing teammate (4s protection) instead of the keep, with a
      rifle if the run is past round 4; everyone gets a JOINED / RECONNECTED / LOST CONNECTION toast.
- [x] A guest with no snapshot for 1.5s sees "CONNECTION UNSTABLE".

**Found while testing it, and fixed:**
- The duplicate-tab re-roll fired on **both** tabs (each sees the other), costing the original tab
  its class too — and a single stray packet from our *own* dead socket, relayed to us just after a
  reconnect, would have triggered it and cost a reconnecting player the identity this pass exists
  to keep. Now only the higher socket id re-rolls, and only once the clash has persisted over 1s.
- A host **restart** after a real game over sends `go=0` again; if that snapshot landed in the same
  batch as the `reset` (applied on the next frame) the guest briefly ran `rejoinRunningRoom` first.
  Guarded on `pendingReset`.

**Verify log (2026-09-19):**
- **The pulse, same harness, same three latencies, after the fix**: the host's bar went backwards
  **0 / 1 / 1** times (was 34 / 69 / 65) and the downed guest's **0 / 0 / 0** (was 14 at 150ms); the
  revive landed in **3.0s / 3.0s / 3.1s** at 0 / 60 / 150ms (was 5.4s, then never). The one
  backwards step at 60 and 150ms is the bar returning to 0 when the revive completes (0.997 → 0).
- **Connection suite, 55/55**, two and three real clients through the local relay, which can now cut
  a client's TCP connection or stall it without closing:
  1. guest drops → host marks it AWAY (ghosted, untargetable, out of team size, LOST CONNECTION
     toast); the guest HOLDS under the overlay and does not move or simulate; mp-core reconnects it
     3s later on a new socket → **same player id, same class, scoreboard row kept**, RECONNECTED
     on both screens.
  2. a *downed* guest drops for 40s of host time (the bleed-out is 25s) → not bled out, run not
     ended; back with 23.8s left of the 24.7s it had.
  3. host downed while the only standing teammate is away → still running at 6s, over at 12s.
  4. the **host** drops → the guest is promoted and carries the round on; the old host holds, then
     comes back as a guest with its own id.
  5. hold → the ENTER offer shows at 15s → carrying on alone gives the held time back to a
     downed player's bleed-out.
  6. page refresh (a new instance on the same sessionStorage) → the same token, one guest on the
     host, not two.
  7. a friend joins at round 6 → sees round 6, spawns 36px from a standing teammate with 4s of
     protection and a rifle in hand; JOINED on the host.
  8. a guest whose own screen says GAME OVER while the room plays on → folded back in, awaiting
     the breather.
  9. a stalled socket → AWAY on the host after the silence, CONNECTION UNSTABLE on the guest, both
     cleared when traffic resumes.
  10. a duplicated tab → exactly one of the two re-rolls, and they see each other.
- **Every earlier suite re-run on the final code**: smoke (0 errors), perks 19/19, score 15/15,
  follow-ups, two-client 26/26, generation 200/200 clean. Checkers clean.
- **Browser** (dev server, dead socket): the CONNECTION LOST overlay with its timer and the ENTER
  offer, the ghosted RECONNECTING teammate, ENTER through the real key handler → PLAYING ON ALONE,
  CONNECTION UNSTABLE on/off; no script errors.

## Wire changes (all ride the generic relay — the server cannot change)

- `world`: `z` rows gain burn ms; `b` rows gain weapon index; new `gt` (tripped), `gr`
  (restart progress), `sb` (scoreboard — guests never saw it before), `dc` (active decoys).
- `shoot` gains `wk` (weapon index) so the host's copies carry splash/burn/shape.
- `ping` gains `id` so the host can check the pinger's DECOY level.
- New kind `over` — host → room, team wiped.
- `Z_TYPE_KEYS` and weapon indices only ever **append** (`ultra`, `rocket`, `flamer`).

## Files

| File | Change |
|---|---|
| `zombie-core.js` | `WEAPON_KEYS` (one ordered list for wire, sound, switching) |
| `zombie-audio.js` | Drone removed; new voices (rocket, flamer, ultra, arc, trip, decoy) |
| **`zombie-music.js`** | New — the score |
| `zombie-level.js` | Nav pad, nook hole, funnel halls, keep-clear rects, 8 stations, 6 wall-buys |
| `zombie-entities.js` | Weapons, perks, ultra, owned guns, switching, bullet kinds |
| `zombie-endgame.js` | Silo/pipe geometry, hall data |
| `zombie-game.js` | Procs, rockets, burn, decoy, trip/restart, bleed/wipe/respawn, ultra spawns |
| `zombie-net.js` | Wire changes above |
| **`zombie-icons.js`** | New — perk + weapon pixel bitmaps → data URLs + canvases |
| **`zombie-floors.js`** | New — zone floor textures |
| `zombie-render.js` | Floors, shapes, ultra, burn, bolts, halls/pipes, HUD, manual, input |
| `zombie-dev.js` | Playtest buttons: spawn ultra, trip generator, give guns / perks |
| `Zombie.html` | Loadout HUD, spectate banner, stats wrapper, 3 script tags, prompt text |

## Verify

- [x] `check-global-collisions.js`, `check-undefined-globals.js`, `check-identity-parity.js`
- [x] Headless: 500 seeds — 8 stations each, OVERDRIVE every time, both halls built, no hall
      overlapping walls / crates / stations, every zone reachable on the nav grid
- [x] Headless traversal before/after (all 7 types incl. ultra)
- [x] Browser (dev server): no console errors; screenshots of floors, HUD, halls, ultra, flames
- [x] Two clients through a local relay: wipe → both see game over; bleed-out → respawn at
      breather; generator trip syncs; rocket blast not doubled for the shooter
- [x] `check-doc-sync.js` → reconcile `zombie/CLAUDE.md` + the cross-cutting docs → `--update`

## Verify log (2026-09-18)

All headless runs use a Node harness (session scratchpad, not in the repo) that loads the real
scripts from `Zombie.html` into a `vm` context with DOM/canvas/audio stubs and a controllable clock.

- **Checkers**: collisions OK (17 local scripts), no unresolved globals, identity parity 3,025/3,025.
- **Generation sweep, 500 seeds, new code: all clean** — 8 stations, OVERDRIVE present, stations in
  8 distinct zones with 8 distinct perks, 6 wall-buys, both halls built (no fallback ever ran), each
  silo within reach of its funnel, nothing solid inside a hall or the sluice, no item in a wall or on
  another item, and every funnel, silo, plate, station, wall-buy, the generator, the escape and
  every zone reachable on the nav grid with doors open. **The same sweep on the old code** (200
  seeds): OVERDRIVE missing 61, walls in the sluice 164, funnel 1 unreachable 62, a plate
  unreachable 5, stations in walls 15, wall-buys in walls 12, the generator in a wall 4, plus
  crate/station/wall-buy overlaps.
- **Traversal** (24 × 24 per type, 120s cap): before — walker/runner/screamer/splitter/brute all
  100%; after — the same five 100% and the ULTRA 100% (574/576 unaided, 2 via relocation), 0
  despawns, 0 timeouts.
- **Two clients through a local stand-in relay** (clocks 777s apart), 26/26: guest bleeds out on the
  host's clock; dead guest cannot key back in; respawns at the breather with a pistol; scoreboard
  reaches the guest; generator trip and restore sync; a guest's rocket is drawn once on the shooter
  and once on the host; a guest's DECOY registers on the host, draws on the guest and is
  recharge-gated; **both downed → game over on both, nobody respawns**; one click resets the room;
  alone + downed → game over. The reported bug reproduced on the old code first (at 25s the host
  bled out, the guest stayed downed forever, no game over, a keypress respawned the host).
- **Perks and guns**, 19/19: SKEWER, ULTRA armour, ARC, BLASTCAP (and that bursts do not chain),
  SALVAGE, LAST STAND x1/x2/none, dry hand-over, `1`–`7`, the wheel, crate refills incl. a dry gun
  and the rocket's half-fill, burn and burn-kill credit, ULTRA owed on 16 / not 15 / not horde 25.
- **Score**, 15/15 against a recording mock `AudioContext` (see `zombie/CLAUDE.md` → Audio).
- **Browser** (dev server, pointed at a dead socket so it never touched the live server): no script
  errors; screenshots of the floors, loadout HUD, perk icons, funnel hall + pipe, sluice + silo 1,
  the zombie lineup incl. the ULTRA, round shapes, the flame plume, the tripped generator, the
  `M` toggle and the perks tab with its NOT ON THIS MAP list. Tuned from what they showed: PUMP
  HOUSE rust read as blood (toned down), SPILLWAY and COLD STORAGE were loud, the flame was thin and
  lingered as dark boxes (denser, larger, burns out).
