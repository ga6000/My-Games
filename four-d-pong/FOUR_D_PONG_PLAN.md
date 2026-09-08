# 4D Pong — promotion, rebuild and three-filter pass

**Written 2026-09-06, before any edit to the game.** Root `CLAUDE.md` requires a saved plan for
anything cross-file; sessions compact, this doesn't.

---

## 0. What this session is

A **swap on the hub board** plus a **rebuild of the promoted game**.

| | Was | Is |
|---|---|---|
| `reality-rewrite/` | repo root, hub card #5 | `under-development/reality-rewrite/` |
| `four-d-pong/` | `under-development/four-d-pong/` | repo root, hub card #5 |

Board stays at five cards. Reality Rewrite is **shelved, not deleted** — it keeps its six-file
split, its `GameInstance`, its audio and its skin, all of which still work; it is simply not
reachable from the board. `under-development/README.md` is explicit that this folder is a status.

The promoted game then goes through the three filters named in the brief:

1. **Aesthetic** — `AESTHETIC_GUIDE.md` §6.6: RASTER cabinet, anchor *Pong* (1972), world hue
   `#FFFFFF`, effort S. §6.6 says "no gameplay change; it is already the reference" — **that half
   of §6.6 is now wrong for this session and the guide will be corrected**, because the brief asks
   for four new modes. The *skin* instructions in §6.6 are followed exactly.
2. **Script segmentation** — one `.html` → `fp-*.js` classic scripts, the shape every other active
   game now has.
3. **Audio development** — Tone.js (a CDN script, which is a live `file://` violation today) out;
   `shared/sfx.js` in, plus a game-local `fp-audio.js` for the vocabulary that is this game's own.

---

## 1. What the existing file actually is

`four-d-pong.html`, 599 lines, single file, last touched 2026-08-24. Despite the folder name it
is a **two-player left/right Pong**, not four-way. It carries more than a plain Pong:

- **depth shuffle** — both paddles move on X as well as Y, bounded by a 100px neutral zone at the
  centre line
- **blaster** — `A`+`D` (P1) fires a bolt that stuns the other paddle for 1s; 3s cooldown
- **power-up** — a dot on the centre line that instantly recharges the blaster
- **desperation** — at 6 goals behind, your paddle *grows* 25px per further goal, turns red, and
  the blaster becomes a 200ms-repeat machine gun
- **tug-of-war score bar** — a DOM slider whose divider slides toward whoever is ahead; ±10 net
  ends the game

The tug bar is the thing the brief builds on, and it already exists. Good.

### Four real defects to fix on the way past, not "improvements"

1. **CDN `<script src="https://cdn.tailwindcss.com">` and `.../tone/14.8.49/Tone.js`, plus an
   `@import` of Google Fonts.** All three are dead on a double-clicked page. This is the repo's
   first hard constraint and this file has been violating it since it was written.
2. **`setTimeout`/`setInterval` used raw** in seven places (stun, cooldown, machine gun, power-up
   respawn, countdown). Hard constraint: everything through `trackTimeout`/`trackInterval`.
3. **Listeners attached bare to `window`** with no `AbortController`.
4. **Frame-rate-dependent physics.** `update()` adds `ball.speedX` once per `requestAnimationFrame`
   with no `dt`. On a 144 Hz monitor the game runs 2.4× faster than on 60 Hz. Fixed-timestep
   accumulator at 60 Hz sim.

A fifth, smaller one: P2's movement reads `i/j/k/l` but P2's blaster reads `arrowleft`+`arrowright`
— two different hands for one paddle. The rebuild puts P2 wholly on the arrows.

---

## 2. The brief, restated as build rules

> when 1 player add easy/medium/hard difficulty.
> when 2 player keep as is
> when 3 or 4 player add additional version of the game in the up down direction, but one ball is
> shared between the whole game.
> for all versions of the game, there will be a scale at the top/bottom of the screen that shifts
> as current tug-o-war style, but when 3 or 4 player (3-player create an ai player which makes it
> 4) then it becomes a dual scale, 2 barbells of sorts drawn behind the canvas that shift
> depending on the score. when top player scores, the barbell shift closer to his side & so on.
> First person to win the tug-o-war wins the whole game.

