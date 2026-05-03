// server/migrations/090_dual_hand_loadout.js
//
// Biomutant-style dual-hand loadout. Each player has a right-hand and a
// left-hand slot; weapons can be one-handed (slot into either side
// independently) or two-handed (occupy both slots, force a single
// combined combat path). The Combat Flow recorder stamps `hand` and
// `weapon_class` onto every action so the flow engine derives loadout-
// aware combos — sword-right + pistol-left builds different chains than
// dual-daggers, even with the same key inputs.
//
// player_equipment is a small per-user table; the actual item rows still
// live in player_inventory. Equipping just stores the inventory row id
// in the appropriate slot.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS player_equipment (
      user_id           TEXT PRIMARY KEY,
      right_hand_id     TEXT,                              -- player_inventory.id
      left_hand_id      TEXT,
      head_id           TEXT,
      body_id           TEXT,
      accessory_id      TEXT,
      updated_at        INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);

  // Per-item weapon class for dual-hand combat — adds these columns to
  // player_inventory if not present. handedness is one of:
  //   'right' (default for most weapons), 'left' (off-hand only),
  //   'two' (two-handed; occupies both slots),
  //   'either' (small daggers / pistols / shields — usable in either hand)
  const cols = new Set(db.prepare("PRAGMA table_info(player_inventory)").all().map((r) => r.name));
  if (!cols.has("handedness")) {
    db.exec(`ALTER TABLE player_inventory ADD COLUMN handedness TEXT NOT NULL DEFAULT 'either'`);
  }
  if (!cols.has("weapon_class")) {
    // 'sword' | 'dagger' | 'pistol' | 'rifle' | 'greatsword' | 'hammer' |
    // 'shield' | 'staff' | 'bow' | null. NULL = non-weapon (consumable, material).
    db.exec(`ALTER TABLE player_inventory ADD COLUMN weapon_class TEXT`);
  }
  // Index for the loadout lookup join
  db.exec(`CREATE INDEX IF NOT EXISTS idx_player_inventory_handedness ON player_inventory(user_id, handedness)`);
}

export function down(_db) { /* sqlite — leave columns in place */ }
