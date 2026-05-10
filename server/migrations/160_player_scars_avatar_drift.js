// server/migrations/160_player_scars_avatar_drift.js
//
// Phase 3 — World-as-body. Two surfaces ride this migration:
//
//   1. player_scars — visible appearance overlay derived from cumulative
//      pain_signals (mig 114). The repair-cycle awards XP per pain unit;
//      this table records the *visible* trace (which region, what kind,
//      acquired when) so the avatar renderer + NPC dialogue bridge can
//      reference scars ("you've seen things"). Idea #12.
//
//   2. avatar_drift — per-avatar skill-vector drift vs a canonical
//      "true self" baseline. When a player switches avatars the drift
//      accumulates differently per avatar; this table tracks the
//      delta. Idea #23 (Routine Zero "Fidelity" mechanic).
//
// Append-only per CLAUDE.md invariant. Idempotent: existence-checks
// before CREATE.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_scars (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      user_id TEXT NOT NULL,
      avatar_id TEXT,
      region TEXT NOT NULL,
      source TEXT NOT NULL,
      severity REAL NOT NULL DEFAULT 0,
      acquired_at INTEGER NOT NULL DEFAULT (unixepoch()),
      visible_label TEXT,
      meta_json TEXT
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_scars_user ON player_scars(user_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_scars_avatar ON player_scars(avatar_id) WHERE avatar_id IS NOT NULL`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS avatar_drift (
      avatar_id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      skill_vector_json TEXT NOT NULL DEFAULT '{}',
      baseline_json TEXT NOT NULL DEFAULT '{}',
      drift_score REAL NOT NULL DEFAULT 0,
      last_updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_avatar_drift_user ON avatar_drift(user_id)`);
}
