/**
 * Embedding Infrastructure for Concord Cognitive Engine
 *
 * Provides semantic embedding generation via local Ollama instances.
 * Sprint 32 E5: migrated to mxbai-embed-large (1024-dim, MTEB SOTA).
 * (intfloat/e5-large-v2 was planned but not available in ollama library;
 * mxbai is drop-in compatible, same prefixes + dimension.)
 *
 * Core API:
 *   embed(text, type)                   → Float32Array (type: 'query'|'passage')
 *   cosineSimilarity(vecA, vecB)        → number
 *   findSimilar(queryVec, candidates, topK) → DTU[]
 *   findCrossDomainConnections(dtuId, limit) → DTU[]
 *
 * Rules:
 *   1. Embedding generation NEVER blocks DTU creation — embed async after save
 *   2. If embedding model unavailable, fall back to tag-based retrieval
 *   3. Always include HYPERs and MEGAs in candidate pool regardless of lens
 *   4. Embedding dimension must be consistent — don't mix models
 *   5. Memory stays under control — batched search if substrate > 150K DTUs
 *   6. MTEB models require prefix: "query: " for searches, "passage: " for documents
 */

import crypto from "crypto";
import * as presenceIdle from "./lib/presence-idle.js";
import logger from './logger.js';
import _qdrant from "./lib/qdrant-client.js";
import { admitExecution } from "./lib/background-governor.js";

// ── Configuration ──────────────────────────────────────────────────────────
const EMBEDDING_MODEL = process.env.CONCORD_EMBED_MODEL || "mxbai-embed-large";
const EMBEDDING_FALLBACK_MODEL = "all-minilm";
const EMBEDDING_DIMENSION = Number(process.env.CONCORD_EMBED_DIM) || 1024; // 1024-dim for mxbai/e5
const EMBEDDING_QUERY_PREFIX = process.env.CONCORD_EMBED_QUERY_PREFIX || "query: ";
const EMBEDDING_PASSAGE_PREFIX = process.env.CONCORD_EMBED_PASSAGE_PREFIX || "passage: ";
// In-memory embedding cache cap. At ~3KB per Float32Array (768 dims) the
// default 150k entries occupy ~450MB. Operators on smaller boxes can shrink
// via CONCORD_EMBEDDING_CACHE_MAX. SQLite remains the source of truth;
// over-cap embeddings fall through to disk lookup.
const MAX_IN_MEMORY = Number(process.env.CONCORD_EMBEDDING_CACHE_MAX) || 150_000;
const BACKFILL_BATCH_SIZE = 50;   // Smaller batches to limit RSS growth
// Sprint 32 — was 5_000 ms, which was tuned for GPU hosts. The deployed
// pod (RunPod CPU-only A40 container with 7 Ollama instances sharing
// 9 cores) frequently hits 5-15s on a single embed call under heartbeat
// load, so the 5s AbortSignal timeout was tripping the embeddings
// circuit breaker 8x in a row and locking out all embeddings for 30s.
// 30s is generous enough to ride out a CPU contention spike without
// hitting the half-open probe budget. Override via CONCORD_EMBED_TIMEOUT_MS.
const EMBED_TIMEOUT_MS = Number(process.env.CONCORD_EMBED_TIMEOUT_MS) || 30_000;

// ── State ──────────────────────────────────────────────────────────────────

/** @type {Map<string, Float32Array>} In-memory embedding cache (dtuId → vector) */
const embeddingCache = new Map();

/** @type {{ available: boolean, model: string|null, dimension: number, ollamaUrl: string|null }} */
const embeddingState = {
  available: false,
  model: null,
  dimension: EMBEDDING_DIMENSION,
  ollamaUrl: null,
  /** "ollama" | "local" | null */
  backend: null,
  /** SQLite table holding this model's vectors (one table per model). */
  table: "embedding_cache",
  /** Why embeddings are unavailable, when they are. */
  reason: null,
  stats: {
    totalEmbedded: 0,
    totalRequests: 0,
    totalErrors: 0,
    avgEmbedMs: 0,
    backfillComplete: false,
    backfillProgress: 0,
    backfillTotal: 0,
  },
};

/** @type {import("better-sqlite3").Database|null} */
let _db = null;

/** @type {Function|null} Reference to structuredLog from server.js */
let _log = null;

