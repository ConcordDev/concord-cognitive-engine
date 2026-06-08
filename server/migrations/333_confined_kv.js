// server/migrations/333_confined_kv.js
//
// Phase 2 — the confined-ctx capability sandbox. A lens/ConKay-authored program
// gets NO raw db handle; the only persistence it can reach is this per-user,
// auto-scoped key-value store (the "sqlite behind a scoped helper" affordance of
// the concord-sdk). PK (user_id, key) means a confined program can never address
// another user's data — object-capability confinement by construction.
//
// Forward-only; table-guarded.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS confined_kv (
      user_id TEXT NOT NULL,
      key TEXT NOT NULL,
      value_json TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, key)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_confined_kv_user ON confined_kv(user_id)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_confined_kv_user`);
  db.exec(`DROP TABLE IF EXISTS confined_kv`);
}
