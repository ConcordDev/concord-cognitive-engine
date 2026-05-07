/**
 * SQLite BUSY Retry Wrapper
 *
 * Wraps better-sqlite3 operations with exponential backoff retry
 * on SQLITE_BUSY errors. Essential for multi-instance deployments
 * sharing the same database file.
 */
import { structuredLog } from "./logger.js";

const MAX_RETRIES = 5;
const BASE_DELAY_MS = 10; // 10ms, 20ms, 40ms, 80ms, 160ms

/**
 * Execute a SQLite operation with BUSY retry.
 * @param {Function} fn - The database operation to execute
 * @param {string} [label] - Operation label for logging
 * @returns {*} The result of the operation
 */
export function withRetry(fn, label = "db_op") {
  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      return fn();
    } catch (err) {
      lastError = err;
      const isBusy = err?.code === "SQLITE_BUSY" || err?.message?.includes("database is locked");
      if (!isBusy || attempt === MAX_RETRIES) {
        throw err;
      }
      // Exponential backoff with jitter
      const delay = BASE_DELAY_MS * Math.pow(2, attempt) + Math.random() * 10;
      structuredLog("debug", "sqlite_busy_retry", { label, attempt: attempt + 1, delayMs: Math.round(delay) });
      // Synchronous sleep for better-sqlite3 (which is synchronous)
      const end = Date.now() + delay;
      while (Date.now() < end) { /* busy wait — required for sync better-sqlite3 */ }
    }
  }
  throw lastError;
}

/**
 * Wrap a better-sqlite3 Statement to add BUSY retry.
 * @param {object} stmt - A better-sqlite3 prepared statement
 * @param {string} [label] - Operation label
 * @returns {object} Wrapped statement with .run(), .get(), .all() retried
 */
export function wrapStatement(stmt, label = "stmt") {
  return {
    run(...args) { return withRetry(() => stmt.run(...args), `${label}.run`); },
    get(...args) { return withRetry(() => stmt.get(...args), `${label}.get`); },
    all(...args) { return withRetry(() => stmt.all(...args), `${label}.all`); },
    // Pass through non-retried methods
    bind: stmt.bind?.bind(stmt),
    columns: stmt.columns?.bind(stmt),
    pluck: stmt.pluck?.bind(stmt),
  };
}