// ── Model-scoped storage + local fallback ──────────────────────────────────
//
// 2026-10-22: with the GPU pod down, no Ollama on the host served an
// embedding model, so this layer declared itself unavailable at boot and
// semantic search stayed OFF until the next restart — even though server.js
// already runs a small CPU embedder (Xenova all-MiniLM-L6-v2, in a worker
// thread). Now:
//   - server.js registers that CPU embedder via setLocalEmbedder(); it is
//     used when no Ollama embedding model is reachable.
//   - Vectors are stored PER MODEL (rule 4: never mix models). The primary
//     model keeps the historical `embedding_cache` table; any other model
//     gets `embedding_cache__<model>`. (Previously the Ollama all-minilm
//     fallback wrote 384-dim vectors into the 1024-dim table.)
//   - reprobeEmbeddings() re-checks Ollama while on the fallback and switches
//     back to the primary model (and its stored vectors) when it returns.
const PRIMARY_TABLE = "embedding_cache";
let _ollamaUrls = [];
/** @type {{ model: string, dimension: number, embed: (text: string) => Promise<ArrayLike<number>> }|null} */
let _local = null;
let _reprobing = false;

/** SQLite table name for a model's vectors. */
export function tableForModel(model) {
  if (!model || model === EMBEDDING_MODEL) return PRIMARY_TABLE;
  const slug = String(model).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `${PRIMARY_TABLE}__${slug}`;
}

function _ensureTable(name) {
  if (!_db) return;
  _db.exec(`
    CREATE TABLE IF NOT EXISTS ${name} (
      dtu_id TEXT PRIMARY KEY,
      embedding BLOB NOT NULL,
      hash TEXT,
      created_at TEXT NOT NULL
    )
  `);
}

/** Every per-model embedding table that exists (for deletes). */
function _embeddingTables() {
  if (!_db) return [];
  try {
    return _db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()
      .map((r) => r.name)
      .filter((n) => n === PRIMARY_TABLE || n.startsWith(`${PRIMARY_TABLE}__`));
  } catch { return [PRIMARY_TABLE]; }
}

/** Switch the active model: state, table, and the in-memory cache. */
function _activate({ backend, model, url = null, dimension }) {
  embeddingState.available = true;
  embeddingState.backend = backend;
  embeddingState.model = model;
  embeddingState.ollamaUrl = url;
  embeddingState.dimension = dimension || embeddingState.dimension;
  embeddingState.reason = null;
  embeddingState.table = tableForModel(model);
  embeddingState.stats.backfillComplete = false;
  try { _ensureTable(embeddingState.table); } catch (e) {
    if (_log) _log("warn", "embedding_table_create_failed", { table: embeddingState.table, error: String(e?.message || e) });
  }
  embeddingCache.clear();
  if (_db) _loadEmbeddingsFromDb();
}

async function _probeOllama() {
  for (const url of _ollamaUrls) {
    try {
      const probe = await _probeEmbeddingModel(url, EMBEDDING_MODEL);
      if (probe.ok) return { model: EMBEDDING_MODEL, url, dimension: probe.dimension || EMBEDDING_DIMENSION, fallback: false };
      const fb = await _probeEmbeddingModel(url, EMBEDDING_FALLBACK_MODEL);
      if (fb.ok) return { model: EMBEDDING_FALLBACK_MODEL, url, dimension: fb.dimension || 384, fallback: true };
    } catch { /* try next */ }
  }
  return null;
}

/**
 * Register a local (in-process / worker) embedder used when no Ollama
 * embedding model is reachable. Activates it immediately if embeddings are
 * currently unavailable.
 * @returns {boolean} true if it was activated now
 */
export function setLocalEmbedder(local) {
  if (!local || typeof local.embed !== "function" || !local.model) return false;
  _local = local;
  if (embeddingState.available) return false;
  _activate({ backend: "local", model: local.model, dimension: local.dimension });
  if (_log) _log("info", "embeddings_ready_local", { model: local.model, dimension: local.dimension, table: embeddingState.table, cached: embeddingCache.size });
  return true;
}

/**
 * While not on Ollama, re-check whether an Ollama embedding model is back
 * and switch to it (and its stored vectors).
 * @returns {Promise<{ changed: boolean, model?: string }>}
 */
export async function reprobeEmbeddings() {
  if (embeddingState.backend === "ollama" || _reprobing || _ollamaUrls.length === 0) return { changed: false };
  _reprobing = true;
  try {
    const found = await _probeOllama();
    if (!found) return { changed: false };
    _activate({ backend: "ollama", model: found.model, url: found.url, dimension: found.dimension });
    if (_log) _log("info", found.fallback ? "embeddings_ready_fallback" : "embeddings_ready", { model: found.model, url: found.url, dimension: embeddingState.dimension, switchedFrom: "local_or_unavailable", cached: embeddingCache.size });
    return { changed: true, model: found.model };
  } finally {
    _reprobing = false;
  }
}

// ── Initialisation ─────────────────────────────────────────────────────────

/**
 * Initialise the embedding subsystem.
 * Call once at server startup after DB and Ollama are ready.
 *
 * @param {{ db: object|null, ollamaUrls: string[], structuredLog: Function }} opts
 */
