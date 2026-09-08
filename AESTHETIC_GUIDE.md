# Aesthetic & Styling Guide — The Vector & Blocky Sprite Era

Target period: **late 1970s – early 1980s arcade hardware.** Written 2026-09-04 against the
18-game roster and `shared/identity.js` as they exist today.

This is a *design* document. Nothing in it has been implemented. It states what to build, what it
costs, what it breaks, and — importantly — **which existing things must survive contact with it**.

`PROJECT_MEMORY.md` → "Design & aesthetic patterns" currently reads: *"Not yet standardized across
games — each game currently has its own visual identity… No shared palette or typography system
exists yet. Worth deciding whether the hub wants visual consistency."* **This document is that
decision.** Update that section when any part of this lands.

---

## 0. The one-paragraph version

Every surface in the repo goes to **pure black**. Games split into **three cabinet types** —
Vector, Raster, and Gel — assigned by what each game already renders, not by taste. Three
**signal colours** (amber / cyan / magenta) mean the same thing in all 18 games and are
**forbidden to players**. Player identity moves to a re-solved **13-colour neon palette** with 56%
better perceptual separation than today's. Each game additionally owns **one world hue**, so the
hub reads as a row of different cabinets rather than 18 copies of one game. The retro identity is
carried less by filters than by **behaviour**: phosphor persistence, vertex bloom, quantized
light, flicker budgets, and attract mode.

---

## 1. The era is two hardware lineages, not one look

This is the most important structural decision in the guide, and it comes straight from the brief.
Arcades in 1979–1982 ran two incompatible display technologies at once, and they look nothing
alike. Collapsing them into one "retro" style is how this ends up as a generic CRT-filter pass.

| | **Vector (XY monitor)** | **Early raster** |
|---|---|---|
| How it drew | Electron beam steered directly along line segments | Scanned a coarse pixel grid, line by line |
| Signature | Glowing strokes, infinite black, **no fill** | Chunky filled blocks, flat colour, hard edges |
| Colour | Mostly monochrome; true colour was rare and expensive (Tempest, Star Wars) | 2–8 colours, often faked with **coloured plastic gels** over a B/W tube |
| Scanlines | **None.** There is no raster scan to line up. | Yes — this is where scanlines come from |
| Anchors | Asteroids, Battlezone, Tempest, Star Wars | Space Invaders, Pac-Man, Galaxian, Donkey Kong |

**The rule that follows:** *scanlines and dot-mask overlays go on Raster cabinets only.* Putting a
scanline filter over a vector game is the single most common way this aesthetic gets done wrong —
it is a raster artifact simulating a raster the hardware never performed.

### The three cabinet types

Assignment is mechanical: **what does the game already draw?**

- **VECTOR** — anything that already draws strokes, wireframes, trails, or 3D. Pure black,
  stroked geometry, no fill, phosphor bloom, no scanlines.
- **RASTER** — anything that already draws filled shapes on a grid. Pure black, flat filled
  blocks snapped to a virtual pixel grid, ≤4 colours on screen at once, scanlines permitted.
- **GEL** — the deliberate exception for a game whose identity depends on a light ground.
  A monochrome field with a hard-edged band of colour laid over it, exactly as Taito shipped
  Space Invaders. **Exactly one game uses this** (Glucose Dash), and that is the point — a
  category with one member is a documented exception, not a loophole.

---

## 2. Colour

### 2.1 The ground

```css
--ground: #000000;   /* not #0D1117, not #050505, not #08090d */
```

Pure black, everywhere, no exceptions outside the Gel cabinet. This is not stylistic. A vector
monitor's black is the absence of beam — there is no backlight, so contrast is genuinely infinite.
Every near-black currently in the repo (`#0D1117`, `#050505`, `#050a10`, `#08090d`, `#111827`)
is a modern-UI habit that reads as "dark theme," not as "arcade."

**This unlocks the palette work below.** Today's identity palette is constrained to keep ≥1.9:1
contrast against *both* `#0D1117` **and near-white**, because Glucose Dash renders on a white
mall. That dual constraint is what forces colours like `hsl(23, 75%, 46%)` — a muddy brown-orange
that is nobody's idea of neon. Dropping the near-white half of the constraint is worth roughly
**double the luminance budget.**

### 2.2 The Signal Three — uniform across all 18 games

These are the "uniform accent set." They are **semantic, not decorative**: each one means the same
thing in every game, so a player who learns Zombie can read RD Arena's HUD cold.

| Token | Hex | Contrast on `#000` | Means, in every game | Hardware justification |
|---|---|---|---|---|
| `--sig-amber` | `#FFB000` | 11.46:1 | **Attention / value / interact** — pickups, currency, buy stations, prompts | P3 phosphor, the amber terminal tube |
| `--sig-cyan` | `#00E5FF` | 13.65:1 | **System / safe / navigable** — UI chrome, room codes, goals, waypoints, sanctuaries | The classic XY-monitor blue-green |
| `--sig-magenta` | `#FF2E88` | 6.00:1 | **Danger / damage / death** — hits, hazards, enemy fire, game over | The hottest colour the era's gels produced |

Plus three **phosphor whites**, which do the work colour usually does. On period hardware, most
information was conveyed by *brightness*, not hue — that is the discipline to adopt.

| Token | Hex | Use |
|---|---|---|
| `--phos-hot` | `#E8FFF4` | Beam core, active text, the thing you are meant to look at |
| `--phos-mid` | `#8FA89C` | Structure, inactive UI, world geometry |
| `--phos-dim` | `#2E3A34` | Grid lines, decayed trails, disabled state |

The faint green cast is deliberate — it is P1 phosphor, and it stops the whites from reading as
sterile modern UI. It costs nothing and is the difference between "black theme" and "CRT."

### 2.3 The hard constraint nobody would think of

> **A signal colour must never be assignable to a player.**

If a player can be cyan, then every cyan waypoint, room code, and safe zone in the game reads as
that player. This is the failure mode that turns a semantic palette back into decoration, and it
is invisible until the one session where it ruins a match.

So the identity palette must be **solved with the Signal Three excluded** — not just by hue, but
by measured perceptual distance. Verified result for the palette below: every player colour sits
**≥28.3 ΔE** from every signal colour.

### 2.4 The identity palette — re-solved

Owned by `shared/identity.js` (and mirrored in `server.js` in the separate `gyro-space-server`
repo; `scripts/check-identity-parity.js` proves they agree). Solved by the same method the current
palette used — hill-climb maximizing minimum pairwise CIE76 ΔE in Lab — with these constraints:

