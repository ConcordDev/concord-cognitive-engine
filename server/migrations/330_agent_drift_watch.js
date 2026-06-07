// server/migrations/330_agent_drift_watch.js
//
// Wave 7 / Track C3 — the periodic drift-watch surface. measureValueDrift + the review
// cadence stamp already exist; this adds the columns the scheduled sweep
// (agent-drift-watch-cycle) writes so a human can SEE which agents are drifting from
// their values anchor. Forward-only, column-guarded.
//
//   agent_identities.value_drift      REAL    — 0 (aligned) .. 1 (none of the anchor expressed)
//   agent_identities.drift_flagged_at INTEGER — when the drift last crossed the review threshold

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='agent_identities'").get()) return;
  for (const [col, ddl] of [
    ["value_drift", "ALTER TABLE agent_identities ADD COLUMN value_drift REAL DEFAULT 0"],
    ["drift_flagged_at", "ALTER TABLE agent_identities ADD COLUMN drift_flagged_at INTEGER"],
  ]) {
    if (!columnExists(db, "agent_identities", col)) {
      try { db.exec(ddl); } catch { /* noop */ }
    }
  }
}

export function down(_db) {
  // forward-only
}
