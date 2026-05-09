// server/migrations/_drop-with-rescue.js
//
// Phase 4 — shared rescue-then-drop helper for migrations 120-124.
//
// For each table:
//   1. SELECT COUNT(*). If non-zero AND env CONCORD_ALLOW_DROP_NONEMPTY is unset:
//      - Snapshot rows + schema to data/dropped-tables/<table>.<ts>.json
//      - Insert audit row with action: "skipped"
//      - SKIP the drop. Migration still succeeds.
//   2. If empty (or override set), DROP TABLE IF EXISTS, audit action: "dropped".
//
// The whole phase is gated by env CONCORD_DROP_DEAD_TABLES (default ON).
// Set to "0" to disable.

import fs from "node:fs";
import path from "node:path";

function ensureAuditTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS migration_drops (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      table_name TEXT NOT NULL,
      dropped_at TEXT NOT NULL,
      row_count INTEGER NOT NULL,
      schema_json TEXT,
      action TEXT NOT NULL,
      rescue_path TEXT
    )
  `);
}

function sanitizeName(name) {
  if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(name)) throw new Error(`unsafe_table_name:${name}`);
  return name;
}

function snapshotTable(db, table, repoRoot) {
  const safe = sanitizeName(table);
  const rows = db.prepare(`SELECT * FROM ${safe}`).all();
  const schema = db.prepare(`PRAGMA table_info(${safe})`).all();
  const ts = new Date().toISOString().replace(/[:.]/g, "-");
  const dir = path.join(repoRoot || process.cwd(), "data", "dropped-tables");
  try { fs.mkdirSync(dir, { recursive: true }); } catch { /* ignore */ }
  const filePath = path.join(dir, `${safe}.${ts}.json`);
  try {
    fs.writeFileSync(filePath, JSON.stringify({
      table: safe,
      droppedAt: new Date().toISOString(),
      rowCount: rows.length,
      schema,
      rows,
    }, null, 2));
    return filePath;
  } catch (e) {
    return null;
  }
}

/**
 * Drop a list of tables with the rescue path.
 *
 * @param {object} db    better-sqlite3 instance
 * @param {string[]} tables
 * @param {object} [opts]
 * @param {string} [opts.repoRoot] — repo root for data/dropped-tables/ snapshot dir
 */
export function dropDeadTables(db, tables, opts = {}) {
  if (process.env.CONCORD_DROP_DEAD_TABLES === "0") {
    return { ok: true, reason: "disabled_by_env", skipped: tables.length };
  }
  ensureAuditTable(db);

  const allowNonEmpty = process.env.CONCORD_ALLOW_DROP_NONEMPTY === "1";
  const summary = { dropped: [], skipped: [], missing: [] };

  for (const t of tables) {
    let exists = false;
    try {
      exists = !!db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name=?`).get(t);
    } catch { exists = false; }
    if (!exists) { summary.missing.push(t); continue; }

    let rowCount = 0;
    try { rowCount = db.prepare(`SELECT COUNT(*) AS n FROM ${sanitizeName(t)}`).get().n; }
    catch { rowCount = 0; }

    const schema = db.prepare(`PRAGMA table_info(${sanitizeName(t)})`).all();
    const now = new Date().toISOString();

    if (rowCount > 0 && !allowNonEmpty) {
      const rescue = snapshotTable(db, t, opts.repoRoot);
      db.prepare(`
        INSERT INTO migration_drops (table_name, dropped_at, row_count, schema_json, action, rescue_path)
        VALUES (?, ?, ?, ?, 'skipped', ?)
      `).run(t, now, rowCount, JSON.stringify(schema), rescue);
      summary.skipped.push({ table: t, rowCount, rescue });
      continue;
    }

    db.exec(`DROP TABLE IF EXISTS ${sanitizeName(t)}`);
    db.prepare(`
      INSERT INTO migration_drops (table_name, dropped_at, row_count, schema_json, action, rescue_path)
      VALUES (?, ?, ?, ?, 'dropped', NULL)
    `).run(t, now, rowCount, JSON.stringify(schema));
    summary.dropped.push({ table: t, rowCount });
  }

  return { ok: true, ...summary };
}