- saturation 85–100%, lightness 45–70% (**neon**, not muted)
- contrast ≥4.5:1 against `#000` **only** — the near-white constraint is dropped
- hue ≥18° clear of each signal hue, **and** ΔE ≥26 from each signal colour
- **≥12° minimum pairwise hue separation between entries**, which encodes the repo's own
  "two indistinguishable yellows" lesson (`PROJECT_MEMORY.md` → Technical debt) as a hard rule
  rather than an outcome to hope for

```javascript
var COLOR_PALETTE = [
    "hsl(11, 100%, 50%)", "hsl(24, 97%, 64%)",
    "hsl(62, 85%, 70%)",  "hsl(75, 100%, 50%)",
    "hsl(133, 100%, 51%)", "hsl(153, 87%, 50%)",
    "hsl(168, 85%, 68%)", "hsl(206, 85%, 70%)",
    "hsl(227, 87%, 68%)", "hsl(259, 93%, 65%)",
    "hsl(297, 100%, 52%)", "hsl(316, 93%, 45%)",
    "hsl(353, 99%, 65%)"
];
```

| Measure | Current 16 | Proposed 13 |
|---|---|---|
| Min pairwise ΔE | 25.9 | **40.3** (+56%) |
| Min pairwise hue separation | 5° (the known defect) | **12.6°** |
| Contrast on `#000` | 2.14 – 10.13:1 | **4.65 – 17.80:1** |
| Mean relative luminance | 0.266 | **0.472** |
| Min ΔE to any signal colour | *unconstrained* — **measured 2026-09-04 at 17.1** | **28.3** |

> **Measured 2026-09-04 — §2.3 is violated today, and by all three signals.**
> `shared/selftest.html` computes the CIE76 ΔE from each signal colour to its nearest
> entry in the *current* 16-colour palette:
>
> | Signal | Nearest player colour | ΔE |
> |---|---|---|
> | `--sig-amber` `#FFB000` | `hsl(45, 75%, 49%)` | **17.1** |
> | `--sig-cyan` `#00E5FF` | `hsl(180, 75%, 44%)` | **18.4** |
> | `--sig-magenta` `#FF2E88` | `hsl(338, 75%, 46%)` | **18.3** |
>
> So this is not a hypothetical improvement — a player *can* currently be issued a colour
> that reads as "danger" or as "safe/navigable", which is exactly the failure §2.3 describes
> as invisible until the one session where it ruins a match. The magenta case is the worst in
> practice: `hsl(338, …)` sits **1°** from signal magenta in hue, separated only by lightness.
>
> The self-test reports this as KNOWN rather than failing, because the fix is the migration
> below and a permanently red suite trains people to ignore it. Re-run the page after the
> re-solve lands; the check flips to PASS on its own once the worst case clears ΔE 26.

Thirteen entries comfortably exceeds the stated 3–10 player ceiling, and dropping three entries is
*why* separation improves — fewer colours in the same space are further apart.

**The migration cost, stated plainly.** `COLOR_PALETTE.length` goes 16 → 13, so `hash % length`
changes and **every player's colour reshuffles once.** `identity.js` deliberately never touched the
djb2 hash because "changing it would reshuffle every player's colour for no reason." Here there is
a reason, but it is a one-time visible break, and it must land in **both repos in the same
sitting**:

1. Edit `shared/identity.js`
2. Edit `COLOR_PALETTE` in the separate `gyro-space-server` repo's `server.js` — **done means
   pushed there**, per `PROJECT_MEMORY.md` → Active priorities
3. `node scripts/check-identity-parity.js` — must pass over its 3,000+ names
4. Redeploy Render

Until step 2 ships, clients on `file://` and the server disagree, which is exactly the class of
bug the parity checker exists to catch.

### 2.5 Per-game world hue

The Signal Three keep meaning uniform. A single **world hue** per game keeps the cabinets distinct
— this is Donkey Kong changing palette per screen, and it is what stops 18 black games from
looking like one black game.

One hue, used **only** for that game's terrain/environment/chrome, never for entities:

| Game | World hue | Game | World hue |
|---|---|---|---|
| Gyro Space | `#7DF9FF` ice | Javelin Battle | `#33FF33` P1 green |
| Zombie | `#FF4A1C` ember | 4D Pong | `#FFFFFF` pure white |
| RD Arena | `#8B0A2E` viscera | Fruit Dropper | `#FFD400` sun |
| Glucose Dash | `#FF5FA2` gel pink | Glass City Escape | `#00B4FF` glass |
| Reality Rewrite | *shifts* — see §6.12 | Desert Robot Blaster | `#FF8A00` dune |
| Boids | `#C8FF00` acid | PS1 Racer | `#B14AFF` dusk |
| Infected Labyrinth | `#00FFB2` sickly | Voice Runner | `#39FF14` scope |
| Wasteland Train Sim | `#C46A2F` rust | Hex Grid | `#FF0080` tempest |
| Kula World | `#FFE600` chrome | Particle Simulation | `#00E5FF` = cyan* |

\* Particle Simulation is the one game whose world hue is a signal colour, because it *is* the
system — a simulation sandbox with no adversary. Note it as deliberate so it does not read as an
oversight.

---

## 3. Type

### 3.1 The stack

```css
--font-display: 'Press Start 2P', 'Courier New', monospace;  /* marquee, titles, score */
--font-ui:      'VT323', 'Courier New', monospace;           /* HUD, body, room codes */
```

- **Press Start 2P** — the definitive arcade display face. Strictly it is NES-era (1985+), a few
  years late, but it is the letterform the audience *reads as arcade*, and the repo already uses
  it in one place. Use it sparingly: marquee, titles, score. It is unreadable in paragraphs.
- **VT323** — a DEC VT-series terminal face, genuinely of the period, with a very large x-height.
  That last part matters more than authenticity here: **most games in this repo are marked "Stable
  on mobile: No,"** and a tall, open face is the one that survives a phone HUD. Use for everything
  Press Start 2P is too heavy for.

### 3.2 The `file://` problem — this is a real constraint, not a footnote

**Webfonts loaded from Google Fonts do not exist on a double-clicked page with no network.** The
repo's first hard constraint is `file://` compatibility, so a `<link>` to `fonts.googleapis.com`
silently falls back to Courier New in exactly the scenario the constraint protects.

The fix: **embed both faces as base64 `data:` URIs inside `shared/retro.css`.** A subset covering
`A–Z 0–9` and common punctuation is roughly 10–14 KB per face in woff2; both together land near
40 KB. `data:` URIs sidestep `file://` relative-path resolution entirely, which is the other way
this breaks.

```css
@font-face {
  font-family: 'Press Start 2P';
  src: url(data:font/woff2;base64,...) format('woff2');
  font-display: block;   /* block, not swap — a flash of Courier is worse than a beat of nothing */
}
```

