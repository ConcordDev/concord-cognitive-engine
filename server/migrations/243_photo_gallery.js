// server/migrations/243_photo_gallery.js
//
// Phase BE1 — photo gallery persistence.
//
// PhotoMode.tsx already ships freecam-less PNG export to disk. This
// adds backend storage so screenshots can be shared. Mints a
// kind='photo' DTU on share so the royalty cascade fires when the
// photo is cited.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_photos (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      world_id      TEXT,
      taken_at      INTEGER NOT NULL DEFAULT (unixepoch()),
      caption       TEXT,
      dtu_id        TEXT,
      blob_path     TEXT NOT NULL,
      visibility    TEXT NOT NULL DEFAULT 'private'
                      CHECK (visibility IN ('private','friends','public'))
    );
    CREATE INDEX IF NOT EXISTS idx_user_photos_user
      ON user_photos(user_id, taken_at DESC);
    CREATE INDEX IF NOT EXISTS idx_user_photos_world_public
      ON user_photos(world_id, visibility, taken_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_user_photos_world_public;
    DROP INDEX IF EXISTS idx_user_photos_user;
    DROP TABLE IF EXISTS user_photos;
  `);
}
