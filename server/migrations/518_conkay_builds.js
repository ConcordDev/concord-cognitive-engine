// ConKay "build anything" (2026-11-26): a build is a brief Kay planned into a
// design graph that every applicable solver checked. The row keeps the brief,
// the person's answers, the planned IR (so it reopens and re-runs exactly) and
// the last report (checked / computed / gaps, in the person's units).

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conkay_builds (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      brief       TEXT NOT NULL,
      answers_json TEXT NOT NULL DEFAULT '[]',
      plan_json   TEXT,
      report_json TEXT,
      status      TEXT NOT NULL DEFAULT 'planned',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_conkay_builds_user ON conkay_builds(user_id, updated_at DESC);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS conkay_builds");
}
