/**
 * Embedding Infrastructure for Concord Cognitive Engine
 *
 * Provides semantic embedding generation via local Ollama instances
 * using nomic-embed-text (137MB, CPU, millisecond inference).
 *
 * Core API:
 *   embed(text)                         → Float32Array (was Float64, halved for memory)
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
 */

import crypto from "crypto";
import logger from './logger.js';
import _qdrant from "./lib/qdrant-client.js";

// ── Configuration ──────────────────────────────────────────────────────────
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";
const EMBEDDING_FALLBACK_MODEL = "all-minilm";
const EMBEDDING_DIMENSION = 768; // nomic-embed-text default
// In-memory embedding cache cap. At ~3KB per Float32Array (768 dims) the
// default 150k entries occupy ~450MB. Operators on smaller boxes can shrink
// via CONCORD_EMBEDDING_CACHE_MAX. SQLite remains the source of truth;
// over-cap embeddings fall through to disk lookup.
const MAX_IN_MEMORY = Number(process.env.CONCORD_EMBEDDING_CACHE_MAX) || 150_000;
const BACKFILL_BATCH_SIZE = 50;   // Smaller batches to limit RSS growth
const EMBED_TIMEOUT_MS = 5_000;  // GPU embeds are much faster

// ── State ──────────────────────────────────────────────────────────────────

/** @type {Map<string, Float32Array>} In-memory embedding cache (dtuId → vector) */
const embeddingCache = new Map();

