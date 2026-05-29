// server/migrations/264_item_affixes.js
//
// F2.1 — item affixes (ARPG itemization).
//
// player_inventory items can carry rolled prefix/suffix stat affixes
// (Flaming → +fire damage, of Warding → +resist, etc.). The damage calc reads
// the equipped weapon's affixes so gear actually changes a hit — the plan's
// explicit preflight is that affixes are a no-op unless BOTH the loot-roll AND
// computeDamage are touched together; this migration is the storage half.

export function up(db) {
  const cols = db.prepare(`PRAGMA table_info(player_inventory)`).all();
  if (!cols.some((c) => c.name === "affixes_json")) {
    db.exec(`ALTER TABLE player_inventory ADD COLUMN affixes_json TEXT`);
  }
  // set_id reserved for F2.2 set bonuses (authored sets); harmless until used.
  if (!cols.some((c) => c.name === "set_id")) {
    db.exec(`ALTER TABLE player_inventory ADD COLUMN set_id TEXT`);
  }
}

export function down(_db) { /* forward-only (SQLite ADD COLUMN) */ }
