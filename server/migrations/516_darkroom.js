// Photos becomes the Darkroom: a real photo editor on the user_photos store.
//
// user_photos gains the edit (a non-destructive develop recipe — the
// original file is never rewritten), the catalog fields a photographer
// culls with (rating, pick/reject flag, colour label), the camera facts
// read from the file's EXIF, the capture time, where the photo came from
// (an import, or Concordia's in-game photo mode), and its derived preview
// and thumbnail files. Edit history and named snapshots, develop presets,
// smart albums (a saved filter) and photo releases (free or sold in CC,
// with the buyers who own each) get their own tables.

const cols = (db, t) => db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);

export function up(db) {
  const have = cols(db, "user_photos");
  if (have.length) {
    const add = (name, ddl) => { if (!have.includes(name)) db.exec(`ALTER TABLE user_photos ADD COLUMN ${name} ${ddl}`); };
    add("edit_json", "TEXT");
    add("edited_at", "INTEGER");
    add("rating", "INTEGER NOT NULL DEFAULT 0");
    add("flag", "TEXT NOT NULL DEFAULT 'none'");
    add("color_label", "TEXT");
    add("exif_json", "TEXT");
    add("captured_at", "INTEGER");
    add("source", "TEXT NOT NULL DEFAULT 'import'");
    add("preview_path", "TEXT");
    add("thumb_path", "TEXT");
    add("mime", "TEXT");
    db.exec("UPDATE user_photos SET source = 'concordia' WHERE world_id IS NOT NULL AND source = 'import'");
    db.exec("CREATE INDEX IF NOT EXISTS idx_user_photos_user_rating ON user_photos(user_id, rating)");
  }
  const albums = cols(db, "photo_albums");
  if (albums.length && !albums.includes("rule_json")) db.exec("ALTER TABLE photo_albums ADD COLUMN rule_json TEXT");

  db.exec(`
    CREATE TABLE IF NOT EXISTS photo_edit_history (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      photo_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      label       TEXT NOT NULL,
      snapshot    INTEGER NOT NULL DEFAULT 0,
      edit_json   TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_photo_edit_history_photo ON photo_edit_history(photo_id, id);

    CREATE TABLE IF NOT EXISTS photo_presets (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      edit_json   TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_photo_presets_user ON photo_presets(user_id, created_at);

    CREATE TABLE IF NOT EXISTS photo_releases (
      id           TEXT PRIMARY KEY,
      photo_id     TEXT NOT NULL,
      user_id      TEXT NOT NULL,
      title        TEXT NOT NULL,
      description  TEXT,
      price_cc     REAL NOT NULL DEFAULT 0,
      long_edge    INTEGER NOT NULL DEFAULT 0,
      format       TEXT NOT NULL DEFAULT 'jpeg',
      edit_json    TEXT NOT NULL,
      width        INTEGER,
      height       INTEGER,
      dtu_id       TEXT,
      status       TEXT NOT NULL DEFAULT 'published',
      published_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_at   INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_photo_releases_status ON photo_releases(status, published_at);
    CREATE INDEX IF NOT EXISTS idx_photo_releases_user ON photo_releases(user_id);

    CREATE TABLE IF NOT EXISTS photo_release_owners (
      release_id  TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      price_cc    REAL NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (release_id, user_id)
    );
  `);
}

export function down() {
  // Additive columns and new tables; nothing to undo safely.
}
