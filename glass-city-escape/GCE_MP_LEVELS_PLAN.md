# Glass City Escape — multiplayer past level 1 (2026-09-20)

## The report

> "when in multiplayer session on game hub with glass city escape, players can't get past first
> level and restart button just comes up"

## Cause

`Player.update()` in `gc-entities.js` branched at the tunnel:

```js
if (racingOthers() && !raceFinished) finishRace();
else triggerNextStage();
```

With anyone else in the room (a hub launch puts the whole group in `glass-city-escape:CODE`),
`finishRace()` → `recordFinish(self)` → `showMessage(..., isGameOver = true)`: the run ends,
the Restart button appears, and Restart is `location.reload()` — same room, same seed, level 1
again. The race was one level long by design (MULTIPLAYER_PLAN §4b, "first to the tunnel wins"),
so in company the level curve was unreachable. The 2026-09-07 fix (`netOnline` →
`racingOthers()`) freed solo players and left groups exactly where solo players had been.

## The change

**The tunnel is a stage gate for everyone.** The race becomes a placing per level, and the run
ends only on death, the same as solo.

| | before | after |
|---|---|---|
| tunnel, with rivals | game over, Restart | `triggerNextStage()`, placing shown |
| tunnel, alone | `triggerNextStage()` | unchanged |
| `pos` on the wire | `x y z c n` | + `s` (the sender's level) |
| `finish` on the wire | sent at the tunnel | gone — a rival's level-up is read off `s` |
| ghosts | drawn on any level | only on **your** level (other levels are other cities) |

Still parallel worlds: every client on level N builds the same city from
`baseSeed + N * 7919`, so ghosts on the same level are in the same streets. Nothing new is
shared beyond one integer on a packet already sent at 15 Hz.

**Race board** (screen space, under the minimap, only with company): each racer's level, sorted
deepest first, plus room members not yet running. **Race feed** (bottom centre, ~2.6 s, canvas,
no timers): "ALICE CLEARED LEVEL 2", and your own "1ST OUT OF LEVEL 2".

**Placing** = 1 + live rivals already on a deeper level when you clear it. Live standings, not a
ledger: a rival who died and restarted is back on level 1 and does not count as ahead.

## Removed, not left dangling

`raceFinished`, `finishOrder`, `recordFinish`, `standingsText`, `finishRace`, `raceStartTime`
(written in three places, read only by `finishRace`). The `finish` message handler goes with them;
an old cached client that still sends one is ignored.

The rival "ESCAPED — keep going!" box went with `recordFinish`. It was the modal-looking HTML
box plus a raw `setTimeout(hideMessage, 3000)`, and with levels now advancing it would have popped
over the game every time anyone cleared anything.

## Not in this change (flagged, not fixed)

- **Late promotion keeps the local seed.** `onReady` fires once; a client whose socket opened
  after mp-core's 6 s solo timeout keeps `baseSeed` from the local clock and races a different
  city. PROJECT_MEMORY's "one-shot onReady" entry names exactly this. Unlikely from the hub (the
  server is already warm), so it is left for its own change.
- Death still ends the run and Restart still reloads to level 1, as in solo.

## Verify

- Two live clients against a local copy of the real server: both advance past level 1, each sees
  the other on the board, ghosts only on the shared level, feed lines on each clear.
- `check-global-collisions`, `check-undefined-globals`, `check-doc-sync`.

**Done 2026-09-20.** Alice, Bob and an idle Cara as three iframes in one page, `?server=` pointed
at `gyro-space-server-main/server.js` run locally. Cleared by the real path (pick up, deposit,
walk into the tunnel): Alice to level 4 with Bob in the room, no game-over box; Bob's feed
"ALICE CLEARED LEVEL 1/2/3", his own "2ND OUT OF LEVEL 1/2/3"; identical level-2 tile hash and
core positions on both; ghosts drawn only while on the same level; Cara listed as "—". A death
still ends the run with Restart; the survivor's board shows the dead racer as "—" after the 6 s
ghost timeout, and L1 again once they restart. `?solo=1` advances with no board and no feed.
Only console error: the 404 of the harness page itself. All four checkers clean.
