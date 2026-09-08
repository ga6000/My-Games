# 4D Pong — online play

**Written 2026-09-06, before any edit**, per root `CLAUDE.md`'s cross-file rule. Target: three
friends playing over the internet **tonight**, which is what decides most of the trade-offs below.

Supersedes this game's "couch multiplayer, deliberately final" note in `MULTIPLAYER_PLAN.md` item
9 (written earlier the same day). That note was right about the game as it then existed and is now
wrong; it gets marked superseded rather than deleted.

---

## 0. The one thing that decides whether this ships tonight

**No server change is needed, so there is no Render deploy in the critical path.**

`MULTIPLAYER_PLAN.md` §1–§3 is the current, authoritative part of that document, and it says the
server relays a generic `relay` message **untouched** — games define their own payload shapes and
need no server change to add one. `shared/mp-core.js` confirms it in code: `MP.send(payload)`
wraps anything in `{type:"relay", payload}`, and the receiving side gets it via `onMessage`.

Everything below is therefore client-side only, in this repo, testable locally. The separate
`gyro-space-server` repo is not touched and does not need redeploying.

---

## 1. Which model, and why not the other one

Glass City Escape's model (§4b: parallel worlds, positions only, no host, no shared authority) is
the cheap one and it does not work here. It works for a *race*, where two players never interact —
each runs their own world and sees the other as a ghost. **4D Pong has exactly one ball and every
player hits it.** Two clients simulating the same ball from the same seed diverge the moment a
paddle moves, because paddle positions are inputs, not seeds.

So: **host authority**, the Zombie model.

| Runs on the host | Runs on every client |
|---|---|
| ball physics, all collisions | **its own paddle**, from local input, immediately |
| scoring, the tug, win detection | rendering everything else from the host's snapshot |
| the AI seat(s) | its own particles (cosmetic, never synced) |
| blasters, stun, the power-up | its own audio, triggered off snapshot changes |

### The one piece of client-side prediction, and why only one

Your own paddle is drawn from your own input with **zero** latency, and the host's value for it is
ignored on your screen. That is safe here in a way prediction usually is not: nothing but your own
keys moves your paddle. The single exception is a stun, which the host owns and which the client
accepts — a stun that arrives 80 ms late is indistinguishable from one that arrives on time.

Everything else is host truth. No rollback, no reconciliation, no input buffer. Those exist to
solve problems this game does not have, and each is a night of debugging.

### What the ball will actually feel like

The ball is ~half a round-trip behind. Between bounces it travels in a straight line at constant
velocity, so clients **dead-reckon** it — last known position plus velocity × time-since-snapshot
— which hides almost all of that. The visible cost is a small correction at each bounce, blended
over ~100 ms rather than snapped.

**The honest limitation:** on a marginal save, the host decides, and the host is using the paddle
position you sent it half an RTT ago. You will occasionally see the ball clip your paddle and be
scored against you anyway. That is inherent to authoritative Pong and the alternative is
lag-compensated rewind, which is not a tonight-sized change.

---

## 2. Seats

Seat assignment is the **host's** job and is broadcast, not derived. Deriving it from a sorted peer
list looks simpler and is a trap: peer lists differ transiently during joins, so two clients can
briefly disagree about who is LEFT, and every input after that goes to the wrong paddle.

| Humans in room | Seats | Field |
|---|---|---|
| 1 | falls back to the local modes — online adds nothing | — |
| 2 | LEFT, RIGHT | 16:9, top/bottom are walls |
| **3** | LEFT, RIGHT, TOP + **CPU on BOTTOM** | square, four goals |
| 4 | all four | square, four goals |
| 5+ | first four seated, the rest spectate | square |

Three players getting a CPU fourth is the brief's own rule from this morning — *"3-player create
an ai player which makes it 4"* — and the couch 3P mode already puts the CPU on BOTTOM. Online
keeps that, so the two modes are the same game.

**A joiner takes an AI seat immediately** rather than waiting for the next match. This is a friend
group; someone arriving two minutes late should get to play, and the AI is only ever a placeholder.

**Host migration is free.** `mp-core` fires `onHostChange`, and the new host already holds the last
snapshot — it adopts it as truth and starts simulating from there.

---

## 3. Messages — all over `relay`, all client-defined

Short keys because these go 20×/second to every peer.

**Host → everyone, 20 Hz** (`t:"s"`, one snapshot):

```
b   [x, y, vx, vy]              ball
p   [pos, pos, pos, pos]        each seat's position along its edge
L   [long, long, long, long]    paddle lengths (desperation growth)
k   bitfield                    stunned seats
u   [pullH, pullV]              the ropes
G   [g0, g1, g2, g3]            goals, so clients can sound a goal
ph  phase                       menu | count | play | over
cd  countdown
w   winner seat, or -1
pu  [x, y, active]              power-up
bl  [[x,y,vx,vy,hot,from], ...] blasters
```

**Client → host, 20 Hz**: `{t:"p", v: <position along my edge>, d: <depth>}`
**Client → host, on press**: `{t:"f"}` — fire. Edge-triggered, never polled.
**Host → everyone, on change**: `{t:"seat", m:{peerId: seatIndex}, n: humanCount}`
**Anyone → host**: `{t:"go"}` — start/restart the match.

Goal and win **sounds are derived from snapshot changes**, not sent as events. A dropped event is
silent; a changed number is self-correcting on the next snapshot.

`MP.canSend("snap", 50)` and `MP.canSend("pad", 50)` do the rate limiting — it is in `mp-core`
precisely so every game does not reinvent it.

---

## 4. Files

One new file, `fp-net.js`, loaded after `fp-ai.js` and before `fp-boot.js`. Everything network
lives in it; the rest of the game gains hooks, not logic.

| File | Change |
|---|---|
| **`fp-net.js`** | **new** — `MP` wiring, seat map, snapshot encode/apply, dead reckoning |
| `fp-core.js` | net state vars; `NET` mode entry |
| `fp-boot.js` | `simulate()` forks host / client; `applyMode` handles the online seat count; ONLINE menu button |
| `fp-input.js` | client sends its paddle position and fire presses |
| `fp-render.js` | player names by their seat, and a connection/role line |
| `four-d-pong.html` | the ONLINE button, the new `<script>` tag |

`node scripts/check-global-collisions.js` after, as always — a ninth file on the same page is
exactly what it exists to check.

---

## 5. Deliberately not doing tonight

- **Rollback / lag compensation.** See §1.
- **Spectator camera.** A 5th player sees the field and no paddle. Fine.
- **Reconnect into your old seat.** Reconnecting gets you whatever seat is free. Seats are keyed
  by `MP.selfId`, which changes on reconnect; keying by name instead would be the fix, and it is
  not worth the risk tonight.
- **Anti-cheat.** `GAME_PROTOTYPE_INSTRUCTIONS.md` §3 already records this repo's position: score
  attribution in Gyro Space is victim-reported and trivially spoofable, accepted for a 3–10 person
  friend group. Here the host is authoritative over everything that matters, so a client can lie
  only about its own paddle position — the mildest possible cheat, and a friend problem rather than
  a code problem.
- **Mobile.** Still off, per `SCOPE_PULLBACK_PLAN.md` §1.
