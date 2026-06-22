// server/migrations/339_cognitive_fingerprint.js
//
// Cognitive Fingerprint (#5) — a time-series snapshot of a user's thinking style
// derived ENTIRELY from real activity (their DTUs, the domains they create in,
// how often their work is cited). No fabricated metrics. Snapshotted by the
// cognitive-fingerprint-cycle heartbeat; read via cognition.fingerprint[_history].
//
// Append-only; IF NOT EXISTS so re-runs are safe.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS cognitive_fingerprint (
      id                 TEXT PRIMARY KEY,
      user_id            TEXT NOT NULL,
      output             INTEGER NOT NULL DEFAULT 0,   -- DTUs authored
      domain_breadth     INTEGER NOT NULL DEFAULT 0,   -- distinct lenses worked in
      citation_influence INTEGER NOT NULL DEFAULT 0,   -- times their DTUs were cited
      avg_depth          REAL    NOT NULL DEFAULT 0,   -- mean CRETI of their DTUs
      dominant_domains   TEXT    NOT NULL DEFAULT '[]',-- top lenses by output
      style              TEXT,                          -- derived label
      computed_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_cogfp_user ON cognitive_fingerprint(user_id, computed_at DESC)`);
}
