**Which game?** Gyro Fleet (`gyro-fleet/`). It's built from the Gyro Lab bench and isn't a hub card yet. Its length (3× a Bosconian round, maybe PvP later) may route it to the long game (SCOPE_RULES rule 7). That call is still open.
**Which finish-line item does this close?** None on the hub list. It's the first playable step of Ry's 2026-11-08 redesign: "a couple of enemies spawning in groups, then revisit controls to test feel."

# Gyro Fleet, pass 1: enemies in groups (2026-11-08)

## Asked for (Ry, 2026-11-08, thread "Redesign Gyro Lab gameplay loop")

- Archive Gyro Lab and build in a new copy. Removing `gyro-lab/` from the repo is fine once it's backed up.
- Get a couple of enemy types spawning in groups, plus the Bellwether and its breath-sync wave.
- Then playtest the controls against them. **Controls are deliberately unchanged in this pass.**

## What was built

| | |
|---|---|
| Archive | Branch `archive/gyro-lab-2026-11-08` on GitHub. It was meant to be a tag, but tag pushes are blocked from the cloud session, so Ry can turn it into a tag later. A copy also goes in Ry's OneDrive `Game Development\archive`. |
| Battle space | No galaxy streaming. A ±60,000-unit box round home (beside Earth). Gears 0–4. The ultradrive is off. Lab probes are cleared and the slider panel is hidden (H). |
| Hive | 30,000 units from home. Breathing flesh mass, armoured, solid. Spawns a pod every 40 s, up to 4 pods. 2 pods at boot. |
| Pod | 1 Bellwether + 5 aircrabs + 10 airkrill. It wanders round the hive and hunts any ship within 900. |
| Breath rule | Inhale = rear vent open (the only weak spot while big). Inflated and exhale = armoured, so shots bounce. Deflated = small, fast, hit anywhere. Airkrill pant: half armoured, half soft. |
| Bellwether | Syncs every pod member within 480 to its breath, delayed by distance, so each inhale rolls out as a visible yellow wave. Killing it breaks the sync. |
| Tendrils | Big aircrabs and Bellwethers telegraph for 0.6 s, then grab. Being held for 3 s = the ship is taken. 3 hits on the holder shake it loose. |
| Damage | Flown ship has 100 hull; fleet ships have 40 HP. Deflated contact: 12 (aircrab), 20 (Bellwether), 4 (airkrill). Ramming the hive: 20. You respawn at home. |

## Placeholders and not done

- **Scale is the engine's** (1 unit = 1,000 km, ship ~1 unit), so the "5 km" mothership and the "Florida-sized" Tide aren't to scale. Planet size (100–1,000×) and the scale question come in a later pass.
- **Home** is a lattice-ring marker, not the mothership. There's no spawn room, hex kit choice or elevator yet.
- **The hive is invulnerable.** Its Bosconian-style weak points are a later pass.
- **Fleet ships don't shoot.** Crew-led wings are a later pass.
- Click-per-shot firing, no auto-brake, no ram impact frame: all controls, so they wait for the controls playtest.
- No kill or grab sounds.

## Verified (headless Chromium, file://)

- Boots with 0 errors at 60 fps: 2 pods, 32 creatures.
- Armour bounces a shot. The open rear vent takes damage. A deflated body takes damage anywhere.
- 30/30 pod members synced near a Bellwether, with waves emitted. After the Bellwether is killed, 0 are synced.
- A ship parked at a pod is grabbed, then taken after 3 s, and respawns at home with full hull.
- `check-global-collisions` and `check-undefined-globals` both pass.
- **Not yet played by a human.**
