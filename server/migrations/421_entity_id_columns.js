// server/migrations/421_entity_id_columns.js
//
// Wave 9 (2026-08-31): Phase 3 — Agent Runtime Contract per-entity data.
//
// Many subsystems built before the Agent Runtime Contract lack an entity_id
// join key. They were either system-wide (repair_patterns, agent_logs) or
// used a different naming (agent_id, user_id, created_by). Phase 3 wants
// per-entity traces so rt_snapshot can show real per-layer data.
//
// This migration adds entity_id columns (nullable + indexed) to:
//   - agent_reasoning_traces   (already has agent_id → add entity_id alias)
//   - forward_predictions      (already has user_id → add entity_id alias)
//   - agent_logs               (already has agent_id → add entity_id alias)
//   - output_bundles           (create if missing — for governance review)
//
// Backfill: copy agent_id → entity_id where present.
//
// Phase 3 exposes:
//   - rt_tick (drives + qualia hooks + fingerprint recording)
//   - rt_drives (per-entity drive state)
export function up(db) {
  const stmts = [
    // agent_reasoning_traces — alias agent_id as entity_id
    `ALTER TABLE agent_reasoning_traces ADD COLUMN entity_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_arte_entity ON agent_reasoning_traces(entity_id, created_at DESC)`,
    `UPDATE agent_reasoning_traces SET entity_id = agent_id WHERE agent_id IS NOT NULL AND entity_id IS NULL`,

    // forward_predictions — alias user_id as entity_id
    `ALTER TABLE forward_predictions ADD COLUMN entity_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_fp_entity ON forward_predictions(entity_id, composed_at DESC)`,
    `UPDATE forward_predictions SET entity_id = user_id WHERE user_id IS NOT NULL AND entity_id IS NULL`,

    // agent_logs — alias agent_id as entity_id
    `ALTER TABLE agent_logs ADD COLUMN entity_id TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_agent_logs_entity ON agent_logs(entity_id, logged_at DESC)`,
    `UPDATE agent_logs SET entity_id = agent_id WHERE agent_id IS NOT NULL AND entity_id IS NULL`,

    // output_bundles — create if missing (governance review target)
    `CREATE TABLE IF NOT EXISTS output_bundles (
      id TEXT PRIMARY KEY,
      entity_id TEXT,
      emergent_id TEXT,
      bundle_type TEXT,
      status TEXT DEFAULT 'pending',
      payload_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )`,
    `CREATE INDEX IF NOT EXISTS idx_output_bundles_entity ON output_bundles(entity_id, created_at DESC)`,
    `CREATE INDEX IF NOT EXISTS idx_output_bundles_status ON output_bundles(status, created_at DESC)`,

    // Phase 3: per-entity drive state
    `CREATE TABLE IF NOT EXISTS entity_drives (
      entity_id TEXT PRIMARY KEY,
      drives_json TEXT NOT NULL DEFAULT '{}',
      dominant_drive TEXT,
      resting_drive TEXT,
      last_updated INTEGER NOT NULL DEFAULT (unixepoch())
    )`,

    // Phase 3: per-entity tick history
    `CREATE TABLE IF NOT EXISTS entity_tick_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      entity_id TEXT NOT NULL,
      tick_at INTEGER NOT NULL DEFAULT (unixepoch()),
      hooks_fired INTEGER NOT NULL DEFAULT 0,
      drives_json TEXT,
      fingerprint_total_queries INTEGER,
      affect_state_json TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_eth_entity ON entity_tick_history(entity_id, tick_at DESC)`,
  ];
  for (const sql of stmts) {
    try { db.prepare(sql).run(); } catch (e) {
      if (!e?.message?.includes("already exists") && !e?.message?.includes("duplicate column")) {
        console.warn(`[421] ${sql.slice(0, 60)}...: ${e?.message}`);
      }
    }
  }
}