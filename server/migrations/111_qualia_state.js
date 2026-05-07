// server/migrations/111_qualia_state.js
//
// Layer 4: Persist existential OS qualia channels.
//
// server/existential/engine.js maintains an in-memory QualiaEngine with
// 26 OSes worth of channels (truth_os, logic_os, sight_os, sonic_os,
// thermal_os, ..., reflection_os, presence_os, proprioception_os,
// sensory_os). Channels are 0-1 floats. Without persistence the entire
// "self-model accuracy", "cohesion", "drift detection" state evaporates
// on every restart — and Concord brains lose their accumulated
// embodied/affective context.
//
// Schema:
//   - One row per (entity_id, channel) so different organs can update
//     channels independently.
//   - last_updated_at lets the persistence tick skip stale rows.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS qualia_state (
      entity_id     TEXT NOT NULL,
      channel       TEXT NOT NULL,
        -- e.g. 'meta_growth_os.gap_severity', 'thermal_os.body_temp'
      value         REAL NOT NULL DEFAULT 0,
      last_updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (entity_id, channel)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_qualia_entity ON qualia_state(entity_id, last_updated_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_qualia_channel ON qualia_state(channel, value)`);

  // Audit log of significant qualia channel changes. Useful for the
  // existential lens UI showing "Concord's recent self-model deltas."
  db.exec(`
    CREATE TABLE IF NOT EXISTS qualia_log (
      id           TEXT PRIMARY KEY,
      entity_id    TEXT NOT NULL,
      channel      TEXT NOT NULL,
      prev_value   REAL,
      new_value    REAL NOT NULL,
      delta        REAL NOT NULL,
      source       TEXT,                          -- 'autogen', 'chat', 'dream', etc.
      occurred_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_qualia_log_entity ON qualia_log(entity_id, occurred_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_qualia_log_channel ON qualia_log(channel, occurred_at DESC)`);
}
