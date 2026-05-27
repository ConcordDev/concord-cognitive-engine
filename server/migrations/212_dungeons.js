// server/migrations/212_dungeons.js
//
// Wave F — per-world procedural dungeons.
//
// Each world ships with a distinct dungeon template (theme, room kinds,
// creature mix, weapon-class loot bias, boss archetype). Dungeons are
// generated procedurally from a seed so the same dungeon can be revisited.
//
// Three tables:
//   dungeons              — one row per generated dungeon
//   dungeon_rooms         — per-dungeon room graph
//   dungeon_loot_instances — per-room loot (rolled once on first enter)
//   dungeon_visits        — per-player visit log for objectives/quests

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS dungeons (
      id              TEXT    PRIMARY KEY,
      world_id        TEXT    NOT NULL,
      template_kind   TEXT    NOT NULL,
      seed            TEXT    NOT NULL,
      name            TEXT    NOT NULL,
      anchor_x        REAL    NOT NULL,
      anchor_z        REAL    NOT NULL,
      depth_level     INTEGER NOT NULL DEFAULT 1,
      room_count      INTEGER NOT NULL DEFAULT 5,
      status          TEXT    NOT NULL DEFAULT 'active'
                              CHECK (status IN ('active','cleared','abandoned')),
      cleared_at      INTEGER,
      generated_at    INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_dungeons_world
      ON dungeons(world_id, status);
    CREATE INDEX IF NOT EXISTS idx_dungeons_template
      ON dungeons(world_id, template_kind);

    CREATE TABLE IF NOT EXISTS dungeon_rooms (
      dungeon_id        TEXT    NOT NULL,
      room_idx          INTEGER NOT NULL,
      kind              TEXT    NOT NULL,
      x                 REAL    NOT NULL,
      z                 REAL    NOT NULL,
      width             REAL    NOT NULL DEFAULT 12,
      depth             REAL    NOT NULL DEFAULT 12,
      connections_json  TEXT,
      cleared           INTEGER NOT NULL DEFAULT 0,
      is_boss           INTEGER NOT NULL DEFAULT 0,
      hazards_json      TEXT,
      creature_count    INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (dungeon_id, room_idx)
    );

    CREATE TABLE IF NOT EXISTS dungeon_loot_instances (
      id            TEXT    PRIMARY KEY,
      dungeon_id    TEXT    NOT NULL,
      room_idx      INTEGER NOT NULL,
      item_json     TEXT    NOT NULL,
      claimed_by    TEXT,
      claimed_at    INTEGER,
      generated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_dli_dungeon
      ON dungeon_loot_instances(dungeon_id, claimed_by);

    CREATE TABLE IF NOT EXISTS dungeon_visits (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      dungeon_id  TEXT    NOT NULL,
      user_id     TEXT    NOT NULL,
      room_idx    INTEGER NOT NULL,
      entered_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_dv_user
      ON dungeon_visits(user_id, dungeon_id, entered_at);
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
