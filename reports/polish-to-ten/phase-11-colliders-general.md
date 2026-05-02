# Phase 11 — Generalized Collider Registration

## Goal

Extend the building-specific `syncFromScene` from Phase 2 into a general-purpose registration system that handles any object via a `userData.colliderProfile` tag — vegetation, props, vehicles, NPCs.

## Changes

### `concord-frontend/lib/world-lens/physics-world.ts`

`syncFromScene` extended to honor `userData.colliderProfile` in addition to the legacy `userData.isBuilding`:

- `'box'` — AABB-derived box collider (same as buildings)
- `'capsule'` — vertical capsule sized from mesh height + min(x,z) half-extent
- `'mesh'` — falls back to box for now (true mesh colliders are heavy; can be a follow-up using Rapier's trimesh shapes)
- `'none'` / undefined — skipped

The legacy `isBuilding === true` path implies `'box'` for back-compat.

The new `_registerCapsuleFromObject` helper computes a Rapier `ColliderDesc.capsule(halfHeight, radius)` from the Three.js `Box3.setFromObject` AABB. Same idempotency guard as buildings (skip if `userData.physicsKey` already maps to a registered collider).

## Usage

Any place that adds a Three.js Object3D to the scene now just stamps `userData.colliderProfile` and the next `syncFromScene` call (or any `addBuilding` callsite) registers the collider:

```ts
treeMesh.userData.colliderProfile = 'capsule';
treeMesh.userData.entityId = `tree:${id}`;
scene.add(treeMesh);

// Next scene-ready or explicit sync registers it.
physicsWorld.syncFromScene(scene);
```

For NPCs, the existing `physicsWorld.createCharacterController(id)` is still the right path — that's a kinematic capsule with movement controller, not a static prop. `colliderProfile: 'capsule'` is for static-pose props (trees, statues, columns).

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint lib/world-lens/physics-world.ts` — clean (2 warnings pre-existing)
- Manual verification (Phase 20): tag a few props in the scene with `colliderProfile: 'capsule'` and `'box'`, walk the player into them — collision works.

## Files touched

| File | Action |
|---|---|
| `concord-frontend/lib/world-lens/physics-world.ts` | extended syncFromScene + new _registerCapsuleFromObject helper |

## Notes for downstream phases

- Phase 12 (LOD/streaming): when chunks unload, the corresponding colliders should also unload. Cleanup hook can iterate `userData.physicsKey` on the chunk subtree and call `removeBuildingCollider`. Out of scope for this phase but the API supports it.
- Mesh-collider profile: when needed (large rocks, terrain features beyond the heightfield), wire Rapier's `ColliderDesc.trimesh(vertices, indices)` from the buffer geometry. Marked TODO in the code.
