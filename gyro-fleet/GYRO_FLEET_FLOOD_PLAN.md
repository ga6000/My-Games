# Gyro Fleet: the flood pass (2026-11-15)

**Which game?** Gyro Fleet (`gyro-fleet/`).
**Which finish-line item does this close?** None yet. It makes the fight a round you can win and lose, which the hub card needs.

Ry's playtest of pass 3, in short: feels very slow, shots slow, enemies low detail, still too zoomed out, the round never ends, the fight is point-and-shoot-and-wait, siphon reads as an RPG/RTS bank, fleet orders unclear and not working, parameter sidebar can go. Later the same day: ricochets should hurt, wants a score readout, a mini-map, the round's numbers in a sidebar, and the ultradrive lock-on and jump animation back.

## What changed

| Ask | Built |
|---|---|
| Player much faster than enemies | Lead ship 62 u/s (boost 105). Airkrill dive 24, aircrab dart 21, Bellwether 8. |
| Enemies turn slower | Creatures swim along their FACING and turn at a capped rate (`GF_KINDS.turn`), slowing while they come about. |
| Faster shots | Bolts 204 u/s (was 60), swept collision so they can't step over an airkrill. |
| Closer zoom | Fight view 40 to 105 units (was 55 to 700). Creatures and the ship drawn larger. |
| Fleshy aircrabs | `gf-flesh.js`: lobes, veins, ribs, teeth, tendrils, sphincter vents; The Tide as a wall of flesh. |
| The Tide spawns, from an orifice | The hive is THE TIDE. Three orifices swell (2.5 s tell), dilate (5 s) and push a brood out. No other spawning. |
| The round must end | Seal all three orifices (hurt only while swollen or open), then clear the flood: WIN. Lose on the third lost ship or at 7:00. |
| Floods, tact, risk when inflated | Bounced bolts are live ricochets (5 hull, about 30 units of reach) and each bounce adds pressure; at full pressure the body RUPTURES (aircrab 12 units, Bellwether 22), hurting ships, killing soft bodies, chaining through armoured ones, and burning the siphon. Vent open on inhale AND exhale, so flanking pays more often than waiting. |
| Siphon as a capacitor | Holds 100, leaks 12/s once 4 s pass without a pickup. R = call a bot (34). G = dump the rest into hull. Only clean kills drop it. |
| Fleet orders | `gf-wing.js`: up to 5 bots, F switches FOLLOW (formation, fire only to wound) and HUNT (break off, flank, fire at will). The whole wing fires about as fast as the lead ship. The engine's E mode is off in the game. |
| Sidebar | The parameter panel is hidden (`?dev` brings it back). A game sidebar shows clock, score, orifices, hull, capacitor, wing and order, SITE radar, ORBIT strip, keys. |
| Score | Running in the sidebar, itemised on the end card (`GF_SCORE`). Clean kills pay 10x what burst ones do. |
| Ultradrive cues | The jump spool (2 s) wears gl-ultra.js's infinity glyph, hum, ticks, launch boom, beam, warp streaks and drop-out whoosh. Bots called with R, and the wing after a jump, drop out of ultradrive one by one. |

## How this sits with the breath canon

Inflated is still the stronger state: bolts cannot wound it, and forcing it costs you (ricochets, a blast, no siphon). Two bends of the hub canon, both for Ry to confirm before they go into the bestiary: the vent is also open on the exhale, and an inflated body can be burst.

## Not in this pass

Sites 1 and 2 and the trip between them, classes and class weapons, the hex bay, the kamikaze ram, the hub card, sound for ruptures and births. Balance numbers are first guesses: no human has played this build.

## Checks

`node scripts/check-undefined-globals.js` and `check-global-collisions.js` pass. Headless Chromium run: no page errors, a round driven to the win card, jump and bot drop-in exercised.

## Flood pass 2 (2026-11-15, after Ry's first playtest of it)

