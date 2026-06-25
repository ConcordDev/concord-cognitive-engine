// server/lib/building-interiors.js
// Room system for building interiors. Players design room layouts.

import crypto from 'node:crypto';

// ── Room templates ────────────────────────────────────────────────────────────

export const ROOM_TEMPLATES = {
  bedroom:      { capacity: 2,  typical_furniture: ['bed', 'chest', 'candle'],                           width: 5,  depth: 5,  height: 3 },
  forge:        { capacity: 4,  typical_furniture: ['anvil', 'furnace', 'workbench', 'rack'],             width: 8,  depth: 7,  height: 4 },
  tavern:       { capacity: 20, typical_furniture: ['tables', 'bar', 'barrels', 'fireplace'],             width: 12, depth: 10, height: 4 },
  storage:      { capacity: 2,  typical_furniture: ['shelves', 'crates', 'chest'],                        width: 6,  depth: 6,  height: 3 },
  throne:       { capacity: 30, typical_furniture: ['throne', 'tapestries', 'guards_post', 'fireplace'],  width: 14, depth: 12, height: 6 },
  dungeon:      { capacity: 6,  typical_furniture: ['cells', 'chains', 'torch'],                          width: 10, depth: 8,  height: 3 },
  lab:          { capacity: 4,  typical_furniture: ['workbench', 'shelves', 'alembic', 'tome_stand'],     width: 8,  depth: 8,  height: 4 },
  armory:       { capacity: 6,  typical_furniture: ['weapon_rack', 'armor_stand', 'chest', 'grindstone'], width: 8,  depth: 6,  height: 4 },
  market_stall: { capacity: 8,  typical_furniture: ['counter', 'display_rack', 'shelves'],                width: 6,  depth: 5,  height: 3 },
  library:      { capacity: 10, typical_furniture: ['bookshelves', 'reading_table', 'candles', 'globe'],  width: 10, depth: 8,  height: 5 },
  garden:       { capacity: 15, typical_furniture: ['planters', 'fountain', 'benches'],                   width: 12, depth: 12, height: 0 },
  generic:      { capacity: 4,  typical_furniture: [],                                                    width: 6,  depth: 6,  height: 3 },
  // ── Phase DA2 — station / workbench room kinds. Building_types match
  // StationInteractionRouter's ROUTER_TABLE keys so spawning a building
  // of these types auto-seeds the right interior surface.
  farm_plot:    { capacity: 6,  typical_furniture: ['plot_tiles', 'water_trough', 'compost_bin'],         width: 10, depth: 10, height: 0 },
  restaurant:   { capacity: 16, typical_furniture: ['tables', 'kitchen_pass', 'register', 'wine_rack'],   width: 12, depth: 10, height: 4 },
  karaoke_booth:{ capacity: 4,  typical_furniture: ['mic_stand', 'speaker_pair', 'song_book'],            width: 5,  depth: 5,  height: 3 },
  mahjong_table:{ capacity: 4,  typical_furniture: ['tile_set', 'four_chairs', 'lamp'],                   width: 4,  depth: 4,  height: 3 },
  trivia_kiosk: { capacity: 1,  typical_furniture: ['kiosk_terminal', 'answer_buzzer'],                   width: 3,  depth: 3,  height: 3 },
  hacking_terminal: { capacity: 1, typical_furniture: ['terminal_console', 'cable_spool', 'crt_monitor'], width: 3,  depth: 3,  height: 3 },
  programming_console: { capacity: 1, typical_furniture: ['workstation', 'reference_books'],              width: 3,  depth: 3,  height: 3 },
  factory_workbench:   { capacity: 4, typical_furniture: ['assembly_table', 'parts_bins', 'crane'],       width: 8,  depth: 6,  height: 4 },
  attraction_booth:    { capacity: 8, typical_furniture: ['ticket_box', 'seating', 'safety_rail'],        width: 8,  depth: 6,  height: 4 },
  creature_pen:        { capacity: 6, typical_furniture: ['feeding_trough', 'nest_box', 'water_dish'],    width: 8,  depth: 8,  height: 0 },
  glyph_altar:         { capacity: 4, typical_furniture: ['altar_stone', 'glyph_braziers', 'tome_stand'], width: 6,  depth: 6,  height: 4 },
  // Phase E3 — mystery-board buildings dispatch hidden-object scene viewing.
  mystery_board:       { capacity: 1, typical_furniture: ['pinboard', 'photo_pile', 'string_and_pins'],   width: 4,  depth: 4,  height: 3 },
  // NPC-purpose — civic / labour workplace rooms so clerks, builders, soldiers,
  // healers get a real place to work (not just "any building" fallback).
  office:           { capacity: 6,  typical_furniture: ['desk', 'ledgers', 'filing_cabinet', 'seal_press'], width: 7, depth: 6, height: 3 },
  construction_site:{ capacity: 8,  typical_furniture: ['scaffold', 'tool_rack', 'cement_mixer', 'truck', 'crane'], width: 12, depth: 12, height: 0 },
  barracks_hall:    { capacity: 12, typical_furniture: ['bunks', 'weapon_rack', 'drill_dummy', 'banner'],   width: 12, depth: 8, height: 4 },
  clinic:           { capacity: 6,  typical_furniture: ['cot', 'herb_shelf', 'washbasin', 'instrument_tray'], width: 8, depth: 6, height: 3 },
  // Lens-as-Station building kinds — each opens a real lens as a persistent
  // iframe overlay in-world (concord-frontend/lib/station-lens-registry.ts).
  // `clinic` above doubles as the healthcare-lens station. building_types here
  // match the station-lens registry so spawning one auto-seeds its interior.
  code_terminal:      { capacity: 2,  typical_furniture: ['terminal_console', 'server_rack', 'cable_spool', 'crt_monitor'], width: 4,  depth: 4,  height: 3 },
  courthouse:         { capacity: 24, typical_furniture: ['judge_bench', 'witness_stand', 'gallery_seating', 'evidence_table'], width: 14, depth: 12, height: 6 },
  ledger_desk:        { capacity: 4,  typical_furniture: ['ledger_desk', 'abacus', 'filing_cabinet', 'coin_scale'], width: 6,  depth: 5,  height: 3 },
  music_booth:        { capacity: 4,  typical_furniture: ['mixing_desk', 'mic_stand', 'monitor_speakers', 'instrument_rack'], width: 6,  depth: 5,  height: 3 },
  cartographer_table: { capacity: 6,  typical_furniture: ['map_table', 'star_globe', 'survey_instruments', 'chart_rack'], width: 8,  depth: 7,  height: 4 },
  trading_floor:      { capacity: 20, typical_furniture: ['ticker_board', 'trading_desks', 'pit_rail', 'phone_bank'], width: 14, depth: 12, height: 5 },
  post_office:        { capacity: 8,  typical_furniture: ['sorting_pigeonholes', 'counter', 'mail_sacks', 'stamp_press'], width: 8,  depth: 6,  height: 4 },
  // District expansion — civic / knowledge / commerce / arts / craft / care / comms / learning.
  assembly_hall:      { capacity: 30, typical_furniture: ['speaker_rostrum', 'tiered_benches', 'vote_urns', 'banner'], width: 16, depth: 12, height: 5 },
  watch_house:        { capacity: 8,  typical_furniture: ['duty_desk', 'bounty_board', 'evidence_locker', 'cell'], width: 10, depth: 9, height: 3 },
  observatory:        { capacity: 6,  typical_furniture: ['telescope', 'orrery', 'star_charts', 'observation_dome'], width: 10, depth: 10, height: 5 },
  laboratory:         { capacity: 6,  typical_furniture: ['lab_bench', 'reagent_shelves', 'centrifuge', 'fume_hood'], width: 11, depth: 9, height: 3 },
  archive_hall:       { capacity: 12, typical_furniture: ['record_stacks', 'reading_carrels', 'index_cabinet', 'lantern'], width: 12, depth: 10, height: 4 },
  bank_house:         { capacity: 10, typical_furniture: ['teller_counter', 'vault_door', 'ledger_desks', 'coin_scale'], width: 12, depth: 10, height: 4 },
  auction_house:      { capacity: 16, typical_furniture: ['auctioneer_podium', 'bidding_seats', 'display_plinth', 'gavel'], width: 12, depth: 10, height: 4 },
  atelier:            { capacity: 8,  typical_furniture: ['easels', 'work_table', 'material_racks', 'drying_line'], width: 10, depth: 8, height: 3 },
  writers_room:       { capacity: 4,  typical_furniture: ['writing_desk', 'bookshelf', 'pinboard', 'lamp'], width: 8, depth: 7, height: 3 },
  gallery_hall:       { capacity: 20, typical_furniture: ['picture_rails', 'plinths', 'bench_seating', 'spotlights'], width: 14, depth: 10, height: 4 },
  workshop:           { capacity: 6,  typical_furniture: ['workbench', 'tool_wall', 'material_bins', 'grindstone'], width: 10, depth: 8, height: 3 },
  engineers_hall:     { capacity: 6,  typical_furniture: ['drafting_tables', 'truss_models', 'parts_bins', 'overhead_crane'], width: 12, depth: 10, height: 4 },
  sanctuary:          { capacity: 12, typical_furniture: ['cushions', 'water_basin', 'incense_stand', 'lamp'], width: 10, depth: 10, height: 3 },
  counsel_room:       { capacity: 2,  typical_furniture: ['two_chairs', 'low_table', 'plant', 'lamp'], width: 8, depth: 7, height: 3 },
  forum_hall:         { capacity: 24, typical_furniture: ['speaking_floor', 'ring_benches', 'notice_board', 'brazier'], width: 14, depth: 12, height: 4 },
  newsroom:           { capacity: 10, typical_furniture: ['copy_desks', 'wire_board', 'printing_press', 'paper_stacks'], width: 10, depth: 8, height: 4 },
  schoolhouse:        { capacity: 16, typical_furniture: ['student_desks', 'chalkboard', 'bookshelf', 'globe'], width: 10, depth: 9, height: 3 },
  academy:            { capacity: 20, typical_furniture: ['lecture_benches', 'lectern', 'library_nook', 'demonstration_table'], width: 12, depth: 10, height: 4 },
};