export async function initEmbeddings({ db = null, ollamaUrls = [], structuredLog = console.warn } = {}) {
  _db = db;
  _ollamaUrls = [...new Set(ollamaUrls.filter(Boolean))];

  // Ensure dedicated embeddings table exists (separate from dtu_store)
  if (_db) {
    try {
      _db.exec(`
        CREATE TABLE IF NOT EXISTS embedding_cache (
          dtu_id TEXT PRIMARY KEY,
          embedding BLOB NOT NULL,
          hash TEXT,
          created_at TEXT NOT NULL
        )
      `);
    } catch (e) {
      structuredLog("warn", "embedding_table_create_failed", { error: String(e?.message || e) });
    }
  }
  _log = structuredLog;

  // Ensure SQLite column exists
  if (_db) {
    try {
      _db.exec(`ALTER TABLE dtus ADD COLUMN embedding BLOB`);
    } catch {
      // Column already exists — expected on subsequent starts
    }
    try {
      _db.exec(`CREATE INDEX IF NOT EXISTS idx_dtus_embedding ON dtus(id) WHERE embedding IS NOT NULL`);
    } catch {
      // Index may already exist
    }
  }

  // Probe Ollama instances for embedding model availability; fall back to the
  // registered local embedder (if server.js has already registered it).
  const found = await _probeOllama();
  if (found) {
    _activate({ backend: "ollama", model: found.model, url: found.url, dimension: found.dimension });
    _log("info", found.fallback ? "embeddings_ready_fallback" : "embeddings_ready", { model: found.model, url: found.url, dimension: embeddingState.dimension, table: embeddingState.table });
  } else if (_local) {
    _activate({ backend: "local", model: _local.model, dimension: _local.dimension });
    _log("info", "embeddings_ready_local", { model: _local.model, dimension: _local.dimension, table: embeddingState.table, cached: embeddingCache.size });
  } else {
    embeddingState.reason = "no_ollama_embedding_model";
    _log("warn", "embeddings_unavailable", { tried: _ollamaUrls, models: [EMBEDDING_MODEL, EMBEDDING_FALLBACK_MODEL], localEmbedder: "not_registered_yet" });
  }

  return { available: embeddingState.available, model: embeddingState.model };
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Generate an embedding vector for the given text.
 * Returns null if the embedding model is unavailable.
 *
 * @param {string} text
 * @param {string} type - 'query' (prepend query prefix) or 'passage' (prepend passage prefix)
 * @returns {Promise<Float32Array|null>}
 */
export async function embed(text, type = "passage", { timeoutMs = EMBED_TIMEOUT_MS } = {}) {
  if (!embeddingState.available) return null;

  const trimmed = String(text || "").trim().slice(0, 8192); // Model context limit
  if (!trimmed) return null;

  if (embeddingState.backend === "local") return _embedLocal(trimmed);
  if (!embeddingState.ollamaUrl) return null;

  // E5 models require prefixes for optimal performance
  const prefix = type === "query" ? EMBEDDING_QUERY_PREFIX : EMBEDDING_PASSAGE_PREFIX;
  const textWithPrefix = prefix + trimmed;

  embeddingState.stats.totalRequests++;
  const start = Date.now();

  try {
    // /api/embed with truncate:true — mxbai-embed-large has a 512-token
    // context and the legacy /api/embeddings endpoint answers HTTP 500
    // "input length exceeds the context length" for any longer DTU (that was
    // >50% of backfill calls on 2026-10-18). Fall back to the legacy
    // endpoint only on an Ollama too old to have /api/embed (404).
    const signal = AbortSignal.timeout(timeoutMs);
    let response = await fetch(`${embeddingState.ollamaUrl}/api/embed`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: embeddingState.model, input: textWithPrefix, truncate: true }),
      signal,
    });
    let legacy = false;
    if (response.status === 404) {
      legacy = true;
      response = await fetch(`${embeddingState.ollamaUrl}/api/embeddings`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: embeddingState.model, prompt: textWithPrefix }),
        signal,
      });
    }

    if (!response.ok) {
      embeddingState.stats.totalErrors++;
      embeddingState.stats.lastError = `HTTP ${response.status}`;
      if (_log) _log("warn", "embed_http_error", { status: response.status, legacy });
      return null;
    }

    const data = await response.json();
    const vec = legacy ? data.embedding : (Array.isArray(data.embeddings) ? data.embeddings[0] : data.embedding);

    if (!Array.isArray(vec) || vec.length === 0) {
      embeddingState.stats.totalErrors++;
      return null;
    }

    // Validate dimension matches expected (1024 for e5-large-v2)
    if (vec.length !== EMBEDDING_DIMENSION) {
      if (_log) {
        _log("warn", "embed_dimension_mismatch", {
          expected: EMBEDDING_DIMENSION,
          got: vec.length,
          model: embeddingState.model
        });
      }
    }

    // Track dimension on first successful call
    if (embeddingState.dimension !== vec.length) {
      embeddingState.dimension = vec.length;
    }

    const elapsed = Date.now() - start;
    embeddingState.stats.totalEmbedded++;
    embeddingState.stats.avgEmbedMs = Math.round(
      (embeddingState.stats.avgEmbedMs * (embeddingState.stats.totalEmbedded - 1) + elapsed) /
      embeddingState.stats.totalEmbedded
    );

    return new Float32Array(vec);
  } catch (e) {
    embeddingState.stats.totalErrors++;
    if (_log) _log("warn", "embed_error", { error: String(e?.message || e) });
    return null;
  }
}

