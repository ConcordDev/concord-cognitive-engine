// A link opened on the Concord Link Frontier survives a process restart.
// The feed and the royalty window are read-only and are not this row.
// The row stores the name, a later bearing, and a later mark.
// A world, a cost, and a royalty amount are not columns.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS concord_link_frontier_links (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      bearing TEXT NOT NULL DEFAULT '',
      mark TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_concord_link_frontier_links_user
      ON concord_link_frontier_links (user_id, created_at);
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS concord_link_frontier_links");
}
