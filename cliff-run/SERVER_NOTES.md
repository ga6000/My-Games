# Cliff Run — multiplayer considerations

**Nothing in this file is implemented.** The user asked for the considerations to be written down
and the wiring left out, so this is a note, not a plan: no `MP` message types, no host election,
no Firestore beyond the existing `LB.submit` call at run end.

What IS wired today is identity only (`cr-boot.js`, `GameInstance.init`): `MP.connect` is called so
that the colour a player wears on the cliff is the colour they wore on the board.
`MP.selfColor` wins when there is a server; `IDENTITY.colorFromName` is the `file://` fallback and
is the **only** name→colour path in this game, per the root `CLAUDE.md` hard constraint.

Read `MULTIPLAYER_PLAN.md` §1–§3 before any of this — one shared server, `game:code` rooms, a
generic `relay`, room seeds and host election are current and authoritative there. §4's per-game
sections are dated.

---

## 1. What this game makes easy

**The level is already a pure function of a seed.** `crLevelSpec(index)` derives everything from
`CR_BASE_SEED + index * 7919`, and `crBuildLevel` is deterministic given that seed. So the room
seed replaces one constant and every client builds the identical cliff — no level data on the wire,
ever. `MP.reseed` / `MP.random` already exist for exactly this.

**The simulation is a fixed timestep.** `cr-boot.js` runs `crStep` at a fixed 1/120s from an
accumulator, so two clients given the same inputs produce the same frame. That is the precondition
for anything lockstep-shaped, and it was built that way for a local reason (a variable step made
the generator's jump-reach margins a function of the monitor refresh rate).

**Seats are already abstract.** `crMakeBody(seat, name, isBot)` is one struct whose `inp` is
written either by the keyboard or by `crBotThink`. A network writer is a third writer of the same
four booleans. There is no human-only code path to carve out — that is what makes the attract-mode
demo the real game, and it is the same property a remote seat would need.

---

## 2. What this game makes hard

**The grid mutates, and it mutates from player actions.** Collapsing blocks (`crTouched`), bombed
walls (`crDetonate`) and falling debris all change `level.tiles` in response to someone touching
something. Two clients that disagree by one frame about when a block was touched will disagree
about whether it is still there, and the divergence is permanent — unlike a position, a deleted
tile never resynchronises itself. **This is the real decision in networking this game**, and there
are three honest answers:

1. **Host-authoritative tile state.** The host owns `crTouched`, bomb detonations and the tile
   array; guests send input and render what they are told. Safest, costs a round trip on every
   collapse, and makes a laggy host visibly wrong about the ground.
2. **Host-authoritative world, client-predicted self.** The usual answer. Guests simulate their own
   body locally and accept correction; tile events are host-only and arrive as `{k:"tile", col,
   row, code}`. This is the one worth costing properly.
3. **Deterministic lockstep.** Tempting, because the sim already is deterministic — but it needs
   input delay, and `SCOPE_RULES.md` rule 0's 2–5 minute session on a free Render tier is not where
   to find out how that feels.

**Player-vs-player collision is the whole point and it is the worst case for prediction.**
`crResolvePairs` makes bodies bouncy by design, so a mispredicted peer position does not just look
wrong, it *moves you*. Any prediction scheme has to decide whether a remote body can push a local
one, and "yes" means rubber-banding on every contact. A defensible first cut: remote bodies are
walls (`crIsWallBody`) for a local body but never launch it — i.e. keep case 2 of the three
collision cases and drop cases 1 and 3 for remote pairs, host-resolved instead.

**The camera is shared state.** `crCam.x` advances at the level's scroll speed *and* is dragged
forward by whoever is in front, and `crAvalancheX` follows it. So the thing that kills you is a
function of the *leader's* position: the camera must be host-owned and broadcast, or two clients
will disagree about who the avalanche caught. This is cheap to send (one float) and must not be
predicted.

---

## 3. Message shapes, if and when

Sketch only, in the repo's existing `relay` style — the server needs no change for any of it
(`MULTIPLAYER_PLAN.md` §3).

| `k` | from | carries | rate |
|---|---|---|---|
| `pos` | everyone | `x, y, vx, vy, face, flags` | ~10/s, through `MP.canSend("pos", 100)` |
| `cam` | host | `camX, avalancheX` | ~10/s |
| `tile` | host | `col, row, code` | on change only |
| `bomb` | host | `x, y, fuse` and the blast | on event |
| `fate` | host | `seat, "fall" \| "avalanche" \| "finish", place` | on event |
| `level` | host | `index, seed` | on level change |

**Deaths and finishes must be host-only.** They are the only irreversible events in the game — a
player who did not continue to the next level cannot be un-killed — and a victim-reported death is
exactly the shape Gyro Space's score attribution has (`GAME_PROTOTYPE_INSTRUCTIONS.md` §3 records
that as a deliberate scope call for a friend group). It is fine there because a wrong kill costs a
point. Here it costs the rest of somebody's run, which is a different trade.

**Bots fill empty seats and the host owns them.** `crBotThink` already runs per body; the host
simply keeps running it for unoccupied seats and broadcasts their `pos` like any other. That is the
natural fit for the spec's "players 2-4 are bots for now", and it means a four-player room and a
one-player room run the same code.

---

## 4. The win announcement

The spec is specific: *"if at any point there are only bots alive the game should end and the
player character winner is announced if multiple are playing online."*

`cr-boot.js` implements the single-player reading today: the run ends the moment seat 0 dies, and
`crDecideWinner` ranks on levels cleared, then score. **With real players that condition changes
meaning** — it must become "no HUMAN seat is still alive", not "seat 0 is dead", and the
announcement is then a `fate`-style broadcast naming the winning human. A player parked on a
catwalk is alive and waiting, which is already handled (`crCheckFate` returns early for a finished
body) and must stay handled: the finish is not a death.

---

## 5. Cross-game rewards

Noted here because the inbox lines (`IDEAS_INBOX.md`, 2026-10-17) point at this file.

Cross-game unlocks need per-player *persistence*, which this repo does not have: identity is a
name hash with no account behind it, and `shared/leaderboard.js` is effectively write-only from a
game's point of view. So an unlock is not a server message, it is a stored fact, and the three
candidate homes are:

- **`localStorage`, per device.** Free, works on `file://`, and wrong the moment somebody plays on
  a different machine — which the 2026-10-16 inbox lines record as already biting the leaderboard
  (an iOS Home Screen install has its own empty storage).
- **Firestore, keyed by the anonymous auth uid.** The 2026-10-16 inbox line about storing that uid
  on each score is the same groundwork, so these two want doing together.
- **The WebSocket server.** Wrong shape: it is live coordination, not persistence, and
  `GAME_PROTOTYPE_INSTRUCTIONS.md` §3 is explicit that final-state persistence goes to Firestore
  directly from the client.

Whichever it is, the reading side belongs in `shared/` — one place that answers "has this player
finished X", the same discipline `shared/identity.js` established. Four games each with their own
copy of that lookup is the four-name→colour-functions mistake again.