// Local (CPU worker) path. No E5 query/passage prefixes — MiniLM is not
// trained with them.
async function _embedLocal(text) {
  if (!_local) return null;
  embeddingState.stats.totalRequests++;
  const start = Date.now();
  try {
    const out = await _local.embed(text);
    if (!out || !out.length) { embeddingState.stats.totalErrors++; return null; }
    const vec = out instanceof Float32Array ? out : Float32Array.from(out);
    const elapsed = Date.now() - start;
    embeddingState.stats.totalEmbedded++;
    embeddingState.stats.avgEmbedMs = Math.round(
      (embeddingState.stats.avgEmbedMs * (embeddingState.stats.totalEmbedded - 1) + elapsed) /
      embeddingState.stats.totalEmbedded
    );
    return vec;
  } catch (e) {
    embeddingState.stats.totalErrors++;
    if (_log) _log("warn", "embed_error", { backend: "local", error: String(e?.message || e) });
    return null;
  }
}

/**
 * Cosine similarity between two embedding vectors.
 * Returns 0 if inputs are invalid.
 *
 * @param {Float32Array|number[]} vecA
 * @param {Float32Array|number[]} vecB
 * @returns {number} Similarity in [-1, 1]
 */
export function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length || vecA.length === 0) return 0;

  let dot = 0, magA = 0, magB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    magA += vecA[i] * vecA[i];
    magB += vecB[i] * vecB[i];
  }

  const denom = Math.sqrt(magA) * Math.sqrt(magB);
  return denom === 0 ? 0 : dot / denom;
}

/**
 * Find the top-K most similar DTUs to a query embedding.
 * Applies tier weighting: HYPER 3x, MEGA 2x, regular 1x.
 *
 * @param {Float32Array} queryVec
 * @param {{ id: string, tier?: string, embedding?: Float32Array }[]} candidates
 * @param {number} topK
 * @returns {{ id: string, score: number, tier?: string }[]}
 */
export function findSimilar(queryVec, candidates, topK = 10) {
  if (!queryVec || !candidates || candidates.length === 0) return [];

  const scored = [];
  for (const c of candidates) {
    const vec = c.embedding || embeddingCache.get(c.id);
    if (!vec) continue;

    const sim = cosineSimilarity(queryVec, vec);
    const tierWeight = c.tier === "hyper" ? 3.0 : c.tier === "mega" ? 2.0 : 1.0;
    scored.push({ ...c, score: sim * tierWeight, rawSimilarity: sim });
  }

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, topK);
}

/**
 * Semantic search: embed the query and find similar DTUs.
 * Falls back to empty results if embeddings unavailable.
 *
 * @param {string} query
 * @param {{ id: string, tier?: string, tags?: string[] }[]} candidates - DTU-like objects
 * @param {{ lens?: string|null, topK?: number, includeHighTier?: boolean }} opts
 * @returns {Promise<{ id: string, score: number }[]>}
 */
export async function semanticSearch(query, candidates, { lens = null, topK = 10, includeHighTier = true } = {}) {
  // Search runs on the request path (chat retrieval): a slow or unreachable
  // embed host must degrade to keyword retrieval fast, not hold the chat
  // for the 30s backfill timeout.
  const queryVec = await embed(query, "passage", { timeoutMs: Number(process.env.CONCORD_EMBED_QUERY_TIMEOUT_MS) || 3000 });
  if (!queryVec) return [];

  // Filter candidates by lens if specified
  let pool = candidates;
  if (lens) {
    pool = candidates.filter(d => {
      // Always include HYPERs and MEGAs regardless of lens filter
      if (includeHighTier && (d.tier === "hyper" || d.tier === "mega")) return true;
      return Array.isArray(d.tags) && d.tags.some(t => t.toLowerCase() === lens.toLowerCase());
    });
  }

  // Attach cached embeddings
  const withEmbeddings = pool.map(d => ({
    ...d,
    embedding: d.embedding || embeddingCache.get(d.id),
  }));

  return findSimilar(queryVec, withEmbeddings, topK);
}

