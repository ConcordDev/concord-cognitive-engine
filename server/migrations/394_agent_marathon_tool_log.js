// server/migrations/394_agent_marathon_tool_log.js
//
// ConKay-E — tool-call fingerprint log for marathon tick-durability
// (2026-07-24).
//
// Gap: a marathon session (server/lib/agent-marathon.js) can run for hours,
// dispatching many real tool calls per tick through
// createToolGate/runAgentLoop. If the process is killed mid-tool-call
// (OOM, container restart, crash), nothing on disk records that a call was
// even IN FLIGHT — a resumed marathon (or an operator) has no way to tell
// "which tool call was running when things died" from "the tick just
// hadn't gotten there yet."
//
// This migration adds exactly one table: a synchronous, one-row-per-real-
// tool-call-attempt log, written in two phases:
//   1. 'dispatched' — INSERTed by createToolGate SYNCHRONOUSLY, right
//      before the tool actually executes (see marathon-tick-durability.js
//      + agent-marathon.js#createToolGate).
//   2. 'completed' / 'failed' — UPDATEd once the tool call actually
//      resolves.
// A row stuck at 'dispatched' after the fact is exactly the forensic
// evidence: that call was in flight when the process stopped writing.
//
//   agent_marathon_tool_log
//     id           — synthetic autoincrement PK; also gives real insertion
//                    order for free (SQLite rowid), independent of call_seq.
//     session_id   — agent_marathon_sessions.id, NOT enforced as an FK
//                    (matches this repo's stated convention — see e.g.
//                    378_projects.js's goal_tree_id — of checking
//                    referential validity in the lib layer).
//     tick_seq     — which tickMarathon() invocation made this call
//                    (session.total_turns + 1 at tick start); nullable,
//                    informational only.
//     call_seq     — monotonic per-session sequence number, 1-based,
//                    computed by marathon-tick-durability.js as
//                    MAX(call_seq)+1 for the session. Survives across
//                    ticks/process restarts (queried fresh from the DB
//                    each time, never an in-memory counter), so a
//                    resumed session's new tool calls keep numbering
//                    forward from wherever the crashed tick left off.
//     tool_name    — call.tool (e.g. "web_search", "run_lens_action").
//     params_json  — a TRUNCATED JSON rendering of call.params (capped at
//                    2000 chars by marathon-tick-durability.js), NOT a bare
//                    hash/fingerprint. Deliberate choice: this table's whole
//                    purpose is crash forensics — a human resuming a
//                    marathon after a crash needs to see what the in-flight
//                    call was actually DOING, not just verify equality
//                    against an opaque digest. The truncation cap keeps a
//                    pathological huge payload (e.g. a giant browser_act
//                    actions array) from bloating the log table.
//     status       — 'dispatched' | 'completed' | 'failed'. Starts at
//                    'dispatched' and is updated at most once.
//     result_summary — truncated (2000 char) string summary of the
//                    outcome (error message, or a short stringified
//                    result); NULL while status='dispatched'.
//     created_at   — unixepoch() at dispatch time.
//     completed_at — unixepoch() at outcome-recording time; NULL while
//                    status='dispatched' (this is the tell — a
//                    non-terminal marathon session with a
//                    status='dispatched' row and no completed_at is a
//                    call that was genuinely interrupted).
//
// Append-only; IF NOT EXISTS so re-runs are safe. Purely additive — no
// existing table or query is touched.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_marathon_tool_log (
      id            INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id    TEXT    NOT NULL,
      tick_seq      INTEGER,
      call_seq      INTEGER NOT NULL,
      tool_name     TEXT    NOT NULL,
      params_json   TEXT,
      status        TEXT    NOT NULL DEFAULT 'dispatched'
                    CHECK (status IN ('dispatched','completed','failed')),
      result_summary TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      completed_at  INTEGER
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_marathon_tool_log_session ON agent_marathon_tool_log(session_id, call_seq)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_marathon_tool_log_status ON agent_marathon_tool_log(session_id, status)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_marathon_tool_log_status`);
  db.exec(`DROP INDEX IF EXISTS idx_marathon_tool_log_session`);
  db.exec(`DROP TABLE IF EXISTS agent_marathon_tool_log`);
}

export const description = "agent_marathon_tool_log: synchronous dispatched/completed/failed log of every real marathon tool-call attempt, for crash-forensics (which call was in flight when the process died)";
