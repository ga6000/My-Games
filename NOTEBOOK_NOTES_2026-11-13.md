# Notebook notes, filed 2026-11-13

**Which game?** Several: hub-wide standards, Gyro Space / Gyro Fleet, RD Arena, and three new
concepts. **Which finish-line item does this close?** None. This is an inbox write-up
(`SCOPE_RULES.md` rule 2): Ry transcribed older notebook pages so they could be checked
against the current docs before being kept or dropped. Nothing here is built or committed to.
The one-line entries live in `IDEAS_INBOX.md` under "Notebook notes (2026-11-13)" and point
back here.

Each note is tagged with how it fits what already exists:

- **ALREADY** — already a standard or decision; the note just reinforces it.
- **PARTLY** — something close exists; the note adds a piece.
- **NEW** — nothing like it in the docs yet.
- **CONFLICT** — disagrees with a written rule or a recent decision. Needs Ry's call.

---

## 1. Hub-wide notes, and the proposed rewrites to the standards docs

Per the project rule, where a note moves away from a hub standard, the fix proposed is a
rewrite of that standard (for every game), not a one-game exception. **None of these rewrites
has been applied.** Each waits for Ry's yes.

| # | Note | Fit | Where it lands |
|---|------|-----|----------------|
| H1 | Every game has movement, sound and animation | ALREADY | Implied everywhere; make it explicit (R1) |
| H2 | Retro colours and effects amplified | PARTLY | `AESTHETIC_GUIDE.md` §4 is still "nothing implemented"; the raster-reel branch is where amplification is being tried |
| H3 | Every game has a right sidebar: minimap, score, health, status, artwork | ALREADY (+artwork) | §4.11a cabinet panel is required; add an artwork slot (R2) |
| H4 | Hand-painted side-of-cabinet artwork on every hub card, one shared style, replacing emojis | NEW | Hub cards are emojis today (`hub/hub-core.js` lines 65-72). R3 |
| H5 | Start screen, load screen, a few seconds of attract play, player join as in Zombie | PARTLY | §4.8 attract mode is written but only the hub idles; Zombie's join is the model. R4 |
| H6 | A "border" screen before play (Robotron / Defender style) to show the game isn't live yet | NEW | Read as a framed DEMO / PLAYER READY screen between attract and play. R4 |
| H7 | Floating score toasts (1,200, 500), points normalised to 80s values and across hub games | NEW | Needed anyway for cross-game totals (H13). R5 |
| H8 | Star Wars style rolling text telling how each game fits the story | PARTLY | Matches the "8-bit chapter intro per game" TODO. R6 |
| H9 | Cookies unlock games per player as they progress the story | PARTLY | Same system as "Cross-game rewards" in the inbox (needs a per-player store; rule 7). Inbox |
| H10 | Every game has its own catchy tune, all thematically related | PARTLY | §4.10 audio covers SFX, not music. R1 |
| H11 | End state: 12 to 18 titles with party modes and a running score (Mario Kart / Wii Party / Wii Sports) | CONFLICT | `SCOPE_RULES.md` rule 8 caps the board at 5 (now 6 with Scuba). R7 |
| H12 | Group is small: 2 to 3 others. Team-vs-team is not the design intent | CONFLICT (mild) | `AESTHETIC_GUIDE.md` says "3-10 player friend group". R8 |
| H13 | Running wins/score across games, one victor per session, readout between games and at the end, after X games | PARTLY | This is the chain-game session that `HUB_1_0_PLAN.md` left out of 1.0. R9 |
| H14 | Rounds are novel, quirky, 1 to 4 minutes, quick dopamine | CONFLICT (mild) | Rule 0 says 2-5 minutes. R10 |
| H15 | Multiplayer must be flawless | ALREADY | Hub 1.0 §5 item 3 ("no known bug ends a session") |
| H16 | Distant goal: couch co-op, multiple controllers, one screen, as the foundation of every game | CONFLICT | Couch co-op was removed 2026-09-01 after playtesting (`MULTIPLAYER_PLAN.md`). Only 4D Pong is couch by design. R11 |
| H17 | Speed and chaos everywhere; reaction time and pattern learning are rewarded | ALREADY | Fits rule 0 and §7 |
| H18 | Some games lean on luck more than others | NEW (note) | Matters for the session total (R9): weight or accept it |

