// server/lib/code/embeddings.js
//
// Code Sprint D — real ML embeddings via Ollama.
//
// Uses POST <ollama_url>/api/embeddings with the configured embedding
// model (defaults to nomic-embed-text — 768 dim, ~250MB, fast).
// Vectors stored as Float32 BLOBs in code_embeddings (migration 207).
// Query path: embed the query, cosine-similarity scan of the candidate
// set, top-K return.
//
// For corpora >100k vectors, swap the scan for qdrant. The contract
// stays the same.

const EMBED_MODEL = process.env.CONCORD_EMBED_MODEL || "nomic-embed-text";
const EMBED_URL = process.env.CONCORD_EMBED_URL
  || process.env.BRAIN_UTILITY_URL
  || process.env.BRAIN_CONSCIOUS_URL
  || "http://localhost:11434";

function f32ArrayToBuffer(arr) {
  const buf = Buffer.allocUnsafe(arr.length * 4);
  for (let i = 0; i < arr.length; i++) buf.writeFloatLE(arr[i], i * 4);
  return buf;
}

function bufferToF32Array(buf) {
  const arr = new Float32Array(buf.length / 4);
  for (let i = 0; i < arr.length; i++) arr[i] = buf.readFloatLE(i * 4);
  return arr;
}

function cosineSim(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

/**
 * Real Ollama /api/embeddings call. Returns { ok, vector, model, dim }.
 * Never throws; on failure returns { ok: false, reason }.
 */
export async function embedText(text, { model = EMBED_MODEL, url = EMBED_URL } = {}) {
  if (!text || typeof text !== "string") return { ok: false, reason: "text_required" };
  if (text.length > 32_000) text = text.slice(0, 32_000);
  try {
    const res = await fetch(`${url.replace(/\/$/, "")}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: text }),
    });
    if (!res.ok) return { ok: false, reason: "ollama_http_error", status: res.status };
    const json = await res.json();
    const vector = Array.isArray(json?.embedding) ? json.embedding : null;
    if (!vector || vector.length === 0) return { ok: false, reason: "no_embedding_returned", raw: json };
    return { ok: true, vector, model, dim: vector.length };
  } catch (err) {
    return { ok: false, reason: "ollama_unreachable", error: err?.message };
  }
}

/**
 * Persist an embedding. Idempotent on (source_type, source_id, model)
 * via UNIQUE in migration 207.
 */
export function persistEmbedding(db, { id, sourceType, sourceId, model, vector, textPreview }) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!sourceType || !sourceId) return { ok: false, reason: "source_required" };
  if (!Array.isArray(vector) || vector.length === 0) return { ok: false, reason: "vector_required" };
  const buf = f32ArrayToBuffer(vector);
  const _id = id || `emb_${sourceType}_${sourceId}_${model}`;
  try {
    db.prepare(`
      INSERT INTO code_embeddings (id, source_type, source_id, model, dim, vector, text_preview, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, unixepoch())
      ON CONFLICT(source_type, source_id, model) DO UPDATE SET
        vector = excluded.vector, dim = excluded.dim, text_preview = excluded.text_preview
    `).run(_id, sourceType, sourceId, model, vector.length, buf, (textPreview || "").slice(0, 500));
    return { ok: true, id: _id };
  } catch (err) {
    return { ok: false, reason: "insert_failed", error: err?.message };
  }
}

/**
 * Cosine-similarity scan against the embedding table. Returns top-K.
 *
 * @param {object} opts
 * @param {Array<number>} opts.queryVector
 * @param {string} [opts.sourceType] — filter by kind
 * @param {string} [opts.model]      — filter by model (defaults to query's)
 * @param {number} [opts.topK=10]
 * @param {number} [opts.minScore=0.0]
 */
export function semanticSearch(db, { queryVector, sourceType, model = EMBED_MODEL, topK = 10, minScore = 0.0 } = {}) {
  if (!db) return { ok: false, reason: "no_db" };
  if (!Array.isArray(queryVector) || queryVector.length === 0) return { ok: false, reason: "query_vector_required" };
  const qDim = queryVector.length;
  // Filter by exact dim to avoid mixing models silently
  const sql = sourceType
    ? `SELECT id, source_type, source_id, model, vector, text_preview FROM code_embeddings WHERE source_type = ? AND model = ? AND dim = ?`
    : `SELECT id, source_type, source_id, model, vector, text_preview FROM code_embeddings WHERE model = ? AND dim = ?`;
  const rows = sourceType
    ? db.prepare(sql).all(sourceType, model, qDim)
    : db.prepare(sql).all(model, qDim);
  const scored = [];
  for (const row of rows) {
    const v = bufferToF32Array(row.vector);
    const score = cosineSim(queryVector, v);
    if (score >= minScore) {
      scored.push({
        id: row.id, source_type: row.source_type, source_id: row.source_id,
        text_preview: row.text_preview, score,
      });
    }
  }
  scored.sort((a, b) => b.score - a.score);
  return { ok: true, model, dim: qDim, scanned: rows.length, results: scored.slice(0, topK) };
}

export const __test = { f32ArrayToBuffer, bufferToF32Array, cosineSim };
