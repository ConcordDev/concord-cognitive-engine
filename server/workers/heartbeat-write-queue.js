/**
 * heartbeat-write-queue.js — the transparent write-queueing shim used by
 * heartbeat-executor.js (worker-side) so `worker:true` heartbeat handlers
 * can call `db.prepare(sql).run(params)` exactly as they do everywhere
 * else in this codebase, even though the worker's real DB handle is
 * opened `{readonly:true}`.
 *
 * Extracted into its own module (rather than living inline in the worker
 * entry point) so it can be unit-tested directly against a real
 * better-sqlite3 readonly handle, without spinning up a worker_thread.
 *
 * See the fix note in heartbeat-executor.js for the bug this closes: every
 * currently-`worker:true` handler does direct `.run()` writes, none of them
 * call the (still-available) `queueWrite`/`queueEmit` opt-in helpers, and a
 * write against a readonly better-sqlite3 connection throws SQLITE_READONLY
 * — so every one of those handlers' state changes was being silently
 * discarded, every tick.
 */

// Matches the write-shaped SQL statements a caller can issue via
// db.prepare(sql).run(...) — a top-level INSERT/UPDATE/DELETE/REPLACE,
// tolerating leading whitespace/comments. Deliberately conservative: a
// statement this can't confidently classify as a write (e.g. a
// `WITH ... UPDATE ...` CTE) falls through to the real readonly statement,
// which fails exactly as it did before this fix (a safe failure mode, not a
// silent-corruption one) — call sites with that shape should use
// ctx.queueWrite explicitly instead.
export const WRITE_SQL_RE = /^(?:\s|--[^\n]*\n|\/\*[\s\S]*?\*\/)*\b(insert|update|delete|replace)\b/i;

/**
 * Wraps a readonly better-sqlite3 handle so `.prepare(sql).run(...)` on a
 * detected write statement queues a `db-write` side effect (replayed by the
 * main thread against the real, writable handle) instead of throwing.
 * Reads (`.get()`/`.all()`/`.pluck()`/iteration) pass straight through to
 * the real prepared statement, unmodified.
 *
 * @param {import('better-sqlite3').Database | null} realDb
 * @param {Array<object>} sideEffects - side-effect queue to push onto
 * @returns {object|null} a db-shaped object safe to hand to heartbeat handlers
 */
export function makeQueueingDb(realDb, sideEffects) {
  if (!realDb) return null;
  return {
    prepare(sql) {
      if (typeof sql === "string" && WRITE_SQL_RE.test(sql)) {
        return {
          run: (...params) => {
            sideEffects.push({ kind: "db-write", sql, params });
            // Best-effort placeholder — this write hasn't actually executed
            // yet (it's replayed after the tick), so `.changes` can't
            // reflect a real row count. Handlers that branch on the exact
            // changes/lastInsertRowid of a queued write need ctx.queueWrite
            // explicitly and their own handling; this keeps a chained
            // `.run()` call from throwing on `undefined` (queueWrite's own
            // return value) the way the pre-fix contract did.
            return { changes: 0, lastInsertRowid: 0 };
          },
        };
      }
      return realDb.prepare(sql);
    },
    exec(sql) {
      if (typeof sql === "string" && WRITE_SQL_RE.test(sql)) {
        sideEffects.push({ kind: "db-exec", sql });
        return this;
      }
      return realDb.exec(sql);
    },
    // Read-only pragma passthrough (e.g. a handler checking `journal_mode`);
    // handlers should never need to SET a pragma from inside a worker.
    pragma(sql, opts) { return realDb.pragma(sql, opts); },
    transaction(fn) {
      // Best-effort, non-atomic on replay: writes inside `fn` still queue
      // individually via the prepare().run() intercept above, exactly like
      // the ungrouped queueWrite calls that would otherwise be used here —
      // this is not a regression from the pre-fix contract, just an
      // explicit acknowledgment that worker-queued writes were never
      // transactional in the first place.
      const wrapped = (...args) => fn(...args);
      wrapped.immediate = wrapped;
      wrapped.deferred = wrapped;
      wrapped.exclusive = wrapped;
      return wrapped;
    },
  };
}
