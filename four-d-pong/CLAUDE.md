# 4D Pong — file map

New 2026-09-06, the day this game came off the shelf. It was promoted out of
`under-development/` in a straight swap with Reality Rewrite (which went the other way), and
rebuilt on the way up: four player counts, a tug-of-war that is now the entire score model, and
all three filters — aesthetic, script segmentation, audio — in one sitting.

`FOUR_D_PONG_PLAN.md` in this folder is the plan that was written **before** any edit, per root
`CLAUDE.md`'s cross-file rule. It carries the reasoning; this file carries the map.

---

## What it was, and the four things that were actually broken

599 lines, one file, untouched since 2026-08-24. Despite the folder name it was a **two-player
left/right Pong**, not four-way — but a well-featured one: depth shuffle inside a neutral zone,
a stun blaster on a cooldown, a power-up that recharges it, a "desperation" comeback mechanic,
and the tug-of-war score bar the brief builds on.

Four defects were fixed on the way past. They are listed because each is a repo-wide rule this
file was breaking, not a matter of taste:

1. **`file://` was broken, and had been from the start.** It loaded `cdn.tailwindcss.com`,
   cdnjs's `Tone.js`, and `@import`ed Google Fonts. On a double-clicked page none of the three
   exist — and the audio was not the only casualty: `Tone.start()` was called from the keydown
   that begins the game, so the reference throwing **took the START handler down with it**. A
   `file://` player got a silent game that would not start. First hard constraint in the repo.
2. **Seven raw `setTimeout`/`setInterval` calls** (stun, cooldown, machine gun, power-up respawn,
   countdown) and **three bare `window` listeners** with no `AbortController`.
3. **Frame-rate-dependent physics.** `update()` added `ball.speedX` once per
   `requestAnimationFrame` with no `dt`, so the game ran ~2.4× faster on a 144 Hz monitor. Two
   people in a couch match were playing different games if they swapped machines.
4. **P2's controls were split across two hands** — movement on `i/j/k/l`, blaster on
   `ArrowLeft`+`ArrowRight`.

---

## Nine files, plus the dev panel

| File | Holds |
|---|---|
| `fp-core.js` | seat/mode tables, all tuning constants, every piece of mutable state, DOM refs, teardown plumbing, `resize()`/field geometry, `tokenColor()` |
| `fp-entities.js` | paddles, the ball, blasters, particles, the power-up, collision, corner bumpers, `stepBall()` |
| `fp-tug.js` | **the score model** — the pull, the single DOM scale, the two barbells, win detection |
| `fp-ai.js` | easy / medium / hard, trajectory prediction, the committed aim error |
| `fp-audio.js` | this game's vocabulary on top of `shared/sfx.js` |
| `fp-render.js` | the whole RASTER skin — arena, paddles, ball, HUD, overlays |
| `fp-input.js` | the `e.code` key map, one `AbortController` |
| `fp-net.js` | **online play** — seats, snapshots, dead reckoning, host migration (added the same evening) |
| `fp-boot.js` | menu, match flow, attract mode, `window.GameInstance`, the fixed-timestep loop |
| `fp-dev.js` | **added 2026-09-07** — dev-panel registration, and the `armedWhen` predicate that keeps L+G off a live 3P/4P rally (see below) |

Load order is `identity.js → mp-core.js → retro.js → sfx.js → devtools.js → fp-core → entities →
tug → ai → net → audio → render → input → boot → dev`, at the **end of `<body>`** because
`fp-core.js` resolves the canvases and calls `resize()` at load time. `shared/devtools.js` goes
before this game's files so its keydown listener is attached before `fp-input.js`'s. Every file carries its own `"use strict"` — the
directive is per-file, and omitting it drops a file silently into sloppy mode.

---

## Seats, not players

There are always four seats. A mode fills them with `HUMAN` / `CPU` / `EMPTY`, which is why the
four-player game is not a second code path — it is the same physics with two more seats filled.

| Mode | Left | Right | Top | Bottom | Field | Axes live |
|---|---|---|---|---|---|---|
| 1P | human | CPU (easy/med/hard) | — | — | 16:9 | horizontal |
| 2P | human | human | — | — | 16:9 | horizontal |
| 3P | human | human | human | **CPU (medium)** | square | both |
| 4P | human | human | human | human | square | both |

Two paddles ⇒ top and bottom are **walls**; that physical fact is what "keep 2 player as is"
means. Four paddles ⇒ **all four edges are goals**. There is exactly one ball in every mode.

