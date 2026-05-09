// Migration 120 — Drop dead tables from migration 006 (Phase 4).
//
// `dtu_embeddings` is superseded by the `embedding` column on `dtus`.
// The migration 006 comment itself documents the death.
//
// Behavior:
//   - if CONCORD_DROP_DEAD_TABLES=0, skip everything
//   - if table has rows AND CONCORD_ALLOW_DROP_NONEMPTY unset, snapshot
//     to data/dropped-tables/<table>.<ts>.json and SKIP the drop
//   - otherwise DROP TABLE IF EXISTS, audit row in migration_drops
//
// See server/migrations/_drop-with-rescue.js for the full helper logic.

import { dropDeadTables } from "./_drop-with-rescue.js";

export function up(db) {
  const result = dropDeadTables(db, [
    "dtu_embeddings",
  ]);
  if (!result.ok) {
    console.warn("[migration 120]", result);
  }
}

export function down(_db) {
  // Drops are forward-only; rescue snapshots in data/dropped-tables/ are
  // the recovery path. No-op down() preserves the append-only invariant.
}
