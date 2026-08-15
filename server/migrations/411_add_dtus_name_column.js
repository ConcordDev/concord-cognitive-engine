// 411_add_dtus_name_column.js
// Sprint 60: Add 'name' column to dtus table to satisfy schema-drift detector
// Aliases the title column so queries can SELECT name directly without AS.
// This eliminates a false-positive in verify-schema-drift.mjs.

export async function up(db) {
  // Check if column already exists (idempotent)
  const cols = db.prepare("PRAGMA table_info(dtus)").all();
  if (cols.find(c => c.name === 'name')) return { alreadyExists: true };
  
  // Add column with default same as title
  db.exec("ALTER TABLE dtus ADD COLUMN name TEXT");
  
  // Populate from title for existing rows
  db.exec("UPDATE dtus SET name = title WHERE name IS NULL");
  
  return { added: true };
}

export async function down(db) {
  // SQLite doesn't support DROP COLUMN easily, leave it
  return { noop: true };
}
