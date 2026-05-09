// Migration 145 — Theme 3 (game-feel pass): signal-propagation indexes.
//
// The new server/lib/embodied/signal-propagation.js heartbeat reads
// `embodied_signal_log` by (world_id, channel, expires/decay) for hot-cell
// pre-filtering. Without an index it would scan the whole table every
// 45s per world. The composite below makes that lookup O(log n) and is
// also useful for the spatial cell-window read path that signals.js
// already uses.
//
// Append-only. No data changes.

export function up(db) {
  db.exec(`
    CREATE INDEX IF NOT EXISTS idx_esl_world_channel_decay
      ON embodied_signal_log(world_id, channel, decay_at);
    CREATE INDEX IF NOT EXISTS idx_esl_world_channel_value
      ON embodied_signal_log(world_id, channel, value);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_esl_world_channel_decay;
    DROP INDEX IF EXISTS idx_esl_world_channel_value;
  `);
}
