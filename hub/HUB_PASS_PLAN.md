# Hub — script split + aesthetic pass + audio (2026-09-04)

Session 2 of `COLUMN_COMPLETION_ROADMAP.md` Phase 1. Closes the hub's three remaining `No`
columns: **Scripts Segmented**, **Audio Design**, **Aesthetic Unified**. `On Github`, `Server`
and `Firebase / Leaderboard` are already `Yes`.

Spec: `AESTHETIC_GUIDE.md` §6.0, which calls this *"the largest single change in the repo."*

Written before editing per root `CLAUDE.md`.

---

## The rule that governs this whole session

> **Change the skin, not the layout.**

The three-band no-scroll paging model is **load-bearing**. `HUB_LOBBY_PLAN.md` §1 records why it
exists: a `width:100%; height:100vh` sidebar once made joining a room on a phone a dead end. The
board sizes tiles *from the space available* rather than growing the page to fit them, and that is
the entire point of paging.

So: **no change to** `applyGridShape()`, `PAGE_SIZE`, the cols/rows computation, the band
structure, `renderTiles()`'s sizing maths, the ready-check, the vote model, the countdown, or the
socket protocol. Colours, type, borders and one new behaviour. Nothing else.

## Done in two separate passes, deliberately

**Pass A — the split, with zero behaviour change.** Move the inline script into files, verify the
hub still works identically, then stop. **Pass B — skin and attract mode.** If something breaks,
this ordering says which pass did it. The alternative — one big edit — makes a regression a
bisection problem across 960 lines of script and 630 of CSS.

---

## Pass A — script split

The inline script is 958 lines (`index.html` 713–1670) in 16 commented sections. Only three
things execute at load: `GAMES.forEach` (deriving stamps, inside the manifest), the EVENTS
listener block, and the `init()` IIFE. Everything else only declares — which is what makes a
split safe, and is why **only the last file may execute anything**.

Files land in `hub/`. `index.html` itself must stay at the repo root for GitHub Pages; its
scripts need not.

| # | File | Sections (original line ranges) |
|---|---|---|
| 1 | `hub/hub-core.js` | GAME MANIFEST 713–765, TEARDOWN 766–808, IDENTITY 809–827, ELEMENTS 828–854, STATE 855–908, HELPERS 1510–1523 |
| 2 | `hub/hub-layout.js` | THE WINNING GAME 909–936, LAYOUT 937–975 |
| 3 | `hub/hub-render.js` | RENDERING 976–1194, REMOTE CURSORS 1360–1460, SCREENS 1461–1487 |
| 4 | `hub/hub-net.js` | CONNECTION 1195–1321, LAUNCH COUNTDOWN 1322–1359, PERSISTENCE 1488–1509 |
| 5 | `hub/hub-attract.js` | **new** — Pass B |
| 6 | `hub/hub-boot.js` | EVENTS 1524–1649, INIT 1650–1670 — **the only file that runs anything** |

`shared/identity.js` still loads first (`IDENTITY` is read by `hub-core.js`), and
`shared/retro.js` / `shared/sfx.js` join it in Pass B.

**Why this order.** Top-level `const`/`let` in a classic script create bindings in the shared
global lexical environment, so a later file referencing one at *runtime* is fine — but referencing
one at *load* time is a TDZ error. `hub-core.js` therefore declares all state first, files 2–5
declare only functions, and `hub-boot.js` runs last. This is the same shape `zombie/` uses, where
`zombie-render.js` boots the loop and everything before it only declares.

**Verification for Pass A specifically:** the hub must behave *identically*. Join a room, tiles
render, paging works, voting works, the roster shows. `check-global-collisions.js` reports the new
script count.

---

## Pass B — the skin (§6.0)

Currently a light "paper" surface — `#f5f3f0` ground, `#2a2a2a` ink, Arial. The guide calls this
"a deliberate, coherent design that is the exact opposite of this guide," so this is a genuine
reversal, not a tidy-up. Flagging that plainly: it will look like a different product.

| From | To |
|---|---|
| `#f5f3f0` ground | `var(--ground)` — pure black |
| `#2a2a2a` ink | `var(--phos-mid)` |
| borders | 2px `var(--sig-cyan)` |
| tile titles | `var(--font-display)` (Press Start 2P) |
| tile descriptions | `var(--font-ui)` (VT323) |
| `#roomCode` | `var(--sig-cyan)` — already monospace |
| `COMING SOON` / `MULTIPLAYER SOON` stamps | keep, restyle to `var(--sig-amber)` |

**The hub has no `--world-hue` and must not get one.** §2.5 gives every *game* a hue so the board
reads as a row of different cabinets; the hub is the arcade floor those cabinets stand on, so its
chrome is `--sig-cyan` (§4.11).

**No scanlines.** They are gated on `[data-cabinet="raster"]` and the hub is not a cabinet.

**The fonts will not actually be Press Start 2P / VT323 yet** — `shared/retro.css` resolves both
stacks to Courier New until the `.woff2` binaries are added and `scripts/embed-fonts.js` is run.
The declarations go in now so the hub becomes correct for free the moment they land. This is why
the tile layout must not depend on a font's metrics.

## Pass B — attract mode + audio (§4.8, §4.10)

§4.8 calls attract mode "the most era-defining behaviour in the document," and for the hub asks
for: idle 20s → cycle marquees.

`RETRO.attract()` from the Phase 0 layer drives it. Two constraints it enforces rather than
documents, both satisfied here:

- it **requires** the caller's `AbortSignal` — the hub already has exactly one (`hubSignal`), so
  that is what it gets, and `destroy()` continues to tear everything down
- it opens **no timer**, and is driven by `tick()`

The hub has no render loop — it is DOM, not canvas. So `tick()` needs a driver. It gets
`trackInterval` at 500ms, the hub's own tracked-timer helper, which honours the teardown rule.
A 500ms poll against a 20s idle threshold is accurate to within 2.5% and costs nothing.

**Attract must never interfere with a live session.** It is suppressed while a countdown is
running, while the identity overlay is open, and whenever anyone else is in the room — a board
that starts cycling tiles under a group mid-vote is a bug, not an idiom.

Audio (§4.10) is `shared/sfx.js`: a blip on tile select/vote, and a rising triad when a game wins
the vote. Gesture-gated by `SFX.unlockOn(window, hubSignal)`; silent until the first click, which
is browser policy and not optional.

---

## Verification

```
node scripts/check-global-collisions.js
node scripts/check-identity-parity.js
node scripts/check-doc-sync.js
```

Then over `http://127.0.0.1` — **not** the preview pane, which runs pages hidden with a 0-width
viewport, so `requestAnimationFrame` never fires and relative `src` cannot resolve. Force a
viewport with `resize_window` first.

- board renders 5 tiles on one page, paging arrows work
- join flow: name + room → roster appears
- voting marks a tile and the Continue bar reacts
- attract mode engages after idle and **exits on input**
- `destroy()` still removes every listener and timer
