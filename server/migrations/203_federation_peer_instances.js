// server/migrations/203_federation_peer_instances.js
//
// Phase 13 (Stage D) — known federation peer instances.
//
// `federation_peer_instances` is the registry of OTHER Concord (or
// Mastodon-compatible) instances this node has talked to. Distinct from
// the older Concord-CRI peer hierarchy (which is about regions/nationals)
// — this table is the fediverse instance discovery layer.
//
// Populated by:
//   - explicit POST /api/federation/peers
//   - federation-peer-discovery.probePeerInstance (heartbeat)
//   - inbound activity (auto-discover origin of unknown actors)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS federation_peer_instances (
      base_url           TEXT PRIMARY KEY,
      name               TEXT,
      software_name      TEXT,
      software_version   TEXT,
      capabilities_json  TEXT,
      status             TEXT NOT NULL DEFAULT 'active'
                         CHECK (status IN ('active', 'unreachable', 'banned')),
      first_seen_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      last_seen_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      last_probe_at      INTEGER,
      last_error         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_fpi_status_last_seen
      ON federation_peer_instances(status, last_seen_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_fpi_status_last_seen;
    DROP TABLE IF EXISTS federation_peer_instances;
  `);
}
