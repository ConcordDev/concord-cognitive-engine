// Concord Predict — authority-stage tracking (P6/P7 of the Concord Predict
// x Dila integration).
//
// This table records ONLY the evidence-derived STAGE a model has reached in
// the capability-promotion lifecycle (IDEA -> SHADOW -> TESTED -> VALIDATED
// -> PROMOTED), plus which stage was last seen (so the P7 research-cycle
// heartbeat can detect a TRANSITION and record a durable DTU finding only
// on change, not every tick). It is bookkeeping/audit trail only.
//
// Hard invariant, load-bearing: nothing in this table, and no macro that
// writes to it, can grant real trading authority. Concord Predict has no
// execution channel into any trading system — there is no code path from a
// row here to an order being placed. `stage = 'PROMOTED'` means "an
// operator explicitly recorded that this model cleared the VALIDATED bar,"
// not "this model may now trade." See domains/predict.js's
// predict.authorityStatus / predict.promoteAuthority for the enforcement.
export async function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS predict_authority_state (
      model_id TEXT PRIMARY KEY,
      stage TEXT NOT NULL DEFAULT 'IDEA',
      n INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      last_dtu_id TEXT,
      promoted_by TEXT,
      promoted_at INTEGER,
      promotion_note TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_predict_authority_stage ON predict_authority_state(stage);
  `);
}

export async function down(db) {
  db.exec(`DROP TABLE IF EXISTS predict_authority_state;`);
}
