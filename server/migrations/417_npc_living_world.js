export async function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_memories (
      id TEXT PRIMARY KEY,
      npc_id TEXT NOT NULL,
      category TEXT NOT NULL,
      subject_kind TEXT,
      subject_id TEXT,
      importance REAL NOT NULL DEFAULT 0.5,
      emotion TEXT,
      text TEXT,
      persistence TEXT NOT NULL DEFAULT 'decay',
      consequence_id TEXT,
      created_at INTEGER NOT NULL,
      fades_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_npc_mem_npc ON npc_memories(npc_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_npc_mem_cat ON npc_memories(category);
    CREATE INDEX IF NOT EXISTS idx_npc_mem_subj ON npc_memories(subject_kind, subject_id);

    CREATE TABLE IF NOT EXISTS npc_relation_axes (
      npc_id TEXT NOT NULL,
      target_kind TEXT NOT NULL,
      target_id TEXT NOT NULL,
      trust REAL NOT NULL DEFAULT 0,
      respect REAL NOT NULL DEFAULT 0,
      fear REAL NOT NULL DEFAULT 0,
      love REAL NOT NULL DEFAULT 0,
      hatred REAL NOT NULL DEFAULT 0,
      gratitude REAL NOT NULL DEFAULT 0,
      jealousy REAL NOT NULL DEFAULT 0,
      loyalty REAL NOT NULL DEFAULT 0,
      attraction REAL NOT NULL DEFAULT 0,
      debt REAL NOT NULL DEFAULT 0,
      dependency REAL NOT NULL DEFAULT 0,
      ideological_alignment REAL NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (npc_id, target_kind, target_id)
    );
  `);
}

export async function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS npc_memories;
    DROP TABLE IF EXISTS npc_relation_axes;
  `);
}
