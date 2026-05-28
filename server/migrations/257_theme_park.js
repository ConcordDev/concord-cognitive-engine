// server/migrations/257_theme_park.js
//
// Phase CC7 — theme park tycoon.
//
// Owners open attractions in their buildings; NPC visitors arrive,
// pick attractions by appeal, queue, ride, pay, gain satisfaction →
// return next day if happy.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS attractions (
      id              TEXT PRIMARY KEY,
      owner_user_id   TEXT NOT NULL,
      world_id        TEXT NOT NULL,
      building_id     TEXT,
      attraction_kind TEXT NOT NULL CHECK (attraction_kind IN ('ride','show','food','game')),
      name            TEXT NOT NULL DEFAULT 'Attraction',
      base_appeal     REAL NOT NULL DEFAULT 0.5,
      ticket_cc       REAL NOT NULL DEFAULT 5,
      current_visitors INTEGER NOT NULL DEFAULT 0,
      total_visits    INTEGER NOT NULL DEFAULT 0,
      total_revenue   REAL NOT NULL DEFAULT 0,
      opened_at       INTEGER NOT NULL DEFAULT (unixepoch()),
      closed_at       INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_attractions_owner ON attractions(owner_user_id);
    CREATE INDEX IF NOT EXISTS idx_attractions_world ON attractions(world_id);

    CREATE TABLE IF NOT EXISTS visitor_npcs (
      id                    TEXT PRIMARY KEY,
      world_id              TEXT NOT NULL,
      current_attraction_id TEXT,
      satisfaction          REAL NOT NULL DEFAULT 0.5,
      total_paid            REAL NOT NULL DEFAULT 0,
      arrived_at            INTEGER NOT NULL DEFAULT (unixepoch()),
      leaves_at             INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_visitor_world
      ON visitor_npcs(world_id, current_attraction_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_visitor_world;
    DROP TABLE IF EXISTS visitor_npcs;
    DROP INDEX IF EXISTS idx_attractions_world;
    DROP INDEX IF EXISTS idx_attractions_owner;
    DROP TABLE IF EXISTS attractions;
  `);
}