/**
 * Find cross-domain connections for a DTU.
 * Searches ALL DTUs except those sharing the source DTU's primary tag/domain.
 *
 * @param {string} dtuId
 * @param {{ id: string, tags?: string[], tier?: string }[]} allDTUs
 * @param {number} limit
 * @returns {Promise<{ id: string, score: number, title?: string, sourceDomain?: string }[]>}
 */
export async function findCrossDomainConnections(dtuId, allDTUs, limit = 5) {
  const source = allDTUs.find(d => d.id === dtuId);
  if (!source) return [];

  const sourceVec = embeddingCache.get(dtuId);
  if (!sourceVec) return [];

  const sourceTags = new Set((source.tags || []).map(t => t.toLowerCase()));
  const primaryTag = (source.tags || [])[0]?.toLowerCase() || null;

  // Filter to only cross-domain candidates (different primary tag)
  const candidates = allDTUs.filter(d => {
    if (d.id === dtuId) return false;
    if (!primaryTag) return true;
    const dPrimary = (d.tags || [])[0]?.toLowerCase() || null;
    return dPrimary !== primaryTag;
  });

  const results = findSimilar(sourceVec, candidates, limit);

  return results.map(r => ({
    id: r.id,
    score: r.score,
    rawSimilarity: r.rawSimilarity,
    title: r.title,
    sourceDomain: (r.tags || [])[0] || "unknown",
    tier: r.tier,
  }));
}

// ── Embedding Cache Management ─────────────────────────────────────────────

/**
 * Store an embedding in both cache and SQLite.
 * Called after DTU creation (fire-and-forget).
 *
 * @param {string} dtuId
 * @param {Float32Array} vec
 */
export function storeEmbedding(dtuId, vec, model = embeddingState.model) {
  if (!dtuId || !vec) return;
  // A vector computed by a model that is no longer active (switch happened
  // mid-embed) must not land in the new model's table or cache.
  if (model !== embeddingState.model) return;

  // In-memory cache (respect limit, evict oldest on overflow). Insertion
  // order = approximate LRU because Map preserves it; evicting the first
  // key drops the coldest entry. SQLite persistence below means evicted
  // entries can still be loaded back on demand.
  if (embeddingCache.size >= MAX_IN_MEMORY) {
    const oldestKey = embeddingCache.keys().next().value;
    if (oldestKey !== undefined) embeddingCache.delete(oldestKey);
  }
  embeddingCache.set(dtuId, vec);

  // SQLite persistence (dedicated embedding_cache table)
  if (_db) {
    try {
      const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
      _db.prepare(`INSERT OR REPLACE INTO ${embeddingState.table} (dtu_id, embedding, created_at) VALUES (?, ?, ?)`).run(dtuId, buf, new Date().toISOString());
    } catch {
      // Table may not exist yet — silent
    }
  }

  // Qdrant ANN index (Item 1) — fire-and-forget, no-op unless VECTOR_DB=qdrant +
  // reachable. Never blocks the write; the in-process cache above stays the
  // source of truth + offline fallback.
  // The Qdrant collection is sized for the primary model only.
  if (embeddingState.table === PRIMARY_TABLE && _qdrant?.configured?.()) {
    _qdrant.upsert(dtuId, vec).catch(() => { /* degrade-gracefully */ });
  }
}

/**
 * Get a cached embedding for a DTU.
 *
 * @param {string} dtuId
 * @returns {Float32Array|null}
 */
export function getEmbedding(dtuId) {
  return embeddingCache.get(dtuId) || null;
}

/**
 * Remove an embedding when a DTU is deleted.
 *
 * @param {string} dtuId
 */
export function removeEmbedding(dtuId) {
  embeddingCache.delete(dtuId);
  if (_db) {
    try {
      for (const t of _embeddingTables()) _db.prepare(`DELETE FROM ${t} WHERE dtu_id = ?`).run(dtuId);
    } catch (_e) { logger.debug('embeddings', 'silent', { error: _e?.message }); }
  }
}

/**
 * Embed a DTU's text content and store the result.
 * This is the main hook called after DTU creation.
 * NEVER blocks — always fire-and-forget.
 *
 * @param {{ id: string, title?: string, tags?: string[], human?: object, cretiHuman?: string, machine?: object }} dtu
 * @returns {Promise<void>}
 */
