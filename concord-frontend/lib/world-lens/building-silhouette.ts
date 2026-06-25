// Building silhouette mapping — building_type → procedural archetype + an iconic
// landmark feature, so every seed/world building (and every lens-station) reads
// as a specific place at a glance (the silhouette-readability principle: a
// building should be recognisable from its black outline alone).
//
// Pure data + lookup. The archetype picks the base procedural mesh
// (lib/world-lens/procedural-buildings.ts createBuilding); the optional feature
// appends an iconic cap (dome / spire / colonnade / belfry). Every building_type
// resolves to one of the 5 real archetypes, so it always takes the rich
// procedural path rather than the generic box fallback.

import type { BuildingArchetype, IconicFeature } from './procedural-buildings';

export interface BuildingSilhouette {
  archetype: BuildingArchetype;
  feature?: IconicFeature;
}

const DEFAULT: BuildingSilhouette = { archetype: 'market' };

const SILHOUETTE: Record<string, BuildingSilhouette> = {
  // ── Core seed city ──
  inn: { archetype: 'tavern' }, tavern: { archetype: 'tavern' }, house: { archetype: 'tavern' },
  market: { archetype: 'market' }, warehouse: { archetype: 'market' }, well: { archetype: 'market' },
  forge: { archetype: 'forge' }, mine: { archetype: 'forge' },
  tower: { archetype: 'tower', feature: 'spire' },
  dock: { archetype: 'market' }, farm: { archetype: 'tavern' },

  // ── Civic & governance (columned civic halls / bell-towers) ──
  courthouse: { archetype: 'archive', feature: 'colonnade' },
  assembly_hall: { archetype: 'archive', feature: 'colonnade' },
  council_chamber: { archetype: 'archive', feature: 'colonnade' },
  ethics_hall: { archetype: 'archive', feature: 'colonnade' },
  watch_house: { archetype: 'tower', feature: 'belfry' },

  // ── Knowledge & science ──
  cartographer_table: { archetype: 'tower', feature: 'spire' },
  observatory: { archetype: 'tower', feature: 'dome' },
  code_terminal: { archetype: 'tower' },
  laboratory: { archetype: 'forge' },
  archive_hall: { archetype: 'archive', feature: 'colonnade' },
  physics_hall: { archetype: 'archive' },
  calcularium: { archetype: 'archive' },
  philosophy_porch: { archetype: 'archive', feature: 'colonnade' },

  // ── Commerce & economy ──
  trading_floor: { archetype: 'market' },
  ledger_desk: { archetype: 'archive' },
  bank_house: { archetype: 'archive', feature: 'colonnade' },
  auction_house: { archetype: 'market' },

  // ── Arts & creative ──
  music_booth: { archetype: 'tavern' },
  atelier: { archetype: 'tavern' },
  writers_room: { archetype: 'tavern' },
  gallery_hall: { archetype: 'archive', feature: 'colonnade' },

  // ── Craft & industry (smokestacks) ──
  workshop: { archetype: 'forge' },
  engineers_hall: { archetype: 'forge' },
  mill: { archetype: 'forge' },
  depot: { archetype: 'market' },
  powerhouse: { archetype: 'forge' },
  site_office: { archetype: 'market' },

  // ── Care & wellbeing ──
  clinic: { archetype: 'archive' },
  sanctuary: { archetype: 'archive', feature: 'dome' },
  counsel_room: { archetype: 'tavern' },
  gymnasium: { archetype: 'market' },

  // ── Communication & social ──
  post_office: { archetype: 'market' },
  forum_hall: { archetype: 'archive', feature: 'colonnade' },
  newsroom: { archetype: 'market' },
  agora: { archetype: 'archive', feature: 'colonnade' },

  // ── Learning ──
  schoolhouse: { archetype: 'tavern', feature: 'belfry' },
  academy: { archetype: 'archive', feature: 'colonnade' },

  // ── Nature & world ──
  grange: { archetype: 'tavern' },
  foresters_lodge: { archetype: 'tavern' },
  mineshaft: { archetype: 'forge' },
  tide_station: { archetype: 'market' },
  survey_camp: { archetype: 'tavern' },
};

/** Resolve a building_type to its archetype + optional iconic feature. */
export function silhouetteForBuildingType(buildingType?: string | null): BuildingSilhouette {
  if (!buildingType) return DEFAULT;
  return SILHOUETTE[buildingType] ?? DEFAULT;
}

/** Coerce a stored material string to a renderer BuildingMaterialType. */
export function coerceMaterial(material?: string | null): 'brick' | 'stone' | 'wood' | 'steel' | 'concrete' | 'glass' | 'usb' {
  switch (material) {
    case 'brick': case 'stone': case 'wood': case 'steel': case 'concrete': case 'glass': case 'usb':
      return material;
    case 'thatch': return 'wood';   // thatch → warm wood (no thatch material in the renderer)
    default: return 'stone';
  }
}

const buildingSilhouette = { silhouetteForBuildingType, coerceMaterial };
export default buildingSilhouette;
