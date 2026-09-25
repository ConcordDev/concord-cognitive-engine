# MOBILITY_BIND

**STATUS: COMPLETE** (cycle 2, slice A01, batch `B21_anim_mobility`)
**Source:** `world-forge/W05_transport_graph_spec` (31 atlas edges). This file does not retime them.
**Controllers:** `ConcordiaLocomotion` for CX bodies, `CreatureGraph` for fauna, `VehicleRoll` for carts that already exist. No fourth controller. No mesh.

Clocks stay clocks. A minute count is not a clip length. Plaque minutes, atlas kilometres, Present metres, and Hub canon metres stay the four W05 clocks.

## Kind → clip

| W05 kind | Body | Clip | What stays unbound |
| --- | --- | --- | --- |
| `gate` (8, 2 min) | CX at the plaque, ring 34 m | `Walk_Formal_Loop`, then SoftEnter idle on the far side | A 400 km walk. A dance. A drawn blade inside the 42 m disk. |
| `road` (5 km/h) | CX on a Crown Road or a finished march | `Walk_Loop` | Jog and sprint as the atlas clock. They remain local play. |
| `walker` (3.5 km/h) | CX on `walk_tunya_frontier`, `walk_frontier_crime`, `seam_crucible_cyber` | `Walk_Loop`, stride scale 0.7 | A mount. A bridle. A second walk clip. |
| `sea` | none | no clip | Hull, barge, oar, skiff, sail-as-ship. `Driving_Loop`. |
| `weak` (3 km/h) | CX on `waystone_crime_sere` | `Crouch_Fwd_Loop` or `Walk_Loop` | `trav.climb` (still MISSING). A Link door. A Sere gate. |

`march_crucible_cyber` stays out of the pathfinder. People play the walker row on `seam_crucible_cyber`. The seam stays unfinished.

## Foot exceptions

- `tunya_nil`: wheels stay at `v = 0` (`no_clearcut`). Feet use `Walk_Loop`. Saturated ground does not add a clip.
- `tunya_aekon_glacier`: `Walk_Loop` at the 3 km/h design intent. No barge. No ice spell clip.
- `cross_tunya_masond`: foot only. No bridge Animator.
- `pass_frontier_drift`: the bridge site is not a river. Walker Paths stay the two walker edges. No ford clip.
- `pass_sunder_salt`: dry track, `Walk_Loop`. Not a new Crown Road.
- House Voss: stair fragment. `Walk_Loop` on the existing stair mesh. Not a fly clip.
- Sea-mask cells: impassable on foot except a coast an existing edge already names. `trav.swim_*` plays only when the body is already in spoke water.

## What this pass refuses

No boat mesh. `sea_crime_superhero` is a cost class named river barge; it does not author a hull. The Frontier wind sail stays cloth on `prop_wagon`, not an Exodus ship. Sere has no Link gate. Flower Law does not travel with the traveler. The Dawn plaque is inside the 42 m disk; the Dawn continent is not. Steel on a Hub plaque is a flower. `Pistol_*` stays unbound. No rifles. No Vinewood. Ten worlds only. CX bodies only.

Spec row `anim_spec_mobility_bind` is not a pod job. The three B21 skinned cards stay the only animation meshes.
