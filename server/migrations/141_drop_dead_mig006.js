// Migration 141 — Drop dead tables from migration 006 (Phase 4).
//
// Renamed from 120_drop_dead_mig006.js — collided with 120_understandings.js
// (which shipped first at 37178671, while this migration shipped later at
// 257b72c3 and silently took the same number). The collision blocked
// fresh-DB boot at the second 120 row with UNIQUE constraint failed:
// schema_version.version. Re-numbered to 141 (next free after 140).
// Idempotent (DROP TABLE IF EXISTS), so envs that already applied this
// at version 120 will safely re-apply at 141 with no data effect.
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
    console.warn("[migration 141]", result);
  }
}

export function down(_db) {
  // Drops are forward-only; rescue snapshots in data/dropped-tables/ are
  // the recovery path. No-op down() preserves the append-only invariant.
}
