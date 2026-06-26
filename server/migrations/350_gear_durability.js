// server/migrations/350_gear_durability.js
//
// Gear DURABILITY + REPAIR substrate (MMO research-grounded).
//
// Adds two nullable columns to player_inventory:
//   current_durability INTEGER  — current durability points (0 ⇒ broken).
//   max_durability     INTEGER  — full durability ceiling for this item.
//
// NULLABILITY is load-bearing: a NULL max_durability means the item is
// indestructible / not gear (materials, consumables, blueprints, legacy
// rows that pre-date this migration). The durability engine
// (server/lib/gear-durability.js) treats NULL as "full / never decays /
// never broken", so legacy inventory and non-gear items are untouched.
//
// Durability decay is tied to DEATH only — NOT per-hit/per-ability (WoW's
// per-block "Block Tax" is the textbook anti-pattern this design avoids).
// On a player's own death, each equipped item with a non-null
// max_durability loses a chunk. "Broken" gear (current_durability = 0)
// provides no stat/effect benefit until repaired. Repair is a gold sink.
//
// Append-only per CLAUDE.md invariant; previous migrations are untouched.

function columnExists(db, table, col) {
  try { return db.prepare(`PRAGMA table_info(${table})`).all().some((r) => r.name === col); }
  catch { return false; }
}

export function up(db) {
  // Skip cleanly if the table doesn't exist on a minimal build.
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='player_inventory'").get()) return;

  // Idempotent column adds — re-apply against an already-migrated DB is a no-op.
  if (!columnExists(db, "player_inventory", "current_durability")) {
    db.exec(`ALTER TABLE player_inventory ADD COLUMN current_durability INTEGER`);
  }
  if (!columnExists(db, "player_inventory", "max_durability")) {
    db.exec(`ALTER TABLE player_inventory ADD COLUMN max_durability INTEGER`);
  }
}

export function down(_db) {
  // SQLite < 3.35 can't DROP COLUMN. Forward-only; the columns are nullable
  // so leaving them is harmless.
}
