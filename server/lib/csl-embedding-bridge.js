// csl-embedding-bridge.js — Sprint 33 Phase 3 deliverable (oc-embed).
//
// Bridges the authoritative E5 embedding pipeline (embeddings_e5, migration
// 405, 1024-dim mxbai-embed-large) into the `semantic_vectors` INT4 lattice
// rows that oc-pickle's csl-quad-retrieval.js reads. This module produces the
// lattice rows; it does NOT merge retrieval results (that's oc-pickle's job).
//
// ── "INT4" discrepancy, documented (spec Task 2) ────────────────────────────
// The v1 quantizer below is `Math.round(float * 127)` clamped to [-127, 127]
// — that's an INT8-range value, NOT a true 4-bit INT4 codec (range -7..7).
// The plan (docs/SPRINT-33-CSL-PLAN.md:47) explicitly says "Start with a
// simple Math.round(float * 127) quantizer. Can be a stub initially." — so
// INT8-range is the INTENDED v1. A future pass that wants real INT4 (4-bit,
// -7..7) is a separate codec change: bump quantizer_version, never rewrite
// rows in place.
//
// ── Coordinate scheme does NOT preserve cosine similarity ──────────────────
// vectorToLatticeCoords() bucket-hashes the full 1024-dim vector into 3
// lattice coordinates by summing three disjoint slice means. This is a coarse,
// cheap, reproducible bucket for the lattice's role as a RECALL-REDUNDANT
// PRE-FILTER (docs/SPRINT-33-ARCH-RISK-REGISTER.md:70) — never authoritative,
// never a cosine-similarity proxy. A real locality-preserving placement
// (space-filling curve over a PCA/UMAP projection) is separate follow-on work,
// explicitly out of scope for Sprint 33.
//
// ── Schema guard (honest failure) ──────────────────────────────────────────
// The spec's write path assumes `semantic_vectors` shaped per the operator's
// schema (docs/SPRINT-33-SPECS.md:78-91): columns dtu_id, lattice_x/y/z,
// source_embedding_table, source_dim, quantizer_version, created_at, with a
// UNIQUE(dtu_id, quantizer_version) constraint driving the idempotent
// ON CONFLICT upsert. If the applied migration's table lacks those columns,
// these functions fail honestly (`{ok:false, reason:'semantic_vectors_...'}`)
// instead of throwing a raw SQL error — see docs/SPRINT-33-EMBED-STATUS.md.
//
// Not a heartbeat module: no registerHeartbeat call in this file (spec Task 5).

const QUANT_SCALE = 127; // plan's literal suggestion — produces INT8-range
                         // ints (-127..127), NOT true INT4. See header note.
// Current scheme name — module-private (the spec'd export surface is exactly
// the 5 functions below). oc-pickle defaults to the newest version present in
// semantic_vectors via latticeNeighbors' guard; this constant exists so a
// future v2 pass has a single place to bump it.
const QUANTIZER_VERSION = "v1-bucket-mean-int8";

const REQUIRED_COLUMNS = [
  "dtu_id",
  "lattice_x",
  "lattice_y",
  "lattice_z",
  "source_embedding_table",
  "source_dim",
  "quantizer_version",
  "created_at",
];

// ── Quantizer (spec Task 2) ────────────────────────────────────────────────

export function quantizeComponent(float) {
  const v = Math.round(float * QUANT_SCALE);
  return Math.max(-QUANT_SCALE, Math.min(QUANT_SCALE, v)); // clamp
}

// ── Dimensionality reduction → 3 coordinates (spec Task 3) ─────────────────

export function vectorToLatticeCoords(vec /* Float32Array, len 1024 */) {
  // Deterministic, reproducible, NOT a real embedding-preserving projection —
  // this is explicitly a coarse recall-redundant bucket, never authoritative.
  // v1: sum three disjoint slices of the vector, quantize each mean.
  const third = Math.floor(vec.length / 3);
  const sumSlice = (start, end) => {
    let s = 0;
    for (let i = start; i < end; i++) s += vec[i];
    return s / (end - start); // mean of the slice, keeps scale bounded
  };
  return {
    lattice_x: quantizeComponent(sumSlice(0, third)),
    lattice_y: quantizeComponent(sumSlice(third, 2 * third)),
    lattice_z: quantizeComponent(sumSlice(2 * third, vec.length)),
  };
}

