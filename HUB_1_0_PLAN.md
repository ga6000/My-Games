# Hub 1.0 — the phased plan (2026-10-03)

**Which game:** the hub as a whole: all five cards, ZOMBIE included. The long game only appears in Phase 6, after 1.0.
**Which finish-line item:** all of `HUB_RETROSPECTIVE.md` §5. Each phase names the item it closes.

This plan pulls together three sessions: the map-authoring work (`zombie/SESSION_CONTEXT_MAP_AUTHORING.md`),
the evacuation train (`zombie/TRAIN_RAIL_PLAN.md`, `zombie/PLAYTEST_2_PLAN.md`) and the scope
decisions (`zombie/THE_SPLIT.md`, `SCOPE_RULES.md`). Per `SCOPE_RULES.md` rule 4 it is the one open
hub plan. **`zombie/PLAYTEST_2_PLAN.md` is absorbed:** its Phase 1 and §6.4 become Phase 1 here, and
the rest is re-sorted below. That file is kept as the record of what the playtest found.

---

## Phase 0 — Paperwork · §5 groundwork · **done 2026-10-03**

- The 2026-09-27 scope docs are committed (`SCOPE_RULES.md`, `IDEAS_INBOX.md`, `HUB_RETROSPECTIVE.md`,
  `zombie/THE_SPLIT.md`, plus the `PROJECT_MEMORY.md` entry and the `zombie/CLAUDE.md` banner).
- `zombie/PLAYTEST_2_PLAN.md` is committed unchanged, as a record. Its owning session
  ("Zombie game design review and reorganization") had been idle since 2026-09-26, and nothing in
  the file was built.
- doc-sync: only the docs that were actually re-read get stamped. The four repo-wide docs cover
  every game, so they wait for Phase 5's reconciliation.

## Phase 1 — Bugs that end a session · §5 item 3

1. **Fixed-timestep loop + a background tick for the host.** A host tab in the background got no
   `requestAnimationFrame` calls, so the whole room froze and showed CONNECTION UNSTABLE.
   `setInterval` keeps it alive (a Worker is not an option, because Workers can't be created
   under `file://`).
2. **Audit the other four cards** for the same "hidden host freezes the room" fault, and record
   what each one does.
3. **Dev buttons that advance each step of the Zombie chain**, so later phases can be tested in
   seconds.

## Phase 2 — ZOMBIE arcade v1 fixes · §5 item 2

**Waiting on the scope decision below.** If the rail goes, most of `PLAYTEST_2_PLAN` Phase 2/3/4
goes with it, and this phase becomes "remove the rail and the walls, put a new win condition in
its place".

- The goal list must not jam when steps are finished out of order (`PLAYTEST_2_PLAN` §6.3).
- Map-editor leftovers that are cheap: the Pump House stamp, the freeze-adds-a-crate bug.

→ **Game night 1:** ZOMBIE, with a timed winning run.

## Phase 3 — ZOMBIE fixes from game night 1 · §5 item 2

Only what the night turns up. Candidates: minimap, floor tints, door/window art, zombie separation
(measure first).

## Phase 4 — The other four cards · §5 items 1, 3

RD Arena (never played by a human, MP included), 4D Pong with four humans, Glass City past level 1,
Gyro Space. Fix only bugs that end a session; everything else goes on a known-issues list.

## Phase 5 — Reconciliation · §5 items 4, 5

Fix the RD Arena MP row, archive finished plans, reconcile and stamp the repo-wide docs, write the
**lessons-for-the-long-game** doc, then tag `hub-1.0` and the Zombie fork point.

## Phase 6 — The long game, step 0 · after 1.0

Name and home, then engine, then a test of the level representation, in that order.

---

## Open: the arcade scope cut (raised 2026-10-03)

The user proposes that arcade ZOMBIE **loses all rail elements and most walls**. This is being
discussed and is **not decided**. Once it is, it gets recorded here, in `zombie/THE_SPLIT.md` §3,
and in `PROJECT_MEMORY.md`.
