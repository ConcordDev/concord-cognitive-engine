// Migration 121 — Understanding evolution columns.
//
// Adds the compounding-loop state to `understandings`. Migration 120
// shipped the artifact; this migration wires the "mind over time
// develops" loop.
//
// Loop shape (mirrors the Evo asset scheduler at server/lib/evo-asset/):
//
//   compose      → status='candidate', generation=0
//   evidence in  → evidence_count++ or contradiction_count++,
//                  last_evidence_at=now
//   evaluate     → promote (status='promoted', promoted_at=now,
//                  generation++) | dispute (status='disputed') | hold
//   consolidate  → multiple related understandings collapse into a
//                  meta-understanding; children get consolidated_into_id
//                  pointing at the parent
//   recompose    → new row with parent_understanding_id pointing back,
//                  generation = parent.generation + 1
//
// Columns:
//   - generation:         compounding depth (0 = initial compose)
//   - evidence_count:     claims confirming this understanding
//   - contradiction_count: claims contradicting this understanding
//   - status:             candidate | promoted | disputed | archived
//   - parent_understanding_id: lineage pointer (this understanding
//                              supersedes / refines the parent)
//   - consolidated_into_id: when N children compound into a meta-
//                           understanding, each child points at the parent
//   - composer_user_id:   the user (or NPC author) who triggered this
//                         compose; closes the royalty loop — citations
//                         of an understanding pay this user
//   - promoted_at, last_evidence_at: lifecycle timestamps

export function up(db) {
  // SQLite ALTER TABLE ADD COLUMN doesn't take CHECK; we set defaults
  // and rely on application-level enforcement of the status enum.
  // The status CHECK from the original `consistency` column on the
  // table stays intact (different column).
  db.exec(`
    ALTER TABLE understandings ADD COLUMN generation INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE understandings ADD COLUMN evidence_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE understandings ADD COLUMN contradiction_count INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE understandings ADD COLUMN status TEXT NOT NULL DEFAULT 'candidate';
    ALTER TABLE understandings ADD COLUMN parent_understanding_id TEXT;
    ALTER TABLE understandings ADD COLUMN consolidated_into_id TEXT;
    ALTER TABLE understandings ADD COLUMN composer_user_id TEXT;
    ALTER TABLE understandings ADD COLUMN promoted_at TEXT;
    ALTER TABLE understandings ADD COLUMN last_evidence_at TEXT;

    CREATE INDEX IF NOT EXISTS idx_understandings_status
      ON understandings (status, composed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_understandings_lineage
      ON understandings (parent_understanding_id);

    CREATE INDEX IF NOT EXISTS idx_understandings_composer
      ON understandings (composer_user_id, composed_at DESC);

    CREATE INDEX IF NOT EXISTS idx_understandings_consolidated
      ON understandings (consolidated_into_id);
  `);
}

export function down(db) {
  // SQLite doesn't support DROP COLUMN before 3.35; this migration is
  // append-only by convention, and the dropped indexes are harmless on
  // old DBs. Index drops are safe.
  db.exec(`
    DROP INDEX IF EXISTS idx_understandings_consolidated;
    DROP INDEX IF EXISTS idx_understandings_composer;
    DROP INDEX IF EXISTS idx_understandings_lineage;
    DROP INDEX IF EXISTS idx_understandings_status;
  `);
}
