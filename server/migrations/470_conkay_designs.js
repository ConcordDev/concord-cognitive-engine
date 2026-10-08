// ConKay designs (physical-system compiler): a design is its Design IR plus
// the ordered edits applied to it. Solver results are not stored: every
// solver is deterministic, so replaying the IR and the edits rebuilds the
// exact results and receipts.

export function up(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS conkay_designs (
      id TEXT PRIMARY KEY,
      owner_id TEXT NOT NULL,
      name TEXT NOT NULL,
      ir_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_conkay_designs_owner ON conkay_designs (owner_id, updated_at);

    CREATE TABLE IF NOT EXISTS conkay_design_edits (
      design_id TEXT NOT NULL REFERENCES conkay_designs(id) ON DELETE CASCADE,
      revision INTEGER NOT NULL,
      source TEXT NOT NULL,
      text TEXT,
      ops_json TEXT NOT NULL,
      created_at TEXT NOT NULL,
      PRIMARY KEY (design_id, revision)
    );
  `);
}

export function down(db) {
  db.exec("DROP TABLE IF EXISTS conkay_design_edits; DROP TABLE IF EXISTS conkay_designs;");
}
