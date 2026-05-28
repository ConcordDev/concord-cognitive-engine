// server/migrations/254_claim_entities.js
//
// Phase CC4 — factory automation (claim-bounded).
//
// Per-claim tile grid (decoupled from world geometry). Three entity
// kinds: chest (storage), belt (movement), crafter (recipe). Belt-tick
// advances items one tile per heartbeat.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS claim_entities (
      id                  TEXT PRIMARY KEY,
      claim_id            TEXT NOT NULL,
      entity_type         TEXT NOT NULL CHECK (entity_type IN ('chest','belt','crafter')),
      tile_x              INTEGER NOT NULL,
      tile_y              INTEGER NOT NULL,
      rotation            INTEGER NOT NULL DEFAULT 0 CHECK (rotation IN (0,1,2,3)),
      connections_json    TEXT NOT NULL DEFAULT '[]',
      config_json         TEXT NOT NULL DEFAULT '{}',
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_claim_entities_claim
      ON claim_entities(claim_id);
    CREATE UNIQUE INDEX IF NOT EXISTS idx_claim_entities_tile
      ON claim_entities(claim_id, tile_x, tile_y);

    CREATE TABLE IF NOT EXISTS claim_entity_inventory (
      entity_id        TEXT NOT NULL,
      item_descriptor  TEXT NOT NULL,
      quantity         INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (entity_id, item_descriptor)
    );
  `);
}

export function down(db) {
  db.exec(`
    DROP TABLE IF EXISTS claim_entity_inventory;
    DROP INDEX IF EXISTS idx_claim_entities_tile;
    DROP INDEX IF EXISTS idx_claim_entities_claim;
    DROP TABLE IF EXISTS claim_entities;
  `);
}
