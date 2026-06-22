// server/migrations/341_long_horizon_plans.js
//
// Long-Horizon Planner (#14) — the SCHEDULE + CONTINGENCY layer on top of the
// goal-decomposition tree (#10, mig 340). A plan time-phases a tree's actionable
// leaves into dated milestones and attaches "if this slips, do that" fallbacks.
// The plan-horizon-cycle heartbeat detects overdue milestones and fires their
// contingencies. Distinct from the tree (structure) — this is when + what-if.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lh_plans (
      id           TEXT PRIMARY KEY,
      user_id      TEXT NOT NULL,
      tree_id      TEXT,                              -- the goal tree this plans (optional)
      title        TEXT NOT NULL,
      horizon_days INTEGER NOT NULL DEFAULT 30,
      start_ts     INTEGER NOT NULL DEFAULT (unixepoch()),
      status       TEXT NOT NULL DEFAULT 'active',    -- active | done | abandoned
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lhplan_user ON lh_plans(user_id, status)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS lh_milestones (
      id          TEXT PRIMARY KEY,
      plan_id     TEXT NOT NULL,
      node_id     TEXT,                               -- linked goal_nodes row (optional)
      title       TEXT NOT NULL,
      due_ts      INTEGER NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',    -- pending | done | slipped | abandoned
      ordinal     INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lhms_plan ON lh_milestones(plan_id, due_ts)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lhms_status ON lh_milestones(status, due_ts)`);

  db.exec(`
    CREATE TABLE IF NOT EXISTS lh_contingencies (
      id           TEXT PRIMARY KEY,
      milestone_id TEXT NOT NULL,
      condition    TEXT NOT NULL DEFAULT 'overdue',   -- overdue | blocked
      fallback     TEXT NOT NULL,                     -- the action to take
      triggered_at INTEGER,                           -- NULL until fired
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lhcon_ms ON lh_contingencies(milestone_id)`);
}
