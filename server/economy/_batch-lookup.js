// server/economy/_batch-lookup.js
//
// Phase 2 perf fix helper. Replaces per-iteration `.get(id)` patterns
// inside loops with a single chunked `WHERE id IN (?, ?, …)` query.
// Stays under SQLite's compile-time variable cap (default 999) by
// chunking at 500.

const DEFAULT_CHUNK = 500;

/**
 * Batch lookup rows by primary key.
 *
 * @param {object} db                 better-sqlite3 instance
 * @param {string} table              table name (must be a literal in caller's code)
 * @param {string} pkCol              PK column name (e.g. "id")
 * @param {string[]} ids              ids to look up
 * @param {object} [opts]
 * @param {string[]} [opts.columns]   columns to project; defaults to "*"
 * @param {string}   [opts.whereExtra] optional extra `AND ...` clause
 * @returns {Map<string, object>} id -> row
 */
export function batchLookup(db, table, pkCol, ids, opts = {}) {
  const out = new Map();
  if (!ids || ids.length === 0) return out;
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(table)) throw new Error("invalid_table_name");
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(pkCol)) throw new Error("invalid_pk_col");

  const cols = opts.columns?.length
    ? opts.columns.filter(c => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(c)).join(", ")
    : "*";
  const where = opts.whereExtra ? ` AND (${opts.whereExtra})` : "";

  for (let i = 0; i < ids.length; i += DEFAULT_CHUNK) {
    const slice = ids.slice(i, i + DEFAULT_CHUNK);
    const placeholders = slice.map(() => "?").join(",");
    // @resource-leak-ok: bounded enumerated inputs (cols/table/pkCol from typed call sites)
    const rows = db.prepare(
      `SELECT ${cols} FROM ${table} WHERE ${pkCol} IN (${placeholders})${where}`,
    ).all(...slice);
    for (const r of rows) out.set(r[pkCol], r);
  }
  return out;
}
