// server/migrations/496_photo_metadata.js
//
// Photos lens (F4, lens-reviews/photos.md): the detail view only ever had
// caption/upload-date/world/visibility/mint-status to show — dimensions,
// file type, size, and the original filename were never captured anywhere,
// so there was nothing honest to render for them. This adds the columns;
// `savePhoto` (server/lib/photo-gallery.js) now derives width/height from
// the PNG's own IHDR chunk and stores the upload's byte size + filename.
// Existing rows get NULL — the detail view shows "unknown" for those
// rather than fabricating a value, same as every other honest-degrade here.

export function up(db) {
  const cols = db.prepare(`PRAGMA table_info(user_photos)`).all().map((c) => c.name);
  if (!cols.includes("width")) {
    db.exec(`ALTER TABLE user_photos ADD COLUMN width INTEGER`);
  }
  if (!cols.includes("height")) {
    db.exec(`ALTER TABLE user_photos ADD COLUMN height INTEGER`);
  }
  if (!cols.includes("size_bytes")) {
    db.exec(`ALTER TABLE user_photos ADD COLUMN size_bytes INTEGER`);
  }
  if (!cols.includes("original_filename")) {
    db.exec(`ALTER TABLE user_photos ADD COLUMN original_filename TEXT`);
  }
}

export function down(db) {
  const cols = db.prepare(`PRAGMA table_info(user_photos)`).all().map((c) => c.name);
  if (cols.includes("original_filename")) db.exec(`ALTER TABLE user_photos DROP COLUMN original_filename`);
  if (cols.includes("size_bytes")) db.exec(`ALTER TABLE user_photos DROP COLUMN size_bytes`);
  if (cols.includes("height")) db.exec(`ALTER TABLE user_photos DROP COLUMN height`);
  if (cols.includes("width")) db.exec(`ALTER TABLE user_photos DROP COLUMN width`);
}
