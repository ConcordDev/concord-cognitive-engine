# Deferral 13 — Chunk Streaming (Formal Deferral)

## Decision

**Deferred to a future phase.** Not built in this wave.

## Rationale

Per user direction during the deferrals plan: *"Idk, what works best."* The redundancy sweep confirmed:

- `cityPresence` already does **server-side spatial chunking** at `CHUNK_SIZE = 100m`
- Phase 12 shipped a **THREE.LOD utility** + `distanceCullMeshes()` helper that handles the visual side at current world scale
- ConcordiaScene already does **frustum culling** on the buildings layer
- World scale is **not kilometer-class** — 175 lenses, Concordia just 3 weeks old, single district at a time

A full chunk-streaming pipeline (manifest, async loader, lifecycle, ±3-chunk window, migration of every mesh-spawn site) is 1-2 weeks of focused work. At current world scale, **the delta over LOD + frustum culling is invisible to the player**. The cost-benefit doesn't favor shipping it now.

## When to revisit

Re-open this deferral when:

1. A single Concordia world reaches **>10× current asset density** (cities with hundreds of buildings per district)
2. Frame profiling shows **mesh draw calls** as the bottleneck (LOD + frustum culling already handle the geometry-cost side)
3. Memory profiling shows **idle GPU memory > 1.5GB** from off-screen meshes (the case streaming actually solves)

Until then, the LOD utility is enough.

## What's already in place if streaming is added later

- `cityPresence.CHUNK_SIZE = 100m` defines the grid
- `physicsWorld.removeBuildingCollider(key)` (Phase 2) is the hook for unloading colliders alongside meshes
- `physicsWorld.syncFromScene()` (Phase 11) is the hook for re-registering colliders on chunk load
- `addBuilding`/`removeBuilding` on ConcordiaScene already manage the mesh lifecycle
- `@react-three/drei`'s `useGLTF` is already a dependency

A future Phase 13b would add:
- `concord-frontend/lib/world-lens/chunk-manager.ts` — chunk lifecycle
- `content/world/chunks/<world>/<x>_<z>.json` — chunk manifests
- Migration `076_world_chunk_state.js` — server-side per-user load tracking
- ~30 mesh-spawn callsites migrated to opt into chunked loading via `userData.chunk = '<x>_<z>'`

Not in this branch.