> **Done 2026-09-04.** `shared/retro.css` declares both stacks and carries
> `RETRO-FONTS:BEGIN`/`END` markers; `scripts/embed-fonts.js` reads `shared/fonts/*.woff2` and
> writes the `@font-face` rules between them. **Both faces are now embedded** — the Google Fonts
> *latin* subsets (U+0000–00FF plus common punctuation), Press Start 2P v16 at 12.2 KB and
> VT323 v18 at 17.5 KB raw, **39.6 KB of base64 total**, against the ~40 KB budgeted above.
> Licences in `shared/fonts/OFL.txt` (both SIL OFL 1.1, which permits embedding).
> Verified loading via `document.fonts.check()`, not just by the stack naming them.
>
> Every stack still declares a real fallback, which now matters for a second reason: a glyph
> outside the latin subset — a name typed in Cyrillic, say — degrades to Courier New rather than
> tofu.
>
> **One thing the real faces changed that the fallback hid:** Press Start 2P is far wider and
> heavier than Arial, and on the hub it turned the `MULTIPLAYER SOON` stamp from "crosses the
> title" into "obliterates it". The stamp moved off centre to sit over the tile icon instead
> (§6.0). Expect the same wherever a stamp, badge or HUD label was positioned against a
> proportional face.

Every stack still declares a real fallback, because a subset font will not carry glyphs a player
types into a name field.

### 3.3 Stroke text for the Vector cabinet

The highest-fidelity move, and the one almost nobody makes: **vector games had no fonts.** Their
letterforms were line segments drawn by the same beam as everything else. Asteroids' alphabet is
famously all straight strokes, no curves.

For in-canvas text on Vector cabinets, render a **Hershey stroke font** — the public-domain
plotter typeface from 1967, which is literally period hardware's type. It draws as `moveTo/lineTo`
paths, which means it inherits phosphor persistence, beam bloom, and vertex bloom for free, and
scales without ever looking like a bitmap laid over a wireframe. HTML/DOM text stays VT323; text
*inside the world* is stroked.

### 3.4 Conventions

- Scores are **zero-padded to 6 digits** — `001250`, never `1250`.
- The header is `1UP` / `HI-SCORE`, not "Score" / "Best".
- **Three-letter initials** for `leaderboard.html`, entered arcade-style. This is free and it
  interacts correctly with identity: `IDENTITY.colorFromName()` hashes a 3-char string as happily
  as a long one. See §7 for why this is worth doing.
- Uppercase everywhere, `letter-spacing` 1–3px. Both faces were designed for it.
- Numbers never animate smoothly. They tick.

---

## 4. Technique library — the Blasphemous section

Blasphemous does not work because it is pixel art. It works because it picked which of the era's
constraints to keep and which to break, and then over-committed to the ones it kept. It spends a
modern budget on hand animation and lighting while holding a rigidly limited palette and a
deliberate animation cadence.

The lesson for this repo: **keep the constraints that read as "era," break the ones that only read
as "bad."** Low resolution reads as era. Input lag reads as bad. Four colours reads as era. 30fps
reads as bad.

Ranked by identity-per-line-of-code:

### 4.1 Phosphor persistence ★ highest value
Vector monitors had genuine phosphor decay — bright objects smeared behind themselves. Instead of
clearing the canvas, paint a translucent black over it:

```javascript
ctx.fillStyle = 'rgba(0,0,0,0.25)';   // Vector: 0.18–0.30. Raster: 0.55+, or clear outright.
ctx.fillRect(0, 0, w, h);
```

This is **cheaper than clearing and hand-drawing trails**, which is what Gyro Space and Boids
currently do. It is one line, it is free, and it does more for the aesthetic than any filter.

### 4.2 Beam overdraw
The beam saturated the phosphor where it lingered, so lines glowed. Two passes on the same path —
a wide low-alpha stroke, then a narrow hot one:

```javascript
ctx.lineWidth = 6; ctx.globalAlpha = 0.18; ctx.strokeStyle = hue; ctx.stroke();
ctx.lineWidth = 1.5; ctx.globalAlpha = 1;  ctx.strokeStyle = '#E8FFF4'; ctx.stroke();
```

Cheaper than `shadowBlur`, which Boids currently uses at 15 and which is a known canvas
performance trap when applied per-entity.

### 4.3 Vertex bloom ★ the detail nobody implements
On real XY hardware the beam **decelerated at every path vertex**, dwelling fractionally longer and
burning the phosphor brighter. Corners on an Asteroids ship are visibly hotter than its edges.

Drawing a ~1.5px `--phos-hot` dot at each vertex after stroking is about five lines, and it is the
single change that makes a wireframe stop looking like CAD output and start looking like a
monitor. This is the Blasphemous-tier move: an artifact of the hardware, reproduced deliberately,
that nobody consciously notices and everybody feels.

### 4.4 Render-space grid quantization
For Raster cabinets, snap drawing to a virtual pixel grid (4px or 8px). Sub-pixel motion destroys
the illusion instantly.

**Quantize rendering only, never physics.** The repo already has the right idiom for this —
Glucose Dash keeps physics in flat track space and applies its curve exclusively inside `SX()`.
Same discipline: one `RETRO.snap(v)` at the draw call, and the simulation never sees it. Quantizing
physics would introduce collision bugs that look like gameplay bugs.

### 4.5 Coloured gel overlay
Space Invaders was a black-and-white game. Its green ground and the coloured band across the top
were **strips of transparent plastic taped to the tube.** Reproduce with one positioned element:

```css
.gel { position:absolute; inset:auto 0 0 0; height:34%;
       background:var(--game-hue); mix-blend-mode:multiply; opacity:.55;
       pointer-events:none; }
```

Hard edges, no gradient — it was a physical sheet with a scissor cut. Free, historically exact, and
the mechanism that lets Glucose Dash keep its identity (§6.5).

### 4.6 Scanlines — Raster cabinets only
```css
repeating-linear-gradient(0deg, rgba(0,0,0,.34) 0 1px, transparent 1px 3px)
```
At low opacity. **Never on a Vector cabinet** (§1). This is the rule that keeps the guide from
collapsing into a uniform CRT filter.

### 4.7 Flicker as a budget, not a bug
Era hardware flickered when too many sprites shared a scanline — the machine physically could not
draw them all. Do not *simulate* the glitch. **Adopt the vocabulary**: past a per-frame entity cap,
render the overflow on alternating frames.

This is authentic *and* it is a genuine performance win, which makes it the rare aesthetic choice
that pays for itself. Zombie's late-round hordes and RD Arena's 40-enemy cap are both natural
homes.

