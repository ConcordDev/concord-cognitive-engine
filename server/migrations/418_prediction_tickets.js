// Concord Predict — PredictionTicket substrate.
//
// A ticket is immutable at creation: forecast_distribution_json,
// feature_snapshot_json, and every other "what was known/believed at
// prediction time" column are written once by predict.create and never
// touched again. This is a temporal firewall against lookahead bias — a
// calibration or walk-forward report is only honest if it can prove the
// forecast it's grading was frozen before the outcome existed. Resolution
// (the actual outcome, once it happens) lives in a SEPARATE table so the
// two write paths can never collide at the row level.
export async function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS prediction_tickets (
      id TEXT PRIMARY KEY,
      created_at INTEGER NOT NULL,
      subject TEXT NOT NULL,
      event_definition TEXT NOT NULL,
      horizon_seconds INTEGER NOT NULL,
      target_variable TEXT,
      current_state_json TEXT,
      forecast_distribution_json TEXT NOT NULL,
      point_probability REAL,
      uncertainty_interval_json TEXT,
      confidence REAL,
      regime TEXT,
      feature_snapshot_json TEXT NOT NULL,
      historical_analogs_json TEXT,
      model_id TEXT NOT NULL,
      model_version TEXT,
      dataset_version TEXT,
      simulation_version TEXT,
      market_probability REAL,
      estimated_edge REAL,
      estimated_ev REAL,
      costs_json TEXT,
      decision TEXT,
      creator_id TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_pred_tickets_subject ON prediction_tickets(subject, created_at);
    CREATE INDEX IF NOT EXISTS idx_pred_tickets_model ON prediction_tickets(model_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_pred_tickets_regime ON prediction_tickets(regime);
    CREATE INDEX IF NOT EXISTS idx_pred_tickets_creator ON prediction_tickets(creator_id, created_at);

    CREATE TABLE IF NOT EXISTS prediction_outcomes (
      prediction_id TEXT PRIMARY KEY,
      resolved_at INTEGER NOT NULL,
      actual_value_json TEXT,
      actual_outcome TEXT,
      resolution_source TEXT,
      score_brier REAL,
      score_log_loss REAL
    );
    CREATE INDEX IF NOT EXISTS idx_pred_outcomes_resolved ON prediction_outcomes(resolved_at);
  `);
}

export async function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS prediction_outcomes;
    DROP TABLE IF EXISTS prediction_tickets;
  `);
}