Ry: "Massive improvement." Too easy; ruptures and ricochets not punishing or noticed (too easy to wipe a flood from afar); wants sound for orifices and ruptures; labels cheesy; sidebar simpler; airkrill hard to see; the ultradrive beam lagged the ship and the dust read as spinning lines; raise the challenge but stay clear of "Zombie in space".

| Ask | Built |
|---|---|
| Harder | Airkrill dive 36 u/s (was 24) and bite for 5. Broods 4 aircrabs + 12 airkrill (was 3 + 8), cap 85 alive. Orifices 60 hp (was 36), shut 15 s (was 22). Blaster reach about 90 units (was 115). |
| Ruptures punish | A body at full pressure now has a 0.55 s FUSE (strobe, whine) and then throws bone SHARDS all round (10 from an aircrab, 20 from a Bellwether, 8 hull each, about 85 units of reach). The scream FRENZIES every creature within 90 units for 5 s: 45% faster, turning harder, hunting from any range. Soft bodies only die in the inner 60% of the blast. |
| Ricochets noticed | A bolt off armour comes BACK at whoever fired it (7 hull, about 80 units), drawn as a fat red bolt, with a ping on the bounce and a zap plus a red frame when it lands. Keep moving and it passes behind you. |
| Not Zombie in space | The added pressure comes from the rules that are this game's own (breath, flanking, pressure, the orifice windows, the clock), not from a bigger horde alone: a careless shot now makes the fight worse. |
| Sound | `gf-sfx.js`: orifice swell and open, births, seal, armour strain that climbs with pressure, fuse, rupture, frenzy screech, ricochet ping and zap, clean-kill pop, siphon pickup, a Bellwether toll on each inhale, tendril alarm, hull hit, order change, deny, mend, win and lose. |
| Labels | No words on creatures or orifices. An orifice wears a ring (countdown while shut, what it has left while it can be hurt). Target arrows have no text; one that can be hurt pulses yellow. Banners and the end card are terse. |
| Sidebar | 220 px, no sentences: clock, score, three orifice icons, hull, siphon with R and G key caps, wing pips with the F order toggle, the two maps. Keys show along the bottom for the first 30 seconds. |
| Airkrill clarity | Larger, a dark keyline and a glow (hot while they can bite), lighter body and tail. |
| Beam and dust | The beam is closed to the ship's drawn position each frame (it was a frame of jump travel behind). Dust specks are dots at flying speed and only streak under boost or jump; all three layers now move slower than the play plane. Warp streaks follow the jump line, and the spool only hints at them. |

## Flood pass 3 (2026-11-15, after Ry's second playtest)

Ry: ricocheted bolts shifted in space when he changed trajectory, and the spool streaks tilted with the ship. Breathing out of sync made it "hard to know when would be best to shoot", so he was "almost constantly ricocheting while dodging". Time for more sites: "3 sites along the way with slightly different enemy profiles at different satellites to clear", and "there needs to be a reason why these are cleared first before going to the hive".

| Ask | Built |
|---|---|
| Ricochets shifting | A bolt's streak was drawn along its velocity relative to the ship, so every bolt swung when the ship turned. It is now drawn along its own path through space. The bolts themselves never moved wrongly. |
| Spool streaks tilting | No warp streaks during the 2 s spool (glyph, hum and ticks only). Streaks start with the jump and follow the jump line. |
| Breath out of sync | ONE breath per site (`GF.breath` 6 s). Every creature of a site inhales, holds and exhales together, with a slight ripple outward from the site (`GF.breathWave`). A breath gauge sits at the bottom centre: green = vents open, red = armoured. The site sounds its inhale and exhale. |
| Bellwether | It no longer owns the sync. A clean kill on one WINDS every creature near it for 4.5 s (soft, vents open): the opening you earn by flanking the alpha. |
| Sites | `gfSites`: RELAY (a comms satellite, airkrill-heavy, 2 orifices of 30 hp), DRYDOCK (a shipyard satellite, aircrabs and Bellwethers, 2 orifices of 45 hp), THE TIDE (3 orifices of 60 hp). The satellites sit either side of the straight line home to hive, so the route bends. A site sleeps until a ship is within 2500 units. |
| Why clear them first | The Tide's orifices are CLAMPED (bone bars, cannot be hurt) while either satellite is held. Freeing the relay raises the wing cap from 3 to 5 and sends 2 bots. Freeing the drydock refits the hull and loads 5 seekers. Either order. |
| Round | Clock 8:00 (was 7:00) for three sites. This is over the hub's 2 to 7 minute rule; it needs Ry's playtest to say whether to trim the sites or note the exception. |
| Sidebar and maps | Orifice icons grouped per site, the next stop marked on the ORBIT strip, one unlabelled marker toward the next site. The play view is now centred left of the sidebar. |