// ── Read path (spec Task 1) ────────────────────────────────────────────────
// Decodes embeddings_e5.vector the SAME way server/embeddings.js round-trips
// a Float32Array: store = Buffer.from(vec.buffer, byteOffset, byteLength)
// (embeddings.js:380, embed-backfill.js:112), read = new Float32Array(
// blob.buffer, blob.byteOffset, byteLength / 4) (embeddings.js:619-623).
async function readE5Vector(db, dtuId) {
  const row = db
    .prepare(
      "SELECT vector, dim, model FROM embeddings_e5 WHERE dtu_id = ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(dtuId);
  if (!row || !row.vector) return null;
  const vec = new Float32Array(
    row.vector.buffer,
    row.vector.byteOffset,
    row.vector.byteLength / Float32Array.BYTES_PER_ELEMENT
  );
  return { vec, dim: row.dim || 1024, model: row.model };
}

// ── Schema check (honest guard for the spec'd write path) ──────────────────
function latticeSchemaOk(db) {
  try {
    const cols = db.prepare("PRAGMA table_info(semantic_vectors)").all();
    const names = new Set(cols.map((c) => c.name));
    return REQUIRED_COLUMNS.every((c) => names.has(c));
  } catch {
    return false;
  }
}

// ── Write path (spec Task 4) ───────────────────────────────────────────────

export async function upsertLatticeRow(db, dtuId) {
  const found = await readE5Vector(db, dtuId);
  if (!found) return { ok: false, reason: "no_e5_vector" };
  if (!latticeSchemaOk(db)) return { ok: false, reason: "semantic_vectors_schema_mismatch" };

  const coords = vectorToLatticeCoords(found.vec);
  const created_at = Date.now();

  db.prepare(
    `INSERT INTO semantic_vectors
      (dtu_id, lattice_x, lattice_y, lattice_z, source_embedding_table, source_dim, quantizer_version, created_at)
     VALUES (?, ?, ?, ?, 'embeddings_e5', ?, ?, ?)
     ON CONFLICT(dtu_id, quantizer_version) DO UPDATE SET
       lattice_x = excluded.lattice_x,
       lattice_y = excluded.lattice_y,
       lattice_z = excluded.lattice_z,
       source_embedding_table = excluded.source_embedding_table,
       source_dim = excluded.source_dim,
       created_at = excluded.created_at`
  ).run(
    dtuId,
    coords.lattice_x,
    coords.lattice_y,
    coords.lattice_z,
    found.dim,
    QUANTIZER_VERSION,
    created_at
  );

  return { ok: true, dtu_id: dtuId, ...coords, quantizer_version: QUANTIZER_VERSION };
}

// ── Batch backfill (spec Task 5) ───────────────────────────────────────────
// Not a heartbeat registration — plain exported function per the spec.

export async function backfillLattice(db, { limit = 500 } = {}) {
  if (!latticeSchemaOk(db)) {
    return { ok: false, reason: "semantic_vectors_schema_mismatch", processed: 0, skipped: 0 };
  }

  const pending = db
    .prepare(
      `SELECT e5.dtu_id
       FROM embeddings_e5 e5
       LEFT JOIN semantic_vectors sv ON sv.dtu_id = e5.dtu_id
       WHERE sv.dtu_id IS NULL
       GROUP BY e5.dtu_id
       ORDER BY e5.dtu_id
       LIMIT ?`
    )
    .all(limit);

  let processed = 0;
  let skipped = 0;
  for (const row of pending) {
    const r = await upsertLatticeRow(db, row.dtu_id);
    if (r.ok) processed++;
    else skipped++;
  }

  return { ok: true, processed, skipped };
}

// ── Lattice query helper (spec Task 6, for oc-pickle) ──────────────────────
// Bounded box query. oc-pickle calls this; it doesn't write SQL against
// semantic_vectors itself. Defaults to the newest quantizer_version present
// so a transition to a newer scheme doesn't silently query stale rows (spec
// Task 7 re-quantization discipline).

export function latticeNeighbors(db, { lattice_x = 0, lattice_y = 0, lattice_z = 0 } = {}, radius = 5, limit = 30) {
  if (!latticeSchemaOk(db)) return [];
  try {
    return db
      .prepare(
        `SELECT dtu_id, lattice_x, lattice_y, lattice_z
         FROM semantic_vectors
         WHERE quantizer_version = (
           SELECT quantizer_version FROM semantic_vectors ORDER BY created_at DESC LIMIT 1
         )
           AND lattice_x BETWEEN ? AND ?
           AND lattice_y BETWEEN ? AND ?
           AND lattice_z BETWEEN ? AND ?
         LIMIT ?`
      )
      .all(
        lattice_x - radius,
        lattice_x + radius,
        lattice_y - radius,
        lattice_y + radius,
        lattice_z - radius,
        lattice_z + radius,
        limit
      );
  } catch {
    return [];
  }
}
