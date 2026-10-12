---
name: hub-visual-review
description: Review any visual change to a My-Games hub game (or the hub page) against the hub's arcade design intent, so every card reads as one cohesive body of work. Use BEFORE and AFTER any change to lighting, darkness, colour, palette, world hue, fonts, HUD or cabinet panel styling, scanlines, glow, gradients, sprites, map art, floor textures, VFX, transitions, title or end cards, or any change of a game's visual direction. Also use when the user asks for an aesthetic pass, an "arcade look", or for games to look more consistent.
---

# Hub visual review

DRAFT v0.1 (2026-10-08). The rules come from `AESTHETIC_GUIDE.md`. This skill is the procedure
for applying them, and the map that says which parts of a 983-line guide matter for this change.
Improve it from the "Lessons" log at the bottom after every workshop round.

## Why this exists

1. **Context.** The guide is too long to load whole for every lighting tweak. Section 1 below
   says what to read for what.
2. **Cohesion.** Five cards on the board should look like five cabinets on one arcade floor: one
   system, one vocabulary, a different marquee each. A change that makes one game prettier and
   less like its neighbours is a regression for the hub.
3. **Development.** Most cards look "converted", not "designed". Each review should push its game
   one step further into the era, not only check it for violations.

## 0. Scope and the user's authority

- **The user's request wins.** When a request clashes with the guide, still do what was asked,
  but say so *before* building: quote the rule, state the clash in one line, and offer the
  options (follow the request and record a dated deviation, follow the guide, or change the
  guide). Never silently "correct" a request toward the guide. Never silently drop the guide
  either.
- The guide is a living record. Where the code has moved past it, the guide is stale, not the
  code. Mark it superseded with a date; don't delete the reasoning.
- Adjacent ideas go to `IDEAS_INBOX.md` as one line (`SCOPE_RULES.md` rule 9), not into the change.

## 1. What to load (and what not to)

Always read:
- `AESTHETIC_GUIDE.md` §0 (one paragraph), §1's table plus "The three cabinet types", §2.2 (the
  Signal Three plus the phosphor whites), §2.3 (the hard constraint), §4.12 (what NOT to do).
- The game's row in §5 ("what each game must keep") and its §6.x entry, **including every dated
  note under it**. §6's notes are where the real decisions live.
- The game's own `<game>/CLAUDE.md`: grep it for `aesthetic|cabinet|light|colour|color|palette|visual`.
- Memory: anything pending on visual direction (for example `zombie-art-direction-pending`).

Read only when the change touches it:

| Change touches | Read |
|---|---|
| Lighting, darkness, glow, gradients | §4.9 quantized light, §6.3 and its notes (Zombie is the reference case) |
| Player or team colours | §2.3, §2.4, and run `node scripts/check-identity-parity.js` |
| Terrain, floors, map art | §2.5 world hue, §6.3's 2026-09-19 notes (the cast-shadow/top-face height trick) |
| Fonts or text | §3 (and §3.3 stroke text for a Vector cabinet) |
| Scanlines, CRT, bloom, trails | §1 (vector vs raster), §4.1–4.6 |
| HUD, panels, score display | §3.4 conventions, §4.11a cabinet panel (required for every game) |
| Transitions, title, attract, end cards | §4.8 attract mode, §6.8's Robotron burst note (when a signal colour may be reused) |
| A new enemy or entity colour | §6.8's Lancer note: carry meaning in SHAPE, colour second |
| Changing a game's cabinet | §6.8 "CABINET REASSIGNED": a reassignment is a package, not a switch |

Do **not** read `PROJECT_MEMORY.md` → "Design & aesthetic patterns" as current. It still says
"nothing in it is implemented", and that is stale: cabinet skins landed 2026-09-04 → 09-06. Treat
the revision-history rows that mention a visual pass as the record.

## 2. Establish the game's identity (one line each)

Read these off the code, not the docs:
- **Cabinet:** `data-cabinet` on `<body>`, or none for the hub page.
- **World hue:** §2.5, or `--world-hue` for its `data-game`.
- **Anchor game:** from §6.x (Zombie → Berzerk, Space Tracer → Asteroids, Glass City → Robotron
  burst on a raster, RD Arena → Space Invaders, 4D Pong → Pong).
- **Must-keep invariants:** §5.
- **Open direction questions:** pending memories, or `MAP_VISUAL_AUDIT.md`-style proposals.

The board on 2026-10-08:

| Card | Cabinet | Scanlines | Panel |
|---|---|---|---|
| Zombie Arcade | raster | on | yes |
| Space Tracer | vector | off (correct) | not yet |
| Glass City Escape | raster | on | not yet |
| RD Arena | raster | on | not yet |
| 4D Pong | raster | on | not yet |
| Hub page `index.html` | none | — | n/a |

Re-check this table against the code each time, and fix it here when it moves.

## 3. The checklist

Mark each one **pass / fail / deliberate deviation (dated) / n/a**.

**System (every game):**
1. Ground is `#000`. A near-black like `#050505` only where the guide names it (the cabinet panel).
2. The Signal Three keep their meaning: amber = value/interact, cyan = system/safe/goal,
   magenta = danger/death. A decorative use passes only on §6.8's narrow licence, where its scale
   rules out the meaning.
