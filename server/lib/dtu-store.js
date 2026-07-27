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

/**
 * Initialize the DTU store table in SQLite.
 * Call once at boot after db is initialized.
 * @param {import("better-sqlite3").Database} db
 */
export function initDTUStore(db) {
  if (!db) return false;

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
        data TEXT NOT NULL
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
    if (!db) return null;
    try {
      _stmts = {
        upsert: db.prepare(`
          INSERT OR REPLACE INTO dtu_store (id, title, tier, scope, tags, source, created_at, updated_at, data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        `),
        get: db.prepare("SELECT data FROM dtu_store WHERE id = ?"),
        delete: db.prepare("DELETE FROM dtu_store WHERE id = ?"),
        count: db.prepare("SELECT COUNT(*) as count FROM dtu_store"),
        all: db.prepare("SELECT data FROM dtu_store"),
        byTier: db.prepare("SELECT data FROM dtu_store WHERE tier = ?"),
        byScope: db.prepare("SELECT data FROM dtu_store WHERE scope = ?"),
        exists: db.prepare("SELECT 1 FROM dtu_store WHERE id = ?"),
      };
      return _stmts;
    } catch (e) {
      log("error", "dtu_store_prepare_failed", { error: e.message });
      return null;
    }
  }

  /**
   * Persist a DTU to SQLite.
   * @param {object} dtu
   */
  function persistToSQLite(dtu) {
    const s = stmts();
    if (!s) return;
    try {
      const now = new Date().toISOString();
      s.upsert.run(
        dtu.id,
        dtu.title || "",
        dtu.tier || "regular",
        dtu.scope || "global",
        JSON.stringify(dtu.tags || []),
        dtu.source || "system",
        dtu.createdAt || now,
        dtu.updatedAt || now,
        JSON.stringify(dtu)
      );
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
  };

  return store;
}
