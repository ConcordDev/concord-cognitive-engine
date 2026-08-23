// 412_semantic_vectors_lattice_columns.js
// Sprint 60: Complete the semantic_vectors lattice schema
// The CSL embedding bridge expects these columns:
//   dtu_id, source_embedding_table, source_dim, quantizer_version, created_at
// Plus unique constraint on (dtu_id, quantizer_version) for ON CONFLICT.
// Migration is additive: only adds missing columns.

export async function up(db) {
  const cols = new Set(db.prepare("PRAGMA table_info(semantic_vectors)").all().map(c => c.name));
  const added = [];
  
  if (!cols.has('dtu_id')) {
    db.exec("ALTER TABLE semantic_vectors ADD COLUMN dtu_id TEXT");
    added.push('dtu_id');
  }
  if (!cols.has('source_embedding_table')) {
    db.exec("ALTER TABLE semantic_vectors ADD COLUMN source_embedding_table TEXT");
    added.push('source_embedding_table');
  }
  if (!cols.has('source_dim')) {
    db.exec("ALTER TABLE semantic_vectors ADD COLUMN source_dim INTEGER");
    added.push('source_dim');
  }
  if (!cols.has('quantizer_version')) {
    db.exec("ALTER TABLE semantic_vectors ADD COLUMN quantizer_version INTEGER");
    added.push('quantizer_version');
  }
  if (!cols.has('created_at')) {
    db.exec("ALTER TABLE semantic_vectors ADD COLUMN created_at INTEGER");
    added.push('created_at');
  }
  
  // Add index for the ON CONFLICT target
  db.exec("CREATE INDEX IF NOT EXISTS idx_semantic_vectors_dtu ON semantic_vectors(dtu_id)");
  
  return { added };
}

export async function down(db) {
  // No-op: SQLite ALTER TABLE DROP COLUMN requires newer SQLite
  return { noop: true };
}
