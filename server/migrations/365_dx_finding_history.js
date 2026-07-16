// server/migrations/365_dx_finding_history.js
//
// Minimal commit-scoped provenance table for server/domains/dx-platform.js's
// `reviewDiff` macro, closing the docs/WAVE4_INVENTORY.md `dx-platform` row
// "No historical issue-trend / 'new vs. existing' tracking (leak period)"
// (SonarQube's leak period) — also tracked as a GENUINELY MISSING item in
// docs/lens-specs/dx-platform-capability-map.md: "reviewDiff recomputes
// fresh each call with no persisted per-commit findings history; would need
// a findings-history table, a real schema change."
//
// Scope, deliberately narrow per that finding's own framing: this is
// provenance, NOT a findings warehouse. One row per (user, codebase, commit)
// — upserted by commitSha so re-reviewing the same commit updates the row
// in place instead of accumulating duplicate history. `finding_keys_json`
// stores only the finding IDENTITY needed for a set-diff
// (`${detectorId}:${path}:${line}`, the same fields reviewDiff's own finding
// shape already carries), not full finding bodies (snippet/label) — the
// live `reviewDiff` call already recomputes those fresh; history only needs
// enough to answer "is this the same issue as last commit."
//
// Persistence is entirely opt-in from the caller's side: `reviewDiff` only
// writes a row when the caller supplies `commitSha` (a real CI/git context).
// The domain's dominant existing call shape — ad-hoc diff review with no
// commitSha — never touches this table, matching the "backward compatible,
// byte-identical without commitSha" constraint on this gap-closure unit.
//
// Persistence pattern: same db-or-memory store facade idiom as
// domains/education.js (migration 363), domains/tournaments.js (migration
// 360), and domains/admin.js (migration 364) — when ctx.db is absent or this
// table doesn't exist (minimal/test builds with no real server boot), the
// domain falls back to a process-global in-memory Map, identical to how
// dx-platform's other state (codebases/teams/analytics) already behaves.
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dx_finding_history (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL,
      codebase_id        TEXT NOT NULL DEFAULT '',
      commit_sha         TEXT NOT NULL,
      finding_count      INTEGER NOT NULL DEFAULT 0,
      finding_keys_json  TEXT NOT NULL DEFAULT '[]',
      by_severity_json   TEXT NOT NULL DEFAULT '{}',
      created_at         TEXT NOT NULL,
      UNIQUE(user_id, codebase_id, commit_sha)
    );
    CREATE INDEX IF NOT EXISTS idx_dx_finding_history_lookup
      ON dx_finding_history(user_id, codebase_id, created_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_dx_finding_history_lookup;
    DROP TABLE IF EXISTS dx_finding_history;
  `);
}
