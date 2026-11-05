// The Maker lens's Bench used to read/write through app-maker's project
// store (POST /api/lens/run { domain:"app-maker", name:"projectCreate" }),
// which has no lens scoping at all: it is one user-wide app-builder project
// list, so a make shows up next to (and is indistinguishable from) every
// app-maker project the same user ever built. That is the review's F5
// (unscoped-shared-store-rendering) and the reason F2/F3 (no real make
// model, no edit/rename/delete) could not be built on top of it honestly.
//
// This table is Maker's own store: one row per make, owned by the lens.
// `spec` is free-text (the review's floor for F2 is "spec plus one body
// field" — not full Crafting field-for-field parity), so a make in this
// table can never be confused with an app-maker project again.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS maker_pieces (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      spec TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_maker_pieces_user ON maker_pieces(user_id, updated_at DESC);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS maker_pieces;");
}
