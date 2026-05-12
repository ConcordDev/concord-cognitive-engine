/**
 * Single-Origin Storage Engine — v1.0
 *
 * IMMUTABLE TIER — Constitutional
 *
 * Concord stores exactly ONE copy of every artifact.
 * Purchases grant download rights, not storage allocation.
 * Hash-addressed vault with reference counting.
 * CRI cache for regional speed, disposable and self-healing.
 *
 * Upload → compress → hash → dedup → store once → done forever.
 * Download → check license → stream from vault → log → done.
 */

import { randomUUID, createHash } from "crypto";
import { gzipSync } from "zlib";
import {
  STORAGE_CONSTANTS,
  STORAGE_INVARIANT,
  ARTIFACT_STORAGE,
  BANDWIDTH_MANAGEMENT,
  CRI_CACHE,
  STORAGE_ECONOMICS,
} from "../lib/storage-constants.js";

function uid(prefix = "dl") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

// ─────────────────────────────────────────────────────────────────────
// Vault Operations
// ─────────────────────────────────────────────────────────────────────

/**
 * Store an artifact in the vault.
 * Deduplicates by SHA-256 content hash.
 * If the same content already exists, increments reference count.
 *
 * In production, this writes to VAULT_DIR with zstd compression.
 * In this implementation, we simulate vault storage in SQLite.
 */
export function storeInVault(db, { fileBuffer, mimeType }) {
  if (!fileBuffer || !mimeType) {
    return { ok: false, error: "missing_required_fields" };
  }

  if (fileBuffer.length > STORAGE_CONSTANTS.UPLOAD_MAX_SIZE_MB * 1024 * 1024) {
    return { ok: false, error: "file_too_large", maxSizeMB: STORAGE_CONSTANTS.UPLOAD_MAX_SIZE_MB };
  }

  const hash = createHash("sha256").update(fileBuffer).digest("hex");

  // Check for existing artifact (dedup)
  const existing = db.prepare(
    "SELECT hash, file_path, compressed_size FROM artifact_vault WHERE hash = ?"
  ).get(hash);

  if (existing) {
    // Increment reference count
    incrementVaultRef(db, hash);
    return {
      ok: true,
      hash: existing.hash,
      path: existing.file_path,
      compressedSize: existing.compressed_size,
      deduplicated: true,
      additionalStorageBytes: 0,
    };
  }

  // Compress (using gzip as stand-in for zstd in Node.js)
  const compressed = gzipSync(fileBuffer);
  const vaultPath = `${STORAGE_CONSTANTS.VAULT_DIR}/${hash.slice(0, 2)}/${hash.slice(2, 4)}/${hash}`;
  const now = nowISO();

  db.prepare(`
    INSERT INTO artifact_vault (
      hash, file_path, original_size, compressed_size,
      compression_type, mime_type, reference_count,
      created_at, last_referenced_at
    ) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)
  `).run(
    hash, vaultPath, fileBuffer.length, compressed.length,
    "gzip", mimeType, now, now,
  );

  return {
    ok: true,
    hash,
    path: vaultPath,
    originalSize: fileBuffer.length,
    compressedSize: compressed.length,
    deduplicated: false,
    additionalStorageBytes: compressed.length,
    compressionRatio: (fileBuffer.length / compressed.length).toFixed(2),
  };
}

/**
 * Look up a vault entry by hash.
 */
export function getVaultEntry(db, hash) {
  const row = db.prepare("SELECT * FROM artifact_vault WHERE hash = ?").get(hash);
  if (!row) return null;
  return {
    hash: row.hash,
    filePath: row.file_path,
    originalSize: row.original_size,
    compressedSize: row.compressed_size,
    compressionType: row.compression_type,
    mimeType: row.mime_type,
    referenceCount: row.reference_count,
    createdAt: row.created_at,
    lastReferencedAt: row.last_referenced_at,
  };
}

/**
 * Increment vault reference count for a hash.
 */
export function incrementVaultRef(db, hash) {
  db.prepare(`
    UPDATE artifact_vault
    SET reference_count = reference_count + 1,
        last_referenced_at = datetime('now')
    WHERE hash = ?
  `).run(hash);
}

/**
 * Decrement vault reference count for a hash.
 */
export function decrementVaultRef(db, hash) {
  db.prepare(`
    UPDATE artifact_vault
    SET reference_count = reference_count - 1
    WHERE hash = ?
  `).run(hash);
}

/**
 * Clean up unreferenced artifacts past the grace period.
 */
