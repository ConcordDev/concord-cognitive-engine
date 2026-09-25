# RIG_CREATURE

Creatures do not use `ConcordiaLocomotion` and do not retarget Mixamo humanoid clips. Topology comes from the existing fauna sheets (B2–B6). This matrix is the clip list those rigs need. Coverage (2026-09-22) still shows creature and fauna-social verbs missing, so every row below is a **target**, with a procedural fallback that is allowed to ship before a bespoke clip exists.

No ridden-horse loop. Tack and lead are props. `Driving_Loop` is not a mount.

## Shared graph

Parameters: `Speed` 0–1, `Alert` bool, `Action` trigger (hit, death, eat). One layer. Foot phase is a float 0–1 derived from distance traveled, not from `Time.time` alone, so a paused sim freezes the gait.

## Quadruped ungulate (stag, wagon horse, herd)

Bones: spine chain, four limbs, neck, head. Antlers or ears parented to head.

| state | clip target | procedural until a clip exists |
| --- | --- | --- |
| quad.idle | weight shift, head dip | spine sine, amplitude small |
| quad.walk | four-beat | foot phase, spine counter-rotate |
| quad.trot | two-beat diagonal | same phase, shorter period |
| quad.gallop | rotary gallop | only if Speed > 0.85 |
| quad.graze | head down | neck pitch, legs planted |
| quad.alert | head up, one ear | neck + ear, no step |
| quad.hit | flinch | spine kick, then idle |
| quad.death | collapse | hip drop, legs fold once |

Stag antlers stay inside body width in every pose so the 100 m read stays a tall wedge. Horse has no rider bone and no saddle animation. B26 tack (`veh_tack_draft_collar`, `veh_lead_rope`, `veh_hitch_rope`) is a separate prop parented to the harness, not a sit clip. Cycle 2 adds `veh_horse_halter` and `veh_feed_bag` on that same lead. Neither mesh contains a bit or a horse. `quad.gallop` is the herd animal alone. It is not a mounted camera. `faun_wind_pronghorn` uses this graph with no bridle.

## Small prey (hare)

| state | clip target | procedural |
| --- | --- | --- |
| prey.idle | nose, ear twitch | ear bones |
| prey.crouch | body pebble, ears half | scale spine down |
| prey.bolt | ears flat, bound | ears fold on Speed > 0.5 |

## Bird (court pigeon and kin)

| state | clip target | procedural |
| --- | --- | --- |
| bird.idle | perch, tail | body bob |
| bird.hop | two small steps | — |
| bird.takeoff | crouch then wing down | — |
| bird.flap | wing cycle | wing sinusoid |
| bird.land | wings brake | — |
| bird.perch | feet lock | IK to branch or lintel |

Flock is instanced idle/flap. Do not give each pigeon a unique timeline.

## Insect (lantern moth)

Hover only: two wing bones, figure-eight procedural. No legs cycle. Light is the lantern material, not a creature emissive eye.

## Humanoid-topology elites

If a creature or boss is actually a CX humanoid (cultist, bandit, warden), use `RIG_HUMANOID_BIPED.md`. Skull masks, extra limbs, and quadruped bosses stay on this graph. Do not merge more than the donor topology the bible already allows.

## Boss accent

One extra state, `boss.tell`: a slow windup that reads at 100 m (arm raise, wing spread, neck coil) before the strike. Strike reuses the family hit or a single authored clip later. No rifle windup.

## What not to generate

No new creature meshes in B21. B2–B6 fauna prompts stay as they are. `B25_creatures_dawn` is the Permanent Dawn fill below. `B25_creatures_crucible` is the Crucible fill after that.

## Permanent Dawn (B25_creatures_dawn)

Pad marten and arterial hound use `quad.*`. The marten tail is one bone and stays a horizontal bar in idle and walk. The hound collar is a static neck ring; the gap stays open in every pose.

Plane dove uses `bird.*`. Flock is instanced idle and flap.

Olive lizard:

| state | clip target | procedural |
| --- | --- | --- |
| sprawl.bask | belly down, throat patch visible | spine flat |
| sprawl.skitter | short legs, body stays a diamond | foot phase |

Gap Lion uses `quad.*` plus `boss.tell`: neck rises, the shoulder ring lifts, the gap stays open. Strike is one paw (`quad.hit`). The ring never closes. No beam bone. No rider.

