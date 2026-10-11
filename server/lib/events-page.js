/**
 * Activity page for GET /api/events/paginated.
 *
 * STATE.logs entries stamp `ts` as Date.now() (a number). Sorting with
 * localeCompare on that value throws, and the route used to answer 500.
 * Timestamps are coerced to strings before compare. A failure is an empty
 * page, not invented events.
 */

export function coerceEventTimestamp(value) {
  if (value == null || value === "") return "";
  if (typeof value === "number" && Number.isFinite(value)) {
    const ms = value > 0 && value < 1e12 ? value * 1000 : value;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? "" : d.toISOString();
  }
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? "" : value.toISOString();
  return String(value);
}

export function sortEventsDesc(activities) {
  const stamped = (activities || []).map((a) => ({
    ...a,
    timestamp: coerceEventTimestamp(a?.timestamp),
  }));
  stamped.sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  return stamped;
}

function clampLimit(limit) {
  const n = Number(limit);
  if (!Number.isFinite(n) || n <= 0) return 50;
  return Math.min(Math.floor(n), 200);
}

function clampOffset(offset) {
  const n = Number(offset);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.floor(n);
}

export function pageEvents(activities, { limit = 50, offset = 0, domain, entityType } = {}) {
  const lim = clampLimit(limit);
  const off = clampOffset(offset);
  let filtered = Array.isArray(activities) ? activities : [];
  if (domain) filtered = filtered.filter((a) => a.type === domain);
  if (entityType) filtered = filtered.filter((a) => a.entityType === entityType);
  const sorted = sortEventsDesc(filtered);
  const page = sorted.slice(off, off + lim);
  return { ok: true, items: page, events: page, total: sorted.length, limit: lim, offset: off };
}

export function emptyEventsPage(reason, { limit = 50, offset = 0 } = {}) {
  return {
    ok: true,
    items: [],
    events: [],
    total: 0,
    limit: clampLimit(limit),
    offset: clampOffset(offset),
    unavailable: reason ? String(reason) : "events_unavailable",
  };
}

export function collectPaginatedEvents({
  timeline = [],
  logs = [],
  auditRows = [],
  ledgerRows = [],
  limit,
  offset,
  domain,
  entityType,
  idFactory,
} = {}) {
  const uid = typeof idFactory === "function" ? idFactory : (p) => `${p}_evt`;
  const activities = [];

  for (const e of timeline || []) {
    activities.push({
      id: e.id,
      type: "dtu",
      action: e.action,
      message: `DTU ${e.action}: ${e.snapshot?.title || e.dtuId}`,
      entityId: e.dtuId,
      entityType: "dtu",
      timestamp: e.timestamp,
      meta: e.snapshot || {},
    });
  }

  for (const r of auditRows || []) {
    let det = {};
    try { det = r.details ? JSON.parse(r.details) : {}; } catch { /* row details are optional */ }
    activities.push({
      id: r.id,
      type: r.category || "system",
      action: r.action,
      message: `${r.action} ${r.path || ""}`.trim(),
      entityId: r.user_id,
      entityType: r.category || "audit",
      timestamp: r.timestamp,
      meta: det,
    });
  }

  for (const log of logs || []) {
    activities.push({
      id: log.id || uid("evt"),
      type: log.domain || "system",
      action: log.action || "log",
      message: log.message || "",
      entityId: null,
      entityType: log.domain || "system",
      timestamp: log.ts ?? log.timestamp,
      meta: log.meta || {},
    });
  }

  for (const tx of ledgerRows || []) {
    activities.push({
      id: tx.id,
      type: "economy",
      action: tx.type,
      message: `${tx.type}: ${tx.amount} credits${tx.memo ? " — " + tx.memo : ""}`,
      entityId: tx.from_user_id || tx.to_user_id,
      entityType: "transaction",
      timestamp: tx.created_at,
      meta: { amount: tx.amount, from: tx.from_user_id, to: tx.to_user_id },
    });
  }

  return pageEvents(activities, { limit, offset, domain, entityType });
}
