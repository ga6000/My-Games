# Zombie — map & visual audit (2026-09-20 / 21)

**Why this exists.** On 2026-09-20 the user reported glitchy buildings with no readable doors,
windows or furniture; a rail turn whose track art does not turn; buildings standing in the
Spillway's storm drains; and overlap everywhere. Their read was that the map feels like *generated
elements massaged until passable* rather than designed. This audit confirmed it.

**How it was measured.** Earlier map passes were verified by proxies: nav reachability, floor-tint
ΔE, sightline %, gun placement. All of them passed while the designed features quietly failed to
build. This audit **looked at the map**. It rendered world layers to a full-resolution canvas and
posted the PNGs to a local sink (method in the `zombie-map-capture` session memory; not in the
repo), then swept 40 seeds in the page for outcome counts.

> **Don't quote a map number from `CLAUDE.md` as current without re-measuring.** Several of them
> were targets written down as if they were outputs. The ones found are marked superseded there,
> dated 2026-09-21.

---

## 1. Findings (40-seed sweep, 2026-09-20)

### 1.1 Buildings — `makeBuilding()`, `zombie-level.js` ~2872

| | |
|---|---|
| Buildings with an open corner | **95%** |
| Furniture overlapping a wall | **26%** of pieces |
| Buildings with their stairs outside the walls | **23%** |

- **The open corner is the "bite".** One corner is cut back so the outline isn't a box.
  `inBuildingBite()` drops every shell span inside the bite, but **nothing builds walls along the
  bite's two inner edges**. So the "cut-out corner" is actually a hole two walls wide. The code
  comment says it is "cut from the OUTSIDE, so the inside stays a simple shape". The code doesn't
  do that.
- **Furniture and stairs are placed against the full rect**, not the bitten outline. That's why a
  quarter of pieces overlap walls and a quarter of staircases stand outside the building.
- **Windows reuse the zombie-barricade art.** A building window *is* a barricade (players never
  pass, zombies chew through) and it is drawn by `drawBarricades()`. From above, a window looks
  exactly like a boarded boundary door.
  > **Partly addressed 2026-09-24.** The art is still shared, but the *board size* is not absurd
  > any more: the plank count was a flat 4 whatever the opening, so a 44px window got 11px boards
  > and a 150px rail gate got 37px ones. `barricadePlanks()` divides the span by a fixed 32px
  > pitch (clamped 2-6) instead, so a board is one size everywhere. 32 is the standard boundary
  > window's own pitch, so the common case is unchanged. The renderer and `bulletBlockedAt` read
  > the same function, so the visible gap is still the shootable gap.

### 1.2 Density: target vs what actually gets placed, per map

