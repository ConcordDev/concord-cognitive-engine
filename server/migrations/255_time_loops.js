// server/migrations/255_time_loops.js
//
// Phase CC5 — time loop substrate (Outer Wilds / Tunic / 12 Minutes).
//
// On loop-start, snapshot inventory + position. On loop-end, restore
// snapshot. Memories survive via DTUs flagged retained_across_loops.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS time_loop_sessions (
      id                        TEXT PRIMARY KEY,
      user_id                   TEXT NOT NULL,
      world_id                  TEXT NOT NULL,
      loop_number               INTEGER NOT NULL DEFAULT 1,
      started_at                INTEGER NOT NULL DEFAULT (unixepoch()),
      ended_at                  INTEGER,
      end_reason                TEXT CHECK (end_reason IN ('death','timeout','manual_exit','complete')),
      inventory_snapshot_json   TEXT,
      position_snapshot_json    TEXT,
      duration_s                INTEGER NOT NULL DEFAULT 1320
    );
    CREATE INDEX IF NOT EXISTS idx_loop_sessions_user
      ON time_loop_sessions(user_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_loop_sessions_active
      ON time_loop_sessions(user_id) WHERE ended_at IS NULL;

    CREATE TABLE IF NOT EXISTS loop_memories (
      id                       TEXT PRIMARY KEY,
      user_id                  TEXT NOT NULL,
      world_id                 TEXT NOT NULL,
      memory_dtu_id            TEXT,
      summary                  TEXT NOT NULL,
      retained_across_loops    INTEGER NOT NULL DEFAULT 1,
      recorded_at              INTEGER NOT NULL DEFAULT (unixepoch()),
      first_loop_number        INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_loop_mem_user
      ON loop_memories(user_id, world_id, retained_across_loops);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_loop_mem_user;
    DROP TABLE IF EXISTS loop_memories;
    DROP INDEX IF EXISTS idx_loop_sessions_active;
    DROP INDEX IF EXISTS idx_loop_sessions_user;
    DROP TABLE IF EXISTS time_loop_sessions;
  `);
}
