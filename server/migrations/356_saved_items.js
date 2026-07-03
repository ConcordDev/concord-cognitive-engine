// server/migrations/356_saved_items.js
//
// "Quote & Clip DB" — durable persistence for the cross-lens saved-items
// substrate (domains/saved.js, parity vs X Bookmarks + Pocket). Previously the
// domain lived ENTIRELY in globalThis._concordSTATE.savedLens (two in-memory
// Maps), surviving only inside the generic whole-state JSON snapshot — never a
// real relational table. These tables back domains/saved.js so saved
// quotes/clips + their folders survive a restart, keyed per-user.
//
// Unlike the ar_* uniform-blob shape (mig 332), this is a real relational
// mirror of every publicItem field (queryable columns + indexes on the
// list/filter hot paths), PLUS three additive fields for the "Clip DB" ask:
//   clip_start_ms / clip_end_ms   nullable integer timecodes — a plain bookmark
//                                 has neither; an A/V clip specifies a range
//                                 (or clip_start_ms alone for a "starts-at" mark)
//   provenance_json               optional provenance stamp (P-A shape) proving
//                                 where a quote/clip actually came from; NULL for
//                                 a plain bookmark. Honestly passed through — the
//                                 domain never fabricates one.
//
// Forward-only; table-guarded (CREATE TABLE IF NOT EXISTS). Migrations are
// append-only. Existing in-memory saved data is ephemeral (it never durably
// shipped), so no data-migration is needed — the table starts empty.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_items (
      id              TEXT PRIMARY KEY,
      user_id         TEXT NOT NULL,
      kind            TEXT NOT NULL,
      ref_id          TEXT,
      title           TEXT,
      url             TEXT,
      author          TEXT,
      excerpt         TEXT,
      media_type      TEXT,
      folder_id       TEXT,
      tags_json       TEXT NOT NULL DEFAULT '[]',
      note            TEXT NOT NULL DEFAULT '',
      state           TEXT NOT NULL DEFAULT 'unread',
      source_lens     TEXT,
      clip_start_ms   INTEGER,
      clip_end_ms     INTEGER,
      provenance_json TEXT,
      saved_at        TEXT,
      updated_at      TEXT,
      read_at         TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_saved_items_user        ON saved_items(user_id);
    CREATE INDEX IF NOT EXISTS idx_saved_items_user_folder ON saved_items(user_id, folder_id);

    CREATE TABLE IF NOT EXISTS saved_folders (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      color       TEXT,
      description TEXT,
      created_at  TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_saved_folders_user ON saved_folders(user_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_saved_folders_user;
    DROP TABLE IF EXISTS saved_folders;
    DROP INDEX IF EXISTS idx_saved_items_user_folder;
    DROP INDEX IF EXISTS idx_saved_items_user;
    DROP TABLE IF EXISTS saved_items;
  `);
}
