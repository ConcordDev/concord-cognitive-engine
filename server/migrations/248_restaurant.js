// server/migrations/248_restaurant.js
//
// Phase CB4 — restaurant management.
//
// Cooking exists (server/lib/cooking + npc-marketplace). What was
// missing: NPC customers arriving, ordering, expiry pressure on
// serve-time, tips. Diner-Dash-shaped.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS restaurants (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      world_id        TEXT NOT NULL,
      building_id     TEXT,
      name            TEXT NOT NULL DEFAULT 'Diner',
      opened_at       INTEGER,
      closed_at       INTEGER,
      total_revenue   REAL NOT NULL DEFAULT 0,
      total_tips      REAL NOT NULL DEFAULT 0,
      orders_served   INTEGER NOT NULL DEFAULT 0,
      orders_missed   INTEGER NOT NULL DEFAULT 0
    );
    CREATE INDEX IF NOT EXISTS idx_restaurants_owner ON restaurants(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_restaurants_world ON restaurants(world_id);

    CREATE TABLE IF NOT EXISTS restaurant_orders (
      id                  TEXT PRIMARY KEY,
      restaurant_id       TEXT NOT NULL,
      customer_npc_id     TEXT NOT NULL,
      dish_id             TEXT NOT NULL,
      ordered_at          INTEGER NOT NULL DEFAULT (unixepoch()),
      served_at           INTEGER,
      expires_at          INTEGER NOT NULL,
      payment_cc          REAL NOT NULL DEFAULT 0,
      tip_cc              REAL NOT NULL DEFAULT 0,
      status              TEXT NOT NULL DEFAULT 'pending'
                            CHECK (status IN ('pending','served','expired','cancelled'))
    );
    CREATE INDEX IF NOT EXISTS idx_orders_restaurant
      ON restaurant_orders(restaurant_id, status, ordered_at DESC);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_orders_restaurant;
    DROP TABLE IF EXISTS restaurant_orders;
    DROP INDEX IF EXISTS idx_restaurants_world;
    DROP INDEX IF EXISTS idx_restaurants_owner;
    DROP TABLE IF EXISTS restaurants;
  `);
}
