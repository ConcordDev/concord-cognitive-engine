// server/migrations/282_labor_world_state.js
//
// Living Society — Phase 2: labor writes visible world-state.
//
// world_buildings has a 'construction' state but NO progress column and no
// labor path — a builder NPC couldn't actually raise it. Add the progress +
// target-state columns so `performConstruction` accretes a building over ticks
// (frame → construction → standing), the Medieval Dynasty primitive.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='world_buildings'").get()) {
    if (!columnExists(db, "world_buildings", "construction_progress_pct")) {
      try { db.exec(`ALTER TABLE world_buildings ADD COLUMN construction_progress_pct REAL DEFAULT 0`); } catch { /* noop */ }
    }
    if (!columnExists(db, "world_buildings", "build_target_state")) {
      // The state the building becomes when construction completes (default 'standing').
      try { db.exec(`ALTER TABLE world_buildings ADD COLUMN build_target_state TEXT`); } catch { /* noop */ }
    }
  }
}

export function down(_db) {
  // forward-only
}
