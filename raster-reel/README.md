# Raster Reel (dev test)

Experiment for the hub anthology's raster direction, started 2026-11-08. Not a hub game, not on the board, not linked from `index.html`.

All six board games run live, side by side, each in its own tile. One shared raster filter sits over every game's main canvas, so a look can be weighed across games at once. No game file is touched: the game canvas is hidden (it keeps rendering), and a filtered copy is drawn in its place each frame. The game's DOM HUD stays on top, unfiltered.

## Run it

```
node scripts/dev-serve.js
```
Then open http://localhost:8123/raster-reel/raster-reel.html. It must be http: over file:// the browser won't let the page read the games' canvases.

## Use it

- **Click into a tile** to play that game. Only the tile you're playing has sound.
- **Grid / Focus / Solo** change the layout. Focus makes the game you're playing big and puts the other five in a strip. **⤢** on a tile makes it the big one.
- **Reel ▶** cycles the big tile through the games every N seconds. Clicking into a game pauses it.
- **FX** on a tile turns the filter on or off for that game. **RAW**, or holding `\` while the page (not a game) has focus, shows every game unfiltered.
- Scuba Shooter, Zombie and pre-MP RD Arena are RASTER references and start unfiltered.
- **Presets**: built-ins, Save as…, and Export/Import JSON. Exported JSON holds the settings and each tile's FX state, ready to hand to a per-game pass later.

## The filter, in order

1. Shrink to a virtual pixel grid (pixel size is in screen px, so every tile reads the same on screen). Line gain brightens thin vector strokes so they survive the shrink.
2. Recolour: contrast, brightness, saturation, black crush, shadow bleed (low-mid tones to blood), then quantise to levels per channel or map to a palette (nearest colour, or a brightness ramp), with ordered dithering.
3. Phosphor persistence (smear) at low res.
4. Upscale with hard pixels, then bloom, scanlines (one band per virtual pixel row), grain, vignette, and a red vein vignette that can pulse with a breath rate.

## Limits

- It's a filter, so it can't turn thin strokes into solid sprites. That's for a later per-game pass.
- Space Tracer and the multiplayer games still try to reach their servers; solo modes work offline.
- `shared/zoom-guard.js` is switched off inside the tiles, because it reads the top window and would always warn.