Street mobs (alley finisher, arterial kicker, pad grappler) are CX humanoids on `RIG_HUMANOID_BIPED.md`. Strikes are `Punch_Jab` and `Punch_Cross`. The kicker's extended leg and the finisher's stopped fist are bind poses. There is no authored kick clip. `Pistol_*` stays unbound. No rifle windup.

Cycle 2 uses the same graphs. Pier duck, gutter sparrow, and lip swift use `bird.*`. The duck stands on the pier stone. There is no swim clip. The sparrow pin stays vertical. The swift chevron is the perch, then `bird.flap` only in the air. Canopy moth uses insect hover: two equal panels, then they close. No emissive eye. Apron cat uses the feline graph (`quad.idle`, `quad.walk`, `quad.alert`), ears flat, stub tail vertical, stalk speed capped. Stoop palm, pier bar, and spire column are CX. Strikes stay jab and cross. The palm, the cloth shoulder bar, and the stopped vertical arm are bind poses. Spawn weight 0. Gap Lion stays the only `boss.tell` on this batch.

## Atlas mobility (cycle 2)

A herd animal on a Crown Road or a finished march uses `quad.walk`. `quad.gallop` is not the 5 km/h clock. Walker edges do not put a rider on the wagon horse or a bridle on the wind pronghorn. Sea edges do not add a swim clip to a stag, a hound, or a bird. The waystone is a human scramble, not a creature graph. Mixamo stays off this rig.

## Crucible (B25_creatures_crucible)

Seam Skink and Quartz Newt use `sprawl.*`. The skink stays a bar. The newt stays a pebble. The quartz rib misses the belly in bask and skitter.

Fault Hare uses `prey.*`. The two ear bars stay unequal in idle, crouch, and bolt.

Comma Mite:

| state | clip target | procedural |
| --- | --- | --- |
| critter.idle | body still, long leg twitches | one bone |
| critter.scuttle | stubs step, long leg trails | foot phase |

Moth hover stays on the Unclosed Moth. The mite has no wing bones.

Rib Frame, Vent Jack, and Gap Bracket use `creature_construct`. They are not CX humanoids and do not retarget Mixamo.

| state | clip target | procedural |
| --- | --- | --- |
| construct.idle | weight on both feet, gap held open | slow sway |
| construct.step | two-beat, torso unfilled | foot phase |
| construct.hit | rib edge, chisel, or plate slam | one swing |
| construct.death | collapse, gap stays open | hip drop once |

Gap Bracket adds `boss.tell`: the open arm lifts and the bracket does not close. Strike is `construct.hit` as a plate slam. No beam. No rifle windup. No face bone. Spawn weight 0 until a later density slice.

Cycle 2 uses the same graphs. Fold pillbug and fault cricket use `critter.*`. The pillbug notch stays open. The cricket antenna stops short. Shard lark uses `bird.*`. The shard tail stays down on the perch. `bird.flap` only in the air. Road toad and lichen snail use `sprawl.*`. The toad stays a wide triangle. The snail spiral does not close, and `sprawl.skitter` has no foot phase. Fold Clamp, Anchor Shard, and Fault Sled use `creature_construct`. They are not CX bodies. They do not use `boss.tell`. Strikes are a plate edge, a shard tip, or a runner bump. Gap Bracket stays the only Crucible `boss.tell` on this batch. Spawn weight 0. Construct cap stays 0.

## Ruins ash underworld (B25_creatures_ruins)

Staple Beetle uses `critter.*`. The iron bar stays flat across the oval in idle and scuttle. Six legs are short. No thin-leg cycle.

Vault Bat uses `creature_bird` with `bat.hang` in place of `bird.perch`: feet lock to a rib, the body is a downward triangle, ear bars stay short. `bird.flap` opens the triangle only in the air, then `bird.land` folds it again. No glowing-eye bone.

Ash Grub:

| state | clip target | procedural |
| --- | --- | --- |
| grub.curl | comma tight, pale ring visible | spine bend |
| grub.inch | comma lengthens, no legs | spine wave |
| grub.hit | curl tighter | one pulse |
| grub.death | comma still | no pop |

Cinder Newt uses `sprawl.*`. The body stays a bar. The tail stays a rod. It does not become the rib-lizard diamond.

No boss tell. The Unfinished stays the Ruins boss. Spawn weight 0. `Pistol_*` stays unbound.

## Sere wound (B25_creatures_sere)

Drowned Eel:

