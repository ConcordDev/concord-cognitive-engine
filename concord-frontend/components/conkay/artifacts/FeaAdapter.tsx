'use client';

// concord-frontend/components/conkay/artifacts/FeaAdapter.tsx
//
// Unit F9 (K5) — the `fea-frame` adapter. Wraps the real `FEAResultViewer` with
// the exact solver output the `detectArtifact` registry produced via the store's
// `feaResultFromRun` — the SAME pure reshape ForwardSimPanel embeds, so the two
// surfaces render byte-identical FEA. Every number here is the solver's own
// computed output (displacements / utilization / stress), never fabricated.

import { FEAResultViewer } from '@/components/engineering/FEAResultViewer';
import type { ConkayFeaArtifact } from '@/lib/conkay/artifact-kinds';

export function FeaAdapter({ artifact }: { artifact: ConkayFeaArtifact }) {
  const { fea } = artifact;
  return (
    <div data-testid="ck-adapter-fea-frame" className="w-full">
      <FEAResultViewer
        nodes={fea.nodes}
        members={fea.members}
        displacements={fea.displacements}
        showStress
        height="340px"
      />
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
