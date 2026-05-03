// server/migrations/095_inventory_spoilage_and_effects.js
//
// EvoEcosystem W3: spoilage timer on player_inventory + a server-side
// active-effects table for time-limited buffs from consumables.
//
// player_inventory.spoils_at: unix timestamp; rows past this are deleted
// by a heartbeat sweep. NULL = no spoilage (most non-food items).
//
// user_active_effects: rows with started_at + expires_at + magnitude.
// Frontend renders countdowns; server gates effect application.

export function up(db) {
  // Add spoils_at if missing.
  try {
    const cols = new Set(db.prepare("PRAGMA table_info(player_inventory)").all().map((r) => r.name));
    if (cols.size > 0 && !cols.has("spoils_at")) {
      db.exec(`ALTER TABLE player_inventory ADD COLUMN spoils_at INTEGER`);
    }
  } catch { /* table may not exist on minimal builds */ }

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_active_effects (
      id            TEXT PRIMARY KEY,
      user_id       TEXT NOT NULL,
      effect_id     TEXT NOT NULL,        -- e.g. 'stamina_regen', 'damage_resist'
      kind          TEXT NOT NULL,        -- 'buff' | 'debuff'
      magnitude     REAL NOT NULL DEFAULT 1.0,
      source_dtu_id TEXT,                 -- the food DTU that granted it
      started_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at    INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_active_effects_user
      ON user_active_effects(user_id, expires_at);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
