// server/migrations/346_robotics_runs.js
//
// Robotics persistence (#27) — the robotics lens has real pure-compute results
// (kinematics, path plans, sensor fusion, battery models) but only an in-memory
// control surface. This table persists a real computed RUN so it survives
// restart and can mint a DTU (action→DTU genesis). The physical actuator I/O is
// a separate documented adapter (lib/robotics/actuator-adapter.js) — this table
// only stores real computed telemetry, never fabricated motion.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS robotics_runs (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      robot_id    TEXT,
      kind        TEXT NOT NULL,                 -- kinematics | path_plan | sensor_fusion | battery | ...
      input_json  TEXT NOT NULL DEFAULT '{}',
      result_json TEXT NOT NULL DEFAULT '{}',
      dtu_id      TEXT,                           -- minted DTU, if any
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_robotics_runs_user ON robotics_runs(user_id, created_at DESC)`);
}
