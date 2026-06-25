// server/migrations/345_governance_simulations.js
//
// Governance Proposal Simulator (#41) — a policy-impact sandbox attached to the
// existing governance voting (mig 138). Before voting, a proposal's constant
// delta is run through a deterministic projector ("if this passes, X changes by
// Y") so voters decide on consequences, not vibes. This table caches the
// projection per proposal. Read-only over a snapshot — no live constant is
// changed, royalty math is untouched.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS governance_simulations (
      proposal_id   TEXT PRIMARY KEY,
      constant_path TEXT NOT NULL,
      baseline_json TEXT NOT NULL DEFAULT '{}',
      projected_json TEXT NOT NULL DEFAULT '{}',
      summary       TEXT,
      computed_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
}
