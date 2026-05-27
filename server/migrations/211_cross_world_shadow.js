// server/migrations/211_cross_world_shadow.js
//
// Wave E / E1 — substrate for the single-instance asymmetric-multiplayer
// simulation. Real federation polls land in this same queue when
// CONCORD_FEDERATION_TOKEN is set + cnet-federation runs; the shadow
// sampler is the local-test source.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cross_world_shadow_queue (
      id            TEXT    PRIMARY KEY,
      source_world  TEXT    NOT NULL,
      target_world  TEXT    NOT NULL DEFAULT '__shadow_peer',
      kind          TEXT    NOT NULL,
      entity_kind   TEXT,
      entity_id     TEXT,
      detail_json   TEXT,
      consumed_at   INTEGER,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_cwsq_consumed
      ON cross_world_shadow_queue(consumed_at, created_at);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
