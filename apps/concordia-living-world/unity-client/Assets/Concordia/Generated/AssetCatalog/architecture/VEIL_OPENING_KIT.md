# Veil opening kit (Tunya, cycle 2)

Batch `B24_arch_tunya`. Kit `arch_kit_tunya_veil`. Parent `arch_hero_tunya_terrace_hall` only. Sixteen new rows in `batches/B24_arch_tunya_cycle2.json`, merged onto the nine in `architecture/TUNYA_INTERIORS_B24.json` (count 25). The nine stay. B19 heroes stay.

Opening parts snap at 1 m so the 1.2 × 2.2 m clear stays a hole. Wainscot, gallery rail, and soffit snap at 4 m. The bench, planter, niche, loom, and graft post snap at 1 m. `softenter_landmark` is false. `interior` is true. `flower_law` is `outside_hub_disk`. Unlettered. No glass. No fruit. No flame mesh. No rifle.

Door kit:

- `arch_int_tunya_door_jamb` — living-wood upright, limestone shoe. The leaf stays `arch_int_tunya_door_leaf`.
- `arch_int_tunya_door_head` — short timber head. Not the lintel on the hall hero.
- `arch_int_tunya_thresh` — limestone tread with a wood nosing. Not `env_tunya_terrace_lip`.
- `arch_int_tunya_reveal` — wall thickness beside the clear.

Window kit:

- `arch_int_tunya_window_frame` — empty timber surround. The shutter stays `arch_int_tunya_shutter_leaf`.
- `arch_int_tunya_mullion` — one timber bar.
- `arch_int_tunya_window_sill` — projecting sill, pollen in one joint. Not `arch_int_tunya_solar_tile`. Not `env_tunya_solar_eave`.
- `arch_int_tunya_reed_leaf` — bound reed screen. Not `flora_tunya_cliff_reed`. Not `flora_tunya_dye_reed`. Not a shutter board.

Hall dress, 4 m: `arch_int_tunya_wainscot`, `arch_int_tunya_gallery_rail`. The rail is not `arch_hero_tunya_canopy_stair` and not `env_tunya_masond_cliff_stair`. The wainscot is not the floor bay.

Set dressing:

- `arch_int_tunya_seed_bench` — empty seat the seed table left open. Not `prop_hub_se_bench`. Not `prop_tunya_cl_palm_rest`.
- `arch_int_tunya_planter_bay` — empty trough. No plant. Not `prop_tunya_cl_dye_bowl`. Fruit stays on `flora_tunya_terrace_tree`.
- `arch_int_tunya_soffit` — boards under the eave, seen from below, 4 m. Not `arch_int_tunya_wood_ceiling`. Not the exterior solar eave.
- `arch_int_tunya_niche` — empty square recess. Not the dye shelf. Not the solar tile.
- `arch_int_tunya_loom_frame` — two posts, two beams, open middle. No warp. Not `prop_tunya_cl_fiber_hank`.
- `arch_int_tunya_graft_post` — one upright, one healed scar, limestone foot. Not `arch_hero_tunya_graft_facade`. No `prop_tunya_cl_graft_peg`.

## Reuse

`unity_bind.pattern_slot` is the job name: door_jamb, door_head, threshold, reveal, window_frame, mullion, window_sill, screen_leaf, wainscot, gallery_rail, bench, planter, soffit, niche, loom_frame, graft_post.

This pass fills those slots in living wood and limestone. The same slot list can take another world's material later. Do not place these Tunya meshes on the shrine, catalogue, tenement, bridge, cabin, spire, lattice, or tally halls. Do not regen the hall, the graft facade, the canopy stair, the lockhouse, the terrace lip, the Masond cliff stair, or the three-fruit tree.

Fluxom Gate at Tunya-local (62, 18) m is not Pinewood Crossing. Flower Law stays the 42 m Hub disk.
