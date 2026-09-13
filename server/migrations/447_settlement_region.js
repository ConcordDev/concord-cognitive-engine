// Persistent megaworld W1 — join procgen regions to Living Society settlements.
// Extends mig 287/446. Does not create a second towns table.

function tableExists(db, name) {
  return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(name);
}

function hasColumn(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}

export function up(db) {
  if (!tableExists(db, "settlements")) return;
  if (!hasColumn(db, "settlements", "region_id")) {
    db.exec(`ALTER TABLE settlements ADD COLUMN region_id TEXT`);
  }
  try {
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_settlements_region
        ON settlements(region_id)
        WHERE region_id IS NOT NULL
    `);
  } catch { /* index optional on stripped stubs */ }
}

export function down(_db) {
  // forward-only
}
