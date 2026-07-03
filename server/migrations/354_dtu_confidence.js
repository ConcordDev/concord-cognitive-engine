// server/migrations/354_dtu_confidence.js
//
// Persistent, revisable DTU confidence/truth-value tracking.
//
// Concord's `confidence` fields elsewhere in the substrate are one-time
// creation-time snapshots — never updated by later evidence. This table adds
// a real (if intentionally simplified — see server/lib/dtu-confidence.js
// header comment) belief layer that moves as real events happen to a DTU:
// a successful citation registration nudges it up, a drift-monitor
// UNEXPLAINED contradiction (server/emergent/drift-monitor.js) nudges it
// down, and time blends a stale score back toward honest-neutral at read
// time using the SAME exponential age-decay shape already used by
// server/emergent/forgetting-engine.js#retentionScore (not reinvented here).
//
// This is a SEPARATE, additive layer — like migration 352's causal-edge
// table, it never touches royalty_lineage/dtu_citations/economy tables and
// carries zero royalty/citation meaning by construction.
//
//   dtu_id           PK — the DTU this confidence row tracks
//   score            [0,1] — current belief; DEFAULT 0.5 is only ever a
//                     placeholder row value, never surfaced as "known" (see
//                     getConfidence's honest-unknown shape — no row at all
//                     means unknown, not neutral)
//   evidence_count    total number of updateConfidence calls folded in so far
//   last_updated      unix ms — when the score was last nudged; also the
//                     anchor for the lazy read-time decay blend
//
// Forward-only; table-guarded. Migrations are append-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dtu_confidence (
      dtu_id TEXT PRIMARY KEY,
      score REAL NOT NULL DEFAULT 0.5 CHECK(score >= 0 AND score <= 1),
      evidence_count INTEGER NOT NULL DEFAULT 0,
      last_updated INTEGER NOT NULL
    );
  `);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS dtu_confidence;`);
}
