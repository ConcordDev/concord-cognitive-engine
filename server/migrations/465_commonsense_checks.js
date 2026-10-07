// One obvious check in the Commonsense thread survives a process restart.
// commonsenseLens.facts is an in-memory bag and is not on the shared
// lens-state key list. The row stores the question, a later finding,
// and a later exception. Confidence and a relation are not columns.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS commonsense_checks (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      question TEXT NOT NULL,
      finding TEXT NOT NULL DEFAULT '',
      exception TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_commonsense_checks_user
      ON commonsense_checks (user_id, created_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS commonsense_checks");
}
