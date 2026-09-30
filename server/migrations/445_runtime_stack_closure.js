// server/migrations/445_runtime_stack_closure.js
//
// RENUMBERED + REWRITTEN 2026-09-08 from 430_runtime_stack_schema_fixes.js,
// which collided with 430_dila_waves_abcd.js.
//
// History: two PRs in the Runtime/Dila stack both landed a migration numbered
// 430. `430_dila_waves_abcd` recorded first on every DB, so
// `430_runtime_stack_schema_fixes` was silently skipped (`version <=
// currentVersion`) and never applied anywhere. Against a fresh DB it also
// THREW — its `CREATE TABLE IF NOT EXISTS prediction_tickets (...)` used a
// Dila-runtime schema (status / priority_score / subject_kind), but
// `418_prediction_tickets` already owns that table name for Concord Predict
// (immutable forecast tickets: point_probability / model_id / creator_id).
// `IF NOT EXISTS` made the CREATE a silent no-op, then
// `CREATE INDEX ... ON prediction_tickets(status, ...)` failed with
// "no such column: status".
//
// What the old file actually contributed, reconciled:
//   - mission_tasks.priority_score + idx        → 430_dila_waves_abcd did it
//   - runtime_swe_runs                          → 430_dila_waves_abcd did it;
//       lib/runtime/swe-harness.js writes status 'passed'/'failed', both valid
//       under dila's CHECK, so the old file's alternate CHECK was unnecessary
//   - prediction_tickets (Dila-flavored)        → name-collision bug; the only
//       consumer, lib/runtime/continuous-observation.js's "open predictions"
//       count, is fixed in the same commit to query the real 418 schema
//       (a ticket is open until prediction_outcomes has its row)
//
// So nothing from the old file needs to be reconstructed. This migration is a
// defensive closure: it only ensures mission_tasks.priority_score exists, for
// any DB that somehow has mission_tasks without it (idempotent, guarded).

export function up(db) {
  const missionCols = db.prepare(`PRAGMA table_info(mission_tasks)`).all().map((c) => c.name);
  if (missionCols.length && !missionCols.includes("priority_score")) {
    db.exec(`ALTER TABLE mission_tasks ADD COLUMN priority_score REAL NOT NULL DEFAULT 0.5`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_mission_priority
      ON mission_tasks(status, priority_score DESC, next_tick_at ASC)`);
  }
}

export function down(db) {
  // priority_score may have been added by 430_dila_waves_abcd instead — leave
  // the column in place on down(); only drop the index this file might add.
  db.exec(`DROP INDEX IF EXISTS idx_mission_priority`);
}
