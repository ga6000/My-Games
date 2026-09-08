# Zombie — v3: light, sound, cards, level identity

**STATUS: complete 2026-09-02.** All items landed and verified. Started 2026-09-01. Live plan — tick as it lands. Sessions compact; this file doesn't.

## Scope (from the user)

1. **Blackout is a guaranteed loss.** Bigger lit radius + a fade to black over an extra 33%.
2. **Whole map starts dim.** Find and start the **generator** to light it. After that, Blackout
   rounds are only **20% darker**, not near-total.
3. **Wall-buys: exactly three on the whole map** — one shotgun, one sniper, one SMG.
4. **Remove ADRENALINE.**
5. **Powerup cards, 3 slots.** Bought at stations around the map; expensive; **generator-gated**.
   Fire rate plus effects that are *not* Call of Duty perks.
6. **Every Part 5 idea tagged "Start here"** → 28, 37, 41.
7. **Explicitly requested:** 27, 29, 30, 31, 32 (*small opening mid-wall on every nook*),
   35 (*creative names, not AI-generic*).
8. **The whole first slice:** 27, 28, 35, 36, 37, 38, 39, 41, 43.

Union to build: **27, 28, 29, 30, 31, 32, 33, 35, 36, 37, 38, 39, 41, 43** + lighting rework +
3 wall-buys + cards + remove adrenaline.

**33 (generator) is not on the user's list but is required by item 2** — there is no "find the
generator" without one. Building it.

**46 (mute + gesture gate) is folded into 37**, not scope creep: browsers refuse audio without a
gesture, so #37 does not function without it, and a group in one room needs a kill switch.

**Deliberately NOT building** (not requested): 34 (map changes between rounds), 40 (weapon report),
42 (round cues), 44 (archetype voices), 45 (intensity drone). Flag 40 on delivery — a game where
barricades make noise but guns don't is odd, and it is a two-line add once 37/39 exist.

## Follow-up pass (2026-09-02, same day)

Requested after review, all landed:

- [x] **40 — per-weapon fire audio.** Plus kills, splits, screamer (44), pickups, doors, crates,
      traps, zaps, round start/clear (42) and game over. Own shots play locally and the broadcast
      copy carries the shooter id so nobody hears their own gun twice.
- [x] **Rifle restored** as a fourth wall-buy (cheapest, the natural first upgrade off the pistol).
- [x] **Cards stack to x3** with an escalating cost (`1 / 2.2 / 4.0`), stack level shown as a badge
      above each HUD chip. Distinct keys still capped at 3 slots; stacking one you hold does not
      need a free slot. Every effect scales with level.
- [x] **Economy rebalanced for high-round growth.** Income was scaling three ways at once (zombie
      count, brute share, and an added round multiplier) — round 20 paid 48k against 87k to max
      everything. Dropped the multiplier, cut brute payout 250 -> 150, raised station bases to
      9,000–13,500. Now: ~41k banked by round 15, ~182k by round 25, vs 64,800 to max one card
      and ~227,000 for all three.
- [x] **45 — adaptive intensity drone.** Tracks zombies within 1000px; silent under 4, full at 28.
- [x] **Spawn placement rewritten.** Restricted to unexplored zones (nearest first) or fully
      off-map, and never inside anyone's view. Fixes zombies appearing in ground the player had
      just walked through. Verified: 0 of 300 spawns on screen or in an explored zone.
- [x] **Targeted nav refresh.** Opening a door was a 16.6ms full grid rebuild — a dropped frame at
      the moment of purchase. Now 1.3ms, and bit-identical to a full rebuild.

- [x] **Zone cooldown instead of a permanent visited flag.** A zone is spawn-eligible again 45s
      after the last player was in or beside it. Restores late-game pace (25.6s -> 12.8s to
      contact) while keeping the guarantee: 0 of 400 spawns on screen or in an occupied zone, and
      nothing left behind on a path just walked. Marking hot zones from the full view box does NOT
      work — it is wider than a zone, so from mid-map it marks all nine.

