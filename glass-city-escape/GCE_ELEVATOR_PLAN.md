# Glass City Escape — sidebar and the elevator (2026-10-18)

**Which game:** Glass City Escape.
**Which finish-line item:** `HUB_RETROSPECTIVE.md` §5 item 1 (every card played), via Phase 4 of
`HUB_1_0_PLAN.md` — *"every card gets the cabinet panel"*. The user asked for this explicitly on
2026-10-18, after confirming Zombie 2m–2q were played. The rest of the Glass City wish list (balance,
more levels, player interaction) is **not** in this change.

## What was asked

1. A **right sidebar** with an **elevator-button array** that reads out the current floor, and
   above it a **red segmented-digit display** of the level the player is on.
2. A **visual overhaul** (this change does the elevator's look; the rest is a later pass).
3. The stepwell becomes an **elevator**:
   - a metal cage, walked into; doors close on all four sides
   - it pulls the player down
   - the next level's spawn drops the player in with the same cage, then the doors open in reverse
   - the player is released with an elevator **ding**, which then updates the level display

## Design

| Piece | Where | Notes |
|---|---|---|
| Sidebar markup + CSS | `glass_city_escape.html` | `#screen` stops 200px short of the right edge; the HUD (cores, score, hearts) moves into it |
| Sidebar logic | `gc-sidebar.js` (new) | 7-segment canvas, floor buttons, `sidebarFrame()` for the flash (no timers) |
| Cab drawing + ride state machine | `gc-elevator.js` (new) | `elev` = null or `{phase, t0}`; phases `enter → descend → arrive → open` |
| Rebuild split | `gc-world.js` | `triggerNextStage()` = bank points + begin the ride; `advanceStageWorld()` = the old rebuild |
| Sounds | `gc-audio.js` | door clank, motor, thud, ding |
| Loop hook | `gc-render.js` `gameLoop` | while `elev` is set, the world is frozen and only the ride advances |

- The **level display updates on the ding**, not when the stage number changes (the rebuild happens
  in the dark, mid-ride).
- The well cab is **locked and closed** until the last pedestal fills, then its doors open (this
  replaces the sliding trapdoor halves) and the player can walk in. Until then the cab is solid.
- The spawn cab is decoration on level 1 (doors open) and the arrival animation on every later level.
- **Supersedes** the Robotron "no pause between levels" rule (`CLAUDE.md`, 2026-09-06) for the
  level change: the ride is ~5 s of locked player. The wave burst + "LEVEL n" title is kept, armed at
  the release.
- The red digits are a **deliberate departure** from `AESTHETIC_GUIDE.md` §2.2 (Signal Three): they
  are a physical LED display on an elevator panel, not a game signal.

## Verify

`check-global-collisions`, `check-undefined-globals`, `check-doc-sync`, then the Browser pane on the
`my-games` launch config (`?solo=1`), driving the ride by hand.
