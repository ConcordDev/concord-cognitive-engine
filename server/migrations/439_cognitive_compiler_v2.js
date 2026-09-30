// server/migrations/439_cognitive_compiler_v2.js
//
// Cognitive Compiler v2 substrate — recovery events, capability families, self-model.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cognitive_recovery_events (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id          TEXT,
      field               TEXT,
      recovery_pointer    TEXT,
      success             INTEGER NOT NULL DEFAULT 0,
      latency_ms          INTEGER,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_cognitive_recovery_mission
      ON cognitive_recovery_events(mission_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS capability_families (
      family_id             TEXT PRIMARY KEY,
      abstract_pattern      TEXT NOT NULL,
      template              TEXT,
      step_tool             TEXT,
      goal_signature        TEXT,
      fingerprint_hash      TEXT,
      solution_json         TEXT,
      delta_json            TEXT,
      generalization_score  REAL NOT NULL DEFAULT 0,
      verification_json     TEXT,
      failure_modes_json    TEXT,
      promoted_at           INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_capability_families_template
      ON capability_families(template, step_tool);

    CREATE TABLE IF NOT EXISTS dila_operational_self_model (
      task_class              TEXT PRIMARY KEY,
      strengths_json          TEXT,
      weaknesses_json         TEXT,
      uncertainties_json      TEXT,
      compression_harm_json     TEXT,
      model_preferences_json  TEXT,
      memory_reliability_json TEXT,
      strategy_trends_json      TEXT,
      sample_count            INTEGER NOT NULL DEFAULT 0,
      updated_at              INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}
