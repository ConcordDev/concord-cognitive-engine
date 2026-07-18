'use client';

// components/conkay/artifacts/BuildingWalkthrough.tsx
//
// Phase S2-b (building) — "Step inside": walk your published building inside the
// REAL Concordia world engine, at real scale, with the SAME free-cam the game
// uses. This is the spec's intended building step-in (S2-a made ConcordiaScene
// prop-driven on worldId precisely so this could mount honestly): it loads the
// building's actual persisted world by id and renders its real buildings — not a
// preview mesh, the genuine world. Mirrors FoundryAdapter's proven mount.
//
// Honesty: it shows the world's PERSISTED buildings. The caller only mounts this
// for a published, un-edited building (see canStepInside) — so what you walk is
// exactly what was published, never a fabricated or stale stand-in. WebGL/three
// is client-only (never SSR).

import { useEffect, useState } from 'react';
import dynamic from 'next/dynamic';
import { worldToScene } from '@/lib/world-lens/coord-frame';
import {
  mapWorldBuildingToRendererDTU,
  type WorldBuildingRow,
  type RendererBuildingDTU,
} from '@/lib/world-lens/world-building-dto';

const ConcordiaScene = dynamic(() => import('@/components/world-lens/ConcordiaScene'), {
  ssr: false,
  loading: () => null,
});
const BuildingRenderer3D = dynamic(() => import('@/components/world-lens/BuildingRenderer3D'), {
  ssr: false,
  loading: () => null,
});

export function BuildingWalkthrough({ worldId, onExit }: { worldId: string; onExit: () => void }) {
  // Load the world's real buildings the same way the world lens + FoundryAdapter
  // do (server frame → scene frame → renderer DTU). Honest failure: any
  // non-ok/throw/timeout → terrain-only, never a fabricated building.
  const [buildings, setBuildings] = useState<RendererBuildingDTU[]>([]);
  useEffect(() => {
    if (!worldId) return;
    let alive = true;
    fetch(`/api/worlds/${encodeURIComponent(worldId)}/buildings`, { signal: AbortSignal.timeout(8000) })
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
  }, [worldId]);

  return (
    <div data-testid="ck-building-walkthrough" className="relative h-[340px] w-full overflow-hidden rounded-lg">
      <ConcordiaScene districtId={worldId} cameraMode="free" quality="medium" />
      {/* Headless — feeds the world's real building group to the scene above. */}
      <BuildingRenderer3D buildings={buildings} viewMode="normal" />
      <button
        type="button"
        data-testid="ck-walkthrough-exit"
        onClick={onExit}
        className="absolute left-2 top-2 z-10 rounded-md border border-white/20 bg-black/60 px-2 py-1 text-[11px] text-white/80 hover:border-white/40"
      >
        ← Back to preview
      </button>
      <span className="pointer-events-none absolute bottom-2 left-2 z-10 rounded bg-black/55 px-1.5 py-0.5 text-[9px] text-cyan-200/70">
        <kbd className="font-mono">WASD</kbd> walk · drag to look · the real world engine
      </span>
    </div>
  );
}

export default BuildingWalkthrough;
