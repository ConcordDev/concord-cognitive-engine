// server/migrations/316_schema_drift_repair2.js
//
// Schema-drift repair, part 2 — the tail the 315 table-creates exposed:
//   - drift_alerts: a persistent store for lattice drift alerts (ghost-hunt /
//     patterns / news-story read it; today the alerts live only in-memory in
//     drift-monitor, so the SQL reads crash). Creating the table gives the
//     lattice orchestrator a real persistence target and the readers degrade to
//     empty instead of crashing. lattice_drift_alerts is the same store (the
//     reader is redirected to this table). Column union covers all three readers.
//   - dtus.content_hash: the deterministic-quality dedup gate selects by it; the
//     column never existed. Nullable so the dedup is a clean no-op until DTU mint
//     populates it (vs the current crash).
//   - purchases.stripe_payment_intent_id / metadata_json: the Stripe chargeback
//     handler looks a purchase up by payment-intent + reads metadata; neither
//     column existed (purchases had only stripe_session_id / stripe_event_id).
//
// IF NOT EXISTS / guarded ALTERs for idempotency.

function hasColumn(db, table, col) {
  try {
    return db.prepare(`PRAGMA table_info(${JSON.stringify(table)})`).all().some((c) => c.name === col);
  } catch {
    return false;
  }
}

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS drift_alerts (
      id           TEXT PRIMARY KEY,
      type         TEXT,
      drift_type   TEXT,
      severity     TEXT,
      message      TEXT,
      signature    TEXT,
      context_json TEXT,
      detected_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      resolved_at  INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_drift_alerts_open ON drift_alerts(resolved_at, detected_at);
  `);

  if (!hasColumn(db, "dtus", "content_hash")) {
    try { db.exec(`ALTER TABLE dtus ADD COLUMN content_hash TEXT`); } catch { /* exists */ }
  }
  if (!hasColumn(db, "purchases", "stripe_payment_intent_id")) {
    try { db.exec(`ALTER TABLE purchases ADD COLUMN stripe_payment_intent_id TEXT`); } catch { /* exists */ }
  }
  if (!hasColumn(db, "purchases", "metadata_json")) {
    try { db.exec(`ALTER TABLE purchases ADD COLUMN metadata_json TEXT`); } catch { /* exists */ }
  }
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS drift_alerts;`);
  // ALTER DROP COLUMN omitted (SQLite limitation; columns are additive + nullable).
}