### 4.8 Attract mode ★ the most era-defining behaviour in the document
Every cabinet, left alone, played itself. Nothing in modern web games does this, and it costs
almost nothing here because every game already owns a render loop.

- **Hub**: idle 20s → cycle marquees, demo footage, high scores.
- **Each game**: idle on the title screen → run the sim with no input, `INSERT COIN` pulsing in
  `--sig-amber`.

This is behavioural identity rather than visual, which is why it lands harder than any filter.

### 4.9 Quantized light
The era had no smooth gradients. But several games here use gradient lighting as a **mechanic**,
not decoration (Zombie's darkness, Glucose Dash's floors). Do not remove them —
**quantize them into 3–4 discrete bands.** The mechanic survives intact; the rendering becomes
period-correct. See §6.3.

### 4.10 Audio
Square and triangle waves, hard envelopes, no reverb. `zombie/zombie-audio.js` is already
procedural Web Audio and is the natural home for a shared waveform vocabulary. Descending
four-note death jingle; rising three-note pickup. Both are two lines of `OscillatorNode`.

### 4.11 The cabinet frame
The hub is not a webpage listing games — it is **an arcade floor**. Tiles become marquees. A thin
bezel with a 2px `--sig-cyan` inner rule and a black surround sells "cabinet" more cheaply than any
texture.

### 4.12 What NOT to do
- **No barrel/CRT-curvature shader.** It costs a full-screen pass, it hurts on the phones this
  repo is already weak on, and it reads as 2016 indie, not 1980 arcade.
- **No dithering as decoration.** Dithering was a solution to a colour-count problem. Applied
  without that problem it is just noise.
- **No chromatic aberration.** That is a lens artifact. These monitors had no lens.
- **No forced 30fps or fake input lag.** These are the "reads as bad" constraints. Break them.

---

## 5. What each game must keep

The brief asks specifically which per-game elements should survive. Answering this *before* the
per-game section, because it is the part most likely to be violated by an enthusiastic pass.

| Game | Must survive untouched | Why |
|---|---|---|
| **RD Arena** | The **Gray-Scott reaction-diffusion field** — `dA/dB/feed/k`, the 400×400 grid, the `>0.3` threshold, the flow field, the mote system | It is the game. It is also, as §6.4 shows, *already* era-native. |

> **Note 2026-09-07.** Still true, and worth restating precisely because something that looks
> like a violation landed: `rd-arena/rd-netfield.js` draws the flesh from a 133² 2-bit
> downsample instead of from `gridB`. **The simulation is untouched** — `dA/dB/feed/k`, the
> 400×400 grid, the `>0.3` threshold, the flow field and the motes all still run and are still
> what collision reads. Only the *pixels* come from the coarse field. This is the same
> render/sim separation §6.4 relied on when discs became cells.
| **Zombie** | `ambientDarkness()` as the single source of truth, and the light **radius** values | The lighting is a balance-tested mechanic; v2's blackout at 0.94 playtested as a guaranteed loss. Quantize the ramp, never the numbers. |
| **Glucose Dash** | Colour reserved exclusively for storefronts; `pathWalkable(f)` as the single source of floor geometry | Both are documented hard-won invariants. The second caused invisible holes in every upper storefront when violated. |
| **Gyro Space** | Server-authoritative `MP.selfColor` | Retro-fitted 2026-08-28 to fix session-ID colouring. Never regress it. |
| **Reality Rewrite** | `IDENTITY.colorFromName()` as the only name→colour path | It previously had its own scheme that agreed with the server **0 times out of 10**. |
| **All** | `trackTimeout`/`trackInterval`, one `AbortController` | Hard constraint. A shared `RETRO` layer must not open a second teardown path. |
| **All** | `file://` playability | Hard constraint. This is what forces §3.2's data-URI fonts. |

---

## 6. Per-game treatment

Effort is rough: **S** = under an hour, **M** = a session, **L** = its own session with a plan file.

> **Read this section against the code before trusting it (note added 2026-09-05).** Every game
> put through it so far has found at least one instruction that does not hold: §6.1 was wrong in
> two of four (Space Tracer, 2026-09-04), §6.8 in two (Glass City, 2026-09-04), §6.12 in its
> central premise and §6.4 in its performance claim (both 2026-09-05). §6.4's *render* advice was
> right, and is the only entry so far that has been. This is not a criticism of the section —
> it was written against the games as imagined — but its effort estimates in particular assume
> code that in several cases no longer exists.
>
> **Twelve of the nineteen entries below also point at paths that have moved.** Everything except
> §6.0, §6.1, §6.3, §6.4, §6.8 and §6.12 is now under `under-development/`, and §6.5's game moved
> there on 2026-09-05 as well. The treatments stay listed on purpose — the hue and cabinet are
> decided, which is what makes promoting one cheap — but the paths are stale.

### 6.0 Hub — `index.html` · **the largest single change in the repo**
Currently a light "paper" surface (`#f5f3f0` ground, `#2a2a2a` ink, Arial) — a deliberate,
coherent design that is the exact opposite of this guide.

**Change the skin, not the layout.** The three-band no-scroll paging model exists because a
`width:100%; height:100vh` sidebar once made joining a room on a phone a dead end. That logic is
load-bearing and stays.

`#f5f3f0` → `#000`; `#2a2a2a` → `--phos-mid`; borders → 2px `--sig-cyan`; tiles → marquees with
Press Start 2P titles and VT323 descriptions; `#roomCode` → `--sig-cyan`, already monospace.
`COMING SOON` / `MULTIPLAYER SOON` stamps are already an arcade idiom — keep them, restyle to
`--sig-amber`. Add attract mode (§4.8). **Effort: M.**

### 6.1 Gyro Space — `gyro-space/space-tracer.html` · **VECTOR** · anchor: *Asteroids* (1979)
Already black with neon and hand-drawn trails. The closest game in the repo to the target.
Ships → unfilled stroked triangles. Replace manual trail drawing with §4.1 persistence — this is a
net *deletion* of code. Vertex bloom on hulls.

*Gameplay:* if the field does not already wrap at the edges, **add wrap-around**. It is Asteroids'
defining mechanic, it is a handful of lines, and it improves a combat game by removing corner
camping. Do not touch audio — the mobile freezing bug is priority #1 and unrelated. **Effort: S.**

### 6.2 Boids — `boids/boids_1.html` · **VECTOR** · anchor: *Asteroids*
`#050a10` → `#000`. Boids → 3px stroked triangles. Replace `shadowBlur = 15` with §4.2 beam
overdraw — cheaper and better. Persistence at 0.18 turns a flock into light trails, which is what
the game already wants to be. The poster child for this guide. **Effort: S.**

