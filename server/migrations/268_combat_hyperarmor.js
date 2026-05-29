// server/migrations/268_combat_hyperarmor.js
//
// F3.1 — hyperarmor. Committed heavy attacks ignore incoming flinch/rocked
// during their active frames (Souls/DMC poise-during-attack); only a
// poise-breaking knockdown still interrupts. Stored as a window on the actor's
// live combat state.

export function up(db) {
  const cols = db.prepare(`PRAGMA table_info(combat_actor_state)`).all();
  if (!cols.some((c) => c.name === "hyperarmor_until_ms")) {
    db.exec(`ALTER TABLE combat_actor_state ADD COLUMN hyperarmor_until_ms INTEGER NOT NULL DEFAULT 0`);
  }
}

export function down(_db) { /* forward-only (SQLite ADD COLUMN) */ }
