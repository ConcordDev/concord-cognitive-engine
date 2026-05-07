// server/migrations/113_embodied_signal_log_unification.js
//
// Phase 6 reconciliation (post-merge of claude/lattice-consent-infra
// PR #301 into main). Both branches independently shipped Layer 7
// embodied-signal substrate. Migration 112_embodied_signals.js (main)
// creates `embodied_signal_log` with columns:
//   id, world_id, location_x, location_z, channel, value, raw_value,
//   observer_id, observer_type, train_consented, observed_at
//
// Our pre-merge branch had 108_embodied_signal_log.js (deleted in this
// commit) with a different but compatible schema. To preserve the
// downstream code paths from our Phases 7, 7.5, 8 — specifically
// `lib/embodied/signals.js#recordSignal`, `decaySweep`,
// `seedWorldClimate`, and `lib/embodied/skill-environment.js` writing
// feedback signals + structural-stress channels — this adapter
// migration adds the columns those code paths require:
//
//   cell_x   INTEGER  — 50m-quantized cell x (computed from location_x)
//   cell_z   INTEGER  — 50m-quantized cell z (computed from location_z)
//   source   TEXT     — our taxonomy ('sensor'|'skill_cast'|'combat'|
//                       'world_event'|'world_seed'); maps onto main's
//                       `observer_type` where overlapping
//   source_id TEXT    — origin entity id (skillDtuId, eventId, etc.)
//   recorded_at INTEGER — alias for observed_at to keep our existing
//                         queries working without mass refactor
//   decay_at INTEGER  — TTL for our recency-weighted folding
//
// Plus indexes our queries depend on:
//   idx_embodied_world_cell      — cell-based locality
//   idx_embodied_decay           — TTL sweep
//
// All ADD COLUMN statements are guarded with try/catch so re-running
// the migration is idempotent on databases that have already been
// patched.

export function up(db) {
  const addCol = (col, ddl) => {
    try { db.exec(`ALTER TABLE embodied_signal_log ADD COLUMN ${col} ${ddl}`); }
    catch (e) {
      if (!/duplicate column|already exists/i.test(String(e?.message ?? e))) throw e;
    }
  };

  addCol("cell_x",       "INTEGER");
  addCol("cell_z",       "INTEGER");
  addCol("source",       "TEXT");
  addCol("source_id",    "TEXT");
  addCol("recorded_at",  "INTEGER");
  addCol("decay_at",     "INTEGER");

  // Backfill cell_x/cell_z from location_x/location_z for existing rows.
  // CELL_SIZE = 50m matches our static-parse cellOf() and the Layer 7.5
  // signalsForWorld locality-window query.
  db.exec(`
    UPDATE embodied_signal_log
       SET cell_x = CAST(location_x / 50 AS INTEGER),
           cell_z = CAST(location_z / 50 AS INTEGER)
     WHERE cell_x IS NULL AND location_x IS NOT NULL
  `);

  // Backfill recorded_at = observed_at for existing rows.
  db.exec(`
    UPDATE embodied_signal_log
       SET recorded_at = observed_at
     WHERE recorded_at IS NULL
  `);

  // New indexes for the cell-based + TTL query paths.
  db.exec(`CREATE INDEX IF NOT EXISTS idx_embodied_world_cell
             ON embodied_signal_log(world_id, cell_x, cell_z, recorded_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_embodied_decay
             ON embodied_signal_log(decay_at) WHERE decay_at IS NOT NULL`);
}

export function down(db) {
  // ADD COLUMN is not reliably reversible in SQLite without table
  // rebuild. Drop indexes only; columns stay (no-op rollback acceptable
  // for adapter migrations).
  db.prepare("DROP INDEX IF EXISTS idx_embodied_world_cell").run();
  db.prepare("DROP INDEX IF EXISTS idx_embodied_decay").run();
}
