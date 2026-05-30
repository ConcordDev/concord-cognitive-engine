// server/migrations/280_material_profiles.js
//
// Living Society — Phase 0.5: procedural food + crossbreed materials.
//
// The audit gap: materials don't carry inheritable EFFECTS and drops aren't
// derived from the (possibly hybrid) creature. This migration provisions:
//
//   - material_profiles(material_id PK, effect_tags_json, + Phase-0 props):
//     a structured effect/property profile per material KIND. Authored species
//     get profiles; procedural/hybrid materials derive theirs from the
//     blueprint and blend across generations.
//   - creature_corpses.lineage_json / blueprint_json: so the butcher route can
//     detect a hybrid and compose drops from its blueprint (fixing the empty-
//     loot bug where a hybrid's species_id had no loot table → dropped nothing).
//   - creature_lineage.material_profile: the blended profile a hybrid carries.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}
function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!tableExists(db, "material_profiles")) {
    db.exec(`
      CREATE TABLE material_profiles (
        material_id   TEXT PRIMARY KEY,
        kind          TEXT NOT NULL DEFAULT 'meat',  -- meat | pelt | bone | herb | reagent | ...
        effect_tags_json TEXT,                        -- ["stamina_regen","warmth", ...]
        potency       INTEGER NOT NULL DEFAULT 10 CHECK (potency BETWEEN 0 AND 100),
        affinity      TEXT    NOT NULL DEFAULT 'bio'
                        CHECK (affinity IN ('magic','tech','bio','physical','chaos')),
        stability     INTEGER NOT NULL DEFAULT 80 CHECK (stability BETWEEN 0 AND 100),
        rarity_tier   INTEGER NOT NULL DEFAULT 1 CHECK (rarity_tier BETWEEN 1 AND 5),
        source_species TEXT,
        updated_at    INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE INDEX idx_material_profiles_kind ON material_profiles(kind);
    `);
  }
  if (tableExists(db, "creature_corpses")) {
    if (!columnExists(db, "creature_corpses", "lineage_json")) {
      try { db.exec(`ALTER TABLE creature_corpses ADD COLUMN lineage_json TEXT`); } catch { /* noop */ }
    }
    if (!columnExists(db, "creature_corpses", "blueprint_json")) {
      try { db.exec(`ALTER TABLE creature_corpses ADD COLUMN blueprint_json TEXT`); } catch { /* noop */ }
    }
  }
  if (tableExists(db, "creature_lineage") && !columnExists(db, "creature_lineage", "material_profile")) {
    try { db.exec(`ALTER TABLE creature_lineage ADD COLUMN material_profile TEXT`); } catch { /* noop */ }
  }
}

export function down(_db) {
  // forward-only
}
