#!/usr/bin/env node
/**
 * Verify INT8 quantization accuracy on a random sample.
 *
 * Usage: node scripts/verify-int8-accuracy.js [path-to-sqlite-db]
 *
 * For each sampled row: dequantize the INT8, compare to original float32
 * via cosine similarity. Report mean, min, % > 0.99, % > 0.95.
 */

import BetterSqlite3 from 'better-sqlite3';

function dequantize(blob, scale) {
  const i8 = new Int8Array(blob.buffer, blob.byteOffset, blob.byteLength);
  const f32 = new Float32Array(i8.length);
  for (let i = 0; i < i8.length; i++) {
    f32[i] = i8[i] * scale;
  }
  return f32;
}

function cosineSim(a, b) {
  if (a.length !== b.length) return 0;
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-12);
}

const dbPath = process.argv[2] || process.env.CONCORD_DB_PATH || '/opt/concord-db/concord.db';
const SAMPLE_SIZE = parseInt(process.env.SAMPLE_SIZE || '100', 10);

const db = new BetterSqlite3(dbPath, { readonly: true });
const rows = db.prepare(
  'SELECT id, vector, quantized_int8, quantization_scale FROM embeddings_e5 WHERE quantized_int8 IS NOT NULL ORDER BY RANDOM() LIMIT ?'
).all(SAMPLE_SIZE);

if (rows.length === 0) {
  console.log('No quantized rows found. Run backfill-int8-embeddings.js first.');
  process.exit(0);
}

const sims = [];
for (const row of rows) {
  const orig = new Float32Array(row.vector.buffer, row.vector.byteOffset, row.vector.byteLength / 4);
  const deq = dequantize(row.quantized_int8, row.quantization_scale);
  sims.push(cosineSim(orig, deq));
}

sims.sort((a, b) => a - b);
const mean = sims.reduce((a, b) => a + b, 0) / sims.length;
const min = sims[0];
const max = sims[sims.length - 1];
const gt99 = sims.filter(s => s > 0.99).length / sims.length;
const gt95 = sims.filter(s => s > 0.95).length / sims.length;

console.log(`Sampled ${sims.length} rows from ${dbPath}`);
console.log(`Cosine similarity (original vs INT8-reconstructed):`);
console.log(`  mean: ${mean.toFixed(4)}`);
console.log(`  min:  ${min.toFixed(4)}`);
console.log(`  max:  ${max.toFixed(4)}`);
console.log(`  % > 0.99: ${(gt99 * 100).toFixed(1)}%`);
console.log(`  % > 0.95: ${(gt95 * 100).toFixed(1)}%`);
console.log();
if (gt99 > 0.95) {
  console.log('✓ TARGET MET: >95% of rows have >0.99 cosine similarity');
} else if (gt95 > 0.90) {
  console.log('⚠ ACCEPTABLE: >90% of rows have >0.95 cosine similarity');
} else {
  console.log('✗ BELOW TARGET: quantization is too lossy');
}
db.close();