// Default room layouts per building type
// Each entry: { room_type, name, floor, x_offset, z_offset }
const BUILDING_ROOM_BLUEPRINTS = {
  inn: [
    { room_type: 'tavern',  name: 'Common Room',   floor: 1, x_offset: 0, z_offset: 0 },
    { room_type: 'bedroom', name: 'Guest Room 1',  floor: 2, x_offset: 0, z_offset: 0 },
    { room_type: 'bedroom', name: 'Guest Room 2',  floor: 2, x_offset: 6, z_offset: 0 },
    { room_type: 'bedroom', name: 'Guest Room 3',  floor: 2, x_offset: 0, z_offset: 6 },
  ],
  forge: [
    { room_type: 'forge',   name: 'Smithy',        floor: 1, x_offset: 0, z_offset: 0 },
    { room_type: 'storage', name: 'Material Store', floor: 1, x_offset: 9, z_offset: 0 },
  ],
  market: [
    { room_type: 'market_stall', name: 'Stall A', floor: 1, x_offset: 0,  z_offset: 0 },
    { room_type: 'market_stall', name: 'Stall B', floor: 1, x_offset: 7,  z_offset: 0 },
    { room_type: 'market_stall', name: 'Stall C', floor: 1, x_offset: 14, z_offset: 0 },
    { room_type: 'storage',      name: 'Back Storage', floor: 1, x_offset: 0, z_offset: 6 },
  ],
  warehouse: [
    { room_type: 'storage', name: 'Bay A', floor: 1, x_offset: 0,  z_offset: 0 },
    { room_type: 'storage', name: 'Bay B', floor: 1, x_offset: 7,  z_offset: 0 },
    { room_type: 'storage', name: 'Bay C', floor: 1, x_offset: 0,  z_offset: 7 },
    { room_type: 'storage', name: 'Bay D', floor: 1, x_offset: 7,  z_offset: 7 },
  ],
  tower: [
    { room_type: 'generic', name: 'Ground Floor', floor: 1, x_offset: 0, z_offset: 0 },
    { room_type: 'generic', name: 'Second Floor', floor: 2, x_offset: 0, z_offset: 0 },
    { room_type: 'generic', name: 'Top Floor',    floor: 3, x_offset: 0, z_offset: 0 },
  ],
  house: [
    { room_type: 'generic', name: 'Living Room', floor: 1, x_offset: 0, z_offset: 0 },
    { room_type: 'generic', name: 'Bedroom',     floor: 2, x_offset: 0, z_offset: 0 },
  ],
  throne_room: [
    { room_type: 'throne', name: 'Throne Room', floor: 1, x_offset: 0, z_offset: 0 },
    { room_type: 'armory', name: 'Royal Armory', floor: 1, x_offset: 15, z_offset: 0 },
  ],
  // NPC-purpose — civic / labour buildings (so clerks/builders/soldiers/healers
  // and the farmers/scholars have a coherent workplace in a seeded settlement).
  city_hall: [
    { room_type: 'office',  name: 'Clerk Office',  floor: 1, x_offset: 0, z_offset: 0 },
    { room_type: 'office',  name: 'Records Hall',  floor: 1, x_offset: 8, z_offset: 0 },
  ],
  construction_yard: [
    { room_type: 'construction_site', name: 'Build Site',    floor: 1, x_offset: 0,  z_offset: 0 },
    { room_type: 'storage',           name: 'Material Yard',  floor: 1, x_offset: 13, z_offset: 0 },
  ],
  barracks: [
    { room_type: 'barracks_hall', name: 'Drill Hall', floor: 1, x_offset: 0,  z_offset: 0 },
    { room_type: 'armory',        name: 'Armory',     floor: 1, x_offset: 13, z_offset: 0 },
  ],
  library: [
    { room_type: 'library', name: 'Reading Hall', floor: 1, x_offset: 0, z_offset: 0 },
    { room_type: 'generic', name: 'Study',        floor: 2, x_offset: 0, z_offset: 0 },
  ],
  farm: [
    { room_type: 'farm_plot', name: 'Fields', floor: 1, x_offset: 0,  z_offset: 0 },
    { room_type: 'storage',   name: 'Barn',   floor: 1, x_offset: 11, z_offset: 0 },
  ],
  clinic: [
    { room_type: 'clinic', name: 'Treatment Room', floor: 1, x_offset: 0, z_offset: 0 },
  ],
  // well and generator intentionally have no rooms
  well:      [],
  generator: [],
};

