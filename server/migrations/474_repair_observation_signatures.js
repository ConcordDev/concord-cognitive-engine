// Per-signature repair-cortex observation counts.
// observe() used to keep these only in memory, so every backend restart
// forgot what it had already seen and a new signature never reached the log.
// Additive table only. Counts are flushed in batches, not one row per hit.
// Low-count old signatures are pruned so the table stays bounded.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS repair_observation_signatures (
      signature TEXT PRIMARY KEY,
      source TEXT NOT NULL DEFAULT '',
      route TEXT NOT NULL DEFAULT '',
      error_class TEXT NOT NULL DEFAULT '',
      message_norm TEXT NOT NULL DEFAULT '',
      first_seen TEXT NOT NULL,
      last_seen TEXT NOT NULL,
      count INTEGER NOT NULL DEFAULT 0,
      sample_json TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_repair_obs_count_seen
      ON repair_observation_signatures (count, last_seen);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS repair_observation_signatures;");
}

export const description = "Persist repair-cortex error signature counts across restarts";