export async function embedDTU(dtu) {
  if (!embeddingState.available || !dtu?.id) return "unavailable";

  // Build embedding text from DTU content
  const parts = [
    dtu.title || "",
    Array.isArray(dtu.tags) ? dtu.tags.join(" ") : "",
    dtu.cretiHuman || dtu.creti || "",
    dtu.human?.summary || "",
    Array.isArray(dtu.human?.bullets) ? dtu.human.bullets.join(" ") : "",
    Array.isArray(dtu.core?.definitions) ? dtu.core.definitions.join(" ") : "",
    Array.isArray(dtu.core?.claims) ? dtu.core.claims.join(" ") : "",
    dtu.machine?.notes || "",
    // Fallbacks for DTU shapes that carry their text outside human/core.
    typeof dtu.content === "string" ? dtu.content : "",
    typeof dtu.body === "string" ? dtu.body : "",
    typeof dtu.summary === "string" ? dtu.summary : "",
  ];

  const text = parts.filter(Boolean).join(" ").slice(0, 8192);
  if (!text.trim()) return "empty";

  try {
    const model = embeddingState.model;
    const vec = await embed(text);
    if (vec) {
      if (model !== embeddingState.model) return "model_switched";
      storeEmbedding(dtu.id, vec, model);
      return "embedded";
    }
    return "embed_failed";
  } catch (e) {
    if (_log) _log("warn", "embed_dtu_failed", { dtuId: dtu.id, error: String(e?.message || e) });
    return "embed_threw";
  }
}

// ── Backfill ───────────────────────────────────────────────────────────────

/**
 * Backfill embeddings for all DTUs that don't have one.
 * Processes in batches to avoid memory issues. Can run while server is live.
 *
 * @param {Map<string, object>} dtusMap - STATE.dtus
 * @param {{ onProgress?: Function }} opts
 * @returns {Promise<{ embedded: number, skipped: number, errors: number }>}
 */
export async function backfillEmbeddings(dtusMap, { onProgress = null, governed = process.env.CONCORD_EMBED_GOVERNED === "1" } = {}) {
  // Sprint 60+ — idle gate. Backfill processes every DTU through the embedding
  // model (one LLM call each). With no users, this is pure waste — UNLESS the
  // embed model runs on the dedicated background brain (pod offload,
  // CONCORD_EMBED_GOVERNED=1): then the background governor throttles each
  // call and pauses the backfill whenever its breaker is open (chat strain,
  // host pressure, background brain/tunnel down).
  // The governor gates the POD's background brain. The local CPU embedder
  // runs in its own worker thread and is not behind that breaker.
  if (embeddingState.backend !== "ollama") governed = false;
  // The idle / low-memory gate exists for LLM embedding calls. The local CPU
  // embedder runs in its own worker thread: a full backfill is a minute or
  // two of that one thread and a few MB of vectors. Gating it (a 16 GB Mac is
  // always "low memory") left live semantic search at 51 of 1,693 DTUs.
  const localWorker = embeddingState.backend === "local";
  if (!governed && !localWorker && !presenceIdle.shouldRunHeavyMaintenance()) return { ok: true, skipped: "idle_no_users", processed: 0 };
  if (!embeddingState.available) {
    return { embedded: 0, skipped: 0, errors: 0, reason: "embeddings_unavailable" };
  }

  const allDTUs = Array.from(dtusMap.values());
  const unembedded = allDTUs.filter(d => !embeddingCache.has(d.id));

  embeddingState.stats.backfillTotal = unembedded.length;
  embeddingState.stats.backfillProgress = 0;
  embeddingState.stats.backfillComplete = false;
  embeddingState.stats.backfillGoverned = !!governed;
  embeddingState.stats.backfillPauses = 0;
  embeddingState.stats.backfillPauseReasons = {};

  if (unembedded.length === 0) {
    embeddingState.stats.backfillComplete = true;
    return { embedded: 0, skipped: allDTUs.length, errors: 0 };
  }

  let embedded = 0, errors = 0, empty = 0;
  const failures = {};
  const delayMs = Number(process.env.CONCORD_EMBED_BACKFILL_DELAY_MS) || 50;
  const maxPauseMs = Number(process.env.CONCORD_EMBED_BACKFILL_MAX_PAUSE_MS) || 6 * 3600_000;

  // Process in small groups of 10, yielding after each group so HTTP
  // requests can be served during backfill.  Each embedDTU() is an
  // Ollama HTTP call (~100-500ms), so 10 at a time keeps latency under
  // 5 seconds per group while still making progress.
  const YIELD_EVERY = 10;

  let alreadyCached = 0;
  for (let i = 0; i < unembedded.length; i++) {
    // The list above is a snapshot. At boot the local embedder can start this
    // backfill before initEmbeddings() loads the stored vectors (it clears the
    // cache and reloads it from SQLite ~1s later), so the snapshot held every
    // DTU and each restart re-embedded all ~2,000 of them on both backends.
    // Re-check the live cache so vectors that are already stored are skipped.
    if (embeddingCache.has(unembedded[i].id)) { alreadyCached++; continue; }
    let gate = null;
    if (governed) {
      const pauseStart = Date.now();
      for (;;) {
        gate = admitExecution({ kind: "embed", agentId: null, skipAgentRate: true, enforce: true });
        if (gate.allow) break;
        embeddingState.stats.backfillPauses++;
        const r = String(gate.reason || "denied");
        embeddingState.stats.backfillPauseReasons[r] = (embeddingState.stats.backfillPauseReasons[r] || 0) + 1;
        if (Date.now() - pauseStart > maxPauseMs) {
          if (_log) _log("warn", "backfill_paused_timeout", { progress: i, total: unembedded.length, reason: r });
          embeddingState.stats.backfillProgress = i;
          return { embedded, skipped: allDTUs.length - unembedded.length, errors, reason: `governor_paused:${r}`, failures };
        }
        await new Promise(res => { setTimeout(res, 5000); });
      }
    }
    let ok = false;
    try {
      const st = await embedDTU(unembedded[i]);
      // A DTU with no embeddable text is a skip, not a brain failure — it
      // must not count against the governor's error-rate breaker.
      if (st === "empty") { empty++; ok = true; }
      else {
        ok = embeddingCache.has(unembedded[i].id);
        if (ok) embedded++;
        else { errors++; failures[st || "embed_failed"] = (failures[st || "embed_failed"] || 0) + 1; }
      }
    } catch (e) {
      errors++;
      const k = String(e?.message || "error").slice(0, 40);
      failures[k] = (failures[k] || 0) + 1;
    } finally {
      if (gate) gate.release({ ok, error: ok ? undefined : "embed_failed" });
    }
    if (governed && delayMs) await new Promise(res => { setTimeout(res, delayMs); });

    // Yield to event loop every YIELD_EVERY DTUs — lets HTTP respond
    if ((i + 1) % YIELD_EVERY === 0) {
      embeddingState.stats.backfillProgress = i + 1;
      if (onProgress) {
        onProgress({
          progress: i + 1,
          total: unembedded.length,
          embedded,
          errors,
        });
      }
      await new Promise(r => { setTimeout(r, 100); });
    }

    // GC every BACKFILL_BATCH_SIZE DTUs to keep RSS stable
    if ((i + 1) % BACKFILL_BATCH_SIZE === 0 && global.gc) {
      global.gc();
    }
  }

  embeddingState.stats.backfillComplete = true;
  embeddingState.stats.backfillProgress = unembedded.length;
  embeddingState.stats.backfillFailures = failures;
  embeddingState.stats.backfillEmpty = empty;

  if (_log) {
    _log("info", "backfill_complete", { embedded, errors, empty, alreadyCached, total: unembedded.length, governed: !!governed, pauses: embeddingState.stats.backfillPauses, failures });
  }

  return { embedded, skipped: allDTUs.length - unembedded.length + alreadyCached, errors, empty, alreadyCached, failures };
}