### 2.1 Seats, not "players"

Four fixed seats. A seat is either HUMAN, AI, or ABSENT. Mode selects the pattern:

| Mode | Left | Right | Top | Bottom | Field | Axes live |
|---|---|---|---|---|---|---|
| **1P** | human | AI (easy/med/hard) | absent | absent | 16:9 | horizontal only |
| **2P** | human | human | absent | absent | 16:9 | horizontal only |
| **3P** | human | human | human | **AI (medium)** | square | both |
| **4P** | human | human | human | human | square | both |

3P filling the **bottom** seat with an AI is the brief's "3-player create an ai player which makes
it 4". Bottom is chosen because it is the seat whose keyboard cluster (`J`/`L`) is the one a third
person is least likely to have reached for.

Two paddles ⇒ top and bottom edges are **walls** (the ball bounces) — this is what "keep 2 player
as is" means physically. Four paddles ⇒ **all four edges are goals**.

### 2.2 One ball, always

Non-negotiable and stated in the brief. There is exactly one `ball` object in every mode. In the
four-paddle modes it is genuinely shared: a rally can go left→top→right→bottom without resetting.

### 2.3 Corner blocks — the thing four-way pong gets wrong if you skip it

With goals on all four edges, a ball arriving at a 45° corner passes a point no paddle can reach,
because each paddle is constrained to its own edge. Every four-way pong that plays fairly solves
this the same way: short **diagonal bumpers across each corner**, 14% of the side length, which the
ball reflects off. Paddles travel only between the bumpers.

Without them the game is decided by corner luck, and it is not obvious until you have played it.

### 2.4 The tug-of-war, single and dual

**Score is not a counter. It is a rope position.** Each axis owns one signed integer `pull`:

```
horizontal.pull  +1 when LEFT scores,  -1 when RIGHT scores
vertical.pull    +1 when TOP  scores,  -1 when BOTTOM scores
```

- **1P / 2P** — one axis is live, so there is **one scale**, the DOM bar at the top of the screen,
  which is what the game already has and what the brief says to keep for all versions.
- **3P / 4P** — both axes are live, so it "becomes a dual scale": the DOM bar is **replaced** by
  **two barbells drawn behind the canvas**.

**A barbell** is a bar with a plate at each end and a knurled centre marker. It slides bodily
toward whoever scored — "when top player scores, the barbell shifts closer to his side". The
horizontal barbell spans the field left↔right; the vertical one spans it top↔bottom; they cross at
the centre. **First barbell to reach a win line ends the whole game**, and the winner is the player
on the side it reached — "First person to win the tug-o-war wins the whole game."

`WIN_PULL` is 10 in the two-paddle modes (the value the current game already uses) and **7** in the
four-paddle modes, because two live axes and four paddles produce goals roughly twice as fast.

**Why the barbells are a separate canvas.** `#fpBack` sits behind `#fpField` at a lower `z-index`;
the field canvas is transparent, so the barbells are literally drawn behind it, which is what the
brief asks for. It also earns its keep: the back layer only redraws while a barbell is *sliding*,
not every frame.

The slide is eased over ~380ms rather than snapping, and it is the one place in this game where
something moves smoothly. §3.4 says numbers tick and never animate — the *number* still ticks; it
is the physical rope that slides, and a rope that teleports does not read as a rope.

### 2.5 Controls — `e.code`, not `e.key`

Four people share one keyboard, so what matters is where a key physically **is**. `e.code` is
physical position; `e.key` is what the layout prints on it. Using `code` also fixes the `Shift`
problem (`ShiftLeft` vs `ShiftRight` are distinguishable; `e.key` reports both as `"Shift"`).

