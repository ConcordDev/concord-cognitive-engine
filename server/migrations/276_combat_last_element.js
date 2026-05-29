// server/migrations/276_combat_last_element.js
//
// WS4(c) — combat element-combo. Track the element of an actor's previous strike
// so recordStrike can reward elemental chains (same-element resonance,
// complementary amplify) and penalise cancelling pairs (fire→water). Stored on
// the live combat state alongside the existing combo counter.

export function up(db) {
  const cols = db.prepare(`PRAGMA table_info(combat_actor_state)`).all();
  if (!cols.some((c) => c.name === "last_element")) {
    db.exec(`ALTER TABLE combat_actor_state ADD COLUMN last_element TEXT`);
  }
}

export function down(_db) { /* forward-only (SQLite ADD COLUMN) */ }
