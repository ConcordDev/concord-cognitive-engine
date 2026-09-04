// server/migrations/426_dila_runtime_v1.js
//
// Dila runtime v1 — mission principal, supervisor tree, org workers,
// model routing outcomes, recovery, self-improvement, workspace audits.

export function up(db) {
  const missionCols = db.prepare(`PRAGMA table_info(mission_tasks)`).all().map((c) => c.name);
  if (missionCols.length && !missionCols.includes("owner_agent_id")) {
    db.exec(`ALTER TABLE mission_tasks ADD COLUMN owner_agent_id TEXT NOT NULL DEFAULT 'hermes'`);
  }
  if (missionCols.length && !missionCols.includes("loop_phase")) {
    db.exec(`ALTER TABLE mission_tasks ADD COLUMN loop_phase TEXT NOT NULL DEFAULT 'mission'`);
  }
  if (missionCols.length && !missionCols.includes("checkpoint_json")) {
    db.exec(`ALTER TABLE mission_tasks ADD COLUMN checkpoint_json TEXT`);
  }
  if (missionCols.length && !missionCols.includes("dag_json")) {
    db.exec(`ALTER TABLE mission_tasks ADD COLUMN dag_json TEXT`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_supervisor_nodes (
      id              TEXT    PRIMARY KEY,
      parent_id       TEXT,
      node_kind       TEXT    NOT NULL
                              CHECK (node_kind IN (
                                'root','executive','director','worker','capability','subsystem'
                              )),
      label           TEXT    NOT NULL,
      agent_id        TEXT,
      status          TEXT    NOT NULL DEFAULT 'UNKNOWN',
      meta_json       TEXT,
      sort_order      INTEGER NOT NULL DEFAULT 0,
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_supervisor_parent
      ON runtime_supervisor_nodes(parent_id, sort_order);

    CREATE TABLE IF NOT EXISTS runtime_org_workers (
      worker_id         TEXT    PRIMARY KEY,
      director          TEXT    NOT NULL
                                CHECK (director IN ('research','engineering','operations')),
      specialization    TEXT,
      reliability_score REAL    NOT NULL DEFAULT 0.5,
      tasks_completed   INTEGER NOT NULL DEFAULT 0,
      tasks_failed      INTEGER NOT NULL DEFAULT 0,
      cost_total        REAL    NOT NULL DEFAULT 0,
      affect_json       TEXT,
      trust_json        TEXT,
      current_mission_id TEXT,
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_org_workers_director
      ON runtime_org_workers(director, reliability_score DESC);

    CREATE TABLE IF NOT EXISTS runtime_model_routing (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      task_class      TEXT    NOT NULL,
      provider        TEXT    NOT NULL,
      model           TEXT,
      worker_id       TEXT,
      success         INTEGER,
      latency_ms      INTEGER,
      cost_estimate   REAL,
      mission_id      TEXT,
      trace_id        TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_model_routing_class
      ON runtime_model_routing(task_class, provider, created_at DESC);

    CREATE TABLE IF NOT EXISTS runtime_recovery_events (
      id                  INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id          TEXT    NOT NULL,
      failure_kind        TEXT    NOT NULL,
      detection_latency_ms INTEGER,
      diagnosis_json      TEXT,
      recovery_action     TEXT,
      recovery_success    INTEGER,
      resume_latency_ms   INTEGER,
      learned_json        TEXT,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_recovery_mission
      ON runtime_recovery_events(mission_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS runtime_improvement_proposals (
      id                  TEXT    PRIMARY KEY,
      mission_id          TEXT,
      weakness            TEXT    NOT NULL,
      proposed_fix        TEXT,
      benchmark_before_json TEXT,
      benchmark_after_json  TEXT,
      status              TEXT    NOT NULL DEFAULT 'pending'
                                  CHECK (status IN ('pending','testing','promoted','rejected')),
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at         INTEGER
    );

    CREATE TABLE IF NOT EXISTS runtime_workspace_audits (
      id              TEXT    PRIMARY KEY,
      status          TEXT    NOT NULL DEFAULT 'running',
      summary_json    TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS runtime_mission_checkpoints (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id      TEXT    NOT NULL,
      step_index      INTEGER NOT NULL,
      loop_phase      TEXT    NOT NULL,
      state_json      TEXT    NOT NULL,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_mission_checkpoints
      ON runtime_mission_checkpoints(mission_id, created_at DESC);
  `);

  seedSupervisorTree(db);
}

function seedSupervisorTree(db) {
  const now = Math.floor(Date.now() / 1000);
  const nodes = [
    { id: "dila", parent_id: null, node_kind: "root", label: "DILA", agent_id: "hermes", status: "HEALTHY", sort_order: 0 },
    { id: "dila.executive", parent_id: "dila", node_kind: "executive", label: "Executive Planner", agent_id: "hermes", status: "HEALTHY", sort_order: 0 },
    { id: "dila.research", parent_id: "dila.executive", node_kind: "director", label: "Research Director", agent_id: "zuko", status: "UNKNOWN", sort_order: 0 },
    { id: "dila.engineering", parent_id: "dila.executive", node_kind: "director", label: "Engineering Director", agent_id: "hermes", status: "UNKNOWN", sort_order: 1 },
    { id: "dila.operations", parent_id: "dila.executive", node_kind: "director", label: "Operations Director", agent_id: "hermes", status: "UNKNOWN", sort_order: 2 },
    { id: "dila.mission_runtime", parent_id: "dila.executive", node_kind: "subsystem", label: "Mission Runtime", status: "UNKNOWN", sort_order: 3 },
    { id: "dila.auth_gate", parent_id: "dila.executive", node_kind: "subsystem", label: "F0 Auth Gate", status: "UNKNOWN", sort_order: 4 },
    { id: "dila.model_router", parent_id: "dila.executive", node_kind: "subsystem", label: "Model Router", status: "UNKNOWN", sort_order: 5 },
  ];
  const ins = db.prepare(`
    INSERT OR IGNORE INTO runtime_supervisor_nodes
      (id, parent_id, node_kind, label, agent_id, status, sort_order, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);
  for (const n of nodes) {
    ins.run(n.id, n.parent_id, n.node_kind, n.label, n.agent_id || null, n.status, n.sort_order, now);
  }
}
