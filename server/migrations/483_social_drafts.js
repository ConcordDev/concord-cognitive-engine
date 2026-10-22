export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS social_drafts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      content TEXT NOT NULL,
      created_at TEXT,
      updated_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_social_drafts_user ON social_drafts(user_id);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS social_drafts");
}

export const description = "Per-user social post drafts";
