// server/migrations/092_npc_knowledge.js
//
// v2.0 instantiation: medical/research DTUs surface as NPC knowledge so
// in-world doctors and scholars can reference real human research in
// dialogue. We don't bind a knowledge entry to a single NPC — instead
// each entry is keyed by (world_id, role, dtu_id) so all NPCs of a
// matching role inherit the awareness. This keeps the table small.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS npc_knowledge (
      id TEXT PRIMARY KEY,
      world_id TEXT NOT NULL,
      role TEXT NOT NULL,
      dtu_id TEXT NOT NULL,
      summary TEXT NOT NULL,
      domain TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE(world_id, role, dtu_id)
    );

    CREATE INDEX IF NOT EXISTS idx_npc_knowledge_world_role
      ON npc_knowledge(world_id, role);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