// Exported so the NPC-purpose settlement builder can compute, for a needed
// workplace room_type, which building_type provides it.
export { BUILDING_ROOM_BLUEPRINTS };

// ── Seeding ───────────────────────────────────────────────────────────────────

/**
 * Idempotently create default rooms for a building based on its type.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} buildingId
 * @param {string} worldId
 * @param {string} buildingType
 * @returns {{ created: number, skipped: boolean }}
 */
export function seedRoomsForBuilding(db, buildingId, worldId, buildingType) {
  // Check if rooms already exist for this building
  const existingCount = db.prepare(
    'SELECT COUNT(*) as c FROM building_rooms WHERE building_id = ?'
  ).get(buildingId)?.c ?? 0;

  if (existingCount > 0) {
    return { created: 0, skipped: true };
  }

  const blueprints = BUILDING_ROOM_BLUEPRINTS[buildingType] ?? [];
  if (blueprints.length === 0) {
    return { created: 0, skipped: false };
  }

  const insert = db.prepare(`
    INSERT INTO building_rooms
      (id, building_id, world_id, room_type, name, width, depth, height, x_offset, z_offset, floor, capacity, is_public, furniture)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
  `);

  let created = 0;
  for (const bp of blueprints) {
    const template  = ROOM_TEMPLATES[bp.room_type] ?? ROOM_TEMPLATES.generic;
    const furniture = JSON.stringify(template.typical_furniture);
    insert.run(
      crypto.randomUUID(),
      buildingId,
      worldId,
      bp.room_type,
      bp.name,
      template.width,
      template.depth,
      template.height,
      bp.x_offset,
      bp.z_offset,
      bp.floor,
      template.capacity,
      furniture,
    );
    created++;
  }

  return { created, skipped: false };
}

