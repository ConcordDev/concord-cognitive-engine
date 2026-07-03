// server/migrations/353_dtu_review_schedule.js
//
// SM-2-inspired (SuperMemo/Anki-style spaced-repetition) SCHEDULING layer for
// the DTU forgetting engine (server/emergent/forgetting-engine.js). This does
// NOT replace or duplicate the engine's real Ebbinghaus-style retentionScore
// decay math — it only records WHEN each DTU should next be re-scored, and
// how that review interval should expand/contract based on the outcome.
//
//   dtu_id            PK — the DTU this schedule row tracks
//   ease_factor       SM-2 canonical starting value 2.5; grows/shrinks by
//                      small deltas within SM-2's canonical [1.3, 3.0] band
//   interval_days     SM-2 canonical starting value 1; multiplies by
//                      ease_factor on a successful review, resets to a short
//                      relearn interval on a failed one
//   next_review_due   unix ms — when this DTU is next eligible for review
//   last_reviewed_at  unix ms — null until the first review runs
//   review_count      total number of completed review passes
//
// Forward-only; table-guarded. Migrations are append-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_review_schedule (
      dtu_id TEXT PRIMARY KEY,
      ease_factor REAL NOT NULL DEFAULT 2.5,
      interval_days REAL NOT NULL DEFAULT 1,
      next_review_due INTEGER NOT NULL,
      last_reviewed_at INTEGER,
      review_count INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_review_schedule_due ON dtu_review_schedule(next_review_due);
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS dtu_review_schedule;`);
}
