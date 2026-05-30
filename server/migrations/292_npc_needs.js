// server/migrations/292_npc_needs.js
//
// Living Society WS4.1 — the NPC needs vector. A single JSON column on
// world_npcs holds the per-NPC need-deficit map (hunger/energy/wealth/social/
// safety/purpose). One column (not a table) keeps the hot read/write that the
// routine cycle does every tick cheap. Decay + satisfy live in lib/npc-needs.js.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_npcs'").get()) {
    if (!columnExists(db, "world_npcs", "needs_json")) {
      try { db.exec(`ALTER TABLE world_npcs ADD COLUMN needs_json TEXT`); } catch { /* noop */ }
    }
  }
}

export function down(_db) {
  // forward-only
}
