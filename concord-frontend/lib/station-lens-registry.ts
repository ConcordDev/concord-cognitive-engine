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

export type StationDistrict = 'civic' | 'knowledge' | 'commerce' | 'arts' | 'craft' | 'care' | 'comms' | 'learning';

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
  /** Purpose district — clusters the building in-world (see lib/world-seeder.js). */
  district: StationDistrict;
}

// building_type → lens. Grouped by district; each lensId is asserted to be a real
// registered lens by tests/components/StationLensRegistry.test.tsx, and the
// building_type set is kept in sync with lib/world-seeder.js STATIONS + the
// building-interiors ROOM_TEMPLATES. Adding a station is one row here + one in
// each of those two backend lists.
export const STATION_LENS_REGISTRY: Record<string, StationLens> = {
  // ── Civic & governance ──
  courthouse:         { buildingType: 'courthouse',         lensId: 'legal',           verb: 'Argue the case',     placeLabel: 'The Concordant Court',    accent: 'slate',   district: 'civic' },
  assembly_hall:      { buildingType: 'assembly_hall',      lensId: 'government',       verb: 'Convene the assembly',placeLabel: 'The Assembly Hall',      accent: 'slate',   district: 'civic' },
  watch_house:        { buildingType: 'watch_house',        lensId: 'law-enforcement',  verb: 'Keep the peace',     placeLabel: 'The Watch House',         accent: 'slate',   district: 'civic' },
  // ── Knowledge & science ──
  cartographer_table: { buildingType: 'cartographer_table', lensId: 'atlas',            verb: 'Survey the lattice', placeLabel: "The Cartographer's Spire",accent: 'violet',  district: 'knowledge' },
  code_terminal:      { buildingType: 'code_terminal',      lensId: 'code',             verb: 'Jack in',            placeLabel: 'The Lattice Terminal',    accent: 'cyan',    district: 'knowledge' },
  observatory:        { buildingType: 'observatory',        lensId: 'astronomy',        verb: 'Chart the heavens',  placeLabel: 'The Observatory',         accent: 'violet',  district: 'knowledge' },
  laboratory:         { buildingType: 'laboratory',         lensId: 'science',          verb: 'Run the experiment', placeLabel: 'The Laboratory',          accent: 'cyan',    district: 'knowledge' },
  archive_hall:       { buildingType: 'archive_hall',       lensId: 'history',          verb: 'Read the record',    placeLabel: 'The Archive',             accent: 'slate',   district: 'knowledge' },
  // ── Commerce & economy ──
  trading_floor:      { buildingType: 'trading_floor',      lensId: 'markets',          verb: 'Work the floor',     placeLabel: 'The Concord Exchange',    accent: 'emerald', district: 'commerce' },
  ledger_desk:        { buildingType: 'ledger_desk',        lensId: 'accounting',       verb: 'Do the books',       placeLabel: 'The Royalty Ledger',      accent: 'amber',   district: 'commerce' },
  bank_house:         { buildingType: 'bank_house',         lensId: 'finance',          verb: 'Mind the money',     placeLabel: 'The Concord Bank',        accent: 'amber',   district: 'commerce' },
  auction_house:      { buildingType: 'auction_house',      lensId: 'auction',          verb: 'Go to auction',      placeLabel: 'The Auction House',       accent: 'amber',   district: 'commerce' },
  // ── Arts & creative ──
  music_booth:        { buildingType: 'music_booth',        lensId: 'music',            verb: 'Perform',            placeLabel: 'The Resonance Booth',     accent: 'pink',    district: 'arts' },
  atelier:            { buildingType: 'atelier',            lensId: 'studio',           verb: 'Make something',     placeLabel: 'The Atelier',             accent: 'pink',    district: 'arts' },
  writers_room:       { buildingType: 'writers_room',       lensId: 'creative-writing', verb: 'Write',              placeLabel: "The Writers' Room",       accent: 'pink',    district: 'arts' },
  gallery_hall:       { buildingType: 'gallery_hall',       lensId: 'gallery',          verb: 'Show the work',      placeLabel: 'The Gallery',             accent: 'violet',  district: 'arts' },
  // ── Craft & industry ──
  workshop:           { buildingType: 'workshop',           lensId: 'crafting',         verb: 'Craft',              placeLabel: 'The Workshop',            accent: 'amber',   district: 'craft' },
  engineers_hall:     { buildingType: 'engineers_hall',     lensId: 'engineering',      verb: 'Engineer it',        placeLabel: "The Engineers' Hall",     accent: 'cyan',    district: 'craft' },
  // ── Care & wellbeing ──
  clinic:             { buildingType: 'clinic',             lensId: 'healthcare',       verb: 'Treat a patient',    placeLabel: 'The Mendery',             accent: 'emerald', district: 'care' },
  sanctuary:          { buildingType: 'sanctuary',          lensId: 'meditation',       verb: 'Find calm',          placeLabel: 'The Sanctuary',           accent: 'emerald', district: 'care' },
  counsel_room:       { buildingType: 'counsel_room',       lensId: 'mental-health',    verb: 'Talk it through',    placeLabel: 'The Counsel Room',        accent: 'emerald', district: 'care' },
  // ── Communication & social ──
  post_office:        { buildingType: 'post_office',        lensId: 'message',          verb: 'Check the post',     placeLabel: 'The Link Post',           accent: 'cyan',    district: 'comms' },
  forum_hall:         { buildingType: 'forum_hall',         lensId: 'forum',            verb: 'Join the forum',     placeLabel: 'The Forum',               accent: 'cyan',    district: 'comms' },
  newsroom:           { buildingType: 'newsroom',           lensId: 'news',             verb: 'File the story',     placeLabel: 'The Newsroom',            accent: 'rose',    district: 'comms' },
  // ── Learning ──
  schoolhouse:        { buildingType: 'schoolhouse',        lensId: 'classroom',        verb: 'Teach & learn',      placeLabel: 'The Schoolhouse',         accent: 'violet',  district: 'learning' },
  academy:            { buildingType: 'academy',            lensId: 'education',        verb: 'Study',              placeLabel: 'The Academy',             accent: 'violet',  district: 'learning' },
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
