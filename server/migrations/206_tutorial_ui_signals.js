// server/migrations/206_tutorial_ui_signals.js
//
// Second-cycle tutorial tracking. Each row stamps the first time a
// player opened a specific piece of the new UI (character sheet,
// favorites wheel, perk constellation, bestiary, settlement editor).
// The tutorial-second-cycle library reads this to determine completion.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS user_ui_opens (
      user_id         TEXT NOT NULL,
      ui_key          TEXT NOT NULL,
      first_opened_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (user_id, ui_key)
    );
  `);
}

export function down(_db) { /* sqlite — keep on rollback */ }
