# ANIM_MASTER

**STATUS: COMPLETE** (cycle 0, slice A01, batch `B21_anim_specs`)
**Worlds:** Hub, Fantasy (Sundering), Tunya, Ruins, Crime, Cyber, Frontier, Superhero, Crucible, Sere.
**Controller:** `ConcordiaLocomotion` (existing). Do not add a second locomotion stack.
**Avatars:** `Assets/Concordia/Generated/Rig/CX_Humanoid_Male.fbx`, `CX_Humanoid_Female.fbx`. Humanoid retarget only when `Avatar.isHuman && Avatar.isValid`.
**Clip source of truth on disk:** `Assets/Concordia/Generated/UAL1_CLIP_INDEX.txt` (Quaternius UAL1 Standard, CC0, in-place + `_RM` copies). Coverage audit: `Assets/Concordia/Generated/Animation/COVERAGE.md` (2026-09-22). This file is the bind contract for the gaps that audit names. It does not claim those gaps are already filled.

Per-rig matrices: `RIG_HUMANOID_BIPED.md`, `RIG_CREATURE.md`, `RIG_VEHICLE.md`. Machine rows: `CLIP_BIND_MATRIX.json`.

## Bind order

1. Split and bind UAL1 sub-clips that already match a verb (in-place for the blend tree, `_RM` only for committed roll / attack / jump).
2. Keep KCC Ethan clips as fallback only where UAL1 has no turn clip. Do not present Ethan Idle as a light attack.
3. Mixamo and Kevin Iglesias melee fill named gaps below. Do not import their character meshes. Do not check Mixamo FBX into a public pack.
4. Where the source column says `MISSING`, play the named procedural fallback. Do not invent a clip asset name and do not ship a silent success.

Grok Imagine MP4 is motion reference only. It is not a Mecanim clip.

## Controller needs

One Animator on the CX body. Parameters:

| Param | Type | Drives |
| --- | --- | --- |
| `Speed` | float 0–1, damp 0.12 | idle → walk → jog → sprint |
| `MoveX` | float −1–1 | strafe when a strafe clip exists; until then lateral lean only |
| `Grounded` | bool | jump loop vs land |
| `Crouch` | bool | crouch idle / crouch fwd |
| `Combat` | bool | upper-body mask: sword idle or fist guard |
| `Action` | trigger | one-shot: attack, jab, cross, roll, interact, pickup |
| `Emote` | int | talk, sit, dance, torch |
| `SoftEnter` | bool | arrival idle, see below |
| `Torch` | bool | night lantern hold |

Layers: **Base** (locomotion, full body), **UpperBody** (arms + spine mask, combat and talk), **Additive** (emote, hit flinch). Crossfade 0.10–0.20 s. Inertialize overlays. Foot IK lock. Stride warp to locomotion speed. No `LateUpdate` full-body fight pose on top of the controller.

Hub fight style is karate, plus the flower blade at rest. Arena sand (about 8 m around local (0, 18)) may show steel. Do not bind UAL1 `Pistol_*` into this controller. Firearms stay unbound. No rifles.

## SoftEnter idle

On arrival, set `SoftEnter` for one beat. Blend about 0.33 s into `Walk_Formal_Loop` if the body is moving, otherwise `Idle_Loop`. Night practical: `Idle_Torch_Loop` when the hand holds a lantern. Reduced motion cuts to the pose with no blend. Do not open on dance, death, spell, or an attack. Flower Law is the Hub disk of 42 m; the arrival pose does not draw a weapon inside that disk unless the feet are on Arena sand.

## Mixamo / retarget

- Retarget onto the CX Humanoid avatar (Rocketbox biped already copied into `Generated/Rig`). Quaternius **clips** may drive that avatar. Quaternius **bodies** are not Concordia people.
- Muscle-space map is the usual Mixamo humanoid definition (`mixamorig:Hips` → Hips, and the limb chain). Compare against UAL1 `A_TPose` in the editor. The runtime bind pose is the CX avatar, not a Mixamo Y-bot mesh.
- In-place: bake root XZ off locomotion loops. Keep root motion on Roll, Sword_Attack, Jump_Start/Land when the commit should move the capsule.
- Commercial use of Mixamo clips inside the finished game is the intended path. Raw FBX stays out of any redistributable pack.
- Do not use DeepMotion free-tier or Cascadeur Free output in a commercial ship. A later Court-idle or Brackish gait can come from a paid video-to-FBX pass. Until then, Brackish (1.42 m, still CX) uses the same walk clip with a shorter stride scale (`1.42/1.75`) and no separate clip file.
- Do not build a motion-matching database until the locomotion set below is actually bound (the on-disk bar is 80+ locomotion clips; UAL1 is the start, not that library).

## Organic / procedural alternatives

Animation specs are not TRELLIS jobs. `B21_anim_specs` mesh rows are only the three skinned cards in `CLIP_BIND_MATRIX.json` (`anim_org_*`): flower sprig, hall banner strip, hanging awning cloth. Feed `aura_prompt` verbatim. Explicit LOD0. Do not prepend the creature sheet wrapper.

