// server/migrations/055_arena_queue.js
// Persistent arena matchmaking queue — survives server restarts.
// One row per queued player; cleared when match is found or player leaves.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS arena_queue (
      user_id    TEXT PRIMARY KEY,
      rating     INTEGER NOT NULL DEFAULT 1200,
      queued_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      socket_id  TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_arena_queue_rating ON arena_queue(rating);
    CREATE INDEX IF NOT EXISTS idx_arena_queue_time   ON arena_queue(queued_at);
  `);
}
