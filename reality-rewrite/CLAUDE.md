# Reality Rewrite — file map

6-file classic-script split, loaded via `<script>` tags in this order:
- `core.js` — reality-shift mechanics, stability meter
- `entities.js` — bots, players, projectiles
- `map-gen.js` — recursive quadtree scatter map generator (mirrored for symmetry), quatrefoil pool, castellated border ring
- `match-phases.js` — round/match state machine
- `render.js` — canvas draw calls, spiral pie-chart reload ring
- `game.js` — `window.GameInstance` glue; identity resolution from URL params (`?name=&color=&room=`) or config object

## Known pitfall
`render.js` has previously overwritten CSS values on every call (the vignette regression). When editing it, check it isn't clobbering state another module set.

## Open task
`init()`/`getState()` need verifying against `GAME_PROTOTYPE_INSTRUCTIONS.md` and the Space Tracer implementation for contract alignment — do this before marking a phase complete.