// ── Status & Monitoring ────────────────────────────────────────────────────

/**
 * Get embedding subsystem status for monitoring dashboards.
 *
 * @param {number} totalDTUs - Total DTU count from STATE
 * @returns {object}
 */
export function getEmbeddingStatus(totalDTUs = 0) {
  const cached = embeddingCache.size;
  return {
    available: embeddingState.available,
    model: embeddingState.model,
    backend: embeddingState.backend,
    table: embeddingState.table,
    reason: embeddingState.reason,
    dimension: embeddingState.dimension,
    ollamaUrl: embeddingState.ollamaUrl,
    cached,
    totalDTUs,
    coverage: totalDTUs > 0 ? Math.round((cached / totalDTUs) * 100) : 0,
    backfill: {
      complete: embeddingState.stats.backfillComplete,
      progress: embeddingState.stats.backfillProgress,
      total: embeddingState.stats.backfillTotal,
      governed: !!embeddingState.stats.backfillGoverned,
      pauses: embeddingState.stats.backfillPauses || 0,
      pauseReasons: embeddingState.stats.backfillPauseReasons || {},
      failures: embeddingState.stats.backfillFailures || {},
      empty: embeddingState.stats.backfillEmpty || 0,
    },
    stats: {
      totalEmbedded: embeddingState.stats.totalEmbedded,
      totalRequests: embeddingState.stats.totalRequests,
      totalErrors: embeddingState.stats.totalErrors,
      avgEmbedMs: embeddingState.stats.avgEmbedMs,
    },
  };
}

/**
 * Check if embeddings are available and operational.
 * @returns {boolean}
 */
export function isEmbeddingAvailable() {
  return embeddingState.available;
}

/**
 * Get the current embedding model name.
 * @returns {string|null}
 */
export function getEmbeddingModel() {
  return embeddingState.model;
}

// ── Internal Helpers ───────────────────────────────────────────────────────

/**
 * Probe an Ollama instance for embedding model availability.
 * Sends a test embedding request.
 */
