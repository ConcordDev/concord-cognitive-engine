// server/migrations/159_federation_origin_peer.js
//
// Phase 1 — Cross-instance DTU purchase support.
//
// When a DTU is imported from a federated peer (via the universal-file-format
// portability path or a remote purchase), we need to remember which peer it
// came from so:
//   - Future purchases of THIS instance's local copy can route royalty
//     cascade events back to the originating peer.
//   - The marketplace layer can branch on dtu.origin_peer_id to delegate
//     purchase flow when a buyer wants the canonical (peer-hosted) copy
//     vs the locally-cached copy.
//   - Federation discovery surfaces ("show me DTUs from peer X")
//     can join cleanly.
//
// Append-only per CLAUDE.md invariant — earlier migrations untouched.
// Idempotent: column-existence check before ADD COLUMN.

export function up(db) {
  const cols = db.prepare(`PRAGMA table_info(dtus)`).all().map(r => r.name);
  if (!cols.includes("origin_peer_id")) {
    db.exec(`ALTER TABLE dtus ADD COLUMN origin_peer_id TEXT DEFAULT NULL`);
  }
  // Lookup index on (origin_peer_id) so the federated marketplace branch
  // doesn't full-scan when checking each purchase. NULL rows aren't
  // indexed by SQLite by default for partial indexes; this is a normal
  // index since most rows will be NULL (local DTUs) but the small number
  // of federated DTUs need O(log n) lookup.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_dtus_origin_peer ON dtus(origin_peer_id) WHERE origin_peer_id IS NOT NULL`);
}
