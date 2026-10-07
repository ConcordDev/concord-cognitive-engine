// The one alert in front of an operator survives a process restart.
// commandCenterLens is an in-memory bag and is not on the shared
// lens-state key list. The row stores the title, the line, the status,
// and the acknowledgement note. Severity and a roster are not columns.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS command_center_alerts (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      line TEXT NOT NULL,
      status TEXT NOT NULL,
      ack_note TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_command_center_alerts_user
      ON command_center_alerts (user_id, created_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS command_center_alerts");
}