/** @type {{ available: boolean, model: string|null, dimension: number, ollamaUrl: string|null }} */
const embeddingState = {
  available: false,
  model: null,
  dimension: EMBEDDING_DIMENSION,
  ollamaUrl: null,
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

// ── Initialisation ─────────────────────────────────────────────────────────

/**
 * Initialise the embedding subsystem.
 * Call once at server startup after DB and Ollama are ready.
 *
 * @param {{ db: object|null, ollamaUrls: string[], structuredLog: Function }} opts
 */
export async function initEmbeddings({ db = null, ollamaUrls = [], structuredLog = console.warn } = {}) {
  _db = db;

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

  // Probe Ollama instances for embedding model availability
  for (const url of ollamaUrls) {
    if (embeddingState.available) break;
    try {
      const probe = await _probeEmbeddingModel(url, EMBEDDING_MODEL);
      if (probe.ok) {
        embeddingState.available = true;
        embeddingState.model = EMBEDDING_MODEL;
        embeddingState.ollamaUrl = url;
        embeddingState.dimension = probe.dimension || EMBEDDING_DIMENSION;
        _log("info", "embeddings_ready", { model: EMBEDDING_MODEL, url, dimension: embeddingState.dimension });
        continue;
      }
      // Try fallback model
      const fallback = await _probeEmbeddingModel(url, EMBEDDING_FALLBACK_MODEL);
      if (fallback.ok) {
        embeddingState.available = true;
        embeddingState.model = EMBEDDING_FALLBACK_MODEL;
        embeddingState.ollamaUrl = url;
        embeddingState.dimension = fallback.dimension || 384; // all-minilm is 384-dim
        _log("info", "embeddings_ready_fallback", { model: EMBEDDING_FALLBACK_MODEL, url, dimension: embeddingState.dimension });
      }
    } catch {
      // This Ollama instance didn't respond — try next
    }
  }

  if (!embeddingState.available) {
    _log("warn", "embeddings_unavailable", { tried: ollamaUrls, models: [EMBEDDING_MODEL, EMBEDDING_FALLBACK_MODEL] });
  }

  // Load cached embeddings from SQLite into memory
  if (_db && embeddingState.available) {
    _loadEmbeddingsFromDb();
  }

  return { available: embeddingState.available, model: embeddingState.model };
}

// ── Core API ───────────────────────────────────────────────────────────────

/**
 * Generate an embedding vector for the given text.
 * Returns null if the embedding model is unavailable.
 *
 * @param {string} text
 * @returns {Promise<Float32Array|null>}
 */
export async function embed(text) {
  if (!embeddingState.available || !embeddingState.ollamaUrl) return null;

  const trimmed = String(text || "").trim().slice(0, 8192); // Model context limit
  if (!trimmed) return null;

  embeddingState.stats.totalRequests++;
  const start = Date.now();

  try {
    const response = await fetch(`${embeddingState.ollamaUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: embeddingState.model,
        prompt: trimmed,
      }),
      signal: AbortSignal.timeout(EMBED_TIMEOUT_MS),
    });

    if (!response.ok) {
      embeddingState.stats.totalErrors++;
      return null;
    }

    const data = await response.json();
    const vec = data.embedding;

    if (!Array.isArray(vec) || vec.length === 0) {
      embeddingState.stats.totalErrors++;
      return null;
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
  const queryVec = await embed(query);
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
export function storeEmbedding(dtuId, vec) {
  if (!dtuId || !vec) return;

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
      _db.prepare("INSERT OR REPLACE INTO embedding_cache (dtu_id, embedding, created_at) VALUES (?, ?, ?)").run(dtuId, buf, new Date().toISOString());
    } catch {
      // Table may not exist yet — silent
    }
  }

  // Qdrant ANN index (Item 1) — fire-and-forget, no-op unless VECTOR_DB=qdrant +
  // reachable. Never blocks the write; the in-process cache above stays the
  // source of truth + offline fallback.
  if (_qdrant?.configured?.()) {
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
      _db.prepare("DELETE FROM embedding_cache WHERE dtu_id = ?").run(dtuId);
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
  if (!embeddingState.available || !dtu?.id) return;

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
  ];

  const text = parts.filter(Boolean).join(" ").slice(0, 8192);
  if (!text.trim()) return;

  try {
    const vec = await embed(text);
    if (vec) {
      storeEmbedding(dtu.id, vec);
    }
  } catch (e) {
    if (_log) _log("warn", "embed_dtu_failed", { dtuId: dtu.id, error: String(e?.message || e) });
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
export async function backfillEmbeddings(dtusMap, { onProgress = null } = {}) {
  if (!embeddingState.available) {
    return { embedded: 0, skipped: 0, errors: 0, reason: "embeddings_unavailable" };
  }

  const allDTUs = Array.from(dtusMap.values());
  const unembedded = allDTUs.filter(d => !embeddingCache.has(d.id));

  embeddingState.stats.backfillTotal = unembedded.length;
  embeddingState.stats.backfillProgress = 0;
  embeddingState.stats.backfillComplete = false;

  if (unembedded.length === 0) {
    embeddingState.stats.backfillComplete = true;
    return { embedded: 0, skipped: allDTUs.length, errors: 0 };
  }

  let embedded = 0, errors = 0;

  // Process in small groups of 10, yielding after each group so HTTP
  // requests can be served during backfill.  Each embedDTU() is an
  // Ollama HTTP call (~100-500ms), so 10 at a time keeps latency under
  // 5 seconds per group while still making progress.
  const YIELD_EVERY = 10;

  for (let i = 0; i < unembedded.length; i++) {
    try {
      await embedDTU(unembedded[i]);
      if (embeddingCache.has(unembedded[i].id)) {
        embedded++;
      }
    } catch {
      errors++;
    }

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
      await new Promise(r => { setTimeout(r, 10); });
    }

    // GC every BACKFILL_BATCH_SIZE DTUs to keep RSS stable
    if ((i + 1) % BACKFILL_BATCH_SIZE === 0 && global.gc) {
      global.gc();
    }
  }

  embeddingState.stats.backfillComplete = true;
  embeddingState.stats.backfillProgress = unembedded.length;

  if (_log) {
    _log("info", "backfill_complete", { embedded, errors, total: unembedded.length });
  }

  return { embedded, skipped: allDTUs.length - unembedded.length, errors };
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
    dimension: embeddingState.dimension,
    ollamaUrl: embeddingState.ollamaUrl,
    cached,
    totalDTUs,
    coverage: totalDTUs > 0 ? Math.round((cached / totalDTUs) * 100) : 0,
    backfill: {
      complete: embeddingState.stats.backfillComplete,
      progress: embeddingState.stats.backfillProgress,
      total: embeddingState.stats.backfillTotal,
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
    const rows = _db.prepare("SELECT dtu_id, embedding FROM embedding_cache").all();
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
        } catch {
          // Corrupted embedding — skip
        }
      }
    }

    if (_log && loaded > 0) {
      _log("info", "embeddings_loaded_from_db", { count: loaded });
    }

    // Migration: also check legacy dtus table if embedding_cache is empty
    if (loaded === 0) {
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
 * Get current embedding cache size.
 */
export function getEmbeddingCacheSize() {
  return embeddingCache.size;
}

// ── Exports ────────────────────────────────────────────────────────────────

export default {
  initEmbeddings,
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
};
