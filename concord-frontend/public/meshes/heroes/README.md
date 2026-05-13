# Hero Meshes

Drop `.glb` files here to upgrade specific NPCs from the procedural
primitives + skin-SSS pipeline to authored skinned meshes.

## File naming

The hero-mesh-registry tries these paths in order:

1. `/meshes/heroes/<npc_id>.glb`                — per-NPC bespoke
2. `/meshes/heroes/_archetype_<archetype>.glb`  — shared archetype
3. BB1 procedural skinned humanoid              — graceful fallback
4. Primitive THREE.Group humanoid               — last-resort

## Archetype slot list

Drop these to enable archetype-tier fallbacks (any unshipped slot
falls through to the procedural humanoid):

- `_archetype_warrior.glb`
- `_archetype_guard.glb`
- `_archetype_scholar.glb`
- `_archetype_mystic.glb`
- `_archetype_hunter.glb`
- `_archetype_trader.glb`
- `_archetype_legend.glb`

## Bone hierarchy

Skeletons MUST follow Mixamo / VRM 1.0 humanoid names so the existing
gait-synthesis bone outputs apply directly:

  Hips, Spine, Spine1, Spine2, Neck, Head,
  LeftShoulder, LeftArm, LeftForeArm, LeftHand,
  RightShoulder, RightArm, RightForeArm, RightHand,
  LeftUpLeg, LeftLeg, LeftFoot,
  RightUpLeg, RightLeg, RightFoot

## Hero-mesh flag

Set `"hero_mesh": true` on an NPC in `content/world/<world>/npcs.json`
to make the renderer attempt the GLB path. The Three Above All
(sovereign_first_refusal / concord_first_thought /
concordia_first_breath / weaver_of_echoes) are auto-flagged.

## Why no GLBs shipped

The asset pipeline is fully wired (`lib/world-lens/asset-loader.ts`
+ `lib/concordia/hero-mesh-registry.ts`) but ship-quality character
art is out of scope for an engineering pass. The skin-SSS + hair-
cards + eye-parallax procedural path produces a defensible character
look without any GLB on disk.