Canon bends still waiting on Ry for the bestiary: vents open on the exhale, an inflated body can be burst, breath is site-wide (the Bellwether winds its brood when killed rather than conducting it).

Checks: both repo scripts pass. Headless run: hand-aimed jump brakes at the relay, each site breathes in one phase, both boons land, The Tide unclamps, win card, no page errors, 60 fps. No human has played this pass.

## Flood pass 4 (2026-11-16, after Ry's third playtest)

Ry: "game balance speed is much improved & getting there."

| Ask | Built |
|---|---|
| Stray circles on every enemy | The pale "armour rib" arcs in `gfLobe` were drawn with the wrong sweep and left three circles hanging off each body. Gone. |
| Lungs that inflate | `gfLobe` / `gfLobePath`: a lobe is a sac on the windpipe (narrow apex, wide base, flat inner face). Slack it is a pleated bag; air glows outward from the hilum, pleats open and fade, the base fills last, the bronchi fan out, alveoli bead up. The windpipe, mouth and vent change size far less than the lobes. Gulps of air run down the windpipe on the inhale and back up on the exhale. |
| Mouth | `gfDrawMaw`: a lamprey mouth. Lumpy gum collar, a swallowing throat, three rows of uneven needle teeth with gaps, ropes of spit. It gapes when it lashes. |
| Tendril circles | The dotted reach ring round armoured bodies and the ring that closed on a held ship are both gone. A held ship shows the break pips and a thin time bar. |
| Longer to die when caught | `GF.grabTime` 6.5 s (was 3); hull drain while held 3/s (was 6). |
| Keys by the right hand | H = FOLLOW / HUNT, J = call a bot, K = mend (were F, R, G). In `?dev` the panel toggle moved from H to B. |
| The breath as a wave | `gfDrawBreathFronts`: an amber front with a red wake rolls out from the site as the inhale arrives, and a green front as the soft window arrives (the gauge's colours). The wave is slower (`GF.breathWave` 120 u/s, was 220) so the front takes about a second to cross the screen. |
| Bot drop-in | White flash, hard shock ring, flare, sparks, heavier shake, a low boom. The arrival throws back everything within 24 units, winds aircrabs for 2 s (Bellwethers 1 s), kills airkrill, and breaks any tendril hold. |

Proposed, not built: the inflation bump as a mechanic, and the crew ships (brief in the thread, with an L+G dev menu).

## Pass 5 (2026-11-16): crush and launch, six crew, aftermath

Ry's calls: build bump suggestion 1 only; K = each crew member's ability; all six crew at rough quality; bots fire a weaker copy of their leader's weapon. Also, for every hub game: a casual / hardcore switch at the start of a session (Gyro Fleet's current tuning stays as it is for now), and a few seconds of aftermath after death before the score. The hub-wide doc changes are with the hub thread; the aftermath is built here.

