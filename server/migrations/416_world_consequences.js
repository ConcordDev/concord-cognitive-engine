export async function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS world_consequences (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL DEFAULT 'concordia-hub',
      actor_kind TEXT NOT NULL,
      actor_id TEXT NOT NULL,
      action TEXT NOT NULL,
      target_kind TEXT,
      target_id TEXT,
      location TEXT,
      evidence_json TEXT,
      witnesses_json TEXT,
      immediate_json TEXT,
      long_term_json TEXT,
      importance REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_wc_world_time ON world_consequences(world_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_wc_actor ON world_consequences(actor_kind, actor_id);
    CREATE INDEX IF NOT EXISTS idx_wc_target ON world_consequences(target_kind, target_id);
    CREATE INDEX IF NOT EXISTS idx_wc_action ON world_consequences(action);
  `);
}

export async function down(db) {
  db.exec("DROP TABLE IF EXISTS world_consequences");
}
