// An opened room survives a process restart. collabLens.rooms is an
// in-memory Map and is not on the shared lens-state key list. The row
// stores the title and the selected note. Participants and a live
// roster are not columns.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS collab_rooms (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      title TEXT NOT NULL,
      note TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_collab_rooms_user
      ON collab_rooms (user_id, created_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS collab_rooms");
}
