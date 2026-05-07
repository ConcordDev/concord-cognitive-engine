// server/migrations/111_forward_predictions.js
//
// Layer 10: subconscious forward-sim — anticipation engine.
//
// While the player is offline, the subconscious brain (or a deterministic
// stand-in) runs short speculative threads about the player's recent
// decisions, active quests, and pending NPC interactions. The output is
// a `forward_predictions` row plus an optional `prediction` kind DTU.
//
// Each row is one prediction — a {subject, anticipated_outcome,
// confidence, expires_at} tuple. Subjects are pinned to canonical
// references (questId, npcId, decisionId) so the surface UI can render
// them in context (`while you were away, you've been thinking about...`).
//
// realised_at flips when reality matches the prediction (or the player
// explicitly closes it). reality_outcome stores the closing payload.
// Predictions past expires_at without realisation are silently archived
// by the cycle GC.

export function up(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS forward_predictions (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      world_id        TEXT,
      subject_kind    TEXT NOT NULL CHECK (subject_kind IN
                        ('quest', 'npc', 'decision', 'faction', 'self')),
      subject_id      TEXT NOT NULL,
      anticipated     TEXT NOT NULL,            -- short prose summary
      confidence      REAL NOT NULL DEFAULT 0.5,-- 0..1
      composer        TEXT NOT NULL DEFAULT 'deterministic', -- 'deterministic' | 'subconscious_llm'
      prediction_dtu_id TEXT,                   -- optional canonical DTU
      composed_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at      INTEGER NOT NULL,
      realised_at     INTEGER,
      reality_outcome TEXT
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_predictions_user_active
      ON forward_predictions(user_id, expires_at, realised_at)
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_predictions_subject
      ON forward_predictions(user_id, subject_kind, subject_id)
  `).run();
}

export function down(db) {
  db.prepare('DROP INDEX IF EXISTS idx_predictions_subject').run();
  db.prepare('DROP INDEX IF EXISTS idx_predictions_user_active').run();
  db.prepare('DROP TABLE IF EXISTS forward_predictions').run();
}
