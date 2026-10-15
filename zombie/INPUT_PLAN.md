# Controller and touch input (2026-10-14)

**Which game?** Hub ZOMBIE (`zombie/`, the arcade run).
**Which finish-line item?** None in `HUB_RETROSPECTIVE.md` §5 — this is a direct user request
("PC wired or Bluetooth controller integration ... phone users ... full control of their character").
It is closest to item 1 (every card played by the group): it widens who can sit down at the
cabinet. It **reverses, for Zombie only,** the 2026-09-04 "mobile switched off" decision
(`SCOPE_PULLBACK_PLAN.md` §1). Nothing else in the hub is touched.

## Shape

One new file, `zombie-input.js` (script #26, after `zombie-lobby.js`). It owns the gamepad poll,
the touch overlay and the touch-layout CSS, so deleting its `<script>` tag removes all of it, the
same shape as `zombie-dev.js`. It writes only through fields the game already reads:

| Source | Writes |
|---|---|
| left stick / left touch | `p.moveVec` (analog, magnitude 0..1) — new, read in `updatePlayers` |
| right stick / right touch | `mouseX` / `mouseY` (a point 240 world px out along the stick) |
| fire | `p.keys.shoot`, on edges only, so a mouse click is never overwritten |
| buttons | the same functions the keys call: `interactWith`, `cycleWeapon`, `arcadeBoomToggle`, `p.turretArmed`, `arcadePlaceTurret`, `openHelp` |

Edits outside the new file: a `p.moveVec` branch in `updatePlayers`, one `inputFrame(now)` call in
`gameLoop`, the script tag, the viewport meta, and `inputVerb()` in the lobby's hint text.

## Mapping (standard-mapping pad)

Left stick move · right stick aim · RT / RB / LT fire · A use (also READY, and restart on the end
cards) · B Boomgun in/out · X arm/stow or place turret · Y next gun · LB previous gun ·
D-pad moves if no stick is held · Start opens the ESC dialog (B / A / Start closes it).

Touch: floating left stick moves; floating right stick aims and **fires while pushed past 35%**;
buttons along the bottom for USE, PREV/NEXT gun, BOOM and TURRET (shown only while you hold one);
MENU top-left. Tapping anywhere ticks READY and restarts from the end cards.

## Not done / not verified

Real controller hardware and a real phone. Verification is headless plus an emulated touch viewport.
