// server/migrations/317_combat_restraint.js
//
// Temperament P4/P5 — the combat-restraint substrate. Today combat has exactly
// ONE outcome band: DEAD (npc-consequences.js sets is_dead=1). There's no
// surrender, no morale break, no downed/captured state — so the restraint +
// capture economy (RoN-style "non-lethal forces surrender", Graham proportionality)
// has nowhere to live. This adds the per-NPC combat-state machine fields:
//
//   - combat_state  : 'active' | 'surrendering' | 'surrendered' | 'arrested'
//                     | 'fleeing' | 'downed'   (downed used by P5 capture/transport)
//   - morale        : 0..1, depletes under (esp. non-lethal) force + flashes; a
//                     break forces surrender.
//   - surrendered_at: unixepoch of surrender (gates the RoN "betray window").
//
// All additive + nullable with safe defaults → off == today's behavior
// (combat_state defaults 'active', morale 1.0; nothing reads them unless
// CONCORD_TEMPERAMENT is on). Guarded ALTERs for idempotency.

function hasColumn(db, table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().some((c) => c.name === col);
  } catch {
    return false;
  }
}

export function up(db) {
  const adds = [
    ["combat_state", "TEXT NOT NULL DEFAULT 'active'"],
    ["morale", "REAL NOT NULL DEFAULT 1.0"],
    ["surrendered_at", "INTEGER"],
  ];
  for (const [col, def] of adds) {
    if (!hasColumn(db, "world_npcs", col)) {
      try { db.exec(`ALTER TABLE world_npcs ADD COLUMN ${col} ${def}`); } catch { /* exists / race */ }
    }
  }
  // Partial index for the cheap "who's down/surrendered in this world" capture scan.
  try {
    db.exec(`CREATE INDEX IF NOT EXISTS idx_world_npcs_combat_state ON world_npcs(world_id, combat_state)`);
  } catch { /* world_id absent in a minimal test DB — index is an optimization only */ }
}

export function down(db) {
  // SQLite can't DROP COLUMN cleanly; columns are additive + nullable, leave them.
  try { db.exec(`DROP INDEX IF EXISTS idx_world_npcs_combat_state`); } catch { /* ignore */ }
}
