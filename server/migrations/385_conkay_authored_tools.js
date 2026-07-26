// server/migrations/385_conkay_authored_tools.js
//
// First-buildable slice of `docs/CONKAY_TOOL_AUTHORING_SPEC.md` (§7) — the
// governed capability that expands what ConKay's own agent loop can DO: a
// human proposes a named, saved composed tool (a DSL program or a
// plugin-shaped piece of sandboxed code), a human approves it, and only
// THEN can ConKay's tool-calling loop invoke it on its own initiative in a
// later turn or an unattended marathon tick — never before approval, and
// never again once revoked.
//
// This table is the ONE durable record the spec's §2a requires: unlike
// `server/lib/repair-remediation.js`'s in-memory queue (safe there because
// its candidates re-derive from a live detector sweep on restart), an
// authored tool is the one-and-only copy of a human's authored capability,
// invoked repeatedly and indefinitely across restarts — so the
// proposed -> approved|rejected -> (revoked) state machine MUST be
// DB-backed, not in-memory.
//
// Column shape modeled directly on the governance-column patterns already
// in this codebase (per the spec's §7 point 1):
//   - owner_type/owner_org_id mirror migration 381's
//     creative_usage_licenses.licensee_type/licensee_org_id widening
//     (org-scoped sharing, §5) — default 'user' so a private, self-owned
//     tool needs no org concept at all.
//   - revoked_at/revoke_reason mirror migration 344's
//     creative_usage_licenses revocation columns (§4).
//   - proposed_at/approved_at/approved_by/rejected_at/rejected_by/
//     reject_reason mirror the agent_marathon_sessions (mig 379) /
//     repair-remediation.js governance-envelope column shape.
//
// `static_validation_json` stamps the validator.js-style gate verdict
// (server/lib/conkay-tool-authoring.js#propose) computed BEFORE a human
// ever sees the proposal (spec §2b, Tier 1) — never silently skipped, and
// never computed after the fact.
//
// Plain TEXT foreign keys with no SQL FOREIGN KEY constraint, matching this
// repo's established convention (see migration 384's notebooks table,
// 378_projects.js's goal_tree_id, 377_workspace_rooms.js's owner_id) —
// referential validity is checked in the lib layer, which reports a
// dangling reference honestly rather than fabricating one.
//
// Append-only; IF NOT EXISTS so re-runs (and minimal/partial builds) are
// safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conkay_authored_tools (
      id                      TEXT PRIMARY KEY,
      owner_user_id           TEXT NOT NULL,
      owner_type              TEXT NOT NULL DEFAULT 'user' CHECK (owner_type IN ('user','org')),
      owner_org_id            TEXT,
      name                    TEXT NOT NULL,
      description             TEXT NOT NULL DEFAULT '',
      kind                    TEXT NOT NULL CHECK (kind IN ('dsl','sandboxed_code')),
      source                  TEXT NOT NULL,
      manifest_json           TEXT NOT NULL DEFAULT '[]',
      input_schema_json       TEXT,
      status                  TEXT NOT NULL DEFAULT 'proposed'
                                   CHECK (status IN ('proposed','approved','rejected','revoked')),
      static_validation_json  TEXT,
      proposed_at             INTEGER NOT NULL DEFAULT (unixepoch()),
      approved_at             INTEGER,
      approved_by             TEXT,
      rejected_at             INTEGER,
      rejected_by             TEXT,
      reject_reason           TEXT,
      revoked_at              INTEGER,
      revoke_reason           TEXT
    );
  `);

  db.exec(`CREATE INDEX IF NOT EXISTS idx_conkay_tools_owner ON conkay_authored_tools(owner_user_id, status)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conkay_tools_org ON conkay_authored_tools(owner_org_id) WHERE owner_org_id IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_conkay_tools_status ON conkay_authored_tools(status, proposed_at)`);
}
