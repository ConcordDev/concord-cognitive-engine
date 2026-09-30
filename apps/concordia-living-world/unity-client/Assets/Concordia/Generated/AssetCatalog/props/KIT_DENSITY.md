# Iron Coast clutter density

WorldId `Crime`. Kit `arch_kit_crime_coast`. Batch `B23_props_crime`. Fifteen rows in `CRIME_INTERIORS_B23.json`. Snap 1 m. No lettering. No neon. Sodium `#e0b050` is the only emissive, and only on the cage bulb.

The SoftEnter first frame stays the one already named in `STYLE_Crime.md`: rain, `env_crime_sodium_lamp`, wet brick, the weathered bill. These rows do not replace that frame.

## prop_kit_crime_tenement

Parent `arch_hero_crime_tenement_bay`. `softenter_adjacent` true. Ground floor of the bay.

| id | read |
| --- | --- |
| prop_crime_se_radiator | four cold ribs, no steam mesh |
| prop_crime_se_mattress_roll | one tied roll, no sleeper |
| prop_crime_se_loose_sash | leaning frame, one pane gone |
| prop_crime_se_pipe_elbow | one wet L, one drip |
| prop_crime_se_cage_bulb | short bracket, not the street pole |
| prop_crime_se_tin_cup | empty dented cup |
| prop_crime_se_plaster_curl | one flake, brick on the back |
| prop_crime_se_newel | interior post, no stair flight |

The bay window, the escape Z, and the street teardrop stay on their own meshes.

## prop_kit_crime_warehouse

Parent `arch_hero_crime_warehouse_door`. `softenter_adjacent` false. Apron beside the roll door. Out of the first frame.

| id | read |
| --- | --- |
| prop_crime_wh_pallet | empty timber grid, no stencil |
| prop_crime_wh_drum | lid on, unlettered, beside the clear |
| prop_crime_wh_chain_coil | cargo spiral, ends tucked |
| prop_crime_wh_tarp_fold | one wet cloth brick |
| prop_crime_wh_rebar_stub | kink set in a concrete chip |
| prop_crime_wh_drain | one square grate tile |
| prop_crime_wh_scrap_stool | three legs, empty, sit target |

Door clear stays 1.2 × 2.2 m. The drum does not sit in that opening.

## Cycle 2 — rise and bay

Twelve more rows in `CRIME_INTERIORS_B23_CYCLE2.json`. Same batch `B23_props_crime`. The fifteen above stay. Snap 1 m. No lettering. No neon. No second light. The cage bulb stays the only sodium practical.

### prop_kit_crime_tenement_rise

Parent `arch_hero_crime_tenement_bay`. `softenter_adjacent` true. `first_frame` false. Stair hall behind the interior newel, off the establishing shot.

| id | read |
| --- | --- |
| prop_crime_se_fuse_box | open box, dark mouth, no wires |
| prop_crime_se_mail_flap | closed brass flap, no paper |
| prop_crime_se_work_boot | one empty boot, tongue out |
| prop_crime_se_sash_weight | short cylinder, top eye, no cord |
| prop_crime_se_linen_cord | oval hank, one tie |
| prop_crime_se_iron_key | round bow, blank bit |

The fuse box is not the cage bulb. The flap is not the posted bill and not `prop_crime_spoil_bill`. The boot is not a body. The weight is not the loose sash. The cord is not the chain coil and not the alley rag. The key is not `wpn_imp_grid_blankkey`.

### prop_kit_crime_warehouse_bay

Parent `arch_hero_crime_warehouse_door`. `softenter_adjacent` false. Apron beside the roll door. Out of the first frame and out of the 1.2 × 2.2 m clear.

| id | read |
| --- | --- |
| prop_crime_wh_oil_can | long spout, cap on, no label |
| prop_crime_wh_strap_coil | flat webbing, buckle tucked |
| prop_crime_wh_broom | bristles down, no metal head |
| prop_crime_wh_nail_keg | open keg, nails stay inside the rim |
| prop_crime_wh_paper_brick | blank tied stack, no type |
| prop_crime_wh_crate_slat | one split board, two nail heads |

The can is not the drum. The coil is not the chain and not the tarp. The broom is not a staff. The keg is not the pallet. The paper brick is not the street bill. The slat is not the pallet, the alley crate end, or `prop_dock_crate`.

## Kept

`arch_hero_crime_tenement_bay`, `arch_hero_crime_warehouse_door`, `arch_hero_crime_escape_stair`, `env_crime_sodium_lamp`, `env_crime_fire_escape`, `env_crime_wharf_bollard`, `env_crime_warehouse_door`, `env_crime_bill_board`, `env_crime_overpass_pier`, `env_crime_gutter_mouth`, `prop_dock_crate`, `prop_dock_hook`, `prop_sodium_lamp`, `prop_rose_pin`, `prop_crime_spoil_bill`.

