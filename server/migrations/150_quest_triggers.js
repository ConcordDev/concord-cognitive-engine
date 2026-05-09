// Migration 147 — Theme deferred (game-feel pass): hidden quest triggers.
//
// Lets authored content gate quest activation behind environmental
// conditions instead of pushing every quest into the visible quest log.
// Patterns this enables:
//   - "Walk past the broken cart 3 times → quest 'Hauntings on the Road'"
//   - "Attune at the standing stone after dusk → 'Stargazer's Reply'"
//   - "Hand a specific item to a specific NPC → 'The Recovered Heirloom'"
//
// quest_triggers       - one row per author-defined trigger
// quest_trigger_visits - per-user × trigger visit / progress counter
//
// Append-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS quest_triggers (
      id                TEXT    PRIMARY KEY,
      world_id          TEXT    NOT NULL,
      trigger_kind      TEXT    NOT NULL CHECK (trigger_kind IN (
                          'proximity', 'visits', 'dialogue', 'item_handover',
                          'time_window', 'world_state'
                        )),
      payload_json      TEXT    NOT NULL,
      target_quest_id   TEXT    NOT NULL,
      requires_visits   INTEGER NOT NULL DEFAULT 1,
      max_fires_per_user INTEGER NOT NULL DEFAULT 1,
      author            TEXT,
      created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
      enabled           INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_quest_triggers_world_kind
      ON quest_triggers(world_id, trigger_kind, enabled);
    CREATE INDEX IF NOT EXISTS idx_quest_triggers_target
      ON quest_triggers(target_quest_id);

    CREATE TABLE IF NOT EXISTS quest_trigger_visits (
      trigger_id  TEXT    NOT NULL,
      user_id     TEXT    NOT NULL,
      visits      INTEGER NOT NULL DEFAULT 0,
      first_at    INTEGER NOT NULL DEFAULT (unixepoch()),
      last_at     INTEGER NOT NULL DEFAULT (unixepoch()),
      fired_count INTEGER NOT NULL DEFAULT 0,
      last_fired_at INTEGER,
      PRIMARY KEY (trigger_id, user_id)
    );
    CREATE INDEX IF NOT EXISTS idx_qtv_user
      ON quest_trigger_visits(user_id, last_at);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_qtv_user;
    DROP TABLE IF EXISTS quest_trigger_visits;
    DROP INDEX IF EXISTS idx_quest_triggers_target;
    DROP INDEX IF EXISTS idx_quest_triggers_world_kind;
    DROP TABLE IF EXISTS quest_triggers;
  `);
}
