# Scuba Shooter

Single file: `scuba-shooter.html` (no `../../shared/` imports; the fonts are inlined). Built 2026-11-01/02 in a Claude project thread from the Gemini "Deep Ocean Exploration" prototype, then copied here.

- **Loop:** a Zombie-style intro sweep (Space skips), drop from a hovering helicopter, pop the 10 green specimens without dying, swim to the helicopter's ladder to extract.
- **Style:** RASTER (decided 2026-11-02): renders at 1/3 resolution through an SVG posterize filter. `P` flips to the original palette as a fallback only.
- **Systems:** one walk/swim controller over floor segments (`seg`), a floor nav graph (`buildNav`/`navPath`) for bots and creatures, a 50px water flow field for swimmers, crossings at moonpools/airlocks/ladders (`entries`). Zombie wound rules with a magenta edge (`damagePlayer`). GORE 3 blood baked into decal tiles.
- **Session length:** not yet tuned to SCOPE_RULES' 2–5 minutes, and not playtested with the group. Not on the hub board.
- **Hub link:** the Esc menu's Return to hub points at `../../index.html` (this folder's depth).