| state | clip target | procedural |
| --- | --- | --- |
| eel.glide | the S travels, lump stays behind the head | spine wave |
| eel.lunge | S shortens, no hood | one thrust |
| eel.hit | S flattens | spine kick |
| eel.death | S slack, lump stays | hip drop once |

No basilisk hood. No flame bone.

Lip Newt uses `sprawl.*`. The tail stays a closed hook in bask and skitter. The throat patch is a material, not a light.

Tar Crab:

| state | clip target | procedural |
| --- | --- | --- |
| crab.idle | wedge still, one claw up, stump closed | claw twitch |
| crab.sidle | thick legs, body stays a wedge | foot phase |
| crab.hit | claw dips | one swing |
| crab.death | wedge down, stump stays a stump | hip drop once |

Scrub Finch uses `bird.*`. The wing bar stays one dark stripe while the wings are closed. Flock is instanced idle and flap.

No boss tell. The Compound Mark stays the Sere boss. Spawn weight 0. `Pistol_*` stays unbound. No rifle windup.

## Deep pass (A19, `B21_anim_deep`)

Controller name is `CreatureGraph`. It is not `ConcordiaLocomotion`. One layer. Parameters: `Speed` 0–1, `Alert`, `Airborne`, `Action`, `Phase`. Phase advances with distance traveled and holds when the sim pauses. Reduced motion snaps to the bind pose and sets amplitude to 0. A missing clip stays on the procedural column. Do not author a new fauna mesh for this pass. Machine bind: `CREATURE_VEHICLE_DEEP.json`.

| graph | motion while no clip exists | holds |
| --- | --- | --- |
| quad | four-beat offsets 0, 0.5, 0.25, 0.75; trot is the diagonal pair; spine yaw about 0.08 rad | gallop only if Speed > 0.85 and the animal is not led |
| feline | same legs, spine low, tail curl; stalk keeps Speed ≤ 0.35 and spine scale 0.85 | `faun_court_cat` only |
| prey | ear bones, crouch, bolt | hares and the sodium rat |
| bird | bob, hop, flap 2 Hz perched and 4 Hz on takeoff, amplitude ≤ 35°, fold to 0° on the ground | flock shares one phase; vault bat uses `bat.hang` |
| flyer_cat | quad with wings folded on the ground; flap and tuck the legs in the air; dive pitch about −40° so the read is a cross | griffin, dustgriffin, cursebeak; canvas and hood are materials or one head bone |
| harpy | wing bones are the arms; legs use the bird cycle | no CX jab, no Punch clip |
| serpent | spine wave, one hood bone, strike shortens the S | fold basilisk, held curse, pollenwyrm, lattice basilisk; ribs and the crest gap stay open; no wing bones on the held curse |
| eel | spine wave; the lump stays behind the head | drowned eel and salt wyrm; no hood |
| amphib | land slides as a loaf; water swings the paddle bones about ±25° | Nil sealie; the land read stays a loaf |
| sprawl | bask or skitter; the body shape in the fauna sheet stays | lizards, skinks, newts |
| insect | two wing bones, figure-eight | lantern moth and lattice moth |
| critter | stub step; a long leg or an iron bar trails flat | roach, comma mite, staple beetle |
| crab | sidle | tar crab; the stump stays a stump |
| grub | curl and inch | ash grub |
| polyped | six pillar legs; shell pitch ≤ 4° | rib crawler |
| hover | bob ≤ 0.06 m, slow yaw, lens pulse | census drone; no propeller bones |
| quad_disc | quad on the hound; the disc bone spins only while `Airborne` | billdrone; on the ground the disc is still |
| construct | two-beat, one swing, gap held open | rib frame, vent jack, gap bracket, count sentinel, uncounted construct, census construct |
| tripod | three legs at 120° | mercy sentinel and the Un-Ender |
| hang | rings turn in place | the Census; no walk cycle |
| drift | core bob, three shards on a fixed radius | extra shards stay VFX |
| slab | two-beat; the long arm is the strike | the Unfinished |
| kiln | two-beat; the brand skirt stays; the eye is `boss.tell` | Compound Mark; no flame tongue |
| wraith | cowl bob, no feet | unfinished wraith, mercy wraith |
| humanoid_cx | `RIG_HUMANOID_BIPED.md` | alley finisher, arterial kicker, pad grappler, road watcher |

`boss.tell` is still one slow windup at 100 m, then the family strike. Led wagon horse clamps Speed at 0.45 and never gallops. The wind pronghorn stays unbridled. `Driving_Loop` is not a mount. `Pistol_*` stays unbound. No rifle windup.
