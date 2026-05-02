// server/migrations/053_lens_portals.js
// Lens portal buildings: each lens maps to a visitable in-world location.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS lens_portals (
      id                  TEXT PRIMARY KEY,
      lens_id             TEXT NOT NULL,
      world_id            TEXT NOT NULL DEFAULT 'concordia-hub',
      district            TEXT NOT NULL DEFAULT 'central',
      x                   REAL NOT NULL DEFAULT 0,
      y                   REAL NOT NULL DEFAULT 0,
      building_type       TEXT NOT NULL DEFAULT 'workshop',
      label               TEXT NOT NULL,
      description         TEXT,
      required_skill_level REAL NOT NULL DEFAULT 0,
      created_at          INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS lens_portal_npcs (
      id          TEXT PRIMARY KEY,
      portal_id   TEXT NOT NULL REFERENCES lens_portals(id),
      name        TEXT NOT NULL,
      title       TEXT NOT NULL,
      greeting    TEXT NOT NULL,
      created_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE TABLE IF NOT EXISTS lens_portal_entries (
      id          TEXT PRIMARY KEY,
      portal_id   TEXT NOT NULL,
      user_id     TEXT NOT NULL,
      entered_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_lens_portals_world ON lens_portals(world_id);
    CREATE INDEX IF NOT EXISTS idx_lens_portal_entries_user ON lens_portal_entries(user_id);
  `);
}
