# art/ — drawn images for PLEURA

Drop a file in, run `node scripts/art-manifest.js`, reload. Anything missing falls back to the
coded pixel scene or figure, so the hub always works.

| File | Shape | Used for |
| --- | --- | --- |
| `key/<game-id>.png` | 3:2 landscape, 1536 x 1024 | The board tile (middle 16:9), the chapter card before the game, and the game's own title card |
| `splash.png` | 3:2 landscape, 1536 x 1024 | The first screen. PLEURA sits across the top 20%, CLICK TO START across the bottom 10% |
| `crew/<role>.png` | 2:3 portrait, transparent background | Character select and the podium. Roles: `medic engineer scout gunner butcher bulwark` |

Game ids are the `id` fields in `hub/hub-core.js`: `alien-outpost eiei-aliens scuba-shooter zombie
glass-city-escape four-d-pong hurl-strike rd-arena code-racer cliff-run text-editor-wars
space-tracer` (the TAKEOFF tile) and `gyro-fleet`. Check that file if a tile does not pick its
image up.

Rules for every image:

- No lettering in the image. Titles are set over it in the hub's type.
- Key art: the subject sits in the middle 16:9 band; the bottom quarter is kept quiet, because
  the tile's name plate covers it.
- `.png`, `.webp` or `.jpg`. Keep each under about 600 KB (convert to `.webp` if larger).
- The board tokens are not replaced: they are the pixel figures in `shared/crew.js`.