**Crush and launch** (`gf-crabs.js`, in `gfUpdateCreature`). Two big bodies overlapping on the inhale no longer slide apart: most of the push is stored as `c.crush`, and they are drawn squashed and shuddering along the line they will be thrown down. When the breath is full, each crushed body is fired straight out from the pack (`GF_KINDS.launch`: aircrab 62 u/s, Bellwether 24) and TUMBLES for 1.3 s: no steering, no tendrils, and any shot wounds it. A thrown body rams a ship in its way (16, Bellwether 26). Sounds: creak, then a thump.

**Six crew** (`gf-crew.js`, new). Hull shape and colour, primary, and K ability:

| Crew | Hull | Speed | Primary | K |
|---|---|---|---|---|
| Greer, gunner (gold, twin prongs) | 100 | 1.0 | twin blaster | OVERCHARGE 40: 5 s, 1.8x fire, double damage, no ricochets |
| Maren, medic (green, round with a cross) | 90 | 1.0 | siphon beam: 30 units, never ricochets, drains what it can wound, feeds the capacitor | MEND: the whole charge into your hull, the rest into the wing |
| Elodie, engineer (orange, box with a tow arm) | 100 | 0.95 | drifting proximity mines | SENTRY 40: a gun on the spot for 14 s |
| Soren, scout (white, needle with fins) | 75 | 1.18 | needle rail: slow, long, pierces soft bodies, marks armour for double damage, no ricochet | SLIP 30: 3.5 s, 1.7x speed, tendrils cannot hold |
| Bex, butcher (lime, ram prow) | 120 | 1.05 | scatter: six pellets, short reach, they do ricochet | RAM 40: a dash; soft bodies die clean, armoured ones are lit and thrown; impact frame |
| Booke, bulwark (blue, shield crescent) | 150 | 0.88 | flak that bursts at the cursor | SHIELD 35: 5 s bubble, nothing hurts or holds what is inside |

Wing bots are drawn as a small copy of the leader's hull and fire the same weapon, slower and weaker (`gfCrewFire(..., weak)`). The seeker stays shared. Every number is a first guess.

**Dev menu.** Hold L and G together. 1 to 6 pick the crew (remembered in localStorage), 7 to 9 go to a site, 0 fills the siphon, minus toggles no damage, equals refills the hull and adds a bot. Clickable too.

**Aftermath.** `gfEndRound` now starts `gfRound.after` (3.5 s, `GF_AFTER`): the world keeps moving under closing bars, the ship does not relaunch, and only then does the score card come up. A win cannot be lost during it.

Checks: both repo scripts pass. Headless: menu opens on L+G, all six crew fire and use K with no page errors, launches happen, the aftermath holds 3.5 s, and the three-site run still reaches the win card.

## Pass 6 (2026-11-16): grapple, battle lines, allies

After Ry's playtest of pass 5.

| Ask | Built |
|---|---|
| Grapple | A holder BITES on a beat: every 1.6 s (`GF.grabTick`), 34 hull (`GF.grabDmg`) and a red flash of the whole view. Three bites take Greer's 100 to the last-stand point. No slow drain, no kill timer. |
| Last stand | Any blow that would kill the lead ship from above 1 hull leaves it on 1 instead, with 3 s (`GF.lastStand`) in which nothing can hurt or hold it (white ring round the ship). At 1 hull the next blow kills. |
| Ricochet while held | A bolt that hits the body holding a ship is spent on the tendrils: it counts toward the break (3 hits) and never bounces. While a ship is held, none of its bolts bounce off any armour. A broken hold cannot be retaken for 1.5 s (`gfBreakGrab`). |
| Ruptures punish more | Shards: aircrab 16 (was 10), Bellwether 32 (was 20). |
| Battle limits | Each site has a BATTLE LINE at its skin + 330 units (`gfZoneR`), drawn as a dashed line in space and on both maps. Inside a held site's line the drive is locked; anywhere outside it the ultradrive spools, whatever is chasing you. A lamp on the radar says DRIVE or DRIVE LOCKED. (It was "no creature within 600 units", which nobody could see.) |
| Hopping | A jump now drops out on the battle line of ANY site, freed or held, and at home, so you can aim roughly at a place and hop to it. |
| Elodie | Mines come from a stock of 4 that refills one every 2.4 s (pips over the ship), at most 4 live, 2 damage (was 3) and 1 pressure (was 2). |
| Bones | A clamped mouth is laced shut with two rows of interlocking ribs and a row of vertebrae down the seam. |
| Maps | The radar is always true to scale and changes its RANGE instead: it fits the battle line in a fight and reaches out to the nearest site in open space, with a labelled range ring and the jump's aim line. The route strip shows sites at their real positions with battle lines to scale and a 5k scale bar. |
| Allies | Dev menu (L+G): Shift+1..6 adds an allied crew ship, Backspace clears them. Each flies its own way (`GF_ALLY`): Greer flanks, Maren stays close and mends you, Elodie mines what closes in, Soren ranges wide and marks, Bex goes in close, Booke puts itself between you and the nearest threat. Allies do not use K abilities yet. |

