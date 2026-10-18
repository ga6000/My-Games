# Ideas inbox

One line per idea: `date · game · idea` (plus a pointer if a longer write-up already exists).
Being here commits nobody to anything. Rules: `SCOPE_RULES.md`.
Game tags: `hub-zombie`, `long-game`, `hub` (the board itself), `<game-folder>`.

## Open

- 2026-09-24 · long-game · Sector 01 → 02 and what carries over — `zombie/DESIGN_IDEAS.md` Part 7 §III (65, 66)
- 2026-09-25 · long-game · Open world by rail: fuel range, stranding in sparse or secret ground — `zombie/DESIGN_IDEAS_2.md` §8.6
- 2026-09-21 · long-game · FAITH-style black/white/red art direction — `zombie/MAP_VISUAL_AUDIT.md` §4.1
- 2026-09-27 · long-game · Organic (non-rectilinear) level design, which needs a new level representation — `zombie/THE_SPLIT.md` §2
- 2026-09-24 · hub-zombie? · Objective verbs for weapons/classes (undecided which game) — `zombie/DESIGN_IDEAS_2.md` §3.8

- 2026-10-04 · hub-zombie · Hand-off: a key that drops the gun in your hands (with its rounds) as a one-taker drop for a teammate
- 2026-10-04 · hub-zombie · A funnel fills faster with more players standing on it (x1.5 credit at 2+), so a tank is a team job
- 2026-10-04 · hub-zombie · Ping a drop to label it on everyone's screen and minimap ("dibs"), so the drop callout works without voice
- 2026-10-04 · hub-zombie · A revive gives both players 3s of OVERCLOCK, which makes picking someone up the strong play
- 2026-10-04 · hub-zombie · A team escape multiplier: the win bonus scales with how many got out, shared by everyone who did

- 2026-10-04 · hub-zombie · (after a few more playtests) Tight clusters of trees for pinch points, less common than the open patches

- 2026-10-11 · hub-zombie · Zombies standing on an active funnel take damage over time, so the funnel itself is crowd control
- 2026-10-11 · hub-zombie · A throwable on G (frag/stun) with its own small ammo that AMMO drops refill — the one skill-action crowd tool

- 2026-10-12 · hub-zombie · Let any key skip a map's flythrough (local only; the host clock already waits for it). Worth more now: maps 2 to 4 run 14.5 to 18.7s — `zombie/CLAUDE.md` "Eleventh"
- 2026-10-12 · hub-zombie · The objective beacon and the hurt frame still pop in the frame the intro ends; give them a stepped fade-in too — `zombie/zombie-render.js` `introOn`

- 2026-10-16 · hub · Leaderboard names: ask for a name on the ready screen when none is stored (an iOS Home Screen install has its own empty storage, so it submits as "Anonymous") and remember it — `shared/mp-core.js` `readIdentity`, `shared/leaderboard.js`
- 2026-10-16 · hub · Leaderboard names: normalise them (trim, case-insensitive grouping) so "ry" and "Ry" are one player — `leaderboard.html` groups by the exact `player` string
- 2026-10-16 · hub · Leaderboard names: store the anonymous Firebase auth uid on each score so a name can be tied to one device without accounts — `shared/leaderboard.js` `writer`
- 2026-10-16 · hub · Leaderboard scores: validate them server-side (Firestore rules or a Cloud Function); today the rules live in the Firebase console and cannot be read from the repo

### Cliff Run movement and level design (2026-10-17)

From the control-scheme pass (`cliff-run/CLIFF_RUN_PLAN.md`, "Movement"). The
scheme itself is built; these are the level-design follow-ons it points at, and
the one alternative scheme worth costing.

