# Phase 2 — Building Collider Retroactive Registration

## Goal

Ensure every building mesh in a Concordia scene has a Rapier collider — including buildings the scene loader places asynchronously after physics init, and those that were placed before any user interaction.

## Pre-implementation discoveries

Critical correction to the original spec: **`createBuildingCollider` exists in `physics-world.ts:79` but has zero callsites in the entire codebase.** The CLAUDE.md note "Rapier3D installed, not integrated with world movement" was directionally right but understated — buildings were never registered with the physics world at all. So the gap isn't just retroactive sync; it's *any* sync at all.

## Changes

### `concord-frontend/lib/world-lens/physics-world.ts`

- `init()` now also pre-loads `three` so subsequent building registrations can compute bounding boxes synchronously.
- `createBuildingCollider(position, halfExtents, entityId?)` — added optional `entityId` param so the collider key follows the entity (`building:<id>`) instead of being random. Necessary for idempotent registration.
- **New** `registerBuildingFromObject(obj, entityId)` — derives a box collider from the Three.js `Box3.setFromObject` AABB of the supplied object, stamps `userData.physicsKey` and `userData.isBuilding = true` on it, returns the collider key. Idempotent: if `userData.physicsKey` already points to a registered collider, returns the existing key. Tiny / degenerate AABBs (<5cm in any dimension) are skipped to avoid registering placeholders.
- **New** `removeBuildingCollider(key)` — removes the body and collider; safe to call with unknown keys.
- **New** `syncFromScene(root)` — `traverse`s a scene subtree, registers any `userData.isBuilding === true` object that has not yet been registered. Returns the number of new registrations. Idempotent — call after scene-ready, after async building loads, on world-resume, etc.

### `concord-frontend/components/world-lens/ConcordiaScene.tsx`

- Widened `physicsRef` type to expose the new methods.
- `addBuilding` now stamps `userData.isBuilding = true` and `userData.buildingId`, then fires `physicsRef.current?.registerBuildingFromObject(group, id)` so newly-placed buildings get colliders immediately.
- `removeBuilding` now reads back `userData.physicsKey` and calls `physicsRef.current?.removeBuildingCollider(physicsKey)` to clean up the Rapier body when a building is removed.
- After scene-ready, before dispatching `concordia:scene-ready`, we invoke `physicsRef.current?.syncFromScene(scene)` inside a try/catch. This catches any buildings the scene loader placed before our `addBuilding` API got involved (the original spec's actual concern). Wrapped in try/catch so a physics-sync failure can never block scene-ready.

## Verification

- `npx tsc --noEmit` — no errors in touched files
- `npx eslint lib/world-lens/physics-world.ts components/world-lens/ConcordiaScene.tsx` — 0 errors. The 2 warnings are pre-existing unused-eslint-disable directives outside the edit range.
- Manual verification (deferred to Phase 20): refresh world page, walk into a building, confirm collision; place a new building during session, walk into it, confirm collision; remove a building during session, confirm the collider goes away (no ghost collision).

## Files touched

| File | Action |
|---|---|
| `concord-frontend/lib/world-lens/physics-world.ts` | extended (new types, 4 new methods, init loads THREE) |
| `concord-frontend/components/world-lens/ConcordiaScene.tsx` | extended (physicsRef type widened, addBuilding/removeBuilding wire colliders, syncFromScene called pre-ready) |

## Notes for downstream phases

- Phase 5 (death ragdoll): the dynamic-rigidbody bone chain will need wall colliders to actually collide against. This phase ensures those wall colliders exist.
- Phase 6 (environmental knockback): `world.contactPairsWith(handle, ...)` needs registered colliders on both sides — buildings now qualify.
- Phase 11 (generalized collider registration): extends the `userData.isBuilding` pattern to `userData.colliderProfile = 'box' | 'capsule' | 'mesh' | 'none'` for vegetation, props, vehicles, NPCs.
