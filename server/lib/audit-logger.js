// @sync-fs-ok: append-only audit log requires synchronous write for compliance ordering
/**
 * @fileoverview Standalone audit-logging module for the Concord server.
 *
 * Provides structured audit logging with:
 *   - In-memory ring buffer (last 10,000 entries)
 *   - Append-only audit.log file on disk
 *   - Query helpers: by actor, action type, time range, target
 *
 * Usage:
 *   import { logAudit, getAuditLog, getAuditLogForUser } from "../lib/audit-logger.js";
 *   logAudit("user-123", "dtu.delete", "dtu-456", { ip: req.ip, reason: "spam" });
 */

import fs from "fs";
import path from "path";
import crypto from "crypto";

// ── Ring buffer ────────────────────────────────────────────────────────────────
const RING_MAX = 10_000;
const ring = [];           // newest at the end
let nextSlot = 0;          // write cursor (once ring is full)
let ringFull = false;

// ── File log ───────────────────────────────────────────────────────────────────
const LOG_DIR  = process.env.AUDIT_LOG_DIR || path.resolve(process.cwd(), "data");
const LOG_FILE = path.join(LOG_DIR, "audit.log");
let logStream = null;

/** Lazily open (or re-open) the append stream. */
function ensureStream() {
  if (logStream && !logStream.destroyed) return;
  try {
    if (!fs.existsSync(LOG_DIR)) fs.mkdirSync(LOG_DIR, { recursive: true });
    // @resource-leak-ok: process-lifetime audit log write stream — closes on process exit
    logStream = fs.createWriteStream(LOG_FILE, { flags: "a", encoding: "utf8" });
    logStream.on("error", (err) => {
       
      console.error("[audit-logger] stream error:", err.message);
      logStream = null;
    });
  } catch (err) {
     
    console.error("[audit-logger] could not open log file:", err.message);
  }
}

// ── Core API ───────────────────────────────────────────────────────────────────

/**
 * Record an audit event.
 *
 * @param {string}  actor    - User ID or system identifier that performed the action.
 * @param {string}  action   - Dot-namespaced action (e.g. "dtu.delete", "auth.login", "economy.transfer").
 * @param {string}  target   - The entity the action was performed on (DTU ID, user ID, etc.).
 * @param {object}  [metadata={}] - Arbitrary extra context (ip, userAgent, reason, amount, ...).
 * @returns {object} The audit entry that was stored.
 */
export function logAudit(actor, action, target, metadata = {}) {
  const entry = {
    id:        crypto.randomUUID(),
    timestamp: new Date().toISOString(),
    actor:     actor ?? "system",
    action,
    target:    target ?? null,
    metadata:  { ...metadata },
    ip:        metadata.ip || null,
  };

  // ---- Ring buffer insert ----------------------------------------------------
  if (!ringFull) {
    ring.push(entry);
    if (ring.length >= RING_MAX) ringFull = true;
  } else {
    ring[nextSlot] = entry;
    nextSlot = (nextSlot + 1) % RING_MAX;
  }

  // ---- File append -----------------------------------------------------------
  ensureStream();
  if (logStream) {
    logStream.write(JSON.stringify(entry) + "\n");
  }

  return entry;
}

/**
 * Query audit entries from the ring buffer.
 *
 * @param {object}  [filters={}]
 * @param {string}  [filters.actor]      - Exact match on actor.
 * @param {string}  [filters.action]     - Exact match on action (e.g. "dtu.delete").
 * @param {string}  [filters.target]     - Exact match on target.
 * @param {string}  [filters.startDate]  - ISO date; entries >= this timestamp.
 * @param {string}  [filters.endDate]    - ISO date; entries <= this timestamp.
 * @param {number}  [filters.limit=50]   - Max entries to return.
 * @param {number}  [filters.offset=0]   - Entries to skip (for pagination).
 * @returns {{ entries: object[], total: number, limit: number, offset: number }}
 */
export function getAuditLog(filters = {}) {
  const { actor, action, target, startDate, endDate, limit = 50, offset = 0 } = filters;

  // Materialise the ring in chronological order
  let ordered;
  if (!ringFull) {
    ordered = ring;
  } else {
    ordered = ring.slice(nextSlot).concat(ring.slice(0, nextSlot));
  }

  // Walk in reverse (newest first)
  const matches = [];
  for (let i = ordered.length - 1; i >= 0; i--) {
    const e = ordered[i];
    if (actor    && e.actor  !== actor)  continue;
    if (action   && e.action !== action) continue;
    if (target   && e.target !== target) continue;
    if (startDate && e.timestamp < startDate) continue;
    if (endDate   && e.timestamp > endDate)   continue;
    matches.push(e);
  }

  const total = matches.length;
  const page  = matches.slice(offset, offset + limit);

  return { entries: page, total, limit, offset };
}

/**
 * Convenience wrapper: return all audit entries where the actor is `userId`.
 *
 * @param {string} userId
 * @param {object} [opts]          - Same filter/pagination fields as getAuditLog (minus actor).
 * @returns {{ entries: object[], total: number, limit: number, offset: number }}
 */
export function getAuditLogForUser(userId, opts = {}) {
  return getAuditLog({ ...opts, actor: userId });
}
