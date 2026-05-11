// server/migrations/169_event_timeline.js
//
// Unified event timeline — sprint 8.
//
// The audit found ~531 socket emit calls across server, ~145 unique
// channels, but only ~35-40 reach UI. ~70% of channels never become
// player-visible. This sprint persists every emit to an append-only
// timeline so the new /lenses/timeline lens can show the full firehose
// with filter chips.
//
// Append-only by design. TTL prune is a downstream concern (heartbeat
// will sweep > 30 days of rows). Indexes optimise for the "show me
// recent activity for this world filtered by channel" read path the
// lens uses.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS event_timeline_log (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel    TEXT    NOT NULL,
      world_id   TEXT,
      actor_kind TEXT,
      actor_id   TEXT,
      payload_json TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_timeline_created ON event_timeline_log(created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_timeline_channel ON event_timeline_log(channel, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_timeline_world ON event_timeline_log(world_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_timeline_actor ON event_timeline_log(actor_kind, actor_id, created_at DESC)`);
}

export function down(db) {
  db.exec(`DROP TABLE IF EXISTS event_timeline_log`);
}
