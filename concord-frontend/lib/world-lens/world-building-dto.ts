// Asset Studio Increment 2-A — canonical `world_buildings` row → renderer DTU
// mapping, used by both the world lens page (app/lenses/world/page.tsx) and
// STANDALONE preview surfaces (FoundryPreview, FoundryAdapter) that mount
// <ConcordiaScene> directly and need to feed the headless BuildingRenderer3D
// the same DTU shape the world lens does.
//
// Unified here (this used to be a byte-faithful duplicate the page also
// defined locally) because a Next.js page.tsx file may only export Page
// fields (default/metadata/generateStaticParams/…) — a page.tsx re-exporting
// a plain function/interface breaks the production build. Pinned by
// app/lenses/world/__tests__/building-dtu-mapping.test.tsx. BuildingRenderer3D
// reads `dtu.archetype` / `dtu.feature` on its procedural path; a row without
// them maps byte-identically to the pre-Asset-Studio shape (no
// archetype/feature key at all).

// Re-export the ONE canonical coerceMaterial (the page imports the same symbol),
// so the mapper's material coercion is identical here and there — not a copy that
// could silently diverge on the `thatch`/unknown-material branches.
export { coerceMaterial } from '@/lib/world-lens/building-silhouette';
import { coerceMaterial } from '@/lib/world-lens/building-silhouette';

/** A `world_buildings` row as the /api/worlds/:worldId/buildings endpoint returns
 *  it. `archetype`/`feature` are the nullable Asset-Studio columns present only on
 *  authored rows (absent on every seed/lens/legacy building). Mirrors the page's
 *  WorldBuildingRow. */
export interface WorldBuildingRow {
  id: string;
  building_type: string;
  name: string;
  x: number;
  y: number;
  z: number;
  width: number;
  depth: number;
  height: number;
  material: string;
  is_seed: number;
  archetype?: string;
  feature?: string;
}

/**
 * Pure `world_buildings` row → BuildingRenderer3D DTU mapping. `archetype`/
 * `feature` are set on the output ONLY when the row actually carries them
 * (truthy) — every seed/lens building has neither field and therefore maps
 * byte-identically to the pre-Asset-Studio shape.
 */
export function mapWorldBuildingToRendererDTU(b: WorldBuildingRow) {
  return {
    id: b.id,
    name: b.name || b.building_type,
    position: { x: b.x, y: b.y ?? 0, z: b.z },
    dimensions: { width: b.width || 10, height: b.height || 8, depth: b.depth || 8 },
    floors: 1,
    material: coerceMaterial(b.material),
    style: 'colonial' as const,
    // building_type drives the procedural archetype + iconic silhouette.
    building_type: b.building_type,
    ...(b.archetype ? { archetype: b.archetype } : {}),
    ...(b.feature ? { feature: b.feature } : {}),
    structure: {
      columns: { count: 0, spacing: 0, radius: 0 },
      beams: { count: 0, height: 0 },
      roofType: 'gable' as const,
      hasBasement: false,
      windowRows: 1,
      windowsPerRow: 2,
    },
  };
}

/** The DTU shape the mapper emits (what BuildingRenderer3D's `buildings` prop
 *  consumes). Exported so preview surfaces can type their building state without
 *  re-deriving it. */
export type RendererBuildingDTU = ReturnType<typeof mapWorldBuildingToRendererDTU>;
