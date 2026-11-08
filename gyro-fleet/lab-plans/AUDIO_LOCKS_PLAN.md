# gyro-lab — audio, panel locks, sharp hull

Written 2026-09-12 before editing, per root `CLAUDE.md`. Request:

1. Ambient background audio.
2. Flying sounds based on gear, with a gear-switch sound.
3. An autopilot orbit-engaged sound.
4. A lock icon beside every adjustable panel field, to mark items ready to be locked and
   have their adjustable controls removed.
5. Fully zoomed in, the ship is a fuzzy version of its shape — sharpen it.

## Audio — new `gl-audio.js` (after gl-ultra.js)

Owns the ONE AudioContext. The ultradrive's voices (gl-ultra.js) now plug into it instead
of creating their own.

- **Graph:** voices → ambient / engine / sfx buses → master → speakers.
- **Start:** the first key or click (`glAudioUnlock`, gl-boot.js) — the gesture browsers
  require.
- **Pause:** suspends the context, which is now gl-audio's job, not gl-ultra's.
- **Ambient:** a brown-noise drone, a slow A1/E2/A2 pad with tremolo, and a faint hiss.
  - The pad **sinks in pitch with the ship's clock τ**, so time dilation is audible.
  - In the **galactic void** (`glGalaxyVoid`) it darkens and the hiss opens.
- **Engine:** sawtooth + square through a resonant lowpass, plus band-passed wind noise.
  - Each gear adds +4 semitones, a brighter filter and more wind.
  - Bursts lift it a little.
  - Silent in the ultradrive and while dead.
  - In E it follows the first selected formation's gear.
- **Gear shift** (hooked in `glShiftGear`): a click plus a triangle chirp, rising on an
  upshift and falling on a downshift, pitched by the gear. Dropping to 0 from above
  gear 1 is a longer power-down sweep.
- **Autopilot lock-on:** detected as an *edge* per frame, so there are no hooks in the sim.
  - The flown ship gaining an auto-orbit lock → a two-note chime.
  - A new ring (`glRingSeq` changes) → three notes.
  - States already true when audio starts don't chime.
- **Params** (the Audio group): master, ambient, engine, cues volumes; Sound on.

## Locks (gl-ui.js)

- **The button:** 🔓/🔒 on every slider, checkbox and the two model pickers. Excluded:
  per-hole keys (they're per-object state) and auto-orbit (a view of the flown ship).
- **Locking** stores the current value in `localStorage` (`gyrolab-locks-v1`) and disables
  the row: the slider is hidden, the number box and checkbox are inert, and the row is
  tinted amber.
- **Locks win everywhere:**
  - they're applied at boot and after Reset All;
  - presets skip locked keys;
  - hotkeys (M, C, `[ ]`, `, /`) and the wheel's auto-zoom off-switch respect them.
- **Session buttons:** **Hide locked (N)** removes the locked rows (persisted), and **Copy
  locked** copies the JSON. `Copy params` includes `locked` too. That list is what gets
  baked into the defaults — and those params deleted — in a later pass.

## Sharp hull (gl-core.js `glStrokeHull`)

- **Cause:** the line widths (4 for the glow, 1.5 for the core) were in *world* units
  inside the zoom-scaled transform. That was right for the old 18-unit hull near zoom 1.
  The 1-unit hull is seen at zoom 8–400, where the glow became a 32–1,600 px haze.
- **Fix:** widths are divided by zoom, i.e. in screen pixels, plus a faint fill so the
  shape reads solid.

## Verify

- The context builds on a gesture, and the voices exist.
- The engine frequency steps with the gear.
- The gear-shift and lock-on cues fire once per edge; there's no chime at audio start.
- Locks persist across a reload, survive Reset All, block presets and hotkeys, and hide.
- A screenshot of the hull at zoom 200.
- Checkers, then doc-sync.

## Status — implemented 2026-09-12

Built as written, and every verify item passed. The numbers are in `gyro-lab/CLAUDE.md`
("Audio, panel locks, sharp hull"). The sound has not been judged by ear. Locks are marks
only for now — nothing has been baked in yet.

> **Follow-up, later on 2026-09-12:**
> - **The first batch is baked:** `GL_BAKED`, 40 keys. Those fields left the panel, and so
>   did the presets and model hotkeys.
> - **The engine** became a turbine whir, not the sawtooth "car" planned above.
> - **Added:** a shot sound and the trajectory-lock cues.
>
> See `gyro-lab/CLAUDE.md`, "Baked settings, trajectory lock…".