When a body clip is missing:

- **Breath, cloth, face:** existing procedural / secondary / facial paths (coverage already marks those families full). Banner and awning wind is a shader or a 3-bone card, not a fake full-body loop.
- **Strafe and turns:** lateral lean and a yaw on `Walk_Loop` until a real strafe clip is imported.
- **Heavy attack and knockdown:** scale `Sword_Attack` or `Hit_Chest` in time and add a hip drop. Label the state `procedural` in the animator comment.
- **Sweep / bench work:** `Fixing_Kneeling` or `Interact` as a labeled stand-in, not a broom cycle.
- **Quadruped, bird, insect:** `RIG_CREATURE.md`. Do not retarget Mixamo humanoid onto a stag, hare, pigeon, or moth.
- **Wheels and hitches:** `RIG_VEHICLE.md`. `Driving_Loop` is a human seated clip. Do not use it as a horse or as a driver inside Flower Law.

## Mesh-bound organic rows (this batch only)

| id | Why it is a mesh | LOD0 |
| --- | --- | --- |
| `anim_org_flower_sprig` | One bloom, two bones, urn and collar | 800 |
| `anim_org_hall_banner_strip` | Unlettered cloth strip, three bones, council hall | 1500 |
| `anim_org_hanging_awning_cloth` | One hanging awning, four bones, market bay | 1800 |

Folded awning bundle is a static prop (`prop_hub_se_awning_bundle`, B23), not this card.

## Worlds beyond Hub

The same humanoid matrix serves every world. Weapon upper-body swaps with the world's tool (ward-blade, dock hook, spear, fist, invoice knife). No rifle overlay on Frontier. Creature families stay on the creature graph even when a world has a humanoid elite. Vehicle math is shared; Hub wagon and Frontier cart use the wheel formula, not a new controller.

Permanent Dawn street mobs in `B25_creatures_dawn` (alley finisher, arterial kicker, pad grappler, and cycle 2 stoop palm, pier bar, spire column) use this humanoid graph: `Punch_Jab`, `Punch_Cross`, empty hands. Their signature poses are mesh binds. Dawn animals and the Gap Lion stay on `RIG_CREATURE.md`. Cycle 2 fauna add no new clip.

Crucible seam fauna, the Rib Frame, the Vent Jack, and the Gap Bracket (`B25_creatures_crucible`) stay on `RIG_CREATURE.md`. Cycle 2 adds five seam animals and three construct meshes on those same graphs. Constructs are not CX bodies. The bracket tell is `boss.tell` and stays the only one. Strikes are a rib, a chisel, a plate, a plate edge, a shard tip, or a runner bump. `Pistol_*` stays unbound.

Ruins ash-underworld fauna (`B25_creatures_ruins`) and Sere wound fauna (`B25_creatures_sere`) stay on `RIG_CREATURE.md`. Beetle and grub are critters. The vault bat and the scrub finch use the bird graph. Both newts sprawl. The eel glides. The crab sidles. No new boss tell. `Pistol_*` stays unbound.

Iron Coast and Grid density (`B22_npc_spoke`) stay on this humanoid graph. Chain hand (Wing Chun) and bridge runner (Capoeira idle bias) use `Punch_Jab` and `Punch_Cross` with empty hands. The centerline stack and the back-foot weight are mesh binds, not new clips. Dock hook, switchknife, and pulseblade remain the existing B7 upper-body swaps. The foundry mallet has no swing clip and stays down. `Pistol_*` stays unbound. No rifle overlay.

Cycle 2 district cloth uses those same two clips with empty hands. Ghost shoulder, block diamond, blank disc, case hip, and cuff bars are Wing Chun. Cut cuff, clinic roll, and the open ring are Capoeira back-foot bias. The diamond, the cylinder, the disc, the case, the cuff bars, and the open ring are mesh binds. They have no swing clip. Spawn weight 0.

Sundering grove and ash, and Tunya terrace and ark (`B22_npc_fantasy`), stay on this humanoid graph. Wardrobe and face rows add no clips. `Sword_Attack` stays on `npc_role_sunder_guard` only. Grove and ash density cards keep the blade down. Tunya terrace and ark use `Punch_Jab` and `Punch_Cross` with empty hands. Capoeira is a back-foot mesh bias. The seed jar, the quilt patch, and the rib collar are costume. `Pistol_*` stays unbound. No rifle overlay.

Cycle 2 grove, ash, terrace, and ark cloth uses that same graph and adds no clip. The seed cuff, bark apron, soot collar, split sleeve, stem cord, eave shawl, rib wrap, and lamp hem are costume. The eight new faces are busts. Grove and ash keep the blade down. Terrace and ark stay on jab and cross. Spawn weight 0. `Pistol_*` stays unbound.

Ruins, Frontier, and Sere density (`B22_npc_edge`) stay on this humanoid graph. Wardrobe and face rows add no clips. Ruins cards keep the blade down. `Sword_Attack` stays on `npc_role_ruins_elite` and the existing Ruins blades. Frontier (Muay Thai) and Sere (Wing Chun) use `Punch_Jab` and `Punch_Cross` with empty hands. The wagon-iron spear stays the road warden. The invoice knife stays the tessera enforcer. The shin bands, the collar pin, the slate, and the cairn stick are costume. `Pistol_*` stays unbound. No rifle overlay.

