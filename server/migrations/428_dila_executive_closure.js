// server/migrations/428_dila_executive_closure.js
//
// Tier 1 — Executive closure: execution ledger + mission recovery state.

export function up(db) {
  const missionCols = db.prepare(`PRAGMA table_info(mission_tasks)`).all().map((c) => c.name);
  if (missionCols.length) {
    if (!missionCols.includes("recovery_attempts")) {
      db.exec(`ALTER TABLE mission_tasks ADD COLUMN recovery_attempts INTEGER NOT NULL DEFAULT 0`);
    }
    if (!missionCols.includes("assigned_worker_id")) {
      db.exec(`ALTER TABLE mission_tasks ADD COLUMN assigned_worker_id TEXT`);
    }
    if (!missionCols.includes("last_route_json")) {
      db.exec(`ALTER TABLE mission_tasks ADD COLUMN last_route_json TEXT`);
    }
    if (!missionCols.includes("executive_state_json")) {
      db.exec(`ALTER TABLE mission_tasks ADD COLUMN executive_state_json TEXT`);
    }
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_execution_ledger (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id      TEXT    NOT NULL,
      step_index      INTEGER NOT NULL,
      tick_count      INTEGER,
      ledger_json     TEXT    NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_execution_ledger_mission
      ON runtime_execution_ledger(mission_id, step_index, created_at DESC);

    CREATE TABLE IF NOT EXISTS runtime_failure_signatures (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      signature_hash  TEXT    NOT NULL,
      failure_kind    TEXT    NOT NULL,
      tool_name       TEXT,
      worker_id       TEXT,
      repair_json     TEXT,
      success_count   INTEGER NOT NULL DEFAULT 0,
      failure_count   INTEGER NOT NULL DEFAULT 0,
      last_seen_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(signature_hash)
    );
  `);
}
