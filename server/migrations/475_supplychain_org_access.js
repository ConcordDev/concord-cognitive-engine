// Supply-chain org access is not the same thing as an open guild roster.
//
// world_organizations / org_members stay the shared social graph (guilds
// still join immediately). Supply-chain shipment and work-order visibility
// needs its own grant: a self-join is only a pending request until a
// planner approves it, and approval grants a read-only analyst until a
// later promotion. These three tables are additive. Nothing existing is
// altered or dropped.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sc_org_join_requests (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending',
      created_at TEXT NOT NULL,
      resolved_at TEXT,
      resolved_by TEXT,
      PRIMARY KEY (org_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_sc_org_join_requests_org
      ON sc_org_join_requests (org_id, status);

    CREATE TABLE IF NOT EXISTS sc_org_grants (
      org_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      sc_role TEXT NOT NULL,
      org_role TEXT NOT NULL,
      granted_by TEXT,
      granted_at TEXT NOT NULL,
      PRIMARY KEY (org_id, user_id)
    );

    CREATE TABLE IF NOT EXISTS sc_org_invites (
      token TEXT PRIMARY KEY,
      org_id TEXT NOT NULL,
      created_by TEXT NOT NULL,
      created_at TEXT NOT NULL,
      expires_at TEXT NOT NULL,
      consumed_by TEXT,
      consumed_at TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_sc_org_invites_org
      ON sc_org_invites (org_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_sc_org_invites_org;
    DROP TABLE IF EXISTS sc_org_invites;
    DROP TABLE IF EXISTS sc_org_grants;
    DROP INDEX IF EXISTS idx_sc_org_join_requests_org;
    DROP TABLE IF EXISTS sc_org_join_requests;
  `);
}

export const description = "Pending supply-chain org joins, access grants, and single-use invite tokens";