// ── Queries ───────────────────────────────────────────────────────────────────

/**
 * Return all rooms for a building, with furniture parsed from JSON.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} buildingId
 * @returns {object[]}
 */
export function getRoomsForBuilding(db, buildingId) {
  const rows = db.prepare(
    'SELECT * FROM building_rooms WHERE building_id = ? ORDER BY floor ASC, x_offset ASC'
  ).all(buildingId);

  return rows.map(r => ({
    ...r,
    furniture: _tryParseJSON(r.furniture, []),
  }));
}

/**
 * Add a custom room to a building.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} buildingId
 * @param {string} worldId
 * @param {object} roomSpec
 * @returns {object} new room row
 */
export function addRoom(db, buildingId, worldId, roomSpec) {
  const {
    room_type = 'generic',
    name,
    width, depth, height,
    x_offset = 0,
    z_offset = 0,
    floor    = 1,
    capacity,
    owner_id = null,
    is_public = 1,
  } = roomSpec;

  const template = ROOM_TEMPLATES[room_type] ?? ROOM_TEMPLATES.generic;
  const id       = crypto.randomUUID();

  db.prepare(`
    INSERT INTO building_rooms
      (id, building_id, world_id, room_type, name, width, depth, height,
       x_offset, z_offset, floor, capacity, owner_id, is_public, furniture)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id, buildingId, worldId,
    room_type,
    name ?? room_type,
    width  ?? template.width,
    depth  ?? template.depth,
    height ?? template.height,
    x_offset, z_offset, floor,
    capacity ?? template.capacity,
    owner_id,
    is_public ? 1 : 0,
    JSON.stringify(template.typical_furniture),
  );


  const row = db.prepare('SELECT * FROM building_rooms WHERE id = ?').get(id);
  if (!row) return null;
  return { ...row, furniture: _tryParseJSON(row.furniture, []) };
}

// ── Furniture ─────────────────────────────────────────────────────────────────

/**
 * Update the furniture array for a room.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} roomId
 * @param {string[]} furniture
 * @returns {boolean} true if a row was updated
 */
export function updateRoomFurniture(db, roomId, furniture) {
  const result = db.prepare(
    'UPDATE building_rooms SET furniture = ? WHERE id = ?'
  ).run(JSON.stringify(furniture ?? []), roomId);
  return result.changes > 0;
}

// ── Occupancy ─────────────────────────────────────────────────────────────────

/**
 * Count NPCs currently assigned to this room.
 * Uses world_npcs.state JSON field if it contains a room_id assignment.
 *
 * @param {import('better-sqlite3').Database} db
 * @param {string} roomId
 * @returns {number}
 */
export function getRoomOccupancy(db, roomId) {
  try {
    // NPCs may store their room assignment in their state JSON as { room_id: "..." }
    const allNpcs = db.prepare(
      "SELECT state FROM world_npcs WHERE is_dead = 0"
    ).all();

    let count = 0;
    for (const npc of allNpcs) {
      const state = _tryParseJSON(npc.state, {});
      if (state.room_id === roomId) count++;
    }
    return count;
  } catch {
    return 0;
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function _tryParseJSON(val, fallback) {
  if (!val) return fallback;
  try { return JSON.parse(val); } catch { return fallback; }
}
