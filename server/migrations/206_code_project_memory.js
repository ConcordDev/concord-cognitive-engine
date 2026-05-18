// server/migrations/206_code_project_memory.js
//
// Code Sprint B Item #8 — persistent project memory (AGENTS.md
// substrate). Cursor calls it `.cursor/rules`, Windsurf calls it
// Memories, GitHub's Spec Kit calls it AGENTS.md. Concord makes it
// a first-class DTU substrate so rules are citable, ownable, and
// can earn royalties when other devs import them.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS code_project_memory (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      project_path TEXT NOT NULL,
      kind TEXT NOT NULL,        -- 'agents_md' | 'rule' | 'preference' | 'naming_convention' | 'pattern'
      content TEXT NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      source TEXT,                -- 'user_authored' | 'imported_agents_md' | 'distilled_from_session' | 'cited'
      published_dtu_id TEXT,      -- when memory_publish has run, the DTU id
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(user_id, project_path, kind, content)
    );
    CREATE INDEX IF NOT EXISTS idx_code_mem_user_proj ON code_project_memory(user_id, project_path);
    CREATE INDEX IF NOT EXISTS idx_code_mem_kind ON code_project_memory(kind);
    CREATE INDEX IF NOT EXISTS idx_code_mem_published ON code_project_memory(published_dtu_id) WHERE published_dtu_id IS NOT NULL;
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS code_project_memory`);
}
