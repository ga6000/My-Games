---
name: hub-gameplay-review
description: Review a My-Games hub game's gameplay loop against the hub's arcade pillars (Robotron, Bosconian, Rally-X), the 2–5 minute session goal, and distinctness from commercial games and from the other hub games. Use when designing, trimming, balancing or promoting a hub game; when changing its core loop, scoring, win/lose conditions, difficulty curve, enemies, objectives, session length or restart flow; when choosing which shelved game to promote; or when the user asks whether a game is "arcade", fun, addictive, or too similar to another.
---

# Hub gameplay review

DRAFT v0.1 (2026-10-09). The pillar list was agreed with the user on 2026-10-09 as "a great
start". The user's estimate: **if every game had these, the hub would be 70% there.** Refine the
list from the Lessons log, not ad hoc.

## The goal, in one sentence

> Does this game deliver the "one more go" pull of a 1980s arcade cabinet inside a 2–5 minute
> session, with an idea that belongs to no commercial game and to no other card on the hub?

That sentence has three tests in it, and each gets its own section: **the pillars** (§2),
**the arcade gate** (§3a) and **distinctness** (§3b–3d).

## 0. Rules of engagement

- **A review produces findings, not features.** `SCOPE_RULES.md`: the playtest gate (rule 5) and
  the inbox (rule 9) still hold. Recommendations go to the user ranked. Unasked-for builds go to
  `IDEAS_INBOX.md` as one line each.
- **Poke holes, including in the user's framing.** The user asked for this explicitly. If a pillar
  doesn't fit a game, or two games are the same game, or a "goal" works against another goal,
  say so plainly.
- **Measure what can be measured.** Time to first threat, session length and restart time come
  from the code or a run, not from memory. Fun can't be measured headless. Say which findings
  need a playtest.
- **Name the game and the `HUB_RETROSPECTIVE.md` §5 item** any resulting plan would close (root
  `CLAUDE.md`).

## 1. What to load

- `SCOPE_RULES.md` rule 0 (2–5 minutes), `HUB_RETROSPECTIVE.md` §3–5.
- The game's `<game>/CLAUDE.md`: its loop, its numbers, its playtest notes.
- The code for the numbers in §2: intro length, spawn curve, win/lose checks, restart path.
- For §3b: the first ~30 lines of each other board game's `CLAUDE.md`, plus any shelved game
  being compared (`under-development/<game>/CLAUDE.md`).
- Memory: `hub-short-sessions-goal`, and anything pending for the game.

## 2. The pillars

For each pillar give:
- **Applies?** Yes / Partly / No, with one line of why. "No" is a valid answer, and saying so is
  part of the review. 4D Pong has no off-screen world, so pillar 9 doesn't apply.
- **Score, 0–3, only if it applies.** 0 = absent, 1 = present but weak or buried, 2 = solid,
  3 = it defines the game.
- **Evidence:** a number, a file or function, or "playtest needed".

The total is reported as **points / (3 × applicable pillars)**, so a game isn't penalised for
pillars that don't apply to it.

### Getting in and out
1. **Instant start, learn by dying.** Under ~5s from click to first real danger. No tutorial text;
   the first death teaches. *Test: seconds from click to the first moment the player can lose.*
2. **Controls fit in one sentence.** *Robotron: move, shoot. Rally-X: steer, smoke.* *Test: write
   the sentence. Count the keys a new player must know.*
3. **Fast, fair, your-fault death, and an instant restart.** Death is never confusing. The loss
   screen is a short beat, not a menu. *Test: seconds from death to the next run's input.*

### Pressure and rhythm
4. **Pressure that keeps building.** No lull longer than a few seconds. The difficulty curve is
   felt within one run. *Test: the spawn or threat curve's shape. The longest calm stretch.*
5. **Tension and release in short cycles.** A wave or objective resolves every ~30–90s, with a
   breath and a fanfare, then it escalates. *Robotron waves, Bosconian base clears.*
6. **A clock you can't ignore.** A visible, felt resource or timer that forces movement. *Rally-X
   fuel, Bosconian's Condition Red.*

### Readability
7. **Readable chaos.** A full screen where every threat is told apart at a glance by shape,
   motion and colour. Cross-check with `hub-visual-review`.
8. **Few enemy types, each with one clear behaviour, that combine badly for you.** *Grunts rush,
   Hulks are unkillable, Brains convert humans.* *Test: list the types and their one verb each.*