### Controls — `e.code`, never `e.key`

Four people share one keyboard, so what matters is where a key physically *is*. `e.code` is
physical position (it survives an AZERTY player) and it is the only way to tell `ShiftLeft` from
`ShiftRight`, which is what makes the right-hand seat's fire key possible.

| Seat | Move | In / out | Fire |
|---|---|---|---|
| Left | `W`/`S` | `A`/`D` | `Q`, or `A`+`D` |
| Right | `↑`/`↓` | `←`/`→` | Right Shift, or `←`+`→` |
| Top | `F`/`H` | `T`/`G` | `Y`, or `T`+`G` |
| Bottom | `J`/`L` | `I`/`K` | `O`, or `I`+`K` |

**Every seat has both axes and a blaster.** Depth was two-paddle-only in the first build, on my
reasoning that "with goals on four sides, a paddle that can leave its edge stops being a paddle".
The user overruled that, and they were right: the trade-off is the *point*. Advancing into the
middle ground abandons your own goal to contest the power-up, which is a decision, not a mistake.

Holding both in/out keys fires — the original game's idiom, now on all four seats rather than just
the two that had a depth pair. Each seat also keeps a dedicated fire key, because a two-key chord
is a poor thing to need in a hurry.

#### `KeyG` and `KeyL` are taken, and the dev panel has to work around it (2026-09-07)

Read this before touching either the table above or `shared/devtools.js`. The repo-wide dev panel
opens on **L+G held together**, and this table hands `G` to TOP's in-out and `L` to BOTTOM's move.
In 3P and 4P those are two different people at one desk holding exactly those two keys as ordinary
play — not a coincidence to be tuned away.

**A dwell timer does not fix it.** Movement keys here are held for seconds at a time; any dwell
short enough to be usable as a shortcut is shorter than a normal press.

So `fp-dev.js` supplies `armedWhen` and the combo is simply not armed while both of those seats
are live humans mid-rally:

- **1P / 2P couch** — TOP and BOTTOM are `EMPTY`, nothing owns G or L, combo works during play.
- **Online** — everyone drives their own seat with WASD/arrows (`ONLINE_UP` and friends), so
  neither key is bound; armed during play.
- **3P / 4P couch** — pause with SPACE first, or open it from the menu or the game-over screen.

Closing is *always* armed, in every mode: the check short-circuits once the panel is open, so you
can never get stuck behind an overlay you cannot dismiss. The panel's own State readout has an
`L+G armed` row that says which of these you are in.

---

## The middle ground

A paddle may advance off its own wall until its inner edge reaches **half a `NEUTRAL_ZONE` past
the centre** — i.e. it may cross the centre line, which is what puts the power-up (which sits on
the centre) inside everyone's reach.

Getting that sign wrong is how the two-paddle game silently lost the mechanic: `maxDepth()`
*subtracted* the half-zone instead of adding it, so every paddle stopped 50 px short of the centre
and the blaster recharge was permanently unreachable. Nothing looked broken — the power-up still
spawned and still blinked — which is exactly what made it survive a full test pass.

The bound is **per seat**: a LEFT/RIGHT paddle advances along X and a TOP/BOTTOM one along Y, and
those spans are equal only on the square field.

It is drawn as a **plus, not a square**, because that is what the reachable area actually is: the
left/right pair can enter a vertical band at any height, the top/bottom pair a horizontal band at
any width, and their union is a plus. The two bands are drawn separately and overlap, so the centre
square — the only place all four can meet, and where the power-up spawns — comes out brighter for
free. Drawing only the intersection would tell three quarters of a lie about where a paddle may go.

**Paddles do not collide with each other**, deliberately, so two seats can occupy the same middle
ground. Only the ball collides with paddles. There is no paddle-paddle test anywhere and there
should not be one.

## Serve direction and the speed ramp

**On a four-goal field, every serve takes a uniform heading from the full circle** — not just the
opening one. Measured over 4,000 serves: 25.4 / 25.1 / 25.0 / 24.4 % per quadrant, 50.4 %
mostly-vertical.

It started as an opening-serve fix, because with only LEFT/RIGHT ever picked every match opened
sideways. Testing showed the *convention* was the deeper problem: Pong serves the ball back at
whoever conceded, which on a two-paddle field only decides who receives, but on a four-goal field
quietly locks play onto one pair. A 10-second run produced four goals in a row all on the
horizontal axis, because each goal there sent the ball straight back at the same two players — the
vertical pair were spectators in their own game. With every serve randomised, the same test gave
3 horizontal and 3 vertical goals with all four seats scoring.

