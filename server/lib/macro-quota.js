// server/lib/macro-quota.js
//
// Per-user, per-macro sliding-window quota for the DX Platform (Phase A1).
//
// This is SEPARATE from the existing global `EXPENSIVE_MACROS` rate limit
// in `server.js` — that one caps total RPS across all callers; this one
// caps each authenticated user independently so a single API key can't
// monopolize the budget.
//
// Window granularity = one minute. Counters live in `user_macro_quota`,
// keyed by (user_id, domain, macro_name, window_start_minute_epoch).
// Old windows are not deleted on a hot path; the GC sweep at the bottom
// removes rows older than 24h.
//
// Defaults: 60 calls / user / minute / macro for any macro listed in
// MACRO_USER_LIMITS. Macros not in the map get the FALLBACK_LIMIT,
// which can be tuned via `CONCORD_DEFAULT_USER_QUOTA_PER_MIN`.

import { getFlag, getFlagNumber } from "./feature-flags.js";

// Per-(domain, macro) per-minute caps. Mirrors the EXPENSIVE_MACROS
// shape in server.js but keyed for ergonomic lookup.
const DEFAULT_MACRO_USER_LIMITS = {
  "detectors:run": 30,
  "detectors:runAll": 6,
  "repair:runProphet": 12,
  "repair:runSurgeon": 6,
  "dtu:upsert_shadow": 60,
  "dx:registerCodebase": 12,
  "dx:recordFixDecision": 60,
  "dx:getCodebaseFindings": 60,
  "billing:usage": 30,
  "billing:balance": 30,
};

let MACRO_USER_LIMITS = { ...DEFAULT_MACRO_USER_LIMITS };
try {
  if (process.env.CONCORD_MACRO_USER_LIMITS_JSON) {
    const overrides = JSON.parse(process.env.CONCORD_MACRO_USER_LIMITS_JSON);
    if (overrides && typeof overrides === "object") {
      MACRO_USER_LIMITS = { ...MACRO_USER_LIMITS, ...overrides };
    }
  }
} catch (err) {
  console.warn("[macro-quota] CONCORD_MACRO_USER_LIMITS_JSON parse failed:", err.message);
}

const FALLBACK_LIMIT = getFlagNumber("CONCORD_DEFAULT_USER_QUOTA_PER_MIN", 120);
const WINDOW_SECONDS = 60;

export function limitForMacro(domain, name) {
  return MACRO_USER_LIMITS[`${domain}:${name}`] ?? FALLBACK_LIMIT;
}

function currentWindowStart(nowEpoch = Math.floor(Date.now() / 1000)) {
  return Math.floor(nowEpoch / WINDOW_SECONDS) * WINDOW_SECONDS;
}

/**
 * Check whether the user has remaining quota for this macro in the
 * current window. Pure read — does NOT increment.
 *
 * @returns {{ok: boolean, remaining: number, limit: number, windowStart: number, retryAfterMs?: number}}
 */
export function checkUserQuota(db, userId, domain, name) {
  if (!getFlag("FF_MACRO_BILLING", 1)) return { ok: true, remaining: Infinity, limit: Infinity, windowStart: 0 };
  if (!db || !userId) return { ok: true, remaining: Infinity, limit: Infinity, windowStart: 0 };

  const limit = limitForMacro(domain, name);
  const windowStart = currentWindowStart();

  let count = 0;
  try {
    const row = db.prepare(`
      SELECT call_count FROM user_macro_quota
      WHERE user_id = ? AND domain = ? AND macro_name = ? AND window_start = ?
    `).get(userId, domain, name, windowStart);
    count = row?.call_count || 0;
  } catch (err) {
    // Migration not applied yet — fail open.
    return { ok: true, remaining: Infinity, limit, windowStart };
  }

  const remaining = Math.max(0, limit - count);
  if (count >= limit) {
    const nowSec = Math.floor(Date.now() / 1000);
    const retryAfterMs = Math.max(0, (windowStart + WINDOW_SECONDS - nowSec) * 1000);
    return { ok: false, remaining: 0, limit, windowStart, retryAfterMs };
  }
  return { ok: true, remaining, limit, windowStart };
}

/**
 * Atomically increment the user's call_count for the current window.
 * UPSERT — creates the row if missing.
 */
export function incrementUserQuota(db, userId, domain, name) {
  if (!getFlag("FF_MACRO_BILLING", 1)) return { ok: false, reason: "billing_disabled" };
  if (!db || !userId) return { ok: false, reason: "no_user" };
  const windowStart = currentWindowStart();
  try {
    db.prepare(`
      INSERT INTO user_macro_quota (user_id, domain, macro_name, window_start, call_count)
      VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(user_id, domain, macro_name, window_start)
      DO UPDATE SET call_count = call_count + 1
    `).run(userId, domain, name, windowStart);
    return { ok: true, windowStart };
  } catch (err) {
    console.warn("[macro-quota] increment failed:", err.message);
    return { ok: false, reason: err.message };
  }
}

/**
 * GC sweep — removes quota rows older than `retentionHours` (default 24h).
 * Cheap idempotent DELETE; safe to call from any heartbeat.
 */
export function sweepOldQuotaRows(db, retentionHours = 24) {
  if (!db) return { ok: false, reason: "no_db" };
  const cutoff = Math.floor(Date.now() / 1000) - retentionHours * 3600;
  try {
    const r = db.prepare(`DELETE FROM user_macro_quota WHERE window_start < ?`).run(cutoff);
    return { ok: true, deleted: r.changes };
  } catch (err) {
    return { ok: false, reason: err.message };
  }
}

/**
 * Read all current-window quotas for a single user. Used by
 * `billing.getCurrentQuota` to render the plugin status bar.
 */
export function listUserQuotas(db, userId) {
  if (!db || !userId) return [];
  const windowStart = currentWindowStart();
  try {
    const rows = db.prepare(`
      SELECT domain, macro_name, call_count
      FROM user_macro_quota
      WHERE user_id = ? AND window_start = ?
    `).all(userId, windowStart);
    return rows.map(r => {
      const limit = limitForMacro(r.domain, r.macro_name);
      return {
        domain: r.domain,
        macroName: r.macro_name,
        used: r.call_count,
        limit,
        remaining: Math.max(0, limit - r.call_count),
        windowStart,
      };
    });
  } catch {
    return [];
  }
}