9. **Know where things are off-screen.** The radar is a play tool (cabinet panel, §4.11a).

### Reward and greed
10. **Greed against safety.** The best points sit in the most dangerous place. *Robotron's
    escalating rescue bonus, Rally-X's special flag.*
11. **Score climbs faster with skill.** Chains, multipliers and bonuses, so a better player's score
    pulls away visibly rather than by a fixed amount.
12. **One emergency button.** A limited panic tool that is right to save and right to spend.
    *Rally-X smoke, Robotron's lack of one (a deliberate absence counts as a design choice).*
13. **The score as a public target.** HI-SCORE visible from the start, initials, a leaderboard.

### Feel and depth
14. **Every action makes a sound; danger has a voice.** *"Condition red!"* Rising audio as the
    wave thins.
15. **Easy to learn, worth mastering.** Patterns and strategies that only show by run 5, so run 10
    plays differently from run 1.

### The hub's own
16. **Something to share with friends.** For a group of 3–10: moments to call out, rescues,
    rivalries, "last one standing". Solo-only games score this as how the score table carries it.
17. **Its own core action.** No other card on the board shares its core verb. Scored in §3b, not
    by feel.

## 3. Distinctness

### 3a. The arcade gate

Answer each with yes/no before calling it an arcade game:
- A complete session (win or loss) fits in 2–5 minutes.
- Pillars 1, 3 and 4 each score at least 2.
- There is a score that a better player reliably beats (pillar 11 or 13 at 2+).
- The core loop works with no menu between runs.

**Verdict:** ARCADE / ARCADE-ADJACENT (name what's missing) / NOT ARCADE (name the genre it
actually is). A NOT ARCADE verdict is a finding for the user, not a failure: it may be long-game
material (`SCOPE_RULES.md` rule 7).

### 3b. The hub fingerprint

Fill one row per board game. Include any shelved game the user names, or one that might be
promoted. Read the fields off the code.

| Field | Values (examples) |
|---|---|
| Camera | top-down follow / fixed screen / side / first-person |
| Body | on-foot avatar / ship / vehicle / paddle / none |
| Core verbs | move+shoot / steer+dash / jump / bounce / build |
| Threat | AI swarm / players (PvP) / environment / clock |
| Objective | survive / clear / collect / race / reach / defend |
| Structure | single run / waves / rounds / endless lives |
| Social | co-op / versus / free-for-all / solo with a board |
| Upgrades | none / pickups / perks or cards |
| Unique hook | the one thing only this game has |

**The overlap rule:** two games sharing **camera + body + core verbs + threat** are the same game
to a player, whatever their hooks say. Flag the pair and offer the user these resolutions:
merge, differentiate (name which field to move, and to what), or shelve one. Overlap with
a *shelved* game matters only when it is up for promotion.

### 3c. The commercial lineage

- Name the 2–3 nearest commercial games, arcade or modern.
- Write **the sentence**: "In *this* game you ___, which *X* never lets you do." If it can't be
  written without leaning on the setting or the art, the game isn't conceptually distinct yet.
- Borrowed *mechanics* are fine (every pillar above is borrowed). A borrowed *premise plus loop*
  is not.

### 3d. Poke a hole

End the section with at least one challenge to the user's framing or to the game's premise. For
example: a pillar that fights the 2–5 minute goal, a co-op design the pillars quietly push toward
solo, or a hook that is really an art direction.

## 4. Output

Write the full review to `.claude/skills/workshop/<date>-<game>.md` when it is part of a workshop
round. In chat, give:

```
GAMEPLAY REVIEW — <game>
Arcade gate: ARCADE | ARCADE-ADJACENT (<missing>) | NOT ARCADE (<genre>)
Pillars: <points>/<max> over <n> applicable
Strongest: <pillar #s>   Weakest: <pillar #s with one line each>
Distinctness: hub overlap <pairs or none> · commercial <nearest> · the sentence: "<...>"
Hole poked: <one line>
Top 3 changes, ranked by pillar gain per effort: <...>   (the rest → inbox)
Needs a playtest to judge: <pillars>
```

Then the usual closing numbered questions.

## Lessons log

Append one dated line per finding from workshopping. Promote a repeated lesson into the procedure.

- 2026-10-09 — v0.1 drafted from the agreed pillar list. First workshop round: Zombie Arcade and
  Space Tracer.
