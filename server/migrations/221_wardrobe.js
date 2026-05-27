// server/migrations/221_wardrobe.js
//
// Phase V3 — slot-based wardrobe.
//
// avatar_appearance (migration 187) is a single JSON column; this adds
// saved outfits the user can name, equip, and share as DTUs.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS saved_outfits (
      id          TEXT PRIMARY KEY,
      user_id     TEXT NOT NULL,
      name        TEXT NOT NULL,
      slots_json  TEXT NOT NULL DEFAULT '{}',
      created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at  INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_saved_outfits_user
      ON saved_outfits(user_id, updated_at DESC);

    -- Slot taxonomy (read-only seed table).
    CREATE TABLE IF NOT EXISTS outfit_slot_types (
      slot_kind         TEXT PRIMARY KEY,
      label             TEXT NOT NULL,
      valid_items_kinds TEXT NOT NULL DEFAULT '[]',
      sort_order        INTEGER NOT NULL DEFAULT 0
    );
  `);

  // Seed the 9 canonical slot kinds.
  const slots = [
    ["helmet",      "Helmet",       JSON.stringify(["hat", "helmet", "crown"]), 1],
    ["chest",       "Chest",        JSON.stringify(["chest", "robe", "shirt"]), 2],
    ["legs",        "Legs",         JSON.stringify(["legs", "pants", "skirt"]), 3],
    ["gloves",      "Gloves",       JSON.stringify(["gloves", "gauntlets"]), 4],
    ["boots",       "Boots",        JSON.stringify(["boots", "shoes"]), 5],
    ["cape",        "Cape",         JSON.stringify(["cape", "cloak", "mantle"]), 6],
    ["weapon_main", "Main weapon",  JSON.stringify(["weapon", "sword", "staff", "bow"]), 7],
    ["weapon_off",  "Off hand",     JSON.stringify(["shield", "weapon", "wand"]), 8],
    ["accessory",   "Accessory",    JSON.stringify(["accessory", "ring", "amulet"]), 9],
  ];
  const stmt = db.prepare(`
    INSERT INTO outfit_slot_types (slot_kind, label, valid_items_kinds, sort_order)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(slot_kind) DO NOTHING
  `);
  for (const s of slots) stmt.run(...s);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_saved_outfits_user;
    DROP TABLE IF EXISTS saved_outfits;
    DROP TABLE IF EXISTS outfit_slot_types;
  `);
}
