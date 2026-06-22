// server/lib/literary-vec.js
//
// LRL Phase 3 — corpus-scale dense retrieval via sqlite-vec (the vec0 ANN index
// living inside the same better-sqlite3 file). Replaces the in-memory full-scan
// cosine for the literary corpus once it grows past a few thousand chunks, while
// staying 100% local/sovereign (no external vector service).
//
// Kill-switch LRL_VECTOR_BACKEND: "sqlite-vec" (default) | "blob-cosine" | "off".
// Everything degrades gracefully — if the extension can't load (or the backend
// is disabled) ensureVec() returns false and callers fall back to the existing
// embedding_cache + cosineSimilarity scan. Never throws.
//
// vec0 keys on an integer rowid, so dtu_id (TEXT) rides as an auxiliary column;
// upsert is delete-then-insert (vec0 has no native UPSERT).

import { createRequire } from "module";

const require = createRequire(import.meta.url);
const DEFAULT_DIM = Number(process.env.LRL_VEC_DIM || process.env.EMBEDDING_DIMENSION || 768);
const BACKEND = process.env.LRL_VECTOR_BACKEND || "sqlite-vec";

let _sqliteVec = null;
let _sqliteVecTried = false;
const _ready = new WeakSet(); // dbs that have the extension loaded + table created
const _dims = new WeakMap(); // db -> dim used for its table

function loadModule() {
  if (_sqliteVecTried) return _sqliteVec;
  _sqliteVecTried = true;
  try { _sqliteVec = require("sqlite-vec"); } catch { _sqliteVec = null; }
  return _sqliteVec;
}

/**
 * Ensure the vec0 table exists on this db (loading the extension once per db).
 * @returns {boolean} true when sqlite-vec is usable for this db.
 */
export function ensureVec(db, dim = DEFAULT_DIM) {
  if (!db || BACKEND === "blob-cosine" || BACKEND === "off") return false;
  if (_ready.has(db)) return true;
  const mod = loadModule();
  if (!mod) return false;
  try {
    mod.load(db);
    db.exec(`CREATE VIRTUAL TABLE IF NOT EXISTS literary_vec USING vec0(dtu_id text, embedding float[${dim}])`);
    _ready.add(db);
    _dims.set(db, dim);
    return true;
  } catch {
    return false;
  }
}

export function isVecAvailable(db) {
  return _ready.has(db);
}

function toBuf(vec) {
  const f = vec instanceof Float32Array ? vec : Float32Array.from(vec);
  return Buffer.from(f.buffer, f.byteOffset, f.byteLength);
}

/** Upsert one vector (delete-then-insert). Best-effort; returns boolean. */
export function upsertVec(db, dtuId, vec, dim = DEFAULT_DIM) {
  if (!ensureVec(db, dim)) return false;
  try {
    const tx = db.transaction(() => {
      db.prepare("DELETE FROM literary_vec WHERE dtu_id = ?").run(dtuId);
      db.prepare("INSERT INTO literary_vec(dtu_id, embedding) VALUES (?, ?)").run(dtuId, toBuf(vec));
    });
    tx();
    return true;
  } catch {
    return false;
  }
}

/**
 * KNN over the literary vec0 index.
 * @returns {Array<{dtuId:string, distance:number}>|null} null when unavailable.
 */
export function searchVec(db, queryVec, k = 50, dim = DEFAULT_DIM) {
  if (!ensureVec(db, dim)) return null;
  try {
    const rows = db.prepare(`
      SELECT dtu_id AS dtuId, distance
      FROM literary_vec
      WHERE embedding MATCH ? AND k = ?
      ORDER BY distance
    `).all(toBuf(queryVec), Math.max(1, Math.min(Number(k) || 50, 500)));
    return rows;
  } catch {
    return null;
  }
}

export function removeVec(db, dtuId) {
  if (!_ready.has(db)) return;
  try { db.prepare("DELETE FROM literary_vec WHERE dtu_id = ?").run(dtuId); } catch { /* best-effort */ }
}

export default { ensureVec, isVecAvailable, upsertVec, searchVec, removeVec };
