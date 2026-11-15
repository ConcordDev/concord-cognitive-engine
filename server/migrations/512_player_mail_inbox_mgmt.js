// server/migrations/512_player_mail_inbox_mgmt.js
//
// Renumbered from 504: it collided with 504_photo_alt_tags.js, and
// schema_version.version is a PRIMARY KEY, so the migrator refuses
// duplicate versions. Every column add below is guarded by a
// table_info check, so re-applying it on a DB that already ran it
// under 504 is a no-op.
//
// FIX-mail-013: received mail had no inbox management at all — the only
// action on an inbox row was saving it as a DTU. Standard management
// (star, archive, mark-unread, trash) is recipient-local state on the
// same single row the sender reads from the other side, exactly like
// 499's sender_deleted_at: three nullable stamps the recipient owns.
// listInbox filters trashed rows out everywhere and archived rows out
// of the default inbox view; the sender's copy is never touched.

export function up(db) {
  const cols = db.prepare(`PRAGMA table_info(player_mail)`).all().map((c) => c.name);
  if (!cols.includes("recipient_deleted_at")) {
    db.exec(`ALTER TABLE player_mail ADD COLUMN recipient_deleted_at INTEGER`);
  }
  if (!cols.includes("starred_at")) {
    db.exec(`ALTER TABLE player_mail ADD COLUMN starred_at INTEGER`);
  }
  if (!cols.includes("archived_at")) {
    db.exec(`ALTER TABLE player_mail ADD COLUMN archived_at INTEGER`);
  }
}

export function down(db) {
  // SQLite column drops need a table rebuild; the columns are inert
  // when unused (listInbox simply stops filtering on them), so down
  // is a no-op (499's precedent).
}
