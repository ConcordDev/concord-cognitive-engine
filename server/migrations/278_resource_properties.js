// server/migrations/278_resource_properties.js
//
// Living Society — Phase 0: the foundational resource & crafting substrate.
//
// Resources were bare strings (npc-economy RAW_RESOURCES/FINISHED_GOODS;
// player_inventory had only a `quality` scalar). This is the property model
// the unified craft-resolve layer reads: every resource KIND carries Potency,
// Affinity, Stability, Volume/Weight, Rarity Tier (1 Basic → 5 Legendary), and
// a Source Type — so UGC (spells/items/powers/food/buildings) is grounded and
// balanced instead of "imagine an overpowered spell." `lib/resources.js` holds
// the canonical catalog (source of truth, works without DB); this table is the
// persistence + override layer. `player_inventory.properties_json` carries
// per-slot overrides (a specific dropped hide hotter than its kind baseline,
// and the Phase 0.5 crossbreed-drop hook).

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!tableExists(db, "resource_properties")) {
    db.exec(`
      CREATE TABLE resource_properties (
        item_id      TEXT    PRIMARY KEY,
        potency      INTEGER NOT NULL DEFAULT 10 CHECK (potency BETWEEN 0 AND 100),
        affinity     TEXT    NOT NULL DEFAULT 'physical'
                       CHECK (affinity IN ('magic','tech','bio','physical','chaos')),
        stability    INTEGER NOT NULL DEFAULT 80 CHECK (stability BETWEEN 0 AND 100),
        volume       REAL    NOT NULL DEFAULT 1.0,
        weight       REAL    NOT NULL DEFAULT 1.0,
        rarity_tier  INTEGER NOT NULL DEFAULT 1 CHECK (rarity_tier BETWEEN 1 AND 5),
        source_type  TEXT    NOT NULL DEFAULT 'gather',
        magical_sub  TEXT,   -- null | soul_gem | mana | aether | essence
        updated_at   INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX idx_resource_props_tier     ON resource_properties(rarity_tier);
      CREATE INDEX idx_resource_props_affinity ON resource_properties(affinity);
    `);
  }
  // Per-slot property overrides on owned items (crossbreed drops, infused mats).
  if (tableExists(db, "player_inventory") && !columnExists(db, "player_inventory", "properties_json")) {
    db.exec(`ALTER TABLE player_inventory ADD COLUMN properties_json TEXT`);
  }
}

export function down(_db) {
  // forward-only
}
