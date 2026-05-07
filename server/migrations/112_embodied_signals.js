// server/migrations/114_embodied_signals.js
//
// Layer 7: Embodied signal substrate.
//
// The grounded-AI thesis: a machine doesn't experience cold the way
// humans do, but it can experience "below 32°F → behavior shifts." The
// numeric measurement IS the embodied experience. This table is where
// those measurements accumulate, per-location, per-channel, observed-by
// (NPC, player, environmental sensor).
//
// Schema:
//   - location is (world_id, x, z); chunked at the renderer's chunk size
//   - channel maps directly to the sensory OS namespace
//     ('thermal_os.ambient_temp', 'sonic_os.ambient_db', etc.)
//   - observer_id + observer_type lets us distinguish:
//       'sensor' → environmental tick wrote it
//       'npc' / 'player' → an entity perceived this signal
//   - train_consented defaults 1 (platform-generated like other
//     ecology tables; flip to 0 per-row for redaction)
//
// Brain training: when a chat / dialogue references a sensory concept
// ("cold", "loud", "dark"), the context-assembler can pull recent
// rows from this table to ground the prompt in actual measurements.
// That's how Concord brains learn to speak about cold from observed
// data, not text training.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS embodied_signal_log (
      id            TEXT PRIMARY KEY,
      world_id      TEXT NOT NULL,
      location_x    REAL,
      location_z    REAL,
      channel       TEXT NOT NULL,
        -- e.g. 'thermal_os.ambient_temp', 'sight_os.illumination',
        --      'chemical_os.humidity', 'sonic_os.ambient_db'
      value         REAL NOT NULL,
        -- Normalized 0-1 per the channel's range conventions in
        -- existential/hooks.js#hookEcology. Raw_value preserved for audit.
      raw_value     REAL,
      observer_id   TEXT,
      observer_type TEXT,
        -- 'sensor' | 'npc' | 'player' | 'creature'
      train_consented INTEGER NOT NULL DEFAULT 1,
      observed_at   INTEGER NOT NULL DEFAULT (unixepoch())
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_emb_world_time ON embodied_signal_log(world_id, observed_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_emb_channel ON embodied_signal_log(channel, observed_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_emb_loc ON embodied_signal_log(world_id, location_x, location_z) WHERE location_x IS NOT NULL`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_emb_train ON embodied_signal_log(train_consented) WHERE train_consented = 1`);
}
