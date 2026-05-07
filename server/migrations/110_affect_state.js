// server/migrations/110_affect_state.js
//
// Layer 2: Wake the affect engine.
//
// server/affect/{engine.js,index.js,policy.js,projection.js,store.js} is
// fully implemented but the store.js is in-memory only — affect state
// evaporates on every restart. This migration adds persistent storage
// per (entity_id, world_id) tuple.
//
// Schema design notes:
//
//   - 7 affective dimensions per BASELINE in affect/defaults.js:
//       v (valence), a (arousal), s (salience), c (control),
//       g (goal-progress), t (threat), f (fatigue)
//   - Momentum vector m_v, m_a, ... matches each dim for the
//     existing engine.tick() decay/momentum math
//   - meta_json holds DEFAULT_META + arbitrary context (entity type,
//     scope, etc.)
//   - last_tick_at lets the heartbeat compute decay since last update
//
// Entity_id can be:
//   - a user_id ("user-abc123")
//   - an NPC id ("npc:concordia-hub:elder")
//   - a world singleton ("world:concordia-hub")
//   - a system-level scope ("system:repair-cortex")

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS affect_state (
      entity_id    TEXT NOT NULL,
      world_id     TEXT NOT NULL DEFAULT 'concordia-hub',
      v REAL NOT NULL DEFAULT 0.0,
      a REAL NOT NULL DEFAULT 0.5,
      s REAL NOT NULL DEFAULT 0.5,
      c REAL NOT NULL DEFAULT 0.5,
      g REAL NOT NULL DEFAULT 0.5,
      t REAL NOT NULL DEFAULT 0.0,
      f REAL NOT NULL DEFAULT 0.0,
      m_v REAL NOT NULL DEFAULT 0.0,
      m_a REAL NOT NULL DEFAULT 0.0,
      m_s REAL NOT NULL DEFAULT 0.0,
      m_c REAL NOT NULL DEFAULT 0.0,
      m_g REAL NOT NULL DEFAULT 0.0,
      m_t REAL NOT NULL DEFAULT 0.0,
      m_f REAL NOT NULL DEFAULT 0.0,
      meta_json    TEXT NOT NULL DEFAULT '{}',
      last_tick_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (entity_id, world_id)
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_affect_world ON affect_state(world_id, updated_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_affect_tick  ON affect_state(last_tick_at)`);

  // Audit log for affect events — compact ring buffer, no JSON blob bloat.
  // The full prompt/response context is already in brain_interactions; this
  // table only records the affective delta produced by an event.
  db.exec(`
    CREATE TABLE IF NOT EXISTS affect_events_log (
      id           TEXT PRIMARY KEY,
      entity_id    TEXT NOT NULL,
      world_id     TEXT NOT NULL DEFAULT 'concordia-hub',
      event_type   TEXT NOT NULL,
        -- USER_MESSAGE | SYSTEM_RESULT | ERROR | SUCCESS | TIMEOUT |
        -- CONFLICT | SAFETY_BLOCK | GOAL_PROGRESS | TOOL_RESULT |
        -- FEEDBACK | SESSION_START | SESSION_END
      delta_json   TEXT NOT NULL DEFAULT '{}',  -- per-dim delta
      magnitude    REAL,
      source       TEXT,                        -- e.g. 'chat', 'repair', 'dream'
      ref_id       TEXT,                        -- brain_interaction id, dtu id, etc.
      occurred_at  INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_affect_log_entity ON affect_events_log(entity_id, occurred_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_affect_log_ref    ON affect_events_log(ref_id) WHERE ref_id IS NOT NULL`);
}
