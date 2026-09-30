// server/migrations/424_runtime_phases.js
//
// P1–P6 runtime extensions: planner metadata, parallel workers, memory graph,
// repo graph cache, benchmark runs, supervisor snapshots.

export function up(db) {
  // Extend mission_tasks (ignore if columns already exist — additive)
  const missionCols = db.prepare(`PRAGMA table_info(mission_tasks)`).all().map((c) => c.name);
  if (missionCols.length && !missionCols.includes("planner_mode")) {
    db.exec(`ALTER TABLE mission_tasks ADD COLUMN planner_mode TEXT NOT NULL DEFAULT 'template'`);
  }
  if (missionCols.length && !missionCols.includes("domain_pack")) {
    db.exec(`ALTER TABLE mission_tasks ADD COLUMN domain_pack TEXT`);
  }
  if (missionCols.length && !missionCols.includes("execution_mode")) {
    db.exec(`ALTER TABLE mission_tasks ADD COLUMN execution_mode TEXT NOT NULL DEFAULT 'serial'`);
  }

  db.exec(`
    CREATE TABLE IF NOT EXISTS mission_workers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id      TEXT    NOT NULL,
      worker_index    INTEGER NOT NULL,
      tool_name       TEXT    NOT NULL,
      args_json       TEXT,
      status          TEXT    NOT NULL DEFAULT 'pending'
                              CHECK (status IN ('pending','running','completed','failed','cancelled')),
      result_json     TEXT,
      trace_id        TEXT,
      started_at      INTEGER,
      completed_at    INTEGER,
      duration_ms     INTEGER,
      UNIQUE(mission_id, worker_index)
    );
    CREATE INDEX IF NOT EXISTS idx_mission_workers_mission
      ON mission_workers(mission_id, status);

    CREATE TABLE IF NOT EXISTS runtime_memory_nodes (
      id              TEXT    PRIMARY KEY,
      memory_class    TEXT    NOT NULL
                              CHECK (memory_class IN ('ephemeral','episodic','durable')),
      kind            TEXT    NOT NULL,
      ref_id          TEXT,
      title           TEXT,
      content_json    TEXT    NOT NULL,
      provenance_json TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at      INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_memory_class
      ON runtime_memory_nodes(memory_class, kind);
    CREATE INDEX IF NOT EXISTS idx_runtime_memory_ref
      ON runtime_memory_nodes(ref_id);

    CREATE TABLE IF NOT EXISTS runtime_memory_edges (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      from_node_id    TEXT    NOT NULL,
      to_node_id      TEXT    NOT NULL,
      edge_kind       TEXT    NOT NULL,
      weight          REAL    NOT NULL DEFAULT 1.0,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(from_node_id, to_node_id, edge_kind)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_memory_edges_from
      ON runtime_memory_edges(from_node_id);

    CREATE TABLE IF NOT EXISTS runtime_repo_symbols (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      repo_root       TEXT    NOT NULL,
      file_path       TEXT    NOT NULL,
      symbol_kind     TEXT    NOT NULL,
      symbol_name     TEXT    NOT NULL,
      line_number     INTEGER,
      imports_json    TEXT,
      indexed_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(repo_root, file_path, symbol_kind, symbol_name, line_number)
    );
    CREATE INDEX IF NOT EXISTS idx_runtime_repo_path
      ON runtime_repo_symbols(repo_root, file_path);
    CREATE INDEX IF NOT EXISTS idx_runtime_repo_symbol
      ON runtime_repo_symbols(repo_root, symbol_name);

    CREATE TABLE IF NOT EXISTS runtime_benchmark_runs (
      id              TEXT    PRIMARY KEY,
      suite           TEXT    NOT NULL,
      started_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at    INTEGER,
      status          TEXT    NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running','completed','failed')),
      summary_json    TEXT
    );

    CREATE TABLE IF NOT EXISTS runtime_benchmark_results (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id          TEXT    NOT NULL,
      scenario_id     TEXT    NOT NULL,
      passed          INTEGER NOT NULL,
      duration_ms     INTEGER,
      details_json    TEXT,
      UNIQUE(run_id, scenario_id)
    );

    CREATE TABLE IF NOT EXISTS runtime_supervisor_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      observed_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      overall_status    TEXT    NOT NULL,
      subsystems_json   TEXT    NOT NULL,
      trace_id          TEXT
    );
  `);
}
