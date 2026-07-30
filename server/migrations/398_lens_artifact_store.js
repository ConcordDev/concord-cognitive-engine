// migrations/398_lens_artifact_store.js
//
// Row-level durable storage for lens artifacts.
//
// WHY. `STATE.lensArtifacts` was an unbounded in-memory Map whose ONLY
// persistence was the whole-state JSON snapshot. Measured 2026-07-28 on a
// running server: 11,517 artifacts, 9.86 MB — the single largest key in the
// ~19 MB snapshot, larger even than `dtus`, and the one large collection with
// neither a `capArr` cap (its neighbours `sources`/`listings`/`entitlements`/
// `transactions` all have one) nor a write-through store.
//
// Two consequences, both real:
//   1. COST — every debounced save re-serialized all 9.86 MB of artifacts,
//      which is what made the snapshot expensive enough to trip the
//      request-admission load shedder.
//   2. DURABILITY — artifacts existed in exactly one place. A corrupted or
//      truncated snapshot lost every artifact ever created, with no
//      row-level recovery, while DTUs (via `dtu_store`) had exactly that.
//
// This table is the artifact-side equivalent of `dtu_store` (migration 025),
// deliberately mirroring its shape so the boot migrate→rehydrate pairing works
// the same way and is recognisable to anyone who has read that one.
//
// Columns beyond `data` exist to make artifacts QUERYABLE without parsing
// every blob — the current code has to `Array.from(...values())` and filter in
// JS (see emergent/repair-cortex.js's pending-artifact sweep).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lens_artifact_store (
      id TEXT PRIMARY KEY,
      domain TEXT,
      type TEXT,
      owner_id TEXT,
      title TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now')),
      data TEXT NOT NULL DEFAULT '{}'
    )
  `);

  // Indexes chosen from the ACTUAL read patterns in the tree, not speculation:
  //   - by owner: personal-locker / "mine" listings scope by ownerId
  //   - by domain: cross-lens catalog reads (collab, astronomy co-observe)
  //   - by updated_at: the repair-cortex sweep and any recency ordering
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lens_artifact_owner ON lens_artifact_store(owner_id)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lens_artifact_domain ON lens_artifact_store(domain)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_lens_artifact_updated ON lens_artifact_store(updated_at)`);
}

// Deliberately a NO-OP, not `DROP TABLE`.
//
// Once the boot wiring omits `lensArtifacts` from the state snapshot, this
// table is the SOLE durable home for every artifact. A down() that dropped it
// would silently destroy all user-created artifacts the moment anyone ran a
// rollback — the exact class of irreversible loss CLAUDE.md's append-only
// migration rule exists to prevent. Matches 397_brain_mode.js's convention.
export function down(_db) { /* append-only convention — leave the table in place */ }
