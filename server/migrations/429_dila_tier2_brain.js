// server/migrations/429_dila_tier2_brain.js
//
// Tier 2–3 — causal memory, workspace snapshots, runtime config KV, capability registry.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS runtime_causal_chains (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id      TEXT,
      event_json      TEXT    NOT NULL,
      action_json     TEXT    NOT NULL,
      result_json     TEXT    NOT NULL,
      cause_json      TEXT,
      consequence_json TEXT,
      lesson          TEXT,
      signature_hash  TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_causal_mission
      ON runtime_causal_chains(mission_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_causal_signature
      ON runtime_causal_chains(signature_hash, created_at DESC);

    CREATE TABLE IF NOT EXISTS runtime_workspace_snapshots (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id      TEXT,
      repo_root       TEXT    NOT NULL,
      branch          TEXT,
      commit_hash     TEXT,
      dirty           INTEGER NOT NULL DEFAULT 0,
      file_hashes_json TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_workspace_mission
      ON runtime_workspace_snapshots(mission_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS runtime_config_kv (
      key             TEXT    PRIMARY KEY,
      value_json      TEXT    NOT NULL,
      source          TEXT    NOT NULL DEFAULT 'system',
      proposal_id     TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS runtime_capability_registry (
      capability_id   TEXT    PRIMARY KEY,
      name            TEXT    NOT NULL,
      description     TEXT,
      domain_pack     TEXT,
      tools_json      TEXT,
      status          TEXT    NOT NULL DEFAULT 'registered'
                              CHECK (status IN ('registered','testing','active','deprecated')),
      benchmark_json  TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}
