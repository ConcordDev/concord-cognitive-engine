# Aura bind notes (asset-catalog)

## Provenance
- Organic meshes: live registry `Assets/Concordia/Models/Generated` (do not invent a second mesh tree).
- Concept stubs: `unity_bind.prefab_folder` under `Assets/Concordia/Generated/LookFeel/Concepts/<id>/`.
- Asset-catalog mirrors (text): `Assets/Concordia/Generated/AssetCatalog/`.
- CX bodies already at `Assets/Concordia/Generated/Rig/CX_Humanoid_{Male,Female}.fbx`. Wardrobe rides that rig.

## SoftEnter and interiors
- Bind `arch_hero_*` onto native-bible `unity_bind.kit_id`. Hub kit is `arch_kit_hub_court`.
- B23 props and B24 interior modules set `parent_hall` to `arch_hero_hub_council_hall` (awning cloth parents `arch_hero_hub_market_facade`). `softenter_landmark` is false. `softenter_adjacent` or `interior` is true.
- Snap: architecture 4 m, clutter 1 m. Door clear 1.2 × 2.2 m on the door leaf.
- Flower Law is the Hub disk of 42 m. Do not place live steel as clutter inside it. Arena sand, about 8 m around local (0, 18), is the steel exception for a warden at rest.
- Notice board, spines, shutter, and banner are unlettered. Pinewood Crossing stays on `prop_pine_milepost` / `env_hub_pinewood_milepost` only.
- Cold hearth and ash pan have no flame mesh.

## Hub hero dressing (B23 cycle 2)

- Twenty-four rows, same batch `B23_props_softenter`. File `batches/B23_props_softenter_cycle2.json`, merged into `props/HUB_SOFTENTER_PROPS_B23.json` (count 38). The first fourteen stay on `arch_hero_hub_council_hall`.
- Kit `arch_kit_hub_court`. `softenter_landmark` is false. `softenter_adjacent` is true. Snap 1 m. Door clear 1.2 × 2.2 m stays empty. No lettering. No flame mesh. No rifle.
- Market apron, parent `arch_hero_hub_market_facade`, `flower_law` `outside_42m`. Counter, trade weight, shutter stay, corked jar, awning stone, empty tray. Off the awning cloth. The B23 market six stay. `prop_market_crate`, `prop_scale_pan`, `prop_tool_broom`, and `prop_hub_se_stool` stay.
- Arena apron, parent `arch_hero_hub_arena_gate`, `flower_law` `inside_42m`. Sand pail, wood practice post, gate coil, empty flask, gate pin, sand block. The block is a sit target. The pin is a drop fitting. Drawn steel stays on the warden. `prop_arena_rack` stays. Sand already on the gate mesh stays on that mesh.
- Pinewood bay, parent `arch_hero_hub_pinewood_stable`, place Hub (62, -28), outside the 56 m wall and outside the 42 m disk. Hay rack, still trough, empty peg, grain scoop, half-door latch, salt lick. No horse. No rider. `prop_pine_milepost` stays the only lettered milepost. Draft collar, hitch rope, wagon pin, and salt keg skid stay on `B26_vehicles`.
- Council interior, parent `arch_hero_hub_council_hall`, `interior` true, `flower_law` `inside_42m`. Ink pot, closed book, quill, cold wax, side chair, empty hod. Beside `arch_int_hub_council_table` and `arch_int_hub_hearth_cold`. The nine B24 modules stay. The side chair is not `prop_hub_se_bench`. The hod is not `prop_hub_se_ash_pan`. The book is not the archive shelf.

## Hub Court openings (B24 cycle 2)

- Sixteen rows, same batch `B24_arch_interior`. File `batches/B24_arch_interior_cycle2.json`, merged into `architecture/HUB_INTERIORS_B24.json` (count 25). Notes `architecture/COURT_OPENING_KIT.md`. The first nine council modules stay. B19 heroes stay.
- Kit `arch_kit_hub_court`. `softenter_landmark` is false. `interior` and `softenter_adjacent` are true. Unlettered. No glass sheet. No flame mesh. No rifle. Door clear 1.2 × 2.2 m stays empty.
- Opening parts snap at 1 m. Floor and wall bays snap at 4 m.
- Council door kit, parent `arch_hero_hub_council_hall`, `flower_law` `inside_42m`: jamb, door head, stone sill, reveal. The leaf stays `arch_int_hub_door_leaf`. The head is not the hero lintel. The sill is not `prop_hub_se_threshold_mat`.
- Council window kit, same parent: empty frame, one mullion, sill, open casement. The shutter stays `arch_int_hub_shutter_leaf`. The stay stays `prop_hub_se_shutter_stay`. The flower box stays a prop.
- Council dress at 4 m: wainscot, gallery rail. The banner stays `anim_org_hall_banner_strip`.
- Market interior, parent `arch_hero_hub_market_facade`, `flower_law` `outside_42m`: plank floor, stall post with an iron shoe. Not `arch_int_hub_council_floor`. Not the facade grab rail.
- Arena interior, parent `arch_hero_hub_arena_gate`, `flower_law` `inside_42m`: passage floor, limestone pier. No iron band on the pier. The double door stays the hero. Drawn steel stays on the warden.
- Stable interior, parent `arch_hero_hub_pinewood_stable`, place Hub (62, -28), outside the 56 m wall, `flower_law` `outside_wall`: packed-earth floor, empty stall rail. No horse. The half-door stays on the hero. The latch stays `prop_hub_se_half_latch`. The milepost stays the only Pinewood lettering.

## Tunya interiors (B24_arch_tunya)

- Nine rows. Kit `arch_kit_tunya_veil`. Parent `arch_hero_tunya_terrace_hall`. File `architecture/TUNYA_INTERIORS_B24.json`.
- Eight jobs at 4 m snap: floor, living-wood ceiling, seed table, dye shelf, shutter leaf, interior stair, hold-hook wall, door leaf. Door clear 1.2 × 2.2 m.
- Ninth is `arch_int_tunya_solar_tile`, one matte square on a short stand, 1 m snap. It is not `env_tunya_solar_eave` and it is not painted into the ceiling.
- Place inside the hall, off `flora_tunya_terrace_tree`. The terrace lip first frame stays the hall exterior, the eave, and the tree with three fruits. Loose fruit is not a mesh.
- `softenter_landmark` is false. `interior` and `softenter_adjacent` are true. Pots and the door are unlettered. The hold-hook is empty. No flame mesh. No circuit lines in the albedo.
- Leave `arch_hero_tunya_graft_facade`, `arch_hero_tunya_canopy_stair`, `arch_hero_tunya_fluxom_lockhouse`, `env_tunya_terrace_lip`, and `env_tunya_masond_cliff_stair` as they are. Fluxom Gate at Tunya-local (62, 18) m is not Pinewood Crossing. Flower Law stays the 42 m Hub disk and does not move onto this kit.
- B23 crime clutter stays props. The eight remaining spokes are `B24_arch_rest`.

## Tunya openings (B24 cycle 2)

- Sixteen rows, same batch `B24_arch_tunya`. File `batches/B24_arch_tunya_cycle2.json`, merged into `architecture/TUNYA_INTERIORS_B24.json` (count 25). Notes `architecture/VEIL_OPENING_KIT.md`. The first nine terrace modules stay. B19 heroes stay.
- Kit `arch_kit_tunya_veil`. Parent `arch_hero_tunya_terrace_hall` only. `softenter_landmark` is false. `interior` and `softenter_adjacent` are true. `flower_law` is `outside_hub_disk`. Unlettered. No glass. No fruit. No flame mesh. No rifle. Door clear 1.2 × 2.2 m stays empty.
- Opening parts snap at 1 m: jamb, door head, threshold, reveal, empty window frame, mullion, window sill, reed screen. The leaf stays `arch_int_tunya_door_leaf`. The shutter stays `arch_int_tunya_shutter_leaf`. The head is not the hero lintel. The threshold is not `env_tunya_terrace_lip`. The reed screen is not `flora_tunya_cliff_reed` or `flora_tunya_dye_reed`.
- Wall bays snap at 4 m: wainscot, gallery rail. The rail is not `arch_hero_tunya_canopy_stair` and not `env_tunya_masond_cliff_stair`. The wainscot is not the floor bay.
- Set dressing snaps at 1 m except the soffit (4 m): seed bench, empty planter, soffit, niche, loom frame, graft post. The bench is the seat the seed table left open. It is not `prop_hub_se_bench` or `prop_tunya_cl_palm_rest`. The planter is empty. The soffit is not `arch_int_tunya_wood_ceiling` and not `env_tunya_solar_eave`. The niche is not the dye shelf. The loom has no warp and is not `prop_tunya_cl_fiber_hank`. The graft post is not `arch_hero_tunya_graft_facade` and has no `prop_tunya_cl_graft_peg`.
- `pattern_slot` names the reusable job: door_jamb, door_head, threshold, reveal, window_frame, mullion, window_sill, screen_leaf, wainscot, gallery_rail, bench, planter, soffit, niche, loom_frame, graft_post. This pass fills those slots in living wood and limestone only. Other spokes do not receive these meshes here.
- Place inside the hall, off `flora_tunya_terrace_tree`. Fluxom Gate at Tunya-local (62, 18) m is not Pinewood Crossing. Flower Law stays the 42 m Hub disk.

## Remaining interiors (B24_arch_rest)

