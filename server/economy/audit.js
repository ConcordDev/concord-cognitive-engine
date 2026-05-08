// economy/audit.js
// Economy-grade audit logging with trace IDs.
// Logs both to console and to the persistent audit_log DB table.

import { randomUUID } from "crypto";

function nowISO() {
  return new Date().toISOString().replace("T", " ").replace("Z", "");
}

/**
 * Log an economy action to the audit_log table and console.
 *
 * @param {object} db — better-sqlite3 instance
 * @param {object} opts
 * @param {string} opts.action — e.g. "token_purchase", "transfer", "withdrawal_request"
 * @param {string} [opts.userId]
 * @param {number} [opts.amount]
 * @param {string} [opts.txId] — ledger transaction ID or batch ID
 * @param {string} [opts.requestId] — X-Request-ID header
 * @param {string} [opts.ip]
 * @param {string} [opts.userAgent]
 * @param {object} [opts.details] — any additional metadata
 */
export function economyAudit(db, opts) {
  const entry = {
    id: "eaud_" + randomUUID().replace(/-/g, "").slice(0, 16),
    timestamp: nowISO(),
    category: "economy",
    action: opts.action,
    userId: opts.userId || null,
    ip: opts.ip || null,
    userAgent: opts.userAgent || null,
    requestId: opts.requestId || null,
    details: {
      amount: opts.amount,
      txId: opts.txId,
      ...opts.details,
    },
  };

  // Console log for real-time monitoring
  console.warn(
    `[Economy Audit] ${entry.action} | user=${entry.userId} amount=${opts.amount || "-"} tx=${opts.txId || "-"} ip=${entry.ip || "-"}`,
  );

  // Persist to audit_log table (same schema the rest of Concord uses)
  if (db) {
    try {
      db.prepare(`
        INSERT INTO audit_log (id, timestamp, category, action, user_id, ip_address, user_agent, request_id, path, method, status_code, details)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        entry.id,
        entry.timestamp,
        entry.category,
        entry.action,
        entry.userId,
        entry.ip,
        entry.userAgent,
        entry.requestId,
        null, // path — not always available in economy context
        null, // method
        null, // status_code
        JSON.stringify(entry.details),
      );
    } catch (e) {
      console.error("[Economy Audit] Failed to persist:", e.message);
    }
  }

  return entry;
}

/**
 * Helper: extract audit context from an Express request.
 */
export function auditCtx(req) {
  return {
     
    // eslint-disable-next-line no-restricted-syntax
    userId: req.user?.id || req.body?.user_id || req.query?.user_id, // safe: target-identifier
    requestId: req.headers["x-request-id"],
    ip: req.ip,
    userAgent: req.headers["user-agent"],
  };
}
