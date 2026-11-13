// Migration 503 — FIX-mail-016: player-mail replies thread under their
// original. A reply stores the id of the mail it answers in parent_id;
// the folder list nests replies under the original and the detail pane
// shows the thread. A plain ADD COLUMN (the 499 pattern) — no CHECK or
// shape change to existing columns, and rows written before this
// migration simply carry NULL (they are thread roots).

export function up(db) {
  const cols = db.prepare(`PRAGMA table_info(player_mail)`).all().map((c) => c.name);
  if (cols.length && !cols.includes("parent_id")) {
    db.exec(`ALTER TABLE player_mail ADD COLUMN parent_id TEXT`);
  }
}

export function down(_db) {
  // No-op — the column is inert when unused.
}
