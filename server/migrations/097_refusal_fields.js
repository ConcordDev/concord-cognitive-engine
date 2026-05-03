// server/migrations/097_refusal_fields.js
//
// Persist Refusal Field declarations across restarts. The Sovereign's
// signature mechanic was previously in-memory only; a deploy mid-quest
// would silently expire whatever fields were active. Now they survive.
//
// On startup, server reloads non-expired rows back into STATE.refusalFields.
// The refusal-field-sweep heartbeat already prunes expired entries from
// memory; we mirror those deletes to the table.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS refusal_fields (
      id          TEXT PRIMARY KEY,
      world_id    TEXT NOT NULL,
      kind        TEXT NOT NULL,
      reason      TEXT NOT NULL DEFAULT '',
      glyph_hint  TEXT,
      glyph_json  TEXT,
      expires_at  INTEGER NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_refusal_fields_world
      ON refusal_fields(world_id, expires_at);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