- 2026-10-17 · cliff-run · A one-button grapple that aims itself (SpeedRunners): the most dynamic verb available and genuinely easy, because the aiming is the game's job — needs an anchor tile, a rope constraint, generator placement and a bot behaviour
- 2026-10-17 · cliff-run · Branches are the best verb in the game and are rare; raise their frequency and build around them, since a spring needs no technique at all
- 2026-10-17 · cliff-run · Make chimneys a shortcut past a flatter route rather than a wall across the only path, so a group that never learns wall-jumps still finishes
- 2026-10-17 · cliff-run · Place the shafts between lanes deliberately — crThicken already makes a hole in an upper floor a drop into the lane below, and a drop that gains you ground is a decision
- 2026-10-17 · cliff-run · One pinch per level where all four lanes meet: with bouncy bodies and a fixed screen that is where it stops being four parallel one-player games
- 2026-10-17 · cliff-run · Coin arcs along the fast line, so the greedy path and the quick path are the same shape and reading one teaches the other

### Cross-game rewards (2026-10-17, user)

One idea per line, as the rules ask, but they are one system: **finishing a game unlocks something
in a different game.** It needs somewhere to keep "what has this player finished", which is
persistence — so by `SCOPE_RULES.md` rule 7 this is routed, not cut, and nothing here is built
until it is pulled against a finish line. The open question each line shares: unlocks are
per-player and the hub has no per-player store yet (identity is a name hash, scores go to
Firestore write-only). See `cliff-run/SERVER_NOTES.md` § "Cross-game rewards".

- 2026-10-17 · hub · Cross-game rewards as a system: one small per-player "completions" record the hub owns, that every game reads at boot and no game writes except on a win
- 2026-10-17 · cliff-run → hub-zombie · Clearing all 10 Cliff Run levels unlocks a perk or a weapon in Zombie (which one is undecided; the dash reads across best)
- 2026-10-17 · hub-zombie → cliff-run · Beating Zombie unlocks a bonus ability on the cliff (candidate: start each level with a second-jump charge already held)
- 2026-10-17 · glass-city-escape → cliff-run · Beating Glass City Escape lets you dash straight through breakable blocks, so the bomb walls become optional rather than required
- 2026-10-17 · hub · The unlock has to be VISIBLE on the board, or nobody knows they have it — a line on the tile, not a surprise in-game

- 2026-10-17 · zombie-rail · A yard fence with TWO crossings (one on the main, one on the siding), so the route choice and the currency choice interact instead of being the same decision — ruled out of the sandbox because an E-W wall across the west main passes within 23px of the siding
- 2026-10-17 · zombie-rail · Derailment as a real outcome when points are thrown under a car, instead of the lever being refused — needs a recovery verb (a crane? a re-railing ramp?) before it is anything but a dead end
- 2026-10-17 · zombie-rail · A turntable or a wye, so a locomotive can be turned rather than only reversed
- 2026-10-17 · zombie-rail · Cargo that counts: crates in a box car adding to its mass, so loading a wagon changes how it shunts
- 2026-10-17 · zombie-rail · Multiplayer for the rail sandbox — the wire format is already implied (broadcast each body's route anchor + scalar and DERIVE every car, never interpolate)
- 2026-10-17 · zombie-rail · Pump noise as a real wave trigger with a difficulty curve, once zombies are more than the placeholder straight-line chaser in `rail-zomb.js`

## Promoted / dropped

(Move lines here with a date when they leave the inbox.)

- 2026-10-11 · promoted · Zombie's lighting rework (option A) and the five-silo second map were proposed and built the same day (`zombie/LIGHTING_PROPOSAL.md`, `zombie/LEVEL_2_PROPOSAL.md`, `zombie/CLAUDE.md` "Seventh").

- 2026-10-11 · promoted · Tank pulse on F at a full tank, FREEZE team drop, TURRET drop, the spawn tide, the lull after a tank fills / the gate opens, and easing the spawn debt after a fast clear were all built the same day they were accepted (`zombie/CLAUDE.md`, "Sixth").

- 2026-10-07 · promoted · "Boxes of organised trees round the tank areas" and "shacks at 1, a warehouse at 2, a dense forest at 3" were built as the silo sets (`zombie/CLAUDE.md`, "The one-hit buffer and the silo sets"). Tank 1 got hedge rings and containers rather than shacks, at the user's request of 2026-10-07.