3. No signal colour can be issued to a player (§2.3).
4. The world hue goes on environment and chrome only, never on entities.
5. Brightness carries information before hue does (phosphor whites).
6. Text: Press Start 2P for marquee and score, VT323 for the HUD. Uppercase. Scores zero-padded
   to 6 digits. `1UP` / `HI-SCORE`. Numbers tick, they don't tween.
7. Cabinet panel present and laid out per §4.11a. Nothing in it is duplicated on the play field.
8. None of the §4.12 list: no CRT curvature, decorative dithering, chromatic aberration, 30fps cap
   or input lag.
9. **Quantized light — a pillar, decided by the user 2026-10-09.** Wherever a game has light,
   darkness, glow, fog, pools or falloff, it steps in flat bands (3–7) and never ramps smoothly.
   This applies to cut-out darkness, additive pools, flashlights, sun shafts and vignettes alike.
   The light can still be raycast, coloured and dynamic; only the ramp is stepped. Bands should
   step in **both** directions a light spreads (along a beam and across it). Zombie Arcade is the
   reference: `ARC_LIGHT_BANDS` and `bandGradient()` in `zombie/zombie-arcade.js`. Copy that
   instead of re-deriving it. Where it doesn't apply: a VECTOR cabinet's glow is beam overdraw
   and phosphor persistence (§4.1–4.2), not a light ramp. If the user asks for "smooth" light,
   point to this pillar and ask; don't silently band it or silently smooth it.

**Cabinet-specific:**
- **Raster:** scanlines on; sprites snapped to the virtual pixel grid with `RETRO.snap` at the
  draw call only, never in the simulation; at most about 4 colours per sprite; flat fills; height
  faked with flat shadow and top-face fills; light quantized into bands (§4.9).
- **Vector:** no scanlines; stroked, unfilled geometry; beam overdraw and vertex bloom; phosphor
  persistence instead of hand-drawn trails; stroke text inside the world.
- **Gel:** one game only (shelved). Hard-edged multiply bands, no gradient.

**Cohesion across the board:**
- Would a player who learned this card read the next card's HUD cold?
- Is this card more or less like its neighbours after the change? If less, is that its marquee
  identity (its hue, its anchor game) or drift?
- Does a technique introduced here belong in `shared/retro.js` for the others (the guide's own
  "more than one game" rule)?

**Development (always offer at least one):**
Name the single change that would most increase this card's "real arcade cabinet" read, sourced
from §4 (attract mode, phosphor persistence, vertex bloom, quantized light, flat height fills, the
Robotron burst, the panel). One, not a list. The rest go to the inbox.

## 4. Verify by looking

- Use the dev server (launch config `my-games` on :8123, `?solo=1`), and look at frames.
  Proxies like ΔE or pixel counts support a judgement; they don't replace it (memory
  `zombie-map-feels-generated`).
- Small Browser-pane screenshots can't judge soft light or feathering. Say so, rather than
  claiming it looks right. Use a full-resolution canvas capture when the detail matters
  (memory `zombie-map-capture`).
- Check both a calm frame and a busy one. Readability under load is the arcade test.

## 5. Output

Keep it to one screen:

```
VISUAL REVIEW — <game> — <change>
Identity: <cabinet> · <world hue> · anchor <game>
Verdict: ON-SYSTEM | ON-SYSTEM WITH DEVIATIONS | OFF-SYSTEM
Clashes: <rule §, what the change does, one line each>  (or "none")
Options for each clash: request-as-is + dated deviation | follow guide | amend guide
Cohesion: <one line on how it now sits next to the other cards>
Next arcade step: <one change>
Docs to touch: <§6.x status note, game CLAUDE.md, this skill's board table>
```

Then the usual closing numbered questions.

## 6. After the change lands

- Add a dated status note under the game's §6.x entry. If the guide's rule itself moved, mark the
  old passage superseded with a date.
- Update the board table above if a cabinet, scanline state or panel changed.
- Append to the Lessons log below whenever the review got something wrong or missed something.

## Known open tensions (resolve with the user, don't decide alone)

- ~~**Zombie lighting (2026-10-08).** Smooth gradients reversed §4.9.~~ **Resolved 2026-10-09:**
  the user chose bands, and quantized light became checklist item 9. The raycast and the dusk sun
  were kept.
- **Zombie art direction.** The FAITH-style black/white/red proposal is still undecided
  (`zombie/MAP_VISUAL_AUDIT.md` §4.1). It would replace the ember hue and the textured floors.
- **Zombie's per-sector floor tints** already depart from §2.5 "one world hue for terrain"
  (recorded 2026-09-18).
- **The cabinet panel** is required for every card. Four of the five don't have one yet.
- **The hub page** has no `data-cabinet`. Is it a cabinet, or the arcade floor around them?

## Lessons log

Append one dated line per finding from workshopping. Promote a repeated lesson into the procedure
above.

- 2026-10-08 — v0.1 drafted. Not yet run on a real change.
- 2026-10-09 — The first clash it caught was a real one: smooth light requested on 10-08 against
  §4.9, then reversed by the user to bands on 10-09. Lesson: raise the clash when the request
  comes in, before building, not afterwards. That cost a build-and-revert.
- 2026-10-11 — Zombie: the user asked for softer light and it is checklist item 9's 'bands' pillar, so the clash was named in a proposal (`zombie/LIGHTING_PROPOSAL.md`) rather than built either way. Also: Browser-pane thumbnails and emulated viewports cannot judge in-world sprites or soft light; the panel layout was checkable at 1366x768, the world art only by code and headless state.
