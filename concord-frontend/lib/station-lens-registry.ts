// concord-frontend/lib/station-lens-registry.ts
//
// Lens-as-Station registry. Maps a world `building_type` to an EXISTING lens
// that opens when you walk up and interact in the 3D world (Concordia). The lens
// mounts as a persistent iframe overlay (components/world/LensStationOverlay.tsx)
// over the scene — a "persistent redirect" — so there is NO per-lens UI work:
// every one of the ~277 real lenses becomes an in-world place + action verb by
// adding a row here.
//
// A new lens-station slots in here, nowhere else (mirrors the
// StationInteractionRouter ROUTER_TABLE invariant for gameplay overlays).

export type StationAccent = 'amber' | 'emerald' | 'cyan' | 'violet' | 'pink' | 'rose' | 'slate';

export interface StationLens {
  /** world_buildings.building_type that triggers this station. */
  buildingType: string;
  /** Lens route id — must be a real `/lenses/<lensId>`. */
  lensId: string;
  /** The in-world action verb ("Jack in"). */
  verb: string;
  /** Diegetic place name shown in the overlay frame ("The Terminal"). */
  placeLabel: string;
  /** Overlay frame accent. */
  accent: StationAccent;
}

// building_type → lens. Each lensId is asserted to be a real registered lens by
// tests/components/StationLensRegistry.test.tsx.
export const STATION_LENS_REGISTRY: Record<string, StationLens> = {
  code_terminal:      { buildingType: 'code_terminal',      lensId: 'code',       verb: 'Jack in',           placeLabel: 'The Terminal',           accent: 'cyan' },
  clinic:             { buildingType: 'clinic',             lensId: 'healthcare', verb: 'Treat a patient',   placeLabel: 'The Clinic',             accent: 'emerald' },
  courthouse:         { buildingType: 'courthouse',         lensId: 'legal',      verb: 'Argue the case',    placeLabel: 'The Courthouse',         accent: 'slate' },
  ledger_desk:        { buildingType: 'ledger_desk',        lensId: 'accounting', verb: 'Do the books',      placeLabel: 'The Counting House',     accent: 'amber' },
  music_booth:        { buildingType: 'music_booth',        lensId: 'music',      verb: 'Perform',           placeLabel: 'The Booth',              accent: 'pink' },
  cartographer_table: { buildingType: 'cartographer_table', lensId: 'atlas',      verb: 'Survey the lattice',placeLabel: "The Cartographer's Table",accent: 'violet' },
  trading_floor:      { buildingType: 'trading_floor',      lensId: 'markets',    verb: 'Work the floor',    placeLabel: 'The Trading Floor',      accent: 'emerald' },
  post_office:        { buildingType: 'post_office',        lensId: 'message',    verb: 'Check the post',    placeLabel: 'The Post Office',        accent: 'cyan' },
};

/** Resolve the lens-station for a building_type, or null if it isn't one. */
export function resolveStationLens(buildingType?: string | null): StationLens | null {
  if (!buildingType) return null;
  return STATION_LENS_REGISTRY[buildingType] ?? null;
}

/** Every building_type that opens a lens station. */
export function lensStationTypes(): string[] {
  return Object.keys(STATION_LENS_REGISTRY);
}

/** Build the iframe src for a lens station (the persistent redirect target). */
export function stationLensSrc(lensId: string, worldId: string, stationId: string): string {
  const q = new URLSearchParams({ world: worldId, station: stationId, diegetic: '1' });
  return `/lenses/${lensId}?${q.toString()}`;
}
