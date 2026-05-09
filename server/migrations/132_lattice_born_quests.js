// Migration 132 — Phase 4c: Lattice-Born Quests.
//
// The lattice drift-monitor (Layer 12) already detects 6 cognitive
// failure modes — goodhart, memetic_drift, capability_creep,
// self_reference, echo_chamber, metric_divergence. This migration
// records each drift-alert → quest conversion so the cycle is
// idempotent (a single alert can't spawn multiple quests).
//
// Tables:
//   lattice_born_quests — one row per (drift_alert_signature, quest_id).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lattice_born_quests (
      id                       TEXT    PRIMARY KEY,
      drift_alert_signature    TEXT    NOT NULL UNIQUE,
      drift_type               TEXT    NOT NULL,
      drift_severity           TEXT    NOT NULL,
      quest_id                 TEXT    NOT NULL,
      world_id                 TEXT    NOT NULL,
      target_npc_id            TEXT,
      composer                 TEXT    NOT NULL DEFAULT 'deterministic',
      composed_at              INTEGER NOT NULL DEFAULT (unixepoch()),
      realised_at              INTEGER,
      realisation_outcome      TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_lbq_world  ON lattice_born_quests(world_id, composed_at);
    CREATE INDEX IF NOT EXISTS idx_lbq_drift  ON lattice_born_quests(drift_type);
    CREATE INDEX IF NOT EXISTS idx_lbq_quest  ON lattice_born_quests(quest_id);
  `);
}

export function down(_db) { /* forward-only */ }