| Feature | Target | Placed |
|---|---|---|
| Buildings | 49 | **5.3** |
| Cold Storage buildings | 12 | **0** |
| Spillway pipe segments | 16 | **2.5** |
| Motor Pool service bays | ~6 | **0.6** |
| Yard containers | 7.2 (the doc's claim) | **3.35** |

**One cause throughout.** Placement is greedy random with a `continue` on any clash, so when a
feature doesn't fit it is skipped **silently**. Nothing counts the misses and nothing asserts that
a designed feature exists. `assertZoneConnectivity()` checks that the map is traversable, not that
it is the map that was designed.

### 1.3 The Spillway

**Build order puts buildings inside the drains.** Buildings are placed in `buildZoneContents()`,
and the pipes come later, in `buildSectorInteriors()`. So the buildings take the ground first,
most pipe segments get skipped, and the pipe's **drain floor is painted under the buildings
anyway**. That is the "buildings in the storm drain" the user saw.

The pipe **centre line is a floor-tile artifact** (`invert` in `zombie-floors.js`). It's baked
into a 64² tile that repeats every 128 world px on the world grid, unrelated to where any pipe
actually runs. This is the same failure as the rail (1.4). **Not fixed in this pass.**

### 1.4 The rail — FIXED 2026-09-21

Spur geometry lives in `buildRailSpur()` / `railLeg()`, `zombie-level.js` ~1869–2040:

- **Leg A:** y 920–1040, x 3210–4610, running east.
- **Leg B:** x 4600–4720, running south to y 2660.

Problems found:

- **The track was baked into the `ballast` floor tile**, as horizontal stripes every 16px. A tile
  repeats on the fixed world grid, not along the track. So leg A read as sleepers, leg B read as
  stripes running the wrong way, neither leg had rails, and the corner was two rectangles meeting.
- **The Kennels "run" was painted as track** across the sector's whole bounding box
  (`zombie-level.js` ~1683). On **40 of 40** maps it passed under a boundary wall.
- **Each Kennels railcar got a ballast square under it** (~1783). The tile's world-grid stripes
  then crossed each car at whatever angle the grid gave.

What was done:

| Change | Where |
|---|---|
| `ballast` is plain gravel now, no stripes | `zombie-floors.js` |
| **`railPaths`**: a list of centreline polylines, each with a bed width and a fillet radius. Pure geometry with **no `MP.random()`**, so no seed's layout moves | `zombie-level.js`, beside `buildRailSpur` |
| The spur is **one path** with a 90px-radius curve at the corner | `buildRailSpur` |
| The Kennels run is **no longer painted**. It is still a reserved lane | `buildKennels` |
| Each Kennels railcar gets a **short siding** in its own orientation (car length + 28px at each end, 80px bed) | `kennelSiding`, from `placeKennelPiece` |
| **`drawRailTracks(inView)`** draws sleepers across the direction of travel and two rails along it, and the curve comes out as stepped pixels. Drawn after the floors and before furniture | `zombie-render.js` |

**How the renderer works.** Each path is rendered once into an offscreen canvas at **2 world
units per texel** (the floor tiles' own scale) and blitted with smoothing off. The cache is keyed
by array identity, and `generateLevel()` assigns a new `railPaths`, so a reseed rebuilds it.

- **The bed keeps the lanes' square outer corner.** Only the track curves. A curved bed over the
  square ballast patch left a seam between two different gravels.
- **Cost.** The first version took 146ms per level to build the cache. A rect prefilter (skip
  texels far from any leg) brought it to **44ms, once per level**.
- **Checks.** Collision and undefined-globals checkers are clean. Verified by full-res renders of
  seeds 22352 and 4817: the corner, both legs, the Kennels sidings, and the whole line.

---

> **These numbers are now checked automatically (2026-09-24).**
> `node scripts/check-map-features.js` reproduces this whole section in a few seconds --
> it generates maps in Node through `scripts/zombie-headless.js`, a vm harness that runs the
> page's own scripts, so the real generator is what gets measured. It compares against recorded
> baselines and fails on a regression, rather than failing every run on the known defects. The
> pre-commit hook runs it warn-only. Its independent 24-seed measurement agrees with the sweep
> above: 5.0 buildings a map, 100% open corners, 28.8% of furniture on a wall, 18.9% outside the
> shell, and **five sectors that get no building on any seed** (centre, cold, kennel, pump,
> turbine).

## 2. What the findings say about the approach

Every item in §1 is the same failure. A design was written down (in a comment, in `CLAUDE.md`, in
a plan), a random placer was asked to realise it, and the placer's failures were invisible. The
proxies measured the *leftovers*: the map was connected, the tints differed, the guns sat in the
right sectors. None of them measured whether the thing that was designed was there.

Two consequences, both carried into `LEVEL_BUILDER_PLAN.md`:

1. **Authored beats generated for anything with a shape.** Buildings, the pipe runs and the motor
   bays are shapes someone designed. They should be *drawn*, as stamps, and the generator should
   only pick which stamp goes where, plus the loot.
2. **Assert what was designed.** A check that fails when a building is missing a wall, or when a
   sector got zero buildings. **Built 2026-09-24** at the user's request:
   `scripts/check-map-features.js`, warn-only in the pre-commit hook.

## 3. Not fixed, in rough order of how much they hurt

1. **Buildings: the bite hole, furniture outside the outline, stairs outside the walls.** These
   are **deliberately left for the stamp work** rather than patched in `makeBuilding`: the user
   wants to hand-build buildings, and a patched generator would be thrown away.
2. **Density shortfall** (§1.2). Same reasoning: authored sectors replace the placer.
3. **Spillway build order** and the drain floor under buildings. A small fix (pipes before
   buildings, and paint the drain only where a segment was actually built), but it moves every
   seed's layout. Hold it until the art direction (below) is settled.
4. **The pipe centre line is a tile artifact.** It could get the same treatment as the rail
   (geometry plus a drawn line), but the new art direction may drop floor textures altogether.
5. **Window art = barricade art.**

## 4. Art direction — recorded, not implemented (2026-09-21)

> **Decision 2026-09-24: not yet.** The user declined the palette change for now and tabled the
> ordering question (whether a restyle would come before or after the level builder). Nothing in
> §4.1 is approved; it stays here as a written proposal. `AESTHETIC_GUIDE.md` is untouched.

The user's call, after seeing this pass: *"visuals are improving, but these things are barely
moving the needle. I'd like to reconsider overall visual direction before proceeding much
further."*

- **Look:** much simpler, toward **FAITH** (Airdorf / New Blood). A very limited palette, mostly
  black, white and red. Low-res pixel horror.
- **Map design and objectives:** **Call of Duty Zombies**, the Ascension, Origins and Transit maps.

**This conflicts with `AESTHETIC_GUIDE.md`.** §6.3 anchors Zombie on *Berzerk* with the ember
world hue. The floor pass (the §6.3 status note) gave every sector a textured, tinted floor. §2.2
reserves magenta as the danger colour. A proposed guide update is in §4.1. **The guide itself has
not been edited.**

### 4.1 Proposed `AESTHETIC_GUIDE.md` §6.3 replacement (for the user to approve)

> ### 6.3 Zombie — `zombie/` · **RASTER** · anchor: *FAITH* (2022, after the Atari/Apple II era)
>
> **Palette: black, one white, one red, and a grey or two for structure. Nothing else in the world.**
> - Ground is **black**. Not a texture, not a tint: a sector is known by its *shapes* and its
>   landmark, not by its floor colour.
> - Walls, props and structure are **white or light grey line and block work**, 1–2px at world
>   scale ×2. Solid objects are outlined or flat-filled, never textured.
> - **Red is the only accent**: blood, zombies' eyes, damage, the horde switch, danger. It
>   *replaces* the Signal magenta for this game (a documented deviation from §2.2, as the floor
>   tints already were for §2.5).
> - Signal amber survives **only** on things you can buy (wall-buys, perks, doors' prices), because
>   the economy has to read at a glance. Cyan is dropped from the world and kept in the HUD.
> - **The light pocket becomes the art.** Inside it, the world is white-on-black. Outside it, only
>   red reads. This is the existing quantized ramp with a monochrome drain applied to everything,
>   not just the Blackout.
> - The container-yard exception (five loud hues) is **withdrawn**.
>
> What is kept: the 2px texel, smoothing off, the flat cast shadow + lifted top face for height,
> whole-pixel jitter, the four-band light ramp and every lighting *number* (§5).
>
> What goes: the per-sector floor tiles and exterior/interior/unique layers (`zombie-floors.js`
> collapses to "black, plus a few authored decals"), the per-sector wall palettes (`ZONE_WALL`),
> and multi-colour container and railcar art.

**What this means for the code, before anyone decides.** It is mostly deletion. The floor system
would collapse to "black plus decals". Every `draw*` function in `zombie-render.js` would go to a
three-tone palette. Lighting and gameplay are untouched. That is roughly **M effort, 1–2
sessions**. It should come **before** the level builder, because the builder's stamps are simpler
to author when a wall is a white line rather than a textured, per-sector surface. And the rail
work of §1.4 would recolour into the same three tones for free (it's one palette table).

### 4.2 What CoD Zombies means for the map (for discussion; nothing here is decided)

| From | Idea | Zombie's nearest existing piece |
|---|---|---|
| All three | **Hand-authored layout**, the same every game, learnt over many runs | the fixed sector skeleton; the interiors are still random |
| Ascension | Power switch → Pack-a-Punch, **objective chain across the map** | the generator; the Blood Silo endgame |
| Origins | Several **generators to hold**, each one a place to defend | one generator today |
| Transit | **A route vehicle** tying separate areas together | the rail spur, a line that is currently scenery |

The Transit parallel is the interesting one. The spur now visibly runs Kennels → Yard → Motor
Pool, and a rideable railcar would be the same idea as Transit's bus. It's not proposed for
building, only noted because the track exists now.
