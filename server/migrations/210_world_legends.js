// server/migrations/210_world_legends.js
//
// Wave D / D1 — bard repertoire substrate.
//
// world_legends already exists if Wave C C2 ran (it was created lazily
// by the legend handler via raw SQL); we make it canonical here +
// idempotent so subsequent migrations rely on it. Adds bard_repertoire
// for the bard performance cycle.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_legends (
      id            TEXT    PRIMARY KEY,
      world_id      TEXT    NOT NULL,
      subject_kind  TEXT    NOT NULL,            -- 'user' | 'npc' | 'faction' | 'event'
      subject_id    TEXT    NOT NULL,
      title         TEXT    NOT NULL,
      body          TEXT,
      sentiment     REAL    NOT NULL DEFAULT 0,  -- [-1, +1]
      severity      INTEGER NOT NULL DEFAULT 5,  -- 1-10, affects bard performance priority
      composed_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_world_legends_world
      ON world_legends(world_id, composed_at DESC);
    CREATE INDEX IF NOT EXISTS idx_world_legends_subject
      ON world_legends(subject_kind, subject_id);
    CREATE INDEX IF NOT EXISTS idx_world_legends_severity
      ON world_legends(world_id, severity DESC);

    CREATE TABLE IF NOT EXISTS bard_repertoire (
      bard_npc_id      TEXT    NOT NULL,
      legend_id        TEXT    NOT NULL,
      performed_count  INTEGER NOT NULL DEFAULT 0,
      last_performed_at INTEGER,
      learned_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (bard_npc_id, legend_id)
    );
    CREATE INDEX IF NOT EXISTS idx_bard_rep_bard
      ON bard_repertoire(bard_npc_id, last_performed_at);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
