// server/migrations/293_world_npc_rotation.js
//
// Bugfix — combat was fully down on every live world. The combat-attack path
// (routes/worlds.js#/combat/attack) runs
//   SELECT id, x, y, z, rotation FROM world_npcs WHERE id = ?
// to read the target's facing for off-axis / directional-stagger logic — but no
// migration ever added a `rotation` column to world_npcs (it only has x/y/z +
// current_location). So every melee attack threw "no such column: rotation" and
// 500'd, in every world. Found by actually playing (an agent-playtest swing in
// the War Zone), not by a unit test — the test DBs build their own schemas.
//
// Fix: add the column the query already expects. REAL DEFAULT 0 → existing NPCs
// face "north" until their routine/spawn logic sets a real facing; directional
// combat keeps working, it just isn't biased by NPC facing until then.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_npcs'").get()) {
    if (!columnExists(db, "world_npcs", "rotation")) {
      try { db.exec(`ALTER TABLE world_npcs ADD COLUMN rotation REAL NOT NULL DEFAULT 0`); } catch { /* noop */ }
    }
  }
}

export function down(_db) {
  // forward-only
}
