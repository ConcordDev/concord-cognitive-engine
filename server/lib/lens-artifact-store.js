// server/lib/lens-artifact-store.js
//
// Write-through SQLite store for `STATE.lensArtifacts`.
//
// THE PROBLEM, measured on a running server 2026-07-28: 11,517 artifacts,
// 9.86 MB — the single largest key in the ~19 MB state snapshot, larger even
// than `dtus`, and the only large collection with neither a `capArr` cap nor a
// durable store. Its ONLY persistence was that snapshot, so:
//   - every debounced save re-serialized all 9.86 MB (the cost that made the
//     snapshot expensive enough to trip the load shedder), and
//   - a corrupted or truncated snapshot lost every artifact ever created, with
//     no row-level recovery — while DTUs already had exactly that via
//     `dtu_store`.
//
// ─── WHY THIS EXTENDS Map INSTEAD OF RETURNING AN OBJECT LITERAL ────────────
//
// `lib/dtu-store.js` (the pattern this otherwise mirrors) returns a plain
// object with Map-shaped methods. Doing that here would be a LATENT DATA-LOSS
// BUG, because callers `instanceof Map`-check this specific collection:
//
//     domains/astronomy.js:817
//       if (!(STATE.lensArtifacts instanceof Map)) STATE.lensArtifacts = new Map();
//
// An object literal fails that check, so the first co-observe call would
// REPLACE the store with an empty Map — dropping every artifact from memory
// and silently detaching write-through for the rest of the process's life.
// `lib/cascade-recovery.js:219` gates its orphan reconciliation on the same
// check and would have quietly stopped reconciling.
//
// Extending Map fixes that by construction AND is simply less code: get / has
// / size / keys / values / entries / forEach / spread / Symbol.iterator are
// inherited and read memory directly, so every existing call site keeps its
// exact semantics. Only the three MUTATORS are overridden to persist.
//
// ─── SCOPE: DURABILITY + SNAPSHOT COST, NOT YET MEMORY ──────────────────────
//
// Stated plainly so nobody mistakes what this buys: every artifact still lives
// in memory. This removes 9.86 MB from every snapshot write and gives
// artifacts row-level durability, but it does NOT bound heap growth.
//
// Bounding memory needs LRU eviction with lazy load-back, and that is a
// genuinely separate change because it breaks whole-collection iteration:
// `emergent/repair-cortex.js:4186` does `Array.from(STATE.lensArtifacts.values())`
// and would silently see only the resident subset. Doing it here, unaudited,
// would trade a growth problem for a correctness problem.

const DEFAULT_LOG = () => {};

export class LensArtifactStore extends Map {
  /**
   * @param {object} db          better-sqlite3 handle (may be null → memory-only)
   * @param {object} [opts]
   * @param {Function} [opts.log] structuredLog-compatible logger
   */
  constructor(db, opts = {}) {
    // MUST be called with no arguments. `new Map(entries)` invokes `this.set()`
    // per entry, and our override touches instance fields — passing entries
    // here would run set() before those fields exist. Seeding happens after
    // construction instead (see createLensArtifactStore).
    super();
    this._db = db || null;
    this._log = opts.log || DEFAULT_LOG;
    this._stmts = null;
    this._writeErrors = 0;
    // While true, mutations do NOT write through. Used during bulk hydrate so
    // loading N rows from SQLite doesn't write those same N rows back.
    this._hydrating = false;
  }

  _statements() {
    if (this._stmts) return this._stmts;
    if (!this._db) return null;
    try {
      this._stmts = {
        upsert: this._db.prepare(`
          INSERT OR REPLACE INTO lens_artifact_store
            (id, domain, type, owner_id, title, created_at, updated_at, data)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `),
        delete: this._db.prepare("DELETE FROM lens_artifact_store WHERE id = ?"),
        all: this._db.prepare("SELECT data FROM lens_artifact_store"),
        count: this._db.prepare("SELECT COUNT(*) AS n FROM lens_artifact_store"),
        clear: this._db.prepare("DELETE FROM lens_artifact_store"),
      };
      return this._stmts;
    } catch (e) {
      this._log("error", "lens_artifact_store_prepare_failed", { error: e?.message });
      return null;
    }
  }