export function cleanupUnreferencedArtifacts(db) {
  const graceDays = STORAGE_CONSTANTS.VAULT_GRACE_PERIOD_DAYS;
  const unreferenced = db.prepare(`
    SELECT hash, file_path FROM artifact_vault
    WHERE reference_count <= 0
    AND last_referenced_at < datetime('now', ?)
  `).all(`-${graceDays} days`);

  // Single batched DELETE replaces the per-entry loop (was N+1).
  // Chunked at 500 to stay under SQLite's variable cap.
  const hashes = unreferenced.map(e => e.hash);
  for (let i = 0; i < hashes.length; i += 500) {
    const chunk = hashes.slice(i, i + 500);
    const placeholders = chunk.map(() => "?").join(",");
    // @resource-leak-ok: chunk size fixed at 500 — at most 1-2 cache entries
    db.prepare(`DELETE FROM artifact_vault WHERE hash IN (${placeholders})`).run(...chunk);
  }

  return { ok: true, cleaned: unreferenced.length };
}

/**
 * Get vault statistics.
 */
export function getVaultStats(db) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total_artifacts,
      SUM(original_size) as total_original_bytes,
      SUM(compressed_size) as total_compressed_bytes,
      SUM(reference_count) as total_references,
      AVG(reference_count) as avg_references
    FROM artifact_vault
  `).get();

  return {
    ok: true,
    totalArtifacts: stats.total_artifacts || 0,
    totalOriginalBytes: stats.total_original_bytes || 0,
    totalCompressedBytes: stats.total_compressed_bytes || 0,
    totalReferences: stats.total_references || 0,
    avgReferences: stats.avg_references ? parseFloat(stats.avg_references.toFixed(2)) : 0,
    compressionRatio: stats.total_original_bytes && stats.total_compressed_bytes
      ? (stats.total_original_bytes / stats.total_compressed_bytes).toFixed(2)
      : "0",
  };
}

// ─────────────────────────────────────────────────────────────────────
// Download Operations
// ─────────────────────────────────────────────────────────────────────

/**
 * Record a download event (lightweight tracking).
 */
export function recordDownload(db, { artifactId, userId, vaultHash, fileSize, transferTimeMs }) {
  if (!artifactId || !userId) return { ok: false, error: "missing_required_fields" };

  const id = uid("dl");
  const now = nowISO();

  db.prepare(`
    INSERT INTO download_log (id, artifact_id, user_id, vault_hash, downloaded_at, file_size, transfer_time_ms)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, artifactId, userId, vaultHash || null, now, fileSize || null, transferTimeMs || null);

  // Update regional stats
  if (vaultHash) {
    updateRegionalStats(db, artifactId);
  }

  return { ok: true, downloadId: id, downloadedAt: now };
}

/**
 * Get download history for a user.
 */
export function getUserDownloads(db, userId, { limit = 50, offset = 0 } = {}) {
  const rows = db.prepare(
    "SELECT * FROM download_log WHERE user_id = ? ORDER BY downloaded_at DESC LIMIT ? OFFSET ?"
  ).all(userId, limit, offset);

  return {
    ok: true,
    downloads: rows.map(r => ({
      id: r.id,
      artifactId: r.artifact_id,
      vaultHash: r.vault_hash,
      downloadedAt: r.downloaded_at,
      fileSize: r.file_size,
      transferTimeMs: r.transfer_time_ms,
    })),
  };
}

/**
 * Get download count for an artifact.
 */
export function getArtifactDownloadCount(db, artifactId) {
  const row = db.prepare(
    "SELECT COUNT(*) as c FROM download_log WHERE artifact_id = ?"
  ).get(artifactId);
  return row.c || 0;
}

/**
 * Check if a user has downloaded an artifact before (for redownload tracking).
 */
export function hasUserDownloaded(db, artifactId, userId) {
  const row = db.prepare(
    "SELECT id FROM download_log WHERE artifact_id = ? AND user_id = ? LIMIT 1"
  ).get(artifactId, userId);
  return !!row;
}

// ─────────────────────────────────────────────────────────────────────
// CRI Cache Operations
// ─────────────────────────────────────────────────────────────────────

/**
 * Register an artifact in a CRI's local cache.
 */
export function cacheInCRI(db, { criId, vaultHash }) {
  if (!criId || !vaultHash) return { ok: false, error: "missing_required_fields" };

  const now = nowISO();

  db.prepare(`
    INSERT OR REPLACE INTO cri_cache (cri_id, vault_hash, cached_at, last_served, serve_count)
    VALUES (?, ?, ?, NULL, 0)
  `).run(criId, vaultHash, now);

  return { ok: true, criId, vaultHash, cachedAt: now };
}

/**
 * Record a CRI cache serve (hit).
 */
export function recordCRIServe(db, { criId, vaultHash }) {
  db.prepare(`
    UPDATE cri_cache
    SET serve_count = serve_count + 1, last_served = datetime('now')
    WHERE cri_id = ? AND vault_hash = ?
  `).run(criId, vaultHash);
}

/**
 * Evict an entry from CRI cache.
 */
