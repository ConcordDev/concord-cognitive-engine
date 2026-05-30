// server/migrations/285_uprising.js
//
// Living Society — Phase 6: uprising → faction-strategy + quest handoff.
//
// movement_uprisings: one row per movement that erupts (status='acting') — the
// rebellion event, linking the movement to the faction-strategy move + the
// world event it fired. Idempotent on movement_id.
//
// movement_quests: when a recruitment courier reaches a PLAYER, an emergent
// rebellion quest is planted. This is the handoff row (movement → player quest).

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

export function up(db) {
  if (!tableExists(db, "movement_uprisings")) {
    db.exec(`
      CREATE TABLE movement_uprisings (
        movement_id   TEXT PRIMARY KEY,
        world_id      TEXT NOT NULL,
        target_kind   TEXT NOT NULL,
        target_id     TEXT NOT NULL,
        member_count  INTEGER NOT NULL DEFAULT 0,
        strategy_log_id TEXT,
        world_event_id  TEXT,
        erupted_at    INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX idx_uprisings_world ON movement_uprisings(world_id);
    `);
  }
  if (!tableExists(db, "movement_quests")) {
    db.exec(`
      CREATE TABLE movement_quests (
        id          TEXT PRIMARY KEY,
        movement_id TEXT NOT NULL,
        world_id    TEXT NOT NULL,
        player_id   TEXT NOT NULL,
        quest_id    TEXT NOT NULL,
        target_kind TEXT,
        target_id   TEXT,
        status      TEXT NOT NULL DEFAULT 'offered'
                      CHECK (status IN ('offered','accepted','completed','declined')),
        created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE (movement_id, player_id)
      );
      CREATE INDEX idx_movement_quests_player ON movement_quests(player_id, status);
    `);
  }
}

export function down(_db) {
  // forward-only
}
