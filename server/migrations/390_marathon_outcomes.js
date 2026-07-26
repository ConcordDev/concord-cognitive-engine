// server/migrations/390_marathon_outcomes.js
//
// Cross-project learning — procedural-memory tier (2026-07-24).
//
// Gap: server/lib/project-thread.js is a pure linking/bookkeeping layer —
// it ties a goal tree + marathon session(s) + a relevance-scoped
// conversation-memory pull into one addressable project, but nothing ever
// asks "how did completing project A actually go, and does that inform
// project B." There is no post-mortem, no procedural-memory tier.
//
// This migration adds exactly one table: a durable, denormalized snapshot
// taken at the moment a marathon session (server/lib/agent-marathon.js,
// mig 171/379) reaches a terminal status. Every field is real and already
// derivable from `agent_marathon_sessions` / `agent_marathon_turns` — this
// is a cache of a real computation, not a new kind of data:
//
//   marathon_outcomes
//     id                 — synthetic PK
//     user_id            — owner (mirrors agent_marathon_sessions.user_id)
//     session_id         — the source agent_marathon_sessions.id (one
//                           outcome row per terminal session; UNIQUE so a
//                           re-extraction on the same session is an
//                           idempotent no-op, not a duplicate row)
//     goal               — agent_marathon_sessions.goal (the actual text,
//                           not a paraphrase — this is what
//                           findSimilarOutcomes tokenizes against)
//     title              — agent_marathon_sessions.title
//     status             — terminal status the session actually reached
//                           ('completed'|'failed'|'abandoned'|'revoked'|
//                           'paused' — same enum as agent_marathon_sessions,
//                           see server/lib/agent-marathon.js's terminal-
//                           status list)
//     tool_domain_histogram_json — JSON object mapping macro-domain string
//                           (server/lib/agent-marathon.js#domainForToolCall's
//                           own resolution — "tools", "dtu", a run_lens_action
//                           domain, etc.) to a real count of how many turns'
//                           tool_calls_json actually invoked that domain,
//                           counted directly from agent_marathon_turns
//     turn_count         — agent_marathon_sessions.total_turns at extraction
//     duration_s         — completed_at - created_at (NULL when the session
//                           has no completed_at, e.g. abandoned mid-flight)
//     completed_at       — agent_marathon_sessions.completed_at, or the
//                           extraction-time unixepoch() when the session
//                           reached a terminal status without ever setting
//                           completed_at (only 'completed' sets it — see
//                           tickMarathon's UPDATE ... CASE)
//     extracted_at       — when THIS row was written
//
// No FK constraint on session_id — matches this repo's stated convention
// (see e.g. 378_projects.js's goal_tree_id) of checking referential
// validity in the lib layer rather than enforcing it in SQLite.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS marathon_outcomes (
      id                          TEXT    PRIMARY KEY,
      user_id                     TEXT    NOT NULL,
      session_id                  TEXT    NOT NULL UNIQUE,
      goal                        TEXT    NOT NULL,
      title                       TEXT,
      status                      TEXT    NOT NULL,
      tool_domain_histogram_json  TEXT    NOT NULL DEFAULT '{}',
      turn_count                  INTEGER NOT NULL DEFAULT 0,
      duration_s                  INTEGER,
      completed_at                INTEGER,
      extracted_at                INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_marathon_outcomes_user ON marathon_outcomes(user_id, extracted_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_marathon_outcomes_session ON marathon_outcomes(session_id)`);
}

export function down(db) {
  db.exec(`DROP INDEX IF EXISTS idx_marathon_outcomes_session`);
  db.exec(`DROP INDEX IF EXISTS idx_marathon_outcomes_user`);
  db.exec(`DROP TABLE IF EXISTS marathon_outcomes`);
}

export const description = "marathon_outcomes: a durable procedural-memory snapshot taken when a marathon session reaches a terminal status, for deterministic keyword-overlap similarity lookup across projects";
