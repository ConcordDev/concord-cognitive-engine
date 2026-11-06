// server/migrations/498_player_mail_sender_deleted.js
//
// Mail full build (F-B row 10), S4/F5 — a sent copy can be removed from
// the sender's Sent list. Player mail is ONE row read from both sides,
// so a hard delete would take the recipient's copy with it; the removal
// is sender-local instead: sender_deleted_at stamps when the sender
// removed their copy, listSent filters stamped rows out, and the row
// (plus the recipient's inbox copy and any claim record) is untouched.

export function up(db) {
  const cols = db.prepare(`PRAGMA table_info(player_mail)`).all().map((c) => c.name);
  if (!cols.includes("sender_deleted_at")) {
    db.exec(`ALTER TABLE player_mail ADD COLUMN sender_deleted_at INTEGER`);
  }
}

export function down(db) {
  // SQLite column drops need a table rebuild; the column is inert when
  // unused (listSent simply stops filtering on it), so down is a no-op.
}
