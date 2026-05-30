// server/migrations/279_craft_chain_inputs.js
//
// Living Society — Phase 0 tail: give the multi-step crafting chain a resource
// bill so its output is propertied, not a bare string.
//
// `craft_chains` previously carried only steps + a bare `output_item`. The
// craft-resolve wrap needs the chain's INPUT resources to compute the output's
// quality/potency at completion. `inputs_json` is an optional array of
// `{ id, quantity }` (same shape craft-engine recipe requirements use). When
// present, `startChain` verifies + consumes them up-front (world-scoped) and
// `advanceStep` resolves the finished item's quality via the single
// craft-resolve layer. When absent, chains behave exactly as before.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!columnExists(db, "craft_chains", "inputs_json")) {
    try { db.exec(`ALTER TABLE craft_chains ADD COLUMN inputs_json TEXT`); } catch { /* table absent on minimal build */ }
  }
  // The finished item's resolved quality, stamped on completion for the UI /
  // marketplace to read.
  if (!columnExists(db, "player_craft_jobs", "output_quality")) {
    try { db.exec(`ALTER TABLE player_craft_jobs ADD COLUMN output_quality REAL`); } catch { /* table absent */ }
  }
}

export function down(_db) {
  // forward-only
}
