// server/migrations/351_fork_objects.js
//
// P-C — the lattice-fork object: a BOUNDED clone of a specific set of DTUs plus a
// snapshot of the source's temperament, instantiable in a confined in-process
// sandbox (lib/confined-ctx.js) and merge-back-analyzable (dry-run only) against
// emergent/merge.js. This is NOT world-sharding — it has its own persistence and
// its own confinement mechanism, orthogonal to lib/world-shard-protocol.js.
//
//   id                        PK
//   owner_user_id             the human who forked (holds the fork object)
//   source_user_id            whose corpus was cloned (== owner for a self-fork)
//   dtu_ids_json              the BOUNDED set of DTU ids in the clone (the thing
//                             that makes this "bounded", not a corpus mirror)
//   dtu_count                 |dtu_ids_json| — denormalized for cheap cap checks
//   temperament_snapshot_json snapshot of the source's agent self-model
//                             (core_values + drive_profile, per mig 325/326)
//   agent_identity_id         FK-ish → agent_identities.agent_id: the
//                             agent-disclosure-compliant identity for this fork
//                             (its linked user carries users.is_agent=1, mig 324)
//   status                    draft | active | archived
//   created_at                unix seconds
//
// Forward-only; table-guarded. Migrations are append-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fork_objects (
      id                        TEXT PRIMARY KEY,
      owner_user_id             TEXT NOT NULL,
      source_user_id            TEXT NOT NULL,
      dtu_ids_json              TEXT NOT NULL DEFAULT '[]',
      dtu_count                 INTEGER NOT NULL DEFAULT 0,
      temperament_snapshot_json TEXT NOT NULL DEFAULT '{}',
      agent_identity_id         TEXT,
      status                    TEXT NOT NULL DEFAULT 'draft'
        CHECK (status IN ('draft','active','archived')),
      created_at                INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_fork_objects_owner  ON fork_objects(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_fork_objects_source ON fork_objects(source_user_id);
    CREATE INDEX IF NOT EXISTS idx_fork_objects_agent  ON fork_objects(agent_identity_id);
    CREATE INDEX IF NOT EXISTS idx_fork_objects_status ON fork_objects(status);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS fork_objects;`);
}