| Seat | Sits at | Move | Depth (2-paddle modes only) | Fire |
|---|---|---|---|---|
| **Left** | far left of the keyboard | `W` / `S` | `A` / `D` | `Q` |
| **Right** | far right | `↑` / `↓` | `←` / `→` | `Right Shift` |
| **Top** | left-centre | `F` / `H` | — | `T` |
| **Bottom** | right-centre | `J` / `L` | — | `I` |

Four people can physically stand at that keyboard in that order. `A`+`D` together and `←`+`→`
together still fire, kept as a **legacy alias** so "keep 2 player as is" is literally true for
anyone who already knows the game.

Depth shuffle is two-paddle-only on purpose: with goals on four sides, paddles that can leave their
edge stop being paddles.

---

## 3. File split (filter 2)

Prefix `fp-`. Free — the repo already uses `gc-`, `gd-`, `rd-`, `rr-`, `st-` and `zombie-`.

| File | Owns |
|---|---|
| `fp-core.js` | constants, mode table, all mutable state, DOM refs, teardown plumbing, geometry/resize |
| `fp-entities.js` | paddle / ball / blaster / particle / power-up factories, collision, corner bumpers |
| `fp-tug.js` | the pull model, the DOM scale, the two barbells, win detection |
| `fp-ai.js` | easy / medium / hard, trajectory prediction, the 3P bottom seat |
| `fp-audio.js` | this game's vocabulary on top of `SFX` — rally pitch, goal, tug creak |
| `fp-render.js` | arena, paddles, ball, HUD, overlays — the whole RASTER skin |
| `fp-input.js` | the `e.code` map, one `AbortController` |
| `fp-boot.js` | menu/mode select, `window.GameInstance`, the fixed-timestep loop |

Load order in `four-d-pong.html`, at the **end of `<body>`** (the pattern every split game here
uses, because `fp-core.js` resolves the canvas from the DOM at load time):

```
../shared/identity.js → mp-core.js → retro.js → sfx.js → fp-core → entities → tug → ai → audio → render → input → boot
```

Rules taken from the six splits that came before, both learned the hard way (see
`GAME_PROTOTYPE_INSTRUCTIONS.md` §2): **cut in strict source order, reorder nothing**, and **every
file gets its own `"use strict"`** — the directive is per-file, so omitting it drops the file into
sloppy mode silently. `node scripts/check-global-collisions.js` before this is called done.

---

## 4. Aesthetic pass (filter 1) — RASTER, §6.6

| Guide | Applied here |
|---|---|
| §2.1 ground | `#f3f4f6` / `#e5e7eb` playfield → `--ground` `#000000` |
| §2.5 world hue | `#FFFFFF` pure white — already in `shared/retro.css` under `[data-game="four-d-pong"]` |
| §2.2 signals | amber = power-up + `INSERT COIN`; cyan = arena frame, barbell centre, HUD chrome; magenta = stun, blaster bolt, win line |
| §3.1/§3.4 | Press Start 2P for the score and title, VT323 for everything else; scores zero-padded (`RETRO.padScore`); `1UP`-style seat labels; uppercase throughout |
| §4.1 persistence | `RETRO.persist(ctx, w, h, RETRO.PERSIST.raster)` (0.6) — raster smears far less than vector |
| §4.4 quantization | `RETRO.snap(v, 4)` **at the draw call only**. Physics never sees it — quantized physics is how you get collision bugs that present as gameplay bugs |
| §4.6 scanlines | permitted and used — this is a Raster cabinet. `data-cabinet="raster"` gates the CSS |
| §4.7 flicker | `RETRO.flicker` on the desperation particle spray |
| §4.8 attract | idle 20s on the menu → the sim plays itself with four AI paddles, `INSERT COIN` pulsing in amber. Free here, because `fp-ai.js` already exists for the 1P and 3P modes |
| §6.6 verbatim | "square paddles, square ball, dashed centre line, enormous blocky score" — the ball becomes a **square**, and the centre line becomes a dashed **cross** in the four-paddle modes |
| §4.12 forbidden | no barrel shader, no chromatic aberration, no decorative dithering, no fps cap |

