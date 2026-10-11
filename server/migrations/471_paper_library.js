// Per-user paper library. The in-memory paperLens map is wiped on process
// restart and the debounced lens-state snapshot can lag a save, so a paper
// added in the library was listed as zero papers after reload. This table is
// the synchronous source of truth for each owner's papers and collections.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS paper_library (
      user_id TEXT NOT NULL,
      kind TEXT NOT NULL,
      data_json TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      PRIMARY KEY (user_id, kind)
    );
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS paper_library;");
}
