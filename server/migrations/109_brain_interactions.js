// server/migrations/109_brain_interactions.js
//
// Brain self-training infrastructure.
//
// Two tables:
//
//   brain_interactions  — every brain call gets logged here. Outcome
//     resolves later (cited DTU?  Repaired error stuck?  Synthesis
//     survived consolidation?). Train_consented defaults 1 (platform-
//     generated; users can flip to 0 per-row for selective redaction).
//
//   brain_active_models — records the currently-active Ollama model
//     per brain. Updated by the daily training run when eval passes.
//     Allows atomic swap + 7-day rollback history.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_interactions (
      id              TEXT PRIMARY KEY,
      brain_id        TEXT NOT NULL,
        -- 'conscious' | 'subconscious' | 'utility' | 'repair' | 'multimodal' | 'lattice'
      user_id         TEXT,                       -- nullable (system calls)
      prompt_hash     TEXT NOT NULL,              -- sha256 of normalized prompt
      prompt_json     TEXT NOT NULL,              -- full prompt (messages array)
      response_json   TEXT,                       -- brain output
      domain          TEXT,                       -- which lens triggered the call
      latency_ms      INTEGER,
      tokens_in       INTEGER,
      tokens_out      INTEGER,
      outcome         TEXT NOT NULL DEFAULT 'pending',
        -- 'pending' | 'positive' | 'negative' | 'neutral' | 'expired'
      outcome_signal  TEXT,                       -- JSON evidence of outcome
      outcome_at      INTEGER,                    -- unixepoch when resolved
      train_consented INTEGER NOT NULL DEFAULT 1,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_brain_int_outcome ON brain_interactions(outcome, brain_id, created_at)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_brain_int_brain   ON brain_interactions(brain_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_brain_int_user    ON brain_interactions(user_id) WHERE user_id IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_brain_int_train   ON brain_interactions(train_consented) WHERE train_consented = 1`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS brain_active_models (
      id            TEXT PRIMARY KEY,
      brain_id      TEXT NOT NULL,
      model_name    TEXT NOT NULL,                -- ollama model tag (e.g. "concord-utility:2026-05-08")
      base_model    TEXT NOT NULL,                -- ollama base it was built from (e.g. "qwen2.5:3b")
      corpus_size   INTEGER NOT NULL,             -- # examples used
      eval_score    REAL,                         -- post-build eval score
      active        INTEGER NOT NULL DEFAULT 0,   -- 1 = currently routed to
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      retired_at    INTEGER
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bam_active ON brain_active_models(brain_id, active) WHERE active = 1`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_bam_brain  ON brain_active_models(brain_id, created_at DESC)`);
}