- Seventy-two rows. File `architecture/REST_INTERIORS_B24.json`. Eight worlds, nine rows each. `softenter_landmark` is false. `interior` and `softenter_adjacent` are true. Door clear 1.2 × 2.2 m. Eight jobs snap at 4 m. The ninth snaps at 1 m.
- Fantasy on `arch_hero_sunder_shrine_hall`, kit `arch_kit_fantasy_sunder`. Ninth is `arch_int_sunder_cloth_fold`. It is not `anim_org_hall_banner_strip`. No glow. No staff.
- Ruins on `arch_hero_ruins_catalogue_hall`, kit `arch_kit_ruins_ash`. Spines are blank blocks. Ninth is `arch_int_ruins_blank_spine`. No mask. No letters. Catalogue hall hero stays.
- Crime on `arch_hero_crime_tenement_bay`, kit `arch_kit_crime_coast`. The cage bulb stays `prop_crime_se_cage_bulb`. The sconce is an empty hook block. Ninth is `arch_int_crime_drip_sill`. Bay, roll door, escape, and street lamp stay. No neon. No sign.
- Cyber on `arch_hero_cyber_bridge_hall`, kit `arch_kit_cyber_grid`. Cyan is not painted into the albedo. Ninth is `arch_int_cyber_tube_sleeve`. No digits. No giant shoulders. Place inside the hall, off the sky floor.
- Frontier on `arch_hero_frontier_cabin_hall`, kit `arch_kit_frontier_road`. Ninth is `arch_int_frontier_eave_knee`. No dome. No weapon rack. The Last Dome stays unplaced.
- Permanent Dawn on `arch_hero_dawn_spire_hall`, kit `arch_kit_superhero_dawn`, world id Superhero. Ninth is `arch_int_dawn_brass_line`, the only brass line. No energy mesh. Roof pad stays.
- Crucible on `arch_hero_crucible_lattice_hall`, kit `arch_kit_crucible_lattice`. The hem stops. Ninth is `arch_int_crucible_open_hem`. The teal cup is the sconce and is not a furnace eye. No flame. Construct cap stays 0.
- Sere on `arch_hero_sere_tally_hall`, kit `arch_kit_sere_mark`. Ninth is `arch_int_sere_soot_course`. Brand tile stays `prop_brand_tile` and `env_sere_brand_tile`. No letters. No flame. The furnace eye stays in the stack.
- Flower Law stays the 42 m Hub disk and does not move onto these kits. Heroes in B19 stay. Do not regen them as interior modules.

## NPCs (B22)
- CX proportions, Concordia face. Not a Quaternius body.
- Crowd strip at 100 m: hod wedge, sprig, apron-plus-pan, tabard shoulders, satchel square, scholar chain. Those six must separate.
- Brackish adult is 1.42 m, stride scale about 0.81, same humanoid clips.
- Faces are busts of the same CX face with a brow, lines, one scar, ink, windburn, or age. No new species.
- Animator: existing `ConcordiaLocomotion`. Parameters and masks: `animations/ANIM_MASTER.md` and `RIG_HUMANOID_BIPED.md`.
- Upper body uses UAL1 sword idle, jab, and cross. `Pistol_*` stays unbound. No rifles.
- SoftEnter arrival: `Idle_Loop` or `Walk_Formal_Loop`, 0.33 s blend, cut when reduced motion is on. Night lantern uses `Idle_Torch_Loop`.

## NPCs (B22 plaza — cycle 2)

- Sixteen rows, same batch `B22_npc_hub`. File `batches/B22_npc_hub_plaza.json`. Notes `characters/PLAZA_DENSITY.md`. The first twenty Hub rows stay. B7 laborer, stallkeeper, warden, scholar, courier, and urchin stay.
- CX body, Concordia face. Kit `arch_kit_hub_court`. Parent `arch_hero_hub_council_hall`. `softenter_landmark` is false. `softenter_adjacent` is true. Flower Law disk is 42 m. Door clear 1.2 × 2.2 m stays empty.
- New 100 m reads, and only these, added to the original six: rope coil on a tall shoulder, yoke with two jars, bell sphere on a youth thigh, one brass chest bar, dark lantern cage at the hip, one sand band on the left forearm. Wardrobe (night cloak, yoke pads, page sash, flour smock) and the four face busts are not that strip.
- Page is 1.58 m, stride scale 0.9. Taller than the Brackish adult. Not the plaza urchin. Well hand is 1.92 m.
- Page and door bar use `Walk_Formal_Loop`. The lantern cage uses `Idle_Torch_Loop` and stays unlit. No flame mesh. The sand band stands on the plaza lip, not on arena sand. Drawn steel stays on the warden, on the sand. `Pistol_*` unbound. No rifle.

## NPCs (B22 spoke — Iron Coast and Grid)

- Eighteen rows, batch `B22_npc_spoke`. CX body, Concordia face. Kits: `arch_kit_crime_coast`, `arch_kit_cyber_grid`, shared `arch_ix_grid_coast`.
- B7 stays: dock laborer (cap, hook comma), ledger bandit (hood, one pauldron, knife low), uncounted tech (visor up, coil), census officer (visor down, ankle coat). Do not restyle those four.
- Crowd strip at 100 m for the first eighteen: folder under the arm, centerline fists, mallet block at the thigh, high closed collar, slate square on the chest, one thick rust sleeve, low square Delgado coat, diagonal bill strap, throat notch with a disc, one cyan vertical stripe. Cycle 2 adds eight more reads below.
- Wardrobe cards (oilskin, soot apron, shell jacket, split cuff) and the four face busts are not that strip.
- Wharf splice, split cuff, and split-lamp face are Crime and Cyber together. Sodium wins the rain. One cyan accent.
- Chain hand and bridge runner use `Punch_Jab` and `Punch_Cross`. Empty hands. Coast fight style is Wing Chun. Grid empty-hand bias is Capoeira. The foundry mallet is costume and is not `wpn_imp_forge_hammer` (that id is Hub, Fantasy, Frontier).
- Bill strap holsters `wpn_throw_coast_invoice` on the cord. Slate clerk uses `prop_count_slate` with no digits. Delgado cut uses `prop_rose_pin` and no drawn knife. It is not a named guest plate.
- Door clear 1.2 × 2.2 m on warehouse, bridge hall, and hatch. `softenter_landmark` and `softenter_adjacent` are false. Flower Law does not apply on these kits. `Pistol_*` unbound. No rifle.
- Animator: `ConcordiaLocomotion`. See `animations/RIG_HUMANOID_BIPED.md`.

## NPCs (B22 spoke — cycle 2 district cloth)

- Sixteen rows, same batch `B22_npc_spoke`. File `batches/B22_npc_spoke_cycle2.json`. Notes in `characters/COAST_GRID_SILHOUETTE.md`. The first eighteen stay. B7 dock laborer, ledger bandit, uncounted tech, and census officer stay.
- CX body, Concordia face. Kits `arch_kit_crime_coast` and `arch_kit_cyber_grid`. `softenter_landmark` and `softenter_adjacent` are false. Flower Law does not apply. Spawn weight 0. Mob caps stay as they are. `named_plate` is false.
- New 100 m reads, and only these: shoulder square, back diamond with fists down, one bare wrist, cloth cylinder under the arm, blank brass disc on a long coat, vertical case at the hip, two pale cuff bars, open belt ring. Wardrobe and the four face busts are not that strip.
- Ghost shoulder stands on the warehouse apron, outside the 1.2 × 2.2 m clear, out of the SoftEnter first frame. Block diamond, blank disc, and case hip stand on the tenement rise, off the stoop, off the escape tread, and off the posted bill. Cuff bars use the apron edge. Grid rows stand in the alley, off the sky floor. Named set `sky_bridge` stays unplaced.
- District placement uses `WorldGeography.DeterministicOffset`. Do not copy the S09 fixed step onto these meshes.
- Empty hands. Coast fight style is Wing Chun. Grid bias is Capoeira. `Punch_Jab` and `Punch_Cross` only. The open ring is costume and is not a B27 clamp or horseshoe. The disc has no numeral. The case has no lettering. Blackout cloth has no neon. `Pistol_*` unbound. No rifle.
- Federal field cloth, Nevex, Polysteel, and the AI-rights storefront still have no strip.

## NPCs (B22 fantasy — Sundering grove and ash, Tunya terrace and ark)

- Twenty rows, batch `B22_npc_fantasy`. File `characters/FANTASY_TUNYA_NPC_B22.json`. CX body, Concordia face. Kits: `arch_kit_fantasy_sunder`, `arch_kit_tunya_veil`.
- B7 stays: Sundering ward (knee cloak, cap, ward-blade), curse-bearer (wrapped hands), terrace laborer (straw disc, back basket), grove factor (green sash, wooden scale). Do not restyle those four.
- Crowd strip at 100 m, and only these: closed crest disc, pale hem band, solar square at the hip, one quilt rectangle on the chest. Wardrobe cards and the eight face busts are not that strip.
- Grove sits wildwood west, off the salt track, outside the shrine first frame. Ash sits on the east march beside `flora_sunder_grove_ash`. Do not use `flora_ruins_ash_cypress`. Do not merge ash-meets-moss into a fourth world.
- Terrace dresses the lip beside `arch_hero_tunya_terrace_hall`, off the three-fruit tree. Ark cloth is design-intent on the Masond stair or the Aekon rib. No new kilometre pin. Fluxom Gate (62, 18) local metres is not Pinewood Crossing.
- `Sword_Attack` stays on the ward. Grove and ash cards keep the blade down. Terrace and ark use `Punch_Jab` and `Punch_Cross`. Capoeira is a back-foot mesh bias. The seed jar, quilt patch, and rib collar are costume. No ice spell on the hold face. `Pistol_*` unbound. No rifle.
- `softenter_landmark` and `softenter_adjacent` are false. Flower Law does not apply on these kits. Animator: `ConcordiaLocomotion`. See `animations/RIG_HUMANOID_BIPED.md`.