The two-paddle game keeps the classic convention: there is only one axis, so it changes nothing,
and a near-vertical serve there would just bounce between the walls.

**The serve speed ramps with match time** — `+14 %` of the base per minute, capped at `+90 %`, so
340 px/s becomes 646 px/s after about six and a half minutes. This is `AESTHETIC_GUIDE.md` §7's
Space Invaders speed-up applied to a specific problem rather than a general one: two evenly matched
sides can rally a tug-of-war to a standstill, and a game that cannot end is a worse outcome than a
fast one.

It ramps the **serve**, not the rally. The rally already accelerates 5–7 % per paddle hit and is
reset by every goal; what needed to move was the floor each new point starts from. Guests keep
their own copy of the match clock purely so the ramp survives host migration — otherwise a guest
promoted mid-match would restart it from zero and the game would visibly get *slower*, which reads
as a bug rather than a handover.

## Three things here that will look like bugs and are not

### 1. The two tug-of-war readouts move in opposite directions

The DOM bar is a **territory** read: when the left player scores, the divider is pushed *away*
from them and their fill grows. That is the bar the game already had, and the brief says to keep
it. A barbell is a **rope** read: it slides *toward* whoever pulled — "when top player scores, the
barbell shift closer to his side."

They never appear together. One live axis gets the bar; two get the barbells. Documented at the
top of `fp-tug.js`.

### 2. The barbells are shorter than the field

The first version spanned the whole field and slid inside the stage margin. That bounded the
throw at ~4px per goal — unreadable — and at full pull the plate on the *winning* side slid off
the top of the stage, at the exact moment the reader most wants to see it. Shortening the bar to
two thirds of the field converts the slack into travel (~15px per goal). It is also a better
picture of a tug-of-war: the rope gets dragged **across** the line rather than shuffling in a
track.

### 3. `persistLayer()` in `fp-render.js` instead of `RETRO.persist()`

§4.1's phosphor decay paints translucent **black** over the frame, and `RETRO.persist()` does
exactly that — `source-over`, which assumes the canvas it is decaying is the opaque ground.

`#fpField` is not the ground. `#fpBack` sits behind it carrying the barbells, and painting black
over the field would bury them within a few frames. So the decay uses `destination-out`, which
removes a fraction of the existing **alpha** and leaves the layer transparent. Same look,
composited correctly. It stays in this folder on `shared/retro.js`'s own rule — only techniques
used by more than one game live there.

---

## Online play — `fp-net.js`

Added the evening of 2026-09-06, hours after the game shipped as couch-only, for a three-friend
session that night. `ONLINE_PLAN.md` carries the reasoning. **No server change was needed** —
everything rides `mp-core`'s generic `relay`, which the server passes through untouched, so the
separate `gyro-space-server` repo was not touched and nothing was redeployed.

### Host authority, and why parallel worlds could not work

Glass City Escape's model — parallel worlds, positions only, no host — is much cheaper and is
wrong for this game. It suits a **race**, where players never interact and each can run its own
world from a shared seed. 4D Pong has **one ball and everybody hits it**; two clients simulating it
from the same seed diverge the instant a paddle moves, because paddle positions are *inputs*, not
seeds.

So the host owns the ball, every collision, the score, the tug, the blasters, the power-up and the
CPU seats, and broadcasts a snapshot at 20 Hz.

**Clients predict exactly one thing: their own paddle.** That is safe here in a way prediction
usually is not, because nothing but your own keys moves your paddle — the single exception is a
stun, which the host owns and the client accepts. There is no rollback, no reconciliation and no
input buffer; those solve problems this game does not have, and each is a night of debugging.

The ball is dead-reckoned between snapshots (constant velocity between bounces, so this hides most
of the latency), with corrections blended over ~100 ms rather than snapped.

### Seats

| Humans | Seats | Field |
|---|---|---|
| 2 | LEFT, RIGHT | 16:9, walls top and bottom |
| **3** | LEFT, RIGHT, TOP + **host-run CPU on BOTTOM** | square, four goals |
| 4 | all four | square |
| 5+ | first four seated, rest spectate | square |

Three humans getting a CPU fourth is the morning brief's own rule, and it is the same seat the
couch 3P mode uses — so the two modes are the same game rather than two that resemble each other.