Hand truck, rail dolly, and wharf cart are `B26_vehicles_urban`, not this kit. No rifle, shotgun, or pistol. No Flower Law urn. `Pistol_*` stays unbound. Crime's eight interior modules and the drip sill are `B24_arch_rest`. This kit stays clutter.

## Cross-world sixes (B23_props_global)

Sixty rows in `GLOBAL_CLUTTER_B23.json`. Ten kits, six slots each. The roles repeat: vessel, lean, chip, bundle, fitting, rest. Each `aura_prompt` is one subject. A later contact sheet may group a kit. Do not ask Aura for a six-up image.

Snap 1 m. `softenter_landmark` is false. No lettering. No rifle. `Pistol_*` stays unbound. Door clear on every parent hall stays 1.2 × 2.2 m.

| kit | world | parent | adjacent |
| --- | --- | --- | --- |
| prop_kit_hub_market_six | Hub | arch_hero_hub_market_facade | no |
| prop_kit_sunder_shrine_six | Fantasy | arch_hero_sunder_shrine_hall | yes |
| prop_kit_tunya_terrace_six | Tunya | arch_hero_tunya_terrace_hall | yes |
| prop_kit_ruins_catalogue_six | Ruins | arch_hero_ruins_catalogue_hall | yes |
| prop_kit_crime_alley_six | Crime | arch_hero_crime_tenement_bay | no |
| prop_kit_grid_bridge_six | Cyber | arch_hero_cyber_bridge_hall | yes |
| prop_kit_frontier_cabin_six | Frontier | arch_hero_frontier_cabin_hall | yes |
| prop_kit_dawn_spire_six | Superhero | arch_hero_dawn_spire_hall | yes |
| prop_kit_crucible_lattice_six | Crucible | arch_hero_crucible_lattice_hall | yes |
| prop_kit_sere_tally_six | Sere | arch_hero_sere_tally_hall | yes |

Hub market six sits outside the 42 m disk: brass saucer, split lath, one wood shaving, twine hank, bent nail, crate lid. The council-hall fourteen stay. The nail is not court steel.

Sundering six dresses the shrine apron: horn cup, mossed stake, granite chip, reed tie, harness ring, root seat. The hall stays the hero. The stake is not the salt toll.

Tunya six dresses the terrace apron: dye bowl, cane, limestone chip, fiber hank, graft peg, palm rest. Fruit stays on `flora_tunya_terrace_tree`. The bowl is not `prop_basket`. The peg is not `prop_graft_scar`. The solar tile stays the B24 stand piece.

Ruins six dresses the catalogue apron: ash bowl, plaster stick, cinder, shroud fold, iron staple, slab seat. No catalogue number. The staple is not `faun_ruins_staple_beetle`. The cinder is not `prop_ash_cairn`.

Crime alley six stays out of the first frame: unlabeled bottle, wet board, loose brick, rag wad, washer, crate end. Tenement and warehouse kits stay. No neon. The crate end is not the pallet, the stool, or `prop_dock_crate`. The brick is not the curb run.

Grid six dresses the bridge hall: resin cup, conduit offcut, acrylic chip, fiber hank, blank clip, low crate. No digit. No neon sign. Not on the sky floor from (−25.77, −58.0) to (−19.37, −62.8). The hank is not `prop_cable_coil`. The clip is not `prop_count_slate`.

Frontier six dresses the cabin apron: tin bowl, tent stake, salt chip, canvas roll, buckle tab, box end. Not the plaque at (−34, 0). The roll is not `veh_frontier_wind_sail`. The buckle is not `prop_frontier_spoil_rivet`. The bowl is not `prop_canteen`.

Dawn six dresses the spire apron: thick glass, short strut, paint chip, tape roll, blank disc, pad stool. The disc is not `prop_mercy_circlet`. The strut is not Kane's fin. The stool is not `env_dawn_roof_pad` and not a victory plinth.

Crucible six is cold: slag cup, quenched rod, quartz chip, wire hank, open-eye pin, ingot seat. No glow. The pin's eye stays open. The rod is not `wpn_2h_crucible_ventbar`. Construct cap stays 0.

Sere six is cold: soot bowl, unlettered stake, tar chip, knotted rag, flat hook, firebrick. No flame tongue. The hook is not `wpn_1h_sere_brandhook`. The brick is not the furnace facade. The furnace belt stays clear of this kit.
