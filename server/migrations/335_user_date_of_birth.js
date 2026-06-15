// server/migrations/335_user_date_of_birth.js
//
// Age gate (18+). Concordia contains mature/violent content, so registration
// requires the user to attest to a date of birth and be at least 18. Storing
// the DOB is the legal-defensibility record ("the user attested to being an
// adult at signup"). Existing users are NULL (pre-gate); the gate applies to
// new registrations only.
//
//   users.date_of_birth   TEXT (ISO yyyy-mm-dd) — attested at signup, nullable
//
// Forward-only, column-existence guarded.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='users'").get()) return;
  if (!columnExists(db, "users", "date_of_birth")) {
    try { db.exec("ALTER TABLE users ADD COLUMN date_of_birth TEXT"); } catch { /* noop */ }
  }
}