## NPCs (B22 fantasy cycle 2 — outfits and faces)

- Sixteen rows, same batch `B22_npc_fantasy`. File `characters/FANTASY_TUNYA_NPC_B22_CYCLE2.json`. The first twenty stay. CX body, Concordia face. No new body species.
- Grove: seed cuff (one pod on the left wrist), bark apron (open sides, above the knee), wet brow, thorn nick. The cuff is not the curse-bearer's wrapped hands. The apron is not the knee cloak and not the moss hip tube.
- Ash: soot collar (hood folded down, face bare), split sleeve (one elbow, one full), ash lid, dry lip. Not the pale smock, not the fork sash, not the Ruins catalogue hood, not `flora_ruins_ash_cypress`.
- Terrace, parent `arch_hero_tunya_terrace_hall`: stem cord (empty knot, no fruit), eave shawl (stops at the shoulder blades), sun cheek, husk brow. Fruit stays on `flora_tunya_terrace_tree`. Not the straw disc, not the back basket, not the solar shoulder square, not the clay cylinder.
- Ark, design-intent Masond stair or Aekon rib, no new kilometre pin: rib wrap (cloth diagonal, no metal), lamp hem (one warm bead), warm jaw, rust thread. Not the quilt rectangle, not the metal rib collar, not the hold-lamp rim split, not the salt hairline.
- These sixteen are not 100 m strips. Closed crest, hem band, solar hip tab, and quilt square stay the only crowd reads. Spawn weight 0. Mob caps stay as they are. `named_plate` is false.
- `Sword_Attack` stays on the ward. Grove and ash keep the blade down. Terrace and ark use `Punch_Jab` and `Punch_Cross`. Capoeira is a back-foot mesh bias. `Pistol_*` unbound. No rifle.

## NPCs (B22 edge — Ruins, Frontier, Sere)

- Eighteen rows, batch `B22_npc_edge`. File `characters/EDGE_NPC_B22.json`. CX body, Concordia face. Kits: `arch_kit_ruins_ash`, `arch_kit_frontier_road`, `arch_kit_sere_mark`.
- B7 stays: Catalogue Keeper (hood, stylus, chained book), Unburial Elite (gorget, great weapon on the back), Road Warden (wide hat, duster, wagon-iron spear), Dome Bandit (hat, yoke collar, skinner), Tessera Enforcer (chest brand tile, invoice knife). Do not restyle those five.
- Crowd strip at 100 m, and only these: a cold-iron stub at the Ruins hem that stops, a forearm-length stick across the Frontier back, one pale flood line at the Sere hem. Wardrobe cards and the three face busts are not that strip.
- Ruins forum rows stand outside `arch_hero_ruins_catalogue_hall`. Door clear 1.2 × 2.2 m stays empty. Rib pin and iron cuff stand beside `env_ruins_rib_bridge`, off the span. No victory plaza. No skull. The ash cypress stays the forum tree.
- Frontier rows stand beside `env_frontier_walker_cairn` or `env_frontier_relay_post`, outside the cabin first frame. The rope coil is costume on one body. `faun_wagon_horse` stays a separate mesh. No rider. The Last Dome stays unplaced. No dome roof.
- Sere tally rows stand outside `arch_hero_sere_tally_hall`. Door clear stays empty. Tide hand and the hem band are flooded-lowland design-intent. No new kilometre pin. Tally House stays a political name. The waystone stays arcless. No flame mesh. The furnace eye stays in the stack.
- Ruins density cards keep the blade down. `Sword_Attack` stays on `npc_role_ruins_elite` and the existing Ruins blades. Frontier and Sere use `Punch_Jab` and `Punch_Cross` with empty hands. Muay Thai is the Frontier stance. Wing Chun is the Sere stance. The spear stays the warden. The invoice knife stays the enforcer. Shin bands, the collar pin, the slate, and the cairn stick are costume. `Pistol_*` unbound. No rifle.
- `softenter_landmark` and `softenter_adjacent` are false. Flower Law does not apply on these kits. Animator: `ConcordiaLocomotion`. See `animations/RIG_HUMANOID_BIPED.md`.

## Animations
- Humanoid: retarget UAL1 first (in-place blend tree, `_RM` for roll, jump commit, sword attack). Mixamo clips retarget onto the CX avatar only. Do not import a Mixamo mesh. Do not check Mixamo FBX into a public pack.
- Missing states stay procedural and labeled. Do not pretend Ethan Idle is a light attack.
- Creatures: `RIG_CREATURE.md`. No Mixamo humanoid on stag, hare, pigeon, moth, or horse. No rider.
- Vehicles: `RIG_VEHICLE.md`. Wheel rate is speed over radius. `Driving_Loop` is not a mount and not a Hub driver.
- Skinned cards only: `anim_org_flower_sprig` (2 bones), `anim_org_hall_banner_strip` (3), `anim_org_hanging_awning_cloth` (4). Folded bundle `prop_hub_se_awning_bundle` is static.
- Grok Imagine MP4 is reference, not a Mecanim clip.