**The host assigns seats and broadcasts them; nobody derives them.** Deriving from a sorted peer
list looks simpler and is a trap: peer lists differ transiently while someone is joining, so two
clients can briefly disagree about who is LEFT, and from then on every input goes to the wrong
paddle. Host migration is free — `onHostChange` fires and the new host already holds the last
snapshot.

### Online uses one key set for everybody

The couch map is four clusters spread across one keyboard, which is right when four people share
it and wrong the moment each has their own. Online, **both WASD and the arrows drive your paddle**,
mapped by which way your seat slides — LEFT/RIGHT on the vertical pair, TOP/BOTTOM on the
horizontal one.

**Whichever pair is left over is your in/out control, and holding both of it fires** — so a TOP
player fires with `W`+`S` while a LEFT player fires with `A`+`D`, each using the pair their seat
does not need for sliding. `Q` / `E` / `/` / right-shift fire too. Nobody has to be told which seat
they got.

While two or more people are in the room the local mode buttons are **disabled**, and START
relabels itself READY for guests. Seats are the host's to assign, so a button letting one player
pick "2P" while the room holds three is a desync with a UI affordance attached to it — and a dead
button in a game three people are staring at is a support call.

### Two bugs found by testing, not by reading

1. **A player joining mid-match froze the ball permanently.** A changed player count changes the
   arena, which calls `applyMode()`, which calls `createBall()` — and that puts the ball at the
   centre with **zero velocity**, with nothing left to re-serve it. The fix is not to patch the
   ball up; a half-changed arena is not a state worth defending, so the host restarts the match.
   Note the shape: it only ever bit on the 2↔3 transition, because 3→4 keeps the same arena and
   merely turns a CPU seat into a person.
2. **Positions travel in field-local units and are scaled on arrival**, so two players on
   differently shaped windows each play a full-size field instead of one being letterboxed to
   match the other. Velocity scales with them — otherwise the ball crosses a smaller field faster
   and the two screens disagree about *when* it arrives.

### Testing it again

`gyro-space-server-main/server.js` is on disk one directory up with `ws` installed, and `mp-core`
already has a `?server=` override, so the real server runs locally:

```
node "Active Github Repos/gyro-space-server-main/server.js"    # PORT=8090
```

then open clients at `?name=X&room=TEST&server=ws://localhost:8090`. Verified that way with three
clients: seat agreement, host migration on the host closing its tab, guest-to-host paddle and
fire, and a deliberately half-size third client tracking the ball to within a pixel of the right
*fraction* of its own field.

---

## Aesthetic pass — RASTER, `AESTHETIC_GUIDE.md` §6.6

§6.6 asked for "pure white on pure black, square paddles, square ball, dashed centre line,
enormous blocky score," and all of it is here. The centre line becomes a **cross** in the
four-paddle modes, because one line would only divide one of the two contests.

`data-cabinet="raster"` is what switches the scanlines on — §4.6 makes them raster-only and the
CSS is gated on the attribute, so they cannot be applied to a Vector cabinet by reaching for a
class name. `data-game="four-d-pong"` resolves `--world-hue` to `#FFFFFF`.

Also here: `RETRO.persist` (as above), `RETRO.snap(v, 4)` **at the draw call only**,
`RETRO.padScore`, `RETRO.flicker` on the desperation spray, and `RETRO.attract` — attract mode
cost almost nothing because `fp-ai.js` already existed, so the demo is the same code with every
seat handed to a CPU.

### `tokenColor()` reads from `<body>`, not `:root` — and this bit twice

Canvas cannot read a CSS custom property, so the tokens are resolved to strings once and cached.
The first version read `document.documentElement`. **The per-game world hue is set by
`[data-game="four-d-pong"]`, and that attribute is on `<body>`** — so `:root` returned the generic
`--phos-mid` default instead, which is a *valid colour*, so the walls simply drew grey-green and
nothing anywhere reported a problem. A wrong-but-valid value is the worst kind.

### No paddle is ever tinted with a player's identity colour

The first pass capped the local player's paddle ends with it. That is §2.3's failure mode
exactly: the current palette has an entry **1° of hue from signal magenta** (§2.4 measures it and
flags it as unfixed until the palette migration lands), and magenta on a paddle already *means*
desperate in this game. An unlucky player would have had a paddle that permanently read as "about
to lose."

The identity colour moved to the local player's **seat label**, where no colour is semantic. The
server's answer wins (`MP.selfColor`); `IDENTITY.colorFromName` is the `file://` fallback.
**There is no name→colour function in this game and there must never be one.**

---

