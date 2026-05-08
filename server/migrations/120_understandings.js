// Migration 120 — Understandings.
//
// First-class storage for understanding artifacts produced by
// `server/lib/understanding-engine.js`. An "understanding" is a
// structured model of a subject (DTU, claim list, raw text) with
// extracted entities, claims, relations, constraints, plus the results
// of running consistency / contradiction / gap / prediction passes
// over the model.
//
// Distinct from `dtus` (which stores the input/output content) and
// `forward_predictions` (which stores per-user speculative beliefs).
// Understandings are the "I built a model of this" output that any
// lens can consume to answer downstream questions.
//
// Schema:
//   - id PK; individual understandings are addressable for re-runs.
//   - subject_id is optional — null for raw-claim understandings, set
//     when the model was built from a DTU. No FK because subjects can
//     also be ad-hoc (entity ids, world ids, faction ids).
//   - subject_kind: 'dtu' | 'claims' | 'raw' | 'entity' | 'world' | 'faction'
//   - model_json: the full extracted model (entities, claims, relations,
//     constraints) as JSON.
//   - consistency: 'consistent' | 'inconsistent' | 'partial' | 'unknown'.
//     Persisted as a top-level column for fast filtering ("show me all
//     understandings flagged inconsistent").
//   - contradictions_json: array of { a, b, reason } pairs.
//   - gaps_json: array of { constraintId, why } — stated-but-unsatisfied.
//   - predictions_json: model-implied predictions (separate from the
//     forward-sim cycle which produces user-bound predictions).
//   - confidence: 0..1, derived from claim-coverage / contradiction count.
//   - composer: 'deterministic' | 'hlr' | 'llm'.
//   - composed_at + recomposed_at: lifecycle.
//   - expires_at: TTL — understandings restale when underlying DTUs change.
//
// Indexes:
//   - idx_understandings_subject: per-subject lookup
//   - idx_understandings_consistency_composed: dashboard queries
//   - idx_understandings_expires: GC sweep

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS understandings (
      id                   TEXT PRIMARY KEY,
      subject_id           TEXT,
      subject_kind         TEXT NOT NULL
                           CHECK (subject_kind IN ('dtu','claims','raw','entity','world','faction')),
      model_json           TEXT NOT NULL,
      consistency          TEXT NOT NULL DEFAULT 'unknown'
                           CHECK (consistency IN ('consistent','inconsistent','partial','unknown')),
      contradictions_json  TEXT NOT NULL DEFAULT '[]',
      gaps_json            TEXT NOT NULL DEFAULT '[]',
      predictions_json     TEXT NOT NULL DEFAULT '[]',
      confidence           REAL NOT NULL DEFAULT 0.5
                           CHECK (confidence >= 0 AND confidence <= 1),
      composer             TEXT NOT NULL DEFAULT 'deterministic'
                           CHECK (composer IN ('deterministic','hlr','llm')),
      composed_at          TEXT NOT NULL DEFAULT (datetime('now')),
      recomposed_at        TEXT,
      expires_at           TEXT NOT NULL DEFAULT (datetime('now', '+30 days'))
    );

    CREATE INDEX IF NOT EXISTS idx_understandings_subject
      ON understandings (subject_kind, subject_id, composed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_understandings_consistency_composed
      ON understandings (consistency, composed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_understandings_expires
      ON understandings (expires_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_understandings_expires;
    DROP INDEX IF EXISTS idx_understandings_consistency_composed;
    DROP INDEX IF EXISTS idx_understandings_subject;
    DROP TABLE IF EXISTS understandings;
  `);
}
