// server/migrations/362_law_enforcement_cases.js
//
// Durable persistence for a genuine "Case" entity in the law-enforcement
// lens (domains/lawenforcement.js, RMS/CAD parity vs Tyler Technologies /
// CentralSquare). Previously NO persisted Case record type existed at all:
// `caseAnalysis` is a pure-compute case-strength calculator over
// caller-supplied evidence/witness/suspect counts (never writes anything),
// and the closest persisted case-adjacent records were `reportDraft`/
// `reportList` (narrative reports carrying a free-text `caseNumber` field)
// and `bookingCreate` (arrest/field-interview records with `charges[]`).
// The "Case ID" field in the frontend's Quick Analysis form was pure free
// text with nothing behind it. Tracked as an open ENGINEERING gap in
// docs/lens-specs/law-enforcement-capability-map.md ("No persisted 'Case'
// record type exists server-side") and docs/WAVE4_INVENTORY.md's
// `| law-enforcement |` row.
//
// This table gives cases a real status lifecycle (open ->
// under_investigation -> closed/cold, with reopen), an assigned-detective
// field, and — per this codebase's established loosely-coupled-domain
// convention (see migration 360's bracket_tournaments header) — linkage to
// existing reports/evidence/bookings by matching the free-text
// `case_number` string rather than a foreign key. A relational join table
// was considered and rejected: reports/evidence/bookings in this domain
// are NOT DB-backed (they live in per-user in-memory Maps under
// globalThis._concordSTATE._lawEnforcement — see the header comment of
// domains/lawenforcement.js), so there is no row on the DB side for a
// foreign key to reference in the first place. A string-match join
// (case-insensitive, trimmed) performed in `caseLinked` at read time is
// the only option that actually works across that boundary, and it
// matches how loosely this codebase's domains already couple to each
// other (e.g. warrants/reports/bookings all carry a free-text caseNumber
// today with no relational enforcement between them either).
//
// Persistence follows the db-or-memory facade pattern (domains/
// tournaments.js mig 360, domains/saved.js mig 356, domains/ar.js mig
// 332): reached via ctx.db when present (the running server always has
// it, so cases survive a restart), falling back to an in-memory
// globalThis._concordSTATE._lawEnforcement.cases Map for bare-unit-test/
// minimal builds — the same bucket-Map shape every other collection in
// this domain (calls/units/evidence/officers/warrants/reports/bookings)
// already uses.
//
// Append-only per CLAUDE.md migration invariant.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS le_cases (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL,
        -- creating officer/detective; matches this domain's actorId(ctx)
        -- ownership convention used by every other bucket in the file.
      case_number         TEXT NOT NULL,
        -- normalized (trimmed + uppercased) join key against reportDraft /
        -- evidenceIntake / bookingCreate's free-text caseNumber field.
      title               TEXT NOT NULL,
      synopsis            TEXT NOT NULL DEFAULT '',
      status              TEXT NOT NULL DEFAULT 'open',
        -- open | under_investigation | closed | cold
      assigned_detective  TEXT NOT NULL DEFAULT '',
      opened_at           TEXT NOT NULL,
      closed_at           TEXT,
      closure_reason      TEXT,
      created_at          TEXT NOT NULL,
      updated_at          TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_le_cases_user_status
      ON le_cases(user_id, status);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_le_cases_user_case_number
      ON le_cases(user_id, case_number);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_le_cases_user_case_number;
    DROP INDEX IF EXISTS idx_le_cases_user_status;
    DROP TABLE IF EXISTS le_cases;
  `);
}
