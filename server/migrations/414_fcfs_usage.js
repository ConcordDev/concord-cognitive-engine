// server/migrations/414_fcfs_usage.js
//
// Per-user daily quota tracking for free cloud providers (FCFS).
// Mirrors in-memory fcfs-quota.js to DB persistence.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fcfs_usage_daily (
      user_id TEXT NOT NULL,
      provider TEXT NOT NULL,
      day_utc TEXT NOT NULL,
      calls INTEGER DEFAULT 0,
      tokens_in INTEGER DEFAULT 0,
      tokens_out INTEGER DEFAULT 0,
      last_call INTEGER,
      PRIMARY KEY (user_id, provider, day_utc)
    );
    CREATE INDEX IF NOT EXISTS idx_fcfs_user ON fcfs_usage_daily(user_id);
    CREATE INDEX IF NOT EXISTS idx_fcfs_day ON fcfs_usage_daily(day_utc);
  `);
}

export function down(_db) { /* sqlite — append-only convention */ }
