// server/migrations/423_mission_runtime.js
//
// P0 — Mission Task Runtime. Durable multi-step missions that orchestrate
// the organ fleet through F0 dispatchMCP. Survives restart; autonomous
// spawn from initiative/proactive/sentinel signals.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mission_tasks (
      id              TEXT    PRIMARY KEY,
      user_id         TEXT    NOT NULL DEFAULT 'system',
      title           TEXT    NOT NULL,
      goal            TEXT,
      template        TEXT    NOT NULL,
      source          TEXT    NOT NULL DEFAULT 'operator'
                              CHECK (source IN (
                                'operator','initiative','proactive',
                                'sentinel','scheduled','heartbeat'
                              )),
      source_ref      TEXT,
      status          TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                'pending','running','paused',
                                'completed','failed','abandoned'
                              )),
      trace_id        TEXT    NOT NULL,
      current_step    INTEGER NOT NULL DEFAULT 0,
      total_steps     INTEGER NOT NULL DEFAULT 0,
      steps_json      TEXT,
      spawn_context_json TEXT,
      error_reason    TEXT,
      max_steps       INTEGER NOT NULL DEFAULT 50,
      tick_count      INTEGER NOT NULL DEFAULT 0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER,
      next_tick_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_mission_status_tick
      ON mission_tasks(status, next_tick_at);
    CREATE INDEX IF NOT EXISTS idx_mission_source_ref
      ON mission_tasks(source, source_ref);

    CREATE TABLE IF NOT EXISTS mission_step_log (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id      TEXT    NOT NULL,
      step_index      INTEGER NOT NULL,
      tool_name       TEXT    NOT NULL,
      args_json       TEXT,
      status          TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN (
                                'pending','dispatched','completed','failed','skipped'
                              )),
      result_json     TEXT,
      f0_decision     TEXT,
      trace_id        TEXT,
      duration_ms     INTEGER,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER,
      UNIQUE(mission_id, step_index)
    );

    CREATE INDEX IF NOT EXISTS idx_mission_step_mission
      ON mission_step_log(mission_id, step_index);

    CREATE TABLE IF NOT EXISTS mission_runtime_state (
      id                      INTEGER PRIMARY KEY CHECK (id = 1),
      last_autonomous_spawn_at INTEGER,
      fleet_cycle_counter     INTEGER NOT NULL DEFAULT 0,
      missions_spawned        INTEGER NOT NULL DEFAULT 0,
      missions_completed      INTEGER NOT NULL DEFAULT 0,
      updated_at              INTEGER NOT NULL DEFAULT (unixepoch())
    );

    INSERT OR IGNORE INTO mission_runtime_state (id) VALUES (1);
  `);
}
