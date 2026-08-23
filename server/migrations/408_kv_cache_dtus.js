/**
 * Migration 408 — Private User KV Cache DTUs
 *
 * Sprint 33 Phase 2: Per-user private context cache for CSL quad-retrieval.
 * Stores session-scoped KV tensors (from LLM inference) with token-span anchors.
 *
 * IMPORTANT (Operator decision Q6): Store as float32 first. Quantization (INT8/INT4)
 * is an **optional lossy layer** for space optimization, never the source of truth.
 * This avoids recall-drift hazards. Quantization is enabled later via measurement gates.
 *
 * Spec: docs/SPRINT-33-CSL-PLAN.md §3.3
 */

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS private_user_kv_cache_dtus (
      dtu_hash VARCHAR(64) PRIMARY KEY,
      session_id UUID NOT NULL,
      anchor_entity_id UUID,
      token_span_start INT4 NOT NULL,
      token_span_end INT4 NOT NULL,
      quantized_k_tensor BLOB NOT NULL,
      quantized_v_tensor BLOB NOT NULL,
      valid_from TIMESTAMPTZ DEFAULT CURRENT_TIMESTAMP,
      retention_policy VARCHAR(32) DEFAULT 'PERSIST',
      CHECK (retention_policy IN ('PERSIST', 'SESSION_TTL', 'EXPIRE_7D', 'EXPIRE_30D')),
      CHECK (token_span_start >= 0 AND token_span_end > token_span_start)
    );

    -- Lookup by entity + time: partition KV cache by entity + time window for retrieval
    CREATE INDEX IF NOT EXISTS idx_kv_dtu_entity_time
      ON private_user_kv_cache_dtus(anchor_entity_id, valid_from);

    -- Cleanup by retention policy: allow GC to find expired rows
    CREATE INDEX IF NOT EXISTS idx_kv_dtu_retention
      ON private_user_kv_cache_dtus(retention_policy, valid_from);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_kv_dtu_retention;
    DROP INDEX IF EXISTS idx_kv_dtu_entity_time;
    DROP TABLE IF EXISTS private_user_kv_cache_dtus;
  `);
}
