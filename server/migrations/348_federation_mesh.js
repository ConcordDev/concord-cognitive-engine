// server/migrations/348_federation_mesh.js
//
// Federated brain / mesh (#38) — DB-backed persistence for the federation mesh
// so peers + an incoming-DTU consent queue survive restart (the existing
// cnet-federation.js keeps these in memory). A received DTU is enqueued with its
// consent flags and only accepted if our intended use honours them
// (consent-orchestration); revocation blocks future acceptance. The "6th brain"
// is a consented consult of peers' brains over the real SSRF-guarded
// connectorFetch — no peer reachable → honest unavailable, never a faked reply.
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS fedmesh_peers (
      peer_id          TEXT PRIMARY KEY,
      url              TEXT,
      brain_url        TEXT,
      pub_key          TEXT,
      capabilities_json TEXT NOT NULL DEFAULT '[]',
      revoked          INTEGER NOT NULL DEFAULT 0,
      added_at         INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS fedmesh_inbox (
      id             TEXT PRIMARY KEY,
      from_peer      TEXT NOT NULL,
      dtu_id         TEXT,
      envelope_json  TEXT NOT NULL DEFAULT '{}',
      consent_status TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | rejected | revoked
      reason         TEXT,
      received_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_fedmesh_inbox_status ON fedmesh_inbox(consent_status, received_at)`);
}
