// server/migrations/225_dtu_world_id.js
//
// Phase AA1 — make cross-world royalty cascade intentional, not accidental.
//
// `dtus` had no world_id column. The royalty cascade flowed across worlds
// "by accident" because DTUs were world-agnostic. This migration adds the
// column + backfills it + indexes the lookup path so the cascade can know
// the parent/child worlds and stamp `crossWorldHop` on the ledger row.

export function up(db) {
  // 1. Add the column. Best-effort — tolerates duplicate-column re-runs.
  try {
    db.exec(`ALTER TABLE dtus ADD COLUMN world_id TEXT NULL;`);
  } catch (err) {
    if (!String(err?.message || "").includes("duplicate column")) {
      // Re-throw on truly unexpected errors; tolerate missing-table on
      // minimal builds.
      if (!String(err?.message || "").includes("no such table")) throw err;
    }
  }

  // 2. Backfill from body_json#$.world_id if present, else 'concordia-hub'.
  //    Idempotent — the WHERE clause prevents overwriting existing values.
  try {
    db.exec(`
      UPDATE dtus
      SET world_id = COALESCE(
        json_extract(body_json, '$.world_id'),
        json_extract(body_json, '$.worldId'),
        'concordia-hub'
      )
      WHERE world_id IS NULL;
    `);
  } catch { /* body_json may not have the keys; default 'concordia-hub' on next path */ }

  try {
    db.exec(`
      UPDATE dtus SET world_id = 'concordia-hub' WHERE world_id IS NULL;
    `);
  } catch { /* table missing on minimal builds */ }

  // 3. Index the lookup path the cascade uses + the cross-world feed.
  try {
    db.exec(`
      CREATE INDEX IF NOT EXISTS idx_dtus_world ON dtus(world_id, tier, created_at);
    `);
  } catch { /* index creation tolerated */ }
}

export function down(db) {
  try { db.exec(`DROP INDEX IF EXISTS idx_dtus_world;`); } catch { /* idempotent */ }
  // SQLite older versions can't DROP COLUMN; leave column in place on down.
}