## Permanent Dawn creatures (B25)
- WorldId `Superhero` only. Kit `arch_kit_superhero_dawn`. The Hub plaque at (0, −34) m is the Court marker. It is not this city's disk, and it is not Flower Law.
- Existing rows stay: `faun_aegis_kestrel` (anchor stoop), `mon_dawn_mercy_sentinel` (tripod, barrel arm, brass halo), `mon_grid_sentinel` (door shoulders), `hyb_dawnjackal`, `hyb_mercywraith`.
- New fauna: pad marten on `env_dawn_roof_pad` (horizontal tail bar), plane dove on the park plane, olive lizard on the square roof planter, arterial hound on the Bronx Arterials (open collar).
- Street hostiles are CX bodies and Concordia faces: alley finisher (coat and stopped fist, low-rent arterial), arterial kicker (horizontal leg, Bronx Arterials), pad grappler (broken arm ring, roof pad). Controller `ConcordiaLocomotion`. Strikes `Punch_Jab` and `Punch_Cross`. Empty hands.
- Gap Lion is the mini-boss: park edge beside the mercy plaza, outside the ring. Shoulder ring lifts in `boss.tell` and the gap stays open. Paw strike. The plaza heart stays empty. It is a living animal.
- Mercy shock, when used, is the existing gold ring that stops. No killing beam. No rifle. `Pistol_*` unbound.
- Dove may dress the SoftEnter park plane (`softenter_adjacent`). The lion, the hound, and the street mobs do not occupy the first frame.
- Cycle 2 adds eight rows in `batches/B25_creatures_dawn_cycle2.json`. The first eight stay. Gap Lion stays the only mini-boss.
- New fauna, spawn weight 0: pier duck on the arterial pier stone (square bill, no swim clip), canopy moth under the clinic canopy (closed equal square, no glow), gutter sparrow on `terr_dawn_lowrent_pad` (vertical tail pin), apron cat on the spire apron outside `arch_hero_dawn_spire_hall` (rectangle, stub tail), lip swift on the launch lip (chevron perch, off Kane's fin).
- New street hostiles, spawn weight 0, CX body, Concordia face, empty hands: stoop palm (flat palm, clinic stoop), pier bar (cloth bar on the shoulders, arterial pier), spire column (narrow coat, arm stopped vertical, spire apron). Strikes stay `Punch_Jab` and `Punch_Cross`. The launch hook stays a separate tool.
- These eight do not enter S15 windows, the mercy plaza heart, the north nest, campus air, the spire–college gap, or the unplaced spire floor. Elite budget, mystic budget, and `enc_unfinished_sunrise` stay as they are.

## Crucible creatures (B25)
- WorldId `Crucible`. Fauna kit `arch_kit_crucible_lattice`. Vent Jack uses `arch_ix_crucible_foundry` and stays unplaced with that kit.
- Existing rows stay: `faun_lattice_moth`, `mon_crucible_drift`, `mon_boss_unender`, `hyb_latticebasilisk`. The moth keeps the asymmetric wings. The drift keeps three shards. The Un-Ender keeps the open ring on three legs.
- New seam fauna: skink (bar, crack stops), fault hare (unequal ears), quartz newt (rib misses the belly), comma mite (one long leg). Hooks are `env_crucible_seam_rock`, `flora_crucible_fault_moss`, and `flora_crucible_seam_lichen`, outside the named gaps.
- Rib Frame is an open arch on two legs. Vent Jack is a short block and one pipe that joins nothing, chisel down. Gap Bracket is the mini-boss: standing bracket, lilac only inside the gap, `boss.tell` lifts the open arm.
- `spawn_weight` is 0. S17 caps, moth nights, basilisk mornings, Un-Ender nights, drift pairs, the 7.66 m throat, and the unseated 8 m bay stay as they are. Construct cap stays 0. These meshes do not enter the SoftEnter first frame.
- No CX face on a construct. No rifle. `Pistol_*` unbound. No ninth.
- Cycle 2 adds eight rows in `batches/B25_creatures_crucible_cycle2.json`. The first seven stay. Gap Bracket stays the only mini-boss. Lilac stays inside that gap.
- New seam fauna, spawn weight 0: fold pillbug on `env_crucible_basalt_fold` (oval, notch stays open), shard lark perched on `env_crucible_shard_anchor` (wedge, one shard tail down, flap only in the air), fault cricket on `env_crucible_quartz_fault` (chip, one antenna stops), road toad on `env_crucible_broken_road` (wide triangle, mouth line stops), lichen snail on `flora_crucible_seam_lichen` (open spiral, off the leaning stair).
- New constructs, spawn weight 0, cap stays 0, unplaced: Fold Clamp (open A, plates do not meet), Anchor Shard (one column shard, one foot), Fault Sled (low rectangle, runners stop short). They do not use `boss.tell`. Strikes are a plate edge, a shard tip, or a runner bump.
- These eight do not enter S17 gaps, the 7.66 m throat, the 8 m bay, district anchors, wilds 90–126, or the SoftEnter first frame.

## Vehicles (B26 — Hub and Frontier)

- Fourteen rows, batch `B26_vehicles`. Kits `arch_kit_hub_court` and `arch_kit_frontier_road`. Existing meshes stay: `faun_wagon_horse`, `faun_wind_pronghorn`, `prop_wagon`, `prop_hitching_rail`, `prop_yoke`, `prop_canteen`.
- Mounts are lead or follow. `mount_wagon_horse` wears `veh_tack_draft_collar` (`item_horse_tack`). No saddle, no stirrup, no rider bone, no `Driving_Loop`. Do not ride through the 42 m plaza.
- `mount_wind_pronghorn` has no bridle row. Penning still fails `q_frontier_pale_flag`. The terrace goat is Tunya and is not in this batch.
- Salt wagon is `prop_wagon` plus `veh_wagon_pin` and `veh_trace_hook`, hitched at the Pinewood side outside the 56 m wall. Camera stays on foot.
- Wind wagon is the same `prop_wagon` plus `veh_frontier_wind_sail`. State `veh.sail_luff`. The sail is not a roof and not a dome.
- Push carts are new meshes: `veh_hub_handcart` (empty bed may sit in the market) and `veh_frontier_handcart` (open road). They are not a retint of each other and not the Iron Coast wharf cart.
- Concord Link perimeter: `veh_link_hub_barrow` and `veh_link_halt_chock` park past the 56 m wall. `veh_frontier_road_chest` stays on the Frontier side. None of them enter the plaque at (−34, 0). The Link remains a two-minute step.
- Spare wheel `veh_spare_iron_wheel` pivots on the axle hole. Radius about 0.42 m. Spin is speed over radius.
- `softenter_landmark` and `softenter_adjacent` are false. Frontier SoftEnter first frame stays cairn and ruts, not a sail roof. No lettering. No rifle. `Pistol_*` unbound.
- Cycle 2 adds twelve rows in `batches/B26_vehicles_cycle2.json`. The first fourteen stay. `faun_wagon_horse`, `faun_wind_pronghorn`, and `prop_wagon` stay.
- Lead tack: `veh_horse_halter` (noseband, one ring, no bit) and `veh_feed_bag` (empty sack). They parent the harness of `mount_wagon_horse`. They are not a saddle. The pronghorn still has no bridle row.
- Wagon parts on `prop_wagon`, outside the 42 m disk: tongue, singletree, brake shoe, closed tailgate, rolled canvas. The canvas does not use `veh.sail_luff`. The sail stays `veh_frontier_wind_sail`. The tailgate is `veh.door` from 0° to 90°. The brake shoe is not `veh_link_halt_chock`.
- `veh_water_keg_cradle` is runners and a wet bung. It is not `veh_hub_salt_skid`. `veh_frontier_travois` is two poles and a hide bed, no wheels, dragged while the horse walks. It is not `veh_pack_frame`.
- `veh_pinewood_log_bogie` parks at Pinewood (62, −28), outside the wall. Radius 0.26 m. The bunk is empty. The fallen limb stays a terrain mesh. It is not `veh_hub_handcart`.
- Link perimeter: `veh_link_step_skid` and `veh_link_stop_bar` park outside the 56 m wall and do not enter the plaque at (−34, 0). The bar forces `veh.parked`. It is not a weapon. The Link stays a two-minute step. `Driving_Loop` stays unbound.

## Vehicles (B26 urban — Grid and Iron Coast)

- Ten rows, batch `B26_vehicles_urban`. File `vehicles/URBAN_GRID_COAST_B26.json`. Kits `arch_kit_cyber_grid`, `arch_kit_crime_coast`, and shared `arch_ix_grid_coast`. Travel props. `traffic_sim` is false. No cockpit. No rider. `Driving_Loop` stays unbound. The human pushes with `Walk_Loop` beside the prop.
- Cyber rows park on the measured sky floor from (−25.77, −58.0) to (−19.37, −62.8), inside the Zero circle. Named set `sky_bridge` stays unplaced. Do not author a bridge coordinate. `env_cyber_skybridge_segment` stays its own mesh. The sky-bridge cart snaps to that module when it is instanced. The cart prompt does not contain the bridge.
- `veh_grid_rail_dolly` is the volume dolly: two flanges, radius 0.18 m, empty bed. `prop_cable_coil` and `veh_cyber_blank_slate` ride on it and are separate meshes. The slate has no digit. `veh_cyber_rail_shoe` is the spare flange, same radius, axle hole is the pivot.
- `veh_cyber_drone_sled` is a plank and an empty ring. Runners, so ω is unused. `mon_grid_drone` and `hyb_billdrone` stay fauna and are not parented to the sled. No rotor. No fly clip.
- `veh_wharf_cart` is the volume wharf cart: wet timber, iron tires, radius 0.32 m, beside `env_crime_wharf_bollard`. `prop_dock_crate` stays a separate mesh. Invoices stay on the posted bill. It is not a retint of `veh_hub_handcart` or `veh_frontier_handcart`. `veh_crime_wharf_chock` is the wet wedge. It is not `veh_link_halt_chock`.
- `veh_crime_dock_loader` is one short mast and an empty hook eye, radius 0.16 m. `prop_dock_hook` and `wpn_imp_dock_hook` stay separate. `veh_crime_pallet_jack` is the hand truck kept out of the B23 clutter kit, rollers 0.05 m. Both sit on the warehouse apron of `arch_hero_crime_warehouse_door`, outside the SoftEnter first frame and outside the 1.2 × 2.2 m door clear.
- `veh_ix_wharf_skid` is the shared Uncounted Wharf skid at `arch_hero_ix_wharf`: rust strap one end, cyan fiber the other. Runners. Not a ship. Not `veh_hub_salt_skid`.
- `softenter_landmark` and `softenter_adjacent` are false. No lettering. No rifle. No gun on the loader. Flower Law stays the Hub disk of 42 m and does not cover these rows. `Pistol_*` unbound.

## Weapons (B27 — Ruins, Sere, Dawn, Crucible, Court)

- Eighteen rows, batch `B27_weapons`. B8 weapon ids stay. Kits: `arch_kit_hub_court`, `arch_kit_ruins_ash`, `arch_kit_sere_mark`, `arch_kit_superhero_dawn`, `arch_kit_crucible_lattice`.
- Court dual-state is one mesh bounds, two skins. The prompt is the flower form. `wpn_1h_court_petal_sheath` is a bloom inside the 42 m disk (`Sword_Idle`). Its steel skin is arena sand only, about 8 m around local (0, 18). `wpn_imp_court_pruner` is wood and one petal inside the disk, tool down. Steel jaws are the same bounds on that sand. `wpn_1h_court_flower` stays the drawn sword. Do not place live steel as plaza clutter.
- Ruins adds a short ash knife, a rib hook, a thick fossil chisel, and a stockless sinew bow. The unburial cleaver and the catalogue stylus stay. The bow release clip is missing, so the bow stays holstered. Do not bind `Sword_Attack` as a shot.
- Sere adds a one-tine brand hook, a bent furnace bar, a coal cup with no flame mesh, and soot tongs. The two-tine fork and the mark tile stay. The brand hook is not `wpn_imp_dock_hook`.
- Dawn adds a blunt baton, a flat glass disc, a roof wedge, and a long crook. The mercy maul and the mercy orb stay. Alley finisher, arterial kicker, and pad grappler stay empty-handed. Blue is contact VFX. No killing beam. Do not fill the mercy plaza heart. The glass throw clip is missing.
- Crucible adds a notched chisel, a bar with a missing middle, a pike with an open head, and a caliper whose jaws do not meet. The thrown shard and the open-ring focus stay. Gaps stay open. Construct cap stays 0. Do not seat these on Rib Frame, Vent Jack, or Gap Bracket.
- One-hand edges use `Sword_Attack`. Heavy and improvised swings are a time-scaled `Sword_Attack`, labeled procedural. Poles use that same fallback as a thrust. `Pistol_*` stays unbound. No rifle.
- `softenter_landmark` and `softenter_adjacent` are false. No lettering.

## Weapons cycle 2 (B27 — same kits)

- Sixteen rows, same batch `B27_weapons`. File `batches/B27_weapons_cycle2.json`. The eighteen above stay. B8 stays. Gadgets stay.
- Court adds a bud staff, a three-tooth petal rake, a seed cup, and a thorn pin. Prompts are wood and petal inside the 42 m disk. Steel skins use the same bounds on arena sand only, about 8 m around local (0, 18). The bud staff is not the petal sheath. The rake is not the pruner. The seed cup is not `wpn_throw_court_lantern`. The thorn pin is not `wpn_1h_court_flower`. Flower skins do not play `Sword_Attack` inside the disk. The seed cup is a hold on both skins.
- Ruins adds an ash mallet, a flat slab bar, and a bone pick on `arch_kit_ruins_ash`. They are not the fossil chisel, the unburial cleaver, the rib hook, the ash knife, or the stylus. The sinew bow stays holstered.
- Sere adds a flat soot rake, a cinder awl, and a closed clinker on `arch_kit_sere_mark`. They are not the brand hook, the two-tine fork, the wound-coal cup, or the mark tile. No flame mesh. The clinker throw is missing. Do not bind `Sword_Attack` as that throw. These rows are not Link gates.
- Dawn adds a quiet plate, a blunt stretcher pole, and a short pad hook on `arch_kit_superhero_dawn`, outside the mercy plaza heart. They are not the glass disc, the mercy orb, the mercy maul, the launch crook, or the baton. No killing beam. Alley finisher, arterial kicker, and pad grappler stay empty-handed. The glass throw stays missing.
- Crucible adds a seam brush, a reach rod, and a cool cube on `arch_kit_crucible_lattice`, outside the named gaps. The bristle gap, the rod ring, and the cube groove stay open. Teal stays inside that gap. Lilac stays inside the Gap Bracket. Do not seat them on Rib Frame, Vent Jack, or Gap Bracket. Construct cap stays 0. The reach ring is smaller than `wpn_focus_crucible_unend` and is not `wpn_focus_crucible_brokenloop`. The cube is not the gap block or the open caliper.
- `Pistol_*` stays unbound. No rifle. `softenter_landmark` and `softenter_adjacent` are false. No lettering.

## Gadgets (B27 — Grid and Crucible)

- Eighteen rows, batch `B27_gadgets`. File `weapons/CYBER_CRUCIBLE_GADGETS_B27.json`. Kits `arch_kit_cyber_grid` and `arch_kit_crucible_lattice`. B8 Grid weapons stay: `wpn_1h_grid_pulseblade`, `wpn_pole_grid_countpike`, `wpn_bow_grid_rail`, `wpn_imp_grid_cable`. The four B27 Crucible tools stay, plus `wpn_throw_crucible_shard` and `wpn_focus_crucible_unend`.
- Grid gadgets are held tools. Park them in the mid-rise, off the sky floor from (−25.77, −58.0) to (−19.37, −62.8). Named set `sky_bridge` stays unplaced. Do not snap them to `env_cyber_skybridge_segment`. `npc_grid_body_bridge_runner` stays empty-handed. Capoeira stays the empty-hand bias. Do not parent a gadget to `mon_grid_drone`, `hyb_billdrone`, or `veh_cyber_drone_sled`.
- The fiber spool is not the cable whip, the fiber hank, or `prop_cable_coil`. The corner bar is not the pulse blade. The snips are not a second stock on the rail bow. The loupe is not the pike's lens and is not a hologram. The blank puck is not the Dawn glass disc and not `ui_board_cyber_hole`. The tally click and the blank key carry no digit. `veh_cyber_blank_slate` and `env_cyber_census_plinth` stay. The nested rod stays collapsed. The clamp jaw and the horseshoe mouth stay open.
- Crucible tools sit outside the named gaps. The seam roller's bite, the awl notch, the wrench jaw, the gap block's slot, the pin-punch cup, and the broken loop stay open. Construct cap stays 0. Do not seat them on Rib Frame, Vent Jack, or Gap Bracket. The slag spoon is empty and has no flame. The pin punch is not `prop_cruc_cl_open_pin`. The broken loop is smaller than the Un-End ring. The gap block is smaller than the vent bar.
- `Sword_Attack` covers the drift awl and the pin punch. Procedural heavy covers the spool, corner bar, snips, clamp, nested rod, blank key, horseshoe, roller, spoon, wrench, and file. Loupe, tally click, gap block, and broken loop are holds. The blank puck throw is missing. Do not bind `Sword_Attack` as that throw. `Pistol_*` stays unbound. No rifle.
- `softenter_landmark` and `softenter_adjacent` are false. No lettering. Flower Law stays the Hub disk of 42 m.

## VFX (B28 — only where the pack cannot cover)

- Eleven rows, batch `B28_vfx`. B11 skill rows stay. `skills/SKILLS.json` still names a Gabriel Aguiar prefab; that path is not the mesh to generate when this section names a replacement. Coverage table: `vfx/VFX_PREFAB_COVERAGE.md`.
- Flower quench and the cut flower spawn only inside the Hub disk of 42 m. Arena sand, about 8 m around local (0, 18), keeps `vfx_Impact_01` for steel. Ward Cut under Flower Law uses the cut flower. Tunya and Cyber flower-step plants spawn nothing.
- Number break is a dark token with one corner gone. No numeral. `vfx_Lightning_01` stays off `skill_steel_pulse` and `skill_presence_refuse_count`.
- Unclosed seam stops short. Lilac `#c8b4ff` only inside a Gap Bracket gap. Shard Cast still uses Impact twice. The four B27 open tools use the seam on hit, not on idle. Construct cap stays 0. Curse fold is the opposite law: a gold rib line that closes, and it is not a flamethrower.
- Ash page is a blank sheet that shuts. Unburial keeps a one-shot smoke burst. Pollen stance is an ankle sheet that cuts off when a strike starts. Reed tip and Pollen Ward reuse it small. No jar. No poison column.
- Mercy stop is a gold ring with one missing arc facing the target. No beam. No disintegration. Do not fill the mercy plaza heart. Dawn street mobs stay empty-handed. The mercy baton is Impact, not this ring.
- Dark coal sits in `wpn_focus_sere_woundcoal`. No flame tongue. Name the Holder stays the tile and the furnace eye.
- Chalk tick is one stroke. Sodium on the Coast, limestone in Court, tile red on Sere. Lantern pool is the ground oval after Lantern Toss. Lantern Step keeps the bracket mesh. No jet.
- Wagon lash, tack, gossip, etiquette, bond, bargain, unchosen, graft, and second hour spawn no pack prefab. Dust Kick uses the cycle 2 dust fan, not `vfx_Shockwave_01`. Hail at Court night uses the hail mote. Spellwell uses the well seat. Sinew bow and glass disc spawn no trail. `Pistol_*` stays unbound. No rifle.

## VFX cycle 2 (B28 — eight tells the pack still cannot be)

- Eight rows, same batch `B28_vfx`, file `vfx/B28_SKILL_CUES_CYCLE2.json`. The first eleven stay. B11 skill rows stay. Count on the prompts index is 888.
- Ground wedge replaces Impact on a steel slash: Ward Cut outside the 42 m disk and on arena sand, about 8 m around Hub local (0, 18). Inside the disk, Ward Cut stays the cut flower. Court steel skins of the thorn pin, bud staff, and petal rake use the wedge on arena sand only. Ruins slab bar and bone pick use it. The ash mallet stays Impact. Palm, shoulder, chain, parry, kitbash, vise, salvage, dress, and seal stay Impact.
- Ankle gap is the Invoice tell at the ankles. Coast sodium `#e0b050` on `arch_kit_crime_coast`. Sere eye `#e07030` on `arch_kit_sere_mark`. The gap stays open. It is not the chalk tick and not the mercy ring. The thrust tick may stay Impact.
- Dust fan replaces Shockwave on Dust Kick. Ankle height, lateral, sun through the sheet. A clamped ring still reads as a shield. Frontier gossip dust still spawns no mesh. Second Hour stays ambient kit dust. Hold is 1.5 s, and rank 5 extends that hold to 2.5 s.
- Ash stop is the Unburial windup, a vertical line that ends, on `arch_kit_ruins_ash`. Smoke may stay a one-shot contact puff and must not column. Close the Page stays the ash page.
- Harvest ring sits on `flora_tunya_terrace_tree` only, while Do Not Reap holds and the tree is the target. Fruit stays on the tree. The ankle sheet stays pollen stance. No jar.
- Splice bead is one steady cyan point on the splice seat, mid-rise, off the sky floor from (−25.77, −58.0) to (−19.37, −62.8). Named set `sky_bridge` stays unplaced. Lightning stays off. The broken token stays number break. No digit. No beam.
- Well seat is the Spellwell charge, a chip in the basin. Hub basin is inside the 42 m disk and off arena sand. Crucible seat does not fill a gap. Construct cap stays 0. No sky pillar. No loot beam. The basin mesh still moves.
- Hail mote is one warm point, Court night, inside 42 m. Day spawns nothing. Other worlds spawn nothing. It is not the flame pool. Lantern Step keeps the bracket mesh.
- Seam brush, reach rod, and cool cube reuse the unclosed seam on hit. Sere rake and awl stay Impact. The clinker throw stays missing. Dawn plate, pole, and hook stay Impact. Seed cup is a hold. Wagon lash, tack, gossip, etiquette, bond, bargain, unchosen, graft, and second hour still spawn no pack prefab. `Pistol_*` stays unbound. No rifle.

## UI chrome (B29 — icons only)

- Twenty-one rows, batch `B29_ui`. Contract: `ui/UI_CHROME_SPEC.md`. These are HUD tokens. Do not scatter them as world clutter. `softenter_landmark` and `softenter_adjacent` are false.
- Court pin, brass chip, pressed note, lantern toast, and the urn tab show only while `Canon.InHubCourt` is true and the player is outside arena sand. Flower Law disk is 42 m. Arena sand, about 8 m around Hub local (0, 18), keeps parchment and adds `ui_arena_sand_insert`.
- Steel screw, blank plate, stamped chip, and slide toast are the skin on spokes, on Sere, on the Hub outside 42 m, and on arena sand. The plate face stays blank. Stamp the WorldId display name in type (Unburned Court, the Sundering, Tunya, Sovereign Ruins, Iron Coast, the Grid, Frontier, the Permanent Dawn, Crucible, Sere).
- Panel fill, scrim, ink, and the 2 px accent rule are colors in the spec. Do not generate a bitmap atlas or a large plate texture. `nine_slice` and `bitmap` are false on every row.
- Gossip uses `ui_gossip_torn_margin`. Iron Coast chalk stays `vfx_crime_chalk_tick` in the world. No chat bubble.
- Poise uses `ui_poise_tick_notch` on the active plate. No health bar and no full-screen frame.
- Board tokens are one per world. The Cyber hole has no digit. The Crucible bracket stays open. The Sere frame has no flame tongue. The Dawn card has no victory word. The Frontier canvas has no baked line. The Tunya slat has no fruit. Hub hall notice stays `prop_hub_se_notice_blank`.
- Empty type is "No mesh." "No route." "No quest." A failure on the slide toast stays. Keyboard shortcuts are type on the blank chip. `Pistol_*` stays unbound. No rifle.
- Cycle 2 adds eight HUD tokens on the same batch. File `ui/B29_CHROME_CYCLE2.json`. The first twenty-one stay. `ui_court_slot_well` and `ui_steel_slot_well` are one inventory. The skin picks the well. The hole stays empty until a real item mesh is in it. Count faces take a runtime count and no baked digit. `ui_skin_seam` spawns only during the SoftEnter crossfade, about 333 ms, after the world accent is known. Reduced motion does not spawn it. `ui_steel_stay_tab` parents `ui_steel_slide_toast` on a failure only. No check. No dismiss. `ui_board_line_blank` sits under the active board token. No line means the type "No quest." `ui_court_quiet_strip` parents `ui_court_lantern_toast` inside 42 m, off arena sand. The petal stays on the toast. The 2 px rule stays a color. No bitmap. No rifle.

## Audio cue sheets (B30)

- Thirty-two cue rows in `audio/CUE_SHEETS.json`. Contract: `audio/AUDIO_CUE_SPEC.md` and `FEEL_AUDIO_VISUAL_CUES.md`. `audio_file` is null on every row. Do not import a clip to fill a slot.
- Four new meshes, batch `B30_audio`: `prop_hub_spoil_petal` (flat petal, inside 42 m, not `vfx_hub_cut_flower`), `prop_crime_spoil_bill` (blank paper, not `ui_board_crime_bill`), `prop_frontier_spoil_rivet` (short bar, only after `item_rem_dome_rivet` on the scout loop), `prop_fantasy_spoil_crest` (clasp shut). Kits: `arch_kit_hub_court`, `arch_kit_crime_coast`, `arch_kit_frontier_road`, `arch_kit_fantasy_sunder`.
- Reuse and do not re-prompt: fruit on `flora_tunya_terrace_tree` (three masses, tree uncut), digit `vfx_cyber_number_break`, tile `prop_brand_tile` tinted `#8a3030`, shard `prop_unclosed_shard` (lilac one frame, then stone), gossip and threats that already name a B28 card.
- Ash pinch, Grid hem flicker, Frontier dust shape, Dawn dark window, Ruins stele absence, and the dull Sundering scar spawn no new mesh. Ruins gossip spawns nothing.
- Threats sit in the world. Melee is a ground wedge in the world accent for under 500 ms. Grab is Crime sodium `#e0b050` or Sere eye `#e07030`. Count gap stays empty. Dust stays at the ankle. Harvest circle stays on the tree. Aerial tell is a growing shadow disc on `mon_sunder_griffin`, `mon_tunya_harpy`, and `hyb_dustgriffin`. No scream file.
- Screen tint is only `cue_flash_flower_law` (inside 42 m) and `cue_flash_furnace_eye` (through a window). Tint the existing grade. Toasts stay B29. `softenter_landmark` and `softenter_adjacent` are false. No loot beam. No rarity pillar. Construct cap stays 0. `Pistol_*` stays unbound. No rifle.
- Cycle 2 adds twelve contact rows. File `audio/CUE_CONTACTS_CYCLE2.json`. The first thirty-two stay. `audio_file` stays null. No new mesh. One spec row, `cue_spec_contact_bind`, is `generate: false`.
- Bind the telegraphs that were still a bare shape: melee wedge `vfx_steel_ground_wedge` (inside 42 m, Ward Cut stays `vfx_hub_cut_flower`), grab `vfx_invoice_ankle_gap`, dust `vfx_frontier_dust_fan`, ash windup `vfx_ruins_ash_stop`, harvest `vfx_tunya_harvest_ring` on `flora_tunya_terrace_tree`. Do not re-prompt those cards.
- Contact does not invent a hit sound. Steel ticks the wedge once, outside 42 m. Flower contact is the cut flower and does not also spawn the wedge. Invoice uses pack `vfx_Impact_01` once and leaves the gap open. Dust settles with no shockwave. Ash contact is one `vfx_Smoke_01` puff and must not column. Harvest puts nothing on the player. Mercy puts no Impact on that body. Dawn street jab and cross still use Impact and are not the mercy row. The aerial disc stops on the ground. No scream file. The count gap stays empty. The fold stays on the attacker. The seam stays open. The Sere tile dulls. No flame tongue.

## Terrain kits (B31 — Hub pinewood, salt road, Sundering ash grove)

- Fifteen modules, batch `B31_terrain`. File `terrain/HUB_FANTASY_TERRAIN_B31.json`. Scatter kits, not heightmaps and not new worlds. `module_not_map` is true. `softenter_landmark` and `softenter_adjacent` are false. Snap is 1 m, except the rut tile and the grove ash at 4 m.
- `terr_kit_pinewood` is Hub only, outside the 56 m wall, around Pinewood Crossing (62, −28). Modules: needle mat, fallen limb, sapling, root stump, salt bark slab. Keep `flora_hub_pinewood_pine` (14 m), `env_hub_pinewood_milepost` (the only lettering), and `env_hub_salt_verge` (the 8 m shoulder with its own log end). Do not retune pinewood stag caps. Nothing in this kit sits inside the 42 m disk.
- `terr_kit_salt_road` is Hub and Fantasy together. Modules: 4 m rut tile, salt crust pan, dust berm, crown stone, wheel-scar chip. Place on the Hub salt road outside the wall and on the Sundering south track beside `env_sunder_salt_toll`. The toll post, the toll bowl, and `flora_hub_salt_grass` stay. The crown stone is not `env_frontier_walker_cairn`. The chip is not `veh_spare_iron_wheel`. Do not enter the Frontier plaque at (−34, 0). Do not plant a Flower Law urn on the Sundering track.
- `terr_kit_ash_grove` is Fantasy only, east march toward Ruins, off the salt track. Grove quiet. Modules: `flora_sunder_grove_ash` (open crown, pale trunk, two opposite forks, moss on the south face), ash leaf mat, fallen ash log, knee-high moss lip, ash whip. `flora_ruins_ash_cypress` stays the narrow dark forum tree on Ruins. Do not merge the kits. The moss lip is not `env_sunder_fold_lip` and not a Crucible seam. No gold glow. No bones. No forum limestone.
- No lettering on any B31 mesh. Pinewood Crossing stays on the milepost. `Pistol_*` unbound. No rifle.
- Cycle 2 adds twelve modules on the same kits. File `terrain/HUB_FANTASY_TERRAIN_B31_CYCLE2.json`. Batch id stays `B31_terrain`. The first fifteen stay. Snap stays 1 m. `module_not_map` stays true.
- Pinewood adds `terr_hub_pine_cone` (closed, 0.16 m), `terr_hub_pine_resin` (amber bead on a chip), `terr_hub_pine_root_arc` (no cut face), and `terr_hub_pine_snag` (bare spike, 1.6 m, no needles). The cone is not the Court seed cup. The bead is not the bark slab. The arc is not the stump. The snag is not the sapling and not `flora_hub_pinewood_pine`.
- Salt road adds `terr_salt_hoof_cup` (oval in crust, no horse), `terr_salt_ribbon` (a peel, not the pan), `terr_salt_clod` (one root hair, not the grass tuft), and `terr_salt_board_end` (half buried, no letters, not the verge log, not the bogie bunk). Hub and Fantasy. Outside 42 m. Off the Frontier plaque at (−34, 0).
- Ash grove adds `flora_sunder_ash_key` (one twig, a key fan), `terr_sunder_ash_bracket` (one grey shelf on a short chunk, not a creature), `terr_sunder_ash_bole_ring` (standing hollow bark, not the trunk), and `terr_sunder_ash_knuckle` (moss on the north face only). The moss lip, the fallen log, the whip, and `flora_ruins_ash_cypress` stay. No gold glow. No bones. No teal seam.

## Iron Coast clutter (B23 — tenement and warehouse)

- Fifteen rows, batch `B23_props_crime`. File `props/CRIME_INTERIORS_B23.json`. Placement: `props/KIT_DENSITY.md`. WorldId `Crime` only. Kit `arch_kit_crime_coast`. Snap 1 m. `softenter_landmark` is false. No lettering. No neon. Flower Law does not apply.
- `prop_kit_crime_tenement` parents `arch_hero_crime_tenement_bay` with `softenter_adjacent` true. Eight pieces dress the ground floor: radiator (cold, no steam mesh), rolled mattress, loose sash, pipe elbow, cage bulb, tin cup, plaster curl, interior newel. They do not replace the bay. The SoftEnter first frame stays rain, `env_crime_sodium_lamp`, wet brick, and the weathered bill.
- `prop_crime_se_cage_bulb` is the interior practical. Emissive `#e0b050` only. It is not `env_crime_sodium_lamp` and not `prop_sodium_lamp`. No pole.
- The loose sash is not the bay's installed window. The newel is not `arch_hero_crime_escape_stair` or `env_crime_fire_escape`. The tin cup is not `prop_hub_se_clay_cup`.
- `prop_kit_crime_warehouse` parents `arch_hero_crime_warehouse_door` with `softenter_adjacent` false. Seven pieces fill the apron: empty pallet, closed drum, chain coil, folded tarp, set rebar stub, floor drain, scrap stool. `env_crime_warehouse_door` and the hero door assembly stay. Keep the 1.2 × 2.2 m door clear. The drum sits beside the opening.
- The pallet is not `prop_dock_crate`. The chain coil is cargo, not `wpn_imp_dock_hook` or `prop_dock_hook`. The drain is not `env_crime_gutter_mouth`. The tarp is not `prop_hub_se_awning_bundle`. The stool is the only sit target (`Sitting_*`) and is not `prop_hub_se_stool`. The rebar stub is cast in concrete and is not a held pike.
- The hand truck, the rail dolly, and the wharf cart are `B26_vehicles_urban`, not this clutter kit. Do not add a rifle, a shotgun, or a pistol. Do not letter the drum. Do not put a Flower Law urn on the Coast. `Pistol_*` unbound.
- Cycle 2 adds twelve rows on the same halls. File `props/CRIME_INTERIORS_B23_CYCLE2.json`. Batch id stays `B23_props_crime`. The first fifteen stay. Snap stays 1 m. `first_frame` is false. No second light. The cage bulb stays the only sodium practical.
- `prop_kit_crime_tenement_rise` parents `arch_hero_crime_tenement_bay` with `softenter_adjacent` true. Six pieces dress the stair hall behind the interior newel: open fuse box (dark, no wires), closed mail flap, one empty work boot, sash weight, linen cord hank, iron key. They do not replace the ground-floor eight or the SoftEnter first frame.
- The fuse box is not `prop_crime_se_cage_bulb` and not `env_crime_sodium_lamp`. The flap is not `env_crime_bill_board` and not `prop_crime_spoil_bill`. The boot is not a body and not the mattress roll. The weight is not `prop_crime_se_loose_sash`. The cord is not `prop_crime_wh_chain_coil` and not `prop_crime_cl_rag_wad`. The key is not `wpn_imp_grid_blankkey`. No numeral.
- `prop_kit_crime_warehouse_bay` parents `arch_hero_crime_warehouse_door` with `softenter_adjacent` false. Six pieces fill the apron beside the clear: long-spout oil can, webbing coil, broom, open nail keg, blank paper brick, broken crate slat. Keep the 1.2 × 2.2 m door clear. The can is not the drum. The coil is not the chain and not the tarp. The broom has no metal head and is not a staff. The keg is not the pallet. The paper brick has no type. The slat is not `prop_dock_crate`, not the pallet, and not `prop_crime_cl_crate_end`.

## Ruins ash underworld (B25)

- WorldId `Ruins`. Kit `arch_kit_ruins_ash`. Four rows, batch `B25_creatures_ruins`.
- Existing rows stay: Catalogue Wolf, Catalogue Crow, Rib Lizard, Unfinished Wraith, The Unfinished, Rib Crawler, Ashfang, Ribwolf. Mercy wraith and the ward griffin stay cap 0.
- New fauna live under the slabs: staple beetle (oval, one iron bar), vault bat (downward triangle under `env_ruins_rib_bridge`), ash grub (legless comma), cinder newt (bar and a rod tail in the seep). They are not the sunned rib lizard and not `flora_ruins_ash_cypress`.
- `spawn_weight` is 0. S07 windows stay on the wolf, the ribwolf, the wraith, and The Unfinished. `bone_yard`, `unburial_court`, and `catalogue_hall` stay unplaced. Denier overlap and the north shelf stay cap 0.
- `ruin_rat_king`, `ash_revenant`, and `gloom_stalker` stay unprompted and unspawned. No second boss. No glowing eyes. No rifle. `Pistol_*` unbound. SoftEnter first frame stays clear.

## Sere wound ecology (B25)

- WorldId `Sere`. Kit `arch_kit_sere_mark`. Four rows, batch `B25_creatures_sere`.
- Existing rows stay: Sodium Rat, Marked Hound, Smog Roach, Census Drone, Road Watcher, Marked Harpy, The Compound Mark. The drone alias stays cap 0.
- New fauna: drowned eel (thick S, one oil lump, flood reed and flood pier), lip newt (bar and a closed hook, unplaced lip), tar crab (wedge, one claw, one stump, oil seep), scrub finch (round body, one wing bar, `flora_sere_furnace_scrub`).
- `spawn_weight` is 0. S19 seats stay: Verge–Keshar roaches, Aldermere–Tally hound, Dovrane–Keshar watcher, Tally–Hollowford rats, and `enc_compound_mark` on the unplaced furnace belt. Do not put the finch or the newt on that belt. Do not put the eel on the roach lip.
- The throat patch and the oil lump are skin and tar. No flame tongue. The furnace eye stays on the furnace. No brand stamp on the crab. No rifle. `Pistol_*` unbound. Deep watcher stays unprompted. Tithe rat, ledger crow, and furnace hound stay unprompted. SoftEnter first frame stays clear.

## Atlas mobility (A01 cycle 2, `B21_anim_mobility`)

- One spec row: `anim_spec_mobility_bind`. `generate` is false. Triangle budget is 0. Do not send it to Aura or TRELLIS.
- Doc: `animations/MOBILITY_BIND.md`. Eight Link plaques play `Walk_Formal_Loop` at the 34 m ring, then SoftEnter idle. The 42 m disk stays Flower Law. The blade stays down on the Hub side of the plaque.
- Crown roads and finished marches play `Walk_Loop`. Walker edges and `seam_crucible_cyber` use stride scale 0.7 on that same clip. `march_crucible_cyber` is not the path the body plays.
- Sea edges spawn nothing. The river-barge cost class is not a hull. `Driving_Loop` stays unbound. Sere has no gate. `trav.climb` stays missing. `tunya_nil` keeps wheeled `v` at 0.
- No new creature mesh and no new cart. `Pistol_*` stays unbound. No rifle.

## Animation deep pass (A19, `B21_anim_deep`)

- Two spec rows only: `anim_spec_creature_graph`, `anim_spec_vehicle_roll`. `generate` is false. Triangle budget is 0. Do not send them to Aura or TRELLIS.
- Controller `CreatureGraph` binds the existing fauna ids in `animations/CREATURE_VEHICLE_DEEP.json`. No new creature mesh. Mixamo stays on the CX humanoid avatar.
- Controller `VehicleRoll` binds the B26 carts, runners, hitches, the Frontier sail, the pack frame, and the chocks. `ω = v / r` on wheeled ids. Runners do not spin. The drone sled ring stays still. `hyb_billdrone` spins its disc only while airborne. `mon_grid_drone` has no propeller bones.
- Led horse clamps to a walk. The wind pronghorn stays unbridled. `Driving_Loop` stays unbound. Flower Law stays the 42 m Hub disk. `Pistol_*` stays unbound.

## Urban terrain (A20, `B31_terrain_urban`)

- Fifteen modules in `terrain/URBAN_TERRAIN_B31.json`. Placement: `terrain/KIT_PLACEMENT.md`. Scatter kits, not heightmaps. `module_not_map` is true. `softenter_landmark` and `softenter_adjacent` are false. No lettering. `Pistol_*` stays unbound. No rifle.
- `terr_kit_coast_street` is Crime only, parent `arch_kit_crime_coast`. Sodium streets on the tenement rise. Modules: 4 m curb run (snap 4), two-step stoop, 2 m alley throat, 4 m tar roof square, splash block. Keep the sodium lamp, the fire escape, the gutter mouth, the posted bill, the overpass pier, the bollard, the warehouse door, and the three Coast plants. The tar square is not `env_dawn_roof_pad` and not the escape landing. The splash block is not `env_crime_gutter_mouth` and not the warehouse floor drain. No neon. The SoftEnter first frame stays the lamp, wet brick, and the bill. Flower Law does not apply.
- `terr_kit_grid_alley` is Cyber only, parent `arch_kit_cyber_grid`. Mid-rise alleys. Modules: wet paver, conduit lip with one cyan tie, one riser, soot corner with one acrylic shard, steel door sill with one cyan edge. Keep the alley drain, the under hatch, the neon banner, the census plinth, the sky-bridge segment, the service corridor, the glitch frame, the well weed, and the roof moss. Do not park these on the sky floor from (−25.77, −58.0) to (−19.37, −62.8). Named set `sky_bridge` stays unplaced. No digit. No hologram. The sill is not a Coast sodium head.
- `terr_kit_dawn_roof` is Superhero only, parent `arch_kit_superhero_dawn`. Roofs around `env_dawn_roof_pad`. Modules: gravel arc, parapet cap, scuff plate, vent cowl, 4 m low-rent square. Keep the 8 m pad, the mercy ring, the arterial pier, Kane's fin, the clinic canopy, the spandrel, the launch lip, the pad facade, the park plane, and the roof olive. The gravel arc is not a second circle. The cowl has no flame. The low-rent square is not the mercy ring and not a victory plinth. The Hub plaque at (0, −34) is not this city. Flower Law stays the 42 m Hub disk.

## Cross-world clutter (A21, `B23_props_global`)

- Sixty rows in `props/GLOBAL_CLUTTER_B23.json`. Placement: `props/KIT_DENSITY.md`. Ten kits, six slots: vessel, lean, chip, bundle, fitting, rest. `sheet_family` is `clutter_six`. `single_subject` is true. Generate one mesh per id. Snap 1 m. `softenter_landmark` is false. No lettering. `Pistol_*` unbound. No rifle. CX bodies stay off these props.
- `prop_kit_hub_market_six` parents `arch_hero_hub_market_facade` with `softenter_adjacent` false and `flower_law` `outside_42m`. Saucer, lath, shaving, twine, bent nail, crate lid. The council fourteen in `B23_props_softenter` stay on `arch_hero_hub_council_hall`. The nail does not enter the 42 m disk.
- `prop_kit_sunder_shrine_six` parents `arch_hero_sunder_shrine_hall`, adjacent. Horn cup, stake, granite chip, reed tie, harness ring, root seat. The hall stays the hero. The stake is not `env_sunder_salt_toll`.
- `prop_kit_tunya_terrace_six` parents `arch_hero_tunya_terrace_hall`, adjacent. Dye bowl, cane, limestone chip, fiber hank, graft peg, palm rest. Fruit stays on `flora_tunya_terrace_tree`. The peg is not `prop_graft_scar`. The solar tile stays B24.
- `prop_kit_ruins_catalogue_six` parents `arch_hero_ruins_catalogue_hall`, adjacent. Ash bowl, plaster stick, cinder, shroud fold, staple, slab seat. No catalogue number. The staple is not `faun_ruins_staple_beetle`.
- `prop_kit_crime_alley_six` parents `arch_hero_crime_tenement_bay` with `softenter_adjacent` false. Bottle, board, brick, rag, washer, crate end. Out of the first frame and out of the 1.2 × 2.2 m clear. Tenement and warehouse kits stay. No neon.
- `prop_kit_grid_bridge_six` parents `arch_hero_cyber_bridge_hall`, adjacent. Resin cup, offcut, acrylic chip, fiber hank, blank clip, low crate. `no_digit` true. Not on the sky floor. Named set `sky_bridge` stays unplaced. The hank is not `prop_cable_coil`.
- `prop_kit_frontier_cabin_six` parents `arch_hero_frontier_cabin_hall`, adjacent. Tin bowl, tent stake, salt chip, canvas roll, buckle, box end. Off the plaque at (−34, 0). The roll is not `veh_frontier_wind_sail`.
- `prop_kit_dawn_spire_six` parents `arch_hero_dawn_spire_hall`, adjacent. Glass, strut, paint chip, tape, blank disc, pad stool. The disc is not `prop_mercy_circlet`. The stool is not `env_dawn_roof_pad`.
- `prop_kit_crucible_lattice_six` parents `arch_hero_crucible_lattice_hall`, adjacent. Slag cup, quenched rod, quartz chip, wire hank, open pin, ingot seat. `no_flame` and `seam_open` are true. The rod is not `wpn_2h_crucible_ventbar`. Construct cap stays 0.
- `prop_kit_sere_tally_six` parents `arch_hero_sere_tally_hall`, adjacent. Soot bowl, stake, tar chip, rag knot, cold hook, firebrick. `no_flame` true. The hook is not `wpn_1h_sere_brandhook`. The furnace belt stays clear.

## Do not
- Re-prompt the tenement bay, the warehouse door, the escape stair, the street sodium lamp, the fire escape, the wharf bollard, the corrugate door, the posted bill, the gutter mouth, the dock crate, the wall hook, the rose pin, or the Coast spoil bill as a B23 clutter row. Put neon on the Coast. Put a pole on the cage bulb. Block the warehouse door clear with the drum. Add a hand truck in this batch. Turn the chain coil into the dock hook. Turn the rebar stub into a held pike. Letter a drum. Put a Flower Law urn on the wharf. Put a rifle, shotgun, or pistol on these props. Occupy the SoftEnter first frame with the warehouse kit. Re-prompt the pine, the milepost, the salt verge, the salt toll, or the Ruins ash cypress as a B31 module. Letter a terrain module. Retune pinewood stag caps. Put pine or salt scatter inside the 42 m disk. Plant a Flower Law urn on the Sundering salt track. Use the Ruins cypress as the grove ash. Merge ash-meets-moss into a fourth blend world. Turn the moss lip into the fold ravine or a Crucible seam. Build a heightmap from these modules. Place Vinewood kits. Place Quaternius human bodies. Bind rifles or pistol clips into Court Flower Law kits. Letter a hall banner. Close the Gap Lion's crown. Put a victory statue in the mercy plaza. Close the Gap Bracket. Seat a construct on the Crucible while the construct cap is 0. Put a rifle or a pistol on an Iron Coast or Grid body. Restyle the four B7 coast and grid roles into the new density rows. Fill a digit onto the census slate. Draw Mama's knife or Zero's question as a named guest duplicate. Put a rider on `faun_wagon_horse`. Bridle the wind pronghorn. Stake `veh_frontier_wind_sail` as a roof. Roll a cart onto the Frontier plaque. Re-prompt `prop_wagon` as a new wagon. Draw a rifle or bind `Pistol_*`. Close a Crucible gap on a B27 tool. Put live steel clutter inside the 42 m disk. Hand the mercy baton to a Dawn street mob. Seat a B27 tool on a construct. Bind the sinew bow or the glass disc to `Sword_Attack`. Add a second drawn Court sword beside `wpn_1h_court_flower`. Paint a numeral on the number-break token. Letter the ash page. Fill the unclosed seam. Bind `vfx_Lightning_01` to mercy or to Refuse the Number. Bind `vfx_Flamethrower_01` to the curse fold, the lantern toss, or the wound coal. Spawn a cut flower outside the 42 m disk. Put a flame tongue on the dark coal. Give the mercy stop ring to an empty-handed Dawn street mob. Bake a WorldId, a shortcut, a quest line, or a digit into a B29 albedo. Generate a HUD bitmap atlas. Close the Crucible board bracket. Put a victory word on the mercy card. Put a flame tongue on the furnace frame. Replace `prop_hub_se_notice_blank` with the urn tab. Show the Court pin outside the 42 m disk or on arena sand. Turn a steel failure toast into a success. Add a chat tail to the torn margin. Attach a wav, a stinger, or a gallop loop to a B30 cue. Spawn a loot beam on a spoil. Re-prompt `vfx_hub_cut_flower` as the spoil petal. Place `prop_frontier_spoil_rivet` without `item_rem_dome_rivet`. Spawn the Last Dome to justify that rivet. Open the Sundering crest. Put a digit on the number-break token. Cut the Tunya tree to show fruit. Fill the Crucible seam. Play `vfx_fantasy_curse_fold` for the dull scar. Use a white screen hit for Flower Law or the furnace eye. Put the harvest circle on the player. Bind a scream to the aerial disc. Restyle the B7 Sundering ward, curse-bearer, terrace laborer, or grove factor into a B22 fantasy row. Put a ward-blade on a grove or ash density card. Put a straw disc or a back basket on a terrace wardrobe card. Put a green sash and a wooden scale on an ash sash. Hood the ash smock. Use the Ruins ash cypress as a Sundering person. Give the ark collar an ice blade or a back weapon. Put a rifle on a grove, ash, terrace, or ark body. Invent a kilometre pin for the ark stair. Treat Fluxom Gate as Pinewood Crossing. Re-prompt the sodium lamp, fire escape, gutter mouth, alley drain, under hatch, neon banner, census plinth, sky-bridge segment, service corridor, glitch frame, Dawn roof pad, mercy ring, arterial pier, Kane fin, clinic canopy, or glass spandrel as a B31 urban module. Put neon on the Iron Coast. Turn the tar pad into the Dawn marble circle. Put a warning word on the parapet. Put a digit on the Grid sill. Park urban terrain on the sky floor. Block the warehouse door clear with a curb. Occupy the Coast SoftEnter first frame with street scatter. Put a flame tongue on the roof cowl. Place a victory statue on the low-rent pad. Use the splash block as the warehouse drain. Use the alley paver as the alley drain. Build a heightmap from the urban kits. Render a B23 six as one contact sheet. Put the Hub market nail inside the 42 m disk. Replace the council-hall fourteen or the Coast tenement and warehouse kits with the new sixes. Put a digit on a Grid clip. Put a neon sign on the Coast alley board. Put a flame tongue on a Crucible or Sere clutter piece. Close the Crucible pin eye. Letter a Ruins plaster stick. Park the Grid crate on the sky floor. Block a 1.2 × 2.2 m door clear with a rest slot. Use the Frontier canvas roll as the wind sail. Use the Dawn disc as the mercy circlet. Use the Sere hook as the brand hook. Re-prompt the pulse blade, the count pike, the rail bow, or the cable whip as a B27 gadget. Add a second stock to the rail bow. Hand a gadget to the bridge runner. Park a gadget on the sky floor. Put a digit on the tally clicker, the blank key, or the blank puck. Parent a gadget to the census drone, the billdrone, or the drone sled. Extend the nested rod into a pike. Close the horseshoe, the clamp, the seam-roller bite, the wrench jaw, the gap block, the pin-punch cup, or the broken loop. Seat a Crucible gadget on Rib Frame, Vent Jack, or Gap Bracket. Put a flame tongue on the slag spoon. Use the fiber spool as the cable whip. Use the cracked loupe as the count-pike head. Bind the blank puck throw to Sword_Attack. Fill a hologram sheet onto the loupe.
