// server/migrations/494_dtus_hot_lookup_indexes.js
//
// Two dtus lookups that #1938's syncIo attribution caught blocking the event
// loop at boot, both with no index to answer them:
//   - duplicateGate (emergent/quality/deterministic-gates.js):
//       SELECT id FROM dtus WHERE content_hash = ? LIMIT 1        (2025 ms)
//     content_hash was added by 316 as a bare ALTER ... ADD COLUMN, never indexed.
//   - NPCAgent._maybeEvaluateCreations (lib/npc-simulator.js):
//       SELECT * FROM dtus WHERE type = 'concordia_creation' AND world_id = ? LIMIT 5   (1520 ms)
//     idx_dtus_type (087) alone still walks every row of that type.
// Idempotent CREATE INDEX IF NOT EXISTS, guarded for DBs where the table or
// column is missing. Indexes only; no data changes.

function hasColumn(db, table, col) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === col); } catch { return false; }
}

export function up(db) {
  if (hasColumn(db, "dtus", "content_hash")) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_dtus_content_hash ON dtus(content_hash)");
  }
  if (hasColumn(db, "dtus", "type") && hasColumn(db, "dtus", "world_id")) {
    db.exec("CREATE INDEX IF NOT EXISTS idx_dtus_type_world ON dtus(type, world_id)");
  }
}

export function down(db) {
  db.exec("DROP INDEX IF EXISTS idx_dtus_content_hash");
  db.exec("DROP INDEX IF EXISTS idx_dtus_type_world");
}