Hub and Frontier travel (`B26_vehicles`) does not add a ride controller. `faun_wagon_horse` stays on the ungulate graph: `quad.idle` and `quad.walk` while led. No gallop-with-rider. `mount_wind_pronghorn` stays `faun_wind_pronghorn` with no bridle and no new clip. Carts, the spare wheel, the sail, and the Link barrow use `RIG_VEHICLE.md` (`veh.parked`, `veh.roll`, `veh.sail_luff` on the sail only). `Driving_Loop` stays unbound. The human who pushes uses `Walk_Loop` beside the prop.

Cycle 2 travel on that same graph adds a halter and an empty feed bag on the led horse, a tongue, a singletree, a brake shoe, and a tailgate on `prop_wagon`, a rolled canvas that does not luff, a water cradle and a travois with no wheel spin, a Pinewood bogie at radius 0.26 m, and a Link step skid plus a stop bar that forces parked. No new clip. No bit. No saddle. `Driving_Loop` stays unbound.

Grid and Iron Coast travel (`B26_vehicles_urban`) uses that same vehicle graph. Push is `Walk_Loop` beside the prop. Flanged wheels, iron tires, the loader's small wheels, and the pallet-jack rollers use `veh.roll`. The drone sled and the wharf skid are runners, so they stay `veh.parked` or slide with no wheel spin. `mon_grid_drone` and `hyb_billdrone` stay on `RIG_CREATURE.md`. The sled does not borrow a fly clip. `Driving_Loop` stays unbound.

Held weapons (`B27_weapons`) stay on this humanoid graph. One-hand edges use `Sword_Attack`. Heavy bars, tongs, the chisel, the wedge, the caliper, and the arena pruner use a time-scaled `Sword_Attack` labeled procedural. Poles use that fallback as a thrust. Inside the 42 m disk the petal sheath uses `Sword_Idle` and the pruner stays down. The Ruins sinew bow has no release clip and stays holstered. The Dawn glass disc has no throw clip. Wound coal is a hold. The glow is VFX. `Pistol_*` stays unbound. No rifle overlay. Dawn empty-hand mobs do not pick up the baton.

Cycle 2 tools on that same graph add no clip. Inside 42 m the bud staff and the thorn pin use `Sword_Idle`, and the petal rake and the seed cup stay down. Their steel skins, arena sand only, use a procedural thrust, `Sword_Attack`, a procedural heavy, or a hold. The bone pick, the cinder awl, and the pad hook use `Sword_Attack`. The ash mallet, the slab bar, the soot rake, the stretcher pole, and the seam brush use procedural heavy. The reach rod uses a procedural thrust. The quiet plate and the cool cube are holds. The clinker throw is missing. The sinew bow and the glass disc stay unbound. `Pistol_*` stays unbound. No rifle overlay. Dawn street mobs stay empty-handed. Crucible gaps stay open.

Grid gadgets and Crucible tools (`B27_gadgets`) stay on this humanoid graph. The fiber spool, corner bar, conduit snips, open clamp, nested rod, blank key, horseshoe, seam roller, slag spoon, open wrench, and quartz file use a time-scaled `Sword_Attack` labeled procedural. The drift awl and the pin punch use `Sword_Attack`. The cracked loupe, tally click, gap block, and broken loop are holds. The blank puck has no throw clip. The bridge runner stays empty-handed. The nested rod stays collapsed. `Pistol_*` stays unbound. No rifle overlay. Crucible gaps stay open. Construct cap stays 0.

## Deep pass (A19)

Creature bodies use `CreatureGraph` in `RIG_CREATURE.md`. Carts, runners, hitches, and the Frontier sail use `VehicleRoll` in `RIG_VEHICLE.md`. The bind table is `CREATURE_VEHICLE_DEEP.json`. Batch `B21_anim_deep` adds two spec rows and no mesh. `ConcordiaLocomotion` stays the CX humanoid controller. A griffin, a harpy, a serpent, a drone, and a cart do not retarget Mixamo. `Driving_Loop` stays unbound. `Pistol_*` stays unbound.

## Atlas mobility (cycle 2)

W05's 31 edges do not add a travel Animator. The map is `MOBILITY_BIND.md`. A gate plaque (34 m, inside the 42 m disk) plays `Walk_Formal_Loop`, then SoftEnter idle on the far side. Crown roads and finished marches play `Walk_Loop` at the 5 km/h read. Walker edges and the unfinished Crucible–Grid seam play the same walk with stride scale 0.7. The waystone scramble may use `Crouch_Fwd_Loop`. `trav.climb` stays missing. Sea edges, including the cost class called a river barge, spawn no hull, oar, or sail-ship. `Driving_Loop` stays unbound. Sere has no gate. Batch `B21_anim_mobility` is one spec row and no mesh.