Paddles stay **white** (`--phos-hot`), not identity-coloured. §6.6 asks for pure white on pure
black, the world hue *is* white, and in four-way pong the seat is unambiguous from its edge — a
paddle on the left edge is the left player, no legend needed. Identity colour is used for exactly
one thing: a cap on the **local** player's paddle, taken from `MP.selfColor` with
`IDENTITY.colorFromName(name)` as the `file://` fallback. **No name→colour function is written in
this game.** That rule has been broken once in this repo already (Reality Rewrite's own scheme
agreed with the server 0 times out of 10) and it is not being broken again by the game replacing it
on the board.

---

## 5. Audio pass (filter 3)

Tone.js is deleted. `shared/sfx.js` provides the context, the gesture unlock, the envelope shape
and the namespaced mute preference; `fp-audio.js` provides only what is specific to this game.

```
SFX.configure({ game: 'four-d-pong' });      // namespaces the mute key — without it,
SFX.unlockOn(window, listeners.signal);       // muting Zombie silently mutes this game
```

| Event | Sound |
|---|---|
| paddle hit | square blip, **pitch climbs with rally length** and resets on a goal — the rally is audible |
| wall / corner bumper | lower, shorter square tick, so a wall never sounds like a paddle |
| goal | descending triangle pair; the **first note names the axis** (higher = vertical) so a four-paddle goal is readable without looking |
| barbell slides | low triangle groan under the goal sound — the rope creaking. This game's signature sound |
| blaster | `SFX.shoot()` |
| stun | `SFX.hit()` |
| power-up | `SFX.pickup()` |
| countdown / go | three amber ticks then a fifth above |
| win / lose | rising triad for the winner, `SFX.death()` for everyone else |

No JS timers anywhere in audio: multi-note jingles schedule on the `AudioContext` clock via
`SFX.sequence`'s `at`, which is sample-accurate and needs no tracking.

---

## 6. Hub

`hub/hub-core.js` `GAMES`: drop the `reality-rewrite` entry, add `four-d-pong` in the same slot.

The manifest currently derives one stamp for every non-`mp` game:

```js
GAMES.forEach(g => { if (g.mp) return; g.stamp = g.broken ? "COMING SOON" : "MULTIPLAYER SOON"; });
```

`mp` means "plays together **over the server**", and 4D Pong does not — but "MULTIPLAYER SOON" over
a game whose headline feature is four people on one keyboard is actively false. So the derivation
grows one clause: an entry may declare `couch: true` and gets `"COUCH 2-4P"` instead. One line, and
it makes the board tell the truth about the only couch game on it.

---

## 7. Verification

From the repo root, all three, per root `CLAUDE.md`:

```
node scripts/check-global-collisions.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
```

The doc-sync hash **will** move, and by more than usual: promoting a game adds a folder to
`gameDirs()` and shelving one removes it, so the repo-wide fingerprint changes twice over. Read the
flagged docs, fix what the swap made wrong, then `--update`.

Plus, by hand: open `four-d-pong/four-d-pong.html` by **double-click** (`file://`) and play one
rally in each of the four modes. That is the constraint the old file failed and the whole reason
Tone.js is gone.

## 8. Docs to reconcile after

- `under-development/README.md` — the table gains Reality Rewrite, loses 4D Pong; the "bringing one
  back" path-fix list gains `reality-rewrite.html`'s four `../shared/` → `../../shared/`
- `reality-rewrite/CLAUDE.md` → moves with the folder, gains a shelved-on note
- `four-d-pong/CLAUDE.md` — new, file-by-file, the shape the other per-game docs have
- `AESTHETIC_GUIDE.md` §6.6 — "no gameplay change" is no longer true; §8.2's "4D Pong proves the
  Raster path" is now done
- `PROJECT_MEMORY.md`, `SCOPE_PULLBACK_PLAN.md`, `COLUMN_COMPLETION_ROADMAP.md`
- `Game dev tracking.xlsx` — hub-linked / split / audio / aesthetic cells for both games
