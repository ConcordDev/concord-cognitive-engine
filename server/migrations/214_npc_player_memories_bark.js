// server/migrations/214_npc_player_memories_bark.js
//
// Wave G2 — extend npc_player_memories with bark-cooldown + recent-topics
// columns so the bark cycle can rate-limit per (npc, player) and dedupe
// topics across recent barks.
//
// Idempotent via try/catch — running twice is safe (SQLite errors on
// duplicate ADD COLUMN are swallowed).

export function up(db) {
  const cols = [
    `ALTER TABLE npc_player_memories ADD COLUMN last_bark_at INTEGER`,
    `ALTER TABLE npc_player_memories ADD COLUMN recent_bark_topics_json TEXT`,
  ];
  for (const sql of cols) {
    try { db.exec(sql); }
    catch { /* column already exists — ok */ }
  }
}

export function down(_db) { /* sqlite — keep on rollback */ }
