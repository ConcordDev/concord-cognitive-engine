// server/migrations/108_embodied_signal_log.js
//
// Layer 7 substrate: embodied_signal_log.
//
// Per-world, per-cell, per-channel environmental signal store. Three writer
// classes share one table:
//   1. environment-sensor heartbeat — periodic ambient baseline (temp,
//      humidity, light, pressure) per active world.
//   2. skill-cast feedback — fire spells warm cells, water spells humidify,
//      lightning spikes air noise + ozone, etc. (Layer 7.5.)
//   3. world-events / combat — explosions, floods, fires push transient
//      readings that decay over minutes.
//
// Readers use signalsForWorld(db, worldId, location?) to fold rows in a
// 3x3 cell window around `location` (or whole-world average if no location).
// Recency-weighted; older rows weigh exponentially less.
//
// CELL_SIZE is 50m. World is 2000m x 2000m → 40x40 = 1600 cells. A
// 3x3 window is 150m on a side which roughly matches a battle's
// disturbance footprint.
//
// `decay_at` is a per-row TTL. The environment-sensor heartbeat runs a
// decay sweep so the table stays bounded.

export function up(db) {
  db.prepare(`
    CREATE TABLE IF NOT EXISTS embodied_signal_log (
      id           TEXT PRIMARY KEY,
      world_id     TEXT NOT NULL,
      cell_x       INTEGER NOT NULL,
      cell_z       INTEGER NOT NULL,
      channel      TEXT NOT NULL,
      value        REAL NOT NULL,
      source       TEXT NOT NULL CHECK (source IN
                     ('sensor', 'skill_cast', 'world_event', 'combat', 'world_seed')),
      source_id    TEXT,
      recorded_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      decay_at     INTEGER NOT NULL
    )
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_embodied_world_channel
      ON embodied_signal_log(world_id, channel, recorded_at DESC)
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_embodied_world_cell
      ON embodied_signal_log(world_id, cell_x, cell_z, recorded_at DESC)
  `).run();

  db.prepare(`
    CREATE INDEX IF NOT EXISTS idx_embodied_decay
      ON embodied_signal_log(decay_at)
  `).run();
}

export function down(db) {
  db.prepare('DROP INDEX IF EXISTS idx_embodied_decay').run();
  db.prepare('DROP INDEX IF EXISTS idx_embodied_world_cell').run();
  db.prepare('DROP INDEX IF EXISTS idx_embodied_world_channel').run();
  db.prepare('DROP TABLE IF EXISTS embodied_signal_log').run();
}
