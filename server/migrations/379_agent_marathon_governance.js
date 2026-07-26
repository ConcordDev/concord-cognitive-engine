// server/migrations/379_agent_marathon_governance.js
//
// User-approved governance envelope for marathon sessions (2026-07-24).
//
// Grounding audit finding: server/lib/agent-marathon.js's tickMarathon
// reuses runAgentLoop's FULL tool surface (web_search, create_dtu,
// run_lens_action across every macro domain, mcp_call, ...) for
// potentially hours or days, with zero scoping, spend cap, or revocation.
// Asked directly whether "long-running governed tasks under an explicit
// mandate" should mean just UI language or a real enforced envelope, the
// user explicitly chose the latter: an allowed-domains allowlist, a
// spend/action budget cap, and a revocation flag ENFORCED inside every
// marathon tick.
//
// This migration adds the four columns that envelope needs. The actual
// enforcement lives in server/lib/agent-marathon.js#createToolGate (wired
// into chat-agent.js's runAgentLoop via its opt-in opts.toolGate hook) —
// this migration only adds storage; see agent-marathon.js for the
// non-decorative gating logic.
//
//   allowed_domains_json TEXT    nullable — JSON array of macro-domain
//                                 names (as passed to run_lens_action, or
//                                 the fixed domain a non-lens tool call
//                                 resolves to — "tools" for web_search,
//                                 "dtu" for create_dtu, "expert_mode",
//                                 "multimodal" for generate_image) this
//                                 session may call. NULL means
//                                 unrestricted — back-compat with every
//                                 pre-existing row and every session
//                                 started without an explicit allowlist
//                                 (e.g. the autonomous re-goal path in
//                                 emergent/agent-marathon-cycle.js).
//   budget_cap           INTEGER nullable — max REAL tool-call count for
//                                 the session's whole lifetime. NULL means
//                                 unlimited (back-compat default).
//   budget_spent          INTEGER NOT NULL DEFAULT 0 — real tool calls
//                                 executed so far; incremented atomically
//                                 by the gate immediately before a call is
//                                 allowed to dispatch, never after (so a
//                                 crash mid-tool-call can't leave an
//                                 approved-but-uncounted spend).
//   revoked_at             INTEGER nullable — unixepoch timestamp set by
//                                 revokeMarathon(); once set, the gate
//                                 halts the session on the very next
//                                 tool-call check, even mid-tick.
//
// SQLite can't ALTER a CHECK constraint, so the 'status' enum widening
// (adds 'revoked' as a genuine terminal status alongside the existing
// pending/running/paused/completed/failed/abandoned) requires the
// create-new -> copy -> drop -> rename rebuild used by migration 372
// (economy_ledger's STAKE_* widening) and migration 375 (evo_asset_v3 FK
// repair). This runs INSIDE the migration runner's own db.transaction()
// (migrate.js), so it's atomic: any failure rolls the whole rebuild back
// and leaves agent_marathon_sessions untouched. Every existing column +
// index is preserved byte-for-byte; this is a pure widening (one new
// status value + four new nullable/defaulted columns), so no existing row
// or query needs to change. Idempotent + guarded: no-op if the table is
// absent (minimal build) or already carries the widened CHECK.

export function up(db) {
  const cur = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_marathon_sessions'",
  ).get();
  // Table not created yet (minimal build) OR already widened → nothing to do.
  if (!cur || !cur.sql || /'revoked'/.test(cur.sql)) return;

  // 1. New table: byte-identical to migration 171's shape except the
  //    widened status CHECK + the four new governance columns.
  db.exec(`
    CREATE TABLE agent_marathon_sessions_new (
      id           TEXT    PRIMARY KEY,
      user_id      TEXT    NOT NULL,
      title        TEXT,
      goal         TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','running','paused','completed','failed','abandoned','revoked')),
      total_turns  INTEGER NOT NULL DEFAULT 0,
      max_turns    INTEGER NOT NULL DEFAULT 200,
      meta_json    TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER,
      next_tick_at INTEGER NOT NULL DEFAULT (unixepoch()),
      allowed_domains_json TEXT,
      budget_cap    INTEGER,
      budget_spent  INTEGER NOT NULL DEFAULT 0,
      revoked_at    INTEGER
    )
  `);

  // 2. Copy every existing row verbatim (explicit column list — order-safe;
  //    the four new columns get their defaults/NULL for pre-existing rows).
  db.exec(`
    INSERT INTO agent_marathon_sessions_new
      (id, user_id, title, goal, status, total_turns, max_turns, meta_json,
       created_at, updated_at, completed_at, next_tick_at)
    SELECT
      id, user_id, title, goal, status, total_turns, max_turns, meta_json,
      created_at, updated_at, completed_at, next_tick_at
    FROM agent_marathon_sessions;
  `);

  // 3. Swap.
  db.exec(`DROP TABLE agent_marathon_sessions;`);
  db.exec(`ALTER TABLE agent_marathon_sessions_new RENAME TO agent_marathon_sessions;`);

  // 4. Recreate the exact index set from migration 171.
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_marathon_user ON agent_marathon_sessions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_marathon_status ON agent_marathon_sessions(status, next_tick_at);
  `);
}

export function down(db) {
  const cur = db.prepare(
    "SELECT sql FROM sqlite_master WHERE type='table' AND name='agent_marathon_sessions'",
  ).get();
  if (!cur || !cur.sql || !/'revoked'/.test(cur.sql)) return;

  // Narrow back to the migration-171 shape. Any row that ended up 'revoked'
  // maps to 'abandoned' (the closest pre-existing terminal status) so the
  // narrower CHECK still accepts it.
  db.exec(`
    CREATE TABLE agent_marathon_sessions_old (
      id           TEXT    PRIMARY KEY,
      user_id      TEXT    NOT NULL,
      title        TEXT,
      goal         TEXT    NOT NULL,
      status       TEXT    NOT NULL DEFAULT 'pending'
                           CHECK (status IN ('pending','running','paused','completed','failed','abandoned')),
      total_turns  INTEGER NOT NULL DEFAULT 0,
      max_turns    INTEGER NOT NULL DEFAULT 200,
      meta_json    TEXT,
      created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at INTEGER,
      next_tick_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`
    INSERT INTO agent_marathon_sessions_old
      (id, user_id, title, goal, status, total_turns, max_turns, meta_json,
       created_at, updated_at, completed_at, next_tick_at)
    SELECT
      id, user_id, title, goal,
      CASE WHEN status = 'revoked' THEN 'abandoned' ELSE status END,
      total_turns, max_turns, meta_json, created_at, updated_at, completed_at, next_tick_at
    FROM agent_marathon_sessions;
  `);
  db.exec(`DROP TABLE agent_marathon_sessions;`);
  db.exec(`ALTER TABLE agent_marathon_sessions_old RENAME TO agent_marathon_sessions;`);
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_marathon_user ON agent_marathon_sessions(user_id, status);
    CREATE INDEX IF NOT EXISTS idx_marathon_status ON agent_marathon_sessions(status, next_tick_at);
  `);
}
