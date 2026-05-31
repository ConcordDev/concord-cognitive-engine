// server/migrations/311_refusal_field_applies_to.js
//
// SL6 — the child-refusal-field. A refusal field can now be SCOPED to a subset
// of targets (e.g. the under-matured) rather than gating the whole world. This
// adds the optional scope column the refusal-field lib persists; absent scope =
// unscoped = today's behavior (every existing field). Additive, forward-only.

function columnExists(db, table, col) {
  try { return db.pragma(`table_info(${table})`).some((c) => c.name === col); }
  catch { return false; }
}
function addColumn(db, table, col, ddl) {
  if (!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(table)) return;
  if (!columnExists(db, table, col)) { try { db.exec(ddl); } catch { /* noop */ } }
}

export function up(db) {
  addColumn(db, "refusal_fields", "applies_to_json", "ALTER TABLE refusal_fields ADD COLUMN applies_to_json TEXT");
}

export function down(_db) {
  // forward-only (SQLite ADD COLUMN)
}