### 6.3 Zombie — `zombie/` · **RASTER** · anchor: *Berzerk* (1980)
The interesting case. `ambientDarkness()` produces a smooth radial gradient; the era had none.

**Quantize the ramp into four bands** — lit / near / far / ambient — computed from the *same*
values. `zombie-render.js` already paints the pocket, falloff, and flat ambient in one radial fill;
this becomes four `arc` fills at four alphas from the identical inputs. The mechanic, the balance,
and the 340px `LIGHT_RADIUS` are untouched; only the ramp is discretized. Hard-edged light is
*more* threatening than soft, so this likely improves the game.

Zombies → 8px blocky sprites, ≤3 colours. Muzzle flash → one white frame. Blackout round becomes a
**colour-drop to monochrome**, which is scarier than more darkness and avoids re-litigating a
balance decision that already failed once at 0.94.

*Gameplay:* apply the flicker budget (§4.7) to late-round hordes — authentic and a real
optimization. **Effort: M**, across `zombie-render.js` only. Ten scripts share one global scope;
run `check-global-collisions.js` after.

### 6.4 RD Arena — `rd-arena/RDArena.html` · **RASTER** · anchor: *Space Invaders* (1978)
**The best discovery in this review.** The flesh field is already thresholded at `gridB > 0.3`,
already filled in a single flat colour (`#4a0404`), and already lives on a 400×400 grid. It is
drawn as overlapping circles of radius `cellSize * 0.78`:

```javascript
const blobR = cellSize * 0.78;
ctx.fillStyle = '#4a0404';
// ... ctx.arc(bx, by, blobR, 0, Math.PI * 2);
```

Change those `arc` calls to `fillRect(x * cellSize, y * cellSize, cellSize, cellSize)` and the
fleshscape becomes a chunky monochrome pixel grid — **exact period rendering, zero change to the
simulation.** ~~It should also be *faster*: rect fills beat 160k arc paths.~~

> **Done 2026-09-05, and the render advice was exactly right — this is the one §6 entry that has
> held up in full.** The performance half was not. **Measured on the real canvas over the same
> visible cell set: 0.177 ms/frame for the arcs against 0.165 ms for two `fillRect` passes —
> 1.07×, a wash.** The `160k` figure assumes the whole 400×400 grid is drawn and it never is:
> the draw is clipped to the camera viewport, so the real count is **617 solid cells**. Do the
> change for the look, which is the reason that matters; do not budget a frame-time win for it.

The diffusion stays exactly as it is. Recolour to `#8B0A2E`, and add a second band (cells above
~0.6 in a hotter tone) for the two-tone sprite look. The sanctuaries' `--sig-cyan` and the
sprinkler motes' `--sig-amber` fall out of §2.2 for free.

*Gameplay — the strongest suggestion in this document:* Space Invaders' most famous mechanic was
an **accident**. The CPU could not drive 55 sprites at speed, so as you killed them the survivors
accelerated. The bug became the design. Adopt it deliberately: **as the flesh field shrinks, raise
the RD steps per frame**, so a cleared arena regrows faster. It is a free difficulty curve, it
falls directly out of the hardware metaphor, and it is roughly one line. **Effort: S** for the
render, **M** with the difficulty curve.

### 6.5 Glucose Dash — `glucose-dash/glucose-dash.html` · **GEL** · anchor: *Space Invaders*' gel
The only light-ground game, and its `CLAUDE.md` says so deliberately: *"all the colour saved for
the storefronts so the thing you're steering toward is the only saturated object on screen."*

That intent is correct and must survive. Two ways:

- **(a) Gel, recommended — keeps the decision as made.** White mall stays. Lay a hard-edged
  coloured gel band per storey (§4.5), so the three floors read as three physically different
  strips of plastic. Storefronts still carry the only saturation. **Effort: S.**
- **(b) Invert.** Black ground, walls as white strokes, storefronts as the only fill. The stated
  intent *strengthens* under inversion — saturation on black pops harder than on white — and the
  2D renderer makes it trivial. But it overturns a deliberate call, so it is the user's decision,
  not a silent change. **Effort: M.**

> **(a) taken, 2026-09-05.** The user had not made the call this entry correctly says is theirs,
> so the option that preserves the documented intent won by default. Three sheets by storey,
> `multiply`, laid *inside* the clip `pathWalkable()` already establishes — so the gel adds no
> geometry and cannot drift from the walkable floor by construction. Storefronts are drawn after
> it and keep full saturation. One thing this entry does not anticipate: **the sheet order
> matters.** Pink on the ground floor — the obvious choice, since it is this game's world hue —
> sits pink-on-red against the warm storefront signage and costs exactly the separation this
> entry says to protect. Green there instead, which is also what Space Invaders' own bottom band
> was. See `under-development/glucose-dash/CLAUDE.md`.
>
> Also note the game moved to `under-development/` on 2026-09-05; the path above is stale.

Either way: quantize the checkerboard to the pixel grid, and do **not** touch `pathWalkable(f)`.
This is also the game whose white ground currently constrains the identity palette (§2.1) — under
(b) that constraint disappears entirely; under (a) it stays gel-local and the palette is still free,
since the gel is an overlay rather than a ground the player colours must survive.

### 6.6 4D Pong — `four-d-pong/four-d-pong.html` · **RASTER** · anchor: *Pong* (1972)
The most obvious conversion here. Currently light greys and white — a modern minimalist skin over
literally the ur-arcade game. Pure white on pure black, square paddles, square ball, dashed centre
line, enormous blocky score. Its title already says `PONG`. ~~No gameplay change; it is already the
reference.~~ **Effort: S.**

