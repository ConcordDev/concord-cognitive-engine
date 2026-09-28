# Interior module pattern (ten worlds authored)

**STATUS: Hub, Tunya, and the eight remaining spokes are real rows.**

Hub, batch `B24_arch_interior`, kit `arch_kit_hub_court`, parent hall `arch_hero_hub_council_hall`:

- `arch_int_hub_council_floor`
- `arch_int_hub_timber_ceiling`
- `arch_int_hub_council_table`
- `arch_int_hub_archive_shelf`
- `arch_int_hub_shutter_leaf`
- `arch_int_hub_stair_flight`
- `arch_int_hub_wall_sconce`
- `arch_int_hub_hearth_cold`
- `arch_int_hub_door_leaf`

Tunya, batch `B24_arch_tunya`, kit `arch_kit_tunya_veil`, parent hall `arch_hero_tunya_terrace_hall`. File `architecture/TUNYA_INTERIORS_B24.json`:

- `arch_int_tunya_terrace_floor`
- `arch_int_tunya_wood_ceiling`
- `arch_int_tunya_seed_table`
- `arch_int_tunya_dye_shelf`
- `arch_int_tunya_shutter_leaf`
- `arch_int_tunya_terrace_stair`
- `arch_int_tunya_hold_sconce`
- `arch_int_tunya_door_leaf`
- `arch_int_tunya_solar_tile`

Remaining spokes, batch `B24_arch_rest`, file `architecture/REST_INTERIORS_B24.json`. Eight jobs plus one dressing piece each. Parent is that world's SoftEnter hall. Kit id is unchanged.

- Fantasy `arch_kit_fantasy_sunder` / `arch_hero_sunder_shrine_hall`: floor, timber ceiling, pine table, cloth shelf, shutter, stair, empty hook, door, green cloth fold.
- Ruins `arch_kit_ruins_ash` / `arch_hero_ruins_catalogue_hall`: ashlar floor, rib ceiling, ash table, blank-spine shelf, slab shutter, stair, cold iron hook, slab door, one blank spine.
- Crime `arch_kit_crime_coast` / `arch_hero_crime_tenement_bay`: wet floor, plaster ceiling, wet table, empty shelf, hung shutter, wet stair, empty hook block, door, drip sill.
- Cyber `arch_kit_cyber_grid` / `arch_hero_cyber_bridge_hall`: panel floor, tube ceiling, panel table, cloth-and-tube shelf, panel shutter, stair, empty glass hook, door, cloth tube sleeve.
- Frontier `arch_kit_frontier_road` / `arch_hero_frontier_cabin_hall`: dust floor, wide-eave ceiling, dust table, open shelf, dust shutter, stair, empty iron hook, door, interior eave knee.
- Superhero `arch_kit_superhero_dawn` / `arch_hero_dawn_spire_hall`: cracked pale floor, pale ceiling, stone table, stone shelf, shutter, stair, empty brass hook, door, loose brass line.
- Crucible `arch_kit_crucible_lattice` / `arch_hero_crucible_lattice_hall`: open-hem floor, unclosed rib ceiling, oak table, gap shelf, hem shutter, gap stair, teal cup, door, open hem block.
- Sere `arch_kit_sere_mark` / `arch_hero_sere_tally_hall`: soot floor, soot ceiling, soot table, empty shelf, soot shutter, stair, cold hook, door, soot course block.

## Grammar (reuse, do not duplicate B19 heroes)

One module, one subject, 4 m snap on the eight jobs, door clear 1.2 × 2.2 m on the door. `softenter_landmark` stays false. `parent_hall` is that world's `arch_hero_*` SoftEnter piece. `kit_id` stays the native-bible kit (`arch_kit_*`), not a new id.

Eight jobs, same order, material swap only: floor, ceiling, table, shelf, shutter, stair, sconce, door. A ninth piece is that world's set dressing and is not a ninth job. Hub's ninth is the cold hearth. Tunya's ninth is one matte solar tile on a short stand (`snap_grid_m` 1). The eight remaining ninths are the cloth fold, blank spine, drip sill, tube sleeve, eave knee, brass line, open hem, and soot course.

## Tunya cycle 2 — veil opening kit

Sixteen rows, same batch `B24_arch_tunya`, file `batches/B24_arch_tunya_cycle2.json`. Notes `architecture/VEIL_OPENING_KIT.md`. Merged onto the nine in `architecture/TUNYA_INTERIORS_B24.json` (count 25). The nine stay. Heroes stay. Parent stays `arch_hero_tunya_terrace_hall`. Kit stays `arch_kit_tunya_veil`.

