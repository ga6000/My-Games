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
