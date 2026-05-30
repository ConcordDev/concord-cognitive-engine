// server/migrations/286_chronicle.js
//
// Living Society — Phase 7: The Chronicle. Turn the deep-but-silent sim into a
// felt, shareable saga and let rulers read the uprising through LABOR symptoms
// (fields untended, workers fleeing, unpaid flow) rather than a rebellion bar.
//
//   - world_chronicle: per-world ledger of composed narrative beats, deduped.
//   - world_chronicle_cursor: per-(world, source) ingestion cursor so the
//     weave heartbeat ingests each source's new rows exactly once.
// Both per-world write tables.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function up(db) {
  if (!tableExists(db, "world_chronicle")) {
    db.exec(`
      CREATE TABLE world_chronicle (
        id          TEXT PRIMARY KEY,
        world_id    TEXT NOT NULL,
        kind        TEXT NOT NULL,
        dedupe_key  TEXT NOT NULL,
        title       TEXT NOT NULL,
        body        TEXT NOT NULL,
        refs_json   TEXT,
        importance  INTEGER NOT NULL DEFAULT 1,
        composer    TEXT NOT NULL DEFAULT 'deterministic',
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (world_id, dedupe_key)
      );
      CREATE INDEX idx_chronicle_world ON world_chronicle(world_id, created_at);
      CREATE INDEX idx_chronicle_kind ON world_chronicle(world_id, kind);
    `);
  }
  if (!tableExists(db, "world_chronicle_cursor")) {
    db.exec(`
      CREATE TABLE world_chronicle_cursor (
        world_id    TEXT NOT NULL,
        source      TEXT NOT NULL,
        last_cursor INTEGER NOT NULL DEFAULT 0,
        updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        PRIMARY KEY (world_id, source)
      );
    `);
  }
}

export function down(_db) {
  // forward-only
}