Door and window parts snap at 1 m: jamb, door head, threshold, reveal, empty frame, mullion, window sill, reed screen. Wainscot, gallery rail, and soffit snap at 4 m. Bench, planter, niche, loom frame, and graft post snap at 1 m. No glass. No fruit. No plant in the trough. The reed screen is bound reeds, not a flora row. The loom is an empty frame. The graft post has one scar and no peg.

`pattern_slot` is the reusable job name. This pass authors the Tunya material only. A later spoke pass can swap the material and keep the slot. Do not copy these meshes onto the shrine, catalogue, tenement, bridge, cabin, spire, lattice, or tally halls in this batch.

Material line, now authored, from `lookfeel/styles/`:

| world | kit | material swap | do not |
| --- | --- | --- | --- |
| Fantasy | Sundering kit | AUTHORED. Timber, green cloth, pine dirt. Fold is `arch_int_sunder_cloth_fold` | skull staff, glow |
| Tunya | terrace kit | AUTHORED. Living wood. Solar tile is `arch_int_tunya_solar_tile`, not the ceiling. Cycle 2 openings are `architecture/VEIL_OPENING_KIT.md` | loose fruit; do not regen the hall, the eave, the lip, the graft, the canopy stair, the lockhouse, or the three-fruit tree |
| Ruins | catalogue kit | AUTHORED. Ashlar, ash, unlettered spines. One spine is `arch_int_ruins_blank_spine` | skull mask |
| Crime | tenement kit | AUTHORED. Wet timber. Sodium practical stays `prop_crime_se_cage_bulb`. Dressing is `arch_int_crime_drip_sill` | Vinewood sign |
| Cyber | bridge kit | AUTHORED. Scratched panel, cloth and tube. Sleeve is `arch_int_cyber_tube_sleeve` | cyan baked into albedo |
| Frontier | cabin kit | AUTHORED. Dust timber, wide eave. Knee is `arch_int_frontier_eave_knee` | rifle rack |
| Superhero | dawn spire kit | AUTHORED. Cracked pale stone. Brass line is `arch_int_dawn_brass_line` | energy aura mesh |
| Crucible | lattice kit | AUTHORED. Unfinished hem. Teal cup is the sconce. Hem block is `arch_int_crucible_open_hem` | furnace eye |
| Sere | tally kit | AUTHORED. Soot stone. Brand tile stays `prop_brand_tile` / `env_sere_brand_tile`. Course is `arch_int_sere_soot_course` | lettered invoice |

Unlettered except Pinewood Crossing on its milepost. No live steel as set dressing inside Hub's 42 m Flower Law disk. Cold hearth is not a fire VFX.

Crime clutter density is `B23_props_crime` (`props/CRIME_INTERIORS_B23.json`): eight tenement pieces on `arch_hero_crime_tenement_bay`, seven warehouse pieces on `arch_hero_crime_warehouse_door`. Cycle 2 adds twelve more in `props/CRIME_INTERIORS_B23_CYCLE2.json`: six on the stair hall behind the newel, six on the warehouse apron. That pass stays props. Crime's eight interior modules plus the drip sill are `B24_arch_rest`. Do not regen the bay, the roll door, the escape, the street lamp, or the cage bulb as those modules.

B23 clutter uses the same parent hall and a 1 m snap. Do not regen `prop_court_lantern_post`, `prop_flower_law_urn`, or other B10 props under new ids.

## Hub cycle 2 — opening kit

Sixteen rows, same batch `B24_arch_interior`, file `batches/B24_arch_interior_cycle2.json`. Notes `architecture/COURT_OPENING_KIT.md`. The nine council jobs stay. Heroes stay.

Door and window parts snap at 1 m on `arch_hero_hub_council_hall`: jamb, door head, stone sill, reveal, window frame, mullion, window sill, casement leaf. Wainscot and gallery rail snap at 4 m on that hall. Market plank and stall post parent `arch_hero_hub_market_facade` outside the 42 m disk. Arena passage and pier parent `arch_hero_hub_arena_gate` inside the disk, limestone only. Stable floor and stall rail parent `arch_hero_hub_pinewood_stable` at Hub (62, -28). No glass sheet. No horse. The door leaf, shutter leaf, rush mat, shutter stay, half-door latch, and hall heroes stay.
