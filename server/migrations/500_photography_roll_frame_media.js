// server/migrations/500_photography_roll_frame_media.js
//
// photography_roll_frames previously stored only a typed filename — no
// binary ever transferred (lens-reviews/photography.md F2). This adds the
// columns a real upload produces: the media DTU id it was stored under
// (so a thumbnail and the original bytes are reachable via
// /api/media/:id/...), and the mimeType + fileSize the upload route
// itself measured. All columns are nullable so existing typed-filename
// rows (and any caller that still only sends a filename) keep working.

export function up(db) {
  const cols = db.prepare("PRAGMA table_info(photography_roll_frames)").all().map((c) => c.name);
  if (!cols.includes("media_id")) db.exec("ALTER TABLE photography_roll_frames ADD COLUMN media_id TEXT");
  if (!cols.includes("mime_type")) db.exec("ALTER TABLE photography_roll_frames ADD COLUMN mime_type TEXT");
  if (!cols.includes("file_size")) db.exec("ALTER TABLE photography_roll_frames ADD COLUMN file_size INTEGER");
}

export function down(db) {
  // SQLite ALTER TABLE DROP COLUMN requires a recent version; rebuild instead.
  db.exec(`
    CREATE TABLE IF NOT EXISTS photography_roll_frames_pre496 (
      id TEXT PRIMARY KEY,
      roll_id TEXT NOT NULL,
      user_id TEXT NOT NULL,
      filename TEXT NOT NULL,
      created_at TEXT NOT NULL
    );
    INSERT INTO photography_roll_frames_pre496 (id, roll_id, user_id, filename, created_at)
      SELECT id, roll_id, user_id, filename, created_at FROM photography_roll_frames;
    DROP TABLE photography_roll_frames;
    ALTER TABLE photography_roll_frames_pre496 RENAME TO photography_roll_frames;
    CREATE INDEX IF NOT EXISTS idx_photography_roll_frames_roll
      ON photography_roll_frames (roll_id, created_at);
  `);
}
