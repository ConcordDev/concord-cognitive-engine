export async function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS memory_vault (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      key TEXT NOT NULL,
      content TEXT NOT NULL,
      embedding BLOB,
      created_at INTEGER NOT NULL,
      last_accessed INTEGER,
      access_count INTEGER DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_mv_user ON memory_vault(user_id);
    CREATE INDEX IF NOT EXISTS idx_mv_kind ON memory_vault(kind);
  `);
}

export async function down(db) {
  db.exec('DROP TABLE IF EXISTS memory_vault');
}
