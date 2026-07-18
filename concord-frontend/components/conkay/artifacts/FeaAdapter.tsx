'use client';

// concord-frontend/components/conkay/artifacts/FeaAdapter.tsx
//
// Unit F9 (K5) — the `fea-frame` adapter. Wraps the real `FEAResultViewer` with
// the exact solver output the `detectArtifact` registry produced via the store's
// `feaResultFromRun` — the SAME pure reshape ForwardSimPanel embeds, so the two
// surfaces render byte-identical FEA. Every number here is the solver's own
// computed output (displacements / utilization / stress), never fabricated.
//
// S2-b — "step in": the same reusable orbit↔walk free-cam the creature adapter
// uses, threaded through FEAResultViewer's optional `cameraControls` seam (which
// defaults to plain OrbitControls everywhere else, so ForwardSimPanel is
// unchanged). The walk start pose is derived from the frame's REAL node bounding
// box — you walk through the actual solved geometry at its real metre scale.

import { useMemo, useState } from 'react';
import { FEAResultViewer } from '@/components/engineering/FEAResultViewer';
import type { ConkayFeaArtifact } from '@/lib/conkay/artifact-kinds';
import { StepInControls } from './StepInControls';
import { StepInToggle } from './StepInToggle';

/** Frame the walk cam from the real node bounding box: aim at the centroid,
 *  start a step back at mid-height. Pure geometry — no invented dimensions. */
function walkPoseFromNodes(
  nodes: { x: number; y: number; z: number }[],
): { target: [number, number, number]; walkStart: [number, number, number] } {
  const xs = nodes.map((n) => n.x);
  const ys = nodes.map((n) => n.y);
  const zs = nodes.map((n) => n.z);
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2;
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2;
  const cz = (Math.min(...zs) + Math.max(...zs)) / 2;
  const diag = Math.hypot(
    Math.max(...xs) - Math.min(...xs),
    Math.max(...ys) - Math.min(...ys),
    Math.max(...zs) - Math.min(...zs),
  );
  const dist = Math.max(diag * 0.6, 2);
  return { target: [cx, cy, cz], walkStart: [cx + dist * 0.5, cy, cz + dist * 0.7] };
}

export function FeaAdapter({ artifact }: { artifact: ConkayFeaArtifact }) {
  const { fea } = artifact;
  const [mode, setMode] = useState<'orbit' | 'walk'>('orbit');
  const hasGeometry = fea.nodes.length > 0;
  const pose = useMemo(
    () => (hasGeometry ? walkPoseFromNodes(fea.nodes) : null),
    [hasGeometry, fea.nodes],
  );

  return (
    <div data-testid="ck-adapter-fea-frame" className="w-full">
      <div className="relative">
        <FEAResultViewer
          nodes={fea.nodes}
          members={fea.members}
          displacements={fea.displacements}
          showStress
          height="340px"
          cameraControls={
            pose ? (
              <StepInControls mode={mode} target={pose.target} walkStart={pose.walkStart} />
            ) : undefined
          }
        />
        {/* Step-in toggle only when there's real geometry to walk through. */}
        {hasGeometry && (
          <StepInToggle
            mode={mode}
            onToggle={() => setMode((m) => (m === 'orbit' ? 'walk' : 'orbit'))}
          />
        )}
      </div>
      {/* Honest caveat about the NATURE of the numbers — a deterministic model,
          not a certification of real-world behaviour (mirrors ForwardSimPanel). */}
      <div data-testid="ck-adapter-fea-caveat" className="mt-2 px-1 text-[10px] text-amber-300/60">
        Deterministic FEA model — the solver&apos;s exact computed output, not a
        certification of real-world structural behaviour.
      </div>
    </div>
  );
}

export default FeaAdapter;
