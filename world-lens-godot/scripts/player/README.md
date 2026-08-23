# Player scripts — procedural mesh

| File | Role |
|---|---|
| `body_proportions.gd` | Pure port of `character-schema.ts#proportionsFor` + `AvatarSystem3D.tsx#BODY_DIMENSIONS` + collision-capsule scaling. |
| `procedural_player_mesh.gd` | Box/cylinder/sphere humanoid (enhanced-avatar-builder.ts limb layout). Honest primitive — no fabricated Skeleton3D. |

Scene: `res://scenes/player/procedural_player_mesh.tscn`

Live path today still mounts `AvatarRig` on the local `CharacterController` (GLB-first, capsule-limb primitive fallback + gait sockets). This mesh is the authored/standalone counterpart to `scripts/npcs/procedural_npc_mesh.gd`, and `boot.gd` already scales the local player's collision capsule through `BodyProportions.collision_capsule` using the resolved appearance archetype.

Tests: `tests/test_body_proportions.gd`, `tests/test_procedural_player_mesh.gd` (wired into `tests/run_all.gd`).
