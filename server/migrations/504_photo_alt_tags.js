// Photos lens (FIX-photos-006): alt text + tags on user_photos.
// The edit surface offered a single caption/title field; alt text (for
// screen readers) and tags (for organizing) had nowhere to live.
export function up(db) {
  const cols = db.prepare("PRAGMA table_info(user_photos)").all().map((c) => c.name);
  if (cols.length && !cols.includes("alt_text")) {
    db.exec("ALTER TABLE user_photos ADD COLUMN alt_text TEXT");
  }
  if (cols.length && !cols.includes("tags")) {
    db.exec("ALTER TABLE user_photos ADD COLUMN tags TEXT");
  }
}

export function down(db) {
  // SQLite cannot drop columns portably across versions; the columns are
  // additive and nullable, so down is a no-op by design.
}
