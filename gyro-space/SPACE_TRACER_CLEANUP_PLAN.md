# Space Tracer — gameplay cleanup plan (2026-08-31)

Single file: `space-tracer.html`. No other file loads with it except `../shared/mp-core.js`
(read-only here) and the Firebase module in `<head>` (untouched).

## Fixes

### 1. No shooting after death
Three input paths can fire: `canvas mousedown/mouseup`, `canvas touchstart/touchend`.
All four gate on `ship.isAlive`. `mouseup`/`touchend` while dead cancel the charge
(clear `isChargingBeam`, stop charge audio) and return without firing.

Dying *while* charging must also cancel: handled by the new `onLocalDeath()`.

### 2. Reset dash on death
`isDashing`, `dashTimeRemaining`, `dashChargeDuration`, `spaceHeld` all cleared and
`ship.speed` restored to `ship.baseSpeed`. Dash inputs (SPACE keydown, mobile dash
button touchstart) also gate on `ship.isAlive`, and the release handlers no-op when
`spaceHeld` was already cleared out from under them by a death.

### 3. Three death sites collapse into `onLocalDeath()`
Border collision, asteroid collision, and remote-bullet hit each duplicated the same
four lines (`isAlive=false`, `deathTime`, `trail=[]`, `reportLifeEnded()`), which is
exactly why the dash/charge reset was missing from all three. One helper now owns the
whole death transition.

### 4. Live per-player high score
Today `bestLifeScore` only moves inside `reportLifeEnded()`, so a life that is beating
your previous best shows nothing in the corner until you die. And `roomScores[name]`
is *overwritten* by each incoming death relay, so a bad life visibly erases a good one.

- `updateBestScoreLive()` promotes `lifeScore` into `bestLifeScore` the moment it
  passes it, every frame.
- Scoreboard DOM render is throttled to 5Hz off a dirty flag checked in `animate()`,
  so a per-frame best doesn't mean a per-frame `innerHTML` rebuild.
- Own row is always present once the game starts (previously gated on `> 0`).
- Remote best rides the existing 10Hz `pos` payload as `best`, so other players' bests
  climb live instead of only on their death. The death `{t:"score"}` relay still fires
  and now carries `best` too.
- Both consumers take `Math.max` against what's already stored — a best never goes down.

## Gameplay adds — charged beam (long-press) only

### 5. Slight homing
Beam-type bullets steer toward the nearest ship that is not their owner, capped at
`BEAM_HOMING_TURN_RATE` rad/frame, only within `BEAM_HOMING_RANGE` and only for
targets inside a forward cone — so it noticeably curves but never turns around.
Speed is unchanged (direction-only steering).

Candidate targets from *this* client's view: our own ship (only for remote-fired
beams) plus every alive remote player except the owner. Collision stays
victim-authoritative, same as it already is, so each client homing its own copy of a
beam is consistent with how kills are already decided.

### 6. Bounce once
`b.bounced` flag, one reflection then normal removal on the next contact.

- **World boundary** — reflect the crossed axis (both on a corner), nudge back inside.
- **Safe zone** — reflect off the radial normal, but only when crossing *inward* from
  outside, so a beam fired from inside the safe zone still leaves normally.
- **Asteroids** — reflect off the impact normal. The asteroid is still destroyed and
  still scores (a charged beam smashing through and deflecting), rather than the beam
  being consumed as it is today. Gated to `isLocalShot` like the existing asteroid
  collision, because asteroid fields are deliberately not network-synced.

On bounce, `firedAt` moves to the bounce point and `maxDistance` is reduced by the
distance already flown, so the total travel budget (and therefore the fade-out) is
preserved rather than being reset or inverted by the direction change.

## Verify
`node scripts/check-global-collisions.js` from repo root.
