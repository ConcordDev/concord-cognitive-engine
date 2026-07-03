'use client';

// concord-frontend/components/conkay/artifacts/BuildingAdapter.tsx
//
// Unit F9 (K5) — the `building` adapter. Wraps the real `BuildingRenderer3D` in
// its `stress_heatmap` view mode, fed the exact `BuildingDTU[]` + `ValidationData[]`
// the `detectArtifact` registry matched off a real macro result.
//
// HONEST NOTE (read alongside normalizeBuilding's note in artifact-kinds.ts):
// as of 2026-07 no lens macro reachable through `/api/lens/run` returns the
// BuildingDTU shape (world/building data flows through routes + the world lens,
// not a macro), so this adapter is a REAL renderer that is currently *unfed* by
// ConKay's capture point — dormant, not fabricated. It renders live the moment a
// structural-render macro returns `buildings[]`; until then the shape-driven
// normalizer never matches and the viewer's STOP-POINT covers the kind. Nothing
// here invents a building — it only renders the renderer's real prop shape.

import BuildingRenderer3D from '@/components/world-lens/BuildingRenderer3D';
import type { ConkayBuildingArtifact } from '@/lib/conkay/artifact-kinds';

export function BuildingAdapter({ artifact }: { artifact: ConkayBuildingArtifact }) {
  return (
    <div data-testid="ck-adapter-building" className="relative h-[340px] w-full">
      <BuildingRenderer3D
        buildings={artifact.buildings}
        validationData={artifact.validation}
        viewMode="stress_heatmap"
      />
    </div>
  );
}

export default BuildingAdapter;