## The #38 decision — event queue, not entity IDs

The user asked whether to give each zombie a random 3-digit id, broadcast it on death, and recycle
it. It works, but:

- One-shot sounds don't need identity — only *what*, *where*. `[code, x, y, arg]` is enough.
- Random ids over a 1000-value space with ~260 live entities collide constantly; a counter would
  beat random. Allocation is pure overhead here.
- **Recycling is a correctness hazard**: a late or duplicated "427 died" applies to whichever
  zombie now holds 427. Harmless for a blip, dangerous if anything authoritative ever keys off it.

So: **host-side event queue**, drained into each `world` snapshot as `ev`. Per-entity identity is
used only for *sustained* sounds (barricade chewing), which already have stable array indices that
never shift. Cap the queue per snapshot so a lag spike can't dump 80 sounds at once.

## Lighting model

One number, `ambient` = how black the map is outside your light.

| State | ambient |
|---|---|
| Generator off (default) | 0.55 |
| Generator on | 0.0 (fully lit) |
| Blackout round | **+0.20 on top of current** |

So Blackout after the generator is a mild 0.20 dim, not the old 0.94 wipe. Light radius rises
210 → **340**, fully clear to that, then a gradient fade to black over an extra 33% (to ~452).
Radial gradient rather than the old hard-edged even-odd punch.

## Cards (3 slots)

Bought at **card stations** — separate from weapon wall-buys, expensive, inert until the generator
runs. Fire rate is user-requested; the rest deliberately avoid Perk-a-Cola equivalents (no health,
no reload speed, no revive speed, no sprint, no extra weapon slot).

| Card | Effect |
|---|---|
| `OVERDRIVE` | +35% fire rate *(requested)* |
| `SCAVENGER` | +60% scrap from kills |
| `RICOCHET` | bullets bounce once off walls |
| `BEACON` | your ping reveals every zombie in a wide radius for 5s |
| `SPITE` | going down detonates a shockwave that damages nearby zombies |
| `CONDUCTOR` | traps last 2x and cost 40% less |

## Level

- **27 + 35** — seeded zone templates with real layout differences and names with character.
- **28** — deliberate cover flanking every boundary door and window.
- **29** — window count/width/offset varies per boundary.
- **30** — a share of barrels seeded at chokepoints instead of uniform scatter.
- **31** — one small holdable outpost per outer zone.
- **32** — **every** nook gets a small mid-wall opening, so it can never be a dead end.
- **33** — generator in its own zone template.
- **36** — sniper: give it long sightline zones AND cut range 1900 → 1200, closer to what a
  960x540 view can actually show.

## Files

- **New** `zombie-audio.js` — context, tone helper, positional mix, mute, event playback.
- `zombie-level.js` — templates, names, boundary cover, windows, nooks, outposts, generator,
  3 wall-buys, card stations.
- `zombie-entities.js` — cards, drop ADRENALINE, weapon table.
- `zombie-game.js` — generator, card buys/effects, ambient, event queue.
- `zombie-net.js` — sync generator/cards/stations, `ev` queue.
- `zombie-render.js` — lighting rework, card HUD, station/generator draw.
- `Zombie.html` — script tag, HUD.

## Verify

- [x] `check-global-collisions.js` passes with 8 local scripts. *(Now **9** — `zombie-endgame.js` was added by `ENDGAME_PLAN.md` later the same day.)*
- [x] Blackout is survivable: measure lit area vs before.
- [x] Generator off/on/blackout ambient values.
- [x] Exactly 3 weapon wall-buys; card stations refuse before generator.
- [x] Nooks all have a second opening; no dead ends.
- [x] Zombies still reach every zone — **160/160 across 20 seeded layouts**, median 21.6s, worst 44.4s.
- [x] Audio: no autoplay before gesture, mute works, events ride the snapshot (capped at 10).
- [x] Perf at 260 zombies.
