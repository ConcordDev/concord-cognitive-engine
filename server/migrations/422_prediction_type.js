// server/migrations/422_prediction_type.js
//
// Wave 9 (2026-08-31): Phase 4 — Fix forward_predictions schema gap.
//
// Hermes audit identified: "Prediction layer. no such column: prediction_type —
// somebody migrated the schema and didn't update forward_sim."
//
// The forward_sim engine writes 'prediction_type' but the table never had that
// column. Add it (nullable, indexed for retrieval by type).
//
export function up(db) {
  const stmts = [
    `ALTER TABLE forward_predictions ADD COLUMN prediction_type TEXT`,
    `CREATE INDEX IF NOT EXISTS idx_predictions_type ON forward_predictions(prediction_type, composed_at DESC)`,
  ];
  for (const sql of stmts) {
    try { db.prepare(sql).run(); }
    catch (e) {
      if (!e?.message?.includes("already exists") && !e?.message?.includes("duplicate column")) {
        console.warn(`[422] ${sql.slice(0, 60)}...: ${e?.message}`);
      }
    }
  }
}