export function evictFromCRI(db, { criId, vaultHash }) {
  const result = db.prepare(
    "DELETE FROM cri_cache WHERE cri_id = ? AND vault_hash = ?"
  ).run(criId, vaultHash);
  return { ok: true, evicted: result.changes > 0 };
}

/**
 * Get CRI cache contents.
 */
export function getCRICacheContents(db, criId) {
  const rows = db.prepare(
    "SELECT * FROM cri_cache WHERE cri_id = ? ORDER BY last_served DESC"
  ).all(criId);

  return {
    ok: true,
    entries: rows.map(r => ({
      vaultHash: r.vault_hash,
      cachedAt: r.cached_at,
      lastServed: r.last_served,
      serveCount: r.serve_count,
    })),
  };
}

/**
 * Get CRI cache stats.
 */
export function getCRICacheStats(db, criId) {
  const stats = db.prepare(`
    SELECT COUNT(*) as entries, SUM(serve_count) as total_serves
    FROM cri_cache WHERE cri_id = ?
  `).get(criId);

  return {
    ok: true,
    criId,
    entries: stats.entries || 0,
    totalServes: stats.total_serves || 0,
    maxSizeGB: CRI_CACHE.cachePolicy.maxCacheSizeGB,
    evictionPolicy: CRI_CACHE.cachePolicy.evictionPolicy,
    ttlHours: CRI_CACHE.cachePolicy.ttlHours,
  };
}

/**
 * Evict expired entries from CRI cache (LRU with TTL).
 */
export function evictExpiredCRIEntries(db, criId) {
  const ttlHours = CRI_CACHE.cachePolicy.ttlHours;
  const result = db.prepare(`
    DELETE FROM cri_cache
    WHERE cri_id = ? AND cached_at < datetime('now', ?)
  `).run(criId, `-${ttlHours} hours`);

  return { ok: true, evicted: result.changes };
}

// ─────────────────────────────────────────────────────────────────────
// Regional Download Stats
// ─────────────────────────────────────────────────────────────────────

/**
 * Update regional download stats (called internally on download).
 */
function updateRegionalStats(db, artifactId, regional = "global") {
  db.prepare(`
    INSERT INTO regional_download_stats (artifact_id, regional, download_count, last_downloaded)
    VALUES (?, ?, 1, datetime('now'))
    ON CONFLICT (artifact_id, regional) DO UPDATE SET
      download_count = download_count + 1,
      last_downloaded = datetime('now')
  `).run(artifactId, regional);
}

/**
 * Get regional download stats for an artifact.
 */
export function getRegionalStats(db, artifactId) {
  const rows = db.prepare(
    "SELECT * FROM regional_download_stats WHERE artifact_id = ? ORDER BY download_count DESC"
  ).all(artifactId);

  return {
    ok: true,
    regions: rows.map(r => ({
      regional: r.regional,
      downloadCount: r.download_count,
      lastDownloaded: r.last_downloaded,
    })),
  };
}

/**
 * Get top downloaded artifacts for a region (for CRI cache warming).
 */
export function getTopRegionalArtifacts(db, regional, { limit = 50 } = {}) {
  const rows = db.prepare(
    "SELECT * FROM regional_download_stats WHERE regional = ? ORDER BY download_count DESC LIMIT ?"
  ).all(regional, limit);

  return {
    ok: true,
    artifacts: rows.map(r => ({
      artifactId: r.artifact_id,
      downloadCount: r.download_count,
      lastDownloaded: r.last_downloaded,
    })),
  };
}

// ─────────────────────────────────────────────────────────────────────
// Storage Economics
// ─────────────────────────────────────────────────────────────────────

/**
 * Calculate storage savings for current vault state.
 */
export function calculateStorageSavings(db) {
  const stats = getVaultStats(db);
  if (!stats.ok || stats.totalArtifacts === 0) {
    return { ok: true, savings: 0, savingsPercent: "0", explanation: "no_artifacts_stored" };
  }

  // Traditional model: each reference = a full copy
  const traditionalBytes = stats.totalOriginalBytes * (stats.totalReferences || 1);
  const concordBytes = stats.totalCompressedBytes;

  const savings = traditionalBytes - concordBytes;
  const savingsPercent = traditionalBytes > 0
    ? ((1 - concordBytes / traditionalBytes) * 100).toFixed(1)
    : "0";

  return {
    ok: true,
    traditionalBytes,
    concordBytes,
    savings,
    savingsPercent: `${savingsPercent}%`,
    totalArtifacts: stats.totalArtifacts,
    totalReferences: stats.totalReferences,
  };
}

// Re-export constants
export {
  STORAGE_INVARIANT, ARTIFACT_STORAGE, DOWNLOAD_FLOW,
  STORAGE_ECONOMICS, VAULT_REFERENCE_SYSTEM, BANDWIDTH_MANAGEMENT,
  CRI_CACHE, STORAGE_CONSTANTS,
} from "../lib/storage-constants.js";
