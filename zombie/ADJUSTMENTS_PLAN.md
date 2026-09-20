# Zombie — the 14 adjustments

User batch, 2026-09-20, after playing the map revamp. Written before editing, per the root
`CLAUDE.md` rule about multi-file changes.

Branch: `zombie-container-maze` (this work continues on it; `main` is at `d7103a0`).

---

## 0. Item 2 first — the leaderboard, and what is actually wrong

Reported as "any scores at all are not being shown on the scoreboard". **Measured, not guessed:**

| Check | Result |
|---|---|
| `leaderboard.html` reads | **work** — Gyro Space shows all 182 runs |
| Docs in `scores` | **182**, every one `game: "space-tracer"` |
| Docs with `game: "zombie"` | **ZERO. Ever.** |
| Newest doc in the collection | **today**, so writing is not globally broken |
| Anonymous sign-in from localhost | **succeeds** |
| Zombie's client path | **correct** — `LB.available()` true, `LB.submit` fires once with `{player, room:"public", score:7200, round:12}`, `zLbSubmitted` guards the repeat |
| Writing a test doc from localhost | **permission-denied for every game id**, including `space-tracer` |

So: **the page is fine and the game is fine.** Writes are refused by something outside the repo.
The last line is the important one — localhost cannot write *at all*, so the live write path
cannot be tested from here, and the Firestore rules live in the Firebase console, not in git.

Two things follow, and only the second is mine to do:

1. **A console job for the user.** Gyro Space wrote today and Zombie has never written once, so the
   rules are the first place to look, and the likeliest specific cause is the `round` field added
   on 2026-09-19 — which `PROJECT_MEMORY.md` flagged as an unchecked risk at the time: *"if they
   whitelist field names, the extra `round` field would make Zombie's writes fail."* Every one of
   the 182 stored docs predates `round` and none carries it.
2. **A code fix that makes it not matter.** `LB.submit` writes `round` as part of the doc, so a
   rules whitelist rejects the whole run. It should **retry once without `round`** on a rejected
   write. The score still lands; only the round column is lost, and `readZombieRun()` already
   understands a doc with a score and no round. A leaderboard write must never be all-or-nothing
   over an optional field.

Also: `write()` swallows the failure into a `console.warn` nobody reads. It should say plainly
which game and which doc failed.

---

## 1. Intensify: drop the round-end report

`endRound` shows the scoreboard/report card for `ROUND_BREAK_MS`. Intensified, rounds roll over
so fast that the readout is up for most of the early game. **While `intensified`, skip it** — the
blitz is meant to be uninterrupted, and the same information is on the end card.

## 3. The final score: ESCAPED and WIN DOUBLES IT are one thing

`renderRunScore` lists `ESCAPED +50,000` and `WIN DOUBLES IT ×2` as two rows, which reads as two
unrelated bonuses. Collapse to **one** row whose value is the whole effect of winning:
`(sub + SCORE_WIN) × 2 − sub`. Same total, one idea.

## 4. Below the south gate: an opening with columns

On the win sequence the player is drawn south and appears to fly *over* the perimeter wall. The
wall below the escape should have a real **gap** the width of the gate, with a **column either
side**, so the walk-out goes through an opening. Geometry only — `escapeRect` and the gate art do
not move.

## 5. The south-east corner: fewer culverts

Zombies wedge pathing round the SE hard corner, and the openings there make the area
undefendable. **Reduce the culvert count by one** and keep them clear of the corner itself. Re-run
the frontier measurement afterwards: culverts exist because walling two sides halves the spawn
frontier, so removing them is not free.

## 6. The SUPER SPLITTER replaces the ULTRA HEAVY

The biggest item. Same 30 HP and the same slot in the spawn tables; everything else is new.

- **Form**: square-based like every other zombie, with smaller squares *attached* to it that
  squelch — spawnlings crawling on the body.
- **On every shot that damages it**: spawns a spawnling, and drops a standard splitter as it
  takes damage.
