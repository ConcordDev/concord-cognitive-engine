// server/lib/dtu-operations-log.js
//
// Sprint 32 — Operations log for system-status events.
//
// WHY THIS MODULE EXISTS
// ----------------------
// Multiple subsystems emit operational events — repair-cortex writes 51
// different `logRepairDTU()` actions, feed-manager has `_feedHealth`,
// ghost-fleet reports module load results, etc. PRE-fix these all flowed
// into `STATE.dtus` → `dtu_store` SQL → user-facing /api/dtus → pollute
// the knowledge substrate. POST-fix they go here: a dedicated table
// (`dtu_operations_log`, created by migration 402) that is OUT of the DTU
// universe. Nothing in the lattice, autogen, search, or user-facing reads
// touches this table.
//
// OPERATIONS LOG vs DTU
// ----------------------
// ┌─────────────────────────┬──────────────────┬─────────────────────────────┐
// │ Property                │ DTU (dtu_store)  │ Operations log              │
// ├─────────────────────────┼──────────────────┼─────────────────────────────┤
// │ User-facing /api/dtus   │ YES              │ NO                          │
// │ In lattice edges        │ YES              │ NO                          │
// │ Fed into autogen        │ YES              │ NO                          │
// │ Searchable              │ YES              │ NO                          │
// │ Read by reasoning       │ YES              │ NO                          │
// │ Read by repair-cortex   │ NO               │ YES (its own dashboard)     │
// │ Read by operator tools  │ YES              │ YES (via this module)       │
// └─────────────────────────┴──────────────────┴─────────────────────────────┘
//
// USAGE FROM OTHER MODULES
// ------------------------
// import { recordOperation, getOperationsLog, pruneOperationsLog } from "../lib/dtu-operations-log.js";
//
// recordOperation(db, {
//   subsystem: "repair_cortex",
//   phase: REPAIR_PHASES.POST_BUILD,
//   action: "recurring_error",
//   details: { fingerprint, count, firstSeen, lastSeen },
// });
//
// The dedup window: if the same (subsystem, action, JSON(details)) tuple
// is recorded within 60s, we coalesce to the existing row (incrementing
// a `count` field in details) instead of inserting a new row. This keeps
// the table from blowing up when the same error fires 200x/sec.

import crypto from "node:crypto";

const DEFAULT_DEDUP_WINDOW_MS = 60_000;
const DEFAULT_CAP = 50_000;

function severityFromAction(action) {
  // Heuristic — callers can override via opts.severity
  if (action.includes("critical") || action.includes("emergency")) return "critical";
  if (action.includes("error") || action.includes("failed") || action.includes("unhealthy")) return "error";
  if (action.includes("warn") || action.includes("skipped") || action.includes("restart")) return "warn";
  return "info";
}

function uidForOp(prefix = "oplog") {
  return `${prefix}_${crypto.randomBytes(8).toString("hex")}`;
}

/**
 * Record an operational event. Coalesces with a recent identical event
 * (same subsystem+action+detailsHash) within dedupWindowMs.
 *
 * @param {object} db - better-sqlite3 db handle
 * @param {object} entry
 * @param {string} entry.subsystem  - who is logging this (e.g. "repair_cortex")
 * @param {string} entry.action     - short verb (e.g. "recurring_error")
 * @param {string} [entry.phase]    - phase within the subsystem
 * @param {string} [entry.severity] - "info" | "warn" | "error" | "critical"
 * @param {object} [entry.details]  - arbitrary payload (gets JSON-encoded)
 * @param {object} [entry.meta]     - arbitrary extra metadata
 * @param {number} [dedupWindowMs]  - default 60_000
 * @returns {{ id: string, coalesced: boolean, count: number }}
 */
