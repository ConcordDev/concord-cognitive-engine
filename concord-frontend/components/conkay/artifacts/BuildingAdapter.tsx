'use client';

// concord-frontend/components/conkay/artifacts/BuildingAdapter.tsx
//
// Unit F9 (K5) — the `building` adapter. Wraps the real `BuildingRenderer3D` in
// its `stress_heatmap` view mode, fed the exact `BuildingDTU[]` + `ValidationData[]`
// the `detectArtifact` registry matched off a real macro result.
//
// HONEST NOTE (read alongside normalizeBuildingPublish's + normalizeBuilding's
// notes in artifact-kinds.ts): as of Unit A1 (2026-07) this adapter IS fed —
// a successful `game-design.building-publish` run (Asset Studio's publish
// action) normalizes into a real `ConkayBuildingArtifact` built from that
// call's authored input (archetype/feature/dimensions/name/position) + its
// result (buildingId), so it renders the genuine published spec. `validation`
// is honestly empty for a building-publish artifact — the publish path never
// runs a structural analysis, so there is no real stress data to show; the
// heatmap simply has nothing to color, which is the honest state, not a bug.
// The SEPARATE shape-driven detector (any macro returning a literal
// `buildings[]` array) remains dormant, not fabricated — as of 2026-07 no
// other lens macro emits that shape; it lights up unchanged the moment one
// does. Nothing here invents a building — it only renders the renderer's
// real prop shape from a real macro call.

import { useEffect, useState } from 'react';
import BuildingRenderer3D from '@/components/world-lens/BuildingRenderer3D';
import type { ConkayBuildingArtifact } from '@/lib/conkay/artifact-kinds';
import { BuildingIterateBar } from './BuildingIterateBar';
import { rederiveBuildingArtifact } from '@/lib/conkay/iterate-building';

export function BuildingAdapter({ artifact }: { artifact: ConkayBuildingArtifact }) {
  // S3-b — the working copy the Iterate loop mutates. Starts as the real macro
  // artifact; an accepted iteration re-derives it (real render of the new input,
  // non-mutating — publishing is the separate S4 step). A fresh artifact prop
  // (a new macro run) resets both the copy and the edited flag.
  const [working, setWorking] = useState<ConkayBuildingArtifact>(artifact);
  const [edited, setEdited] = useState(false);
  useEffect(() => {
    setWorking(artifact);
    setEdited(false);
  }, [artifact]);

  const applyIteration = (newInput: Record<string, unknown>) => {
    const next = rederiveBuildingArtifact(working, newInput);
    if (next) {
      setWorking(next);
      setEdited(true);
    }
  };
  const revert = () => {
    setWorking(artifact);
    setEdited(false);
  };

  return (
    <div data-testid="ck-adapter-building">
      <div className="relative h-[340px] w-full">
        <BuildingRenderer3D
          buildings={working.buildings}
          validationData={working.validation}
          viewMode="stress_heatmap"
        />
      </div>
      {working.sourceInput && (
        <BuildingIterateBar
          sourceInput={working.sourceInput}
          dirty={edited}
          onApply={applyIteration}
          onRevert={revert}
        />
      )}
    </div>
  );
}

export default BuildingAdapter;
