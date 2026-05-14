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
  // well and generator intentionally have no rooms
  well:      [],
  generator: [],
};

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
