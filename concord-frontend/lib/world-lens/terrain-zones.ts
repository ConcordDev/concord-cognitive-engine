// Terrain zone derivation — turns the REAL building positions into TerrainZone
// splat regions so the ground under each district reads differently (cobblestone
// civic plaza, brick market, gravel forge yards, grass commons). The abstract
// ZoneDTU zoning records carry no coordinates; the spatial truth is the
// buildings' own x/z, so we derive an apron region around each building tinted
// by its purpose. Pure data → DistrictZone[] (the shape TerrainRenderer splats).

import type { DistrictZone, TerrainZone } from '@/components/world-lens/TerrainRenderer';

export interface ZonableBuilding {
  id: string;
  building_type: string;
  x: number;
  z: number;
  width?: number;
  depth?: number;
}

const APRON_M = 12; // ground tinted this far beyond each building's footprint

// building_type → ground material, by purpose. Default 'grass' for anything
// unmapped (a green commons reads fine and never looks broken).
const ZONE_BY_TYPE: Record<string, TerrainZone> = {
  // civic / governance / knowledge — stone civic plazas
  courthouse: 'cobblestone', assembly_hall: 'cobblestone', council_chamber: 'cobblestone',
  ethics_hall: 'cobblestone', watch_house: 'cobblestone',
  cartographer_table: 'cobblestone', code_terminal: 'cobblestone', observatory: 'cobblestone',
  laboratory: 'cobblestone', archive_hall: 'cobblestone', physics_hall: 'cobblestone',
  calcularium: 'cobblestone', philosophy_porch: 'cobblestone',
  // comms / social plazas
  post_office: 'cobblestone', forum_hall: 'cobblestone', newsroom: 'cobblestone', agora: 'cobblestone',
  // commerce / arts — brick
  trading_floor: 'brick', ledger_desk: 'brick', bank_house: 'brick', auction_house: 'brick',
  market: 'brick', warehouse: 'brick',
  music_booth: 'brick', atelier: 'brick', writers_room: 'brick', gallery_hall: 'brick',
  // craft / industry — gravel yards
  forge: 'gravel', workshop: 'gravel', engineers_hall: 'gravel', mill: 'gravel',
  depot: 'gravel', powerhouse: 'gravel', site_office: 'gravel', mine: 'gravel', mineshaft: 'gravel',
  // care / learning / nature — green
  clinic: 'grass', sanctuary: 'grass', counsel_room: 'grass', gymnasium: 'grass',
  schoolhouse: 'grass', academy: 'grass',
  grange: 'wild_grass', foresters_lodge: 'wild_grass', survey_camp: 'wild_grass',
  // water-adjacent
  tide_station: 'sand', dock: 'sand', well: 'sand',
  // core dwellings — worn dirt paths
  inn: 'dirt', tavern: 'dirt', house: 'dirt', farm: 'wild_grass',
};

/** Ground material for a building type (never throws; defaults to grass). */
export function buildingTypeToTerrainZone(buildingType?: string | null): TerrainZone {
  if (!buildingType) return 'grass';
  return ZONE_BY_TYPE[buildingType] ?? 'grass';
}

/**
 * Derive terrain splat zones from real building positions: an apron region
 * around each building, tinted by its purpose. Same world-coordinate frame as
 * the buildings (their x/z), which is what TerrainRenderer's control map expects.
 */
export function deriveTerrainZones(buildings: ZonableBuilding[]): DistrictZone[] {
  const out: DistrictZone[] = [];
  for (const b of buildings || []) {
    if (!b || !Number.isFinite(b.x) || !Number.isFinite(b.z)) continue;
    const halfW = Math.max(Number(b.width) || 8, 8) / 2 + APRON_M;
    const halfD = Math.max(Number(b.depth) || 8, 8) / 2 + APRON_M;
    out.push({
      id: `zone_${b.id}`,
      name: b.building_type,
      zone: buildingTypeToTerrainZone(b.building_type),
      bounds: [b.x - halfW, b.z - halfD, b.x + halfW, b.z + halfD],
    });
  }
  return out;
}

const terrainZones = { buildingTypeToTerrainZone, deriveTerrainZones };
export default terrainZones;
