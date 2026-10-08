// Photos lens: favorites + albums on top of user_photos (migration 243).
export function up(db) {
  const cols = db.prepare("PRAGMA table_info(user_photos)").all().map((c) => c.name);
  if (cols.length && !cols.includes("favorite")) {
    db.exec("ALTER TABLE user_photos ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS photo_albums (
      id         TEXT PRIMARY KEY,
      user_id    TEXT NOT NULL,
      name       TEXT NOT NULL,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_photo_albums_user ON photo_albums (user_id, created_at);
    CREATE TABLE IF NOT EXISTS photo_album_items (
      album_id TEXT NOT NULL,
      photo_id TEXT NOT NULL,
      added_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (album_id, photo_id)
    );
    CREATE INDEX IF NOT EXISTS idx_photo_album_items_photo ON photo_album_items (photo_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS photo_album_items;
    DROP TABLE IF EXISTS photo_albums;
  `);
}
