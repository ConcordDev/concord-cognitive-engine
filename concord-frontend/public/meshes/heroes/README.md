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

All 7 archetype-tier slots (and their per-world variants) are populated
with real Mixamo-sourced character meshes — see `CREDITS.md` for
provenance/license and which source mesh backs which archetype:

- `_archetype_warrior.glb`
- `_archetype_guard.glb`
- `_archetype_scholar.glb`
- `_archetype_mystic.glb`
- `_archetype_hunter.glb`
- `_archetype_trader.glb`
- `_archetype_legend.glb`

Drop a differently-named file in any slot to replace it — any archetype
you don't ship falls back to the procedural humanoid, same as before.

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

## Asset pipeline

Fully wired: `lib/world-lens/asset-loader.ts` + `lib/concordia/hero-mesh-registry.ts`.
The skin-SSS + hair-cards + eye-parallax procedural path (used by the
character CREATOR, which needs to react live to skin/hair/clothing
choices — a real baked GLB can't do that) remains the fallback for
anything not covered by a GLB here, and is what's used for the local
player and any NPC/archetype slot without a shipped mesh.
