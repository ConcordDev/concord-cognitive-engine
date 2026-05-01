# Phase 12 — LOD Utility (and a streaming deferral)

## Goal

Ship a reusable LOD helper so any mesh-spawning callsite can opt into Three.js LOD with the standard distance bands without re-deriving thresholds. Document the broader chunk-streaming work as a deferral.

## Methodology note

The original spec called for full chunk-based world streaming + LOD on every mesh type. That's two distinct subsystems:

- **LOD (per-mesh):** swap detailed → medium → low → billboard at distance bands. Tractable with Three.js's built-in `THREE.LOD`.
- **Chunk streaming:** load assets when player approaches, unload when they leave. Requires asset manifest, async loader, chunk lifecycle, and migration of every existing mesh-spawn site to opt into chunked loading.

Chunk streaming touches ~30+ mesh-spawn callsites across `ConcordiaScene`, `IsometricEngine`, NPC system, vegetation system, props, etc. That's 1-2 weeks of careful surgery. The `cityPresence` system already handles spatial chunking server-side; client-side full streaming is a meaningful but contained follow-up.

For Phase 12 of polish-to-ten, the right call is to ship the **LOD utility** so any callsite that wants to opt in can — and explicitly defer the full streaming migration to a follow-up. The visual win from one well-placed LOD chain (e.g. trees) is greater than half-built streaming infrastructure.

## Changes

### `concord-frontend/lib/world-lens/lod.ts` (new)

Two exports:

- `makeStandardLOD(THREE, levels, bands?)` — wraps `THREE.LOD` with the spec's standard bands (high <50m, medium 50–200m, low 200–500m, billboard 500m+). Callers pass meshes for the levels they want; missing levels just stay at the previous band.
- `distanceCullMeshes(meshes, cameraPosition, cullAt = 600)` — cheap distance-based visibility cull for props that don't merit a full LOD chain. Complements the existing frustum culling at `ConcordiaScene.tsx:575-587`.

Standard bands exported as `STANDARD_LOD_BANDS` for callers that need to tweak them per asset class.

## How callers opt in (example)

```ts
import { makeStandardLOD } from '@/lib/world-lens/lod';

const lod = makeStandardLOD(THREE, {
  high:      detailedTree,
  medium:    midTree,
  low:       lowTree,
  billboard: treeBillboard,
});
scene.add(lod);
```

Existing meshes that don't have multi-detail variants can opt into the cheap-cull helper:

```ts
import { distanceCullMeshes } from '@/lib/world-lens/lod';

// Inside the per-frame update tick:
distanceCullMeshes(propsLayer.children, camera.position, 600);
```

## Verification

- `npx tsc --noEmit` — clean
- `npx eslint lib/world-lens/lod.ts` — clean

## Files touched

| File | Action |
|---|---|
| `concord-frontend/lib/world-lens/lod.ts` | created — `makeStandardLOD` + `distanceCullMeshes` |

## Deferred

Full chunk-streaming migration. The follow-up needs:
1. A chunk-asset manifest (which meshes belong to which 64m × 64m chunk)
2. Async chunk loader using existing dynamic import / fetch infrastructure
3. Per-frame check: which chunks are within ±3 chunks of player position; load missing, unload distant
4. Hook into the Phase 11 `physicsWorld.removeBuildingCollider` to also drop colliders when chunks unload

This is tractable but requires its own dedicated phase. Documented as Phase 12b.

## Notes for downstream phases

- Phase 13 (visual polish): LOD will compose with post-processing (bloom, DoF) — billboards in the far band don't need bloom evaluation, saving GPU.
- Phase 14 (spatial audio): far-distance attenuation in the audio system already cuts off at ~150m on most reverb zone configs (`spatial-audio.ts`); LOD's billboard band corresponds to "audio-silent" props, no cross-system change needed.
