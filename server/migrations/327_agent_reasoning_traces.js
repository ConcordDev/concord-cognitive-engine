// server/migrations/327_agent_reasoning_traces.js
//
// Wave 7 / Track B6 — durable "what I was thinking" journal. Mig 059
// reasoning_sessions is dead (zero writers); this REPLACES it with a per-agent trace
// the awareness loop writes on each tier-3 wake, so the agent has a deliberation
// history across restarts (the substrate HOT/metacognition reads it back, and
// /lenses/reasoning/traces surfaces it). Forward-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_reasoning_traces (
      id              TEXT PRIMARY KEY,
      agent_id        TEXT,
      world_id        TEXT,
      attended        TEXT,        -- what grabbed the spotlight (constraint ref / spike reason)
      quale           TEXT,        -- the felt quale label at the moment of deliberation
      surprise        REAL,        -- prediction-error (Brier) that triggered learning, if any
      awareness_index REAL,        -- the B8 correlate at this wake
      reason          TEXT,        -- wake reason (dilemma / drive_spike / ...)
      note            TEXT,        -- the deliberation summary (deterministic or HLR)
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_agent_reasoning_traces_agent ON agent_reasoning_traces(agent_id, created_at);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS agent_reasoning_traces;`);
}