  /**
   * Persist one artifact. NEVER throws — a storage failure must not break the
   * in-memory write the caller already made, or a transient DB problem would
   * turn every artifact mutation into a user-visible error.
   */
  _persist(id, artifact) {
    if (this._hydrating) return;
    const s = this._statements();
    if (!s) return;
    try {
      const now = new Date().toISOString();
      s.upsert.run(
        String(id),
        artifact?.domain ?? null,
        artifact?.type ?? null,
        artifact?.ownerId ?? null,
        artifact?.title ?? null,
        artifact?.createdAt ?? now,
        artifact?.updatedAt ?? now,
        JSON.stringify(artifact ?? {}),
      );
    } catch (e) {
      this._writeErrors++;
      this._log("error", "lens_artifact_persist_failed", { id: String(id), error: e?.message });
    }
  }

  // ── Mutators: memory first (so behaviour is unchanged even if SQLite is
  //    unavailable), then write through. ──────────────────────────────────────

  set(id, artifact) {
    super.set(id, artifact);
    this._persist(id, artifact);
    return this;
  }

  delete(id) {
    const existed = super.delete(id);
    if (!this._hydrating) {
      const s = this._statements();
      if (s) {
        try { s.delete.run(String(id)); }
        catch (e) {
          this._writeErrors++;
          this._log("error", "lens_artifact_delete_failed", { id: String(id), error: e?.message });
        }
      }
    }
    return existed;
  }

  clear() {
    super.clear();
    if (this._hydrating) return;
    const s = this._statements();
    if (!s) return;
    try { s.clear.run(); }
    catch (e) {
      this._writeErrors++;
      this._log("error", "lens_artifact_clear_failed", { error: e?.message });
    }
  }

  /**
   * Copy artifacts that exist only in memory (i.e. loaded from an old state
   * snapshot) into SQLite. Idempotent — INSERT OR REPLACE by id.
   */
  migrateMemoryToSQLite() {
    const s = this._statements();
    if (!s) return { migrated: 0, errors: 0, noDb: true };
    let migrated = 0, errors = 0;
    for (const [id, artifact] of super[Symbol.iterator]()) {
      try { this._persist(id, artifact); migrated++; }
      catch { errors++; }
    }
    this._log("info", "lens_artifact_store_migrated", { migrated, errors });
    return { migrated, errors };
  }

  /**
   * Load every row from SQLite into the memory cache.
   *
   * Paired with omitting `lensArtifacts` from the state snapshot: the snapshot
   * stops carrying them, so THIS is what puts them back at boot. Removing one
   * without the other loses every artifact — the same paired contract
   * `_serializeState` documents for `dtus`/`rehydrateFromSQLite`.
   */
  rehydrateFromSQLite() {
    const s = this._statements();
    if (!s) return { loaded: 0, errors: 0, noDb: true };
    let loaded = 0, errors = 0;
    this._hydrating = true;
    try {
      for (const row of s.all.all()) {
        try {
          const artifact = JSON.parse(row.data);
          if (artifact && artifact.id) { super.set(artifact.id, artifact); loaded++; }
        } catch { errors++; }
      }
    } finally {
      this._hydrating = false;
    }
    this._log("info", "lens_artifact_store_hydrated", { loaded, errors });
    return { loaded, errors };
  }

  /** Diagnostics for /api/admin surfaces. */
  stats() {
    const s = this._statements();
    let rows = null;
    try { rows = s ? s.count.get()?.n ?? null : null; } catch { rows = null; }
    return { memory: super.size, rows, writeErrors: this._writeErrors, backed: !!s };
  }
}

/**
 * Build a store and seed it from an existing plain Map.
 *
 * Seeding uses the memory-only path deliberately: the caller runs
 * migrateMemoryToSQLite() explicitly afterwards, so the order (migrate, then
 * hydrate — union, idempotent) stays visible at the boot site rather than
 * hidden in a constructor.
 */
export function createLensArtifactStore(db, existingMap, opts = {}) {
  const store = new LensArtifactStore(db, opts);
  if (existingMap && typeof existingMap[Symbol.iterator] === "function") {
    store._hydrating = true;
    try { for (const [k, v] of existingMap) store.set(k, v); }
    finally { store._hydrating = false; }
  }
  return store;
}

export default { LensArtifactStore, createLensArtifactStore };