async function _probeEmbeddingModel(url, model) {
  try {
    const response = await fetch(`${url}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model, prompt: "test" }),
      signal: AbortSignal.timeout(30_000), // pulling may take time
    });

    if (!response.ok) return { ok: false };

    const data = await response.json();
    if (Array.isArray(data.embedding) && data.embedding.length > 0) {
      return { ok: true, dimension: data.embedding.length };
    }
    return { ok: false };
  } catch {
    return { ok: false };
  }
}

/**
 * Load existing embeddings from SQLite into memory cache.
 */
function _loadEmbeddingsFromDb() {
  if (!_db) return;

  try {
    // Load from dedicated embedding_cache table
    const rows = _db.prepare(`SELECT dtu_id, embedding FROM ${embeddingState.table}`).all();
    let loaded = 0;

    for (const row of rows) {
      if (row.embedding && loaded < MAX_IN_MEMORY) {
        try {
          const vec = new Float32Array(
            row.embedding.buffer,
            row.embedding.byteOffset,
            row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
          );
          embeddingCache.set(row.dtu_id, vec);
          loaded++;
        } catch (e) {
          _log("warn", "embedding_load_corrupt", { dtuId: row.dtu_id, error: String(e) });
        }
      }
    }

    if (_log && loaded > 0) {
      _log("info", "embeddings_loaded_from_db", { count: loaded });
    }

    // Migration: also check legacy dtus table if embedding_cache is empty
    if (loaded === 0 && embeddingState.table === PRIMARY_TABLE) {
      try {
        const tableInfo = _db.prepare("PRAGMA table_info(dtus)").all();
        const hasEmbeddingCol = tableInfo.some(col => col.name === "embedding");
        if (hasEmbeddingCol) {
          const legacyRows = _db.prepare("SELECT id, embedding FROM dtus WHERE embedding IS NOT NULL").all();
          let migrated = 0;
          for (const row of legacyRows) {
            if (row.embedding && migrated < MAX_IN_MEMORY) {
              try {
                const vec = new Float32Array(
                  row.embedding.buffer,
                  row.embedding.byteOffset,
                  row.embedding.byteLength / Float32Array.BYTES_PER_ELEMENT
                );
                embeddingCache.set(row.id, vec);
                // Migrate to new table
                const buf = Buffer.from(vec.buffer, vec.byteOffset, vec.byteLength);
                _db.prepare("INSERT OR IGNORE INTO embedding_cache (dtu_id, embedding, created_at) VALUES (?, ?, ?)").run(row.id, buf, new Date().toISOString());
                migrated++;
              } catch {
                // Corrupted — skip
              }
            }
          }
          if (_log && migrated > 0) {
            _log("info", "embeddings_migrated_from_legacy", { count: migrated });
          }
        }
      } catch {
        // Legacy table doesn't exist — fine
      }
    }
  } catch (e) {
    if (_log) _log("warn", "embeddings_db_load_skip", { error: String(e?.message || e) });
  }
}

/**
 * Trim embedding cache to a target size.
 * Evicts oldest entries (FIFO via Map insertion order).
 * @param {number} targetSize - Max entries to keep (default: half of MAX_IN_MEMORY)
 * @returns {{ before: number, after: number }} Cache sizes before/after trim
 */
export function trimEmbeddingCache(targetSize = Math.floor(MAX_IN_MEMORY / 2)) {
  const before = embeddingCache.size;
  if (before <= targetSize) return { before, after: before };
  const toRemove = before - targetSize;
  let removed = 0;
  for (const key of embeddingCache.keys()) {
    if (removed >= toRemove) break;
    embeddingCache.delete(key);
    removed++;
  }
  return { before, after: embeddingCache.size };
}

/**
 * Iterate cached (dtuId, vector) pairs — read-only. Used by archive retrieval
 * (lib/archive-retrieval.js) to score vectors whose DTU is not hot.
 * @returns {IterableIterator<[string, Float32Array]>}
 */
export function embeddingEntries() {
  return embeddingCache.entries();
}

/**
 * Get current embedding cache size.
 */
export function getEmbeddingCacheSize() {
  return embeddingCache.size;
}

// ── Exports ────────────────────────────────────────────────────────────────

export default {
  initEmbeddings,
  setLocalEmbedder,
  reprobeEmbeddings,
  tableForModel,
  embed,
  cosineSimilarity,
  findSimilar,
  semanticSearch,
  findCrossDomainConnections,
  embedDTU,
  storeEmbedding,
  getEmbedding,
  removeEmbedding,
  backfillEmbeddings,
  getEmbeddingStatus,
  isEmbeddingAvailable,
  getEmbeddingModel,
  trimEmbeddingCache,
  getEmbeddingCacheSize,
  embeddingEntries,
};
