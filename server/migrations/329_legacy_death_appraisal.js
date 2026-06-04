// server/migrations/329_legacy_death_appraisal.js
//
// Wave 7 / E4 (Context 9) — death is a felt event. The legacy row gets a place to hold
// the dying NPC's final appraisal: a maximal-negative-valence feltPer + its quale label
// ("grief"/"despair"), stamped by npc-legacy.js#recordDeathAppraisal. Self-preservation
// EMERGES from this being the worst value — there is no coded survive() goal. Forward-only.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='npc_legacies'").get()) return;
  if (!columnExists(db, "npc_legacies", "final_feltper_json")) {
    try { db.exec("ALTER TABLE npc_legacies ADD COLUMN final_feltper_json TEXT"); } catch { /* noop */ }
  }
}

export function down(_db) {
  // forward-only
}
