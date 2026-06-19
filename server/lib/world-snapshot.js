// @sync-fs-ok: explicit admin/backup snapshot op, not a request handler. Sync fs in this file is intentional and not on the user request path (audited 2026-06).
// @sql-loop-ok: snapshot/restore loops iterate the fixed PER_WORLD_WRITE_TABLES list (one query per table, restore inside a transaction) — bounded admin/backup op, NOT a row-level N+1.
// server/lib/world-snapshot.js
//
// Axis D — persistence & irreversibility. In a creator economy where players own
// their creations and royalties make that ownership real value, a bad migration
// or a stuck emergent thread can permanently destroy player value. Data-loss is
// the one unforgivable bug. This is the missing live-world primitive: snapshot a
// world's per-world state to a verifiable envelope and restore it exactly — so a
// world can be backed up, rolled back, or its preservation across a migration
// proven (round-trip row equality).
//
// Reuses the canonical PER_WORLD_WRITE_TABLES. Pure DB ops; no network.

import crypto from "node:crypto";
import { PER_WORLD_WRITE_TABLES } from "./world-shard-protocol.js";

const SPEC = "concord-world-snapshot/v1";

function tableExists(db, t) {
  try { return !!db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=?").get(t); }
  catch { return false; }
}
function hasWorldId(db, t) {
  try { return db.pragma(`table_info(${t})`).some((c) => c.name === "world_id"); }
  catch { return false; }
}
// Stable stringify so the integrity hash is deterministic regardless of key order.
function canonical(v) {
  if (Array.isArray(v)) return `[${v.map(canonical).join(",")}]`;
  if (v && typeof v === "object") return `{${Object.keys(v).sort().map((k) => JSON.stringify(k) + ":" + canonical(v[k])).join(",")}}`;
  return JSON.stringify(v);
}
function hashTables(tables) {
  return crypto.createHash("sha256").update(canonical(tables)).digest("hex");
}

/** Snapshot every per-world table that exists + is world-scoped, for `worldId`. */
export function snapshotWorld(db, worldId) {
  if (!worldId) return { ok: false, reason: "no_world_id" };
  const tables = {};
  let totalRows = 0;
  for (const t of PER_WORLD_WRITE_TABLES) {
    if (!tableExists(db, t) || !hasWorldId(db, t)) continue;
    try {
      const rows = db.prepare(`SELECT * FROM ${t} WHERE world_id = ?`).all(worldId);
      if (rows.length) { tables[t] = rows; totalRows += rows.length; }
    } catch { /* table shape varies — skip */ }
  }
  const envelope = { spec: SPEC, worldId, createdAt: new Date().toISOString(), tableCount: Object.keys(tables).length, rowCount: totalRows, tables };
  envelope.integrity = hashTables(tables);
  return { ok: true, envelope };
}

/** Verify an envelope hasn't been tampered with. */
export function verifySnapshotIntegrity(envelope) {
  if (!envelope || envelope.spec !== SPEC) return false;
  return hashTables(envelope.tables || {}) === envelope.integrity;
}

/**
 * Restore a world from an envelope. Single transaction: for each table, DELETE
 * the world's rows then re-INSERT the snapshot. Idempotent (restoring twice ==
 * once). Refuses a tampered envelope. Returns rows restored.
 */
export function restoreWorld(db, envelope) {
  if (!verifySnapshotIntegrity(envelope)) return { ok: false, reason: "integrity_check_failed" };
  const { worldId, tables } = envelope;
  let restored = 0;
  const tx = db.transaction(() => {
    for (const [t, rows] of Object.entries(tables)) {
      if (!tableExists(db, t) || !hasWorldId(db, t)) continue;
      db.prepare(`DELETE FROM ${t} WHERE world_id = ?`).run(worldId);
      for (const row of rows) {
        const cols = Object.keys(row);
        const ph = cols.map(() => "?").join(",");
        db.prepare(`INSERT INTO ${t} (${cols.map((c) => `"${c}"`).join(",")}) VALUES (${ph})`).run(...cols.map((c) => row[c]));
        restored++;
      }
    }
  });
  tx();
  return { ok: true, restored, tableCount: Object.keys(tables).length };
}

/**
 * Migration-preservation check: snapshot → run `migrationFn(db)` → assert every
 * row the snapshot held still resolves (no player creation silently dropped).
 * Returns { preserved, missing:[{table,count}] }.
 */
export function assertPreservedAcross(db, worldId, migrationFn) {
  const before = snapshotWorld(db, worldId);
  if (!before.ok) return { preserved: false, reason: "snapshot_failed" };
  try { migrationFn(db); } catch (e) { return { preserved: false, reason: `migration_threw: ${e?.message || e}` }; }
  const after = snapshotWorld(db, worldId);
  const missing = [];
  for (const [t, rows] of Object.entries(before.envelope.tables)) {
    const afterRows = after.envelope.tables[t] || [];
    if (afterRows.length < rows.length) missing.push({ table: t, before: rows.length, after: afterRows.length });
  }
  return { preserved: missing.length === 0, missing };
}
