/**
 * Migration 410 — INT8 Quantized Embeddings
 *
 * Sprint 34: Add nullable INT8 quantized copies of embeddings.
 * Float32 vector stays as source of truth; INT8 is a 4x storage reduction.
 * Backfill is in scripts/backfill-int8-embeddings.js (run after this migration).
 * Quantization: symmetric per-tensor INT8 (scale = max_abs / 127).
 */

export function up(db) {
  db.exec(`
    ALTER TABLE embeddings_e5 ADD COLUMN quantized_int8 BLOB;
    ALTER TABLE embeddings_e5 ADD COLUMN quantization_method VARCHAR(32) DEFAULT 'symmetric_int8';
    ALTER TABLE embeddings_e5 ADD COLUMN quantization_scale REAL;

    CREATE INDEX IF NOT EXISTS idx_embeddings_e5_quant_method
      ON embeddings_e5(quantization_method)
      WHERE quantized_int8 IS NOT NULL;
  `);
}

export function down(db) {
  db.exec(`
    DROP INDEX IF EXISTS idx_embeddings_e5_quant_method;
    -- SQLite ALTER TABLE DROP COLUMN is supported in 3.35+; safe to use
    ALTER TABLE embeddings_e5 DROP COLUMN quantized_int8;
    ALTER TABLE embeddings_e5 DROP COLUMN quantization_method;
    ALTER TABLE embeddings_e5 DROP COLUMN quantization_scale;
  `);
}