Checks: both repo scripts pass. Headless: a forced hold reads 100, 66, 32, then 1 with the last stand, then death on the next hit; the drive unlocks one step outside the line; allies spawn and fight; the three-site run still wins; no page errors.

## Pass 7 (2026-11-16): the satellite freed, the beam, the swarm (`gf-cine.js`)

Ry asked for a short animation when a satellite's growth is cleared, and a new ending: the mothership's beam through both satellites bursts the weakened hive, and the airkrill it releases are the last fight.

- **Satellite freed (4.2 s).** The view cuts to the satellite. The growth swells, strobes and bursts off it, and its brood dies with it. The lights stutter on, green. It swings its dish to the hive and a green sight snaps on, and stays on for the rest of the round.
- **The beam (8.6 s).** Starts when The Tide's last mouth is sealed (phase `beam`). A route board shows the beam leave the mothership and take relay, drydock and hive one eased leg at a time. Cut to the hive: the beam walks across the body leaving a burning scar, and the hive bursts into a husk.
- **The swarm.** 450 airkrill (`GF_CINE.swarm`), always soft and frenzied, fed out of the husk so there are never more than 90 alive. A violet bar at the top shows what is left. The last one wins the round. The clock gets 75 more seconds when the swarm starts. This replaces "everything left floods you".
- During a set piece the lead ship and wing cannot be hurt and the clock stops. `gfCineCam` borrows the view and hands it back.

"Thousands" is 450 for now: the creature update compares every body with every other, so the count that stays smooth is in the hundreds. The burst throws several hundred extra flesh particles to sell the scale.

Checks: both repo scripts pass. Headless: both satellite sequences, the beam, the burst, the swarm fed to zero and the win card, no page errors, 56 fps with 90 airkrill alive. A canvas `filter` in the first draft stalled the software renderer and was replaced with a plain strobe.

## Pass 7b (2026-11-16): finale sound, and the game ends on the burst

Ry, after seeing pass 7: sound for the satellites' lasers and cues for the aiming and for slicing the hive; remove the hive once it is killed and the lasers after that; scrap the airkrill swarm, "the game should just end at that point".

- **Sounds** (`gf-sfx.js`): `servo` (the satellite swinging round, with a clunk when it stops), `sight` (the green sight snapping on, and its hum), `charge` (the mothership gathering the shot), `leg` (each leg of the beam, a step higher each time, with a struck tone as it lands), `slice` (a steady burn that rises as the beam crosses the hive), `hiveburst`.
- **The ending.** When the hive bursts it is gone: not drawn, not solid, off the maps. The satellites' sights go out. The round is won on the burst; the view holds on the empty space through the 3.5 s aftermath and then the score comes up. The swarm code is still in `gf-cine.js`, never started.

Checks: both repo scripts pass; headless run through both satellites and the beam to the win card, no page errors. The sounds are written but not heard by anyone yet (the test browser has no audio).
