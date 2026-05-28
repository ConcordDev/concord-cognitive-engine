// server/migrations/232_player_houses.js
//
// Phase BA1 — wire land_claims → world_buildings → building_rooms into
// a single "this is my house" substrate.
//
// Existing pieces (do NOT recreate):
//   - land_claims (mig 135): circular plot with bond + maintenance.
//   - world_buildings (mig 063): a building footprint with owner_id +
//     owner_type + state + health_pct. Mig 065 added lock_tier, is_open,
//     last_breach.
//   - building_rooms (mig 064): rooms inside a building with furniture
//     JSON. Mig 065 added lock_tier, lock_state, last_breach.
//
// This migration adds:
//   - player_houses: the join row. (user_id, world_id, land_claim_id,
//     building_id, name, visibility, allow_live_visits, snapshot_json,
//     created_at, last_decorated_at). Composite UNIQUE on
//     (land_claim_id, building_id) so a single building inside a single
//     land-claim is exactly one house.
//   - building_rooms.furniture_layout_json: per-item placement
//     {itemId, x, y, z, rot} array. Supersedes the flat string-list
//     `furniture` column. Backfill is non-destructive — the column is
//     ADD COLUMN NULL, callers write to the new column going forward
//     and read both for back-compat.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_houses (
      id                  TEXT PRIMARY KEY,
      user_id             TEXT NOT NULL,
      world_id            TEXT NOT NULL,
      land_claim_id       TEXT NOT NULL,
      building_id         TEXT NOT NULL,
      name                TEXT,
      visibility          TEXT NOT NULL DEFAULT 'private'
                            CHECK (visibility IN ('private','friends','public')),
      allow_live_visits   INTEGER NOT NULL DEFAULT 0,
      snapshot_json       TEXT,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      last_decorated_at   INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(land_claim_id, building_id)
    );
    CREATE INDEX IF NOT EXISTS idx_player_houses_user
      ON player_houses(user_id);
    CREATE INDEX IF NOT EXISTS idx_player_houses_world_visibility
      ON player_houses(world_id, visibility);
  `);

  // ALTER building_rooms ADD COLUMN furniture_layout_json TEXT NULL.
  // Best-effort — tolerate missing-table on minimal builds.
  try {
    const cols = db.prepare(`PRAGMA table_info(building_rooms)`).all().map(c => c.name);
    if (!cols.includes("furniture_layout_json")) {
      db.exec(`ALTER TABLE building_rooms ADD COLUMN furniture_layout_json TEXT`);
    }
  } catch { /* table missing on minimal build */ }
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_player_houses_world_visibility;
    DROP INDEX IF EXISTS idx_player_houses_user;
    DROP TABLE IF EXISTS player_houses;
  `);
  // SQLite older versions can't DROP COLUMN; leave furniture_layout_json
  // in place on down.
}
