// server/migrations/086_search_persistence.js
// Persist search history + saved searches per user. The lib/search-ranking
// module mirrors writes to these tables; reads fall back to in-memory ring
// if DB is unavailable.

export function up(db) {
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS search_history (
        id          INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id     TEXT NOT NULL,
        q           TEXT NOT NULL,
        ts          INTEGER NOT NULL DEFAULT (unixepoch())
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_search_history_user_ts ON search_history(user_id, ts DESC)`);
  } catch (e) { if (!e?.message?.includes("already exists")) throw e; }

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS saved_searches (
        id          TEXT PRIMARY KEY,
        user_id     TEXT NOT NULL,
        q           TEXT NOT NULL,
        name        TEXT NOT NULL,
        created_at  TEXT NOT NULL
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_saved_searches_user ON saved_searches(user_id)`);
  } catch (e) { if (!e?.message?.includes("already exists")) throw e; }
}

export function down(_db) { /* sqlite — leave tables in place */ }
