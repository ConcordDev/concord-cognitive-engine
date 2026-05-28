// server/migrations/238_guild_substrate.js
//
// Phase BC1 — guild bank + guild XP + guild hall building.
//
// world-organizations.js is an in-memory LruMap; the existing
// `treasury` field is just a coin counter. This migration adds
// DB-backed companion tables so guilds get:
//   - org_xp + org_level (server-canonical progression)
//   - hall_building_id (link to world_buildings; reuses Phase BA1's
//     furniture_layout_json for decoration)
//   - org_inventory (shared item bank, role-gated withdraw)
//   - org_inventory_log (audit trail)

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS org_progression (
      org_id              TEXT PRIMARY KEY,
      org_xp              REAL NOT NULL DEFAULT 0,
      org_level           INTEGER NOT NULL DEFAULT 1,
      hall_building_id    TEXT,
      hall_world_id       TEXT,
      updated_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE TABLE IF NOT EXISTS org_inventory (
      org_id           TEXT NOT NULL,
      item_kind        TEXT NOT NULL CHECK (item_kind IN ('dtu','inventory')),
      item_descriptor  TEXT NOT NULL,
      quantity         INTEGER NOT NULL DEFAULT 0,
      deposited_by     TEXT,
      deposited_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (org_id, item_descriptor)
    );
    CREATE INDEX IF NOT EXISTS idx_org_inventory_org ON org_inventory(org_id);
    CREATE TABLE IF NOT EXISTS org_inventory_log (
      id                TEXT PRIMARY KEY,
      org_id            TEXT NOT NULL,
      action            TEXT NOT NULL CHECK (action IN ('deposit','withdraw')),
      user_id           TEXT NOT NULL,
      item_descriptor   TEXT NOT NULL,
      quantity          INTEGER NOT NULL,
      ts                INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_org_inv_log_org
      ON org_inventory_log(org_id, ts DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_org_inv_log_org;
    DROP TABLE IF EXISTS org_inventory_log;
    DROP INDEX IF EXISTS idx_org_inventory_org;
    DROP TABLE IF EXISTS org_inventory;
    DROP TABLE IF EXISTS org_progression;
  `);
}
