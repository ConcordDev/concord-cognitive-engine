// server/migrations/216_achievement_catalog.js
//
// Phase U2 — achievement catalog + triggers.
//
// `player_achievements` already exists from migration 047 (player_id +
// achievement_id + earned_at). This migration adds the metadata catalog
// + trigger registry so achievements have:
//   - title / description / icon / category / rarity for display
//   - rewards (CC, DTU references, title) applied on unlock
//   - structured triggers evaluated against realtime events
//
// Authored content lives in `content/achievements/*.json` and is loaded
// into the catalog on boot.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS achievement_catalog (
      id              TEXT PRIMARY KEY,
      title           TEXT NOT NULL,
      description     TEXT NOT NULL DEFAULT '',
      category        TEXT NOT NULL DEFAULT 'general'
                      CHECK (category IN ('combat','economy','exploration','social','mastery','general')),
      icon            TEXT,
      rarity          TEXT NOT NULL DEFAULT 'bronze'
                      CHECK (rarity IN ('bronze','silver','gold','legendary')),
      hidden          INTEGER NOT NULL DEFAULT 0 CHECK (hidden IN (0,1)),
      reward_dtu_ids  TEXT NOT NULL DEFAULT '[]',
      reward_cc       REAL NOT NULL DEFAULT 0,
      reward_title    TEXT,
      created_at      INTEGER NOT NULL DEFAULT (unixepoch())
    );

    CREATE INDEX IF NOT EXISTS idx_achievement_catalog_category
      ON achievement_catalog(category, rarity);

    CREATE TABLE IF NOT EXISTS achievement_triggers (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      achievement_id  TEXT NOT NULL,
      trigger_kind    TEXT NOT NULL
                      CHECK (trigger_kind IN ('event','stat','quest','combat','economy','social')),
      condition_json  TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (achievement_id) REFERENCES achievement_catalog(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_achievement_triggers_kind
      ON achievement_triggers(trigger_kind, achievement_id);
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_achievement_triggers_kind;
    DROP TABLE IF EXISTS achievement_triggers;
    DROP INDEX IF EXISTS idx_achievement_catalog_category;
    DROP TABLE IF EXISTS achievement_catalog;
  `);
}
