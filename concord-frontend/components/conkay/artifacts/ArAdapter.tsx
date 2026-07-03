'use client';

// concord-frontend/components/conkay/artifacts/ArAdapter.tsx
//
// Unit F9 (K5) — the `ar-render` adapter. It does NOT re-implement the exploded
// 3D view; it REUSES the already-correct, already-tested `ConKayArtifactExploded`
// (which owns computeExplodedLayout + the gsap explode animation + the
// click-a-part-to-inspect interaction). We hand it the REAL drawList the
// `detectArtifact` registry pulled straight off the `ar.render` macro result via
// its `drawList` prop, which skips the component's own macro fetch — so what
// renders is exactly the artifact ConKay just operated on, nothing re-loaded and
// nothing invented. Click-to-inspect is inherited from the wrapped component.

import { ConKayArtifactExploded } from '../ConKayArtifactExploded';
import type { ConkayArArtifact } from '@/lib/conkay/artifact-kinds';

export function ArAdapter({ artifact }: { artifact: ConkayArArtifact }) {
  return (
    <div data-testid="ck-adapter-ar-render" className="relative h-[340px] w-full">
      <ConKayArtifactExploded drawList={artifact.drawList} className="absolute inset-0" />
    </div>
  );
}

export default ArAdapter;
