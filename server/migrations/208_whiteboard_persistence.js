// server/migrations/208_whiteboard_persistence.js
//
// Whiteboard Sprint A — Item #1: real DB persistence.
//
// Today boards live in `globalThis._concordSTATE.whiteboardLens` only;
// they die on server restart. This migration lands the substrate so
// boards survive: a board row + a per-edit delta log enabling time
// travel + a participant table for role-based permissions (Sprint B
// uses these roles) + comments + per-board images.
//
// `whiteboard_scene_deltas` is append-only. Cursor moves stay
// ephemeral (socket-only) — only element-level changes hit this table.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS whiteboard_boards (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL,
      title       TEXT NOT NULL DEFAULT 'Untitled board',
      kind        TEXT NOT NULL DEFAULT 'private'
                  CHECK (kind IN ('private','shared','template','published')),
      scene_json  TEXT,                              -- latest scene snapshot (denormalised for fast load)
      width       INTEGER,
      height      INTEGER,
      meta_json   TEXT,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_wb_boards_owner ON whiteboard_boards(owner_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wb_boards_kind  ON whiteboard_boards(kind, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS whiteboard_scene_deltas (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      board_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      delta_kind  TEXT NOT NULL
                  CHECK (delta_kind IN ('element_add','element_update','element_delete',
                                        'scene_replace','snapshot','restore')),
      delta_json  TEXT NOT NULL,
      server_ts   INTEGER NOT NULL DEFAULT (unixepoch()),
      client_ts   INTEGER,
      FOREIGN KEY (board_id) REFERENCES whiteboard_boards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wb_deltas_board ON whiteboard_scene_deltas(board_id, server_ts);
    CREATE INDEX IF NOT EXISTS idx_wb_deltas_user  ON whiteboard_scene_deltas(user_id, server_ts DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS whiteboard_participants (
      board_id    TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      role        TEXT NOT NULL DEFAULT 'editor'
                  CHECK (role IN ('owner','admin','editor','commenter','viewer')),
      invited_by  TEXT,
      invited_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (board_id, user_id),
      FOREIGN KEY (board_id) REFERENCES whiteboard_boards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wb_parts_user ON whiteboard_participants(user_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS whiteboard_comments (
      id            TEXT PRIMARY KEY,
      board_id      TEXT NOT NULL,
      element_id    TEXT,                              -- nullable for board-level comments
      thread_id     TEXT,                              -- self = root; otherwise refs another comment id
      author_id     TEXT NOT NULL,
      body          TEXT NOT NULL,
      reactions_json TEXT NOT NULL DEFAULT '{}',       -- { emoji: [userId, …] }
      resolved      INTEGER NOT NULL DEFAULT 0,
      resolved_by   TEXT,
      created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (board_id) REFERENCES whiteboard_boards(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_wb_comments_board   ON whiteboard_comments(board_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_wb_comments_element ON whiteboard_comments(board_id, element_id);
    CREATE INDEX IF NOT EXISTS idx_wb_comments_thread  ON whiteboard_comments(thread_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS whiteboard_images (
      id          TEXT PRIMARY KEY,
      owner_id    TEXT NOT NULL,
      board_id    TEXT,                                -- nullable so an image can outlive its board
      path        TEXT NOT NULL,                       -- relative to data/whiteboard-images/
      mime        TEXT,
      bytes       INTEGER,
      dtu_id      TEXT,                                -- kind='whiteboard_image' DTU id
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_wb_images_owner ON whiteboard_images(owner_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_wb_images_board ON whiteboard_images(board_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS whiteboard_images;
    DROP TABLE IF EXISTS whiteboard_comments;
    DROP TABLE IF EXISTS whiteboard_participants;
    DROP TABLE IF EXISTS whiteboard_scene_deltas;
    DROP TABLE IF EXISTS whiteboard_boards;
  `);
}
