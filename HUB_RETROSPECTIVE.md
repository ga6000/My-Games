# The hub, looking back — and what "done" looks like (2026-09-27)

A short reflective record, not a plan. It covers where the hub started, how the creative
direction moved, where it stands now, and a proposed definition of **Hub 1.0**. The rules that
keep it there are in `SCOPE_RULES.md`. The Zombie separation is `zombie/THE_SPLIT.md`.

---

## 1. Where it started (July)

The first commit was on 2026-07-17. For its first month the repo was a folder of **single-file
HTML prototypes** uploaded through the GitHub web UI. The history for that stretch is mostly
"Add files via upload" and "Delete X.html". There were around 18 concepts, a card grid to open
them from, and a lean toward phones: `gyro-space/` is named after tilting a phone to steer. Each
game had its own look, and few could be played together.

## 2. What it grew into

**The infrastructure era (mid-August → early September).** The hub turned from a folder of toys
into a platform:

- one-folder-per-game (08-24)
- a single shared `ws` server with a generic `relay`, so new games need no server changes
- `game:code` rooms, server-issued room seeds, and server-side name-hash identity
- a Firestore leaderboard
- a hub lobby with votes and a ready-check
- a shared layer (`retro`, `sfx`, `leaderboard`, `devtools`)
- checkers that stand in for the type system the repo doesn't have

Most of the repo's hardest lessons are from this stretch, and most of them are now enforced by a
script rather than remembered.

**The pullback (2026-09-04).** The board went from 17 to 5 cards, mobile was switched off, and
the tracking sheet dropped the columns nobody would ever fill. That turned an open-ended list into
a finite one, and the finite list was **closed in three days**: every live game was split, skinned
and given audio by 09-06.

**The Zombie era (2026-09-18 → now).** With the board settled, the energy went into Zombie:

- a playtest pass, then intensify, map revamp, container maze, adjustments, the twelve map proposals
- a visual audit, then stamps, the map editor, and the train
- **32 of the 42 commits since 09-18**

Zombie is where the craft grew fastest, and also where the scope stopped being finite.

## 3. How the creative direction shifted

| From | To | When |
|---|---|---|
| Many prototypes | A curated board of five | 09-04 |
| Phone toys | Desktop game nights for a friend group | 09-04 |
| Every game its own look | One arcade system: black ground, Vector / Raster / Gel cabinets, three signal colours, a world hue per game | 09-04 → 09-06 |
| "Does it run?" | "Does it play together, from a cold open, for the group?" | Throughout August |
| Zombie as a wave shooter | Zombie as a causal chain (generator → silos → flood → out), then a train, then a world | 09-18 → 09-26 |
| Zombie as a hub cabinet | Zombie as the seed of an indie game | 09-27 (this document) |

The last row is the important one. **The hub's identity is the arcade**, and Zombie is the first
game to outgrow it. That's the hub working as an incubator, and nothing has gone wrong. The
mistake would be letting the outgrown thing keep reshaping the cabinet it was built in.

## 4. Where it is now

**All five cards open something that runs.** The tracking columns are essentially closed:
`COLUMN_COMPLETION_ROADMAP.md` shows ✅ everywhere on the board except two leaderboard cells that
are open by decision (RD Arena, and 4D Pong, which has no number to submit).

**Docs have drifted again in two places.** This is the exact failure mode root `CLAUDE.md`
describes:

- **RD Arena has multiplayer.** `rd-net.js` has been in the game since 2026-09-08, merged
  2026-09-19. The `PROJECT_MEMORY.md` board table and the roadmap still say `No`.
- **Root `CLAUDE.md` said `AESTHETIC_GUIDE.md` was "not implemented yet"** (corrected 2026-09-27). Every hub page now
  carries `data-cabinet`, and the fonts are embedded.

**The real remaining debt is playtesting, not building.**

| Game | Human play in its current form? |
|---|---|
| Zombie | Train playtested 2026-09-26. The fix plan (`zombie/PLAYTEST_2_PLAN.md`) is open |
| Space Tracer | Yes — the longest-stable game on the board |
| Glass City Escape | Run log built for a playtest that is **still awaited**. Multiplayer past level 1 has never been played by the group |
| RD Arena | v2 is **not yet playtested by a human** (`PROJECT_MEMORY.md`), and its multiplayer isn't either as far as the docs record |
| 4D Pong | **Never played by four real humans** |

## 5. What "complete" looks like — proposed Hub 1.0

The hub is complete when all of these are true:

1. **Every card has been played by the group, together, launched from the board**, in its current
   form. Playtest findings are fixed or written down as known and accepted.
2. **ZOMBIE (the hub game) is at its v1.** The arcade-side playtest-2 fixes have landed. A winning
   run fits one sitting, timed once with the group. After that it's fixes and balance only
   (`zombie/THE_SPLIT.md`).
3. **No known bug ends a session.** Cosmetic issues and lesser bugs can stay on a short
   known-issues list.
4. **The docs describe a finished thing:**
   - completed plans move to an archive folder
   - `PROJECT_MEMORY.md` board table matches the code
   - each game's `CLAUDE.md` stays as the reference
5. **Tag it** `hub-1.0`. From there the hub is in maintenance mode, and the board changes only by
   one-in, one-out.

**Deliberately not in 1.0:**

- the signal-colour palette re-solve (a server + client change for a subtle ΔE issue)
- the RD Arena leaderboard
- any shelved game
- any new Zombie system
- anything from `IDEAS_INBOX.md`

## 6. Why it's closer than it looks

Nothing on the 1.0 list needs a new system. Items 1 and 2 are mostly **evenings with the group**
plus the fixes they turn up. Item 4 is a single tidy-up session. A realistic path:

1. **Zombie arcade-side playtest-2 fixes** (already planned and underway).
2. **One game night per two games.** Play them, fix what breaks, play again. Three or four nights
   should cover the board.
3. **One reconciliation session**: fix the RD Arena row above, archive the finished plans,
   tag `hub-1.0`.

**What makes this feel further away than it is:** the Zombie scope sat inside the hub's finish
line. Once the long game has its own home, the hub's remaining work is short and finite.

## 7. After 1.0

- **The hub**: maintenance. It's a finished, playable cabinet row for the group, and still worth
  opening on a game night.
- **The long game**: begins in its own home with its own rules, starting from what Zombie
  taught, not from Zombie's grid.
- **The shelf**: 13 games stay in `under-development/` and come up one at a time, only by trading
  places with a card on the board.
