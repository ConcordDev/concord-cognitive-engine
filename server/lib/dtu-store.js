/**
 * DTU Write-Through Store — Persistent-First DTU Storage Layer
 *
 * SQLite is the source of truth; the in-memory Map is a write-through cache.
 * Every DTU write goes to SQLite first, then updates the in-memory cache.
 * Reads check memory first (hot path) then fall back to SQLite (cold path).
 *
 * Benefits:
 *   - No data loss on crash/restart (SQLite WAL mode)
 *   - Individual DTU persistence (no more full-state JSON serialization for DTU changes)
 *   - O(1) lookups from memory, durable storage from SQLite
 *   - Transparent: callers use the same Map-like API
 */

import logger from '../logger.js';
import crypto from 'node:crypto';
import { detectKind } from './dtu-attachment.js';


/**
 * Initialize the DTU store table in SQLite.
 * Call once at boot after db is initialized.
 * @param {import("better-sqlite3").Database} db
 */
export function initDTUStore(db) {
  if (!db) return false;

  // Expose the db globally so the prototype wrap can introspect table_info
  globalThis._concordDB = db;

  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS dtu_store (
        id TEXT PRIMARY KEY,
        title TEXT,
        tier TEXT DEFAULT 'regular',
        scope TEXT DEFAULT 'global',
        tags TEXT DEFAULT '[]',
        source TEXT,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        data TEXT NOT NULL,
        content_hash TEXT,
        compressed_size INTEGER,
        rights_id TEXT,
        payload_bytes BLOB,
        payload_kind TEXT DEFAULT 'text'
      );

      CREATE INDEX IF NOT EXISTS idx_dtu_tier ON dtu_store(tier);
      CREATE INDEX IF NOT EXISTS idx_dtu_scope ON dtu_store(scope);
      CREATE INDEX IF NOT EXISTS idx_dtu_source ON dtu_store(source);
      CREATE INDEX IF NOT EXISTS idx_dtu_updated ON dtu_store(updated_at DESC);
    `);
    return true;
  } catch (e) {
    console.error("[DTUStore] Failed to initialize table:", e.message);
    return false;
  }
}

/**
 * Create a write-through DTU store that wraps a Map with SQLite persistence.
 *
 * @param {import("better-sqlite3").Database | null} db - SQLite database (null = memory-only fallback)
 * @param {Map} memoryMap - The existing STATE.dtus Map to wrap
 * @param {object} [opts]
 * @param {function} [opts.log] - Structured logger function
 * @returns {object} Store API
 */
export function createDTUStore(db, memoryMap, opts = {}) {
  const log = opts.log || (() => {});
  let _stmts = null;
  let _migrated = false;
  let _version = 0;

  // Prepare SQLite statements (lazy, cached)
  function stmts() {
    if (_stmts) return _stmts;
    if (!db) {
      logger.debug?.('[dtu-store] stmts() called but db is null');
      return null;
    }

    try {
      logger.debug?.('[dtu-store] Preparing statements (db connection state check)');
      // Verify DB is open by running a simple query
      try {
        db.prepare("SELECT 1").get();
      } catch (dbTestErr) {
        logger.error?.('[dtu-store] DB connection test failed: %s', dbTestErr.message);
        return null;
      }

      _stmts = {
        upsert: db.prepare(`
          INSERT OR REPLACE INTO dtu_store (id, title, tier, scope, tags, source, created_at, updated_at, data, content_hash, compressed_size, rights_id)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        get: db.prepare("SELECT data FROM dtu_store WHERE id = ?"),
        delete: db.prepare("DELETE FROM dtu_store WHERE id = ?"),
        count: db.prepare("SELECT COUNT(*) as count FROM dtu_store"),
        all: db.prepare("SELECT data FROM dtu_store"),
        byTier: db.prepare("SELECT data FROM dtu_store WHERE tier = ?"),
        byScope: db.prepare("SELECT data FROM dtu_store WHERE scope = ?"),
        exists: db.prepare("SELECT 1 FROM dtu_store WHERE id = ?"),
        updatePayload: db.prepare("UPDATE dtu_store SET payload_bytes = ?, payload_kind = ? WHERE id = ?"),
      };
      logger.debug?.('[dtu-store] Statements prepared successfully');
      return _stmts;
    } catch (e) {
      log("error", "dtu_store_prepare_failed", { error: e.message, stack: e.stack });
      return null;
    }
  }

  /**
   * Persist a DTU to SQLite.
   * @param {object} dtu
   */
  /**
   * Sniff payload type and extract for storage
   * Returns { payloadData, payloadBytes, payloadKind }
   */
  function sniffPayload(dtu) {
    let payloadData = null;
    let payloadBytes = null;
    let payloadKind = 'text';

    if (!dtu) return { payloadData, payloadBytes, payloadKind };

    // Check if DTU has raw binary payload
    if (Buffer.isBuffer(dtu.payload)) {
      payloadBytes = dtu.payload;
      payloadKind = detectKind(payloadBytes);
      return { payloadData, payloadBytes, payloadKind };
    }

    // Check if payload is a string
    if (typeof dtu.payload === 'string') {
      // Try to parse as JSON
      try {
        const parsed = JSON.parse(dtu.payload);
        if (parsed && typeof parsed === 'object') {
          payloadData = dtu.payload;
          payloadKind = 'json';
          return { payloadData, payloadBytes, payloadKind };
        }
      } catch (e) {
        // Not JSON, treat as text
      }

      // Validate UTF-8
      try {
        const buf = Buffer.from(dtu.payload, 'utf8');
        if (buf.toString('utf8') === dtu.payload) {
          payloadBytes = buf;
          payloadKind = 'text';
          return { payloadData, payloadBytes, payloadKind };
        }
      } catch (e) {
        // Not valid UTF-8, store as binary
        payloadBytes = Buffer.from(dtu.payload);
        payloadKind = 'binary';
        return { payloadData, payloadBytes, payloadKind };
      }
    }

    // Fallback: stringify entire DTU
    try {
      payloadData = JSON.stringify(dtu.body || dtu.content || dtu);
      payloadKind = 'json';
    } catch (e) {
      payloadKind = 'binary';
    }

    return { payloadData, payloadBytes, payloadKind };
  }

  function persistToSQLite(dtu) {
    const s = stmts();
    if (!s) return;
    try {
      const now = new Date().toISOString();
      const bodyJson = JSON.stringify(dtu.body || dtu.content || dtu);
      const content_hash = crypto.createHash("sha256").update(bodyJson).digest("hex");
      const compressed_size = Buffer.byteLength(bodyJson, "utf8");
      // Coerce every bind arg to its expected scalar type so a stray object
      // (e.g. dtu.source mutated to an object mid-pipeline) doesn't crash
      // the native better-sqlite3 bind. This is the smoking-gun fix for the
      // RangeError "Too few parameter values" — better-sqlite3's bind actually
      // validates arg count via the C++ V8 binding and an object arg counts
      // as zero, throwing the misleading "Too few parameter values" error.
      const safeTags = Array.isArray(dtu.tags) ? dtu.tags : [];
      const safeSource = typeof dtu.source === "string" ? dtu.source : (dtu.source ? String(dtu.source) : "system");

      // Sniff payload type (Sprint 32 E6 — binary attachments)
      const { payloadData, payloadBytes, payloadKind } = sniffPayload(dtu);

      s.upsert.run(
        String(dtu.id ?? ""),
        String(dtu.title ?? ""),
        String(dtu.tier ?? "regular"),
        String(dtu.scope ?? "global"),
        JSON.stringify(safeTags),
        safeSource,
        String(dtu.createdAt ?? now),
        String(dtu.updatedAt ?? now),
        payloadData || JSON.stringify(dtu),
        String(content_hash),
        Number.isFinite(compressed_size) ? compressed_size : 0,
        dtu.rights_id == null ? null : String(dtu.rights_id)
      );

      // Also store binary payload if needed (Sprint 32 E6)
      if (payloadBytes) {
        try {
          const stmt = stmts();
          if (stmt?.updatePayload) {
            stmt.updatePayload.run(payloadBytes, payloadKind, String(dtu.id ?? ""));
          }
        } catch (e) {
          logger.debug?.('[dtu-store] Could not store binary payload (column may not exist yet)', { id: dtu.id, error: e.message });
        }
      }
    } catch (e) {
      log("error", "dtu_store_persist_failed", { id: dtu.id, error: e.message });
    }
  }

  /**
   * Load a DTU from SQLite by ID.
   * @param {string} id
   * @returns {object|null}
   */
  function loadFromSQLite(id) {
    const s = stmts();
    if (!s) return null;
    try {
      const row = s.get.get(id);
      return row ? JSON.parse(row.data) : null;
    } catch (e) {
      log("error", "dtu_store_load_failed", { id, error: e.message });
      return null;
    }
  }

  // -- Public API (Map-compatible interface) --

  const store = {
    /**
     * Get a DTU by ID. Memory-first, SQLite fallback.
     * @param {string} id
     * @returns {object|undefined}
     */
    get(id) {
      // Hot path: check memory first
      const cached = memoryMap.get(id);
      if (cached) return cached;

      // Cold path: check SQLite
      const persisted = loadFromSQLite(id);
      if (persisted) {
        // Warm the cache
        memoryMap.set(id, persisted);
        return persisted;
      }

      return undefined;
    },

    /**
     * Store a DTU. Write-through: SQLite first, then memory.
     * @param {string} id
     * @param {object} dtu
     * @returns {Map}
     */
    set(id, dtu) {
      // Write to SQLite first (source of truth)
      persistToSQLite(dtu);
      // Then update memory cache
      const r = memoryMap.set(id, dtu);
      _version++;
      return r;
    },

    /**
     * Check if a DTU exists. Memory-first, SQLite fallback.
     * @param {string} id
     * @returns {boolean}
     */
    has(id) {
      if (memoryMap.has(id)) return true;
      const s = stmts();
      if (!s) return false;
      try {
        return !!s.exists.get(id);
      } catch {
        return false;
      }
    },

    /**
     * Delete a DTU from both memory and SQLite.
     * @param {string} id
     * @returns {boolean}
     */
    delete(id) {
      const s = stmts();
      if (s) {
        try { s.delete.run(id); } catch (_e) { logger.debug('dtu-store', 'silent catch', { error: _e?.message }); }
      }
      const r = memoryMap.delete(id);
      if (r) _version++;
      return r;
    },

    /**
     * Monotonic counter bumped on every real set()/delete() (skipped for a
     * delete() that found nothing to remove). Centralized here rather than
     * relying on callers to separately signal "something changed" — every
     * commit path funnels through this store's own set()/delete(), so there
     * is no scattered-call-site trust required. Used by callers that build
     * an expensive full-corpus copy on a timer (see server.js
     * buildCognitiveSnapshot) to skip the rebuild when nothing changed since
     * their last build.
     * @returns {number}
     */
    getVersion() {
      return _version;
    },

    /**
     * Get the count of DTUs in SQLite (authoritative) or memory (fallback).
     * @returns {number}
     */
    get size() {
      const s = stmts();
      if (s) {
        try {
          const row = s.count.get();
          return row ? row.count : memoryMap.size;
        } catch (_e) { logger.debug('dtu-store', 'silent catch', { error: _e?.message }); }
      }
      return memoryMap.size;
    },

    /**
     * Iterate over all DTUs. Uses memory Map for iteration performance.
     * @returns {IterableIterator}
     */
    values() {
      return memoryMap.values();
    },

    /**
     * Iterate over all DTU entries. Uses memory Map.
     * @returns {IterableIterator}
     */
    entries() {
      return memoryMap.entries();
    },

    /**
     * Iterate over all DTU keys. Uses memory Map.
     * @returns {IterableIterator}
     */
    keys() {
      return memoryMap.keys();
    },

    /**
     * forEach — delegates to memory Map.
     * @param {function} fn
     */
    forEach(fn) {
      memoryMap.forEach(fn);
    },

    /**
     * Symbol.iterator — delegates to memory Map.
     */
    [Symbol.iterator]() {
      return memoryMap[Symbol.iterator]();
    },

    /**
     * Clear all DTUs from both memory and SQLite.
     */
    clear() {
      if (db) {
        try { db.exec("DELETE FROM dtu_store"); } catch (_e) { logger.debug('dtu-store', 'silent catch', { error: _e?.message }); }
      }
      memoryMap.clear();
    },

    // -- Extended API beyond Map --

    /**
     * Bulk persist all in-memory DTUs to SQLite (migration / sync).
     * Uses a transaction for performance.
     * @returns {{ migrated: number, errors: number }}
     */
    migrateMemoryToSQLite() {
      if (_migrated) return { migrated: 0, errors: 0, skipped: true };
      const s = stmts();
      if (!s) return { migrated: 0, errors: 0, noDb: true };

      let migrated = 0;
      let errors = 0;

      const insertMany = db.transaction((dtus) => {
        for (const dtu of dtus) {
          try {
            persistToSQLite(dtu);
            migrated++;
          } catch {
            errors++;
          }
        }
      });

      insertMany(Array.from(memoryMap.values()));
      _migrated = true;
      if (migrated > 0) _version++;
      log("info", "dtu_store_migration_complete", { migrated, errors, total: memoryMap.size });
      return { migrated, errors };
    },

    /**
     * Load ALL DTUs from SQLite into memory (boot rehydration).
     * @returns {{ loaded: number, errors: number }}
     */
    rehydrateFromSQLite() {
      const s = stmts();
      if (!s) return { loaded: 0, errors: 0, noDb: true };

      let loaded = 0;
      let errors = 0;

      try {
        const rows = s.all.all();
        for (const row of rows) {
          try {
            const dtu = JSON.parse(row.data);
            if (dtu && dtu.id) {
              memoryMap.set(dtu.id, dtu);
              loaded++;
            }
          } catch {
            errors++;
          }
        }
      } catch (e) {
        log("error", "dtu_store_rehydrate_failed", { error: e.message });
      }

      if (loaded > 0) _version++;
      log("info", "dtu_store_rehydrated", { loaded, errors });
      return { loaded, errors };
    },

    /**
     * Get DTUs by tier from SQLite.
     * @param {string} tier
     * @returns {object[]}
     */
    getByTier(tier) {
      const s = stmts();
      if (!s) {
        return Array.from(memoryMap.values()).filter(d => d.tier === tier);
      }
      try {
        return s.byTier.all(tier).map(r => JSON.parse(r.data));
      } catch {
        return Array.from(memoryMap.values()).filter(d => d.tier === tier);
      }
    },

    /**
     * Get DTUs by scope from SQLite.
     * @param {string} scope
     * @returns {object[]}
     */
    getByScope(scope) {
      const s = stmts();
      if (!s) {
        return Array.from(memoryMap.values()).filter(d => d.scope === scope);
      }
      try {
        return s.byScope.all(scope).map(r => JSON.parse(r.data));
      } catch {
        return Array.from(memoryMap.values()).filter(d => d.scope === scope);
      }
    },

    /**
     * Get metrics about the store.
     */
    getMetrics() {
      const s = stmts();
      let sqliteCount = 0;
      if (s) {
        try { sqliteCount = s.count.get()?.count || 0; } catch (_e) { logger.debug('dtu-store', 'silent catch', { error: _e?.message }); }
      }
      return {
        memoryCount: memoryMap.size,
        sqliteCount,
        hasSQLite: !!db,
        migrated: _migrated,
      };
    },

    /**
     * Insert a DTU after passing the quality gate.
     * Returns { ok, dtuId, reason? } on success or rejection.
     * @param {object} dtu
     * @param {object} opts - { qualityGate?, dedupKey?, feedId?, feedSource? }
     * @returns {{ ok: boolean, dtuId?: string, reason?: string }}
     */
    insertIfPassesQualityGate(dtu, opts = {}) {
      if (!dtu || !dtu.id) return { ok: false, reason: 'invalid_dtu' };

      const { qualityGate } = opts;
      if (qualityGate && typeof qualityGate === 'function') {
        const gateResult = qualityGate(dtu, opts);
        if (!gateResult.ok) {
          // Log the rejection if handler is provided
          const { logRejection } = opts;
          if (logRejection && typeof logRejection === 'function') {
            logRejection(dtu, gateResult.reason, opts);
          }
          return { ok: false, reason: gateResult.reason, details: gateResult.details };
        }
      }

      // Gate passed (or no gate): commit the DTU
      this.set(dtu.id, dtu);
      return { ok: true, dtuId: dtu.id };
    },
  };

  return store;
}
