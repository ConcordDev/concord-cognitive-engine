/**
 * Canonical DTU Registry
 *
 * Every piece of content has exactly ONE canonical DTU representation.
 * When duplicate content is ingested, it resolves to the existing canonical.
 * This eliminates storage waste and ensures attribution integrity.
 *
 * Content Hash = SHA-256 of normalized content
 * Canonical ID = First DTU created with that content hash
 *
 * All subsequent references point to the canonical, never creating duplicates.
 */

import { createHash } from "crypto";
import { randomUUID } from "crypto";

function uid(prefix = "can") {
  return `${prefix}_` + randomUUID().replace(/-/g, "").slice(0, 16);
}

function nowISO() {
  return new Date().toISOString();
}

/**
 * Initialize the canonical_registry table in SQLite.
 * Called by migration 025, but safe to call again at boot.
 * @param {import("better-sqlite3").Database} db
 */
export function initCanonicalRegistry(db) {
  if (!db) return false;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS canonical_registry (
        content_hash TEXT PRIMARY KEY,
        canonical_dtu_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        reference_count INTEGER DEFAULT 1,
        content_size INTEGER DEFAULT 0,
        compressed_size INTEGER DEFAULT 0,
        compression_ratio REAL DEFAULT 1.0
      )
    `);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_canonical_dtu_id ON canonical_registry(canonical_dtu_id)`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_canonical_created ON canonical_registry(created_at DESC)`);
    return true;
  } catch (e) {
    console.error("[CanonicalRegistry] Failed to initialize table:", e.message);
    return false;
  }
}

/**
 * Create a canonical content store that enforces one-canonical-per-content.
 *
 * @param {import("better-sqlite3").Database} db - SQLite database
 * @param {object} dtuStore - The DTU store instance (from dtu-store.js)
 * @param {object} [opts]
 * @param {function} [opts.log] - Structured logger function
 * @returns {object} Canonical store API
 */
export function createCanonicalStore(db, dtuStore, opts = {}) {
  const log = opts.log || (() => {});
  let _stmts = null;

  // Prepare SQLite statements (lazy, cached)
  function stmts() {
    if (_stmts) return _stmts;
    if (!db) return null;
    try {
      _stmts = {
        lookup: db.prepare(
          "SELECT * FROM canonical_registry WHERE content_hash = ?"
        ),
        insert: db.prepare(`
          INSERT INTO canonical_registry (content_hash, canonical_dtu_id, created_at, reference_count, content_size, compressed_size, compression_ratio)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `),
        addRef: db.prepare(
          "UPDATE canonical_registry SET reference_count = reference_count + 1 WHERE content_hash = ?"
        ),
        removeRef: db.prepare(
          "UPDATE canonical_registry SET reference_count = reference_count - 1 WHERE content_hash = ? AND reference_count > 0"
        ),
        updateCompression: db.prepare(
          "UPDATE canonical_registry SET compressed_size = ?, compression_ratio = ? WHERE content_hash = ?"
        ),
        stats: db.prepare(`
          SELECT
            COUNT(*) as total_canonicals,
            SUM(reference_count) as total_references,
            SUM(reference_count) - COUNT(*) as duplicates_prevented,
            SUM(content_size) as total_content_size,
            SUM(compressed_size) as total_compressed_size,
            AVG(compression_ratio) as avg_compression_ratio,
            MAX(reference_count) as max_references
          FROM canonical_registry
        `),
        topDuplicates: db.prepare(
          "SELECT * FROM canonical_registry WHERE reference_count > 1 ORDER BY reference_count DESC LIMIT ?"
        ),
        byDtuId: db.prepare(
          "SELECT * FROM canonical_registry WHERE canonical_dtu_id = ?"
        ),
        deleteEntry: db.prepare(
          "DELETE FROM canonical_registry WHERE content_hash = ?"
        ),
        all: db.prepare(
          "SELECT * FROM canonical_registry ORDER BY created_at DESC"
        ),
      };
      return _stmts;
    } catch (e) {
      log("error", "canonical_registry_prepare_failed", { error: e.message });
      return null;
    }
  }

  /**
   * Normalize content for consistent hashing.
   * Strips whitespace variations, normalizes line endings, trims,
   * and lowercases to ensure semantically identical content
   * produces the same hash.
   *
   * @param {string|object} content - Raw content (string or object)
   * @returns {string} Normalized content string
   */
  function normalizeContent(content) {
    if (content === null || content === undefined) return "";

    let str;
    if (typeof content === "object") {
      // For objects, sort keys for deterministic serialization
      str = JSON.stringify(content, Object.keys(content).sort());
    } else {
      str = String(content);
    }

    // Normalize whitespace: collapse multiple spaces/tabs, normalize line endings
    return str
      .replace(/\r\n/g, "\n")       // Windows line endings -> Unix
      .replace(/\r/g, "\n")          // Old Mac line endings -> Unix
      .replace(/[ \t]+/g, " ")       // Collapse horizontal whitespace
      .replace(/\n\s*\n/g, "\n")     // Collapse blank lines
      .trim();
  }

  /**
   * Compute SHA-256 hash of normalized content.
   *
   * @param {string|object} content - Content to hash
   * @returns {string} Hex-encoded SHA-256 hash
   */
  function computeHash(content) {
    const normalized = normalizeContent(content);
    return createHash("sha256").update(normalized, "utf8").digest("hex");
  }

  const store = {
    /**
     * Register content — returns existing canonical if duplicate detected.
     * This is the primary entry point: call it every time content is ingested.
     *
     * @param {string|object} content - The content to register
     * @param {object} metadata - Additional metadata
     * @param {string} metadata.dtuId - The DTU ID to associate (or one will be generated)
     * @param {number} [metadata.contentSize] - Original content size in bytes
     * @param {number} [metadata.compressedSize] - Compressed content size in bytes
     * @returns {{ isNew: boolean, contentHash: string, canonicalDtuId: string, referenceCount: number }}
     */
    register(content, metadata = {}) {
      const s = stmts();
      if (!s) {
        log("warn", "canonical_register_no_db", {});
        return { isNew: true, contentHash: computeHash(content), canonicalDtuId: metadata.dtuId || uid("dtu"), referenceCount: 1 };
      }

      const contentHash = computeHash(content);
      const normalized = normalizeContent(content);
      const contentSize = metadata.contentSize || Buffer.byteLength(normalized, "utf8");
      const compressedSize = metadata.compressedSize || contentSize;
      const compressionRatio = contentSize > 0 ? compressedSize / contentSize : 1.0;

      try {
        // Check if this content hash already exists
        const existing = s.lookup.get(contentHash);

        if (existing) {
          // Duplicate detected — increment reference, return existing canonical
          s.addRef.run(contentHash);
          log("info", "canonical_duplicate_detected", {
            contentHash,
            canonicalDtuId: existing.canonical_dtu_id,
            newRefCount: existing.reference_count + 1,
          });

          return {
            isNew: false,
            contentHash,
            canonicalDtuId: existing.canonical_dtu_id,
            referenceCount: existing.reference_count + 1,
            originalCreatedAt: existing.created_at,
          };
        }

        // New content — create canonical entry
        const dtuId = metadata.dtuId || uid("dtu");
        const now = nowISO();

        s.insert.run(
          contentHash,
          dtuId,
          now,
          1,
          contentSize,
          compressedSize,
          compressionRatio
        );

        log("info", "canonical_registered", {
          contentHash,
          canonicalDtuId: dtuId,
          contentSize,
          compressedSize,
          compressionRatio,
        });

        return {
          isNew: true,
          contentHash,
          canonicalDtuId: dtuId,
          referenceCount: 1,
        };
      } catch (e) {
        log("error", "canonical_register_failed", { error: e.message, contentHash });
        return { isNew: true, contentHash, canonicalDtuId: metadata.dtuId || uid("dtu"), referenceCount: 1 };
      }
    },

    /**
     * Look up a canonical entry by content hash.
     *
     * @param {string} hash - SHA-256 content hash
     * @returns {object|null} Canonical entry or null
     */
    lookupByHash(hash) {
      const s = stmts();
      if (!s) return null;

      try {
        const row = s.lookup.get(hash);
        if (!row) return null;
        return {
          contentHash: row.content_hash,
          canonicalDtuId: row.canonical_dtu_id,
          createdAt: row.created_at,
          referenceCount: row.reference_count,
          contentSize: row.content_size,
          compressedSize: row.compressed_size,
          compressionRatio: row.compression_ratio,
        };
      } catch (e) {
        log("error", "canonical_lookup_failed", { hash, error: e.message });
        return null;
      }
    },

    /**
     * Look up a canonical entry by DTU ID.
     *
     * @param {string} dtuId - The canonical DTU ID
     * @returns {object|null} Canonical entry or null
     */
    lookupByDtuId(dtuId) {
      const s = stmts();
      if (!s) return null;

      try {
        const row = s.byDtuId.get(dtuId);
        if (!row) return null;
        return {
          contentHash: row.content_hash,
          canonicalDtuId: row.canonical_dtu_id,
          createdAt: row.created_at,
          referenceCount: row.reference_count,
          contentSize: row.content_size,
          compressedSize: row.compressed_size,
          compressionRatio: row.compression_ratio,
        };
      } catch (e) {
        log("error", "canonical_lookup_by_dtu_failed", { dtuId, error: e.message });
        return null;
      }
    },

    /**
     * Increment reference count for a content hash.
     *
     * @param {string} hash - Content hash
     * @returns {boolean} Success
     */
    addReference(hash) {
      const s = stmts();
      if (!s) return false;
      try {
        const result = s.addRef.run(hash);
        return result.changes > 0;
      } catch (e) {
        log("error", "canonical_add_ref_failed", { hash, error: e.message });
        return false;
      }
    },

    /**
     * Decrement reference count for a content hash.
     * Does not go below 0 and does not auto-delete the canonical entry.
     *
     * @param {string} hash - Content hash
     * @returns {boolean} Success
     */
    removeReference(hash) {
      const s = stmts();
      if (!s) return false;
      try {
        const result = s.removeRef.run(hash);
        return result.changes > 0;
      } catch (e) {
        log("error", "canonical_remove_ref_failed", { hash, error: e.message });
        return false;
      }
    },

    /**
     * Update compression stats for a canonical entry.
     *
     * @param {string} hash - Content hash
     * @param {number} compressedSize - New compressed size
     * @returns {boolean} Success
     */
    updateCompression(hash, compressedSize) {
      const s = stmts();
      if (!s) return false;
      try {
        const existing = s.lookup.get(hash);
        if (!existing) return false;
        const ratio = existing.content_size > 0 ? compressedSize / existing.content_size : 1.0;
        s.updateCompression.run(compressedSize, ratio, hash);
        return true;
      } catch (e) {
        log("error", "canonical_update_compression_failed", { hash, error: e.message });
        return false;
      }
    },

    /**
     * Delete a canonical entry entirely.
     *
     * @param {string} hash - Content hash
     * @returns {boolean} Success
     */
    deleteEntry(hash) {
      const s = stmts();
      if (!s) return false;
      try {
        const result = s.deleteEntry.run(hash);
        return result.changes > 0;
      } catch (e) {
        log("error", "canonical_delete_failed", { hash, error: e.message });
        return false;
      }
    },

    /**
     * Get deduplication and compression statistics.
     *
     * @returns {object} Stats including total canonicals, duplicates prevented, compression savings
     */
    getStats() {
      const s = stmts();
      if (!s) {
        return {
          totalCanonicals: 0,
          totalReferences: 0,
          duplicatesPrevented: 0,
          totalContentSize: 0,
          totalCompressedSize: 0,
          avgCompressionRatio: 1.0,
          maxReferences: 0,
          storageSaved: 0,
        };
      }

      try {
        const row = s.stats.get();
        const totalContentSize = row.total_content_size || 0;
        const totalCompressedSize = row.total_compressed_size || 0;
        const duplicatesPrevented = row.duplicates_prevented || 0;

        // Storage saved = (content that would have been stored if no dedup) - (actual stored)
        // Each duplicate reference would have been a full copy
        const totalReferences = row.total_references || 0;
        const totalCanonicals = row.total_canonicals || 0;
        const wouldHaveStored = totalReferences > 0
          ? (totalContentSize / totalCanonicals) * totalReferences
          : 0;
        const storageSaved = wouldHaveStored - totalCompressedSize;

        return {
          totalCanonicals,
          totalReferences,
          duplicatesPrevented: Math.max(0, duplicatesPrevented),
          totalContentSize,
          totalCompressedSize,
          avgCompressionRatio: row.avg_compression_ratio || 1.0,
          maxReferences: row.max_references || 0,
          storageSaved: Math.max(0, storageSaved),
          dedupRatio: totalReferences > 0 ? totalCanonicals / totalReferences : 1.0,
        };
      } catch (e) {
        log("error", "canonical_stats_failed", { error: e.message });
        return {
          totalCanonicals: 0,
          totalReferences: 0,
          duplicatesPrevented: 0,
          totalContentSize: 0,
          totalCompressedSize: 0,
          avgCompressionRatio: 1.0,
          maxReferences: 0,
          storageSaved: 0,
        };
      }
    },

    /**
     * Get top duplicated content entries.
     *
     * @param {number} [limit=10] - Max entries to return
     * @returns {object[]} Top duplicated entries
     */
    getTopDuplicates(limit = 10) {
      const s = stmts();
      if (!s) return [];
      try {
        return s.topDuplicates.all(limit).map(row => ({
          contentHash: row.content_hash,
          canonicalDtuId: row.canonical_dtu_id,
          referenceCount: row.reference_count,
          contentSize: row.content_size,
          compressedSize: row.compressed_size,
          compressionRatio: row.compression_ratio,
          createdAt: row.created_at,
        }));
      } catch (e) {
        log("error", "canonical_top_duplicates_failed", { error: e.message });
        return [];
      }
    },

    // Expose utility functions
    computeHash,
    normalizeContent,
  };

  return store;
}
