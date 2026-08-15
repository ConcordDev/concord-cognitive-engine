#!/usr/bin/env node
/**
 * Backfill INT8 quantized embeddings for rows where quantized_int8 IS NULL.
 *
 * Usage: node scripts/backfill-int8-embeddings.js [path-to-sqlite-db]
 * Default: /opt/concord-db/concord.db (or $CONCORD_DB_PATH)
 *
 * Test against a copy (e.g. /tmp/concord-test.db) — NOT prod.
 * Yields every 100 rows to avoid blocking the event loop.
 */

import BetterSqlite3 from 'better-sqlite3';
import { setImmediate as sleep } from 'timers/promises';

function quantizeFloat32ToInt8(buffer) {
  const f32 = new Float32Array(buffer.buffer, buffer.byteOffset, buffer.byteLength / 4);
  let maxAbs = 0;
  for (const v of f32) {
    const abs = Math.abs(v);
    if (abs > maxAbs) maxAbs = abs;
  }
  const scale = maxAbs / 127 || 1e-12;
  const i8 = new Int8Array(f32.length);
  for (let i = 0; i < f32.length; i++) {
    let q = Math.round(f32[i] / scale);
    if (q > 127) q = 127;
    if (q < -128) q = -128;
    i8[i] = q;
  }
  return { blob: Buffer.from(i8), scale };
}

async function backfill(dbPath) {
  const db = new BetterSqlite3(dbPath);
  db.pragma('journal_mode = WAL');

  const selectStmt = db.prepare(
    'SELECT id, vector FROM embeddings_e5 WHERE quantized_int8 IS NULL'
  );
  const updateStmt = db.prepare(
    'UPDATE embeddings_e5 SET quantized_int8 = ?, quantization_scale = ?, quantization_method = ? WHERE id = ?'
  );

  let rows = selectStmt.all();
  let processed = 0;
  const startedAt = Date.now();
  for (const row of rows) {
    const { blob, scale } = quantizeFloat32ToInt8(row.vector);
    updateStmt.run(blob, scale, 'symmetric_int8', row.id);
    processed++;
    if (processed % 100 === 0) {
      await sleep(0);
    }
  }
  const elapsed = Date.now() - startedAt;
  console.log(`Backfilled ${processed} rows in ${elapsed}ms`);
  db.close();
}

const dbPath = process.argv[2] || process.env.CONCORD_DB_PATH || '/opt/concord-db/concord.db';
backfill(dbPath).catch(err => {
  console.error(err);
  process.exit(1);
});
