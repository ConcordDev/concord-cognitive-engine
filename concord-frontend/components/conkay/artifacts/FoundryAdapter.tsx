'use client';

// concord-frontend/components/conkay/artifacts/FoundryAdapter.tsx
//
// Unit F9 (K5) — the `foundry-worldspec` adapter. `foundry.preview` compiles the
// current draft into a REAL, persisted `worlds` row (status='preview') and hands
// back its id; ConcordiaScene is hardwired to load a world by id, so — exactly
// like the real FoundryPreview component does — we mount ConcordiaScene against
// that genuine `previewWorldId`. The 3D shown is the actual compiled world, not
// a mock. ConcordiaScene is loaded client-only (its WebGL must never touch SSR).
//
// Systems the compile skipped (not-yet-built stubs) are surfaced honestly as a
// badge instead of being silently rendered as if present — the same honesty
// FoundryPreview shows.

import dynamic from 'next/dynamic';
import type { ConkayFoundryArtifact } from '@/lib/conkay/artifact-kinds';

const ConcordiaScene = dynamic(
  () => import('@/components/world-lens/ConcordiaScene'),
  { ssr: false, loading: () => null },
);

export function FoundryAdapter({ artifact }: { artifact: ConkayFoundryArtifact }) {
  return (
    <div data-testid="ck-adapter-foundry-worldspec" className="relative h-[340px] w-full overflow-hidden rounded-lg">
      {artifact.skippedStubs.length > 0 && (
        <span
          data-testid="ck-adapter-foundry-skipped"
          className="absolute right-2 top-2 z-10 rounded-full border border-amber-600/40 bg-amber-500/10 px-2 py-0.5 text-[10px] text-amber-300"
        >
          {artifact.skippedStubs.length} system(s) not yet built — not shown
        </span>
      )}
      <ConcordiaScene districtId={artifact.previewWorldId} cameraMode="free" quality="medium" />
    </div>
  );
}

export default FoundryAdapter;
