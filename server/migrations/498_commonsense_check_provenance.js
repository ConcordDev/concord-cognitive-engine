// S-CS-2 / S-CS-3 (Commonsense build): a finding can be disputed by
// its own author, and each field of a check carries the date it was
// stated. Three additive columns on commonsense_checks: flagged (the
// dispute state on the finding), finding_at, exception_at. Rows
// written before this migration read NULL for the dates; the surface
// falls back to updated_at for those, and flagged defaults to 0.

export function up(db) {
  db.exec(`
    ALTER TABLE commonsense_checks ADD COLUMN flagged INTEGER NOT NULL DEFAULT 0;
    ALTER TABLE commonsense_checks ADD COLUMN finding_at TEXT;
    ALTER TABLE commonsense_checks ADD COLUMN exception_at TEXT;
  `);
}

export function down(db) {
  // Additive columns only; SQLite column drops are not portable across
  // the fleet's versions, and the columns are inert when unused.
  // No-op by design.
}
