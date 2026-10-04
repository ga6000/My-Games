# Scope rules (2026-09-27)

Standing rules, not a plan. They exist because scope here has grown the same way three times:

1. the board grew to 17 games,
2. Zombie had four feature passes in three days (2026-09-18 → 09-20) before the group played any
   of them,
3. Zombie's design docs grew into a second game (`zombie/THE_SPLIT.md`).

The 2026-09-04 pullback worked because it turned an open-ended list into a finite one. These
rules keep lists finite.

---

## The rules

1. **Every project is in one of two modes: building toward a written finish line, or
   maintenance.** The hub's finish line is `HUB_RETROSPECTIVE.md` §5. When it's met, the hub goes
   to maintenance: fixes, balance and playtest follow-ups only.

2. **Ideas go in the inbox, not in plans.** `IDEAS_INBOX.md` takes one line per idea, with a date
   and which game it's for. Writing an idea down doesn't commit anyone to it, so ideas stay cheap
   and welcome. **A plan file is only written for an inbox item that has been pulled against the
   finish line.**

3. **Every plan's first two lines answer:**
   - *Which game?* Hub ZOMBIE, the long game, or another hub game.
   - *Which finish-line item does this close?*

   If there isn't one, it goes back to the inbox.

4. **One open plan per game.** Before a new plan opens, the last one is done and playtested, or
   explicitly abandoned with a dated note.

5. **Playtest gate.** A hub game gets no new feature pass until the group has played the previous
   one. Headless and two-client verification prove it runs, not that it's fun.
   `PROJECT_MEMORY.md` still carries "not yet playtested by a human" on several rows.

6. **One page for a proposal.** When the analysis is longer than the feature, that's a symptom.
   `DESIGN_IDEAS.md` + `DESIGN_IDEAS_2.md` alone are ~1,700 lines.

7. **Too big for the hub means route it, not cut it.** Anything that needs persistence, more
   than one sitting, or a new foundation (engine, level format, build step) goes to the long game
   or the inbox. That makes "no" easy to say to the hub.

8. **Promotion is one-in, one-out.** The board stays at five cards (the 2026-09-06 swap is the
   model). A shelved game comes up only by trading places with one on the board.

9. **For Claude sessions.** Do exactly what was asked. Adjacent improvements, "while I'm here"
   ideas and follow-on features go into `IDEAS_INBOX.md` as one line and get mentioned in the
   reply. Don't build them, and don't write plans for them.

## Review

At each finish-line milestone, and otherwise every couple of weeks, read the inbox top to bottom.
Promote **at most one** item, and delete the lines that no longer excite anyone.
