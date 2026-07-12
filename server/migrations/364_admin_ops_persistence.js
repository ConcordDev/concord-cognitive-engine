// server/migrations/364_admin_ops_persistence.js
//
// Durable, per-deployment persistence for the admin ops-console's alert
// rules / feature flags / incident timeline (domains/admin.js — Datadog +
// Grafana parity). Previously all three lived in
// globalThis._concordSTATE.adminLens.{alertRules,featureFlags,incidents}
// (plain in-memory Maps) — every alert rule, feature flag, and incident
// vanished on process restart, and under `CONCORD_SHARD_WORLDS=true` each
// shard process would see a DIFFERENT, disjoint set of rules/flags/
// incidents instead of the one shared operator view a real ops console
// needs. Tracked as an open gap in
// docs/lens-specs/admin-capability-map.md ("ops-console backlog") and
// docs/WAVE4_INVENTORY.md's `| admin |` row, both of which named this
// exact fix: "move `adminLens` state — alert rules, feature flags,
// incident timeline — into DB-backed tables the way `tenantAction`'s
// target semantics imply it should eventually be."
//
// Scope: this migration covers only alertRules / featureFlags / incidents
// — the three state buckets both docs explicitly named. `series` (metric
// time-series ring buffers), `tenants` (per-user admin actions — already
// keyed by a real userId, a separate concern), `logBuffer`, and `traces`
// stay in-memory ring buffers by design (high-churn, TTL/cap-bounded
// telemetry that is not the kind of state an operator expects to survive
// a restart — Datadog/Grafana themselves don't persist raw metric points
// or log tails as durable rows in the alerting/flagging sense either).
//
// Persistence: reached via ctx.db using the same db-or-memory facade
// pattern as domains/education.js (migration 363), domains/tournaments.js
// (migration 360). When ctx.db is absent or these tables don't exist
// (minimal/test builds with no real server boot), the store falls back to
// a process-global in-memory Map — identical behavior to the old code
// path; only cross-restart durability and cross-shard consistency need
// the DB path. The running server always has ctx.db, so ops-console state
// survives a restart and (once CONCORD_SHARD_WORLDS write-routing for
// this table is added — out of scope here, same as every other
// user-global table per CLAUDE.md's DB write-ownership rules) is on the
// correct footing to be made shard-consistent.
//
// Schema shape: this state is genuinely GLOBAL/per-deployment, not
// per-user — every macro in this section reads/writes the shared
// `adminLens` container with no userId-scoped filtering anywhere in the
// existing code (an actor's id is recorded only as an audit trail —
// `acknowledgedBy`/timeline `actorId` — never as a visibility filter,
// matching how a real single-pane ops console works: every operator sees
// the same alert rules, the same flags, the same incidents). No
// `user_id`/`created_by` scoping column was added for that reason —
// adding one that's never read would be dead schema, and the capability
// map's own framing ("in-memory and per-deployment") is explicit that
// this is a shared surface. Nested arrays with no independent identity
// outside their parent (an incident's `timeline`) stay JSON-blob columns,
// same tradeoff as migration 363's `lessons_json`/`roster_json`.
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS admin_alert_rules (
      id                 TEXT PRIMARY KEY,
      name               TEXT NOT NULL,
      metric             TEXT NOT NULL,
      comparator         TEXT NOT NULL DEFAULT '>',
      threshold          REAL NOT NULL,
      severity           TEXT NOT NULL DEFAULT 'warning',
        -- info | warning | critical
      aggregation        TEXT NOT NULL DEFAULT 'avg',
        -- avg | max | min | last
      window_minutes     INTEGER NOT NULL DEFAULT 15,
      enabled            INTEGER NOT NULL DEFAULT 1,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_alert_rules_metric ON admin_alert_rules(metric);

    CREATE TABLE IF NOT EXISTS admin_feature_flags (
      id                 TEXT PRIMARY KEY,
      key                TEXT NOT NULL,
      enabled            INTEGER NOT NULL DEFAULT 0,
      description        TEXT NOT NULL DEFAULT '',
      rollout_pct        REAL NOT NULL DEFAULT 100,
      created_at         TEXT NOT NULL,
      updated_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_feature_flags_key ON admin_feature_flags(key);

    CREATE TABLE IF NOT EXISTS admin_incidents (
      id                 TEXT PRIMARY KEY,
      title              TEXT NOT NULL,
      severity           TEXT NOT NULL DEFAULT 'sev3',
        -- sev1 | sev2 | sev3 | sev4
      service            TEXT NOT NULL DEFAULT 'platform',
      description        TEXT NOT NULL DEFAULT '',
      status             TEXT NOT NULL DEFAULT 'open',
        -- open -> acknowledged -> resolved
      acknowledged_by    TEXT,
      acknowledged_at    TEXT,
      opened_at          TEXT NOT NULL,
      resolved_at        TEXT,
      duration_ms        INTEGER,
      timeline_json      TEXT NOT NULL DEFAULT '[]',
      created_at         TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_admin_incidents_status ON admin_incidents(status);
    CREATE INDEX IF NOT EXISTS idx_admin_incidents_opened_at ON admin_incidents(opened_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_admin_incidents_opened_at;
    DROP INDEX IF EXISTS idx_admin_incidents_status;
    DROP TABLE IF EXISTS admin_incidents;
    DROP INDEX IF EXISTS idx_admin_feature_flags_key;
    DROP TABLE IF EXISTS admin_feature_flags;
    DROP INDEX IF EXISTS idx_admin_alert_rules_metric;
    DROP TABLE IF EXISTS admin_alert_rules;
  `);
}
