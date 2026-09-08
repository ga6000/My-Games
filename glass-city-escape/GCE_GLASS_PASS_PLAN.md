# Glass City Escape — the Broken Glass pass (2026-09-07)

Three fixes. Written before editing, per root `CLAUDE.md`.

---

## 1. `(WELL OPEN)` replaces the dialogue box

`openEscapeTunnel()` raises a modal `showMessage("THE WELL IS OPEN", …)` and hides it on a raw
`setTimeout(hideMessage, 4000)`. Two problems: a centred HTML box over a running game reads as a
web page rather than a cabinet, and it is a **modal for information the player needs for the rest
of the level**, not for four seconds.

Replaced by a persistent screen-space HUD element drawn on the canvas: **`(WELL OPEN)`** with an
**arrow pointing at the well**, bearing computed from the player each frame. Sits under the
minimap, pulses, and fades out when the player is within a couple of cells of the well (where it
would be telling them what they are standing on).

**It disappears before the next level loads for free, and that is by construction, not by
timing.** It is drawn only while `escapeTunnelOpen`, and `spawnCores()` sets that false inside the
synchronous rebuild in `triggerNextStage()` — so the flag is already down on the first frame of
the new level. No timer to get wrong.

Removing it also deletes the last raw `setTimeout` on the level path.

## 2. The Stalker — a third drone kind, from level 6

> *"triple follow time and 1.25 follow speed of standard"*

| | melee | lancer | **stalker** |
|---|---|---|---|
| appears | always | always | **stage ≥ 6** |
| forget time | 5 s | 5 s | **15 s** |
| chase speed | 1.0× | 1.0× | **1.25×** |
| shoots | no | yes | no |
| colour | red | `#2F6BFF` | **`#4CFF9E`** |

`HUNT_FORGET_MS` becomes a per-drone `forgetMs`, because the constant is now only the *default*.

**Colour choice, and the same caveat the Lancer carries.** `#4CFF9E` is a spring green — clearly
not the melee red, the Lancer blue, the magenta of an engaged drone, or `--sig-cyan`. The identity
palette contains greens, so as with the Lancer the read is **shape first**: the Stalker is a
forward-pointing **triangle** against everything else's square, with a trailing wake. A silhouette
nothing else has survives a colour collision; a colour alone does not.

**Ordering hazard, stated because it is easy to get wrong:** `assignDroneKind()` runs *after*
`applyStageDifficulty()` at both spawn sites, and the 1.25× multiplies the stage-scaled
`chaseSpeed`. Calling them in the other order would silently drop the multiplier.

## 3. Broken glass is a hole — collision, sight and pathing

### The bug

Dash onto a roof that is not there (the target building is shorter than the one you launched
from), fall, and `land(0)` puts you at `z = 0` **wherever you happen to be** — which can be inside
a building's ground-floor wall cell. At `z = 0` `checkWallCollision` blocks any `wall` tile, and a
6 px step never leaves the 40 px cell you are standing in, so **every direction is blocked
forever**. Stuck, permanently, with no way out but a reload.

The same trap catches a fall over the **arena boundary ring**: the ring exists only at `z = 0`, so
a dash across it at height falls into it.

### The fix, which is the user's

Ground-floor walls are glass too, and **a broken pane stops being a wall in every sense**:

| Consumer | Change |
|---|---|
| `Player.checkWallCollision` | broken → passable |
| `Robot.checkWallCollision` | broken → passable |
| `checkLOS` | broken → transparent |
| `castRay` (the drawn cone) | broken → transparent |
| `botWalkable` (pursuit field) | broken → walkable |
| `updateLasers` | bolts fly through broken panes |

One predicate, `solidWall(tile)`, so those six cannot drift apart — which is exactly what the
2026-09-06 pass had to fix when the drawn cone and `checkLOS` disagreed.

**Glass breaks on two events:**

- **dashed through** — at *any* floor now, including `z = 0`. A ground-level dash into a pane
  bursts into the building instead of stopping dead at it, which is the same verb the roof hop
  already had.
- **landed in** — `land()` breaks whatever pane it drops the player into. That is what makes the
  stuck bug impossible rather than merely unlikely.

**The boundary ring is exempt and always has been**, so it needs the other half of the fix:
`land()` **pushes the player out** of any solid tile it cannot break, to the nearest walkable
neighbour. Belt and braces — a fall that ends inside geometry must never be able to trap the
player, whatever route got them there.

### Consequences that have to be handled

- **The minimap caches wall geometry per floor.** Breaking a pane invalidates that floor's cache.
- **The pursuit field caches walkability.** It already rebuilds on a ≤12-frame cadence while
  anything is hunting, so a new hole is picked up within ~200 ms; the field is also invalidated
  outright on a break so hunters route through it immediately.
- **Drones can now walk out through the holes you make**, and see through them. That is the point
  — the user asked for the raycast to update — and it is a real balance change: smashing a wall to
  escape also opens a sightline into the room you are escaping to.

## 4. Files touched

`gc-core.js` (constants, `solidWall`), `gc-world.js` (kind assignment, `botWalkable`, break helper),
`gc-entities.js` (collision, LOS, raycast, land, dash, Stalker body), `gc-render.js`
(`(WELL OPEN)` indicator), `gc-audio.js` (nothing new — glass already has a sound).

## 5. Verification

Three checkers, the harness extended (a pane blocks then does not; LOS and the cone both open
through a break; the pursuit field routes through one; a fall into a wall breaks out rather than
sticking; a fall into the unbreakable boundary pushes out; stalkers appear only from stage 6 with
3× forget and 1.25× speed; the well indicator tracks the bearing and is gone on the next level),
then a real browser. **Console-driven tests must stub `performance.now()`.**