### Proposed rewrites

**R1 · `GAME_PROTOTYPE_INSTRUCTIONS.md` §1 (Hard constraints).** Add:
> Every hub game has player movement, sound effects, animation, and its own music loop. The
> music loops share one theme (instrumentation, key, tempo family) so the hub sounds like one
> album.

**R2 · `AESTHETIC_GUIDE.md` §4.11a, layout list.** Add item 6:
> 6. **Artwork**, at the bottom, when the game has a cabinet painting: a cropped strip of it.

**R3 · `AESTHETIC_GUIDE.md` §6.0 Hub.** Replace "tiles → marquees with Press Start 2P titles" with:
> Tiles show the game's cabinet side-art: one hand-painted illustration per game, all in one
> shared painted style (not pixel art), with the marquee title over it. Emoji icons are removed.
> Until a painting exists, the tile shows the title only.

Open: who paints it. Generated art in one style is Ry's stated preference; picking the tool and
the style reference is a separate task.

**R4 · `AESTHETIC_GUIDE.md` §4.8 Attract mode.** Replace the "Each game" bullet with:
> **Each game** boots through the same five screens: LOAD → TITLE → ATTRACT (a few seconds of
> the game playing itself, `INSERT COIN` / `PRESS TO JOIN` pulsing, players join as in Zombie) →
> READY (a framed border screen in the style of Robotron and Defender: the play field is drawn
> inside a border and marked not live, players listed) → PLAY. Attract loops back to TITLE.

**R5 · new `AESTHETIC_GUIDE.md` §4.13 Score toasts and the hub point scale.**
> Points float up from where they were earned as a toast ("500", "1,200"), in the earner's
> identity colour, rising and fading in about 0.8 s. Values use 80s arcade sizes (small kills
> 50-200, big ones 500-2,000, bosses 5,000+). Every hub game scores on the same scale, so a good
> 3-minute round in any game lands in roughly the same range (target to be set once and
> written here). This is what makes a cross-game session total fair.

**R6 · `GAME_PROTOTYPE_INSTRUCTIONS.md` §1.** Add:
> Every hub game opens with a skippable chapter crawl (Star Wars style rolling text, or 8-bit
> slides) that places it in the hub story. Its text lives in the story doc, not in the game.

**R7 · `SCOPE_RULES.md` rule 8.** Replace with:
> **Promotion is one-in, one-out, and the board grows on purpose.** The long-run target is 12 to
> 18 titles. The board grows by one only when every card on it has been played by the group in
> its current form; otherwise a new card trades places with an old one.

**R8 · `AESTHETIC_GUIDE.md` §7 (and line 168).** Replace "a 3-10 player friend group" with:
> a small group, usually 3 to 4 people in all. Designs assume free-for-all scoring inside
> co-op PvE, not team versus team.

**R9 · `HUB_1_0_PLAN.md`, new "Phase 7 — Party session (after 1.0)".**
> A party session is X games chosen in advance. Each game reports a per-player score on the hub
> scale (R5). Between games the hub shows a standings readout; after the last game it shows a
> final readout and one winner. Wins and running totals are kept per session. Luck-heavy games
> may count for less (open). Same-screen play is not part of this phase.

**R10 · `SCOPE_RULES.md` rule 0.** Replace "2-5 minute session" with:
> **A hub game round is 1 to 4 minutes.** It ends in a win or a loss inside that window.