> **SHIPPED 2026-09-06, and this entry was half right — the better half.**
>
> **The skin instructions were correct and were followed literally.** Pure white on pure black,
> square paddles, a square ball, blocky scores. One addition the entry could not have known to
> ask for: with four goals live the dashed centre line becomes a **cross**, because one line only
> divides one of the two contests.
>
> **"No gameplay change" is the part that did not survive**, and not because the guide misjudged
> it — the user's brief for this session asked for four player counts, an AI ladder, and a
> tug-of-war promoted from a readout to the entire score model. Worth recording because §6.6 is
> the entry most likely to be quoted as licence to skip a design pass, and the game that came out
> of it is no longer "already the reference". **Effort was S for the skin and L for the session.**
>
> **Two findings that generalise past this cabinet:**
>
> 1. **`getComputedStyle(document.documentElement)` returns the wrong world hue.** `[data-game]`
>    is on `<body>`, so `:root` yields the generic `--phos-mid` default — *a valid colour* — and
>    the arena walls drew grey-green with nothing reporting a problem. **RD Arena hit the
>    identical bug one day earlier (§6.4's note).** Twice is a pattern: read tokens from `<body>`.
> 2. **§4.1 cannot be applied to a stacked canvas as written.** `RETRO.persist()` paints
>    translucent black `source-over`, which assumes the canvas being decayed is the opaque
>    ground. This game draws its tug-of-war barbells on a canvas *behind* the play canvas, and
>    persisting the front layer with black buried them in a few frames. The correct operation on
>    a transparent overlay is `destination-out`, which removes a fraction of the existing
>    **alpha**. It lives in `fp-render.js` under `shared/retro.js`'s own "more than one game"
>    rule, and is the first thing the second stacked-canvas game should pull up.
>
> **And one near-miss worth §2.3's file:** the local player's paddle was first capped with their
> identity colour. The palette has an entry **1° of hue from signal magenta** (§2.4 measures it,
> unfixed until the migration), and magenta on a paddle already means *desperate* in this game —
> an unlucky player would have had a paddle permanently reading as "about to lose". This is §2.3
> arriving in practice rather than in principle. The colour moved to the seat label.

### 6.7 Javelin Battle — `javelin-battle/javelin-battle.html` · **RASTER** · anchor: P1 phosphor
Already two-tone monochrome — but in Game Boy DMG green (`#9bbc0f`, `#8bac0f`), which is 1989 and
the wrong decade. **The instinct is exactly right and the reference is seven years late.** Swap the
DMG greens for P1 monitor green (`#33FF33` on `#000`) and keep the two-tone discipline completely
intact. Right idea, right decade. **Effort: S** — it is a constant swap.

### 6.8 Glass City Escape — `glass-city-escape/glass_city_escape.html` · **VECTOR** · anchor: *Battlezone* (1980)
Already dark with cyan. Building-hopping across a city is Battlezone's wireframe-solids-on-a-plane
almost exactly. Buildings → unfilled wireframe boxes, horizon line, vertex bloom on every corner.
One of the highest ratios of visual payoff to effort in the repo. Race mode's ghosts use the
identity palette; goals go `--sig-cyan`. **Effort: M.**

> **Shipped 2026-09-04**, with two deviations recorded in `glass-city-escape/CLAUDE.md`: walls
> keep a faint interior tint (an *unfilled* box in a top-down view reads as a room you can walk
> into, when a wall is the one thing you cannot), and there is **no horizon line** because a pure
> top-down renderer has no vanishing point to put one on.
>
> **Extended 2026-09-05 by the Hunt pass**, which added a threat layer the section did not
> anticipate. It follows §2.2 rather than inventing colours: everything belonging to a Surveyor
> that has acquired you is **`--sig-magenta`**, which is what magenta means here — its cone, its
> outline and eyes, its laser sight, and its bolts. Two legibility rules came out of it that are
> worth generalising:
> - **A projectile must not be the colour of the line that predicts it.** The bolts were first
>   drawn flat magenta travelling down a solid magenta sight beam and were effectively invisible.
>   The beam is now dim and dashed; the bolt is a `--phos-hot` core inside a magenta bloom.
> - **A "you are targeted" mark has to be drawn after the thing it marks.** As a dot inside the
>   robot's own draw it landed under the player sprite, since `render()` draws entities first and
>   the local player last.
>
> **Extended again 2026-09-06 (the Stepwell pass), and this one tests §2.3 rather than §6.8.** A
> new enemy kind — the blue Lancer, the only drone that shoots — was requested by the user in
> blue. Blue is not one of the Signal Three, so §2.3's letter is untouched; but **the identity
> palette contains two blues** (`hsl(206,85%,70%)`, `hsl(227,87%,68%)`), so a blue enemy can be
> confused with a rival's ghost, which is §2.3's *spirit* failing by another route. The general
> rule that came out of it, worth applying anywhere a new colour has to live near the identity
> palette:
>
> > **Carry the meaning in SHAPE, and let colour be the second read.** The Lancer has a barrel
> > stub and a rotating dashed sight ring that nothing else in the game has, and hard corners
> > against everything else's rounded ones. Its trim also stays blue while hunting rather than
> > going `--sig-magenta` like every other engaged drone — because if it turned magenta on
> > engaging, the one thing its colour carries ("this is the one that shoots") would disappear at
> > exactly the moment it starts mattering. A palette rule that is enforced by shape survives
> > colour collisions; one enforced only by hue does not.
>
> The stepwell plaza added at the same time follows §2.2 rather than bending it: its terraces are
> `--phos-mid` structure, and only the single tile at the bottom — the actual goal — goes
> `--sig-cyan`. Painting the whole plaza cyan would have left the tunnel nothing to say.
>
> ---
>
> ### CABINET REASSIGNED: VECTOR → RASTER (2026-09-06)
>
> **This section's cabinet assignment is superseded.** Glass City Escape now runs
> `data-cabinet="raster"` with the scanline overlay, and vertex bloom has been removed from it.
>
> The reassignment follows **§1's own test** rather than overriding it. §1 says the assignment is
> mechanical — *"what does the game already draw?"* — and the honest answer changed underneath the
> original call. When §6.8 was written this game drew stroked tiles and arc-and-roundRect sprites.
> It now draws chunky filled cells, blocky `fillRect` sprites, pixel-art hearts on their own canvas
> and a fixed HUD. That is the RASTER description in §1's table, not the VECTOR one.
>
> **Two things this establishes for the rest of the guide:**
>
> 1. **§6's cabinet assignments are dated to the games as they were.** Four of them have now been
>    contradicted by the code (§6.1 twice, §6.8 twice, §6.12, §6.4's perf claim). Treat §6 as the
>    opening position, and §1's mechanical test as the thing that actually decides.
> 2. **A reassignment is a package, not a switch.** Turning the scanlines on also meant removing
>    vertex bloom (§4.3 is a vector-hardware artifact — keeping it would be the same category error
>    as scanlines on a vector cabinet) and snapping every sprite to a virtual pixel grid, because
>    the scanline overlay is a 1px-on/2px-off gradient that an unsnapped sprite beats against and
>    shimmers. Half a reassignment looks worse than either whole one.
>
> **The wave transition, added the same day, is where the palette rule earned its keep.** Level
> changes now use a Robotron 2084 style burst: expanding rectangles rushing outward, colour-cycled
> at ~20Hz, over the already-rebuilt next level, with no modal and no pause. Robotron cycled its
> full hardware palette and the obvious move was to copy that. It was not taken — the burst cycles
> **`--sig-cyan` / `--sig-amber` / `--sig-magenta` / `--phos-hot`** instead. §2.2 gives those three
> fixed meanings that this game obeys everywhere else, and spending them on a decoration would be
> the exact failure §2.3 describes, one step removed. **The test that made it safe:** a burst that
> covers the entire screen for 780ms cannot be mistaken for a hazard, a pickup or a goal, because
> nothing that size is any of those. A signal colour is safe to reuse when its scale rules out the
> thing it normally means — which is a narrower licence than "it looks good", and worth stating
> narrowly.
>
> The reassignment also **retired §6.8's own unfilled-wireframe deviation**. The 2026-09-04 refusal
> was right at the time: an outline around empty space read as a room you could walk into. Walls are
> now drawn as a glass pane on each outward face, and it reads correctly — because the space inside
> the outline *is* a room you can walk into, since the floor is filled. The objection was about the
> interior being black, not about the outline.

### 6.9 Desert Robot Blaster — `desert-robot-blaster/desert-robot-blaster.html` · **VECTOR** · anchor: *Battlezone*
Three.js. A first-person robot shooter in a desert **is** Battlezone. Wireframe materials, black
background (already), a hard horizon line, distant wireframe mountains. Add the Battlezone
periscope HUD — a radar circle plus corner brackets — which reads as unmistakably 1980.

Noted as a long-term Unity candidate rather than a near-term web priority, so this is a
low-priority high-payoff item. **Effort: M.**

### 6.10 PS1 Racer — `ps1-racer/ps1racer.html` · **VECTOR** · anchor: *Star Wars* (1983) / *Pole Position*
Its title is already `PS1 LA Highway — Wireframe Build`, background already `0x000000`, Three.js
already loaded. **The aesthetic conversion is essentially already done** — it needs the beam
treatment and little else.

It is marked broken, and finishing it is already priority #2 in `PROJECT_MEMORY.md`. That makes it
the cheapest aesthetic win in the repo and an argument for pulling it forward: fixing a game that
is already 80% on-style costs less than converting one that is 0%. **Effort: S** for style, unknown
for the actual repair.

### 6.11 Voice Runner — `voice-runner/voice-runner.html` · **VECTOR** · anchor: the oscilloscope
Also broken, whistle-pitch controlled. The XY monitor and the oscilloscope are **the same
instrument** — one steers a beam from a deflection voltage, and so does the other.

So render the live mic input as an actual oscilloscope trace, and let the player's pitch *be* the
beam position. This is a genuine unification of theme, mechanic, and hardware, and it gives a
currently-broken prototype a reason to exist beyond the novelty of the input. **Effort: M**, on top
of whatever the repair costs.

### 6.12 Reality Rewrite — `reality-rewrite/reality-rewrite.html` · **VECTOR** · anchor: Tempest's colour states
Already has a radial vignette; keep it (quantized). The interesting move is the world hue.

The game is about rewriting the rules of reality. **Make each rule change shift the monitor's
phosphor** — green → amber → cyan → magenta. Period-plausible (swapping a tube or a gel), it makes
the core mechanic legible from across the room, and ~~it costs approximately one CSS custom
property because the game already funnels colour through `var(--stable-color)`.~~

> **Done 2026-09-05. The idea is good and shipped; the premise under it was wrong, in a way worth
> recording because it is how a "one-property" estimate becomes a session.**
>
> **`--stable-color` is the stability meter's fill and nothing else** — `#stability-bar` in CSS
> and one threshold swap in `updateUI()`. It is the health bar. The game funnelled colour through
> no variable at all: `draw()` called
> `getComputedStyle(document.documentElement).getPropertyValue('--bg-color')` **on every frame**,
> a forced style recalc per frame, which the pass replaced with one read at load.
>
> **And the Signal Three are not available as a world hue.** Three of the four tube colours named
> above (amber, cyan, magenta) are §2.2 tokens with fixed meanings; painting the whole world in
> one stops that signal reading. Resolved by *role* rather than by choosing different colours —
> the tube colour goes only on world **structure** (floor grid, arena bounds, cover outlines) at
> low alpha, while signals stay small, hot and saturated. Any future game that wants a shifting
> hue inherits this constraint. See `reality-rewrite/CLAUDE.md`.

Do **not** add a name→colour function back — `IDENTITY.colorFromName()` is the only one, and this
file is the reason that rule exists. ~~Its `init()`/`getState()` contract verification is still
open; do that first.~~ **Verified 2026-09-05** while `rr-boot.js` was being written. **Effort: M.**

### 6.13 Infected Labyrinth — `infected-labyrinth/infected-labyrinth.html` · **RASTER** · anchor: *Berzerk* (1980)
A maze shooter with portals, already on `#00ffcc`. Berzerk is precisely this: blocky
single-colour maze walls, monochrome robots, and **a different wall colour per room** — which maps
straight onto the portal structure. Each labyrinth section gets its own hue; passing a portal
changes the palette. Diegetic, era-accurate, and a real navigational aid. **Effort: M.**

### 6.14 Wasteland Train Sim — `wasteland-train-sim/wasteland_train_sim.html` · **RASTER** · anchor: *Moon Patrol* (1982)
Moon Patrol invented parallax scrolling, and a train is the ideal vehicle for it: three or four
layers of blocky wasteland silhouette at different speeds against black, with a rust gel on the
horizon band. Also a Unity candidate, so low priority. **Effort: M.**

### 6.15 Hex Grid — `hex-grid/Hex Grid.html` · **VECTOR** · anchor: *Tempest* (1981)
Titled "Hex Wall Defense," Three.js, already black, and marked broken. Tempest is a geometric-well
defence shooter rendered in glowing vector lines — the same game, one hardware generation earlier.
Lean in completely: hex cells as stroked outlines, enemies climbing the well, hot vertex bloom at
every intersection. **Effort: M**, plus repair.

### 6.16 Kula World — `kula-world/kula_world_fixed.html` · **VECTOR** · anchor: *I, Robot* (1984)
Three.js rolling-cube puzzle, pulls Three from a CDN — **so it is the one game that already fails
the `file://` constraint**, worth noting while it is open. *I, Robot* was the first commercial
filled-polygon game, and it looked like exactly this: flat untextured faces plus visible edges.
Wireframe track with a single flat fill on top faces. **Effort: M.**

### 6.17 Fruit Dropper — `fruit-dropper/fruit-dropper.html` · **RASTER** · anchor: *Kaboom!* (1981)
Flat-UI blue currently. Fruit → 8×8 blocky sprites, ≤3 colours each, snapped to the pixel grid.
Marked stable on mobile — one of the few — so protect that.

*Gameplay:* Kaboom!'s structure is the era's ideal: 3 lives, no continues, speed ramps every wave.
If it lacks a ramp, add one. It is the cheapest possible difficulty curve. **Effort: S.**

### 6.18 Particle Simulation — `particle-simulation/particle_simulation_game.html` · **VECTOR**
Already black, cyan, and white with stroked geometry. Add persistence and vertex bloom and it is
done. Its world hue is `--sig-cyan` by deliberate exception (§2.5). **Effort: S.**

---

## 7. Cross-cutting gameplay changes worth making

Answering the brief's last question directly. These are the ones where the era's *design* — not
just its look — is genuinely better for a 3–10 player friend group.

**Worth doing:**

1. **Attract mode** (§4.8) — the highest-identity, lowest-risk change available. Hub and per-game.
2. **Speed-up on depletion** (§6.4) — Space Invaders' accidental masterpiece. Free difficulty
   curve, one line, and RD Arena is built to receive it.
3. **Three-letter initials** in `leaderboard.html` — free, hashes correctly through
   `IDENTITY.colorFromName()`, and converts a generic score table into an arcade one.
4. **Flicker budget** (§4.7) — aesthetic and performance in the same change.
5. **Wrap-around in Gyro Space** (§6.1) — kills corner camping.
6. **Per-room palette in Infected Labyrinth** (§6.13) — navigation aid, not decoration.
7. **Speed ramps** where missing (Fruit Dropper).

**Deliberately not doing:**

- **Lives and no-continues.** Era-authentic and wrong here. These are prototypes for a friend
  group, several are co-op, and Zombie already has a revive loop that is better social design than
  a game-over screen. Do not import an economy that existed to extract quarters.
- **Single-screen play fields.** Several games are scrolling worlds by design; forcing one screen
  would be a rewrite, not a restyle.
- **Deliberate input lag or a 30fps cap.** §4.12 — these read as broken, not as retro.

---

## 8. Implementation

### 8.1 Two new shared files

```
shared/retro.css   custom properties, @font-face data URIs, .gel / .scanline / .bezel
shared/retro.js    exposes exactly ONE global: RETRO
```

> **A third shared global exists since 2026-09-07, and it is deliberately not part of this
> layer.** `shared/devtools.js` (`DEVTOOLS`, the `L`+`G` dev panel) is tooling, not aesthetics —
> nothing in this guide governs it and it draws nothing into a game's canvas. It is mentioned here
> only so this list is not read as "the shared layer is two files". It does follow the discipline
> below — one global, one owner — and it styles itself entirely off `retro.css`'s tokens
> (`--sig-cyan`, `--phos-*`, `--font-ui`, `--font-display`) with hard-coded fallbacks, so it
> inherits the cabinet's look without this guide having to say anything about it.

`RETRO` mirrors the discipline `shared/identity.js` established — one global, one owner, no second
copy anywhere:

| Call | Does |
|---|---|
| `RETRO.persist(ctx, a)` | §4.1 phosphor decay |
| `RETRO.beam(ctx, path, hue)` | §4.2 two-pass stroke |
| `RETRO.vertices(ctx, pts)` | §4.3 vertex bloom |
| `RETRO.snap(v)` | §4.4 render-space quantization |
| `RETRO.bands(t, n)` | §4.9 quantized light ramp |
| `RETRO.stroke(ctx, str)` | §3.3 Hershey stroke text |
| `RETRO.flicker(i, cap)` | §4.7 flicker budget |

Constraints this must respect, all from the root `CLAUDE.md`:
- **Classic `<script>` tag, no modules** — `file://`.
- **Exactly one global.** `scripts/check-global-collisions.js` must pass on every page that loads
  it alongside `IDENTITY` and `MP`.
- **No timers or listeners of its own.** If `RETRO` ever needs one it goes through the host game's
  `trackTimeout`/`AbortController`, never a second teardown path.
- Load order: `identity.js` → `mp-core.js` → `retro.js` → game files.

### 8.2 Suggested order

1. **`shared/retro.css` + `retro.js`** with no consumers. Nothing can regress.
2. **Boids** (§6.2) — smallest full conversion, proves the Vector path end to end.
3. ~~**4D Pong** (§6.6) — proves the Raster path.~~ **Done 2026-09-06** — though not in this
   order, and not as the proving run. The Raster path had already been proven three times over
   (Glass City Escape 2026-09-04, RD Arena and Glucose Dash's GEL variant 2026-09-05) by the time
   4D Pong was promoted off `under-development/`, so it inherited a settled path rather than
   establishing one. Boids, the Vector proving run, is still not done — the order in this list
   was never followed and the guide survived that fine.
4. **The hub** (§6.0) — the change that makes the whole thing visible.
5. **The palette migration** (§2.4) — both repos in one sitting, then
   `check-identity-parity.js`, then redeploy Render.
6. Everything else, cheapest first: Particle Sim → Javelin → Gyro Space → Fruit Dropper →
   RD Arena render → Zombie → the rest.

Do **not** start with Zombie or RD Arena. They are the two most valuable and most fragile games,
and they should be converted by a pass that has already been proven on something disposable.

### 8.3 Checks

After any change here, from the repo root:

```
node scripts/check-global-collisions.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
```

**One gap worth closing:** `check-doc-sync.js` hardcodes its repo-wide tracked list as
`["PROJECT_MEMORY.md", "MULTIPLAYER_PLAN.md", "HUB_LOBBY_PLAN.md"]`. This file is not in it, so it
will rot **silently** — which is the exact failure mode that script was written to prevent, and
this is precisely the kind of cross-cutting root-level plan the 2026-09-02 audit found stale. Add
`"AESTHETIC_GUIDE.md"` to that array; it is a one-word change.

---

## 9. What this guide does not settle

- **Glucose Dash gel vs. invert** (§6.5) — a real fork that overturns a documented decision. The
  user's call.
- **Whether the palette migration is worth one visible colour reshuffle** (§2.4). The numbers say
  yes; the disruption is real and one-time.
- **Mobile.** Most games are marked "Stable on mobile: No" already. This guide should not make it
  worse — VT323's x-height and dropping `shadowBlur` for two-pass strokes both help — but it fixes
  nothing, and no performance number here has been measured. `GAME_PROTOTYPE_INSTRUCTIONS.md` §4 is
  explicit that invented targets are how the old docs went wrong; profile before claiming a win.
- **Whether every game should convert at all.** Desert Robot Blaster and Wasteland Train Sim are
  Unity candidates; spending a session restyling them may be wasted.

<!-- doc-sync: 07d2e6c2 | 2026-09-08 -->