export function recordOperation(db, entry, dedupWindowMs = DEFAULT_DEDUP_WINDOW_MS) {
  if (!db) throw new Error("dtu-operations-log: db required");
  if (!entry || !entry.subsystem || !entry.action) {
    throw new Error("dtu-operations-log: subsystem + action required");
  }

  const severity = entry.severity || severityFromAction(entry.action);
  const details = entry.details ? JSON.stringify(entry.details) : "{}";
  const meta = entry.meta ? JSON.stringify(entry.meta) : "{}";
  const detailsHash = crypto.createHash("sha256").update(details).digest("hex").slice(0, 16);

  // Try to coalesce with a recent row (same subsystem+action+hash within window)
  try {
    const cutoff = new Date(Date.now() - dedupWindowMs).toISOString();
    const recent = db.prepare(`
      SELECT id, details FROM dtu_operations_log
      WHERE subsystem = ? AND action = ? AND ts >= ?
        AND archived = 0
      ORDER BY ts DESC LIMIT 1
    `).get(entry.subsystem, entry.action, cutoff);

    if (recent && recent.details.includes(detailsHash)) {
      // Coalesce: bump the count in details
      let d;
      try { d = JSON.parse(recent.details); } catch { d = {}; }
      d._count = (d._count || 1) + 1;
      d._lastCoalescedAt = new Date().toISOString();
      db.prepare(`
        UPDATE dtu_operations_log
        SET details = ?, ts = (datetime('now'))
        WHERE id = ?
      `).run(JSON.stringify(d), recent.id);
      return { id: recent.id, coalesced: true, count: d._count };
    }
  } catch (_e) { /* coalesce is best-effort */ }

  // New row
  const id = uidForOp();
  db.prepare(`
    INSERT INTO dtu_operations_log
      (id, subsystem, phase, action, severity, details, meta)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(id, entry.subsystem, entry.phase || null, entry.action, severity,
         details.replace(/__DETAILS_HASH__/g, ''), meta);

  // Wrap details with hash for future coalesce match
  db.prepare(`
    UPDATE dtu_operations_log
    SET details = ?
    WHERE id = ?
  `).run(`{"_hash":"${detailsHash}","_data":${details}}`, id);

  return { id, coalesced: false, count: 1 };
}

/**
 * Read operations log entries.
 *
 * @param {object} db
 * @param {object} [filters]
 * @param {string} [filters.subsystem]
 * @param {string} [filters.action]
 * @param {string} [filters.severity]  - "info" | "warn" | "error" | "critical"
 * @param {number} [filters.sinceMs]   - unix ms timestamp
 * @param {number} [filters.limit=200]
 * @returns {Array<object>}
 */
export function getOperationsLog(db, filters = {}) {
  if (!db) return [];
  const conditions = [];
  const params = [];
  if (filters.subsystem) { conditions.push("subsystem = ?"); params.push(filters.subsystem); }
  if (filters.action) { conditions.push("action = ?"); params.push(filters.action); }
  if (filters.severity) { conditions.push("severity = ?"); params.push(filters.severity); }
  if (filters.sinceMs) { conditions.push("ts >= ?"); params.push(new Date(filters.sinceMs).toISOString()); }
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.max(1, Math.min(1000, filters.limit || 200));
  const rows = db.prepare(`
    SELECT id, ts, subsystem, phase, action, severity, details, meta
    FROM dtu_operations_log
    ${where}
    ORDER BY ts DESC LIMIT ${limit}
  `).all(...params);
  return rows.map((r) => ({
    ...r,
    details: (() => { try { return JSON.parse(r.details); } catch { return {}; } })(),
    meta:    (() => { try { return JSON.parse(r.meta); }    catch { return {}; } })(),
  }));
}

/**
 * Prune old entries. Default cap: 50k rows; default age: 30 days.
 * Returns { deletedByAge, deletedByCap }.
 */
export function pruneOperationsLog(db, opts = {}) {
  if (!db) return { deletedByAge: 0, deletedByCap: 0 };
  const cap = opts.cap ?? DEFAULT_CAP;
  const ageDays = opts.ageDays ?? 30;
  const cutoff = new Date(Date.now() - ageDays * 86400_000).toISOString();

  const age = db.prepare(`
    DELETE FROM dtu_operations_log WHERE ts < ? AND archived = 0
  `).run(cutoff);

  const total = db.prepare(`SELECT COUNT(*) AS n FROM dtu_operations_log`).get().n;
  let capDeleted = 0;
  if (total > cap) {
    const excess = total - cap;
    capDeleted = db.prepare(`
      DELETE FROM dtu_operations_log
      WHERE id IN (
        SELECT id FROM dtu_operations_log
        ORDER BY ts ASC LIMIT ?
      )
    `).run(excess).changes;
  }

  return { deletedByAge: age.changes || 0, deletedByCap: capDeleted };
}

/**
 * Boot-time companion: tombstone all rows in dtu_store whose source is
 * a known operational-log producer. Keeps the lineage (id lineage) so any
 * downstream tombstone-aware code can still resolve; just stops them from
 * appearing in the active substrate.
 *
 * KNOWN OPERATIONAL SOURCES (extensible). Add to this set as new log-style
 * DTU writers are discovered. The goal: a single grep of this set is the
 * audit answer to "what is in dtu_store that shouldn't be?".
 */
export const KNOWN_OPERATIONAL_DTU_SOURCES = Object.freeze([
  "repair_cortex",
  // Add new operational-only DTU sources here as they're discovered.
  // Anything with a `tier: "local" | "shadow"` and `scope: "local"` is
  // probably operational — verify before adding.
]);

/**
 * @param {object} db
 * @returns {{ scanned: number, tombstoned: number }}
 */
export function tombstoneOperationalDTUs(db) {
  if (!db || KNOWN_OPERATIONAL_DTU_SOURCES.length === 0) {
    return { scanned: 0, tombstoned: 0 };
  }
  const placeholders = KNOWN_OPERATIONAL_DTU_SOURCES.map(() => "?").join(",");
  const rows = db.prepare(`
    SELECT id, data FROM dtu_store
    WHERE json_extract(data, '$.source') IN (${placeholders})
      AND tier != 'shadow'
  `).all(...KNOWN_OPERATIONAL_DTU_SOURCES);
  let n = 0;
  for (const r of rows) {
    let data;
    try { data = JSON.parse(r.data); } catch { data = {}; }
    data.type = "tombstone";
    data.originalId = r.id;
    data.originalTier = data.tier || "regular";
    data.retentionScore = 0.0;
    data.forgottenAt = new Date().toISOString();
    data.reason = "sprint32_operational_log_redirected";
    db.prepare(`
      UPDATE dtu_store SET data = ?, tier = 'shadow',
        tags = '["tombstone","forgetting_engine","sprint32_opslog_redirect"]'
      WHERE id = ?
    `).run(JSON.stringify(data), r.id);
    n++;
  }
  return { scanned: rows.length, tombstoned: n };
}