(Zombie's 2-4 minute run already fits. Gyro Fleet and Glass City would need timing.)

**R11 · `MULTIPLAYER_PLAN.md`, new note under the 2026-09-01 removal.** Proposed text:
> Couch play (several controllers, one screen) is a distant goal for the whole hub, not a
> current one (Ry, 2026-11-13). It was removed from RD Arena in 2026-09 because it played
> badly there. If it comes back it has to be designed in from a game's start, so new games
> should keep input per player (no single global input reader) to leave the door open.

Ry's call needed: is couch play a real foundation (which changes how every new game is built)
or a someday idea (inbox only)? The note says "foundation"; the past playtest said no.

---

## 2. Per-game notes

### 2.1 Gyro Space → most of this is already Gyro Fleet

"Gyro Space" in the notebook is the folder name of **Space Tracer** (`gyro-space/`). But the
redesign it describes (motherships, bot ships spawning fast, classes, Bosconian-style targets,
kamikaze) is the brief that became **Gyro Fleet** (`gyro-fleet/`, pass 1 built 2026-11-08). The
current story placement has both: Space Tracer = the first space fights, Gyro Fleet = going
out to The Tide, on the same bones. So this filing treats the notes as **input to Gyro Fleet**,
and leaves Space Tracer as it is. Ry's call if that's wrong.

| Note | Fit with Gyro Fleet decisions |
|------|-------------------------------|
| Bots spawn rapidly and race to destroy motherships, scouts, etc. | ALREADY (expendable bot wings) |
| Any collision breaks you | NEW. Harsh, but fits "expendable bots" |
| Objectives light-years away; hyperdrive at 100x; hard to aim at hyper speed | ALREADY close (gears / ultradrive) |
| Spawn at a mothership, choose a "Gearport" (exit) | ALREADY close (hex spawn room, one exit per class) |
| Inspiration: Dreadnought Factor and Kobo Deluxe | NEW refs. Kobo Deluxe is a Bosconian-style shooter, so it agrees with the existing Bosconian reference |
| Enemy battleship-style destructor | PARTLY (Gyro Fleet's enemy capital is a creature: the hive / The Tide) |
| Power-ups in space: vaporise, then siphon drops, asteroids, trash, debris | NEW. **Ry, 2026-11-13: siphon fills ONE currency, spent on healing and on calling in bots** |
| Dead enemies don't vanish; drifting wrecks stay breakable | NEW |
| Siphon heals minor injuries, medic only | NEW |
| No momentum | ALREADY (Ry leaning against momentum) |
| Movement only on right-click; spacebar = hyperdrive | NEW control scheme. **Ry, 2026-11-13: holding right-click is thrust** (not click-to-move, which feels RTS). Gyro Fleet controls are waiting on Ry's playtest; try this then |
| Classes: Medic (wide heal), Auto (picks for you), Attack (damage), Defense (survives slow bumps / light fire, recharges) | CONFLICT. The crew is now 6 classes (medic, engineer, scout, gunner, butcher, bulwark). Map: Medic = Maren, Attack = Greer, Defense = Booke. "Auto" has no crew match: drop it, or make it a mode any class can use |
| Battle timeline (launch, 2 s spool, 10 s flight, can't turn at light speed, slow / correct / re-burst, asteroid belt, 30 s battle) | PARTLY. Fits the 1-4 minute round. Conflicts lightly with "auto-brake on arrival" and "no stopping dead"; the timeline has the player slowing by choice, which is compatible |
| Outcomes: kamikaze, flee, fight and shoot bits, heal allies, take out the enemy mothership | ALREADY (kamikaze impact frame is decided) |
| Round structure (Ry, 2026-11-13) | **Three sites ending in a raid.** The third site is the enemy mothership; the final raid is every remaining enemy on Earth flooding toward the MPC |

### 2.2 RD Arena

- **Roll back to before the server update.** NEW, plan item only; no code was touched. The
  pre-multiplayer build already exists as the frozen snapshot `rd-arena.pre-mp/` (2026-09-07).
  The cheapest rollback is to point the hub card (`hub/hub-core.js` line 68) at
  `rd-arena.pre-mp/RDArena.html` and keep `rd-arena/` as the MP branch of work. Note this
  makes RD Arena a solo / couch game again, which drops it out of online party sessions
  unless that's intended.
- **Placement: close to the last chapter.** CONFLICT. The chronology has RD Arena in Act III
  (Escalation, inside a Hurl), before Act IV Launch (code racer, Cliff Run, Text Editor Wars)
  and Act V (Space Tracer, Gyro Fleet). "Close to last" fits better as the possible
  "burn everything" RD Arena level on The Tide in Act V. Ry's call: move RD Arena, or keep the
  Hurl chapter in Act III and make the late one a second RD Arena level.
- **Chapter: the Belly of the Beast.** Collaborators / a cult working with the invaders try to
  stop the crew's plan to purge the beasts from inside with fire. In this chapter the crew
  risks joining the alien hive mind to use its power and kill it before losing control. NEW.
  (MPC = main player character, Ry 2026-11-13.)
- **Opening:** the crew drops into the Hurl, the cone pit in central Manhattan with the Hudson
  pouring in, slides into the Belly, catches a catwalk, and climbs down at the edge of the inner
  cliff. **The slide is the player-select screen** when RD Arena starts a fresh session. NEW.
- **Loop direction:** less roguelite, more like ULTRAKILL, or a medieval 2D flesh escape that evolves, with 2 to 4 choices per player that bend their path. Loop
  needs a lot more refining. Everything else in the RD Arena docs still stands.

### 2.3 New concept: Hurl satellite rail shooter

A satellite rail shooter that fires lasers, missiles and other resources at the Hurl to weaken
it, set before the RD Arena chapter. NEW. Would sit in Act III next to RD Arena.

### 2.4 New concept: EIEI Aliens

A farmer shoot-'em-up with aliens rushing the farm. NEW. The transcription says "the cabin is
underdeveloped but fits into the game well"; that may mean an existing concept file or the
farm cabin as the thing defended. Needs a chronology slot (it reads like Act I Landfall or
Act II Spread).

### 2.5 New concept: Desert Code Racer

Sketch: `concepts/desert-code-racer-sketch.jpeg`.

An Atari-style racer, graphics closest to *Major Havoc* (Atari, 1983) colour vector, set on
the Black Rock Desert or Area 51. The rider is on a cyber bike, carrying interplanetary missile
launch codes across the desert to the other base; an EMP has killed comms, so this is the only
way. The alien mothership hangs on the horizon and fires intelligent beams at the rider.

From the sketch: third-person behind the bike on a road narrowing to the horizon; mountains
behind; the mothership (wide wedge, black underside with a red rim, a second smaller ship upper
left) fires dotted homing beams that weave down the road; red scorch rings mark beam strikes or
hazards; an explosion where a beam lands; cacti and scrub at the roadside; speed readout bottom
left ("400 MPH"). The right sidebar is the route map: start at a geodesic dome base at the
bottom, a dotted route winding up through mountain ranges, past checkpoints, to the destination
base in the mountains at the top. That sidebar already satisfies §4.11a.

Fit: PARTLY. This is the "code racer" chapter already in the chronology (Act IV Launch, carrying
codes to a mountain base, before Cliff Run), previously noted as a rebuild of Cyber Desert
Racer. Cabinet type would be VECTOR.

---

## 3. Story notes

Recorded in project memory (hub chronology) as well as here.

- RD Arena = the Belly of the Beast chapter, inside the Manhattan Hurl (see 2.2), with a cult
  of collaborators and the crew's hive-mind gamble. Placement conflict noted in 2.2.
- New beat: weakening the Hurl from orbit (2.3), before the crew goes in.
- Desert Code Racer carries the launch codes (2.5); the EMP is new lore.
- EIEI Aliens needs a slot (2.4).

---

## 4. Calls for Ry

1. Apply any of the standards rewrites R1-R11? (R7 board size, R10 round length and R11 couch
   play are the ones that change existing rules.)
2. Couch play: foundation now, or someday idea?
3. Gyro Space notes go to Gyro Fleet, not Space Tracer: right? (Siphon currency, three-site
   structure and hold-right-click thrust were answered 2026-11-13; see §2.1.)
4. Gyro classes: drop "Auto", or keep it as a mode?
5. RD Arena: move it near the end, or keep it in Act III and add a late level?
6. RD Arena rollback: repoint the hub card at `rd-arena.pre-mp/`?