## Audio pass

`Tone.js` is gone. `shared/sfx.js` provides the context, the gesture unlock, the hard-envelope
tone shape, the namespaced mute preference and the two shared jingles; `fp-audio.js` provides
only what is specific here:

- **The rally is audible** — the paddle blip climbs in pitch with the rally and resets on a goal,
  capped at 24 steps so it never walks out of the audible range mid-point. This is the one piece
  of audio design that is genuinely this game's own.
- **A goal's first note names the axis** (a fifth higher for vertical), so with four goals live
  you can tell which rope moved without looking away from the ball.
- **The tug creak** — a low triangle sagging 98 → 62 Hz *under* the goal tone, so a goal and its
  consequence arrive as one event. The signature sound.

`SFX.configure({ game: "four-d-pong" })` namespaces the mute key. Without it every game on the
origin shares one, which is how muting Zombie silently mutes this and reads as broken audio.

---

## The CPU, and the one measurement worth keeping

Three knobs produce a difficulty *curve*: paddle speed, reaction (how long a stale target is
committed to), and aim error. Only **hard** predicts the intercept; easy and medium chase the
ball's current position, which is the mistake a new player makes.

**The aim error is rolled once per approach, not once per think.** Re-rolled per think it is
noise around the truth, the ball's flight allows a dozen thinks, the samples average out, and the
paddle converges on the exact intercept. Measured: hard-vs-hard finished **0:0 at every error
value from 0.26 to 0.62 paddle-lengths** — the knob was never connected. Rolled once and committed
to, it is a misjudgement the CPU has to live with, which is what a human error actually is.

With that fixed, 240 simulated seconds per pairing, blasters off:

| `hard.error` | hard-v-hard | medium-v-hard | hard-v-medium |
|---|---|---|---|
| 0.55 | 0 / 4min | 0 : 8 | 8 : 0 |
| **0.62** | **4 / 4min** | **2 : 8** | **8 : 2** |
| 0.72 | 21 / 4min | 13 : 7 | 4 : 14 |
| 0.85 | 52 / 4min | 15 : 5 | 7 : 10 |

0.62 is the knee. Below it hard cannot concede; above it the error swamps the prediction
advantage and hard drops **below** medium — which would have shipped a difficulty menu whose
hardest setting was the second easiest. The mirrored pairs (2:8 against 8:2) are also the check
that no left/right asymmetry crept into the seat code. For scale: easy-v-easy ≈ 26 goals/3min,
medium-v-medium ≈ 8.

---

## Corner bumpers are load-bearing, not trim

With goals on all four edges, a ball arriving at 45° crosses a point no paddle can reach, because
each paddle is confined to its own edge. Every four-way pong that plays fairly solves it with
short diagonals across the corners. It is not obvious the game needs them until you have lost to
one. Each is a 45° line, so the reflection has a closed form and needs no dot product.

---

## Open / not done

- ~~**No networked play.**~~ **Online since the evening of 2026-09-06** — see the section above.
  The hub entry graduated from `couch: true` to `mp: true` the same day the couch stamp was
  added. **Untested on real internet latency:** every online check so far ran against a server on
  `localhost`, where the round trip is effectively zero. The parts most likely to feel different
  over a real connection are the marginal save (the host judges it using the paddle position you
  sent half an RTT ago) and the bounce correction.
- **No leaderboard.** `Firebase / Leaderboard Integrated?` is `No`. A tug-of-war has no score to
  submit — "won by 7" is the whole result — so it would need a designed metric (rally length? win
  streak?) rather than a wiring job.
- **Mobile is off**, per `SCOPE_PULLBACK_PLAN.md` §1. This is four people at one keyboard and has
  no touch scheme at all, so the page says so on a coarse pointer rather than rendering a field
  nobody can play.
- **Untested with four real humans at one keyboard.** The couch key map is the part most likely
  to want revision once four people actually stand at one desk. (Online play sidesteps this
  entirely — everyone uses WASD or the arrows.)
- **The ball only collides with a paddle it is closing on.** A paddle sitting deep in the middle
  can be passed through from behind. That is inherited from the original (`ball.x < w/2 ? p1 : p2`
  tested only the near paddle) and it is kept on purpose: a two-sided test lets the ball be pinned
  between two advanced paddles, and a stuck ball is worse than a soft one. Now that every seat can
  reach the middle it will be *seen* more often, so it is worth a decision if it grates.

<!-- doc-sync: f20f3c9a | 2026-09-25 -->