- **On death**: **20 ULTRA SPAWNLINGS** (faster than standard) thrown out in a **fan in the
  direction of the killing shot**, which fly, *land*, and only then target the player.

The fan is the part with no precedent in this codebase — nothing else has a zombie that is not
immediately pathing. Needs a `launch` phase on the zombie (velocity + a landing deadline) that
`updateZombies` skips pathing for, and it has to cross the wire, because the host owns zombies.

`ZOMBIE_TYPES.ultra` is a **wire index** (`Z_TYPE_KEYS`, append-only). Replacing it in place is
correct — the index keeps its meaning — but `armored` and the octagon draw go with it.

## 7. The SUPER SPLITTER gets its own round

Like the Horde and Brute rounds: one on its first appearance, more on later ones, and it can turn
up on ordinary rounds too. Sits alongside `isHordeRound`/`isBruteRound`.

## 8. The intensify switch moves to the keep's right corner

Currently centred on the south wall. Move it to the **east corner**, still far from the manual.

## 9. THEY HEAR YOUR CALL — a sharper, scrawled face

Courier is too neat for it. Wants a jagged, hand-scrawled look. **No web fonts** (the `file://`
constraint and `AESTHETIC_GUIDE` §3.2), so it has to be done with what is already there: a
condensed heavy stack, aggressive negative letter-spacing, a per-letter random rotation and
baseline jitter, and a double-struck offset copy in a darker red. Drawn per letter rather than as
one string.

## 10. The siren, and the music after it

- **Siren**: slower and echoing — a *nuke* siren, not a klaxon. Longer sweep period, a long
  feedback-delay tail, and a lower fundamental.
- **The intensified score**: closer to **high-paced drumming**. Faster kick/rim pattern, and
  **drop the intermittent tones** — the sparse bell chord tones go.

## 11. Walk under the gantry crane

Its legs are currently solid. Remove the collision entirely so the whole thing is overhead, which
is also what it looks like.

## 12. Rail cars in THE KENNELS

The Motor Pool's flatcar reads well. Reuse it — **plus a vertical version** — mixed with shipping
containers to fill THE KENNELS with claustrophobic hallways. That replaces the current pens/run
layout there, and the run stays as the one straight lane.

## 13. Buildings should be BUILDINGS

The largest visual item. Today a building is a box with different floor inside. Wants:

- **Stairs**, drawn top-down
- **Internal geometry** — tables, chairs — implying rooms
- **1-wide windows**, breakable by zombies (so: barricades, not walls)
- **A doorway entrance and exit**, not a missing wall
- **Asymmetric** footprints, not a box with symmetrical openings
- **Use matched to the sector** where it makes sense

## 14. Sector walls: centreline alignment

**Answer: no, they should not be, and the doubling is real.** `zoneBoundaryRuns()` sets
`fixed = (c+1) * ZONE_CELL_W - WALL_T / 2`, centring a 20px wall on the boundary line. Two
consequences:

- Runs that meet at a corner **overlap** in the 20×20 square at the junction, so that square is
  drawn twice (harmless for collision, visible as a double-dark block).
- A vertical run's end and a horizontal run's end **do not meet** — each stops at its own
  centreline, leaving a 10px notch.

Fix: keep the centreline for the wall's *position* (moving it would shift every door and window),
but **emit corner-filling segments** so junctions are square, and **clip runs** so no two segments
occupy the same pixels. A post at each junction is both the cheap fix and the better look.

---

## Order of work

1. **2** (the leaderboard fallback) — it is a live bug and it is small.
2. **1, 3, 8, 11** — one-liners and small edits.
3. **14, 4, 5** — boundary and perimeter geometry, all in `zombie-level.js`.
4. **9, 10** — the announce set piece.
5. **12, 13** — the building and sector work.
6. **6, 7** — the SUPER SPLITTER, last because it is the largest and touches the wire.

Verify after each group: the four checkers, the map sweep, the nav-reachability harness, and the
browser. The traversal measurement is required again after **12** and **13** — both add interior
geometry, which is what the pipe runs and the forest each broke once already.
