// server/lib/qdrant-client.js
//
// Item 1 — a no-dependency Qdrant REST client over native `fetch` (the codebase
// already calls Ollama this way). Wires the provisioned-but-unused Qdrant
// container into the embedding substrate as an ANN index, while the in-process
// cosine + keyword path stays the offline fallback. EVERY call is try/catch and
// returns `{ ok:false, reason }` — a Qdrant outage degrades silently, never
// throws, never blocks a DTU write or a retrieval.
//
// Enabled only when VECTOR_DB=qdrant AND the host is reachable. Point id is a
// deterministic UUID derived from the dtuId (Qdrant point ids must be uint or
// UUID) → idempotent upserts; the real dtuId rides in the payload for hydration.

import crypto from "node:crypto";

const COLLECTION = process.env.QDRANT_COLLECTION || "concord_embeddings";

function baseUrl() {
  const host = process.env.QDRANT_HOST || process.env.VECTOR_DB_HOST || "localhost";
  const port = process.env.QDRANT_PORT || "6333";
  const scheme = process.env.QDRANT_HTTPS === "1" ? "https" : "http";
  return `${scheme}://${host}:${port}`;
}
function headers() {
  const h = { "Content-Type": "application/json" };
  if (process.env.QDRANT_API_KEY) h["api-key"] = process.env.QDRANT_API_KEY;
  return h;
}

let _enabled = null; // null = unprobed
let _collectionReady = false;

/** True when the operator has opted into Qdrant (VECTOR_DB=qdrant). */
export function configured() {
  return String(process.env.VECTOR_DB || "").toLowerCase() === "qdrant";
}

async function _req(path, { method = "GET", body, timeoutMs = 4000 } = {}) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${baseUrl()}${path}`, {
      method,
      headers: headers(),
      body: body ? JSON.stringify(body) : undefined,
      signal: ctrl.signal,
    });
    let json = {};
    try { json = await res.json(); } catch { /* non-JSON (e.g. /readyz) */ }
    return { ok: res.ok, status: res.status, json };
  } catch (e) {
    return { ok: false, error: String(e?.message || e) };
  } finally {
    clearTimeout(timer);
  }
}

/** Reachability probe (cached). False unless configured + host responds. */
export async function isEnabled() {
  if (!configured()) return false;
  if (_enabled !== null) return _enabled;
  const r = await _req("/readyz", { timeoutMs: 1500 });
  _enabled = r.ok ? true : (await _req("/collections", { timeoutMs: 1500 })).ok;
  return _enabled;
}

/** Deterministic UUID for a dtuId (Qdrant point ids must be uint or UUID). */
export function pointIdFor(dtuId) {
  const h = crypto.createHash("md5").update(String(dtuId)).digest("hex");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
}

/** Create the collection (idempotent) with cosine HNSW matching the vector dim. */
export async function ensureCollection(dim) {
  if (_collectionReady) return { ok: true };
  if (!(await isEnabled())) return { ok: false, reason: "qdrant_disabled" };
  const exists = await _req(`/collections/${COLLECTION}`, { timeoutMs: 3000 });
  if (exists.ok && exists.json?.result) { _collectionReady = true; return { ok: true }; }
  const r = await _req(`/collections/${COLLECTION}`, {
    method: "PUT",
    body: { vectors: { size: dim, distance: "Cosine" }, hnsw_config: { m: 16, ef_construct: 200 } },
    timeoutMs: 8000,
  });
  _collectionReady = r.ok;
  return r.ok ? { ok: true } : { ok: false, reason: "create_failed", status: r.status };
}

function _toArray(vec) { return vec instanceof Float32Array ? Array.from(vec) : Array.from(vec || []); }

/** Fire-and-forget single upsert (idempotent on dtuId). */
export async function upsert(dtuId, vector, payload = {}) {
  if (!dtuId || !vector || !vector.length) return { ok: false, reason: "bad_args" };
  if (!(await isEnabled())) return { ok: false, reason: "qdrant_disabled" };
  await ensureCollection(vector.length);
  const r = await _req(`/collections/${COLLECTION}/points`, {
    method: "PUT",
    body: { points: [{ id: pointIdFor(dtuId), vector: _toArray(vector), payload: { dtuId, ...payload } }] },
    timeoutMs: 5000,
  });
  return r.ok ? { ok: true } : { ok: false, reason: "upsert_failed", status: r.status };
}

/** Bulk upsert — batch ≤ 1000 to stay under Qdrant's 32 MiB REST cap. */
export async function upsertBatch(items) {
  const list = (items || []).filter((it) => it?.dtuId && it?.vector?.length);
  if (!list.length) return { ok: true, count: 0 };
  if (!(await isEnabled())) return { ok: false, reason: "qdrant_disabled" };
  await ensureCollection(list[0].vector.length);
  let count = 0;
  for (let i = 0; i < list.length; i += 1000) {
    const points = list.slice(i, i + 1000).map((it) => ({ id: pointIdFor(it.dtuId), vector: _toArray(it.vector), payload: { dtuId: it.dtuId, ...(it.payload || {}) } }));
    const r = await _req(`/collections/${COLLECTION}/points`, { method: "PUT", body: { points }, timeoutMs: 20000 });
    if (!r.ok) return { ok: false, reason: "batch_failed", status: r.status, count };
    count += points.length;
  }
  return { ok: true, count };
}

/** ANN search → [{ dtuId, score }]. Empty + ok:false on outage (caller falls back). */
export async function search(vector, topK = 50, filter = null) {
  if (!vector || !vector.length) return { ok: false, reason: "bad_args", hits: [] };
  if (!(await isEnabled())) return { ok: false, reason: "qdrant_disabled", hits: [] };
  const body = { vector: _toArray(vector), limit: topK, with_payload: true };
  if (filter) body.filter = filter;
  const r = await _req(`/collections/${COLLECTION}/points/search`, { method: "POST", body, timeoutMs: 5000 });
  if (!r.ok) return { ok: false, reason: "search_failed", hits: [] };
  const hits = (r.json?.result || []).map((h) => ({ dtuId: h.payload?.dtuId || null, score: h.score })).filter((h) => h.dtuId);
  return { ok: true, hits };
}

/** Test seam — clear the cached reachability/collection state. */
export function _resetCache() { _enabled = null; _collectionReady = false; }

export default { configured, isEnabled, pointIdFor, ensureCollection, upsert, upsertBatch, search, _resetCache };
