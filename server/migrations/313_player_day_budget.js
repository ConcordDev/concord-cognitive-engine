// server/migrations/313_player_day_budget.js
//
// Slice-of-Life — the day-clock time-economy. Every life verb costs a finite
// daily slot; the day is a viability cone over time (Σ allocations ≤ 1, the
// dtu_362 simplex). This persists a per-player, per-day slot ledger so social
// competes with combat/work for the player's finite day. Append-only.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_day_budget (
      user_id     TEXT NOT NULL,
      day_idx     INTEGER NOT NULL,          -- the Concordia day index
      slots_used  INTEGER NOT NULL DEFAULT 0,
      log_json    TEXT NOT NULL DEFAULT '[]',-- [{verb, slots, at}]
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, day_idx)
    );
    CREATE INDEX IF NOT EXISTS idx_player_day_budget_user ON player_day_budget(user_id, day_idx);
  `);
}

export function down(_db) { /* append-only */ }
