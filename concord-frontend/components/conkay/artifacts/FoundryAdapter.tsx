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

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import type { ConkayFoundryArtifact } from '@/lib/conkay/artifact-kinds';
import { worldToScene } from '@/lib/world-lens/coord-frame';
import {
  mapWorldBuildingToRendererDTU,
  type WorldBuildingRow,
  type RendererBuildingDTU,
} from '@/lib/world-lens/world-building-dto';

const ConcordiaScene = dynamic(
  () => import('@/components/world-lens/ConcordiaScene'),
  { ssr: false, loading: () => null },
);

// Headless — dispatches concordia:buildings-ready with the built 3D group for the
// ConcordiaScene above to consume. WebGL/three must never SSR.
const BuildingRenderer3D = dynamic(
  () => import('@/components/world-lens/BuildingRenderer3D'),
  { ssr: false, loading: () => null },
);

export function FoundryAdapter({ artifact }: { artifact: ConkayFoundryArtifact }) {
  // Load the compiled preview world's buildings the same way the world lens does
  // (server [0,2000] frame → origin-centred scene frame → renderer DTU) so the
  // authored buildings actually appear, not just terrain. Honest failure: any
  // non-ok/throw/timeout → NO buildings, never a fabricated stand-in.
  const [buildings, setBuildings] = useState<RendererBuildingDTU[]>([]);
  useEffect(() => {
    const worldId = artifact.previewWorldId;
    if (!worldId) {
      setBuildings([]);
      return;
    }
    let alive = true;
    fetch(`/api/worlds/${encodeURIComponent(worldId)}/buildings`, {
      signal: AbortSignal.timeout(8000),
    })
      .then((r) => {
        if (!r.ok) throw new Error(`buildings ${r.status}`);
        return r.json();
      })
      .then((d) => {
        if (!alive) return;
        const rows: WorldBuildingRow[] = Array.isArray(d?.buildings) ? d.buildings : [];
        setBuildings(rows.map(worldToScene).map(mapWorldBuildingToRendererDTU));
      })
      .catch(() => {
        if (alive) setBuildings([]);
      });
    return () => {
      alive = false;
    };
  }, [artifact.previewWorldId]);

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
      {/* Headless — dispatches concordia:buildings-ready for the scene above to
          consume. Empty `buildings` renders no group (honest terrain-only). */}
      <BuildingRenderer3D buildings={buildings} viewMode="normal" />
    </div>
  );
}

export default FoundryAdapter;
