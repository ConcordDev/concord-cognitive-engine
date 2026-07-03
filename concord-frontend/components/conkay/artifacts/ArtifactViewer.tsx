'use client';

// concord-frontend/components/conkay/artifacts/ArtifactViewer.tsx
//
// Unit F9 (K5) — the registry-driven artifact viewer. Given a canonical
// `ConkayArtifact` (produced by the pure `detectArtifact` registry in
// lib/conkay/artifact-kinds.ts), it looks the artifact's `kind` up in the
// ADAPTER map and renders the matching REAL 3D adapter.
//
// THE STOP-POINT (the honesty contract for this whole unit): if a `kind` has NO
// registered adapter, we render a plain, explicitly-worded "inspectable soon"
// label — NEVER a fake/placeholder 3D shape, never invented content, never a
// crash. This is the one place the "unrenderable content stays unrendered with a
// documented, worded reason" rule is enforced for the pipeline, and it's pinned
// by a test (unknown kind → the label text).
//
// This ADAPTER map is the React half of the kind registry (the "which real
// component renders it" mapping from the spec). The pure normalizer half lives
// in lib/conkay/artifact-kinds.ts — kept separate so the heavy Three.js adapters
// below never get pulled into the pure, unit-tested normalizer path.

import type { JSX } from 'react';
import type {
  ConkayArtifact,
  ConkayArArtifact,
  ConkayFeaArtifact,
  ConkayBuildingArtifact,
  ConkayFoundryArtifact,
  ConkayForgeArtifact,
} from '@/lib/conkay/artifact-kinds';
import { artifactKindLabel } from '@/lib/conkay/artifact-kinds';
import { ArAdapter } from './ArAdapter';
import { FeaAdapter } from './FeaAdapter';
import { BuildingAdapter } from './BuildingAdapter';
import { FoundryAdapter } from './FoundryAdapter';
import { ForgeAdapter } from './ForgeAdapter';

// kind → real 3D adapter. Keyed by string (not the ConkayArtifactKind union) so
// an artifact carrying an UNREGISTERED kind cleanly misses the map and hits the
// STOP-POINT below instead of being a compile error — the runtime honesty guard
// has to exist even though the union is exhaustive.
const ADAPTERS: Record<string, (artifact: ConkayArtifact) => JSX.Element> = {
  'ar-render': (a) => <ArAdapter artifact={a as ConkayArArtifact} />,
  'fea-frame': (a) => <FeaAdapter artifact={a as ConkayFeaArtifact} />,
  building: (a) => <BuildingAdapter artifact={a as ConkayBuildingArtifact} />,
  'foundry-worldspec': (a) => <FoundryAdapter artifact={a as ConkayFoundryArtifact} />,
  'forge-app': (a) => <ForgeAdapter artifact={a as ConkayForgeArtifact} />,
};

export function ArtifactViewer({ artifact }: { artifact: ConkayArtifact }) {
  const render = ADAPTERS[artifact.kind];

  if (!render) {
    // STOP-POINT — no adapter for this kind. An explicit, worded label; never a
    // fabricated 3D shape or placeholder content.
    return (
      <div
        data-testid="ck-artifact-unregistered"
        className="flex h-[120px] items-center justify-center rounded-lg border border-dashed border-cyan-400/20 bg-black/20 px-3 text-center text-[12px] text-cyan-300/50"
      >
        <span data-testid="ck-artifact-unregistered-label">
          No 3D inspector registered for “{artifactKindLabel(artifact.kind)}” artifacts yet — inspectable soon.
        </span>
      </div>
    );
  }

  return render(artifact);
}

export default ArtifactViewer;
